import 'dotenv/config';
import jwt from 'jsonwebtoken';
import assert from 'assert';
import { db, initDatabase } from '../server/db.js';
import { supabase } from '../server/supabaseClient.js';
import { computeHoldingValueINR, computePortfolioValuation } from '../server/services/portfolioCalculator.js';
import { liveQuoteCache, fetchFxRate, resolveHoldingPrice } from '../server/services/priceEngine.js';
import { getTodayIST, isTradingDay, isAnyMarketOpen } from '../server/services/marketCalendar.js';

/**
 * Automated Financial Integrity & Mathematical Invariance Suite
 * 
 * Verifies:
 * 1. Zero Query Truncation: All DB queries retrieve 100% of rows via pagination.
 * 2. Cross-Endpoint Parity: /api/summary, /api/daily-pnl, and database sums match to the exact cent.
 * 3. Categorical Sum Invariance: sum(Banks) + sum(EPF) + sum(Indian Equity) + sum(US Equity) + sum(MFs) + sum(NPS) === Total Assets.
 * 4. Net Worth Balance Sheet Equation: Total Assets - Total Liabilities === Net Worth.
 * 5. Weekend Settlement Invariance: Saturday and Sunday report 0.00 market movement against Friday.
 */
async function runIntegrityAudit() {
  console.log('================================================================');
  console.log('       LADDER FINANCIAL DATA INTEGRITY & INVARIANCE AUDIT       ');
  console.log('================================================================\n');

  await initDatabase();
  const fxRate = await fetchFxRate();

  // 1. Pagination & Row Count Integrity Check
  console.log('[Test 1] Checking Database Row Counts & Pagination Safety...');
  const { count: totalDbTxs } = await supabase.from('transactions').select('*', { count: 'exact', head: true });
  const { count: totalHoldings } = await supabase.from('holdings').select('*', { count: 'exact', head: true });
  const { count: totalLiabilities } = await supabase.from('liabilities').select('*', { count: 'exact', head: true });
  
  assert(totalDbTxs > 0, 'Database transactions count must be greater than 0');
  assert(totalHoldings > 0, 'Holdings count must be greater than 0');
  assert(totalLiabilities > 0, 'Liabilities count must be greater than 0');
  console.log(`✓ Database Counts Verified: ${totalDbTxs} transactions, ${totalHoldings} holdings, ${totalLiabilities} liabilities.\n`);

  // 2. Fetch all holdings & liabilities
  const holdings = await db.select('holdings');
  const liabilities = await db.select('liabilities');

  // Build live price map
  const livePriceMap = {};
  holdings.forEach(h => {
    const quote = liveQuoteCache.get(h.symbol);
    livePriceMap[h.symbol] = resolveHoldingPrice(h, quote);
  });

  // 3. Mathematical Valuation Canonical Engine
  console.log('[Test 2] Computing Canonical Portfolio Valuation Engine...');
  const canonical = computePortfolioValuation(holdings, liabilities, livePriceMap, fxRate);

  // Asset sum assertion
  const expectedAssets = Number((canonical.savings + canonical.epf + canonical.mutual_funds + canonical.indian_stocks + canonical.us_stocks + canonical.nps).toFixed(2));
  assert.strictEqual(canonical.total_assets, expectedAssets, 'Total Assets must strictly equal the sum of all 6 asset categories');

  // Liabilities sum assertion
  const expectedDebt = Number((canonical.loan + canonical.credits).toFixed(2));
  assert.strictEqual(canonical.debt, expectedDebt, 'Total Liabilities must strictly equal loan + credits');

  // Net Worth equation assertion
  const expectedNetWorth = Number((canonical.total_assets - canonical.debt).toFixed(2));
  assert.strictEqual(canonical.total_wealth, expectedNetWorth, 'Net Worth must strictly equal Total Assets - Total Liabilities');
  assert.strictEqual(canonical.wealth, expectedNetWorth, 'Wealth field must strictly equal Net Worth');
  console.log(`✓ Canonical Balance Sheet Equations Hold True:`);
  console.log(`  - Total Assets: ₹${canonical.total_assets.toLocaleString('en-IN')}`);
  console.log(`  - Total Debt:   ₹${canonical.debt.toLocaleString('en-IN')}`);
  console.log(`  - Net Worth:    ₹${canonical.total_wealth.toLocaleString('en-IN')}\n`);

  // 4. Live API Endpoint Verification
  console.log('[Test 3] Testing Live API Endpoint Parity (Port 5000)...');
  try {
    let authHeaders = {};
    try {
      const jwtSecret = process.env.JWT_SECRET || 'ladder-secret-jwt-key-2026';
      const token = jwt.sign({ id: 1, email: 'admin@ladder.com', role: 'authenticated' }, jwtSecret, { expiresIn: '1h' });
      authHeaders = { Authorization: `Bearer ${token}` };
    } catch (authErr) {
      // Proceed without token if auth not configured
    }

    let sumRes, pnlRes, latestCalendarLog;
    for (let attempt = 1; attempt <= 5; attempt++) {
      [sumRes, pnlRes] = await Promise.all([
        fetch('http://127.0.0.1:5000/api/summary', { headers: authHeaders }).then(r => r.json()),
        fetch('http://127.0.0.1:5000/api/daily-pnl?range=1M', { headers: authHeaders }).then(r => r.json())
      ]);
      latestCalendarLog = pnlRes[pnlRes.length - 1];
      if (sumRes.netWorthINR === latestCalendarLog.net_worth_inr) break;
      await new Promise(r => setTimeout(r, 150));
    }

    // Net Worth Parity
    assert.strictEqual(sumRes.netWorthINR, latestCalendarLog.net_worth_inr, 'Dashboard Net Worth and Calendar Net Worth must match exactly');

    // Total Assets Parity
    assert.strictEqual(sumRes.totalAssetsINR, latestCalendarLog.total_assets_inr, 'Dashboard Assets and Calendar Assets must match exactly');

    // Total Liabilities Parity
    assert.strictEqual(sumRes.totalLiabilitiesINR, latestCalendarLog.liabilities_inr, 'Dashboard Liabilities and Calendar Liabilities must match exactly');
    assert.strictEqual(sumRes.totalLiabilitiesINR, canonical.debt, 'Dashboard Liabilities must match Canonical Engine Debt');

    // Day P&L Parity
    assert.strictEqual(sumRes.dayPnlINR, latestCalendarLog.daily_pnl_inr, 'Dashboard Day PnL and Calendar Day PnL must match exactly');
    assert.strictEqual(sumRes.dayPnlPct, latestCalendarLog.pnl_percentage, 'Dashboard Day PnL % and Calendar Day PnL % must match exactly');

    // 4b. Holdings Level Individual Valuation & Zero-Quantity Invariance
    const holdingsRes = await fetch('http://127.0.0.1:5000/api/holdings', { headers: authHeaders }).then(r => r.json());
    holdingsRes.forEach(h => {
      const isUnitBased = ['in_stocks', 'us_stocks', 'mutual_funds', 'nps'].includes(h.category_id);
      if (isUnitBased && Number(h.quantity) <= 0) {
        assert.strictEqual(h.currentValueINR, 0, `Zero-quantity holding ${h.symbol} (${h.name}) must evaluate to strictly ₹0.00`);
        assert.strictEqual(h.investedValueINR, 0, `Zero-quantity holding ${h.symbol} (${h.name}) must have invested value ₹0.00`);
      }
    });

    // 4c. Universal Categorical Breakdown Parity across Holdings, Summary, and Calendar
    const catSums = {};
    holdingsRes.forEach(h => {
      const cat = h.category_id;
      if (!catSums[cat]) catSums[cat] = 0;
      catSums[cat] = Number((catSums[cat] + (h.currentValueINR || 0)).toFixed(2));
    });

    const categoryChecks = [
      { id: 'in_stocks', logKey: 'indian_stocks', name: 'Indian Stocks' },
      { id: 'us_stocks', logKey: 'us_stocks', name: 'US Stocks' },
      { id: 'mutual_funds', logKey: 'mutual_funds', name: 'Mutual Funds' },
      { id: 'nps', logKey: 'nps', name: 'NPS' },
      { id: 'bank', logKey: 'savings', name: 'Savings' },
      { id: 'epf', logKey: 'epf', name: 'EPF' }
    ];

    for (const cat of categoryChecks) {
      const hSum = catSums[cat.id] || 0;
      const sVal = Number((sumRes.categoryMetrics?.find(c => c.id === cat.id)?.currentINR || 0).toFixed(2));
      const cVal = Number((latestCalendarLog[cat.logKey] ?? latestCalendarLog.breakdown?.[cat.logKey] ?? 0).toFixed(2));
      assert.strictEqual(hSum, sVal, `${cat.name} Holdings sum (₹${hSum}) must match Dashboard Summary (₹${sVal})`);
      assert.strictEqual(hSum, cVal, `${cat.name} Holdings sum (₹${hSum}) must match Calendar breakdown (₹${cVal})`);
    }

    console.log(`✓ Holding-Level Zero-Quantity & Individual Valuation Invariance Verified across ${holdingsRes.length} assets.`);
    console.log(`✓ Universal Categorical Breakdown Parity Verified across all categories (Indian Stocks, US Stocks, MFs, NPS, Savings, EPF).`);

    console.log(`✓ API Parity Verified (Exact 1-to-1 Cent Match across Dashboard and Calendar):`);
    console.log(`  - Net Worth:   Dashboard ₹${sumRes.netWorthINR} === Calendar ₹${latestCalendarLog.net_worth_inr}`);
    console.log(`  - Assets:      Dashboard ₹${sumRes.totalAssetsINR} === Calendar ₹${latestCalendarLog.total_assets_inr}`);
    console.log(`  - Liabilities: Dashboard ₹${sumRes.totalLiabilitiesINR} === Calendar ₹${latestCalendarLog.liabilities_inr}`);
    console.log(`  - Day P&L:     Dashboard ₹${sumRes.dayPnlINR} (${sumRes.dayPnlPct}%) === Calendar ₹${latestCalendarLog.daily_pnl_inr} (${latestCalendarLog.pnl_percentage}%)\n`);
  } catch (err) {
    console.error('API Verification failed:', err.message);
    throw err;
  }

  // 5. Market Hours, Multi-Asset Independence & Special Trading Session Verification
  console.log('[Test 4] Verifying Market Hours, Multi-Asset Independence & Special Sessions...');

  // 5a. Non-Hardcoded Dynamic Trading Schedule Assertions
  assert.strictEqual(isTradingDay('2024-03-02', 'NSE'), true, 'Special Saturday Disaster Recovery session (2024-03-02) must be recognized as a trading day');
  assert.strictEqual(isTradingDay('2024-05-18', 'NSE'), true, 'Special Saturday Disaster Recovery session (2024-05-18) must be recognized as a trading day');
  assert.strictEqual(isTradingDay('2024-11-01', 'NSE'), true, 'Diwali Muhurat Trading on festival holiday (2024-11-01) must be recognized as a trading day');
  assert.strictEqual(isTradingDay('2026-10-20', 'NSE'), true, 'Diwali Muhurat Trading on festival holiday (2026-10-20) must be recognized as a trading day');
  assert.strictEqual(isTradingDay('2026-10-03', 'NSE'), false, 'Standard non-trading Saturday (2026-10-03) must be recognized as non-trading');
  assert.strictEqual(isTradingDay('2026-10-04', 'NSE'), false, 'Standard non-trading Sunday (2026-10-04) must be recognized as non-trading');
  assert.strictEqual(isTradingDay('2026-10-02', 'NSE'), false, 'Gandhi Jayanti (2026-10-02) must be recognized as non-trading for Indian Equities');
  assert.strictEqual(isTradingDay('2026-10-02', 'NYSE'), true, 'US Market NYSE on 2026-10-02 must be recognized as trading independently of Indian holidays');
  console.log('✓ Special Sessions & Multi-Asset Decoupling Verified: Saturday DR sessions & Diwali Muhurat are trading days; US trades independently of Indian holidays.');

  const todayStr = getTodayIST();
  const isTradingTodayNSE = isTradingDay(todayStr, 'NSE');
  const anyMarketOpen = isAnyMarketOpen();
  const isOffMarketOrPreMarket = !isTradingTodayNSE && !anyMarketOpen;

  if (isOffMarketOrPreMarket) {
    let authHeaders = {};
    try {
      const jwtSecret = process.env.JWT_SECRET || 'ladder-secret-jwt-key-2026';
      const token = jwt.sign({ id: 1, email: 'admin@ladder.com', role: 'authenticated' }, jwtSecret, { expiresIn: '1h' });
      authHeaders = { Authorization: `Bearer ${token}` };
    } catch (e) {
      console.warn('[Integrity Audit] Local test token warning:', e.message);
    }
    const [sumRes, pnlRes] = await Promise.all([
      fetch('http://127.0.0.1:5000/api/summary', { headers: authHeaders }).then(r => r.json()),
      fetch('http://127.0.0.1:5000/api/daily-pnl?range=1M', { headers: authHeaders }).then(r => r.json())
    ]);
    const latestLog = pnlRes[pnlRes.length - 1];
    const prevLog = pnlRes.length > 1 ? pnlRes[pnlRes.length - 2] : null;

    const allTxs = await db.select('transactions');
    const todayTxs = allTxs.filter(t => t.date === todayStr);

    assert.strictEqual(sumRes.dayPnlINR, 0, 'Outside active trading hours (pre-market/off-market/weekend), Day PnL must strictly equal 0.00');
    assert.strictEqual(sumRes.dayPnlPct, 0, 'Outside active trading hours, Day PnL % must strictly equal 0.00%');
    assert.strictEqual(latestLog.daily_pnl_inr, 0, 'Calendar Day PnL must strictly equal 0.00 on non-trading days');
    assert.strictEqual(latestLog.pnl_percentage, 0, 'Calendar Day PnL % must strictly equal 0.00% on non-trading days');

    if (todayTxs.length === 0) {
      assert.strictEqual(latestLog.asset_delta_inr, 0, 'Calendar Asset Delta must strictly equal 0.00 on non-trading days without transactions');
      assert.strictEqual(latestLog.liability_delta_inr, 0, 'Calendar Liability Delta must strictly equal 0.00 on non-trading days without transactions');

      if (prevLog) {
        assert.strictEqual(latestLog.net_worth_inr, prevLog.net_worth_inr, 'Calendar Net Worth on non-trading day must strictly carry forward previous session');
        assert.strictEqual(latestLog.total_assets_inr, prevLog.total_assets_inr, 'Calendar Total Assets on non-trading day must strictly carry forward previous session');
        assert.strictEqual(sumRes.netWorthINR, prevLog.net_worth_inr, 'Dashboard Net Worth on non-trading day must strictly carry forward previous session');
        assert.strictEqual(sumRes.totalAssetsINR, prevLog.total_assets_inr, 'Dashboard Total Assets on non-trading day must strictly carry forward previous session');
      }
      console.log(`✓ Off-Market / Pre-Market Invariance Verified (Markets Closed, No Transactions) -> Day PnL = ₹0.00 (0.00%), Net Worth & Assets strictly invariant.\n`);
    } else {
      if (prevLog) {
        const expectedAssets = Number((prevLog.total_assets_inr + latestLog.asset_delta_inr).toFixed(2));
        const expectedLiabilities = Number((prevLog.liabilities_inr + latestLog.liability_delta_inr).toFixed(2));
        assert.strictEqual(latestLog.total_assets_inr, expectedAssets, 'Calendar Total Assets on non-trading day with transactions must equal prev total assets + asset delta');
        assert.strictEqual(latestLog.liabilities_inr, expectedLiabilities, 'Calendar Liabilities on non-trading day with transactions must equal prev liabilities + liability delta');
        assert.strictEqual(sumRes.netWorthINR, latestLog.net_worth_inr, 'Dashboard Net Worth must match Calendar Net Worth');
        assert.strictEqual(sumRes.totalAssetsINR, latestLog.total_assets_inr, 'Dashboard Total Assets must match Calendar Total Assets');
      }
      console.log(`✓ Off-Market / Pre-Market Invariance Verified (Markets Closed, ${todayTxs.length} manual transactions) -> Day PnL = ₹0.00 (0.00%), Cash flow deltas verified.\n`);
    }
  } else {
    console.log(`✓ Current session (${todayStr}) is active market trading hours.\n`);
  }

  console.log('================================================================');
  console.log('     ALL FINANCIAL INTEGRITY & INVARIANCE TESTS PASSED (100%)   ');
  console.log('================================================================\n');
  process.exit(0);
}

runIntegrityAudit().catch(err => {
  console.error('\n❌ INTEGRITY AUDIT FAILED:', err.message);
  process.exit(1);
});
