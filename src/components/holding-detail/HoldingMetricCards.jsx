import React from 'react';
import { Activity, DollarSign, ArrowUpCircle, ArrowDownCircle, TrendingUp, Calendar } from 'lucide-react';
import { MetricCard, formatTxDate } from './holdingDetailUtils';

export default function HoldingMetricCards({
  isEodAsset,
  displayCurrency,
  m,
  fmt,
  fmtINR,
  fmtUSD,
  isLight,
  isUSStock,
  isDisplayUSD,
  holding,
  fxRate
}) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3 flex items-center gap-2">
        <Activity className="w-3.5 h-3.5" /> Performance Summary ({displayCurrency})
      </p>

      {isEodAsset ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          <MetricCard label="Current Balance" value={fmt(m.currentValue)} icon={DollarSign} color="text-white" />
          <MetricCard label="Peak Historical" value={fmt(m.peakValue || m.currentValue)} icon={ArrowUpCircle} color="text-emerald-400" />
          <MetricCard label="Min Historical" value={fmt(m.minValue || m.totalInvested)} icon={ArrowDownCircle} color="text-slate-400" />
          <MetricCard 
            label="1-Year Change" 
            value={fmt(m.oneYearDelta || 0)} 
            sub={`${(m.oneYearPct || 0) >= 0 ? '+' : ''}${m.oneYearPct || 0}%`} 
            icon={TrendingUp} 
            positive={(m.oneYearDelta || 0) >= 0} 
          />
          <MetricCard label="Inception Date" value={formatTxDate(m.startDate || '2007-09-27')} icon={Calendar} color="text-indigo-400" />
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {/* ---- Row 1: P&L Hero + Key Values ---- */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5">
            {/* P&L Hero Card - spans 5 cols */}
            {(() => {
              const totalPnl = (m.unrealizedPnl || 0) + (m.realizedPnl || 0);
              const isPositive = totalPnl >= 0;

              const cardBorder = isLight
                ? (isPositive ? 'border-emerald-300/80 shadow-xs' : 'border-rose-300/80 shadow-xs')
                : (isPositive ? 'border-emerald-500/20' : 'border-rose-500/20');

              const gradientBg = isLight
                ? (isPositive 
                    ? 'bg-gradient-to-br from-emerald-50/90 via-emerald-100/30 to-white' 
                    : 'bg-gradient-to-br from-rose-50/90 via-rose-100/30 to-white')
                : (isPositive 
                    ? 'bg-gradient-to-br from-emerald-950/40 via-slate-900/80 to-slate-950' 
                    : 'bg-gradient-to-br from-rose-950/40 via-slate-900/80 to-slate-950');

              const mainPnlColor = isPositive 
                ? (isLight ? 'text-emerald-700' : 'text-emerald-400')
                : (isLight ? 'text-rose-700' : 'text-rose-400');

              const unrealizedColor = (m.unrealizedPnl || 0) >= 0
                ? (isLight ? 'text-emerald-700' : 'text-emerald-400/90')
                : (isLight ? 'text-rose-700' : 'text-rose-400/90');

              const realizedColor = (m.realizedPnl || 0) >= 0
                ? (isLight ? 'text-emerald-700' : 'text-emerald-400/90')
                : (isLight ? 'text-rose-700' : 'text-rose-400/90');

              const dividerBg = isLight
                ? (isPositive ? 'bg-emerald-200' : 'bg-rose-200')
                : (isPositive ? 'bg-emerald-500/20' : 'bg-rose-500/20');

              return (
                <div className={`lg:col-span-5 relative rounded-xl overflow-hidden border ${cardBorder}`}>
                  <div className={`absolute inset-0 ${gradientBg}`} />
                  <div className={`absolute top-0 left-0 w-32 h-32 rounded-full blur-3xl ${isLight ? 'opacity-30' : 'opacity-20'} ${isPositive ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  <div className="relative p-4 flex flex-col gap-2">
                    <span className={`text-[10px] font-semibold uppercase tracking-widest ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>Total P&L</span>
                    <div className={`text-2xl font-black font-mono ${mainPnlColor}`}>
                      {fmt(totalPnl)}
                    </div>
                    <div className="flex items-center gap-4 mt-1">
                      <div className="flex flex-col">
                        <span className="text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">Unrealized</span>
                        <span className={`text-[13px] font-bold font-mono ${unrealizedColor}`}>
                          {fmt(m.unrealizedPnl)}
                          {m.unrealizedPct != null && <span className="text-[10px] ml-1 opacity-80">({m.unrealizedPct >= 0 ? '+' : ''}{m.unrealizedPct}%)</span>}
                        </span>
                      </div>
                      <div className={`w-px h-8 ${dividerBg}`} />
                      <div className="flex flex-col">
                        <span className="text-[8px] uppercase tracking-wider text-slate-500 mb-0.5">Realized</span>
                        <span className={`text-[13px] font-bold font-mono ${realizedColor}`}>
                          {fmt(m.realizedPnl)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Right side - 7 cols with key metrics */}
            <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <MetricCard label="Total Bought" value={fmt(m.totalInvested)} accent="bg-blue-500" color={isLight ? "text-slate-800" : "text-slate-200"} />
              <MetricCard label="Total Sold" value={fmt(m.totalRedeemed)} accent="bg-indigo-500" color={isLight ? "text-slate-800" : "text-slate-200"} />
              <MetricCard
                label="Current Cost"
                value={(Number(holding.quantity) || 0) > 0 ? fmt(m.currentInvested) : '—'}
                accent="bg-cyan-500"
                color={isLight ? "text-slate-800" : "text-slate-300"}
              />
              <MetricCard
                label="Current Value"
                value={(Number(holding.quantity) || 0) > 0 ? fmt(m.currentValue) : '—'}
                sub={isUSStock && (Number(holding.quantity) || 0) > 0
                  ? (isDisplayUSD ? `≈ ${fmtINR((m.currentValue || 0) * fxRate)}` : `≈ ${fmtUSD(Number(m.currentValue || 0) / fxRate)}`)
                  : null}
                accent={isLight ? "bg-slate-800" : "bg-white"}
                color={isLight ? "text-slate-900" : "text-white"}
              />
            </div>
          </div>

          {/* ---- Row 2: Secondary Metrics ---- */}
          <div className="grid grid-cols-3 gap-2.5">
            <MetricCard
              label="Dividends"
              value={fmt(m.totalDividends)}
              sub={m.dividendCount > 0 ? `${m.dividendCount} payments` : null}
              accent="bg-amber-500"
              color="text-amber-400"
            />
            <MetricCard
              label="Charges"
              value={fmt(m.totalCharges)}
              sub={
                <div className="flex items-center gap-2">
                  <span className="text-[8.5px] font-medium text-slate-500">B {fmt(m.buyCharges)}</span>
                  <span className="text-slate-700/50">|</span>
                  <span className="text-[8.5px] font-medium text-slate-500">S {fmt(m.sellCharges)}</span>
                </div>
              }
              accent="bg-orange-500"
              color="text-amber-500"
            />
            <MetricCard
              label="XIRR"
              value={`${(m.totalXirr || 0) >= 0 ? '+' : ''}${m.totalXirr || 0}%`}
              positive={(m.totalXirr || 0) >= 0}
            />
          </div>
        </div>
      )}
    </div>
  );
}
