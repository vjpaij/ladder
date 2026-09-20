# Ladder - Institutional Finance & Investment Dashboard

Ladder is an institutional-grade personal finance and investment management dashboard designed for tracking multi-asset portfolios including Indian Equity, US Equity, Mutual Funds, Fixed Income / Retirement (Bank Accounts, Fixed Deposits, NPS, EPF), Liabilities (Loans, Credit Cards), and Dividends.

---

## Architecture & System Overview

1. **Universal Calculation & Recalculation Engine**
   - Centralized FIFO lot accounting engine (`server/services/recalculator.js`).
   - Replays transactions chronologically to compute weighted average buy price, open quantity, realized gains, and total charges.
   - Retroactive corporate actions: scales shares on stock splits (`SPLIT`) and dilutes average price on bonus issues (`BONUS`) at zero cost. Dense timeline simulation strictly adheres to transaction quantities to prevent phantom holdings, ensuring fully liquidated holdings drop to exactly ₹0.00 at exit.
   - Automatically triggered on transaction additions, edits, and deletions across all asset classes.

2. **Multi-Pass Daily NAV & Market Data Engine**
   - **Indian Equities**: Live quotes comparing NSE and BSE prices, automatically locking the higher market quote (`NSE/BSE MAX`). Stock search automatically prioritizes NSE, falls back to BSE only if absent, and strips all exchange tags for clean single-entry prompts.
   - **US Equities**: Real-time quotes from NASDAQ/NYSE with dynamic USD to INR conversion. Entries are strictly in USD ($) with real-time INR preview and automated historical FX rate lookups on date selection.
   - **Mutual Funds**: Real-time NAV synchronization via AMFI Scheme API. Full uniformity across asset lifecycle with standardized SELL transactions and borderless transaction ledgers.
   - **NPS (National Pension System)**: Automated daily scraper extracting official NAV files directly from Protean CRA archives (`nps_daily_navs` table in Supabase) with resilient historical backfill fallback. Authoritative database NAV synchronization guarantees 100% mathematical parity across Dashboard, NPS page, Calendar Heatmap, Reports, and Holding Detail Modals.
   - **Automated Historical Price Population**: Whenever a new or past-dated transaction is recorded for any stock, Mutual Fund, or NPS scheme, historical daily closing quotes/NAVs from the transaction date to present are automatically retrieved and populated into `data/historical_prices.json` and in-memory cache, ensuring holding detail charts immediately track real daily trajectories instead of flat lines.
   - **On-Demand & Cloud Catch-Up**: Integrated "Refresh NAVs" button in UI, server boot synchronization, and an hourly zero-maintenance GitHub Actions cron worker (`.github/workflows/daily_nav_sip_sync.yml`).

3. **Delta-Ledger Architecture for Cash, EPF & Debt**
   - Bank Accounts, EPF, Loans, and Credit Cards operate as a transaction-backed delta ledger.
   - Over 4,900 historical balance adjustments from 2007 through 2026 are modeled as discrete delta transactions (`CREDIT`, `DEBIT`, `CONTRIBUTION`, `WITHDRAWAL`, `BORROW`, `EMI_PAYMENT`, `CHARGE`, `BILL_PAYMENT`).
   - Any historical adjustment or deletion automatically recalculates downstream balances accurately.

4. **Automated Recurring SIP Engine & Execution History**
   - In-app SIP manager (`src/components/SipManagerModal.jsx`) allowing users to schedule, edit, pause, resume, or close recurring investments.
   - Dedicated **Execution & Skips** tab tracking every execution attempt, units purchased, NAV pricing, and specific skip reasons (market closures, NSE holidays, end-date expirations).
   - Automated SIP processing (`server/services/sipEngine.js`) catches up all due installments through the current date, uses the NAV available for each scheduled date, allocates units with 0.005% stamp duty charges, records execution history, and advances future schedules in the background.
   - The Holding Detail transaction ledger provides a scheme-scoped **Add SIP** action. Mutual Fund **Total Bought** and **Current Cost** use stored amount plus charges, with FIFO allocation for remaining units.

5. **Historical Time-Series & Real-Time Multi-Granularity Calendar**
   - Daily, monthly, and yearly portfolio valuation history spanning 19 years (2007-2026) across 18 asset and liability columns (`data/portfolio_eod_logs.json`).
   - Dynamic real-time single-source-of-truth engine: today's current valuation updates live from real-time price feeds with 0 delay and zero scripts needed.
   - Interactive color-coded heatmap grid and tabular view with period P&L and ROI metrics.

