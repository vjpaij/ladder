import fs from 'fs';
import path from 'path';
import { supabase } from '../server/supabaseClient.js';

const EOD_FILE = path.join(process.cwd(), 'data', 'portfolio_eod_logs.json');

async function migrateEodToSupabase() {
  console.log('Reading portfolio EOD logs from JSON...');
  if (!fs.existsSync(EOD_FILE)) {
    console.error('EOD file not found:', EOD_FILE);
    process.exit(1);
  }

  const eodLogs = JSON.parse(fs.readFileSync(EOD_FILE, 'utf-8'));
  console.log(`Found ${eodLogs.length} EOD log records to migrate into Supabase.`);

  const batchSize = 500;
  for (let i = 0; i < eodLogs.length; i += batchSize) {
    const chunk = eodLogs.slice(i, i + batchSize);
    const records = chunk.map(l => {
      const breakdown = {
        savings: Number((l.savings || 0).toFixed(2)),
        epf: Number((l.epf || 0).toFixed(2)),
        mutual_funds: Number((l.mutual_funds || 0).toFixed(2)),
        indian_stocks: Number((l.indian_stocks || 0).toFixed(2)),
        us_stocks: Number((l.us_stocks || 0).toFixed(2)),
        nps: Number((l.nps || 0).toFixed(2)),
        loan: Number((l.loan || 0).toFixed(2)),
        credits: Number((l.credits || 0).toFixed(2))
      };

      const debt = Number((l.debt !== undefined ? l.debt : ((l.loan || 0) + (l.credits || 0))).toFixed(2));
      const totalAssets = Number((l.total_assets || (l.wealth + debt)).toFixed(2));
      const wealth = Number((l.total_wealth !== undefined ? l.total_wealth : l.wealth).toFixed(2));

      return {
        log_date: l.date,
        total_assets_inr: totalAssets,
        total_liabilities_inr: debt,
        net_worth_inr: wealth,
        daily_pnl_inr: Number((l.daily_pnl || 0).toFixed(2)),
        pnl_percentage: Number((l.pnl_pct || 0).toFixed(2)),
        hdfc: Number((l.hdfc || 0).toFixed(2)),
        indusind: Number((l.indusind || 0).toFixed(2)),
        idfc: Number((l.idfc || 0).toFixed(2)),
        rbl: Number((l.rbl || 0).toFixed(2)),
        sbi: Number((l.sbi || 0).toFixed(2)),
        federal: Number((l.federal || 0).toFixed(2)),
        savings: Number((l.savings || 0).toFixed(2)),
        mutual_funds: Number((l.mutual_funds || 0).toFixed(2)),
        indian_stocks: Number((l.indian_stocks || 0).toFixed(2)),
        us_stocks: Number((l.us_stocks || 0).toFixed(2)),
        nps: Number((l.nps || 0).toFixed(2)),
        epf: Number((l.epf || 0).toFixed(2)),
        loan: Number((l.loan || 0).toFixed(2)),
        credits: Number((l.credits || 0).toFixed(2)),
        debt: debt,
        wealth: wealth,
        breakdown: breakdown
      };
    });

    const { error } = await supabase.from('pnl_history').upsert(records, { onConflict: 'log_date' });
    if (error) {
      console.error(`[Batch ${i} - ${i + chunk.length}] Error:`, error.message);
    } else {
      console.log(`[Batch ${i + 1} - ${i + chunk.length}/${eodLogs.length}] Successfully upserted.`);
    }
  }

  console.log('Migration of all historical EOD records to Supabase complete!');
  process.exit(0);
}

migrateEodToSupabase().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
