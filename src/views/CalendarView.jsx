import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Calendar as CalendarIcon, CalendarDays, RefreshCw, X, 
  LayoutGrid, List, ArrowUpDown, ArrowUp, ArrowDown, ChevronRight,
  TrendingUp, TrendingDown
} from 'lucide-react';
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

// Format day with weekday (e.g. "07 Aug 2026", "Friday")
function formatDetailedDate(dateStr) {
  if (!dateStr) return { date: '—', weekday: '' };
  try {
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
    if (isNaN(d.getTime())) return { date: dateStr, weekday: '' };
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year = d.getFullYear();
    const weekday = d.toLocaleString('en-US', { weekday: 'short' });
    return { date: `${day} ${month} ${year}`, weekday };
  } catch (e) {
    return { date: dateStr, weekday: '' };
  }
}

// Category display labels & colors for drill-down modal
const CATEGORY_META = {
  savings: { label: 'Bank Savings', color: '#3b82f6' },
  indian_stocks: { label: 'Indian Equity', color: '#10b981' },
  mutual_funds: { label: 'Mutual Funds', color: '#8b5cf6' },
  us_stocks: { label: 'US Equity', color: '#f59e0b' },
  epf: { label: 'EPF', color: '#06b6d4' },
  nps: { label: 'NPS', color: '#ec4899' },
  loan: { label: 'Housing Loan', color: '#ef4444' },
  credits: { label: 'Credit Cards', color: '#f43f5e' }
};

function getTableValue(log, field) {
  if (field === 'total_assets') return Number(log.total_assets_inr ?? log.total_assets ?? 0);
  if (field === 'debt') return Number(log.debt ?? log.liabilities_inr ?? 0);
  if (field === 'net_worth') return Number(log.net_worth_inr ?? log.wealth ?? 0);
  if (field === 'daily_pnl') return Number(log.daily_pnl_inr ?? 0);
  if (field === 'pct') return Number(log.pnl_percentage ?? 0);
  return Number(log[field] ?? 0);
}

function getTableTrendClass(log, field, previousLog) {
  if (!previousLog) return 'bg-sky-500/[0.10] ring-1 ring-inset ring-sky-400/[0.18]';
  const value = getTableValue(log, field);
  const previousValue = getTableValue(previousLog, field);
  if (value > previousValue) return 'bg-emerald-500/[0.10] ring-1 ring-inset ring-emerald-400/[0.18]';
  if (value < previousValue) return 'bg-rose-500/[0.12] ring-1 ring-inset ring-rose-400/[0.22]';
  return 'bg-sky-500/[0.10] ring-1 ring-inset ring-sky-400/[0.18]';
}

