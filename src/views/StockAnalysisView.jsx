import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CandlestickChart,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Flame,
  History,
  Layers,
  RefreshCw,
  Scale,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp
} from 'lucide-react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import HoldingLogo from '../components/HoldingLogo';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';

const STATE_META = {
  NORMAL: {
    label: 'Compounding / Normal',
    tone: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
  },
  WATCH: {
    label: 'Watch (Observe)',
    tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10'
  },
  TECHNICAL_TRIM_CANDIDATE: {
    label: 'Technical Trim',
    tone: 'text-rose-300 border-rose-500/30 bg-rose-500/10'
  },
  FUNDAMENTAL_TRIM_CANDIDATE: {
    label: 'Fundamental Trim',
    tone: 'text-orange-300 border-orange-500/30 bg-orange-500/10'
  },
  FULL_EXIT_CANDIDATE: {
    label: 'Full Exit Review',
    tone: 'text-red-400 border-red-500/40 bg-red-500/15'
  },
  PORTFOLIO_RISK_TRIM: {
    label: 'Risk Limit Trim',
    tone: 'text-purple-300 border-purple-500/30 bg-purple-500/10'
  },
  DATA_UNAVAILABLE: {
    label: 'Insufficient History',
    tone: 'text-slate-400 border-slate-600/50 bg-white/[0.03]'
  }
};

function money(formatMoney, amount, compact = false) {
  return amount === null || amount === undefined ? '—' : formatMoney(amount, compact);
}

function Metric({ label, value, detail, tone = 'text-inherit' }) {
  return (
    <div className="reports-subcard rounded-2xl border border-slate-800/70 p-3.5 min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 font-bold">{label}</div>
      <div className={`mt-1.5 text-base font-black font-mono truncate ${tone}`}>{value}</div>
      {detail && <div className="mt-1 text-[9px] leading-relaxed text-slate-500">{detail}</div>}
    </div>
  );
}

