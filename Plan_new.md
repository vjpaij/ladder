# Intelligent Exit & Rebalancing Engine for Indian Equities
## Production implementation plan — revised baseline

**Version:** 3.0.0  
**Status:** Proposed implementation specification; requires repository inspection before coding  
**Scope:** Personal Indian-equity portfolio decision support  
**Primary fundamental research source:** Screener.in, subject to permitted access  
**Execution model:** Alerts and recommendations only; no automatic broker orders  
**Core requirement:** Add this capability without changing existing portfolio calculations, holdings, transactions, balances, or unrelated application behavior.

---

## 1. Purpose and non-negotiable principles

Build an evidence-driven system that helps answer:

1. **When should I review a holding for a possible sale?**
2. **Why is the system raising the concern?**
3. **How many shares might be reasonable to sell, and how was that quantity calculated?**
4. **What evidence would invalidate the alert?**
5. **What risks arise from selling now, including the possibility that the stock continues rising?**

The engine is decision support, not a prediction oracle. It cannot guarantee the best exit price, avoid every false signal, or ensure a stock will not rally after a sale.

### Non-negotiable requirements

- Additive implementation: do not modify existing financial calculations or unrelated behavior.
- Read-only by default: evaluation must not write to holdings, transactions, cash balances, or P&L.
- No automatic trading or broker order placement.
- Explicit user confirmation is required before recording a trade in the existing application.
- No sell recommendation based only on a single price drop, indicator, valuation ratio, or opaque score.
- No “Stage 2 immunity” that suppresses verified critical fundamental or governance warnings.
- All numerical calculations must be deterministic, testable, and reproducible.
- AI-generated explanations must be grounded in stored evidence; an LLM must never calculate or alter share quantities, prices, tax, or risk limits.
- Unknown or stale data must be labelled as unknown/stale—not silently treated as healthy.
- No claim of backtest success until the results can be reproduced from source data and code.
- Use only permitted data access methods. Do not bypass logins, rate limits, access controls, or terms of service.

---

## 2. Scope and exclusions

### Included

- Monitoring current Indian-equity holdings.
- Technical trend and volatility analysis.
- Screener.in-based fundamental monitoring, where access is permitted.
- Verification of material events against official company/exchange filings.
- Portfolio concentration and position-sizing analysis.
- Acquisition-lot-aware estimated proceeds, costs, and tax calculations.
- Explainable alert states, deduplication, history, and a portfolio intelligence dashboard.
- Historical backtesting, walk-forward validation, and live shadow mode.
- Optional AI-assisted summarization of company disclosures and management commentary, with source references.

### Excluded from the initial release

- Automatic trading or broker order submission.
- Claims that the engine predicts exact tops or bottoms.
- General-market stock recommendations outside the user's holdings unless explicitly added later.
- Unlicensed redistribution of market or financial data.
- Treating an LLM opinion as verified evidence.
- Changes to existing portfolio accounting, transaction matching, or valuation logic.
- Public-facing investment advice or commercialization without a separate regulatory review.

---

## 3. Mandatory discovery before implementation

Do not start by editing application files. First inspect the actual repository and document:

- Frontend, backend, language, framework, and package versions.
- Existing stock/holding identifiers and how NSE/BSE symbols are mapped.
- Database schema, migrations, access policies, and backup approach.
- Existing quote provider, cache, transaction ledger, acquisition-lot logic, and financial calculations.
- Current test commands and the exact baseline output of financial-integrity tests.
- Existing design system, navigation, modal patterns, light/dark themes, and notification mechanisms.
- Existing environment variables and secret-management practices.
- Existing scheduled jobs and deployment/runtime constraints.

### Baseline gate

Before coding:

1. Create a dedicated Git branch.
2. Confirm a recent restorable database backup.
3. Run the existing test suite and save its results.
4. Capture baseline values for holdings, quantities, cash, realized P&L, unrealized P&L, and portfolio value.
5. Add or identify regression tests for those values.
6. Write an architecture decision record (ADR) describing the additive integration.
7. Confirm that proposed files, routes, tables, and UI changes do not collide with existing code.

