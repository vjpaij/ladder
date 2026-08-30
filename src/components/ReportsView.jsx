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
  Compass
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
  
  // Master Tab states
  const [activeTab, setActiveTab] = useState('EQUITY'); // CONSOLIDATED, EQUITY, FIXED_INCOME, NPS
  
  // View states within tabs
  const [reportType, setReportType] = useState('MARKET_CAP'); // ALLOCATION, MARKET_CAP, SECTOR, MF_LOOKTHROUGH, TRAJECTORY
  
  // Chart visual type switcher: PIE vs BAR
  const [chartStyle, setChartStyle] = useState('PIE');
  
  // Equity Hub Sub-Filters
  const [equityOptions, setEquityOptions] = useState({
    india: true,
    us: true,
    mf: true
  });

  // Market Cap Source Toggle: ALL, DIRECT, MF
  const [mcapSource, setMcapSource] = useState('ALL');

  // Interactive Sector Drill-down Modal/Drawer
  const [selectedSector, setSelectedSector] = useState(null);

  // Mutual Fund Explorer: selected scheme code
  const [selectedMfScheme, setSelectedMfScheme] = useState('ALL');
  const [isMfDropdownOpen, setIsMfDropdownOpen] = useState(false);
  const mfDropdownRef = useRef(null);

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
    if (activeTab === 'FIXED_INCOME') return 'bank,epf';
    if (activeTab === 'NPS') return 'nps';
    
    // In EQUITY tab: check selected equityOptions
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

  // Sector Data with Full Look-Through & Zero "Mutual Funds" Category
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
            if (!companyMap[sec]) companyMap[sec] = [];
            map[sec] += c.allocatedINR || 0;
            companyMap[sec].push({
              name: c.company || c.name,
              symbol: c.symbol,
              source: `MF: ${mfScheme.scheme_name}`,
              allocatedINR: c.allocatedINR,
              mcap_category: c.mcap_category || 'Mid Cap'
            });
          });
        } else {
          const sec = 'Cash, Debt & Other';
          if (!map[sec]) map[sec] = 0;
          if (!companyMap[sec]) companyMap[sec] = [];
          map[sec] += h.currentValueINR || 0;
          companyMap[sec].push({
            name: h.name,
            symbol: h.symbol,
            source: 'Mutual Fund',
            allocatedINR: h.currentValueINR,
            mcap_category: 'Diversified'
          });
        }
      } else {
        // Direct Stock / Bank / etc
        const sec = normalizeSector(h.sector);
        if (!map[sec]) map[sec] = 0;
        if (!companyMap[sec]) companyMap[sec] = [];
        map[sec] += h.currentValueINR || 0;
        companyMap[sec].push({
          name: h.name || h.symbol,
          symbol: h.symbol,
          source: h.category_name || 'Direct Equity',
          allocatedINR: h.currentValueINR,
          mcap_category: h.market_cap || 'Small Cap'
        });
      }
    });

    const total = Object.values(map).reduce((sum, v) => sum + v, 0);

    return Object.keys(map).map((s, idx) => ({
      name: s,
      sector: s,
      color: PALETTE[idx % PALETTE.length],
      value: Math.round(map[s]),
      percentage: total > 0 ? Number(((map[s] / total) * 100).toFixed(2)) : 0,
      companies: companyMap[s]?.sort((a, b) => b.allocatedINR - a.allocatedINR) || []
    })).sort((a, b) => b.value - a.value);
  }, [filteredHoldings, mfData]);

  // Market Cap Data: Mega, Large, Mid, Small, Micro, Cash
  const marketCapData = useMemo(() => {
    const buckets = {
      'Mega Cap': 0,
      'Large Cap': 0,
      'Mid Cap': 0,
      'Small Cap': 0,
      'Micro Cap': 0,
      'Cash': 0
    };

    const constituentList = {
      'Mega Cap': [],
      'Large Cap': [],
      'Mid Cap': [],
      'Small Cap': [],
      'Micro Cap': [],
      'Cash': []
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
            constituentList[targetTier].push({
              name: c.company || c.name,
              symbol: c.symbol,
              source: `MF: ${mfScheme.scheme_name}`,
              allocatedINR: c.allocatedINR,
              mcapCr: null
            });
          });
        } else {
          buckets['Mid Cap'] += h.currentValueINR || 0;
          constituentList['Mid Cap'].push({
            name: h.name,
            symbol: h.symbol,
            source: 'Mutual Fund',
            allocatedINR: h.currentValueINR,
            mcapCr: null
          });
        }
      } else {
        if (mcapSource === 'MF') return;
        let mc = h.market_cap || 'Small Cap';
        if (buckets[mc] === undefined) mc = 'Small Cap';
        buckets[mc] += h.currentValueINR || 0;
        constituentList[mc].push({
          name: h.name || h.symbol,
          symbol: h.symbol,
          source: h.category_name || 'Direct Equity',
          allocatedINR: h.currentValueINR,
          mcapCr: h.market_cap_cr
        });
      }
    });

    const total = Object.values(buckets).reduce((sum, v) => sum + v, 0);

    return Object.keys(buckets)
      .filter(k => buckets[k] > 0)
      .map(k => ({
        name: k,
        color: CAP_COLORS[k] || '#3B82F6',
        value: Math.round(buckets[k]),
        percentage: total > 0 ? Number(((buckets[k] / total) * 100).toFixed(2)) : 0,
        companies: constituentList[k]?.sort((a, b) => b.allocatedINR - a.allocatedINR) || []
      }));
  }, [filteredHoldings, mfData, mcapSource]);

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

  // Universal Custom Tooltip
  const CustomChartTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      const name = data.name || data.payload?.sector || data.payload?.name;
      const value = data.value !== undefined ? data.value : data.payload?.value;
      const percentage = data.payload?.percentage;
      const color = data.color || data.payload?.fill || PALETTE[0];

      return (
        <div className="glass-card p-3 rounded-2xl shadow-xl text-xs space-y-1.5 z-50 pointer-events-none min-w-[180px] border border-slate-800">
          <p className="font-extrabold text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }}></span>
            <span className="truncate">{name}</span>
          </p>
          <div className="pt-1 text-[11px] font-mono space-y-1 border-t border-slate-800/80">
            <p className="flex justify-between gap-4 text-slate-300">
              <span className="text-slate-400">Value:</span>
              <span className="font-bold text-emerald-400">{formatMoney(value)}</span>
            </p>
            {percentage !== undefined && (
              <p className="flex justify-between gap-4 text-slate-300">
                <span className="text-slate-400">Allocation:</span>
                <span className="font-bold text-white">{Number(percentage).toFixed(2)}%</span>
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
      const benchGrowth = point[`${benchmark}_GrowthPct`];
      const alpha = (portGrowth !== undefined && benchGrowth !== undefined) ? Number((portGrowth - benchGrowth).toFixed(2)) : 0;

      return (
        <div className="glass-card p-3.5 rounded-2xl shadow-xl text-xs space-y-2 z-50 pointer-events-none min-w-[200px] border border-slate-800">
          <p className="font-mono font-bold text-slate-400 text-[11px] border-b border-slate-800 pb-1 flex items-center justify-between">
            <span>{label}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${alpha >= 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
              Alpha: {alpha >= 0 ? `+${alpha}%` : `${alpha}%`}
            </span>
          </p>
          <div className="space-y-1 font-mono text-[11px]">
            <div className="flex justify-between gap-4 text-slate-200">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                Portfolio:
              </span>
              <span className="font-bold text-emerald-400">
                {formatMoney(portVal)} ({portGrowth >= 0 ? `+${portGrowth}%` : `${portGrowth}%`})
              </span>
            </div>
            <div className="flex justify-between gap-4 text-slate-300">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BENCHMARK_COLORS[benchmark] }}></span>
                {BENCHMARK_LABELS[benchmark]}:
              </span>
              <span className="font-bold" style={{ color: BENCHMARK_COLORS[benchmark] }}>
                {benchGrowth >= 0 ? `+${benchGrowth}%` : `${benchGrowth}%`}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  // Modern Ranked List Component (Rock solid, theme adhering, no serial numbers)
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
              className={`group relative overflow-hidden p-3 rounded-2xl border transition-all duration-150 cursor-pointer ${
                isSelected 
                  ? 'bg-emerald-500/15 border-emerald-500/60 shadow-md' 
                  : 'bg-slate-900/40 hover:bg-slate-800/60 border-slate-800/80'
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
                    <p className="text-xs font-extrabold truncate text-white">
                      {item.name}
                    </p>
                    {item.symbol && item.symbol !== 'OTHER' && (
                      <p className="text-[10px] text-slate-400 font-mono font-semibold truncate">{item.symbol}</p>
                    )}
                  </div>
                </div>

                <div className="text-right shrink-0 font-mono">
                  <p className="text-xs font-black text-white group-hover:text-emerald-400 transition-colors">
                    {formatMoney(item.value)}
                  </p>
                  <p className="text-[10px] font-extrabold text-emerald-400">{item.percentage}%</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Crisp Institutional Bar Chart View
  const CleanBarChartView = ({ items, onItemClick }) => {
    return (
      <div className="h-[360px] w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <ReBarChart data={items} margin={{ top: 10, right: 10, left: 10, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#94A3B833" vertical={false} />
            <XAxis 
              dataKey="name" 
              stroke="#64748B" 
              tick={{ fontSize: 10 }}
              tickFormatter={(str) => str.length > 12 ? `${str.substring(0, 10)}...` : str}
            />
            <YAxis 
              stroke="#64748B" 
              tick={{ fontSize: 10 }} 
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
        <div className="glass-card p-4 sm:p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400">
              <PieChart className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white flex items-center gap-2">
                Reports
              </h2>
            </div>
          </div>

          {/* Master Navigation Tabs */}
          <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-2xl border border-slate-800 shrink-0">
            {[
              { key: 'CONSOLIDATED', label: 'Consolidated' },
              { key: 'EQUITY', label: 'Equity Hub' },
              { key: 'FIXED_INCOME', label: 'Fixed Income' },
              { key: 'NPS', label: 'NPS' }
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveTab(tab.key);
                  if (tab.key !== 'EQUITY' && reportType !== 'ALLOCATION' && reportType !== 'TRAJECTORY') {
                    setReportType('ALLOCATION');
                  }
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  activeTab === tab.key 
                    ? 'bg-emerald-500 text-slate-950 shadow-md' 
                    : 'text-slate-400 hover:text-white'
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
        {/* Equity Scope Checkboxes */}
        {activeTab === 'EQUITY' ? (
          <div className="flex items-center gap-4 text-xs font-extrabold text-white bg-slate-900/90 px-4 py-2 rounded-2xl border border-slate-800 shadow-sm">
            <span className="text-slate-400 font-black text-[11px] uppercase tracking-wider">Scope:</span>
            <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-emerald-400">
              <input
                type="checkbox"
                checked={equityOptions.india}
                onChange={(e) => setEquityOptions(prev => ({ ...prev, india: e.target.checked }))}
                className="w-4 h-4 rounded accent-emerald-500 cursor-pointer"
              />
              <span>Indian Stock</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-blue-400">
              <input
                type="checkbox"
                checked={equityOptions.us}
                onChange={(e) => setEquityOptions(prev => ({ ...prev, us: e.target.checked }))}
                className="w-4 h-4 rounded accent-blue-500 cursor-pointer"
              />
              <span>US Stock</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none hover:text-purple-400">
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
        {['ALLOCATION', 'MARKET_CAP', 'SECTOR'].includes(reportType) ? (
          <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-2xl border border-slate-800 shadow-sm">
            <button
              onClick={() => setChartStyle('PIE')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                chartStyle === 'PIE' 
                  ? 'bg-emerald-500 text-slate-950 shadow-sm' 
                  : 'text-slate-400 hover:text-white'
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
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Bar Chart</span>
            </button>
          </div>
        ) : <div />}
      </div>

      {/* ─── Main Content Container ─────────────────────────────────── */}
      <div className="glass-card border border-slate-800 rounded-3xl p-5 md:p-6 shadow-sm space-y-6">
        
        {/* Navigation Tabs Bar */}
        <div className="flex items-center gap-2 border-b border-slate-800 pb-3 overflow-x-auto">
          {[
            { key: 'ALLOCATION', label: 'Allocation' },
            ...(activeTab === 'EQUITY' ? [
              { key: 'MARKET_CAP', label: 'Market Cap' },
              { key: 'SECTOR', label: 'Sectors & Drill-down' },
              { key: 'MF_LOOKTHROUGH', label: 'Mutual Fund Look-Through' }
            ] : []),
            { key: 'TRAJECTORY', label: 'Growth vs Indices' }
          ].map(view => (
            <button
              key={view.key}
              onClick={() => setReportType(view.key)}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all shrink-0 cursor-pointer ${
                reportType === view.key
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>

        {/* ─── VIEW 1: ASSET ALLOCATION ──────────────────────────────── */}
        {reportType === 'ALLOCATION' && (
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

        {/* ─── VIEW 2: MARKET CAPITALIZATION ──────────────────────────── */}
        {reportType === 'MARKET_CAP' && activeTab === 'EQUITY' && (
          <div className="space-y-4">
            <div className="flex items-center justify-end pb-1">
              {/* Scope Switcher: All (Combined) vs Direct Stocks vs Mutual Funds */}
              <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-2xl border border-slate-800">
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
                        ? 'bg-blue-600/40 text-blue-400 border border-blue-500/40 shadow-sm' 
                        : 'text-slate-400 hover:text-white'
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
                        onClick={(_, idx) => setActivePieIndex(activePieIndex === idx ? null : idx)}
                      >
                        {marketCapData.map((entry, index) => {
                          const isSelected = activePieIndex === index;
                          const color = entry.color;
                          return (
                            <Cell 
                              key={`mcap-cell-${index}`} 
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
                    items={marketCapData} 
                    activeIndex={activePieIndex} 
                    onHoverIndex={setActivePieIndex} 
                  />
                </div>
              </div>
            )}

            {chartStyle === 'BAR' && (
              <CleanBarChartView 
                items={marketCapData} 
              />
            )}
          </div>
        )}

        {/* ─── VIEW 3: SECTOR DISTRIBUTION & DRILL-DOWN ──────────────── */}
        {reportType === 'SECTOR' && activeTab === 'EQUITY' && (
          <div className="space-y-4">
            {selectedSector ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2.5">
                    <button
                      onClick={() => setSelectedSector(null)}
                      className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-black transition-colors cursor-pointer border border-slate-700"
                    >
                      ← Back
                    </button>
                    <h4 className="text-sm font-black text-white flex items-center gap-2">
                      <span>{selectedSector.sector}</span>
                      <span className="text-xs text-emerald-400 font-mono">({formatMoney(selectedSector.value)} • {selectedSector.percentage}%)</span>
                    </h4>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-800">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-400 font-black uppercase text-[10px]">
                        <th className="py-3 pl-4">Company</th>
                        <th className="py-3">Portfolio Source</th>
                        <th className="py-3">Cap Tier</th>
                        <th className="py-3 text-right pr-4">Allocated Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono">
                      {selectedSector.companies.map((c, idx) => (
                        <tr key={`${c.name}-${idx}`} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 pl-4 text-white">
                            <div className="font-sans font-bold">{c.name}</div>
                            <div className="text-[10px] text-slate-400 font-mono">{c.symbol}</div>
                          </td>
                          <td className="py-3 text-slate-300 font-sans font-medium">{c.source}</td>
                          <td className="py-3">
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                              {c.mcap_category}
                            </span>
                          </td>
                          <td className="py-3 text-right pr-4 text-emerald-400 font-black">{formatMoney(c.allocatedINR)}</td>
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

        {/* ─── VIEW 4: MUTUAL FUND LOOK-THROUGH ──────────────────────── */}
        {reportType === 'MF_LOOKTHROUGH' && activeTab === 'EQUITY' && (
          <div className="space-y-4">
            
            {/* Custom Luxury Animated Dropdown */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="relative" ref={mfDropdownRef}>
                <button
                  onClick={() => setIsMfDropdownOpen(!isMfDropdownOpen)}
                  className="flex items-center justify-between gap-3 min-w-[280px] sm:min-w-[340px] px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-2xl shadow-sm hover:border-emerald-500 transition-all cursor-pointer text-white"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Compass className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="text-xs font-black truncate">
                      {selectedMfDetails?.scheme_name || 'Select Scheme'}
                    </span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isMfDropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {isMfDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.98 }}
                      className="absolute left-0 top-12 z-50 w-full max-h-[320px] overflow-y-auto p-2 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl space-y-1 text-white"
                    >
                      <button
                        onClick={() => {
                          setSelectedMfScheme('ALL');
                          setIsMfDropdownOpen(false);
                        }}
                        className={`w-full px-3 py-2 text-left rounded-xl text-xs font-black flex items-center justify-between transition-colors cursor-pointer ${
                          selectedMfScheme === 'ALL'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <span>Consolidated Mutual Funds</span>
                        <span className="font-mono text-[11px] text-slate-400">{formatMoney(mfData?.totalMfValueINR || 0)}</span>
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
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : 'text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          <span className="truncate pr-2">{s.scheme_name}</span>
                          <span className="font-mono text-[11px] text-slate-400 shrink-0">{formatMoney(s.currentValueINR)}</span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {selectedMfDetails && (
                <div className="font-mono text-sm text-emerald-400 font-black">
                  {formatMoney(selectedMfDetails.currentValueINR)}
                </div>
              )}
            </div>

            {selectedMfDetails && selectedMfDetails.companies?.length > 0 ? (
              <div className="overflow-x-auto rounded-2xl border border-slate-800">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-400 font-black uppercase text-[10px]">
                      <th className="py-3 pl-4">Company</th>
                      <th className="py-3">Sector</th>
                      <th className="py-3">Cap Tier</th>
                      <th className="py-3 text-right">Fund Weight</th>
                      <th className="py-3 text-right pr-4">Allocated Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {selectedMfDetails.companies.map((c, i) => (
                      <tr key={`${c.company || c.name}-${i}`} className="hover:bg-slate-800/40 transition-colors">
                        <td className="py-3 pl-4 text-white">
                          <div className="font-sans font-bold">{c.company || c.name}</div>
                          {c.symbol && c.symbol !== 'OTHER' && (
                            <div className="text-[10px] text-slate-400 font-mono">{c.symbol}</div>
                          )}
                        </td>
                        <td className="py-3 text-slate-300 font-sans font-medium">{normalizeSector(c.sector)}</td>
                        <td className="py-3">
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                            {c.mcap_category || 'Mid Cap'}
                          </span>
                        </td>
                        <td className="py-3 text-right text-slate-300 font-black">
                          {c.allocation_pct ? `${c.allocation_pct}%` : `${c.percentage}%`}
                        </td>
                        <td className="py-3 text-right pr-4 text-emerald-400 font-black">
                          {formatMoney(c.allocatedINR || c.totalAllocatedINR || 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-slate-400">
                Loading constituent holdings data...
              </div>
            )}
          </div>
        )}

        {/* ─── VIEW 5: REAL-TIME GROWTH VS INDICES ───────────────────── */}
        {reportType === 'TRAJECTORY' && (
          <div className="space-y-4">
            
            {/* Trajectory Controls & Date Range Selector */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
              
              {/* Benchmark Index Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 font-black">Benchmark:</span>
                <select
                  value={benchmark}
                  onChange={(e) => setBenchmark(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white font-black focus:outline-none focus:border-emerald-500"
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
                <div className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
                  {['1M', '3M', '6M', '1Y', 'ALL'].map(tf => (
                    <button
                      key={tf}
                      onClick={() => {
                        setGrowthTimeframe(tf);
                        setShowCalendarPicker(false);
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                        growthTimeframe === tf
                          ? 'bg-emerald-500 text-slate-950 shadow-sm'
                          : 'text-slate-400 hover:text-white'
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
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                      : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
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
                      className="absolute right-0 top-11 z-40 p-3.5 bg-slate-900 border border-slate-800 rounded-2xl shadow-xl flex flex-col gap-2.5 text-xs text-white min-w-[260px]"
                    >
                      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                        <CalendarDays className="w-3.5 h-3.5 text-emerald-400" />
                        Custom Date Range
                      </p>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] text-slate-400 font-bold">From</span>
                          <input 
                            type="date" 
                            value={customStartDate} 
                            onChange={(e) => setCustomStartDate(e.target.value)}
                            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-[9px] text-slate-400 font-bold">To</span>
                          <input 
                            type="date" 
                            value={customEndDate} 
                            onChange={(e) => setCustomEndDate(e.target.value)}
                            className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setGrowthTimeframe('CUSTOM');
                          setShowCalendarPicker(false);
                        }}
                        className="w-full py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-lg text-xs transition-colors shadow cursor-pointer"
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
                  <div className="p-3.5 bg-slate-900/40 rounded-2xl border border-slate-800">
                    <p className="text-[10px] uppercase font-black text-slate-400">Selected Scope Return</p>
                    <p className={`text-base font-black font-mono mt-1 ${portGrowth >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {portGrowth >= 0 ? `+${portGrowth}%` : `${portGrowth}%`}
                    </p>
                  </div>
                  <div className="p-3.5 bg-slate-900/40 rounded-2xl border border-slate-800">
                    <p className="text-[10px] uppercase font-black text-slate-400">{BENCHMARK_LABELS[benchmark]} Return</p>
                    <p className="text-base font-black font-mono mt-1" style={{ color: BENCHMARK_COLORS[benchmark] }}>
                      {idxGrowth >= 0 ? `+${idxGrowth}%` : `${idxGrowth}%`}
                    </p>
                  </div>
                  <div className="p-3.5 bg-slate-900/40 rounded-2xl border border-slate-800">
                    <p className="text-[10px] uppercase font-black text-slate-400">Relative Alpha</p>
                    <p className={`text-base font-black font-mono mt-1 ${alpha >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {alpha >= 0 ? `+${alpha}%` : `${alpha}%`}
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Trajectory ComposedChart (Both Area and Visible Benchmark Line) */}
            <div className="h-[340px] w-full pt-2">
              {loadingGrowth ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400 font-bold">
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
                    <XAxis dataKey="date" stroke="#64748B" tick={{ fontSize: 10 }} />
                    <YAxis 
                      stroke="#64748B" 
                      tick={{ fontSize: 10 }} 
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
    </AnimatedPage>
  );
}
