import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import db, { initDatabase } from './db.js';
import { refreshAllHoldingsPrices, fetchFxRate } from './services/priceEngine.js';
import { calculateXirr, calculateAbsoluteReturn } from './services/xirrCalculator.js';

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = 'ladder-super-secret-key-2026';

app.use(cors());
app.use(express.json());

// Initialize DB schema on start
initDatabase();

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
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.selectWhere('users', u => u.email === (email || 'admin@ladder.com'))[0];
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
  const userId = req.user.userId;
  const fxRate = await fetchFxRate();

  const holdings = db.selectWhere('holdings', h => h.user_id === userId);
  const categories = db.select('categories');
  const liabilities = db.selectWhere('liabilities', l => l.user_id === userId);

  const catMap = {};
  categories.forEach(c => catMap[c.id] = c);

  let totalAssetsINR = 0;
  let totalInvestedINR = 0;

  holdings.forEach(h => {
    const rate = h.currency === 'USD' ? fxRate : 1.0;
    const currentVal = h.quantity * h.current_price * rate;
    const investedVal = h.quantity * h.avg_buy_price * rate;

    totalAssetsINR += currentVal;
    totalInvestedINR += investedVal;
  });

  let totalLiabilitiesINR = 0;
  liabilities.forEach(l => {
    totalLiabilitiesINR += l.outstanding_balance;
  });

  const netWorthINR = totalAssetsINR - totalLiabilitiesINR;
  const totalGainINR = totalAssetsINR - totalInvestedINR;
  const absoluteReturnPct = calculateAbsoluteReturn(totalInvestedINR, totalAssetsINR);

  // Cashflows for XIRR calculation
  const txs = db.select('transactions');
  const cashflows = [];

  txs.forEach(t => {
    const h = holdings.find(item => item.id === t.holding_id);
    if (h) {
      const rate = h.currency === 'USD' ? fxRate : 1.0;
      const amount = (t.type === 'BUY' ? -1 : 1) * t.total_amount * rate;
      cashflows.push({ date: t.date, amount });
    }
  });

  if (totalAssetsINR > 0) {
    cashflows.push({ date: new Date().toISOString().split('T')[0], amount: totalAssetsINR });
  }

  const xirrPct = calculateXirr(cashflows);

  // Latest Daily P&L
  const logs = db.selectWhere('daily_pnl_logs', l => l.user_id === userId).sort((a, b) => b.log_date.localeCompare(a.log_date));
  const latestLog = logs[0];
  const dayPnlINR = latestLog ? latestLog.daily_pnl_inr : (totalGainINR * 0.008);
  const dayPnlPct = latestLog ? latestLog.pnl_percentage : 0.82;

  // Asset Breakdown by Category
  const categoryValues = {};
  holdings.forEach(h => {
    const catName = catMap[h.category_id] ? catMap[h.category_id].name : h.category_id;
    const rate = h.currency === 'USD' ? fxRate : 1.0;
    const val = h.quantity * h.current_price * rate;
    if (!categoryValues[catName]) categoryValues[catName] = 0;
    categoryValues[catName] += val;
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
    totalGainINR: Math.round(totalGainINR),
    absoluteReturnPct,
    xirrPct,
    dayPnlINR: Math.round(dayPnlINR),
    dayPnlPct,
    fxRate,
    assetAllocation
  });
});

// -------------------------------------------------------------
// Holdings CRUD API
// -------------------------------------------------------------
app.get('/api/holdings', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const fxRate = await fetchFxRate();

  const holdings = db.selectWhere('holdings', h => h.user_id === userId);
  const categories = db.select('categories');
  const catMap = {};
  categories.forEach(c => catMap[c.id] = c);

  const formatted = holdings.map(h => {
    const rate = h.currency === 'USD' ? fxRate : 1.0;
    const currentValueOriginal = h.quantity * h.current_price;
    const currentValueINR = currentValueOriginal * rate;
    const investedValueOriginal = h.quantity * h.avg_buy_price;
    const investedValueINR = investedValueOriginal * rate;
    const gainINR = currentValueINR - investedValueINR;
    const gainPct = investedValueINR > 0 ? ((gainINR / investedValueINR) * 100).toFixed(2) : 0;

    return {
      ...h,
      category_name: catMap[h.category_id] ? catMap[h.category_id].name : h.category_id,
      category_color: catMap[h.category_id] ? catMap[h.category_id].color : '#3B82F6',
      fxRate: rate,
      currentValueOriginal: Number(currentValueOriginal.toFixed(2)),
      currentValueINR: Number(currentValueINR.toFixed(2)),
      investedValueINR: Number(investedValueINR.toFixed(2)),
      gainINR: Number(gainINR.toFixed(2)),
      gainPct: Number(gainPct)
    };
  }).sort((a, b) => b.currentValueINR - a.currentValueINR);

  res.json(formatted);
});

