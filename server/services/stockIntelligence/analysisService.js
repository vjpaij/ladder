import fs from 'node:fs';
import path from 'node:path';
import { analyzeTechnicalTrend, normalizePriceSeries, observedReturn } from './technicalIndicators.js';
import { STOCK_EXIT_RULE_VERSION } from './backtestEngine.js';
import { fetchCompanyFundamentals } from './screenerFundamentalsProvider.js';
import { calculateXirr } from '../xirrCalculator.js';
import { resolveCanonicalSector } from './buyAnalysisService.js';

function cleanSym(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
}

function priceSeriesFor(symbol, map) {
  const clean = cleanSym(symbol);
  const candidates = [symbol, clean, `${clean}.NS`, `${clean}.BO`].filter(Boolean);
  for (const key of candidates) {
    const series = map?.[key];
    if (series && Object.keys(series).length) return series;
  }
  return {};
}

export function calculateOpenLots(holding, transactions = []) {
  const clean = cleanSym(holding.symbol);
  const rows = transactions.filter(tx => String(tx.holding_id) === String(holding.id)
    || (!tx.holding_id && tx.symbol && cleanSym(tx.symbol) === clean))
    .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!rows.length) return [];
  const lots = [];
  for (const tx of rows) {
    const type = String(tx.type || '').toUpperCase();
    const quantity = Number(tx.quantity) || 0;
    const price = Number(tx.price) || 0;
    const charges = Number(tx.charges) || 0;
    const fx = Number(tx.fx_rate) || (holding.currency === 'USD' ? (Number(holding.fx_rate) || 94.96) : 1.0);
    if (['BUY', 'INVESTMENT', 'INVESTMENT (SIP)', 'DEMERGER', 'MERGER', 'SWAP', 'RIGHTS', 'ALLOTMENT'].includes(type) && quantity > 0) {
      lots.push({ quantity, remaining: quantity, price, charges, fx, date: tx.date });
    } else if (['BONUS', 'SPLIT'].includes(type) && quantity > 0) {
      lots.push({ quantity, remaining: quantity, price: 0, charges: 0, fx, date: tx.date });
    } else if (['SELL', 'REDEEM', 'REDEMPTION'].includes(type)) {
      let remainingToSell = quantity;
      for (const lot of lots) {
        if (remainingToSell <= 0) break;
        const sold = Math.min(lot.remaining, remainingToSell);
        lot.remaining -= sold;
        remainingToSell -= sold;
      }
    }
  }
  return lots.filter(lot => lot.remaining > 0);
}

export function openCostBasisINR(holding, transactions = [], { inrConversion = false } = {}) {
  const clean = cleanSym(holding.symbol);
  const rows = transactions.filter(tx => String(tx.holding_id) === String(holding.id)
    || (!tx.holding_id && tx.symbol && cleanSym(tx.symbol) === clean))
    .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!rows.length) {
    const rawCost = (Number(holding.quantity) || 0) * (Number(holding.avg_buy_price) || 0);
    return inrConversion && holding.currency === 'USD' ? rawCost * (Number(holding.fx_rate) || 94.96) : rawCost;
  }
  const openLots = calculateOpenLots(holding, transactions);
  return openLots.reduce((sum, lot) => {
    const lotCostNative = lot.remaining * lot.price + (lot.quantity > 0 ? lot.remaining / lot.quantity * lot.charges : 0);
    return sum + (inrConversion ? (lotCostNative * (lot.fx || 1.0)) : lotCostNative);
  }, 0);
}

/**
 * Audits recent transaction ledger for this holding to detect intermediate sales or buys
 * within the recent breakdown/review window (last 90 calendar days).
 */
function auditRecentLedgerActivity(holding, transactions = [], today = new Date().toISOString().slice(0, 10)) {
  const clean = cleanSym(holding.symbol);
  const rows = transactions.filter(tx => String(tx.holding_id) === String(holding.id)
    || (!tx.holding_id && tx.symbol && cleanSym(tx.symbol) === clean))
    .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  // Look back 90 calendar days from today for active cycle tracking
  const windowDays = 90;
  const cutoffMs = Date.parse(`${today}T00:00:00Z`) - windowDays * 86400000;

  const cycleSells = [];
  const cycleBuys = [];

  for (const tx of rows) {
    const txMs = Date.parse(`${tx.date || ''}T00:00:00Z`);
    if (isNaN(txMs) || txMs < cutoffMs) continue;

    const type = String(tx.type || '').toUpperCase();
    const quantity = Number(tx.quantity) || 0;
    const price = Number(tx.price) || 0;

    if (['SELL', 'REDEEM', 'REDEMPTION'].includes(type) && quantity > 0) {
      cycleSells.push({ date: tx.date, quantity, price, proceeds: quantity * price });
    } else if (['BUY', 'INVESTMENT', 'INVESTMENT (SIP)', 'DEMERGER', 'MERGER', 'SWAP', 'RIGHTS', 'ALLOTMENT'].includes(type) && quantity > 0) {
      cycleBuys.push({ date: tx.date, quantity, price, cost: quantity * price });
    }
  }

  const recentSharesSold = cycleSells.reduce((sum, s) => sum + s.quantity, 0);
  const totalGrossProceedsLocked = cycleSells.reduce((sum, s) => sum + s.proceeds, 0);
  const avgSellPrice = recentSharesSold > 0 ? totalGrossProceedsLocked / recentSharesSold : null;

  const recentSharesBought = cycleBuys.reduce((sum, b) => sum + b.quantity, 0);
  const totalFreshCostInjected = cycleBuys.reduce((sum, b) => sum + b.cost, 0);
  const avgBuyPrice = recentSharesBought > 0 ? totalFreshCostInjected / recentSharesBought : null;

  const netCycleDelta = recentSharesBought - recentSharesSold;

  return {
    cycleSells,
    cycleBuys,
    recentSharesSold,
    totalGrossProceedsLocked,
    avgSellPrice,
    recentSharesBought,
    totalFreshCostInjected,
    avgBuyPrice,
    netCycleDelta,
    lastSaleDate: cycleSells.length ? cycleSells[cycleSells.length - 1].date : null,
    lastBuyDate: cycleBuys.length ? cycleBuys[cycleBuys.length - 1].date : null
  };
}

/**
 * Deterministic, authentic logical share sizing without arbitrary hardcoded magic constants.
 * Sizing adapts to risk corridor (drawdown from 20w-peak to CMP), fundamental decay, or concentration caps.
 */
