import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Landmark, Plus, Trash2 } from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';

export default function FixedIncomeView({ holdings, onDeleteHolding, onEditHolding, onOpenAddModal, onSelectHolding }) {
  const { formatMoney } = useThemeAuth();
  const [activeTab, setActiveTab] = useState('Active');
  const [searchQuery, setSearchQuery] = useState('');

  const fixedHoldings = holdings.filter(h => ['bank', 'epf'].includes(h.category_id));

  const filteredByStatus = fixedHoldings.filter(h => {
    if (activeTab === 'Active') {
      return h.currentValueINR > 0 && h.status !== 'REDEEMED';
    } else if (activeTab === 'Closed') {
      return h.currentValueINR <= 0 || h.status === 'REDEEMED';
    }
    return true;
  });

  const searchedHoldings = filteredByStatus.filter(h =>
    h.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    h.category_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalValue = searchedHoldings.reduce((sum, h) => sum + h.currentValueINR, 0);

  const activeCount = fixedHoldings.filter(h => h.currentValueINR > 0 && h.status !== 'REDEEMED').length;
  const closedCount = fixedHoldings.filter(h => h.currentValueINR <= 0 || h.status === 'REDEEMED').length;

  return (
    <AnimatedPage className="space-y-5">
      
      {/* Banner */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-5">
          <div>
            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-blue-500/12 text-blue-400 border border-blue-500/25">
              FIXED INCOME
            </span>
            <h2 className="text-xl font-black text-white flex items-center gap-2 mt-1.5">
              <Landmark className="w-5 h-5 text-blue-400" />
              Fixed Income & Retirement
            </h2>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <span className="text-[10px] font-semibold text-slate-500 uppercase">Total Value</span>
              <div className="text-xl font-black font-mono text-blue-400">{formatMoney(totalValue)}</div>
            </div>
            <motion.button
              onClick={onOpenAddModal}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl text-xs shadow-lg shadow-blue-500/20"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              Add
            </motion.button>
          </div>
        </div>
      </AnimatedItem>

      {/* Filter Tabs */}
      <AnimatedItem>
        <div className="flex items-center gap-2 mb-4">
          <div className="flex bg-slate-800/50 rounded-xl p-1">
            {['Active', 'Closed', 'All'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-xl text-[11px] font-bold transition-all ${
                  activeTab === tab
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
                }`}
              >
                {tab} <span className="ml-1 bg-slate-700/60 px-2 py-0.5 rounded-full">{tab === 'Active' ? activeCount : tab === 'Closed' ? closedCount : fixedHoldings.length}</span>
              </button>
            ))}
          </div>
        </div>
      </AnimatedItem>

      {/* Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {searchedHoldings.map(h => {
          const isClosed = h.currentValueINR <= 0 || h.status === 'REDEEMED';
          return (
            <AnimatedCard 
              key={h.id} 
              onClick={() => onSelectHolding?.(h)}
              className={`glass-card p-5 rounded-3xl border border-slate-800 flex flex-col justify-between cursor-pointer transition-all ${
                isClosed ? 'opacity-60 grayscale' : ''
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                    {h.category_name}
                  </span>
                  {isClosed && (
                    <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded bg-rose-500/20 text-rose-400">
                      Closed
                    </span>
                  )}
                  <span className="text-[10px] text-emerald-400 font-bold font-mono">
                    {h.category_id === 'epf' ? '8.25% p.a.' : (h.category_id === 'bank' ? '7.25% p.a.' : 'Open')}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-white mb-0.5">{h.name}</h3>
                <p className="text-[10px] text-slate-500">{h.sector || 'Fixed Income'}</p>
              </div>

              <div className="pt-4 border-t border-slate-800/80 mt-4 flex items-center justify-between">
                <div>
                  <span className="text-[9px] text-slate-500 font-semibold block mb-0.5">BALANCE</span>
                  <span className={`text-lg font-black font-mono ${isClosed ? 'text-slate-400' : 'text-slate-100'}`}>{formatMoney(h.currentValueINR)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={(e) => { e.stopPropagation(); onDeleteHolding(h.id); }} className="p-1.5 hover:bg-rose-500/20 text-slate-500 hover:text-rose-400 rounded-xl" title="Delete Position">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </AnimatedCard>
          );
        })}
      </div>

    </AnimatedPage>
  );
}
