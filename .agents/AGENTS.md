# Workspace Rules for Ladder Project

## Agent Delegation & Model Rules

1. **FORCE OPENROUTER (TIER 2) DELEGATION**:
   - For all future tasks in this project, you **MUST** use the OpenRouter free models (via the `openrouter-delegation` skill) by default, regardless of task complexity.
   - Do NOT use Antigravity models (TIER 1) directly unless the user explicitly specifies "use Antigravity", "use premium", or "do this yourself" in the prompt.

## Mandatory Pre-Execution & Post-Execution Rules

1. **FIRST STEP - READ MASTER CONTEXT (`LADDER.md`)**:
   - Before planning, designing, or implementing any code changes, refactors, bug fixes, or integrations, you **MUST** read [LADDER.md](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/LADDER.md).
   - Fully understand the architectural layout, UI/UX guidelines, existing data models, API endpoints, and component hierarchy.

2. **MANDATORY END-TO-END DEPENDENCY MAPPING (CROSS-FUNCTIONAL IMPACT PROTOCOL)**:
   Whenever modifying calculations, transaction handling, price feeds, or corporate actions, you **MUST** autonomously audit, update, and verify all 6 interconnected pipelines across the application:
   - **Pipeline 1 (Database & Ingestion Layer)**: Supabase tables (`holdings`, `transactions`, `dividends`), ingestion scripts, and validation engines.
   - **Pipeline 2 (Real-Time Price & Forex Engine)**: `liveQuoteCache`, `priceEngine.js`, `/api/fx-rate`, and `ThemeAuthContext.jsx`.
   - **Pipeline 3 (Holding Detail & Dense Timeline)**: `/api/holding/:id/detail`, FIFO lot engine, Tracker Chart, Actual Chart, and transaction ledger.
   - **Pipeline 4 (Portfolio Summaries & Hero Metrics)**: `/api/summary`, `/api/holdings`, `OverviewView.jsx`, and TopNavbar.
   - **Pipeline 5 (Time-Series & Calendar Heatmap)**: `data/portfolio_eod_logs.json`, `scripts/rebuild_portfolio_eod.mjs`, `pnl_history`, and `/api/daily-pnl`. Whenever database transactions change, you **MUST autonomously re-execute `rebuild_portfolio_eod.mjs`** and verify the calendar report without waiting for user prompting.
   - **Pipeline 6 (UI/UX, Themes & Precision)**: High-contrast light/dark themes, exact 2-decimal floating precision, `DD-MM-YYYY` dates, and non-repetitive text.

3. **FINAL STEP - UPDATE MASTER CONTEXT & CHANGE LOG (`LADDER.md`)**:
   - Whenever any file or code in the codebase is modified, added, or deleted, you **MUST** update [LADDER.md](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/LADDER.md).
   - Record all changes in the **Change Log & Maintenance History** table in `LADDER.md` with:
     - Version increment (e.g. `v1.1.0`)
     - Date
     - Clear description of architectural, feature, or database changes
     - Author/Agent identifier

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
