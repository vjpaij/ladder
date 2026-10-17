/**
 * newsIntelService.js
 * News intelligence: fetches RSS feeds from Moneycontrol + Economic Times,
 * plus BSE corporate announcements. Filters for genuine fundamental-altering
 * events only — no hype, no fear, no generic market commentary.
 *
 * Signal extraction uses a curated keyword whitelist (positive) and blacklist
 * (negative), each tagged with a weight and category.
 *
 * Cache: data/news_intel_cache.json — 4-hour TTL per feed
 */

import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const CACHE_FILE = path.join(DATA_DIR, 'news_intel_cache.json');
const FEED_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_ARTICLES_PER_STOCK = 5;

// ── POSITIVE SIGNAL KEYWORDS ────────────────────────────────────────────────
// Genuine business-improving events only. Each has: weight, category, label
const POSITIVE_SIGNALS = [
  // Order wins and contract awards
  { pattern: /wins?\s+(?:\w+\s+){0,3}(order|contract|deal)|receives?\s+(?:\w+\s+){0,3}(contract|order|bid)|bags?\s+(?:\w+\s+){0,3}(order|contract)|secures?\s+(?:\w+\s+){0,3}(deal|contract|order)|awarded\s+(?:\w+\s+){0,3}(contract|tender|order)/i, weight: 3, category: 'ORDER_WIN', label: 'Order Win' },
  // Capacity expansion
  { pattern: /new plant|greenfield|brownfield|capex of|expan(d|sion)|new (facility|unit|line|capacity)/i, weight: 2, category: 'CAPEX', label: 'Capacity Expansion' },
  // Debt reduction
  { pattern: /repay(s|ed|ing)? (debt|loan)|becomes? debt.free|debt.free|credit (upgrade|rating upgrade)|de-lever/i, weight: 3, category: 'DEBT_REDUCTION', label: 'Debt Reduction' },
  // Buyback
  { pattern: /buyback|buy.?back|share repurchase/i, weight: 2, category: 'BUYBACK', label: 'Buyback Announced' },
  // Dividend increase
  { pattern: /dividend (increas|rais|hik|declar)|special dividend|interim dividend/i, weight: 1, category: 'DIVIDEND', label: 'Dividend' },
  // New market or product
  { pattern: /launches? (in|new|product)|enters? .+ market|new (segment|product|vertical|geography)/i, weight: 2, category: 'MARKET_EXPANSION', label: 'Market Expansion' },
  // Strategic partnership or JV
  { pattern: /joint venture|strategic (partnership|alliance|collaboration)|signs? (MoU|agreement) with/i, weight: 2, category: 'PARTNERSHIP', label: 'Strategic Partnership' },
  // Rating upgrade
  { pattern: /upgrade(d|s)? to (buy|outperform|add)|target price (rais|increas)|rating upgrade/i, weight: 1, category: 'ANALYST_UPGRADE', label: 'Analyst Upgrade' },
  // Profit beat
  { pattern: /profit (surges?|jumps?|rises?|beats?|up \d+%)|beats? estimate|exceeds? expectation/i, weight: 2, category: 'EARNINGS_BEAT', label: 'Earnings Beat' },
  // Promoter buying
  { pattern: /promoter (buys?|purchases?|increases? stake|acquires?)|insider buying/i, weight: 2, category: 'PROMOTER_BUY', label: 'Promoter Buying' },
  // New listing / IPO proceeds deployment
  { pattern: /deploys? IPO|utilizes? IPO proceeds|listing (gains?|day)/i, weight: 1, category: 'IPO', label: 'IPO Related' },
  // Export order
  { pattern: /export (order|contract)|international (order|deal|contract)/i, weight: 2, category: 'EXPORT', label: 'Export Order' },
  // Government contract
  { pattern: /government (contract|order|tender|project)|defence (order|contract|ministry|deal)|ministry (approves?|awards?)/i, weight: 3, category: 'GOVT_ORDER', label: 'Government Order' },
];

