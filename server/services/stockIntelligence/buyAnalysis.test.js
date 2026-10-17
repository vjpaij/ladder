import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFundamentalScore } from './fundamentalScorer.js';
import { applyChartinkFilter, addToWatchlist, removeFromWatchlist, loadWatchlist } from './buyUniverseProvider.js';
import { buildSipPlan, shouldGenerateSipPlan } from './sipPositionBuilder.js';
import { computeEarningsCatalyst } from './earningsCatalystService.js';
import { isNoise, extractSignals } from './newsIntelService.js';
import { buildBuyAnalyses } from './buyAnalysisService.js';

test('Fundamental Scorer: awards high score for strong compounder', () => {
  const fundamentals = {
    status: 'AVAILABLE',
    annualSales: [1000, 1300, 1750, 2400],
    annualPat: [100, 135, 185, 260],
    annualEps: [10, 13.5, 18.5, 26],
    quarterlySales: [500, 550, 600, 650, 700],
    quarterlyPat: [50, 58, 65, 72, 85],
    debtToEquity: 0.05,
    rocePct: 28,
    roePct: 24,
    promoterPledgePct: 0,
    promoterHoldingPct: 65,
    fiiHoldingQoQDelta: 1.2
  };

  const result = computeFundamentalScore(fundamentals);
  assert.equal(result.isValid, true);
  assert.ok(result.score >= 80, `Expected score >= 80, got ${result.score}`);
  assert.equal(result.hasGovernanceRedFlag, false);
  assert.equal(result.fundamentalGrade, 'A');
  assert.ok(result.tags.some(t => t.tag === 'ZERO_DEBT'));
  assert.ok(result.tags.some(t => t.tag === 'FII_ACCUMULATING'));
});

test('Fundamental Scorer: flags governance risks and high debt', () => {
  const fundamentals = {
    status: 'AVAILABLE',
    annualSales: [1000, 1050, 1020, 980],
    annualPat: [100, 80, 50, 10],
    annualEps: [10, 8, 5, 1],
    debtToEquity: 3.5,
    promoterPledgePct: 35,
    rocePct: 5,
    roePct: 3
  };

  const result = computeFundamentalScore(fundamentals);
  assert.equal(result.hasGovernanceRedFlag, true);
  assert.ok(result.score < 30, `Expected score < 30, got ${result.score}`);
  assert.ok(result.tags.some(t => t.tag === 'HIGH_PLEDGE_RISK'));
  assert.ok(result.tags.some(t => t.tag === 'HIGH_DEBT'));
});

test('SIP Position Builder: correctly allocates 3 tranches', () => {
  const plan = buildSipPlan({
    symbol: 'TATAMOTORS',
    name: 'Tata Motors Ltd',
    buySignal: 'STRONG_BUY',
    currentPrice: 1000,
    ema50: 950,
    sma30w: 900,
    high52w: 1050,
    fundamentalScore: 82,
    technicalScore: 78,
    customBudget: 100000
  });

  assert.equal(plan.totalBudget, 100000);
  assert.equal(plan.tranches.length, 3);
  assert.equal(plan.tranches[0].amount, 30000); // 30%
  assert.equal(plan.tranches[1].amount, 35000); // 35%
  assert.equal(plan.tranches[2].amount, 35000); // 35%
  assert.equal(plan.tranches[0].status, 'READY');
  assert.equal(plan.tranches[1].status, 'ARMED');
  assert.equal(plan.tranches[2].status, 'CONTINGENT');
  assert.ok(plan.stopLoss !== null);
  assert.ok(plan.exitTarget !== null);
});

test('SIP Position Builder: pauses within 15 days of earnings', () => {
  const shouldGen = shouldGenerateSipPlan(
    { buySignal: 'STRONG_BUY', fundamentalScore: 75 },
    { daysToResult: 8 }
  );
  assert.equal(shouldGen, false, 'Should pause SIP generation within 15 days of results');

  const shouldGenAfter = shouldGenerateSipPlan(
    { buySignal: 'STRONG_BUY', fundamentalScore: 75 },
    { daysToResult: 25 }
  );
  assert.equal(shouldGenAfter, true, 'Should allow SIP generation when results are far');
});

