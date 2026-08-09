# LADDER.MD - Master Project Context & Architecture Reference

> **MANDATORY DIRECTIVE FOR ALL AGENTS & DEVELOPERS**:
> **THIS FILE MUST BE READ FIRST BEFORE MAKING ANY CODE OR ARCHITECTURAL CHANGES TO THE LADDER PROJECT.**
> **ANY NEW FEATURES, MODIFICATIONS, BUG FIXES, OR REFACTORS MUST BE ACCURATELY LOGGED AND UPDATED IN THIS DOCUMENT (`LADDER.MD`) UPON COMPLETION.**

---

## Executive Project Summary

**Ladder** is an institutional-grade, highly modern, personal finance and investment management dashboard. It consolidates a user's entire wealth portfolio across multiple asset classes and debt instruments into a single interactive web application.

- **Primary Currency**: INR (₹) default with real-time USD/INR live conversion ($1 = ₹X) and instant header currency toggle.
- **Authentication**: Built-in local JWT authentication (`admin@ladder.com` / `admin123`).
- **Data Persistence**: In-memory & JSON-backed relational database engine (`server/db.js`) supporting full CRUD operations, cascade updates, and cross-table synchronization.

---

## Key Features & Functional Modules

### 1. Executive Overview & Net Worth Hub (`OverviewView.jsx`)
- Real-time calculation of **Net Worth = Total Assets - Total Liabilities**.
- **Hero Card**: Animated gradient border, glowing blur background orbs, odometer-style counting numbers (`AnimatedCounter.jsx`), and daily P&L badge.
- **Financial Metrics**:
  - **XIRR**: Cashflow-weighted annualized rate of return calculated via Newton-Raphson numerical methods (`xirrCalculator.js`).
  - **ROI (Absolute Return %)**: Total return on invested capital.
- **Interactive Visualizations**: Asset Allocation Donut Chart & Growth Trajectory vs. Nifty 50 Benchmark Area Chart (using Recharts).

### 2. Multi-Asset Portfolio Tracking
- **Indian Equities (`IndianStocksView.jsx`)**:
  - Live quote auto-fetch comparing **NSE** and **BSE** prices, automatically locking the higher market quote (`NSE/BSE MAX`).
  - Stock search/filter, average buy price, current locked price, unrealized P&L, ROI %, and inline row actions (Edit/Delete).
- **US Equities (`UsStocksView.jsx`)**:
  - Live USD stock price engine (NASDAQ/NYSE).
  - Dynamic conversion of holdings, dividends, and dollar gains into INR based on live FX rate (`fetchFxRate()`).
- **Mutual Funds (`MutualFundsView.jsx`)**:
  - Direct growth plan tracking with live Scheme NAVs fetched via AMFI Scheme Codes.
- **Fixed Income & Retirement (`FixedIncomeView.jsx`)**:
  - Consolidated tracking for Bank Accounts, Fixed Deposits, National Pension System (NPS), and Employee Provident Fund (EPF).

### 3. Liabilities & Debt Hub (`LiabilitiesView.jsx`)
- Tracks outstanding loan principals (Home Loan, Personal Loan) and Credit Card balances.
- Displays lender information, annual interest rates (%), monthly EMI obligations, and payment due dates.

### 4. P&L Calendar Heatmap (`CalendarView.jsx` & `CalendarHeatmap.jsx`)
- Color-coded daily trading session win/loss calendar grid (Green = Positive day, Red = Negative day).
- Date range picker (`startDate` / `endDate`) with live filtering.
- Stat summary cards: Range P&L, Green Days count, Red Days count, and Win Rate %.
- Interactive day drill-down inspecting historical Net Worth and Assets for that date.

### 5. Dividends Ledger (`DividendsView.jsx`)
- Tracks passive dividend cashflow across Indian & US equities.
- Automatic conversion of US dollar dividends to INR using historical/live exchange rates.
- Displays total dividends credited, India total, US total, and annualized cash yield %.