**Stop condition:** If the existing repository or its financial-integrity behavior cannot be understood, do not guess at file paths, schemas, or implementation details.

---

## 4. Decision architecture

```text
Portfolio and transaction ledger (read-only input)
                   |
                   v
          Data-provider adapters
        /           |            \
 Price history   Screener.in   Official filings
        \           |            /
                   v
            Normalized snapshots
                   |
                   v
          Data quality and provenance
                   |
        +----------+-----------+
        |          |           |
        v          v           v
    Technical   Fundamental  Portfolio
     engine       engine      risk/tax
        \          |           /
         +---------+----------+
                   |
                   v
          Evidence/rule evaluator
                   |
                   v
           Decision state machine
                   |
                   v
        Deterministic share sizer
                   |
                   v
       Explainable recommendation
                   |
                   v
        UI / optional notifications
                   |
                   v
      Explicit user action only
```

Keep each engine independently testable. The decision engine should consume normalized evidence rather than scrape websites or calculate indicators inside UI components.

### Suggested service boundaries

Names are illustrative until repository inspection confirms the project conventions.

- `exitIntelligenceEngine`: orchestrates evaluation and state transitions.
- `technicalIndicators`: pure indicator calculations.
- `screenerFundamentalsProvider`: permitted Screener data acquisition and normalization.
- `exchangeFilingVerifier`: material-event verification and filing metadata.
- `fundamentalAnalyzer`: sector-aware comparisons and warnings.
- `portfolioRiskScanner`: concentration and exposure calculations.
- `taxEstimator`: versioned tax estimates, separate from decision logic.
- `sellQuantityCalculator`: deterministic sizing and rounding.
- `alertPolicy`: hysteresis, deduplication, cooldown, escalation.
- `backtestEngine`: point-in-time historical replay and performance reporting.
- `intelligenceRepository`: persistence of snapshots, evidence, evaluations, and alert history.

---

## 5. Data sourcing and Screener.in integration

### 5.1 Source priority

1. **Screener.in:** Primary fundamental research source for available financial statements, quarterly results, ratios, shareholding, and company-page references, subject to permitted access.
2. **Official NSE/BSE/company filings:** Verification source for material results, board outcomes, corporate actions, auditor matters, governance events, and filing dates.
3. **Authorized price-data provider:** Historical adjusted/unadjusted OHLCV data appropriate for technical analysis and backtesting.
4. **Other sources:** Only for clearly identified gaps, and never silently mixed with Screener values as if they came from the same source.

Screener-derived metrics are not automatically infallible. Record provenance and verify material discrepancies.

### 5.2 Access policy

Before implementing automated retrieval, review current Screener terms, robots.txt, usage restrictions, and any available authorized export/API options. Public visibility does not itself grant permission for automated scraping. Do not evade authentication, rate limits, CAPTCHAs, or access controls.

Preferred access order:

1. Official supported API or authorized integration, if available.
2. Permitted user-initiated exports or other explicitly allowed access.
3. Automated retrieval only if current terms and permissions allow it.
4. If none is permitted, ask the user to supply an export or use an authorized provider.

Apply conservative request limits, caching, retries with backoff, and provider circuit breakers. Do not run broad market-wide crawls; initially fetch only held symbols and explicitly selected watchlist entries.

### 5.3 Normalized fundamental observation

Every data point should carry, where available:

- Company identifier, exchange, symbol, and Screener company-page reference.
- Metric name, value, unit, currency, and calculation method.
- Reporting period end date.
- Public filing/announcement date.
- Ingestion timestamp.
- Consolidated/standalone basis.
- Source name and source URL/reference.
- Data-quality status and any transformation applied.
- Revision/restatement linkage, without overwriting what was known historically.

