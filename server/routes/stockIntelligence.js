import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import db from '../db.js';
import { authenticateToken } from '../middleware/auth.js';
import { getTodayIST } from '../services/marketCalendar.js';
import { loadHistoricalPricesAsync } from '../services/historicalPriceStore.js';
import { runWalkForwardBacktest } from '../services/stockIntelligence/backtestEngine.js';
import { buildPortfolioSummary, buildStockAnalyses } from '../services/stockIntelligence/analysisService.js';
import {
  deleteActiveStopLoss,
  getIntelligenceConfig,
  getStateHistory,
  recordStateTransitions,
  saveActiveStopLoss,
  saveBulkActiveStopLosses,
  saveIntelligenceConfig
} from '../services/stockIntelligence/repository.js';
import { fetchCompanyFundamentals, preloadAllHeldFundamentals } from '../services/stockIntelligence/screenerFundamentalsProvider.js';
import { loadAllCachedUsFundamentals } from '../services/stockIntelligence/usFundamentalsProvider.js';
import { logSyncEvent } from '../services/syncLogService.js';
import { liveQuoteCache, resolveHoldingPrice, refreshActiveHoldingsPrices } from '../services/priceEngine.js';
import { validateAndHealStockData } from '../services/stockIntelligence/dataIntegrityValidator.js';
import { generateActionPlan, invalidateActionPlanBaseCache, buildActionPlanCsv } from '../services/stockIntelligence/actionPlanService.js';
import { runBuyAnalysisEngine, invalidateBuyCache } from './buyAnalysis.js';

const router = express.Router();
const backtestCache = new Map();
let cachedOverview = null;
let cachedOverviewKey = '';
let cachedOverviewTimestamp = 0;
const OVERVIEW_TTL_MS = 15 * 60 * 1000; // 15 minutes fast in-memory cache
const OVERVIEW_SNAPSHOT_FILE = path.join(process.cwd(), 'data', 'stock_intelligence_overview.json');

const ACTION_PLAN_SNAPSHOT_FILE = path.join(process.cwd(), 'data', 'stock_intelligence_action_plan.json');
const ACTION_PLAN_TTL_MS = 15 * 60 * 1000; // 15 minutes fast in-memory cache
let cachedActionPlan = null;
let cachedActionPlanKey = '';
let cachedActionPlanTimestamp = 0;
const _actionPlanInFlightPromises = new Map();

function saveOverviewSnapshotToDisk(overview) {
  try {
    fs.writeFileSync(OVERVIEW_SNAPSHOT_FILE, JSON.stringify(overview), 'utf-8');
  } catch (err) {
    console.warn('[Stock Intelligence] Snapshot save warning:', err.message);
  }
}

