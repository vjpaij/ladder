# Ladder Version History & Changelog

All notable changes to the **Ladder Finance Dashboard** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.9.7] - 2026-08-30

### Added & Enhanced
- **High-Speed Metadata Engine Upgrade**: Replaced slow sequential Screener web scraping with concurrent, high-throughput Yahoo Finance primary API (`yahoo-finance2`) integration in `scripts/sync_asset_metadata.mjs`. Completed full metadata sync across all 343 assets (including previously missing exited shares).
- **Exited Shares & Automated Metadata Sync**: Modified metadata sync to fetch metadata from APIs for *all* holdings (including exited shares). Added an automated asynchronous background trigger in `POST /api/holdings` to run metadata sync immediately upon adding any new share.
- **Data Cleaning & UX Formatting**: Fixed sector override bug where missing metadata sectors saved as 'Unknown' were overwriting valid database sectors. Cleaned US Stock names by stripping out verbose legal/registry terms (e.g., "Common Stock", "Class A", "Registry Share").
- **UI Theme Alignment & Table Border Consistency**: Resolved black headers on light theme in Calendar View. Replaced `divide-y` with direct `[&>tr]:border-b` across all portfolio table bodies and removed left-edge vertical borders across portfolio views for a clean, borderless design.

---

## [4.9.2] - 2026-08-30

### Performance Optimization
- **High-Performance Growth Benchmark Engine**: Diagnosed and resolved 5-second latency on the Growth vs Indices benchmark report caused by repeated 6-batch Supabase transaction roundtrips (1.9s) and un-indexed string date sorting inside the transaction loop (~2.7s CPU event-loop spin across 25,000 iterations).
- **Binary Search Index Lookup**: Implemented pre-sorted index date arrays with $O(\log N)$ binary search lookup in `server/services/benchmarkEngine.js`, eliminating 25,000 repetitive string array sort operations per request.
- **In-Memory Transaction Caching**: Added high-speed in-memory caching of scoped BUY/SELL transactions and holdings with automated cache invalidation on new investment entry or metadata sync.
- **Sub-10ms Response Times**: Timeframe switching (`1M`, `3M`, `6M`, `1Y`, `ALL`) now returns in 5ms to 85ms (down from 5,000ms).

---

## [4.9.0] - 2026-08-30

### Added & Enhanced
- **Zero-Quantity Direct Holding Valuation Fix**: Hardened `computeHoldingValueINR` in `portfolioCalculator.js` and `companyMfBreakdown` in `ReportsView.jsx` to ensure unit-based assets (stocks/MFs/NPS) with 0 open shares/units return strictly ₹0.00 rather than falling back to the market share price as a ledger balance.
- **Interactive Company Mutual Fund Breakdown Modal**: Clicking any company name in MF Composition, Market Cap drill-down, or Sector drill-down opens a detailed modal displaying total holding value, direct equity allocation, and a scheme-by-scheme breakdown of every Mutual Fund holding that stock with exact fund weight (%), allocated rupee amount, and share of holding (%).
- **Theme-Adaptive High Contrast Across Light & Dark Modes**: Replaced all hardcoded dark classes (`bg-slate-900`, `text-white`) with responsive theme-aware classes (`bg-white/80 dark:bg-slate-900/80`, `text-slate-900 dark:text-white`, `border-slate-200 dark:border-slate-800`), ensuring crisp readability in Warm Light, Pure Light, and Dark themes.
- **MF Composition Report**: Renamed and positioned the dedicated Mutual Fund composition report as 'MF Composition' with an adaptive scheme selector dropdown.
- **Equity Hub Multi-Scope Retention**: Preserved Indian Stock, US Stock, and Mutual Funds scope checkboxes in Equity Hub.
- **Aggregated Company Valuations in Drill-Downs**: Aggregated company holdings across direct stocks and mutual funds into unified rows with combined rupee values.
- **Floating Persistent Back Button**: Added a semi-transparent floating back button at the bottom-right of the screen for scrolling drill-down views.
- **Benchmark Historical Date Alignment**: Aligned simulated benchmark trajectory starting capital to exact historical valuation on the initial date of the selected range.
- **Bar Chart Tooltip Title**: Fixed hover tooltip titles in Bar Chart mode to display asset/sector/cap tier names.
- **Clean Label Renaming**: Renamed 'Sectors & Drill-down' to 'Sectors' and 'Growth vs Indices' to 'Benchmark'.

---

## [4.8.5] - 2026-08-30

### Fixed & Enhanced
- **10-Year Benchmark Historical Data**: Upgraded `scripts/sync_index_history.mjs` and pulled 10 years of daily historical data across Nifty 50, Nifty Midcap 150, Nifty Smallcap 250, S&P 500, and NASDAQ.
- **Simulated Index Opportunity Growth Engine**: Refactored `/api/reports/growth-benchmarks` in `server/index.js` to simulate what the starting invested capital would have grown to if put into the selected index over the same timeframe, eliminating flat 0% benchmark lines when viewing 'ALL' or custom ranges.

---

## [4.8.4] - 2026-08-30

### Fixed & Enhanced
- **Contextual Chart Switcher**: Removed the Donut/Bar Chart toggle from non-applicable views (`Mutual Fund Look-Through` and `Growth vs Indices`), displaying it only when viewing `Allocation`, `Market Cap`, and `Sectors`.
- **Anti-Jitter Stabilization**: Disabled continuous Recharts animation loops and stabilized scope bindings, eliminating graph re-render jitter and jumping when background price feeds tick.
- **Full Mutual Fund Portfolio Expansion**: Populated the full 30 to 45 constituent company holdings for all 16 active mutual funds (467 rows in Supabase), reducing the "Other" cash buffer to minimal 2-4% and eliminating outliers.

---

## [4.8.3] - 2026-08-30

### Changed
- **Pure Light Theme Surface Refactor**: Replaced muddy dark containers with clean white cards (`bg-white`), crisp slate borders (`border-slate-200`), dark charcoal text (`text-slate-900`), and dark mode selectors (`dark:bg-slate-900`), ensuring full theme adherence in Light mode.
- **Clean Bar Chart Mode**: Replaced 3D graph with a clean Recharts Bar Chart mode (`Donut` vs `Bar Chart`) featuring non-squished tickers, clean Y-axis formatting in Lakhs, and hover tooltips.

---

## [4.8.2] - 2026-08-30

