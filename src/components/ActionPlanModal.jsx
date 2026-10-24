import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Download,
  Sparkles,
  TrendingUp,
  ShieldAlert,
  Wallet,
  RotateCw,
  Save,
  CheckCircle2,
  Clock,
  ArrowRight
} from 'lucide-react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';

export default function ActionPlanModal({ isOpen, onClose }) {
  const { user } = useThemeAuth();
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [error, setError] = useState(null);

  // Configuration state
  const [externalCash, setExternalCash] = useState(200000);
  const [recyclingMode, setRecyclingMode] = useState('FULL_AND_TRIMS');
  const [activeTab, setActiveTab] = useState('BUYS'); // 'BUYS' | 'QUEUED' | 'SELLS'

  // Plan data
  const [plan, setPlan] = useState(null);

  const fetchPlan = useCallback(async (cash = externalCash, mode = recyclingMode) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/stock-intelligence/action-plan', {
        params: {
          externalCash: cash,
          recyclingMode: mode
        }
      });
      setPlan(res.data);
      if (res.data?.summary) {
        if (res.data.summary.externalCashBudget !== undefined) {
          setExternalCash(res.data.summary.externalCashBudget);
        }
        if (res.data.summary.recyclingMode) {
          setRecyclingMode(res.data.summary.recyclingMode);
        }
      }
    } catch (err) {
      console.error('[ActionPlanModal] Fetch error:', err);
      setError(err.response?.data?.error || err.message || 'Failed to generate action plan');
    } finally {
      setLoading(false);
    }
  }, [externalCash, recyclingMode]);

  useEffect(() => {
    if (isOpen) {
      fetchPlan();
    }
  }, [isOpen]);

  const handleCashChange = (newVal) => {
    const valid = Math.max(0, Math.round(Number(newVal) || 0));
    setExternalCash(valid);
    fetchPlan(valid, recyclingMode);
  };

  const handleModeChange = (newMode) => {
    setRecyclingMode(newMode);
    fetchPlan(externalCash, newMode);
  };

  const handleSaveDefaults = async () => {
    setSavingConfig(true);
    setSaveStatus('');
    try {
      await axios.post('/api/stock-intelligence/config', {
        externalCashBudget: externalCash,
        periodicIncrement: externalCash,
        recyclingMode
      });
      setSaveStatus('✓ Saved as Default');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      alert('Failed to save settings: ' + (err.response?.data?.error || err.message));
    } finally {
      setSavingConfig(false);
    }
  };

  const handleDownloadCsv = async () => {
    setDownloading(true);
    try {
      const res = await axios.get('/api/stock-intelligence/action-plan-csv', {
        params: {
          externalCash,
          recyclingMode
        },
        responseType: 'blob'
      });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const todayStr = plan?.today || new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `ladder_action_plan_${todayStr}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert('Failed to download CSV: ' + (err.response?.data?.error || err.message));
    } finally {
      setDownloading(false);
    }
  };

  if (!isOpen) return null;

  const summary = plan?.summary || {};
  const immediateBuys = plan?.immediateBuys || [];
  const queuedBuys = plan?.queuedBuys || [];
  const sells = plan?.sells || [];

  const formatInr = (val) => {
    const num = Number(val) || 0;
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };

  const formatInr2 = (val) => {
    const num = Number(val) || 0;
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2 }}
        className="modal-surface reports-card rounded-3xl border border-[var(--border-color)] shadow-2xl w-full max-w-5xl overflow-hidden my-auto max-h-[94vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] reports-subcard">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/15 border border-emerald-500/30 rounded-2xl text-emerald-500 dark:text-emerald-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-black text-[var(--text-primary)]">
                  Next Market Day Action Plan
                </h3>
                <span className="px-2 py-0.5 text-xs font-mono font-bold rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">
                  {summary.today || 'LIVE'}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-bg)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-5">
          {/* Capital Allocation & Scaling Controls */}
          <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-600 dark:text-cyan-400">
                  <Wallet className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[var(--text-primary)]">
                    External Bank Capital & Increment Setting
                  </h4>
                </div>
              </div>

              {/* Quick Presets & Controls */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleCashChange(150000)}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                    externalCash === 150000
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-600 dark:text-emerald-300'
                      : 'border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  ₹1.5 Lakhs
                </button>
                <button
                  type="button"
                  onClick={() => handleCashChange(200000)}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                    externalCash === 200000
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-600 dark:text-emerald-300'
                      : 'border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  ₹2.0 Lakhs
                </button>
                <button
                  type="button"
                  onClick={() => handleCashChange(Math.max(0, externalCash - 25000))}
                  className="px-2 py-1 text-xs font-mono font-bold rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  title="Decrease by ₹25,000"
                >
                  -₹25k
                </button>
                <button
                  type="button"
                  onClick={() => handleCashChange(externalCash + 25000)}
                  className="px-2 py-1 text-xs font-mono font-bold rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                  title="Increase by ₹25,000"
                >
                  +₹25k
                </button>

                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-muted)]">₹</span>
                  <input
                    type="number"
                    step="5000"
                    min="0"
                    value={externalCash}
                    onChange={(e) => handleCashChange(e.target.value)}
                    className="w-28 pl-6 pr-2 py-1 text-xs font-mono font-bold rounded-lg bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSaveDefaults}
                  disabled={savingConfig}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-600 dark:text-cyan-400 hover:border-cyan-500/60 cursor-pointer disabled:opacity-50"
                  title="Save current capital budget as periodic target"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saveStatus || 'Save Default'}</span>
                </button>
              </div>
            </div>

            {/* Mode Switcher */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--border-color)]">
              <span className="text-xs font-bold text-[var(--text-muted)]">
                Capital Recycling Mode:
              </span>
              <div className="flex items-center gap-1.5 p-1 rounded-xl border border-[var(--border-color)] bg-[var(--surface-color)]">
                <button
                  type="button"
                  onClick={() => handleModeChange('FULL_AND_TRIMS')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    recyclingMode === 'FULL_AND_TRIMS'
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                  title="Recycle proceeds from both structural Full Exits and defensive Trims"
                >
                  Full Exits + Defensive Trims
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('FULL_ONLY')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    recyclingMode === 'FULL_ONLY'
                      ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border border-cyan-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                  title="Only recycle structural 30W-SMA breakdowns; leave partial trims untouched"
                >
                  Full Exits Only
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('EXTERNAL_ONLY')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    recyclingMode === 'EXTERNAL_ONLY'
                      ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                  title="Keep 100% of holdings untouched; deploy only fresh external bank cash"
                >
                  Bank Cash Only (Zero Sells)
                </button>
              </div>
            </div>
          </div>

          {/* Capital Flow Strip (5 KPIs) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3">
              <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">
                External Bank Cash
              </span>
              <span className="text-base sm:text-lg font-black font-mono text-cyan-600 dark:text-cyan-400 mt-1 block">
                {formatInr(summary.externalCashBudget)}
              </span>
            </div>

            <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">
                  Recycled Capital
                </span>
                {summary.realizedRecycledCapital > 0 && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30">
                    Realized Exits
                  </span>
                )}
              </div>
              <span className="text-base sm:text-lg font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1 block">
                +{formatInr(summary.recycledCapital)}
              </span>
              <div className="mt-1 text-[10px] text-[var(--text-muted)] leading-tight space-y-0.5">
                <div>Realized (21-Oct+): <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{formatInr(summary.realizedRecycledCapital)}</span></div>
                {summary.projectedRecycledCapital > 0 && (
                  <div>Projected Trims: <span className="font-mono font-semibold text-[var(--text-primary)]">+{formatInr(summary.projectedRecycledCapital)}</span></div>
                )}
              </div>
            </div>

            <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3">
              <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">
                Total Purchasing Power
              </span>
              <span className="text-base sm:text-lg font-black font-mono text-[var(--text-primary)] mt-1 block">
                {formatInr(summary.totalPurchasingPower)}
              </span>
            </div>

            <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3">
              <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">
                Allocated to Buys
              </span>
              <span className="text-base sm:text-lg font-black font-mono text-purple-600 dark:text-purple-400 mt-1 block">
                {formatInr(summary.totalImmediateBuyValue)}
              </span>
            </div>

            <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3 col-span-2 sm:col-span-1">
              <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">
                Remaining Buffer
              </span>
              <span className="text-base sm:text-lg font-black font-mono text-[var(--text-muted)] mt-1 block">
                {formatInr(summary.unallocatedCashBuffer)}
              </span>
            </div>
          </div>

          {/* Master View Tabs: Immediate Buys, Queued, Sells */}
          <div className="flex items-center gap-2 border-b border-[var(--border-color)] pb-3">
            <button
              type="button"
              onClick={() => setActiveTab('BUYS')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                activeTab === 'BUYS'
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              <span>Immediate Buys (Funded Today)</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40">
                {immediateBuys.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('QUEUED')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                activeTab === 'QUEUED'
                  ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>Queued for Next Increment</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border border-cyan-500/40">
                {queuedBuys.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('SELLS')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                activeTab === 'SELLS'
                  ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/40 shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Algorithmic Sells & Trims</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/40">
                {sells.length}
              </span>
            </button>
          </div>

          {/* Tab Content Display */}
          {loading ? (
            <div className="py-16 text-center text-sm font-bold text-[var(--text-muted)] flex items-center justify-center gap-2">
              <RotateCw className="w-5 h-5 animate-spin text-cyan-500" />
              <span>Calculating dynamic conviction allocations and sizing...</span>
            </div>
          ) : activeTab === 'BUYS' ? (
            /* Tab 1: Immediate Buys */
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-2xl border border-[var(--border-color)]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border-color)] reports-subcard text-[var(--text-muted)] font-bold">
                      <th className="py-2.5 px-3">Type</th>
                      <th className="py-2.5 px-3">Symbol</th>
                      <th className="py-2.5 px-3">Company Name</th>
                      <th className="py-2.5 px-3 text-right">CMP</th>
                      <th className="py-2.5 px-3 text-right">Shares</th>
                      <th className="py-2.5 px-3 text-right">Value (INR)</th>
                      <th className="py-2.5 px-3 text-right">Stop-Loss</th>
                      <th className="py-2.5 px-3 text-right">Target</th>
                      <th className="py-2.5 px-3">Execution & Conviction Rationale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {immediateBuys.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-[var(--text-muted)]">
                          No immediate buys funded in current capital budget.
                        </td>
                      </tr>
                    ) : (
                      immediateBuys.map((b, idx) => {
                        const isAccumulate = b.actionType.includes('ACCUMULATE');
                        return (
                          <tr key={idx} className="hover:bg-[var(--hover-bg)] transition-colors">
                            <td className="py-2.5 px-3">
                              <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-md ${
                                isAccumulate
                                  ? 'bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30'
                                  : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30'
                              }`}>
                                {isAccumulate ? 'PYRAMID TRANCHE' : 'NEW POSITION'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-[var(--text-primary)]">
                              {b.symbol}
                            </td>
                            <td className="py-2.5 px-3 text-[var(--text-muted)] truncate max-w-[160px]" title={b.name}>
                              {b.name}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-[var(--text-primary)]">
                              {formatInr2(b.cmp)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                              {b.actionShares}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-[var(--text-primary)]">
                              {formatInr2(b.actionValue)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-rose-500 dark:text-rose-400">
                              {b.sl > 0 ? formatInr2(b.sl) : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-cyan-600 dark:text-cyan-400">
                              {b.tgt > 0 ? formatInr2(b.tgt) : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-[11px] text-[var(--text-muted)] max-w-xs">
                              {b.note}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : activeTab === 'QUEUED' ? (
            /* Tab 2: Queued Buys */
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-2xl border border-[var(--border-color)]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border-color)] reports-subcard text-[var(--text-muted)] font-bold">
                      <th className="py-2.5 px-3">Symbol</th>
                      <th className="py-2.5 px-3">Company Name</th>
                      <th className="py-2.5 px-3 text-right">CMP</th>
                      <th className="py-2.5 px-3 text-right">Target Sizing</th>
                      <th className="py-2.5 px-3 text-right">Target Shares</th>
                      <th className="py-2.5 px-3">Setup Tier</th>
                      <th className="py-2.5 px-3">Status Rationale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {queuedBuys.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-[var(--text-muted)]">
                          All qualifying candidates have been funded in today's capital allocation!
                        </td>
                      </tr>
                    ) : (
                      queuedBuys.map((q, idx) => (
                        <tr key={idx} className="hover:bg-[var(--hover-bg)] transition-colors">
                          <td className="py-2.5 px-3 font-mono font-bold text-[var(--text-primary)]">
                            {q.symbol}
                          </td>
                          <td className="py-2.5 px-3 text-[var(--text-muted)] truncate max-w-[180px]" title={q.name}>
                            {q.name}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-[var(--text-primary)]">
                            {formatInr2(q.cmp)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-cyan-600 dark:text-cyan-400">
                            {formatInr2(q.targetAmount)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-[var(--text-muted)]">
                            {q.targetShares}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-md bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border border-cyan-500/30">
                              {q.sizing?.tierLabel || q.stance}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-[11px] text-[var(--text-muted)] max-w-sm">
                            {q.note}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* Tab 3: Algorithmic Sells */
            <div className="space-y-3">
              {sells.length > 0 && (
                <div className="p-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-rose-500 dark:text-rose-300 font-bold">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>{sells.length} positions triggered for exit / trim based on live market price triggers.</span>
                  </div>
                  <div className="text-[11px] font-mono font-bold text-rose-400 dark:text-rose-200">
                    Total Liquidation / Recycled Pool: {formatInr(sells.reduce((acc, x) => acc + (x.actionValue || 0), 0))}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto rounded-2xl border border-[var(--border-color)]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border-color)] reports-subcard text-[var(--text-muted)] font-bold">
                      <th className="py-2.5 px-3">Action</th>
                      <th className="py-2.5 px-3">Symbol</th>
                      <th className="py-2.5 px-3 text-right">CMP</th>
                      <th className="py-2.5 px-3 text-right font-black text-rose-500 dark:text-rose-400">Sell Now</th>
                      <th className="py-2.5 px-3">Tranche 1 (Floor)</th>
                      <th className="py-2.5 px-3">Tranche 2 (30w SMA)</th>
                      <th className="py-2.5 px-3">Tranche 3 (Structural)</th>
                      <th className="py-2.5 px-3 text-right">Proceeds (INR)</th>
                      <th className="py-2.5 px-3">Trigger Rationale & Strategy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {sells.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-[var(--text-muted)]">
                          Zero performance-decayed sells triggered. All active holdings are performing cleanly!
                        </td>
                      </tr>
                    ) : (
                      sells.map((s, idx) => (
                        <tr key={idx} className="hover:bg-[var(--hover-bg)] transition-colors">
                          <td className="py-2.5 px-3">
                            <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-md whitespace-nowrap ${
                              s.isFullExit
                                ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/30'
                                : 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30'
                            }`}>
                              {s.actionType.replace('SELL - ', '')}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-[var(--text-primary)]">
                            <div>{s.symbol}</div>
                            <div className="text-[10px] text-[var(--text-muted)] font-normal truncate max-w-[120px]">{s.name}</div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-[var(--text-primary)]">
                            {formatInr2(s.cmp)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-black text-rose-600 dark:text-rose-400 text-sm">
                            {s.quantity} shs
                            <div className="text-[9px] text-[var(--text-muted)] font-normal">of {s.heldShares} held</div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">
                            {s.tranche1Shares > 0 ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold">{s.tranche1Shares} shs</span>
                                <span className="text-[10px] text-[var(--text-muted)]">@ ₹{s.tranche1Trigger}</span>
                                <span className={`text-[8.5px] px-1 py-0.2 rounded font-bold uppercase ${
                                  s.tranche1Status === 'COMPLETED' ? 'bg-emerald-500/15 text-emerald-500' :
                                  s.tranche1Status === 'READY' ? 'bg-rose-500/20 text-rose-500 dark:text-rose-300 font-black' : 'bg-amber-500/15 text-amber-500'
                                }`}>{s.tranche1Status}</span>
                              </div>
                            ) : '—'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">
                            {s.tranche2Shares > 0 ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold">{s.tranche2Shares} shs</span>
                                <span className="text-[10px] text-[var(--text-muted)]">@ ₹{s.tranche2Trigger}</span>
                                <span className={`text-[8.5px] px-1 py-0.2 rounded font-bold uppercase ${
                                  s.tranche2Status === 'COMPLETED' ? 'bg-emerald-500/15 text-emerald-500' :
                                  s.tranche2Status === 'READY' ? 'bg-rose-500/20 text-rose-500 dark:text-rose-300 font-black' : 'bg-slate-500/15 text-[var(--text-muted)]'
                                }`}>{s.tranche2Status}</span>
                              </div>
                            ) : '—'}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">
                            {s.tranche3Shares > 0 ? (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold">{s.tranche3Shares} shs</span>
                                <span className="text-[10px] text-[var(--text-muted)]">@ ₹{s.tranche3Trigger}</span>
                                <span className={`text-[8.5px] px-1 py-0.2 rounded font-bold uppercase ${
                                  s.tranche3Status === 'COMPLETED' ? 'bg-emerald-500/15 text-emerald-500' :
                                  s.tranche3Status === 'READY' ? 'bg-rose-500/20 text-rose-500 dark:text-rose-300 font-black' : 'bg-slate-500/15 text-[var(--text-muted)]'
                                }`}>{s.tranche3Status}</span>
                              </div>
                            ) : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-[var(--text-primary)]">
                            {formatInr2(s.actionValue)}
                          </td>
                          <td className="py-2.5 px-3 text-[11px] text-[var(--text-muted)] max-w-xs leading-relaxed">
                            {s.reason}
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

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-color)] reports-subcard">
          <div className="text-xs text-[var(--text-muted)] font-mono font-bold">
            {immediateBuys.length} Buys Funded • {queuedBuys.length} Queued • {sells.length} Sells
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleDownloadCsv}
              disabled={downloading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/40 hover:border-emerald-500/70 text-emerald-600 dark:text-emerald-300 transition-all cursor-pointer shadow-sm hover:shadow active:scale-95 disabled:opacity-50"
            >
              <Download className={`w-4 h-4 ${downloading ? 'animate-bounce' : ''}`} />
              <span>Download Plan CSV</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--hover-bg)] transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
