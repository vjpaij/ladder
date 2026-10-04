import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ResponsiveContainer, 
  BarChart as ReBarChart, 
  Bar, 
  AreaChart, 
  Area, 
  PieChart as RePieChart, 
  Pie, 
  Cell, 
  Tooltip, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Legend 
} from 'recharts';
import { 
  Coins, 
  TrendingUp, 
  BarChart3, 
  PieChart as PieIcon, 
  Search, 
  X, 
  ExternalLink, 
  Calendar, 
  ArrowUpDown, 
  ArrowUp, 
  ArrowDown, 
  ArrowLeft,
  Layers, 
  Globe, 
  Percent, 
  ArrowUpRight, 
  Check, 
  ChevronRight,
  Sparkles,
  Award
} from 'lucide-react';
import { useThemeAuth } from '../../context/ThemeAuthContext';
import HoldingLogo from '../HoldingLogo';
import AssetDividendDetailModal from '../AssetDividendDetailModal';
import { PALETTE } from './reportsConstants';
import { formatDateDDMMYYYY } from '../../utils/dateFormatter';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MONTH_COLORS = [
  '#93c5fd', '#67e8f9', '#6ee7b7', '#86efac', 
  '#bef264', '#fde047', '#fdba74', '#fca5a5', 
  '#f9a8d4', '#f0abfc', '#d8b4fe', '#a5b4fc'
];