6. **High-Performance Growth Benchmark & Reports Suite**
   - Dedicated service (`server/services/benchmarkEngine.js`) calculating true money-weighted performance vs Nifty 50, Nifty Midcap 150, Nifty Smallcap 250, S&P 500, and NASDAQ with binary search index lookups and live sync staleness badge ("Synced: DD-MM-YYYY").
   - **Contextual Holding Transaction Drawer**: "+ Add Transaction" button inside `HoldingDetailModal.jsx` pre-filled with holding metadata for instant ledger additions across all asset categories.
   - Comprehensive Reports Hub with Asset Allocation, Market Cap look-through, Sector drill-downs, and a dedicated **Consolidated Performance** view analyzing Active vs Realized vs Lifetime returns across all portfolio categories.
   - High-density, clutter-free metric box architecture across all asset classes with vertical label-metric hierarchy, zero-overflow secondary grids, and clean tabular alignment.
   - Universal Border Integrity & Complete Box Containment: Replaced outset rings with inset borders and container scrollbar padding, eliminating border-clipping artifacts across all themes and viewports.
   - Project-Wide Tabular Search & Sorting: Comprehensive real-time search filtering and clickable column sorting implemented across every tabular ledger in the application. Across Indian Equity, US Equity, Mutual Funds, and NPS views, the first column supports dual-target sorting by either Asset Name or Ticker/Code Symbol with dynamic direction indicators in both Active and Closed portfolio tables.
   - **FIFO Open Lot Avg Price & Granular P&L / Dividend Reporting**: Active holding tables evaluate `Avg Price` / `Avg NAV` strictly on open remaining FIFO lots (`unrealizedAvgBuy`), ensuring the displayed cost basis reflects currently held shares. Closed tables evaluate consolidated all-time average buy price across historical transactions. Active and closed portfolio tables across Indian Equity, US Equity, Mutual Funds, and NPS feature distinct columns for `Unrealized P&L` (paper gains), `Realized P&L` (booked trading gains), and `Dividend` (credited dividend income).
   - Indian Equity NSE/BSE MAX Quote Engine: Live quotes automatically compare NSE and BSE market feeds and lock the higher quote (`NSE/BSE MAX`), with hardened 404 handling ensuring unlisted exchange symbols never trip the provider circuit breaker.
   - Universal Search Clear Controls: Every search and filter input includes a conditional `X` clear button, with reserved right-side input space so long text scrolls left without overlapping the control.
   - **Global Modals Architecture**: Eradicated all native browser popups. Built a centralized, beautifully animated, theme-aware React modal system (`showError`, `showSuccess`, `showConfirm`, `showPrompt`) managed by `ThemeAuthContext`, rendering securely via React Portals (`createPortal`) to guarantee perfect viewport centering and zero z-index conflicts.
   - **Global Keyboard Accessibility**: All modals, popovers, and dialogs across the application are fully keyboard accessible, supporting `Escape` to close/cancel and `Enter` to submit/confirm.
   - **Modernized Dynamic Graph Range Selector**: Replaced long static preset range pill bars across all charts and modals with a unified, beautiful `ChartRangeSelector` component featuring 'ALL' full-history button, dynamic integer input with unit dropdown (Day, Week, Month, Year) supporting arbitrary relative periods (e.g. 5 Months, 2 Weeks, 10 Days, 3 Years), and accessible calendar date range popover.
   - **Global Auto-Select on Focus/Click**: Universal auto-selection for text, number, and search inputs throughout the application, automatically highlighting existing content upon click/focus for immediate overwrite on typing while preserving full `X` clear button support.

