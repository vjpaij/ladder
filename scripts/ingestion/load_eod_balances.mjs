import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from './server/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseExcelDate(excelDate) {
  if (typeof excelDate === 'number') {
    const d = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
    return d.toISOString().split('T')[0];
  }
  return String(excelDate).trim();
}

async function run() {
  console.log('🚀 Loading EOD Balances from portfolio.xlsx...');
  
  const workbook = xlsx.readFile(path.join(__dirname, 'portfolio.xlsx'));
  const sheet = workbook.Sheets['Portfolio'];
  const rawRows = xlsx.utils.sheet_to_json(sheet);

  console.log(`Read ${rawRows.length} raw rows from sheet "Portfolio"`);

  const dailyLogs = [];
  let maxRow = null;

  for (const row of rawRows) {
    // Clean key names (trim whitespace)
    const cleanedRow = {};
    for (const [k, v] of Object.entries(row)) {
      cleanedRow[k.trim()] = v;
    }

    if (cleanedRow.DATE === 'MAX') {
      maxRow = cleanedRow;
      continue;
    }

    const formattedDate = parseExcelDate(cleanedRow.DATE);
    if (!formattedDate || formattedDate === 'undefined') continue;

    dailyLogs.push({
      date: formattedDate,
      hdfc: Number(cleanedRow.HDFC) || 0,
      indusind: Number(cleanedRow.INDUSIND) || 0,
      idfc: Number(cleanedRow.IDFC) || 0,
      rbl: Number(cleanedRow.RBL) || 0,
      sbi: Number(cleanedRow.SBI) || 0,
      federal: Number(cleanedRow.FEDERAL) || 0,
      savings: Number(cleanedRow.SAVINGS) || 0,
      epf: Number(cleanedRow.EPF) || 0,
      loan: Number(cleanedRow.LOAN) || 0,
      credits: Number(cleanedRow.CREDITS) || 0,
      debt: Number(cleanedRow.DEBT) || 0,
      mutual_funds: Number(cleanedRow['MUTUAL FUNDS']) || 0,
      indian_stocks: Number(cleanedRow['INDIAN STOCKS']) || 0,
      us_stocks: Number(cleanedRow['US STOCKS']) || 0,
      nps: Number(cleanedRow.NPS) || 0,
      wealth: Number(cleanedRow.WEALTH) || 0
    });
  }

  console.log(`Processed ${dailyLogs.length} historical daily EOD records.`);
  
  // Ensure data dir exists
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Save to JSON for instant sub-millisecond retrieval
  const jsonPath = path.join(dataDir, 'portfolio_eod_logs.json');
  fs.writeFileSync(jsonPath, JSON.stringify(dailyLogs, null, 2), 'utf-8');
  console.log(`Saved daily EOD logs to ${jsonPath}`);

  // Create/Update Holdings for Bank & EPF in Supabase
  const latestLog = dailyLogs[dailyLogs.length - 1];
  console.log('Latest daily log (2026-08-07):', latestLog);

  const bankHoldings = [
    {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'HDFC Bank Savings Account',
      symbol: 'HDFC-SAVINGS',
      category_id: 'bank',
      quantity: 1,
      avg_buy_price: latestLog.hdfc,
      current_price: latestLog.hdfc,
      currency: 'INR',
      sector: 'Banking & Financials',
      status: 'ACTIVE'
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'IndusInd Bank Savings Account',
      symbol: 'INDUSIND-SAVINGS',
      category_id: 'bank',
      quantity: 1,
      avg_buy_price: latestLog.indusind,
      current_price: latestLog.indusind,
      currency: 'INR',
      sector: 'Banking & Financials',
      status: 'ACTIVE'
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'IDFC FIRST Bank Savings Account',
      symbol: 'IDFC-SAVINGS',
      category_id: 'bank',
      quantity: 1,
      avg_buy_price: latestLog.idfc,
      current_price: latestLog.idfc,
      currency: 'INR',
      sector: 'Banking & Financials',
      status: 'ACTIVE'
    },
    {
      id: '00000000-0000-0000-0000-000000000004',
      name: 'RBL Bank Savings Account',
      symbol: 'RBL-SAVINGS',
      category_id: 'bank',
      quantity: 1,
      avg_buy_price: latestLog.rbl,
      current_price: latestLog.rbl,
      currency: 'INR',
      sector: 'Banking & Financials',
      status: 'ACTIVE'
    },
    {
      id: '00000000-0000-0000-0000-000000000005',
      name: 'State Bank of India (SBI) Savings Account',
      symbol: 'SBI-SAVINGS',
      category_id: 'bank',
      quantity: 1,
      avg_buy_price: latestLog.sbi,
      current_price: latestLog.sbi,
      currency: 'INR',
      sector: 'Banking & Financials',
      status: 'ACTIVE'
    },
    {
      id: '00000000-0000-0000-0000-000000000006',
      name: 'Federal Bank Savings Account',
      symbol: 'FEDERAL-SAVINGS',
      category_id: 'bank',
      quantity: 1,
      avg_buy_price: latestLog.federal,
      current_price: latestLog.federal,
      currency: 'INR',
      sector: 'Banking & Financials',
      status: 'ACTIVE'
    },
    {
      id: '00000000-0000-0000-0000-000000000007',
      name: 'EPF',
      symbol: 'EPF-RETIREMENT',
      category_id: 'epf',
      quantity: 1,
      avg_buy_price: latestLog.epf,
      current_price: latestLog.epf,
      currency: 'INR',
      sector: 'Retirement & Provident Fund',
      status: 'ACTIVE'
    }
  ];

  for (const h of bankHoldings) {
    const { error } = await supabase.from('holdings').upsert(h, { onConflict: 'id' });
    if (error) console.error(`Error upserting holding ${h.id}:`, error.message);
    else console.log(`Upserted holding: ${h.name}`);
  }

  // Create/Update Liabilities in Supabase
  const liabilitiesRows = [
    {
      id: '00000000-0000-0000-0000-000000000010',
      name: 'Housing Loan (SBI Bank)',
      category_id: 'loans',
      lender: 'State Bank of India (SBI)',
      outstanding_balance: latestLog.loan,
      monthly_emi: 42500,
      interest_rate: 8.50,
      due_day: 5
    },
    {
      id: '00000000-0000-0000-0000-000000000011',
      name: 'Credit Cards Outstanding Balance',
      category_id: 'credit_cards',
      lender: 'ICICI / HDFC Cards',
      outstanding_balance: latestLog.credits,
      monthly_emi: 0,
      interest_rate: 0.00,
      due_day: 15
    }
  ];

  for (const l of liabilitiesRows) {
    const { error } = await supabase.from('liabilities').upsert(l, { onConflict: 'id' });
    if (error) console.error(`Error upserting liability ${l.id}:`, error.message);
    else console.log(`Upserted liability: ${l.name}`);
  }

  for (const l of liabilitiesRows) {
    const { error } = await supabase.from('liabilities').upsert(l, { onConflict: 'id' });
    if (error) console.error(`Error upserting liability ${l.id}:`, error.message);
    else console.log(`Upserted liability: ${l.name}`);
  }

  console.log('✅ Ingestion completed successfully!');
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
