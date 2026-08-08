import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { LineChart, Plus, Search, Edit3, Trash2 } from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';

export default function MutualFundsView({ holdings, onDeleteHolding, onEditHolding, onOpenAddModal }) {
  const { formatMoney } = useThemeAuth();
  const [search, setSearch] = useState('');

  const mfs = holdings.filter(h => h.category_id === 'mutual_funds');
  const filtered = mfs.filter(h => h.name.toLowerCase().includes(search.toLowerCase()) || h.symbol.includes(search));

  const totalCurrent = mfs.reduce((sum, h) => sum + h.currentValueINR, 0);
  const totalInvested = mfs.reduce((sum, h) => sum + h.investedValueINR, 0);
  const totalGain = totalCurrent - totalInvested;

  return (
    <AnimatedPage className="space-y-5">
      
      {/* Banner */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-5">
          <div>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/12 text-amber-400 border border-amber-500/25">
              AMFI LIVE NAV
            </span>
            <h2 className="text-xl font-black text-white flex items-center gap-2 mt-1.5">
              <LineChart className="w-5 h-5 text-amber-400" />
              Mutual Funds
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Live NAVs from AMFI</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">MF Value</span>
              <div className="text-xl font-black font-mono text-amber-400">{formatMoney(totalCurrent)}</div>
              <div className="text-[10px] font-bold text-emerald-400">+₹{Math.round(totalGain).toLocaleString('en-IN')} gain</div>
            </div>
            <motion.button
              onClick={onOpenAddModal}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-obsidian-950 font-black rounded-xl text-xs shadow-lg shadow-amber-500/20"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              Add
            </motion.button>
          </div>
        </div>
      </AnimatedItem>

      {/* Table */}
      <AnimatedItem>
        <div className="glass-card rounded-3xl p-5 border border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-900/40">
                  <th className="py-3 px-3 rounded-l-xl">Scheme & Code</th>
                  <th className="py-3 px-3 text-right">Units</th>
                  <th className="py-3 px-3 text-right">Avg NAV</th>
                  <th className="py-3 px-3 text-right">Current NAV</th>
                  <th className="py-3 px-3 text-right">Invested</th>
                  <th className="py-3 px-3 text-right">Current</th>
                  <th className="py-3 px-3 text-right">P&L</th>
                  <th className="py-3 px-3 text-center rounded-r-xl">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-xs">
                {filtered.map((h, i) => (
                  <motion.tr 
                    key={h.id} 
                    className="hover:bg-slate-800/30"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-100 text-[12px]">{h.name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">AMFI #{h.symbol} • {h.sector}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-300">{h.quantity.toLocaleString()}</td>
                    <td className="py-3 px-3 text-right font-mono text-slate-400">₹{h.avg_buy_price}</td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-amber-400">₹{h.current_price}</td>
                    <td className="py-3 px-3 text-right font-mono text-slate-400">{formatMoney(h.investedValueINR)}</td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-100">{formatMoney(h.currentValueINR)}</td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-emerald-400">
                      +₹{h.gainINR.toLocaleString('en-IN')} (+{h.gainPct}%)
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => onEditHolding(h)} className="p-1 hover:bg-slate-700/60 text-slate-500 hover:text-slate-200 rounded-lg">
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button onClick={() => onDeleteHolding(h.id)} className="p-1 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-lg">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </AnimatedItem>

    </AnimatedPage>
  );
}
