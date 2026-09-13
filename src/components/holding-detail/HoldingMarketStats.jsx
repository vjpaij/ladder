import React from 'react';
import { motion } from 'framer-motion';

export default function HoldingMarketStats({
  isLight,
  isDisplayUSD,
  isFundOrNps,
  detail,
  holding,
  quotePriceVal,
  fmt,
  fmtUSD
}) {
  const fmtStat = (val) => {
    if (isDisplayUSD) return fmtUSD(val);
    if (isFundOrNps) return `₹${Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
    return fmt(val);
  };

  const high52 = Number(detail?.quote?.fiftyTwoWeekHigh || holding.fifty_two_week_high || (quotePriceVal * 1.15));
  const low52 = Number(detail?.quote?.fiftyTwoWeekLow || holding.fifty_two_week_low || (quotePriceVal * 0.85));
  const hasRange = high52 > low52;
  const range = high52 - low52;
  const pos = hasRange ? Math.min(Math.max(((quotePriceVal - low52) / range) * 100, 0), 100) : 50;

  return (
    <motion.div 
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-3.5 rounded-2xl border ${
        isLight 
          ? 'bg-slate-50 border-slate-200/90 shadow-xs' 
          : 'glass-card border-slate-800/80 bg-slate-900/40'
      }`}
    >
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        {/* 4 Key Stat Points */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-6 flex-1 w-full">
          <div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-0.5">Open</span>
            <span className={`text-xs font-mono font-bold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
              {fmtStat(detail?.quote?.open || quotePriceVal)}
            </span>
          </div>
          <div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-0.5">Prev Close</span>
            <span className={`text-xs font-mono font-bold ${isLight ? 'text-slate-800' : 'text-slate-200'}`}>
              {fmtStat(detail?.quote?.previousClose || quotePriceVal)}
            </span>
          </div>
          <div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-0.5">Day High</span>
            <span className="text-xs font-mono font-bold text-emerald-400">
              {fmtStat(detail?.quote?.high || quotePriceVal)}
            </span>
          </div>
          <div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 block mb-0.5">Day Low</span>
            <span className="text-xs font-mono font-bold text-rose-400">
              {fmtStat(detail?.quote?.low || quotePriceVal)}
            </span>
          </div>
        </div>

        {/* 52-Week Range Slider Bar */}
        {hasRange && (
          <div className="w-full lg:w-72 pl-0 lg:pl-4 lg:border-l border-slate-700/40 flex flex-col justify-center">
            <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              <span>52W L: {fmtStat(low52)}</span>
              <span className={`font-black uppercase tracking-widest ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>52W Range</span>
              <span>52W H: {fmtStat(high52)}</span>
            </div>
            <div className="relative w-full h-2 rounded-full bg-slate-800 overflow-visible mt-1">
              <div 
                className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-500 to-emerald-500" 
                style={{ width: '100%' }}
              />
              <motion.div 
                className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 shadow-md ${
                  isLight ? 'bg-slate-900 border-white' : 'bg-white border-slate-950'
                }`}
                style={{ left: `${pos}%` }}
                animate={{ scale: [1, 1.25, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                title={`Current: ${fmtStat(quotePriceVal)} (${pos.toFixed(0)}% of 52W range)`}
              />
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
