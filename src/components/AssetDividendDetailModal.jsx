import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { 
  X, Coins, Calendar, TrendingUp, BarChart2, DollarSign, 
  Globe, Percent, Plus, ArrowUpRight, Clock, Search, ArrowUpDown, ArrowUp, ArrowDown,
  Edit3, Trash2, Save, XCircle, Check, ChevronDown
} from 'lucide-react';
import { 
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, Cell, Legend, LabelList 
} from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import HoldingLogo from './HoldingLogo';
import formatDateDDMMYYYY from '../utils/dateFormatter';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Soothing pastel palette with eye-friendly contrast in light and dark modes
const MONTH_COLORS = [
  '#93c5fd', // Jan - Soft Sky Blue
  '#67e8f9', // Feb - Soft Cyan
  '#6ee7b7', // Mar - Soft Mint Emerald
  '#86efac', // Apr - Soft Sage Green
  '#bef264', // May - Soft Lime
  '#fde047', // Jun - Soft Warm Yellow
  '#fdba74', // Jul - Soft Peach Apricot
  '#fca5a5', // Aug - Soft Coral Rose
  '#f9a8d4', // Sep - Soft Pastel Rose
  '#f0abfc', // Oct - Soft Lilac
  '#d8b4fe', // Nov - Soft Lavender
  '#a5b4fc', // Dec - Soft Periwinkle
];

// Badge component inside each month segment of the stacked bar
const MonthSegmentLabel = (props) => {
  const { x, y, width, height, value, monthName, isLight } = props;
  if (!value || height < 14 || width < 22) return null;

  const pillWidth = Math.min(width - 6, 34);
  const pillHeight = Math.min(height - 4, 15);
  const pillX = x + (width - pillWidth) / 2;
  const pillY = y + (height - pillHeight) / 2;

  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect
        x={pillX}
        y={pillY}
        width={pillWidth}
        height={pillHeight}
        rx={4}
        ry={4}
        fill={isLight ? '#ffffff' : '#0f172a'}
        stroke={isLight ? '#94a3b8' : '#334155'}
        strokeWidth={1}
      />
      <text
        x={pillX + pillWidth / 2}
        y={pillY + pillHeight / 2 + 3.5}
        textAnchor="middle"
        fill={isLight ? '#0f172a' : '#f8fafc'}
        fontSize={9}
        fontWeight={900}
        fontFamily="ui-monospace, monospace"
      >
        {monthName}
      </text>
    </g>
  );
};

