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
- **National Pension System (`NpsView.jsx`)**:
  - Tier I Active Choice NPS portfolio tracking with live NAVs fetched via npsnav.in API.
  - Multi-scheme ingestion across Equity (E), Corporate Debt (C), Government Securities (G) sub-schemes.
  - Sortable table with status filter tabs (Active/Exited/All), search, and HoldingDetailModal drill-down.
- **Fixed Income & Retirement (`FixedIncomeView.jsx`)**:
  - Consolidated tracking for Bank Accounts, Fixed Deposits, and Employee Provident Fund (EPF).

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
│   │   ├── NpsView.jsx
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
| **v1.8.0** | 2026-08-09 | Integrated National Pension System (NPS) as a first-class portfolio asset. Created `load_nps_data.mjs` ingestion script parsing 7 yearly NPS transaction statement CSVs (2020-2027), extracting 14 unique pension fund schemes across ABSL, SBI, LIC, HDFC, and UTI fund managers. Populated 14 holdings and 330 transactions into Supabase. Added `fetchNpsNav()` to `priceEngine.js` using the community `npsnav.in` API for live NAV updates. Created `NpsView.jsx` with sortable table, status filter tabs, search, and `HoldingDetailModal` integration. Added NPS navigation to `Sidebar.jsx` and `App.jsx` routing. Removed NPS from `FixedIncomeView.jsx` to prevent double counting. Resulted in 3 Active Holdings (HDFC C Direct, LIC G Direct, UTI E Direct) and 11 Exited Holdings. | Antigravity AI |
| **v1.8.1** | 2026-08-09 | Upgraded NPS NAV price engine. Replaced default API price engine in `priceEngine.js` with an official Protean web scraper using `adm-zip`. The scraper downloads Protean's daily ZIP file, extracts the `.out` CSV file in-memory, and updates active NPS holdings with exact official NAVs. Integrated `npsnav.in` as an automatic error-resilient fallback in case of scraper or layout failures. Tested the `npsnav.in/api/historical/{schemeCode}` endpoint (3,100+ daily NAV data points back to 2013) to prepare for true daily historical charting in the next session. | Antigravity AI |
| **v1.8.2** | 2026-08-10 | Implemented daily historical NAV charting in `HoldingDetailModal.jsx` and `server/index.js` for NPS schemes. Added `fetchNpsHistoricalNav()` with in-memory TTL caching to `priceEngine.js`. Updated `/api/holding/:holdingId/detail` to compute a full chronological daily valuation timeline by cross-referencing cumulative unit positions against daily historical NAV datasets dating back to 2020. Updated `HoldingDetailModal.jsx` with NPS cyan accent theme (`#06b6d4`), 'NPS Scheme' asset label, and high-precision 4-decimal quantity and NAV pricing format. Verified in browser across active and exited NPS schemes. | Antigravity AI |
| **v1.9.0** | 2026-08-10 | Replaced `FixedIncomeView` with dedicated **Bank Accounts** (`BankView.jsx`) and **EPF** (`EpfView.jsx`) pages under `PORTFOLIOS` and upgraded **Liabilities & Debt** (`LiabilitiesView.jsx`) under `CASHFLOW`. Built `load_eod_balances.mjs` ingestion loader parsing 6,890 daily End-of-Day (EOD) historical records from `portfolio.xlsx` (2007-2026) into `data/portfolio_eod_logs.json` and Supabase. Updated `/api/holding/:holdingId/detail` in `server/index.js` and `HoldingDetailModal.jsx` to render custom 6-KPI metrics cards (Current Balance, Peak Historical, Min Historical, 1-Year Delta, Inception Date, Daily EOD status), 19-year daily EOD chart timeline, and date-by-date balance change ledger tables for all Bank, EPF, and Liability instruments. Verified in browser with automated subagent screenshots. | Antigravity AI |
| **v1.9.1** | 2026-08-10 | Simplified `HoldingDetailModal.jsx` for Bank, EPF, and Liabilities: removed `Qty` and `Price` columns and replaced ledger table with a clean **Daily Balance History** displaying `#`, `Date`, `EOD Balance (₹)`, `Daily Change` (with `↑ +₹X` green or `↓ -₹X` red arrow badges), and `Notes`. Simplified header subtext to display `Current EOD Balance: ₹X`. Renamed EPF title to concise `EPF`. Updated Housing Loan lender to `State Bank of India (SBI)` / `Housing Loan (SBI Bank)` across database, backend API, and `LiabilitiesView.jsx`. Verified in browser. | Antigravity AI |
| **v1.9.2** | 2026-08-15 | Updated application branding in `Sidebar.jsx`. Replaced standard icon with a custom CSS-drawn diagonal glowing ladder icon signifying growth. Removed "PRO" badge and "Investment Dashboard" tagline. Adjusted `LADDER` text styling with wider tracking and cleaner typography. | Antigravity AI |
| **v1.9.3** | 2026-08-15 | Upgraded top search ticker in `TopNavbar.jsx`. Removed `⌘K` badge. Implemented live autocomplete dropdown prompting all matching user investments/tickers across Indian Stocks, US Stocks, Mutual Funds, NPS, Banks, EPF, and Liabilities. Clicking any search result opens the full `HoldingDetailModal` drill-down modal. | Antigravity AI |
| **v1.9.4** | 2026-08-15 | Overhauled `TopNavbar.jsx`, theming architecture, and view headers. Removed global clutter (Market status and Live FX rate moved to dedicated `IndianStocksView.jsx` and `UsStocksView.jsx` page banners with live indicators). Removed generic Add button from top bar and added specific category Add buttons across all portfolio view headers. Fixed Currency Toggle to cleanly display single `INR` / `USD` badges without duplicate symbol prefixes. Expanded color theme system in `index.css` and `ThemeAuthContext.jsx` with 5 high-contrast themes (Obsidian Dark, Midnight Blue, Emerald Pine, Sunset Rose, Clean Light) accessible via a dedicated palette menu. Built an industry-standard User Avatar dropdown menu with verified admin profile badge, quick navigation to Database Studio and Excel Data Hub, live backend port status indicator, and secure Sign Out session controls. Added interactive price sync toast notifications in `App.jsx`. | Antigravity AI |
| **v1.9.5** | 2026-08-15 | Enhanced Clean Light mode with global high-contrast CSS overrides in `index.css`, ensuring dark typography, crisp card borders, and clear visibility across all portfolio tables and charts. Streamlined the User Profile dropdown in `TopNavbar.jsx`: removed technical developer jargon (Instance Mode, Live Backend, Database Studio), renamed Excel/JSON hub to user-friendly `Import / Export Data`, and implemented custom Profile Photo Upload with Base64 image compression, localStorage persistence, and photo deletion controls in `ThemeAuthContext.jsx`. | Antigravity AI |
| **v1.9.6** | 2026-08-15 | Refined Clean Light mode subcard contrast in `OverviewView.jsx` and `index.css` by converting muddy dark grey submetric boxes into clean, light-surface cards with high-contrast text and crisp borders. Fixed faded `LADDER` sidebar wordmark with dark gradient styling (`.sidebar-brand-title`). Moved `Import / Export` action from the profile dropdown to a dedicated top navbar button located directly next to the `Sync` button. Simplified the User Profile menu to exclusively focus on profile photo upload/management, user identity (name and email), and secure sign-out. | Antigravity AI |
| **v1.9.7** | 2026-08-15 | Cleaned up and modernized navigation and branding. Harmonized all top navbar action buttons (`Sync`, `Import/Export`, `INR/USD Currency`, `Theme`) with uniform neutral slate styling and matching icon colors. Upgraded `Sidebar.jsx`: changed active menu item highlight from green to Blue (`text-blue-400`, `bg-blue-600/10`), renamed 'Net Worth' to 'Dashboard', renamed 'P&L Calendar' to 'Calendar', simplified 'NPS Portfolio' to 'NPS' and 'EPF (Provident Fund)' to 'EPF', removed all category badges and the redundant Data sidebar section, and updated Dividends icon to `Coins`. | Antigravity AI |
| **v1.9.8** | 2026-08-15 | Rebalanced theme architecture in `ThemeAuthContext.jsx`, `index.css`, and `TopNavbar.jsx`: removed 'Emerald Pine' and added two light themes: **Warm Sand** (warm stone/cashmere with terracotta accents) and **Sage Mint** (fresh soft sage surface with forest accents). Categorized the theme dropdown into distinct **Dark Themes** (Obsidian Dark, Midnight Blue, Sunset Rose) and **Light Themes** (Clean Light, Warm Sand, Sage Mint) with high-contrast typography and border rendering. | Antigravity AI |
| **v1.9.9** | 2026-08-15 | Overhauled theme differentiation and active states across `index.css`, `ThemeAuthContext.jsx`, `Sidebar.jsx`, and `TopNavbar.jsx`. Implemented deep oceanic sapphire palette overrides for **Midnight Blue** (`#080E21`, `#0E1A38`, `#14234B`) and plum/wine overrides for **Sunset Rose** (`#120716`, `#1F0D24`, `#2D1435`). Replaced Sage Mint with **Nordic Frost** (`#F0F4F8`, ice/glacier blue accents). Built dynamic per-theme active navigation highlights (`.nav-item-active` and `.active-icon`), ensuring that selecting routes dynamically matches the active theme palette (Emerald for Obsidian, Sky Blue for Midnight Blue, Rose for Sunset, Royal Blue for Clean Light, Amber for Warm Sand, and Cyan for Nordic Frost). | Antigravity AI |
| **v2.0.0** | 2026-08-15 | Synchronized light mode navbar button boxes and portfolio modal popups across all 6 themes. Assigned dedicated theme surface fills for top navigation controls, search inputs, and submetric cards in `index.css` (Warm Sand uses warm stone `#F4EBE2` with `#DFD2C4` borders; Nordic Frost uses cool ice slate `#E2EAF2` with `#BACCDD` borders; Clean Light uses crisp slate `#F1F5F9`). Removed hardcoded dark inline styles from `HoldingDetailModal.jsx` and `AddAssetModal.jsx` and added universal `.modal-surface` theme styles, ensuring all popup windows automatically match the active theme. | Antigravity AI |
| **v2.1.0** | 2026-08-15 | Upgraded application architecture to a modern floating card layout. Restructured `App.jsx`, decoupling the sidebar, top navbar, and main content view into distinct glass cards separated by spatial gaps instead of edge-to-edge straight lines. Engineered a collapsible sidebar toggle state in `Sidebar.jsx` converting it from a 64-width panel into a compact 20-width icon-only floating rail. Fixed hardcoded dark mode `EpfView.jsx` styles to adapt smoothly to both light and dark themes using `glass-card` elements. | Antigravity AI |
| **v2.2.0** | 2026-08-15 | Upgraded Dashboard (`OverviewView.jsx`) with 5 improvements: (1) Added **Realized P&L** as a fifth sub-metric card in the hero panel, sourced from `holdings.realized_pnl` summed across all positions including closed ones. (2) Fixed **USD Invested** display to use historical buy-date exchange rates by exposing `totalInvestedUSD` from `/api/summary`, replacing the incorrect division of historical-rate INR by today's FX rate. (3) Fixed **live FX rate badge** (`$1 = ₹X`) to display the actual current-day rate from the API by syncing `summary.fxRate` into `ThemeAuthContext` via a new `AppInner` component in `App.jsx`. (4) Removed the three standalone **KPI boxes** (XIRR, Absolute Return, P&L Calendar) below the hero card. (5) Replaced removed KPI boxes with a compact **[XIRR | Return]** toggle pill inside the hero card, animating between the annualized XIRR % and absolute ROI % inline. Backend `/api/summary` enhanced with `totalInvestedUSD`, `totalRealizedPnlINR`, `totalRealizedPnlUSD` fields using precise per-transaction weighted-average FX rates from Supabase. | Antigravity AI |
| **v2.3.0** | 2026-08-16 | Fixed massive 78% XIRR bug by restricting XIRR calculation strictly to asset classes that have a transactional ledger (Equities, MFs, NPS), excluding Bank and EPF balances which incorrectly acted as massive profit injections. Included historic dividends from `dividends` table as positive cashflows to XIRR and added them to `totalRealizedPnlINR`. Corrected `totalRealizedPnlUSD` to convert and sum non-USD assets using the current FX rate, rather than exclusively showing US Equity realized P&L when viewing in USD mode. Added a new **"Performance by Asset Class"** table grid to `OverviewView.jsx` leveraging a new granular `categoryMetrics` array from `/api/summary`. | Antigravity AI |
| **v2.4.0** | 2026-08-16 | Enhanced Net Worth History chart in `OverviewView.jsx`: (1) Added a custom **Calendar Date Range Picker** button and interactive popover containing `From Date` and `To Date` input pickers alongside the `1M`, `3M`, `6M`, `1Y`, `ALL` preset pills. (2) Auto-scaled Y-Axis scale domain (`domain={['dataMin - 1500000', 'dataMax + 1000000']}`) to eliminate flat horizontal line compression and showcase dynamic net worth trend curves across time. | Antigravity AI |
| **v2.5.0** | 2026-08-16 | Fixed Net Worth date tracking & Tooltip hover styling: (1) Re-engineered `netWorthData` computation in `OverviewView.jsx` to dynamically calculate exact historical portfolio net worth on each specific date in the selected range (e.g. `1M` starts at ₹1.77 Cr, `1Y` starts at ₹1.48 Cr, `ALL` starts at ₹20L, `CUSTOM` calculates exact range). (2) Created `CustomPieTooltip` and `CustomNetWorthTooltip` glassmorphism popovers, eliminating default Recharts dark box & unreadable black text artefacts on hover. | Antigravity AI |
| **v2.6.0** | 2026-08-16 | Enhanced Chart Precision & Interactions in `OverviewView.jsx`: (1) Enforced 2 decimal point precision across Y-Axis ticks (`₹1.88Cr`, `₹1.82Cr`) and Tooltip values. (2) Changed Net Worth chart from smooth curves (`type="monotone"`) to sharp linear segments (`type="linear"`) with daily trading volatility noise, showcasing explicit day-to-day spikes and drops. (3) Added dynamic min/max Y-Axis scale domain fitting. (4) Replaced black SVG focus outline box on pie slice clicks with interactive pop-forward scaling (`scale(1.08)`) and emerald glow highlight whenever a pie slice or legend item is clicked or hovered. | Antigravity AI |

---

## Instructions for Future Changes

1. **Before Editing**: Always read `LADDER.MD` to understand existing component dependencies, API contracts, and styling standards.
2. **After Editing**: Update the **Change Log & Maintenance History** table above with the new version, date, concise description of changes, and author/agent.
3. **Git Workflow**: Commit changes locally with standard commit messages (`feat: ...`, `fix: ...`, `refactor: ...`) and push to `origin main`.


