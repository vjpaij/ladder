/**
 * actionPlanService.js — Canonical Next Market Day Action Plan Generator
 *
 * Consolidates live Buy Analysis signals (Strong Buys + Prime Buys) and
 * Sell Analysis triggers (Full Exits + Defensive Trims) into a single,
 * clear, execution-ready plan for the user's next trading session.
 */

import fs from 'node:fs';
import path from 'node:path';
import db from '../../db.js';
import { loadHistoricalPricesAsync } from '../historicalPriceStore.js';
import { buildStockAnalyses } from './analysisService.js';
import { validateAndHealStockData } from './dataIntegrityValidator.js';
import { getTodayIST } from '../marketCalendar.js';

function escapeCsvCell(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function generateActionPlan({ userId = '1', budgetPerBuy = 10000 } = {}) {
  const projectRoot = process.cwd();

  // 1. Load Buy Analyses from snapshot or service
  let buyAnalyses = [];
  const snapPath = path.join(projectRoot, 'data', 'buy_analysis_snapshot.json');
  if (fs.existsSync(snapPath)) {
    try {
      const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      buyAnalyses = snap.analyses || [];
    } catch (_) {}
  }

  const strongBuys = buyAnalyses.filter(x => x.buySignal === 'STRONG_BUY');
  const primeBuys = buyAnalyses.filter(x => x.buySignal === 'BUY' && x.executiveStrategy?.stance === 'PRIME_SETUP');

  // 2. Load Portfolio Holdings and Evaluate Sell / Exit Analyses
  const [holdings, transactions, dividends, metadata, history] = await Promise.all([
    db.select('holdings'),
    db.select('transactions'),
    db.select('dividends'),
    db.select('asset_metadata'),
    loadHistoricalPricesAsync()
  ]);

  const enrichedHoldings = holdings.map(h => ({
    ...h,
    current_price: Number(h.current_price) || 0,
    nse_price: Number(h.nse_price) || 0,
    bse_price: Number(h.bse_price) || 0
  }));

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
    config: {},
    transactions,
    dividends,
    metadata,
    fundamentalsMap,
    categoryId: 'in_stocks',
    candleCache
  });

  const fullExits = heldAnalyses.filter(a => a.state === 'FULL_EXIT_CANDIDATE');
  const trims = heldAnalyses.filter(a => a.state === 'TECHNICAL_TRIM_CANDIDATE' || a.state === 'FUNDAMENTAL_TRIM_CANDIDATE');

  const rows = [];
  const header = [
    'Action Type',
    'Category',
    'Symbol',
    'Company Name',
    'Current Price (INR)',
    'Stance / State',
    'Action Quantity (Shares)',
    'Action Value (INR)',
    'Stop-Loss / Trigger (INR)',
    'Target Price (INR)',
    'Current Held Shares',
    'Execution Strategy & Notes'
  ];
  rows.push(header);

  // A. Process Strong Buys
  strongBuys.forEach(x => {
    const cmp = Number(x.currentPrice) || 0;
    const sl = x.executiveStrategy?.riskAndExit?.stopLoss || x.stopLoss || 0;
    const tgt = x.executiveStrategy?.riskAndExit?.targetPrice || x.targetPrice || 0;
    const stance = x.executiveStrategy?.stance || 'PRIME_SETUP';
    const isOwned = Boolean(x.inPortfolio || (x.portfolioQuantity && x.portfolioQuantity > 0));
    const heldQty = Number(x.portfolioQuantity) || 0;

    let actionType = isOwned ? 'BUY - ACCUMULATE (ADD TRANCHE)' : 'BUY - NEW POSITION';
    let recQty = 0;
    let recAmt = 0;
    let note = '';

    if (stance === 'PRIME_SETUP') {
      recQty = Math.max(1, Math.round(budgetPerBuy / cmp));
      recAmt = recQty * cmp;
      note = isOwned
        ? `Tranche addition: You currently hold ${heldQty} shares. Add ${recQty} shares (Composite ${x.compositeScore}/100, Stage 2 continuation). Trail stop at ₹${sl.toFixed(2)}.`
        : `Tranche 1 initial entry (30% position). Composite ${x.compositeScore}/100, Stage 2 breakout. Trail stop at ₹${sl.toFixed(2)}.`;
    } else if (stance === 'EXTENDED_RUNNER') {
      recQty = Math.max(1, Math.round(3500 / cmp)); // scout test size
      recAmt = recQty * cmp;
      note = `Scout test allocation (${recQty} shares). Stock is +${(x.executiveStrategy?.extAbove30w || 0).toFixed(1)}% extended above 30w-SMA. Keep remaining ₹7,000 dry powder for 50-EMA support pullback.`;
    } else if (stance === 'PRE_EARNINGS') {
      actionType = 'STAND ASIDE (PRE-EARNINGS)';
      recQty = 0;
      recAmt = 0;
      note = 'STAND ASIDE (₹0 allocation). Quarterly results are imminent within 15 days. Do not gamble before audited earnings are released.';
    }

    rows.push([
      actionType,
      `Strong Buy (${stance})`,
      x.symbol,
      x.name,
      cmp.toFixed(2),
      stance,
      recQty,
      recAmt.toFixed(2),
      sl.toFixed(2),
      tgt > 0 ? tgt.toFixed(2) : '—',
      heldQty,
      note
    ]);
  });

  // B. Process Top Prime Buys (High Confluence)
  primeBuys.slice(0, 10).forEach(x => {
    const cmp = Number(x.currentPrice) || 0;
    const sl = x.executiveStrategy?.riskAndExit?.stopLoss || x.stopLoss || 0;
    const tgt = x.executiveStrategy?.riskAndExit?.targetPrice || x.targetPrice || 0;
    const stance = 'PRIME_SETUP';
    const isOwned = Boolean(x.inPortfolio || (x.portfolioQuantity && x.portfolioQuantity > 0));
    const heldQty = Number(x.portfolioQuantity) || 0;

    const actionType = isOwned ? 'BUY - ACCUMULATE (ADD TRANCHE)' : 'BUY - NEW POSITION';
    const recQty = Math.max(1, Math.round(budgetPerBuy / cmp));
    const recAmt = recQty * cmp;
    const note = isOwned
      ? `Tranche addition: Currently hold ${heldQty} shares. Add ${recQty} shares. Composite ${x.compositeScore}/100. Stop-loss at ₹${sl.toFixed(2)}.`
      : `Tranche 1 entry. Composite ${x.compositeScore}/100, Fund Grade ${x.fundamentalGrade || 'B'}. Invalidation below ₹${sl.toFixed(2)}.`;

    rows.push([
      actionType,
      'Prime Buy (High Confluence)',
      x.symbol,
      x.name,
      cmp.toFixed(2),
      stance,
      recQty,
      recAmt.toFixed(2),
      sl.toFixed(2),
      tgt > 0 ? tgt.toFixed(2) : '—',
      heldQty,
      note
    ]);
  });

  // C. Process Full Exits
  fullExits.forEach(a => {
    const cmp = Number(a.currentPrice) || 0;
    const qty = Number(a.quantity) || 0;
    const amt = qty * cmp;
    const trigger = a.chandelierStopPrice || a.sma30Week || 0;

    rows.push([
      'SELL - FULL EXIT',
      'Full Exit Candidate',
      a.symbol,
      a.name,
      cmp.toFixed(2),
      a.state,
      qty,
      amt.toFixed(2),
      trigger.toFixed(2),
      '—',
      qty,
      a.sizingMethod || `Full thesis liquidation: Sell 100% of remaining position (${qty} shares) to protect capital against structural breakdown.`
    ]);
  });

  // D. Process Defensive Trims
  trims.forEach(a => {
    const cmp = Number(a.currentPrice) || 0;
    const held = Number(a.quantity) || 0;
    const trimQty = Number(a.suggestedSellQuantity) || 0;
    const amt = trimQty * cmp;
    const trigger = a.stagedExitPlan?.tranche1?.triggerPrice || a.sma30Week || 0;
    const cat = a.state === 'TECHNICAL_TRIM_CANDIDATE' ? 'Technical Trim Candidate' : 'Fundamental Trim Candidate';
    const actionType = a.state === 'TECHNICAL_TRIM_CANDIDATE' ? 'SELL - TECHNICAL TRIM' : 'SELL - FUNDAMENTAL TRIM';

    rows.push([
      actionType,
      cat,
      a.symbol,
      a.name,
      cmp.toFixed(2),
      a.state,
      trimQty,
      amt.toFixed(2),
      trigger.toFixed(2),
      '—',
      held,
      a.sizingMethod || `Tranche 1 defensive de-risk trim: Sell ${trimQty} shares; keep core ${held - trimQty} shares riding.`
    ]);
  });

  const csv = rows.map(r => r.map(escapeCsvCell).join(',')).join('\r\n');
  const today = getTodayIST();

  return {
    today,
    totalActions: rows.length - 1,
    csv,
    rows
  };
}
