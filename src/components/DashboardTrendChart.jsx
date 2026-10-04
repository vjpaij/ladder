import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  TrendingUp, 
  Layers, 
  Plus, 
  Check, 
  X, 
  ChevronDown, 
  Sparkles,
  BarChart2,
  SlidersHorizontal,
  RefreshCw
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ReferenceLine 
} from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import ChartRangeSelector from './ChartRangeSelector';

/**
 * Metric series definitions for the Dashboard Trend Chart.
 * Grouped into Totals, Assets, and Liabilities with distinct, harmonious fintech color accents.
 */
const TREND_METRIC_GROUPS = [
  {
    id: 'totals',
    label: 'Portfolio Totals',
    items: [
      {
        id: 'net_worth',
        label: 'Net Worth',
        shortLabel: 'Net Worth',
        dataKey: 'NetWorth',
        color: '#10B981', // Emerald
        strokeWidth: 2.5,
        category: 'totals',
        summaryField: 'netWorthINR'
      },
      {
        id: 'total_assets',
        label: 'Total Assets',
        shortLabel: 'Assets',
        dataKey: 'TotalAssets',
        color: '#38BDF8', // Sky Blue
        strokeWidth: 2,
        category: 'totals',
        summaryField: 'totalAssetsINR'
      },
      {
        id: 'total_liabilities',
        label: 'Total Liabilities',
        shortLabel: 'Liabilities',
        dataKey: 'TotalLiabilities',
        color: '#F43F5E', // Rose
        strokeWidth: 2,
        category: 'totals',
        summaryField: 'totalLiabilitiesINR'
      }
    ]
  },
  {
    id: 'assets',
    label: 'Asset Classes',
    items: [
      {
        id: 'indian_stocks',
        label: 'Indian Stocks',
        shortLabel: 'IN Stocks',
        dataKey: 'IndianStocks',
        color: '#2DD4BF', // Mint / Teal
        strokeWidth: 2,
        category: 'assets',
        catMetricId: 'in_stocks'
      },
      {
        id: 'mutual_funds',
        label: 'Mutual Funds',
        shortLabel: 'Mutual Funds',
        dataKey: 'MutualFunds',
        color: '#A855F7', // Purple
        strokeWidth: 2,
        category: 'assets',
        catMetricId: 'mutual_funds'
      },
      {
        id: 'epf',
        label: 'EPF',
        shortLabel: 'EPF',
        dataKey: 'Epf',
        color: '#818CF8', // Indigo
        strokeWidth: 2,
        category: 'assets',
        catMetricId: 'epf'
      },
      {
        id: 'us_stocks',
        label: 'US Stocks',
        shortLabel: 'US Stocks',
        dataKey: 'UsStocks',
        color: '#60A5FA', // Blue
        strokeWidth: 2,
        category: 'assets',
        catMetricId: 'us_stocks'
      },
      {
        id: 'savings',
        label: 'Bank Savings',
        shortLabel: 'Bank',
        dataKey: 'Savings',
        color: '#14B8A6', // Dark Teal
        strokeWidth: 2,
        category: 'assets',
        catMetricId: 'bank'
      },
      {
        id: 'nps',
        label: 'NPS',
        shortLabel: 'NPS',
        dataKey: 'Nps',
        color: '#F59E0B', // Amber
        strokeWidth: 2,
        category: 'assets',
        catMetricId: 'nps'
      }
    ]
  },
  {
    id: 'liabilities',
    label: 'Liabilities & Debt',
    items: [
      {
        id: 'loan',
        label: 'Loans',
        shortLabel: 'Loans',
        dataKey: 'Loans',
        color: '#FB923C', // Orange
        strokeWidth: 2,
        category: 'liabilities',
        catMetricId: 'loans'
      },
      {
        id: 'credits',
        label: 'Credit Cards',
        shortLabel: 'Credit Cards',
        dataKey: 'Credits',
        color: '#EC4899', // Pink
        strokeWidth: 2,
        category: 'liabilities',
        catMetricId: 'credit_cards'
      }
    ]
  }
];

// Flat lookup map of all available metrics
const ALL_TREND_METRICS = TREND_METRIC_GROUPS.flatMap(g => g.items);
const METRIC_MAP = Object.fromEntries(ALL_TREND_METRICS.map(m => [m.id, m]));

const STORAGE_KEY = 'ladder_dashboard_trend_series';

