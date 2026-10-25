import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateWeeklyCloses, analyzeTechnicalTrend, normalizePriceSeries, calculateWeeklyATR, analyzeDaily21EmaPattern } from './technicalIndicators.js';
import { runTrendStrategy } from './backtestEngine.js';
import { buildStockAnalyses, calculateTriggeredStagedSell, openCostBasisINR } from './analysisService.js';
import { buildCandidateUniverse } from './buyUniverseProvider.js';
import { buildBuyAnalyses } from './buyAnalysisService.js';

function weeklyPrices(values, first = '2024-01-05') {
  const start = new Date(`${first}T00:00:00Z`);
  const result = {};
  values.forEach((value, index) => {
    const date = new Date(start.getTime() + index * 7 * 86400000).toISOString().slice(0, 10);
    result[date] = value;
  });
  return result;
}

function weekdays(count, first = '2022-01-03') {
  const result = {};
  const date = new Date(`${first}T00:00:00Z`);
  let value = 100;
  while (Object.keys(result).length < count) {
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) {
      value *= 1.001;
      result[date.toISOString().slice(0, 10)] = Number(value.toFixed(4));
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return result;
}

test('normalizes valid daily price observations and sorts dates', () => {
  assert.deepEqual(normalizePriceSeries({ '2024-01-02': 10, '2024-01-01': '9', bad: 4, '2024-01-03': 0 }), [
    { date: '2024-01-01', close: 9 }, { date: '2024-01-02', close: 10 }
  ]);
});

test('weekly aggregation excludes an incomplete current trading week', () => {
  const series = normalizePriceSeries({
    '2024-01-01': 10, '2024-01-05': 12, '2024-01-08': 11, '2024-01-10': 9
  });
  assert.equal(aggregateWeeklyCloses(series, { today: '2024-01-10' }).length, 1);
  assert.equal(aggregateWeeklyCloses(series, { today: '2024-01-14' }).length, 2);
});

test('confirmed downtrend requires persistent closes and a falling 30-week average', () => {
  const prices = weeklyPrices([...Array(30).fill(100), ...Array(20).fill(150), ...Array(20).fill(100)]);
  const result = analyzeTechnicalTrend(prices, { today: '2025-06-01' });
  assert.equal(result.state, 'TECHNICAL_TRIM_CANDIDATE');
  assert.ok(result.weeksBelowAverage >= 3);
  assert.equal(result.slopeDown, true);
  assert.equal(result.weinsteinStage, 4);
});

test('insufficient history cannot produce a sell state', () => {
  const result = analyzeTechnicalTrend(weeklyPrices(Array(20).fill(100)), { today: '2024-06-02' });
  assert.equal(result.state, 'DATA_UNAVAILABLE');
});

test('rising price history activates Stage 2 Bull and Compounding Protection', () => {
  const prices = weeklyPrices(Array.from({ length: 60 }, (_, index) => 100 + index * 2));
  const result = analyzeTechnicalTrend(prices, { today: '2025-03-02' });
  assert.equal(result.state, 'NORMAL');
  assert.equal(result.weinsteinStage, 2);
  assert.equal(result.isCompoundingProtected, true);
  assert.ok(result.bufferToTrailingFloorPct > 0);
});

test('live Chandelier stop breach overrides the hold shield and stages a manual trim review', () => {
  const prices = weeklyPrices(Array.from({ length: 60 }, (_, index) => 100 + index * 2));
  const trend = analyzeTechnicalTrend(prices, { today: '2025-03-02' });
  // Price below trailing floor (212) but safely above 30-week SMA (189): Tranche 1 triggers
  const trimPrice = 200;
  const holdings = [{ id: 'h1', symbol: 'RUNNER', category_id: 'in_stocks', quantity: 1500, current_price: trimPrice }];
  const [result] = buildStockAnalyses(holdings, { RUNNER: prices }, { today: '2025-03-02' });

  assert.equal(result.stopFloorBreached, true);
  assert.equal(result.state, 'TECHNICAL_TRIM_CANDIDATE');
  assert.equal(result.suggestedSellQuantity, 495);
  assert.equal(result.stagedExitPlan.tranche1.status, 'READY');
  assert.equal(result.stagedExitPlan.tranche2.status, 'PENDING');
  assert.deepEqual(
    [result.stagedExitPlan.tranche1.targetShares, result.stagedExitPlan.tranche2.targetShares],
    [495, 1005]
  );
  assert.equal(
    result.stagedExitPlan.tranche1.targetShares + result.stagedExitPlan.tranche2.targetShares,
    result.quantity
  );
  assert.equal(calculateTriggeredStagedSell(result).quantity, 495);
  assert.equal(calculateTriggeredStagedSell(result).triggeredTranches.length, 1);
  assert.ok(result.stagedExitPlan.tranche1.triggerPrice > result.stagedExitPlan.tranche2.triggerPrice);
  assert.match(result.explanation, /no order is placed automatically|not an automatically placed order/i);
  assert.ok(result.liveBufferToTrailingFloorPct < 0);

  // Both triggers breached (below 30-week SMA at 187.11): Both Tranches trigger for full exit
  const deepBreachPrice = Number((Math.min(trend.chandelierStopPrice, trend.sma30Week) * 0.99).toFixed(2));
  const [deepBreach] = buildStockAnalyses(
    [{ ...holdings[0], current_price: deepBreachPrice }],
    { RUNNER: prices },
    { today: '2025-03-02' }
  );
  assert.equal(deepBreach.stagedExitPlan.tranche1.status, 'READY');
  assert.equal(deepBreach.stagedExitPlan.tranche2.status, 'READY');
  assert.equal(deepBreach.suggestedSellQuantity, 1500);
  assert.equal(calculateTriggeredStagedSell(deepBreach).quantity, 1500);
  assert.equal(calculateTriggeredStagedSell(deepBreach).triggeredTranches.length, 2);

  // Ledger audit: Tranche 1 is completed (495 shares sold) and price is above 30-week SMA (200)
  // Holds core position with suggestedSellQuantity = 0, action = 'HOLD' (no recursive subdivision)
  const firstSaleHold = buildStockAnalyses(
    [{ ...holdings[0], quantity: 1005, current_price: 200 }],
    { RUNNER: prices },
    {
      today: '2025-03-02',
      transactions: [{ holding_id: 'h1', type: 'SELL', date: '2025-03-01', quantity: 495, price: 200 }]
    }
  )[0];
  assert.equal(firstSaleHold.stagedExitPlan.tranche1.status, 'COMPLETED');
  assert.equal(firstSaleHold.stagedExitPlan.tranche2.status, 'PENDING');
  assert.equal(firstSaleHold.stagedExitPlan.tranche2.targetShares, 1005);
  assert.equal(firstSaleHold.suggestedSellQuantity, 0);
  assert.equal(firstSaleHold.action, 'HOLD');
  assert.equal(calculateTriggeredStagedSell(firstSaleHold).quantity, 0);

  // Ledger audit: Tranche 1 is completed and price now breaks 30-week SMA (187.11)
  // Tranche 2 is READY, executing full exit of all remaining 1005 shares
  const secondSaleExit = buildStockAnalyses(
    [{ ...holdings[0], quantity: 1005, current_price: deepBreachPrice }],
    { RUNNER: prices },
    {
      today: '2025-03-02',
      transactions: [{ holding_id: 'h1', type: 'SELL', date: '2025-03-01', quantity: 495, price: 200 }]
    }
  )[0];
  assert.equal(secondSaleExit.stagedExitPlan.tranche1.status, 'COMPLETED');
  assert.equal(secondSaleExit.stagedExitPlan.tranche2.status, 'READY');
  assert.equal(secondSaleExit.stagedExitPlan.tranche2.targetShares, 1005);
  assert.equal(secondSaleExit.suggestedSellQuantity, 1005);
  assert.equal(secondSaleExit.action, 'SELL_ALL');
  assert.equal(calculateTriggeredStagedSell(secondSaleExit).quantity, 1005);
  assert.equal(calculateTriggeredStagedSell(secondSaleExit).triggeredTranches.length, 1);
});

test('backtest uses next observation and avoids selling in a persistent uptrend', () => {
  const prices = weekdays(400);
  const result = runTrendStrategy(prices, { startDate: '2022-01-03', endDate: '2024-01-01', trimFraction: 0.25 });
  assert.ok(result);
  assert.equal(result.strategy.trades, 0);
  assert.equal(result.strategy.totalReturnPct, result.buyAndHold.totalReturnPct);
});

test('recommendation engine gives no signal when required price history is missing', () => {
  const [result] = buildStockAnalyses([{ id: 'h1', symbol: 'ABC', category_id: 'in_stocks', quantity: 5, current_price: 20 }], {}, { today: '2025-01-05' });
  assert.equal(result.state, 'DATA_UNAVAILABLE');
  assert.equal(result.suggestedSellQuantity, null);
});

test('recent stored close that materially conflicts with the holding quote blocks trend actions', () => {
  const holdings = [{ id: 'h1', symbol: 'ABC', category_id: 'in_stocks', quantity: 5, current_price: 100 }];
  const prices = { ABC: { '2025-01-03': 151 } };
  const [result] = buildStockAnalyses(holdings, prices, { today: '2025-01-05' });
  assert.equal(result.state, 'DATA_UNAVAILABLE');
  assert.equal(result.dataQuality, 'PRICE_HISTORY_QUOTE_MISMATCH');
  assert.equal(result.action, 'NO_RECOMMENDATION');
  assert.equal(result.suggestedSellQuantity, null);
});

test('position limit derives a capped whole-share quantity from excess exposure', () => {
  const holdings = [
    { id: 'h1', symbol: 'AAA', category_id: 'in_stocks', quantity: 5, current_price: 100 },
    { id: 'h2', symbol: 'BBB', category_id: 'in_stocks', quantity: 5, current_price: 100 }
  ];
  const priceHistory = { AAA: { '2025-01-03': 100 }, BBB: { '2025-01-03': 100 } };
  const results = buildStockAnalyses(holdings, priceHistory, { today: '2025-01-05', config: { maxPositionWeightPct: 30 } });
  assert.equal(results[0].state, 'PORTFOLIO_RISK_TRIM');
  assert.equal(results[0].suggestedSellQuantity, 2);
});

test('open cost basis replays buys and FIFO sells without changing source ledger', () => {
  const holdings = [{ id: 'h1', symbol: 'AAA', category_id: 'in_stocks', quantity: 5, current_price: 100, avg_buy_price: 50 }];
  const transactions = [
    { holding_id: 'h1', type: 'BUY', date: '2024-01-01', quantity: 10, price: 40, charges: 10 },
    { holding_id: 'h1', type: 'SELL', date: '2024-02-01', quantity: 5, price: 60, charges: 2 }
  ];
  const result = buildStockAnalyses(holdings, {}, { today: '2025-01-05', transactions })[0];
  assert.equal(result.investedValueINR, 205);
  assert.equal(transactions[0].quantity, 10);
});

test('staged exit plan detects intermediate sales and buys dynamically from ledger', () => {
  const holdings = [{ id: 'h1', symbol: 'AAA', category_id: 'in_stocks', quantity: 80, current_price: 50 }];
  // 100 shares bought, then the planned 33-share first tranche sold, then 13 shares bought = 80 current held
  const transactions = [
    { holding_id: 'h1', type: 'BUY', date: '2025-01-01', quantity: 100, price: 100, charges: 0 },
    { holding_id: 'h1', type: 'SELL', date: '2025-09-15', quantity: 33, price: 70, charges: 0 },
    { holding_id: 'h1', type: 'BUY', date: '2025-09-20', quantity: 13, price: 60, charges: 0 }
  ];
  const prices = weeklyPrices([...Array(35).fill(100), ...Array(15).fill(50)]);
  const [result] = buildStockAnalyses(holdings, { AAA: prices }, { today: '2025-10-01', transactions });
  
  assert.ok(result.stagedExitPlan);
  assert.equal(result.stagedExitPlan.tranche1.status, 'COMPLETED');
  assert.equal(result.stagedExitPlan.ledgerAudit.recentSharesSold, 33);
  assert.equal(result.stagedExitPlan.ledgerAudit.recentSharesBought, 13);
  assert.equal(result.quantity, 80);
});

test('principal harvest correctly identifies doublers and computes 100% capital recovery', () => {
  // Invested ₹50,000 (100 shares @ ₹500); current price is ₹1,000 (value ₹1,00,000, 2x gain)
  const holdings = [{ id: 'h1', symbol: 'RUNNER', category_id: 'in_stocks', quantity: 100, current_price: 1000, avg_buy_price: 500 }];
  const prices = weeklyPrices(Array.from({ length: 60 }, (_, index) => 500 + index * 10));
  const [result] = buildStockAnalyses(holdings, { RUNNER: prices }, { today: '2025-10-01' });

  assert.ok(result.principalHarvest.isEligible);
  assert.equal(result.principalHarvest.sharesToHarvest, 50); // 50 shares * 1000 = 50,000
  assert.equal(result.principalHarvest.remainingShares, 50);
  assert.equal(result.principalHarvest.capitalRecoveredINR, 50000);
});

test('analyzeDaily21EmaPattern correctly detects 4 red candles below 21 EMA with >= 5% breakdown', () => {
  // Create 30 days of prices. Days 0-25 are around 100.
  // Last 4 days (days 26, 27, 28, 29) drop continuously: 98 -> 95 -> 92 -> 88.
  // 21-day EMA is around 97-98, so all 4 are below EMA, and day 29 (88) is ~10% below EMA (>= 5%).
  const start = new Date('2025-01-01T00:00:00Z');
  const dailySeries = [];
  for (let i = 0; i < 30; i++) {
    const dStr = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    let close = 100;
    let open = 100;
    if (i === 26) { open = 99; close = 98; }
    else if (i === 27) { open = 98; close = 95; }
    else if (i === 28) { open = 95; close = 92; }
    else if (i === 29) { open = 92; close = 88; }
    dailySeries.push({ date: dStr, open, close });
  }

  const result = analyzeDaily21EmaPattern(dailySeries);
  assert.equal(result.has4RedCandlesBelow21Ema, true);
  assert.ok(result.distanceToDailyEma21Pct <= -5.0);
  assert.equal(result.consecutiveDailyRedCandles >= 4, true);
  assert.equal(result.dailyCandlePatternDetails.matched, true);
  assert.equal(result.dailyCandlePatternDetails.all4Red, true);
  assert.equal(result.dailyCandlePatternDetails.all4BelowEma, true);
  assert.equal(result.dailyCandlePatternDetails.isLast5PctBelow, true);

  // If the last candle was only 2% below EMA (e.g. 96 instead of 88), pattern should NOT trigger
  dailySeries[29] = { date: dailySeries[29].date, open: 97, close: 96 };
  const resultNot5Pct = analyzeDaily21EmaPattern(dailySeries);
  assert.equal(resultNot5Pct.has4RedCandlesBelow21Ema, false);
  assert.equal(resultNot5Pct.dailyCandlePatternDetails.isLast5PctBelow, false);

  // If one of the 4 candles was green (close > open), pattern should NOT trigger
  dailySeries[28] = { date: dailySeries[28].date, open: 90, close: 93 }; // green candle
  dailySeries[29] = { date: dailySeries[29].date, open: 92, close: 88 };
  const resultGreen = analyzeDaily21EmaPattern(dailySeries);
  assert.equal(resultGreen.has4RedCandlesBelow21Ema, false);
  assert.equal(resultGreen.dailyCandlePatternDetails.all4Red, false);
});

test('Task 8: Trailing stop floor breach is non-negotiable; mutual exclusivity excludes sell-flagged stocks from buy analysis', () => {
  // Rising price history creates Stage 2 structure
  const prices = weeklyPrices(Array.from({ length: 60 }, (_, index) => 100 + index * 2));
  const trend = analyzeTechnicalTrend(prices, { today: '2025-03-02' });

  // Price is ABOVE 30w-SMA (189), but below chandelier trailing stop (212) -> Stop floor is breached
  const cmpAboveSmaBelowChandelier = 195;
  const holding = { id: 'h1', symbol: 'BULLSTOCK', category_id: 'in_stocks', quantity: 100, current_price: cmpAboveSmaBelowChandelier };

  // Case A: Trailing stop floor breach is NEVER suppressed by an active buy thesis or Stage 2 status
  const [resultBull] = buildStockAnalyses([holding], { BULLSTOCK: prices }, {
    today: '2025-03-02',
    activeBuyTheses: ['BULLSTOCK']
  });
  assert.equal(resultBull.weinsteinStage, 2);
  assert.equal(resultBull.stopFloorBreached, true);
  assert.equal(resultBull.state, 'TECHNICAL_TRIM_CANDIDATE');
  assert.equal(resultBull.action, 'REVIEW_PARTIAL_SALE');
  assert.ok(resultBull.suggestedSellQuantity > 0);

  // Case B: Safe holding trading above trailing stop floor retains NORMAL state
  const safeHolding = { id: 'h2', symbol: 'SAFEBUY', category_id: 'in_stocks', quantity: 50, current_price: 220 };
  const [resultSafe] = buildStockAnalyses([safeHolding], { SAFEBUY: prices }, {
    today: '2025-03-02'
  });
  assert.equal(resultSafe.stopFloorBreached, false);
  assert.equal(resultSafe.state, 'NORMAL');
  assert.equal(resultSafe.action, 'HOLD_AND_COMPOUND');

  // Case C: 100% mutual exclusivity in buyAnalysisService: excludes sell-flagged stocks
  const buyCandidates = [{ symbol: 'EXITSTOCK', name: 'Exit Stock', source: 'NSE500', inPortfolio: true, portfolioQuantity: 10 }];
  const sellAnalyses = [{ symbol: 'EXITSTOCK', action: 'FULL_EXIT', state: 'FULL_EXIT_CANDIDATE' }];
  const buyResults = buildBuyAnalyses(buyCandidates, {}, {}, {}, {}, { sellAnalyses });
  assert.equal(buyResults.some(b => b.symbol === 'EXITSTOCK'), false);
});

test('Task 9: Recently sold stocks from crash/past 90 days are added to candidate universe', () => {
  const holdings = [{ id: 'h1', symbol: 'HELD1', category_id: 'in_stocks', quantity: 100 }];
  const transactions = [
    { symbol: 'CRASH_SOLD', type: 'SELL', date: '2026-10-23', quantity: 50, price: 500 },
    { symbol: 'OCT21_SOLD', type: 'SELL', date: '2026-10-21', quantity: 20, price: 200 }
  ];

  const universe = buildCandidateUniverse(holdings, [], transactions, { asOfDate: '2026-10-24' });
  const crashSold = universe.find(c => c.symbol === 'CRASH_SOLD');
  const oct21Sold = universe.find(c => c.symbol === 'OCT21_SOLD');

  assert.ok(crashSold, 'CRASH_SOLD should be in candidate universe');
  assert.equal(crashSold.source, 'Recently Sold / Crash Exit Candidate');
  assert.equal(crashSold.inPortfolio, false);
  assert.equal(crashSold.lastSoldDate, '2026-10-23');

  assert.ok(oct21Sold, 'OCT21_SOLD should be in candidate universe');
  assert.equal(oct21Sold.source, 'Recently Sold / Crash Exit Candidate');
  assert.equal(oct21Sold.inPortfolio, false);
});

test('Rule 1: Entry-anchored Chandelier trailing stop anchors to peak since purchase rather than pre-entry historical high', () => {
  // 60 weeks of price history (420 days):
  // Days 0-300: price rises to 150 at day 300 (historical peak in week 42, within last 20 weeks)
  // Days 301-380: price cools down to 100
  // User enters at day 385 at price 100
  // Days 386-420: price is at 102 (peak since purchase is 102)
  const prices = {};
  const start = new Date('2023-01-01T00:00:00Z');
  for (let i = 0; i < 420; i++) {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    if (i < 300) prices[d] = 100 + (i / 300) * 50;
    else if (i < 380) prices[d] = 150 - ((i - 300) / 80) * 50;
    else prices[d] = 102;
  }
  const entryDate = new Date(start.getTime() + 385 * 86400000).toISOString().slice(0, 10);
  const today = new Date(start.getTime() + 419 * 86400000).toISOString().slice(0, 10);

  // Without entryDate: peak20 captures day 300's peak (150)
  const unanchored = analyzeTechnicalTrend(prices, { today });
  assert.ok(unanchored.peak20WeekPrice >= 145, 'Unanchored peak20 captures pre-entry high');

  // With entryDate: trailingPeak is anchored to prices since entry (102), so trailing stop is well below 102
  const anchored = analyzeTechnicalTrend(prices, { today, entryDate, entryPrice: 100 });
  assert.equal(anchored.trailingPeakPrice, 102, 'Anchored trailing peak reflects post-entry high');
  assert.ok(anchored.chandelierStopPrice < 102, 'Chandelier stop is below entry peak');
});

test('Rule 2: Fresh buy position held <= 5 trading days with loss < 8% is protected under ACCUMULATION_RETEST', () => {
  const prices = weekdays(300, '2023-01-02');
  const dates = Object.keys(prices).sort();
  const today = dates.at(-1);
  const buyDate = dates.at(-3);
  const buyPrice = prices[buyDate];
  const cmp = Number((buyPrice * 0.98).toFixed(2));
  prices[today] = cmp;

  const holdings = [{
    id: 'h_fresh_1',
    symbol: 'FRESH_TEST',
    name: 'Fresh Buy Retest Test',
    category_id: 'in_stocks',
    quantity: 100,
    current_price: cmp,
    avg_buy_price: buyPrice,
    investedValueINR: buyPrice * 100
  }];
  const transactions = [{
    holding_id: 'h_fresh_1',
    symbol: 'FRESH_TEST',
    date: buyDate,
    type: 'BUY',
    quantity: 100,
    price: buyPrice,
    total_amount: buyPrice * 100
  }];

  const results = buildStockAnalyses(holdings, { FRESH_TEST: prices }, {
    today,
    transactions,
    fundamentalsMap: { FRESH_TEST: { status: 'AVAILABLE', opmTrendDirection: 'EXPANDING' } }
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].action, 'ACCUMULATION_RETEST', 'Fresh buy should be under ACCUMULATION_RETEST');
  assert.equal(results[0].suggestedSellQuantity, 0, 'No shares suggested for sale during noise corridor');
  assert.equal(results[0].totalActionShares, 0, 'Total action shares must be 0');
});

test('Rule 2: Fresh buy position dropping >= 8% triggers hard circuit-breaker de-risk trim', () => {
  const prices = weekdays(300, '2023-01-02');
  const dates = Object.keys(prices).sort();
  const today = dates.at(-1);
  const buyDate = dates.at(-3);
  const buyPrice = prices[buyDate];
  const cmp = Number((buyPrice * 0.90).toFixed(2));
  prices[today] = cmp;

  const holdings = [{
    id: 'h_fresh_2',
    symbol: 'FRESH_HARD_STOP',
    name: 'Fresh Buy Hard Stop Test',
    category_id: 'in_stocks',
    quantity: 100,
    current_price: cmp,
    avg_buy_price: buyPrice,
    investedValueINR: buyPrice * 100
  }];
  const transactions = [{
    holding_id: 'h_fresh_2',
    symbol: 'FRESH_HARD_STOP',
    date: buyDate,
    type: 'BUY',
    quantity: 100,
    price: buyPrice,
    total_amount: buyPrice * 100
  }];

  const results = buildStockAnalyses(holdings, { FRESH_HARD_STOP: prices }, {
    today,
    transactions,
    fundamentalsMap: { FRESH_HARD_STOP: { status: 'AVAILABLE', opmTrendDirection: 'EXPANDING' } }
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].state, 'TECHNICAL_TRIM_CANDIDATE', 'Hard loss triggers technical trim');
  assert.equal(results[0].action, 'REVIEW_PARTIAL_SALE', 'Action must be review partial sale');
  assert.ok(results[0].suggestedSellQuantity > 0, 'Tranche 1 trim shares must be > 0');
});

test('Rule 3: Buy analysis strictly disqualifies candidate stocks trading <= 30-week SMA as AVOID', () => {
  const prices = weekdays(300, '2023-01-02');
  const dates = Object.keys(prices).sort();
  const today = dates.at(-1);
  const trend = analyzeTechnicalTrend(prices, { today });

  const subSmaPrice = Number((trend.sma30Week * 0.95).toFixed(2));
  prices[today] = subSmaPrice;

  const candidate = {
    symbol: 'SUB_SMA_CANDIDATE',
    name: 'Sub SMA Candidate Test',
    currentPrice: subSmaPrice,
    category: 'in_stocks',
    inPortfolio: false
  };

  const buyAnalyses = buildBuyAnalyses({
    candidates: [candidate],
    priceHistory: { SUB_SMA_CANDIDATE: prices },
    fundamentalsCache: { SUB_SMA_CANDIDATE: { status: 'AVAILABLE', opmTrendDirection: 'EXPANDING', roePct: 20 } },
    today
  });

  assert.equal(buyAnalyses.length, 1);
  assert.equal(buyAnalyses[0].buySignal, 'AVOID', 'Candidate <= 30w SMA must be classified AVOID');
  assert.ok(buyAnalyses[0].signalReason.includes('30-week moving average'), 'Reason must cite 30-week SMA');
});
