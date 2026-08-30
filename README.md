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

4. **Automated Recurring SIP Engine**
   - In-app SIP manager (`src/components/SipManagerModal.jsx`) allowing users to schedule, edit, pause, resume, or close recurring investments.
   - Automated cloud background runner (`server/services/sipEngine.js`) executes due SIPs at the latest NAV, allocates units with 0.015% stamp duty charges, and advances the next schedule by one month.

5. **Historical Time-Series & Real-Time Multi-Granularity Calendar**
   - Daily, monthly, and yearly portfolio valuation history spanning 19 years (2007-2026) across 18 asset and liability columns (`data/portfolio_eod_logs.json`).
   - Dynamic real-time single-source-of-truth engine: today's current valuation updates live from real-time price feeds with 0 delay and zero scripts needed.
   - Interactive color-coded heatmap grid and tabular view with period P&L and ROI metrics.

6. **High-Performance Growth Benchmark Engine**
   - Dedicated service (`server/services/benchmarkEngine.js`) calculating true money-weighted performance vs Nifty 50, Nifty Midcap 150, Nifty Smallcap 250, S&P 500, and NASDAQ.
   - High-speed in-memory caching of scoped transactions and holdings with sub-10ms response times on timeframe shifts.
   - Pre-sorted index date arrays with $O(\log N)$ binary search lookup, eliminating synchronous array sorting and CPU event-loop spin.

7. **Safety, Backup & Atomic Restoration**
   - Paginated backup tool (`scripts/dump_db_snapshot.mjs`) exporting full database state and EOD logs past Supabase row limits.
   - Dependency-ordered restoration tool (`scripts/restore_db_snapshot.mjs`) with SHA256 checksum verification and dry-run safety simulation.

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

### 3. Rebuilding Historical Portfolio EOD Logs
Rebuilds the 19-year daily valuation logs from transactions and holdings into `data/portfolio_eod_logs.json` and syncs with Supabase `pnl_history`:

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
- **Nightly Metadata & Benchmark Sync** (`.github/workflows/nightly_metadata_sync.yml`): Runs automatically every night at 23:00 IST (17:30 UTC) to refresh stock market caps, industry sectors, mutual fund constituent holdings, and 2-year daily benchmark index history.

To enable workflows on a remote repository:
1. Go to repository **Settings** -> **Secrets and variables** -> **Actions**.
2. Add Repository Secrets:
   - `SUPABASE_URL`: Your Supabase Project URL.
   - `SUPABASE_ANON_KEY`: Your Supabase Anon Public Key.
3. Both workflows can also be manually dispatched via the **Actions** tab with one click.

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
