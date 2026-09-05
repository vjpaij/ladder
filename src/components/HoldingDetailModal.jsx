import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, TrendingUp, TrendingDown, DollarSign, BarChart2, ArrowDownCircle,
  ArrowUpCircle, Gift, Percent, Calendar, ChevronDown, ChevronUp, Activity, Globe
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line
} from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import HoldingLogo from './HoldingLogo';
import { CalendarDays } from 'lucide-react';
import formatDateDDMMYYYY, { formatQuoteBadgeDate } from '../utils/dateFormatter';

function fmtINR(val) {
  const n = Number(val) || 0;
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtUSD(val) {
  const n = Number(val) || 0;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTxDate(dateStr) {
  if (!dateStr) return '—';
  const parts = dateStr.split('T')[0].split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dateStr;
}

function MetricCard({ label, value, sub, color = 'text-white', icon: Icon, positive, accent }) {
  const posClass = positive === true ? 'text-emerald-400' : positive === false ? 'text-rose-400' : color;
  const accentBar = accent || (positive === true ? 'bg-emerald-500' : positive === false ? 'bg-rose-500' : 'bg-slate-600');
  return (
    <div className="glass-card rounded-xl border border-slate-800/60 flex overflow-hidden h-full group hover:border-slate-700/80 transition-all duration-300">
      <div className={`w-1 shrink-0 ${accentBar}`} />
      <div className="flex flex-col py-3 px-3.5 flex-1 min-w-0">
        <span className="text-[9px] font-semibold uppercase tracking-widest text-slate-500 mb-1">{label}</span>
        <div className={`text-[15px] font-black font-mono ${posClass} leading-tight`}>{value}</div>
        {sub && <div className="mt-auto pt-1.5">{typeof sub === 'string' ? <span className="text-[10px] text-slate-500 font-mono">{sub}</span> : sub}</div>}
      </div>
    </div>
  );
}

function TxBadge({ type }) {
  const cfg = {
    BUY:      { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'BUY' },
    SELL:     { cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30',          label: 'SELL' },
    DIVIDEND: { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30',       label: 'DIV' },
    SPLIT:    { cls: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',     label: 'SPLIT' },
    BONUS:    { cls: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',          label: 'BONUS' },
  };
  const c = cfg[type] || cfg.BUY;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black border ${c.cls}`}>
      {c.label}
    </span>
  );
}

function ChartTooltip({ active, payload, label, isUSD }) {
  if (!active || !payload?.length) return null;
  const fmt = isUSD ? fmtUSD : fmtINR;
  return (
    <div className="bg-slate-900/95 border border-slate-700 rounded-xl px-3 py-2 text-xs shadow-2xl">
      <div className="text-slate-400 mb-1.5 font-mono">{formatDateDDMMYYYY(label)}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-slate-300">{p.name}:</span>
          <span className="font-black" style={{ color: p.color }}>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function ActualChartTooltip({ active, payload, label, isUSD, timelineData }) {
  if (!active || !payload?.length) return null;
  const fmt = isUSD ? fmtUSD : fmtINR;
  const point = payload[0].payload;
  let events = point.events;
  let eventDate = label;
  const currentIndex = timelineData?.findIndex(d => d.label === label) ?? -1;
  if (!events && currentIndex >= 0) {
    let nearest = 5;
    for (let i = Math.max(0, currentIndex - 4); i <= Math.min(timelineData.length - 1, currentIndex + 4); i++) {
      if (timelineData[i].events && Math.abs(i - currentIndex) < nearest) {
        nearest = Math.abs(i - currentIndex);
        events = timelineData[i].events;
        eventDate = timelineData[i].label;
      }
    }
  }
  return (
    <div className="bg-slate-900/95 border border-slate-700 rounded-xl px-3 py-2 text-xs shadow-2xl">
      <div className="text-slate-400 mb-1.5 font-mono">{formatDateDDMMYYYY(label)}</div>
      <div className="flex items-center gap-2 border-b border-slate-800 pb-1.5">
        <span className="w-2 h-2 rounded-full bg-sky-400" />
        <span className="text-slate-300">Price:</span>
        <span className="font-black text-white">{fmt(point.price)}</span>
      </div>
      {events?.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-slate-800/80">
          {eventDate !== label && <div className="text-[9px] font-bold text-slate-500 mb-1">EVENT ON {formatDateDDMMYYYY(eventDate)}</div>}
          {events.map((event, index) => (
            <div key={index} className="flex items-center gap-2 py-1 text-[10px] font-bold">
              <span className={`px-1.5 py-0.5 rounded border ${event.type === 'BUY' ? 'text-emerald-400 border-emerald-500/30' : event.type === 'SELL' ? 'text-rose-400 border-rose-500/30' : event.type === 'DIVIDEND' ? 'text-amber-400 border-amber-500/30' : 'text-cyan-400 border-cyan-500/30'}`}>{event.type}</span>
              {event.qty > 0 && <span className="text-slate-300">{event.qty} units</span>}
              {event.amountINR > 0 && <span className="text-slate-400">{isUSD ? fmtUSD(event.amountUSD) : fmtINR(event.amountINR)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const ActualEventDot = ({ cx, cy, payload }) => {
  if (!payload.events?.length) return null;
  const type = payload.events[0].type;
  const color = type === 'BUY' ? '#10b981' : type === 'SELL' ? '#f43f5e' : type === 'DIVIDEND' ? '#f59e0b' : '#06b6d4';
  return <g><circle cx={cx} cy={cy} r={9} fill="transparent" /><circle cx={cx} cy={cy} r={5} fill={color} stroke="#1e293b" strokeWidth={1.5} /></g>;
};

function formatAxisValue(value, isUSD) {
  const n = Number(value) || 0;
  if (isUSD) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function HoldingDetailModal({ holding, onClose }) {
  const { currency, theme, fxRate } = useThemeAuth();
  const isLight = theme === 'light' || theme === 'warm_light' || theme === 'nordic_light';
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [txSort, setTxSort] = useState({ field: 'date', dir: 'asc' });

  const [activeTab, setActiveTab] = useState('tracker');
  const [chartRange, setChartRange] = useState('ALL');
  const [customStartDate, setCustomStartDate] = useState('2023-01-01');
  const [customEndDate, setCustomEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);

  const isUSStock = holding?.category_id === 'us_stocks' || holding?.currency === 'USD';
  const [displayCurrency, setDisplayCurrency] = useState(isUSStock ? currency : 'INR');

  // Keep displayCurrency in sync if global currency changes and modal is open
  useEffect(() => {
    if (isUSStock) {
      setDisplayCurrency(currency);
    }
  }, [currency, isUSStock]);

  useEffect(() => {
    if (!holding?.id) return;
    let isMounted = true;

    const fetchDetail = async (isInitial = false) => {
      if (isInitial) {
        setLoading(true);
        setError(null);
        setDetail(null);
      }
      try {
        const r = await fetch(`/api/holding/${encodeURIComponent(holding.id)}/detail`);
        const contentType = r.headers.get('content-type') || '';
        const text = await r.text();
        let data;
        if (contentType.includes('application/json')) {
          try { data = JSON.parse(text); } catch (e) { /* ignore */ }
        }
        if (!r.ok) {
          throw new Error(data?.error || `Server error (${r.status})`);
        }
        if (isMounted && data) {
          setDetail(data);
          if (isInitial) setLoading(false);
        }
      } catch (err) {
        if (isMounted && isInitial) {
          setError(err.message);
          setLoading(false);
        }
      }
    };

    fetchDetail(true);
    const pollTimer = setInterval(() => fetchDetail(false), 2000);

    return () => {
      isMounted = false;
      clearInterval(pollTimer);
    };
  }, [holding?.id]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleTxSort = (field) => {
    setTxSort(prev => ({
      field,
      dir: prev.field === field ? (prev.dir === 'asc' ? 'desc' : 'asc') : 'asc'
    }));
  };

  const SortIcon = ({ field }) => {
    if (txSort.field !== field) return <ChevronDown className="w-3 h-3 text-slate-600 inline ml-0.5" />;
    return txSort.dir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-emerald-400 inline ml-0.5" />
      : <ChevronDown className="w-3 h-3 text-emerald-400 inline ml-0.5" />;
  };

  const accentColor = holding?.category_id === 'us_stocks' ? '#a855f7'
    : holding?.category_id === 'mutual_funds' ? '#f59e0b'
    : holding?.category_id === 'nps' ? '#06b6d4'
    : holding?.category_id === 'bank' ? '#3b82f6'
    : holding?.category_id === 'epf' ? '#6366f1'
    : (holding?.category_id === 'loans' || holding?.category_id === 'credit_cards') ? '#f43f5e'
    : '#10b981';

  // Professional Sky Blue theme for price curves that contrasts with Green BUY and Red SELL signals
  const chartLineColor = isLight ? '#0284c7' : '#38bdf8';

  const isDisplayUSD = isUSStock && displayCurrency === 'USD';
  const activeMetrics = isDisplayUSD
    ? (detail?.metricsUSD || detail?.metrics || {})
    : (detail?.metricsINR || detail?.metrics || {});
  const activeTimeline = isDisplayUSD
    ? (detail?.timelineUSD || detail?.timeline || [])
    : (detail?.timelineINR || detail?.timeline || []);

  const fmt = isDisplayUSD ? fmtUSD : fmtINR;
  const m = activeMetrics;
  const pricePrefix = isDisplayUSD ? '$' : '₹';

  const quotePriceVal = detail?.quote?.price !== undefined ? detail.quote.price : Number(holding?.current_price || 0);
  const dayChangeVal = detail?.quote?.dayChange !== undefined ? detail.quote.dayChange : (holding?.day_change !== undefined ? holding.day_change : 0);
  const dayChangePctVal = detail?.quote?.dayChangePct !== undefined ? detail.quote.dayChangePct : (holding?.day_change_pct !== undefined ? holding.day_change_pct : 0);

  const filteredTimeline = React.useMemo(() => {
    if (!activeTimeline || activeTimeline.length === 0) return [];
    let start = new Date();
    let end = new Date();
    if (chartRange === '1M') start.setMonth(start.getMonth() - 1);
    else if (chartRange === '3M') start.setMonth(start.getMonth() - 3);
    else if (chartRange === '6M') start.setMonth(start.getMonth() - 6);
    else if (chartRange === '1Y') start.setFullYear(start.getFullYear() - 1);
    else if (chartRange === 'ALL') start = new Date(activeTimeline[0].label);
    else if (chartRange === 'CUSTOM') {
      if (customStartDate) start = new Date(customStartDate);
      if (customEndDate) end = new Date(customEndDate);
    }
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    return activeTimeline.filter(t => t.label >= startStr && t.label <= endStr);
  }, [activeTimeline, chartRange, customStartDate, customEndDate]);

  const filteredTransactions = React.useMemo(() => {
    if (!detail?.transactions) return [];
    if (chartRange === 'ALL') return detail.transactions;
    const start = filteredTimeline[0]?.label;
    const end = filteredTimeline[filteredTimeline.length - 1]?.label;
    if (!start || !end) return [];
    return detail.transactions.filter(tx => {
      const date = (tx.date || '').split('T')[0];
      return date >= start && date <= end;
    });
  }, [detail?.transactions, chartRange, filteredTimeline]);

  const sortedTxs = [...filteredTransactions].sort((a, b) => {
    let av = a[txSort.field] ?? '', bv = b[txSort.field] ?? '';
    if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
    if (av < bv) return txSort.dir === 'asc' ? -1 : 1;
    if (av > bv) return txSort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  const chartMinMax = React.useMemo(() => {
    if (!filteredTimeline || filteredTimeline.length === 0) return [0, 'auto'];
    const vals = activeTab === 'tracker'
      ? filteredTimeline.flatMap(d => [d.invested, d.value])
      : filteredTimeline.map(d => d.price).filter(v => v !== undefined);
    if (vals.length === 0) return [0, 'auto'];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.05;
    return [Math.max(0, min - pad), max + pad];
  }, [filteredTimeline, activeTab]);

  const isFundOrNps = holding?.category_id === 'nps' || holding?.category_id === 'mutual_funds';
  const isEodAsset = ['bank', 'epf', 'loans', 'credit_cards'].includes(holding?.category_id);
  const hasActualChart = holding?.category_id !== 'bank' && holding?.category_id !== 'epf';
  const displayHoldingName = holding?.category_id === 'bank'
    ? holding.name.replace(/\s*\(SBI\)/gi, '').trim()
    : holding?.category_id === 'epf'
    ? 'Employee Provident Fund'
    : holding?.name;

  useEffect(() => {
    if (!hasActualChart) setActiveTab('tracker');
  }, [hasActualChart, holding?.id]);

  const modalContent = (
    <AnimatePresence>
      {holding && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Slide-up panel */}
          <motion.div
            className="modal-surface fixed inset-x-0 bottom-0 top-[3%] z-50 flex flex-col border border-slate-800 rounded-t-3xl overflow-hidden shadow-2xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-6 py-4 border-b border-slate-800 flex-shrink-0"
              style={{ background: `linear-gradient(135deg, ${accentColor}10 0%, transparent 60%)` }}
            >
              <div className="flex items-center gap-3">
                <HoldingLogo holding={holding} accentColor={accentColor} />
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-white font-black text-[15px] leading-tight">{displayHoldingName}</h2>
                    {holding.category_id !== 'epf' && (
                      <span
                        className="text-[9px] font-black px-2 py-0.5 rounded-full border"
                        style={{ background: `${accentColor}20`, borderColor: `${accentColor}40`, color: accentColor }}
                      >
                        {holding.symbol}
                      </span>
                    )}
                    {holding.exchange && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                        {holding.exchange}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {holding.category_id !== 'bank' && holding.category_id !== 'epf' && <span className="text-[10px] text-slate-500">
                      {holding.category_id === 'mutual_funds' ? 'Mutual Fund'
                        : holding.category_id === 'us_stocks' ? 'US Equity'
                        : holding.category_id === 'nps' ? 'NPS Scheme'
                        : holding.category_id === 'loans' ? 'Housing Loan'
                        : holding.category_id === 'credit_cards' ? 'Credit Card Balance'
                        : 'Indian Equity'}
                      </span>}
                    {!isEodAsset && (Number(holding.quantity) || 0) > 0 && (
                      <span className="text-[10px] text-slate-500 font-mono">
                        {Number(holding.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 })} units
                      </span>
                    )}
                    {isEodAsset && (
                      <span className="text-[10px] text-slate-400 font-mono font-bold">
                        Current Balance: {fmt(m.currentValue || holding.current_price)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 sm:gap-4">
                {isUSStock && (
                  <>
                    <div className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-mono border ${
                      isLight
                        ? 'bg-purple-100 text-purple-950 border-purple-300 shadow-sm font-black'
                        : 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                    }`}>
                      <Globe className={`w-3.5 h-3.5 ${isLight ? 'text-purple-700' : 'text-purple-400'}`} />
                      <span className={`text-[10px] uppercase font-sans font-bold ${isLight ? 'text-purple-800' : 'text-slate-400'}`}>FX:</span>
                      <span className={`font-extrabold ${isLight ? 'text-purple-950' : 'text-purple-200'}`}>
                        ₹{Number(detail?.fxRate || fxRate || 87.25).toFixed(2)}
                      </span>
                    </div>

                    <div className={`flex items-center rounded-xl p-1 text-[11px] font-bold border ${
                      isLight ? 'bg-slate-200/80 border-slate-300' : 'bg-slate-900 border-slate-700/80'
                    }`}>
                      <button
                        onClick={() => setDisplayCurrency('INR')}
                        className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                          displayCurrency === 'INR'
                            ? 'bg-purple-600 text-white shadow-md font-black'
                            : (isLight ? 'text-slate-700 hover:text-slate-950' : 'text-slate-400 hover:text-white')
                        }`}
                      >
                        ₹ INR
                      </button>
                      <button
                        onClick={() => setDisplayCurrency('USD')}
                        className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                          displayCurrency === 'USD'
                            ? 'bg-purple-600 text-white shadow-md font-black'
                            : (isLight ? 'text-slate-700 hover:text-slate-950' : 'text-slate-400 hover:text-white')
                        }`}
                      >
                        $ USD
                      </button>
                    </div>
                  </>
                )}

                {/* Live Price Header Display - Always anchored consistently at the right */}
                {!isEodAsset && (
                  <div className="flex flex-col items-end">
                    <div className="flex items-center gap-2">
                      <span className={`text-base sm:text-lg font-black font-mono ${isLight ? 'text-slate-900' : 'text-white'}`}>
                        {isDisplayUSD 
                          ? fmtUSD(quotePriceVal) 
                          : isFundOrNps 
                          ? `₹${Number(quotePriceVal).toFixed(2)}` 
                          : fmtINR(quotePriceVal * (isUSStock && !isDisplayUSD ? fxRate : 1))}
                      </span>
                      {dayChangeVal !== undefined && (
                        <span className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                          dayChangeVal >= 0 
                            ? (isLight ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30')
                            : (isLight ? 'bg-rose-100 text-rose-700 border border-rose-200' : 'bg-rose-500/15 text-rose-400 border border-rose-500/30')
                        }`}>
                          {dayChangeVal >= 0 ? '▲ +' : '▼ '}{isDisplayUSD ? `$${Math.abs(dayChangeVal).toFixed(2)}` : `₹${Math.abs(dayChangeVal).toFixed(2)}`} ({dayChangeVal >= 0 ? '+' : ''}{dayChangePctVal}%)
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-end">
                      {(() => {
                        const rawQuoteDate = detail?.quote?.quoteDate || holding?.quoteDate || detail?.quote?.updated || new Date();
                        const formattedDate = formatQuoteBadgeDate(rawQuoteDate);
                        const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
                        const isToday = formattedDate === todayStr || formattedDate.includes('Today');
                        
                        return (
                          <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                            isToday
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                              : 'bg-amber-500/10 text-amber-400/90 border-amber-500/20'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${isToday ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                            {isToday ? `Today (${formattedDate})` : `As of ${formattedDate}`}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}

                <button
                  onClick={onClose}
                  className="p-2 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

              {loading && (
                <div className="flex items-center justify-center h-60 gap-3">
                  <div
                    className="w-6 h-6 border-2 rounded-full animate-spin"
                    style={{ borderColor: `${accentColor}30`, borderTopColor: accentColor }}
                  />
                  <span className="text-slate-400 text-sm">Loading details...</span>
                </div>
              )}

              {error && (
                <div className="flex items-center justify-center h-60 text-rose-400 text-sm">
                  Failed to load: {error}
                </div>
              )}

              {!loading && !error && detail && (
                <>
                  {/* ---- Market Stats Snapshot (Open, High, Low, Prev Close, 52W Range) ---- */}
                  {!isEodAsset && (
                    <motion.div 
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`p-3.5 rounded-2xl border ${
                        isLight 
                          ? 'bg-slate-50 border-slate-200/90 shadow-xs' 
                          : 'glass-card border-slate-800/80 bg-slate-900/40'
                      }`}
                    >
                      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                        {/* 4 Key Stat Points */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 flex-1 w-full">
                          <div>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-0.5">Open</span>
                            <span className={`text-xs font-mono font-bold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                              {fmt(detail?.quote?.open || quotePriceVal)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-0.5">Prev Close</span>
                            <span className={`text-xs font-mono font-bold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
                              {fmt(detail?.quote?.previousClose || quotePriceVal)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-0.5">Day High</span>
                            <span className="text-xs font-mono font-bold text-emerald-400">
                              {fmt(detail?.quote?.high || quotePriceVal)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-0.5">Day Low</span>
                            <span className="text-xs font-mono font-bold text-rose-400">
                              {fmt(detail?.quote?.low || quotePriceVal)}
                            </span>
                          </div>
                        </div>

                        {/* 52-Week Range Slider Bar */}
                        {(() => {
                          const high52 = Number(detail?.quote?.fiftyTwoWeekHigh || holding.fifty_two_week_high || (quotePriceVal * 1.15));
                          const low52 = Number(detail?.quote?.fiftyTwoWeekLow || holding.fifty_two_week_low || (quotePriceVal * 0.85));
                          if (high52 <= low52) return null;
                          const range = high52 - low52;
                          const pos = Math.min(Math.max(((quotePriceVal - low52) / range) * 100, 0), 100);

                          return (
                            <div className="w-full lg:w-72 pl-0 lg:pl-4 lg:border-l border-slate-700/40 flex flex-col justify-center">
                              <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                                <span>52W L: {fmt(low52)}</span>
                                <span className={`font-black uppercase tracking-widest ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>52W Range</span>
                                <span>52W H: {fmt(high52)}</span>
                              </div>
                              <div className="relative w-full h-2 rounded-full bg-slate-800 overflow-visible mt-1">
                                <div 
                                  className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-500" 
                                  style={{ width: '100%' }}
                                />
                                <motion.div 
                                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 shadow-md ${
                                    isLight ? 'bg-slate-900 border-white' : 'bg-white border-slate-950'
                                  }`}
                                  style={{ left: `${pos}%` }}
                                  animate={{ scale: [1, 1.25, 1] }}
                                  transition={{ duration: 2, repeat: Infinity }}
                                  title={`Current: ${fmt(quotePriceVal)} (${pos.toFixed(0)}% of 52W range)`}
                                />
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </motion.div>
                  )}

                  {/* ---- Metrics Grid ---- */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
                      <Activity className="w-3.5 h-3.5" /> Performance Summary ({displayCurrency})
                    </p>

                    {isEodAsset ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                        <MetricCard label="Current Balance" value={fmt(m.currentValue)} icon={DollarSign} color="text-white" />
                        <MetricCard label="Peak Historical" value={fmt(m.peakValue || m.currentValue)} icon={ArrowUpCircle} color="text-emerald-400" />
                        <MetricCard label="Min Historical" value={fmt(m.minValue || m.totalInvested)} icon={ArrowDownCircle} color="text-slate-400" />
                        <MetricCard 
                          label="1-Year Change" 
                          value={fmt(m.oneYearDelta || 0)} 
                          sub={`${(m.oneYearPct || 0) >= 0 ? '+' : ''}${m.oneYearPct || 0}%`} 
                          icon={TrendingUp} 
                          positive={(m.oneYearDelta || 0) >= 0} 
                        />
                        <MetricCard label="Inception Date" value={formatTxDate(m.startDate || '2007-09-27')} icon={Calendar} color="text-indigo-400" />
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5">
                        {/* ---- Row 1: P&L Hero + Key Values ---- */}
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">

                          {/* P&L Hero Card - spans 5 cols */}
                          {(() => {
                            const totalPnl = (m.unrealizedPnl || 0) + (m.realizedPnl || 0);
                            const isPositive = totalPnl >= 0;

                            const cardBorder = isLight
                              ? (isPositive ? 'border-emerald-300/80 shadow-xs' : 'border-rose-300/80 shadow-xs')
                              : (isPositive ? 'border-emerald-500/20' : 'border-rose-500/20');

                            const gradientBg = isLight
                              ? (isPositive 
                                  ? 'bg-gradient-to-br from-emerald-50/90 via-emerald-100/30 to-white' 
                                  : 'bg-gradient-to-br from-rose-50/90 via-rose-100/30 to-white')
                              : (isPositive 
                                  ? 'bg-gradient-to-br from-emerald-950/40 via-slate-900/80 to-slate-950' 
                                  : 'bg-gradient-to-br from-rose-950/40 via-slate-900/80 to-slate-950');

                            const mainPnlColor = isPositive 
                              ? (isLight ? 'text-emerald-700' : 'text-emerald-400')
                              : (isLight ? 'text-rose-700' : 'text-rose-400');

                            const unrealizedColor = (m.unrealizedPnl || 0) >= 0
                              ? (isLight ? 'text-emerald-700' : 'text-emerald-400/90')
                              : (isLight ? 'text-rose-700' : 'text-rose-400/90');

                            const realizedColor = (m.realizedPnl || 0) >= 0
                              ? (isLight ? 'text-emerald-700' : 'text-emerald-400/90')
                              : (isLight ? 'text-rose-700' : 'text-rose-400/90');

                            const dividerBg = isLight
                              ? (isPositive ? 'bg-emerald-200' : 'bg-rose-200')
                              : (isPositive ? 'bg-emerald-500/20' : 'bg-rose-500/20');

                            return (
                              <div className={`lg:col-span-5 relative rounded-xl overflow-hidden border ${cardBorder}`}>
                                <div className={`absolute inset-0 ${gradientBg}`} />
                                <div className={`absolute top-0 left-0 w-32 h-32 rounded-full blur-3xl ${isLight ? 'opacity-30' : 'opacity-20'} ${isPositive ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                                <div className="relative p-4 flex flex-col gap-2">
                                  <span className={`text-[10px] font-semibold uppercase tracking-widest ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>Total P&L</span>
                                  <div className={`text-2xl font-black font-mono ${mainPnlColor}`}>
                                    {fmt(totalPnl)}
                                  </div>
                                  <div className="flex items-center gap-4 mt-1">
                                    <div className="flex flex-col">
                                      <span className="text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">Unrealized</span>
                                      <span className={`text-[13px] font-bold font-mono ${unrealizedColor}`}>
                                        {fmt(m.unrealizedPnl)}
                                        {m.unrealizedPct != null && <span className="text-[10px] ml-1 opacity-80">({m.unrealizedPct >= 0 ? '+' : ''}{m.unrealizedPct}%)</span>}
                                      </span>
                                    </div>
                                    <div className={`w-px h-8 ${dividerBg}`} />
                                    <div className="flex flex-col">
                                      <span className="text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">Realized</span>
                                      <span className={`text-[13px] font-bold font-mono ${realizedColor}`}>
                                        {fmt(m.realizedPnl)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Right side - 7 cols with key metrics */}
                          <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                            <MetricCard label="Total Bought" value={fmt(m.totalInvested)} accent="bg-blue-500" color={isLight ? "text-slate-800" : "text-slate-200"} />
                            <MetricCard label="Total Sold" value={fmt(m.totalRedeemed)} accent="bg-indigo-500" color={isLight ? "text-slate-800" : "text-slate-200"} />
                            <MetricCard
                              label="Current Cost"
                              value={(Number(holding.quantity) || 0) > 0 ? fmt(m.currentInvested) : '—'}
                              accent="bg-cyan-500"
                              color={isLight ? "text-slate-800" : "text-slate-300"}
                            />
                            <MetricCard
                              label="Current Value"
                              value={(Number(holding.quantity) || 0) > 0 ? fmt(m.currentValue) : '—'}
                              sub={isUSStock && (Number(holding.quantity) || 0) > 0
                                ? (isDisplayUSD ? `≈ ${fmtINR((m.currentValue || 0) * fxRate)}` : `≈ ${fmtUSD(Number(m.currentValue || 0) / fxRate)}`)
                                : null}
                              accent={isLight ? "bg-slate-800" : "bg-white"}
                              color={isLight ? "text-slate-900" : "text-white"}
                            />
                          </div>
                        </div>

                        {/* ---- Row 2: Secondary Metrics ---- */}
                        <div className="grid grid-cols-3 gap-2.5">
                          <MetricCard
                            label="Dividends"
                            value={fmt(m.totalDividends)}
                            sub={m.dividendCount > 0 ? `${m.dividendCount} payments` : null}
                            accent="bg-amber-500"
                            color="text-amber-400"
                          />
                          <MetricCard
                            label="Charges"
                            value={fmt(m.totalCharges)}
                            sub={
                              <div className="flex items-center gap-2">
                                <span className="text-[8.5px] font-medium text-slate-500">B {fmt(m.buyCharges)}</span>
                                <span className="text-slate-700/50">|</span>
                                <span className="text-[8.5px] font-medium text-slate-500">S {fmt(m.sellCharges)}</span>
                              </div>
                            }
                            accent="bg-orange-500"
                            color="text-amber-500"
                          />
                          <MetricCard
                            label="XIRR"
                            value={`${(m.totalXirr || 0) >= 0 ? '+' : ''}${m.totalXirr || 0}%`}
                            positive={(m.totalXirr || 0) >= 0}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ---- Chart ---- */}
                  {activeTimeline.length > 1 && (
                    <div className="flex flex-col gap-3">
                      {/* Chart Header Controls */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-1 p-1 bg-slate-900/60 border border-slate-800 rounded-xl">
                          <button
                            onClick={() => setActiveTab('tracker')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${activeTab === 'tracker' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                          >
                            Tracker Chart
                          </button>
                          {hasActualChart && (
                            <button
                              onClick={() => setActiveTab('actual')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${activeTab === 'actual' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                              Actual Chart
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 relative">
                          <div className="flex items-center gap-1 p-0.5 bg-slate-900/60 border border-slate-800 rounded-full">
                            {['1M', '3M', '6M', '1Y', 'ALL'].map(r => (
                              <button
                                key={r}
                                onClick={() => { setChartRange(r); setShowCalendarPicker(false); }}
                                className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all duration-200 ${
                                  chartRange === r ? `bg-emerald-500/20 text-emerald-400 border border-emerald-500/40` : 'text-slate-500 hover:text-slate-300 border border-transparent'
                                }`}
                              >
                                {r}
                              </button>
                            ))}
                          </div>
                          <button
                            onClick={() => setShowCalendarPicker(!showCalendarPicker)}
                            className={`p-1.5 rounded-full border transition-all duration-200 flex items-center gap-1 text-[10px] font-bold ${
                              chartRange === 'CUSTOM' || showCalendarPicker
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                                : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
                            }`}
                          >
                            <CalendarDays className="w-3.5 h-3.5" />
                          </button>

                          <AnimatePresence>
                            {showCalendarPicker && (
                              <motion.div
                                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                                className="absolute right-0 top-10 z-30 p-3 bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-xl flex flex-col gap-2.5 text-xs text-slate-300 w-64"
                              >
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                                  <CalendarDays className="w-3 h-3 text-emerald-400" /> Select Custom Date Range
                                </p>
                                <div className="flex items-center gap-2">
                                  <div className="flex flex-col gap-1 w-1/2">
                                    <span className="text-[9px] text-slate-500">From</span>
                                    <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[10px] text-slate-200 w-full" />
                                  </div>
                                  <div className="flex flex-col gap-1 w-1/2">
                                    <span className="text-[9px] text-slate-500">To</span>
                                    <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[10px] text-slate-200 w-full" />
                                  </div>
                                </div>
                                <button onClick={() => { setChartRange('CUSTOM'); setShowCalendarPicker(false); }} className="w-full py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs mt-1">
                                  Apply
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>

                      <div className="glass-card rounded-2xl border border-slate-800 p-4">
                        <ResponsiveContainer width="100%" height={280}>
                          {activeTab === 'tracker' ? (
                            <AreaChart data={filteredTimeline} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
                              <defs>
                                <linearGradient id="hdmGradInv" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                                </linearGradient>
                                <linearGradient id="hdmGradVal" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor={chartLineColor} stopOpacity={0.35} />
                                  <stop offset="95%" stopColor={chartLineColor} stopOpacity={0.02} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#e2e8f0' : '#1e293b'} />
                              <XAxis dataKey="label" tickFormatter={formatDateDDMMYYYY} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={30} />
                              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => formatAxisValue(v, isDisplayUSD)} width={85} domain={chartMinMax} />
                              <Tooltip content={<ChartTooltip isUSD={isDisplayUSD} />} cursor={{ stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' }} />
                              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={val => <span style={{ color: isLight ? '#475569' : '#94a3b8' }}>{val}</span>} />
                              <Area type="linear" dataKey="invested" name="Cost Basis" stroke="#6366f1" strokeWidth={2} fill="url(#hdmGradInv)" dot={false} activeDot={{ r: 4, fill: '#6366f1', stroke: '#1e293b' }} />
                              <Area type="linear" dataKey="value" name="Market Value" stroke={chartLineColor} strokeWidth={2.5} fill="url(#hdmGradVal)" dot={false} activeDot={{ r: 4, fill: chartLineColor, stroke: '#1e293b' }} />
                            </AreaChart>
                          ) : (
                            <ComposedChart data={filteredTimeline} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#e2e8f0' : '#1e293b'} />
                              <XAxis dataKey="label" tickFormatter={formatDateDDMMYYYY} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={30} />
                              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => isDisplayUSD ? `$${Number(v).toFixed(2)}` : `₹${Number(v).toFixed(2)}`} width={65} domain={chartMinMax} />
                              <Tooltip content={<ActualChartTooltip isUSD={isDisplayUSD} timelineData={filteredTimeline} />} cursor={{ stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' }} />
                              <Line type="linear" dataKey="price" name="Asset Price" stroke={chartLineColor} strokeWidth={2.5} dot={<ActualEventDot />} activeDot={{ r: 5, fill: chartLineColor, stroke: '#ffffff', strokeWidth: 2 }} />
                            </ComposedChart>
                          )}
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* ---- Transaction / EOD Ledger ---- */}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5" />
                      {isEodAsset ? `Daily Balance History (${sortedTxs.length} records)` : `Transaction Ledger (${sortedTxs.length} records)`}
                    </p>
                    <div className="glass-card rounded-2xl border border-slate-800 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-900/60 select-none">
                              <th onClick={() => handleTxSort('date')} className="py-3 px-4 cursor-pointer hover:text-white whitespace-nowrap">
                                Date <SortIcon field="date" />
                              </th>

                              {isEodAsset ? (
                                <>
                                  <th onClick={() => handleTxSort('price')} className="py-3 px-4 text-right cursor-pointer hover:text-white whitespace-nowrap">
                                    EOD Balance (₹) <SortIcon field="price" />
                                  </th>
                                  <th onClick={() => handleTxSort('total_amount')} className="py-3 px-4 text-right cursor-pointer hover:text-white whitespace-nowrap">
                                    Daily Change <SortIcon field="total_amount" />
                                  </th>
                                  <th className="py-3 px-4 text-left">Notes</th>
                                </>
                              ) : (
                                <>
                                  <th className="py-3 px-4">Type</th>
                                  <th onClick={() => handleTxSort('quantity')} className="py-3 px-4 text-right cursor-pointer hover:text-white whitespace-nowrap">
                                    Qty <SortIcon field="quantity" />
                                  </th>
                                  <th onClick={() => handleTxSort('price')} className="py-3 px-4 text-right cursor-pointer hover:text-white whitespace-nowrap">
                                    Price <SortIcon field="price" />
                                  </th>
                                  <th onClick={() => handleTxSort('total_amount')} className="py-3 px-4 text-right cursor-pointer hover:text-white whitespace-nowrap">
                                    {isDisplayUSD ? 'Amount ($)' : 'Amount (₹)'} <SortIcon field="total_amount" />
                                  </th>
                                  <th className="py-3 px-4 text-right whitespace-nowrap">Charges</th>
                                  {isUSStock && (
                                    <th className="py-3 px-4 text-right whitespace-nowrap text-purple-400 font-bold">
                                      Tx Dollar Rate
                                    </th>
                                  )}
                                  <th className="py-3 px-4 text-left">Notes</th>
                                </>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/40">
                            {sortedTxs.map((tx, i) => {
                              if (isEodAsset) {
                                const eodBalance = Number(tx.price) || 0;
                                const isPos = tx.type === 'BUY';
                                const changeVal = Number(tx.total_amount) || 0;

                                return (
                                  <motion.tr
                                    key={tx.id || i}
                                    className="hover:bg-slate-800/30 transition-colors"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: Math.min(i * 0.015, 0.4) }}
                                  >
                                    <td className="py-2.5 px-4 font-mono text-slate-300 whitespace-nowrap">{formatTxDate(tx.date)}</td>
                                    <td className="py-2.5 px-4 text-right font-mono font-black text-white">
                                      ₹{eodBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td className={`py-2.5 px-4 text-right font-mono font-bold ${isPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black border ${
                                        isPos ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'
                                      }`}>
                                        {isPos ? '↑ +' : '↓ -'}₹{changeVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-4 text-slate-500 italic text-[10px]">
                                      {tx.notes || `EOD Balance: ₹${eodBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                    </td>
                                  </motion.tr>
                                );
                              }

                              const isBuy   = tx.type === 'BUY';
                              const isSell  = tx.type === 'SELL';
                              const isDiv   = tx.type === 'DIVIDEND';
                              const isSplit = tx.type === 'SPLIT';
                              const isBonus = tx.type === 'BONUS' || tx.type === 'DIVIDEND_REINVEST';
                              
                              const rowHover = isBuy   ? 'hover:bg-emerald-500/5'
                                            : isSell  ? 'hover:bg-rose-500/5'
                                            : isDiv   ? 'hover:bg-amber-500/5'
                                            : isSplit ? 'hover:bg-indigo-500/5'
                                            : isBonus ? 'hover:bg-cyan-500/5'
                                            : 'hover:bg-slate-800/30';
                              const amtColor = isBuy   ? 'text-rose-400'
                                            : isSell  ? 'text-emerald-400'
                                            : isDiv   ? 'text-amber-400'
                                            : isSplit ? 'text-indigo-400'
                                            : isBonus ? 'text-cyan-400'
                                            : 'text-slate-400';

                              const txRate = isUSStock ? (Number(tx.fx_rate) || fxRate) : 1.0;
                              const displayAmt = isDisplayUSD
                                ? `$${(Number(tx.total_amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : `₹${((Number(tx.total_amount) || 0) * txRate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

                              const displayCharges = isDisplayUSD
                                ? (Number(tx.charges) > 0 ? `$${Number(tx.charges).toFixed(2)}` : '—')
                                : (Number(tx.charges) > 0 ? `₹${(Number(tx.charges) * txRate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—');

                              let qtyDisplay = '—';
                              if (isSplit && Number(tx.quantity) > 0) {
                                qtyDisplay = `+${Number(tx.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 })}`;
                              } else if (isBonus && Number(tx.quantity) > 0) {
                                qtyDisplay = `+${Number(tx.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 })}`;
                              } else if (Number(tx.quantity) > 0) {
                                qtyDisplay = Number(tx.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 });
                              }

                              let priceDisplay = '—';
                              if (isSplit) {
                                priceDisplay = '—';
                              } else if (isBonus && (!tx.price || Number(tx.price) === 0)) {
                                priceDisplay = isUSStock ? '$0.00' : '₹0.00';
                              } else if (Number(tx.price) > 0) {
                                priceDisplay = `${isUSStock ? '$' : '₹'}${Number(tx.price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                              }

                              let amountDisplay = '—';
                              if (isSplit) {
                                amountDisplay = '—';
                              } else if (isBonus && (!tx.total_amount || Number(tx.total_amount) === 0)) {
                                amountDisplay = isUSStock ? '$0.00' : '₹0.00';
                              } else if (Number(tx.total_amount) > 0) {
                                amountDisplay = displayAmt;
                              }

                              if (isSplit || isBonus) {
                                // Extract concise non-repetitive detail
                                let actionText = '';
                                if (isSplit) {
                                  const ratioMatch = (tx.notes || '').match(/(\d+\s*:\s*\d+)/);
                                  actionText = ratioMatch ? `Ratio ${ratioMatch[1]}` : '';
                                } else if (isBonus) {
                                  const sharesMatch = (tx.notes || '').match(/\+(\d+(?:\.\d+)?)/);
                                  actionText = sharesMatch ? `+${sharesMatch[1]} Shares Credited` : '+Shares Credited';
                                }

                                return (
                                  <tr
                                    key={tx.id || i}
                                    className={`border-y transition-colors ${
                                      isSplit
                                        ? (isLight
                                            ? 'bg-purple-50/90 border-purple-200 shadow-sm'
                                            : 'bg-purple-950/60 border-purple-500/40')
                                        : (isLight
                                            ? 'bg-amber-100/60 border-amber-300/80 shadow-sm'
                                            : 'bg-amber-950/60 border-amber-600/40')
                                    }`}
                                  >
                                    {/* Date aligned in its natural column */}
                                    <td className={`py-2.5 px-4 font-mono font-bold whitespace-nowrap ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>
                                      {formatDateDDMMYYYY(tx.date)}
                                    </td>
                                    {/* Action badge & short detail centered across all remaining columns */}
                                    <td colSpan={isUSStock ? 7 : 6} className="py-2.5 px-4 text-center">
                                      <div className="flex items-center justify-center gap-2.5 text-xs font-mono">
                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                                          isSplit
                                            ? (isLight
                                                ? 'bg-purple-100 text-purple-950 border-purple-300'
                                                : 'bg-purple-500/25 text-purple-300 border-purple-500/40')
                                            : (isLight
                                                ? 'bg-amber-200/90 text-amber-950 border-amber-400 font-black'
                                                : 'bg-amber-900/40 text-amber-300 border-amber-600/50')
                                        }`}>
                                          {isSplit ? 'Stock Split' : 'Bonus Issue'}
                                        </span>
                                        {actionText && (
                                          <span className={`font-bold text-[12px] ${
                                            isSplit
                                              ? (isLight ? 'text-purple-950 font-black' : 'text-purple-200')
                                              : (isLight ? 'text-amber-950 font-black' : 'text-amber-300')
                                          }`}>
                                            {actionText}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              }

                              return (
                                <motion.tr
                                  key={tx.id || i}
                                  className={`transition-colors ${rowHover}`}
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  transition={{ delay: Math.min(i * 0.015, 0.4) }}
                                >
                                  <td className="py-2.5 px-4 font-mono text-slate-300 whitespace-nowrap" title={formatDateDDMMYYYY(tx.date)}>{formatDateDDMMYYYY(tx.date)}</td>
                                  <td className="py-2.5 px-4"><TxBadge type={tx.type} /></td>
                                  <td className="py-2.5 px-4 text-right font-mono text-slate-200">
                                    {qtyDisplay}
                                  </td>
                                  <td className="py-2.5 px-4 text-right font-mono text-slate-400">
                                    {priceDisplay}
                                  </td>
                                  <td className={`py-2.5 px-4 text-right font-mono font-bold ${amtColor}`}>
                                    {amountDisplay}
                                  </td>
                                  <td className="py-2.5 px-4 text-right font-mono text-slate-500">
                                    {displayCharges}
                                  </td>
                                  {isUSStock && (
                                    <td className="py-2.5 px-4 text-right font-mono font-bold text-purple-400">
                                      {tx.fx_rate ? `₹${Number(tx.fx_rate).toFixed(2)}` : '—'}
                                    </td>
                                  )}
                                  <td className="py-2.5 px-4 text-slate-400 text-[11px]">
                                    {tx.notes || ''}
                                  </td>
                                </motion.tr>
                              );
                            })}
                            {sortedTxs.length === 0 && (
                              <tr>
                                <td colSpan={isEodAsset ? 4 : (isUSStock ? 8 : 7)} className="py-8 text-center text-slate-600">
                                  No records found
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
}
