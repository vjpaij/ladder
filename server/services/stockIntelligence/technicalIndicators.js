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

export function aggregateWeeklyCloses(series, { today = new Date().toISOString().slice(0, 10), includeCurrentWeek = false } = {}) {
  const weeks = new Map();
  for (const row of series) {
    const key = weekStart(row.date);
    const previous = weeks.get(key);
    if (!previous || row.date > previous.date) weeks.set(key, { date: row.date, close: row.close, week: key });
  }
  const currentWeek = weekStart(today);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  // An active incomplete week is excluded during Mon-Fri trading unless includeCurrentWeek is explicitly true or it is the weekend (Sat=6, Sun=0)
  const excludeCurrentWeek = !includeCurrentWeek && (weekday >= 1 && weekday <= 5);
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

/**
 * Calculates Average True Range (ATR) across daily price candles
 */
export function calculateDailyATR(dailySeries = [], period = 14) {
  if (!Array.isArray(dailySeries) || dailySeries.length < 2) return null;
  const trueRanges = [];
  for (let i = 1; i < dailySeries.length; i++) {
    const cur = dailySeries[i];
    const prev = dailySeries[i - 1];
    let tr;
    if (cur.high !== undefined && cur.low !== undefined && cur.high !== null && cur.low !== null) {
      tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
    } else {
      tr = Math.abs(cur.close - prev.close);
    }
    trueRanges.push(tr);
  }
  const effPeriod = Math.min(period, trueRanges.length);
  if (effPeriod <= 0) return null;
  const recent = trueRanges.slice(-effPeriod);
  return recent.reduce((sum, v) => sum + v, 0) / effPeriod;
}

function parseListingDays(listingDate, today) {
  if (!listingDate) return null;
  let parsed = null;
  const dmyMatch = String(listingDate).match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dmyMatch) {
    const months = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
    const m = months[dmyMatch[2].toUpperCase()];
    if (m !== undefined) {
      parsed = new Date(Date.UTC(Number(dmyMatch[3]), m, Number(dmyMatch[1])));
    }
  } else {
    const t = Date.parse(listingDate);
    if (!isNaN(t)) parsed = new Date(t);
  }
  if (!parsed || isNaN(parsed.getTime())) return null;
  const todayMs = Date.parse(today || new Date().toISOString().slice(0, 10));
  return Math.floor((todayMs - parsed.getTime()) / 86400000);
}

