import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Edit3,
  Trash2,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Layers,
  Calendar,
  DollarSign,
  Tag,
  Smile,
  Target,
  Sparkles,
  Percent,
  Plus,
  Check,
  Save,
  BarChart3,
  FileSpreadsheet
} from 'lucide-react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';
import GoChartingView from './GoChartingView';
import StockFinancialsView from './StockFinancialsView';

const AVAILABLE_TAGS = [
  'Followed Plan',
  'Patient Entry',
  'Cut Loss Fast',
  'Let Winner Run',
  'A+ Setup',
  'Breakout Buy',
  'Stage 2 Bull',
  'FOMO Entry',
  'Chased Price',
  'Revenge Trade',
  'Early Exit',
  'Moved Stop-Loss',
  'Over-leveraged',
  'Ignored Setup'
];

export default function TradeDetailModal({ trade, onClose, onEdit, onDelete, onRefresh }) {
  const { currency, formatMoney } = useThemeAuth();
  const [activeViewTab, setActiveViewTab] = useState('ORDER'); // 'ORDER' | 'CHART' | 'FINANCIALS'
  const [isDeleting, setIsDeleting] = useState(false);
  const [notes, setNotes] = useState(trade?.notes || '');
  const [tags, setTags] = useState(Array.isArray(trade?.tags) ? trade.tags : []);
  const [customTagInput, setCustomTagInput] = useState('');
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [entrySnapshot, setEntrySnapshot] = useState(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);

  const isUs = trade?.market === 'US';
  const isSell = trade?.tradeType === 'SELL' || trade?.status === 'CLOSED';
  const txDate = isSell ? (trade?.exitDate || trade?.date) : (trade?.date || trade?.entryDate);
  const txPrice = isSell ? (trade?.exitPrice || trade?.entryPrice) : (trade?.entryPrice || trade?.price);
  const txQty = Number(trade?.quantity) || 0;
  const txValue = isSell 
    ? (Number(trade?.saleProceedsInr || trade?.saleProceeds || (txPrice * txQty)) || (txPrice * txQty))
    : (Number(trade?.costBasisInr || trade?.costBasis || (txPrice * txQty)) || (txPrice * txQty));
  const txType = isSell ? 'SELL' : (trade?.tradeType || 'BUY');

  useEffect(() => {
    if (!trade?.symbol) return;
    const fetchSnapshot = async () => {
      setLoadingSnapshot(true);
      try {
        const res = await axios.get(`/api/trading-journal/entry-snapshot/${trade.symbol}`, {
          params: {
            date: txDate,
            price: txPrice,
            quantity: txQty,
            value: txValue,
            tradeType: txType,
            market: trade.market || (isUs ? 'US' : 'IN')
          }
        });
        if (res.data?.success) {
          setEntrySnapshot(res.data);
        }
      } catch (err) {
        console.warn('[TradeDetailModal] Could not load entry snapshot:', err.message);
      } finally {
        setLoadingSnapshot(false);
      }
    };
    fetchSnapshot();
  }, [trade?.symbol, txDate, txPrice, txQty, txValue, txType, isUs]);

  if (!trade) return null;

  const isUsdMode = isUs && currency === 'USD';
  const formatVal = (val, forceUsd = false) => {
    if (val === undefined || val === null || isNaN(Number(val))) return (isUsdMode || forceUsd) ? '$0.00' : '₹0.00';
    if (isUsdMode || forceUsd) {
      return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return '₹' + Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const isClosed = trade.status === 'CLOSED';
  const isWinner = isClosed && trade.netPnl > 0;
  const isLoser = isClosed && trade.netPnl < 0;

  const handleDelete = async () => {
    const confirmName = `${trade.symbol} (${trade.date || trade.entryDate})`;
    if (!window.confirm(`Are you sure you want to delete trade "${confirmName}"? This cannot be undone.`)) {
      return;
    }
    setIsDeleting(true);
    try {
      await axios.delete(`/api/trading-journal/${trade.id}`);
      if (onDelete) onDelete(trade.id);
      if (onRefresh) onRefresh();
      onClose();
    } catch (err) {
      alert('Failed to delete trade: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSaveNotesAndTags = async (updatedTags = tags, updatedNotes = notes) => {
    setIsSaving(true);
    setSaveStatus('');
    try {
      await axios.patch(`/api/trading-journal/${trade.id}/notes-tags`, {
        notes: updatedNotes,
        tags: updatedTags
      });
      trade.notes = updatedNotes;
      trade.tags = updatedTags;
      setSaveStatus('✓ Saved & Synced');
      setTimeout(() => setSaveStatus(''), 3000);
      if (onRefresh) onRefresh();
    } catch (err) {
      alert('Failed to save notes and tags: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleTag = (tag) => {
    let nextTags;
    if (tags.includes(tag)) {
      nextTags = tags.filter(t => t !== tag);
    } else {
      nextTags = [...tags, tag];
    }
    setTags(nextTags);
    handleSaveNotesAndTags(nextTags, notes);
  };

  const handleAddCustomTag = (e) => {
    if (e) e.preventDefault();
    const trimmed = customTagInput.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    const nextTags = [...tags, trimmed];
    setTags(nextTags);
    setCustomTagInput('');
    setIsAddingTag(false);
    handleSaveNotesAndTags(nextTags, notes);
  };

  const handleRemoveTag = (tagToRemove) => {
    const nextTags = tags.filter(t => t !== tagToRemove);
    setTags(nextTags);
    handleSaveNotesAndTags(nextTags, notes);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2 }}
        className={`modal-surface reports-card rounded-3xl border border-[var(--border-color)] shadow-2xl w-full ${
          activeViewTab === 'ORDER' ? 'max-w-2xl' : 'max-w-4xl xl:max-w-5xl'
        } overflow-hidden my-auto max-h-[92vh] flex flex-col transition-all duration-200`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] reports-subcard">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-2xl border ${
              isWinner
                ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-500 dark:text-emerald-400'
                : isLoser
                ? 'bg-rose-500/15 border-rose-500/30 text-rose-500 dark:text-rose-400'
                : 'reports-subcard border-[var(--border-color)] text-[var(--text-muted)]'
            }`}>
              {isWinner ? <TrendingUp className="w-5 h-5" /> : isLoser ? <TrendingDown className="w-5 h-5" /> : <Layers className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-xl font-black text-inherit tracking-tight">{trade.symbol}</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-[var(--border-color)] reports-subcard text-[var(--text-secondary)]">
                  {trade.segment?.replace('IN_', '')?.replace('US_', '')}
                </span>
                <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                  trade.status === 'CLOSED'
                    ? isWinner
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                      : isLoser
                      ? 'border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-300'
                      : 'border-[var(--border-color)] reports-subcard text-[var(--text-muted)]'
                    : 'border-cyan-500/40 bg-cyan-500/15 text-cyan-600 dark:text-cyan-300'
                }`}>
                  {trade.status}
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] font-medium">{trade.name || trade.symbol}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                if (onEdit) onEdit(trade);
              }}
              className="p-2 rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors cursor-pointer"
              title="Edit Trade"
            >
              <Edit3 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="p-2 rounded-xl text-rose-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
              title="Delete Trade"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Top Mode Switcher Bar */}
        <div className="flex items-center gap-2 px-6 py-2.5 border-b border-[var(--border-color)] reports-subcard overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveViewTab('ORDER')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeViewTab === 'ORDER'
                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Order & Charges</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveViewTab('CHART')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeViewTab === 'CHART'
                ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Technical Chart (GoCharting 1D)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveViewTab('FINANCIALS')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeViewTab === 'FINANCIALS'
                ? 'bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-500/40 shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Quarterly Results & P&L</span>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {activeViewTab === 'CHART' ? (
            <GoChartingView
              symbol={trade.symbol}
              name={trade.name}
              market={trade.market}
              executionPrice={txPrice}
              executionDate={txDate}
              executionValue={txValue}
              executionQty={txQty}
              tradeType={txType}
            />
          ) : activeViewTab === 'FINANCIALS' ? (
            <StockFinancialsView
              symbol={trade.symbol}
              name={trade.name}
              market={trade.market}
            />
          ) : (
            <>
              {/* Hero P&L Banner */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="reports-subcard p-3 rounded-2xl border border-[var(--border-color)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Gross P&L</span>
              <span className={`text-base font-black font-mono ${
                (isUsdMode ? trade.grossPnl : (trade.grossPnlInr ?? trade.grossPnl)) >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'
              }`}>
                {isClosed ? formatVal(isUsdMode ? trade.grossPnl : (trade.grossPnlInr ?? trade.grossPnl)) : '—'}
              </span>
            </div>

            <div className="reports-subcard p-3 rounded-2xl border border-[var(--border-color)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">Statutory Charges</span>
              <span className="text-base font-black font-mono text-amber-500 dark:text-amber-300">
                {formatVal(isUsdMode ? trade.totalCharges : (trade.totalChargesInr ?? trade.totalCharges))}
              </span>
            </div>

            <div className="reports-subcard p-3 rounded-2xl border border-cyan-500/40 bg-cyan-500/10">
              <span className="text-[10px] uppercase font-bold text-cyan-600 dark:text-cyan-300 block">Net Realized P&L</span>
              <span className={`text-base font-black font-mono ${
                (isUsdMode ? trade.netPnl : (trade.netPnlInr ?? trade.netPnl)) >= 0 ? 'text-emerald-500 dark:text-emerald-300' : 'text-rose-500 dark:text-rose-300'
              }`}>
                {isClosed ? formatVal(isUsdMode ? trade.netPnl : (trade.netPnlInr ?? trade.netPnl)) : '—'}
              </span>
            </div>

            <div className="reports-subcard p-3 rounded-2xl border border-[var(--border-color)]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] block">ROI %</span>
              <span className={`text-base font-black font-mono ${
                (isUsdMode ? trade.roiPct : (trade.roiPctInr ?? trade.roiPct)) >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'
              }`}>
                {isClosed ? `${(isUsdMode ? trade.roiPct : (trade.roiPctInr ?? trade.roiPct)) >= 0 ? '+' : ''}${(isUsdMode ? trade.roiPct : (trade.roiPctInr ?? trade.roiPct))?.toFixed(2)}%` : '—'}
              </span>
            </div>
          </div>

          {/* Execution Specs & Breakeven */}
          <div className="p-4 rounded-2xl reports-subcard border border-[var(--border-color)] space-y-3">
            <span className="text-xs font-black uppercase tracking-wider text-[var(--text-primary)] flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-500" /> Order Parameters & Breakeven
            </span>

            {isUs && (
              <div className="p-2.5 rounded-xl border border-[var(--border-color)] bg-white/[0.02] flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                <span className="text-[var(--text-secondary)] font-sans text-[11px]">Trade Date FX Rates:</span>
                <span className="text-cyan-500 dark:text-cyan-400 font-bold text-[11px]">
                  Entry: ₹{(trade.entryFxRate || trade.fxRate || 0).toFixed(2)}/$ {trade.exitFxRate ? `| Exit: ₹${(trade.exitFxRate).toFixed(2)}/$` : ''}
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
              <div>
                <span className="text-[10px] text-[var(--text-muted)] block font-sans">Type & Quantity</span>
                <span className="font-bold text-inherit">{trade.tradeType} {trade.quantity} units</span>
              </div>
              <div>
                <span className="text-[10px] text-[var(--text-muted)] block font-sans">Entry Price</span>
                <span className="font-bold text-inherit">{formatVal(isUsdMode ? trade.entryPrice : (trade.entryPriceInr ?? trade.entryPrice))}</span>
              </div>
              <div>
                <span className="text-[10px] text-[var(--text-muted)] block font-sans">Exit Price</span>
                <span className="font-bold text-inherit">{trade.exitPrice ? formatVal(isUsdMode ? trade.exitPrice : (trade.exitPriceInr ?? trade.exitPrice)) : 'Open'}</span>
              </div>
              <div>
                <span className="text-[10px] text-[var(--text-muted)] block font-sans">Breakeven Exit</span>
                <span className="font-bold text-cyan-500 dark:text-cyan-300">{formatVal(isUsdMode ? trade.breakevenExit : ((trade.breakevenExit || 0) * (trade.entryFxRate || trade.fxRate || 94.92)))}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono pt-2 border-t border-[var(--border-color)]">
              <div>
                <span className="text-[10px] text-[var(--text-muted)] block font-sans">Entry Date</span>
                <span className="text-[var(--text-secondary)]">{trade.entryDate || trade.date}</span>
              </div>
              <div>
                <span className="text-[10px] text-[var(--text-muted)] block font-sans">Exit Date</span>
                <span className="text-[var(--text-secondary)]">{trade.exitDate || '—'}</span>
              </div>
              <div>
                <span className="text-[10px] text-[var(--text-muted)] block font-sans">Target Price</span>
                <span className="text-emerald-500 dark:text-emerald-400">{trade.targetPrice ? formatVal(trade.targetPrice) : '—'}</span>
              </div>
              <div>
                <span className="text-[10px] text-[var(--text-muted)] block font-sans">Stop Loss</span>
                <span className="text-rose-500 dark:text-rose-400">{trade.stopLossPrice ? formatVal(trade.stopLossPrice) : '—'}</span>
              </div>
            </div>
          </div>

          {/* Transaction Entry Snapshot: Technicals & Screener Fundamentals */}
          <div className="p-4 rounded-2xl reports-subcard border border-cyan-500/30 bg-cyan-500/[0.03] space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black uppercase tracking-wider text-cyan-600 dark:text-cyan-400 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Snapshot ({txDate})
                </span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${
                  txType === 'SELL' 
                    ? 'bg-rose-500/20 text-rose-500 dark:text-rose-400 border-rose-500/30'
                    : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                }`}>
                  {txType}
                </span>
                {txPrice && (
                  <span className="font-mono text-xs font-bold text-[var(--text-primary)]">
                    @{formatVal(txPrice)}
                  </span>
                )}
                {txQty > 0 && (
                  <span className="font-mono text-xs text-[var(--text-secondary)]">
                    × {txQty} shares
                  </span>
                )}
                {txValue > 0 && (
                  <span className="px-2 py-0.5 rounded-lg bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-mono font-bold text-xs border border-cyan-500/30">
                    Value: {formatVal(txValue)}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                {entrySnapshot?.fundamentals?.activeQuarter ? `Active: ${entrySnapshot.fundamentals.activeQuarter}` : 'At Transaction Date'}
              </span>
            </div>

            {loadingSnapshot ? (
              <div className="py-4 text-center text-xs text-[var(--text-muted)] animate-pulse">
                Loading transaction entry snapshot...
              </div>
            ) : entrySnapshot ? (
              <div className="space-y-3">
                {/* 1. Screener Fundamentals Grid */}
                {entrySnapshot.fundamentals && (
                  <div className="space-y-1.5">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block">
                      Screener Fundamentals
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-center text-xs font-mono">
                      <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                        <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">P/E Ratio</span>
                        <span className="font-bold text-[var(--text-primary)]">
                          {entrySnapshot.fundamentals.entryPe ? `${entrySnapshot.fundamentals.entryPe.toFixed(1)}x` : (entrySnapshot.fundamentals.peRatio ? `${entrySnapshot.fundamentals.peRatio.toFixed(1)}x` : '—')}
                        </span>
                      </div>
                      <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                        <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">Sales</span>
                        <span className="font-bold text-[var(--text-primary)]">
                          {entrySnapshot.fundamentals.salesCr ? `${isUs ? '$' : '₹'}${entrySnapshot.fundamentals.salesCr.toLocaleString()}${isUs ? 'M' : ' Cr'}` : '—'}
                        </span>
                      </div>
                      <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                        <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">PAT (Net Profit)</span>
                        <span className={`font-bold ${entrySnapshot.fundamentals.patCr >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                          {entrySnapshot.fundamentals.patCr ? `${isUs ? '$' : '₹'}${entrySnapshot.fundamentals.patCr.toLocaleString()}${isUs ? 'M' : ' Cr'}` : '—'}
                        </span>
                      </div>
                      <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                        <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">Market Cap</span>
                        <span className="font-bold text-[var(--text-primary)]">
                          {entrySnapshot.fundamentals.marketCapCr ? `${isUs ? '$' : '₹'}${entrySnapshot.fundamentals.marketCapCr.toLocaleString()}${isUs ? 'M' : ' Cr'}` : '—'}
                        </span>
                      </div>
                      <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                        <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">OPM %</span>
                        <span className="font-bold text-[var(--text-primary)]">
                          {entrySnapshot.fundamentals.opmPct !== null && entrySnapshot.fundamentals.opmPct !== undefined ? `${entrySnapshot.fundamentals.opmPct.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                        <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">ROCE %</span>
                        <span className="font-bold text-[var(--text-primary)]">
                          {entrySnapshot.fundamentals.rocePct !== null && entrySnapshot.fundamentals.rocePct !== undefined ? `${entrySnapshot.fundamentals.rocePct.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                        <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">ROE %</span>
                        <span className="font-bold text-[var(--text-primary)]">
                          {entrySnapshot.fundamentals.roePct !== null && entrySnapshot.fundamentals.roePct !== undefined ? `${entrySnapshot.fundamentals.roePct.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Technicals Grid at Trade Date */}
                {entrySnapshot.technicals && (
                  <div className="space-y-1.5 pt-2 border-t border-[var(--border-color)]">
                    <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block">
                      Technicals at Entry Date
                    </span>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs font-mono">
                      <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                        <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">Day Close</span>
                        <span className="font-bold text-[var(--text-primary)]">
                          {formatVal(entrySnapshot.technicals.close)}
                        </span>
                      </div>
                      <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                        <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">21 EMA</span>
                        <span className="font-bold text-[#3B82F6]">
                          {formatVal(entrySnapshot.technicals.ema21)}
                        </span>
                        {entrySnapshot.technicals.aboveEma21 !== null && (
                          <span className={`text-[8px] block font-sans font-bold ${entrySnapshot.technicals.aboveEma21 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {entrySnapshot.technicals.aboveEma21 ? '▲ Above' : '▼ Below'}
                          </span>
                        )}
                      </div>
                      <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                        <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">50 EMA</span>
                        <span className="font-bold text-[#EAB308]">
                          {formatVal(entrySnapshot.technicals.ema50)}
                        </span>
                        {entrySnapshot.technicals.aboveEma50 !== null && (
                          <span className={`text-[8px] block font-sans font-bold ${entrySnapshot.technicals.aboveEma50 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {entrySnapshot.technicals.aboveEma50 ? '▲ Above' : '▼ Below'}
                          </span>
                        )}
                      </div>
                      <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                        <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">200 EMA</span>
                        <span className="font-bold text-purple-600 dark:text-purple-300">
                          {formatVal(entrySnapshot.technicals.ema200)}
                        </span>
                        {entrySnapshot.technicals.distEma200Pct !== null && (
                          <span className={`text-[8px] block font-sans font-bold ${entrySnapshot.technicals.distEma200Pct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {entrySnapshot.technicals.distEma200Pct >= 0 ? `+${entrySnapshot.technicals.distEma200Pct}%` : `${entrySnapshot.technicals.distEma200Pct}%`}
                          </span>
                        )}
                      </div>
                      <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                        <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">RSI (10)</span>
                        <span className="font-bold text-[#EF4444]">
                          {entrySnapshot.technicals.rsi10 ?? '—'}
                        </span>
                        {entrySnapshot.technicals.rsi10 !== null && entrySnapshot.technicals.rsi10 !== undefined && (
                          <span className={`text-[8px] block font-sans font-bold ${
                            entrySnapshot.technicals.rsi10 >= 70 ? 'text-rose-500' : entrySnapshot.technicals.rsi10 <= 30 ? 'text-emerald-500' : 'text-cyan-500'
                          }`}>
                            {entrySnapshot.technicals.rsi10 >= 70 ? 'Overbought' : entrySnapshot.technicals.rsi10 <= 30 ? 'Oversold' : 'Neutral'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-[var(--text-muted)] italic">
                Snapshot not available for this ticker on {trade.entryDate || trade.date}.
              </p>
            )}
          </div>

          {/* Detailed Statutory Charges Breakdown */}
          <div className="p-4 rounded-2xl reports-subcard border border-[var(--border-color)] space-y-2">
            <span className="text-xs font-black uppercase tracking-wider text-amber-500 dark:text-amber-400 flex items-center gap-1.5">
              <Percent className="w-3.5 h-3.5" /> {isUs ? 'US Regulatory Cost Itemization' : 'Statutory Cost Itemization (Buy & Sell Leg)'}
            </span>

            {isUs ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-center text-xs font-mono pt-1">
                <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">Commission</span>
                  <span className="font-bold text-[var(--text-primary)]">$0.00</span>
                </div>
                <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">SEC & FINRA</span>
                  <span className="font-bold text-[var(--text-primary)]">${trade.exchangeCharges?.toFixed(2) || '0.00'}</span>
                </div>
                <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">Total Costs</span>
                  <span className="font-bold text-amber-500">${trade.totalCharges?.toFixed(2) || '0.00'}</span>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-center text-xs font-mono pt-1">
                <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">Brokerage</span>
                  <span className="font-bold text-[var(--text-primary)]">₹{trade.brokerage?.toFixed(2) || '0.00'}</span>
                </div>
                <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">STT (0.1%)</span>
                  <span className="font-bold text-[var(--text-primary)]">₹{trade.stt?.toFixed(2) || '0.00'}</span>
                </div>
                <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">Exchange</span>
                  <span className="font-bold text-[var(--text-primary)]">₹{trade.exchangeCharges?.toFixed(2) || '0.00'}</span>
                </div>
                <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">DP + GST</span>
                  <span className="font-bold text-amber-500" title="₹13.00 CDSL fee + ₹2.34 GST on sell leg">₹{trade.dpCharges ? trade.dpCharges.toFixed(2) : (trade.exitPrice > 0 ? '15.34' : '0.00')}</span>
                </div>
                <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">GST (18%)</span>
                  <span className="font-bold text-[var(--text-primary)]">₹{trade.gst?.toFixed(2) || '0.00'}</span>
                </div>
                <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">Stamp Duty</span>
                  <span className="font-bold text-[var(--text-primary)]">₹{trade.stampDuty?.toFixed(2) || '0.00'}</span>
                </div>
                <div className="p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <span className="text-[8px] text-[var(--text-muted)] uppercase block font-sans">SEBI Fee</span>
                  <span className="font-bold text-[var(--text-primary)]">₹{trade.sebiCharges?.toFixed(2) || '0.00'}</span>
                </div>
              </div>
            )}
          </div>

          {/* Strategy, Discipline & Psychology */}
          <div className="p-4 rounded-2xl reports-subcard border border-[var(--border-color)] space-y-3">
            <span className="text-xs font-black uppercase tracking-wider text-purple-500 dark:text-purple-400 flex items-center gap-1.5">
              <Smile className="w-3.5 h-3.5" /> Psychology & Discipline Audit
            </span>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-[10px] text-[var(--text-muted)] block font-bold uppercase">Setup / Strategy</span>
                <span className="font-bold text-inherit">{trade.setup || 'General'}</span>
              </div>
              <div>
                <span className="text-[10px] text-[var(--text-muted)] block font-bold uppercase">Timeframe</span>
                <span className="font-bold text-inherit">{trade.timeframe || 'Daily'}</span>
              </div>
              <div>
                <span className="text-[10px] text-[var(--text-muted)] block font-bold uppercase">Emotion at Entry</span>
                <span className="font-bold text-purple-500 dark:text-purple-300">{trade.emotions || 'Disciplined'}</span>
              </div>
              <div>
                <span className="text-[10px] text-[var(--text-muted)] block font-bold uppercase">Rule Compliance</span>
                <span className={`font-bold flex items-center gap-1 ${
                  trade.discipline ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'
                }`}>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {trade.discipline ? 'Plan Respected' : 'Rule Broken'}
                </span>
              </div>
            </div>

            {/* Interactive Multi-Tags Management */}
            <div className="pt-3 border-t border-[var(--border-color)] space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-[10px] text-[var(--text-muted)] font-bold uppercase flex items-center gap-1">
                  <Tag className="w-3 h-3 text-cyan-500" /> Multi-Tags & Psychology Tags ({tags.length})
                </span>
                <button
                  type="button"
                  onClick={() => setIsAddingTag(!isAddingTag)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg reports-subcard border border-[var(--border-color)] text-[10px] font-bold text-cyan-600 dark:text-cyan-400 hover:border-cyan-500/40 transition-colors cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>{isAddingTag ? 'Done Tagging' : '+ Add Tag'}</span>
                </button>
              </div>

              {/* Tag Chips */}
              <div className="flex flex-wrap gap-1.5 min-h-6">
                {tags.map((tag, i) => {
                  const isMistake = ['FOMO Entry', 'Chased Price', 'Revenge Trade', 'Early Exit', 'Moved Stop-Loss', 'Over-leveraged', 'Ignored Setup'].includes(tag);
                  return (
                    <span
                      key={i}
                      className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                        isMistake
                          ? 'bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-300'
                          : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-300'
                      }`}
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:opacity-75 cursor-pointer ml-0.5"
                        title="Remove tag"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
                {tags.length === 0 && (
                  <span className="text-xs text-[var(--text-muted)] italic">No tags attached. Click "+ Add Tag" to label this trade.</span>
                )}
              </div>

              {/* Quick Tag Selector Picker Drawer */}
              <AnimatePresence>
                {isAddingTag && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="p-3 rounded-xl reports-subcard border border-[var(--border-color)] space-y-2.5 overflow-hidden"
                  >
                    <div className="text-[10px] font-bold uppercase text-[var(--text-muted)]">Select from Quick Badges:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {AVAILABLE_TAGS.map(t => {
                        const isSelected = tags.includes(t);
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => handleToggleTag(t)}
                            className={`px-2 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
                              isSelected
                                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
                                : 'reports-subcard border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-emerald-500/30'
                            }`}
                          >
                            {isSelected ? `✓ ${t}` : `+ ${t}`}
                          </button>
                        );
                      })}
                    </div>

                    {/* Custom Tag Input */}
                    <div className="flex items-center gap-2 pt-1 border-t border-[var(--border-color)]">
                      <input
                        type="text"
                        value={customTagInput}
                        onChange={(e) => setCustomTagInput(e.target.value)}
                        placeholder="Add custom tag (e.g. Gap Up, Earnings Beat)..."
                        onKeyDown={(e) => e.key === 'Enter' && handleAddCustomTag(e)}
                        className="flex-1 px-3 py-1.5 rounded-lg reports-subcard border border-[var(--border-color)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-cyan-500/50"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomTag}
                        className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer transition-colors"
                      >
                        Add Tag
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Dedicated Trade Notes & Journal Reflection (Editable In-Place) */}
          <div className="p-4 rounded-2xl reports-subcard border border-[var(--border-color)] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                <Edit3 className="w-3.5 h-3.5 text-emerald-500" /> Trade Rationale & Journal Notes
              </span>
              {saveStatus && (
                <span className="text-xs font-bold text-emerald-500 dark:text-emerald-400 animate-pulse">
                  {saveStatus}
                </span>
              )}
            </div>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Write your trade reasoning, setup thoughts, execution errors, or key lessons learned here..."
              rows={3}
              className="w-full p-3 rounded-xl reports-subcard border border-[var(--border-color)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-emerald-500/50 resize-y leading-relaxed"
            />

            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => handleSaveNotesAndTags(tags, notes)}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer shadow-sm transition-all disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Saving...' : 'Save Note'}</span>
              </button>
            </div>
          </div>

          {/* Chart Screenshot Preview */}
          {trade.chartUrl && (
            <div className="p-4 rounded-2xl reports-subcard border border-[var(--border-color)] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  Chart Screenshot & Technicals
                </span>
                <a
                  href={trade.chartUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-cyan-500 dark:text-cyan-400 hover:underline flex items-center gap-1"
                >
                  Open Full <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="rounded-xl overflow-hidden border border-[var(--border-color)] max-h-60 reports-subcard flex items-center justify-center">
                <img
                  src={trade.chartUrl}
                  alt="Trade Chart"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
      </motion.div>
    </div>,
    document.body
  );
}
