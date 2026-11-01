import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db, { saveCacheSnapshotToDisk } from '../server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicit Market Cap & Sector classifications for all 66 active portfolio holdings
const ACTIVE_CLASSIFICATIONS = {
  // US Equities
  'AAPL': { mcapCategory: 'Mega Cap', mcapCr: 484921, sector: 'Consumer Electronics & Hardware' },
  'MSFT': { mcapCategory: 'Mega Cap', mcapCr: 368032, sector: 'Enterprise Cloud & Internet' },
  'NVDA': { mcapCategory: 'Mega Cap', mcapCr: 527105, sector: 'Semiconductors & Hardware' },
  'GOOG': { mcapCategory: 'Mega Cap', mcapCr: 410253, sector: 'Enterprise Cloud & Internet' },
  'AMZN': { mcapCategory: 'Mega Cap', mcapCr: 276971, sector: 'Enterprise Cloud & Internet' },
  'META': { mcapCategory: 'Mega Cap', mcapCr: 165086, sector: 'Enterprise Cloud & Internet' },
  'TSM': { mcapCategory: 'Mega Cap', mcapCr: 224699, sector: 'Semiconductors & Hardware' },
  'AVGO': { mcapCategory: 'Mega Cap', mcapCr: 172801, sector: 'Semiconductors & Hardware' },
  'CRM': { mcapCategory: 'Large Cap', mcapCr: 20387, sector: 'Enterprise Cloud & Internet' },
  'PLTR': { mcapCategory: 'Large Cap', mcapCr: 40186, sector: 'Enterprise Cloud & Internet' },
  'ANET': { mcapCategory: 'Large Cap', mcapCr: 25173, sector: 'Enterprise Cloud & Internet' },

  // Indian Equities - Large Cap
  'TVSMOTOR': { mcapCategory: 'Large Cap', mcapCr: 128000, sector: 'Automobile & Auto Components' },
  'PNB': { mcapCategory: 'Large Cap', mcapCr: 120000, sector: 'Banking' },
  'BHEL': { mcapCategory: 'Large Cap', mcapCr: 98500, sector: 'Capital Goods & Heavy Engineering' },
  'TECHM': { mcapCategory: 'Large Cap', mcapCr: 136517, sector: 'Information Technology & Software' },
  'TRENT': { mcapCategory: 'Large Cap', mcapCr: 149433, sector: 'Retail & Consumer Discretionary' },
  'ENRIN': { mcapCategory: 'Large Cap', mcapCr: 113068, sector: 'Power & Electrical Equipment' },
  'VAML': { mcapCategory: 'Large Cap', mcapCr: 164990, sector: 'Metals, Mining & Materials' },

  // Indian Equities - Mid Cap
  'ATHERENERG': { mcapCategory: 'Mid Cap', mcapCr: 65597, sector: 'Automobile & Auto Components' },
  'RADICO': { mcapCategory: 'Mid Cap', mcapCr: 58525, sector: 'Consumer Staples & FMCG' },
  'FLUOROCHEM': { mcapCategory: 'Mid Cap', mcapCr: 52434, sector: 'Chemicals & Specialty Chemicals' },
  'SONACOMS': { mcapCategory: 'Mid Cap', mcapCr: 49181, sector: 'Automobile & Auto Components' },
  'IPCALAB': { mcapCategory: 'Mid Cap', mcapCr: 46200, sector: 'Pharmaceuticals & Biotechnology' },
  'DHOOTTRANS': { mcapCategory: 'Mid Cap', mcapCr: 35360, sector: 'Automobile & Auto Components' },
  'SAILIFE': { mcapCategory: 'Mid Cap', mcapCr: 33664, sector: 'Pharmaceuticals & Biotechnology' },
  'REDINGTON': { mcapCategory: 'Mid Cap', mcapCr: 30818, sector: 'Information Technology & Software' },
  'SYRMA': { mcapCategory: 'Mid Cap', mcapCr: 30720, sector: 'Semiconductors & Hardware' },
  'HSCL': { mcapCategory: 'Mid Cap', mcapCr: 29500, sector: 'Chemicals & Specialty Chemicals' },
  'LALPATHLAB': { mcapCategory: 'Mid Cap', mcapCr: 26500, sector: 'Healthcare Services & Hospitals' },

  // Indian Equities - Small Cap
  'GABRIEL': { mcapCategory: 'Small Cap', mcapCr: 25756, sector: 'Automobile & Auto Components' },
  'SANSERA': { mcapCategory: 'Small Cap', mcapCr: 25682, sector: 'Automobile & Auto Components' },
  'TDPOWERSYS': { mcapCategory: 'Small Cap', mcapCr: 25082, sector: 'Power & Electrical Equipment' },
  'SAGILITY': { mcapCategory: 'Small Cap', mcapCr: 21160, sector: 'Information Technology & Software' },
  'INOXINDIA': { mcapCategory: 'Small Cap', mcapCr: 20389, sector: 'Capital Goods & Heavy Engineering' },
  'HBLENGINE': { mcapCategory: 'Small Cap', mcapCr: 19890, sector: 'Power & Electrical Equipment' },
  'RKFORGE': { mcapCategory: 'Small Cap', mcapCr: 18000, sector: 'Automobile & Auto Components' },
  'TBOTEK': { mcapCategory: 'Small Cap', mcapCr: 17948, sector: 'Enterprise Cloud & Internet' },
  'ECLERX': { mcapCategory: 'Small Cap', mcapCr: 17484, sector: 'Information Technology & Software' },
  'GRWRHITECH': { mcapCategory: 'Small Cap', mcapCr: 16079, sector: 'Chemicals & Specialty Chemicals' },
  'AVALON': { mcapCategory: 'Small Cap', mcapCr: 15156, sector: 'Semiconductors & Hardware' },
  'INDGN': { mcapCategory: 'Small Cap', mcapCr: 13976, sector: 'Information Technology & Software' },
  'FRACTAL': { mcapCategory: 'Small Cap', mcapCr: 13190, sector: 'Information Technology & Software' },
  'QPOWER': { mcapCategory: 'Small Cap', mcapCr: 11067, sector: 'Power & Electrical Equipment' },
  'TARIL': { mcapCategory: 'Small Cap', mcapCr: 8703, sector: 'Power & Electrical Equipment' },
  'RPEL': { mcapCategory: 'Small Cap', mcapCr: 8450, sector: 'Metals, Mining & Materials' },
  'EBGNG': { mcapCategory: 'Small Cap', mcapCr: 7776, sector: 'Consumer Electronics & Hardware' },
  'AEROFLEX': { mcapCategory: 'Small Cap', mcapCr: 6800, sector: 'Capital Goods & Heavy Engineering' },
  'FCL': { mcapCategory: 'Small Cap', mcapCr: 6725, sector: 'Chemicals & Specialty Chemicals' },
  'NEOGEN': { mcapCategory: 'Small Cap', mcapCr: 6537, sector: 'Chemicals & Specialty Chemicals' },
  'SBCL': { mcapCategory: 'Small Cap', mcapCr: 6267, sector: 'Metals, Mining & Materials' },
  'CORONA': { mcapCategory: 'Small Cap', mcapCr: 5500, sector: 'Pharmaceuticals & Biotechnology' },
  'ARTEMISMED': { mcapCategory: 'Small Cap', mcapCr: 5460, sector: 'Healthcare Services & Hospitals' },
  'LUMAXTECH': { mcapCategory: 'Small Cap', mcapCr: 5200, sector: 'Automobile & Auto Components' },
  'IGIL': { mcapCategory: 'Small Cap', mcapCr: 4200, sector: 'Gems, Jewellery & Luxury' },
  'SUDEEPPHRM': { mcapCategory: 'Small Cap', mcapCr: 3800, sector: 'Pharmaceuticals & Biotechnology' },

  // Indian Equities - Micro Cap
  'VRLLOG': { mcapCategory: 'Micro Cap', mcapCr: 4900, sector: 'Logistics & Transportation' },
  'GUFICBIO': { mcapCategory: 'Micro Cap', mcapCr: 4272, sector: 'Pharmaceuticals & Biotechnology' },
  'JASH': { mcapCategory: 'Micro Cap', mcapCr: 3240, sector: 'Capital Goods & Heavy Engineering' },
  'SOLARA': { mcapCategory: 'Micro Cap', mcapCr: 3200, sector: 'Pharmaceuticals & Biotechnology' },
  'MACPOWER': { mcapCategory: 'Micro Cap', mcapCr: 1859, sector: 'Capital Goods & Heavy Engineering' },
  'IGPL': { mcapCategory: 'Micro Cap', mcapCr: 1692, sector: 'Chemicals & Specialty Chemicals' },
  'MANAKCOAT': { mcapCategory: 'Micro Cap', mcapCr: 1373, sector: 'Metals, Mining & Materials' },
  'MMP': { mcapCategory: 'Micro Cap', mcapCr: 1207, sector: 'Metals, Mining & Materials' },
  'SHREEPUSHK': { mcapCategory: 'Micro Cap', mcapCr: 1100, sector: 'Chemicals & Specialty Chemicals' },
  'MODINATUR': { mcapCategory: 'Micro Cap', mcapCr: 450, sector: 'Consumer Staples & FMCG' },
  'SHANKESH': { mcapCategory: 'Micro Cap', mcapCr: 220, sector: 'Gems, Jewellery & Luxury' }
};

