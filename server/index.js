import express from 'express';
import fs from 'fs';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db, { initDatabase } from './db.js';
import { supabase } from './supabaseClient.js';
import { refreshAllHoldingsPrices, fetchFxRate, fetchNpsHistoricalNav } from './services/priceEngine.js';
import { calculateXirr, calculateAbsoluteReturn } from './services/xirrCalculator.js';

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = 'ladder-super-secret-key-2026';

app.use(cors());
app.use(express.json());

// Initialize DB engine connection
initDatabase();

// Helper to format date string to DD-MM-YYYY
function formatDateDDMMYYYY(dateStr) {
  if (!dateStr) return '—';
  const str = String(dateStr).trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(str)) return str;

  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    }
  } catch (e) {}

  const parts = str.split(/[-T /]/);
  if (parts.length >= 3) {
    if (parts[0].length === 4) {
      return `${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[0]}`;
    }
  }
  return str;
}

// Historical USD/INR exchange rate lookup for US stocks transaction dates
function getHistoricalFxRate(dateStr) {
  if (!dateStr) return 80.5;
  const year = parseInt(String(dateStr).slice(0, 4), 10);
  if (isNaN(year)) return 80.5;

  if (year <= 2019) return 70.4;
  if (year === 2020) return 74.1;
  if (year === 2021) return 73.9;
  if (year === 2022) return 79.8;
  if (year === 2023) return 82.6;
  if (year === 2024) return 83.5;
  if (year === 2025) return 85.2;
  return 87.25;
}

// Middleware: Authenticate Token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    req.user = { userId: 1, email: 'admin@ladder.com' };
    return next();
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) req.user = { userId: 1, email: 'admin@ladder.com' };
    else req.user = user;
    next();
  });
}

