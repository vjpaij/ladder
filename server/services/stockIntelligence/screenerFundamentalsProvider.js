import fs from 'node:fs';
import path from 'node:path';

const CACHE_DIR = path.join(process.cwd(), 'data', 'screener_cache');
const METADATA_FILE = path.join(process.cwd(), 'data', 'asset_metadata.json');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days TTL

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cleanSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
}

function getCachedFundamentals(sym) {
  const clean = cleanSymbol(sym);
  const cachePath = path.join(CACHE_DIR, `${clean}.json`);
  if (fs.existsSync(cachePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const age = Date.now() - (data.fetchedAt ? new Date(data.fetchedAt).getTime() : 0);
      if (age < CACHE_TTL_MS) {
        return { ...data, fromCache: true };
      }
    } catch {
      // ignore parse error and re-fetch
    }
  }
  return null;
}

function saveCachedFundamentals(sym, payload) {
  ensureCacheDir();
  const clean = cleanSymbol(sym);
  const cachePath = path.join(CACHE_DIR, `${clean}.json`);
  const enriched = {
    ...payload,
    symbol: clean,
    fetchedAt: new Date().toISOString()
  };
  fs.writeFileSync(cachePath, JSON.stringify(enriched, null, 2), 'utf8');
  return enriched;
}

function loadAssetMetadata() {
  try {
    if (fs.existsSync(METADATA_FILE)) {
      const rows = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
      const map = new Map();
      rows.forEach(r => {
        if (r.symbol) map.set(cleanSymbol(r.symbol), r);
      });
      return map;
    }
  } catch {
    // fallback map
  }
  return new Map();
}

/**
 * Fetch fundamentals for a single company from Screener.in with fallback to asset_metadata
 */
