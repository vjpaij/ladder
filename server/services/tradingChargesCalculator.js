/**
 * server/services/tradingChargesCalculator.js
 * 
 * Statutory Charges and Net P&L Calculator for Indian and US Trading.
 * Modeled after SEBI, NSE, BSE, and discount broker (Zerodha/Dhan) schedules.
 */

export function calculateTradingCharges(params = {}) {
  const {
    market = 'IN',
    segment = 'IN_EQUITY', // 'IN_EQUITY' (CNC) | 'IN_INTRADAY' (MIS) | 'IN_OPTIONS' | 'IN_FUTURES' | 'US_EQUITY'
    tradeType = 'LONG',    // 'LONG' (Buy first) | 'SHORT' (Sell first)
    entryPrice = 0,
    exitPrice = null,
    quantity = 0,
    brokeragePerOrder = 20, // Discount broker standard ₹20 per leg
    customBrokerageRate = 0.0005 // 0.05% cap
  } = params;

  const qty = Math.max(0, Number(quantity) || 0);
  const entry = Math.max(0, Number(entryPrice) || 0);
  const exit = exitPrice !== null && exitPrice !== undefined ? Math.max(0, Number(exitPrice) || 0) : null;
  const isClosed = exit !== null && exit > 0;

  // Turnovers
  const entryTurnover = entry * qty;
  const exitTurnover = isClosed ? exit * qty : 0;
  
  const isLong = tradeType !== 'SHORT';
  const buyTurnover = isLong ? entryTurnover : exitTurnover;
  const sellTurnover = isLong ? exitTurnover : entryTurnover;
  const totalTurnover = buyTurnover + sellTurnover;

  let brokerage = 0;
  let stt = 0;
  let exchangeCharges = 0;
  let sebiCharges = 0;
  let stampDuty = 0;
  let gst = 0;
  let dpCharges = 0;
  let dpGst = 0;

  if (market === 'US' || segment === 'US_EQUITY') {
    // US zero-commission or nominal regulatory fees (SEC fee: $0.0000278 of sell turnover, FINRA TAF: $0.000166 per share)
    if (sellTurnover > 0) {
      const secFee = sellTurnover * 0.0000278;
      const finraFee = Math.min(8.30, qty * 0.000166);
      exchangeCharges = secFee + finraFee;
    }
    brokerage = 0; // Most US retail brokers offer zero commission
  } else {
    // Indian Markets (NSE/BSE/MCX)
    // 1. Brokerage
    const entryBrokerage = Math.min(brokeragePerOrder, entryTurnover * customBrokerageRate);
    const exitBrokerage = isClosed ? Math.min(brokeragePerOrder, exitTurnover * customBrokerageRate) : 0;
    brokerage = entryBrokerage + exitBrokerage;

    // 2. STT (Securities Transaction Tax)
    if (segment === 'IN_EQUITY') {
      // Delivery (CNC): 0.1% on buy and sell
      stt = (buyTurnover * 0.001) + (sellTurnover * 0.001);
    } else if (segment === 'IN_INTRADAY') {
      // Intraday (MIS): 0.025% on sell only
      stt = sellTurnover * 0.00025;
    } else if (segment === 'IN_OPTIONS') {
      // Options: 0.125% of premium on sell turnover (post-Oct 2024 revised STT schedule)
      stt = sellTurnover * 0.00125;
    } else if (segment === 'IN_FUTURES') {
      // Futures: 0.02% on sell turnover (post-Oct 2024 revised STT schedule)
      stt = sellTurnover * 0.0002;
    }

    // 3. Exchange Turnover Charges
    if (segment === 'IN_OPTIONS') {
      exchangeCharges = totalTurnover * 0.00035; // 0.035% on options premium
    } else if (segment === 'IN_FUTURES') {
      exchangeCharges = totalTurnover * 0.000019; // 0.0019% on futures
    } else {
      exchangeCharges = totalTurnover * 0.0000297; // 0.00297% on NSE equity
    }

    // 4. SEBI Charges (₹10 per crore = 0.0001% of turnover)
    sebiCharges = totalTurnover * 0.000001;

    // 5. Stamp Duty (Payable on BUY leg only)
    if (buyTurnover > 0) {
      if (segment === 'IN_EQUITY') {
        stampDuty = buyTurnover * 0.00015; // 0.015%
      } else if (segment === 'IN_INTRADAY') {
        stampDuty = buyTurnover * 0.00003; // 0.003%
      } else if (segment === 'IN_OPTIONS') {
        stampDuty = buyTurnover * 0.00002; // 0.002%
      } else if (segment === 'IN_FUTURES') {
        stampDuty = buyTurnover * 0.00002; // 0.002%
      }
    }

    // 6. DP Charges (Depository Participant fee on sell leg of equity delivery CNC)
    if (segment === 'IN_EQUITY' && sellTurnover > 0) {
      dpCharges = 13.00; // Standard CDSL depository charge (₹13.00)
      dpGst = dpCharges * 0.18; // ₹2.34 (18% GST on DP charge)
    }

    // 7. GST: 18% on (Brokerage + Exchange Charges + SEBI Charges) + DP GST
    gst = ((brokerage + exchangeCharges + sebiCharges) * 0.18) + dpGst;
  }

  const dpTotal = dpCharges + dpGst;
  const totalCharges = brokerage + stt + exchangeCharges + sebiCharges + stampDuty + dpCharges + gst;

  // P&L Calculations
  let grossPnl = 0;
  let netPnl = 0;
  let roiPct = 0;

  if (isClosed) {
    if (isLong) {
      grossPnl = (exit - entry) * qty;
    } else {
      grossPnl = (entry - exit) * qty;
    }
    netPnl = grossPnl - totalCharges;
    const capitalDeployed = entryTurnover > 0 ? entryTurnover : 1;
    roiPct = (netPnl / capitalDeployed) * 100;
  }

  // Breakeven price calculation (where Net P&L = 0)
  let breakevenExit = entry;
  if (qty > 0) {
    // Approximate breakeven accounting for exit leg turnover charges
    const estimatedCostPerShare = totalCharges / qty;
    breakevenExit = isLong ? entry + estimatedCostPerShare : entry - estimatedCostPerShare;
  }

  return {
    buyTurnover: round(buyTurnover),
    sellTurnover: round(sellTurnover),
    totalTurnover: round(totalTurnover),
    brokerage: round(brokerage),
    stt: round(stt),
    exchangeCharges: round(exchangeCharges),
    sebiCharges: round(sebiCharges),
    stampDuty: round(stampDuty),
    dpCharges: round(dpTotal),
    gst: round(gst),
    totalCharges: round(totalCharges),
    grossPnl: round(grossPnl),
    netPnl: round(netPnl),
    roiPct: round(roiPct),
    breakevenExit: round(breakevenExit),
    isClosed
  };
}

function round(val) {
  if (typeof val !== 'number' || isNaN(val)) return 0;
  return Math.round((val + Number.EPSILON) * 100) / 100;
}
