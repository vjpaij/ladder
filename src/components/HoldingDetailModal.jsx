import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, TrendingUp, TrendingDown, DollarSign, BarChart2, ArrowDownCircle,
  ArrowUpCircle, Gift, Percent, Calendar, ChevronDown, ChevronUp, Activity, Globe
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';

function fmtINR(val) {
  const n = Number(val) || 0;
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtUSD(val) {
  const n = Number(val) || 0;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      <div className="text-slate-400 mb-1.5 font-mono">{label}</div>
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

export default function HoldingDetailModal({ holding, onClose }) {
  const { currency, fxRate } = useThemeAuth();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [txSort, setTxSort] = useState({ field: 'date', dir: 'asc' });

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

  const isFundOrNps = holding?.category_id === 'nps' || holding?.category_id === 'mutual_funds';
  const isEodAsset = ['bank', 'epf', 'loans', 'credit_cards'].includes(holding?.category_id);

  return (
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
            className="fixed inset-x-0 bottom-0 top-[3%] z-50 flex flex-col border border-slate-800 rounded-t-3xl overflow-hidden shadow-2xl"
            style={{ background: '#06080D' }}
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
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center font-black text-sm border"
                  style={{ background: `${accentColor}20`, borderColor: `${accentColor}40`, color: accentColor }}
                >
                  {(holding.symbol || '').slice(0, 2).toUpperCase()}
                </div>
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
                            : `₹${Math.round(Number(holding.current_price) * (isUSStock ? fxRate : 1)).toLocaleString('en-IN')}`
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
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
                        <BarChart2 className="w-3.5 h-3.5" /> Invested vs Value Timeline ({displayCurrency})
                      </p>
                      <div className="glass-card rounded-2xl border border-slate-800 p-4">
                        <ResponsiveContainer width="100%" height={250}>
                          <AreaChart data={activeTimeline} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
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
                            <XAxis
                              dataKey="label"
                              tick={{ fill: '#64748b', fontSize: 10 }}
                              tickLine={false}
                              axisLine={false}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              tick={{ fill: '#64748b', fontSize: 10 }}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={v => isDisplayUSD
                                ? `$${(v / 1000).toFixed(0)}K`
                                : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(1)}L` : `₹${(v / 1000).toFixed(0)}K`
                              }
                              width={72}
                            />
                            <Tooltip content={<ChartTooltip isUSD={isDisplayUSD} />} />
                            <Legend
                              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                              formatter={val => <span style={{ color: '#94a3b8' }}>{val}</span>}
                            />
                            <Area
                              type="stepAfter"
                              dataKey="invested"
                              name="Cost Basis"
                              stroke="#6366f1"
                              strokeWidth={2}
                              fill="url(#hdmGradInv)"
                              dot={false}
                              activeDot={{ r: 4, fill: '#6366f1', stroke: '#1e293b' }}
                            />
                            <Area
                              type="monotone"
                              dataKey="value"
                              name="Market Value"
                              stroke={accentColor}
                              strokeWidth={2.5}
                              fill="url(#hdmGradVal)"
                              dot={false}
                              activeDot={{ r: 4, fill: accentColor, stroke: '#1e293b' }}
                            />
                          </AreaChart>
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
                                    <td className="py-2.5 px-4 font-mono text-slate-300 whitespace-nowrap">{tx.date}</td>
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
                                : `₹${Math.round((Number(tx.total_amount) || 0) * txRate).toLocaleString('en-IN')}`;

                              const displayCharges = isDisplayUSD
                                ? (Number(tx.charges) > 0 ? `$${Number(tx.charges).toFixed(2)}` : '—')
                                : (Number(tx.charges) > 0 ? `₹${Math.round(Number(tx.charges) * txRate).toLocaleString('en-IN')}` : '—');

                              return (
                                <motion.tr
                                  key={tx.id}
                                  className={`transition-colors ${rowHover}`}
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  transition={{ delay: Math.min(i * 0.015, 0.4) }}
                                >
                                  <td className="py-2.5 px-4 text-slate-600 font-mono text-[10px]">{i + 1}</td>
                                  <td className="py-2.5 px-4 font-mono text-slate-300 whitespace-nowrap">{tx.date}</td>
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
}
