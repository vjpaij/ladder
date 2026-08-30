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