### Changed
- **Light Theme Contrast**: Enhanced contrast across all filter buttons, tabs, dropdowns, and cards with high-contrast text and crisp borders.
- **Removed Serial Numbers & Layout Stabilization**: Eliminated `#1`, `#2` badges from lists and stabilized hover animations to prevent layout shifting or re-render jumping.
- **Visible Benchmark Tracking Line**: Replaced standard `<AreaChart>` with `<ComposedChart>` from Recharts to ensure the benchmark dashed line and markers are fully visible and properly scaled.
- **3D Isometric Animated Graph**: Replaced the third table toggle with an interactive 3D Isometric Graph with perspective projection, glowing extruded vertical bars, lighting gradients, and Framer Motion spring physics.
- **Complete Mutual Fund Company Holdings Expansion**: Populated all constituent companies across active mutual fund schemes and grouped cash, debt, and liquid instruments under `Cash, Debt & Other`.
- **Luxury Animated Scheme Selector**: Replaced the dull rectangle `<select>` box with a custom glassmorphism dropdown menu.
- **Unified Standard Sector Normalization**: Integrated a comprehensive sector normalizer across Indian Equities, US Equities, and Mutual Funds, merging overlapping labels (such as Technology / IT) and ensuring mutual funds are completely decomposed into their real underlying company sectors.

---

## [4.8.1] - 2026-08-30

### Changed
- **Zero-Unnecessary-Text & Minimalist Polish**: Removed all verbose subtitle paragraphs, filler descriptions, and long blurbs across the Reports view and established a permanent workspace rule in `.agents/AGENTS.md`.
- **Calendar Date Range Picker in Growth vs Indices**: Added a custom date range popover with start and end date pickers alongside preset pills (`1M`, `3M`, `6M`, `1Y`, `ALL`).
- **Removed Floating Back Button & Added Inline Back Button**: Eliminated the intrusive floating bottom button that blocked screen content, replacing it with a clean, compact inline `← Back` button in `TopNavbar.jsx`.
- **Dynamic Scope-Aware Growth Trajectories**: Upgraded `/api/reports/growth-benchmarks` in `server/index.js` to calculate historical trajectories specifically for the selected Equity Hub checkboxes (e.g. Indian Stocks only, US Stocks only, or Mutual Funds).
- **Institutional Ranked Progress Bars**: Replaced squished Recharts horizontal bar charts with modern animated ranked progress bars featuring clean typography, badges, values, and zero text overlap.
- **Theme Card Borders & Clipping Fix**: Fixed card layout, border radius, and surface tokens across light and dark modes.

### Added
- **Nightly GitHub Actions Metadata Sync**: Created `.github/workflows/nightly_metadata_sync.yml` scheduled to run automatically every night at 23:00 IST (17:30 UTC) with 1-click manual trigger support.

---

## [4.8.0] - 2026-08-30

### Added
- **High-Contrast Glassmorphism Chart Tooltips**: Replaced Recharts default tooltip with the executive dashboard glassmorphism popover across all charts in `ReportsView.jsx`, displaying bold typography, color status pills, formatted currency in INR/USD, and 2-decimal percentage readouts.
- **Full Allocation Accounting with 'Other' Bucket**: Grouped individual holdings beyond Top 10 into an aggregate `Other (X assets)` slice so the pie chart and legends always represent 100% of the portfolio.
- **Live Internet Market Cap Classification Engine**: Created `asset_metadata` Supabase table and automated sync script (`scripts/sync_asset_metadata.mjs`) categorizing all stocks from internet data into Mega Cap (>₹2L Cr), Large Cap (₹60k-₹2L Cr), Mid Cap (₹20k-₹60k Cr), Small Cap (₹3k-₹20k Cr), and Micro Cap (<₹3k Cr).
- **Mutual Fund Look-Through & Underlying Companies**: Created `mutual_fund_holdings` Supabase table and sync script (`scripts/sync_mf_holdings.mjs`) mapping underlying company holdings, weights, and allocated rupee values across all active schemes, with scheme-by-scheme and cross-fund aggregated explorer views.
- **Interactive Sector Breakdown with Drill-Down**: Categorized all direct equities and fund holdings by industry sector. Clicking any sector reveals all constituent companies, their sources, market cap tiers, and allocated amounts.
- **Real-Time Date-by-Date Growth vs. Indices**: Integrated daily historical index series for Nifty 50, Nifty Midcap 150, Nifty Smallcap 250, S&P 500, and NASDAQ (`scripts/sync_index_history.mjs`), with interactive timeframe selector (1M, 3M, 6M, 1Y, ALL) and dynamic alpha outperformance calculation.
- **Dynamic Chart Style Switcher**: Added visual toggles between Donut/Pie Chart, Ranked Bar Chart, and Detailed List with Framer Motion animations.
- **On-Demand Refresh Metadata**: Added a refresh button triggering live re-synchronization of market caps, sectors, and benchmark indices.

---

## [4.7.7] - 2026-08-30

### Fixed
- **Bank Ledger Deduplication & Recalculator Query Pagination**: Diagnosed and resolved the +₹8.59L jump on Aug 30. Traced to duplicate delta transactions in Supabase and the Supabase default 1,000-row query truncation in `server/services/recalculator.js` when recalculating HDFC Savings Account from 6,896 transactions. Implemented chunked paginated transaction queries in `recalculator.js`, cleanly purged duplicate records, and re-executed `scripts/migrate_balance_history_to_transactions.mjs`, reconciling HDFC Savings to exact ₹10,619.89.
- **Weekend Valuation Parity & Settlement**: Reconciled Friday closing quotes in `data/historical_prices.json` (OIL @ ₹482.85, settled Friday NPS NAVs) and re-synchronized all 6,913 daily EOD logs via `scripts/rebuild_portfolio_eod.mjs`. Verified that Saturday (Aug 29) and Sunday (Aug 30) report exact ₹0.00 daily change (0.00%) with 0 changes and exact ₹18,708,675.57 Net Worth across all views.

---

## [4.7.6] - 2026-08-30

### Architectural
- **Universal Real-Time Single Source of Truth Valuation**: Resolved architectural data synchronization discrepancy between Dashboard Net Worth and Calendar current day value. Refactored `/api/daily-pnl` in `server/index.js` to inject a real-time portfolio snapshot for the current date using the centralized `computePortfolioValuation` engine with live price feeds (`liveQuoteCache`), identical to `/api/summary`.
- **Dynamic Day P&L Engine**: Updated `/api/summary` to compute `dayPnlINR` and `dayPnlPct` dynamically relative to yesterday's closing wealth from the historical log.
- **Dynamic EOD Detail Timelines**: Updated `/api/holding/:holdingId/detail` for Bank, EPF, and Debt instruments to dynamically reflect live database balances on today's timeline.
- **Continuous Calendar Polling**: Added 5-second background live polling in `CalendarView.jsx` ensuring that the calendar heatmap and table update live alongside the dashboard without requiring manual script runs.