Use consolidated statements when appropriate and available, but do not blindly assume consolidated data is always the correct basis. Record the basis and make comparisons on a consistent basis. Flag a basis change instead of creating a false trend.

### 5.4 Freshness and missing data

- Distinguish expected reporting cadence from actual source freshness.
- A stale or missing fundamental value is **UNKNOWN**, not zero and not healthy.
- Do not generate a high-confidence fundamental sell signal from incomplete data.
- Critical, independently verified disclosures may still trigger urgent review when routine metrics are stale.
- Keep raw snapshots and normalized values so a decision can be audited.
- If a provider fails, use the last known value only with its timestamp and a stale-data label; never imply it is current.

### 5.5 Sector-aware analysis

Do not apply manufacturing ratios to every listed company.

**Non-financial companies:** sales, operating margins, profit, cash conversion, working capital, debt, interest coverage, ROCE/ROE, dilution, and relevant sector indicators.

**Banks/NBFCs:** use suitable measures such as NIM, asset quality, provisions, capital adequacy, liquidity, loan growth, and return measures where available. Do not use manufacturing debt-to-equity rules as a universal trigger.

Other sector templates may be added only with documented rationale, tests, and metric definitions.

### 5.6 Fundamental checks

Candidate warning families—not universal automatic sell rules:

- Sustained sales/profit growth deterioration relative to company history and sector.
- Material and persistent margin compression.
- Weak operating cash flow relative to reported profit.
- Deteriorating working capital or recurring cash-flow deficits.
- Increasing leverage or weakening interest coverage where applicable.
- Promoter pledge/shareholding changes requiring context and verification.
- Auditor resignation/qualification, material governance issues, related-party concerns, or verified regulatory events.
- Material dilution, contingent liabilities, or other disclosures that change the investment thesis.
- Valuation risk relative to company history, sector, growth durability, and cyclicality.

Thresholds must be configurable, documented, and tested. A ratio crossing a threshold is evidence to investigate—not proof by itself that the stock should be sold.

---

## 6. Technical analysis

### Candidate inputs

- Adjusted daily OHLCV data, with corporate-action treatment documented.
- Weekly aggregation and 30-week moving average/trend slope.
- Long-term moving averages and price structure.
- ATR-based volatility corridors, including a Chandelier-style reference where appropriate.
- Relative strength versus a relevant benchmark and sector index.
- Volume context, gaps, liquidity, and abnormal trading conditions.
- Market/sector regime, where reliable data is available.

### Technical guardrails

- Define indicator formulas, warm-up periods, missing-bar handling, and price-adjustment policy.
- Use completed candles for end-of-day decisions; do not accidentally use partial current-day bars.
- Confirm routine technical warnings using pre-defined persistence rules, preferably on the relevant timeframe.
- Adjust for volatility and liquidity; one fixed percentage stop is not suitable for all stocks.
- A technical breakdown is not automatically a fundamental failure.
- Strong uptrends can increase the evidence threshold for technical-only trimming, but cannot suppress verified critical governance or solvency warnings.
- Avoid presenting a trailing corridor as a guaranteed executable stop price.
- Document circuit limits, illiquidity, gaps, and execution slippage risks.

Technical parameters are hypotheses until validated. Do not present 30-week SMA, 3× ATR, or any other setting as universally optimal.

---

## 7. Decision states and transitions

Use transparent categorical states instead of relying on an unvalidated 0–100 composite score. If a score is displayed later, it must be supplementary, calibrated, and explained.

