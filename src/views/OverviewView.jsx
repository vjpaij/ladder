import React from 'react';
import { motion } from 'framer-motion';
import { 
  TrendingUp, 
  ArrowUpRight, 
  ArrowDownRight, 
  Percent, 
  PieChart as PieIcon
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  Tooltip, 
  Legend, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid 
} from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';
import AnimatedCounter from '../components/AnimatedCounter';

const PIE_COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#06B6D4', '#64748B'];

export default function OverviewView({ summary, holdings, liabilities, onNavigate }) {
  const { formatMoney, fxRate, currency } = useThemeAuth();

  if (!summary) return null;

  const isDayPositive = summary.dayPnlINR >= 0;
  const isGainPositive = summary.totalGainINR >= 0;

  const growthCurve = [
    { date: 'Jan', NetWorth: 11200000, Benchmark: 11200000 },
    { date: 'Mar', NetWorth: 11900000, Benchmark: 11600000 },
    { date: 'Jun', NetWorth: 12800000, Benchmark: 12200000 },
    { date: 'Sep', NetWorth: 13500000, Benchmark: 12900000 },
    { date: 'Dec', NetWorth: 14100000, Benchmark: 13300000 },
    { date: 'Now', NetWorth: summary.netWorthINR, Benchmark: 13600000 },
  ];

  return (
    <AnimatedPage className="space-y-6">
      
      {/* Hero Net Worth Panel */}
      <AnimatedItem>
        <div className="glass-card rounded-3xl p-8 relative overflow-hidden gradient-border">
          
          {/* Animated glow orbs */}
          <motion.div 
            className="absolute -top-24 -right-24 w-72 h-72 bg-emerald-500/8 rounded-full blur-3xl pointer-events-none"
            animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 5, repeat: Infinity }}
          />
          <motion.div 
            className="absolute -bottom-24 -left-24 w-72 h-72 bg-indigo-500/8 rounded-full blur-3xl pointer-events-none"
            animate={{ scale: [1.2, 1, 1.2], opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 6, repeat: Infinity }}
          />

          <div className="relative z-10">
            
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <motion.span 
                  className="w-2 h-2 rounded-full bg-emerald-400"
                  animate={{ scale: [1, 1.4, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
                Net Worth
              </span>
              <div className="px-2.5 py-1 bg-slate-900/80 border border-slate-800 rounded-full text-[10px] font-mono text-slate-400">
                $1 = ₹{fxRate}
              </div>
            </div>

            {/* Big Number */}
            <div className="flex items-baseline gap-4 mb-6 flex-wrap">
              <h2 className="text-4xl sm:text-6xl font-black tracking-tight text-white font-mono">
                <AnimatedCounter 
                  value={summary.netWorthINR} 
                  formatter={(v) => formatMoney(v)}
                  duration={1400}
                />
              </h2>

              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.3, type: 'spring' }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                  isDayPositive ? 'badge-emerald' : 'badge-crimson'
                }`}
              >
                {isDayPositive ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                <span>{isDayPositive ? '+' : ''}{formatMoney(summary.dayPnlINR)}</span>
                <span>({isDayPositive ? '+' : ''}{summary.dayPnlPct}%)</span>
              </motion.div>
            </div>

            {/* Sub-Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-5 border-t border-slate-800/80">
              {[
                { label: 'Total Assets', value: summary.totalAssetsINR, sub: 'Equities, MFs, Bank, NPS & EPF' },
                { label: 'Liabilities', value: summary.totalLiabilitiesINR, sub: 'Loans & credit cards', color: 'text-rose-400' },
                { label: 'Invested', value: summary.totalInvestedINR, sub: 'Cost basis' },
                { label: 'Unrealized P&L', value: summary.totalGainINR, sub: `+${summary.absoluteReturnPct}% ROI`, color: isGainPositive ? 'text-emerald-400' : 'text-rose-400', prefix: isGainPositive ? '+' : '' },
              ].map((m, i) => (
                <motion.div 
                  key={m.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.08 }}
                  className="p-3.5 bg-slate-900/40 rounded-2xl border border-slate-800/60"
                >
                  <p className="text-[10px] text-slate-500 font-semibold mb-1">{m.label}</p>
                  <p className={`text-base font-black font-mono ${m.color || 'text-slate-100'}`}>
                    <AnimatedCounter value={m.value} formatter={(v) => `${m.prefix || ''}${formatMoney(v)}`} />
                  </p>
                  <p className="text-[9px] text-slate-600 mt-0.5">{m.sub}</p>
                </motion.div>
              ))}
            </div>

          </div>
        </div>
      </AnimatedItem>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        
        <AnimatedCard className="glass-card p-5 rounded-3xl border border-slate-800 relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">XIRR</span>
            <motion.div 
              className="w-9 h-9 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400"
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 4, repeat: Infinity }}
            >
              <Percent className="w-4 h-4" />
            </motion.div>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-3xl font-black text-emerald-400 font-mono">
              <AnimatedCounter value={summary.xirrPct} suffix="%" />
            </span>
            <span className="text-[10px] font-bold text-emerald-500/70 uppercase">Annualized</span>
          </div>
          <p className="text-[10px] text-slate-500">Cashflow-weighted return</p>
        </AnimatedCard>

        <AnimatedCard className="glass-card p-5 rounded-3xl border border-slate-800 relative overflow-hidden">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Absolute Return</span>
            <motion.div 
              className="w-9 h-9 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400"
              animate={{ y: [0, -3, 0] }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              <TrendingUp className="w-4 h-4" />
            </motion.div>
          </div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-3xl font-black text-indigo-400 font-mono">
              +<AnimatedCounter value={summary.absoluteReturnPct} suffix="%" />
            </span>
            <span className="text-[10px] font-bold text-indigo-400/70 uppercase">Total ROI</span>
          </div>
          <p className="text-[10px] text-slate-500">Return on invested capital</p>
        </AnimatedCard>

        <AnimatedCard className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">P&L Calendar</span>
              <span className="px-2 py-0.5 text-[9px] font-bold bg-emerald-500/15 text-emerald-400 rounded">HEATMAP</span>
            </div>
            <p className="text-[11px] text-slate-400">View daily gains & losses by date</p>
          </div>
          <motion.button
            onClick={() => onNavigate('calendar')}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="mt-4 w-full py-2.5 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-xl text-xs font-bold text-slate-200 flex items-center justify-center gap-2"
          >
            Open Calendar
            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
          </motion.button>
        </AnimatedCard>

      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Donut */}
        <AnimatedItem className="lg:col-span-5">
          <div className="glass-card p-5 rounded-3xl border border-slate-800">
            <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
              <PieIcon className="w-4 h-4 text-emerald-400" />
              Asset Allocation
            </h3>
            <p className="text-[10px] text-slate-500 mb-5">Distribution across asset classes</p>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={summary.assetAllocation || []}
                    cx="50%"
                    cy="50%"
                    innerRadius={65}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {(summary.assetAllocation || []).map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(val) => formatMoney(val)} 
                    contentStyle={{ background: '#0B0F17', border: '1px solid #1E293B', borderRadius: '12px', color: '#FFF', fontSize: '11px' }} 
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </AnimatedItem>

        {/* Growth Trajectory */}
        <AnimatedItem className="lg:col-span-7">
          <div className="glass-card p-5 rounded-3xl border border-slate-800">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Growth vs Nifty 50
              </h3>
              <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-500">BENCHMARK</span>
            </div>
            <p className="text-[10px] text-slate-500 mb-5">Portfolio value vs index performance</p>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={growthCurve} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="growthGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" stroke="#475569" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#475569" tick={{ fontSize: 10 }} tickFormatter={(v) => `₹${(v/100000).toFixed(0)}L`} />
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                  <Tooltip 
                    formatter={(val) => formatMoney(val)} 
                    contentStyle={{ background: '#0B0F17', border: '1px solid #1E293B', borderRadius: '12px', color: '#FFF', fontSize: '11px' }} 
                  />
                  <Area type="monotone" dataKey="NetWorth" stroke="#10B981" strokeWidth={2.5} fillOpacity={1} fill="url(#growthGrad)" />
                  <Area type="monotone" dataKey="Benchmark" stroke="#3B82F6" strokeWidth={1.5} strokeDasharray="4 4" fill="none" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </AnimatedItem>

      </div>

    </AnimatedPage>
  );
}