test('Earnings Catalyst: detects pre-drift zone and historical beat pattern', () => {
  const catalyst = computeEarningsCatalyst('RELIANCE', {
    nextResultDate: new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10),
    historicalSurprises: ['+5.2%', '+8.1%', '+3.4%', '-1.2%']
  });

  assert.equal(catalyst.isPreDriftZone, true);
  assert.equal(catalyst.daysToResult, 6);
  assert.equal(catalyst.beats, 3);
  assert.equal(catalyst.beatRate, 75);
  assert.ok(catalyst.signalModifier === 'CATALYST_BOOST' || catalyst.signalModifier === 'STANDARD');
  assert.ok(catalyst.educationalContext.includes('options') || catalyst.educationalContext.includes('quarterly'));
});

test('News Intel: extracts positive order win and rejects noise', () => {
  const lntTitle = 'L&T wins mega order worth Rs 5,000 crore from defence ministry';
  const sensexTitle = 'Sensex falls 200 points on global cues';
  const sebiTitle = 'SEBI issues notice to company promoter over disclosure violation';

  assert.equal(isNoise(sensexTitle), true, 'Generic Sensex commentary must be identified as noise');
  assert.equal(isNoise(lntTitle), false, 'Order win must not be flagged as noise');

  const lntSignals = extractSignals(lntTitle);
  assert.ok(lntSignals.length > 0);
  assert.ok(lntSignals.some(s => s.category === 'ORDER_WIN' || s.category === 'GOVT_ORDER'));

  const sebiSignals = extractSignals(sebiTitle);
  assert.ok(sebiSignals.length > 0);
  assert.ok(sebiSignals.some(s => s.category === 'REGULATORY'));
});

test('Buy Analysis Engine: classifies STRONG_BUY on dual-pillar confluence', () => {
  const holdings = [{
    id: 'test-1',
    symbol: 'TCS',
    name: 'Tata Consultancy Services',
    category_id: 'in_stocks',
    current_price: 3500,
    quantity: 10
  }];

  const priceHistory = {
    TCS: {}
  };
  // Generate 60 weeks of rising prices for Stage 2
  const start = new Date('2024-01-01T00:00:00Z');
  for (let i = 0; i < 60; i++) {
    const d = new Date(start.getTime() + i * 7 * 86400000).toISOString().slice(0, 10);
    priceHistory.TCS[d] = 2500 + i * 20; // Rising from 2500 to 3680
  }

  const fundamentals = {
    TCS: {
      status: 'AVAILABLE',
      annualSales: [100000, 130000, 175000, 240000],
      annualPat: [20000, 28000, 38000, 52000],
      annualEps: [80, 105, 140, 190],
      quarterlySales: [50000, 55000, 60000, 65000, 70000],
      quarterlyPat: [10000, 11500, 13000, 14500, 16000],
      debtToEquity: 0.05,
      rocePct: 45,
      roePct: 38,
      promoterPledgePct: 0
    }
  };

  const analyses = buildBuyAnalyses({
    holdings,
    priceHistory,
    fundamentalsCache: fundamentals,
    today: '2025-04-01'
  });

  assert.equal(analyses.length, 1);
  const tcs = analyses[0];
  assert.equal(tcs.symbol, 'TCS');
  assert.ok(tcs.fundamentalScore >= 70, `Fundamental score: ${tcs.fundamentalScore}`);
  assert.ok(tcs.buySignal === 'STRONG_BUY' || tcs.buySignal === 'BUY', `Signal was ${tcs.buySignal}`);
  assert.ok(tcs.sipPlan !== null, 'SIP plan should be generated for strong candidate');
});