| State | Meaning | Default behavior |
|---|---|---|
| `NORMAL` | No material evidence requiring action | Monitor silently |
| `WATCH` | One material warning or incomplete confirmation | Explain what needs confirmation |
| `TECHNICAL_TRIM_CANDIDATE` | Persistent technical deterioration; fundamental thesis not shown to be broken | Consider partial reduction under validated rules |
| `FUNDAMENTAL_REVIEW` | Business performance or valuation evidence materially challenges the thesis | Reassess thesis; show evidence and scenarios |
| `CRITICAL_THESIS_REVIEW` | Verified material governance, solvency, fraud, or comparable event | Urgent human review; trend protection does not suppress it |
| `FULL_EXIT_CANDIDATE` | Evidence indicates the investment thesis may be invalidated or a validated exit policy is met | Present remaining position and consequences for explicit review |
| `PORTFOLIO_RISK_TRIM` | Position exceeds a configured concentration/risk limit | Calculate the minimum reduction needed to meet the selected target |
| `DATA_UNAVAILABLE` | Required data is stale, missing, contradictory, or unverifiable | Do not issue a normal-confidence recommendation |

These are advisory states, not orders. A verified critical event may escalate immediately; routine technical alerts should generally require persistence/confirmation.

### Rule-conflict policy

1. Verified critical risk overrides bullish technical trend protection.
2. Data quality gates confidence in any conclusion that depends on that data.
3. Technical-only warnings should not be described as fundamental thesis failure.
4. Valuation alone generally raises review priority rather than forcing a sale.
5. Portfolio concentration can justify a trim even when the business remains excellent.
6. Tax optimization never overrides a verified critical risk.
7. When evidence conflicts, explain the conflict and reduce confidence instead of hiding it in a composite score.

### Hysteresis and alert fatigue

- Use separate entry and clearing conditions so small fluctuations do not repeatedly change states.
- Deduplicate alerts by holding, issue, severity, and evidence version.
- Re-notify when severity increases or the recommended action changes materially.
- Use cooldowns for unchanged routine alerts, but allow critical escalation to bypass cooldown.
- Persist state and notification history; do not rely on in-memory timers alone.
- Do not send an alert simply because a scheduled job ran.
- Make the evaluation schedule configurable and use verified completed closing prices for routine end-of-day analysis.
- Fundamental filing ingestion may trigger an additional evaluation after the filing has been verified.

---

## 8. Sell quantity and portfolio risk

Never assign a fixed trim percentage to every stock or infer a quantity from a score alone.

### 8.1 Position and concentration trim

Let:

- `V_holding` = current holding market value.
- `V_equity` = defined total equity portfolio value.
- `w_target` = configured target weight.
- `P_reference` = latest valid reference price.

Then the excess value is:

`excess_value = max(0, V_holding - w_target × V_equity)`

A preliminary share estimate is:

`shares_to_sell = ceil(excess_value / P_reference)`

The implementation must then verify that the result does not exceed available shares, explain whether portfolio value includes cash and other assets, and show the estimated post-trim weight. Use a documented rounding policy. Where rounding up would over-trim materially, evaluate floor/nearest-share alternatives and show the resulting weight.

The target and ceiling are user-configurable examples, not universal recommendations. A trim may be inappropriate if the portfolio value or price is stale.

### 8.2 Technical or fundamental trim

Do not hard-code “sell 20–33%” or “sell 33–50%” as universally valid. Initial percentages can be configuration candidates for shadow testing, but must not become production defaults until evidence supports them.

A quantity recommendation should consider:

- State and severity.
- Evidence quality and confidence.
- Remaining shares and current exposure.
- Liquidity and expected slippage.
- The user’s configured holding/risk policy.
- Acquisition lots and estimated tax consequences.
- The risk of selling too early versus retaining exposure.

If there is no validated sizing rule for a case, show a scenario/range and explain the limitation rather than manufacture an exact answer.

### 8.3 Principal-recovery or “free ride” feature

Do not automatically sell just because a holding doubles. Principal recovery is an optional user preference, not an investment law.

Before taxes and costs, if a position doubles in value, selling half of the shares at the current price produces proceeds equal to the original invested amount. Actual net proceeds will differ because of fees, taxes, multiple acquisition lots, corporate actions, and price movement.

