import { analyzeTechnicalTrend, normalizePriceSeries, observedReturn } from './technicalIndicators.js';
import { STOCK_EXIT_RULE_VERSION } from './backtestEngine.js';

function priceSeriesFor(symbol, map) {
  const clean = String(symbol || '').replace(/\.(NS|BO)$/i, '');
  const candidates = [symbol, clean, `${clean}.NS`, `${clean}.BO`].filter(Boolean);
  for (const key of candidates) {
    const series = map?.[key];
    if (series && Object.keys(series).length) return series;
  }
  return {};
}

function openCostBasisINR(holding, transactions = []) {
  const rows = transactions.filter(tx => String(tx.holding_id) === String(holding.id)
    || (!tx.holding_id && tx.symbol && String(tx.symbol).toUpperCase() === String(holding.symbol).toUpperCase()))
    .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!rows.length) return (Number(holding.quantity) || 0) * (Number(holding.avg_buy_price) || 0);
  const lots = [];
  for (const tx of rows) {
    const type = String(tx.type || '').toUpperCase();
    const quantity = Number(tx.quantity) || 0;
    const price = Number(tx.price) || 0;
    const charges = Number(tx.charges) || 0;
    if (['BUY', 'INVESTMENT', 'INVESTMENT (SIP)'].includes(type) && quantity > 0) {
      lots.push({ quantity, remaining: quantity, price, charges });
    } else if (['BONUS', 'SPLIT'].includes(type) && quantity > 0) {
      lots.push({ quantity, remaining: quantity, price: 0, charges: 0 });
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
  return lots.reduce((sum, lot) => sum + lot.remaining * lot.price
    + (lot.quantity > 0 ? lot.remaining / lot.quantity * lot.charges : 0), 0);
}

function formatStateExplanation(analysis, backtest, currentWeightPct, config, suggestedSellQuantity) {
  if (analysis.state === 'DATA_UNAVAILABLE' && analysis.dataQuality === 'PRICE_HISTORY_QUOTE_MISMATCH') {
    return `The latest stored close (${analysis.latestStoredClose}) conflicts with the holding quote (${analysis.currentPrice}) by ${analysis.historyQuoteGapPct.toFixed(1)}%. No trend signal or sale quantity is available until prices are reconciled.`;
  }
  if (analysis.state === 'DATA_UNAVAILABLE') return 'There is not enough current, reliable price history to evaluate the trend. No sale signal or quantity is available.';
  if (analysis.state === 'TECHNICAL_TRIM_CANDIDATE') {
    if (backtest?.passedOutOfSample && backtest.selectedValidationTrimFraction) {
      const pct = backtest.selectedValidationTrimFraction * 100;
      return `Three completed weekly closes are below a falling 30-week average. The ${pct}% trim was selected on the validation period and passed the held-out test on current holdings; review ${suggestedSellQuantity} shares. This remains exploratory and price-only.`;
    }
    return 'Three completed weekly closes are below a falling 30-week average. Review the holding. Backtesting did not validate a sell quantity, so the system is not choosing one.';
  }
  if (analysis.state === 'WATCH') return `${analysis.weeksBelowAverage} consecutive completed weekly close(s) are below the 30-week average. Wait for confirmation; this is not a sell trigger.`;
  if (config?.maxPositionWeightPct && currentWeightPct > config.maxPositionWeightPct) {
    return `Position weight is ${currentWeightPct.toFixed(2)}%, above your ${config.maxPositionWeightPct}% limit. The displayed quantity is calculated to reduce the position to that limit.`;
  }
  return 'No confirmed technical exit trigger. This does not mean the stock is safe or guaranteed to rise.';
}

export function buildStockAnalyses(holdings, historicalPriceMap, { today, backtest, config, transactions = [], metadata = [] } = {}) {
  const metadataBySymbol = new Map(metadata.map(row => [String(row.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, ''), row]));
  const indianStocks = holdings.filter(item => item.category_id === 'in_stocks' && Number(item.quantity) > 0);
  const interim = indianStocks.map(holding => {
    const raw = priceSeriesFor(holding.symbol, historicalPriceMap);
    const prices = normalizePriceSeries(raw);
    const trend = analyzeTechnicalTrend(raw, { today });
    const quantity = Number(holding.quantity) || 0;
    const currentPrice = Number(holding.current_price) || prices.at(-1)?.close || 0;
    const currentValueINR = Number(holding.currentValueINR) || Number(holding.current_value_inr) || quantity * currentPrice;
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
      && historyQuoteGapPct !== null && historyQuoteGapPct > 15;
    const meta = metadataBySymbol.get(String(holding.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, ''));
    return {
      holdingId: String(holding.id),
      symbol: holding.symbol,
      name: holding.name || holding.symbol,
      sector: (holding.sector && holding.sector !== 'Unknown' ? holding.sector : meta?.sector) || null,
      quantity,
      currentPrice,
      currentValueINR,
      investedValueINR: Number(holding.investedValueINR) || openCostBasisINR(holding, transactions),
      quoteDate,
      history: prices.slice(-252).map(row => ({ date: row.date, price: row.close })),
      observed30DayReturn,
      observed90DayReturn,
      ...trend,
      ...(staleHistory ? {
        state: 'DATA_UNAVAILABLE',
        dataQuality: historyAgeDays === null ? 'MISSING_PRICE_HISTORY' : 'STALE_PRICE_HISTORY',
        invalidation: `Latest stored daily close is ${historyAgeDays ?? 'unknown'} calendar days old; refresh prices before evaluating the exit rule.`
      } : {}),
      ...(inconsistentLatestPrice ? {
        state: 'DATA_UNAVAILABLE',
        dataQuality: 'PRICE_HISTORY_QUOTE_MISMATCH',
        invalidation: `Latest stored close differs from the holding quote by ${historyQuoteGapPct.toFixed(1)}%. Check the market price and corporate actions before using the trend signal.`
      } : {}),
      historyQuoteGapPct,
      latestStoredClose: prices.at(-1)?.close ?? null,
      historyAgeDays,
      fundamentals: { status: 'UNAVAILABLE', source: null, observations: [] },
      ruleVersion: STOCK_EXIT_RULE_VERSION
    };
  });
  const totalValue = interim.reduce((sum, item) => sum + item.currentValueINR, 0);
  return interim.map(item => {
    const currentWeightPct = totalValue > 0 ? item.currentValueINR / totalValue * 100 : 0;
    let state = item.state;
    let action = 'MONITOR';
    let suggestedSellQuantity = null;
    let sizingMethod = null;
    const backtestCandidate = backtest?.selectedValidationTrimFraction;
    const quantityScenarios = (backtest?.periods?.test?.candidates || []).map(candidate => ({
      fraction: candidate.trimFraction,
      quantity: Math.min(item.quantity, Math.round(item.quantity * candidate.trimFraction)),
      averageCagrPct: candidate.avgCagrPct,
      averageMaxDrawdownPct: candidate.avgMaxDrawdownPct,
      beatBuyAndHold: candidate.beatBuyAndHold,
      eligibleSymbols: candidate.symbols
    }));
    if (item.state === 'TECHNICAL_TRIM_CANDIDATE' && backtest?.passedOutOfSample && backtestCandidate) {
      const roundedQuantity = Math.min(item.quantity, Math.round(item.quantity * backtestCandidate));
      if (roundedQuantity > 0) {
        suggestedSellQuantity = roundedQuantity;
        action = 'REVIEW_PARTIAL_SALE';
        sizingMethod = `Held-out tested fraction: ${(backtestCandidate * 100).toFixed(0)}% of current shares; rounded to nearest whole share.`;
      } else {
        action = 'REVIEW_POSITION';
      }
    } else if (item.state === 'DATA_UNAVAILABLE') {
      action = 'NO_RECOMMENDATION';
    } else if (item.state === 'TECHNICAL_TRIM_CANDIDATE') {
      action = 'REVIEW_POSITION';
    }
    const positionLimit = config?.maxPositionWeightPct;
    if (positionLimit && currentWeightPct > positionLimit && item.currentPrice > 0 && !item.dataQuality?.includes('STALE') && !item.dataQuality?.includes('MISSING') && item.dataQuality !== 'PRICE_HISTORY_QUOTE_MISMATCH') {
      const targetValue = totalValue * positionLimit / 100;
      const quantityForLimit = Math.min(item.quantity, Math.max(0, Math.ceil((item.currentValueINR - targetValue) / item.currentPrice)));
      if (quantityForLimit > (suggestedSellQuantity || 0)) {
        suggestedSellQuantity = quantityForLimit;
        action = 'REVIEW_RISK_TRIM';
        sizingMethod = `User-set ${positionLimit}% maximum weight; ceil(excess value / reference price), capped at held shares.`;
        state = 'PORTFOLIO_RISK_TRIM';
      }
    }
    return {
      ...item,
      state,
      action,
      currentWeightPct,
      suggestedSellQuantity,
      scenarioSellQuantity: backtest?.exploratoryTrimFraction
        ? Math.min(item.quantity, Math.round(item.quantity * backtest.exploratoryTrimFraction))
        : null,
      quantityScenarios,
      sizingMethod,
      referencePrice: item.currentPrice,
      referencePriceDate: item.quoteDate,
      estimatedGrossProceedsINR: suggestedSellQuantity ? suggestedSellQuantity * item.currentPrice : null,
      technicalState: item.state,
      explanation: formatStateExplanation({ ...item, state }, backtest, currentWeightPct, config, suggestedSellQuantity),
      invalidation: item.invalidation || 'Unknown'
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
    withPriceHistory: analyses.filter(item => item.weeklyObservations > 0).length,
    fundamentalsAvailable: analyses.filter(item => item.fundamentals.status === 'AVAILABLE').length
  };
}
