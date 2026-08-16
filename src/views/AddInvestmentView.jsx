import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import axios from 'axios';
import {
  CandlestickChart, Globe, LineChart, Shield, Landmark, Briefcase, CreditCard,
  PlusCircle, Search, CheckCircle2, ArrowRight, ChevronDown, X, Loader2,
  IndianRupee, DollarSign, Calendar, Receipt, Percent, TrendingUp, TrendingDown,
  Banknote, SplitSquareHorizontal, Gift, RefreshCw
} from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';

// Portfolio type configurations
const PORTFOLIOS = [
  {
    id: 'in_stocks', label: 'Indian Equity', icon: CandlestickChart,
    gradient: 'from-emerald-500 to-teal-600', color: '#10B981',
    description: 'NSE / BSE listed stocks'
  },
  {
    id: 'us_stocks', label: 'US Equity', icon: Globe,
    gradient: 'from-blue-500 to-indigo-600', color: '#3B82F6',
    description: 'NASDAQ / NYSE listed stocks'
  },
  {
    id: 'mutual_funds', label: 'Mutual Funds', icon: LineChart,
    gradient: 'from-violet-500 to-purple-600', color: '#8B5CF6',
    description: 'AMFI registered schemes'
  },
  {
    id: 'nps', label: 'NPS', icon: Shield,
    gradient: 'from-cyan-500 to-sky-600', color: '#06B6D4',
    description: 'National Pension System'
  },
  {
    id: 'bank', label: 'Bank Accounts', icon: Landmark,
    gradient: 'from-amber-500 to-orange-600', color: '#F59E0B',
    description: 'Savings & fixed deposits'
  },
  {
    id: 'epf', label: 'EPF', icon: Briefcase,
    gradient: 'from-rose-500 to-pink-600', color: '#F43F5E',
    description: 'Employee Provident Fund'
  },
  {
    id: 'loans', label: 'Loan', icon: Banknote,
    gradient: 'from-red-500 to-rose-600', color: '#EF4444',
    description: 'Home, personal, auto loans'
  },
  {
    id: 'credit_cards', label: 'Credit Card', icon: CreditCard,
    gradient: 'from-fuchsia-500 to-pink-600', color: '#D946EF',
    description: 'Expense & payment tracking'
  }
];

// Transaction types per portfolio
const TX_TYPES = {
  in_stocks: ['BUY', 'SELL', 'BONUS', 'DIVIDEND', 'SPLIT'],
  us_stocks: ['BUY', 'SELL', 'BONUS', 'DIVIDEND', 'SPLIT'],
  mutual_funds: ['BUY', 'SELL', 'DIVIDEND'],
  nps: ['BUY', 'SELL'],
  loans: ['TAKE', 'PAY'],
  credit_cards: []
};

// Autocomplete dropdown component
function AutocompleteDropdown({ items, onSelect, isLoading, highlightText }) {
  if (!items.length && !isLoading) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="absolute left-0 right-0 top-full mt-1 z-[100] max-h-56 overflow-y-auto rounded-xl border border-slate-700 modal-surface shadow-2xl backdrop-blur-2xl"
    >
      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Searching...
        </div>
      ) : (
        items.map((item, idx) => (
          <button
            key={item.symbol || item.schemeCode || idx}
            onClick={() => onSelect(item)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-slate-800/60 transition-colors border-b border-slate-800/30 last:border-b-0 group"
          >
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-white truncate group-hover:text-emerald-400 transition-colors">
                {item.schemeName || item.name}
              </div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                {item.symbol || item.schemeCode}
                {item.exchange && <span className="ml-1.5 text-slate-600">{item.exchange}</span>}
              </div>
            </div>
            <ArrowRight className="w-3 h-3 text-slate-600 group-hover:text-emerald-400 transition-colors shrink-0 ml-2" />
          </button>
        ))
      )}
    </motion.div>
  );
}

