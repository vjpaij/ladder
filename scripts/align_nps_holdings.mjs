import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import AdmZip from 'adm-zip';
import dotenv from 'dotenv';
import { db } from '../server/db.js';
import { recalculateHoldingState } from '../server/services/recalculator.js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

const DIRECT_SYMBOL_MAP = {
  'HDFC Scheme C Tier I Direct': 'SM008019',
  'LIC Scheme G Tier I Direct': 'SM003027',
  'UTI Scheme E Tier I Direct': 'SM002027'
};

async function alignNpsHoldings() {
  console.log('=== Step 1: Aligning NPS Active Direct Holding Symbols ===');
  const holdings = await db.select('holdings');
  const npsHoldings = holdings.filter(h => h.category_id === 'nps');

  for (const h of npsHoldings) {
    if (DIRECT_SYMBOL_MAP[h.name]) {
      const correctSymbol = DIRECT_SYMBOL_MAP[h.name];
      if (h.symbol !== correctSymbol) {
        console.log(`Updating ${h.name} (${h.id}): ${h.symbol} -> ${correctSymbol}`);
        await supabase.from('holdings').update({ symbol: correctSymbol }).eq('id', h.id);
        await supabase.from('transactions').update({ symbol: correctSymbol }).eq('holding_id', h.id);
      }
    }
  }

  console.log('\n=== Step 2: Recalculating All 14 NPS Holdings ===');
  // Re-fetch holdings
  const updatedHoldings = await db.select('holdings');
  const updatedNps = updatedHoldings.filter(h => h.category_id === 'nps');
  for (const h of updatedNps) {
    const res = await recalculateHoldingState(h.id);
    console.log(`  [${res?.status || h.status}] ${h.name} (${h.symbol}): Qty=${res?.quantity ?? h.quantity}, AvgBuy=₹${Number(res?.avgBuyPrice ?? h.avg_buy_price).toFixed(4)}, RealizedPnL=₹${Number(res?.realizedPnl ?? h.realized_pnl).toFixed(2)}`);
  }

  console.log('\n=== Step 3: Backfilling Protean CRA NAVs for Post-Baseline Dates ===');
  // Check available dates in nps_daily_navs
  const { data: existingNavRows } = await supabase
    .from('nps_daily_navs')
    .select('nav_date');
  const existingDates = new Set((existingNavRows || []).map(r => r.nav_date));

  // Generate target trading dates between 2026-08-08 and 2026-09-11
  const targetDates = [];
  const start = new Date('2026-08-08T00:00:00Z');
  const end = new Date('2026-09-12T00:00:00Z');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Skip weekend
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const isoDate = `${yyyy}-${mm}-${dd}`;
    const ddmmyyyy = `${dd}${mm}${yyyy}`;
    targetDates.push({ isoDate, ddmmyyyy });
  }

  console.log(`Checking ${targetDates.length} candidate trading dates...`);
  let backfilledDays = 0;
  for (const { isoDate, ddmmyyyy } of targetDates) {
    if (existingDates.has(isoDate)) {
      continue; // Already in Supabase
    }

    const zipUrl = `https://www.npscra.proteantech.in/download/NAV_File_${ddmmyyyy}.zip`;
    try {
      const res = await axios.get(zipUrl, {
        timeout: 10000,
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });

      if (res.status === 200) {
        const zip = new AdmZip(Buffer.from(res.data));
        const outEntry = zip.getEntries().find(e => e.entryName.endsWith('.out'));
        if (outEntry) {
          const lines = outEntry.getData().toString('utf8').split(/\r?\n/).filter(l => l.trim());
          const dbRows = [];
          for (const line of lines) {
            const parts = line.split(',');
            if (parts.length >= 6) {
              const rawDate = parts[0].trim();
              const schemeCode = parts[3].trim();
              const schemeName = parts[4].trim();
              const nav = parseFloat(parts[5].trim());

              let actualDate = isoDate;
              const dParts = rawDate.split('/');
              if (dParts.length === 3) {
                actualDate = `${dParts[2]}-${dParts[0].padStart(2, '0')}-${dParts[1].padStart(2, '0')}`;
              }

              if (schemeCode && !isNaN(nav) && nav > 0) {
                dbRows.push({
                  scheme_code: schemeCode,
                  scheme_name: schemeName,
                  nav,
                  nav_date: actualDate
                });
              }
            }
          }

          if (dbRows.length > 0) {
            for (let i = 0; i < dbRows.length; i += 100) {
              const chunk = dbRows.slice(i, i + 100);
              await supabase.from('nps_daily_navs').upsert(chunk, { onConflict: 'scheme_code,nav_date' });
            }
            console.log(`  ✓ Backfilled ${dbRows.length} schemes for ${isoDate} from Protean CRA archive`);
            backfilledDays++;
          }
        }
      }
    } catch (e) {
      // 404 means holiday or file not yet published
    }
  }
  console.log(`Backfill complete. ${backfilledDays} missing market days added.`);

  console.log('\n=== Step 4: Updating Active Direct Holdings to Latest Verified Direct NAVs ===');
  // Latest verified quotes from nps_daily_navs for Direct schemes
  const directCodes = ['SM008019', 'SM003027', 'SM002027'];
  const { data: latestDirectNavs } = await supabase
    .from('nps_daily_navs')
    .select('scheme_code, nav, nav_date')
    .in('scheme_code', directCodes)
    .order('nav_date', { ascending: false });

  const latestQuoteByCode = {};
  for (const r of (latestDirectNavs || [])) {
    if (!latestQuoteByCode[r.scheme_code]) {
      latestQuoteByCode[r.scheme_code] = r;
    }
  }

  let totalActiveValuation = 0;
  for (const code of directCodes) {
    const q = latestQuoteByCode[code];
    if (q) {
      const h = updatedNps.find(item => item.name === Object.keys(DIRECT_SYMBOL_MAP).find(k => DIRECT_SYMBOL_MAP[k] === code));
      if (h) {
        const val = Number(h.quantity) * Number(q.nav);
        totalActiveValuation += val;
        console.log(`  ${h.name} (${code}): Qty=${h.quantity} * NAV=₹${q.nav} (${q.nav_date}) = ₹${val.toFixed(2)}`);
        await supabase.from('holdings').update({
          current_price: q.nav,
          symbol: code,
          updated_at: new Date().toISOString()
        }).eq('id', h.id);
      }
    }
  }

  console.log(`\nTotal Active NPS Valuation: ₹${totalActiveValuation.toFixed(2)}`);

  // Invalidate in-memory cache
  db.invalidateCache('holdings');
  db.invalidateCache('transactions');
  console.log('In-memory cache invalidated.\n=== NPS ALIGNMENT COMPLETE ===');
}

alignNpsHoldings().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
