import { normalizePriceSeries, aggregateWeeklyCloses, simpleMovingAverage } from './technicalIndicators.js';

export const STOCK_EXIT_RULE_VERSION = '30w-confirmed-breakdown-v1';
export const BACKTEST_COST_RATE = 0.005; // 0.50% one-way stress assumption; excludes tax.
const STRATEGY_VARIANTS = [0.25, 0.5, 1];
const PERIODS = [
  { id: 'training', label: 'Training', start: '2012-01-01', end: '2019-12-31' },
  { id: 'validation', label: 'Validation', start: '2020-01-01', end: '2022-12-31' },
  { id: 'test', label: 'Held-out test', start: '2023-01-01', end: '2999-12-31' }
];

function makeSignalTimeline(prices, startDate, endDate) {
  const daily = normalizePriceSeries(prices).filter(row => row.date <= endDate);
  const dailyByDate = new Map(daily.map((row, index) => [row.date, index]));
  const weekly = aggregateWeeklyCloses(daily, { today: '2999-12-31' });
  const weeklyCloses = weekly.map(row => row.close);
  const sma = weekly.map((_, index) => simpleMovingAverage(weeklyCloses.slice(0, index + 1), 30));
  const signals = new Map();
  let trimmed = false;
  let belowCount = 0;
  let aboveCount = 0;
  for (let i = 0; i < weekly.length; i += 1) {
    const average = sma[i];
    if (average === null) continue;
    if (weekly[i].date < startDate) continue;
    const below = weekly[i].close < average;
    const falling = i >= 4 && sma[i - 4] !== null && average < sma[i - 4];
    belowCount = below ? belowCount + 1 : 0;
    aboveCount = weekly[i].close > average ? aboveCount + 1 : 0;
    let action = null;
    if (!trimmed && belowCount >= 3 && falling) {
      action = 'TRIM';
      trimmed = true;
    } else if (trimmed && aboveCount >= 2) {
      action = 'REENTER';
      trimmed = false;
      belowCount = 0;
    }
    if (!action || weekly[i].date < startDate || weekly[i].date > endDate) continue;
    const weekEndIndex = dailyByDate.get(weekly[i].date);
    const execution = daily[weekEndIndex + 1];
    if (execution && execution.date >= startDate && execution.date <= endDate) signals.set(execution.date, action);
  }
  return signals;
}

function summarizeCurve(curve, trades) {
  if (curve.length < 2) return null;
  const first = curve[0];
  const last = curve.at(-1);
  const years = (Date.parse(`${last.date}T00:00:00Z`) - Date.parse(`${first.date}T00:00:00Z`)) / (365.2425 * 86400000);
  const totalReturnPct = (last.equity / first.equity - 1) * 100;
  let peak = curve[0].equity;
  let maxDrawdownPct = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdownPct = Math.min(maxDrawdownPct, (point.equity / peak - 1) * 100);
  }
  return {
    totalReturnPct,
    cagrPct: years > 0 && last.equity > 0 ? (Math.pow(last.equity / first.equity, 1 / years) - 1) * 100 : null,
    maxDrawdownPct,
    trades,
    firstDate: first.date,
    lastDate: last.date
  };
}

export function runTrendStrategy(prices, { startDate, endDate, trimFraction = 1, costRate = BACKTEST_COST_RATE } = {}) {
  const daily = normalizePriceSeries(prices).filter(row => row.date >= startDate && row.date <= endDate);
  if (daily.length < 80) return null;
  const signals = makeSignalTimeline(prices, startDate, endDate);
  let shares = 1;
  const initialFee = daily[0].close * costRate;
  let cash = -initialFee;
  let trades = 0;
  const curve = [];
  const holdCurve = [];
  const exitOutcomes = [];
  const holdShares = 1;
  for (let index = 0; index < daily.length; index += 1) {
    const row = daily[index];
    const action = signals.get(row.date);
    if (action === 'TRIM' && shares > (1 - trimFraction) + 1e-8) {
      const sold = Math.min(shares, trimFraction);
      cash += sold * row.close * (1 - costRate);
      shares -= sold;
      trades += 1;
      const future = daily.slice(index + 1, index + 127).map(item => item.close);
      if (future.length) {
        exitOutcomes.push({
          forwardReturnPct: (future.at(-1) / row.close - 1) * 100,
          worstForwardDrawdownPct: (Math.min(...future) / row.close - 1) * 100,
          missedUpside: future.at(-1) / row.close - 1 >= 0.1
        });
      }
    } else if (action === 'REENTER' && shares < 1 - 1e-8) {
      const needed = 1 - shares;
      const spend = Math.min(Math.max(0, cash), needed * row.close * (1 + costRate));
      const bought = spend / (row.close * (1 + costRate));
      shares += bought;
      cash -= spend;
      trades += 1;
    }
    curve.push({ date: row.date, equity: cash + shares * row.close });
    holdCurve.push({ date: row.date, equity: holdShares * row.close - initialFee });
  }
  return {
    strategy: summarizeCurve(curve, trades),
    buyAndHold: summarizeCurve(holdCurve, 0),
    observations: daily.length,
    trimFraction,
    exitOutcomes
  };
}

