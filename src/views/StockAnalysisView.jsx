import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CandlestickChart,
  CheckCircle2,
  Download,
  Clock3,
  ExternalLink,
  Flame,
  History,
  Layers,
  RefreshCw,
  Scale,
  Search,
  SearchCheck,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Sparkles,
  X
} from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import HoldingLogo from '../components/HoldingLogo';
import BuyAnalysisView, { getClientBuyAnalysisCache } from './BuyAnalysisView';
import ActionPlanModal from '../components/ActionPlanModal';

const STATE_META = {
  NORMAL: {
    label: 'Hold',
    tone: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
  },
  WATCH: {
    label: 'Watch',
    tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10'
  },
  TECHNICAL_TRIM_CANDIDATE: {
    label: 'Trim',
    tone: 'text-rose-300 border-rose-500/30 bg-rose-500/10'
  },
  FUNDAMENTAL_TRIM_CANDIDATE: {
    label: 'Trim (Fund)',
    tone: 'text-orange-300 border-orange-500/30 bg-orange-500/10'
  },
  FULL_EXIT_CANDIDATE: {
    label: 'Exit',
    tone: 'text-red-400 border-red-500/40 bg-red-500/15'
  },
  PORTFOLIO_RISK_TRIM: {
    label: 'Risk Cap',
    tone: 'text-purple-300 border-purple-500/30 bg-purple-500/10'
  },
  DATA_UNAVAILABLE: {
    label: 'IPO (<40w)',
    tone: 'text-[var(--text-muted)] border-[var(--border-color)] bg-[var(--bg-card)]'
  }
};

function formatStateLabel(state) {
  if (!state || state === 'Initiated') return 'Initial Evaluation';
  switch (state) {
    case 'NORMAL': return 'Healthy Bull (Hold)';
    case 'WATCH': return 'Watchlist';
    case 'TECHNICAL_TRIM_CANDIDATE': return 'Technical Trim';
    case 'FUNDAMENTAL_TRIM_CANDIDATE': return 'Fundamental Trim';
    case 'FULL_EXIT_CANDIDATE': return 'Exit Candidate';
    case 'PORTFOLIO_RISK_TRIM': return 'Risk Cap Trim';
    case 'DATA_UNAVAILABLE': return 'Data Syncing';
    default: return state;
  }
}

function money(formatMoney, amount, compact = false, currency = 'INR') {
  if (amount === null || amount === undefined) return '—';
  if (currency === 'USD') {
    const num = Number(amount);
    if (isNaN(num)) return '—';
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return formatMoney(amount, compact);
}

function Metric({ label, value, detail, tone = 'text-inherit' }) {
  return (
    <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3 min-w-0 flex flex-col justify-between" title={typeof value === 'string' ? value : undefined}>
      <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] font-bold leading-tight">{label}</div>
      <div className={`mt-1 text-base font-black font-mono break-words leading-tight ${tone}`}>{value}</div>
      {detail && <div className="mt-1 text-[10px] text-[var(--text-secondary)] break-words leading-snug">{detail}</div>}
    </div>
  );
}