function StateBadge({ state, isCompounding }) {
  if (isCompounding) {
    return (
      <span className="rounded-full border px-2 py-0.5 text-[9px] font-bold whitespace-nowrap text-emerald-300 border-emerald-500/40 bg-emerald-500/15 flex items-center gap-1">
        <ShieldCheck className="w-3 h-3 text-emerald-400" /> Compounding Active
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

export default function StockAnalysisView({ holdings = [], onSelectHolding }) {
  const { formatMoney } = useThemeAuth();
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('ALL'); // 'ALL' | 'COMPOUNDING' | 'WATCH' | 'TRIM' | 'RISK'
  const [selectedId, setSelectedId] = useState('');
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeDossierTab, setActiveDossierTab] = useState('TECHNICAL'); // 'TECHNICAL' | 'FUNDAMENTAL'
  const [maxWeight, setMaxWeight] = useState('');
  const [savingConfig, setSavingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState('');

  const reload = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const response = await axios.get('/api/stock-intelligence/overview');
      setData(response.data);
      setMaxWeight(response.data.config?.maxPositionWeightPct ?? '');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Could not load stock analysis.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    reload();
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

  const analyses = data?.analyses || [];

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
        const matchesSearch = !term || `${item.name} ${item.symbol} ${item.sector || ''}`.toLowerCase().includes(term);
        if (!matchesSearch) return false;

        if (activeTab === 'COMPOUNDING') return item.compoundingShield?.isActive;
        if (activeTab === 'WATCH') return item.state === 'WATCH';
        if (activeTab === 'TRIM') return item.state === 'TECHNICAL_TRIM_CANDIDATE' || item.state === 'FUNDAMENTAL_TRIM_CANDIDATE' || item.state === 'FULL_EXIT_CANDIDATE';
        if (activeTab === 'RISK') return item.state === 'PORTFOLIO_RISK_TRIM';
        return true;
      })
      .sort((a, b) => {
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

  const summary = data?.summary;
  const priceChart = selected?.history || [];
  const returnTone = value => value === null || value === undefined ? 'text-slate-400' : value >= 0 ? 'text-emerald-400' : 'text-rose-400';

  const counts = useMemo(() => {
    return {
      all: analyses.length,
      compounding: analyses.filter(i => i.compoundingShield?.isActive).length,
      watch: analyses.filter(i => i.state === 'WATCH').length,
      trim: analyses.filter(i => i.state === 'TECHNICAL_TRIM_CANDIDATE' || i.state === 'FUNDAMENTAL_TRIM_CANDIDATE' || i.state === 'FULL_EXIT_CANDIDATE').length,
      risk: analyses.filter(i => i.state === 'PORTFOLIO_RISK_TRIM').length
    };
  }, [analyses]);

  return (
    <AnimatedPage className="space-y-5">
      {/* 1. Executive Hero Header */}
      <AnimatedItem>
        <div className="glass-card rounded-3xl border border-slate-800 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-emerald-400 mb-1.5">
                <CandlestickChart className="w-4 h-4" />
                <span className="text-[10px] font-bold tracking-[0.16em] uppercase">Decision Support Hub</span>
              </div>
              <h2 className="text-2xl font-black text-inherit">Stock Analysis & Exit Intelligence</h2>
              <p className="mt-1 text-xs text-slate-400">
                Dual-Pillar (Technical + Screener Fundamentals) analysis and dynamic multi-tranche execution tracking for Indian equities.
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[10px] font-bold text-cyan-200 flex items-center gap-1.5">
                <Clock3 className="w-3 h-3 text-cyan-400" /> Runs Daily at 06:30 PM IST · Live Ticker Sync
              </span>
              <button
                onClick={() => reload(false)}
                disabled={refreshing || loading}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-emerald-400 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                <span>Refresh Live Analytics</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-5">
            <Metric
              label="Active Indian Stocks"
              value={summary?.activePositions ?? '—'}
              detail="Total positions tracked"
            />
            <Metric
              label="Indian Equity Value"
              value={money(formatMoney, summary?.totalValueINR)}
              detail="Live portfolio value"
            />
            <Metric
              label="Open Unrealized P&L"
              value={money(formatMoney, summary?.unrealizedPnlINR)}
              tone={summary?.unrealizedPnlINR >= 0 ? 'text-emerald-400' : 'text-rose-400'}
              detail={`Cost basis ${money(formatMoney, summary?.totalCostINR)}`}
            />
            <Metric
              label="Compounding Leaders"
              value={counts.compounding}
              tone="text-emerald-400"
              detail="Stage 2 Bull · Protected from early sale"
            />
            <Metric
              label="Positions for Review"
              value={counts.trim + counts.risk}
              tone={counts.trim > 0 ? 'text-rose-400' : 'text-inherit'}
              detail={`${counts.trim} breakdown/trim · ${counts.risk} risk cap`}
            />
          </div>
        </div>
      </AnimatedItem>

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-300 flex items-center gap-2">
          <AlertOctagon className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* 2. Main Workspace Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,2fr)] gap-5">
        {/* Left Column: Filter Tabs, Search & Holdings List */}
        <AnimatedItem>
          <section className="glass-card rounded-3xl border border-slate-800 p-4 h-full flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-inherit">Holdings Workspace</h3>
              <span className="text-[10px] text-slate-500 font-mono">{visible.length} / {analyses.length}</span>
            </div>

            {/* Filter Tabs */}
            <div className="grid grid-cols-3 gap-1.5 mb-3 bg-slate-950/40 p-1.5 rounded-2xl border border-slate-800/80">
              <button
                onClick={() => setActiveTab('ALL')}
                className={`py-1.5 px-2 text-[10px] font-bold rounded-xl transition-colors ${activeTab === 'ALL' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'}`}
              >
                All ({counts.all})
              </button>
              <button
                onClick={() => setActiveTab('COMPOUNDING')}
                className={`py-1.5 px-2 text-[10px] font-bold rounded-xl transition-colors flex items-center justify-center gap-1 ${activeTab === 'COMPOUNDING' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <ShieldCheck className="w-3 h-3 text-emerald-400" /> Bull ({counts.compounding})
              </button>
              <button
                onClick={() => setActiveTab('TRIM')}
                className={`py-1.5 px-2 text-[10px] font-bold rounded-xl transition-colors flex items-center justify-center gap-1 ${activeTab === 'TRIM' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <AlertTriangle className="w-3 h-3 text-rose-400" /> Trim ({counts.trim})
              </button>
            </div>

            {/* Search Input */}
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search symbol, company, sector..."
                className="w-full rounded-xl border border-slate-800 bg-slate-950/30 py-2 pl-9 pr-3 text-xs text-inherit outline-none focus:border-emerald-500/50"
              />
            </div>

            {/* Holdings Scroll List */}
            <div className="space-y-1.5 max-h-[620px] overflow-y-auto custom-scrollbar pr-1 flex-1">
              {visible.map(item => (
                <button
                  key={item.holdingId}
                  onClick={() => setSelectedId(item.holdingId)}
                  className={`w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition-colors border ${
                    activeId === item.holdingId
                      ? 'bg-emerald-500/10 border-emerald-500/30'
                      : 'border-transparent hover:bg-white/[0.03]'
                  }`}
                >
                  <HoldingLogo holding={item} className="w-8 h-8 rounded-xl shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-bold text-inherit">{item.name}</span>
                    <span className="block text-[10px] text-slate-500">
                      {item.symbol} · {item.currentWeightPct.toFixed(1)}% wt
                    </span>
                  </span>
                  <div className="shrink-0 text-right">
                    <StateBadge state={item.state} isCompounding={item.compoundingShield?.isActive} />
                  </div>
                </button>
              ))}
              {visible.length === 0 && !loading && (
                <div className="py-12 text-center text-xs text-slate-500">No holdings match the active filter.</div>
              )}
              {loading && (
                <div className="py-12 text-center text-xs text-slate-500">Evaluating technical and fundamental engines…</div>
              )}
            </div>
          </section>
        </AnimatedItem>

        {/* Right Column: In-Depth Dossier & Action Directives */}
        <AnimatedItem delay={0.05}>
          <div className="space-y-5">
            {!selected ? (
              <div className="glass-card rounded-3xl border border-slate-800 p-12 text-center text-sm text-slate-500">
                Select an Indian equity holding on the left to inspect technical, fundamental, and staged exit intelligence.
              </div>
            ) : (
              <>
                {/* Holding Header Card */}
                <section className="glass-card rounded-3xl border border-slate-800 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <HoldingLogo holding={selected} className="w-12 h-12 rounded-2xl" />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-xl font-black text-inherit">{selected.name}</h3>
                          <span className="text-xs text-slate-400 font-mono">{selected.symbol}</span>
                          <StateBadge state={selected.state} isCompounding={selected.compoundingShield?.isActive} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                          <span>{selected.quantity.toLocaleString()} shares held</span>
                          <span>•</span>
                          <span>{selected.currentWeightPct.toFixed(2)}% of Indian equity</span>
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
                      <div className="text-xl font-black font-mono text-inherit">
                        {money(formatMoney, selected.currentValueINR)}
                      </div>
                      <div className="text-xs font-mono text-slate-400">
                        {money(formatMoney, selected.currentPrice, true)} / share
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {onSelectHolding && (
                          <button
                            onClick={() => onSelectHolding(holdings.find(h => String(h.id) === selected.holdingId))}
                            className="rounded-lg border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-300 hover:border-emerald-500/40 hover:text-emerald-300 transition-colors"
                          >
                            Open Ledger
                          </button>
                        )}
                        <a
                          href={selected.fundamentals?.screenerUrl || `https://www.screener.in/search/?q=${encodeURIComponent(selected.symbol)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-bold text-cyan-300 hover:bg-cyan-500/20 flex items-center gap-1 transition-colors"
                        >
                          Screener.in <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* 3. PRIMARY ACTION DIRECTIVE BANNER */}
                  {selected.compoundingShield?.isActive ? (
                    /* Anti-Early-Exit Compounding Shield Banner */
                    <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.08] p-4">
                      <div className="flex gap-3 items-start">
                        <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                        <div className="space-y-1.5 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                              Compounding Active · Stage 2 Bull Runner
                            </span>
                            <span className="text-[10px] font-bold font-mono text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30">
                              Trailing Stop Floor: {money(formatMoney, selected.compoundingShield.trailingFloorPrice, true)} (+{selected.compoundingShield.bufferToTrailingFloorPct}% cushion)
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed text-slate-200">
                            {selected.compoundingShield.message}
                          </p>
                          <div className="pt-1 flex flex-wrap items-center gap-4 text-[10px] font-semibold text-slate-300">
                            <span>✓ Recommended Action: <b className="text-emerald-300">HOLD & LET RUNNER COMPOUND</b></span>
                            <span>✓ Suggested Sell Quantity: <b className="text-emerald-300">0 shares</b></span>
                            <span>✓ Rule Gate: Requires 3 weekly closes below falling SMA to alter thesis</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Active Trim / Exit Recommendation Banner */
                    <div className={`mt-4 rounded-2xl border p-4 ${
                      selected.state === 'FULL_EXIT_CANDIDATE'
                        ? 'border-red-500/40 bg-red-500/[0.08]'
                        : selected.state === 'TECHNICAL_TRIM_CANDIDATE' || selected.state === 'FUNDAMENTAL_TRIM_CANDIDATE'
                          ? 'border-rose-500/30 bg-rose-500/[0.07]'
                          : selected.state === 'PORTFOLIO_RISK_TRIM'
                            ? 'border-purple-500/30 bg-purple-500/[0.07]'
                            : 'border-slate-800 bg-slate-900/40'
                    }`}>
                      <div className="flex gap-3 items-start">
                        {selected.state === 'FULL_EXIT_CANDIDATE' ? (
                          <AlertOctagon className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                        ) : selected.state === 'PORTFOLIO_RISK_TRIM' ? (
                          <Scale className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
                        ) : selected.state === 'TECHNICAL_TRIM_CANDIDATE' || selected.state === 'FUNDAMENTAL_TRIM_CANDIDATE' ? (
                          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                        ) : (
                          <Activity className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                        )}

                        <div className="space-y-2 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                              System Action Directive
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              {selected.state}
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed text-slate-200">
                            {selected.explanation}
                          </p>

                          {selected.suggestedSellQuantity ? (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5">
                                <div className="text-[9px] uppercase tracking-wider text-rose-300 font-bold">Suggested Trim Quantity</div>
                                <div className="mt-1 text-base font-black font-mono text-rose-200">
                                  {selected.suggestedSellQuantity.toLocaleString()} shares
                                </div>
                                <div className="text-[9px] text-rose-300/80">
                                  {((selected.suggestedSellQuantity / selected.quantity) * 100).toFixed(0)}% of current held shares
                                </div>
                              </div>
                              <div className="rounded-xl border border-slate-700 bg-slate-950/40 p-2.5">
                                <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Est. Gross Proceeds</div>
                                <div className="mt-1 text-base font-black font-mono text-inherit">
                                  {money(formatMoney, selected.estimatedGrossProceedsINR)}
                                </div>
                                <div className="text-[9px] text-slate-500">
                                  At reference quote {money(formatMoney, selected.currentPrice, true)}
                                </div>
                              </div>
                              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-2.5">
                                <div className="text-[9px] uppercase tracking-wider text-emerald-300 font-bold">Shares Left to Ride</div>
                                <div className="mt-1 text-base font-black font-mono text-emerald-200">
                                  {(selected.quantity - selected.suggestedSellQuantity).toLocaleString()} shares
                                </div>
                                <div className="text-[9px] text-emerald-300/80">
                                  Preserves core compounder position
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-2 text-[10px] text-slate-400">
                              {selected.state === 'WATCH' ? 'Under observation: Wait for confirmation before considering any sale.' : 'No sale quantity triggered.'}
                            </div>
                          )}

                          {selected.sizingMethod && (
                            <p className="text-[10px] leading-relaxed text-slate-400 italic">
                              <b>Sizing Rationale:</b> {selected.sizingMethod}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 4. STAGED MULTI-TRANCHE EXIT PLAN & EXECUTION TRACKER */}
                  {selected.stagedExitPlan && (
                    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          <Layers className="w-4 h-4 text-cyan-400" />
                          <h4 className="text-xs font-bold uppercase tracking-wider text-inherit">
                            Staged Multi-Tranche Exit Plan & Ledger Execution Tracker
                          </h4>
                        </div>
                        <span className="text-[10px] text-slate-500">
                          Tracks intermediate sales & buys dynamically
                        </span>
                      </div>

                      {/* Ledger Audit Status Message */}
                      {selected.stagedExitPlan.ledgerAudit?.auditMessage && (
                        <div className="mb-3 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] p-2.5 text-[10px] text-cyan-200 flex items-center justify-between">
                          <span>{selected.stagedExitPlan.ledgerAudit.auditMessage}</span>
                          {selected.stagedExitPlan.ledgerAudit.recentSharesSold > 0 && (
                            <span className="font-bold text-emerald-300 font-mono">
                              Locked {money(formatMoney, selected.stagedExitPlan.ledgerAudit.totalGrossProceedsLocked)}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* Tranche 1 Card */}
                        <div className={`rounded-xl border p-3 flex flex-col justify-between ${
                          selected.stagedExitPlan.tranche1?.status === 'COMPLETED'
                            ? 'border-emerald-500/40 bg-emerald-500/[0.08]'
                            : selected.stagedExitPlan.tranche1?.status === 'PENDING'
                              ? 'border-rose-500/30 bg-rose-500/[0.05]'
                              : 'border-slate-800 bg-slate-900/30 opacity-70'
                        }`}>
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="text-[10px] font-bold text-inherit">{selected.stagedExitPlan.tranche1?.name}</span>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                                selected.stagedExitPlan.tranche1?.status === 'COMPLETED'
                                  ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                                  : 'border-amber-500/30 text-amber-300 bg-amber-500/10'
                              }`}>
                                {selected.stagedExitPlan.tranche1?.status}
                              </span>
                            </div>
                            <div className="text-base font-black font-mono text-inherit">
                              {selected.stagedExitPlan.tranche1?.targetShares?.toLocaleString() || '—'} shares
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1">
                              Trigger: 30w-SMA (₹{selected.stagedExitPlan.tranche1?.triggerPrice})
                            </div>
                          </div>
                          <p className="text-[9px] text-slate-400 leading-relaxed mt-2 pt-2 border-t border-slate-800">
                            {selected.stagedExitPlan.tranche1?.executionNote}
                          </p>
                        </div>

                        {/* Tranche 2 Card (Dynamically evaluated on today's remaining shares) */}
                        <div className={`rounded-xl border p-3 flex flex-col justify-between ${
                          selected.stagedExitPlan.tranche2?.status === 'READY'
                            ? 'border-rose-500/50 bg-rose-500/10 animate-pulse'
                            : selected.stagedExitPlan.tranche2?.status === 'ARMED'
                              ? 'border-amber-500/30 bg-amber-500/[0.05]'
                              : 'border-slate-800 bg-slate-900/30 opacity-70'
                        }`}>
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="text-[10px] font-bold text-inherit">{selected.stagedExitPlan.tranche2?.name}</span>
                              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                                selected.stagedExitPlan.tranche2?.status === 'READY'
                                  ? 'border-rose-500/40 text-rose-300 bg-rose-500/20'
                                  : 'border-slate-700 text-slate-400'
                              }`}>
                                {selected.stagedExitPlan.tranche2?.status}
                              </span>
                            </div>
                            <div className="text-base font-black font-mono text-inherit">
                              {selected.stagedExitPlan.tranche2?.targetShares?.toLocaleString() || '—'} shares
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1">
                              Trigger Floor: ₹{selected.stagedExitPlan.tranche2?.triggerPrice}
                            </div>
                          </div>
                          <p className="text-[9px] text-slate-400 leading-relaxed mt-2 pt-2 border-t border-slate-800">
                            {selected.stagedExitPlan.tranche2?.executionNote}
                          </p>
                        </div>

                        {/* Tranche 3 Card */}
                        <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-3 opacity-70 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="text-[10px] font-bold text-inherit">{selected.stagedExitPlan.tranche3?.name}</span>
                              <span className="text-[9px] font-bold px-2 py-0.5 rounded-full border border-slate-700 text-slate-400">
                                {selected.stagedExitPlan.tranche3?.status}
                              </span>
                            </div>
                            <div className="text-base font-black font-mono text-inherit">
                              {selected.stagedExitPlan.tranche3?.targetShares?.toLocaleString() || '—'} shares
                            </div>
                            <div className="text-[10px] text-slate-400 mt-1">
                              Full Exit Floor: ₹{selected.stagedExitPlan.tranche3?.triggerPrice}
                            </div>
                          </div>
                          <p className="text-[9px] text-slate-400 leading-relaxed mt-2 pt-2 border-t border-slate-800">
                            {selected.stagedExitPlan.tranche3?.executionNote}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 5. PRINCIPAL HARVEST ("HOUSE MONEY") MILESTONE */}
                  {selected.principalHarvest?.isEligible && (
                    <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.08] p-3.5 flex items-start gap-3">
                      <Flame className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                            Multi-Bagger Milestone: 100% Principal Harvest Eligible
                          </span>
                          <span className="text-[10px] font-mono text-amber-400 font-bold">
                            Gain: +{selected.principalHarvest.gainPct}%
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {selected.principalHarvest.description}
                        </p>
                        <div className="pt-1 flex flex-wrap items-center gap-4 text-[10px] text-slate-400">
                          <span>Sell <b>{selected.principalHarvest.sharesToHarvest} shares</b> to pull ₹{selected.principalHarvest.capitalRecoveredINR?.toLocaleString('en-IN', { maximumFractionDigits: 0 })} principal</span>
                          <span>•</span>
                          <span className="text-emerald-300 font-bold">{selected.principalHarvest.remainingShares} shares ride completely risk-free</span>
                        </div>
                      </div>
                    </div>
                  )}
                </section>

                {/* 6. DUAL-TAB DOSSIER: TECHNICAL VS FUNDAMENTAL ANALYSIS */}
                <section className="glass-card rounded-3xl border border-slate-800 p-5">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setActiveDossierTab('TECHNICAL')}
                        className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors ${activeDossierTab === 'TECHNICAL' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        Technical Analysis & Trailing Stops
                      </button>
                      <button
                        onClick={() => setActiveDossierTab('FUNDAMENTAL')}
                        className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1.5 ${activeDossierTab === 'FUNDAMENTAL' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200'}`}
                      >
                        Screener.in Fundamentals & Health
                        {selected.fundamentals?.status === 'AVAILABLE' && (
                          <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        )}
                      </button>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {selected.ruleVersion}
                    </span>
                  </div>

                  {activeDossierTab === 'TECHNICAL' ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Metric
                          label="Weinstein Trend Stage"
                          value={selected.weinsteinStageLabel || 'Stage 2'}
                          tone={selected.weinsteinStage === 2 ? 'text-emerald-400' : selected.weinsteinStage === 4 ? 'text-rose-400' : 'text-inherit'}
                          detail={selected.weinsteinStage === 2 ? 'Advancing Bull Market' : 'Distribution / Decline'}
                        />
                        <Metric
                          label="30-Week SMA"
                          value={selected.sma30Week ? money(formatMoney, selected.sma30Week, true) : 'Insufficient'}
                          detail={`Slope: ${selected.sma30WeekFourWeekSlopePct !== null ? `${selected.sma30WeekFourWeekSlopePct >= 0 ? '+' : ''}${selected.sma30WeekFourWeekSlopePct.toFixed(1)}%` : '—'}`}
                        />
                        <Metric
                          label="Chandelier ATR Stop"
                          value={selected.chandelierStopPrice ? money(formatMoney, selected.chandelierStopPrice, true) : '—'}
                          tone={selected.currentPrice >= selected.chandelierStopPrice ? 'text-emerald-400' : 'text-rose-400'}
                          detail="3.0× ATR corridor from 20w high"
                        />
                        <Metric
                          label="20-Week Peak & Drawdown"
                          value={selected.drawdownFrom20WeekHighPct !== null ? `${selected.drawdownFrom20WeekHighPct.toFixed(1)}%` : '—'}
                          tone={selected.drawdownFrom20WeekHighPct > -20 ? 'text-emerald-400' : 'text-rose-400'}
                          detail={`Peak: ${money(formatMoney, selected.peak20WeekPrice, true)}`}
                        />
                      </div>

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Metric
                          label="Close vs 30w-SMA"
                          value={selected.weeklyClose && selected.sma30Week ? `${((selected.weeklyClose / selected.sma30Week - 1) * 100).toFixed(2)}%` : '—'}
                          tone={selected.weeklyClose >= selected.sma30Week ? 'text-emerald-400' : 'text-rose-400'}
                          detail={`${selected.weeksBelowAverage} consecutive weeks below`}
                        />
                        <Metric
                          label="Buffer to Trailing Stop"
                          value={selected.bufferToTrailingFloorPct !== null ? `+${selected.bufferToTrailingFloorPct}%` : '—'}
                          tone="text-cyan-400"
                          detail={`Stop floor at ${money(formatMoney, selected.trailingFloorPrice, true)}`}
                        />
                        <Metric
                          label="30-Day Price Return"
                          value={selected.observed30DayReturn ? `${selected.observed30DayReturn.pct >= 0 ? '+' : ''}${selected.observed30DayReturn.pct.toFixed(2)}%` : '—'}
                          tone={returnTone(selected.observed30DayReturn?.pct)}
                          detail={selected.observed30DayReturn ? `${selected.observed30DayReturn.from} to ${selected.observed30DayReturn.to}` : ''}
                        />
                        <Metric
                          label="90-Day Price Return"
                          value={selected.observed90DayReturn ? `${selected.observed90DayReturn.pct >= 0 ? '+' : ''}${selected.observed90DayReturn.pct.toFixed(2)}%` : '—'}
                          tone={returnTone(selected.observed90DayReturn?.pct)}
                          detail={selected.observed90DayReturn ? `${selected.observed90DayReturn.from} to ${selected.observed90DayReturn.to}` : ''}
                        />
                      </div>

                      {/* Interactive Price Chart with 30w-SMA */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-xs font-bold text-inherit">Daily Adjusted Close Timeline</h5>
                          <span className="text-[10px] text-slate-500 font-mono">{priceChart.length} stored trading days</span>
                        </div>
                        <div className="h-56 rounded-2xl border border-slate-800/80 bg-slate-950/30 p-2.5">
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
                                  tickFormatter={v => Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                />
                                <Tooltip
                                  contentStyle={{
                                    background: 'var(--surface-primary, #10131b)',
                                    border: '1px solid #334155',
                                    borderRadius: 12,
                                    fontSize: 11
                                  }}
                                  labelStyle={{ color: '#94a3b8' }}
                                  formatter={value => [money(formatMoney, value, true), 'Close']}
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
                            <div className="h-full flex items-center justify-center text-xs text-slate-500">
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
                        <span className="text-xs text-slate-400">
                          Data Source: <b className="text-slate-200">{selected.fundamentals?.source || 'Screener.in (Consolidated)'}</b>
                        </span>
                        <button
                          onClick={() => handleRefreshFundamentals(selected.symbol)}
                          disabled={refreshing}
                          className="text-[10px] font-bold text-cyan-300 hover:text-cyan-200 flex items-center gap-1"
                        >
                          <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} /> Refresh Fundamentals
                        </button>
                      </div>

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Metric
                          label="Operating Margin (OPM)"
                          value={selected.fundamentals?.latestOpmPct !== null && selected.fundamentals?.latestOpmPct !== undefined ? `${selected.fundamentals.latestOpmPct}%` : '—'}
                          tone={selected.fundamentals?.opmTrendDirection === 'EXPANDING' ? 'text-emerald-400' : selected.fundamentals?.opmTrendDirection === 'CONTRACTING' ? 'text-rose-400' : 'text-inherit'}
                          detail={`Trend: ${selected.fundamentals?.opmTrendDirection || 'Stable'}`}
                        />
                        <Metric
                          label="YoY Net Profit Growth"
                          value={selected.fundamentals?.yoyPatGrowthPct !== null && selected.fundamentals?.yoyPatGrowthPct !== undefined ? `${selected.fundamentals.yoyPatGrowthPct >= 0 ? '+' : ''}${selected.fundamentals.yoyPatGrowthPct}%` : '—'}
                          tone={selected.fundamentals?.yoyPatGrowthPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                          detail={selected.fundamentals?.latestQuarter ? `Quarter: ${selected.fundamentals.latestQuarter}` : 'Latest reporting'}
                        />
                        <Metric
                          label="YoY Sales Growth"
                          value={selected.fundamentals?.yoySalesGrowthPct !== null && selected.fundamentals?.yoySalesGrowthPct !== undefined ? `${selected.fundamentals.yoySalesGrowthPct >= 0 ? '+' : ''}${selected.fundamentals.yoySalesGrowthPct}%` : '—'}
                          tone={selected.fundamentals?.yoySalesGrowthPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}
                          detail={selected.fundamentals?.latestSalesCr ? `₹${selected.fundamentals.latestSalesCr} Cr sales` : 'Quarterly revenue'}
                        />
                        <Metric
                          label="Promoter Pledging"
                          value={selected.fundamentals?.promoterPledgePct > 0 ? `${selected.fundamentals.promoterPledgePct}%` : '0% (Clean)'}
                          tone={selected.fundamentals?.promoterPledgePct > 15 ? 'text-rose-400' : 'text-emerald-400'}
                          detail={`Holding: ${selected.fundamentals?.promoterHoldingPct ? `${selected.fundamentals.promoterHoldingPct}%` : 'N/A'}`}
                        />
                      </div>

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Metric
                          label="Stock P/E Ratio"
                          value={selected.fundamentals?.peRatio ? `${selected.fundamentals.peRatio}x` : '—'}
                          detail="Valuation multiple"
                        />
                        <Metric
                          label="ROCE %"
                          value={selected.fundamentals?.rocePct ? `${selected.fundamentals.rocePct}%` : '—'}
                          tone={selected.fundamentals?.rocePct > 20 ? 'text-emerald-400' : 'text-inherit'}
                          detail="Return on capital"
                        />
                        <Metric
                          label="ROE %"
                          value={selected.fundamentals?.roePct ? `${selected.fundamentals.roePct}%` : '—'}
                          tone={selected.fundamentals?.roePct > 15 ? 'text-emerald-400' : 'text-inherit'}
                          detail="Return on equity"
                        />
                        <Metric
                          label="Market Cap Category"
                          value={selected.fundamentals?.marketCapCr ? `₹${Number(selected.fundamentals.marketCapCr).toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr` : '—'}
                          detail={selected.sector || 'Equities'}
                        />
                      </div>

                      {/* 4-Quarter OPM History */}
                      {selected.fundamentals?.opmHistory?.length > 0 && (
                        <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-3.5">
                          <h5 className="text-xs font-bold text-inherit mb-2.5">Quarterly Operating Margin (OPM %) Trajectory</h5>
                          <div className="grid grid-cols-4 gap-2">
                            {selected.fundamentals.opmHistory.map((q, idx) => (
                              <div key={idx} className="reports-subcard p-2 rounded-xl text-center">
                                <div className="text-[9px] text-slate-500 font-bold">{q.quarter}</div>
                                <div className="text-sm font-black font-mono text-cyan-300 mt-1">{q.opm}%</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {/* 7. POSITION RISK LIMIT CONFIGURATION */}
                <section className="glass-card rounded-3xl border border-slate-800 p-5">
                  <div className="flex items-center gap-2 mb-2.5">
                    <Settings2 className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-sm font-bold text-inherit">Position Concentration Risk Guard</h3>
                  </div>
                  <form onSubmit={saveRiskLimit} className="flex flex-wrap items-end gap-3">
                    <label className="text-[10px] text-slate-400">
                      Maximum weight cap within Indian equities (%)
                      <input
                        type="number"
                        min="0.1"
                        max="100"
                        step="0.1"
                        value={maxWeight}
                        onChange={event => setMaxWeight(event.target.value)}
                        placeholder="e.g. 15.0%"
                        className="mt-1 block w-44 rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2 text-xs text-inherit outline-none focus:border-cyan-500/50"
                      />
                    </label>
                    <button
                      disabled={savingConfig}
                      className="rounded-xl bg-cyan-500/15 border border-cyan-500/30 px-3 py-2 text-[10px] font-bold text-cyan-200 disabled:opacity-50"
                    >
                      {savingConfig ? 'Saving…' : 'Save Cap'}
                    </button>
                    <button
                      type="button"
                      disabled={savingConfig}
                      onClick={clearRiskLimit}
                      className="rounded-xl border border-slate-700 px-3 py-2 text-[10px] text-slate-400 disabled:opacity-50"
                    >
                      Disable Limit
                    </button>
                    {configMessage && <span className="text-[10px] text-slate-400">{configMessage}</span>}
                  </form>
                  <p className="mt-2 text-[9px] leading-relaxed text-slate-500">
                    When active, holdings exceeding this cap automatically trigger a <b className="text-purple-300">PORTFOLIO_RISK_TRIM</b> recommending only the exact delta shares required to restore allocation to your ceiling.
                  </p>
                </section>

                {/* 8. STATE TRANSITION AUDIT TRAIL */}
                {history.length > 0 && (
                  <section className="glass-card rounded-3xl border border-slate-800 p-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-inherit mb-2.5">
                      <History className="w-3.5 h-3.5 text-slate-400" />
                      <span>Recorded State History ({history.length} events)</span>
                    </div>
                    <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                      {history.slice(0, 8).map(event => (
                        <div key={event.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] p-2 rounded-xl bg-slate-950/30 border border-slate-800/60">
                          <span className="text-slate-300 font-medium">
                            {event.from || 'Initiated'} → <b className="text-emerald-400">{event.to}</b>
                          </span>
                          <span className="text-slate-500 font-mono">{new Date(event.at).toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </AnimatedItem>
      </div>
    </AnimatedPage>
  );
}
