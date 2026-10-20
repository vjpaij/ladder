import React, { useState, useEffect, useMemo } from 'react';
import {
  ExternalLink,
  FileSpreadsheet,
  TrendingUp,
  TrendingDown,
  Building2,
  DollarSign,
  PieChart,
  Percent,
  RefreshCw,
  AlertCircle,
  Calendar,
  Layers
} from 'lucide-react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';
import HoldingLogo from './HoldingLogo';

export default function StockFinancialsView({
  symbol,
  name,
  market = 'IN',
  className = ''
}) {
  const { theme, currency } = useThemeAuth();
  const isLight = theme === 'light' || theme === 'warm_light' || theme === 'nordic_light';

  const [activeTab, setActiveTab] = useState('QUARTERLY'); // 'QUARTERLY' | 'ANNUAL'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const cleanSymbol = useMemo(() => {
    return String(symbol || '').trim().toUpperCase().replace(/\.(NS|BO)$/i, '');
  }, [symbol]);

  const isUs = market === 'US' || ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'].includes(cleanSymbol);

  const fetchFundamentals = async () => {
    if (!cleanSymbol) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`/api/trading-journal/fundamentals/${cleanSymbol}`, {
        params: { market: isUs ? 'US' : 'IN' }
      });
      if (res.data?.success && res.data.data) {
        setData(res.data.data);
      } else {
        setError('No financial fundamentals found for this company.');
      }
    } catch (err) {
      console.error('[StockFinancialsView] Error fetching fundamentals:', err);
      setError(err.response?.data?.error || 'Failed to load company fundamentals.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFundamentals();
  }, [cleanSymbol, isUs]);

  // Derived Period Labels for Quarters and Annual
  const quarterLabels = useMemo(() => {
    if (data?.quarterLabels && Array.isArray(data.quarterLabels) && data.quarterLabels.length > 0) {
      return data.quarterLabels;
    }
    const salesLen = (data?.quarterRows?.Sales || data?.quarterlySales || []).length;
    if (salesLen === 0) return [];
    
    // Derive from latestQuarter
    const latestQ = data?.latestQuarter || 'Jun 2026';
    const parts = latestQ.trim().split(' ');
    const months = ['Mar', 'Jun', 'Sep', 'Dec'];
    let mIdx = months.indexOf(parts[0]);
    let yr = parseInt(parts[1], 10) || new Date().getFullYear();
    if (mIdx === -1) mIdx = 1;

    const derived = [];
    for (let i = salesLen - 1; i >= 0; i--) {
      let m = mIdx - i;
      let y = yr;
      while (m < 0) {
        m += 4;
        y -= 1;
      }
      derived.push(`${months[m]} ${y}`);
    }
    return derived;
  }, [data]);

  const annualLabels = useMemo(() => {
    if (data?.annualLabels && Array.isArray(data.annualLabels) && data.annualLabels.length > 0) {
      return data.annualLabels;
    }
    const salesLen = (data?.annualRows?.Sales || data?.annualSales || []).length;
    if (salesLen === 0) return [];
    const currentYr = new Date().getFullYear();
    const derived = [];
    for (let i = salesLen - 2; i >= 0; i--) {
      derived.push(`Mar ${currentYr - i}`);
    }
    derived.push('TTM');
    return derived;
  }, [data]);

  // Metric Rows to Display
  const standardMetrics = [
    { key: 'Sales', label: 'Sales / Revenue (₹ Cr)', highlight: false },
    { key: 'Expenses', label: 'Expenses (₹ Cr)', highlight: false },
    { key: 'Operating Profit', label: 'Operating Profit (₹ Cr)', highlight: false },
    { key: 'OPM %', label: 'OPM % (Operating Margin)', highlight: true, isPct: true },
    { key: 'Other Income', label: 'Other Income (₹ Cr)', highlight: false },
    { key: 'Interest', label: 'Interest (₹ Cr)', highlight: false },
    { key: 'Depreciation', label: 'Depreciation (₹ Cr)', highlight: false },
    { key: 'Profit before tax', label: 'Profit before Tax (₹ Cr)', highlight: false },
    { key: 'Tax %', label: 'Tax %', highlight: false, isPct: true },
    { key: 'Net Profit', label: 'Net Profit / PAT (₹ Cr)', highlight: true, isPat: true },
    { key: 'EPS in Rs', label: 'EPS in ₹', highlight: false, isEps: true }
  ];

  // External Screener or Finviz Link
  const externalUrl = data?.screenerUrl || (isUs
    ? `https://finviz.com/quote.ashx?t=${cleanSymbol}`
    : `https://www.screener.in/company/${cleanSymbol}/`);

  const formatNumber = (val, isPct = false, isEps = false) => {
    if (val === undefined || val === null || isNaN(Number(val))) return '—';
    const num = Number(val);
    if (isPct) return `${num >= 0 ? '' : ''}${num.toFixed(1)}%`;
    if (isEps) return `₹${num.toFixed(2)}`;
    return num.toLocaleString('en-IN');
  };

  return (
    <div className={`reports-card rounded-3xl border border-[var(--border-color)] p-4 sm:p-6 space-y-5 ${className}`}>
      {/* 1. Header Bar: Company Snapshot & External Screener Link */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-3">
          <HoldingLogo
            symbol={cleanSymbol}
            name={data?.name || name}
            category={isUs ? 'us_stocks' : 'in_stocks'}
            className="w-11 h-11 rounded-2xl shadow-md border border-[var(--border-color)]"
          />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xl font-black text-[var(--text-primary)] tracking-tight">
                {data?.name || cleanSymbol}
              </h3>
              <span className="text-sm">{isUs ? '🇺🇸' : '🇮🇳'}</span>
              <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300">
                Official Financials
              </span>
            </div>
            <p className="text-xs text-[var(--text-secondary)] font-medium">
              {data?.sector ? `${data.sector} • ${data.industry || 'Equities'}` : `${cleanSymbol} Quarterly Results & Annual P&L Statements`}
            </p>
          </div>
        </div>

        {/* Action Controls: Sub-Tab Switcher & Screener.in Direct Link */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Sub-Tabs: Quarterly vs Annual */}
          <div className="flex items-center p-1 rounded-2xl reports-subcard border border-[var(--border-color)] shadow-sm">
            <button
              type="button"
              onClick={() => setActiveTab('QUARTERLY')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'QUARTERLY'
                  ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Quarterly Results</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('ANNUAL')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'ANNUAL'
                  ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-500/40 shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Annual Profit & Loss</span>
            </button>
          </div>

          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 transition-all cursor-pointer shadow-sm"
            title="Open Complete Financial Dossier on Screener.in"
          >
            <span>{isUs ? 'Open on Finviz ↗' : 'Open on Screener.in ↗'}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* 2. Loading / Error States */}
      {loading ? (
        <div className="h-64 flex flex-col items-center justify-center gap-3">
          <RefreshCw className="w-7 h-7 text-emerald-500 animate-spin" />
          <p className="text-xs font-bold text-[var(--text-secondary)]">
            Fetching official financial statements for {cleanSymbol}...
          </p>
        </div>
      ) : error ? (
        <div className="h-48 flex flex-col items-center justify-center gap-3 p-6 text-center reports-subcard rounded-2xl border border-rose-500/30">
          <AlertCircle className="w-7 h-7 text-rose-500" />
          <p className="text-sm font-bold text-[var(--text-primary)]">{error}</p>
          <button
            type="button"
            onClick={fetchFundamentals}
            className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 text-obsidian-950 hover:bg-emerald-400 transition-all cursor-pointer"
          >
            Retry Fetch
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* 3. Company Snapshot KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="reports-subcard p-3 rounded-2xl border border-[var(--border-color)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Market Cap</span>
              <span className="text-base font-black font-mono text-[var(--text-primary)]">
                {data?.marketCapCr ? `₹${Number(data.marketCapCr).toLocaleString('en-IN')} Cr` : (data?.marketCap || '—')}
              </span>
            </div>

            <div className="reports-subcard p-3 rounded-2xl border border-[var(--border-color)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Stock P/E</span>
              <span className="text-base font-black font-mono text-cyan-700 dark:text-cyan-300">
                {data?.peRatio ? `${Number(data.peRatio).toFixed(1)}x` : '—'}
              </span>
            </div>

            <div className="reports-subcard p-3 rounded-2xl border border-[var(--border-color)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">ROCE %</span>
              <span className="text-base font-black font-mono text-emerald-700 dark:text-emerald-300">
                {data?.rocePct ? `${Number(data.rocePct).toFixed(1)}%` : '—'}
              </span>
            </div>

            <div className="reports-subcard p-3 rounded-2xl border border-[var(--border-color)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">ROE %</span>
              <span className="text-base font-black font-mono text-blue-700 dark:text-blue-300">
                {data?.roePct ? `${Number(data.roePct).toFixed(1)}%` : '—'}
              </span>
            </div>

            <div className="reports-subcard p-3 rounded-2xl border border-[var(--border-color)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">YoY Sales Growth</span>
              <span className={`text-base font-black font-mono ${
                (data?.yoySalesGrowthPct ?? 0) >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
              }`}>
                {data?.yoySalesGrowthPct !== undefined && data?.yoySalesGrowthPct !== null
                  ? `${data.yoySalesGrowthPct >= 0 ? '+' : ''}${data.yoySalesGrowthPct.toFixed(1)}%`
                  : '—'}
              </span>
            </div>

            <div className="reports-subcard p-3 rounded-2xl border border-[var(--border-color)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Promoter Holding</span>
              <span className="text-base font-black font-mono text-[var(--text-primary)]">
                {data?.promoterHoldingPct ? `${data.promoterHoldingPct}%` : '—'}
                {data?.promoterPledgeKnown && Number(data?.promoterPledgePct) > 0 && (
                  <span className="text-[10px] text-rose-500 font-sans block font-bold">
                    Pledged: {data.promoterPledgePct}%
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* 4. High-Contrast Scrollable Financial Table */}
          <div className="reports-card rounded-2xl border border-[var(--border-color)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="reports-table-head border-b border-[var(--border-color)]">
                    {/* Sticky Metric Column Header */}
                    <th className="py-3 px-4 sticky left-0 z-20 reports-table-sticky-head min-w-[200px] font-bold text-[var(--text-primary)] shadow-sm">
                      Financial Metric
                    </th>
                    {/* Period Columns */}
                    {(activeTab === 'QUARTERLY' ? quarterLabels : annualLabels).map((colLabel, idx) => (
                      <th
                        key={idx}
                        className="py-3 px-3.5 text-right font-mono font-bold min-w-[100px] text-[var(--text-primary)]"
                      >
                        {colLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-color)]">
                  {standardMetrics.map((metric) => {
                    // Extract values array from quarterRows or annualRows or fallbacks
                    const sourceRows = activeTab === 'QUARTERLY'
                      ? (data?.quarterRows || {})
                      : (data?.annualRows || {});
                    
                    let values = sourceRows[metric.key] || [];

                    // Fallback to direct annual arrays if annualRows missing
                    if (values.length === 0 && activeTab === 'ANNUAL') {
                      if (metric.key === 'Sales') values = data?.annualSales || [];
                      if (metric.key === 'Net Profit') values = data?.annualPat || [];
                      if (metric.key === 'EPS in Rs') values = data?.annualEps || [];
                    }

                    if (values.length === 0) return null;

                    return (
                      <tr key={metric.key} className="reports-table-row hover:bg-[var(--bg-card)] transition-colors">
                        {/* Sticky Metric Name Column */}
                        <td className="py-2.5 px-4 sticky left-0 z-10 reports-table-sticky-cell font-bold text-[var(--text-primary)] border-r border-[var(--border-color)] shadow-sm flex items-center justify-between">
                          <span>{metric.label}</span>
                          {metric.isPat && <TrendingUp className="w-3.5 h-3.5 text-emerald-500 opacity-80" />}
                          {metric.isPct && <Percent className="w-3.5 h-3.5 text-cyan-500 opacity-80" />}
                        </td>

                        {/* Period Values */}
                        {(activeTab === 'QUARTERLY' ? quarterLabels : annualLabels).map((_, colIdx) => {
                          const val = values[colIdx];
                          if (val === undefined) return <td key={colIdx} className="py-2.5 px-3.5 text-right font-mono text-[var(--text-muted)]">—</td>;

                          // Color Highlight for OPM % and Net Profit
                          let cellStyle = 'font-mono text-right py-2.5 px-3.5 font-bold ';
                          if (metric.isPat) {
                            cellStyle += val > 0
                              ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/5 font-black'
                              : val < 0
                              ? 'text-rose-700 dark:text-rose-300 bg-rose-500/5 font-black'
                              : 'text-[var(--text-muted)]';
                          } else if (metric.isPct && metric.key === 'OPM %') {
                            cellStyle += val >= 15
                              ? 'text-emerald-700 dark:text-emerald-300 font-black'
                              : val >= 8
                              ? 'text-amber-700 dark:text-amber-300 font-bold'
                              : 'text-rose-700 dark:text-rose-300 font-bold';
                          } else {
                            cellStyle += 'text-[var(--text-primary)]';
                          }

                          return (
                            <td key={colIdx} className={cellStyle}>
                              {formatNumber(val, metric.isPct, metric.isEps)}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
