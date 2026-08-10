import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Landmark, Plus, TrendingUp, ArrowUpRight, ArrowDownRight, 
  Shield, CheckCircle2, ChevronRight, Activity, Wallet, BarChart3
} from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';

const BANK_LOGOS = {
  'HDFC': { label: 'HDFC', color: 'from-blue-600 to-indigo-700', bg: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  'INDUSIND': { label: 'IndusInd', color: 'from-amber-600 to-orange-700', bg: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  'IDFC': { label: 'IDFC FIRST', color: 'from-purple-600 to-violet-700', bg: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
  'RBL': { label: 'RBL', color: 'from-rose-600 to-red-700', bg: 'bg-rose-500/10 text-rose-400 border-rose-500/30' },
  'SBI': { label: 'SBI', color: 'from-sky-600 to-blue-700', bg: 'bg-sky-500/10 text-sky-400 border-sky-500/30' },
  'FEDERAL': { label: 'Federal', color: 'from-emerald-600 to-teal-700', bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' }
};

export default function BankView({ holdings, onSelectHolding, onOpenAddModal }) {
  const { formatMoney } = useThemeAuth();

  // Filter bank holdings
  const bankHoldings = holdings.filter(h => h.category_id === 'bank');
  
  // Total Savings Balance
  const totalSavings = bankHoldings.reduce((sum, h) => sum + (Number(h.current_price) || 0), 0);
  
  // Top Bank Account by balance
  const topAccount = bankHoldings.length > 0 
    ? [...bankHoldings].sort((a, b) => (Number(b.current_price) || 0) - (Number(a.current_price) || 0))[0] 
    : null;

  return (
    <AnimatedPage className="space-y-6">
      
      {/* Top Hero Banner */}
      <AnimatedItem>
        <div className="glass-card p-6 rounded-3xl border border-slate-800 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 tracking-wider uppercase">
                SAVINGS & CASH
              </span>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                • 6 Bank Accounts
              </span>
            </div>
            <h2 className="text-2xl font-black text-white flex items-center gap-2.5">
              <Landmark className="w-6 h-6 text-emerald-400" />
              Bank Accounts & Cash Holdings
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Daily End-of-Day balance tracking across primary savings, salary, and liquid deposit accounts since inception.
            </p>
          </div>

          <div className="flex items-center gap-5 relative z-10 shrink-0">
            <div className="text-right">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                Total Bank Savings
              </span>
              <div className="text-2xl font-black font-mono bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
                {formatMoney(totalSavings)}
              </div>
              <div className="text-[10px] text-emerald-400 font-bold font-mono mt-0.5">
                Top: {topAccount ? topAccount.name.split(' ')[0] : '—'} ({totalSavings > 0 ? ((Number(topAccount?.current_price || 0) / totalSavings) * 100).toFixed(1) : 0}%)
              </div>
            </div>

            <motion.button
              onClick={onOpenAddModal}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-obsidian-950 font-black rounded-2xl text-xs shadow-lg shadow-emerald-500/25"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              Add Bank Account
            </motion.button>
          </div>

          {/* Background glowing orb */}
          <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        </div>
      </AnimatedItem>

      {/* Visual Asset Allocation Breakdown Bar */}
      {totalSavings > 0 && (
        <AnimatedItem>
          <div className="glass-card p-5 rounded-3xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                Bank Allocation Share
              </span>
              <span className="font-mono text-slate-400 font-semibold text-[11px]">
                {bankHoldings.length} Active Accounts
              </span>
            </div>

            {/* Distribution Bar */}
            <div className="h-3.5 w-full bg-slate-900 rounded-full overflow-hidden flex gap-0.5 p-0.5 border border-slate-800">
              {bankHoldings.map((h) => {
                const val = Number(h.current_price) || 0;
                const pct = (val / totalSavings) * 100;
                if (pct <= 0) return null;
                const key = Object.keys(BANK_LOGOS).find(k => h.name.toUpperCase().includes(k)) || 'HDFC';
                const style = BANK_LOGOS[key] || BANK_LOGOS['HDFC'];
                return (
                  <div
                    key={h.id}
                    style={{ width: `${Math.max(2, pct)}%` }}
                    className={`h-full rounded-sm bg-gradient-to-r ${style.color} transition-all duration-500`}
                    title={`${h.name}: ${pct.toFixed(1)}%`}
                  />
                );
              })}
            </div>

            {/* Legend Pills */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {bankHoldings.map((h) => {
                const val = Number(h.current_price) || 0;
                const pct = (val / totalSavings) * 100;
                const key = Object.keys(BANK_LOGOS).find(k => h.name.toUpperCase().includes(k)) || 'HDFC';
                const style = BANK_LOGOS[key] || BANK_LOGOS['HDFC'];
                return (
                  <div 
                    key={h.id} 
                    onClick={() => onSelectHolding(h)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-900/80 border border-slate-800 text-[11px] cursor-pointer hover:border-emerald-500/40 transition-colors"
                  >
                    <span className={`w-2 h-2 rounded-full bg-gradient-to-r ${style.color}`} />
                    <span className="text-slate-300 font-semibold">{h.name.split(' ')[0]}</span>
                    <span className="font-mono text-slate-500 text-[10px]">{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </AnimatedItem>
      )}

      {/* Bank Account Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {bankHoldings.map((h) => {
          const val = Number(h.current_price) || 0;
          const sharePct = totalSavings > 0 ? (val / totalSavings) * 100 : 0;
          const key = Object.keys(BANK_LOGOS).find(k => h.name.toUpperCase().includes(k)) || 'HDFC';
          const style = BANK_LOGOS[key] || BANK_LOGOS['HDFC'];

          return (
            <AnimatedCard key={h.id}>
              <div 
                onClick={() => onSelectHolding(h)}
                className="glass-card p-5 rounded-3xl border border-slate-800/80 hover:border-emerald-500/40 transition-all duration-300 group cursor-pointer flex flex-col justify-between h-full space-y-4"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black border ${style.bg}`}>
                      {style.label} SAVINGS
                    </span>
                    <span className="text-[10px] font-bold text-slate-500 font-mono flex items-center gap-1">
                      <Activity className="w-3 h-3 text-emerald-400" />
                      EOD Tracked
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-white group-hover:text-emerald-300 transition-colors">
                    {h.name}
                  </h3>
                  <p className="text-[11px] text-slate-500 mt-0.5">Primary Savings Account</p>
                </div>

                <div className="space-y-3 pt-3 border-t border-slate-800/80">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Current Balance</span>
                    <span className="text-xl font-black font-mono text-white group-hover:text-emerald-400 transition-colors">
                      {formatMoney(val)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-400 font-mono pt-1">
                    <span>Portfolio Share</span>
                    <span className="font-bold text-slate-200">{sharePct.toFixed(1)}%</span>
                  </div>

                  <button 
                    onClick={(e) => { e.stopPropagation(); onSelectHolding(h); }}
                    className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-emerald-500/15 border border-slate-800 hover:border-emerald-500/30 text-slate-300 hover:text-emerald-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5 group/btn"
                  >
                    <span>View Daily EOD Timeline</span>
                    <ChevronRight className="w-3.5 h-3.5 group-hover/btn:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            </AnimatedCard>
          );
        })}
      </div>

    </AnimatedPage>
  );
}
