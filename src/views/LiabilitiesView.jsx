import React from 'react';
import { motion } from 'framer-motion';
import { CreditCard, Plus } from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';

export default function LiabilitiesView({ liabilities, onOpenAddModal }) {
  const { formatMoney } = useThemeAuth();

  const totalDebt = liabilities.reduce((sum, l) => sum + l.outstanding_balance, 0);
  const totalEmi = liabilities.reduce((sum, l) => sum + l.monthly_emi, 0);

  return (
    <AnimatedPage className="space-y-5">
      
      {/* Banner */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-5">
          <div>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-rose-500/12 text-rose-400 border border-rose-500/25">
              DEBT & EMI
            </span>
            <h2 className="text-xl font-black text-white flex items-center gap-2 mt-1.5">
              <CreditCard className="w-5 h-5 text-rose-400" />
              Liabilities
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Loans, credit cards & EMI tracking</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Outstanding</span>
              <div className="text-xl font-black font-mono text-rose-400">{formatMoney(totalDebt)}</div>
              <div className="text-[10px] font-bold text-slate-400 font-mono">EMI: ₹{Math.round(totalEmi).toLocaleString('en-IN')}/mo</div>
            </div>
            <motion.button
              onClick={onOpenAddModal}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-black rounded-xl text-xs shadow-lg shadow-rose-500/20"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              Add
            </motion.button>
          </div>
        </div>
      </AnimatedItem>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {liabilities.map(l => (
          <AnimatedCard key={l.id} className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/25">
                  {l.category_id === 'loans' ? 'LOAN' : 'CREDIT CARD'}
                </span>
                <span className="text-[10px] text-amber-400 font-bold font-mono">
                  {l.interest_rate}% • Due {l.due_day}
                </span>
              </div>
              <h3 className="text-base font-bold text-white mb-0.5">{l.name}</h3>
              <p className="text-[10px] text-slate-500">{l.lender}</p>
            </div>

            <div className="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between">
              <div>
                <span className="text-[9px] text-slate-500 font-semibold block mb-0.5">OUTSTANDING</span>
                <span className="text-lg font-black font-mono text-rose-400">{formatMoney(l.outstanding_balance)}</span>
              </div>
              <div className="text-right">
                <span className="text-[9px] text-slate-500 font-semibold block mb-0.5">EMI</span>
                <span className="text-sm font-bold font-mono text-slate-300">₹{l.monthly_emi.toLocaleString('en-IN')}</span>
              </div>
            </div>
          </AnimatedCard>
        ))}
      </div>

    </AnimatedPage>
  );
}