function StateBadge({ state, isCompounding, dataQuality }) {
  if (isCompounding) {
    return (
      <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold whitespace-nowrap text-emerald-400 dark:text-emerald-300 border-emerald-500/40 bg-emerald-500/15 flex items-center gap-1">
        <ShieldCheck className="w-3 h-3 text-emerald-400" /> Bull
      </span>
    );
  }
  if (state === 'DATA_UNAVAILABLE') {
    if (dataQuality === 'PRICE_HISTORY_QUOTE_MISMATCH') {
      return (
        <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold whitespace-nowrap text-amber-500 dark:text-amber-300 border-amber-500/30 bg-amber-500/10">
          Quote Gap
        </span>
      );
    }
    return (
      <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold whitespace-nowrap text-[var(--text-muted)] border-[var(--border-color)] bg-[var(--bg-card)]">
        IPO (&lt;40w)
      </span>
    );
  }
  const meta = STATE_META[state] || STATE_META.DATA_UNAVAILABLE;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold whitespace-nowrap ${meta.tone}`}>
      {meta.label}
    </span>
  );
}

// Client-side in-memory cache to make page switching instantaneous (< 1ms)
let cachedStockAnalysisData = null;

export default function StockAnalysisView({ holdings = [], onSelectHolding, initialTab }) {
  const { formatMoney, showSuccess, showError } = useThemeAuth();
  const [activeAnalysisMode, setActiveAnalysisMode] = useState(() => {
    if (initialTab && (initialTab === 'buy' || initialTab === 'sell' || initialTab === 'journal')) {
      return initialTab;
    }
    try {
      return localStorage.getItem('ladder_stock_analysis_tab') || 'buy';
    } catch {
      return 'buy';
    }
  });

  const handleModeChange = (mode) => {
    setActiveAnalysisMode(mode);
    try {
      localStorage.setItem('ladder_stock_analysis_tab', mode);
    } catch {}
  };

  const [buyStats, setBuyStats] = useState(() => {
    const cached = getClientBuyAnalysisCache();
    if (cached?.analyses) {
      const strongBuy = cached.analyses.filter(a => a.buySignal === 'STRONG_BUY').length;
      const buy = cached.analyses.filter(a => a.buySignal === 'BUY').length;
      const watch = cached.analyses.filter(a => a.buySignal === 'WATCH').length;
      return { strongBuy, buy, watch, total: cached.analyses.length };
    }
    return null;
  });

  const [market, setMarket] = useState('IN'); // 'IN' | 'US'
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('ALL'); // 'ALL' | 'COMPOUNDING' | 'WATCH' | 'TRIM' | 'RISK'
  const [selectedId, setSelectedId] = useState('');
  const [data, setData] = useState(() => cachedStockAnalysisData);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(() => !cachedStockAnalysisData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeDossierTab, setActiveDossierTab] = useState('TECHNICAL'); // 'TECHNICAL' | 'FUNDAMENTAL'
  const [maxWeight, setMaxWeight] = useState(() => cachedStockAnalysisData?.config?.maxPositionWeightPct ?? '');
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState('');

  const reload = async (silent = false, forceServerRefresh = false, refreshPrices = false) => {
    // silent=true: background refresh (spinner only); false: full loading state
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');
    try {
      let priceRefreshWarning = '';
      if (refreshPrices) {
        try {
          await axios.post('/api/refresh-prices', { trigger: 'MANUAL' });
        } catch (refreshError) {
          priceRefreshWarning = `Live price refresh failed; showing the latest available data. ${refreshError.response?.data?.error || refreshError.message}`;
        }
      }
      const params = forceServerRefresh ? { refresh: 'true' } : {};
      const response = await axios.get('/api/stock-intelligence/overview', { params });
      cachedStockAnalysisData = response.data;
      setData(response.data);
      setMaxWeight(response.data.config?.maxPositionWeightPct ?? '');
      if (priceRefreshWarning) setError(priceRefreshWarning);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not load stock analysis.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    reload(!!cachedStockAnalysisData);
    const timer = setInterval(() => reload(true), 15 * 60 * 1000);
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') reload(true);
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, []);

  const isUsMarket = market === 'US';
  const analyses = useMemo(() => {
    return isUsMarket ? (data?.usAnalyses || []) : (data?.analyses || []);
  }, [data, isUsMarket]);

  const summary = useMemo(() => {
    return isUsMarket ? data?.usSummary : data?.summary;
  }, [data, isUsMarket]);

  // When switching market tab, clear selectedId so first item in visible is selected
  useEffect(() => {
    setSelectedId('');
  }, [market]);

  const handleRefreshFundamentals = async (sym) => {
    setRefreshing(true);
    try {
      await axios.post('/api/stock-intelligence/refresh-fundamentals', { symbol: sym });
      await reload(true);
    } catch (e) {
      console.warn('Fundamentals refresh error:', e.message);
    } finally {
      setRefreshing(false);
    }
  };

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return analyses
      .filter(item => {
        const matchesSearch = !term || `${item.name} ${item.symbol} ${item.sector || ''} ${item.has4RedCandlesBelow21Ema ? '4 red candles 21 ema' : ''}`.toLowerCase().includes(term);
        if (!matchesSearch) return false;

        if (activeTab === 'COMPOUNDING') return item.compoundingShield?.isActive;
        if (activeTab === 'BREACH') return item.stopFloorBreached;
        if (activeTab === 'WATCH') return item.state === 'WATCH';
        if (activeTab === 'TRIM') return item.state === 'TECHNICAL_TRIM_CANDIDATE' || item.state === 'FUNDAMENTAL_TRIM_CANDIDATE' || item.state === 'FULL_EXIT_CANDIDATE';
        if (activeTab === 'RISK') return item.state === 'PORTFOLIO_RISK_TRIM';
        if (activeTab === 'FOUR_RED_EMA') return item.has4RedCandlesBelow21Ema;
        return true;
      })
      .sort((a, b) => {
        if (activeTab === 'ALL') {
          return (a.name || a.symbol || '').localeCompare(b.name || b.symbol || '', undefined, { sensitivity: 'base' });
        }
        const severity = {
          FULL_EXIT_CANDIDATE: 0,
          PORTFOLIO_RISK_TRIM: 1,
          TECHNICAL_TRIM_CANDIDATE: 2,
          FUNDAMENTAL_TRIM_CANDIDATE: 3,
          WATCH: 4,
          DATA_UNAVAILABLE: 5,
          NORMAL: 6
        };
        const sevDiff = (severity[a.state] ?? 7) - (severity[b.state] ?? 7);
        if (sevDiff !== 0) return sevDiff;
        return b.currentWeightPct - a.currentWeightPct;
      });
  }, [analyses, query, activeTab]);

  const activeId = visible.some(item => item.holdingId === selectedId) ? selectedId : visible[0]?.holdingId || '';
  const selected = analyses.find(item => item.holdingId === activeId);

  useEffect(() => {
    if (!activeId) {
      setHistory([]);
      return;
    }
    axios.get('/api/stock-intelligence/history', { params: { holdingId: activeId } })
      .then(response => setHistory(response.data.events || []))
      .catch(() => setHistory([]));
  }, [activeId]);

  const saveRiskLimit = async event => {
    event.preventDefault();
    setSavingConfig(true);
    setConfigMessage('');
    try {
      const response = await axios.post('/api/stock-intelligence/config', { maxPositionWeightPct: maxWeight });
      setData(current => ({ ...current, config: response.data.config }));
      setConfigMessage('Saved position ceiling. Recalculating allocations…');
      await reload(true);
    } catch (err) {
      setConfigMessage(err.response?.data?.error || 'Could not save position limit.');
    } finally {
      setSavingConfig(false);
    }
  };

  const clearRiskLimit = async () => {
    setSavingConfig(true);
    setConfigMessage('');
    try {
      await axios.post('/api/stock-intelligence/config', { maxPositionWeightPct: null });
      setMaxWeight('');
      setConfigMessage('Position limit disabled.');
      await reload(true);
    } catch (err) {
      setConfigMessage(err.response?.data?.error || 'Could not clear the position limit.');
    } finally {
      setSavingConfig(false);
    }
  };


  const [downloadingPlan, setDownloadingPlan] = useState(false);
  const [isActionPlanModalOpen, setIsActionPlanModalOpen] = useState(false);

  const handleDownloadActionPlan = async () => {
    if (downloadingPlan) return;
    setDownloadingPlan(true);
    try {
      const response = await axios.get('/api/stock-intelligence/action-plan-csv', {
        responseType: 'blob'
      });
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const todayStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `ladder_action_plan_${todayStr}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      if (showSuccess) showSuccess('Next Market Day Action Plan downloaded successfully!');
    } catch (err) {
      console.error('[Action Plan Download Error]:', err);
      if (showError) showError('Failed to download action plan: ' + (err.response?.data?.error || err.message));
    } finally {
      setDownloadingPlan(false);
    }
  };

  const priceChart = selected?.history || [];
  const returnTone = value => value === null || value === undefined ? 'text-[var(--text-muted)]' : value >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400';

  const counts = useMemo(() => {
    return {
      all: analyses.length,
      compounding: analyses.filter(i => i.compoundingShield?.isActive).length,
      breach: analyses.filter(i => i.stopFloorBreached).length,
      watch: analyses.filter(i => i.state === 'WATCH').length,
      trim: analyses.filter(i => i.state === 'TECHNICAL_TRIM_CANDIDATE' || i.state === 'FUNDAMENTAL_TRIM_CANDIDATE' || i.state === 'FULL_EXIT_CANDIDATE').length,
      risk: analyses.filter(i => i.state === 'PORTFOLIO_RISK_TRIM').length,
      fourRedEma: analyses.filter(i => i.has4RedCandlesBelow21Ema).length
    };
  }, [analyses]);

  const buyOpportunityCount = buyStats ? (buyStats.strongBuy + buyStats.buy) : 0;
  const sellCandidateCount = (counts.trim || 0) + (counts.risk || 0);

  return (
    <div className="space-y-5">
      {/* 1. Master Executive Stock Analysis Header */}
      <div className="reports-card rounded-3xl border border-[var(--border-color)] p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-600 dark:text-cyan-400">
              <SearchCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-[var(--text-primary)]">
                Stock Analysis
              </h2>
            </div>
          </div>


          <div className="flex items-center gap-3 flex-wrap">
            {/* Download Next Market Day Action Plan */}
            <button
              type="button"
              onClick={() => setIsActionPlanModalOpen(true)}
              className="flex items-center gap-2 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-gradient-to-r from-emerald-500/15 via-teal-500/15 to-cyan-500/15 border border-emerald-500/30 hover:border-emerald-500/60 text-emerald-600 dark:text-emerald-300 transition-all cursor-pointer shadow-sm hover:shadow active:scale-95"
              title="Open Next Market Day Action Plan (Capital Budgeting, Buys & Sells)"
            >
              <Sparkles className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
              <span className="hidden sm:inline">Next Day Action Plan</span>
              <span className="sm:hidden">Action Plan</span>
            </button>

            {/* Master Mode Switcher: Buy Analysis vs Sell Analysis */}
            <div className="flex items-center p-1 rounded-2xl border border-[var(--border-color)] reports-subcard shadow-inner">
            <button
              type="button"
              onClick={() => handleModeChange('buy')}
              className={`relative flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                activeAnalysisMode === 'buy'
                  ? 'text-emerald-500 dark:text-emerald-300'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {activeAnalysisMode === 'buy' && (
                <motion.div
                  layoutId="stockAnalysisModeIndicator"
                  className="absolute inset-0 bg-emerald-500/15 border border-emerald-500/40 rounded-xl shadow-sm"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <TrendingUp className="w-4 h-4 relative z-10" />
              <span className="relative z-10">Buy Analysis</span>
              {buyOpportunityCount > 0 && (
                <span className="relative z-10 text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-500 dark:text-emerald-300 border border-emerald-500/40">
                  {buyOpportunityCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleModeChange('sell')}
              className={`relative flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer ${
                activeAnalysisMode === 'sell'
                  ? 'text-rose-500 dark:text-rose-300'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {activeAnalysisMode === 'sell' && (
                <motion.div
                  layoutId="stockAnalysisModeIndicator"
                  className="absolute inset-0 bg-rose-500/15 border border-rose-500/40 rounded-xl shadow-sm"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <ShieldAlert className="w-4 h-4 relative z-10" />
              <span className="relative z-10">Sell Analysis</span>
              {sellCandidateCount > 0 && (
                <span className="relative z-10 text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-rose-500/20 text-rose-500 dark:text-rose-300 border border-rose-500/40">
                  {sellCandidateCount}
                </span>
              )}
            </button>
          </div>
          </div>
        </div>
      </div>

      {/* Main Content Area switching between Buy Analysis and Sell Analysis */}
      <AnimatePresence mode="wait">
        {activeAnalysisMode === 'buy' ? (
          <motion.div
            key="buy_analysis_pane"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            <BuyAnalysisView embedded={true} onStatsChange={setBuyStats} holdings={holdings} onSelectHolding={onSelectHolding} />
          </motion.div>
        ) : (
          <motion.div
            key="sell_analysis_pane"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="space-y-5"
          >
            {/* 2. Executive Hero Header for Sell & Exit Intelligence */}
            <div className="reports-card rounded-3xl border border-[var(--border-color)] p-4 md:p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-600 dark:text-rose-400">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-inherit">Sell & Risk Analysis</h3>
                  </div>
                </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Market Selector Pill Switcher */}
                    <div className="flex items-center p-1 rounded-2xl border border-[var(--border-color)] reports-subcard shadow-inner">
                      <button
                        onClick={() => setMarket('IN')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          !isUsMarket
                            ? 'bg-emerald-500/20 text-emerald-500 dark:text-emerald-300 border border-emerald-500/40 shadow-sm'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                        }`}
                      >
                        <span className="text-sm">🇮🇳</span>
                        <span>Indian Stocks</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-secondary)]">
                          {data?.analyses?.length || 0}
                        </span>
                      </button>
                      <button
                        onClick={() => setMarket('US')}
                        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          isUsMarket
                            ? 'bg-cyan-500/20 text-cyan-500 dark:text-cyan-300 border border-cyan-500/40 shadow-sm'
                            : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                        }`}
                      >
                        <span className="text-sm">🇺🇸</span>
                        <span>US Stocks</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[var(--bg-card)] border border-[var(--border-color)] text-[var(--text-secondary)]">
                          {data?.usAnalyses?.length || 0}
                        </span>
                      </button>
                    </div>

                    {data?.dataIntegrity && (
                      <div
                        className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-bold ${
                          data.dataIntegrity.status === 'VERIFIED_ACCURATE'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-300'
                            : 'border-amber-500/30 bg-amber-500/10 text-amber-500 dark:text-amber-300'
                        }`}
                        title={`Audited ${data.dataIntegrity.activeEquitiesAudited} stocks: ${data.dataIntegrity.reconciliationsApplied?.length || 0} feed bad ticks reconciled, ${data.dataIntegrity.corporateActionsVerified?.length || 0} corporate actions verified.`}
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Data Integrity: {data.dataIntegrity.dataHealthScorePct}%</span>
                      </div>
                    )}
                    <button
                      onClick={() => reload(true, true, true)}
                      disabled={refreshing || loading}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[var(--border-color)] reports-subcard text-[10px] font-bold text-[var(--text-secondary)] hover:text-emerald-500 dark:hover:text-emerald-400 hover:border-emerald-500/30 transition-colors cursor-pointer"
                    >
                      <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                      <span>Refresh</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mt-4">
                  <Metric
                    label="Active Stocks"
                    value={summary?.activePositions ?? '—'}
                  />
                  <Metric
                    label="Portfolio Value"
                    value={money(formatMoney, summary?.totalValueINR)}
                  />
                  <Metric
                    label="Unrealized P&L"
                    value={money(formatMoney, summary?.unrealizedPnlINR)}
                    tone={summary?.unrealizedPnlINR >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                  />
                  <Metric
                    label="Compounding Leaders"
                    value={counts.compounding}
                    tone="text-emerald-400"
                  />
                  <Metric
                    label="Floor Breaches"
                    value={counts.breach}
                    tone={counts.breach > 0 ? 'text-rose-400 font-black' : 'text-inherit'}
                    detail={counts.breach > 0 ? `${counts.breach} stop floors breached` : '0 breaches'}
                  />
                  <Metric
                    label="Positions for Review"
                    value={counts.trim + counts.risk}
                    tone={counts.trim > 0 ? 'text-rose-400' : 'text-inherit'}
                  />
                  <Metric
                    label="4 Red < 21 EMA"
                    value={counts.fourRedEma}
                    tone={counts.fourRedEma > 0 ? 'text-rose-400' : 'text-inherit'}
                    detail={counts.fourRedEma > 0 ? `${counts.fourRedEma} acute breakdowns` : '0 breakdowns'}
                  />
                </div>
              </div>

            {error && (
              <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300 flex items-center gap-2">
                <AlertOctagon className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

      {/* 2. Main Workspace Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] 2xl:grid-cols-[400px_1fr] gap-5 items-start">
        {/* Left Column: Filter Tabs, Search & Holdings List */}
        <div className="min-w-0">
          <section className="reports-card rounded-3xl border border-[var(--border-color)] p-4 sticky top-20 max-h-[calc(100vh-100px)] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-inherit">{isUsMarket ? 'US Equities' : 'Indian Equities'}</h3>
              <span className="text-[10px] text-[var(--text-muted)] font-mono">{visible.length} / {analyses.length}</span>
            </div>

            {/* Filter Tabs */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 mb-3 reports-subcard p-1.5 rounded-2xl border border-[var(--border-color)]">
              <button
                onClick={() => setActiveTab('ALL')}
                className={`py-1.5 px-2 text-[10px] font-bold rounded-xl transition-colors cursor-pointer ${activeTab === 'ALL' ? 'bg-emerald-500/20 text-emerald-500 dark:text-emerald-300 border border-emerald-500/30' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                All ({counts.all})
              </button>
              <button
                onClick={() => setActiveTab('COMPOUNDING')}
                className={`py-1.5 px-2 text-[10px] font-bold rounded-xl transition-colors flex items-center justify-center gap-1 cursor-pointer ${activeTab === 'COMPOUNDING' ? 'bg-emerald-500/20 text-emerald-500 dark:text-emerald-300 border border-emerald-500/30' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                <ShieldCheck className="w-3 h-3 text-emerald-400" /> Bull ({counts.compounding})
              </button>
              <button
                onClick={() => setActiveTab('BREACH')}
                className={`py-1.5 px-2 text-[10px] font-bold rounded-xl transition-colors flex items-center justify-center gap-1 cursor-pointer ${activeTab === 'BREACH' ? 'bg-rose-500/25 text-rose-500 dark:text-rose-300 border border-rose-500/40 shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                title="Holdings where current price has fallen below the trailing stop floor"
              >
                <AlertOctagon className="w-3 h-3 text-rose-400" /> Breach ({counts.breach})
              </button>
              <button
                onClick={() => setActiveTab('TRIM')}
                className={`py-1.5 px-2 text-[10px] font-bold rounded-xl transition-colors flex items-center justify-center gap-1 cursor-pointer ${activeTab === 'TRIM' ? 'bg-rose-500/20 text-rose-500 dark:text-rose-300 border border-rose-500/30' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
              >
                <AlertTriangle className="w-3 h-3 text-rose-400" /> Trim ({counts.trim})
              </button>
              <button
                onClick={() => setActiveTab('FOUR_RED_EMA')}
                className={`py-1.5 px-2 text-[10px] font-bold rounded-xl transition-colors flex items-center justify-center gap-1 cursor-pointer ${activeTab === 'FOUR_RED_EMA' ? 'bg-rose-500/25 text-rose-500 dark:text-rose-300 border border-rose-500/40 shadow-sm' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                title="Stocks with last 4 daily candles closed continuously Red below 21-day EMA and >= 5% below 21-EMA"
              >
                <CandlestickChart className="w-3 h-3 text-rose-400" /> 4 Red &lt; 21 EMA ({counts.fourRedEma})
              </button>
            </div>

            {/* Search Input */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search symbol, company, sector..."
                className="w-full rounded-xl border border-[var(--border-color)] reports-subcard py-2 pl-9 pr-8 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-emerald-500/50"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Holdings Scroll List - Uses Full Available Height */}
            <div className="space-y-1 overflow-y-auto custom-scrollbar pr-1 flex-1 min-h-0">
              {visible.map(item => (
                <button
                  key={item.holdingId}
                  onClick={() => setSelectedId(item.holdingId)}
                  title={item.name}
                  className={`w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors border cursor-pointer ${
                    activeId === item.holdingId
                      ? 'bg-emerald-500/15 border-emerald-500/40 shadow-sm'
                      : 'border-transparent hover:bg-[var(--bg-card)]'
                  }`}
                >
                  <HoldingLogo holding={item} className="w-7 h-7 rounded-lg shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-bold text-inherit leading-snug line-clamp-1" title={item.name}>
                        {item.name}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] flex items-center gap-1.5 font-mono">
                      <span>{item.symbol}</span>
                      <span>•</span>
                      <span>{item.currentWeightPct.toFixed(1)}% wt</span>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <StateBadge
                      state={item.state}
                      isCompounding={item.compoundingShield?.isActive}
                      dataQuality={item.dataQuality}
                    />
                  </div>
                </button>
              ))}
              {visible.length === 0 && !loading && (
                <div className="py-12 text-center text-xs text-[var(--text-muted)]">No holdings match the active filter.</div>
              )}
              {loading && (
                <div className="py-12 text-center text-xs text-[var(--text-muted)]">Evaluating technical and fundamental engines…</div>
              )}
            </div>
          </section>
        </div>

        {/* Right Column: In-Depth Dossier & Action Directives */}
        <div className="min-w-0">
          <div className="space-y-5">
            {!selected ? (
              <div className="reports-card rounded-3xl border border-[var(--border-color)] p-12 text-center text-sm text-[var(--text-muted)]">
                Select an Indian equity holding on the left to inspect technical, fundamental, and staged exit intelligence.
              </div>
            ) : (
              <>
                {/* Holding Header Card */}
                <section className="reports-card rounded-3xl border border-[var(--border-color)] p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <HoldingLogo holding={selected} className="w-12 h-12 rounded-2xl" />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-black text-inherit">{selected.name}</h3>
                          <span className="text-xs text-[var(--text-muted)] font-mono">{selected.symbol}</span>
                          <StateBadge state={selected.state} isCompounding={selected.compoundingShield?.isActive} dataQuality={selected.dataQuality} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                          <span>{selected.quantity.toLocaleString()} shares held</span>
                          <span>•</span>
                          <span>{selected.currentWeightPct.toFixed(2)}% of {isUsMarket ? 'US equity' : 'Indian equity'}</span>
                          {selected.sector && (
                            <>
                              <span>•</span>
                              <span>{selected.sector}</span>
                            </>
                          )}
                          <span>•</span>
                          <span>Quote date: {selected.quoteDate || 'Live'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {onSelectHolding && (
                          <button
                            onClick={() => onSelectHolding(holdings.find(h => String(h.id) === selected.holdingId))}
                            className="rounded-lg border border-[var(--border-color)] reports-subcard px-2 py-1 text-[10px] font-bold text-[var(--text-secondary)] hover:border-emerald-500/40 hover:text-emerald-500 dark:hover:text-emerald-300 transition-colors cursor-pointer"
                          >
                            Open Ledger
                          </button>
                        )}
                        <a
                          href={selected.fundamentals?.screenerUrl || (isUsMarket ? `https://finviz.com/quote.ashx?t=${encodeURIComponent(selected.symbol)}` : `https://www.screener.in/search/?q=${encodeURIComponent(selected.symbol)}`)}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-bold text-cyan-600 dark:text-cyan-300 hover:bg-cyan-500/20 flex items-center gap-1 transition-colors"
                        >
                          {isUsMarket ? 'Finviz.com' : 'Screener.in'} <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                        <a
                          href={isUsMarket ? `https://gocharting.com/terminal?ticker=NASDAQ:${encodeURIComponent(selected.symbol)}` : `https://gocharting.com/terminal?ticker=${selected.symbol?.endsWith('.BO') ? 'BSE:' : 'NSE:'}${encodeURIComponent((selected.symbol || '').replace(/\.(NS|BO)$/i, '').trim())}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-600 dark:text-amber-300 hover:bg-amber-500/20 flex items-center gap-1 transition-colors"
                          title="Open chart on GoCharting"
                        >
                          GoCharting <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* 2. PRICE & VALUATION STAT PILLS */}
                  {(() => {
                    const isUs = selected.currency === 'USD' || isUsMarket;
                    const curPrice = selected.currentPrice || 0;
                    const avgBuy = selected.avgBuyPrice || (selected.quantity > 0 ? ((selected.investedValue || selected.investedValueINR) / selected.quantity) : 0);
                    const nse = selected.nsePrice || 0;
                    const bse = selected.bsePrice || 0;
                    const investedVal = isUs ? (selected.investedValue || 0) : (selected.investedValueINR || 0);
                    const currentVal = isUs ? (selected.currentValue || (curPrice * selected.quantity)) : (selected.currentValueINR || 0);
                    const unpnl = currentVal - investedVal;
                    const pnlPct = investedVal > 0 ? (unpnl / investedVal) * 100 : 0;
                    const isPositive = unpnl >= 0;

                    let exchangeSub = null;
                    if (isUs) {
                      exchangeSub = `INR: ${money(formatMoney, selected.currentValueINR || 0)}`;
                    } else if (nse > 0 && bse > 0) {
                      exchangeSub = `NSE: ₹${nse} | BSE: ₹${bse}`;
                    } else if (nse > 0) {
                      exchangeSub = `NSE: ₹${nse}`;
                    } else if (bse > 0) {
                      exchangeSub = `BSE: ₹${bse}`;
                    }

                    return (
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3 flex flex-col justify-between">
                          <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] font-bold flex items-center justify-between">
                            <span>Close Price</span>
                            <span className="text-[10px] text-[var(--text-muted)] font-mono">
                              Val: {money(formatMoney, currentVal, true, isUs ? 'USD' : 'INR')}
                            </span>
                          </div>
                          <div className="mt-1 text-base font-black font-mono text-emerald-500 dark:text-emerald-400">
                            {money(formatMoney, curPrice, true, isUs ? 'USD' : 'INR')}
                          </div>
                          <div className="mt-1 text-[10px] text-[var(--text-muted)] font-mono">
                            {exchangeSub || 'Latest Market Quote'}
                          </div>
                        </div>

                        <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3 flex flex-col justify-between">
                          <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] font-bold">
                            Avg Buy Price
                          </div>
                          <div className="mt-1 text-base font-black font-mono text-inherit">
                            {money(formatMoney, avgBuy, true, isUs ? 'USD' : 'INR')}
                          </div>
                          <div className="mt-1 text-[10px] text-[var(--text-muted)] font-mono">
                            Invested: {money(formatMoney, investedVal, true, isUs ? 'USD' : 'INR')}{isUs && selected.investedValueINR ? ` (${money(formatMoney, selected.investedValueINR)})` : ''}
                          </div>
                        </div>

                        <div className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3 flex flex-col justify-between">
                          <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] font-bold">
                            Total Gain / Loss
                          </div>
                          <div className={`mt-1 text-base font-black font-mono ${isPositive ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                            {isPositive ? '+' : '-'}{money(formatMoney, Math.abs(unpnl), false, isUs ? 'USD' : 'INR')}
                          </div>
                          <div className="mt-1 text-[10px] font-mono font-bold flex items-center gap-2">
                            <span className={isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                              Abs: {isPositive ? '+' : ''}{pnlPct.toFixed(2)}%
                            </span>
                            {selected.xirrPct !== undefined && selected.xirrPct !== null && (
                              <>
                                <span className="text-[var(--text-muted)] font-normal">•</span>
                                <span className={Number(selected.xirrPct) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                                  XIRR: {Number(selected.xirrPct) >= 0 ? '+' : ''}{Number(selected.xirrPct).toFixed(2)}%
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 3. PRIMARY ACTION DIRECTIVE BANNER */}
                  {(() => {
                    const isCompounding = selected.compoundingShield?.isActive || selected.state === 'NORMAL';
                    const isRetestHold = selected.action === 'ACCUMULATION_RETEST';
                    const isTrim = selected.state === 'TECHNICAL_TRIM_CANDIDATE' || selected.state === 'FUNDAMENTAL_TRIM_CANDIDATE' || selected.state === 'PORTFOLIO_RISK_TRIM';
                    const isFullExit = selected.state === 'FULL_EXIT_CANDIDATE';
                    const isWatch = selected.state === 'WATCH';
                    const isNewListing = selected.state === 'DATA_UNAVAILABLE';
                    const isT1DoneHold = selected.stagedExitPlan?.tranche1?.status === 'COMPLETED'
                      && (selected.suggestedSellQuantity === 0 || !selected.suggestedSellQuantity)
                      && !isFullExit;

                    const actionType = isFullExit
                      ? 'EXIT'
                      : isRetestHold
                        ? 'RETEST_HOLD'
                        : isT1DoneHold
                          ? 'HOLD'
                          : isTrim
                            ? 'TRIM'
                            : isWatch
                              ? 'WATCH'
                              : isNewListing
                                ? 'IPO_HOLD'
                                : 'HOLD';

                    const actionTitle = isRetestHold
                      ? 'ACTION: HOLD (FRESH BUY RETEST)'
                      : isT1DoneHold
                        ? 'TRANCHE 1 COMPLETED — HOLDING CORE POSITION'
                        : (selected.stopFloorBreached && !isFullExit && (selected.suggestedSellQuantity > 0 || selected.totalActionShares > 0))
                          ? 'ACTION: STOP FLOOR BREACHED — REVIEW TRIM'
                          : ({
                          EXIT: 'ACTION: FULL EXIT (SELL ALL)',
                          TRIM: 'ACTION: TRIM POSITION',
                          WATCH: 'ACTION: HOLD (WATCH CLOSELY)',
                          IPO_HOLD: 'ACTION: HOLD (NEW LISTING)',
                          HOLD: 'ACTION: HOLD (DO NOT SELL)'
                        }[actionType]);

                    const actionTheme = {
                      EXIT: 'border-red-500/50 bg-red-500/[0.08] text-red-600 dark:text-red-300',
                      TRIM: 'border-rose-500/40 bg-rose-500/[0.07] text-rose-600 dark:text-rose-300',
                      WATCH: 'border-amber-500/40 bg-amber-500/[0.07] text-amber-600 dark:text-amber-300',
                      IPO_HOLD: 'border-cyan-500/30 bg-cyan-500/[0.06] text-cyan-600 dark:text-cyan-300',
                      RETEST_HOLD: 'border-cyan-500/40 bg-cyan-500/[0.07] text-cyan-600 dark:text-cyan-300',
                      HOLD: 'border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-600 dark:text-emerald-300'
                    }[actionType];

                    const sellQty = isFullExit
                      ? selected.quantity
                      : (isT1DoneHold || isRetestHold)
                        ? 0
                        : (isTrim || selected.stopFloorBreached)
                          ? (selected.suggestedSellQuantity || selected.totalActionShares || 0)
                          : 0;

                    const remainingShares = Math.max(0, selected.quantity - sellQty);

                    const curSymbol = (selected.currency === 'USD' || isUsMarket) ? '$' : '₹';
                    const stopFloor = selected.trailingFloorPrice || selected.compoundingShield?.trailingFloorPrice || selected.chandelierStopPrice;
                    const liveBufferPct = selected.liveBufferToTrailingFloorPct ?? (
                      Number(stopFloor) > 0 && Number(selected.currentPrice) > 0
                        ? Number(((Number(selected.currentPrice) / Number(stopFloor) - 1) * 100).toFixed(2))
                        : null
                    );
                    const reasonText = isFullExit
                      ? (selected.explanation || 'Both technical trend and quarterly fundamental growth have broken down. Exit complete position.')
                      : isRetestHold
                        ? (selected.explanation || 'Fresh buy within 5-day noise corridor. Holding through initial retest volatility without premature exit.')
                        : isT1DoneHold
                          ? (selected.explanation || `Tranche 1 de-risking trim completed. Holding core position until 30-week SMA breakdown.`)
                          : isTrim
                            ? (selected.explanation || `Price dropped below 30-week moving average. Sell ${sellQty} shares to de-risk.`)
                            : isWatch
                              ? (selected.explanation || `Price is consolidating near the 30-week average (${curSymbol}${selected.sma30Week || '—'}). Continue holding.`)
                              : isNewListing
                                ? (selected.invalidation || 'Recently listed stock (<40 weeks history). 30-week trend baseline is establishing. Hold position.')
                                : selected.stopFloorBreached
                                  ? `Live price ${curSymbol}${Number(selected.currentPrice).toFixed(2)} is at or below the stop floor (${curSymbol}${stopFloor || '—'}). Review the suggested trim; no trade is placed automatically.`
                                  : liveBufferPct !== null
                                    ? `Live price is ${Math.abs(liveBufferPct).toFixed(2)}% ${liveBufferPct >= 0 ? 'above' : 'below'} the stop floor (${curSymbol}${stopFloor || '—'}). ${liveBufferPct >= 0 ? 'Bull thesis remains above this stop level.' : 'Review the stop-breach signal and staged exit plan.'}`
                                    : 'Trailing stop floor is unavailable; refresh price history before relying on the sell analysis.';

                    return (
                      <div className={`mt-4 rounded-2xl border p-4 ${actionTheme}`}>
                        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                          <div className="flex items-center gap-2.5">
                            {actionType === 'EXIT' ? (
                              <AlertOctagon className="w-5 h-5 text-red-400 shrink-0" />
                            ) : actionType === 'TRIM' ? (
                              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
                            ) : actionType === 'WATCH' ? (
                              <Activity className="w-5 h-5 text-amber-400 shrink-0" />
                            ) : (actionType === 'IPO_HOLD' || actionType === 'RETEST_HOLD') ? (
                              <Clock3 className="w-5 h-5 text-cyan-400 shrink-0" />
                            ) : (
                              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                            )}
                            <span className="text-sm font-black uppercase tracking-wider">
                              {actionTitle}
                            </span>
                          </div>
                          <span className={`text-xs font-black font-mono px-3 py-1 rounded-full border ${
                            sellQty > 0
                              ? 'border-rose-500/50 bg-rose-500/20 text-rose-600 dark:text-rose-200'
                              : 'border-emerald-500/40 bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
                          }`}>
                            {sellQty > 0 ? `Sell: ${sellQty.toLocaleString()} shares` : 'Sell: 0 shares'}
                          </span>
                        </div>

                        <p className="text-xs leading-relaxed text-[var(--text-secondary)] mb-3">
                          {reasonText}
                        </p>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          <div className="rounded-xl border border-[var(--border-color)] reports-subcard p-2.5">
                            <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] font-bold">Action Needed</div>
                            <div className={`mt-0.5 text-sm font-black font-mono ${sellQty > 0 ? 'text-rose-500 dark:text-rose-300' : 'text-emerald-500 dark:text-emerald-300'}`}>
                              {sellQty > 0 ? `Sell ${sellQty.toLocaleString()} shs` : (isRetestHold ? 'HOLD (Retest Buffer)' : (isT1DoneHold ? 'HOLD (Tranche 1 Done)' : 'Do Not Sell'))}
                            </div>
                          </div>
                          <div className="rounded-xl border border-[var(--border-color)] reports-subcard p-2.5">
                            <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] font-bold">Keep Holding</div>
                            <div className="mt-0.5 text-sm font-black font-mono text-inherit">
                              {remainingShares.toLocaleString()} shares
                            </div>
                          </div>
                          <div className="rounded-xl border border-[var(--border-color)] reports-subcard p-2.5">
                            <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] font-bold">{isT1DoneHold ? 'Next Exit Trigger' : 'Trailing Stop Floor'}</div>
                            <div className="mt-0.5 text-sm font-black font-mono text-inherit">
                              {isT1DoneHold && selected.stagedExitPlan?.tranche2?.triggerPrice ? `30W-SMA ${curSymbol}${selected.stagedExitPlan.tranche2.triggerPrice}` : money(formatMoney, stopFloor, true)}
                            </div>
                          </div>
                          <div className="rounded-xl border border-[var(--border-color)] reports-subcard p-2.5">
                            <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] font-bold">Safety Cushion</div>
                            <div className="mt-0.5 text-sm font-black font-mono text-cyan-500 dark:text-cyan-300">
                              {liveBufferPct !== null ? `${liveBufferPct > 0 ? '+' : ''}${liveBufferPct.toFixed(2)}%` : '—'}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 4. STAGED MULTI-TRANCHE EXIT PLAN & EXECUTION TRACKER */}
                  {selected.stagedExitPlan && (
                    <div className="mt-4 rounded-2xl border border-[var(--border-color)] reports-subcard p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <Layers className="w-4 h-4 text-cyan-400" />
                          <h4 className="text-xs font-bold uppercase tracking-wider text-inherit">
                            Staged Multi-Tranche Exit Plan
                          </h4>
                        </div>
                      </div>

                      {/* Ledger Audit Status Message */}
                      {selected.stagedExitPlan.ledgerAudit?.auditMessage && (
                        <div className="mb-3 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] p-2.5 text-[10px] text-cyan-600 dark:text-cyan-200 flex items-center justify-between">
                          <span>{selected.stagedExitPlan.ledgerAudit.auditMessage}</span>
                          {selected.stagedExitPlan.ledgerAudit.recentSharesSold > 0 && (
                            <span className="font-bold text-emerald-500 dark:text-emerald-300 font-mono">
                              Locked {money(formatMoney, selected.stagedExitPlan.ledgerAudit.totalGrossProceedsLocked)}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Tranche 1 Card */}
                        <div className={`rounded-xl border p-3 flex flex-col justify-between ${
                          selected.stagedExitPlan.tranche1?.status === 'COMPLETED'
                            ? 'border-emerald-500/40 bg-emerald-500/[0.08]'
                            : selected.stagedExitPlan.tranche1?.status === 'READY'
                              ? 'border-rose-500/50 bg-rose-500/10'
                              : selected.stagedExitPlan.tranche1?.status === 'PENDING'
                              ? 'border-rose-500/30 bg-rose-500/[0.05]'
                              : 'border-[var(--border-color)] reports-subcard opacity-70'
                        }`}>
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="text-[10px] font-bold text-inherit">{selected.stagedExitPlan.tranche1?.name}</span>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                                selected.stagedExitPlan.tranche1?.status === 'COMPLETED'
                                   ? 'border-emerald-500/40 text-emerald-500 dark:text-emerald-300 bg-emerald-500/10'
                                  : selected.stagedExitPlan.tranche1?.status === 'READY'
                                    ? 'border-rose-500/40 text-rose-500 dark:text-rose-300 bg-rose-500/20'
                                  : 'border-amber-500/30 text-amber-500 dark:text-amber-300 bg-amber-500/10'
                              }`}>
                                {selected.stagedExitPlan.tranche1?.status}
                              </span>
                            </div>
                            <div className="text-base font-black font-mono text-inherit">
                              Sell {selected.stagedExitPlan.tranche1?.targetShares?.toLocaleString() ?? '—'} shares
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] mt-1">
                              First trigger: {(selected.currency === 'USD' || isUsMarket) ? '$' : '₹'}{selected.stagedExitPlan.tranche1?.triggerPrice}
                            </div>
                          </div>
                        </div>

                        {/* Tranche 2 Card (Dynamically evaluated on today's remaining shares) */}
                        <div className={`rounded-xl border p-3 flex flex-col justify-between ${
                          selected.stagedExitPlan.tranche2?.status === 'COMPLETED'
                            ? 'border-emerald-500/40 bg-emerald-500/[0.08]'
                            : selected.stagedExitPlan.tranche2?.status === 'READY'
                              ? 'border-rose-500/50 bg-rose-500/10'
                              : selected.stagedExitPlan.tranche2?.status === 'ARMED'
                                ? 'border-amber-500/30 bg-amber-500/[0.05]'
                                : 'border-[var(--border-color)] reports-subcard opacity-70'
                        }`}>
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="text-[10px] font-bold text-inherit">{selected.stagedExitPlan.tranche2?.name}</span>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                                selected.stagedExitPlan.tranche2?.status === 'COMPLETED'
                                  ? 'border-emerald-500/40 text-emerald-500 dark:text-emerald-300 bg-emerald-500/10'
                                  : selected.stagedExitPlan.tranche2?.status === 'READY'
                                    ? 'border-rose-500/40 text-rose-500 dark:text-rose-300 bg-rose-500/20'
                                    : selected.stagedExitPlan.tranche2?.status === 'ARMED'
                                      ? 'border-amber-500/30 text-amber-500 dark:text-amber-300 bg-amber-500/10'
                                      : 'border-[var(--border-color)] text-[var(--text-muted)]'
                              }`}>
                                {selected.stagedExitPlan.tranche2?.status}
                              </span>
                            </div>
                            <div className="text-base font-black font-mono text-inherit">
                              Sell {selected.stagedExitPlan.tranche2?.targetShares?.toLocaleString() ?? '—'} shares
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] mt-1">
                              Final trigger: {(selected.currency === 'USD' || isUsMarket) ? '$' : '₹'}{selected.stagedExitPlan.tranche2?.triggerPrice}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 5. PRINCIPAL HARVEST ("HOUSE MONEY") MILESTONE */}
                  {selected.principalHarvest?.isEligible && (
                    <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] p-3.5 flex items-start gap-3">
                      <Flame className="w-5 h-5 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-amber-600 dark:text-amber-300 uppercase tracking-wider">
                            Multi-Bagger Milestone: 100% Principal Harvest Eligible
                          </span>
                          <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 font-bold">
                            Gain: +{selected.principalHarvest.gainPct}%
                          </span>
                        </div>
                        <div className="pt-1 flex flex-wrap items-center gap-4 text-[10px] text-[var(--text-secondary)]">
                          <span>Sell <b>{selected.principalHarvest.sharesToHarvest} shares</b> to recover ₹{selected.principalHarvest.capitalRecoveredINR?.toLocaleString('en-IN', { maximumFractionDigits: 0 })} principal</span>
                          <span>•</span>
                          <span className="text-emerald-600 dark:text-emerald-300 font-bold">{selected.principalHarvest.remainingShares} shares ride risk-free</span>
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                {/* 6. DUAL-TAB DOSSIER: TECHNICAL VS FUNDAMENTAL ANALYSIS */}
                <section className="reports-card rounded-3xl border border-[var(--border-color)] p-5">
                  <div className="flex items-center justify-between border-b border-[var(--border-color)] pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setActiveDossierTab('TECHNICAL')}
                        className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors cursor-pointer ${activeDossierTab === 'TECHNICAL' ? 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-300 border border-cyan-500/30' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                      >
                        Technical Analysis & Trailing Stops
                      </button>
                      <button
                        onClick={() => setActiveDossierTab('FUNDAMENTAL')}
                        className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer ${activeDossierTab === 'FUNDAMENTAL' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                      >
                        {isUsMarket ? 'Finviz Institutional Fundamentals' : 'Screener.in Fundamentals & Health'}
                        {selected.fundamentals?.status === 'AVAILABLE' && (
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        )}
                      </button>
                    </div>
                  </div>

                  {activeDossierTab === 'TECHNICAL' ? (
                    <div className="space-y-4">
                      {/* 4 Red Candles < 21-EMA Alert Banner */}
                      {selected.has4RedCandlesBelow21Ema && (
                        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/[0.08] p-4 flex items-start gap-3">
                          <CandlestickChart className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                          <div className="flex-1 space-y-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-bold text-rose-500 dark:text-rose-300 uppercase tracking-wider flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                                4 Red Candles Below 21-Day Daily EMA Triggered
                              </span>
                              <span className="text-xs font-mono font-bold text-rose-500 dark:text-rose-400 bg-rose-500/15 border border-rose-500/40 px-2 py-0.5 rounded-lg">
                                {selected.distanceToDailyEma21Pct}% below 21-EMA
                              </span>
                            </div>
                            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                              The last 4 daily candles have closed continuously as Red and below the 21-day Daily EMA ({money(formatMoney, selected.dailyEma21, true, isUsMarket ? 'USD' : 'INR')}), with the latest close {Math.abs(selected.distanceToDailyEma21Pct)}% below the 21-day EMA (threshold: ≥ 5.0%). This reflects short-term distribution momentum.
                            </p>
                            {/* Itemized 4 candles breakdown */}
                            {selected.dailyCandlePatternDetails?.candles && (
                              <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                                {selected.dailyCandlePatternDetails.candles.map((c, idx) => (
                                  <div key={c.date} className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-2 text-[10px]">
                                    <div className="text-[var(--text-muted)] font-mono text-[9px] flex items-center justify-between">
                                      <span>Day -{4 - idx} ({c.date.slice(5)})</span>
                                      <span className="text-rose-500 dark:text-rose-400 font-bold">Red ✓</span>
                                    </div>
                                    <div className="font-mono font-bold text-inherit mt-1">
                                      Close: {money(formatMoney, c.close, true, isUsMarket ? 'USD' : 'INR')}
                                    </div>
                                    <div className="text-[9px] text-[var(--text-muted)] font-mono mt-0.5">
                                      21-EMA: {money(formatMoney, c.ema21, true, isUsMarket ? 'USD' : 'INR')}{c.diffPct !== null ? ` (${c.diffPct}%)` : ''}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Metric
                          label="Trend Stage"
                          value={selected.weinsteinStage ? `Stage ${selected.weinsteinStage}` : 'Stage —'}
                          tone={selected.weinsteinStage === 2 ? 'text-emerald-500 dark:text-emerald-400' : selected.weinsteinStage === 4 ? 'text-rose-500 dark:text-rose-400' : selected.weinsteinStage === 3 ? 'text-amber-500 dark:text-amber-300' : 'text-inherit'}
                          detail={selected.weinsteinStage === 2 ? 'Advancing Bull' : selected.weinsteinStage === 3 ? 'Distribution Top' : selected.weinsteinStage === 4 ? 'Decline / Bear' : selected.weinsteinStage === 1 ? 'Base Building' : 'Evaluating'}
                        />
                        <Metric
                          label="30-Week Average (Trend)"
                          value={selected.sma30Week ? money(formatMoney, selected.sma30Week, true, isUsMarket ? 'USD' : 'INR') : 'IPO (<40w)'}
                          detail={selected.sma30WeekFourWeekSlopePct !== null ? `4w slope: ${selected.sma30WeekFourWeekSlopePct >= 0 ? '+' : ''}${selected.sma30WeekFourWeekSlopePct.toFixed(1)}%` : 'Building baseline'}
                        />
                        <Metric
                          label="Trailing Stop (Exit Floor)"
                          value={selected.chandelierStopPrice ? money(formatMoney, selected.chandelierStopPrice, true, isUsMarket ? 'USD' : 'INR') : '—'}
                          tone={selected.currentPrice >= selected.chandelierStopPrice ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}
                          detail="3.0× ATR floor from peak"
                        />
                        <Metric
                          label="20-Week Peak & Drop"
                          value={selected.drawdownFrom20WeekHighPct !== null ? `${selected.drawdownFrom20WeekHighPct.toFixed(1)}%` : '—'}
                          tone={selected.drawdownFrom20WeekHighPct > -20 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}
                          detail={`Peak: ${money(formatMoney, selected.peak20WeekPrice, true, isUsMarket ? 'USD' : 'INR')}`}
                        />
                      </div>

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Metric
                          label="21-Day Daily EMA"
                          value={selected.dailyEma21 ? money(formatMoney, selected.dailyEma21, true, isUsMarket ? 'USD' : 'INR') : '—'}
                          tone={selected.has4RedCandlesBelow21Ema ? 'text-rose-500 dark:text-rose-400' : (selected.distanceToDailyEma21Pct !== null && selected.distanceToDailyEma21Pct >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-inherit')}
                          detail={selected.distanceToDailyEma21Pct !== null ? `${selected.distanceToDailyEma21Pct >= 0 ? '+' : ''}${selected.distanceToDailyEma21Pct}% vs 21-EMA` : 'Evaluating daily series'}
                        />
                        <Metric
                          label="Daily Red Breakdown"
                          value={selected.has4RedCandlesBelow21Ema ? 'Triggered (≥5%)' : `${selected.consecutiveDailyRedCandles || 0} Red Days`}
                          tone={selected.has4RedCandlesBelow21Ema ? 'text-rose-500 dark:text-rose-400' : 'text-inherit'}
                          detail={selected.has4RedCandlesBelow21Ema ? '4 Red Candles < 21-EMA' : (selected.consecutiveDailyBelowEma > 0 ? `${selected.consecutiveDailyBelowEma}d below 21-EMA` : 'Normal fluctuation')}
                        />
                        <Metric
                          label="Distance to 30w Trend"
                          value={selected.weeklyClose && selected.sma30Week ? `${((selected.weeklyClose / selected.sma30Week - 1) * 100).toFixed(2)}%` : '—'}
                          tone={selected.weeklyClose >= selected.sma30Week ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}
                          detail={selected.weeklyClose >= selected.sma30Week ? 'Trading above 30w line' : `${selected.weeksBelowAverage}w below 30w line`}
                        />
                        <Metric
                          label="Cushion to Stop Floor"
                          value={selected.bufferToTrailingFloorPct !== null ? `+${selected.bufferToTrailingFloorPct}%` : '—'}
                          tone="text-cyan-500 dark:text-cyan-400"
                          detail={`Stop floor: ${money(formatMoney, selected.trailingFloorPrice, true, isUsMarket ? 'USD' : 'INR')}`}
                        />
                      </div>

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Metric
                          label="30-Day Return"
                          value={selected.observed30DayReturn ? `${selected.observed30DayReturn.pct >= 0 ? '+' : ''}${selected.observed30DayReturn.pct.toFixed(2)}%` : '—'}
                          tone={returnTone(selected.observed30DayReturn?.pct)}
                          detail="Trailing 30 days"
                        />
                        <Metric
                          label="90-Day Return"
                          value={selected.observed90DayReturn ? `${selected.observed90DayReturn.pct >= 0 ? '+' : ''}${selected.observed90DayReturn.pct.toFixed(2)}%` : '—'}
                          tone={returnTone(selected.observed90DayReturn?.pct)}
                          detail="Trailing 90 days"
                        />
                      </div>

                      {/* Interactive Price Chart with 30w-SMA */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-xs font-bold text-inherit">Daily Adjusted Close Timeline</h5>
                          <span className="text-[10px] text-[var(--text-muted)] font-mono">{priceChart.length} stored trading days</span>
                        </div>
                        <div className="h-56 rounded-2xl border border-[var(--border-color)] reports-subcard p-2.5">
                          {priceChart.length > 1 ? (
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={priceChart}>
                                <XAxis
                                  dataKey="date"
                                  tick={{ fill: '#64748b', fontSize: 9 }}
                                  tickFormatter={v => v.slice(5)}
                                  minTickGap={30}
                                />
                                <YAxis
                                  domain={['auto', 'auto']}
                                  tick={{ fill: '#64748b', fontSize: 9 }}
                                  width={60}
                                  tickFormatter={v => isUsMarket ? `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                />
                                <Tooltip
                                  contentStyle={{
                                    background: 'var(--bg-surface)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 12,
                                    fontSize: 11,
                                    color: 'var(--text-primary)'
                                  }}
                                  labelStyle={{ color: 'var(--text-secondary)' }}
                                  formatter={value => [money(formatMoney, value, true, isUsMarket ? 'USD' : 'INR'), 'Close']}
                                />
                                <Line
                                  type="monotone"
                                  dataKey="price"
                                  stroke="#34d399"
                                  strokeWidth={2}
                                  dot={false}
                                  activeDot={{ r: 4 }}
                                />
                              </LineChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="h-full flex items-center justify-center text-xs text-[var(--text-muted)]">
                              Not enough stored daily closes to chart.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Fundamental Pillar Content */
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono text-[var(--text-muted)] uppercase">
                          {selected.fundamentals?.source || (isUsMarket ? 'Finviz Institutional' : 'Screener.in')}
                        </span>
                        {!isUsMarket && (
                          <button
                            onClick={() => handleRefreshFundamentals(selected.symbol)}
                            disabled={refreshing}
                            className="text-[10px] font-bold text-cyan-600 dark:text-cyan-300 hover:text-cyan-500 flex items-center gap-1 cursor-pointer"
                          >
                            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} /> Refresh Fundamentals
                          </button>
                        )}
                      </div>

                      {/* Row 1: Operating Margin, Profit Growth, Sales Growth, Promoter/Debt */}
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Metric
                          label={isUsMarket ? 'Operating Margin (OPM)' : 'Operating Margin (OPM)'}
                          value={selected.fundamentals?.latestOpmPct !== null && selected.fundamentals?.latestOpmPct !== undefined ? `${selected.fundamentals.latestOpmPct}%` : '—'}
                          tone={selected.fundamentals?.opmTrendDirection === 'EXPANDING' ? 'text-emerald-500 dark:text-emerald-400' : selected.fundamentals?.opmTrendDirection === 'CONTRACTING' ? 'text-rose-500 dark:text-rose-400' : 'text-inherit'}
                          detail={isUsMarket ? `Net Margin: ${selected.fundamentals?.netMarginPct ? `${selected.fundamentals.netMarginPct}%` : '—'}` : `Trend: ${selected.fundamentals?.opmTrendDirection || 'Stable'}`}
                        />
                        <Metric
                          label={isUsMarket ? 'YoY EPS Growth' : 'YoY Net Profit Growth'}
                          value={selected.fundamentals?.yoyPatGrowthPct !== null && selected.fundamentals?.yoyPatGrowthPct !== undefined ? `${selected.fundamentals.yoyPatGrowthPct >= 0 ? '+' : ''}${selected.fundamentals.yoyPatGrowthPct}%` : '—'}
                          tone={selected.fundamentals?.yoyPatGrowthPct >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}
                          detail={isUsMarket ? (selected.fundamentals?.qoqPatGrowthPct ? `QoQ: ${selected.fundamentals.qoqPatGrowthPct >= 0 ? '+' : ''}${selected.fundamentals.qoqPatGrowthPct}%` : 'Annualized trend') : (selected.fundamentals?.latestQuarter ? `Quarter: ${selected.fundamentals.latestQuarter}` : 'Latest reporting')}
                        />
                        <Metric
                          label="YoY Sales Growth"
                          value={selected.fundamentals?.yoySalesGrowthPct !== null && selected.fundamentals?.yoySalesGrowthPct !== undefined ? `${selected.fundamentals.yoySalesGrowthPct >= 0 ? '+' : ''}${selected.fundamentals.yoySalesGrowthPct}%` : '—'}
                          tone={selected.fundamentals?.yoySalesGrowthPct >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}
                          detail={isUsMarket ? (selected.fundamentals?.qoqSalesGrowthPct ? `QoQ: ${selected.fundamentals.qoqSalesGrowthPct >= 0 ? '+' : ''}${selected.fundamentals.qoqSalesGrowthPct}%` : 'Revenue growth') : (selected.fundamentals?.latestSalesCr ? `₹${selected.fundamentals.latestSalesCr} Cr sales` : 'Quarterly revenue')}
                        />
                        <Metric
                          label={isUsMarket ? 'Debt to Equity' : 'Promoter Pledging'}
                          value={isUsMarket ? (selected.fundamentals?.debtToEquity !== null && selected.fundamentals?.debtToEquity !== undefined ? `${selected.fundamentals.debtToEquity}x` : '0 (Zero Debt)') : (selected.fundamentals?.promoterPledgePct > 0 ? `${selected.fundamentals.promoterPledgePct}%` : '0% (Clean)')}
                          tone={isUsMarket ? (selected.fundamentals?.debtToEquity > 1.5 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-500 dark:text-emerald-400') : (selected.fundamentals?.promoterPledgePct > 15 ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-500 dark:text-emerald-400')}
                          detail={isUsMarket ? `Current Ratio: ${selected.fundamentals?.currentRatio ? `${selected.fundamentals.currentRatio}x` : 'Solid'}` : `Holding: ${selected.fundamentals?.promoterHoldingPct ? `${selected.fundamentals.promoterHoldingPct}%` : 'N/A'}`}
                        />
                      </div>

                      {/* Row 2: Valuation Multiples & Returns */}
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Metric
                          label={isUsMarket ? 'P/E (TTM / Forward)' : 'Stock P/E Ratio'}
                          value={selected.fundamentals?.peRatio ? `${selected.fundamentals.peRatio}x` : '—'}
                          detail={isUsMarket && selected.fundamentals?.forwardPe ? `Fwd P/E: ${selected.fundamentals.forwardPe}x (PEG: ${selected.fundamentals?.pegRatio || '—'})` : 'Valuation multiple'}
                        />
                        <Metric
                          label={isUsMarket ? 'Gross Margin %' : 'ROCE %'}
                          value={isUsMarket ? (selected.fundamentals?.grossMarginPct ? `${selected.fundamentals.grossMarginPct}%` : '—') : (selected.fundamentals?.rocePct ? `${selected.fundamentals.rocePct}%` : '—')}
                          tone={isUsMarket ? 'text-emerald-500 dark:text-emerald-400' : (selected.fundamentals?.rocePct > 20 ? 'text-emerald-500 dark:text-emerald-400' : 'text-inherit')}
                          detail={isUsMarket ? 'Gross profitability' : 'Return on capital'}
                        />
                        <Metric
                          label="ROE %"
                          value={selected.fundamentals?.roePct ? `${selected.fundamentals.roePct}%` : '—'}
                          tone={selected.fundamentals?.roePct > 15 ? 'text-emerald-500 dark:text-emerald-400' : 'text-inherit'}
                          detail={isUsMarket ? `ROA: ${selected.fundamentals?.roaPct ? `${selected.fundamentals.roaPct}%` : '—'}` : 'Return on equity'}
                        />
                        <Metric
                          label={isUsMarket ? 'Market Cap' : 'Market Cap Category'}
                          value={isUsMarket ? (selected.fundamentals?.marketCap || 'Mega Cap') : (selected.fundamentals?.marketCapCr ? `₹${Number(selected.fundamentals.marketCapCr).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr` : '—')}
                          detail={selected.sector || (isUsMarket ? 'US Equities' : 'Equities')}
                        />
                      </div>

                      {/* 4-Quarter OPM History (if available) */}
                      {selected.fundamentals?.opmHistory?.length > 0 && (
                        <div className="rounded-2xl border border-[var(--border-color)] reports-subcard p-3.5">
                          <h5 className="text-xs font-bold text-inherit mb-2.5">Quarterly Operating Margin (OPM %) Trajectory</h5>
                          <div className="grid grid-cols-4 gap-2">
                            {selected.fundamentals.opmHistory.map((q, idx) => (
                              <div key={idx} className="reports-subcard p-2 rounded-xl text-center border border-[var(--border-color)]">
                                <div className="text-[9px] text-[var(--text-muted)] font-bold">{q.quarter}</div>
                                <div className="text-sm font-black font-mono text-cyan-600 dark:text-cyan-300 mt-1">{q.opm}%</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {/* 7. POSITION RISK LIMIT CONFIGURATION */}
                <section className="reports-card rounded-3xl border border-[var(--border-color)] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Settings2 className="w-4 h-4 text-cyan-500 dark:text-cyan-400" />
                      <h3 className="text-sm font-bold text-inherit">Position Concentration Risk Guard</h3>
                    </div>
                    <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full border ${
                      data?.config?.maxPositionWeightPct
                        ? 'border-cyan-500/40 text-cyan-600 dark:text-cyan-300 bg-cyan-500/10 font-bold'
                        : 'border-[var(--border-color)] text-[var(--text-muted)] reports-subcard'
                    }`}>
                      {data?.config?.maxPositionWeightPct ? `Active Cap: ${data.config.maxPositionWeightPct}%` : 'No Cap (Positions Unconstrained)'}
                    </span>
                  </div>
                  <form onSubmit={saveRiskLimit} className="flex flex-wrap items-end gap-3 mt-3">
                    <label className="text-[10px] text-[var(--text-muted)]">
                      Maximum weight cap within Indian equities (%)
                      <input
                        type="number"
                        min="0.1"
                        max="100"
                        step="0.1"
                        value={maxWeight}
                        onChange={event => setMaxWeight(event.target.value)}
                        placeholder="Optional (e.g. 15.0%)"
                        className="mt-1 block w-44 rounded-xl border border-[var(--border-color)] reports-subcard px-3 py-2 text-xs text-inherit outline-none focus:border-cyan-500/50"
                      />
                    </label>
                    <button
                      disabled={savingConfig}
                      className="rounded-xl bg-cyan-500/15 border border-cyan-500/30 px-3 py-2 text-[10px] font-bold text-cyan-600 dark:text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      {savingConfig ? 'Saving…' : 'Save Cap'}
                    </button>
                    <button
                      type="button"
                      disabled={savingConfig}
                      onClick={clearRiskLimit}
                      className="rounded-xl border border-[var(--border-color)] reports-subcard px-3 py-2 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-cyan-500/50 disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      Disable Limit
                    </button>
                    {configMessage && <span className="text-[10px] text-[var(--text-muted)]">{configMessage}</span>}
                  </form>
                </section>

                {/* 8. STATE TRANSITION AUDIT TRAIL */}
                {history.length > 0 && (
                  <section className="reports-card rounded-3xl border border-[var(--border-color)] p-4">
                    <div className="flex items-center justify-between text-xs font-bold text-inherit mb-2.5">
                      <div className="flex items-center gap-2">
                        <History className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                        <span>State History ({history.length} events)</span>
                      </div>
                    </div>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                      {history.slice(0, 8).map(event => (
                        <div key={event.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] p-2 rounded-xl reports-subcard border border-[var(--border-color)]">
                          <span className="text-[var(--text-secondary)] font-medium flex items-center gap-1.5">
                            <span>{formatStateLabel(event.from)}</span>
                            <span className="text-[var(--text-muted)]">→</span>
                            <span className="text-emerald-500 dark:text-emerald-400 font-bold">{formatStateLabel(event.to)}</span>
                          </span>
                          <span className="text-[var(--text-muted)] font-mono text-[9px]">
                            {new Date(event.at).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}, {new Date(event.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ActionPlanModal
        isOpen={isActionPlanModalOpen}
        onClose={() => setIsActionPlanModalOpen(false)}
      />
    </div>
  );
}
