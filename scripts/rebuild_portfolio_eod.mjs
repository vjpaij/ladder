import fs from 'fs';
import path from 'path';
import xlsx from 'xlsx';
import axios from 'axios';
import { db, initDatabase } from '../server/db.js';
import { supabase } from '../server/supabaseClient.js';
import { computePortfolioValuation } from '../server/services/portfolioCalculator.js';
import { fetchNpsHistoricalNav, isTradingDay } from '../server/services/priceEngine.js';

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

  // 1. Read base historical rows from Excel up to 2026-08-07, or fallback to JSON / Supabase for prior history
  let baseLogs = [];
  if (fs.existsSync(EXCEL_FILE)) {
    const wb = xlsx.readFile(EXCEL_FILE);
    const rawRows = xlsx.utils.sheet_to_json(wb.Sheets['Portfolio']);
    
    for (const row of rawRows) {
      const cleaned = {};
      for (const [k, v] of Object.entries(row)) cleaned[k.trim()] = v;
      if (cleaned.DATE === 'MAX') continue;
      const d = parseExcelDate(cleaned.DATE);
      if (!d || d === 'undefined' || d > '2026-08-07') continue;
      
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
  } else {
    const { data: persistedLogs } = await supabase
      .from('pnl_history')
      .select('*')
      .lte('log_date', '2026-08-07')
      .order('log_date', { ascending: true });
    if (persistedLogs && persistedLogs.length > 0) {
      baseLogs = persistedLogs.map(log => ({
        date: log.log_date,
        total_assets: log.total_assets_inr,
        debt: log.total_liabilities_inr,
        wealth: log.net_worth_inr,
        total_wealth: log.net_worth_inr,
        daily_pnl: log.daily_pnl_inr,
        pnl_pct: log.pnl_percentage,
        ...(log.breakdown || {}),
        hdfc: log.hdfc,
        indusind: log.indusind,
        idfc: log.idfc,
        rbl: log.rbl,
        sbi: log.sbi,
        federal: log.federal,
        savings: log.savings,
        mutual_funds: log.mutual_funds,
        indian_stocks: log.indian_stocks,
        us_stocks: log.us_stocks,
        nps: log.nps,
        epf: log.epf,
        loan: log.loan,
        credits: log.credits
      }));
    }
  }

  baseLogs.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`Loaded ${baseLogs.length} base logs up to Excel baseline. Baseline Date: ${baseLogs[baseLogs.length - 1]?.date}`);

  let historicalPrices = {};
  if (fs.existsSync(HISTORICAL_FILE)) {
    historicalPrices = JSON.parse(fs.readFileSync(HISTORICAL_FILE, 'utf-8'));
  }

  const holdings = await db.select('holdings');
  const inHoldings = holdings.filter(h => h.category_id === 'in_stocks' && (Number(h.quantity) || 0) > 0);
  const usHoldings = holdings.filter(h => h.category_id === 'us_stocks' && (Number(h.quantity) || 0) > 0);
  const mfHoldings = holdings.filter(h => h.category_id === 'mutual_funds' && (Number(h.quantity) || 0) > 0);
  const npsHoldings = holdings.filter(h => h.category_id === 'nps' && (Number(h.quantity) || 0) > 0);

  // 1. Fetch official Protean CRA NAVs directly from Supabase nps_daily_navs table with pagination guard
  let proteanDbNavs = [];
  let navFrom = 0;
  const navBatchSize = 1000;
  while (true) {
    const { data: batch, error } = await supabase
      .from('nps_daily_navs')
      .select('scheme_code, nav, nav_date')
      .range(navFrom, navFrom + navBatchSize - 1);
    if (error || !batch || batch.length === 0) break;
    proteanDbNavs.push(...batch);
    if (batch.length < navBatchSize) break;
    navFrom += navBatchSize;
  }
  
  const proteanMap = {};
  proteanDbNavs.forEach(r => {
    if (!proteanMap[r.scheme_code]) proteanMap[r.scheme_code] = {};
    proteanMap[r.scheme_code][r.nav_date] = Number(r.nav);
  });

  const npsHistoricalPrices = {};
  await Promise.all(npsHoldings.map(async (holding) => {
    const fallbackPrices = await fetchNpsHistoricalNav(holding.symbol);
    const fallbackObj = fallbackPrices instanceof Map ? Object.fromEntries(fallbackPrices) : (fallbackPrices || {});
    // Protean CRA official scraped NAVs strictly take priority over any third-party fallback
    npsHistoricalPrices[holding.symbol] = { ...fallbackObj, ...(proteanMap[holding.symbol] || {}) };
  }));

  // 2. Fetch latest official AMFI Mutual Fund historical NAVs in parallel
  const mfHistoricalPrices = {};
  await Promise.all(mfHoldings.map(async (holding) => {
    try {
      const res = await axios.get(`https://api.mfapi.in/mf/${holding.symbol}`, { timeout: 8000 });
      if (res.data && res.data.data) {
        const map = {};
        res.data.data.forEach(item => {
          const parts = item.date.split('-');
          if (parts.length === 3) map[`${parts[2]}-${parts[1]}-${parts[0]}`] = parseFloat(item.nav);
        });
        mfHistoricalPrices[holding.symbol] = map;
      }
    } catch (e) {
      console.warn(`[MF EOD Fetch Warning] ${holding.symbol}:`, e.message);
    }
  }));

  // Target end date: EOD logs strictly represent finalized, closed trading sessions.
  // Today's current day is actively trading and MUST compute dynamically in real-time.
  // Target end date for batch historical EOD logs is strictly yesterday.
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const targetEndDate = yesterdayStr;

  // 3. Ensure active Indian and US stocks have prices up to targetEndDate
  const symbolMap = { 'TATAMOTORS': 'TMPV.NS', 'TATAMTRDVR': 'TMPV.NS', 'SWANENERGY': '503310.BO' };
  const allEquityHoldings = [...inHoldings, ...usHoldings];
  const missingEquity = allEquityHoldings.filter(h => !historicalPrices[h.symbol] || historicalPrices[h.symbol][targetEndDate] === undefined);

  if (missingEquity.length > 0) {
    console.log(`[EOD] Fetching latest market quotes for ${missingEquity.length} equity positions missing ${targetEndDate}...`);
    for (const h of missingEquity) {
      let sym = h.symbol;
      if (h.category_id === 'in_stocks') {
        sym = symbolMap[h.symbol] || h.symbol;
        if (!sym.endsWith('.NS') && !sym.endsWith('.BO')) sym += '.NS';
      }
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`;
        const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
        const result = res.data?.chart?.result?.[0];
        if (result && result.timestamp) {
          const timestamps = result.timestamp;
          const quote = result.indicators?.quote?.[0] || {};
          const adjclose = result.indicators?.adjclose?.[0]?.adjclose || quote.close || [];
          const meta = result.meta || {};

          historicalPrices[h.symbol] = historicalPrices[h.symbol] || {};
          timestamps.forEach((t, idx) => {
            const dStr = new Date(t * 1000).toISOString().split('T')[0];
            let val = adjclose[idx] !== null && adjclose[idx] !== undefined ? adjclose[idx] : quote.close?.[idx];
            if ((val === null || val === undefined || isNaN(val) || val <= 0) && dStr === targetEndDate) {
              val = meta.chartPreviousClose || meta.previousClose;
              console.warn(`[WARN] Equity fallback used for ${h.symbol} on ${dStr}: substituted previous close ${val}`);
            }
            if (val !== null && val !== undefined && !isNaN(val) && val > 0) {
              historicalPrices[h.symbol][dStr] = Number(Number(val).toFixed(2));
            }
          });
        }
      } catch (err) {
        // Silently continue
      }
    }
    try {
      fs.writeFileSync(HISTORICAL_FILE, JSON.stringify(historicalPrices, null, 2), 'utf-8');
    } catch (e) {}
  }

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

  // Pre-load transactions and liabilities for bank/EPF/loan timeline replay
  const allTxs = await db.select('transactions');
  const allLiabilities = await db.select('liabilities');
  const hMap = Object.fromEntries(holdings.map(h => [h.id, h]));
  const lMap = Object.fromEntries(allLiabilities.map(l => [l.id, l]));

  // Index post-baseline transactions by date for chronological replay
  const txsByDate = new Map();
  allTxs.filter(t => t.date > lastExcelLog.date).forEach(t => {
    if (!txsByDate.has(t.date)) txsByDate.set(t.date, []);
    txsByDate.get(t.date).push(t);
  });

  let curHdfc = Number(lastExcelLog.hdfc || 0);
  let curIndusind = Number(lastExcelLog.indusind || 0);
  let curIdfc = Number(lastExcelLog.idfc || 0);
  let curRbl = Number(lastExcelLog.rbl || 0);
  let curSbi = Number(lastExcelLog.sbi || 0);
  let curFederal = Number(lastExcelLog.federal || 0);
  let curEpf = Number(lastExcelLog.epf || 0);
  let curLoan = Number(lastExcelLog.loan || 0);
  let curCredits = Number(lastExcelLog.credits || 0);

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
    const isMarketClosed = isWeekend || !isTradingDay(dateStr);

    // Replay any bank/EPF/liability transactions occurring on dateStr
    const todayTxs = txsByDate.get(dateStr) || [];
    todayTxs.forEach(t => {
      const amt = Number(t.total_amount) || Number(t.price) || 0;
      const type = (t.type || '').toUpperCase();
      const isPositive = ['OPENING_BALANCE', 'DEPOSIT', 'CREDIT', 'CONTRIBUTION', 'INTEREST', 'BUY'].includes(type);
      const isNegative = ['WITHDRAWAL', 'DEBIT', 'SELL'].includes(type);
      const isDebtIncr = ['OPENING_BALANCE', 'BORROW', 'DISBURSEMENT', 'CHARGE', 'EXPENSE', 'TAKE'].includes(type);
      const isDebtDecr = ['EMI_PAYMENT', 'PREPAYMENT', 'BILL_PAYMENT', 'REPAYMENT', 'PAY'].includes(type);

      const h = hMap[t.holding_id];
      if (h) {
        if (h.category_id === 'epf') {
          if (isPositive) curEpf += amt;
          else if (isNegative) curEpf -= amt;
        } else if (h.category_id === 'bank') {
          const sym = (h.symbol || h.name || '').toUpperCase();
          if (sym.includes('HDFC')) {
            if (isPositive) curHdfc += amt; else if (isNegative) curHdfc -= amt;
          } else if (sym.includes('INDUSIND')) {
            if (isPositive) curIndusind += amt; else if (isNegative) curIndusind -= amt;
          } else if (sym.includes('IDFC')) {
            if (isPositive) curIdfc += amt; else if (isNegative) curIdfc -= amt;
          } else if (sym.includes('RBL')) {
            if (isPositive) curRbl += amt; else if (isNegative) curRbl -= amt;
          } else if (sym.includes('SBI')) {
            if (isPositive) curSbi += amt; else if (isNegative) curSbi -= amt;
          } else if (sym.includes('FEDERAL')) {
            if (isPositive) curFederal += amt; else if (isNegative) curFederal -= amt;
          }
        }
      }

      if (t.liability_id) {
        const l = lMap[t.liability_id];
        const isLoan = l?.category_id === 'loans' || (l?.name || '').toLowerCase().includes('loan');
        if (isLoan) {
          if (isDebtIncr) curLoan += amt;
          else if (isDebtDecr) curLoan -= amt;
        } else {
          if (isDebtIncr) curCredits += amt;
          else if (isDebtDecr) curCredits -= amt;
        }
      }
    });

    const curSavings = Number((curHdfc + curIndusind + curIdfc + curRbl + curSbi + curFederal).toFixed(2));
    const curDebt = Number((curLoan + curCredits).toFixed(2));

    let inVal = 0;
    let usVal = 0;
    let mfVal = 0;
    let npsVal = 0;

    if (isMarketClosed) {
      // On non-trading days (weekends & market holidays), all financial markets carry forward finalized closing valuations
      inVal = prevLog.indian_stocks;
      usVal = prevLog.us_stocks;
      mfVal = prevLog.mutual_funds;
      npsVal = prevLog.nps;

      const totalAssets = Number((curSavings + curEpf + inVal + usVal + mfVal + npsVal).toFixed(2));
      const wealth = Number((totalAssets - curDebt).toFixed(2));

      const newLog = {
        date: dateStr,
        hdfc: Number(curHdfc.toFixed(2)),
        indusind: Number(curIndusind.toFixed(2)),
        idfc: Number(curIdfc.toFixed(2)),
        rbl: Number(curRbl.toFixed(2)),
        sbi: Number(curSbi.toFixed(2)),
        federal: Number(curFederal.toFixed(2)),
        savings: curSavings,
        mutual_funds: mfVal,
        indian_stocks: inVal,
        us_stocks: usVal,
        nps: npsVal,
        epf: Number(curEpf.toFixed(2)),
        loan: Number(curLoan.toFixed(2)),
        credits: Number(curCredits.toFixed(2)),
        debt: curDebt,
        total_assets: totalAssets,
        wealth: wealth,
        total_wealth: wealth
      };

      baseLogs.push(newLog);
      prevLog = newLog;
    } else {
      const priceMap = {};
      holdings.forEach(h => {
        let prices = {};
        if (h.category_id === 'nps') {
          if (npsHistoricalPrices[h.symbol] instanceof Map) {
            prices = Object.fromEntries(npsHistoricalPrices[h.symbol]);
          } else if (npsHistoricalPrices[h.symbol] && typeof npsHistoricalPrices[h.symbol] === 'object') {
            prices = npsHistoricalPrices[h.symbol];
          } else if (historicalPrices[h.symbol]) {
            prices = historicalPrices[h.symbol];
          }
        } else if (h.category_id === 'mutual_funds') {
          prices = mfHistoricalPrices[h.symbol] || historicalPrices[h.symbol] || {};
        } else {
          prices = historicalPrices[h.symbol] || {};
        }

        let p = prices[dateStr];
        if (p === undefined) {
          const prevDates = Object.keys(prices).filter(k => k < dateStr).sort().reverse();
          if (prevDates.length > 0) p = prices[prevDates[0]];
          else p = Number(h.current_price) || 0;
        }
        priceMap[h.symbol] = p;
      });

      // Construct current snapshot with dynamically replayed bank & debt balances
      const valuation = computePortfolioValuation(holdings, [], priceMap, fx);
      const totalAssets = Number((curSavings + curEpf + valuation.mutual_funds + valuation.indian_stocks + valuation.us_stocks + valuation.nps).toFixed(2));
      const wealth = Number((totalAssets - curDebt).toFixed(2));

      const newLog = {
        date: dateStr,
        hdfc: Number(curHdfc.toFixed(2)),
        indusind: Number(curIndusind.toFixed(2)),
        idfc: Number(curIdfc.toFixed(2)),
        rbl: Number(curRbl.toFixed(2)),
        sbi: Number(curSbi.toFixed(2)),
        federal: Number(curFederal.toFixed(2)),
        savings: curSavings,
        mutual_funds: valuation.mutual_funds,
        indian_stocks: valuation.indian_stocks,
        us_stocks: valuation.us_stocks,
        nps: valuation.nps,
        epf: Number(curEpf.toFixed(2)),
        loan: Number(curLoan.toFixed(2)),
        credits: Number(curCredits.toFixed(2)),
        debt: curDebt,
        total_assets: totalAssets,
        wealth: wealth,
        total_wealth: wealth
      };

      baseLogs.push(newLog);
      prevLog = newLog;
    }
  }

  // Calculate daily_pnl and pnl_pct for each record with transaction-aware weekend check
  for (let i = 0; i < baseLogs.length; i++) {
    const cur = baseLogs[i];
    const prev = i > 0 ? baseLogs[i - 1] : cur;
    const curWealth = cur.total_wealth !== undefined ? cur.total_wealth : (cur.wealth || 0);
    const prevWealth = prev.total_wealth !== undefined ? prev.total_wealth : (prev.wealth || 0);
    const rawDelta = curWealth - prevWealth;
    const isWk = (new Date(`${cur.date}T00:00:00Z`).getUTCDay() === 0 || new Date(`${cur.date}T00:00:00Z`).getUTCDay() === 6);
    const pnl = isWk ? (Math.abs(rawDelta) > 0.01 ? rawDelta : 0) : rawDelta;
    const pct = isWk
      ? (Math.abs(rawDelta) > 0.01 && prevWealth !== 0 ? ((pnl / prevWealth) * 100) : 0)
      : (prevWealth !== 0 ? ((pnl / prevWealth) * 100) : 0);
    cur.daily_pnl = Number(pnl.toFixed(2));
    cur.pnl_pct = Number(pct.toFixed(2));
    cur.total_wealth = curWealth;
    cur.wealth = curWealth;
  }

  fs.writeFileSync(EOD_FILE, JSON.stringify(baseLogs, null, 2), 'utf-8');
  console.log(`Saved ${baseLogs.length} total EOD logs to ${EOD_FILE}. Inception: ${baseLogs[0]?.date}, Latest: ${baseLogs[baseLogs.length - 1]?.date}`);

  // ---------------------------------------------------------------
  // Gap Detection: flag any trading day between first and last record
  // that has no corresponding log entry.
  // ---------------------------------------------------------------
  const logDateSet = new Set(baseLogs.map(l => l.date));
  const firstLogDate = baseLogs[0]?.date;
  const lastLogDate = baseLogs[baseLogs.length - 1]?.date;
  if (firstLogDate && lastLogDate) {
    const gapCheck = new Date(`${firstLogDate}T00:00:00Z`);
    const gapEnd = new Date(`${lastLogDate}T00:00:00Z`);
    const gaps = [];
    while (gapCheck < gapEnd) {
      gapCheck.setUTCDate(gapCheck.getUTCDate() + 1);
      const ds = gapCheck.toISOString().slice(0, 10);
      if (isTradingDay(ds, 'NSE') && !logDateSet.has(ds) && ds < lastLogDate) {
        gaps.push(ds);
      }
    }
    if (gaps.length > 0) {
      console.warn(`[EOD Gap Detection] Found ${gaps.length} trading day(s) missing from pnl_history. First few: ${gaps.slice(0, 5).join(', ')}`);
    } else {
      console.log('[EOD Gap Detection] No gaps detected. All trading days covered.');
    }
  }

  // ---------------------------------------------------------------
  // Upsert ALL rebuilt records to Supabase pnl_history in batches
  // of 500 to prevent payload limits. Previous 90-row cap removed.
  // ---------------------------------------------------------------
  try {
    const UPSERT_BATCH = 500;
    let totalUpserted = 0;

    const mapLogToDbRecord = (l) => {
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
      const totalAssets = Number((l.total_assets || ((l.total_wealth !== undefined ? l.total_wealth : l.wealth) + debt)).toFixed(2));
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
        debt,
        wealth,
        breakdown
      };
    };

    for (let i = 0; i < baseLogs.length; i += UPSERT_BATCH) {
      const chunk = baseLogs.slice(i, i + UPSERT_BATCH);
      const dbRecords = chunk.map(mapLogToDbRecord);
      const { error } = await supabase.from('pnl_history').upsert(dbRecords, { onConflict: 'log_date' });
      if (error) {
        console.warn(`[Supabase Sync Warning] Batch ${Math.floor(i / UPSERT_BATCH) + 1}:`, error.message);
      } else {
        totalUpserted += dbRecords.length;
      }
    }
    console.log(`[Supabase Sync] Successfully synchronized ${totalUpserted} of ${baseLogs.length} daily logs to Supabase pnl_history.`);
  } catch (syncErr) {
    console.warn('[Supabase Sync Exception]:', syncErr.message);
  }
}

rebuildEod().then(() => process.exit(0)).catch((err) => {
  console.error('Error rebuilding EOD logs:', err);
  process.exit(1);
});
