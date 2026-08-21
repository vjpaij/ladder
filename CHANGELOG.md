# Ladder Version History & Changelog

All notable changes to the **Ladder Finance Dashboard** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.9.0] - 2026-08-21

### Added
- **Dynamic Company Logos**: Integrated a multi-pipeline logo resolution engine utilizing `logos.hunter.io`, GitHub's Indian Listed Companies SVG CDN, Parqet, IEX, and CompaniesMarketCap APIs to automatically map and pull real company logos and AMC icons across all Mutual Funds, US Stocks, Indian Equities, and Bank Account cards. Removed reliance on alphabet initial fallbacks where possible.

---

## [3.8.0] - 2026-08-16

### Changed
- **UI Layout Polish**: Reorganized the TopNavbar, removing the Date/Time display and aligning the 'Add Investment' button to match the global Theme style. 
- **Sidebar Reorganization**: Eliminated redundant Net Worth ticker and elegantly placed a responsive Date/Time widget below the brand logo that automatically stacks compactly when the sidebar is collapsed.
- **Edit Profile Modal**: Refined styling to perfectly fit content with a blurred glassmorphism backdrop instead of a heavy dimming overlay.

---

## [3.7.0] - 2026-08-16

### Changed
- **Database Architecture**: Created `asset_metadata_seed.sql` to instantiate the `asset_metadata` table in Supabase, strictly isolating Sector and Capitalisation mappings (Mega, Large, Mid, Small, Micro) from holdings.
- **Tabbed UI Segregation**: Rebuilt `ReportsView.jsx` with strict tabbed architecture separating Equity charts (Market Cap, Sectors) from Fixed Income/NPS.
- **Expanded Benchmarks**: Integrated comprehensive tracking suite to the Portfolio Growth chart including Nifty 50, Nifty Midcap 150, Nifty 250, S&P 500, and NASDAQ.

---

## [3.6.0] - 2026-08-16

### Added
- **Dynamic Asset Filtering**: Upgraded `ReportsView.jsx` to support dynamic asset filtering (Combined Portfolio, Consolidated Equity, Fixed Income). Added a new Market Cap chart and dynamic Sector filtering.
- **Metadata Support**: Updated backend `/api/holdings` routes in `server/index.js` to accept and persist `market_cap` metadata natively.

---

## [3.5.1] - 2026-08-16

### Changed
- **Icon Refinement**: Changed EPF icon from Wallet to Briefcase for better relevance.
- **Label Refinement**: Changed all instances of "Liabilities" to "Liability" globally across components, page headers, and API display names. Fixed remaining backend API labels for Indian Equity and US Equity in `server/index.js`.

---

## [3.5.0] - 2026-08-16

### Changed
- **Global Icon and Label Refinement**:
  - Replaced Indian Equities icon with CandlestickChart.
  - Renamed all instances of "Equities" to "Equity" across the project.
  - Differentiated confusing icons: Asset Allocation uses Donut, Reports uses BarChart3, NPS uses Shield, and EPF uses Wallet.
  - Standardized master context file naming from LADDER.MD to LADDER.md.
- **Date and Time Integration**: Integrated a live, persistent Date and Time clock stamp into `TopNavbar.jsx` visible across all pages.

---

## [2.6.0] - 2026-08-16

### Added
- **Performance Table Column Sorting**: Interactive click-to-sort on every column header (Asset Class, Invested, Current Value, Unrealized P&L, Realized P&L, ABS Return, XIRR) with ascending/descending directional indicators.
- **Calendar Date Range Picker**: Added a dedicated Calendar button and popover modal featuring From Date and To Date input pickers alongside the 1M, 3M, 6M, 1Y, and ALL preset pills for custom Net Worth range analysis.
- **Pie Slice & Legend Pop-Forward Interactivity**: Clicking a pie slice or clicking/hovering a legend item physically scales up the corresponding slice (`scale(1.08)`) with an emerald glow highlight. Suppressed default browser SVG focus outline box on click.

### Fixed
- **XIRR Convergence & Rate Sanitization**: Upgraded XIRR calculation engine (`xirrCalculator.js`) using Newton-Raphson primary solver with Bisection fallback for guaranteed convergence. Clamped rate outputs between -99.9% and +300% to eliminate extreme mathematical artifacts.
- **Full Historic Dividend Integration**: Corrected dividend field parsing in `/api/summary` to read `amount_inr` and `amount_original`, recovering 477 historic dividend records worth ₹9,62,886.70. Dividends are now fully included in Realized P&L (raising total Realized P&L to ₹16.98L) and added as cashflows to XIRR calculations.
- **Date-Accurate Net Worth History**: Re-engineered Net Worth history point computation to dynamically calculate exact historical portfolio net worth for any selected time window (1M, 3M, 6M, 1Y, ALL, CUSTOM).
- **Sharp Linear Spikes & 2 Decimal Precision**: Changed Net Worth AreaChart line type from smooth curves (`type="monotone"`) to sharp linear segments (`type="linear"`) with daily trading session noise. Enforced 2 decimal point precision on Y-Axis ticks (`₹1.88Cr`, `₹1.82Cr`) and tooltip values (`₹1,80,44,141.00`).
- **Clean Display Naming**: Removed parenthetical technical abbreviations and suffixes across the dashboard (Indian Equities, US Equities, Mutual Funds, NPS, Bank Accounts, EPF).
- **Glassmorphism Tooltip Styling**: Replaced default Recharts tooltips with custom glassmorphism components (`CustomPieTooltip` and `CustomNetWorthTooltip`), eliminating dark box and unreadable text hover artifacts.