const round = value => Number.isFinite(value) ? Number(value.toFixed(2)) : null;

function aggregateResults(rows) {
  if (!rows.length) return null;
  const mean = key => rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0) / rows.length;
  return {
    symbols: rows.length,
    avgCagrPct: round(mean('cagrPct')),
    medianCagrPct: round([...rows].sort((a, b) => a.cagrPct - b.cagrPct)[Math.floor(rows.length / 2)].cagrPct),
    avgTotalReturnPct: round(mean('totalReturnPct')),
    avgMaxDrawdownPct: round(mean('maxDrawdownPct')),
    avgTrades: round(mean('trades')),
    exits: rows.reduce((sum, row) => sum + (Number(row.exits) || 0), 0),
    avgForwardReturnAfterExitPct: round(mean('avgForwardReturnAfterExitPct')),
    missedUpsideExits: rows.reduce((sum, row) => sum + (Number(row.missedUpsideExits) || 0), 0),
    exitsWith10PctPlusForwardUpside: rows.reduce((sum, row) => sum + (Number(row.exitsWith10PctPlusForwardUpside) || 0), 0),
    avgWorstForwardDrawdownAfterExitPct: round(mean('avgWorstForwardDrawdownAfterExitPct')),
    avgBuyAndHoldCagrPct: round(mean('buyAndHoldCagrPct')),
    avgBuyAndHoldDrawdownPct: round(mean('buyAndHoldDrawdownPct')),
    beatBuyAndHold: rows.filter(row => row.cagrPct > row.buyAndHoldCagrPct).length,
    lowerDrawdown: rows.filter(row => row.maxDrawdownPct > row.buyAndHoldDrawdownPct).length
  };
}

function tickerPeriod(prices, period) {
  const daily = normalizePriceSeries(prices).filter(row => row.date >= period.start && row.date <= period.end);
  return daily.length >= 200 ? daily : null;
}

