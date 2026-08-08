import React, { useState } from 'react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { 
  Search, 
  Filter, 
  TrendingUp, 
  TrendingDown, 
  CheckCircle2, 
  Clock, 
  Edit3, 
  Trash2, 
  Globe, 
  Building2, 
  PieChart, 
  Landmark, 
  ShieldCheck, 
  ArrowUpRight, 
  ArrowDownRight,
  Sparkles
} from 'lucide-react';

export default function HoldingsTable({ holdings, liabilities, onDeleteHolding, onEditHolding }) {
  const { formatMoney, currency, fxRate } = useThemeAuth();
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  const categories = [
    { id: 'ALL', label: 'All Instruments' },
    { id: 'in_stocks', label: 'Indian Stocks' },
    { id: 'us_stocks', label: 'US Equities' },
    { id: 'mutual_funds', label: 'Mutual Funds' },
    { id: 'bank', label: 'Bank & FDs' },
    { id: 'nps', label: 'NPS' },
    { id: 'epf', label: 'EPF' },
    { id: 'LIABILITIES', label: 'Liabilities' },
  ];

  const filteredHoldings = holdings.filter(h => {
    const matchesSearch = h.name.toLowerCase().includes(search.toLowerCase()) || 
                          h.symbol.toLowerCase().includes(search.toLowerCase()) ||
                          (h.sector && h.sector.toLowerCase().includes(search.toLowerCase()));
    
    if (selectedCategory === 'ALL') return matchesSearch;
    if (selectedCategory === 'LIABILITIES') return false;
    return matchesSearch && h.category_id === selectedCategory;
  });

  const filteredLiabilities = (selectedCategory === 'ALL' || selectedCategory === 'LIABILITIES') 
    ? liabilities.filter(l => l.name.toLowerCase().includes(search.toLowerCase()) || l.lender.toLowerCase().includes(search.toLowerCase()))
    : [];

  return (
    <div className="glass-panel rounded-3xl p-6 border border-slate-800/80 mb-8">
      
      {/* Table Controls Header */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-6">
        
        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-900/80 p-1.5 rounded-2xl border border-slate-800 overflow-x-auto max-w-full">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                selectedCategory === cat.id
                  ? 'bg-slate-800 text-emerald-400 border border-emerald-500/30 shadow-sm font-bold'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <div className="relative w-full md:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search symbol, asset, sector..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-900/80 border border-slate-800 rounded-xl text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50 transition-all placeholder:text-slate-500"
          />
        </div>

      </div>

      {/* High-Density Production Data Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800/80 text-[11px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-900/40">
              <th className="py-3.5 px-4 rounded-l-xl">Instrument / Symbol</th>
              <th className="py-3.5 px-4">Exchange / Type</th>
              <th className="py-3.5 px-4 text-right">Quantity</th>
              <th className="py-3.5 px-4 text-right">Avg Buy Price</th>
              <th className="py-3.5 px-4 text-right">Current Price</th>
              <th className="py-3.5 px-4 text-right">Current Value</th>
              <th className="py-3.5 px-4 text-right">Total Gain / P&L</th>
              <th className="py-3.5 px-4 text-center">Status / Price API</th>
              <th className="py-3.5 px-4 text-center rounded-r-xl">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/40 text-xs">
            
            {/* Holdings Rows */}
            {filteredHoldings.map(h => {
              const isGainPositive = h.gainINR >= 0;
              const isUS = h.currency === 'USD';

              return (
                <tr key={h.id} className="hover:bg-slate-800/30 transition-colors group">
                  
                  {/* Name & Symbol */}
                  <td className="py-4 px-4 font-medium">
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs shadow-sm"
                        style={{ backgroundColor: `${h.category_color}15`, color: h.category_color, border: `1px solid ${h.category_color}40` }}
                      >
                        {h.symbol.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-bold text-slate-100 flex items-center gap-1.5">
                          {h.name}
                          {isUS && <span className="text-[10px] px-1.5 py-0.2 bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 rounded font-mono">USD</span>}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-2">
                          <span className="font-mono">{h.symbol}</span>
                          <span>•</span>
                          <span>{h.sector || h.category_name}</span>
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Exchange Badge */}
                  <td className="py-4 px-4">
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700/60 font-mono">
                      {h.exchange}
                    </span>
                  </td>

                  {/* Quantity */}
                  <td className="py-4 px-4 text-right font-mono text-slate-200">
                    {h.quantity.toLocaleString()}
                  </td>

                  {/* Avg Buy Price */}
                  <td className="py-4 px-4 text-right font-mono text-slate-300">
                    {isUS ? `$${h.avg_buy_price}` : `₹${h.avg_buy_price.toLocaleString('en-IN')}`}
                  </td>

                  {/* Current Price & NSE/BSE Comparison Pill */}
                  <td className="py-4 px-4 text-right font-mono text-slate-100 font-bold">
                    <div>
                      {isUS ? `$${h.current_price}` : `₹${h.current_price.toLocaleString('en-IN')}`}
                    </div>
                    {h.category_id === 'in_stocks' && h.nse_price > 0 && h.bse_price > 0 && (
                      <div className="text-[10px] text-emerald-400/90 font-sans mt-0.5">
                        NSE: ₹{h.nse_price} | BSE: ₹{h.bse_price}
                      </div>
                    )}
                  </td>

                  {/* Current Value */}
                  <td className="py-4 px-4 text-right font-mono font-extrabold text-slate-100">
                    {formatMoney(h.currentValueINR)}
                  </td>

                  {/* P&L */}
                  <td className="py-4 px-4 text-right font-mono font-bold">
                    <div className={isGainPositive ? 'text-emerald-400' : 'text-rose-400'}>
                      {isGainPositive ? '+' : ''}{formatMoney(h.gainINR)}
                    </div>
                    <div className={`text-[10px] font-semibold ${isGainPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {isGainPositive ? '+' : ''}{h.gainPct}%
                    </div>
                  </td>

                  {/* Status / Latest Price API Highlight */}
                  <td className="py-4 px-4 text-center">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      LATEST TODAY
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="py-4 px-4 text-center">
                    <div className="flex items-center justify-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onEditHolding(h)}
                        className="p-1.5 hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 rounded-lg transition-colors"
                        title="Edit position"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDeleteHolding(h.id)}
                        className="p-1.5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 rounded-lg transition-colors"
                        title="Delete position"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>

                </tr>
              );
            })}

            {/* Liabilities Rows */}
            {filteredLiabilities.map(l => (
              <tr key={`liab-${l.id}`} className="bg-rose-950/10 hover:bg-rose-950/20 transition-colors">
                <td className="py-4 px-4 font-medium">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 font-bold text-xs">
                      LIAB
                    </div>
                    <div>
                      <div className="font-bold text-rose-200">{l.name}</div>
                      <div className="text-[11px] text-slate-400">{l.lender} • Due Day {l.due_day}</div>
                    </div>
                  </div>
                </td>

                <td className="py-4 px-4">
                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/30 font-mono">
                    LIABILITY
                  </span>
                </td>

                <td className="py-4 px-4 text-right font-mono text-slate-400">1</td>
                <td className="py-4 px-4 text-right font-mono text-slate-400">-</td>
                <td className="py-4 px-4 text-right font-mono text-slate-400">-</td>

                <td className="py-4 px-4 text-right font-mono font-extrabold text-rose-400">
                  {formatMoney(l.outstanding_balance)}
                </td>

                <td className="py-4 px-4 text-right font-mono text-slate-400 text-[11px]">
                  EMI: ₹{l.monthly_emi.toLocaleString('en-IN')}
                </td>

                <td className="py-4 px-4 text-center">
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    {l.interest_rate}% p.a.
                  </span>
                </td>

                <td className="py-4 px-4 text-center text-slate-500">-</td>
              </tr>
            ))}

            {filteredHoldings.length === 0 && filteredLiabilities.length === 0 && (
              <tr>
                <td colSpan="9" className="py-12 text-center text-slate-500">
                  No investment instruments match your filter criteria.
                </td>
              </tr>
            )}

          </tbody>
        </table>
      </div>

    </div>
  );
}
