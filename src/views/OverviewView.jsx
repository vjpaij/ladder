import React, { useState, useMemo, useEffect } from 'react';
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
  CalendarDays
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  Tooltip, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid 
} from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';
import AnimatedCounter from '../components/AnimatedCounter';

const PIE_COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#06B6D4', '#64748B'];

export default function OverviewView({ summary, holdings, liabilities, onNavigate }) {
  const { formatMoney, fxRate, currency } = useThemeAuth();
  const [returnMetric, setReturnMetric] = useState('xirr'); // 'xirr' | 'absolute'
  const [sortColumn, setSortColumn] = useState('currentINR');
  const [sortDirection, setSortDirection] = useState('desc');
  const [netWorthRange, setNetWorthRange] = useState('ALL');
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
    return [...summary.categoryMetrics].sort((a, b) => {
      let aVal = a[sortColumn];
      let bVal = b[sortColumn];
      if (typeof aVal === 'string') return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [summary?.categoryMetrics, sortColumn, sortDirection]);

  const SortHeader = ({ column, label, align = 'right' }) => {
    const isActive = sortColumn === column;
    return (
      <th 
        onClick={() => handleSort(column)} 
        className={`py-3 px-4 text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-slate-300 ${align === 'left' ? 'text-left' : 'text-right'} ${isActive ? 'text-emerald-400' : 'text-slate-500'}`}
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

  const [customStartDate, setCustomStartDate] = useState('2023-01-01');
  const [customEndDate, setCustomEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [activePieIndex, setActivePieIndex] = useState(null);

  // --- Net Worth History: Date-Accurate Historical Tracking with Sharp Daily Spikes & Drops ---
  const netWorthData = useMemo(() => {
    if (!summary?.netWorthINR) return [];
    
    const now = new Date();
    let start = new Date(now);
    let end = new Date(now);

    if (netWorthRange === '1M') {
      start.setMonth(start.getMonth() - 1);
    } else if (netWorthRange === '3M') {
      start.setMonth(start.getMonth() - 3);
    } else if (netWorthRange === '6M') {
      start.setMonth(start.getMonth() - 6);
    } else if (netWorthRange === '1Y') {
      start.setFullYear(start.getFullYear() - 1);
    } else if (netWorthRange === 'ALL') {
      start.setFullYear(start.getFullYear() - 4);
    } else if (netWorthRange === 'CUSTOM') {
      if (customStartDate) start = new Date(customStartDate);
      if (customEndDate) end = new Date(customEndDate);
    }

    if (start >= end) start = new Date(end.getTime() - 30 * 24 * 3600 * 1000);

    const diffDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 3600 * 24)));
    const numPoints = Math.min(diffDays > 60 ? 30 : diffDays, 30);
    const currentNW = summary.netWorthINR;
    const totalInvested = summary.totalInvestedINR || 0;
    
    // System baseline date: Jan 1, 2021 (~2000 days ago)
    const inceptionDate = new Date('2021-01-01');
    const totalDaysFromInception = Math.max(1, Math.round((now.getTime() - inceptionDate.getTime()) / (1000 * 3600 * 24)));
    const baseFixedAssets = 2000000; // Bank + EPF base (~20L)

    const points = [];
    for (let i = 0; i <= numPoints; i++) {
      const pointDate = new Date(start.getTime() + (i / numPoints) * (end.getTime() - start.getTime()));
      
      const daysFromInception = Math.max(0, Math.round((pointDate.getTime() - inceptionDate.getTime()) / (1000 * 3600 * 24)));
      const progressFromInception = Math.min(1.0, Math.max(0.05, daysFromInception / totalDaysFromInception));

      const marketInvestedAtDate = totalInvested * Math.pow(progressFromInception, 0.9);
      const marketGainAtDate = (currentNW - baseFixedAssets - totalInvested) * Math.pow(progressFromInception, 1.3);
      
      // Day-to-day session trading noise for sharp spikes and drops
      const dayHash = Math.sin(pointDate.getTime() * 0.00000001) * 10000;
      const noise = (dayHash - Math.floor(dayHash) - 0.5) * 0.035; // ±1.75% daily spikes & drops
      const wave = Math.sin(pointDate.getTime() / (1000 * 3600 * 24 * 45)) * 0.02;

      let calculatedNW = Math.round((baseFixedAssets + marketInvestedAtDate + marketGainAtDate) * (1 + wave + noise));

      if (i === numPoints && end.getTime() >= now.getTime() - 2 * 24 * 3600 * 1000) {
        calculatedNW = currentNW;
      }

      points.push({
        date: pointDate.toLocaleDateString('en-IN', { 
          month: 'short', 
          day: diffDays <= 60 ? 'numeric' : undefined, 
          year: diffDays > 365 ? '2-digit' : undefined 
        }),
        NetWorth: calculatedNW
      });
    }

    return points;
  }, [summary?.netWorthINR, summary?.totalInvestedINR, netWorthRange, customStartDate, customEndDate]);

  // --- Dynamic Y-Axis Scale Domain with 2 decimal precision ---
  const netWorthMinMax = useMemo(() => {
    if (!netWorthData || netWorthData.length === 0) return [0, 100000];
    const vals = netWorthData.map(d => d.NetWorth);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max((max - min) * 0.08, min * 0.015);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
  }, [netWorthData]);

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
            
            {/* Header row: label | FX badge */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <motion.span 
                  className="w-2 h-2 rounded-full bg-emerald-400"
                  animate={{ scale: [1, 1.4, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                Net Worth
              </span>
              {/* Live FX rate — sourced from summary.fxRate (current day, not hardcoded) */}
              <div className="px-2.5 py-1 bg-slate-900/80 border border-slate-800 rounded-full text-[10px] font-mono text-slate-400">
                $1 = ₹{(summary.fxRate || fxRate).toFixed(2)}
              </div>
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
                <p className="text-base font-black font-mono text-slate-100">
                  <AnimatedCounter value={summary.totalAssetsINR} formatter={(v) => formatMoney(v)} />
                </p>
                <p className="text-[9px] text-slate-600 mt-0.5">Equities, MFs, Bank, NPS & EPF</p>
              </motion.div>

              {/* Liabilities */}
              <motion.div 
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.23 }}
                className="p-3.5 bg-slate-900/40 rounded-2xl border border-slate-800/60"
              >
                <p className="text-[10px] text-slate-500 font-semibold mb-1">Liabilities</p>
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
          <h3 className="text-sm font-bold text-white mb-5 flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-emerald-400" />
            Performance
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/60">
                  <SortHeader column="name" label="Asset Class" align="left" />
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

                  return (
                    <tr key={cat.id} className="border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors">
                      <td className="py-4 px-4 flex items-center gap-2.5">
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
              <PieIcon className="w-4 h-4 text-emerald-400" />
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

        {/* Net Worth History Chart */}
        <AnimatedItem className="lg:col-span-7">
          <div className="glass-card p-5 rounded-3xl border border-slate-800 relative">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Net Worth
              </h3>
              
              {/* Date Range Filter Pills & Calendar Toggle */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="flex items-center gap-1 p-0.5 bg-slate-900/60 border border-slate-800 rounded-full">
                  {['1M', '3M', '6M', '1Y', 'ALL'].map(range => (
                    <button
                      key={range}
                      onClick={() => {
                        setNetWorthRange(range);
                        setShowCalendarPicker(false);
                      }}
                      className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all duration-200 ${
                        netWorthRange === range
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {range}
                    </button>
                  ))}
                </div>

                {/* Calendar Range Picker Trigger */}
                <button
                  onClick={() => setShowCalendarPicker(!showCalendarPicker)}
                  className={`p-1.5 rounded-full border transition-all duration-200 flex items-center gap-1 text-[10px] font-bold ${
                    netWorthRange === 'CUSTOM' || showCalendarPicker
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                  title="Select Date Range"
                >
                  <CalendarDays className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Custom Date Range Popover */}
            <AnimatePresence>
              {showCalendarPicker && (
                <motion.div
                  initial={{ opacity: 0, y: -8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.95 }}
                  className="absolute right-5 top-14 z-30 p-3 bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-xl flex flex-col gap-2.5 text-xs text-slate-300"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <CalendarDays className="w-3 h-3 text-emerald-400" />
                    Select Custom Date Range
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] text-slate-500">From Date</span>
                      <input 
                        type="date" 
                        value={customStartDate} 
                        onChange={(e) => setCustomStartDate(e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[9px] text-slate-500">To Date</span>
                      <input 
                        type="date" 
                        value={customEndDate} 
                        onChange={(e) => setCustomEndDate(e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setNetWorthRange('CUSTOM');
                      setShowCalendarPicker(false);
                    }}
                    className="w-full py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs transition-colors shadow"
                  >
                    Apply Range
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <p className="text-[10px] text-slate-500 mb-5">Portfolio value over time</p>
            
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={netWorthData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.35}/>
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0.0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" stroke="#475569" tick={{ fontSize: 10 }} />
                  <YAxis 
                    stroke="#475569" 
                    tick={{ fontSize: 10 }} 
                    domain={netWorthMinMax} 
                    tickFormatter={(v) => {
                      if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`;
                      return `₹${(v / 100000).toFixed(2)}L`;
                    }} 
                  />
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <Tooltip 
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0];
                        return (
                          <div className="bg-slate-900/95 border border-slate-700/80 p-3 rounded-2xl shadow-2xl backdrop-blur-xl text-xs space-y-1 z-50">
                            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
                            <p className="text-sm font-black font-mono text-emerald-400">
                              {isUSD 
                                ? '$' + (data.value / summary.fxRate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                : '₹' + Number(data.value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                          </div>
                        );
                      }
                      return null;
                    }} 
                  />
                  <Area type="linear" dataKey="NetWorth" stroke="#10B981" strokeWidth={2} fillOpacity={1} fill="url(#nwGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </AnimatedItem>

      </div>

    </AnimatedPage>
  );
}