---

## [4.7.5] - 2026-08-30

### Performance
- **Parallelized Cloud NAV Sweeps**: Refactored `syncAllMissingNavs()` in `server/services/priceEngine.js` to process Mutual Funds and NPS schemes in parallel with `Promise.all`, and added a 30-minute in-memory cache to `fetchProteanNpsNavBatch()`. Eliminated redundant Protean ZIP re-downloads and slashed script execution time from over 1 minute down to ~4 seconds.
- **Workflow Dependency Caching**: Upgraded `.github/workflows/daily_nav_sip_sync.yml` with `actions/cache@v4` on `node_modules` and deterministic `npm ci --omit=dev`. Avoids re-downloading and resolving packages on every run, saving 15-20 seconds per run.

---

## [4.7.4] - 2026-08-30

### Fixed
- **Price Sync Concurrency and Error Handling**: Refactored `refreshAllHoldingsPrices()` in `server/services/priceEngine.js` to run US equities, Indian equities (in concurrent batches of 15), Mutual Funds, and NPS schemes in parallel via `Promise.all` with localized `try/catch` handlers. Prevents single request network timeouts from crashing the server.
- **Quote Date Transmission**: Updated `/api/holdings` in `server/index.js` to return live `quote_date` extracted from `liveQuoteCache`, restoring the "Latest" badge indicators in Mutual Funds, NPS, and Holding Detail modal.
- **GitHub Actions Runner Upgrade**: Updated `.github/workflows/daily_nav_sip_sync.yml` to use Node.js 24 runtime to align with the local development environment and satisfy Node 24 support.

### Added
- **Visual Sync Confirmation**: Added a 3-second temporary emerald checkmark ("Synced") state to the Sync button in `TopNavbar.jsx` to provide immediate visual feedback upon sync completion.
- **Holding Detail Modal Quote Badge**: Standardized quote date display in `HoldingDetailModal.jsx` to use high-contrast "Today" and "As of" status pill badges matching portfolio category views.

---

## [4.7.3] - 2026-08-29

### Fixed
- **CRITICAL: Liability transaction reversal**: `DELETE /api/transactions/:id`, `PUT /api/transactions/:id`, and `POST /api/db-table-update` now correctly fall back to `liability_id` when `holding_id` is null, ensuring loan and credit card transactions trigger proper recalculation upon deletion or edit.
- **Recalculator query isolation**: Removed fragile `symbol`/`name` OR-matching from transaction queries in `recalculator.js`. All three branches (market, balance, liability) now query by primary key (`holding_id` or `liability_id`) only, preventing cross-contamination.
- **Form reset defaults**: After successful submission, form now resets to the correct portfolio-specific default type (e.g. `CREDIT` for bank, `CONTRIBUTION` for EPF, `CHARGE` for cards) instead of always resetting to `BUY`.

### Improved
- **SIP engine hardening**: Added `end_date` auto-closure (SIPs automatically close when their tenure ends), removed dangerous NAV fallback to 100 (skips execution if NAV unavailable), and added skip-tracking with detailed logging.
- **Recalculator**: Added `OPENING_BALANCE` as a valid debt-increasing transaction type for liabilities.
- **Success messages**: Context-specific per portfolio type (e.g. "Bank transaction recorded" vs generic "Investment recorded").
- **GitHub Actions cron**: Restricted to 8 runs/day during NAV declaration windows (IST 21:00-00:00 and 09:00-12:00) instead of 24 runs/day.

---

## [4.7.2] - 2026-08-29

### Added
- **Transaction-Based UI for Cash & Debt**: Upgraded `AddInvestmentView.jsx` to replace legacy static balance inputs with full transaction forms:
  - **Bank Accounts**: `Deposit / Earn (Credit)` vs `Spend / Withdraw (Debit)` with transaction amount, date, and description.
  - **EPF**: `Deposit / Contribution` vs `Withdrawal / Transfer`.
  - **Loans**: `EMI Payment / Prepayment (Reduces Debt)` vs `New Loan / Borrow (Increases Debt)`.
  - **Credit Cards**: `Card Expense / Purchase (Charge)` vs `Bill Payment / Refund`.
  - **Live Balance Projection Cards**: Displays real-time current balance $\to$ projected balance / debt based on the entered amount and action.

---

## [4.7.1] - 2026-08-29

### Fixed
- **Price Sync Function TypeError**: Fixed a bug in `server/services/priceEngine.js` where `fetchProteanNpsNavBatch` was returning `{ navMap, dbRows }` instead of the `navMap` instance directly, causing `proteanNavMap.get is not a function` during price sync (`/api/refresh-prices`).
- **Top Search Bar Width**: Expanded search input container in `TopNavbar.jsx` from `w-48 md:w-64` to `w-72 sm:w-80 md:w-96 lg:w-[380px]`, preventing placeholder text truncation (`Search tickers, investments, liabilities...`).

---

## [4.7.0] - 2026-08-29

### Added
- **Safety & Rollback Engine**: Built `scripts/dump_db_snapshot.mjs` and `scripts/restore_db_snapshot.mjs` with paginated retrieval past Supabase limits, SHA256 checksum verification, and dependency-ordered dry-run / full database recovery.
- **Universal Recalculation Engine**: Implemented `server/services/recalculator.js` (`recalculateHoldingState`) performing chronological FIFO replay, stock split scaling, bonus share dilution, and cash flow balance reconciliation upon any transaction edit, deletion, or addition.
- **US Equity Currency Clarity**: Added explicit USD ($) trade price helper note and live converted INR preview to `AddInvestmentView.jsx`.
- **Multi-Pass NPS & MF Scraping Engine**: Created `nps_daily_navs` table in Supabase, updated Protean CRA daily scraper with date-sorted zip retrieval, added `GET /api/nav/nps/:schemeCode`, added on-demand Refresh NAVs button and status badges to `MutualFundsView.jsx` and `NpsView.jsx`, and scheduled hourly GitHub Actions workflow `.github/workflows/daily_nav_sip_sync.yml`.
- **Delta-Ledger Migration**: Migrated all 9 Bank, EPF, Loan, and Credit Card accounts from static balances to discrete historical delta transactions (4,996 records from 2007-2026) in Supabase `transactions` table with foreign key `liability_id`, enabling full chronological balance reversibility.
- **Recurring SIP Engine**: Created `sips` table in Supabase, `/api/sips` CRUD routes, automated execution engine (`processDueSips`), and interactive `SipManagerModal` in `MutualFundsView.jsx`.

---

## [4.6.1] - 2026-08-29