If implemented, calculate from the actual transaction ledger and explicitly label:
- original cash invested,
- current market value,
- gross proceeds,
- estimated costs and tax,
- estimated net proceeds,
- shares remaining,
- and remaining cost basis under the chosen accounting method.

Do not call the remaining position “risk-free” or imply that the original investment is economically guaranteed.

---

## 9. Indian tax estimate requirements

Tax estimates must be versioned and date-aware, not hard-coded as “365 days” for all time.

Requirements:

- Use transaction/transfer date, instrument type, acquisition date, acquisition lot, quantity, cost, corporate actions, and applicable rules.
- Implement FIFO where legally applicable and reconcile against the user’s actual records.
- Keep STCG/LTCG classification, rates, exemptions, surcharge, cess, and transaction charges in a versioned rules module.
- Support the applicable law for the transfer date; changes in law require reviewed updates and regression tests.
- Distinguish estimates from tax advice and show assumptions.
- Do not assume the full annual exemption is available to this trade; other gains and the taxpayer’s overall position may matter.
- Calculate estimated gross proceeds, charges, realized gain, estimated tax, and net proceeds separately.
- Do not delay a critical risk review merely to reach a tax holding-period milestone.
- If records are incomplete, mark the tax estimate as incomplete and do not show false precision.

**Release gate:** Have the tax calculation and effective-date rules reviewed against current official Indian tax guidance by a qualified professional before relying on them for actual transactions. This plan is not a tax opinion.

---

## 10. Backtesting and validation framework

Backtesting must be reproducible. Any existing figures about past positions, missed upside, profit giveback, or strategy performance are hypotheses until the underlying transactions, market data, corporate actions, and calculations can be rerun.

### 10.1 Required data

- Complete transaction ledger and actual holdings snapshots.
- Point-in-time price/volume history with documented corporate-action adjustment.
- Historical symbol mapping, delistings, mergers, splits, bonuses, dividends, and other relevant corporate actions.
- Historical fundamental observations with public availability/filing dates.
- Historical company universe where feasible, including delisted and failed companies to reduce survivorship bias.
- Historical transaction-cost/tax assumptions appropriate to each period.

### 10.2 Anti-bias rules

- **No look-ahead bias:** a result is not usable before it became public.
- **No survivorship bias:** do not test only today's surviving symbols.
- **No future-peak logic:** never use the eventual peak to decide what the engine “should” have done earlier.
- **No threshold overfitting:** avoid selecting settings based only on the same period used to report performance.
- **No inconsistent baselines:** compare strategies with consistent starting capital, deposits/withdrawals, position constraints, valuation dates, dividends, costs, and taxes.
- **Realistic execution:** apply a defined next-tradable-price convention, brokerage and statutory charges where applicable, spread/slippage, liquidity constraints, gaps, and circuit-limit scenarios.
- **Point-in-time revisions:** retain the version of financial data available at the time; later restatements must not rewrite historical knowledge.

### 10.3 Strategy comparisons

Compare at minimum:

1. Actual portfolio behavior.
2. Buy-and-hold benchmark for comparable holdings/cash flows.
3. Existing/simple policy baseline.
4. Candidate exit engine.
5. Sensitivity variants for thresholds and transaction costs.

Report both portfolio-level and trade-level results.

### 10.4 Metrics

- Total return and annualized return where meaningful.
- Maximum drawdown and drawdown duration.
- Realized and unrealized P&L, with consistent accounting.
- Turnover, trade count, taxes, and transaction costs.
- False-alert frequency and repeated-alert frequency.
- Proportion of exits followed by material further upside over defined horizons.
- Downside avoided after alerts, including adverse gaps.
- Re-entry frequency and re-entry cost.
- Performance by market regime, sector, market-cap/liquidity group, and state.
- Data coverage and the number of cases excluded for missing data.

“Missed upside” is a diagnostic, not proof that the sell was wrong; subsequent returns were unknowable at decision time. Similarly, a sell that avoids a drawdown is not automatically evidence that the policy is robust.

