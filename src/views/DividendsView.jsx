import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import { motion } from 'framer-motion';
import { Coins, IndianRupee, Globe, Search, X, ArrowUpDown, ArrowUp, ArrowDown, Plus, Trash2 } from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';
import AnimatedCounter from '../components/AnimatedCounter';
import HoldingLogo from '../components/HoldingLogo';
import AssetDividendDetailModal from '../components/AssetDividendDetailModal';
import AddDividendModal from '../components/AddDividendModal';
import { formatDateDDMMYYYY } from '../utils/dateFormatter';

export default function DividendsView({ holdings = [], onRefresh }) {
  const { currency, formatMoney, fxRate, showError, showConfirm } = useThemeAuth();
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [marketFilter, setMarketFilter] = useState('all'); // 'all' | 'IN' | 'US'
  const [sortField, setSortField] = useState('date'); // 'date' | 'name' | 'market' | 'payouts' | 'payout' | 'inr'
  const [sortOrder, setSortOrder] = useState('desc'); // 'asc' | 'desc'
  const [selectedDividendAsset, setSelectedDividendAsset] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isDeletingScheme, setIsDeletingScheme] = useState(null);

  const closeDetail = useCallback(() => setSelectedDividendAsset(null), []);

  const fetchDividends = async () => {
    try {
      const res = await axios.get('/api/dividends');
      setData(res.data);
    } catch (err) {
      console.error('[Dividends] Error fetching dividends:', err);
    }
  };

  useEffect(() => {
    fetchDividends();
  }, []);

  const cleanName = (name = '') => {
    return String(name)
      .replace(/\b(Common Stock|Capital Stock|Registry Share|Registry Shares|Class A|Class B|Class C|Ordinary Shares|Ordinary Share)\b/ig, '')
      .replace(/,\s*Inc\.?$/i, ' Inc.')
      .replace(/,\s*Corp\.?$/i, ' Corp.')
      .replace(/[,\.\-\s]+$/, '')
      .trim();
  };

  const rawHistory = useMemo(() => {
    if (!data?.history) return [];
    return data.history.map(d => ({
      ...d,
      clean_name: cleanName(d.asset_name || d.name || d.symbol)
    }));
  }, [data]);

  // Aggregate dividends by scheme (holding_id or symbol + currency)
  const aggregatedSchemes = useMemo(() => {
    if (!rawHistory || rawHistory.length === 0) return [];
    const schemeMap = new Map();

    rawHistory.forEach(d => {
      const isUS = d.currency === 'USD';
      const key = d.holding_id ? String(d.holding_id) : `${(d.symbol || '').toUpperCase()}_${d.currency}`;
      
      if (!schemeMap.has(key)) {
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
          records: []
        });
      }

      const scheme = schemeMap.get(key);
      scheme.payouts_count += 1;
      scheme.total_amount_original += (Number(d.amount_original) || 0);
      scheme.total_amount_inr += (Number(d.amount_inr) || 0);
      scheme.records.push(d);

      const dRawDate = d.raw_date || d.payment_date || '';
      if (!scheme.latest_raw_date || dRawDate.localeCompare(scheme.latest_raw_date) > 0) {
        scheme.latest_raw_date = dRawDate;
        scheme.latest_payment_date = d.payment_date || d.raw_date;
      }
    });

    return Array.from(schemeMap.values());
  }, [rawHistory]);

  // Counts for filter tabs based on aggregated schemes
  const inSchemesCount = useMemo(() => aggregatedSchemes.filter(s => s.currency !== 'USD').length, [aggregatedSchemes]);
  const usSchemesCount = useMemo(() => aggregatedSchemes.filter(s => s.currency === 'USD').length, [aggregatedSchemes]);
  const totalSchemesCount = aggregatedSchemes.length;

  // Filter by market tab
  const marketFiltered = useMemo(() => {
    return aggregatedSchemes.filter(s => {
      if (marketFilter === 'IN') return s.currency !== 'USD';
      if (marketFilter === 'US') return s.currency === 'USD';
      return true;
    });
  }, [aggregatedSchemes, marketFilter]);

  // Filter by search string
  const searchFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return marketFiltered;
    return marketFiltered.filter(s =>
      (s.clean_name || '').toLowerCase().includes(q) ||
      (s.symbol || '').toLowerCase().includes(q)
    );
  }, [marketFiltered, search]);

  // Sort aggregated schemes
  const sortedSchemes = useMemo(() => {
    return [...searchFiltered].sort((a, b) => {
      let aVal, bVal;
      if (sortField === 'name') {
        aVal = (a.clean_name || '').toLowerCase();
        bVal = (b.clean_name || '').toLowerCase();
      } else if (sortField === 'market') {
        aVal = a.currency === 'USD' ? 'US' : 'IN';
        bVal = b.currency === 'USD' ? 'US' : 'IN';
      } else if (sortField === 'payouts') {
        aVal = Number(a.payouts_count) || 0;
        bVal = Number(b.payouts_count) || 0;
      } else if (sortField === 'payout') {
        aVal = Number(a.total_amount_original) || 0;
        bVal = Number(b.total_amount_original) || 0;
      } else if (sortField === 'inr') {
        aVal = Number(a.total_amount_inr) || 0;
        bVal = Number(b.total_amount_inr) || 0;
      } else { // date
        aVal = a.latest_raw_date || '';
        bVal = b.latest_raw_date || '';
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [searchFiltered, sortField, sortOrder]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'date' ? 'desc' : 'asc');
    }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-slate-600 inline ml-1" />;
    return sortOrder === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-emerald-400 inline ml-1" /> 
      : <ArrowDown className="w-3 h-3 text-emerald-400 inline ml-1" />;
  };

  const handleRowClick = (scheme) => {
    setSelectedDividendAsset(scheme);
  };

  const handleDeleteScheme = async (e, scheme) => {
    e.stopPropagation();
    const displayName = `${scheme.clean_name} (${scheme.symbol})`;
    const confirmed = await showConfirm(`Are you sure you want to delete all dividend records for ${displayName}?`);
    if (!confirmed) return;

    setIsDeletingScheme(scheme.id);
    try {
      const identifier = scheme.holding_id || scheme.symbol;
      await axios.delete(`/api/dividends/scheme/${encodeURIComponent(identifier)}?currency=${scheme.currency}`);
      await fetchDividends();
      if (onRefresh) await onRefresh();
    } catch (err) {
      showError('Error deleting scheme dividends: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsDeletingScheme(null);
    }
  };

  if (!data) return null;

  const isUSDMode = currency === 'USD';
  const effectiveFx = fxRate || 0;

  return (
    <>
      <AnimatedPage className="space-y-5">
        
        {/* Banner */}
        <AnimatedItem>
          <div className="glass-card p-4 sm:p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-white flex items-center gap-2">
                <Coins className="w-5 h-5 text-emerald-400" />
                Dividends
              </h2>
            </div>
            
            {/* Right side: Total Dividends & Add Entry button */}
            <div className="flex items-center gap-4 sm:gap-6 relative z-10 shrink-0 flex-wrap sm:flex-nowrap justify-between md:justify-end w-full md:w-auto">
              <div className="text-right">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">Total Dividends</span>
                <div className="text-2xl sm:text-3xl font-black font-mono bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400">
                  <AnimatedCounter value={data.totalDividendsINR} formatter={(v) => formatMoney(v)} />
                </div>
              </div>

              {/* Add Entry Button */}
              <motion.button
                onClick={() => setIsAddModalOpen(true)}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-1.5 px-4 py-3 bg-emerald-500 hover:bg-emerald-400 text-obsidian-950 font-black rounded-2xl text-xs shadow-lg shadow-emerald-500/20 cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                Add Entry
              </motion.button>
            </div>
          </div>
        </AnimatedItem>

        {/* Metric Cards: 2 Columns with Dynamic Currency Toggle Handling */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          
          {/* Indian Equities Card */}
          <AnimatedCard className="glass-card p-5 rounded-3xl border border-slate-800">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {isUSDMode ? 'Indian ($)' : 'Indian (₹)'}
              </span>
              <motion.div 
                className="w-8 h-8 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-center text-blue-400"
                animate={{ y: [0, -2, 0] }}
                transition={{ duration: 3, repeat: Infinity }}
              >
                <IndianRupee className="w-4 h-4" />
              </motion.div>
            </div>
            <div className="text-2xl font-black text-blue-400 font-mono mb-0.5">
              {isUSDMode
                ? `$${(Number(data.totalIndiaINR) / effectiveFx).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `₹${Number(data.totalIndiaINR).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              }
            </div>
            <p className="text-[10px] text-slate-500 font-mono">
              {isUSDMode
                ? `≈ ₹${Number(data.totalIndiaINR).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `≈ $${(Number(data.totalIndiaINR) / effectiveFx).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              }
            </p>
          </AnimatedCard>

          {/* US Equities Card */}
          <AnimatedCard className="glass-card p-5 rounded-3xl border border-slate-800">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {isUSDMode ? 'US ($)' : 'US (₹)'}
              </span>
              <motion.div 
                className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/25 flex items-center justify-center text-purple-400"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 4, repeat: Infinity }}
              >
                <Globe className="w-4 h-4" />
              </motion.div>
            </div>
            <div className="text-2xl font-black text-purple-400 font-mono mb-0.5">
              {isUSDMode
                ? `$${Number(data.totalUSUSD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `₹${Number(data.totalUSConvertedINR).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              }
            </div>
            <p className="text-[10px] text-slate-500 font-mono">
              {isUSDMode
                ? `≈ ₹${Number(data.totalUSConvertedINR).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `≈ $${Number(data.totalUSUSD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              }
            </p>
          </AnimatedCard>

        </div>

        {/* Aggregated Schemes Table Container */}
        <AnimatedItem>
          <div className="glass-card p-4 sm:p-5 rounded-3xl border border-slate-800 space-y-4">
            
            {/* Toolbar: Filter Tabs & Search Box */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 flex-wrap">
              {/* Filter Tabs */}
              <div className="flex items-center gap-1.5 p-1 bg-slate-900/80 border border-slate-800/80 rounded-2xl w-full sm:w-auto text-xs font-bold">
                <button
                  onClick={() => setMarketFilter('all')}
                  className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                    marketFilter === 'all'
                      ? 'bg-emerald-500 text-obsidian-950 shadow-md font-black'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All ({totalSchemesCount})
                </button>
                <button
                  onClick={() => setMarketFilter('IN')}
                  className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                    marketFilter === 'IN'
                      ? 'bg-blue-500 text-white shadow-md font-black'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Indian Equity ({inSchemesCount})
                </button>
                <button
                  onClick={() => setMarketFilter('US')}
                  className={`px-3 py-1.5 rounded-xl transition-all cursor-pointer ${
                    marketFilter === 'US'
                      ? 'bg-purple-500 text-white shadow-md font-black'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  US Equity ({usSchemesCount})
                </button>
              </div>

              {/* Search Box */}
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search dividend schemes..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-10 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5" aria-label="Clear search">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-900/60 select-none">
                    <th onClick={() => handleSort('name')} className="py-3 px-3 rounded-l-xl cursor-pointer hover:text-white whitespace-nowrap">
                      Stock Name {getSortIcon('name')}
                    </th>
                    <th onClick={() => handleSort('market')} className="py-3 px-3 cursor-pointer hover:text-white whitespace-nowrap">
                      Market {getSortIcon('market')}
                    </th>
                    <th onClick={() => handleSort('payouts')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Payouts {getSortIcon('payouts')}
                    </th>
                    <th onClick={() => handleSort('payout')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Total Payout {getSortIcon('payout')}
                    </th>
                    <th onClick={() => handleSort('inr')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      {isUSDMode ? 'USD Credited' : 'INR Credited'} {getSortIcon('inr')}
                    </th>
                    <th onClick={() => handleSort('date')} className="py-3 px-3 text-center cursor-pointer hover:text-white whitespace-nowrap">
                      Latest Date {getSortIcon('date')}
                    </th>
                    <th className="py-3 px-3 text-center rounded-r-xl whitespace-nowrap">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="[&>tr]:border-b [&>tr]:border-slate-800/40 text-xs">
                  {sortedSchemes.map((s, i) => {
                    const isUS = s.currency === 'USD';
                    return (
                      <motion.tr 
                        key={s.id || `${s.symbol}-${i}`} 
                        onClick={() => handleRowClick(s)}
                        className="hover:bg-slate-800/40 cursor-pointer transition-all"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: Math.min(i * 0.02, 0.3) }}
                      >
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2.5">
                            <HoldingLogo 
                              holding={{
                                name: s.clean_name,
                                symbol: s.symbol,
                                category_id: s.category_id || (isUS ? 'us_stocks' : 'in_stocks')
                              }} 
                              className="w-7 h-7 rounded-lg" 
                              fallbackClass="text-[10px]"
                              accentColor={isUS ? '#a855f7' : '#10b981'}
                            />
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-[12px] transition-colors block text-slate-100 hover:text-emerald-400">
                                  {s.clean_name}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                <span className="text-[10px] text-slate-500 font-mono">{s.symbol}</span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                            isUS 
                              ? 'bg-purple-500/10 text-purple-400 border-purple-500/25' 
                              : 'bg-blue-500/10 text-blue-400 border-blue-500/25'
                          }`}>
                            {isUS ? 'US Equity' : 'Indian Equity'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-slate-300 whitespace-nowrap">
                          {s.payouts_count}
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-bold text-slate-200 whitespace-nowrap">
                          {isUS 
                            ? `$${Number(s.total_amount_original).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                            : `₹${Number(s.total_amount_original).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          }
                        </td>
                        <td className="py-3 px-3 text-right font-mono font-black text-emerald-400 whitespace-nowrap">
                          {isUSDMode
                            ? `$${(isUS ? Number(s.total_amount_original) : Number(s.total_amount_inr) / effectiveFx).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : `₹${Number(s.total_amount_inr).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          }
                        </td>
                        <td className="py-3 px-3 text-center font-mono text-slate-400 whitespace-nowrap">
                          {formatDateDDMMYYYY(s.latest_payment_date || s.latest_raw_date)}
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <button 
                            onClick={(e) => handleDeleteScheme(e, s)} 
                            disabled={isDeletingScheme === s.id}
                            className="p-1 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-lg transition-colors disabled:opacity-50" 
                            title={`Delete All Dividends for ${s.clean_name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </motion.tr>
                    );
                  })}
                  {sortedSchemes.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        No dividend schemes found matching your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </AnimatedItem>

      </AnimatedPage>

      {/* Asset Dividend Detail & Report Modal */}
      {selectedDividendAsset && (
        <AssetDividendDetailModal
          isOpen={Boolean(selectedDividendAsset)}
          onClose={closeDetail}
          asset={selectedDividendAsset}
          dividendsHistory={data?.history || []}
          holding={holdings.find(h => 
            (selectedDividendAsset.holding_id && h.id === selectedDividendAsset.holding_id) || 
            (h.symbol === selectedDividendAsset.symbol && 
              (selectedDividendAsset.currency === 'USD' ? h.category_id === 'us_stocks' : h.category_id === 'in_stocks')
            )
          )}
          onAddDividend={() => setIsAddModalOpen(true)}
          onRefresh={async () => {
            await fetchDividends();
            if (onRefresh) await onRefresh();
          }}
        />
      )}

      {/* Add Dividend Entry Modal */}
      {isAddModalOpen && (
        <AddDividendModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          onSuccess={async () => {
            await fetchDividends();
            if (onRefresh) await onRefresh();
          }}
          holdings={holdings}
        />
      )}
    </>
  );
}

