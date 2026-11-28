/**
 * actionPlanService.js — Canonical Next Market Day Action Plan Generator
 *
 * Consolidates live Buy Analysis signals (Strong Buys + Prime Buys) and
 * Sell Analysis triggers (Full Exits + Defensive Trims) into a single,
 * clear, execution-ready plan for the user's next trading session.
 *
 * Incorporates Capital Budgeting, External Infusions & Scaled Deployments:
 *   1. Recycled Capital from Natural Exits/Trims (strictly performance decay, zero forced selling).
 *   2. External Cash Budget (user bank cash infusion, default ₹2,00,000, configurable and periodic).
 *   3. Total Purchasing Power = Recycled Capital + External Cash Budget.
 *   4. Uncapped Conviction Sizing (Prime ₹1L, Tier 2 ₹50k, Standard ₹35k, Scout ₹15k, +VCP, +Sector, +Pyramiding).
 *   5. Priority-Ranked Budget Deployment: Immediate Execution vs Queued for Next Periodic Infusion.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import db from '../../db.js';
import { loadHistoricalPricesAsync } from '../historicalPriceStore.js';
import { buildStockAnalyses, calculateTriggeredStagedSell, resolveCanonicalGttOrder } from './analysisService.js';
import { validateAndHealStockData } from './dataIntegrityValidator.js';
import { getTodayIST } from '../marketCalendar.js';
import { liveQuoteCache, resolveHoldingPrice } from '../priceEngine.js';
import { getIntelligenceConfig, pruneActiveStopLosses } from './repository.js';
import { resolveCanonicalSector } from './buyAnalysisService.js';
import { BUY_ANALYSIS_RULE_VERSION } from '../../routes/buyAnalysis.js';
import { calculateMarketOpportunity } from './marketOpportunityEngine.js';
import { resolveCanonicalBaseSymbol } from './symbolAliasService.js';

export function buildActionPlanCsv(plan = {}) {
  const rows = [[
    'Action',
    'Symbol',
    'Company',
    'Shares',
    'CMP (INR)',
    'Est. Amount (INR)',
    'GTT Stop-Loss (INR)',
    'What To Do'
  ]];

  for (const b of (plan.immediateBuys || [])) {
    const cmp = Number(b.cmp) || 0;
    const shares = Number(b.actionShares) || 0;
    const val = round2(b.actionValue || shares * cmp);
    const sl = b.isOwned
      ? round2(b.sl > 0 ? b.sl : cmp * 0.90)
      : round2(cmp > 0 ? cmp * 0.90 : b.sl);
    const weeklySl = round2(cmp * 0.92);
    const isTranche1 = String(b.actionType || '').includes('TRANCHE 1');
    const actionLabel = b.isOwned ? 'BUY (PYRAMID ADD)' : (isTranche1 ? 'BUY (50% TRANCHE 1)' : 'BUY (NEW)');
    const extTxt = b.extAbove30w ? ` (+${b.extAbove30w}% vs 30w-SMA)` : '';
    const whatToDo = b.isOwned
      ? `Add ${shares} shs to existing position; keep GTT SL at ₹${sl.toFixed(2)}.`
      : isTranche1
        ? `Buy ${shares} shs (50% Tranche 1${extTxt}; hold 50% for 50-EMA dip or +4% breakout); set GTT SL ₹${sl.toFixed(2)} (-10% flash / ₹${weeklySl.toFixed(2)} Fri).`
        : `Buy ${shares} shs; set GTT SL ₹${sl.toFixed(2)} (-10% flash / ₹${weeklySl.toFixed(2)} Fri).`;

    rows.push([
      actionLabel,
      b.symbol,
      b.name,
      shares,
      cmp.toFixed(2),
      val.toFixed(2),
      sl > 0 ? sl.toFixed(2) : '—',
      whatToDo
    ]);
  }

  for (const s of (plan.sells || [])) {
    const cmp = Number(s.cmp) || 0;
    const qty = Number(s.quantity) || 0;
    const val = round2(s.actionValue || qty * cmp);
    const actionLabel = s.isFullExit ? 'SELL (FULL EXIT)' : 'SELL (TRIM)';
    const whatToDo = `Sell ${qty} of ${s.heldShares || qty} shs (${s.category || 'Exit triggered'}); cancel broker GTT.`;
    rows.push([
      actionLabel,
      s.symbol,
      s.name,
      qty,
      cmp.toFixed(2),
      val.toFixed(2),
      'CANCEL GTT',
      whatToDo
    ]);
  }

  for (const a of (plan.stopLossActions || [])) {
    if (!a.isActionRequired) continue;
    const cmp = Number(a.cmp) || 0;
    const qty = Number(a.targetQty || a.qty) || 0;
    const val = round2(qty * cmp);
    const sl = round2(a.targetSlPrice);
    const isBreach = a.gttStatus === 'STOP_BREACHED_SELL_NOW';
    const isNew = a.gttStatus === 'ACTION_REQUIRED_NEW';
    const actionLabel = isBreach ? 'SELL NOW (SL BREACHED)' : (isNew ? 'SET GTT SL' : 'AMEND GTT SL');
    const whatToDo = isBreach
      ? `Exit ${qty} shs immediately (CMP ₹${cmp.toFixed(2)} <= SL ₹${sl.toFixed(2)}).`
      : (a.activeGttPrice > 0
          ? `Update broker GTT SL from ₹${Number(a.activeGttPrice).toFixed(2)} to ₹${sl.toFixed(2)} for ${qty} shs.`
          : `Place broker GTT SL at ₹${sl.toFixed(2)} for all ${qty} shs.`);
    rows.push([
      actionLabel,
      a.symbol,
      a.name,
      qty,
      cmp.toFixed(2),
      val.toFixed(2),
      sl.toFixed(2),
      whatToDo
    ]);
  }

  if (rows.length === 1) {
    rows.push(['NO ACTION', '—', 'Portfolio in sync', 0, '0.00', '0.00', '—', 'No buys, sells, or GTT updates required today.']);
  }

  return {
    rows,
    csv: rows.map(r => r.map(escapeCsvCell).join(',')).join('\r\n')
  };
}

function escapeCsvCell(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;


let cachedActionPlanBase = null;
let cachedActionPlanBaseKey = '';
let cachedActionPlanBaseTimestamp = 0;
const BASE_CACHE_TTL_MS = 15 * 60 * 1000;

export function invalidateActionPlanBaseCache() {
  cachedActionPlanBase = null;
  cachedActionPlanBaseKey = '';
  cachedActionPlanBaseTimestamp = 0;
}

export async function computeActionPlanBase({
  userId = '1',
  userConfig: paramUserConfig
} = {}) {
  const projectRoot = process.cwd();
  const userConfig = paramUserConfig || getIntelligenceConfig(userId);
  // 1. Load Buy Analyses from snapshot or seed gz archive
  let buyAnalyses = [];
  let snapshotVersionMismatch = false;
  const snapPath = path.join(projectRoot, 'data', 'buy_analysis_snapshot.json');
  const snapGzPath = path.join(projectRoot, 'data', 'buy_analysis_snapshot.json.gz');

  if (!fs.existsSync(snapPath) && fs.existsSync(snapGzPath)) {
    try {
      const unzipped = zlib.gunzipSync(fs.readFileSync(snapGzPath));
      fs.writeFileSync(snapPath, unzipped);
      console.log('[Action Plan] Restored buy_analysis_snapshot.json from seed gz archive.');
    } catch (e) {
      console.warn('[Action Plan] Seed snapshot unpack warning:', e.message);
    }
  }

  if (fs.existsSync(snapPath)) {
    try {
      const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      if (snap?.ruleVersion && snap.ruleVersion !== BUY_ANALYSIS_RULE_VERSION) {
        snapshotVersionMismatch = true;
      } else if (Array.isArray(snap.analyses) && snap.analyses.length > 0) {
        buyAnalyses = snap.analyses;
      }
    } catch (_) {}
  }

  // If snapshot is missing or outdated and not in cloud production, dynamically generate fresh buy analyses
  if ((buyAnalyses.length === 0 || snapshotVersionMismatch) && !process.env.RENDER) {
    try {
      const { runBuyAnalysisEngine } = await import('../../routes/buyAnalysis.js');
      const fresh = await runBuyAnalysisEngine({ forceRefresh: snapshotVersionMismatch });
      buyAnalyses = fresh.analyses || [];
    } catch (err) {
      console.warn('[Action Plan] Could not trigger dynamic buy analysis run:', err.message);
    }
  }

  // Hydrate live quote prices into buyAnalyses so candidate CMPs are never stale
  buyAnalyses = buyAnalyses.map(x => {
    const clean = String(x.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
    const quote = liveQuoteCache.get(x.symbol) || liveQuoteCache.get(clean) || liveQuoteCache.get(`${clean}.NS`) || liveQuoteCache.get(`${clean}.BO`);
    const livePrice = Number(quote?.price || quote?.nse_price || quote?.bse_price);
    if (Number.isFinite(livePrice) && livePrice > 0) {
      return { ...x, currentPrice: livePrice, cmp: livePrice };
    }
    return x;
  });

  // Compute Dynamic Sector Breadth & Group Momentum across universe (weighted by Bullish % + 6m Relative Strength)
  const sectorStats = {};
  buyAnalyses.forEach(x => {
    const s = resolveCanonicalSector(x.fundamentals, x.name, x.symbol) || x.sector || 'Diversified & Other';
    if (!sectorStats[s]) sectorStats[s] = { total: 0, bullish: 0, scores: [], rsSum: 0, rsCount: 0 };
    sectorStats[s].total++;
    if (['STRONG_BUY', 'BUY'].includes(x.buySignal)) sectorStats[s].bullish++;
    sectorStats[s].scores.push(x.compositeScore || 50);
    if (Number.isFinite(Number(x.rsScore))) {
      sectorStats[s].rsSum += Number(x.rsScore);
      sectorStats[s].rsCount++;
    }
  });
  for (const [, stat] of Object.entries(sectorStats)) {
    stat.bullishPct = Math.round((stat.bullish / stat.total) * 100);
    stat.avgScore = Math.round(stat.scores.reduce((a, b) => a + b, 0) / stat.scores.length);
    stat.avgRs = stat.rsCount > 0 ? stat.rsSum / stat.rsCount : 0;
    stat.momentumRank = stat.bullishPct * 0.5 + Math.max(0, stat.avgRs) * 1.2 + stat.avgScore * 0.2;
  }
  const rankedSectors = Object.entries(sectorStats)
    .filter(([, st]) => st.total >= 5)
    .sort((a, b) => b[1].momentumRank - a[1].momentumRank || b[1].bullishPct - a[1].bullishPct)
    .map(([s]) => s);
  const top3Sectors = rankedSectors.slice(0, 3);
  const topSectors = rankedSectors.slice(0, 5);

  // 1b. Nifty 500 Market Regime Gate
  // Evaluates whether the broader market (Nifty 500 covering ~96% of Indian equity market cap) is in Bull Expansion (above 50-EMA) or Correction Defensive (below 50-EMA)
  let marketRegime = {
    isBullRegime: true,
    regimeName: 'BULL_EXPANSION',
    indexName: 'Nifty 500',
    ticker: '^CRSLDX',
    latestClose: 0,
    ema50: 0,
    diffPct: 0,
    headline: 'NIFTY 500 BULL EXPANSION (Above 50-EMA)',
    description: 'Nifty 500 (96% of market cap) is trading above its 50-day EMA. Standard momentum breakouts and pyramid additions are fully operational.'
  };

  try {
    const indexHistoryPath = path.join(projectRoot, 'data', 'index_history.json');
    if (fs.existsSync(indexHistoryPath)) {
      const indexData = JSON.parse(fs.readFileSync(indexHistoryPath, 'utf8'));
      const closes = indexData.NIFTY_500?.closes || indexData.NIFTY_50?.closes || {};
      const dates = Object.keys(closes).sort();
      const n = dates.length;
      if (n >= 50) {
        const k50 = 2 / 51;
        let ema50 = 0;
        for (let i = 0; i < 50; i++) ema50 += closes[dates[i]];
        ema50 /= 50;
        for (let i = 50; i < n; i++) {
          ema50 = closes[dates[i]] * k50 + ema50 * (1 - k50);
        }
        const latestClose = closes[dates.at(-1)];
        const diffPct = round2(((latestClose - ema50) / ema50) * 100);
        const isBull = latestClose >= ema50;
        marketRegime = {
          isBullRegime: isBull,
          regimeName: isBull ? 'BULL_EXPANSION' : 'CORRECTION_DEFENSIVE',
          indexName: 'Nifty 500',
          ticker: '^CRSLDX',
          latestClose: round2(latestClose),
          ema50: round2(ema50),
          diffPct,
          headline: isBull
            ? `NIFTY 500 BULL EXPANSION (+${diffPct}% Above 50-EMA)`
            : `NIFTY 500 CORRECTION DEFENSIVE (${diffPct}% Below 50-EMA)`,
          description: isBull
            ? 'Nifty 500 (96% of total market cap) is trading above its 50-day EMA. Broad market breadth is healthy; full buy capacity and staged additions are operational.'
            : 'Nifty 500 is trading below its 50-day EMA. Standard buys are queued to protect dry powder; 25% pilot test tranches strictly reserved for elite leaders (MPS >= 90) to prevent choppy whipsaws.'
        };
      }
    }
  } catch (err) {
    console.warn('[Action Plan] Market regime calculation warning:', err.message);
  }

  // Filter institutional quality: strictly exclude penny stocks (< ₹20), microcaps (< ₹1000 Cr hard floor, < ₹2,500 Cr institutional floor unless MPS >= 90 or IPO), and AVOID signals
  const minMcapFloor = Number(userConfig?.minMarketCapCr ?? 2500);
  const isInstitutionalQuality = (x) => {
    const cmp = Number(x.currentPrice) || 0;
    const mcap = Number(x.marketCapCr) || 0;
    const mps = Number(x.mps ?? x.multibaggerProbabilityScore ?? x.compositeScore ?? 50);
    if (cmp < 20.00) return false;
    if (mcap > 0 && mcap < 1000) return false;
    if (mcap > 0 && mcap < minMcapFloor && mps < 90 && !x.isIpo) return false;
    if (x.buySignal === 'AVOID') return false;
    return true;
  };

  const strongBuys = buyAnalyses.filter(x => x.buySignal === 'STRONG_BUY' && isInstitutionalQuality(x));
  const qualifyingBuys = buyAnalyses.filter(x => x.buySignal === 'BUY' && isInstitutionalQuality(x));

  // 2. Load Portfolio Holdings and Evaluate Sell / Exit Analyses
  const [holdings, transactions, dividends, metadata, history] = await Promise.all([
    db.select('holdings'),
    db.select('transactions'),
    db.select('dividends'),
    db.select('asset_metadata'),
    loadHistoricalPricesAsync()
  ]);

  // Auto-prune any activeStopLosses for holdings that are liquidated (quantity <= 0 / status === 'REDEEMED') or no longer in portfolio
  const staleStopLossSymbols = Object.keys(userConfig?.activeStopLosses || {}).filter(sym => {
    const h = holdings.find(item => item.symbol === sym);
    return !h || Number(h.quantity) <= 0 || String(h.status || '').toUpperCase() === 'REDEEMED';
  });
  if (staleStopLossSymbols.length > 0) {
    for (const sym of staleStopLossSymbols) {
      delete userConfig.activeStopLosses[sym];
    }
    try {
      pruneActiveStopLosses(userId, staleStopLossSymbols);
    } catch (_) {}
  }

  // Filter for strictly active, non-redeemed holdings with quantity > 0
  const activeHoldings = holdings.filter(h => 
    Number(h.quantity) > 0 && 
    String(h.status || '').toUpperCase() !== 'REDEEMED'
  );

  const enrichedHoldings = activeHoldings.map(h => {
    const quote = liveQuoteCache.get(h.symbol);
    return {
      ...h,
      current_price: resolveHoldingPrice(h, quote),
      nse_price: Number(quote?.nse_price) || Number(h.nse_price) || 0,
      bse_price: Number(quote?.bse_price) || Number(h.bse_price) || 0
    };
  });

  const { healedPriceMap } = validateAndHealStockData(enrichedHoldings, history, transactions);

  const cacheDir = path.join(projectRoot, 'data', 'screener_cache');
  const fundamentalsMap = {};
  if (fs.existsSync(cacheDir)) {
    try {
      const files = fs.readdirSync(cacheDir);
      for (const f of files) {
        if (f.endsWith('.json')) {
          const sym = f.slice(0, -5).toUpperCase();
          try { fundamentalsMap[sym] = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8')); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  let candleCache = {};
  const candleCachePath = path.join(projectRoot, 'data', 'daily_candles_cache.json');
  if (fs.existsSync(candleCachePath)) {
    try { candleCache = JSON.parse(fs.readFileSync(candleCachePath, 'utf8')); } catch (_) {}
  }

  const heldAnalyses = buildStockAnalyses(enrichedHoldings, healedPriceMap, {
    today: getTodayIST(),
    backtest: { version: '30w-confirmed-breakdown-v1' },
    config: userConfig,
    transactions,
    dividends,
    metadata,
    fundamentalsMap,
    categoryId: 'in_stocks',
    candleCache
  });

  const fullExits = heldAnalyses.filter(a => a.state === 'FULL_EXIT_CANDIDATE' && a.action !== 'ACCUMULATION_RETEST');
  const trims = heldAnalyses.filter(a =>
    (a.state === 'TECHNICAL_TRIM_CANDIDATE' || a.state === 'FUNDAMENTAL_TRIM_CANDIDATE') &&
    a.action !== 'ACCUMULATION_RETEST' &&
    a.action !== 'HOLD' &&
    (Number(a.suggestedSellQuantity) > 0 || calculateTriggeredStagedSell(a).quantity > 0)
  );

  // Chandelier-breach sells: stocks where live CMP has broken below their chandelier stop floor.
  // Only positions that are genuinely marked for trim/exit (not compounding-protected winners or already completed tranches) are included.
  const chandelierBreachSells = heldAnalyses.filter(a =>
    a.stopFloorBreached &&
    a.action !== 'ACCUMULATION_RETEST' &&
    a.action !== 'HOLD' &&
    (a.action === 'REVIEW_PARTIAL_SALE' || a.action === 'SELL_ALL' || a.state === 'TECHNICAL_TRIM_CANDIDATE') &&
    (a.state !== 'DATA_UNAVAILABLE' || a.isIpo) &&
    (Number(a.suggestedSellQuantity) > 0 || calculateTriggeredStagedSell(a).quantity > 0) &&
    !fullExits.some(f => f.holdingId === a.holdingId)
  );
  const regularTrims = trims.filter(a => !a.stopFloorBreached);

  const fullExitProceeds = fullExits.reduce((acc, a) => acc + (Number(a.quantity || 0) * (Number(a.currentPrice) || 0)), 0);
  const trimProceeds = regularTrims.reduce((acc, a) => {
    const qty = Number(a.suggestedSellQuantity) || 0;
    return acc + (qty * (Number(a.currentPrice) || 0));
  }, 0);
  const chandelierBreachProceeds = chandelierBreachSells.reduce((acc, a) => {
    const triggered = calculateTriggeredStagedSell(a);
    const trimQty = triggered.quantity > 0 ? triggered.quantity : (Number(a.suggestedSellQuantity) || 0);
    return acc + (trimQty * (Number(a.currentPrice) || 0));
  }, 0);

  // 2b. Recycled Capital Architecture:
  // Base Recycled Capital = ₹45 Lakhs (configurable via userConfig.baseRecycledCapital).
  // Dynamic Real-Time Update: Any buy or sell transactions on Indian stocks executed on or after baseline date update this field dynamically.
  const baseRecycledCapital = Number(userConfig?.baseRecycledCapital ?? 4500000);
  const baselineDate = userConfig?.recycledCapitalBaselineDate || '2026-10-31';

  let totalRealizedExitProceeds = 0;
  let totalDeployedBuys = 0;

  for (const tx of (transactions || [])) {
    if (tx.date && tx.date >= baselineDate) {
      const type = String(tx.type || tx.transaction_type || '').toUpperCase();
      const sym = String(tx.symbol || '');
      // Exclude bank/debt ledger transfers
      if (sym.includes('-SAVINGS') || sym.includes('-EPF') || sym.includes('-LOAN') || sym.includes('-CC')) continue;
      const isIndianStock = !sym.includes('.') && !sym.includes('-');
      if (!isIndianStock) continue;

      const amt = Number(tx.total_amount) || (Number(tx.quantity || 0) * Number(tx.price || 0)) || 0;
      if (['SELL', 'REDEEM', 'REDEMPTION'].includes(type)) {
        totalRealizedExitProceeds += amt;
      } else if (['BUY', 'INVESTMENT'].includes(type) && !String(tx.notes || '').includes('SIP')) {
        totalDeployedBuys += amt;
      }
    }
  }

  // Realized Recycled Capital = Base (₹45 Lakhs) + Indian Stock Sells - Indian Stock Buys executed going forward
  const netTransactionCashDelta = totalRealizedExitProceeds - totalDeployedBuys;
  const realizedRecycledCapital = Math.max(0, baseRecycledCapital + netTransactionCashDelta);


  // Dynamic Portfolio Weight Cap calculation based on total Indian equity valuation
  const totalIndianEquityValuation = enrichedHoldings
    .filter(h => h.category_id === 'in_stocks' || (!h.category_id && !String(h.symbol).includes('.')))
    .reduce((acc, h) => acc + (Number(h.quantity || 0) * Number(h.current_price || 0)), 0) || 4600000;

  const configuredWeight = Number(userConfig?.maxPositionWeightPct);
  const targetWeightPct = (Number.isFinite(configuredWeight) && configuredWeight > 0) ? configuredWeight : 15.0;

  // Dynamic Conviction-Weighted Allocation Calculator (Concentrated Bulk + Winner Pyramiding)
  function calculateDynamicConvictionAllocation(item, isOwned, heldQty, holdingObj) {
    const stance = item.executiveStrategy?.stance || 'PRIME_SETUP';
    const cmp = Number(item.currentPrice) || 0;
    const sl = item.executiveStrategy?.riskAndExit?.stopLoss || item.stopLoss || 0;
    const composite = item.compositeScore || 50;
    const tags = Array.isArray(item.qualitativeTags) ? item.qualitativeTags : [];
    const isTurnaround = tags.some(t => t.tag === 'TURNAROUND_CATALYST');

    const isPreEarnings = stance === 'PRE_EARNINGS';

    const mcap = Number(item.marketCapCr) || 0;
    const mps = Number(item.mps ?? item.multibaggerProbabilityScore ?? item.compositeScore ?? composite);
    if (cmp < 20 || (mcap > 0 && mcap < 1000) || (mcap > 0 && mcap < minMcapFloor && mps < 70 && !item.isIpo)) {
      return {
        alloc: 0,
        tierLabel: 'Sub-Institutional Microcap (₹0)',
        factors: [`Market Cap < ₹${mcap < 1000 ? '1,000' : '2,500'} Cr (₹${mcap} Cr) or Price < ₹20`],
        summary: `AVOID (₹0): Market Cap ₹${mcap} Cr < ₹${mcap < 1000 ? '1,000' : '2,500'} Cr or CMP ₹${cmp} < ₹20.`
      };
    }

    const isPrime = (mps >= 80) || isTurnaround;
    const isTier2 = (mps >= 70 || item.buySignal === 'STRONG_BUY');
    const isStd = (mps >= 60 || item.buySignal === 'BUY');

    // Dynamic Concentrated Caps (15% Prime / 11% Tier 2 / 8% Standard -> 15–18 core stocks)
    const primeCap = Math.max(200000, Math.round(totalIndianEquityValuation * (targetWeightPct / 100)));
    const tier2Cap = Math.max(150000, Math.round(totalIndianEquityValuation * ((targetWeightPct * 0.73) / 100)));
    const standardCap = Math.max(100000, Math.round(totalIndianEquityValuation * ((targetWeightPct * 0.53) / 100)));

    const maxPositionCap = isPrime ? primeCap : isTier2 ? tier2Cap : standardCap;
    const currentHeldValue = heldQty * cmp;
    const pctEma50 = Number(
      item.pctFromEma50 ??
      item.pctAboveEma50 ??
      item.executiveStrategy?.extAbove50e ??
      (item.ema50 > 0 && cmp > 0 ? ((cmp - item.ema50) / item.ema50) * 100 : 0)
    ) || 0;

    // Factor A: Institutional Base Compression & Volatility Contraction Pattern (VCP)
    const riskPct = cmp > 0 && sl > 0 ? Math.abs((cmp - sl) / cmp * 100) : 10;
    const isVcp = riskPct <= 8.5 && Math.abs(item.pctFromHigh52w || 0) <= 14.0;
    const vcpBonus = isVcp ? Math.round(totalIndianEquityValuation * (isPrime ? 0.003 : 0.002)) : 0;

    // Factor B: Sector Breadth & Group Rank Momentum
    const isTopSector = topSectors.includes(item.sector);
    const sectorBonus = isTopSector ? Math.round(totalIndianEquityValuation * (isPrime ? 0.003 : 0.002)) : 0;

    // Sizing for Existing Portfolio Holdings (Pyramid Confirmed Winners toward 15% cap)
    if (isOwned && heldQty > 0) {
      const avgPrice = Number(holdingObj?.avg_buy_price || holdingObj?.average_buy_price || item.portfolioAvgPrice) || 0;
      const isInProfit = avgPrice > 0 && cmp > avgPrice;
      const gainNum = avgPrice > 0 ? ((cmp / avgPrice - 1) * 100) : 0;
      const gainPct = gainNum.toFixed(1);
      const heldWeightPct = totalIndianEquityValuation > 0 ? ((currentHeldValue / totalIndianEquityValuation) * 100).toFixed(1) : '0.0';

      if (currentHeldValue >= maxPositionCap) {
        return {
          alloc: 0,
          tierLabel: 'Position Cap Reached (Hold Core)',
          factors: [`${heldWeightPct}% weight (max ${(maxPositionCap / totalIndianEquityValuation * 100).toFixed(0)}%)`],
          summary: `HOLD CORE (${heldWeightPct}% weight, +${gainPct}%): Max winner cap reached.`
        };
      }

      if (!isInProfit || gainNum < 10) {
        return {
          alloc: 0,
          tierLabel: gainNum < 0 ? 'Loss Protection (No Averaging Down)' : 'Await +10% Cushion Before Add',
          factors: [`Current P&L ${gainPct}% (Pyramid requires >= +10% gain)`],
          summary: `HOLD (${gainPct}%): Pyramid additions strictly reserved for confirmed +10%+ winners.`
        };
      }

      if (pctEma50 > 18.0) {
        return {
          alloc: 0,
          tierLabel: 'Winner Extended (Await 50-EMA Pullback)',
          factors: [`+${pctEma50.toFixed(1)}% above 50-EMA`],
          summary: `HOLD (+${gainPct}%): Extended +${pctEma50.toFixed(1)}% above 50-EMA; add on pullback.`
        };
      }

      // Winner Pyramid Add-on: 4.0% (Prime) / 3.0% (Standard) scaling up to 15% cap
      const pyramidPct = isPrime ? 0.040 : 0.030;
      const pyramidTranche = Math.max(50000, Math.round(totalIndianEquityValuation * pyramidPct));
      const trancheTierLabel = `Winner Pyramid (${(pyramidPct * 100).toFixed(1)}% · ₹${Math.round(pyramidTranche/1000)}k)`;

      const trancheFactors = [trancheTierLabel];
      let trancheTotal = pyramidTranche + vcpBonus + sectorBonus;
      trancheFactors.push(`Scaling winner (+${gainPct}% gain, ${heldWeightPct}% -> ${targetWeightPct.toFixed(0)}% cap)`);

      const maxTranchePct = isPrime ? 0.050 : 0.040;
      const trancheCeiling = Math.max(100000, Math.round(totalIndianEquityValuation * maxTranchePct));
      const remainingHeadroom = Math.max(0, maxPositionCap - currentHeldValue);
      const finalTrancheAlloc = Math.min(trancheTotal, remainingHeadroom, trancheCeiling);

      return {
        alloc: Math.round(finalTrancheAlloc),
        tierLabel: trancheTierLabel,
        factors: trancheFactors,
        summary: `Winner Add (${heldQty} shs, +${gainPct}%): ${trancheFactors.join(' · ')}`
      };
    }

    // Dynamic Concentrated Bulk Starters for Brand-New Entries (15–18 Stock Strategy):
    // Prime (MPS >= 80): 8.0% Bulk Starter | Tier 2: 7.0% Bulk Starter | Standard: 5.0% Starter
    const baseValuation = totalIndianEquityValuation > 0 ? totalIndianEquityValuation : 1000000;
    const primeBase = Math.round(baseValuation * 0.080);
    const tier2Base = Math.round(baseValuation * 0.070);
    const stdBase = Math.round(baseValuation * 0.050);
    const preEarningsFactor = 0.40;

    // Guard 3: Nifty 500 Market Regime Gate — In a correction regime (Nifty 500 < 50-EMA),
    // throttle standard entries to protect dry powder and allocate 25% pilot tranches strictly for elite leaders (MPS >= 80)
    if (!marketRegime.isBullRegime && !isOwned) {
      if (isPrime || isTier2) {
        const pilotFactor = 0.25;
        const targetBase = isPrime ? primeBase : tier2Base;
        const pilotAlloc = Math.round(targetBase * pilotFactor);
        const tierLabel = `Regime-Gated Pilot Tranche (25% Starter, Nifty 500 < 50-EMA)`;
        const factors = [
          tierLabel,
          `Market Regime Defensive (Nifty 500 < 50-EMA at ₹${marketRegime.latestClose}) — 25% pilot entry to capture high-MPS (${mps}) momentum; 75% dry powder reserved for market confirmation`
        ];
        return {
          alloc: pilotAlloc,
          tierLabel,
          factors,
          summary: `REGIME-GATED PILOT (25% TRANCHE): Nifty 500 is below its 50-day EMA, but top-tier momentum (MPS ${mps}/100) justifies a 25% pilot position (₹${Math.round(pilotAlloc).toLocaleString('en-IN')}) at CMP ₹${cmp}. Keep 75% dry powder until broader market reclaims 50-EMA.`
        };
      }
      return {
        alloc: 0,
        tierLabel: 'Market Regime Gate (Nifty 500 < 50-EMA)',
        factors: [`Market Regime Defensive (Nifty 500 < 50-EMA at ₹${marketRegime.latestClose})`],
        summary: `STAND ASIDE (REGIME DEFENSIVE): Nifty 500 is below its 50-day EMA. Standard momentum entry paused to prevent choppy whipsaws; dry powder preserved.`
      };
    }

    const isExtendedRunner = stance === 'EXTENDED_RUNNER';
    const extendedFactor = isExtendedRunner ? 0.50 : 1.0;

    let base = isPreEarnings ? Math.round(stdBase * preEarningsFactor) : stdBase;
    let tierLabel = isPreEarnings ? `Pre-Earnings Scout Entry (₹${Math.round(base/1000)}k Staged)` : `Catalyst Scout Entry (₹${Math.round(base/1000)}k Base)`;

    if (isPrime) {
      base = isPreEarnings ? Math.round(primeBase * preEarningsFactor) : Math.round(primeBase * extendedFactor);
      tierLabel = isExtendedRunner && !isPreEarnings
        ? `Extended Tranche 1 (50% · ₹${Math.round(base/1000)}k)`
        : isTurnaround
          ? (isPreEarnings ? `Turnaround Pre-Earnings Tranche 1 (₹${Math.round(base/1000)}k Staged)` : `Turnaround Prime Setup (₹${Math.round(base/1000)}k Base)`)
          : (isPreEarnings ? `Prime Pre-Earnings Tranche 1 (₹${Math.round(base/1000)}k Staged)` : `Prime Ultra Conviction (₹${Math.round(base/1000)}k Base)`);
    } else if (isTier2) {
      base = isPreEarnings ? Math.round(tier2Base * preEarningsFactor) : Math.round(tier2Base * extendedFactor);
      tierLabel = isExtendedRunner && !isPreEarnings
        ? `Extended Tranche 1 (50% · ₹${Math.round(base/1000)}k)`
        : isPreEarnings ? `High Conviction Pre-Earnings Tranche 1 (₹${Math.round(base/1000)}k Staged)` : `High Conviction Setup (₹${Math.round(base/1000)}k Base)`;
    } else if (isStd) {
      base = isPreEarnings ? Math.round(stdBase * preEarningsFactor) : Math.round(stdBase * extendedFactor);
      tierLabel = isExtendedRunner && !isPreEarnings
        ? `Extended Tranche 1 (50% · ₹${Math.round(base/1000)}k)`
        : isPreEarnings ? `Standard Pre-Earnings Tranche 1 (₹${Math.round(base/1000)}k Staged)` : `Standard Momentum Setup (₹${Math.round(base/1000)}k Base)`;
    }

    const factors = [tierLabel];
    if (isPreEarnings) {
      factors.push('Pre-Earnings Staged Entry (Tranche 1: 40% initial allocation; 60% dry powder for post-earnings confirmation)');
    } else if (isExtendedRunner) {
      const extPct = item.executiveStrategy?.extAbove30w;
      factors.push(`50% Starter Tranche${extPct ? ` (+${extPct}% vs 30w-SMA)` : ''} · hold 50% for 50-EMA pullback or +4% breakout`);
    }
    const scaledVcp = isExtendedRunner && !isPreEarnings ? Math.round(vcpBonus * extendedFactor) : vcpBonus;
    const scaledSector = isExtendedRunner && !isPreEarnings ? Math.round(sectorBonus * extendedFactor) : sectorBonus;
    let total = base;

    if (scaledVcp > 0) {
      total += scaledVcp;
      factors.push(`VCP Base Compression (+₹${Math.round(scaledVcp/1000)}k)`);
    }

    if (scaledSector > 0) {
      total += scaledSector;
      factors.push(`Sector Tailwind [${item.sector}] (+₹${Math.round(scaledSector/1000)}k)`);
    }

    return {
      alloc: Math.min(total, maxPositionCap),
      tierLabel,
      factors,
      summary: factors.join(' + ')
    };
  }

  // Build set of all symbols flagged for sell, trim, or floor breach in Sell Analysis
  // Plus live 30-day post-sale cooling-off set from recent closed sells in transactions
  const sellSymbolSet = new Set();
  heldAnalyses.forEach(a => {
    if (['FULL_EXIT', 'REVIEW_PARTIAL_SALE', 'REVIEW_FUNDAMENTAL_TRIM', 'REVIEW_RISK_TRIM', 'MONITOR'].includes(a.action) ||
        ['FULL_EXIT_CANDIDATE', 'TECHNICAL_TRIM_CANDIDATE', 'FUNDAMENTAL_TRIM_CANDIDATE', 'PORTFOLIO_RISK_TRIM', 'WATCH'].includes(a.state) ||
        (a.action !== 'HOLD_AND_COMPOUND' && (Boolean(a.stopFloorBreached) || Boolean(a.has4RedBreakdown)))) {
      sellSymbolSet.add(resolveCanonicalBaseSymbol(a.symbol));
    }
  });
  const activeHeldSet = new Set(enrichedHoldings.map(h => resolveCanonicalBaseSymbol(h.symbol)));
  const todayMs = Date.parse(`${getTodayIST()}T00:00:00Z`);
  for (const tx of (transactions || [])) {
    const type = String(tx.type || tx.transaction_type || '').toUpperCase();
    if (!['SELL', 'REDEEM', 'REDEMPTION'].includes(type) || !tx.date) continue;
    const sym = resolveCanonicalBaseSymbol(tx.symbol);
    if (!sym || activeHeldSet.has(sym)) continue;
    const ageDays = Math.round((todayMs - Date.parse(`${tx.date}T00:00:00Z`)) / 86400000);
    if (ageDays >= 0 && ageDays <= 30) sellSymbolSet.add(sym);
  }

  // Deduplicate and pool candidate buys (strictly excluding any sell/trim flagged symbols)
  const seenSymbols = new Set();
  const allCandidatePool = [];

  strongBuys.forEach(x => {
    const sym = resolveCanonicalBaseSymbol(x.symbol);
    if (!seenSymbols.has(sym) && !sellSymbolSet.has(sym)) {
      seenSymbols.add(sym);
      allCandidatePool.push({ ...x, sourceSignal: 'STRONG_BUY' });
    }
  });

  qualifyingBuys.forEach(x => {
    const sym = resolveCanonicalBaseSymbol(x.symbol);
    if (!seenSymbols.has(sym) && !sellSymbolSet.has(sym)) {
      seenSymbols.add(sym);
      allCandidatePool.push({ ...x, sourceSignal: 'BUY' });
    }
  });

  // Evaluate each candidate
  const candidateEvaluations = allCandidatePool.map(x => {
    const cmp = Number(x.currentPrice) || 0;
    const tgt = x.executiveStrategy?.riskAndExit?.targetPrice || x.targetPrice || 0;
    const stance = x.executiveStrategy?.stance || 'PRIME_SETUP';
    const symNorm = resolveCanonicalBaseSymbol(x.symbol);
    const holdingObj = enrichedHoldings.find(h => resolveCanonicalBaseSymbol(h.symbol) === symNorm);
    const heldQty = Number(holdingObj?.quantity) || 0;
    const isOwned = heldQty > 0;
    const heldAnalysis = isOwned ? heldAnalyses.find(a => resolveCanonicalBaseSymbol(a.symbol) === symNorm) : null;
    const rawSl = x.executiveStrategy?.riskAndExit?.stopLoss || x.stopLoss || 0;
    // M6 Initial Stop Parity: Unproven fresh entries anchor 100% to -10% Flash Stop (-8% Friday Close);
    // Owned positions inherit canonical M6 trailing / 30w-SMA floor.
    const sl = isOwned
      ? round2(heldAnalysis?.stagedExitPlan?.tranche1?.triggerPrice || heldAnalysis?.sma30Week || rawSl || cmp * 0.90)
      : (cmp > 0 ? round2(cmp * 0.90) : round2(rawSl));
    const slPct = cmp > 0 && sl > 0 ? round2(((sl - cmp) / cmp) * 100) : -10.0;
    const avgPrice = Number(holdingObj?.avg_buy_price || holdingObj?.average_buy_price || x.portfolioAvgPrice) || 0;
    const isInProfit = isOwned && avgPrice > 0 && cmp > avgPrice;
    const composite = Number(x.compositeScore) || 50;
    const tags = Array.isArray(x.qualitativeTags) ? x.qualitativeTags : [];
    const isTurnaround = tags.some(t => t.tag === 'TURNAROUND_CATALYST');

    const mps = Number(x.mps ?? x.multibaggerProbabilityScore ?? x.compositeScore ?? composite);
    const isPrime = (mps >= 80) || isTurnaround;
    const sizing = calculateDynamicConvictionAllocation(x, isOwned, heldQty, holdingObj);
    const targetShares = sizing.alloc > 0 && cmp > 0
      ? (isOwned ? Math.max(1, Math.floor(sizing.alloc / cmp)) : Math.max(1, Math.round(sizing.alloc / cmp)))
      : 0;
    const targetAmount = targetShares * cmp;

    // Priority Rank Score (Balanced Multibagger Probability Engine):
    // Prevents existing positions or speculative turnarounds from blockading explosive MPS 95+ leaders.
    // 1. Elite Multibagger Breakouts (MPS >= 95) (+1000 pts)
    // 2. High-Conviction Proven Winners Pyramiding (MPS >= 85 & in profit) (+850 pts)
    // 3. High-Conviction Turnarounds (isTurnaround & MPS >= 80) (+800 pts)
    // 4. Fresh Ultra-Leader Breakouts (MPS >= 90) (+750 pts)
    // 5. Solid Winners Pyramiding (MPS >= 75 & in profit) (+650 pts)
    // 6. Fresh Prime Leaders (MPS >= 80) (+550 pts)
    // 7. Speculative Turnarounds (isTurnaround & MPS < 80) (+400 pts)
    // 8. Secondary Winner Pyramiding (in profit) (+350 pts)
    // 9. Strong Buy Fresh Breakouts (+300 pts)
    // 10. Base MPS (0-100 pts)
    let priorityRank = mps;
    if (mps >= 95) {
      priorityRank += 1000;
    } else if (isInProfit && mps >= 85) {
      priorityRank += 850;
    } else if (isTurnaround && mps >= 80) {
      priorityRank += 800;
    } else if (!isOwned && mps >= 90) {
      priorityRank += 750;
    } else if (isInProfit && mps >= 75) {
      priorityRank += 650;
    } else if (!isOwned && mps >= 80) {
      priorityRank += 550;
    } else if (isTurnaround) {
      priorityRank += 400;
    } else if (isInProfit) {
      priorityRank += 350;
    } else if (x.sourceSignal === 'STRONG_BUY') {
      priorityRank += 300;
    }

    const candSector = resolveCanonicalSector(x.fundamentals, x.name, x.symbol) || x.sector || 'Diversified & Other';
    if (top3Sectors.includes(candSector)) {
      priorityRank += 150;
    } else if (topSectors.includes(candSector)) {
      priorityRank += 75;
    }

    let actionType = isOwned ? 'BUY - ACCUMULATE (ADD TRANCHE)' : 'BUY - NEW POSITION';
    if (stance === 'PRE_EARNINGS') {
      actionType = isPrime ? 'BUY - PRE-EARNINGS PILOT TRANCHE (40%)' : 'STAND ASIDE (PRE-EARNINGS)';
    } else if (!isOwned && stance === 'EXTENDED_RUNNER') {
      actionType = 'BUY - TRANCHE 1 (50% - EXTENDED)';
    }
    if (isOwned && sizing.alloc <= 0) {
      if (sizing.tierLabel?.includes('Hold Core') || sizing.tierLabel?.includes('Cap Reached')) {
        actionType = 'HOLD CORE — MAXIMUM POSITION TARGET REACHED';
      } else if (stance === 'EXTENDED_RUNNER') {
        actionType = 'STAND ASIDE — EXTENDED (AWAIT PULLBACK)';
      }
    }

    return {
      symbol: x.symbol,
      name: x.name,
      cmp,
      sl,
      slPct,
      weeklySl: cmp > 0 ? round2(cmp * 0.92) : 0,
      extAbove30w: x.executiveStrategy?.extAbove30w ?? null,
      tgt,
      stance,
      sourceSignal: x.sourceSignal,
      isOwned,
      heldQty,
      avgPrice,
      isInProfit,
      composite,
      mps,
      normalizedRs: x.normalizedRs,
      rsScore: x.rsScore,
      isTurnaround,
      sizing,
      targetShares,
      targetAmount,
      priorityRank,
      actionType,
      ema50: Number(x.ema50) || 0,
      pctFromEma50: Number(x.pctFromEma50) || (x.ema50 > 0 ? ((cmp - x.ema50) / x.ema50) * 100 : 0),
      pctFromHigh52w: Number(x.pctFromHigh52w ?? x.pctFrom52wHigh) || 0,
      sector: resolveCanonicalSector(x.fundamentals, x.name, x.symbol) || x.sector || 'Diversified & Other',
      mcap: Number(x.marketCapCr) || 0,
      market_cap: x.market_cap || (Number(x.marketCapCr) >= 500000 ? 'Mega Cap' : Number(x.marketCapCr) >= 85000 ? 'Large Cap' : Number(x.marketCapCr) >= 27500 ? 'Mid Cap' : Number(x.marketCapCr) >= 5000 ? 'Small Cap' : 'Micro Cap'),
      market_cap_cr: Number(x.marketCapCr) || null
    };
  });

  // Sort candidates by priority rank descending
  candidateEvaluations.sort((a, b) => b.priorityRank - a.priorityRank);


  // 3. Process Algorithmic Sells
  const fullExitSells = [];
  fullExits.forEach(a => {
    const cmp = Number(a.currentPrice) || 0;
    const qty = Number(a.quantity) || 0;
    const amt = qty * cmp;
    const trigger = a.chandelierStopPrice || a.sma30Week || 0;

    fullExitSells.push({
      executionGroup: '2. ALGORITHMIC SELL (PERFORMANCE DECAY)',
      actionType: a.isIpo ? 'SELL - IPO CRASH CIRCUIT-BREAKER' : 'SELL - FULL EXIT',
      category: a.isIpo ? 'Full Exit (IPO Crash Circuit-Breaker)' : 'Full Exit (Structural Breakdown)',
      symbol: a.symbol,
      name: a.name,
      cmp,
      state: a.state,
      quantity: qty,
      actionValue: amt,
      triggerPrice: trigger,
      targetPrice: 0,
      heldShares: qty,
      tranche1Shares: a.tranche1Shares || a.stagedExitPlan?.tranche1?.targetShares || Math.round(qty * 0.33),
      tranche1Trigger: a.tranche1Trigger || a.stagedExitPlan?.tranche1?.triggerPrice || trigger,
      tranche1Status: a.stagedExitPlan?.tranche1?.status || 'READY',
      tranche2Shares: a.tranche2Shares || a.stagedExitPlan?.tranche2?.targetShares || (qty - Math.round(qty * 0.33)),
      tranche2Trigger: a.tranche2Trigger || a.stagedExitPlan?.tranche2?.triggerPrice || Number((trigger * 0.90).toFixed(2)),
      tranche2Status: a.stagedExitPlan?.tranche2?.status || 'READY',
      breachedTranchesSummary: 'All Stages Triggered (Full Thesis Liquidation)',
      reason: a.sizingMethod || `Full thesis liquidation: 100% of remaining position (${qty} shares) to protect capital against structural breakdown below 30W-SMA.`,
      isFullExit: true
    });
  });

  const regularTrimSells = [];
  regularTrims.forEach(a => {
      const cmp = Number(a.currentPrice) || 0;
      const held = Number(a.quantity) || 0;
      const trimQty = Number(a.suggestedSellQuantity) || 0;
      if (trimQty <= 0) return;
      const t1Status = a.stagedExitPlan?.tranche1?.status || 'READY';
      const t2Status = a.stagedExitPlan?.tranche2?.status || 'PENDING';
      if (t1Status === 'COMPLETED' && t2Status !== 'READY') return;

      const amt = trimQty * cmp;
      const trigger = a.stagedExitPlan?.tranche1?.triggerPrice || a.sma30Week || 0;
      const cat = a.isIpo
        ? 'Adaptive IPO Trim Candidate'
        : (a.state === 'TECHNICAL_TRIM_CANDIDATE' ? 'Technical Trim Candidate' : 'Fundamental Trim Candidate');
      const actionType = a.isIpo
        ? 'SELL - IPO DEFENSIVE TRIM'
        : (a.state === 'TECHNICAL_TRIM_CANDIDATE' ? 'SELL - TECHNICAL TRIM' : 'SELL - FUNDAMENTAL TRIM');

      regularTrimSells.push({
        executionGroup: '2. ALGORITHMIC SELL (PERFORMANCE DECAY)',
        actionType,
        category: cat,
        symbol: a.symbol,
        name: a.name,
        cmp,
        state: a.state,
        quantity: trimQty,
        actionValue: amt,
        triggerPrice: trigger,
        targetPrice: 0,
        heldShares: held,
        tranche1Shares: a.tranche1Shares || a.stagedExitPlan?.tranche1?.targetShares || trimQty,
        tranche1Trigger: a.tranche1Trigger || a.stagedExitPlan?.tranche1?.triggerPrice || trigger,
        tranche1Status: t1Status,
        tranche2Shares: a.tranche2Shares || a.stagedExitPlan?.tranche2?.targetShares || 0,
        tranche2Trigger: a.tranche2Trigger || a.stagedExitPlan?.tranche2?.triggerPrice || 0,
        tranche2Status: t2Status,
        breachedTranchesSummary: a.stagedExitPlan?.tranche1?.name || 'Tranche 1 Trim',
        reason: a.sizingMethod || `Tranche 1 defensive de-risk trim: Sell ${trimQty} shares; keep core ${held - trimQty} shares riding.`,
        isFullExit: false
      });
    });

  const chandelierBreachSellItems = [];
  chandelierBreachSells.forEach(a => {
    const cmp = Number(a.currentPrice) || 0;
    const held = Number(a.quantity) || 0;
    const stopFloor = Number(a.trailingFloorPrice || a.chandelierStopPrice) || 0;
    const breachPct = stopFloor > 0
      ? ((stopFloor - cmp) / stopFloor * 100).toFixed(1)
      : '—';
    const triggered = calculateTriggeredStagedSell(a);
    const trimQty = triggered.quantity > 0 ? triggered.quantity : (Number(a.suggestedSellQuantity) || 0);
    if (trimQty <= 0) return;
    const t1Status = a.stagedExitPlan?.tranche1?.status || 'PENDING';
    const t2Status = a.stagedExitPlan?.tranche2?.status || 'PENDING';
    if (t1Status === 'COMPLETED' && t2Status !== 'READY') return;

    const amt = trimQty * cmp;
    const triggeredNames = triggered.triggeredTranches.map(tranche => tranche.name);
    const stageDescription = triggeredNames.length > 1
      ? `Missed price levels crossed (${triggeredNames.join(' + ')}); aggregate catch-up quantity is ${trimQty} shares.`
      : `Trigger calls for ${trimQty} shares in ${triggeredNames[0] || (t2Status === 'READY' ? 'Tranche 2 (Structural Trend Breakdown)' : 'Tranche 1')}.`;
    const actionType = a.isIpo
      ? 'SELL - IPO STOP FLOOR BREACH'
      : (t2Status === 'READY'
        ? 'SELL - STRUCTURAL TREND BREAKDOWN'
        : (triggeredNames.length > 1
          ? `SELL - STAGED CATCH-UP (${triggeredNames.length} TRANCHES)`
          : 'SELL - STOP FLOOR BREACH'));

    chandelierBreachSellItems.push({
      executionGroup: '2. ALGORITHMIC SELL (PERFORMANCE DECAY)',
      actionType,
      category: a.isIpo ? 'Adaptive IPO Stop Floor Breach' : (t2Status === 'READY' ? 'Structural Trend Breakdown' : 'Trailing Stop Floor Breach'),
      symbol: a.symbol,
      name: a.name,
      cmp,
      state: a.state,
      quantity: trimQty,
      actionValue: amt,
      triggerPrice: t2Status === 'READY' ? (a.stagedExitPlan?.tranche2?.triggerPrice || stopFloor) : stopFloor,
      targetPrice: 0,
      heldShares: held,
      tranche1Shares: a.tranche1Shares || a.stagedExitPlan?.tranche1?.targetShares || 0,
      tranche1Trigger: a.tranche1Trigger || a.stagedExitPlan?.tranche1?.triggerPrice || 0,
      tranche1Status: t1Status,
      tranche2Shares: a.tranche2Shares || a.stagedExitPlan?.tranche2?.targetShares || 0,
      tranche2Trigger: a.tranche2Trigger || a.stagedExitPlan?.tranche2?.triggerPrice || 0,
      tranche2Status: t2Status,
      breachedTranchesSummary: triggeredNames.length > 0 ? triggeredNames.join(' + ') : (t2Status === 'READY' ? 'Tranche 2 (Structural Trend Breakdown)' : 'Tranche 1 (Stop Floor)'),
      reason: `Live CMP ₹${cmp.toFixed(2)} has breached trailing stop floor ₹${stopFloor.toFixed(2)} (${breachPct}% below stop). ${stageDescription} Review sale; no order placed automatically.`,
      isFullExit: t2Status === 'READY' && trimQty >= held,
      isChandelierBreach: true
    });
  });

  // 3b. Algorithmic Portfolio Pruning (Disciplined Deadwood Elimination)
  // Strictly protects Stage 2 winners, pilot entries, and multibaggers riding on house money.
  // ONLY prunes confirmed Stage 3/4 breakdowns below 30w-SMA or stagnant sub-50 MPS laggards in loss.
  const pruningSells = [];
  const enablePruning = userConfig?.enablePortfolioPruning ?? true;
  if (enablePruning) {
    heldAnalyses.forEach(a => {
      const cmp = Number(a.currentPrice) || 0;
      const qty = Number(a.quantity) || 0;
      const amt = qty * cmp;
      if (qty <= 0 || amt <= 0) return;
      // Skip if already flagged in exit or trim
      if (fullExitSells.some(s => s.symbol === a.symbol) || chandelierBreachSellItems.some(s => s.symbol === a.symbol) || regularTrimSells.some(s => s.symbol === a.symbol)) return;

      const sma30 = Number(a.sma30Week) || 0;
      const isBelow30wSma = sma30 > 0 && cmp < sma30;
      const isStage2 = (a.weinsteinStage === 2 || (sma30 > 0 && cmp >= sma30));
      const isInProfit = Number(a.pnlPct || 0) >= 0;
      const isCompoundingShield = a.compoundingShield?.active;

      // IRONCLAD CAPITAL PRESERVATION TENET:
      // NEVER prune a Stage 2 compounder, a profitable runner, or a healthy pilot entry just because position size is small (< ₹1 Lakh).
      // High-momentum pilot starters and post-trim runners riding on house money belong in the Core Portfolio to be PYRAMIDED (scaled up).
      if ((isStage2 || isInProfit || isCompoundingShield) && !isBelow30wSma && a.action !== 'SELL_ALL') {
        return; // Retained and protected in Core Focus Portfolio!
      }

      // M6 Respect: Never override M6 HOLD/WATCH with a mid-week daily dip below 30w-SMA
      const confirmedWeeklyBreak = Number(a.weeksBelowAverage || 0) >= 2;
      const isDormantLag = (a.compositeScore < 50 || a.mps < 50) && Number(a.pnlPct || 0) < -5.0 && a.weeklyClose > 0 && a.weeklyClose < sma30;
      const isBreakdown = (confirmedWeeklyBreak && isBelow30wSma) || (a.weinsteinStage === 4 && Number(a.pnlPct || 0) < 0 && confirmedWeeklyBreak) || a.action === 'SELL_ALL';

      if (isBreakdown || isDormantLag) {
        const reason = isBreakdown
          ? `Structural Breakdown Pruning: Price (₹${cmp.toFixed(2)}) is trading below 30-week SMA (₹${sma30.toFixed(2)}) in Stage ${a.weinsteinStage}. Liquidate 100% (${qty} shs) to cut losses and recycle capital into Stage 2 leaders.`
          : `Portfolio Deadwood Pruning: Stagnant laggard in loss (MPS ${a.compositeScore || 50}, ${a.pnlPct}% P&L). Liquidate 100% (${qty} shs) to eliminate portfolio drag.`;

        const pItem = {
          executionGroup: '2b. ALGORITHMIC PRUNING (ELIMINATE CONFIRMED DEADWOOD)',
          actionType: 'SELL - PORTFOLIO PRUNING',
          category: isBreakdown ? 'Structural Breakdown (< 30W-SMA)' : 'Dormant Laggard Pruning (MPS < 50)',
          symbol: a.symbol,
          name: a.name,
          cmp,
          state: a.state || 'PORTFOLIO_PRUNING',
          quantity: qty,
          actionValue: amt,
          triggerPrice: cmp,
          targetPrice: 0,
          heldShares: qty,
          tranche1Shares: qty,
          tranche1Trigger: cmp,
          tranche1Status: 'READY',
          tranche2Shares: 0,
          tranche2Trigger: 0,
          tranche2Status: 'N/A',
          breachedTranchesSummary: '100% Position Pruning',
          reason,
          isFullExit: true,
          isPruning: true
        };
        pruningSells.push(pItem);
      }
    });
  }

  // 3c. Core Focus Portfolio (20–25 Compounders Model)
  // Maps all retained non-pruned, non-exited active holdings with their current and target allocations
  const coreFocusHoldings = heldAnalyses
    .filter(a => Number(a.quantity) > 0 && !pruningSells.some(p => p.symbol === a.symbol) && !fullExitSells.some(s => s.symbol === a.symbol))
    .map(a => {
      const cmp = Number(a.currentPrice) || 0;
      const qty = Number(a.quantity) || 0;
      const val = qty * cmp;
      const mps = Number(a.mps ?? a.compositeScore ?? 50);
      const weightPct = totalIndianEquityValuation > 0 ? Number(((val / totalIndianEquityValuation) * 100).toFixed(2)) : 0;
      const targetAllocation = round2(totalIndianEquityValuation * 0.045);
      const sma30 = Number(a.sma30Week) || 0;
      // Dynamic pilot identification: Position is a pilot starter if below 35% of full 4.5% target allocation (or < 1.5% portfolio weight)
      const isPilotTranche = targetAllocation > 0 ? val < (targetAllocation * 0.35) : weightPct < 1.5;
      return {
        symbol: a.symbol,
        name: a.name,
        cmp,
        qty,
        val: round2(val),
        weightPct,
        targetWeightPct: 4.5,
        targetAllocation,
        headroom: round2(Math.max(0, targetAllocation - val)),
        mps,
        stage: a.weinsteinStage || 2,
        sma30: round2(sma30),
        pnlPct: Number((a.pnlPct || 0).toFixed(2)),
        sector: a.sector || 'Diversified',
        statusTag: isPilotTranche ? 'PILOT / POST-TRIM RUNNER (SCALE UP)' : (weightPct >= 4.0 ? 'CORE POSITION' : 'ACCUMULATION CANDIDATE')
      };
    })
    .sort((a, b) => b.mps - a.mps || b.val - a.val);

  // 3d. Stop Loss & GTT Execution Engine for Open Holdings
  // Determines exact GTT stop-loss trigger price for every held position:
  // - Tier 1: Fresh / Minor Gain (< +15% Gain) -> Hard -8.0% Initial Entry Protection
  // - Tier 2: Established Profit (+15% to +30% Gain) -> Breakeven Capital Lock (Entry + 1% statutory cushion)
  // - Tier 3: Strong Compounder (+30% to +50% Gain) -> Trailing 50-EMA / 30w-SMA (Lock >= +15% profit floor)
  // - Tier 4: Multibagger Runner (+50%+ Gain / Doubler) -> Trailing 50-EMA / 30w-SMA (Ride on House Money)
  const stopLossActions = heldAnalyses
    .filter(a => Number(a.quantity) > 0 && !pruningSells.some(p => p.symbol === a.symbol) && !fullExitSells.some(s => s.symbol === a.symbol))
    .map(a => resolveCanonicalGttOrder(a, userConfig?.activeStopLosses?.[a.symbol] || null))
    .sort((a, b) => {
      if (a.isActionRequired !== b.isActionRequired) return a.isActionRequired ? -1 : 1;
      if (b.slDelta !== a.slDelta) return b.slDelta - a.slDelta;
      return b.pnlPct - a.pnlPct;
    });


  return {
    candidateEvaluations,
    fullExitSells,
    regularTrimSells,
    chandelierBreachSellItems,
    pruningSells,
    coreFocusHoldings,
    stopLossActions,
    fullExitProceeds,
    trimProceeds,
    chandelierBreachProceeds,
    baseRecycledCapital,
    baselineDate,
    totalRealizedExitProceeds,
    totalDeployedBuys,
    realizedRecycledCapital,
    totalIndianEquityValuation,
    targetWeightPct,
    minMcapFloor,
    marketRegime,
    topSectors,
    enrichedHoldings,
    chandelierBreachSells
  };
}

export async function generateActionPlan({
  userId = '1',
  externalCashBudget: paramExternalCash,
  recyclingMode: paramRecyclingMode,
  maxDailyBuys: paramMaxDailyBuys,
  dailyDeploymentCap: paramDailyDeploymentCap,
  userConfig: paramUserConfig,
  forceRefresh = false
} = {}) {
  const projectRoot = process.cwd();
  const userConfig = paramUserConfig || getIntelligenceConfig(userId);
  const externalCashBudget = paramExternalCash !== undefined && paramExternalCash !== null
    ? Math.max(0, Math.round(Number(paramExternalCash)))
    : (userConfig.externalCashBudget ?? 200000);
  const periodicIncrement = userConfig.periodicIncrement ?? 200000;
  const recyclingMode = paramRecyclingMode || userConfig.recyclingMode || 'FULL_AND_TRIMS';

  const now = Date.now();
  let baseData = null;
  const baseCacheKey = `${userId}_${JSON.stringify(userConfig || {})}`;
  if (!forceRefresh && cachedActionPlanBase && cachedActionPlanBaseKey === baseCacheKey && (now - cachedActionPlanBaseTimestamp < BASE_CACHE_TTL_MS)) {
    baseData = cachedActionPlanBase;
  }
  if (!baseData) {
    baseData = await computeActionPlanBase({ userId, userConfig });
    cachedActionPlanBase = baseData;
    cachedActionPlanBaseKey = baseCacheKey;
    cachedActionPlanBaseTimestamp = Date.now();
  }

  const {
    candidateEvaluations,
    fullExitSells,
    regularTrimSells,
    chandelierBreachSellItems,
    pruningSells,
    coreFocusHoldings,
    stopLossActions,
    fullExitProceeds,
    trimProceeds,
    chandelierBreachProceeds,
    baseRecycledCapital,
    baselineDate,
    totalRealizedExitProceeds,
    totalDeployedBuys,
    realizedRecycledCapital,
    totalIndianEquityValuation,
    targetWeightPct,
    minMcapFloor,
    marketRegime,
    topSectors,
    enrichedHoldings,
    chandelierBreachSells
  } = baseData;

  let activeSells = [];
  if (recyclingMode === 'FULL_AND_TRIMS') {
    activeSells = [...fullExitSells, ...regularTrimSells, ...chandelierBreachSellItems, ...pruningSells];
  } else if (recyclingMode === 'FULL_ONLY') {
    activeSells = [...fullExitSells, ...chandelierBreachSellItems, ...pruningSells];
  } else {
    activeSells = [];
  }

  let projectedRecycledCapital = realizedRecycledCapital;
  if (recyclingMode === 'FULL_AND_TRIMS') {
    projectedRecycledCapital += (fullExitProceeds + trimProceeds + chandelierBreachProceeds);
  } else if (recyclingMode === 'FULL_ONLY') {
    projectedRecycledCapital += (fullExitProceeds + chandelierBreachProceeds);
  } else {
    projectedRecycledCapital = 0;
  }

  const recycledCapital = recyclingMode === 'EXTERNAL_ONLY' ? 0 : round2(realizedRecycledCapital);
  const totalPurchasingPower = round2(externalCashBudget + recycledCapital);

  // 2.5 Market Opportunity & Dynamic Execution Mode Engine
  const marketOpportunity = calculateMarketOpportunity({
    candidateEvaluations,
    enrichedHoldings,
    topSectors,
    totalPurchasingPower,
    config: userConfig?.marketOpportunityConfig
  });

  const isStrikeMode = marketOpportunity.isStrikeMode;

  // Dynamic Deployment Budget replaces arbitrary static ceilings unless explicitly overridden
  const effectiveDeploymentCap = paramDailyDeploymentCap !== undefined && paramDailyDeploymentCap !== null
    ? Math.max(0, Math.round(Number(paramDailyDeploymentCap)))
    : (isStrikeMode ? marketOpportunity.dynamicDeploymentBudget : (userConfig.dailyDeploymentCap ?? 350000));

  // In Opportunity Strike mode, buy capacity expands dynamically to fund ALL qualifying Prime compounders
  // In Staggered Accumulation mode, deployment is staged in measured daily batches (default: 5)
  const effectiveMaxDailyBuys = paramMaxDailyBuys !== undefined && paramMaxDailyBuys !== null
    ? Math.max(1, Math.min(50, Math.round(Number(paramMaxDailyBuys))))
    : (isStrikeMode ? 50 : (userConfig.maxDailyBuys ?? 5));

  // Sequential Budget Deployment Pass with Sector Concentration Guard & Dynamic Mode Execution
  let remainingCapital = totalPurchasingPower;
  let dailySpend = 0;
  const immediateBuys = [];
  const queuedBuys = [];
  const sectorSpendMap = {};
  const sectorCountMap = {};
  const maxSectorSpend = Math.max(150000, totalPurchasingPower * 0.50); // Max 50% of total purchasing power in one sector
  const maxSectorBuys = 5; // Max 5 immediate funded buys in the same sector on the same day

  candidateEvaluations.forEach(cand => {
    // Disqualified microcaps (< ₹1,000 Cr hard floor, < ₹2,500 Cr unless MPS >= 90 or IPO) and penny stocks (CMP < ₹20) are strictly excluded from all Action Plan buckets (never queued or exported in CSV)
    const isMicrocapOrPenny = cand.cmp < 20 || (cand.mcap > 0 && cand.mcap < 1000) || (cand.mcap > 0 && cand.mcap < minMcapFloor && cand.mps < 90 && !cand.isIpo) || cand.sizing?.tierLabel?.includes('Microcap');
    if (isMicrocapOrPenny) {
      return;
    }

    if (cand.targetAmount <= 0 || (cand.sizing && cand.sizing.alloc <= 0)) {
      const isCoreHold = cand.isOwned && (cand.sizing?.tierLabel?.includes('Hold Core') || cand.sizing?.tierLabel?.includes('Cap Reached'));
      const isExtendedHold = cand.isOwned && cand.stance === 'EXTENDED_RUNNER';
      const isLossHold = cand.isOwned && (cand.sizing?.tierLabel?.includes('Loss Protection') || cand.sizing?.summary?.includes('LOSS'));
      queuedBuys.push({
        ...cand,
        executionStatus: isCoreHold
          ? 'CORE HOLD (CAP REACHED)'
          : isExtendedHold
            ? 'STAND ASIDE (AWAIT PULLBACK)'
            : isLossHold
              ? 'STAND ASIDE (POSITION IN LOSS)'
              : 'STAND ASIDE (ZERO SIZING)',
        actionShares: 0,
        actionValue: 0,
        note: cand.sizing?.summary || 'Stand Aside (₹0 capital allocation). Await pullback or structural reset.'
      });
      return;
    }

    // Pre-Earnings Guard: Protect from binary quarterly earnings gap-down risk.
    // In Opportunity Strike mode: For exceptional leaders with confirmed top momentum (MPS >= 80), allow 40% initial starter tranche, leaving 60% dry powder for post-earnings confirmation so multibaggers are not missed.
    // Otherwise, queue candidates with imminent earnings to await post-results confirmation.
    if (cand.stance === 'PRE_EARNINGS') {
      const isEligiblePilot = isStrikeMode && cand.mps >= 80 && cand.sizing?.alloc > 0;
      if (!isEligiblePilot) {
        queuedBuys.push({
          ...cand,
          executionStatus: 'QUEUED (AWAITING EARNINGS CONFIRMATION)',
          actionShares: 0,
          actionValue: 0,
          note: `Pre-Earnings Gate: Breakout setup qualified (MPS ${cand.mps}). Imminent quarterly earnings release. Queued to protect against binary gap-down risk; ready for immediate deployment upon post-earnings confirmation.`
        });
        return;
      }
    }

    const effectiveTargetAmount = cand.targetAmount;
    const effectiveTargetShares = cand.targetShares;
    const effectiveAmount = effectiveTargetShares * cand.cmp;

    const candSector = cand.sector || 'Diversified';
    const currentSectorSpend = sectorSpendMap[candSector] || 0;
    const currentSectorCount = sectorCountMap[candSector] || 0;

    // Sector Concentration Guard: Prevent deploying >50% or >5 positions into the same sector on one day
    if (currentSectorCount >= maxSectorBuys || (currentSectorSpend + effectiveAmount > maxSectorSpend && currentSectorCount >= 1)) {
      queuedBuys.push({
        ...cand,
        executionStatus: 'QUEUED (SECTOR CONCENTRATION CAP)',
        actionShares: 0,
        actionValue: 0,
        note: `Sector Cap Reached: Already allocated ₹${Math.round(currentSectorSpend).toLocaleString('en-IN')} across ${currentSectorCount} position(s) in [${candSector}]. Queued to ensure cross-sector diversification.`
      });
      return;
    }

    // Dynamic Execution Mode & Capital Bandwidth Gate:
    // Opportunity Strike Mode: Allocates up to dynamicDeploymentBudget across all qualifying leaders (uncapped count).
    // Staggered Accumulation Mode: Limits to staged tranches (effectiveMaxDailyBuys and effectiveDeploymentCap).
    const withinDailyBandwidth = immediateBuys.length < effectiveMaxDailyBuys;
    const remainingDailyCap = Math.max(0, effectiveDeploymentCap - dailySpend);
    const availableBudget = immediateBuys.length === 0
      ? remainingCapital
      : Math.min(remainingCapital, remainingDailyCap);
    const canFundFull = withinDailyBandwidth && (effectiveAmount <= availableBudget);
    const canPartialScaleLeader = !canFundFull && withinDailyBandwidth
      && (cand.mps >= 85 || cand.sourceSignal === 'STRONG_BUY')
      && availableBudget >= Math.max(effectiveAmount * 0.45, 100000)
      && availableBudget >= cand.cmp;

    if (canFundFull || canPartialScaleLeader) {
      const fundedShares = canFundFull
        ? effectiveTargetShares
        : Math.max(1, Math.floor(availableBudget / cand.cmp));
      const fundedValue = fundedShares * cand.cmp;
      remainingCapital -= fundedValue;
      dailySpend += fundedValue;
      sectorSpendMap[candSector] = currentSectorSpend + fundedValue;
      sectorCountMap[candSector] = currentSectorCount + 1;
      const partialNote = !canFundFull
        ? ` [Scaled to available Strike budget ₹${Math.round(fundedValue / 1000)}k of ₹${Math.round(effectiveAmount / 1000)}k]`
        : '';
      immediateBuys.push({
        ...cand,
        executionStatus: 'FUNDED TODAY (IMMEDIATE EXECUTION)',
        actionShares: fundedShares,
        actionValue: fundedValue,
        note: (cand.isOwned
          ? `Add ${fundedShares} shs (holding ${cand.heldQty} shs): ${cand.sizing.summary}. GTT SL ₹${cand.sl.toFixed(2)}.`
          : cand.actionType?.includes('TRANCHE 1')
            ? `Buy ${fundedShares} shs (50% Tranche 1${cand.extAbove30w ? ` · +${cand.extAbove30w}% vs 30w-SMA` : ''}; hold 50% for 50-EMA pullback or +4% breakout). M6 GTT SL ₹${cand.sl.toFixed(2)} (-10% flash / ₹${cand.weeklySl?.toFixed(2) || (cand.cmp * 0.92).toFixed(2)} Fri), Target ₹${cand.tgt > 0 ? cand.tgt.toFixed(2) : '—'}.`
            : `Buy ${fundedShares} shs (${cand.sizing.tierLabel}). M6 GTT SL ₹${cand.sl.toFixed(2)} (-10% flash / ₹${cand.weeklySl?.toFixed(2) || (cand.cmp * 0.92).toFixed(2)} Fri), Target ₹${cand.tgt > 0 ? cand.tgt.toFixed(2) : '—'}.`) + partialNote
      });
    } else {
      const withinDailySpend = (dailySpend + effectiveAmount <= effectiveDeploymentCap) || (immediateBuys.length === 0);
      const isBudgetCap = !withinDailySpend || !withinDailyBandwidth;
      queuedBuys.push({
        ...cand,
        executionStatus: isBudgetCap
          ? (isStrikeMode ? 'QUEUED (OPPORTUNITY BUDGET REACHED)' : 'QUEUED (DAILY BANDWIDTH CAP - NEXT IN LINE)')
          : 'QUEUED FOR NEXT PERIODIC INFUSION',
        actionShares: cand.targetShares,
        actionValue: cand.targetAmount,
        note: isBudgetCap
          ? (isStrikeMode
              ? `Prime Setup Qualified (MPS ${cand.mps}): Dynamic Opportunity Strike budget limit reached (Allocated ₹${Math.round(dailySpend/1000)}k of ₹${Math.round(effectiveDeploymentCap/1000)}k dynamic budget). Next in line for immediate allocation.`
              : `Top-Tier Setup Qualified (MPS ${cand.mps}): Queued for next trading sessions to maintain disciplined daily staged execution (Max ${effectiveMaxDailyBuys} daily executions, ₹${Math.round(effectiveDeploymentCap/1000)}k daily deployment cap).`)
          : `Queued: Next candidate for execution upon next periodic capital injection (Target: ₹${cand.targetAmount.toFixed(2)}).`
      });
    }
  });


  // 4. Construct Clean Actionable Execution CSV (Zero No-Op Queued / Up-to-Date Bloat)
  const { rows, csv } = buildActionPlanCsv({
    immediateBuys,
    sells: activeSells,
    stopLossActions
  });
  const today = getTodayIST();
  const totalImmediateBuyValue = round2(immediateBuys.reduce((sum, b) => sum + b.actionValue, 0));
  const unallocatedCashBuffer = round2(Math.max(0, totalPurchasingPower - totalImmediateBuyValue));

  const summary = {
    today,
    totalIndianEquityValuation: round2(totalIndianEquityValuation),
    externalCashBudget: round2(externalCashBudget),
    periodicIncrement: round2(periodicIncrement),
    baseRecycledCapital: round2(baseRecycledCapital),
    dailyDeploymentCap: round2(effectiveDeploymentCap),
    maxDailyBuys: effectiveMaxDailyBuys,
    dailySpend: round2(dailySpend),
    recycledCapitalBaselineDate: baselineDate,
    recyclingMode,
    totalRealizedExitProceeds: round2(totalRealizedExitProceeds),
    totalDeployedBuys: round2(totalDeployedBuys),
    realizedRecycledCapital: round2(realizedRecycledCapital),
    projectedRecycledCapital: round2(projectedRecycledCapital),
    fullExitProceeds: round2(fullExitProceeds),
    trimProceeds: round2(trimProceeds),
    chandelierBreachProceeds: round2(chandelierBreachProceeds),
    recycledCapital: round2(recycledCapital),
    totalPurchasingPower: round2(totalPurchasingPower),
    totalImmediateBuyValue: round2(totalImmediateBuyValue),
    unallocatedCashBuffer: round2(unallocatedCashBuffer),
    immediateBuysCount: immediateBuys.length,
    queuedBuysCount: queuedBuys.length,
    sellsCount: activeSells.length,
    chandelierBreachCount: chandelierBreachSells.length,
    pruningCandidatesCount: pruningSells.length,
    pruningProceeds: round2(pruningSells.reduce((sum, p) => sum + p.actionValue, 0)),
    marketRegime,
    pruningSummary: {
      pruningCount: pruningSells.length,
      pruningProceeds: round2(pruningSells.reduce((sum, p) => sum + p.actionValue, 0)),
      targetPortfolioSize: '15–18 Core Leaders'
    },
    strategyRoadmap: {
      targetPortfolioCount: '15–18 Core Leaders',
      targetPositionWeight: `7.0%–8.0% Starter · ${targetWeightPct.toFixed(0)}% Max Cap`,
      activeCoreCount: coreFocusHoldings.length,
      totalHeldCount: enrichedHoldings.length,
      pruningCount: pruningSells.length,
      pruningProceeds: round2(pruningSells.reduce((sum, p) => sum + p.actionValue, 0)),
      marketRegime,
      minMarketCapFloorCr: minMcapFloor,
      hardStopLossPct: 10.0,
      holdingHorizonMonths: '12–24+ Months (2-Wk < 30w-SMA Exit)'
    },
    marketOpportunity: {
      moi: marketOpportunity.moi,
      deploymentMode: marketOpportunity.deploymentMode,
      isStrikeMode: marketOpportunity.isStrikeMode,
      dynamicDeploymentBudget: marketOpportunity.dynamicDeploymentBudget,
      deploymentBudgetRatio: marketOpportunity.deploymentBudgetRatio,
      headline: marketOpportunity.headline,
      description: marketOpportunity.description,
      trigger: marketOpportunity.trigger,
      componentScores: marketOpportunity.componentScores,
      componentDetails: marketOpportunity.componentDetails
    },
    stopLossSummary: {
      totalPositions: stopLossActions.length,
      actionRequiredCount: stopLossActions.filter(a => a.isActionRequired).length,
      newGttCount: stopLossActions.filter(a => a.gttStatus === 'ACTION_REQUIRED_NEW').length,
      amendGttCount: stopLossActions.filter(a => a.gttStatus === 'ACTION_REQUIRED_AMEND').length,
      upToDateCount: stopLossActions.filter(a => a.gttStatus === 'UP_TO_DATE').length,
      coreRunnersCount: stopLossActions.filter(a => a.actionType === 'AMEND_CORE_RUNNER').length,
      tranche1TrimsCount: stopLossActions.filter(a => a.actionType === 'SET_TRANCHE1_TRIM').length,
      breakevenLocksCount: stopLossActions.filter(a => a.actionType === 'AMEND_BREAKEVEN').length,
      trailingRunnersCount: stopLossActions.filter(a => a.actionType === 'AMEND_TRAILING' || a.actionType === 'AMEND_MULTIBAGGER' || a.actionType === 'AMEND_CORE_RUNNER').length,
      initialStopsCount: stopLossActions.filter(a => a.actionType === 'SET_INITIAL').length,
      nearStopCount: stopLossActions.filter(a => a.isNearSl).length
    }
  };

  return {
    today,
    summary,
    immediateBuys,
    queuedBuys,
    sells: activeSells,
    stopLossActions,
    coreFocusHoldings,
    pruningSells,
    allBuys: [...immediateBuys, ...queuedBuys],
    totalActions: rows.length - 1,
    rows,
    csv
  };
}