### Added
- **Calendar Multi-Granularity Engine (Daily / Monthly / Yearly)**: (1) Added a segmented Granularity selector `[ Daily | Monthly | Yearly ]` in `CalendarView.jsx`; (2) Implemented robust chronological aggregation mapping across all 18 portfolio asset/liability columns with exact period-end snapshots and true cumulative period P&L / % return calculations; (3) Enabled full interactive Heatmap Grid and Spreadsheet Table view rendering at monthly and annual scale; (4) Upgraded drill-down popup modal to dynamically render period labels and period category changes.

---

## [4.6.0] - 2026-08-29

### Changed
- **Net Worth Chart Clean 0 Y-Axis Tick**: (1) Removed the text label (`₹0 Baseline`) from the reference line in `OverviewView.jsx`; (2) Explicitly injected `0` into the Y-axis `ticks` array when the domain spans across or below zero, rendering a clean `0` tick directly on the vertical axis.

---

## [4.5.9] - 2026-08-29

### Added
- **Dashboard Net Worth Chart DD-MM-YYYY Hover Date & 0-Baseline Reference Line**: (1) Enhanced Net Worth area chart tooltip in `OverviewView.jsx` to render the complete `DD-MM-YYYY` calendar date on hover (e.g. `24-06-2026`); (2) Added a subtle dashed `ReferenceLine` at `y=0` when the selected timeframe's Y-domain spans across or below 0; (3) Added negative sign formatting to Y-axis tick values and tooltips.

---

## [4.5.8] - 2026-08-29

### Changed
- **Post-May 12 2023 Missing Indian Equity Charges Full Population**: (1) Parsed remaining 735 records from `charges.xlsx` and populated charges for 615 previously unpopulated post-May 12 2023 Indian Equity transactions in Supabase; (2) Preserved already populated charges (24 transactions); (3) Re-aggregated and updated `total_charges` across 147 affected holdings; (4) Rebuilt all 6,912 daily EOD logs via `scripts/rebuild_portfolio_eod.mjs` and synced with Supabase `pnl_history`.

---

## [4.5.7] - 2026-08-29

### Changed
- **Pre-May 12 2023 Indian Equity Charges Population & Parity Sync**: (1) Parsed `charges.xlsx` and populated pre-2023-05-12 transaction charges across 365 Indian Equity transactions in Supabase; (2) Handled multiple transactions on the same date by allocating total charges to the transaction with the highest trade value (`quantity * price`); (3) Applied confirmed symbol aliases (`HDFC` -> `HDFCBANK`, `MAHINDCIE` -> `CIEINDIA`, `HBLPOWER` -> `HBLENGINE`, `ZOMATO` -> `ETERNAL`, `GET&D` -> `GVT&D`, `SKIPPERPP` -> `SKIPPER`); (4) Recalculated `total_charges` across 105 affected holdings and re-synchronized all 6,912 daily EOD logs via `scripts/rebuild_portfolio_eod.mjs` and Supabase `pnl_history`.

---

## [4.5.6] - 2026-08-29

### Fixed
- **Reinstated 2-Decimal Precision on Category Metrics**: Fixed an issue in `server/index.js` where the `/api/summary` endpoint was using `Math.round()` on category `investedINR`, `currentINR`, `realizedINR`, and `unrealizedINR`. Replaced with strict `.toFixed(2)` float precision to ensure the dashboard's Performance table correctly renders fractional paise instead of defaulting to `.00`.

---

## [4.5.5] - 2026-08-29

### Fixed
- **Removed Hardcoded Daily PnL Fallbacks**: Fixed a bug in `server/index.js` (`/api/summary`) where the daily PnL percentage was hardcoded to `0.82%` and the absolute change was falling back to an incorrect calculation (`totalGainINR * 0.008`) if the database fetch returned empty. The endpoint now correctly defaults to local `portfolio_eod_logs.json` as a fallback and accurately reports `0.00` change for non-trading weekend days.

---

## [4.5.4] - 2026-08-29

### Added
- **Dynamic Positive/Negative Coloring for Net Worth Chart**: Updated `OverviewView.jsx` to dynamically compare the start and end values of the selected timeframe. The area chart's stroke, fill gradient, and tooltip text now turn Red (`#EF4444`) if the final portfolio value is lower than the starting value of the range, and Emerald (`#10B981`) if it is higher.

---

## [4.5.3] - 2026-08-29

### Fixed
- **Dark Theme Native Date Picker Visibility Fix**: Applied `[color-scheme:dark]` CSS property to all `<input type="date">` elements across `OverviewView.jsx`, `CalendarView.jsx`, and `AddInvestmentView.jsx` to ensure native browser calendar icons are inverted and clearly visible in dark mode.

---

## [4.5.2] - 2026-08-29

### Fixed
- **Dashboard Net Worth Chart True EOD Integration & Redundant FX Badge Cleanup**: (1) Removed redundant `$1 = ₹95.38` badge from the Net Worth hero card in `OverviewView.jsx`; (2) Replaced the synthetic noise/math formula in the Net Worth History chart with true historical daily EOD logs fetched from `/api/daily-pnl` (e.g. 2007-2026 real daily records), ensuring the chart displays exact historical portfolio valuations across all range presets (`1M`, `3M`, `6M`, `1Y`, `2Y`, `3Y`, `5Y`, `10Y`, `ALL`).

---

## [4.5.1] - 2026-08-29

### Changed
- **Centralized Shared Single-Source-of-Truth Valuation Engine**: (1) Created `server/services/portfolioCalculator.js` (`computeHoldingValueINR` and `computePortfolioValuation`) as the single mathematical authority; (2) Refactored `server/index.js` (`/api/summary`, `/api/holdings`) and `scripts/rebuild_portfolio_eod.mjs` to consume the same shared module; (3) Zero mathematical divergence across all endpoints and views.

---

## [4.5.0] - 2026-08-29

### Changed
- **Zero-Variance Mathematical Parity Across Dashboard & Calendar**: (1) Standardized per-holding 2-decimal rounded accumulation in `scripts/rebuild_portfolio_eod.mjs` to match `/api/holdings` and `/api/summary` exactly; (2) Rebuilt all 6,912 EOD logs; (3) Verified exact 1-to-1 zero-paise match (`₹18,663,893.70` Net Worth, `₹23,162,513.86` Total Assets, `₹44,98,620.16` Total Liabilities) across Dashboard, Calendar, and Supabase.

---

## [4.4.9] - 2026-08-29

### Fixed
- **Non-Trading Day & Weekend Precision Alignment**: (1) Fixed floating-point precision summation discrepancy between 28 Aug and 29 Aug in `scripts/rebuild_portfolio_eod.mjs`; (2) Weekend non-trading days now carry forward Friday's exact valuation, total assets, liabilities, and net worth with exactly `₹0.00` daily change (0.00%); (3) Synchronized with Supabase `pnl_history`.

