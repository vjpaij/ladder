import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import { db, initDatabase } from '../server/db.js';
import { supabase } from '../server/supabaseClient.js';
import { computePortfolioValuation } from '../server/services/portfolioCalculator.js';

const EOD_FILE = path.join(process.cwd(), 'data', 'portfolio_eod_logs.json');
const HISTORICAL_FILE = path.join(process.cwd(), 'data', 'historical_prices.json');
const FX_FILE = path.join(process.cwd(), 'data', 'historical_fx_rates.json');
const EXCEL_FILE = path.join(process.cwd(), 'portfolio.xlsx');

let historicalFxRatesCache = {};
if (fs.existsSync(FX_FILE)) {
  historicalFxRatesCache = JSON.parse(fs.readFileSync(FX_FILE, 'utf-8'));
}

// Helper to get USD/INR rate historically (exact daily if available)
function getHistoricalFxRate(dateStr) {
  if (!dateStr) return 87.25;
  if (historicalFxRatesCache[dateStr]) return historicalFxRatesCache[dateStr];
  
  const prevDates = Object.keys(historicalFxRatesCache).filter(d => d < dateStr).sort().reverse();
  if (prevDates.length > 0) {
    return historicalFxRatesCache[prevDates[0]];
  }

  const year = parseInt(String(dateStr).slice(0, 4), 10);
  if (isNaN(year)) return 87.25;
  if (year <= 2019) return 70.4;
  if (year === 2020) return 74.1;
  if (year === 2021) return 73.9;
  if (year === 2022) return 79.8;
  if (year === 2023) return 82.6;
  if (year === 2024) return 83.5;
  if (year === 2025) return 85.2;
  return 87.25;
}

function parseExcelDate(excelDate) {
  if (typeof excelDate === 'number') {
    const d = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
    return d.toISOString().split('T')[0];
  }
  return String(excelDate).trim();
}