function deriveLogicalTrimQuantity({
  currentQuantity,
  currentPrice,
  peak20WeekPrice,
  sma30Week,
  drawdownFrom20WeekHighPct,
  state,
  fundamentals,
  config,
  currentWeightPct,
  totalPortfolioValue
}) {
  if (currentQuantity <= 0 || currentPrice <= 0) {
    return { quantity: 0, method: 'Position closed or invalid price', ratio: 0 };
  }

  // 1. Portfolio Concentration Risk Trim (Highest Priority Sizing)
  const positionLimit = config?.maxPositionWeightPct;
  if (positionLimit && currentWeightPct > positionLimit && totalPortfolioValue > 0) {
    const targetValue = totalPortfolioValue * (positionLimit / 100);
    const excessValue = Math.max(0, (currentQuantity * currentPrice) - targetValue);
    const qty = Math.min(currentQuantity, Math.max(1, Math.ceil(excessValue / currentPrice)));
    return {
      quantity: qty,
      method: `Portfolio concentration cap: Position is ${currentWeightPct.toFixed(1)}% vs your ${positionLimit}% ceiling. Trims ${qty} excess shares to restore target weight.`,
      ratio: qty / currentQuantity
    };
  }

  // 2. Full Exit Candidate (Confluence of Stage 4 decline + fundamental collapse)
  if (state === 'FULL_EXIT_CANDIDATE') {
    return {
      quantity: currentQuantity,
      method: `Full thesis liquidation: 100% of remaining position (${currentQuantity} shares) to protect capital against structural breakdown.`,
      ratio: 1.0
    };
  }

  // 3. Fundamental Trim Candidate (Sized proportionally to margin decay or earnings contraction)
  if (state === 'FUNDAMENTAL_TRIM_CANDIDATE') {
    let decayRatio = 0.33; // baseline one-third trim
    if (fundamentals?.opmDeltaBps && fundamentals.opmDeltaBps < -300) {
      decayRatio = Math.min(0.50, Math.max(0.25, Math.abs(fundamentals.opmDeltaBps) / 1000));
    }
    const qty = Math.min(currentQuantity, Math.max(1, Math.round(currentQuantity * decayRatio)));
    return {
      quantity: qty,
      method: `Fundamental de-risk: Proportional to ${fundamentals?.latestOpmPct !== null ? `${fundamentals.latestOpmPct}% OPM (${fundamentals.opmTrendDirection})` : 'earnings contraction'}. Trims ${qty} shares (${Math.round(decayRatio * 100)}% of current held shares).`,
      ratio: decayRatio
    };
  }

  // 4. Technical Breakdown Trim (Sized by drawdown risk corridor from 20-week high)
  if (state === 'TECHNICAL_TRIM_CANDIDATE') {
    const ddAbs = Math.abs(drawdownFrom20WeekHighPct || 20) / 100;
    // Sized dynamically based on drawdown severity:
    // Pullback <= 20%: 33% standard defensive trim
    // Pullback > 30% severe breakdown / crash: 50% aggressive capital protection
    let dynamicRatio = 0.33;
    if (ddAbs > 0.30) {
      dynamicRatio = 0.50;
    } else if (ddAbs > 0.20) {
      dynamicRatio = Number(Math.min(0.40, ddAbs * 1.3).toFixed(2));
    }
    const qty = Math.min(currentQuantity, Math.max(1, Math.round(currentQuantity * dynamicRatio)));
    return {
      quantity: qty,
      method: `Drawdown risk corridor: Derived from peak ₹${peak20WeekPrice ? peak20WeekPrice.toFixed(0) : '—'} to CMP ₹${currentPrice.toFixed(0)} (${(ddAbs * 100).toFixed(1)}% pullback). Trims ${qty} shares (${Math.round(dynamicRatio * 100)}% of current held shares); keeps core ${currentQuantity - qty} shares riding.`,
      ratio: dynamicRatio
    };
  }

  return { quantity: 0, method: 'No sell trigger', ratio: 0 };
}

/**
 * Builds streamlined 2-tranche staged exit plan & dynamic execution tracker:
 * - Tranche 1 (Initial Stop-Floor Trim): 33% of position at Trailing Stop Floor / Chandelier ATR / 4-Red < 21 EMA.
 * - Tranche 2 (Structural Trend Breakdown): 100% of remaining position on 30-Week SMA breakdown.
 * Tracks recent sales dynamically from ledger; when Tranche 1 is completed and Tranche 2 is not breached,
 * suggested action is to HOLD core position with 0 sales.
 */
function buildStagedExitPlan({ holding, currentPrice, sma30Week, chandelierStopPrice, trailingFloorPrice, state, action, isRecentBuy, pnlFromLatestBuyPct, suggestedSellQuantity, sizingRatio, sizingMethod, ledgerAudit }) {
  const currentQty = Number(holding.quantity) || 0;
  const avgBuyPrice = Number(holding.avg_buy_price || holding.avgBuyPrice || holding.costBasis) || 0;
  const initialFlashStop = avgBuyPrice > 0 ? Number((avgBuyPrice * 0.90).toFixed(2)) : 0;
  const weeklyStopPrice = avgBuyPrice > 0 ? Number((avgBuyPrice * 0.92).toFixed(2)) : 0;
  const stopFloor = Number(trailingFloorPrice || chandelierStopPrice) || 0;
  const sma30Trigger = Number(sma30Week) > 0 ? Number(Number(sma30Week).toFixed(2)) : (stopFloor > 0 ? Number(stopFloor.toFixed(2)) : Number(currentPrice));

  // M6 Empirical Rule: Unproven positions (< +15% gain) defend 100% capital with -10% flash / -8% weekly stop.
  // Proven winners (>= +15% gain) hold 100% until 2 consecutive completed weekly closes below 30-week SMA.
  const hasProfitCushion = avgBuyPrice <= 0 || (pnlFromLatestBuyPct !== null && pnlFromLatestBuyPct !== undefined && Number(pnlFromLatestBuyPct) >= 15);
  const isFullExit = state === 'FULL_EXIT_CANDIDATE' || action === 'FULL_EXIT';
  const isRetestHold = action === 'ACCUMULATION_RETEST';

  const triggerPrice1 = hasProfitCushion
    ? sma30Trigger
    : (initialFlashStop > 0 ? initialFlashStop : (stopFloor || currentPrice));

  const tranche1Triggered = !isRetestHold && (isFullExit || (hasProfitCushion ? false : (currentPrice <= triggerPrice1)));
  const totalActionShares = isFullExit ? currentQty : 0;

  const tranche1 = {
    name: hasProfitCushion
      ? '100% Trend Exit (2-Wk Close < 30w-SMA)'
      : '100% Capital Defense (-10% Flash / -8% Weekly)',
    targetShares: currentQty,
    triggerPrice: triggerPrice1,
    weeklyTriggerPrice: hasProfitCushion ? sma30Trigger : weeklyStopPrice,
    status: isRetestHold ? 'PENDING' : (currentQty > 0 ? (tranche1Triggered ? 'READY' : 'PENDING') : 'INACTIVE'),
    executionNote: isRetestHold
      ? `Initial retest buffer. Hard -10% flash stop at ₹${triggerPrice1} (-8% weekly close at ₹${weeklyStopPrice}).`
      : isFullExit
        ? `100% exit triggered (${currentQty} shares).`
        : hasProfitCushion
          ? `Hold 100% (${currentQty} shares) through daily noise; exit only on 2 consecutive Friday closes below 30w-SMA (₹${triggerPrice1}).`
          : `Unproven (< +15% gain): 100% stop at ₹${triggerPrice1} (-10% flash) / ₹${weeklyStopPrice} (-8% Friday close).`
  };

  const tranche2 = {
    name: 'Single-Stage M6 Unified Exit',
    targetShares: 0,
    triggerPrice: null,
    status: 'INACTIVE',
    executionNote: hasProfitCushion
      ? 'No partial trims — 100% rides with 2-week 30w-SMA trend confirmation.'
      : 'No 33%/67% split — 100% exit protects initial capital cleanly.'
  };

  return {
    tranche1,
    tranche2,
    isSingleStageStop: true,
    hasProfitCushion,
    totalActionShares,
    catchUpSellQuantity: totalActionShares,
    ledgerAudit: {
      ...ledgerAudit,
      auditMessage: ledgerAudit.recentSharesSold > 0
        ? `Recent ledger activity: ${ledgerAudit.recentSharesSold} sold${ledgerAudit.recentSharesBought > 0 ? `, ${ledgerAudit.recentSharesBought} bought` : ''}. Balance: ${currentQty} shares.`
        : 'Active holding: 100% unified exit rule active.'
    }
  };
}

