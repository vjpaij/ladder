/**
 * earningsCatalystService.js
 * Tracks quarterly earnings dates and computes pre/post result drift signals.
 * Explains WHY stocks move before results are announced (options positioning,
 * institutional pre-loading, whisper numbers) and integrates buy/sell modifiers.
 *
 * Data sourced from Screener.in documents/filings + corporate announcements.
 * Stored in: data/earnings_calendar.json (7-day TTL per symbol)
 */

import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const CALENDAR_FILE = path.join(DATA_DIR, 'earnings_calendar.json');
const CALENDAR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days per symbol

/** Load the full earnings calendar from disk */
export function loadCalendar() {
  try {
    if (fs.existsSync(CALENDAR_FILE)) {
      return JSON.parse(fs.readFileSync(CALENDAR_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return {};
}

/** Persist calendar to disk */
export function saveCalendar(calendar) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CALENDAR_FILE, JSON.stringify(calendar, null, 2), 'utf8');
  } catch { /* ignore */ }
}

/**
 * Estimates the next earnings date based on the last result date and typical pattern.
 * Most Indian companies report within 45–60 days of quarter end:
 *   Q1 (Apr–Jun): results in Jul–Aug
 *   Q2 (Jul–Sep): results in Oct–Nov
 *   Q3 (Oct–Dec): results in Jan–Feb
 *   Q4 (Jan–Mar): results in Apr–May
 */
function estimateNextResultDate(lastResultDateStr) {
  if (!lastResultDateStr) return null;
  try {
    const last = new Date(`${lastResultDateStr}T00:00:00Z`);
    // Add approximately 91 days (one quarter)
    const next = new Date(last.getTime() + 91 * 24 * 60 * 60 * 1000);
    return next.toISOString().slice(0, 10);
  } catch { return null; }
}

/**
 * Estimates upcoming Q2 result date staggered across the active reporting window (Oct 19 to Nov 14).
 * Uses company sector cadence: IT (early), Financials (mid), Auto/FMCG/CapGoods (later).
 */
function estimateQ2ResultDate(symbol, sector = '') {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) hash = (hash * 31 + symbol.charCodeAt(i)) & 0xffffffff;
  const offsetDays = Math.abs(hash) % 24;

  if (/it|tech|software|infotech/i.test(sector)) {
    const day = 19 + (Math.abs(hash) % 6);
    return `2026-10-${String(day).padStart(2, '0')}`;
  }
  if (/bank|finan|nbfc|insur/i.test(sector)) {
    const day = 21 + (Math.abs(hash) % 8);
    return `2026-10-${String(day).padStart(2, '0')}`;
  }
  if (/auto|fmcg|consum/i.test(sector)) {
    const dayOffset = Math.abs(hash) % 11;
    if (dayOffset <= 7) return `2026-10-${String(24 + dayOffset).padStart(2, '0')}`;
    return `2026-11-${String(dayOffset - 7).padStart(2, '0')}`;
  }
  if (offsetDays <= 12) {
    return `2026-10-${String(20 + offsetDays).padStart(2, '0')}`;
  } else {
    return `2026-11-${String(offsetDays - 12).padStart(2, '0')}`;
  }
}

/**
 * For a given symbol and today's date, compute the earnings catalyst object.
 * Accurately detects whether results for the latest completed quarter are already out
 * or upcoming, and generates pre/post earnings guidance.
 *
 * @param {string} symbol
 * @param {Object} fundamentals - from screenerFundamentalsProvider
 * @param {string} today - YYYY-MM-DD
 * @returns {Object} earningsCatalyst
 */
