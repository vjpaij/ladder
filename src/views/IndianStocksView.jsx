import React, { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { CandlestickChart, Search, Plus, CheckCircle2, Edit3, Trash2, ArrowUpDown, ArrowUp, ArrowDown, XCircle } from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';
import HoldingDetailModal from '../components/HoldingDetailModal';
import HoldingLogo from '../components/HoldingLogo';

export default function IndianStocksView({ holdings, onDeleteHolding, onEditHolding, onOpenAddModal }) {
  const { formatMoney } = useThemeAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [sortField, setSortField] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [selectedHolding, setSelectedHolding] = useState(null);
  const closeDetail = useCallback(() => setSelectedHolding(null), []);

  const rawIndianStocks = useMemo(() => {
    return holdings.filter(h => h.category_id === 'in_stocks');
  }, [holdings]);

  const statusFiltered = useMemo(() => {
    return rawIndianStocks.filter(h => {
      const qty = Number(h.quantity) || 0;
      if (statusFilter === 'active') return qty > 0;
      if (statusFilter === 'closed') return qty === 0;
      return true;
    });
  }, [rawIndianStocks, statusFilter]);

  const searchFiltered = useMemo(() => {
    return statusFiltered.filter(h =>
      (h.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (h.symbol || '').toLowerCase().includes(search.toLowerCase()) ||
      (h.sector || '').toLowerCase().includes(search.toLowerCase())
    );
  }, [statusFiltered, search]);

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

  const totalInvested = useMemo(() => statusFiltered.reduce((sum, h) => sum + (h.investedValueINR || 0), 0), [statusFiltered]);
  const totalCurrent = useMemo(() => statusFiltered.reduce((sum, h) => sum + (h.currentValueINR || 0), 0), [statusFiltered]);
  const totalGain = totalCurrent - totalInvested;
  const roiPct = totalInvested > 0 ? ((totalGain / totalInvested) * 100).toFixed(2) : 0;

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
      ? <ArrowUp className="w-3 h-3 text-emerald-400 inline ml-1" />
      : <ArrowDown className="w-3 h-3 text-emerald-400 inline ml-1" />;
  };

  const activeCount = rawIndianStocks.filter(h => (Number(h.quantity) || 0) > 0).length;
  const closedCount = rawIndianStocks.filter(h => (Number(h.quantity) || 0) === 0).length;

  return (
    <>
      <AnimatedPage className="space-y-5">

        {/* Banner */}
        <AnimatedItem>
          <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <motion.span 
                    className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  NSE / BSE LIVE FEED
                </span>
              </div>
              <h2 className="text-xl font-black text-white flex items-center gap-2 mt-1.5">
                <CandlestickChart className="w-5 h-5 text-emerald-400" />
                Indian Equity
              </h2>
            </div>

            <div className="flex items-center gap-5 flex-wrap sm:flex-nowrap">
              <div className="flex items-stretch gap-4 bg-slate-900/60 px-4 py-2.5 rounded-2xl border border-slate-800/80">
                <div className="text-right border-r border-slate-800 pr-4 flex flex-col justify-between">
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">
                    Invested
                  </span>
                  <div className="text-base font-black font-mono text-slate-200">{formatMoney(totalInvested)}</div>
                  <div className="text-[10px] font-bold font-mono text-slate-500">
                    Cost Basis
                  </div>
                </div>

                <div className="text-right flex flex-col justify-between">
                  <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">
                    {statusFilter === 'active' ? 'Active Value' : statusFilter === 'closed' ? 'Realized' : 'Total Value'}
                  </span>
                  <div className="text-base font-black font-mono text-white">{formatMoney(totalCurrent)}</div>
                  <div className={`text-[10px] font-bold font-mono ${totalGain >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {totalGain >= 0 ? '+' : ''}{roiPct}% ({totalGain >= 0 ? '+' : ''}{formatMoney(totalGain)})
                  </div>
                </div>
              </div>

              <motion.button
                onClick={onOpenAddModal}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-obsidian-950 font-black rounded-xl text-xs shadow-lg shadow-emerald-500/20 cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                Add Stock
              </motion.button>
            </div>
          </div>
        </AnimatedItem>

        {/* Table Container */}
        <AnimatedItem>
          <div className="glass-card rounded-3xl p-5 border border-slate-800">

            {/* Controls Bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-800/60">

              {/* Filter Tabs */}
              <div className="flex items-center bg-slate-900/90 p-1 rounded-2xl border border-slate-800 text-xs font-bold">
                <button
                  onClick={() => setStatusFilter('active')}
                  className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                    statusFilter === 'active'
                      ? 'bg-emerald-500 text-obsidian-950 shadow-md font-black'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Active Positions ({activeCount})
                </button>
                <button
                  onClick={() => setStatusFilter('closed')}
                  className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                    statusFilter === 'closed'
                      ? 'bg-emerald-500 text-obsidian-950 shadow-md font-black'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Fully Redeemed ({closedCount})
                </button>
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                    statusFilter === 'all'
                      ? 'bg-emerald-500 text-obsidian-950 shadow-md font-black'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All Data ({rawIndianStocks.length})
                </button>
              </div>

              {/* Search Box */}
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search stocks..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
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
                      Avg Buy {getSortIcon('avg_buy_price')}
                    </th>
                    <th onClick={() => handleSort('current_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      Price {getSortIcon('current_price')}
                    </th>
                    <th onClick={() => handleSort('investedValueINR')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      Invested Value {getSortIcon('investedValueINR')}
                    </th>
                    <th onClick={() => handleSort('currentValueINR')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      Value {getSortIcon('currentValueINR')}
                    </th>
                    <th onClick={() => handleSort('gainINR')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      P&amp;L {getSortIcon('gainINR')}
                    </th>
                    <th className="py-3 px-3 text-center rounded-r-xl">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40 text-xs">
                  {sortedHoldings.map((h, i) => {
                    const qty = Number(h.quantity) || 0;
                    const isClosed = qty === 0;
                    const isGainPositive = (h.gainINR || 0) >= 0;
                    const isNseHigher = (h.nse_price || 0) >= (h.bse_price || 0);

                    return (
                      <motion.tr
                        key={h.id}
                        onClick={() => setSelectedHolding(h)}
                        className={`cursor-pointer transition-all ${
                          isClosed
                            ? 'bg-slate-950/40 hover:bg-slate-900/50 opacity-60 hover:opacity-90 border-l-2 border-l-slate-700/40'
                            : 'hover:bg-slate-800/40 border-l-2 border-l-transparent hover:border-l-emerald-500'
                        }`}
                        initial={{ opacity: 0, x: -5 }}
                        animate={{ opacity: isClosed ? 0.65 : 1, x: 0 }}
                        transition={{ delay: Math.min(i * 0.02, 0.3) }}
                      >
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2.5">
                            <HoldingLogo 
                              holding={h} 
                              className={`w-7 h-7 rounded-lg ${isClosed ? 'grayscale opacity-50' : ''}`} 
                              fallbackClass="text-[10px]"
                              accentColor={isClosed ? '#64748b' : '#10b981'}
                            />
                            <div>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span
                                  className={`font-bold text-[12px] transition-colors block ${
                                    isClosed ? 'text-slate-400 font-medium' : 'text-slate-100 hover:text-emerald-400'
                                  }`}
                                >
                                  {h.name}
                                </span>
                                {isClosed ? (
                                  <span className="px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase tracking-wider bg-slate-800/90 text-slate-400 border border-slate-700/60">
                                    EXITED
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.2 rounded text-[8.5px] font-extrabold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                                    ACTIVE
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono">{h.symbol} • {h.sector || 'Equity'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono">
                          {qty > 0 ? (
                            <span className="text-slate-200 font-bold">{qty.toLocaleString()}</span>
                          ) : (
                            <span className="text-slate-600 font-medium">0</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono text-slate-400">{formatMoney(h.avg_buy_price, true)}</td>
                        <td className="py-3 px-3 text-right font-mono">
                          <div className={`text-[12px] font-bold ${isClosed ? 'text-slate-400 font-medium' : 'text-emerald-400 font-black'}`}>
                            {formatMoney(h.current_price, true)}
                          </div>
                          {h.day_change !== undefined && (
                            <div className={`text-[9.5px] font-bold flex items-center justify-end gap-0.5 ${
                              isClosed 
                                ? 'text-slate-500' 
                                : (h.day_change || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}>
                              <span>{(h.day_change || 0) >= 0 ? '▲ +' : '▼ '}{formatMoney(Math.abs(h.day_change), true)}</span>
                              <span className="opacity-80">({(h.day_change_pct || 0) >= 0 ? '+' : ''}{h.day_change_pct || 0}%)</span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono">
                          {isClosed ? (
                            <span className="text-slate-600">—</span>
                          ) : (
                            <span className="font-bold text-slate-100">{formatMoney(h.investedValueINR, true)}</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono">
                          {isClosed ? (
                            <span className="text-slate-600">—</span>
                          ) : (
                            <span className="font-black text-slate-100">{formatMoney(h.currentValueINR, true)}</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right font-mono">
                          {isClosed ? (
                            <span className="text-slate-600 text-[11px]">—</span>
                          ) : (
                            <>
                              <div className={isGainPositive ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                {isGainPositive ? '+' : ''}{formatMoney(h.gainINR || 0, true)}
                              </div>
                              <div className={`text-[9px] ${isGainPositive ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
                                {isGainPositive ? '+' : ''}{h.gainPct || 0}%
                              </div>
                            </>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={(e) => { e.stopPropagation(); onEditHolding(h); }} className="p-1 hover:bg-slate-700/60 text-slate-500 hover:text-slate-200 rounded-lg" title="Edit Position">
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); onDeleteHolding(h.id); }} className="p-1 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-lg" title="Delete Position">
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
                        No stocks found matching current status filter ({statusFilter})
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