// ── NEGATIVE SIGNAL KEYWORDS ────────────────────────────────────────────────
// Genuine risk events only. No generic market fear.
const NEGATIVE_SIGNALS = [
  // Promoter selling
  { pattern: /promoter sells?|promoter (offloads?|exits?|reduces? stake)|block deal by (promoter|founder)/i, weight: -4, category: 'PROMOTER_SELL', label: 'Promoter Selling' },
  // Regulatory / legal action
  { pattern: /SEBI\s+(?:\w+\s+){0,3}(notice|order|penalty|ban|fraud|action|probe)|ED raid|CBI (raid|probe)|tax demand|GST (probe|notice|demand)/i, weight: -4, category: 'REGULATORY', label: 'Regulatory Action' },
  // Fraud / audit issues
  { pattern: /auditor (resign|quit|step|withdraw)|fraud (detected|found|alleged)|account(ing)? (fraud|irregularit|manipulat)|restatement/i, weight: -5, category: 'FRAUD', label: 'Governance Issue' },
  // Debt stress
  { pattern: /NPA|debt restructur|lenders? (invoke|seize|recall)|pledge (invoked|triggered|enforced)|credit (downgrade|rating cut)/i, weight: -4, category: 'DEBT_STRESS', label: 'Debt Stress' },
  // Earnings miss
  { pattern: /profit (falls?|drops?|declines?|misses?|below estimate)|misses? estimate|below expectation/i, weight: -3, category: 'EARNINGS_MISS', label: 'Earnings Miss' },
  // Management exit (controversial)
  { pattern: /CEO (resigns?|quits?|steps? down)( amid| following| after| over)|CFO (resigns?|quits?) (amid|over|due)|management (exit|shake.?up)/i, weight: -3, category: 'MGMT_EXIT', label: 'Management Exit' },
  // Liquidity crunch
  { pattern: /liquidity (crisis|crunch|stress)|cash (crunch|burn|deficit)|unable to pay|default/i, weight: -5, category: 'LIQUIDITY', label: 'Liquidity Stress' },
];

// ── NOISE FILTERS (articles to explicitly reject) ─────────────────────────
const NOISE_PATTERNS = [
  /markets? (rally|fall|rise|drop) on global cues/i,
  /sensex (up|down|gains|falls)/i,
  /nifty (up|down|gains|falls|ends)/i,
  /global (markets?|cues?|factors?)/i,
  /multibagger (potential|stock|pick)/i,
  /top \d+ stocks? to (buy|watch|invest)/i,
  /best stocks? for \d{4}/i,
  /analyst (recommend|suggest|pick)s? \d+ stocks/i,
  /futures and options/i,
  /sgx nifty/i,
  /midcap, smallcap (rally|fall|gain)/i,
];

