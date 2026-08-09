import React, { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { LineChart, Plus, Search, Edit3, Trash2, CheckCircle2, ArrowUpDown, ArrowUp, ArrowDown, XCircle } from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';
import HoldingDetailModal from '../components/HoldingDetailModal';

export default function MutualFundsView({ holdings, onDeleteHolding, onEditHolding, onOpenAddModal }) {
  const { formatMoney } = useThemeAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'closed' | 'all'
  const [sortField, setSortField] = useState('name'); // Default sort by name
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' | 'desc'
  const [selectedHolding, setSelectedHolding] = useState(null);
  const closeDetail = useCallback(() => setSelectedHolding(null), []);

  const rawMfs = useMemo(() => {
    return holdings.filter(h => h.category_id === 'mutual_funds');
  }, [holdings]);

  // Filter by status tab
  const statusFiltered = useMemo(() => {
    return rawMfs.filter(h => {
      const qty = Number(h.quantity) || 0;
      if (statusFilter === 'active') return qty > 0;
      if (statusFilter === 'closed') return qty === 0;
      return true; // 'all'
    });
  }, [rawMfs, statusFilter]);

  // Filter by search string
  const searchFiltered = useMemo(() => {
    return statusFiltered.filter(h =>
      (h.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (h.symbol || '').includes(search)
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

  const totalCurrent = useMemo(() => statusFiltered.reduce((sum, h) => sum + (h.currentValueINR || 0), 0), [statusFiltered]);
  const totalInvested = useMemo(() => statusFiltered.reduce((sum, h) => sum + (h.investedValueINR || 0), 0), [statusFiltered]);
  const totalGain = totalCurrent - totalInvested;

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
      ? <ArrowUp className="w-3 h-3 text-amber-400 inline ml-1" /> 
      : <ArrowDown className="w-3 h-3 text-amber-400 inline ml-1" />;
  };

  const activeCount = rawMfs.filter(h => (Number(h.quantity) || 0) > 0).length;
  const closedCount = rawMfs.filter(h => (Number(h.quantity) || 0) === 0).length;

  return (
    <>
      <AnimatedPage className="space-y-5">
      
      {/* Banner */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/12 text-amber-400 border border-amber-500/25">
                AMFI LIVE NAV
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                Sorted by <span className="text-amber-400 font-bold uppercase">{sortField} ({sortOrder})</span>
              </span>
            </div>
            <h2 className="text-xl font-black text-white flex items-center gap-2 mt-1.5">
              <LineChart className="w-5 h-5 text-amber-400" />
              Mutual Funds
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">Direct growth plans with live AMFI Scheme NAVs</p>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">
                {statusFilter === 'active' ? 'Active MF Value' : statusFilter === 'closed' ? 'Closed MF Value' : 'Total MF Value'}
              </span>
              <div className="text-xl font-black font-mono text-amber-400">{formatMoney(totalCurrent)}</div>
              <div className={`text-[10px] font-bold ${totalGain >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {totalGain >= 0 ? '+' : ''}{formatMoney(totalGain)} gain
              </div>
            </div>
            <motion.button
              onClick={onOpenAddModal}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-obsidian-950 font-black rounded-xl text-xs shadow-lg shadow-amber-500/20"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              Add
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
                    ? 'bg-amber-500 text-obsidian-950 shadow-md font-black' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Active Schemes ({activeCount})
              </button>
              <button
                onClick={() => setStatusFilter('closed')}
                className={`px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                  statusFilter === 'closed' 
                    ? 'bg-slate-700 text-white shadow-md font-black' 
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
                    ? 'bg-indigo-600 text-white shadow-md font-black' 
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All Data ({rawMfs.length})
              </button>
            </div>

            {/* Search Box */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search scheme name or code..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-900/60 select-none">
                  <th onClick={() => handleSort('name')} className="py-3 px-3 rounded-l-xl cursor-pointer hover:text-white">
                    Scheme & AMFI Code {getSortIcon('name')}
                  </th>
                  <th onClick={() => handleSort('quantity')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                    Units {getSortIcon('quantity')}
                  </th>
                  <th onClick={() => handleSort('avg_buy_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                    Avg NAV {getSortIcon('avg_buy_price')}
                  </th>
                  <th onClick={() => handleSort('current_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                    Current NAV {getSortIcon('current_price')}
                  </th>
                  <th onClick={() => handleSort('investedValueINR')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                    Invested {getSortIcon('investedValueINR')}
                  </th>
                  <th onClick={() => handleSort('currentValueINR')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                    Current {getSortIcon('currentValueINR')}
                  </th>
                  <th onClick={() => handleSort('gainINR')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                    P&L {getSortIcon('gainINR')}
                  </th>
                  <th className="py-3 px-3 text-center">Status</th>
                  <th className="py-3 px-3 text-center rounded-r-xl">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-xs">
                {sortedHoldings.map((h, i) => {
                  const qty = Number(h.quantity) || 0;
                  const isClosed = qty === 0;
                  const isGainPositive = (h.gainINR || 0) >= 0;

                  return (
                    <motion.tr 
                      key={h.id} 
                      className={`hover:bg-slate-800/30 ${isClosed ? 'opacity-60 bg-slate-900/20' : ''}`}
                      initial={{ opacity: 0, x: -5 }}
                      animate={{ opacity: isClosed ? 0.6 : 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.03, 0.3) }}
                    >
                      <td className="py-3 px-3">
                        <button onClick={() => setSelectedHolding(h)} className="font-bold text-slate-100 text-[12px] hover:text-amber-400 transition-colors text-left cursor-pointer block">{h.name}</button>
                        <div className="text-[10px] text-slate-500 font-mono">AMFI #{h.symbol} • {h.sector || 'Mutual Funds'}</div>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-300">
                        {qty > 0 ? qty.toLocaleString() : <span className="text-slate-600">0</span>}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-slate-400">₹{h.avg_buy_price}</td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-amber-400">₹{h.current_price}</td>
                      <td className="py-3 px-3 text-right font-mono text-slate-400">{formatMoney(h.investedValueINR)}</td>
                      <td className="py-3 px-3 text-right font-mono font-bold text-slate-100">{formatMoney(h.currentValueINR)}</td>
                      <td className="py-3 px-3 text-right font-mono">
                        <div className={isGainPositive ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                          {isGainPositive ? '+' : ''}₹{(h.gainINR || 0).toLocaleString('en-IN')}
                        </div>
                        <div className="text-[9px] text-slate-500">
                          {isGainPositive ? '+' : ''}{h.gainPct || 0}%
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        {isClosed ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                            <XCircle className="w-2.5 h-2.5 text-slate-500" />
                            REDEEMED
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold badge-emerald">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            ACTIVE
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => onEditHolding(h)} className="p-1 hover:bg-slate-700/60 text-slate-500 hover:text-slate-200 rounded-lg">
                            <Edit3 className="w-3 h-3" />
                          </button>
                          <button onClick={() => onDeleteHolding(h.id)} className="p-1 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-lg">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
                {sortedHoldings.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-slate-600 text-xs">
                      No mutual funds found matching current status filter ({statusFilter})
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

