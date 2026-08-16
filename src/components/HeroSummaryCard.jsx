import React from 'react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  ShieldAlert, 
  Percent, 
  ArrowUpRight, 
  ArrowDownRight,
  Globe,
  Sparkles
} from 'lucide-react';

export default function HeroSummaryCard({ summary }) {
  const { formatMoney, fxRate, currency } = useThemeAuth();

  if (!summary) return null;

  const isDayPositive = summary.dayPnlINR >= 0;
  const isTotalGainPositive = summary.totalGainINR >= 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-8">
      
      {/* Main Net Worth Glass Hero Panel */}
      <div className="lg:col-span-8 glass-panel p-7 rounded-3xl relative overflow-hidden group border border-slate-800/80">
        
        {/* Background glow ambient light */}
        <div className="absolute -top-24 -right-24 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/15 transition-all duration-700 pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col justify-between h-full">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                TOTAL NET WORTH (ASSETS - LIABILITIES)
              </span>

              {/* FX Rate Badge */}
              <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-900/60 border border-slate-800 rounded-full text-xs font-medium text-slate-300">
                <Globe className="w-3.5 h-3.5 text-indigo-400" />
                <span>USD/INR: ₹{fxRate}</span>
              </div>
            </div>

            {/* Net Worth Value */}
            <div className="flex items-baseline gap-4 mb-4 flex-wrap">
              <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white font-mono">
                {formatMoney(summary.netWorthINR)}
              </h2>

              {/* Daily Change Badge */}
              <div className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${
                isDayPositive 
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 glow-emerald' 
                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
              }`}>
                {isDayPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                <span>{isDayPositive ? '+' : ''}{formatMoney(summary.dayPnlINR)}</span>
                <span>({isDayPositive ? '+' : ''}{summary.dayPnlPct}%) TODAY</span>
              </div>
            </div>
          </div>

          {/* Sub Metrics Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6 border-t border-slate-800/60 mt-4">
            
            {/* Total Assets */}
            <div>
              <p className="text-xs text-slate-400 font-medium mb-1">Total Assets</p>
              <p className="text-base font-bold text-slate-100 font-mono">
                {formatMoney(summary.totalAssetsINR)}
              </p>
            </div>

            {/* Total Liabilities */}
            <div>
              <p className="text-xs text-slate-400 font-medium mb-1">Total Liability</p>
              <p className="text-base font-bold text-rose-400 font-mono">
                {formatMoney(summary.totalLiabilitiesINR)}
              </p>
            </div>

            {/* Invested Capital */}
            <div>
              <p className="text-xs text-slate-400 font-medium mb-1">Total Invested</p>
              <p className="text-base font-bold text-slate-300 font-mono">
                {formatMoney(summary.totalInvestedINR)}
              </p>
            </div>

            {/* Total Profit/Loss */}
            <div>
              <p className="text-xs text-slate-400 font-medium mb-1">Overall Gain</p>
              <p className={`text-base font-bold font-mono ${isTotalGainPositive ? 'text-emerald-400' : 'text-rose-400'}`}>
                {isTotalGainPositive ? '+' : ''}{formatMoney(summary.totalGainINR)}
              </p>
            </div>

          </div>
        </div>

      </div>

      {/* Performance & Returns Badges (XIRR & Absolute Return) */}
      <div className="lg:col-span-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-4">
        
        {/* XIRR Card */}
        <div className="glass-panel p-5 rounded-3xl border border-slate-800/80 flex items-center justify-between relative overflow-hidden group">
          <div className="absolute right-0 top-0 bottom-0 w-2 bg-gradient-to-b from-emerald-400 to-teal-600 rounded-r-3xl" />
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
              PORTFOLIO XIRR
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-emerald-400 font-mono">
                {summary.xirrPct}%
              </span>
              <span className="text-xs text-emerald-500 font-semibold">Annualized</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Cashflow-weighted Extended Internal Rate of Return</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Percent className="w-6 h-6 stroke-[2.5]" />
          </div>
        </div>

        {/* Absolute Return Card */}
        <div className="glass-panel p-5 rounded-3xl border border-slate-800/80 flex items-center justify-between relative overflow-hidden group">
          <div className="absolute right-0 top-0 bottom-0 w-2 bg-gradient-to-b from-indigo-400 to-purple-600 rounded-r-3xl" />
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-1">
              ABSOLUTE RETURN
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-indigo-400 font-mono">
                +{summary.absoluteReturnPct}%
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Total ROI on invested capital since inception</p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <TrendingUp className="w-6 h-6 stroke-[2.5]" />
          </div>
        </div>

      </div>

    </div>
  );
}