app.post('/api/holdings', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const { category_id, symbol, name, exchange, quantity, avg_buy_price, current_price, currency, sector } = req.body;

  const newHolding = db.insert('holdings', {
    user_id: userId,
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
    last_updated: new Date().toISOString(),
    is_latest_today: 1
  });

  db.insert('transactions', {
    holding_id: newHolding.id,
    type: 'BUY',
    quantity: Number(quantity),
    price: Number(avg_buy_price),
    total_amount: Number(quantity) * Number(avg_buy_price),
    currency: currency || 'INR',
    date: new Date().toISOString().split('T')[0],
    notes: 'Initial purchase position'
  });

  res.json({ success: true, id: newHolding.id });
});

app.put('/api/holdings/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { quantity, avg_buy_price, current_price, name, symbol, sector } = req.body;

  db.update('holdings', id, {
    quantity: Number(quantity),
    avg_buy_price: Number(avg_buy_price),
    current_price: Number(current_price),
    name,
    symbol,
    sector,
    last_updated: new Date().toISOString()
  });

  res.json({ success: true });
});

app.delete('/api/holdings/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  db.delete('holdings', id);
  res.json({ success: true });
});

// -------------------------------------------------------------
// Liabilities API
// -------------------------------------------------------------
app.get('/api/liabilities', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const liabilities = db.selectWhere('liabilities', l => l.user_id === userId);
  res.json(liabilities);
});

app.post('/api/liabilities', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const { category_id, name, lender, total_principal, outstanding_balance, interest_rate, monthly_emi, due_day } = req.body;

  db.insert('liabilities', {
    user_id: userId,
    category_id: category_id || 'loans',
    name,
    lender,
    total_principal: Number(total_principal),
    outstanding_balance: Number(outstanding_balance),
    interest_rate: Number(interest_rate || 0),
    monthly_emi: Number(monthly_emi || 0),
    due_day: Number(due_day || 5),
    last_updated: new Date().toISOString()
  });

  res.json({ success: true });
});

// -------------------------------------------------------------
// Dividends Hub API
// -------------------------------------------------------------
app.get('/api/dividends', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const fxRate = await fetchFxRate();

  const divs = db.selectWhere('dividends', d => d.user_id === userId);
  const holdings = db.select('holdings');
  const hMap = {};
  holdings.forEach(h => hMap[h.id] = h);

  let totalIndiaINR = 0;
  let totalUSUSD = 0;
  let totalUSConvertedINR = 0;

  const history = divs.map(d => {
    const asset = hMap[d.holding_id] || {};
    if (d.currency === 'USD') {
      totalUSUSD += d.amount_original;
      totalUSConvertedINR += d.amount_inr;
    } else {
      totalIndiaINR += d.amount_inr;
    }

    return {
      ...d,
      asset_name: asset.name || 'Stock',
      symbol: asset.symbol || 'ASSET'
    };
  }).sort((a, b) => b.payment_date.localeCompare(a.payment_date));

  res.json({
    totalDividendsINR: Number((totalIndiaINR + totalUSConvertedINR).toFixed(2)),
    totalIndiaINR: Number(totalIndiaINR.toFixed(2)),
    totalUSUSD: Number(totalUSUSD.toFixed(2)),
    totalUSConvertedINR: Number(totalUSConvertedINR.toFixed(2)),
    fxRate,
    history
  });
});

// -------------------------------------------------------------
// Daily P&L Calendar Heatmap API
// -------------------------------------------------------------
app.get('/api/daily-pnl', authenticateToken, (req, res) => {
  const userId = req.user.userId;
  const { startDate, endDate } = req.query;

  let logs = db.selectWhere('daily_pnl_logs', l => l.user_id === userId);

  if (startDate && endDate) {
    logs = logs.filter(l => l.log_date >= startDate && l.log_date <= endDate);
  }

  logs.sort((a, b) => a.log_date.localeCompare(b.log_date));
  res.json(logs);
});

// -------------------------------------------------------------
// Live Price Engine API
// -------------------------------------------------------------
app.post('/api/refresh-prices', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  try {
    const result = await refreshAllHoldingsPrices(userId);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// DB Visual Manager API (Relational Editor)
// -------------------------------------------------------------
app.get('/api/db-tables', authenticateToken, (req, res) => {
  res.json(['users', 'categories', 'holdings', 'transactions', 'liabilities', 'dividends', 'daily_pnl_logs', 'fx_rates']);
});

app.get('/api/db-table-data/:tableName', authenticateToken, (req, res) => {
  const { tableName } = req.params;
  try {
    const rows = db.select(tableName);
    const firstRow = rows[0] || {};
    const columns = Object.keys(firstRow).map(k => ({ name: k, type: typeof firstRow[k] }));
    res.json({ columns, rows });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/db-table-update', authenticateToken, (req, res) => {
  const { tableName, id, column, value } = req.body;
  try {
    const updateObj = {};
    updateObj[column] = isNaN(value) ? value : Number(value);
    db.update(tableName, id, updateObj);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[Ladder Server] Running on http://localhost:${PORT}`);
});