### 6. Relational Database Studio (`DatabaseStudioView.jsx`)
- Visual table inspector browsing all 8 database tables (`users`, `categories`, `holdings`, `transactions`, `liabilities`, `dividends`, `daily_pnl_logs`, `fx_rates`).
- **Visual CRUD**: Click any cell in the grid to edit and amend inline; saves directly to backend via `/api/db-table-update`.
- Direct table JSON exporter.

### 7. Excel & CSV Import / Export Hub (`ExcelToolsView.jsx`)
- Import holdings from `portfolio.xlsx`, `charges.xlsx`, or standard broker CSV files (Zerodha, Groww, INDmoney, Charles Schwab).
- Export complete database snapshot backups as JSON or Excel.

---

## UI/UX Design System & Aesthetics

- **Styling Stack**: Tailwind CSS v4 (`@tailwindcss/vite`) + Vanilla CSS tokens in `src/index.css`.
- **Animations Framework**: Framer Motion (`framer-motion`).
- **Theme Support**: Dark mode default (`#06080D` obsidian background, glassmorphism cards with `backdrop-filter: blur(20px)`), toggleable to clean light mode.
- **Key Motion Components**:
  - `AnimatedPage.jsx`: Framer Motion view wrapper with staggered child animations.
  - `AnimatedCounter.jsx`: Smooth ease-out cubic odometer counting numbers for big financial values.
  - `.gradient-border`: CSS animated gradient mask border for highlighted cards.

---

## Repository Directory Structure

```
ladder/
├── server/                    # Express Node.js Backend API
│   ├── db.js                  # In-memory/JSON Relational DB Engine
│   ├── index.js               # Express server entry point (Port 5000)
│   └── services/
│       ├── priceEngine.js     # Live price fetchers (NSE/BSE/NASDAQ/AMFI) & FX rates
│       └── xirrCalculator.js  # XIRR calculation logic
├── src/                       # React Frontend Application
│   ├── components/            # Shared & Reusable Components
│   │   ├── AddAssetModal.jsx  # Modal dialog for adding investments/liabilities
│   │   ├── AnimatedCounter.jsx# Number odometer component
│   │   ├── AnimatedPage.jsx   # Framer Motion view stagger wrapper
│   │   ├── HoldingDetailModal.jsx # Universal slide-up performance & ledger modal
│   │   ├── ReportsView.jsx    # Chart reports & analytics
│   │   ├── Sidebar.jsx        # Primary navigation sidebar
│   │   └── TopNavbar.jsx      # Top header with search, FX rate, theme/currency toggles
│   ├── context/
│   │   └── ThemeAuthContext.jsx # Global Theme, Currency, and Auth state provider
│   ├── views/                 # Top-Level Page Views
│   │   ├── CalendarView.jsx
│   │   ├── DatabaseStudioView.jsx
│   │   ├── DividendsView.jsx
│   │   ├── ExcelToolsView.jsx
│   │   ├── FixedIncomeView.jsx
│   │   ├── IndianStocksView.jsx
│   │   ├── LiabilitiesView.jsx
│   │   ├── MutualFundsView.jsx
│   │   ├── OverviewView.jsx
│   │   └── UsStocksView.jsx
│   ├── App.jsx                # Main router with AnimatePresence view transitions
│   ├── index.css              # Global styles, glassmorphism, & keyframe animations
│   └── main.jsx               # Vite React entry point
├── data/                      # JSON Database Tables storage
├── README.md                  # Installation & Quickstart guide
├── CHANGELOG.md               # Version history (Semantic Versioning)
└── LADDER.MD                  # Master Context & Change Log (THIS FILE)
```

---

## Change Log & Maintenance History

