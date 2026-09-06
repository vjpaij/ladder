import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, Coins, Calendar, TrendingUp, BarChart2, DollarSign, 
  Globe, Percent, Plus, ArrowUpRight, Clock
} from 'lucide-react';
import { 
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, Cell 
} from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import HoldingLogo from './HoldingLogo';
import formatDateDDMMYYYY from '../utils/dateFormatter';

export default function AssetDividendDetailModal({ 
  isOpen, 
  onClose, 
  asset, 
  dividendsHistory = [], 
  holding = null,
  onAddDividend = null 
}) {
  const { theme, fxRate, currency: globalCurrency } = useThemeAuth();
  const [chartTab, setChartTab] = useState('annual'); // 'annual' | 'cumulative'
  const [localCurrency, setLocalCurrency] = useState('DEFAULT'); // 'DEFAULT' | 'INR' | 'USD'

  if (!isOpen || !asset) return null;

  const isLight = theme === 'light';
  const isUS = asset.currency === 'USD' || asset.category_id === 'us_stocks';
  const effectiveFx = Number(asset.fx_rate || fxRate || 87.25);

  // Determine active display currency
  const activeCurrency = localCurrency === 'DEFAULT' ? (isUS && globalCurrency === 'USD' ? 'USD' : 'INR') : localCurrency;
  const isDisplayUSD = activeCurrency === 'USD';

  // Extract all dividend records for this specific scheme
  const schemeDividends = useMemo(() => {
    if (!asset) return [];
    const sym = (asset.symbol || '').trim().toUpperCase();
    const hid = asset.holding_id;
    return (dividendsHistory || []).filter(d => {
      if (hid && d.holding_id && d.holding_id === hid) return true;
      if (sym && d.symbol && d.symbol.toUpperCase() === sym) {
        if (asset.currency && d.currency) return asset.currency === d.currency;
        return true;
      }
      return false;
    }).sort((a, b) => (b.raw_date || '').localeCompare(a.raw_date || ''));
  }, [asset, dividendsHistory]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    let totalINR = 0;
    let totalOriginal = 0;
    
    schemeDividends.forEach(d => {
      totalINR += Number(d.amount_inr || 0);
      totalOriginal += Number(d.amount_original || 0);
    });

    const count = schemeDividends.length;
    const avgOriginal = count > 0 ? (totalOriginal / count) : 0;
    const avgINR = count > 0 ? (totalINR / count) : 0;
    const latest = schemeDividends[0] || null;
    const oldest = schemeDividends[schemeDividends.length - 1] || null;
    
    const investedCost = Number(holding?.invested_value || 0);
    const yieldOnCost = investedCost > 0 ? ((totalINR / investedCost) * 100) : null;

    return {
      totalINR,
      totalOriginal,
      count,
      avgOriginal,
      avgINR,
      latest,
      oldest,
      investedCost,
      yieldOnCost
    };
  }, [schemeDividends, holding]);

  // Annual Chart Data
  const annualChartData = useMemo(() => {
    const yearsMap = {};
    schemeDividends.forEach(d => {
      const year = (d.raw_date || '').slice(0, 4) || 'Unknown';
      if (!yearsMap[year]) {
        yearsMap[year] = { year, inrAmount: 0, originalAmount: 0, count: 0 };
      }
      yearsMap[year].inrAmount += Number(d.amount_inr || 0);
      yearsMap[year].originalAmount += Number(d.amount_original || 0);
      yearsMap[year].count += 1;
    });

    return Object.keys(yearsMap).sort().map(year => ({
      year,
      amount: isDisplayUSD ? yearsMap[year].originalAmount : yearsMap[year].inrAmount,
      inrAmount: Number(yearsMap[year].inrAmount.toFixed(2)),
      originalAmount: Number(yearsMap[year].originalAmount.toFixed(2)),
      count: yearsMap[year].count
    }));
  }, [schemeDividends, isDisplayUSD]);

  // Cumulative Chart Data
  const cumulativeChartData = useMemo(() => {
    const chronological = [...schemeDividends].reverse();
    let runINR = 0;
    let runOriginal = 0;

    return chronological.map((d, index) => {
      runINR += Number(d.amount_inr || 0);
      runOriginal += Number(d.amount_original || 0);
      const displayDate = formatDateDDMMYYYY(d.payment_date || d.raw_date);
      return {
        date: displayDate,
        rawDate: d.raw_date,
        cumulative: isDisplayUSD ? Number(runOriginal.toFixed(2)) : Number(runINR.toFixed(2)),
        cumulativeINR: Number(runINR.toFixed(2)),
        cumulativeUSD: Number(runOriginal.toFixed(2)),
        payout: isDisplayUSD ? Number(d.amount_original) : Number(d.amount_inr),
        index: index + 1
      };
    });
  }, [schemeDividends, isDisplayUSD]);

  // Calculate running cumulative for table
  const ledgerRows = useMemo(() => {
    let runningINR = 0;
    let runningOriginal = 0;
    const chrono = [...schemeDividends].reverse().map(d => {
      runningINR += Number(d.amount_inr || 0);
      runningOriginal += Number(d.amount_original || 0);
      return {
        ...d,
        cumINR: runningINR,
        cumOriginal: runningOriginal
      };
    });
    return chrono.reverse();
  }, [schemeDividends]);

  const cleanName = asset.clean_name || asset.asset_name || asset.name || asset.symbol;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/75 backdrop-blur-md">
        
        {/* Backdrop Click */}
        <div className="absolute inset-0" onClick={onClose} />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="modal-surface relative z-10 w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl border border-slate-800 shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="p-5 sm:p-6 border-b border-slate-800/80 flex items-center justify-between gap-4 shrink-0 bg-slate-900/40">
            <div className="flex items-center gap-3.5 min-w-0">
              <HoldingLogo
                holding={{
                  name: cleanName,
                  symbol: asset.symbol,
                  category_id: isUS ? 'us_stocks' : 'in_stocks'
                }}
                className="w-11 h-11 rounded-2xl shrink-0"
                fallbackClass="text-sm font-bold"
                accentColor={isUS ? '#a855f7' : '#10b981'}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base sm:text-lg font-black text-white truncate">
                    {cleanName}
                  </h2>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                    isUS 
                      ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' 
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  }`}>
                    {isUS ? 'US Equity' : 'Indian Equity'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400 font-mono">
                  <span className="font-bold text-slate-300">{asset.symbol}</span>
                  <span>•</span>
                  <span>{schemeDividends.length} {schemeDividends.length === 1 ? 'Payout' : 'Payouts'}</span>
                  {isUS && (
                    <>
                      <span>•</span>
                      <span className="text-[11px] text-purple-400">FX: ₹{effectiveFx.toFixed(2)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {isUS && (
                <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-0.5 text-xs font-mono font-bold">
                  <button
                    onClick={() => setLocalCurrency('INR')}
                    className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                      !isDisplayUSD 
                        ? 'bg-emerald-500 text-slate-950 shadow-sm' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    INR
                  </button>
                  <button
                    onClick={() => setLocalCurrency('USD')}
                    className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                      isDisplayUSD 
                        ? 'bg-purple-500 text-white shadow-sm' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    USD
                  </button>
                </div>
              )}

              {onAddDividend && (
                <button
                  onClick={() => {
                    onClose();
                    onAddDividend({
                      symbol: asset.symbol,
                      name: cleanName,
                      category_id: isUS ? 'us_stocks' : 'in_stocks'
                    });
                  }}
                  className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Add Dividend for this stock"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Add Payout</span>
                </button>
              )}

              <button
                onClick={onClose}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Modal Body */}
          <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
            
            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              
              {/* Card 1: Total Dividends */}
              <div className="glass-card p-3.5 rounded-2xl border border-slate-800/80 relative overflow-hidden">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  <span>Total Received</span>
                  <Coins className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div className="text-lg sm:text-xl font-black font-mono text-emerald-400">
                  {isDisplayUSD 
                    ? `$${metrics.totalOriginal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                    : `₹${metrics.totalINR.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  }
                </div>
                {isUS && (
                  <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                    {isDisplayUSD 
                      ? `≈ ₹${metrics.totalINR.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                      : `≈ $${metrics.totalOriginal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    }
                  </div>
                )}
              </div>

              {/* Card 2: Distributions Count */}
              <div className="glass-card p-3.5 rounded-2xl border border-slate-800/80 relative overflow-hidden">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  <span>Distributions</span>
                  <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div className="text-lg sm:text-xl font-black font-mono text-slate-100">
                  {metrics.count}
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  {metrics.oldest ? `${formatDateDDMMYYYY(metrics.oldest.payment_date || metrics.oldest.raw_date)} to ${formatDateDDMMYYYY(metrics.latest.payment_date || metrics.latest.raw_date)}` : 'Recorded payouts'}
                </div>
              </div>

              {/* Card 3: Average Payout */}
              <div className="glass-card p-3.5 rounded-2xl border border-slate-800/80 relative overflow-hidden">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  <span>Average Payout</span>
                  <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />
                </div>
                <div className="text-lg sm:text-xl font-black font-mono text-slate-100">
                  {isDisplayUSD 
                    ? `$${metrics.avgOriginal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                    : `₹${metrics.avgINR.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  }
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  Per distribution
                </div>
              </div>

              {/* Card 4: Latest Payout or Yield on Cost */}
              <div className="glass-card p-3.5 rounded-2xl border border-slate-800/80 relative overflow-hidden">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  <span>{metrics.yieldOnCost !== null ? 'Yield on Cost' : 'Latest Payout'}</span>
                  {metrics.yieldOnCost !== null ? <Percent className="w-3.5 h-3.5 text-amber-400" /> : <Clock className="w-3.5 h-3.5 text-amber-400" />}
                </div>
                <div className="text-lg sm:text-xl font-black font-mono text-amber-400">
                  {metrics.yieldOnCost !== null 
                    ? `${metrics.yieldOnCost.toFixed(2)}%` 
                    : metrics.latest 
                    ? (isDisplayUSD 
                        ? `$${Number(metrics.latest.amount_original).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                        : `₹${Number(metrics.latest.amount_inr).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      )
                    : '—'
                  }
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  {metrics.yieldOnCost !== null 
                    ? `Cost: ₹${metrics.investedCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                    : metrics.latest ? formatDateDDMMYYYY(metrics.latest.payment_date || metrics.latest.raw_date) : '—'
                  }
                </div>
              </div>

            </div>

            {/* Charts Section */}
            <div className="glass-card p-4 sm:p-5 rounded-2xl border border-slate-800/80 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    {chartTab === 'annual' ? 'Annual Payout Distribution' : 'Cumulative Growth Timeline'}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    ({isDisplayUSD ? 'USD' : 'INR'})
                  </span>
                </div>

                {/* Tab Switcher */}
                <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-0.5 text-xs font-bold">
                  <button
                    onClick={() => setChartTab('annual')}
                    className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                      chartTab === 'annual' 
                        ? 'bg-slate-800 text-white shadow-sm' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Annual Breakdown
                  </button>
                  <button
                    onClick={() => setChartTab('cumulative')}
                    className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                      chartTab === 'cumulative' 
                        ? 'bg-slate-800 text-white shadow-sm' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Cumulative Curve
                  </button>
                </div>
              </div>

              {/* Chart Rendering */}
              <div className="h-64 w-full">
                {chartTab === 'annual' ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={annualChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} vertical={false} />
                      <XAxis 
                        dataKey="year" 
                        stroke="#64748b" 
                        fontSize={11} 
                        tickLine={false} 
                        axisLine={{ stroke: '#334155' }} 
                      />
                      <YAxis 
                        stroke="#64748b" 
                        fontSize={11} 
                        tickLine={false} 
                        axisLine={false}
                        tickFormatter={(v) => isDisplayUSD ? `$${v}` : `₹${v}`} 
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#334155',
                          borderRadius: '12px',
                          fontSize: '12px',
                          color: '#f8fafc'
                        }}
                        formatter={(val, name, item) => [
                          isDisplayUSD 
                            ? `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (₹${item.payload.inrAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })})` 
                            : `₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                          'Dividends Received'
                        ]}
                        labelFormatter={(label) => `Calendar Year: ${label}`}
                      />
                      <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                        {annualChartData.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={isUS ? '#a855f7' : '#10b981'} 
                            fillOpacity={0.85} 
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cumulativeChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="cumDividendGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={isUS ? '#a855f7' : '#10b981'} stopOpacity={0.4} />
                          <stop offset="95%" stopColor={isUS ? '#a855f7' : '#10b981'} stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        stroke="#64748b" 
                        fontSize={11} 
                        tickLine={false} 
                        axisLine={{ stroke: '#334155' }} 
                      />
                      <YAxis 
                        stroke="#64748b" 
                        fontSize={11} 
                        tickLine={false} 
                        axisLine={false}
                        tickFormatter={(v) => isDisplayUSD ? `$${v}` : `₹${v}`} 
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#334155',
                          borderRadius: '12px',
                          fontSize: '12px',
                          color: '#f8fafc'
                        }}
                        formatter={(val, name, item) => [
                          isDisplayUSD 
                            ? `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (₹${item.payload.cumulativeINR.toLocaleString('en-IN', { minimumFractionDigits: 2 })})` 
                            : `₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                          'Cumulative Total'
                        ]}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="cumulative" 
                        stroke={isUS ? '#a855f7' : '#10b981'} 
                        strokeWidth={2.5} 
                        fill="url(#cumDividendGradient)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Payout History Ledger Table */}
            <div className="glass-card rounded-2xl border border-slate-800/80 overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Itemized Distribution Ledger
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {ledgerRows.length} {ledgerRows.length === 1 ? 'Record' : 'Records'}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-900/60 select-none">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3 text-right">Original Payout</th>
                      {isUS && <th className="py-2.5 px-3 text-right">FX Rate</th>}
                      <th className="py-2.5 px-3 text-right">INR Credited</th>
                      <th className="py-2.5 px-3 text-right">Cumulative Total</th>
                    </tr>
                  </thead>
                  <tbody className="[&>tr]:border-b [&>tr]:border-slate-800/40 text-xs font-mono">
                    {ledgerRows.map((row, i) => (
                      <tr key={row.id || `${row.symbol}-${i}`} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-2.5 px-3 text-slate-300 font-medium">
                          {formatDateDDMMYYYY(row.payment_date || row.raw_date)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-slate-200">
                          {row.currency === 'USD' 
                            ? `$${Number(row.amount_original).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                            : `₹${Number(row.amount_original).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          }
                        </td>
                        {isUS && (
                          <td className="py-2.5 px-3 text-right text-slate-400">
                            ₹{Number(row.fx_rate || effectiveFx).toFixed(2)}
                          </td>
                        )}
                        <td className="py-2.5 px-3 text-right font-bold text-emerald-400">
                          ₹{Number(row.amount_inr).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-300 font-bold">
                          {isDisplayUSD 
                            ? `$${row.cumOriginal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                            : `₹${row.cumINR.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