/** Sum only staged share allocations whose price trigger is crossed and which are not ledger-complete. */
export function calculateTriggeredStagedSell(analysis) {
  const plan = analysis?.stagedExitPlan;
  const currentPrice = Number(analysis?.currentPrice) || 0;
  if (!plan || currentPrice <= 0 || analysis?.action === 'ACCUMULATION_RETEST') return { quantity: 0, triggeredTranches: [] };

  const triggeredTranches = [plan.tranche1, plan.tranche2]
    .filter(tranche => tranche
      && tranche.status !== 'COMPLETED'
      && Number(tranche.targetShares) > 0
      && Number(tranche.triggerPrice) > 0
      && currentPrice <= Number(tranche.triggerPrice));
  const quantity = Math.min(
    Number(analysis.quantity) || 0,
    triggeredTranches.reduce((sum, tranche) => sum + Number(tranche.targetShares || 0), 0)
  );

  return { quantity, triggeredTranches };
}

/**
 * Principal Harvest ("Free Ride" / House Money) Calculator
 * Identifies 2x+ multi-bagger positions and calculates exact shares to withdraw 100% original principal
 */
function calculatePrincipalHarvest(holding, currentPrice, investedValueINR) {
  const quantity = Number(holding.quantity) || 0;
  const currentValueINR = quantity * currentPrice;

  if (quantity <= 0 || currentPrice <= 0 || investedValueINR <= 0) {
    return { isEligible: false, sharesToHarvest: 0, capitalRecoveredINR: 0, remainingShares: quantity };
  }

  const gainPct = (currentValueINR / investedValueINR - 1) * 100;
  const isEligible = gainPct >= 100; // doubled (2x) or more

  if (!isEligible) {
    return {
      isEligible: false,
      gainPct: Number(gainPct.toFixed(2)),
      sharesToHarvest: 0,
      capitalRecoveredINR: 0,
      remainingShares: quantity,
      description: `Current gain is ${gainPct.toFixed(1)}%. Becomes eligible for 100% principal harvest once position doubles (+100%).`
    };
  }

  const sharesToHarvest = Math.min(quantity, Math.ceil(investedValueINR / currentPrice));
  const remainingShares = Math.max(0, quantity - sharesToHarvest);
  const capitalRecoveredINR = sharesToHarvest * currentPrice;

  return {
    isEligible: true,
    gainPct: Number(gainPct.toFixed(2)),
    sharesToHarvest,
    capitalRecoveredINR,
    remainingShares,
    description: `Multi-bagger milestone (+${gainPct.toFixed(1)}% gain): Selling ${sharesToHarvest} shares recovers 100% of your ₹${investedValueINR.toLocaleString('en-IN', { maximumFractionDigits: 0 })} initial principal. The remaining ${remainingShares} shares ride as pure "house money" risk-free.`
  };
}