// Custom Select Component for beautiful dropdowns
function CustomSelect({ options, value, onChange, placeholder, onAddNew, disabled }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (disabled) {
    return (
      <div className="w-full px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-400 font-semibold cursor-not-allowed">
        {value || placeholder}
      </div>
    );
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs font-semibold flex items-center justify-between focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
      >
        <span className={value ? 'text-white' : 'text-slate-600'}>
          {value || placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 right-0 top-full mt-2 z-[100] max-h-56 overflow-y-auto rounded-xl border border-slate-700 modal-surface shadow-2xl backdrop-blur-2xl py-1"
          >
            {onAddNew && (
              <button
                type="button"
                onClick={() => { onAddNew(); setIsOpen(false); }}
                className="w-full px-3 py-2.5 text-left text-xs font-bold text-blue-400 hover:text-blue-300 hover:bg-slate-800/60 transition-colors border-b border-slate-800 mb-1"
              >
                + Add New...
              </button>
            )}
            {options.map((opt) => (
              <button
                key={opt.value || opt}
                type="button"
                onClick={() => { onChange(opt.value || opt); setIsOpen(false); }}
                className="w-full px-3 py-2.5 text-left text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
              >
                {opt.label || opt}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


export default function AddInvestmentView({ onRefresh, initialPortfolio }) {
  const { theme, fxRate, availableThemes } = useThemeAuth();
  const [selectedPortfolio, setSelectedPortfolio] = useState(initialPortfolio || null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [mfNavInfo, setMfNavInfo] = useState(null);
  const [holdings, setHoldings] = useState([]);

  // Form state
  const [formData, setFormData] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [existingAccounts, setExistingAccounts] = useState({ banks: [], epf: [], loans: [], creditCards: [] });
  const [isNewAccount, setIsNewAccount] = useState(false);

  // NPS schemes
  const [npsSchemes, setNpsSchemes] = useState([]);

  const searchTimeoutRef = useRef(null);
  const dropdownRef = useRef(null);

  // Get accent color from current theme
  const currentTheme = availableThemes.find(t => t.id === theme) || availableThemes[0];
  const accentColor = currentTheme.accent;

  // Reset form when portfolio changes
  useEffect(() => {
    setFormData({
      type: selectedPortfolio === 'loans' ? 'TAKE' : 'BUY',
      date: new Date().toISOString().split('T')[0],
      fxRate: fxRate
    });
    setSearchQuery('');
    setSearchResults([]);
    setShowDropdown(false);
    setIsNewAccount(false);
    setSuccessMsg(null);
    setErrorMsg(null);
    setMfNavInfo(null);
  }, [selectedPortfolio, fxRate]);

  // Load NPS schemes and existing accounts on mount
  useEffect(() => {
    const init = async () => {
      try {
        const [accRes, npsRes, hRes] = await Promise.all([
          axios.get('/api/accounts'),
          axios.get('/api/search/nps-schemes'),
          axios.get('/api/holdings')
        ]);
        setExistingAccounts(accRes.data || { banks: [], epf: [], loans: [], creditCards: [] });
        setNpsSchemes(npsRes.data || []);
        setHoldings(hRes.data || []);
      } catch (err) {}
    };
    init();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Fetch Mutual Fund NAV when schemeCode or date changes
  useEffect(() => {
    if (selectedPortfolio === 'mutual_funds' && formData.schemeCode && formData.date) {
      const fetchNav = async () => {
        try {
          const navRes = await axios.get(`/api/nav/mutual-funds/${formData.schemeCode}?date=${formData.date}`);
          if (navRes.data && navRes.data.nav) {
            updateField('price', navRes.data.nav);
            setMfNavInfo(`NAV: ₹${navRes.data.nav} (As of ${navRes.data.date})`);
          }
        } catch (err) {
          setMfNavInfo(null);
        }
      };
      fetchNav();
    }
  }, [formData.schemeCode, formData.date, selectedPortfolio]);

  // Auto-calculate charges for Mutual Funds on amount change
  useEffect(() => {
    if (selectedPortfolio === 'mutual_funds' && formData.type === 'BUY' && formData.amount) {
      const amt = Number(formData.amount);
      if (amt > 0) {
        updateField('charges', (amt * 0.00015).toFixed(4));
      }
    }
  }, [formData.amount, formData.type, selectedPortfolio]);

  // Auto-clear messages
  useEffect(() => {
    if (successMsg || errorMsg) {
      const t = setTimeout(() => { setSuccessMsg(null); setErrorMsg(null); }, 5000);
      return () => clearTimeout(t);
    }
  }, [successMsg, errorMsg]);

  // Debounced search
  const handleSearch = useCallback((query, portfolio) => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (!query || query.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    setIsSearching(true);
    setShowDropdown(true);

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        let results = [];
        if (portfolio === 'in_stocks') {
          const res = await axios.get(`/api/search/stocks?q=${encodeURIComponent(query)}&market=india`);
          results = res.data;
        } else if (portfolio === 'us_stocks') {
          const res = await axios.get(`/api/search/stocks?q=${encodeURIComponent(query)}&market=us`);
          results = res.data;
        } else if (portfolio === 'mutual_funds') {
          const res = await axios.get(`/api/search/mutual-funds?q=${encodeURIComponent(query)}`);
          results = res.data;
        }
        setSearchResults(results);
      } catch (err) {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  const handleSelectResult = async (item) => {
    if (selectedPortfolio === 'mutual_funds') {
      setFormData(prev => ({
        ...prev,
        symbol: item.schemeCode,
        name: item.schemeName,
        schemeCode: item.schemeCode
      }));
      setSearchQuery(item.schemeName);
    } else {
      const cleanSymbol = (item.symbol || '').replace(/\.(NS|BO)$/i, '');
      setFormData(prev => ({
        ...prev,
        symbol: cleanSymbol,
        name: item.name
      }));
      setSearchQuery(item.name);
    }
    setShowDropdown(false);
    setSearchResults([]);
  };

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const payload = {
        portfolio: selectedPortfolio,
        data: { ...formData }
      };

      // For dividends, set dividendAmount from the amount field
      if (formData.type === 'DIVIDEND') {
        payload.data.dividendAmount = Number(formData.dividendAmount) || 0;
      }

      const res = await axios.post('/api/add-investment', payload);

      if (res.data.success) {
        setSuccessMsg(`Investment recorded successfully`);
        // Reset form for another entry
        setFormData({
          type: selectedPortfolio === 'loans' ? 'TAKE' : 'BUY',
          date: new Date().toISOString().split('T')[0],
          fxRate: fxRate
        });
        setSearchQuery('');
        setMfNavInfo(null);
        if (onRefresh) onRefresh();
      }
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Portfolio type icon helpers
  const getTxTypeIcon = (type) => {
    switch (type) {
      case 'BUY': return TrendingUp;
      case 'SELL': return TrendingDown;
      case 'BONUS': return Gift;
      case 'DIVIDEND': return IndianRupee;
      case 'SPLIT': return SplitSquareHorizontal;
      case 'EXPENSE': return Receipt;
      case 'PAYMENT': return Banknote;
      default: return PlusCircle;
    }
  };

  const getTxTypeColor = (type) => {
    switch (type) {
      case 'BUY': case 'TAKE': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'SELL': case 'PAY': return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
      case 'BONUS': case 'DIVIDEND': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'SPLIT': return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
    }
  };

  // Render portfolio-specific form
  const renderForm = () => {
    if (!selectedPortfolio) return null;
    const portfolio = PORTFOLIOS.find(p => p.id === selectedPortfolio);
    if (!portfolio) return null;

    // Market-based portfolios (Indian Equity, US Equity, MF, NPS)
    if (['in_stocks', 'us_stocks', 'mutual_funds', 'nps'].includes(selectedPortfolio)) {
      return renderMarketForm(portfolio.id);
    }

    // Balance-based (Bank, EPF)
    if (selectedPortfolio === 'bank' || selectedPortfolio === 'epf') {
      return renderBalanceForm(portfolio.id);
    }

    // Loan
    if (selectedPortfolio === 'loans') {
      return renderLoanForm(portfolio.id);
    }

    // Credit Card
    if (selectedPortfolio === 'credit_cards') {
      return renderCreditCardForm(portfolio.id);
    }
  };

  const renderMarketForm = (portfolio) => {
    const isMF = portfolio === 'mutual_funds';
    const isNPS = portfolio === 'nps';
    const txTypes = TX_TYPES[portfolio] || TX_TYPES.in_stocks;
    const currentType = formData.type || txTypes[0];
    const isUS = portfolio === 'us_stocks';
    const currSymbol = isUS ? '$' : '₹';
    
    // Find current holding quantity for validation on SELL
    const currentHoldingQty = holdings.find(h => h.symbol === formData.symbol || h.symbol === formData.schemeCode)?.quantity || 0;

    return (
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Transaction Type Selector */}
        <div>
          <label className="block text-[10px] font-extrabold text-slate-500 mb-2 uppercase tracking-wider">Transaction Type</label>
          <div className="flex flex-wrap gap-2">
            {txTypes.map(type => {
              const Icon = getTxTypeIcon(type);
              const isActive = currentType === type;
              return (
                <motion.button
                  key={type}
                  type="button"
                  onClick={() => updateField('type', type)}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all ${
                    isActive
                      ? getTxTypeColor(type) + ' shadow-lg'
                      : 'text-slate-500 bg-slate-900/50 border-slate-800 hover:border-slate-600'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {type}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Symbol / Name Search */}
        {currentType !== 'SPLIT' && (
          <div className="relative" ref={dropdownRef}>
            <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">
              {isMF ? 'Scheme Name' : isNPS ? 'NPS Scheme' : 'Symbol / Name'}
            </label>

            {isNPS ? (
              <CustomSelect
                value={formData.name || ''}
                onChange={(val) => {
                  const scheme = npsSchemes.find(s => s.schemeCode === val);
                  if (scheme) {
                    updateField('symbol', scheme.schemeCode);
                    updateField('name', scheme.schemeName);
                    updateField('schemeCode', scheme.schemeCode);
                  }
                }}
                placeholder="Select NPS Scheme..."
                options={npsSchemes.map(s => ({ value: s.schemeCode, label: `${s.schemeName} (${s.schemeCode})` }))}
              />
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (!e.target.value) { updateField('symbol', ''); updateField('name', ''); }
                      handleSearch(e.target.value, portfolio);
                    }}
                    onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
                    placeholder={isMF ? 'Search mutual fund schemes...' : 'Search stock name or ticker...'}
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
                  />
                  {searchQuery && (
                    <button type="button" onClick={() => { setSearchQuery(''); updateField('symbol', ''); updateField('name', ''); }} className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X className="w-3.5 h-3.5"/></button>
                  )}
                  {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-slate-400" />}
                </div>

                <AnimatePresence>
                  {showDropdown && (searchResults.length > 0 || isSearching) && (
                    <AutocompleteDropdown
                      items={searchResults}
                      onSelect={handleSelectResult}
                      isLoading={isSearching}
                      highlightText={searchQuery}
                    />
                  )}
                </AnimatePresence>
              </>
            )}

            {/* Selected symbol badge */}
            {formData.symbol && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-2 flex items-center gap-2"
              >
                <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold font-mono">
                  {formData.symbol}
                </span>
                <span className="text-[10px] text-slate-400 truncate">{formData.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    updateField('symbol', '');
                    updateField('name', '');
                    setSearchQuery('');
                  }}
                  className="text-slate-600 hover:text-rose-400 transition-colors ml-auto"
                >
                  <X className="w-3 h-3" />
                </button>
              </motion.div>
            )}
          </div>
        )}

        {/* Split-specific: Symbol selector */}
        {currentType === 'SPLIT' && (
          <div className="relative" ref={dropdownRef}>
            <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">
              Stock to Split
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  handleSearch(e.target.value, portfolio);
                }}
                onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
                placeholder="Search existing stock to split..."
                className="w-full pl-9 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
              />
            </div>
            <AnimatePresence>
              {showDropdown && (searchResults.length > 0 || isSearching) && (
                <AutocompleteDropdown
                  items={searchResults}
                  onSelect={handleSelectResult}
                  isLoading={isSearching}
                  highlightText={searchQuery}
                />
              )}
            </AnimatePresence>
            {formData.symbol && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-[10px] font-bold font-mono">{formData.symbol}</span>
                <span className="text-[10px] text-slate-400 truncate">{formData.name}</span>
              </motion.div>
            )}
          </div>
        )}

        {/* Dividend-specific fields */}
        {currentType === 'DIVIDEND' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">
                Total Dividend Amount ({currSymbol})
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-bold">{currSymbol}</span>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={formData.dividendAmount || ''}
                  onChange={(e) => updateField('dividendAmount', e.target.value)}
                  placeholder="5,000"
                  className="w-full pl-7 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 placeholder-slate-600"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">Payment Date</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="date"
                  required
                  value={formData.date || ''}
                  onChange={(e) => updateField('date', e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                />
              </div>
            </div>
            {isUS && (
              <div>
                <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">USD/INR Rate</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.fxRate || fxRate}
                  onChange={(e) => updateField('fxRate', e.target.value)}
                  className="w-full px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                />
              </div>
            )}
          </div>
        )}

        {/* Split-specific fields */}
        {currentType === 'SPLIT' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">
                Split Old Quantity
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={formData.splitOldQty || ''}
                  onChange={(e) => updateField('splitOldQty', e.target.value)}
                  placeholder="e.g. 2"
                  className="w-full px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 placeholder-slate-600"
                />
              </div>
              <p className="text-[9px] text-slate-600 mt-1">If 2 becomes 3, enter 2 here.</p>
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">
                Split New Quantity
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  min="0"
                  required
                  value={formData.splitNewQty || ''}
                  onChange={(e) => updateField('splitNewQty', e.target.value)}
                  placeholder="e.g. 3"
                  className="w-full px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 placeholder-slate-600"
                />
              </div>
              <p className="text-[9px] text-slate-600 mt-1">If 2 becomes 3, enter 3 here.</p>
            </div>
            <div>
              <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">Record Date</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <input
                  type="date"
                  required
                  value={formData.date || ''}
                  onChange={(e) => updateField('date', e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                />
              </div>
            </div>
          </div>
        )}

        {/* Standard transaction fields (BUY/SELL/BONUS/REDEEM) */}
        {!['DIVIDEND', 'SPLIT'].includes(currentType) && (
          <>
            <div className="grid grid-cols-2 gap-4">
              {isMF && currentType === 'BUY' ? (
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">
                    Amount Added ({currSymbol})
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-bold">{currSymbol}</span>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      required
                      value={formData.amount || ''}
                      onChange={(e) => updateField('amount', e.target.value)}
                      placeholder="10000"
                      className="w-full pl-7 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
                    />
                  </div>
                  <p className="text-[9px] text-slate-600 mt-1">0.015% charges will be auto-deducted.</p>
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">
                    {isMF ? 'Units' : 'Quantity'}
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    max={currentType === 'SELL' ? currentHoldingQty : undefined}
                    required
                    value={formData.quantity || ''}
                    onChange={(e) => updateField('quantity', e.target.value)}
                    placeholder={isMF ? '150.123' : '100'}
                    className="w-full px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
                  />
                  {currentType === 'SELL' && formData.symbol && (
                    <p className="text-[10px] font-medium text-blue-400 mt-1">
                      Available to sell: {currentHoldingQty} Units
                    </p>
                  )}
                </div>
              )}
              <div>
                <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">
                  {isMF ? `NAV (${currSymbol})` : `Price (${currSymbol})`}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 font-bold">{currSymbol}</span>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    disabled={currentType === 'BONUS'}
                    required={currentType !== 'BONUS'}
                    value={currentType === 'BONUS' ? 0 : formData.price || ''}
                    onChange={(e) => updateField('price', e.target.value)}
                    placeholder={currentType === 'BONUS' ? "0" : "1,250.50"}
                    className={`w-full pl-7 pr-8 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600 ${currentType === 'BONUS' ? 'opacity-50 cursor-not-allowed' : ''}`}
                  />
                  {formData.price && currentType !== 'BONUS' && (
                    <button type="button" onClick={() => updateField('price', '')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X className="w-3.5 h-3.5"/></button>
                  )}
                </div>
                {mfNavInfo && isMF && (
                  <p className="mt-1.5 text-[10px] text-blue-400 font-medium">{mfNavInfo}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">Transaction Date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="date"
                    required
                    value={formData.date || ''}
                    onChange={(e) => updateField('date', e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">
                  Charges ({currSymbol})
                </label>
                <div className="relative">
                  <Receipt className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="number"
                    step="any"
                    value={formData.charges || ''}
                    onChange={(e) => updateField('charges', e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
                  />
                </div>
              </div>
            </div>

            {/* US Equity: FX Rate */}
            {isUS && (
              <div className="w-1/2">
                <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">USD/INR Rate</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="number"
                    step="0.01"
                    value={formData.fxRate || fxRate}
                    onChange={(e) => updateField('fxRate', e.target.value)}
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                  />
                </div>
                <p className="text-[9px] text-slate-600 mt-1">Today's live rate: ₹{fxRate}</p>
              </div>
            )}
          </>
        )}

        {/* Calculated total preview */}
        {((formData.quantity || formData.amount) && (formData.price || currentType === 'BONUS') && !['DIVIDEND', 'SPLIT'].includes(currentType)) && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="glass-subcard rounded-xl p-3 flex flex-col gap-1 justify-center"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                {currentType === 'BONUS' ? 'Bonus Value' : 'Total Transaction Value'}
              </span>
              <span className="text-sm font-black text-white tracking-tight">
                {currentType === 'BONUS' ? '₹0.00' : (
                  formData.amount ? currSymbol + Number(formData.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                  : currSymbol + (Number(formData.quantity) * Number(formData.price)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                )}
              </span>
            </div>
            {isMF && currentType === 'BUY' && formData.amount && (
              <div className="flex items-center justify-between mt-1 pt-1 border-t border-slate-800/50">
                <span className="text-[10px] font-medium text-slate-500">Includes MF 0.015% Charges</span>
                <span className="text-[10px] font-bold text-orange-400/80">
                  - ₹{(Number(formData.amount) * 0.00015).toFixed(4)}
                </span>
              </div>
            )}
          </motion.div>
        )}

        {/* SIP Options for Mutual Funds */}
        {isMF && currentType === 'BUY' && (
          <div className="glass-subcard rounded-xl p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-extrabold text-slate-400 uppercase">SIP Mode</div>
                <div className="text-[9px] text-slate-600 mt-0.5">Automatically repeat this investment</div>
              </div>
              <button
                type="button"
                onClick={() => updateField('sipEnabled', !formData.sipEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${formData.sipEnabled ? 'bg-violet-500' : 'bg-slate-700'}`}
              >
                <motion.div
                  animate={{ x: formData.sipEnabled ? 20 : 2 }}
                  className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow"
                />
              </button>
            </div>
            
            {formData.sipEnabled && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 pt-3 border-t border-slate-800 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">Frequency</label>
                    <CustomSelect
                      value={formData.sipFrequency || 'Monthly'}
                      onChange={(val) => updateField('sipFrequency', val)}
                      placeholder="Frequency"
                      options={['Weekly', 'Fortnightly', 'Monthly', 'Yearly']}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">End Date</label>
                    <CustomSelect
                      value={formData.sipIndefinite === false ? 'Specific Date' : 'Until Cancelled'}
                      onChange={(val) => {
                        if (val === 'Until Cancelled') {
                          updateField('sipIndefinite', true);
                          updateField('sipEndDate', '');
                        } else {
                          updateField('sipIndefinite', false);
                        }
                      }}
                      placeholder="End Date"
                      options={['Until Cancelled', 'Specific Date']}
                    />
                  </div>
                </div>
                {formData.sipIndefinite === false && (
                  <div>
                    <input
                      type="date"
                      value={formData.sipEndDate || ''}
                      onChange={(e) => updateField('sipEndDate', e.target.value)}
                      className="w-full px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white focus:outline-none"
                    />
                  </div>
                )}
              </motion.div>
            )}
          </div>
        )}

        {/* Submit */}
        {renderSubmitButton()}
      </form>
    );
  };

  const renderBalanceForm = (portfolio) => {
    return (
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">
            {selectedPortfolio === 'epf' ? 'Account Label' : 'Account Name'}
          </label>
          {selectedPortfolio === 'epf' && !isNewAccount ? (
            <CustomSelect
              value={formData.name || 'Employee Provident Fund'}
              disabled={true}
              placeholder="Employee Provident Fund"
            />
          ) : !isNewAccount ? (
            <CustomSelect
              value={formData.name || ''}
              onChange={(val) => updateField('name', val)}
              placeholder="Select Account..."
              options={existingAccounts.banks}
              onAddNew={() => setIsNewAccount(true)}
            />
          ) : (
            <div className="relative">
              <input
                type="text"
                required
                value={formData.name || ''}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="e.g. HDFC Savings"
                className="w-full px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
              />
              <button
                type="button"
                onClick={() => { setIsNewAccount(false); updateField('name', ''); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">Current Balance (₹)</label>
            <div className="relative">
              <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={formData.balance || ''}
                onChange={(e) => updateField('balance', e.target.value)}
                placeholder="1,50,000"
                className="w-full pl-9 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">As of Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="date"
                value={formData.date || ''}
                onChange={(e) => updateField('date', e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
              />
            </div>
          </div>
        </div>

        {renderSubmitButton()}
      </form>
    );
  };

  const renderLoanForm = (portfolio) => {
    return (
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">Loan Name</label>
          {!isNewAccount ? (
            <CustomSelect
              value={formData.name || ''}
              onChange={(val) => updateField('name', val)}
              placeholder="Select Loan..."
              options={existingAccounts.loans}
              onAddNew={() => setIsNewAccount(true)}
            />
          ) : (
            <div className="relative">
              <input
                type="text"
                required
                value={formData.name || ''}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="e.g. Housing Loan"
                className="w-full px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
              />
              <button
                type="button"
                onClick={() => { setIsNewAccount(false); updateField('name', ''); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">
              Outstanding Balance (₹)
            </label>
            <div className="relative">
              <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={formData.balance || ''}
                onChange={(e) => updateField('balance', e.target.value)}
                placeholder="50,00,000"
                className="w-full pl-9 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">As of Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="date"
                required
                value={formData.date || ''}
                onChange={(e) => updateField('date', e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
              />
            </div>
          </div>
        </div>

        {renderSubmitButton()}
      </form>
    );
  };

  const renderCreditCardForm = (portfolio) => {
    return (
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">Card Name</label>
          {!isNewAccount ? (
            <CustomSelect
              value={formData.name || ''}
              onChange={(val) => updateField('name', val)}
              placeholder="Select Credit Card..."
              options={existingAccounts.creditCards}
              onAddNew={() => setIsNewAccount(true)}
            />
          ) : (
            <div className="relative">
              <input
                type="text"
                required
                value={formData.name || ''}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="e.g. HDFC Millennia"
                className="w-full px-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
              />
              <button
                type="button"
                onClick={() => { setIsNewAccount(false); updateField('name', ''); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">
              Outstanding Balance (₹)
            </label>
            <div className="relative">
              <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={formData.balance || ''}
                onChange={(e) => updateField('balance', e.target.value)}
                placeholder="15,000"
                className="w-full pl-9 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder-slate-600"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-extrabold text-slate-500 mb-1.5 uppercase tracking-wider">As of Date</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="date"
                required
                value={formData.date || ''}
                onChange={(e) => updateField('date', e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 bg-slate-900/60 border border-slate-700 rounded-xl text-xs text-white font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
              />
            </div>
          </div>
        </div>

        {renderSubmitButton()}
      </form>
    );
  };

  const renderSubmitButton = () => (
    <div className="pt-3 flex items-center justify-between">
      <AnimatePresence>
        {successMsg && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="flex items-center gap-1.5 text-emerald-400 text-xs font-bold"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {successMsg}
          </motion.div>
        )}
        {errorMsg && (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className="flex items-center gap-1.5 text-rose-400 text-xs font-bold"
          >
            <X className="w-3.5 h-3.5" />
            {errorMsg}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-2.5 ml-auto">
        <button
          type="button"
          onClick={() => setSelectedPortfolio(null)}
          className="px-4 py-2 bg-slate-800/80 hover:bg-slate-700 rounded-xl text-xs font-semibold text-slate-400 border border-slate-700"
        >
          Back
        </button>
        <motion.button
          type="submit"
          disabled={isSubmitting}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="px-5 py-2 rounded-xl text-xs font-extrabold shadow-lg flex items-center gap-2 disabled:opacity-50"
          style={{
            background: `linear-gradient(135deg, ${accentColor}, ${accentColor}CC)`,
            color: '#0A0A0A',
            boxShadow: `0 4px 20px ${accentColor}33`
          }}
        >
          {isSubmitting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <PlusCircle className="w-3.5 h-3.5" />
          )}
          {isSubmitting ? 'Saving...' : 'Save Entry'}
        </motion.button>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-xl font-extrabold text-white tracking-tight">Add Investment</h1>
      </div>

      {/* Portfolio Selector Grid */}
      <AnimatePresence mode="wait">
        {!selectedPortfolio ? (
          <motion.div
            key="selector"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -12 }}
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3"
          >
            {PORTFOLIOS.map((p, idx) => {
              const Icon = p.icon;
              return (
                <motion.button
                  key={p.id}
                  onClick={() => setSelectedPortfolio(p.id)}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05, duration: 0.3 }}
                  whileHover={{ scale: 1.03, y: -3 }}
                  whileTap={{ scale: 0.97 }}
                  className="glass-subcard rounded-2xl p-5 flex flex-col items-start gap-3 text-left border border-slate-800 hover:border-slate-600 transition-all group cursor-pointer relative overflow-hidden"
                >
                  {/* Glow accent */}
                  <div
                    className="absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl opacity-0 group-hover:opacity-20 transition-opacity duration-500"
                    style={{ background: p.color }}
                  />

                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${p.gradient} flex items-center justify-center shadow-lg`}>
                    <Icon className="w-5 h-5 text-white" />
                  </div>

                  <div>
                    <div className="text-sm font-extrabold text-white group-hover:text-slate-50 transition-colors">
                      {p.label}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{p.description}</div>
                  </div>

                  <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0">
                    <ArrowRight className="w-4 h-4" style={{ color: p.color }} />
                  </div>
                </motion.button>
              );
            })}
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.3 }}
            className="max-w-2xl"
          >
            {/* Selected portfolio header */}
            {(() => {
              const p = PORTFOLIOS.find(p => p.id === selectedPortfolio);
              if (!p) return null;
              const Icon = p.icon;
              return (
                <div className="flex items-center gap-3 mb-6">
                  <motion.div
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    className={`w-10 h-10 rounded-xl bg-gradient-to-br ${p.gradient} flex items-center justify-center shadow-lg`}
                  >
                    <Icon className="w-5 h-5 text-white" />
                  </motion.div>
                  <div>
                    <h2 className="text-base font-extrabold text-white">{p.label}</h2>
                    <p className="text-[10px] text-slate-500">{p.description}</p>
                  </div>
                </div>
              );
            })()}

            {/* Form container */}
            <div className="glass-subcard rounded-2xl p-5 border border-slate-800">
              {renderForm()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
