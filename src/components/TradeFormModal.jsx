import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  BookOpen,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Tag,
  Smile,
  ShieldCheck,
  AlertTriangle,
  Info,
  CheckCircle2,
  Calendar,
  Layers,
  Sparkles
} from 'lucide-react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';

const SEGMENTS = [
  { id: 'IN_EQUITY', label: 'Equity Delivery (CNC)', market: 'IN' },
  { id: 'IN_INTRADAY', label: 'Equity Intraday (MIS)', market: 'IN' },
  { id: 'IN_OPTIONS', label: 'F&O Options', market: 'IN' },
  { id: 'IN_FUTURES', label: 'F&O Futures', market: 'IN' },
  { id: 'US_EQUITY', label: 'US Equities', market: 'US' },
];

const STRATEGIES = [
  'Breakout',
  'Stage 2 Pullback',
  '21 EMA Bounce',
  'Range Breakout',
  'Momentum Swing',
  'Expiry Scalp',
  'Chandelier Exit',
  'Earnings Catalyst',
  'Mean Reversion',
  'Value Accumulation'
];

const EMOTIONS = [
  { id: 'Calm', label: 'Calm 🧘' },
  { id: 'Disciplined', label: 'Disciplined 🎯' },
  { id: 'FOMO', label: 'FOMO 🏃' },
  { id: 'Anxious', label: 'Anxious 😰' },
  { id: 'Greedy', label: 'Greedy 🤑' },
  { id: 'Revenge', label: 'Revenge 😡' }
];

const COMMON_TAGS = [
  'Followed Plan',
  'Patient Entry',
  'Cut Loss Fast',
  'Let Winner Run',
  'A+ Setup',
  'FOMO Entry',
  'Chased Price',
  'Revenge Trade',
  'Early Exit',
  'Moved Stop-Loss',
  'Over-leveraged',
  'Ignored Setup'
];

