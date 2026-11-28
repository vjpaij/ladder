import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateWeeklyCloses, analyzeTechnicalTrend, normalizePriceSeries, calculateWeeklyATR, analyzeDaily21EmaPattern } from './technicalIndicators.js';
import { runTrendStrategy } from './backtestEngine.js';
import { buildStockAnalyses, calculateTriggeredStagedSell, openCostBasisINR, calculateOpenLots } from './analysisService.js';
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

test('M6 protects winning holdings from mid-week stop-floor noise above 30w-SMA (no premature trim)', () => {
  const prices = weeklyPrices(Array.from({ length: 60 }, (_, index) => 100 + index * 2));
  const trimPrice = 200;
  const holdings = [{ id: 'h1', symbol: 'RUNNER', category_id: 'in_stocks', quantity: 1500, current_price: trimPrice }];
  const [result] = buildStockAnalyses(holdings, { RUNNER: prices }, { today: '2025-03-02' });

  assert.equal(result.stopFloorBreached, true);
  assert.equal(result.state, 'NORMAL', 'M6 ignores mid-week trailing dip while above 30w-SMA');
  assert.equal(result.action, 'HOLD_AND_COMPOUND');
  assert.equal(result.stagedExitPlan.isSingleStageStop, true);
  assert.equal(result.stagedExitPlan.tranche1.targetShares, 1500);
  assert.equal(result.stagedExitPlan.tranche2.targetShares, 0);
  assert.ok(result.liveBufferToTrailingFloorPct < 0);

  // M6 breakdown: 2 consecutive completed weekly closes below 30w-SMA triggers 100% FULL_EXIT
  const bearPrices = weeklyPrices([...Array(57).fill(200), 175, 172, 170]);
  const [deepBreach] = buildStockAnalyses(
    [{ ...holdings[0], current_price: 170 }],
    { RUNNER: bearPrices },
    { today: '2025-03-02' }
  );
  assert.equal(deepBreach.stagedExitPlan.isSingleStageStop, true);
  assert.equal(deepBreach.stagedExitPlan.tranche1.status, 'READY');
  assert.equal(deepBreach.stagedExitPlan.tranche2.status, 'INACTIVE');
  assert.equal(deepBreach.action, 'FULL_EXIT');
  assert.equal(deepBreach.suggestedSellQuantity, 1500);
  assert.equal(calculateTriggeredStagedSell(deepBreach).quantity, 1500);
  assert.equal(calculateTriggeredStagedSell(deepBreach).triggeredTranches.length, 1);

  // Ledger audit: Partial manual sale executed (495 sold, 1005 remaining) while price holds above 30w-SMA (200)
  // Holds 100% of remaining 1005 shares with suggestedSellQuantity = 0, action = 'HOLD_AND_COMPOUND'
  const firstSaleHold = buildStockAnalyses(
    [{ ...holdings[0], quantity: 1005, current_price: 200 }],
    { RUNNER: prices },
    {
      today: '2025-03-02',
      transactions: [{ holding_id: 'h1', type: 'SELL', date: '2025-03-01', quantity: 495, price: 200 }]
    }
  )[0];
  assert.equal(firstSaleHold.stagedExitPlan.tranche1.targetShares, 1005);
  assert.equal(firstSaleHold.stagedExitPlan.tranche2.status, 'INACTIVE');
  assert.equal(firstSaleHold.suggestedSellQuantity ?? 0, 0);
  assert.equal(firstSaleHold.action, 'HOLD_AND_COMPOUND');
  assert.equal(calculateTriggeredStagedSell(firstSaleHold).quantity, 0);

  // Ledger audit: After prior manual sale, price breaks 2 consecutive weekly closes below 30w-SMA
  // Unified M6 exit triggers 100% of remaining 1005 shares as FULL_EXIT
  const secondSaleExit = buildStockAnalyses(
    [{ ...holdings[0], quantity: 1005, current_price: 170 }],
    { RUNNER: bearPrices },
    {
      today: '2025-03-02',
      transactions: [{ holding_id: 'h1', type: 'SELL', date: '2025-03-01', quantity: 495, price: 200 }]
    }
  )[0];
  assert.equal(secondSaleExit.stagedExitPlan.tranche1.status, 'READY');
  assert.equal(secondSaleExit.stagedExitPlan.tranche1.targetShares, 1005);
  assert.equal(secondSaleExit.stagedExitPlan.tranche2.status, 'INACTIVE');
  assert.equal(secondSaleExit.suggestedSellQuantity, 1005);
  assert.equal(secondSaleExit.action, 'FULL_EXIT');
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
  assert.equal(result.stagedExitPlan.isSingleStageStop, true);
  assert.equal(result.stagedExitPlan.tranche1.targetShares, 80);
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

  // Case A: Confirmed 2-weekly-close breakdown below 30w-SMA triggers FULL_EXIT_CANDIDATE (not suppressed by activeBuyTheses)
  const bearPrices = weeklyPrices([...Array(57).fill(220), 175, 172, 170]);
  const holdingBear = { id: 'h1', symbol: 'BULLSTOCK', category_id: 'in_stocks', quantity: 100, current_price: 170 };
  const [resultBull] = buildStockAnalyses([holdingBear], { BULLSTOCK: bearPrices }, {
    today: '2025-03-02',
    activeBuyTheses: ['BULLSTOCK']
  });
  assert.equal(resultBull.state, 'FULL_EXIT_CANDIDATE');
  assert.equal(resultBull.action, 'FULL_EXIT');
  assert.equal(resultBull.suggestedSellQuantity, 100);

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

test('Rule 1b: Re-entered position with liquidated historical cycle anchors to active open FIFO lot rather than old liquidated cycle', () => {
  const holding = {
    id: 'h_reentry_1',
    symbol: 'REENTRY_STOCK',
    category_id: 'in_stocks',
    quantity: 32,
    avg_buy_price: 300
  };
  const transactions = [
    { holding_id: 'h_reentry_1', symbol: 'REENTRY_STOCK', date: '2022-11-23', type: 'BUY', quantity: 100, price: 80 },
    { holding_id: 'h_reentry_1', symbol: 'REENTRY_STOCK', date: '2025-05-08', type: 'SELL', quantity: 100, price: 240 },
    { holding_id: 'h_reentry_1', symbol: 'REENTRY_STOCK', date: '2026-10-21', type: 'BUY', quantity: 32, price: 300 }
  ];

  const openLots = calculateOpenLots(holding, transactions);
  assert.equal(openLots.length, 1, 'Only active cycle lot remains');
  assert.equal(openLots[0].date, '2026-10-21', 'Earliest open lot date matches active re-entry date');
  assert.equal(openLots[0].remaining, 32, 'Remaining quantity matches active position');
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
  assert.equal(results[0].state, 'FULL_EXIT_CANDIDATE', 'Hard -8% loss on unproven position triggers 100% full exit');
  assert.equal(results[0].action, 'FULL_EXIT', 'Action must be FULL_EXIT');
  assert.equal(results[0].suggestedSellQuantity, 100, 'Must exit 100% of unproven position (no split to distant 30w-SMA)');
  assert.equal(results[0].stagedExitPlan?.isSingleStageStop, true, 'Must use single-stage 100% capital defense');
  assert.equal(results[0].stagedExitPlan?.tranche2?.targetShares, 0, 'Tranche 2 must be inactive for unproven <15% positions');
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

test('Rule 4: Minor margin dip does not trigger fundamental trim for Stage 2 compounder with expanding revenue and profit (SONACOMS / INDGN protection)', () => {
  const prices = weekdays(300, '2023-01-02');
  const dates = Object.keys(prices).sort();
  const today = dates.at(-1);
  const currentPrice = prices[today];

  const holdings = [{
    id: 'h-compounder',
    symbol: 'COMPOUNDER',
    category_id: 'in_stocks',
    quantity: 100,
    current_price: currentPrice,
    avg_buy_price: Number((currentPrice * 0.7).toFixed(2))
  }];

  // Fundamentals show expanding Sales (+30%) and expanding PAT (+18%), but OPM contracted (e.g. 26% to 22%)
  const fundamentalsMap = {
    COMPOUNDER: {
      status: 'AVAILABLE',
      opmTrendDirection: 'CONTRACTING',
      latestOpmPct: 22,
      yoySalesGrowthPct: 30.27,
      yoyPatGrowthPct: 18.67,
      promoterPledgePct: 0
    }
  };

  const results = buildStockAnalyses(holdings, { COMPOUNDER: prices }, {
    today,
    fundamentalsMap
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].action, 'HOLD_AND_COMPOUND', 'Stage 2 compounder with growing sales/PAT must be protected under HOLD_AND_COMPOUND');
  assert.equal(results[0].state, 'NORMAL', 'State must be NORMAL');
  assert.equal(results[0].suggestedSellQuantity, null, 'Suggested sell quantity must be null/0');
});

test('Rule 5: Action Plan dynamically sizes subordinate pyramid tranches for owned positions and enforces cumulative position caps (RPEL / GABRIEL protection)', async () => {
  const { generateActionPlan } = await import('./actionPlanService.js');
  const plan = await generateActionPlan({ externalCashBudget: 200000 });

  assert.ok(plan.immediateBuys, 'Immediate buys must exist');
  assert.ok(plan.queuedBuys, 'Queued buys must exist');

  // Verify that any owned holding in immediate buys has a subordinate tranche, calibrated to dynamic portfolio tranche ceiling
  const ownedImmediate = plan.immediateBuys.filter(b => b.isOwned);
  const dynamicTrancheMax = Math.max(250000, Math.round((plan.summary?.totalIndianEquityValuation || plan.summary?.totalEquityValuation || 10000000) * 0.065));
  ownedImmediate.forEach(b => {
    assert.ok(b.actionValue <= dynamicTrancheMax, `Owned buy ${b.symbol} actionValue (${b.actionValue}) must not exceed dynamic single pyramid tranche size (${dynamicTrancheMax})`);
  });

  // Verify that any holding reaching or exceeding position cap is routed to Queued Buys with 0 shares and CORE HOLD
  const coreHold = plan.queuedBuys.find(b => b.executionStatus.includes('CORE HOLD') || b.executionStatus.includes('CAP REACHED'));
  if (coreHold) {
    assert.equal(coreHold.actionShares, 0, `${coreHold.symbol} must have 0 action shares`);
    assert.ok(coreHold.executionStatus.includes('CORE HOLD') || coreHold.executionStatus.includes('CAP REACHED'), 'Must be marked CORE HOLD');
  }

  // Verify clean 8-column actionable CSV on every row (no queued or up-to-date bloat)
  const rows = plan.csv.split('\r\n').filter(Boolean);
  assert.ok(rows.length > 1, 'CSV must have rows');
  rows.forEach((row, i) => {
    let inQuotes = false;
    let colCount = 1;
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '"') inQuotes = !inQuotes;
      else if (row[c] === ',' && !inQuotes) colCount++;
    }
    assert.equal(colCount, 8, `Row ${i+1} must have 8 columns, got ${colCount}`);
  });
});

test('Rule 6: Market Cap < ₹1,000 Cr and penny stocks (CMP < ₹20) are strictly disqualified as AVOID and barred from Action Plan', async () => {
  const { generateActionPlan } = await import('./actionPlanService.js');
  const plan = await generateActionPlan({ externalCashBudget: 200000 });

  // No stock in immediate buys can have marketCapCr < 1000 or price < 20
  plan.immediateBuys.forEach(b => {
    if (b.marketCapCr && b.marketCapCr > 0) {
      assert.ok(b.marketCapCr >= 1000, `Immediate buy ${b.symbol} must have market cap >= 1000 Cr, got ${b.marketCapCr}`);
    }
    assert.ok(b.cmp >= 20.00, `Immediate buy ${b.symbol} must have CMP >= 20, got ${b.cmp}`);
  });

  // Verify SIL (Mcap 116 Cr, CMP 17) is completely excluded from immediate buys, queued buys, and CSV export
  const silInImmediate = plan.immediateBuys.find(b => b.symbol === 'SIL');
  assert.equal(silInImmediate, undefined, 'SIL must not be in immediate buys');
  const silInQueued = plan.queuedBuys.find(b => b.symbol === 'SIL');
  assert.equal(silInQueued, undefined, 'SIL must not be in queued buys');
  assert.ok(!plan.csv.includes(',SIL,') && !/(^|\n)[^,\n]*,SIL,/.test(plan.csv), 'SIL must not be exported in the Action Plan CSV');
});

test('Rule 7: Sector Concentration Guard limits immediate buys to max 5 per sector and caps single sector spend', async () => {
  const { generateActionPlan } = await import('./actionPlanService.js');
  const plan = await generateActionPlan({ externalCashBudget: 200000 });

  const sectorCounts = {};
  plan.immediateBuys.forEach(b => {
    const s = b.sector || 'Unknown';
    sectorCounts[s] = (sectorCounts[s] || 0) + 1;
    assert.ok(sectorCounts[s] <= 5, `Sector ${s} cannot have more than 5 immediate buys funded on the same day`);
  });
});

test('Rule 8: Tiered Trailing Stop Corridor widens stop floor to max(20%, 3.5x ATR) after +25% profit cushion is established', () => {
  // Setup synthetic prices: entry at 100, rises to 160 (+60% profit cushion)
  const prices = {};
  const start = new Date('2023-01-01T00:00:00Z');
  for (let i = 0; i < 420; i++) {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    if (i < 300) prices[d] = 100 + (i / 300) * 60; // rises to 160
    else prices[d] = 150; // normal consolidation
  }
  const entryDate = new Date(start.getTime() + 50 * 86400000).toISOString().slice(0, 10);
  const today = new Date(start.getTime() + 419 * 86400000).toISOString().slice(0, 10);

  const res = analyzeTechnicalTrend(prices, { today, entryDate, entryPrice: 100 });
  assert.ok(res.peakGainPct >= 50, 'Peak gain percent should be >= 50%');
  // With peak at 160, wide 20% floor is 160 * 0.80 = 128
  assert.ok(res.chandelierStopPrice >= 120, 'Wide corridor trailing stop should be well above early stop');
  assert.equal(res.trailingFloorPrice, res.chandelierStopPrice, 'Trailing floor price mirrors chandelier stop in deep profit');
});

test('Rule 9: Buy Analysis calculates 126-day Relative Strength and Multibagger Probability Score (MPS)', () => {
  const prices = weekdays(300, '2023-01-02');
  const dates = Object.keys(prices).sort();
  const today = dates.at(-1);

  // Boost last 126 days so price doubles
  const idx126Date = dates[dates.length - 126];
  const basePrice = prices[idx126Date];
  prices[today] = basePrice * 2.0; // +100% gain

  const candidate = { symbol: 'TESTSYM', name: 'Test Multibagger Ltd', inPortfolio: false };
  const buyAnalyses = buildBuyAnalyses({
    candidates: [candidate],
    priceHistory: { TESTSYM: prices },
    fundamentalsCache: { TESTSYM: { name: 'Test Multibagger Ltd', marketCapCr: 5000, debtToEquity: 0.2, promoterPledgePct: 0 } },
    today
  });

  assert.equal(buyAnalyses.length, 1);
  const a = buyAnalyses[0];
  assert.ok(a.rsScore > 50, `126-day Relative strength score (${a.rsScore}) should be > 50`);
  assert.ok(a.normalizedRs >= 75, `Normalized RS (${a.normalizedRs}) should be >= 75`);
  assert.ok(a.mps >= 60, `Multibagger Probability Score (MPS: ${a.mps}) should be >= 60`);
});

test('Rule 10: Next Day Action Plan calculates Recycled Capital starting at ₹45 Lakhs baseline and applies asymmetric conviction sizing', async () => {
  const { generateActionPlan } = await import('./actionPlanService.js');
  const plan = await generateActionPlan({
    externalCashBudget: 200000,
    userConfig: { baseRecycledCapital: 4500000, recycledCapitalBaselineDate: '2099-01-01' }
  });

  // Recycled capital should be at least ₹45 Lakhs baseline
  assert.ok(plan.summary.recycledCapital >= 4500000, `Recycled capital (${plan.summary.recycledCapital}) must be at least ₹45,00,000 baseline`);
  assert.ok(plan.summary.totalPurchasingPower >= 4700000, `Total purchasing power (${plan.summary.totalPurchasingPower}) must be at least ₹47,00,000`);

  // Immediate buys must be funded and have priority rank and sizing
  assert.ok(plan.immediateBuys.length > 0, 'Immediate buys should be funded from ₹47L+ purchasing power');
  const topImmediate = plan.immediateBuys[0];
  assert.ok(topImmediate.sizing.alloc > 0, 'Top candidate must have allocated capital');
  // Check that prime candidates receive up to ₹2.0L base
  const primeCandidate = plan.immediateBuys.find(b => b.sizing.tierLabel.includes('₹2L Base') || b.sizing.tierLabel.includes('Prime Ultra'));
  if (primeCandidate) {
    assert.ok(primeCandidate.sizing.alloc >= 200000, 'Prime Ultra candidates must receive ₹2L base allocation');
  }
});

test('Rule 11: Adaptive IPO Crash & Risk Protection Engine calculates trailing stop floor and protects healthy IPOs with < 40 weeks history', () => {
  // Generate 50 trading days of history (~10 weeks, < 40 weeks) for an IPO advancing from 100 to 130
  const prices = {};
  const start = new Date('2026-08-01T00:00:00Z');
  let cur = 100;
  for (let i = 0; i < 50; i++) {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    cur += (i % 2 === 0 ? 1 : 0.2);
    prices[d] = Number(cur.toFixed(2));
  }
  const dates = Object.keys(prices).sort();
  const today = dates.at(-1);
  const entryPrice = 100;
  const entryDate = dates[0];

  const trend = analyzeTechnicalTrend(prices, { today, entryDate, entryPrice });
  assert.equal(trend.isIpo, true, 'Stock with < 40 weeks should be identified as IPO');
  assert.ok(trend.trailingFloorPrice > 0, 'Adaptive IPO trailing stop floor must be calculated');
  assert.ok(trend.bufferToTrailingFloorPct > 0, 'Buffer to stop floor must be positive in advancing IPO');
  assert.equal(trend.stopFloorBreached, false, 'Stop floor must not be breached for healthy IPO');

  // Held position in analysisService
  const holdings = [{ id: 'ipo1', symbol: 'IPORUNNER', category_id: 'in_stocks', quantity: 500, current_price: cur }];
  const [analysis] = buildStockAnalyses(holdings, { IPORUNNER: prices }, {
    today,
    transactions: [{ holding_id: 'ipo1', type: 'BUY', date: entryDate, quantity: 500, price: 100 }]
  });

  assert.equal(analysis.state, 'NORMAL');
  assert.equal(analysis.action, 'HOLD_AND_COMPOUND');
  assert.equal(analysis.compoundingShield.isActive, true, 'Healthy IPO holding must have active compounding shield');
  assert.ok(analysis.trailingFloorPrice > 0);
  assert.match(analysis.explanation, /Adaptive IPO Shield Active|holding safely/i);
});

test('Rule 12: Adaptive IPO Crash & Risk Protection Engine triggers defensive trim on stop floor breach and full exit on severe crash', () => {
  const prices = {};
  const start = new Date('2026-08-01T00:00:00Z');
  let cur = 100;
  for (let i = 0; i < 50; i++) {
    const d = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
    cur += (i % 2 === 0 ? 0.8 : -0.2);
    prices[d] = Number(cur.toFixed(2));
  }
  const dates = Object.keys(prices).sort();
  const today = dates.at(-1);
  const entryPrice = 110;
  const entryDate = dates[10];

  // Case A: Price drops below stop floor (e.g. 98, -10.9% from entry 110)
  const breachPrice = 98;
  const holdingsBreach = [{ id: 'ipo1', symbol: 'IPORUNNER', category_id: 'in_stocks', quantity: 600, current_price: breachPrice }];
  const [trimAnalysis] = buildStockAnalyses(holdingsBreach, { IPORUNNER: prices }, {
    today,
    transactions: [{ holding_id: 'ipo1', type: 'BUY', date: entryDate, quantity: 600, price: entryPrice }]
  });

  assert.equal(trimAnalysis.state, 'FULL_EXIT_CANDIDATE', 'Unproven IPO breaching -8% stop must trigger FULL_EXIT_CANDIDATE');
  assert.equal(trimAnalysis.action, 'FULL_EXIT', 'Unproven IPO breaching -8% stop must trigger FULL_EXIT');
  assert.equal(trimAnalysis.suggestedSellQuantity, 600, 'Breached unproven IPO must suggest 100% position exit');
  assert.ok(trimAnalysis.stopFloorBreached, 'stopFloorBreached must be true');

  // Case B: Severe crash (price drops to 75, -31.8% from entry 110)
  const crashPrice = 75;
  const pricesCrash = { ...prices, [today]: crashPrice };
  const holdingsCrash = [{ id: 'ipo1', symbol: 'IPORUNNER', category_id: 'in_stocks', quantity: 600, current_price: crashPrice }];
  const [crashAnalysis] = buildStockAnalyses(holdingsCrash, { IPORUNNER: pricesCrash }, {
    today,
    transactions: [{ holding_id: 'ipo1', type: 'BUY', date: entryDate, quantity: 600, price: entryPrice }]
  });

  assert.equal(crashAnalysis.state, 'FULL_EXIT_CANDIDATE', 'Crashing IPO must trigger FULL_EXIT_CANDIDATE');
  assert.equal(crashAnalysis.action, 'FULL_EXIT', 'Crashing IPO must trigger FULL_EXIT');
  assert.equal(crashAnalysis.suggestedSellQuantity, 600, 'Crashing IPO must suggest 100% position exit');
});

test('Rule 13: M6 Unified Exit Engine — Holds 100% through mid-week noise and exits 100% only on 2 consecutive weekly closes below 30w-SMA', () => {
  // 48 weekly Friday closes ending 2026-11-06 (4 days before today 2026-11-10)
  const pricesA = weeklyPrices(Array(48).fill(100), '2025-12-12');
  // Winner up >= +15% (entry 80, cmp 110, 30w-SMA 100): must HOLD_AND_COMPOUND
  const holdingWinner = { id: 'h_m6_win', symbol: 'WINM6', category_id: 'in_stocks', quantity: 100, current_price: 110, avg_buy_price: 80 };
  const [winAnalysis] = buildStockAnalyses([holdingWinner], { WINM6: pricesA }, { today: '2026-11-10', transactions: [{ holding_id: 'h_m6_win', type: 'BUY', date: '2025-12-12', quantity: 100, price: 80 }] });
  assert.equal(winAnalysis.state, 'NORMAL');
  assert.equal(winAnalysis.action, 'HOLD_AND_COMPOUND');
  assert.equal(winAnalysis.stagedExitPlan.isSingleStageStop, true);
  assert.equal(winAnalysis.stagedExitPlan.tranche1.targetShares, 100);
  assert.equal(winAnalysis.stagedExitPlan.tranche2.status, 'INACTIVE');

  // 2 consecutive completed weekly closes below 30w-SMA (₹85 on Nov 13, ₹84 on Nov 20 < SMA): triggers 100% FULL_EXIT
  const pricesBreak = {
    ...pricesA,
    '2026-11-13': 85,
    '2026-11-20': 84
  };
  const [exitAnalysis] = buildStockAnalyses([{ ...holdingWinner, current_price: 84 }], { WINM6: pricesBreak }, { today: '2026-11-24', transactions: [{ holding_id: 'h_m6_win', type: 'BUY', date: '2025-12-12', quantity: 100, price: 80 }] });
  assert.equal(exitAnalysis.state, 'FULL_EXIT_CANDIDATE');
  assert.equal(exitAnalysis.action, 'FULL_EXIT');
  assert.equal(exitAnalysis.suggestedSellQuantity, 100);
});

test('Rule 14: Next Day Action Plan GTT Engine enforces unified 100% quantity parity across all open holdings (zero Tranche 1/2 split)', async () => {
  const { generateActionPlan } = await import('./actionPlanService.js');
  const plan = await generateActionPlan({ userId: '1' });
  assert.ok(plan, 'Plan must generate');
  assert.ok(Array.isArray(plan.stopLossActions) && plan.stopLossActions.length > 0, 'Must have stopLossActions array');

  for (const sl of plan.stopLossActions) {
    assert.equal(sl.targetQty, sl.qty, `${sl.symbol} GTT targetQty must equal 100% of held shares`);
    assert.ok(['INITIAL_10PCT', 'SMA30_TREND_EXIT'].includes(sl.tier), `${sl.symbol} tier (${sl.tier}) must be INITIAL_10PCT or SMA30_TREND_EXIT`);
  }
});

test('Rule 15: Canonical GTT parity matches Sell Analysis and Universe unlocks >=1000 Cr small/mid-cap multibaggers without peak bans', async () => {
  const { resolveCanonicalGttOrder } = await import('./analysisService.js');
  const { buildBuyAnalyses } = await import('./buyAnalysisService.js');

  // 1. Canonical M6 GTT parity: unproven <15% position anchors 100% shares to -10% flash stop
  const prices = weekdays(300, '2023-01-02');
  const dates = Object.keys(prices).sort();
  const today = dates.at(-1);
  const buyDate = dates.at(-10);
  const buyPrice = prices[buyDate];
  const cmp = Number((buyPrice * 0.96).toFixed(2));
  prices[today] = cmp;

  const [analysis] = buildStockAnalyses(
    [{ id: 'h_gtt_1', symbol: 'PARITYTEST', name: 'Parity Test', category_id: 'in_stocks', quantity: 100, current_price: cmp, avg_buy_price: buyPrice, investedValueINR: buyPrice * 100 }],
    { PARITYTEST: prices },
    { today, transactions: [{ holding_id: 'h_gtt_1', symbol: 'PARITYTEST', date: buyDate, type: 'BUY', quantity: 100, price: buyPrice, total_amount: buyPrice * 100 }], fundamentalsMap: { PARITYTEST: { status: 'AVAILABLE', opmTrendDirection: 'EXPANDING' } } }
  );
  const gtt = resolveCanonicalGttOrder(analysis, null);
  assert.equal(gtt.targetSlPrice, analysis.stagedExitPlan.tranche1.triggerPrice, 'GTT trigger must equal Sell Analysis trigger');
  assert.equal(gtt.targetQty, 100, 'GTT quantity must protect 100% of shares');
  assert.equal(gtt.tier, 'INITIAL_10PCT');

  // 2. Option A Stage 2 leader test: small/mid-cap strong momentum runner retains BUY/STRONG_BUY
  const spikePrices = weekdays(300, '2023-01-02');
  const spikeDates = Object.keys(spikePrices).sort();
  const basePx = spikePrices[spikeDates.at(-30)];
  for (let i = spikeDates.length - 25; i < spikeDates.length; i++) {
    spikePrices[spikeDates[i]] = Number((basePx * (1 + (i - (spikeDates.length - 26)) * 0.03)).toFixed(2));
  }
  const spikeToday = spikeDates.at(-1);
  const [buyCandidate] = buildBuyAnalyses({
    candidates: [{ symbol: 'SMID_MULTIBAGGER', name: 'SmallMid Winner Ltd', source: 'NSE500', marketCapCr: 2200, currentPrice: spikePrices[spikeToday], category: 'in_stocks' }],
    priceHistory: { SMID_MULTIBAGGER: spikePrices },
    fundamentalsCache: { SMID_MULTIBAGGER: { status: 'AVAILABLE', opmTrendDirection: 'EXPANDING', yoySalesGrowthPct: 25, yoyPatGrowthPct: 30, roePct: 20, rocePct: 22, debtToEquity: 0.2, promoterPledgePct: 0, latestQuarterPat: 100, annualSales: [100, 120, 150, 190], annualPat: [10, 13, 17, 22], quarterlySales: [35, 40, 45, 52, 60], quarterlyPat: [4, 5, 6, 7, 8] } },
    today: spikeToday
  });
  assert.ok(buyCandidate, 'Candidate must evaluate');
  assert.ok(['STRONG_BUY', 'BUY'].includes(buyCandidate.buySignal), `Strong Stage 2 ₹2,200 Cr leader must qualify as STRONG_BUY or BUY, got ${buyCandidate.buySignal}`);

  // 3. Expanded universe verifies > 1000 stocks including small/mid caps
  const universe = buildCandidateUniverse([], [], [], []);
  assert.ok(universe.length >= 1000, `Candidate universe must include >= 1,000 small/mid/large stocks (>= ₹1,000 Cr), got ${universe.length}`);
});

test('Rule 16: Blended 3M/6M RS Velocity, 50% Extended Runner Tranche 1, M6 -10% Buy Stop Parity & Clean 8-Col CSV', async () => {
  const { buildBuyAnalyses } = await import('./buyAnalysisService.js');
  const { generateActionPlan, buildActionPlanCsv } = await import('./actionPlanService.js');

  // 1. Blended 3M/6M RS: Accelerating recent 3M breakout beats cooling 6M spike
  const dates = Object.keys(weekdays(260, '2024-01-01')).sort();
  const today = dates.at(-1);
  const fastRecent = {};
  const staleSpike = {};
  dates.forEach((d, idx) => {
    // Stock A: flat first 195d (~100), then accelerates +45% in last 63d
    fastRecent[d] = idx < 195 ? 100 : Number((100 * (1 + ((idx - 194) / 65) * 0.45)).toFixed(2));
    // Stock B: spiked +90% early, flat/slowed to +5% in last 63d
    staleSpike[d] = idx < 195 ? Number((100 + (idx / 195) * 90).toFixed(2)) : Number((190 * (1 + ((idx - 194) / 65) * 0.05)).toFixed(2));
  });
  const baseFund = { status: 'AVAILABLE', marketCapCr: 5000, yoySalesGrowthPct: 30, yoyPatGrowthPct: 40, roePct: 22, rocePct: 25, debtToEquity: 0.1, promoterPledgePct: 0, annualSales: [100, 130, 170, 220], annualPat: [10, 14, 19, 27], quarterlySales: [40, 45, 50, 58, 65], quarterlyPat: [5, 6, 7, 8, 10] };
  const evals = buildBuyAnalyses({
    candidates: [
      { symbol: 'ACCEL3M', name: 'Accel 3M Ltd', source: 'NSE500', marketCapCr: 5000 },
      { symbol: 'COOL6M', name: 'Cooling 6M Ltd', source: 'NSE500', marketCapCr: 5000 }
    ],
    priceHistory: { ACCEL3M: fastRecent, COOL6M: staleSpike },
    fundamentalsCache: { ACCEL3M: baseFund, COOL6M: baseFund },
    today
  });
  const accel = evals.find(x => x.symbol === 'ACCEL3M');
  const cool = evals.find(x => x.symbol === 'COOL6M');
  assert.ok(accel && cool, 'Both candidates must be analyzed');
  assert.ok(accel.normalizedRs > cool.normalizedRs, `Accelerating 3M breakout RS (${accel.normalizedRs}) must outscore cooling 6M spike (${cool.normalizedRs})`);

  // 2. Action Plan: Extended runner receives 50% Tranche 1 and M6 -10% Flash Stop parity
  const plan = await generateActionPlan({ externalCashBudget: 200000, forceRefresh: true });
  const extBuy = plan.immediateBuys.find(b => !b.isOwned && b.stance === 'EXTENDED_RUNNER');
  if (extBuy) {
    assert.ok(extBuy.actionType.includes('TRANCHE 1 (50%'), `Extended new buy ${extBuy.symbol} must be tagged TRANCHE 1 (50%), got ${extBuy.actionType}`);
    const expectedM6Sl = Math.round(extBuy.cmp * 90) / 100;
    assert.equal(extBuy.sl, expectedM6Sl, `Extended new buy ${extBuy.symbol} SL (${extBuy.sl}) must match M6 -10% flash stop (${expectedM6Sl})`);
  }

  // 3. Clean 8-column CSV excludes UP_TO_DATE & QUEUED bloat
  const { rows } = buildActionPlanCsv({
    immediateBuys: [{ symbol: 'TESTA', name: 'Test A', cmp: 100, actionShares: 10, actionValue: 1000, sl: 90, isOwned: false, actionType: 'BUY - TRANCHE 1 (50% - EXTENDED)', extAbove30w: 42 }],
    sells: [],
    stopLossActions: [
      { symbol: 'KEEP', name: 'Keep Ltd', cmp: 200, qty: 10, targetQty: 10, targetSlPrice: 180, isActionRequired: false, gttStatus: 'UP_TO_DATE' },
      { symbol: 'RAISE', name: 'Raise Ltd', cmp: 300, qty: 20, targetQty: 20, targetSlPrice: 270, activeGttPrice: 240, isActionRequired: true, gttStatus: 'ACTION_REQUIRED_AMEND' }
    ]
  });
  assert.equal(rows.length, 3, 'Header + 1 buy + 1 actionable GTT update = 3 rows (excluding UP_TO_DATE)');
  assert.equal(rows[0].length, 8, 'Clean CSV must have 8 columns');
  assert.equal(rows[1][0], 'BUY (50% TRANCHE 1)');
  assert.equal(rows[2][0], 'AMEND GTT SL');
});
