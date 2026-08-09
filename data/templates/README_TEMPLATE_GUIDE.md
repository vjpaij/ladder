# Ladder Universal Data Template Guide

This document defines the unified CSV/Excel template schema designed to ingest investment holdings and transaction history for **Indian Stocks**, **US Stocks**, and **Mutual Funds** into the Ladder database platform.

---

## 📋 Unified Column Definitions

| Column Name | Required | Description | Example Values |
| :--- | :---: | :--- | :--- |
| **Asset Category** | Yes | Investment asset class category | `Indian Equities`, `US Equities`, `Mutual Funds` |
| **Portfolio Name** | No | Name of the portfolio owner | `Pai`, `Main Portfolio` |
| **Identifier Code** | Yes | Ticker Symbol or Scheme Code | `AARTIDRUGS`, `MSFT`, `120539` |
| **ISIN** | Optional | International Securities Identification Number | `INE767A01016`, `INF209K01VF2` |
| **Asset Name** | Yes | Full descriptive name of the security | `Aarti Drugs Limited`, `Apple Inc.`, `Axis Small Cap Fund` |
| **Currency** | Yes | Base currency of transaction | `INR` or `USD` |
| **Exchange** | Yes | Exchange platform or registry | `NSE`, `BSE`, `NASDAQ`, `NYSE`, `AMFI` |
| **Transaction Date** | Yes | Execution date (ISO `YYYY-MM-DD` or `DD-Mon-YYYY`) | `2022-10-24`, `15 Sep 2022` |
| **Transaction Type** | Yes | Nature of trade | `BUY` / `Purchase` / `Investment`, `SELL` / `Sale` / `Redemption`, `DIVIDEND` |
| **Quantity** | Yes | Units or shares traded | `16`, `0.250218`, `238.452` |
| **Price NAV** | Yes | Executed price per unit or NAV | `459.70`, `247.78`, `83.87` |
| **Total Amount** | Yes | Gross transaction consideration value | `7355.20`, `62.00`, `20000.00` |
| **Charges** | Optional | Total brokerage, taxes, stamp duty, or fees | `0.00`, `17.05`, `1.00` |

---

## 📁 Source File Mappings (Supported File Formats)

Ladder's automated ingestion engine (`server/scripts/load_portfolio_data.js`) automatically parses and normalizes the following default raw spreadsheet files located in your project root:

1. **Indian Equities (`Indian Stocks/Ind_Stocks.csv`)**:
   - `Transaction Type`: Maps `Purchase` -> `BUY`, `Sale` -> `SELL`, `Dividend` -> `DIVIDEND`.
   - `Symbol`: Ticker code mapped to `holdings.symbol`.
   - `Currency`: Automatically set to `INR`.

2. **Mutual Funds (`Mutual Funds/Ind_Mfs.csv`)**:
   - `Transaction Type`: Maps `Investment` -> `BUY`, `Redemption` -> `SELL`.
   - `Scheme Code`: AMFI Code mapped to `holdings.symbol`.
   - `NAV`: Transaction unit NAV.
   - `Currency`: Automatically set to `INR`.

3. **US Equities (`US Stocks/US_Stocks.xls`)**:
   - Sheet: `ORDER_BOOK`
   - `Transaction Type`: Maps `BUY` -> `BUY`, `SELL` -> `SELL`.
   - `Quantity` & `Price ($)`: Fractional share quantity and USD price.
   - `Currency`: Automatically set to `USD`.

---

## ⚡ Loading Data into Supabase

Run the following command in the server directory:

```bash
node server/scripts/load_portfolio_data.js
```