### 10.5 Validation splits

Use chronological training/validation/test partitions or rolling walk-forward testing. Dates must be selected after checking data availability; do not assume a calendar split is suitable if point-in-time data is missing. Keep the final test set untouched until the rules are frozen.

### 10.6 Acceptance criteria

Before enabling live notifications:
- Reproducible runs from documented inputs.
- No look-ahead leakage in tests.
- All baseline financial-invariance tests pass.
- Correct corporate-action handling on test fixtures.
- Deterministic sizing and tax calculations pass unit tests.
- Data-quality failures safely suppress or downgrade recommendations.
- False-alert, turnover, drawdown, and missed-upside reports are reviewed.
- Results are not presented as proven superiority unless supported by out-of-sample evidence.

No arbitrary performance target should be invented before the baseline is measured.

---

## 11. AI/agent boundaries

AI may:
- Summarize annual reports, quarterly disclosures, and management commentary.
- Extract candidate qualitative risks for human verification.
- Compare a new disclosure with previously stored thesis notes.
- Draft plain-language explanations using approved evidence.
- Help generate tests and documentation during development.

AI must not:
- Invent or silently fill missing financial values.
- Decide numerical thresholds without empirical validation.
- Calculate sell quantities, taxes, proceeds, indicators, or portfolio weights.
- Convert unverified news into a confirmed governance event.
- override the deterministic state machine.
- issue orders or write to the transaction ledger.
- claim certainty or guarantee future performance.

Every AI-generated factual statement shown in a dossier must reference its underlying document/snippet and clearly distinguish extracted fact, model interpretation, and unverified hypothesis. If source evidence is unavailable, the UI must say so.

---

## 12. Persistence and audit schema

Adapt to the actual database after repository inspection; do not blindly run schema changes from this document.

Suggested logical entities:

### `stock_intelligence_states`
Current state per holding: state, previous state, state-change time, rule version, data-quality status, evidence confidence, last evaluation time, and current recommendation reference.

### `stock_fundamental_snapshots`
Symbol/company identifier, metric values, units, reporting period, public filing date, ingestion time, consolidated/standalone basis, source reference, revision linkage, raw snapshot reference, and quality status.

### `stock_price_snapshots`
Symbol, timestamp, OHLCV, adjustment policy, provider/source, currency, and quality status.

### `stock_intelligence_evidence`
Evaluation ID, evidence type, measured value, baseline/comparison, source reference, event date, verification status, and human-readable interpretation.

### `stock_intelligence_recommendations`
State, suggested action, quantity or range, reference price/time, sizing method/version, estimated proceeds/cost/tax, assumptions, invalidation conditions, and disclaimer.

### `stock_intelligence_events`
Append-only history of state transitions, notification decisions, user acknowledgement, dismissal, and linked transaction if the user explicitly records one.

Use foreign keys and deletion behavior consistent with the existing app. Avoid cascading deletion of audit history without an intentional retention policy. Apply the database's normal authorization and row-level access controls. Store secrets only in the existing secret-management mechanism, never in source control.

---

## 13. API and UI integration

API names are provisional and must follow the existing application's conventions.

Possible read endpoints:
- `GET /api/intelligence/overview`
- `GET /api/intelligence/holdings/:holdingId`
- `GET /api/intelligence/alerts`
- `GET /api/intelligence/history/:holdingId`

Possible explicit user actions:
- Acknowledge/dismiss an alert.
- Open the existing transaction form with a suggested quantity and reference price.
- Record a trade only through the existing validated transaction workflow and only after user confirmation.

All write endpoints require existing authentication/authorization, input validation, idempotency where relevant, and audit logging.

### Indian stocks table

Add a compact health/exit state column without changing existing calculations. The state label must not be the only explanation; provide a tooltip or detail link and a data-freshness indicator.

### Holding dossier

