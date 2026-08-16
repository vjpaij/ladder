import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
import { PieChart, Filter } from 'lucide-react';
import { AnimatedPage, AnimatedItem } from '../components/AnimatedPage';

const COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#06B6D4', '#64748B', '#EF4444'];
const MARKET_CAP_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#64748B', '#EF4444', '#94A3B8']; // Mega, Large, Mid, Small, Micro, Unknown

export default function ReportsView({ summary, holdings }) {
  const { formatMoney } = useThemeAuth();
  
  // Tab states
  const [activeTab, setActiveTab] = useState('EQUITY'); // CONSOLIDATED, EQUITY, FIXED_INCOME, NPS
  
  // View states within tabs
  const [reportType, setReportType] = useState('MARKET_CAP'); // ALLOCATION, SECTOR, MARKET_CAP, TRAJECTORY
  
  // Equity Hub Filters
  const [equityOptions, setEquityOptions] = useState({
    india: true,
    us: true,
    mf: true
  });
  
  const [benchmark, setBenchmark] = useState('NIFTY_50');

  if (!summary || !holdings) return null;

  // Filter Holdings based on Active Tab and Equity Options
  const filteredHoldings = useMemo(() => {
    return holdings.filter(h => {
      // Ignore closed positions
      if (Number(h.quantity) <= 0) return false;
      
      const cat = h.category_id;
      
      if (activeTab === 'CONSOLIDATED') return true;
      if (activeTab === 'EQUITY') {
        if (cat === 'in_stocks' && equityOptions.india) return true;
        if (cat === 'us_stocks' && equityOptions.us) return true;
        if (cat === 'mutual_funds' && equityOptions.mf) return true;
        return false;
      }
      if (activeTab === 'FIXED_INCOME') {
        return cat === 'bank' || cat === 'epf' || cat === 'loans';
      }
      if (activeTab === 'NPS') {
        return cat === 'nps';
      }
      return false;
    });
  }, [holdings, activeTab, equityOptions]);

  // Asset Allocation Data
  const allocationData = useMemo(() => {
    if (activeTab === 'CONSOLIDATED') return summary.assetAllocation || [];
    
    // For specific views, group by holding name
    const map = {};
    filteredHoldings.forEach(h => {
      const name = h.name || h.symbol;
      if (!map[name]) map[name] = 0;
      map[name] += h.currentValueINR || 0;
    });
    const total = Object.values(map).reduce((sum, v) => sum + v, 0);
    return Object.keys(map).map(k => ({
      name: k,
      value: Math.round(map[k]),
      percentage: total > 0 ? Number(((map[k] / total) * 100).toFixed(1)) : 0
    })).sort((a,b) => b.value - a.value).slice(0, 10);
  }, [summary, filteredHoldings, activeTab]);

  // Sector Data (Equity Only)
  const sectorData = useMemo(() => {
    const map = {};
    filteredHoldings.forEach(h => {
      const s = h.sector || 'Other';
      if (!map[s]) map[s] = 0;
      map[s] += h.currentValueINR || 0;
    });
    return Object.keys(map).map(s => ({ sector: s, value: Math.round(map[s]) })).sort((a, b) => b.value - a.value);
  }, [filteredHoldings]);

  // Market Cap Data (Equity Only)
  const marketCapData = useMemo(() => {
    const map = { 'Mega Cap': 0, 'Large Cap': 0, 'Mid Cap': 0, 'Small Cap': 0, 'Micro Cap': 0, 'Unknown': 0 };
    filteredHoldings.forEach(h => {
      let mc = h.market_cap;
      if (!mc) mc = 'Unknown';
      if (map[mc] !== undefined) map[mc] += h.currentValueINR || 0;
      else map['Unknown'] += h.currentValueINR || 0;
    });
    const total = Object.values(map).reduce((sum, v) => sum + v, 0);
    return Object.keys(map)
      .filter(k => map[k] > 0)
      .map(k => ({
        name: k,
        value: Math.round(map[k]),
        percentage: total > 0 ? Number(((map[k] / total) * 100).toFixed(1)) : 0
      }));
  }, [filteredHoldings]);

  // Trajectory Benchmark Data
  const trajectoryData = useMemo(() => {
    const baseTraj = [
      { date: 'Jan \'24', Portfolio: 11200000, NIFTY_50: 11200000, NIFTY_MIDCAP_150: 11000000, NIFTY_250: 11100000, SP_500: 10500000, NASDAQ: 10000000 },
      { date: 'Mar \'24', Portfolio: 11800000, NIFTY_50: 11500000, NIFTY_MIDCAP_150: 11300000, NIFTY_250: 11400000, SP_500: 11100000, NASDAQ: 10800000 },
      { date: 'Jun \'24', Portfolio: 12600000, NIFTY_50: 12100000, NIFTY_MIDCAP_150: 11900000, NIFTY_250: 12000000, SP_500: 11800000, NASDAQ: 11500000 },
      { date: 'Sep \'24', Portfolio: 13400000, NIFTY_50: 12700000, NIFTY_MIDCAP_150: 12500000, NIFTY_250: 12600000, SP_500: 12200000, NASDAQ: 12000000 },
      { date: 'Dec \'24', Portfolio: 14200000, NIFTY_50: 13200000, NIFTY_MIDCAP_150: 13000000, NIFTY_250: 13100000, SP_500: 12700000, NASDAQ: 12500000 },
      { date: 'Now', Portfolio: summary.netWorthINR, NIFTY_50: 13600000, NIFTY_MIDCAP_150: 13500000, NIFTY_250: 13550000, SP_500: 13200000, NASDAQ: 13000000 },
    ];
    return baseTraj.map(d => ({
      date: d.date,
      Portfolio: d.Portfolio,
      Benchmark: d[benchmark] || d.NIFTY_50
    }));
  }, [summary.netWorthINR, benchmark]);

  const toggleEquityOption = (key) => {
    setEquityOptions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    // Reset view if invalid for new tab
    if (tab !== 'EQUITY' && (reportType === 'MARKET_CAP' || reportType === 'SECTOR')) {
      setReportType('ALLOCATION');
    }
  };

  return (
    <AnimatedPage className="space-y-5">
      
      {/* Header and Master Tabs */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col gap-5">
          
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <PieChart className="w-5 h-5 text-emerald-400" />
                Reports
              </h3>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {[
                { key: 'CONSOLIDATED', label: 'Consolidated' },
                { key: 'EQUITY', label: 'Equity Hub' },
                { key: 'FIXED_INCOME', label: 'Fixed Income' },
                { key: 'NPS', label: 'NPS' }
              ].map(t => (
                <button
                  key={t.key}
                  onClick={() => handleTabChange(t.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                    activeTab === t.key 
                      ? 'bg-blue-600/20 text-blue-400 border-blue-500/50 shadow-md shadow-blue-500/10' 
                      : 'bg-slate-900/50 text-slate-400 border-slate-700/50 hover:text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sub-options for Equity Hub */}
          <AnimatePresence>
            {activeTab === 'EQUITY' && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-4 pt-4 border-t border-slate-800/50 overflow-hidden"
              >
                <div className="text-xs font-bold text-slate-500 flex items-center gap-1">
                  <Filter className="w-3 h-3" /> Filters:
                </div>
                
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={equityOptions.india} onChange={() => toggleEquityOption('india')} className="rounded border-slate-600 text-blue-500 focus:ring-blue-500 bg-slate-900" />
                  India Equity
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={equityOptions.us} onChange={() => toggleEquityOption('us')} className="rounded border-slate-600 text-blue-500 focus:ring-blue-500 bg-slate-900" />
                  US Equity
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={equityOptions.mf} onChange={() => toggleEquityOption('mf')} className="rounded border-slate-600 text-blue-500 focus:ring-blue-500 bg-slate-900" />
                  Mutual Funds
                </label>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </AnimatedItem>

      {/* Chart View Controls */}
      <AnimatedItem>
        <div className="flex items-center gap-1.5 bg-slate-900/80 p-1.5 rounded-xl border border-slate-800 w-max">
          {[
            { key: 'ALLOCATION', label: 'Allocation' },
            ...(activeTab === 'EQUITY' ? [
              { key: 'MARKET_CAP', label: 'Market Cap' },
              { key: 'SECTOR', label: 'Sectors' }
            ] : []),
            { key: 'TRAJECTORY', label: 'Growth' },
          ].map(t => (
            <motion.button
              key={t.key}
              onClick={() => setReportType(t.key)}
              whileTap={{ scale: 0.96 }}
              className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                reportType === t.key ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20' : 'text-slate-500 hover:text-white'
              }`}
            >
              {t.label}
            </motion.button>
          ))}
        </div>
      </AnimatedItem>

      {/* Chart Canvas */}
      <AnimatedItem>
        <div className="glass-card p-5 rounded-3xl border border-slate-800 min-h-[450px]">
          
          {reportType === 'ALLOCATION' && (
            <div>
              <h4 className="text-sm font-bold text-slate-300 mb-5 text-center">
                Asset Allocation ({filteredHoldings.length} Assets)
              </h4>
              <div className="h-[380px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie data={allocationData} cx="50%" cy="50%" innerRadius={90} outerRadius={140} paddingAngle={3} dataKey="value"
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

          {reportType === 'SECTOR' && activeTab === 'EQUITY' && (
            <div>
              <h4 className="text-sm font-bold text-slate-300 mb-5 text-center">Sector Distribution</h4>
              {sectorData.length === 0 ? (
                <div className="h-[380px] flex items-center justify-center text-slate-500 text-sm">No sector data for selected filters.</div>
              ) : (
                <div className="h-[380px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sectorData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                      <XAxis dataKey="sector" stroke="#64748B" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" />
                      <YAxis stroke="#64748B" tickFormatter={(v) => `₹${(v/100000).toFixed(1)}L`} />
                      <Tooltip formatter={(val) => formatMoney(val)} contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '12px', color: '#FFF', fontSize: '11px' }} />
                      <Bar dataKey="value" fill="#6366F1" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {reportType === 'MARKET_CAP' && activeTab === 'EQUITY' && (
            <div>
              <h4 className="text-sm font-bold text-slate-300 mb-5 text-center">Market Capitalization</h4>
              {marketCapData.length === 0 ? (
                <div className="h-[380px] flex items-center justify-center text-slate-500 text-sm">No market cap data for selected filters.</div>
              ) : (
                <div className="h-[380px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RePieChart>
                      <Pie data={marketCapData} cx="50%" cy="50%" innerRadius={90} outerRadius={140} paddingAngle={3} dataKey="value"
                        label={({ name, percentage }) => `${name}: ${percentage}%`}>
                        {marketCapData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={MARKET_CAP_COLORS[index % MARKET_CAP_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(val) => formatMoney(val)} contentStyle={{ background: '#0F172A', border: '1px solid #334155', borderRadius: '12px', color: '#FFF', fontSize: '11px' }} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                    </RePieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {reportType === 'TRAJECTORY' && (
            <div>
              <div className="flex items-center justify-between mb-5">
                <div className="flex-1"></div>
                <h4 className="text-sm font-bold text-slate-300 text-center flex-1">Portfolio Growth</h4>
                <div className="flex-1 flex justify-end">
                  <select 
                    value={benchmark}
                    onChange={(e) => setBenchmark(e.target.value)}
                    className="bg-slate-900 border border-slate-700 text-white text-xs rounded-lg px-3 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="NIFTY_50">Nifty 50</option>
                    <option value="NIFTY_MIDCAP_150">Nifty Midcap 150</option>
                    <option value="NIFTY_250">Nifty 250</option>
                    <option value="SP_500">S&P 500</option>
                    <option value="NASDAQ">NASDAQ</option>
                  </select>
                </div>
              </div>
              
              <div className="h-[380px] w-full">
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
                    <Area type="monotone" name="Portfolio Value" dataKey="Portfolio" stroke="#10B981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorPortfolio)" />
                    <Area type="monotone" name={`${benchmark.replace(/_/g, ' ')} Benchmark`} dataKey="Benchmark" stroke="#3B82F6" strokeWidth={1.5} strokeDasharray="5 5" fill="none" />
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
