/**
 * earningsCatalystService.js
 * Tracks quarterly earnings dates and computes pre/post result drift signals.
 * Explains WHY stocks move before results are announced (options positioning,
 * institutional pre-loading, whisper numbers) and integrates buy/sell modifiers.
 *
 * Data sourced from BSE corporate announcements + Screener.in page + historical patterns.
 * Stored in: data/earnings_calendar.json (7-day TTL per symbol)
 */

import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const CALENDAR_FILE = path.join(DATA_DIR, 'earnings_calendar.json');
const CALENDAR_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days per symbol

/** Load the full earnings calendar from disk */
function loadCalendar() {
  try {
    if (fs.existsSync(CALENDAR_FILE)) {
      return JSON.parse(fs.readFileSync(CALENDAR_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return {};
}

/** Persist calendar to disk */
function saveCalendar(calendar) {
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
 * Fetches earnings date from BSE corporate announcements API.
 * Looks for board meeting announcements (which confirm result dates).
 */
async function fetchEarningsFromBSE(symbol) {
  try {
    // BSE uses ISIN or company search — we use the search endpoint
    const url = `https://www.bseindia.com/corporates/ann.html`;
    // BSE has an API for board meeting announcements
    const apiUrl = `https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w?strCat=Board Meeting&strPrevDate=&strScrip=&strSearch=P&strToDate=&strFromDate=&myClient=`;
    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://www.bseindia.com/'
      },
      signal: AbortSignal.timeout(6000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Look for symbol match in announcements
    const cleanSym = String(symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');
    const matches = (data?.Table || []).filter(ann =>
      String(ann.SCRIP_CD || '').includes(cleanSym) ||
      String(ann.SLONGNAME || '').toUpperCase().includes(cleanSym.slice(0, 6))
    );
    if (matches.length > 0) {
      // Extract date from the most recent board meeting announcement
      const latest = matches[0];
      const dateStr = latest.NEWS_DT || latest.DT_TM || null;
      if (dateStr) {
        // Parse BSE date format (DD/MM/YYYY or ISO)
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
        return dateStr.slice(0, 10);
      }
    }
    return null;
  } catch { return null; }
}

/**
 * Extracts result date from a Screener.in company page's quarterly table headers.
 * Uses the most recent quarter label (e.g. "Sep 2026") to estimate next result.
 */
function parseResultDateFromScreener(fundamentals) {
  if (!fundamentals?.latestQuarter) return null;
  // latestQuarter format: "Sep 2026", "Jun 2026", etc.
  const qMap = { 'Mar': '05', 'Jun': '08', 'Sep': '11', 'Dec': '02' };
  const parts = fundamentals.latestQuarter.split(' ');
  if (parts.length !== 2) return null;
  const [month, yearStr] = parts;
  const monthCode = qMap[month];
  if (!monthCode) return null;
  // Results typically announced 45-60 days after quarter end
  const year = month === 'Dec' ? String(Number(yearStr) + 1) : yearStr;
  const resultDate = `${year}-${monthCode}-15`; // Approximate
  return resultDate;
}

/**
 * For a given symbol and today's date, compute the earnings catalyst object.
 * Uses cached data if available, otherwise estimates from Screener fundamentals.
 *
 * @param {string} symbol
 * @param {Object} fundamentals - from screenerFundamentalsProvider
 * @param {string} today - YYYY-MM-DD
 * @returns {Object} earningsCatalyst
 */
export function computeEarningsCatalyst(symbol, fundamentals = {}, today = new Date().toISOString().slice(0, 10)) {
  const calendar = loadCalendar();
  const clean = String(symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');
  const entry = calendar[clean];

  let nextResultDate = fundamentals?.nextResultDate || entry?.nextResultDate || null;
  let lastResultDate = fundamentals?.lastResultDate || entry?.lastResultDate || null;
  let dateSource = fundamentals?.nextResultDate ? 'fundamentals_calendar'
    : entry?.nextResultDate ? 'calendar_cache' : null;
  let isConfirmedDate = Boolean(fundamentals?.nextResultDateConfirmed || entry?.nextResultDateConfirmed);

  // If no calendar entry, try to derive from Screener data
  if (!nextResultDate && fundamentals?.latestQuarter) {
    const estimatedFromScreener = parseResultDateFromScreener(fundamentals);
    if (estimatedFromScreener) {
      nextResultDate = estimatedFromScreener;
      dateSource = 'quarter_estimate';
    }
  }

  // If still no date, estimate based on standard quarterly pattern
  if (!nextResultDate && lastResultDate) {
    nextResultDate = estimateNextResultDate(lastResultDate);
    dateSource = 'historical_pattern_estimate';
  }

  // Compute days to result
  let daysToResult = null;
  if (nextResultDate) {
    const todayMs = new Date(`${today}T00:00:00Z`).getTime();
    const resultMs = new Date(`${nextResultDate}T00:00:00Z`).getTime();
    daysToResult = Math.round((resultMs - todayMs) / (24 * 60 * 60 * 1000));
  }

  // Historical beat rate (from calendar cache or parameter)
  const historicalSurprises = fundamentals?.historicalSurprises || entry?.historicalSurprises || [];
  const beats = historicalSurprises.filter(s => parseFloat(s) > 0).length;
  const misses = historicalSurprises.filter(s => parseFloat(s) < 0).length;
  const beatRate = historicalSurprises.length > 0
    ? Number(((beats / historicalSurprises.length) * 100).toFixed(0))
    : null;

  // Drift zone classification
  const isPreDriftZone = daysToResult !== null && daysToResult >= 0 && daysToResult <= 10;
  const isPostResultZone = daysToResult !== null && daysToResult >= -3 && daysToResult < 0;
  const isResultDay = daysToResult === 0;

  // Drift direction based on historical beats
  const driftDirection = 'NEUTRAL';
  const riskLevel = isConfirmedDate && daysToResult !== null && daysToResult >= 0 && daysToResult <= 15
    ? 'EARNINGS_EVENT' : isPreDriftZone ? 'DATE_ESTIMATE' : 'LOW';

  // Signal modifier for buy analysis
  let signalModifier = 'STANDARD';
  let signalNote = null;

  if (isConfirmedDate && daysToResult !== null && daysToResult >= 0 && daysToResult <= 15) {
    signalModifier = 'CAUTION_PRE_RESULT';
    signalNote = `Confirmed result date is ${daysToResult} days away. High event risk: consider awaiting official filing or staging entry with risk caps.`;
  } else if (isPreDriftZone && beatRate !== null && beatRate >= 70) {
    signalModifier = 'CATALYST_BOOST';
    signalNote = `High historical beat rate (${beatRate}%) with pre-result drift interest (${daysToResult}d to announcement).`;
  } else if (isPreDriftZone) {
    signalModifier = 'STANDARD';
    signalNote = `Estimated result date is ${daysToResult} days away. Verify officially confirmed date.`;
  }

  /**
   * WHY STOCKS MOVE BEFORE RESULTS — Educational context shown in UI:
   * 1. Options IV expansion: option sellers demand higher premium as uncertainty grows
   *    → Delta hedging by option market makers creates directional price pressure
   * 2. Institutional pre-positioning: fund managers who know sector trends accumulate before results
   * 3. Analyst estimate revisions: upgrades/downgrades published 7–14 days before results
   * 4. Whisper numbers: informal estimates circulate among traders
   * 5. Supply chain signals: companies in the same supply chain announce first (e.g., TSMC → IT)
   */
  const educationalContext = isPreDriftZone || (daysToResult !== null && daysToResult >= 0 && daysToResult <= 20)
    ? 'Options IV expansion and institutional pre-positioning: Prices often trend 5-15 days ahead of quarterly earnings as options implied volatility expands, delta hedging creates directional momentum, and funds position ahead of reported results based on sector read-throughs and analyst estimates.'
    : null;

  return {
    symbol: clean,
    nextResultDate,
    isConfirmedDate,
    dateConfidence: isConfirmedDate ? 'CONFIRMED' : nextResultDate ? 'ESTIMATED' : 'UNKNOWN',
    dateSource: dateSource || 'not_available',
    lastResultDate,
    daysToResult,
    isPreDriftZone,
    isPostResultZone,
    isResultDay,
    historicalSurprises,
    beats,
    misses,
    beatRate,
    driftDirection,
    riskLevel,
    signalModifier,
    signalNote,
    educationalContext,
    dataSource: dateSource || 'not_available'
  };
}

/**
 * Updates the earnings calendar with a confirmed result date.
 * Called when BSE announces a board meeting date.
 *
 * @param {string} symbol
 * @param {Object} data - { nextResultDate, lastResultDate, actualSurprisePct }
 */
export function updateEarningsCalendar(symbol, data = {}) {
  const calendar = loadCalendar();
  const clean = String(symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');

  const existing = calendar[clean] || { historicalSurprises: [] };

  if (data.actualSurprisePct !== undefined && data.actualSurprisePct !== null) {
    existing.historicalSurprises = [
      ...existing.historicalSurprises.slice(-7), // keep last 8 quarters
      Number(data.actualSurprisePct)
    ];
  }

  calendar[clean] = {
    ...existing,
    nextResultDate: data.nextResultDate || existing.nextResultDate,
    nextResultDateConfirmed: data.nextResultDate ? data.nextResultDateConfirmed === true : existing.nextResultDateConfirmed === true,
    nextResultDateSource: data.nextResultDate ? (data.source || 'unverified') : existing.nextResultDateSource,
    lastResultDate: data.lastResultDate || existing.lastResultDate,
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
 * Returns the full earnings calendar (for the calendar view endpoint).
 */
export function getFullEarningsCalendar() {
  return loadCalendar();
}
