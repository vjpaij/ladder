import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, 
  RefreshCw, 
  DollarSign, 
  IndianRupee, 
  X,
  User,
  Settings,
  ArrowUpDown,
  LogOut,
  ShieldCheck,
  Palette,
  Check,
  ChevronDown,
  Camera,
  Trash2,
  Clock
} from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';

export default function TopNavbar({ 
  onRefreshPrices, 
  isRefreshing, 
  holdings = [],
  liabilities = [],
  onSelectHolding,
  onNavigate,
  summary
}) {
  const { 
    theme, 
    setTheme, 
    availableThemes, 
    currency, 
    toggleCurrency, 
    user, 
    updateUserAvatar,
    logout 
  } = useThemeAuth();

  const [query, setQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  const searchRef = useRef(null);
  const userMenuRef = useRef(null);
  const themeMenuRef = useRef(null);
  const fileInputRef = useRef(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setIsSearchOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setIsUserMenuOpen(false);
      }
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target)) {
        setIsThemeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    
    // Live clock timer
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      clearInterval(timer);
    };
  }, []);

  const handlePhotoUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        alert('Please choose an image under 2MB.');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        if (reader.result) {
          updateUserAvatar(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const normalizeCategory = (catId) => {
    switch (catId) {
      case 'in_stocks':
      case 'indian_stocks': return { label: 'Indian Stock', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
      case 'us_stocks': return { label: 'US Stock', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' };
      case 'mutual_funds': return { label: 'Mutual Fund', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
      case 'nps': return { label: 'NPS', color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' };
      case 'bank': return { label: 'Bank', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' };
      case 'epf': return { label: 'EPF', color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' };
      case 'loans':
      case 'credit_cards':
      case 'liabilities': return { label: 'Liability', color: 'bg-rose-500/15 text-rose-400 border-rose-500/30' };
      default: return { label: 'Asset', color: 'bg-slate-800 text-slate-400 border-slate-700' };
    }
  };

  const allItems = [
    ...holdings,
    ...liabilities.map(l => ({ ...l, category_id: l.category_id || 'loans', symbol: l.symbol || l.lender || 'LOAN' }))
  ];

  const filtered = query.trim() === '' ? [] : allItems.filter(item => {
    const q = query.toLowerCase();
    const nameMatch = (item.name || '').toLowerCase().includes(q);
    const symbolMatch = (item.symbol || '').toLowerCase().includes(q);
    const exchangeMatch = (item.exchange || '').toLowerCase().includes(q);
    return nameMatch || symbolMatch || exchangeMatch;
  }).slice(0, 10);

  return (
    <header className="sticky top-0 z-30 glass-card border border-slate-800 rounded-3xl px-6 py-3 flex items-center justify-between gap-4 shrink-0 transition-all shadow-sm">
      
      {/* Hidden File Input for Avatar Photo Upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handlePhotoUpload}
        accept="image/*"
        className="hidden"
      />

      {/* ─── Search Bar ─────────────────────────────────────────── */}
      <div ref={searchRef} className="relative w-64 md:w-80">
        <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsSearchOpen(true);
          }}
          onFocus={() => setIsSearchOpen(true)}
          placeholder="Search tickers, investments, liabilities..."
          className="w-full pl-10 pr-9 py-2 bg-slate-900/90 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/30 transition-all"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setIsSearchOpen(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Autocomplete Dropdown */}
        <AnimatePresence>
          {isSearchOpen && query.trim() !== '' && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              className="absolute top-full left-0 right-0 mt-2 bg-slate-900/95 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-50 backdrop-blur-2xl max-h-80 overflow-y-auto"
            >
              {filtered.length > 0 ? (
                <div className="py-1 divide-y divide-slate-800/40">
                  {filtered.map((item, idx) => {
                    const catInfo = normalizeCategory(item.category_id);
                    return (
                      <button
                        key={item.id || idx}
                        onClick={() => {
                          if (onSelectHolding) onSelectHolding(item);
                          setIsSearchOpen(false);
                          setQuery('');
                        }}
                        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-slate-800/60 transition-colors text-left group cursor-pointer"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="font-mono text-xs font-black text-white group-hover:text-emerald-400 transition-colors shrink-0">
                            {item.symbol || 'ASSET'}
                          </span>
                          <span className="text-xs text-slate-300 truncate font-medium">
                            {item.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border ${catInfo.color}`}>
                            {catInfo.label}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 text-center text-xs text-slate-500">
                  No tickers or investments matching "<span className="text-slate-300">{query}</span>"
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── Controls & Quick Actions ───────────────────────────── */}
      <div className="flex items-center gap-2">
        
        {/* Date / Time Stamp */}
        <div className="hidden lg:flex items-center gap-1.5 px-3 py-2 bg-slate-900/90 border border-slate-700/60 rounded-xl text-xs font-semibold text-slate-300 shadow-sm">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-mono tracking-tight whitespace-nowrap">
            {currentTime.toLocaleString('en-IN', {
              day: '2-digit', month: 'short', year: 'numeric',
              hour: '2-digit', minute: '2-digit', second: '2-digit',
              hour12: true
            }).toUpperCase()}
          </span>
        </div>

        {/* Sync Prices Button */}
        <motion.button
          onClick={onRefreshPrices}
          disabled={isRefreshing}
          whileTap={{ scale: 0.95 }}
          title="Fetch latest stock prices, mutual fund NAVs & FX rates"
          className="group flex items-center gap-1.5 px-3 py-2 bg-slate-900/90 hover:bg-slate-800/90 border border-slate-700/60 rounded-xl text-xs font-semibold text-slate-200 shadow-sm transition-all cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 transition-colors ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
          <span className="hidden sm:inline">{isRefreshing ? 'Syncing...' : 'Sync'}</span>
        </motion.button>

        {/* Import / Export Data Button */}
        {onNavigate && (
          <motion.button
            onClick={() => onNavigate('excel_tools')}
            whileTap={{ scale: 0.95 }}
            title="Import or Export portfolio data (Excel, CSV, JSON)"
            className="group flex items-center gap-1.5 px-3 py-2 bg-slate-900/90 hover:bg-slate-800/90 border border-slate-700/60 rounded-xl text-xs font-semibold text-slate-200 shadow-sm transition-all cursor-pointer"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 transition-colors" />
            <span className="hidden sm:inline">Import/Export</span>
          </motion.button>
        )}

        {/* Currency Toggle (Uniform styling with other controls) */}
        <motion.button
          onClick={toggleCurrency}
          whileTap={{ scale: 0.95 }}
          title={`Switch to ${currency === 'INR' ? 'USD ($)' : 'INR (₹)'}`}
          className="group flex items-center gap-1.5 px-3 py-2 bg-slate-900/90 hover:bg-slate-800/90 border border-slate-700/60 rounded-xl text-xs font-semibold text-slate-200 shadow-sm transition-all cursor-pointer"
        >
          {currency === 'INR' ? (
            <span className="flex items-center gap-1">
              <IndianRupee className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 transition-colors" />
              <span className="font-mono">INR</span>
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <DollarSign className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 transition-colors" />
              <span className="font-mono">USD</span>
            </span>
          )}
        </motion.button>

        {/* Theme Selector Dropdown */}
        <div ref={themeMenuRef} className="relative">
          <motion.button
            onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
            whileTap={{ scale: 0.95 }}
            title="Choose dashboard theme"
            className="group p-2 bg-slate-900/90 hover:bg-slate-800/90 border border-slate-700/60 rounded-xl text-slate-200 transition-all cursor-pointer flex items-center gap-1"
          >
            <Palette className="w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
            <ChevronDown className="w-3 h-3 text-slate-500" />
          </motion.button>

          <AnimatePresence>
            {isThemeMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.96 }}
                className="absolute right-0 mt-2 w-52 bg-slate-900/95 border border-slate-800 rounded-2xl shadow-2xl p-2 z-50 backdrop-blur-2xl"
              >
                {/* Dark Themes */}
                <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider px-2.5 py-1 mb-0.5">
                  Dark Themes
                </div>
                <div className="space-y-0.5 mb-2">
                  {(availableThemes || []).filter(t => ['dark', 'midnight', 'sunset'].includes(t.id)).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setTheme(t.id);
                        setIsThemeMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                        theme === t.id 
                          ? 'bg-slate-800 text-white shadow-sm' 
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span 
                          className="w-3 h-3 rounded-full border border-white/20" 
                          style={{ backgroundColor: t.accent || t.color }}
                        />
                        <span>{t.label}</span>
                      </div>
                      {theme === t.id && <Check className="w-3.5 h-3.5 text-blue-400" />}
                    </button>
                  ))}
                </div>

                {/* Light Themes */}
                <div className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider px-2.5 py-1 mb-0.5 border-t border-slate-800/80 pt-1.5">
                  Light Themes
                </div>
                <div className="space-y-0.5">
                  {(availableThemes || []).filter(t => ['light', 'warm_light', 'nordic_light'].includes(t.id)).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setTheme(t.id);
                        setIsThemeMenuOpen(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                        theme === t.id 
                          ? 'bg-slate-800 text-white shadow-sm' 
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span 
                          className="w-3 h-3 rounded-full border border-slate-700/60" 
                          style={{ backgroundColor: t.accent || t.color }}
                        />
                        <span>{t.label}</span>
                      </div>
                      {theme === t.id && <Check className="w-3.5 h-3.5 text-blue-400" />}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ─── User Avatar & Profile Dropdown ──────────────────────── */}
        <div ref={userMenuRef} className="relative pl-1">
          <motion.button
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="relative flex items-center gap-2 p-0.5 rounded-xl cursor-pointer group focus:outline-none"
          >
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-black text-xs shadow-md overflow-hidden group-hover:ring-2 group-hover:ring-blue-500/50 transition-all">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="User Avatar" className="w-full h-full object-cover" />
              ) : (
                <span>{user?.avatar || 'VP'}</span>
              )}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-slate-950" />
          </motion.button>

          {/* User Profile Dropdown Menu */}
          <AnimatePresence>
            {isUserMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                className="absolute right-0 mt-2 w-72 bg-slate-900/95 border border-slate-800/90 rounded-2xl shadow-2xl p-4 z-50 backdrop-blur-2xl divide-y divide-slate-800/60"
              >
                {/* Profile Header with Photo Upload */}
                <div className="pb-3 px-1">
                  <div className="flex items-center gap-3.5">
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      title="Click to upload profile photo"
                      className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-black text-sm shadow-md shrink-0 cursor-pointer group overflow-hidden"
                    >
                      {user?.avatarUrl ? (
                        <img src={user.avatarUrl} alt="User Avatar" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-base">{user?.avatar || 'VP'}</span>
                      )}
                      
                      {/* Hover Overlay */}
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-white transition-opacity">
                        <Camera className="w-4 h-4" />
                        <span className="text-[8px] font-bold mt-0.5">Upload</span>
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-black text-sm text-white truncate">
                          {user?.name || 'Vijay Pai'}
                        </span>
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono block truncate">
                        {user?.email || 'admin@ladder.com'}
                      </span>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 font-semibold mt-1 flex items-center gap-1 cursor-pointer"
                      >
                        <Camera className="w-3 h-3" />
                        <span>{user?.avatarUrl ? 'Change Photo' : 'Upload Photo'}</span>
                      </button>
                    </div>
                  </div>

                  {user?.avatarUrl && (
                    <div className="mt-2.5 pt-2 border-t border-slate-800/60 flex justify-end">
                      <button
                        onClick={() => updateUserAvatar(null)}
                        className="text-[10px] text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Remove Photo</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Logout / Session Control */}
                <div className="pt-3">
                  <button
                    onClick={() => {
                      if (window.confirm('Sign out of your Ladder session?')) {
                        logout();
                        setIsUserMenuOpen(false);
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/20 transition-all cursor-pointer"
                  >
                    <LogOut className="w-4 h-4 text-rose-400" />
                    <span>Sign Out</span>
                  </button>
                </div>

              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </div>
    </header>
  );
}


