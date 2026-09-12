# Ladder - Institutional Finance & Investment Dashboard

Ladder is an institutional-grade personal finance and investment management dashboard designed for tracking multi-asset portfolios including Indian Equity, US Equity, Mutual Funds, Fixed Income / Retirement (Bank Accounts, Fixed Deposits, NPS, EPF), Liabilities (Loans, Credit Cards), and Dividends.

---

## Architecture & System Overview

1. **Universal Calculation & Recalculation Engine**
   - Centralized FIFO lot accounting engine (`server/services/recalculator.js`).
   - Replays transactions chronologically to compute weighted average buy price, open quantity, realized gains, and total charges.
   - Retroactive corporate actions: scales shares on stock splits (`SPLIT`) and dilutes average price on bonus issues (`BONUS`) at zero cost.
   - Automatically triggered on transaction additions, edits, and deletions across all asset classes.

2. **Multi-Pass Daily NAV & Market Data Engine**
   - **Indian Equities**: Live quotes comparing NSE and BSE prices, automatically locking the higher market quote (`NSE/BSE MAX`).
   - **US Equities**: Real-time quotes from NASDAQ/NYSE with dynamic USD to INR conversion. Entries are strictly in USD ($) with real-time INR preview.
   - **Mutual Funds**: Real-time NAV synchronization via AMFI Scheme API.
   - **NPS (National Pension System)**: Automated daily scraper extracting official NAV files directly from Protean CRA archives (`nps_daily_navs` table in Supabase) with historical backfill fallback.
   - **On-Demand & Cloud Catch-Up**: Integrated "Refresh NAVs" button in UI and an hourly zero-maintenance GitHub Actions cron worker (`.github/workflows/daily_nav_sip_sync.yml`).

3. **Delta-Ledger Architecture for Cash, EPF & Debt**
   - Bank Accounts, EPF, Loans, and Credit Cards operate as a transaction-backed delta ledger.
   - Over 4,900 historical balance adjustments from 2007 through 2026 are modeled as discrete delta transactions (`CREDIT`, `DEBIT`, `CONTRIBUTION`, `WITHDRAWAL`, `BORROW`, `EMI_PAYMENT`, `CHARGE`, `BILL_PAYMENT`).
   - Any historical adjustment or deletion automatically recalculates downstream balances accurately.

4. **Automated Recurring SIP Engine & Execution History**
   - In-app SIP manager (`src/components/SipManagerModal.jsx`) allowing users to schedule, edit, pause, resume, or close recurring investments.
   - Dedicated **Execution & Skips** tab tracking every execution attempt, units purchased, NAV pricing, and specific skip reasons (market closures, NSE holidays, end-date expirations).
   - Automated cloud background runner (`server/services/sipEngine.js`) executes due SIPs at the latest NAV, allocates units with 0.015% stamp duty charges, logs events to `data/sip_history.json`, and advances schedules with market holiday awareness (`isTradingDay`).

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
   - Project-Wide Tabular Search & Sorting: Comprehensive real-time search filtering and clickable column sorting implemented across every tabular ledger in the application (Consolidated Category Performance, MF Look-Through Constituents, Market Cap drill-down, Sector drill-down, Scheme breakdown modal, Overview performance, Transaction ledgers, Dividend distribution ledgers, and Amortization schedules).
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
   - **Point-in-Time Restoration Modal**: Themed, keyboard-accessible restore modal (`RestoreBackupModal.jsx`) and dedicated restoration script (`scripts/restore_backup.mjs`) enabling instantaneous recovery with auto-decompression, database overwrite protections, and cache invalidation.

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
   - Universal view synchronization immediately cascades any dividend changes to Dashboard Net Worth, Asset Allocations, and Reports.

10. **In-Memory Reactive Caching & Cloud Egress Protection**
    - High-performance in-memory cache layer (`dbCache` in `server/db.js`) eliminating repetitive multi-megabyte network sweeps across Supabase Cloud.
    - All read-heavy operations (`/api/summary`, `/api/holdings`, `/api/liabilities`, `/api/dividends`) serve responses in sub-milliseconds from local RAM.
    - Automatic reactive cache invalidation across interdependent tables on all INSERT, UPDATE, and DELETE mutations.
    - Cuts monthly Supabase cloud egress by 99% (< 50 MB / month), guaranteeing the application never exceeds free cloud tier allowances.

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
- **Email**: `admin@ladder.com`
- **Password**: `admin123`

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
