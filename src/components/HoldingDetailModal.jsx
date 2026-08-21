import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, TrendingUp, TrendingDown, DollarSign, BarChart2, ArrowDownCircle,
  ArrowUpCircle, Gift, Percent, Calendar, ChevronDown, ChevronUp, Activity, Globe
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line, Scatter
} from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import HoldingLogo from './HoldingLogo';
import { CalendarDays } from 'lucide-react';
import formatDateDDMMYYYY from '../utils/dateFormatter';

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

function MetricCard({ label, value, sub, color = 'text-white', icon: Icon, positive }) {
  const posClass = positive === true ? 'text-emerald-400' : positive === false ? 'text-rose-400' : color;
  return (
    <div className="glass-card rounded-2xl p-4 border border-slate-800 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-slate-500">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-base font-black font-mono ${posClass}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 font-mono">{sub}</div>}
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
  const p = payload[0].payload;
  
  let displayEvents = p.events;
  let eventDate = label;
  
  // Magnetic Event Tooltip: if no event exactly on hovered day, check +/- 4 days
  if (!displayEvents && timelineData) {
    const currentIndex = timelineData.findIndex(d => d.label === label);
    if (currentIndex !== -1) {
      let minDistance = 5;
      for (let i = Math.max(0, currentIndex - 4); i <= Math.min(timelineData.length - 1, currentIndex + 4); i++) {
        if (timelineData[i].events) {
          const dist = Math.abs(i - currentIndex);
          if (dist < minDistance) {
            minDistance = dist;
            displayEvents = timelineData[i].events;
            eventDate = timelineData[i].label;
          }
        }
      }
    }
  }
  
  return (
    <div className="bg-slate-900/95 border border-slate-700 rounded-xl px-3 py-2 text-xs shadow-2xl z-50">
      <div className="text-slate-400 mb-1.5 font-mono">{formatDateDDMMYYYY(label)}</div>
      <div className="flex items-center gap-2 py-0.5 mb-1.5 border-b border-slate-800 pb-1.5">
        <span className="w-2 h-2 rounded-full inline-block bg-emerald-400" />
        <span className="text-slate-300">Price:</span>
        <span className="font-black text-white">{fmt(p.price)}</span>
      </div>
      {displayEvents && displayEvents.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-slate-800/80">
          {eventDate !== label && (
             <div className="text-[9px] font-bold text-slate-500 mb-1 tracking-wider">EVENT ON {formatDateDDMMYYYY(eventDate)}</div>
          )}
          {displayEvents.map((ev, i) => (
            <div key={i} className="flex flex-col gap-0.5 py-1 text-[10px]">
              <div className="flex items-center gap-2 font-bold">
                <span className={`px-1.5 py-0.5 rounded text-[9px] border ${
                  ev.type === 'BUY' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                  ev.type === 'SELL' ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' :
                  ev.type === 'DIVIDEND' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                  'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                }`}>
                  {ev.type}
                </span>
                {ev.qty > 0 && <span className="text-slate-300">{ev.qty} units</span>}
              </div>
              {ev.amountINR > 0 && (
                <div className="text-slate-400 pl-1 font-mono mt-0.5">
                  Amount: <span className="text-white">{isUSD ? fmtUSD(ev.amountUSD) : fmtINR(ev.amountINR)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const CustomizedEventDot = (props) => {
  const { cx, cy, payload } = props;
  if (!payload.events || payload.events.length === 0) return null;
  const ev = payload.events[0];
  const color = ev.type === 'BUY' ? '#10b981' :
                ev.type === 'SELL' ? '#f43f5e' :
                ev.type === 'DIVIDEND' ? '#f59e0b' : '#06b6d4';
                
  let titleText = `${formatDateDDMMYYYY(payload.label)}\n`;
  payload.events.forEach(e => {
    titleText += `${e.type}: ${e.qty > 0 ? e.qty + ' units' : ''} ${e.amountINR > 0 ? '₹' + e.amountINR : ''}\n`;
  });
                
  return (
    <g style={{ cursor: 'pointer' }}>
      <circle cx={cx} cy={cy} r={10} fill="transparent" title={titleText.trim()} />
      <circle cx={cx} cy={cy} r={5} stroke="#1e293b" strokeWidth={1.5} fill={color} style={{ filter: 'drop-shadow(0 0 4px rgba(0,0,0,0.5))' }} />
    </g>
  );
};

export default function HoldingDetailModal({ holding, onClose }) {
  const { currency, fxRate } = useThemeAuth();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [txSort, setTxSort] = useState({ field: 'date', dir: 'asc' });

  const [activeTab, setActiveTab] = useState('tracker'); // 'tracker' | 'actual'
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
    setLoading(true);
    setError(null);
    setDetail(null);
    fetch(`/api/holding/${encodeURIComponent(holding.id)}/detail`)
      .then(async r => {
        const contentType = r.headers.get('content-type') || '';
        const text = await r.text();
        let data;
        if (contentType.includes('application/json')) {
          try { data = JSON.parse(text); } catch (e) { /* ignore */ }
        }
        if (!r.ok) {
          const errMsg = data?.error || `Server error (${r.status} ${r.statusText})`;
          throw new Error(errMsg);
        }
        if (!data) {
          throw new Error(`Unexpected server response format (${r.status})`);
        }
        return data;
      })
      .then(data => {
        setDetail(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
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

  const sortedTxs = detail?.transactions ? [...detail.transactions].sort((a, b) => {
    let av = a[txSort.field] ?? '', bv = b[txSort.field] ?? '';
    if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
    if (av < bv) return txSort.dir === 'asc' ? -1 : 1;
    if (av > bv) return txSort.dir === 'asc' ? 1 : -1;
    return 0;
  }) : [];

  const accentColor = holding?.category_id === 'us_stocks' ? '#a855f7'
    : holding?.category_id === 'mutual_funds' ? '#f59e0b'
    : holding?.category_id === 'nps' ? '#06b6d4'
    : holding?.category_id === 'bank' ? '#3b82f6'
    : holding?.category_id === 'epf' ? '#6366f1'
    : (holding?.category_id === 'loans' || holding?.category_id === 'credit_cards') ? '#f43f5e'
    : '#10b981';

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

  const chartMinMax = React.useMemo(() => {
    if (!filteredTimeline || filteredTimeline.length === 0) return [0, 'auto'];
    if (activeTab === 'tracker') {
      const vals = filteredTimeline.flatMap(d => [d.invested, d.value]);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const pad = (max - min) * 0.05;
      return [Math.max(0, min - pad), max + pad];
    } else {
      const vals = filteredTimeline.map(d => d.price).filter(v => v !== undefined);
      if (vals.length === 0) return [0, 'auto'];
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const pad = (max - min) * 0.05;
      return [Math.max(0, min - pad), max + pad];
    }
  }, [filteredTimeline, activeTab]);

  const isFundOrNps = holding?.category_id === 'nps' || holding?.category_id === 'mutual_funds';
  const isEodAsset = ['bank', 'epf', 'loans', 'credit_cards'].includes(holding?.category_id);

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
                    <h2 className="text-white font-black text-[15px] leading-tight">{holding.name}</h2>
                    <span
                      className="text-[9px] font-black px-2 py-0.5 rounded-full border"
                      style={{ background: `${accentColor}20`, borderColor: `${accentColor}40`, color: accentColor }}
                    >
                      {holding.symbol}
                    </span>
                    {holding.exchange && (
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                        {holding.exchange}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      (Number(holding.quantity) || 0) > 0
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-slate-800 text-slate-500'
                    }`}>
                      {(Number(holding.quantity) || 0) > 0 ? 'ACTIVE' : 'REDEEMED'}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {holding.category_id === 'mutual_funds' ? 'Mutual Fund'
                        : holding.category_id === 'us_stocks' ? 'US Equity'
                        : holding.category_id === 'nps' ? 'NPS Scheme'
                        : holding.category_id === 'bank' ? 'Bank Account'
                        : holding.category_id === 'epf' ? 'Employee Provident Fund'
                        : holding.category_id === 'loans' ? 'Housing Loan'
                        : holding.category_id === 'credit_cards' ? 'Credit Card Balance'
                        : 'Indian Equity'}
                    </span>
                    {!isEodAsset && (Number(holding.quantity) || 0) > 0 && (
                      <span className="text-[10px] text-slate-500 font-mono">
                        {Number(holding.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 })} units @ {
                          isDisplayUSD
                            ? `$${Number(holding.current_price).toFixed(2)}`
                            : isFundOrNps
                            ? `₹${Number(holding.current_price).toFixed(4)}`
                            : `₹${(Number(holding.current_price) * (isUSStock ? fxRate : 1)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        }
                      </span>
                    )}
                    {isEodAsset && (
                      <span className="text-[10px] text-slate-400 font-mono font-bold">
                        Current EOD Balance: {fmt(m.currentValue || holding.current_price)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {isUSStock && (
                  <>
                    <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/25 text-purple-300 text-xs font-mono">
                      <Globe className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-[10px] text-slate-400 uppercase font-sans font-bold">Live FX (Today):</span>
                      <span className="text-purple-300 font-bold">1 USD = ₹{Number(fxRate || detail?.fxRate || 87.25).toFixed(2)}</span>
                    </div>

                    <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-xl p-1 text-[11px] font-bold">
                      <button
                        onClick={() => setDisplayCurrency('INR')}
                        className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                          displayCurrency === 'INR' ? 'bg-purple-600 text-white shadow-md font-black' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        ₹ INR
                      </button>
                      <button
                        onClick={() => setDisplayCurrency('USD')}
                        className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                          displayCurrency === 'USD' ? 'bg-purple-600 text-white shadow-md font-black' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        $ USD
                      </button>
                    </div>
                  </>
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
                        <MetricCard label="Inception Date" value={m.startDate || '2007-09-27'} icon={Calendar} color="text-indigo-400" />
                        <MetricCard label="Tracking Status" value="Daily EOD" icon={Activity} color="text-cyan-400" />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                        <MetricCard label="Total Invested"  value={fmt(m.totalInvested)}  icon={ArrowDownCircle} color="text-slate-300" />
                        <MetricCard label="Total Redeemed"  value={fmt(m.totalRedeemed)}  icon={ArrowUpCircle}   color="text-slate-300" />
                        <MetricCard
                          label="Current Value"
                          value={(Number(holding.quantity) || 0) > 0 ? fmt(m.currentValue) : '—'}
                          sub={isUSStock && (Number(holding.quantity) || 0) > 0
                            ? (isDisplayUSD ? `≈ ${fmtINR((m.currentValue || 0) * fxRate)}` : `≈ ${fmtUSD(Number(m.currentValue || 0) / fxRate)}`)
                            : null}
                          icon={DollarSign}
                          color="text-white"
                        />
                        <MetricCard
                          label="Unrealized P&L"
                          value={fmt(m.unrealizedPnl)}
                          sub={m.unrealizedPct != null ? `${m.unrealizedPct >= 0 ? '+' : ''}${m.unrealizedPct}%` : null}
                          icon={m.unrealizedPnl >= 0 ? TrendingUp : TrendingDown}
                          positive={(m.unrealizedPnl || 0) >= 0}
                        />
                        <MetricCard
                          label="Realized P&L"
                          value={fmt(m.realizedPnl)}
                          icon={BarChart2}
                          positive={(m.realizedPnl || 0) >= 0}
                        />
                        <MetricCard
                          label="Dividends"
                          value={fmt(m.totalDividends)}
                          sub={m.dividendCount > 0 ? `${m.dividendCount} payments` : null}
                          icon={Gift}
                          color="text-amber-400"
                        />
                        <MetricCard
                          label="Total XIRR"
                          value={`${(m.totalXirr || 0) >= 0 ? '+' : ''}${m.totalXirr || 0}%`}
                          sub={(m.currentXirr != null && m.currentXirr !== m.totalXirr)
                            ? `Active: ${(m.currentXirr || 0) >= 0 ? '+' : ''}${m.currentXirr}%`
                            : 'annualized p.a.'}
                          icon={Percent}
                          positive={(m.totalXirr || 0) >= 0}
                        />
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
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                              activeTab === 'tracker' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            Tracker Chart
                          </button>
                          <button
                            onClick={() => setActiveTab('actual')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                              activeTab === 'actual' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
                            }`}
                          >
                            Actual Chart
                          </button>
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
                                  <stop offset="5%" stopColor={accentColor} stopOpacity={0.35} />
                                  <stop offset="95%" stopColor={accentColor} stopOpacity={0.02} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                              <XAxis dataKey="label" tickFormatter={formatDateDDMMYYYY} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={30} />
                              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => isDisplayUSD ? `$${(v / 1000).toFixed(0)}K` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : `₹${(v / 1000).toFixed(0)}K`} width={55} domain={chartMinMax} />
                              <Tooltip content={<ChartTooltip isUSD={isDisplayUSD} />} cursor={{ stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' }} />
                              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={val => <span style={{ color: '#94a3b8' }}>{val}</span>} />
                              <Area type="linear" dataKey="invested" name="Cost Basis" stroke="#6366f1" strokeWidth={2} fill="url(#hdmGradInv)" dot={false} activeDot={{ r: 4, fill: '#6366f1', stroke: '#1e293b' }} />
                              <Area type="linear" dataKey="value" name="Market Value" stroke={accentColor} strokeWidth={2.5} fill="url(#hdmGradVal)" dot={false} activeDot={{ r: 4, fill: accentColor, stroke: '#1e293b' }} />
                            </AreaChart>
                          ) : (
                            <ComposedChart data={filteredTimeline} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                              <XAxis dataKey="label" tickFormatter={formatDateDDMMYYYY} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={30} />
                              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => isDisplayUSD ? `$${v.toFixed(2)}` : `₹${v.toFixed(2)}`} width={55} domain={chartMinMax} />
                              <Tooltip content={<ActualChartTooltip isUSD={isDisplayUSD} timelineData={filteredTimeline} />} cursor={{ stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' }} />
                              <Line type="linear" dataKey="price" name="Asset Price" stroke={accentColor} strokeWidth={2} dot={<CustomizedEventDot />} activeDot={{ r: 5, fill: '#ffffff', stroke: '#64748b', strokeWidth: 2 }} />
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
                              <th className="py-3 px-4">#</th>
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
                                    <td className="py-2.5 px-4 text-slate-600 font-mono text-[10px]">{i + 1}</td>
                                    <td className="py-2.5 px-4 font-mono text-slate-300 whitespace-nowrap">{formatTxDate(tx.date)}</td>
                                    <td className="py-2.5 px-4 text-right font-mono font-black text-white">
                                      ₹{eodBalance.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                    </td>
                                    <td className={`py-2.5 px-4 text-right font-mono font-bold ${isPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black border ${
                                        isPos ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'
                                      }`}>
                                        {isPos ? '↑ +' : '↓ -'}₹{changeVal.toLocaleString('en-IN')}
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-4 text-slate-500 italic text-[10px]">
                                      {tx.notes || `EOD Balance: ₹${eodBalance.toLocaleString('en-IN')}`}
                                    </td>
                                  </motion.tr>
                                );
                              }

                              const isBuy  = tx.type === 'BUY';
                              const isSell = tx.type === 'SELL';
                              const isDiv  = tx.type === 'DIVIDEND';
                              const rowHover = isBuy  ? 'hover:bg-emerald-500/5'
                                            : isSell ? 'hover:bg-rose-500/5'
                                            : isDiv  ? 'hover:bg-amber-500/5'
                                            : 'hover:bg-slate-800/30';
                              const amtColor = isBuy  ? 'text-rose-400'
                                            : isSell ? 'text-emerald-400'
                                            : isDiv  ? 'text-amber-400'
                                            : 'text-slate-400';

                              const txRate = isUSStock ? (Number(tx.fx_rate) || fxRate) : 1.0;
                              const displayAmt = isDisplayUSD
                                ? `$${(Number(tx.total_amount) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                : `₹${((Number(tx.total_amount) || 0) * txRate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

                              const displayCharges = isDisplayUSD
                                ? (Number(tx.charges) > 0 ? `$${Number(tx.charges).toFixed(2)}` : '—')
                                : (Number(tx.charges) > 0 ? `₹${(Number(tx.charges) * txRate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—');

                              return (
                                <motion.tr
                                  key={tx.id}
                                  className={`transition-colors ${rowHover}`}
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  transition={{ delay: Math.min(i * 0.015, 0.4) }}
                                >
                                  <td className="py-2.5 px-4 text-slate-600 font-mono text-[10px]">{i + 1}</td>
                                  <td className="py-2.5 px-4 font-mono text-slate-300 whitespace-nowrap" title={formatDateDDMMYYYY(tx.date)}>{formatDateDDMMYYYY(tx.date)}</td>
                                  <td className="py-2.5 px-4"><TxBadge type={tx.type} /></td>
                                  <td className="py-2.5 px-4 text-right font-mono text-slate-200">
                                    {Number(tx.quantity) > 0 ? Number(tx.quantity).toLocaleString('en-IN', { maximumFractionDigits: 4 }) : '—'}
                                  </td>
                                  <td className="py-2.5 px-4 text-right font-mono text-slate-400">
                                    {Number(tx.price) > 0 ? `${isUSStock ? '$' : '₹'}${Number(tx.price).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}
                                  </td>
                                  <td className={`py-2.5 px-4 text-right font-mono font-bold ${amtColor}`}>
                                    {Number(tx.total_amount) > 0 ? displayAmt : '—'}
                                  </td>
                                  <td className="py-2.5 px-4 text-right font-mono text-slate-500">
                                    {displayCharges}
                                  </td>
                                  {isUSStock && (
                                    <td className="py-2.5 px-4 text-right font-mono font-bold text-purple-400">
                                      {tx.fx_rate ? `₹${Number(tx.fx_rate).toFixed(2)}` : '—'}
                                    </td>
                                  )}
                                  <td className="py-2.5 px-4 text-slate-500 italic text-[10px]">
                                    {tx.notes || ''}
                                  </td>
                                </motion.tr>
                              );
                            })}
                            {sortedTxs.length === 0 && (
                              <tr>
                                <td colSpan={isEodAsset ? 5 : (isUSStock ? 9 : 8)} className="py-8 text-center text-slate-600">
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
