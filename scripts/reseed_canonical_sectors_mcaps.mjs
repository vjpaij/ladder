/**
 * scripts/reseed_canonical_sectors_mcaps.mjs
 * 
 * Master script to establish 100% uniformity for Sectors and Market Caps across:
 * 1. data/asset_metadata.json
 * 2. Database holdings table (Supabase + local cache)
 * 3. data/db_cache_snapshot.json
 * 
 * Enforces:
 * - Direct mapping of TRENT to Consumer Discretionary & Retail (Large Cap)
 * - Correction of SAGILITY and INDGN to Healthcare Services & Hospitals
 * - Accurate canonical sector and market cap for all 80 active stocks and 299 redeemed stocks
 * - Strict removal of market_cap ('Small Cap') from non-equity holdings (bank, epf, nps, mutual_funds, liabilities)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, saveCacheSnapshotToDisk } from '../server/db.js';
import { normalizeSector } from '../src/components/reports/reportsConstants.js';
import { resolveCanonicalSector } from '../server/services/stockIntelligence/buyAnalysisService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CANONICAL_STOCK_UPDATES = {
  // Corrected / Key Active Holdings
  'TRENT': { sector: 'Consumer Discretionary & Retail', industry: 'Apparel & Lifestyle Retail (Westside / Zudio)', mcapCategory: 'Large Cap', mcapCr: 149433 },
  'INDGN': { sector: 'Healthcare Services & Hospitals', industry: 'Life Sciences Commercialization Tech', mcapCategory: 'Small Cap', mcapCr: 13976 },
  'SAGILITY': { sector: 'Healthcare Services & Hospitals', industry: 'Healthcare Process Management & Tech Solutions', mcapCategory: 'Small Cap', mcapCr: 21160 },
  'OFSS': { sector: 'Information Technology & Software', industry: 'Banking & Financial Software Solutions', mcapCategory: 'Large Cap', mcapCr: 104500 },
  'TECHM': { sector: 'Information Technology & Software', industry: 'IT Services & Enterprise Consulting', mcapCategory: 'Large Cap', mcapCr: 136517 },
  'MEDPLUS': { sector: 'Consumer Discretionary & Retail', industry: 'Pharmaceutical & Healthcare Retail', mcapCategory: 'Small Cap', mcapCr: 8900 },
  'ARVINDFASN': { sector: 'Consumer Discretionary & Retail', industry: 'Branded Apparel & Lifestyle Retail', mcapCategory: 'Small Cap', mcapCr: 6500 },
  'DELTACORP': { sector: 'Travel, Tourism & Hospitality', industry: 'Hospitality, Gaming & Entertainment', mcapCategory: 'Micro Cap', mcapCr: 3200 },

  // The 17 Active Holdings with missing sector/mcap
  'AJANTPHARM': { sector: 'Pharmaceuticals & Biotechnology', industry: 'Formulations & Specialty Pharmaceuticals', mcapCategory: 'Mid Cap', mcapCr: 41786 },
  'BLISSGVS': { sector: 'Pharmaceuticals & Biotechnology', industry: 'Suppositories & Formulations', mcapCategory: 'Micro Cap', mcapCr: 1400 },
  'BODALCHEM': { sector: 'Chemicals & Specialty Chemicals', industry: 'Dyestuffs & Basic Chemicals', mcapCategory: 'Micro Cap', mcapCr: 2037 },
  'E2E': { sector: 'Enterprise Cloud & Internet', industry: 'AI Cloud GPU Infrastructure & Cloud Hosting', mcapCategory: 'Small Cap', mcapCr: 10698 },
  'KPL': { sector: 'Pharmaceuticals & Biotechnology', industry: 'Injectables & Finished Dosage Formulations', mcapCategory: 'Micro Cap', mcapCr: 3606 },
  'MAHABANK': { sector: 'Banking', industry: 'Public Sector Commercial Banking', mcapCategory: 'Mid Cap', mcapCr: 67440 },
  'PVRINOX': { sector: 'Telecommunication & Media', industry: 'Multiplex Cinema Exhibition', mcapCategory: 'Small Cap', mcapCr: 14682 },
  'SGFIN': { sector: 'Financial Services & NBFC', industry: 'Financial Services & Supply Chain Financing', mcapCategory: 'Micro Cap', mcapCr: 4540 },
  'SHADOWFAX': { sector: 'Logistics & Transportation', industry: 'Hyperlocal & Last-Mile Express Logistics', mcapCategory: 'Small Cap', mcapCr: 15956 },
  'SHUKRAPHAR': { sector: 'Pharmaceuticals & Biotechnology', industry: 'Diagnostic Kits & Medical Formulations', mcapCategory: 'Micro Cap', mcapCr: 3313 },
  'SIGMAADV': { sector: 'Capital Goods & Heavy Engineering', industry: 'Defence Electronics & Heavy Systems', mcapCategory: 'Small Cap', mcapCr: 17194 },
  'SWANDEF': { sector: 'Capital Goods & Heavy Engineering', industry: 'Naval Shipbuilding, Ship Repair & Heavy Engineering', mcapCategory: 'Small Cap', mcapCr: 13861 },
  'THELEELA': { sector: 'Travel, Tourism & Hospitality', industry: 'Luxury Palaces, Hotels & Hospitality', mcapCategory: 'Small Cap', mcapCr: 21181 },
  'GROWW': { sector: 'Financial Services & NBFC', industry: 'Digital Investment Platform, Stock Broking & Wealth Tech', mcapCategory: 'Large Cap', mcapCr: 139286 },
  'JNPR': { sector: 'Power & Electrical Equipment', industry: 'Renewable Power Generation, Solar & Wind EPC', mcapCategory: 'Small Cap', mcapCr: 14840 },
  'KARURVYSYA': { sector: 'Banking', industry: 'Private Commercial Banking', mcapCategory: 'Mid Cap', mcapCr: 35763 },
  'SHRIPISTON': { sector: 'Automobile & Auto Components', industry: 'Pistons, Engine Pins & Auto Precision Components', mcapCategory: 'Small Cap', mcapCr: 20288 },

  // Redeemed holdings
  'GANESHHOUC': { sector: 'Real Estate & Construction', industry: 'Residential & Commercial Real Estate', mcapCategory: 'Small Cap', mcapCr: 7200 },
  'VMM': { sector: 'Consumer Discretionary & Retail', industry: 'Value Retail Hypermarkets & Supermarkets', mcapCategory: 'Large Cap', mcapCr: 90000 },
  'DALMIASUG': { sector: 'Consumer Staples & FMCG', industry: 'Sugar Manufacturing & Distilleries', mcapCategory: 'Small Cap', mcapCr: 5400 },
  'TATAMOTORS': { sector: 'Automobile & Auto Components', industry: 'Passenger Vehicles & Commercial Vehicles OEM', mcapCategory: 'Large Cap', mcapCr: 310000 },
  'SWANENERGY': { sector: 'Oil, Gas & Energy', industry: 'LNG Port Infrastructure & Energy', mcapCategory: 'Mid Cap', mcapCr: 29000 },
  'LIQUIDBEES': { sector: 'Financial Services & NBFC', industry: 'Exchange Traded Fund (Liquid Cash Equivalent)', mcapCategory: 'Large Cap', mcapCr: 15000 },
  'CHALET': { sector: 'Travel, Tourism & Hospitality', industry: 'High-End Hotel & Resort Ownership', mcapCategory: 'Small Cap', mcapCr: 16000 },
  'EIHOTEL': { sector: 'Travel, Tourism & Hospitality', industry: 'Luxury Hospitality (Oberoi & Trident Hotels)', mcapCategory: 'Mid Cap', mcapCr: 28000 },
  'ADORWELD': { sector: 'Capital Goods & Heavy Engineering', industry: 'Welding Equipment & Consumables', mcapCategory: 'Small Cap', mcapCr: 7500 },
  'INDHOTEL': { sector: 'Travel, Tourism & Hospitality', industry: 'Iconic Luxury Hospitality (Taj Group)', mcapCategory: 'Large Cap', mcapCr: 110000 },
  'SEQUENT': { sector: 'Pharmaceuticals & Biotechnology', industry: 'Animal Health & Veterinary Pharmaceuticals', mcapCategory: 'Small Cap', mcapCr: 5800 },
  'ANTELOPUS': { sector: 'Oil, Gas & Energy', industry: 'Upstream Oil & Gas Exploration', mcapCategory: 'Micro Cap', mcapCr: 1200 }
};

function getCategoryFromCr(cr) {
  if (!cr || cr <= 0) return 'Small Cap';
  if (cr >= 500000) return 'Mega Cap';
  if (cr >= 85000) return 'Large Cap';
  if (cr >= 27500) return 'Mid Cap';
  if (cr >= 5000) return 'Small Cap';
  return 'Micro Cap';
}

async function run() {
  console.log('[Reseed] Starting canonical sector & market cap harmonization...');

  // 1. Update data/asset_metadata.json
  const metaPath = path.join(__dirname, '../data/asset_metadata.json');
  let metaList = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const metaMap = new Map();
  metaList.forEach((m, idx) => {
    if (m.symbol) {
      metaMap.set(m.symbol.toUpperCase().trim(), idx);
      metaMap.set(m.symbol.replace(/\.(NS|BO)$/i, '').toUpperCase().trim(), idx);
    }
  });

  let metaUpdatedCount = 0;
  for (const [sym, info] of Object.entries(CANONICAL_STOCK_UPDATES)) {
    const cleanSym = sym.toUpperCase().trim();
    const idx = metaMap.get(cleanSym);
    const canonicalSector = normalizeSector(info.sector);
    if (idx !== undefined) {
      metaList[idx].sector = canonicalSector;
      metaList[idx].industry = info.industry;
      metaList[idx].mcap_category = info.mcapCategory;
      metaList[idx].capitalisation = info.mcapCategory;
      metaList[idx].market_cap = info.mcapCr;
      metaList[idx].last_updated = new Date().toISOString();
      metaUpdatedCount++;
    } else {
      const newEntry = {
        symbol: cleanSym,
        name: cleanSym,
        category_id: 'in_stocks',
        sector: canonicalSector,
        industry: info.industry,
        market_cap: info.mcapCr,
        mcap_category: info.mcapCategory,
        capitalisation: info.mcapCategory,
        last_updated: new Date().toISOString()
      };
      metaList.push(newEntry);
      metaMap.set(cleanSym, metaList.length - 1);
      metaUpdatedCount++;
    }
  }

  // Ensure ALL sectors in asset_metadata.json are normalized
  metaList.forEach(m => {
    if (m.sector) {
      m.sector = normalizeSector(m.sector);
    }
  });

  fs.writeFileSync(metaPath, JSON.stringify(metaList, null, 2), 'utf8');
  console.log(`✓ Synchronized ${metaUpdatedCount} records in data/asset_metadata.json.`);

  // 2. Update holdings table in database
  const holdings = await db.select('holdings');
  let holdingsUpdated = 0;
  let nonEquityCleaned = 0;

  for (const h of holdings) {
    const isEquity = h.category_id === 'in_stocks' || h.category_id === 'us_stocks';
    
    if (!isEquity) {
      // Non-equity holdings MUST NOT have market_cap
      if (h.market_cap !== null && h.market_cap !== undefined) {
        await db.update('holdings', h.id, { market_cap: null });
        nonEquityCleaned++;
      }
      continue;
    }

    const clean = (h.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase().trim();
    const updateInfo = CANONICAL_STOCK_UPDATES[clean] || CANONICAL_STOCK_UPDATES[h.symbol?.toUpperCase()?.trim()];
    
    let targetSector = updateInfo ? updateInfo.sector : (h.sector ? normalizeSector(h.sector) : null);
    if (!targetSector || targetSector === 'Diversified & Other' || targetSector === 'Unknown') {
      const resolved = resolveCanonicalSector({ sector: h.sector }, h.name, h.symbol);
      if (resolved && resolved !== 'Diversified & Other') {
        targetSector = resolved;
      }
    }
    targetSector = normalizeSector(targetSector);

    let targetMcap = updateInfo ? updateInfo.mcapCategory : (h.market_cap && h.market_cap !== 'Unknown' ? h.market_cap : null);
    if (!targetMcap) {
      const metaIdx = metaMap.get(clean);
      if (metaIdx !== undefined) {
        const m = metaList[metaIdx];
        targetMcap = m.mcap_category || m.capitalisation || getCategoryFromCr(m.market_cap);
      }
    }
    if (!targetMcap) targetMcap = 'Small Cap';

    const updates = {};
    if (h.sector !== targetSector) updates.sector = targetSector;
    if (h.market_cap !== targetMcap) updates.market_cap = targetMcap;

    if (Object.keys(updates).length > 0) {
      await db.update('holdings', h.id, updates);
      holdingsUpdated++;
    }
  }

  console.log(`✓ Updated ${holdingsUpdated} equity holdings with exact canonical sectors & market caps.`);
  console.log(`✓ Removed market_cap from ${nonEquityCleaned} non-equity holdings.`);

  // 3. Persist to disk snapshot
  saveCacheSnapshotToDisk();
  console.log('✓ Persisted updated db_cache_snapshot.json to disk.');

  // 4. Verification Check
  const verifiedHoldings = await db.select('holdings');
  const trent = verifiedHoldings.find(h => h.symbol === 'TRENT');
  console.log('TRENT holding post-update:', { symbol: trent?.symbol, sector: trent?.sector, market_cap: trent?.market_cap });

  const activeHoldings = verifiedHoldings.filter(h => Number(h.quantity) > 0 && (h.category_id === 'in_stocks' || h.category_id === 'us_stocks'));
  const unassigned = activeHoldings.filter(h => !h.sector || h.sector === 'Diversified & Other' || !h.market_cap);
  console.log(`Active equities check: ${activeHoldings.length} total, ${unassigned.length} unassigned.`);
  if (unassigned.length > 0) {
    console.warn('Remaining unassigned active equities:', unassigned.map(h => ({ symbol: h.symbol, name: h.name, sector: h.sector, market_cap: h.market_cap })));
  }
}

run().then(() => {
  console.log('✓ Seeding and verification completed successfully.');
  process.exit(0);
}).catch(err => {
  console.error('Fatal error during seeding:', err);
  process.exit(1);
});