export default function DividendReportView({ summary, holdings = [], registerBackHandler }) {
  const { formatMoney, isUSD, fxRate } = useThemeAuth();

  // Data state
  const [dividendData, setDividendData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Sub-tabs: 'GROWTH' | 'CONTRIBUTION' | 'YIELD' | 'LEDGER'
  const [subTab, setSubTab] = useState('GROWTH');

  // Growth mode: 'ANNUAL' | 'MONTHLY' | 'CUMULATIVE'
  const [growthMode, setGrowthMode] = useState('ANNUAL');

  // Contribution chart style: 'PIE' | 'BAR'
  const [contribStyle, setContribStyle] = useState('PIE');
  const [activePieIndex, setActivePieIndex] = useState(null);

  // Table Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [marketFilter, setMarketFilter] = useState('ALL'); // 'ALL' | 'IN' | 'US'
  const [tableSort, setTableSort] = useState({ field: 'total_inr', direction: 'desc' });

  // Modal drilldown state
  const [selectedAsset, setSelectedAsset] = useState(null);

  // Annual Growth Year Drilldown state
  const [selectedYear, setSelectedYear] = useState(null);
  const [yearTableSort, setYearTableSort] = useState({ field: 'date', direction: 'desc' });
  const [yearSearchQuery, setYearSearchQuery] = useState('');

  // Fetch dividends data
  const fetchDividends = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get('/api/dividends');
      setDividendData(res.data);
    } catch (err) {
      console.error('[DividendReportView] Failed to fetch dividends:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDividends();
  }, [fetchDividends, holdings]);

  // Register back button handler
  useEffect(() => {
    if (!registerBackHandler) return;
    registerBackHandler(() => {
      if (selectedAsset) {
        setSelectedAsset(null);
        return true;
      }
      if (selectedYear) {
        setSelectedYear(null);
        return true;
      }
      return false;
    });
    return () => registerBackHandler(null);
  }, [registerBackHandler, selectedAsset, selectedYear]);

  // Clean company name helper
  const cleanName = (name = '') => {
    return String(name)
      .replace(/\b(Common Stock|Capital Stock|Registry Share|Registry Shares|Class A|Class B|Class C|Ordinary Shares|Ordinary Share)\b/ig, '')
      .replace(/,\s*Inc\.?$/i, ' Inc.')
      .replace(/,\s*Corp\.?$/i, ' Corp.')
      .replace(/[,\.\-\s]+$/, '')
      .trim();
  };

  // Map holdings by id & symbol
  const holdingMap = useMemo(() => {
    const map = { byId: {}, bySym: {} };
    if (!holdings || !Array.isArray(holdings)) return map;
    holdings.forEach(h => {
      if (h.id) map.byId[String(h.id)] = h;
      if (h.symbol) {
        const cleanSym = String(h.symbol).replace(/\.(NS|BO)$/i, '').toUpperCase().trim();
        map.bySym[cleanSym] = h;
      }
    });
    return map;
  }, [holdings]);

  // Raw history with normalized dates
  const rawHistory = useMemo(() => {
    if (!dividendData?.history) return [];
    return dividendData.history.map(d => {
      let isoDate = d.raw_date || d.payment_date || '';
      if (/^\d{2}-\d{2}-\d{4}$/.test(isoDate)) {
        const p = isoDate.split('-');
        isoDate = `${p[2]}-${p[1]}-${p[0]}`;
      }
      const dObj = new Date(isoDate);
      const year = !isNaN(dObj.getTime()) ? dObj.getFullYear() : parseInt(isoDate.slice(0, 4), 10) || 0;
      const month = !isNaN(dObj.getTime()) ? dObj.getMonth() : 0; // 0-11
      return {
        ...d,
        isoDate,
        year,
        month,
        clean_name: cleanName(d.asset_name || d.name || d.symbol)
      };
    });
  }, [dividendData]);

  // Aggregated Schemes by Asset
  const aggregatedSchemes = useMemo(() => {
    if (!rawHistory || rawHistory.length === 0) return [];
    const schemeMap = new Map();

    rawHistory.forEach(d => {
      const isUS = d.currency === 'USD';
      const key = d.holding_id ? String(d.holding_id) : `${(d.symbol || '').toUpperCase()}_${d.currency}`;
      
      if (!schemeMap.has(key)) {
        const matchedHolding = (d.holding_id && holdingMap.byId[String(d.holding_id)]) ||
          (d.symbol && holdingMap.bySym[String(d.symbol).replace(/\.(NS|BO)$/i, '').toUpperCase().trim()]);

        const investedCost = matchedHolding ? (Number(matchedHolding.investedValueINR) || 0) : 0;
        const currentVal = matchedHolding ? (Number(matchedHolding.currentValueINR) || 0) : 0;

        schemeMap.set(key, {
          id: d.holding_id || key,
          holding_id: d.holding_id || null,
          symbol: d.symbol || 'ASSET',
          name: d.clean_name || d.asset_name || d.symbol,
          clean_name: d.clean_name || d.asset_name || d.symbol,
          currency: d.currency || (isUS ? 'USD' : 'INR'),
          category_id: d.category_id || (isUS ? 'us_stocks' : 'in_stocks'),
          payouts_count: 0,
          total_amount_original: 0,
          total_amount_inr: 0,
          latest_raw_date: '',
          latest_payment_date: '',
          fx_rate: d.fx_rate || 1.0,
          investedCost,
          currentVal,
          holding: matchedHolding || null,
          records: []
        });
      }

      const scheme = schemeMap.get(key);
      scheme.payouts_count += 1;
      scheme.total_amount_original += (Number(d.amount_original) || 0);
      scheme.total_amount_inr += (Number(d.amount_inr) || 0);
      scheme.records.push(d);

      const dRaw = d.isoDate || d.raw_date || d.payment_date || '';
      if (!scheme.latest_raw_date || dRaw.localeCompare(scheme.latest_raw_date) > 0) {
        scheme.latest_raw_date = dRaw;
        scheme.latest_payment_date = d.payment_date || d.raw_date;
      }
    });

    const grandTotal = Array.from(schemeMap.values()).reduce((sum, s) => sum + s.total_amount_inr, 0);

    return Array.from(schemeMap.values()).map(s => {
      const sharePct = grandTotal > 0 ? Number(((s.total_amount_inr / grandTotal) * 100).toFixed(2)) : 0;
      const yocPct = s.investedCost > 0 ? Number(((s.total_amount_inr / s.investedCost) * 100).toFixed(2)) : 0;
      return {
        ...s,
        sharePct,
        yocPct
      };
    });
  }, [rawHistory, holdingMap]);

  // Grand Totals & KPI Metrics
  const kpis = useMemo(() => {
    const totalInr = aggregatedSchemes.reduce((sum, s) => sum + s.total_amount_inr, 0);
    const totalIndiaInr = aggregatedSchemes.filter(s => s.currency !== 'USD').reduce((sum, s) => sum + s.total_amount_inr, 0);
    const totalUsUsd = aggregatedSchemes.filter(s => s.currency === 'USD').reduce((sum, s) => sum + s.total_amount_original, 0);
    const totalUsConvertedInr = aggregatedSchemes.filter(s => s.currency === 'USD').reduce((sum, s) => sum + s.total_amount_inr, 0);
    const totalPayouts = rawHistory.length;

    // Total invested cost in active equity holdings
    const activeEquityCost = holdings
      .filter(h => (h.category_id === 'in_stocks' || h.category_id === 'us_stocks') && Number(h.quantity) > 0)
      .reduce((sum, h) => sum + (Number(h.investedValueINR) || 0), 0);

    const portfolioYoCPct = activeEquityCost > 0 ? Number(((totalInr / activeEquityCost) * 100).toFixed(2)) : 0;

    // Current Year vs Previous Year
    const currentYear = new Date().getFullYear();
    const prevYear = currentYear - 1;

    const cyInr = rawHistory
      .filter(d => d.year === currentYear)
      .reduce((sum, d) => sum + (Number(d.amount_inr) || 0), 0);

    const pyInr = rawHistory
      .filter(d => d.year === prevYear)
      .reduce((sum, d) => sum + (Number(d.amount_inr) || 0), 0);

    const yoyGrowthPct = pyInr > 0 ? Number((((cyInr - pyInr) / pyInr) * 100).toFixed(2)) : (cyInr > 0 ? 100 : 0);

    // Top Dividend Contributor
    const sortedByInr = [...aggregatedSchemes].sort((a, b) => b.total_amount_inr - a.total_amount_inr);
    const topPayer = sortedByInr.length > 0 ? sortedByInr[0] : null;

    return {
      totalInr,
      totalIndiaInr,
      totalUsUsd,
      totalUsConvertedInr,
      totalPayouts,
      activeEquityCost,
      portfolioYoCPct,
      currentYear,
      cyInr,
      pyInr,
      yoyGrowthPct,
      topPayer
    };
  }, [aggregatedSchemes, rawHistory, holdings]);

  // ─── 1. ANNUAL GROWTH DATA ──────────────────────────────────────────
  const annualGrowthData = useMemo(() => {
    if (!rawHistory || rawHistory.length === 0) return [];
    const yearMap = {};

    rawHistory.forEach(d => {
      const y = d.year;
      if (!y) return;
      if (!yearMap[y]) {
        yearMap[y] = {
          year: String(y),
          indiaInr: 0,
          usConvertedInr: 0,
          usUsd: 0,
          totalInr: 0,
          payoutsCount: 0
        };
      }
      const inrAmt = Number(d.amount_inr) || 0;
      const origAmt = Number(d.amount_original) || 0;
      if (d.currency === 'USD') {
        yearMap[y].usConvertedInr += inrAmt;
        yearMap[y].usUsd += origAmt;
      } else {
        yearMap[y].indiaInr += inrAmt;
      }
      yearMap[y].totalInr += inrAmt;
      yearMap[y].payoutsCount += 1;
    });

    const years = Object.keys(yearMap).sort((a, b) => Number(a) - Number(b));
    let prevTotal = 0;

    return years.map(y => {
      const item = yearMap[y];
      const growthPct = prevTotal > 0 ? Number((((item.totalInr - prevTotal) / prevTotal) * 100).toFixed(1)) : 0;
      prevTotal = item.totalInr;
      return {
        ...item,
        indiaInr: Math.round(item.indiaInr),
        usConvertedInr: Math.round(item.usConvertedInr),
        totalInr: Math.round(item.totalInr),
        growthPct
      };
    });
  }, [rawHistory]);

  // ─── 1.1. SELECTED YEAR MONTHLY DRILLDOWN DATA ──────────────────────
  const selectedYearMonthlyData = useMemo(() => {
    if (!selectedYear || !rawHistory || rawHistory.length === 0) return [];
    const yrNum = Number(selectedYear);
    const months = Array.from({ length: 12 }, (_, i) => ({
      monthIdx: i,
      monthName: MONTH_LABELS[i],
      indiaInr: 0,
      usConvertedInr: 0,
      usUsd: 0,
      totalInr: 0,
      payoutsCount: 0,
      color: MONTH_COLORS[i]
    }));

    rawHistory
      .filter(d => d.year === yrNum)
      .forEach(d => {
        const m = d.month;
        if (m >= 0 && m < 12) {
          const inrAmt = Number(d.amount_inr) || 0;
          const origAmt = Number(d.amount_original) || 0;
          if (d.currency === 'USD') {
            months[m].usConvertedInr += inrAmt;
            months[m].usUsd += origAmt;
          } else {
            months[m].indiaInr += inrAmt;
          }
          months[m].totalInr += inrAmt;
          months[m].payoutsCount += 1;
        }
      });

    return months.map(m => ({
      ...m,
      indiaInr: Math.round(m.indiaInr),
      usConvertedInr: Math.round(m.usConvertedInr),
      totalInr: Math.round(m.totalInr)
    }));
  }, [selectedYear, rawHistory]);

  // ─── 1.2. SELECTED YEAR PAYOUTS / DISTRIBUTION LEDGER ────────────────
  const selectedYearPayouts = useMemo(() => {
    if (!selectedYear || !rawHistory || rawHistory.length === 0) return [];
    const yrNum = Number(selectedYear);
    let list = rawHistory
      .filter(d => d.year === yrNum)
      .map(d => {
        const matchedScheme = aggregatedSchemes.find(s => 
          (d.holding_id && String(s.holding_id) === String(d.holding_id)) ||
          (d.symbol && s.symbol && s.symbol.toUpperCase() === d.symbol.toUpperCase())
        );
        const matchedHolding = (d.holding_id && holdingMap.byId[String(d.holding_id)]) ||
          (d.symbol && holdingMap.bySym[String(d.symbol).replace(/\.(NS|BO)$/i, '').toUpperCase().trim()]);
        
        return {
          ...d,
          matchedScheme: matchedScheme || null,
          matchedHolding: matchedHolding || null
        };
      });

    if (yearSearchQuery.trim()) {
      const q = yearSearchQuery.toLowerCase().trim();
      list = list.filter(d => 
        (d.clean_name || '').toLowerCase().includes(q) ||
        (d.symbol || '').toLowerCase().includes(q) ||
        (d.currency || '').toLowerCase().includes(q)
      );
    }

    if (yearTableSort.field) {
      list.sort((a, b) => {
        let valA = a[yearTableSort.field];
        let valB = b[yearTableSort.field];
        if (yearTableSort.field === 'name') {
          valA = (a.clean_name || a.symbol || '').toLowerCase();
          valB = (b.clean_name || b.symbol || '').toLowerCase();
          return yearTableSort.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        if (yearTableSort.field === 'date') {
          valA = a.isoDate || a.raw_date || '';
          valB = b.isoDate || b.raw_date || '';
          return yearTableSort.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        if (yearTableSort.field === 'amount_inr') {
          valA = Number(a.amount_inr) || 0;
          valB = Number(b.amount_inr) || 0;
        } else if (yearTableSort.field === 'amount_original') {
          valA = Number(a.amount_original) || 0;
          valB = Number(b.amount_original) || 0;
        }
        return yearTableSort.direction === 'asc' ? valA - valB : valB - valA;
      });
    }

    return list;
  }, [selectedYear, rawHistory, aggregatedSchemes, holdingMap, yearSearchQuery, yearTableSort]);

  const selectedYearTotals = useMemo(() => {
    if (!selectedYear || !rawHistory) return { totalInr: 0, indiaInr: 0, usUsd: 0, usConvertedInr: 0, count: 0 };
    const yrNum = Number(selectedYear);
    const yrRows = rawHistory.filter(d => d.year === yrNum);
    const totalInr = yrRows.reduce((sum, d) => sum + (Number(d.amount_inr) || 0), 0);
    const indiaInr = yrRows.filter(d => d.currency !== 'USD').reduce((sum, d) => sum + (Number(d.amount_inr) || 0), 0);
    const usUsd = yrRows.filter(d => d.currency === 'USD').reduce((sum, d) => sum + (Number(d.amount_original) || 0), 0);
    const usConvertedInr = yrRows.filter(d => d.currency === 'USD').reduce((sum, d) => sum + (Number(d.amount_inr) || 0), 0);
    return { totalInr, indiaInr, usUsd, usConvertedInr, count: yrRows.length };
  }, [selectedYear, rawHistory]);

  const handleYearSortClick = (field) => {
    setYearTableSort(prev => {
      if (prev.field === field) {
        return { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { field, direction: 'desc' };
    });
  };

  const renderYearSortIcon = (field) => {
    if (yearTableSort.field !== field) return <ArrowUpDown className="w-3 h-3 opacity-35 inline ml-1 shrink-0" />;
    return yearTableSort.direction === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-emerald-500 inline ml-1 shrink-0" /> 
      : <ArrowDown className="w-3 h-3 text-emerald-500 inline ml-1 shrink-0" />;
  };

  // ─── 2. MONTHLY SEASONALITY DATA ────────────────────────────────────
  const monthlySeasonalityData = useMemo(() => {
    if (!rawHistory || rawHistory.length === 0) return [];
    const months = Array.from({ length: 12 }, (_, i) => ({
      monthIdx: i,
      monthName: MONTH_LABELS[i],
      indiaInr: 0,
      usConvertedInr: 0,
      totalInr: 0,
      payoutsCount: 0,
      color: MONTH_COLORS[i]
    }));

    rawHistory.forEach(d => {
      const m = d.month;
      if (m >= 0 && m < 12) {
        const inrAmt = Number(d.amount_inr) || 0;
        if (d.currency === 'USD') {
          months[m].usConvertedInr += inrAmt;
        } else {
          months[m].indiaInr += inrAmt;
        }
        months[m].totalInr += inrAmt;
        months[m].payoutsCount += 1;
      }
    });

    const totalSum = months.reduce((sum, m) => sum + m.totalInr, 0);

    return months.map(m => ({
      ...m,
      indiaInr: Math.round(m.indiaInr),
      usConvertedInr: Math.round(m.usConvertedInr),
      totalInr: Math.round(m.totalInr),
      percentage: totalSum > 0 ? Number(((m.totalInr / totalSum) * 100).toFixed(1)) : 0
    }));
  }, [rawHistory]);

  // ─── 3. CUMULATIVE TRAJECTORY DATA ──────────────────────────────────
  const cumulativeTrajectoryData = useMemo(() => {
    if (!rawHistory || rawHistory.length === 0) return [];
    const sorted = [...rawHistory].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
    
    let runningTotal = 0;
    const dateMap = {};

    sorted.forEach(d => {
      const dt = d.isoDate;
      if (!dt) return;
      runningTotal += (Number(d.amount_inr) || 0);
      dateMap[dt] = {
        date: dt,
        displayDate: formatDateDDMMYYYY(dt),
        cumulativeInr: Math.round(runningTotal),
        lastPayout: Math.round(Number(d.amount_inr) || 0),
        asset: d.clean_name || d.symbol
      };
    });

    return Object.values(dateMap);
  }, [rawHistory]);

  // ─── 4. ASSET CONTRIBUTION DATA (Donut / Top 8 + Other) ─────────────
  const assetContributionData = useMemo(() => {
    if (!aggregatedSchemes || aggregatedSchemes.length === 0) return [];
    const sorted = [...aggregatedSchemes].sort((a, b) => b.total_amount_inr - a.total_amount_inr);
    const total = sorted.reduce((sum, s) => sum + s.total_amount_inr, 0);
    if (total === 0) return [];

    if (sorted.length <= 8) {
      return sorted.map((s, idx) => ({
        name: s.clean_name,
        symbol: s.symbol,
        value: Math.round(s.total_amount_inr),
        color: PALETTE[idx % PALETTE.length],
        percentage: Number(((s.total_amount_inr / total) * 100).toFixed(2)),
        currency: s.currency,
        payouts: s.payouts_count,
        scheme: s
      }));
    }

    const top8 = sorted.slice(0, 8).map((s, idx) => ({
      name: s.clean_name,
      symbol: s.symbol,
      value: Math.round(s.total_amount_inr),
      color: PALETTE[idx % PALETTE.length],
      percentage: Number(((s.total_amount_inr / total) * 100).toFixed(2)),
      currency: s.currency,
      payouts: s.payouts_count,
      scheme: s
    }));

    const others = sorted.slice(8);
    const otherVal = others.reduce((sum, s) => sum + s.total_amount_inr, 0);

    return [
      ...top8,
      {
        name: `Other (${others.length} stocks)`,
        symbol: 'OTHER',
        value: Math.round(otherVal),
        color: '#64748B',
        percentage: Number(((otherVal / total) * 100).toFixed(2)),
        currency: 'MIXED',
        payouts: others.reduce((sum, s) => sum + s.payouts_count, 0),
        isOther: true
      }
    ];
  }, [aggregatedSchemes]);

  // ─── 5. YIELD ON COST RANKED DATA ───────────────────────────────────
  const yieldOnCostData = useMemo(() => {
    return aggregatedSchemes
      .filter(s => s.investedCost > 0)
      .map(s => ({
        ...s,
        yieldPct: Number(((s.total_amount_inr / s.investedCost) * 100).toFixed(2))
      }))
      .sort((a, b) => b.yieldPct - a.yieldPct);
  }, [aggregatedSchemes]);

  // ─── 6. TABLE FILTERING & SORTING ───────────────────────────────────
  const handleSortClick = (field) => {
    setTableSort(prev => {
      if (prev.field === field) {
        return { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { field, direction: 'desc' };
    });
  };

  const renderSortIcon = (field) => {
    if (tableSort.field !== field) return <ArrowUpDown className="w-3 h-3 opacity-35 inline ml-1 shrink-0" />;
    return tableSort.direction === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-emerald-500 inline ml-1 shrink-0" /> 
      : <ArrowDown className="w-3 h-3 text-emerald-500 inline ml-1 shrink-0" />;
  };

  const filteredTableData = useMemo(() => {
    let list = [...aggregatedSchemes];

    if (marketFilter === 'IN') list = list.filter(s => s.currency !== 'USD');
    if (marketFilter === 'US') list = list.filter(s => s.currency === 'USD');

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(s => 
        (s.clean_name || '').toLowerCase().includes(q) ||
        (s.symbol || '').toLowerCase().includes(q) ||
        (s.currency || '').toLowerCase().includes(q)
      );
    }

    if (tableSort.field) {
      list.sort((a, b) => {
        let valA = a[tableSort.field];
        let valB = b[tableSort.field];
        if (tableSort.field === 'name') {
          valA = (a.clean_name || '').toLowerCase();
          valB = (b.clean_name || '').toLowerCase();
          return tableSort.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        if (tableSort.field === 'date') {
          valA = a.latest_raw_date || '';
          valB = b.latest_raw_date || '';
          return tableSort.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        if (tableSort.field === 'total_inr') {
          valA = a.total_amount_inr || 0;
          valB = b.total_amount_inr || 0;
        } else if (tableSort.field === 'total_orig') {
          valA = a.total_amount_original || 0;
          valB = b.total_amount_original || 0;
        } else if (tableSort.field === 'payouts') {
          valA = a.payouts_count || 0;
          valB = b.payouts_count || 0;
        } else if (tableSort.field === 'yoc') {
          valA = a.yocPct || 0;
          valB = b.yocPct || 0;
        } else if (tableSort.field === 'share') {
          valA = a.sharePct || 0;
          valB = b.sharePct || 0;
        }
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
        return tableSort.direction === 'asc' ? valA - valB : valB - valA;
      });
    }

    return list;
  }, [aggregatedSchemes, marketFilter, searchQuery, tableSort]);

  // Custom Chart Tooltip for Dividends
  const DividendCustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div className="reports-card p-3 rounded-xl shadow-2xl border border-inherit text-xs space-y-1.5 font-mono">
        <div className="font-sans font-bold text-slate-800 dark:text-slate-200 border-b border-inherit/60 pb-1 flex items-center justify-between gap-3">
          <span>{label}</span>
          {payload[0]?.payload?.growthPct !== undefined && payload[0].payload.growthPct !== 0 && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${payload[0].payload.growthPct > 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
              {payload[0].payload.growthPct > 0 ? '+' : ''}{payload[0].payload.growthPct}% YoY
            </span>
          )}
        </div>
        {payload.map((entry, idx) => (
          <div key={`tip-${idx}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 font-sans opacity-80" style={{ color: entry.color }}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
              {entry.name}:
            </span>
            <span className="font-bold text-emerald-500">
              {formatMoney(entry.value)}
            </span>
          </div>
        ))}
        {payload[0]?.payload?.totalInr && payload.length > 1 && (
          <div className="pt-1 border-t border-inherit/60 flex items-center justify-between font-bold">
            <span className="opacity-70 font-sans">Total Payout:</span>
            <span className="text-emerald-500">{formatMoney(payload[0].payload.totalInr)}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      
      {/* ─── Top KPI Metric Cards ───────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Total Dividends Earned */}
        <div className="reports-subcard p-4 rounded-2xl border relative overflow-hidden flex flex-col justify-between space-y-3">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider opacity-60 block">
              Total Dividends Received
            </span>
            <div className="text-xl sm:text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1 truncate">
              {formatMoney(kpis.totalInr)}
            </div>
          </div>
          <div className="pt-2 border-t border-inherit opacity-90 text-[11px] font-mono flex items-center justify-between">
            <span className="opacity-60">{kpis.totalPayouts} Payouts</span>
            <span className="text-emerald-500 font-bold">
              IN: {formatMoney(kpis.totalIndiaInr)} • US: {formatMoney(kpis.totalUsConvertedInr)}
            </span>
          </div>
        </div>

        {/* Card 2: Portfolio Dividend Yield on Cost */}
        <div className="reports-subcard p-4 rounded-2xl border relative overflow-hidden flex flex-col justify-between space-y-3">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider opacity-60 block">
              Dividend Yield on Cost
            </span>
            <div className="text-xl sm:text-2xl font-black font-mono text-blue-600 dark:text-blue-400 mt-1 truncate">
              {kpis.portfolioYoCPct.toFixed(2)}%
            </div>
          </div>
          <div className="pt-2 border-t border-inherit opacity-90 text-[11px] font-mono flex items-center justify-between">
            <span className="opacity-60">Equity Basis</span>
            <span className="font-bold opacity-90">{formatMoney(kpis.activeEquityCost)}</span>
          </div>
        </div>

        {/* Card 3: Current Year Dividends & YoY Growth */}
        <div className="reports-subcard p-4 rounded-2xl border relative overflow-hidden flex flex-col justify-between space-y-3">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider opacity-60 block">
              {kpis.currentYear} Dividends (CYTD)
            </span>
            <div className="text-xl sm:text-2xl font-black font-mono text-amber-500 mt-1 truncate">
              {formatMoney(kpis.cyInr)}
            </div>
          </div>
          <div className="pt-2 border-t border-inherit opacity-90 text-[11px] font-mono flex items-center justify-between">
            <span className="opacity-60">YoY Change</span>
            <span className={`font-bold ${kpis.yoyGrowthPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              {kpis.yoyGrowthPct >= 0 ? '+' : ''}{kpis.yoyGrowthPct.toFixed(1)}% vs {kpis.currentYear - 1}
            </span>
          </div>
        </div>

        {/* Card 4: Top Dividend Contributor */}
        <div className="reports-subcard p-4 rounded-2xl border relative overflow-hidden flex flex-col justify-between space-y-3">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider opacity-60 block">
              Top Dividend Contributor
            </span>
            <div className="text-xl sm:text-2xl font-black font-mono text-purple-600 dark:text-purple-400 mt-1 truncate">
              {kpis.topPayer?.clean_name || '—'}
            </div>
          </div>
          <div className="pt-2 border-t border-inherit opacity-90 text-[11px] font-mono flex items-center justify-between">
            <span className="opacity-60">{kpis.topPayer ? `${kpis.topPayer.sharePct}% of Total` : '—'}</span>
            <span className="font-bold text-emerald-500">
              {kpis.topPayer ? formatMoney(kpis.topPayer.total_amount_inr) : '—'}
            </span>
          </div>
        </div>

      </div>

      {/* ─── Sub-Tab Navigation Bar ─────────────────────────────────── */}
      <div className="flex items-center gap-1.5 border-b border-inherit opacity-95 pb-3">
        {[
          { key: 'GROWTH', label: 'Payouts & Growth', icon: TrendingUp },
          { key: 'CONTRIBUTION', label: 'Asset Contribution', icon: PieIcon },
          { key: 'YIELD', label: 'Yield on Cost', icon: Percent },
          { key: 'LEDGER', label: 'Distribution Ledger', icon: Layers }
        ].map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => {
                setSubTab(tab.key);
                setSelectedYear(null);
              }}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-black transition-all shrink-0 cursor-pointer ${
                subTab === tab.key
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 shadow-sm'
                  : 'opacity-70 hover:opacity-100 hover:bg-slate-500/10'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ─── TAB 1: PAYOUTS & GROWTH ────────────────────────────────── */}
      {subTab === 'GROWTH' && (
        <div className="space-y-4">
          {/* Chart Header & Mode Toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2.5">
              {growthMode === 'ANNUAL' && selectedYear ? (
                <button
                  onClick={() => setSelectedYear(null)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-black bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 transition-all cursor-pointer shadow-sm group"
                >
                  <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
                  <span>All Years</span>
                </button>
              ) : null}
              <span className="text-xs font-black uppercase tracking-wider opacity-60">
                {growthMode === 'ANNUAL' 
                  ? (selectedYear ? `${selectedYear} Monthly Payout Breakdown` : 'Year-over-Year Payout Growth (Click bar to expand)') 
                  : growthMode === 'MONTHLY' 
                    ? 'Monthly Seasonality Distribution' 
                    : 'Cumulative Dividend Trajectory'}
              </span>
            </div>
            <div className="flex items-center gap-1 reports-pill p-1 rounded-2xl shrink-0">
              {[
                { key: 'ANNUAL', label: 'Annual Growth' },
                { key: 'MONTHLY', label: 'Monthly Seasonality' },
                { key: 'CUMULATIVE', label: 'Cumulative Timeline' }
              ].map(m => (
                <button
                  key={m.key}
                  onClick={() => {
                    setGrowthMode(m.key);
                    setSelectedYear(null);
                  }}
                  className={`px-3 py-1 rounded-xl text-xs font-black transition-all cursor-pointer ${
                    growthMode === m.key
                      ? 'bg-emerald-500 text-slate-950 shadow-sm'
                      : 'opacity-70 hover:opacity-100'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* 1.1 Multi-Year Annual Growth (Default Overview) */}
          {growthMode === 'ANNUAL' && !selectedYear && (
            <div className="space-y-4">
              <div className="h-[360px] w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ReBarChart 
                    data={annualGrowthData} 
                    margin={{ top: 20, right: 20, left: 10, bottom: 5 }}
                    onClick={(state) => {
                      if (state?.activeLabel) {
                        setSelectedYear(String(state.activeLabel));
                      } else if (state?.activePayload?.[0]?.payload?.year) {
                        setSelectedYear(String(state.activePayload[0].payload.year));
                      }
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#94A3B822" vertical={false} />
                    <XAxis dataKey="year" stroke="#64748B" tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 700 }} />
                    <YAxis 
                      stroke="#64748B" 
                      tick={{ fill: 'currentColor', fontSize: 10 }} 
                      tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} 
                    />
                    <Tooltip content={<DividendCustomTooltip />} />
                    <Legend 
                      verticalAlign="top" 
                      align="right" 
                      wrapperStyle={{ paddingBottom: '10px', fontSize: '11px', fontWeight: 'bold' }} 
                    />
                    <Bar 
                      dataKey="indiaInr" 
                      name="Indian Stocks (INR)" 
                      stackId="a" 
                      fill="#10B981" 
                      radius={[0, 0, 4, 4]} 
                      isAnimationActive={false} 
                      className="cursor-pointer"
                      onClick={(entry) => entry?.year && setSelectedYear(String(entry.year))}
                    />
                    <Bar 
                      dataKey="usConvertedInr" 
                      name="US Stocks (Converted INR)" 
                      stackId="a" 
                      fill="#A855F7" 
                      radius={[4, 4, 0, 0]} 
                      isAnimationActive={false} 
                      className="cursor-pointer"
                      onClick={(entry) => entry?.year && setSelectedYear(String(entry.year))}
                    />
                  </ReBarChart>
                </ResponsiveContainer>
              </div>

              {/* Annual Summary Mini Grid with Clickable Year Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 pt-2">
                {annualGrowthData.map(y => (
                  <div 
                    key={`annual-${y.year}`} 
                    onClick={() => setSelectedYear(String(y.year))}
                    className="reports-subcard p-3 rounded-xl border space-y-1 cursor-pointer hover:border-emerald-500 hover:scale-[1.02] transition-all group"
                  >
                    <div className="text-[10px] font-bold opacity-60 flex items-center justify-between">
                      <span className="group-hover:text-emerald-500 transition-colors font-mono">{y.year}</span>
                      {y.growthPct !== 0 && (
                        <span className={`text-[9px] font-bold ${y.growthPct > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                          {y.growthPct > 0 ? '+' : ''}{y.growthPct}%
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-black font-mono text-emerald-600 dark:text-emerald-400">
                      {formatMoney(y.totalInr)}
                    </div>
                    <div className="text-[9.5px] font-mono opacity-50 flex items-center justify-between">
                      <span>{y.payoutsCount} Payouts</span>
                      <span className="text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-bold">Expand →</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 1.2 Expanded Monthly Breakdown & Company Distribution Table for Selected Year */}
          {growthMode === 'ANNUAL' && selectedYear && (
            <div className="space-y-5">
              {/* Year Summary Bar */}
              <div className="reports-subcard p-3 sm:p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSelectedYear(null)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 transition-all cursor-pointer shadow-sm group"
                  >
                    <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
                    <span>Back to All Years</span>
                  </button>
                  <div className="h-4 w-px bg-inherit opacity-40 hidden sm:block" />
                  <div className="text-sm sm:text-base font-black font-mono">
                    {selectedYear} Performance
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono font-bold">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    Total: {formatMoney(selectedYearTotals.totalInr)}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-500/10 opacity-80 border border-inherit">
                    {selectedYearTotals.count} Payouts
                  </span>
                  {selectedYearTotals.indiaInr > 0 && (
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border border-inherit">
                      IN: {formatMoney(selectedYearTotals.indiaInr)}
                    </span>
                  )}
                  {selectedYearTotals.usConvertedInr > 0 && (
                    <span className="px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                      US: {formatMoney(selectedYearTotals.usConvertedInr)}
                    </span>
                  )}
                </div>
              </div>

              {/* Monthly Division Bar Chart at the exact same place */}
              <div className="space-y-3">
                <div className="h-[340px] w-full pt-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <ReBarChart data={selectedYearMonthlyData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#94A3B822" vertical={false} />
                      <XAxis dataKey="monthName" stroke="#64748B" tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 700 }} />
                      <YAxis 
                        stroke="#64748B" 
                        tick={{ fill: 'currentColor', fontSize: 10 }} 
                        tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} 
                      />
                      <Tooltip content={<DividendCustomTooltip />} />
                      <Legend 
                        verticalAlign="top" 
                        align="right" 
                        wrapperStyle={{ paddingBottom: '10px', fontSize: '11px', fontWeight: 'bold' }} 
                      />
                      <Bar 
                        dataKey="indiaInr" 
                        name="Indian Stocks (INR)" 
                        stackId="a" 
                        fill="#10B981" 
                        radius={[0, 0, 4, 4]} 
                        isAnimationActive={false} 
                      />
                      <Bar 
                        dataKey="usConvertedInr" 
                        name="US Stocks (Converted INR)" 
                        stackId="a" 
                        fill="#A855F7" 
                        radius={[4, 4, 0, 0]} 
                        isAnimationActive={false} 
                      />
                    </ReBarChart>
                  </ResponsiveContainer>
                </div>

                {/* 12-Month Calendar Grid for Selected Year */}
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 pt-1">
                  {selectedYearMonthlyData.map(m => (
                    <div key={`yr-month-${m.monthIdx}`} className={`reports-subcard p-2.5 rounded-xl border space-y-1 ${m.totalInr > 0 ? 'border-emerald-500/30' : 'opacity-60'}`}>
                      <div className="flex items-center justify-between text-[10px] font-bold opacity-75">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
                          {m.monthName}
                        </span>
                        <span className="font-mono text-xs opacity-60">{m.payoutsCount > 0 ? `${m.payoutsCount} payouts` : '—'}</span>
                      </div>
                      <div className="text-xs font-black font-mono text-emerald-600 dark:text-emerald-400">
                        {m.totalInr > 0 ? formatMoney(m.totalInr) : '₹0'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Company Distributions Table for Selected Year */}
              <div className="space-y-3 pt-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-wider opacity-70">
                      {selectedYear} Dividend Distributions
                    </span>
                    <span className="text-[11px] font-mono opacity-50">
                      ({selectedYearPayouts.length} Payments)
                    </span>
                  </div>

                  {/* Search input */}
                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 opacity-50 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder={`Search ${selectedYear} companies...`}
                      value={yearSearchQuery}
                      onChange={(e) => setYearSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-8 py-1.5 rounded-xl text-xs bg-slate-900/60 border border-inherit opacity-90 focus:opacity-100 outline-none focus:border-emerald-500 font-medium"
                    />
                    {yearSearchQuery && (
                      <button 
                        onClick={() => setYearSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 p-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto overflow-y-auto max-h-[440px] rounded-2xl reports-table-container relative custom-scrollbar border border-inherit/40">
                  <table className="w-full text-left text-xs border-collapse min-w-[750px]">
                    <thead className="sticky top-0 z-30 reports-table-head shadow-sm select-none">
                      <tr className="reports-table-head font-bold uppercase text-[10px] select-none">
                        <th 
                          onClick={() => handleYearSortClick('name')} 
                          className="sticky left-0 top-0 z-40 reports-table-sticky-head py-3 pl-4 pr-3.5 cursor-pointer hover:text-emerald-500 transition-colors whitespace-nowrap border-r border-inherit"
                        >
                          Company / Asset {renderYearSortIcon('name')}
                        </th>
                        <th 
                          onClick={() => handleYearSortClick('date')} 
                          className="py-3 px-3.5 text-center cursor-pointer hover:text-emerald-500 transition-colors whitespace-nowrap"
                        >
                          Payment Date {renderYearSortIcon('date')}
                        </th>
                        <th 
                          onClick={() => handleYearSortClick('amount_original')} 
                          className="py-3 px-3.5 text-right cursor-pointer hover:text-emerald-500 transition-colors whitespace-nowrap"
                        >
                          Original Payout {renderYearSortIcon('amount_original')}
                        </th>
                        <th 
                          onClick={() => handleYearSortClick('amount_inr')} 
                          className="py-3 px-3.5 text-right cursor-pointer hover:text-emerald-500 transition-colors whitespace-nowrap"
                        >
                          Credited INR {renderYearSortIcon('amount_inr')}
                        </th>
                        <th className="py-3 pr-4 pl-3.5 text-center whitespace-nowrap">
                          Market
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-inherit/20 font-medium">
                      {selectedYearPayouts.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center opacity-60 font-medium">
                            No dividend payouts found for this query.
                          </td>
                        </tr>
                      ) : (
                        selectedYearPayouts.map((row, idx) => (
                          <tr
                            key={`yr-row-${row.id || idx}`}
                            onClick={() => {
                              if (row.matchedScheme) setSelectedAsset(row.matchedScheme);
                            }}
                            className="hover:bg-slate-500/10 transition-colors cursor-pointer group"
                          >
                            <td className="sticky left-0 z-20 reports-table-sticky-cell py-2.5 pl-4 pr-3.5 border-r border-inherit">
                              <div className="flex items-center gap-2.5">
                                <div className="w-6 h-6 rounded-lg overflow-hidden shrink-0 border border-inherit/40 bg-slate-800/40 flex items-center justify-center">
                                  <HoldingLogo holding={row.matchedHolding || { symbol: row.symbol, name: row.clean_name }} />
                                </div>
                                <div className="min-w-0">
                                  <div className="font-bold truncate text-xs group-hover:text-emerald-500 transition-colors">
                                    {row.clean_name || row.asset_name || row.symbol}
                                  </div>
                                  <div className="text-[10px] font-mono opacity-50 flex items-center gap-1.5">
                                    <span>{row.symbol}</span>
                                    {row.notes && <span className="opacity-75">• {row.notes}</span>}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-3.5 text-center font-mono text-xs opacity-80 whitespace-nowrap">
                              {formatDateDDMMYYYY(row.isoDate || row.raw_date || row.payment_date)}
                            </td>
                            <td className="py-2.5 px-3.5 text-right font-mono text-xs whitespace-nowrap opacity-80">
                              {row.currency === 'USD' ? `$${(Number(row.amount_original) || 0).toFixed(2)}` : formatMoney(row.amount_original || row.amount_inr)}
                            </td>
                            <td className="py-2.5 px-3.5 text-right font-mono text-xs font-black text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                              {formatMoney(row.amount_inr)}
                            </td>
                            <td className="py-2.5 pr-4 pl-3.5 text-center whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9.5px] font-black tracking-wider uppercase ${
                                row.currency === 'USD' ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30' : 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                              }`}>
                                {row.currency === 'USD' ? `US ($1 = ₹${row.fx_rate || 95.8})` : 'IN (NSE/BSE)'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {growthMode === 'MONTHLY' && (
            <div className="space-y-3">
              <div className="h-[360px] w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ReBarChart data={monthlySeasonalityData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94A3B822" vertical={false} />
                    <XAxis dataKey="monthName" stroke="#64748B" tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 700 }} />
                    <YAxis 
                      stroke="#64748B" 
                      tick={{ fill: 'currentColor', fontSize: 10 }} 
                      tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} 
                    />
                    <Tooltip content={<DividendCustomTooltip />} />
                    <Bar 
                      dataKey="totalInr" 
                      name="Historical Total" 
                      radius={[6, 6, 0, 0]} 
                      isAnimationActive={false}
                    >
                      {monthlySeasonalityData.map((entry, index) => (
                        <Cell key={`cell-m-${index}`} fill={entry.color || '#10B981'} />
                      ))}
                    </Bar>
                  </ReBarChart>
                </ResponsiveContainer>
              </div>

              {/* 12-Month Calendar Matrix */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 pt-2">
                {monthlySeasonalityData.map(m => (
                  <div key={`month-${m.monthIdx}`} className="reports-subcard p-2.5 rounded-xl border space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-bold opacity-75">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.color }} />
                        {m.monthName}
                      </span>
                      <span className="font-mono text-emerald-500 font-extrabold">{m.percentage}%</span>
                    </div>
                    <div className="text-xs font-black font-mono text-emerald-600 dark:text-emerald-400">
                      {formatMoney(m.totalInr)}
                    </div>
                    <div className="text-[9px] font-mono opacity-50">
                      {m.payoutsCount} Payouts
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {growthMode === 'CUMULATIVE' && (
            <div className="space-y-3">
              <div className="h-[360px] w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cumulativeTrajectoryData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                    <defs>
                      <linearGradient id="divCumGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94A3B822" vertical={false} />
                    <XAxis 
                      dataKey="displayDate" 
                      stroke="#64748B" 
                      tick={{ fill: 'currentColor', fontSize: 10 }} 
                    />
                    <YAxis 
                      stroke="#64748B" 
                      tick={{ fill: 'currentColor', fontSize: 10 }} 
                      tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} 
                    />
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const pt = payload[0].payload;
                        return (
                          <div className="reports-card p-3 rounded-xl shadow-2xl border border-inherit text-xs space-y-1 font-mono">
                            <div className="font-sans font-bold text-slate-800 dark:text-slate-200 border-b border-inherit/60 pb-1">
                              {pt.displayDate}
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="opacity-70 font-sans">Cumulative:</span>
                              <span className="font-bold text-emerald-500">{formatMoney(pt.cumulativeInr)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 text-[10px] opacity-75">
                              <span>Asset:</span>
                              <span>{pt.asset} (+{formatMoney(pt.lastPayout)})</span>
                            </div>
                          </div>
                        );
                      }} 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="cumulativeInr" 
                      name="Cumulative Dividends" 
                      stroke="#10B981" 
                      strokeWidth={2.5} 
                      fillOpacity={1} 
                      fill="url(#divCumGrad)" 
                      isAnimationActive={false} 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 2: ASSET CONTRIBUTION ──────────────────────────────── */}
      {subTab === 'CONTRIBUTION' && (
        <div className="space-y-4">
          {/* Chart Header & Style Switcher */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
            <div className="text-xs font-black uppercase tracking-wider opacity-60">
              Dividend Share by Asset
            </div>
            <div className="flex items-center gap-1 reports-pill p-1 rounded-2xl shrink-0">
              <button
                onClick={() => setContribStyle('PIE')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  contribStyle === 'PIE'
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'opacity-70 hover:opacity-100'
                }`}
              >
                <PieIcon className="w-3.5 h-3.5" />
                <span>Donut</span>
              </button>
              <button
                onClick={() => setContribStyle('BAR')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  contribStyle === 'BAR'
                    ? 'bg-emerald-500 text-slate-950 shadow-sm'
                    : 'opacity-70 hover:opacity-100'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                <span>Bar Chart</span>
              </button>
            </div>
          </div>
          {contribStyle === 'PIE' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              <div className="lg:col-span-7 h-[360px] w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie
                      data={assetContributionData}
                      cx="50%"
                      cy="50%"
                      innerRadius={80}
                      outerRadius={135}
                      paddingAngle={3}
                      dataKey="value"
                      isAnimationActive={false}
                      onClick={(_, idx) => {
                        const item = assetContributionData[idx];
                        if (item?.scheme) setSelectedAsset(item.scheme);
                      }}
                    >
                      {assetContributionData.map((entry, index) => {
                        const isSelected = activePieIndex === index;
                        const color = entry.color;
                        return (
                          <Cell 
                            key={`div-cell-${index}`} 
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
                    <Tooltip 
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const item = payload[0].payload;
                        return (
                          <div className="reports-card p-3 rounded-xl shadow-2xl border border-inherit text-xs space-y-1 font-mono">
                            <div className="font-sans font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                              <span>{item.name}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span className="opacity-70 font-sans">Payout:</span>
                              <span className="font-bold text-emerald-500">{formatMoney(item.value)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 text-[10px] opacity-75">
                              <span>Share of Total:</span>
                              <span>{item.percentage}%</span>
                            </div>
                          </div>
                        );
                      }} 
                    />
                  </RePieChart>
                </ResponsiveContainer>
              </div>

              {/* Ranked Side List */}
              <div className="lg:col-span-5 max-h-[380px] overflow-y-auto p-1.5 custom-scrollbar space-y-2">
                {assetContributionData.map((item, idx) => (
                  <div
                    key={`contrib-${idx}`}
                    onMouseEnter={() => setActivePieIndex(idx)}
                    onMouseLeave={() => setActivePieIndex(null)}
                    onClick={() => item.scheme && setSelectedAsset(item.scheme)}
                    className={`reports-subcard p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      activePieIndex === idx ? 'border-emerald-500 shadow-md scale-[1.01]' : 'hover:border-inherit'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <div className="min-w-0">
                        <div className="font-bold text-xs truncate">{item.name}</div>
                        <div className="text-[10px] font-mono opacity-50">{item.symbol} • {item.payouts} Payouts</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 font-mono">
                      <div className="text-xs font-black text-emerald-600 dark:text-emerald-400">{formatMoney(item.value)}</div>
                      <div className="text-[10px] font-bold opacity-60">{item.percentage}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {contribStyle === 'BAR' && (
            <div className="h-[420px] w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ReBarChart 
                  data={assetContributionData} 
                  layout="vertical" 
                  margin={{ top: 10, right: 30, left: 80, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#94A3B822" horizontal={false} />
                  <XAxis 
                    type="number" 
                    stroke="#64748B" 
                    tick={{ fill: 'currentColor', fontSize: 10 }} 
                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} 
                  />
                  <YAxis 
                    type="category" 
                    dataKey="name" 
                    stroke="#64748B" 
                    tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 700 }} 
                    width={110} 
                  />
                  <Tooltip content={<DividendCustomTooltip />} />
                  <Bar 
                    dataKey="value" 
                    name="Dividend Payout" 
                    radius={[0, 6, 6, 0]} 
                    isAnimationActive={false}
                    onClick={(entry) => entry?.scheme && setSelectedAsset(entry.scheme)}
                  >
                    {assetContributionData.map((entry, index) => (
                      <Cell key={`bar-cell-${index}`} fill={entry.color || '#10B981'} className="cursor-pointer" />
                    ))}
                  </Bar>
                </ReBarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* ─── TAB 3: YIELD ON COST ───────────────────────────────────── */}
      {subTab === 'YIELD' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
            <div className="text-xs font-black uppercase tracking-wider opacity-60">
              Historical Dividend Yield on Cost (Ranked)
            </div>
            <div className="text-[11px] font-mono opacity-60">
              {yieldOnCostData.length} Assets
            </div>
          </div>
          <div className="h-[420px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <ReBarChart 
                data={yieldOnCostData} 
                layout="vertical" 
                margin={{ top: 10, right: 40, left: 90, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#94A3B822" horizontal={false} />
                <XAxis 
                  type="number" 
                  stroke="#64748B" 
                  tick={{ fill: 'currentColor', fontSize: 10 }} 
                  tickFormatter={(v) => `${v}%`} 
                />
                <YAxis 
                  type="category" 
                  dataKey="clean_name" 
                  stroke="#64748B" 
                  tick={{ fill: 'currentColor', fontSize: 11, fontWeight: 700 }} 
                  width={120} 
                />
                <Tooltip 
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const item = payload[0].payload;
                    return (
                      <div className="reports-card p-3 rounded-xl shadow-2xl border border-inherit text-xs space-y-1 font-mono">
                        <div className="font-sans font-bold text-slate-800 dark:text-slate-200">
                          {item.clean_name} ({item.symbol})
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="opacity-70 font-sans">Yield on Cost:</span>
                          <span className="font-bold text-emerald-500">{item.yieldPct}%</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-[10px] opacity-75">
                          <span>Total Dividends:</span>
                          <span>{formatMoney(item.total_amount_inr)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 text-[10px] opacity-75">
                          <span>Invested Capital:</span>
                          <span>{formatMoney(item.investedCost)}</span>
                        </div>
                      </div>
                    );
                  }} 
                />
                <Bar 
                  dataKey="yieldPct" 
                  name="Yield on Cost %" 
                  fill="#3B82F6" 
                  radius={[0, 6, 6, 0]} 
                  isAnimationActive={false}
                  onClick={(entry) => setSelectedAsset(entry)}
                >
                  {yieldOnCostData.map((entry, index) => (
                    <Cell 
                      key={`yoc-cell-${index}`} 
                      fill={entry.yieldPct > 10 ? '#10B981' : (entry.yieldPct > 5 ? '#3B82F6' : '#8B5CF6')} 
                      className="cursor-pointer"
                    />
                  ))}
                </Bar>
              </ReBarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ─── TAB 4: DISTRIBUTION LEDGER ─────────────────────────────── */}
      {subTab === 'LEDGER' && (
        <div className="space-y-3">
          
          {/* Search and Market Filter Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 opacity-50 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search stocks, symbols..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-10 py-1.5 rounded-xl text-xs bg-slate-900/60 border border-inherit opacity-90 focus:opacity-100 outline-none focus:border-emerald-500 font-medium"
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100 p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 reports-pill p-1 rounded-2xl">
                {[
                  { key: 'ALL', label: 'All Markets' },
                  { key: 'IN', label: 'Indian Stocks' },
                  { key: 'US', label: 'US Equities' }
                ].map(m => (
                  <button
                    key={m.key}
                    onClick={() => setMarketFilter(m.key)}
                    className={`px-3 py-1 rounded-xl text-xs font-black transition-all cursor-pointer ${
                      marketFilter === m.key
                        ? 'bg-emerald-500 text-slate-950 shadow-sm'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div className="text-[11px] font-mono opacity-60 hidden sm:block">
                {filteredTableData.length} Assets
              </div>
            </div>
          </div>

          {/* Table Container */}
          <div className="overflow-x-auto overflow-y-auto max-h-[580px] rounded-2xl reports-table-container relative custom-scrollbar">
            <table className="w-full text-left text-xs border-collapse min-w-[900px]">
              <thead className="sticky top-0 z-30 reports-table-head shadow-sm select-none">
                <tr className="reports-table-head font-bold uppercase text-[10px] select-none">
                  <th 
                    onClick={() => handleSortClick('name')} 
                    className="sticky left-0 top-0 z-40 reports-table-sticky-head py-3.5 pl-4 pr-3.5 cursor-pointer hover:text-emerald-500 transition-colors whitespace-nowrap border-r border-inherit"
                  >
                    Stock / Asset {renderSortIcon('name')}
                  </th>
                  <th 
                    onClick={() => handleSortClick('payouts')} 
                    className="py-3.5 px-3.5 text-center cursor-pointer hover:text-emerald-500 transition-colors whitespace-nowrap"
                  >
                    Payouts {renderSortIcon('payouts')}
                  </th>
                  <th 
                    onClick={() => handleSortClick('total_orig')} 
                    className="py-3.5 px-3.5 text-right cursor-pointer hover:text-emerald-500 transition-colors whitespace-nowrap"
                  >
                    Original Payout {renderSortIcon('total_orig')}
                  </th>
                  <th 
                    onClick={() => handleSortClick('total_inr')} 
                    className="py-3.5 px-3.5 text-right cursor-pointer hover:text-emerald-500 transition-colors whitespace-nowrap"
                  >
                    Total Value (INR) {renderSortIcon('total_inr')}
                  </th>
                  <th 
                    onClick={() => handleSortClick('share')} 
                    className="py-3.5 px-3.5 text-right cursor-pointer hover:text-emerald-500 transition-colors whitespace-nowrap"
                  >
                    Share % {renderSortIcon('share')}
                  </th>
                  <th 
                    onClick={() => handleSortClick('yoc')} 
                    className="py-3.5 px-3.5 text-right cursor-pointer hover:text-emerald-500 transition-colors whitespace-nowrap"
                  >
                    Yield on Cost {renderSortIcon('yoc')}
                  </th>
                  <th 
                    onClick={() => handleSortClick('date')} 
                    className="py-3.5 pl-3.5 pr-4 text-right cursor-pointer hover:text-emerald-500 transition-colors whitespace-nowrap"
                  >
                    Latest Payout {renderSortIcon('date')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-inherit font-mono">
                {filteredTableData.map((scheme, idx) => (
                  <tr 
                    key={`tbl-${scheme.id || idx}`} 
                    onClick={() => setSelectedAsset(scheme)}
                    className="reports-table-row transition-colors cursor-pointer group"
                  >
                    <td className="sticky left-0 z-20 reports-table-sticky-cell py-3 pl-4 pr-3.5 whitespace-nowrap border-r border-inherit">
                      <div className="flex items-center gap-2.5">
                        <HoldingLogo symbol={scheme.symbol} name={scheme.clean_name} className="w-6 h-6 rounded-lg text-[10px]" />
                        <div>
                          <div className="font-sans font-bold group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                            <span>{scheme.clean_name}</span>
                            <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                          </div>
                          <div className="text-[10px] opacity-60 flex items-center gap-1.5">
                            <span>{scheme.symbol}</span>
                            <span className="px-1 py-0.2 rounded bg-slate-500/10 text-[9px]">
                              {scheme.currency === 'USD' ? 'US' : 'IN'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3.5 text-center opacity-80 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-full reports-subcard text-[10px] font-bold">
                        {scheme.payouts_count}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 text-right opacity-80 whitespace-nowrap">
                      {scheme.currency === 'USD' 
                        ? `$${scheme.total_amount_original.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                        : formatMoney(scheme.total_amount_original)}
                    </td>
                    <td className="py-3 px-3.5 text-right text-emerald-600 dark:text-emerald-400 font-bold whitespace-nowrap">
                      {formatMoney(scheme.total_amount_inr)}
                    </td>
                    <td className="py-3 px-3.5 text-right opacity-80 font-bold whitespace-nowrap">
                      {scheme.sharePct}%
                    </td>
                    <td className="py-3 px-3.5 text-right whitespace-nowrap">
                      {scheme.yocPct > 0 ? (
                        <span className={`font-bold ${scheme.yocPct > 10 ? 'text-emerald-500' : 'text-blue-500'}`}>
                          {scheme.yocPct}%
                        </span>
                      ) : (
                        <span className="opacity-40">—</span>
                      )}
                    </td>
                    <td className="py-3 pl-3.5 pr-4 text-right opacity-80 whitespace-nowrap">
                      {formatDateDDMMYYYY(scheme.latest_payment_date || scheme.latest_raw_date)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── MODAL DRILLDOWN ────────────────────────────────────────── */}
      {selectedAsset && (
        <AssetDividendDetailModal
          isOpen={Boolean(selectedAsset)}
          onClose={() => setSelectedAsset(null)}
          asset={selectedAsset}
          dividendsHistory={dividendData?.history || []}
          holding={selectedAsset.holding}
          onRefresh={fetchDividends}
        />
      )}

    </div>
  );
}
