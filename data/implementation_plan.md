# Comprehensive System Audit & Reliability Report

> This is an honest, unflinching audit of the Ladder project's current state -- what works, what's fragile, what's broken, and what must change.

---

## 1. What Was Requested vs What Was Delivered

### Session Requests & Status

| # | Request | Status | Honest Assessment |
|---|---------|--------|-------------------|
| 1 | Verify MF & NPS have latest values for current date | Done | Fixed, but exposed the premature snapshot problem |
| 2 | Explain why 7th Sep calendar shows MF/NPS changes but not equity | Diagnosed | Root cause was null Yahoo Finance API responses for 07-Sep |
| 3 | Fix all historical date misalignment (not just 7th Sep) | Partially Done | Fixed 07-Sep specifically; the *structural* fix (Step 3 in `rebuild_portfolio_eod.mjs`) should prevent future occurrences, but **no full historical re-audit was performed** across all 6,921 records to verify every single date retroactively |
| 4 | Make checks future-proof for ALL asset classes | Codified in Rules | Rules written in `AGENTS.md` and `LADDER.md`, but enforcement is **documentation-level only** -- no automated CI/CD gate exists |
| 5 | Use Protean CRA exclusively, not npsnav.in | Partially Done | Live NPS quotes use Protean CRA. But `fetchNpsHistoricalNav()` at [priceEngine.js:383](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/services/priceEngine.js#L383) **still fetches from npsnav.in** as a fallback for historical data |
| 6 | Persist learnings into memory/rules | Done | Added to `.agents/AGENTS.md` Rules 8-10 |
| 7 | Ensure past-date transactions cascade correctly | Code Exists | `triggerEodRebuildIfPastDate` and `recalculateHoldingState` are wired, but see critical flaws below |
| 8 | Calendar 7th Sep missing equity changes | Fixed | Step 3 auto-fetch added to rebuild script |
| 9 | Full system reliability audit | **This Document** | -- |

---

## 2. Critical Flaws (Must Fix)

### FLAW 1: `fetchNpsHistoricalNav` Still Uses npsnav.in

**File**: [priceEngine.js:376-401](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/services/priceEngine.js#L376-L401)

Despite Rule 8 in `AGENTS.md` stating *"npsnav.in must NEVER override, replace, or be used in lieu of official Protean CRA records"*, the `fetchNpsHistoricalNav()` function still calls `https://npsnav.in/api/historical/{schemeCode}` as its **primary** historical source. The rebuild script at [rebuild_portfolio_eod.mjs:176](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/scripts/rebuild_portfolio_eod.mjs#L176) calls this function and then overlays Protean CRA data on top:

```javascript
const fallbackPrices = await fetchNpsHistoricalNav(holding.symbol); // npsnav.in
npsHistoricalPrices[holding.symbol] = { ...fallbackObj, ...(proteanMap[holding.symbol] || {}) };
```

This means for any date where Protean CRA does not have a record in `nps_daily_navs`, the system **silently falls back to npsnav.in values** -- which you were told are inaccurate. This is a direct violation of your own Rule 8.

> [!CAUTION]
> **Impact**: Every historical NPS valuation for dates not covered by `nps_daily_navs` in Supabase may be slightly wrong. The magnitude depends on how far back the Protean CRA data goes vs. the npsnav.in data.

**Fix**: `fetchNpsHistoricalNav` should query `nps_daily_navs` from Supabase as its sole source. If Protean CRA data is missing for a date, use last-known carry-forward, not npsnav.in.

---

### FLAW 2: Bank/EPF/Loan Balances Are Frozen at Excel Baseline in EOD Rebuild

**File**: [rebuild_portfolio_eod.mjs:344-367](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/scripts/rebuild_portfolio_eod.mjs#L344-L367)

The rebuild script carries forward bank balances (`hdfc`, `indusind`, etc.), EPF, loans, and credits from `prevLog` **indefinitely**. It never reads actual transaction history to compute what the bank balance was on any given historical date.

```javascript
const newLog = {
  date: dateStr,
  hdfc: prevLog.hdfc,       // Frozen from Excel baseline or last change
  indusind: prevLog.indusind, // Never recalculated from transactions
  // ... all banks frozen ...
  epf: prevLog.epf,          // Frozen
  loan: prevLog.loan,        // Frozen
  credits: prevLog.credits,  // Frozen
  debt: prevLog.debt,        // Frozen
};
```

This means:
- If you add a bank deposit for August 15th, `recalculateHoldingState` updates the **current** bank balance correctly, and `triggerEodRebuildIfPastDate` fires the rebuild script. But the rebuild script does NOT know about individual bank transactions -- it just carries forward from the Excel baseline date (Aug 7).
- **Result**: The Calendar heatmap for Aug 15 will NOT show the bank balance change. Only market-based assets (equities, MF, NPS) get recalculated daily. Banks, EPF, loans, and credits are effectively static snapshots from the Excel file.

> [!CAUTION]
> **Impact**: If you add a past-date bank deposit of 5 Lakhs on Aug 20, the Dashboard (live) will show the updated balance correctly, but the Calendar from Aug 8-19 will show the old balance, and Aug 20 onwards will ALSO show the old balance. The 5L change will be invisible in historical views.

**Fix**: The rebuild script needs a "bank balance timeline" -- replay bank transactions chronologically and update `savings` for each date where a transaction occurred.

---

### FLAW 3: No Automated Daily EOD Snapshot Trigger

There is no cron job, scheduled task, or automated trigger that runs `rebuild_portfolio_eod.mjs` daily after market close. The script only runs:
1. Manually by the developer
2. When `triggerEodRebuildIfPastDate` detects a past-date transaction (fires `fork`)

This means:
- If the server runs all day Monday, no one adds transactions, and the server stays running into Tuesday -- **Monday's EOD snapshot never gets written**. Tuesday's live data will work (via `/api/summary`), but the Calendar will show Monday as missing.
- If the server restarts, the script runs on startup... but only if it's imported in the boot sequence, which it isn't.

> [!WARNING]
> **Impact**: Historical gaps will silently accumulate on any day the rebuild script isn't manually invoked. You won't notice until you check the Calendar days/weeks later.

**Fix**: Add a daily cron (e.g., `node-cron` or OS-level `Task Scheduler`) that runs `rebuild_portfolio_eod.mjs` at ~6:30 PM IST (after Indian market close) and ~7:00 AM IST (after US market close for previous night).

---

### FLAW 4: Equity Quote Fallback to `chartPreviousClose` Is Lossy

**File**: [rebuild_portfolio_eod.mjs:233-235](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/scripts/rebuild_portfolio_eod.mjs#L233-L235)

When Yahoo Finance returns `null` for a day's close price, the script falls back to `meta.chartPreviousClose`. This is **not** the actual closing price for that date -- it's the close of the *previous* trading session. For the Sep 7 fix, this happened to be close enough because Sep 5 (Friday) close was used for Sep 7 (Sunday was skipped). But:

- If a stock has a null entry on a Monday (actual trading day), the fallback will use Friday's close, which could be significantly different.
- The script only checks `targetEndDate` for this fallback, not intermediate missing dates.

> [!WARNING]
> **Impact**: A stock that had a null close on any arbitrary trading day would get Friday's (or previous session's) price silently substituted, creating invisible valuation errors that compound over time.

---

### FLAW 5: Verify Scripts Have Hardcoded Expected Values

**File**: [verify_all_assets_integrity.mjs:147-172](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/scripts/verify_all_assets_integrity.mjs#L147-L172)

```javascript
// Check 4 is hardcoded to verify 2026-09-07 specifically
const expectedMf = 4520076.75;
const expectedNps = 513037.68;
```

These are point-in-time assertions that will always pass for Sep 7 but tell you nothing about Sep 8, Sep 9, or any future date. The script is not a general-purpose integrity suite -- it's a one-time reconciliation check dressed up as an automated audit.

Similarly, [verify_financial_integrity.mjs](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/scripts/verify_financial_integrity.mjs) only tests **today's live snapshot** parity (Dashboard vs Calendar vs Engine). It does not retroactively audit historical records.

> [!IMPORTANT]
> **Impact**: These scripts provide a false sense of security. A "100% PASS" today does not mean all 6,921 historical records are accurate -- it means today's live computation and Sep 7's hardcoded values match.

---

### FLAW 6: Weekend P&L Is Forced to Zero Even When Bank Transactions Occur

**File**: [server/index.js:2091-2094](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/index.js#L2091-L2094)

```javascript
const pnl = isWeekendDay(cur.date) ? 0 : (curWealth - prevWealth);
const pct = isWeekendDay(cur.date) ? 0 : (prevWealth !== 0 ? ((pnl / prevWealth) * 100) : 0);
```

This unconditionally zeros out weekend P&L. But Rule 5 in `AGENTS.md` says *"Daily P&L for non-trading sessions MUST strictly equal 0.00 unless a manual user deposit/withdrawal occurred."* The code doesn't check for that "unless" condition. If you deposit 10L into HDFC on a Saturday, the Calendar will still show `0.00` P&L for that day.

---

## 3. Structural Weaknesses (Should Fix)

### WEAKNESS 1: 18 Scripts, No Unified Entry Point

The `scripts/` directory has 18 separate `.mjs` files. There is no single orchestrator. The user must know which script to run and when. This violates the user's explicit request: *"Hundreds of scripts, no universal script."*

**Recommendation**: Create a single `scripts/daily_sync.mjs` that orchestrates: (1) price sync, (2) EOD rebuild, (3) integrity verification, and (4) Supabase sync -- in that order, with proper error handling and a summary report.

### WEAKNESS 2: Supabase Pagination Only in Some Places

[recalculator.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/services/recalculator.js) correctly implements pagination via `fetchPagedTransactions`. But `/api/summary` at [server/index.js:202](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/index.js#L202) fetches US transactions without pagination:

```javascript
const usTxsRes = await supabase.from('transactions').select(...)
  .eq('currency', 'USD').eq('type', 'BUY');
// No .range() or pagination loop
```

If US stock BUY transactions exceed 1,000 rows, the weighted FX rate calculation will be silently wrong.

### WEAKNESS 3: EOD JSON File as Source of Truth

[portfolio_eod_logs.json](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/data/portfolio_eod_logs.json) is a flat JSON file that grows ~2KB per day. It's read synchronously on every `/api/daily-pnl` call. In 3 years this will be ~2MB loaded into memory on every request. More critically, it's a local file that can be corrupted, accidentally deleted, or go out of sync with Supabase `pnl_history`.

### WEAKNESS 4: `computePortfolioValuation` Does NOT Include Liabilities When Called from Rebuild Script

At [rebuild_portfolio_eod.mjs:345](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/scripts/rebuild_portfolio_eod.mjs#L345):
```javascript
const valuation = computePortfolioValuation(holdings, [], priceMap, fx);
```
Liabilities are passed as empty `[]`. The rebuild script manually carries forward `prevLog.loan` and `prevLog.credits`. This means the "canonical engine" is not actually used end-to-end for historical records -- it's only used for market-based asset valuation, while banks/liabilities are handled via separate carry-forward logic.

---

## 4. Data Reliability Assessment

### What's Reliable

| Data Source | Reliability | Notes |
|-------------|-------------|-------|
| Indian Equity live prices | High | Yahoo Finance with NSE/BSE dual-fetch and `chartPreviousClose` fallback |
| US Equity live prices | High | Yahoo Finance direct |
| Mutual Fund live NAVs | High | Official AMFI API (`api.mfapi.in`) |
| NPS live NAVs | High | Protean CRA ZIP scraper with Supabase persistence |
| Bank balances (current) | High | `recalculateHoldingState` replays all transactions correctly |
| Loan/Credit balances (current) | High | Same recalculator engine |
| FIFO lot tracking | High | Well-implemented in recalculator with epsilon clamping |
| Today's live Dashboard | High | `computePortfolioValuation` is mathematically sound |

### What's Unreliable

| Data Source | Reliability | Notes |
|-------------|-------------|-------|
| Historical NPS valuations | Medium-Low | Mix of npsnav.in (inaccurate) and Protean CRA (accurate but potentially sparse) |
| Historical bank balances in Calendar | Low | Frozen at Excel baseline, never recalculated from transactions |
| Historical EOD records completeness | Medium | Depends entirely on manual script execution; no automated daily trigger |
| Any date where Yahoo Finance returned null | Medium | Fallback to `chartPreviousClose` may use wrong session's price |
| Weekend P&L when user transactions exist | Broken | Unconditionally zeroed out |

### Overall Data Confidence

> [!IMPORTANT]
> **Pre-2026-08-07 data** (from `portfolio.xlsx`): Assumed correct as imported. Never independently verified.
>
> **2026-08-08 to 2026-09-07 data**: Market asset valuations are likely 95%+ accurate after the Sep 7 reconciliation. Bank/EPF/Loan balances are frozen at their Aug 7 levels in the Calendar -- any transactions in this period are invisible in historical views.
>
> **Current day (live)**: High confidence. The `computePortfolioValuation` engine is mathematically sound and all live price feeds are from authoritative sources.

---

## 5. Is It Future-Proof?

**No.** Here's why:

1. **No automated daily EOD pipeline**: Missing days will silently accumulate.
2. **Bank/EPF/Loan changes are invisible in Calendar history**: The rebuild script doesn't process transaction timelines for non-market assets.
3. **npsnav.in is still in the code**: Despite explicit rules against it.
4. **Integrity scripts are one-time snapshots, not regression tests**: They don't prevent future data corruption.
5. **No build/deploy gate**: A developer can push broken code and the integrity tests won't run automatically.
6. **No data backup/recovery mechanism**: If `portfolio_eod_logs.json` is corrupted, partial recovery from Supabase (last 90 days only via upsert) is the only option.

---

## 6. Recommended Fixes (Priority Order)

### Priority 1 (Critical Data Integrity)

| # | Fix | Effort |
|---|-----|--------|
| 1 | Remove npsnav.in from `fetchNpsHistoricalNav`. Use only `nps_daily_navs` from Supabase + carry-forward for missing dates | 1-2 hours |
| 2 | Add bank/EPF/loan transaction timeline replay to `rebuild_portfolio_eod.mjs` so Calendar reflects balance changes on actual dates | 3-4 hours |
| 3 | Fix weekend P&L to check for same-day user transactions before zeroing | 30 mins |
| 4 | Add automated daily EOD trigger via `node-cron` inside `server/index.js` (6:30 PM IST + 7:00 AM IST) | 1 hour |

### Priority 2 (Robustness)

| # | Fix | Effort |
|---|-----|--------|
| 5 | Paginate ALL Supabase queries (especially US tx FX calculation in `/api/summary`) | 1 hour |
| 6 | Replace hardcoded Check 4 in `verify_all_assets_integrity.mjs` with a general "no duplicate dates, no gaps, no future dates" check | 1 hour |
| 7 | Create unified `scripts/daily_sync.mjs` orchestrator | 2 hours |
| 8 | Make equity null-price fallback smarter: try 5d range first, then 1mo, and validate the returned date matches the requested date | 1-2 hours |

### Priority 3 (Sustainability)

| # | Fix | Effort |
|---|-----|--------|
| 9 | Migrate EOD source of truth from JSON file to Supabase `pnl_history` (full history, not just last 90 days) | 2-3 hours |
| 10 | Add pre-commit hook or npm script that runs `verify_financial_integrity.mjs` before any git push | 30 mins |
| 11 | Implement "rebuild from date X" flag in the EOD script so past-date cascade doesn't redo the entire history | 1-2 hours |

---

## 7. Summary

The **live Dashboard and current-day valuations** are reliable and mathematically sound. The `computePortfolioValuation` engine is well-structured and the live price feeds (Yahoo, AMFI, Protean CRA) are authoritative.

The **historical data pipeline** has structural gaps: bank balances are frozen in Calendar history, NPS historical data may use inaccurate npsnav.in values, weekend P&L doesn't account for user transactions, and there's no automated daily trigger to prevent gaps.

The **integrity scripts** provide a false sense of completeness -- they test today's snapshot and one hardcoded date, not the full historical record.

The system needs the 4 Priority 1 fixes to be considered reliable for financial tracking. Without them, the Calendar heatmap and historical P&L views should be treated as approximate, not authoritative.

> [!IMPORTANT]
> **Open Question**: Would you like me to proceed with implementing the Priority 1 fixes? I recommend tackling them in order: (1) remove npsnav.in, (2) add bank/EPF timeline to EOD rebuild, (3) fix weekend P&L logic, (4) add automated daily cron trigger.
