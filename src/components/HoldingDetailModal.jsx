import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';
import LoanAmortizationSection from './LoanAmortizationSection';
import { fmtINR, fmtUSD, formatTxDate } from './holding-detail/holdingDetailUtils';
import HoldingDetailHeader from './holding-detail/HoldingDetailHeader';
import HoldingMarketStats from './holding-detail/HoldingMarketStats';
import HoldingMetricCards from './holding-detail/HoldingMetricCards';
import HoldingChartsSection from './holding-detail/HoldingChartsSection';
import HoldingTransactionLedger from './holding-detail/HoldingTransactionLedger';
import SipManagerModal from './SipManagerModal';

export default function HoldingDetailModal({ holding, onClose, onRefresh }) {
  const { currency, theme, fxRate, formatMoney, showError, showSuccess } = useThemeAuth();
  const isLight = theme === 'light' || theme === 'warm_light' || theme === 'nordic_light';
  const [detail, setDetail] = useState(null);
  const activeHolding = detail?.holding || holding;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [txSort, setTxSort] = useState({ field: 'date', dir: 'desc' });
  const [txSearch, setTxSearch] = useState('');
  const [txTypeFilter, setTxTypeFilter] = useState('ALL');

  const [activeTab, setActiveTab] = useState('tracker');
  const isLoan = activeHolding?.category_id === 'loans';
  const isEodAsset = ['bank', 'epf', 'loans', 'credit_cards'].includes(activeHolding?.category_id);
  const [loanViewTab, setLoanViewTab] = useState(activeHolding?.initialTab || 'history');
  const [chartRangeFilter, setChartRangeFilter] = useState({ type: 'ALL', startDate: null, endDate: null, rangeKey: 'ALL' });

  // Transaction Edit/Delete state
  const [editingTxId, setEditingTxId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [txActionLoading, setTxActionLoading] = useState(null);
  const [deleteConfirmTx, setDeleteConfirmTx] = useState(null);
  const [isDeletingTx, setIsDeletingTx] = useState(false);

  // Quick Add Transaction state
  const [isAddingTx, setIsAddingTx] = useState(false);
  const [isSipModalOpen, setIsSipModalOpen] = useState(false);
  const [newTxType, setNewTxType] = useState(() => {
    if (holding?.category_id === 'bank') return 'DEPOSIT';
    if (holding?.category_id === 'epf') return 'CONTRIBUTION';
    if (holding?.category_id === 'loans') return 'EMI_PAYMENT';
    if (holding?.category_id === 'credit_cards') return 'EXPENSE';
    return 'BUY';
  });
  const [newTxDate, setNewTxDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [newTxQty, setNewTxQty] = useState('');
  const [newTxPrice, setNewTxPrice] = useState(() => {
    if (!holding?.current_price) return '';
    const num = Number(holding.current_price);
    if (isNaN(num) || num <= 0) return '';
    const isFund = holding?.category_id === 'mutual_funds' || holding?.category_id === 'nps';
    return isFund ? num.toFixed(4) : num.toFixed(2);
  });
  const [newTxAmount, setNewTxAmount] = useState('');
  const [newTxCharges, setNewTxCharges] = useState('0.00');
  const [newTxFxRate, setNewTxFxRate] = useState('');
  const [newTxNotes, setNewTxNotes] = useState('');
  const [newTxSplitOld, setNewTxSplitOld] = useState('1');
  const [newTxSplitNew, setNewTxSplitNew] = useState('10');
  const [isSavingTx, setIsSavingTx] = useState(false);

  // Synchronize price precision if holding or current_price updates
  useEffect(() => {
    if (holding?.current_price) {
      const num = Number(holding.current_price);
      if (!isNaN(num) && num > 0) {
        const isFund = holding?.category_id === 'mutual_funds' || holding?.category_id === 'nps';
        setNewTxPrice(isFund ? num.toFixed(4) : num.toFixed(2));
      }
    }
  }, [holding?.current_price, holding?.category_id]);

  const isUSStock = holding?.category_id === 'us_stocks' || holding?.currency === 'USD';
  const [displayCurrency, setDisplayCurrency] = useState(isUSStock ? currency : 'INR');

  // Keep displayCurrency and newTxFxRate in sync if global currency/fxRate changes
  useEffect(() => {
    if (isUSStock && !isAddingTx) {
      setDisplayCurrency(currency);
      setNewTxFxRate(prev => prev || String(detail?.currentFxRate || fxRate || ''));
    }
  }, [currency, isUSStock, detail?.currentFxRate, fxRate, isAddingTx]);

  // Auto-fetch historical FX rate when transaction date changes
  useEffect(() => {
    if (isUSStock && newTxDate && isAddingTx) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (newTxDate >= todayStr) {
        setNewTxFxRate(String(detail?.currentFxRate || fxRate || ''));
      } else {
        axios.get(`/api/fx-rate?date=${newTxDate}`)
          .then(res => {
            if (res.data?.rate) {
              setNewTxFxRate(String(res.data.rate));
            }
          })
          .catch(err => console.warn('Failed to fetch historical FX rate:', err));
      }
    }
  }, [newTxDate, isUSStock, isAddingTx, detail?.currentFxRate, fxRate]);

  const handleSaveNewTransaction = async (e) => {
    e.preventDefault();
    setIsSavingTx(true);
    try {
      const isBankOrEpf = holding?.category_id === 'bank' || holding?.category_id === 'epf';
      const isLiability = holding?.category_id === 'loans' || holding?.category_id === 'credit_cards';

      let payloadData = {
        symbol: holding.symbol || holding.name,
        name: holding.name,
        date: newTxDate,
        type: newTxType,
        charges: Number(newTxCharges) || 0,
        notes: newTxNotes || ''
      };

      if (isUSStock && newTxFxRate) {
        payloadData.fxRateOverride = Number(newTxFxRate);
        payloadData.fx_rate = Number(newTxFxRate);
      }

      if (newTxType === 'DIVIDEND') {
        const divAmt = Number(newTxAmount) || 0;
        if (divAmt <= 0) {
          if (showError) showError('Dividend amount must be greater than zero.');
          setIsSavingTx(false);
          return;
        }
        payloadData.dividendAmount = divAmt;
        payloadData.amount = divAmt;
        payloadData.quantity = 0;
        payloadData.price = 0;
        payloadData.charges = 0;
      } else if (newTxType === 'SPLIT') {
        const oldR = Number(newTxSplitOld) || 1;
        const newR = Number(newTxSplitNew) || 1;
        if (oldR <= 0 || newR <= 0) {
          if (showError) showError('Split ratio values must be greater than zero.');
          setIsSavingTx(false);
          return;
        }
        payloadData.splitOldQty = oldR;
        payloadData.splitNewQty = newR;
        payloadData.quantity = 0;
        payloadData.price = 0;
        payloadData.charges = 0;
      } else if (newTxType === 'BONUS') {
        const bonusQty = Number(newTxQty) || 0;
        if (bonusQty <= 0) {
          if (showError) showError('Bonus shares quantity must be greater than zero.');
          setIsSavingTx(false);
          return;
        }
        payloadData.quantity = bonusQty;
        payloadData.price = 0;
        payloadData.amount = 0;
        payloadData.charges = Number(newTxCharges) || 0;
      } else if (isBankOrEpf || isLiability) {
        payloadData.amount = Number(newTxAmount);
        payloadData.charges = Number(newTxCharges) || 0;
        payloadData.holdingId = holding.id;
        payloadData.liabilityId = holding.id;
      } else {
        const qty = Number(newTxQty) || 0;
        const price = Number(newTxPrice) || 0;
        const charges = Number(newTxCharges) || 0;
        payloadData.quantity = qty;
        payloadData.price = price;
        payloadData.amount = newTxType === 'SELL' ? Math.max(0, (qty * price) - charges) : ((qty * price) + charges);
      }

      await axios.post('/api/add-investment', {
        portfolio: holding.category_id,
        data: payloadData
      });

      if (showSuccess) showSuccess('Transaction added successfully!');
      setIsAddingTx(false);
      setNewTxQty('');
      setNewTxAmount('');
      setNewTxCharges('0.00');
      setNewTxNotes('');
      setNewTxSplitOld('1');
      setNewTxSplitNew('10');
      // Reload holding details
      const detailRes = await axios.get(`/api/holding/${holding.id}/detail`);
      setDetail(detailRes.data);
      if (onRefresh) onRefresh();
    } catch (err) {
      if (showError) showError('Failed to add transaction: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsSavingTx(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && holding) {
        if (deleteConfirmTx) {
          setDeleteConfirmTx(null);
        } else if (editingTxId) {
          setEditingTxId(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [holding, onClose, deleteConfirmTx, editingTxId]);

  const fetchDetail = useCallback(async (isInitial = false) => {
    if (!holding?.id) return;
    if (isInitial) {
      setLoading(true);
      setError(null);
      setDetail(null);
    }
    try {
      const res = await axios.get(`/api/holding/${encodeURIComponent(holding.id)}/detail`);
      if (res.data) {
        setDetail(res.data);
        if (isInitial) setLoading(false);
      }
    } catch (err) {
      if (isInitial) {
        setError(err.response?.data?.error || err.message);
        setLoading(false);
      }
    }
  }, [holding?.id]);

  useEffect(() => {
    if (!holding?.id) return;
    fetchDetail(true);
    // Periodic refresh while modal is open (every 15s for live active quote tracking)
    const pollTimer = setInterval(() => fetchDetail(false), 15000);

    return () => {
      clearInterval(pollTimer);
    };
  }, [holding?.id, fetchDetail]);

  const startEditTx = (tx) => {
    setEditingTxId(tx.id);
    let splitOld = '1';
    let splitNew = '2';
    if (tx.type === 'SPLIT') {
      const match = (tx.notes || '').match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
      if (match) {
        splitOld = match[1];
        splitNew = match[2];
      }
    }
    const isFund = holding?.category_id === 'mutual_funds' || holding?.category_id === 'nps';
    const priceDigits = isFund ? 4 : 2;
    const priceVal = tx.price !== undefined && tx.price !== null && tx.price !== ''
      ? Number(tx.price).toFixed(priceDigits)
      : (tx.total_amount !== undefined ? Number(tx.total_amount).toFixed(2) : '');
    const chargesVal = tx.charges !== undefined && tx.charges !== null && tx.charges !== ''
      ? Number(tx.charges).toFixed(2)
      : '0.00';
    const totalAmtVal = tx.total_amount !== undefined && tx.total_amount !== null && tx.total_amount !== ''
      ? Number(tx.total_amount).toFixed(2)
      : (tx.price !== undefined ? Number(tx.price).toFixed(2) : '');

    setEditForm({
      date: (tx.date || '').split('T')[0],
      type: tx.type || (isEodAsset ? 'CREDIT' : 'BUY'),
      quantity: tx.quantity ?? (isEodAsset ? 1 : ''),
      price: priceVal,
      total_amount: totalAmtVal,
      charges: chargesVal,
      fx_rate: tx.fx_rate !== undefined && tx.fx_rate !== null && tx.fx_rate !== '' ? Number(tx.fx_rate).toFixed(2) : '',
      notes: tx.notes ?? '',
      splitOld,
      splitNew
    });
  };

  const cancelEditTx = () => {
    setEditingTxId(null);
    setEditForm({});
  };

  const saveEditTx = async (txId) => {
    setTxActionLoading(txId);
    try {
      let payload;
      if (editForm.type === 'SPLIT') {
        const oldR = Number(editForm.splitOld) || 1;
        const newR = Number(editForm.splitNew) || 1;
        payload = {
          date: editForm.date,
          type: 'SPLIT',
          splitOld: oldR,
          splitNew: newR,
          notes: editForm.notes || `Stock split ${oldR}:${newR}`
        };
      } else if (editForm.type === 'BONUS') {
        payload = {
          date: editForm.date,
          type: 'BONUS',
          quantity: Number(editForm.quantity) || 0,
          price: 0,
          total_amount: 0,
          charges: Number(editForm.charges) || 0,
          notes: editForm.notes || `Bonus issue: +${editForm.quantity} shares`
        };
      } else {
        const amountVal = Number(editForm.total_amount) || Number(editForm.price) || 0;
        const qtyVal = Number(editForm.quantity) || (isEodAsset ? 1 : 0);
        const priceVal = isEodAsset ? amountVal : (Number(editForm.price) || (qtyVal > 0 ? amountVal / qtyVal : 0));
        payload = {
          date: editForm.date,
          type: editForm.type,
          quantity: qtyVal,
          price: priceVal,
          total_amount: amountVal,
          charges: Number(editForm.charges) || 0,
          fx_rate: editForm.fx_rate ? Number(editForm.fx_rate) : null,
          notes: editForm.notes || ''
        };
      }
      await axios.put(`/api/transactions/${txId}`, payload);
      setEditingTxId(null);
      setEditForm({});
      await fetchDetail(false);
      if (onRefresh) await onRefresh();
    } catch (err) {
      showError('Error updating transaction: ' + (err.response?.data?.error || err.message));
    } finally {
      setTxActionLoading(null);
    }
  };

  const deleteTx = (tx) => {
    setDeleteConfirmTx(tx);
  };

  const handleConfirmDeleteTx = async () => {
    if (!deleteConfirmTx) return;
    setIsDeletingTx(true);
    setTxActionLoading(deleteConfirmTx.id);
    try {
      await axios.delete(`/api/transactions/${deleteConfirmTx.id}`);
      setDeleteConfirmTx(null);
      await fetchDetail(false);
      if (onRefresh) await onRefresh();
    } catch (err) {
      showError('Error deleting transaction: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsDeletingTx(false);
      setTxActionLoading(null);
    }
  };

  const handleTxSort = (field) => {
    setTxSort(prev => ({
      field,
      dir: prev.field === field ? (prev.dir === 'asc' ? 'desc' : 'asc') : 'asc'
    }));
  };

  const accentColor = holding?.category_id === 'us_stocks' ? '#a855f7'
    : holding?.category_id === 'mutual_funds' ? '#f59e0b'
    : holding?.category_id === 'nps' ? '#06b6d4'
    : holding?.category_id === 'bank' ? '#3b82f6'
    : holding?.category_id === 'epf' ? '#6366f1'
    : (holding?.category_id === 'loans' || holding?.category_id === 'credit_cards') ? '#f43f5e'
    : '#10b981';

  // Professional Sky Blue theme for price curves that contrasts with Green BUY and Red SELL signals
  const chartLineColor = isLight ? '#0284c7' : '#38bdf8';

  const isDisplayUSD = isUSStock && displayCurrency === 'USD';
  const activeMetrics = isDisplayUSD
    ? (detail?.metricsUSD || detail?.metrics || {})
    : (detail?.metricsINR || detail?.metrics || {});
  const activeTimeline = isDisplayUSD
    ? (detail?.timelineUSD || detail?.timeline || [])
    : (detail?.timelineINR || detail?.timeline || []);

  // Auto-update price/NAV based on date selection (Only for Mutual Funds & NPS)
  useEffect(() => {
    if (isAddingTx && newTxDate && activeTimeline && activeTimeline.length > 0) {
      const isFund = holding?.category_id === 'mutual_funds' || holding?.category_id === 'nps';
      if (isFund) {
        const point = activeTimeline.find(t => t.label === newTxDate);
        if (point && point.price) {
          setNewTxPrice(Number(point.price).toFixed(4));
        }
      }
    }
  }, [newTxDate, isAddingTx, activeTimeline, holding?.category_id]);

  const fmt = isDisplayUSD ? fmtUSD : fmtINR;
  const m = activeMetrics;

  const quotePriceVal = detail?.quote?.price !== undefined ? detail.quote.price : Number(holding?.current_price || 0);
  const dayChangeVal = detail?.quote?.dayChange !== undefined ? detail.quote.dayChange : (holding?.day_change !== undefined ? holding.day_change : 0);
  const dayChangePctVal = detail?.quote?.dayChangePct !== undefined ? detail.quote.dayChangePct : (holding?.day_change_pct !== undefined ? holding.day_change_pct : 0);

  const filteredTimeline = useMemo(() => {
    if (!activeTimeline || activeTimeline.length === 0) return [];
    if (chartRangeFilter.type === 'ALL') return activeTimeline;
    const startStr = chartRangeFilter.startDate;
    const endStr = chartRangeFilter.endDate || new Date().toISOString().split('T')[0];
    if (!startStr) return activeTimeline;
    return activeTimeline.filter(t => t.label >= startStr && t.label <= endStr);
  }, [activeTimeline, chartRangeFilter]);

  const availableTxTypes = useMemo(() => {
    if (!detail?.transactions || detail.transactions.length === 0) return ['ALL'];
    const types = Array.from(new Set(detail.transactions.map(t => (t.type || '').toUpperCase()).filter(Boolean)));
    return ['ALL', ...types];
  }, [detail?.transactions]);

  const processedTransactions = useMemo(() => {
    if (!detail?.transactions || detail.transactions.length === 0) return [];

    if (isEodAsset) {
      const chronological = [...detail.transactions].sort((a, b) => new Date(a.date) - new Date(b.date));
      let runningBal = 0;
      const computed = chronological.map(tx => {
        const type = (tx.type || 'BUY').toUpperCase();
        const amt = Number(tx.total_amount) || Number(tx.price) || 0;
        
        let isInflow = false;
        if (holding?.category_id === 'loans' || holding?.category_id === 'credit_cards') {
          if (['BORROW', 'CHARGE', 'BUY', 'DEBIT'].includes(type)) {
            runningBal += amt;
            isInflow = false;
          } else {
            runningBal -= amt;
            isInflow = true;
          }
        } else {
          if (['CREDIT', 'DEPOSIT', 'CONTRIBUTION', 'INTEREST', 'BUY'].includes(type)) {
            runningBal += amt;
            isInflow = true;
          } else {
            runningBal -= amt;
            isInflow = false;
          }
        }

        return {
          ...tx,
          runningBalance: tx.runningBalance !== undefined ? Number(tx.runningBalance) : Math.max(0, runningBal),
          isInflow,
          netTxAmount: amt
        };
      });

      if (chartRangeFilter.type === 'ALL') return computed;
      const start = filteredTimeline[0]?.label;
      const end = filteredTimeline[filteredTimeline.length - 1]?.label;
      if (!start || !end) return computed;
      return computed.filter(tx => {
        const date = (tx.date || '').split('T')[0];
        return date >= start && date <= end;
      });
    }

    if (chartRangeFilter.type === 'ALL') return detail.transactions;
    const start = filteredTimeline[0]?.label;
    const end = filteredTimeline[filteredTimeline.length - 1]?.label;
    if (!start || !end) return [];
    return detail.transactions.filter(tx => {
      const date = (tx.date || '').split('T')[0];
      return date >= start && date <= end;
    });
  }, [detail?.transactions, isEodAsset, chartRangeFilter, filteredTimeline, holding?.category_id]);

  const sortedTxs = useMemo(() => {
    let list = [...processedTransactions];
    if (txTypeFilter !== 'ALL') {
      list = list.filter(tx => (tx.type || '').toUpperCase() === txTypeFilter);
    }
    if (txSearch.trim()) {
      const q = txSearch.toLowerCase().trim();
      list = list.filter(tx => 
        (tx.date || '').toLowerCase().includes(q) ||
        (tx.type || '').toLowerCase().includes(q) ||
        (tx.notes || '').toLowerCase().includes(q) ||
        String(tx.price || '').includes(q) ||
        String(tx.total_amount || '').includes(q) ||
        String(tx.netTxAmount || '').includes(q) ||
        String(tx.runningBalance || '').includes(q)
      );
    }
    return list.sort((a, b) => {
      let av = a[txSort.field] ?? '', bv = b[txSort.field] ?? '';
      if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
      if (av < bv) return txSort.dir === 'asc' ? -1 : 1;
      if (av > bv) return txSort.dir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [processedTransactions, txSort, txSearch, txTypeFilter]);

  const chartMinMax = useMemo(() => {
    if (!filteredTimeline || filteredTimeline.length === 0) return [0, 'auto'];
    const vals = activeTab === 'tracker'
      ? filteredTimeline.flatMap(d => [d.invested, d.value])
      : filteredTimeline.map(d => d.price).filter(v => v !== undefined);
    if (vals.length === 0) return [0, 'auto'];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = (max - min) * 0.05;
    return [Math.max(0, min - pad), max + pad];
  }, [filteredTimeline, activeTab]);

  const isFundOrNps = holding?.category_id === 'nps' || holding?.category_id === 'mutual_funds';
  const hasActualChart = !['bank', 'epf', 'loans', 'credit_cards'].includes(holding?.category_id);
  const displayHoldingName = holding?.category_id === 'bank'
    ? (holding.name || '').replace(/\s*\(SBI\)/gi, '').trim()
    : holding?.category_id === 'epf'
    ? 'Employee Provident Fund'
    : (holding?.name || '').replace(/\s*\(SBI\)/gi, '').trim();

  useEffect(() => {
    if (!hasActualChart) setActiveTab('tracker');
  }, [hasActualChart, holding?.id]);

  const modalContent = (
    <AnimatePresence>
      {holding && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Slide-up panel */}
          <motion.div
            className="modal-surface fixed inset-x-0 bottom-0 top-[3%] z-50 flex flex-col border border-slate-800 rounded-t-3xl overflow-hidden shadow-2xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          >
            {/* Header */}
            <HoldingDetailHeader
              holding={activeHolding}
              accentColor={accentColor}
              displayHoldingName={displayHoldingName}
              isEodAsset={isEodAsset}
              isUSStock={isUSStock}
              isLight={isLight}
              displayCurrency={displayCurrency}
              setDisplayCurrency={setDisplayCurrency}
              detail={detail}
              fxRate={fxRate}
              isDisplayUSD={isDisplayUSD}
              fmtUSD={fmtUSD}
              fmtINR={fmtINR}
              formatMoney={formatMoney}
              quotePriceVal={quotePriceVal}
              dayChangeVal={dayChangeVal}
              dayChangePctVal={dayChangePctVal}
              isFundOrNps={isFundOrNps}
              m={m}
              onClose={onClose}
            />

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {loading && (
                <div className="flex items-center justify-center h-60 gap-3">
                  <div
                    className="w-6 h-6 border-2 rounded-full animate-spin"
                    style={{ borderColor: `${accentColor}30`, borderTopColor: accentColor }}
                  />
                  <span className="text-slate-400 text-sm">Loading details...</span>
                </div>
              )}

              {error && (
                <div className="flex items-center justify-center h-60 text-rose-400 text-sm">
                  Failed to load: {error}
                </div>
              )}

              {!loading && !error && detail && (
                <>
                  {/* ---- Loan Specific Sub-Tabs (Daily Balance History vs Amortization) ---- */}
                  {isLoan && (
                    <div className="flex items-center justify-between gap-4 pb-1 border-b border-slate-800/80">
                      <div className="flex items-center gap-1 p-1 bg-slate-900/80 border border-slate-800 rounded-xl">
                        <button
                          onClick={() => setLoanViewTab('history')}
                          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                            loanViewTab === 'history'
                              ? 'bg-rose-500 text-white shadow-md shadow-rose-500/25'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          <span>Daily Balance History</span>
                        </button>
                        <button
                          onClick={() => setLoanViewTab('amortization')}
                          className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                            loanViewTab === 'amortization'
                              ? 'bg-rose-500 text-white shadow-md shadow-rose-500/25'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          <span>Amortization Schedule & Chart</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {isLoan && loanViewTab === 'amortization' ? (
                    <LoanAmortizationSection liabilityId={holding.id} />
                  ) : (
                    <>
                      {/* ---- Market Stats Snapshot (Open, High, Low, Prev Close, 52W Range) ---- */}
                      {!isEodAsset && (
                        <HoldingMarketStats
                          isLight={isLight}
                          isDisplayUSD={isDisplayUSD}
                          isFundOrNps={isFundOrNps}
                          detail={detail}
                          holding={holding}
                          quotePriceVal={quotePriceVal}
                          fmt={fmt}
                          fmtUSD={fmtUSD}
                        />
                      )}

                      {/* ---- Metrics Grid ---- */}
                      <HoldingMetricCards
                        isEodAsset={isEodAsset}
                        displayCurrency={displayCurrency}
                        m={m}
                        fmt={fmt}
                        fmtINR={fmtINR}
                        fmtUSD={fmtUSD}
                        isLight={isLight}
                        isUSStock={isUSStock}
                        isDisplayUSD={isDisplayUSD}
                        holding={holding}
                        fxRate={fxRate}
                      />

                      {/* ---- Chart ---- */}
                      {activeTimeline.length > 1 && (
                        <HoldingChartsSection
                          activeTab={activeTab}
                          setActiveTab={setActiveTab}
                          hasActualChart={hasActualChart}
                          filteredTimeline={filteredTimeline}
                          setChartRangeFilter={setChartRangeFilter}
                          chartLineColor={chartLineColor}
                          isLight={isLight}
                          isDisplayUSD={isDisplayUSD}
                          isFundOrNps={isFundOrNps}
                          chartMinMax={chartMinMax}
                        />
                      )}

                      {/* ---- Transaction / EOD Ledger ---- */}
                      <HoldingTransactionLedger
                        holding={holding}
                        isEodAsset={isEodAsset}
                        isUSStock={isUSStock}
                        isLight={isLight}
                        isDisplayUSD={isDisplayUSD}
                        isFundOrNps={isFundOrNps}
                        fxRate={fxRate}
                        sortedTxs={sortedTxs}
                        txSort={txSort}
                        handleTxSort={handleTxSort}
                        availableTxTypes={availableTxTypes}
                        txTypeFilter={txTypeFilter}
                        setTxTypeFilter={setTxTypeFilter}
                        txSearch={txSearch}
                        setTxSearch={setTxSearch}
                        isAddingTx={isAddingTx}
                        setIsAddingTx={setIsAddingTx}
                        newTxType={newTxType}
                        setNewTxType={setNewTxType}
                        newTxDate={newTxDate}
                        setNewTxDate={setNewTxDate}
                        newTxQty={newTxQty}
                        setNewTxQty={setNewTxQty}
                        newTxPrice={newTxPrice}
                        setNewTxPrice={setNewTxPrice}
                        newTxAmount={newTxAmount}
                        setNewTxAmount={setNewTxAmount}
                        newTxCharges={newTxCharges}
                        setNewTxCharges={setNewTxCharges}
                        newTxFxRate={newTxFxRate}
                        setNewTxFxRate={setNewTxFxRate}
                        newTxNotes={newTxNotes}
                        setNewTxNotes={setNewTxNotes}
                        newTxSplitOld={newTxSplitOld}
                        setNewTxSplitOld={setNewTxSplitOld}
                        newTxSplitNew={newTxSplitNew}
                        setNewTxSplitNew={setNewTxSplitNew}
                        isSavingTx={isSavingTx}
                        handleSaveNewTransaction={handleSaveNewTransaction}
                        editingTxId={editingTxId}
                        editForm={editForm}
                        setEditForm={setEditForm}
                        startEditTx={startEditTx}
                        cancelEditTx={cancelEditTx}
                        saveEditTx={saveEditTx}
                        txActionLoading={txActionLoading}
                        deleteTx={deleteTx}
                        deleteConfirmTx={deleteConfirmTx}
                        setDeleteConfirmTx={setDeleteConfirmTx}
                        isDeletingTx={isDeletingTx}
                        handleConfirmDeleteTx={handleConfirmDeleteTx}
                        onOpenSip={() => setIsSipModalOpen(true)}
                      />
                    </>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  if (typeof document !== 'undefined') {
    return createPortal(
      <>
        {modalContent}
        {holding?.category_id === 'mutual_funds' && (
          <SipManagerModal
            isOpen={isSipModalOpen}
            onClose={() => setIsSipModalOpen(false)}
            holdings={[holding]}
            initialHoldingId={holding.id}
            onRefresh={async () => {
              await fetchDetail(false);
              if (onRefresh) await onRefresh();
            }}
          />
        )}
      </>,
      document.body
    );
  }
  return (
    <>
      {modalContent}
      {holding?.category_id === 'mutual_funds' && (
        <SipManagerModal
          isOpen={isSipModalOpen}
          onClose={() => setIsSipModalOpen(false)}
          holdings={[holding]}
          initialHoldingId={holding.id}
          onRefresh={async () => {
            await fetchDetail(false);
            if (onRefresh) await onRefresh();
          }}
        />
      )}
    </>
  );
}
