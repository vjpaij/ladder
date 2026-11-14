import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { 
  CalendarDays, 
  Search, 
  TrendingUp, 
  TrendingDown, 
  Coins, 
  ReceiptText, 
  ArrowUpRight, 
  ArrowDownRight, 
  Layers, 
  Filter,
  BarChart3,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  PieChart as PieIcon,
  Check
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  Legend, 
  Cell 
} from 'recharts';
import HoldingLogo from '../HoldingLogo';
import ChartRangeSelector from '../ChartRangeSelector';
import { formatDateDDMMYYYY } from '../../utils/dateFormatter';

export default function TaxPnlReportSection({ formatMoney, isUSD, theme }) {
  const isLight = theme === 'light' || theme === 'warm_light' || theme === 'nordic_light';

  // Period Selection State
  const [activeFy, setActiveFy] = useState('2026-27');
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customRange, setCustomRange] = useState({ startDate: null, endDate: null });

  // Data & API state
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  // Active View: 'SUMMARY' | 'CHARTS' | 'CONSOLIDATED' | 'LEDGER'
  const [activeView, setActiveView] = useState('SUMMARY');

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState('');
  const [assetFilter, setAssetFilter] = useState('ALL'); // 'ALL' | 'in_stocks' | 'us_stocks' | 'mutual_funds'
  const [taxFilter, setTaxFilter] = useState('ALL'); // 'ALL' | 'STCG' | 'LTCG'

  // Expanded Stock in Consolidated View
  const [expandedStockKey, setExpandedStockKey] = useState(null);
  const [expandedTaxFilter, setExpandedTaxFilter] = useState('ALL'); // 'ALL' | 'STCG' | 'LTCG'

  // Table Sorting for Consolidated Stock View
  const [stockSort, setStockSort] = useState({ field: 'netRealizedPnl', direction: 'desc' });

  // Fetch Tax P&L Data from Backend Engine
  useEffect(() => {
    let isMounted = true;
    const fetchTaxData = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = {};
        if (isCustomMode && customRange.startDate && customRange.endDate) {
          params.startDate = customRange.startDate;
          params.endDate = customRange.endDate;
        } else {
          params.fy = activeFy;
        }

        const res = await axios.get('/api/reports/tax-pnl', { params });
        if (isMounted) {
          setData(res.data);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          console.error('[Tax PnL Report Error]:', err);
          setError(err.response?.data?.error || err.message);
          setLoading(false);
        }
      }
    };

    fetchTaxData();
    return () => { isMounted = false; };
  }, [activeFy, isCustomMode, customRange.startDate, customRange.endDate]);

  const summary = data?.summary;
  const presets = data?.presets || [];
  const trends = data?.trends || [];
  const stockSummaries = data?.stockSummaries || [];
  const trades = data?.trades || [];

  // Handle FY Dropdown Change
  const handleFyChange = (newFy) => {
    setIsCustomMode(false);
    setActiveFy(newFy);
  };

  // Handle Standard ChartRangeSelector Change
  const handleRangeSelectorChange = (range) => {
    if (range.type === 'ALL') {
      setIsCustomMode(false);
      setActiveFy('ALL');
    } else if (range.startDate && range.endDate) {
      setIsCustomMode(true);
      setCustomRange({
        startDate: range.startDate,
        endDate: range.endDate
      });
    }
  };

  // Chart 1 Data: Breakdown by Asset Class
  const assetClassChartData = useMemo(() => {
    if (!summary) return [];
    return [
      {
        name: 'Indian Stocks',
        key: 'in_stocks',
        invested: summary.in_stocks?.invested || 0,
        stcg: summary.in_stocks?.stcgPnl || 0,
        ltcg: summary.in_stocks?.ltcgPnl || 0,
        realized: summary.in_stocks?.realizedPnl || 0
      },
      {
        name: 'Mutual Funds',
        key: 'mutual_funds',
        invested: summary.mutual_funds?.invested || 0,
        stcg: summary.mutual_funds?.stcgPnl || 0,
        ltcg: summary.mutual_funds?.ltcgPnl || 0,
        realized: summary.mutual_funds?.realizedPnl || 0
      },
      {
        name: 'US Stocks',
        key: 'us_stocks',
        invested: summary.us_stocks?.invested || 0,
        stcg: summary.us_stocks?.stcgPnl || 0,
        ltcg: summary.us_stocks?.ltcgPnl || 0,
        realized: summary.us_stocks?.realizedPnl || 0
      }
    ];
  }, [summary]);

  // Chart 2 Data: Multi-Year Trends
  const fyTrendChartData = useMemo(() => {
    return (trends || []).map(t => ({
      name: t.fyId,
      label: t.fyLabel,
      invested: t.invested,
      realizedPnl: t.realizedPnl,
      stcgPnl: t.stcgPnl,
      ltcgPnl: t.ltcgPnl
    }));
  }, [trends]);

  // Filtered & Sorted Consolidated Stocks
  const filteredStockSummaries = useMemo(() => {
    let list = [...stockSummaries];

    if (assetFilter !== 'ALL') {
      list = list.filter(s => s.assetClass === assetFilter);
    }

    if (taxFilter === 'STCG') {
      list = list.filter(s => s.stcgTradeCount > 0);
    } else if (taxFilter === 'LTCG') {
      list = list.filter(s => s.ltcgTradeCount > 0);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(s => 
        (s.symbol || '').toLowerCase().includes(q) ||
        (s.name || '').toLowerCase().includes(q)
      );
    }

    // Sort
    const { field, direction } = stockSort;
    list.sort((a, b) => {
      let aVal = a[field] ?? 0;
      let bVal = b[field] ?? 0;
      if (typeof aVal === 'string') {
        return direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    return list;
  }, [stockSummaries, assetFilter, taxFilter, searchQuery, stockSort]);

  // Filtered Closed Individual Trades
  const filteredTrades = useMemo(() => {
    return trades.filter(t => {
      if (assetFilter !== 'ALL' && t.assetClass !== assetFilter) return false;
      if (taxFilter !== 'ALL' && t.taxTerm !== taxFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const sym = (t.symbol || '').toLowerCase();
        const nm = (t.name || '').toLowerCase();
        return sym.includes(q) || nm.includes(q);
      }
      return true;
    });
  }, [trades, assetFilter, taxFilter, searchQuery]);

  // Handle Chart Drilldown: Switch directly to Consolidated View
  const handleChartDrilldown = (targetAssetClass = 'ALL') => {
    setAssetFilter(targetAssetClass);
    setActiveView('CONSOLIDATED');
  };

  const handleStockSortClick = (field) => {
    setStockSort(prev => ({
      field,
      direction: prev.field === field && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const renderSortIndicator = (field) => {
    if (stockSort.field !== field) return <ArrowUpDown className="w-3 h-3 opacity-30 inline ml-1" />;
    return stockSort.direction === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-emerald-500 inline ml-1" />
      : <ArrowDown className="w-3 h-3 text-emerald-500 inline ml-1" />;
  };

  const customTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="reports-card p-3 rounded-xl shadow-xl border border-inherit text-xs space-y-1.5 font-mono">
        <p className="font-sans font-bold opacity-80">{label}</p>
        {payload.map((entry, idx) => (
          <div key={`tooltip-${idx}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 font-sans" style={{ color: entry.color }}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}:
            </span>
            <span className="font-bold">{formatMoney(entry.value)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* ── Top Period Selection Header ─────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-2 border-b border-inherit">
        
        {/* Left: Financial Year Dropdown & Standard Calendar Selector */}
        <div className="flex flex-wrap items-center gap-3">
          
          {/* Financial Year Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-black uppercase tracking-wider opacity-60">Financial Year:</span>
            <div className="relative">
              <select
                value={isCustomMode ? 'CUSTOM' : activeFy}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'CUSTOM') {
                    setIsCustomMode(true);
                  } else {
                    handleFyChange(val);
                  }
                }}
                className="reports-subcard border border-inherit px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer pr-8 outline-none appearance-none font-mono"
              >
                {presets.map(p => (
                  <option key={p.id} value={p.id} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                    {p.label}
                  </option>
                ))}
                {isCustomMode && (
                  <option value="CUSTOM" className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                    Custom Range
                  </option>
                )}
              </select>
              <ChevronDown className="w-3.5 h-3.5 pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 opacity-60" />
            </div>
          </div>

          {/* Standard ChartRangeSelector */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-black uppercase tracking-wider opacity-60">Calendar:</span>
            <ChartRangeSelector
              initialRange="ALL"
              onChange={handleRangeSelectorChange}
            />
          </div>

          {/* Active Period Label Badge */}
          {data?.selectedRange?.label && (
            <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-bold">
              {data.selectedRange.label}
            </span>
          )}
        </div>

        {/* Right: View Mode Switcher */}
        <div className="flex items-center gap-1 reports-pill p-1 rounded-xl shrink-0 self-start lg:self-auto overflow-x-auto max-w-full">
          {[
            { key: 'SUMMARY', label: 'Summary & Matrix' },
            { key: 'CHARTS', label: 'Visual Analytics' },
            { key: 'CONSOLIDATED', label: `Consolidated by Stock (${stockSummaries.length})` },
            { key: 'LEDGER', label: `Trade Lots (${trades.length})` }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveView(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeView === tab.key
                  ? 'bg-emerald-500 text-slate-950 shadow-sm font-black'
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center opacity-60 text-xs font-mono">
          Loading tax capital gains & investment analytics...
        </div>
      ) : error ? (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-mono">
          Failed to load tax analytics: {error}
        </div>
      ) : !data ? null : (
        <div className="space-y-6">

          {/* ── Top Metric Hero Cards ─────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Total Realized Capital Gain/Loss */}
            <div className="reports-subcard p-4 rounded-2xl border border-inherit space-y-2">
              <span className="text-[10px] font-black uppercase tracking-wider opacity-60 block">
                Net Realized Capital Gain / Loss
              </span>
              <div className={`text-xl sm:text-2xl font-black font-mono truncate ${
                (summary.total?.realizedPnl || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}>
                {(summary.total?.realizedPnl || 0) >= 0 ? '+' : ''}{formatMoney(summary.total?.realizedPnl || 0)}
              </div>
              <div className="pt-2 border-t border-inherit opacity-90 text-[11px] font-mono flex items-center justify-between">
                <span className="opacity-60">Realized ROI</span>
                <span className={`font-bold ${(summary.total?.roiPct || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {(summary.total?.roiPct || 0) >= 0 ? '+' : ''}{summary.total?.roiPct || 0}%
                </span>
              </div>
            </div>

            {/* Card 2: Short-Term Capital Gains (STCG) */}
            <div className="reports-subcard p-4 rounded-2xl border border-inherit space-y-2">
              <span className="text-[10px] font-black uppercase tracking-wider opacity-60 block">
                Short-Term Capital Gains (STCG)
              </span>
              <div className={`text-xl sm:text-2xl font-black font-mono truncate ${
                (summary.total?.stcgPnl || 0) >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
              }`}>
                {(summary.total?.stcgPnl || 0) >= 0 ? '+' : ''}{formatMoney(summary.total?.stcgPnl || 0)}
              </div>
              <div className="pt-2 border-t border-inherit opacity-90 text-[11px] font-mono flex items-center justify-between">
                <span className="opacity-60">Holding &le; 365 Days</span>
                <span className="font-bold opacity-80">{data.selectedRange?.label}</span>
              </div>
            </div>

            {/* Card 3: Long-Term Capital Gains (LTCG) */}
            <div className="reports-subcard p-4 rounded-2xl border border-inherit space-y-2">
              <span className="text-[10px] font-black uppercase tracking-wider opacity-60 block">
                Long-Term Capital Gains (LTCG)
              </span>
              <div className={`text-xl sm:text-2xl font-black font-mono truncate ${
                (summary.total?.ltcgPnl || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}>
                {(summary.total?.ltcgPnl || 0) >= 0 ? '+' : ''}{formatMoney(summary.total?.ltcgPnl || 0)}
              </div>
              <div className="pt-2 border-t border-inherit opacity-90 text-[11px] font-mono flex items-center justify-between">
                <span className="opacity-60">Holding &gt; 365 Days</span>
                <span className="font-bold opacity-80">{data.selectedRange?.label}</span>
              </div>
            </div>

            {/* Card 4: Total Period Capital Invested */}
            <div className="reports-subcard p-4 rounded-2xl border border-inherit space-y-2">
              <span className="text-[10px] font-black uppercase tracking-wider opacity-60 block">
                Total Capital Invested (Purchases)
              </span>
              <div className="text-xl sm:text-2xl font-black font-mono text-blue-600 dark:text-blue-400 truncate">
                {formatMoney(summary.total?.invested || 0)}
              </div>
              <div className="pt-2 border-t border-inherit opacity-90 text-[11px] font-mono flex items-center justify-between">
                <span className="opacity-60">Period Proceeds</span>
                <span className="font-bold opacity-80">{formatMoney(summary.total?.proceeds || 0)}</span>
              </div>
            </div>
          </div>

          {/* ── VIEW 1: SUMMARY & MATRIX ─────────────────────────── */}
          {activeView === 'SUMMARY' && (
            <div className="reports-subcard p-5 rounded-3xl border border-inherit space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-black uppercase tracking-wider opacity-80 block">
                    Capital Gains & Investment Summary Matrix
                  </span>
                  <span className="text-[11px] font-mono opacity-60">
                    Click any row to view consolidated stock performance for that category
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-inherit opacity-75 font-sans font-bold text-[11px]">
                      <th className="py-2.5 pl-4 pr-3 text-left">Asset Category</th>
                      <th className="py-2.5 px-3 text-right">Invested (Purchases)</th>
                      <th className="py-2.5 px-3 text-right">Cost Sold</th>
                      <th className="py-2.5 px-3 text-right">Gross Proceeds</th>
                      <th className="py-2.5 px-3 text-right">Net Realized P&L</th>
                      <th className="py-2.5 px-3 text-right">STCG P&L</th>
                      <th className="py-2.5 px-3 text-right">LTCG P&L</th>
                      <th className="py-2.5 px-3 text-right">Closed Trades (Win %)</th>
                      <th className="py-2.5 pr-4 text-right">ROI %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-inherit">
                    {/* Indian Stocks */}
                    <tr 
                      onClick={() => handleChartDrilldown('in_stocks')}
                      className="reports-table-row transition-colors cursor-pointer hover:bg-slate-500/10"
                      title="Click to view consolidated Indian Stocks"
                    >
                      <td className="py-3 pl-4 pr-3 font-sans font-bold border-r border-inherit flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                        <span className="hover:underline">Indian Stocks</span>
                      </td>
                      <td className="py-3 px-3 text-right font-bold opacity-90">{formatMoney(summary.in_stocks?.invested || 0)}</td>
                      <td className="py-3 px-3 text-right opacity-80">{formatMoney(summary.in_stocks?.costSold || 0)}</td>
                      <td className="py-3 px-3 text-right opacity-80">{formatMoney(summary.in_stocks?.proceeds || 0)}</td>
                      <td className={`py-3 px-3 text-right font-bold ${
                        (summary.in_stocks?.realizedPnl || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {(summary.in_stocks?.realizedPnl || 0) >= 0 ? '+' : ''}{formatMoney(summary.in_stocks?.realizedPnl || 0)}
                      </td>
                      <td className={`py-3 px-3 text-right font-bold ${
                        (summary.in_stocks?.stcgPnl || 0) >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {formatMoney(summary.in_stocks?.stcgPnl || 0)}
                      </td>
                      <td className={`py-3 px-3 text-right font-bold ${
                        (summary.in_stocks?.ltcgPnl || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {formatMoney(summary.in_stocks?.ltcgPnl || 0)}
                      </td>
                      <td className="py-3 px-3 text-right opacity-80">
                        {summary.in_stocks?.tradeCount || 0} ({summary.in_stocks?.winRate || 0}%)
                      </td>
                      <td className={`py-3 pr-4 text-right font-bold ${
                        (summary.in_stocks?.roiPct || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {summary.in_stocks?.roiPct || 0}%
                      </td>
                    </tr>

                    {/* Mutual Funds */}
                    <tr 
                      onClick={() => handleChartDrilldown('mutual_funds')}
                      className="reports-table-row transition-colors cursor-pointer hover:bg-slate-500/10"
                      title="Click to view consolidated Mutual Funds"
                    >
                      <td className="py-3 pl-4 pr-3 font-sans font-bold border-r border-inherit flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                        <span className="hover:underline">Mutual Funds</span>
                      </td>
                      <td className="py-3 px-3 text-right font-bold opacity-90">{formatMoney(summary.mutual_funds?.invested || 0)}</td>
                      <td className="py-3 px-3 text-right opacity-80">{formatMoney(summary.mutual_funds?.costSold || 0)}</td>
                      <td className="py-3 px-3 text-right opacity-80">{formatMoney(summary.mutual_funds?.proceeds || 0)}</td>
                      <td className={`py-3 px-3 text-right font-bold ${
                        (summary.mutual_funds?.realizedPnl || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {(summary.mutual_funds?.realizedPnl || 0) >= 0 ? '+' : ''}{formatMoney(summary.mutual_funds?.realizedPnl || 0)}
                      </td>
                      <td className={`py-3 px-3 text-right font-bold ${
                        (summary.mutual_funds?.stcgPnl || 0) >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {formatMoney(summary.mutual_funds?.stcgPnl || 0)}
                      </td>
                      <td className={`py-3 px-3 text-right font-bold ${
                        (summary.mutual_funds?.ltcgPnl || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {formatMoney(summary.mutual_funds?.ltcgPnl || 0)}
                      </td>
                      <td className="py-3 px-3 text-right opacity-80">
                        {summary.mutual_funds?.tradeCount || 0} ({summary.mutual_funds?.winRate || 0}%)
                      </td>
                      <td className={`py-3 pr-4 text-right font-bold ${
                        (summary.mutual_funds?.roiPct || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {summary.mutual_funds?.roiPct || 0}%
                      </td>
                    </tr>

                    {/* US Stocks */}
                    <tr 
                      onClick={() => handleChartDrilldown('us_stocks')}
                      className="reports-table-row transition-colors cursor-pointer hover:bg-slate-500/10"
                      title="Click to view consolidated US Stocks"
                    >
                      <td className="py-3 pl-4 pr-3 font-sans font-bold border-r border-inherit flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                        <span className="hover:underline">US Stocks</span>
                      </td>
                      <td className="py-3 px-3 text-right font-bold opacity-90">{formatMoney(summary.us_stocks?.invested || 0)}</td>
                      <td className="py-3 px-3 text-right opacity-80">{formatMoney(summary.us_stocks?.costSold || 0)}</td>
                      <td className="py-3 px-3 text-right opacity-80">{formatMoney(summary.us_stocks?.proceeds || 0)}</td>
                      <td className={`py-3 px-3 text-right font-bold ${
                        (summary.us_stocks?.realizedPnl || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {(summary.us_stocks?.realizedPnl || 0) >= 0 ? '+' : ''}{formatMoney(summary.us_stocks?.realizedPnl || 0)}
                      </td>
                      <td className={`py-3 px-3 text-right font-bold ${
                        (summary.us_stocks?.stcgPnl || 0) >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {formatMoney(summary.us_stocks?.stcgPnl || 0)}
                      </td>
                      <td className={`py-3 px-3 text-right font-bold ${
                        (summary.us_stocks?.ltcgPnl || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {formatMoney(summary.us_stocks?.ltcgPnl || 0)}
                      </td>
                      <td className="py-3 px-3 text-right opacity-80">
                        {summary.us_stocks?.tradeCount || 0} ({summary.us_stocks?.winRate || 0}%)
                      </td>
                      <td className={`py-3 pr-4 text-right font-bold ${
                        (summary.us_stocks?.roiPct || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {summary.us_stocks?.roiPct || 0}%
                      </td>
                    </tr>

                    {/* Consolidated Total Row */}
                    <tr 
                      onClick={() => handleChartDrilldown('ALL')}
                      className="bg-slate-500/10 font-bold border-t-2 border-inherit cursor-pointer hover:bg-slate-500/20 transition-colors"
                      title="Click to view all consolidated stocks"
                    >
                      <td className="py-3 pl-4 pr-3 font-sans font-black border-r border-inherit">
                        <span className="hover:underline">Consolidated Total</span>
                      </td>
                      <td className="py-3 px-3 text-right font-black text-blue-600 dark:text-blue-400">{formatMoney(summary.total?.invested || 0)}</td>
                      <td className="py-3 px-3 text-right opacity-90">{formatMoney(summary.total?.costSold || 0)}</td>
                      <td className="py-3 px-3 text-right opacity-90">{formatMoney(summary.total?.proceeds || 0)}</td>
                      <td className={`py-3 px-3 text-right font-black ${
                        (summary.total?.realizedPnl || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {(summary.total?.realizedPnl || 0) >= 0 ? '+' : ''}{formatMoney(summary.total?.realizedPnl || 0)}
                      </td>
                      <td className="py-3 px-3 text-right font-black text-amber-600 dark:text-amber-400">
                        {formatMoney(summary.total?.stcgPnl || 0)}
                      </td>
                      <td className="py-3 px-3 text-right font-black text-emerald-600 dark:text-emerald-400">
                        {formatMoney(summary.total?.ltcgPnl || 0)}
                      </td>
                      <td className="py-3 px-3 text-right opacity-90">
                        {summary.total?.tradeCount || 0} ({summary.total?.winRate || 0}%)
                      </td>
                      <td className={`py-3 pr-4 text-right font-black ${
                        (summary.total?.roiPct || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {summary.total?.roiPct || 0}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── VIEW 2: VISUAL CHARTS ────────────────────────────── */}
          {activeView === 'CHARTS' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
              {/* Chart 1: STCG vs LTCG vs Invested across Asset Classes */}
              <div className="reports-subcard p-5 rounded-3xl border border-inherit space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-black uppercase tracking-wider opacity-80 block">
                      Asset Class Performance ({data.selectedRange?.label})
                    </span>
                    <span className="text-[11px] font-mono opacity-60">
                      Click any bar to drill down into consolidated stocks
                    </span>
                  </div>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart 
                      data={assetClassChartData} 
                      margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
                      className="cursor-pointer"
                      onClick={(state) => {
                        if (state && state.activePayload && state.activePayload[0]) {
                          const assetKey = state.activePayload[0].payload.key;
                          if (assetKey) handleChartDrilldown(assetKey);
                        }
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                      <XAxis dataKey="name" stroke="currentColor" opacity={0.6} tick={{ fontSize: 11 }} />
                      <YAxis stroke="currentColor" opacity={0.6} tick={{ fontSize: 10 }} tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`} />
                      <RechartsTooltip content={customTooltip} />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      <Bar dataKey="invested" name="Invested" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="stcg" name="STCG P&L" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="ltcg" name="LTCG P&L" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Chart 2: Multi-Year Capital Gains Trend */}
              <div className="reports-subcard p-5 rounded-3xl border border-inherit space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-black uppercase tracking-wider opacity-80 block">
                      Multi-Year Realized P&L & Investment Trajectory
                    </span>
                    <span className="text-[11px] font-mono opacity-60">
                      Click any year to inspect that Financial Year
                    </span>
                  </div>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart 
                      data={fyTrendChartData} 
                      margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
                      className="cursor-pointer"
                      onClick={(state) => {
                        if (state && state.activePayload && state.activePayload[0]) {
                          const fyId = state.activePayload[0].payload.name;
                          if (fyId) {
                            handleFyChange(fyId);
                            setActiveView('CONSOLIDATED');
                          }
                        }
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" opacity={0.15} vertical={false} />
                      <XAxis dataKey="name" stroke="currentColor" opacity={0.6} tick={{ fontSize: 11 }} />
                      <YAxis stroke="currentColor" opacity={0.6} tick={{ fontSize: 10 }} tickFormatter={(val) => `₹${(val / 1000).toFixed(0)}k`} />
                      <RechartsTooltip content={customTooltip} />
                      <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                      <Bar dataKey="invested" name="Invested" fill="#3b82f6" radius={[4, 4, 0, 0]} opacity={0.8} />
                      <Bar dataKey="realizedPnl" name="Net Realized P&L" fill="#10b981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}

          {/* ── VIEW 3: CONSOLIDATED BY STOCK (NEW & CORE) ───────── */}
          {activeView === 'CONSOLIDATED' && (
            <div className="reports-subcard p-5 rounded-3xl border border-inherit space-y-4">
              
              {/* Controls & Filter Bar */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-inherit">
                <div>
                  <span className="text-xs font-black uppercase tracking-wider opacity-80 block">
                    Consolidated Stock-Level Capital Gains ({filteredStockSummaries.length} Assets)
                  </span>
                  <span className="text-[11px] font-mono opacity-60">
                    Click any stock row or STCG / LTCG badge to view its itemized trade lots
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Search */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
                    <input
                      type="text"
                      placeholder="Search stock or scheme..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 text-xs rounded-xl reports-pill border border-inherit focus:outline-none w-44 font-mono"
                    />
                  </div>

                  {/* Asset Class Filter */}
                  <div className="flex items-center gap-1 reports-pill p-0.5 rounded-xl text-xs font-bold">
                    {[
                      { key: 'ALL', label: 'All' },
                      { key: 'in_stocks', label: 'Indian Equity' },
                      { key: 'mutual_funds', label: 'Mutual Funds' },
                      { key: 'us_stocks', label: 'US Equity' }
                    ].map(f => (
                      <button
                        key={f.key}
                        onClick={() => setAssetFilter(f.key)}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                          assetFilter === f.key 
                            ? 'bg-emerald-500 text-slate-950 shadow-sm font-black' 
                            : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Tax Term Filter */}
                  <div className="flex items-center gap-1 reports-pill p-0.5 rounded-xl text-xs font-bold">
                    {[
                      { key: 'ALL', label: 'All' },
                      { key: 'STCG', label: 'Has STCG' },
                      { key: 'LTCG', label: 'Has LTCG' }
                    ].map(f => (
                      <button
                        key={f.key}
                        onClick={() => setTaxFilter(f.key)}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                          taxFilter === f.key 
                            ? 'bg-amber-500 text-slate-950 shadow-sm font-black' 
                            : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Consolidated Stock Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-inherit opacity-75 font-sans font-bold text-[11px]">
                      <th className="py-2.5 pl-4 pr-3 text-left cursor-pointer select-none" onClick={() => handleStockSortClick('symbol')}>
                        Stock / Scheme {renderSortIndicator('symbol')}
                      </th>
                      <th className="py-2.5 px-3 text-left">Category</th>
                      <th className="py-2.5 px-3 text-right cursor-pointer select-none" onClick={() => handleStockSortClick('totalInvested')}>
                        Capital Invested {renderSortIndicator('totalInvested')}
                      </th>
                      <th className="py-2.5 px-3 text-right cursor-pointer select-none" onClick={() => handleStockSortClick('totalProceeds')}>
                        Gross Proceeds {renderSortIndicator('totalProceeds')}
                      </th>
                      <th className="py-2.5 px-3 text-right cursor-pointer select-none" onClick={() => handleStockSortClick('netRealizedPnl')}>
                        Net Realized P&L {renderSortIndicator('netRealizedPnl')}
                      </th>
                      <th className="py-2.5 px-3 text-right cursor-pointer select-none" onClick={() => handleStockSortClick('stcgPnl')}>
                        STCG P&L {renderSortIndicator('stcgPnl')}
                      </th>
                      <th className="py-2.5 px-3 text-right cursor-pointer select-none" onClick={() => handleStockSortClick('ltcgPnl')}>
                        LTCG P&L {renderSortIndicator('ltcgPnl')}
                      </th>
                      <th className="py-2.5 px-3 text-right cursor-pointer select-none" onClick={() => handleStockSortClick('tradeCount')}>
                        Trades (Win %) {renderSortIndicator('tradeCount')}
                      </th>
                      <th className="py-2.5 pr-4 text-right cursor-pointer select-none" onClick={() => handleStockSortClick('roiPct')}>
                        ROI % {renderSortIndicator('roiPct')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-inherit">
                    {filteredStockSummaries.length === 0 ? (
                      <tr>
                        <td colSpan="9" className="py-12 text-center opacity-50 font-mono">
                          No closed trades recorded for the selected period and filters.
                        </td>
                      </tr>
                    ) : (
                      filteredStockSummaries.map(s => {
                        const isExpanded = expandedStockKey === s.key;
                        const visibleTrades = (s.trades || []).filter(t => {
                          if (expandedTaxFilter === 'ALL') return true;
                          return t.taxTerm === expandedTaxFilter;
                        });

                        return (
                          <React.Fragment key={s.key}>
                            {/* Stock Consolidated Master Row */}
                            <tr 
                              onClick={() => {
                                setExpandedStockKey(isExpanded ? null : s.key);
                                setExpandedTaxFilter('ALL');
                              }}
                              className={`reports-table-row transition-colors cursor-pointer select-none ${
                                isExpanded ? 'bg-slate-500/15' : 'hover:bg-slate-500/10'
                              }`}
                            >
                              <td className="py-3 pl-4 pr-3 font-sans font-bold flex items-center gap-2.5">
                                <HoldingLogo 
                                  symbol={s.symbol} 
                                  name={s.name} 
                                  categoryId={s.assetClass} 
                                  className="w-6 h-6 rounded-lg text-[9px] shrink-0" 
                                />
                                <div className="truncate min-w-0">
                                  <div className="font-bold flex items-center gap-1.5">
                                    <span className="truncate">{s.name || s.symbol}</span>
                                    <span className="text-[10px] font-mono opacity-50 shrink-0">({s.symbol})</span>
                                  </div>
                                </div>
                                <div className="ml-auto text-emerald-500 shrink-0">
                                  {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4 opacity-50" />}
                                </div>
                              </td>

                              <td className="py-3 px-3">
                                <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider ${
                                  s.assetClass === 'in_stocks' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                                  s.assetClass === 'mutual_funds' ? 'bg-purple-500/10 text-purple-500 border border-purple-500/20' :
                                  'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                }`}>
                                  {s.assetClass === 'in_stocks' ? 'Indian Equity' : s.assetClass === 'mutual_funds' ? 'Mutual Fund' : 'US Equity'}
                                </span>
                              </td>

                              <td className="py-3 px-3 text-right opacity-90">{formatMoney(s.totalInvested)}</td>
                              <td className="py-3 px-3 text-right opacity-90">{formatMoney(s.totalProceeds)}</td>

                              <td className={`py-3 px-3 text-right font-black ${
                                s.netRealizedPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                              }`}>
                                {s.netRealizedPnl >= 0 ? '+' : ''}{formatMoney(s.netRealizedPnl)}
                              </td>

                              {/* STCG Clickable Badge */}
                              <td 
                                className="py-3 px-3 text-right"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedStockKey(s.key);
                                  setExpandedTaxFilter('STCG');
                                }}
                              >
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-bold cursor-pointer transition-all ${
                                  s.stcgTradeCount > 0 
                                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:scale-105' 
                                    : 'opacity-40'
                                }`}>
                                  {formatMoney(s.stcgPnl)}
                                  {s.stcgTradeCount > 0 && (
                                    <span className="text-[9px] opacity-75">({s.stcgTradeCount})</span>
                                  )}
                                </span>
                              </td>

                              {/* LTCG Clickable Badge */}
                              <td 
                                className="py-3 px-3 text-right"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedStockKey(s.key);
                                  setExpandedTaxFilter('LTCG');
                                }}
                              >
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg font-bold cursor-pointer transition-all ${
                                  s.ltcgTradeCount > 0 
                                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:scale-105' 
                                    : 'opacity-40'
                                }`}>
                                  {formatMoney(s.ltcgPnl)}
                                  {s.ltcgTradeCount > 0 && (
                                    <span className="text-[9px] opacity-75">({s.ltcgTradeCount})</span>
                                  )}
                                </span>
                              </td>

                              <td className="py-3 px-3 text-right opacity-80">
                                {s.tradeCount} ({s.winRate}%)
                              </td>

                              <td className={`py-3 pr-4 text-right font-black ${
                                s.roiPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                              }`}>
                                {s.roiPct >= 0 ? '+' : ''}{s.roiPct}%
                              </td>
                            </tr>

                            {/* Expanded Itemized Trade Lots Drawer */}
                            {isExpanded && (
                              <tr className="bg-slate-500/5 border-b border-inherit">
                                <td colSpan="9" className="p-4">
                                  <div className="reports-subcard p-4 rounded-2xl border border-inherit space-y-3">
                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-black uppercase tracking-wider opacity-80">
                                          {s.name || s.symbol} — Itemized Trade Lots ({visibleTrades.length})
                                        </span>
                                      </div>

                                      {/* Sub-filter inside expanded view */}
                                      <div className="flex items-center gap-1 reports-pill p-0.5 rounded-lg text-[11px] font-bold">
                                        {[
                                          { key: 'ALL', label: `All Lots (${s.trades.length})` },
                                          { key: 'STCG', label: `STCG Lots (${s.stcgTradeCount})` },
                                          { key: 'LTCG', label: `LTCG Lots (${s.ltcgTradeCount})` }
                                        ].map(tf => (
                                          <button
                                            key={tf.key}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setExpandedTaxFilter(tf.key);
                                            }}
                                            className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                                              expandedTaxFilter === tf.key
                                                ? 'bg-emerald-500 text-slate-950 shadow-sm font-black'
                                                : 'opacity-70 hover:opacity-100'
                                            }`}
                                          >
                                            {tf.label}
                                          </button>
                                        ))}
                                      </div>
                                    </div>

                                    {/* Lots Table */}
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-[11px] font-mono border-collapse">
                                        <thead>
                                          <tr className="border-b border-inherit opacity-60 font-sans font-bold">
                                            <th className="py-2 pl-3 pr-2 text-left">Exit Date</th>
                                            <th className="py-2 px-2 text-left">Entry Date</th>
                                            <th className="py-2 px-2 text-center">Holding Period</th>
                                            <th className="py-2 px-2 text-center">Tax Term</th>
                                            <th className="py-2 px-2 text-right">Qty</th>
                                            <th className="py-2 px-2 text-right">Entry Price</th>
                                            <th className="py-2 px-2 text-right">Exit Price</th>
                                            <th className="py-2 px-2 text-right">Cost</th>
                                            <th className="py-2 px-2 text-right">Proceeds</th>
                                            <th className="py-2 px-2 text-right">Net P&L</th>
                                            <th className="py-2 pr-3 text-right">ROI %</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-inherit">
                                          {visibleTrades.map(trade => (
                                            <tr key={trade.id} className="hover:bg-slate-500/10">
                                              <td className="py-2 pl-3 pr-2 font-bold">{formatDateDDMMYYYY(trade.exitDate || trade.date)}</td>
                                              <td className="py-2 px-2 opacity-80">{formatDateDDMMYYYY(trade.entryDate || trade.date)}</td>
                                              <td className="py-2 px-2 text-center opacity-80">{trade.holdingDays}d</td>
                                              <td className="py-2 px-2 text-center">
                                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                                  trade.taxTerm === 'LTCG'
                                                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                                    : 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                                                }`}>
                                                  {trade.taxTerm}
                                                </span>
                                              </td>
                                              <td className="py-2 px-2 text-right opacity-90">{trade.quantity}</td>
                                              <td className="py-2 px-2 text-right opacity-80">{formatMoney(trade.entryPrice)}</td>
                                              <td className="py-2 px-2 text-right opacity-80">{formatMoney(trade.exitPrice)}</td>
                                              <td className="py-2 px-2 text-right opacity-80">{formatMoney(trade.investedCost)}</td>
                                              <td className="py-2 px-2 text-right opacity-80">{formatMoney(trade.proceeds)}</td>
                                              <td className={`py-2 px-2 text-right font-black ${
                                                trade.netPnlInr >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                                              }`}>
                                                {trade.netPnlInr >= 0 ? '+' : ''}{formatMoney(trade.netPnlInr)}
                                              </td>
                                              <td className={`py-2 pr-3 text-right font-black ${
                                                trade.roiPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                                              }`}>
                                                {trade.roiPct >= 0 ? '+' : ''}{trade.roiPct}%
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── VIEW 4: DETAILED TRADE LOTS LEDGER ───────────────── */}
          {activeView === 'LEDGER' && (
            <div className="reports-subcard p-5 rounded-3xl border border-inherit space-y-4">
              
              {/* Filter controls */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-inherit">
                <div>
                  <span className="text-xs font-black uppercase tracking-wider opacity-80 block">
                    All Itemized Realized Closed Trades ({filteredTrades.length})
                  </span>
                  <span className="text-[11px] font-mono opacity-60">
                    Chronological audit of every individual lot transaction closed in this period
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
                    <input
                      type="text"
                      placeholder="Search trade..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 text-xs rounded-xl reports-pill border border-inherit focus:outline-none w-44 font-mono"
                    />
                  </div>

                  <div className="flex items-center gap-1 reports-pill p-0.5 rounded-xl text-xs font-bold">
                    {[
                      { key: 'ALL', label: 'All' },
                      { key: 'in_stocks', label: 'IN' },
                      { key: 'mutual_funds', label: 'MF' },
                      { key: 'us_stocks', label: 'US' }
                    ].map(f => (
                      <button
                        key={f.key}
                        onClick={() => setAssetFilter(f.key)}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                          assetFilter === f.key 
                            ? 'bg-emerald-500 text-slate-950 shadow-sm font-black' 
                            : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1 reports-pill p-0.5 rounded-xl text-xs font-bold">
                    {['ALL', 'STCG', 'LTCG'].map(f => (
                      <button
                        key={f}
                        onClick={() => setTaxFilter(f)}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                          taxFilter === f 
                            ? 'bg-amber-500 text-slate-950 shadow-sm font-black' 
                            : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Individual Lots Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-inherit opacity-75 font-sans font-bold text-[11px]">
                      <th className="py-2.5 pl-4 pr-3 text-left">Exit Date</th>
                      <th className="py-2.5 px-3 text-left">Asset / Symbol</th>
                      <th className="py-2.5 px-3 text-left">Category</th>
                      <th className="py-2.5 px-3 text-center">Holding Period</th>
                      <th className="py-2.5 px-3 text-center">Tax Term</th>
                      <th className="py-2.5 px-3 text-right">Quantity</th>
                      <th className="py-2.5 px-3 text-right">Entry Price</th>
                      <th className="py-2.5 px-3 text-right">Exit Price</th>
                      <th className="py-2.5 px-3 text-right">Cost Sold</th>
                      <th className="py-2.5 px-3 text-right">Proceeds</th>
                      <th className="py-2.5 px-3 text-right">Net Realized P&L</th>
                      <th className="py-2.5 pr-4 text-right">ROI %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-inherit">
                    {filteredTrades.length === 0 ? (
                      <tr>
                        <td colSpan="12" className="py-12 text-center opacity-50 font-mono">
                          No closed trades match the selected criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredTrades.map(trade => (
                        <tr key={trade.id} className="reports-table-row transition-colors hover:bg-slate-500/10">
                          <td className="py-3 pl-4 pr-3 font-bold">{formatDateDDMMYYYY(trade.exitDate || trade.date)}</td>
                          <td className="py-3 px-3 font-sans font-bold flex items-center gap-2">
                            <HoldingLogo 
                              symbol={trade.symbol} 
                              name={trade.name} 
                              categoryId={trade.assetClass} 
                              className="w-5 h-5 rounded text-[8px] shrink-0" 
                            />
                            <span className="truncate max-w-[150px]">{trade.name || trade.symbol}</span>
                          </td>
                          <td className="py-3 px-3">
                            <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider ${
                              trade.assetClass === 'in_stocks' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                              trade.assetClass === 'mutual_funds' ? 'bg-purple-500/10 text-purple-500 border border-purple-500/20' :
                              'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                            }`}>
                              {trade.assetClass === 'in_stocks' ? 'IN' : trade.assetClass === 'mutual_funds' ? 'MF' : 'US'}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center opacity-80">{trade.holdingDays}d</td>
                          <td className="py-3 px-3 text-center">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              trade.taxTerm === 'LTCG'
                                ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                : 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                            }`}>
                              {trade.taxTerm}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right opacity-90">{trade.quantity}</td>
                          <td className="py-3 px-3 text-right opacity-80">{formatMoney(trade.entryPrice)}</td>
                          <td className="py-3 px-3 text-right opacity-80">{formatMoney(trade.exitPrice)}</td>
                          <td className="py-3 px-3 text-right opacity-80">{formatMoney(trade.investedCost)}</td>
                          <td className="py-3 px-3 text-right opacity-80">{formatMoney(trade.proceeds)}</td>
                          <td className={`py-3 px-3 text-right font-bold ${
                            trade.netPnlInr >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                          }`}>
                            {trade.netPnlInr >= 0 ? '+' : ''}{formatMoney(trade.netPnlInr)}
                          </td>
                          <td className={`py-3 pr-4 text-right font-bold ${
                            trade.roiPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                          }`}>
                            {trade.roiPct >= 0 ? '+' : ''}{trade.roiPct}%
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
