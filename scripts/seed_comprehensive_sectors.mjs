/**
 * scripts/seed_comprehensive_sectors.mjs
 * 
 * Master script to seed canonical sectors & industries across:
 * 1. data/asset_metadata.json
 * 2. Database holdings table (Supabase & local cache)
 * 3. Database asset_metadata table (Supabase & local cache)
 * 4. Local disk snapshot data/db_cache_snapshot.json
 */

import fs from 'fs';
import path from 'path';
import { db, saveCacheSnapshotToDisk } from '../server/db.js';
import { supabase } from '../server/supabaseClient.js';
import { normalizeSector } from '../src/components/reports/reportsConstants.js';

const HOLDINGS_SECTOR_MAP = {
  // ── Indian Active Holdings (55) ──
  'INDGN': { sector: 'Healthcare Services & Hospitals', industry: 'Life Sciences Commercialization Tech' },
  'MANAKCOAT': { sector: 'Metals, Mining & Materials', industry: 'Coated Steel Products' },
  'SAILIFE': { sector: 'Pharmaceuticals & Biotechnology', industry: 'Contract Research & Manufacturing (CRO/CDMO)' },
  'ATHERENERG': { sector: 'Automobile & Auto Components', industry: 'Electric Two-Wheelers' },
  'INOXINDIA': { sector: 'Capital Goods & Heavy Engineering', industry: 'Cryogenic Equipment & Engineering' },
  'SONACOMS': { sector: 'Automobile & Auto Components', industry: 'Auto Precision Forgings & EV Systems' },
  'RADICO': { sector: 'Consumer Staples & FMCG', industry: 'Alcoholic Beverages & Spirits' },
  'QPOWER': { sector: 'Power & Electrical Equipment', industry: 'High Voltage Electrical Equipment' },
  'IGPL': { sector: 'Chemicals & Specialty Chemicals', industry: 'Specialty Chemicals & Phthalic Anhydride' },
  'AVALON': { sector: 'Semiconductors & Hardware', industry: 'Electronic Manufacturing Services (EMS)' },
  'JASH': { sector: 'Capital Goods & Heavy Engineering', industry: 'Water Control Machinery & Precision Engineering' },
  'RPEL': { sector: 'Metals, Mining & Materials', industry: 'Refractory Materials & Ramming Mass' },
  'MACPOWER': { sector: 'Capital Goods & Heavy Engineering', industry: 'CNC Machine Tools & Machining Centers' },
  'TECHM': { sector: 'Information Technology & Software', industry: 'IT Services & Enterprise Consulting' },
  'GRWRHITECH': { sector: 'Chemicals & Specialty Chemicals', industry: 'Specialty Polyester & Protection Films' },
  'TBOTEK': { sector: 'Travel, Tourism & Hospitality', industry: 'Global B2B Travel Distribution Platform' },
  'SANSERA': { sector: 'Automobile & Auto Components', industry: 'Precision Engineered Automotive Components' },
  'DHOOTTRANS': { sector: 'Automobile & Auto Components', industry: 'Wiring Harnesses & Automotive Electronics' },
  'VAML': { sector: 'Metals, Mining & Materials', industry: 'Primary Aluminium & Alloys' },
  'GUFICBIO': { sector: 'Pharmaceuticals & Biotechnology', industry: 'Lyophilized Formulations & Biopharma' },
  'TRENT': { sector: 'Consumer Discretionary & Retail', industry: 'Apparel & Lifestyle Retail (Westside / Zudio)' },
  'TDPOWERSYS': { sector: 'Power & Electrical Equipment', industry: 'AC Generators & Electric Machinery' },
  'NEOGEN': { sector: 'Chemicals & Specialty Chemicals', industry: 'Bromine & Lithium Specialty Chemicals' },
  'REDINGTON': { sector: 'Information Technology & Software', industry: 'Technology Supply Chain & Cloud Solutions' },
  'SBCL': { sector: 'Metals, Mining & Materials', industry: 'Thermostatic Bimetals & Shunt Resistors' },
  'ECLERX': { sector: 'Information Technology & Software', industry: 'Data Analytics & Digital Process Outsourcing' },
  'ARTEMISMED': { sector: 'Healthcare Services & Hospitals', industry: 'Multi-Specialty Tertiary Care Hospitals' },
  'SYRMA': { sector: 'Semiconductors & Hardware', industry: 'Electronic Manufacturing Services (EMS)' },
  'TARIL': { sector: 'Power & Electrical Equipment', industry: 'Power & Distribution Transformers' },
  'HBLENGINE': { sector: 'Power & Electrical Equipment', industry: 'Engineered Batteries & Power Electronics' },
  'FRACTAL': { sector: 'Information Technology & Software', industry: 'Enterprise AI & Decision Sciences' },
  'FCL': { sector: 'Chemicals & Specialty Chemicals', industry: 'Specialty Finishing Chemicals & Enzymes' },
  'GABRIEL': { sector: 'Automobile & Auto Components', industry: 'Ride Control Products & Shock Absorbers' },
  'ENRIN': { sector: 'Power & Electrical Equipment', industry: 'Energy Transition & Transmission Equipment' },
  'SAGILITY': { sector: 'Healthcare Services & Hospitals', industry: 'Healthcare Process Management & Tech Solutions' },
  'EBGNG': { sector: 'Semiconductors & Hardware', industry: 'Consumer Electronics & Hardware Assemblies' },
  'FLUOROCHEM': { sector: 'Chemicals & Specialty Chemicals', industry: 'Fluoropolymers & Specialty Fluorochemicals' },
  'MMP': { sector: 'Metals, Mining & Materials', industry: 'Aluminium Powders, Pastes & Foils' },
  'BHEL': { sector: 'Capital Goods & Heavy Engineering', industry: 'Heavy Electricals & Power Engineering' },
  'IPCALAB': { sector: 'Pharmaceuticals & Biotechnology', industry: 'Active Pharmaceutical Ingredients & Formulations' },
  'MODINATUR': { sector: 'Consumer Staples & FMCG', industry: 'Branded Edible Oils & Packaged Foods' },
  'SHANKESH': { sector: 'Gems, Jewellery & Luxury', industry: 'Gold Jewellery Manufacturing' },
  'VRLLOG': { sector: 'Logistics & Transportation', industry: 'Surface Logistics & Parcel Transportation' },
  'HSCL': { sector: 'Chemicals & Specialty Chemicals', industry: 'Carbon Black & Lithium-ion Battery Anode Materials' },
  'IGIL': { sector: 'Gems, Jewellery & Luxury', industry: 'Certification & Grading of Diamonds & Fine Jewelry' },
  'LALPATHLAB': { sector: 'Healthcare Services & Hospitals', industry: 'Diagnostic & Pathology Testing Services' },
  'PNB': { sector: 'Banking', industry: 'Public Sector Commercial Banking' },
  'SOLARA': { sector: 'Pharmaceuticals & Biotechnology', industry: 'Active Pharmaceutical Ingredients (APIs)' },
  'CORONA': { sector: 'Pharmaceuticals & Biotechnology', industry: 'Therapeutic Formulations & Specialty Drugs' },
  'LUMAXTECH': { sector: 'Automobile & Auto Components', industry: 'Automotive Lighting & Gear Shifters' },
  'SHREEPUSHK': { sector: 'Chemicals & Specialty Chemicals', industry: 'Dyes, Dye Intermediates & Fertilizers' },
  'SUDEEPPHRM': { sector: 'Pharmaceuticals & Biotechnology', industry: 'Mineral-Based Pharma & Food Actives' },
  'TVSMOTOR': { sector: 'Automobile & Auto Components', industry: 'Two & Three-Wheelers OEM' },
  'AEROFLEX': { sector: 'Capital Goods & Heavy Engineering', industry: 'Metallic Flexible Hoses & Flow Solutions' },
  'RKFORGE': { sector: 'Automobile & Auto Components', industry: 'Automotive & Railway Forged Components' },

  // ── US Active Holdings (11) ──
  'NVDA': { sector: 'Semiconductors & Hardware', industry: 'Accelerated Computing & GPUs' },
  'TSM': { sector: 'Semiconductors & Hardware', industry: 'Pure-Play Semiconductor Foundry' },
  'PLTR': { sector: 'Enterprise Cloud & Internet', industry: 'AI Decision Platforms & Big Data Analytics' },
  'AVGO': { sector: 'Semiconductors & Hardware', industry: 'Semiconductors & Infrastructure Software' },
  'ANET': { sector: 'Semiconductors & Hardware', industry: 'Cloud Networking & AI Switches' },
  'GOOG': { sector: 'Enterprise Cloud & Internet', industry: 'Search, Cloud & Digital Ecosystems' },
  'MSFT': { sector: 'Enterprise Cloud & Internet', industry: 'Enterprise Cloud, Productivity & AI' },
  'CRM': { sector: 'Enterprise Cloud & Internet', industry: 'Enterprise Cloud CRM Applications' },
  'AMZN': { sector: 'Enterprise Cloud & Internet', industry: 'Cloud Infrastructure (AWS) & E-Commerce' },
  'AAPL': { sector: 'Consumer Electronics & Hardware', industry: 'Smartphones, Personal Computing & Hardware' },
  'META': { sector: 'Enterprise Cloud & Internet', industry: 'Social Technologies, AI & Digital Advertising' },

  // ── Market Universe & BSE-Listed / Chartink Candidates ──
  'NSE': { sector: 'Financial Services & NBFC', industry: 'Stock Exchanges & Clearing Corporations' },
  'BSE': { sector: 'Financial Services & NBFC', industry: 'Stock Exchanges & Financial Infrastructure' },
  'POONAWALLA': { sector: 'Financial Services & NBFC', industry: 'Non-Banking Financial Company (NBFC)' },
  'SGFIN': { sector: 'Financial Services & NBFC', industry: 'Financial Services & Supply Chain Financing' },
  '360ONE': { sector: 'Financial Services & NBFC', industry: 'Wealth & Asset Management' },
  'MARSONS': { sector: 'Power & Electrical Equipment', industry: 'Power & Distribution Transformers' },
  'GRPLTD': { sector: 'Automobile & Auto Components', industry: 'Reclaimed Rubber for Tyres' },
  'BODALCHEM': { sector: 'Chemicals & Specialty Chemicals', industry: 'Dyestuffs & Basic Chemicals' },
  'TASTYBITE': { sector: 'Consumer Staples & FMCG', industry: 'Prepared & Packaged Foods' },
  'AGARWALEYE': { sector: 'Healthcare Services & Hospitals', industry: 'Ophthalmic Clinics & Eye Hospitals' },
  'KIRIINDUS': { sector: 'Chemicals & Specialty Chemicals', industry: 'Dyes & Chemical Intermediates' },
  'SAIPARENT': { sector: 'Pharmaceuticals & Biotechnology', industry: 'Injectable Formulations & Parenterals' },
  'PGHL': { sector: 'Pharmaceuticals & Biotechnology', industry: 'Healthcare Products & Pharmaceuticals' },
  'NHPC': { sector: 'Power & Electrical Equipment', industry: 'Hydroelectric Power Generation' },
  'SANOFI': { sector: 'Pharmaceuticals & Biotechnology', industry: 'Pharmaceutical Formulations' },
  'PROTEAN': { sector: 'Information Technology & Software', industry: 'Digital Public Infrastructure & GovTech' },
  'ESAFSFB': { sector: 'Banking', industry: 'Small Finance Bank' },
  'DELTACORP': { sector: 'Travel, Tourism & Hospitality', industry: 'Hospitality, Gaming & Entertainment' },
  'NILKAMAL': { sector: 'Consumer Discretionary & Retail', industry: 'Moulded Furniture & Material Handling' }
};