export function analyzeTechnicalTrend(rawPrices, {
  today = new Date().toISOString().slice(0, 10),
  candleMapList = null,
  includeCurrentWeek = false,
  entryDate = null,
  entryPrice = null,
  listingDate = null,
  isExplicitIpo = null
} = {}) {
  const daily = normalizePriceSeries(rawPrices);
  const weekly = aggregateWeeklyCloses(daily, { today, includeCurrentWeek });
  const latest = weekly.at(-1);
  const latestSma = simpleMovingAverage(weekly.map(row => row.close), 30);
  const isUsable = weekly.length >= 40 && latestSma !== null;

  if (!isUsable) {
    const latestDaily = daily.at(-1);
    const latestDailyClose = latestDaily?.close ?? latest?.close ?? null;
    const numEntryPrice = Number(entryPrice) || 0;

    // Determine whether this stock is genuinely an IPO / new listing (< 40 weeks / < 280 calendar days since listing/inception)
    let isIpo = false;
    if (isExplicitIpo !== null && isExplicitIpo !== undefined) {
      isIpo = Boolean(isExplicitIpo);
    } else if (listingDate) {
      const daysSinceListing = parseListingDays(listingDate, today);
      if (daysSinceListing !== null) {
        isIpo = daysSinceListing <= 280;
      }
    } else if (daily.length > 0) {
      const firstDate = daily[0]?.date;
      const daysSinceFirstDate = firstDate ? Math.floor((Date.parse(today) - Date.parse(firstDate)) / 86400000) : null;
      if (daysSinceFirstDate !== null && daysSinceFirstDate > 280) {
        // Earliest price bar is older than 40 weeks: veteran stock with data gaps, strictly NOT an IPO
        isIpo = false;
      } else if (daily.length >= 10 && daysSinceFirstDate !== null && daysSinceFirstDate <= 280) {
        // Daily price history strictly bounded within 40 weeks: genuine IPO candidate
        isIpo = true;
      }
    }

    // Adaptive IPO Crash & Risk Protection Engine (strictly for genuine IPOs with >= 10 daily observations)
    if (isIpo && daily.length >= 10 && latestDailyClose !== null) {
      const dailyCloses = daily.map(row => row.close);
      const ipoHigh = Math.max(...dailyCloses);
      const ipoLow = Math.min(...dailyCloses);
      const drawdownFromIpoHigh = ipoHigh > 0 ? ((latestDailyClose / ipoHigh) - 1) * 100 : 0;
      const dailyAtr = calculateDailyATR(daily, Math.min(14, daily.length - 1)) || (latestDailyClose * 0.035);

      let trailingPeak = ipoHigh;
      if (entryDate) {
        const pricesSinceEntry = daily
          .slice(-100)
          .filter(row => row.date >= entryDate)
          .map(row => row.close);
        if (numEntryPrice > 0) {
          pricesSinceEntry.push(numEntryPrice);
        }
        if (pricesSinceEntry.length > 0) {
          trailingPeak = Math.max(...pricesSinceEntry);
        }
      }

      const peakGainPct = (numEntryPrice > 0 && trailingPeak > 0)
        ? (trailingPeak - numEntryPrice) / numEntryPrice
        : 0;

      let chandelierStopPrice;
      if (peakGainPct >= 0.25) {
        const widePctFloor = trailingPeak * 0.80; // 20% pullback allowance
        const wideAtrFloor = trailingPeak - 3.5 * dailyAtr;
        chandelierStopPrice = Number(Math.max(0, Math.max(widePctFloor, wideAtrFloor)).toFixed(2));
      } else {
        const baseAtrFloor = trailingPeak - 3.0 * dailyAtr;
        const hardEntryFloor = numEntryPrice > 0 ? numEntryPrice * 0.92 : 0;
        chandelierStopPrice = Number(Math.max(0, baseAtrFloor, hardEntryFloor, ipoLow * 0.95).toFixed(2));
      }

      const trailingFloorPrice = chandelierStopPrice;
      const bufferToTrailingFloorPct = latestDailyClose > 0 && trailingFloorPrice > 0
        ? Number(((latestDailyClose / trailingFloorPrice - 1) * 100).toFixed(2))
        : 0;

      const isNearHighs = drawdownFromIpoHigh >= -12;
      const isConsolidating = latestDailyClose >= ipoLow * 1.02;
      const weinsteinStage = isNearHighs ? 2 : isConsolidating ? 1 : 4;
      const weinsteinStageLabel = isNearHighs
        ? 'Stage 2 (Base Breakout · New Listing)'
        : isConsolidating
          ? 'Stage 1 (Base Consolidation · New Listing)'
          : 'Stage 4 (Base Breakdown · New Listing)';

      const daily21 = analyzeDaily21EmaPattern(daily, candleMapList);
      const isStopBreached = trailingFloorPrice > 0 && latestDailyClose <= trailingFloorPrice;
      const isHardRiskCut = numEntryPrice > 0 && (latestDailyClose / numEntryPrice - 1) <= -0.08;
      const isBaseBreakdown = ipoLow > 0 && latestDailyClose < ipoLow * 0.98;
      const isCrash = isStopBreached || isHardRiskCut || daily21.has4RedCandlesBelow21Ema || isBaseBreakdown;

      // When a crash or stop breach occurs, immediately alert via TECHNICAL_TRIM_CANDIDATE
      // When healthy, retain DATA_UNAVAILABLE for Stage 2 baseline establishing while providing full protection parameters
      const state = isCrash ? 'TECHNICAL_TRIM_CANDIDATE' : 'DATA_UNAVAILABLE';
      const isCompoundingProtected = weinsteinStage === 2 && !isCrash;

      return {
        state,
        dataQuality: 'PRICE_HISTORY_ONLY',
        isIpo: true,
        dailyObservations: daily.length,
        weeklyObservations: weekly.length,
        latestPriceDate: daily.at(-1)?.date || null,
        weeklyClose: latest?.close ?? latestDailyClose,
        sma30Week: null,
        sma30WeekFourWeekSlopePct: null,
        weeksBelowAverage: 0,
        slopeDown: null,
        drawdownFrom20WeekHighPct: drawdownFromIpoHigh,
        annualizedVolatility20DayPct: null,
        weinsteinStage,
        weinsteinStageLabel,
        peak20WeekPrice: ipoHigh,
        trailingPeakPrice: trailingPeak,
        ipoHigh,
        ipoLow,
        chandelierStopPrice,
        isCompoundingProtected,
        trailingFloorPrice,
        bufferToTrailingFloorPct,
        stopFloorBreached: isStopBreached || isHardRiskCut,
        peakGainPct: Number((peakGainPct * 100).toFixed(1)),
        ...daily21,
        evidence: [
          { key: 'ipo_high', value: ipoHigh, observedAt: daily.at(-1)?.date },
          { key: 'ipo_low', value: ipoLow, observedAt: daily.at(-1)?.date },
          { key: 'chandelier_stop_price', value: chandelierStopPrice, observedAt: daily.at(-1)?.date },
          { key: 'drawdown_from_high', value: drawdownFromIpoHigh, observedAt: daily.at(-1)?.date }
        ],
        invalidation: isCrash
          ? 'Adaptive IPO risk trigger breached. Review trim/exit to preserve capital.'
          : `Adaptive IPO protection active. Trailing stop floor anchored at ₹${trailingFloorPrice} until 40-week 30w-SMA baseline matures.`
      };
    }

    const fallbackFloor = numEntryPrice > 0 ? Number((numEntryPrice * 0.92).toFixed(2)) : null;
    const fallbackBreached = fallbackFloor !== null && latestDailyClose !== null && latestDailyClose <= fallbackFloor;

    return {
      state: fallbackBreached ? 'TECHNICAL_TRIM_CANDIDATE' : 'DATA_UNAVAILABLE',
      dataQuality: 'INSUFFICIENT_HISTORY',
      isIpo: false,
      dailyObservations: daily.length,
      weeklyObservations: weekly.length,
      latestPriceDate: daily.at(-1)?.date || null,
      weeklyClose: latest?.close ?? null,
      sma30Week: latestSma,
      sma30WeekFourWeekSlopePct: null,
      weeksBelowAverage: 0,
      slopeDown: null,
      drawdownFrom20WeekHighPct: null,
      annualizedVolatility20DayPct: null,
      weinsteinStage: null,
      weinsteinStageLabel: 'Insufficient History',
      peak20WeekPrice: null,
      trailingPeakPrice: null,
      ipoHigh: null,
      ipoLow: null,
      chandelierStopPrice: fallbackFloor,
      isCompoundingProtected: false,
      trailingFloorPrice: fallbackFloor,
      bufferToTrailingFloorPct: fallbackFloor && latestDailyClose ? Number(((latestDailyClose / fallbackFloor - 1) * 100).toFixed(2)) : null,
      stopFloorBreached: fallbackBreached,
      ...analyzeDaily21EmaPattern(daily, candleMapList),
      evidence: [],
      invalidation: fallbackBreached
        ? 'Hard entry -8% circuit breaker breached. Review trim to preserve capital.'
        : 'Build at least 40 completed weekly observations before evaluating a trend.'
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

  // 2. Chandelier Trailing Exit: TrailingPeak - 3.0 * ATR(14w)
  // For held positions, anchor trailing peak strictly to the maximum price achieved since entry
  // (or entry purchase price), preventing pre-entry historical peaks from triggering premature stops.
  let trailingPeak = peak20;
  if (entryDate) {
    const pricesSinceEntry = daily
      .slice(-100)
      .filter(row => row.date >= entryDate)
      .map(row => row.close);
    if (entryPrice && Number(entryPrice) > 0) {
      pricesSinceEntry.push(Number(entryPrice));
    }
    if (pricesSinceEntry.length > 0) {
      trailingPeak = Math.max(...pricesSinceEntry);
    }
  }

  // 2. Tiered Trailing Stop Corridor & Chandelier Exit:
  // Before +25% profit cushion: standard 3.0 * ATR(14w) trailing stop.
  // After +25% profit cushion established: widen trailing stop corridor to max(20%, 3.5x ATR)
  // from peak to prevent premature shakeouts of high-beta compounder runners during normal pullbacks.
  const numEntryPrice = Number(entryPrice) || 0;
  const peakGainPct = (numEntryPrice > 0 && trailingPeak > 0)
    ? (trailingPeak - numEntryPrice) / numEntryPrice
    : 0;

  const atr14 = calculateWeeklyATR(closes, 14) || (latest.close * 0.04);
  let chandelierStopPrice;
  if (peakGainPct >= 0.25) {
    const widePctFloor = trailingPeak * 0.80; // 20% pullback allowance
    const wideAtrFloor = trailingPeak - 3.5 * atr14;
    chandelierStopPrice = Number(Math.max(0, Math.max(widePctFloor, wideAtrFloor)).toFixed(2));
  } else {
    chandelierStopPrice = Number(Math.max(0, trailingPeak - 3.0 * atr14).toFixed(2));
  }

  // 3. Compounding Protection Engine
  // A stock in Stage 2 Bull that trades above its trailing stop has active compounding protection.
  // Standard 15% to 25% pullbacks in Indian growth stocks are recognized as normal volatility.
  const isCompoundingProtected = weinsteinStage === 2 && latest.close >= chandelierStopPrice;
  let calculatedFloor = chandelierStopPrice;
  if (peakGainPct < 0.25) {
    // Only apply 30w-SMA floor if it sits safely below trailing peak (guards against inverted phantom floors on turnaround entries)
    if (latestSma * 0.95 < trailingPeak) {
      calculatedFloor = Math.max(latestSma * 0.95, chandelierStopPrice);
    }
  }
  const trailingFloorPrice = Number(calculatedFloor.toFixed(2));
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
    isIpo: false,
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
    trailingPeakPrice: trailingPeak,
    chandelierStopPrice,
    isCompoundingProtected,
    trailingFloorPrice,
    bufferToTrailingFloorPct,
    peakGainPct: Number((peakGainPct * 100).toFixed(1)),
    ...analyzeDaily21EmaPattern(daily, candleMapList),
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

/**
 * Calculates Exponential Moving Average (EMA) across a daily price series
 */
export function calculateDailyEMA(series = [], period = 21) {
  if (!Array.isArray(series) || series.length < period) return [];
  const k = 2 / (period + 1);
  const emas = new Array(series.length).fill(null);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += series[i].close;
  let prev = sum / period;
  emas[period - 1] = prev;
  for (let i = period; i < series.length; i++) {
    prev = series[i].close * k + prev * (1 - k);
    emas[i] = prev;
  }
  return emas;
}

/**
 * Analyzes the daily chart pattern requested by user:
 * 1. Last 4 candles continuously closed as Red on Daily chart
 * 2. All 4 red candles closed below the 21-day EMA
 * 3. Last red candle is 5% or more below the 21-day EMA
 */
export function analyzeDaily21EmaPattern(dailySeries = [], candleMapList = null) {
  // If candleMapList has at least 21 valid candles with open & close, use it directly as authoritative
  let mergedSeries = dailySeries;
  if (Array.isArray(candleMapList) && candleMapList.length >= 21) {
    mergedSeries = candleMapList.map(c => ({
      date: c.date,
      close: Number(c.close),
      open: c.open !== null && c.open !== undefined ? Number(c.open) : null,
      high: c.high !== null && c.high !== undefined ? Number(c.high) : null,
      low: c.low !== null && c.low !== undefined ? Number(c.low) : null
    })).filter(c => /^\d{4}-\d{2}-\d{2}$/.test(c.date) && Number.isFinite(c.close) && c.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  } else if (Array.isArray(candleMapList) && candleMapList.length > 0) {
    const ohlcByDate = new Map(candleMapList.map(c => [c.date, c]));
    mergedSeries = dailySeries.map(row => {
      const ohlc = ohlcByDate.get(row.date);
      return {
        date: row.date,
        close: ohlc?.close ? Number(ohlc.close) : row.close,
        open: ohlc?.open ?? null,
        high: ohlc?.high ?? null,
        low: ohlc?.low ?? null
      };
    });
  }

  const n = mergedSeries.length;
  if (n < 21) {
    return {
      has4RedCandlesBelow21Ema: false,
      dailyEma21: null,
      distanceToDailyEma21Pct: null,
      consecutiveDailyRedCandles: 0,
      consecutiveDailyBelowEma: 0,
      dailyCandlePatternDetails: null
    };
  }

  const emas = calculateDailyEMA(mergedSeries, 21);
  const latestEma = emas.at(-1);
  const latestClose = mergedSeries.at(-1)?.close;
  const distanceToDailyEma21Pct = (latestEma && latestClose)
    ? Number((((latestClose / latestEma) - 1) * 100).toFixed(2))
    : null;

  // Determine if a candle at index i is "Red"
  // On a Daily candlestick chart:
  // If open price is available and > 0, close < open defines a Red candlestick body.
  // If open is missing or equal to close, fallback to close < prev close.
  const isRed = (idx) => {
    if (idx < 0 || idx >= n) return false;
    const c = mergedSeries[idx];
    if (c.open !== null && c.open !== undefined && Number.isFinite(c.open) && c.open > 0) {
      return c.close < c.open;
    }
    if (idx > 0) {
      return c.close < mergedSeries[idx - 1].close;
    }
    return false;
  };

  // Count consecutive red candles from the end
  let consecutiveDailyRedCandles = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (isRed(i)) consecutiveDailyRedCandles++;
    else break;
  }

  // Count consecutive closes below 21-EMA from the end
  let consecutiveDailyBelowEma = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (emas[i] !== null && mergedSeries[i].close < emas[i]) consecutiveDailyBelowEma++;
    else break;
  }

  // Check the last 4 candles
  const last4Indices = [n - 4, n - 3, n - 2, n - 1];
  const all4Red = last4Indices.every(idx => isRed(idx));
  const all4BelowEma = last4Indices.every(idx => emas[idx] !== null && mergedSeries[idx].close < emas[idx]);
  const isLast5PctBelow = distanceToDailyEma21Pct !== null && distanceToDailyEma21Pct <= -5.0;

  const has4RedCandlesBelow21Ema = all4Red && all4BelowEma && isLast5PctBelow;

  const last4Candles = last4Indices.map(idx => {
    const c = mergedSeries[idx];
    const ema = emas[idx];
    const diff = (ema && c.close) ? Number((((c.close / ema) - 1) * 100).toFixed(2)) : null;
    return {
      date: c.date,
      open: c.open,
      close: c.close,
      ema21: ema ? Number(ema.toFixed(2)) : null,
      diffPct: diff,
      isRed: isRed(idx),
      isBelowEma: ema !== null && c.close < ema
    };
  });

  return {
    has4RedCandlesBelow21Ema,
    dailyEma21: latestEma ? Number(latestEma.toFixed(2)) : null,
    distanceToDailyEma21Pct,
    consecutiveDailyRedCandles,
    consecutiveDailyBelowEma,
    dailyCandlePatternDetails: {
      matched: has4RedCandlesBelow21Ema,
      all4Red,
      all4BelowEma,
      isLast5PctBelow,
      latestClose,
      latestEma: latestEma ? Number(latestEma.toFixed(2)) : null,
      distanceToEmaPct: distanceToDailyEma21Pct,
      candles: last4Candles
    }
  };
}