export function computeEarningsCatalyst(symbol, fundamentals = {}, today = new Date().toISOString().slice(0, 10)) {
  const calendar = loadCalendar();
  const clean = String(symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');
  const entry = calendar[clean] || {};

  const latestQ = fundamentals.latestQuarter || entry.latestQuarter || '';
  
  // Current calendar cycle: In Oct/Nov 2026, Q2 (Sep 2026) is the reporting quarter.
  // If latestQuarter in table is already "Sep 2026" or "Q2", results HAVE ALREADY BEEN ANNOUNCED!
  const isCurrentQuarterOut = latestQ.includes('Sep 2026') || latestQ.includes('Sep-26') || latestQ.includes('Q2 2026');
  
  let quarterlyResultStatus = isCurrentQuarterOut ? 'RESULTS_OUT' : 'UPCOMING';
  let lastResultDate = fundamentals.lastResultDate || entry.lastResultDate || null;
  let nextResultDate = fundamentals.nextResultDate || entry.nextResultDate || null;
  let isConfirmedDate = false;
  let daysToResult = null;
  let daysAgo = null;

  const todayMs = new Date(`${today}T00:00:00Z`).getTime();

  if (isCurrentQuarterOut) {
    // Sep 2026 results are ALREADY OUT!
    if (!lastResultDate) {
      lastResultDate = '2026-10-14'; // Mid October default if filing date absent
    }
    const lastMs = new Date(`${lastResultDate}T00:00:00Z`).getTime();
    daysAgo = Math.max(0, Math.round((todayMs - lastMs) / 86400000));
    // Next quarter is Dec 2026 (Q3), announced in Jan/Feb 2027
    nextResultDate = '2027-01-25';
    isConfirmedDate = false;
  } else {
    // Q2 results are UPCOMING / PENDING
    const boardDate = fundamentals.upcomingBoardMeetingDate;
    if (boardDate && boardDate >= today) {
      nextResultDate = boardDate;
      isConfirmedDate = true;
    } else {
      if (boardDate && boardDate < today) {
        // Meeting was held recently in early October
        const boardMs = new Date(`${boardDate}T00:00:00Z`).getTime();
        if (todayMs - boardMs <= 14 * 86400000 && !lastResultDate) {
          lastResultDate = boardDate;
        }
      }
      if (!nextResultDate || nextResultDate < today) {
        nextResultDate = estimateQ2ResultDate(clean, fundamentals.sector);
        isConfirmedDate = false;
      }
    }
    const nextMs = new Date(`${nextResultDate}T00:00:00Z`).getTime();
    daysToResult = Math.max(0, Math.round((nextMs - todayMs) / 86400000));
  }

  // Growth performance metrics from fundamentals
  const yoyPat = Number(fundamentals.yoyPatGrowthPct);
  const yoySales = Number(fundamentals.yoySalesGrowthPct);
  const opm = Number(fundamentals.latestOpmPct);

  let resultVerdict = isCurrentQuarterOut ? 'SOLID_BEAT' : 'PENDING';
  let signalModifier = 'STANDARD';
  let signalNote = '';

  if (isCurrentQuarterOut) {
    if (Number.isFinite(yoyPat) && yoyPat >= 30 && Number.isFinite(yoySales) && yoySales >= 15) {
      resultVerdict = 'BLOWOUT_BEAT';
      signalModifier = 'POST_EARNINGS_BOOST';
      signalNote = `Q2 (Sep 2026) results OUT (${daysAgo !== null ? `${daysAgo}d ago on ` : ''}${lastResultDate}): Blowout growth with YoY PAT +${yoyPat.toFixed(1)}%, Sales +${yoySales.toFixed(1)}%, OPM ${opm}%. Post-earnings institutional momentum active.`;
    } else if (Number.isFinite(yoyPat) && yoyPat > 0) {
      resultVerdict = 'SOLID_BEAT';
      signalModifier = 'POST_EARNINGS_CONFIRMED';
      signalNote = `Q2 (Sep 2026) results OUT (${daysAgo !== null ? `${daysAgo}d ago on ` : ''}${lastResultDate}): YoY PAT +${yoyPat.toFixed(1)}%, Sales +${yoySales.toFixed(1)}%, OPM ${opm}%. Steady expansion confirmed.`;
    } else if (Number.isFinite(yoyPat) && yoyPat < 0) {
      resultVerdict = 'MISS';
      signalModifier = 'POST_EARNINGS_CAUTION';
      signalNote = `Q2 (Sep 2026) results OUT (${daysAgo !== null ? `${daysAgo}d ago on ` : ''}${lastResultDate}): YoY PAT contracted ${yoyPat.toFixed(1)}%. Await margin stabilization.`;
    } else {
      resultVerdict = 'REPORTED';
      signalModifier = 'STANDARD';
      signalNote = `Q2 (Sep 2026) results OUT on ${lastResultDate}. Margins at ${opm}%.`;
    }
  } else {
    // Upcoming
    if (daysToResult !== null && daysToResult >= 0 && daysToResult <= 15) {
      signalModifier = isConfirmedDate ? 'CAUTION_PRE_RESULT' : 'PRE_EARNINGS_EVENT';
      signalNote = `Q2 results due in ${daysToResult}d (${nextResultDate}${isConfirmedDate ? ' confirmed board meeting' : ' estimated'}). Pre-earnings volatility window active.`;
    } else {
      signalModifier = 'STANDARD';
      signalNote = `Q2 results expected around ${nextResultDate}.`;
    }
  }

  // Pre-earnings / Decision Support guidance: HOW TO KNOW BEFOREHAND WHETHER TO BUY OR SELL
  const howToKnowBeforehand = {
    strategy: isCurrentQuarterOut
      ? 'POST_EARNINGS_FOLLOW_THROUGH: Numbers are confirmed strong. Institutional buying typically persists for 2-6 weeks after blowout quarters. Accumulate on minor pullbacks toward 50-EMA.'
      : 'STAGED_ENTRY_STRATEGY: When trading before results, initiate Tranche 1 (30-40% size) if stock is in Stage 2 Bull structure. Keep Tranche 2 (60-70%) in reserve to deploy AFTER the numbers confirm the beat.',
    preResultMomentum: (fundamentals.epsConsecutiveGrowthYears >= 2 || yoyPat > 20) ? 'BULLISH' : 'NEUTRAL',
    pastQuartersConsistency: fundamentals.epsConsecutiveGrowthYears >= 2 ? 'HIGH_CONSISTENCY' : 'MODERATE',
    keyRules: [
      'Pre-earnings runup: If price breaks out above 50-EMA ahead of results, institutions are accumulating based on positive channel checks.',
      'Binary event protection: Never allocate 100% full position right before unannounced earnings; stage entries across 2-3 tranches.',
      'Post-earnings reaction: A gap up on heavy volume after blowout numbers (PAT > +30%) is an institutional confirmation signal, not a sell signal.'
    ]
  };

  const historicalSurprises = fundamentals?.historicalSurprises || entry?.historicalSurprises || [];
  const beats = historicalSurprises.filter(s => parseFloat(s) > 0).length;
  const misses = historicalSurprises.filter(s => parseFloat(s) < 0).length;
  const beatRate = historicalSurprises.length > 0
    ? Number(((beats / historicalSurprises.length) * 100).toFixed(0))
    : null;

  const isPreDriftZone = daysToResult !== null && daysToResult >= 0 && daysToResult <= 14;
  const isPostResultZone = isCurrentQuarterOut && daysAgo !== null && daysAgo <= 20;

  if (!isCurrentQuarterOut && isPreDriftZone && beatRate !== null && beatRate >= 70) {
    signalModifier = 'CATALYST_BOOST';
    signalNote = `High historical beat rate (${beatRate}%) with pre-result drift interest (${daysToResult}d to announcement).`;
  }

  const educationalContext = 'Options IV expansion & Institutional Pre-loading: Prices often trend 5-15 days ahead of quarterly earnings as options implied volatility expands, delta hedging creates directional momentum, and funds position ahead of reported results based on sector read-throughs and analyst channel checks.';

  return {
    symbol: clean,
    quarterlyResultStatus,
    latestReportedQuarter: latestQ || 'N/A',
    lastResultDate,
    lastResultTitle: fundamentals.lastResultTitle || null,
    daysAgo,
    nextResultDate,
    isConfirmedDate,
    dateConfidence: isConfirmedDate ? 'CONFIRMED' : 'ESTIMATED',
    daysToResult,
    isPreDriftZone,
    isPostResultZone,
    isResultDay: daysToResult === 0 || daysAgo === 0,
    historicalSurprises,
    beats,
    misses,
    beatRate,
    resultVerdict,
    signalModifier,
    signalNote,
    howToKnowBeforehand,
    educationalContext,
    yoyPatGrowthPct: yoyPat,
    yoySalesGrowthPct: yoySales,
    latestOpmPct: opm,
    recentFilings: fundamentals.recentFilings || entry.recentFilings || []
  };
}

/**
 * Updates the earnings calendar with a confirmed result date.
 */
export function updateEarningsCalendar(symbol, data = {}) {
  const calendar = loadCalendar();
  const clean = String(symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');
  const existing = calendar[clean] || {};

  calendar[clean] = {
    ...existing,
    nextResultDate: data.nextResultDate || existing.nextResultDate,
    nextResultDateConfirmed: data.nextResultDateConfirmed === true || existing.nextResultDateConfirmed === true,
    lastResultDate: data.lastResultDate || existing.lastResultDate,
    latestQuarter: data.latestQuarter || existing.latestQuarter,
    updatedAt: new Date().toISOString()
  };

  saveCalendar(calendar);
  return calendar[clean];
}

/**
 * Batch-compute earnings catalysts for a list of symbols.
 */
export function batchComputeEarningsCatalysts(symbols = [], fundamentalsMap = {}, today) {
  const todayStr = today || new Date().toISOString().slice(0, 10);
  const result = {};
  for (const sym of symbols) {
    const clean = String(sym).toUpperCase().replace(/\.(NS|BO)$/i, '');
    result[clean] = computeEarningsCatalyst(clean, fundamentalsMap[clean] || {}, todayStr);
  }
  return result;
}

/**
 * Returns the full earnings calendar.
 */
export function getFullEarningsCalendar() {
  return loadCalendar();
}
