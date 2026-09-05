import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Building2, ShieldCheck, TrendingUp, ChevronRight, 
  Calendar, Award, Plus
} from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';

function fmtINR(val) {
  const n = Number(val) || 0;
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dStr) {
  if (!dStr) return '—';
  const parts = dStr.split('T')[0].split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }
  return dStr;
}

export default function EpfView({ holdings, onSelectHolding, onOpenAddModal }) {
  const { formatMoney } = useThemeAuth();
  const [detailData, setDetailData] = useState(null);

  // Find EPF holding
  const epfHolding = holdings.find(h => h.category_id === 'epf' || h.symbol === 'EPF-RETIREMENT') || {
    id: '',
    name: 'Employees Provident Fund (EPF)',
    symbol: 'EPF-RETIREMENT',
    category_id: 'epf',
    quantity: 0,
    current_price: 0,
    avg_buy_price: 0,
    currency: 'INR'
  };

  const currentVal = Number(epfHolding.current_price) || 0;
  const annualInterestRate = 8.25;
  const estAnnualInterest = (currentVal * annualInterestRate) / 100;

  useEffect(() => {
    let isMounted = true;
    async function loadDetail() {
      try {
        const res = await fetch(`/api/holding/${encodeURIComponent(epfHolding.id)}/detail`);
        if (res.ok) {
          const json = await res.json();
          if (isMounted) setDetailData(json);
        }
      } catch (err) {
        console.error('[EpfView] Error fetching detail:', err);
      }
    }
    loadDetail();
    return () => { isMounted = false; };
  }, [epfHolding.id]);

  const metrics = detailData?.metricsINR || detailData?.metrics || {};
  const oneYearDelta = metrics.oneYearDelta !== undefined ? metrics.oneYearDelta : 0;
  const oneYearPct = metrics.oneYearPct !== undefined ? metrics.oneYearPct : 0;
  
  // Find latest credit transaction
  const latestTx = detailData?.transactions && detailData.transactions.length > 0 
    ? detailData.transactions[0] 
    : null;

  return (
    <AnimatedPage className="space-y-6">
      
      {/* Top Hero Banner */}
      <AnimatedItem>
        <div className="relative overflow-hidden rounded-3xl glass-card p-6 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xl backdrop-blur-2xl">
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                Statutory Retirement Fund (EPFO)
              </span>
            </div>
            <h2 className="text-2xl md:text-3xl font-black text-slate-100 flex items-center gap-3">
              <Building2 className="w-7 h-7 text-indigo-500" />
              Employee Provident Fund
            </h2>
          </div>

          <div className="flex items-center gap-4 relative z-10 shrink-0 flex-wrap md:flex-nowrap">
            <div className="text-right">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                Current EPF Accumulation
              </span>
              <div className="text-2xl font-black font-mono bg-gradient-to-r from-indigo-400 via-purple-300 to-amber-300 bg-clip-text text-transparent">
                {formatMoney(currentVal)}
              </div>
              <div className="text-[10px] text-indigo-400 font-bold font-mono mt-0.5">
                Yield: {annualInterestRate}% p.a. (~{fmtINR(estAnnualInterest)}/yr)
              </div>
            </div>

            {onOpenAddModal && (
              <motion.button
                onClick={onOpenAddModal}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                className="flex items-center gap-1.5 px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold rounded-2xl text-xs cursor-pointer"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                Add Entry
              </motion.button>
            )}
          </div>

          {/* Background glowing orb */}
          <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        </div>
      </AnimatedItem>

      {/* Dynamic Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <AnimatedCard>
          <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">1-Year Growth</span>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xl font-black font-mono text-emerald-400 mb-1">
              +{fmtINR(oneYearDelta)}
            </div>
            <div className="text-[10px] text-emerald-400/90 font-mono font-bold">
              +{Number(oneYearPct).toFixed(2)}% in 12M
            </div>
          </div>
        </AnimatedCard>

        <AnimatedCard>
          <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">Est. Annual Yield</span>
              <Award className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-xl font-black font-mono text-amber-400 mb-1">
              +{fmtINR(estAnnualInterest)}
            </div>
            <div className="text-[10px] text-slate-400 font-mono font-semibold">
              {annualInterestRate}% p.a.
            </div>
          </div>
        </AnimatedCard>

        <AnimatedCard>
          <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">Last Credit</span>
              <Calendar className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-xl font-black font-mono text-slate-100 mb-1">
              {latestTx?.total_amount ? `+${fmtINR(latestTx.total_amount)}` : '—'}
            </div>
            <div className="text-[10px] text-slate-400 font-mono font-semibold">
              {formatDate(latestTx?.date)}
            </div>
          </div>
        </AnimatedCard>
      </div>

      {/* Main EPF Detail Card & Actions */}
      <AnimatedItem>
        <div 
          onClick={() => onSelectHolding(epfHolding)}
          className="glass-card p-6 rounded-3xl border border-slate-800/90 hover:border-indigo-500/40 transition-all duration-300 group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <div>
              <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                MEMBER EPF ACCOUNT
              </span>
              <h3 className="text-lg font-bold text-slate-100 group-hover:text-indigo-500 transition-colors mt-2">
                Employee Provident Fund Organisation (EPFO)
              </h3>
            </div>

            <button className="px-4 py-2 rounded-2xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer">
              <span>View</span>
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </AnimatedItem>

    </AnimatedPage>
  );
}
