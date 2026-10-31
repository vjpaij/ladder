import fs from 'node:fs';
import path from 'node:path';

const DOMAINS_MAP_FILE = 'src/data/stockDomainsMap.json';
const DOMAINS_JS_FILE = 'src/data/stockDomainsMap.js';

function cleanSym(s) {
  return String(s || '').toUpperCase().replace(/\.(NS|BO|BSE|NSE)$/i, '').replace(/[^A-Z0-9]/g, '').trim();
}

async function getDomainFromScreener(sym) {
  const clean = cleanSym(sym);
  if (!clean) return null;

  const urls = [
    `https://www.screener.in/company/${clean}/consolidated/`,
    `https://www.screener.in/company/${clean}/`
  ];

  for (const u of urls) {
    try {
      const res = await fetch(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const html = await res.text();
        const m = html.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>\s*<i class="icon-link"/i)
          || html.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>\s*Website/i)
          || html.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*title="Company website"/i)
          || html.match(/<i class="icon-link"><\/i>\s*<span[^>]*>([^<]+)<\/span>/i);
        if (m) {
          const raw = (m[1] || m[2]).replace(/^https?:\/\/(www\.)?/, '').split('/')[0].trim().toLowerCase();
          if (raw && !raw.includes('screener.in') && !raw.includes('bseindia') && !raw.includes('nseindia')) {
            return raw;
          }
        }
      }
    } catch {}
  }

  // Screener search API fallback
  try {
    const sRes = await fetch(`https://www.screener.in/api/company/search/?q=${encodeURIComponent(clean)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(4000)
    });
    if (sRes.ok) {
      const results = await sRes.json();
      const match = results.find(r => r.url && (r.url.includes(`/${clean}/`) || r.name.toUpperCase().includes(clean))) || results[0];
      if (match?.url) {
        const pRes = await fetch(`https://www.screener.in${match.url}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal: AbortSignal.timeout(4000)
        });
        if (pRes.ok) {
          const html = await pRes.text();
          const m = html.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>\s*<i class="icon-link"/i)
            || html.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>\s*Website/i)
            || html.match(/<i class="icon-link"><\/i>\s*<span[^>]*>([^<]+)<\/span>/i);
          if (m) {
            const raw = (m[1] || m[2]).replace(/^https?:\/\/(www\.)?/, '').split('/')[0].trim().toLowerCase();
            if (raw && !raw.includes('screener.in') && !raw.includes('bseindia') && !raw.includes('nseindia')) {
              return raw;
            }
          }
        }
      }
    }
  } catch {}

  return null;
}

async function verifyHunter(domain) {
  if (!domain) return false;
  try {
    const res = await fetch(`https://logos.hunter.io/${domain}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const snap = JSON.parse(fs.readFileSync('data/db_cache_snapshot.json', 'utf8'));
  const holdings = snap.tables.holdings.data.filter(h => h.category_id === 'in_stocks');
  let currentDomains = {};
  if (fs.existsSync(DOMAINS_MAP_FILE)) {
    try { currentDomains = JSON.parse(fs.readFileSync(DOMAINS_MAP_FILE, 'utf8')); } catch {}
  }

  // Pre-seed known 35 active domains
  const knownActive = {
    INOXINDIA: 'inoxcva.com',
    SONACOMS: 'sonacomstar.com',
    QPOWER: 'qualitypower.com',
    IGPL: 'igpetro.com',
    AVALON: 'avalontec.com',
    JASH: 'jashindia.com',
    RPEL: 'rammingmass.com',
    MACPOWER: 'macpowercnc.com',
    GRWRHITECH: 'garwarehitechfilms.com',
    TBOTEK: 'tbo.com',
    DHOOTTRANS: 'dhoottransmission.com',
    VAML: 'vedantaaluminium.com',
    TDPOWERSYS: 'tdps.co.in',
    NEOGEN: 'neogenchem.com',
    SBCL: 'shivalikbimetals.com',
    ECLERX: 'eclerx.com',
    SYRMA: 'syrmasgs.com',
    TARIL: 'transformerindia.com',
    HBLENGINE: 'hbl.in',
    FRACTAL: 'fractal.ai',
    FCL: 'fineotex.com',
    ENRIN: 'siemens-energy-india.com',
    SAGILITY: 'sagilityhealth.com',
    EBGNG: 'electronicsbazaar.com',
    FLUOROCHEM: 'gfl.co.in',
    MMP: 'mmpil.com',
    BHEL: 'bhel.com',
    IGIL: 'igi.org',
    SOLARA: 'solara.co.in',
    LUMAXTECH: 'lumaxautotech.com',
    SHREEPUSHK: 'shreepushkar.com',
    SUDEEPPHRM: 'sudeeppharma.com',
    TVSMOTOR: 'tvsmotor.com',
    AEROFLEX: 'aeroflexindia.com',
    RKFORGE: 'ramkrishnaforgings.com'
  };

  for (const [k, v] of Object.entries(knownActive)) {
    currentDomains[k] = v;
  }

  const unmapped = [];
  for (const h of holdings) {
    const sym = cleanSym(h.symbol);
    if (!currentDomains[sym]) {
      unmapped.push({ symbol: sym, name: h.name, status: h.status });
    }
  }

  console.log(`Starting domain discovery for ${unmapped.length} unmapped Indian stocks (total stocks: ${holdings.length})...`);

  const BATCH_SIZE = 8;
  let newlyResolved = 0;

  for (let i = 0; i < unmapped.length; i += BATCH_SIZE) {
    const batch = unmapped.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (item) => {
      const domain = await getDomainFromScreener(item.symbol);
      if (domain) {
        currentDomains[item.symbol] = domain;
        newlyResolved++;
        const works = await verifyHunter(domain);
        console.log(`✓ [${item.status}] ${item.symbol.padEnd(14)} => ${domain} (Hunter: ${works ? '200 OK' : 'No Hunter'})`);
      } else {
        console.log(`✗ [${item.status}] ${item.symbol.padEnd(14)} => NO DOMAIN`);
      }
    }));

    // Periodically save
    fs.writeFileSync(DOMAINS_MAP_FILE, JSON.stringify(currentDomains, null, 2), 'utf8');
    fs.writeFileSync(DOMAINS_JS_FILE, `// Generated corporate domain registry for Indian & Global Equities\nexport default ${JSON.stringify(currentDomains, null, 2)};\n`, 'utf8');
  }

  console.log(`--- FINISHED: Resolved ${newlyResolved} new domains! Total mapped: ${Object.keys(currentDomains).length} ---`);
}

main();