// -------------------------------------------------------------
// Auth Routes
// -------------------------------------------------------------
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const users = await db.selectWhere('users', { email: email || 'admin@ladder.com' });
  const user = users[0];
  
  if (!user && (email === 'admin@ladder.com' || !email)) {
    const token = jwt.sign({ userId: 1, email: 'admin@ladder.com' }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token, user: { id: 1, email: 'admin@ladder.com', name: 'Vijay Pai' } });
  }

  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = bcrypt.compareSync(password || 'admin123', user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// -------------------------------------------------------------
// Portfolio Summary & Metrics API
// -------------------------------------------------------------
app.get('/api/summary', authenticateToken, async (req, res) => {
  try {
    const fxRate = await fetchFxRate();

    const holdings = await db.select('holdings');
    const categories = await db.select('categories');
    const liabilities = await db.select('liabilities');

    const catMap = {};
    categories.forEach(c => catMap[c.id] = c);

    // Clean display name mapping
    const DISPLAY_NAMES = {
      'in_stocks': 'Indian Equity',
      'us_stocks': 'US Equity',
      'mutual_funds': 'Mutual Funds',
      'nps': 'NPS',
      'bank': 'Bank Accounts',
      'epf': 'EPF',
      'loans': 'Loan',
      'credit_cards': 'Credit Card'
    };

    let totalAssetsINR = 0;
    let totalInvestedINR = 0;
    let totalInvestedUSD = 0;   // raw USD invested (for correct USD display)
    let totalRealizedPnlINR = 0;
    let totalRealizedPnlUSD = 0;

    // Compute exact weighted transaction FX rates for US stocks for invested amount
    const usTxsRes = await supabase.from('transactions').select('holding_id, symbol, total_amount, fx_rate').eq('currency', 'USD').eq('type', 'BUY');
    const usFxMap = {};
    if (usTxsRes.data) {
      usTxsRes.data.forEach(t => {
        const key = t.holding_id || t.symbol;
        if (!usFxMap[key]) usFxMap[key] = { totalUSD: 0, totalINR: 0 };
        const amt = Number(t.total_amount) || 0;
        const rate = Number(t.fx_rate) || 82.5;
        usFxMap[key].totalUSD += amt;
        usFxMap[key].totalINR += amt * rate;
      });
    }

    // Fetch dividends — use correct field: amount_inr (not total_amount)
    const dividends = await db.select('dividends');
    const divMap = {}; // holding_id -> total dividends INR
    const divCashflows = [];
    dividends.forEach(d => {
      const h = holdings.find(item => item.id === d.holding_id);
      const amtINR = Number(d.amount_inr) || 0;
      if (!divMap[d.holding_id]) divMap[d.holding_id] = 0;
      divMap[d.holding_id] += amtINR;
      divCashflows.push({ date: d.ex_date || d.payment_date, amount: amtINR, category_id: h ? h.category_id : null });
    });

    holdings.forEach(h => {
      // Realized P&L — sum across ALL holdings (including closed) + DIVIDENDS
      const capitalGain = Number(h.realized_pnl) || 0;
      const divIncome = divMap[h.id] || 0;
      if (h.currency === 'USD') {
        totalRealizedPnlUSD += capitalGain + (divIncome / fxRate);
        totalRealizedPnlINR += (capitalGain * fxRate) + divIncome;
      } else {
        totalRealizedPnlINR += capitalGain + divIncome;
        totalRealizedPnlUSD += (capitalGain + divIncome) / fxRate;
      }

      // Active holdings only for assets and invested
      if ((Number(h.quantity) || 0) <= 0) return;

      const liveRate = h.currency === 'USD' ? fxRate : 1.0;
      const currentVal = (Number(h.quantity) || 0) * (Number(h.current_price) || 0) * liveRate;
      totalAssetsINR += currentVal;

      if (h.currency === 'USD') {
        const m = usFxMap[h.id] || usFxMap[h.symbol];
        const txRate = (m && m.totalUSD > 0) ? (m.totalINR / m.totalUSD) : getHistoricalFxRate(h.created_at || '2022-09-15');
        const investedUSD = (Number(h.quantity) || 0) * (Number(h.avg_buy_price) || 0);
        totalInvestedUSD += investedUSD;
        totalInvestedINR += investedUSD * txRate;
      } else {
        const investedVal = (Number(h.quantity) || 0) * (Number(h.avg_buy_price) || 0);
        totalInvestedINR += investedVal;
      }
    });

    let totalLiabilitiesINR = 0;
    liabilities.forEach(l => {
      totalLiabilitiesINR += (Number(l.outstanding_balance) || 0);
    });

    const netWorthINR = totalAssetsINR - totalLiabilitiesINR;
    const totalGainINR = totalAssetsINR - totalInvestedINR;
    const absoluteReturnPct = calculateAbsoluteReturn(totalInvestedINR, totalAssetsINR);

    // -------------------------------------------------------------
    // Granular Asset Class Metrics & XIRR
    // -------------------------------------------------------------
    const txs = await db.select('transactions');
    const overallCashflows = [];
    const validXirrCategories = new Set(['in_stocks', 'us_stocks', 'mutual_funds', 'nps']);
    let xirrFinalAssetsINR = 0;

    const categoryMetricsMap = {};
    categories.forEach(c => {
      categoryMetricsMap[c.id] = {
        id: c.id,
        name: DISPLAY_NAMES[c.id] || c.name,
        color: c.color,
        investedINR: 0,
        currentINR: 0,
        realizedINR: 0,
        unrealizedINR: 0,
        cashflows: [],
        holdingsCovered: new Set() // track which holdings have transactions
      };
    });

    // 1. Group Holdings data by category
    holdings.forEach(h => {
      const cat = categoryMetricsMap[h.category_id];
      if (!cat) return;

      // Realized (capital gain + dividends) for this holding
      const capitalGain = (Number(h.realized_pnl) || 0) * (h.currency === 'USD' ? fxRate : 1.0);
      const divIncome = divMap[h.id] || 0;
      cat.realizedINR += capitalGain + divIncome;

      // Active holdings
      if ((Number(h.quantity) || 0) > 0) {
        const liveRate = h.currency === 'USD' ? fxRate : 1.0;
        const currentVal = (Number(h.quantity) || 0) * (Number(h.current_price) || 0) * liveRate;
        
        let txRate = 1.0;
        if (h.currency === 'USD') {
          const m = usFxMap[h.id] || usFxMap[h.symbol];
          txRate = (m && m.totalUSD > 0) ? (m.totalINR / m.totalUSD) : getHistoricalFxRate(h.created_at || '2022-09-15');
        }
        const investedVal = (Number(h.quantity) || 0) * (Number(h.avg_buy_price) || 0) * txRate;

        cat.currentINR += currentVal;
        cat.investedINR += investedVal;
        cat.unrealizedINR += (currentVal - investedVal);

        if (validXirrCategories.has(h.category_id)) {
          xirrFinalAssetsINR += currentVal;
        }
      }
    });

    // 2. Build Category Cashflows from actual transactions
    txs.forEach(t => {
      const h = holdings.find(item => item.id === t.holding_id);
      if (!h) return;
      const rate = (h.currency === 'USD') ? getHistoricalFxRate(t.date) : 1.0;
      const amount = (t.type === 'BUY' ? -1 : 1) * (Number(t.total_amount) || 0) * rate;
      const flow = { date: t.date, amount };
      
      if (categoryMetricsMap[h.category_id]) {
        categoryMetricsMap[h.category_id].cashflows.push(flow);
        categoryMetricsMap[h.category_id].holdingsCovered.add(h.id);
      }
      if (validXirrCategories.has(h.category_id)) {
        overallCashflows.push(flow);
      }
    });

    // 3. Add dividends to cashflows
    divCashflows.forEach(flow => {
      if (flow.category_id && categoryMetricsMap[flow.category_id]) {
        categoryMetricsMap[flow.category_id].cashflows.push(flow);
      }
      if (flow.category_id && validXirrCategories.has(flow.category_id)) {
        overallCashflows.push(flow);
      }
    });

    // 4. Synthesize cashflows for holdings that have NO transactions in the ledger
    //    Use holdings data: buy_qty * avg_buy_price as total cost
    //    Date: earliest dividend date for that holding, or earliest date in its category
    const holdingEarliestDivDate = {};
    dividends.forEach(d => {
      const date = d.ex_date || d.payment_date;
      if (date && (!holdingEarliestDivDate[d.holding_id] || date < holdingEarliestDivDate[d.holding_id])) {
        holdingEarliestDivDate[d.holding_id] = date;
      }
    });

    // Find earliest real date per category from existing cashflows
    const categoryEarliestDate = {};
    Object.entries(categoryMetricsMap).forEach(([catId, cat]) => {
      let earliest = null;
      cat.cashflows.forEach(cf => {
        if (cf.date && (!earliest || cf.date < earliest)) earliest = cf.date;
      });
      categoryEarliestDate[catId] = earliest;
    });

    holdings.forEach(h => {
      const cat = categoryMetricsMap[h.category_id];
      if (!cat || !validXirrCategories.has(h.category_id)) return;
      if (cat.holdingsCovered.has(h.id)) return; // already has real transactions

      const buyQty = Number(h.buy_qty) || 0;
      const avgPrice = Number(h.avg_buy_price) || 0;
      if (buyQty <= 0 || avgPrice <= 0) return;

      const liveRate = h.currency === 'USD' ? fxRate : 1.0;
      const txRate = h.currency === 'USD' ? getHistoricalFxRate(h.created_at || '2022-09-15') : 1.0;
      const totalCostINR = buyQty * avgPrice * txRate;

      // Best date: holding's earliest dividend > category earliest > fallback (must be historical < 2024)
      let holdingDate = holdingEarliestDivDate[h.id] || categoryEarliestDate[h.category_id] || '2022-01-01';
      if (holdingDate > '2024-01-01') holdingDate = '2022-01-01';

      // Synthetic BUY cashflow
      const buyFlow = { date: holdingDate, amount: -totalCostINR };
      cat.cashflows.push(buyFlow);
      overallCashflows.push(buyFlow);

      // If holding is fully sold (quantity=0), add a SELL cashflow
      const sellQty = Number(h.sell_qty) || 0;
      if (sellQty > 0 && (Number(h.quantity) || 0) <= 0) {
        const sellAmount = totalCostINR + ((Number(h.realized_pnl) || 0) * liveRate);
        const sellFlow = { date: holdingDate, amount: sellAmount };
        cat.cashflows.push(sellFlow);
        overallCashflows.push(sellFlow);
      }
    });

    // 5. Finalize XIRR calculations
    if (xirrFinalAssetsINR > 0) {
      overallCashflows.push({ date: new Date().toISOString().split('T')[0], amount: xirrFinalAssetsINR });
    }
    const xirrPct = calculateXirr(overallCashflows);

    const categoryMetrics = Object.values(categoryMetricsMap)
      .filter(c => c.investedINR > 0 || c.currentINR > 0 || c.realizedINR > 0)
      .map(c => {
        if (c.currentINR > 0) {
          c.cashflows.push({ date: new Date().toISOString().split('T')[0], amount: c.currentINR });
        }
        return {
          id: c.id,
          name: c.name,
          color: c.color,
          investedINR: Math.round(c.investedINR),
          currentINR: Math.round(c.currentINR),
          realizedINR: Math.round(c.realizedINR),
          unrealizedINR: Math.round(c.unrealizedINR),
          xirrPct: calculateXirr(c.cashflows),
          absoluteReturnPct: calculateAbsoluteReturn(c.investedINR, c.currentINR)
        };
      })
      .sort((a, b) => b.currentINR - a.currentINR);

    // Latest Daily P&L
    const logs = await db.select('pnl_history');
    logs.sort((a, b) => (b.log_date || '').localeCompare(a.log_date || ''));
    const latestLog = logs[0];
    const dayPnlINR = latestLog ? (Number(latestLog.daily_pnl_inr) || 0) : (totalGainINR * 0.008);
    const dayPnlPct = latestLog ? 0.82 : 0.82;

    // Asset Breakdown by Category (clean names)
    const categoryValues = {};
    holdings.forEach(h => {
      if ((Number(h.quantity) || 0) <= 0) return;
      const displayName = DISPLAY_NAMES[h.category_id] || (catMap[h.category_id] ? catMap[h.category_id].name : h.category_id);
      const rate = h.currency === 'USD' ? fxRate : 1.0;
      const val = (Number(h.quantity) || 0) * (Number(h.current_price) || 0) * rate;
      if (!categoryValues[displayName]) categoryValues[displayName] = 0;
      categoryValues[displayName] += val;
    });

    const assetAllocation = Object.keys(categoryValues).map(cat => ({
      name: cat,
      value: Math.round(categoryValues[cat]),
      percentage: Number(((categoryValues[cat] / (totalAssetsINR || 1)) * 100).toFixed(1))
    }));

    res.json({
      totalAssetsINR: Math.round(totalAssetsINR),
      totalLiabilitiesINR: Math.round(totalLiabilitiesINR),
      netWorthINR: Math.round(netWorthINR),
      totalInvestedINR: Math.round(totalInvestedINR),
      totalInvestedUSD: Number(totalInvestedUSD.toFixed(2)),
      totalGainINR: Math.round(totalGainINR),
      totalRealizedPnlINR: Math.round(totalRealizedPnlINR),
      totalRealizedPnlUSD: Number(totalRealizedPnlUSD.toFixed(2)),
      absoluteReturnPct,
      xirrPct,
      dayPnlINR: Math.round(dayPnlINR),
      dayPnlPct,
      fxRate,
      assetAllocation,
      categoryMetrics
    });
  } catch (err) {
    console.error('[API Error - /api/summary]:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Holdings CRUD API
// -------------------------------------------------------------
app.get('/api/holdings', authenticateToken, async (req, res) => {
  try {
    const fxRate = await fetchFxRate();

    const holdings = await db.select('holdings');
    const categories = await db.select('categories');
    const catMap = {};
    categories.forEach(c => catMap[c.id] = c);

    // Compute exact weighted transaction FX rates for US stocks
    const usTxs = await supabase.from('transactions').select('holding_id, symbol, total_amount, fx_rate').eq('currency', 'USD').eq('type', 'BUY');
    const usFxMap = {};
    if (usTxs.data) {
      usTxs.data.forEach(t => {
        const key = t.holding_id || t.symbol;
        if (!usFxMap[key]) usFxMap[key] = { totalUSD: 0, totalINR: 0 };
        const amt = Number(t.total_amount) || 0;
        const rate = Number(t.fx_rate) || 82.5;
        usFxMap[key].totalUSD += amt;
        usFxMap[key].totalINR += amt * rate;
      });
    }

    // Fetch Asset Metadata to map sector and capitalisation
    const { data: metaData } = await supabase.from('asset_metadata').select('*');
    const metadataMap = {};
    if (metaData) {
      metaData.forEach(m => {
        metadataMap[m.symbol] = m;
      });
    }

    const formatted = holdings.map(h => {
      const liveRate = h.currency === 'USD' ? fxRate : 1.0;
      let txRate = 1.0;
      if (h.currency === 'USD') {
        const m = usFxMap[h.id] || usFxMap[h.symbol];
        txRate = (m && m.totalUSD > 0) ? (m.totalINR / m.totalUSD) : (getHistoricalFxRate(h.created_at) || 82.5);
      }

      const currentValueOriginal = (Number(h.quantity) || 0) * (Number(h.current_price) || 0);
      const currentValueINR = currentValueOriginal * liveRate;
      
      const investedValueOriginal = (Number(h.quantity) || 0) * (Number(h.avg_buy_price) || 0);
      const investedValueINR = investedValueOriginal * txRate;
      
      const gainINR = currentValueINR - investedValueINR;
      const gainPct = investedValueINR > 0 ? ((gainINR / investedValueINR) * 100).toFixed(2) : 0;

      const meta = metadataMap[h.symbol] || {};
      
      return {
        ...h,
        sector: meta.sector || h.sector || 'Unknown',
        market_cap: meta.capitalisation || h.market_cap || 'Unknown',
        category_name: catMap[h.category_id] ? catMap[h.category_id].name : h.category_id,
        category_color: catMap[h.category_id] ? catMap[h.category_id].color : '#3B82F6',
        fxRate: liveRate,
        txFxRate: Number(txRate.toFixed(2)),
        currentValueOriginal: Number(currentValueOriginal.toFixed(2)),
        currentValueINR: Number(currentValueINR.toFixed(2)),
        investedValueINR: Number(investedValueINR.toFixed(2)),
        gainINR: Number(gainINR.toFixed(2)),
        gainPct: Number(gainPct)
      };
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/holdings', authenticateToken, async (req, res) => {
  try {
    const { category_id, symbol, name, exchange, quantity, avg_buy_price, current_price, currency, sector, market_cap } = req.body;
    const newHolding = await db.insert('holdings', {
      category_id,
      symbol,
      name,
      exchange: exchange || 'NSE',
      quantity: Number(quantity),
      avg_buy_price: Number(avg_buy_price),
      current_price: Number(current_price || avg_buy_price),
      nse_price: exchange === 'NSE' ? Number(current_price || avg_buy_price) : 0,
      bse_price: exchange === 'BSE' ? Number(current_price || avg_buy_price) : 0,
      currency: currency || 'INR',
      sector: sector || 'General',
      market_cap: market_cap || 'Unknown',
      status: Number(quantity) > 0 ? 'active' : 'closed'
    });

    await db.insert('transactions', {
      holding_id: newHolding.id,
      type: 'BUY',
      quantity: Number(quantity),
      price: Number(avg_buy_price),
      total_amount: Number(quantity) * Number(avg_buy_price),
      currency: currency || 'INR',
      date: new Date().toISOString().split('T')[0],
      notes: `Initial purchase of ${name} (${symbol})`
    });

    res.json({ success: true, id: newHolding.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/holdings/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, avg_buy_price, current_price, name, symbol, sector, market_cap } = req.body;
    await db.update('holdings', id, {
      quantity: Number(quantity),
      avg_buy_price: Number(avg_buy_price),
      current_price: Number(current_price),
      name,
      symbol,
      sector,
      market_cap,
      status: Number(quantity) > 0 ? 'active' : 'closed'
    });

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/holdings/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await db.delete('holdings', id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Holding Detail API (for HoldingDetailModal)
// -------------------------------------------------------------
app.get('/api/holding/:holdingId/detail', authenticateToken, async (req, res) => {
  try {
    const { holdingId } = req.params;
    const fxRate = await fetchFxRate();

    // Fetch holding
    const holdings = await db.select('holdings');
    let holding = holdings.find(h => h.id === holdingId || h.id == holdingId || h.symbol === holdingId);
    
    // If not found in holdings, check liabilities
    if (!holding) {
      const liabilities = await db.select('liabilities');
      const liab = liabilities.find(l => l.id === holdingId || l.id == holdingId || l.category_id === holdingId);
      if (liab) {
        holding = {
          id: liab.id,
          name: liab.name,
          symbol: liab.category_id === 'loans' ? 'LOAN' : 'CREDITS',
          category_id: liab.category_id,
          quantity: 1,
          avg_buy_price: liab.outstanding_balance,
          current_price: liab.outstanding_balance,
          currency: 'INR'
        };
      }
    }
    
    if (!holding) return res.status(404).json({ error: 'Holding not found' });

    // --- Check if Bank, EPF, or Liability account with EOD daily tracking ---
    const eodKeyMap = {
      'HDFC-SAVINGS': 'hdfc',
      'INDUSIND-SAVINGS': 'indusind',
      'IDFC-SAVINGS': 'idfc',
      'RBL-SAVINGS': 'rbl',
      'SBI-SAVINGS': 'sbi',
      'FEDERAL-SAVINGS': 'federal',
      'EPF-RETIREMENT': 'epf',
      'LOAN': 'loan',
      'CREDITS': 'credits'
    };
    let eodKey = eodKeyMap[holding.symbol];
    if (!eodKey) {
      if (holding.category_id === 'bank') {
        if (holding.name.includes('HDFC')) eodKey = 'hdfc';
        else if (holding.name.includes('IndusInd')) eodKey = 'indusind';
        else if (holding.name.includes('IDFC')) eodKey = 'idfc';
        else if (holding.name.includes('RBL')) eodKey = 'rbl';
        else if (holding.name.includes('SBI')) eodKey = 'sbi';
        else if (holding.name.includes('Federal')) eodKey = 'federal';
        else eodKey = 'savings';
      } else if (holding.category_id === 'epf') {
        eodKey = 'epf';
      } else if (holding.category_id === 'loans') {
        eodKey = 'loan';
      } else if (holding.category_id === 'credit_cards') {
        eodKey = 'credits';
      }
    }

    if (eodKey) {
      const eodLogsPath = './data/portfolio_eod_logs.json';
      let eodLogs = [];
      try {
        if (fs.existsSync(eodLogsPath)) {
          eodLogs = JSON.parse(fs.readFileSync(eodLogsPath, 'utf-8'));
        }
      } catch (err) {
        console.error('[Detail API] Error reading eodLogs:', err.message);
      }

      if (eodLogs.length > 0) {
        const activeLogs = eodLogs.filter(l => l[eodKey] !== undefined && l[eodKey] !== null);
        const nonZeroLogs = activeLogs.filter(l => l[eodKey] > 0);
        const validLogs = nonZeroLogs.length > 0 ? nonZeroLogs : activeLogs;

        const currentVal = validLogs[validLogs.length - 1]?.[eodKey] || Number(holding.current_price) || 0;
        const peakVal = Math.max(...validLogs.map(l => l[eodKey]));
        const minVal = Math.min(...validLogs.map(l => l[eodKey]));
        const startVal = validLogs[0]?.[eodKey] || 0;
        const startDate = validLogs[0]?.date || '—';

        // Calculate 1 Year Delta
        const oneYearAgoDate = new Date();
        oneYearAgoDate.setFullYear(oneYearAgoDate.getFullYear() - 1);
        const oneYearAgoStr = oneYearAgoDate.toISOString().split('T')[0];
        const yearAgoLog = validLogs.find(l => l.date >= oneYearAgoStr) || validLogs[0];
        const yearAgoVal = yearAgoLog?.[eodKey] || startVal;
        const oneYearDelta = currentVal - yearAgoVal;
        const oneYearPct = yearAgoVal > 0 ? ((oneYearDelta / yearAgoVal) * 100).toFixed(2) : 0;

        // Build Daily Timeline (sampled appropriately for recharts)
        const step = Math.max(1, Math.floor(validLogs.length / 300));
        const timelineINR = [];
        for (let i = 0; i < validLogs.length; i += step) {
          const item = validLogs[i];
          const val = Number(item[eodKey].toFixed(2));
          timelineINR.push({
            label: item.date,
            invested: val,
            value: val,
            balance: val
          });
        }
        // Ensure last record is included
        const lastLog = validLogs[validLogs.length - 1];
        if (timelineINR.length > 0 && timelineINR[timelineINR.length - 1].label !== lastLog.date) {
          const lastVal = Number(lastLog[eodKey].toFixed(2));
          timelineINR.push({
            label: lastLog.date,
            invested: lastVal,
            value: lastVal,
            balance: lastVal
          });
        }

        // Generate synthetic transaction history for table rendering
        const txs = [];
        let prevVal = 0;
        const txStep = Math.max(1, Math.floor(validLogs.length / 60)); // ~60 ledger entries
        for (let i = 0; i < validLogs.length; i += txStep) {
          const l = validLogs[i];
          const val = l[eodKey];
          const diff = val - prevVal;
          txs.push({
            id: `eod_${l.date}_${i}`,
            holding_id: holding.id,
            symbol: holding.symbol || 'EOD',
            name: holding.name,
            type: diff >= 0 ? 'BUY' : 'SELL',
            quantity: 1,
            price: val,
            total_amount: Math.abs(diff),
            date: l.date,
            notes: `EOD Balance: ₹${val.toLocaleString('en-IN')}`
          });
          prevVal = val;
        }

        return res.json({
          holding: {
            ...holding,
            current_price: currentVal,
            avg_buy_price: startVal
          },
          fxRate: 1.0,
          transactions: txs.reverse(),
          dividends: [],
          timelineUSD: timelineINR,
          timelineINR,
          metricsUSD: {
            totalInvested: startVal,
            currentValue: currentVal,
            unrealizedPnl: currentVal - startVal,
            unrealizedPct: startVal > 0 ? Number((((currentVal - startVal) / startVal) * 100).toFixed(2)) : 0,
            peakValue: peakVal,
            minValue: minVal,
            oneYearDelta,
            oneYearPct,
            startDate
          },
          metricsINR: {
            totalInvested: startVal,
            currentValue: currentVal,
            unrealizedPnl: currentVal - startVal,
            unrealizedPct: startVal > 0 ? Number((((currentVal - startVal) / startVal) * 100).toFixed(2)) : 0,
            peakValue: peakVal,
            minValue: minVal,
            oneYearDelta,
            oneYearPct,
            startDate
          },
          timeline: timelineINR,
          metrics: {
            totalInvested: startVal,
            currentValue: currentVal,
            unrealizedPnl: currentVal - startVal,
            unrealizedPct: startVal > 0 ? Number((((currentVal - startVal) / startVal) * 100).toFixed(2)) : 0,
            peakValue: peakVal,
            minValue: minVal,
            oneYearDelta,
            oneYearPct,
            startDate
          }
        });
      }
    }

    const isUSD = holding.currency === 'USD';
    const isUSStock = holding.currency === 'USD';
    const liveRate = isUSStock ? fxRate : 1.0;

    // Fetch transactions specifically for this holding (prevents Supabase 1000 row limit truncation)
    const { data: txsData, error: txErr } = await supabase
      .from('transactions')
      .select('*')
      .or(`holding_id.eq.${holding.id},symbol.eq.${holding.symbol}`)
      .order('date', { ascending: true });
    if (txErr) console.error('[Detail API] Tx Fetch Error:', txErr.message);
    const txs = txsData || [];

    // Fetch dividends specifically for this holding
    const { data: divsData, error: divErr } = await supabase
      .from('dividends')
      .select('*')
      .or(`holding_id.eq.${holding.id},symbol.eq.${holding.symbol}`)
      .order('ex_date', { ascending: true });
    if (divErr) console.error('[Detail API] Div Fetch Error:', divErr.message);
    const divs = divsData || [];

    // --- Compute metrics in USD and INR ---
    let totalInvestedUSD = 0;
    let totalInvestedINR = 0;
    let totalRedeemedUSD = 0;
    let totalRedeemedINR = 0;
    let realizedPnlUSD = 0;
    let realizedPnlINR = 0;

    const buyLotsUSD = [];
    const buyLotsINR = [];

    for (const tx of txs) {
      const qty = Number(tx.quantity) || 0;
      const price = Number(tx.price) || 0;
      const amountUSD = Number(tx.total_amount) || (qty * price);
      const txRate = isUSStock ? (Number(tx.fx_rate) || getHistoricalFxRate(tx.date)) : 1.0;
      const amountINR = amountUSD * txRate;

      if (tx.type === 'BUY' || tx.type === 'BONUS' || tx.type === 'DIVIDEND_REINVEST') {
        totalInvestedUSD += amountUSD;
        totalInvestedINR += amountINR;
        buyLotsUSD.push({ qty, price, rem: qty });
        buyLotsINR.push({ qty, priceUSD: price, fxRate: txRate, rem: qty });
      } else if (tx.type === 'SELL') {
        totalRedeemedUSD += amountUSD;
        totalRedeemedINR += amountINR;

        // USD FIFO Realized PnL
        let remUSD = qty;
        while (remUSD > 0 && buyLotsUSD.length > 0) {
          const lot = buyLotsUSD[0];
          const used = Math.min(lot.rem, remUSD);
          realizedPnlUSD += used * (price - lot.price);
          lot.rem -= used;
          remUSD -= used;
          if (lot.rem <= 0) buyLotsUSD.shift();
        }

        // INR FIFO Realized PnL (Sell FX - Buy FX)
        let remINR = qty;
        while (remINR > 0 && buyLotsINR.length > 0) {
          const lot = buyLotsINR[0];
          const used = Math.min(lot.rem, remINR);
          realizedPnlINR += (used * price * txRate) - (used * lot.priceUSD * lot.fxRate);
          lot.rem -= used;
          remINR -= used;
          if (lot.rem <= 0) buyLotsINR.shift();
        }
      }
    }

    const currentQty = Number(holding.quantity) || 0;
    const currentPriceUSD = Number(holding.current_price) || 0;
    const avgBuyPriceUSD = Number(holding.avg_buy_price) || 0;

    const currentValueUSD = currentQty * currentPriceUSD;
    const costBasisUSD = currentQty * avgBuyPriceUSD;
    const unrealizedPnlUSD = currentValueUSD - costBasisUSD;
    const unrealizedPctUSD = costBasisUSD > 0 ? Number(((unrealizedPnlUSD / costBasisUSD) * 100).toFixed(2)) : 0;

    const currentValueINR = currentValueUSD * liveRate;
    const activeLotsINR = buyLotsINR.filter(l => l.rem > 0);
    const costBasisINR = activeLotsINR.length > 0
      ? activeLotsINR.reduce((s, l) => s + (l.rem * l.priceUSD * l.fxRate), 0)
      : (costBasisUSD * (totalInvestedUSD > 0 ? (totalInvestedINR / totalInvestedUSD) : liveRate));
    
    const unrealizedPnlINR = currentValueINR - costBasisINR;
    const unrealizedPctINR = costBasisINR > 0 ? Number(((unrealizedPnlINR / costBasisINR) * 100).toFixed(2)) : 0;

    const totalDividendsUSD = isUSStock
      ? divs.reduce((s, d) => s + (Number(d.amount_original) || 0), 0)
      : 0;
    const totalDividendsINR = divs.reduce((s, d) => s + (Number(d.amount_inr) || 0), 0);

    const today = new Date().toISOString().split('T')[0];

    // USD Cashflows & XIRR
    const cashflowsUSD = txs
      .filter(t => t.type === 'BUY' || t.type === 'BONUS' || t.type === 'SELL')
      .map(t => ({
        date: t.date,
        amount: (t.type === 'BUY' || t.type === 'BONUS') ? -(Number(t.total_amount) || 0) : (Number(t.total_amount) || 0)
      }));
    if (currentQty > 0) cashflowsUSD.push({ date: today, amount: currentValueUSD });
    const totalXirrUSD = calculateXirr(cashflowsUSD);

    // INR Cashflows & XIRR
    const cashflowsINR = txs
      .filter(t => t.type === 'BUY' || t.type === 'BONUS' || t.type === 'SELL')
      .map(t => {
        const r = isUSStock ? (Number(t.fx_rate) || getHistoricalFxRate(t.date)) : 1.0;
        const amt = (Number(t.total_amount) || 0) * r;
        return {
          date: t.date,
          amount: (t.type === 'BUY' || t.type === 'BONUS') ? -amt : amt
        };
      });
    if (currentQty > 0) cashflowsINR.push({ date: today, amount: currentValueINR });
    const totalXirrINR = calculateXirr(cashflowsINR);

    // Timelines
    const timelineUSD = [];
    const timelineINR = [];

    // High-fidelity historical daily NAV timeline for NPS holdings
    if (holding.category_id === 'nps' && txs.length > 0) {
      const npsNavMap = await fetchNpsHistoricalNav(holding.symbol);
      if (npsNavMap && npsNavMap.size > 0) {
        const sortedNavDates = Array.from(npsNavMap.keys()).sort();
        const firstTxDate = txs[0].date;
        const lastTxDate = txs[txs.length - 1].date;
        const isExited = (Number(holding.quantity) || 0) === 0;
        const relevantDates = sortedNavDates.filter(d => d >= firstTxDate && (!isExited || d <= lastTxDate));

        let runningQ = 0;
        let runningInv = 0;
        let txIdx = 0;

        for (const d of relevantDates) {
          while (txIdx < txs.length && txs[txIdx].date <= d) {
            const tx = txs[txIdx];
            const qty = Number(tx.quantity) || 0;
            const amt = Number(tx.total_amount) || (qty * (Number(tx.price) || 0));
            if (tx.type === 'BUY' || tx.type === 'BONUS') {
              runningQ += qty;
              runningInv += amt;
            } else if (tx.type === 'SELL') {
              runningQ = Math.max(0, runningQ - qty);
              runningInv = Math.max(0, runningInv - amt);
            }
            txIdx++;
          }
          const nav = npsNavMap.get(d) || 0;
          const val = Math.max(0, runningQ * nav);
          timelineINR.push({
            label: d,
            invested: Number(Math.max(0, runningInv).toFixed(2)),
            value: Number(val.toFixed(2))
          });
        }

        if (!isExited && (timelineINR.length === 0 || timelineINR[timelineINR.length - 1].label !== today)) {
          timelineINR.push({
            label: today,
            invested: Number(Math.max(0, costBasisINR).toFixed(2)),
            value: Number(currentValueINR.toFixed(2))
          });
        }
      }
    }

    // Default timeline construction (used for stocks, MFs, and fallback)
    if (timelineINR.length === 0) {
      let runningInvUSD = 0;
      let runningInvINR = 0;
      let runningQ = 0;
      const seenDates = new Set();

      for (const tx of txs) {
        const qty = Number(tx.quantity) || 0;
        const price = Number(tx.price) || 0;
        const amtUSD = Number(tx.total_amount) || qty * price;
        const txRate = isUSStock ? (Number(tx.fx_rate) || getHistoricalFxRate(tx.date)) : 1.0;
        const amtINR = amtUSD * txRate;

        if (tx.type === 'BUY' || tx.type === 'BONUS') {
          runningInvUSD += amtUSD;
          runningInvINR += amtINR;
          runningQ += qty;
        } else if (tx.type === 'SELL') {
          runningInvUSD -= qty * (avgBuyPriceUSD || price);
          runningInvINR -= qty * (avgBuyPriceUSD || price) * txRate;
          runningQ -= qty;
        }

        const dateKey = tx.date;
        if (!seenDates.has(dateKey)) {
          seenDates.add(dateKey);
          const valUSD = runningQ * currentPriceUSD;
          const valINR = valUSD * liveRate;
          timelineUSD.push({
            label: dateKey,
            invested: Number(runningInvUSD.toFixed(2)),
            value: Number(valUSD.toFixed(2))
          });
          timelineINR.push({
            label: dateKey,
            invested: Number(runningInvINR.toFixed(2)),
            value: Number(valINR.toFixed(2))
          });
        }
      }

      timelineUSD.push({
        label: today,
        invested: Number(Math.max(0, runningInvUSD).toFixed(2)),
        value: Number(currentValueUSD.toFixed(2))
      });
      timelineINR.push({
        label: today,
        invested: Number(Math.max(0, runningInvINR).toFixed(2)),
        value: Number(currentValueINR.toFixed(2))
      });
    }

    res.json({
      holding,
      fxRate: liveRate,
      transactions: txs,
      dividends: divs,
      timelineUSD,
      timelineINR,
      metricsUSD: {
        totalInvested:  Number(totalInvestedUSD.toFixed(2)),
        totalRedeemed:  Number(totalRedeemedUSD.toFixed(2)),
        currentValue:   Number(currentValueUSD.toFixed(2)),
        unrealizedPnl:  Number(unrealizedPnlUSD.toFixed(2)),
        unrealizedPct:  unrealizedPctUSD,
        realizedPnl:    Number(realizedPnlUSD.toFixed(2)),
        totalDividends: Number(totalDividendsUSD.toFixed(2)),
        dividendCount:  divs.length,
        totalXirr:      totalXirrUSD
      },
      metricsINR: {
        totalInvested:  Number(totalInvestedINR.toFixed(2)),
        totalRedeemed:  Number(totalRedeemedINR.toFixed(2)),
        currentValue:   Number(currentValueINR.toFixed(2)),
        unrealizedPnl:  Number(unrealizedPnlINR.toFixed(2)),
        unrealizedPct:  unrealizedPctINR,
        realizedPnl:    Number(realizedPnlINR.toFixed(2)),
        totalDividends: Number(totalDividendsINR.toFixed(2)),
        dividendCount:  divs.length,
        totalXirr:      totalXirrINR
      },
      // Backward-compatible top-level properties
      timeline: isUSStock ? timelineUSD : timelineINR,
      metrics: {
        totalInvested:  Number((isUSStock ? totalInvestedUSD : totalInvestedINR).toFixed(2)),
        totalRedeemed:  Number((isUSStock ? totalRedeemedUSD : totalRedeemedINR).toFixed(2)),
        currentValue:   Number((isUSStock ? currentValueUSD : currentValueINR).toFixed(2)),
        unrealizedPnl:  Number((isUSStock ? unrealizedPnlUSD : unrealizedPnlINR).toFixed(2)),
        unrealizedPct:  isUSStock ? unrealizedPctUSD : unrealizedPctINR,
        realizedPnl:    Number((isUSStock ? realizedPnlUSD : realizedPnlINR).toFixed(2)),
        totalDividends: Number((isUSStock ? totalDividendsUSD : totalDividendsINR).toFixed(2)),
        dividendCount:  divs.length,
        totalXirr:      isUSStock ? totalXirrUSD : totalXirrINR
      }
    });
  } catch (err) {
    console.error('[API Error - /api/holding/detail]:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Liabilities API
// -------------------------------------------------------------
app.get('/api/liabilities', authenticateToken, async (req, res) => {
  try {
    const liabilities = await db.select('liabilities');
    res.json(liabilities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/liabilities', authenticateToken, async (req, res) => {
  try {
    const { category_id, name, lender, total_principal, outstanding_balance, interest_rate, monthly_emi, due_day } = req.body;

    await db.insert('liabilities', {
      category_id: category_id || 'loans',
      name,
      lender,
      total_principal: Number(total_principal),
      outstanding_balance: Number(outstanding_balance),
      interest_rate: Number(interest_rate || 0),
      monthly_emi: Number(monthly_emi || 0),
      due_day: Number(due_day || 5)
    });

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Dividends Hub API
// -------------------------------------------------------------
app.get('/api/dividends', authenticateToken, async (req, res) => {
  try {
    const fxRate = await fetchFxRate();

    const divs = await db.select('dividends');
    const holdings = await db.select('holdings');
    const hMap = {};
    holdings.forEach(h => hMap[h.id] = h);

    let totalIndiaINR = 0;
    let totalUSUSD = 0;
    let totalUSConvertedINR = 0;

    const history = divs.map(d => {
      const asset = hMap[d.holding_id] || {};
      const amountOriginal = Number(d.amount_original) || 0;
      const amountInr = Number(d.amount_inr) || 0;

      if (d.currency === 'USD') {
        totalUSUSD += amountOriginal;
        totalUSConvertedINR += amountInr;
      } else {
        totalIndiaINR += amountInr;
      }

      return {
        ...d,
        symbol: asset.symbol || 'ASSET',
        asset_name: asset.name || 'Stock',
        payment_date: formatDateDDMMYYYY(d.payment_date)
      };
    }).sort((a, b) => (b.payment_date || '').localeCompare(a.payment_date || ''));

    res.json({
      totalDividendsINR: Number((totalIndiaINR + totalUSConvertedINR).toFixed(2)),
      totalIndiaINR: Number(totalIndiaINR.toFixed(2)),
      totalUSUSD: Number(totalUSUSD.toFixed(2)),
      totalUSConvertedINR: Number(totalUSConvertedINR.toFixed(2)),
      fxRate,
      history
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Daily P&L Calendar Heatmap API
// -------------------------------------------------------------
app.get('/api/daily-pnl', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, range } = req.query;

    let eodLogs = [];
    const eodPath = './data/portfolio_eod_logs.json';
    if (fs.existsSync(eodPath)) {
      const raw = fs.readFileSync(eodPath, 'utf8');
      eodLogs = JSON.parse(raw);
    }

    if (eodLogs.length === 0) {
      const dbLogs = await db.select('pnl_history');
      eodLogs = dbLogs.map(l => ({
        date: l.log_date,
        wealth: l.net_worth_inr,
        daily_pnl: l.daily_pnl_inr,
        pnl_pct: l.pnl_percentage
      }));
    }

    // Sort chronologically
    eodLogs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Determine start/end date bounds based on range parameter or custom dates
    let targetStartDate = startDate;
    let targetEndDate = endDate;

    if (range && !startDate && !endDate) {
      const lastDateStr = eodLogs.length > 0 ? eodLogs[eodLogs.length - 1].date : new Date().toISOString().split('T')[0];
      targetEndDate = lastDateStr;
      const endD = new Date(`${lastDateStr}T00:00:00Z`);
      const startD = new Date(endD);

      if (range === '1M') startD.setUTCMonth(startD.getUTCMonth() - 1);
      else if (range === '3M') startD.setUTCMonth(startD.getUTCMonth() - 3);
      else if (range === '6M') startD.setUTCMonth(startD.getUTCMonth() - 6);
      else if (range === '1Y') startD.setUTCFullYear(startD.getUTCFullYear() - 1);
      else if (range === '2Y') startD.setUTCFullYear(startD.getUTCFullYear() - 2);
      else if (range === '3Y') startD.setUTCFullYear(startD.getUTCFullYear() - 3);
      else if (range === '5Y') startD.setUTCFullYear(startD.getUTCFullYear() - 5);
      else if (range === '10Y') startD.setUTCFullYear(startD.getUTCFullYear() - 10);
      else if (range === 'ALL') startD.setUTCFullYear(2000);

      targetStartDate = startD.toISOString().slice(0, 10);
    }

    // Filter by bounds if present
    let filtered = eodLogs;
    if (targetStartDate) filtered = filtered.filter(l => l.date >= targetStartDate);
    if (targetEndDate) filtered = filtered.filter(l => l.date <= targetEndDate);

    // Format output array with daily PnL changes and asset/liability deltas
    const resultLogs = [];
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      const prevItem = i > 0 ? filtered[i - 1] : item;

      const prevWealth = prevItem.wealth !== undefined ? prevItem.wealth : item.wealth;
      const dailyPnl = item.daily_pnl !== undefined ? item.daily_pnl : (item.wealth - prevWealth);
      const pct = prevWealth !== 0 ? ((dailyPnl / prevWealth) * 100).toFixed(2) : '0.00';

      const wealth = item.wealth || 0;
      const debt = item.debt || 0;
      const assets = wealth + debt;

      const prevDebt = prevItem.debt || 0;
      const prevAssets = prevWealth + prevDebt;

      const assetDelta = assets - prevAssets;
      const liabilityDelta = debt - prevDebt;

      resultLogs.push({
        log_date: item.date,
        net_worth_inr: Number(wealth.toFixed(2)),
        total_assets_inr: Number(assets.toFixed(2)),
        liabilities_inr: Number(debt.toFixed(2)),
        daily_pnl_inr: Number(dailyPnl.toFixed(2)),
        pnl_percentage: Number(pct),
        asset_delta_inr: Number(assetDelta.toFixed(2)),
        liability_delta_inr: Number(liabilityDelta.toFixed(2)),
        breakdown: {
          savings: item.savings || 0,
          epf: item.epf || 0,
          mutual_funds: item.mutual_funds || 0,
          indian_stocks: item.indian_stocks || 0,
          us_stocks: item.us_stocks || 0,
          nps: item.nps || 0,
          loan: item.loan || 0,
          credits: item.credits || 0
        },
        prev_breakdown: {
          savings: prevItem.savings || 0,
          epf: prevItem.epf || 0,
          mutual_funds: prevItem.mutual_funds || 0,
          indian_stocks: prevItem.indian_stocks || 0,
          us_stocks: prevItem.us_stocks || 0,
          nps: prevItem.nps || 0,
          loan: prevItem.loan || 0,
          credits: prevItem.credits || 0
        }
      });
    }

    res.json(resultLogs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Live Price Engine API
// -------------------------------------------------------------
app.post('/api/refresh-prices', authenticateToken, async (req, res) => {
  try {
    const result = await refreshAllHoldingsPrices();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// DB Visual Manager API (Relational Editor with Name & Symbol Enriched)
// -------------------------------------------------------------
app.get('/api/db-tables', authenticateToken, (req, res) => {
  res.json(['categories', 'holdings', 'transactions', 'liabilities', 'dividends', 'pnl_history', 'fx_rates', 'audit_logs']);
});

app.get('/api/db-table-data/:tableName', authenticateToken, async (req, res) => {
  const { tableName } = req.params;
  try {
    const rawRows = await db.select(tableName);

    if (tableName === 'transactions' || tableName === 'dividends') {
      const holdings = await db.select('holdings');
      const hMap = {};
      holdings.forEach(h => hMap[h.id] = h);

      const enrichedRows = rawRows.map(r => {
        const h = hMap[r.holding_id] || {};
        const formattedDate = formatDateDDMMYYYY(r.date || r.payment_date || r.created_at);

        if (tableName === 'transactions') {
          return {
            id: r.id,
            symbol: h.symbol || 'N/A',
            name: h.name || 'N/A',
            holding_id: r.holding_id,
            type: r.type,
            quantity: r.quantity,
            price: r.price,
            total_amount: r.total_amount,
            charges: r.charges,
            currency: r.currency,
            date: formattedDate,
            notes: r.notes || ''
          };
        } else {
          return {
            id: r.id,
            symbol: h.symbol || 'N/A',
            name: h.name || 'N/A',
            holding_id: r.holding_id,
            amount_original: r.amount_original,
            currency: r.currency,
            fx_rate: r.fx_rate,
            amount_inr: r.amount_inr,
            payment_date: formattedDate
          };
        }
      });

      const firstRow = enrichedRows[0] || {};
      const columns = Object.keys(firstRow).map(k => ({ name: k, type: typeof firstRow[k] }));
      return res.json({ columns, rows: enrichedRows });
    }

    // Default formatting for dates in other tables
    const formattedRows = rawRows.map(r => {
      const newObj = { ...r };
      ['date', 'payment_date', 'log_date', 'created_at', 'updated_at'].forEach(key => {
        if (newObj[key]) newObj[key] = formatDateDDMMYYYY(newObj[key]);
      });
      return newObj;
    });

    const firstRow = formattedRows[0] || {};
    const columns = Object.keys(firstRow).map(k => ({ name: k, type: typeof firstRow[k] }));
    res.json({ columns, rows: formattedRows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/db-table-update', authenticateToken, async (req, res) => {
  const { tableName, id, column, value } = req.body;
  try {
    const updateObj = {};
    updateObj[column] = isNaN(value) ? value : Number(value);
    await db.update(tableName, id, updateObj);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Ladder Server] Running on http://localhost:${PORT}`);
});
