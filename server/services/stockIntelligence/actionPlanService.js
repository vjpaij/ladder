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
import db from '../../db.js';
import { loadHistoricalPricesAsync } from '../historicalPriceStore.js';
import { buildStockAnalyses } from './analysisService.js';
import { validateAndHealStockData } from './dataIntegrityValidator.js';
import { getTodayIST } from '../marketCalendar.js';
import { getIntelligenceConfig } from './repository.js';

function escapeCsvCell(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function generateActionPlan({
  userId = '1',
  externalCashBudget: paramExternalCash,
  recyclingMode: paramRecyclingMode
} = {}) {
  const projectRoot = process.cwd();

  // Load User Configuration
  const userConfig = getIntelligenceConfig(userId);
  const externalCashBudget = paramExternalCash !== undefined && paramExternalCash !== null
    ? Math.max(0, Math.round(Number(paramExternalCash)))
    : (userConfig.externalCashBudget ?? 200000);
  const periodicIncrement = userConfig.periodicIncrement ?? 200000;
  const recyclingMode = paramRecyclingMode || userConfig.recyclingMode || 'FULL_AND_TRIMS';

  // 1. Load Buy Analyses from snapshot or service
  let buyAnalyses = [];
  const snapPath = path.join(projectRoot, 'data', 'buy_analysis_snapshot.json');
  if (fs.existsSync(snapPath)) {
    try {
      const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      buyAnalyses = snap.analyses || [];
    } catch (_) {}
  }

  // Compute Dynamic Sector Breadth & Group Momentum across universe
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

  const fullExitProceeds = fullExits.reduce((acc, a) => acc + (Number(a.quantity || 0) * (Number(a.currentPrice) || 0)), 0);
  const trimProceeds = trims.reduce((acc, a) => acc + (Number(a.suggestedSellQuantity || 0) * (Number(a.currentPrice) || 0)), 0);

  let recycledCapital = 0;
  if (recyclingMode === 'FULL_AND_TRIMS') {
    recycledCapital = fullExitProceeds + trimProceeds;
  } else if (recyclingMode === 'FULL_ONLY') {
    recycledCapital = fullExitProceeds;
  } else {
    // 'EXTERNAL_ONLY': zero selling, pure portfolio expansion
    recycledCapital = 0;
  }

  const totalPurchasingPower = Math.round(externalCashBudget + recycledCapital);

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
        tierLabel: 'Pre-Earnings Stand Aside (₹0)',
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
    let tierLabel = 'Standard Setup (₹35k Base)';

    if (isPrime) {
      base = 100000;
      tierLabel = isTurnaround ? 'Turnaround Prime Setup (₹1L Base)' : 'Prime High-Conviction (₹1L Base)';
    } else if (item.buySignal === 'STRONG_BUY' || composite >= 70) {
      base = 50000;
      tierLabel = 'Tier 2 High-Confluence (₹50k Base)';
    } else if (stance === 'EXTENDED_RUNNER') {
      base = 15000;
      tierLabel = 'Scout Test Entry (₹15k Base)';
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
        factors.push(`Upward Pyramiding: Position in profit (+${gainPct}%), scaling into proven runner (+₹${pyramidTranche/1000}k)`);
      } else {
        factors.push('Existing holding: Adding disciplined support tranche');
      }
    }

    return {
      alloc: total,
      tierLabel,
      factors,
      summary: factors.join(' + ')
    };
  }

  // Deduplicate and pool candidate buys
  const seenSymbols = new Set();
  const allCandidatePool = [];

  strongBuys.forEach(x => {
    if (!seenSymbols.has(x.symbol)) {
      seenSymbols.add(x.symbol);
      allCandidatePool.push({ ...x, sourceSignal: 'STRONG_BUY' });
    }
  });

  primeBuys.forEach(x => {
    if (!seenSymbols.has(x.symbol)) {
      seenSymbols.add(x.symbol);
      allCandidatePool.push({ ...x, sourceSignal: 'BUY' });
    }
  });

  // Evaluate each candidate
  const candidateEvaluations = allCandidatePool.map(x => {
    const cmp = Number(x.currentPrice) || 0;
    const sl = x.executiveStrategy?.riskAndExit?.stopLoss || x.stopLoss || 0;
    const tgt = x.executiveStrategy?.riskAndExit?.targetPrice || x.targetPrice || 0;
    const stance = x.executiveStrategy?.stance || 'PRIME_SETUP';
    const isOwned = Boolean(x.inPortfolio || (x.portfolioQuantity && x.portfolioQuantity > 0));
    const heldQty = Number(x.portfolioQuantity) || 0;
    const holdingObj = enrichedHoldings.find(h => h.symbol === x.symbol);
    const avgPrice = Number(holdingObj?.average_buy_price || x.portfolioAvgPrice) || 0;
    const isInProfit = isOwned && avgPrice > 0 && cmp > avgPrice;
    const composite = Number(x.compositeScore) || 50;
    const tags = Array.isArray(x.qualitativeTags) ? x.qualitativeTags : [];
    const isTurnaround = tags.some(t => t.tag === 'TURNAROUND_CATALYST');

    const sizing = calculateDynamicConvictionAllocation(x, isOwned, heldQty, holdingObj);
    const targetShares = sizing.alloc > 0 && cmp > 0 ? Math.max(1, Math.round(sizing.alloc / cmp)) : 0;
    const targetAmount = targetShares * cmp;

    // Priority Rank Score:
    // 1. Pyramiding into existing owned winners in profit (+1000 pts)
    // 2. Turnaround Inflection Multibagger (+800 pts)
    // 3. Strong Buy with VCP & Sector (+400 pts)
    // 4. Composite score
    let priorityRank = composite;
    if (isInProfit) priorityRank += 1000;
    else if (isTurnaround) priorityRank += 800;
    else if (x.sourceSignal === 'STRONG_BUY') priorityRank += 400;

    let actionType = isOwned ? 'BUY - ACCUMULATE (ADD TRANCHE)' : 'BUY - NEW POSITION';
    if (stance === 'PRE_EARNINGS') actionType = 'STAND ASIDE (PRE-EARNINGS)';

    return {
      symbol: x.symbol,
      name: x.name,
      cmp,
      sl,
      tgt,
      stance,
      sourceSignal: x.sourceSignal,
      isOwned,
      heldQty,
      avgPrice,
      isInProfit,
      composite,
      isTurnaround,
      sizing,
      targetShares,
      targetAmount,
      priorityRank,
      actionType,
      sector: x.sector
    };
  });

  // Sort candidates by priority rank descending
  candidateEvaluations.sort((a, b) => b.priorityRank - a.priorityRank);

  // Sequential Budget Deployment Pass
  let remainingCapital = totalPurchasingPower;
  const immediateBuys = [];
  const queuedBuys = [];

  candidateEvaluations.forEach(cand => {
    if (cand.stance === 'PRE_EARNINGS' || cand.targetAmount <= 0) {
      queuedBuys.push({
        ...cand,
        executionStatus: 'STAND ASIDE (PRE-EARNINGS)',
        actionShares: 0,
        actionValue: 0,
        note: 'Pre-Earnings Stand Aside (₹0 binary risk). Await quarterly filing.'
      });
      return;
    }

    if (remainingCapital >= cand.targetAmount) {
      const fundedShares = cand.targetShares;
      const fundedValue = fundedShares * cand.cmp;
      remainingCapital -= fundedValue;
      immediateBuys.push({
        ...cand,
        executionStatus: 'FUNDED TODAY (IMMEDIATE EXECUTION)',
        actionShares: fundedShares,
        actionValue: fundedValue,
        note: cand.isOwned
          ? `Tranche Addition (Holding ${cand.heldQty} shs): ${cand.sizing.summary}. Trail stop at ₹${cand.sl.toFixed(2)}.`
          : `New Entry: ${cand.sizing.summary}. Target ₹${cand.tgt > 0 ? cand.tgt.toFixed(2) : '—'}, Stop ₹${cand.sl.toFixed(2)}.`
      });
    } else if (remainingCapital >= (cand.cmp * 1) && remainingCapital >= 10000) {
      const partialShares = Math.floor(remainingCapital / cand.cmp);
      if (partialShares >= 1) {
        const partialValue = partialShares * cand.cmp;
        remainingCapital -= partialValue;
        immediateBuys.push({
          ...cand,
          executionStatus: 'PARTIALLY FUNDED TODAY (BUDGET BUFFER)',
          actionShares: partialShares,
          actionValue: partialValue,
          note: `Partial allocation funded from remaining cash buffer (${partialShares} shares). Full target: ${cand.targetShares} shares.`
        });
      } else {
        queuedBuys.push({
          ...cand,
          executionStatus: 'QUEUED FOR NEXT PERIODIC INFUSION',
          actionShares: cand.targetShares,
          actionValue: cand.targetAmount,
          note: `Queued: Next candidate for execution upon next periodic capital injection (Target: ₹${cand.targetAmount.toFixed(2)}).`
        });
      }
    } else {
      queuedBuys.push({
        ...cand,
        executionStatus: 'QUEUED FOR NEXT PERIODIC INFUSION',
        actionShares: cand.targetShares,
        actionValue: cand.targetAmount,
        note: `Queued: Next candidate for execution upon next periodic capital injection (Target: ₹${cand.targetAmount.toFixed(2)}).`
      });
    }
  });

  // 3. Process Algorithmic Sells (strictly performance decay, zero forced selling)
  const activeSells = [];

  fullExits.forEach(a => {
    const cmp = Number(a.currentPrice) || 0;
    const qty = Number(a.quantity) || 0;
    const amt = qty * cmp;
    const trigger = a.chandelierStopPrice || a.sma30Week || 0;

    activeSells.push({
      executionGroup: '3. ALGORITHMIC SELL (PERFORMANCE DECAY)',
      actionType: 'SELL - FULL EXIT',
      category: 'Full Exit (Structural Breakdown)',
      symbol: a.symbol,
      name: a.name,
      cmp,
      state: a.state,
      quantity: qty,
      actionValue: amt,
      triggerPrice: trigger,
      targetPrice: 0,
      heldShares: qty,
      reason: a.sizingMethod || `Full thesis liquidation: 100% of remaining position (${qty} shares) to protect capital against structural breakdown below 30W-SMA.`,
      isFullExit: true
    });
  });

  if (recyclingMode === 'FULL_AND_TRIMS') {
    trims.forEach(a => {
      const cmp = Number(a.currentPrice) || 0;
      const held = Number(a.quantity) || 0;
      const trimQty = Number(a.suggestedSellQuantity) || 0;
      const amt = trimQty * cmp;
      const trigger = a.stagedExitPlan?.tranche1?.triggerPrice || a.sma30Week || 0;
      const cat = a.state === 'TECHNICAL_TRIM_CANDIDATE' ? 'Technical Trim Candidate' : 'Fundamental Trim Candidate';
      const actionType = a.state === 'TECHNICAL_TRIM_CANDIDATE' ? 'SELL - TECHNICAL TRIM' : 'SELL - FUNDAMENTAL TRIM';

      activeSells.push({
        executionGroup: '3. ALGORITHMIC SELL (PERFORMANCE DECAY)',
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
        reason: a.sizingMethod || `Tranche 1 defensive de-risk trim: Sell ${trimQty} shares; keep core ${held - trimQty} shares riding.`,
        isFullExit: false
      });
    });
  }

  // 4. Construct Unified CSV Rows
  const rows = [];
  const header = [
    'Execution Group',
    'Action Type',
    'Category / Setup Tier',
    'Symbol',
    'Company Name',
    'Current Price (INR)',
    'Action Quantity (Shares)',
    'Action Value (INR)',
    'Stop-Loss / Trigger (INR)',
    'Target Price (INR)',
    'Current Held Shares',
    'Capital Source & Execution Rationale'
  ];
  rows.push(header);

  // Section 1: Immediate Buys (Funded Today)
  immediateBuys.forEach(b => {
    rows.push([
      '1. IMMEDIATE BUY (FUNDED TODAY)',
      b.actionType,
      b.sizing?.tierLabel || b.stance,
      b.symbol,
      b.name,
      b.cmp.toFixed(2),
      b.actionShares,
      b.actionValue.toFixed(2),
      b.sl > 0 ? b.sl.toFixed(2) : '—',
      b.tgt > 0 ? b.tgt.toFixed(2) : '—',
      b.heldQty,
      b.note
    ]);
  });

  // Section 2: Algorithmic Sells (Performance Decay)
  activeSells.forEach(s => {
    rows.push([
      '2. ALGORITHMIC SELL (PERFORMANCE DECAY)',
      s.actionType,
      s.category,
      s.symbol,
      s.name,
      s.cmp.toFixed(2),
      s.quantity,
      s.actionValue.toFixed(2),
      s.triggerPrice > 0 ? s.triggerPrice.toFixed(2) : '—',
      '—',
      s.heldShares,
      s.reason
    ]);
  });

  // Section 3: Queued Candidates (For Next Periodic Infusion)
  queuedBuys.forEach(q => {
    rows.push([
      '3. QUEUED BUY (NEXT PERIODIC INFUSION)',
      q.actionType,
      q.sizing?.tierLabel || q.stance,
      q.symbol,
      q.name,
      q.cmp.toFixed(2),
      q.targetShares,
      q.targetAmount.toFixed(2),
      q.sl > 0 ? q.sl.toFixed(2) : '—',
      q.tgt > 0 ? q.tgt.toFixed(2) : '—',
      q.heldQty,
      q.note
    ]);
  });

  const csv = rows.map(r => r.map(escapeCsvCell).join(',')).join('\r\n');
  const today = getTodayIST();
  const totalImmediateBuyValue = immediateBuys.reduce((sum, b) => sum + b.actionValue, 0);
  const unallocatedCashBuffer = Math.max(0, totalPurchasingPower - totalImmediateBuyValue);

  const summary = {
    today,
    externalCashBudget,
    periodicIncrement,
    recyclingMode,
    fullExitProceeds: Math.round(fullExitProceeds),
    trimProceeds: Math.round(trimProceeds),
    recycledCapital: Math.round(recycledCapital),
    totalPurchasingPower,
    totalImmediateBuyValue: Math.round(totalImmediateBuyValue),
    unallocatedCashBuffer: Math.round(unallocatedCashBuffer),
    immediateBuysCount: immediateBuys.length,
    queuedBuysCount: queuedBuys.length,
    sellsCount: activeSells.length
  };

  return {
    today,
    summary,
    immediateBuys,
    queuedBuys,
    sells: activeSells,
    allBuys: [...immediateBuys, ...queuedBuys],
    totalActions: rows.length - 1,
    rows,
    csv
  };
}
