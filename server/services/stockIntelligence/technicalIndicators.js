const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizePriceSeries(rawPrices = {}) {
  return Object.entries(rawPrices)
    .map(([date, value]) => ({ date, close: Number(value) }))
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function weekStart(date) {
  const utc = new Date(`${date}T00:00:00Z`);
  const day = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - day);
  return utc.toISOString().slice(0, 10);
}

export function aggregateWeeklyCloses(series, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const weeks = new Map();
  for (const row of series) {
    const key = weekStart(row.date);
    const previous = weeks.get(key);
    if (!previous || row.date > previous.date) weeks.set(key, { date: row.date, close: row.close, week: key });
  }
  const currentWeek = weekStart(today);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const excludeCurrentWeek = weekday >= 1 && weekday <= 5;
  return [...weeks.entries()]
    .filter(([key]) => !excludeCurrentWeek || key < currentWeek)
    .map(([, value]) => value)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function simpleMovingAverage(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const window = values.slice(-period);
  return window.reduce((sum, value) => sum + value, 0) / period;
}

/**
 * Calculates Average True Range (ATR) across weekly price closes
 */
export function calculateWeeklyATR(weeklyCloses = [], period = 14) {
  if (weeklyCloses.length < period + 1) return null;
  const trueRanges = [];
  for (let i = 1; i < weeklyCloses.length; i++) {
    // With close-only series, True Range is approximated by absolute delta between successive closes
    const tr = Math.abs(weeklyCloses[i] - weeklyCloses[i - 1]);
    trueRanges.push(tr);
  }
  if (trueRanges.length < period) return null;
  const recent = trueRanges.slice(-period);
  return recent.reduce((sum, v) => sum + v, 0) / period;
}

export function analyzeTechnicalTrend(rawPrices, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const daily = normalizePriceSeries(rawPrices);
  const weekly = aggregateWeeklyCloses(daily, { today });
  const latest = weekly.at(-1);
  const latestSma = simpleMovingAverage(weekly.map(row => row.close), 30);
  const isUsable = weekly.length >= 40 && latestSma !== null;

  if (!isUsable) {
    return {
      state: 'DATA_UNAVAILABLE',
      dataQuality: 'INSUFFICIENT_HISTORY',
      dailyObservations: daily.length,
      weeklyObservations: weekly.length,
      latestPriceDate: daily.at(-1)?.date || null,
      weeklyClose: latest?.close ?? null,
      sma30Week: latestSma,
      weeksBelowAverage: 0,
      slopeDown: null,
      weinsteinStage: null,
      weinsteinStageLabel: 'Insufficient History',
      chandelierStopPrice: null,
      isCompoundingProtected: false,
      trailingFloorPrice: null,
      bufferToTrailingFloorPct: null,
      evidence: [],
      invalidation: 'Build at least 40 completed weekly observations before evaluating a trend.'
    };
  }

  const closes = weekly.map(row => row.close);
  const smaHistory = weekly.map((_, index) => simpleMovingAverage(closes.slice(0, index + 1), 30));
  let weeksBelowAverage = 0;
  for (let i = weekly.length - 1; i >= 0; i -= 1) {
    const sma = smaHistory[i];
    if (sma === null || weekly[i].close >= sma) break;
    weeksBelowAverage += 1;
  }
  const priorSma = smaHistory.at(-5);
  const slopeDown = priorSma !== null && priorSma !== undefined && latestSma < priorSma;
  const confirmed = weeksBelowAverage >= 3 && slopeDown;
  const watch = weeksBelowAverage >= 2;
  const last20 = weekly.slice(-20).map(row => row.close);
  const peak20 = Math.max(...last20);
  const drawdownFrom20WeekHigh = peak20 > 0 ? latest.close / peak20 - 1 : null;
  const dailyReturns = daily.slice(-61).slice(1).map((row, index) => row.close / daily.slice(-61)[index].close - 1);
  const volatility20Day = dailyReturns.length >= 20
    ? Math.sqrt(dailyReturns.slice(-20).reduce((sum, value) => sum + value * value, 0) * 252 / 20)
    : null;

  // 1. Stan Weinstein Stage Analysis (1 to 4)
  let weinsteinStage = 2;
  let weinsteinStageLabel = 'Stage 2 (Advancing / Bull)';
  const slopePct = priorSma ? (latestSma / priorSma - 1) * 100 : 0;
  const isAboveSma = latest.close >= latestSma;

  if (isAboveSma && slopePct >= -0.5) {
    weinsteinStage = 2;
    weinsteinStageLabel = 'Stage 2 (Advancing / Bull)';
  } else if (isAboveSma && slopePct < -0.5) {
    weinsteinStage = 3;
    weinsteinStageLabel = 'Stage 3 (Distribution / Topping)';
  } else if (!isAboveSma && slopePct < 0) {
    weinsteinStage = 4;
    weinsteinStageLabel = 'Stage 4 (Declining / Bear)';
  } else {
    weinsteinStage = 1;
    weinsteinStageLabel = 'Stage 1 (Base / Accumulation)';
  }

  // 2. Chandelier Trailing Exit: Peak(20w) - 3.0 * ATR(14w)
  const atr14 = calculateWeeklyATR(closes, 14) || (latest.close * 0.04);
  const chandelierStopPrice = Number(Math.max(0, peak20 - 3.0 * atr14).toFixed(2));

  // 3. Compounding Protection Engine
  // A stock in Stage 2 Bull that trades above its trailing stop has active compounding protection.
  // Standard 15% to 25% pullbacks in Indian growth stocks are recognized as normal volatility.
  const isCompoundingProtected = weinsteinStage === 2 && latest.close >= chandelierStopPrice;
  const trailingFloorPrice = Number(Math.max(latestSma * 0.95, chandelierStopPrice).toFixed(2));
  const bufferToTrailingFloorPct = latest.close > 0 && trailingFloorPrice > 0
    ? Number(((latest.close / trailingFloorPrice - 1) * 100).toFixed(2))
    : 0;

  const state = confirmed ? 'TECHNICAL_TRIM_CANDIDATE' : watch ? 'WATCH' : 'NORMAL';
  const evidence = [
    { key: 'weekly_close_vs_30w_sma', value: latest.close / latestSma - 1, observedAt: latest.date },
    { key: 'consecutive_weekly_closes_below_sma', value: weeksBelowAverage, observedAt: latest.date },
    { key: '30w_sma_four_week_slope', value: priorSma ? latestSma / priorSma - 1 : null, observedAt: latest.date },
    { key: 'drawdown_from_20w_high', value: drawdownFrom20WeekHigh, observedAt: latest.date },
    { key: 'weinstein_stage', value: weinsteinStage, observedAt: latest.date },
    { key: 'chandelier_stop_price', value: chandelierStopPrice, observedAt: latest.date }
  ];

  return {
    state,
    dataQuality: 'PRICE_HISTORY_ONLY',
    dailyObservations: daily.length,
    weeklyObservations: weekly.length,
    latestPriceDate: daily.at(-1)?.date || null,
    lastCompletedWeek: latest.date,
    weeklyClose: latest.close,
    sma30Week: latestSma,
    sma30WeekFourWeekSlopePct: priorSma ? (latestSma / priorSma - 1) * 100 : null,
    weeksBelowAverage,
    slopeDown,
    drawdownFrom20WeekHighPct: drawdownFrom20WeekHigh === null ? null : drawdownFrom20WeekHigh * 100,
    annualizedVolatility20DayPct: volatility20Day === null ? null : volatility20Day * 100,
    weinsteinStage,
    weinsteinStageLabel,
    peak20WeekPrice: peak20,
    chandelierStopPrice,
    isCompoundingProtected,
    trailingFloorPrice,
    bufferToTrailingFloorPct,
    evidence,
    invalidation: confirmed
      ? 'The technical exit concern clears after two completed weekly closes above the 30-week average.'
      : watch
        ? 'The watch clears after two completed weekly closes above the 30-week average.'
        : 'A technical exit review starts only after three completed weekly closes below a falling 30-week average.'
  };
}

export function observedReturn(series, days) {
  if (!series?.length) return null;
  const last = series.at(-1);
  const target = Date.parse(`${last.date}T00:00:00Z`) - days * DAY_MS;
  let base = null;
  for (const row of series) {
    if (Date.parse(`${row.date}T00:00:00Z`) >= target) { base = row; break; }
  }
  if (!base || !(base.close > 0)) return null;
  return { pct: (last.close / base.close - 1) * 100, from: base.date, to: last.date };
}