export default function CalendarView() {
  const { formatMoney } = useThemeAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState(null);
  const [modalLog, setModalLog] = useState(null); // Popup modal state
  
  // View mode: 'grid' or 'table'
  const [viewMode, setViewMode] = useState('grid');
  // Granularity: 'daily', 'monthly', 'yearly'
  const [granularity, setGranularity] = useState('daily');
  const [sortField, setSortField] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');

  // Range & Custom Date pickers
  const [activeRange, setActiveRange] = useState('1M');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);

  useEffect(() => {
    fetchLogs();
    // Real-time automatic background polling every 5 seconds
    const interval = setInterval(() => {
      fetchLogs(true);
    }, 5000);
    return () => clearInterval(interval);
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

  const fetchLogs = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
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
        setSelectedLog(prev => {
          if (!prev) return res.data[res.data.length - 1];
          const match = res.data.find(d => (d.log_date || d.date) === (prev.log_date || prev.date));
          return match || res.data[res.data.length - 1];
        });
      } else {
        setSelectedLog(null);
      }
    } catch (err) {
      if (!isSilent) console.error('[Calendar] Error fetching logs:', err);
    } finally {
      if (!isSilent) setLoading(false);
    }
  };

  const [modalTab, setModalTab] = useState('changed');

  const handleRangeClick = (range) => {
    setActiveRange(range);
    setShowCalendarPicker(false);
  };

  const handleCardClick = (log) => {
    setSelectedLog(log);
    setModalLog(log);
    setModalTab('changed');
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-slate-600 inline ml-1" />;
    return sortDirection === 'asc'
      ? <ArrowUp className="w-3 h-3 text-emerald-400 inline ml-1" />
      : <ArrowDown className="w-3 h-3 text-emerald-400 inline ml-1" />;
  };

  // Group logs by Period (Daily, Monthly, Yearly)
  const displayLogs = useMemo(() => {
    if (!logs || logs.length === 0) return [];
    if (granularity === 'daily') return logs;

    // Group logs by Month (YYYY-MM) or Year (YYYY)
    const groups = new Map();
    for (const log of logs) {
      const dt = log.log_date || '';
      const periodKey = granularity === 'monthly' ? dt.slice(0, 7) : dt.slice(0, 4);
      if (!groups.has(periodKey)) {
        groups.set(periodKey, []);
      }
      groups.get(periodKey).push(log);
    }

    const aggregated = [];
    for (const [periodKey, groupLogs] of groups.entries()) {
      groupLogs.sort((a, b) => (a.log_date || '').localeCompare(b.log_date || ''));
      const firstLog = groupLogs[0];
      const lastLog = groupLogs[groupLogs.length - 1];

      // Net period P&L = sum of daily P&Ls or difference between last wealth and start-of-period base
      const periodPnl = groupLogs.reduce((s, l) => s + (Number(l.daily_pnl_inr) || 0), 0);
      const startWealth = (Number(firstLog.net_worth_inr) || Number(firstLog.wealth) || 0) - (Number(firstLog.daily_pnl_inr) || 0);
      const endWealth = Number(lastLog.net_worth_inr) || Number(lastLog.wealth) || 0;
      const periodPct = startWealth > 0 ? ((periodPnl / startWealth) * 100) : 0;

      // Period Delta breakdown
      const firstBreakdown = firstLog.prev_breakdown || firstLog.breakdown || {};
      const lastBreakdown = lastLog.breakdown || {};

      let labelText = periodKey;
      let dateSubText = '';
      if (granularity === 'monthly') {
        const [y, m] = periodKey.split('-');
        const monthDate = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
        labelText = monthDate.toLocaleString('en-US', { month: 'short' });
        dateSubText = `${monthDate.toLocaleString('en-US', { month: 'short' })} ${y}`;
      } else {
        labelText = periodKey;
        dateSubText = `Year ${periodKey}`;
      }

      aggregated.push({
        ...lastLog,
        id: `period_${periodKey}`,
        period_key: periodKey,
        log_date: lastLog.log_date,
        period_label: labelText,
        period_subtext: dateSubText,
        period_type: granularity,
        first_date: firstLog.log_date,
        last_date: lastLog.log_date,
        daily_pnl_inr: Number(periodPnl.toFixed(2)),
        pnl_percentage: Number(periodPct.toFixed(2)),
        days_count: groupLogs.length,
        prev_breakdown: firstBreakdown,
        breakdown: lastBreakdown
      });
    }

    return aggregated;
  }, [logs, granularity]);

  // Sorted logs for table/grid view (defaults to descending by date/period)
  const sortedLogs = useMemo(() => {
    const list = [...displayLogs];
    return list.sort((a, b) => {
      let aVal = a[sortField] !== undefined ? a[sortField] : a.log_date;
      let bVal = b[sortField] !== undefined ? b[sortField] : b.log_date;
      
      if (sortField === 'date' || sortField === 'log_date') {
        aVal = a.log_date || '';
        bVal = b.log_date || '';
      } else if (sortField === 'daily_pnl') {
        aVal = a.daily_pnl_inr || 0;
        bVal = b.daily_pnl_inr || 0;
      } else if (sortField === 'pct') {
        aVal = Number(a.pnl_percentage) || 0;
        bVal = Number(b.pnl_percentage) || 0;
      } else if (sortField === 'net_worth') {
        aVal = a.net_worth_inr || a.wealth || 0;
        bVal = b.net_worth_inr || b.wealth || 0;
      } else if (sortField === 'total_assets') {
        aVal = a.total_assets_inr || a.total_assets || 0;
        bVal = b.total_assets_inr || b.total_assets || 0;
      } else if (sortField === 'debt') {
        aVal = a.liabilities_inr || a.debt || 0;
        bVal = b.liabilities_inr || b.debt || 0;
      } else {
        aVal = Number(a[sortField]) || 0;
        bVal = Number(b[sortField]) || 0;
      }
      
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [displayLogs, sortField, sortDirection]);

  const previousLogs = useMemo(() => {
    const chronologicalLogs = [...displayLogs].sort((a, b) => (a.log_date || '').localeCompare(b.log_date || ''));
    return new Map(chronologicalLogs.map((log, index) => [
      log.period_key || log.log_date,
      chronologicalLogs[index - 1]
    ]));
  }, [displayLogs]);

  // Metrics summary (Win rate formatted to 2 decimal places precision)
  const totalRangePnl = useMemo(() => displayLogs.reduce((sum, item) => sum + (item.daily_pnl_inr || 0), 0), [displayLogs]);
  const positiveDays = useMemo(() => displayLogs.filter(l => l.daily_pnl_inr > 0).length, [displayLogs]);
  const negativeDays = useMemo(() => displayLogs.filter(l => l.daily_pnl_inr < 0).length, [displayLogs]);
  const winRate = useMemo(() => (displayLogs.length > 0 ? ((positiveDays / displayLogs.length) * 100).toFixed(2) : '0.00'), [displayLogs, positiveDays]);

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

          {/* Controls: Granularity, View Switcher & Date Range Controls */}
          <div className="flex items-center gap-2.5 flex-wrap self-end md:self-auto">
            
            {/* Granularity Switcher (Daily vs Monthly vs Yearly) */}
            <div className="flex items-center p-0.5 bg-slate-900/60 border border-slate-800 rounded-full">
              {[
                { id: 'daily', label: 'Daily' },
                { id: 'monthly', label: 'Monthly' },
                { id: 'yearly', label: 'Yearly' }
              ].map((g) => (
                <button
                  key={g.id}
                  onClick={() => setGranularity(g.id)}
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-all duration-200 ${
                    granularity === g.id
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title={`View ${g.label} Performance`}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {/* View Mode Switcher (Grid vs Table) */}
            <div className="flex items-center p-0.5 bg-slate-900/60 border border-slate-800 rounded-full">
              <button
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1.5 transition-all duration-200 ${
                  viewMode === 'grid'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Heatmap Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Grid</span>
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1 rounded-full text-[10px] font-bold flex items-center gap-1.5 transition-all duration-200 ${
                  viewMode === 'table'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Spreadsheet Table View"
              >
                <List className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Table</span>
              </button>
            </div>

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
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500 [color-scheme:dark]"
                      />
                    </div>
                    <div className="flex flex-col gap-1 flex-1">
                      <span className="text-[9px] text-slate-400 font-semibold">To Date</span>
                      <input 
                        type="date" 
                        value={customEndDate} 
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500 [color-scheme:dark]"
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
          { label: granularity === 'daily' ? 'Positive Days' : granularity === 'monthly' ? 'Positive Months' : 'Positive Years', value: positiveDays, color: 'text-emerald-400' },
          { label: granularity === 'daily' ? 'Negative Days' : granularity === 'monthly' ? 'Negative Months' : 'Negative Years', value: negativeDays, color: 'text-rose-400' },
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

      {/* Main Content Area: Grid Heatmap OR Spreadsheet Table View */}
      <AnimatedItem>
        <div className="glass-card p-5 sm:p-6 rounded-3xl border border-slate-800 space-y-4">
          
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-500">
              <RefreshCw className="w-7 h-7 animate-spin text-emerald-400" />
              <span className="text-xs font-semibold">Loading valuation records...</span>
            </div>
          ) : sortedLogs.length === 0 ? (
            <div className="py-16 text-center text-slate-500 text-sm font-medium">
              No portfolio logs found for the selected range.
            </div>
          ) : viewMode === 'grid' ? (
            /* ================= GRID HEATMAP VIEW ================= */
            <div className="space-y-2">
              <div className="flex justify-end">
                <button
                  onClick={() => handleSort('date')}
                  aria-label={`Switch to ${sortDirection === 'asc' ? 'newest first' : 'oldest first'}`}
                  className="p-1.5 rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200 hover:border-slate-700 transition-colors"
                  title={`Switch to ${sortDirection === 'asc' ? 'newest first' : 'oldest first'}`}
                >
                  {sortDirection === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 max-h-[500px] overflow-y-auto p-2 pr-1 pb-1 custom-scrollbar">
                {sortedLogs.map((log, i) => {
                const isPos = log.daily_pnl_inr > 0;
                const isNeg = log.daily_pnl_inr < 0;
                const isSelected = selectedLog && (selectedLog.period_key === log.period_key || selectedLog.log_date === log.log_date);

                const d = new Date(log.log_date + 'T00:00:00');
                const dayNum = String(d.getDate()).padStart(2, '0');
                const monthShort = d.toLocaleString('en-US', { month: 'short' });
                const weekdayShort = d.toLocaleString('en-US', { weekday: 'short' }).toUpperCase();
                const yearShort = String(d.getFullYear()).slice(-2);
                const fullYear = String(d.getFullYear());

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
                    key={log.period_key || log.log_date}
                    onClick={() => handleCardClick(log)}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(i * 0.003, 0.25), duration: 0.18 }}
                    whileHover={{ scale: 1.04, y: -2 }}
                    className={`p-3 rounded-2xl border cursor-pointer transition-all min-w-0 flex flex-col justify-between ${cardStyle}`}
                  >
                    {/* Stylish Creative Date / Period Header */}
                    <div className="flex items-center justify-between gap-1 mb-2 min-w-0 border-b border-slate-800 pb-1.5">
                      {granularity === 'daily' ? (
                        <div className="flex items-baseline gap-1">
                          <span className="text-base sm:text-lg font-black text-slate-100 font-mono leading-none">{dayNum}</span>
                          <span className="text-[9px] font-extrabold uppercase text-slate-400 tracking-wider font-sans">{monthShort} '{yearShort}</span>
                          <span className="text-[8px] font-extrabold uppercase text-emerald-400 tracking-wider font-sans">{weekdayShort}</span>
                        </div>
                      ) : granularity === 'monthly' ? (
                        <div className="flex items-baseline gap-1">
                          <span className="text-base sm:text-lg font-black text-slate-100 font-mono leading-none">{monthShort}</span>
                          <span className="text-[9px] font-extrabold uppercase text-slate-400 tracking-wider font-sans">'{yearShort}</span>
                        </div>
                      ) : (
                        <div className="flex items-baseline gap-1">
                          <span className="text-base sm:text-lg font-black text-slate-100 font-mono leading-none">{fullYear}</span>
                          <span className="text-[8px] font-extrabold uppercase text-slate-400 tracking-wider font-sans">FY</span>
                        </div>
                      )}
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
            </div>
          ) : (
            /* ================= SPREADSHEET TABLE VIEW (Exact portfolio.xlsx layout) ================= */
            <div className="relative overflow-x-auto max-h-[560px] overflow-y-auto rounded-2xl border border-slate-800/80 custom-scrollbar">
              <table className="w-full text-left border-collapse min-w-[1700px]">
                <thead className="sticky top-0 z-30 bg-slate-900 shadow-md">
                  {/* Category Group Header Row */}
                  <tr className="border-b border-slate-800 text-[9px] font-black uppercase tracking-wider text-slate-400 select-none">
                    <th className="sticky left-0 z-40 bg-slate-900 py-2 px-3 border-r border-slate-800">
                      Timeline
                    </th>
                    <th colSpan="12" className="py-2 px-3 text-center bg-emerald-500/10 text-emerald-400 border-r border-slate-800">
                      Assets
                    </th>
                    <th colSpan="3" className="py-2 px-3 text-center bg-rose-500/10 text-rose-400 border-r border-slate-800">
                      Liabilities &amp; Debt
                    </th>
                    <th colSpan="3" className="py-2 px-3 text-center bg-emerald-500/15 text-emerald-300">
                      Net Wealth &amp; Performance
                    </th>
                  </tr>

                  {/* Individual Column Header Row */}
                  <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 select-none">
                    {/* Sticky Date Column */}
                    <th 
                      onClick={() => handleSort('date')} 
                      className="sticky left-0 z-40 bg-slate-900 py-2.5 px-3 border-r border-slate-800 cursor-pointer hover:text-white transition-colors min-w-[130px]"
                    >
                      {granularity === 'daily' ? 'Date' : granularity === 'monthly' ? 'Month' : 'Year'} {getSortIcon('date')}
                    </th>

                    {/* Bank Accounts */}
                    <th onClick={() => handleSort('hdfc')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors min-w-[100px]">
                      HDFC {getSortIcon('hdfc')}
                    </th>
                    <th onClick={() => handleSort('indusind')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors min-w-[100px]">
                      IndusInd {getSortIcon('indusind')}
                    </th>
                    <th onClick={() => handleSort('idfc')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors min-w-[110px]">
                      IDFC {getSortIcon('idfc')}
                    </th>
                    <th onClick={() => handleSort('rbl')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors min-w-[100px]">
                      RBL {getSortIcon('rbl')}
                    </th>
                    <th onClick={() => handleSort('sbi')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors min-w-[100px]">
                      SBI {getSortIcon('sbi')}
                    </th>
                    <th onClick={() => handleSort('savings')} className="py-2.5 px-3 text-right cursor-pointer hover:text-blue-400 transition-colors font-black text-blue-400 border-r border-slate-800 min-w-[120px]">
                      Savings {getSortIcon('savings')}
                    </th>

                    {/* Investment Portfolios */}
                    <th onClick={() => handleSort('mutual_funds')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors min-w-[120px]">
                      Mutual Funds {getSortIcon('mutual_funds')}
                    </th>
                    <th onClick={() => handleSort('indian_stocks')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors min-w-[120px]">
                      Indian Stocks {getSortIcon('indian_stocks')}
                    </th>
                    <th onClick={() => handleSort('us_stocks')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors min-w-[110px]">
                      US Stocks {getSortIcon('us_stocks')}
                    </th>
                    <th onClick={() => handleSort('nps')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors min-w-[100px]">
                      NPS {getSortIcon('nps')}
                    </th>
                    <th onClick={() => handleSort('epf')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors border-r border-slate-800 min-w-[110px]">
                      EPF {getSortIcon('epf')}
                    </th>

                    {/* Total Assets */}
                    <th onClick={() => handleSort('total_assets')} className="py-2.5 px-3 text-right cursor-pointer hover:text-emerald-400 transition-colors font-black text-emerald-400 border-r border-slate-800 min-w-[130px]">
                      Total Assets {getSortIcon('total_assets')}
                    </th>

                    {/* Liabilities */}
                    <th onClick={() => handleSort('loan')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors min-w-[110px]">
                      Loan {getSortIcon('loan')}
                    </th>
                    <th onClick={() => handleSort('credits')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors min-w-[100px]">
                      Credits {getSortIcon('credits')}
                    </th>
                    <th onClick={() => handleSort('debt')} className="py-2.5 px-3 text-right cursor-pointer hover:text-rose-400 transition-colors font-black text-rose-400 border-r border-slate-800 min-w-[110px]">
                      Debt {getSortIcon('debt')}
                    </th>

                    {/* Net Wealth & Changes */}
                    <th onClick={() => handleSort('net_worth')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors font-black text-white min-w-[130px]">
                      Net Wealth {getSortIcon('net_worth')}
                    </th>
                    <th onClick={() => handleSort('daily_pnl')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors min-w-[115px]">
                      {granularity === 'daily' ? 'Daily P&L' : granularity === 'monthly' ? 'Monthly P&L' : 'Annual P&L'} {getSortIcon('daily_pnl')}
                    </th>
                    <th onClick={() => handleSort('pct')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white transition-colors min-w-[95px]">
                      % Change {getSortIcon('pct')}
                    </th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-b [&>tr]:border-slate-800/40 text-xs font-mono">
                  {sortedLogs.map((log, i) => {
                    const isPos = log.daily_pnl_inr > 0;
                    const isNeg = log.daily_pnl_inr < 0;
                    const dateInfo = formatDetailedDate(log.log_date);
                    const isSelected = selectedLog && (selectedLog.period_key === log.period_key || selectedLog.log_date === log.log_date);
                    const previousLog = previousLogs.get(log.period_key || log.log_date);

                    return (
                      <motion.tr
                        key={log.period_key || log.log_date}
                        onClick={() => handleCardClick(log)}
                        initial={{ opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.01, 0.2), duration: 0.12 }}
                        className={`cursor-pointer group transition-all ${
                          isSelected
                            ? 'bg-emerald-500/15'
                            : isPos
                              ? 'hover:bg-emerald-500/8'
                              : isNeg
                                ? 'hover:bg-rose-500/8'
                                : 'hover:bg-slate-800/40'
                        }`}
                      >
                        {/* Sticky Date / Period Column */}
                        <td className="sticky left-0 z-20 bg-slate-900/95 group-hover:bg-slate-900/95 py-2.5 px-3 font-sans border-r border-slate-800 transition-colors">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${
                              isPos ? 'bg-emerald-400' : isNeg ? 'bg-rose-400' : 'bg-blue-400'
                            }`} />
                            <div>
                              <span className="font-bold text-slate-100 text-[11px] block group-hover:text-emerald-400 transition-colors whitespace-nowrap">
                                {granularity === 'daily' ? dateInfo.date : log.period_subtext || dateInfo.date}
                              </span>
                              <span className="text-[9px] text-slate-500 font-semibold uppercase tracking-wider block">
                                {granularity === 'daily' ? dateInfo.weekday : `${log.days_count || 1} sessions`}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Bank Accounts */}
                        <td className={`py-2.5 px-3 text-right text-slate-300 ${getTableTrendClass(log, 'hdfc', previousLog)}`}>
                          {formatMoney(log.hdfc || 0)}
                        </td>
                        <td className={`py-2.5 px-3 text-right text-slate-300 ${getTableTrendClass(log, 'indusind', previousLog)}`}>
                          {formatMoney(log.indusind || 0)}
                        </td>
                        <td className={`py-2.5 px-3 text-right text-slate-300 ${getTableTrendClass(log, 'idfc', previousLog)}`}>
                          {formatMoney(log.idfc || 0)}
                        </td>
                        <td className={`py-2.5 px-3 text-right text-slate-300 ${getTableTrendClass(log, 'rbl', previousLog)}`}>
                          {formatMoney(log.rbl || 0)}
                        </td>
                        <td className={`py-2.5 px-3 text-right text-slate-300 ${getTableTrendClass(log, 'sbi', previousLog)}`}>
                          {formatMoney(log.sbi || 0)}
                        </td>
                        <td className={`py-2.5 px-3 text-right font-bold text-blue-400 border-r border-slate-800 ${getTableTrendClass(log, 'savings', previousLog)}`}>
                          {formatMoney(log.savings || 0)}
                        </td>

                        {/* Investments */}
                        <td className={`py-2.5 px-3 text-right text-slate-300 ${getTableTrendClass(log, 'mutual_funds', previousLog)}`}>
                          {formatMoney(log.mutual_funds || 0)}
                        </td>
                        <td className={`py-2.5 px-3 text-right text-slate-300 ${getTableTrendClass(log, 'indian_stocks', previousLog)}`}>
                          {formatMoney(log.indian_stocks || 0)}
                        </td>
                        <td className={`py-2.5 px-3 text-right text-slate-300 ${getTableTrendClass(log, 'us_stocks', previousLog)}`}>
                          {formatMoney(log.us_stocks || 0)}
                        </td>
                        <td className={`py-2.5 px-3 text-right text-slate-300 ${getTableTrendClass(log, 'nps', previousLog)}`}>
                          {formatMoney(log.nps || 0)}
                        </td>
                        <td className={`py-2.5 px-3 text-right text-slate-300 border-r border-slate-800 ${getTableTrendClass(log, 'epf', previousLog)}`}>
                          {formatMoney(log.epf || 0)}
                        </td>

                        {/* Total Assets */}
                        <td className={`py-2.5 px-3 text-right font-black text-emerald-400 border-r border-slate-800 ${getTableTrendClass(log, 'total_assets', previousLog)}`}>
                          {formatMoney(log.total_assets_inr || log.total_assets || 0)}
                        </td>

                        {/* Liabilities */}
                        <td className={`py-2.5 px-3 text-right text-slate-300 ${getTableTrendClass(log, 'loan', previousLog)}`}>
                          {formatMoney(log.loan || 0)}
                        </td>
                        <td className={`py-2.5 px-3 text-right text-slate-300 ${getTableTrendClass(log, 'credits', previousLog)}`}>
                          {formatMoney(log.credits || 0)}
                        </td>
                        <td className={`py-2.5 px-3 text-right font-bold text-rose-400 border-r border-slate-800 ${getTableTrendClass(log, 'debt', previousLog)}`}>
                          {formatMoney(log.debt || log.liabilities_inr || 0)}
                        </td>

                        {/* Net Wealth */}
                        <td className={`py-2.5 px-3 text-right font-black text-white text-[12px] ${getTableTrendClass(log, 'net_worth', previousLog)}`}>
                          {formatMoney(log.net_worth_inr || log.wealth || 0)}
                        </td>

                        {/* Period P&L */}
                        <td className={`py-2.5 px-3 text-right font-bold ${getTableTrendClass(log, 'daily_pnl', previousLog)}`}>
                          <span className={`inline-block px-1.5 py-0.5 rounded ${
                            isPos
                              ? 'text-emerald-400 bg-emerald-500/10'
                              : isNeg
                                ? 'text-rose-400 bg-rose-500/10'
                                : 'text-blue-400 bg-blue-500/10'
                          }`}>
                            {isPos ? '+' : ''}{formatMoney(log.daily_pnl_inr || 0)}
                          </span>
                        </td>

                        {/* % Change */}
                        <td className={`py-2.5 px-3 text-right font-bold text-[11px] ${getTableTrendClass(log, 'pct', previousLog)}`}>
                          <span className={isPos ? 'text-emerald-400' : isNeg ? 'text-rose-400' : 'text-slate-400'}>
                            {isPos ? '+' : ''}{Number(log.pnl_percentage || 0).toFixed(2)}%
                          </span>
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
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
                    <span className="text-[9.5px] font-black text-slate-400 uppercase tracking-widest block mb-1">Liability Delta</span>
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
                  const isPeriod = modalLog.period_type && modalLog.period_type !== 'daily';

                  return (
                    <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                      <div className="flex items-center gap-3">
                        {isPeriod ? (
                          <div className="flex flex-col">
                            <span className="text-3xl font-black font-sans leading-none text-slate-100 tracking-tight">{modalLog.period_label}</span>
                            <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400 mt-1">{modalLog.period_subtext || modalLog.period_type}</span>
                          </div>
                        ) : (
                          <>
                            <span className="text-5xl font-black font-sans leading-none text-slate-100 tracking-tight">{mDayNum}</span>
                            <div className="flex flex-col">
                              <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-400">Valuation Date</span>
                              <span className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider leading-none mt-0.5">{mMonthShort} 20{mYearShort}</span>
                            </div>
                          </>
                        )}
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

                {/* Day / Period Net Summary Banner */}
                <div className="grid grid-cols-2 gap-3 p-3 glass-subcard rounded-2xl border border-slate-800">
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">
                      {modalLog.period_type === 'monthly' ? 'Month-End Wealth' : modalLog.period_type === 'yearly' ? 'Year-End Wealth' : 'Net Worth'}
                    </span>
                    <span className="text-sm font-black font-mono text-white">{formatMoney(modalLog.net_worth_inr)}</span>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">
                      {modalLog.period_type === 'monthly' ? 'Monthly P&L' : modalLog.period_type === 'yearly' ? 'Annual P&L' : 'Daily P&L'}
                    </span>
                    <span className={`text-sm font-black font-mono ${modalLog.daily_pnl_inr > 0 ? 'text-emerald-400' : modalLog.daily_pnl_inr < 0 ? 'text-rose-400' : 'text-blue-400'}`}>
                      {modalLog.daily_pnl_inr > 0 ? '+' : ''}{formatMoney(modalLog.daily_pnl_inr)}
                    </span>
                  </div>
                </div>

                {/* Tab Controls for Modal */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-1 bg-slate-900/80 p-0.5 rounded-xl border border-slate-800 text-[10px] font-bold">
                    <button
                      onClick={() => setModalTab('changed')}
                      className={`px-2.5 py-1 rounded-lg transition-all ${
                        modalTab === 'changed'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Changes ({changedCategoryKeys.length})
                    </button>
                    <button
                      onClick={() => setModalTab('all')}
                      className={`px-2.5 py-1 rounded-lg transition-all ${
                        modalTab === 'all'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      All Balances (8)
                    </button>
                  </div>
                </div>

                {/* Modal Content based on active tab */}
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1 custom-scrollbar">
                  {modalTab === 'changed' ? (
                    changedCategoryKeys.length === 0 ? (
                      <div className="py-6 text-center space-y-2 bg-slate-900/40 rounded-xl border border-slate-800/40 p-3">
                        <p className="text-slate-400 text-xs font-semibold">No price changes on this date.</p>
                        <p className="text-slate-500 text-[10px]">Markets are closed on weekends / holidays.</p>
                        <button
                          onClick={() => setModalTab('all')}
                          className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-emerald-400 text-[10px] font-bold rounded-lg border border-slate-700 transition-colors"
                        >
                          View All Portfolio Balances →
                        </button>
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
                    )
                  ) : (
                    /* All Balances View */
                    <div className="space-y-1.5">
                      {Object.keys(CATEGORY_META).map((key) => {
                        const meta = CATEGORY_META[key];
                        const val = modalLog.breakdown?.[key] || 0;
                        const prevVal = modalLog.prev_breakdown?.[key] || 0;
                        const diff = val - prevVal;
                        const isLiab = key === 'loan' || key === 'credits';

                        return (
                          <div key={key} className="flex items-center justify-between p-2 glass-subcard rounded-xl border border-slate-800/60 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta.color }}></span>
                              <span className="font-semibold text-slate-200 text-[10px]">{meta.label}</span>
                            </div>
                            <div className="text-right font-mono">
                              <span className="font-bold block text-[10px] text-white">{formatMoney(val)}</span>
                              {diff !== 0 ? (
                                <span className={`text-[8.5px] block font-bold ${
                                  isLiab 
                                    ? (diff < 0 ? 'text-emerald-400' : 'text-rose-400')
                                    : (diff > 0 ? 'text-emerald-400' : 'text-rose-400')
                                }`}>
                                  {diff > 0 ? '↑ +' : '↓ '}{formatMoney(diff)}
                                </span>
                              ) : (
                                <span className="text-[8.5px] block text-slate-500 font-sans">No change</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
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
