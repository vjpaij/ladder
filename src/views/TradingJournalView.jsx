import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  Plus,
  RefreshCw,
  Search,
  TrendingUp,
  TrendingDown,
  Layers,
  Sparkles,
  ShieldCheck,
  Smile,
  AlertTriangle,
  Flame,
  LayoutGrid,
  List,
  Target,
  BarChart3,
  Calendar,
  Percent,
  CheckCircle2,
  FileText,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Coins,
  ChevronRight,
  X
} from 'lucide-react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';
import AnimatedCounter from '../components/AnimatedCounter';
import HoldingLogo from '../components/HoldingLogo';
import TradeFormModal from '../components/TradeFormModal';
import SymbolTradeLogsModal from '../components/SymbolTradeLogsModal';

export default function TradingJournalView({ holdings = [], onSelectHolding }) {
  const { currency, toggleCurrency, formatMoney } = useThemeAuth();

  const [symbols, setSymbols] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState('');

  // Filters state
  const [marketFilter, setMarketFilter] = useState('IN');
  const [outcomeFilter, setOutcomeFilter] = useState('ALL');
  const [badgeFilter, setBadgeFilter] = useState('ALL');
  const [positionFilter, setPositionFilter] = useState('ALL'); // 'ALL' | 'OPEN' | 'EXITED'
  const [searchQuery, setSearchQuery] = useState('');

  const isUsdMode = marketFilter === 'US' && currency === 'USD';

  const formatVal = (val, market = marketFilter) => {
    if (val === undefined || val === null || isNaN(Number(val))) return (market === 'US' && currency === 'USD') ? '$0.00' : '₹0.00';
    if (market === 'US' && currency === 'USD') {
      return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return '₹' + Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Column Sort state (supports both ticker symbol and stock name)
  const [sortField, setSortField] = useState('netPnl');
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc' | 'desc'

  // Presentation state
  const [displayLayout, setDisplayLayout] = useState('table'); // 'table' | 'cards'

  // Modals state
  const [selectedSymbolForModal, setSelectedSymbolForModal] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [tradeToEdit, setTradeToEdit] = useState(null);

  const fetchJournalData = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [symbolsRes, statsRes] = await Promise.all([
        axios.get('/api/trading-journal/symbols', {
          params: {
            market: marketFilter !== 'ALL' ? marketFilter : undefined,
            outcome: outcomeFilter !== 'ALL' ? outcomeFilter : undefined,
            query: searchQuery.trim() || undefined,
            sortField,
            sortOrder
          }
        }),
        axios.get('/api/trading-journal/stats', {
          params: {
            market: marketFilter !== 'ALL' ? marketFilter : undefined
          }
        })
      ]);

      if (symbolsRes.data?.symbols) {
        setSymbols(symbolsRes.data.symbols);
        // If a symbol modal is open, refresh its data in place
        if (selectedSymbolForModal) {
          const fresh = symbolsRes.data.symbols.find(s => s.symbol === selectedSymbolForModal.symbol);
          if (fresh) setSelectedSymbolForModal(fresh);
        }
      }
      if (statsRes.data?.stats) setStats(statsRes.data.stats);
    } catch (err) {
      console.error('[TradingJournalView] Error fetching data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchJournalData();
  }, [marketFilter, outcomeFilter, sortField, sortOrder, searchQuery]);

  const handleSyncPortfolio = async () => {
    setSyncing(true);
    try {
      const res = await axios.post('/api/trading-journal/sync-portfolio');
      const imported = res.data?.importedCount || 0;
      setSyncToast(`Synced ${imported} new closed trades from Ladder transactions!`);
      setTimeout(() => setSyncToast(''), 4500);
      await fetchJournalData(true);
    } catch (err) {
      setSyncToast('Sync failed: ' + (err.response?.data?.error || err.message));
      setTimeout(() => setSyncToast(''), 4500);
    } finally {
      setSyncing(false);
    }
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const handleDeleteTrade = async (tradeId, label) => {
    if (!window.confirm(`Are you sure you want to delete trade "${label}"? This cannot be undone.`)) {
      return;
    }
    try {
      await axios.delete(`/api/trading-journal/${tradeId}`);
      await fetchJournalData(true);
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message));
    }
  };

  // Counts for Position Status Tabs
  const openCount = useMemo(() => symbols.filter(s => s.inPortfolio || s.isOpen).length, [symbols]);
  const exitedCount = useMemo(() => symbols.filter(s => !s.inPortfolio && !s.isOpen).length, [symbols]);

  // Client-side filtering for badges and position status
  const filteredSymbols = useMemo(() => {
    return symbols.filter(sym => {
      const isOpen = sym.inPortfolio || sym.isOpen;
      if (positionFilter === 'OPEN' && !isOpen) return false;
      if (positionFilter === 'EXITED' && isOpen) return false;

      if (badgeFilter !== 'ALL') {
        const hasBadge = sym.analysisBadges?.some(b => 
          b.label.toLowerCase().includes(badgeFilter.toLowerCase())
        );
        if (!hasBadge) return false;
      }

      return true;
    });
  }, [symbols, positionFilter, badgeFilter]);

  // Top KPI calculations (currency-aware: INR uses transaction-date FX calculations)
  const netPnl = isUsdMode ? (stats?.netPnl ?? 0) : (stats?.netPnlInr ?? stats?.netPnl ?? 0);
  const grossPnl = isUsdMode ? (stats?.grossPnl ?? 0) : (stats?.grossPnlInr ?? stats?.grossPnl ?? 0);
  const totalCharges = isUsdMode ? (stats?.totalCharges ?? 0) : (stats?.totalChargesInr ?? stats?.totalCharges ?? 0);
  const winRate = stats?.winRatePct ?? 0;
  const profitFactor = stats?.profitFactor ?? 0;
  const disciplineScore = stats?.disciplineScorePct ?? 100;
  const currentStreak = stats?.currentStreak ?? 0;
  const streakType = stats?.currentStreakType ?? 'WIN';

  return (
    <div className="space-y-6">
      {/* 1. Header Section */}
      <div className="reports-card rounded-3xl border border-[var(--border-color)] p-4 md:p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cyan-500/10 border border-cyan-500/20 rounded-xl text-cyan-600 dark:text-cyan-400">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-black text-[var(--text-primary)]">
              Trade Journal
            </h2>
          </div>
        </div>

        {/* Market Switcher Tabs & US Currency Toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center p-1 rounded-2xl reports-subcard border border-[var(--border-color)]">
            <button
              type="button"
              onClick={() => setMarketFilter('IN')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                marketFilter === 'IN'
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
              }`}
            >
              <span className="text-sm">🇮🇳</span>
              <span>Indian Stocks</span>
            </button>
            <button
              type="button"
              onClick={() => setMarketFilter('US')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                marketFilter === 'US'
                  ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/40 shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
              }`}
            >
              <span className="text-sm">🇺🇸</span>
              <span>US Stocks</span>
            </button>
          </div>

          {/* Currency Toggle Pill (when US Stocks is active) */}
          {marketFilter === 'US' && (
            <div className="flex items-center p-1 rounded-2xl reports-subcard border border-[var(--border-color)] shadow-sm">
              <button
                type="button"
                onClick={() => currency !== 'INR' && toggleCurrency()}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  currency === 'INR'
                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                }`}
                title="Display US Stock Journal converted to INR at transaction-date FX rates"
              >
                <span>₹ INR (Trade-Date FX)</span>
              </button>
              <button
                type="button"
                onClick={() => currency !== 'USD' && toggleCurrency()}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  currency === 'USD'
                    ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/40 shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                }`}
                title="Display US Stock Journal in native USD ($)"
              >
                <span>$ USD</span>
              </button>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleSyncPortfolio}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold reports-subcard hover:border-emerald-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-color)] transition-all cursor-pointer shadow-sm"
            title="Scan Ladder transactions table and import past closed trades"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync from Portfolio'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTradeToEdit(null);
              setIsFormOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black bg-emerald-500 hover:bg-emerald-400 text-obsidian-950 shadow-md shadow-emerald-500/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Log Trade</span>
          </button>
        </div>
      </div>

      {/* Sync Toast Notification */}
      <AnimatePresence>
        {syncToast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3.5 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center justify-between"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span>{syncToast}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2. Executive KPI Hero Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 2xl:grid-cols-6 gap-3 sm:gap-4">
        {/* Net P&L Card */}
        <motion.div
          whileHover={{ y: -2 }}
          className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3.5 sm:p-4 flex flex-col justify-between shadow-sm overflow-hidden min-w-0"
        >
          <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] truncate">Net Realized P&L</div>
          <div className="my-1.5 min-w-0 overflow-hidden">
            <div className={`text-base sm:text-lg xl:text-xl font-black font-mono tracking-tight truncate block ${
              netPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}>
              <AnimatedCounter value={netPnl} formatter={(v) => `${v > 0 ? '+' : ''}${formatVal(v)}`} />
            </div>
          </div>
          <div className="pt-2 border-t border-[var(--border-color)] text-[11px] font-mono space-y-0.5 min-w-0">
            <div className="flex items-center justify-between gap-1 min-w-0">
              <span className="text-[10px] uppercase font-sans text-[var(--text-muted)] font-semibold shrink-0">Gross</span>
              <span className="font-bold text-[var(--text-primary)] truncate text-right">{formatVal(grossPnl)}</span>
            </div>
            <div className="flex items-center justify-between gap-1 min-w-0 text-amber-600 dark:text-amber-400">
              <span className="text-[10px] uppercase font-sans font-semibold shrink-0">Charges</span>
              <span className="font-bold truncate text-right">-{formatVal(totalCharges)}</span>
            </div>
          </div>
        </motion.div>

        {/* Win Rate % */}
        <motion.div
          whileHover={{ y: -2 }}
          className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3.5 sm:p-4 flex flex-col justify-between shadow-sm overflow-hidden min-w-0"
        >
          <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] truncate">Win Rate</div>
          <div className="my-1.5 min-w-0">
            <span className={`text-xl sm:text-2xl font-black font-mono tracking-tight ${
              winRate >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
            }`}>
              {winRate.toFixed(1)}%
            </span>
          </div>
          <div className="pt-2 border-t border-[var(--border-color)] text-[11px] font-mono flex items-center justify-between text-[var(--text-secondary)] min-w-0">
            <span className="opacity-70 truncate">{stats?.winCount || 0}W / {stats?.lossCount || 0}L</span>
            <span className="font-bold shrink-0">{stats?.closedTradesCount || 0} closed</span>
          </div>
        </motion.div>

        {/* Profit Factor */}
        <motion.div
          whileHover={{ y: -2 }}
          className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3.5 sm:p-4 flex flex-col justify-between shadow-sm overflow-hidden min-w-0"
        >
          <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] truncate">Profit Factor</div>
          <div className="my-1.5 min-w-0">
            <span className={`text-xl sm:text-2xl font-black font-mono tracking-tight ${
              profitFactor >= 1.5 ? 'text-emerald-600 dark:text-emerald-400' : profitFactor >= 1.0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
            }`}>
              {profitFactor.toFixed(2)}x
            </span>
          </div>
          <div className="pt-2 border-t border-[var(--border-color)] text-[11px] font-mono flex items-center justify-between text-[var(--text-secondary)] min-w-0">
            <span className="opacity-70 font-sans uppercase text-[10px] truncate">Avg W/L</span>
            <span className="font-bold shrink-0">{stats?.winLossRatio?.toFixed(2) || '0.00'}</span>
          </div>
        </motion.div>

        {/* Discipline Score */}
        <motion.div
          whileHover={{ y: -2 }}
          className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3.5 sm:p-4 flex flex-col justify-between shadow-sm overflow-hidden min-w-0"
        >
          <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] flex items-center justify-between min-w-0">
            <span className="truncate">Discipline Score</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          </div>
          <div className="my-1.5 min-w-0">
            <span className={`text-xl sm:text-2xl font-black font-mono tracking-tight ${
              disciplineScore >= 80 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
            }`}>
              {disciplineScore.toFixed(0)}%
            </span>
          </div>
          <div className="pt-2 border-t border-[var(--border-color)] text-[11px] font-sans flex items-center justify-between text-[var(--text-secondary)] min-w-0">
            <span className="opacity-70 text-[10px] uppercase truncate">Plan Respected</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400 shrink-0">100%</span>
          </div>
        </motion.div>

        {/* Active Streak */}
        <motion.div
          whileHover={{ y: -2 }}
          className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3.5 sm:p-4 flex flex-col justify-between shadow-sm overflow-hidden min-w-0"
        >
          <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] truncate">Active Streak</div>
          <div className="my-1.5 flex items-center gap-1.5 min-w-0">
            {streakType === 'WIN' && currentStreak > 0 ? (
              <Flame className="w-5 h-5 text-amber-500 animate-pulse shrink-0" />
            ) : null}
            <span className={`text-xl sm:text-2xl font-black font-mono tracking-tight truncate ${
              streakType === 'WIN' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}>
              {currentStreak} {streakType === 'WIN' ? 'Wins' : 'Losses'}
            </span>
          </div>
          <div className="pt-2 border-t border-[var(--border-color)] text-[11px] font-mono flex items-center justify-between text-[var(--text-secondary)] min-w-0">
            <span className="opacity-70 font-sans text-[10px] uppercase truncate">Max Streak</span>
            <span className="font-bold shrink-0">{stats?.maxWinStreak || 0} Wins</span>
          </div>
        </motion.div>

        {/* Total Symbols Traded */}
        <motion.div
          whileHover={{ y: -2 }}
          className="reports-subcard rounded-2xl border border-[var(--border-color)] p-3.5 sm:p-4 flex flex-col justify-between shadow-sm overflow-hidden min-w-0"
        >
          <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)] truncate">Symbols Tracked</div>
          <div className="my-1.5 min-w-0">
            <span className="text-xl sm:text-2xl font-black font-mono tracking-tight text-[var(--text-primary)]">
              {symbols.length}
            </span>
          </div>
          <div className="pt-2 border-t border-[var(--border-color)] text-[11px] font-mono flex items-center justify-between text-[var(--text-secondary)] min-w-0">
            <span className="opacity-70 font-sans text-[10px] uppercase truncate">Orders Logged</span>
            <span className="font-bold shrink-0">{stats?.totalTrades || 0}</span>
          </div>
        </motion.div>
      </div>

      {/* 3. Master Multi-Filter Toolbar */}
      <div className="reports-card rounded-2xl border border-[var(--border-color)] p-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {/* Position Status Segmented Switcher */}
          <div className="flex items-center p-0.5 rounded-xl reports-subcard border border-[var(--border-color)]">
            {[
              { id: 'ALL', label: `All Stocks (${symbols.length})` },
              { id: 'OPEN', label: `Open Stocks (${openCount})` },
              { id: 'EXITED', label: `Exited Stocks (${exitedCount})` },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setPositionFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  positionFilter === tab.id
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Outcome Filter */}
          <div className="flex items-center p-0.5 rounded-xl reports-subcard border border-[var(--border-color)]">
            {[
              { id: 'ALL', label: 'All P&L' },
              { id: 'WIN', label: 'Profitable' },
              { id: 'LOSS', label: 'Loss-Making' },
            ].map(out => (
              <button
                key={out.id}
                type="button"
                onClick={() => setOutcomeFilter(out.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  outcomeFilter === out.id
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                }`}
              >
                {out.label}
              </button>
            ))}
          </div>

          {/* Analysis Badges Filter */}
          <select
            value={badgeFilter}
            onChange={(e) => setBadgeFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl reports-subcard border border-[var(--border-color)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-emerald-500/50 cursor-pointer"
          >
            <option value="ALL">All Analysis Badges</option>
            <option value="Strong Buy">Strong Buy</option>
            <option value="Buy Signal">Buy Signal</option>
            <option value="Stage 2 Bull">Stage 2 Bull</option>
            <option value="Extended Runner">Extended Runner</option>
            <option value="Prime Setup">Prime Setup</option>
            <option value="Q2 Beat">Q2 Beat</option>
            <option value="In Portfolio">In Portfolio</option>
            <option value="Compounding Shield">Compounding Shield</option>
            <option value="Technical Trim">Technical Trim</option>
            <option value="4 Red < 21 EMA">4 Red &lt; 21 EMA</option>
          </select>
        </div>

        {/* Right Controls: Search & Layout Toggle */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {/* Search Input */}
          <div className="relative flex-1 sm:w-60">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-[var(--text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search symbol, stock name..."
              className="w-full pl-8 pr-8 py-1.5 rounded-xl reports-subcard border border-[var(--border-color)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-emerald-500/60"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* View Layout Toggle (Table vs Cards) */}
          <div className="flex items-center p-0.5 rounded-xl reports-subcard border border-[var(--border-color)]">
            <button
              type="button"
              onClick={() => setDisplayLayout('table')}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                displayLayout === 'table' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 font-bold' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
              title="Table View"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setDisplayLayout('cards')}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                displayLayout === 'cards' ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 font-bold' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
              title="Card View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 4. Symbol Trade Master Display: Table vs Cards */}
      {filteredSymbols.length === 0 ? (
        <div className="reports-card rounded-3xl border border-[var(--border-color)] p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center mx-auto">
            <Coins className="w-6 h-6" />
          </div>
          <h4 className="text-lg font-black text-inherit">No Symbols Found</h4>
          <p className="text-xs text-[var(--text-muted)] max-w-md mx-auto">
            Try adjusting your search filters or click "Sync from Portfolio" to pull your past trade orders.
          </p>
        </div>
      ) : displayLayout === 'table' ? (
        /* Institutional Dense Table View with Dual Ticker & Stock Name Sort */
        <div className="reports-card rounded-2xl border border-[var(--border-color)] overflow-x-auto shadow-sm">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="reports-table-head text-[10px] uppercase font-bold text-[var(--text-muted)] border-b border-[var(--border-color)] select-none">
                {/* Dual Sort on Ticker and Stock Name */}
                <th className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSort('symbol')}
                      className={`flex items-center gap-1 font-bold hover:text-emerald-500 transition-colors cursor-pointer ${sortField === 'symbol' ? 'text-emerald-500' : ''}`}
                      title="Sort by Ticker Symbol"
                    >
                      <span>Ticker</span>
                      {sortField === 'symbol' ? (
                        sortOrder === 'desc' ? <ArrowDown className="w-3 h-3 text-emerald-500" /> : <ArrowUp className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 opacity-40" />
                      )}
                    </button>
                    <span className="opacity-30">/</span>
                    <button
                      type="button"
                      onClick={() => handleSort('name')}
                      className={`flex items-center gap-1 font-bold hover:text-emerald-500 transition-colors cursor-pointer ${sortField === 'name' ? 'text-emerald-500' : ''}`}
                      title="Sort by Stock Name"
                    >
                      <span>Stock Name</span>
                      {sortField === 'name' ? (
                        sortOrder === 'desc' ? <ArrowDown className="w-3 h-3 text-emerald-500" /> : <ArrowUp className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 opacity-40" />
                      )}
                    </button>
                  </div>
                </th>
                <th className="py-3 px-3 text-right cursor-pointer hover:text-emerald-500" onClick={() => handleSort('totalTrades')}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Trades</span>
                    {sortField === 'totalTrades' ? (sortOrder === 'desc' ? <ArrowDown className="w-3 h-3 text-emerald-500" /> : <ArrowUp className="w-3 h-3 text-emerald-500" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                  </div>
                </th>
                <th className="py-3 px-3 text-right cursor-pointer hover:text-emerald-500" onClick={() => handleSort('totalCapital')}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Capital Deployed</span>
                    {sortField === 'totalCapital' ? (sortOrder === 'desc' ? <ArrowDown className="w-3 h-3 text-emerald-500" /> : <ArrowUp className="w-3 h-3 text-emerald-500" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                  </div>
                </th>
                <th className="py-3 px-3 text-right cursor-pointer hover:text-emerald-500" onClick={() => handleSort('totalCharges')}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Total Charges</span>
                    {sortField === 'totalCharges' ? (sortOrder === 'desc' ? <ArrowDown className="w-3 h-3 text-emerald-500" /> : <ArrowUp className="w-3 h-3 text-emerald-500" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                  </div>
                </th>
                <th className="py-3 px-3 text-right cursor-pointer hover:text-emerald-500" onClick={() => handleSort('grossPnl')}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Gross P&L</span>
                    {sortField === 'grossPnl' ? (sortOrder === 'desc' ? <ArrowDown className="w-3 h-3 text-emerald-500" /> : <ArrowUp className="w-3 h-3 text-emerald-500" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                  </div>
                </th>
                <th className="py-3 px-4 text-right cursor-pointer hover:text-emerald-500" onClick={() => handleSort('netPnl')}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Net Realized P&L</span>
                    {sortField === 'netPnl' ? (sortOrder === 'desc' ? <ArrowDown className="w-3 h-3 text-emerald-500" /> : <ArrowUp className="w-3 h-3 text-emerald-500" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                  </div>
                </th>
                <th className="py-3 px-3 text-right cursor-pointer hover:text-emerald-500" onClick={() => handleSort('roiPct')}>
                  <div className="flex items-center justify-end gap-1">
                    <span>ROI %</span>
                    {sortField === 'roiPct' ? (sortOrder === 'desc' ? <ArrowDown className="w-3 h-3 text-emerald-500" /> : <ArrowUp className="w-3 h-3 text-emerald-500" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                  </div>
                </th>
                <th className="py-3 px-3 text-right cursor-pointer hover:text-emerald-500" onClick={() => handleSort('winRatePct')}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Win Rate</span>
                    {sortField === 'winRatePct' ? (sortOrder === 'desc' ? <ArrowDown className="w-3 h-3 text-emerald-500" /> : <ArrowUp className="w-3 h-3 text-emerald-500" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                  </div>
                </th>
                <th className="py-3 px-3">Analysis Badges</th>
                <th className="py-3 px-3 text-right cursor-pointer hover:text-emerald-500" onClick={() => handleSort('latestDate')}>
                  <div className="flex items-center justify-end gap-1">
                    <span>Latest Date</span>
                    {sortField === 'latestDate' ? (sortOrder === 'desc' ? <ArrowDown className="w-3 h-3 text-emerald-500" /> : <ArrowUp className="w-3 h-3 text-emerald-500" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-color)] font-mono text-[var(--text-primary)]">
              {filteredSymbols.map((sym) => {
                const isWin = sym.netPnl >= 0;

                return (
                  <tr
                    key={sym.symbol}
                    onClick={() => setSelectedSymbolForModal(sym)}
                    className="hover:bg-[var(--bg-card)] cursor-pointer transition-colors group"
                  >
                    {/* Symbol & Logo */}
                    <td className="py-2.5 px-4 font-sans">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl overflow-hidden shrink-0 flex items-center justify-center bg-transparent">
                          <HoldingLogo
                            symbol={sym.symbol}
                            name={sym.name}
                            className="w-full h-full object-contain"
                            categoryId={sym.market === 'US' ? 'us_stocks' : 'in_stocks'}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-[var(--text-primary)] group-hover:text-emerald-500 transition-colors flex items-center gap-1.5">
                            <span>{sym.symbol}</span>
                            {sym.inPortfolio && (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" title="Held in portfolio" />
                            )}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[160px] font-medium">
                            {sym.name || sym.symbol}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Trades Count (No redundant brackets) */}
                    <td className="py-2.5 px-3 text-right">
                      <span className="font-bold text-[var(--text-primary)]">{sym.totalTrades}</span>
                    </td>

                    {/* Capital Deployed */}
                    <td className="py-2.5 px-3 text-right text-[var(--text-primary)] font-medium">
                      {formatVal(isUsdMode ? sym.totalCapital : (sym.totalCapitalInr ?? sym.totalCapital), sym.market)}
                    </td>

                    {/* Total Charges */}
                    <td className="py-2.5 px-3 text-right text-amber-600 dark:text-amber-400 font-bold">
                      {formatVal(isUsdMode ? sym.totalCharges : (sym.totalChargesInr ?? sym.totalCharges), sym.market)}
                    </td>

                    {/* Gross P&L */}
                    <td className={`py-2.5 px-3 text-right font-bold ${(isUsdMode ? sym.grossPnl : (sym.grossPnlInr ?? sym.grossPnl)) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {formatVal(isUsdMode ? sym.grossPnl : (sym.grossPnlInr ?? sym.grossPnl), sym.market)}
                    </td>

                    {/* Net Realized P&L */}
                    <td className={`py-2.5 px-4 text-right font-black text-sm ${(isUsdMode ? sym.netPnl : (sym.netPnlInr ?? sym.netPnl)) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {formatVal(isUsdMode ? sym.netPnl : (sym.netPnlInr ?? sym.netPnl), sym.market)}
                    </td>

                    {/* ROI % */}
                    <td className={`py-2.5 px-3 text-right font-bold ${(isUsdMode ? sym.roiPct : (sym.roiPctInr ?? sym.roiPct)) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {(isUsdMode ? sym.roiPct : (sym.roiPctInr ?? sym.roiPct)) >= 0 ? '+' : ''}{(isUsdMode ? sym.roiPct : (sym.roiPctInr ?? sym.roiPct))?.toFixed(1)}%
                    </td>

                    {/* Win Rate */}
                    <td className="py-2.5 px-3 text-right">
                      <span className={`font-bold ${sym.winRatePct >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {sym.winRatePct?.toFixed(0)}%
                      </span>
                      <span className="text-[9px] text-[var(--text-muted)] block font-sans">
                        {sym.winCount}W/{sym.lossCount}L
                      </span>
                    </td>

                    {/* Complete Analysis Badges (Zero truncation) */}
                    <td className="py-2.5 px-3 font-sans">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {sym.analysisBadges?.map((b, i) => {
                          let badgeColor = 'text-[var(--text-secondary)] border-[var(--border-color)] reports-subcard';
                          if (b.label.includes('Buy') || b.label.includes('Bull')) badgeColor = 'text-emerald-600 dark:text-emerald-300 border-emerald-500/40 bg-emerald-500/10';
                          else if (b.label.includes('Trim') || b.label.includes('Red') || b.label.includes('Exit')) badgeColor = 'text-rose-600 dark:text-rose-300 border-rose-500/40 bg-rose-500/10';
                          else if (b.label === 'In Portfolio') badgeColor = 'text-cyan-600 dark:text-cyan-300 border-cyan-500/40 bg-cyan-500/10';
                          else if (b.label.includes('Runner') || b.label.includes('Prime') || b.label.includes('Beat')) badgeColor = 'text-purple-600 dark:text-purple-300 border-purple-500/40 bg-purple-500/10';

                          return (
                            <span key={i} className={`text-[10px] font-bold px-2 py-0.5 rounded-md border whitespace-nowrap ${badgeColor}`}>
                              {b.label}
                            </span>
                          );
                        })}
                      </div>
                    </td>

                    {/* Latest Date */}
                    <td className="py-2.5 px-3 text-right text-[var(--text-muted)] font-sans text-[11px]">
                      <div className="flex items-center justify-end gap-1">
                        <span>{sym.latestDate}</span>
                        <ChevronRight className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 group-hover:text-emerald-500 transition-colors" />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* Card Grid View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredSymbols.map((sym) => {
            const isWin = sym.netPnl >= 0;

            return (
              <motion.div
                key={sym.symbol}
                whileHover={{ y: -2 }}
                onClick={() => setSelectedSymbolForModal(sym)}
                className="reports-card rounded-2xl border border-[var(--border-color)] hover:border-emerald-500/40 p-4 cursor-pointer transition-all flex flex-col justify-between space-y-3 group shadow-sm"
              >
                {/* Top Row: Symbol, Logo & Net P&L */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0 flex items-center justify-center bg-transparent">
                      <HoldingLogo
                        symbol={sym.symbol}
                        name={sym.name}
                        className="w-full h-full object-contain"
                        categoryId={sym.market === 'US' ? 'us_stocks' : 'in_stocks'}
                      />
                    </div>
                    <div>
                      <div className="font-bold text-base text-[var(--text-primary)] group-hover:text-emerald-500 dark:group-hover:text-emerald-300 transition-colors flex items-center gap-1.5">
                        <span>{sym.symbol}</span>
                        {sym.inPortfolio && (
                          <span className="w-2 h-2 rounded-full bg-emerald-500" title="Held in portfolio" />
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--text-secondary)] truncate max-w-[150px] font-medium">
                        {sym.name || sym.symbol}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className={`text-base font-black font-mono ${(isUsdMode ? sym.netPnl : (sym.netPnlInr ?? sym.netPnl)) >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                      {formatVal(isUsdMode ? sym.netPnl : (sym.netPnlInr ?? sym.netPnl), sym.market)}
                    </span>
                    <div className="text-[10px] text-[var(--text-muted)] font-mono">
                      ROI: {(isUsdMode ? sym.roiPct : (sym.roiPctInr ?? sym.roiPct)) >= 0 ? '+' : ''}{(isUsdMode ? sym.roiPct : (sym.roiPctInr ?? sym.roiPct))?.toFixed(1)}%
                    </div>
                  </div>
                </div>

                {/* Middle: Metrics Strip */}
                <div className="p-2.5 rounded-xl reports-subcard border border-[var(--border-color)] grid grid-cols-3 gap-2 text-center text-xs font-mono">
                  <div>
                    <div className="text-[8px] text-[var(--text-muted)] uppercase font-sans">Trades</div>
                    <div className="font-bold text-[var(--text-primary)]">{sym.totalTrades}</div>
                  </div>
                  <div>
                    <div className="text-[8px] text-[var(--text-muted)] uppercase font-sans">Win Rate</div>
                    <div className={`font-bold ${sym.winRatePct >= 50 ? 'text-emerald-500 dark:text-emerald-400' : 'text-amber-500 dark:text-amber-400'}`}>
                      {sym.winRatePct?.toFixed(0)}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[8px] text-[var(--text-muted)] uppercase font-sans">Charges</div>
                    <div className="font-bold text-amber-500 dark:text-amber-300">
                      {formatVal(isUsdMode ? sym.totalCharges : (sym.totalChargesInr ?? sym.totalCharges), sym.market)}
                    </div>
                  </div>
                </div>

                {/* Bottom: Complete Analysis Badges & Latest Date */}
                <div className="space-y-2 pt-1 border-t border-[var(--border-color)]">
                  <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
                    <span className="font-sans">Latest: {sym.latestDate}</span>
                    <span className="text-emerald-500 dark:text-emerald-400 flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                      View Logs <ChevronRight className="w-3 h-3" />
                    </span>
                  </div>

                  {/* Complete Badges */}
                  {Array.isArray(sym.analysisBadges) && sym.analysisBadges.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {sym.analysisBadges.map((badge, idx) => (
                        <span
                          key={idx}
                          className={`text-[9px] font-bold px-2 py-0.5 rounded-md border whitespace-nowrap ${
                            badge.label.includes('Buy') || badge.label.includes('Bull')
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                              : badge.label === 'In Portfolio'
                              ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300'
                              : badge.label.includes('Runner') || badge.label.includes('Prime') || badge.label.includes('Beat')
                              ? 'border-purple-500/40 bg-purple-500/10 text-purple-600 dark:text-purple-300'
                              : 'border-[var(--border-color)] reports-subcard text-[var(--text-secondary)]'
                          }`}
                        >
                          {badge.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Trade Log Form Modal */}
      <TradeFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setTradeToEdit(null);
        }}
        tradeToEdit={tradeToEdit}
        onSaved={() => fetchJournalData(true)}
      />

      {/* Symbol Trade Logs Drill-Down Modal (Inside View) */}
      <SymbolTradeLogsModal
        symbolData={selectedSymbolForModal}
        onClose={() => setSelectedSymbolForModal(null)}
        onAddTradeForSymbol={(symbol, name, market, segment) => {
          setTradeToEdit({ symbol, name, market, segment });
          setIsFormOpen(true);
        }}
        onEditTrade={(trade) => {
          setTradeToEdit(trade);
          setIsFormOpen(true);
        }}
        onDeleteTrade={handleDeleteTrade}
        onRefresh={() => fetchJournalData(true)}
      />
    </div>
  );
}