### Changed
- **Dashboard Layout Reordering**: Moved the Performance table section directly below the Net Worth hero card (above the charts) and simplified the section title to "Performance".

---

## [2.1.0] - 2026-08-15

### Changed
- **Modern Floating Layout**: Upgraded application architecture decoupling the sidebar, top navbar, and main content view into distinct glass cards separated by spatial gaps.
- **Collapsible Sidebar**: Engineered a collapsible sidebar toggle state in `Sidebar.jsx`, converting it from a wide panel into a compact icon-only floating rail.
- **Light Theme Adaptability**: Fixed hardcoded dark mode `EpfView.jsx` styles to adapt smoothly to both light and dark themes using `glass-card` elements.
- **VP Avatar Theming**: Profile avatar now strictly matches the Ladder brand blue-indigo gradient palette.

---

## [2.0.0] - 2026-08-15

### Added
- **Universal Multi-Theme System**: 6 custom high-contrast palettes spanning Dark Themes (Obsidian Dark, Midnight Blue, Sunset Rose) and Light Themes (Clean Light, Warm Sand, Nordic Frost).
- **Synchronized Popups**: Assigned dedicated theme surface fills for top navigation controls, search inputs, and submetric cards. Removed hardcoded dark inline styles from `HoldingDetailModal.jsx` and `AddAssetModal.jsx` to ensure all popup windows automatically match the active theme.

---

## [1.9.9] - 2026-08-15

### Changed
- **Navigation Branding**: Harmonized top navbar action buttons and updated `Sidebar.jsx` highlights to dynamically match the active theme palette. Simplified section naming (Dashboard, Calendar, NPS, EPF) and changed the Dividends icon.
- **User Profile Menu**: Simplified the User Profile menu to exclusively focus on profile photo upload/management, identity, and secure sign-out. Moved Import/Export to a dedicated top navbar button. Custom Profile Photo Upload implemented with Base64 image compression.
- **Enhanced Search Ticker**: Live autocomplete dropdown prompting all matching user investments/tickers across all instrument types.

---

## [1.9.1] - 2026-08-10

### Changed
- **Simplified Asset EOD Ledgers**: Simplified the transaction ledger for Bank, EPF, and Liability components in `HoldingDetailModal.jsx`. Removed `Qty` and `Price` columns and replaced with a clear 'Daily Balance History' showing `#`, `Date`, `EOD Balance (₹)`, `Daily Change` (with `↑ +₹X` green or `↓ -₹X` red arrow badges), and `Notes`.
- **EPF Naming**: Renamed 'Employee Provident Fund (EPF)' to a more concise 'EPF'.
- **Loan Details Updated**: Updated the Housing Loan lender to 'State Bank of India (SBI)' / 'Housing Loan (SBI Bank)'.

---

## [1.9.0] - 2026-08-10

### Added
- **Dedicated Portfolios**: Replaced the previous `FixedIncomeView` with dedicated **Bank Accounts** (`BankView.jsx`) and **EPF** (`EpfView.jsx`) pages.
- **Enhanced Liabilities Hub**: Upgraded the **Liabilities & Debt** page (`LiabilitiesView.jsx`) under the CASHFLOW section.
- **Historical EOD Ingestion**: Created an automated `load_eod_balances.mjs` script parsing 6,890 daily EOD historical records (2007-2026) from `portfolio.xlsx` into `data/portfolio_eod_logs.json` and Supabase.
- **Universal Modal Support**: Upgraded `HoldingDetailModal.jsx` and the `/api/holding/:holdingId/detail` endpoint to render custom 6-KPI metrics cards (Current Balance, Peak Historical, Min Historical, 1-Year Delta, Inception Date, Daily EOD status), a 19-year interactive daily EOD timeline chart, and date-by-date balance ledger logs for all Bank, EPF, and Liability instruments.

---

## [1.8.2] - 2026-08-10

### Added
- **Daily Historical Charting**: Implemented high-fidelity daily historical NAV charting in `HoldingDetailModal.jsx` and `server/index.js` for NPS schemes, utilizing a new `fetchNpsHistoricalNav()` cache engine in `priceEngine.js` to cross-reference cumulative units against daily NAV datasets since 2020.
- **NPS UI Styling**: Added cyan accent theme (`#06b6d4`), 'NPS Scheme' labels, and 4-decimal precision formatting for quantities and NAVs.

---

## [1.8.1] - 2026-08-09

### Added
- **Official Protean NAV Scraper**: Upgraded NPS price engine to dynamically download and extract daily Protean CRA ZIP files (`.out` CSV) in-memory using `adm-zip` for exact official NAVs.
- **NPS Price Fallback**: Integrated `npsnav.in` as an automatic error-resilient fallback to handle scraper or layout failures.

---

## [1.8.0] - 2026-08-09

### Added
- **National Pension System (NPS) Integration**: Added NPS as a first-class portfolio asset class.
- **NPS Data Ingestion**: Created `load_nps_data.mjs` script parsing 7 yearly transaction statements (2020-2027) into Supabase.
- **NPS Frontend Views**: Built `NpsView.jsx` with sortable tables, status filter tabs, search, and integrated `HoldingDetailModal`.

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
  - Created `.agents/AGENTS.md` to enforce pre-execution context reading (`LADDER.md`), mandatory post-execution change logging, secret auditing, emoji-free documentation, and feature branch git releases.

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

