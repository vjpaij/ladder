import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { DollarSign, Globe, IndianRupee, Award } from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';
import AnimatedCounter from '../components/AnimatedCounter';

export default function DividendsView() {
  const { formatMoney, fxRate } = useThemeAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    axios.get('/api/dividends').then(res => setData(res.data)).catch(console.error);
  }, []);

  if (!data) return null;

  return (
    <AnimatedPage className="space-y-5">
      
      {/* Banner */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-5">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-400" />
              Dividends
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">India & US dividend income with FX conversion</p>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-semibold text-slate-500 uppercase">Total Dividends</span>
            <div className="text-2xl font-black font-mono text-emerald-400">
              <AnimatedCounter value={data.totalDividendsINR} formatter={(v) => formatMoney(v)} />
            </div>
          </div>
        </div>
      </AnimatedItem>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        
        <AnimatedCard className="glass-card p-5 rounded-3xl border border-slate-800">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Indian (₹)</span>
            <motion.div 
              className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-center text-blue-400"
              animate={{ y: [0, -2, 0] }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              <IndianRupee className="w-4 h-4" />
            </motion.div>
          </div>
          <div className="text-2xl font-black text-blue-400 font-mono mb-0.5">
            ₹{data.totalIndiaINR.toLocaleString('en-IN')}
          </div>
          <p className="text-[10px] text-slate-500">From Indian equities</p>
        </AnimatedCard>

        <AnimatedCard className="glass-card p-5 rounded-3xl border border-slate-800">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">US ($ FX)</span>
            <motion.div 
              className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/25 flex items-center justify-center text-purple-400"
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 4, repeat: Infinity }}
            >
              <Globe className="w-4 h-4" />
            </motion.div>
          </div>
          <div className="text-2xl font-black text-purple-400 font-mono mb-0.5">
            ${data.totalUSUSD}
          </div>
          <p className="text-[10px] text-slate-500 font-mono">≈ ₹{data.totalUSConvertedINR.toLocaleString('en-IN')}</p>
        </AnimatedCard>

        <AnimatedCard className="glass-card p-5 rounded-3xl border border-slate-800">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Yield</span>
            <motion.div 
              className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-400"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              <Award className="w-4 h-4" />
            </motion.div>
          </div>
          <div className="text-2xl font-black text-emerald-400 font-mono mb-0.5">1.85%</div>
          <p className="text-[10px] text-slate-500">Annualized cash yield</p>
        </AnimatedCard>

      </div>

      {/* Ledger */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800">
          <h3 className="text-sm font-bold text-white mb-4">Dividend Ledger</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-900/40">
                  <th className="py-3 px-3 rounded-l-xl">Asset</th>
                  <th className="py-3 px-3">Market</th>
                  <th className="py-3 px-3 text-right">Payout</th>
                  <th className="py-3 px-3 text-right">FX Rate</th>
                  <th className="py-3 px-3 text-right">INR Credited</th>
                  <th className="py-3 px-3 text-center rounded-r-xl">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-xs">
                {data.history.map((d, i) => (
                  <motion.tr 
                    key={d.id} 
                    className="hover:bg-slate-800/30"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.04 }}
                  >
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-100">{d.asset_name}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{d.symbol}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                        d.currency === 'USD' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/25' : 'bg-blue-500/10 text-blue-400 border border-blue-500/25'
                      }`}>
                        {d.currency === 'USD' ? 'US' : 'IN'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-200">
                      {d.currency === 'USD' ? `$${d.amount_original}` : `₹${d.amount_original.toLocaleString('en-IN')}`}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-slate-500">
                      {d.currency === 'USD' ? `₹${d.fx_rate}` : '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-black text-emerald-400">
                      ₹{d.amount_inr.toLocaleString('en-IN')}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-500">{d.payment_date}</td>
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