---

## [4.4.8] - 2026-08-29

### Changed
- **Calendar Table View Action Column Removal**: Removed redundant 'Action / View' column and header from the Calendar spreadsheet table in `CalendarView.jsx`. Entire row remains clickable for opening day valuation breakdown modal.

---

## [4.4.7] - 2026-08-29

### Added
- **Daily EOD Pricing Reconciliation & Mandatory Universal Page Synchronization Rule**: (1) Updated `data/historical_prices.json` with latest settled Friday closing prices (2026-08-28) across active holdings; (2) Rebuilt all 6,912 historical EOD logs via `scripts/rebuild_portfolio_eod.mjs` and synchronized with Supabase `pnl_history`; (3) Enforced mandatory Cross-Functional Data Integrity rule requiring all updates in any portfolio view or database table to immediately sync with all dependent views.

---

## [4.4.6] - 2026-08-29

### Added
- **Supabase Cloud Database Historical EOD Migration & Complete Excel Decoupling**: Upgraded Supabase `pnl_history` table schema with all 18 granular asset/liability breakdown columns and unique date constraint. Migrated all 6,912 daily historical records (2007 through 2026-08-29) from the spreadsheet directly into Supabase PostgreSQL Cloud. Reconfigured EOD engine to load base records and persist daily updates directly to Supabase `pnl_history`, completely severing runtime dependency on `portfolio.xlsx`.

---

## [4.4.5] - 2026-08-29

### Fixed
- **Weekend Carry-Forward & Non-Trading Timezone Alignment**: Corrected US stock and market asset valuation on weekends by aligning with Indian market non-trading calendar rules. Saturday and Sunday calendar entries carry forward Friday's finalized closing valuation without phantom weekend FX rate noise.
- **Unified Assets Table Header**: Refactored the Spreadsheet Table Header in `CalendarView.jsx` to group all 12 asset columns under a single top-level `ASSETS` header (`colSpan="12"`), unifying bank accounts, investments, and Total Assets into a single group that matches the `LIABILITIES & DEBT` group.

---

## [4.4.4] - 2026-08-29

### Added
- **Automated Daily Pricing Ingestion Engine**: Added `scripts/sync_daily_prices.mjs` to fetch live daily market quotes for 86 Indian stocks, 11 US stocks, 16 Mutual Funds, 3 NPS schemes, and daily USD/INR FX rates.
- **Dual-Tab Date Click Inspector**: Enhanced the calendar drill-down modal with dual-tab support ('Changes' vs 'All Balances') to inspect both individual asset balance movements and the total 8-category portfolio snapshot.

---

## [4.4.3] - 2026-08-29

### Fixed
- **Continuous Daily EOD Sync & Full Multi-Column Spreadsheet**: Diagnosed and resolved calendar cut-off on 21 August by reconstructing all 6,912 daily records from inception (2007) right up to the current date with full asset/liability carry-forwards, aligning calendar net worth with the dashboard.
- **True Previous-Day Delta Lookups**: Upgraded `/api/daily-pnl` to perform chronological previous-day lookups across all individual bank accounts, investments, and debts.

---

## [4.4.2] - 2026-08-29

### Added
- **Calendar Spreadsheet Table View & Interactive Switcher**: Added view toggle in `CalendarView.jsx` between Grid Heatmap and a Spreadsheet Table View with frozen sticky Date column and dynamic column sorting.

---

## [4.4.1] - 2026-08-29

### Changed
- **Holding Detail Modal KPI Terminology Clarification**: Replaced confusing and overlapping labels in `HoldingDetailModal.jsx` (`Invested`, `Redeemed`, `Cost Basis`, `Market Value`) with clear, unambiguous, intuitive terms: `Total Bought` (all historical purchase capital), `Total Sold` (all historical sale proceeds), `Current Cost` (cost basis of active shares currently held), and `Current Value` (live market valuation of active shares). Verified clean build with 0 errors.

---

## [4.4.0] - 2026-08-29

### Changed
- **Price Column Typography & Alignment Precision Upgrade**: Fixed baseline misalignment and text wrapping in Price column where day changes and Unicode arrow symbols broke onto multiple lines. Replaced unicode arrow characters with crisp Lucide `ArrowUp` and `ArrowDown` icons with `stroke-[3]` and `shrink-0` locked to the exact text baseline. Applied `whitespace-nowrap inline-flex` across `UsStocksView.jsx` and `IndianStocksView.jsx` ensuring numbers, currency symbols, and percentages maintain horizontal alignment.

---

## [4.3.9] - 2026-08-29

### Fixed
- **Uniform Header Action Alignment & Global roiPct Resolution**: Fixed `roiPct is not defined` crash in `NpsView.jsx` and `MutualFundsView.jsx` by explicitly declaring `roiPct`.
- **UI Alignment**: Relocated `USD ($) / INR (₹)` currency toggle in `UsStocksView.jsx` from the top header to the table controls bar beside the search input. Aligned top-right split returns card and primary action button (`+ Add Asset`) across all four asset categories (`IndianStocksView`, `UsStocksView`, `MutualFundsView`, `NpsView`) with pixel-perfect consistency. Validated clean build with 0 warnings/errors.

---

## [4.3.8] - 2026-08-29

### Fixed
- **Robust Multi-Tier XIRR Engine & US Equity Currency Toggle Fix**: Fixed missing `DollarSign` import and wired `toggleCurrency` in `UsStocksView.jsx`. Diagnosed and eliminated mathematical artifacts in XIRR caused by pooling unsynchronized closed holding cashflows lacking exit SELL transactions. Upgraded `/api/summary` in `server/index.js` to compute holding-level weighted XIRRs, exposing distinct `activeXirrPct`, `closedXirrPct`, and `xirrPct` (Combined). Connected individual category views to display true Active XIRR (+18.93% for Indian Stocks) and Combined XIRR (+7.52%), eliminating negative rate anomalies on profitable portfolios.

---

## [4.3.7] - 2026-08-28

### Changed
- **Split Card Centered Headers & Color-Coded Precision Polish**: Updated both `COMBINED` and `ACTIVE` / `REDEEM` headers to be centered badges atop each compartment across `IndianStocksView`, `UsStocksView`, `MutualFundsView`, and `NpsView`. Standardized fields to clean stacked rows: `Cost : <value>` and `Return : <value>` with exact 2-decimal precision. Added independent color-coding (emerald for profit, rose for loss) to both `Abs: +X.XX%` and `XIRR: +X.XX%` on both sides.

---

## [4.3.6] - 2026-08-28

