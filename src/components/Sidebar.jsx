import React from 'react';
import { motion } from 'framer-motion';
import { 
  LayoutDashboard, 
  Calendar, 
  PieChart, 
  TrendingUp, 
  Globe, 
  LineChart, 
  Landmark, 
  CreditCard, 
  DollarSign, 
  Database, 
  FileSpreadsheet
} from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';

export default function Sidebar({ currentView, setCurrentView, summary }) {
  const { formatMoney, fxRate } = useThemeAuth();

  const navSections = [
    {
      title: 'EXECUTIVE',
      items: [
        { id: 'overview', label: 'Net Worth', icon: LayoutDashboard, badge: 'LIVE' },
        { id: 'calendar', label: 'P&L Calendar', icon: Calendar },
        { id: 'reports', label: 'Reports', icon: PieChart },
      ]
    },
    {
      title: 'PORTFOLIOS',
      items: [
        { id: 'indian_stocks', label: 'Indian Equities', icon: TrendingUp, badge: 'NSE/BSE' },
        { id: 'us_stocks', label: 'US Equities', icon: Globe, badge: 'FX' },
        { id: 'mutual_funds', label: 'Mutual Funds', icon: LineChart, badge: 'NAV' },
        { id: 'fixed_income', label: 'Fixed Income', icon: Landmark },
      ]
    },
    {
      title: 'CASHFLOW',
      items: [
        { id: 'liabilities', label: 'Liabilities', icon: CreditCard },
        { id: 'dividends', label: 'Dividends', icon: DollarSign },
      ]
    },
    {
      title: 'DATA',
      items: [
        { id: 'database', label: 'Database Studio', icon: Database },
        { id: 'excel_tools', label: 'Import & Export', icon: FileSpreadsheet },
      ]
    }
  ];

  return (
    <aside className="w-64 bg-obsidian-950/90 border-r border-slate-800/80 flex flex-col justify-between shrink-0 min-h-screen p-4 backdrop-blur-2xl fixed lg:sticky top-0 z-30 overflow-y-auto">
      
      <div>
        {/* Brand */}
        <div 
          onClick={() => setCurrentView('overview')}
          className="flex items-center gap-3 mb-7 cursor-pointer group px-2"
        >
          <motion.div 
            className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 via-teal-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-emerald-500/25"
            whileHover={{ scale: 1.1, rotate: 5 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            <TrendingUp className="w-5 h-5 text-obsidian-950 stroke-[3]" />
          </motion.div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                LADDER
              </h1>
              <span className="px-1.5 py-0.5 text-[8px] font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-md tracking-wider">
                PRO
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-medium">Investment Dashboard</p>
          </div>
        </div>

        {/* Nav Sections */}
        <div className="space-y-5">
          {navSections.map((section) => (
            <div key={section.title}>
              <h3 className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-slate-600 px-3 mb-1.5">
                {section.title}
              </h3>
              <nav className="space-y-0.5">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentView === item.id;

                  return (
                    <motion.button
                      key={item.id}
                      onClick={() => setCurrentView(item.id)}
                      whileHover={{ x: 3 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ duration: 0.15 }}
                      className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-[13px] font-semibold transition-colors group ${
                        isActive
                          ? 'bg-gradient-to-r from-emerald-500/15 to-indigo-500/8 text-emerald-300 border border-emerald-500/25 shadow-sm shadow-emerald-500/10'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className={`w-4 h-4 ${
                          isActive ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300'
                        }`} />
                        <span>{item.label}</span>
                      </div>

                      {item.badge && (
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${
                          isActive 
                            ? 'bg-emerald-500/25 text-emerald-300' 
                            : 'bg-slate-800/80 text-slate-500'
                        }`}>
                          {item.badge}
                        </span>
                      )}
                    </motion.button>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Net Worth Ticker */}
      <div className="mt-6 pt-3 border-t border-slate-800/80 px-1">
        <motion.div 
          className="glass-subcard p-3 rounded-2xl relative overflow-hidden"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              NET WORTH
            </span>
            <span className="text-[9px] font-mono text-indigo-400">
              $1 = ₹{fxRate}
            </span>
          </div>

          <div className="text-sm font-extrabold font-mono text-white">
            {summary ? formatMoney(summary.netWorthINR) : '₹...'}
          </div>

          <div className="flex items-center justify-between text-[9px] font-medium text-slate-500 mt-1 pt-1 border-t border-slate-800/50">
            <span>XIRR <strong className="text-emerald-400 font-mono">{summary ? summary.xirrPct : 0}%</strong></span>
            <span>ROI <strong className="text-indigo-400 font-mono">+{summary ? summary.absoluteReturnPct : 0}%</strong></span>
          </div>
        </motion.div>
      </div>

    </aside>
  );
}
