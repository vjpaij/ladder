import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

const dataDir = path.resolve(process.cwd(), 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function getTablePath(tableName) {
  return path.join(dataDir, `${tableName}.json`);
}

function readTable(tableName) {
  const filePath = getTablePath(tableName);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    return [];
  }
}

function writeTable(tableName, data) {
  const filePath = getTablePath(tableName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export function initDatabase() {
  console.log('[Database] Initializing pure JS relational database engine...');

  // Initialize Default Categories
  const categories = readTable('categories');
  if (categories.length === 0) {
    const defaultCats = [
      { id: 'bank', name: 'Bank Accounts & FDs', type: 'ASSET', icon: 'Landmark', color: '#3B82F6' },
      { id: 'in_stocks', name: 'Indian Stocks (NSE/BSE)', type: 'ASSET', icon: 'TrendingUp', color: '#10B981' },
      { id: 'us_stocks', name: 'US Equities (NASDAQ/NYSE)', type: 'ASSET', icon: 'Globe', color: '#8B5CF6' },
      { id: 'mutual_funds', name: 'Mutual Funds (AMFI)', type: 'ASSET', icon: 'PieChart', color: '#F59E0B' },
      { id: 'nps', name: 'National Pension System (NPS)', type: 'ASSET', icon: 'ShieldCheck', color: '#06B6D4' },
      { id: 'epf', name: 'Employee Provident Fund (EPF)', type: 'ASSET', icon: 'Building2', color: '#64748B' },
      { id: 'loans', name: 'Home & Personal Loans', type: 'LIABILITY', icon: 'CreditCard', color: '#EF4444' },
      { id: 'credit_cards', name: 'Credit Card Balances', type: 'LIABILITY', icon: 'Wallet', color: '#F43F5E' }
    ];
    writeTable('categories', defaultCats);
  }

  // Initialize FX Rates
  const fx = readTable('fx_rates');
  if (fx.length === 0) {
    writeTable('fx_rates', [{ pair: 'USD_INR', rate: 87.25, updated_at: new Date().toISOString() }]);
  }

  // Initialize Users & Mock Data
  const users = readTable('users');
  if (users.length === 0) {
    const salt = bcrypt.genSaltSync(10);
    const passHash = bcrypt.hashSync('admin123', salt);
    const adminUser = {
      id: 1,
      email: 'admin@ladder.com',
      password_hash: passHash,
      name: 'Vijay Pai',
      created_at: new Date().toISOString()
    };
    writeTable('users', [adminUser]);
    seedMockData(1);
  }
}

function seedMockData(userId) {
  console.log('[Database] Seeding institutional sample portfolio...');

  const holdings = [
    // Indian Stocks (NSE vs BSE logic demo: Reliance BSE 3012.50 vs NSE 3015.00 -> higher price selected)
    { id: 1, user_id: userId, category_id: 'in_stocks', symbol: 'RELIANCE.NS', name: 'Reliance Industries Ltd', exchange: 'NSE', quantity: 150, avg_buy_price: 2450.00, current_price: 3015.00, nse_price: 3015.00, bse_price: 3012.50, currency: 'INR', sector: 'Energy & Conglomerate', is_latest_today: 1 },
    { id: 2, user_id: userId, category_id: 'in_stocks', symbol: 'TCS.NS', name: 'Tata Consultancy Services', exchange: 'NSE', quantity: 80, avg_buy_price: 3200.00, current_price: 4210.00, nse_price: 4210.00, bse_price: 4208.00, currency: 'INR', sector: 'Information Technology', is_latest_today: 1 },
    { id: 3, user_id: userId, category_id: 'in_stocks', symbol: 'HDFCBANK.NS', name: 'HDFC Bank Limited', exchange: 'NSE', quantity: 250, avg_buy_price: 1420.00, current_price: 1681.50, nse_price: 1680.00, bse_price: 1681.50, currency: 'INR', sector: 'Banking & Finance', is_latest_today: 1 },
    { id: 4, user_id: userId, category_id: 'in_stocks', symbol: 'INFY.NS', name: 'Infosys Limited', exchange: 'NSE', quantity: 120, avg_buy_price: 1350.00, current_price: 1890.00, nse_price: 1890.00, bse_price: 1888.00, currency: 'INR', sector: 'Information Technology', is_latest_today: 1 },

    // US Stocks
    { id: 5, user_id: userId, category_id: 'us_stocks', symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', quantity: 45, avg_buy_price: 175.00, current_price: 228.50, nse_price: 0, bse_price: 0, currency: 'USD', sector: 'Consumer Tech', is_latest_today: 1 },
    { id: 6, user_id: userId, category_id: 'us_stocks', symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', quantity: 60, avg_buy_price: 88.00, current_price: 132.40, nse_price: 0, bse_price: 0, currency: 'USD', sector: 'Semiconductors', is_latest_today: 1 },
    { id: 7, user_id: userId, category_id: 'us_stocks', symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', quantity: 30, avg_buy_price: 340.00, current_price: 448.20, nse_price: 0, bse_price: 0, currency: 'USD', sector: 'Cloud Software', is_latest_today: 1 },

    // Mutual Funds
    { id: 8, user_id: userId, category_id: 'mutual_funds', symbol: '122639', name: 'Parag Parikh Flexi Cap Fund Direct-Growth', exchange: 'AMFI', quantity: 12500, avg_buy_price: 42.50, current_price: 78.40, nse_price: 0, bse_price: 0, currency: 'INR', sector: 'Equity Flexi Cap', is_latest_today: 1 },
    { id: 9, user_id: userId, category_id: 'mutual_funds', symbol: '119598', name: 'Mirae Asset Large Cap Fund Direct-Growth', exchange: 'AMFI', quantity: 8400, avg_buy_price: 62.00, current_price: 108.10, nse_price: 0, bse_price: 0, currency: 'INR', sector: 'Equity Large Cap', is_latest_today: 1 },

    // Bank Accounts & Fixed Deposits
    { id: 10, user_id: userId, category_id: 'bank', symbol: 'HDFC_SAVINGS', name: 'HDFC Premium Savings Account', exchange: 'BANK', quantity: 1, avg_buy_price: 650000.00, current_price: 650000.00, nse_price: 0, bse_price: 0, currency: 'INR', sector: 'Cash / Liquid', is_latest_today: 1 },
    { id: 11, user_id: userId, category_id: 'bank', symbol: 'ICICI_FD', name: 'ICICI Fixed Deposit (7.25% p.a.)', exchange: 'BANK', quantity: 1, avg_buy_price: 1000000.00, current_price: 1072500.00, nse_price: 0, bse_price: 0, currency: 'INR', sector: 'Fixed Income', is_latest_today: 1 },

    // NPS & EPF
    { id: 12, user_id: userId, category_id: 'nps', symbol: 'NPS_TIER1', name: 'NPS Tier 1 Scheme - HDFC Pension', exchange: 'PFRDA', quantity: 1, avg_buy_price: 750000.00, current_price: 1140000.00, nse_price: 0, bse_price: 0, currency: 'INR', sector: 'Retirement', is_latest_today: 1 },
    { id: 13, user_id: userId, category_id: 'epf', symbol: 'EPF_ACCOUNT', name: 'EPF Member Balance (8.25%)', exchange: 'EPFO', quantity: 1, avg_buy_price: 1400000.00, current_price: 1890000.00, nse_price: 0, bse_price: 0, currency: 'INR', sector: 'Retirement', is_latest_today: 1 }
  ];

  writeTable('holdings', holdings);

  // Seed Liabilities
  const liabilities = [
    { id: 1, user_id: userId, category_id: 'loans', name: 'Primary Home Loan', lender: 'HDFC Bank', total_principal: 5000000.00, outstanding_balance: 3420000.00, interest_rate: 8.50, monthly_emi: 43200.00, due_day: 10 },
    { id: 2, user_id: userId, category_id: 'credit_cards', name: 'HDFC Infinia Credit Card', lender: 'HDFC Bank', total_principal: 150000.00, outstanding_balance: 42500.00, interest_rate: 0.0, monthly_emi: 42500.00, due_day: 20 }
  ];
  writeTable('liabilities', liabilities);

  // Seed Transactions
  const transactions = [
    { id: 1, holding_id: 1, type: 'BUY', quantity: 150, price: 2450.00, total_amount: 367500.00, currency: 'INR', date: '2023-04-12', notes: 'Initial investment' },
    { id: 2, holding_id: 5, type: 'BUY', quantity: 45, price: 175.00, total_amount: 7875.00, currency: 'USD', date: '2023-06-15', notes: 'Tech allocation' },
    { id: 3, holding_id: 1, type: 'DIVIDEND', quantity: 0, price: 10.00, total_amount: 1500.00, currency: 'INR', date: '2024-08-20', notes: 'Reliance Q1 Dividend' },
    { id: 4, holding_id: 5, type: 'DIVIDEND', quantity: 0, price: 0.25, total_amount: 11.25, currency: 'USD', date: '2024-11-10', notes: 'Apple Q3 Dividend' }
  ];
  writeTable('transactions', transactions);

  // Seed Dividends Log
  const dividends = [
    { id: 1, user_id: userId, holding_id: 1, amount_original: 1500.00, currency: 'INR', fx_rate: 1.0, amount_inr: 1500.00, ex_date: '2024-08-15', payment_date: '2024-08-20' },
    { id: 2, user_id: userId, holding_id: 2, amount_original: 2200.00, currency: 'INR', fx_rate: 1.0, amount_inr: 2200.00, ex_date: '2024-07-10', payment_date: '2024-07-18' },
    { id: 3, user_id: userId, holding_id: 5, amount_original: 11.25, currency: 'USD', fx_rate: 87.25, amount_inr: 981.56, ex_date: '2024-11-05', payment_date: '2024-11-10' },
    { id: 4, user_id: userId, holding_id: 6, amount_original: 18.00, currency: 'USD', fx_rate: 87.25, amount_inr: 1570.50, ex_date: '2024-12-01', payment_date: '2024-12-08' }
  ];
  writeTable('dividends', dividends);

  // Seed Daily P&L Calendar Heatmap Logs (last 35 days)
  const today = new Date();
  let baseNetWorth = 14500000;
  const pnlLogs = [];

  for (let i = 35; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];

    const randomChangePct = (Math.sin(i * 1.5) * 0.012) + (Math.cos(i) * 0.008);
    const pnl = Math.round(baseNetWorth * randomChangePct);
    baseNetWorth += pnl;

    const assets = baseNetWorth + 3462500;
    const liabilitiesVal = 3462500;

    pnlLogs.push({
      id: 36 - i,
      user_id: userId,
      log_date: dateStr,
      total_assets_inr: assets,
      total_liabilities_inr: liabilitiesVal,
      net_worth_inr: baseNetWorth,
      daily_pnl_inr: pnl,
      pnl_percentage: Number((randomChangePct * 100).toFixed(2))
    });
  }
  writeTable('daily_pnl_logs', pnlLogs);
}

// Database CRUD Helper interface
export const db = {
  select: (tableName) => readTable(tableName),
  
  selectWhere: (tableName, predicate) => readTable(tableName).filter(predicate),
  
  insert: (tableName, row) => {
    const table = readTable(tableName);
    const nextId = table.length > 0 ? Math.max(...table.map(r => r.id || 0)) + 1 : 1;
    const newRow = { id: nextId, ...row };
    table.push(newRow);
    writeTable(tableName, table);
    return newRow;
  },

  update: (tableName, id, updates) => {
    const table = readTable(tableName);
    const idx = table.findIndex(r => r.id === Number(id));
    if (idx !== -1) {
      table[idx] = { ...table[idx], ...updates };
      writeTable(tableName, table);
      return table[idx];
    }
    return null;
  },

  delete: (tableName, id) => {
    const table = readTable(tableName);
    const filtered = table.filter(r => r.id !== Number(id));
    writeTable(tableName, filtered);
    return true;
  }
};

export default db;