### Added
- **Dual-Compartment Split Header Card**: Implemented a single, high-contrast dual-compartment glass card positioned directly to the left of the primary action button across all 4 category views (`IndianStocksView`, `UsStocksView`, `MutualFundsView`, and `NpsView`). Left compartment displays `COMBINED` badge, complete cost basis formatted to 2 decimal places, net return, `Abs: +X.XX%`, and `XIRR: +X.XX%`. Right compartment dynamically switches between `ACTIVE` and `REDEEM` when tabs are toggled.

---

## [4.3.5] - 2026-08-28

### Changed
- **Unified High-End Micro-Bar Styling**: Polished the integrated control & performance bar in `IndianStocksView`, `UsStocksView`, `MutualFundsView`, and `NpsView` into a single cohesive glassmorphic container. Removed redundant duplicate contextual text, unifying segmented tabs (`Active` vs `Redeemed`), an elegant vertical divider, high-contrast financial stats, and integrated search box in one harmonious horizontal bar.

---

## [4.3.4] - 2026-08-28

### Changed
- **Ultra-Minimal Integrated Micro-Bar Architecture**: Redesigned the header across `IndianStocksView`, `UsStocksView`, `MutualFundsView`, and `NpsView` to achieve maximum vertical breathing room. Implemented an ultra-sleek integrated micro-bar in the table controls row that seamlessly anchors the segmented tab switch side-by-side with a high-density, clutter-free financial stat strip.

---

## [4.3.3] - 2026-08-28

### Changed
- **Clean & Aligned Category Banner & Tab Bar Refactor**: Streamlined the top banner across all 4 category views (`IndianStocksView`, `UsStocksView`, `MutualFundsView`, `NpsView`) to feature a single, high-contrast Combined Performance card. Relocated contextual Active / Redeemed metrics into the filter tab bar row as an inline summary badge.

---

## [4.3.2] - 2026-08-28

### Added
- **Combined Portfolio Performance Banners**: Restored and upgraded the display of Combined Cost Basis and Overall P&L in the portfolio category views (`IndianStocksView`, `UsStocksView`, `MutualFundsView`, `NpsView`). The new design introduces a distinct glowing combination block that aggregates Active Cost Basis, Redeemed Cost Basis, Unrealized P&L, and Realized P&L without cluttering the UI.

---

## [4.3.1] - 2026-08-28

### Added
- **US Stocks Corporate Actions & Stock Split Engine**: Integrated full stock split extraction and retroactive lot scaling into [load_all_us_stocks.mjs](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/load_all_us_stocks.mjs), processing corporate action events from `Book2.xlsx` (such as the Arista Networks `ANET` 4:1 stock split on 2024-12-04). Scaled prior buy quantities (from 5.54 to 22.17 shares) and adjusted cost basis accordingly, bringing US equities to full parity with Indian stocks.
- **Unified Dividend Ledger Integration**: Updated `/api/holding/:holdingId/detail` in [server/index.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/index.js) to format and interleave all recorded dividends as `DIVIDEND` entries directly into the chronological Transaction Ledger, displaying amber `DIV` badges and dynamic dual USD/INR currency conversions across all equity holdings.

### Changed
- **Deterministic Event Ordering**: Added same-day event priority sorting (`BUY` -> `SPLIT` -> `SELL` -> `DIVIDEND`) to US equities ingestion.
- **Historical EOD Parity**: Re-executed [scripts/rebuild_portfolio_eod.mjs](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/scripts/rebuild_portfolio_eod.mjs) across all 6,900 historical days to ensure complete alignment with split-adjusted US positions.

---

## [4.3.0] - 2026-08-28

### Changed
- **Bonus Issue Warm Brown / Bronze Palette**: Replaced pink styling for Bonus Issues with Warm Saddle Brown / Bronze (`#b45309`) across scatter event dots, tooltip badges, and transaction ledger rows in `HoldingDetailModal.jsx`. This eliminates visual proximity with red SELL signals (`#f43f5e`), giving Bonus Issues an earthy, distinct visual identity.

---

## [4.2.9] - 2026-08-28

### Changed
- **Corporate Action Colors (Purple & Pink)**: Upgraded corporate action styling in `HoldingDetailModal.jsx` to Royal Purple (`#a855f7`) for Stock Splits and Vibrant Fuchsia Pink (`#ec4899`) for Bonus Issues across scatter event dots, tooltip badges, and transaction ledger rows. This creates complete visual distinction from the Sky Blue price line, Green BUY dots, Red SELL dots, and Amber Dividend dots in both Light and Dark themes.

---

## [4.2.8] - 2026-08-28

### Changed
- **Actual & Tracker Chart Palette**: Upgraded price curve lines to Electric Sky Blue (`#38bdf8` in Dark Mode, `#0284c7` in Light Mode) in `HoldingDetailModal.jsx`. This cleanly separates the continuous price line from emerald green BUY event dots (`#10b981`), rose red SELL dots (`#f43f5e`), and amber DIVIDEND dots (`#f59e0b`).

---

## [4.2.7] - 2026-08-28

### Fixed
- **Calendar Heatmap & Daily PnL Synchronization**: Re-executed `scripts/rebuild_portfolio_eod.mjs` across all 6,900 daily EOD records (2007-2026), incorporating split-adjusted and bonus-adjusted stock positions from Supabase into `data/portfolio_eod_logs.json`. The Calendar Heatmap (`CalendarView.jsx` and `/api/daily-pnl`) now displays smooth daily wealth and PnL trajectories on corporate action dates with zero artificial valuation spikes.

---

## [4.2.6] - 2026-08-28

### Fixed
- **Chart Tracker Extension to Real-Time Date**: Resolved the issue where chart timelines appeared flat/stopped after August 21 due to offline cached daily closing files. The dense timeline engine in `server/index.js` now dynamically anchors today's date (`2026-08-28`) directly to live ticking market quotes (`liveQuoteCache` / Yahoo Finance), restoring active chart curve tracking to the present moment.
- **EOD Asset Timeline Extension**: Appended current live balance points to EOD asset timelines (Bank, EPF, Loans).

---

## [4.2.5] - 2026-08-28

### Fixed
- **Date Column Alignment**: Positioned the Date strictly in its natural first column matching the ledger table headers, while centering the corporate action badge and detail across all remaining columns.
- **Removed Repetitive Corporate Action Text**: Eliminated duplicate wording so "Stock Split" and "Bonus" are not repeated (e.g. `[Stock Split] Ratio 1:10` and `[Bonus Issue] +100 Shares Credited`).

---

## [4.2.4] - 2026-08-28

