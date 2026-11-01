/**
 * scripts/fix_asset_metadata_industries.mjs
 * Cleans up and re-aligns data/asset_metadata.json using verified industries.
 */
import fs from 'fs';
import path from 'path';
import { normalizeSector } from '../src/components/reports/reportsConstants.js';

const metaPath = path.join(process.cwd(), 'data', 'asset_metadata.json');
const metaList = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

let corrected = 0;
metaList.forEach(m => {
  // If industry is present and provides a cleaner mapping, use it
  if (m.industry && m.industry.trim() && m.industry !== 'Unknown') {
    const fromIndustry = normalizeSector(m.industry);
    if (fromIndustry !== 'Diversified & Other' && fromIndustry !== m.sector) {
      m.sector = fromIndustry;
      corrected++;
    }
  } else if (m.sector) {
    m.sector = normalizeSector(m.sector);
  }
});

fs.writeFileSync(metaPath, JSON.stringify(metaList, null, 2), 'utf8');
console.log(`✓ Cleaned and re-aligned ${corrected} sectors in data/asset_metadata.json based on verified industry data.`);