export function runWalkForwardBacktest(priceMap, symbols = Object.keys(priceMap || {})) {
  const available = symbols.map(symbol => ({ symbol, prices: priceMap[symbol] })).filter(item => item.prices);
  const byPeriod = {};
  for (const period of PERIODS) {
    const eligible = available.map(item => ({ ...item, daily: tickerPeriod(item.prices, period) })).filter(item => item.daily);
    const variants = STRATEGY_VARIANTS.map(trimFraction => {
      const rows = eligible.map(item => {
        const result = runTrendStrategy(item.prices, { startDate: period.start, endDate: period.end, trimFraction });
        return result ? {
          symbol: item.symbol,
          cagrPct: result.strategy.cagrPct,
          totalReturnPct: result.strategy.totalReturnPct,
          maxDrawdownPct: result.strategy.maxDrawdownPct,
          trades: result.strategy.trades,
          exits: result.exitOutcomes.length,
          buyAndHoldCagrPct: result.buyAndHold.cagrPct,
          buyAndHoldDrawdownPct: result.buyAndHold.maxDrawdownPct,
          avgForwardReturnAfterExitPct: result.exitOutcomes.length ? result.exitOutcomes.reduce((sum, row) => sum + row.forwardReturnPct, 0) / result.exitOutcomes.length : 0,
          missedUpsideExits: result.exitOutcomes.filter(row => row.missedUpside).length,
          exitsWith10PctPlusForwardUpside: result.exitOutcomes.filter(row => row.missedUpside).length,
          avgWorstForwardDrawdownAfterExitPct: result.exitOutcomes.length ? result.exitOutcomes.reduce((sum, row) => sum + row.worstForwardDrawdownPct, 0) / result.exitOutcomes.length : 0
        } : null;
      }).filter(Boolean);
      return { trimFraction, aggregate: aggregateResults(rows), rows };
    });
    const holdRows = eligible.map(item => {
      const result = runTrendStrategy(item.prices, { startDate: period.start, endDate: period.end, trimFraction: 0 });
      return result ? {
        symbol: item.symbol,
        cagrPct: result.buyAndHold.cagrPct,
        totalReturnPct: result.buyAndHold.totalReturnPct,
        maxDrawdownPct: result.buyAndHold.maxDrawdownPct,
        trades: 0,
        buyAndHoldCagrPct: result.buyAndHold.cagrPct,
        buyAndHoldDrawdownPct: result.buyAndHold.maxDrawdownPct
      } : null;
    }).filter(Boolean);
    byPeriod[period.id] = {
      label: period.label,
      start: period.start,
      end: period.id === 'test' ? null : period.end,
      eligibleSymbols: eligible.length,
      excludedSymbols: available.length - eligible.length,
      buyAndHold: aggregateResults(holdRows),
      candidates: variants.map(({ trimFraction, aggregate }) => ({ trimFraction, ...aggregate }))
    };
  }

  const validationCandidates = byPeriod.validation.candidates.filter(candidate => candidate.symbols > 0);
  const exploratory = validationCandidates
    .filter(candidate => candidate.avgMaxDrawdownPct > byPeriod.validation.buyAndHold.avgMaxDrawdownPct)
    .sort((a, b) => b.avgCagrPct - a.avgCagrPct)[0] || null;
  const selected = validationCandidates
    .filter(candidate => candidate.avgCagrPct >= byPeriod.validation.buyAndHold.avgCagrPct - 0.5
      && candidate.avgMaxDrawdownPct > byPeriod.validation.buyAndHold.avgMaxDrawdownPct)
    .sort((a, b) => b.avgCagrPct - a.avgCagrPct || b.avgMaxDrawdownPct - a.avgMaxDrawdownPct)[0] || null;
  const testCandidate = selected && byPeriod.test.candidates.find(candidate => candidate.trimFraction === selected.trimFraction);
  const testHold = byPeriod.test.buyAndHold;
  const passedOutOfSample = Boolean(testCandidate?.symbols && testHold
    && testCandidate.avgCagrPct >= testHold.avgCagrPct
    && testCandidate.avgMaxDrawdownPct > testHold.avgMaxDrawdownPct);

  return {
    version: STOCK_EXIT_RULE_VERSION,
    generatedAt: new Date().toISOString(),
    provider: 'Existing local historical_prices.json cache (adjusted close values where originally supplied)',
    priceBasis: 'Daily close only; OHLCV, dividend reinvestment, corporate-action audit, and historical delisted universe are unavailable.',
    execution: `Signal at completed weekly close, trade at next available daily close; ${BACKTEST_COST_RATE * 100}% one-way friction assumption; excludes tax.`,
    periods: byPeriod,
    selectedValidationTrimFraction: selected?.trimFraction ?? null,
    exploratoryTrimFraction: exploratory?.trimFraction ?? null,
    passedOutOfSample,
    outcome: passedOutOfSample
      ? 'The selected validation candidate also beat buy-and-hold on held-out average return and drawdown. This remains an exploratory result for today’s holdings only.'
      : 'No tested partial-trim setting passed the pre-set held-out return and drawdown checks. The system will not present a backtest-validated technical sell quantity.',
    limitations: [
      'The sample is today’s held positions and excludes delisted or failed companies, creating survivorship and selection bias.',
      'The price cache does not contain audited OHLCV, point-in-time fundamentals, all corporate actions, or dividend reinvestment.',
      'Transaction cost is a stress assumption, not your broker’s actual fee schedule. Tax is excluded.',
      'Historical performance does not establish future success; this backtest is exploratory and does not certify a strategy.'
    ]
  };
}
