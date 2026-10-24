import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Plus,
  Edit3,
  Trash2,
  TrendingUp,
  TrendingDown,
  Layers,
  Sparkles,
  ShieldCheck,
  Smile,
  AlertTriangle,
  ExternalLink,
  Target,
  BarChart3,
  Calendar,
  Percent,
  CheckCircle2,
  Coins,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  FileSpreadsheet
} from 'lucide-react';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip
} from 'recharts';
import axios from 'axios';
import { useThemeAuth } from '../../src/context/ThemeAuthContext';
import HoldingLogo from './HoldingLogo';
import TradeDetailModal from './TradeDetailModal';
import GoChartingView from './GoChartingView';
import StockFinancialsView from './StockFinancialsView';

export default function SymbolTradeLogsModal({
  symbolData,
  onClose,
  onAddTradeForSymbol,
  onEditTrade,
  onDeleteTrade,
  onRefresh
}) {
  const { currency, formatMoney } = useThemeAuth();
  const [symbolViewMode, setSymbolViewMode] = useState('LEDGER'); // 'LEDGER' | 'CHART' | 'FINANCIALS'
  const [selectedTradeDossier, setSelectedTradeDossier] = useState(null);
  const [modalSortField, setModalSortField] = useState('date');
  const [modalSortOrder, setModalSortOrder] = useState('desc');
  const [tradeStatusFilter, setTradeStatusFilter] = useState('ALL'); // 'ALL' | 'CLOSED' | 'BUY' | 'OPEN'

  const handleModalSort = (field) => {
    if (modalSortField === field) {
      setModalSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setModalSortField(field);
      setModalSortOrder('desc');
    }
  };

  const sortedTrades = useMemo(() => {
    if (!symbolData?.trades || !Array.isArray(symbolData.trades)) return [];
    let list = [...symbolData.trades];

    // Filter by tradeStatusFilter: 'ALL' | 'CLOSED' | 'BUY'
    if (tradeStatusFilter === 'CLOSED') {
      list = list.filter(t => t.status === 'CLOSED');
    } else if (tradeStatusFilter === 'BUY' || tradeStatusFilter === 'OPEN') {
      list = list.filter(t => t.tradeType === 'BUY' || t.status === 'OPEN');
    }

    list.sort((a, b) => {
      let aVal = a[modalSortField];
      let bVal = b[modalSortField];
      if (modalSortField === 'date') {
        aVal = a.date || a.entryDate || '';
        bVal = b.date || b.entryDate || '';
      } else if (modalSortField === 'type') {
        aVal = a.tradeType || a.status || '';
        bVal = b.tradeType || b.status || '';
      } else if (modalSortField === 'holdingDays') {
        aVal = a.holdingDays ?? -1;
        bVal = b.holdingDays ?? -1;
      } else if (modalSortField === 'charges') {
        aVal = a.totalCharges || 0;
        bVal = b.totalCharges || 0;
      } else if (modalSortField === 'tags') {
        aVal = (a.tags || []).join(' ');
        bVal = (b.tags || []).join(' ');
      }
      if (typeof aVal === 'string') {
        return modalSortOrder === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return modalSortOrder === 'asc' ? ((aVal ?? 0) - (bVal ?? 0)) : ((bVal ?? 0) - (aVal ?? 0));
    });

    return list;
  }, [symbolData?.trades, tradeStatusFilter, modalSortField, modalSortOrder]);

  const buyTradesCount = useMemo(() => {
    return Array.isArray(symbolData?.trades) ? symbolData.trades.filter(t => t.tradeType === 'BUY').length : 0;
  }, [symbolData?.trades]);

  if (!symbolData) return null;

  const isUs = symbolData.market === 'US';
  const isUsdMode = isUs && currency === 'USD';
  const displayNetPnl = isUsdMode ? symbolData.netPnl : (symbolData.netPnlInr ?? symbolData.netPnl);
  const displayRoiPct = isUsdMode ? symbolData.roiPct : (symbolData.roiPctInr ?? symbolData.roiPct);
  const isProfitable = (displayNetPnl ?? 0) >= 0;
  const holding = symbolData.portfolioHolding;

  const formatVal = (val, forceUsd = false) => {
    if (val === undefined || val === null || isNaN(Number(val))) return (isUsdMode || forceUsd) ? '$0.00' : '₹0.00';
    if (isUsdMode || forceUsd) {
      return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return '₹' + Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2 }}
        className={`modal-surface reports-card rounded-3xl border border-[var(--border-color)] shadow-2xl w-full ${
          symbolViewMode === 'LEDGER' ? 'max-w-4xl' : 'max-w-4xl xl:max-w-5xl'
        } overflow-hidden my-auto max-h-[92vh] flex flex-col transition-all duration-200`}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] reports-subcard">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl overflow-hidden shrink-0 flex items-center justify-center bg-transparent">
              <HoldingLogo
                symbol={symbolData.symbol}
                name={symbolData.name}
                className="w-full h-full object-contain"
                categoryId={symbolData.market === 'US' ? 'us_stocks' : 'in_stocks'}
              />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-xl font-black text-inherit tracking-tight">{symbolData.symbol}</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-[var(--border-color)] bg-white/[0.04] text-[var(--text-secondary)]">
                  {symbolData.market === 'US' ? '🇺🇸 US Equity' : '🇮🇳 Indian Equity'}
                </span>
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                  isProfitable
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                    : 'border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-300'
                }`}>
                  Net {isProfitable ? '+' : ''}{formatVal(displayNetPnl)} ({displayRoiPct >= 0 ? '+' : ''}{displayRoiPct?.toFixed(1)}%)
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] font-medium truncate max-w-md mt-0.5">
                {symbolData.name || symbolData.symbol}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onAddTradeForSymbol(symbolData.symbol, symbolData.name, symbolData.market, symbolData.segment)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-all cursor-pointer shadow-sm shadow-cyan-500/20"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Log Trade</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Top Mode Switcher Bar */}
        <div className="flex items-center gap-2 px-6 py-2.5 border-b border-[var(--border-color)] reports-subcard overflow-x-auto">
          <button
            type="button"
            onClick={() => setSymbolViewMode('LEDGER')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              symbolViewMode === 'LEDGER'
                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Trades Ledger & KPIs ({symbolData.trades?.length || 0})</span>
          </button>

          <button
            type="button"
            onClick={() => setSymbolViewMode('CHART')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              symbolViewMode === 'CHART'
                ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>GoCharting 1D Technical Chart</span>
          </button>

          <button
            type="button"
            onClick={() => setSymbolViewMode('FINANCIALS')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              symbolViewMode === 'FINANCIALS'
                ? 'bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-500/40 shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Quarterly Results & Financials</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {symbolViewMode === 'CHART' ? (
            <GoChartingView
              symbol={symbolData.symbol}
              name={symbolData.name}
              market={symbolData.market}
            />
          ) : symbolViewMode === 'FINANCIALS' ? (
            <StockFinancialsView
              symbol={symbolData.symbol}
              name={symbolData.name}
              market={symbolData.market}
            />
          ) : (
            <>
              {/* Analysis Confluence Badges from Buy and Sell Analysis */}
          {Array.isArray(symbolData.analysisBadges) && symbolData.analysisBadges.length > 0 && (
            <div className="p-3.5 rounded-2xl reports-subcard border border-[var(--border-color)] flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] mr-1 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> Ladder Intelligence Confluence:
              </span>
              {symbolData.analysisBadges.map((badge, idx) => {
                let badgeClass = 'border-[var(--border-color)] bg-white/[0.04] text-[var(--text-secondary)]';
                if (badge.tone === 'emerald' || badge.label.includes('Buy') || badge.label.includes('Bull')) {
                  badgeClass = 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400';
                } else if (badge.tone === 'rose' || badge.label.includes('Trim') || badge.label.includes('Red') || badge.label.includes('Exit')) {
                  badgeClass = 'border-rose-500/40 bg-rose-500/15 text-rose-400';
                } else if (badge.tone === 'cyan' || badge.type === 'portfolio') {
                  badgeClass = 'border-cyan-500/40 bg-cyan-500/15 text-cyan-400';
                } else if (badge.tone === 'purple') {
                  badgeClass = 'border-purple-500/40 bg-purple-500/15 text-purple-400';
                }
                return (
                  <span key={idx} className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${badgeClass}`}>
                    {badge.label}
                  </span>
                );
              })}
            </div>
          )}

          {/* Active Portfolio Holding Status (if held in Ladder) */}
          {holding && (
            <div className="p-3.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                <span className="font-bold text-cyan-400">Active Position in Ladder Portfolio:</span>
                <span className="font-mono text-[var(--text-primary)]">{holding.quantity} shares @ {formatVal(isUsdMode ? holding.avgBuyPrice : (holding.avgBuyPriceInr || (holding.avgBuyPrice * 94.92)))}</span>
              </div>
              <div className="flex items-center gap-3 font-mono">
                <span className="text-[var(--text-secondary)]">CMP: {formatVal(isUsdMode ? holding.currentPrice : (holding.currentPrice * 94.92))}</span>
                <span className={`font-bold ${holding.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  Unrealized: {formatVal(isUsdMode ? holding.unrealizedPnl : (holding.unrealizedPnlInr || (holding.unrealizedPnl * 94.92)))} ({holding.unrealizedPnlPct >= 0 ? '+' : ''}{holding.unrealizedPnlPct?.toFixed(1)}%)
                </span>
              </div>
            </div>
          )}

          {/* Symbol Executive KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="reports-subcard p-3 rounded-2xl border border-[var(--border-color)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Net Realized P&L</span>
              <span className={`text-lg font-black font-mono ${isProfitable ? 'text-emerald-400' : 'text-rose-400'}`}>
                {formatVal(displayNetPnl)}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] font-mono block mt-0.5">
                Gross: {formatVal(isUsdMode ? symbolData.grossPnl : (symbolData.grossPnlInr ?? symbolData.grossPnl))}
              </span>
            </div>

            <div className="reports-subcard p-3 rounded-2xl border border-[var(--border-color)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Win Rate</span>
              <span className={`text-lg font-black font-mono ${symbolData.winRatePct >= 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {symbolData.winRatePct?.toFixed(1)}%
              </span>
              <span className="text-[10px] text-[var(--text-secondary)] font-mono block mt-0.5">
                {symbolData.winCount}W / {symbolData.lossCount}L ({symbolData.closedTrades} closed)
              </span>
            </div>

            <div className="reports-subcard p-3 rounded-2xl border border-[var(--border-color)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Total Statutory Costs</span>
              <span className="text-lg font-black font-mono text-amber-400">
                {formatVal(isUsdMode ? symbolData.totalCharges : (symbolData.totalChargesInr ?? symbolData.totalCharges))}
              </span>
              <span className="text-[10px] text-[var(--text-muted)] font-mono block mt-0.5">
                STT, GST & Brokerage
              </span>
            </div>

            <div className="reports-subcard p-3 rounded-2xl border border-[var(--border-color)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Capital / Turnover</span>
              <span className="text-lg font-black font-mono text-[var(--text-primary)]">
                {formatVal(isUsdMode ? symbolData.totalCapital : (symbolData.totalCapitalInr ?? symbolData.totalCapital))}
              </span>
              <span className="text-[10px] text-[var(--text-secondary)] font-mono block mt-0.5">
                {symbolData.totalQuantity} total volume
              </span>
            </div>
          </div>

          {/* Cumulative Net P&L Chart for this Symbol */}
          {symbolData.pnlTimeline && symbolData.pnlTimeline.length > 1 && (
            <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-bold text-[var(--text-secondary)]">
                <span className="flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5 text-cyan-400" /> {symbolData.symbol} Cumulative Equity Curve
                </span>
                <span className="font-mono text-[var(--text-muted)]">{symbolData.closedTrades} Closed Trades</span>
              </div>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={symbolData.pnlTimeline}>
                    <defs>
                      <linearGradient id={`symGrad_${symbolData.symbol}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={isProfitable ? '#10b981' : '#f43f5e'} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={isProfitable ? '#10b981' : '#f43f5e'} stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" stroke="var(--text-muted, #64748b)" fontSize={9} tickLine={false} />
                    <YAxis stroke="var(--text-muted, #64748b)" fontSize={9} tickLine={false} tickFormatter={(v) => `${isUsdMode ? '$' : '₹'}${v}`} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--bg-surface, #0f172a)',
                        borderColor: 'var(--border-color, #1e293b)',
                        borderRadius: '0.75rem',
                        fontSize: '11px',
                        color: 'var(--text-primary, #f8fafc)'
                      }}
                      formatter={(val) => [formatVal(val), 'Cumulative Net P&L']}
                    />
                    <Area
                      type="monotone"
                      dataKey={isUsdMode ? "cumulativeNetPnl" : (symbolData.pnlTimeline[0]?.cumulativeNetPnlInr !== undefined ? "cumulativeNetPnlInr" : "cumulativeNetPnl")}
                      stroke={isProfitable ? '#10b981' : '#f43f5e'}
                      strokeWidth={2}
                      fillOpacity={1}
                      fill={`url(#symGrad_${symbolData.symbol})`}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Position & Volume Reconciliation Banner */}
          <div className="p-3.5 rounded-2xl reports-subcard border border-[var(--border-color)] flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-[var(--text-primary)]">Volume Breakdown:</span>
              <span className="px-2 py-0.5 rounded-lg border border-[var(--border-color)] bg-white/[0.03] font-mono text-[var(--text-secondary)]">
                Total Cycled: <strong className="text-[var(--text-primary)]">{symbolData.totalVolumeQty || ((symbolData.closedTradesQty || 0) + (holding ? Number(holding.quantity) : 0))}</strong> shares
              </span>
              <span className="px-2 py-0.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 font-mono">
                Exited: <strong>{symbolData.closedTradesQty || 0}</strong> shares ({symbolData.closedTrades || 0} closed trades)
              </span>
              {holding && Number(holding.quantity) > 0 && (
                <span className="px-2 py-0.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-500 dark:text-cyan-400 font-mono">
                  Currently Held: <strong>{holding.quantity}</strong> shares @ {formatVal(holding.avgBuyPrice)}
                </span>
              )}
            </div>

            {/* Filter Pills */}
            <div className="flex items-center p-0.5 rounded-xl reports-subcard border border-[var(--border-color)]">
              <button
                type="button"
                onClick={() => setTradeStatusFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                  tradeStatusFilter === 'ALL'
                    ? 'bg-emerald-500/20 text-emerald-500 dark:text-emerald-400 border border-emerald-500/30'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                All ({symbolData.trades?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setTradeStatusFilter('CLOSED')}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                  tradeStatusFilter === 'CLOSED'
                    ? 'bg-emerald-500/20 text-emerald-500 dark:text-emerald-400 border border-emerald-500/30'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Closed Exits ({symbolData.closedTrades || 0})
              </button>
              <button
                type="button"
                onClick={() => setTradeStatusFilter('BUY')}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                  tradeStatusFilter === 'BUY'
                    ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                Buy Entries ({buyTradesCount})
              </button>
            </div>
          </div>

          {/* Itemized Trade Logs Ledger for this Symbol */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-black uppercase tracking-wider text-inherit flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-cyan-400" />
                <span>Itemized Execution Ledger ({sortedTrades.length})</span>
              </h4>
              <span className="text-[11px] text-[var(--text-muted)]">
                Click any row for full trade dossier, notes & multi-tags
              </span>
            </div>

            <div className="rounded-2xl border border-[var(--border-color)] overflow-x-auto reports-card">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border-color)] text-[10px] uppercase font-bold text-[var(--text-muted)] reports-table-head select-none">
                    <th className="py-2.5 px-3 cursor-pointer hover:text-emerald-500 transition-colors" onClick={() => handleModalSort('date')}>
                      <div className="flex items-center gap-1">
                        <span>Date</span>
                        {modalSortField === 'date' ? (modalSortOrder === 'desc' ? <ArrowDown className="w-2.5 h-2.5 text-emerald-500" /> : <ArrowUp className="w-2.5 h-2.5 text-emerald-500" />) : <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
                      </div>
                    </th>
                    <th className="py-2.5 px-3 cursor-pointer hover:text-emerald-500 transition-colors" onClick={() => handleModalSort('type')}>
                      <div className="flex items-center gap-1">
                        <span>Type</span>
                        {modalSortField === 'type' ? (modalSortOrder === 'desc' ? <ArrowDown className="w-2.5 h-2.5 text-emerald-500" /> : <ArrowUp className="w-2.5 h-2.5 text-emerald-500" />) : <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
                      </div>
                    </th>
                    <th className="py-2.5 px-3 cursor-pointer hover:text-emerald-500 transition-colors" onClick={() => handleModalSort('holdingDays')}>
                      <div className="flex items-center gap-1">
                        <span>Duration / Term</span>
                        {modalSortField === 'holdingDays' ? (modalSortOrder === 'desc' ? <ArrowDown className="w-2.5 h-2.5 text-emerald-500" /> : <ArrowUp className="w-2.5 h-2.5 text-emerald-500" />) : <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
                      </div>
                    </th>
                    <th className="py-2.5 px-3 text-right cursor-pointer hover:text-emerald-500 transition-colors" onClick={() => handleModalSort('entryPrice')}>
                      <div className="flex items-center justify-end gap-1">
                        <span>Entry (FIFO)</span>
                        {modalSortField === 'entryPrice' ? (modalSortOrder === 'desc' ? <ArrowDown className="w-2.5 h-2.5 text-emerald-500" /> : <ArrowUp className="w-2.5 h-2.5 text-emerald-500" />) : <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
                      </div>
                    </th>
                    <th className="py-2.5 px-3 text-right cursor-pointer hover:text-emerald-500 transition-colors" onClick={() => handleModalSort('exitPrice')}>
                      <div className="flex items-center justify-end gap-1">
                        <span>Exit</span>
                        {modalSortField === 'exitPrice' ? (modalSortOrder === 'desc' ? <ArrowDown className="w-2.5 h-2.5 text-emerald-500" /> : <ArrowUp className="w-2.5 h-2.5 text-emerald-500" />) : <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
                      </div>
                    </th>
                    <th className="py-2.5 px-3 text-right cursor-pointer hover:text-emerald-500 transition-colors" onClick={() => handleModalSort('quantity')}>
                      <div className="flex items-center justify-end gap-1">
                        <span>Qty</span>
                        {modalSortField === 'quantity' ? (modalSortOrder === 'desc' ? <ArrowDown className="w-2.5 h-2.5 text-emerald-500" /> : <ArrowUp className="w-2.5 h-2.5 text-emerald-500" />) : <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
                      </div>
                    </th>
                    <th className="py-2.5 px-3 text-right cursor-pointer hover:text-emerald-500 transition-colors" onClick={() => handleModalSort('charges')}>
                      <div className="flex items-center justify-end gap-1">
                        <span>Charges</span>
                        {modalSortField === 'charges' ? (modalSortOrder === 'desc' ? <ArrowDown className="w-2.5 h-2.5 text-emerald-500" /> : <ArrowUp className="w-2.5 h-2.5 text-emerald-500" />) : <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
                      </div>
                    </th>
                    <th className="py-2.5 px-3 text-right cursor-pointer hover:text-emerald-500 transition-colors" onClick={() => handleModalSort('netPnl')}>
                      <div className="flex items-center justify-end gap-1">
                        <span>Net P&L</span>
                        {modalSortField === 'netPnl' ? (modalSortOrder === 'desc' ? <ArrowDown className="w-2.5 h-2.5 text-emerald-500" /> : <ArrowUp className="w-2.5 h-2.5 text-emerald-500" />) : <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
                      </div>
                    </th>
                    <th className="py-2.5 px-3 cursor-pointer hover:text-emerald-500 transition-colors" onClick={() => handleModalSort('tags')}>
                      <div className="flex items-center gap-1">
                        <span>Tags</span>
                        {modalSortField === 'tags' ? (modalSortOrder === 'desc' ? <ArrowDown className="w-2.5 h-2.5 text-emerald-500" /> : <ArrowUp className="w-2.5 h-2.5 text-emerald-500" />) : <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
                      </div>
                    </th>
                    <th className="py-2.5 px-3 cursor-pointer hover:text-emerald-500 transition-colors" onClick={() => handleModalSort('setup')}>
                      <div className="flex items-center gap-1">
                        <span>Setup</span>
                        {modalSortField === 'setup' ? (modalSortOrder === 'desc' ? <ArrowDown className="w-2.5 h-2.5 text-emerald-500" /> : <ArrowUp className="w-2.5 h-2.5 text-emerald-500" />) : <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
                      </div>
                    </th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-color)] font-mono">
                  {sortedTrades.map((trade) => {
                    const isClosed = trade.status === 'CLOSED';
                    const isWin = isClosed && trade.netPnl > 0;
                    const isLoss = isClosed && trade.netPnl < 0;
                    const isCorporateAction = trade.tradeType === 'BONUS' || trade.tradeType === 'SPLIT' || trade.status === 'CORPORATE_ACTION';
                    const isBuy = trade.tradeType === 'BUY';

                    return (
                      <tr
                        key={trade.id}
                        className="hover:bg-white/[0.04] cursor-pointer transition-colors"
                        onClick={() => setSelectedTradeDossier(trade)}
                      >
                        <td className="py-2.5 px-3 text-[var(--text-secondary)] font-sans whitespace-nowrap">{trade.date || trade.entryDate}</td>
                        <td className="py-2.5 px-3 font-sans whitespace-nowrap">
                          {trade.tradeType === 'BONUS' ? (
                            <span className="px-1.5 py-0.5 rounded-md border border-purple-500/30 bg-purple-500/10 text-purple-400 text-[10px] font-bold font-mono">
                              BONUS ISSUE
                            </span>
                          ) : trade.tradeType === 'SPLIT' ? (
                            <span className="px-1.5 py-0.5 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px] font-bold font-mono">
                              STOCK SPLIT
                            </span>
                          ) : isBuy || trade.status === 'OPEN' ? (
                            <span className="px-1.5 py-0.5 rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-400 text-[10px] font-bold font-mono">
                              BUY ENTRY
                            </span>
                          ) : isClosed ? (
                            <span className="px-1.5 py-0.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 text-[10px] font-bold font-mono">
                              CLOSED EXIT
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded-md border border-sky-500/30 bg-sky-500/10 text-sky-400 text-[10px] font-bold font-mono">
                              BUY ENTRY
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-sans whitespace-nowrap">
                          {isCorporateAction ? (
                            <span className="text-[10px] text-[var(--text-muted)] font-mono">Corp Action</span>
                          ) : isBuy ? (
                            <span className="text-[10px] text-[var(--text-muted)] font-mono">Entry Lot</span>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono text-[11px] text-[var(--text-secondary)] font-semibold">
                                {trade.holdingDays !== undefined && trade.holdingDays !== null ? `${trade.holdingDays}d` : '—'}
                              </span>
                              {trade.taxTerm && (
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                  trade.taxTerm === 'LTCG'
                                    ? 'border-purple-500/40 bg-purple-500/10 text-purple-400'
                                    : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400'
                                }`}>
                                  {trade.taxTerm}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right text-[var(--text-primary)] font-bold whitespace-nowrap">
                          {isCorporateAction ? '₹0.00' : (
                            <div>
                              <div>{formatVal(isUsdMode ? trade.entryPrice : (trade.entryPriceInr ?? trade.entryPrice))}</div>
                              {isUs && !isUsdMode && (trade.entryPrice || 0) > 0 && (
                                <div className="text-[9px] text-[var(--text-muted)] font-normal font-sans tracking-tight">
                                  ${trade.entryPrice?.toFixed(2)} @ ₹{(trade.entryFxRate || trade.fxRate || 0).toFixed(2)}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {isClosed ? (
                            <div>
                              <span className="text-[var(--text-primary)] font-bold">{formatVal(isUsdMode ? trade.exitPrice : (trade.exitPriceInr ?? trade.exitPrice))}</span>
                              {isUs && !isUsdMode && (trade.exitPrice || 0) > 0 && (
                                <div className="text-[9px] text-[var(--text-muted)] font-normal font-sans tracking-tight">
                                  ${trade.exitPrice?.toFixed(2)} @ ₹{(trade.exitFxRate || trade.fxRate || 0).toFixed(2)}
                                </div>
                              )}
                            </div>
                          ) : isBuy || isCorporateAction ? (
                            <span className="text-[var(--text-muted)]">—</span>
                          ) : (
                            <span className="text-cyan-500 dark:text-cyan-400 font-sans font-semibold text-[11px]">
                              Holding (CMP: {formatVal(isUsdMode ? (holding?.currentPrice || trade.entryPrice) : ((holding?.currentPrice || trade.entryPrice) * (trade.fxRate || 94.92)))})
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right text-[var(--text-primary)] font-bold whitespace-nowrap">
                          {trade.quantity}
                        </td>
                        <td className="py-2.5 px-3 text-right text-amber-500 dark:text-amber-400 whitespace-nowrap">
                          {isCorporateAction ? '—' : formatVal(isUsdMode ? trade.totalCharges : (trade.totalChargesInr ?? trade.totalCharges))}
                        </td>
                        <td className={`py-2.5 px-3 text-right font-black whitespace-nowrap ${
                          isClosed
                            ? ((isUsdMode ? trade.netPnl : (trade.netPnlInr ?? trade.netPnl)) >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400')
                            : ((holding?.unrealizedPnl ?? 0) >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400')
                        }`}>
                          {isClosed ? (
                            formatVal(isUsdMode ? trade.netPnl : (trade.netPnlInr ?? trade.netPnl))
                          ) : isBuy || isCorporateAction ? (
                            <span className="text-[var(--text-muted)] font-normal font-sans">—</span>
                          ) : holding?.unrealizedPnl !== undefined && holding?.unrealizedPnl !== null ? (
                            <span title="Unrealized Paper P&L">
                              {holding.unrealizedPnl >= 0 ? '+' : ''}{formatVal(isUsdMode ? holding.unrealizedPnl : (holding.unrealizedPnlInr || (holding.unrealizedPnl * 94.92)))} <span className="text-[9px] font-normal opacity-80">(Unr)</span>
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-sans">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {Array.isArray(trade.tags) && trade.tags.length > 0 ? (
                              trade.tags.map((t, idx) => (
                                <span key={idx} className="text-[10px] font-bold px-2 py-0.5 rounded-md border border-[var(--border-color)] bg-white/[0.04] text-[var(--text-secondary)] whitespace-nowrap shadow-sm">
                                  {t}
                                </span>
                              ))
                            ) : (
                              <span className="text-[10px] text-[var(--text-muted)] opacity-50">—</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-sans text-cyan-500 dark:text-cyan-400 font-bold whitespace-nowrap">{trade.setup || 'General'}</td>
                        <td className="py-2.5 px-3 text-right font-sans" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => onEditTrade(trade)}
                              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors cursor-pointer"
                              title="Edit trade"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteTrade(trade.id, `${trade.symbol} (${trade.date})`)}
                              className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer"
                              title="Delete trade"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  </motion.div>

      {/* Trade Dossier Modal */}
      {selectedTradeDossier && (
        <TradeDetailModal
          trade={selectedTradeDossier}
          onClose={() => setSelectedTradeDossier(null)}
          onEdit={(t) => {
            setSelectedTradeDossier(null);
            onEditTrade(t);
          }}
          onDelete={(id) => {
            setSelectedTradeDossier(null);
            if (onRefresh) onRefresh();
          }}
          onRefresh={onRefresh}
        />
      )}
    </div>,
    document.body
  );
}
