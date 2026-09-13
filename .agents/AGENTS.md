# Workspace Rules for Ladder Project

## Agent Delegation & Model Rules

1. **FORCE OPENROUTER (TIER 2) DELEGATION**:
   - For all future tasks in this project, you **MUST** use the OpenRouter free models (via the `openrouter-delegation` skill) by default, regardless of task complexity.
   - Do NOT use Antigravity models (TIER 1) directly unless the user explicitly specifies "use Antigravity", "use premium", or "do this yourself" in the prompt.

## Mandatory Pre-Execution & Post-Execution Rules

1. **FIRST STEP - READ MASTER CONTEXT (`LADDER.md`)**:
   - Before planning, designing, or implementing any code changes, refactors, bug fixes, or integrations, you **MUST** read [LADDER.md](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/LADDER.md).
   - Fully understand the architectural layout, UI/UX guidelines, existing data models, API endpoints, and component hierarchy.

2. **MANDATORY END-TO-END DEPENDENCY MAPPING & UNIVERSAL VIEW SYNCHRONIZATION**:
   **ZERO TOLERANCE FOR OUT-OF-SYNC PAGES OR DISPARATE CALCULATION ENGINES**:
   - **UNIFIED REAL-TIME SOURCE OF TRUTH**: All pages (Dashboard, Calendar, Portfolios, Detail Modals, Reports) MUST update dynamically in real time and share the exact same underlying calculation engine (`computePortfolioValuation` and `liveQuoteCache`). Never create separate, ad-hoc, or divergent calculation formulas or scripts for individual pages.
   - **DYNAMIC ZERO-SCRIPT SYNCHRONIZATION**: Today's current day metrics (Net Worth, Total Assets, Total Liabilities, Day P&L, and Category Breakdowns) across all views (including Calendar Heatmap and Holding Detail timelines) MUST compute dynamically on-the-fly from live database holdings and price feeds. No manual or background batch scripts should ever be required for the current day to be in sync.
   - **MANDATORY CROSS-PAGE AUDIT BEFORE COMPLETION**: Before completing any task, delivering a response, or presenting data to the user, you **MUST autonomously verify every single affected view and section** (Dashboard, Calendar, Indian Equity, US Equity, Mutual Funds, NPS, Bank, EPF, Liabilities, Dividends, Reports, and Holding Detail Modals) to confirm that all records, totals, and breakdowns match with exact 1-to-1 parity down to the cent.
   - Whenever modifying calculations, transaction handling, price feeds, or corporate actions, you **MUST** autonomously audit, update, and verify all 6 interconnected pipelines across the application:
   - **Pipeline 1 (Database & Ingestion Layer)**: Supabase tables (`holdings`, `transactions`, `dividends`, `liabilities`), ingestion scripts, and validation engines.
   - **Pipeline 2 (Real-Time Price & Forex Engine)**: `liveQuoteCache`, `priceEngine.js`, `/api/fx-rate`, and `ThemeAuthContext.jsx`.
   - **Pipeline 3 (Holding Detail & Dense Timeline)**: `/api/holding/:id/detail`, FIFO lot engine, Tracker Chart, Actual Chart, and transaction ledger.
   - **Pipeline 4 (Portfolio Summaries & Hero Metrics)**: `/api/summary`, `/api/holdings`, `OverviewView.jsx`, and TopNavbar.
   - **Pipeline 5 (Time-Series & Calendar Heatmap)**: `data/portfolio_eod_logs.json`, `pnl_history`, and `/api/daily-pnl`. Historical past sessions are stored in EOD logs while today's snapshot is computed dynamically in real time. Historical script `rebuild_portfolio_eod.mjs` is only for backfilling past multi-year histories.
   - **Pipeline 6 (UI/UX, Themes & Precision)**: High-contrast light/dark themes, exact 2-decimal floating precision, `DD-MM-YYYY` dates, and non-repetitive text.

3. **FINAL STEP - UPDATE MASTER CONTEXT & DOCUMENTATION (`LADDER.md` & `README.md`)**:
   - Whenever any file, feature, or architecture in the codebase is modified, added, or deleted, you **MUST** update both [LADDER.md](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/LADDER.md) and [README.md](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/README.md).
   - Record all changes in the **Change Log & Maintenance History** table in `LADDER.md` with:
     - Version increment (e.g. `v1.1.0`)
     - Date
     - Clear description of architectural, feature, or database changes
     - Author/Agent identifier
   - Ensure `README.md` accurately describes current features, architecture, scripts, and workflows.

4. **MANDATORY CONFIRMATION ON ALL DELETE ACTIONS**:
   - Any user action that deletes or removes data (holdings, transactions, recurring SIPs, profile media) MUST always prompt for explicit user confirmation (`window.confirm`) displaying the asset or schedule name before executing. Never perform unconfirmed deletions.

