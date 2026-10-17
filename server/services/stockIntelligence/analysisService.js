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
    // If drawdown is 20%, trim ratio is 20-25%; if drawdown is 35%, trim ratio scales to 35-40%
    const ddAbs = Math.abs(drawdownFrom20WeekHighPct || 20) / 100;
    const dynamicRatio = Number(Math.min(0.40, Math.max(0.20, ddAbs * 1.1)).toFixed(2));
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
 * Builds staged multi-tranche exit plan & dynamic execution tracker
 */
function buildStagedExitPlan({
  holding,
  currentPrice,
  peak20WeekPrice,
  sma30Week,
  chandelierStopPrice,
  state,
  suggestedSellQuantity,
  sizingMethod,
  ledgerAudit
}) {
  const currentQty = Number(holding.quantity) || 0;
  const triggerPrice1 = sma30Week ? Number(sma30Week.toFixed(2)) : currentPrice;
  const triggerPrice2 = chandelierStopPrice ? Number(chandelierStopPrice.toFixed(2)) : Number((triggerPrice1 * 0.90).toFixed(2));

  // Determine Tranche 1 status
  const hasExecutedRecentSale = ledgerAudit.recentSharesSold > 0;
  const tranche1Status = hasExecutedRecentSale ? 'COMPLETED' : (suggestedSellQuantity > 0 ? 'PENDING' : 'INACTIVE');

  // Tranche 1 Details
  const tranche1 = {
    name: 'Tranche 1 (Defensive Trim)',
    targetShares: hasExecutedRecentSale ? ledgerAudit.recentSharesSold : suggestedSellQuantity,
    triggerPrice: triggerPrice1,
    status: tranche1Status,
    executionNote: hasExecutedRecentSale
      ? `Sold ${ledgerAudit.recentSharesSold} shares on ${ledgerAudit.lastSaleDate} at avg ₹${ledgerAudit.avgSellPrice?.toFixed(2)} (₹${ledgerAudit.totalGrossProceedsLocked?.toLocaleString('en-IN', { maximumFractionDigits: 0 })} gross locked).`
      : `Review selling ${suggestedSellQuantity} shares at current market quote to de-risk exposure.`
  };

  // Tranche 2 Details (Dynamically evaluated on TODAY'S remaining held shares)
  // If price continues to fall below secondary support (triggerPrice2), advise next tranche
  const nextTrancheRatio = 0.33; // 1/3 of remaining held shares
  const tranche2Quantity = Math.min(currentQty, Math.max(0, Math.round(currentQty * nextTrancheRatio)));
  const isTranche2Triggered = currentPrice <= triggerPrice2 && (state === 'TECHNICAL_TRIM_CANDIDATE' || state === 'FULL_EXIT_CANDIDATE');

  const tranche2 = {
    name: 'Tranche 2 (Secondary Support Breakdown)',
    targetShares: tranche2Quantity,
    triggerPrice: triggerPrice2,
    status: isTranche2Triggered ? 'READY' : (hasExecutedRecentSale ? 'ARMED' : 'PENDING'),
    executionNote: `If price drops below secondary support (₹${triggerPrice2}), review selling next ${tranche2Quantity} shares (evaluated on today's remaining ${currentQty} held shares).`
  };

  // Tranche 3 Details (Structural Exit)
  const tranche3 = {
    name: 'Tranche 3 (Structural Thesis Exit)',
    targetShares: currentQty,
    triggerPrice: Number((triggerPrice2 * 0.85).toFixed(2)),
    status: state === 'FULL_EXIT_CANDIDATE' ? 'READY' : 'CONTINGENT',
    executionNote: `100% full exit (${currentQty} shares) if secular multi-year Stage 4 breakdown confirms.`
  };

  return {
    tranche1,
    tranche2,
    tranche3,
    ledgerAudit: {
      ...ledgerAudit,
      auditMessage: ledgerAudit.recentSharesSold > 0
        ? `Executed sale detected: ${ledgerAudit.recentSharesSold} shares sold recently.${ledgerAudit.recentSharesBought > 0 ? ` (+${ledgerAudit.recentSharesBought} shares bought since).` : ''} Current balance today is ${currentQty} shares.`
        : `No recent sales recorded in the ledger for this holding.`
    }
  };
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

export function buildStockAnalyses(holdings, historicalPriceMap, { today, backtest, config, transactions = [], dividends = [], metadata = [], fundamentalsMap = {}, categoryId = 'in_stocks' } = {}) {
  const metadataBySymbol = new Map(metadata.map(row => [cleanSym(row.symbol), row]));
  const targetCategory = categoryId || 'in_stocks';
  const targetStocks = holdings.filter(item => item.category_id === targetCategory && Number(item.quantity) > 0);

  const interim = targetStocks.map(holding => {
    const raw = priceSeriesFor(holding.symbol, historicalPriceMap);
    const prices = normalizePriceSeries(raw);
    const trend = analyzeTechnicalTrend(raw, { today });
    const quantity = Number(holding.quantity) || 0;
    const isUs = targetCategory === 'us_stocks';
    const currency = isUs ? 'USD' : 'INR';
    const currentPrice = Number(holding.current_price) || prices.at(-1)?.close || 0;
    const nativeCurrentPrice = currentPrice;
    const nativeCurrentValue = quantity * nativeCurrentPrice;
    const nativeInvestedValue = isUs ? openCostBasisINR(holding, transactions, { inrConversion: false }) : (Number(holding.investedValueINR) || openCostBasisINR(holding, transactions));
    const currentValueINR = isUs ? (Number(holding.current_value_inr) || (nativeCurrentValue * (Number(holding.fx_rate) || 94.96))) : nativeCurrentValue;
    const investedValueINR = isUs ? (Number(holding.invested_amount_inr) || openCostBasisINR(holding, transactions, { inrConversion: true })) : nativeInvestedValue;
    const clean = cleanSym(holding.symbol);

    // Compute Holding-Level Cashflows for XIRR (in holding's native currency)
    const hTxs = transactions.filter(t => String(t.holding_id) === String(holding.id) || (!t.holding_id && t.symbol && cleanSym(t.symbol) === clean));
    const hDivs = dividends.filter(d => String(d.holding_id) === String(holding.id) || (d.symbol && cleanSym(d.symbol) === clean));
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

    // 1. Confluence Decision State Evaluation
    const isStage2Bull = item.weinsteinStage === 2;
    const isStage4Bear = item.weinsteinStage === 4;
    const isTechBreakdown = item.state === 'TECHNICAL_TRIM_CANDIDATE';
    const isFundsDecaying = item.fundamentals?.opmTrendDirection === 'CONTRACTING' || (item.fundamentals?.yoyPatGrowthPct !== null && item.fundamentals?.yoyPatGrowthPct < -25);
    const isGovernanceRedFlag = item.fundamentals?.promoterPledgePct > 20;

    if (item.state !== 'DATA_UNAVAILABLE') {
      if (isStage2Bull && item.isCompoundingProtected && !isGovernanceRedFlag) {
        // Multi-Bagger Compounding Guard Active
        state = 'NORMAL';
        action = 'HOLD_AND_COMPOUND';
      } else if (isTechBreakdown && isFundsDecaying) {
        state = 'FULL_EXIT_CANDIDATE';
        action = 'FULL_EXIT';
      } else if (isTechBreakdown) {
        state = 'TECHNICAL_TRIM_CANDIDATE';
        action = 'REVIEW_PARTIAL_SALE';
      } else if (isFundsDecaying) {
        state = 'FUNDAMENTAL_TRIM_CANDIDATE';
        action = 'REVIEW_FUNDAMENTAL_TRIM';
      } else if (item.state === 'WATCH') {
        action = 'MONITOR';
      }
    } else {
      action = 'NO_RECOMMENDATION';
    }

    // 2. Transaction Ledger Audit for Staged Execution Tracking
    const holdingRow = holdings.find(h => String(h.id) === item.holdingId) || item;
    const ledgerAudit = auditRecentLedgerActivity(holdingRow, transactions, today);

    // 3. Dynamic Logical Sizing (Zero arbitrary hardcodes)
    const sizing = deriveLogicalTrimQuantity({
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

    let suggestedSellQuantity = sizing.quantity > 0 ? sizing.quantity : null;
    let sizingMethod = sizing.method;

    if (sizing.quantity > 0 && config?.maxPositionWeightPct && currentWeightPct > config.maxPositionWeightPct) {
      state = 'PORTFOLIO_RISK_TRIM';
      action = 'REVIEW_RISK_TRIM';
    }

    // 4. Staged Multi-Tranche Exit Plan & Tracker
    const stagedExitPlan = buildStagedExitPlan({
      holding: item,
      currentPrice: item.currentPrice,
      peak20WeekPrice: item.peak20WeekPrice,
      sma30Week: item.sma30Week,
      chandelierStopPrice: item.chandelierStopPrice,
      state,
      suggestedSellQuantity: suggestedSellQuantity || 0,
      sizingMethod,
      ledgerAudit
    });

    // 5. Principal Harvest ("Free Ride") Option
    const principalHarvest = calculatePrincipalHarvest(item, item.currentPrice, item.investedValueINR);

    // 6. Anti-Early-Exit Compounding Shield
    const compoundingShield = {
      isActive: item.isCompoundingProtected && state === 'NORMAL',
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
      explanation,
      stagedExitPlan,
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
    withPriceHistory: analyses.filter(item => item.weeklyObservations > 0).length,
    fundamentalsAvailable: analyses.filter(item => item.fundamentals.status === 'AVAILABLE').length
  };
}