### Added
- **Global Real-Time Forex Polling**: Added dedicated backend `/api/fx-rate` endpoint and integrated a 3-second live ticker loop in `ThemeAuthContext.jsx` so USD/INR exchange rate ticks dynamically in real-time across top navbar pills, US stock detail headers, and multi-currency conversions.
- **Bonus Shares Count Display**: Corporate action event bars now show the explicit number of bonus shares received (e.g. `+100 Shares Received as Bonus`) instead of ratio notations.

### Fixed
- **Light Theme High-Contrast Corporate Action Bars**: Styled corporate action event bars with vibrant indigo and cyan cards, crisp high-contrast dark text in light mode, and centered alignment for both light and dark themes.
- **Light Theme FX Pill Contrast**: Enhanced modal header FX pill and currency toggle buttons with high-contrast styling in light mode, eliminating the grayed-out look.

---

## [4.2.3] - 2026-08-28

### Added
- **Full-Width Corporate Action Separator Bars**: Replaced artificial `+shares` ledger rows with dedicated full-width corporate action event bars in `HoldingDetailModal.jsx` displaying date, type badge (`Stock Split` / `Bonus Issue`), and ratio without redundant text.
- **Split & Bonus Adjusted Open Stock Positions**: Buy quantities and unit cost bases for open stocks are now stored and calculated in split-adjusted units from their acquisition date, preserving exact total invested amounts.

### Fixed
- **Chart Valuation Distortion for Corporate Actions**: Fixed tracker charts (such as WEBELSOLAR and GAIL) where pre-split quantities multiplied by split-adjusted historical prices caused artificial 10x drops or step-jumps. Market values and cost basis lines now track smoothly across corporate actions.

---

## [4.2.2] - 2026-08-28

### Added
- **Live Holding Detail Modal Polling**: Integrated a 2-second live polling interval in `HoldingDetailModal.jsx` and updated `/api/holding/:id/detail` to extract from `liveQuoteCache`, ensuring open detail modals stream live prices, day changes, and valuations continuously.

### Fixed
- **Exact Decimal Precision Restored**: Replaced `Math.round()` with floating-point 2-decimal numbers (`Number(val.toFixed(2))`) in `/api/summary` for all Net Worth metrics (Net Worth, Assets, Liabilities, Invested, Gain, Day P&L), resolving the issue where values were truncated to `.00`.

---

## [4.2.1] - 2026-08-28

### Added
- **Real-Time USD/INR Live Forex Feed**: Integrated live market ticking USD/INR Forex quotes (`INR=X`) into `priceEngine.js` `fetchFxRate()`, replacing static daily snapshot data.
- **Top Navbar Real-Time Forex Badge**: Added an institutional live USD/INR exchange rate badge with a pulsing green indicator to `TopNavbar.jsx`.

### Fixed
- **On-Screen Live Ticker Stagnation**: Fixed a bug where `/api/holdings` was omitting `current_price: currentPriceNum` in returned holding objects, causing the browser UI to display stale database prices while on screen until a full refresh or page navigation occurred.
- **Instantaneous Summary Recalculation**: Updated `/api/summary` to compute portfolio valuations and day P&L using in-memory `liveQuoteCache`, ensuring seamless live price ticking.
- **Asynchronous Ticker Loop Stability**: Replaced fixed overlapping `setInterval` with a self-scheduling non-overlapping runner and optimized Indian stock batch fetching to complete in < 1.5 seconds.

---

## [4.2.0] - 2026-08-28

### Added
- **Corporate Action Support (Stock Splits & Bonus Issues)**:
  - Added full Stock Split (`SPLIT`) and Bonus Issue (`BONUS`) computation and tracking across database ingestion (`load_all_indian_stocks.mjs`), FIFO lot valuation engine, and dense timeline chart models.
  - Implemented open buy lot scaling: when a stock splits (e.g. 10:1 split in WEBELSOLAR), remaining shares in all open lots are multiplied by the split ratio while their unit cost bases are divided by the split ratio, preserving exact total invested capital.
  - Enhanced `HoldingDetailModal.jsx` transaction ledger to render dedicated indigo `SPLIT` badges (`+X shares`, `—` for price/amount, and descriptive notes such as `Stock split 1:10 — holding scaled from 168 to 1,680 shares`) and cyan `BONUS` badges (`+X shares`, `₹0.00` price, and dilution notes).
  - Added deterministic same-day transaction priority sorting (`BUY/BONUS` -> `SPLIT` -> `SELL` -> `SELL ALL` -> `DIVIDEND`) resolving same-day execution race conditions.

- **Multi-Layer Validation & Over-Sell Guardrails**:
  - Backend API (`/api/add-investment`): Added strict null checks, datatype assertions (non-negative numbers, valid dates), over-sell assertions preventing users from selling more shares than currently active in their portfolio, and active-holding assertions for splits and bonuses.
  - Frontend (`AddInvestmentView.jsx` & `AddAssetModal.jsx`): Implemented live holding lookups with dynamic over-sell alert banners, automated submit button disabling when entering excessive sell quantities, and real-time interactive projection cards for stock splits and bonus issues.

### Fixed
- **WEBELSOLAR Corporate Action & P&L Miscalculation**: Resolved critical issue where WEBELSOLAR omitted a 10:1 stock split, falsely showing `sell_qty (2,115) > buy_qty (1,603)` and a bogus `-₹1.67 Lakh` realized loss. WEBELSOLAR is now correctly marked `ACTIVE` with `1,000` active shares, `₹74.03` average buy price, `-₹2,104.64` realized P&L, and `+₹3,906.61` unrealized gain.
- **Double Selling Race Condition**: Eliminated false sell discrepancies across 28 Indian stocks caused by same-day sorting ambiguities, correctly restoring total active holdings count from 85 to 86.

---

## [4.1.7] - 2026-08-28

### Added
- **React Error Boundary Component**: Created `ErrorBoundary.jsx` and wrapped top navigation header and primary view rendering containers to catch component rendering exceptions gracefully with a recovery prompt instead of blanking out the full viewport.
- **Mandatory Regression Testing & QA Protocol**: Documented a comprehensive testing protocol in `LADDER.md` enforcing pre-deployment build verification (`npm run build`), component scope analysis, and core workflow checks (search, navigation, modals, theme/currency, live price sync).

### Fixed
- **Search Bar Autocomplete Runtime Bug**: Resolved unhandled `ReferenceError: formatMoney is not defined` in `TopNavbar.jsx` autocomplete dropdown by destructuring `formatMoney` from `useThemeAuth()`.

---

## [4.1.6] - 2026-08-28