5. **MANDATORY FINANCIAL DATA INTEGRITY & ANTI-HALLUCINATION PROTOCOL**:
   - **ZERO ASSUMPTIONS & ZERO HARDCODED HEURISTICS**: Financial figures must NEVER be guessed, simulated with arbitrary noise, or approximated with heuristic percentages. If an NAV or price feed is unavailable, the system must retain the verified last-known closing quote with zero synthetic fluctuation.
   - **DATABASE QUERY PAGINATION GUARD**: All database queries on `transactions`, `holdings`, `dividends`, `liabilities`, and `pnl_history` MUST implement explicit pagination loops (`range(from, from + batchSize - 1)`) or exact row count checks. Never execute unpaginated `.select('*')` on tables that can exceed Supabase's default 1,000-row limit.
   - **WEEKEND & NON-TRADING MARKET INVARIANCE**: On Saturdays, Sundays, and exchange holidays, all equity, MF, and NPS asset valuations MUST strictly carry forward Friday's finalized closing valuations. Daily P&L for non-trading sessions MUST strictly equal `₹0.00 (0.00%)` with `0 changes` unless a manual user deposit/withdrawal occurred.
   - **MANDATORY PRE-HANDOFF AUTOMATED INTEGRITY TEST**: Before marking any task complete or delivering numbers to the user, you **MUST execute `node scripts/verify_financial_integrity.mjs`** and obtain a 100% PASS across all 5 financial invariance assertions (Balance Sheet equation, Cross-Endpoint Parity, Pagination Safety, and Weekend Invariance).

6. **ZERO UNNECESSARY TEXT & MINIMALIST FINTECH AESTHETICS**:
   - **NO DESCRIPTIVE PARAGRAPHS OR SUBTITLES**: Never add explanatory subtitles, filler paragraphs, or descriptive blurbs under headers, cards, or metrics (e.g. 'Institutional-grade asset allocation...', 'Categorized via internet data...', 'Track date-by-date performance...').
   - Keep headers, cards, tables, and views ultra-clean, minimal, and elegant. Let data, metrics, charts, and clean titles speak for themselves without verbose statements or clutter.

7. **MANDATORY THEME-MATCHED POPUP, MODAL & DIALOG ARCHITECTURE**:
   - **UNIFIED DESIGN SYSTEM PARITY**: Every modal, dialog, and popup in the project MUST use the exact project theme tokens: `modal-surface reports-card` for the outer container, `border border-inherit`, `reports-subcard` for internal cards/forms, `text-inherit` or `--text-primary` for typography, and React `createPortal(..., document.body)` for true viewport centering and scroll isolation.
   - **ZERO HARDCODED GREY OVERLAYS & SILLY BUTTON CLUTTER**: Never use hardcoded dark grey slabs (`bg-slate-900`, `bg-slate-800`), saturated solid blocks, or redundant cancel buttons (e.g. displaying "+ Cancel" in headers beside "X"). Keep header controls minimal (clean title icon, primary action trigger if applicable, and standard "X" close button). Form actions (Save/Cancel) must live strictly within the form action footer.

8. **NPS DAILY SCRAPING & RESILIENT FALLBACK PROTOCOL**:
   - The system uses the official Protean CRA scraper (`https://www.npscra.proteantech.in`) and the `nps_daily_navs` table in Supabase as the primary source of truth for daily NPS NAVs.
   - Scheduled workflows and server routines MUST run automatically to scrape and persist daily NAV files into Supabase to prevent data gaps.
   - For missing past dates or when official Protean archives are temporarily unavailable, secondary aggregators like `npsnav.in` are permitted and documented fallbacks/backfills to ensure historical valuations remain complete and uninterrupted.

9. **STRICT TRADE/TRANSACTION DATE PARITY (NEVER ENTRY TIMESTAMP)**:
   - All financial valuations, EOD snapshots, P&L calculations, and ledger balances MUST strictly compute based on the **actual trade/transaction date** (`transaction.date` or `log_date`), NEVER the system entry timestamp (`created_at`).
   - **PREMATURE SNAPSHOT BAN**: No EOD snapshot may EVER be recorded in `pnl_history` for date $D$ before date $D$'s market session has completed and official prices/NAVs have been published and verified. Current day metrics must strictly remain dynamic in real-time.

10. **MANDATORY PAST-DATE TRANSACTION CASCADE & CONTINUOUS VIEW SYNCHRONIZATION**:
   - When any transaction, balance adjustment, corporate action, or holding entry is added, modified, or deleted for a past date ($T < \text{Today}$):
     - **Holdings & Current State**: The holding's entire chronological history from inception to present MUST be re-simulated via `recalculateHoldingState` (FIFO lots, buy quantity, sell quantity, average cost, net bank balance).
     - **Calendar & Historical EOD Logs**: All intermediate historical EOD logs in `pnl_history` and `data/portfolio_eod_logs.json` between date $T$ and yesterday MUST be synchronized (via `rebuild_portfolio_eod.mjs`), ensuring that EVERY historical day on the Calendar heatmap and every subsequent date correctly reflects the change.
     - **Universal View Synchronization**: All views (Dashboard, Calendar, Indian Equity, US Equity, Mutual Funds, NPS, Fixed Income, Liabilities, Reports, and Holding Detail Modals) MUST maintain 100% mathematical parity down to the cent with zero discrepancy.

