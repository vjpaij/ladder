/**
 * actionPlanService.js — Canonical Next Market Day Action Plan Generator
 *
 * Consolidates live Buy Analysis signals (Strong Buys + Prime Buys) and
 * Sell Analysis triggers (Full Exits + Defensive Trims) into a single,
 * clear, execution-ready plan for the user's next trading session.
 *
 * Implements Multi-Factor Dynamic Allocation Sizing:
 *   1. Base Setup Quality (Prime Tier 1 ₹12k, Tier 2 ₹11k, Standard ₹9.5k, Scout ₹3.5k, Pre-Earnings ₹0)
 *   2. Factor A: Institutional Base Compression & Volatility Contraction Pattern (VCP) (+₹1,500)
 *   3. Factor B: Sector Breadth & Group Rank Momentum (+₹1,500)
 *   4. Factor C: Upward Pyramiding on Confirmed Support (+₹1,500 to +₹2,500 into proven winners)
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

export async function generateActionPlan({ userId = '1' } = {}) {
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

  // Compute Dynamic Sector Breadth & Group Momentum across the 500-stock universe
  const sectorStats = {};
  buyAnalyses.forEach(x => {
    const s = x.sector || 'Other';
    if (!sectorStats[s]) sectorStats[s] = { total: 0, bullish: 0, scores: [] };
    sectorStats[s].total++;
    if (['STRONG_BUY', 'BUY'].includes(x.buySignal)) sectorStats[s].bullish++;
    sectorStats[s].scores.push(x.compositeScore || 50);
  });
  for (const [, stat] of Object.entries(sectorStats)) {
    stat.bullishPct = Math.round((stat.bullish / stat.total) * 100);
    stat.avgScore = Math.round(stat.scores.reduce((a, b) => a + b, 0) / stat.scores.length);
  }
  const topSectors = Object.entries(sectorStats)
    .filter(([_, st]) => st.total >= 5)
    .sort((a, b) => b[1].bullishPct - a[1].bullishPct || b[1].avgScore - a[1].avgScore)
    .slice(0, 5)
    .map(([s]) => s);

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

  // Dynamic Conviction-Weighted Allocation Calculator
  function calculateDynamicConvictionAllocation(item, isOwned, heldQty, holdingObj) {
    const stance = item.executiveStrategy?.stance || 'PRIME_SETUP';
    const cmp = Number(item.currentPrice) || 0;
    const sl = item.executiveStrategy?.riskAndExit?.stopLoss || item.stopLoss || 0;
    const composite = item.compositeScore || 50;
    const tags = Array.isArray(item.qualitativeTags) ? item.qualitativeTags : [];
    const isTurnaround = tags.some(t => t.tag === 'TURNAROUND_CATALYST');

    if (stance === 'PRE_EARNINGS') {
      return {
        alloc: 0,
        factors: ['Pre-Earnings Stand Aside (₹0 binary risk)'],
        summary: 'STAND ASIDE (₹0): Earnings filing due within 15 days. Await audited results.'
      };
    }

    // Uncapped Conviction Sizing Tiers:
    // 1. Prime / Turnaround Top Tier: ₹1,00,000 Base Entry
    // 2. Strong Buy / High Composite (>= 70): ₹50,000 Base Entry
    // 3. Extended Runner: ₹15,000 Scout Entry
    // 4. Standard Setup: ₹35,000 Base Entry
    const isPrime = (item.buySignal === 'STRONG_BUY' && composite >= 80) || isTurnaround;
    let base = 35000;
    let tierLabel = 'Standard Setup (₹35,000 Base)';

    if (isPrime) {
      base = 100000;
      tierLabel = isTurnaround ? 'Turnaround Prime Setup (₹1,00,000 Base)' : 'Prime High-Conviction (₹1,00,000 Base)';
    } else if (item.buySignal === 'STRONG_BUY' || composite >= 70) {
      base = 50000;
      tierLabel = 'Tier 2 High-Confluence (₹50,000 Base)';
    } else if (stance === 'EXTENDED_RUNNER') {
      base = 15000;
      tierLabel = 'Scout Test Entry (₹15,000)';
    }

    const factors = [tierLabel];
    let total = base;

    // Factor A: Institutional Base Compression & Volatility Contraction Pattern (VCP)
    const riskPct = cmp > 0 && sl > 0 ? Math.abs((cmp - sl) / cmp * 100) : 10;
    const isVcp = riskPct <= 8.5 && Math.abs(item.pctFromHigh52w || 0) <= 14.0;
    if (isVcp) {
      const vcpBonus = isPrime ? 10000 : 5000;
      total += vcpBonus;
      factors.push(`VCP Base Compression (+₹${vcpBonus/1000}k)`);
    }

    // Factor B: Sector Breadth & Group Rank Momentum
    if (topSectors.includes(item.sector)) {
      const sectorBonus = isPrime ? 10000 : 5000;
      total += sectorBonus;
      factors.push(`Sector Tailwind [${item.sector}] (+₹${sectorBonus/1000}k)`);
    }

    // Factor C: Uncapped Upward Pyramiding on Confirmed Support
    if (isOwned && heldQty > 0) {
      const avgPrice = Number(holdingObj?.average_buy_price || item.portfolioAvgPrice) || 0;
      const isInProfit = avgPrice > 0 && cmp > avgPrice;
      if (isInProfit) {
        const pyramidTranche = isPrime ? 50000 : 25000;
        total += pyramidTranche;
        const gainPct = ((cmp / avgPrice - 1) * 100).toFixed(1);
        factors.push(`Upward Pyramiding: Position in profit (+${gainPct}%), scaling into proven runner (+₹${pyramidTranche/1000}k uncapped)`);
      } else {
        factors.push('Existing holding: Adding disciplined support tranche');
      }
    }

    return {
      alloc: total,
      factors,
      summary: factors.join(' + ')
    };
  }

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
    'Execution Strategy & Sizing Rationale'
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
    const holdingObj = enrichedHoldings.find(h => h.symbol === x.symbol);

    let actionType = isOwned ? 'BUY - ACCUMULATE (ADD TRANCHE)' : 'BUY - NEW POSITION';
    if (stance === 'PRE_EARNINGS') actionType = 'STAND ASIDE (PRE-EARNINGS)';

    const sizing = calculateDynamicConvictionAllocation(x, isOwned, heldQty, holdingObj);
    const recQty = sizing.alloc > 0 && cmp > 0 ? Math.max(1, Math.round(sizing.alloc / cmp)) : 0;
    const recAmt = recQty * cmp;

    const note = isOwned
      ? `Tranche Addition (Holding ${heldQty} shs): ${sizing.summary}. Trail stop at ₹${sl.toFixed(2)}.`
      : `New Entry: ${sizing.summary}. Target ₹${tgt > 0 ? tgt.toFixed(2) : '—'}, Stop ₹${sl.toFixed(2)}.`;

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
    const holdingObj = enrichedHoldings.find(h => h.symbol === x.symbol);

    const actionType = isOwned ? 'BUY - ACCUMULATE (ADD TRANCHE)' : 'BUY - NEW POSITION';
    const sizing = calculateDynamicConvictionAllocation(x, isOwned, heldQty, holdingObj);
    const recQty = sizing.alloc > 0 && cmp > 0 ? Math.max(1, Math.round(sizing.alloc / cmp)) : 0;
    const recAmt = recQty * cmp;

    const note = isOwned
      ? `Tranche Addition (Holding ${heldQty} shs): ${sizing.summary}. Hard stop at ₹${sl.toFixed(2)}.`
      : `New Entry: ${sizing.summary}. Target ₹${tgt > 0 ? tgt.toFixed(2) : '—'}, Stop ₹${sl.toFixed(2)}.`;

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
