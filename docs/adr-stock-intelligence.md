# ADR: Indian Stock Intelligence and Exit Review

**Status:** Implemented with data-source and validation gates open  
**Date:** 2026-10-11

## Decision

Add a separate, read-only stock intelligence service and Executive page. It consumes the existing local daily-close cache, holdings, transaction ledger, and asset metadata. It does not change portfolio accounting, holdings, transactions, cash, or P&L. A state transition is recorded in a separate user-keyed audit file under `data/`; the risk-limit preference is also stored separately. No broker integration or automatic sell is permitted.

## Rule and backtest protocol

- Aggregate daily closes into completed weekly closes; omit the current week on weekdays.
- Raise `WATCH` after two weekly closes below the 30-week simple moving average.
- Raise `TECHNICAL_TRIM_CANDIDATE` only after three such closes while the average is lower than it was four weeks earlier.
- Clear a watch after two weekly closes above the average.
- Execute simulated signals at the next available daily close.
- Split time into training (2012–2019), validation (2020–2022), and held-out test (2023 onward). Compare 25%, 50%, and full-position trims against buy-and-hold. Apply a 0.50% one-way trading-friction assumption; exclude tax.
- A technical share quantity is actionable only if a validation-selected trim also meets held-out average-return and maximum-drawdown checks. A separate concentration quantity is calculated only when the user enters a maximum position weight. Other displayed quantities are research scenarios, not recommendations.

## Data limitations and source decision

Repository inspection found 396 local price series covering 2008-08-22 through 2026-10-09, 82 active Indian-equity positions, 11,622 transactions, and metadata for 346 assets. The local series contain daily closes only, not a fully audited OHLCV/corporate-action record. Current holdings form a survivor-biased universe. No point-in-time fundamentals, official filing snapshots, benchmark/sector histories, or licensed historical universe are present.

Automated Screener ingestion is not enabled. Its published terms grant personal, non-commercial, transitory viewing and restrict copying or mirroring. NSE says historical/equity data access is covered by subscriber agreements and its paid historical-data materials. Existing Yahoo-derived local cache may be used only for this local exploratory analysis; the project has not verified rights for new collection or redistribution. No new scraping or broad-market crawling is introduced.

Sources reviewed:

- [Screener.in Terms of Service](https://www.screener.in/guides/terms/)
- [NSE Data Sharing & Usage Policy](https://www.nseindia.com/static/market-data/nse-data-policy)
- [NSE EOD and Historical Data subscription](https://www.nseindia.com/static/market-data/eod-historical-data-subscription)
- [Yahoo API Terms](https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html)

## Snapshot backtest result

On the local 2026-10-11 data snapshot, eligible holdings were 47 in training, 54 in validation, and 79 in the held-out test. No trim size passed both held-out average-CAGR and maximum-drawdown checks, so the engine intentionally emits no backtest-validated technical sell quantity.

The validation's return-preserving drawdown scenario was a 25% trim: average CAGR 47.30% versus buy-and-hold 50.86%, and average maximum drawdown -48.79% versus -52.45%. In the held-out test it returned 35.92% average CAGR versus 38.29% for buy-and-hold, with average maximum drawdown -45.01% versus -47.66%. Among 200 test exits with a complete ~six-month forward window, 112 (56%) were followed by a further 10% or more price rise. These results are exploratory portfolio averages, not a success probability for any individual stock.

## Gates still open

- Secure a permitted, point-in-time fundamental source and official filing feed before fundamental states or critical-event warnings can be enabled.
- Obtain and document a licensed/authorized historical OHLCV source with adjusted corporate actions, dividends, benchmark/sector series, and delisted instruments before treating backtests as robust.
- Have effective-date Indian tax-lot estimates reviewed by a qualified professional before presenting tax figures.
- Keep external notifications disabled until the required data quality, false-alert, missed-upside, and restore/rollback review gates pass. Stock-intelligence state/config are included in local/cloud backups and restores.