11. **MANDATORY IN-MEMORY REACTIVE CACHING & EGRESS PROTECTION PROTOCOL**:
    - **ZERO REDUNDANT CLOUD NETWORK SWEEPS**: To strictly protect free cloud database tier limits (5 GB monthly egress), all read-heavy repetitive operations (`/api/summary`, `/api/holdings`, `/api/liabilities`, `/api/dividends`) MUST read from the server-side in-memory cache (`db.select` with `dbCache`).
    - **IMMEDIATE MUTATION INVALIDATION**: Whenever any transaction, holding, dividend, or liability record is inserted, updated, or deleted, the in-memory cache MUST immediately be invalidated via `db.invalidateCache()`, ensuring real-time UI responsiveness without wasteful network egress.
    - **ZERO RUNAWAY AUDIT TRIGGERS**: Never introduce database triggers that serialize full JSON row snapshots on high-frequency tables (such as holdings or transactions), preventing database disk bloat.

12. **CLOUD COMPRESSED BACKUP & 10-DAY RETENTION PROTOCOL**:
    - Complete database snapshots MUST be compressed losslessly with gzip (`.json.gz`, shrinking storage by ~93%) and stored in Supabase Cloud Storage (`ladder_backups` bucket).
    - Retention policy: **Unlimited backups within 10 days**. Any backup snapshots older than 10 days MUST automatically be pruned.
    - Automated daily execution: Daily backup runs automatically at 08:25 AM IST (just before 08:30 AM IST) via Express server scheduler and GitHub Actions (`daily_backup.yml`).
    - Manual backup & restoration: Supported directly via the user Profile dropdown menu ("Backup Database Now", "Restore Database" modal), `ExcelToolsView.jsx`, and CLI scripts (`scripts/backup_manager.mjs`, `scripts/restore_backup.mjs`), with explicit safety confirmations before executing any database overwrite.

13. **STRICT ANTI-HARDCODING & DYNAMIC ENGINE ARCHITECTURE PROTOCOL**:
    - **ZERO HARDCODED DATES, YEARS, OR HEURISTICS**: Never hardcode static calendar years, time-locked dates, single-year arrays/sets, or static assumptions in application code or backend services.
    - **DYNAMIC ALGORITHMIC IMPLEMENTATION**: Any functionality that is dynamic in nature (market trading schedules, exchange holidays, calendar dates, tax brackets, date arithmetic, recurring intervals) MUST be implemented algorithmically or through extensible multi-year dynamic registries (such as `server/services/marketCalendar.js`) capable of seamlessly evaluating across arbitrary future years (e.g. 2026, 2027, 2028, and beyond) without code modifications.

## Mandatory Git Push & Release Workflow Rules

When asked to commit, release, or push code to Git:

1. **Security & Secrets Audit**:
   - Verify that no passwords, API keys, JWT tokens, secrets, or `.env` files are committed or published.
   - Confirm `.gitignore` properly excludes `.env`, `.env.local`, `node_modules/`, and build artifacts.

2. **Documentation & Changelog Sync**:
   - Update `README.md` and `CHANGELOG.md` with all latest features, architecture changes, and bug fixes before committing.

3. **No Emoticons / Emojis**:
   - Ensure clean professional text only. **Do NOT use any emoticons or emojis** in commit messages, `README.md`, `CHANGELOG.md`, `LADDER.md`, or PR descriptions.

4. **Branch & Merge Workflow**:
   - Always create a feature branch (e.g., `feature/supabase-integration` or `release/v1.1.0`).
   - Commit changes to the feature branch.
   - Switch to `main` branch, merge the feature branch into `main`, and then push `main` to remote `origin`.
   - **Do NOT delete the feature or release branch after merging**. Keep all feature/release branches intact in Git history.

5. **Short & Precise Commit Messages**:
   - Keep commit messages **short but precise** (e.g. `feat: dashboard charts precision and interaction upgrade`). Avoid overly long or verbose commit titles.

6. **Build & Verify Before Finalizing Changes**:
   - Before completing any task or pushing code, you **MUST** ensure the current code doesn't break by verifying it. Run `npm run build` or the corresponding test/build commands to catch syntax errors or unresolved variables (e.g. `ReferenceError` during mapping). Never leave a file with untested breaking changes.

7. **Backend Daemon & Port 5000 Health Check**:
   - Before handing over any task, you **MUST** verify that the Express backend server (`node server/index.js`) is active on port 5000 and responds to `GET http://127.0.0.1:5000/api/summary` with HTTP 200 without ECONNREFUSED. If not running, start it as a background daemon process so the user never encounters connection errors.
