import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { fetchFxRate, liveQuoteCache, resolveHoldingPrice } from '../services/priceEngine.js';
import { loadHistoricalPricesAsync } from '../services/historicalPriceStore.js';
import { normalizeSector } from '../../src/components/reports/reportsConstants.js';
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
      const data = await db.select('mutual_fund_holdings');
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
      console.warn('[Reports] DB mutual_fund_holdings fetch error:', e.message);
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


/**
 * Sector & Market Cap Tier Dynamic Performance API
 * Computes period return %, period gain INR, current value INR, and constituent stocks
 * across customizable calendar/preset date ranges.
 */
router.get('/reports/sector-cap-performance', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, rangeType = 'ALL' } = req.query;
    const fxRate = await fetchFxRate();
    const holdings = await db.select('holdings');
    const histMap = await loadHistoricalPricesAsync();

    let meta = [];
    try {
      const metaPath = path.join(__dirname, '../../data/asset_metadata.json');
      if (fs.existsSync(metaPath)) {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      }
    } catch (e) {
      console.warn('[SectorCapPerf] Metadata read error:', e.message);
    }

    const metaMap = new Map();
    (meta || []).forEach(m => {
      if (m.symbol) {
        metaMap.set(m.symbol.toUpperCase(), m);
        metaMap.set(m.symbol.replace(/\.(NS|BO)$/i, '').toUpperCase(), m);
      }
    });

    const equityHoldings = (holdings || []).filter(h => 
      (h.category_id === 'in_stocks' || h.category_id === 'us_stocks') && Number(h.quantity) > 0
    );

    const stockResults = [];
    let totalCurrentValINR = 0;
    let totalStartValINR = 0;

    for (const h of equityHoldings) {
      const isUSD = h.currency === 'USD';
      const cleanSym = (h.symbol || '').replace(/\.(NS|BO)$/i, '').trim().toUpperCase();
      const metaRow = metaMap.get(cleanSym) || metaMap.get((h.symbol || '').toUpperCase()) || {};

      const sector = normalizeSector(metaRow.sector || h.sector);
      const mcapCategory = metaRow.mcap_category || (metaRow.market_cap ? (metaRow.market_cap >= 100000 ? 'Mega Cap' : metaRow.market_cap >= 20000 ? 'Large Cap' : metaRow.market_cap >= 5000 ? 'Mid Cap' : metaRow.market_cap >= 500 ? 'Small Cap' : 'Micro Cap') : (h.market_cap || 'Small Cap'));

      const liveQuote = liveQuoteCache.get(h.symbol);
      const endPrice = resolveHoldingPrice(h, liveQuote) || Number(h.current_price) || 0;

      // Base price on startDate
      let basePrice = null;
      if (rangeType === 'ALL' || !startDate) {
        basePrice = Number(h.avg_buy_price) || endPrice;
      } else {
        const series = histMap[h.symbol] || histMap[cleanSym] || histMap[`${cleanSym}.NS`] || histMap[`${cleanSym}.BO`] || {};
        const dates = Object.keys(series).sort();
        
        if (series[startDate] !== undefined) {
          basePrice = Number(series[startDate]);
        } else {
          // Closest trading day <= startDate
          const priorDates = dates.filter(d => d <= startDate);
          if (priorDates.length > 0) {
            basePrice = Number(series[priorDates[priorDates.length - 1]]);
          } else if (dates.length > 0) {
            basePrice = Number(series[dates[0]]);
          }
        }
      }

      if (!basePrice || isNaN(basePrice) || basePrice <= 0) {
        basePrice = Number(h.avg_buy_price) || endPrice;
      }

      const qty = Number(h.quantity) || 0;
      const rate = isUSD ? fxRate : 1.0;

      const startValINR = qty * basePrice * rate;
      const currentValINR = qty * endPrice * rate;
      const gainINR = currentValINR - startValINR;
      const returnPct = startValINR > 0 ? ((currentValINR - startValINR) / startValINR) * 100 : 0;

      totalCurrentValINR += currentValINR;
      totalStartValINR += startValINR;

      stockResults.push({
        holdingId: h.id,
        symbol: h.symbol,
        cleanSymbol: cleanSym,
        name: h.name || h.symbol,
        category_id: h.category_id,
        currency: h.currency,
        sector,
        mcapCategory,
        quantity: qty,
        startPrice: Math.round(basePrice * 100) / 100,
        endPrice: Math.round(endPrice * 100) / 100,
        startValINR: Math.round(startValINR * 100) / 100,
        currentValINR: Math.round(currentValINR * 100) / 100,
        gainINR: Math.round(gainINR * 100) / 100,
        returnPct: Math.round(returnPct * 100) / 100
      });
    }

    // Aggregate by Sector
    const sectorMap = {};
    for (const s of stockResults) {
      if (!sectorMap[s.sector]) {
        sectorMap[s.sector] = {
          name: s.sector,
          currentValINR: 0,
          startValINR: 0,
          gainINR: 0,
          stocksCount: 0,
          stocks: []
        };
      }
      const sec = sectorMap[s.sector];
      sec.currentValINR += s.currentValINR;
      sec.startValINR += s.startValINR;
      sec.gainINR += s.gainINR;
      sec.stocksCount += 1;
      sec.stocks.push(s);
    }

    const sectors = Object.values(sectorMap).map(sec => ({
      ...sec,
      currentValINR: Math.round(sec.currentValINR * 100) / 100,
      startValINR: Math.round(sec.startValINR * 100) / 100,
      gainINR: Math.round(sec.gainINR * 100) / 100,
      returnPct: sec.startValINR > 0 ? Math.round(((sec.currentValINR - sec.startValINR) / sec.startValINR) * 10000) / 100 : 0,
      allocationPct: totalCurrentValINR > 0 ? Math.round((sec.currentValINR / totalCurrentValINR) * 10000) / 100 : 0,
      stocks: sec.stocks.sort((a, b) => b.currentValINR - a.currentValINR)
    })).sort((a, b) => b.returnPct - a.returnPct);

    // Aggregate by Cap Tier
    const capOrder = ['Mega Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'Micro Cap'];
    const capMap = {};
    for (const s of stockResults) {
      const tier = s.mcapCategory;
      if (!capMap[tier]) {
        capMap[tier] = {
          name: tier,
          currentValINR: 0,
          startValINR: 0,
          gainINR: 0,
          stocksCount: 0,
          stocks: []
        };
      }
      const cap = capMap[tier];
      cap.currentValINR += s.currentValINR;
      cap.startValINR += s.startValINR;
      cap.gainINR += s.gainINR;
      cap.stocksCount += 1;
      cap.stocks.push(s);
    }

    const caps = Object.values(capMap).map(cap => ({
      ...cap,
      currentValINR: Math.round(cap.currentValINR * 100) / 100,
      startValINR: Math.round(cap.startValINR * 100) / 100,
      gainINR: Math.round(cap.gainINR * 100) / 100,
      returnPct: cap.startValINR > 0 ? Math.round(((cap.currentValINR - cap.startValINR) / cap.startValINR) * 10000) / 100 : 0,
      allocationPct: totalCurrentValINR > 0 ? Math.round((cap.currentValINR / totalCurrentValINR) * 10000) / 100 : 0,
      stocks: cap.stocks.sort((a, b) => b.currentValINR - a.currentValINR)
    })).sort((a, b) => {
      const ia = capOrder.indexOf(a.name);
      const ib = capOrder.indexOf(b.name);
      if (ia !== -1 && ib !== -1) return ia - ib;
      return b.returnPct - a.returnPct;
    });

    const totalGainINR = totalCurrentValINR - totalStartValINR;
    const totalReturnPct = totalStartValINR > 0 ? Math.round((totalGainINR / totalStartValINR) * 10000) / 100 : 0;

    res.json({
      success: true,
      startDate: startDate || null,
      endDate: endDate || new Date().toISOString().split('T')[0],
      rangeType,
      totalCurrentValINR: Math.round(totalCurrentValINR * 100) / 100,
      totalStartValINR: Math.round(totalStartValINR * 100) / 100,
      totalGainINR: Math.round(totalGainINR * 100) / 100,
      totalReturnPct,
      totalStocksCount: stockResults.length,
      sectors,
      caps
    });
  } catch (err) {
    console.error('[Sector Cap Perf Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
