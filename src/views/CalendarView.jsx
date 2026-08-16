import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar as CalendarIcon, CalendarDays, RefreshCw, X } from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';
import AnimatedCounter from '../components/AnimatedCounter';

const RANGE_PILLS = ['1M', '3M', '6M', '1Y', '2Y', '3Y', '5Y', '10Y', 'ALL'];

// Helper for stylish date formatting (e.g. "07 Aug 2026")
function formatPrettyDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  } catch (e) {
    return dateStr;
  }
}

// Category display labels & colors for drill-down modal
const CATEGORY_META = {
  savings: { label: 'Bank Savings', color: '#3b82f6' },
  indian_stocks: { label: 'Indian Equities', color: '#10b981' },
  mutual_funds: { label: 'Mutual Funds', color: '#8b5cf6' },
  us_stocks: { label: 'US Equities', color: '#f59e0b' },
  epf: { label: 'EPF', color: '#06b6d4' },
  nps: { label: 'NPS', color: '#ec4899' },
  loan: { label: 'Housing Loan', color: '#ef4444' },
  credits: { label: 'Credit Cards', color: '#f43f5e' }
};

export default function CalendarView() {
  const { formatMoney } = useThemeAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);
  const [modalLog, setModalLog] = useState(null); // Popup modal state
  
  // Range & Custom Date pickers
  const [activeRange, setActiveRange] = useState('1M');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, [activeRange, customStartDate, customEndDate]);

  // Lock body scrolling when popup is open to prevent page shifting
  useEffect(() => {
    if (modalLog) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [modalLog]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let url = '/api/daily-pnl';
      const params = [];
      if (activeRange === 'CUSTOM' && customStartDate && customEndDate) {
        params.push(`startDate=${customStartDate}`);
        params.push(`endDate=${customEndDate}`);
      } else if (activeRange) {
        params.push(`range=${activeRange}`);
      }
      if (params.length > 0) url += `?${params.join('&')}`;

      const res = await axios.get(url);
      setLogs(res.data);
      if (res.data.length > 0) {
        setSelectedLog(res.data[res.data.length - 1]);
      } else {
        setSelectedLog(null);
      }
    } catch (err) {
      console.error('[Calendar] Error fetching logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRangeClick = (range) => {
    setActiveRange(range);
    setShowCalendarPicker(false);
  };

  const handleCardClick = (log) => {
    setSelectedLog(log);
    setModalLog(log);
  };

  // Metrics summary (Win rate formatted to 2 decimal places precision)
  const totalRangePnl = useMemo(() => logs.reduce((sum, item) => sum + (item.daily_pnl_inr || 0), 0), [logs]);
  const positiveDays = useMemo(() => logs.filter(l => l.daily_pnl_inr > 0).length, [logs]);
  const negativeDays = useMemo(() => logs.filter(l => l.daily_pnl_inr < 0).length, [logs]);
  const winRate = useMemo(() => (logs.length > 0 ? ((positiveDays / logs.length) * 100).toFixed(2) : '0.00'), [logs, positiveDays]);

  // Calculate Net Asset & Liability changes over the selected range
  const rangeAssetDelta = useMemo(() => {
    if (logs.length < 2) return 0;
    const firstAssets = logs[0].total_assets_inr || 0;
    const lastAssets = logs[logs.length - 1].total_assets_inr || 0;
    return lastAssets - firstAssets;
  }, [logs]);

  // Liabilities change logic
  const rangeLiabilityDelta = useMemo(() => {
    if (logs.length < 2) return 0;
    const firstLiab = logs[0].liabilities_inr || 0;
    const lastLiab = logs[logs.length - 1].liabilities_inr || 0;
    return lastLiab - firstLiab;
  }, [logs]);

  // Filter category keys where values actually changed in the selected log popup
  const changedCategoryKeys = useMemo(() => {
    if (!modalLog) return [];
    return Object.keys(CATEGORY_META).filter((key) => {
      const val = modalLog.breakdown?.[key] || 0;
      const prevVal = modalLog.prev_breakdown?.[key] || 0;
      return (val - prevVal) !== 0;
    });
  }, [modalLog]);

  return (
    <AnimatedPage className="space-y-5">
      
      {/* Banner matching Dashboard styling (clutter free, z-40 elevated to be in front of everything) */}
      <AnimatedItem className="relative z-40">
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
              <CalendarIcon className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-white tracking-tight">
                Calendar
              </h2>
            </div>
          </div>

          {/* Compact Dashboard-Style Date Range Controls */}
          <div className="flex items-center gap-2 flex-wrap self-end md:self-auto">
            {/* Pill Bar */}
            <div className="flex items-center gap-1 p-0.5 bg-slate-900/60 border border-slate-800 rounded-full">
              {RANGE_PILLS.map((range) => (
                <button
                  key={range}
                  onClick={() => handleRangeClick(range)}
                  className={`px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all duration-200 ${
                    activeRange === range
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>

            {/* Calendar Popover Trigger */}
            <button
              onClick={() => setShowCalendarPicker(!showCalendarPicker)}
              className={`p-1.5 rounded-full border transition-all duration-200 flex items-center gap-1 text-[10px] font-bold ${
                activeRange === 'CUSTOM' || showCalendarPicker
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                  : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
              title="Select Custom Date Range"
            >
              <CalendarDays className="w-3.5 h-3.5" />
            </button>

            {/* Custom Date Range Popover */}
            <AnimatePresence>
              {showCalendarPicker && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  className="absolute right-5 top-16 z-50 p-3.5 bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-xl flex flex-col gap-2.5 text-xs text-slate-300 min-w-[280px]"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5 text-emerald-400" />
                    Select Custom Date Range
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-1 flex-1">
                      <span className="text-[9px] text-slate-400 font-semibold">From Date</span>
                      <input 
                        type="date" 
                        value={customStartDate} 
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1 flex-1">
                      <span className="text-[9px] text-slate-400 font-semibold">To Date</span>
                      <input 
                        type="date" 
                        value={customEndDate} 
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (customStartDate && customEndDate) {
                        setActiveRange('CUSTOM');
                        setShowCalendarPicker(false);
                      }
                    }}
                    disabled={!customStartDate || !customEndDate}
                    className="w-full py-1.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold rounded-xl text-xs transition-colors"
                  >
                    Apply Filter
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </AnimatedItem>

      {/* Stats Summary Cards (Win rate guaranteed 2 decimal points precision) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Range P&L', value: totalRangePnl, color: totalRangePnl > 0 ? 'text-emerald-400' : totalRangePnl < 0 ? 'text-rose-400' : 'text-blue-400', format: true },
          { label: 'Positive Days', value: positiveDays, color: 'text-emerald-400' },
          { label: 'Negative Days', value: negativeDays, color: 'text-rose-400' },
          { label: 'Win Rate', value: winRate, color: 'text-indigo-400', suffix: '%' },
        ].map((stat) => (
          <AnimatedItem key={stat.label}>
            <div className="glass-card p-4 rounded-2xl border border-slate-800/80">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">{stat.label}</span>
              <div className="text-xl sm:text-2xl font-black font-mono tracking-tight truncate">
                <span className={stat.color}>
                  {stat.format ? (
                    <>{totalRangePnl > 0 ? '+' : ''}<AnimatedCounter value={totalRangePnl} formatter={(v) => formatMoney(v)} /></>
                  ) : (
                    <>{stat.value}{stat.suffix || ''}</>
                  )}
                </span>
              </div>
            </div>
          </AnimatedItem>
        ))}
      </div>

      {/* Grid of Daily Valuation Cards (Sized appropriately so full 2-decimal numbers fit without any "..." truncation) */}
      <AnimatedItem>
        <div className="glass-card p-6 rounded-3xl border border-slate-800 space-y-4">
          
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-500">
              <RefreshCw className="w-7 h-7 animate-spin text-emerald-400" />
              <span className="text-xs font-semibold">Loading daily valuation records...</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-sm font-medium">
              No daily portfolio logs found for the selected range.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 max-h-[500px] overflow-y-auto p-2 pr-1 pb-1 custom-scrollbar">
              {logs.map((log, i) => {
                const isPos = log.daily_pnl_inr > 0;
                const isNeg = log.daily_pnl_inr < 0;
                const isSelected = selectedLog && selectedLog.log_date === log.log_date;

                const d = new Date(log.log_date + 'T00:00:00');
                const dayNum = String(d.getDate()).padStart(2, '0');
                const monthShort = d.toLocaleString('en-US', { month: 'short' });
                const yearShort = String(d.getFullYear()).slice(-2);

                // Exact matching border & background colors based on state
                let cardStyle = '';
                let textColor = '';
                let badgeDot = '';

                if (isPos) {
                  textColor = 'text-emerald-400';
                  badgeDot = 'bg-emerald-400';
                  cardStyle = isSelected
                    ? 'ring-2 ring-emerald-400 border-emerald-400 bg-emerald-500/20 shadow-xl shadow-emerald-500/20'
                    : 'bg-emerald-500/8 border-emerald-500/30 hover:border-emerald-400 hover:bg-emerald-500/18';
                } else if (isNeg) {
                  textColor = 'text-rose-400';
                  badgeDot = 'bg-rose-400';
                  cardStyle = isSelected
                    ? 'ring-2 ring-rose-400 border-rose-400 bg-rose-500/20 shadow-xl shadow-rose-500/20'
                    : 'bg-rose-500/8 border-rose-500/30 hover:border-rose-400 hover:bg-rose-500/18';
                } else {
                  textColor = 'text-blue-400';
                  badgeDot = 'bg-blue-400';
                  cardStyle = isSelected
                    ? 'ring-2 ring-blue-400 border-blue-400 bg-blue-500/20 shadow-xl shadow-blue-500/20'
                    : 'bg-blue-500/8 border-blue-500/30 hover:border-blue-400 hover:bg-blue-500/18';
                }

                return (
                  <motion.div
                    key={log.log_date}
                    onClick={() => handleCardClick(log)}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(i * 0.003, 0.25), duration: 0.18 }}
                    whileHover={{ scale: 1.04, y: -2 }}
                    className={`p-3 rounded-2xl border cursor-pointer transition-all min-w-0 flex flex-col justify-between ${cardStyle}`}
                  >
                    {/* Stylish Creative Date Header */}
                    <div className="flex items-center justify-between gap-1 mb-2 min-w-0 border-b border-slate-800 pb-1.5">
                      <div className="flex items-baseline gap-1">
                        <span className="text-base sm:text-lg font-black text-slate-100 font-mono leading-none">{dayNum}</span>
                        <span className="text-[9px] font-extrabold uppercase text-slate-400 tracking-wider font-sans">{monthShort} '{yearShort}</span>
                      </div>
                      <span className={`w-2 h-2 rounded-full shrink-0 ${badgeDot}`} />
                    </div>

                    {/* Content Stack: Full 2-decimal point precision rendered clearly without "..." truncation */}
                    <div className="space-y-1 min-w-0">
                      <div className="text-[10.5px] sm:text-xs font-black font-mono text-white tracking-tighter whitespace-nowrap overflow-hidden">
                        {formatMoney(log.net_worth_inr)}
                      </div>
                      <div className="pt-1 border-t border-white/5">
                        <div className={`text-[10px] sm:text-[11px] font-black font-mono tracking-tighter whitespace-nowrap overflow-hidden ${textColor}`}>
                          {isPos ? '+' : ''}{formatMoney(log.daily_pnl_inr)}
                        </div>
                        <div className={`text-[8.5px] font-bold font-mono whitespace-nowrap opacity-90 ${textColor}`}>
                          {isPos ? '+' : ''}{Number(log.pnl_percentage || 0).toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Sleek Clutter-Free Window Growth Summary (tight spacing, larger date font, theme-matching glass subcard boxes) */}
          <AnimatePresence mode="wait">
            {logs.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-1 pt-2 border-t border-slate-800/80 space-y-3"
              >
                <div>
                  <h4 className="text-base font-black text-white tracking-tight">
                    Summary
                  </h4>
                  <p className="text-xs sm:text-sm font-extrabold text-slate-400 font-mono mt-0.5">
                    {formatPrettyDate(logs[0]?.log_date)} – {formatPrettyDate(logs[logs.length - 1]?.log_date)}
                  </p>
                </div>

                {/* 3 Values in theme-matching glass-subcard boxes with left accent bars */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Net Worth Change */}
                  <div className={`p-4 rounded-2xl border border-slate-800/80 glass-subcard border-l-4 ${totalRangePnl > 0 ? 'border-l-emerald-500' : 'border-l-rose-500'} flex flex-col justify-center min-w-0`}>
                    <span className="text-[9.5px] font-black text-slate-400 uppercase tracking-widest block mb-1">Net Worth Change</span>
                    <span className={`text-lg sm:text-xl font-black font-mono tracking-tight block truncate ${totalRangePnl > 0 ? 'text-emerald-400' : totalRangePnl < 0 ? 'text-rose-400' : 'text-blue-400'}`}>
                      {totalRangePnl > 0 ? '+' : ''}{formatMoney(totalRangePnl)}
                    </span>
                  </div>

                  {/* Assets Delta */}
                  <div className={`p-4 rounded-2xl border border-slate-800/80 glass-subcard border-l-4 ${rangeAssetDelta > 0 ? 'border-l-emerald-500' : 'border-l-rose-500'} flex flex-col justify-center min-w-0`}>
                    <span className="text-[9.5px] font-black text-slate-400 uppercase tracking-widest block mb-1">Assets Growth</span>
                    <span className={`text-lg sm:text-xl font-black font-mono tracking-tight block truncate ${rangeAssetDelta > 0 ? 'text-emerald-400' : rangeAssetDelta < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                      {rangeAssetDelta > 0 ? '+' : ''}{formatMoney(rangeAssetDelta)}
                    </span>
                  </div>

                  {/* Liabilities Delta */}
                  <div className={`p-4 rounded-2xl border border-slate-800/80 glass-subcard border-l-4 ${rangeLiabilityDelta <= 0 ? 'border-l-emerald-500' : 'border-l-rose-500'} flex flex-col justify-center min-w-0`}>
                    <span className="text-[9.5px] font-black text-slate-400 uppercase tracking-widest block mb-1">Liabilities Delta</span>
                    <span className={`text-lg sm:text-xl font-black font-mono tracking-tight block truncate ${rangeLiabilityDelta < 0 ? 'text-emerald-400' : rangeLiabilityDelta > 0 ? 'text-rose-400' : 'text-slate-300'}`}>
                      {rangeLiabilityDelta > 0 ? '+' : ''}{formatMoney(rangeLiabilityDelta)}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </AnimatedItem>

      {/* Interactive Drill-Down Popup Modal (Clean reverted category list, standard white/black text color for loan, no SBI suffix) */}
      {createPortal(
        <AnimatePresence>
          {modalLog && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setModalLog(null)}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 overflow-hidden"
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 10 }}
                onClick={(e) => e.stopPropagation()}
                className="glass-card border border-slate-700/80 rounded-3xl p-5 max-w-[320px] w-full shadow-2xl space-y-4 relative overflow-hidden"
              >
                {/* Header with single X button at top right */}
                {(() => {
                  const md = new Date(modalLog.log_date + 'T00:00:00');
                  const mDayNum = String(md.getDate()).padStart(2, '0');
                  const mMonthShort = md.toLocaleString('en-US', { month: 'short' });
                  const mYearShort = String(md.getFullYear()).slice(-2);

                  return (
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                      <div className="flex items-center gap-3">
                        <span className="text-5xl font-black font-sans leading-none text-slate-100 tracking-tight">{mDayNum}</span>
                        <div className="flex flex-col">
                          <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400">Valuation Date</span>
                          <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider leading-none mt-0.5">{mMonthShort} 20{mYearShort}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => setModalLog(null)}
                        className="p-1 bg-slate-800 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })()}

                {/* Day Net Summary Banner */}
                <div className="grid grid-cols-2 gap-3 p-3 glass-subcard rounded-2xl border border-slate-800">
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Net Worth</span>
                    <span className="text-sm font-black font-mono text-white">{formatMoney(modalLog.net_worth_inr)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Daily P&L</span>
                    <span className={`text-sm font-black font-mono ${modalLog.daily_pnl_inr > 0 ? 'text-emerald-400' : modalLog.daily_pnl_inr < 0 ? 'text-rose-400' : 'text-blue-400'}`}>
                      {modalLog.daily_pnl_inr > 0 ? '+' : ''}{formatMoney(modalLog.daily_pnl_inr)}
                    </span>
                  </div>
                </div>

                {/* Day Asset & Liability Changes (Clean list without accordion dropdowns) */}
                <div className="space-y-3">
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-slate-400 block">Balances Changed on Date</span>
                    
                    {changedCategoryKeys.length === 0 ? (
                      <div className="py-6 text-center text-slate-500 text-xs font-semibold bg-slate-900/40 rounded-xl border border-slate-800/40">
                        No asset or liability changes recorded.
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {changedCategoryKeys.map((key) => {
                          const meta = CATEGORY_META[key];
                          const val = modalLog.breakdown?.[key] || 0;
                          const prevVal = modalLog.prev_breakdown?.[key] || 0;
                          const diff = val - prevVal;
                          const isLiab = key === 'loan' || key === 'credits';

                          return (
                            <div key={key} className="flex items-center justify-between p-2.5 glass-subcard rounded-xl border border-slate-800/60 text-xs">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta.color }}></span>
                                <span className="font-semibold text-slate-200 text-[10px]">{meta.label}</span>
                              </div>
                              <div className="text-right font-mono">
                                {/* Standard white/black text color for all amounts (Loan is NOT forced Red) */}
                                <span className="font-bold block text-[10px] text-white">{formatMoney(val)}</span>
                                <span className={`text-[9px] block font-bold ${
                                  isLiab 
                                    ? (diff < 0 ? 'text-emerald-400' : 'text-rose-400')
                                    : (diff > 0 ? 'text-emerald-400' : 'text-rose-400')
                                }`}>
                                  {diff > 0 ? '↑ +' : '↓ '}{formatMoney(diff)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

    </AnimatedPage>
  );
}
