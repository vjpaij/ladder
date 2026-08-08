# LADDER.MD - Master Project Context & Architecture Reference

> ⚠️ **MANDATORY DIRECTIVE FOR ALL AGENTS & DEVELOPERS**:
> **THIS FILE MUST BE READ FIRST BEFORE MAKING ANY CODE OR ARCHITECTURAL CHANGES TO THE LADDER PROJECT.**
> **ANY NEW FEATURES, MODIFICATIONS, BUG FIXES, OR REFACTORS MUST BE ACCURATELY LOGGED AND UPDATED IN THIS DOCUMENT (`LADDER.MD`) UPON COMPLETION.**

---

## 📌 Executive Project Summary

**Ladder** is an institutional-grade, highly modern, personal finance and investment management dashboard. It consolidates a user's entire wealth portfolio across multiple asset classes and debt instruments into a single interactive web application.

- **Primary Currency**: INR (₹) default with real-time USD/INR live conversion ($1 = ₹X) and instant header currency toggle.
- **Authentication**: Built-in local JWT authentication (`admin@ladder.com` / `admin123`).
- **Data Persistence**: In-memory & JSON-backed relational database engine (`server/db.js`) supporting full CRUD operations, cascade updates, and cross-table synchronization.

---

## 🚀 Key Features & Functional Modules

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

## 🎨 UI/UX Design System & Aesthetics

- **Styling Stack**: Tailwind CSS v4 (`@tailwindcss/vite`) + Vanilla CSS tokens in `src/index.css`.
- **Animations Framework**: Framer Motion (`framer-motion`).
- **Theme Support**: Dark mode default (`#06080D` obsidian background, glassmorphism cards with `backdrop-filter: blur(20px)`), toggleable to clean light mode.
- **Key Motion Components**:
  - `AnimatedPage.jsx`: Framer Motion view wrapper with staggered child animations.
  - `AnimatedCounter.jsx`: Smooth ease-out cubic odometer counting numbers for big financial values.
  - `.gradient-border`: CSS animated gradient mask border for highlighted cards.

---

## 📁 Repository Directory Structure

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

## 📝 Change Log & Maintenance History

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

---

## 🛠️ Instructions for Future Changes

1. **Before Editing**: Always read `LADDER.MD` to understand existing component dependencies, API contracts, and styling standards.
2. **After Editing**: Update the **Change Log & Maintenance History** table above with the new version, date, concise description of changes, and author/agent.
3. **Git Workflow**: Commit changes locally with standard commit messages (`feat: ...`, `fix: ...`, `refactor: ...`) and push to `origin main`.
