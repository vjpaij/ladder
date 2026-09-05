import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ResponsiveContainer, 
  PieChart as RePieChart, 
  Pie, 
  Cell, 
  Tooltip, 
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart as ReBarChart,
  Bar
} from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { 
  PieChart, 
  BarChart3, 
  TrendingUp, 
  Layers, 
  Filter, 
  RefreshCw, 
  ChevronRight, 
  X, 
  Building2, 
  Coins, 
  Briefcase, 
  Sparkles, 
  Check, 
  ArrowUpRight, 
  ArrowDownRight,
  CalendarDays,
  Calendar,
  Layers3,
  Search,
  SlidersHorizontal,
  ChevronDown,
  Compass,
  ArrowLeft,
  ExternalLink,
  CandlestickChart,
  Globe,
  ShieldCheck,
  Landmark,
  DollarSign,
  Activity
} from 'lucide-react';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';

const PALETTE = [
  '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#06B6D4', 
  '#EC4899', '#6366F1', '#14B8A6', '#F97316', '#A855F7', 
  '#64748B', '#E11D48', '#0284C7', '#84CC16'
];

const CAP_COLORS = {
  'Mega Cap': '#10B981',     // Emerald
  'Large Cap': '#3B82F6',    // Blue
  'Mid Cap': '#F59E0B',      // Amber
  'Small Cap': '#8B5CF6',    // Purple
  'Micro Cap': '#EC4899',    // Pink / Rose
  'Cash': '#64748B',         // Slate
  'Unknown': '#94A3B8'
};

const BENCHMARK_COLORS = {
  'NIFTY_50': '#3B82F6',
  'NIFTY_MIDCAP_150': '#F59E0B',
  'NIFTY_SMALLCAP_250': '#8B5CF6',
  'SP_500': '#EC4899',
  'NASDAQ': '#06B6D4'
};

const BENCHMARK_LABELS = {
  'NIFTY_50': 'Nifty 50',
  'NIFTY_MIDCAP_150': 'Nifty Midcap 150',
  'NIFTY_SMALLCAP_250': 'Nifty Smallcap 250',
  'SP_500': 'S&P 500',
  'NASDAQ': 'NASDAQ'
};

/**
 * Standard Unified Sector Normalization
 */
function normalizeSector(raw) {
  if (!raw) return 'Diversified & Other';
  const s = raw.trim().toLowerCase();
  
  if (s.includes('tech') || s.includes('information') || s.includes('software') || s.includes('semiconductor') || s.includes('cloud') || s.includes('it ') || s === 'it') {
    return 'Information Technology';
  }
  if (s.includes('bank') || s.includes('finance') || s.includes('financial') || s.includes('insurance') || s.includes('capital market') || s.includes('amc') || s.includes('housing fin')) {
    return 'Financial Services';
  }
  if (s.includes('health') || s.includes('pharma') || s.includes('biotech') || s.includes('drug') || s.includes('hospital') || s.includes('diagnostic')) {
    return 'Healthcare & Pharmaceuticals';
  }
  if (s.includes('auto') || s.includes('vehicle') || s.includes('tyre') || s.includes('ancillar') || s.includes('motor')) {
    return 'Automobiles & Auto Components';
  }
  if (s.includes('fmcg') || s.includes('consumer good') || s.includes('food') || s.includes('beverage') || s.includes('tobacco') || s.includes('personal care') || s.includes('household') || s.includes('staple')) {
    return 'Consumer Staples & FMCG';
  }
  if (s.includes('consumer disc') || s.includes('retail') || s.includes('apparel') || s.includes('footwear') || s.includes('hotel') || s.includes('restaurant') || s.includes('travel') || s.includes('leisure') || s.includes('luxury')) {
    return 'Consumer Discretionary';
  }
  if (s.includes('industrial') || s.includes('capital good') || s.includes('engineering') || s.includes('machiner') || s.includes('defence') || s.includes('equipment') || s.includes('electrical')) {
    return 'Capital Goods & Industrials';
  }
  if (s.includes('infra') || s.includes('construction') || s.includes('cement') || s.includes('building') || s.includes('realty') || s.includes('real estate') || s.includes('road') || s.includes('port') || s.includes('transport')) {
    return 'Infrastructure & Real Estate';
  }
  if (s.includes('energy') || s.includes('oil') || s.includes('gas') || s.includes('petroleum') || s.includes('refin') || s.includes('power') || s.includes('renewable') || s.includes('solar') || s.includes('green energy') || s.includes('utilit')) {
    return 'Energy, Power & Utilities';
  }
  if (s.includes('metal') || s.includes('mining') || s.includes('steel') || s.includes('aluminum') || s.includes('copper') || s.includes('zinc') || s.includes('iron') || s.includes('commodity') || s.includes('commodities')) {
    return 'Metals & Mining';
  }
  if (s.includes('chemical') || s.includes('fertilizer') || s.includes('agrochem') || s.includes('specialty chem') || s.includes('material')) {
    return 'Chemicals & Materials';
  }
  if (s.includes('telecom') || s.includes('media') || s.includes('entertainment') || s.includes('broadcasting') || s.includes('communication')) {
    return 'Telecommunication & Media';
  }
  if (s.includes('cash') || s.includes('debt') || s.includes('treps') || s.includes('repo') || s.includes('reverse repo') || s.includes('debenture') || s.includes('commercial paper') || s.includes('money market') || s.includes('gilt') || s.includes('treasury')) {
    return 'Cash, Debt & Other';
  }
  return 'Diversified & Other';
}