Display:
- Current state and date/time evaluated.
- Technical evidence and relevant timeframe.
- Screener-based financial changes, period labels, and source links.
- Verified events and verification status.
- Data quality and confidence, separate from severity.
- Suggested action and quantity/range, with exact formula and assumptions.
- Reference price timestamp, estimated proceeds/cost/tax, and remaining shares.
- Main counterargument and conditions that would invalidate the recommendation.
- A visible statement that the stock may continue rising after a sale.
- A link to the signal history.

### Portfolio intelligence hub

Display:
- Holdings by state.
- Material alerts, sorted by severity and freshness.
- Concentration and exposure risks.
- Data-provider health and stale-data warnings.
- Historical recommendations and subsequent outcomes.
- Alert acknowledgement controls.

Follow the existing design system, accessibility standards, responsive behavior, and light/dark theme. Do not introduce a new design framework without a repository-level reason.

---

## 14. Notifications and scheduling

Initial mode should be in-app alerts and a daily digest. Additional channels can be added later.

- Routine technical evaluation: after the market close, using finalized/verified data and a configurable schedule.
- Fundamental evaluation: after a new filing is retrieved and verified.
- Critical verified event: promptly after reliable verification, subject to provider latency.
- Failed or stale data: report a data issue rather than a stock sell signal.
- Persist job status, last successful run, provider health, and evaluation version.
- Use idempotent jobs, retry with backoff, and prevent duplicate notifications.
- Never assume a fixed clock time guarantees that official data is available.

---

## 15. Security, resilience, backup, and recovery

- Reuse existing authentication, authorization, and secret handling.
- Validate all external data; treat retrieved text as untrusted input.
- Apply timeouts, retries with backoff, circuit breakers, and rate limits to providers.
- Keep provider failures isolated from core portfolio accounting.
- Ensure the intelligence feature can be disabled without disabling the portfolio app.
- Back up new persistent data and document restoration.
- Test restoration, not just backup creation.
- Provide a kill switch for alerts and a feature flag for rollout.
- Monitor scheduled-job failures, stale data, parsing changes, and abnormal output.
- Never allow a failed intelligence job to mutate financial records.

---

## 16. Testing strategy

### Unit tests
- Indicator formula and boundary cases.
- Weekly aggregation and incomplete bars.
- Fundamental deltas, units, and sector-specific applicability.
- Missing/stale/conflicting data.
- Share sizing, rounding, maximum available quantity, and zero/negative inputs.
- FIFO lot calculations and effective-date tax rules.
- State transitions, hysteresis, cooldowns, and escalation.
- AI output grounding/validation.

### Integration tests
- Provider normalization against saved fixtures.
- Filing-date availability and point-in-time replay.
- Persistence, authorization, and API contracts.
- Alert deduplication and scheduler idempotency.
- UI dossier source links and stale-data states.

### Regression/invariance tests
- Existing holdings and transaction records remain unchanged during evaluation.
- Existing realized/unrealized P&L and valuation outputs remain unchanged.
- Existing flows continue to work with the feature flag off and on.
- New migrations can be rolled back or restored using the documented recovery process.

### End-to-end tests
- A normal fluctuation produces no noisy sell alert.
- A technical warning enters and clears states according to policy.
- A verified critical event is not suppressed by a bullish trend.
- Missing data results in `DATA_UNAVAILABLE` or a confidence downgrade.
- A recommendation never creates a trade without explicit confirmation.
- A user-confirmed trade goes through the existing transaction validation path.

---

## 17. Revised implementation phases and gates

Timeline estimates should be made only after repository inspection. Quality gates take precedence over a fixed deadline.

### Phase 1 — Baseline and architecture
Deliverables: repository map, baseline test report, backup/restore evidence, ADR, feature flag, regression tests.

**Gate:** Existing behavior is documented and can be verified.

### Phase 2 — Data foundation
Deliverables: provider contracts, Screener access-compliance decision, symbol mapping, normalized data model, point-in-time snapshots, source freshness and failure handling.