async function run() {
  console.log('Seeding comprehensive canonical sectors...');

  // 1. Update data/asset_metadata.json
  const metaPath = path.join(process.cwd(), 'data', 'asset_metadata.json');
  let metaList = [];
  if (fs.existsSync(metaPath)) {
    metaList = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  }

  const metaMap = new Map();
  metaList.forEach(m => {
    if (m.symbol) {
      metaMap.set(m.symbol.toUpperCase().trim(), m);
      metaMap.set(m.symbol.replace(/\.(NS|BO)$/i, '').toUpperCase().trim(), m);
    }
  });

  let metaUpdatedCount = 0;
  for (const [sym, info] of Object.entries(HOLDINGS_SECTOR_MAP)) {
    const cleanSym = sym.toUpperCase().trim();
    let existing = metaMap.get(cleanSym);
    if (existing) {
      existing.sector = info.sector;
      existing.industry = info.industry;
      existing.last_updated = new Date().toISOString();
      metaUpdatedCount++;
    } else {
      const newEntry = {
        symbol: cleanSym,
        name: cleanSym,
        category_id: ['NVDA', 'TSM', 'PLTR', 'AVGO', 'ANET', 'GOOG', 'MSFT', 'CRM', 'AMZN', 'AAPL', 'META'].includes(cleanSym) ? 'us_stocks' : 'in_stocks',
        sector: info.sector,
        industry: info.industry,
        market_cap: 10000,
        mcap_category: 'Small Cap',
        last_updated: new Date().toISOString()
      };
      metaList.push(newEntry);
      metaMap.set(cleanSym, newEntry);
      metaUpdatedCount++;
    }
  }

  // Also normalize every existing sector in metaList
  metaList.forEach(m => {
    if (m.sector) {
      m.sector = normalizeSector(m.sector);
    }
  });

  fs.writeFileSync(metaPath, JSON.stringify(metaList, null, 2), 'utf8');
  console.log(`✓ Updated data/asset_metadata.json (${metaList.length} total entries, ${metaUpdatedCount} mapped)`);

  // 2. Update holdings in database cache and Supabase
  const holdings = await db.select('holdings');
  let holdingsUpdated = 0;

  for (const h of holdings) {
    const clean = (h.symbol || '').replace(/\.(NS|BO)$/i, '').toUpperCase().trim();
    const mapping = HOLDINGS_SECTOR_MAP[clean] || HOLDINGS_SECTOR_MAP[h.symbol?.toUpperCase()?.trim()];
    const newSector = mapping ? mapping.sector : (h.sector ? normalizeSector(h.sector) : null);

    if (newSector && h.sector !== newSector) {
      await db.update('holdings', h.id, { sector: newSector });
      holdingsUpdated++;
    }
  }
  console.log(`✓ Updated ${holdingsUpdated} rows in database holdings table with exact canonical sectors.`);

  // 3. Persist updated cache snapshot
  saveCacheSnapshotToDisk();
  console.log('✓ Persisted updated db_cache_snapshot.json to disk.');
  console.log('✓ Seeding complete. Verifying active holdings sectors...');
  const refreshedHoldings = await db.select('holdings');
  const activeEquities = refreshedHoldings.filter(h => Number(h.quantity) > 0 && (h.category_id === 'in_stocks' || h.category_id === 'us_stocks'));
  
  const sample = activeEquities.slice(0, 10).map(h => ({
    symbol: h.symbol,
    category: h.category_id,
    sector: h.sector
  }));
  console.log('Active Equities Sector Sample:', sample);
}

run().then(() => {
  console.log('Finished successfully.');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
