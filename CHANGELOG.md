# Ladder Version History & Changelog

All notable changes to the **Ladder Finance Dashboard** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.7.2] - 2026-08-09

### Changed
- **Main US Stocks View**: Removed redundant transaction rate column from the main table, as exchange rates apply at individual transaction date levels.
- **Holding Detail Modal**: Added Live FX Rate (Today) badge (1 USD = INR XX.XX) prominently in the modal header for US Stocks.

---

## [1.7.1] - 2026-08-09

### Added
- **Interactive Modal Currency Toggle**: Added INR / USD toggle pill directly in HoldingDetailModal header for US Stocks, enabling instant on-the-fly currency switching.
- **Dual Currency Detail Engine**: Updated GET /api/holding/:holdingId/detail to compute and return complete USD and INR performance metric sets and timeline data series.

---

## [1.7.0] - 2026-08-09

### Added
- **Full US Stocks Portfolio Ingestion**: Ingested 110 Buy/Sell orders from US_Stocks.xls across 12 tickers and 73 dividend records from Book2.xlsx into Supabase PostgreSQL.
- **Transaction FX Rate Storage**: Added fx_rate column to Supabase transactions table, storing exact transaction-date dollar rates.
- **Dual Currency Valuation**:
  - In USD mode, values and P&L display in USD.
  - In INR mode, invested capital reflects transaction-date exchange rates, market value reflects live dollar rates, and P&L captures both asset growth and USD/INR dollar appreciation.

---

## [1.6.0] - 2026-08-09

### Added
- **Full Indian Stocks Ingestion**: Ingested all 331 Indian stock symbols from Book1.xlsx, loading 4,184 transaction records and 404 dividends into Supabase PostgreSQL.
- **Custom Ingestion Rules Enforced**: Converted Sell All transactions to exact open quantity sales, saved Dividend Reinvestments as BONUS share additions with dynamic cost basis adjustments, and ignored Splits.

---

## [1.5.0] - 2026-08-09

### Added
- **Universal Holding Detail Modal**: Built Framer Motion slide-up modal with 7 KPI metric cards, Recharts cost basis vs market value timeline chart, and color-coded transaction ledger.
- **Holding Detail Backend Endpoint**: Added GET /api/holding/:holdingId/detail with FIFO realized P&L, Newton-Raphson XIRR cashflows, and chart timeline points.

---

## [1.4.0] - 2026-08-09

### Added
- **Portfolio Status Filter Tabs**: Added Active Positions, Fully Redeemed, and All Data filter tabs across Indian Stocks, US Stocks, and Mutual Funds views.
- **Default Column Sorting**: Enabled default alphabetical scrip name sorting across portfolio tables.

---

## [1.3.0] - 2026-08-09

### Added
- **Universal Spreadsheet Ingestion**: Built automated batch loaders and populated Supabase PostgreSQL database with holdings, transactions, and dividends.

---

## [1.2.0] - 2026-08-08

### Changed
- Synchronized documentation, conducted security audit, merged feature branch into main, and pushed production release to remote repository.

---

## [1.1.0] - 2026-08-08

### Added
- **Supabase Cloud PostgreSQL Database**:
  - Connected backend to Supabase project `ladder` (`https://ladder.supabase.co`).
  - Created database tables (`categories`, `fx_rates`, `holdings`, `transactions`, `liabilities`, `dividends`, `pnl_history`, `audit_logs`).
  - Configured Row Level Security (RLS) policies for user data isolation.
- **Automated Cross-Table Updates**:
  - Implemented PL/pgSQL function `update_holding_on_transaction()` and trigger `trg_update_holding_on_tx` to automatically calculate holdings quantity, average buy price, realized PnL, unrealized PnL, total charges, and scrip status (`ACTIVE` vs `REDEEMED`).
  - Created audit logging triggers (`trg_audit_holdings`, `trg_audit_liabilities`).
- **Supabase Vault Secrets Integration**:
  - Configured `supabase_vault` extension to securely store market data API credentials.
- **Enhanced Financial Metrics**:
  - Added `charges` and `net_amount` columns to `transactions` table.
  - Added `buy_qty`, `sell_qty`, `realized_pnl`, `unrealized_pnl`, `pnl_pct`, `total_charges`, and `status` columns to `holdings` table.
- **Workspace Agent Rules**:
  - Created `.agents/AGENTS.md` to enforce pre-execution context reading (`LADDER.MD`), mandatory post-execution change logging, secret auditing, emoji-free documentation, and feature branch git releases.

---

## [1.0.0] - 2026-08-08

### Initial Production Release

#### Added
- **Multi-View Navigation Architecture**: Modular sidebar navigation separating Executive Dashboard, Portfolios, Cashflow, and Data management.
- **Real-Time Price & FX Engine**:
  - Live NSE/BSE quote fetching with dual-exchange max price selector.
  - US Stock quote engine with automated live USD/INR exchange rate conversion.
  - AMFI Mutual Fund scheme NAV fetcher.
- **Framer Motion Animations**:
  - Page transition animations (`AnimatePresence`).
  - Staggered card entrance effects across all views.
  - Odometer-style animated counters (`AnimatedCounter.jsx`) for monetary metrics.
  - Hover micro-interactions and interactive button scales.
- **Executive Net Worth & KPI Hub**:
  - Live Net Worth calculation factoring total assets minus liabilities.
  - Cashflow-weighted XIRR calculation engine.
  - ROI % metric calculation.
- **P&L Calendar Heatmap**:
  - Daily session win/loss color-coded heatmap.
  - Date range filtering and daily session drill-down inspection.
- **Dividends & Cashflow Manager**:
  - Multi-currency dividend ledger (India & US payouts).
- **Liabilities & Loan Hub**:
  - Loan principal, credit card, interest rate, and EMI tracker.
- **Visual Database CRUD Studio**:
  - Embedded table inspector with inline editing capabilities and JSON export.
- **Excel/CSV Import & Export Engine**:
  - Spreadsheet parsing and backup database export.
- **Modern Theme System**:
  - Sleek dark mode glassmorphism UI with light mode toggle and instant INR/USD display currency switcher.

#### Fixed
- Fixed missing `glass-panel` CSS utility class definition.
- Fixed non-functional Tailwind v4 animation utility references.
- Pruned text descriptions across all views for a cleaner, professional presentation.
