import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip 
} from 'recharts';
import { 
  X, 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Calendar, 
  CalendarDays, 
  Search, 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  Activity,
  Sparkles,
  RefreshCw
} from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import ChartRangeSelector from './ChartRangeSelector';

function formatDateDDMMYYYY(dateStr) {
  if (!dateStr) return '—';
  const clean = String(dateStr).split('T')[0];
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}-${parts[0]}`;
  }
  return clean;
}

export default function FxRateModal({ isOpen, onClose }) {
  const { formatMoney } = useThemeAuth();

  const [fxRangeFilter, setFxRangeFilter] = useState({ type: 'ALL', startDate: null, endDate: null, rangeKey: 'ALL' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Table search & sort state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const fetchHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        let url = `/api/fx-history?timeframe=ALL`;
        if (fxRangeFilter.type === 'ALL') {
          url = `/api/fx-history?timeframe=ALL`;
        } else if (fxRangeFilter.startDate && fxRangeFilter.endDate) {
          url = `/api/fx-history?timeframe=CUSTOM&startDate=${fxRangeFilter.startDate}&endDate=${fxRangeFilter.endDate}`;
        } else if (fxRangeFilter.rangeKey) {
          url = `/api/fx-history?timeframe=${fxRangeFilter.rangeKey}`;
        }
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load forex history');
        const json = await res.json();
        if (isMounted) setData(json);
      } catch (err) {
        if (isMounted) setError(err.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchHistory();
    return () => { isMounted = false; };
  }, [isOpen, fxRangeFilter]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSortClick = (field) => {
    if (sortField === field) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const renderSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-35 inline ml-1 shrink-0" />;
    return sortDir === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-emerald-500 inline ml-1 shrink-0" /> 
      : <ArrowDown className="w-3 h-3 text-emerald-500 inline ml-1 shrink-0" />;
  };

  // Filtered & Sorted Table Records
  const tableRecords = useMemo(() => {
    if (!data?.table) return [];
    let list = [...data.table];

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(row => {
        const formatted = formatDateDDMMYYYY(row.date);
        return row.date.includes(q) || formatted.includes(q) || String(row.rate).includes(q);
      });
    }

    list.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (typeof valA === 'string') {
        return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      valA = Number(valA) || 0;
      valB = Number(valB) || 0;
      return sortDir === 'asc' ? valA - valB : valB - valA;
    });

    return list;
  }, [data?.table, searchQuery, sortField, sortDir]);

  // Custom Chart Tooltip
  const CustomChartTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const pt = payload[0].payload;
      const chg = pt.change;
      const pct = pt.changePct;
      const isPositive = chg >= 0;

      return (
        <div className="reports-card p-3 rounded-2xl shadow-2xl border border-slate-700/80 text-xs space-y-1 z-50 pointer-events-none min-w-[190px]">
          <div className="flex items-center justify-between gap-3 border-b border-inherit pb-1">
            <span className="font-mono text-[11px] font-bold opacity-80">{formatDateDDMMYYYY(pt.date)}</span>
            <span className="text-[10px] uppercase font-bold text-slate-400">Forex Quote</span>
          </div>
          <div className="pt-1 font-mono space-y-1">
            <div className="flex justify-between items-center gap-4">
              <span className="opacity-70">Exchange Rate:</span>
              <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                ₹{Number(pt.rate).toFixed(2)}
              </span>
            </div>
            {chg !== 0 && (
              <div className="flex justify-between items-center gap-4 text-[11px]">
                <span className="opacity-70">Daily Change:</span>
                <span className={`font-bold ${isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {isPositive ? '+' : ''}₹{Math.abs(chg).toFixed(2)} ({isPositive ? '+' : ''}{pct.toFixed(2)}%)
                </span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-950/75 backdrop-blur-md overflow-y-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="relative w-full max-w-4xl modal-surface reports-card rounded-3xl p-5 sm:p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto custom-scrollbar border border-slate-700/80 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-4 border-b border-inherit opacity-95 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-slate-950 shadow-md shadow-emerald-500/20 shrink-0 font-bold">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black flex items-center gap-2">
                    <span>USD / INR Exchange Rate</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-500 font-bold border border-emerald-500/30">
                      Live Forex Feed
                    </span>
                  </h3>
                </div>
              </div>

              <button
                onClick={onClose}
                className="p-2 rounded-xl opacity-70 hover:opacity-100 hover:bg-slate-500/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Top KPI Metrics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 reports-subcard rounded-2xl">
                <span className="text-[10px] uppercase font-bold opacity-70 block">Current Exchange Rate</span>
                <p className="text-lg font-black font-mono mt-1 text-emerald-600 dark:text-emerald-400">
                  ₹{Number(data?.currentRate || 87.25).toFixed(2)}
                </p>
                <span className="text-[10px] opacity-60 font-mono">Per 1.00 USD</span>
              </div>

              <div className="p-3.5 reports-subcard rounded-2xl">
                <span className="text-[10px] uppercase font-bold opacity-70 block">Period High</span>
                <p className="text-lg font-black font-mono mt-1">
                  ₹{Number(data?.stats?.high || 0).toFixed(2)}
                </p>
                <span className="text-[10px] opacity-60 font-mono">
                  {data?.stats?.highDate ? formatDateDDMMYYYY(data.stats.highDate) : '—'}
                </span>
              </div>

              <div className="p-3.5 reports-subcard rounded-2xl">
                <span className="text-[10px] uppercase font-bold opacity-70 block">Period Low</span>
                <p className="text-lg font-black font-mono mt-1">
                  ₹{Number(data?.stats?.low || 0).toFixed(2)}
                </p>
                <span className="text-[10px] opacity-60 font-mono">
                  {data?.stats?.lowDate ? formatDateDDMMYYYY(data.stats.lowDate) : '—'}
                </span>
              </div>

              <div className="p-3.5 reports-subcard rounded-2xl">
                <span className="text-[10px] uppercase font-bold opacity-70 block">Period Movement</span>
                <p className={`text-lg font-black font-mono mt-1 ${(data?.stats?.periodChange || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {(data?.stats?.periodChange || 0) >= 0 ? '+' : ''}₹{Number(data?.stats?.periodChange || 0).toFixed(2)}
                </p>
                <span className={`text-[10px] font-bold font-mono ${(data?.stats?.periodChangePct || 0) >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {(data?.stats?.periodChangePct || 0) >= 0 ? '+' : ''}{Number(data?.stats?.periodChangePct || 0).toFixed(2)}%
                </span>
              </div>
            </div>

            {/* Timeframe Range Selector & Chart Header */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <ChartRangeSelector
                  initialRange="ALL"
                  onChange={(range) => setFxRangeFilter(range)}
                />

                <div className="text-[11px] font-mono opacity-60">
                  {data?.series?.length || 0} Trading Sessions Recorded
                </div>
              </div>

              {/* Recharts Area Chart */}
              <div className="h-[280px] w-full pt-1">
                {loading ? (
                  <div className="h-full flex items-center justify-center text-xs opacity-60 font-bold">
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    Loading exchange rate history...
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data?.series || []} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="fxAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#94A3B833" vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        stroke="#64748B" 
                        tick={{ fill: 'currentColor', fontSize: 10 }}
                        tickFormatter={(d) => {
                          const parts = d.split('-');
                          return `${parts[2]}/${parts[1]}`;
                        }}
                      />
                      <YAxis 
                        domain={['dataMin - 0.5', 'dataMax + 0.5']}
                        stroke="#64748B" 
                        tick={{ fill: 'currentColor', fontSize: 10 }} 
                        tickFormatter={(v) => `₹${Number(v).toFixed(1)}`} 
                      />
                      <Tooltip content={<CustomChartTooltip />} />
                      <Area 
                        type="monotone" 
                        dataKey="rate" 
                        stroke="#10B981" 
                        strokeWidth={2.5} 
                        fillOpacity={1} 
                        fill="url(#fxAreaGrad)" 
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Date-wise Historical Rates Table */}
            <div className="space-y-3 pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <h4 className="text-xs font-black uppercase tracking-wider opacity-80 flex items-center gap-2">
                  <span>Daily Exchange Rate Ledger</span>
                  <span className="text-[10px] font-mono opacity-60">({tableRecords.length} records)</span>
                </h4>

                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 opacity-50 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Filter by date or rate..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-10 py-1.5 rounded-xl text-xs bg-inherit border border-inherit opacity-90 focus:opacity-100 outline-none focus:border-emerald-500 font-medium"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl reports-table-container max-h-[260px] overflow-y-auto custom-scrollbar">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="reports-table-head font-bold uppercase text-[10px] select-none sticky top-0 z-10">
                      <th 
                        onClick={() => handleSortClick('date')} 
                        className="py-2.5 pl-4 cursor-pointer hover:text-emerald-500 transition-colors"
                      >
                        Date {renderSortIcon('date')}
                      </th>
                      <th 
                        onClick={() => handleSortClick('rate')} 
                        className="py-2.5 text-right cursor-pointer hover:text-emerald-500 transition-colors"
                      >
                        Exchange Rate (USD/INR) {renderSortIcon('rate')}
                      </th>
                      <th 
                        onClick={() => handleSortClick('change')} 
                        className="py-2.5 text-right cursor-pointer hover:text-emerald-500 transition-colors"
                      >
                        Daily Change {renderSortIcon('change')}
                      </th>
                      <th 
                        onClick={() => handleSortClick('changePct')} 
                        className="py-2.5 text-right pr-4 cursor-pointer hover:text-emerald-500 transition-colors"
                      >
                        % Movement {renderSortIcon('changePct')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-inherit font-mono">
                    {tableRecords.length > 0 ? (
                      tableRecords.map((row, idx) => {
                        const isPositive = (row.change || 0) >= 0;
                        return (
                          <tr key={`${row.date}-${idx}`} className="reports-table-row transition-colors">
                            <td className="py-2.5 pl-4 font-bold opacity-90">
                              {formatDateDDMMYYYY(row.date)}
                            </td>
                            <td className="py-2.5 text-right font-black text-emerald-600 dark:text-emerald-400">
                              ₹{Number(row.rate).toFixed(2)}
                            </td>
                            <td className={`py-2.5 text-right font-bold ${row.change === 0 ? 'opacity-60' : isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {row.change > 0 ? '+' : ''}{Number(row.change).toFixed(2)}
                            </td>
                            <td className={`py-2.5 text-right pr-4 font-black ${row.changePct === 0 ? 'opacity-60' : isPositive ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {row.changePct > 0 ? '+' : ''}{Number(row.changePct).toFixed(2)}%
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-xs opacity-60 font-sans">
                          No exchange rate records found matching your filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  if (typeof document !== 'undefined') {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
}