async function rebuildEod() {
  initDatabase();
  console.log('Rebuilding portfolio EOD logs from portfolio.xlsx and Supabase holdings...');

  // 1. Read base historical rows from Excel up to 2026-08-07, or fallback to JSON for prior history
  let baseLogs = [];
  if (fs.existsSync(EXCEL_FILE)) {
    const wb = xlsx.readFile(EXCEL_FILE);
    const rawRows = xlsx.utils.sheet_to_json(wb.Sheets['Portfolio']);
    
    for (const row of rawRows) {
      const cleaned = {};
      for (const [k, v] of Object.entries(row)) cleaned[k.trim()] = v;
      if (cleaned.DATE === 'MAX') continue;
      const d = parseExcelDate(cleaned.DATE);
      if (!d || d === 'undefined') continue;
      
      const hdfc = Number(cleaned.HDFC) || 0;
      const indusind = Number(cleaned.INDUSIND) || 0;
      const idfc = Number(cleaned.IDFC) || 0;
      const rbl = Number(cleaned.RBL) || 0;
      const sbi = Number(cleaned.SBI) || 0;
      const federal = Number(cleaned.FEDERAL) || 0;
      const bankSavings = hdfc + indusind + idfc + rbl + sbi + federal;
      
      const mf = Number(cleaned['MUTUAL FUNDS']) || 0;
      const inStocks = Number(cleaned['INDIAN STOCKS']) || 0;
      const usStocks = Number(cleaned['US STOCKS']) || 0;
      const nps = Number(cleaned.NPS) || 0;
      const epf = Number(cleaned.EPF) || 0;
      
      const loan = Number(cleaned.LOAN) || 0;
      const credits = Number(cleaned.CREDITS) || 0;
      const debt = Number(cleaned.DEBT) || (loan + credits);
      
      const totalAssets = Number(cleaned.SAVINGS) || (bankSavings + mf + inStocks + usStocks + nps + epf);
      const wealth = Number(cleaned.WEALTH) || (totalAssets - debt);

      baseLogs.push({
        date: d,
        hdfc: Number(hdfc.toFixed(2)),
        indusind: Number(indusind.toFixed(2)),
        idfc: Number(idfc.toFixed(2)),
        rbl: Number(rbl.toFixed(2)),
        sbi: Number(sbi.toFixed(2)),
        federal: Number(federal.toFixed(2)),
        savings: Number(bankSavings.toFixed(2)),
        mutual_funds: Number(mf.toFixed(2)),
        indian_stocks: Number(inStocks.toFixed(2)),
        us_stocks: Number(usStocks.toFixed(2)),
        nps: Number(nps.toFixed(2)),
        epf: Number(epf.toFixed(2)),
        loan: Number(loan.toFixed(2)),
        credits: Number(credits.toFixed(2)),
        debt: Number(debt.toFixed(2)),
        total_assets: Number(totalAssets.toFixed(2)),
        wealth: Number(wealth.toFixed(2)),
        total_wealth: Number(wealth.toFixed(2))
      });
    }
  } else if (fs.existsSync(EOD_FILE)) {
    const raw = fs.readFileSync(EOD_FILE, 'utf-8');
    const all = JSON.parse(raw);
    baseLogs = all.filter(l => l.date <= '2026-08-07');
    console.log(`Loaded ${baseLogs.length} existing base records up to 2026-08-07 from ${EOD_FILE}.`);
  }

  baseLogs.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`Loaded ${baseLogs.length} base logs from Excel. Latest Excel Date: ${baseLogs[baseLogs.length - 1]?.date}`);

  let historicalPrices = {};
  if (fs.existsSync(HISTORICAL_FILE)) {
    historicalPrices = JSON.parse(fs.readFileSync(HISTORICAL_FILE, 'utf-8'));
  }

  const holdings = await db.select('holdings');
  const inHoldings = holdings.filter(h => h.category_id === 'in_stocks' && (Number(h.quantity) || 0) > 0);
  const usHoldings = holdings.filter(h => h.category_id === 'us_stocks' && (Number(h.quantity) || 0) > 0);
  const mfHoldings = holdings.filter(h => h.category_id === 'mutual_funds' && (Number(h.quantity) || 0) > 0);
  const npsHoldings = holdings.filter(h => h.category_id === 'nps' && (Number(h.quantity) || 0) > 0);

  const lastExcelLog = baseLogs[baseLogs.length - 1] || {
    date: '2026-08-07',
    hdfc: 10619.89,
    indusind: 6733,
    idfc: 1801646.18,
    rbl: 20751,
    sbi: 1338.05,
    federal: 0,
    savings: 1841088.12,
    epf: 4606949,
    loan: 4496758,
    credits: 1862.16,
    debt: 4498620.16
  };

  // Determine current system date
  const todayStr = new Date().toISOString().slice(0, 10);
  const targetEndDate = todayStr > '2026-08-29' ? todayStr : '2026-08-29';

  let curDate = new Date(`${lastExcelLog.date}T00:00:00Z`);
  const endDate = new Date(`${targetEndDate}T00:00:00Z`);
  
  let prevLog = { ...lastExcelLog };

  // Generate daily logs from day after Excel date up to targetEndDate
  while (true) {
    curDate.setUTCDate(curDate.getUTCDate() + 1);
    if (curDate > endDate) break;
    const dateStr = curDate.toISOString().slice(0, 10);
    const fx = getHistoricalFxRate(dateStr);

    const dayOfWeek = curDate.getUTCDay(); // 0 is Sunday, 6 is Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    let inVal = 0;
    let usVal = 0;
    let mfVal = 0;
    let npsVal = 0;

    if (isWeekend) {
      // On Saturday and Sunday, all financial markets (Indian & US) are closed.
      // Carry forward the finalized Friday closing valuations and totals exactly with 0 change.
      inVal = prevLog.indian_stocks;
      usVal = prevLog.us_stocks;
      mfVal = prevLog.mutual_funds;
      npsVal = prevLog.nps;

      const newLog = {
        date: dateStr,
        hdfc: prevLog.hdfc,
        indusind: prevLog.indusind,
        idfc: prevLog.idfc,
        rbl: prevLog.rbl,
        sbi: prevLog.sbi,
        federal: prevLog.federal,
        savings: prevLog.savings,
        mutual_funds: prevLog.mutual_funds,
        indian_stocks: prevLog.indian_stocks,
        us_stocks: prevLog.us_stocks,
        nps: prevLog.nps,
        epf: prevLog.epf,
        loan: prevLog.loan,
        credits: prevLog.credits,
        debt: prevLog.debt,
        total_assets: prevLog.total_assets,
        wealth: prevLog.wealth,
        total_wealth: prevLog.total_wealth
      };

      baseLogs.push(newLog);
      prevLog = newLog;
    } else {
      const priceMap = {};
      holdings.forEach(h => {
        const prices = historicalPrices[h.symbol] || {};
        let p = prices[dateStr];
        if (p === undefined) {
          const prevDates = Object.keys(prices).filter(k => k < dateStr).sort().reverse();
          if (prevDates.length > 0) p = prices[prevDates[0]];
          else p = Number(h.current_price) || 0;
        }
        priceMap[h.symbol] = p;
      });

      // Construct current snapshot with previous bank & debt carry-forwards
      const valuation = computePortfolioValuation(holdings, [], priceMap, fx);

      const newLog = {
        date: dateStr,
        hdfc: prevLog.hdfc,
        indusind: prevLog.indusind,
        idfc: prevLog.idfc,
        rbl: prevLog.rbl,
        sbi: prevLog.sbi,
        federal: prevLog.federal,
        savings: prevLog.savings,
        mutual_funds: valuation.mutual_funds,
        indian_stocks: valuation.indian_stocks,
        us_stocks: valuation.us_stocks,
        nps: valuation.nps,
        epf: prevLog.epf,
        loan: prevLog.loan,
        credits: prevLog.credits,
        debt: prevLog.debt,
        total_assets: Number((prevLog.savings + prevLog.epf + valuation.mutual_funds + valuation.indian_stocks + valuation.us_stocks + valuation.nps).toFixed(2)),
        wealth: Number((prevLog.savings + prevLog.epf + valuation.mutual_funds + valuation.indian_stocks + valuation.us_stocks + valuation.nps - prevLog.debt).toFixed(2)),
        total_wealth: Number((prevLog.savings + prevLog.epf + valuation.mutual_funds + valuation.indian_stocks + valuation.us_stocks + valuation.nps - prevLog.debt).toFixed(2))
      };

      baseLogs.push(newLog);
      prevLog = newLog;
    }
  }

  // Calculate daily_pnl and pnl_pct for each record
  for (let i = 0; i < baseLogs.length; i++) {
    const cur = baseLogs[i];
    const prev = i > 0 ? baseLogs[i - 1] : cur;
    const pnl = cur.total_wealth - prev.total_wealth;
    const pct = prev.total_wealth !== 0 ? ((pnl / prev.total_wealth) * 100) : 0;
    cur.daily_pnl = Number(pnl.toFixed(2));
    cur.pnl_pct = Number(pct.toFixed(2));
  }

  fs.writeFileSync(EOD_FILE, JSON.stringify(baseLogs, null, 2), 'utf-8');
  console.log(`Saved ${baseLogs.length} total EOD logs to ${EOD_FILE}. Inception: ${baseLogs[0]?.date}, Latest: ${baseLogs[baseLogs.length - 1]?.date}`);

  // Upsert the recent 60 daily records directly to Supabase pnl_history
  try {
    const recentLogs = baseLogs.slice(-60);
    const dbRecords = recentLogs.map(l => {
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

    const { error } = await supabase.from('pnl_history').upsert(dbRecords, { onConflict: 'log_date' });
    if (error) {
      console.warn('[Supabase Sync Warning]:', error.message);
    } else {
      console.log(`[Supabase Sync] Successfully synchronized ${dbRecords.length} latest daily logs to Supabase pnl_history.`);
    }
  } catch (syncErr) {
    console.warn('[Supabase Sync Exception]:', syncErr.message);
  }
}

rebuildEod().then(() => process.exit(0)).catch((err) => {
  console.error('Error rebuilding EOD logs:', err);
  process.exit(1);
});