7. **Safety, Compressed Cloud Backup & 10-Day Retention Protocol**
   - **Lossless Gzip Cloud Backup Engine**: Captures full database snapshots across all 13 core tables, compresses them losslessly with gzip (`.json.gz`, shrinking storage by 93.2% from 15.2 MB to 1.0 MB), and uploads them directly to Supabase Cloud Storage (bucket `ladder_backups`).
   - **10-Day Retention Policy**: Unlimited backups within 10 days. Automatically prunes snapshots older than 10 days both in Supabase Cloud Storage and local disk storage.
   - **Automated Daily Schedule (08:25 AM IST)**: Executes automatically every morning just before 8:30 AM IST (08:25 AM IST / 02:55 UTC) via the Express server scheduler and GitHub Actions (`.github/workflows/daily_backup.yml`).
   - **Profile Menu Integration**: Instant 1-click 'Backup Database Now' (with active feedback) and 'Restore Database' buttons directly accessible from the user Profile Dropdown menu in the top navigation bar.
   - **Point-in-Time Restoration Modal**: Themed, keyboard-accessible restore modal (`RestoreBackupModal.jsx`) with asynchronous job polling (`GET /api/cloud-backups/restore/status`), background historical EOD recalculation with 5-minute timeout protections, unmount cleanup, and failure circuit breakers.

8. **Dynamic Housing Loan Amortization & Prepayment Engine**
   - Ingests verified historical loan lifecycle records (sanctioned principal, disbursements, EMIs, prepayments, interest) from Excel into Supabase `loan_amortization`.
   - Dynamic projection engine (`server/services/loanEngine.js`) calculating monthly principal and interest splits right up to loan payoff date.
   - Interactive Recharts visualization with Balance Payoff Trajectory area chart, Annual Breakdown bar chart, and Prepayment What-If simulator.
   - Differentiates contractual EMI (₹52,653.00) from active monthly installment payments (₹60,000.00) with quick inline installment editing.
   - Dynamic entry addition, in-table editing, and deletion (prepayments, EMIs, rate adjustments) that immediately recalculate future amortization schedules and interest savings.
   - Full currency precision throughout all metrics, tooltips, and tables with zero abbreviation.

9. **Dividends Scheme Hub & Transaction Management**
   - **Aggregated Scheme Portfolio View**: Aggregates dividend payouts per scheme/stock (Indian & US Equities) displaying Logo, Clean Name, Symbol, Market Badge, Payouts Count, Total Original Payout, Total Credited INR/USD, and Latest Payment Date.
   - **Scheme Deletion**: Action column on main table includes Delete icon button (`Trash2`) with mandatory user confirmation prompt to delete all dividend records for a scheme (`DELETE /api/dividends/scheme/:idOrSymbol`).
   - **Transaction-Level CRUD & Reports**: Clicking any scheme row opens `AssetDividendDetailModal.jsx` displaying Annual Breakdown bar charts, Cumulative Growth curves, KPI metric cards, and an Itemized Distribution Ledger table equipped with inline **Edit** (`Edit3`) and **Delete** (`Trash2`) actions under its Action column.
   - Dynamic currency toggle synchronization: displays primary values in INR with USD secondary in INR mode, and flips to primary USD with INR secondary in USD mode.
   - Dedicated `Add Entry` modal matching equity dividend transaction styling with live stock autocomplete and real-time USD/INR preview.
   - Granular market filters (`All`, `Indian Equity`, `US Equity`), instant search with clear control, and multi-column sorting (Stock Name, Market, Payouts, Total Payout, INR Credited, Latest Date).
   - Historical USD/INR Exchange Rate Auto-Sync: Queries verified daily exchange rate archive and dynamically populates the exact historical rate for past dividend distributions.
   - **Canonical Dividend Domain Service Architecture**: Managed exclusively by `server/services/dividendService.js` as the single authoritative domain controller. Any dividend addition, amendment, or deletion from either view (Dividends Hub, Asset Dividend Modal, or Holding Detail Transaction Ledger) executes an atomic dual-write/delete across both `dividends` and `transactions` tables, immediately triggers `recalculateHoldingState`, and invalidates in-memory caches, guaranteeing 100% real-time cross-page parity without ad-hoc background sync scripts.
   - **Canonical Corporate Actions Domain Service**: Managed by `server/services/corporateActionService.js`, orchestrating stock splits and bonus issues. When a stock split is added via the UI, preceding un-sold open buy lots are adjusted in quantity and price with metadata tags (`[Split orig: Q@P]`) to maintain perfect alignment with split-adjusted market price feeds, with complete reversibility when amended or deleted.

