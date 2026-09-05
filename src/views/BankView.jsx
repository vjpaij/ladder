import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Landmark, Plus, TrendingUp, ArrowUpRight, ArrowDownRight, 
  Shield, CheckCircle2, ChevronRight, Wallet, BarChart3, LockKeyhole
} from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';
import HoldingLogo from '../components/HoldingLogo';

const BANK_LOGOS = {
  'HDFC': { label: 'HDFC', color: 'from-blue-600 to-indigo-700', bg: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  'INDUSIND': { label: 'IndusInd', color: 'from-amber-600 to-orange-700', bg: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  'IDFC': { label: 'IDFC FIRST', color: 'from-purple-600 to-violet-700', bg: 'bg-purple-500/10 text-purple-400 border-purple-500/30' },
  'RBL': { label: 'RBL', color: 'from-rose-600 to-red-700', bg: 'bg-rose-500/10 text-rose-400 border-rose-500/30' },
  'SBI': { label: 'SBI', color: 'from-sky-600 to-blue-700', bg: 'bg-sky-500/10 text-sky-400 border-sky-500/30' },
  'FEDERAL': { label: 'Federal', color: 'from-emerald-600 to-teal-700', bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' }
};

export default function BankView({ holdings, onSelectHolding, onOpenAddModal, onCloseHolding }) {
  const { formatMoney } = useThemeAuth();
  const [accountFilter, setAccountFilter] = useState('open');
  const [accountAction, setAccountAction] = useState(null);
  const [reopenBalance, setReopenBalance] = useState('0');

  const cleanBankName = (name = '') => name.replace(/\s*\(SBI\)/gi, '').trim();

  // Filter bank holdings
  const allBankHoldings = holdings.filter(h => h.category_id === 'bank');
  const bankHoldings = allBankHoldings.filter(h => {
    const isClosed = h.status === 'closed' || Number(h.current_price) <= 0;
    return accountFilter === 'closed' ? isClosed : !isClosed;
  });
  
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
                SAVINGS
              </span>
            </div>
            <h2 className="text-2xl font-black text-white flex items-center gap-2.5">
              <Landmark className="w-6 h-6 text-emerald-400" />
              Bank Accounts
            </h2>
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
                Top: {topAccount ? cleanBankName(topAccount.name).split(' ')[0] : '—'} ({totalSavings > 0 ? ((Number(topAccount?.current_price || 0) / totalSavings) * 100).toFixed(1) : 0}%)
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
                {bankHoldings.length} {accountFilter === 'closed' ? 'Closed' : 'Open'} Accounts
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
                    <span className="text-slate-300 font-semibold">{cleanBankName(h.name).split(' ')[0]}</span>
                    <span className="font-mono text-slate-500 text-[10px]">{pct.toFixed(1)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </AnimatedItem>
      )}

      <div className="flex justify-center">
        <div className="flex items-center gap-1 p-1 bg-slate-900/70 border border-slate-800 rounded-xl">
          {[
            { id: 'open', label: 'Open Accounts' },
            { id: 'closed', label: 'Closed Accounts' }
          ].map(option => (
            <button
              key={option.id}
              onClick={() => setAccountFilter(option.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${accountFilter === option.id ? 'bg-slate-800 text-emerald-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bank Account Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {bankHoldings.map((h, i) => {
          const val = Number(h.current_price) || 0;
          const isClosed = h.status === 'closed' || val <= 0;
          const sharePct = totalSavings > 0 ? (val / totalSavings) * 100 : 0;
          const key = Object.keys(BANK_LOGOS).find(k => h.name.toUpperCase().includes(k)) || 'HDFC';
          const style = BANK_LOGOS[key] || BANK_LOGOS['HDFC'];

          return (
            <AnimatedCard key={h.id} delay={i * 0.05} className="group h-full">
              <div 
                onClick={() => onSelectHolding(h)}
                className={`cursor-pointer glass-card h-full p-5 rounded-3xl border transition-all duration-300 flex flex-col justify-between gap-4 ${
                  isClosed
                    ? 'border-slate-700/80 opacity-75 grayscale-[35%]'
                    : 'border-slate-800 hover:border-emerald-500/40'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-black border ${style.bg}`}>
                      {style.label} SAVINGS
                    </span>
                    <span className={`text-[10px] font-bold font-mono flex items-center gap-1 ${isClosed ? 'text-slate-500' : 'text-emerald-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${isClosed ? 'bg-slate-500' : 'bg-emerald-400'}`} />
                      {isClosed ? 'CLOSED' : 'OPEN'}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 mt-1">
                    <HoldingLogo 
                      holding={h} 
                      className="w-8 h-8 rounded-lg shadow-sm"
                    />
                    <h3 className="text-base font-bold text-white group-hover:text-emerald-300 transition-colors">
                      {cleanBankName(h.name)}
                    </h3>
                  </div>
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
                    <span>View</span>
                    <ChevronRight className="w-3.5 h-3.5 group-hover/btn:translate-x-1 transition-transform" />
                  </button>
                  {isClosed ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); setReopenBalance(String(val || 0)); setAccountAction({ holding: h, reopen: true }); }}
                      className="w-full py-2 px-3 rounded-xl border border-emerald-500/20 text-emerald-400/80 hover:bg-emerald-500/10 hover:text-emerald-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                    >
                      <LockKeyhole className="w-3.5 h-3.5" />
                      Reopen Account
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAccountAction({ holding: h, reopen: false }); }}
                      className="w-full py-2 px-3 rounded-xl border border-rose-500/20 text-rose-400/80 hover:bg-rose-500/10 hover:text-rose-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                    >
                      <LockKeyhole className="w-3.5 h-3.5" />
                      Close Account
                    </button>
                  )}
                </div>
              </div>
            </AnimatedCard>
          );
        })}
      </div>

      {accountAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" onClick={() => setAccountAction(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="modal-surface w-full max-w-sm rounded-2xl border border-slate-700/80 p-5 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <h3 className="text-base font-black text-white">{accountAction.reopen ? 'Reopen Account' : 'Close Account'}</h3>
            <p className="mt-2 text-sm text-slate-400">
              {accountAction.reopen
                ? `Reopen ${cleanBankName(accountAction.holding.name)}? Enter its current balance.`
                : `Close ${cleanBankName(accountAction.holding.name)}? Its history will remain available.`}
            </p>
            {accountAction.reopen && (
              <label className="block mt-4 text-xs font-bold text-slate-400">
                Current Balance
                <input value={reopenBalance} onChange={event => setReopenBalance(event.target.value)} type="number" min="0" step="0.01" className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500" />
              </label>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setAccountAction(null)} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-slate-400 hover:text-white">Cancel</button>
              <button
                onClick={() => {
                  if (accountAction.reopen && (isNaN(reopenBalance) || Number(reopenBalance) < 0)) return;
                  onCloseHolding(accountAction.holding, accountAction.reopen, Number(reopenBalance));
                  setAccountAction(null);
                }}
                className={`rounded-xl px-3 py-2 text-xs font-black text-slate-950 ${accountAction.reopen ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-rose-500 hover:bg-rose-400'}`}
              >
                Confirm
              </button>
            </div>
          </motion.div>
        </div>
      )}

    </AnimatedPage>
  );
}