export function buildStockAnalyses(holdings, historicalPriceMap, { today, backtest, config, transactions = [], dividends = [], metadata = [], fundamentalsMap = {}, categoryId = 'in_stocks', candleCache = {}, activeBuyTheses = null, buyTheses = null, buyAnalyses = null } = {}) {
  // Load or extract active buy theses to guarantee cross-engine mutual exclusivity
  let buyThesesSet = null;
  if (activeBuyTheses || buyTheses) {
    buyThesesSet = new Set((activeBuyTheses || buyTheses).map(s => cleanSym(String(s))));
  } else if (Array.isArray(buyAnalyses)) {
    buyThesesSet = new Set(
      buyAnalyses
        .filter(a => ['STRONG_BUY', 'BUY'].includes(a.buySignal))
        .map(a => cleanSym(String(a.symbol)))
    );
  } else {
    try {
      const snapPath = path.join(process.cwd(), 'data', 'buy_analysis_snapshot.json');
      if (fs.existsSync(snapPath)) {
        const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
        buyThesesSet = new Set(
          (snap.analyses || [])
            .filter(a => ['STRONG_BUY', 'BUY'].includes(a.buySignal))
            .map(a => cleanSym(String(a.symbol)))
        );
      }
    } catch (_) {}
  }
  if (!buyThesesSet) buyThesesSet = new Set();
  const metadataBySymbol = new Map(metadata.map(row => [cleanSym(row.symbol), row]));
  const targetCategory = categoryId || 'in_stocks';
  const targetStocks = holdings.filter(item => 
    item.category_id === targetCategory && 
    Number(item.quantity) > 0 && 
    String(item.status || '').toUpperCase() !== 'REDEEMED'
  );

  // Index transactions and dividends once by holdingId and clean symbol for O(1) lookups
  const txByHolding = new Map();
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    if (tx.holding_id) {
      const k = String(tx.holding_id);
      let list = txByHolding.get(k);
      if (!list) { list = []; txByHolding.set(k, list); }
      list.push(tx);
    }
    if (tx.symbol) {
      const k = cleanSym(tx.symbol);
      let list = txByHolding.get(k);
      if (!list) { list = []; txByHolding.set(k, list); }
      list.push(tx);
    }
  }

  const divByHolding = new Map();
  for (let i = 0; i < dividends.length; i++) {
    const div = dividends[i];
    if (div.holding_id) {
      const k = String(div.holding_id);
      let list = divByHolding.get(k);
      if (!list) { list = []; divByHolding.set(k, list); }
      list.push(div);
    }
    if (div.symbol) {
      const k = cleanSym(div.symbol);
      let list = divByHolding.get(k);
      if (!list) { list = []; divByHolding.set(k, list); }
      list.push(div);
    }
  }

  const getHoldingTxs = (holding) => {
    const byId = txByHolding.get(String(holding.id));
    if (byId && byId.length) return byId;
    const bySym = txByHolding.get(cleanSym(holding.symbol));
    return bySym || [];
  };

  const getHoldingDivs = (holding) => {
    const byId = divByHolding.get(String(holding.id));
    if (byId && byId.length) return byId;
    const bySym = divByHolding.get(cleanSym(holding.symbol));
    return bySym || [];
  };

  const interim = targetStocks.map(holding => {
    const clean = cleanSym(holding.symbol);
    const meta = metadataBySymbol.get(clean);
    const candleList = candleCache?.[holding.symbol] || candleCache?.[clean] || null;
    const raw = priceSeriesFor(holding.symbol, historicalPriceMap);
    const prices = normalizePriceSeries(raw);
    const hTxs = getHoldingTxs(holding);
    const openLots = calculateOpenLots(holding, hTxs);
    const earliestOpenLotDate = openLots[0]?.date || null;
    const buyTxs = hTxs.filter(t => ['BUY', 'INVESTMENT', 'INVESTMENT (SIP)'].includes(t.type)).sort((a,b) => (a.date || '').localeCompare(b.date || ''));
    const firstBuyDate = earliestOpenLotDate || buyTxs[0]?.date || null;
    const latestBuy = buyTxs.at(-1);
    const entryPrice = Number(openLots[0]?.price) || Number(holding.avg_buy_price) || Number(latestBuy?.price) || 0;
    const trend = analyzeTechnicalTrend(raw, {
      today,
      candleMapList: candleList,
      entryDate: firstBuyDate,
      entryPrice,
      listingDate: meta?.listing_date || holding.listing_date
    });
    const quantity = Number(holding.quantity) || 0;
    const isUs = targetCategory === 'us_stocks';
    const currency = isUs ? 'USD' : 'INR';
    const currentPrice = Number(holding.current_price) || prices.at(-1)?.close || 0;
    const nativeCurrentPrice = currentPrice;
    const nativeCurrentValue = quantity * nativeCurrentPrice;
    const hDivs = getHoldingDivs(holding);
    const nativeInvestedValue = isUs ? openCostBasisINR(holding, hTxs, { inrConversion: false }) : (Number(holding.investedValueINR) || openCostBasisINR(holding, hTxs));
    const currentValueINR = isUs ? (Number(holding.current_value_inr) || (nativeCurrentValue * (Number(holding.fx_rate) || 94.96))) : nativeCurrentValue;
    const investedValueINR = isUs ? (Number(holding.invested_amount_inr) || openCostBasisINR(holding, hTxs, { inrConversion: true })) : nativeInvestedValue;

    // Compute Holding-Level Cashflows for XIRR (in holding's native currency)
    const flows = hTxs
      .filter(t => ['BUY', 'INVESTMENT', 'INVESTMENT (SIP)', 'SELL', 'REDEEM'].includes(t.type))
      .map(t => {
        const amt = Number(t.total_amount) || (Number(t.quantity) * Number(t.price));
        const ch = Number(t.charges) || 0;
        return {
          date: t.date,
          amount: (t.type === 'BUY' || t.type === 'INVESTMENT' || t.type === 'INVESTMENT (SIP)') ? -(amt + ch) : (amt - ch)
        };
      });
    hDivs.forEach(d => {
      flows.push({ date: d.ex_date || d.payment_date, amount: Number(isUs ? (d.amount_original || d.amount) : (d.amount_inr || d.amount_original || 0)) });
    });
    if (quantity > 0 && nativeCurrentValue > 0) {
      flows.push({ date: today || new Date().toISOString().split('T')[0], amount: nativeCurrentValue });
    }
    const xirrPct = flows.length >= 2 ? calculateXirr(flows) : 0;

    const observed30DayReturn = observedReturn(prices, 30);
    const observed90DayReturn = observedReturn(prices, 90);
    const quoteDate = holding.quote_date || prices.at(-1)?.date || null;
    const lastPriceDate = prices.at(-1)?.date || null;
    const historyQuoteGapPct = currentPrice > 0 && prices.at(-1)?.close > 0
      ? Math.abs(prices.at(-1).close / currentPrice - 1) * 100
      : null;
    const historyAgeDays = lastPriceDate && today
      ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastPriceDate}T00:00:00Z`)) / 86400000)
      : null;
    const staleHistory = historyAgeDays === null || historyAgeDays > 10 || historyAgeDays < 0;
    const inconsistentLatestPrice = historyAgeDays !== null && historyAgeDays <= 3
      && historyQuoteGapPct !== null && historyQuoteGapPct > 45;

    const symClean = cleanSym(holding.symbol);
    const funds = fundamentalsMap[symClean] || { status: 'UNAVAILABLE', source: null, observations: [] };

    return {
      holdingId: String(holding.id),
      symbol: holding.symbol,
      name: holding.name || holding.symbol,
      sector: (holding.sector && holding.sector !== 'Unknown')
        ? holding.sector
        : (meta?.sector && meta.sector !== 'Unknown')
          ? meta.sector
          : resolveCanonicalSector(meta || {}, holding.name, holding.symbol),
      market_cap: (holding.market_cap && holding.market_cap !== 'Unknown')
        ? holding.market_cap
        : (meta?.mcap_category && meta.mcap_category !== 'Unknown')
          ? meta.mcap_category
          : (meta?.capitalisation && meta.capitalisation !== 'Unknown')
            ? meta.capitalisation
            : 'Small Cap',
      market_cap_cr: meta?.market_cap || null,
      quantity,
      currentPrice: nativeCurrentPrice,
      currentValue: nativeCurrentValue,
      currentValueINR,
      investedValue: nativeInvestedValue,
      investedValueINR,
      avgBuyPrice: quantity > 0 ? (nativeInvestedValue / quantity) : (Number(holding.avg_buy_price) || 0),
      xirrPct,
      market: isUs ? 'US' : 'IN',
      currency,
      nsePrice: Number(holding.nse_price) || 0,
      bsePrice: Number(holding.bse_price) || 0,
      dayChange: holding.day_change !== undefined ? Number(holding.day_change) : undefined,
      dayChangePct: holding.day_change_pct !== undefined ? Number(holding.day_change_pct) : undefined,
      quoteDate,
      history: prices.slice(-252).map(row => ({ date: row.date, price: row.close })),
      observed30DayReturn,
      observed90DayReturn,
      ...trend,
      ...(staleHistory ? {
        state: 'DATA_UNAVAILABLE',
        dataQuality: historyAgeDays === null ? 'MISSING_PRICE_HISTORY' : 'STALE_PRICE_HISTORY',
        invalidation: `Latest stored daily close is ${historyAgeDays ?? 'unknown'} calendar days old; refresh prices before evaluating exit rules.`
      } : {}),
      ...(inconsistentLatestPrice ? {
        state: 'DATA_UNAVAILABLE',
        dataQuality: 'PRICE_HISTORY_QUOTE_MISMATCH',
        invalidation: `Latest stored close differs from the holding quote by ${historyQuoteGapPct.toFixed(1)}%. Reconcile quotes before evaluating trend rules.`
      } : {}),
      historyQuoteGapPct,
      latestStoredClose: prices.at(-1)?.close ?? null,
      historyAgeDays,
      fundamentals: funds,
      ruleVersion: STOCK_EXIT_RULE_VERSION
    };
  });

  const totalValue = interim.reduce((sum, item) => sum + item.currentValueINR, 0);

  return interim.map(item => {
    const currentWeightPct = totalValue > 0 ? item.currentValueINR / totalValue * 100 : 0;
    let state = item.state;
    let action = 'MONITOR';

    // 1. Transaction Ledger Audit for Staged Execution & Accumulation Tracking
    const holdingRow = holdings.find(h => String(h.id) === item.holdingId) || item;
    const holdingTxs = getHoldingTxs(holdingRow);
    const ledgerAudit = auditRecentLedgerActivity(holdingRow, holdingTxs, today);

    // Fresh buy tracking: identify positions bought within the last 5 trading days
    const buyTxs = holdingTxs.filter(t => ['BUY', 'INVESTMENT', 'INVESTMENT (SIP)'].includes(t.type)).sort((a,b) => (a.date || '').localeCompare(b.date || ''));
    const latestBuy = buyTxs.at(-1);
    const latestBuyDate = latestBuy?.date || null;
    const latestBuyPrice = Number(latestBuy?.price) || Number(holdingRow.avg_buy_price) || Number(item.avgBuyPrice) || item.currentPrice;
    const pnlFromLatestBuyPct = latestBuyPrice > 0 ? Number(((item.currentPrice / latestBuyPrice - 1) * 100).toFixed(2)) : 0;
    const hasKnownCostBasis = Boolean(latestBuy?.price || Number(holdingRow.avg_buy_price) > 0 || Number(item.avgBuyPrice) > 0);
    const overallAvgPrice = Number(item.avgBuyPrice) || Number(holdingRow.avg_buy_price) || latestBuyPrice;
    const overallPnlPct = (hasKnownCostBasis && overallAvgPrice > 0 && item.currentPrice > 0)
      ? Number(((item.currentPrice / overallAvgPrice - 1) * 100).toFixed(2))
      : pnlFromLatestBuyPct;
    
    // Count actual trading days since latest purchase
    const tradingDatesSinceBuy = (item.history || []).map(r => r.date).filter(d => latestBuyDate && d >= latestBuyDate && d <= today);
    const tradingDaysSinceBuy = latestBuyDate ? Math.max(0, tradingDatesSinceBuy.length - 1) : 999;
    const isRecentBuy = Boolean(latestBuyDate && tradingDaysSinceBuy <= 5);

    // 2. Confluence Decision State Evaluation
    const isStage2Bull = item.weinsteinStage === 2;
    const isStage4Bear = item.weinsteinStage === 4;
    const isTechBreakdown = item.state === 'TECHNICAL_TRIM_CANDIDATE';
    const stopFloorPrice = item.trailingFloorPrice || item.chandelierStopPrice;
    const isStopFloorBreached = stopFloorPrice !== null
      && stopFloorPrice !== undefined
      && item.currentPrice <= stopFloorPrice;
    // Rigorous fundamental decay definition:
    // 1. Severe PAT collapse (< -25% YoY)
    // 2. Margin squeeze with earnings drop (OPM contracting AND YoY PAT < -10%)
    // 3. Dual contraction (Sales < -10% AND YoY PAT < -10%)
    const isSeverePatCollapse = item.fundamentals?.yoyPatGrowthPct !== null && item.fundamentals?.yoyPatGrowthPct !== undefined && item.fundamentals?.yoyPatGrowthPct < -25;
    const isMarginDecayWithEarningsDrop = item.fundamentals?.opmTrendDirection === 'CONTRACTING' && (item.fundamentals?.yoyPatGrowthPct !== null && item.fundamentals?.yoyPatGrowthPct !== undefined && item.fundamentals?.yoyPatGrowthPct < -10);
    const isDualContraction = item.fundamentals?.yoySalesGrowthPct !== null && item.fundamentals?.yoySalesGrowthPct !== undefined && item.fundamentals?.yoySalesGrowthPct < -10
      && item.fundamentals?.yoyPatGrowthPct !== null && item.fundamentals?.yoyPatGrowthPct !== undefined && item.fundamentals?.yoyPatGrowthPct < -10;
    const isFundsDecaying = isSeverePatCollapse || isMarginDecayWithEarningsDrop || isDualContraction;
    const isGovernanceRedFlag = item.fundamentals?.promoterPledgePct > 20;
    const has4RedBreakdown = Boolean(item.has4RedCandlesBelow21Ema);
    const isDataUnavailable = item.state === 'DATA_UNAVAILABLE' && (!item.isIpo || item.dailyObservations < 10 || item.dataQuality === 'PRICE_HISTORY_QUOTE_MISMATCH' || item.dataQuality === 'INSUFFICIENT_HISTORY');
    const isIpoHolding = Boolean(!isDataUnavailable && item.isIpo && item.dailyObservations >= 10 && item.dataQuality !== 'PRICE_HISTORY_QUOTE_MISMATCH');
    const hasProfitCushion = !hasKnownCostBasis || (overallPnlPct !== null && overallPnlPct !== undefined && Number(overallPnlPct) >= 15);

    const isWeeklyBelow8Pct = Boolean(hasKnownCostBasis && !hasProfitCushion && item.weeklyClose > 0 && overallAvgPrice > 0 && item.weeklyClose <= overallAvgPrice * 0.92);
    const is2WkBelowSma30 = Boolean((item.weeksBelowAverage >= 2 && item.sma30Week > 0) || isTechBreakdown);

    // 2. M6 Empirical Confluence Decision Evaluation (100% Unified Exit)
    if (isDataUnavailable) {
      state = 'DATA_UNAVAILABLE';
      action = 'NO_RECOMMENDATION';
    } else if (isIpoHolding) {
      // Adaptive IPO Protection (M6): -10% Flash Cut or -8% Weekly Close when unproven; weekly trailing break if in profit
      if (overallPnlPct <= -20.0 || (item.ipoLow > 0 && item.currentPrice < item.ipoLow * 0.85)) {
        state = 'FULL_EXIT_CANDIDATE';
        action = 'FULL_EXIT';
      } else if (hasKnownCostBasis && overallPnlPct <= -10.0) {
        state = 'FULL_EXIT_CANDIDATE';
        action = 'FULL_EXIT';
      } else if (isWeeklyBelow8Pct) {
        state = 'FULL_EXIT_CANDIDATE';
        action = 'FULL_EXIT';
      } else if (isRecentBuy && overallPnlPct < 0) {
        state = 'NORMAL';
        action = 'ACCUMULATION_RETEST';
      } else if (hasProfitCushion && item.trailingFloorPrice > 0 && item.weeklyClose > 0 && item.weeklyClose <= item.trailingFloorPrice) {
        state = 'FULL_EXIT_CANDIDATE';
        action = 'FULL_EXIT';
      } else {
        state = 'NORMAL';
        action = 'HOLD_AND_COMPOUND';
      }
    } else {
      // M6 Institutional Weekly Trend & Risk Engine
      if (hasKnownCostBasis && overallPnlPct !== null && overallPnlPct !== undefined && overallPnlPct <= -10.0) {
        // -10% Flash Risk Guard: Exit 100% immediately to cap downside
        state = 'FULL_EXIT_CANDIDATE';
        action = 'FULL_EXIT';
      } else if (isWeeklyBelow8Pct) {
        // -8% Weekly Close Failure (< +15% unproven): Exit 100% cleanly
        state = 'FULL_EXIT_CANDIDATE';
        action = 'FULL_EXIT';
      } else if (!hasProfitCushion && (is2WkBelowSma30 && isStage4Bear)) {
        // Structural bear breakdown on unproven holding
        state = 'FULL_EXIT_CANDIDATE';
        action = 'FULL_EXIT';
      } else if (!hasProfitCushion) {
        // Unproven (< +15%): Ignore 1-day news drops, 4-red-candles, and weekday Chandelier noise above -10%
        state = 'NORMAL';
        action = isRecentBuy && overallPnlPct < 0 ? 'ACCUMULATION_RETEST' : 'HOLD_AND_COMPOUND';
      } else if (is2WkBelowSma30 || ((isTechBreakdown || isStage4Bear) && (isFundsDecaying || isGovernanceRedFlag))) {
        // Proven Winner (>= +15%): 2 consecutive Friday weekly closes below 30w-SMA -> 100% Exit
        state = 'FULL_EXIT_CANDIDATE';
        action = 'FULL_EXIT';
      } else if (item.weeksBelowAverage === 1 || item.state === 'WATCH') {
        // 1 weekly close below 30w-SMA: Watch only, await 2nd Friday close before selling
        state = 'WATCH';
        action = 'MONITOR';
      } else {
        // Healthy Winner Compounding: Ignore all weekday volatility and let compounders run 100%
        state = 'NORMAL';
        action = 'HOLD_AND_COMPOUND';
      }
    }

    // 3. Dynamic Logical Sizing & Staged Exit Plan Construction
    const baseSizing = deriveLogicalTrimQuantity({
      currentQuantity: item.quantity,
      currentPrice: item.currentPrice,
      peak20WeekPrice: item.peak20WeekPrice,
      sma30Week: item.sma30Week,
      drawdownFrom20WeekHighPct: item.drawdownFrom20WeekHighPct,
      state,
      fundamentals: item.fundamentals,
      config,
      currentWeightPct,
      totalPortfolioValue: totalValue
    });

    const stagedExitPlan = buildStagedExitPlan({
      holding: item,
      currentPrice: item.currentPrice,
      peak20WeekPrice: item.peak20WeekPrice,
      sma30Week: item.sma30Week,
      chandelierStopPrice: item.chandelierStopPrice,
      trailingFloorPrice: item.trailingFloorPrice,
      state,
      action,
      isRecentBuy,
      pnlFromLatestBuyPct: overallPnlPct,
      suggestedSellQuantity: baseSizing.quantity || 0,
      sizingRatio: baseSizing.ratio,
      sizingMethod: baseSizing.method,
      ledgerAudit
    });

    let suggestedSellQuantity = null;
    let sizingMethod = baseSizing.method;

    const isT1Done = stagedExitPlan.tranche1?.status === 'COMPLETED';
    const isT2Ready = stagedExitPlan.tranche2?.status === 'READY';

    if (action === 'ACCUMULATION_RETEST') {
      suggestedSellQuantity = 0;
      sizingMethod = `Fresh buy within 5-day noise corridor (P&L ${pnlFromLatestBuyPct >= 0 ? '+' : ''}${pnlFromLatestBuyPct}%). Holding through initial retest volatility without premature exit.`;
    } else if (state === 'FULL_EXIT_CANDIDATE' || action === 'FULL_EXIT') {
      suggestedSellQuantity = item.quantity;
      sizingMethod = `M6 Unified 100% Exit (${item.quantity} shares) triggered cleanly by confirmed capital-defense or weekly 30w-SMA rule.`;
    } else if (config?.maxPositionWeightPct && currentWeightPct > config.maxPositionWeightPct && baseSizing.quantity > 0) {
      state = 'PORTFOLIO_RISK_TRIM';
      action = 'REVIEW_RISK_TRIM';
      suggestedSellQuantity = baseSizing.quantity;
      sizingMethod = baseSizing.method;
    } else if (state === 'WATCH' || action === 'MONITOR') {
      suggestedSellQuantity = null;
      sizingMethod = `Watch (1 weekly close < 30w-SMA): Await 2nd consecutive Friday weekly close below ₹${Number(item.sma30Week || 0).toFixed(2)} before selling.`;
    } else if (action === 'HOLD_AND_COMPOUND') {
      suggestedSellQuantity = null;
      sizingMethod = stagedExitPlan.tranche1?.executionNote || `Holding 100% (${item.quantity} shares) cleanly above M6 trigger ₹${stagedExitPlan.tranche1?.triggerPrice || '—'}.`;
    }

    // 5. Principal Harvest ("Free Ride") Option
    const principalHarvest = calculatePrincipalHarvest(item, item.currentPrice, item.investedValueINR);

    // 6. Anti-Early-Exit Compounding Shield
    const compoundingShield = {
      isActive: (state === 'NORMAL' && (isStage2Bull || (isIpoHolding && !isStopFloorBreached && !has4RedBreakdown))),
      title: isIpoHolding ? 'Compounding Active (Adaptive IPO Base)' : 'Compounding Active (Stage 2 Bull)',
      message: isIpoHolding
        ? 'This holding is in a healthy post-listing adaptive base trading safely above its trailing stop floor. Trailing stop protection is active.'
        : 'This holding is in a healthy Stage 2 structural uptrend trading above its trailing safety corridor. Standard bull market consolidations (-15% to -25%) are normal volatility in high-growth Indian compounders. Do not cut early.',
      trailingFloorPrice: item.trailingFloorPrice,
      bufferToTrailingFloorPct: item.bufferToTrailingFloorPct
    };

    // 7. Human-Readable Explanation
    let explanation = '';
    if (state === 'DATA_UNAVAILABLE') {
      explanation = item.invalidation || 'Insufficient price history to evaluate trend.';
    } else if (action === 'ACCUMULATION_RETEST') {
      explanation = `Fresh buy within 5-day noise corridor (P&L ${pnlFromLatestBuyPct >= 0 ? '+' : ''}${pnlFromLatestBuyPct}%). Holding through initial retest volatility without premature exit.`;
    } else if (isT1Done && !isT2Ready && suggestedSellQuantity === 0) {
      explanation = `Tranche 1 trim completed (${ledgerAudit.recentSharesSold} shares sold). Holding core balance of ${item.quantity} shares; final Tranche 2 exit triggers if price breaches 30-week SMA at ₹${stagedExitPlan.tranche2?.triggerPrice}.`;
    } else if (isT2Ready) {
      explanation = `Structural trend breakdown below 30-week SMA (CMP ₹${item.currentPrice.toFixed(2)} vs SMA ₹${stagedExitPlan.tranche2?.triggerPrice}). Review final Tranche 2 exit of remaining ${suggestedSellQuantity} shares.`;
    } else if (pnlFromLatestBuyPct <= -8.0 && state === 'TECHNICAL_TRIM_CANDIDATE') {
      explanation = `Hard risk circuit-breaker: Position is down ${Math.abs(pnlFromLatestBuyPct)}% from entry (CMP ₹${item.currentPrice.toFixed(2)} vs entry ₹${latestBuyPrice.toFixed(2)}), exceeding the 8.0% risk buffer. Review defensive Tranche 1 trim (${suggestedSellQuantity} shares).`;
    } else if (state === 'PORTFOLIO_RISK_TRIM') {
      explanation = `Position weight is ${currentWeightPct.toFixed(2)}%, above your ${config.maxPositionWeightPct}% risk ceiling. The system calculates trimming ${suggestedSellQuantity} shares to return allocation to target ceiling.`;
    } else if (isStopFloorBreached && state === 'TECHNICAL_TRIM_CANDIDATE') {
      const dropPct = stopFloorPrice > 0 ? (((stopFloorPrice - item.currentPrice) / stopFloorPrice) * 100).toFixed(1) : '—';
      explanation = `Trailing stop floor breached! Live CMP ₹${item.currentPrice.toFixed(2)} is ${dropPct}% below stop floor ₹${stopFloorPrice.toFixed(2)}. Review selling ${suggestedSellQuantity} shares (${stagedExitPlan.catchUpSellQuantity > stagedExitPlan.tranche1?.targetShares ? 'staged multi-tranche catch-up' : 'Tranche 1 trim'}); no order is placed automatically.`;
    } else if (has4RedBreakdown && state === 'TECHNICAL_TRIM_CANDIDATE') {
      explanation = `Short-term breakdown: 4 consecutive daily red candles closed below 21-day EMA (${item.distanceToDailyEma21Pct}% below EMA). Review trimming Tranche 1 (${suggestedSellQuantity} shares) to de-risk.`;
    } else if (compoundingShield.isActive) {
      explanation = isIpoHolding
        ? (hasProfitCushion
            ? `Adaptive IPO Shield Active: Trading safely above adaptive trailing floor (+${item.bufferToTrailingFloorPct}% buffer to stop ₹${item.trailingFloorPrice}).`
            : `Adaptive IPO Shield Active: Hold 100% above M6 capital-defense stop ₹${stagedExitPlan.tranche1?.triggerPrice} (-10% flash) / ₹${stagedExitPlan.tranche1?.weeklyTriggerPrice} (-8% Friday close).`)
        : (hasProfitCushion
            ? `Compounding Active: Holding 100% above 30w-SMA (₹${Number(item.sma30Week || 0).toFixed(2)}). Ignore weekday noise.`
            : `Above stop protection (₹${overallAvgPrice > 0 ? (overallAvgPrice * 0.90).toFixed(2) : '—'}). Hold 100%.`);
    } else if (state === 'TECHNICAL_TRIM_CANDIDATE') {
      explanation = `Three completed weekly closes are below a falling 30-week average (CMP ₹${item.currentPrice} vs SMA ₹${item.sma30Week?.toFixed(1)}). Review trimming Tranche 1 (${suggestedSellQuantity} shares) while letting core position ride.`;
    } else if (state === 'FUNDAMENTAL_TRIM_CANDIDATE') {
      const patDrop = item.fundamentals?.yoyPatGrowthPct;
      const patNote = patDrop !== null && patDrop !== undefined ? ` (YoY PAT ${patDrop > 0 ? `+${patDrop}%` : `${patDrop}%`})` : '';
      explanation = `Fundamentals show earnings deterioration (${item.fundamentals?.opmTrendDirection?.toLowerCase()} margins at ${item.fundamentals?.latestOpmPct || '—'}%${patNote}). Review trimming ${suggestedSellQuantity} shares in line with earnings deceleration.`;
    } else if (state === 'FULL_EXIT_CANDIDATE') {
      if (hasKnownCostBasis && overallPnlPct <= -10.0) {
        explanation = `-10% Flash Stop Breached: Down ${overallPnlPct}% vs Avg ₹${overallAvgPrice.toFixed(2)}. Exit 100% (${suggestedSellQuantity} shs).`;
      } else if (isWeeklyBelow8Pct) {
        explanation = `-8% Weekly Close Failure: Closed week at ₹${item.weeklyClose?.toFixed(2)} vs Avg ₹${overallAvgPrice.toFixed(2)}. Exit 100% (${suggestedSellQuantity} shs).`;
      } else if (is2WkBelowSma30) {
        explanation = `${item.weeksBelowAverage >= 2 ? '2 Consecutive Weekly Closes' : 'Confirmed Trend Break'} Below 30w-SMA (₹${Number(item.sma30Week || 0).toFixed(2)}). Exit 100% (${suggestedSellQuantity} shs).`;
      } else {
        explanation = `Bearish breakdown with fundamental deterioration. Exit 100% (${suggestedSellQuantity} shs).`;
      }
    } else if (state === 'WATCH') {
      explanation = `1 weekly close below 30w-SMA (₹${Number(item.sma30Week || 0).toFixed(2)}). Awaiting 2nd Friday close before exit.`;
    } else {
      explanation = hasProfitCushion
        ? `Healthy winner (+${overallPnlPct}%): Hold 100% through daily noise above 30w-SMA (₹${Number(item.sma30Week || 0).toFixed(2)}).`
        : `Above stop protection (₹${overallAvgPrice > 0 ? (overallAvgPrice * 0.90).toFixed(2) : '—'}). Hold 100%.`;
    }

    return {
      ...item,
      state,
      action,
      currentWeightPct,
      suggestedSellQuantity,
      sizingMethod,
      referencePrice: item.currentPrice,
      referencePriceDate: item.quoteDate,
      estimatedGrossProceedsINR: suggestedSellQuantity ? suggestedSellQuantity * item.currentPrice : null,
      technicalState: item.state,
      stopFloorBreached: isStopFloorBreached,
      has4RedBreakdown,
      isRecentBuy,
      pnlFromLatestBuyPct,
      latestBuyPrice,
      latestBuyDate,
      tradingDaysSinceBuy,
      liveBufferToTrailingFloorPct: item.trailingFloorPrice > 0
        ? Number(((item.currentPrice / item.trailingFloorPrice - 1) * 100).toFixed(2))
        : null,
      tag4Red21Ema: item.has4RedCandlesBelow21Ema ? '4 Red < 21 EMA' : null,
      explanation,
      stagedExitPlan,
      // Flat multi-stage share breakdown for direct access across UI, Action Plan, and CSV
      tranche1Shares: stagedExitPlan.tranche1?.targetShares || 0,
      tranche1Trigger: stagedExitPlan.tranche1?.triggerPrice || 0,
      tranche1Status: stagedExitPlan.tranche1?.status || 'PENDING',
      tranche2Shares: stagedExitPlan.tranche2?.targetShares || 0,
      tranche2Trigger: stagedExitPlan.tranche2?.triggerPrice || 0,
      tranche2Status: stagedExitPlan.tranche2?.status || 'PENDING',
      totalActionShares: suggestedSellQuantity || 0,
      principalHarvest,
      compoundingShield,
      invalidation: item.invalidation || 'Review rules'
    };
  });
}

export function buildPortfolioSummary(analyses) {
  const totalValueINR = analyses.reduce((sum, item) => sum + item.currentValueINR, 0);
  const totalCostINR = analyses.reduce((sum, item) => sum + item.investedValueINR, 0);
  const counts = analyses.reduce((result, item) => {
    result[item.state] = (result[item.state] || 0) + 1;
    return result;
  }, {});
  return {
    activePositions: analyses.length,
    totalValueINR,
    totalCostINR,
    unrealizedPnlINR: totalValueINR - totalCostINR,
    states: counts,
    compoundingCount: analyses.filter(item => item.compoundingShield?.isActive).length,
    stopFloorBreachesCount: analyses.filter(item => item.stopFloorBreached).length,
    fourRedBelow21EmaCount: analyses.filter(item => item.has4RedCandlesBelow21Ema).length,
    withPriceHistory: analyses.filter(item => item.weeklyObservations > 0).length,
    fundamentalsAvailable: analyses.filter(item => item.fundamentals.status === 'AVAILABLE').length
  };
}

/**
 * Single Canonical Stop-Loss & GTT Order Resolver.
 * Guarantees 100% mathematical parity between Sell Analysis (stagedExitPlan) and Next Day Action Plan GTTs.
 */
export function resolveCanonicalGttOrder(a, activeGtt = null) {
  const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const cmp = Number(a.currentPrice || a.cmp) || 0;
  const avg = Number(a.avgBuyPrice) || 0;
  const qty = Number(a.quantity || a.qty) || 0;
  const val = round2(qty * cmp);
  const pnlPct = avg > 0 && cmp > 0 ? round2(((cmp - avg) / avg) * 100) : round2(Number(a.pnlPct) || 0);

  const ema50 = round2(a.ema50 || a.daily21Ema?.ema50 || 0);
  const sma30 = round2(a.sma30Week || a.sma30 || 0);
  const atrFloor = round2(a.trailingFloorPrice || a.chandelierStopPrice || 0);

  const t1Trigger = round2(a.stagedExitPlan?.tranche1?.triggerPrice || a.tranche1Trigger || 0);
  const hasProfitCushion = avg <= 0 || pnlPct >= 15;

  let action = 'MAINTAIN GTT SL';
  let actionType = 'MAINTAIN';
  let targetSlPrice = 0;
  const targetQty = qty;
  let trancheStage = 'CAPITAL DEFENSE (100%)';
  let tier = 'INITIAL_10PCT';
  let reason = '';
  let badgeColor = 'amber';

  if (hasProfitCushion) {
    targetSlPrice = sma30 > 0 ? sma30 : (t1Trigger > 0 ? t1Trigger : (atrFloor > 0 ? atrFloor : round2(avg * 1.05)));
    trancheStage = '30W-SMA TREND EXIT (100%)';
    tier = 'SMA30_TREND_EXIT';
    action = 'AMEND GTT SL -> 30W-SMA (100%)';
    actionType = 'AMEND_CORE_RUNNER';
    badgeColor = 'cyan';
    reason = `Winner (+${pnlPct.toFixed(1)}%): Protect 100% (${targetQty} shs) at 30W-SMA (₹${targetSlPrice.toFixed(2)}); exit only on 2 consecutive weekly closes below SMA.`;
  } else {
    targetSlPrice = t1Trigger > 0 ? t1Trigger : round2(avg * 0.90);
    trancheStage = 'CAPITAL DEFENSE (100%)';
    tier = 'INITIAL_10PCT';
    action = 'SET GTT SL -> -10% FLASH (100%)';
    actionType = 'SET_INITIAL';
    badgeColor = 'amber';
    reason = `Unproven (< +15% gain): Protect 100% (${targetQty} shs) at ₹${targetSlPrice.toFixed(2)} (-10% flash / -8% Friday close).`;
  }

  const activeGttPrice = activeGtt && Number(activeGtt.triggerPrice) > 0 ? round2(Number(activeGtt.triggerPrice)) : null;
  const activeGttQty = activeGtt && Number(activeGtt.targetQty) > 0 ? Number(activeGtt.targetQty) : null;
  const isTierTransition = (tier === 'SMA30_TREND_EXIT' && activeGtt?.tier !== 'SMA30_TREND_EXIT');

  // Ratchet forward on 30w-SMA upgrades without letting unproven stops creep down
  if (!isTierTransition && cmp > 0 && targetSlPrice < cmp) {
    if (activeGttPrice !== null && targetSlPrice < activeGttPrice && activeGttPrice < cmp) {
      targetSlPrice = activeGttPrice;
    }
  }

  const isPriceBelowTrigger = cmp > 0 && targetSlPrice > 0 && cmp <= targetSlPrice;
  const isConfirmedExit = a.state === 'FULL_EXIT_CANDIDATE' || a.action === 'FULL_EXIT' || (!hasProfitCushion && isPriceBelowTrigger);
  let gttStatus = 'ACTION_REQUIRED_NEW';
  let gttStatusLabel = 'ACTION: SET NEW GTT';
  let gttStatusBadge = 'amber';
  let slDelta = 0;
  let slDeltaPct = 0;
  let isActionRequired = true;

  if (isConfirmedExit) {
    gttStatus = 'STOP_BREACHED_SELL_NOW';
    gttStatusLabel = 'STOP BREACHED — SELL NOW';
    gttStatusBadge = 'rose';
    isActionRequired = true;
    action = 'EXECUTE 100% EXIT NOW';
    reason = `FULL EXIT TRIGGERED: Exit 100% (${targetQty} shs) at CMP ₹${cmp.toFixed(2)} (trigger ₹${targetSlPrice.toFixed(2)}, matches Sell Analysis).`;
  } else if (hasProfitCushion && isPriceBelowTrigger) {
    // Mid-week dip below 30w-SMA not yet confirmed on 2 Friday closes
    gttStatus = 'WATCH_WEEKLY_CLOSE';
    gttStatusLabel = 'WATCH (AWAIT 2-WK CLOSE)';
    gttStatusBadge = 'amber';
    isActionRequired = false;
    reason = `Mid-week test below 30W-SMA ₹${targetSlPrice.toFixed(2)} (CMP ₹${cmp.toFixed(2)}). M6 waits for 2 consecutive Friday closes before selling.`;
  } else if (!activeGttPrice) {
    gttStatus = 'ACTION_REQUIRED_NEW';
    gttStatusLabel = 'ACTION: SET NEW GTT';
    gttStatusBadge = 'amber';
    isActionRequired = true;
  } else if (isTierTransition && Math.abs(targetSlPrice - activeGttPrice) > 1) {
    slDelta = round2(targetSlPrice - activeGttPrice);
    slDeltaPct = round2(((targetSlPrice - activeGttPrice) / activeGttPrice) * 100);
    gttStatus = 'ACTION_REQUIRED_AMEND';
    gttStatusLabel = 'AMEND GTT (-> 30W-SMA)';
    gttStatusBadge = 'cyan';
    isActionRequired = true;
    reason = `Graduated to Winner (+${pnlPct.toFixed(1)}%): Update GTT from ₹${activeGttPrice.toFixed(2)} to 30W-SMA ₹${targetSlPrice.toFixed(2)} (100% · ${targetQty} shs).`;
  } else if (targetSlPrice >= round2(activeGttPrice * 1.005) || (activeGttQty !== null && activeGttQty !== targetQty)) {
    slDelta = round2(targetSlPrice - activeGttPrice);
    slDeltaPct = round2(((targetSlPrice - activeGttPrice) / activeGttPrice) * 100);
    gttStatus = 'ACTION_REQUIRED_AMEND';
    gttStatusLabel = slDelta >= 0.5 ? `AMEND GTT (+₹${slDelta.toFixed(2)})` : `AMEND GTT (${targetQty} shs)`;
    gttStatusBadge = 'emerald';
    isActionRequired = true;
    reason = `GTT Amendment: Stop trigger ₹${targetSlPrice.toFixed(2)} for ${targetQty} shs (Broker: ₹${activeGttPrice.toFixed(2)}). ${reason}`;
  } else {
    gttStatus = 'UP_TO_DATE';
    gttStatusLabel = 'IN SYNC (ACTIVE)';
    gttStatusBadge = 'slate';
    isActionRequired = false;
    reason = `GTT Active: Trigger ₹${activeGttPrice.toFixed(2)} matches current M6 stop (${targetQty} shs).`;
  }

  const distanceToSlPct = cmp > 0 && targetSlPrice > 0 ? Number((((cmp - targetSlPrice) / cmp) * 100).toFixed(2)) : 0;
  const isNearSl = isConfirmedExit || (distanceToSlPct <= 3.0 && distanceToSlPct >= 0);

  return {
    symbol: a.symbol,
    name: a.name,
    qty,
    targetQty,
    trancheStage,
    cmp,
    avgBuyPrice: round2(avg),
    val,
    pnlPct,
    targetSlPrice,
    tier,
    action,
    actionLabel: action,
    actionType,
    distanceToSlPct,
    slBufferPct: distanceToSlPct,
    isNearSl,
    isBreached: isConfirmedExit,
    badgeColor,
    reason,
    rationale: reason,
    ema50,
    sma30,
    weinsteinStage: a.weinsteinStage || 2,
    sector: a.sector || 'Diversified',
    activeGttPrice,
    activeGttSetAt: activeGtt?.setAt || null,
    gttStatus,
    gttStatusLabel,
    gttStatusBadge,
    slDelta,
    slDeltaPct,
    isActionRequired
  };
}
