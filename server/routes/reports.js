import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { fetchFxRate, liveQuoteCache } from '../services/priceEngine.js';
import { computeHoldingValueINR } from '../services/portfolioCalculator.js';
import { computeGrowthBenchmarks, invalidateBenchmarkCache } from '../services/benchmarkEngine.js';
import { authenticateToken } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

router.get('/reports/mf-holdings', authenticateToken, async (req, res) => {
  try {
    const fxRate = await fetchFxRate();
    const holdings = await db.select('holdings');
    const mfHoldings = holdings.filter(h => h.category_id === 'mutual_funds' && Number(h.quantity) > 0);

    const schemeValueMap = {};
    let totalMfValueINR = 0;
    mfHoldings.forEach(h => {
      const quote = liveQuoteCache.get(h.symbol);
      const price = (quote && quote.price > 0) ? quote.price : (Number(h.current_price) || 0);
      const valINR = computeHoldingValueINR(h, price, fxRate);
      schemeValueMap[h.symbol] = {
        name: h.name,
        symbol: h.symbol,
        units: Number(h.quantity),
        nav: price,
        currentValueINR: valINR
      };
      totalMfValueINR += valINR;
    });

    let mfPortfolios = null;
    try {
      const { data } = await supabase.from('mutual_fund_holdings').select('*');
      if (data && data.length > 0) {
        mfPortfolios = {};
        data.forEach(row => {
          if (!mfPortfolios[row.scheme_code]) {
            mfPortfolios[row.scheme_code] = {
              scheme_code: row.scheme_code,
              scheme_name: row.scheme_name,
              companies: []
            };
          }
          mfPortfolios[row.scheme_code].companies.push({
            company: row.company_name,
            symbol: row.symbol,
            allocation_pct: Number(row.allocation_pct),
            sector: row.sector,
            mcap_category: row.mcap_category
          });
        });
      }
    } catch (e) {
      console.warn('[Reports] Supabase mutual_fund_holdings fetch error:', e.message);
    }

    if (!mfPortfolios) {
      const mfFile = path.join(__dirname, '../../data/mutual_fund_holdings.json');
      if (fs.existsSync(mfFile)) {
        mfPortfolios = JSON.parse(fs.readFileSync(mfFile, 'utf8'));
      } else {
        mfPortfolios = {};
      }
    }

    const schemes = [];
    const aggregatedCompanies = {};
    const sectorDistribution = {};
    const mcapDistribution = { 'Mega Cap': 0, 'Large Cap': 0, 'Mid Cap': 0, 'Small Cap': 0, 'Micro Cap': 0, 'Cash': 0 };

    Object.keys(schemeValueMap).forEach(code => {
      const scheme = schemeValueMap[code];
      const portfolio = mfPortfolios[code] || { companies: [] };
      const companiesWithVal = (portfolio.companies || []).map(c => {
        const allocatedVal = Number(((c.allocation_pct / 100) * scheme.currentValueINR).toFixed(2));

        if (!aggregatedCompanies[c.company]) {
          aggregatedCompanies[c.company] = {
            company: c.company,
            symbol: c.symbol,
            sector: c.sector,
            mcap_category: c.mcap_category,
            totalAllocatedINR: 0,
            schemes: []
          };
        }
        aggregatedCompanies[c.company].totalAllocatedINR += allocatedVal;
        aggregatedCompanies[c.company].schemes.push({
          scheme_name: scheme.name,
          scheme_code: code,
          pct: c.allocation_pct,
          valueINR: allocatedVal
        });

        const s = c.sector || 'Diversified';
        sectorDistribution[s] = (sectorDistribution[s] || 0) + allocatedVal;

        const mc = c.mcap_category || 'Mid Cap';
        if (mcapDistribution[mc] !== undefined) {
          mcapDistribution[mc] += allocatedVal;
        } else {
          mcapDistribution['Mid Cap'] += allocatedVal;
        }

        return {
          ...c,
          allocatedINR: allocatedVal
        };
      }).sort((a, b) => b.allocatedINR - a.allocatedINR);

      schemes.push({
        scheme_code: code,
        scheme_name: scheme.name,
        currentValueINR: scheme.currentValueINR,
        companies: companiesWithVal
      });
    });

    const companyList = Object.values(aggregatedCompanies)
      .map(c => ({
        ...c,
        percentage: totalMfValueINR > 0 ? Number(((c.totalAllocatedINR / totalMfValueINR) * 100).toFixed(2)) : 0
      }))
      .sort((a, b) => b.totalAllocatedINR - a.totalAllocatedINR);

    res.json({
      totalMfValueINR,
      schemes: schemes.sort((a, b) => b.currentValueINR - a.currentValueINR),
      aggregatedCompanies: companyList,
      sectorDistribution,
      mcapDistribution
    });
  } catch (err) {
    console.error('[MF Holdings Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/growth-benchmarks', authenticateToken, async (req, res) => {
  try {
    const result = await computeGrowthBenchmarks(req.query);
    res.json(result);
  } catch (err) {
    console.error('[Growth Benchmarks Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/reports/sync-metadata', authenticateToken, async (req, res) => {
  try {
    invalidateBenchmarkCache();
    const { syncAssetMetadata } = await import('../../scripts/sync_asset_metadata.mjs');
    const { syncMutualFundHoldings } = await import('../../scripts/sync_mf_holdings.mjs');
    const { syncIndexHistory } = await import('../../scripts/sync_index_history.mjs');

    syncAssetMetadata(true).catch(e => console.error('[Background Sync Asset Error]:', e));
    syncIndexHistory().catch(e => console.error('[Background Sync Index Error]:', e));

    res.json({ success: true, message: 'Metadata and benchmark index sync initiated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
