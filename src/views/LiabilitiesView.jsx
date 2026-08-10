import React from 'react';
import { motion } from 'framer-motion';
import { 
  CreditCard, Plus, ArrowDownRight, Activity, ChevronRight, 
  Building, Calendar, ShieldAlert, CheckCircle2, TrendingDown 
} from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';

export default function LiabilitiesView({ liabilities, onSelectHolding, onOpenAddModal }) {
  const { formatMoney } = useThemeAuth();

  const totalDebt = liabilities.reduce((sum, l) => sum + (Number(l.outstanding_balance) || 0), 0);
  const totalEmi = liabilities.reduce((sum, l) => sum + (Number(l.monthly_emi) || 0), 0);

  return (
    <AnimatedPage className="space-y-6">
      
      {/* Top Hero Banner */}
      <AnimatedItem>
        <div className="glass-card p-6 rounded-3xl border border-slate-800 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-500/15 text-rose-400 border border-rose-500/30 tracking-wider uppercase">
                DEBT & OBLIGATIONS
              </span>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                • {liabilities.length} Active Obligations
              </span>
            </div>
            <h2 className="text-2xl font-black text-white flex items-center gap-2.5">
              <CreditCard className="w-6 h-6 text-rose-400" />
              Liabilities & Debt Management
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Real-time monitoring of loan principal balances, credit card statements, interest rates, and monthly EMI obligations.
            </p>
          </div>

          <div className="flex items-center gap-5 relative z-10 shrink-0">
            <div className="text-right">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                Total Outstanding Debt
              </span>
              <div className="text-2xl font-black font-mono text-rose-400">
                {formatMoney(totalDebt)}
              </div>
              <div className="text-[10px] font-bold text-slate-300 font-mono mt-0.5">
                Monthly EMI: ₹{Math.round(totalEmi).toLocaleString('en-IN')}/mo
              </div>
            </div>

            <motion.button
              onClick={onOpenAddModal}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-rose-500 to-red-600 text-white font-black rounded-2xl text-xs shadow-lg shadow-rose-500/25"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              Add Liability
            </motion.button>
          </div>

          {/* Background glowing orb */}
          <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
        </div>
      </AnimatedItem>

      {/* Liabilities Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {liabilities.map((l) => {
          const isLoan = l.category_id === 'loans';
          const symbol = isLoan ? 'LOAN' : 'CREDITS';
          const syntheticHolding = {
            id: l.id,
            name: l.name,
            symbol: symbol,
            category_id: l.category_id,
            current_price: l.outstanding_balance
          };

          return (
            <AnimatedCard key={l.id}>
              <div 
                onClick={() => onSelectHolding && onSelectHolding(syntheticHolding)}
                className="glass-card p-6 rounded-3xl border border-slate-800/90 hover:border-rose-500/40 transition-all duration-300 group cursor-pointer flex flex-col justify-between h-full space-y-5"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/25">
                      {isLoan ? 'HOUSING LOAN' : 'CREDIT CARD'}
                    </span>
                    <span className="text-[10px] text-amber-400 font-bold font-mono">
                      {l.interest_rate > 0 ? `${l.interest_rate}% p.a.` : '0.0% APR'} • Due {l.due_day}th
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-white group-hover:text-rose-300 transition-colors">
                    {l.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">Lender: {l.lender}</p>
                </div>

                <div className="space-y-4 pt-4 border-t border-slate-800">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                        Outstanding Principal
                      </span>
                      <span className="text-xl font-black font-mono text-rose-400 group-hover:text-rose-300 transition-colors">
                        {formatMoney(l.outstanding_balance)}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                        Monthly EMI
                      </span>
                      <span className="text-lg font-black font-mono text-white">
                        {l.monthly_emi > 0 ? `₹${Number(l.monthly_emi).toLocaleString('en-IN')}` : 'Pay in Full'}
                      </span>
                    </div>
                  </div>

                  <button 
                    onClick={(e) => { e.stopPropagation(); onSelectHolding && onSelectHolding(syntheticHolding); }}
                    className="w-full py-2.5 px-3 rounded-2xl bg-slate-900 hover:bg-rose-500/15 border border-slate-800 hover:border-rose-500/30 text-slate-300 hover:text-rose-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5 group/btn"
                  >
                    <span>Inspect Amortization & EOD Reduction</span>
                    <ChevronRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
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
