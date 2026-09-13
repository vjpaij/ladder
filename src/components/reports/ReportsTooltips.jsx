import React from 'react';
import { PALETTE, BENCHMARK_COLORS, BENCHMARK_LABELS } from './reportsConstants';

// Universal Custom Tooltip with Theme Adaptive Styling
export function CustomChartTooltip({ active, payload, formatMoney }) {
  if (active && payload && payload.length) {
    const data = payload[0];
    const name = data.payload?.name || data.payload?.sector || (data.name !== 'value' ? data.name : '') || 'Asset';
    const value = data.value !== undefined ? data.value : data.payload?.value;
    const percentage = data.payload?.percentage;
    const color = data.color || data.payload?.fill || PALETTE[0];

    return (
      <div className="reports-card p-3 rounded-2xl shadow-xl text-xs space-y-1.5 z-50 pointer-events-none min-w-[180px]">
        <p className="font-extrabold flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }}></span>
          <span className="truncate">{name}</span>
        </p>
        <div className="pt-1 text-[11px] font-mono space-y-1 border-t border-inherit opacity-90">
          <p className="flex justify-between gap-4">
            <span className="opacity-70">Value:</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatMoney(value)}</span>
          </p>
          {percentage !== undefined && (
            <p className="flex justify-between gap-4">
              <span className="opacity-70">Allocation:</span>
              <span className="font-bold">{Number(percentage).toFixed(2)}%</span>
            </p>
          )}
        </div>
      </div>
    );
  }
  return null;
}

// Trajectory Benchmark Tooltip
export function TrajectoryTooltip({ active, payload, label, benchmark, formatMoney }) {
  if (active && payload && payload.length) {
    const point = payload[0].payload;
    const portVal = point.Portfolio;
    const portGrowth = point.PortfolioGrowthPct;
    const benchVal = point[`${benchmark}_Normalized`];
    const benchGrowth = point[`${benchmark}_GrowthPct`];
    const alpha = (portGrowth !== undefined && benchGrowth !== undefined) ? Number((portGrowth - benchGrowth).toFixed(2)) : 0;

    return (
      <div className="reports-card p-3.5 rounded-2xl shadow-xl text-xs space-y-2 z-50 pointer-events-none min-w-[220px]">
        <p className="font-mono font-bold opacity-75 text-[11px] border-b border-inherit pb-1 flex items-center justify-between">
          <span>{label}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${alpha >= 0 ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/20 text-rose-600 dark:text-rose-400'}`}>
            Alpha: {alpha >= 0 ? `+${alpha}%` : `${alpha}%`}
          </span>
        </p>
        <div className="space-y-1 font-mono text-[11px]">
          <div className="flex justify-between gap-4">
            <span className="flex items-center gap-1.5 opacity-80">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              Portfolio:
            </span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              {formatMoney(portVal)} ({portGrowth >= 0 ? `+${portGrowth}%` : `${portGrowth}%`})
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="flex items-center gap-1.5 opacity-80">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BENCHMARK_COLORS[benchmark] }}></span>
              {BENCHMARK_LABELS[benchmark]}:
            </span>
            <span className="font-bold" style={{ color: BENCHMARK_COLORS[benchmark] }}>
              {benchVal !== undefined ? `${formatMoney(benchVal)} ` : ''}({benchGrowth >= 0 ? `+${benchGrowth}%` : `${benchGrowth}%`})
            </span>
          </div>
        </div>
      </div>
    );
  }
  return null;
}
