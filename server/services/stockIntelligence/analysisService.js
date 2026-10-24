import fs from 'node:fs';
import path from 'node:path';
import { analyzeTechnicalTrend, normalizePriceSeries, observedReturn } from './technicalIndicators.js';
import { STOCK_EXIT_RULE_VERSION } from './backtestEngine.js';
import { fetchCompanyFundamentals } from './screenerFundamentalsProvider.js';
import { calculateXirr } from '../xirrCalculator.js';

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

export function openCostBasisINR(holding, transactions = [], { inrConversion = false } = {}) {
  const clean = cleanSym(holding.symbol);
  const rows = transactions.filter(tx => String(tx.holding_id) === String(holding.id)
    || (!tx.holding_id && tx.symbol && cleanSym(tx.symbol) === clean))
    .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!rows.length) {
    const rawCost = (Number(holding.quantity) || 0) * (Number(holding.avg_buy_price) || 0);
    return inrConversion && holding.currency === 'USD' ? rawCost * (Number(holding.fx_rate) || 94.96) : rawCost;
  }
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
  return lots.reduce((sum, lot) => {
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
 * Builds staged multi-tranche exit plan & dynamic execution tracker.
 * Each target is a non-overlapping allocation of the position at the start of
 * the recent 90-day cycle; later stages wait for previous stage sales in ledger.
 */
function buildStagedExitPlan({ holding, currentPrice, sma30Week, chandelierStopPrice, trailingFloorPrice, state, suggestedSellQuantity, sizingRatio, sizingMethod, ledgerAudit }) {
  const currentQty = Number(holding.quantity) || 0;
  const stopFloor = Number(trailingFloorPrice || chandelierStopPrice) || 0;
  // A falling price crosses the higher protective floor before the lower 30w SMA.
  const triggers = [Number(sma30Week) || 0, stopFloor].filter(price => price > 0).sort((a, b) => b - a);
  const triggerPrice1 = Number((triggers[0] || currentPrice).toFixed(2));
  const triggerPrice2 = Number((triggers[1] || triggerPrice1 * 0.90).toFixed(2));
  const tranche3TriggerPrice = Number((triggerPrice2 * 0.85).toFixed(2));

  const isFullExit = state === 'FULL_EXIT_CANDIDATE';
  const cycleStartQuantity = Math.max(currentQty, currentQty + (ledgerAudit.recentSharesSold || 0) - (ledgerAudit.recentSharesBought || 0));

  // Dynamically calibrate Tranche 1 ratio based on state and risk corridor:
  // - FULL_EXIT_CANDIDATE: 100% (Sell ALL)
  // - Sizing ratio from drawdown or fundamental decay (e.g. 50% for severe crash >30% or margin decay, 33% standard)
  const dynamicT1Ratio = isFullExit 
    ? 1.0 
    : (sizingRatio && sizingRatio > 0 ? Math.min(1.0, Math.max(0.20, sizingRatio)) : 0.33);

  const tranche1Quantity = cycleStartQuantity > 0
    ? (isFullExit ? currentQty : Math.min(cycleStartQuantity, Math.max(1, Math.round(cycleStartQuantity * dynamicT1Ratio))))
    : 0;

  const stagedPositionQuantity = Math.max(currentQty, currentQty + (ledgerAudit.recentSharesSold || 0));
  const remainingAfterTranche1 = Math.max(0, stagedPositionQuantity - tranche1Quantity);

  // Tranche 2 dynamically targets remaining balance or 50% of remaining position
  const dynamicT2Ratio = isFullExit ? 0 : (dynamicT1Ratio >= 0.50 ? 1.0 : 0.33);
  const tranche2Quantity = isFullExit 
    ? 0 
    : (remainingAfterTranche1 > 0 ? Math.min(remainingAfterTranche1, Math.max(1, Math.round(remainingAfterTranche1 * dynamicT2Ratio))) : 0);

  const tranche1Complete = tranche1Quantity > 0 && (ledgerAudit.recentSharesSold || 0) >= tranche1Quantity;
  const tranche2Complete = tranche1Complete && (ledgerAudit.recentSharesSold || 0) >= tranche1Quantity + tranche2Quantity;
  const tranche3Quantity = isFullExit
    ? 0
    : (tranche2Complete ? currentQty : Math.max(0, remainingAfterTranche1 - tranche2Quantity));

  const tranche1Triggered = currentPrice <= triggerPrice1;
  const tranche2Breached = currentPrice <= triggerPrice2;
  const tranche3Breached = currentPrice <= tranche3TriggerPrice;

  const tranche2Triggered = tranche2Breached && !tranche2Complete;
  const tranche3Triggered = tranche3Breached;

  const catchUpSellQuantity = isFullExit
    ? currentQty
    : Math.min(currentQty,
        (tranche1Triggered && !tranche1Complete ? tranche1Quantity : 0)
        + (tranche2Breached && !tranche2Complete ? tranche2Quantity : 0)
        + (tranche3Breached ? tranche3Quantity : 0));

  const totalActionShares = isFullExit
    ? currentQty
    : Math.min(currentQty,
        (tranche1Triggered && !tranche1Complete ? tranche1Quantity : 0)
        + (tranche2Triggered ? tranche2Quantity : 0)
        + (tranche3Triggered ? tranche3Quantity : 0));

  const tranche1 = {
    name: 'Tranche 1 (Initial Stop-Floor Trim)',
    targetShares: tranche1Quantity,
    triggerPrice: triggerPrice1,
    status: tranche1Complete ? 'COMPLETED' : (tranche1Quantity > 0 ? (tranche1Triggered ? 'READY' : 'PENDING') : 'INACTIVE'),
    executionNote: tranche1Complete
      ? `Tranche 1 appears completed from recent ledger sales (${ledgerAudit.recentSharesSold} sold, ${ledgerAudit.recentSharesBought} bought).`
      : tranche1Triggered
        ? `First stage triggered. Review selling ${tranche1Quantity} shares; estimated remaining position: ${Math.max(0, currentQty - tranche1Quantity)} shares.`
        : `At or below ₹${triggerPrice1}, review selling ${tranche1Quantity} shares as the first stage.`
  };

  const tranche2 = {
    name: 'Tranche 2 (30-Week Trend Breakdown)',
    targetShares: tranche2Quantity,
    triggerPrice: triggerPrice2,
    status: tranche2Complete ? 'COMPLETED' : (tranche2Triggered ? 'READY' : (tranche2Breached ? 'ARMED' : 'PENDING')),
    executionNote: tranche2Complete
      ? `Tranche 2 appears completed from recent ledger sales (${ledgerAudit.recentSharesSold} sold, ${ledgerAudit.recentSharesBought} bought).`
      : tranche2Triggered && !tranche1Complete
        ? tranche3Breached
          ? `Price has crossed all three stage triggers before sales were recorded. Review the full staged catch-up of ${catchUpSellQuantity} shares across Tranches 1, 2, and 3.`
          : `Price has crossed both stage triggers before Tranche 1 was recorded. Catch up by reviewing ${catchUpSellQuantity} shares total (${tranche1Quantity} first-stage + ${tranche2Quantity} second-stage).`
        : tranche2Triggered
          ? `Second stage triggered after Tranche 1. Review selling ${tranche2Quantity} shares; estimated remaining position: ${Math.max(0, currentQty - tranche2Quantity)} shares.`
        : tranche2Breached
          ? `Second-stage price level crossed. Complete and record Tranche 1 (${tranche1Quantity} shares) before selling this ${tranche2Quantity}-share stage.`
          : `If price falls to ₹${triggerPrice2} after Tranche 1, review selling ${tranche2Quantity} additional shares.`
  };

  const tranche3 = {
    name: 'Tranche 3 (Structural Thesis Exit)',
    targetShares: tranche3Quantity,
    triggerPrice: tranche3TriggerPrice,
    status: tranche3Quantity <= 0 ? 'COMPLETED' : (tranche3Triggered ? 'READY' : 'CONTINGENT'),
    executionNote: tranche3Quantity <= 0
      ? 'No shares remain allocated to the final stage.'
      : tranche3Triggered && (!tranche1Complete || !tranche2Complete)
        ? `Final-stage floor crossed before earlier stages were recorded. Catch up across every breached, incomplete stage; total outstanding triggered shares: ${catchUpSellQuantity}.`
        : tranche3Triggered
        ? `Final stage triggered. Review selling the remaining planned ${tranche3Quantity} shares; no order is placed automatically.`
        : `After Tranches 1 and 2, review selling the remaining ${tranche3Quantity} shares if price breaches ₹${tranche3TriggerPrice}.`
  };

  return {
    tranche1,
    tranche2,
    tranche3,
    totalActionShares,
    catchUpSellQuantity,
    ledgerAudit: {
      ...ledgerAudit,
      auditMessage: ledgerAudit.recentSharesSold > 0
        ? `Executed sale detected: ${ledgerAudit.recentSharesSold} shares sold recently.${ledgerAudit.recentSharesBought > 0 ? ` (+${ledgerAudit.recentSharesBought} shares bought since).` : ''} Current balance today is ${currentQty} shares.`
        : 'No recent sales recorded in the ledger for this holding.'
    }
  };
}

/** Sum only staged share allocations whose price trigger is crossed and which are not ledger-complete. */
export function calculateTriggeredStagedSell(analysis) {
  const plan = analysis?.stagedExitPlan;
  const currentPrice = Number(analysis?.currentPrice) || 0;
  if (!plan || currentPrice <= 0) return { quantity: 0, triggeredTranches: [] };

  const triggeredTranches = [plan.tranche1, plan.tranche2, plan.tranche3]
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
  const targetStocks = holdings.filter(item => item.category_id === targetCategory && Number(item.quantity) > 0);

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
    const candleList = candleCache?.[holding.symbol] || candleCache?.[clean] || null;
    const raw = priceSeriesFor(holding.symbol, historicalPriceMap);
    const prices = normalizePriceSeries(raw);
    const trend = analyzeTechnicalTrend(raw, { today, candleMapList: candleList });
    const quantity = Number(holding.quantity) || 0;
    const isUs = targetCategory === 'us_stocks';
    const currency = isUs ? 'USD' : 'INR';
    const currentPrice = Number(holding.current_price) || prices.at(-1)?.close || 0;
    const nativeCurrentPrice = currentPrice;
    const nativeCurrentValue = quantity * nativeCurrentPrice;
    const hTxs = getHoldingTxs(holding);
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
    const meta = metadataBySymbol.get(cleanSym(holding.symbol));

    const symClean = cleanSym(holding.symbol);
    const funds = fundamentalsMap[symClean] || { status: 'UNAVAILABLE', source: null, observations: [] };

    return {
      holdingId: String(holding.id),
      symbol: holding.symbol,
      name: holding.name || holding.symbol,
      sector: (holding.sector && holding.sector !== 'Unknown' ? holding.sector : meta?.sector) || null,
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
    const ledgerAudit = auditRecentLedgerActivity(holdingRow, getHoldingTxs(holdingRow), today);

    // 2. Confluence Decision State Evaluation
    const isStage2Bull = item.weinsteinStage === 2;
    const isStage4Bear = item.weinsteinStage === 4;
    const isTechBreakdown = item.state === 'TECHNICAL_TRIM_CANDIDATE';
    const stopFloorPrice = item.trailingFloorPrice || item.chandelierStopPrice;
    const isStopFloorBreached = stopFloorPrice !== null
      && stopFloorPrice !== undefined
      && item.currentPrice <= stopFloorPrice;
    const isFundsDecaying = item.fundamentals?.opmTrendDirection === 'CONTRACTING' || (item.fundamentals?.yoyPatGrowthPct !== null && item.fundamentals?.yoyPatGrowthPct < -25);
    const isGovernanceRedFlag = item.fundamentals?.promoterPledgePct > 20;
    const has4RedBreakdown = Boolean(item.has4RedCandlesBelow21Ema);

    if (item.state !== 'DATA_UNAVAILABLE') {
      if ((isTechBreakdown || isStage4Bear) && (isFundsDecaying || isGovernanceRedFlag)) {
        // Confluence of structural bear/breakdown and fundamental deterioration = Full Exit
        state = 'FULL_EXIT_CANDIDATE';
        action = 'FULL_EXIT';
      } else if (isStopFloorBreached) {
        // Stop floor breach is the non-negotiable risk trigger: MUST trigger partial sale review
        state = 'TECHNICAL_TRIM_CANDIDATE';
        action = 'REVIEW_PARTIAL_SALE';
      } else if (has4RedBreakdown) {
        // 4 consecutive daily red candles closed below 21-EMA (>= 5% below EMA)
        state = 'TECHNICAL_TRIM_CANDIDATE';
        action = 'REVIEW_PARTIAL_SALE';
      } else if (isTechBreakdown) {
        // 3 completed weekly closes below falling 30-week SMA
        state = 'TECHNICAL_TRIM_CANDIDATE';
        action = 'REVIEW_PARTIAL_SALE';
      } else if (isFundsDecaying) {
        state = 'FUNDAMENTAL_TRIM_CANDIDATE';
        action = 'REVIEW_FUNDAMENTAL_TRIM';
      } else if (isStage2Bull && !isGovernanceRedFlag && !isStopFloorBreached && !has4RedBreakdown) {
        // Multi-Bagger Compounding Guard Active: healthy Stage 2 trading safely above safety corridor
        state = 'NORMAL';
        action = 'HOLD_AND_COMPOUND';
      } else if (item.state === 'WATCH') {
        action = 'MONITOR';
      } else {
        state = 'NORMAL';
        action = 'HOLD';
      }
    } else {
      action = 'NO_RECOMMENDATION';
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
      suggestedSellQuantity: baseSizing.quantity || 0,
      sizingRatio: baseSizing.ratio,
      sizingMethod: baseSizing.method,
      ledgerAudit
    });

    let suggestedSellQuantity = null;
    let sizingMethod = baseSizing.method;

    if (state === 'FULL_EXIT_CANDIDATE') {
      suggestedSellQuantity = item.quantity;
      sizingMethod = `Full thesis liquidation: 100% of remaining position (${item.quantity} shares) to protect capital against structural breakdown.`;
    } else if (config?.maxPositionWeightPct && currentWeightPct > config.maxPositionWeightPct && baseSizing.quantity > 0) {
      state = 'PORTFOLIO_RISK_TRIM';
      action = 'REVIEW_RISK_TRIM';
      suggestedSellQuantity = baseSizing.quantity;
      sizingMethod = baseSizing.method;
    } else if (state === 'FUNDAMENTAL_TRIM_CANDIDATE') {
      suggestedSellQuantity = baseSizing.quantity;
      sizingMethod = baseSizing.method;
    } else if (state === 'TECHNICAL_TRIM_CANDIDATE') {
      // Use the exact staged catch-up quantity across breached tranches, or at least Tranche 1
      const planShares = stagedExitPlan.totalActionShares > 0
        ? stagedExitPlan.totalActionShares
        : (baseSizing.quantity > 0 ? baseSizing.quantity : Math.max(1, Math.round(item.quantity * 0.33)));
      suggestedSellQuantity = Math.min(item.quantity, planShares);

      if (isStopFloorBreached) {
        const breachFloorStr = stopFloorPrice ? stopFloorPrice.toFixed(2) : '—';
        sizingMethod = stagedExitPlan.catchUpSellQuantity > stagedExitPlan.tranche1?.targetShares
          ? `Multiple triggers breached below ₹${breachFloorStr}. Staged catch-up: Sell ${suggestedSellQuantity} shares across breached tranches.`
          : `Trailing stop floor breached at ₹${item.currentPrice.toFixed(2)} (floor ₹${breachFloorStr}). Review Tranche 1 staged trim of ${suggestedSellQuantity} shares.`;
      } else if (has4RedBreakdown) {
        sizingMethod = `4 consecutive red candles closed below 21-day EMA (${item.distanceToDailyEma21Pct}% below EMA). Review defensive Tranche 1 trim of ${suggestedSellQuantity} shares.`;
      }
    }

    // 5. Principal Harvest ("Free Ride") Option
    const principalHarvest = calculatePrincipalHarvest(item, item.currentPrice, item.investedValueINR);

    // 6. Anti-Early-Exit Compounding Shield
    const compoundingShield = {
      isActive: (state === 'NORMAL' && isStage2Bull && !isStopFloorBreached && !has4RedBreakdown),
      title: 'Compounding Active (Stage 2 Bull)',
      message: 'This holding is in a healthy Stage 2 structural uptrend trading above its trailing safety corridor. Standard bull market consolidations (-15% to -25%) are normal volatility in high-growth Indian compounders. Do not cut early.',
      trailingFloorPrice: item.trailingFloorPrice,
      bufferToTrailingFloorPct: item.bufferToTrailingFloorPct
    };

    // 7. Human-Readable Explanation
    let explanation = '';
    if (state === 'DATA_UNAVAILABLE') {
      explanation = item.invalidation || 'Insufficient price history to evaluate trend.';
    } else if (state === 'PORTFOLIO_RISK_TRIM') {
      explanation = `Position weight is ${currentWeightPct.toFixed(2)}%, above your ${config.maxPositionWeightPct}% risk ceiling. The system calculates trimming ${suggestedSellQuantity} shares to return allocation to target ceiling.`;
    } else if (isStopFloorBreached && state === 'TECHNICAL_TRIM_CANDIDATE') {
      const dropPct = stopFloorPrice > 0 ? (((stopFloorPrice - item.currentPrice) / stopFloorPrice) * 100).toFixed(1) : '—';
      explanation = `Trailing stop floor breached! Live CMP ₹${item.currentPrice.toFixed(2)} is ${dropPct}% below stop floor ₹${stopFloorPrice.toFixed(2)}. Review selling ${suggestedSellQuantity} shares (${stagedExitPlan.catchUpSellQuantity > stagedExitPlan.tranche1?.targetShares ? 'staged multi-tranche catch-up' : 'Tranche 1 trim'}); no order is placed automatically.`;
    } else if (has4RedBreakdown && state === 'TECHNICAL_TRIM_CANDIDATE') {
      explanation = `Short-term breakdown: 4 consecutive daily red candles closed below 21-day EMA (${item.distanceToDailyEma21Pct}% below EMA). Review trimming Tranche 1 (${suggestedSellQuantity} shares) to de-risk.`;
    } else if (compoundingShield.isActive) {
      explanation = `Compounding Active: Weekly closes remain intact above the 30-week average (+${item.bufferToTrailingFloorPct}% buffer to trailing stop ₹${item.trailingFloorPrice}). The system advises letting this winner run without premature profit-taking.`;
    } else if (state === 'TECHNICAL_TRIM_CANDIDATE') {
      explanation = `Three completed weekly closes are below a falling 30-week average (CMP ₹${item.currentPrice} vs SMA ₹${item.sma30Week?.toFixed(1)}). Review trimming Tranche 1 (${suggestedSellQuantity} shares) while letting core position ride.`;
    } else if (state === 'FUNDAMENTAL_TRIM_CANDIDATE') {
      explanation = `Fundamentals show quarterly deceleration (${item.fundamentals?.opmTrendDirection?.toLowerCase()} margins at ${item.fundamentals?.latestOpmPct}%). Review trimming ${suggestedSellQuantity} shares in line with earnings deceleration.`;
    } else if (state === 'FULL_EXIT_CANDIDATE') {
      explanation = `Confluence of Stage 4 secular downtrend and fundamental deterioration. Full exit candidate (${suggestedSellQuantity} shares) to protect against permanent capital loss.`;
    } else if (state === 'WATCH') {
      explanation = `${item.weeksBelowAverage} consecutive weekly close(s) below average. Under observation; wait for confirmation before considering a sale.`;
    } else {
      explanation = `Trend and fundamentals remain within normal fluctuation bounds. No exit trigger.`;
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
      tranche3Shares: stagedExitPlan.tranche3?.targetShares || 0,
      tranche3Trigger: stagedExitPlan.tranche3?.triggerPrice || 0,
      tranche3Status: stagedExitPlan.tranche3?.status || 'CONTINGENT',
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
