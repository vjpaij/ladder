import React, { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Globe, Search, X, Plus, CheckCircle2, Edit3, Trash2, ArrowUpDown, ArrowUp, ArrowDown, XCircle, DollarSign, RefreshCw } from 'lucide-react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { getQuoteBadgeStatus } from '../utils/dateFormatter';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';
import HoldingDetailModal from '../components/HoldingDetailModal';
import HoldingLogo from '../components/HoldingLogo';

export default function UsStocksView({ summary, holdings, onDeleteHolding, onEditHolding, onOpenAddModal, onRefresh }) {
  const { currency, toggleCurrency, formatMoney, formatRawUSD, fxRate, liveFxRate, isUSD } = useThemeAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'closed'
  const [sortField, setSortField] = useState('name'); // Default sort by name
  const [sortOrder, setSortOrder] = useState('asc'); // 'asc' | 'desc'
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const [refreshToast, setRefreshToast] = useState(null);
  const closeDetail = useCallback(() => setSelectedHolding(null), []);

  const handleRefreshPrices = async () => {
    setIsRefreshingPrices(true);
    try {
      const res = await axios.post('/api/refresh-prices');
      if (onRefresh) await onRefresh();
      setRefreshToast(res.data?.message || 'US stock quotes updated successfully!');
      setTimeout(() => setRefreshToast(null), 4000);
    } catch (err) {
      setRefreshToast('Error refreshing US quotes: ' + (err.response?.data?.error || err.message));
      setTimeout(() => setRefreshToast(null), 4000);
    } finally {
      setIsRefreshingPrices(false);
    }
  };

  const rawUsStocks = useMemo(() => {
    return holdings.filter(h => h.category_id === 'us_stocks');
  }, [holdings]);

  const upToDateCount = useMemo(() => {
    return rawUsStocks
      .filter(h => (Number(h.quantity) || 0) > 0)
      .filter(h => getQuoteBadgeStatus(h.quote_date).isUpToDate).length;
  }, [rawUsStocks]);

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

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
        if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      }
      aVal = Number(aVal) || 0;
      bVal = Number(bVal) || 0;
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }, [searchFiltered, sortField, sortOrder]);

  const totalUSD = useMemo(() => statusFiltered.reduce((sum, h) => sum + ((Number(h.quantity) || 0) * (Number(h.current_price) || 0)), 0), [statusFiltered]);
  const totalInvestedUSD = useMemo(() => statusFiltered.reduce((sum, h) => sum + ((Number(h.quantity) || 0) * (Number(h.avg_buy_price) || 0)), 0), [statusFiltered]);
  const totalInvestedINR = useMemo(() => statusFiltered.reduce((sum, h) => sum + (Number(h.investedValueINR) || 0), 0), [statusFiltered]);
  const totalConvertedINR = totalUSD * fxRate;
  const totalGainINR = totalConvertedINR - totalInvestedINR;
  const totalGainUSD = totalUSD - totalInvestedUSD;
  const roiPct = totalInvestedUSD > 0 ? ((totalGainUSD / totalInvestedUSD) * 100).toFixed(2) : '0.00';

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
      const soldQty = Number(h.sell_qty) || Number(h.sold_qty) || Number(h.buy_qty) || 0;
      const avgBuyUSD = Number(h.avg_buy_price) || 0;
      const investedUSD = soldQty > 0 ? (soldQty * avgBuyUSD) : 0;
      const txRate = h.txFxRate || (investedUSD > 0 && Number(h.investedValueINR) ? Number(h.investedValueINR) / investedUSD : fxRate) || 1.0;
      const investedINR = Number(h.investedValueINR) || (investedUSD * txRate);
      const realizedPnlUSD = Number(h.realized_pnl) || 0;
      const realizedPnlINR = realizedPnlUSD * fxRate;
      const redeemedUSD = Number(h.redeemed_value) > 0 ? Number(h.redeemed_value) : (investedUSD + realizedPnlUSD);
      const redeemedINR = redeemedUSD * fxRate;

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

  // Combined overall performance (Active + Redeemed + Dividends)
  const combinedTotals = useMemo(() => {
    const metrics = summary?.categoryMetrics?.find(c => c.id === 'us_stocks');
    let totalCostUSD = 0;
    let totalCostINR = 0;
    
    rawUsStocks.forEach(h => {
      // Active cost
      const activeQty = Number(h.quantity) || 0;
      const avgBuyUSD = Number(h.avg_buy_price) || 0;
      const txRate = h.txFxRate || (activeQty * avgBuyUSD > 0 && Number(h.investedValueINR) ? Number(h.investedValueINR) / (activeQty * avgBuyUSD) : fxRate) || 1.0;
      
      const activeInvestedUSD = activeQty * avgBuyUSD;
      const activeInvestedINR = Number(h.investedValueINR) || (activeInvestedUSD * txRate);
      
      totalCostUSD += activeInvestedUSD;
      totalCostINR += activeInvestedINR;
      
      // Redeemed cost
      const soldQty = Number(h.sell_qty) || (Number(h.quantity) === 0 ? Number(h.buy_qty) || 0 : 0);
      if (soldQty > 0) {
        const closedInvestedUSD = soldQty * avgBuyUSD;
        const closedInvestedINR = closedInvestedUSD * txRate;
        totalCostUSD += closedInvestedUSD;
        totalCostINR += closedInvestedINR;
      }
    });

    const pnlINR = metrics ? (metrics.realizedINR + metrics.unrealizedINR) : 0;
    const pnlUSD = fxRate ? (pnlINR / fxRate) : 0;
    const absPct = totalCostINR > 0 ? (pnlINR / totalCostINR) * 100 : 0;
    const xirr = metrics ? metrics.xirrPct : 0;
    const activeXirr = metrics ? metrics.activeXirrPct : 0;
    const closedXirr = metrics ? metrics.closedXirrPct : 0;
    
    return { costUSD: totalCostUSD, costINR: totalCostINR, pnlUSD, pnlINR, absPct, xirr, activeXirr, closedXirr };
  }, [rawUsStocks, summary, fxRate]);

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
          <div className="glass-card p-4 sm:p-5 rounded-3xl border border-slate-800 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-5">
            <div>
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/30">
                  <motion.span 
                    className="w-1.5 h-1.5 rounded-full bg-purple-400"
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                  NASDAQ / NYSE LIVE FEED
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-black text-white flex items-center gap-2">
                  <Globe className="w-5 h-5 text-purple-400" />
                  US Equity
                </h2>
                <motion.button
                  onClick={handleRefreshPrices}
                  disabled={isRefreshingPrices}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  className="p-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-purple-400 border border-slate-800 cursor-pointer transition-all disabled:opacity-50"
                  title="Refresh US Stock Quotes & FX Rate"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingPrices ? 'animate-spin text-purple-400' : ''}`} />
                </motion.button>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border flex items-center gap-1.5 ${
                  upToDateCount === activeCount && activeCount > 0
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-purple-500/15 text-purple-400 border-purple-500/30'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${upToDateCount === activeCount && activeCount > 0 ? 'bg-emerald-400' : 'bg-purple-400'}`} />
                  {upToDateCount === activeCount && activeCount > 0 ? 'All Stocks Up-to-Date' : `${upToDateCount} / ${activeCount} Stocks Up-to-Date`}
                </span>
              </div>
            </div>

            {/* Right: Sleek Multi-Color Hero Value & Action Button */}
            <div className="flex items-center gap-4 sm:gap-6 relative z-10 shrink-0 flex-wrap sm:flex-nowrap justify-between xl:justify-end w-full xl:w-auto">
              <div className="text-right">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                  {statusFilter === 'active' ? 'Active US Equity Value' : 'Total Realized Proceeds'}
                </span>
                <div className={`text-2xl sm:text-3xl font-black font-mono bg-clip-text text-transparent ${
                  statusFilter === 'active'
                    ? 'bg-gradient-to-r from-purple-400 via-indigo-300 to-sky-300'
                    : 'bg-gradient-to-r from-amber-400 via-orange-300 to-rose-400'
                }`}>
                  {statusFilter === 'active'
                    ? (isUSD ? `$${totalUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(totalConvertedINR))
                    : (isUSD ? `$${(closedBannerTotals?.totalRedeemedUSD || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(closedBannerTotals?.totalRedeemedINR || 0))
                  }
                </div>
                <div className="text-[10.5px] font-bold font-mono mt-0.5 flex items-center justify-end gap-1.5 text-slate-400 flex-wrap sm:flex-nowrap">
                  {statusFilter === 'active' ? (
                    <>
                      <span>Cost: <strong className="text-slate-200">{isUSD ? `$${totalInvestedUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(totalInvestedINR, true)}</strong></span>
                      <span className="text-slate-600">•</span>
                      <span className={totalGainINR >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {isUSD ? `${totalGainINR >= 0 ? '+' : '-'}$${Math.abs(totalUSD - totalInvestedUSD).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${totalGainINR >= 0 ? '+' : ''}${formatMoney(totalGainINR, true)}`} ({totalGainINR >= 0 ? '+' : ''}{roiPct}%)
                      </span>
                      <span className="text-slate-600">•</span>
                      <span className={combinedTotals.activeXirr >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        XIRR: {combinedTotals.activeXirr >= 0 ? '+' : ''}{combinedTotals.activeXirr.toFixed(2)}%
                      </span>
                    </>
                  ) : (
                    <>
                      <span>Cost: <strong className="text-slate-200">{isUSD ? `$${(closedBannerTotals?.totalCostUSD || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(closedBannerTotals?.totalCostINR || 0, true)}</strong></span>
                      <span className="text-slate-600">•</span>
                      <span className={(closedBannerTotals?.totalRealizedPnlINR || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {isUSD ? `${(closedBannerTotals?.totalRealizedPnlUSD || 0) >= 0 ? '+' : '-'}$${Math.abs(closedBannerTotals?.totalRealizedPnlUSD || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${(closedBannerTotals?.totalRealizedPnlINR || 0) >= 0 ? '+' : ''}${formatMoney(closedBannerTotals?.totalRealizedPnlINR || 0, true)}`} ({(closedBannerTotals?.roiPct || 0) >= 0 ? '+' : ''}{closedBannerTotals?.roiPct || 0}%)
                      </span>
                      <span className="text-slate-600">•</span>
                      <span className={combinedTotals.closedXirr >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        XIRR: {combinedTotals.closedXirr >= 0 ? '+' : ''}{combinedTotals.closedXirr.toFixed(2)}%
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Add US Stock Button */}
              <motion.button
                onClick={onOpenAddModal}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-1.5 px-4 py-3 bg-gradient-to-r from-purple-500 to-indigo-600 text-white font-black rounded-2xl text-xs shadow-lg shadow-purple-500/20 cursor-pointer shrink-0"
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
                  className={`px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
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
                  className={`px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1.5 ${
                    statusFilter === 'closed' 
                      ? 'bg-purple-600 text-white shadow-md font-black' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Fully Redeemed ({closedCount})
                </button>
              </div>

              {/* Right: Currency Switcher & Search Box */}
              <div className="flex items-center gap-2.5 w-full sm:w-auto">
                <button
                  onClick={toggleCurrency}
                  className="px-3 py-1.5 bg-slate-900 border border-slate-800 hover:border-purple-500/50 rounded-xl text-xs font-mono font-bold text-purple-300 hover:text-white transition-all flex items-center gap-1.5 shrink-0 shadow-sm"
                  title="Toggle Currency"
                >
                  <DollarSign className="w-3.5 h-3.5 text-purple-400" />
                  <span>{isUSD ? 'USD ($)' : 'INR (₹)'}</span>
                </button>

                {/* Search Box */}
                <div className="relative w-full sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search US stocks..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-10 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-purple-500"
                  />
                  {search && (
                    <button type="button" onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5" aria-label="Clear search">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>

          {/* Table */}
          <div className="relative overflow-x-auto overflow-y-auto max-h-[640px] rounded-2xl border border-slate-800/80 custom-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-30 bg-slate-900 shadow-sm select-none">
                {statusFilter === 'closed' ? (
                  <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-900 select-none">
                    <th className="sticky left-0 top-0 z-40 bg-slate-900 py-3 px-3 whitespace-nowrap border-r border-slate-800 min-w-[220px]">
                      <div className="flex items-center gap-1.5">
                        <span
                          onClick={() => handleSort('name')}
                          className={`cursor-pointer transition-colors hover:text-white flex items-center gap-0.5 ${sortField === 'name' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}
                          title="Sort by Name"
                        >
                          Name {getSortIcon('name')}
                        </span>
                        <span className="text-slate-600 select-none">/</span>
                        <span
                          onClick={() => handleSort('symbol')}
                          className={`cursor-pointer transition-colors hover:text-white flex items-center gap-0.5 ${sortField === 'symbol' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}
                          title="Sort by Ticker Symbol"
                        >
                          Ticker {getSortIcon('symbol')}
                        </span>
                      </div>
                    </th>
                    <th onClick={() => handleSort('sell_qty')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Shares Sold {getSortIcon('sell_qty')}
                    </th>
                    <th onClick={() => handleSort('avg_buy_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Avg Buy {getSortIcon('avg_buy_price')}
                    </th>
                    <th onClick={() => handleSort('avg_sell_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Avg Sell {getSortIcon('avg_sell_price')}
                    </th>
                    <th onClick={() => handleSort('investedValueINR')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Invested Value {getSortIcon('investedValueINR')}
                    </th>
                    <th onClick={() => handleSort('redeemedValue')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Redeemed Value {getSortIcon('redeemedValue')}
                    </th>
                    <th onClick={() => handleSort('realized_pnl')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Realized P&amp;L {getSortIcon('realized_pnl')}
                    </th>
                    <th onClick={() => handleSort('total_dividends')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Dividend {getSortIcon('total_dividends')}
                    </th>
                    <th className="py-3 px-3 text-center whitespace-nowrap">Actions</th>
                  </tr>
                ) : (
                  <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-900 select-none">
                    <th className="sticky left-0 top-0 z-40 bg-slate-900 py-3 px-3 whitespace-nowrap border-r border-slate-800 min-w-[220px]">
                      <div className="flex items-center gap-1.5">
                        <span
                          onClick={() => handleSort('name')}
                          className={`cursor-pointer transition-colors hover:text-white flex items-center gap-0.5 ${sortField === 'name' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}
                          title="Sort by Name"
                        >
                          Name {getSortIcon('name')}
                        </span>
                        <span className="text-slate-600 select-none">/</span>
                        <span
                          onClick={() => handleSort('symbol')}
                          className={`cursor-pointer transition-colors hover:text-white flex items-center gap-0.5 ${sortField === 'symbol' ? 'text-purple-400 font-bold' : 'text-slate-400'}`}
                          title="Sort by Ticker Symbol"
                        >
                          Ticker {getSortIcon('symbol')}
                        </span>
                      </div>
                    </th>
                    <th onClick={() => handleSort('quantity')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Shares {getSortIcon('quantity')}
                    </th>
                    <th onClick={() => handleSort('avg_buy_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap" title="Unrealized Average Buy Price">
                      Avg Buy {getSortIcon('avg_buy_price')}
                    </th>
                    <th onClick={() => handleSort('current_price')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Price {getSortIcon('current_price')}
                    </th>
                    <th onClick={() => handleSort('investedValueINR')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Invested Value {getSortIcon('investedValueINR')}
                    </th>
                    <th onClick={() => handleSort('currentValueINR')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Value {getSortIcon('currentValueINR')}
                    </th>
                    <th onClick={() => handleSort('gainINR')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Unrealized P&amp;L {getSortIcon('gainINR')}
                    </th>
                    <th onClick={() => handleSort('realized_pnl')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Realized P&amp;L {getSortIcon('realized_pnl')}
                    </th>
                    <th onClick={() => handleSort('total_dividends')} className="py-3 px-3 text-right cursor-pointer hover:text-white whitespace-nowrap">
                      Dividend {getSortIcon('total_dividends')}
                    </th>
                    <th className="py-3 px-3 text-center whitespace-nowrap">Actions</th>
                  </tr>
                )}
              </thead>
              <tbody className="[&>tr]:border-b [&>tr]:border-slate-800/40 text-xs">
                {sortedHoldings.map((h, i) => {
                  const qty = Number(h.quantity) || 0;
                  const isClosed = qty === 0;

                  // Closed position derived metrics
                  const soldQty = Number(h.sell_qty) || Number(h.sold_qty) || Number(h.buy_qty) || 0;
                  const avgBuyUSD = Number(h.avg_buy_price) || 0;
                  const avgBuyINR = avgBuyUSD * fxRate;
                  const investedUSD = soldQty > 0 ? (soldQty * avgBuyUSD) : (Number(h.investedValueUSD) || 0);
                  const investedINR = Number(h.investedValueINR) || (investedUSD * fxRate);
                  const realizedPnlUSD = Number(h.realized_pnl) || 0;
                  const realizedPnlINR = Number(h.realized_pnl_inr) || (realizedPnlUSD * fxRate);
                  const redeemedUSD = Number(h.redeemed_value) > 0 ? Number(h.redeemed_value) : (investedUSD + realizedPnlUSD);
                  const redeemedINR = Number(h.redeemed_value_inr) > 0 ? Number(h.redeemed_value_inr) : (redeemedUSD * fxRate);
                  const avgSellUSD = Number(h.avg_sell_price) > 0 ? Number(h.avg_sell_price) : (soldQty > 0 ? (redeemedUSD / soldQty) : 0);
                  const avgSellINR = avgSellUSD * fxRate;
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
                      className={`cursor-pointer transition-all group ${
                        isClosed
                          ? 'bg-slate-900/30 hover:bg-slate-800/50'
                          : 'hover:bg-slate-800/40'
                      }`}
                      initial={{ opacity: 0, x: -5 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    >
                      <td className="sticky left-0 z-20 bg-slate-900/95 group-hover:bg-slate-900/95 py-3 px-3 border-r border-slate-800 min-w-[220px] transition-colors whitespace-nowrap">
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
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              <span className="text-[10px] text-slate-500 font-mono">{h.symbol}{h.sector && h.sector !== 'Unknown' ? ` • ${h.sector}` : ''}</span>
                              {h.quote_date && (() => {
                                const status = getQuoteBadgeStatus(h.quote_date);
                                return (
                                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[8.5px] font-bold ${
                                    status.isUpToDate
                                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                                      : 'bg-purple-500/10 text-purple-400/90 border border-purple-500/20'
                                  }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${status.isUpToDate ? 'bg-emerald-400' : 'bg-purple-400'}`} />
                                    {status.label}
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      </td>

                      {statusFilter === 'closed' ? (
                        <>
                          <td className="py-3 px-3 text-right font-mono text-slate-200 font-bold whitespace-nowrap">
                            {Number(soldQty).toLocaleString('en-US', {maximumFractionDigits: 9})}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-300 whitespace-nowrap">
                            {isUSD ? `$${avgBuyUSD.toFixed(2)}` : formatMoney(avgBuyUSD * txRate, true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-purple-400 font-bold whitespace-nowrap">
                            {isUSD ? `$${avgSellUSD.toFixed(2)}` : formatMoney(avgSellINR, true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-200 font-bold whitespace-nowrap">
                            {isUSD ? `$${investedUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(investedINR, true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-100 font-black whitespace-nowrap">
                            {isUSD ? `$${redeemedUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(redeemedINR, true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                            <div className={isRealizedPos ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                              {isUSD ? `${isRealizedPos ? '+' : ''}$${Math.abs(realizedPnlUSD).toFixed(2)}` : `${isRealizedPos ? '+' : ''}${formatMoney(realizedPnlINR, true)}`}
                            </div>
                            <div className={`text-[9px] ${isRealizedPos ? 'text-emerald-500/70' : 'text-rose-500/70'}`}>
                              {isRealizedPos ? '+' : ''}{realizedPnlPct}%
                            </div>
                          </td>
                          {/* Closed Position Dividend */}
                          <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                            {Number(h.total_dividends || 0) > 0 ? (
                              <span className="text-amber-400 font-bold">
                                {isUSD
                                  ? `$${Number(h.total_dividends).toFixed(2)}`
                                  : formatMoney(Number(h.total_dividends_inr || h.total_dividends * fxRate), true)}
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                            {qty > 0 ? (
                              <span className="text-slate-200 font-bold">{Number(qty).toLocaleString('en-US', {maximumFractionDigits: 9})}</span>
                            ) : (
                              <span className="text-slate-600 font-medium">0</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-slate-400 whitespace-nowrap" title="Unrealized Average Buy Price">
                            {isUSD ? `$${Number(h.avg_buy_price).toFixed(2)}` : formatMoney((Number(h.avg_buy_price) || 0) * (h.txFxRate || fxRate), true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                            <div className="text-[12px] font-black text-purple-400">
                              {isUSD ? `$${Number(h.current_price).toFixed(2)}` : formatMoney((Number(h.current_price) || 0) * fxRate, true)}
                            </div>
                            {h.day_change !== undefined && (
                              <div className={`text-[9.5px] font-bold inline-flex items-center justify-end gap-1 whitespace-nowrap ${
                                (h.day_change || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                {(h.day_change || 0) >= 0 ? (
                                  <ArrowUp className="w-2.5 h-2.5 stroke-[3] shrink-0" />
                                ) : (
                                  <ArrowDown className="w-2.5 h-2.5 stroke-[3] shrink-0" />
                                )}
                                <span>{(h.day_change || 0) >= 0 ? '+' : '-'}${Math.abs(h.day_change).toFixed(2)}</span>
                                <span className="opacity-80">({(h.day_change_pct || 0) >= 0 ? '+' : ''}{h.day_change_pct || 0}%)</span>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-bold text-slate-100 whitespace-nowrap">
                            {isUSD ? `$${usdInvested.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(h.investedValueINR, true)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-black text-slate-100 whitespace-nowrap">
                            {isUSD ? `$${usdVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatMoney(inrVal, true)}
                          </td>
                          {/* Unrealized P&L */}
                          <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
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
                          {/* Realized P&L */}
                          <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                            {Number(h.realized_pnl || 0) !== 0 ? (
                              <span className={Number(h.realized_pnl) >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                                {isUSD
                                  ? `${Number(h.realized_pnl) >= 0 ? '+' : ''}$${Math.abs(Number(h.realized_pnl)).toFixed(2)}`
                                  : `${Number(h.realized_pnl) >= 0 ? '+' : ''}${formatMoney(Number(h.realized_pnl_inr || h.realized_pnl * fxRate), true)}`}
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          {/* Dividend */}
                          <td className="py-3 px-3 text-right font-mono whitespace-nowrap">
                            {Number(h.total_dividends || 0) > 0 ? (
                              <span className="text-amber-400 font-bold">
                                {isUSD
                                  ? `$${Number(h.total_dividends).toFixed(2)}`
                                  : formatMoney(Number(h.total_dividends_inr || h.total_dividends * fxRate), true)}
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                        </>
                      )}

                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <button onClick={(e) => { e.stopPropagation(); onDeleteHolding(h.id); }} className="p-1 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-lg" title="Delete Position">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
                {sortedHoldings.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-10 text-center text-slate-600 text-xs">
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
        <HoldingDetailModal holding={selectedHolding} onClose={closeDetail} onRefresh={onRefresh} />
      )}
    </>
  );
}
