import React, { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Globe, Search, Plus, CheckCircle2, Edit3, Trash2, ArrowUpDown, ArrowUp, ArrowDown, XCircle } from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';
import HoldingDetailModal from '../components/HoldingDetailModal';
import HoldingLogo from '../components/HoldingLogo';

export default function UsStocksView({ holdings, onDeleteHolding, onEditHolding, onOpenAddModal }) {
  const { currency, formatMoney, formatRawUSD, fxRate } = useThemeAuth();
  const isUSD = currency === 'USD';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'closed' | 'all'
  const [sortField, setSortField] = useState('name'); // Default sort by name
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' | 'desc'
  const [selectedHolding, setSelectedHolding] = useState(null);
  const closeDetail = useCallback(() => setSelectedHolding(null), []);

  const rawUsStocks = useMemo(() => {
    return holdings.filter(h => h.category_id === 'us_stocks');
  }, [holdings]);

  // Filter by status tab
  const statusFiltered = useMemo(() => {
    return rawUsStocks.filter(h => {
      const qty = Number(h.quantity) || 0;
      if (statusFilter === 'active') return qty > 0;
      if (statusFilter === 'closed') return qty === 0;
      return true; // 'all'
    });
  }, [rawUsStocks, statusFilter]);

  // Filter by search string
  const searchFiltered = useMemo(() => {
    return statusFiltered.filter(h =>
      (h.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (h.symbol || '').toLowerCase().includes(search.toLowerCase()) ||
      (h.sector || '').toLowerCase().includes(search.toLowerCase())
    );
  }, [statusFiltered, search]);

  // Sort rows
  const sortedHoldings = useMemo(() => {
    return [...searchFiltered].sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal || '').toLowerCase();
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [searchFiltered, sortField, sortOrder]);

  const totalUSD = useMemo(() => statusFiltered.reduce((sum, h) => sum + ((Number(h.quantity) || 0) * (Number(h.current_price) || 0)), 0), [statusFiltered]);
  const totalInvestedUSD = useMemo(() => statusFiltered.reduce((sum, h) => sum + ((Number(h.quantity) || 0) * (Number(h.avg_buy_price) || 0)), 0), [statusFiltered]);
  const totalInvestedINR = useMemo(() => statusFiltered.reduce((sum, h) => sum + (Number(h.investedValueINR) || 0), 0), [statusFiltered]);
  const totalConvertedINR = totalUSD * fxRate;
  const totalGainINR = totalConvertedINR - totalInvestedINR;

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-slate-600 inline ml-1" />;
    return sortOrder === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-purple-400 inline ml-1" /> 
      : <ArrowDown className="w-3 h-3 text-purple-400 inline ml-1" />;
  };

  const activeCount = rawUsStocks.filter(h => (Number(h.quantity) || 0) > 0).length;
  const closedCount = rawUsStocks.filter(h => (Number(h.quantity) || 0) === 0).length;

  return (
    <>
      <AnimatedPage className="space-y-5">
      
      {/* Banner */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/30">
                <motion.span 
                  className="w-1.5 h-1.5 rounded-full bg-purple-400"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                NASDAQ / NYSE LIVE FEED
              </span>
              <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-slate-900/80 text-emerald-400 border border-slate-800">
                <Globe className="w-3 h-3 text-emerald-400" />
                <span>USD/INR: ₹{fxRate}</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                Display: <span className="text-purple-400 font-bold uppercase">{currency}</span>
              </span>
            </div>
            <h2 className="text-xl font-black text-white flex items-center gap-2 mt-1.5">
              <Globe className="w-5 h-5 text-purple-400" />
              US Equity
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Real-time quotes with automatic USD to INR currency conversions</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">
                {statusFilter === 'active' ? 'Active US Value' : statusFilter === 'closed' ? 'Closed US Value' : 'Total US Value'}
              </span>
              <div className="text-xl font-black font-mono text-purple-400">
                {isUSD ? formatRawUSD(totalUSD) : formatMoney(totalConvertedINR, true)}
              </div>
              <div className="text-[10px] font-bold text-slate-400 font-mono">
                {isUSD ? `≈ ${formatMoney(totalConvertedINR, true)}` : `≈ ${formatRawUSD(totalUSD)}`}
              </div>
            </div>
            <motion.button
              onClick={onOpenAddModal}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-black rounded-xl text-xs shadow-lg shadow-purple-500/20 cursor-pointer"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              Add US Stock
            </motion.button>
          </div>
        </div>
      </AnimatedItem>

      {/* Table Container */}
      <AnimatedItem>
        <div className="glass-card rounded-3xl p-5 border border-slate-800">
          
          {/* Controls Bar: Status Filter Tabs & Search */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-800/60">
            
            {/* Filter Tabs */}
            <div className="flex items-center bg-slate-900/90 p-1 rounded-2xl border border-slate-800 text-xs font-bold">
              <button
                onClick={() => setStatusFilter('active')}
                className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                  statusFilter === 'active' 
                    ? 'bg-purple-600 text-white shadow-md font-black' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Active Holdings ({activeCount})
              </button>
              <button
                onClick={() => setStatusFilter('closed')}
                className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                  statusFilter === 'closed' 
                    ? 'bg-purple-600 text-white shadow-md font-black' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <XCircle className="w-3.5 h-3.5" />
                Fully Redeemed ({closedCount})
              </button>
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-3 py-1.5 rounded-xl transition-all ${
                  statusFilter === 'all' 
                    ? 'bg-purple-600 text-white shadow-md font-black' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All Data ({rawUsStocks.length})
              </button>
            </div>

            {/* Search Box */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search ticker or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-900/60 select-none">
                  <th onClick={() => handleSort('name')} className="py-3 px-3 rounded-l-xl cursor-pointer hover:text-white">
                    Stock Name {getSortIcon('name')}
                  </th>
                  <th onClick={() => handleSort('quantity')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                    Shares {getSortIcon('quantity')}
                  </th>
                  <th onClick={() => handleSort('avg_buy_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                    Avg Buy ($) {getSortIcon('avg_buy_price')}
                  </th>
                  <th onClick={() => handleSort('current_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                    Price ($) {getSortIcon('current_price')}
                  </th>
                  <th onClick={() => handleSort(isUSD ? 'investedValueOriginal' : 'investedValueINR')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                    {isUSD ? 'USD Invested' : 'INR Invested'} {getSortIcon(isUSD ? 'investedValueOriginal' : 'investedValueINR')}
                  </th>
                  <th onClick={() => handleSort(isUSD ? 'currentValueOriginal' : 'currentValueINR')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                    {isUSD ? 'USD Value' : 'INR Value'} {getSortIcon(isUSD ? 'currentValueOriginal' : 'currentValueINR')}
                  </th>
                  <th onClick={() => handleSort(isUSD ? 'unrealized_pnl' : 'gainINR')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                    {isUSD ? 'P&L ($)' : 'P&L (₹)'} {getSortIcon(isUSD ? 'unrealized_pnl' : 'gainINR')}
                  </th>
                  <th className="py-3 px-3 text-center rounded-r-xl">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-xs">
                {sortedHoldings.map((h, i) => {
                  const qty = Number(h.quantity) || 0;
                  const isClosed = qty === 0;
                  const currentPrice = Number(h.current_price) || 0;
                  const avgPrice = Number(h.avg_buy_price) || 0;
                  const usdVal = qty * currentPrice;
                  const inrVal = Number(h.currentValueINR) || (usdVal * fxRate);
                  
                  // USD P&L
                  const usdInvested = qty * avgPrice;
                  const usdGain = usdVal - usdInvested;
                  const usdGainPct = usdInvested > 0 ? ((usdGain / usdInvested) * 100).toFixed(2) : 0;
                  
                  // INR P&L
                  const inrGain = isClosed ? Number(h.realized_pnl) : (Number(h.gainINR) || 0);
                  const isGainPos = isUSD ? usdGain >= 0 : inrGain >= 0;

                  return (
                    <motion.tr 
                      key={h.id} 
                      onClick={() => (typeof setSelectedHolding === "function" ? setSelectedHolding(h) : (typeof setTargetPortfolio === "function" ? setTargetPortfolio(null) : null))}
                        className={`cursor-pointer hover:bg-slate-800/30 ${isClosed ? 'opacity-60 bg-slate-900/20' : ''}`}
                      initial={{ opacity: 0, x: -5 }}
                      animate={{ opacity: isClosed ? 0.6 : 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    >
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <HoldingLogo 
                            holding={h} 
                            className="w-7 h-7 rounded-lg" 
                            fallbackClass="text-[10px]"
                            accentColor={isClosed ? '#64748b' : '#a855f7'}
                          />
                          <div>
                            <button onClick={() => setSelectedHolding(h)} className="font-bold text-slate-100 text-[12px] hover:text-purple-400 transition-colors text-left cursor-pointer block">{h.name}</button>
                            <div className="text-[10px] text-slate-500 font-mono">{h.symbol} • {h.sector || 'US Equity'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-300">
                        {qty > 0 ? qty.toFixed(4) : <span className="text-slate-600">0</span>}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-400">${Number(h.avg_buy_price).toFixed(2)}</td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-purple-400">${Number(h.current_price).toFixed(2)}</td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-100">
                        {isUSD ? `$${usdInvested.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(h.investedValueINR, true)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-100">
                        {isUSD ? `$${usdVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(inrVal, true)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono">
                        <div className={isGainPos ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                          {isUSD ? (
                            `${isGainPos ? '+' : ''}$${Math.abs(usdGain).toFixed(2)}`
                          ) : (
                            `${isGainPos ? '+' : ''}${formatMoney(inrGain, true)}`
                          )}
                        </div>
                        <div className="text-[9px] text-emerald-500/70">
                          {isGainPos ? '+' : ''}{isUSD ? usdGainPct : (h.gainPct || 0)}%
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); onEditHolding(h); }} className="p-1 hover:bg-slate-700/60 text-slate-500 hover:text-slate-200 rounded-lg">
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); onDeleteHolding(h.id); }} className="p-1 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-lg">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
                {sortedHoldings.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-600 text-xs">
                      No US stocks found matching current status filter ({statusFilter})
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </AnimatedItem>

    </AnimatedPage>

      {selectedHolding && (
        <HoldingDetailModal holding={selectedHolding} onClose={closeDetail} />
      )}
    </>
  );
}