### Added
- **Universal Quote Date & Feed Timestamp Tracking**: Integrated exchange-timezone-aware timestamp formatting (`America/New_York` for US stocks, `Asia/Kolkata` for Indian stocks, AMFI official NAV publication dates for mutual funds, and Protean CRA published NAV dates for NPS schemes).
- **As of Date Badges**: Prominently displayed clean `As of [Date]` timestamp badges in HoldingDetailModal headers and portfolio view page banners.
- **Dynamic Fully Redeemed Metrics**: Added dedicated columns for Shares/Units Sold, Avg Buy Price/NAV, Avg Sell Price/NAV, Invested Cost Basis, Total Redeemed Proceeds, and Realized P&L in closed position tables.

### Changed
- **Modal Header Layout Consistency**: Re-architected `HoldingDetailModal` header so the Price Block, day change badge, and quote date remain strictly right-anchored in the same position across all asset modals, placing US Stock FX pills and currency toggles to the left.
- **Position Status Navigation**: Removed redundant 'All Data' tab across Indian Stocks, US Stocks, Mutual Funds, and NPS views, streamlining views to 'Active Positions' and 'Fully Redeemed'.
- **Closed Position Aesthetic Overhaul**: Fully redeemed positions now render at 100% opacity with full-color logos, crisp typography, and EXITED/REDEEMED status badges.
- **Accelerated Live Quote Ticker**: Upgraded active holding price sync to a 3-second backend loop and 2-second frontend polling for near-instant tick updates during market hours.

---

## [4.0.8] - 2026-08-27

### Added
- **Parallelized Live Quote Engine**: Implemented `refreshActiveHoldingsPrices` with concurrent `Promise.all` fetching for active US equities and chunked batching for active Indian equities, completing price sync in under 1.5 seconds.
- **In-Memory Quote Cache**: Added `liveQuoteCache` in `priceEngine.js` allowing `/api/holdings` and `/api/summary` to serve the latest live market prices instantly with zero database query overhead.
- **Live Background Ticker**: Configured a 10-second backend ticker interval and 5-second frontend polling with tab focus listeners, delivering continuous live price updates, P&L adjustments, and XIRR re-computations during market hours.

---

## [4.0.7] - 2026-08-27

### Changed
- **Banner Stat Cluster Alignment**: Re-architected banner stat cards across US Stocks, Indian Stocks, Mutual Funds, and NPS views using stretched flex containers, guaranteeing pixel-perfect alignment across Invested, Active Value, and Cost Basis baselines.
- **Regular Market Price Feed**: Configured price engine to extract real-time `regularMarketPrice` quotes from market data feeds.

---

## [4.0.6] - 2026-08-27

### Added
- **Visual Position Distinction**: Added prominent `ACTIVE` and `EXITED`/`REDEEMED` status pill badges to all portfolio table rows across Indian Stocks, US Stocks, Mutual Funds, NPS, and HoldingsTable.
- **Closed Position De-emphasis**: Desaturated logos and applied neutral slate styling with clean dashes for closed positions.
- **Search Auto-complete Live Quotes**: Added real-time asset prices and percentage change badges to the Top Navbar search autocomplete dropdown.

### Changed
- **Light Theme Refinement**: Upgraded light theme styling across table headers, input surfaces, and filter tabs in `index.css`.

---

## [4.0.5] - 2026-08-27

### Added
- **Day Movement Indicators**: Upgraded table Price columns across all portfolio views to show real-time price change amounts and percentage badges.
- **Institutional Market Snapshot**: Added live price, day change badge, Open, Prev Close, Day High, Day Low, and interactive 52-Week Range indicator slider to HoldingDetailModal.

### Changed
- **Clutter-Free Banners**: Removed redundant mechanism and sorting labels from portfolio banners and added Invested Value statistics.

---

## [4.0.4] - 2026-08-26

### Changed
- **Holding Performance Summary Redesign**: Replaced flat metric card grid in HoldingDetailModal with a two-tier visual hierarchy featuring an adaptive gradient Total P&L hero card and compact metric tiles with left color accent strips.

---

## [4.0.3] - 2026-08-26

### Changed
- **Financial Calculation Refactoring**: Updated Total Invested to include BUY charges and exclude BONUS logic, subtracted SELL charges from Total Redeemed, added Current Invested and Total Charges metrics, and factored dividends into Realized P&L and XIRR calculations.

---

## [4.0.2] - 2026-08-26

### Changed
- **Transaction Ledger Simplification**: Removed serial number column from transaction ledgers in HoldingDetailModal across all portfolio views.

---

## [4.0.1] - 2026-08-21

### Fixed
- **Tooltip Event Sensitivity**: Implemented a magnetic tooltip engine in `HoldingDetailModal.jsx` that automatically snaps to the nearest event within a 9-day window, resolving X-axis hover sensitivity issues on dense timelines.
- **Double Dividend Display**: Fixed an issue in the `/api/holding/:holdingId/detail` route where dividends appeared twice in the events list due to redundant data ingestion from both `transactions` and `dividends` tables.

### Changed
- **Global Date Formatting**: Standardized all dates in tooltips, X-axis labels, and transaction ledgers across the dashboard to `DD-MM-YYYY` using a unified formatter utility.
- **Active Tracker Styling**: Distinctly styled the active line dot as a white circle with a grey border to prevent visual confusion with green BUY event markers.

---

## [4.0.0] - 2026-08-21

### Added
- **Actual Chart Toggle**: Integrated a pure asset price charting view (`Actual Chart`) alongside the standard `Tracker Chart` in the Holding Detail modal, utilizing a dual-chart toggle system.
- **Transaction Overlays**: Overlaid interactive scatter-plot event markers (Buy, Sell, Dividend, Bonus) directly onto the Actual Chart price curve.
- **Dynamic Chart Filtering**: Added unified date range filter pills (1M, 3M, 6M, 1Y, ALL) and custom calendar pickers that sync data bounds and responsive Y-axis scaling across both charts simultaneously.

### Changed
- **Dense Timeline API Upgrade**: Enhanced the backend Dense Timeline engine to calculate and expose pure historical asset `price` values and daily transaction `events` arrays in the JSON response for all asset classes including NPS.

---

## [3.9.0] - 2026-08-21

### Changed
- **Dense Timeline Engine**: Replaced sparse chart timeline rendering with a new 'Dense Timeline Engine' in `server/index.js`. The previous charting logic throttled datapoints to a maximum of 300, and fell back to sparse transaction-dates-only when historical prices were unavailable. The new engine programmatically iterates through every single calendar date from the first transaction to the present day, calculating and carrying forward the last known valuation to create a mathematically flawless, high-fidelity daily charting dataset. This resolves the issue of Recharts skipping weekends and drawing rigid, non-interactive straight lines across transaction gaps.

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