**Gate:** Data provenance, permitted access, and missing-data behavior are tested.

### Phase 3 — Technical engine
Deliverables: documented indicator formulas, adjusted-price policy, weekly aggregation, volatility corridor, unit tests.

**Gate:** Calculations match independently checked fixtures.

### Phase 4 — Fundamental and event engine
Deliverables: sector-aware rules, filing-date logic, governance-event verification, revision history, evidence records.

**Gate:** No historical look-ahead; material warnings have traceable sources.

### Phase 5 — State machine and sizing
Deliverables: discrete states, conflict resolution, hysteresis, alert deduplication, portfolio risk sizing, lot-aware estimates.

**Gate:** Deterministic and boundary-tested outputs; no unsupported exact quantity.

### Phase 6 — Backtest and validation
Deliverables: reproducible dataset manifest, strategy comparisons, bias checks, costs/tax assumptions, walk-forward report.

**Gate:** Evidence is adequate to justify shadow testing; no claim of superiority from in-sample results alone.

### Phase 7 — UI and notifications
Deliverables: stock-table state, holding dossier, intelligence hub, audit history, daily digest.

**Gate:** Accessibility, regression, security, and usability checks pass.

### Phase 8 — Shadow mode and controlled release
Deliverables: live recommendations without trades, weekly false-alert review, missed-upside audit, provider health monitoring, release checklist.

**Gate:** The user reviews signal quality and accepts known limitations before enabling regular notifications.

---

## 18. Definition of done

The feature is not complete until all applicable items pass:

- [ ] Existing application behavior and financial outputs are unchanged.
- [ ] Feature can be disabled independently.
- [ ] Screener access method has been checked for current permissions.
- [ ] Every material fundamental fact has source and reporting-date metadata.
- [ ] Point-in-time backtesting prevents look-ahead leakage.
- [ ] Sector-specific metrics are used where needed.
- [ ] Stale/missing/conflicting data cannot silently produce a high-confidence sell recommendation.
- [ ] A single ordinary price drop does not force a sale.
- [ ] A verified critical fundamental/governance event is not suppressed by an uptrend.
- [ ] Quantity, costs, and tax assumptions are reproducible and displayed.
- [ ] Tax logic is versioned and reviewed against current official rules.
- [ ] Alerts are deduplicated and state changes are auditable.
- [ ] AI-generated explanations cite evidence and cannot change numerical outputs.
- [ ] No trade is recorded without explicit user confirmation.
- [ ] Unit, integration, regression, and end-to-end tests pass.
- [ ] Backup restoration and rollback have been tested.
- [ ] Backtest methodology and limitations are documented.
- [ ] Shadow-mode results have been reviewed before live use.

---

## 19. Important limitations and user-facing language

The UI should never say “the stock will fall” or “sell now to avoid a loss” as a certainty.

Preferred language:
- “Technical deterioration detected; consider reviewing the position.”
- “Fundamental warning: latest reported cash flow diverges from profit; verify the cited filing.”
- “Possible partial reduction under the configured policy; estimated quantity is based on the displayed price and portfolio weight.”
- “Data is incomplete; no high-confidence recommendation is available.”
- “This exit may reduce downside exposure, but the stock could recover or continue rising.”

The application is a personal decision-support tool, not a guarantee of returns or a substitute for independent judgement. Any broader distribution or commercialization requires a separate review of applicable Indian securities regulations and data licensing.

---

## 20. Final implementation instruction

Treat this file as the target specification, not permission to make broad changes immediately.

First inspect the repository, report conflicts between this plan and the actual codebase, and propose the smallest safe change set. Do not edit unrelated files. Do not replace existing accounting logic. Implement one phase at a time, run the required tests after each phase, and stop if a financial-invariance test fails.

**Success means better, quieter, auditable decisions—not more alerts, more trades, or a promise to sell at the top.**
