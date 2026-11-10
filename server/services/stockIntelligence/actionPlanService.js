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
import { buildStockAnalyses, calculateTriggeredStagedSell } from './analysisService.js';
import { validateAndHealStockData } from './dataIntegrityValidator.js';
import { getTodayIST } from '../marketCalendar.js';
import { liveQuoteCache, resolveHoldingPrice } from '../priceEngine.js';
import { getIntelligenceConfig } from './repository.js';
import { resolveCanonicalSector } from './buyAnalysisService.js';
import { calculateMarketOpportunity } from './marketOpportunityEngine.js';

function escapeCsvCell(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const round2 = (num) => Math.round((Number(num) || 0) * 100) / 100;

export async function generateActionPlan({
  userId = '1',
  externalCashBudget: paramExternalCash,
  recyclingMode: paramRecyclingMode,
  maxDailyBuys: paramMaxDailyBuys,
  dailyDeploymentCap: paramDailyDeploymentCap,
  userConfig: paramUserConfig
} = {}) {
  const projectRoot = process.cwd();

  // Load User Configuration
  const userConfig = paramUserConfig || getIntelligenceConfig(userId);
  const externalCashBudget = paramExternalCash !== undefined && paramExternalCash !== null
    ? Math.max(0, Math.round(Number(paramExternalCash)))
    : (userConfig.externalCashBudget ?? 200000);
  const periodicIncrement = userConfig.periodicIncrement ?? 200000;
  const recyclingMode = paramRecyclingMode || userConfig.recyclingMode || 'FULL_AND_TRIMS';
  const maxDailyBuys = paramMaxDailyBuys !== undefined && paramMaxDailyBuys !== null
    ? Math.max(1, Math.min(15, Math.round(Number(paramMaxDailyBuys))))
    : (userConfig.maxDailyBuys ?? 5);
  const dailyDeploymentCap = paramDailyDeploymentCap !== undefined && paramDailyDeploymentCap !== null
    ? Math.max(50000, Math.round(Number(paramDailyDeploymentCap)))
    : (userConfig.dailyDeploymentCap ?? 350000);

  // 1. Load Buy Analyses from snapshot or service
  let buyAnalyses = [];
  const snapPath = path.join(projectRoot, 'data', 'buy_analysis_snapshot.json');
  if (fs.existsSync(snapPath)) {
    try {
      const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
      const ageMs = Date.now() - new Date(snap.generatedAt || 0).getTime();
      // Use cached snapshot if less than 30 minutes old
      if (ageMs < 30 * 60 * 1000 && Array.isArray(snap.analyses) && snap.analyses.length > 0) {
        buyAnalyses = snap.analyses;
      }
    } catch (_) {}
  }

  // If snapshot is missing or stale, dynamically generate fresh buy analyses
  if (buyAnalyses.length === 0) {
    try {
      const { runBuyAnalysisEngine } = await import('../../routes/buyAnalysis.js');
      const fresh = await runBuyAnalysisEngine({ forceRefresh: false });
      buyAnalyses = fresh.analyses || [];
    } catch (err) {
      console.warn('[Action Plan] Could not trigger dynamic buy analysis run:', err.message);
    }
  }

  // Compute Dynamic Sector Breadth & Group Momentum across universe
  const sectorStats = {};
  buyAnalyses.forEach(x => {
    const s = resolveCanonicalSector(x.fundamentals, x.name, x.symbol) || x.sector || 'Diversified & Other';
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

  // Filter institutional quality: strictly exclude penny stocks (< ₹20), microcaps (< ₹1000 Cr), and AVOID signals
  const isInstitutionalQuality = (x) => {
    const cmp = Number(x.currentPrice) || 0;
    const mcap = Number(x.marketCapCr) || 0;
    if (cmp < 20.00) return false;
    if (mcap > 0 && mcap < 1000) return false;
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

  const enrichedHoldings = holdings.map(h => {
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

  let projectedRecycledCapital = realizedRecycledCapital;
  if (recyclingMode === 'FULL_AND_TRIMS') {
    projectedRecycledCapital += (fullExitProceeds + trimProceeds + chandelierBreachProceeds);
  } else if (recyclingMode === 'FULL_ONLY') {
    projectedRecycledCapital += (fullExitProceeds + chandelierBreachProceeds);
  } else {
    // 'EXTERNAL_ONLY': zero selling, pure portfolio expansion
    projectedRecycledCapital = 0;
  }

  // Recycled capital represents the actual net cash obtained from the base + subsequent rebalances
  const recycledCapital = recyclingMode === 'EXTERNAL_ONLY' ? 0 : round2(realizedRecycledCapital);
  const totalPurchasingPower = round2(externalCashBudget + recycledCapital);

  // Dynamic Portfolio Weight Cap calculation based on total Indian equity valuation
  const totalIndianEquityValuation = enrichedHoldings
    .filter(h => h.category_id === 'in_stocks' || (!h.category_id && !String(h.symbol).includes('.')))
    .reduce((acc, h) => acc + (Number(h.quantity || 0) * Number(h.current_price || 0)), 0) || 4600000;

  const targetWeightPct = Number(userConfig?.maxPositionWeightPct) || 10.0;

  // Dynamic Conviction-Weighted Allocation Calculator
  function calculateDynamicConvictionAllocation(item, isOwned, heldQty, holdingObj) {
    const stance = item.executiveStrategy?.stance || 'PRIME_SETUP';
    const cmp = Number(item.currentPrice) || 0;
    const sl = item.executiveStrategy?.riskAndExit?.stopLoss || item.stopLoss || 0;
    const composite = item.compositeScore || 50;
    const tags = Array.isArray(item.qualitativeTags) ? item.qualitativeTags : [];
    const isTurnaround = tags.some(t => t.tag === 'TURNAROUND_CATALYST');

    const isPreEarnings = stance === 'PRE_EARNINGS';

    const mcap = Number(item.marketCapCr) || 0;
    if (cmp < 20 || (mcap > 0 && mcap < 1000)) {
      return {
        alloc: 0,
        tierLabel: 'Sub-Institutional Microcap (₹0)',
        factors: [`Market Cap < ₹1,000 Cr (₹${mcap} Cr) or Price < ₹20`],
        summary: `AVOID (₹0): Market Cap ₹${mcap} Cr < ₹1,000 Cr or CMP ₹${cmp} < ₹20. Disqualified to protect from illiquid circuit freeze and operator manipulation.`
      };
    }

    const mps = Number(item.mps ?? item.multibaggerProbabilityScore ?? item.compositeScore ?? composite);
    const isPrime = (mps >= 80) || isTurnaround;
    const isTier2 = (mps >= 70 || item.buySignal === 'STRONG_BUY');
    const isStd = (mps >= 60 || item.buySignal === 'BUY');

    // Dynamic Portfolio Weight Caps based on total equity valuation (Rule: 10% Prime, 7% Tier 2, 5% Standard)
    const primeCap = Math.max(200000, Math.round(totalIndianEquityValuation * (targetWeightPct / 100)));
    const tier2Cap = Math.max(125000, Math.round(totalIndianEquityValuation * ((targetWeightPct * 0.7) / 100)));
    const standardCap = Math.max(75000, Math.round(totalIndianEquityValuation * ((targetWeightPct * 0.5) / 100)));

    const maxPositionCap = isPrime ? primeCap : isTier2 ? tier2Cap : standardCap;
    const currentHeldValue = heldQty * cmp;
    const pctEma50 = Number(item.pctFromEma50) || 0;
    const isExtended = stance === 'EXTENDED_RUNNER' || pctEma50 > 16.0;

    // Factor A: Institutional Base Compression & Volatility Contraction Pattern (VCP)
    const riskPct = cmp > 0 && sl > 0 ? Math.abs((cmp - sl) / cmp * 100) : 10;
    const isVcp = riskPct <= 8.5 && Math.abs(item.pctFromHigh52w || 0) <= 14.0;
    const vcpBonus = isVcp ? Math.round(totalIndianEquityValuation * (isPrime ? 0.003 : 0.002)) : 0; // Dynamic 0.2% - 0.3% of portfolio

    // Factor B: Sector Breadth & Group Rank Momentum
    const isTopSector = topSectors.includes(item.sector);
    const sectorBonus = isTopSector ? Math.round(totalIndianEquityValuation * (isPrime ? 0.003 : 0.002)) : 0; // Dynamic 0.2% - 0.3% of portfolio

    // Sizing for Existing Portfolio Holdings (Pyramiding / Staged Accumulation)
    if (isOwned && heldQty > 0) {
      const avgPrice = Number(holdingObj?.average_buy_price || item.portfolioAvgPrice) || 0;
      const isInProfit = avgPrice > 0 && cmp > avgPrice;
      const gainPct = avgPrice > 0 ? ((cmp / avgPrice - 1) * 100).toFixed(1) : '0.0';
      const heldWeightPct = totalIndianEquityValuation > 0 ? ((currentHeldValue / totalIndianEquityValuation) * 100).toFixed(1) : '0.0';

      // Guard 1: Position Ceiling Check (e.g. Gabriel, Sagility over ceiling)
      if (currentHeldValue >= maxPositionCap) {
        return {
          alloc: 0,
          tierLabel: 'Position Cap Reached (Hold Core)',
          factors: [`Position Cap Reached (${heldWeightPct}% of equity portfolio, holding ₹${Math.round(currentHeldValue).toLocaleString('en-IN')})`],
          summary: `HOLD CORE: Maximum position cap (₹${Math.round(maxPositionCap/1000)}k / ${heldWeightPct}% of portfolio) reached (Holding ₹${Math.round(currentHeldValue).toLocaleString('en-IN')}, +${gainPct}%). Let compounder ride on house money; no additional capital allocated.`
        };
      }

      // Guard 2: Extension Check — Do NOT pyramid into an overextended runner at multi-month highs
      if (isExtended) {
        return {
          alloc: 0,
          tierLabel: 'Extended Runner (Await Pullback)',
          factors: [`Extended Runner (+${pctEma50.toFixed(1)}% above 50-EMA, holding ₹${Math.round(currentHeldValue).toLocaleString('en-IN')})`],
          summary: `STAND ASIDE (HOLD): Holding ${heldQty} shares (₹${Math.round(currentHeldValue).toLocaleString('en-IN')}), but price is extended +${pctEma50.toFixed(1)}% above 50-EMA. Await 50-EMA support retest before adding next pyramid tranche.`
        };
      }

      // Guard 0: Loss Protection — NEVER average down into an unrealized loss.
      // In accordance with Weinstein Stage Analysis & Minervini SEPA, capital is strictly pyramided into confirmed winners (isInProfit = true).
      if (!isInProfit) {
        return {
          alloc: 0,
          tierLabel: 'Loss Protection (No Averaging Down)',
          factors: [`Loss Protection (${gainPct}% in loss, holding ₹${Math.round(currentHeldValue).toLocaleString('en-IN')})`],
          summary: `STAND ASIDE (HOLDING IN LOSS): Holding ${heldQty} shares (₹${Math.round(currentHeldValue).toLocaleString('en-IN')}, ${gainPct}%). Strict momentum discipline: never average down into an unrealized loss. Await positive P&L before allocating additional tranches.`
        };
      }

      // Dynamic Subordinate Pyramid Tranche (Calibrated to portfolio size and conviction tier)
      // Prime / High MPS >= 75: 1.5% of equity portfolio | Standard: 1.0% of equity portfolio
      const pyramidPct = mps >= 75 ? 0.015 : 0.010;
      const pyramidTranche = Math.max(35000, Math.round(totalIndianEquityValuation * pyramidPct));
      const trancheTierLabel = `Pyramid Tranche (${(pyramidPct * 100).toFixed(1)}% · ₹${Math.round(pyramidTranche/1000)}k Addition)`;

      const trancheFactors = [trancheTierLabel];
      let trancheTotal = pyramidTranche;

      if (vcpBonus > 0) {
        trancheTotal += vcpBonus;
        trancheFactors.push(`VCP (+₹${Math.round(vcpBonus/1000)}k)`);
      }
      if (sectorBonus > 0) {
        trancheTotal += sectorBonus;
        trancheFactors.push(`Sector Tailwind (+₹${Math.round(sectorBonus/1000)}k)`);
      }
      trancheFactors.push(`Scaling into strength (+${gainPct}% in profit)`);

      // Dynamic Tranche Ceiling: 2.5% (Prime) or 2.0% (Standard) of total equity valuation (capped at remaining headroom)
      const maxTranchePct = isPrime ? 0.025 : 0.020;
      const trancheCeiling = Math.max(75000, Math.round(totalIndianEquityValuation * maxTranchePct));
      const remainingHeadroom = Math.max(0, maxPositionCap - currentHeldValue);
      const finalTrancheAlloc = Math.min(trancheTotal, remainingHeadroom, trancheCeiling);

      if (finalTrancheAlloc < trancheTotal) {
        trancheFactors.push(`Scaled to max cap headroom (₹${Math.round(finalTrancheAlloc).toLocaleString('en-IN')})`);
      }

      return {
        alloc: Math.round(finalTrancheAlloc),
        tierLabel: trancheTierLabel,
        factors: trancheFactors,
        summary: `Tranche Addition (Holding ${heldQty} shs, ₹${Math.round(currentHeldValue).toLocaleString('en-IN')}): ${trancheFactors.join(' + ')}`
      };
    }

    // Sizing for Brand-New Entries (Zero Existing Exposure)
    if (isExtended) {
      return {
        alloc: 0,
        tierLabel: 'Extended Runner (Await Pullback)',
        factors: [`Extended Runner (+${pctEma50.toFixed(1)}% above 50-EMA)`],
        summary: `STAND ASIDE (AWAIT PULLBACK): Price is extended +${pctEma50.toFixed(1)}% above 50-day EMA. Await healthy base consolidation or pullback toward 50-EMA support before initiating initial position.`
      };
    }

    // Dynamic Base Allocation for Brand-New Entries (Calibrated to portfolio weight tiers):
    // Prime: 2.5% initial starter (building to 10% max)
    // Tier 2: 1.8% initial starter (building to 7% max)
    // Standard: 1.2% initial starter (building to 5% max)
    const primeBase = Math.max(100000, Math.round(totalIndianEquityValuation * 0.025));
    const tier2Base = Math.max(60000, Math.round(totalIndianEquityValuation * 0.018));
    const stdBase = Math.max(40000, Math.round(totalIndianEquityValuation * 0.012));
    const preEarningsFactor = 0.40;

    let base = isPreEarnings ? Math.round(stdBase * preEarningsFactor) : stdBase;
    let tierLabel = isPreEarnings ? `Pre-Earnings Scout Entry (₹${Math.round(base/1000)}k Staged)` : `Catalyst Scout Entry (₹${Math.round(base/1000)}k Base)`;

    if (isPrime) {
      base = isPreEarnings ? Math.round(primeBase * preEarningsFactor) : primeBase;
      tierLabel = isTurnaround
        ? (isPreEarnings ? `Turnaround Pre-Earnings Tranche 1 (₹${Math.round(base/1000)}k Staged)` : `Turnaround Prime Setup (₹${Math.round(base/1000)}k Base)`)
        : (isPreEarnings ? `Prime Pre-Earnings Tranche 1 (₹${Math.round(base/1000)}k Staged)` : `Prime Ultra Conviction (₹${Math.round(base/1000)}k Base)`);
    } else if (isTier2) {
      base = isPreEarnings ? Math.round(tier2Base * preEarningsFactor) : tier2Base;
      tierLabel = isPreEarnings ? `High Conviction Pre-Earnings Tranche 1 (₹${Math.round(base/1000)}k Staged)` : `High Conviction Setup (₹${Math.round(base/1000)}k Base)`;
    } else if (isStd) {
      base = isPreEarnings ? Math.round(stdBase * preEarningsFactor) : stdBase;
      tierLabel = isPreEarnings ? `Standard Pre-Earnings Tranche 1 (₹${Math.round(base/1000)}k Staged)` : `Standard Momentum Setup (₹${Math.round(base/1000)}k Base)`;
    } else if (stance === 'EXTENDED_RUNNER') {
      base = Math.max(20000, Math.round(totalIndianEquityValuation * 0.005));
      tierLabel = `Scout Test Entry (₹${Math.round(base/1000)}k Base)`;
    }

    const factors = [tierLabel];
    if (isPreEarnings) {
      factors.push('Pre-Earnings Staged Entry (Tranche 1: 40% initial allocation; 60% dry powder for post-earnings confirmation)');
    }
    let total = base;

    if (vcpBonus > 0) {
      total += vcpBonus;
      factors.push(`VCP Base Compression (+₹${Math.round(vcpBonus/1000)}k)`);
    }

    if (sectorBonus > 0) {
      total += sectorBonus;
      factors.push(`Sector Tailwind [${item.sector}] (+₹${Math.round(sectorBonus/1000)}k)`);
    }

    return {
      alloc: Math.min(total, maxPositionCap),
      tierLabel,
      factors,
      summary: factors.join(' + ')
    };
  }

  // Build set of all symbols flagged for sell, trim, or floor breach in Sell Analysis
  // Enforces 100% mutual exclusivity: zero stock can ever appear in both Buys and Sells
  const sellSymbolSet = new Set();
  heldAnalyses.forEach(a => {
    if (['FULL_EXIT', 'REVIEW_PARTIAL_SALE', 'REVIEW_FUNDAMENTAL_TRIM', 'REVIEW_RISK_TRIM'].includes(a.action) ||
        ['FULL_EXIT_CANDIDATE', 'TECHNICAL_TRIM_CANDIDATE', 'FUNDAMENTAL_TRIM_CANDIDATE', 'PORTFOLIO_RISK_TRIM'].includes(a.state) ||
        Boolean(a.stopFloorBreached) || Boolean(a.has4RedBreakdown)) {
      sellSymbolSet.add(String(a.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, ''));
    }
  });

  // Deduplicate and pool candidate buys (strictly excluding any sell/trim flagged symbols)
  const seenSymbols = new Set();
  const allCandidatePool = [];

  strongBuys.forEach(x => {
    const sym = String(x.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
    if (!seenSymbols.has(x.symbol) && !sellSymbolSet.has(sym)) {
      seenSymbols.add(x.symbol);
      allCandidatePool.push({ ...x, sourceSignal: 'STRONG_BUY' });
    }
  });

  qualifyingBuys.forEach(x => {
    const sym = String(x.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
    if (!seenSymbols.has(x.symbol) && !sellSymbolSet.has(sym)) {
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
    // Prevents existing positions from creating a starvation blockade against fresh high-MPS explosive breakouts.
    // 1. Prime Turnaround Inflection (+800 pts)
    // 2. High-Conviction Proven Winners Pyramiding (MPS >= 80 & in profit) (+750 pts)
    // 3. Fresh Ultra-Leader Breakouts (MPS >= 90) (+650 pts)
    // 4. Fresh Prime Leaders (MPS >= 80) (+500 pts)
    // 5. Secondary Winner Pyramiding (MPS < 80 & in profit) (+350 pts)
    // 6. Strong Buy Fresh Breakouts (+300 pts)
    // 7. Base MPS (0-100 pts)
    let priorityRank = mps;
    if (isTurnaround) {
      priorityRank += 800;
    } else if (isInProfit && mps >= 80) {
      priorityRank += 750;
    } else if (!isOwned && mps >= 90) {
      priorityRank += 650;
    } else if (!isOwned && mps >= 80) {
      priorityRank += 500;
    } else if (isInProfit) {
      priorityRank += 350;
    } else if (x.sourceSignal === 'STRONG_BUY') {
      priorityRank += 300;
    }

    let actionType = isOwned ? 'BUY - ACCUMULATE (ADD TRANCHE)' : 'BUY - NEW POSITION';
    if (stance === 'PRE_EARNINGS') {
      actionType = isPrime ? 'BUY - PRE-EARNINGS PILOT TRANCHE (40%)' : 'STAND ASIDE (PRE-EARNINGS)';
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
    ? Math.max(50000, Math.round(Number(paramDailyDeploymentCap)))
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
    // Disqualified microcaps (< ₹1,000 Cr) and penny stocks (CMP < ₹20) are strictly excluded from all Action Plan buckets (never queued or exported in CSV)
    const isMicrocapOrPenny = cand.cmp < 20 || (cand.mcap > 0 && cand.mcap < 1000) || cand.sizing?.tierLabel?.includes('Microcap');
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
    const withinDailySpend = (dailySpend + effectiveAmount <= effectiveDeploymentCap) || (immediateBuys.length === 0);
    const withinTotalCapital = remainingCapital >= effectiveAmount;

    if (withinDailyBandwidth && withinDailySpend && withinTotalCapital) {
      const fundedShares = effectiveTargetShares;
      const fundedValue = fundedShares * cand.cmp;
      remainingCapital -= fundedValue;
      dailySpend += fundedValue;
      sectorSpendMap[candSector] = currentSectorSpend + fundedValue;
      sectorCountMap[candSector] = currentSectorCount + 1;
      immediateBuys.push({
        ...cand,
        executionStatus: 'FUNDED TODAY (IMMEDIATE EXECUTION)',
        actionShares: fundedShares,
        actionValue: fundedValue,
        note: cand.isOwned
          ? `Tranche Addition (Holding ${cand.heldQty} shs): ${cand.sizing.summary}. Trail stop at ₹${cand.sl.toFixed(2)}.`
          : `New Entry: ${cand.sizing.summary}. Target ₹${cand.tgt > 0 ? cand.tgt.toFixed(2) : '—'}, Stop ₹${cand.sl.toFixed(2)}.`
      });
    } else {
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

  // 3. Process Algorithmic Sells (strictly performance decay, zero forced selling)
  const activeSells = [];

  fullExits.forEach(a => {
    const cmp = Number(a.currentPrice) || 0;
    const qty = Number(a.quantity) || 0;
    const amt = qty * cmp;
    const trigger = a.chandelierStopPrice || a.sma30Week || 0;

    activeSells.push({
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

  if (recyclingMode === 'FULL_AND_TRIMS') {
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

      activeSells.push({
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
  }

  // Trailing-stop breach sells: live CMP has already broken below the displayed trailing floor.
  // Add them with exact multi-tranche staged share numbers.
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

    activeSells.push({
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

  // 4. Construct Unified CSV Rows with Multi-Tranche Breakdown Columns
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
    'Primary Trigger (INR)',
    'Tranche 1 Shares',
    'Tranche 1 Trigger (INR)',
    'Tranche 2 Shares',
    'Tranche 2 Trigger (INR)',
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
      '—', // Tranche 1 shares (N/A for buy)
      '—',
      '—',
      '—',
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
      s.tranche1Shares || '—',
      s.tranche1Trigger > 0 ? s.tranche1Trigger.toFixed(2) : '—',
      s.tranche2Shares || '—',
      s.tranche2Trigger > 0 ? s.tranche2Trigger.toFixed(2) : '—',
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
      '—', // Tranche 1 shares (N/A for queued buy)
      '—', // Tranche 1 trigger
      '—', // Tranche 2 shares
      '—', // Tranche 2 trigger
      q.heldQty,
      q.note
    ]);
  });

  const csv = rows.map(r => r.map(escapeCsvCell).join(',')).join('\r\n');
  const today = getTodayIST();
  const totalImmediateBuyValue = round2(immediateBuys.reduce((sum, b) => sum + b.actionValue, 0));
  const unallocatedCashBuffer = round2(Math.max(0, totalPurchasingPower - totalImmediateBuyValue));

  const summary = {
    today,
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
    }
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
