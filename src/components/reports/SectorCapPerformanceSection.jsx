import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid
} from 'recharts';
import {
  TrendingUp, TrendingDown, Layers, PieChart, Calendar, Search, ArrowUpRight,
  ArrowDownRight, ChevronRight, RefreshCw, AlertCircle, ArrowUpDown, ExternalLink
} from 'lucide-react';
import ChartRangeSelector, { computeRangeDates } from '../ChartRangeSelector';
import HoldingLogo from '../HoldingLogo';
import { CAP_COLORS, PALETTE } from './reportsConstants';
import { useThemeAuth } from '../../context/ThemeAuthContext';

export default function SectorCapPerformanceSection({
  equityOptions,
  onSelectHolding,
  formatMoney: propFormatMoney,
  isUSD: propIsUSD,
  isLight: propIsLight
}) {
  const auth = useThemeAuth();
  const isLight = propIsLight !== undefined ? propIsLight : (auth.theme === 'light' || auth.theme === 'warm_light' || auth.theme === 'nordic_light');
  const formatMoney = propFormatMoney || auth.formatMoney;
  const isUSD = propIsUSD !== undefined ? propIsUSD : auth.isUSD;

  const [marketScope, setMarketScope] = useState('PORTFOLIO'); // 'PORTFOLIO' | 'MARKET'
  const [activeMode, setActiveMode] = useState('SECTORS'); // 'SECTORS' | 'CAPS'
  const [rangeFilter, setRangeFilter] = useState({
    type: '1M',
    count: 1,
    unit: 'M',
    startDate: '',
    endDate: '',
    rangeKey: '1M',
    label: '1 Month'
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [stockSearch, setStockSearch] = useState('');
  const [stockSort, setStockSort] = useState({ field: 'returnPct', dir: 'desc' });

  // Initialize range dates on mount
  useEffect(() => {
    const dates = computeRangeDates('1M', 1, 'M');
    setRangeFilter(prev => ({
      ...prev,
      startDate: dates.startDate,
      endDate: dates.endDate,
      label: '1 Month'
    }));
  }, []);

  const fetchPerformance = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {
        marketScope,
        includeIndia: equityOptions ? equityOptions.india : true,
        includeUs: equityOptions ? equityOptions.us : true,
        includeMf: equityOptions ? equityOptions.mf : false
      };
      if (rangeFilter.type !== 'ALL' && rangeFilter.startDate) {
        params.startDate = rangeFilter.startDate;
        params.endDate = rangeFilter.endDate;
      }
      params.rangeType = rangeFilter.type;

      const res = await axios.get('/api/reports/sector-cap-performance', { params });
      if (res.data?.success) {
        setData(res.data);
        // Default select top group
        const groups = activeMode === 'SECTORS' ? res.data.sectors : res.data.caps;
        if (groups && groups.length > 0 && (!selectedGroup || !groups.some(g => g.name === selectedGroup))) {
          setSelectedGroup(groups[0].name);
        }
      } else {
        setError('Failed to load performance metrics.');
      }
    } catch (err) {
      console.error('[SectorCapPerformance] Fetch error:', err);
      setError(err.response?.data?.error || 'Failed to load performance metrics.');
    } finally {
      setLoading(false);
    }
  }, [
    rangeFilter.type,
    rangeFilter.startDate,
    rangeFilter.endDate,
    activeMode,
    selectedGroup,
    marketScope,
    equityOptions?.india,
    equityOptions?.us,
    equityOptions?.mf
  ]);

  useEffect(() => {
    if (rangeFilter.startDate || rangeFilter.type === 'ALL') {
      fetchPerformance();
    }
  }, [
    fetchPerformance,
    rangeFilter.type,
    rangeFilter.startDate,
    rangeFilter.endDate,
    marketScope,
    equityOptions?.india,
    equityOptions?.us,
    equityOptions?.mf
  ]);

  // Active groups according to mode
  const activeGroups = useMemo(() => {
    if (!data) return [];
    return activeMode === 'SECTORS' ? (data.sectors || []) : (data.caps || []);
  }, [data, activeMode]);

  // Currently inspected group object
  const inspectedGroup = useMemo(() => {
    if (!activeGroups.length) return null;
    const found = activeGroups.find(g => g.name === selectedGroup);
    return found || activeGroups[0];
  }, [activeGroups, selectedGroup]);

  // Filtered & sorted stocks within the selected group
  const groupStocks = useMemo(() => {
    if (!inspectedGroup?.stocks) return [];
    let list = [...inspectedGroup.stocks];
    if (stockSearch.trim()) {
      const q = stockSearch.toLowerCase().trim();
      list = list.filter(s =>
        (s.symbol && s.symbol.toLowerCase().includes(q)) ||
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.sector && s.sector.toLowerCase().includes(q)) ||
        (s.mcapCategory && s.mcapCategory.toLowerCase().includes(q))
      );
    }
    return list.sort((a, b) => {
      let av = a[stockSort.field] ?? 0;
      let bv = b[stockSort.field] ?? 0;
      if (typeof av === 'string') {
        av = av.toLowerCase();
        bv = bv.toLowerCase();
      }
      if (av < bv) return stockSort.dir === 'asc' ? -1 : 1;
      if (av > bv) return stockSort.dir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [inspectedGroup, stockSearch, stockSort]);

  const handleStockSort = (field) => {
    setStockSort(prev => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc'
    }));
  };

  const handleRangeChange = (newRange) => {
    setRangeFilter(newRange);
  };

  // Top gainer and decliner
  const bestGroup = useMemo(() => {
    if (!activeGroups.length) return null;
    return [...activeGroups].sort((a, b) => b.returnPct - a.returnPct)[0];
  }, [activeGroups]);

  const worstGroup = useMemo(() => {
    if (!activeGroups.length) return null;
    return [...activeGroups].sort((a, b) => a.returnPct - b.returnPct)[0];
  }, [activeGroups]);

  return (
    <div className="space-y-6">
      {/* Top Header Card: Title, Mode Toggle & Calendar Range Selector */}
      <div className="reports-card p-5 rounded-3xl border border-[var(--border-color)] space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-[var(--text-primary)] flex items-center gap-2">
              <Layers className="w-5 h-5 text-emerald-500" />
              Sectors & Market Cap Performance
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Market Scope Toggle: Portfolio vs General Market */}
            <div className="flex p-1 rounded-2xl bg-black/10 dark:bg-black/30 border border-[var(--border-color)]">
              <button
                type="button"
                onClick={() => {
                  setMarketScope('PORTFOLIO');
                  setSelectedGroup(null);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  marketScope === 'PORTFOLIO'
                    ? 'bg-emerald-500 text-obsidian-950 shadow-md font-black'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                My Portfolio
              </button>
              <button
                type="button"
                onClick={() => {
                  setMarketScope('MARKET');
                  setSelectedGroup(null);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  marketScope === 'MARKET'
                    ? 'bg-emerald-500 text-obsidian-950 shadow-md font-black'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                General Market
              </button>
            </div>

            {/* Mode Toggle: Sectors vs Market Caps */}
            <div className="flex p-1 rounded-2xl bg-black/10 dark:bg-black/30 border border-[var(--border-color)]">
              <button
                type="button"
                onClick={() => {
                  setActiveMode('SECTORS');
                  setSelectedGroup(null);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeMode === 'SECTORS'
                    ? 'bg-emerald-500 text-obsidian-950 shadow-md font-black'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Sectors
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveMode('CAPS');
                  setSelectedGroup(null);
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  activeMode === 'CAPS'
                    ? 'bg-emerald-500 text-obsidian-950 shadow-md font-black'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Market Caps
              </button>
            </div>

            {/* Calendar & Range Selector */}
            <ChartRangeSelector
              initialRange={rangeFilter.type}
              rangeType={rangeFilter.type}
              startDate={rangeFilter.startDate}
              endDate={rangeFilter.endDate}
              onChange={handleRangeChange}
            />
          </div>
        </div>

        {/* Executive Period Summary Cards */}
        {data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
            <div className="p-3.5 rounded-2xl reports-subcard border border-[var(--border-color)]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                {marketScope === 'PORTFOLIO' ? 'Portfolio Equity Return' : 'General Market Return'}
              </span>
              <div className="flex items-center gap-2">
                <span className={`text-base font-black ${
                  data.totalReturnPct >= 0
                    ? 'text-emerald-500 dark:text-emerald-400'
                    : 'text-rose-500 dark:text-rose-400'
                }`}>
                  {data.totalReturnPct >= 0 ? '+' : ''}{data.totalReturnPct.toFixed(2)}%
                </span>
                <span className="text-xs font-mono text-[var(--text-secondary)]">
                  {marketScope === 'PORTFOLIO'
                    ? `(${formatMoney(data.totalGainINR)})`
                    : `(${data.totalStocksCount} Stocks Analyzed)`}
                </span>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl reports-subcard border border-[var(--border-color)]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                Top Performing {activeMode === 'SECTORS' ? 'Sector' : 'Cap'}
              </span>
              {bestGroup ? (
                <div>
                  <span className="text-xs font-black text-[var(--text-primary)] truncate block" title={bestGroup.name}>
                    {bestGroup.name}
                  </span>
                  <span className={`text-xs font-bold ${
                    bestGroup.returnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {bestGroup.returnPct >= 0 ? '+' : ''}{bestGroup.returnPct.toFixed(2)}%
                  </span>
                </div>
              ) : '—'}
            </div>

            <div className="p-3.5 rounded-2xl reports-subcard border border-[var(--border-color)]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                Lagging {activeMode === 'SECTORS' ? 'Sector' : 'Cap'}
              </span>
              {worstGroup ? (
                <div>
                  <span className="text-xs font-black text-[var(--text-primary)] truncate block" title={worstGroup.name}>
                    {worstGroup.name}
                  </span>
                  <span className={`text-xs font-bold ${
                    worstGroup.returnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    {worstGroup.returnPct >= 0 ? '+' : ''}{worstGroup.returnPct.toFixed(2)}%
                  </span>
                </div>
              ) : '—'}
            </div>

            <div className="p-3.5 rounded-2xl reports-subcard border border-[var(--border-color)]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                {marketScope === 'PORTFOLIO' ? 'Total Equity Value' : 'Universe Coverage'}
              </span>
              <span className="text-base font-black text-[var(--text-primary)] block">
                {marketScope === 'PORTFOLIO' ? formatMoney(data.totalCurrentValINR) : `${data.totalStocksCount} Stocks`}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">
                {marketScope === 'PORTFOLIO' ? `${data.totalStocksCount} active stocks` : 'Broader Market Universe'}
              </span>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="reports-card p-12 rounded-3xl border border-[var(--border-color)] flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
          <p className="text-xs font-bold text-[var(--text-secondary)]">
            Calculating historical returns for sectors & market cap tiers...
          </p>
        </div>
      ) : error ? (
        <div className="reports-card p-8 rounded-3xl border border-rose-500/30 flex flex-col items-center justify-center gap-3 text-center">
          <AlertCircle className="w-8 h-8 text-rose-500" />
          <p className="text-sm font-bold text-[var(--text-primary)]">{error}</p>
          <button
            type="button"
            onClick={fetchPerformance}
            className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 text-obsidian-950 hover:bg-emerald-400 cursor-pointer"
          >
            Retry Fetch
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Interactive Performance Bar Chart */}
          <div className="lg:col-span-7 reports-card p-5 rounded-3xl border border-[var(--border-color)] space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                {activeMode === 'SECTORS' ? 'Sectors' : 'Market Cap Tiers'} Ranked by Period Return %
              </span>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                Click bar to inspect stocks
              </span>
            </div>

            <div className="h-[420px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={activeGroups}
                  layout="vertical"
                  margin={{ top: 10, right: 25, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                  <XAxis
                    type="number"
                    stroke="#64748B"
                    fontSize={10}
                    tickFormatter={(val) => `${val >= 0 ? '+' : ''}${val}%`}
                    domain={['auto', 'auto']}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    stroke="#64748B"
                    fontSize={10}
                    width={140}
                    tickFormatter={(val) => val.length > 20 ? `${val.slice(0, 18)}...` : val}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const item = payload[0].payload;
                      return (
                        <div className="reports-card p-3 rounded-2xl border border-[var(--border-color)] shadow-2xl backdrop-blur-md text-xs space-y-1">
                          <span className="font-bold text-[var(--text-primary)] block" title={item.name}>{item.name}</span>
                          <div className="flex justify-between gap-4">
                            <span className="text-[var(--text-secondary)]">Period Return:</span>
                            <span className={`font-bold ${item.returnPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {item.returnPct >= 0 ? '+' : ''}{item.returnPct.toFixed(2)}%
                            </span>
                          </div>
                          {marketScope === 'PORTFOLIO' && (
                            <>
                              <div className="flex justify-between gap-4">
                                <span className="text-[var(--text-secondary)]">Period Gain:</span>
                                <span className="font-bold text-[var(--text-primary)]">{formatMoney(item.gainINR)}</span>
                              </div>
                              <div className="flex justify-between gap-4">
                                <span className="text-[var(--text-secondary)]">Current Value:</span>
                                <span className="font-bold text-[var(--text-primary)]">{formatMoney(item.currentValINR)}</span>
                              </div>
                            </>
                          )}
                          <div className="flex justify-between gap-4">
                            <span className="text-[var(--text-secondary)]">Constituents:</span>
                            <span className="font-bold text-[var(--text-primary)]">{item.stocksCount} stocks</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="returnPct"
                    radius={[0, 6, 6, 0]}
                    onClick={(entry) => setSelectedGroup(entry.name)}
                    cursor="pointer"
                  >
                    {activeGroups.map((entry) => {
                      const isSelected = entry.name === (inspectedGroup?.name || selectedGroup);
                      const isPositive = entry.returnPct >= 0;
                      return (
                        <Cell
                          key={entry.name}
                          fill={isPositive ? (isSelected ? '#10B981' : '#059669') : (isSelected ? '#F43F5E' : '#E11D48')}
                          stroke={isSelected ? '#FFFFFF' : 'none'}
                          strokeWidth={isSelected ? 1.5 : 0}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right Column: Constituent Stocks Breakdown */}
          <div className="lg:col-span-5 reports-card p-5 rounded-3xl border border-[var(--border-color)] flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border-color)]">
                <div>
                  <h3 className="text-sm font-black text-[var(--text-primary)]" title={inspectedGroup?.name}>
                    {inspectedGroup?.name || 'Selected Group'}
                  </h3>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {inspectedGroup?.stocksCount || 0} stocks
                    {marketScope === 'PORTFOLIO' ? ` • ${formatMoney(inspectedGroup?.currentValINR || 0)}` : ''}
                  </span>
                </div>
                <span className={`text-sm font-black px-2.5 py-1 rounded-xl ${
                  (inspectedGroup?.returnPct || 0) >= 0
                    ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-500 border border-rose-500/30'
                }`}>
                  {(inspectedGroup?.returnPct || 0) >= 0 ? '+' : ''}{(inspectedGroup?.returnPct || 0).toFixed(2)}%
                </span>
              </div>

              {/* Stock Search Input */}
              <div className="relative mt-3 mb-2">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder="Search constituent stocks..."
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-black/10 dark:bg-black/30 border border-[var(--border-color)] text-[var(--text-primary)] outline-none focus:border-emerald-500"
                />
              </div>

              {/* Constituent Stocks Table */}
              <div className="overflow-y-auto max-h-[380px] custom-scrollbar pr-1">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-[var(--card-bg)] text-[10px] uppercase font-bold text-[var(--text-muted)] border-b border-[var(--border-color)]">
                    <tr>
                      <th className="py-2 px-1">Stock</th>
                      <th
                        onClick={() => handleStockSort(marketScope === 'PORTFOLIO' ? 'currentValINR' : 'endPrice')}
                        className="py-2 px-2 text-right cursor-pointer hover:text-[var(--text-primary)]"
                        title={marketScope === 'PORTFOLIO' ? 'Sort by Portfolio Value' : 'Sort by Current Price'}
                      >
                        {marketScope === 'PORTFOLIO' ? 'Value' : 'Price / MCap'}
                      </th>
                      <th
                        onClick={() => handleStockSort('returnPct')}
                        className="py-2 px-2 text-right cursor-pointer hover:text-[var(--text-primary)]"
                        title="Sort by Period Return %"
                      >
                        Return
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {groupStocks.map((s) => {
                      const isPositive = (s.returnPct || 0) >= 0;
                      return (
                        <tr
                          key={s.symbol}
                          onClick={() => onSelectHolding && onSelectHolding({ id: s.holdingId, symbol: s.symbol, name: s.name, category_id: s.category_id })}
                          className="hover:bg-slate-800/20 cursor-pointer transition-colors"
                        >
                          <td className="py-2.5 px-1 font-medium">
                            <div className="flex items-center gap-2">
                              <HoldingLogo
                                symbol={s.symbol}
                                name={s.name}
                                category={s.category_id}
                                className="w-6 h-6 rounded-lg shrink-0"
                              />
                              <div className="min-w-0 flex-1 pr-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-bold text-[var(--text-primary)] block text-xs" title={s.symbol}>
                                    {s.symbol}
                                  </span>
                                  {marketScope === 'MARKET' && s.isPortfolioHolding && (
                                    <span className="px-1.5 py-0.2 text-[9px] font-black rounded bg-emerald-500/20 text-emerald-500 border border-emerald-500/30">
                                      Held
                                    </span>
                                  )}
                                </div>
                                <span
                                  className="text-[11px] text-[var(--text-muted)] block truncate max-w-[190px] sm:max-w-[260px] cursor-help"
                                  title={s.name}
                                >
                                  {s.name}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono font-medium text-[var(--text-primary)]">
                            {marketScope === 'PORTFOLIO' ? (
                              formatMoney(s.currentValINR)
                            ) : (
                              <div>
                                <div className="font-bold text-xs">
                                  {s.currency === 'USD' ? `$${s.endPrice.toFixed(2)}` : `₹${s.endPrice.toFixed(2)}`}
                                </div>
                                {s.marketCapCr ? (
                                  <div className="text-[10px] text-[var(--text-muted)] font-normal">
                                    ₹{Number(s.marketCapCr).toLocaleString('en-IN')} Cr
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono font-bold">
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg text-[10px] ${
                              isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                            }`}>
                              {isPositive ? <ArrowUpRight className="w-2.5 h-2.5" /> : <ArrowDownRight className="w-2.5 h-2.5" />}
                              {isPositive ? '+' : ''}{s.returnPct.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    {groupStocks.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-xs text-[var(--text-muted)]">
                          No stocks found in this group.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