export async function fetchCompanyFundamentals(symbol, { forceRefresh = false } = {}) {
  const clean = cleanSymbol(symbol);
  if (!clean) return { status: 'UNAVAILABLE', symbol: clean, reason: 'Invalid symbol' };

  if (!forceRefresh) {
    const cached = getCachedFundamentals(clean);
    if (cached) return cached;
  }

  const metaMap = loadAssetMetadata();
  const fallbackMeta = metaMap.get(clean) || {};

  try {
    const searchUrl = `https://www.screener.in/api/company/search/?q=${encodeURIComponent(clean)}`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(6000)
    });

    if (!searchRes.ok) {
      throw new Error(`Screener search responded with HTTP ${searchRes.status}`);
    }

    const searchData = await searchRes.json();
    const match = searchData.find(item => item.url && (item.url.includes(`/${clean}/`) || item.name.toUpperCase().includes(clean))) || searchData[0];

    if (!match || !match.url) {
      throw new Error(`No match found on Screener for ${clean}`);
    }

    const pageRes = await fetch(`https://www.screener.in${match.url}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(8000)
    });

    if (!pageRes.ok) {
      throw new Error(`Screener company page responded with HTTP ${pageRes.status}`);
    }

    const html = await pageRes.text();

    // 1. Parse Quarters Table
    const quartersMatch = html.match(/id=["']quarters["'][\s\S]*?<\/table>/);
    const quarterLabels = [];
    const quarterRows = {};

    if (quartersMatch) {
      const table = quartersMatch[0];
      const theadMatch = table.match(/<thead>[\s\S]*?<\/thead>/);
      if (theadMatch) {
        const ths = theadMatch[0].match(/<th[^>]*>([\s\S]*?)<\/th>/g) || [];
        for (const th of ths.slice(1)) {
          const q = th.replace(/<[^>]+>/g, '').trim();
          if (q) quarterLabels.push(q);
        }
      }

      const trs = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
      for (const tr of trs) {
        const text = tr.replace(/<[^>]+>/g, '|').split('|').map(s => s.trim()).filter(Boolean);
        if (text.length >= 2) {
          const rawKey = text[0].replace(/&nbsp;/g, ' ').replace(/\+/g, '').trim();
          const cleanKey = rawKey.split(' ')[0] === 'Sales' ? 'Sales' :
                           rawKey.split(' ')[0] === 'Net' && rawKey.includes('Profit') ? 'Net Profit' : rawKey;
          const values = text.slice(1)
            .filter(v => v !== '+')
            .map(v => Number(v.replace(/,/g, '').replace(/%/g, '')) || 0);
          quarterRows[cleanKey] = values;
        }
      }
    }

    // 1b. Parse Annual Profit & Loss Table
    const plMatch = html.match(/id=["']profit-loss["'][\s\S]*?<\/table>/);
    let annualSales = [];
    let annualPat = [];
    let annualEps = [];

    if (plMatch) {
      const plTable = plMatch[0];
      const trs = plTable.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
      for (const tr of trs) {
        const text = tr.replace(/<[^>]+>/g, '|').split('|').map(s => s.trim()).filter(Boolean);
        if (text.length >= 2) {
          const rawKey = text[0].replace(/&nbsp;/g, ' ').replace(/\+/g, '').trim();
          const cleanKey = rawKey.split(' ')[0] === 'Sales' ? 'Sales' :
                           rawKey.split(' ')[0] === 'Net' && rawKey.includes('Profit') ? 'Net Profit' :
                           rawKey.includes('EPS') ? 'EPS' : rawKey;
          const values = text.slice(1)
            .filter(v => v !== '+')
            .map(v => Number(v.replace(/,/g, '').replace(/%/g, '')) || 0);
          if (cleanKey === 'Sales') annualSales = values;
          if (cleanKey === 'Net Profit') annualPat = values;
          if (cleanKey === 'EPS') annualEps = values;
        }
      }
    }

    // 2. Parse Shareholding Table
    const shMatch = html.match(/id=["']shareholding["'][\s\S]*?<\/table>/);
    let promoterHoldingPct = null;
    let promoterHoldingQoQDelta = null;
    let promoterPledgePct = null;
    let promoterPledgeKnown = false;
    let fiiHoldingPct = null;
    let fiiHoldingQoQDelta = null;

    if (shMatch) {
      const shTrs = shMatch[0].match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
      for (const tr of shTrs) {
        const text = tr.replace(/<[^>]+>/g, '|').split('|').map(s => s.trim()).filter(Boolean);
        if (text.length >= 2) {
          const rawKey = text[0].replace(/&nbsp;/g, ' ').replace(/\+/g, '').trim();
          const vals = text.slice(1).filter(v => v !== '+').map(v => Number(v.replace(/,/g, '').replace(/%/g, '')) || 0);
          if (/promoter/i.test(rawKey)) {
            if (vals.length > 0) promoterHoldingPct = vals[vals.length - 1];
            if (vals.length >= 2) promoterHoldingQoQDelta = Number((vals[vals.length - 1] - vals[vals.length - 2]).toFixed(2));
          }
          if (/fii/i.test(rawKey)) {
            if (vals.length > 0) fiiHoldingPct = vals[vals.length - 1];
            if (vals.length >= 2) fiiHoldingQoQDelta = Number((vals[vals.length - 1] - vals[vals.length - 2]).toFixed(2));
          }
          if (/pledge/i.test(rawKey)) {
            if (vals.length > 0) {
              promoterPledgePct = vals[vals.length - 1];
              promoterPledgeKnown = true;
            }
          }
        }
      }
    }

    // 3. Parse Top Ratios
    const ratios = {};
    const ratioItems = html.match(/<li[^>]*class=["'][^"']*flex[^"']*["'][^>]*>[\s\S]*?<\/li>/g) || [];
    for (const item of ratioItems) {
      const nameMatch = item.match(/class=["']name["'][^>]*>([\s\S]*?)<\/span>/);
      const valueMatch = item.match(/class=["']number["'][^>]*>([\s\S]*?)<\/span>/);
      if (nameMatch && valueMatch) {
        const name = nameMatch[1].replace(/<[^>]+>/g, '').trim();
        const val = Number(valueMatch[1].replace(/<[^>]+>/g, '').replace(/,/g, '')) || 0;
        ratios[name] = val;
      }
    }

    // 4. Parse Documents / Corporate Announcements (filings, results, board meetings)
    const docMatch = html.match(/<div[^>]*id=["']documents["'][\s\S]*?<\/section>/i) ||
                     html.match(/<section[^>]*id=["']documents["'][\s\S]*?<\/section>/i);
    let lastResultDate = null;
    let lastResultTitle = null;
    let upcomingBoardMeetingDate = null;
    const recentFilings = [];
    const monthMap = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };

    if (docMatch) {
      const items = docMatch[0].match(/<li[^>]*>[\s\S]*?<\/li>/gi) || [];
      for (const item of items) {
        const cleanItem = item.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (/financial result|board meeting|ufr|afr|outcome of board/i.test(cleanItem)) {
          if (recentFilings.length < 5) recentFilings.push(cleanItem);

          if (!lastResultDate && /financial result|ufr|afr|outcome of board/i.test(cleanItem)) {
            const dateMatch = cleanItem.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
            if (dateMatch) {
              const day = dateMatch[1].padStart(2, '0');
              const month = monthMap[dateMatch[2].toLowerCase()];
              const yearMatch = cleanItem.match(/202\d/) || (quarterLabels[quarterLabels.length - 1] || '').match(/202\d/);
              const year = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();
              lastResultDate = `${year}-${month}-${day}`;
              lastResultTitle = cleanItem;
            }
          }

          if (!upcomingBoardMeetingDate && /board meeting intimation|notice of board meeting/i.test(cleanItem)) {
            const dateMatch = cleanItem.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
            if (dateMatch) {
              const day = dateMatch[1].padStart(2, '0');
              const month = monthMap[dateMatch[2].toLowerCase()];
              const yearMatch = cleanItem.match(/202\d/) || new Date().getFullYear().toString();
              upcomingBoardMeetingDate = `${yearMatch}-${month}-${day}`;
            }
          }
        }
      }
    }

    // Calculate derived growth & margin metrics
    const salesArr = quarterRows['Sales'] || [];
    const opmArr = quarterRows['OPM %'] || [];
    const patArr = quarterRows['Net Profit'] || [];

    const latestQuarter = quarterLabels[quarterLabels.length - 1] || null;
    const latestSales = salesArr.length ? salesArr[salesArr.length - 1] : null;
    const latestOpm = opmArr.length ? opmArr[opmArr.length - 1] : null;
    const latestPat = patArr.length ? patArr[patArr.length - 1] : null;

    // YoY comparison (comparing quarter T with quarter T-4)
    let yoySalesGrowthPct = null;
    let yoyPatGrowthPct = null;
    let opmDeltaBps = null;
    let opmTrendDirection = 'STABLE';

    if (salesArr.length >= 5) {
      const priorSales = salesArr[salesArr.length - 5];
      if (priorSales > 0 && latestSales !== null) {
        yoySalesGrowthPct = Number(((latestSales / priorSales - 1) * 100).toFixed(2));
      }
    }

    if (patArr.length >= 5) {
      const priorPat = patArr[patArr.length - 5];
      if (priorPat !== 0 && latestPat !== null) {
        yoyPatGrowthPct = Number(((latestPat - priorPat) / Math.abs(priorPat) * 100).toFixed(2));
      }
    }

    if (opmArr.length >= 5) {
      const priorOpm = opmArr[opmArr.length - 5];
      if (latestOpm !== null) {
        opmDeltaBps = Number(((latestOpm - priorOpm) * 100).toFixed(0)); // 1% = 100 bps
        if (opmDeltaBps > 150) opmTrendDirection = 'EXPANDING';
        else if (opmDeltaBps < -250) opmTrendDirection = 'CONTRACTING';
        else opmTrendDirection = 'STABLE';
      }
    }

    // Recent 4-quarter OPM history for sparkline
    const opmHistory = opmArr.slice(-4).map((val, idx) => ({
      quarter: quarterLabels[quarterLabels.length - 4 + idx] || `Q${idx + 1}`,
      opm: val
    }));

    // Consecutive EPS growth years
    let epsConsecutiveGrowthYears = 0;
    if (annualEps.length >= 2) {
      for (let i = annualEps.length - 1; i > 0; i--) {
        if (annualEps[i] > annualEps[i - 1]) epsConsecutiveGrowthYears++;
        else break;
      }
    }

    const result = {
      status: 'AVAILABLE',
      source: 'Screener.in (Consolidated)',
      screenerUrl: `https://www.screener.in${match.url}`,
      symbol: clean,
      name: match.name || clean,
      sector: fallbackMeta.sector || null,
      industry: fallbackMeta.industry || null,
      marketCapCr: ratios['Market Cap'] || fallbackMeta.market_cap || null,
      peRatio: ratios['Stock P/E'] || null,
      rocePct: ratios['ROCE'] || null,
      roePct: ratios['ROE'] || null,
      dividendYieldPct: ratios['Dividend Yield'] || null,
      latestQuarter,
      latestSalesCr: latestSales,
      latestPatCr: latestPat,
      latestOpmPct: latestOpm,
      yoySalesGrowthPct,
      yoyPatGrowthPct,
      opmDeltaBps,
      opmTrendDirection,
      opmHistory,
      promoterHoldingPct,
      promoterHoldingQoQDelta,
      promoterPledgePct,
      promoterPledgeKnown,
      fiiHoldingPct,
      fiiHoldingQoQDelta,
      annualSales,
      annualPat,
      annualEps,
      quarterlySales: salesArr,
      quarterlyPat: patArr,
      quarterRows,
      epsConsecutiveGrowthYears,
      debtToEquity: ratios['Debt to Equity'] ?? null,
      lastResultDate,
      lastResultTitle,
      upcomingBoardMeetingDate,
      recentFilings,
      observations: [
        { label: 'Latest Quarter', value: latestQuarter || 'N/A' },
        { label: 'Operating Margin (OPM)', value: latestOpm !== null ? `${latestOpm}% (${opmTrendDirection.toLowerCase()})` : 'N/A' },
        { label: 'YoY Profit Growth', value: yoyPatGrowthPct !== null ? `${yoyPatGrowthPct >= 0 ? '+' : ''}${yoyPatGrowthPct}%` : 'N/A' },
        { label: 'YoY Sales Growth', value: yoySalesGrowthPct !== null ? `${yoySalesGrowthPct >= 0 ? '+' : ''}${yoySalesGrowthPct}%` : 'N/A' },
        { label: 'Promoter Pledging', value: promoterPledgeKnown ? `${promoterPledgePct}%` : 'Unknown' }
      ]
    };

    return saveCachedFundamentals(clean, result);
  } catch (err) {
    // Graceful fallback to cached disk file or asset_metadata
    const existingCache = getCachedFundamentals(clean);
    if (existingCache) return existingCache;

    const fallback = {
      status: 'METADATA_FALLBACK',
      source: 'Internal Asset Metadata',
      screenerUrl: `https://www.screener.in/search/?q=${encodeURIComponent(clean)}`,
      symbol: clean,
      name: fallbackMeta.name || clean,
      sector: fallbackMeta.sector || null,
      industry: fallbackMeta.industry || null,
      marketCapCr: fallbackMeta.market_cap || null,
      peRatio: null,
      rocePct: null,
      roePct: null,
      dividendYieldPct: null,
      latestQuarter: null,
      latestSalesCr: null,
      latestPatCr: null,
      latestOpmPct: null,
      yoySalesGrowthPct: null,
      yoyPatGrowthPct: null,
      opmDeltaBps: null,
      opmTrendDirection: 'UNKNOWN',
      opmHistory: [],
      promoterHoldingPct: null,
      promoterPledgePct: null,
      promoterPledgeKnown: false,
      debtToEquity: null,
      observations: [
        { label: 'Metadata Source', value: 'Offline Fallback' },
        { label: 'Sector', value: fallbackMeta.sector || 'Unknown' },
        { label: 'Industry', value: fallbackMeta.industry || 'Unknown' }
      ]
    };
    return fallback;
  }
}

/**
 * Batch preload fundamentals for all active holdings
 */
export async function preloadAllHeldFundamentals(holdings = []) {
  const indianStocks = holdings.filter(h => h.category_id === 'in_stocks' && Number(h.quantity) > 0);
  const symbols = [...new Set(indianStocks.map(h => cleanSymbol(h.symbol)).filter(Boolean))];

  const results = {};
  for (const sym of symbols) {
    try {
      results[sym] = await fetchCompanyFundamentals(sym);
      // Brief polite throttle for uncached network requests
      if (!results[sym].fromCache) {
        await new Promise(r => setTimeout(r, 600));
      }
    } catch {
      // ignore individual failure
    }
  }
  return results;
}
