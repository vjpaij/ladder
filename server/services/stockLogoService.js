/**
 * stockLogoService.js — Automated Web Discovery & Multi-Tier Resolution Engine for Stock Logos
 *
 * Resolves authentic corporate logos for Indian and global equities by:
 * 1. Checking the in-memory / disk cache (data/stock_logos_cache.json)
 * 2. Reading known domains from src/data/stockDomainsMap.json
 * 3. Dynamically scraping the company's verified website from Screener.in / NSE / BSE
 * 4. Validating and caching high-res logos from Hunter, Unavatar, Google S2 Favicon, or direct domain
 */

import fs from 'node:fs';
import path from 'node:path';

const CACHE_FILE = path.join(process.cwd(), 'data', 'stock_logos_cache.json');
const DOMAINS_MAP_FILE = path.join(process.cwd(), 'src', 'data', 'stockDomainsMap.json');
const SCREENER_CACHE_DIR = path.join(process.cwd(), 'data', 'screener_cache');

let _logoCache = null;
let _domainsMap = null;
let _saveTimeout = null;

function loadDomainsMap() {
  if (_domainsMap) return _domainsMap;
  try {
    if (fs.existsSync(DOMAINS_MAP_FILE)) {
      _domainsMap = JSON.parse(fs.readFileSync(DOMAINS_MAP_FILE, 'utf8'));
      return _domainsMap;
    }
  } catch (e) {
    console.warn('[StockLogoService] Could not read stockDomainsMap.json:', e.message);
  }
  _domainsMap = {};
  return _domainsMap;
}

function loadLogoCache() {
  if (_logoCache) return _logoCache;
  try {
    if (fs.existsSync(CACHE_FILE)) {
      _logoCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      return _logoCache;
    }
  } catch (e) {
    console.warn('[StockLogoService] Could not read stock_logos_cache.json:', e.message);
  }
  _logoCache = {};
  return _logoCache;
}

function scheduleSave() {
  if (_saveTimeout) return;
  _saveTimeout = setTimeout(() => {
    _saveTimeout = null;
    try {
      if (_logoCache) {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(_logoCache, null, 2), 'utf8');
      }
      if (_domainsMap) {
        fs.mkdirSync(path.dirname(DOMAINS_MAP_FILE), { recursive: true });
        fs.writeFileSync(DOMAINS_MAP_FILE, JSON.stringify(_domainsMap, null, 2), 'utf8');
        const jsFile = DOMAINS_MAP_FILE.replace(/\.json$/, '.js');
        fs.writeFileSync(jsFile, `// Generated corporate domain registry for Indian & Global Equities\nexport default ${JSON.stringify(_domainsMap, null, 2)};\n`, 'utf8');
      }
    } catch (e) {
      console.error('[StockLogoService] Failed to persist logo cache:', e.message);
    }
  }, 1000);
}

function cleanSymbol(sym) {
  return String(sym || '').toUpperCase().replace(/\.(NS|BO|BSE|NSE)$/i, '').replace(/[^A-Z0-9]/g, '').trim();
}

/**
 * Scrapes or inspects Screener to find the official company website domain
 */