export default function DashboardTrendChart({
  eodLogs = [],
  loading = false,
  rangeFilter,
  onRangeChange,
  summary
}) {
  const { formatMoney, fxRate, currency } = useThemeAuth();
  const isUSD = currency === 'USD';
  const effectiveFxRate = summary?.fxRate || fxRate || 85.0;

  // Selected series state with persistent local storage
  const [selectedSeries, setSelectedSeries] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const valid = parsed.filter(id => METRIC_MAP[id]);
          if (valid.length > 0) return valid;
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
    return ['net_worth'];
  });

  // Save selection changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedSeries));
    } catch (e) {
      // Ignore storage errors
    }
  }, [selectedSeries]);

  // Hovered series for visual focus / dimming
  const [hoveredSeriesId, setHoveredSeriesId] = useState(null);

  // Dropdown popover state
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
      }
    }
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  // Toggle a series on or off
  const toggleSeries = (id) => {
    setSelectedSeries(prev => {
      if (prev.includes(id)) {
        // Enforce at least 1 series remains selected
        if (prev.length <= 1) return prev;
        return prev.filter(item => item !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  // Quick Preset Handlers
  const applyPreset = (presetKey) => {
    if (presetKey === 'net_worth') {
      setSelectedSeries(['net_worth']);
    } else if (presetKey === 'balance_sheet') {
      setSelectedSeries(['net_worth', 'total_assets', 'total_liabilities']);
    } else if (presetKey === 'all_assets') {
      setSelectedSeries(['indian_stocks', 'mutual_funds', 'epf', 'us_stocks', 'savings', 'nps']);
    } else if (presetKey === 'all') {
      setSelectedSeries(ALL_TREND_METRICS.map(m => m.id));
    }
  };

  // Helper to get live current value of any metric for the dropdown display
  const getLatestValue = (metric) => {
    if (!summary) return 0;
    if (metric.summaryField && summary[metric.summaryField] !== undefined) {
      return summary[metric.summaryField];
    }
    if (metric.catMetricId && summary.categoryMetrics) {
      const cat = summary.categoryMetrics.find(c => c.id === metric.catMetricId);
      if (cat) return cat.currentINR || 0;
    }
    return 0;
  };

  // Format currency value based on user currency mode
  const formatMetricValue = (valINR) => {
    if (isUSD) {
      const valUSD = (valINR || 0) / effectiveFxRate;
      return '$' + Math.abs(valUSD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return formatMoney(valINR || 0);
  };

  // --- Process and Sample Chart Data Gracefully ---
  const chartData = useMemo(() => {
    if (!eodLogs || eodLogs.length === 0) return [];

    const step = Math.max(1, Math.floor(eodLogs.length / 100)); // Sample gracefully if >100 points
    const sampled = [];

    const buildDataPoint = (item) => {
      const dParts = (item.log_date || '').split('-');
      let dateLabel = item.log_date;
      if (dParts.length === 3) {
        const dObj = new Date(`${item.log_date}T00:00:00Z`);
        dateLabel = dObj.toLocaleDateString('en-IN', {
          month: 'short',
          day: eodLogs.length <= 90 ? 'numeric' : undefined,
          year: eodLogs.length > 365 ? '2-digit' : undefined,
          timeZone: 'UTC'
        });
      }

      // Convert values to active currency mode if USD
      const scale = isUSD ? (1 / effectiveFxRate) : 1;

      const wealth = item.net_worth_inr ?? item.wealth ?? 0;
      const debt = item.liabilities_inr ?? item.debt ?? 0;
      const assets = item.total_assets_inr ?? (wealth + debt);

      return {
        date: dateLabel,
        rawDate: item.log_date,
        NetWorth: Number((wealth * scale).toFixed(2)),
        TotalAssets: Number((assets * scale).toFixed(2)),
        TotalLiabilities: Number((debt * scale).toFixed(2)),
        IndianStocks: Number(((item.indian_stocks ?? 0) * scale).toFixed(2)),
        MutualFunds: Number(((item.mutual_funds ?? 0) * scale).toFixed(2)),
        Epf: Number(((item.epf ?? 0) * scale).toFixed(2)),
        UsStocks: Number(((item.us_stocks ?? 0) * scale).toFixed(2)),
        Savings: Number(((item.savings ?? 0) * scale).toFixed(2)),
        Nps: Number(((item.nps ?? 0) * scale).toFixed(2)),
        Loans: Number(((item.loan ?? 0) * scale).toFixed(2)),
        Credits: Number(((item.credits ?? 0) * scale).toFixed(2))
      };
    };

    for (let i = 0; i < eodLogs.length; i += step) {
      sampled.push(buildDataPoint(eodLogs[i]));
    }

    // Ensure the last date point is always included
    const lastItem = eodLogs[eodLogs.length - 1];
    if (sampled.length > 0 && sampled[sampled.length - 1].rawDate !== lastItem.log_date) {
      sampled.push(buildDataPoint(lastItem));
    }

    return sampled;
  }, [eodLogs, isUSD, effectiveFxRate]);

  // Active series configs
  const activeMetrics = useMemo(() => {
    return selectedSeries.map(id => METRIC_MAP[id]).filter(Boolean);
  }, [selectedSeries]);

  // Dynamic Y-Axis scale domain across all active series
  const yAxisMinMax = useMemo(() => {
    if (!chartData || chartData.length === 0 || activeMetrics.length === 0) return [0, 100000];
    
    let min = Infinity;
    let max = -Infinity;

    chartData.forEach(d => {
      activeMetrics.forEach(m => {
        const v = d[m.dataKey];
        if (typeof v === 'number' && !isNaN(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      });
    });

    if (min === Infinity || max === -Infinity) return [0, 100000];

    const span = max - min;
    const pad = Math.max(span * 0.08, Math.abs(min) * 0.02, 100);

    const domainMin = min < 0 ? Math.floor(min - pad) : Math.max(0, Math.floor(min - pad));
    const domainMax = Math.ceil(max + pad);

    return [domainMin, domainMax];
  }, [chartData, activeMetrics]);

  // Check if primary Net Worth series is negative in trend
  const isNetWorthNegative = useMemo(() => {
    if (!chartData || chartData.length < 2) return false;
    return chartData[chartData.length - 1].NetWorth < chartData[0].NetWorth;
  }, [chartData]);

  const singleSeriesSelected = activeMetrics.length === 1;

  return (
    <div className="glass-card p-4 sm:p-5 rounded-2xl border border-slate-800 relative">
      
      {/* Header Row: Title & Range Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-white">Trend</h3>
            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-mono font-medium bg-slate-800/80 text-slate-400 border border-slate-700/50">
              {activeMetrics.length} {activeMetrics.length === 1 ? 'Metric' : 'Metrics'}
            </span>
          </div>
        </div>

        {/* Chart Range Selector */}
        <ChartRangeSelector
          initialRange="1M"
          onChange={onRangeChange}
        />
      </div>

      {/* Multiselect Control Bar: Left = Active Selected Pills, Right = Select Assets & Debt Button */}
      <div className="flex items-center justify-between gap-2.5 mb-3 pt-2 border-t border-slate-800/40 min-h-[34px]">
        
        {/* Left Side: Active Selected Pills */}
        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
          {activeMetrics.map(item => {
            const isHovered = hoveredSeriesId === item.id;
            const canRemove = activeMetrics.length > 1;

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.15 }}
                onMouseEnter={() => setHoveredSeriesId(item.id)}
                onMouseLeave={() => setHoveredSeriesId(null)}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[11px] font-medium cursor-pointer transition-all duration-150 border select-none ${
                  isHovered 
                    ? 'border-white/30 bg-slate-800 text-white shadow-sm' 
                    : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
                style={{
                  boxShadow: isHovered ? `0 0 10px ${item.color}30` : undefined
                }}
              >
                {/* Glowing Color Dot */}
                <span 
                  className="w-1.5 h-1.5 rounded-full shrink-0" 
                  style={{ 
                    backgroundColor: item.color,
                    boxShadow: `0 0 4px ${item.color}`
                  }} 
                />
                <span className="leading-none">{item.shortLabel}</span>

                {/* Remove button if more than 1 series is active */}
                {canRemove && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSeries(item.id);
                    }}
                    className="p-0.5 rounded hover:bg-slate-700 text-slate-400 hover:text-rose-400 transition-colors -mr-0.5"
                    title={`Remove ${item.label}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Right Side: Select Assets & Debt Button (with right-aligned dropdown popover) */}
        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            onClick={() => setIsDropdownOpen(prev => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all duration-150 border ${
              isDropdownOpen 
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 shadow-sm' 
                : 'bg-slate-900/80 text-slate-300 border-slate-700/70 hover:border-slate-600 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <SlidersHorizontal className="w-3 h-3 text-emerald-400" />
            <span>Select Assets & Debt</span>
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180 text-emerald-400' : 'text-slate-400'}`} />
          </button>

          {/* Rich Multiselect Dropdown Popover (anchored right-0) */}
          <AnimatePresence>
            {isDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="absolute right-0 top-full mt-1.5 w-72 sm:w-80 max-h-[440px] overflow-y-auto custom-scrollbar z-50 bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl backdrop-blur-2xl p-3 text-xs space-y-3"
                style={{ boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.05)' }}
              >
                
                {/* Preset Shortcuts */}
                <div className="flex items-center justify-between gap-1 pb-2 border-b border-slate-800">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Presets:</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => applyPreset('net_worth')}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        selectedSeries.length === 1 && selectedSeries[0] === 'net_worth'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      Net Worth
                    </button>
                    <button
                      onClick={() => applyPreset('balance_sheet')}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        selectedSeries.includes('net_worth') && selectedSeries.includes('total_assets') && selectedSeries.includes('total_liabilities') && selectedSeries.length === 3
                          ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                          : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      Balance Sheet
                    </button>
                    <button
                      onClick={() => applyPreset('all_assets')}
                      className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                    >
                      All Assets
                    </button>
                  </div>
                </div>

                {/* Grouped Metric Checkboxes */}
                {TREND_METRIC_GROUPS.map(group => (
                  <div key={group.id} className="space-y-1.5">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500 px-1">
                      {group.label}
                    </p>
                    <div className="space-y-1">
                      {group.items.map(item => {
                        const isSelected = selectedSeries.includes(item.id);
                        const latestVal = getLatestValue(item);

                        return (
                          <div
                            key={item.id}
                            onClick={() => toggleSeries(item.id)}
                            className={`flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer transition-all duration-150 select-none ${
                              isSelected 
                                ? 'bg-slate-800/80 border border-slate-700/80 text-white' 
                                : 'hover:bg-slate-800/40 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {/* Custom Checkbox */}
                              <div 
                                className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${
                                  isSelected 
                                    ? 'border-transparent shadow-sm' 
                                    : 'border-slate-700 bg-slate-800/50'
                                }`}
                                style={{ backgroundColor: isSelected ? item.color : undefined }}
                              >
                                {isSelected && <Check className="w-2.5 h-2.5 text-slate-950 stroke-[3]" />}
                              </div>

                              {/* Metric Name */}
                              <div className="flex items-center gap-2 truncate">
                                <span 
                                  className="w-1.5 h-1.5 rounded-full shrink-0" 
                                  style={{ backgroundColor: item.color }} 
                                />
                                <span className={`text-[11px] truncate ${isSelected ? 'font-medium text-white' : 'text-slate-300'}`}>
                                  {item.label}
                                </span>
                              </div>
                            </div>

                            {/* Latest Current Value */}
                            <span className="text-[10px] font-mono font-medium text-slate-300 ml-2 shrink-0">
                              {formatMetricValue(latestVal)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Footer reset button */}
                <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-[10px]">
                  <span className="text-slate-500 font-mono">
                    {selectedSeries.length} of {ALL_TREND_METRICS.length} selected
                  </span>
                  <button
                    onClick={() => applyPreset('net_worth')}
                    className="text-emerald-400 hover:text-emerald-300 font-medium transition-colors"
                  >
                    Reset to Net Worth
                  </button>
                </div>

              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>

      {/* Main Interactive Chart */}
      <div className="h-[280px] w-full">
        {loading ? (
          <div className="h-full w-full flex items-center justify-center flex-col gap-2 text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
            <span className="text-xs font-mono">Loading trend data...</span>
          </div>
        ) : chartData.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center text-slate-500 text-xs">
            No historical data available for selected range.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              
              {/* Dynamic SVG Gradients */}
              <defs>
                {ALL_TREND_METRICS.map(metric => {
                  const isPrimary = metric.id === 'net_worth';
                  const topOpacity = singleSeriesSelected 
                    ? (isPrimary ? 0.35 : 0.28) 
                    : 0.08;

                  return (
                    <linearGradient 
                      key={`grad-${metric.id}`} 
                      id={`grad-${metric.id}`} 
                      x1="0" 
                      y1="0" 
                      x2="0" 
                      y2="1"
                    >
                      <stop offset="5%" stopColor={metric.color} stopOpacity={topOpacity} />
                      <stop offset="95%" stopColor={metric.color} stopOpacity={0.0} />
                    </linearGradient>
                  );
                })}
              </defs>

              <XAxis 
                dataKey="date" 
                stroke="#334155" 
                tick={{ fontSize: 9, fill: '#64748B' }} 
                tickLine={false}
              />
              
              <YAxis 
                stroke="#334155" 
                tick={{ fontSize: 9, fill: '#64748B' }} 
                domain={yAxisMinMax}
                tickLine={false}
                ticks={(() => {
                  const [min, max] = yAxisMinMax;
                  if (min <= 0 && max >= 0) {
                    return [min, 0, max];
                  }
                  return undefined;
                })()}
                tickFormatter={(v) => {
                  if (v === 0) return '0';
                  const absV = Math.abs(v);
                  const sign = v < 0 ? '-' : '';

                  if (isUSD) {
                    if (absV >= 1000000) return `${sign}$${(absV / 1000000).toFixed(2)}M`;
                    if (absV >= 1000) return `${sign}$${(absV / 1000).toFixed(1)}k`;
                    return `${sign}$${absV.toFixed(0)}`;
                  }

                  if (absV >= 10000000) return `${sign}₹${(absV / 10000000).toFixed(2)}Cr`;
                  if (absV >= 100000) return `${sign}₹${(absV / 100000).toFixed(2)}L`;
                  if (absV >= 1000) return `${sign}₹${(absV / 1000).toFixed(1)}k`;
                  return `${sign}₹${absV.toFixed(0)}`;
                }} 
              />

              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />

              {/* 0-value reference line if span covers negative and positive values */}
              {yAxisMinMax[0] <= 0 && yAxisMinMax[1] >= 0 && (
                <ReferenceLine 
                  y={0} 
                  stroke="#F43F5E" 
                  strokeDasharray="4 4" 
                  strokeWidth={1.5} 
                  strokeOpacity={0.6} 
                />
              )}

              {/* Institutional Custom Multi-Series Tooltip */}
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const firstItem = payload[0];
                    const rawDate = firstItem.payload?.rawDate;
                    let fullDate = rawDate;
                    if (rawDate) {
                      const parts = String(rawDate).split('-');
                      if (parts.length === 3) {
                        fullDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                      }
                    }

                    // Sort payload rows by value descending
                    const sortedPayload = [...payload].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));

                    return (
                      <div className="bg-slate-900/95 border border-slate-700/80 p-2.5 rounded-xl shadow-2xl backdrop-blur-xl text-xs space-y-1.5 z-50 min-w-[190px]">
                        <p className="text-[9px] font-semibold text-slate-400 font-mono tracking-wider pb-1 border-b border-slate-800">
                          {fullDate || firstItem.payload?.date}
                        </p>
                        
                        <div className="space-y-1">
                          {sortedPayload.map((entry) => {
                            const metric = ALL_TREND_METRICS.find(m => m.dataKey === entry.dataKey);
                            const val = Number(entry.value) || 0;
                            const isNeg = val < 0;

                            return (
                              <div key={entry.dataKey} className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-1.5 truncate">
                                  <span 
                                    className="w-1.5 h-1.5 rounded-full shrink-0" 
                                    style={{ backgroundColor: metric?.color || entry.color }} 
                                  />
                                  <span className="text-[10px] font-medium text-slate-300 truncate">
                                    {metric?.label || entry.name}
                                  </span>
                                </div>
                                <span 
                                  className="text-[10px] font-mono font-semibold shrink-0"
                                  style={{ color: metric?.color || '#FFFFFF' }}
                                >
                                  {isUSD 
                                    ? (isNeg ? '-$' : '$') + Math.abs(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                    : (isNeg ? '-₹' : '₹') + Math.abs(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }
                  return null;
                }} 
              />

              {/* Render an Area for each active metric */}
              {activeMetrics.map(metric => {
                const isHovered = hoveredSeriesId === metric.id;
                const isDimmed = hoveredSeriesId !== null && !isHovered;
                const strokeW = isHovered ? 3.5 : (metric.id === 'net_worth' ? 2.5 : 2);
                const opacity = isDimmed ? 0.2 : 1.0;

                return (
                  <Area 
                    key={metric.id}
                    type="monotone" 
                    dataKey={metric.dataKey} 
                    name={metric.label}
                    stroke={metric.color} 
                    strokeWidth={strokeW} 
                    strokeOpacity={opacity}
                    fillOpacity={opacity} 
                    fill={`url(#grad-${metric.id})`}
                    isAnimationActive={true}
                    animationDuration={800}
                    animationEasing="ease-out"
                    activeDot={{ 
                      r: 5, 
                      strokeWidth: 2, 
                      stroke: '#FFFFFF', 
                      fill: metric.color 
                    }}
                  />
                );
              })}

            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

    </div>
  );
}