async function main() {
  console.log('[SeedMarketCaps] Starting comprehensive market cap seeding...');

  // 1. Update data/asset_metadata.json
  const metaPath = path.join(__dirname, '../data/asset_metadata.json');
  let metaList = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

  const metaMap = new Map();
  metaList.forEach((item, idx) => {
    metaMap.set(item.symbol.toUpperCase(), idx);
  });

  let metaUpdatedCount = 0;
  for (const [sym, info] of Object.entries(ACTIVE_CLASSIFICATIONS)) {
    const idx = metaMap.get(sym);
    if (idx !== undefined) {
      metaList[idx].mcap_category = info.mcapCategory;
      metaList[idx].market_cap = info.mcapCr;
      metaList[idx].sector = info.sector;
      metaList[idx].capitalisation = info.mcapCategory;
      metaUpdatedCount++;
    } else {
      // Add new entry to asset_metadata.json
      metaList.push({
        symbol: sym,
        name: sym,
        category_id: ['AAPL', 'MSFT', 'NVDA', 'GOOG', 'AMZN', 'META', 'TSM', 'AVGO', 'CRM', 'PLTR', 'ANET'].includes(sym) ? 'us_stocks' : 'in_stocks',
        market_cap: info.mcapCr,
        mcap_category: info.mcapCategory,
        capitalisation: info.mcapCategory,
        sector: info.sector,
        industry: info.sector,
        exchange: ['AAPL', 'MSFT', 'NVDA', 'GOOG', 'AMZN', 'META', 'TSM', 'AVGO', 'CRM', 'PLTR', 'ANET'].includes(sym) ? 'NASDAQ' : 'NSE'
      });
      metaUpdatedCount++;
    }
  }

  // Ensure all other items in asset_metadata have a valid mcap_category derived from market_cap
  metaList.forEach(m => {
    if (!m.mcap_category && m.market_cap) {
      const cr = Number(m.market_cap);
      if (cr >= 500000) m.mcap_category = 'Mega Cap';
      else if (cr >= 85000) m.mcap_category = 'Large Cap';
      else if (cr >= 27500) m.mcap_category = 'Mid Cap';
      else if (cr >= 5000) m.mcap_category = 'Small Cap';
      else m.mcap_category = 'Micro Cap';
    } else if (!m.mcap_category) {
      m.mcap_category = 'Small Cap';
    }
  });

  fs.writeFileSync(metaPath, JSON.stringify(metaList, null, 2), 'utf8');
  console.log(`[SeedMarketCaps] Updated ${metaUpdatedCount} entries in asset_metadata.json`);

  // 2. Update database holdings and db_cache_snapshot.json
  const holdings = await db.select('holdings');
  console.log(`[SeedMarketCaps] Found ${holdings.length} total holdings in database.`);

  let holdingsUpdatedCount = 0;
  for (const h of holdings) {
    if (!['in_stocks', 'us_stocks'].includes(h.category_id)) continue;
    const clean = (h.symbol || '').replace(/\.(NS|BO)$/i, '').trim().toUpperCase();
    const info = ACTIVE_CLASSIFICATIONS[clean] || ACTIVE_CLASSIFICATIONS[h.symbol?.toUpperCase()];
    
    if (info) {
      await db.update('holdings', h.id, {
        market_cap: info.mcapCategory,
        sector: info.sector
      });
      holdingsUpdatedCount++;
    }
  }

  console.log(`[SeedMarketCaps] Successfully updated ${holdingsUpdatedCount} active holdings in db cache.`);

  // 3. Persist cache snapshot to disk
  saveCacheSnapshotToDisk();
  console.log('[SeedMarketCaps] Cache snapshot persisted to data/db_cache_snapshot.json.');

  console.log('[SeedMarketCaps] ALL DONE SUCCESSFULLY!');
  process.exit(0);
}

main().catch(err => {
  console.error('[SeedMarketCaps] Fatal error:', err);
  process.exit(1);
});