10. **In-Memory Reactive Caching, Disk Snapshots & Cloud Egress Lockdown**
    - High-performance in-memory cache layer (`dbCache` in `server/db.js`) eliminating repetitive multi-megabyte network sweeps across Supabase Cloud.
    - All read-heavy operations (`/api/summary`, `/api/holdings`, `/api/liabilities`, `/api/dividends`, `asset_metadata`, `mutual_fund_holdings`, `sips`, `sip_history`) serve responses in sub-milliseconds from local RAM.
    - Automatic reactive cache invalidation and write-through row updates across interdependent tables on all INSERT, UPDATE, and DELETE mutations.
    - **Local Disk Snapshot Cache**: On startup, `warmCache()` restores tables from `data/db_cache_snapshot.json` (if <24h old), completely eliminating cold-start egress when the server or machine restarts.
    - **Market-Hours Gated Live Ticker**: The live price ticker runs on a 60-second cycle (30x reduction) and strictly gates execution via `isAnyMarketOpen()`, automatically pausing price polling when markets are closed (nights, weekends, and holidays).
    - **Decoupled Self-Healing Service**: Comprehensive self-healing runs once after startup cache warming and once daily at midnight (00:05 AM IST), avoiding destructive cache drops during intraday operations.
    - **NPS Sync & EOD Guards**: In-memory `npsSyncStatusCache` and non-trading day guards in `priceEngine.js` prevent redundant scraping and cloud queries, while `checkMissedEodRebuild` checks cached `pnl_history` against the last completed trading day.
    - Cuts daily Supabase cloud egress to < 2 MB / day, guaranteeing the application stays safely within free cloud tier allowances.

11. **Modular Architecture, Resilience & Full Production Readiness**
    - **Server Architecture Split**: Express API split into 13 modular route controllers in `server/routes/` (`auth.js`, `backup.js`, `calendar.js`, `database.js`, `dividends.js`, `fx.js`, `holdings.js`, `liabilities.js`, `reports.js`, `search.js`, `sips.js`, `summary.js`, `transactions.js`) and middleware `server/middleware/auth.js`. `server/index.js` is reduced to 229 lines mounting routers, schedulers, and background engines.
    - **Zero Hardcoding & Self-Healing Rates**: Built persistent self-healing FX rate store (`data/fx_rates_persistent.json`, `server/services/fxRateStore.js`) with background retry scheduler and historical FX resolution; purged all hardcoded 87.25 and 82.5 values across frontend and backend; dynamicized bank names and removed loan heuristics.
    - **Background Self-Healing Service**: Built `server/services/selfHealingService.js` with `POST /api/self-heal` endpoint, which automatically detects missing transaction FX rates, missing quotes, or stale NAVs and backfills them, running at boot and during 10-minute sync cycles.
    - **System Resilience & Circuit Breakers**: Eliminated 100% of silent empty catch blocks across the repository with warning logs and fallbacks; implemented Yahoo Finance circuit breaker (`yfCircuitBreaker`) with 5-failure threshold and 30-second cooldown; added retry with exponential backoff for price and FX fetchers; extended calendar lookbacks to 15 days; added Dr. Ambedkar Jayanti and dynamic algorithmic projections for future years in `marketCalendar.js`.
    - **Persistent Cloud SIP History**: Migrated SIP execution and skip records from local JSON to Supabase table `public.sip_history` with API endpoint `GET /api/sips/history`.
    - **Sub-Component Decomposition**: Decomposed monolithic `HoldingDetailModal.jsx` (1,723 lines) into modular subcomponents in `src/components/holding-detail/` (`HoldingDetailHeader.jsx`, `HoldingMarketStats.jsx`, `HoldingMetricCards.jsx`, `HoldingChartsSection.jsx`, `HoldingTransactionLedger.jsx`, `holdingDetailUtils.jsx`); decomposed `ReportsView.jsx` (2,640 lines) into modular subcomponents in `src/components/reports/` (`reportsConstants.js`, `ReportsTooltips.jsx`, `RankedBarList.jsx`, `CleanBarChartView.jsx`, `CompanyMfBreakdownModal.jsx`).
    - **Dynamic Category Registry**: Database-driven category capabilities in Supabase `categories` schema (`valuation_model`, `default_currency`, `default_exchange`, `price_fetcher`, `has_dividends`) and `server/services/categoryRegistry.js` with endpoint `GET /api/categories/registry`.
    - **Auth & Performance**: Dedicated authentication screen (`src/views/LoginView.jsx`) decoupled from `App.jsx`; validated sign-in and registration with bcrypt password hashing; strict >=32 character `JWT_SECRET` requirement; Vite `manualChunks` vendor code-splitting (React, Recharts, Lucide, Framer Motion), shrinking main bundle from 937 kB to 222 kB.