function loadOverviewSnapshotFromDisk() {
  try {
    if (fs.existsSync(OVERVIEW_SNAPSHOT_FILE)) {
      const raw = fs.readFileSync(OVERVIEW_SNAPSHOT_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[Stock Intelligence] Snapshot read warning:', err.message);
  }
  return null;
}

function saveActionPlanSnapshotToDisk(plan) {
  try {
    const serialized = JSON.stringify(plan);
    fs.writeFileSync(ACTION_PLAN_SNAPSHOT_FILE, serialized, 'utf-8');
    fs.writeFileSync(`${ACTION_PLAN_SNAPSHOT_FILE}.gz`, zlib.gzipSync(serialized));
  } catch (err) {
    console.warn('[Stock Intelligence] Action plan snapshot save warning:', err.message);
  }
}

function loadActionPlanSnapshotFromDisk() {
  try {
    if (!fs.existsSync(ACTION_PLAN_SNAPSHOT_FILE)) {
      const gzPath = ACTION_PLAN_SNAPSHOT_FILE + '.gz';
      if (fs.existsSync(gzPath)) {
        const unzipped = zlib.gunzipSync(fs.readFileSync(gzPath));
        fs.writeFileSync(ACTION_PLAN_SNAPSHOT_FILE, unzipped);
        console.log('[Stock Intelligence] Restored action plan snapshot from seed gz archive.');
      }
    }
    if (fs.existsSync(ACTION_PLAN_SNAPSHOT_FILE)) {
      const raw = fs.readFileSync(ACTION_PLAN_SNAPSHOT_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[Stock Intelligence] Action plan snapshot read warning:', err.message);
  }
  return null;
}

function getUserKey(user) {
  return String(user?.email || user?.userId || user?.id || 'vijaypaij@gmail.com');
}

export function invalidateStockIntelligenceCache() {
  cachedOverview = null;
  cachedOverviewKey = '';
  cachedOverviewTimestamp = 0;
  cachedActionPlan = null;
  cachedActionPlanKey = '';
  cachedActionPlanTimestamp = 0;
  invalidateActionPlanBaseCache();
}

export async function warmStockIntelligenceCache() {
  try {
    // 1. Instant restore overview from disk snapshot (< 2ms, 0 CPU blocking)
    const diskSnapshot = loadOverviewSnapshotFromDisk();
    if (diskSnapshot && diskSnapshot.analyses && diskSnapshot.analyses.length > 0) {
      cachedOverview = diskSnapshot;
      cachedOverviewKey = 'vijaypaij@gmail.com';
      cachedOverviewTimestamp = Date.now();
      console.log(`[Stock Intelligence] Instantly restored stock intelligence overview from disk snapshot (${diskSnapshot.analyses.length} stocks, 0ms CPU wait).`);
    }

    // 2. Instant restore action plan from disk snapshot (< 2ms, 0 CPU blocking)
    const diskActionPlan = loadActionPlanSnapshotFromDisk();
    if (diskActionPlan && diskActionPlan.summary) {
      cachedActionPlan = diskActionPlan;
      cachedActionPlanKey = 'default_vijaypaij@gmail.com';
      cachedActionPlanTimestamp = Date.now();
      console.log(`[Stock Intelligence] Instantly restored action plan from disk snapshot (0ms CPU wait).`);
    }

    if (!cachedOverview) {
      // Fallback to background calculation if snapshot missing
      await computeStockOverview('vijaypaij@gmail.com');
      console.log('[Stock Intelligence] Pre-warmed stock intelligence overview cache.');
    }
  } catch (err) {
    console.warn('[Stock Intelligence] Warmup warning:', err.message);
  }
}

function getBacktest(priceMap, symbols) {
  if (!symbols || !symbols.length) {
    return { version: '30w-confirmed-breakdown-v1', activeEquities: 0, training: null, validation: null, holdout: null };
  }
  const key = symbols.map(symbol => {
    const clean = String(symbol).replace(/\.(NS|BO)$/i, '');
    const series = priceMap[symbol] || priceMap[clean] || priceMap[`${clean}.NS`] || priceMap[`${clean}.BO`] || {};
    const dates = Object.keys(series).sort();
    const latest = dates.at(-1);
    return `${symbol}:${dates.length}:${latest || ''}:${latest ? series[latest] : ''}`;
  }).join('|');
  if (!backtestCache.has(key)) {
    const res = runWalkForwardBacktest(priceMap, symbols);
    backtestCache.set(key, res);
  }
  return backtestCache.get(key);
}

/**
 * Loads all cached fundamentals from data/screener_cache/ into an in-memory map
 */
function loadAllCachedFundamentals(symbols = []) {
  const cacheDir = path.join(process.cwd(), 'data', 'screener_cache');
  const result = {};
  if (!fs.existsSync(cacheDir)) return result;

  for (const sym of symbols) {
    const clean = String(sym).replace(/\.(NS|BO)$/i, '').toUpperCase();
    const filePath = path.join(cacheDir, `${clean}.json`);
    if (fs.existsSync(filePath)) {
      try {
        result[clean] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        // ignore parse error
      }
    }
  }
  return result;
}

/**
 * Loads cached daily candles from data/daily_candles_cache.json
 */
function loadDailyCandlesCache() {
  const cacheFile = path.join(process.cwd(), 'data', 'daily_candles_cache.json');
  if (fs.existsSync(cacheFile)) {
    try {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch (_) {}
  }
  return {};
}

/**
 * Runs the daily Stock Analysis audit, records state transitions, and logs sync event
 */
export async function runDailyStockAnalysisAudit({ userId = '1', trigger = 'SCHEDULED' } = {}) {
  const startTime = Date.now();
  try {
    const [holdings, transactions, dividends, metadata, history] = await Promise.all([
      db.select('holdings'),
      db.select('transactions'),
      db.select('dividends'),
      db.select('asset_metadata'),
      loadHistoricalPricesAsync()
    ]);

    const active = holdings.filter(item => item.category_id === 'in_stocks' && Number(item.quantity) > 0);
    const symbols = [...new Set(active.map(item => item.symbol).filter(Boolean))];

    // Enrich holdings with live quotes or verified recent closes
    const enrichedHoldings = holdings.map(h => {
      if (h.category_id !== 'in_stocks') return h;
      const quote = liveQuoteCache?.get(h.symbol);
      const resolved = resolveHoldingPrice(h, quote);
      const clean = String(h.symbol).replace(/\.(NS|BO)$/i, '');
      const series = history[h.symbol] || history[clean] || history[`${clean}.NS`] || {};
      const dates = Object.keys(series).sort();
      const latestClose = dates.length > 0 ? series[dates[dates.length - 1]] : 0;
      const currentPrice = resolved > 0 ? resolved : (latestClose > 0 ? latestClose : Number(h.current_price) || 0);
      const nsePrice = (quote && quote.nse_price > 0) ? Number(quote.nse_price) : (Number(h.nse_price) || 0);
      const bsePrice = (quote && quote.bse_price > 0) ? Number(quote.bse_price) : (Number(h.bse_price) || 0);
      return {
        ...h,
        current_price: currentPrice,
        nse_price: nsePrice,
        bse_price: bsePrice
      };
    });

    // Run automated data integrity & anti-hallucination validation suite
    const { healedPriceMap, auditReport } = validateAndHealStockData(enrichedHoldings, history, transactions);

    const backtest = getBacktest(healedPriceMap, symbols);
    const config = getIntelligenceConfig(userId);

    // Load available cached fundamentals
    let fundamentalsMap = loadAllCachedFundamentals(symbols);
    const candleCache = loadDailyCandlesCache();

    // Evaluate analyses on validated data
    const analyses = buildStockAnalyses(enrichedHoldings, healedPriceMap, {
      today: getTodayIST(),
      backtest,
      config,
      transactions,
      dividends,
      metadata,
      fundamentalsMap,
      candleCache
    });

    // Record any state changes into persistent history
    const transitions = recordStateTransitions(userId, analyses);
    const summary = buildPortfolioSummary(analyses);

    // Keep overview & action plan disk snapshots synchronized on every EOD/boot audit
    try {
      const overviewSnapshot = {
        generatedAt: new Date().toISOString(),
        ruleVersion: backtest.version,
        summary,
        config,
        backtest,
        analyses,
        dataIntegrity: auditReport,
        executionSchedule: {
          scheduledDailyTime: '06:30 PM IST (Post-Market Close)',
          runEverySession: true,
          lastEvaluatedAt: new Date().toISOString()
        }
      };
      const reconciledOverview = await reconcileOverviewWithLiveHoldings(overviewSnapshot);
      const userKey = getUserKey({ userId });
      cachedOverview = reconciledOverview;
      cachedOverviewKey = userKey;
      cachedOverviewTimestamp = Date.now();
      saveOverviewSnapshotToDisk(reconciledOverview);

      const userConfig = getIntelligenceConfig(userKey);
      invalidateActionPlanBaseCache();
      const freshPlan = await generateActionPlan({
        userId: userKey,
        externalCashBudget: userConfig.externalCashBudget,
        recyclingMode: userConfig.recyclingMode,
        userConfig,
        forceRefresh: true
      });
      cachedActionPlan = freshPlan;
      cachedActionPlanKey = `${userKey}_${userConfig.externalCashBudget}_${userConfig.recyclingMode}_undefined_undefined`;
      cachedActionPlanTimestamp = Date.now();
      saveActionPlanSnapshotToDisk(freshPlan);
    } catch (snapErr) {
      console.warn('[Stock Analysis] Snapshot persistence warning:', snapErr.message);
    }

    logSyncEvent({
      jobType: 'STOCK_ANALYSIS_EOD',
      jobName: `Daily Stock Analysis Audit (${trigger})`,
      scheduledTime: '06:30 PM IST',
      runTime: new Date().toISOString(),
      status: 'SUCCESS',
      durationMs: Date.now() - startTime,
      details: `Evaluated ${analyses.length} active Indian equity holdings. ${summary.compoundingCount || 0} in Stage 2 Compounding, ${summary.states?.TECHNICAL_TRIM_CANDIDATE || 0} technical trim, ${summary.states?.WATCH || 0} on watch. Data integrity: ${auditReport.dataHealthScorePct}% (${auditReport.anomaliesDetected.length} anomalies). Recorded ${transitions.length} state transition(s).`,
      error: null
    });

    console.log(`[Stock Analysis] Daily audit completed (${analyses.length} stocks, ${transitions.length} state change(s)).`);
    return { summary, transitions, count: analyses.length, dataIntegrity: auditReport };
  } catch (error) {
    console.error('[Stock Analysis] Daily audit failed:', error.message);
    logSyncEvent({
      jobType: 'STOCK_ANALYSIS_EOD',
      jobName: `Daily Stock Analysis Audit (${trigger})`,
      scheduledTime: '06:30 PM IST',
      runTime: new Date().toISOString(),
      status: 'FAILED',
      durationMs: Date.now() - startTime,
      details: `Audit failed: ${error.message}`,
      error: error.message
    });
    return null;
  }
}

function reconcileAnalysisList(list = [], holdingMap = new Map()) {
  return list
    .filter(a => {
      const sym = String(a.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
      return holdingMap.has(sym);
    })
    .map(a => {
      const sym = String(a.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
      const h = holdingMap.get(sym);
      const quote = liveQuoteCache?.get(h.symbol);
      const curPrice = resolveHoldingPrice(h, quote) || a.currentPrice || Number(h.current_price) || 0;
      const qty = Number(h.quantity) || 0;
      const avgBuy = Number(h.avg_buy_price) || a.avgBuyPrice || 0;
      const invested = qty * avgBuy;
      const curVal = qty * curPrice;
      const unpnl = curVal - invested;
      const pnlPct = invested > 0 ? (unpnl / invested) * 100 : 0;

      // M6 Canonical Reconciliation:
      // Proven winners (>= +15%) follow confirmed Friday weekly closes (< 30w-SMA for 2 weeks), never intraday flips.
      // Unproven positions (< +15%) dynamically respond intraday to the hard -10% flash crash stop.
      const stopFloor = a.tranche1Trigger || a.trailingFloorPrice || a.chandelierStopPrice;
      const hasProfitCushion = Boolean(a.stagedExitPlan?.hasProfitCushion) || (avgBuy > 0 && pnlPct >= 15);
      let stopFloorBreached = a.stopFloorBreached;
      let tranche1Status = a.tranche1Status;
      let action = a.action;
      let state = a.state;
      let suggestedSellQuantity = a.suggestedSellQuantity;
      let stagedExitPlan = a.stagedExitPlan ? { ...a.stagedExitPlan } : a.stagedExitPlan;
      let liveBufferPct = a.liveBufferToTrailingFloorPct;

      if (stopFloor && curPrice > 0) {
        liveBufferPct = Number((((curPrice - stopFloor) / stopFloor) * 100).toFixed(2));
        if (hasProfitCushion) {
          stopFloorBreached = action === 'FULL_EXIT';
          if (stagedExitPlan?.tranche1) {
            stagedExitPlan = {
              ...stagedExitPlan,
              tranche1: { ...stagedExitPlan.tranche1, status: action === 'FULL_EXIT' ? 'READY' : 'PENDING' },
              totalActionShares: action === 'FULL_EXIT' ? qty : 0
            };
          }
          tranche1Status = action === 'FULL_EXIT' ? 'READY' : 'PENDING';
          suggestedSellQuantity = action === 'FULL_EXIT' ? qty : null;
        } else if (curPrice >= stopFloor) {
          stopFloorBreached = false;
          tranche1Status = 'PENDING';
          if (stagedExitPlan?.tranche1) {
            stagedExitPlan = {
              ...stagedExitPlan,
              tranche1: { ...stagedExitPlan.tranche1, status: 'PENDING' },
              totalActionShares: 0
            };
          }
          if (action === 'REVIEW_PARTIAL_SALE') {
            action = 'HOLD_AND_COMPOUND';
            if (state === 'TECHNICAL_TRIM_CANDIDATE') state = 'NORMAL';
            suggestedSellQuantity = null;
          }
        } else {
          stopFloorBreached = true;
          tranche1Status = 'READY';
          if (stagedExitPlan?.tranche1) {
            stagedExitPlan = {
              ...stagedExitPlan,
              tranche1: { ...stagedExitPlan.tranche1, status: 'READY' },
              totalActionShares: qty
            };
          }
          state = 'FULL_EXIT_CANDIDATE';
          action = 'FULL_EXIT';
          suggestedSellQuantity = qty;
        }
      }

      return {
        ...a,
        holdingId: h.id,
        quantity: qty,
        avgBuyPrice: avgBuy,
        currentPrice: curPrice,
        investedValue: Math.round(invested * 100) / 100,
        currentValue: Math.round(curVal * 100) / 100,
        unrealizedPnL: Math.round(unpnl * 100) / 100,
        pnlPct: Math.round(pnlPct * 100) / 100,
        stopFloorBreached,
        tranche1Status,
        action,
        state,
        suggestedSellQuantity,
        stagedExitPlan,
        liveBufferToTrailingFloorPct: liveBufferPct
      };
    });
}

async function reconcileOverviewWithLiveHoldings(overview) {
  if (!overview) return overview;
  try {
    const currentHoldings = await db.select('holdings');
    if (!Array.isArray(currentHoldings) || currentHoldings.length === 0) return overview;

    const inMap = new Map();
    const usMap = new Map();

    for (const h of currentHoldings) {
      const qty = Number(h.quantity) || 0;
      const isRedeemed = String(h.status || '').toUpperCase() === 'REDEEMED' || qty <= 0;
      if (isRedeemed) continue;

      const sym = String(h.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
      if (h.category_id === 'in_stocks') {
        inMap.set(sym, h);
      } else if (h.category_id === 'us_stocks') {
        usMap.set(sym, h);
      }
    }

    const reconciledAnalyses = reconcileAnalysisList(overview.analyses || [], inMap);
    const reconciledUsAnalyses = reconcileAnalysisList(overview.usAnalyses || [], usMap);

    return {
      ...overview,
      analyses: reconciledAnalyses,
      usAnalyses: reconciledUsAnalyses,
      summary: buildPortfolioSummary(reconciledAnalyses),
      usSummary: buildPortfolioSummary(reconciledUsAnalyses)
    };
  } catch (err) {
    console.warn('[Stock Intelligence] Live reconciliation warning:', err.message);
    return overview;
  }
}

async function reconcileActionPlanWithLiveHoldings(plan) {
  if (!plan) return plan;
  try {
    const [currentHoldings, transactions] = await Promise.all([
      db.select('holdings'),
      db.select('transactions')
    ]);
    if (!Array.isArray(currentHoldings) || currentHoldings.length === 0) return plan;

    const holdingMap = new Map();
    for (const h of currentHoldings) {
      const sym = String(h.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
      holdingMap.set(sym, h);
    }

    // 1. Reconcile sells: strictly exclude redeemed or 0-quantity holdings and clamp sell quantities
    const reconciledSells = [];
    for (const s of (plan.sells || [])) {
      const sym = String(s.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
      const h = holdingMap.get(sym);
      if (!h) continue;
      const qty = Number(h.quantity) || 0;
      const isRedeemed = String(h.status || '').toUpperCase() === 'REDEEMED' || qty <= 0;
      if (isRedeemed) continue;

      let actionQty = Number(s.quantity) || 0;
      let heldShares = Number(s.heldShares) || qty;
      if (heldShares > qty) heldShares = qty;
      if (actionQty > qty || s.isFullExit || s.isPruning) {
        actionQty = qty;
      }

      const quote = liveQuoteCache?.get(h.symbol);
      const cmp = resolveHoldingPrice(h, quote) || s.cmp || Number(h.current_price) || 0;

      // Real-time market price verification:
      // If a sell was suggested due to a stop floor / trailing stop breach,
      // and live market price (cmp) is at or above the stop trigger price,
      // the stop has NOT been breached in real-time. Dynamically exclude from sells.
      const stopTrigger = s.triggerPrice || s.tranche1Trigger;
      if (stopTrigger && (s.category === 'Trailing Stop Floor Breach' || s.isChandelierBreach || s.actionType?.includes('STOP FLOOR'))) {
        if (cmp >= stopTrigger) {
          continue; // Safe! Live CMP is above the stop floor.
        }
      }

      const actionValue = Math.round(actionQty * cmp * 100) / 100;

      let reason = s.reason;
      if (reason && typeof reason === 'string') {
        reason = reason.replace(/\(\d+\s*shs?\)/i, `(${actionQty} shs)`);
      }

      reconciledSells.push({
        ...s,
        quantity: actionQty,
        heldShares,
        cmp,
        actionValue,
        reason
      });
    }

    // 2. Reconcile stopLossActions with live prices & breach flags
    const reconciledStopLoss = (plan.stopLossActions || []).reduce((acc, sl) => {
      const sym = String(sl.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
      const h = holdingMap.get(sym);
      if (!h) return acc;
      const qty = Number(h.quantity) || 0;
      if (String(h.status || '').toUpperCase() === 'REDEEMED' || qty <= 0) return acc;
      const quote = liveQuoteCache?.get(h.symbol);
      const cmp = resolveHoldingPrice(h, quote) || sl.cmp || Number(h.current_price) || 0;
      const avg = Number(h.avg_buy_price) || sl.avgBuyPrice || cmp;
      const targetSlPrice = Number(sl.targetSlPrice) || 0;
      const isBreached = sl.tier === 'INITIAL_10PCT'
        ? (cmp > 0 && targetSlPrice > 0 && cmp <= targetSlPrice)
        : Boolean(sl.isBreached && cmp > 0 && targetSlPrice > 0 && cmp <= targetSlPrice);
      const distanceToSlPct = cmp > 0 && targetSlPrice > 0 ? Number((((cmp - targetSlPrice) / cmp) * 100).toFixed(2)) : 0;
      const pnlPct = avg > 0 && cmp > 0 ? Number((((cmp - avg) / avg) * 100).toFixed(2)) : sl.pnlPct;

      acc.push({
        ...sl,
        qty,
        cmp,
        avgBuyPrice: Math.round(avg * 100) / 100,
        val: Math.round(qty * cmp * 100) / 100,
        pnlPct,
        distanceToSlPct,
        slBufferPct: distanceToSlPct,
        isBreached,
        isNearSl: isBreached || (distanceToSlPct <= 3.0 && distanceToSlPct >= 0),
        gttStatus: isBreached ? 'STOP_BREACHED_SELL_NOW' : sl.gttStatus,
        gttStatusLabel: isBreached ? 'STOP BREACHED — SELL NOW' : sl.gttStatusLabel,
        gttStatusBadge: isBreached ? 'rose' : sl.gttStatusBadge,
        isActionRequired: isBreached ? true : sl.isActionRequired
      });
      return acc;
    }, []);

    // 2b. Reconcile immediateBuys with live quote prices, exclusion of active sells & 30-day exits
    const sellSymSet = new Set(reconciledSells.map(s => String(s.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase()));
    const todayMs = Date.parse(`${getTodayIST()}T00:00:00Z`);
    const coolingSet = new Set();
    for (const tx of (transactions || [])) {
      const tType = String(tx.type || tx.transaction_type || '').toUpperCase();
      if (!['SELL', 'REDEEM', 'REDEMPTION'].includes(tType) || !tx.date) continue;
      const sym = String(tx.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
      const h = holdingMap.get(sym);
      const isOpen = h && Number(h.quantity) > 0 && String(h.status || '').toUpperCase() !== 'REDEEMED';
      if (isOpen) continue;
      const ageDays = Math.round((todayMs - Date.parse(`${tx.date}T00:00:00Z`)) / 86400000);
      if (ageDays >= 0 && ageDays <= 30) coolingSet.add(sym);
    }

    const reconciledBuys = (plan.immediateBuys || []).reduce((acc, b) => {
      const sym = String(b.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase();
      if (sellSymSet.has(sym) || coolingSet.has(sym)) return acc;
      const h = holdingMap.get(sym);
      const quote = liveQuoteCache?.get(b.symbol) || liveQuoteCache?.get(sym) || liveQuoteCache?.get(`${sym}.NS`);
      const liveQuotePrice = Number(quote?.price || quote?.nse_price || quote?.bse_price);
      const cmp = (Number.isFinite(liveQuotePrice) && liveQuotePrice > 0)
        ? liveQuotePrice
        : (h ? (resolveHoldingPrice(h, quote) || Number(b.cmp)) : Number(b.cmp)) || 0;
      const actionShares = Number(b.actionShares) || 0;
      const actionValue = Math.round(actionShares * cmp * 100) / 100;
      const isOwned = Boolean(h && Number(h.quantity) > 0 && String(h.status || '').toUpperCase() !== 'REDEEMED');
      const sl = isOwned ? (Number(b.sl) || Math.round(cmp * 90) / 100) : Math.round(cmp * 90) / 100;
      const weeklySl = Math.round(cmp * 92) / 100;
      const slPct = cmp > 0 && sl > 0 ? Math.round(((sl - cmp) / cmp) * 1000) / 10 : -10.0;
      acc.push({
        ...b,
        cmp,
        actionValue,
        sl,
        weeklySl,
        slPct,
        isOwned,
        heldQty: isOwned ? Number(h.quantity) : 0
      });
      return acc;
    }, []);

    // 3. Recalculate summary metrics without clobbering realized recycled capital pool
    const totalSellProceeds = reconciledSells.reduce((acc, s) => acc + (s.actionValue || 0), 0);
    const totalImmediateBuyValue = Math.round(reconciledBuys.reduce((acc, b) => acc + (b.actionValue || 0), 0) * 100) / 100;
    const validRecycledCapital = plan.summary?.recycledCapital !== undefined ? plan.summary.recycledCapital : 0;
    const validExternalCash = plan.summary?.externalCashBudget !== undefined ? plan.summary.externalCashBudget : 0;
    const totalPurchasingPower = Math.round((validExternalCash + validRecycledCapital) * 100) / 100;
    const summary = plan.summary ? {
      ...plan.summary,
      immediateBuysCount: reconciledBuys.length,
      totalImmediateBuyValue,
      dailySpend: totalImmediateBuyValue,
      unallocatedCashBuffer: Math.round(Math.max(0, totalPurchasingPower - totalImmediateBuyValue) * 100) / 100,
      totalSellsCount: reconciledSells.length,
      sellsProceeds: Math.round(totalSellProceeds * 100) / 100,
      recycledCapital: validRecycledCapital,
      totalPurchasingPower
    } : plan.summary;

    const { rows, csv } = buildActionPlanCsv({
      immediateBuys: reconciledBuys,
      sells: reconciledSells,
      stopLossActions: reconciledStopLoss
    });
    const totalActions = rows.length - 1;

    return {
      ...plan,
      immediateBuys: reconciledBuys,
      sells: reconciledSells,
      stopLossActions: reconciledStopLoss,
      summary,
      rows,
      csv,
      totalActions
    };
  } catch (err) {
    console.warn('[Stock Intelligence] Action plan reconcile warning:', err.message);
    return plan;
  }
}

export async function computeStockOverview(userId, { forceRefresh = false, includeBacktest = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && cachedOverview && cachedOverviewKey === userId && (now - cachedOverviewTimestamp < OVERVIEW_TTL_MS)) {
    return await reconcileOverviewWithLiveHoldings(cachedOverview);
  }

  const [holdings, transactions, dividends, metadata, history] = await Promise.all([
    db.select('holdings'),
    db.select('transactions'),
    db.select('dividends'),
    db.select('asset_metadata'),
    loadHistoricalPricesAsync()
  ]);
  const active = holdings.filter(item => item.category_id === 'in_stocks' && Number(item.quantity) > 0 && String(item.status || '').toUpperCase() !== 'REDEEMED');
  const symbols = [...new Set(active.map(item => item.symbol).filter(Boolean))];
  const activeUs = holdings.filter(item => item.category_id === 'us_stocks' && Number(item.quantity) > 0 && String(item.status || '').toUpperCase() !== 'REDEEMED');
  const usSymbols = [...new Set(activeUs.map(item => item.symbol).filter(Boolean))];
  const config = getIntelligenceConfig(userId);

  // Fast read from disk cache
  const fundamentalsMap = loadAllCachedFundamentals(symbols);
  const usFundamentalsMap = loadAllCachedUsFundamentals(usSymbols);

  // Enrich holdings with live quotes or verified recent closes
  const enrichedHoldings = holdings.map(h => {
    const isUs = h.category_id === 'us_stocks';
    const isIndian = h.category_id === 'in_stocks';
    if (!isIndian && !isUs) return h;

    const quote = liveQuoteCache?.get(h.symbol);
    const resolved = resolveHoldingPrice(h, quote);
    const clean = String(h.symbol).replace(/\.(NS|BO)$/i, '');
    const series = history[h.symbol] || history[clean] || history[`${clean}.NS`] || {};
    const dates = Object.keys(series).sort();
    const latestClose = dates.length > 0 ? series[dates[dates.length - 1]] : 0;
    const currentPrice = resolved > 0 ? resolved : (latestClose > 0 ? latestClose : Number(h.current_price) || 0);
    const nsePrice = (quote && quote.nse_price > 0) ? Number(quote.nse_price) : (Number(h.nse_price) || 0);
    const bsePrice = (quote && quote.bse_price > 0) ? Number(quote.bse_price) : (Number(h.bse_price) || 0);
    return {
      ...h,
      current_price: currentPrice,
      nse_price: nsePrice,
      bse_price: bsePrice
    };
  });

  // Run automated data integrity & anti-hallucination validation suite
  const { healedPriceMap, auditReport } = validateAndHealStockData(enrichedHoldings, history, transactions);

  // Backtest calculation is compute-heavy (simulates 14 years across all 82 stocks).
  // If client does not explicitly ask for includeBacktest, provide rule metadata to avoid blocking UI render.
  const backtest = includeBacktest
    ? getBacktest(healedPriceMap, symbols)
    : { version: '30w-confirmed-breakdown-v1', activeEquities: symbols.length };
  const usBacktest = includeBacktest
    ? getBacktest(healedPriceMap, usSymbols)
    : { version: '30w-confirmed-breakdown-v1', activeEquities: usSymbols.length };

  const candleCache = loadDailyCandlesCache();

  const analyses = buildStockAnalyses(enrichedHoldings, healedPriceMap, {
    today: getTodayIST(),
    backtest,
    config,
    transactions,
    dividends,
    metadata,
    fundamentalsMap,
    categoryId: 'in_stocks',
    candleCache
  });

  const usAnalyses = buildStockAnalyses(enrichedHoldings, healedPriceMap, {
    today: getTodayIST(),
    backtest: usBacktest,
    config,
    transactions,
    dividends,
    metadata,
    fundamentalsMap: usFundamentalsMap,
    categoryId: 'us_stocks',
    candleCache
  });

  recordStateTransitions(userId, [...analyses, ...usAnalyses]);

  const result = {
    generatedAt: new Date().toISOString(),
    ruleVersion: backtest.version,
    summary: buildPortfolioSummary(analyses),
    usSummary: buildPortfolioSummary(usAnalyses),
    config,
    backtest,
    analyses,
    usAnalyses,
    dataIntegrity: auditReport,
    executionSchedule: {
      scheduledDailyTime: '06:30 PM IST (Post-Market Close)',
      runEverySession: true,
      lastEvaluatedAt: new Date().toISOString()
    }
  };

  // Reconcile and synchronize with live holdings before saving and returning
  const reconciled = await reconcileOverviewWithLiveHoldings(result);

  // Cache the completed overview payload
  cachedOverview = reconciled;
  cachedOverviewKey = userId;
  cachedOverviewTimestamp = Date.now();
  saveOverviewSnapshotToDisk(reconciled);

  return reconciled;
}

router.get('/stock-intelligence/overview', authenticateToken, async (req, res) => {
  try {
    const userId = getUserKey(req.user);
    const forceRefresh = req.query.refresh === 'true' || req.query.forceRefresh === 'true';
    const includeBacktest = req.query.includeBacktest === 'true';
    const result = await computeStockOverview(userId, { forceRefresh, includeBacktest });
    res.json(result);
  } catch (error) {
    console.error('[Stock Intelligence] Overview failed:', error.message);
    res.status(500).json({ error: 'Stock analysis could not be loaded.' });
  }
});

router.get('/stock-intelligence/breach-alerts', authenticateToken, async (req, res) => {
  try {
    const userId = getUserKey(req.user);
    const forceRefresh = req.query.refresh === 'true' || req.query.forceRefresh === 'true';
    const overview = await computeStockOverview(userId, { forceRefresh });
    const inBreached = (overview.analyses || []).filter(item => item.stopFloorBreached);
    const usBreached = (overview.usAnalyses || []).filter(item => item.stopFloorBreached);
    const allBreached = [...inBreached, ...usBreached];

    const count = allBreached.length;
    const symbols = allBreached.map(b => b.symbol);
    const totalSuggestedShares = allBreached.reduce((sum, b) => sum + (b.suggestedSellQuantity || b.totalActionShares || 0), 0);
    const totalProceedsINR = allBreached.reduce((sum, b) => {
      const shares = b.suggestedSellQuantity || b.totalActionShares || 0;
      const price = b.currentPrice || 0;
      return sum + (shares * price);
    }, 0);

    res.json({
      count,
      symbols,
      totalSuggestedShares,
      totalProceedsINR: Number(totalProceedsINR.toFixed(2)),
      items: allBreached.map(b => ({
        id: b.holdingId,
        symbol: b.symbol,
        name: b.name,
        currentPrice: b.currentPrice,
        stopFloorPrice: b.trailingFloorPrice || b.chandelierStopPrice,
        bufferPct: b.liveBufferToTrailingFloorPct,
        suggestedSellQuantity: b.suggestedSellQuantity || b.totalActionShares || 0,
        action: b.action,
        state: b.state,
        tranche1Shares: b.tranche1Shares,
        tranche2Shares: b.tranche2Shares
      }))
    });
  } catch (error) {
    console.error('[Stock Intelligence] Breach alerts failed:', error.message);
    res.status(500).json({ error: 'Failed to evaluate breach alerts.' });
  }
});

router.post('/stock-intelligence/refresh-fundamentals', authenticateToken, async (req, res) => {
  try {
    invalidateStockIntelligenceCache();
    const holdings = await db.select('holdings');
    const symbol = req.body?.symbol;
    if (symbol) {
      const fund = await fetchCompanyFundamentals(symbol, { forceRefresh: true });
      return res.json({ symbol, fundamentals: fund });
    }

    // Refresh all held in background
    preloadAllHeldFundamentals(holdings).catch(e => console.error('[Fundamentals Preload Error]:', e.message));
    res.json({ message: 'Fundamentals refresh initiated for active holdings.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/stock-intelligence/history', authenticateToken, (req, res) => {
  res.json({ events: getStateHistory(getUserKey(req.user), req.query.holdingId || null) });
});

router.post('/stock-intelligence/config', authenticateToken, (req, res) => {
  try {
    const config = saveIntelligenceConfig(getUserKey(req.user), req.body || {});
    invalidateStockIntelligenceCache();
    res.json({ config });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/stock-intelligence/active-stop-loss', authenticateToken, (req, res) => {
  try {
    const userId = getUserKey(req.user);
    const { symbol, triggerPrice, tier, rationale, entries } = req.body || {};
    let updated;
    if (Array.isArray(entries) && entries.length > 0) {
      updated = saveBulkActiveStopLosses(userId, entries);
    } else if (symbol && triggerPrice) {
      updated = saveActiveStopLoss(userId, symbol, triggerPrice, { tier, rationale });
    } else {
      return res.status(400).json({ error: 'symbol and triggerPrice (or entries array) required.' });
    }
    invalidateStockIntelligenceCache();
    res.json({ success: true, activeStopLosses: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.delete('/stock-intelligence/active-stop-loss/:symbol', authenticateToken, (req, res) => {
  try {
    const userId = getUserKey(req.user);
    const updated = deleteActiveStopLoss(userId, req.params.symbol);
    invalidateStockIntelligenceCache();
    res.json({ success: true, activeStopLosses: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});


router.get('/stock-intelligence/action-plan', authenticateToken, async (req, res) => {
  try {
    const userKey = getUserKey(req.user);
    const userConfig = getIntelligenceConfig(userKey);
    const externalCash = (req.query.externalCash !== undefined && req.query.externalCash !== '' && req.query.externalCash !== 'null')
      ? Number(req.query.externalCash)
      : userConfig.externalCashBudget;
    const recyclingMode = req.query.recyclingMode || userConfig.recyclingMode;
    const maxDailyBuys = req.query.maxDailyBuys !== undefined ? Number(req.query.maxDailyBuys) : undefined;
    const dailyDeploymentCap = req.query.dailyDeploymentCap !== undefined ? Number(req.query.dailyDeploymentCap) : undefined;

    const cacheKey = `${userKey}_${externalCash}_${recyclingMode}_${maxDailyBuys}_${dailyDeploymentCap}`;
    const forceRefresh = req.query.refresh === 'true' || req.query.forceRefresh === 'true';
    const todayIST = getTodayIST();
    const now = Date.now();

    // 1. Fast in-memory cache hit (< 1ms) with live holding & quote reconciliation (guarded against stale date)
    if (!forceRefresh && cachedActionPlan && cachedActionPlanKey === cacheKey && cachedActionPlan.today === todayIST && (now - cachedActionPlanTimestamp < ACTION_PLAN_TTL_MS)) {
      return res.json(await reconcileActionPlanWithLiveHoldings(cachedActionPlan));
    }

    // 2. In-flight request deduplication per cacheKey
    if (!forceRefresh && _actionPlanInFlightPromises.has(cacheKey)) {
      const plan = await _actionPlanInFlightPromises.get(cacheKey);
      return res.json(await reconcileActionPlanWithLiveHoldings(plan));
    }

    const inFlightPromise = (async () => {
      try {
        if (forceRefresh) {
          await refreshActiveHoldingsPrices({ marketSession: 'IN', persistToDb: false }).catch(() => {});
          invalidateBuyCache();
          if (!process.env.RENDER) {
            await runBuyAnalysisEngine({ forceRefresh: true }).catch(() => {});
          }
          invalidateActionPlanBaseCache();
        }
        const plan = await generateActionPlan({
          userId: userKey,
          externalCashBudget: externalCash,
          recyclingMode,
          maxDailyBuys,
          dailyDeploymentCap,
          userConfig,
          forceRefresh
        });
        cachedActionPlan = plan;
        cachedActionPlanKey = cacheKey;
        cachedActionPlanTimestamp = Date.now();
        saveActionPlanSnapshotToDisk(plan);
        return plan;
      } finally {
        _actionPlanInFlightPromises.delete(cacheKey);
      }
    })();

    _actionPlanInFlightPromises.set(cacheKey, inFlightPromise);
    const plan = await inFlightPromise;
    res.json(await reconcileActionPlanWithLiveHoldings(plan));
  } catch (error) {
    console.error('[Stock Intelligence] Action plan fetch failed:', error.message);
    const fallback = loadActionPlanSnapshotFromDisk();
    if (fallback && fallback.summary) {
      return res.json(await reconcileActionPlanWithLiveHoldings(fallback));
    }
    res.status(500).json({ error: 'Failed to generate action plan.' });
  }
});

router.get('/stock-intelligence/action-plan-csv', authenticateToken, async (req, res) => {
  try {
    const userKey = getUserKey(req.user);
    const userConfig = getIntelligenceConfig(userKey);
    const externalCash = (req.query.externalCash !== undefined && req.query.externalCash !== '' && req.query.externalCash !== 'null')
      ? Number(req.query.externalCash)
      : userConfig.externalCashBudget;
    const recyclingMode = req.query.recyclingMode || userConfig.recyclingMode;
    const maxDailyBuys = req.query.maxDailyBuys !== undefined ? Number(req.query.maxDailyBuys) : undefined;
    const dailyDeploymentCap = req.query.dailyDeploymentCap !== undefined ? Number(req.query.dailyDeploymentCap) : undefined;

    const rawPlan = await generateActionPlan({
      userId: userKey,
      externalCashBudget: externalCash,
      recyclingMode,
      maxDailyBuys,
      dailyDeploymentCap,
      userConfig
    });
    const plan = await reconcileActionPlanWithLiveHoldings(rawPlan);

    if (req.query.format === 'json') {
      return res.json(plan);
    }

    const filename = `ladder_action_plan_${plan.today}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(plan.csv);
  } catch (error) {
    console.error('[Stock Intelligence] Action plan generation failed:', error.message);
    res.status(500).json({ error: 'Failed to generate action plan.' });
  }
});

export default router;
