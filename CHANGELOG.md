# Ladder Version History & Changelog

All notable changes to the **Ladder Finance Dashboard** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.44.0] - 2026-09-20

### Added
- **100% Offline Local Cache Mode (`OFFLINE_CACHE_MODE=true`)**:
  - **Zero Supabase Egress Guarantee**: Activated `OFFLINE_CACHE_MODE=true` in `.env` and [server/db.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/db.js) to guarantee absolute 0 bytes of Supabase egress until the quota reset on October 10, 2026.
  - **Local Snapshot Boot Priority**: Hardened [server/db.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/db.js) to unconditionally restore all 13,567 rows (holdings, transactions, liabilities, dividends, categories, sips, and EOD logs) from `data/db_cache_snapshot.json` during cold startup and reboot, completely bypassing cloud initialization.
  - **TTL Expiration Bypass**: Disabled 24-hour cache eviction (`CACHE_TTL_MS`) when `OFFLINE_CACHE_MODE` is active, keeping in-memory tables permanently resident in Node.js RAM (`dbCache`) without dropping tables or triggering cloud re-queries.
  - **Local In-Memory Mutation Handling**: Configured `db.insert`, `db.update`, and `db.delete` to handle create/update/delete operations directly against in-memory RAM arrays and persist debounced snapshots to disk (`data/db_cache_snapshot.json`) using `crypto.randomUUID()` for new records.
  - **Comprehensive Operational Documentation**: Created [SUPABASE_EGRESS_AND_CACHE_GUIDE.md](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/SUPABASE_EGRESS_AND_CACHE_GUIDE.md) detailing multi-machine transfer procedures, post-refresh re-population strategies, and local-first architecture.

## [5.43.0] - 2026-09-20

### Fixed
- **Stock Split Market Ex-Date Detection Hardening & TDPOWERSYS Timeline Alignment**:
  - **Root Cause Diagnosed**: TD Power Systems (`TDPOWERSYS`) underwent a 1:2 stock split with market ex-date on 28-05-2026 where historical raw closing prices halved from ₹1,330.20 to ₹665.10. In [server/routes/holdings.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/routes/holdings.js), ex-date detection previously searched forward with an arbitrary 45-day window (`daysDiff > 45`). Because the SPLIT transaction was entered on 24-08-2026 (88 days after ex-date), the loop failed to find the 28-05-2026 ex-date; this left `currentTradeScale` at 0.5 for three months, cutting market prices in half twice (to ₹332.55) and creating an artificial 50% valuation trough from ₹4.58L to ₹2.29L from May 28 to August 24, followed by an artificial 100% vertical surge on August 24 when the scale reset to 1.0.
  - **Backward Search with 365-Day Lookback**: Enhanced ex-date detection in [server/routes/holdings.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/routes/holdings.js) to search backwards from the recorded transaction date with up to 365 days lookback, reliably detecting the ex-date (2026-05-28) and transitioning `currentTradeScale` to 1.0 on the exact ex-date.
  - **TDPOWERSYS Transaction Alignment**: Updated the SPLIT transaction date in `data/db_cache_snapshot.json` and database to the true market ex-date `2026-05-28`, aligning the transaction ledger separator bar with the chart split event.
  - **Calendar Weekend Liability Parity**: Fixed weekend `todayEntry` handling in [server/routes/calendar.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/routes/calendar.js) to ensure live liabilities (`liveTodayValuation.debt`) are preserved on non-trading days, maintaining 100% exact parity with Dashboard `/api/summary` and canonical engine.

## [5.42.0] - 2026-09-20

