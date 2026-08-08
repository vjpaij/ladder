import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  ResponsiveContainer, 
  PieChart as RePieChart, 
  Pie, 
  Cell, 
  Tooltip, 
  Legend, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  AreaChart, 
  Area 
} from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { PieChart } from 'lucide-react';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';

const COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#06B6D4', '#64748B', '#EF4444'];

export default function ReportsView({ summary, holdings }) {
  const { formatMoney } = useThemeAuth();
  const [reportType, setReportType] = useState('ALLOCATION');

  if (!summary || !holdings) return null;

  const allocationData = summary.assetAllocation || [];

  const sectorMap = {};
  holdings.forEach(h => {
    const s = h.sector || 'Other';
    if (!sectorMap[s]) sectorMap[s] = 0;
    sectorMap[s] += h.currentValueINR;
  });
  const sectorData = Object.keys(sectorMap).map(s => ({ sector: s, value: Math.round(sectorMap[s]) })).sort((a, b) => b.value - a.value);

  const trajectoryData = [
    { date: 'Jan \'24', Portfolio: 11200000, Benchmark: 11200000 },
    { date: 'Mar \'24', Portfolio: 11800000, Benchmark: 11500000 },
    { date: 'Jun \'24', Portfolio: 12600000, Benchmark: 12100000 },
    { date: 'Sep \'24', Portfolio: 13400000, Benchmark: 12700000 },
    { date: 'Dec \'24', Portfolio: 14200000, Benchmark: 13200000 },
    { date: 'Now', Portfolio: summary.netWorthINR, Benchmark: 13600000 },
  ];

  return (
    <AnimatedPage className="space-y-5">
      
      {/* Header */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <PieChart className="w-5 h-5 text-emerald-400" />
              Reports & Analytics
            </h3>
            <p className="text-[10px] text-slate-500 mt-0.5">Portfolio allocation, sectors & growth</p>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
            {[
              { key: 'ALLOCATION', label: 'Allocation' },
              { key: 'SECTOR', label: 'Sectors' },
              { key: 'TRAJECTORY', label: 'Growth' },
            ].map(t => (
              <motion.button
                key={t.key}
                onClick={() => setReportType(t.key)}
                whileTap={{ scale: 0.96 }}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  reportType === t.key ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20' : 'text-slate-500 hover:text-white'
                }`}
              >
                {t.label}
              </motion.button>
            ))}
          </div>
        </div>
      </AnimatedItem>

      {/* Chart */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 min-h-[400px]">
          
          {reportType === 'ALLOCATION' && (
            <div>
              <h4 className="text-sm font-bold text-slate-300 mb-5 text-center">Asset Allocation</h4>
              <div className="h-[340px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie data={allocationData} cx="50%" cy="50%" innerRadius={80} outerRadius={130} paddingAngle={3} dataKey="value"
                      label={({ name, percentage }) => `${name}: ${percentage}%`}>
                      {allocationData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val) => formatMoney(val)} contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '12px', color: '#FFF', fontSize: '11px' }} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {reportType === 'SECTOR' && (
            <div>
              <h4 className="text-sm font-bold text-slate-300 mb-5 text-center">Sector Distribution</h4>
              <div className="h-[340px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sectorData} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <XAxis dataKey="sector" stroke="#64748B" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" />
                    <YAxis stroke="#64748B" tickFormatter={(v) => `₹${(v/100000).toFixed(1)}L`} />
                    <Tooltip formatter={(val) => formatMoney(val)} contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '12px', color: '#FFF', fontSize: '11px' }} />
                    <Bar dataKey="value" fill="#6366F1" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {reportType === 'TRAJECTORY' && (
            <div>
              <h4 className="text-sm font-bold text-slate-300 mb-5 text-center">Growth vs Nifty 50</h4>
              <div className="h-[340px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trajectoryData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorPortfolio" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.35}/>
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" stroke="#64748B" tick={{ fontSize: 10 }} />
                    <YAxis stroke="#64748B" tickFormatter={(v) => `₹${(v/100000).toFixed(0)}L`} />
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                    <Tooltip formatter={(val) => formatMoney(val)} contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '12px', color: '#FFF', fontSize: '11px' }} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Area type="monotone" dataKey="Portfolio" stroke="#10B981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorPortfolio)" />
                    <Area type="monotone" dataKey="Benchmark" stroke="#3B82F6" strokeWidth={1.5} strokeDasharray="5 5" fill="none" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

        </div>
      </AnimatedItem>

    </AnimatedPage>
  );
}
