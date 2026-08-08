# Ladder Version History & Changelog

All notable changes to the **Ladder Finance Dashboard** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