// Total value label rendered at the top of the accumulated bar (Complete un-abbreviated value)
const TopTotalLabel = (props) => {
  const { x, y, width, index, data, isDisplayUSD, isLight } = props;
  const row = data?.[index];
  if (!row || (!row.totalDisplay && row.totalDisplay !== 0)) return null;

  const val = Number(row.totalDisplay) || 0;
  const formatted = isDisplayUSD
    ? `$${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <text
      x={x + width / 2}
      y={y - 8}
      textAnchor="middle"
      fill={isLight ? '#0f172a' : '#ffffff'}
      fontSize={11.5}
      fontWeight={900}
      fontFamily="ui-monospace, monospace"
      style={{ pointerEvents: 'none' }}
    >
      {formatted}
    </text>
  );
};

function extractDateParts(dateStr) {
  if (!dateStr) return { year: 'Unknown', month: 0, monthName: 'Unknown', fullDate: '' };
  const str = String(dateStr).trim();
  // If YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const parts = str.split('-');
    const year = parts[0];
    const month = parseInt(parts[1], 10);
    return { 
      year, 
      month, 
      monthName: MONTH_NAMES[month - 1] || 'Unknown', 
      fullDate: str.slice(0, 10) 
    };
  }
  // If DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}/.test(str)) {
    const parts = str.split('-');
    const year = parts[2];
    const month = parseInt(parts[1], 10);
    const fullDate = `${year}-${parts[1]}-${parts[0]}`;
    return { 
      year, 
      month, 
      monthName: MONTH_NAMES[month - 1] || 'Unknown', 
      fullDate 
    };
  }
  // Date object or ISO fallback
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const year = String(d.getFullYear());
    const month = d.getMonth() + 1;
    const monthStr = String(month).padStart(2, '0');
    const dayStr = String(d.getDate()).padStart(2, '0');
    return { 
      year, 
      month, 
      monthName: MONTH_NAMES[month - 1] || 'Unknown', 
      fullDate: `${year}-${monthStr}-${dayStr}` 
    };
  }
  return { year: 'Unknown', month: 0, monthName: 'Unknown', fullDate: str };
}

export default function AssetDividendDetailModal({ 
  isOpen, 
  onClose, 
  asset, 
  dividendsHistory = [], 
  holding = null,
  onAddDividend = null,
  onRefresh = null
}) {
  const { theme, fxRate, currency: globalCurrency, showError, showConfirm } = useThemeAuth();
  const [chartTab, setChartTab] = useState('annual'); // 'annual' | 'cumulative'
  const [localCurrency, setLocalCurrency] = useState('DEFAULT'); // 'DEFAULT' | 'INR' | 'USD'
  const [chartRange, setChartRange] = useState('ALL'); // 'ALL' | '1Y' | '3Y' | '5Y' | 'CUSTOM'
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [showCalendarPicker, setShowCalendarPicker] = useState(false);
  
  const [divSearch, setDivSearch] = useState('');
  const [divSort, setDivSort] = useState({ field: 'raw_date', direction: 'desc' });
  const [editingDivId, setEditingDivId] = useState(null);
  const [editForm, setEditForm] = useState({ payment_date: '', amount_original: '', fx_rate: '' });
  const [actionLoadingId, setActionLoadingId] = useState(null);

  if (!isOpen || !asset) return null;

  const isLight = theme === 'light' || theme === 'warm_light' || theme === 'nordic_light';
  const isUS = asset.currency === 'USD' || asset.category_id === 'us_stocks';
  const effectiveFx = Number(asset.fx_rate || fxRate || 87.25);

  // Determine active display currency
  const activeCurrency = localCurrency === 'DEFAULT' ? (isUS && globalCurrency === 'USD' ? 'USD' : 'INR') : localCurrency;
  const isDisplayUSD = activeCurrency === 'USD';

  // Extract all dividend records for this specific scheme
  const rawSchemeDividends = useMemo(() => {
    if (!asset) return [];
    const sym = (asset.symbol || '').trim().toUpperCase();
    const hid = asset.holding_id;
    return (dividendsHistory || []).filter(d => {
      if (hid && d.holding_id && d.holding_id === hid) return true;
      if (sym && d.symbol && d.symbol.toUpperCase() === sym) {
        if (asset.currency && d.currency) return asset.currency === d.currency;
        return true;
      }
      return false;
    }).sort((a, b) => {
      const aDate = extractDateParts(a.raw_date || a.payment_date).fullDate;
      const bDate = extractDateParts(b.raw_date || b.payment_date).fullDate;
      return bDate.localeCompare(aDate);
    });
  }, [asset, dividendsHistory]);

  // Apply calendar range filter
  const schemeDividends = useMemo(() => {
    if (!rawSchemeDividends || rawSchemeDividends.length === 0) return [];
    if (chartRange === 'ALL') return rawSchemeDividends;

    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (chartRange === '1Y') start.setFullYear(now.getFullYear() - 1);
    else if (chartRange === '3Y') start.setFullYear(now.getFullYear() - 3);
    else if (chartRange === '5Y') start.setFullYear(now.getFullYear() - 5);
    else if (chartRange === 'CUSTOM') {
      if (customStartDate) start = new Date(customStartDate);
      if (customEndDate) end = new Date(customEndDate);
    }

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    return rawSchemeDividends.filter(d => {
      const parts = extractDateParts(d.raw_date || d.payment_date);
      const dateStr = parts.fullDate;
      if (!dateStr) return true;
      return dateStr >= startStr && dateStr <= endStr;
    });
  }, [rawSchemeDividends, chartRange, customStartDate, customEndDate]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    let totalINR = 0;
    let totalOriginal = 0;
    
    schemeDividends.forEach(d => {
      totalINR += Number(d.amount_inr || 0);
      totalOriginal += Number(d.amount_original || 0);
    });

    const count = schemeDividends.length;
    const avgOriginal = count > 0 ? (totalOriginal / count) : 0;
    const avgINR = count > 0 ? (totalINR / count) : 0;
    const latest = schemeDividends[0] || null;
    const oldest = schemeDividends[schemeDividends.length - 1] || null;
    
    const investedCost = Number(holding?.invested_value || 0);
    const yieldOnCost = investedCost > 0 ? ((totalINR / investedCost) * 100) : null;

    return {
      totalINR,
      totalOriginal,
      count,
      avgOriginal,
      avgINR,
      latest,
      oldest,
      investedCost,
      yieldOnCost
    };
  }, [schemeDividends, holding]);

  // Annual Chart Data with Stacked Monthly Breakdown
  const annualChartData = useMemo(() => {
    const yearsMap = {};

    schemeDividends.forEach(d => {
      const { year, monthName } = extractDateParts(d.raw_date || d.payment_date);
      if (year === 'Unknown') return;

      if (!yearsMap[year]) {
        yearsMap[year] = {
          year,
          totalINR: 0,
          totalOriginal: 0,
          count: 0,
          monthlyBreakdown: {},
          // Initialize 12 months with 0
          Jan: 0, Feb: 0, Mar: 0, Apr: 0, May: 0, Jun: 0,
          Jul: 0, Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0,
          topGap: 0
        };
      }

      const originalAmt = Number(d.amount_original || 0);
      const inrAmt = Number(d.amount_inr || 0);
      const displayAmt = isDisplayUSD ? originalAmt : inrAmt;

      yearsMap[year].totalINR += inrAmt;
      yearsMap[year].totalOriginal += originalAmt;
      yearsMap[year].count += 1;

      if (monthName && monthName !== 'Unknown') {
        yearsMap[year][monthName] = Number(((yearsMap[year][monthName] || 0) + displayAmt).toFixed(2));
        if (!yearsMap[year].monthlyBreakdown[monthName]) {
          yearsMap[year].monthlyBreakdown[monthName] = { inr: 0, original: 0, count: 0 };
        }
        yearsMap[year].monthlyBreakdown[monthName].inr += inrAmt;
        yearsMap[year].monthlyBreakdown[monthName].original += originalAmt;
        yearsMap[year].monthlyBreakdown[monthName].count += 1;
      }
    });

    return Object.keys(yearsMap).sort().map(year => ({
      ...yearsMap[year],
      topGap: 0,
      totalDisplay: isDisplayUSD ? Number(yearsMap[year].totalOriginal.toFixed(2)) : Number(yearsMap[year].totalINR.toFixed(2)),
      totalINR: Number(yearsMap[year].totalINR.toFixed(2)),
      totalOriginal: Number(yearsMap[year].totalOriginal.toFixed(2))
    }));
  }, [schemeDividends, isDisplayUSD]);

  // Active months present in the dataset (to render bars)
  const activeMonths = useMemo(() => {
    const set = new Set();
    annualChartData.forEach(row => {
      MONTH_NAMES.forEach(m => {
        if (row[m] && row[m] > 0) set.add(m);
      });
    });
    return MONTH_NAMES.filter(m => set.has(m));
  }, [annualChartData]);

  // Cumulative Chart Data
  const cumulativeChartData = useMemo(() => {
    const chronological = [...schemeDividends].reverse();
    let runINR = 0;
    let runOriginal = 0;

    return chronological.map((d, index) => {
      runINR += Number(d.amount_inr || 0);
      runOriginal += Number(d.amount_original || 0);
      const displayDate = formatDateDDMMYYYY(d.payment_date || d.raw_date);
      return {
        date: displayDate,
        rawDate: d.raw_date,
        cumulative: isDisplayUSD ? Number(runOriginal.toFixed(2)) : Number(runINR.toFixed(2)),
        cumulativeINR: Number(runINR.toFixed(2)),
        cumulativeUSD: Number(runOriginal.toFixed(2)),
        payout: isDisplayUSD ? Number(d.amount_original) : Number(d.amount_inr),
        index: index + 1
      };
    });
  }, [schemeDividends, isDisplayUSD]);

  // Calculate running cumulative for table
  const ledgerRows = useMemo(() => {
    let runningINR = 0;
    let runningOriginal = 0;
    const chrono = [...schemeDividends].reverse().map(d => {
      runningINR += Number(d.amount_inr || 0);
      runningOriginal += Number(d.amount_original || 0);
      return {
        ...d,
        cumINR: runningINR,
        cumOriginal: runningOriginal
      };
    });
    return chrono.reverse();
  }, [schemeDividends]);

  const handleDivSort = (field) => {
    setDivSort(prev => ({
      field,
      direction: prev.field === field ? (prev.direction === 'asc' ? 'desc' : 'asc') : 'desc'
    }));
  };

  const renderDivSortIcon = (field) => {
    if (divSort.field !== field) return <ArrowUpDown className="w-3 h-3 opacity-40 inline ml-1" />;
    return divSort.direction === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-emerald-400 inline ml-1" /> 
      : <ArrowDown className="w-3 h-3 text-emerald-400 inline ml-1" />;
  };

  const sortedFilteredLedgerRows = useMemo(() => {
    let list = [...ledgerRows];
    if (divSearch.trim()) {
      const q = divSearch.toLowerCase().trim();
      list = list.filter(row => 
        (row.payment_date || row.raw_date || '').toLowerCase().includes(q) ||
        String(row.amount_original || '').includes(q) ||
        String(row.amount_inr || '').includes(q) ||
        String(row.fx_rate || '').includes(q)
      );
    }
    if (divSort.field) {
      list.sort((a, b) => {
        let valA = a[divSort.field];
        let valB = b[divSort.field];
        if (divSort.field === 'raw_date' || divSort.field === 'payment_date') {
          valA = extractDateParts(a.raw_date || a.payment_date).fullDate;
          valB = extractDateParts(b.raw_date || b.payment_date).fullDate;
          return divSort.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
        return divSort.direction === 'asc' ? valA - valB : valB - valA;
      });
    }
    return list;
  }, [ledgerRows, divSearch, divSort]);

  const cleanName = asset.clean_name || asset.asset_name || asset.name || asset.symbol;

  // Edit and Delete Handlers
  const handleStartEdit = (row) => {
    setEditingDivId(row.id);
    setEditForm({
      payment_date: row.raw_date || extractDateParts(row.payment_date).fullDate,
      amount_original: row.amount_original || '',
      fx_rate: row.fx_rate || effectiveFx
    });
  };

  const handleCancelEdit = () => {
    setEditingDivId(null);
    setEditForm({ payment_date: '', amount_original: '', fx_rate: '' });
  };

  const handleSaveEdit = async (row) => {
    const amt = Number(editForm.amount_original);
    if (isNaN(amt) || amt <= 0) {
      showError('Please enter a valid positive dividend amount.');
      return;
    }

    setActionLoadingId(row.id);
    try {
      await axios.put(`/api/dividends/${row.id}`, {
        amount_original: amt,
        payment_date: editForm.payment_date,
        currency: row.currency,
        fx_rate: isUS ? Number(editForm.fx_rate) : 1.0
      });
      setEditingDivId(null);
      if (onRefresh) await onRefresh();
    } catch (err) {
      showError('Error updating dividend: ' + (err.response?.data?.error || err.message));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteSingleDiv = async (row) => {
    const formattedDate = formatDateDDMMYYYY(row.payment_date || row.raw_date);
    const amountStr = row.currency === 'USD' ? `$${row.amount_original}` : `₹${row.amount_original}`;
    const confirmed = await showConfirm(`Are you sure you want to delete the dividend payout of ${amountStr} on ${formattedDate}?`);
    if (!confirmed) return;

    setActionLoadingId(row.id);
    try {
      await axios.delete(`/api/dividends/${row.id}`);
      if (schemeDividends.length <= 1) {
        onClose();
      }
      if (onRefresh) await onRefresh();
    } catch (err) {
      showError('Error deleting dividend: ' + (err.response?.data?.error || err.message));
    } finally {
      setActionLoadingId(null);
    }
  };

  // Custom Tooltip for Stacked Monthly Annual Chart
  const CustomAnnualTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const dataRow = payload[0]?.payload;
    if (!dataRow) return null;

    const breakdown = dataRow.monthlyBreakdown || {};
    const monthsWithPayouts = Object.keys(breakdown);

    return (
      <div className={`rounded-2xl p-3.5 shadow-2xl text-xs space-y-2 min-w-[200px] border ${
        isLight ? 'bg-white text-slate-900 border-slate-200' : 'bg-slate-900 text-white border-slate-700'
      }`}>
        <div className={`flex items-center justify-between border-b pb-1.5 font-bold ${
          isLight ? 'border-slate-100' : 'border-slate-800'
        }`}>
          <span className={isLight ? 'text-slate-600' : 'text-slate-300'}>Calendar Year {label}</span>
          <span className="text-emerald-500 font-mono font-black">
            {isDisplayUSD ? `$${dataRow.totalOriginal.toFixed(2)}` : `₹${dataRow.totalINR.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`}
          </span>
        </div>
        {isUS && (
          <div className={`text-[10px] font-mono flex justify-between ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
            <span>Converted Total:</span>
            <span>{isDisplayUSD ? `₹${dataRow.totalINR.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : `$${dataRow.totalOriginal.toFixed(2)}`}</span>
          </div>
        )}
        <div className="space-y-1 pt-1">
          <span className={`text-[10px] font-bold uppercase tracking-wider block ${isLight ? 'text-slate-400' : 'text-slate-500'}`}>
            Monthly Breakdown
          </span>
          {monthsWithPayouts.map(mName => {
            const mData = breakdown[mName];
            const mColor = MONTH_COLORS[MONTH_NAMES.indexOf(mName)] || '#6ee7b7';
            return (
              <div key={mName} className="flex items-center justify-between font-mono text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: mColor }} />
                  <span className={isLight ? 'text-slate-700 font-medium' : 'text-slate-300'}>{mName}</span>
                </div>
                <span className={`font-bold ${isLight ? 'text-slate-900' : 'text-slate-100'}`}>
                  {isDisplayUSD 
                    ? `$${Number(mData.original).toFixed(2)}` 
                    : `₹${Number(mData.inr).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
                  }
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/75 backdrop-blur-md">
        
        {/* Backdrop Click */}
        <div className="absolute inset-0" onClick={onClose} />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="modal-surface relative z-10 w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl border border-slate-800 shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="p-5 sm:p-6 border-b border-slate-800/80 flex items-center justify-between gap-4 shrink-0 bg-slate-900/40">
            <div className="flex items-center gap-3.5 min-w-0">
              <HoldingLogo
                holding={{
                  name: cleanName,
                  symbol: asset.symbol,
                  category_id: isUS ? 'us_stocks' : 'in_stocks'
                }}
                className="w-11 h-11 rounded-2xl shrink-0"
                fallbackClass="text-sm font-bold"
                accentColor={isUS ? '#a855f7' : '#10b981'}
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base sm:text-lg font-black text-white truncate">
                    {cleanName}
                  </h2>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                    isUS 
                      ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' 
                      : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                  }`}>
                    {isUS ? 'US Equity' : 'Indian Equity'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400 font-mono">
                  <span className="font-bold text-slate-300">{asset.symbol}</span>
                  <span>•</span>
                  <span>{schemeDividends.length} {schemeDividends.length === 1 ? 'Payout' : 'Payouts'}</span>
                  {isUS && (
                    <>
                      <span>•</span>
                      <span className="text-[11px] text-purple-400">FX: ₹{effectiveFx.toFixed(2)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {isUS && (
                <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-0.5 text-xs font-mono font-bold">
                  <button
                    onClick={() => setLocalCurrency('INR')}
                    className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                      !isDisplayUSD 
                        ? 'bg-emerald-500 text-slate-950 shadow-sm' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    INR
                  </button>
                  <button
                    onClick={() => setLocalCurrency('USD')}
                    className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                      isDisplayUSD 
                        ? 'bg-purple-500 text-white shadow-sm' 
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    USD
                  </button>
                </div>
              )}

              {onAddDividend && (
                <button
                  onClick={() => {
                    onClose();
                    onAddDividend({
                      symbol: asset.symbol,
                      name: cleanName,
                      category_id: isUS ? 'us_stocks' : 'in_stocks'
                    });
                  }}
                  className="px-3 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
                  title="Add Dividend for this stock"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Add Payout</span>
                </button>
              )}

              <button
                onClick={onClose}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Modal Body */}
          <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
            
            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
              
              {/* Card 1: Total Dividends */}
              <div className="glass-card p-3.5 rounded-2xl border border-slate-800/80 relative overflow-hidden">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  <span>Total Received</span>
                  <Coins className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div className="text-lg sm:text-xl font-black font-mono text-emerald-400">
                  {isDisplayUSD 
                    ? `$${metrics.totalOriginal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                    : `₹${metrics.totalINR.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  }
                </div>
                {isUS && (
                  <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                    {isDisplayUSD 
                      ? `≈ ₹${metrics.totalINR.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                      : `≈ $${metrics.totalOriginal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    }
                  </div>
                )}
              </div>

              {/* Card 2: Distributions Count */}
              <div className="glass-card p-3.5 rounded-2xl border border-slate-800/80 relative overflow-hidden">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  <span>Distributions</span>
                  <Calendar className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div className="text-lg sm:text-xl font-black font-mono text-slate-100">
                  {metrics.count}
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  {metrics.oldest ? `${formatDateDDMMYYYY(metrics.oldest.payment_date || metrics.oldest.raw_date)} to ${formatDateDDMMYYYY(metrics.latest.payment_date || metrics.latest.raw_date)}` : 'Recorded payouts'}
                </div>
              </div>

              {/* Card 3: Average Payout */}
              <div className="glass-card p-3.5 rounded-2xl border border-slate-800/80 relative overflow-hidden">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  <span>Average Payout</span>
                  <BarChart2 className="w-3.5 h-3.5 text-indigo-400" />
                </div>
                <div className="text-lg sm:text-xl font-black font-mono text-slate-100">
                  {isDisplayUSD 
                    ? `$${metrics.avgOriginal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                    : `₹${metrics.avgINR.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  }
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  Per distribution
                </div>
              </div>

              {/* Card 4: Latest Payout or Yield on Cost */}
              <div className="glass-card p-3.5 rounded-2xl border border-slate-800/80 relative overflow-hidden">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                  <span>{metrics.yieldOnCost !== null ? 'Yield on Cost' : 'Latest Payout'}</span>
                  {metrics.yieldOnCost !== null ? <Percent className="w-3.5 h-3.5 text-amber-400" /> : <Clock className="w-3.5 h-3.5 text-amber-400" />}
                </div>
                <div className="text-lg sm:text-xl font-black font-mono text-amber-400">
                  {metrics.yieldOnCost !== null 
                    ? `${metrics.yieldOnCost.toFixed(2)}%` 
                    : metrics.latest 
                    ? (isDisplayUSD 
                        ? `$${Number(metrics.latest.amount_original).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                        : `₹${Number(metrics.latest.amount_inr).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      )
                    : '—'
                  }
                </div>
                <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                  {metrics.yieldOnCost !== null 
                    ? `Cost: ₹${metrics.investedCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                    : metrics.latest ? formatDateDDMMYYYY(metrics.latest.payment_date || metrics.latest.raw_date) : '—'
                  }
                </div>
              </div>

            </div>

            {/* Charts Section */}
            <div className="glass-card p-4 sm:p-5 rounded-2xl border border-slate-800/80 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    {chartTab === 'annual' ? 'Annual Payout & Monthly Distribution' : 'Cumulative Growth Timeline'}
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    ({isDisplayUSD ? 'USD' : 'INR'})
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Calendar Range Selector */}
                  <div className="relative">
                    <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-0.5 text-xs font-bold">
                      {['ALL', '1Y', '3Y', '5Y', 'CUSTOM'].map(r => (
                        <button
                          key={r}
                          onClick={() => {
                            setChartRange(r);
                            if (r === 'CUSTOM') setShowCalendarPicker(prev => !prev);
                            else setShowCalendarPicker(false);
                          }}
                          className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                            chartRange === r 
                              ? 'bg-slate-800 text-emerald-400 font-black shadow-sm' 
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {r === 'CUSTOM' ? 'Custom' : r}
                        </button>
                      ))}
                    </div>

                    {/* Custom Date Range Popover */}
                    <AnimatePresence>
                      {showCalendarPicker && (
                        <motion.div
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 5 }}
                          className="absolute right-0 top-full mt-2 z-30 p-3.5 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl space-y-3 w-64"
                        >
                          <div className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">Custom Date Range</div>
                          <div className="space-y-2">
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">Start Date</label>
                              <input
                                type="date"
                                value={customStartDate}
                                onChange={(e) => setCustomStartDate(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block mb-0.5">End Date</label>
                              <input
                                type="date"
                                value={customEndDate}
                                onChange={(e) => setCustomEndDate(e.target.value)}
                                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                              />
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              setChartRange('CUSTOM');
                              setShowCalendarPicker(false);
                            }}
                            className="w-full py-1.5 bg-emerald-500 hover:bg-emerald-400 text-obsidian-950 font-black rounded-xl text-xs cursor-pointer transition-all"
                          >
                            Apply Filter
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Tab Switcher */}
                  <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl p-0.5 text-xs font-bold">
                    <button
                      onClick={() => setChartTab('annual')}
                      className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                        chartTab === 'annual' 
                          ? 'bg-slate-800 text-white shadow-sm' 
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Annual Breakdown
                    </button>
                    <button
                      onClick={() => setChartTab('cumulative')}
                      className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                        chartTab === 'cumulative' 
                          ? 'bg-slate-800 text-white shadow-sm' 
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Cumulative Curve
                    </button>
                  </div>
                </div>
              </div>

              {/* Chart Rendering */}
              <div className="h-64 w-full">
                {chartTab === 'annual' ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={annualChartData} margin={{ top: 32, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#cbd5e1' : '#334155'} opacity={isLight ? 0.4 : 0.3} vertical={false} />
                      <XAxis 
                        dataKey="year" 
                        stroke={isLight ? '#64748b' : '#94a3b8'} 
                        fontSize={11} 
                        tickLine={false} 
                        axisLine={{ stroke: isLight ? '#cbd5e1' : '#334155' }} 
                      />
                      <YAxis 
                        stroke={isLight ? '#64748b' : '#94a3b8'} 
                        fontSize={11} 
                        tickLine={false} 
                        axisLine={false}
                        tickFormatter={(v) => isDisplayUSD ? `$${v}` : `₹${v}`} 
                      />
                      <Tooltip content={<CustomAnnualTooltip />} />
                      {activeMonths.map((mName) => {
                        const mColor = MONTH_COLORS[MONTH_NAMES.indexOf(mName)] || '#6ee7b7';
                        return (
                          <Bar 
                            key={mName} 
                            dataKey={mName} 
                            name={mName} 
                            stackId="yearStack" 
                            fill={mColor} 
                            radius={[0, 0, 0, 0]} 
                          >
                            <LabelList
                              dataKey={mName}
                              content={<MonthSegmentLabel monthName={mName} isLight={isLight} />}
                            />
                          </Bar>
                        );
                      })}
                      {/* Transparent Bar with LabelList to display Total Value at the top of the accumulated bar */}
                      <Bar dataKey="topGap" stackId="yearStack" fill="transparent" isAnimationActive={false}>
                        <LabelList
                          position="top"
                          content={(props) => (
                            <TopTotalLabel {...props} data={annualChartData} isDisplayUSD={isDisplayUSD} isLight={isLight} />
                          )}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={cumulativeChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="cumDividendGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={isUS ? '#a855f7' : '#10b981'} stopOpacity={0.4} />
                          <stop offset="95%" stopColor={isUS ? '#a855f7' : '#10b981'} stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} vertical={false} />
                      <XAxis 
                        dataKey="date" 
                        stroke="#64748b" 
                        fontSize={11} 
                        tickLine={false} 
                        axisLine={{ stroke: '#334155' }} 
                      />
                      <YAxis 
                        stroke="#64748b" 
                        fontSize={11} 
                        tickLine={false} 
                        axisLine={false}
                        tickFormatter={(v) => isDisplayUSD ? `$${v}` : `₹${v}`} 
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: '#334155',
                          borderRadius: '12px',
                          fontSize: '12px',
                          color: '#f8fafc'
                        }}
                        formatter={(val, name, item) => [
                          isDisplayUSD 
                            ? `$${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (₹${item.payload.cumulativeINR.toLocaleString('en-IN', { minimumFractionDigits: 2 })})` 
                            : `₹${Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                          'Cumulative Total'
                        ]}
                      />
                      <Area 
                        type="monotone" 
                        dataKey="cumulative" 
                        stroke={isUS ? '#a855f7' : '#10b981'} 
                        strokeWidth={2.5} 
                        fill="url(#cumDividendGradient)" 
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Payout History Ledger Table */}
            <div className="glass-card rounded-2xl border border-slate-800/80 overflow-hidden space-y-2">
              <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Itemized Distribution Ledger
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    ({sortedFilteredLedgerRows.length} of {ledgerRows.length} {ledgerRows.length === 1 ? 'Record' : 'Records'})
                  </span>
                </div>

                <div className="relative w-full sm:w-56">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Filter distributions..."
                    value={divSearch}
                    onChange={(e) => setDivSearch(e.target.value)}
                    className="w-full pl-8 pr-10 py-1 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50"
                  />
                  {divSearch && (
                    <button
                      onClick={() => setDivSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-900/60 select-none">
                      <th onClick={() => handleDivSort('raw_date')} className="py-2.5 px-3 cursor-pointer hover:text-white whitespace-nowrap">
                        Date {renderDivSortIcon('raw_date')}
                      </th>
                      <th onClick={() => handleDivSort('amount_original')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                        Original Payout {renderDivSortIcon('amount_original')}
                      </th>
                      {isUS && (
                        <th onClick={() => handleDivSort('fx_rate')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                          FX Rate {renderDivSortIcon('fx_rate')}
                        </th>
                      )}
                      <th onClick={() => handleDivSort('amount_inr')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                        INR Credited {renderDivSortIcon('amount_inr')}
                      </th>
                      <th onClick={() => handleDivSort(isDisplayUSD ? 'cumOriginal' : 'cumINR')} className="py-2.5 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                        Cumulative Total {renderDivSortIcon(isDisplayUSD ? 'cumOriginal' : 'cumINR')}
                      </th>
                      <th className="py-2.5 px-3 text-center whitespace-nowrap">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="[&>tr]:border-b [&>tr]:border-slate-800/40 text-xs font-mono">
                    {sortedFilteredLedgerRows.map((row, i) => {
                      const isEditing = editingDivId === row.id;

                      if (isEditing) {
                        return (
                          <tr key={row.id || i} className="bg-slate-800/60 border-emerald-500/40">
                            <td className="py-2 px-3">
                              <input
                                type="date"
                                value={editForm.payment_date}
                                onChange={(e) => setEditForm(prev => ({ ...prev, payment_date: e.target.value }))}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                              />
                            </td>
                            <td className="py-2 px-3 text-right">
                              <input
                                type="number"
                                step="any"
                                value={editForm.amount_original}
                                onChange={(e) => setEditForm(prev => ({ ...prev, amount_original: e.target.value }))}
                                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono text-right focus:outline-none focus:border-emerald-500"
                                placeholder="Amount"
                              />
                            </td>
                            {isUS && (
                              <td className="py-2 px-3 text-right">
                                <input
                                  type="number"
                                  step="any"
                                  value={editForm.fx_rate}
                                  onChange={(e) => setEditForm(prev => ({ ...prev, fx_rate: e.target.value }))}
                                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-mono text-right focus:outline-none focus:border-emerald-500"
                                  placeholder="FX Rate"
                                />
                              </td>
                            )}
                            <td className="py-2 px-3 text-right font-bold text-emerald-400">
                              ₹{((Number(editForm.amount_original) || 0) * (isUS ? (Number(editForm.fx_rate) || effectiveFx) : 1)).toFixed(2)}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-500">
                              —
                            </td>
                            <td className="py-2 px-3 text-center whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => handleSaveEdit(row)}
                                  disabled={actionLoadingId === row.id}
                                  className="p-1 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                                  title="Save Changes"
                                >
                                  <Save className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={handleCancelEdit}
                                  className="p-1 hover:bg-slate-700/60 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                                  title="Cancel"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr key={row.id || `${row.symbol}-${i}`} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-2.5 px-3 text-slate-300 font-medium whitespace-nowrap">
                            {formatDateDDMMYYYY(row.payment_date || row.raw_date)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-slate-200 whitespace-nowrap">
                            {row.currency === 'USD' 
                              ? `$${Number(row.amount_original).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                              : `₹${Number(row.amount_original).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            }
                          </td>
                          {isUS && (
                            <td className="py-2.5 px-3 text-right text-slate-400 whitespace-nowrap">
                              ₹{Number(row.fx_rate || effectiveFx).toFixed(2)}
                            </td>
                          )}
                          <td className="py-2.5 px-3 text-right font-bold text-emerald-400 whitespace-nowrap">
                            ₹{Number(row.amount_inr).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-300 font-bold whitespace-nowrap">
                            {isDisplayUSD 
                              ? `$${row.cumOriginal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                              : `₹${row.cumINR.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            }
                          </td>
                          <td className="py-2.5 px-3 text-center whitespace-nowrap">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleStartEdit(row)}
                                className="p-1 hover:bg-slate-700/60 text-slate-500 hover:text-blue-400 rounded-lg transition-colors cursor-pointer"
                                title="Edit Distribution"
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleDeleteSingleDiv(row)}
                                disabled={actionLoadingId === row.id}
                                className="p-1 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                                title="Delete Distribution"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}


