# Ladder - Institutional Finance & Investment Dashboard 🚀

Ladder is a modern, stylish, high-performance personal finance and investment dashboard designed for tracking multi-asset portfolios including Indian Stocks, US Equities, Mutual Funds, Fixed Income/Retirement (Bank, FDs, NPS, EPF), Liabilities (Loans, Credit Cards), and Dividends.

![Ladder Dashboard Preview](https://raw.githubusercontent.com/placeholder/ladder-preview.png)

---

## ✨ Features

- 💼 **Multi-Asset Portfolio Tracking**: Indian Stocks (NSE/BSE), US Equities (NASDAQ/NYSE), Mutual Funds (AMFI NAVs), Fixed Income (Bank, FD, NPS, EPF).
- ⚖️ **Liabilities & Debt Hub**: Track outstanding loan principals, credit card balances, interest rates, and monthly EMIs.
- 📈 **Real-Time Price Engine**: Live price auto-sync for Indian equities (comparative max pricing between NSE & BSE), US stocks, and AMFI mutual funds.
- 💵 **Dual Currency & FX Engine**: Default primary display in INR (₹) with real-time USD/INR live conversion rate ($1 = ₹X) and instant header currency toggle.
- 📊 **Advanced Analytics & Reports**: Asset class allocation donut charts, sector concentration bar charts, and growth trajectory performance vs. Nifty 50 benchmark.
- 📅 **P&L Calendar Heatmap**: Visual trading session green/red day calendar, date range filtering, win rate metrics, and day-by-day P&L inspection.
- 💰 **Dividends Ledger**: India & US dividend cashflow tracker with automatic currency conversion and annualized yield calculation.
- 🛠️ **Relational Database Studio**: Embedded visual database viewer and CRUD editor for direct inline table record management and auto-cascade updates.
- 📁 **Data Import & Export**: Excel/CSV portfolio parser and full database backup snapshot exporter.
- 🎨 **Modern Fintech Aesthetics**: Dark mode, glassmorphism card surfaces, Framer Motion staggered animations, odometer-style counting numbers, and micro-interactions.

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS v4, Framer Motion, Recharts, Lucide Icons
- **Backend**: Express.js, Node.js, Axios, JWT Authentication, Bcrypt
- **Database**: In-memory / JSON Relational Engine with SQLite-compatible schema structure

---

## 🚀 Quick Start & Installation

### Prerequisites
- Node.js (v18 or higher recommended)
- npm or yarn

### Installation Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ladder.git
   cd ladder
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the application**:
   - Run Express server & Vite dev server simultaneously:
     ```bash
     npm run server
     npm run dev
     ```
   - Access the web interface at `http://localhost:3000`.

---

## 🔑 Default Credentials

- **Email**: `admin@ladder.com`
- **Password**: `admin123`

---

## 📄 License

This project is open-source under the [MIT License](LICENSE).