export default function TradeFormModal({ isOpen, onClose, tradeToEdit = null, onSaved }) {
  const { formatMoney } = useThemeAuth();

  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [segment, setSegment] = useState('IN_EQUITY');
  const [market, setMarket] = useState('IN');
  const [tradeType, setTradeType] = useState('LONG');
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [exitDate, setExitDate] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [exitPrice, setExitPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [targetPrice, setTargetPrice] = useState('');
  const [stopLossPrice, setStopLossPrice] = useState('');
  const [setup, setSetup] = useState('Breakout');
  const [timeframe, setTimeframe] = useState('Daily');
  const [emotions, setEmotions] = useState('Disciplined');
  const [discipline, setDiscipline] = useState(true);
  const [tags, setTags] = useState([]);
  const [customTag, setCustomTag] = useState('');
  const [notes, setNotes] = useState('');
  const [chartUrl, setChartUrl] = useState('');
  const [rating, setRating] = useState(4);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Live charges preview
  const [chargesPreview, setChargesPreview] = useState(null);

  useEffect(() => {
    if (tradeToEdit) {
      setSymbol(tradeToEdit.symbol || '');
      setName(tradeToEdit.name || '');
      setSegment(tradeToEdit.segment || 'IN_EQUITY');
      setMarket(tradeToEdit.market || 'IN');
      setTradeType(tradeToEdit.tradeType || 'LONG');
      setEntryDate(tradeToEdit.entryDate || tradeToEdit.date || new Date().toISOString().split('T')[0]);
      setExitDate(tradeToEdit.exitDate || '');
      setEntryPrice(tradeToEdit.entryPrice !== undefined && tradeToEdit.entryPrice !== null ? String(tradeToEdit.entryPrice) : '');
      setExitPrice(tradeToEdit.exitPrice !== undefined && tradeToEdit.exitPrice !== null ? String(tradeToEdit.exitPrice) : '');
      setQuantity(tradeToEdit.quantity ? String(tradeToEdit.quantity) : '1');
      setTargetPrice(tradeToEdit.targetPrice ? String(tradeToEdit.targetPrice) : '');
      setStopLossPrice(tradeToEdit.stopLossPrice ? String(tradeToEdit.stopLossPrice) : '');
      setSetup(tradeToEdit.setup || 'Breakout');
      setTimeframe(tradeToEdit.timeframe || 'Daily');
      setEmotions(tradeToEdit.emotions || 'Disciplined');
      setDiscipline(tradeToEdit.discipline !== undefined ? tradeToEdit.discipline : true);
      setTags(Array.isArray(tradeToEdit.tags) ? tradeToEdit.tags : []);
      setNotes(tradeToEdit.notes || '');
      setChartUrl(tradeToEdit.chartUrl || '');
      setRating(tradeToEdit.rating || 4);
    } else {
      setSymbol('');
      setName('');
      setSegment('IN_EQUITY');
      setMarket('IN');
      setTradeType('LONG');
      setEntryDate(new Date().toISOString().split('T')[0]);
      setExitDate('');
      setEntryPrice('');
      setExitPrice('');
      setQuantity('1');
      setTargetPrice('');
      setStopLossPrice('');
      setSetup('Breakout');
      setTimeframe('Daily');
      setEmotions('Disciplined');
      setDiscipline(true);
      setTags(['Followed Plan']);
      setNotes('');
      setChartUrl('');
      setRating(4);
    }
    setError('');
  }, [tradeToEdit, isOpen]);

  // Adjust market when segment changes
  const handleSegmentChange = (newSeg) => {
    setSegment(newSeg);
    setMarket(newSeg === 'US_EQUITY' ? 'US' : 'IN');
  };

  // Live charges calculation preview
  useEffect(() => {
    const ePrice = Number(entryPrice);
    const exPrice = exitPrice ? Number(exitPrice) : null;
    const qty = Number(quantity);

    if (ePrice > 0 && qty > 0) {
      axios.post('/api/trading-journal/calculate-preview', {
        market,
        segment,
        tradeType,
        entryPrice: ePrice,
        exitPrice: exPrice,
        quantity: qty
      })
      .then(res => {
        if (res.data?.success) {
          setChargesPreview(res.data.calculation);
        }
      })
      .catch(() => {});
    } else {
      setChargesPreview(null);
    }
  }, [market, segment, tradeType, entryPrice, exitPrice, quantity]);

  const toggleTag = (tag) => {
    if (tags.includes(tag)) {
      setTags(tags.filter(t => t !== tag));
    } else {
      setTags([...tags, tag]);
    }
  };

  const handleAddCustomTag = (e) => {
    e.preventDefault();
    if (customTag.trim() && !tags.includes(customTag.trim())) {
      setTags([...tags, customTag.trim()]);
      setCustomTag('');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!symbol.trim()) {
      setError('Please provide a stock or contract symbol.');
      return;
    }
    if (!entryPrice || Number(entryPrice) <= 0) {
      setError('Please enter a valid entry price.');
      return;
    }
    if (!quantity || Number(quantity) <= 0) {
      setError('Please enter a valid quantity.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    const payload = {
      symbol: symbol.trim().toUpperCase(),
      name: name.trim() || symbol.trim().toUpperCase(),
      market,
      segment,
      tradeType,
      entryDate,
      exitDate: exitDate || null,
      entryPrice: Number(entryPrice),
      exitPrice: exitPrice ? Number(exitPrice) : null,
      quantity: Number(quantity),
      targetPrice: targetPrice ? Number(targetPrice) : null,
      stopLossPrice: stopLossPrice ? Number(stopLossPrice) : null,
      setup,
      timeframe,
      emotions,
      discipline,
      tags,
      notes,
      chartUrl,
      rating: Number(rating)
    };

    try {
      if (tradeToEdit) {
        await axios.put(`/api/trading-journal/${tradeToEdit.id}`, payload);
      } else {
        await axios.post('/api/trading-journal', payload);
      }
      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save trade.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/70 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2 }}
        className="modal-surface reports-card rounded-3xl border border-[var(--border-color)] shadow-2xl w-full max-w-3xl overflow-hidden my-auto max-h-[90vh] flex flex-col"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)] reports-subcard">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-black text-inherit tracking-tight">
                {tradeToEdit ? 'Edit Trade Log' : 'Log New Trade'}
              </h3>
              <p className="text-[11px] text-[var(--text-muted)]">
                Record execution, psychology, and automated statutory charges
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* 1. Basic Instrument & Segment */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                Symbol / Contract *
              </label>
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="e.g. RELIANCE, NIFTY 24500 CE"
                className="w-full px-3 py-2 rounded-xl reports-subcard border border-[var(--border-color)] text-sm font-bold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-cyan-500/50 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                Company / Label
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Optional name"
                className="w-full px-3 py-2 rounded-xl reports-subcard border border-[var(--border-color)] text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-cyan-500/50 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                Market Segment
              </label>
              <select
                value={segment}
                onChange={(e) => handleSegmentChange(e.target.value)}
                className="w-full px-3 py-2 rounded-xl reports-subcard border border-[var(--border-color)] text-sm text-[var(--text-primary)] focus:border-cyan-500/50 focus:outline-none cursor-pointer"
              >
                {SEGMENTS.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 2. Trade Execution Details */}
          <div className="p-4 rounded-2xl reports-subcard border border-[var(--border-color)] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> Order Execution
              </span>
              <div className="flex items-center p-0.5 rounded-xl border border-[var(--border-color)] bg-black/20 text-xs">
                <button
                  type="button"
                  onClick={() => setTradeType('LONG')}
                  className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    tradeType === 'LONG'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Buy / Long
                </button>
                <button
                  type="button"
                  onClick={() => setTradeType('SHORT')}
                  className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    tradeType === 'SHORT'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Sell / Short
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">Entry Price *</label>
                <input
                  type="number"
                  step="any"
                  value={entryPrice}
                  onChange={(e) => setEntryPrice(e.target.value)}
                  placeholder="₹ 0.00"
                  className="w-full px-3 py-2 rounded-xl reports-subcard border border-[var(--border-color)] text-sm font-mono font-bold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-cyan-500/50 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">Quantity *</label>
                <input
                  type="number"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="1"
                  className="w-full px-3 py-2 rounded-xl reports-subcard border border-[var(--border-color)] text-sm font-mono font-bold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-cyan-500/50 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">Exit Price (if closed)</label>
                <input
                  type="number"
                  step="any"
                  value={exitPrice}
                  onChange={(e) => setExitPrice(e.target.value)}
                  placeholder="Leave empty if open"
                  className="w-full px-3 py-2 rounded-xl reports-subcard border border-[var(--border-color)] text-sm font-mono font-bold text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-cyan-500/50 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">Entry Date</label>
                <input
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl reports-subcard border border-[var(--border-color)] text-sm text-[var(--text-primary)] focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
            </div>

            {/* Target and Stop Loss */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">Target Price</label>
                <input
                  type="number"
                  step="any"
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                  placeholder="Target ₹"
                  className="w-full px-3 py-1.5 rounded-xl reports-subcard border border-[var(--border-color)] text-xs font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">Stop Loss Price</label>
                <input
                  type="number"
                  step="any"
                  value={stopLossPrice}
                  onChange={(e) => setStopLossPrice(e.target.value)}
                  placeholder="SL ₹"
                  className="w-full px-3 py-1.5 rounded-xl reports-subcard border border-[var(--border-color)] text-xs font-mono text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">Exit Date (if closed)</label>
                <input
                  type="date"
                  value={exitDate}
                  onChange={(e) => setExitDate(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl reports-subcard border border-[var(--border-color)] text-xs text-[var(--text-primary)] focus:border-cyan-500/50 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">Timeframe</label>
                <select
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl reports-subcard border border-[var(--border-color)] text-xs text-[var(--text-primary)] focus:border-cyan-500/50 focus:outline-none cursor-pointer"
                >
                  <option value="1m">1 min</option>
                  <option value="5m">5 min</option>
                  <option value="15m">15 min</option>
                  <option value="1h">1 Hour</option>
                  <option value="Daily">Daily</option>
                  <option value="Weekly">Weekly</option>
                </select>
              </div>
            </div>
          </div>

          {/* 3. Live Indian Statutory Charges Preview */}
          {chargesPreview && (
            <div className="p-3.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-xs space-y-2">
              <div className="flex items-center justify-between font-bold text-cyan-400">
                <span className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> Statutory Charges & Real P&L Engine
                </span>
                <span>Breakeven Exit: {chargesPreview.breakevenExit?.toFixed(2)}</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center pt-1 font-mono">
                <div className="p-1.5 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <div className="text-[8px] text-[var(--text-muted)] uppercase">Brokerage</div>
                  <div className="text-[11px] font-bold text-[var(--text-primary)]">₹{chargesPreview.brokerage?.toFixed(2)}</div>
                </div>
                <div className="p-1.5 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <div className="text-[8px] text-[var(--text-muted)] uppercase">STT</div>
                  <div className="text-[11px] font-bold text-[var(--text-primary)]">₹{chargesPreview.stt?.toFixed(2)}</div>
                </div>
                <div className="p-1.5 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <div className="text-[8px] text-[var(--text-muted)] uppercase">Exch & GST</div>
                  <div className="text-[11px] font-bold text-[var(--text-primary)]">₹{(chargesPreview.exchangeCharges + chargesPreview.gst)?.toFixed(2)}</div>
                </div>
                <div className="p-1.5 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <div className="text-[8px] text-[var(--text-muted)] uppercase">Total Charges</div>
                  <div className="text-[11px] font-bold text-amber-400">₹{chargesPreview.totalCharges?.toFixed(2)}</div>
                </div>
                <div className="p-1.5 rounded-xl reports-subcard border border-[var(--border-color)]">
                  <div className="text-[8px] text-[var(--text-muted)] uppercase">Gross P&L</div>
                  <div className={`text-[11px] font-bold ${chargesPreview.grossPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    ₹{chargesPreview.grossPnl?.toFixed(2)}
                  </div>
                </div>
                <div className="p-1.5 rounded-xl reports-subcard border border-cyan-500/40 bg-cyan-500/10">
                  <div className="text-[8px] text-cyan-400 uppercase font-bold">Net P&L</div>
                  <div className={`text-[11px] font-black ${chargesPreview.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    ₹{chargesPreview.netPnl?.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. Strategy & Psychology */}
          <div className="p-4 rounded-2xl reports-subcard border border-[var(--border-color)] space-y-3">
            <span className="text-xs font-black uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
              <Smile className="w-3.5 h-3.5" /> Mindset & Strategy Tagging
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">Trading Strategy / Setup</label>
                <select
                  value={setup}
                  onChange={(e) => setSetup(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl reports-subcard border border-[var(--border-color)] text-xs text-[var(--text-primary)] focus:border-cyan-500/50 focus:outline-none cursor-pointer"
                >
                  {STRATEGIES.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">Emotional State</label>
                <div className="flex flex-wrap gap-1.5">
                  {EMOTIONS.map(em => (
                    <button
                      key={em.id}
                      type="button"
                      onClick={() => setEmotions(em.id)}
                      className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        emotions === em.id
                          ? 'bg-purple-500/25 border border-purple-500/50 text-purple-300'
                          : 'reports-subcard border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {em.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Discipline Toggle */}
            <div className="flex items-center justify-between p-3 rounded-xl reports-subcard border border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <ShieldCheck className={`w-4 h-4 ${discipline ? 'text-emerald-400' : 'text-[var(--text-muted)]'}`} />
                <span className="text-xs font-bold text-inherit">Did you strictly adhere to your trade plan and risk sizing rules?</span>
              </div>
              <button
                type="button"
                onClick={() => setDiscipline(!discipline)}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  discipline
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                }`}
              >
                {discipline ? 'Rule Respected' : 'Rule Broken'}
              </button>
            </div>

            {/* Quick Habit / Mistake Tags */}
            <div>
              <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1.5">Tags (Mistakes & Good Habits)</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {COMMON_TAGS.map(tag => {
                  const selected = tags.includes(tag);
                  const isMistake = ['FOMO Entry', 'Chased Price', 'Revenge Trade', 'Early Exit', 'Moved Stop-Loss', 'Over-leveraged', 'Ignored Setup'].includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer ${
                        selected
                          ? isMistake
                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'reports-subcard border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>

              {/* Custom Tag Input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customTag}
                  onChange={(e) => setCustomTag(e.target.value)}
                  placeholder="+ Add custom tag and press Enter"
                  className="flex-1 px-3 py-1.5 rounded-xl reports-subcard border border-[var(--border-color)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-cyan-500/50 focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomTag(e);
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddCustomTag}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold reports-subcard border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-white/10 cursor-pointer transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* 5. Notes & Chart URL */}
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">Trade Rationale & Lessons Learned</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What prompted this entry? What went well or poorly in execution?"
                rows={3}
                className="w-full px-3 py-2 rounded-xl reports-subcard border border-[var(--border-color)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-cyan-500/50 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">Chart Screenshot URL</label>
                <input
                  type="url"
                  value={chartUrl}
                  onChange={(e) => setChartUrl(e.target.value)}
                  placeholder="https://tradingview.com/x/... or image link"
                  className="w-full px-3 py-1.5 rounded-xl reports-subcard border border-[var(--border-color)] text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:border-cyan-500/50 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-[var(--text-muted)] block mb-1">Execution Rating</label>
                <div className="flex items-center gap-1.5 pt-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      className={`text-lg transition-transform hover:scale-125 cursor-pointer ${
                        rating >= star ? 'text-amber-400' : 'text-[var(--border-color)]'
                      }`}
                    >
                      ★
                    </button>
                  ))}
                  <span className="text-xs text-[var(--text-muted)] font-mono ml-2">{rating}/5 Stars</span>
                </div>
              </div>
            </div>
          </div>

          {/* Form Action Footer */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--border-color)]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-white/5 transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20 transition-all cursor-pointer flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Saving...' : tradeToEdit ? 'Save Changes' : 'Record Trade'}</span>
            </button>
          </div>
        </form>
      </motion.div>
    </div>,
    document.body
  );
}