12. **Universal Table Header and Column Freezing (Sticky Tables)**
    - **Dual-Axis Freezing**: Configured dual-axis scrolling (`overflow-x-auto overflow-y-auto max-h-[...] custom-scrollbar`) on table containers so both vertical and horizontal stickiness execute synchronously in the same scroll viewport.
    - **Frozen Headers & First Columns**: Table header rows (`sticky top-0 z-30 bg-slate-900`) freeze at the top on vertical scrolling, and first columns (instrument name, scheme, asset class, or date) (`sticky left-0 z-20 bg-slate-900/95`) freeze on horizontal scrolling.
    - **Elevated Top-Left Corner Cells**: Top-left corner header cells are pinned with `sticky left-0 top-0 z-40 bg-slate-900 border-r border-slate-800` to remain fixed and visible above all scrolled headers and columns.
    - **Universal Project-Wide Coverage**: Enabled across all 16 tables in the application, including Indian Stocks, US Stocks, Mutual Funds, NPS, Asset Class Overview, Dividends, HoldingsTable, Holding Detail Transaction Ledgers, Asset Dividend Distribution Ledger, Loan Amortization Schedule, Database Studio, Database Viewer, Company MF Breakdown Modal, FX Rate History Modal, and all 4 Reports drill-down and performance tables (including sticky footers).
    - **Multi-Theme Fidelity**: Added `.reports-table-sticky-head` and `.reports-table-sticky-cell` classes to maintain 100% theme fidelity across dark and light palettes.

13. **Comprehensive Transaction Management & Asset-Class Parity**
    - **Editable Transaction Charges & Strict Decimal Precision**: Dedicated `Charges` input in the Add Transaction drawer (`HoldingTransactionLedger.jsx`) across all asset classes with dynamic currency formatting (`₹` / `$`). `Price / NAV` and `Charges` inputs strictly enforce 2-decimal floating precision (e.g. `1131.00`, `0.00`), initializing cleanly and auto-formatting on blur across both Add Drawer and Inline Edit modes.
    - **US Equities FX Override**: Direct `USD/INR Rate (₹)` entry in the Add Transaction drawer and inline transaction edit mode, enabling exact historical exchange rate recording for US transactions.
    - **Mutual Funds Stamp Duty Automation**: Automatically computes 0.015% stamp duty upon BUY order entry while maintaining full user editability.
    - **Real-Time Net Amount Calculation**: Total investment amount dynamically accounts for charges (`(qty * price) + charges` for BUY and `Math.max(0, (qty * price) - charges)` for SELL).
    - **Full Amendment (Inline Edit) Parity**: Inline ledger editing (`editingTxId === tx.id`) supports editing charges, FX rate, and asset-specific transaction types across Indian Equities, US Equities, Mutual Funds, NPS, Bank Accounts, EPF, and Liabilities.
    - **Dynamic Reversible Stock Split Recalculation & Chart Alignment**: When stock splits are recorded via the UI, all preceding open (un-sold) buy lots are dynamically recalculated with post-split quantities and adjusted prices (`quantity * splitMultiplier`, `price / splitMultiplier`), embedding non-destructive `[Split orig: Q@P]` metadata tags. The SPLIT corporate action record is stored with `quantity: 0` to prevent double-counting. Deleting or amending a split transaction automatically restores all tagged preceding lots to their original pre-split values with 100% roundtrip fidelity. Furthermore, holding detail chart generation dynamically detects market price ex-dates via backward search with up to 365 days lookback, harmonizing ex-date market prices with pre-split/post-split holding intervals and ensuring smooth continuous valuations without artificial 50% drops or cliffs.