| Version | Date | Description / Key Changes | Author / Agent |
|:---:|:---:|:---|:---:|
| **v1.0.0** | 2026-08-08 | Initial production release. Implemented multi-view architecture, live price engine (NSE/BSE/NASDAQ/AMFI), FX conversion, Framer Motion animations, Database Studio, P&L Calendar, and pushed to GitHub (`vjpaij/ladder`). | Antigravity AI |
| **v1.0.1** | 2026-08-08 | Created master `LADDER.MD` context reference document and established agent guidelines for future change logging. | Antigravity AI |
| **v1.0.2** | 2026-08-08 | Configured `.agents/AGENTS.md` workspace rules to ensure AI agents read `LADDER.MD` before making changes and update the change log after every edit. | Antigravity AI |
| **v1.1.0** | 2026-08-08 | Connected project to Supabase Cloud PostgreSQL DB (`https://nbbdjvmqbdzguhesyydk.supabase.co`). Created DDL tables, RLS isolation policies, PL/pgSQL cross-table auto-update triggers, audit log triggers, Supabase Vault secret storage, and updated server DB SDK. Cleared sample data so user tables are ready for spreadsheet populating. | Antigravity AI |
| **v1.1.1** | 2026-08-08 | Added concise columns for charges (`brokerage`, `stt`, `stamp_duty`, `exchange_fee`, `sebi_fee`, `gst`, `charges`, `net_amount`) in `transactions` and PnL/redemption tracking (`buy_qty`, `sell_qty`, `realized_pnl`, `unrealized_pnl`, `pnl_pct`, `total_charges`, `status`) in `holdings`. Upgraded PL/pgSQL trigger `update_holding_on_transaction()`. | Antigravity AI |
| **v1.1.2** | 2026-08-08 | Simplified `transactions` table by removing individual tax breakdown columns and maintaining a single unified `charges` column. | Antigravity AI |
| **v1.1.3** | 2026-08-08 | Updated Supabase project endpoint URL to `https://ladder.supabase.co` in `.env` configuration. | Antigravity AI |
| **v1.1.4** | 2026-08-08 | Updated `.agents/AGENTS.md` with mandatory Git release rules: security audit for secrets, syncing `README.md` and `CHANGELOG.md`, no emojis/emoticons in docs/commits, and branching/merging workflow before pushing to main. | Antigravity AI |
| **v1.2.0** | 2026-08-08 | Performed security audit, synchronized `README.md` and `CHANGELOG.md` (emoji-free), merged feature branch into `main`, and pushed to remote GitHub repository (`origin main`). | Antigravity AI |
| **v1.2.1** | 2026-08-08 | Updated `.agents/AGENTS.md` git workflow rules instructing agents to preserve all feature/release branches after merging into `main`. | Antigravity AI |
| **v1.3.0** | 2026-08-09 | Created universal import CSV template (`Ladder_Universal_Import_Template.csv`) and documentation guide. Built automated NodeJS ingestion loader (`load_portfolio_data.js`) and parsed raw datasets (`Ind_Stocks.csv`, `Ind_Mfs.csv`, `US_Stocks.xls`), populating 376 holdings, 5,459 transactions, and 404 dividends into Supabase PostgreSQL. Enhanced `ExcelToolsView.jsx` UI with template download & sync status. | Antigravity AI |
| **v1.3.1** | 2026-08-09 | Cleared initial POC sample JSON files (`holdings.json`, `transactions.json`, `dividends.json`). Terminated stale server process and relaunched Express API server connected directly to Supabase PostgreSQL DB. Dashboard now exclusively renders real spreadsheet data (₹1.467 Cr Net Worth, 331 Indian Stocks, 33 Mutual Funds, 12 US Stocks). | Antigravity AI |
| **v1.4.0** | 2026-08-09 | Added Status Filter Tabs (`Active Positions`, `Fully Redeemed`, `All Data`) and Default Name Column Sorting across `IndianStocksView.jsx`, `UsStocksView.jsx`, and `MutualFundsView.jsx`. Table metrics dynamically update based on active vs redeemed status selection. Verified in browser. | Antigravity AI |
| **v1.4.1** | 2026-08-09 | Purged all Indian Stocks (`in_stocks`) and US Stocks (`us_stocks`) data from Supabase to restart from scratch. Deleted 331 `in_stocks` holdings + 3,769 transactions + 404 dividends, and 12 `us_stocks` holdings + 110 transactions. Mutual Funds data retained intact. | Antigravity AI |
| **v1.4.2** | 2026-08-09 | Added `symbol` (TEXT) and `name` (TEXT) columns to both `transactions` and `dividends` tables. Backfilled existing records via JOIN on `holdings`. Updated `load_one_symbol.mjs` loader to populate both fields on every insert going forward. | Antigravity AI |
| **v1.5.0** | 2026-08-09 | Built universal `HoldingDetailModal.jsx` component. Clicking any symbol/holding name in `IndianStocksView`, `UsStocksView`, or `MutualFundsView` opens a full-screen slide-up panel showing 7 KPI metric cards (Invested, Redeemed, Current Value, Unrealized P&L, Realized P&L, Dividends, Total XIRR), a Recharts dual-area timeline chart (Cost Basis vs Market Value), and a sortable, color-coded transaction ledger. Added `GET /api/holding/:holdingId/detail` backend endpoint computing FIFO realized P&L, XIRR cashflows, and chart timeline series. | Antigravity AI |
| **v1.5.1** | 2026-08-09 | Performed trial ingestion for `BLUESTARCO` (Indian Equities) enforcing custom business rules: (1) `Buy`, `Sell`, `Dividend` stored standard, (2) `Sell All` resolved to open quantity at transaction moment (13 shares) and stored as `SELL`, (3) `Dividend Reinvest` stored as `BONUS` with quantity addition (3 shares) adjusting average cost basis to ₹891.65, (4) `Split` ignored. Updated Supabase check constraint `transactions_type_check` to allow `BONUS` and `SPLIT`, and updated PL/pgSQL `update_holding_on_transaction` trigger. Verified FIFO realized P&L +₹16,434.80 and XIRR +64.99%. | Antigravity AI |
| **v1.6.0** | 2026-08-09 | Completed full batch ingestion for all **331 Indian Stock symbols** from `Book1.xlsx`. Ingested 4,184 transaction rows and 404 dividend records into Supabase. All custom rules enforced: `Sell All` converted to exact open quantity sales, `Dividend Reinvest` stored as `BONUS` with share additions adjusting average cost basis, `Splits` ignored. Resulted in 85 Active Holdings and 246 Redeemed Holdings, with cumulative buy cost of ₹29.33M, total realized P&L of +₹261,039.65, and recorded dividends of ₹170,594.32. | Antigravity AI |
| **v1.7.0** | 2026-08-09 | Ingested full US Stocks portfolio from `US_Stocks.xls` (110 Buy/Sell orders across 12 tickers) and `Book2.xlsx` (73 dividend payments & historical FX rates). Added `fx_rate` column to Supabase `transactions` table and stored exact transaction-date dollar rates. Implemented dual currency (USD/INR) P&L logic: in USD mode values show in `$`, in INR mode invested cost reflects transaction-date FX rates and P&L reflects difference between live dollar rate (₹87.25) and transaction dollar rates. Added `USD/INR Rate` column to transaction ledger in `HoldingDetailModal.jsx` for US stocks. Resulted in 11 Active Holdings and 1 Redeemed Holding (`ASML`). | Antigravity AI |
| **v1.7.1** | 2026-08-09 | Enhanced `HoldingDetailModal.jsx` and `server/index.js` (/api/holding/:id/detail) with complete dual currency (INR/USD) switching. When global toggle is INR, all 7 metric cards, chart timeline, and transaction amounts now display in `₹ INR` using historical purchase-date dollar rates for invested cost and live rates for market value. Added an interactive `[ ₹ INR | $ USD ]` toggle directly in the modal header for US Stocks allowing instant on-the-fly currency switching. | Antigravity AI |
| **v1.7.2** | 2026-08-09 | Cleaned up `UsStocksView.jsx` by removing redundant `Tx Rate (₹/$)` column from the main table (as rates apply at individual transaction date level). Added prominent **Live FX Rate (Today)** badge (`1 USD = ₹XX.XX`) in `HoldingDetailModal.jsx` header alongside the interactive INR/USD toggle. | Antigravity AI |

---

## Instructions for Future Changes

1. **Before Editing**: Always read `LADDER.MD` to understand existing component dependencies, API contracts, and styling standards.
2. **After Editing**: Update the **Change Log & Maintenance History** table above with the new version, date, concise description of changes, and author/agent.
3. **Git Workflow**: Commit changes locally with standard commit messages (`feat: ...`, `fix: ...`, `refactor: ...`) and push to `origin main`.
