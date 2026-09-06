import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { DollarSign, Globe, IndianRupee, ArrowUpRight, Award, Calendar, Search, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

export default function DividendsHub() {
  const { formatMoney, fxRate } = useThemeAuth();
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('payment_date');
  const [sortOrder, setSortOrder] = useState('desc');

  useEffect(() => {
    fetchDividends();
  }, []);

  const fetchDividends = async () => {
    try {
      const res = await axios.get('/api/dividends');
      setData(res.data);
    } catch (err) {
      console.error('[Dividends] Error fetching dividends:', err);
    }
  };

  const visibleHistory = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = (data?.history || []).filter(row => !query || [row.asset_name, row.symbol, row.currency].some(value => String(value || '').toLowerCase().includes(query)));
    return [...filtered].sort((a, b) => {
      const left = sortField === 'amount_inr' ? Number(a.amount_inr) || 0 : String(a[sortField] || '').toLowerCase();
      const right = sortField === 'amount_inr' ? Number(b.amount_inr) || 0 : String(b[sortField] || '').toLowerCase();
      if (left < right) return sortOrder === 'asc' ? -1 : 1;
      if (left > right) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, search, sortField, sortOrder]);

  const handleSort = (field) => {
    if (sortField === field) setSortOrder(previous => previous === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder(field === 'payment_date' ? 'desc' : 'asc'); }
  };

  const sortIcon = (field) => sortField !== field
    ? <ArrowUpDown className="w-3 h-3 text-slate-600 inline ml-1" />
    : sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-400 inline ml-1" /> : <ArrowDown className="w-3 h-3 text-emerald-400 inline ml-1" />;

  if (!data) return null;

  return (
    <div className="space-y-6 mb-8">
      
      {/* Top Dividends Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Total Dividends */}
        <div className="glass-panel p-6 rounded-3xl border border-slate-800/80 relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              TOTAL CUMULATIVE DIVIDENDS
            </span>
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Award className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-white font-mono mb-1">
            {formatMoney(data.totalDividendsINR)}
          </div>
          <p className="text-xs text-slate-400">Passive cash returns credited directly to bank account</p>
        </div>

        {/* Indian Dividends */}
        <div className="glass-panel p-6 rounded-3xl border border-slate-800/80">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              INDIAN ASSET DIVIDENDS
            </span>
            <div className="w-10 h-10 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <IndianRupee className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-blue-400 font-mono mb-1">
            ₹{data.totalIndiaINR.toLocaleString('en-IN')}
          </div>
          <p className="text-xs text-slate-400">Dividends from Reliance, TCS, HDFC Bank & MFs</p>
        </div>

        {/* US Dividends */}
        <div className="glass-panel p-6 rounded-3xl border border-slate-800/80">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              US ASSET DIVIDENDS (FX CONVERTED)
            </span>
            <div className="w-10 h-10 rounded-2xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Globe className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-purple-400 font-mono mb-1">
            ${data.totalUSUSD} <span className="text-sm font-semibold text-slate-400">({formatMoney(data.totalUSConvertedINR)})</span>
          </div>
          <p className="text-xs text-slate-400">Converted at USD/INR ₹{fxRate}</p>
        </div>

      </div>

      {/* Dividends History Table */}
      <div className="glass-panel p-6 rounded-3xl border border-slate-800/80">
        <h3 className="text-base font-bold text-slate-100 mb-4 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-emerald-400" />
          Dividend Payment History Log
        </h3>

        <div className="relative w-full md:w-72 mb-4">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search asset, symbol, market..." className="w-full pl-10 pr-4 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50" aria-label="Filter dividend history" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-900/40">
                <th onClick={() => handleSort('asset_name')} className="py-3 px-4 rounded-l-xl cursor-pointer hover:text-white">Asset Symbol / Name {sortIcon('asset_name')}</th>
                <th onClick={() => handleSort('currency')} className="py-3 px-4 cursor-pointer hover:text-white">Market {sortIcon('currency')}</th>
                <th onClick={() => handleSort('amount_original')} className="py-3 px-4 text-right cursor-pointer hover:text-white">Original Amount {sortIcon('amount_original')}</th>
                <th className="py-3 px-4 text-right">FX Conversion Rate</th>
                <th onClick={() => handleSort('amount_inr')} className="py-3 px-4 text-right cursor-pointer hover:text-white">Total INR Credited {sortIcon('amount_inr')}</th>
                <th onClick={() => handleSort('payment_date')} className="py-3 px-4 text-center rounded-r-xl cursor-pointer hover:text-white">Payment Date {sortIcon('payment_date')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/40 text-xs">
              {visibleHistory.map(d => (
                <tr key={d.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="py-3.5 px-4 font-semibold text-slate-200">
                    <div>{d.asset_name}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{d.symbol}</div>
                  </td>

                  <td className="py-3.5 px-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      d.currency === 'USD' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/30' : 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                    }`}>
                      {d.currency === 'USD' ? 'US NASDAQ/NYSE' : 'INDIA NSE'}
                    </span>
                  </td>

                  <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-200">
                    {d.currency === 'USD' ? `$${d.amount_original}` : `₹${d.amount_original.toLocaleString('en-IN')}`}
                  </td>

                  <td className="py-3.5 px-4 text-right font-mono text-slate-400">
                    {d.currency === 'USD' ? `₹${d.fx_rate}` : '1.0 (Local)'}
                  </td>

                  <td className="py-3.5 px-4 text-right font-mono font-extrabold text-emerald-400">
                    ₹{d.amount_inr.toLocaleString('en-IN')}
                  </td>

                  <td className="py-3.5 px-4 text-center text-slate-400 font-mono">
                    {d.payment_date}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
