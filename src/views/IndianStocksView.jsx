import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Search, Plus, CheckCircle2, Edit3, Trash2 } from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';

export default function IndianStocksView({ holdings, onDeleteHolding, onEditHolding, onOpenAddModal }) {
  const { formatMoney } = useThemeAuth();
  const [search, setSearch] = useState('');

  const indianStocks = holdings.filter(h => h.category_id === 'in_stocks');
  const filtered = indianStocks.filter(h => 
    h.name.toLowerCase().includes(search.toLowerCase()) ||
    h.symbol.toLowerCase().includes(search.toLowerCase()) ||
    (h.sector && h.sector.toLowerCase().includes(search.toLowerCase()))
  );

  const totalInvested = indianStocks.reduce((sum, h) => sum + h.investedValueINR, 0);
  const totalCurrent = indianStocks.reduce((sum, h) => sum + h.currentValueINR, 0);
  const totalGain = totalCurrent - totalInvested;
  const roiPct = totalInvested > 0 ? ((totalGain / totalInvested) * 100).toFixed(2) : 0;

  return (
    <AnimatedPage className="space-y-5">
      
      {/* Banner */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-5">
          <div>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/12 text-emerald-400 border border-emerald-500/25">
              NSE / BSE DUAL PRICE
            </span>
            <h2 className="text-xl font-black text-white flex items-center gap-2 mt-1.5">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              Indian Equities
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Auto-selects the higher quote between NSE & BSE</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Portfolio Value</span>
              <div className="text-xl font-black font-mono text-white">{formatMoney(totalCurrent)}</div>
              <div className="text-[10px] font-bold text-emerald-400">+{roiPct}% ({formatMoney(totalGain)})</div>
            </div>
            <motion.button
              onClick={onOpenAddModal}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-obsidian-950 font-black rounded-xl text-xs shadow-lg shadow-emerald-500/20"
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
          
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mb-5">
            <div className="text-[10px] font-bold text-slate-400 font-mono">
              {filtered.length} COMPANIES
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter stocks..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-900/40">
                  <th className="py-3 px-3 rounded-l-xl">Stock</th>
                  <th className="py-3 px-3 text-right">Shares</th>
                  <th className="py-3 px-3 text-right">Avg Buy</th>
                  <th className="py-3 px-3 text-right">NSE</th>
                  <th className="py-3 px-3 text-right">BSE</th>
                  <th className="py-3 px-3 text-right bg-emerald-500/5">Locked Price</th>
                  <th className="py-3 px-3 text-right">Value</th>
                  <th className="py-3 px-3 text-right">P&L</th>
                  <th className="py-3 px-3 text-center">Status</th>
                  <th className="py-3 px-3 text-center rounded-r-xl">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-xs">
                {filtered.map((h, i) => {
                  const isGainPositive = h.gainINR >= 0;
                  const isNseHigher = (h.nse_price || 0) >= (h.bse_price || 0);

                  return (
                    <motion.tr 
                      key={h.id} 
                      className="hover:bg-slate-800/30"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                    >
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center font-bold text-[10px] text-emerald-400">
                            {h.symbol.slice(0, 2)}
                          </div>
                          <div>
                            <div className="font-bold text-slate-100 text-[12px]">{h.name}</div>
                            <div className="text-[10px] text-slate-500 font-mono">{h.symbol} • {h.sector || 'Equities'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-300">{h.quantity.toLocaleString()}</td>
                      <td className="py-3 px-3 text-right font-mono text-slate-400">₹{h.avg_buy_price.toLocaleString('en-IN')}</td>
                      <td className={`py-3 px-3 text-right font-mono ${isNseHigher ? 'text-emerald-400 font-bold' : 'text-slate-500'}`}>
                        ₹{h.nse_price || h.current_price}
                      </td>
                      <td className={`py-3 px-3 text-right font-mono ${!isNseHigher ? 'text-emerald-400 font-bold' : 'text-slate-500'}`}>
                        ₹{h.bse_price || h.current_price}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-black text-emerald-400 bg-emerald-500/5">
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-[8px] px-1 rounded bg-emerald-500/20 text-emerald-300">{isNseHigher ? 'NSE' : 'BSE'}</span>
                          ₹{h.current_price.toLocaleString('en-IN')}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-100">{formatMoney(h.currentValueINR, true)}</td>
                      <td className="py-3 px-3 text-right font-mono">
                        <div className={isGainPositive ? 'text-emerald-400' : 'text-rose-400'}>
                          {isGainPositive ? '+' : ''}₹{h.gainINR.toLocaleString('en-IN')}
                        </div>
                        <div className={`text-[9px] ${isGainPositive ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
                          {isGainPositive ? '+' : ''}{h.gainPct}%
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold badge-emerald">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          LIVE
                        </span>
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
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-slate-600 text-xs">No stocks found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </AnimatedItem>

    </AnimatedPage>
  );
}
