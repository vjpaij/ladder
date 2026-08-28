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
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'closed'
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
      return true;
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

  // Closed positions banner totals
  const closedBannerTotals = useMemo(() => {
    if (statusFilter !== 'closed') return null;
    let totalCostUSD = 0;
    let totalRedeemedUSD = 0;
    let totalRealizedPnlUSD = 0;
    let totalCostINR = 0;
    let totalRedeemedINR = 0;
    let totalRealizedPnlINR = 0;

    statusFiltered.forEach(h => {
      const soldQty = Number(h.sell_qty) || Number(h.buy_qty) || 0;
      const avgBuyUSD = Number(h.avg_buy_price) || 0;
      const investedUSD = soldQty > 0 ? (soldQty * avgBuyUSD) : 0;
      const txRate = h.txFxRate || 82.5;
      const investedINR = Number(h.investedValueINR) || (investedUSD * txRate);
      const realizedPnlUSD = Number(h.realized_pnl) || 0;
      const realizedPnlINR = realizedPnlUSD * fxRate;
      const redeemedUSD = investedUSD + realizedPnlUSD;
      const redeemedINR = investedINR + realizedPnlINR;

      totalCostUSD += investedUSD;
      totalRedeemedUSD += redeemedUSD;
      totalRealizedPnlUSD += realizedPnlUSD;
      totalCostINR += investedINR;
      totalRedeemedINR += redeemedINR;
      totalRealizedPnlINR += realizedPnlINR;
    });

    const roiPct = totalCostUSD > 0 ? ((totalRealizedPnlUSD / totalCostUSD) * 100).toFixed(2) : 0;
    return {
      totalCostUSD,
      totalRedeemedUSD,
      totalRealizedPnlUSD,
      totalCostINR,
      totalRedeemedINR,
      totalRealizedPnlINR,
      roiPct
    };
  }, [statusFiltered, statusFilter, fxRate]);

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
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
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
              <span className="text-[10px] font-mono text-slate-400">
                As of {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            </div>
            <h2 className="text-xl font-black text-white flex items-center gap-2 mt-1.5">
              <Globe className="w-5 h-5 text-purple-400" />
              US Equity
            </h2>
          </div>

          <div className="flex items-center gap-5 flex-wrap sm:flex-nowrap">
            <div className="flex items-stretch gap-4 bg-slate-900/60 px-4 py-2.5 rounded-2xl border border-slate-800/80">
              <div className="text-right border-r border-slate-800 pr-4 flex flex-col justify-between">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">
                  {statusFilter === 'closed' ? 'Cost Basis' : 'Invested'}
                </span>
                <div className="text-base font-black font-mono text-slate-200">
                  {statusFilter === 'closed' ? (
                    isUSD ? `$${closedBannerTotals?.totalCostUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(closedBannerTotals?.totalCostINR || 0, true)
                  ) : (
                    isUSD ? `$${totalInvestedUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(totalInvestedINR, true)
                  )}
                </div>
                <div className="text-[10px] font-bold font-mono text-slate-500">
                  {statusFilter === 'closed' ? 'Invested Total' : 'Cost Basis'}
                </div>
              </div>

              <div className="text-right flex flex-col justify-between">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block">
                  {statusFilter === 'active' ? 'Active Value' : statusFilter === 'closed' ? 'Redeemed' : 'Total Value'}
                </span>
                <div className="text-base font-black font-mono text-purple-400">
                  {statusFilter === 'closed' ? (
                    isUSD ? `$${closedBannerTotals?.totalRedeemedUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(closedBannerTotals?.totalRedeemedINR || 0, true)
                  ) : (
                    isUSD ? `$${totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(totalConvertedINR, true)
                  )}
                </div>
                <div className={`text-[10px] font-bold font-mono ${
                  (statusFilter === 'closed' ? (closedBannerTotals?.totalRealizedPnlUSD || 0) : totalGainINR) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}>
                  {(statusFilter === 'closed' ? (closedBannerTotals?.totalRealizedPnlUSD || 0) : totalGainINR) >= 0 ? '+' : ''}
                  {statusFilter === 'closed' ? closedBannerTotals?.roiPct : (totalInvestedINR > 0 ? ((totalGainINR / totalInvestedINR) * 100).toFixed(2) : 0)}%
                  {' '}
                  ({statusFilter === 'closed' ? (
                    isUSD ? `${(closedBannerTotals?.totalRealizedPnlUSD || 0) >= 0 ? '+' : '-'}$${Math.abs(closedBannerTotals?.totalRealizedPnlUSD || 0).toFixed(2)}` : formatMoney(closedBannerTotals?.totalRealizedPnlINR || 0, true)
                  ) : (
                    isUSD ? `${totalGainINR >= 0 ? '+' : '-'}$${Math.abs(totalUSD - totalInvestedUSD).toFixed(2)}` : formatMoney(totalGainINR, true)
                  )})
                </div>
              </div>
            </div>

            <motion.button
              onClick={onOpenAddModal}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-black rounded-xl text-xs shadow-lg shadow-purple-500/20 cursor-pointer shrink-0"
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
          
          {/* Controls Bar */}
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
                Active Positions ({activeCount})
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
            </div>

            {/* Search Box */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search US stocks..."
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
                {statusFilter === 'closed' ? (
                  <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-900/60 select-none">
                    <th onClick={() => handleSort('name')} className="py-3 px-3 rounded-l-xl cursor-pointer hover:text-white">
                      Stock Name {getSortIcon('name')}
                    </th>
                    <th onClick={() => handleSort('sell_qty')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      Shares Sold {getSortIcon('sell_qty')}
                    </th>
                    <th onClick={() => handleSort('avg_buy_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      Avg Buy {getSortIcon('avg_buy_price')}
                    </th>
                    <th onClick={() => handleSort('avg_sell_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      Avg Sell {getSortIcon('avg_sell_price')}
                    </th>
                    <th onClick={() => handleSort('investedValueINR')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      Invested Value {getSortIcon('investedValueINR')}
                    </th>
                    <th onClick={() => handleSort('redeemedValue')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      Redeemed Value {getSortIcon('redeemedValue')}
                    </th>
                    <th onClick={() => handleSort('realized_pnl')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      Realized P&amp;L {getSortIcon('realized_pnl')}
                    </th>
                    <th className="py-3 px-3 text-center rounded-r-xl">Actions</th>
                  </tr>
                ) : (
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
                )}
              </thead>
              <tbody className="divide-y divide-slate-800/40 text-xs">
                {sortedHoldings.map((h, i) => {
                  const qty = Number(h.quantity) || 0;
                  const isClosed = qty === 0;

                  // Closed derived position metrics
                  const soldQty = Number(h.sell_qty) || Number(h.buy_qty) || 0;
                  const avgBuyUSD = Number(h.avg_buy_price) || 0;
                  const investedUSD = soldQty > 0 ? (soldQty * avgBuyUSD) : 0;
                  const txRate = h.txFxRate || 82.5;
                  const investedINR = Number(h.investedValueINR) || (investedUSD * txRate);
                  const realizedPnlUSD = Number(h.realized_pnl) || 0;
                  const realizedPnlINR = realizedPnlUSD * fxRate;
                  const redeemedUSD = investedUSD + realizedPnlUSD;
                  const redeemedINR = investedINR + realizedPnlINR;
                  const avgSellUSD = soldQty > 0 ? (redeemedUSD / soldQty) : 0;
                  const avgSellINR = soldQty > 0 ? (redeemedINR / soldQty) : 0;
                  const realizedPnlPct = investedUSD > 0 ? ((realizedPnlUSD / investedUSD) * 100).toFixed(2) : 0;
                  const isRealizedPos = realizedPnlUSD >= 0;

                  // Active position values
                  const usdVal = qty * (Number(h.current_price) || 0);
                  const inrVal = usdVal * fxRate;
                  const usdInvested = qty * (Number(h.avg_buy_price) || 0);
                  const inrInvested = Number(h.investedValueINR) || 0;
                  const usdGain = usdVal - usdInvested;
                  const inrGain = inrVal - inrInvested;
                  const isGainPos = usdGain >= 0;
                  const usdGainPct = usdInvested > 0 ? ((usdGain / usdInvested) * 100).toFixed(2) : 0;

                  return (
                    <motion.tr
                      key={h.id}
                      onClick={() => setSelectedHolding(h)}
                      className={`cursor-pointer transition-all ${
                        isClosed
                          ? 'bg-slate-900/30 hover:bg-slate-800/50 border-l-2 border-l-purple-500/50'
                          : 'hover:bg-slate-800/40 border-l-2 border-l-transparent hover:border-l-purple-500'
                      }`}
                      initial={{ opacity: 0, x: -5 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    >
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <HoldingLogo 
                            holding={h} 
                            className="w-7 h-7 rounded-lg" 
                            fallbackClass="text-[10px]"
                            accentColor={isClosed ? '#a855f7' : '#a855f7'}
                          />
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-[12px] transition-colors block text-slate-100 hover:text-purple-400">
                                {h.name}
                              </span>
                              {isClosed ? (
                                <span className="px-1.5 py-0.2 rounded text-[8.5px] font-bold uppercase tracking-wider bg-purple-500/15 text-purple-400 border border-purple-500/30">
                                  EXITED
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.2 rounded text-[8.5px] font-extrabold uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/25">
                                  ACTIVE
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">{h.symbol} • {h.sector || 'US Equity'}</div>
                          </div>
                        </div>
                      </td>

                      {statusFilter === 'closed' ? (
                        <>
                          <td className="py-3 px-3 text-right font-mono text-slate-200 font-bold">
                            {soldQty.toFixed(4)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-300">
                            {isUSD ? `$${avgBuyUSD.toFixed(2)}` : formatMoney(avgBuyUSD * txRate, true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-purple-400 font-bold">
                            {isUSD ? `$${avgSellUSD.toFixed(2)}` : formatMoney(avgSellINR, true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-200 font-bold">
                            {isUSD ? `$${investedUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(investedINR, true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-100 font-black">
                            {isUSD ? `$${redeemedUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(redeemedINR, true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono">
                            <div className={isRealizedPos ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                              {isUSD ? `${isRealizedPos ? '+' : ''}$${Math.abs(realizedPnlUSD).toFixed(2)}` : `${isRealizedPos ? '+' : ''}${formatMoney(realizedPnlINR, true)}`}
                            </div>
                            <div className={`text-[9px] ${isRealizedPos ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
                              {isRealizedPos ? '+' : ''}{realizedPnlPct}%
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-3 px-3 text-right font-mono">
                            {qty > 0 ? (
                              <span className="text-slate-200 font-bold">{qty.toFixed(4)}</span>
                            ) : (
                              <span className="text-slate-600 font-medium">0</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-400">${Number(h.avg_buy_price).toFixed(2)}</td>
                          <td className="py-3 px-3 text-right font-mono">
                            <div className="text-[12px] font-bold text-purple-400 font-black">
                              ${Number(h.current_price).toFixed(2)}
                            </div>
                            {h.day_change !== undefined && (
                              <div className={`text-[9.5px] font-bold flex items-center justify-end gap-0.5 ${
                                (h.day_change || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                <span>{(h.day_change || 0) >= 0 ? '▲ +' : '▼ '}${Math.abs(h.day_change).toFixed(2)}</span>
                                <span className="opacity-80">({(h.day_change_pct || 0) >= 0 ? '+' : ''}{h.day_change_pct || 0}%)</span>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-slate-100">
                            {isUSD ? `$${usdInvested.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(h.investedValueINR, true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-black text-slate-100">
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
                            <div className={`text-[9px] ${isGainPos ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
                              {isGainPos ? '+' : ''}{isUSD ? usdGainPct : (h.gainPct || 0)}%
                            </div>
                          </td>
                        </>
                      )}

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