/** Strips HTML tags and normalizes whitespace */
function cleanHtml(html = '') {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parses RSS XML into article objects */
function parseRssXml(xml) {
  const articles = [];
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    const title = cleanHtml((item.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]>|<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || (item.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]>/i) || [])[1] || '');
    const description = cleanHtml((item.match(/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]>|<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || '');
    const pubDate = ((item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || '').trim();
    const link = ((item.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '').trim();
    if (title) {
      articles.push({ title, description, pubDate, link, fetchedAt: new Date().toISOString() });
    }
  }
  return articles;
}

/** RSS feed definitions */
const RSS_FEEDS = [
  { name: 'Moneycontrol Markets', url: 'https://www.moneycontrol.com/rss/latestnews.xml' },
  { name: 'Economic Times Markets', url: 'https://economictimes.indiatimes.com/markets/stocks/news/rssfeeds/2146842.cms' },
  { name: 'Economic Times Companies', url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms' },
  { name: 'Business Standard', url: 'https://www.business-standard.com/rss/markets-106.rss' },
];

let _feedCache = null;
let _feedCacheTimestamp = 0;

/** Fetches and parses all RSS feeds. In-memory cached for 15 minutes. */
async function fetchAllFeeds() {
  if (process.env.NEWS_RSS_DISABLED === 'true') return [];
  const now = Date.now();
  if (_feedCache && now - _feedCacheTimestamp < 15 * 60 * 1000) {
    return _feedCache;
  }

  const allArticles = [];
  const results = await Promise.allSettled(
    RSS_FEEDS.map(async feed => {
      try {
        const res = await fetch(feed.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) return [];
        const xml = await res.text();
        return parseRssXml(xml).map(a => ({ ...a, feedName: feed.name }));
      } catch { return []; }
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled') allArticles.push(...r.value);
  }

  _feedCache = allArticles;
  _feedCacheTimestamp = now;
  return allArticles;
}

/**
 * Checks if an article is noise (generic market commentary).
 */
export function isNoise(title, description = '') {
  const text = `${title} ${description}`;
  return NOISE_PATTERNS.some(p => p.test(text));
}

/**
 * Extracts signals from article text for a specific company.
 * Returns array of matched signals with weights.
 */
export function extractSignals(title, description = '') {
  const text = `${title} ${description}`;
  const signals = [];
  const negated = (pattern) => {
    const match = pattern.exec(text);
    if (!match || match.index === undefined) return false;
    const context = text.slice(Math.max(0, match.index - 60), match.index);
    return /\b(?:no evidence of|not|denies?|denied|dismisses?|dismissed|unconfirmed|false|alleged|allegedly)\b[^.!?]{0,45}$/i.test(context);
  };

  for (const sig of POSITIVE_SIGNALS) {
    if (sig.pattern.test(text) && !negated(sig.pattern)) {
      signals.push({ ...sig, pattern: undefined });
    }
  }
  for (const sig of NEGATIVE_SIGNALS) {
    if (sig.pattern.test(text) && !negated(sig.pattern)) {
      signals.push({ ...sig, pattern: undefined });
    }
  }
  return signals;
}

/**
 * Checks if an article mentions a specific company by symbol or partial name.
 */
function mentionsCompany(title, description = '', symbol, name = '') {
  const text = `${title} ${description}`.toUpperCase();
  const cleanSym = String(symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');
  const hasToken = value => new RegExp(`(^|[^A-Z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z0-9]|$)`, 'i').test(text);

  // Direct symbol match (at least 4 chars to avoid false positives)
  if (cleanSym.length >= 4 && hasToken(cleanSym)) return true;

  // Company name partial match (first meaningful word, ≥5 chars)
  if (name) {
    const nameParts = String(name).toUpperCase().split(/\s+/).filter(p => p.length >= 5);
    for (const part of nameParts.slice(0, 2)) {
      if (hasToken(part)) return true;
    }
  }

  return false;
}

/**
 * Fetches and returns news signals for a specific stock symbol.
 *
 * @param {string} symbol
 * @param {string} name - company name for matching
 * @returns {Promise<Object>} { symbol, articles, netSignalWeight, overallSentiment, hasCriticalRedFlag }
 */
export async function fetchNewsSignals(symbol, name = '') {
  const clean = String(symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');

  if (process.env.NEWS_RSS_ENABLED !== 'true') {
    return {
      symbol: clean,
      name,
      articles: [],
      articleCount: 0,
      overallSentiment: 'UNAVAILABLE',
      hasCriticalRedFlag: false,
      hasVerifiedCriticalRedFlag: false,
      sourceStatus: 'DISABLED_PENDING_SOURCE_REVIEW',
      signalUse: 'Enable only after confirming feed access and storage terms. News does not independently change a Buy/Sell state.'
    };
  }

  // Check disk cache first (4-hour TTL per symbol)
  const diskCache = loadNewsCache();
  const cached = diskCache[clean];
  if (cached) {
    const age = Date.now() - new Date(cached.fetchedAt || 0).getTime();
    if (age < FEED_TTL_MS) return cached;
  }

  const allArticles = await fetchAllFeeds();

  // Filter articles relevant to this company
  const seenStories = new Set();
  const relevant = allArticles.filter(article => {
    const publishedAt = Date.parse(article.pubDate);
    if (isNoise(article.title, article.description)
        || !mentionsCompany(article.title, article.description, clean, name)
        || !Number.isFinite(publishedAt)
        || Date.now() - publishedAt < -86400000
        || Date.now() - publishedAt > 45 * 86400000) return false;
    const key = String(article.link || article.title).toLowerCase().replace(/\W/g, '');
    if (seenStories.has(key)) return false;
    seenStories.add(key);
    return true;
  });

  // Extract signals from relevant articles
  const enrichedArticles = relevant.map(article => {
    const signals = extractSignals(article.title, article.description);
    const netWeight = signals.reduce((sum, s) => sum + s.weight, 0);
    return {
      title: article.title,
      link: article.link,
      pubDate: article.pubDate,
      feedName: article.feedName,
      signals,
      netWeight,
      hasCriticalRedFlag: signals.some(s => s.weight <= -4),
      hasVerifiedCriticalRedFlag: false
    };
  }).sort((a, b) => Math.abs(b.netWeight) - Math.abs(a.netWeight));

  // Cap at MAX_ARTICLES_PER_STOCK
  const topArticles = enrichedArticles.slice(0, MAX_ARTICLES_PER_STOCK);

  const netSignalWeight = topArticles.reduce((sum, a) => sum + a.netWeight, 0);
  const hasCriticalRedFlag = topArticles.some(a => a.hasCriticalRedFlag);

  let overallSentiment = 'NEUTRAL';
  if (netSignalWeight >= 4) overallSentiment = 'STRONGLY_POSITIVE';
  else if (netSignalWeight >= 2) overallSentiment = 'POSITIVE';
  else if (netSignalWeight <= -4) overallSentiment = 'STRONGLY_NEGATIVE';
  else if (netSignalWeight <= -2) overallSentiment = 'NEGATIVE';

  const result = {
    symbol: clean,
    name,
    articles: topArticles,
    netSignalWeight,
    overallSentiment,
    hasCriticalRedFlag,
    hasVerifiedCriticalRedFlag: false,
    sourceStatus: 'MEDIA_CONTEXT_ONLY',
    signalUse: 'Context only. Media keyword matches are not verified filing events and do not independently change Buy/Sell state.',
    fetchedAt: new Date().toISOString(),
    articleCount: topArticles.length
  };

  // Save to disk cache
  diskCache[clean] = result;
  saveNewsCache(diskCache);

  return result;
}

export function loadNewsCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
  } catch { /* ignore */ }
  return {};
}

function saveNewsCache(cache) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch { /* ignore */ }
}

/**
 * Builds news signals dynamically for all candidates in the universe.
 * Fetches all RSS feeds once and evaluates company mentions entirely in-memory,
 * avoiding sequential network queries.
 */
export async function buildUniverseNewsMap(candidates = []) {
  const diskCache = loadNewsCache();
  let allArticles = [];
  try {
    allArticles = await fetchAllFeeds();
  } catch (_) {}

  const result = { ...diskCache };
  if (!allArticles || allArticles.length === 0) {
    return result;
  }

  for (const c of candidates) {
    const clean = String(c.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
    if (!clean) continue;
    const name = c.name || clean;

    const seenStories = new Set();
    const relevant = allArticles.filter(article => {
      const publishedAt = Date.parse(article.pubDate);
      if (isNoise(article.title, article.description)
          || !mentionsCompany(article.title, article.description, clean, name)
          || !Number.isFinite(publishedAt)
          || Date.now() - publishedAt < -86400000
          || Date.now() - publishedAt > 45 * 86400000) return false;
      const key = String(article.link || article.title).toLowerCase().replace(/\W/g, '');
      if (seenStories.has(key)) return false;
      seenStories.add(key);
      return true;
    });

    if (relevant.length > 0) {
      const enrichedArticles = relevant.map(article => {
        const signals = extractSignals(article.title, article.description);
        const netWeight = signals.reduce((sum, s) => sum + s.weight, 0);
        return {
          title: article.title,
          link: article.link,
          pubDate: article.pubDate,
          feedName: article.feedName,
          signals,
          netWeight,
          hasCriticalRedFlag: signals.some(s => s.weight <= -4),
          hasVerifiedCriticalRedFlag: false
        };
      }).sort((a, b) => Math.abs(b.netWeight) - Math.abs(a.netWeight));

      const topArticles = enrichedArticles.slice(0, MAX_ARTICLES_PER_STOCK);
      const netSignalWeight = topArticles.reduce((sum, a) => sum + a.netWeight, 0);
      const hasCriticalRedFlag = topArticles.some(a => a.hasCriticalRedFlag);

      let overallSentiment = 'NEUTRAL';
      if (netSignalWeight >= 4) overallSentiment = 'STRONGLY_POSITIVE';
      else if (netSignalWeight >= 2) overallSentiment = 'POSITIVE';
      else if (netSignalWeight <= -4) overallSentiment = 'STRONGLY_NEGATIVE';
      else if (netSignalWeight <= -2) overallSentiment = 'NEGATIVE';

      result[clean] = {
        symbol: clean,
        name,
        articles: topArticles,
        netSignalWeight,
        overallSentiment,
        hasCriticalRedFlag,
        hasVerifiedCriticalRedFlag: false,
        sourceStatus: 'MEDIA_CONTEXT_ONLY',
        signalUse: 'Context only. Media keyword matches are not verified filing events and do not independently change Buy/Sell state.',
        fetchedAt: new Date().toISOString(),
        articleCount: topArticles.length
      };
    } else if (!result[clean]) {
      result[clean] = {
        symbol: clean,
        name,
        articles: [],
        netSignalWeight: 0,
        overallSentiment: 'NEUTRAL',
        hasCriticalRedFlag: false,
        hasVerifiedCriticalRedFlag: false,
        sourceStatus: 'NO_RECENT_HEADLINES',
        signalUse: 'No corporate disclosures or filing news in past 30 days.',
        fetchedAt: new Date().toISOString(),
        articleCount: 0
      };
    }
  }

  saveNewsCache(result);
  return result;
}

/**
 * Batch fetch news for multiple symbols.
 */
export async function batchFetchNewsSignals(symbolNamePairs = []) {
  return buildUniverseNewsMap(symbolNamePairs);
}

