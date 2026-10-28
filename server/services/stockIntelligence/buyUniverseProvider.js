/**
 * buyUniverseProvider.js
 * Builds the candidate stock universe for Buy Analysis.
 * Applies the criteria shown as enabled in the supplied screenshot:
 * - Close at least 3% above 50-EMA
 * - Prior close above the close two sessions earlier
 * - Close two sessions earlier at or below its 50-EMA
 * - Market capitalization at least ₹1,000 Cr
 * Close-only history cannot verify volume; rows that appear disabled are
 * informational or evaluated separately.
 *
 * Universe sources: portfolio holdings + NSE 500 baseline + user watchlist
 */

import fs from 'node:fs';
import path from 'node:path';
import { aggregateWeeklyCloses, simpleMovingAverage } from './technicalIndicators.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const UNIVERSE_FILE = path.join(DATA_DIR, 'nse500_universe.json');
const WATCHLIST_FILE = path.join(DATA_DIR, 'buy_watchlist.json');
const UNIVERSE_CACHE_FILE = path.join(DATA_DIR, 'buy_universe_cache.json');
const UNIVERSE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Embedded NSE 500 baseline (top 200 liquid stocks for initial release) ──
const NSE500_BASELINE = [
  'RELIANCE','TCS','HDFCBANK','INFY','HINDUNILVR','ICICIBANK','SBIN','BAJFINANCE',
  'BHARTIARTL','KOTAKBANK','LT','ASIANPAINT','AXISBANK','MARUTI','TITAN','SUNPHARMA',
  'NESTLEIND','WIPRO','ULTRACEMCO','TECHM','HCLTECH','POWERGRID','NTPC','ONGC',
  'JSWSTEEL','TATAMOTORS','TATASTEEL','INDUSINDBK','BAJAJFINSV','ADANIPORTS',
  'CIPLA','DRREDDY','DIVISLAB','APOLLOHOSP','DABUR','MARICO','COLPAL','PIDILITIND',
  'BERGEPAINT','HAVELLS','VOLTAS','WHIRLPOOL','CROMPTON','POLYCAB','KANSAINER',
  'AUROPHARMA','LUPIN','TORNTPHARM','ALKEM','IPCALAB','GLAXO','PFIZER','ABBOTINDIA',
  'BIOCON','ZYDUSLIFE','GLAND','LALPATHLAB','METROPOLIS','MAXHEALTH',
  'UNITDSPR','RADICO','VBL','GODREJCP','GODREJPROP',
  'OBEROIRLTY','DLF','PRESTIGE','PHOENIXLTD','SOBHA','BRIGADE',
  'HDFCLIFE','SBILIFE','ICICIGI','NAUKRI','POLICYBZR',
  'PAYTM','ETERNAL','NYKAA','DELHIVERY','LTIM','MPHASIS','COFORGE',
  'PERSISTENT','ZENSARTECH','RINFRA','ADANIENT','ADANIGREEN','ADANIENSOL',
  'CANBK','PNB','BANKBARODA','IDBI','IDFCFIRSTB','FEDERALBNK','RBLBANK',
  'YESBANK','DCBBANK','BANDHANBNK','AUBANK','EQUITASBNK',
  'MOTHERSON','BALKRISIND','EXIDEIND','ARE&M','BOSCHLTD','SCHAEFFLER',
  'CEATLTD','MRF','APOLLOTYRE','UNOMINDA','SUNDRMFAST',
  'AARTIIND','DEEPAKNTR','NAVINFLUOR','PIIND','RALLIS','ASTRAL','FINPIPE',
  'SUPREMEIND','FINCABLES','JYOTHYLAB','EMAMILTD','VENKEYS','HEG','GRAPHITE',
  'NATIONALUM','HINDALCO','VEDL','NMDC','MOIL','HINDCOPPER',
  'CUMMINSIND','THERMAX','ABB','SIEMENS','BHEL','BEL','HAL','DRONEACHARYA',
  'DIXON','AMBER','PGHH','VGUARD','ORIENTELEC','BLUESTARCO',
  'RITES','IRFC','RVNL','SJVN','NHPC','TATAPOWER','TORNTPOWER',
  'GAIL','PETRONET','IGL','MGL','GSPL',
  'CHOLAFIN','MUTHOOTFIN','BAJAJHLDNG','CANFINHOME','LICI','ICICIPRULI',
  'TRENT','ABFRL','SPENCERS','RAYMOND','MANYAVAR',
  'JUBLFOOD','DEVYANI','WESTLIFE','BARBEQUE','SAPPHIRE',
  'PAGEIND','KPRMILL','VTL','WELSPUNLIV','FILATEX',
  'COCHINSHIP','GRSE','MAZDOCK','TITAGARH',
  'GMRINFRA','IRB','NBCC','NCC','HCC','CAPACITE','KNRCON',
  'TEJASNET','STLTECH','HFCL','ITI','ROUTE',
  'SUNTV','PVRINOX','ZEEL','DBCORP','JAGRAN',
  'CONCOR','BLUEDART','TCI','VRLLOG','ALLCARGO','MAHLOG',
  'UJJIVANSFB','CREDITACC','SPANDANA',
  'HSCL','SUMICHEM','BAYERCROP','JISLJALEQS',
  'TATACOMM','GTPL','HATHWAY','SITINET',
  // High-Conviction Compounders & Turnarounds
  'FORCEMOT','DEEDEV','JAIBALAJI','TARIL','GVT&D','BSE','INDOTECH','WELCORP','TDPOWERSYS','APOLLO','MARINE','PGIL','SHAILY','IIFLCAPS'
];