14. **Modern Theme-Adaptive Custom DatePicker Architecture**
    - **Replaced Native Browser Pickers**: Eradicated all default, clunky OS/browser `<input type="date">` widgets project-wide, replacing them with a custom, high-density React date picker (`src/components/common/DatePicker.jsx`).
    - **Universal Design Token Adaptation & Uniform Box Styling**: Styled with `.modal-surface`, `.reports-card`, and CSS variables (`--bg-card`, `--border-color`, `--text-primary`, `--accent-emerald`), delivering full visual harmony across all 6 light and dark themes. Text input backgrounds strictly inherit parent surfaces (`style={{ backgroundColor: 'inherit', color: 'inherit' }}`), eliminating browser user-agent white strips in light themes and providing 100% uniformity with adjacent form boxes.
    - **Direct Month & Year Header Selectors**: Instant 1-click navigation via integrated Month (`January`–`December`) and Year (`1986`–`2041`) dropdown selects, plus `<<` / `<` and `>` / `>>` stepper controls.
    - **Direct Text Input & Live Sync**: Input field allows direct typing in `DD-MM-YYYY` with real-time calendar synchronization and validation.
    - **Non-Premature Dismissal & Done Confirmation**: Selecting a day updates the value without snapping shut, allowing users to verify or adjust before confirming with the prominent `Done` action button.
    - **Quick Shortcut Controls**: Bottom action bar with `Today`, `Yesterday`, `-1Y` (decrement 1 year), `+1Y` (increment 1 year), and `Clear` buttons.
    - **Scroll & Viewport Isolation with Portal Event Protection**: Rendered via React Portal (`createPortal(..., document.body)`) with dynamic anchoring, avoiding drawer/modal overflow clipping while tracking scroll and window resize. Parent components (such as `ChartRangeSelector`) incorporate `data-datepicker-portal` containment checks in outside-click handlers to prevent calendar interactions from prematurely closing parent selectors.

---

## Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS, Framer Motion, Recharts, Lucide Icons
- **Backend**: Express.js, Node.js, Axios, JWT Authentication, Bcrypt
- **Database**: Supabase Cloud PostgreSQL, `@supabase/supabase-js`, Row Level Security (RLS)
- **Cloud Automation**: GitHub Actions (`daily_nav_sip_sync.yml`)

---

## Quick Start & Installation

### Prerequisites
- Node.js (v18 or higher recommended)
- npm or yarn
- Supabase project credentials

### Step 1: Clone Repository & Install Dependencies

```bash
git clone https://github.com/vjpaij/ladder.git
cd ladder
npm install
```

### Step 2: Configure Environment Variables

Create a `.env` file in the root directory:

```env
PORT=5000
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters-long
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

### Step 3: Run the Application Locally

Start both the backend API server and the Vite development server:

```bash
# Terminal 1: Start Express API server (port 5000)
npm run server

# Terminal 2: Start Vite frontend dev server (port 5173 / 3000)
npm run dev
```

Open your browser and navigate to `http://localhost:5173` (or the URL displayed in the terminal).

### Default Authentication Credentials
- A local seed account is available for development:
   - **Email**: `admin@ladder.com`
   - **Password**: `admin123`
- The login screen also supports registering additional accounts. Passwords are stored as bcrypt hashes; change or remove the seed account before deploying beyond a private development environment.
- The API requires a valid JWT for portfolio, report, database, backup, loan, and mutation endpoints. `JWT_SECRET` is mandatory and must be at least 32 characters.

### Authentication & Branding

Unauthenticated users see the branded Ladder authentication screen using the project artwork from `src/assets/logo.png`. The screen supports:

- Existing account sign-in with expired-session recovery.
- New account registration with name, email, password confirmation, and server-side validation.
- Responsive desktop and mobile layouts with concise portfolio-oriented branding.

Authentication endpoints:

```text
POST /api/auth/login
POST /api/auth/register
```

---

## Operational Scripts & Workflows

### 1. Database Backup (Safety Snapshot)
Exports all holdings, transactions, dividends, liabilities, daily logs, and EOD files with pagination and SHA256 verification:

```bash
node scripts/dump_db_snapshot.mjs
```
Snapshots are saved to `data/backups/snapshot_<timestamp>.json` and `data/backups/snapshot_latest.json`.

### 2. Database Restoration
Restores the database from a verified JSON backup snapshot:

```bash
# Dry-run validation (verifies record counts without modifying database)
node scripts/restore_db_snapshot.mjs data/backups/snapshot_latest.json --dry-run

# Full live restore
node scripts/restore_db_snapshot.mjs data/backups/snapshot_latest.json
```

### 3. Unified Daily Sync Orchestrator
Sequences the complete end-of-day workflow in a single command (Price Ingestion -> Historical EOD Rebuild -> Financial Invariance Audit -> Gzip Cloud Backup):

```bash
node scripts/daily_sync.mjs
```

### 4. Rebuilding Historical Portfolio EOD Logs
Rebuilds the 19-year daily valuation logs from transactions and holdings into `data/portfolio_eod_logs.json` and syncs with Supabase `pnl_history`, replaying bank, EPF, and liability delta transactions chronologically:

```bash
node scripts/rebuild_portfolio_eod.mjs
```

### 4. Running Daily NAV & SIP Synchronization
Manually triggers the background worker to scrape Protean NPS NAVs, AMFI Mutual Fund NAVs, and execute due recurring SIPs:

```bash
node scripts/sync_navs_and_sips.mjs
```

### 5. Automated Cloud Scheduling (GitHub Actions)
- **Hourly NAV & SIP Sync** (`.github/workflows/daily_nav_sip_sync.yml`): Runs automatically every hour during NAV declaration windows (IST 21:00-00:00 and 09:00-12:00) to fetch latest AMFI/Protean NAVs and execute due SIPs.
- **Daily Portfolio EOD Sync** (`.github/workflows/daily_eod_sync.yml`): Runs automatically every night at 23:45 UTC (05:15 IST) to refresh market quotes, recompute EOD valuations, and persist daily logs to Supabase `pnl_history`.
- **Nightly Metadata & Benchmark Sync** (`.github/workflows/nightly_metadata_sync.yml`): Runs automatically every night at 23:00 IST (17:30 UTC) to refresh stock market caps, industry sectors, mutual fund constituent holdings, and 2-year daily benchmark index history.

To enable workflows on a remote repository:
1. Go to repository **Settings** -> **Secrets and variables** -> **Actions**.
2. Add Repository Secrets:
   - `SUPABASE_URL`: Your Supabase Project URL.
   - `SUPABASE_ANON_KEY`: Your Supabase Anon Public Key.
3. All workflows can also be manually dispatched via the **Actions** tab with one click.

### 6. Synchronizing Stock Market Caps & Sectors
Fetches live market capitalizations and broad industry sectors for all active Indian and US equity holdings, categorizing into Mega, Large, Mid, Small, and Micro Cap:

```bash
node scripts/sync_asset_metadata.mjs
```

### 7. Synchronizing Mutual Fund Constituent Holdings
Populates underlying company holdings, weights, and allocated rupee values for all active Mutual Fund schemes into Supabase and local cache:

```bash
node scripts/sync_mf_holdings.mjs
```

### 8. Synchronizing Benchmark Indices Daily History
Fetches 2 years of daily historical closing quotes for Nifty 50, Nifty Midcap 150, Nifty Smallcap 250, S&P 500, and NASDAQ for date-by-date trajectory tracking:

```bash
node scripts/sync_index_history.mjs
```

### 9. Verifying Multi-Asset Data Integrity
Audits all 8 asset and liability classes across every historical record to guarantee balance sheet parity, Protean CRA exclusivity for NPS, zero unverified NAV carryovers, and zero premature current-day snapshots:

```bash
node scripts/verify_all_assets_integrity.mjs
```

### 10. 100% Offline Local Cache Mode (Zero Supabase Egress)
To operate the entire application locally with zero cloud network requests, set `OFFLINE_CACHE_MODE=true` in `.env`.
All data is served from and persisted to `data/db_cache_snapshot.json` in Node.js RAM (`dbCache`). See [SUPABASE_EGRESS_AND_CACHE_GUIDE.md](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/SUPABASE_EGRESS_AND_CACHE_GUIDE.md) for full operational instructions, multi-device transfer steps, and post-reset cloud re-population guides.

---

## Maintenance & Contribution Rules

Whenever modifying the codebase, adhere to the following mandatory standards:

1. **Delete Operations Must Require Confirmation**: Every delete action (holding, transaction, SIP, profile photo) must present an explicit confirmation prompt displaying the asset or schedule name before executing.
2. **Synchronize All 6 Data Pipelines**: Changes to transactions or holding calculations must be reflected across Ingestion, Price Engine, Detail Modals, Summaries, EOD Time-Series, and Themes.
3. **Rebuild EOD Logs on Price/Transaction Changes**: Execute `node scripts/rebuild_portfolio_eod.mjs` to keep the calendar heatmap in exact parity.
4. **Build Verification**: Run `npm run build` prior to finalizing changes to catch syntax or bundling issues.
5. **Documentation Integrity**: Always update `README.md`, `CHANGELOG.md`, and `LADDER.md` (Change Log table) with clear descriptions of architectural and feature updates.
6. **Professional Text**: Do not use any emoticons or emojis in code, commits, or documentation.

---

## License

This project is open-source under the [MIT License](LICENSE).
