import React, { useState, useMemo, useEffect } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  TrendingUp,
  ArrowUpRight, 
  ArrowDownRight, 
  Percent,
  PieChart as PieIcon,
  BarChart2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CalendarDays,
  Donut,
  Search,
  X
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  Tooltip 
} from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';
import AnimatedCounter from '../components/AnimatedCounter';
import DashboardTrendChart from '../components/DashboardTrendChart';

const PIE_COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#06B6D4', '#64748B'];

export default function OverviewView({ summary, holdings, liabilities, onNavigate }) {
  const { formatMoney, fxRate, currency } = useThemeAuth();
  const [returnMetric, setReturnMetric] = useState('xirr'); // 'xirr' | 'absolute'
  const [rangeFilter, setRangeFilter] = useState({ type: 'ALL', startDate: null, endDate: null, rangeKey: 'ALL' });
  const [sortColumn, setSortColumn] = useState('currentINR');
  const [sortDirection, setSortDirection] = useState('desc');
  const [perfSearch, setPerfSearch] = useState('');
  const isDayPositive = summary?.dayPnlINR >= 0;
  const isGainPositive = summary?.totalGainINR >= 0;
  const isRealizedPositive = (summary?.totalRealizedPnlINR || 0) >= 0;

  // --- Currency-aware formatting helpers ---
  const isUSD = currency === 'USD';

  // For "Invested" in USD mode, use the raw dollar amount from the API (historical-rate correct)
  const investedDisplay = isUSD
    ? '$' + (summary?.totalInvestedUSD || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : formatMoney(summary?.totalInvestedINR || 0);

  // For "Realized P&L" in USD mode, use the USD figure from the API
  const realizedDisplay = isUSD
    ? (isRealizedPositive ? '+$' : '-$') + Math.abs(summary?.totalRealizedPnlUSD || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : `${isRealizedPositive ? '+' : ''}${formatMoney(summary?.totalRealizedPnlINR || 0)}`;

  // --- Performance Table Sorting ---
  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const sortedMetrics = useMemo(() => {
    if (!summary?.categoryMetrics) return [];
    let list = [...summary.categoryMetrics];
    if (perfSearch.trim()) {
      const q = perfSearch.toLowerCase().trim();
      list = list.filter(cat => cat.name.toLowerCase().includes(q));
    }
    return list.sort((a, b) => {
      let aVal = a[sortColumn];
      let bVal = b[sortColumn];
      if (typeof aVal === 'string') return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [summary?.categoryMetrics, sortColumn, sortDirection, perfSearch]);

  const SortHeader = ({ column, label, align = 'right', isFirst = false }) => {
    const isActive = sortColumn === column;
    return (
      <th 
        onClick={() => handleSort(column)} 
        className={`py-3 px-4 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-slate-300 ${align === 'left' ? 'text-left' : 'text-right'} ${isActive ? 'text-emerald-400' : 'text-slate-500'} ${isFirst ? 'sticky left-0 top-0 z-40 bg-slate-900 border-r border-slate-800 min-w-[200px]' : 'bg-slate-900'}`}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {isActive ? (
            sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
          ) : (
            <ArrowUpDown className="w-2.5 h-2.5 opacity-40" />
          )}
        </span>
      </th>
    );
  };

  const [activePieIndex, setActivePieIndex] = useState(null);

  // --- Net Worth History: True Historical EOD Data from /api/daily-pnl ---
  const [eodLogs, setEodLogs] = useState([]);
  const [loadingEod, setLoadingEod] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoadingEod(true);
    let url = `/api/daily-pnl?range=ALL`;
    if (rangeFilter.type === 'ALL') {
      url = `/api/daily-pnl?range=ALL`;
    } else if (rangeFilter.startDate && rangeFilter.endDate) {
      url = `/api/daily-pnl?startDate=${rangeFilter.startDate}&endDate=${rangeFilter.endDate}`;
    } else if (rangeFilter.rangeKey) {
      url = `/api/daily-pnl?range=${rangeFilter.rangeKey}`;
    }

    axios.get(url)
      .then(res => {
        if (isMounted && Array.isArray(res.data)) {
          setEodLogs(res.data);
        }
      })
      .catch(err => console.error('[OverviewView] Failed to fetch EOD logs for chart:', err))
      .finally(() => {
        if (isMounted) setLoadingEod(false);
      });

    return () => {
      isMounted = false;
    };
  }, [rangeFilter]);

  if (!summary) return null;

  // --- Custom Pie Chart with 3D effect ---
  const allocationData = summary.assetAllocation || [];
  const totalAllocation = allocationData.reduce((sum, a) => sum + a.value, 0);

  return (
    <AnimatedPage className="space-y-6">
      
      {/* Hero Net Worth Panel */}
      <AnimatedItem>
        <div className="glass-card rounded-3xl p-8 relative overflow-hidden gradient-border">
          
          {/* Animated glow orbs */}
          <motion.div 
            className="absolute -top-24 -right-24 w-72 h-72 bg-emerald-500/8 rounded-full blur-3xl pointer-events-none"
            animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 5, repeat: Infinity }}
          />
          <motion.div 
            className="absolute -bottom-24 -left-24 w-72 h-72 bg-indigo-500/8 rounded-full blur-3xl pointer-events-none"
            animate={{ scale: [1.2, 1, 1.2], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 6, repeat: Infinity }}
          />

          <div className="relative z-10">
            
            {/* Header row: label */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <motion.span 
                  className="w-2 h-2 rounded-full bg-emerald-400"
                  animate={{ scale: [1, 1.4, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                Net Worth
              </span>
            </div>

            {/* Big Number + Day P&L badge */}
            <div className="flex items-baseline gap-4 mb-4 flex-wrap">
              <h2 className="text-4xl sm:text-6xl font-black tracking-tight text-white font-mono">
                <AnimatedCounter 
                  value={summary.netWorthINR} 
                  formatter={(v) => formatMoney(v)}
                  duration={1400}
                />
              </h2>

              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.3, type: 'spring' }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                  isDayPositive ? 'badge-emerald' : 'badge-crimson'
                }`}
              >
                {isDayPositive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                <span>{isDayPositive ? '+' : ''}{formatMoney(summary.dayPnlINR)}</span>
                <span>({isDayPositive ? '+' : ''}{summary.dayPnlPct}%)</span>
              </motion.div>
            </div>

            {/* XIRR / Absolute Return toggle */}
            <div className="flex items-center gap-3 mb-5">
              <div className="flex items-center gap-1 p-0.5 bg-slate-900/60 border border-slate-800 rounded-full">
                <button
                  onClick={() => setReturnMetric('xirr')}
                  className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                    returnMetric === 'xirr'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  XIRR
                </button>
                <button
                  onClick={() => setReturnMetric('absolute')}
                  className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all duration-200 ${
                    returnMetric === 'absolute'
                      ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  ABS
                </button>
              </div>

              <AnimatePresence mode="wait">
                {returnMetric === 'xirr' ? (
                  <motion.div
                    key="xirr"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 6 }}
                    transition={{ duration: 0.18 }}
                    className="flex items-center gap-1.5"
                  >
                    <Percent className="w-3 h-3 text-emerald-400" />
                    <span className="text-sm font-black text-emerald-400 font-mono">
                      <AnimatedCounter value={summary.xirrPct} suffix="%" duration={900} />
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">XIRR Annualized</span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="absolute"
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 6 }}
                    transition={{ duration: 0.18 }}
                    className="flex items-center gap-1.5"
                  >
                    <TrendingUp className="w-3 h-3 text-indigo-400" />
                    <span className="text-sm font-black text-indigo-400 font-mono">
                      +<AnimatedCounter value={summary.absoluteReturnPct} suffix="%" duration={900} />
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">Absolute ROI</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Sub-Metrics: 5 cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-5 border-t border-slate-800/80">
              
              {/* Assets */}
              <motion.div 
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="p-3.5 bg-slate-900/40 rounded-2xl border border-slate-800/60"
              >
                <p className="text-[10px] text-slate-500 font-semibold mb-1">Assets</p>
                <p className="text-base font-black font-mono text-emerald-400">
                  <AnimatedCounter value={summary.totalAssetsINR} formatter={(v) => formatMoney(v)} />
                </p>
                <p className="text-[9px] text-slate-600 mt-0.5">Equity, MFs, Bank, NPS & EPF</p>
              </motion.div>

              {/* Liabilities */}
              <motion.div 
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.23 }}
                className="p-3.5 bg-slate-900/40 rounded-2xl border border-slate-800/60"
              >
                <p className="text-[10px] text-slate-500 font-semibold mb-1">Liability</p>
                <p className="text-base font-black font-mono text-rose-400">
                  <AnimatedCounter value={summary.totalLiabilitiesINR} formatter={(v) => formatMoney(v)} />
                </p>
                <p className="text-[9px] text-slate-600 mt-0.5">Loans & credit cards</p>
              </motion.div>

              {/* Invested */}
              <motion.div 
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.31 }}
                className="p-3.5 bg-slate-900/40 rounded-2xl border border-slate-800/60"
              >
                <p className="text-[10px] text-slate-500 font-semibold mb-1">Invested</p>
                <p className="text-base font-black font-mono text-slate-100">
                  {isUSD ? investedDisplay : <AnimatedCounter value={summary.totalInvestedINR} formatter={(v) => formatMoney(v)} />}
                </p>
                <p className="text-[9px] text-slate-600 mt-0.5">Cost basis</p>
              </motion.div>

              {/* Unrealized P&L */}
              <motion.div 
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.39 }}
                className="p-3.5 bg-slate-900/40 rounded-2xl border border-slate-800/60"
              >
                <p className="text-[10px] text-slate-500 font-semibold mb-1">Unrealized P&L</p>
                <p className={`text-base font-black font-mono ${isGainPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                  <AnimatedCounter value={summary.totalGainINR} formatter={(v) => `${isGainPositive ? '+' : ''}${formatMoney(v)}`} />
                </p>
                <p className="text-[9px] text-slate-600 mt-0.5">Open positions</p>
              </motion.div>

              {/* Realized P&L */}
              <motion.div 
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.47 }}
                className="p-3.5 bg-slate-900/40 rounded-2xl border border-slate-800/60"
              >
                <p className="text-[10px] text-slate-500 font-semibold mb-1">Realized P&L</p>
                <p className={`text-base font-black font-mono ${isRealizedPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isUSD ? realizedDisplay : (
                    <AnimatedCounter 
                      value={summary.totalRealizedPnlINR || 0} 
                      formatter={(v) => `${(summary.totalRealizedPnlINR || 0) >= 0 ? '+' : ''}${formatMoney(v)}`} 
                    />
                  )}
                </p>
                <p className="text-[9px] text-slate-600 mt-0.5">Closed positions & dividends</p>
              </motion.div>

            </div>

          </div>
        </div>
      </AnimatedItem>

      {/* Performance Table — directly below hero */}
      <AnimatedItem delay={0.1}>
        <div className="glass-card p-5 rounded-3xl border border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-emerald-400" />
              Performance
            </h3>
            <div className="relative w-full sm:w-60">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter asset classes..."
                value={perfSearch}
                onChange={(e) => setPerfSearch(e.target.value)}
                className="w-full pl-9 pr-10 py-1.5 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50"
              />
              {perfSearch && (
                <button
                  onClick={() => setPerfSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
          <div className="relative overflow-x-auto overflow-y-auto max-h-[540px] custom-scrollbar rounded-2xl border border-slate-800/80">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-30 bg-slate-900 shadow-sm">
                <tr className="border-b border-slate-800/60">
                  <SortHeader column="name" label="Asset Class" align="left" isFirst />
                  <SortHeader column="investedINR" label="Invested" />
                  <SortHeader column="currentINR" label="Current Value" />
                  <SortHeader column="unrealizedINR" label="Unrealized P&L" />
                  <SortHeader column="realizedINR" label="Realized P&L" />
                  <SortHeader column="absoluteReturnPct" label="ABS Return" />
                  <SortHeader column="xirrPct" label="XIRR" />
                </tr>
              </thead>
              <tbody>
                {sortedMetrics.map((cat) => {
                  const catInvested = formatMoney(isUSD ? cat.investedINR / summary.fxRate : cat.investedINR);
                  const catCurrent = formatMoney(isUSD ? cat.currentINR / summary.fxRate : cat.currentINR);
                  const catUnrealized = formatMoney(isUSD ? cat.unrealizedINR / summary.fxRate : cat.unrealizedINR);
                  const catRealized = formatMoney(isUSD ? cat.realizedINR / summary.fxRate : cat.realizedINR);

                  const getRouteForCategory = (catId) => {
                    const map = {
                      'in_stocks': 'indian_stocks',
                      'us_stocks': 'us_stocks',
                      'mutual_funds': 'mutual_funds',
                      'nps': 'nps',
                      'bank': 'bank',
                      'epf': 'epf',
                      'loans': 'liabilities',
                      'credit_cards': 'liabilities'
                    };
                    return map[catId] || 'overview';
                  };

                  const pieIndex = allocationData.findIndex(a => a.name === cat.name);

                  return (
                    <tr 
                      key={cat.id} 
                      className="group border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors cursor-pointer"
                      onClick={() => onNavigate(getRouteForCategory(cat.id))}
                      onMouseEnter={() => { if (pieIndex >= 0) setActivePieIndex(pieIndex); }}
                      onMouseLeave={() => setActivePieIndex(null)}
                    >
                      <td className="py-4 px-4 flex items-center gap-2.5 sticky left-0 z-20 bg-slate-900/95 group-hover:bg-slate-900/95 border-r border-slate-800 min-w-[200px]">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.color }}></div>
                        <span className="text-xs font-semibold text-slate-200">{cat.name}</span>
                      </td>
                      <td className="py-4 px-4 text-right text-xs font-mono text-slate-300">{catInvested}</td>
                      <td className="py-4 px-4 text-right text-xs font-mono font-bold text-white">{catCurrent}</td>
                      <td className={`py-4 px-4 text-right text-xs font-mono font-bold ${cat.unrealizedINR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {cat.unrealizedINR > 0 ? '+' : ''}{catUnrealized}
                      </td>
                      <td className={`py-4 px-4 text-right text-xs font-mono font-bold ${cat.realizedINR >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {cat.realizedINR > 0 ? '+' : ''}{catRealized}
                      </td>
                      <td className={`py-4 px-4 text-right text-xs font-mono font-bold ${cat.absoluteReturnPct >= 0 ? 'text-indigo-400' : 'text-rose-400'}`}>
                        {cat.absoluteReturnPct > 0 ? '+' : ''}{cat.absoluteReturnPct}%
                      </td>
                      <td className={`py-4 px-4 text-right text-xs font-mono font-bold ${cat.xirrPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {cat.xirrPct > 0 ? '+' : ''}{cat.xirrPct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </AnimatedItem>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Asset Allocation — Modern 3D Donut */}
        <AnimatedItem className="lg:col-span-5">
          <div className="glass-card p-5 rounded-3xl border border-slate-800">
            <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
              <Donut className="w-4 h-4 text-emerald-400" />
              Asset Allocation
            </h3>
            <p className="text-[10px] text-slate-500 mb-4">Distribution across asset classes</p>
            
            <div className="flex flex-col items-center">
              {/* 3D Perspective Donut */}
              <div className="h-[220px] w-full" style={{ perspective: '800px' }}>
                <div style={{ transform: 'rotateX(12deg)', transformOrigin: 'center center' }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart style={{ outline: 'none' }}>
                      <defs>
                        {PIE_COLORS.map((color, i) => (
                          <linearGradient key={`pie-grad-${i}`} id={`pieGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={1}/>
                            <stop offset="100%" stopColor={color} stopOpacity={0.6}/>
                          </linearGradient>
                        ))}
                        <filter id="pieShadow">
                          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000" floodOpacity="0.3"/>
                        </filter>
                      </defs>
                      <Pie
                        data={allocationData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={90}
                        paddingAngle={4}
                        dataKey="value"
                        stroke="none"
                        tabIndex={-1}
                        style={{ outline: 'none', cursor: 'pointer' }}
                        onClick={(_, index) => setActivePieIndex(activePieIndex === index ? null : index)}
                      >
                        {allocationData.map((entry, index) => {
                          const isSelected = activePieIndex === index;
                          return (
                            <Cell 
                              key={`cell-${index}`} 
                              fill={`url(#pieGrad${index % PIE_COLORS.length})`}
                              stroke={isSelected ? '#FFFFFF' : 'none'}
                              strokeWidth={isSelected ? 2 : 0}
                              style={{
                                outline: 'none',
                                filter: isSelected ? 'drop-shadow(0px 0px 8px rgba(16, 185, 129, 0.8))' : 'none',
                                transform: isSelected ? 'scale(1.08)' : 'scale(1)',
                                transformOrigin: 'center center',
                                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
                              }}
                            />
                          );
                        })}
                      </Pie>
                      <Tooltip 
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0];
                            return (
                              <div className="bg-slate-900/95 border border-slate-700/80 p-3 rounded-2xl shadow-2xl backdrop-blur-xl text-xs space-y-1 z-50 pointer-events-none">
                                <p className="font-bold text-slate-100 flex items-center gap-2">
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: data.payload.fill || data.color }}></span>
                                  {data.name}
                                </p>
                                <div className="pt-1 text-[11px] font-mono space-y-0.5">
                                  <p className="text-slate-300 flex justify-between gap-4">
                                    <span className="text-slate-500">Value:</span>
                                    <span className="font-bold text-emerald-400">
                                      {isUSD 
                                        ? '$' + (data.value / summary.fxRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                        : '₹' + Number(data.value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </span>
                                  </p>
                                  <p className="text-slate-300 flex justify-between gap-4">
                                    <span className="text-slate-500">Allocation:</span>
                                    <span className="font-bold text-slate-200">{Number(data.payload.percentage).toFixed(2)}%</span>
                                  </p>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        }} 
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Custom Legend with Click/Hover Pop-Forward */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 mt-2 w-full">
                {allocationData.map((entry, index) => {
                  const isSelected = activePieIndex === index;
                  return (
                    <div 
                      key={entry.name} 
                      onClick={() => setActivePieIndex(isSelected ? null : index)}
                      onMouseEnter={() => setActivePieIndex(index)}
                      onMouseLeave={() => setActivePieIndex(null)}
                      className={`flex items-center gap-2 cursor-pointer p-1.5 rounded-xl transition-all duration-200 ${
                        isSelected ? 'bg-slate-800/90 border border-emerald-500/50 shadow-md scale-105' : 'hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}></div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[10px] truncate transition-colors ${isSelected ? 'text-white font-bold' : 'text-slate-400'}`}>{entry.name}</p>
                      </div>
                      <span className={`text-[10px] font-mono font-bold shrink-0 ${isSelected ? 'text-emerald-400' : 'text-slate-300'}`}>{Number(entry.percentage).toFixed(2)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </AnimatedItem>

        {/* Multi-Select Trend History Chart */}
        <AnimatedItem className="lg:col-span-7">
          <DashboardTrendChart
            eodLogs={eodLogs}
            loading={loadingEod}
            rangeFilter={rangeFilter}
            onRangeChange={(range) => setRangeFilter(range)}
            summary={summary}
          />
        </AnimatedItem>

      </div>

    </AnimatedPage>
  );
}
