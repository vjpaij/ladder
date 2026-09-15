import express from 'express';
import axios from 'axios';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { refreshAllHoldingsPrices, fetchNpsHistoricalNav, syncAllMissingNavs } from '../services/priceEngine.js';
import { loadHistoricalPricesAsync } from '../services/historicalPriceStore.js';
import { runComprehensiveSelfHealing } from '../services/selfHealingService.js';
import { processDueSips } from '../services/sipEngine.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// -------------------------------------------------------------
// Stock Search Proxy (Yahoo Finance)
// -------------------------------------------------------------
router.get('/search/stocks', async (req, res) => {
  try {
    const { q, market } = req.query;
    if (!q || q.length < 1) return res.json([]);

    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0&enableFuzzyQuery=true`;
    const response = await axios.get(url, {
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const quotes = response.data?.quotes || [];
    let filtered = quotes.filter(q => q.quoteType === 'EQUITY' || q.quoteType === 'MUTUALFUND' || q.quoteType === 'ETF');

    if (market === 'india') {
      filtered = filtered.filter(q => q.exchange === 'NSI' || q.exchange === 'BSE' || q.exchange === 'NSE' ||
        (q.symbol && (q.symbol.endsWith('.NS') || q.symbol.endsWith('.BO'))));
    } else if (market === 'us') {
      filtered = filtered.filter(q => ['NMS', 'NYQ', 'NGM', 'NCM', 'PCX', 'BTS'].includes(q.exchange) ||
        q.exchDisp === 'NASDAQ' || q.exchDisp === 'NYSE');
    }

    const results = filtered.map(q => ({
      symbol: q.symbol,
      name: q.longname || q.shortname || q.symbol,
      exchange: q.exchDisp || q.exchange,
      type: q.quoteType
    }));

    res.json(results);
  } catch (err) {
    console.error('[Search Stocks Error]:', err.message);
    res.json([]);
  }
});

// -------------------------------------------------------------
// AMFI Mutual Fund Search Proxy
// -------------------------------------------------------------
let amfiMasterCache = null;
let amfiCacheTime = 0;
const AMFI_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function getAmfiMaster() {
  if (amfiMasterCache && Date.now() - amfiCacheTime < AMFI_CACHE_TTL) return amfiMasterCache;
  try {
    const res = await axios.get('https://api.mfapi.in/mf', { timeout: 10000 });
    if (res.data && Array.isArray(res.data)) {
      amfiMasterCache = res.data;
      amfiCacheTime = Date.now();
      console.log(`[AMFI] Cached ${amfiMasterCache.length} mutual fund schemes`);
    }
  } catch (err) {
    console.error('[AMFI Master Fetch Error]:', err.message);
  }
  return amfiMasterCache || [];
}

router.get('/search/mutual-funds', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);

    const master = await getAmfiMaster();
    const queryTerms = q.toLowerCase().split(/\s+/);

    const matches = master
      .filter(m => {
        const name = (m.schemeName || '').toLowerCase();
        return queryTerms.every(term => name.includes(term));
      })
      .slice(0, 15)
      .map(m => ({
        schemeCode: String(m.schemeCode),
        schemeName: m.schemeName
      }));

    res.json(matches);
  } catch (err) {
    console.error('[Search MF Error]:', err.message);
    res.json([]);
  }
});

router.get('/nav/mutual-funds/:schemeCode', async (req, res) => {
  try {
    const { date } = req.query;
    const mfRes = await axios.get(`https://api.mfapi.in/mf/${req.params.schemeCode}`, { timeout: 8000 });
    const dataArray = mfRes.data?.data;

    if (dataArray && dataArray.length > 0) {
      let match = dataArray[0];
      if (date) {
        const targetDateObj = new Date(date);
        match = dataArray.find(d => {
          const [dDD, dMM, dYYYY] = d.date.split('-');
          const dObj = new Date(`${dYYYY}-${dMM}-${dDD}`);
          return dObj <= targetDateObj;
        }) || dataArray[0];
      }
      res.json({ nav: parseFloat(match.nav), date: match.date });
    } else {
      res.status(404).json({ error: 'NAV not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// NPS NAV Lookup by Scheme Code and Date
// -------------------------------------------------------------
router.get('/nav/nps/:schemeCode', async (req, res) => {
  try {
    const { schemeCode } = req.params;
    const { date } = req.query;
    const cleanDate = date || new Date().toISOString().split('T')[0];

    // 1. Try database table nps_daily_navs first (Protean verified)
    const { data: dbRows } = await supabase
      .from('nps_daily_navs')
      .select('*')
      .eq('scheme_code', schemeCode)
      .lte('nav_date', cleanDate)
      .order('nav_date', { ascending: false })
      .limit(1);

    if (dbRows && dbRows.length > 0) {
      return res.json({ nav: Number(dbRows[0].nav), date: dbRows[0].nav_date, source: 'protean_db' });
    }

    // 2. Fallback to historical cache
    const histMap = await fetchNpsHistoricalNav(schemeCode);
    if (histMap && histMap.size > 0) {
      if (histMap.has(cleanDate)) {
        return res.json({ nav: histMap.get(cleanDate), date: cleanDate, source: 'historical_archive' });
      }
      const dates = Array.from(histMap.keys()).filter(d => d <= cleanDate).sort().reverse();
      if (dates.length > 0) {
        return res.json({ nav: histMap.get(dates[0]), date: dates[0], source: 'historical_archive' });
      }
    }

    res.status(404).json({ error: 'NPS NAV not found for given date' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Universal On-Demand NAV Catch-Up Endpoint (Mutual Funds + NPS)
router.post('/refresh-navs', authenticateToken, async (req, res) => {
  try {
    const results = await syncAllMissingNavs();
    const sipProcessing = await processDueSips();
    res.json({
      success: true,
      message: `Sync complete: ${results.npsUpdated} NPS schemes & ${results.mfUpdated} Mutual Funds updated.`,
      results,
      sipProcessing
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Live Price Engine API Refresh
router.post('/refresh-prices', authenticateToken, async (req, res) => {
  try {
    await loadHistoricalPricesAsync();
    const result = await refreshAllHoldingsPrices();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Comprehensive Data Self-Healing Endpoint (FX, Prices, NAVs, Holding Parity)
router.post('/self-heal', authenticateToken, async (req, res) => {
  try {
    const result = await runComprehensiveSelfHealing();
    res.json({ success: true, message: 'Self-healing scan complete.', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// NPS scheme master list
let npsSchemeMasterCache = null;
let npsCacheTime = 0;

router.get('/search/nps-schemes', async (req, res) => {
  try {
    if (!npsSchemeMasterCache || Date.now() - npsCacheTime > AMFI_CACHE_TTL) {
      const npsHoldings = await db.selectWhere('holdings', { category_id: 'nps' });
      const schemeSet = new Map();

      npsHoldings.forEach(h => {
        schemeSet.set(h.symbol, { schemeCode: h.symbol, schemeName: h.name });
      });

      const masterSchemes = [
        { schemeCode: 'SM008001', schemeName: 'SBI Pension - Scheme E Tier I' },
        { schemeCode: 'SM008002', schemeName: 'SBI Pension - Scheme C Tier I' },
        { schemeCode: 'SM008003', schemeName: 'SBI Pension - Scheme G Tier I' },
        { schemeCode: 'SM001001', schemeName: 'HDFC Pension - Scheme E Tier I' },
        { schemeCode: 'SM001002', schemeName: 'HDFC Pension - Scheme C Tier I' },
        { schemeCode: 'SM001003', schemeName: 'HDFC Pension - Scheme G Tier I' },
        { schemeCode: 'SM002001', schemeName: 'ICICI Pru Pension - Scheme E Tier I' },
        { schemeCode: 'SM002002', schemeName: 'ICICI Pru Pension - Scheme C Tier I' },
        { schemeCode: 'SM002003', schemeName: 'ICICI Pru Pension - Scheme G Tier I' },
        { schemeCode: 'SM003001', schemeName: 'Kotak Pension - Scheme E Tier I' },
        { schemeCode: 'SM003002', schemeName: 'Kotak Pension - Scheme C Tier I' },
        { schemeCode: 'SM003003', schemeName: 'Kotak Pension - Scheme G Tier I' },
        { schemeCode: 'SM004001', schemeName: 'Aditya Birla SL Pension - Scheme E Tier I' },
        { schemeCode: 'SM004002', schemeName: 'Aditya Birla SL Pension - Scheme C Tier I' },
        { schemeCode: 'SM004003', schemeName: 'Aditya Birla SL Pension - Scheme G Tier I' },
        { schemeCode: 'SM005001', schemeName: 'LIC Pension - Scheme E Tier I' },
        { schemeCode: 'SM005002', schemeName: 'LIC Pension - Scheme C Tier I' },
        { schemeCode: 'SM005003', schemeName: 'LIC Pension - Scheme G Tier I' },
        { schemeCode: 'SM006001', schemeName: 'UTI Pension - Scheme E Tier I' },
        { schemeCode: 'SM006002', schemeName: 'UTI Pension - Scheme C Tier I' },
        { schemeCode: 'SM006003', schemeName: 'UTI Pension - Scheme G Tier I' },
        { schemeCode: 'SM007001', schemeName: 'Tata Pension - Scheme E Tier I' },
        { schemeCode: 'SM007002', schemeName: 'Tata Pension - Scheme C Tier I' },
        { schemeCode: 'SM007003', schemeName: 'Tata Pension - Scheme G Tier I' },
        { schemeCode: 'SM010001', schemeName: 'Max Life Pension - Scheme E Tier I' },
        { schemeCode: 'SM010002', schemeName: 'Max Life Pension - Scheme C Tier I' },
        { schemeCode: 'SM010003', schemeName: 'Max Life Pension - Scheme G Tier I' },
        { schemeCode: 'SM001004', schemeName: 'HDFC Pension - Scheme A Tier I' },
        { schemeCode: 'SM002004', schemeName: 'ICICI Pru Pension - Scheme A Tier I' },
        { schemeCode: 'SM008004', schemeName: 'SBI Pension - Scheme A Tier I' }
      ];

      masterSchemes.forEach(s => {
        if (!schemeSet.has(s.schemeCode)) schemeSet.set(s.schemeCode, s);
      });

      npsSchemeMasterCache = Array.from(schemeSet.values());
      npsCacheTime = Date.now();
    }

    const { q } = req.query;
    if (q && q.length > 0) {
      const query = q.toLowerCase();
      const filtered = npsSchemeMasterCache.filter(s =>
        s.schemeName.toLowerCase().includes(query) || s.schemeCode.toLowerCase().includes(query)
      );
      return res.json(filtered);
    }

    res.json(npsSchemeMasterCache);
  } catch (err) {
    console.error('[NPS Schemes Error]:', err.message);
    res.json([]);
  }
});

// -------------------------------------------------------------
// Fetch Existing Accounts (for Bank, Loan, EPF, CC dropdowns)
// -------------------------------------------------------------
router.get('/accounts', authenticateToken, async (req, res) => {
  try {
    const banks = await db.selectWhere('holdings', { category_id: 'bank' });
    const epf = await db.selectWhere('holdings', { category_id: 'epf' });
    const loans = await db.selectWhere('liabilities', { category_id: 'loans' });
    const creditCards = await db.selectWhere('liabilities', { category_id: 'credit_cards' });

    res.json({
      banks: banks.map(b => b.name),
      epf: epf.map(e => e.name),
      loans: loans.map(l => l.name),
      creditCards: creditCards.map(c => c.name)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
