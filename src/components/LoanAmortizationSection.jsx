import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Calendar, TrendingDown, DollarSign, Plus, Trash2, Edit3, 
  Sparkles, CheckCircle2, Clock, ChevronDown, ChevronUp,
  Percent, ArrowUpRight, ArrowDownRight, Layers, HelpCircle,
  Wallet, ShieldAlert, X, Search, ArrowUpDown, ArrowUp, ArrowDown
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Area, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine
} from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import formatDateDDMMYYYY from '../utils/dateFormatter';
import DatePicker from './common/DatePicker';

function fmtFullINR(val) {
  const n = Number(val) || 0;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatTile({ label, value, sub, accent, positive, icon: Icon }) {
  return (
    <div className="glass-card rounded-2xl border border-slate-800/80 p-4 flex flex-col justify-between group hover:border-slate-700/90 transition-all duration-300 relative">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
        {Icon && <Icon className={`w-3.5 h-3.5 ${accent || 'text-slate-400'}`} />}
      </div>
      <div className="text-base sm:text-lg lg:text-[17px] font-black font-mono text-white leading-tight break-words">
        {value}
      </div>
      {sub && (
        <div className={`mt-1 text-[10px] font-bold font-mono ${positive === true ? 'text-emerald-400' : positive === false ? 'text-rose-400' : 'text-slate-400'}`}>
          {sub}
        </div>
      )}
    </div>
  );
}

export default function LoanAmortizationSection({ liabilityId = '00000000-0000-0000-0000-000000000010' }) {
  const { theme, showError } = useThemeAuth();
  const isLight = theme === 'light' || theme === 'warm_light' || theme === 'nordic_light';

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [viewFilter, setViewFilter] = useState('all'); // 'all', 'settled', 'projected'
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [chartMode, setChartMode] = useState('trajectory'); // 'trajectory', 'breakdown'

  // Dynamic Add Entry Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newEntryType, setNewEntryType] = useState('PREPAYMENT');
  const [newDate, setNewDate] = useState(new Date().toISOString().slice(0, 10));
  const [newAmount, setNewAmount] = useState('');
  const [newRate, setNewRate] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Edit Entry Modal State
  const [editingEntry, setEditingEntry] = useState(null);
  const [editDate, setEditDate] = useState('');
  const [editType, setEditType] = useState('EMI');
  const [editEmi, setEditEmi] = useState('');
  const [editBulk, setEditBulk] = useState('');
  const [editRate, setEditRate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Prepayment Simulator State
  const [simExtraEmi, setSimExtraEmi] = useState(0);
  const [simLumpSum, setSimLumpSum] = useState(0);

  // Table Search and Sort State
  const [scheduleSearch, setScheduleSearch] = useState('');
  const [scheduleSort, setScheduleSort] = useState({ field: 'date', direction: 'asc' });

  const handleScheduleSort = (field) => {
    setScheduleSort(prev => ({
      field,
      direction: prev.field === field ? (prev.direction === 'asc' ? 'desc' : 'asc') : 'asc'
    }));
  };

  const renderScheduleSortIcon = (field) => {
    if (scheduleSort.field !== field) return <ArrowUpDown className="w-3 h-3 opacity-40 inline ml-1" />;
    return scheduleSort.direction === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-rose-400 inline ml-1" /> 
      : <ArrowDown className="w-3 h-3 text-rose-400 inline ml-1" />;
  };

  // Delete Confirmation Modal State
  const [deleteConfirmEntry, setDeleteConfirmEntry] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/loan/amortization?liabilityId=${encodeURIComponent(liabilityId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      if (json.summary?.currentInterestRate && !newRate) {
        setNewRate(String(json.summary.currentInterestRate));
      }
    } catch (err) {
      console.error('[LoanAmortizationSection] Error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [liabilityId]);

  const summary = data?.summary || {};
  const settledEntries = data?.settledEntries || [];
  const futureSchedule = data?.futureSchedule || [];

  // Combine all entries
  const allEntries = useMemo(() => {
    return [...settledEntries, ...futureSchedule];
  }, [settledEntries, futureSchedule]);

  // Extract unique years for filter
  const availableYears = useMemo(() => {
    const set = new Set();
    allEntries.forEach(e => {
      if (e.date) set.add(e.date.slice(0, 4));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allEntries]);

  // Filtered rows for Amortization Calendar Table
  const filteredEntries = useMemo(() => {
    let list = allEntries.filter(e => {
      if (viewFilter === 'settled' && !e.is_settled) return false;
      if (viewFilter === 'projected' && e.is_settled) return false;
      if (selectedYear !== 'ALL' && e.date && !e.date.startsWith(selectedYear)) return false;
      return true;
    });

    if (scheduleSearch.trim()) {
      const q = scheduleSearch.toLowerCase().trim();
      list = list.filter(e => 
        (e.date || '').toLowerCase().includes(q) ||
        (e.entry_type || '').toLowerCase().includes(q) ||
        (e.notes || '').toLowerCase().includes(q) ||
        String(e.closing_balance || '').includes(q) ||
        String(e.emi_amount || '').includes(q) ||
        String(e.bulk_payment || '').includes(q)
      );
    }

    if (scheduleSort.field) {
      list.sort((a, b) => {
        let valA = a[scheduleSort.field];
        let valB = b[scheduleSort.field];
        if (scheduleSort.field === 'date') {
          valA = a.date || '';
          valB = b.date || '';
          return scheduleSort.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        if (typeof valA === 'string') {
          return scheduleSort.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
        return scheduleSort.direction === 'asc' ? valA - valB : valB - valA;
      });
    }

    return list;
  }, [allEntries, viewFilter, selectedYear, scheduleSearch, scheduleSort]);

  // Chart Data preparation
  const chartData = useMemo(() => {
    if (!allEntries || allEntries.length === 0) return [];
    
    // Aggregate by Year-Month to keep chart smooth and legible
    const map = new Map();
    allEntries.forEach(e => {
      const ym = e.date.slice(0, 7); // YYYY-MM
      if (!map.has(ym)) {
        map.set(ym, {
          ym,
          date: e.date,
          label: formatDateDDMMYYYY(e.date),
          balance: e.closing_balance,
          actualBalance: e.is_settled ? e.closing_balance : null,
          projectedBalance: !e.is_settled ? e.closing_balance : null,
          isSettled: e.is_settled,
          principal: Number(e.principal_amount) || 0,
          interest: Number(e.interest_amount) || 0,
          bulkPayment: Number(e.bulk_payment) || 0,
          entryType: e.entry_type
        });
      } else {
        const item = map.get(ym);
        item.balance = e.closing_balance;
        if (e.is_settled) item.actualBalance = e.closing_balance;
        else item.projectedBalance = e.closing_balance;
        item.principal += Number(e.principal_amount) || 0;
        item.interest += Number(e.interest_amount) || 0;
        item.bulkPayment += Number(e.bulk_payment) || 0;
      }
    });

    const arr = Array.from(map.values());
    // Connect the last actual point to the projected line for continuous visual curve
    const lastActualIdx = arr.findIndex((item, idx) => item.isSettled && (idx === arr.length - 1 || !arr[idx + 1].isSettled));
    if (lastActualIdx >= 0 && lastActualIdx < arr.length - 1) {
      arr[lastActualIdx].projectedBalance = arr[lastActualIdx].actualBalance;
    }

    return arr;
  }, [allEntries]);

  // Annual Aggregation for Breakdown Chart
  const annualBreakdown = useMemo(() => {
    const yearMap = new Map();
    allEntries.forEach(e => {
      const yr = e.date.slice(0, 4);
      if (!yearMap.has(yr)) {
        yearMap.set(yr, {
          year: yr,
          principal: 0,
          interest: 0,
          bulkPayment: 0,
          isSettled: e.is_settled
        });
      }
      const item = yearMap.get(yr);
      item.principal += Number(e.principal_amount) || 0;
      item.interest += Number(e.interest_amount) || 0;
      item.bulkPayment += Number(e.bulk_payment) || 0;
      if (e.is_settled) item.isSettled = true;
    });
    return Array.from(yearMap.values()).sort((a, b) => a.year.localeCompare(b.year));
  }, [allEntries]);

  // Handle Add Entry
  const handleAddEntry = async (e) => {
    e.preventDefault();
    if (!newAmount && newEntryType !== 'RATE_CHANGE') {
      showError('Please enter an amount.');
      return;
    }

    setSubmitting(true);
    try {
      const isPaymentUpdate = newEntryType === 'MONTHLY_PAYMENT';
      const payload = {
        liability_id: liabilityId,
        date: newDate,
        entry_type: isPaymentUpdate ? 'EMI' : newEntryType,
        interest_rate: Number(newRate) || summary.currentInterestRate,
        disbursed_amount: newEntryType === 'DISBURSEMENT' ? Number(newAmount) : 0,
        emi_amount: (isPaymentUpdate || newEntryType === 'EMI') ? Number(newAmount) : (summary.monthlyPayment || 60000),
        bulk_payment: newEntryType === 'PREPAYMENT' ? Number(newAmount) : 0,
        notes: newNotes || (isPaymentUpdate ? `Monthly installment updated to ₹${newAmount}` : newEntryType === 'PREPAYMENT' ? `Voluntary Prepayment ₹${newAmount}` : null)
      };

      const res = await fetch('/api/loan/amortization/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || 'Failed to add entry');
      }

      await fetchData();
      setIsAddModalOpen(false);
      setNewAmount('');
      setNewNotes('');
    } catch (err) {
      showError('Error adding entry: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Open Edit Modal for a given entry
  const handleOpenEdit = (entry) => {
    setEditingEntry(entry);
    setEditDate(entry.date || '');
    setEditType(entry.entry_type || 'EMI');
    setEditEmi(entry.emi_amount ? String(entry.emi_amount) : '');
    setEditBulk(entry.bulk_payment ? String(entry.bulk_payment) : '');
    setEditRate(entry.interest_rate ? String(entry.interest_rate) : String(summary.currentInterestRate || 7.25));
    setEditNotes(entry.notes || '');
  };

  // Submit Edit Entry
  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingEntry) return;

    setEditSubmitting(true);
    try {
      const isProjectedRow = typeof editingEntry.id === 'string' && editingEntry.id.startsWith('proj-');
      const payload = {
        liability_id: liabilityId,
        date: editDate,
        entry_type: editType,
        interest_rate: Number(editRate) || summary.currentInterestRate,
        emi_amount: Number(editEmi) || 0,
        bulk_payment: Number(editBulk) || 0,
        notes: editNotes || null,
        is_settled: editingEntry.is_settled
      };

      if (isProjectedRow) {
        // Convert projected row into custom user entry
        const res = await fetch('/api/loan/amortization/entry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to save entry');
      } else {
        // Update existing record
        const res = await fetch(`/api/loan/amortization/entry/${encodeURIComponent(editingEntry.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to update entry');
      }

      await fetchData();
      setEditingEntry(null);
    } catch (err) {
      showError('Error saving edit: ' + err.message);
    } finally {
      setEditSubmitting(false);
    }
  };

  // Prompt Delete Entry (Standard Project Modal)
  const handlePromptDelete = (entry) => {
    setDeleteConfirmEntry({
      id: entry.id || entry.date,
      label: `${formatDateDDMMYYYY(entry.date)} (${entry.entry_type || 'Loan Entry'})`,
      amount: entry.bulk_payment || entry.emi_amount,
      date: entry.date
    });
  };

  // Confirm Delete Entry
  const handleConfirmDelete = async () => {
    if (!deleteConfirmEntry) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/loan/amortization/entry/${encodeURIComponent(deleteConfirmEntry.id)}`, {
        method: 'DELETE'
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Delete failed');
      }
      await fetchData();
      setDeleteConfirmEntry(null);
    } catch (err) {
      showError('Error deleting entry: ' + err.message);
    } finally {
      setIsDeleting(false);
    }
  };

  // Prepayment Simulator calculation
  const simulationResult = useMemo(() => {
    if (!summary.currentOutstandingBalance) return null;
    const startBal = summary.currentOutstandingBalance - Number(simLumpSum || 0);
    if (startBal <= 0) return { monthsLeft: 0, interestSaved: summary.totalProjectedInterest };

    const effectivePayment = (summary.monthlyPayment || 60000) + Number(simExtraEmi || 0);
    const rate = summary.currentInterestRate / 100 / 12;

    if (effectivePayment <= startBal * rate) {
      return { monthsLeft: 999, interestSaved: 0 };
    }

    // Number of months = -ln(1 - (startBal * rate / emi)) / ln(1 + rate)
    const nMonths = Math.ceil(-Math.log(1 - (startBal * rate / effectivePayment)) / Math.log(1 + rate));
    const totalSimPaid = nMonths * effectivePayment;
    const totalSimInterest = totalSimPaid - startBal;
    const interestSaved = Math.max(0, summary.totalProjectedInterest - totalSimInterest);
    const monthsSaved = Math.max(0, summary.monthsRemaining - nMonths);

    return {
      simMonths: nMonths,
      monthsSaved,
      interestSaved
    };
  }, [summary, simExtraEmi, simLumpSum]);

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center p-12 gap-3">
        <div className="w-8 h-8 border-3 border-rose-500/20 border-t-rose-500 rounded-full animate-spin" />
        <span className="text-xs font-bold text-slate-400">Loading loan amortization engine...</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-bold">
        Failed to load loan amortization: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* ---- Executive KPI Tiles (Always Full Formatted Rupee Amounts) ---- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <StatTile
          label="Outstanding Balance"
          value={fmtFullINR(summary.currentOutstandingBalance)}
          sub={`Rate: ${summary.currentInterestRate}% p.a.`}
          icon={TrendingDown}
          accent="text-rose-400"
        />
        <StatTile
          label="Loan Sanctioned"
          value={fmtFullINR(summary.totalDisbursed)}
          sub="Principal Disbursed"
          icon={DollarSign}
          accent="text-blue-400"
        />
        <StatTile
          label="Principal Repaid"
          value={fmtFullINR(summary.totalPrincipalPaid)}
          sub={`${summary.totalDisbursed > 0 ? ((summary.totalPrincipalPaid / summary.totalDisbursed) * 100).toFixed(1) : 0}% Repaid`}
          positive={true}
          icon={CheckCircle2}
          accent="text-emerald-400"
        />
        <StatTile
          label="Interest Paid To Date"
          value={fmtFullINR(summary.totalInterestPaid)}
          sub="Finance Charges"
          icon={Percent}
          accent="text-amber-400"
        />
        <StatTile
          label="Actual EMI"
          value={fmtFullINR(summary.actualEmi || 52653)}
          sub="Contractual EMI"
          icon={Clock}
          accent="text-indigo-400"
        />
        <StatTile
          label="Monthly Payment"
          value={fmtFullINR(summary.monthlyPayment || 60000)}
          sub="Current Installment"
          icon={Wallet}
          accent="text-rose-400"
        />
        <StatTile
          label="Projected Payoff"
          value={summary.projectedPayoffDate ? formatDateDDMMYYYY(summary.projectedPayoffDate) : '—'}
          sub={`${summary.monthsRemaining} Months Remaining`}
          icon={Calendar}
          accent="text-cyan-400"
        />
      </div>

      {/* ---- Interactive Amortization Chart & Simulator Controls ---- */}
      <div className="glass-card rounded-3xl border border-slate-800 p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30 tracking-wider">
              DYNAMIC PROJECTION
            </span>
            <h3 className="text-base sm:text-lg font-black text-white mt-1 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-rose-400" />
              Housing Loan Amortization Trajectory
            </h3>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Chart Mode Switcher */}
            <div className="flex items-center p-1 bg-slate-900/80 border border-slate-800 rounded-xl">
              <button
                onClick={() => setChartMode('trajectory')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${chartMode === 'trajectory' ? 'bg-slate-800 text-rose-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Balance Curve
              </button>
              <button
                onClick={() => setChartMode('breakdown')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${chartMode === 'breakdown' ? 'bg-slate-800 text-rose-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Annual Breakdown
              </button>
            </div>

            {/* Add Entry Button */}
            <motion.button
              onClick={() => setIsAddModalOpen(true)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 text-white font-black text-xs flex items-center gap-1.5 shadow-md shadow-rose-500/20 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
              Add Entry
            </motion.button>
          </div>
        </div>

        {/* Chart View */}
        <div className="w-full h-72 sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            {chartMode === 'trajectory' ? (
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
                <defs>
                  <linearGradient id="settledBalGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="projBalGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#e2e8f0' : '#1e293b'} />
                <XAxis 
                  dataKey="ym" 
                  tick={{ fill: '#64748b', fontSize: 10 }} 
                  tickLine={false} 
                  axisLine={false} 
                  minTickGap={40} 
                />
                <YAxis 
                  tick={{ fill: '#64748b', fontSize: 10 }} 
                  tickLine={false} 
                  axisLine={false} 
                  tickFormatter={v => `₹${(v / 100000).toFixed(1)}L`} 
                  width={75} 
                />
                <Tooltip 
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const item = payload[0]?.payload;
                    return (
                      <div className="bg-slate-900/95 border border-slate-700/80 rounded-xl px-3 py-2.5 text-xs shadow-2xl backdrop-blur-md">
                        <div className="text-slate-400 font-mono font-bold mb-1 flex items-center justify-between gap-3">
                          <span>{item?.label || label}</span>
                          <span className={`px-1.5 py-0.2 rounded text-[9px] font-black ${item?.isSettled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-cyan-500/20 text-cyan-400'}`}>
                            {item?.isSettled ? 'SETTLED' : 'PROJECTED'}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-4">
                            <span className="text-slate-300">Balance:</span>
                            <span className="font-mono font-black text-white">{fmtFullINR(item?.balance)}</span>
                          </div>
                          {item?.bulkPayment > 0 && (
                            <div className="flex items-center justify-between gap-4 text-emerald-400">
                              <span>Prepayment:</span>
                              <span className="font-mono font-bold">+{fmtFullINR(item.bulkPayment)}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between gap-4 text-slate-400 text-[10px]">
                            <span>Principal Repaid:</span>
                            <span className="font-mono">{fmtFullINR(item?.principal)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-4 text-slate-400 text-[10px]">
                            <span>Interest Paid:</span>
                            <span className="font-mono">{fmtFullINR(item?.interest)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend 
                  verticalAlign="top" 
                  height={32} 
                  formatter={val => <span className="text-[11px] font-bold text-slate-400">{val}</span>} 
                />
                <Area 
                  type="monotone" 
                  dataKey="actualBalance" 
                  name="Settled Actual Balance" 
                  stroke="#f43f5e" 
                  strokeWidth={2.5} 
                  fill="url(#settledBalGrad)" 
                  dot={false}
                />
                <Area 
                  type="monotone" 
                  dataKey="projectedBalance" 
                  name="Projected Future Balance" 
                  stroke="#06b6d4" 
                  strokeWidth={2.5} 
                  strokeDasharray="4 4" 
                  fill="url(#projBalGrad)" 
                  dot={false}
                />
              </ComposedChart>
            ) : (
              <ComposedChart data={annualBreakdown} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#e2e8f0' : '#1e293b'} />
                <XAxis dataKey="year" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `₹${(v / 100000).toFixed(1)}L`} width={75} />
                <Tooltip 
                  formatter={(val, name) => [fmtFullINR(val), name]}
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '11px' }}
                />
                <Legend verticalAlign="top" height={32} formatter={val => <span className="text-[11px] font-bold text-slate-400">{val}</span>} />
                <Bar dataKey="principal" name="Principal Repaid" stackId="a" fill="#10b981" radius={[0, 0, 4, 4]} />
                <Bar dataKey="interest" name="Interest Charges" stackId="a" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>

        {/* ---- What-If Prepayment Simulator Bar ---- */}
        <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800/80 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs font-black text-slate-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Prepayment What-If Simulator
            </span>
            {simulationResult && (
              <div className="flex items-center gap-3 text-xs font-mono font-bold">
                <span className="text-emerald-400">
                  Save {fmtFullINR(simulationResult.interestSaved)} in Interest
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-cyan-400">
                  {simulationResult.monthsSaved} Months Earlier
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div>
              <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                <span>Extra Monthly Installment: {simExtraEmi > 0 ? `+${fmtFullINR(simExtraEmi)}/mo` : '₹0.00'}</span>
              </div>
              <input
                type="range"
                min="0"
                max="50000"
                step="2500"
                value={simExtraEmi}
                onChange={e => setSimExtraEmi(Number(e.target.value))}
                className="w-full accent-rose-500 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1">
                <span>One-Time Lump Sum Prepayment: {simLumpSum > 0 ? fmtFullINR(simLumpSum) : '₹0.00'}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1000000"
                step="50000"
                value={simLumpSum}
                onChange={e => setSimLumpSum(Number(e.target.value))}
                className="w-full accent-rose-500 cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ---- Amortization Calendar / Schedule Table ---- */}
      <div className="glass-card rounded-3xl border border-slate-800 p-5 sm:p-6 space-y-4">
        
        {/* Table Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-900/80 border border-slate-800 rounded-xl">
            {[
              { id: 'all', label: `All (${allEntries.length})` },
              { id: 'settled', label: `Settled (${settledEntries.length})` },
              { id: 'projected', label: `Projected (${futureSchedule.length})` }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setViewFilter(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${viewFilter === tab.id ? 'bg-slate-800 text-rose-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative w-full sm:w-52">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search schedule..."
                value={scheduleSearch}
                onChange={(e) => setScheduleSearch(e.target.value)}
                className="w-full pl-8 pr-10 py-1 bg-slate-900 border border-slate-700/80 rounded-xl text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-rose-500/50"
              />
              {scheduleSearch && (
                <button
                  onClick={() => setScheduleSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase text-slate-500">Year:</span>
              <select
                value={selectedYear}
                onChange={e => setSelectedYear(e.target.value)}
                className="bg-slate-900 border border-slate-700/80 text-white rounded-xl px-2.5 py-1 text-xs font-mono font-bold outline-none cursor-pointer"
              >
                <option value="ALL">All Years</option>
                {availableYears.map(yr => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* The Schedule Table */}
        <div className="border border-slate-800/90 rounded-2xl overflow-hidden">
          <div className="relative overflow-x-auto overflow-y-auto max-h-[520px] custom-scrollbar">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 z-30 bg-slate-900 border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 select-none shadow-sm">
                <tr>
                  <th onClick={() => handleScheduleSort('date')} className="py-3 px-3.5 cursor-pointer hover:text-white sticky left-0 top-0 z-40 bg-slate-900 border-r border-slate-800 min-w-[120px]">
                    Date {renderScheduleSortIcon('date')}
                  </th>
                  <th onClick={() => handleScheduleSort('entry_type')} className="py-3 px-3 cursor-pointer hover:text-white bg-slate-900">
                    Type {renderScheduleSortIcon('entry_type')}
                  </th>
                  <th onClick={() => handleScheduleSort('opening_balance')} className="py-3 px-3 text-right cursor-pointer hover:text-white bg-slate-900">
                    Opening Balance {renderScheduleSortIcon('opening_balance')}
                  </th>
                  <th onClick={() => handleScheduleSort('emi_amount')} className="py-3 px-3 text-right cursor-pointer hover:text-white bg-slate-900">
                    Monthly Payment {renderScheduleSortIcon('emi_amount')}
                  </th>
                  <th onClick={() => handleScheduleSort('bulk_payment')} className="py-3 px-3 text-right cursor-pointer hover:text-white bg-slate-900">
                    Bulk Payment {renderScheduleSortIcon('bulk_payment')}
                  </th>
                  <th onClick={() => handleScheduleSort('interest_amount')} className="py-3 px-3 text-right cursor-pointer hover:text-white bg-slate-900">
                    Interest {renderScheduleSortIcon('interest_amount')}
                  </th>
                  <th onClick={() => handleScheduleSort('principal_amount')} className="py-3 px-3 text-right cursor-pointer hover:text-white bg-slate-900">
                    Principal {renderScheduleSortIcon('principal_amount')}
                  </th>
                  <th onClick={() => handleScheduleSort('closing_balance')} className="py-3 px-3 text-right cursor-pointer hover:text-white bg-slate-900">
                    Closing Balance {renderScheduleSortIcon('closing_balance')}
                  </th>
                  <th onClick={() => handleScheduleSort('interest_rate')} className="py-3 px-2 text-center cursor-pointer hover:text-white bg-slate-900">
                    Rate {renderScheduleSortIcon('interest_rate')}
                  </th>
                  <th className="py-3 px-3 text-center bg-slate-900">Status</th>
                  <th className="py-3 px-3 text-center bg-slate-900">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredEntries.map((row, idx) => {
                  const isSettled = row.is_settled;
                  const isPrepay = (Number(row.bulk_payment) || 0) > 0;
                  const isDisb = (Number(row.disbursed_amount) || 0) > 0;

                  return (
                    <tr 
                      key={row.id || `${row.date}-${idx}`}
                      className={`group hover:bg-slate-800/30 transition-colors ${
                        isPrepay ? 'bg-emerald-500/5' : isDisb ? 'bg-blue-500/5' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3.5 text-slate-300 font-bold whitespace-nowrap sticky left-0 z-20 bg-slate-900/95 group-hover:bg-slate-900/95 border-r border-slate-800 min-w-[120px]">
                        {formatDateDDMMYYYY(row.date)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${
                          isDisb 
                            ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                            : isPrepay
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                            : row.entry_type === 'RATE_CHANGE'
                            ? 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {isDisb ? 'DISBURSED' : isPrepay ? 'PREPAYMENT' : row.entry_type || 'EMI'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-400 whitespace-nowrap">
                        {fmtFullINR(row.opening_balance)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-200 font-bold whitespace-nowrap">
                        {row.emi_amount > 0 ? fmtFullINR(row.emi_amount) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-black whitespace-nowrap">
                        {row.bulk_payment > 0 ? (
                          <span className="text-emerald-400 font-bold">+{fmtFullINR(row.bulk_payment)}</span>
                        ) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-rose-400 whitespace-nowrap">
                        {row.interest_amount > 0 ? fmtFullINR(row.interest_amount) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right text-emerald-400 whitespace-nowrap">
                        {row.principal_amount > 0 ? fmtFullINR(row.principal_amount) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-white whitespace-nowrap">
                        {fmtFullINR(row.closing_balance)}
                      </td>
                      <td className="py-2.5 px-2 text-center text-[10px] text-slate-400 whitespace-nowrap">
                        {row.interest_rate ? `${row.interest_rate}%` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-[8.5px] font-black uppercase ${
                          isSettled 
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                            : 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25'
                        }`}>
                          {isSettled ? 'SETTLED' : 'PROJECTED'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleOpenEdit(row)}
                            className="p-1 hover:bg-slate-700/60 text-slate-400 hover:text-white rounded-lg transition-colors cursor-pointer"
                            title="Edit entry"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handlePromptDelete(row)}
                            className="p-1 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
                            title="Delete entry"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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

      {/* ---- Add Loan Entry Modal ---- */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
            onClick={() => setIsAddModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="modal-surface w-full max-w-md rounded-3xl border border-slate-700/80 p-6 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <Plus className="w-4 h-4 text-rose-400" />
                  Add Housing Loan Entry
                </h3>
                <button
                  onClick={() => setIsAddModalOpen(false)}
                  className="text-slate-400 hover:text-white text-xs font-bold cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleAddEntry} className="mt-4 space-y-4 text-xs font-bold">
                <div>
                  <label className="text-slate-400 uppercase text-[10px] block mb-1">Entry Type</label>
                  <select
                    value={newEntryType}
                    onChange={e => setNewEntryType(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-rose-500 cursor-pointer"
                  >
                    <option value="PREPAYMENT">Prepayment / Lump Sum Payment</option>
                    <option value="MONTHLY_PAYMENT">Update Monthly Installment / Payment</option>
                    <option value="EMI">Regular Contractual EMI</option>
                    <option value="RATE_CHANGE">Interest Rate Change</option>
                    <option value="DISBURSEMENT">Additional Loan Disbursement</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 uppercase text-[10px] block mb-1">Effective Date</label>
                    <DatePicker
                      value={newDate}
                      onChange={e => setNewDate(e.target.value)}
                      required
                      inputClassName="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white focus:border-rose-500"
                    />
                  </div>


                  <div>
                    <label className="text-slate-400 uppercase text-[10px] block mb-1">Interest Rate (% p.a.)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={newRate}
                      onChange={e => setNewRate(e.target.value)}
                      placeholder={String(summary.currentInterestRate || 7.25)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-rose-500"
                    />
                  </div>
                </div>

                {newEntryType !== 'RATE_CHANGE' && (
                  <div>
                    <label className="text-slate-400 uppercase text-[10px] block mb-1">
                      {newEntryType === 'PREPAYMENT' ? 'Prepayment Amount (₹)' : newEntryType === 'DISBURSEMENT' ? 'Disbursement Amount (₹)' : newEntryType === 'MONTHLY_PAYMENT' ? 'New Monthly Installment / Payment (₹)' : 'Contractual EMI Amount (₹)'}
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={newAmount}
                      onChange={e => setNewAmount(e.target.value)}
                      placeholder="e.g. 60000"
                      required
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono outline-none focus:border-rose-500"
                    />
                  </div>
                )}

                <div>
                  <label className="text-slate-400 uppercase text-[10px] block mb-1">Notes / Description (Optional)</label>
                  <input
                    type="text"
                    value={newNotes}
                    onChange={e => setNewNotes(e.target.value)}
                    placeholder="e.g. Voluntary Prepayment"
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-rose-500"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 text-white font-black shadow-md shadow-rose-500/25 cursor-pointer"
                  >
                    {submitting ? 'Applying...' : 'Apply Entry & Recalculate'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ---- Edit Loan Entry Modal ---- */}
      <AnimatePresence>
        {editingEntry && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
            onClick={() => setEditingEntry(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="modal-surface w-full max-w-md rounded-3xl border border-slate-700/80 p-6 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  <Edit3 className="w-4 h-4 text-rose-400" />
                  Edit Loan Entry
                </h3>
                <button
                  onClick={() => setEditingEntry(null)}
                  className="text-slate-400 hover:text-white text-xs font-bold cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveEdit} className="mt-4 space-y-4 text-xs font-bold">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 uppercase text-[10px] block mb-1">Date</label>
                    <DatePicker
                      value={editDate}
                      onChange={e => setEditDate(e.target.value)}
                      required
                      inputClassName="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white focus:border-rose-500"
                    />
                  </div>


                  <div>
                    <label className="text-slate-400 uppercase text-[10px] block mb-1">Entry Type</label>
                    <select
                      value={editType}
                      onChange={e => setEditType(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-rose-500 cursor-pointer"
                    >
                      <option value="EMI">Regular EMI / Payment</option>
                      <option value="PREPAYMENT">Prepayment</option>
                      <option value="RATE_CHANGE">Rate Change</option>
                      <option value="DISBURSEMENT">Disbursement</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-slate-400 uppercase text-[10px] block mb-1">Monthly Payment (₹)</label>
                    <input
                      type="number"
                      step="1"
                      value={editEmi}
                      onChange={e => setEditEmi(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono outline-none focus:border-rose-500"
                    />
                  </div>

                  <div>
                    <label className="text-slate-400 uppercase text-[10px] block mb-1">Bulk Prepayment (₹)</label>
                    <input
                      type="number"
                      step="1"
                      value={editBulk}
                      onChange={e => setEditBulk(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono outline-none focus:border-rose-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-slate-400 uppercase text-[10px] block mb-1">Interest Rate (% p.a.)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editRate}
                    onChange={e => setEditRate(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white font-mono outline-none focus:border-rose-500"
                  />
                </div>

                <div>
                  <label className="text-slate-400 uppercase text-[10px] block mb-1">Notes</label>
                  <input
                    type="text"
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    placeholder="Entry notes..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-white outline-none focus:border-rose-500"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingEntry(null)}
                    className="px-4 py-2 rounded-xl border border-slate-700 text-slate-400 hover:text-white cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editSubmitting}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 text-white font-black shadow-md shadow-rose-500/25 cursor-pointer"
                  >
                    {editSubmitting ? 'Saving...' : 'Save & Recalculate'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ---- Standard Themed Delete Confirmation Modal ---- */}
      <AnimatePresence>
        {deleteConfirmEntry && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
            onClick={() => !isDeleting && setDeleteConfirmEntry(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              className="modal-surface w-full max-w-sm rounded-2xl border border-slate-700/80 p-5 shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Delete Loan Entry</h3>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold font-mono">Amortization Ledger</span>
                </div>
              </div>

              <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                Are you sure you want to remove the loan entry for <span className="font-mono text-rose-400 font-bold">{deleteConfirmEntry.label}</span>?
              </p>
              <p className="mt-1 text-[11px] text-slate-500 leading-normal">
                This will dynamically recompute future amortization schedules and outstanding balances.
              </p>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={() => setDeleteConfirmEntry(null)}
                  className="rounded-xl border border-slate-700 px-3.5 py-2 text-xs font-bold text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleConfirmDelete}
                  className="rounded-xl px-4 py-2 text-xs font-black bg-rose-500 hover:bg-rose-400 text-white shadow-md shadow-rose-500/25 cursor-pointer"
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
