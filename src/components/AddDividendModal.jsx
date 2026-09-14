import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import axios from 'axios';
import { X, Calendar, Search, Loader2, Coins, Check, ArrowRight } from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import HoldingLogo from './HoldingLogo';
import DatePicker from './common/DatePicker';

export default function AddDividendModal({ isOpen, onClose, onSuccess, holdings = [] }) {
  const { fxRate, formatMoney } = useThemeAuth();
  
  const [category, setCategory] = useState('in_stocks'); // 'in_stocks' | 'us_stocks'
  const [search, setSearch] = useState('');
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
  const [dividendAmount, setDividendAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [customFxRate, setCustomFxRate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  
  const dropdownRef = useRef(null);

  // Set FX rate when switching to US or changing paymentDate
  useEffect(() => {
    if (category === 'us_stocks') {
      if (paymentDate) {
        axios.get(`/api/fx-rate?date=${paymentDate}`)
          .then(res => {
            if (res.data?.rate) {
              setCustomFxRate(String(res.data.rate));
            }
          })
          .catch(() => {
            setCustomFxRate(fxRate ? String(fxRate) : '');
          });
      } else {
        setCustomFxRate(fxRate ? String(fxRate) : '');
      }
    }
  }, [category, paymentDate, fxRate]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Filter available holdings for selected category
  const availableHoldings = useMemo(() => {
    return holdings.filter(h => h.category_id === category);
  }, [holdings, category]);

  // Autocomplete matching
  const filteredHoldings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return availableHoldings.slice(0, 8);
    return availableHoldings.filter(h => 
      (h.name || '').toLowerCase().includes(q) || 
      (h.symbol || '').toLowerCase().includes(q)
    ).slice(0, 10);
  }, [availableHoldings, search]);

  const handleCategoryChange = (cat) => {
    setCategory(cat);
    setSelectedHolding(null);
    setSearch('');
    setErrorMsg(null);
  };

  const handleSelectHolding = (h) => {
    setSelectedHolding(h);
    setSearch(h.name || h.symbol);
    setIsDropdownOpen(false);
    setErrorMsg(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);

    const amt = Number(dividendAmount);
    if (isNaN(amt) || amt <= 0) {
      setErrorMsg('Please enter a valid dividend payout amount greater than 0.');
      return;
    }

    if (!selectedHolding && !search.trim()) {
      setErrorMsg('Please select a stock or enter a valid ticker symbol.');
      return;
    }

    const symbolKey = (selectedHolding?.symbol || search).trim().toUpperCase();
    const nameKey = (selectedHolding?.name || search).trim();

    setIsSubmitting(true);
    try {
      const isUS = category === 'us_stocks';
      const effectiveFx = isUS ? (Number(customFxRate) || fxRate || 0) : 1.0;

      await axios.post('/api/add-investment', {
        portfolio: category,
        holdingId: selectedHolding?.id || null,
        data: {
          type: 'DIVIDEND',
          symbol: symbolKey,
          name: nameKey,
          dividendAmount: amt,
          date: paymentDate,
          fxRate: effectiveFx
        }
      });

      // Reset form
      setDividendAmount('');
      setSelectedHolding(null);
      setSearch('');
      setIsSubmitting(false);

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to record dividend.');
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const isUS = category === 'us_stocks';
  const currSymbol = isUS ? '$' : '₹';
  const effectiveFx = Number(customFxRate) || fxRate || 0;
  const numAmt = Number(dividendAmount) || 0;
  const convertedINR = isUS ? (numAmt * effectiveFx) : numAmt;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94 }}
        transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="modal-surface w-full max-w-md rounded-3xl p-6 border border-slate-800 relative shadow-2xl space-y-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-400">
              <Coins className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">Add Dividend Entry</h3>
              <p className="text-[10px] text-slate-500 font-medium">Record dividend payout for equity portfolio</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-[11px] font-semibold text-rose-400">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Market / Category Selector */}
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
              Market / Portfolio
            </label>
            <div className="flex items-center gap-1.5 p-1 bg-slate-900/80 border border-slate-800 rounded-2xl">
              <button
                type="button"
                onClick={() => handleCategoryChange('in_stocks')}
                className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all ${
                  category === 'in_stocks'
                    ? 'bg-emerald-500 text-obsidian-950 shadow-md font-black'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Indian Equity (₹)
              </button>
              <button
                type="button"
                onClick={() => handleCategoryChange('us_stocks')}
                className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all ${
                  category === 'us_stocks'
                    ? 'bg-purple-500 text-white shadow-md font-black'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                US Equity ($)
              </button>
            </div>
          </div>

          {/* Stock Search & Autocomplete */}
          <div className="relative" ref={dropdownRef}>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Select Stock / Asset
              </label>
              <span className="px-2 py-0.5 rounded-md text-[9px] font-black bg-amber-500/15 text-amber-400 border border-amber-500/30">
                DIVIDEND
              </span>
            </div>

            {selectedHolding ? (
              <div className="flex items-center justify-between p-2.5 bg-slate-900/80 border border-slate-700 rounded-xl">
                <div className="flex items-center gap-2.5">
                  <HoldingLogo
                    holding={selectedHolding}
                    className="w-7 h-7 rounded-lg"
                    fallbackClass="text-[10px]"
                    accentColor={isUS ? '#a855f7' : '#10b981'}
                  />
                  <div>
                    <div className="text-xs font-bold text-white">{selectedHolding.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{selectedHolding.symbol}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedHolding(null); setSearch(''); }}
                  className="text-[10px] text-slate-400 hover:text-rose-400 font-bold px-2 py-1 hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  placeholder={`Search ${category === 'in_stocks' ? 'Indian' : 'US'} stocks (e.g. ${category === 'in_stocks' ? 'TCS, INFY' : 'AAPL, AVGO'})...`}
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setIsDropdownOpen(true); }}
                  onFocus={() => setIsDropdownOpen(true)}
                  className="w-full pl-9 pr-10 py-2 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5" aria-label="Clear search">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}

                {isDropdownOpen && filteredHoldings.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1.5 z-50 max-h-48 overflow-y-auto rounded-xl border border-slate-700 modal-surface shadow-2xl backdrop-blur-2xl">
                    {filteredHoldings.map((h) => (
                      <button
                        key={h.id || h.symbol}
                        type="button"
                        onClick={() => handleSelectHolding(h)}
                        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-800/70 transition-colors border-b border-slate-800/30 last:border-b-0"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <HoldingLogo
                            holding={h}
                            className="w-6 h-6 rounded-md shrink-0"
                            fallbackClass="text-[9px]"
                            accentColor={isUS ? '#a855f7' : '#10b981'}
                          />
                          <div className="truncate">
                            <div className="text-xs font-bold text-white truncate">{h.name}</div>
                            <div className="text-[9px] text-slate-400 font-mono">{h.symbol}</div>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0">
                          {Number(h.quantity || 0) > 0 ? `${Number(h.quantity).toFixed(0)} sh` : 'Exited'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Amount & Date Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                Dividend Payout ({currSymbol})
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-bold">
                  {currSymbol}
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  placeholder="0.00"
                  value={dividendAmount}
                  onChange={(e) => setDividendAmount(e.target.value)}
                  className="w-full pl-7 pr-3 py-2 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                Payment Date
              </label>
              <DatePicker
                required
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                inputClassName="py-2 pl-3 pr-3 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white font-mono focus:border-blue-500"
              />
            </div>

          </div>

          {/* USD/INR FX Rate (US Stocks Only) */}
          {isUS && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  USD/INR Exchange Rate
                </label>
                {fxRate ? <span className="text-[9.5px] font-mono text-slate-500">Live: ₹{Number(fxRate).toFixed(2)}</span> : null}
              </div>
              <input
                type="number"
                step="0.01"
                min="1"
                required
                value={customFxRate}
                onChange={(e) => setCustomFxRate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-purple-500"
              />
            </div>
          )}

          {/* Converted Preview Pill */}
          {numAmt > 0 && isUS && (
            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-between text-xs">
              <span className="text-slate-400 text-[11px]">INR Credited Value:</span>
              <span className="font-mono font-bold text-purple-300">
                ≈ ₹{convertedINR.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-slate-800/40 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl text-xs font-black text-obsidian-950 bg-emerald-500 hover:bg-emerald-400 shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Recording...
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                  Record Dividend
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
