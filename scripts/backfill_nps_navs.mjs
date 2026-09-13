import axios from 'axios';
import { supabase } from '../server/supabaseClient.js';

const ALL_NPS_SCHEMES = [
  { code: 'SM001003', name: 'SBI Scheme E Tier I' },
  { code: 'SM010001', name: 'ABSL Scheme E Tier I' },
  { code: 'SM003005', name: 'LIC Scheme E Tier I' },
  { code: 'SM008002', name: 'HDFC Scheme C Tier I' },
  { code: 'SM010002', name: 'ABSL Scheme C Tier I' },
  { code: 'SM001004', name: 'SBI Scheme C Tier I' },
  { code: 'SM001005', name: 'SBI Scheme G Tier I' },
  { code: 'SM002003', name: 'UTI Scheme E Tier I' },
  { code: 'SM010003', name: 'ABSL Scheme G Tier I' },
  { code: 'SM003027', name: 'LIC Scheme G Tier I Direct' },
  { code: 'SM003006', name: 'LIC Scheme C Tier I' },
  { code: 'SM003007', name: 'LIC Scheme G Tier I' },
  { code: 'SM008019', name: 'HDFC Scheme C Tier I Direct' },
  { code: 'SM002027', name: 'UTI Scheme E Tier I Direct' },
];

const UPSERT_BATCH = 500;
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchHistory(code) {
  try {
    const url = 'https://npsnav.in/api/historical/' + code;
    const res = await axios.get(url, { timeout: 15000 });
    if (res.data && Array.isArray(res.data.data)) {
      const records = [];
      for (const item of res.data.data) {
        if (!item.date || item.nav == null) continue;
        const parts = item.date.split('-');
        if (parts.length !== 3) continue;
        const isoDate = parts[0].length === 4 ? item.date : (parts[2] + '-' + parts[1] + '-' + parts[0]);
        const nav = parseFloat(item.nav);
        if (!isNaN(nav) && nav > 0) records.push({ date: isoDate, nav: Number(nav.toFixed(4)) });
      }
      return records;
    }
  } catch (e) { console.warn('  [npsnav.in] Failed for ' + code + ': ' + e.message); }
  return [];
}

async function backfillScheme(scheme) {
  console.log('Processing ' + scheme.code + ' (' + scheme.name + ')...');
  const existingDates = new Set();
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from('nps_daily_navs').select('nav_date').eq('scheme_code', scheme.code).range(from, from + 999);
    if (error || !data || data.length === 0) break;
    data.forEach(r => existingDates.add(r.nav_date));
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log('  Existing in DB: ' + existingDates.size);
  const history = await fetchHistory(scheme.code);
  console.log('  Fetched from npsnav.in: ' + history.length);
  const newRecs = history.filter(r => !existingDates.has(r.date)).map(r => ({ scheme_code: scheme.code, scheme_name: scheme.name, nav_date: r.date, nav: r.nav }));
  console.log('  New records: ' + newRecs.length);
  if (newRecs.length === 0) return 0;
  let inserted = 0;
  for (let i = 0; i < newRecs.length; i += UPSERT_BATCH) {
    const chunk = newRecs.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase.from('nps_daily_navs').upsert(chunk, { onConflict: 'scheme_code,nav_date' });
    if (error) console.warn('  Upsert error: ' + error.message);
    else inserted += chunk.length;
  }
  console.log('  Inserted: ' + inserted);
  return inserted;
}

async function main() {
  console.log('=== NPS HISTORICAL NAV BACKFILL ===');
  console.log('Source: npsnav.in | Target: Supabase nps_daily_navs');
  let total = 0;
  for (const scheme of ALL_NPS_SCHEMES) {
    total += await backfillScheme(scheme);
    await delay(800);
  }
  console.log('=== BACKFILL COMPLETE. Total inserted: ' + total + ' ===');
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
