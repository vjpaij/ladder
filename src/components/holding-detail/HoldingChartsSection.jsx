import React from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line
} from 'recharts';
import ChartRangeSelector from '../ChartRangeSelector';
import formatDateDDMMYYYY from '../../utils/dateFormatter';
import { ChartTooltip, ActualChartTooltip, ActualEventDot, formatAxisValue } from './holdingDetailUtils';

export default function HoldingChartsSection({
  activeTab,
  setActiveTab,
  hasActualChart,
  filteredTimeline,
  setChartRangeFilter,
  chartLineColor,
  isLight,
  isDisplayUSD,
  isFundOrNps,
  chartMinMax
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* Chart Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-900/60 border border-slate-800 rounded-xl">
          <button
            onClick={() => setActiveTab('tracker')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              activeTab === 'tracker' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Tracker Chart
          </button>
          {hasActualChart && (
            <button
              onClick={() => setActiveTab('actual')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                activeTab === 'actual' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Actual Chart
            </button>
          )}
        </div>

        <ChartRangeSelector
          initialRange="ALL"
          onChange={(range) => setChartRangeFilter(range)}
        />
      </div>

      <div className="glass-card rounded-2xl border border-slate-800 p-4">
        <ResponsiveContainer width="100%" height={280}>
          {activeTab === 'tracker' ? (
            <AreaChart data={filteredTimeline} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
              <defs>
                <linearGradient id="hdmGradInv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="hdmGradVal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartLineColor} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={chartLineColor} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#e2e8f0' : '#1e293b'} />
              <XAxis dataKey="label" tickFormatter={formatDateDDMMYYYY} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={30} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => formatAxisValue(v, isDisplayUSD)} width={85} domain={chartMinMax} />
              <Tooltip content={<ChartTooltip isUSD={isDisplayUSD} />} cursor={{ stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' }} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} formatter={val => <span style={{ color: isLight ? '#475569' : '#94a3b8' }}>{val}</span>} />
              <Area type="linear" dataKey="invested" name="Cost Basis" stroke="#6366f1" strokeWidth={2} fill="url(#hdmGradInv)" dot={false} activeDot={{ r: 4, fill: '#6366f1', stroke: '#1e293b' }} />
              <Area type="linear" dataKey="value" name="Market Value" stroke={chartLineColor} strokeWidth={2.5} fill="url(#hdmGradVal)" dot={false} activeDot={{ r: 4, fill: chartLineColor, stroke: '#1e293b' }} />
            </AreaChart>
          ) : (
            <ComposedChart data={filteredTimeline} margin={{ top: 10, right: 10, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#e2e8f0' : '#1e293b'} />
              <XAxis dataKey="label" tickFormatter={formatDateDDMMYYYY} tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={30} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => isDisplayUSD ? `$${Number(v).toFixed(2)}` : isFundOrNps ? `₹${Number(v).toFixed(4)}` : `₹${Number(v).toFixed(2)}`} width={isFundOrNps ? 80 : 65} domain={chartMinMax} />
              <Tooltip content={<ActualChartTooltip isUSD={isDisplayUSD} isFundOrNps={isFundOrNps} timelineData={filteredTimeline} />} cursor={{ stroke: '#334155', strokeWidth: 1, strokeDasharray: '4 4' }} />
              <Line type="linear" dataKey="price" name="Asset Price" stroke={chartLineColor} strokeWidth={2.5} dot={<ActualEventDot />} activeDot={{ r: 5, fill: chartLineColor, stroke: '#ffffff', strokeWidth: 2 }} />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
