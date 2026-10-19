import fs from 'node:fs';
import path from 'node:path';

const CACHE_FILE = 'data/stock_logos_cache.json';
const DOMAINS_MAP_FILE = 'src/data/stockDomainsMap.json';

// Helper to clean symbol
function cleanSym(s) {
  return String(s || '').toUpperCase().replace(/\.(NS|BO|BSE|NSE)$/i, '').replace(/[^A-Z0-9]/g, '').trim();
}

async function extractDomainFromScreener(symbol) {
  const clean = cleanSym(symbol);
  const urls = [
    `https://www.screener.in/company/${clean}/consolidated/`,
    `https://www.screener.in/company/${clean}/`
  ];

  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const html = await res.text();
        const m = html.match(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>\s*<i class=["']icon-link["']/i)
               || html.match(/<i class=["']icon-link["']><\/i>\s*<span[^>]*>([^<]+)<\/span>/i)
               || html.match(/href=["'](https?:\/\/(?:www\.)?([a-z0-9.-]+\.[a-z]{2,}))["'][^>]*target=["']_blank["'][^>]*>\s*(?:<i class=["']icon-link["']|<span[^>]*>(?:Website|[a-z0-9.-]+))/i);
        
        if (m) {
          const raw = (m[2] || m[1]).replace(/^https?:\/\/(www\.)?/, '').split('/')[0].trim().toLowerCase();
          if (raw && !raw.includes('screener.in') && !raw.includes('bseindia') && !raw.includes('nseindia')) {
            return raw;
          }
        }
      }
    } catch {
      // try next
    }
  }

  // Screener search fallback
  try {
    const searchRes = await fetch(`https://www.screener.in/api/company/search/?q=${encodeURIComponent(clean)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(5000)
    });
    if (searchRes.ok) {
      const results = await searchRes.json();
      const match = results.find(r => r.url && (r.url.includes(`/${clean}/`) || r.name.toUpperCase().includes(clean))) || results[0];
      if (match?.url) {
        const pageRes = await fetch(`https://www.screener.in${match.url}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(5000)
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          const m = html.match(/<i class=["']icon-link["']><\/i>\s*<span[^>]*>([^<]+)<\/span>/i)
                 || html.match(/href=["'](https?:\/\/(?:www\.)?([a-z0-9.-]+\.[a-z]{2,}))["'][^>]*target=["']_blank["'][^>]*>/i);
          if (m) {
            const raw = (m[2] || m[1]).replace(/^https?:\/\/(www\.)?/, '').split('/')[0].trim().toLowerCase();
            if (raw && !raw.includes('screener.in') && !raw.includes('bseindia') && !raw.includes('nseindia')) {
              return raw;
            }
          }
        }
      }
    }
  } catch {
    // fallback
  }

  return null;
}

async function verifyLogoForDomain(domain) {
  if (!domain) return null;
  const candidates = [
    `https://logos.hunter.io/${domain}`,
    `https://unavatar.io/${domain}?fallback=false`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
      if (res.ok && (res.headers.get('content-type') || '').includes('image')) {
        return url;
      }
    } catch {
      // try next
    }
  }
  return null;
}

export async function runResolution() {
  console.log('--- STARTING UNIVERSAL WEB STOCK LOGO RESOLUTION ---');

  let currentCache = {};
  if (fs.existsSync(CACHE_FILE)) {
    try { currentCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}
  }

  let domainsMap = {};
  if (fs.existsSync(DOMAINS_MAP_FILE)) {
    try { domainsMap = JSON.parse(fs.readFileSync(DOMAINS_MAP_FILE, 'utf8')); } catch {}
  }

  // Load all stocks from holdings + buy_analysis_snapshot
  const holdingsData = JSON.parse(fs.readFileSync('data/db_cache_snapshot.json', 'utf8')).holdings || [];
  const buySnapshot = JSON.parse(fs.readFileSync('data/buy_analysis_snapshot.json', 'utf8')).analyses || [];

  const allStocks = new Map();
  for (const h of holdingsData) {
    if (h.category_id === 'in_stocks' || h.category === 'in_stocks') {
      const s = cleanSym(h.symbol);
      if (s) allStocks.set(s, { symbol: s, name: h.name || s });
    }
  }
  for (const b of buySnapshot) {
    const s = cleanSym(b.symbol);
    if (s && !allStocks.has(s)) allStocks.set(s, { symbol: s, name: b.name || s });
  }

  // Also read missing report if present
  let missingSymbols = new Set();
  if (fs.existsSync('scratch/missing_logos_report.json')) {
    const rep = JSON.parse(fs.readFileSync('scratch/missing_logos_report.json', 'utf8'));
    (rep.missing || []).forEach(m => missingSymbols.add(cleanSym(m.symbol)));
  }

  console.log(`Auditing and resolving logos for ${allStocks.size} stocks (${missingSymbols.size} known missing)...`);

  const BATCH_SIZE = 10;
  const symbolsToResolve = Array.from(missingSymbols);
  let resolvedCount = 0;

  for (let i = 0; i < symbolsToResolve.length; i += BATCH_SIZE) {
    const batch = symbolsToResolve.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (sym) => {
      const info = allStocks.get(sym) || { symbol: sym, name: sym };
      
      // If already has domain
      let domain = domainsMap[sym] || currentCache[sym]?.domain;
      if (!domain) {
        domain = await extractDomainFromScreener(sym);
      }

      if (domain) {
        const workingLogoUrl = await verifyLogoForDomain(domain);
        if (workingLogoUrl) {
          domainsMap[sym] = domain;
          currentCache[sym] = {
            symbol: sym,
            name: info.name,
            domain,
            logoUrl: workingLogoUrl,
            verifiedAt: new Date().toISOString(),
            source: 'Web Discovery (Screener + Hunter/Unavatar/Google)'
          };
          resolvedCount++;
          console.log(`✓ RESOLVED: ${sym} -> domain: ${domain} (logo: ${workingLogoUrl})`);
        } else {
          console.log(`? DOMAIN FOUND BUT NO LOGO: ${sym} -> domain: ${domain}`);
        }
      } else {
        console.log(`✗ NO DOMAIN FOUND: ${sym} (${info.name})`);
      }
    }));
  }

  // Ensure directories exist
  fs.mkdirSync(path.dirname(DOMAINS_MAP_FILE), { recursive: true });
  fs.writeFileSync(DOMAINS_MAP_FILE, JSON.stringify(domainsMap, null, 2), 'utf8');
  fs.writeFileSync(CACHE_FILE, JSON.stringify(currentCache, null, 2), 'utf8');

  console.log(`--- RESOLUTION COMPLETE: ${resolvedCount} new stocks resolved and cached! ---`);
}

runResolution();
