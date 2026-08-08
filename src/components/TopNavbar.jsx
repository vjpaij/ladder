import React from 'react';
import { motion } from 'framer-motion';
import { 
  Search, 
  RefreshCw, 
  Sun, 
  Moon, 
  Plus, 
  DollarSign, 
  IndianRupee, 
  Globe
} from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';

export default function TopNavbar({ onRefreshPrices, isRefreshing, onOpenAddModal }) {
  const { theme, toggleTheme, currency, toggleCurrency, user, fxRate } = useThemeAuth();

  return (
    <header className="sticky top-0 z-20 bg-obsidian-950/80 backdrop-blur-xl border-b border-slate-800/80 px-6 py-3 flex items-center justify-between gap-4">
      
      {/* Search */}
      <div className="relative w-64 md:w-80">
        <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          placeholder="Search tickers, assets..."
          className="w-full pl-10 pr-12 py-2 bg-slate-900/90 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-slate-800 text-[9px] font-mono text-slate-500 border border-slate-700">
          ⌘K
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2.5">
        
        {/* Market Status */}
        <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 bg-slate-900/60 border border-slate-800 rounded-xl text-[10px] font-semibold text-slate-400">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <motion.span 
              className="w-1.5 h-1.5 rounded-full bg-emerald-400"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            NSE/BSE
          </span>
          <span className="text-slate-700">|</span>
          <span className="flex items-center gap-1.5 text-indigo-400">
            <motion.span 
              className="w-1.5 h-1.5 rounded-full bg-indigo-400"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
            />
            NASDAQ
          </span>
        </div>

        {/* FX Rate */}
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900/80 border border-slate-800 rounded-xl text-[10px] font-mono text-slate-400">
          <Globe className="w-3 h-3 text-emerald-500" />
          <span>₹{fxRate}</span>
        </div>

        {/* Sync Prices */}
        <motion.button
          onClick={onRefreshPrices}
          disabled={isRefreshing}
          whileTap={{ scale: 0.95 }}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-700/60 rounded-xl text-xs font-bold text-slate-300 shadow-sm"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span className="hidden md:inline">{isRefreshing ? 'Syncing...' : 'Sync'}</span>
        </motion.button>

        {/* Currency */}
        <motion.button
          onClick={toggleCurrency}
          whileTap={{ scale: 0.95 }}
          className="flex items-center gap-1 px-2.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-bold"
        >
          {currency === 'INR' ? (
            <span className="flex items-center gap-1 text-emerald-400">
              <IndianRupee className="w-3.5 h-3.5" />₹
            </span>
          ) : (
            <span className="flex items-center gap-1 text-indigo-400">
              <DollarSign className="w-3.5 h-3.5" />$
            </span>
          )}
        </motion.button>

        {/* Theme */}
        <motion.button
          onClick={toggleTheme}
          whileTap={{ scale: 0.9, rotate: 180 }}
          transition={{ duration: 0.3 }}
          className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-slate-300"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-400" />}
        </motion.button>

        {/* Add */}
        <motion.button
          onClick={onOpenAddModal}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-obsidian-950 font-black rounded-xl text-xs shadow-lg shadow-emerald-500/20"
        >
          <Plus className="w-4 h-4 stroke-[3]" />
          <span className="hidden md:inline">Add</span>
        </motion.button>

        {/* User Avatar */}
        <div className="pl-2 border-l border-slate-800">
          <motion.div 
            whileHover={{ scale: 1.08 }}
            className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-black shadow-md cursor-pointer"
          >
            {user?.avatar || 'VP'}
          </motion.div>
        </div>

      </div>
    </header>
  );
}
