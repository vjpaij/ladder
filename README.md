# Ladder - Institutional Finance & Investment Dashboard

Ladder is a modern, stylish, high-performance personal finance and investment dashboard designed for tracking multi-asset portfolios including Indian Stocks, US Equities, Mutual Funds, Fixed Income/Retirement (Bank, FDs, NPS, EPF), Liabilities (Loans, Credit Cards), and Dividends.

---

## Features

- **Multi-Asset Portfolio Tracking**: Indian Stocks (NSE/BSE), US Equities (NASDAQ/NYSE), Mutual Funds (AMFI NAVs), Fixed Income (Bank, FD, NPS, EPF).
- **Liabilities & Debt Hub**: Track outstanding loan principals, credit card balances, interest rates, and monthly EMIs.
- **Real-Time Price Engine**: Live price auto-sync for Indian equities (comparative max pricing between NSE & BSE), US stocks, and AMFI mutual funds.
- **Dual Currency & FX Engine**: Default primary display in INR (₹) with real-time USD/INR live conversion rate ($1 = ₹X) and instant header currency toggle.
- **Advanced Analytics & Reports**: Asset class allocation donut charts, sector concentration bar charts, and growth trajectory performance vs. Nifty 50 benchmark.
- **P&L Calendar Heatmap**: Visual trading session green/red day calendar, date range filtering, win rate metrics, and day-by-day P&L inspection.
- **Dividends Ledger**: India & US dividend cashflow tracker with automatic currency conversion and annualized yield calculation.
- **Supabase Cloud Database & Automated Triggers**: Powered by Supabase PostgreSQL with automated PL/pgSQL triggers for position calculation, realized/unrealized PnL, charges, and Row Level Security (RLS) policies.
- **Relational Database Studio**: Embedded visual database viewer and CRUD editor for direct inline table record management and auto-cascade updates.
- **Data Import & Export**: Excel/CSV portfolio parser and full database backup snapshot exporter.
- **Modern Fintech Aesthetics**: Modern floating glass-card layout, dynamic collapsible sidebar rail, Framer Motion staggered animations, odometer-style counting numbers, and micro-interactions.
- **Universal Multi-Theme System**: 6 custom high-contrast palettes spanning Dark Themes (Obsidian Dark, Midnight Blue, Sunset Rose) and Light Themes (Clean Light, Warm Sand, Nordic Frost), ensuring deep oceanic/plum gradients and crisp light layouts with theme-aware navigation highlights and popups.

---

## Tech Stack

- **Frontend**: React 18, Vite, Tailwind CSS v4, Framer Motion, Recharts, Lucide Icons
- **Backend**: Express.js, Node.js, Axios, JWT Authentication, Bcrypt
- **Database**: Supabase Cloud PostgreSQL, `@supabase/supabase-js`, Row Level Security (RLS), Supabase Vault
- **Automation**: PL/pgSQL database triggers & audit functions

---

## Quick Start & Installation

### Prerequisites
- Node.js (v18 or higher recommended)
- npm or yarn

### Installation Steps

1. **Clone the repository**:
   ```bash
   git clone https://github.com/vjpaij/ladder.git
   cd ladder
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Create a `.env` file in the project root:
   ```env
   VITE_SUPABASE_URL=https://ladder.supabase.co
   SUPABASE_URL=https://ladder.supabase.co
   SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. **Start the application**:
   - Run Express server & Vite dev server:
     ```bash
     npm run server
     npm run dev
     ```
   - Access the web interface at `http://localhost:3000`.

---

## Default Credentials

- **Email**: `admin@ladder.com`
- **Password**: `admin123`

---

## License

This project is open-source under the [MIT License](LICENSE).