async function discoverDomainFromWeb(symbol) {
  const clean = cleanSymbol(symbol);
  if (!clean) return null;

  // 1. Check local screener cache if already downloaded
  const localScreener = path.join(SCREENER_CACHE_DIR, `${clean}.json`);
  if (fs.existsSync(localScreener)) {
    try {
      const data = JSON.parse(fs.readFileSync(localScreener, 'utf8'));
      if (data.websiteDomain) return data.websiteDomain;
    } catch {}
  }

  // 2. Fetch live Screener page to extract official corporate website
  const urls = [
    `https://www.screener.in/company/${clean}/consolidated/`,
    `https://www.screener.in/company/${clean}/`
  ];

  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const html = await res.text();
        const matches = [...html.matchAll(/href=["'](https?:\/\/[^"']+)["'][^>]*>(?:\s*<i class=["']icon-link["']|\s*Website)/gi)];
        if (matches.length > 0) {
          try {
            const raw = new URL(matches[0][1]).hostname.replace(/^www\./i, '').toLowerCase();
            if (raw && !raw.includes('screener.in') && !raw.includes('bseindia') && !raw.includes('nseindia')) {
              return raw;
            }
          } catch {}
        }
      }
    } catch {
      // try next
    }
  }

  // 3. Screener Search API fallback
  try {
    const searchRes = await fetch(`https://www.screener.in/api/company/search/?q=${encodeURIComponent(clean)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000)
    });
    if (searchRes.ok) {
      const results = await searchRes.json();
      const match = (results || []).find(r => r.url && (r.url.includes(`/${clean}/`) || r.name.toUpperCase().includes(clean))) || results[0];
      if (match?.url) {
        const pageRes = await fetch(`https://www.screener.in${match.url}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(4000)
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          const matches = [...html.matchAll(/href=["'](https?:\/\/[^"']+)["'][^>]*>(?:\s*<i class=["']icon-link["']|\s*Website)/gi)];
          if (matches.length > 0) {
            try {
              const raw = new URL(matches[0][1]).hostname.replace(/^www\./i, '').toLowerCase();
              if (raw && !raw.includes('screener.in') && !raw.includes('bseindia') && !raw.includes('nseindia')) {
                return raw;
              }
            } catch {}
          }
        }
      }
    }
  } catch {}

  // 4. Candidate domain heuristics
  const heuristics = [
    `${clean.toLowerCase()}.com`,
    `${clean.toLowerCase()}.in`,
    `${clean.toLowerCase()}.co.in`
  ];
  for (const h of heuristics) {
    try {
      const res = await fetch(`https://logos.hunter.io/${h}`, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
      if (res.ok && (res.headers.get('content-type') || '').includes('image')) {
        return h;
      }
    } catch {}
  }

  return null;
}

/**
 * Validates candidate logo URLs across Hunter, Unavatar, Google S2 Favicon, DuckDuckGo
 */
async function verifyLogoForDomain(domain) {
  if (!domain) return null;
  const cleanDomain = String(domain).replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase();
  if (!cleanDomain) return null;

  const candidates = [
    `https://logos.hunter.io/${cleanDomain}`,
    `https://unavatar.io/${cleanDomain}?fallback=false`,
    `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${cleanDomain}.ico`
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
      if (res.ok && (res.headers.get('content-type') || '').includes('image')) {
        return url;
      }
    } catch {}
  }
  return null;
}

/**
 * Main resolution function: returns logo metadata for any ticker
 */
export async function getLogoForSymbol(rawSymbol, companyName = '', forceRefresh = false) {
  const clean = cleanSymbol(rawSymbol);
  if (!clean) return null;

  const cache = loadLogoCache();
  const cached = cache[clean];
  const isStale = cached?.verifiedAt && (Date.now() - new Date(cached.verifiedAt).getTime() > 30 * 24 * 60 * 60 * 1000); // 30-day re-verification TTL

  if (cached && cached.logoUrl && !forceRefresh && !isStale) {
    return cached;
  }

  const domains = loadDomainsMap();
  let domain = domains[clean];

  if (!domain) {
    domain = await discoverDomainFromWeb(clean);
  }

  if (domain) {
    domains[clean] = domain;
    const workingLogoUrl = await verifyLogoForDomain(domain);
    if (workingLogoUrl) {
      const entry = {
        symbol: clean,
        name: companyName || clean,
        domain,
        logoUrl: workingLogoUrl,
        verifiedAt: new Date().toISOString(),
        source: 'Web Discovery Engine'
      };
      cache[clean] = entry;
      scheduleSave();
      return entry;
    }
  }

  return null;
}

/**
 * Returns all cached logos
 */
export function getAllStockLogos() {
  return loadLogoCache();
}

/**
 * Manually register a verified stock logo / domain mapping
 */
export function registerStockLogo(symbol, domain, logoUrl = null) {
  const clean = cleanSymbol(symbol);
  if (!clean || !domain) return;
  const domains = loadDomainsMap();
  const cache = loadLogoCache();

  domains[clean] = domain;
  cache[clean] = {
    symbol: clean,
    domain,
    logoUrl: logoUrl || `https://logos.hunter.io/${domain}`,
    verifiedAt: new Date().toISOString(),
    source: 'Verified Corporate Brand Registry'
  };
  scheduleSave();
}

/**
 * Pre-warms corporate logos for portfolio and universe symbols in the background
 */
export async function prewarmPortfolioLogos(symbols = []) {
  const domains = loadDomainsMap();
  const cache = loadLogoCache();
  let count = 0;

  for (const s of symbols) {
    const clean = cleanSymbol(s);
    if (!clean) continue;
    if (cache[clean]?.logoUrl && domains[clean]) continue;

    try {
      const entry = await getLogoForSymbol(clean);
      if (entry?.logoUrl) count++;
    } catch {}
  }

  if (count > 0) {
    scheduleSave();
    console.log(`[StockLogoService] Prewarmed and verified ${count} corporate logos.`);
  }
}