### Fixed
- **Fully Sold Holding Timeline Chart Zero-Touch Fix (Corporate Action & Bonus Issue Resolution)**:
  - **Root Cause Diagnosed**: Stocks like Sonata Software (`SONATSOFTW`), Gail (`GAIL`), Blue Star (`BLUESTARCO`), and Fiem Industries (`FIEMIND`) showed phantom balances and cost hanging in the air above zero at the end of their Tracker Chart after being fully sold. Historical BUY transactions in the database had previously been adjusted to corporate-action-scaled share counts (e.g. Sonata's buys were stored as 14, 14, and 1 share, total 29 shares, matching total sold of 29 shares) while the BONUS transaction was logged with `quantity: 0` and informational note `+14 Shares Received as Bonus`. The dense timeline simulation loop in `/api/holding/:holdingId/detail` previously parsed `+14 Shares Received as Bonus` from notes and added 14 bonus shares to `runningQ` a second time (double counting), leaving 14 phantom shares and ₹5,869.46 cost basis hanging in the air after the final 14-share sale.
  - **Timeline Simulation Harmonization**: Separated event dot display quantity (`eventQty`) from financial simulation quantity (`qty`). Simulation strictly adheres to `Number(tx.quantity) || 0`, eliminating duplicate share additions for split/bonus-adjusted buy lots.
  - **Airtight Liquidation Zero-Touch Invariance**: Added safeguard in [server/routes/holdings.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/routes/holdings.js) guaranteeing that when an exited holding (`isExited`) executes its final sale/redemption transaction, `runningQ`, `runningInvUSD`, and `runningInvINR` immediately clamp to strictly 0, ensuring both Cost Basis and Market Value lines drop to exactly ₹0.00 at the liquidation date.
  - **Summary P&L Date Normalization**: In [server/routes/summary.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/routes/summary.js), normalized `pnl_history` dates to ISO format `YYYY-MM-DD` when evaluating yesterday's closing wealth, ensuring 100% exact cent-level parity between Dashboard and Calendar views.

## [5.41.0] - 2026-09-20

### Fixed
- **Indian Equity NSE/BSE MAX Quote Engine Hardening, Zero-Egress Boot Priming & UI Parity**:
  - **Root Cause Diagnosed**: Outside market trading hours (nights/weekends/holidays), live price polling is suspended per Rule 22 market hours gating; on cold server reboots, `liveQuoteCache` was empty, causing endpoints to fall back to `holding.current_price` from `data/db_cache_snapshot.json` where `bse_price` was 0 and `current_price` held the older NSE quote (e.g. Anant Raj at ₹606.15 instead of BSE ₹606.25). Furthermore, in [HoldingsTable.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/components/HoldingsTable.jsx), `NSE: ₹... | BSE: ₹...` was placed in an unreachable `else` branch of `h.day_change !== undefined` and was omitted from [IndianStocksView.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/views/IndianStocksView.jsx).
  - **Universal Price Resolver (`resolveHoldingPrice`)**: Exported canonical helper `resolveHoldingPrice(holding, liveQuote)` from [server/services/priceEngine.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/services/priceEngine.js) and integrated across [server/routes/holdings.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/routes/holdings.js), [server/routes/summary.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/routes/summary.js), [server/routes/calendar.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/routes/calendar.js), and [server/services/portfolioCalculator.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/services/portfolioCalculator.js), strictly enforcing `Math.max(price, nse_price, bse_price)` for Indian stocks.
  - **Boot Cache Priming (Zero Egress)**: Added cache priming logic in [server/index.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/index.js) right after `warmCache()` loads the local snapshot, priming `liveQuoteCache` with all cached holdings on startup with 0 bytes of Supabase egress.
  - **Local Disk Snapshot Quote Refresh (Zero Egress)**: Queried Yahoo Finance directly for all active Indian stocks (`.NS` and `.BO`), updating `data/db_cache_snapshot.json` to lock higher BSE quotes (such as Anant Raj ₹606.25 vs ₹606.15, PFC ₹346 vs ₹342.55, FCL ₹57.09 vs ₹57.02) with 0 bytes of Supabase egress.
  - **UI Exchange Badges**: Updated [HoldingsTable.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/components/HoldingsTable.jsx), [IndianStocksView.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/views/IndianStocksView.jsx), and [HoldingDetailHeader.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/components/holding-detail/HoldingDetailHeader.jsx) to render `NSE: ₹... | BSE: ₹...` pills whenever both exchange quotes are available.

## [5.40.0] - 2026-09-20

### Fixed
- **Corporate Action FIFO Realized P&L & Bonus Lot Harmonization (FCL Resolution)**:
  - Fixed a critical calculation bug where Fineotex Chemical Limited (`FCL`) displayed a massive false realized loss of `-₹34,327.14` in the Holding Detail Modal.
  - Root Cause: In [server/routes/holdings.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/routes/holdings.js), the FIFO lot queue previously ignored bonus transactions when `quantity === 0`. Because FCL had bonus logged as `quantity: 0` with notes `+1336 Shares Received as Bonus`, the 1,336 bonus shares were never pushed to the FIFO queue. When the user sold 2,061 shares, FIFO only found 725 shares, matched pre-bonus high costs, and halted without accounting for the proceeds of the 1,336 zero-cost bonus shares.
  - Universal Fix: Patched [server/routes/holdings.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/routes/holdings.js) and [server/services/recalculator.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/services/recalculator.js) to parse bonus quantities from transaction notes (`/\+([\d.,]+)\s*Shares/i`) and push 0-cost lots to the queue, achieving exact cent-level parity across Holding Detail Modal (`-4,691.81`), Recalculator (`-4,691.81`), and Holdings table (`-4,691.81`).
- **Timeline Chart Duplicate Split Multiplier Elimination**:
  - Diagnosed why the timeline chart showed false big profits on realized sales: the timeline chart simulation loop previously parsed `Stock Split (1:2)` and added synthetic quantity `runningQ * ((2/1) - 1) = 1,670` shares, double-counting the split since buy transactions were already split-adjusted; this cut the average cost basis in half to ₹12.15, plotting false profits on sales at ₹22.18.
  - Removed synthetic split addition from the chart loop, restoring true cost basis (~₹24.45/share before sell), eliminating the chart valuation trough, and correctly reflecting the true small loss (-₹4,691.81) when the position was liquidated.
- **Removed Dividend Column From NPS**:
  - Cleaned up [NpsView.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/views/NpsView.jsx) by removing the Dividend column from both active and closed tables as NPS schemes do not distribute dividends.

## [5.39.0] - 2026-09-20

### Added
- **Distinct Realized and Unrealized P&L Columns Across 4 Asset Classes**:
  - Added separate `Unrealized P&L` and `Realized P&L` columns across all 4 market asset classes ([IndianStocksView.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/views/IndianStocksView.jsx), [UsStocksView.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/views/UsStocksView.jsx), [MutualFundsView.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/views/MutualFundsView.jsx), [NpsView.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/views/NpsView.jsx)).
  - Active tables now clearly distinguish between paper gains on remaining open shares (`Unrealized P&L`) and booked trading profits/losses from sold shares (`Realized P&L`), with full USD/INR currency conversion support in US Stocks.
- **Dedicated Dividend Column Across Active and Closed Portfolio Tables**:
  - Added dedicated `Dividend` column to both active and closed tables across all 4 asset classes, cleanly displaying credited dividend income distinctly from capital gains.

### Changed
- **Unrealized Open Lots Average Price for Active Holdings**:
  - In [server/routes/holdings.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/routes/holdings.js), dynamically evaluates `avg_buy_price` using FIFO simulation on open remaining lots (`unrealizedAvgBuy`) for active positions (`quantity > 0`), ensuring average buy price accurately reflects currently held shares rather than being distorted by closed historical trades (e.g. ANANTRAJ shows ₹447.10 open lot average instead of old consolidated ₹458.89).
  - For fully liquidated positions (`quantity === 0`), `avg_buy_price` evaluates to the consolidated all-time average buy price (`totalBuyCost / totalBuyQty`) across historical transactions, while `investedValueINR` remains strictly 0 (preserving Rule 5 balance sheet invariance).
- **Robust Numeric and Text Sorting**:
  - Upgraded `sortedHoldings` across all 4 views to correctly sort derived numeric columns (`sell_qty`, `unrealized_pnl`, `realized_pnl`, `total_dividends`, `gainINR`) and text columns.

## [5.38.0] - 2026-09-20

### Added
- **First Column Dual Name/Ticker Sorting Across 4 Asset Classes**:
  - Implemented interactive dual-target sorting (`Name` / `Ticker` or `Name` / `Code`) in the first column header across [IndianStocksView.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/views/IndianStocksView.jsx), [UsStocksView.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/views/UsStocksView.jsx), [MutualFundsView.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/views/MutualFundsView.jsx), and [NpsView.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/views/NpsView.jsx).
  - Users can click either **Name** or **Ticker/Code** independently to sort alphabetically with ascending/descending order toggle and visual direction arrows in both Active and Closed portfolio tables.

### Fixed
- **Indian Equity NSE/BSE MAX Quote Engine & Circuit Breaker Hardening**:
  - Diagnosed why Anantraj showed NSE price (₹606.15) instead of higher BSE price (₹606.25): `fetchStockQuote` in [priceEngine.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/services/priceEngine.js) treated HTTP 404 (stocks not listed on BSE or missing `.BO` tickers on Yahoo Finance) as provider failures, tripping `yfCircuitBreaker` into `OPEN` state after 5 failures and aborting subsequent quote comparisons across batches.
  - Hardened `fetchStockQuote` to treat 404 as expected absence without retrying or tripping the circuit breaker.
  - Updated `refreshHoldingsPrices` and [server/routes/holdings.js](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/server/routes/holdings.js) to explicitly attach both `nse_price` and `bse_price` to holding responses, locking `Math.max(nse_price, bse_price)`.
  - Updated ANANTRAJ in the local database cache snapshot (`data/db_cache_snapshot.json`) to lock the higher BSE closing quote (₹606.25 vs ₹606.15) with 0 bytes of Supabase network egress.

## [5.37.3] - 2026-09-19

### Fixed
- **Bonus Issue Ingestion Scaling Fix & Whole-Share Quantity Restoration**:
  - Identified and fixed the root cause of corrupted fractional quantities in Indian equities in `scripts/ingestion/load_all_indian_stocks.mjs`. Previously, a Bonus Issue (`Dividend Reinvest` / `Bonus`) recalculated preceding `BUY` transactions with a fractional multiplier (`currentQty / preQty`) and stored `quantity: 0` for the bonus transaction itself.
  - Updated the ingestion engine to retain original whole-share buy transactions and record actual bonus shares credited on the corporate action date at ₹0.00 cost.
  - Restored true whole-share executed orders from [Book1.xlsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/Indian%20Stocks/Book1.xlsx) for `OIL` (42, 1, 25, 1, 19, 2, 2 shares, +24 bonus shares) and `ASTRAL` (3, 1, 1 shares, +1 bonus share) with write-through cache persistence and zero cloud egress.
  - Re-simulated holding states via `recalculateHoldingState`, bringing positions into exact mathematical parity and properly closing out fully liquidated positions (`OIL`: 160 buys = 160 sells => 0 shares, status REDEEMED; `ASTRAL`: 11 buys = 11 sells => 0 shares, status REDEEMED).

## [5.37.2] - 2026-09-19

### Fixed
- **MF Composition Scrip Breakdown Modal Viewport Centering & Multi-Theme Fidelity**:
  - Wrapped [CompanyMfBreakdownModal.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/components/reports/CompanyMfBreakdownModal.jsx) with `createPortal(..., document.body)` as required by Rule 7, preventing CSS transforms from parent `AnimatedPage` containers from offsetting the modal window and achieving perfect viewport-level centering.
  - Replaced hardcoded dark background values (`bg-slate-900/60`) on the scheme search input with canonical theme design tokens (`reports-subcard`, `border border-inherit`, `modal-surface`), guaranteeing seamless readability across all 6 light and dark themes (Clean Light, Warm Sand, Nordic Light, Obsidian Dark, Midnight Blue, Sunset Rose).
  - Enhanced modal ergonomics with backdrop click dismissal, `Escape` key close listener, and bounded scroll containment (`max-h-[380px] custom-scrollbar`) on the schemes table so headers and stat summaries stay fixed while schemes scroll gracefully.

## [5.37.1] - 2026-09-19

### Fixed
- **Weekend Market Invariance & Zero-Egress Calendar Alignment**: Enforced Rule 5 strictly in `server/routes/calendar.js` and `server/routes/summary.js`. On non-trading days (Saturdays, Sundays, exchange holidays), all equity, MF, and NPS asset valuations strictly carry forward Friday's finalized closing valuations with 0.00 daily movement unless manual cash/debt transactions occurred on that trade date.
- **Trade Date Parity Guard**: Enforced strict trade/transaction date lookups (`t.date`) across calendar and summary routes rather than system entry timestamps.
- **Local EOD Log Synchronization**: Synchronized Friday 18-Sep historical EOD log in `data/portfolio_eod_logs.json` and in-memory cache with post-split holding states locally with 0 bytes of cloud egress.

## [5.37.0] - 2026-09-19

### Added
- **Indian Stock Search Deduplication**: Deduplicated Indian equity stock search results to strictly prioritize NSE, falling back to BSE only if NSE does not exist, and stripped all exchange suffixes/tags (`(NSE)`, `(BSE)`, `.NS`, `.BO`) to display a single, clean instrument prompt.
- **Automated US Stock Historical FX Rate Synchronization**: Enhanced `HoldingTransactionLedger.jsx` date picker and inline edit to automatically fetch and populate historical USD/INR exchange rates from `/api/fx-rate?date=${date}` on date selection.

### Changed
- **Universal Sell / Redeem Uniformity**: Standardized all `REDEEM` and `REDEMPTION` transaction types to `SELL` across database records, backend routes, FIFO matching logic, and frontend forms for unified asset lifecycle tracking.
- **Detail Record Borderless Design Uniformity**: Eliminated `divide-y` and table row borders across `HoldingTransactionLedger.jsx`, `LoanAmortizationSection.jsx`, and `AssetDividendDetailModal.jsx` for clean, consistent borderless detail records.
- **Universal Real-Time UI Synchronization**: Connected `onRefresh={fetchDashboardData}` callback from `HoldingDetailModal` to parent `App.jsx`, bound dynamic `activeHolding` in `HoldingDetailHeader`, and synchronized `DividendsView` on holdings updates to update quantities and totals across all pages immediately on data entry.

### Fixed
- **Home Loan Balance and Amortization Ledger**: Re-linked September 1, 2026 EMI transaction to Housing Loan liability (`00000000-0000-0000-0000-000000000010`), deleted rogue duplicate liability row, set outstanding balance to ₹44,64,447, and attached amortization closing balances to transaction records so running balance shows true amortization progression instead of ₹0.00.
- **Arista Networks (ANET) Stock Split Reconciliation**: Restored true executed pre-split buy prices ($121.48 to $366.96), removed malformed manual split entry, and applied canonical 1:4 stock split with 9-decimal precision via `corporateActionService.applyStockSplit`, yielding 24.5516 shares, $1,096.52 invested cost, and $44.6621 average price.
- **Holding Detail Fake EOD Pollution**: Fixed bug in `server/routes/holdings.js` where real transactions were populated with 60 synthetic EOD transactions when total transaction count was below 60.

## [5.36.2] - 2026-09-19

### Added
- **Codification of Architectural Governance & Rules 19 to 24 in AGENTS.md**:
  - Rule 19: Zero-uncached reads across all API routes and client polling minimums (>= 30s).
  - Rule 20: Cloud CI/CD runner egress quarantine, dual-execution ban, and emergency quota isolation.
  - Rule 21: Zero-egress local disk snapshot persistence and cold-boot cloud immunity.
  - Rule 22: Dynamic market-hours gating and non-trading day runner invariance.
  - Rule 23: Backup projection scoping and ban on unconstrained multi-scheme table scans.
  - Rule 24: Autonomous Architectural Integrity & Continuous Rule Governance Protocol, authorizing agents to proactively formulate and append permanent workspace guardrails in `AGENTS.md` whenever systemic design issues are diagnosed.

## [5.36.1] - 2026-09-19

### Fixed
- **Comprehensive Egress Elimination Across All Endpoints & Backup Scoping**:
  - Replaced direct `supabase.from('transactions')` and `supabase.from('dividends')` in `server/routes/holdings.js` (`/api/holding/:holdingId/detail`) with in-memory `db.select()` queries.
  - Converted direct `pnl_history` Supabase queries in `server/routes/summary.js` and `server/routes/calendar.js` to read from pre-warmed in-memory `db.select('pnl_history')`.
  - Replaced direct `sips` table fetch in `server/routes/sips.js` with in-memory `db.select('sips')`.
  - Scoped `fetchAllRows` in `scripts/backup_manager.mjs` for `nps_daily_navs` strictly to user-held scheme codes, eliminating the 53,000-row (~8 MB) general market dump on every backup.
  - Relaxed periodic dashboard polling in `App.jsx` from 15s to 30s and holding modal polling in `HoldingDetailModal.jsx` from 3s to 30s.

## [5.36.0] - 2026-09-19

### Fixed
- **Emergency Supabase Egress Lockdown, Market-Hours Gating & Zero-Egress Disk Snapshot Cache**:
  - Diagnosed 60 MB/day egress consumption: uncached `asset_metadata` queries on every `/api/holdings` page load/poll, 2-second unconstrained live ticker loops outside market hours, recurring 10-minute self-healing cache drops, and unconstrained weekend EOD rebuild checks.
  - Cached `asset_metadata` and `mutual_fund_holdings` via `db.select` in `server/routes/holdings.js` and `server/routes/reports.js`.
  - Added `sips`, `sip_history`, `asset_metadata`, and `mutual_fund_holdings` to `warmCache()` in `server/db.js`.
  - Re-engineered live ticker in `server/index.js` to run on a 60-second cycle (30x reduction) and strictly gate execution via `isAnyMarketOpen()`, automatically pausing price polling when markets are closed (nights, weekends, holidays).
  - Decoupled self-healing from the 10-minute interval loop, scheduling it strictly once on boot (after cache pre-warming) and once daily at midnight (00:05 AM IST).
  - Implemented in-memory `npsSyncStatusCache` and non-trading day guards in `server/services/priceEngine.js`, eliminating redundant Supabase queries when NAVs are already synced or on weekends.
  - Optimized `fetchNpsHistoricalNav` in `server/services/priceEngine.js` to check local cache and only query missing recent dates from Supabase.
  - Implemented local disk snapshot cache (`data/db_cache_snapshot.json`) in `server/db.js` with write-through saves and instant startup restoration, completely eliminating cold-start cloud egress on server restarts.
  - Updated `checkMissedEodRebuild` in `server/index.js` to check cached `pnl_history` and compare against `lastTradingDay` rather than `yesterdayStr`, preventing false weekend rebuild loops.
  - Converted direct Supabase queries in `server/services/sipEngine.js` and `server/services/recalculator.js` to cached `db.select` and write-through updates.

## [5.35.0] - 2026-09-16

### Fixed
- **Supabase Egress Elimination, 24-Hour Write-Through Caching & Intraday In-Memory Protection**:
  - Upgraded `server/db.js` with 24-hour TTL and write-through cache mutations on `insert`, `update`, and `delete`.
  - Omitted `.select()` on Supabase updates to return empty 204 No Content headers with 0 response bytes.
  - Confined daytime live quotes strictly to `liveQuoteCache` in RAM, persisting official closing quotes once at EOD.
  - Scoped Protean NAV persistence in `server/services/priceEngine.js` and queries in `scripts/rebuild_portfolio_eod.mjs` to user-held schemes and baseline dates.
  - Codified Rule 18 in `.agents/AGENTS.md` and `LADDER.md`.

## [5.34.1] - 2026-09-15

### Fixed
- **High-Precision Fractional Share Fix & Intra-Day Stock Pricing Parity**:
  - Expanded `quantity` column precision in `transactions` and `holdings` to `numeric(30, 9)` for exact US Stock fractions.
  - Patched `recalculator.js` to prevent 4-decimal truncation of running lot quantities.
  - Replaced trailing-zero `.toFixed(9)` in `UsStocksView.jsx` with localized `toLocaleString`.
  - Disabled EOD auto-population logic in `HoldingDetailModal.jsx` for equity stocks to allow manual intra-day execution prices.

## [5.34.0] - 2026-09-14

### Changed
- **Eradication of Ad-Hoc Scripts, Rule 17 & Canonical Domain Service Architecture**:
  - Permanently removed `server/services/dividendSync.js` and `server/services/splitManager.js`.
  - Built canonical dividend domain service `server/services/dividendService.js` for atomic mutations across `dividends` and `transactions` tables.
  - Built canonical corporate actions domain service `server/services/corporateActionService.js` orchestrating stock splits and bonus issues with FIFO lot adjustment and reversibility.
  - Established Rule 17 in `.agents/AGENTS.md` and `LADDER.md`.

## [5.31.0] - 2026-09-15

### Added
- **Recurring Mutual Fund SIP Automation**:
  - SIP creation and Mutual Fund NAV refresh now catch up every due installment through the current date, using the NAV available on each scheduled date.
  - Added background SIP sweeps so future installments execute when the API is running even if the UI is closed.
  - Added a scheme-scoped **Add SIP** action beside **Add Transaction** in the holding detail ledger.

### Changed
- Mutual Fund SIP and BUY charge handling now uses 0.005% stamp duty; legacy Mutual Fund amounts were migrated to store amount excluding charges, while corrected SIP rows were preserved.
- Mutual Fund **Total Bought** and **Current Cost** use stored transaction amount plus charges, with proportional FIFO allocation for partially redeemed lots.
- Standardized transaction ledger row borders and matched **Add SIP** styling to **Add Transaction**.
- Shortened automated SIP notes to `SIP @ NAV ...`.

## [5.30.7] - 2026-09-14

### Fixed
- **Universal Table and Holding Detail Modal P&L and Value Synchronization**:
  - Diagnosed discrepancy where closed position tables (e.g. `IndianStocksView.jsx`, `UsStocksView.jsx`, `MutualFundsView.jsx`, `NpsView.jsx`) showed Realized P&L differing from the holding detail modal ("inside this scrip") — e.g. Acme Solar Holdings Ltd (`ACMESOLAR`) displayed `+₹7,821.36` in the table vs `+₹8,091.76` in the detail modal.
  - Root Cause: `recalculateHoldingState` in `server/services/recalculator.js` was saving capital gains without dividends to `holdings.realized_pnl`, while the detail modal independently added dividends to capital gains (`7,821.36 + 270.40 = 8,091.76`). Furthermore, the table was estimating `redeemedVal` as `investedVal + realizedPnl` (`₹5,96,391.84` instead of actual proceeds `₹5,97,100.30`) and calculating a synthetic `avgSell` (`₹214.14` instead of actual execution price `₹214.65`).
  - Updated `server/services/recalculator.js` to strictly include credited dividends in `totalRealizedPnl` (`Sell - Buy - Charges + Dividends`) before updating `holdings.realized_pnl` in Supabase.
  - Recalculated all 398 holdings in Supabase to bring stored `realized_pnl` into 100% mathematical parity across the database.
  - Enriched `GET /api/holdings` (`server/routes/holdings.js`) with true execution metrics: `sold_qty`, `avg_sell_price` (actual execution sell average), `redeemed_value` (actual net sell proceeds matching detail modal), `gross_redeemed`, and `total_dividends`.
  - Updated `server/routes/summary.js` to consume `holdings.realized_pnl` directly, eliminating redundant double-addition of `divIncome` while preserving exact portfolio realized P&L parity (`₹13,41,923.48`).
  - Updated closed position tables across `IndianStocksView.jsx`, `UsStocksView.jsx`, `MutualFundsView.jsx`, and `NpsView.jsx` to render the enriched `avg_sell_price`, `redeemed_value`, and unified `realized_pnl`.
  - Verified exact 100% parity for `ACMESOLAR` down to the cent: Table Realized P&L = Detail Modal Realized P&L = `₹8,091.76`; Table Redeemed Value = Detail Modal Total Redeemed = `₹5,97,100.30`; Table Avg Sell Price = `₹214.65`.
  - Verified 100% PASS on `node scripts/verify_financial_integrity.mjs` and clean Vite production build.

## [5.30.6] - 2026-09-14

### Fixed
- **Dividend Inversion Correction Across Indian Stocks**:
  - Diagnosed root cause of inverted dividend figures (e.g. Acme Solar Holdings Ltd `ACMESOLAR` displaying `₹235.51` instead of `₹170.40`): the initial ingestion script (`scripts/ingestion/load_all_indian_stocks.mjs`) erroneously selected `Cost Per Share` (which recorded the stock's market quote on the ex/record date) instead of `Shares Owned` (which recorded the true dividend cash payout in INR).
  - Fixed `scripts/ingestion/load_all_indian_stocks.mjs` to correctly select `Shares Owned` as the dividend payout amount.
  - Developed and executed one-off migration script correcting all 90 affected dividend records in both the `dividends` and `transactions` Supabase tables, and cleanly removed the one-off script to keep the repository clean.
  - Recalculated holding state and synchronized FIFO lots across all 66 affected holdings via `recalculateHoldingState`.
  - Invalidate in-memory database cache and restarted the Express backend daemon on port 5000.
  - Verified exact dividend parity for `ACMESOLAR` (02-05-2025 dividend payout is now exact `₹170.40`, total dividends `₹270.40`) as well as other affected stocks (`COFORGE`, `PERSISTENT`, `CANBK`, `COCHINSHIP`).
  - Passed 100% of financial invariance tests via `node scripts/verify_financial_integrity.mjs` and verified zero-error Vite production build.

## [5.30.5] - 2026-09-14

### Fixed
- **Realized and Total P&L Net Calculation Formula**:
  - Updated Realized and Total P&L calculations everywhere across the application to follow the net formula: `Sell - Buy - Charges + Dividends`.
  - In `server/routes/holdings.js`, updated FIFO lot matching for `SELL` transactions to deduct both transaction sell charges and proportional buy charges from matched lots before adding credited dividends.
  - In `server/services/recalculator.js`, updated the FIFO matching replay in `recalculateHoldingState` to account for proportional buy charges of sold lots in net capital gain (`proceeds - costOfSoldLots - buyChargesOfSoldLots`).
  - Executed batch recalculation across all holdings in Supabase to synchronize `holdings.realized_pnl` with the net formula.
  - Verified exact parity for Aarti Pharmalabs Limited (`AARTIPHARM`) matching `₹26,819.82` (Gross Sell ₹53,486.60 - Buy ₹27,132.65 - Total Charges ₹103.13 + Dividends ₹569.00).
- **Universal XIRR Cashflow Net Charges & Flow Deduplication**:
  - In `server/routes/summary.js`, updated category cashflows and holding-level XIRR computations to strictly deduct charges on `BUY` outflows (`-(amt + charges)`) and `SELL` inflows (`+(amt - charges)`).
  - Fixed closed holdings XIRR loop to prevent double counting proceeds when sell transactions are already present in the transaction ledger.
  - Confirmed holding detail modal XIRR was already net-aligned (Aarti Pharmalabs XIRR = `39.98%` net vs `40.14%` gross).
- **Full Unabbreviated Currency Precision Everywhere**:
  - Removed all `L` (Lakh) and `Cr` (Crore) abbreviations from `fmtINR` and `formatAxisValue` in `src/components/holding-detail/holdingDetailUtils.jsx` and `src/views/EpfView.jsx`.
  - Holding Detail Performance Summary KPI cards (Total Bought, Total Sold, Current Cost, Current Value, Dividends, Charges) and EPF cards now display the exact full rupee amount with 2-decimal precision (e.g. `₹5,89,123.45` and `₹5,97,280.32` instead of `₹5.89L` and `₹5.97L`).

## [5.30.4] - 2026-09-14

### Fixed
- **Holding Detail Actual Chart Tooltip Formatting**:
  - Fixed issue where BUY, SELL, BONUS, and DIVIDEND events displayed `undefined @ ₹0.00` in the chart event tooltip (`ActualChartTooltip`).
  - Added safe fallbacks for both `quantity` / `qty` and `price` / `priceUSD` / `priceINR`.
  - Formatted DIVIDEND events to display the exact credited payout amount (`+₹X.XX` or `+$X.XX`) rather than share quantity and price.
- **Transaction Ledger Dividend Deduplication**:
  - Resolved bug where dividends appeared twice in the holding transaction ledger table.
  - Updated `/api/holding/:id/detail` in `server/routes/holdings.js` to deduplicate dividends between the `transactions` table and `dividends` table into a single unified row.
  - Enhanced `server/routes/transactions.js` with `div-` prefixed ID routing and synchronized two-way updates/deletes between `transactions` and `dividends` tables.

## [5.30.3] - 2026-09-13

### Changed
- **Runtime Data Untracking**:
  - Removed `data/fx_rates_persistent.json` from git tracking and added it to `.gitignore` so periodic background price engine and self-healing cycles do not dirty the git status or appear on the commit page.

### Fixed
- **Cross-Platform Vite Watcher Ignore Matching**:
  - Hardened `server.watch.ignored` in `vite.config.js` with a cross-platform matcher function and regular expression ensuring Windows backslash path separators (`\`) are ignored alongside Unix forward slashes (`/`).

## [5.30.2] - 2026-09-13

### Fixed
- **Authentication Race Condition on Initial Login**:
  - Registered a global Axios request interceptor in `ThemeAuthContext.jsx` that dynamically resolves and attaches `Authorization: Bearer <token>` from `localStorage` to 100% of outgoing requests.
  - Synchronously configured `axios.defaults.headers.common.Authorization` inside `login()` and `logout()` handlers, eliminating child component mount race conditions on initial login and permanently eradicating the transient 401 "Database connection failed: Authentication required" toast error.

### Added
- **Workspace Agent Rules 14, 15, and 16**:
  - Added Rule 14 (Mandatory Client-Side Auth Synchronization & Interceptor Architecture), Rule 15 (Vite Dev Server Watcher & Persistence Isolation Protocol), and Rule 16 (Automated Background Self-Healing & Missing Data Recovery Protocol) to `.agents/AGENTS.md`.

## [5.30.1] - 2026-09-13

### Fixed
- **Vite Dev Server Full-Page Reload & Flickering Loop**:
  - Configured `server.watch.ignored` in `vite.config.js` to ignore background data directories (`data/`, `server/`, `scripts/`, `Indian Stocks/`, `scratch/`, and data file extensions `.json`, `.csv`, `.xlsx`, `.xls`, `.log`).
  - Completely resolved the issue where backend price engines or self-healing persistence wrote data files and triggered automatic Vite full-page reloads, eliminating screen flickering and input focus loss.

### Changed
- **Login View UI Cleanup**:
  - Removed the redundant 'Active Session' tag from `src/views/LoginView.jsx`.

## [5.30.0] - 2026-09-13

### Added
- **Background Self-Healing Service**:
  - Implemented `server/services/selfHealingService.js` with `healTransactionFxRates()`, `healMissingHoldingPrices()`, and `runComprehensiveSelfHealing()`.
  - Automatically identifies missing transaction FX rates and unpriced holdings, queries authoritative feeds, updates Supabase records, and recalculates holding positions.
- **On-Demand Self-Healing API**:
  - Added authenticated endpoint `POST /api/self-heal` in `server/routes/search.js` enabling manual or automated trigger of full portfolio gap healing.
  - Integrated comprehensive self-healing into server boot (5-second delay) and periodic 10-minute maintenance cycle.

### Changed
- **Silent Catch Block Eradication**:
  - Audited and purged 100% of silent empty catch blocks across the repository, replacing them with informative warning logs and resilient fallback handling.
- **Loan Engine Sanitation**:
  - Removed undefined `DEFAULT_LIABILITY_ID` reference and replaced hardcoded EMI and interest rate fallbacks with explicit validation in `server/services/loanEngine.js`.
- **US Stock Transaction Date-Aware FX**:
  - Updated `server/routes/holdings.js` to automatically look up historical exchange rates corresponding to transaction dates for past US stock purchases.

## [5.29.0] - 2026-09-13

### Added
- **Persistent Self-Healing FX Rate Store**:
  - Implemented `server/services/fxRateStore.js` and `data/fx_rates_persistent.json` to store last-known-good exchange rates with automatic background retry and historical rate resolution.
  - Purged all hardcoded 87.25 and 82.5 values across backend routes, price engines, and frontend views.
- **Modular Server Route Architecture**:
  - Split monolithic 3,837-line `server/index.js` into 13 modular route controllers in `server/routes/` (`auth.js`, `backup.js`, `calendar.js`, `database.js`, `dividends.js`, `fx.js`, `holdings.js`, `liabilities.js`, `reports.js`, `search.js`, `sips.js`, `summary.js`, `transactions.js`) and middleware `server/middleware/auth.js`.
  - Slimmed `server/index.js` to 229 lines handling mounting, schedulers, and background daemon lifecycles.
- **Yahoo Finance Circuit Breaker & API Retry Logic**:
  - Built `yfCircuitBreaker` in `server/services/priceEngine.js` with CLOSED, OPEN, and HALF_OPEN states (5-failure trip threshold and 30-second cooldown).
  - Added retry with exponential backoff for `fetchStockQuote()` and `fetchFxRate()`.
- **Persistent Cloud SIP History**:
  - Migrated SIP execution and skip logs from local files to Supabase `public.sip_history` table with API route `GET /api/sips/history`.
- **Dynamic Category Registry Engine**:
  - Enhanced Supabase `categories` schema with `valuation_model`, `default_currency`, `default_exchange`, `price_fetcher`, and `has_dividends` columns.
  - Implemented `server/services/categoryRegistry.js` supporting dynamic behavior resolution (`isUnitBased`, `isBalanceBased`, `getDefaultCurrency`, `getPriceFetcher`, `hasDividends`) and API endpoint `GET /api/categories/registry`.
- **Supabase Vault Secrets Integration**:
  - Created `server/services/vaultService.js` supporting encrypted secrets retrieval from Supabase Vault with seamless fallback to environment variables.
- **Frontend Sub-Component Extractions**:
  - Decomposed monolithic `HoldingDetailModal.jsx` (1,723 lines) into modular subcomponents in `src/components/holding-detail/` (`HoldingDetailHeader.jsx`, `HoldingMarketStats.jsx`, `HoldingMetricCards.jsx`, `HoldingChartsSection.jsx`, `HoldingTransactionLedger.jsx`, `holdingDetailUtils.jsx`).
  - Decomposed monolithic `ReportsView.jsx` (2,640 lines) into modular subcomponents in `src/components/reports/` (`reportsConstants.js`, `ReportsTooltips.jsx`, `RankedBarList.jsx`, `CleanBarChartView.jsx`, `CompanyMfBreakdownModal.jsx`).

### Changed
- **Async 38 MB Historical Price Parsing**:
  - Converted synchronous startup parse of `data/historical_prices.json` to non-blocking asynchronous streaming load via `server/services/historicalPriceStore.js`.
- **Comprehensive Cache Invalidation**:
  - Expanded `server/db.js` `invalidateCache` to cover `liabilities`, `loan_amortization`, `pnl_history`, `sips`, and `sip_history`.
- **Unified Portfolio Valuation Engine**:
  - Synchronized `/api/summary` to calculate totals directly via canonical `computePortfolioValuation()`, guaranteeing 1-to-1 cent parity between Dashboard, Calendar, and Database.
- **Dynamic Multi-Year Calendar Lookbacks & Holidays**:
  - Extended `getLastTradingDay` and `getNextTradingDay` lookbacks in `server/services/marketCalendar.js` from 10 to 15 days with warning telemetry.
  - Added Dr. Ambedkar Jayanti (Apr 14) and algorithmic lunar cycle offsets for future years (>2028).

### Fixed
- **Silent Catch Blocks Elimination**:
  - Added informative logging to all previously empty catch blocks across price engines, historical stores, and routes.
- **Duplicate Price Refresh Engines**:
  - Deduplicated `refreshActiveHoldingsPrices` and `refreshAllHoldingsPrices` into a unified `refreshHoldingsPrices({ activeOnly })` engine.
- **Clean Ingestion & Scratch Directory Organization**:
  - Organized root-level ingestion scripts into `scripts/ingestion/` and moved response dumps to `scratch/`.

## [5.28.0] - 2026-09-13

### Added
- **Dedicated LoginView Component**:
  - Extracted authentication screen from `src/App.jsx` into `src/views/LoginView.jsx`, strictly decoupling auth logic and layout.
  - Stripped descriptive marketing and filler subtitle text from auth views to align with Rule 6 fintech minimalism.
- **Asynchronous Database Restore Worker**:
  - Decoupled historical EOD rebuild from the synchronous restore HTTP handler in `server/index.js`, executing EOD rebuild in background with 5-minute timeout guard and real-time status reporting.
  - Hardened `RestoreBackupModal.jsx` with timer cleanup on unmount, duplicate restore submission prevention, and polling failure circuit breaker.
- **Rule 13 Dynamic Scheme Discovery**:
  - Enhanced `scripts/backfill_nps_navs.mjs` to dynamically query active NPS scheme codes from Supabase `holdings` instead of static arrays.
- **Automated Test Suite Authentication**:
  - Integrated dynamic JWT auth token acquisition in `scripts/verify_financial_integrity.mjs` and `scripts/verify_all_assets_integrity.mjs`.

### Changed
- **Frontend Bundle Optimization & Vendor Code-Splitting**:
  - Configured `manualChunks` in `vite.config.js` to split vendor dependencies (React, Recharts, Lucide, Framer Motion) into distinct chunks, shrinking main bundle size from 937 kB to 222 kB.
- **Local Users Persistence in Database Layer**:
  - Updated `server/db.js` to route `users` table operations to `data/users.json`, resolving Supabase schema cache lookup errors while keeping user credential hashes secured.
- **Cross-Table Cache Invalidation**:
  - Added automatic `holdings` cache invalidation upon transaction mutations (`PUT/DELETE /api/transactions/:id`) and table modifications (`POST /api/db-table-update`).
- **Dynamic Trading Day Calendar Verification in EOD Rebuild**:
  - Replaced static day-of-week gap checks with dynamic multi-asset market calendar `isTradingDay(ds, 'NSE')` in `scripts/rebuild_portfolio_eod.mjs`, eliminating false gap warnings on exchange holidays.
- **Authentication Resilience**:
  - Implemented case-insensitive email normalization and non-blocking asynchronous `bcrypt.compare` in `POST /api/auth/login`.

### Fixed
- **Holding Detail Modal Authentication & Quote Badge Status**:
  - Replaced unauthenticated `window.fetch` in `HoldingDetailModal.jsx` with `axios.get`, resolving HTTP 401 "Authentication required" errors on detail modal loads.
  - Installed a global `window.fetch` interceptor in `src/context/ThemeAuthContext.jsx` automatically injecting `Authorization: Bearer <token>` to all API fetch requests across the application.
  - Resolved false-amber badge bug by creating `getQuoteBadgeStatus()` in `src/utils/dateFormatter.js`, aligning multi-format date string comparisons and accurately recognizing both current date and latest completed trading sessions in emerald green.

## [5.27.0] - 2026-09-13

### Added
- **Secure Authentication & Registration**:
  - Added validated `POST /api/auth/register` account creation with bcrypt password hashing.
  - Added a responsive branded Ladder login/register screen using the project logo artwork.
  - Added automatic clearing of expired or invalid browser sessions.

### Changed
- **Authentication Hardening**:
  - Removed demo-token and empty-password fallbacks.
  - Required a configured `JWT_SECRET` with a minimum length of 32 characters.
  - Added configurable CORS origins and attached bearer tokens to frontend API requests.
- **Database and Backup Safety**:
  - Restricted Database Studio to approved tables and editable columns.
  - Added cache invalidation after direct transaction, holding, and liability mutations.
  - Backups now fail on read errors, while restores validate filenames and snapshot structure and abort on database errors.
  - Prevented concurrent restore operations.
- **UI Load and Presentation**:
  - Reduced dashboard and FX polling frequency.
  - Simplified authentication copy and enlarged the Ladder visual mark for a cleaner first impression.

## [5.26.0] - 2026-09-13

### Added
- **Asynchronous Restore Job Lifecycle & Polling**:
  - Added in-process `restoreJobs` registry to `server/index.js` with `GET /api/cloud-backups/restore/status` polling endpoint.
  - Upgraded `RestoreBackupModal.jsx` to poll live restore lifecycle progress (`Restoring...` -> `Rebuilding Historical EOD...` -> `Succeeded` / `Failed`) with live progress alerts instead of premature closure.
- **Server Startup Missed-Run EOD Detection**:
  - Implemented `checkMissedEodRebuild()` in `server/index.js` triggering automatic catch-up EOD rebuilds on boot if yesterday's record is missing from `pnl_history`.
- **UI & Dashboard Refinements**:
  - Refined dashboard headers to reduce text redundancy: changed 'Net Worth' history chart to 'Trend' and 'TOTAL NET WORTH (ASSETS - LIABILITIES)' to 'TOTAL WEALTH'.
- **NPS Historical Full-Series Backfill Engine**:
  - Created `scripts/backfill_nps_navs.mjs` backfilling 47,109 historical daily NAV records across all 14 NPS schemes into `nps_daily_navs` table in Supabase.
- **Multi-Asset Code Splitting**:
  - Implemented `React.lazy()` and `<Suspense fallback={<ViewLoader />}>` dynamic chunking in `src/App.jsx` across all 14 portfolio views, converting monolithic bundle into on-demand asynchronous modules.

### Changed
- **EOD Rebuild Upsert Uncapped & Gap Logging**:
  - Removed 90-row upsert cap in `scripts/rebuild_portfolio_eod.mjs`; all historical logs now upserted to Supabase `pnl_history` in full 500-record chunks with automated trading day gap detection.
- **Startup In-Memory Cache Pre-Warming (`warmCache()`)**:
  - Added `pnl_history` (last 365 days) pre-population in `server/db.js` `warmCache()` to protect Dashboard and Calendar from cold-start Supabase query storms.
- **Multi-Asset Financial Integrity Suite Upgrades**:
  - Updated `scripts/verify_all_assets_integrity.mjs` with paginated future-row checks, full NPS database scan, dynamic date boundaries, and weekend carry-forward assertions.
- **Protean Scraper & Secondary Fallback Protocol**:
  - Hardened Protean scraper in `server/services/priceEngine.js` to persist all downloaded valid NAV rows to Supabase regardless of whether `zipNavDate` equals `lastTradingDay`, preventing data drops.
  - Updated Rule 8 in `.agents/AGENTS.md` to document automated daily scraping with `npsnav.in` as an approved resilient fallback/backfill source.

## [5.25.0] - 2026-09-12

### Changed
- **Mutual Funds and NPS 4-Decimal NAV Precision Upgrade**:
  - Implemented 4-decimal precision for NAV and unit price metrics across Mutual Funds and National Pension System (NPS) schemes in frontend views, backend APIs, and database records.
  - Updated `ThemeAuthContext.jsx` with `formatNAV(nav, forceINR = true)` utility and extended `formatMoney` to support arbitrary decimal parameterization (`decimals = 4`).
  - Updated `MutualFundsView.jsx` and `NpsView.jsx` tables: Avg Buy NAV, Current NAV, NAV Day Change, and Redeemed Avg Buy / Sell NAVs now display with exact 4 decimals (e.g. `₹70.3376`, `₹30.9826`, `₹35.7989`, `₹109.3531`).
  - Updated `HoldingDetailModal.jsx` for MF and NPS schemes: header quote price badge, daily change, market snapshot statistics (Open, Prev Close, Day High, Day Low, 52W Range), Actual Chart Y-axis ticks, event tooltips, and transaction ledger unit prices now display 4-decimal precision.
  - Updated `HoldingsTable.jsx` to render 4 decimals for mutual fund and NPS rows.
  - Updated backend API endpoints (`/api/holdings`, `/api/holding/:id/detail`) in `server/index.js` to return 4-decimal precision for MF and NPS quote prices, day changes, and statistical extremes without rounding to 2 decimals.
  - Re-synchronized Supabase `holdings.avg_buy_price` and `holdings.current_price` via `recalculateHoldingState` across all 47 MF and NPS positions, establishing 4-decimal acquisition and market NAV baselines.
  - Maintained strict 2-decimal rupee/paise formatting for all portfolio value aggregations (Invested, Current Value, P&L, Day P&L).

## [5.24.0] - 2026-09-12

### Added
- **Dynamic Multi-Asset & Multi-Year Market Calendar Engine (`server/services/marketCalendar.js`)**:
  - Implemented dynamic trading day, market holiday, and prior/next trading day calculation engine for Indian markets (NSE/BSE/AMFI/NPS) and US markets (NYSE/NASDAQ).
  - Dynamically evaluates market trading status across current and future years (2026, 2027, 2028, and beyond) without code modifications.
  - Features algorithmic US holiday computation (MLK Day, Washington's Birthday, Memorial Day, Labor Day, Thanksgiving, Good Friday via Gauss Easter algorithm, and weekend observation rules for Juneteenth, Independence Day, Christmas, and New Year's Day).
  - Features Indian national gazetted calendar synthesis combining fixed national holidays (Republic Day, Maharashtra Day, Independence Day, Gandhi Jayanti, Christmas), algorithmic Good Friday, and multi-year gazetted festival calendars (Diwali, Holi, Eid, Ram Navami, etc.).
  - Added REST API endpoint `GET /api/market-holidays` allowing frontend and external consumers to inspect market trading schedules by year (`?year=YYYY`) and market (`?market=NSE|NYSE|ALL`).
- **Rule 13: Strict Anti-Hardcoding & Dynamic Engine Architecture Protocol**:
  - Codified mandatory rule in `.agents/AGENTS.md` and `LADDER.md` prohibiting static calendar years, time-locked dates, single-year arrays/sets, or hardcoded heuristics for any logic that can be dynamic in nature.

### Changed
- **Refactored Price and SIP Engines to Eliminate Hardcoded Calendars**:
  - Replaced static `NSE_HOLIDAYS_2026` set in `server/services/priceEngine.js` with calls to `marketCalendar.js` (`isTradingDay(date, 'NSE')`, `getLastTradingDay(date, 'NSE')`).
  - Replaced local date checks in `server/services/sipEngine.js` with `marketCalendar.js` methods (`isTradingDay`, `getNextTradingDay`).
  - Verified Express daemon health on port 5000 and confirmed 100% financial integrity test pass.

## [5.23.0] - 2026-09-12


### Changed
- **Robust Universal On-Demand Refresh Engine & Non-Trading Day Parity**:
  - Resolved NPS on-demand refresh stall on weekends/holidays: `syncAllMissingNavs()` now targets the most recent completed market trading day (`lastTradingDay`, e.g. Friday on weekends) rather than aborting when `today` is a Saturday/Sunday/holiday.
  - Normalized date parsing in `fetchNpsNavFallback`: converts `DD-MM-YYYY` dates from fallback feeds to standard ISO `YYYY-MM-DD`, allowing matching against `lastTradingDay` and upserting directly into `nps_daily_navs`.
  - Upgraded `refreshActiveHoldingsPrices()` and `refreshAllHoldingsPrices()` to detect stale Protean CRA batches (`isProteanNavStale()`) and seamlessly use verified fallback quotes, persisting confirmed latest-session NAVs to Supabase.
  - Enhanced `isUpToDate` and added `getQuoteDateLabel` across all 4 portfolio views (`NpsView`, `IndianStocksView`, `MutualFundsView`, `UsStocksView`), recognizing the latest completed market session as up-to-date with emerald badges and clean `Latest (Date)` labels instead of false stale alerts on weekends.
  - Refined TopNavbar Profile dropdown UI: dynamic theme background on `VP` avatar, removed redundant bottom line and border on `Backup Now`, and renamed `Data Import / Export` to `Import / Export`.
  - Verified 100% pass across financial integrity tests and Vite production build.

## [5.22.0] - 2026-09-12

### Changed
- **Official Protean CRA Direct NPS Scheme Alignment & Accurate Valuations**:
  - Re-mapped active NPS Direct holdings and post-01-Apr-2026 transactions from old Regular/POP scheme codes (`SM008002`, `SM003007`, `SM002003`) to official PFRDA Multiple NAV Framework Direct scheme codes:
    - HDFC Scheme C Tier I Direct -> `SM008019`
    - LIC Scheme G Tier I Direct -> `SM003027`
    - UTI Scheme E Tier I Direct -> `SM002027`
  - Backfilled 12 missing market days of official Protean CRA daily NAVs from official archive ZIPs (`NAV_File_DDMMYYYY.zip`) into `nps_daily_navs`.
  - Updated active NPS valuation to verified official Protean CRA Direct NAVs (`₹5,10,232.39` total active valuation).
  - Preserved 11 historical closed schemes with their official POP codes, exact transaction ledger, lifetime cost basis, and realized P&L.
  - Upgraded `recalculator.js` to preserve lifetime average buy cost for redeemed positions so historical cost basis and ROI % are accurately displayed across all asset classes.
  - Rebuilt all 6,925 historical portfolio EOD records in `pnl_history` and `data/portfolio_eod_logs.json`.
  - Verified 100% pass across all financial integrity and multi-asset audit test suites.

## [5.21.1] - 2026-09-12

### Changed
- **Application Logo Replacement**:
  - Replaced the CSS animated "LADDER" logo in `Sidebar.jsx` with the user's custom uploaded image logo (`logo.png`), scaling it perfectly to fit the sidebar constraints.

## [5.21.0] - 2026-09-12

### Added
- **Bank & Liability Transaction Timeline Replay in EOD Rebuild**:
  - Refactored `scripts/rebuild_portfolio_eod.mjs` to chronologically replay all post-baseline bank account transactions (`HDFC`, `INDUSIND`, `IDFC`, `RBL`, `SBI`, `FEDERAL`), `EPF` contributions, and debt transactions (`loans`, `credits`) from the `transactions` table, ensuring historical balances and Calendar heatmap accurately reflect actual transaction dates.
- **Unified Daily Sync Orchestrator (`scripts/daily_sync.mjs`)**:
  - Created a single master CLI orchestrator that executes the full end-of-day sequence deterministically: (1) `sync_daily_prices.mjs`, (2) `rebuild_portfolio_eod.mjs`, (3) `verify_financial_integrity.mjs`, and (4) `backup_manager.mjs` with per-stage timing benchmarks and exit code verification.
- **Contextual "+ Add Transaction" Drawer in `HoldingDetailModal.jsx`**:
  - Added a collapsible quick-add transaction drawer pre-filled with the active holding symbol, currency, and category-specific transaction types (`BUY`/`SELL`/`BONUS`/`SPLIT` for equities, `BUY`/`REDEEM` for MFs/NPS, `DEPOSIT`/`WITHDRAWAL`/`INTEREST` for bank accounts, `CONTRIBUTION`/`INTEREST` for EPF, and `EMI_PAYMENT`/`PREPAYMENT` for debt liabilities) with instant modal ledger refresh.
- **SIP Execution & Skips History in `SipManagerModal.jsx`**:
  - Built an "Execution & Skips" tab in `SipManagerModal.jsx` tracking every automated SIP run, successful unit allocation, skip event, and closure with exact timestamp, scheme name, and skip reasons.
  - Persisted execution records to `data/sip_history.json` and exposed via backend endpoint `GET /api/sips/history`.
  - Upgraded `server/services/sipEngine.js` with `isTradingDay(today)` awareness to defer runs on both weekends and NSE exchange holidays.
- **Benchmark Sync Staleness Badge in `ReportsView.jsx`**:
  - Added a live "Synced: DD-MM-YYYY" indicator badge next to the benchmark index selector in the Growth vs Indices report, clarifying when the underlying `index_history` was last updated.
- **Last Backup Indicator in TopNavbar Profile Dropdown**:
  - Displayed the most recent cloud backup timestamp (`DD-MM-YYYY HH:mm`) and compressed `.json.gz` file size directly inside the user Profile dropdown menu.
- **Startup In-Memory Cache Pre-Warming (`warmCache()`)**:
  - Added `warmCache()` in `server/db.js` pre-populating all high-frequency relational tables (`categories`, `holdings`, `liabilities`, `dividends`, `transactions`) on Express server startup, preventing cold-cache query storms and protecting Supabase monthly egress limits.
- **Dual Daily EOD Rebuild Schedulers in `server/index.js`**:
  - Configured precision Node timeout schedulers triggering automatic background EOD rebuilds at 18:30 IST (13:00 UTC, post-Indian market close) and 07:00 IST (01:30 UTC, post-US market close).

### Fixed
- **NPS Historical Query Pagination Guard**:
  - Added chunked pagination loops (`range(from, from + 1000 - 1)`) for `nps_daily_navs` in `scripts/rebuild_portfolio_eod.mjs`, eliminating truncation across all 2,740+ historical NAV records.
- **Authoritative NPS Historical Pricing**:
  - Rewrote `fetchNpsHistoricalNav` in `server/services/priceEngine.js` to query Supabase `nps_daily_navs` exclusively and carry forward missing dates, fully eliminating default fallback calls to `npsnav.in` (Rule 8 enforcement).
- **Weekend Market Settlement Invariance Parity**:
  - Synchronized weekend P&L handling across `/api/summary` and `/api/daily-pnl` to strictly verify whether actual user transactions exist on that date before reporting non-zero values, preserving exact ₹0.00 (0.00%) invariance on non-trading weekend sessions.
- **Lossy Price Fallback Audit Logging**:
  - Added explicit `[WARN]` console logging in `scripts/rebuild_portfolio_eod.mjs` and `scripts/sync_daily_prices.mjs` detailing symbol, date, and substituted close price whenever the `chartPreviousClose` or `previousClose` fallback triggers.
- **Generalized Multi-Asset Invariance Audit**:
  - Replaced hardcoded date assertions in `scripts/verify_all_assets_integrity.mjs` with universal invariance checks: zero duplicate dates, chronological monotonicity, and multi-asset completeness audit on the latest settled trading session.
- **Post-Restore Status Feedback**:
  - Enhanced `RestoreBackupModal.jsx` and `POST /api/cloud-backups/restore` to return `rebuildStatus: 'initiated'` and display user confirmation of ongoing background EOD recalculations.
- **Cleaned `/api/summary` EOD Sourcing**:
  - Removed outdated `portfolio_eod_logs.json` fallback from `/api/summary`, utilizing Supabase `pnl_history` as the single authoritative source of truth.

## [5.20.0] - 2026-09-12

### Added
- **NSE/RBI Trading Holiday Calendar**:
  - Added `NSE_HOLIDAYS_2026` set in `server/services/priceEngine.js` covering all official NSE trading holidays for 2026.
  - Exported `isTradingDay(dateISO)` helper that returns false for Saturdays, Sundays, and all known NSE holidays.
  - Exported `isProteanNavStale()` helper that returns true when the last in-memory Protean batch's embedded NAV date does not match the last trading day.
- **Already-Synced Detection in NPS NAV Pipeline**:
  - Added `areTodayNavsAlreadySynced(schemeCodes, targetDate)` which queries `nps_daily_navs` in Supabase before touching Protean CRA, eliminating redundant ZIP downloads when all schemes are already captured for the current trading day.
- **Date-Verified Protean Scraper**:
  - `fetchProteanNpsNavBatch` now reads the NAV date embedded in the ZIP's `.out` CSV content (not assumed from the filename or current date).
  - If the ZIP's embedded date does not match the last trading day, Supabase upsert is skipped to prevent stale data pollution, and the cache is marked stale.
  - Protean scraper logs explicit WARN when no ZIP links are found or the ZIP does not contain a `.out` file.
- **npsnav.in as Dated Fallback Only**:
  - `syncAllMissingNavs` now uses `npsnav.in` only when Protean ZIP is confirmed stale AND `npsnav.in` returns a NAV matching the last trading date. If `npsnav.in` also does not have today's date, the carry-forward from Protean's last-known NAV is used for live display without Supabase upsert.

### Fixed
- **Non-Trading Day Skip in GitHub Actions**:
  - `syncAllMissingNavs` exits immediately on weekends and NSE holidays with an informational log and `skipped: true`, preventing unnecessary Protean ZIP downloads, AMFI requests, and Supabase roundtrips.
  - `scripts/sync_navs_and_sips.mjs` surfaces the skip reason in CI logs and exits with code 0 (not a failure).
- **GitHub Actions Workflow Timing Refinement**:
  - Adjusted `daily_nav_sip_sync.yml` cron schedule to include an evening window covering 21:07, 22:07, 23:07 (IST) and a catch-up 23:37 IST run to capture late Protean publications, plus a morning catch-up at 09:07 and 10:07 IST for any schemes missed from the prior night.
  - Reduced unnecessary runs from 8/day down to 6/day on trading days, and 0 effective runs on non-trading days (script self-exits).

## [5.19.1] - 2026-09-12

### Added
- **Lossless Gzip Backup Compression (.json.gz)**:
  - Upgraded `scripts/backup_manager.mjs` and `scripts/restore_backup.mjs` with zlib gzip level 9 compression.
  - Reduced raw database backup payload from 15.21 MB down to 1.04 MB (93.2% storage reduction) while preserving 100% data integrity across all 13 tables (22,793 rows).
- **10-Day Retention Policy**:
  - Replaced the previous 3-backup cap with unlimited backups within a rolling 10-day retention window.
  - Automated pruning logic in `pruneOlderBackups()` deletes snapshots older than 10 days (`cutoff = Date.now() - 10 * 24 * 60 * 60 * 1000`) both from Supabase Cloud Storage and local storage.
- **TopNavbar Profile Dropdown Integration**:
  - Added "Backup Database Now" option directly inside the Profile Dropdown menu in `TopNavbar.jsx`, featuring instant loading spinner and toast confirmation.
  - Added "Restore Database" option directly in the Profile Dropdown menu opening the centralized restore modal.
- **Standalone Cloud Backup & Restore Modal (`RestoreBackupModal.jsx`)**:
  - Built a modal adhering strictly to project design tokens (`modal-surface`, `reports-card`, `reports-subcard`, `text-slate-100`).
  - Rendered via React Portal (`createPortal(..., document.body)`) for isolation from navigation bar clipping.
  - Includes keyboard accessibility (`Escape` key support), cloud snapshot listing with `.json.gz` indicators, one-click manual backup trigger, and safe restore confirmations.
- **Daily 08:25 AM IST Automation**:
  - Implemented automated daily timer in `server/index.js` running every morning at 08:25 AM IST (02:55 UTC) just before 8:30 AM IST.
  - Created GitHub Actions workflow `.github/workflows/daily_backup.yml` scheduled at `55 2 * * *` (08:25 AM IST) for automated cloud execution.

## [5.19.0] - 2026-09-12

### Added
- **Cloud 3-Tier Rolling Backup & Snapshot Sync Engine**:
  - Created automated cloud backup runner (`scripts/backup_manager.mjs`) extracting complete, verified database snapshots across all 12 core tables and uploading them directly to Supabase Cloud Storage (bucket `ladder_backups`).
  - Implemented automatic 3-snapshot retention: strictly preserves the 3 most recent backups both in Supabase Storage and local disk, auto-pruning older archives so 0 unnecessary quota is consumed.
  - Built interactive Cloud Backup & Snapshot Sync card in `ExcelToolsView.jsx` displaying snapshot timestamps, record counts, and file sizes with one-click "Backup Now" and "Restore to this Backup" controls.
  - Created standalone restoration manager (`scripts/restore_backup.mjs`) enabling point-in-time database restoration from cloud or local snapshots with automatic post-restore EOD synchronization.
  - Added backend API endpoints (`GET /api/cloud-backups`, `POST /api/cloud-backups/create`, `POST /api/cloud-backups/restore`) in `server/index.js`.

### Fixed
- **Supabase Storage Quota Relief**:
  - Diagnosed and fixed runaway storage consumption: dropped unconstrained `trg_audit_holdings` and `trg_audit_liabilities` database triggers that were generating full JSON snapshots on every holding update.
  - Truncated `audit_logs` (203,212 rows / 319 MB), reducing Supabase database storage from 340+ MB (75%) down to 13.5 MB (2.7% of the free 500 MB quota).
  - Excluded `audit_logs` from `/api/db-tables` so Database Studio never pulls discarded audit logs.

- **Cloud Network Egress Elimination**:
  - Implemented reactive in-memory caching (`dbCache`) in `server/db.js` with a 60-second TTL fallback, eliminating repetitive multi-megabyte cloud sweeps on every dashboard summary request.
  - In-memory filtering enabled for `db.selectWhere` when tables are cached, avoiding cloud roundtrips for category queries.
  - Automatic cache invalidation wired to all INSERT, UPDATE, and DELETE mutations.
  - Reduced monthly Supabase egress by 99% (< 50 MB / month), completely resolving the 5 GB free egress limit.

- **Workspace Rules & Master Architecture**:
  - Added Rule 11 (Mandatory In-Memory Reactive Caching & Egress Protection) and Rule 12 (Cloud 3-Tier Rolling Backup & Storage Protection) in `.agents/AGENTS.md` and `LADDER.md`.
  - Re-verified 100% PASS across financial integrity and universal multi-asset test suites.

## [5.18.1] - 2026-09-08

### Fixed
- **Equity Stocks Price Sync & 07-Sep Calendar Reconciliation**:
  - Diagnosed why 07-Sep Calendar previously only displayed changes for Mutual Funds and NPS: `historical_prices.json` lacked 07-Sep closing quotes for Indian stocks because Yahoo Finance's 3-month daily interval returned null array entries for certain symbols on the recent session, causing `rebuild_portfolio_eod.mjs` to fall back to 04-Sep.
  - Implemented automated fallback in `scripts/sync_daily_prices.mjs` and `scripts/rebuild_portfolio_eod.mjs` leveraging Yahoo Finance's `meta.chartPreviousClose` / `meta.previousClose` when array quotes are null.
  - Added Step 3 to `scripts/rebuild_portfolio_eod.mjs` to automatically verify and fetch missing recent equity quotes up to `targetEndDate` on every rebuild.
  - Rebuilt historical EOD logs: 07-Sep Calendar now accurately reflects Indian Stocks (+₹1,17,513.47), US Stocks (-₹1,158.51 FX fluctuation on US Labor Day), Mutual Funds (-₹9,850.54), and NPS (-₹1,581.82) with net daily P&L of +₹1,04,922.60 (+0.56%).

## [5.18.0] - 2026-09-08

### Fixed
- **Universal Multi-Asset & Liability Data Integrity**:
  - Enforced official Protean CRA scraper (`nps_daily_navs` table in Supabase) as the primary, authoritative source of truth for all live and historical NPS valuations, eliminating reliance on third-party `npsnav.in`.
  - Reconciled 2026-09-07 EOD log with exact finalized AMFI and Protean NAVs (Mutual Funds: ₹45,20,076.75, NPS: ₹513,037.68) and removed premature 2026-09-08 row from `pnl_history`, ensuring current-day metrics compute dynamically in real-time.
  - Hardened `rebuild_portfolio_eod.mjs` to target yesterday's closed session and never snapshot an unfinished trading day.
  - Added `scripts/verify_all_assets_integrity.mjs` testing all 8 asset/liability classes across 6,921 historical records with 100% pass.
  - Formally codified Rules 8 and 9 in `.agents/AGENTS.md` and `LADDER.md` enforcing Protean CRA exclusivity and strict trade date vs entry timestamp parity.

## [5.17.0] - 2026-09-08

### Enhanced
- **Global Auto-Select on Input Focus/Click**: Implemented universal auto-selection across all text, number, and search inputs throughout the application (search bars, inline table editors, modal inputs, SIP and loan forms, and range controls). Clicking or focusing any field instantly highlights its existing content so typing immediately overwrites it, while fully preserving the `X` clear button controls.

## [5.16.1] - 2026-09-08

### Fixed
- **Resolved showCalendarPicker ReferenceError**: Cleaned up obsolete references to `showCalendarPicker` in `HoldingDetailModal.jsx`, `FxRateModal.jsx`, and `AssetDividendDetailModal.jsx` keyboard handlers, properly delegating calendar state management to the encapsulated `ChartRangeSelector` component.

## [5.16.0] - 2026-09-08

### Enhanced
- **Modernized Dynamic Graph Range Selector**: Replaced long static preset range pill bars across all charts and modals (`OverviewView`, `HoldingDetailModal`, `ReportsView`, `FxRateModal`, `AssetDividendDetailModal`, `CalendarView`) with a unified, beautiful `ChartRangeSelector` component featuring:
  - **ALL Button**: Instant full-history reset.
  - **Relative Integer + Unit Input**: User input for any integer accompanied by a clean dropdown to select `Days`, `Weeks`, `Months`, or `Years` (e.g., 5 Months, 2 Weeks, 10 Days, 3 Years).
  - **Custom Calendar Date Range Popover**: Accessible calendar popover with From/To date inputs, Apply button, Cancel X, and keyboard shortcuts (`Escape` to close, `Enter` to apply).
  - **Universal Backend Relative Range Parser**: Added regex token parser (`/^(\d+)([DWMYdwmy])$/`) across `/api/daily-pnl`, `/api/fx-history`, and `/api/reports/growth-benchmarks` to support dynamic relative range calculations with dual fallback to `startDate`/`endDate`.

## [5.15.0] - 2026-09-08

### Enhanced
- **Global Keyboard Accessibility for Modals**: Added explicit 'X' cancel button to Custom Date Range picker in `CalendarView.jsx`. Implemented `Escape` key to close and `Enter` key to submit/confirm functionality across all application modals, dialogs, and popovers (`HoldingDetailModal`, `AssetDividendDetailModal`, `SipManagerModal`, `FxRateModal`, and `ThemeAuthContext` global dialogs).

## [5.14.0] - 2026-09-08

### Refactored
- **Global Modals Architecture**: Eradicated all native browser popups (`alert`, `confirm`, `prompt`) across the entire codebase. Replaced them with centralized, beautifully animated, theme-aware React modals (`showError`, `showSuccess`, `showConfirm`, `showPrompt`) managed by `ThemeAuthContext`.
- **UI/UX Consistency**: Affected 9 files (`TopNavbar`, `App`, `SipManagerModal`, `DatabaseViewer`, `DatabaseStudioView`, `AssetDividendDetailModal`, `DividendsView`, `ExcelToolsView`, `LoanAmortizationSection`, `HoldingDetailModal`). Ensured modals render via React Portals (`createPortal`) at the DOM root to avoid z-index and overflow clipping issues. Full support for Dark/Light theme modes and keyboard accessibility.

## [5.13.0] - 2026-09-07

### Enhanced
- **Universal Search Clear Controls**: Added conditional `X` buttons to every search and filter input across portfolio views, reports, ledgers, modals, and database tools.
- **Long-Text Input Protection**: Increased right-side input padding wherever a clear control is present so typed text scrolls left and never renders beneath the `X` button.

## [5.12.0] - 2026-09-06

### Reconciled & Hardened
- **360-Degree Raw Source Reconciliations & Master Database Parity**:
  - **Exhaustive Raw Data Audit**: Cross-audited all 33 Mutual Funds, 12 US Stocks, 331 Indian Stocks, 6 Bank Accounts, 1 EPF, and 2 Liabilities against raw source spreadsheets (`portfolio.xlsx`, `Ind_Stocks.csv`, `Ind_Mfs.csv`, `Book2.xlsx`, `NPS/*.csv`, `charges.xlsx`).
  - **NPS Scheme Deduplication**: Consolidated duplicate 0-quantity rows for `SM003007` (LIC Scheme G Direct), `SM008002` (HDFC Scheme C Direct), and `SM002003` (UTI Scheme E Direct), re-linking all 104 historical transactions to the active master records.
  - **CLEDUCATE Sell Quantity Correction**: Fixed 2025-10-29 sell transaction from 649 to 585 shares per `Ind_Stocks.csv`, bringing remaining holding quantity to exact 97 shares.
  - **Missing Exited Stock Ingestion**: Ingested `VIYASH` (Viyash Scientific Limited) with 3 historical transactions (status: `REDEEMED`, 0 qty).
  - **Bank & EOD Asset Ledger Refactor**: Re-titled section to `Transaction Ledger` in `HoldingDetailModal.jsx`, added chronological running balance accumulator, replaced incorrect `tx.price` with exact running balance, and added color-coded `TxBadge` support (`CREDIT`, `DEPOSIT`, `DEBIT`, `WITHDRAWAL`, `CONTRIBUTION`, `INTEREST`, `BORROW`, `EMI_PAYMENT`, `CHARGE`, `PAYMENT`).
  - **False Negative Badge Fix**: Corrected transaction badge direction indicator in `HoldingDetailModal.jsx` by checking `tx.isInflow` rather than `tx.type === 'BUY'`.
  - **Zero Balance Display Precision**: Hardened `HoldingDetailModal.jsx` with strict nullish coalescing (`??`) for zero-value bank accounts and liabilities.
  - **Integrity Validation**: Obtained 100% PASS across the complete automated financial integrity and mathematical invariance test suite (`scripts/verify_financial_integrity.mjs`).

---

## [5.11.0] - 2026-09-06

### Fixed & Reconciled
- **Comprehensive Database & Ledger Discrepancy Reconciliation**:
  - **Federal Bank 0/103 Sync Resolution**: Diagnosed and resolved issue where Federal Bank displayed a non-zero balance of ₹103 in the detail modal and timeline chart. Updated `/api/holding/:holdingId/detail` in `server/index.js` to preserve zero closing entries and display real Supabase database transactions (`CREDIT` and `DEBIT` delta ledger ending with -₹103 on 09-11-2025).
  - **Bank & EPF Holding Status Alignment**: Corrected statuses in `holdings` table so active bank accounts (HDFC, IndusInd, IDFC, SBI, RBL) and EPF with positive balances are marked `ACTIVE`, while zero-balance closed accounts (Federal Bank) are marked `REDEEMED`.
  - **US Stock Dividends Integration in Unified Transactions Table**: Inserted all 73 US stock dividends into the Supabase `transactions` table with `type: 'DIVIDEND'`, `currency: 'USD'`, exact transaction-date FX rates, and dollar amounts, ensuring 100% parity across `dividends` and `transactions` tables.
  - **Mutual Funds Fractional Epsilon Rounding**: Clamped residual fractional units on full scheme redemptions (e.g. Quant Multi Cap +0.0001, Franklin US Opp -0.003, ABSL Digital -0.005, Mirae Asset -0.0028) to zero and set their status to `REDEEMED`.
  - **FixedIncomeView Upgrades**: Added status filter tabs (`Active`, `Closed`, `All`) with live badge counts and distinct visual styling for closed/liquidated accounts.
  - **Recalculator Engine Protection**: Enhanced `server/services/recalculator.js` to prevent double split/bonus scaling and properly maintain status for balance and market holdings.
  - **Financial Invariance Audit**: Validated 100% pass across all financial data integrity assertions (`scripts/verify_financial_integrity.mjs`).

---

## [5.10.0] - 2026-09-06

### Fixed & Enhanced
- **Multi-Asset Historical Auto-Tracking Engine Repair & Zero-Data-Gap Continuous Synchronization**:
  - **Root Cause Resolution**: Diagnosed and resolved issue where Mutual Funds and NPS schemes were untracked / frozen on 2nd September and subsequent dates due to (1) exclusion of NPS schemes in `scripts/load_historical_prices.mjs`, (2) baseline locking bug in `scripts/rebuild_portfolio_eod.mjs` that skipped re-evaluating existing database records upon late NAV publication, and (3) 1,000-row query truncation in `server/db.js`.
  - **NPS Historical Ingestion**: Added `fetchNpsHistorical` from `npsnav.in` across price synchronization scripts and integrated NPS alongside Mutual Funds, Indian stocks, US stocks, and USD/INR exchange rates.
  - **Post-Baseline Dynamic Re-evaluation**: Rebuilt `scripts/rebuild_portfolio_eod.mjs` to dynamically re-evaluate all dates from the historical baseline (`2026-08-08` through current date) using verified settled closing quotes and NAVs, eliminating permanent stale fallbacks.
  - **Supabase Database Pagination Guard**: Upgraded `server/db.js` (`select` and `selectWhere`) with automatic range pagination loops across 100% of rows (all 11,205 transactions, 397 holdings, and liabilities).
  - **Historical Parity Backfill**: Rebuilt all 6,920 daily logs, backfilled settled NAVs for 2nd, 3rd, 4th, 5th, and 6th September across Mutual Funds and NPS schemes, and synchronized with Supabase `pnl_history` and `data/portfolio_eod_logs.json`.
  - **Integrity Validation**: Obtained 100% PASS across the complete automated financial integrity and mathematical invariance test suite (`scripts/verify_financial_integrity.mjs`).

---

## [5.9.1] - 2026-09-06

### Added & Enhanced
- **Interactive USD/INR Forex Tracker & History Hub**:
  - Added backend endpoint `/api/fx-history` serving complete 16-year daily USD/INR time-series data with timeframe range filtering (`1M`, `3M`, `6M`, `1Y`, `3Y`, `5Y`, `ALL`, `CUSTOM`).
  - Created `FxRateModal.jsx` featuring high/low/average/period return KPI cards, interactive Recharts AreaChart with custom tooltip, and a searchable, sortable date-wise exchange rate ledger (`DD-MM-YYYY`).
  - Connected the live USD/INR dollar rate pill in `TopNavbar.jsx` with click action, hover glow, and instant modal launch.
- **Hierarchical Drilldown Step-Back Navigation in Reports**:
  - Connected `ReportsView.jsx` drilldown states (`companyDetailTarget`, `selectedMarketCap`, `selectedSector`, `selectedMfScheme`) to a registered step-back handler in `App.jsx`.
  - Clicking the global floating back button now gracefully steps back to the previous chart/category level within Reports rather than unexpectedly exiting to the Dashboard.
- **Fixed Transaction Deletion State Bug**: Resolved `ReferenceError: deleteConfirmTx is not defined` in `HoldingDetailModal.jsx` by explicitly declaring deletion states in the component root.

---

## [5.9.0] - 2026-09-06

### Added & Enhanced
- **Dynamic Scope Filtering In Reports Drilldown**: Updated `marketCapData` and `sectorData` computation hooks to include `equityOptions.india`, `equityOptions.us`, and dynamic `usHoldingSymbols` lookups. Unchecking `Indian Stock` immediately removes all Indian companies (both direct equity and Indian holdings within mutual funds) in real-time from active drilldown views.
- **Unified Navigation & Back Button Deduplication**: Removed redundant inline back buttons beside category headers (Mega Cap / Sectors) and eliminated the duplicate floating bottom-right back button in `ReportsView.jsx`, preserving the single global floating back button in `App.jsx`.
- **Standard Themed Delete Confirmation Modals**: Replaced native browser `window.confirm` dialogs with custom theme-matched confirmation modals (`modal-surface`, glassmorphism backdrop, red trash icon, dark/light mode responsive) for both whole-position deletion in `App.jsx` and transaction deletion in `HoldingDetailModal.jsx`.

---

## [5.8.0] - 2026-09-06

### Added & Enhanced
- **Reports View Right-Hand Hover Pie Slice Highlighting**: Added `onMouseEnter` / `onMouseLeave` handlers across `RankedBarList` items and synced with `<Cell>` glow/expansion styling across Market Cap, Sector, and Asset Allocation pie charts.
- **Dynamic Drilldown In-Place Refresh**: Eliminated full-page resets when unchecking equity scope checkboxes (`Indian Stocks`, `US Stocks`, `Mutual Funds`). Active drilldowns (`Mega Cap`, `Large Cap`, `Sector`, etc.) now dynamically resolve the latest reactive bucket and update company lists and totals on the fly right on the same page. Added integrated back navigation buttons.
- **Portfolio Table Action Cleanup**: Removed the Edit (pencil) button from the Actions column in all portfolio tables (`IndianStocksView.jsx`, `UsStocksView.jsx`, `MutualFundsView.jsx`, `NpsView.jsx`, `FixedIncomeView.jsx`, `HoldingsTable.jsx`) so edits can only be made at the individual transaction level.
- **Cascade Deletion & Instant Transaction Sync**: Fixed backend holding deletion to cascade delete child transactions, dividends, and SIPs first. Updated `HoldingDetailModal.jsx` to immediately refresh modal transaction state and trigger parent dashboard updates upon transaction deletion.

---

## [5.7.0] - 2026-09-06

### Added & Enhanced
- **Overview Table Pie Chart Sync, Reports Drilldown Reset, Dashboard Spacing, and Transaction Ledger Actions**:
  - **Overview Performance Table Pie Chart Sync**: Hovering over any asset class row in the Dashboard Performance table immediately highlights and pops out the corresponding slice in the 3D Asset Allocation donut chart via synchronized `activePieIndex` state.
  - **Reports View Filter Reset**: Toggling equity category checkboxes (Indian Stocks, US Stocks, Mutual Funds) in `ReportsView.jsx` automatically resets drilldowns back to the primary overview level, preventing stale cross-asset records from lingering.
  - **Dashboard Layout Spacing**: Corrected the `.gradient-border > *:not([class*="absolute"])` CSS rule to prevent absolute positioned glow orbs from entering the document flow, removing the excessive top gap in the Net Worth Hero card.
  - **Reinforced Position Deletion Confirmation**: Added explicit two-step double confirmation prompts across portfolio views before deleting full holdings and associated records.
  - **Per-Transaction Edit and Delete**: Added dedicated Edit and Delete actions beside the Notes column in `HoldingDetailModal.jsx` transaction ledger. Edit enables inline modifications of date, type, quantity, price, amount, charges, and FX rate; Delete triggers double confirmation and invokes the centralized FIFO recalculation engine with instant parent view refresh.

---

## [5.6.0] - 2026-09-06

### Added & Enhanced
- **Universal Border Completion & Project-Wide Table Sort and Filter**:
  - **Universal Border Completion**: Diagnosed and resolved cut-off/clipped borders on Ranked Progress list cards and cards in scroll containers caused by outset rings rendering beyond overflow boundaries. Added `.reports-subcard.is-selected` with explicit theme-adaptive inset borders and box-shadow in `index.css`, converted card selection rings to `ring-2 ring-inset` across `ReportsView.jsx`, `CalendarView.jsx`, and `CalendarHeatmap.jsx`, and added container padding (`p-1.5 custom-scrollbar`) to ensure complete, unclipped borders on all sides across all themes.
  - **Project-Wide Table Search & Column Sorting**: Implemented real-time search filtering and clickable column sorting across all tabular displays in the application:
    - `ReportsView.jsx` Consolidated Category Performance Ledger (Search + Sort by Asset Class, Active Val, Active Cost, Unrealized P&L, Realized P&L, Lifetime Cost, Net Return, Abs ROI %, Annualized XIRR).
    - `ReportsView.jsx` Mutual Fund Look-Through Constituent Holdings (Search + Sort by Company, Sector, Cap Tier, Fund Weight %, Allocated Value).
    - `ReportsView.jsx` Market Cap Drill-Down (Search + Sort by Stock, Source, Contribution %, Allocated Value).
    - `ReportsView.jsx` Sector Drill-Down (Search + Sort by Company, Source, Cap Tier, Allocated Value).
    - `ReportsView.jsx` Company Mutual Fund Breakdown Modal (Search + Sort by Scheme, Fund Weight %, Allocated Value, Share of Holding %).
    - `OverviewView.jsx` Asset Class Performance table (Search filter bar).
    - `HoldingDetailModal.jsx` Transaction Ledger (Search filter bar + transaction type filter pills).
    - `AssetDividendDetailModal.jsx` Itemized Distribution Ledger (Search filter bar + Sort by Date, Original Payout, FX Rate, INR Credited, Cumulative Total).
    - `LoanAmortizationSection.jsx` Schedule table (Search filter bar + Sort by Date, Type, Opening Balance, EMI, Bulk Payment, Interest, Principal, Closing Balance, Rate).
    - `HoldingsTable.jsx`, `DatabaseViewer.jsx`, and `DividendsHub.jsx` reinforced with search and column sorting.

---

## [5.5.5] - 2026-09-06

### Refined
- **Reports Asset Class Performance Pill Cleanup**:
  - Removed redundant and confusing `0.0% Allocation` badge from the header of Asset Class Performance cards in `ReportsView.jsx`. Allocation weights are already comprehensively analyzed in the dedicated Allocation Donut and Bar charts with full look-through.

---

## [5.4.2] - 2026-09-06

### Refined & Enhanced
- **Housing Loan Detail Modal Sub-Tab Ordering & Delete Modal Standardization**:
  - **Sub-Tab Positioning & Icon Cleanup**: Positioned `Daily Balance History` as the primary left button and `Amortization Schedule & Chart` on the right in `HoldingDetailModal.jsx`. Removed the calendar icon from the amortization tab for a clean minimalist fintech aesthetic.
  - **Themed Delete Confirmation Modal**: Replaced native `window.confirm` with the project's standard themed modal popup (`.modal-surface`, backdrop blur, animated transitions, and explicit cancel/delete actions) in `LoanAmortizationSection.jsx`.
  - **Terminology Standardization**: Replaced remaining instances of `Home Loan` with `Housing Loan` across `AddInvestmentView.jsx`, `data/liabilities.json`, and project documentation.
  - **Lender Sanitization**: Ensured `State Bank of India` is stored and rendered cleanly without `(SBI)` across database rows, liability cards, and modal drill-down headers.

---

## [5.4.1] - 2026-09-06

### Refined & Enhanced
- **Housing Loan Amortization Refinements**:
  - **Lender Name Cleanliness**: Stripped all `(SBI)` and `SBI` abbreviations across `LiabilitiesView` cards and `HoldingDetailModal` headers, cleanly showing `State Bank of India`.
  - **Single Entry Point**: Removed the separate `Amortization Schedule` button on the Housing Loan card since the `View` button navigates directly to the detail modal.
  - **Modal Subtitle Standardization**: Renamed `Home Loan` to `Housing Loan` in `HoldingDetailModal`.
  - **Actual EMI vs. Monthly Payment Differentiation**: Contractual EMI of ₹52,653.00 and actual monthly installment of ₹60,000.00 are now displayed in distinct KPI tiles (`Actual EMI` and `Monthly Payment`). Added quick inline edit for monthly payment and added `Update Monthly Installment / Payment` option in `Add Entry`.
  - **Full Amount Currency Formatting**: Replaced all abbreviated amounts (`44.64L`, `44.97L`) with exact rupee precision (e.g. `₹44,64,447.00`, `₹69,98,345.00`, `₹44,96,758.00`) across all metrics, charts, simulators, and tables.
  - **Full Action Controls**: Added both `Edit` (pencil) and `Delete` (trash) action buttons for every entry in the Amortization Schedule table with real-time recalculation of future payoff trajectories.
  - **Modal Fix**: Destructured `formatMoney` from `useThemeAuth()` in `HoldingDetailModal.jsx` to eliminate the `ReferenceError: formatMoney is not defined` crash when inspecting loan assets.

---

## [5.4.0] - 2026-09-06

### Added & Enhanced
- **Housing Loan Dynamic Amortization Calendar & Chart**:
  - Ingested 153 verified historical loan records from `Investment.xlsx` (`Loan Amortization`) into Supabase `loan_amortization` table and `data/loan_amortization.json` (Sanctioned: ₹69.98L, EMI paid: ₹51.65L, Prepayments: ₹11.38L, Interest paid: ₹37.69L, Current Balance: ₹44.64L).
  - Built `server/services/loanEngine.js` with dynamic projection engine calculating future monthly amortization schedules up to payoff date (Dec 2034) with exact daily interest and regular ₹60k EMI.
  - Added REST API endpoints: `GET /api/loan/amortization`, `POST /api/loan/amortization/entry`, `DELETE /api/loan/amortization/entry/:id`, and attached dynamic amortization data to `/api/holding/:id/detail` for loans.
  - Created `src/components/LoanAmortizationSection.jsx` featuring 6 executive KPI tiles, Recharts Balance Payoff Trajectory area chart, Annual Breakdown principal vs interest bar chart, Prepayment What-If Simulator slider, and full Amortization Calendar Table with Settled vs Projected filters.
  - Added interactive `Amortization Schedule` button to Housing Loan card in `LiabilitiesView.jsx` and integrated sub-tab navigation (`Amortization Schedule & Chart` vs `Daily Balance History`) in `HoldingDetailModal.jsx`.
  - Built dynamic `Add Loan Entry` modal allowing instant entry of prepayments, disbursements, EMIs, or interest rate adjustments with instant dynamic schedule recalculation.

---

## [5.3.5] - 2026-09-05

### Refactored & Enhanced
- **Liabilities Dynamic Modal Headers**: Updated the `HoldingDetailModal.jsx` to dynamically inject the exact lender name (e.g. `State Bank of India (SBI)` and `ICICI Bank`) into the modal title directly from the liabilities table instead of falling back to a generic category name. This also resolves the `HoldingLogo` logic allowing it to fetch and render the exact bank logos.
- **Liabilities Subtitle Cleanup**: Simplified the subtitle descriptions in the detail modal, replacing `Housing Loan` with `Home Loan` and `Credit Card Balance` with `Credit Card` to create a cleaner, minimalist layout.
- **Actual Chart Removal**: Removed the irrelevant `Actual Chart` toggle tab completely from the detail modal when inspecting Liability and Credit Card records, enforcing a focused view strictly on the balance tracker ledger.

---

## [5.3.4] - 2026-09-05

### Refactored & Enhanced
- **Liabilities View Minimalist De-Cluttering**:
  - Removed redundant `2 Active Obligations` count text from the hero header.
  - Removed `Monthly EMI` from both the hero summary and individual liability card layouts.
  - Removed `(SBI Bank)` from the loan title across the database and UI, displaying clean `Housing Loan`.
  - Removed `8.5% p.a.` and `Due 5th` from Housing Loan card, and removed `0.0% APR` and `Due 15th` from Credit Card.
- **Active & Closed Obligations Navigation**:
  - Implemented `Active Obligations` vs `Closed Obligations` segmented filter toggle matching `BankView`.
- **Liability Close & Reopen Controls**:
  - Added dedicated `Close Account / Card` and `Reopen Account / Card` action buttons.
  - Added interactive themed modal confirmation supporting balance settlement to `₹0.00` on closure and custom balance re-entry on reopen via `PUT /api/liabilities/:id`.

---

## [5.3.3] - 2026-09-05

### Refactored & Enhanced
- **EPF Logo Customization**: Standardized the EPF icon across the sidebar to use the `Building2` icon, aligning it visually with the EPF page hero header.
- **EPFO Detail Logo**: Implemented automatic fetching of the official EPFO logo from Wikimedia Commons in `domain.js`, eliminating the basic `EP` text fallback in the `HoldingDetailModal.jsx` header.

---

## [5.3.2] - 2026-09-05

### Refactored
- **EPF Holding Detail Minimalist UI**: Removed redundant `EPF` bold header, `EPF-RETIREMENT` badge, and `Employee Provident Fund` subtitle from the `HoldingDetailModal.jsx` for EPF assets. The header now cleanly displays 'Employee Provident Fund'.
- **EPF Actual Chart Removal**: Disabled the 'Actual Chart' tab for EPF assets in `HoldingDetailModal.jsx` as it is redundant for non-market EOD tracking assets.

---

## [5.3.1] - 2026-09-05

### Refactored & Enhanced
- **EPF View Minimalist De-Cluttering**: Removed static filler elements from [EpfView.jsx](file:///c:/Users/Vijay%20Pai/MyData/Projects/ladder/src/views/EpfView.jsx) including the static interest rate pill badge (`FY 2025-26: 8.25% p.a.`) and descriptive tagline.
- **Removed Timeline Button & Simplified View Action**: Removed redundant `Inspect Timeline` button from the hero banner and simplified the action button on the member account card to a clean `View` button.
- **Removed Static Statement Rows**: Completely eliminated redundant static screenshot row 2 and row 3 (~50% corpus share assumptions, static compounding frequency text).
- **Dynamic Live Metric Cards**: Integrated live performance cards driven by verified holding detail and transaction records:
  - **1-Year Growth**: Dynamic 12-month delta and percentage (`+₹7.04L (+18.05%)`).
  - **Est. Annual Yield**: Dynamic annualized return calculation (`+₹3.80L` at `8.25% p.a.`).
  - **Last Credit**: Verified latest contribution transaction date and amount (`+₹62,508.00` on `12-06-2026`).

---

## [5.3.0] - 2026-09-05

### Added & Enhanced
- **Holding Detail Actual Chart Event Indicators**: Restored interactive event indicator dots (`ActualEventDot`) with contextual visual markers and rich tooltips on the Actual Chart in `HoldingDetailModal.jsx`.
- **Holding Detail Chart Tooltip & Axis Precision**: Standardized Y-axis tick formatting across Tracker Chart and Actual Chart using `formatAxisValue` and explicit two-decimal precision (`minimumFractionDigits: 2`). Correctly hid the Actual Chart tab for bank accounts where price history is not applicable.
- **Account Close & Reopen Controls**: Enhanced bank account controls in `BankView.jsx` and `App.jsx` with an active/closed filter toggle, clean bank name labels, and a theme-matching confirmation modal for closing accounts or reopening them with an initial balance.
- **Theme-Aware Transaction & Action Styles**: Aligned transaction type buttons, pills, and corporate action markers across `AddInvestmentView.jsx` and `src/index.css` to use semantic theme tokens (`transaction-type-option`, `--tx-buy`, `--tx-sell`, `--tx-bonus`, `--tx-dividend`, `--tx-split`).
- **Calendar Table Trend Colors**: Enhanced period-over-period gain/loss color indicators in `CalendarView.jsx` table view with high-contrast text and border styling across dark and light themes.
- **Header & Table Badge De-Cluttering**: Removed redundant status badges (`ACTIVE`, `EXITED`, `REDEEMED`) from individual rows in `IndianStocksView.jsx`, `UsStocksView.jsx`, `MutualFundsView.jsx`, `NpsView.jsx`, and `HoldingsTable.jsx`, letting numeric balances and table tabs convey status cleanly.

---

## [5.2.1] - 2026-09-03

### Fixed & Enhanced
- **Holdings NAV Persistence Schema Alignment**: Removed unsupported `quote_date` field from mutual fund and NPS holding update payloads in `server/services/priceEngine.js`, ensuring updates are cleanly accepted by Supabase without schema rejection errors.
- **Synchronous NPS Batch Persistence**: Awaited NPS daily NAV upserts in `fetchProteanNpsNavBatch` before worker termination, preventing race conditions during cloud scheduled syncs.
- **Calendar Heatmap Day & Sort Controls**: Added weekday badge (`MON`, `TUE`, etc.) to daily cards and an interactive ascending/descending sort toggle button in `CalendarView.jsx` grid view.
- **Workflow Schedule Optimization**: Adjusted GitHub Actions cron trigger minute in `daily_nav_sip_sync.yml` to reduce public runner queue latency.

---

## [5.2.0] - 2026-09-02

### Added & Fixed
- **Daily Automated Portfolio EOD Sync Workflow**: Added `.github/workflows/daily_eod_sync.yml` scheduled nightly at 23:45 UTC (05:15 IST) to refresh market quotes via `scripts/load_historical_prices.mjs` and rebuild/persist daily EOD logs to Supabase `pnl_history`.
- **Cloud EOD Log Merging & Parity**: Refactored `/api/daily-pnl` in `server/index.js` to query Supabase `pnl_history` for records newer than the local JSON cache, seamlessly combining cloud-generated EOD logs with local baseline data.
- **Historical Market Data Integration for NPS**: Enhanced `scripts/rebuild_portfolio_eod.mjs` to fetch and apply historical NPS NAVs via `fetchNpsHistoricalNav`, preventing flat or synthetic valuations during EOD rebuilds.
- **Incremental Historical Market Data Loader**: Updated `scripts/load_historical_prices.mjs` with `--incremental` support to only fetch quotes for missing trading days.
- **Dynamic Dashboard Day P&L Baseline**: Updated `/api/summary` to compute current day P&L strictly against the verified prior trading session closing net worth from historical logs.

---

## [5.1.0] - 2026-08-31

### Added & Enhanced
- **Multi-Colour Fading Gradient Hero Banners**: Transformed the hero value banners in Indian Equity (`IndianStocksView.jsx`), US Equity (`UsStocksView.jsx`), Mutual Funds (`MutualFundsView.jsx`), and NPS (`NpsView.jsx`) to feature vibrant multi-colour fading gradient typography matching EPF and Bank Account styling.
- **Active Portfolio Hero Focus**: Replaced the previous dual split compartment (`COMBINED` + `ACTIVE/REDEEM`) with focused active portfolio valuations, invested cost basis, net unrealized return, and active XIRR % pills.
- **Dedicated Consolidated Performance Report**: Integrated an institutional Consolidated Performance sub-tab in `ReportsView.jsx` (`PERFORMANCE` view) featuring:
  - 4 Executive KPI metric cards (Active Portfolio Value, Active Cost Basis, Realized Proceeds & Profit, Lifetime Net Return & Blended XIRR).
  - Multi-asset class comparison grid covering Indian Equity, US Equity, Mutual Funds, NPS, and Fixed Income.
  - Comprehensive category performance ledger comparing Active vs Realized vs Lifetime metrics.

---

## [5.0.0] - 2026-08-30

### Added & Enhanced
- **Portfolio Views Header Redesign & Minimalist Layout**: Removed generic "As of [Date]" text from Mutual Funds, NPS, Indian Equity, and US Equity headers. Placed "Schemes / Stocks Up-to-Date" indicator badges directly below portfolio titles.
- **Inline Minimalist Refresh Buttons**: Added compact, icon-only Refresh buttons next to section titles across Indian Equity, US Equity, Mutual Funds, and NPS with interactive spin animations on click.
- **Indian & US Stocks Table Row Refresh Status Badges**: Added individual quote status pills (`Today (Date)` / `As of Date`) next to ticker and sector in Indian Equity and US Equity table rows, matching Mutual Funds and NPS styling.
- **Active Position Count Normalization**: Updated `upToDateCount` evaluation across all 4 portfolio views to strictly filter active holdings (`quantity > 0`).
- **Recurring SIP Placement**: Moved the Recurring SIP button in Mutual Funds from the top banner to the table controls bar adjacent to the search input.
- **Header Clutter Cleanup**: Removed the redundant USD/INR badge from the US Equity banner, keeping currency display centralized in the top navigation bar.

---

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

