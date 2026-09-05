import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  CreditCard, Plus, ChevronRight, LockKeyhole
} from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';

export default function LiabilitiesView({ liabilities, onSelectHolding, onOpenAddModal, onCloseLiability }) {
  const { formatMoney } = useThemeAuth();
  const [filter, setFilter] = useState('active');
  const [actionLiability, setActionLiability] = useState(null);
  const [reopenBalance, setReopenBalance] = useState('0');

  const cleanLiabilityName = (name = '') => name.replace(/\s*\(SBI Bank\)/gi, '').replace(/\s*\(SBI\)/gi, '').trim();

  const filteredLiabilities = liabilities.filter(l => {
    const isClosed = Number(l.outstanding_balance) <= 0;
    return filter === 'closed' ? isClosed : !isClosed;
  });

  const totalDebt = filteredLiabilities.reduce((sum, l) => sum + (Number(l.outstanding_balance) || 0), 0);

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
            </div>
            <h2 className="text-2xl font-black text-white flex items-center gap-2.5">
              <CreditCard className="w-6 h-6 text-rose-400" />
              Liability & Debt Management
            </h2>
          </div>

          <div className="flex items-center gap-5 relative z-10 shrink-0">
            <div className="text-right">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                Total Outstanding Debt
              </span>
              <div className="text-2xl font-black font-mono text-rose-400">
                {formatMoney(totalDebt)}
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

      {/* Active vs Closed Obligations Toggle */}
      <div className="flex justify-center">
        <div className="flex items-center gap-1 p-1 bg-slate-900/70 border border-slate-800 rounded-xl">
          {[
            { id: 'active', label: 'Active Obligations' },
            { id: 'closed', label: 'Closed Obligations' }
          ].map(option => (
            <button
              key={option.id}
              onClick={() => setFilter(option.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${filter === option.id ? 'bg-slate-800 text-rose-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Liabilities Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredLiabilities.map((l) => {
          const isLoan = l.category_id === 'loans';
          const symbol = isLoan ? 'LOAN' : 'CREDITS';
          const isClosed = Number(l.outstanding_balance) <= 0;
          const syntheticHolding = {
            id: l.id,
            name: l.lender || cleanLiabilityName(l.name),
            symbol: symbol,
            category_id: l.category_id,
            current_price: l.outstanding_balance
          };

          return (
            <AnimatedCard key={l.id}>
              <div 
                onClick={() => onSelectHolding && onSelectHolding(syntheticHolding)}
                className={`glass-card p-6 rounded-3xl border transition-all duration-300 group cursor-pointer flex flex-col justify-between h-full space-y-5 ${
                  isClosed
                    ? 'border-slate-700/80 opacity-75 grayscale-[35%]'
                    : 'border-slate-800/90 hover:border-rose-500/40'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/25">
                      {isLoan ? 'HOUSING LOAN' : 'CREDIT CARD'}
                    </span>
                    <span className={`text-[10px] font-bold font-mono flex items-center gap-1 ${isClosed ? 'text-slate-500' : 'text-rose-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${isClosed ? 'bg-slate-500' : 'bg-rose-400'}`} />
                      {isClosed ? 'CLOSED' : 'ACTIVE'}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-white group-hover:text-rose-300 transition-colors">
                    {cleanLiabilityName(l.name)}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">Lender: {l.lender}</p>
                </div>

                <div className="space-y-4 pt-4 border-t border-slate-800">
                  <div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                      Outstanding Principal
                    </span>
                    <span className="text-xl font-black font-mono text-rose-400 group-hover:text-rose-300 transition-colors">
                      {formatMoney(l.outstanding_balance)}
                    </span>
                  </div>

                  <button 
                    onClick={(e) => { e.stopPropagation(); onSelectHolding && onSelectHolding(syntheticHolding); }}
                    className="w-full py-2.5 px-3 rounded-2xl bg-slate-900 hover:bg-rose-500/15 border border-slate-800 hover:border-rose-500/30 text-slate-300 hover:text-rose-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5 group/btn"
                  >
                    <span>View</span>
                    <ChevronRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                  </button>

                  {isClosed ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setReopenBalance('0');
                        setActionLiability({ liability: l, reopen: true });
                      }}
                      className="w-full py-2 px-3 rounded-xl border border-emerald-500/20 text-emerald-400/80 hover:bg-emerald-500/10 hover:text-emerald-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                    >
                      <LockKeyhole className="w-3.5 h-3.5" />
                      Reopen {isLoan ? 'Account' : 'Card'}
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActionLiability({ liability: l, reopen: false });
                      }}
                      className="w-full py-2 px-3 rounded-xl border border-rose-500/20 text-rose-400/80 hover:bg-rose-500/10 hover:text-rose-300 text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                    >
                      <LockKeyhole className="w-3.5 h-3.5" />
                      Close {isLoan ? 'Account' : 'Card'}
                    </button>
                  )}
                </div>
              </div>
            </AnimatedCard>
          );
        })}
      </div>

      {/* Close/Reopen Modal Confirmation */}
      {actionLiability && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm" onClick={() => setActionLiability(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="modal-surface w-full max-w-sm rounded-2xl border border-slate-700/80 p-5 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <h3 className="text-base font-black text-white">
              {actionLiability.reopen 
                ? `Reopen ${actionLiability.liability.category_id === 'loans' ? 'Account' : 'Card'}`
                : `Close ${actionLiability.liability.category_id === 'loans' ? 'Account' : 'Card'}`}
            </h3>
            <p className="mt-2 text-sm text-slate-400">
              {actionLiability.reopen
                ? `Reopen ${cleanLiabilityName(actionLiability.liability.name)}? Enter its current outstanding balance.`
                : `Close ${cleanLiabilityName(actionLiability.liability.name)}? Outstanding principal balance will be settled to ₹0.00 and history remains available.`}
            </p>
            {actionLiability.reopen && (
              <label className="block mt-4 text-xs font-bold text-slate-400">
                Outstanding Balance
                <input 
                  value={reopenBalance} 
                  onChange={event => setReopenBalance(event.target.value)} 
                  type="number" 
                  min="0" 
                  step="0.01" 
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-rose-500" 
                />
              </label>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setActionLiability(null)} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-slate-400 hover:text-white">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (actionLiability.reopen && (isNaN(reopenBalance) || Number(reopenBalance) < 0)) return;
                  if (onCloseLiability) {
                    onCloseLiability(actionLiability.liability, actionLiability.reopen, Number(reopenBalance));
                  }
                  setActionLiability(null);
                }}
                className={`rounded-xl px-3 py-2 text-xs font-black text-slate-950 ${actionLiability.reopen ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-rose-500 hover:bg-rose-400 text-white'}`}
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