export default function ReportsView({ summary, holdings }) {
  const { formatMoney, isUSD } = useThemeAuth();
  
  // Master Tab states: CONSOLIDATED, EQUITY, MF_COMPOSITION, FIXED_INCOME, NPS
  const [activeTab, setActiveTab] = useState('EQUITY');
  
  // View states within tabs: ALLOCATION, MARKET_CAP, SECTOR, TRAJECTORY
  const [reportType, setReportType] = useState('MARKET_CAP');
  
  // Chart visual type switcher: PIE vs BAR
  const [chartStyle, setChartStyle] = useState('PIE');
  
  // Equity Hub Sub-Filters (Indian Stock, US Stock, Mutual Funds)
  const [equityOptions, setEquityOptions] = useState({
    india: true,
    us: true,
    mf: true
  });

  // Market Cap Source Toggle: ALL, DIRECT, MF
  const [mcapSource, setMcapSource] = useState('ALL');

  // Interactive Sector Drill-down
  const [selectedSector, setSelectedSector] = useState(null);

  // Interactive Market Cap Drill-down
  const [selectedMarketCap, setSelectedMarketCap] = useState(null);

  // Mutual Fund Explorer: selected scheme code
  const [selectedMfScheme, setSelectedMfScheme] = useState('ALL');
  const [isMfDropdownOpen, setIsMfDropdownOpen] = useState(false);
  const mfDropdownRef = useRef(null);

  // Company Mutual Fund Breakdown Modal
  const [companyDetailTarget, setCompanyDetailTarget] = useState(null);

  // Benchmark Growth settings & Date Picker
  const [benchmark, setBenchmark] = useState('NIFTY_50');
  const [growthTimeframe, setGrowthTimeframe] = useState('1Y'); // 1M, 3M, 6M, 1Y, ALL, CUSTOM
  const [customStartDate, setCustomStartDate] = useState('2023-01-01');
  const [customEndDate, setCustomEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  const [growthData, setGrowthData] = useState(null);
  const [loadingGrowth, setLoadingGrowth] = useState(false);

  // Mutual Fund underlying company data from server
  const [mfData, setMfData] = useState(null);
  const [loadingMf, setLoadingMf] = useState(false);

  // Active hover/selection state for Pie
  const [activePieIndex, setActivePieIndex] = useState(null);

  // Close MF dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (mfDropdownRef.current && !mfDropdownRef.current.contains(e.target)) {
        setIsMfDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close company modal on ESC key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setCompanyDetailTarget(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Load MF underlying company data
  useEffect(() => {
    let isMounted = true;
    const fetchMfHoldings = async () => {
      setLoadingMf(true);
      try {
        const res = await fetch('/api/reports/mf-holdings');
        if (res.ok) {
          const data = await res.json();
          if (isMounted) setMfData(data);
        }
      } catch (err) {
        console.error('Failed fetching MF holdings:', err);
      } finally {
        if (isMounted) setLoadingMf(false);
      }
    };
    fetchMfHoldings();
    return () => { isMounted = false; };
  }, []);

  // Compute selected scope string for Growth vs Indices
  const activeScopeParam = useMemo(() => {
    if (activeTab === 'CONSOLIDATED') return 'all';
    if (activeTab === 'MF_COMPOSITION') return 'mutual_funds';
    if (activeTab === 'FIXED_INCOME') return 'bank,epf';
    if (activeTab === 'NPS') return 'nps';
    
    // In EQUITY tab: check selected equityOptions (india, us, mf)
    const parts = [];
    if (equityOptions.india) parts.push('indian_stocks');
    if (equityOptions.us) parts.push('us_stocks');
    if (equityOptions.mf) parts.push('mutual_funds');
    return parts.length > 0 ? parts.join(',') : 'indian_stocks';
  }, [activeTab, equityOptions.india, equityOptions.us, equityOptions.mf]);

  // Load Real-time Growth Benchmarks based on scope and date range
  useEffect(() => {
    let isMounted = true;
    const fetchGrowth = async () => {
      setLoadingGrowth(true);
      try {
        let url = `/api/reports/growth-benchmarks?timeframe=${growthTimeframe}&scope=${activeScopeParam}`;
        if (growthTimeframe === 'CUSTOM' && customStartDate && customEndDate) {
          url = `/api/reports/growth-benchmarks?timeframe=CUSTOM&startDate=${customStartDate}&endDate=${customEndDate}&scope=${activeScopeParam}`;
        }
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (isMounted) setGrowthData(data);
        }
      } catch (err) {
        console.error('Failed fetching growth benchmarks:', err);
      } finally {
        if (isMounted) setLoadingGrowth(false);
      }
    };
    fetchGrowth();
    return () => { isMounted = false; };
  }, [growthTimeframe, activeScopeParam, customStartDate, customEndDate]);

  if (!summary || !holdings) return null;

  // Filter Holdings based on Active Tab and Equity Options
  const filteredHoldings = useMemo(() => {
    return holdings.filter(h => {
      if (Number(h.quantity) <= 0) return false;
      const cat = h.category_id;
      
      if (activeTab === 'CONSOLIDATED') return true;
      if (activeTab === 'EQUITY') {
        if (cat === 'in_stocks' && equityOptions.india) return true;
        if (cat === 'us_stocks' && equityOptions.us) return true;
        if (cat === 'mutual_funds' && equityOptions.mf) return true;
        return false;
      }
      if (activeTab === 'MF_COMPOSITION') {
        return cat === 'mutual_funds';
      }
      if (activeTab === 'FIXED_INCOME') {
        return cat === 'bank' || cat === 'epf' || cat === 'loans';
      }
      if (activeTab === 'NPS') {
        return cat === 'nps';
      }
      return false;
    });
  }, [holdings, activeTab, equityOptions.india, equityOptions.us, equityOptions.mf]);

  // Asset Allocation Data with Top 10 + 'Other' Bucket
  const allocationData = useMemo(() => {
    if (activeTab === 'CONSOLIDATED') {
      const raw = summary.assetAllocation || [];
      const total = raw.reduce((sum, item) => sum + (item.value || 0), 0);
      return raw.map((item, idx) => ({
        name: item.name,
        value: Math.round(item.value),
        color: PALETTE[idx % PALETTE.length],
        percentage: total > 0 ? Number(((item.value / total) * 100).toFixed(2)) : 0
      }));
    }
    
    // Group by holding name
    const map = {};
    const symMap = {};
    filteredHoldings.forEach(h => {
      const name = h.name || h.symbol;
      if (!map[name]) map[name] = 0;
      map[name] += h.currentValueINR || 0;
      symMap[name] = h.symbol;
    });

    const sorted = Object.keys(map)
      .map(k => ({ 
        name: k, 
        symbol: symMap[k],
        value: Math.round(map[k]) 
      }))
      .sort((a, b) => b.value - a.value);

    const total = sorted.reduce((sum, item) => sum + item.value, 0);
    if (total === 0) return [];

    if (sorted.length <= 10) {
      return sorted.map((item, idx) => ({
        ...item,
        color: PALETTE[idx % PALETTE.length],
        percentage: Number(((item.value / total) * 100).toFixed(2))
      }));
    }

    const top10 = sorted.slice(0, 10).map((item, idx) => ({
      ...item,
      color: PALETTE[idx % PALETTE.length],
      percentage: Number(((item.value / total) * 100).toFixed(2))
    }));

    const otherItems = sorted.slice(10);
    const otherVal = otherItems.reduce((sum, item) => sum + item.value, 0);
    const otherPct = Number(((otherVal / total) * 100).toFixed(2));

    return [
      ...top10,
      {
        name: `Other (${otherItems.length} assets)`,
        symbol: 'OTHER',
        value: otherVal,
        percentage: otherPct,
        color: '#64748B',
        isOther: true
      }
    ];
  }, [summary.assetAllocation, filteredHoldings, activeTab]);

  // Sector Data with Full Look-Through & Aggregated Unique Companies
  const sectorData = useMemo(() => {
    const map = {};
    const companyMap = {};

    filteredHoldings.forEach(h => {
      if (h.category_id === 'mutual_funds') {
        const mfScheme = mfData?.schemes?.find(s => s.scheme_code === h.symbol);
        if (mfScheme && mfScheme.companies && mfScheme.companies.length > 0) {
          mfScheme.companies.forEach(c => {
            const sec = normalizeSector(c.sector);
            if (!map[sec]) map[sec] = 0;
            if (!companyMap[sec]) companyMap[sec] = {};
            
            map[sec] += c.allocatedINR || 0;
            const compKey = (c.company || c.name || '').trim();
            if (!companyMap[sec][compKey]) {
              companyMap[sec][compKey] = {
                name: compKey,
                symbol: c.symbol,
                sources: [`MF: ${mfScheme.scheme_name}`],
                allocatedINR: 0,
                mcap_category: c.mcap_category || 'Mid Cap'
              };
            } else {
              companyMap[sec][compKey].sources.push(`MF: ${mfScheme.scheme_name}`);
            }
            companyMap[sec][compKey].allocatedINR += c.allocatedINR || 0;
          });
        } else {
          const sec = 'Cash, Debt & Other';
          if (!map[sec]) map[sec] = 0;
          if (!companyMap[sec]) companyMap[sec] = {};
          map[sec] += h.currentValueINR || 0;
          const compKey = (h.name || h.symbol).trim();
          if (!companyMap[sec][compKey]) {
            companyMap[sec][compKey] = {
              name: compKey,
              symbol: h.symbol,
              sources: ['Mutual Fund'],
              allocatedINR: 0,
              mcap_category: 'Diversified'
            };
          }
          companyMap[sec][compKey].allocatedINR += h.currentValueINR || 0;
        }
      } else {
        // Direct Stock / Bank / etc
        const sec = normalizeSector(h.sector);
        if (!map[sec]) map[sec] = 0;
        if (!companyMap[sec]) companyMap[sec] = {};
        map[sec] += h.currentValueINR || 0;
        const compKey = (h.name || h.symbol).trim();
        if (!companyMap[sec][compKey]) {
          companyMap[sec][compKey] = {
            name: compKey,
            symbol: h.symbol,
            sources: [h.category_name || 'Direct Equity'],
            allocatedINR: 0,
            mcap_category: h.market_cap || 'Small Cap'
          };
        } else {
          companyMap[sec][compKey].sources.push(h.category_name || 'Direct Equity');
        }
        companyMap[sec][compKey].allocatedINR += h.currentValueINR || 0;
      }
    });

    const total = Object.values(map).reduce((sum, v) => sum + v, 0);

    return Object.keys(map).map((s, idx) => {
      const compDict = companyMap[s] || {};
      const compList = Object.values(compDict).map(c => ({
        ...c,
        source: c.sources.length === 1 
          ? c.sources[0] 
          : `${c.sources.length} Sources (${c.sources.some(src => src.includes('Direct')) ? 'Direct + MF' : 'Multi-MF'})`
      })).sort((a, b) => b.allocatedINR - a.allocatedINR);

      return {
        name: s,
        sector: s,
        color: PALETTE[idx % PALETTE.length],
        value: Math.round(map[s]),
        percentage: total > 0 ? Number(((map[s] / total) * 100).toFixed(2)) : 0,
        companies: compList
      };
    }).sort((a, b) => b.value - a.value);
  }, [filteredHoldings, mfData]);

  // Market Cap Data: Mega, Large, Mid, Small, Micro, Cash with Aggregated Unique Companies
  const marketCapData = useMemo(() => {
    const buckets = {
      'Mega Cap': 0,
      'Large Cap': 0,
      'Mid Cap': 0,
      'Small Cap': 0,
      'Micro Cap': 0,
      'Cash': 0
    };

    const constituentDict = {
      'Mega Cap': {},
      'Large Cap': {},
      'Mid Cap': {},
      'Small Cap': {},
      'Micro Cap': {},
      'Cash': {}
    };

    filteredHoldings.forEach(h => {
      const isMf = h.category_id === 'mutual_funds';
      
      if (isMf) {
        if (mcapSource === 'DIRECT') return;
        const mfScheme = mfData?.schemes?.find(s => s.scheme_code === h.symbol);
        if (mfScheme && mfScheme.companies && mfScheme.companies.length > 0) {
          mfScheme.companies.forEach(c => {
            const capTier = c.mcap_category || 'Mid Cap';
            const targetTier = buckets[capTier] !== undefined ? capTier : 'Mid Cap';
            buckets[targetTier] += c.allocatedINR || 0;
            
            const compKey = (c.company || c.name || '').trim();
            if (!constituentDict[targetTier][compKey]) {
              constituentDict[targetTier][compKey] = {
                name: compKey,
                symbol: c.symbol,
                sources: [`MF: ${mfScheme.scheme_name}`],
                allocatedINR: 0,
                mcapCr: null
              };
            } else {
              constituentDict[targetTier][compKey].sources.push(`MF: ${mfScheme.scheme_name}`);
            }
            constituentDict[targetTier][compKey].allocatedINR += c.allocatedINR || 0;
          });
        } else {
          buckets['Mid Cap'] += h.currentValueINR || 0;
          const compKey = (h.name || h.symbol).trim();
          if (!constituentDict['Mid Cap'][compKey]) {
            constituentDict['Mid Cap'][compKey] = {
              name: compKey,
              symbol: h.symbol,
              sources: ['Mutual Fund'],
              allocatedINR: 0,
              mcapCr: null
            };
          }
          constituentDict['Mid Cap'][compKey].allocatedINR += h.currentValueINR || 0;
        }
      } else {
        if (mcapSource === 'MF') return;
        let mc = h.market_cap || 'Small Cap';
        if (buckets[mc] === undefined) mc = 'Small Cap';
        buckets[mc] += h.currentValueINR || 0;

        const compKey = (h.name || h.symbol).trim();
        if (!constituentDict[mc][compKey]) {
          constituentDict[mc][compKey] = {
            name: compKey,
            symbol: h.symbol,
            sources: [h.category_name || 'Direct Equity'],
            allocatedINR: 0,
            mcapCr: h.market_cap_cr
          };
        } else {
          constituentDict[mc][compKey].sources.push(h.category_name || 'Direct Equity');
        }
        constituentDict[mc][compKey].allocatedINR += h.currentValueINR || 0;
      }
    });

    const total = Object.values(buckets).reduce((sum, v) => sum + v, 0);

    return Object.keys(buckets)
      .filter(k => buckets[k] > 0)
      .map(k => {
        const compList = Object.values(constituentDict[k]).map(c => ({
          ...c,
          source: c.sources.length === 1 
            ? c.sources[0] 
            : `${c.sources.length} Sources (${c.sources.some(src => src.includes('Direct')) ? 'Direct + MF' : 'Multi-MF'})`
        })).sort((a, b) => b.allocatedINR - a.allocatedINR);

        return {
          name: k,
          capTier: k,
          color: CAP_COLORS[k] || '#3B82F6',
          value: Math.round(buckets[k]),
          percentage: total > 0 ? Number(((buckets[k] / total) * 100).toFixed(2)) : 0,
          companies: compList
        };
      });
  }, [filteredHoldings, mfData, mcapSource]);

  // Consolidated / Lifetime Asset Performance Matrix
  const consolidatedPerformanceData = useMemo(() => {
    if (!summary || !holdings) return { categories: [], totals: {} };

    const allCatDefs = [
      { id: 'in_stocks', label: 'Indian Equity', color: '#10B981', gradient: 'from-emerald-500 to-teal-600', icon: CandlestickChart, type: 'equity' },
      { id: 'us_stocks', label: 'US Equity', color: '#A855F7', gradient: 'from-purple-500 to-indigo-600', icon: Globe, type: 'equity' },
      { id: 'mutual_funds', label: 'Mutual Funds', color: '#F59E0B', gradient: 'from-amber-500 to-orange-600', icon: Layers, type: 'equity' },
      { id: 'nps', label: 'National Pension System', color: '#06B6D4', gradient: 'from-cyan-500 to-blue-600', icon: ShieldCheck, type: 'nps' },
      { id: 'bank', label: 'Bank Accounts', color: '#3B82F6', gradient: 'from-blue-500 to-sky-600', icon: Landmark, type: 'fixed' },
      { id: 'epf', label: 'Employee Provident Fund', color: '#6366F1', gradient: 'from-indigo-500 to-purple-600', icon: Building2, type: 'fixed' }
    ];

    // Filter categories based on activeTab
    const catDefs = allCatDefs.filter(cat => {
      if (activeTab === 'CONSOLIDATED') return true;
      if (activeTab === 'EQUITY') {
        if (cat.id === 'in_stocks') return equityOptions.india;
        if (cat.id === 'us_stocks') return equityOptions.us;
        if (cat.id === 'mutual_funds') return equityOptions.mf;
        return false;
      }
      if (activeTab === 'FIXED_INCOME') return cat.type === 'fixed';
      if (activeTab === 'NPS') return cat.type === 'nps';
      return true;
    });

    let grandActiveVal = 0;
    let grandActiveCost = 0;
    let grandRealizedProceeds = 0;
    let grandRealizedCost = 0;
    let grandRealizedPnl = 0;
    let grandLifetimeCost = 0;
    let grandLifetimePnl = 0;

    const categories = catDefs.map(cat => {
      const metrics = summary.categoryMetrics?.find(c => c.id === cat.id);
      const catHoldings = holdings.filter(h => h.category_id === cat.id);
      
      const activeHoldings = catHoldings.filter(h => (Number(h.quantity) || 0) > 0);
      const closedHoldings = catHoldings.filter(h => (Number(h.quantity) || 0) === 0);

      const activeVal = activeHoldings.reduce((sum, h) => sum + (h.currentValueINR || 0), 0);
      const activeCost = activeHoldings.reduce((sum, h) => sum + (h.investedValueINR || 0), 0);
      const activePnl = activeVal - activeCost;
      const activeRoiPct = activeCost > 0 ? (activePnl / activeCost) * 100 : 0;
      const activeXirr = metrics?.activeXirrPct || 0;

      let closedCost = 0;
      let closedProceeds = 0;
      let closedPnl = 0;

      closedHoldings.forEach(h => {
        const soldQty = Number(h.sell_qty) || Number(h.buy_qty) || 0;
        const avgBuy = Number(h.avg_buy_price) || 0;
        const realizedPnl = Number(h.realized_pnl) || 0;
        const txRate = h.txFxRate || 1;
        const investedVal = soldQty > 0 ? (soldQty * avgBuy * txRate) : (Number(h.investedValueINR) || 0);
        const redeemedVal = investedVal + realizedPnl;
        closedCost += investedVal;
        closedProceeds += redeemedVal;
        closedPnl += realizedPnl;
      });

      const closedRoiPct = closedCost > 0 ? (closedPnl / closedCost) * 100 : 0;
      const closedXirr = metrics?.closedXirrPct || 0;

      const lifetimeCost = activeCost + closedCost;
      const lifetimePnl = (metrics ? (metrics.realizedINR + metrics.unrealizedINR) : (activePnl + closedPnl));
      const lifetimeRoiPct = lifetimeCost > 0 ? (lifetimePnl / lifetimeCost) * 100 : 0;
      const lifetimeXirr = metrics?.xirrPct || 0;

      grandActiveVal += activeVal;
      grandActiveCost += activeCost;
      grandRealizedProceeds += closedProceeds;
      grandRealizedCost += closedCost;
      grandRealizedPnl += closedPnl;
      grandLifetimeCost += lifetimeCost;
      grandLifetimePnl += lifetimePnl;

      return {
        ...cat,
        activeCount: activeHoldings.length,
        closedCount: closedHoldings.length,
        totalCount: catHoldings.length,
        activeVal,
        activeCost,
        activePnl,
        activeRoiPct,
        activeXirr,
        closedProceeds,
        closedCost,
        closedPnl,
        closedRoiPct,
        closedXirr,
        lifetimeCost,
        lifetimePnl,
        lifetimeRoiPct,
        lifetimeXirr,
        weightPct: metrics?.weightPct || (summary.totalAssets > 0 ? (activeVal / summary.totalAssets) * 100 : 0)
      };
    });

    const grandActivePnl = grandActiveVal - grandActiveCost;
    const grandActiveRoiPct = grandActiveCost > 0 ? (grandActivePnl / grandActiveCost) * 100 : 0;
    const grandLifetimeRoiPct = grandLifetimeCost > 0 ? (grandLifetimePnl / grandLifetimeCost) * 100 : 0;

    return {
      categories,
      totals: {
        activeVal: grandActiveVal,
        activeCost: grandActiveCost,
        activePnl: grandActivePnl,
        activeRoiPct: grandActiveRoiPct,
        closedProceeds: grandRealizedProceeds,
        closedCost: grandRealizedCost,
        closedPnl: grandRealizedPnl,
        lifetimeCost: grandLifetimeCost,
        lifetimePnl: grandLifetimePnl,
        lifetimeRoiPct: grandLifetimeRoiPct,
        portfolioXirr: summary.xirrPct || 0
      }
    };
  }, [summary, holdings, activeTab, equityOptions]);

  // Selected MF Scheme detail data
  const selectedMfDetails = useMemo(() => {
    if (!mfData?.schemes) return null;
    if (selectedMfScheme === 'ALL') {
      return {
        scheme_name: 'Consolidated Mutual Funds Portfolio',
        currentValueINR: mfData.totalMfValueINR,
        companies: mfData.aggregatedCompanies || []
      };
    }
    return mfData.schemes.find(s => s.scheme_code === selectedMfScheme) || null;
  }, [mfData, selectedMfScheme]);

  // Mutual Fund Breakdown Finder for a clicked Company
  const companyMfBreakdown = useMemo(() => {
    if (!companyDetailTarget || !mfData?.schemes) return null;
    const targetName = (companyDetailTarget.name || companyDetailTarget.company || '').trim().toLowerCase();
    const targetSym = (companyDetailTarget.symbol || '').trim().toLowerCase();

    const schemeMatches = [];
    let totalMfAllocated = 0;

    mfData.schemes.forEach(scheme => {
      const match = scheme.companies?.find(c => {
        const cName = (c.company || c.name || '').trim().toLowerCase();
        const cSym = (c.symbol || '').trim().toLowerCase();
        return (targetSym && cSym && targetSym === cSym) || (cName && (cName === targetName || cName.includes(targetName) || targetName.includes(cName)));
      });

      if (match) {
        const alloc = match.allocatedINR || 0;
        totalMfAllocated += alloc;
        schemeMatches.push({
          scheme_code: scheme.scheme_code,
          scheme_name: scheme.scheme_name,
          fund_weight_pct: match.allocation_pct || match.percentage || 0,
          allocatedINR: alloc,
          scheme_total_val: scheme.currentValueINR
        });
      }
    });

    // Check direct equity holding if any (strictly require open direct equity with quantity > 0)
    const directHolding = holdings.find(h => {
      const isDirectEquity = (h.category_id === 'in_stocks' || h.category_id === 'us_stocks') && Number(h.quantity) > 0;
      if (!isDirectEquity) return false;
      const hName = (h.name || '').trim().toLowerCase();
      const hSym = (h.symbol || '').replace(/\.(NS|BO)$/i, '').trim().toLowerCase();
      const cleanTargetSym = targetSym.replace(/\.(NS|BO)$/i, '');
      return (cleanTargetSym && hSym && hSym === cleanTargetSym) ||
             (hName && targetName && hName === targetName);
    });

    const directVal = (directHolding && Number(directHolding.quantity) > 0) ? (Number(directHolding.currentValueINR) || 0) : 0;
    const totalGrandVal = totalMfAllocated + directVal;

    // Calculate share of total for each scheme
    const enrichedSchemes = schemeMatches.map(s => ({
      ...s,
      shareOfStockPct: totalGrandVal > 0 ? Number(((s.allocatedINR / totalGrandVal) * 100).toFixed(2)) : 0
    })).sort((a, b) => b.allocatedINR - a.allocatedINR);

    return {
      name: companyDetailTarget.name || companyDetailTarget.company,
      symbol: companyDetailTarget.symbol || directHolding?.symbol || '',
      sector: normalizeSector(companyDetailTarget.sector || directHolding?.sector),
      capTier: companyDetailTarget.mcap_category || directHolding?.market_cap || 'Large Cap',
      totalMfAllocated,
      directVal,
      directHolding,
      totalGrandVal: totalGrandVal > 0 ? totalGrandVal : (companyDetailTarget.allocatedINR || 0),
      schemes: enrichedSchemes
    };
  }, [companyDetailTarget, mfData, holdings]);

  // Universal Custom Tooltip with Theme Adaptive Styling
  const CustomChartTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      const name = data.payload?.name || data.payload?.sector || (data.name !== 'value' ? data.name : '') || 'Asset';
      const value = data.value !== undefined ? data.value : data.payload?.value;
      const percentage = data.payload?.percentage;
      const color = data.color || data.payload?.fill || PALETTE[0];

      return (
        <div className="reports-card p-3 rounded-2xl shadow-xl text-xs space-y-1.5 z-50 pointer-events-none min-w-[180px]">
          <p className="font-extrabold flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }}></span>
            <span className="truncate">{name}</span>
          </p>
          <div className="pt-1 text-[11px] font-mono space-y-1 border-t border-inherit opacity-90">
            <p className="flex justify-between gap-4">
              <span className="opacity-70">Value:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(value)}</span>
            </p>
            {percentage !== undefined && (
              <p className="flex justify-between gap-4">
                <span className="opacity-70">Allocation:</span>
                <span className="font-bold">{Number(percentage).toFixed(2)}%</span>
              </p>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  // Trajectory Benchmark Tooltip
  const TrajectoryTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const point = payload[0].payload;
      const portVal = point.Portfolio;
      const portGrowth = point.PortfolioGrowthPct;
      const benchVal = point[`${benchmark}_Normalized`];
      const benchGrowth = point[`${benchmark}_GrowthPct`];
      const alpha = (portGrowth !== undefined && benchGrowth !== undefined) ? Number((portGrowth - benchGrowth).toFixed(2)) : 0;

      return (
        <div className="reports-card p-3.5 rounded-2xl shadow-xl text-xs space-y-2 z-50 pointer-events-none min-w-[220px]">
          <p className="font-mono font-bold opacity-75 text-[11px] border-b border-inherit pb-1 flex items-center justify-between">
            <span>{label}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${alpha >= 0 ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/20 text-rose-600 dark:text-rose-400'}`}>
              Alpha: {alpha >= 0 ? `+${alpha}%` : `${alpha}%`}
            </span>
          </p>
          <div className="space-y-1 font-mono text-[11px]">
            <div className="flex justify-between gap-4">
              <span className="flex items-center gap-1.5 opacity-80">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                Portfolio:
              </span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {formatMoney(portVal)} ({portGrowth >= 0 ? `+${portGrowth}%` : `${portGrowth}%`})
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="flex items-center gap-1.5 opacity-80">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BENCHMARK_COLORS[benchmark] }}></span>
                {BENCHMARK_LABELS[benchmark]}:
              </span>
              <span className="font-bold" style={{ color: BENCHMARK_COLORS[benchmark] }}>
                {benchVal !== undefined ? `${formatMoney(benchVal)} ` : ''}({benchGrowth >= 0 ? `+${benchGrowth}%` : `${benchGrowth}%`})
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  // Modern Ranked List Component (100% Theme-Adaptive)
  const RankedBarList = ({ items, onItemClick, activeIndex, onHoverIndex }) => {
    return (
      <div className="space-y-2 pt-1">
        {items.map((item, index) => {
          const isSelected = activeIndex === index;
          const color = item.color || PALETTE[index % PALETTE.length];
          return (
            <div
              key={item.name}
              onClick={() => {
                if (onItemClick) onItemClick(item);
                if (onHoverIndex) onHoverIndex(isSelected ? null : index);
              }}
              className={`group relative overflow-hidden p-3 rounded-2xl border transition-all duration-150 cursor-pointer reports-subcard ${
                isSelected ? 'ring-2 ring-emerald-500' : ''
              }`}
            >
              {/* Subtle Progress Fill Bar */}
              <div 
                className="absolute inset-y-0 left-0 opacity-15 group-hover:opacity-25 transition-all duration-300 rounded-2xl pointer-events-none"
                style={{ 
                  width: `${Math.max(2, item.percentage)}%`, 
                  backgroundColor: color 
                }}
              />

              <div className="relative flex items-center justify-between gap-3 min-w-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: color }} />
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold truncate">
                      {item.name}
                    </p>
                    {item.symbol && item.symbol !== 'OTHER' && (
                      <p className="text-[10px] opacity-60 font-mono font-semibold truncate">{item.symbol}</p>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0 font-mono">
                  <p className="text-xs font-black group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                    {formatMoney(item.value)}
                  </p>
                  <p className="text-[10px] font-extrabold text-emerald-600 dark:text-emerald-400">{item.percentage}%</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Crisp Institutional Bar Chart View with Clear X-Axis Values
  const CleanBarChartView = ({ items, onItemClick }) => {
    return (
      <div className="h-[380px] w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <ReBarChart data={items} margin={{ top: 10, right: 15, left: 10, bottom: 45 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#94A3B833" vertical={false} />
            <XAxis 
              dataKey="name" 
              stroke="#64748B" 
              tick={{ fill: 'currentColor', fontSize: 10, fontWeight: 700 }}
              tickFormatter={(str) => {
                if (!str) return '';
                return str.length > 15 ? `${str.substring(0, 13)}...` : str;
              }}
              interval={0}
              angle={-20}
              textAnchor="end"
              height={55}
            />
            <YAxis 
              stroke="#64748B" 
              tick={{ fill: '#94A3B8', fontSize: 10, fontWeight: 600 }} 
              tickFormatter={(v) => `₹${(v/100000).toFixed(1)}L`} 
            />
            <Tooltip content={<CustomChartTooltip />} />
            <Bar 
              dataKey="value" 
              radius={[8, 8, 0, 0]}
              isAnimationActive={false}
              onClick={(entry) => onItemClick && onItemClick(entry)}
            >
              {items.map((entry, index) => (
                <Cell 
                  key={`bar-cell-${index}`} 
                  fill={entry.color || PALETTE[index % PALETTE.length]} 
                  style={{ cursor: 'pointer' }}
                />
              ))}
            </Bar>
          </ReBarChart>
        </ResponsiveContainer>
      </div>
    );
  };

  return (
    <AnimatedPage className="space-y-4">
      
      {/* ─── Top Header Bar ─────────────────────────────────────────── */}
      <AnimatedItem>
        <div className="reports-card p-4 sm:p-5 rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-600 dark:text-emerald-400">
              <PieChart className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black flex items-center gap-2">
                Reports
              </h2>
            </div>
          </div>

          {/* Master Navigation Tabs */}
          <div className="flex items-center gap-1 reports-pill p-1 rounded-2xl shrink-0">
            {[
              { key: 'CONSOLIDATED', label: 'Consolidated' },
              { key: 'EQUITY', label: 'Equity Hub' },
              { key: 'MF_COMPOSITION', label: 'MF Composition' },
              { key: 'FIXED_INCOME', label: 'Fixed Income' },
              { key: 'NPS', label: 'NPS' }
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  setSelectedSector(null);
                  setSelectedMarketCap(null);
                  if (tab.key === 'EQUITY') {
                    setReportType('MARKET_CAP');
                  } else if (tab.key === 'CONSOLIDATED') {
                    setReportType('PERFORMANCE');
                  } else {
                    setReportType('ALLOCATION');
                  }
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  activeTab === tab.key 
                    ? 'bg-emerald-500 text-slate-950 shadow-md' 
                    : 'opacity-70 hover:opacity-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </AnimatedItem>

      {/* ─── Sub-Header Controls & Scope Filters ─────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        {/* Equity Scope Checkboxes (Indian Stock, US Stock, Mutual Funds) */}
        {activeTab === 'EQUITY' ? (
          <div className="flex items-center gap-4 text-xs font-extrabold reports-pill px-4 py-2 rounded-2xl shadow-sm">
            <span className="opacity-60 font-black text-[11px] uppercase tracking-wider">Scope:</span>
            <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-emerald-600 dark:hover:text-emerald-400">
              <input
                type="checkbox"
                checked={equityOptions.india}
                onChange={(e) => setEquityOptions(prev => ({ ...prev, india: e.target.checked }))}
                className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
              />
              <span>Indian Stock</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400">
              <input
                type="checkbox"
                checked={equityOptions.us}
                onChange={(e) => setEquityOptions(prev => ({ ...prev, us: e.target.checked }))}
                className="w-4 h-4 rounded accent-blue-500 cursor-pointer"
              />
              <span>US Stock</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-purple-600 dark:hover:text-purple-400">
              <input
                type="checkbox"
                checked={equityOptions.mf}
                onChange={(e) => setEquityOptions(prev => ({ ...prev, mf: e.target.checked }))}
                className="w-4 h-4 rounded accent-purple-500 cursor-pointer"
              />
              <span>Mutual Funds</span>
            </label>
          </div>
        ) : <div />}

        {/* Global Chart Style Switcher (Shown ONLY for Allocation, Market Cap, and Sector) */}
        {['ALLOCATION', 'MARKET_CAP', 'SECTOR'].includes(reportType) && activeTab !== 'MF_COMPOSITION' && !selectedSector && !selectedMarketCap ? (
          <div className="flex items-center gap-1 reports-pill p-1 rounded-2xl shadow-sm">
            <button
              onClick={() => setChartStyle('PIE')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                chartStyle === 'PIE' 
                  ? 'bg-emerald-500 text-slate-950 shadow-sm' 
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              <PieChart className="w-3.5 h-3.5" />
              <span>Donut</span>
            </button>
            <button
              onClick={() => setChartStyle('BAR')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                chartStyle === 'BAR' 
                  ? 'bg-emerald-500 text-slate-950 shadow-sm' 
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Bar Chart</span>
            </button>
          </div>
        ) : <div />}
      </div>

      {/* ─── Main Content Container ─────────────────────────────────── */}
      <div className="reports-card rounded-3xl p-5 md:p-6 shadow-sm space-y-6">
        
        {/* Navigation Tabs Bar (Hidden in dedicated MF_COMPOSITION tab) */}
        {activeTab !== 'MF_COMPOSITION' && (
          <div className="flex items-center gap-2 border-b border-inherit opacity-95 pb-3 overflow-x-auto">
            {[
              { key: 'PERFORMANCE', label: 'Consolidated Performance' },
              { key: 'ALLOCATION', label: 'Allocation' },
              ...(activeTab === 'EQUITY' ? [
                { key: 'MARKET_CAP', label: 'Market Cap' },
                { key: 'SECTOR', label: 'Sectors' }
              ] : []),
              { key: 'TRAJECTORY', label: 'Benchmark' }
            ].map(view => (
              <button
                key={view.key}
                onClick={() => {
                  setReportType(view.key);
                  setSelectedSector(null);
                  setSelectedMarketCap(null);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all shrink-0 cursor-pointer ${
                  reportType === view.key
                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 shadow-sm'
                    : 'opacity-70 hover:opacity-100 hover:bg-slate-500/10'
                }`}
              >
                {view.label}
              </button>
            ))}
          </div>
        )}

        {/* ─── DEDICATED MASTER TAB: MUTUAL FUND COMPOSITION ────────── */}
        {activeTab === 'MF_COMPOSITION' && (
          <div className="space-y-4">
            {/* Custom Scheme Selector Dropdown */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-inherit opacity-95 pb-3">
              <div className="relative" ref={mfDropdownRef}>
                <button
                  onClick={() => setIsMfDropdownOpen(!isMfDropdownOpen)}
                  className="flex items-center justify-between gap-3 min-w-[280px] sm:min-w-[340px] px-4 py-2.5 reports-subcard rounded-2xl shadow-sm hover:border-emerald-500 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Compass className="w-4 h-4 text-emerald-500 shrink-0" />
                    <span className="text-xs font-black truncate">
                      {selectedMfDetails?.scheme_name || 'Select Scheme'}
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 opacity-60 transition-transform duration-200 ${isMfDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {isMfDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      className="absolute left-0 top-12 z-50 w-full max-h-[320px] overflow-y-auto p-2 reports-card rounded-2xl shadow-2xl space-y-1"
                    >
                      <button
                        onClick={() => {
                          setSelectedMfScheme('ALL');
                          setIsMfDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left rounded-xl text-xs font-black flex items-center justify-between transition-colors cursor-pointer ${
                          selectedMfScheme === 'ALL'
                            ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                            : 'opacity-80 hover:opacity-100 hover:bg-slate-500/10'
                        }`}
                      >
                        <span>Consolidated Mutual Funds</span>
                        <span className="font-mono text-[11px] opacity-70">{formatMoney(mfData?.totalMfValueINR || 0)}</span>
                      </button>

                      {mfData?.schemes?.map(s => (
                        <button
                          key={s.scheme_code}
                          onClick={() => {
                            setSelectedMfScheme(s.scheme_code);
                            setIsMfDropdownOpen(false);
                          }}
                          className={`w-full px-3 py-2 text-left rounded-xl text-xs font-black flex items-center justify-between transition-colors cursor-pointer ${
                            selectedMfScheme === s.scheme_code
                              ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                              : 'opacity-80 hover:opacity-100 hover:bg-slate-500/10'
                          }`}
                        >
                          <span className="truncate pr-2">{s.scheme_name}</span>
                          <span className="font-mono text-[11px] opacity-70 shrink-0">{formatMoney(s.currentValueINR)}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {selectedMfDetails && (
                <div className="font-mono text-sm text-emerald-600 dark:text-emerald-400 font-black">
                  {formatMoney(selectedMfDetails.currentValueINR)}
                </div>
              )}
            </div>

            {selectedMfDetails && selectedMfDetails.companies?.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl reports-table-container">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="reports-table-head font-bold uppercase text-[10px]">
                      <th className="py-3 pl-4">Company</th>
                      <th className="py-3">Sector</th>
                      <th className="py-3">Cap Tier</th>
                      <th className="py-3 text-right">Fund Weight</th>
                      <th className="py-3 text-right pr-4">Allocated Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-inherit font-mono">
                    {selectedMfDetails.companies.map((c, i) => (
                      <tr 
                        key={`${c.company || c.name}-${i}`} 
                        onClick={() => setCompanyDetailTarget(c)}
                        className="reports-table-row transition-colors cursor-pointer group"
                      >
                        <td className="py-3 pl-4">
                          <div className="font-sans font-bold group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                            <span>{c.company || c.name}</span>
                            <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                          </div>
                          {c.symbol && c.symbol !== 'OTHER' && (
                            <div className="text-[10px] opacity-60 font-mono">{c.symbol}</div>
                          )}
                        </td>
                        <td className="py-3 opacity-80 font-sans font-medium">{normalizeSector(c.sector)}</td>
                        <td className="py-3">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full reports-subcard">
                            {c.mcap_category || 'Mid Cap'}
                          </span>
                        </td>
                        <td className="py-3 text-right opacity-80 font-bold">
                          {c.allocation_pct ? `${c.allocation_pct}%` : `${c.percentage}%`}
                        </td>
                        <td className="py-3 text-right pr-4 text-emerald-600 dark:text-emerald-400 font-bold">
                          {formatMoney(c.allocatedINR || c.totalAllocatedINR || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-xs opacity-60">
                Loading constituent holdings data...
              </div>
            )}
          </div>
        )}

        {/* ─── VIEW 0: CONSOLIDATED ASSET PERFORMANCE ────────────────── */}
        {reportType === 'PERFORMANCE' && activeTab !== 'MF_COMPOSITION' && (
          <div className="space-y-6">
            
            {/* Top KPI Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              
              {/* Card 1: Active Portfolio Valuation */}
              <div className="reports-subcard p-4 rounded-2xl border relative overflow-hidden flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider opacity-60 block mb-1">
                    Active Portfolio Value
                  </span>
                  <div className="text-xl sm:text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                    {formatMoney(consolidatedPerformanceData.totals.activeVal)}
                  </div>
                </div>
                <div className="pt-2 mt-2 border-t border-inherit opacity-90 text-[11px] font-mono flex items-center justify-between">
                  <span className="opacity-70">Unrealized:</span>
                  <span className={`font-bold ${consolidatedPerformanceData.totals.activePnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {consolidatedPerformanceData.totals.activePnl >= 0 ? '+' : ''}{formatMoney(consolidatedPerformanceData.totals.activePnl, true)} ({consolidatedPerformanceData.totals.activePnl >= 0 ? '+' : ''}{consolidatedPerformanceData.totals.activeRoiPct.toFixed(2)}%)
                  </span>
                </div>
              </div>

              {/* Card 2: Active Capital Invested */}
              <div className="reports-subcard p-4 rounded-2xl border relative overflow-hidden flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider opacity-60 block mb-1">
                    Open Cost Basis
                  </span>
                  <div className="text-xl sm:text-2xl font-black font-mono text-blue-600 dark:text-blue-400">
                    {formatMoney(consolidatedPerformanceData.totals.activeCost, true)}
                  </div>
                </div>
                <div className="pt-2 mt-2 border-t border-inherit opacity-90 text-[11px] font-mono flex items-center justify-between">
                  <span className="opacity-70">Open Allocation:</span>
                  <span className="font-bold opacity-90">100% of Open</span>
                </div>
              </div>

              {/* Card 3: Total Realized Proceeds */}
              <div className="reports-subcard p-4 rounded-2xl border relative overflow-hidden flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider opacity-60 block mb-1">
                    Realized Proceeds
                  </span>
                  <div className="text-xl sm:text-2xl font-black font-mono text-amber-500">
                    {formatMoney(consolidatedPerformanceData.totals.closedProceeds, true)}
                  </div>
                </div>
                <div className="pt-2 mt-2 border-t border-inherit opacity-90 text-[11px] font-mono flex items-center justify-between">
                  <span className="opacity-70">Realized Profit:</span>
                  <span className={`font-bold ${consolidatedPerformanceData.totals.closedPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {consolidatedPerformanceData.totals.closedPnl >= 0 ? '+' : ''}{formatMoney(consolidatedPerformanceData.totals.closedPnl, true)}
                  </span>
                </div>
              </div>

              {/* Card 4: Lifetime Combined Net Gain & XIRR */}
              <div className="reports-subcard p-4 rounded-2xl border relative overflow-hidden flex flex-col justify-between">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider opacity-60 block mb-1">
                    Lifetime Net Return
                  </span>
                  <div className={`text-xl sm:text-2xl font-black font-mono ${consolidatedPerformanceData.totals.lifetimePnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {consolidatedPerformanceData.totals.lifetimePnl >= 0 ? '+' : ''}{formatMoney(consolidatedPerformanceData.totals.lifetimePnl, true)}
                  </div>
                </div>
                <div className="pt-2 mt-2 border-t border-inherit opacity-90 text-[11px] font-mono flex items-center justify-between">
                  <span className="opacity-70">Annualized XIRR:</span>
                  <span className={`font-bold ${consolidatedPerformanceData.totals.portfolioXirr >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {consolidatedPerformanceData.totals.portfolioXirr >= 0 ? '+' : ''}{consolidatedPerformanceData.totals.portfolioXirr.toFixed(2)}%
                  </span>
                </div>
              </div>

            </div>

            {/* Asset Class Performance Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {consolidatedPerformanceData.categories.map((cat) => {
                const IconComponent = cat.icon || Activity;
                return (
                  <div 
                    key={cat.id} 
                    className="reports-subcard p-5 rounded-2xl border space-y-4 relative overflow-hidden"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-inherit opacity-95 pb-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`p-2 rounded-xl text-white bg-gradient-to-br ${cat.gradient} shadow-md`}>
                          <IconComponent className="w-4 h-4 stroke-[2.5]" />
                        </div>
                        <div>
                          <h4 className="text-sm font-black">{cat.label}</h4>
                          <span className="text-[10px] font-mono opacity-60">
                            {cat.activeCount} Active • {cat.closedCount} Closed • {cat.totalCount} Total
                          </span>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black font-mono reports-pill">
                          {cat.weightPct.toFixed(1)}% Allocation
                        </span>
                      </div>
                    </div>

                    {/* 3-Section Breakdown Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      
                      {/* Compartment 1: Active */}
                      <div className="p-3 rounded-xl reports-card space-y-1 font-mono text-xs border border-inherit">
                        <div className="flex justify-between items-center text-[10px] font-sans font-bold uppercase tracking-wider opacity-60">
                          <span>Open</span>
                          <span className="text-emerald-500">Live</span>
                        </div>
                        <div className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                          {formatMoney(cat.activeVal)}
                        </div>
                        <div className="text-[10.5px] opacity-75 flex justify-between">
                          <span>Cost:</span>
                          <span className="font-bold">{formatMoney(cat.activeCost, true)}</span>
                        </div>
                        <div className={`text-[10.5px] font-bold flex justify-between ${cat.activePnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          <span>Return:</span>
                          <span>{cat.activePnl >= 0 ? '+' : ''}{formatMoney(cat.activePnl, true)} ({cat.activePnl >= 0 ? '+' : ''}{cat.activeRoiPct.toFixed(1)}%)</span>
                        </div>
                        <div className="text-[10px] opacity-75 flex justify-between pt-1 border-t border-inherit">
                          <span>XIRR:</span>
                          <span className={`font-bold ${cat.activeXirr >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {cat.activeXirr >= 0 ? '+' : ''}{cat.activeXirr.toFixed(2)}%
                          </span>
                        </div>
                      </div>

                      {/* Compartment 2: Redeemed / Closed */}
                      <div className="p-3 rounded-xl reports-card space-y-1 font-mono text-xs border border-inherit">
                        <div className="flex justify-between items-center text-[10px] font-sans font-bold uppercase tracking-wider opacity-60">
                          <span>Realized</span>
                          <span className="text-amber-500">Closed</span>
                        </div>
                        <div className="text-sm font-black text-amber-500">
                          {formatMoney(cat.closedProceeds, true)}
                        </div>
                        <div className="text-[10.5px] opacity-75 flex justify-between">
                          <span>Cost:</span>
                          <span className="font-bold">{formatMoney(cat.closedCost, true)}</span>
                        </div>
                        <div className={`text-[10.5px] font-bold flex justify-between ${cat.closedPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          <span>P&L:</span>
                          <span>{cat.closedPnl >= 0 ? '+' : ''}{formatMoney(cat.closedPnl, true)} ({cat.closedPnl >= 0 ? '+' : ''}{cat.closedRoiPct.toFixed(1)}%)</span>
                        </div>
                        <div className="text-[10px] opacity-75 flex justify-between pt-1 border-t border-inherit">
                          <span>XIRR:</span>
                          <span className={`font-bold ${cat.closedXirr >= 0 ? 'text-emerald-500' : 'text-rose-400'}`}>
                            {cat.closedXirr >= 0 ? '+' : ''}{cat.closedXirr.toFixed(2)}%
                          </span>
                        </div>
                      </div>

                      {/* Compartment 3: Combined Lifetime */}
                      <div className="p-3 rounded-xl reports-card space-y-1 font-mono text-xs border border-inherit bg-slate-500/5">
                        <div className="flex justify-between items-center text-[10px] font-sans font-bold uppercase tracking-wider opacity-60">
                          <span>Combined</span>
                          <span className="text-purple-400">Lifetime</span>
                        </div>
                        <div className={`text-sm font-black ${cat.lifetimePnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {cat.lifetimePnl >= 0 ? '+' : ''}{formatMoney(cat.lifetimePnl, true)}
                        </div>
                        <div className="text-[10.5px] opacity-75 flex justify-between">
                          <span>Deployed:</span>
                          <span className="font-bold">{formatMoney(cat.lifetimeCost, true)}</span>
                        </div>
                        <div className={`text-[10.5px] font-bold flex justify-between ${cat.lifetimeRoiPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          <span>Abs Return:</span>
                          <span>{cat.lifetimeRoiPct >= 0 ? '+' : ''}{cat.lifetimeRoiPct.toFixed(2)}%</span>
                        </div>
                        <div className="text-[10px] opacity-75 flex justify-between pt-1 border-t border-inherit">
                          <span>Lifetime XIRR:</span>
                          <span className={`font-bold ${cat.lifetimeXirr >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {cat.lifetimeXirr >= 0 ? '+' : ''}{cat.lifetimeXirr.toFixed(2)}%
                          </span>
                        </div>
                      </div>

                    </div>
                  </div>
                );
              })}
            </div>

            {/* Comprehensive Consolidated Performance Table */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-black uppercase tracking-wider opacity-75">
                  Consolidated Category Performance Ledger
                </span>
                <span className="text-[11px] font-mono opacity-60">
                  {consolidatedPerformanceData.categories.length} Asset Classes
                </span>
              </div>

              <div className="overflow-x-auto rounded-2xl reports-table-container">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="reports-table-head font-bold uppercase text-[10px]">
                      <th className="py-3.5 pl-4">Asset Class</th>
                      <th className="py-3.5 text-right">Active Valuation</th>
                      <th className="py-3.5 text-right">Active Cost</th>
                      <th className="py-3.5 text-right">Unrealized P&L</th>
                      <th className="py-3.5 text-right">Realized P&L</th>
                      <th className="py-3.5 text-right">Lifetime Cost</th>
                      <th className="py-3.5 text-right">Total Net Return</th>
                      <th className="py-3.5 text-right">Abs ROI %</th>
                      <th className="py-3.5 text-right pr-4">Annualized XIRR</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-inherit font-mono">
                    {consolidatedPerformanceData.categories.map((cat) => (
                      <tr key={`table-${cat.id}`} className="reports-table-row transition-colors">
                        <td className="py-3 pl-4 font-sans font-bold flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                          <span>{cat.label}</span>
                        </td>
                        <td className="py-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                          {formatMoney(cat.activeVal)}
                        </td>
                        <td className="py-3 text-right opacity-80">
                          {formatMoney(cat.activeCost, true)}
                        </td>
                        <td className={`py-3 text-right font-bold ${cat.activePnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {cat.activePnl >= 0 ? '+' : ''}{formatMoney(cat.activePnl, true)}
                        </td>
                        <td className={`py-3 text-right font-bold ${cat.closedPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {cat.closedPnl >= 0 ? '+' : ''}{formatMoney(cat.closedPnl, true)}
                        </td>
                        <td className="py-3 text-right opacity-80">
                          {formatMoney(cat.lifetimeCost, true)}
                        </td>
                        <td className={`py-3 text-right font-black ${cat.lifetimePnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {cat.lifetimePnl >= 0 ? '+' : ''}{formatMoney(cat.lifetimePnl, true)}
                        </td>
                        <td className={`py-3 text-right font-bold ${cat.lifetimeRoiPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {cat.lifetimeRoiPct >= 0 ? '+' : ''}{cat.lifetimeRoiPct.toFixed(2)}%
                        </td>
                        <td className={`py-3 text-right pr-4 font-black ${cat.lifetimeXirr >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {cat.lifetimeXirr >= 0 ? '+' : ''}{cat.lifetimeXirr.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="reports-table-head font-bold font-mono border-t-2 border-inherit text-slate-900 dark:text-white">
                      <td className="py-3.5 pl-4 font-sans font-black uppercase text-[11px]">Total Portfolio</td>
                      <td className="py-3.5 text-right font-black text-emerald-600 dark:text-emerald-400">
                        {formatMoney(consolidatedPerformanceData.totals.activeVal)}
                      </td>
                      <td className="py-3.5 text-right font-bold opacity-90">
                        {formatMoney(consolidatedPerformanceData.totals.activeCost, true)}
                      </td>
                      <td className={`py-3.5 text-right font-black ${consolidatedPerformanceData.totals.activePnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {consolidatedPerformanceData.totals.activePnl >= 0 ? '+' : ''}{formatMoney(consolidatedPerformanceData.totals.activePnl, true)}
                      </td>
                      <td className={`py-3.5 text-right font-black ${consolidatedPerformanceData.totals.closedPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {consolidatedPerformanceData.totals.closedPnl >= 0 ? '+' : ''}{formatMoney(consolidatedPerformanceData.totals.closedPnl, true)}
                      </td>
                      <td className="py-3.5 text-right font-bold opacity-90">
                        {formatMoney(consolidatedPerformanceData.totals.lifetimeCost, true)}
                      </td>
                      <td className={`py-3.5 text-right font-black ${consolidatedPerformanceData.totals.lifetimePnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {consolidatedPerformanceData.totals.lifetimePnl >= 0 ? '+' : ''}{formatMoney(consolidatedPerformanceData.totals.lifetimePnl, true)}
                      </td>
                      <td className={`py-3.5 text-right font-black ${consolidatedPerformanceData.totals.lifetimeRoiPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {consolidatedPerformanceData.totals.lifetimeRoiPct >= 0 ? '+' : ''}{consolidatedPerformanceData.totals.lifetimeRoiPct.toFixed(2)}%
                      </td>
                      <td className={`py-3.5 text-right pr-4 font-black ${consolidatedPerformanceData.totals.portfolioXirr >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {consolidatedPerformanceData.totals.portfolioXirr >= 0 ? '+' : ''}{consolidatedPerformanceData.totals.portfolioXirr.toFixed(2)}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* ─── VIEW 1: ASSET ALLOCATION ──────────────────────────────── */}
        {reportType === 'ALLOCATION' && activeTab !== 'MF_COMPOSITION' && (
          <div className="space-y-4">
            {chartStyle === 'PIE' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                <div className="lg:col-span-7 h-[360px] w-full flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <Pie
                        data={allocationData}
                        cx="50%"
                        cy="50%"
                        innerRadius={80}
                        outerRadius={135}
                        paddingAngle={3}
                        dataKey="value"
                        isAnimationActive={false}
                        onClick={(_, idx) => setActivePieIndex(activePieIndex === idx ? null : idx)}
                      >
                        {allocationData.map((entry, index) => {
                          const isSelected = activePieIndex === index;
                          const color = entry.color || PALETTE[index % PALETTE.length];
                          return (
                            <Cell 
                              key={`cell-alloc-${index}`} 
                              fill={color}
                              stroke={isSelected ? '#FFFFFF' : 'none'}
                              strokeWidth={isSelected ? 2 : 0}
                              style={{
                                cursor: 'pointer',
                                filter: isSelected ? `drop-shadow(0px 0px 8px ${color})` : 'none',
                                transform: isSelected ? 'scale(1.05)' : 'scale(1)',
                                transformOrigin: 'center center',
                                transition: 'all 0.2s ease-out'
                              }}
                            />
                          );
                        })}
                      </Pie>
                      <Tooltip content={<CustomChartTooltip />} />
                    </RePieChart>
                  </ResponsiveContainer>
                </div>

                <div className="lg:col-span-5 max-h-[380px] overflow-y-auto pr-1">
                  <RankedBarList 
                    items={allocationData} 
                    activeIndex={activePieIndex} 
                    onHoverIndex={setActivePieIndex} 
                  />
                </div>
              </div>
            )}

            {chartStyle === 'BAR' && (
              <CleanBarChartView 
                items={allocationData} 
              />
            )}
          </div>
        )}

        {/* ─── VIEW 2: MARKET CAPITALIZATION & DRILL-DOWN ─────────────── */}
        {reportType === 'MARKET_CAP' && activeTab === 'EQUITY' && (
          <div className="space-y-4">
            {selectedMarketCap ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-inherit opacity-95 pb-3">
                  <h4 className="text-sm font-black flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedMarketCap.color }}></span>
                    <span>{selectedMarketCap.name || selectedMarketCap.capTier}</span>
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono">({formatMoney(selectedMarketCap.value)} • {selectedMarketCap.percentage}%)</span>
                  </h4>
                </div>

                <div className="overflow-x-auto rounded-2xl reports-table-container">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="reports-table-head font-bold uppercase text-[10px]">
                        <th className="py-3 pl-4">Stock / Asset</th>
                        <th className="py-3">Portfolio Source</th>
                        <th className="py-3 text-right">Contribution</th>
                        <th className="py-3 text-right pr-4">Allocated Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-inherit font-mono">
                      {selectedMarketCap.companies?.map((c, idx) => {
                        const contribPct = selectedMarketCap.value > 0 
                          ? Number(((c.allocatedINR / selectedMarketCap.value) * 100).toFixed(2)) 
                          : 0;
                        return (
                          <tr 
                            key={`${c.name}-${idx}`} 
                            onClick={() => setCompanyDetailTarget(c)}
                            className="reports-table-row transition-colors cursor-pointer group"
                          >
                            <td className="py-3 pl-4">
                              <div className="font-sans font-bold group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                                <span>{c.name}</span>
                                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                              </div>
                              {c.symbol && <div className="text-[10px] opacity-60 font-mono">{c.symbol}</div>}
                            </td>
                            <td className="py-3 opacity-80 font-sans font-medium">{c.source}</td>
                            <td className="py-3 text-right opacity-80 font-bold">
                              {contribPct}%
                            </td>
                            <td className="py-3 text-right pr-4 text-emerald-600 dark:text-emerald-400 font-bold">
                              {formatMoney(c.allocatedINR)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-end pb-1">
                  {/* Scope Switcher: All (Combined) vs Direct Stocks vs Mutual Funds */}
                  <div className="flex items-center gap-1 reports-pill p-1 rounded-2xl">
                    {[
                      { key: 'ALL', label: 'Combined' },
                      { key: 'DIRECT', label: 'Direct Stocks' },
                      { key: 'MF', label: 'Mutual Funds' }
                    ].map(s => (
                      <button
                        key={s.key}
                        onClick={() => setMcapSource(s.key)}
                        className={`px-3.5 py-1 rounded-xl text-xs font-black transition-all cursor-pointer ${
                          mcapSource === s.key 
                            ? 'bg-blue-600/20 dark:bg-blue-600/40 text-blue-600 dark:text-blue-400 border border-blue-500/40 shadow-sm' 
                            : 'opacity-70 hover:opacity-100'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {chartStyle === 'PIE' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                    <div className="lg:col-span-7 h-[360px] w-full flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <RePieChart>
                          <Pie
                            data={marketCapData}
                            cx="50%"
                            cy="50%"
                            innerRadius={80}
                            outerRadius={135}
                            paddingAngle={3}
                            dataKey="value"
                            isAnimationActive={false}
                            onClick={(entry) => setSelectedMarketCap(entry)}
                          >
                            {marketCapData.map((entry, index) => {
                              const color = entry.color;
                              return (
                                <Cell 
                                  key={`mcap-cell-${index}`} 
                                  fill={color}
                                  style={{ cursor: 'pointer' }}
                                />
                              );
                            })}
                          </Pie>
                          <Tooltip content={<CustomChartTooltip />} />
                        </RePieChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="lg:col-span-5 max-h-[380px] overflow-y-auto pr-1">
                      <RankedBarList 
                        items={marketCapData} 
                        onItemClick={(item) => setSelectedMarketCap(item)}
                      />
                    </div>
                  </div>
                )}

                {chartStyle === 'BAR' && (
                  <CleanBarChartView 
                    items={marketCapData} 
                    onItemClick={(item) => setSelectedMarketCap(item)}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── VIEW 3: SECTOR DISTRIBUTION & DRILL-DOWN ──────────────── */}
        {reportType === 'SECTOR' && activeTab === 'EQUITY' && (
          <div className="space-y-4">
            {selectedSector ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-inherit opacity-95 pb-3">
                  <h4 className="text-sm font-black flex items-center gap-2">
                    <span>{selectedSector.sector}</span>
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono">({formatMoney(selectedSector.value)} • {selectedSector.percentage}%)</span>
                  </h4>
                </div>

                <div className="overflow-x-auto rounded-2xl reports-table-container">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="reports-table-head font-bold uppercase text-[10px]">
                        <th className="py-3 pl-4">Company</th>
                        <th className="py-3">Portfolio Source</th>
                        <th className="py-3">Cap Tier</th>
                        <th className="py-3 text-right pr-4">Allocated Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-inherit font-mono">
                      {selectedSector.companies.map((c, idx) => (
                        <tr 
                          key={`${c.name}-${idx}`} 
                          onClick={() => setCompanyDetailTarget(c)}
                          className="reports-table-row transition-colors cursor-pointer group"
                        >
                          <td className="py-3 pl-4">
                            <div className="font-sans font-bold group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                              <span>{c.name}</span>
                              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                            </div>
                            {c.symbol && <div className="text-[10px] opacity-60 font-mono">{c.symbol}</div>}
                          </td>
                          <td className="py-3 opacity-80 font-sans font-medium">{c.source}</td>
                          <td className="py-3">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full reports-subcard">
                              {c.mcap_category}
                            </span>
                          </td>
                          <td className="py-3 text-right pr-4 text-emerald-600 dark:text-emerald-400 font-bold">{formatMoney(c.allocatedINR)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div>
                {chartStyle === 'PIE' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                    <div className="lg:col-span-7 h-[360px] w-full flex items-center justify-center">
                      <ResponsiveContainer width="100%" height="100%">
                        <RePieChart>
                          <Pie
                            data={sectorData}
                            cx="50%"
                            cy="50%"
                            innerRadius={80}
                            outerRadius={135}
                            paddingAngle={3}
                            dataKey="value"
                            isAnimationActive={false}
                            onClick={(entry) => setSelectedSector(entry)}
                          >
                            {sectorData.map((entry, index) => {
                              const color = entry.color;
                              return (
                                <Cell 
                                  key={`sec-cell-${index}`} 
                                  fill={color}
                                  style={{ cursor: 'pointer' }}
                                />
                              );
                            })}
                          </Pie>
                          <Tooltip content={<CustomChartTooltip />} />
                        </RePieChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="lg:col-span-5 max-h-[380px] overflow-y-auto pr-1">
                      <RankedBarList 
                        items={sectorData} 
                        onItemClick={(item) => setSelectedSector(item)} 
                      />
                    </div>
                  </div>
                )}

                {chartStyle === 'BAR' && (
                  <CleanBarChartView 
                    items={sectorData} 
                    onItemClick={(item) => setSelectedSector(item)} 
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── VIEW 4: BENCHMARK GROWTH TRAJECTORY ────────────────────── */}
        {reportType === 'TRAJECTORY' && activeTab !== 'MF_COMPOSITION' && (
          <div className="space-y-4">
            
            {/* Trajectory Controls & Date Range Selector */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-inherit opacity-95 pb-3">
              
              {/* Benchmark Index Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs opacity-75 font-bold">Benchmark:</span>
                <select
                  value={benchmark}
                  onChange={(e) => setBenchmark(e.target.value)}
                  className="reports-subcard rounded-xl px-3 py-1.5 text-xs font-bold focus:outline-none focus:border-emerald-500"
                >
                  <option value="NIFTY_50">Nifty 50</option>
                  <option value="NIFTY_MIDCAP_150">Nifty Midcap 150</option>
                  <option value="NIFTY_SMALLCAP_250">Nifty Smallcap 250</option>
                  <option value="SP_500">S&P 500</option>
                  <option value="NASDAQ">NASDAQ</option>
                </select>
              </div>

              {/* Timeframe Presets & Custom Calendar Popover Trigger */}
              <div className="relative flex items-center gap-2">
                <div className="flex items-center gap-1 reports-pill p-1 rounded-xl">
                  {['1M', '3M', '6M', '1Y', 'ALL'].map(tf => (
                    <button
                      key={tf}
                      onClick={() => {
                        setGrowthTimeframe(tf);
                        setShowCalendarPicker(false);
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        growthTimeframe === tf
                          ? 'bg-emerald-500 text-slate-950 shadow-sm'
                          : 'opacity-70 hover:opacity-100'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>

                {/* Calendar Range Picker Trigger */}
                <button
                  onClick={() => setShowCalendarPicker(!showCalendarPicker)}
                  className={`p-1.5 rounded-xl border transition-all duration-200 flex items-center gap-1 text-xs font-bold cursor-pointer ${
                    growthTimeframe === 'CUSTOM' || showCalendarPicker
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/40'
                      : 'reports-pill opacity-75 hover:opacity-100'
                  }`}
                  title="Select Custom Date Range"
                >
                  <CalendarDays className="w-4 h-4" />
                </button>

                {/* Custom Date Range Popover */}
                <AnimatePresence>
                  {showCalendarPicker && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.95 }}
                      className="absolute right-0 top-11 z-40 p-3.5 reports-card rounded-2xl shadow-xl flex flex-col gap-2.5 text-xs min-w-[260px]"
                    >
                      <p className="text-[10px] font-bold uppercase tracking-wider opacity-75 flex items-center gap-1.5">
                        <CalendarDays className="w-3.5 h-3.5 text-emerald-500" />
                        Custom Date Range
                      </p>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] opacity-75 font-bold">From</span>
                          <input 
                            type="date" 
                            value={customStartDate} 
                            onChange={(e) => setCustomStartDate(e.target.value)}
                            className="reports-subcard rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] opacity-75 font-bold">To</span>
                          <input 
                            type="date" 
                            value={customEndDate} 
                            onChange={(e) => setCustomEndDate(e.target.value)}
                            className="reports-subcard rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setGrowthTimeframe('CUSTOM');
                          setShowCalendarPicker(false);
                        }}
                        className="w-full py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs transition-colors shadow cursor-pointer"
                      >
                        Apply Range
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Growth Metrics Summary Cards */}
            {growthData?.series?.length > 0 && (() => {
              const last = growthData.series[growthData.series.length - 1];
              const portGrowth = last?.PortfolioGrowthPct || 0;
              const idxGrowth = last?.[`${benchmark}_GrowthPct`] || 0;
              const alpha = Number((portGrowth - idxGrowth).toFixed(2));

              return (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3.5 reports-subcard rounded-2xl">
                    <p className="text-[10px] uppercase font-bold opacity-75">Selected Scope Return</p>
                    <p className={`text-base font-black font-mono mt-1 ${portGrowth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {portGrowth >= 0 ? `+${portGrowth}%` : `${portGrowth}%`}
                    </p>
                  </div>
                  <div className="p-3.5 reports-subcard rounded-2xl">
                    <p className="text-[10px] uppercase font-bold opacity-75">{BENCHMARK_LABELS[benchmark]} Return</p>
                    <p className="text-base font-black font-mono mt-1" style={{ color: BENCHMARK_COLORS[benchmark] }}>
                      {idxGrowth >= 0 ? `+${idxGrowth}%` : `${idxGrowth}%`}
                    </p>
                  </div>
                  <div className="p-3.5 reports-subcard rounded-2xl">
                    <p className="text-[10px] uppercase font-bold opacity-75">Relative Alpha</p>
                    <p className={`text-base font-black font-mono mt-1 ${alpha >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {alpha >= 0 ? `+${alpha}%` : `${alpha}%`}
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Trajectory ComposedChart (Both Area and Visible Benchmark Line) */}
            <div className="h-[340px] w-full pt-2">
              {loadingGrowth ? (
                <div className="h-full flex items-center justify-center text-xs opacity-60 font-bold">
                  Loading real-time index benchmarks...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={growthData?.series || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.35}/>
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0.0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94A3B833" vertical={false} />
                    <XAxis dataKey="date" stroke="#64748B" tick={{ fill: 'currentColor', fontSize: 10 }} />
                    <YAxis 
                      stroke="#64748B" 
                      tick={{ fill: 'currentColor', fontSize: 10 }} 
                      tickFormatter={(v) => `₹${(v/100000).toFixed(1)}L`} 
                    />
                    <Tooltip content={<TrajectoryTooltip />} />
                    <Area 
                      type="monotone" 
                      dataKey="Portfolio" 
                      stroke="#10B981" 
                      strokeWidth={2.5} 
                      fillOpacity={1} 
                      fill="url(#growthGrad)" 
                      isAnimationActive={false}
                    />
                    <Line 
                      type="monotone" 
                      dataKey={`${benchmark}_Normalized`} 
                      stroke={BENCHMARK_COLORS[benchmark] || '#3B82F6'} 
                      strokeWidth={3} 
                      strokeDasharray="5 5" 
                      dot={false}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}

      </div>

      {/* ─── FLOATING BOTTOM-RIGHT TRANSPARENT BACK BUTTON (NO TEXT, ONLY ARROW) ─── */}
      <AnimatePresence>
        {(selectedSector || selectedMarketCap) && (
          <motion.button
            initial={{ scale: 0, opacity: 0, y: 15 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0, opacity: 0, y: 15 }}
            onClick={() => {
              setSelectedSector(null);
              setSelectedMarketCap(null);
            }}
            className="fixed bottom-8 right-8 z-50 w-11 h-11 rounded-full bg-slate-900/30 hover:bg-slate-900/60 dark:bg-slate-800/40 dark:hover:bg-slate-700/60 backdrop-blur-md border border-slate-400/20 dark:border-slate-600/30 text-slate-800 dark:text-white shadow-xl cursor-pointer transition-all hover:scale-110 flex items-center justify-center group"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ─── COMPANY MUTUAL FUND BREAKDOWN MODAL ───────────────────── */}
      <AnimatePresence>
        {companyDetailTarget && companyMfBreakdown && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-2xl modal-surface reports-card rounded-3xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto"
            >
              {/* Modal Header */}
              <div className="flex items-start justify-between gap-4 border-b border-inherit opacity-95 pb-4">
                <div>
                  <h3 className="text-lg font-black flex items-center gap-2">
                    <span>{companyMfBreakdown.name}</span>
                    {companyMfBreakdown.symbol && (
                      <span className="text-xs px-2 py-0.5 rounded-md reports-subcard font-mono font-bold opacity-80">
                        {companyMfBreakdown.symbol}
                      </span>
                    )}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 pt-1.5 text-xs opacity-75 font-medium">
                    <span>{companyMfBreakdown.sector}</span>
                    <span>•</span>
                    <span className="font-bold">{companyMfBreakdown.capTier}</span>
                  </div>
                </div>

                <button
                  onClick={() => setCompanyDetailTarget(null)}
                  className="p-2 rounded-xl opacity-60 hover:opacity-100 hover:bg-slate-500/10 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Total Holding Stat Banner */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 reports-subcard rounded-2xl">
                  <p className="text-[10px] uppercase font-bold opacity-75">Total Portfolio Value</p>
                  <p className="text-base font-black font-mono mt-1 text-emerald-600 dark:text-emerald-400">
                    {formatMoney(companyMfBreakdown.totalGrandVal)}
                  </p>
                </div>
                <div className="p-3.5 reports-subcard rounded-2xl">
                  <p className="text-[10px] uppercase font-bold opacity-75">Via Mutual Funds</p>
                  <p className="text-base font-black font-mono mt-1 text-purple-600 dark:text-purple-400">
                    {formatMoney(companyMfBreakdown.totalMfAllocated)}
                  </p>
                </div>
                <div className="p-3.5 reports-subcard rounded-2xl">
                  <p className="text-[10px] uppercase font-bold opacity-75">Direct Equity Holding</p>
                  <p className="text-base font-black font-mono mt-1 text-blue-600 dark:text-blue-400">
                    {formatMoney(companyMfBreakdown.directVal)}
                  </p>
                </div>
              </div>

              {/* Mutual Funds Scheme Breakdown Table */}
              <div className="space-y-2.5">
                <p className="text-xs font-black uppercase tracking-wider opacity-80">
                  Mutual Fund Schemes Breakdown ({companyMfBreakdown.schemes.length})
                </p>

                {companyMfBreakdown.schemes.length > 0 ? (
                  <div className="overflow-x-auto rounded-2xl reports-table-container">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="reports-table-head font-bold uppercase text-[10px]">
                          <th className="py-3 pl-4">Mutual Fund Scheme</th>
                          <th className="py-3 text-right">Fund Weight</th>
                          <th className="py-3 text-right">Allocated Value</th>
                          <th className="py-3 text-right pr-4">Share of Holding</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-inherit font-mono">
                        {companyMfBreakdown.schemes.map((s, idx) => (
                          <tr key={`${s.scheme_code}-${idx}`} className="reports-table-row transition-colors">
                            <td className="py-3 pl-4 font-sans font-bold">
                              {s.scheme_name}
                            </td>
                            <td className="py-3 text-right opacity-80 font-bold">
                              {s.fund_weight_pct}%
                            </td>
                            <td className="py-3 text-right text-emerald-600 dark:text-emerald-400 font-bold">
                              {formatMoney(s.allocatedINR)}
                            </td>
                            <td className="py-3 text-right pr-4 text-purple-600 dark:text-purple-400 font-black">
                              {s.shareOfStockPct}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-6 text-center text-xs opacity-70 reports-subcard rounded-2xl">
                    This company is held directly as equity shares in your portfolio.
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </AnimatedPage>
  );
}
