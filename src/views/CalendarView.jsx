import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { Calendar as CalendarIcon } from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';
import AnimatedCounter from '../components/AnimatedCounter';

export default function CalendarView() {
  const { formatMoney } = useThemeAuth();
  const [logs, setLogs] = useState([]);
  const [selectedLog, setSelectedLog] = useState(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    fetchLogs();
  }, [startDate, endDate]);

  const fetchLogs = async () => {
    try {
      let url = '/api/daily-pnl';
      if (startDate && endDate) url += `?startDate=${startDate}&endDate=${endDate}`;
      const res = await axios.get(url);
      setLogs(res.data);
      if (res.data.length > 0) setSelectedLog(res.data[res.data.length - 1]);
    } catch (err) {
      console.error('[Calendar] Error:', err);
    }
  };

  const totalRangePnl = logs.reduce((sum, item) => sum + (item.daily_pnl_inr || 0), 0);
  const positiveDays = logs.filter(l => l.daily_pnl_inr >= 0).length;
  const negativeDays = logs.filter(l => l.daily_pnl_inr < 0).length;
  const winRate = logs.length > 0 ? ((positiveDays / logs.length) * 100).toFixed(1) : 0;

  return (
    <AnimatedPage className="space-y-5">
      
      {/* Banner */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-5">
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              <CalendarIcon className="w-5 h-5 text-emerald-400" />
              P&L Calendar
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Daily gains & losses heatmap</p>
          </div>

          <div className="flex items-center gap-2.5">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
            />
            <span className="text-[10px] text-slate-600 font-bold">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
            />
            {(startDate || endDate) && (
              <button
                onClick={() => { setStartDate(''); setEndDate(''); }}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-xl text-[10px] text-slate-400"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </AnimatedItem>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Range P&L', value: totalRangePnl, color: totalRangePnl >= 0 ? 'text-emerald-400' : 'text-rose-400', format: true },
          { label: 'Green Days', value: positiveDays, color: 'text-emerald-400' },
          { label: 'Red Days', value: negativeDays, color: 'text-rose-400' },
          { label: 'Win Rate', value: winRate, color: 'text-indigo-400', suffix: '%' },
        ].map((stat, i) => (
          <AnimatedItem key={stat.label}>
            <div className="glass-card p-4 rounded-2xl border border-slate-800">
              <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider block mb-1">{stat.label}</span>
              <div className={`text-xl font-black font-mono ${stat.color}`}>
                {stat.format ? (
                  <>{totalRangePnl >= 0 ? '+' : ''}<AnimatedCounter value={totalRangePnl} formatter={(v) => formatMoney(v)} /></>
                ) : (
                  <>{stat.value}{stat.suffix || ''}</>
                )}
              </div>
            </div>
          </AnimatedItem>
        ))}
      </div>

      {/* Heatmap Grid */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800">
          <h3 className="text-sm font-bold text-white mb-4">Heatmap</h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5">
            {logs.map((log, i) => {
              const isPos = log.daily_pnl_inr >= 0;
              const isSelected = selectedLog && selectedLog.log_date === log.log_date;

              return (
                <motion.div
                  key={log.log_date}
                  onClick={() => setSelectedLog(log)}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.02, duration: 0.3 }}
                  whileHover={{ scale: 1.06 }}
                  className={`p-3 rounded-xl border cursor-pointer transition-shadow ${
                    isSelected ? 'ring-2 ring-emerald-400 shadow-lg shadow-emerald-500/15' : ''
                  } ${
                    isPos
                      ? 'bg-emerald-500/8 border-emerald-500/25 hover:bg-emerald-500/15'
                      : 'bg-rose-500/8 border-rose-500/25 hover:bg-rose-500/15'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-500 mb-0.5 font-mono">{log.log_date}</div>
                  <div className={`text-xs font-black font-mono ${isPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isPos ? '+' : ''}{formatMoney(log.daily_pnl_inr)}
                  </div>
                  <div className={`text-[9px] font-semibold ${isPos ? 'text-emerald-500/60' : 'text-rose-500/60'}`}>
                    {isPos ? '+' : ''}{log.pnl_percentage}%
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Selected Day */}
          {selectedLog && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 pt-5 border-t border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3 bg-slate-900/50 p-4 rounded-2xl"
            >
              <div>
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block mb-1">
                  {selectedLog.log_date}
                </span>
                <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-400 font-mono">
                  <span>Net Worth: {formatMoney(selectedLog.net_worth_inr)}</span>
                  <span>•</span>
                  <span>Assets: {formatMoney(selectedLog.total_assets_inr)}</span>
                </div>
              </div>
              <div className={`px-3 py-1.5 rounded-xl text-sm font-black font-mono ${
                selectedLog.daily_pnl_inr >= 0 ? 'badge-emerald' : 'badge-crimson'
              }`}>
                {selectedLog.daily_pnl_inr >= 0 ? '+' : ''}{formatMoney(selectedLog.daily_pnl_inr)} ({selectedLog.pnl_percentage}%)
              </div>
            </motion.div>
          )}
        </div>
      </AnimatedItem>

    </AnimatedPage>
  );
}
