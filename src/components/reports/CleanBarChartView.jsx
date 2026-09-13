import React from 'react';
import {
  ResponsiveContainer,
  BarChart as ReBarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from 'recharts';
import { PALETTE } from './reportsConstants';
import { CustomChartTooltip } from './ReportsTooltips';

// Crisp Institutional Bar Chart View with Clear X-Axis Values
export default function CleanBarChartView({ items, onItemClick, formatMoney }) {
  return (
    <div className="h-[380px] w-full pt-2">
      <ResponsiveContainer width="100%" height="100%">
        <ReBarChart data={items} margin={{ top: 10, right: 15, left: 10, bottom: 45 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#94A3B833" vertical={false} />
          <XAxis 
            dataKey="name" 
            stroke="#64748B" 
            tick={{ fill: 'currentColor', fontSize: 10, fontWeight: 700 }}
            tickFormatter={(str) => {
              if (!str) return '';
              return str.length > 15 ? `${str.substring(0, 13)}...` : str;
            }}
            interval={0}
            angle={-20}
            textAnchor="end"
            height={55}
          />
          <YAxis 
            stroke="#64748B" 
            tick={{ fill: '#94A3B8', fontSize: 10, fontWeight: 600 }} 
            tickFormatter={(v) => `₹${(v/100000).toFixed(1)}L`} 
          />
          <Tooltip content={<CustomChartTooltip formatMoney={formatMoney} />} />
          <Bar 
            dataKey="value" 
            radius={[8, 8, 0, 0]}
            isAnimationActive={false}
            onClick={(entry) => onItemClick && onItemClick(entry)}
          >
            {items.map((entry, index) => (
              <Cell 
                key={`bar-cell-${index}`} 
                fill={entry.color || PALETTE[index % PALETTE.length]} 
                style={{ cursor: 'pointer' }}
              />
            ))}
          </Bar>
        </ReBarChart>
      </ResponsiveContainer>
    </div>
  );
}
