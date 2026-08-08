# Workspace Rules for Ladder Project

## Mandatory Pre-Execution & Post-Execution Rules

1. **FIRST STEP - READ MASTER CONTEXT (`LADDER.MD`)**:
   - Before planning, designing, or implementing any code changes, refactors, bug fixes, or integrations, you **MUST** read [LADDER.MD](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/LADDER.MD).
   - Fully understand the architectural layout, UI/UX guidelines, existing data models, API endpoints, and component hierarchy.

2. **FINAL STEP - UPDATE MASTER CONTEXT & CHANGE LOG (`LADDER.MD`)**:
   - Whenever any file or code in the codebase is modified, added, or deleted, you **MUST** update [LADDER.MD](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/LADDER.MD).
   - Record all changes in the **Change Log & Maintenance History** table in `LADDER.MD` with:
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
   - Ensure clean professional text only. **Do NOT use any emoticons or emojis** in commit messages, `README.md`, `CHANGELOG.md`, `LADDER.MD`, or PR descriptions.

4. **Branch & Merge Workflow**:
   - Always create a feature branch (e.g., `feature/supabase-integration` or `release/v1.1.0`).
   - Commit changes to the feature branch.
   - Switch to `main` branch, merge the feature branch into `main`, and then push `main` to remote `origin`.
   - **Do NOT delete the feature or release branch after merging**. Keep all feature/release branches intact in Git history.
