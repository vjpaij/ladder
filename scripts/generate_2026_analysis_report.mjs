/**
 * scripts/generate_2026_analysis_report.mjs
 * Generates an interactive, grouped HTML dashboard for 2026 Buy & Sell Analysis.
 * Includes:
 * 1. Realistic Capital Strategy Simulation (₹45L Initial + ₹2L/mo SIP + 100% Sales Recycled)
 * 2. Actual Portfolio Executed Trades in 2026 (Ledger Parity)
 * 3. Unlimited Capital Strategy Simulation (Unconstrained Cash)
 * Grouped by Stock Name with expandable trade ledger rows.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// 1. Load Realistic 45L Simulation Results
const realisticFile = path.join(projectRoot, 'data', 'sim_2026_realistic_45L_results.json');
if (!fs.existsSync(realisticFile)) {
  console.log('[Report] Realistic sim results not found, executing simulation first...');
  await import('./simulate_2026_realistic_45L.mjs');
}
const realisticData = JSON.parse(fs.readFileSync(realisticFile, 'utf8'));

// 2. Load Unlimited Simulation Results
const unlimFile = path.join(projectRoot, 'data', 'sim_2026_strategy_results.json');
if (!fs.existsSync(unlimFile)) {
  await import('./simulate_2026_strategy.mjs');
}
const unlimData = JSON.parse(fs.readFileSync(unlimFile, 'utf8'));

// 3. Fetch Actual 2026 Transactions from DB
console.log('[Report] Extracting actual 2026 transactions from database...');
const { default: db } = await import('../server/db.js');
const txs = await db.select('transactions');
const holdings = await db.select('holdings');

const stockHoldings = holdings.filter(h => h.category_id === 'in_stocks');
const hMap = new Map(stockHoldings.map(h => [h.symbol, h]));

const txs2026 = txs.filter(t => t.date >= '2026-01-01' && t.date <= '2026-10-31');
const stockTxs = txs2026.filter(t => {
  const s = t.symbol || '';
  if (s.includes('-') || /^\d+$/.test(s) || s.startsWith('SM') || s.startsWith('POP')) return false;
  return ['BUY', 'SELL'].includes(t.type);
});

const actualGrouped = {};
for (const t of stockTxs) {
  if (!actualGrouped[t.symbol]) {
    const h = hMap.get(t.symbol);
    actualGrouped[t.symbol] = {
      symbol: t.symbol,
      name: t.name || h?.name || t.symbol,
      totalBoughtQty: 0,
      totalBoughtAmount: 0,
      totalSoldQty: 0,
      totalSoldAmount: 0,
      realizedPnl: 0,
      trades: []
    };
  }
  const g = actualGrouped[t.symbol];
  const qty = Number(t.quantity) || 0;
  const price = Number(t.price) || 0;
  const amt = Number(t.total_amount) || (qty * price);

  g.trades.push({
    date: t.date,
    symbol: t.symbol,
    name: g.name,
    type: t.type,
    signal: t.type,
    qty,
    price: Number(price.toFixed(2)),
    amount: Number(amt.toFixed(2)),
    realizedPnl: 0,
    pnlPct: 0,
    reason: t.notes || `Manual portfolio ${t.type} execution on ${t.date}`
  });

  if (t.type === 'BUY') {
    g.totalBoughtQty += qty;
    g.totalBoughtAmount += amt;
  } else if (t.type === 'SELL') {
    g.totalSoldQty += qty;
    g.totalSoldAmount += amt;
  }
}

let actualTotalInvested = 0;
let actualTotalSold = 0;
let actualTotalEndingVal = 0;
let actualTotalRealized = 0;
let actualTotalUnrealized = 0;

for (const sym of Object.keys(actualGrouped)) {
  const g = actualGrouped[sym];
  const h = hMap.get(sym);
  const cmp = Number(h?.current_price) || (g.totalSoldQty > 0 ? (g.totalSoldAmount / g.totalSoldQty) : (g.totalBoughtAmount / g.totalBoughtQty));

  g.openQty = Number(h?.quantity) || 0;
  g.cmp = Number(cmp.toFixed(2));
  g.currentValuation = Number((g.openQty * cmp).toFixed(2));
  g.avgBuyPrice = g.totalBoughtQty > 0 ? Number((g.totalBoughtAmount / g.totalBoughtQty).toFixed(2)) : Number(h?.avg_buy_price || 0);
  g.avgSellPrice = g.totalSoldQty > 0 ? Number((g.totalSoldAmount / g.totalSoldQty).toFixed(2)) : 0;

  if (g.totalSoldQty > 0) {
    const costBasisSold = g.totalSoldQty * (g.avgBuyPrice || Number(h?.avg_buy_price) || g.avgSellPrice);
    g.realizedPnl = Number((g.totalSoldAmount - costBasisSold).toFixed(2));
  } else {
    g.realizedPnl = 0;
  }

  if (g.openQty > 0) {
    const costBasisOpen = g.openQty * (Number(h?.avg_buy_price) || g.avgBuyPrice);
    g.unrealizedPnl = Number((g.currentValuation - costBasisOpen).toFixed(2));
    g.unrealizedPnlPct = costBasisOpen > 0 ? Number((g.unrealizedPnl / costBasisOpen * 100).toFixed(2)) : 0;
  } else {
    g.unrealizedPnl = 0;
    g.unrealizedPnlPct = 0;
  }

  g.netPnl = Number((g.realizedPnl + g.unrealizedPnl).toFixed(2));
  g.totalPnlPct = g.totalBoughtAmount > 0 ? Number((g.netPnl / g.totalBoughtAmount * 100).toFixed(2)) : 0;
  g.status = g.openQty > 0 ? (g.totalSoldQty > 0 ? 'PARTIAL_TRIM' : 'OPEN') : 'CLOSED';

  actualTotalInvested += g.totalBoughtAmount;
  actualTotalSold += g.totalSoldAmount;
  actualTotalEndingVal += g.currentValuation;
  actualTotalRealized += g.realizedPnl;
  actualTotalUnrealized += g.unrealizedPnl;
}

const actualData = {
  summary: {
    startDate: '2026-01-01',
    endDate: '2026-10-31',
    totalStocks: Object.keys(actualGrouped).length,
    totalTrades: stockTxs.length,
    totalInvested: Number(actualTotalInvested.toFixed(2)),
    totalSold: Number(actualTotalSold.toFixed(2)),
    endingValuation: Number(actualTotalEndingVal.toFixed(2)),
    realizedPnl: Number(actualTotalRealized.toFixed(2)),
    unrealizedPnl: Number(actualTotalUnrealized.toFixed(2)),
    netPnl: Number((actualTotalRealized + actualTotalUnrealized).toFixed(2)),
    roiPct: actualTotalInvested > 0 ? Number(((actualTotalRealized + actualTotalUnrealized) / actualTotalInvested * 100).toFixed(2)) : 0
  },
  stocks: Object.values(actualGrouped)
};

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ladder 2026 Buy & Sell Analysis — Realistic Capital Audit</title>
<style>
  :root {
    --bg-main: #0B0F19;
    --bg-card: #111827;
    --bg-subcard: #1E293B;
    --bg-hover: #26334D;
    --border: #334155;
    --border-subtle: #1E293B;
    --text-primary: #F8FAFC;
    --text-secondary: #94A3B8;
    --text-muted: #64748B;
    --brand-indigo: #6366F1;
    --brand-indigo-hover: #4F46E5;
    --accent-emerald: #10B981;
    --accent-rose: #EF4444;
    --accent-amber: #F59E0B;
    --accent-cyan: #06B6D4;
    --accent-purple: #A855F7;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background-color: var(--bg-main);
    color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding: 24px;
    line-height: 1.5;
  }
  .container { max-width: 1600px; margin: 0 auto; }

  /* Header */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 16px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 20px;
  }
  .title-group h1 {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #FFFFFF;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .badge-period {
    font-size: 12px;
    font-weight: 600;
    background: rgba(99, 102, 241, 0.2);
    color: #818CF8;
    border: 1px solid rgba(99, 102, 241, 0.4);
    padding: 3px 10px;
    border-radius: 9999px;
  }
  .subtitle {
    font-size: 14px;
    color: var(--text-secondary);
    margin-top: 6px;
  }

  /* Mode Switcher */
  .switch-strip {
    display: flex;
    background: var(--bg-subcard);
    padding: 4px;
    border-radius: 10px;
    border: 1px solid var(--border);
    gap: 4px;
  }
  .mode-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    padding: 9px 18px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .mode-btn:hover { color: #FFF; }
  .mode-btn.active {
    background: var(--brand-indigo);
    color: #FFFFFF;
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
  }

  /* KPI Grid */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .kpi-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 18px 20px;
    position: relative;
    overflow: hidden;
  }
  .kpi-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: var(--border);
  }
  .kpi-card.emerald::before { background: var(--accent-emerald); }
  .kpi-card.indigo::before { background: var(--brand-indigo); }
  .kpi-card.cyan::before { background: var(--accent-cyan); }
  .kpi-card.amber::before { background: var(--accent-amber); }
  .kpi-card.purple::before { background: var(--accent-purple); }

  .kpi-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    font-weight: 700;
  }
  .kpi-val {
    font-size: 26px;
    font-weight: 800;
    margin: 6px 0 2px 0;
    font-variant-numeric: tabular-nums;
  }
  .kpi-sub {
    font-size: 12px;
    color: var(--text-muted);
  }
  .pos { color: var(--accent-emerald) !important; }
  .neg { color: var(--accent-rose) !important; }

  /* Toolbar */
  .toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    flex-wrap: wrap;
    gap: 12px;
  }
  .search-input {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 16px;
    color: #FFF;
    font-size: 13px;
    width: 340px;
    outline: none;
    transition: border 0.2s;
  }
  .search-input:focus { border-color: var(--brand-indigo); }

  .filter-group {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .filter-btn {
    background: var(--bg-subcard);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    padding: 7px 14px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .filter-btn:hover { color: #FFF; border-color: var(--text-muted); }
  .filter-btn.active {
    background: rgba(99, 102, 241, 0.15);
    border-color: var(--brand-indigo);
    color: #818CF8;
  }

  /* Table Box */
  .table-box {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    background: #0D1322;
    color: var(--text-secondary);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 14px 16px;
    text-align: right;
    font-weight: 700;
    cursor: pointer;
    user-select: none;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  th:first-child, th:nth-child(2) { text-align: left; }
  th:hover { color: #FFF; background: #131B2E; }
  th.sort-active { color: #818CF8; }

  td {
    padding: 13px 16px;
    border-bottom: 1px solid var(--border-subtle);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  td:first-child, td:nth-child(2) { text-align: left; }

  tr.stock-header-row {
    cursor: pointer;
    transition: background-color 0.15s ease;
  }
  tr.stock-header-row:hover { background-color: var(--bg-hover); }
  tr.stock-header-row.expanded { background-color: rgba(99, 102, 241, 0.08); }

  .stock-title-cell {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .toggle-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    background: var(--bg-subcard);
    border: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 11px;
    transition: transform 0.2s ease;
  }
  .expanded .toggle-icon {
    transform: rotate(90deg);
    background: var(--brand-indigo);
    color: #FFF;
    border-color: var(--brand-indigo);
  }

  .sym-tag {
    font-weight: 800;
    color: #FFF;
    font-size: 14px;
    letter-spacing: 0.01em;
  }
  .name-sub {
    font-size: 11px;
    color: var(--text-muted);
    max-width: 240px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge-status {
    display: inline-block;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
    text-align: center;
  }
  .badge-open { background: rgba(16, 185, 129, 0.15); color: #34D399; border: 1px solid rgba(16, 185, 129, 0.3); }
  .badge-partial { background: rgba(245, 158, 11, 0.15); color: #FBBF24; border: 1px solid rgba(245, 158, 11, 0.3); }
  .badge-closed { background: rgba(148, 163, 184, 0.1); color: #94A3B8; border: 1px solid rgba(148, 163, 184, 0.2); }

  /* Sub-table accordion */
  tr.trades-drawer { display: none; }
  tr.trades-drawer.open { display: table-row; }
  .drawer-cell {
    padding: 0 16px 16px 46px;
    background: #090D16;
  }
  .sub-table-wrap {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    margin-top: 6px;
  }
  .sub-table th {
    background: #141C2E;
    padding: 10px 14px;
    font-size: 10px;
  }
  .sub-table td {
    padding: 9px 14px;
    font-size: 12px;
    border-bottom: 1px solid rgba(51, 65, 85, 0.4);
  }
  .sub-table tr:last-child td { border-bottom: none; }

  .badge-trade-type {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
  }
  .type-buy { background: rgba(99, 102, 241, 0.2); color: #A5B4FC; }
  .type-trim { background: rgba(245, 158, 11, 0.2); color: #FCD34D; }
  .type-exit { background: rgba(239, 68, 68, 0.2); color: #FCA5A5; }
  .type-pyramid { background: rgba(6, 182, 212, 0.2); color: #67E8F9; }

  .footer-note {
    margin-top: 24px;
    text-align: center;
    font-size: 12px;
    color: var(--text-muted);
  }
</style>
</head>
<body>

<div class="container">

  <!-- Header -->
  <div class="header">
    <div class="title-group">
      <h1>
        Ladder 2026 Buy & Sell Analysis Audit
        <span class="badge-period">01-Jan-2026 → 30-Oct-2026</span>
      </h1>
      <p class="subtitle">Complete Stock Ledger & P&L Attribution grouped by Stock Name — Realistic ₹45L Budget + ₹2L/mo SIP vs Actual Portfolio Trades</p>
    </div>

    <!-- Mode Switcher -->
    <div class="switch-strip">
      <button id="btnRealistic" class="mode-btn active" onclick="switchMode('realistic')">
        Realistic Strategy (45L + 2L/mo SIP)
      </button>
      <button id="btnActual" class="mode-btn" onclick="switchMode('actual')">
        Actual Portfolio Trades (170 Stocks)
      </button>
      <button id="btnUnlimited" class="mode-btn" onclick="switchMode('unlimited')">
        Unlimited Cash Model (423 Stocks)
      </button>
    </div>
  </div>

  <!-- KPI Grid -->
  <div class="kpi-grid">
    <div class="kpi-card indigo">
      <div id="kpiLabel1" class="kpi-label">Capital Deployed (Buys)</div>
      <div id="kpiVal1" class="kpi-val">₹0</div>
      <div id="kpiSub1" class="kpi-sub">0 total trades</div>
    </div>
    <div class="kpi-card cyan">
      <div id="kpiLabel2" class="kpi-label">Sales Realized Proceeds</div>
      <div id="kpiVal2" class="kpi-val">₹0</div>
      <div id="kpiSub2" class="kpi-sub">Trims & structural exits</div>
    </div>
    <div class="kpi-card purple">
      <div id="kpiLabel3" class="kpi-label">Ending Open Valuation</div>
      <div id="kpiVal3" class="kpi-val">₹0</div>
      <div id="kpiSub3" class="kpi-sub">Active holdings @ CMP</div>
    </div>
    <div class="kpi-card emerald">
      <div id="kpiLabel4" class="kpi-label">Realized Profit / Loss</div>
      <div id="kpiVal4" class="kpi-val">₹0</div>
      <div id="kpiSub4" class="kpi-sub">Closed trade execution</div>
    </div>
    <div class="kpi-card amber">
      <div id="kpiLabel5" class="kpi-label">Total Net Wealth Created</div>
      <div id="kpiVal5" class="kpi-val">₹0</div>
      <div id="kpiSub5" class="kpi-sub">0.00% absolute return</div>
    </div>
  </div>

  <!-- Toolbar -->
  <div class="toolbar">
    <input type="text" id="searchInput" class="search-input" placeholder="Search by stock name or symbol (e.g. Aeroflex, Lumax, Taril, Syrma)..." oninput="handleSearch(this.value)">

    <div class="filter-group">
      <span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Status:</span>
      <button class="filter-btn active" data-filter="ALL" onclick="setStatusFilter('ALL')">All (<span id="countAll">0</span>)</button>
      <button class="filter-btn" data-filter="OPEN" onclick="setStatusFilter('OPEN')">Open (<span id="countOpen">0</span>)</button>
      <button class="filter-btn" data-filter="PARTIAL_TRIM" onclick="setStatusFilter('PARTIAL_TRIM')">Partial Trim (<span id="countPartial">0</span>)</button>
      <button class="filter-btn" data-filter="CLOSED" onclick="setStatusFilter('CLOSED')">Closed (<span id="countClosed">0</span>)</button>
    </div>
  </div>

  <!-- Table Box -->
  <div class="table-box">
    <table id="mainTable">
      <thead>
        <tr>
          <th style="width: 28px;"></th>
          <th onclick="sortTable('symbol')">Stock Name & Symbol ⇕</th>
          <th onclick="sortTable('status')">Status ⇕</th>
          <th onclick="sortTable('totalBoughtQty')">Bought Qty ⇕</th>
          <th onclick="sortTable('totalBoughtAmount')">Invested (₹) ⇕</th>
          <th onclick="sortTable('avgBuyPrice')">Avg Buy (₹) ⇕</th>
          <th onclick="sortTable('totalSoldQty')">Sold Qty ⇕</th>
          <th onclick="sortTable('totalSoldAmount')">Sold (₹) ⇕</th>
          <th onclick="sortTable('avgSellPrice')">Avg Sell (₹) ⇕</th>
          <th onclick="sortTable('openQty')">Held Qty ⇕</th>
          <th onclick="sortTable('cmp')">CMP (₹) ⇕</th>
          <th onclick="sortTable('realizedPnl')">Realized P&L (₹) ⇕</th>
          <th onclick="sortTable('unrealizedPnl')">Unrealized P&L (₹) ⇕</th>
          <th onclick="sortTable('netPnl')">Total Net P&L (₹) ⇕</th>
          <th onclick="sortTable('totalPnlPct')">Net Return % ⇕</th>
        </tr>
      </thead>
      <tbody id="tableBody">
        <!-- Rendered via JS -->
      </tbody>
    </table>
  </div>

  <div class="footer-note">
    Ladder Dynamic FinTech Architecture · Strict Mathematical Parity · Updated as of 30-Oct-2026
  </div>

</div>

<script>
const realisticData = ${JSON.stringify(realisticData)};
const actualData = ${JSON.stringify(actualData)};
const unlimData = ${JSON.stringify(unlimData)};

let currentMode = 'realistic';
let currentSearch = '';
let currentFilter = 'ALL';
let sortCol = 'netPnl';
let sortAsc = false;
let expandedRows = new Set();

function formatINR(val) {
  if (val === null || val === undefined || isNaN(val)) return '₹0';
  const num = Math.round(val);
  return '₹' + num.toLocaleString('en-IN');
}

function formatFloat(val) {
  if (val === null || val === undefined || isNaN(val)) return '0.00';
  return Number(val).toFixed(2);
}

function switchMode(mode) {
  currentMode = mode;
  document.getElementById('btnRealistic').classList.toggle('active', mode === 'realistic');
  document.getElementById('btnActual').classList.toggle('active', mode === 'actual');
  document.getElementById('btnUnlimited').classList.toggle('active', mode === 'unlimited');
  expandedRows.clear();
  render();
}

function handleSearch(val) {
  currentSearch = (val || '').trim().toLowerCase();
  renderTableOnly();
}

function setStatusFilter(status) {
  currentFilter = status;
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-filter') === status);
  });
  renderTableOnly();
}

function toggleExpand(sym) {
  if (expandedRows.has(sym)) {
    expandedRows.delete(sym);
  } else {
    expandedRows.add(sym);
  }
  renderTableOnly();
}

function sortTable(col) {
  if (sortCol === col) {
    sortAsc = !sortAsc;
  } else {
    sortCol = col;
    sortAsc = ['symbol', 'status'].includes(col) ? true : false;
  }
  renderTableOnly();
}

function getActiveDataset() {
  if (currentMode === 'realistic') return realisticData;
  if (currentMode === 'actual') return actualData;
  return unlimData;
}

function renderKPIs() {
  const data = getActiveDataset();
  const s = data.summary;

  if (currentMode === 'realistic') {
    document.getElementById('kpiLabel1').innerText = 'Out-of-Pocket Capital Infused';
    document.getElementById('kpiVal1').innerText = formatINR(s.totalInfused);
    document.getElementById('kpiSub1').innerText = '₹45L starting + ₹18L SIP (10 mos)';

    document.getElementById('kpiLabel2').innerText = 'Recycled Sales Capital';
    document.getElementById('kpiVal2').innerText = formatINR(s.totalRecycled);
    document.getElementById('kpiSub2').innerText = '100% reinvested into buys';

    document.getElementById('kpiLabel3').innerText = 'Ending Valuation (@ CMP)';
    document.getElementById('kpiVal3').innerText = formatINR(s.endingValuation);
    document.getElementById('kpiSub3').innerText = s.totalStocks + ' stocks · ₹' + Math.round(s.liquidCash) + ' cash';

    const relEl = document.getElementById('kpiVal4');
    relEl.innerText = (s.realizedPnl >= 0 ? '+' : '') + formatINR(s.realizedPnl);
    relEl.className = 'kpi-val ' + (s.realizedPnl >= 0 ? 'pos' : 'neg');
    document.getElementById('kpiSub4').innerText = 'Realized loss from disciplined stops';

    const netEl = document.getElementById('kpiVal5');
    netEl.innerText = (s.netWealthGain >= 0 ? '+' : '') + formatINR(s.netWealthGain);
    netEl.className = 'kpi-val ' + (s.netWealthGain >= 0 ? 'pos' : 'neg');
    document.getElementById('kpiSub5').innerText = '+' + formatFloat(s.roiPct) + '% Net ROI (Grew to ₹' + Math.round(s.finalPortfolioValuation).toLocaleString('en-IN') + ')';
  } else {
    document.getElementById('kpiLabel1').innerText = 'Capital Deployed (Buys)';
    document.getElementById('kpiVal1').innerText = formatINR(s.totalInvested);
    document.getElementById('kpiSub1').innerText = s.totalTrades + ' trades · ' + s.totalStocks + ' stocks';

    document.getElementById('kpiLabel2').innerText = 'Sales Realized Proceeds';
    document.getElementById('kpiVal2').innerText = formatINR(s.totalSold);
    document.getElementById('kpiSub2').innerText = 'Proceeds from trims & exits';

    document.getElementById('kpiLabel3').innerText = 'Ending Open Valuation';
    document.getElementById('kpiVal3').innerText = formatINR(s.endingValuation);
    document.getElementById('kpiSub3').innerText = 'Active holdings @ CMP (30-Oct)';

    const relEl = document.getElementById('kpiVal4');
    relEl.innerText = (s.realizedPnl >= 0 ? '+' : '') + formatINR(s.realizedPnl);
    relEl.className = 'kpi-val ' + (s.realizedPnl >= 0 ? 'pos' : 'neg');
    document.getElementById('kpiSub4').innerText = 'Closed trade execution';

    const netEl = document.getElementById('kpiVal5');
    netEl.innerText = (s.netPnl >= 0 ? '+' : '') + formatINR(s.netPnl);
    netEl.className = 'kpi-val ' + (s.netPnl >= 0 ? 'pos' : 'neg');
    document.getElementById('kpiSub5').innerText = (s.roiPct >= 0 ? '+' : '') + formatFloat(s.roiPct) + '% overall return on capital';
  }

  // Counts
  const stocks = data.stocks;
  document.getElementById('countAll').innerText = stocks.length;
  document.getElementById('countOpen').innerText = stocks.filter(x => x.status === 'OPEN').length;
  document.getElementById('countPartial').innerText = stocks.filter(x => x.status === 'PARTIAL_TRIM').length;
  document.getElementById('countClosed').innerText = stocks.filter(x => x.status === 'CLOSED').length;
}

function renderTableOnly() {
  const data = getActiveDataset();
  let list = [...data.stocks];

  if (currentSearch) {
    list = list.filter(s =>
      s.symbol.toLowerCase().includes(currentSearch) ||
      (s.name && s.name.toLowerCase().includes(currentSearch))
    );
  }

  if (currentFilter !== 'ALL') {
    list = list.filter(s => s.status === currentFilter);
  }

  list.sort((a, b) => {
    let va = a[sortCol];
    let vb = b[sortCol];
    if (typeof va === 'string') {
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    va = Number(va) || 0;
    vb = Number(vb) || 0;
    return sortAsc ? va - vb : vb - va;
  });

  const tbody = document.getElementById('tableBody');
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 40px; color: var(--text-muted);">No stocks matched your search filter.</td></tr>';
    return;
  }

  let html = '';
  for (const s of list) {
    const isExpanded = expandedRows.has(s.symbol);
    const relClass = s.realizedPnl >= 0 ? 'pos' : 'neg';
    const unrelClass = s.unrealizedPnl >= 0 ? 'pos' : 'neg';
    const netClass = s.netPnl >= 0 ? 'pos' : 'neg';

    let statusBadge = '<span class="badge-status badge-closed">CLOSED</span>';
    if (s.status === 'OPEN') statusBadge = '<span class="badge-status badge-open">OPEN</span>';
    else if (s.status === 'PARTIAL_TRIM') statusBadge = '<span class="badge-status badge-partial">PARTIAL</span>';

    html += '<tr class="stock-header-row ' + (isExpanded ? 'expanded' : '') + '" onclick="toggleExpand(\\'' + s.symbol + '\\')">';
    html += '<td><span class="toggle-icon">▶</span></td>';
    html += '<td><div class="stock-title-cell"><div><div class="sym-tag">' + s.symbol + '</div><div class="name-sub" title="' + (s.name || s.symbol) + '">' + (s.name || s.symbol) + '</div></div></div></td>';
    html += '<td style="text-align: left;">' + statusBadge + '</td>';
    html += '<td>' + s.totalBoughtQty.toLocaleString() + '</td>';
    html += '<td>' + formatINR(s.totalBoughtAmount) + '</td>';
    html += '<td>₹' + formatFloat(s.avgBuyPrice) + '</td>';
    html += '<td>' + s.totalSoldQty.toLocaleString() + '</td>';
    html += '<td>' + formatINR(s.totalSoldAmount) + '</td>';
    html += '<td>' + (s.totalSoldQty > 0 ? '₹' + formatFloat(s.avgSellPrice) : '-') + '</td>';
    html += '<td style="font-weight: 700; color: #FFF;">' + s.openQty.toLocaleString() + '</td>';
    html += '<td>₹' + formatFloat(s.cmp) + '</td>';
    html += '<td class="' + relClass + '">' + (s.realizedPnl >= 0 ? '+' : '') + formatINR(s.realizedPnl) + '</td>';
    html += '<td class="' + unrelClass + '">' + (s.unrealizedPnl >= 0 ? '+' : '') + formatINR(s.unrealizedPnl) + '</td>';
    html += '<td class="' + netClass + '" style="font-weight: 800; font-size: 14px;">' + (s.netPnl >= 0 ? '+' : '') + formatINR(s.netPnl) + '</td>';
    html += '<td class="' + netClass + '" style="font-weight: 700;">' + (s.totalPnlPct >= 0 ? '+' : '') + formatFloat(s.totalPnlPct) + '%</td>';
    html += '</tr>';

    html += '<tr class="trades-drawer ' + (isExpanded ? 'open' : '') + '">';
    html += '<td colspan="15" class="drawer-cell">';
    html += '<div class="sub-table-wrap">';
    html += '<table class="sub-table">';
    html += '<thead><tr>';
    html += '<th style="text-align: left;">Date</th>';
    html += '<th style="text-align: left;">Type</th>';
    html += '<th style="text-align: left;">Signal</th>';
    html += '<th>Qty</th>';
    html += '<th>Execution Price</th>';
    html += '<th>Trade Amount (₹)</th>';
    html += '<th>Realized P&L</th>';
    html += '<th style="text-align: left;">Strategy Reason / Execution Notes</th>';
    html += '</tr></thead>';
    html += '<tbody>';

    for (const t of s.trades) {
      let tBadge = '<span class="badge-trade-type type-buy">BUY</span>';
      if (t.type === 'SELL_TRIM' || t.signal === 'TRANCHE_1_TRIM') tBadge = '<span class="badge-trade-type type-trim">TRIM (33%)</span>';
      else if (t.type === 'SELL_FULL' || t.signal === 'TRANCHE_2_EXIT') tBadge = '<span class="badge-trade-type type-exit">FULL EXIT</span>';
      else if (t.type === 'SELL') tBadge = '<span class="badge-trade-type type-exit">SELL</span>';
      else if (t.type === 'BUY_PYRAMID') tBadge = '<span class="badge-trade-type type-pyramid">PYRAMID</span>';

      const tradePnlClass = (t.realizedPnl || 0) >= 0 ? 'pos' : 'neg';

      html += '<tr>';
      html += '<td style="font-weight: 600; color: #FFF;">' + t.date + '</td>';
      html += '<td>' + tBadge + '</td>';
      html += '<td style="color: var(--text-secondary);">' + (t.signal || t.type) + '</td>';
      html += '<td style="font-weight: 700;">' + t.qty.toLocaleString() + '</td>';
      html += '<td>₹' + formatFloat(t.price) + '</td>';
      html += '<td>' + formatINR(t.amount) + '</td>';
      html += '<td class="' + tradePnlClass + '">' + (t.realizedPnl ? ((t.realizedPnl >= 0 ? '+' : '') + formatINR(t.realizedPnl)) : '-') + '</td>';
      html += '<td style="color: var(--text-secondary); font-size: 11px; max-width: 500px;">' + (t.reason || '-') + '</td>';
      html += '</tr>';
    }

    html += '</tbody></table></div></td></tr>';
  }

  tbody.innerHTML = html;
}

function render() {
  renderKPIs();
  renderTableOnly();
}

render();
</script>

</body>
</html>
`;

const reportPath = path.join(projectRoot, 'public', 'buy_sell_analysis_2026.html');
fs.writeFileSync(reportPath, htmlContent, 'utf8');
console.log(`[Report] Successfully regenerated HTML report with Realistic Capital as Mode 1 at: ${reportPath}`);
