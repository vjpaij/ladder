import React, { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { LineChart, Plus, Search, Edit3, Trash2, CheckCircle2, ArrowUpDown, ArrowUp, ArrowDown, XCircle, RefreshCw, Loader2, Clock, Repeat } from 'lucide-react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';
import HoldingDetailModal from '../components/HoldingDetailModal';
import HoldingLogo from '../components/HoldingLogo';
import SipManagerModal from '../components/SipManagerModal';

export default function MutualFundsView({ summary, holdings, onDeleteHolding, onEditHolding, onOpenAddModal, onRefresh }) {
  const { formatMoney } = useThemeAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'closed'
  const [sortField, setSortField] = useState('name'); // Default sort by name
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' | 'desc'
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [isRefreshingNavs, setIsRefreshingNavs] = useState(false);
  const [refreshToast, setRefreshToast] = useState(null);
  const [isSipModalOpen, setIsSipModalOpen] = useState(false);
  const closeDetail = useCallback(() => setSelectedHolding(null), []);

  const handleRefreshNavs = async () => {
    setIsRefreshingNavs(true);
    try {
      const res = await axios.post('/api/refresh-navs');
      if (onRefresh) await onRefresh();
      setRefreshToast(res.data.message || 'NAVs updated successfully!');
      setTimeout(() => setRefreshToast(null), 4000);
    } catch (err) {
      setRefreshToast('Error syncing NAVs: ' + (err.response?.data?.error || err.message));
      setTimeout(() => setRefreshToast(null), 4000);
    } finally {
      setIsRefreshingNavs(false);
    }
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const todayFormatted = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
  const todayShortFormatted = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const isUpToDate = (qd) => {
    if (!qd) return false;
    return qd === todayStr || qd === todayFormatted || qd === todayShortFormatted;
  };

  const rawMfs = useMemo(() => {
    return holdings.filter(h => h.category_id === 'mutual_funds');
  }, [holdings]);

  const upToDateCount = useMemo(() => {
    return rawMfs
      .filter(h => (Number(h.quantity) || 0) > 0)
      .filter(h => {
        const qd = h.quote_date || (h.updated_at ? h.updated_at.split('T')[0] : '');
        return isUpToDate(qd);
      }).length;
  }, [rawMfs, todayStr, todayFormatted, todayShortFormatted]);

  // Filter by status tab
  const statusFiltered = useMemo(() => {
    return rawMfs.filter(h => {
      const qty = Number(h.quantity) || 0;
      if (statusFilter === 'active') return qty > 0;
      if (statusFilter === 'closed') return qty === 0;
      return true;
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
  const roiPct = totalInvested > 0 ? ((totalGain / totalInvested) * 100).toFixed(2) : '0.00';

  // Closed positions banner totals
  const closedBannerTotals = useMemo(() => {
    if (statusFilter !== 'closed') return null;
    let totalCost = 0;
    let totalRedeemed = 0;
    let totalRealizedPnl = 0;
    statusFiltered.forEach(h => {
      const soldQty = Number(h.sell_qty) || Number(h.buy_qty) || 0;
      const avgBuy = Number(h.avg_buy_price) || 0;
      const realizedPnl = Number(h.realized_pnl) || 0;
      const investedVal = soldQty > 0 ? (soldQty * avgBuy) : (Number(h.investedValueINR) || 0);
      const redeemedVal = investedVal + realizedPnl;
      totalCost += investedVal;
      totalRedeemed += redeemedVal;
      totalRealizedPnl += realizedPnl;
    });
    const netPnl = totalRedeemed - totalCost;
    const netRoiPct = totalCost > 0 ? ((netPnl / totalCost) * 100).toFixed(2) : 0;
    return { totalCost, totalRedeemed, netPnl, netRoiPct };
  }, [statusFiltered, statusFilter]);

  // Combined overall performance (Active + Redeemed + Dividends)
  const combinedTotals = useMemo(() => {
    const metrics = summary?.categoryMetrics?.find(c => c.id === 'mutual_funds');
    let totalCost = 0;
    rawMfs.forEach(h => {
      // Active cost
      totalCost += (h.investedValueINR || 0);
      // Redeemed cost
      const soldQty = Number(h.sell_qty) || (Number(h.quantity) === 0 ? Number(h.buy_qty) || 0 : 0);
      if (soldQty > 0) {
        const avgBuy = Number(h.avg_buy_price) || 0;
        totalCost += (soldQty * avgBuy);
      }
    });

    const pnl = metrics ? (metrics.realizedINR + metrics.unrealizedINR) : 0;
    const absPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
    const xirr = metrics ? metrics.xirrPct : 0;
    const activeXirr = metrics ? metrics.activeXirrPct : 0;
    const closedXirr = metrics ? metrics.closedXirrPct : 0;
    
    return { cost: totalCost, pnl, absPct, xirr, activeXirr, closedXirr };
  }, [rawMfs, summary]);

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
          <div className="glass-card p-4 sm:p-5 rounded-3xl border border-slate-800 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-5">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/12 text-amber-400 border border-amber-500/25">
                  AMFI LIVE NAV
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-black text-white flex items-center gap-2">
                  <LineChart className="w-5 h-5 text-amber-400" />
                  Mutual Funds
                </h2>
                <motion.button
                  onClick={handleRefreshNavs}
                  disabled={isRefreshingNavs}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  className="p-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-amber-400 border border-slate-800 cursor-pointer transition-all disabled:opacity-50"
                  title="Refresh AMFI NAVs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingNavs ? 'animate-spin text-amber-400' : ''}`} />
                </motion.button>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border flex items-center gap-1.5 ${
                  upToDateCount === activeCount && activeCount > 0
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${upToDateCount === activeCount && activeCount > 0 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  {upToDateCount === activeCount && activeCount > 0 ? 'All Schemes Up-to-Date' : `${upToDateCount} / ${activeCount} Schemes Up-to-Date`}
                </span>
              </div>
            </div>

            {/* Right: Sleek Multi-Color Hero Value & Action Button */}
            <div className="flex items-center gap-4 sm:gap-6 relative z-10 shrink-0 flex-wrap sm:flex-nowrap justify-between xl:justify-end w-full xl:w-auto">
              <div className="text-right">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                  {statusFilter === 'active' ? 'Active Mutual Funds Value' : 'Total Realized Proceeds'}
                </span>
                <div className={`text-2xl sm:text-3xl font-black font-mono bg-clip-text text-transparent ${
                  statusFilter === 'active'
                    ? 'bg-gradient-to-r from-amber-400 via-yellow-300 to-emerald-300'
                    : 'bg-gradient-to-r from-amber-400 via-orange-300 to-rose-400'
                }`}>
                  {statusFilter === 'active'
                    ? formatMoney(totalCurrent)
                    : formatMoney(closedBannerTotals?.totalRedeemed || 0)
                  }
                </div>
                <div className="text-[10.5px] font-bold font-mono mt-0.5 flex items-center justify-end gap-1.5 text-slate-400 flex-wrap sm:flex-nowrap">
                  {statusFilter === 'active' ? (
                    <>
                      <span>Cost: <strong className="text-slate-200">{formatMoney(totalInvested, true)}</strong></span>
                      <span className="text-slate-600">•</span>
                      <span className={totalGain >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {totalGain >= 0 ? '+' : ''}{formatMoney(totalGain, true)} ({totalGain >= 0 ? '+' : ''}{roiPct}%)
                      </span>
                      <span className="text-slate-600">•</span>
                      <span className={combinedTotals.activeXirr >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        XIRR: {combinedTotals.activeXirr >= 0 ? '+' : ''}{combinedTotals.activeXirr.toFixed(2)}%
                      </span>
                    </>
                  ) : (
                    <>
                      <span>Cost: <strong className="text-slate-200">{formatMoney(closedBannerTotals?.totalCost || 0, true)}</strong></span>
                      <span className="text-slate-600">•</span>
                      <span className={(closedBannerTotals?.netPnl || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {(closedBannerTotals?.netPnl || 0) >= 0 ? '+' : ''}{formatMoney(closedBannerTotals?.netPnl || 0, true)} ({(closedBannerTotals?.netRoiPct || 0) >= 0 ? '+' : ''}{closedBannerTotals?.netRoiPct || 0}%)
                      </span>
                      <span className="text-slate-600">•</span>
                      <span className={combinedTotals.closedXirr >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        XIRR: {combinedTotals.closedXirr >= 0 ? '+' : ''}{combinedTotals.closedXirr.toFixed(2)}%
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Add Mutual Fund Button */}
              <motion.button
                onClick={onOpenAddModal}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-1.5 px-4 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-obsidian-950 font-black rounded-2xl text-xs shadow-lg shadow-amber-500/20 cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                Add Mutual Fund
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
                  className={`px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                    statusFilter === 'active' 
                      ? 'bg-amber-500 text-obsidian-950 shadow-md font-black' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Active Positions ({activeCount})
                </button>
                <button
                  onClick={() => setStatusFilter('closed')}
                  className={`px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                    statusFilter === 'closed' 
                      ? 'bg-amber-500 text-obsidian-950 shadow-md font-black' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Fully Redeemed ({closedCount})
                </button>
              </div>

              {/* Recurring SIP Button & Search Box */}
              <div className="flex items-center gap-2.5 w-full sm:w-auto">
                <motion.button
                  onClick={() => setIsSipModalOpen(true)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white font-bold rounded-xl text-xs border border-slate-800 cursor-pointer shrink-0 transition-colors"
                  title="Manage automated recurring SIP schedules"
                >
                  <Repeat className="w-3.5 h-3.5 text-amber-400" />
                  Recurring SIP
                </motion.button>

                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search schemes..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
            </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                {statusFilter === 'closed' ? (
                  <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-900/60 select-none">
                    <th onClick={() => handleSort('name')} className="py-3 px-3 rounded-l-xl cursor-pointer hover:text-white">
                      Scheme Name {getSortIcon('name')}
                    </th>
                    <th onClick={() => handleSort('sell_qty')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      Units Sold {getSortIcon('sell_qty')}
                    </th>
                    <th onClick={() => handleSort('avg_buy_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      Avg NAV {getSortIcon('avg_buy_price')}
                    </th>
                    <th onClick={() => handleSort('avg_sell_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      Avg Sell NAV {getSortIcon('avg_sell_price')}
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
                      Scheme Name {getSortIcon('name')}
                    </th>
                    <th onClick={() => handleSort('quantity')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      Units {getSortIcon('quantity')}
                    </th>
                    <th onClick={() => handleSort('avg_buy_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      Avg NAV {getSortIcon('avg_buy_price')}
                    </th>
                    <th onClick={() => handleSort('current_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white">
                      NAV {getSortIcon('current_price')}
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
              <tbody className="[&>tr]:border-b [&>tr]:border-slate-800/40 text-xs">
                {sortedHoldings.map((h, i) => {
                  const qty = Number(h.quantity) || 0;
                  const isClosed = qty === 0;

                  // Closed derived metrics
                  const soldQty = Number(h.sell_qty) || Number(h.buy_qty) || 0;
                  const avgBuy = Number(h.avg_buy_price) || 0;
                  const investedVal = soldQty > 0 ? (soldQty * avgBuy) : (Number(h.investedValueINR) || 0);
                  const realizedPnl = Number(h.realized_pnl) || 0;
                  const redeemedVal = investedVal + realizedPnl;
                  const avgSell = soldQty > 0 ? (redeemedVal / soldQty) : 0;
                  const realizedPnlPct = investedVal > 0 ? ((realizedPnl / investedVal) * 100).toFixed(2) : 0;
                  const isRealizedPos = realizedPnl >= 0;

                  const isGainPositive = (h.gainINR || 0) >= 0;

                  return (
                    <motion.tr 
                      key={h.id} 
                      onClick={() => setSelectedHolding(h)}
                      className={`cursor-pointer transition-all ${
                        isClosed
                          ? 'bg-slate-900/30 hover:bg-slate-800/50'
                          : 'hover:bg-slate-800/40'
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
                            accentColor={isClosed ? '#f59e0b' : '#f59e0b'}
                          />
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-[12px] text-slate-100 hover:text-amber-400">
                                {h.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-[10px] text-slate-500 font-mono">AMFI #{h.symbol}{h.sector && h.sector !== 'Unknown' ? ` • ${h.sector}` : ''}</span>
                                {h.quote_date && (
                                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[8.5px] font-bold ${
                                    isUpToDate(h.quote_date)
                                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                                      : 'bg-amber-500/10 text-amber-400/90 border border-amber-500/20'
                                  }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${isUpToDate(h.quote_date) ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                                    {isUpToDate(h.quote_date) ? `Today (${h.quote_date})` : `As of ${h.quote_date}`}
                                  </span>
                                )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {statusFilter === 'closed' ? (
                        <>
                          <td className="py-3 px-3 text-right font-mono text-slate-200 font-bold">
                            {soldQty.toLocaleString()}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-300">
                            {formatMoney(avgBuy, true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-amber-400 font-bold">
                            {formatMoney(avgSell, true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-200 font-bold">
                            {formatMoney(investedVal, true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-100 font-black">
                            {formatMoney(redeemedVal, true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono">
                            <div className={isRealizedPos ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                              {isRealizedPos ? '+' : ''}{formatMoney(realizedPnl, true)}
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
                              <span className="text-slate-200 font-bold">{qty.toLocaleString()}</span>
                            ) : (
                              <span className="text-slate-600 font-medium">0</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-400">{formatMoney(h.avg_buy_price, true)}</td>
                          <td className="py-3 px-3 text-right font-mono">
                            <div className="text-[12px] font-bold text-amber-400 font-black">
                              {formatMoney(h.current_price, true)}
                            </div>
                            {h.day_change !== undefined && (
                              <div className={`text-[9.5px] font-bold flex items-center justify-end gap-0.5 ${
                                (h.day_change || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                <span>{(h.day_change || 0) >= 0 ? '▲ +' : '▼ '}{formatMoney(Math.abs(h.day_change), true)}</span>
                                <span className="opacity-80">({(h.day_change_pct || 0) >= 0 ? '+' : ''}{h.day_change_pct || 0}%)</span>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-slate-100">{formatMoney(h.investedValueINR, true)}</td>
                          <td className="py-3 px-3 text-right font-mono font-black text-slate-100">{formatMoney(h.currentValueINR, true)}</td>
                          <td className="py-3 px-3 text-right font-mono">
                            <div className={isGainPositive ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                              {isGainPositive ? '+' : ''}{formatMoney(h.gainINR || 0, true)}
                            </div>
                            <div className={`text-[9px] ${isGainPositive ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
                              {isGainPositive ? '+' : ''}{h.gainPct || 0}%
                            </div>
                          </td>
                        </>
                      )}

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

      <SipManagerModal
        isOpen={isSipModalOpen}
        onClose={() => setIsSipModalOpen(false)}
        holdings={holdings}
      />
    </>
  );
}
