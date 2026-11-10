import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  Clock,
  PieChart,
  Filter,
  RotateCcw,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  X
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  CartesianGrid
} from 'recharts';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';
import AnimatedCounter from '../components/AnimatedCounter';
import HoldingLogo from '../components/HoldingLogo';
import TradeFormModal from '../components/TradeFormModal';
import SymbolTradeLogsModal from '../components/SymbolTradeLogsModal';
import ChartRangeSelector from '../components/ChartRangeSelector';

export default function TradingJournalView({ holdings = [], onSelectHolding }) {
  const { currency, toggleCurrency, formatMoney } = useThemeAuth();

  const [symbols, setSymbols] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState('');

  // Primary Filters state
  const [marketFilter, setMarketFilter] = useState('IN');
  const [outcomeFilter, setOutcomeFilter] = useState('ALL');
  const [termFilter, setTermFilter] = useState('ALL'); // 'ALL' | 'LTCG' | 'STCG'
  const [sectorFilter, setSectorFilter] = useState('ALL');
  const [marketCapFilter, setMarketCapFilter] = useState('ALL');
  const [badgeFilter, setBadgeFilter] = useState('ALL');
  const [positionFilter, setPositionFilter] = useState('ALL'); // 'ALL' | 'OPEN' | 'EXITED'
  const [searchQuery, setSearchQuery] = useState('');

  // Interactive Graph-Driven Filters state
  const [horizonFilter, setHorizonFilter] = useState('ALL'); // 'ALL' | 'QUICK' | 'SWING_SHORT' | 'SWING_MED' | 'PRE_LTCG' | 'LTCG'
  const [monthFilter, setMonthFilter] = useState('ALL'); // 'ALL' | 'YYYY-MM'

  // Calendar Date Range Filter for Visual Studio
  const [calendarRange, setCalendarRange] = useState({ startDate: null, endDate: null, label: 'ALL' });

  // Visual Studio Tab state
  const [activeVisualTab, setActiveVisualTab] = useState('EQUITY'); // 'EQUITY' | 'HORIZON' | 'SECTORS' | 'MCAP'

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25); // 25, 50, 100, 'ALL'

  // DOM Refs
  const symbolsSectionRef = useRef(null);
  const tableContainerRef = useRef(null);

  const isUsdMode = marketFilter === 'US' && currency === 'USD';

  const formatVal = (val, market = marketFilter) => {
    if (val === undefined || val === null || isNaN(Number(val))) return (market === 'US' && currency === 'USD') ? '$0.00' : '₹0.00';
    if (market === 'US' && currency === 'USD') {
      return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return '₹' + Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const formatCompactVal = (val) => {
    const num = Number(val) || 0;
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '+';
    if (isUsdMode) {
      if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
      if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'k';
      return sign + '$' + abs.toFixed(0);
    }
    if (abs >= 1e5) return sign + '₹' + (abs / 1e5).toFixed(1) + 'L';
    if (abs >= 1e3) return sign + '₹' + (abs / 1e3).toFixed(1) + 'k';
    return sign + '₹' + abs.toFixed(0);
  };

  // Column Sort state
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
            term: termFilter !== 'ALL' ? termFilter : undefined,
            sector: sectorFilter !== 'ALL' ? sectorFilter : undefined,
            marketCap: marketCapFilter !== 'ALL' ? marketCapFilter : undefined,
            horizon: horizonFilter !== 'ALL' ? horizonFilter : undefined,
            month: monthFilter !== 'ALL' ? monthFilter : undefined,
            startDate: calendarRange.startDate || undefined,
            endDate: calendarRange.endDate || undefined,
            query: searchQuery.trim() || undefined,
            sortField,
            sortOrder
          }
        }),
        axios.get('/api/trading-journal/stats', {
          params: {
            market: marketFilter !== 'ALL' ? marketFilter : undefined,
            term: termFilter !== 'ALL' ? termFilter : undefined,
            sector: sectorFilter !== 'ALL' ? sectorFilter : undefined,
            marketCap: marketCapFilter !== 'ALL' ? marketCapFilter : undefined,
            horizon: horizonFilter !== 'ALL' ? horizonFilter : undefined,
            month: monthFilter !== 'ALL' ? monthFilter : undefined,
            startDate: calendarRange.startDate || undefined,
            endDate: calendarRange.endDate || undefined
          }
        })
      ]);

      if (symbolsRes.data?.symbols) {
        setSymbols(symbolsRes.data.symbols);
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

  // Reset pagination to page 1 whenever any filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [marketFilter, outcomeFilter, termFilter, sectorFilter, marketCapFilter, horizonFilter, monthFilter, badgeFilter, positionFilter, searchQuery, calendarRange]);

  useEffect(() => {
    fetchJournalData();
  }, [marketFilter, outcomeFilter, termFilter, sectorFilter, marketCapFilter, horizonFilter, monthFilter, calendarRange, sortField, sortOrder, searchQuery]);

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

  // Graph click handlers: filter down and smoothly scroll to the symbols table
  const scrollToSymbols = () => {
    if (symbolsSectionRef.current) {
      symbolsSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleSelectMonth = (month) => {
    if (!month) return;
    setMonthFilter(prev => prev === month ? 'ALL' : month);
    scrollToSymbols();
  };

  const handleSelectHorizon = (horizonId) => {
    if (!horizonId) return;
    setHorizonFilter(prev => prev === horizonId ? 'ALL' : horizonId);
    scrollToSymbols();
  };

  const handleSelectSector = (sector) => {
    if (!sector) return;
    setSectorFilter(prev => prev === sector ? 'ALL' : sector);
    scrollToSymbols();
  };

  const handleSelectMarketCap = (mcap) => {
    if (!mcap) return;
    setMarketCapFilter(prev => prev === mcap ? 'ALL' : mcap);
    scrollToSymbols();
  };

  const clearAllGraphFilters = () => {
    setHorizonFilter('ALL');
    setMonthFilter('ALL');
    setSectorFilter('ALL');
    setMarketCapFilter('ALL');
    setTermFilter('ALL');
  };

  // Counts for Position Status Tabs
  const openCount = useMemo(() => symbols.filter(s => s.inPortfolio || s.isOpen).length, [symbols]);
  const exitedCount = useMemo(() => symbols.filter(s => !s.inPortfolio && !s.isOpen).length, [symbols]);

  // Client-side filtering
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

      if (termFilter === 'LTCG') {
        const hasLtcg = (sym.ltcgTradesCount > 0) || sym.trades?.some(t => t.taxTerm === 'LTCG' || (t.holdingDays !== undefined && t.holdingDays >= 365));
        if (!hasLtcg) return false;
      } else if (termFilter === 'STCG') {
        const hasStcg = (sym.stcgTradesCount > 0) || sym.trades?.some(t => t.taxTerm !== 'LTCG' && (t.holdingDays === undefined || t.holdingDays < 365));
        if (!hasStcg) return false;
      }

      if (sectorFilter !== 'ALL' && sym.sector !== sectorFilter) {
        return false;
      }

      if (marketCapFilter !== 'ALL') {
        const symMcap = sym.market_cap === 'Mega Cap' ? 'Large Cap' : sym.market_cap;
        if (symMcap !== marketCapFilter) return false;
      }

      return true;
    });
  }, [symbols, positionFilter, badgeFilter, termFilter, sectorFilter, marketCapFilter]);

  // Pagination calculation
  const totalRecords = filteredSymbols.length;
  const totalPages = pageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(totalRecords / pageSize));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const paginatedSymbols = useMemo(() => {
    if (pageSize === 'ALL') return filteredSymbols;
    const start = (safeCurrentPage - 1) * pageSize;
    return filteredSymbols.slice(start, start + pageSize);
  }, [filteredSymbols, safeCurrentPage, pageSize]);

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > totalPages) return;
    setCurrentPage(newPage);
    if (tableContainerRef.current) {
      tableContainerRef.current.scrollTop = 0;
    }
  };

  // Top KPI calculations
  const netPnl = isUsdMode ? (stats?.netPnl ?? 0) : (stats?.netPnlInr ?? stats?.netPnl ?? 0);
  const grossPnl = isUsdMode ? (stats?.grossPnl ?? 0) : (stats?.grossPnlInr ?? stats?.grossPnl ?? 0);
  const totalCharges = isUsdMode ? (stats?.totalCharges ?? 0) : (stats?.totalChargesInr ?? stats?.totalCharges ?? 0);
  const winRate = stats?.winRatePct ?? 0;
  const profitFactor = stats?.profitFactor ?? 0;
  const disciplineScore = stats?.disciplineScorePct ?? 100;
  const currentStreak = stats?.currentStreak ?? 0;
  const streakType = stats?.currentStreakType ?? 'WIN';

  // LTCG & STCG KPI calculations
  const ltcgData = stats?.ltcgTrades || {};
  const stcgData = stats?.stcgTrades || {};
  const ltcgNetPnl = isUsdMode ? (ltcgData.netPnl ?? 0) : (ltcgData.netPnlInr ?? ltcgData.netPnl ?? 0);
  const ltcgGrossPnl = isUsdMode ? (ltcgData.grossPnl ?? 0) : (ltcgData.grossPnlInr ?? ltcgData.grossPnl ?? 0);
  const ltcgTotalCharges = isUsdMode ? (ltcgData.totalCharges ?? 0) : (ltcgData.totalChargesInr ?? ltcgData.totalCharges ?? 0);

  const stcgNetPnl = isUsdMode ? (stcgData.netPnl ?? 0) : (stcgData.netPnlInr ?? stcgData.netPnl ?? 0);
  const stcgGrossPnl = isUsdMode ? (stcgData.grossPnl ?? 0) : (stcgData.grossPnlInr ?? stcgData.grossPnl ?? 0);
  const stcgTotalCharges = isUsdMode ? (stcgData.totalCharges ?? 0) : (stcgData.totalChargesInr ?? stcgData.totalCharges ?? 0);

  // Available unique sectors from stats
  const availableSectors = useMemo(() => {
    return Array.isArray(stats?.sectorBreakdown) ? stats.sectorBreakdown : [];
  }, [stats?.sectorBreakdown]);

  // Available market cap breakdown
  const availableMcaps = useMemo(() => {
    return Array.isArray(stats?.marketCapBreakdown) ? stats.marketCapBreakdown : [];
  }, [stats?.marketCapBreakdown]);

  // Holding Horizon breakdown
  const holdingHorizons = useMemo(() => {
    return Array.isArray(stats?.holdingHorizonBreakdown) ? stats.holdingHorizonBreakdown : [];
  }, [stats?.holdingHorizonBreakdown]);

  // Monthly PnL timeline for bar chart
  const monthlyTimeline = useMemo(() => {
    return Array.isArray(stats?.monthlyPnlTimeline) ? stats.monthlyPnlTimeline : [];
  }, [stats?.monthlyPnlTimeline]);

  // Cumulative PnL timeline for area chart
  const cumulativeTimeline = useMemo(() => {
    if (!Array.isArray(stats?.pnlTimeline)) return [];
    const raw = stats.pnlTimeline;
    if (raw.length <= 60) return raw;
    const step = Math.ceil(raw.length / 60);
    return raw.filter((_, idx) => idx % step === 0 || idx === raw.length - 1);
  }, [stats?.pnlTimeline]);

  // Active graph filter label
  const hasActiveGraphFilter = horizonFilter !== 'ALL' || monthFilter !== 'ALL' || sectorFilter !== 'ALL' || marketCapFilter !== 'ALL' || termFilter !== 'ALL';

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
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                }`}
              >
                <span>₹ INR</span>
              </button>
              <button
                type="button"
                onClick={() => currency !== 'USD' && toggleCurrency()}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  currency === 'USD'
                    ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/40'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                }`}
              >
                <span>$ USD</span>
              </button>
            </div>
          )}

          {/* 1-Click Sync Button */}
          <button
            type="button"
            onClick={handleSyncPortfolio}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-600 dark:text-cyan-400 text-xs font-bold hover:bg-cyan-500/25 transition-all cursor-pointer shadow-sm disabled:opacity-50"
            title="Import all closed sales and holdings from Ladder transactions"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync Portfolio'}</span>
          </button>

          {/* Log New Trade Button */}
          <button
            type="button"
            onClick={() => {
              setTradeToEdit(null);
              setIsFormOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black transition-all cursor-pointer shadow-md"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3]" />
            <span>Log Trade</span>
          </button>
        </div>
      </div>

      {/* Sync Toast Notification */}
      <AnimatePresence>
        {syncToast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="p-3 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-600 dark:text-cyan-300 text-xs font-mono font-bold flex items-center justify-between shadow-sm"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-cyan-500" />
              <span>{syncToast}</span>
            </div>
            <button
              type="button"
              onClick={() => setSyncToast('')}
              className="p-1 hover:opacity-75 cursor-pointer text-inherit"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2a. Executive Performance KPI Strip (2 Spacious Rows of 4 Cards - ZERO Ellipsis, ZERO '...') */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5 sm:gap-4">
        {/* Card 1: Net Realized P&L */}
        <motion.div
          whileHover={{ y: -2 }}
          className="reports-subcard rounded-2xl border border-[var(--border-color)] p-4 flex flex-col justify-between shadow-sm min-w-0"
        >
          <div className="text-[11px] uppercase font-bold tracking-wider text-[var(--text-muted)] whitespace-nowrap">Net Realized P&L</div>
          <div className="my-2">
            <span className={`text-xl sm:text-2xl font-black font-mono tracking-tight whitespace-nowrap block ${
              netPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}>
              {netPnl > 0 ? '+' : ''}{formatVal(netPnl)}
            </span>
          </div>
          <div className="pt-2 border-t border-[var(--border-color)] text-xs font-mono flex items-center justify-between text-[var(--text-secondary)] whitespace-nowrap">
            <span className="opacity-75 font-sans uppercase text-[10px]">Gross P&L</span>
            <span className="font-bold">{formatVal(grossPnl)}</span>
          </div>
        </motion.div>

        {/* Card 2: Win Rate */}
        <motion.div
          whileHover={{ y: -2 }}
          className="reports-subcard rounded-2xl border border-[var(--border-color)] p-4 flex flex-col justify-between shadow-sm min-w-0"
        >
          <div className="text-[11px] uppercase font-bold tracking-wider text-[var(--text-muted)] whitespace-nowrap">Win Rate</div>
          <div className="my-2">
            <span className={`text-xl sm:text-2xl font-black font-mono tracking-tight whitespace-nowrap block ${
              winRate >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
            }`}>
              {(Number(winRate) || 0).toFixed(1)}%
            </span>
          </div>
          <div className="pt-2 border-t border-[var(--border-color)] text-xs font-mono flex items-center justify-between text-[var(--text-secondary)] whitespace-nowrap">
            <span className="opacity-75 font-sans text-[10px] uppercase">Win / Loss</span>
            <span className="font-bold">{stats?.winCount || 0}W / {stats?.lossCount || 0}L</span>
          </div>
        </motion.div>

        {/* Card 3: Closed Trades */}
        <motion.div
          whileHover={{ y: -2 }}
          className="reports-subcard rounded-2xl border border-[var(--border-color)] p-4 flex flex-col justify-between shadow-sm min-w-0"
        >
          <div className="text-[11px] uppercase font-bold tracking-wider text-[var(--text-muted)] whitespace-nowrap">Closed Trades</div>
          <div className="my-2">
            <span className="text-xl sm:text-2xl font-black font-mono tracking-tight text-[var(--text-primary)] whitespace-nowrap block">
              {(stats?.closedTradesCount || 0).toLocaleString()}
            </span>
          </div>
          <div className="pt-2 border-t border-[var(--border-color)] text-xs font-mono flex items-center justify-between text-[var(--text-secondary)] whitespace-nowrap">
            <span className="opacity-75 font-sans text-[10px] uppercase">Open Positions</span>
            <span className="font-bold">{stats?.openTradesCount || 0} Positions</span>
          </div>
        </motion.div>

        {/* Card 4: Total Charges */}
        <motion.div
          whileHover={{ y: -2 }}
          className="reports-subcard rounded-2xl border border-[var(--border-color)] p-4 flex flex-col justify-between shadow-sm min-w-0"
        >
          <div className="text-[11px] uppercase font-bold tracking-wider text-[var(--text-muted)] whitespace-nowrap">Total Charges</div>
          <div className="my-2">
            <span className="text-xl sm:text-2xl font-black font-mono tracking-tight text-amber-600 dark:text-amber-400 whitespace-nowrap block">
              {formatVal(totalCharges)}
            </span>
          </div>
          <div className="pt-2 border-t border-[var(--border-color)] text-xs font-mono flex items-center justify-between text-[var(--text-secondary)] whitespace-nowrap">
            <span className="opacity-75 font-sans uppercase text-[10px]">Statutory Drag</span>
            <span className="font-bold text-amber-600 dark:text-amber-400">
              {grossPnl > 0 ? ((totalCharges / grossPnl) * 100).toFixed(1) + '%' : '—'}
            </span>
          </div>
        </motion.div>

        {/* Card 5: Profit Factor */}
        <motion.div
          whileHover={{ y: -2 }}
          className="reports-subcard rounded-2xl border border-[var(--border-color)] p-4 flex flex-col justify-between shadow-sm min-w-0"
        >
          <div className="text-[11px] uppercase font-bold tracking-wider text-[var(--text-muted)] whitespace-nowrap">Profit Factor</div>
          <div className="my-2">
            <span className={`text-xl sm:text-2xl font-black font-mono tracking-tight whitespace-nowrap block ${
              profitFactor >= 1.5 ? 'text-emerald-600 dark:text-emerald-400' : profitFactor >= 1.0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
            }`}>
              {(Number(profitFactor) || 0).toFixed(2)}x
            </span>
          </div>
          <div className="pt-2 border-t border-[var(--border-color)] text-xs font-mono flex items-center justify-between text-[var(--text-secondary)] whitespace-nowrap">
            <span className="opacity-75 font-sans uppercase text-[10px]">Average Win/Loss</span>
            <span className="font-bold">{stats?.winLossRatio?.toFixed(2) || '0.00'}</span>
          </div>
        </motion.div>

        {/* Card 6: Discipline Score */}
        <motion.div
          whileHover={{ y: -2 }}
          className="reports-subcard rounded-2xl border border-[var(--border-color)] p-4 flex flex-col justify-between shadow-sm min-w-0"
        >
          <div className="text-[11px] uppercase font-bold tracking-wider text-[var(--text-muted)] flex items-center justify-between whitespace-nowrap">
            <span>Discipline Score</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          </div>
          <div className="my-2">
            <span className={`text-xl sm:text-2xl font-black font-mono tracking-tight whitespace-nowrap block ${
              disciplineScore >= 80 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
            }`}>
              {(Number(disciplineScore) || 0).toFixed(0)}%
            </span>
          </div>
          <div className="pt-2 border-t border-[var(--border-color)] text-xs font-sans flex items-center justify-between text-[var(--text-secondary)] whitespace-nowrap">
            <span className="opacity-75 text-[10px] uppercase">Plan Respected</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">100%</span>
          </div>
        </motion.div>

        {/* Card 7: Active Streak */}
        <motion.div
          whileHover={{ y: -2 }}
          className="reports-subcard rounded-2xl border border-[var(--border-color)] p-4 flex flex-col justify-between shadow-sm min-w-0"
        >
          <div className="text-[11px] uppercase font-bold tracking-wider text-[var(--text-muted)] whitespace-nowrap">Active Streak</div>
          <div className="my-2 flex items-center gap-1.5 whitespace-nowrap">
            {streakType === 'WIN' && currentStreak > 0 ? (
              <Flame className="w-5 h-5 text-amber-500 animate-pulse shrink-0" />
            ) : null}
            <span className={`text-xl sm:text-2xl font-black font-mono tracking-tight ${
              streakType === 'WIN' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}>
              {currentStreak} {streakType === 'WIN' ? 'Wins' : 'Losses'}
            </span>
          </div>
          <div className="pt-2 border-t border-[var(--border-color)] text-xs font-mono flex items-center justify-between text-[var(--text-secondary)] whitespace-nowrap">
            <span className="opacity-75 font-sans text-[10px] uppercase">Max Historical</span>
            <span className="font-bold">{stats?.maxWinStreak || 0} Wins</span>
          </div>
        </motion.div>

        {/* Card 8: Symbols Tracked */}
        <motion.div
          whileHover={{ y: -2 }}
          className="reports-subcard rounded-2xl border border-[var(--border-color)] p-4 flex flex-col justify-between shadow-sm min-w-0"
        >
          <div className="text-[11px] uppercase font-bold tracking-wider text-[var(--text-muted)] whitespace-nowrap">Symbols Tracked</div>
          <div className="my-2">
            <span className="text-xl sm:text-2xl font-black font-mono tracking-tight text-[var(--text-primary)] whitespace-nowrap block">
              {symbols.length}
            </span>
          </div>
          <div className="pt-2 border-t border-[var(--border-color)] text-xs font-mono flex items-center justify-between text-[var(--text-secondary)] whitespace-nowrap">
            <span className="opacity-75 font-sans text-[10px] uppercase">Orders Logged</span>
            <span className="font-bold">{(stats?.totalTrades || 0).toLocaleString()}</span>
          </div>
        </motion.div>
      </div>

      {/* 2b. Long-Term (LTCG >= 1 Year) vs Short-Term (STCG < 1 Year) Capital Gains Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
        {/* Long-Term Trades (LTCG) Card */}
        <motion.div
          whileHover={{ y: -2 }}
          onClick={() => setTermFilter(prev => prev === 'LTCG' ? 'ALL' : 'LTCG')}
          className={`reports-subcard rounded-2xl border p-4 shadow-sm flex flex-col justify-between cursor-pointer transition-all ${
            termFilter === 'LTCG' ? 'border-emerald-500/60 ring-2 ring-emerald-500/20 bg-emerald-500/[0.04]' : 'border-[var(--border-color)] hover:border-emerald-500/40'
          }`}
          title="Click to filter journal by Long-Term Trades"
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-black bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                <Clock className="w-3.5 h-3.5" />
                <span>Long-Term Trades (LTCG ≥ 1 Year)</span>
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30">
                12.5% Tax Rate
              </span>
            </div>
            <span className={`text-xs font-mono font-bold ${
              (ltcgData.winRatePct || 0) >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
            }`}>
              {(Number(ltcgData.winRatePct) || 0).toFixed(1)}% Win Rate
            </span>
          </div>

          <div className="my-3 flex items-baseline justify-between gap-2 flex-wrap">
            <div>
              <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)]">Net Realized P&L</div>
              <div className={`text-xl sm:text-2xl font-black font-mono tracking-tight ${
                ltcgNetPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}>
                {ltcgNetPnl > 0 ? '+' : ''}{formatVal(ltcgNetPnl)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)]">Win / Loss</div>
              <div className="text-base font-black font-mono text-[var(--text-primary)]">
                <span className="text-emerald-600 dark:text-emerald-400">{ltcgData.winCount || 0}W</span>
                <span className="text-[var(--text-muted)] mx-1">/</span>
                <span className="text-rose-600 dark:text-rose-400">{ltcgData.lossCount || 0}L</span>
                <span className="text-[10px] text-[var(--text-muted)] ml-1 font-sans">({ltcgData.count || 0} closed)</span>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-[var(--border-color)] text-xs font-mono flex items-center justify-between text-[var(--text-secondary)] flex-wrap gap-2">
            <span className="opacity-75 font-sans text-[10px] uppercase">Gross: {formatVal(ltcgGrossPnl)}</span>
            <span className="text-amber-600 dark:text-amber-400 font-bold">Charges: -{formatVal(ltcgTotalCharges)}</span>
            <span className="text-cyan-600 dark:text-cyan-400 font-bold">Capital: {formatVal(isUsdMode ? ltcgData.totalCapital : (ltcgData.totalCapitalInr ?? ltcgData.totalCapital))}</span>
            <span className="text-[var(--text-secondary)] font-bold">Avg Hold: {ltcgData.avgHoldingDays || 0}d</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-bold">ROI: {ltcgData.roiPct >= 0 ? '+' : ''}{(Number(ltcgData.roiPct) || 0).toFixed(1)}%</span>
          </div>
        </motion.div>

        {/* Short-Term Trades (STCG) Card */}
        <motion.div
          whileHover={{ y: -2 }}
          onClick={() => setTermFilter(prev => prev === 'STCG' ? 'ALL' : 'STCG')}
          className={`reports-subcard rounded-2xl border p-4 shadow-sm flex flex-col justify-between cursor-pointer transition-all ${
            termFilter === 'STCG' ? 'border-sky-500/60 ring-2 ring-sky-500/20 bg-sky-500/[0.04]' : 'border-[var(--border-color)] hover:border-sky-500/40'
          }`}
          title="Click to filter journal by Short-Term Trades"
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-black bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30">
                <Clock className="w-3.5 h-3.5" />
                <span>Short-Term Trades (STCG &lt; 1 Year)</span>
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                20% Tax Rate
              </span>
            </div>
            <span className={`text-xs font-mono font-bold ${
              (stcgData.winRatePct || 0) >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
            }`}>
              {(Number(stcgData.winRatePct) || 0).toFixed(1)}% Win Rate
            </span>
          </div>

          <div className="my-3 flex items-baseline justify-between gap-2 flex-wrap">
            <div>
              <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)]">Net Realized P&L</div>
              <div className={`text-xl sm:text-2xl font-black font-mono tracking-tight ${
                stcgNetPnl > 0 ? 'text-emerald-600 dark:text-emerald-400' : stcgNetPnl < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-[var(--text-primary)]'
              }`}>
                {stcgNetPnl > 0 ? '+' : ''}{formatVal(stcgNetPnl)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)]">Win / Loss</div>
              <div className="text-base font-black font-mono text-[var(--text-primary)]">
                <span className="text-emerald-600 dark:text-emerald-400">{stcgData.winCount || 0}W</span>
                <span className="text-[var(--text-muted)] mx-1">/</span>
                <span className="text-rose-600 dark:text-rose-400">{stcgData.lossCount || 0}L</span>
                <span className="text-[10px] text-[var(--text-muted)] ml-1 font-sans">({stcgData.count || 0} closed)</span>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-[var(--border-color)] text-xs font-mono flex items-center justify-between text-[var(--text-secondary)] flex-wrap gap-2">
            <span className="opacity-75 font-sans text-[10px] uppercase">Gross: {formatVal(stcgGrossPnl)}</span>
            <span className="text-amber-600 dark:text-amber-400 font-bold">Charges: -{formatVal(stcgTotalCharges)}</span>
            <span className="text-cyan-600 dark:text-cyan-400 font-bold">Capital: {formatVal(isUsdMode ? stcgData.totalCapital : (stcgData.totalCapitalInr ?? stcgData.totalCapital))}</span>
            <span className="text-[var(--text-secondary)] font-bold">Avg Hold: {stcgData.avgHoldingDays || 0}d</span>
            <span className={`font-bold ${(stcgData.roiPct || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              ROI: {stcgData.roiPct >= 0 ? '+' : ''}{(Number(stcgData.roiPct) || 0).toFixed(1)}%
            </span>
          </div>
        </motion.div>
      </div>

      {/* 2c. Visual Insights Studio (Animated & Interactive Charts with Calendar Filter) */}
      <div className="reports-card rounded-3xl border border-[var(--border-color)] p-4 sm:p-5 shadow-sm space-y-4">
        {/* Studio Navigation & Segments */}
        <div className="flex items-center justify-between flex-wrap gap-3 pb-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
              <BarChart3 className="w-4 h-4" />
            </div>
            <span className="text-sm font-black text-[var(--text-primary)] uppercase tracking-wider">
              Visual Insights Studio
            </span>
          </div>

          {/* Segmented Switcher */}
          <div className="flex items-center p-0.5 rounded-xl reports-subcard border border-[var(--border-color)] overflow-x-auto">
            {[
              { id: 'EQUITY', label: 'Cumulative & Monthly P&L', icon: TrendingUp },
              { id: 'HORIZON', label: 'Holding Horizon Sweet Spot', icon: Clock },
              { id: 'SECTORS', label: 'Sector Realized Alpha', icon: PieChart },
              { id: 'MCAP', label: 'Market Cap Alpha', icon: Layers },
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = activeVisualTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveVisualTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    isActive
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab 1: Cumulative Equity Curve & Monthly Realized P&L */}
        {activeVisualTab === 'EQUITY' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {/* Calendar Range Selector Strip */}
            <div className="flex items-center justify-between flex-wrap gap-2 pb-1">
              <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                Realized Performance Timeline
              </span>
              <div className="flex items-center gap-2">
                <ChartRangeSelector
                  initialRange="ALL"
                  onChange={({ startDate, endDate, label }) => {
                    setCalendarRange({ startDate, endDate, label });
                  }}
                  popoverAlign="right"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Cumulative P&L Area Chart */}
              <div className="reports-subcard p-4 rounded-2xl border border-[var(--border-color)] space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-[var(--text-secondary)]">
                  <span className="uppercase tracking-wider text-[10px] text-[var(--text-muted)]">Cumulative Net Realized Equity Curve</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 font-black">
                    +{formatVal(netPnl)}
                  </span>
                </div>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cumulativeTimeline} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="pnlAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.06} />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} tickFormatter={formatCompactVal} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--bg-card)',
                          borderColor: 'var(--border-color)',
                          borderRadius: '12px',
                          fontSize: '11px',
                          color: 'var(--text-primary)'
                        }}
                        formatter={(val) => [formatVal(val), 'Cumulative Net P&L']}
                        labelFormatter={(lbl) => `Date: ${lbl}`}
                      />
                      <Area type="monotone" dataKey={isUsdMode ? "cumulativeNetPnl" : "cumulativeNetPnlInr"} stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#pnlAreaGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Monthly Realized P&L Bar Chart */}
              <div className="reports-subcard p-4 rounded-2xl border border-[var(--border-color)] space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-[var(--text-secondary)]">
                  <span className="uppercase tracking-wider text-[10px] text-[var(--text-muted)]">Monthly Realized P&L Performance</span>
                  <span className="font-mono text-[var(--text-muted)] text-[10px]">
                    {monthFilter !== 'ALL' ? `Month Filter: ${monthFilter}` : `${monthlyTimeline.length} Trading Months`} (Click bar to filter)
                  </span>
                </div>
                <div className="h-56 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={monthlyTimeline}
                      margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                      onClick={(state) => {
                        const m = state?.activePayload?.[0]?.payload?.month || state?.activeLabel;
                        if (m) handleSelectMonth(m);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.06} />
                      <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} tickFormatter={formatCompactVal} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--bg-card)',
                          borderColor: 'var(--border-color)',
                          borderRadius: '12px',
                          fontSize: '11px',
                          color: 'var(--text-primary)'
                        }}
                        formatter={(val, name, item) => [
                          `${formatVal(val)} (${item.payload.winRatePct}% WR • ${item.payload.trades} trades)`,
                          'Monthly Net P&L'
                        ]}
                      />
                      <Bar dataKey={isUsdMode ? "netPnl" : "netPnlInr"} radius={[4, 4, 0, 0]}>
                        {monthlyTimeline.map((entry, index) => {
                          const val = isUsdMode ? entry.netPnl : entry.netPnlInr;
                          const isSelected = monthFilter === entry.month;
                          return (
                            <Cell
                              key={`cell-${index}`}
                              fill={val >= 0 ? '#10b981' : '#f43f5e'}
                              stroke={isSelected ? '#ffffff' : 'none'}
                              strokeWidth={isSelected ? 2 : 0}
                            />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Tab 2: Holding Horizon Sweet Spot (with Capital Invested & Interactive Filter) */}
        {activeVisualTab === 'HORIZON' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                Holding Duration Sweet Spot (Click any row or bar to filter trades)
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-mono text-[11px] font-bold">
                Peak Edge: &gt; 365 Days / LTCG (79.2% Win Rate, +₹16.84L)
              </span>
            </div>

            {/* Horizon Bar Chart */}
            <div className="reports-subcard p-4 rounded-2xl border border-[var(--border-color)]">
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={holdingHorizons}
                    margin={{ top: 15, right: 15, left: -10, bottom: 0 }}
                    onClick={(state) => {
                      const hId = state?.activePayload?.[0]?.payload?.id;
                      if (hId) handleSelectHorizon(hId);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.06} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-primary)', fontWeight: 600 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} tickFormatter={formatCompactVal} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-color)',
                        borderRadius: '12px',
                        fontSize: '11px',
                        color: 'var(--text-primary)'
                      }}
                      formatter={(val, name, item) => [
                        `${formatVal(val)} | Capital: ${formatVal(isUsdMode ? item.payload.totalCapital : (item.payload.totalCapitalInr ?? item.payload.totalCapital))} (${item.payload.winRatePct}% WR • ${item.payload.trades} trades • ${item.payload.avgHoldingDays}d avg)`,
                        'Realized Net P&L'
                      ]}
                    />
                    <Bar dataKey="netPnlInr" radius={[6, 6, 0, 0]}>
                      {holdingHorizons.map((entry, index) => {
                        const isSelected = horizonFilter === entry.id;
                        return (
                          <Cell
                            key={`cell-h-${index}`}
                            fill={entry.netPnlInr >= 0 ? '#10b981' : '#f43f5e'}
                            stroke={isSelected ? '#ffffff' : 'none'}
                            strokeWidth={isSelected ? 2 : 0}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Horizon Metric Breakdown Cards with Capital Invested */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {holdingHorizons.map(h => {
                const isProfit = h.netPnlInr >= 0;
                const isSelected = horizonFilter === h.id;
                return (
                  <div
                    key={h.id}
                    onClick={() => handleSelectHorizon(h.id)}
                    className={`p-3.5 rounded-2xl border reports-subcard cursor-pointer transition-all hover:scale-[1.01] ${
                      isSelected
                        ? 'border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-500/10'
                        : h.id === 'LTCG'
                        ? 'border-emerald-500/40 bg-emerald-500/[0.04]'
                        : 'border-[var(--border-color)] hover:border-emerald-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-bold text-[var(--text-muted)] uppercase">
                      <span>{h.label}</span>
                      <span className={`font-mono ${h.winRatePct >= 50 ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {h.winRatePct}% WR
                      </span>
                    </div>

                    <div className={`text-lg font-black font-mono my-1 ${
                      isProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}>
                      {isProfit ? '+' : ''}{formatVal(h.netPnlInr)}
                    </div>

                    {/* Capital Invested Metric */}
                    <div className="text-xs font-mono font-bold text-cyan-600 dark:text-cyan-400 pb-1 mb-1 border-b border-[var(--border-color)]">
                      Capital: {formatVal(isUsdMode ? h.totalCapital : (h.totalCapitalInr ?? h.totalCapital))}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)] font-mono">
                      <span>{h.trades} trades</span>
                      <span>{h.winCount}W / {h.lossCount}L</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Tab 3: Sector Alpha (Shows ALL Sectors with Capital Invested & Interactive Filter) */}
        {activeVisualTab === 'SECTORS' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                All {availableSectors.length} Sectors Ranked by Realized Net P&L (Click row or bar to filter trades)
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-mono text-[11px] font-bold">
                Top Alpha: Power & Electrical (+₹4.42L)
              </span>
            </div>

            {/* Horizontal Bar Chart for ALL Sectors */}
            <div className="reports-subcard p-4 rounded-2xl border border-[var(--border-color)] overflow-hidden">
              <div
                className="w-full overflow-y-auto pr-2 custom-scrollbar"
                style={{ height: Math.min(640, Math.max(480, availableSectors.length * 30)) }}
              >
                <ResponsiveContainer width="100%" height={Math.max(480, availableSectors.length * 30)}>
                  <BarChart
                    layout="vertical"
                    data={availableSectors}
                    margin={{ top: 10, right: 25, left: 20, bottom: 10 }}
                    onClick={(state) => {
                      const sec = state?.activePayload?.[0]?.payload?.sector || state?.activeLabel;
                      if (sec) handleSelectSector(sec);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.06} />
                    <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} tickFormatter={formatCompactVal} />
                    <YAxis
                      dataKey="sector"
                      type="category"
                      width={175}
                      tick={{ fontSize: 10, fill: 'var(--text-primary)', fontWeight: 600 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-color)',
                        borderRadius: '12px',
                        fontSize: '11px',
                        color: 'var(--text-primary)'
                      }}
                      formatter={(val, name, item) => [
                        `${formatVal(val)} | Capital: ${formatVal(isUsdMode ? item.payload.totalCapital : (item.payload.totalCapitalInr ?? item.payload.totalCapital))} (${item.payload.winRatePct}% WR • ${item.payload.trades} trades • ROI: ${item.payload.roiPct}%)`,
                        'Realized Net P&L'
                      ]}
                    />
                    <Bar dataKey="netPnlInr" radius={[0, 4, 4, 0]}>
                      {availableSectors.map((entry, index) => {
                        const isSelected = sectorFilter === entry.sector;
                        return (
                          <Cell
                            key={`cell-sec-${index}`}
                            fill={entry.netPnlInr >= 0 ? '#10b981' : '#f43f5e'}
                            stroke={isSelected ? '#ffffff' : 'none'}
                            strokeWidth={isSelected ? 2 : 0}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Quick Sector Cards Grid with Capital Invested */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {availableSectors.map(s => {
                const isSelected = sectorFilter === s.sector;
                const isProfit = s.netPnlInr >= 0;
                return (
                  <div
                    key={s.sector}
                    onClick={() => handleSelectSector(s.sector)}
                    className={`p-3 rounded-2xl border reports-subcard cursor-pointer transition-all hover:scale-[1.01] ${
                      isSelected
                        ? 'border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-500/10'
                        : 'border-[var(--border-color)] hover:border-emerald-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 text-[11px] font-bold text-[var(--text-primary)]">
                      <span className="truncate" title={s.sector}>{s.sector}</span>
                      <span className={`text-[10px] font-mono shrink-0 ${s.winRatePct >= 50 ? 'text-emerald-500' : 'text-amber-500'}`}>
                        {s.winRatePct}%
                      </span>
                    </div>
                    <div className={`text-base font-black font-mono my-1 ${
                      isProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}>
                      {isProfit ? '+' : ''}{formatVal(s.netPnlInr)}
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-secondary)] border-t border-[var(--border-color)] pt-1.5 gap-2">
                      <span className="text-cyan-600 dark:text-cyan-400 font-bold whitespace-nowrap">
                        Capital: {formatVal(isUsdMode ? s.totalCapital : (s.totalCapitalInr ?? s.totalCapital))}
                      </span>
                      <span className="whitespace-nowrap shrink-0">{s.trades} trades</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Tab 4: Market Cap Alpha (with Capital Invested & Interactive Filter) */}
        {activeVisualTab === 'MCAP' && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                Realized Performance by Market Capitalisation (Click card or bar to filter)
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-mono text-[11px] font-bold">
                Small Cap Alpha: +₹9.14L Realized P&L
              </span>
            </div>

            {/* Market Cap 4-Card Grid with Capital Invested */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {availableMcaps.map(m => {
                const isProfit = m.netPnlInr >= 0;
                const isSelected = marketCapFilter === m.marketCap;
                return (
                  <div
                    key={m.marketCap}
                    onClick={() => handleSelectMarketCap(m.marketCap)}
                    className={`p-4 rounded-2xl border reports-subcard space-y-2 cursor-pointer transition-all hover:scale-[1.01] ${
                      isSelected
                        ? 'border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-500/10'
                        : m.marketCap === 'Small Cap'
                        ? 'border-emerald-500/40 bg-emerald-500/[0.03]'
                        : 'border-[var(--border-color)] hover:border-emerald-500/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-[var(--text-primary)]">{m.marketCap}</span>
                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md ${
                        m.winRatePct >= 50 ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      }`}>
                        {m.winRatePct}% Win Rate
                      </span>
                    </div>

                    <div className={`text-xl font-black font-mono ${
                      isProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}>
                      {isProfit ? '+' : ''}{formatVal(m.netPnlInr)}
                    </div>

                    {/* Capital Invested Metric */}
                    <div className="text-xs font-mono font-bold text-cyan-600 dark:text-cyan-400 pb-1 border-b border-[var(--border-color)]">
                      Capital Invested: {formatVal(isUsdMode ? m.totalCapital : (m.totalCapitalInr ?? m.totalCapital))}
                    </div>

                    <div className="pt-1 text-xs font-mono flex items-center justify-between text-[var(--text-secondary)]">
                      <span>{m.trades} trades ({m.winCount}W/{m.lossCount}L)</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-bold">ROI: {m.roiPct >= 0 ? '+' : ''}{m.roiPct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Market Cap Bar Chart */}
            <div className="reports-subcard p-4 rounded-2xl border border-[var(--border-color)]">
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={availableMcaps}
                    margin={{ top: 15, right: 15, left: -10, bottom: 0 }}
                    onClick={(state) => {
                      const mcap = state?.activePayload?.[0]?.payload?.marketCap || state?.activeLabel;
                      if (mcap) handleSelectMarketCap(mcap);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.06} />
                    <XAxis dataKey="marketCap" tick={{ fontSize: 10, fill: 'var(--text-primary)', fontWeight: 600 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} tickFormatter={formatCompactVal} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-color)',
                        borderRadius: '12px',
                        fontSize: '11px',
                        color: 'var(--text-primary)'
                      }}
                      formatter={(val, name, item) => [
                        `${formatVal(val)} | Capital: ${formatVal(isUsdMode ? item.payload.totalCapital : (item.payload.totalCapitalInr ?? item.payload.totalCapital))} (${item.payload.winRatePct}% Win Rate • ${item.payload.trades} trades)`,
                        'Realized Net P&L'
                      ]}
                    />
                    <Bar dataKey="netPnlInr" radius={[6, 6, 0, 0]}>
                      {availableMcaps.map((entry, index) => {
                        const isSelected = marketCapFilter === entry.marketCap;
                        return (
                          <Cell
                            key={`cell-mcap-${index}`}
                            fill={entry.netPnlInr >= 0 ? '#10b981' : '#f43f5e'}
                            stroke={isSelected ? '#ffffff' : 'none'}
                            strokeWidth={isSelected ? 2 : 0}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      {/* Active Graph Filter Badge Strip (Instant Dismissible Banner) */}
      <AnimatePresence>
        {hasActiveGraphFilter && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between flex-wrap gap-2 text-xs font-semibold"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider text-[10px]">
                <Filter className="w-3.5 h-3.5" /> Active Graph Filter:
              </span>
              {horizonFilter !== 'ALL' && (
                <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono text-[11px]">
                  Horizon: {holdingHorizons.find(h => h.id === horizonFilter)?.label || horizonFilter}
                </span>
              )}
              {monthFilter !== 'ALL' && (
                <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono text-[11px]">
                  Month: {monthFilter}
                </span>
              )}
              {sectorFilter !== 'ALL' && (
                <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono text-[11px]">
                  Sector: {sectorFilter}
                </span>
              )}
              {marketCapFilter !== 'ALL' && (
                <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono text-[11px]">
                  Cap: {marketCapFilter}
                </span>
              )}
              {termFilter !== 'ALL' && (
                <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-mono text-[11px]">
                  Term: {termFilter}
                </span>
              )}
              <span className="text-[var(--text-muted)] text-[11px] font-mono">
                ({filteredSymbols.length} stocks matching)
              </span>
            </div>

            <button
              type="button"
              onClick={clearAllGraphFilters}
              className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-bold text-[11px] transition-all cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Clear Filter</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. Master Multi-Filter Toolbar */}
      <div ref={symbolsSectionRef} className="reports-card rounded-2xl border border-[var(--border-color)] p-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
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

          {/* Capital Gains Term Switcher (LTCG vs STCG) */}
          <div className="flex items-center p-0.5 rounded-xl reports-subcard border border-[var(--border-color)]">
            {[
              { id: 'ALL', label: 'All Terms' },
              { id: 'LTCG', label: `LTCG ≥1y (${stats?.ltcgTrades?.count || 0})` },
              { id: 'STCG', label: `STCG <1y (${stats?.stcgTrades?.count || 0})` },
            ].map(term => (
              <button
                key={term.id}
                type="button"
                onClick={() => setTermFilter(term.id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                  termFilter === term.id
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-transparent'
                }`}
              >
                {term.label}
              </button>
            ))}
          </div>

          {/* Sector Filter Dropdown */}
          <select
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl reports-subcard border border-[var(--border-color)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-emerald-500/50 cursor-pointer"
          >
            <option value="ALL">All Sectors ({availableSectors.length})</option>
            {availableSectors.map(s => (
              <option key={s.sector} value={s.sector}>
                {s.sector} ({s.trades})
              </option>
            ))}
          </select>

          {/* Market Cap Filter Dropdown */}
          <select
            value={marketCapFilter}
            onChange={(e) => setMarketCapFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl reports-subcard border border-[var(--border-color)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-emerald-500/50 cursor-pointer"
          >
            <option value="ALL">All Market Caps</option>
            <option value="Large Cap">Large Cap ({stats?.marketCapBreakdown?.find(m=>m.marketCap==='Large Cap')?.trades || 0})</option>
            <option value="Mid Cap">Mid Cap ({stats?.marketCapBreakdown?.find(m=>m.marketCap==='Mid Cap')?.trades || 0})</option>
            <option value="Small Cap">Small Cap ({stats?.marketCapBreakdown?.find(m=>m.marketCap==='Small Cap')?.trades || 0})</option>
            <option value="Micro Cap">Micro Cap ({stats?.marketCapBreakdown?.find(m=>m.marketCap==='Micro Cap')?.trades || 0})</option>
          </select>

          {/* Analysis Badges Filter */}
          <select
            value={badgeFilter}
            onChange={(e) => setBadgeFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl reports-subcard border border-[var(--border-color)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-emerald-500/50 cursor-pointer"
          >
            <option value="ALL">All Badges</option>
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

      {/* 4. Symbol Trade Master Display: Paginated Table vs Cards */}
      {filteredSymbols.length === 0 ? (
        <div className="reports-card rounded-3xl border border-[var(--border-color)] p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 flex items-center justify-center mx-auto">
            <Coins className="w-6 h-6" />
          </div>
          <p className="text-sm font-bold text-[var(--text-primary)]">No trades found matching current criteria.</p>
          <p className="text-xs text-[var(--text-muted)]">
            Try resetting your filters or click "Sync Portfolio" to pull your latest trade executions.
          </p>
        </div>
      ) : displayLayout === 'table' ? (
        <div ref={tableContainerRef} className="reports-card rounded-3xl border border-[var(--border-color)] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--border-color)] bg-[var(--bg-card)]/50">
                <tr>
                  <th
                    onClick={() => handleSort('symbol')}
                    className="py-3 px-4 font-bold text-[var(--text-secondary)] uppercase tracking-wider text-[10px] cursor-pointer hover:text-emerald-500 select-none"
                  >
                    <div className="flex items-center gap-1">
                      <span>Ticker</span>
                      <span className="text-[var(--text-muted)]">/</span>
                      <span onClick={(e) => { e.stopPropagation(); handleSort('name'); }} className="hover:text-emerald-500">Stock Name</span>
                      <ArrowUpDown className="w-3 h-3 ml-1 opacity-60" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('totalTrades')}
                    className="py-3 px-3 text-right font-bold text-[var(--text-secondary)] uppercase tracking-wider text-[10px] cursor-pointer hover:text-emerald-500 select-none whitespace-nowrap"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Trades</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('totalCapital')}
                    className="py-3 px-3 text-right font-bold text-[var(--text-secondary)] uppercase tracking-wider text-[10px] cursor-pointer hover:text-emerald-500 select-none whitespace-nowrap"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Capital Deployed</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('totalCharges')}
                    className="py-3 px-3 text-right font-bold text-[var(--text-secondary)] uppercase tracking-wider text-[10px] cursor-pointer hover:text-emerald-500 select-none whitespace-nowrap"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Total Charges</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('grossPnl')}
                    className="py-3 px-3 text-right font-bold text-[var(--text-secondary)] uppercase tracking-wider text-[10px] cursor-pointer hover:text-emerald-500 select-none whitespace-nowrap"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Gross P&L</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('netPnl')}
                    className="py-3 px-4 text-right font-bold text-[var(--text-secondary)] uppercase tracking-wider text-[10px] cursor-pointer hover:text-emerald-500 select-none whitespace-nowrap"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Net Realized P&L</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('roiPct')}
                    className="py-3 px-3 text-right font-bold text-[var(--text-secondary)] uppercase tracking-wider text-[10px] cursor-pointer hover:text-emerald-500 select-none whitespace-nowrap"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>ROI %</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('winRatePct')}
                    className="py-3 px-3 text-right font-bold text-[var(--text-secondary)] uppercase tracking-wider text-[10px] cursor-pointer hover:text-emerald-500 select-none whitespace-nowrap"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Win Rate</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                  <th className="py-3 px-3 font-bold text-[var(--text-secondary)] uppercase tracking-wider text-[10px]">
                    Analysis Badges
                  </th>
                  <th
                    onClick={() => handleSort('latestDate')}
                    className="py-3 px-3 text-right font-bold text-[var(--text-secondary)] uppercase tracking-wider text-[10px] cursor-pointer hover:text-emerald-500 select-none whitespace-nowrap"
                  >
                    <div className="flex items-center justify-end gap-1">
                      <span>Latest Date</span>
                      <ArrowUpDown className="w-3 h-3 opacity-60" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-color)]">
                {paginatedSymbols.map((sym) => {
                  const isWin = sym.netPnl >= 0;

                  return (
                    <tr
                      key={sym.symbol}
                      onClick={() => setSelectedSymbolForModal(sym)}
                      className="hover:bg-emerald-500/[0.04] transition-colors cursor-pointer group font-mono"
                    >
                      {/* Ticker & Stock Name with Sector and Cap */}
                      <td className="py-2.5 px-4 font-sans whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 flex items-center justify-center bg-transparent">
                            <HoldingLogo
                              symbol={sym.symbol}
                              name={sym.name}
                              className="w-full h-full object-contain"
                              categoryId={sym.market === 'US' ? 'us_stocks' : 'in_stocks'}
                            />
                          </div>
                          <div>
                            <div className="font-bold text-sm text-[var(--text-primary)] group-hover:text-emerald-500 dark:group-hover:text-emerald-300 transition-colors flex items-center gap-1.5">
                              <span>{sym.symbol}</span>
                              {sym.inPortfolio && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="Held in portfolio" />
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)] font-medium font-sans">
                              {sym.name || sym.symbol}
                            </div>
                            {(sym.sector || sym.market_cap) && (
                              <div className="text-[9.5px] text-[var(--text-muted)] font-mono flex items-center gap-1.5 mt-0.5">
                                {sym.sector && sym.sector !== 'Unknown' && <span>{sym.sector}</span>}
                                {sym.sector && sym.market_cap && <span>•</span>}
                                {sym.market_cap && sym.market_cap !== 'Unknown' && <span className="text-blue-500 dark:text-blue-400 font-semibold">{sym.market_cap}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Trades Count & Term Breakdown */}
                      <td className="py-2.5 px-3 text-right">
                        <span className="font-bold text-[var(--text-primary)]">{sym.totalTrades}</span>
                        <span className="text-[9px] text-[var(--text-muted)] font-mono block">
                          {(sym.ltcgTradesCount > 0 || sym.stcgTradesCount > 0)
                            ? `${sym.ltcgTradesCount || 0} LTCG • ${sym.stcgTradesCount || 0} STCG`
                            : 'Trades'}
                        </span>
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

                      {/* Complete Analysis Badges */}
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

          {/* Pagination Navigation Footer */}
          <div className="p-3.5 border-t border-[var(--border-color)] bg-[var(--bg-card)]/40 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="text-[var(--text-secondary)] flex items-center gap-2">
              <span>Showing</span>
              <span className="font-bold font-mono text-[var(--text-primary)]">
                {totalRecords === 0 ? 0 : (safeCurrentPage - 1) * (pageSize === 'ALL' ? totalRecords : pageSize) + 1}
              </span>
              <span>to</span>
              <span className="font-bold font-mono text-[var(--text-primary)]">
                {pageSize === 'ALL' ? totalRecords : Math.min(safeCurrentPage * pageSize, totalRecords)}
              </span>
              <span>of</span>
              <span className="font-bold font-mono text-[var(--text-primary)]">{totalRecords}</span>
              <span>stocks</span>
            </div>

            <div className="flex items-center gap-3">
              {/* Rows per page selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-[var(--text-muted)] text-[11px]">Per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    const val = e.target.value === 'ALL' ? 'ALL' : Number(e.target.value);
                    setPageSize(val);
                    setCurrentPage(1);
                  }}
                  className="px-2 py-1 rounded-lg reports-subcard border border-[var(--border-color)] text-xs text-[var(--text-primary)] focus:outline-none cursor-pointer"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value="ALL">All ({totalRecords})</option>
                </select>
              </div>

              {/* Navigation buttons */}
              {pageSize !== 'ALL' && totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handlePageChange(1)}
                    disabled={safeCurrentPage === 1}
                    className="p-1.5 rounded-lg reports-subcard border border-[var(--border-color)] hover:border-emerald-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                    title="First page"
                  >
                    <ChevronsLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePageChange(safeCurrentPage - 1)}
                    disabled={safeCurrentPage === 1}
                    className="p-1.5 rounded-lg reports-subcard border border-[var(--border-color)] hover:border-emerald-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                    title="Previous page"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>

                  <span className="px-2.5 py-1 text-xs font-mono font-bold text-[var(--text-primary)]">
                    Page {safeCurrentPage} of {totalPages}
                  </span>

                  <button
                    type="button"
                    onClick={() => handlePageChange(safeCurrentPage + 1)}
                    disabled={safeCurrentPage === totalPages}
                    className="p-1.5 rounded-lg reports-subcard border border-[var(--border-color)] hover:border-emerald-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                    title="Next page"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePageChange(totalPages)}
                    disabled={safeCurrentPage === totalPages}
                    className="p-1.5 rounded-lg reports-subcard border border-[var(--border-color)] hover:border-emerald-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                    title="Last page"
                  >
                    <ChevronsRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Card Grid View (Paginated) */
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {paginatedSymbols.map((sym) => {
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
                      <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0 flex items-center justify-center bg-transparent">
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
                        <div className="text-[11px] text-[var(--text-secondary)] font-medium">
                          {sym.name || sym.symbol}
                        </div>
                        {(sym.sector || sym.market_cap) && (
                          <div className="text-[9.5px] text-[var(--text-muted)] font-mono flex items-center gap-1.5 mt-0.5">
                            {sym.sector && sym.sector !== 'Unknown' && <span>{sym.sector}</span>}
                            {sym.sector && sym.market_cap && <span>•</span>}
                            {sym.market_cap && sym.market_cap !== 'Unknown' && <span className="text-blue-500 dark:text-blue-400 font-semibold">{sym.market_cap}</span>}
                          </div>
                        )}
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
                      <div className="text-[8.5px] text-[var(--text-muted)] font-mono">
                        {(sym.ltcgTradesCount > 0 || sym.stcgTradesCount > 0)
                          ? `${sym.ltcgTradesCount || 0}L • ${sym.stcgTradesCount || 0}S`
                          : 'Trades'}
                      </div>
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

          {/* Card Grid Pagination Controls */}
          {pageSize !== 'ALL' && totalPages > 1 && (
            <div className="reports-card rounded-2xl border border-[var(--border-color)] p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-[var(--text-secondary)] font-mono">
                Page {safeCurrentPage} of {totalPages} ({totalRecords} total stocks)
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePageChange(safeCurrentPage - 1)}
                  disabled={safeCurrentPage === 1}
                  className="px-3 py-1.5 rounded-xl reports-subcard border border-[var(--border-color)] hover:border-emerald-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer font-bold"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => handlePageChange(safeCurrentPage + 1)}
                  disabled={safeCurrentPage === totalPages}
                  className="px-3 py-1.5 rounded-xl reports-subcard border border-[var(--border-color)] hover:border-emerald-500/40 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer font-bold"
                >
                  Next
                </button>
              </div>
            </div>
          )}
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

      {/* Symbol Trade Logs Drill-Down Modal */}
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
