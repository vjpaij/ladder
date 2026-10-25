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
    const {
      startDate,
      endDate,
      rangeType = 'ALL',
      marketScope = 'PORTFOLIO',
      includeIndia: qIndia,
      includeUs: qUs,
      includeMf: qMf
    } = req.query;

    const isMarketScope = marketScope === 'MARKET';
    const includeIndia = qIndia !== 'false';
    const includeUs = qUs !== 'false';
    const includeMf = qMf === 'true';

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

    // Map portfolio holdings for quick cross-reference
    const portfolioSymbolSet = new Set();
    const portfolioHoldingMap = new Map();
    (holdings || []).forEach(h => {
      if (Number(h.quantity) > 0) {
        const cleanSym = (h.symbol || '').replace(/\.(NS|BO)$/i, '').trim().toUpperCase();
        portfolioSymbolSet.add(cleanSym);
        portfolioSymbolSet.add((h.symbol || '').toUpperCase());
        portfolioHoldingMap.set(cleanSym, h);
      }
    });

    const stockResults = [];
    let totalCurrentValINR = 0;
    let totalStartValINR = 0;

    if (isMarketScope) {
      // ── GENERAL MARKET ANALYSIS (Broader Market Universe) ──
      for (const m of meta) {
        const isUS = m.category_id === 'us_stocks';
        if (isUS && !includeUs) continue;
        if (!isUS && !includeIndia) continue;

        const cleanSym = (m.symbol || '').replace(/\.(NS|BO)$/i, '').trim().toUpperCase();
        const sector = normalizeSector(m.sector);
        const mcapCategory = m.mcap_category || (m.market_cap ? (m.market_cap >= 500000 ? 'Mega Cap' : m.market_cap >= 85000 ? 'Large Cap' : m.market_cap >= 27500 ? 'Mid Cap' : m.market_cap >= 5000 ? 'Small Cap' : 'Micro Cap') : 'Small Cap');

        const series = histMap[m.symbol] || histMap[cleanSym] || histMap[`${cleanSym}.NS`] || histMap[`${cleanSym}.BO`] || {};
        const dates = Object.keys(series).sort();
        if (dates.length < 2) continue;

        // End price
        const liveQuote = liveQuoteCache.get(m.symbol) || liveQuoteCache.get(cleanSym);
        const resolvedLive = liveQuote?.price || liveQuote?.currentPrice || liveQuote?.regularMarketPrice;
        let endPrice = Number(resolvedLive) || Number(series[endDate] || series[dates[dates.length - 1]]);

        // Start / Base price
        let basePrice = null;
        if (rangeType === 'ALL' || !startDate) {
          basePrice = Number(series[dates[0]]);
        } else {
          if (series[startDate] !== undefined) {
            basePrice = Number(series[startDate]);
          } else {
            const priorDates = dates.filter(d => d <= startDate);
            if (priorDates.length > 0) {
              basePrice = Number(series[priorDates[priorDates.length - 1]]);
            } else {
              basePrice = Number(series[dates[0]]);
            }
          }
        }

        if (!basePrice || !endPrice || basePrice <= 0 || endPrice <= 0) continue;

        const returnPct = ((endPrice - basePrice) / basePrice) * 100;
        const isHolding = portfolioSymbolSet.has(cleanSym);
        const holdingObj = portfolioHoldingMap.get(cleanSym);

        stockResults.push({
          holdingId: holdingObj?.id || null,
          symbol: m.symbol,
          cleanSymbol: cleanSym,
          name: m.name || m.symbol,
          category_id: m.category_id || (isUS ? 'us_stocks' : 'in_stocks'),
          currency: isUS ? 'USD' : 'INR',
          sector,
          mcapCategory,
          marketCapCr: m.market_cap || null,
          quantity: holdingObj ? Number(holdingObj.quantity) : 0,
          startPrice: Math.round(basePrice * 100) / 100,
          endPrice: Math.round(endPrice * 100) / 100,
          startValINR: 0,
          currentValINR: holdingObj ? (holdingObj.currentValueINR || (Number(holdingObj.quantity) * endPrice * (isUS ? fxRate : 1))) : 0,
          gainINR: 0,
          returnPct: Math.round(returnPct * 100) / 100,
          isPortfolioHolding: isHolding
        });
      }
    } else {
      // ── MY PORTFOLIO ANALYSIS ──
      const equityHoldings = (holdings || []).filter(h => {
        if (Number(h.quantity) <= 0) return false;
        if (h.category_id === 'in_stocks') return includeIndia;
        if (h.category_id === 'us_stocks') return includeUs;
        if (h.category_id === 'mutual_funds') return includeMf;
        return false;
      });

      for (const h of equityHoldings) {
        const isUSD = h.currency === 'USD';
        const cleanSym = (h.symbol || '').replace(/\.(NS|BO)$/i, '').trim().toUpperCase();
        const metaRow = metaMap.get(cleanSym) || metaMap.get((h.symbol || '').toUpperCase()) || {};

        const sector = normalizeSector(metaRow.sector || h.sector);
        const mcapCategory = metaRow.mcap_category || (metaRow.market_cap ? (metaRow.market_cap >= 500000 ? 'Mega Cap' : metaRow.market_cap >= 85000 ? 'Large Cap' : metaRow.market_cap >= 27500 ? 'Mid Cap' : metaRow.market_cap >= 5000 ? 'Small Cap' : 'Micro Cap') : (h.market_cap || 'Small Cap'));

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
          marketCapCr: metaRow.market_cap || null,
          quantity: qty,
          startPrice: Math.round(basePrice * 100) / 100,
          endPrice: Math.round(endPrice * 100) / 100,
          startValINR: Math.round(startValINR * 100) / 100,
          currentValINR: Math.round(currentValINR * 100) / 100,
          gainINR: Math.round(gainINR * 100) / 100,
          returnPct: Math.round(returnPct * 100) / 100,
          isPortfolioHolding: true
        });
      }
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

    const sectors = Object.values(sectorMap).map(sec => {
      let returnPct = 0;
      if (isMarketScope) {
        returnPct = sec.stocks.length > 0
          ? Math.round((sec.stocks.reduce((acc, s) => acc + s.returnPct, 0) / sec.stocks.length) * 100) / 100
          : 0;
      } else {
        returnPct = sec.startValINR > 0
          ? Math.round(((sec.currentValINR - sec.startValINR) / sec.startValINR) * 10000) / 100
          : 0;
      }
      return {
        ...sec,
        currentValINR: Math.round(sec.currentValINR * 100) / 100,
        startValINR: Math.round(sec.startValINR * 100) / 100,
        gainINR: Math.round(sec.gainINR * 100) / 100,
        returnPct,
        allocationPct: totalCurrentValINR > 0 ? Math.round((sec.currentValINR / totalCurrentValINR) * 10000) / 100 : 0,
        stocks: sec.stocks.sort((a, b) => isMarketScope ? (b.returnPct - a.returnPct) : (b.currentValINR - a.currentValINR))
      };
    }).sort((a, b) => b.returnPct - a.returnPct);

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

    const caps = Object.values(capMap).map(cap => {
      let returnPct = 0;
      if (isMarketScope) {
        returnPct = cap.stocks.length > 0
          ? Math.round((cap.stocks.reduce((acc, s) => acc + s.returnPct, 0) / cap.stocks.length) * 100) / 100
          : 0;
      } else {
        returnPct = cap.startValINR > 0
          ? Math.round(((cap.currentValINR - cap.startValINR) / cap.startValINR) * 10000) / 100
          : 0;
      }
      return {
        ...cap,
        currentValINR: Math.round(cap.currentValINR * 100) / 100,
        startValINR: Math.round(cap.startValINR * 100) / 100,
        gainINR: Math.round(cap.gainINR * 100) / 100,
        returnPct,
        allocationPct: totalCurrentValINR > 0 ? Math.round((cap.currentValINR / totalCurrentValINR) * 10000) / 100 : 0,
        stocks: cap.stocks.sort((a, b) => isMarketScope ? (b.returnPct - a.returnPct) : (b.currentValINR - a.currentValINR))
      };
    }).sort((a, b) => {
      const ia = capOrder.indexOf(a.name);
      const ib = capOrder.indexOf(b.name);
      if (ia !== -1 && ib !== -1) return ia - ib;
      return b.returnPct - a.returnPct;
    });

    let totalGainINR = 0;
    let totalReturnPct = 0;
    if (isMarketScope) {
      totalReturnPct = stockResults.length > 0
        ? Math.round((stockResults.reduce((acc, s) => acc + s.returnPct, 0) / stockResults.length) * 100) / 100
        : 0;
    } else {
      totalGainINR = totalCurrentValINR - totalStartValINR;
      totalReturnPct = totalStartValINR > 0 ? Math.round((totalGainINR / totalStartValINR) * 10000) / 100 : 0;
    }

    res.json({
      success: true,
      startDate: startDate || null,
      endDate: endDate || new Date().toISOString().split('T')[0],
      rangeType,
      marketScope,
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
