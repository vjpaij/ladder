/**
 * sync_official_nse_universe.mjs
 * Downloads the official, authoritative master list of listed equities directly
 * from the National Stock Exchange of India (NSE) Archives:
 * https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv
 *
 * Responsibilities:
 * 1. Synchronizes all active NSE listed equities into data/nse_universe.json & data/nse500_universe.json.
 * 2. Identifies and merges newly listed IPOs (with exact listing dates & ISINs).
 * 3. Enriches data/asset_metadata.json with official names and ISINs.
 * 4. Can be executed on demand or scheduled automatically.
 */

import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const UNIVERSE_FILE = path.join(DATA_DIR, 'nse_universe.json');
const NSE500_FILE = path.join(DATA_DIR, 'nse500_universe.json');
const METADATA_FILE = path.join(DATA_DIR, 'asset_metadata.json');

const NSE_EQUITY_L_URL = 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv';

export async function syncOfficialNseUniverse() {
  console.log('====================================================');
  console.log('   OFFICIAL NSE LISTED EQUITIES SYNCHRONIZATION     ');
  console.log('====================================================');

  console.log(`[NSE Sync] Downloading official equity master list from ${NSE_EQUITY_L_URL}...`);
  const res = await axios.get(NSE_EQUITY_L_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    timeout: 15000
  });

  const lines = res.data.split('\n').filter(Boolean);
  if (lines.length < 10) {
    throw new Error('Downloaded NSE master list is too short or malformed.');
  }

  // Load existing universe
  let existingUniverse = new Set();
  if (fs.existsSync(UNIVERSE_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(UNIVERSE_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        parsed.forEach(s => existingUniverse.add(String(s).trim().toUpperCase()));
      }
    } catch (_) {}
  }

  // Load existing asset metadata
  let metadataMap = new Map();
  if (fs.existsSync(METADATA_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
      if (Array.isArray(parsed)) {
        parsed.forEach(item => {
          if (item.symbol) metadataMap.set(String(item.symbol).trim().toUpperCase(), item);
        });
      }
    } catch (_) {}
  }

  const activeOfficialNse = [];
  const newlyDiscoveredIpos = [];
  const validSeries = new Set(['EQ', 'BE', 'BZ', 'SM']);

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    if (cols.length < 7) continue;

    const symbol = cols[0].toUpperCase();
    const companyName = cols[1];
    const series = cols[2];
    const dateOfListing = cols[3];
    const isin = cols[6];

    if (!symbol || !validSeries.has(series)) continue;

    activeOfficialNse.push(symbol);

    if (!existingUniverse.has(symbol)) {
      newlyDiscoveredIpos.push({
        symbol,
        companyName,
        series,
        dateOfListing,
        isin
      });
      existingUniverse.add(symbol);
    }

    // Update or enrich asset metadata
    const existingMeta = metadataMap.get(symbol) || { symbol };
    metadataMap.set(symbol, {
      ...existingMeta,
      symbol,
      name: companyName || existingMeta.name || symbol,
      isin: isin || existingMeta.isin,
      listing_date: dateOfListing || existingMeta.listing_date,
      series: series || existingMeta.series,
      exchange: 'NSE'
    });
  }

  const updatedUniverseArray = Array.from(existingUniverse).sort();

  // Save updated universe files
  fs.writeFileSync(UNIVERSE_FILE, JSON.stringify(updatedUniverseArray, null, 2), 'utf8');
  fs.writeFileSync(NSE500_FILE, JSON.stringify(updatedUniverseArray, null, 2), 'utf8');
  fs.writeFileSync(METADATA_FILE, JSON.stringify(Array.from(metadataMap.values()), null, 2), 'utf8');

  console.log(`✓ Active NSE Official Equities: ${activeOfficialNse.length}`);
  console.log(`✓ Total Merged Universe Size:  ${updatedUniverseArray.length} symbols`);
  console.log(`✓ Newly Added IPOs/Equities:   ${newlyDiscoveredIpos.length}`);

  if (newlyDiscoveredIpos.length > 0) {
    console.log('\n--- Sample Newly Discovered IPOs / Listings ---');
    newlyDiscoveredIpos.slice(0, 10).forEach(ipo => {
      console.log(`  • ${ipo.symbol.padEnd(12)} | Listed: ${ipo.dateOfListing} | ISIN: ${ipo.isin} | ${ipo.companyName}`);
    });
  }

  console.log('====================================================\n');
  return {
    totalUniverse: updatedUniverseArray.length,
    activeNseCount: activeOfficialNse.length,
    newlyAddedCount: newlyDiscoveredIpos.length,
    sampleNewIpos: newlyDiscoveredIpos.slice(0, 10)
  };
}

if (process.argv[1]?.endsWith('sync_official_nse_universe.mjs')) {
  syncOfficialNseUniverse().catch(err => {
    console.error('[NSE Sync Error]:', err.message);
    process.exit(1);
  });
}