export function loadWatchlist() {
  try {
    if (fs.existsSync(WATCHLIST_FILE)) {
      return JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return [];
}

export function saveWatchlist(symbols = []) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const clean = [...new Set(symbols.map(s => String(s).toUpperCase().trim()).filter(Boolean))];
  fs.writeFileSync(WATCHLIST_FILE, JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}

export function addToWatchlist(symbol) {
  const current = loadWatchlist();
  const clean = String(symbol).toUpperCase().trim();
  if (!current.includes(clean)) {
    current.push(clean);
    saveWatchlist(current);
  }
  return current;
}

export function removeFromWatchlist(symbol) {
  const current = loadWatchlist();
  const clean = String(symbol).toUpperCase().trim();
  const updated = current.filter(s => s !== clean);
  saveWatchlist(updated);
  return updated;
}

const NON_STOCK_PATTERNS = [
  /-(SAVINGS|RETIREMENT|FD|LOAN|ACCOUNT|CARD|DEPOSIT)$/i,
  /^(SM|POP)\d+/i,
  /^\d+$/ // AMFI numeric scheme codes
];

const KNOWN_US_SYMBOLS = new Set([
  'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'PLTR', 'CRM', 'AVGO',
  'NFLX', 'AMD', 'INTC', 'ORCL', 'ADBE', 'QCOM', 'CSCO', 'IBM', 'NOW', 'UBER', 'ABNB',
  'SNOW', 'NET', 'DDOG', 'MDB', 'SHOP', 'SQ', 'PYPL', 'COIN', 'DIS', 'NKE', 'SBUX', 'MCD',
  'WMT', 'TGT', 'COST', 'HD', 'LOW', 'PG', 'JNJ', 'PFE', 'MRK', 'ABBV', 'LLY', 'UNH',
  'CVS', 'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'BLK', 'SCHW', 'V', 'MA', 'AXP', 'XOM',
  'CVX', 'COP', 'SLB', 'CAT', 'DE', 'GE', 'HON', 'UNP', 'UPS', 'FDX', 'BA', 'RTX', 'LMT',
  'GD', 'NOC', 'NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'SRE', 'ED', 'PEG', 'XEL'
]);

function isIndianStockSymbol(clean) {
  if (!clean || clean.length < 2 || clean.includes('^')) return false;
  for (const pat of NON_STOCK_PATTERNS) {
    if (pat.test(clean)) return false;
  }
  if (KNOWN_US_SYMBOLS.has(clean)) return false;
  // Exclude ETF funds
  if (clean.endsWith('BEES') || clean.endsWith('ETF')) return false;
  return true;
}

function loadNse500Universe() {
  const symbols = new Set();
  const hpKeys = new Set();

  try {
    const hpFile = path.join(DATA_DIR, 'historical_prices.json');
    if (fs.existsSync(hpFile)) {
      const hp = JSON.parse(fs.readFileSync(hpFile, 'utf8'));
      for (const k of Object.keys(hp)) {
        const clean = String(k).replace(/\.(NS|BO)$/i, '').toUpperCase().trim();
        hpKeys.add(clean);
        if (isIndianStockSymbol(clean)) {
          symbols.add(clean);
        }
      }
    }
  } catch { /* ignore */ }

  // Only include baseline stocks if they have price history
  for (const sym of NSE500_BASELINE) {
    const clean = String(sym).toUpperCase().trim();
    if (isIndianStockSymbol(clean) && hpKeys.has(clean)) {
      symbols.add(clean);
    }
  }

  try {
    if (fs.existsSync(UNIVERSE_FILE)) {
      const custom = JSON.parse(fs.readFileSync(UNIVERSE_FILE, 'utf8'));
      if (Array.isArray(custom)) {
        for (const s of custom) {
          const clean = String(s).replace(/\.(NS|BO)$/i, '').toUpperCase().trim();
          if (isIndianStockSymbol(clean)) symbols.add(clean);
        }
      }
    }
  } catch { /* ignore */ }
  return [...symbols];
}

/**
 * Calculates EMA (Exponential Moving Average) for an array of prices.
 * @param {number[]} prices - sorted oldest to newest
 * @param {number} period - EMA period
 * @returns {number|null}
 */
function calculateEMA(prices, period) {
  if (!prices || prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Applies Chartink-equivalent technical filter to a price series.
 * Returns { passes: bool, reasons: string[], scores: Object }
 */
export function applyChartinkFilter(priceSeriesMap, symbol, fundamentals = {}, { asOfDate = new Date().toISOString().slice(0, 10) } = {}) {
  const clean = String(symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');
  const candidates = [symbol, clean, `${clean}.NS`, `${clean}.BO`];

  let rawSeries = null;
  for (const key of candidates) {
    const s = priceSeriesMap?.[key];
    if (s && Object.keys(s).length > 50) { rawSeries = s; break; }
  }

  if (!rawSeries) {
    return { passes: false, reasons: ['No price history'], technicalScore: 0 };
  }

  // Existing price store contains daily closes, not audited OHLCV.
  const entries = Object.entries(rawSeries)
    .map(([date, price]) => ({ date, close: Number(price) }))
    .filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.date <= asOfDate && e.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (entries.length < 60) {
    return { passes: false, reasons: ['Insufficient price history (< 60 days)'], technicalScore: 0 };
  }

  const closes = entries.map(e => e.close);
  const today = closes[closes.length - 1];
  const yesterday = closes[closes.length - 2];
  const twoDaysAgo = closes[closes.length - 3];

  // 50-day EMA
  const ema50 = calculateEMA(closes, 50);
  if (!ema50) return { passes: false, reasons: ['Cannot compute EMA50'], technicalScore: 0 };

  // 50-EMA 2 days ago (approximation using closes up to 2 days ago)
  const ema50TwoDaysAgo = calculateEMA(closes.slice(0, closes.length - 2), 50);

  const reasons = [];
  const failReasons = [];
  let techScore = 0;

  // The screenshot shows these four criteria enabled: 3% EMA buffer,
  // yesterday's up close, two-day fresh breakout, and ₹1,000 Cr market cap.
  const emaBufferPass = today >= ema50 * 1.03;
  if (emaBufferPass) {
    techScore += 30;
    reasons.push('Close is at least 3% above 50-EMA');
  } else failReasons.push('Close is less than 3% above 50-EMA');

  // Disabled screenshot row: one-day 5% jump. Keep as context, not a gate.
  const dailyGainPct = yesterday > 0 ? (today / yesterday - 1) * 100 : 0;
  reasons.push(`One-day change ${dailyGainPct.toFixed(1)}% (context only; 5% row appears disabled)`);

  const priorDayUpPass = yesterday > twoDaysAgo;
  if (priorDayUpPass) {
    techScore += 10;
    reasons.push('Previous close was above the close two sessions earlier');
  } else failReasons.push('Previous close was not above the close two sessions earlier');

  const freshBreakoutPass = Boolean(ema50TwoDaysAgo && twoDaysAgo <= ema50TwoDaysAgo);
  if (freshBreakoutPass) {
    techScore += 15;
    reasons.push('Close two sessions earlier was at or below its 50-EMA');
  } else failReasons.push('Close two sessions earlier was above its 50-EMA or EMA is unavailable');

  const marketCapCr = Number(fundamentals.marketCapCr);
  const marketCapKnown = fundamentals.marketCapCr !== null && fundamentals.marketCapCr !== undefined && Number.isFinite(marketCapCr);
  const isPennyPrice = today < 20.00;
  const isMicrocap = marketCapKnown && marketCapCr < 1000;
  const marketCapPass = !isPennyPrice && (!marketCapKnown || marketCapCr >= 1000);
  if (isPennyPrice) failReasons.push(`Penny stock price (CMP ₹${today.toFixed(2)} < ₹20.00)`);
  else if (isMicrocap) failReasons.push(`Market capitalization (₹${marketCapCr} Cr) is below ₹1,000 Cr threshold`);
  else if (marketCapKnown) reasons.push(`Market capitalization (₹${marketCapCr} Cr) is at least ₹1,000 Cr ✓`);

  // Completed weekly closes, aligned with the main trend analyzer.
  const weeklyCloses = aggregateWeeklyCloses(entries, { today: asOfDate }).map(row => row.close);
  const sma30w = simpleMovingAverage(weeklyCloses, 30);
  const isAbove30wSMA = sma30w !== null && today > sma30w;
  if (isAbove30wSMA) {
    techScore += 10;
    reasons.push('Above 30-week SMA (Stage 2) ✓');
  }

  // 52-week high proximity (sweet spot: 5–20% below 52wk high)
  const high52w = Math.max(...closes.slice(-252));
  const pctFromHigh52w = high52w > 0 ? ((today / high52w - 1) * 100) : 0;
  if (pctFromHigh52w >= -15 && pctFromHigh52w <= 0) {
    techScore += 10;
    reasons.push(`Near 52wk high (${pctFromHigh52w.toFixed(1)}%) ✓`);
  } else if (pctFromHigh52w > 0) {
    techScore += 5;
    reasons.push(`At/above 52wk high ✓`);
  }

  // Consolidation pattern: was in tight range before breakout
  const prior20 = closes.slice(-25, -5);
  if (prior20.length >= 10) {
    const rangeHigh = Math.max(...prior20);
    const rangeLow = Math.min(...prior20);
    const rangeWidth = rangeHigh > 0 ? (rangeHigh / rangeLow - 1) * 100 : 100;
    if (rangeWidth < 10) {
      techScore += 15;
      reasons.push(`Breakout from tight base (${rangeWidth.toFixed(1)}% range) ✓`);
    }
  }

  // Rows shown disabled in the supplied screenshot are intentionally not gates.
  const passes = emaBufferPass && priorDayUpPass && freshBreakoutPass && marketCapPass;

  return {
    passes,
    technicalScore: Math.min(100, techScore),
    volumeConfirmed: false,
    volumeStatus: 'UNAVAILABLE',
    marketCapStatus: marketCapKnown ? 'CURRENT_SNAPSHOT' : 'UNKNOWN',
    liquidityStatus: 'UNAVAILABLE',
    fundamentalFilterStatus: 'EVALUATED_SEPARATELY',
    checksNotEvaluated: ['Volume surge (row appears disabled; no OHLCV cache)', 'Quarterly sales/profit 1.75x (rows appear disabled)', 'Historical market-cap series for backtesting', 'Tradability and spread (no quote-depth data)'],
    activeFilterStatus: { emaBufferPass, priorDayUpPass, freshBreakoutPass, marketCapPass, marketCapKnown },
    disabledScreenshotRows: ['One-day close gain >= 5%', 'Volume > 5x 20-day average', 'Quarterly sales > 1.75x twelve quarters ago', 'Quarterly profit > 1.75x twelve quarters ago'],
    reasons,
    failReasons,
    currentPrice: today,
    ema50,
    high52w: Number.isFinite(high52w) ? high52w : today,
    pctFromHigh52w: Number.isFinite(pctFromHigh52w) ? Number(pctFromHigh52w.toFixed(2)) : 0,
    dailyGainPct: Number.isFinite(dailyGainPct) ? Number(dailyGainPct.toFixed(2)) : 0,
    priceSeriesLength: entries.length,
    lastPriceDate: entries[entries.length - 1]?.date || null
  };
}

/**
 * Builds the full buy candidate universe from all sources.
 * Returns deduplicated list of symbols with source labels.
 *
 * @param {Object[]} portfolioHoldings - user's active holdings
 * @returns {Array<{symbol: string, name: string, source: string, inPortfolio: boolean}>}
 */
export function buildCandidateUniverse(portfolioHoldings = [], chartinkCandidates = [], transactions = [], { asOfDate = new Date().toISOString().slice(0, 10) } = {}) {
  const portfolioSymbols = new Set(
    portfolioHoldings
      .filter(h => h.category_id === 'in_stocks' && Number(h.quantity) > 0 && isIndianStockSymbol(h.symbol))
      .map(h => String(h.symbol).toUpperCase().replace(/\.(NS|BO)$/i, ''))
  );

  const portfolioMap = new Map(
    portfolioHoldings
      .filter(h => h.category_id === 'in_stocks' && isIndianStockSymbol(h.symbol))
      .map(h => [String(h.symbol).toUpperCase().replace(/\.(NS|BO)$/i, ''), h])
  );

  // 1. Inspect transactions & exited holdings for any stock sold in the past 90 days
  // (including the 21st Oct / 23rd Oct 2026 crash session)
  const cutoffMs = Date.parse(`${asOfDate}T00:00:00Z`) - 90 * 86400000;
  const recentlySoldMap = new Map();

  for (const tx of (transactions || [])) {
    const type = String(tx.type || '').toUpperCase();
    if (['SELL', 'REDEEM', 'REDEMPTION'].includes(type) && tx.symbol) {
      const clean = String(tx.symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');
      const txMs = Date.parse(`${tx.date || ''}T00:00:00Z`);
      const isRecent = (!isNaN(txMs) && txMs >= cutoffMs) || (tx.date && tx.date >= '2026-10-21');
      if (isRecent && isIndianStockSymbol(clean) && !portfolioSymbols.has(clean)) {
        if (!recentlySoldMap.has(clean) || (tx.date && tx.date > (recentlySoldMap.get(clean).lastSoldDate || ''))) {
          recentlySoldMap.set(clean, {
            symbol: clean,
            name: tx.name || clean,
            lastSoldDate: tx.date || null
          });
        }
      }
    }
  }

  // Also inspect portfolioHoldings for exited positions (quantity === 0 or status === 'exited')
  for (const h of (portfolioHoldings || [])) {
    if (h.category_id === 'in_stocks' && isIndianStockSymbol(h.symbol)) {
      const clean = String(h.symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');
      const isExited = Number(h.quantity) === 0 || h.status === 'exited' || h.is_exited;
      if (isExited && !portfolioSymbols.has(clean)) {
        if (!recentlySoldMap.has(clean)) {
          recentlySoldMap.set(clean, {
            symbol: clean,
            name: h.name || clean,
            lastSoldDate: h.updated_at ? h.updated_at.slice(0, 10) : null
          });
        }
      }
    }
  }

  const nse500 = loadNse500Universe();
  const watchlist = loadWatchlist().filter(isIndianStockSymbol);

  const allSymbols = new Map();

  // Active Portfolio stocks (always evaluated regardless of filter)
  for (const sym of portfolioSymbols) {
    const h = portfolioMap.get(sym);
    allSymbols.set(sym, {
      symbol: sym,
      name: h?.name || sym,
      source: 'Portfolio',
      inPortfolio: true,
      portfolioQuantity: Number(h?.quantity) || 0,
      portfolioAvgPrice: Number(h?.avg_buy_price) || 0
    });
  }

  // Recently Sold / Crash Exit Candidates (sold in past 90 days, explicitly screened for prime re-entry)
  for (const [sym, info] of recentlySoldMap.entries()) {
    if (!allSymbols.has(sym)) {
      allSymbols.set(sym, {
        symbol: sym,
        name: info.name || sym,
        source: 'Recently Sold / Crash Exit Candidate',
        inPortfolio: false,
        portfolioQuantity: 0,
        portfolioAvgPrice: 0,
        lastSoldDate: info.lastSoldDate
      });
    }
  }

  // Chartink Breakout candidates (meeting active breakout scan)
  for (const c of (chartinkCandidates || [])) {
    const clean = String(c.symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');
    if (!isIndianStockSymbol(clean)) continue;
    if (!allSymbols.has(clean)) {
      allSymbols.set(clean, {
        symbol: clean,
        name: c.name || clean,
        source: 'Chartink Breakout',
        inPortfolio: portfolioSymbols.has(clean),
        portfolioQuantity: 0,
        portfolioAvgPrice: 0,
        currentPrice: Number(c.close) || 0
      });
    } else {
      const existing = allSymbols.get(clean);
      if (!existing.source.includes('Chartink Breakout')) {
        existing.source = 'Chartink Breakout + ' + existing.source;
      }
    }
  }

  // NSE 500 universe
  for (const sym of nse500) {
    const clean = String(sym).toUpperCase().replace(/\.(NS|BO)$/i, '');
    if (!allSymbols.has(clean)) {
      allSymbols.set(clean, {
        symbol: clean,
        name: clean,
        source: 'NSE500',
        inPortfolio: portfolioSymbols.has(clean),
        portfolioQuantity: 0,
        portfolioAvgPrice: 0
      });
    } else {
      // Already exists as portfolio or recently sold — update source to show confluence
      const existing = allSymbols.get(clean);
      if (existing.source === 'Portfolio') {
        existing.source = 'Portfolio + NSE500';
      } else if (!existing.source.includes('NSE500')) {
        existing.source += ' + NSE500';
      }
    }
  }

  // User watchlist
  for (const sym of watchlist) {
    const clean = String(sym).toUpperCase().replace(/\.(NS|BO)$/i, '');
    if (!allSymbols.has(clean)) {
      allSymbols.set(clean, {
        symbol: clean,
        name: clean,
        source: 'Watchlist',
        inPortfolio: portfolioSymbols.has(clean),
        portfolioQuantity: 0,
        portfolioAvgPrice: 0
      });
    } else {
      const existing = allSymbols.get(clean);
      if (!existing.source.includes('Watchlist')) {
        existing.source += ' + Watchlist';
      }
    }
  }

  return [...allSymbols.values()];
}

/**
 * Saves filtered universe results to cache.
 */
export function saveUniverseCache(results) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(UNIVERSE_CACHE_FILE, JSON.stringify({
      generatedAt: new Date().toISOString(),
      count: results.length,
      results
    }, null, 2), 'utf8');
  } catch { /* ignore */ }
}

/**
 * Loads universe cache if within TTL.
 */
export function loadUniverseCache() {
  try {
    if (fs.existsSync(UNIVERSE_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(UNIVERSE_CACHE_FILE, 'utf8'));
      const age = Date.now() - new Date(data.generatedAt || 0).getTime();
      if (age < UNIVERSE_CACHE_TTL_MS) return data;
    }
  } catch { /* ignore */ }
  return null;
}
