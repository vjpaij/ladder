import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Filter } from 'lucide-react';

export default function CalendarHeatmap() {
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
      if (startDate && endDate) {
        url += `?startDate=${startDate}&endDate=${endDate}`;
      }
      const res = await axios.get(url);
      setLogs(res.data);
      if (res.data.length > 0) {
        setSelectedLog(res.data[res.data.length - 1]);
      }
    } catch (err) {
      console.error('[Calendar] Error fetching daily logs:', err);
    }
  };

  const totalRangePnl = logs.reduce((sum, item) => sum + (item.daily_pnl_inr || 0), 0);
  const positiveDays = logs.filter(l => l.daily_pnl_inr >= 0).length;
  const negativeDays = logs.filter(l => l.daily_pnl_inr < 0).length;

  return (
    <div className="space-y-6 mb-8">
      
      {/* Calendar Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        
        <div className="glass-panel p-5 rounded-3xl border border-slate-800/80">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
            RANGE TOTAL P&L
          </span>
          <div className={`text-2xl font-extrabold font-mono ${totalRangePnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {totalRangePnl >= 0 ? '+' : ''}{formatMoney(totalRangePnl)}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Cumulative profit across selected timeline</p>
        </div>

        <div className="glass-panel p-5 rounded-3xl border border-slate-800/80">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
            GREEN DAYS
          </span>
          <div className="text-2xl font-extrabold text-emerald-400 font-mono">
            {positiveDays} Days
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Positive gain trading sessions</p>
        </div>

        <div className="glass-panel p-5 rounded-3xl border border-slate-800/80">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
            RED DAYS
          </span>
          <div className="text-2xl font-extrabold text-rose-400 font-mono">
            {negativeDays} Days
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Market correction trading sessions</p>
        </div>

        <div className="glass-panel p-5 rounded-3xl border border-slate-800/80">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider block mb-1">
            WIN RATE
          </span>
          <div className="text-2xl font-extrabold text-indigo-400 font-mono">
            {logs.length > 0 ? ((positiveDays / logs.length) * 100).toFixed(1) : 0}%
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Ratio of profitable sessions</p>
        </div>

      </div>

      {/* Date Range Picker Controls */}
      <div className="glass-panel p-6 rounded-3xl border border-slate-800/80">
        
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-slate-100">Daily P&L Performance Calendar</h3>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            />
            <span className="text-xs text-slate-500">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            />
            {(startDate || endDate) && (
              <button
                onClick={() => { setStartDate(''); setEndDate(''); }}
                className="text-xs text-slate-400 hover:text-slate-200 underline"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Heatmap Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-5 md:grid-cols-7 gap-3">
          {logs.map(log => {
            const isPos = log.daily_pnl_inr >= 0;
            const isSelected = selectedLog && selectedLog.log_date === log.log_date;

            return (
              <div
                key={log.log_date}
                onClick={() => setSelectedLog(log)}
                className={`p-3.5 rounded-2xl border cursor-pointer transition-all ${
                  isSelected ? 'ring-2 ring-emerald-500 scale-[1.03] shadow-lg' : ''
                } ${
                  isPos
                    ? 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20'
                    : 'bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20'
                }`}
              >
                <div className="text-[11px] font-semibold text-slate-400 mb-1">
                  {log.log_date}
                </div>
                <div className={`text-sm font-extrabold font-mono ${isPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isPos ? '+' : ''}{formatMoney(log.daily_pnl_inr)}
                </div>
                <div className={`text-[10px] font-semibold mt-0.5 ${isPos ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {isPos ? '+' : ''}{log.pnl_percentage}%
                </div>
              </div>
            );
          })}
        </div>

        {/* Day Detail Inspector Drawer */}
        {selectedLog && (
          <div className="mt-6 pt-6 border-t border-slate-800/80 bg-slate-900/40 p-5 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider block mb-1">
                SESSION DETAIL FOR {selectedLog.log_date}
              </span>
              <div className="flex items-center gap-4 text-sm font-bold text-slate-200">
                <span>Net Worth: {formatMoney(selectedLog.net_worth_inr)}</span>
                <span>•</span>
                <span>Assets: {formatMoney(selectedLog.total_assets_inr)}</span>
                <span>•</span>
                <span>Liabilities: {formatMoney(selectedLog.total_liabilities_inr)}</span>
              </div>
            </div>

            <div className={`px-4 py-2 rounded-xl text-sm font-extrabold font-mono ${
              selectedLog.daily_pnl_inr >= 0 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
            }`}>
              {selectedLog.daily_pnl_inr >= 0 ? '+' : ''}{formatMoney(selectedLog.daily_pnl_inr)} ({selectedLog.pnl_percentage}%)
            </div>
          </div>
        )}

      </div>

    </div>
  );
}
