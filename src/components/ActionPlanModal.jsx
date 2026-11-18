import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Download,
  Sparkles,
  TrendingUp,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  RotateCw,
  Save,
  CheckCircle2,
  Clock,
  ArrowRight,
  Zap,
  Target,
  Layers,
  Award,
  BarChart3,
  Filter,
  ChevronRight,
  TrendingDown,
  Edit3
} from 'lucide-react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';

export default function ActionPlanModal({ isOpen, onClose }) {
  const { user, showConfirm, showPrompt, showError } = useThemeAuth();
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [error, setError] = useState(null);

  // Configuration state
  const [externalCash, setExternalCash] = useState(() => {
    try {
      const saved = localStorage.getItem('ladder_action_plan_external_cash');
      return saved !== null && saved !== '' ? Number(saved) : 200000;
    } catch {
      return 200000;
    }
  });
  const [recyclingMode, setRecyclingMode] = useState('FULL_AND_TRIMS');
  const [activeTab, setActiveTab] = useState('BUYS'); // 'BUYS' | 'QUEUED' | 'SELLS' | 'STOP_LOSSES'
  const [sellFilter, setSellFilter] = useState('ALL'); // 'ALL' | 'STRUCTURAL' | 'PRUNING'
  const [stopLossFilter, setStopLossFilter] = useState('ACTION_REQUIRED'); // 'ACTION_REQUIRED' | 'ALL' | 'AMEND' | 'NEW_GTT' | 'UP_TO_DATE' | 'BREAKEVEN' | 'TRAILING' | 'INITIAL' | 'NEAR_SL'
  const [syncingSl, setSyncingSl] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState('');

  // Plan data (SWR persisted cache from sessionStorage for instant 0ms painting)
  const [plan, setPlan] = useState(() => {
    try {
      const cached = sessionStorage.getItem('ladder_action_plan_cache');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });

  const sells = useMemo(() => {
    return (plan?.sells || []).filter(s => Number(s.quantity) > 0 && (s.isFullExit || s.tranche1Status === 'READY' || s.tranche2Status === 'READY'));
  }, [plan?.sells]);

  const filteredSells = useMemo(() => {
    if (sellFilter === 'PRUNING') return sells.filter(s => s.isPruning);
    if (sellFilter === 'STRUCTURAL') return sells.filter(s => !s.isPruning);
    return sells;
  }, [sells, sellFilter]);

  const stopLossActions = useMemo(() => {
    return plan?.stopLossActions || [];
  }, [plan?.stopLossActions]);

  const filteredStopLossActions = useMemo(() => {
    if (stopLossFilter === 'ACTION_REQUIRED') return stopLossActions.filter(a => a.isActionRequired);
    if (stopLossFilter === 'AMEND') return stopLossActions.filter(a => a.gttStatus === 'ACTION_REQUIRED_AMEND');
    if (stopLossFilter === 'CORE_RUNNER') return stopLossActions.filter(a => a.actionType === 'AMEND_CORE_RUNNER' || a.tier === 'TRANCHE2_CORE_RUNNER');
    if (stopLossFilter === 'TRANCHE1_TRIM') return stopLossActions.filter(a => a.actionType === 'SET_TRANCHE1_TRIM' || a.tier === 'TRANCHE1_TRIM');
    if (stopLossFilter === 'NEW_GTT') return stopLossActions.filter(a => a.gttStatus === 'ACTION_REQUIRED_NEW');
    if (stopLossFilter === 'UP_TO_DATE') return stopLossActions.filter(a => a.gttStatus === 'UP_TO_DATE');
    if (stopLossFilter === 'BREAKEVEN') return stopLossActions.filter(a => a.actionType === 'AMEND_BREAKEVEN');
    if (stopLossFilter === 'TRAILING') return stopLossActions.filter(a => a.actionType === 'AMEND_TRAILING' || a.actionType === 'AMEND_MULTIBAGGER' || a.actionType === 'AMEND_CORE_RUNNER');
    if (stopLossFilter === 'INITIAL') return stopLossActions.filter(a => a.actionType === 'SET_INITIAL');
    if (stopLossFilter === 'NEAR_SL') return stopLossActions.filter(a => a.isNearSl);
    return stopLossActions;
  }, [stopLossActions, stopLossFilter]);

  const coreFocusHoldings = useMemo(() => {
    return plan?.coreFocusHoldings || [];
  }, [plan?.coreFocusHoldings]);

  const pruningSells = useMemo(() => {
    return plan?.pruningSells || (plan?.sells || []).filter(s => s.isPruning);
  }, [plan?.pruningSells, plan?.sells]);

  const fetchPlan = useCallback(async (cash = null, mode = null) => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (cash !== null && cash !== undefined) {
        params.externalCash = cash;
      }
      if (mode !== null && mode !== undefined) {
        params.recyclingMode = mode;
      }
      const res = await axios.get('/api/stock-intelligence/action-plan', { params });
      setPlan(res.data);
      try {
        sessionStorage.setItem('ladder_action_plan_cache', JSON.stringify(res.data));
      } catch {}
      if (res.data?.summary) {
        if (res.data.summary.externalCashBudget !== undefined) {
          const budget = res.data.summary.externalCashBudget;
          setExternalCash(budget);
          try {
            localStorage.setItem('ladder_action_plan_external_cash', String(budget));
          } catch {}
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
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchPlan();
    }
  }, [isOpen]);

  const handleCashChange = (newVal) => {
    const valid = Math.max(0, Math.round(Number(newVal) || 0));
    setExternalCash(valid);
    try {
      localStorage.setItem('ladder_action_plan_external_cash', String(valid));
    } catch {}
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
      try {
        localStorage.setItem('ladder_action_plan_external_cash', String(externalCash));
      } catch {}
      setSaveStatus('✓ Saved as Default');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch (err) {
      showError('Failed to save settings: ' + (err.response?.data?.error || err.message));
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
      showError('Failed to download CSV: ' + (err.response?.data?.error || err.message));
    } finally {
      setDownloading(false);
    }
  };

  const handleMarkGttSet = async (sla) => {
    try {
      setSyncingSl(true);
      await axios.post('/api/stock-intelligence/active-stop-loss', {
        symbol: sla.symbol,
        triggerPrice: sla.targetSlPrice,
        tier: sla.tier,
        rationale: sla.rationale || sla.reason
      });
      await fetchPlan();
      setSyncSuccessMsg(`✓ ${sla.symbol} GTT recorded at ₹${sla.targetSlPrice.toFixed(2)} in broker.`);
      setTimeout(() => setSyncSuccessMsg(''), 4000);
    } catch (err) {
      console.error('[ActionPlanModal] SL sync error:', err);
      showError(err.response?.data?.error || err.message || 'Failed to update active GTT stop loss.');
    } finally {
      setSyncingSl(false);
    }
  };

  const handleCustomGttSet = async (sla) => {
    const currentVal = sla.activeGttPrice ? sla.activeGttPrice : sla.targetSlPrice;
    const input = await showPrompt(`Enter active GTT Stop Loss trigger price for ${sla.symbol} in your broker:`, String(currentVal));
    if (!input) return;
    const price = Number(input);
    if (!Number.isFinite(price) || price <= 0) {
      showError('Please enter a valid positive trigger price.');
      return;
    }
    try {
      setSyncingSl(true);
      await axios.post('/api/stock-intelligence/active-stop-loss', {
        symbol: sla.symbol,
        triggerPrice: price,
        tier: sla.tier,
        rationale: `Manual entry: ₹${price.toFixed(2)}`
      });
      await fetchPlan();
      setSyncSuccessMsg(`✓ ${sla.symbol} GTT recorded at ₹${price.toFixed(2)}.`);
      setTimeout(() => setSyncSuccessMsg(''), 4000);
    } catch (err) {
      console.error('[ActionPlanModal] Custom SL sync error:', err);
      showError(err.response?.data?.error || err.message || 'Failed to update active GTT stop loss.');
    } finally {
      setSyncingSl(false);
    }
  };

  const handleMarkAllActionableSet = async () => {
    const actionable = stopLossActions.filter(a => a.isActionRequired);
    if (actionable.length === 0) return;
    const confirmed = await showConfirm(`Mark all ${actionable.length} actionable GTT Stop Losses as confirmed in your broker?`);
    if (!confirmed) return;

    try {
      setSyncingSl(true);
      const entries = actionable.map(a => ({
        symbol: a.symbol,
        triggerPrice: a.targetSlPrice,
        tier: a.tier,
        rationale: a.rationale || a.reason
      }));
      await axios.post('/api/stock-intelligence/active-stop-loss', { entries });
      await fetchPlan();
      setSyncSuccessMsg(`✓ All ${actionable.length} GTT Stop Losses marked as active in broker.`);
      setTimeout(() => setSyncSuccessMsg(''), 4000);
    } catch (err) {
      console.error('[ActionPlanModal] Bulk SL sync error:', err);
      showError(err.response?.data?.error || err.message || 'Failed to bulk update active GTT stop losses.');
    } finally {
      setSyncingSl(false);
    }
  };

  if (!isOpen) return null;

  const summary = plan?.summary || {};
  const immediateBuys = plan?.immediateBuys || [];
  const queuedBuys = plan?.queuedBuys || [];

  const formatInr = (val) => {
    const num = Number(val) || 0;
    return '₹' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
          {/* Connection Delay / Error Notice Banner */}
          {error && (
            <div className="p-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-4 h-4 shrink-0 text-rose-500" />
                <span>
                  <strong>Notice:</strong> {error}
                  {plan ? ' (Displaying verified cached action plan)' : ''}
                </span>
              </div>
              <button
                type="button"
                onClick={() => fetchPlan(externalCash, recyclingMode)}
                className="px-3 py-1 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-600 dark:text-rose-300 font-bold border border-rose-500/40 transition-all cursor-pointer shrink-0"
              >
                Retry
              </button>
            </div>
          )}
          {/* Dynamic Market Opportunity & Execution Mode Banner */}
          {summary.marketOpportunity && (
            <div className={`rounded-2xl border p-4 space-y-2.5 transition-all ${
              summary.marketOpportunity.isStrikeMode
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : 'bg-amber-500/10 border-amber-500/30'
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className={`p-1.5 rounded-xl border ${
                    summary.marketOpportunity.isStrikeMode
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-500 dark:text-emerald-400'
                      : 'bg-amber-500/20 border-amber-500/40 text-amber-500 dark:text-amber-400'
                  }`}>
                    {summary.marketOpportunity.isStrikeMode ? (
                      <Zap className="w-4 h-4" />
                    ) : (
                      <Clock className="w-4 h-4" />
                    )}
                  </div>
                  <h4 className="text-sm font-black text-[var(--text-primary)]">
                    {summary.marketOpportunity.headline}
                  </h4>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold border ${
                    summary.marketOpportunity.isStrikeMode
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border-emerald-500/40'
                      : 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-500/40'
                  }`}>
                    MOI: {summary.marketOpportunity.moi} / 100
                  </span>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-lg bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-muted)]">
                    Budget: {formatInr(summary.dailyDeploymentCap)}
                  </span>
                </div>
              </div>

              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                {summary.marketOpportunity.description}
              </p>

              {summary.marketOpportunity.componentScores && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-[var(--border-color)]/60 text-[11px] font-mono">
                  <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-[var(--surface-color)]/70">
                    <span className="text-[var(--text-muted)]">Quality Density:</span>
                    <span className="font-bold text-[var(--text-primary)]">
                      {summary.marketOpportunity.componentScores.qualityDensity}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-[var(--surface-color)]/70">
                    <span className="text-[var(--text-muted)]">50-EMA Support:</span>
                    <span className="font-bold text-[var(--text-primary)]">
                      {summary.marketOpportunity.componentScores.ema50PullbackSupport}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-[var(--surface-color)]/70">
                    <span className="text-[var(--text-muted)]">VCP Contraction:</span>
                    <span className="font-bold text-[var(--text-primary)]">
                      {summary.marketOpportunity.componentScores.vcpBaseCompression}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-[var(--surface-color)]/70">
                    <span className="text-[var(--text-muted)]">Sector Group:</span>
                    <span className="font-bold text-[var(--text-primary)]">
                      {summary.marketOpportunity.componentScores.sectorGroupMomentum}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

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

          {/* Market Regime & High-Alpha Concentration Banner */}
          {summary.marketRegime && (
            <div className={`p-3 rounded-2xl border flex flex-wrap items-center justify-between gap-2.5 text-xs ${
              summary.marketRegime.isBullRegime
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300'
            }`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${summary.marketRegime.isBullRegime ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                <span className="font-bold tracking-wide">{summary.marketRegime.headline}</span>
                <span className="text-[11px] font-normal text-[var(--text-muted)] hidden md:inline">
                  — {summary.marketRegime.description}
                </span>
              </div>
              {summary.pruningSummary?.pruningCount > 0 && (
                <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold px-2 py-0.5 rounded-lg bg-[var(--surface-color)] border border-[var(--border-color)] text-[var(--text-primary)]">
                  <span>Tail Pruning: {summary.pruningSummary.pruningCount} positions</span>
                  <span>•</span>
                  <span className="text-emerald-600 dark:text-emerald-400">+{formatInr(summary.pruningSummary.pruningProceeds)} to recycle</span>
                </div>
              )}
            </div>
          )}

          {/* Capital Flow Strip (5 KPIs) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3">
              <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">
                External Bank Cash
              </span>
              {loading && !plan ? (
                <div className="h-6 w-24 bg-[var(--border-color)]/50 rounded-lg animate-pulse mt-1" />
              ) : (
                <span className="text-base sm:text-lg font-black font-mono text-cyan-600 dark:text-cyan-400 mt-1 block">
                  {formatInr(summary.externalCashBudget)}
                </span>
              )}
              <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                Monthly infusion
              </span>
            </div>

            <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3">
              <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">
                Recycled Capital
              </span>
              {loading && !plan ? (
                <div className="h-6 w-24 bg-[var(--border-color)]/50 rounded-lg animate-pulse mt-1" />
              ) : (
                <span className="text-base sm:text-lg font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1 block">
                  +{formatInr(summary.recycledCapital)}
                </span>
              )}
            </div>

            <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3">
              <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">
                Total Purchasing Power
              </span>
              {loading && !plan ? (
                <div className="h-6 w-24 bg-[var(--border-color)]/50 rounded-lg animate-pulse mt-1" />
              ) : (
                <span className="text-base sm:text-lg font-black font-mono text-[var(--text-primary)] mt-1 block">
                  {formatInr(summary.totalPurchasingPower)}
                </span>
              )}
              <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                Ready to deploy
              </span>
            </div>

            <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3">
              <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">
                Allocated to Buys
              </span>
              {loading && !plan ? (
                <div className="h-6 w-24 bg-[var(--border-color)]/50 rounded-lg animate-pulse mt-1" />
              ) : (
                <span className="text-base sm:text-lg font-black font-mono text-purple-600 dark:text-purple-400 mt-1 block">
                  {formatInr(summary.totalImmediateBuyValue)}
                </span>
              )}
              <span className="text-[10px] text-purple-600/80 dark:text-purple-400/80 block mt-0.5 truncate" title={`Dynamic Deployment Budget: ${formatInr(summary.dailyDeploymentCap)}`}>
                Budget: {formatInr(summary.dailyDeploymentCap)}
              </span>
            </div>

            <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3 col-span-2 sm:col-span-1">
              <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">
                Remaining Buffer
              </span>
              {loading && !plan ? (
                <div className="h-6 w-24 bg-[var(--border-color)]/50 rounded-lg animate-pulse mt-1" />
              ) : (
                <span className="text-base sm:text-lg font-black font-mono text-[var(--text-muted)] mt-1 block">
                  {formatInr(summary.unallocatedCashBuffer)}
                </span>
              )}
            </div>
          </div>

          {/* Master View Tabs: Immediate Buys, Queued, Sells, Strategy */}
          <div className="flex items-center gap-2 border-b border-[var(--border-color)] pb-3 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('BUYS')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'BUYS'
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              <span>Immediate Buys</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40">
                {immediateBuys.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('QUEUED')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'QUEUED'
                  ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>Queued Candidates</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border border-cyan-500/40">
                {queuedBuys.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('SELLS')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'SELLS'
                  ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/40 shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <ShieldAlert className="w-4 h-4" />
              <span>Algorithmic Sells</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/40">
                {sells.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('STOP_LOSSES')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeTab === 'STOP_LOSSES'
                  ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Stop Loss & GTT Updates</span>
              {summary.stopLossSummary?.actionRequiredCount > 0 ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/30 text-amber-600 dark:text-amber-300 border border-amber-500/50 font-black animate-pulse">
                  {summary.stopLossSummary.actionRequiredCount} Action Needed
                </span>
              ) : stopLossActions.length > 0 ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40 font-bold">
                  ✓ In Sync ({stopLossActions.length})
                </span>
              ) : null}
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
                      <th className="py-2.5 px-3 text-right text-amber-500 dark:text-amber-400">GTT Stop-Loss (-8%)</th>
                      <th className="py-2.5 px-3 text-right">Target</th>
                      <th className="py-2.5 px-3">Execution & Conviction Rationale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {immediateBuys.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-8 text-center text-[var(--text-muted)]">
                          {error ? 'Unable to load immediate buys due to connection or calculation delay. Please click Retry above.' : 'No immediate buys funded in current capital budget.'}
                        </td>
                      </tr>
                    ) : (
                      immediateBuys.map((b, idx) => {
                        const isAccumulate = b.actionType.includes('ACCUMULATE');
                        const isPilot = b.actionType.includes('PILOT');
                        return (
                          <tr key={idx} className="hover:bg-[var(--hover-bg)] transition-colors">
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-md ${
                                  isAccumulate
                                    ? 'bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30'
                                    : isPilot
                                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30'
                                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30'
                                }`}>
                                  {isAccumulate ? 'PYRAMID TRANCHE' : isPilot ? 'PILOT TRANCHE (25%)' : 'NEW POSITION'}
                                </span>
                                {b.mps !== undefined && (
                                  <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono font-bold rounded bg-indigo-500/15 text-indigo-500 border border-indigo-500/30" title={`Multibagger Probability Score: ${b.mps}/100`}>
                                    MPS {b.mps}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-[var(--text-primary)]">
                              {b.symbol}
                            </td>
                            <td className="py-2.5 px-3 text-[var(--text-muted)] max-w-[180px]" title={b.name}>
                              <div className="font-medium truncate">{b.name}</div>
                              {(b.sector || b.market_cap) && (
                                <div className="text-[9.5px] font-semibold text-[var(--text-secondary)] truncate mt-0.5 flex items-center gap-1">
                                  {b.sector && <span className="text-emerald-500/90">{b.sector}</span>}
                                  {b.sector && b.market_cap && <span>•</span>}
                                  {b.market_cap && <span className="text-blue-400">{b.market_cap}</span>}
                                </div>
                              )}
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
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-500 dark:text-amber-400">
                              {b.sl > 0 ? formatInr2(b.sl) : formatInr2(b.cmp * 0.92)}
                              <div className="text-[9px] text-[var(--text-muted)] font-normal">-8.0% Initial GTT</div>
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
                          <td className="py-2.5 px-3 text-[var(--text-muted)] max-w-[180px]" title={q.name}>
                            <div className="font-medium truncate">{q.name}</div>
                            {(q.sector || q.market_cap) && (
                              <div className="text-[9.5px] font-semibold text-[var(--text-secondary)] truncate mt-0.5 flex items-center gap-1">
                                {q.sector && <span className="text-cyan-500/90">{q.sector}</span>}
                                {q.sector && q.market_cap && <span>•</span>}
                                {q.market_cap && <span className="text-blue-400">{q.market_cap}</span>}
                              </div>
                            )}
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
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-md ${
                                q.executionStatus?.includes('CORE HOLD') || q.sizing?.tierLabel?.includes('Hold Core') || q.actionType?.includes('MAXIMUM POSITION')
                                  ? 'bg-purple-500/15 text-purple-600 dark:text-purple-300 border border-purple-500/30'
                                  : q.executionStatus?.includes('EARNINGS')
                                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30'
                                  : q.executionStatus?.includes('LOSS')
                                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/30'
                                  : q.executionStatus?.includes('OPPORTUNITY BUDGET')
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30'
                                  : q.executionStatus?.includes('BANDWIDTH') || q.executionStatus?.includes('DAILY')
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30'
                                  : q.executionStatus?.includes('AWAIT PULLBACK') || q.sizing?.tierLabel?.includes('Extended')
                                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30'
                                  : q.executionStatus?.includes('SECTOR')
                                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-300 border border-blue-500/30'
                                  : q.executionStatus?.includes('MICROCAP') || q.sizing?.tierLabel?.includes('Microcap')
                                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/30'
                                  : 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-300 border border-cyan-500/30'
                              }`}>
                                {q.executionStatus?.includes('EARNINGS')
                                  ? 'Awaiting Earnings Beat'
                                  : q.executionStatus?.includes('LOSS')
                                  ? 'Loss Protection'
                                  : q.executionStatus?.includes('OPPORTUNITY BUDGET')
                                  ? 'Opportunity Budget Limit'
                                  : q.executionStatus?.includes('BANDWIDTH') || q.executionStatus?.includes('DAILY')
                                  ? 'Next In Line'
                                  : (q.sizing?.tierLabel || q.stance)}
                              </span>
                              {q.mps !== undefined && (
                                <span className="inline-block px-1.5 py-0.5 text-[10px] font-mono font-bold rounded bg-indigo-500/15 text-indigo-500 border border-indigo-500/30" title={`Multibagger Probability Score: ${q.mps}/100`}>
                                  MPS {q.mps}
                                </span>
                              )}
                            </div>
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
          ) : activeTab === 'SELLS' ? (
            /* Tab 3: Algorithmic Sells */
            <div className="space-y-3">
              {sells.length > 0 && (
                <div className="p-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-rose-500 dark:text-rose-300 font-bold">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>{sells.length} positions triggered for exit / trim based on live market triggers and portfolio tail pruning.</span>
                  </div>
                  <div className="text-[11px] font-mono font-bold text-rose-400 dark:text-rose-200">
                    Total Liquidation / Recycled Pool: {formatInr(sells.reduce((acc, x) => acc + (x.actionValue || 0), 0))}
                  </div>
                </div>
              )}

              {/* Sub-Filters for Sells: All, Structural Breakdown, Tail Pruning */}
              <div className="flex items-center gap-2 pb-1">
                <button
                  type="button"
                  onClick={() => setSellFilter('ALL')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    sellFilter === 'ALL'
                      ? 'bg-[var(--surface-color)] text-[var(--text-primary)] border border-[var(--border-color)] shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  All Sells ({sells.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSellFilter('STRUCTURAL')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    sellFilter === 'STRUCTURAL'
                      ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Structural / Technical ({sells.filter(s => !s.isPruning).length})
                </button>
                <button
                  type="button"
                  onClick={() => setSellFilter('PRUNING')}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    sellFilter === 'PRUNING'
                      ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Tail Pruning ({sells.filter(s => s.isPruning).length})
                </button>
              </div>

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
                      <th className="py-2.5 px-3 text-right">Proceeds (INR)</th>
                      <th className="py-2.5 px-3">Trigger Rationale & Strategy</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {filteredSells.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-[var(--text-muted)]">
                          No sells matching the selected filter.
                        </td>
                      </tr>
                    ) : (
                      filteredSells.map((s, idx) => (
                        <tr key={idx} className="hover:bg-[var(--hover-bg)] transition-colors">
                          <td className="py-2.5 px-3">
                            <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-md whitespace-nowrap ${
                              s.isPruning
                                ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30'
                                : s.isFullExit
                                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/30'
                                  : 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30'
                            }`}>
                              {s.isPruning ? 'PRUNING (20-25 CORE)' : s.actionType.replace('SELL - ', '')}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-[var(--text-primary)]">
                            <div>{s.symbol}</div>
                            <div className="text-[10px] text-[var(--text-muted)] font-normal truncate max-w-[140px]">{s.name}</div>
                            {(s.sector || s.market_cap) && (
                              <div className="text-[9px] font-semibold text-[var(--text-secondary)] truncate font-sans mt-0.5 flex items-center gap-1">
                                {s.sector && <span className="text-emerald-500/90">{s.sector}</span>}
                                {s.sector && s.market_cap && <span>•</span>}
                                {s.market_cap && <span className="text-blue-400">{s.market_cap}</span>}
                              </div>
                            )}
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
          ) : (
            /* Tab 4: Stop Loss & GTT Updates */
            <div className="space-y-4">
              {/* 4 KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className={`reports-subcard rounded-2xl border p-3 ${
                  (summary.stopLossSummary?.actionRequiredCount ?? 0) > 0
                    ? 'border-amber-500/40 bg-amber-500/10'
                    : 'border-emerald-500/30 bg-emerald-500/5'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider block">
                      Action Required
                    </span>
                    {(summary.stopLossSummary?.actionRequiredCount ?? 0) > 0 ? (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-300 animate-pulse">
                        Broker Update
                      </span>
                    ) : (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
                        ✓ In Sync
                      </span>
                    )}
                  </div>
                  <span className={`text-base sm:text-lg font-black font-mono mt-1 block ${
                    (summary.stopLossSummary?.actionRequiredCount ?? 0) > 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {summary.stopLossSummary?.actionRequiredCount ?? 0} Holdings
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                    {summary.stopLossSummary?.amendGttCount ?? 0} Amendments · {summary.stopLossSummary?.newGttCount ?? 0} New · {summary.stopLossSummary?.coreRunnersCount ?? 0} Core
                  </span>
                </div>

                <div className="reports-subcard rounded-2xl border border-emerald-500/30 p-3 bg-emerald-500/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
                      In Sync (Broker)
                    </span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
                      Up-to-Date
                    </span>
                  </div>
                  <span className="text-base sm:text-lg font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1 block">
                    {summary.stopLossSummary?.upToDateCount ?? 0}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                    Active GTT matches target floor
                  </span>
                </div>

                <div className="reports-subcard rounded-2xl border border-cyan-500/30 p-3 bg-cyan-500/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-cyan-600 dark:text-cyan-400 uppercase tracking-wider block">
                      Core 30W-SMA
                    </span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-600 dark:text-cyan-300">
                      Runners
                    </span>
                  </div>
                  <span className="text-base sm:text-lg font-black font-mono text-cyan-600 dark:text-cyan-400 mt-1 block">
                    {summary.stopLossSummary?.coreRunnersCount ?? 0}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                    Tranche 1 locked · 30w-SMA
                  </span>
                </div>

                <div className="reports-subcard rounded-2xl border border-rose-500/30 p-3 bg-rose-500/5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider block">
                      Near Stop (≤3%)
                    </span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-600 dark:text-rose-300">
                      Defense
                    </span>
                  </div>
                  <span className="text-base sm:text-lg font-black font-mono text-rose-600 dark:text-rose-400 mt-1 block">
                    {summary.stopLossSummary?.nearStopCount ?? 0}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] block mt-0.5">
                    Close to stop loss trigger
                  </span>
                </div>
              </div>

              {/* Action Banner when modifications are pending */}
              {(summary.stopLossSummary?.actionRequiredCount ?? 0) > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-300">
                  <div className="flex items-center gap-2.5 text-xs">
                    <ShieldAlert className="w-4 h-4 shrink-0 text-amber-500 animate-pulse" />
                    <div>
                      <span className="font-bold">Broker Action Required: </span>
                      <span>
                        {summary.stopLossSummary.actionRequiredCount} holding(s) need GTT stop losses set or amended in Zerodha/Groww ({summary.stopLossSummary.amendGttCount ?? 0} trailing amendments, {summary.stopLossSummary.newGttCount ?? 0} new entries).
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleMarkAllActionableSet}
                    disabled={syncingSl}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 transition-all flex items-center justify-center gap-1.5 shadow-sm whitespace-nowrap cursor-pointer shrink-0 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Mark All {summary.stopLossSummary.actionRequiredCount} as Synced</span>
                  </button>
                </div>
              )}

              {/* Sync Success Toast */}
              {syncSuccessMsg && (
                <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-300 text-xs font-bold flex items-center gap-2 animate-fade-in">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                  <span>{syncSuccessMsg}</span>
                </div>
              )}

              {/* Strategy Rules Explanation Strip */}
              <div className="p-3.5 rounded-2xl border border-indigo-500/30 bg-indigo-500/10 text-[var(--text-primary)] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-indigo-500" />
                    <span className="text-xs font-bold tracking-wide">
                      Active GTT Tracking Protocol — Synchronized with Staged Exit Plan
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-600 dark:text-indigo-300">
                    Broker GTT Ready
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5 pt-1 text-[11px] text-[var(--text-muted)]">
                  <div className="space-y-0.5">
                    <span className="font-bold text-amber-600 dark:text-amber-400 block">Tier 1: Initial -8% Entry Stop</span>
                    <span>100% shares. Caps initial risk at -8.0% from cost basis.</span>
                  </div>
                  <div className="space-y-0.5">
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 block">Tier 2: Breakeven (+15% to +30%)</span>
                    <span>100% shares. Lock SL to cost basis +1% statutory cushion.</span>
                  </div>
                  <div className="space-y-0.5">
                    <span className="font-bold text-purple-600 dark:text-purple-400 block">Tier 3: Tranche 1 Trim (33%)</span>
                    <span>33% trim on trailing floor/50-EMA. Leaves 67% core running.</span>
                  </div>
                  <div className="space-y-0.5">
                    <span className="font-bold text-cyan-600 dark:text-cyan-400 block">Tier 4: Core Runner (30W-SMA)</span>
                    <span>Tranche 1 completed. Remaining core rides on 30w-SMA support.</span>
                  </div>
                </div>
              </div>

              {/* Sub-Filters */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
                <button
                  type="button"
                  onClick={() => setStopLossFilter('ACTION_REQUIRED')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                    stopLossFilter === 'ACTION_REQUIRED'
                      ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span>Action Required</span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-amber-500/30">
                    {summary.stopLossSummary?.actionRequiredCount ?? 0}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setStopLossFilter('ALL')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap ${
                    stopLossFilter === 'ALL'
                      ? 'bg-[var(--surface-color)] text-[var(--text-primary)] border border-[var(--border-color)] shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  All Positions ({stopLossActions.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStopLossFilter('CORE_RUNNER')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap ${
                    stopLossFilter === 'CORE_RUNNER'
                      ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border border-cyan-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Core 30w-SMA Runners ({summary.stopLossSummary?.coreRunnersCount ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setStopLossFilter('TRANCHE1_TRIM')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap ${
                    stopLossFilter === 'TRANCHE1_TRIM'
                      ? 'bg-purple-500/20 text-purple-600 dark:text-purple-300 border border-purple-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Tranche 1 Trims ({summary.stopLossSummary?.tranche1TrimsCount ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setStopLossFilter('AMEND')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap ${
                    stopLossFilter === 'AMEND'
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Trailing Amendments ({summary.stopLossSummary?.amendGttCount ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setStopLossFilter('NEW_GTT')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap ${
                    stopLossFilter === 'NEW_GTT'
                      ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  New GTTs ({summary.stopLossSummary?.newGttCount ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setStopLossFilter('UP_TO_DATE')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap ${
                    stopLossFilter === 'UP_TO_DATE'
                      ? 'bg-slate-500/20 text-[var(--text-primary)] border border-slate-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  In Sync ({summary.stopLossSummary?.upToDateCount ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setStopLossFilter('BREAKEVEN')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap ${
                    stopLossFilter === 'BREAKEVEN'
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Breakeven Locks ({summary.stopLossSummary?.breakevenLocksCount ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setStopLossFilter('TRAILING')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap ${
                    stopLossFilter === 'TRAILING'
                      ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border border-cyan-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Trailing 50-EMA ({summary.stopLossSummary?.trailingRunnersCount ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setStopLossFilter('NEAR_SL')}
                  className={`px-3 py-1.5 rounded-xl font-bold transition-all cursor-pointer whitespace-nowrap ${
                    stopLossFilter === 'NEAR_SL'
                      ? 'bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Near SL (≤3%) ({summary.stopLossSummary?.nearStopCount ?? 0})
                </button>
              </div>

              {/* Master Execution Table */}
              <div className="overflow-x-auto rounded-2xl border border-[var(--border-color)]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-[var(--border-color)] reports-subcard text-[var(--text-muted)] font-bold">
                      <th className="py-2.5 px-3">Broker Status</th>
                      <th className="py-2.5 px-3">Symbol & Tranche</th>
                      <th className="py-2.5 px-3">Sector</th>
                      <th className="py-2.5 px-3 text-right">CMP</th>
                      <th className="py-2.5 px-3 text-right">Cost Basis</th>
                      <th className="py-2.5 px-3 text-right">P&L %</th>
                      <th className="py-2.5 px-3 text-right text-slate-400">Active GTT</th>
                      <th className="py-2.5 px-3 text-right text-amber-500 dark:text-amber-400">Target GTT SL (Qty)</th>
                      <th className="py-2.5 px-3 text-right text-emerald-500">Delta</th>
                      <th className="py-2.5 px-3 text-right">Buffer</th>
                      <th className="py-2.5 px-3">Execution Guidance & Rationale</th>
                      <th className="py-2.5 px-3 text-center">Sync Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-color)]">
                    {filteredStopLossActions.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="py-12 text-center text-[var(--text-muted)]">
                          {stopLossFilter === 'ACTION_REQUIRED' ? (
                            <div className="space-y-2">
                              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                              <div className="text-sm font-bold text-[var(--text-primary)]">
                                All {stopLossActions.length} open holdings have GTT Stop Losses synchronized in your broker!
                              </div>
                              <div className="text-xs text-[var(--text-muted)]">
                                Zero modifications required today. Switch to &quot;All Positions&quot; to inspect full portfolio stop floors.
                              </div>
                            </div>
                          ) : (
                            'No positions match the selected filter.'
                          )}
                        </td>
                      </tr>
                    ) : (
                      filteredStopLossActions.map((sla, idx) => {
                        const isBreakeven = sla.actionType === 'AMEND_BREAKEVEN';
                        const isNear = sla.isNearSl;

                        return (
                          <tr key={sla.symbol + '-' + idx} className="hover:bg-[var(--hover-bg)] transition-colors">
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {sla.actionType === 'AMEND_CORE_RUNNER' ? (
                                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border-cyan-500/40 animate-pulse flex items-center gap-1 w-fit">
                                  <span>AMEND → 30W-SMA</span>
                                </span>
                              ) : sla.actionType === 'SET_TRANCHE1_TRIM' ? (
                                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border bg-purple-500/20 text-purple-600 dark:text-purple-300 border-purple-500/40 animate-pulse flex items-center gap-1 w-fit">
                                  <span>SET T1 TRIM (33%)</span>
                                </span>
                              ) : sla.gttStatus === 'ACTION_REQUIRED_AMEND' ? (
                                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border-emerald-500/40 animate-pulse flex items-center gap-1 w-fit">
                                  <span>AMEND</span>
                                  <span>(+₹{sla.slDelta.toFixed(2)})</span>
                                </span>
                              ) : sla.gttStatus === 'ACTION_REQUIRED_NEW' ? (
                                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border bg-amber-500/20 text-amber-600 dark:text-amber-300 border-amber-500/40 flex items-center gap-1 w-fit">
                                  <span>SET GTT (-8%)</span>
                                </span>
                              ) : (
                                <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full border bg-slate-500/10 text-[var(--text-muted)] border-slate-500/20 flex items-center gap-1 w-fit">
                                  <span>✓ In Sync</span>
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-bold text-[var(--text-primary)] whitespace-nowrap">
                              <div>{sla.symbol}</div>
                              <div className="text-[10px] text-[var(--text-muted)] font-normal truncate max-w-[130px]" title={sla.name}>
                                {sla.name}
                              </div>
                              <div className={`text-[9px] font-sans font-semibold mt-0.5 ${
                                sla.tier === 'TRANCHE2_CORE_RUNNER'
                                  ? 'text-cyan-600 dark:text-cyan-400 font-bold'
                                  : sla.tier === 'TRANCHE1_TRIM'
                                    ? 'text-purple-600 dark:text-purple-400 font-bold'
                                    : 'text-[var(--text-muted)]'
                              }`}>
                                {sla.trancheStage || 'Core Position'}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-[var(--text-muted)] max-w-[130px] truncate font-sans text-[11px]" title={sla.name}>
                              {sla.sector || 'Diversified'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-[var(--text-primary)]">
                              {formatInr2(sla.cmp)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-[var(--text-muted)]">
                              {formatInr2(sla.avgBuyPrice)}
                            </td>
                            <td className={`py-2.5 px-3 text-right font-mono font-bold ${
                              (Number(sla.pnlPct) || 0) >= 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}>
                              {(Number(sla.pnlPct) || 0) >= 0 ? '+' : ''}{(Number(sla.pnlPct) || 0).toFixed(2)}%
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-[var(--text-muted)]">
                              {sla.activeGttPrice ? formatInr2(sla.activeGttPrice) : <span className="text-amber-500 italic text-[11px]">Unset</span>}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-black text-amber-600 dark:text-amber-400">
                              <div>{formatInr2(sla.targetSlPrice)}</div>
                              <div className="text-[9.5px] font-normal text-[var(--text-muted)]">
                                {sla.targetQty} of {sla.qty} shs
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap">
                              {sla.slDelta > 0 ? (
                                <span className="text-emerald-600 dark:text-emerald-400 text-[11px]">
                                  +₹{sla.slDelta.toFixed(2)} (+{sla.slDeltaPct.toFixed(1)}%)
                                </span>
                              ) : sla.gttStatus === 'ACTION_REQUIRED_NEW' ? (
                                <span className="text-[10px] text-amber-500 font-normal">Initial</span>
                              ) : (
                                <span className="text-[var(--text-muted)] text-[11px] font-normal">—</span>
                              )}
                            </td>
                            <td className={`py-2.5 px-3 text-right font-mono font-bold ${
                              isNear
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-[var(--text-muted)]'
                            }`}>
                              {(Number(sla.distanceToSlPct ?? sla.slBufferPct ?? 0)).toFixed(2)}%
                            </td>
                            <td className="py-2.5 px-3 text-[11px] text-[var(--text-muted)] max-w-sm leading-relaxed">
                              {sla.rationale || sla.reason}
                            </td>
                            <td className="py-2.5 px-3 text-center whitespace-nowrap">
                              {sla.isActionRequired ? (
                                <button
                                  type="button"
                                  onClick={() => handleMarkGttSet(sla)}
                                  disabled={syncingSl}
                                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 transition-all cursor-pointer whitespace-nowrap shadow-sm disabled:opacity-50"
                                >
                                  ✓ Mark Set
                                </button>
                              ) : (
                                <div className="flex items-center justify-center gap-1.5">
                                  <span className="text-emerald-500 font-bold text-[11px]">✓ Active</span>
                                  <button
                                    type="button"
                                    onClick={() => handleCustomGttSet(sla)}
                                    title="Edit active trigger price"
                                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--surface-color)] transition-colors cursor-pointer"
                                  >
                                    <Edit3 className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
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
            {immediateBuys.length} Buys Funded • {queuedBuys.length} Queued • {sells.length} Sells • {stopLossActions.length} GTT Stop Updates
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
