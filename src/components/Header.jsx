import React from 'react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { 
  Sun, 
  Moon, 
  RefreshCw, 
  TrendingUp, 
  ShieldCheck, 
  Database, 
  Calendar, 
  PieChart, 
  Briefcase, 
  DollarSign, 
  IndianRupee,
  LogOut,
  PlusCircle
} from 'lucide-react';

export default function Header({ activeTab, setActiveTab, onRefreshPrices, isRefreshing, onOpenAddModal }) {
  const { theme, toggleTheme, currency, toggleCurrency, user, logout } = useThemeAuth();

  return (
    <header className="sticky top-0 z-40 glass-panel border-b border-slate-800/60 px-6 py-3.5 mb-8 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        
        {/* Brand & Logo */}
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('dashboard')}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <TrendingUp className="w-6 h-6 text-white stroke-[2.5]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                LADDER
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-full">
                INSTITUTIONAL
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">Finance & Portfolio Co-Pilot</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1 bg-slate-900/60 p-1.5 rounded-2xl border border-slate-800/60 overflow-x-auto max-w-full">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'dashboard' 
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 shadow-md shadow-emerald-500/20 font-bold' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Briefcase className="w-4 h-4" /> Dashboard
          </button>

          <button
            onClick={() => setActiveTab('calendar')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'calendar' 
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 shadow-md shadow-emerald-500/20 font-bold' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Calendar className="w-4 h-4" /> Daily P&L
          </button>

          <button
            onClick={() => setActiveTab('dividends')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'dividends' 
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 shadow-md shadow-emerald-500/20 font-bold' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <DollarSign className="w-4 h-4" /> Dividends
          </button>

          <button
            onClick={() => setActiveTab('reports')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'reports' 
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 shadow-md shadow-emerald-500/20 font-bold' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <PieChart className="w-4 h-4" /> Reports
          </button>

          <button
            onClick={() => setActiveTab('database')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'database' 
                ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 shadow-md shadow-emerald-500/20 font-bold' 
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
            }`}
          >
            <Database className="w-4 h-4" /> DB Viewer
          </button>
        </nav>

        {/* Action Controls & Utilities */}
        <div className="flex items-center gap-2.5">
          {/* Add Asset Button */}
          <button
            onClick={onOpenAddModal}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/40 rounded-xl text-xs font-semibold transition-all shadow-sm"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Add Asset</span>
          </button>

          {/* Refresh Prices API Button */}
          <button
            onClick={onRefreshPrices}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 rounded-xl text-xs font-semibold transition-all text-slate-200"
            title="Fetch live prices from NSE/BSE & US markets"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
            <span className="hidden sm:inline">Refresh Prices</span>
          </button>

          {/* Currency Toggle (₹ / $) */}
          <button
            onClick={toggleCurrency}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 rounded-xl text-xs font-bold transition-all text-emerald-400"
            title="Toggle default display currency"
          >
            {currency === 'INR' ? (
              <>
                <IndianRupee className="w-3.5 h-3.5 text-emerald-400" />
                <span>INR</span>
              </>
            ) : (
              <>
                <DollarSign className="w-3.5 h-3.5 text-indigo-400" />
                <span>USD</span>
              </>
            )}
          </button>

          {/* Dark / Light Theme Switch */}
          <button
            onClick={toggleTheme}
            className="p-2 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 rounded-xl text-slate-300 transition-all"
            title="Switch Theme"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-400" />}
          </button>

          {/* User Profile */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
            <div className="w-8 h-8 rounded-full bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300 text-xs font-bold">
              VP
            </div>
          </div>
        </div>

      </div>
    </header>
  );
}
