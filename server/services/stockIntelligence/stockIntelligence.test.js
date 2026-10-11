import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateWeeklyCloses, analyzeTechnicalTrend, normalizePriceSeries } from './technicalIndicators.js';
import { runTrendStrategy } from './backtestEngine.js';
import { buildStockAnalyses } from './analysisService.js';

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
});

test('insufficient history cannot produce a sell state', () => {
  const result = analyzeTechnicalTrend(weeklyPrices(Array(20).fill(100)), { today: '2024-06-02' });
  assert.equal(result.state, 'DATA_UNAVAILABLE');
});

test('rising price history does not trigger a trend exit', () => {
  const prices = weeklyPrices(Array.from({ length: 60 }, (_, index) => 100 + index * 2));
  assert.equal(analyzeTechnicalTrend(prices, { today: '2025-03-02' }).state, 'NORMAL');
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
