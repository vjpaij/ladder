import React from 'react';

export default function OverviewSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading dashboard">
      {/* 1. Hero Net Worth Skeleton Panel */}
      <div className="glass-card rounded-3xl p-6 sm:p-8 relative overflow-hidden gradient-border border border-white/10 dark:border-slate-800/80">
        <div className="space-y-5">
          {/* Label + live indicator dot */}
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/40 animate-ping" />
            <div className="h-3 w-24 bg-slate-700/40 dark:bg-slate-800 rounded-md" />
          </div>

          {/* Large Net Worth Number + Pill */}
          <div className="flex items-baseline gap-4 flex-wrap">
            <div className="h-12 sm:h-14 w-64 sm:w-80 bg-slate-700/50 dark:bg-slate-800/80 rounded-2xl" />
            <div className="h-7 w-28 bg-emerald-500/15 border border-emerald-500/20 rounded-full" />
          </div>

          {/* Metric Selector Pills */}
          <div className="flex items-center gap-3">
            <div className="h-7 w-24 bg-slate-800/80 rounded-full" />
            <div className="h-4 w-32 bg-slate-800/60 rounded" />
          </div>

          {/* Sub-metrics row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-700/20 dark:border-slate-800/80">
            {[1, 2, 3, 4].map(idx => (
              <div key={idx} className="space-y-2">
                <div className="h-2.5 w-16 bg-slate-800/80 rounded" />
                <div className="h-6 w-28 bg-slate-700/40 dark:bg-slate-800 rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Quick KPI Cards Grid Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map(idx => (
          <div
            key={idx}
            className="glass-card rounded-2xl p-5 border border-white/10 dark:border-slate-800/80 space-y-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-3 w-24 bg-slate-800 rounded-md" />
              <div className="w-8 h-8 rounded-xl bg-slate-800/60" />
            </div>
            <div className="h-7 w-32 bg-slate-700/40 dark:bg-slate-800 rounded-lg" />
            <div className="flex items-center justify-between pt-1">
              <div className="h-3 w-16 bg-slate-800/60 rounded" />
              <div className="h-3 w-12 bg-slate-800/60 rounded" />
            </div>
          </div>
        ))}
      </div>

      {/* 3. Middle Visual Analytics Skeleton (Net Worth Trend & Allocation) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trend Chart Placeholder */}
        <div className="lg:col-span-2 glass-card rounded-3xl p-6 border border-white/10 dark:border-slate-800/80 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="h-4 w-36 bg-slate-800 rounded-md" />
            <div className="h-8 w-48 bg-slate-800/60 rounded-xl" />
          </div>
          <div className="h-64 rounded-2xl bg-slate-800/20 dark:bg-slate-900/40 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full border-2 border-slate-700 border-t-emerald-400 animate-spin opacity-30" />
          </div>
        </div>

        {/* Asset Allocation Donut Placeholder */}
        <div className="glass-card rounded-3xl p-6 border border-white/10 dark:border-slate-800/80 space-y-4">
          <div className="h-4 w-32 bg-slate-800 rounded-md" />
          <div className="h-64 rounded-2xl bg-slate-800/20 dark:bg-slate-900/40 flex items-center justify-center">
            <div className="w-36 h-36 rounded-full border-[14px] border-slate-800/70 opacity-40" />
          </div>
        </div>
      </div>

      {/* 4. Asset Class Performance Table Skeleton */}
      <div className="glass-card rounded-3xl p-6 border border-white/10 dark:border-slate-800/80 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
          <div className="h-4 w-44 bg-slate-800 rounded-md" />
          <div className="h-8 w-40 bg-slate-800/60 rounded-xl" />
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(idx => (
            <div
              key={idx}
              className="h-12 rounded-xl bg-slate-800/25 dark:bg-slate-900/40 flex items-center justify-between px-4"
            >
              <div className="h-3.5 w-32 bg-slate-700/40 dark:bg-slate-800 rounded" />
              <div className="h-3.5 w-24 bg-slate-800/60 rounded" />
              <div className="h-3.5 w-24 bg-slate-800/60 rounded hidden sm:block" />
              <div className="h-3.5 w-16 bg-slate-800/60 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
