import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LayoutDashboard, 
  Calendar, 
  BarChart3, 
  CandlestickChart, 
  Globe, 
  LineChart, 
  Landmark, 
  CreditCard, 
  Coins, 
  Shield,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  PieChart
} from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';

export default function Sidebar({ currentView, setCurrentView, summary, isCollapsed, onToggleCollapse }) {
  const { formatMoney, fxRate } = useThemeAuth();

  const navSections = [
    {
      title: 'EXECUTIVE',
      items: [
        { id: 'overview', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'calendar', label: 'Calendar', icon: Calendar },
        { id: 'reports', label: 'Reports', icon: PieChart },
      ]
    },
    {
      title: 'PORTFOLIOS',
      items: [
        { id: 'indian_stocks', label: 'Indian Equity', icon: CandlestickChart },
        { id: 'us_stocks', label: 'US Equity', icon: Globe },
        { id: 'mutual_funds', label: 'Mutual Funds', icon: LineChart },
        { id: 'nps', label: 'NPS', icon: Shield },
        { id: 'bank', label: 'Bank Accounts', icon: Landmark },
        { id: 'epf', label: 'EPF', icon: Briefcase },
      ]
    },
    {
      title: 'CASHFLOW',
      items: [
        { id: 'liabilities', label: 'Liability', icon: CreditCard },
        { id: 'dividends', label: 'Dividends', icon: Coins },
      ]
    }
  ];

  return (
    <aside className={`glass-card border border-slate-800 rounded-3xl h-full flex flex-col justify-between shrink-0 transition-all duration-300 z-30 overflow-y-auto relative ${isCollapsed ? 'w-20 p-2 items-center' : 'w-64 p-4'}`}>
      
      {/* Collapse Toggle Button */}
      <button 
        onClick={onToggleCollapse}
        className="absolute top-4 right-[-14px] z-50 bg-slate-800 border border-slate-700 text-white rounded-full p-1 shadow-lg hover:bg-slate-700 transition-colors hidden md:block"
        style={{ right: isCollapsed ? 'auto' : '10px', left: isCollapsed ? '50%' : 'auto', transform: isCollapsed ? 'translateX(-50%)' : 'none', top: '10px' }}
      >
        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>

      <div className="w-full flex flex-col items-center">
        {/* Brand */}
        <div 
          onClick={() => setCurrentView('overview')}
          className={`flex items-center gap-3 mb-7 cursor-pointer group w-full ${isCollapsed ? 'justify-center mt-8' : 'px-2'}`}
        >
          <motion.div 
            className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25 relative overflow-hidden shrink-0"
            whileHover={{ scale: 1.1, rotate: 5 }}
            transition={{ type: 'spring', stiffness: 300 }}
          >
            <div className="absolute inset-0 flex items-center justify-center rotate-[35deg] scale-110">
              <div className="absolute flex gap-3">
                <div className="w-1 h-14 bg-white/20 rounded-full" />
                <div className="w-1 h-14 bg-white/20 rounded-full" />
              </div>
              <div className="absolute flex flex-col gap-2">
                <div className="w-5 h-1 bg-white rounded-full shadow-[0_0_8px_rgba(255,255,255,1)]" />
                <div className="w-5 h-1 bg-white/70 rounded-full" />
                <div className="w-5 h-1 bg-white/40 rounded-full" />
                <div className="w-5 h-1 bg-white/20 rounded-full" />
              </div>
            </div>
          </motion.div>
          
          <AnimatePresence>
            {!isCollapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                className="overflow-hidden whitespace-nowrap"
              >
                <h1 className="text-2xl font-black tracking-[0.15em] bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent sidebar-brand-title drop-shadow-sm">
                  LADDER
                </h1>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Nav Sections */}
        <div className="space-y-5 w-full">
          {navSections.map((section) => (
            <div key={section.title} className="w-full">
              {!isCollapsed ? (
                <h3 className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-slate-600 px-3 mb-1.5 whitespace-nowrap">
                  {section.title}
                </h3>
              ) : (
                <div className="w-full h-px bg-slate-800/60 my-2" />
              )}
              <nav className="space-y-1 w-full">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentView === item.id;

                  return (
                    <motion.button
                      key={item.id}
                      onClick={() => setCurrentView(item.id)}
                      whileHover={!isCollapsed ? { x: 3 } : { scale: 1.1 }}
                      whileTap={{ scale: 0.98 }}
                      title={isCollapsed ? item.label : undefined}
                      transition={{ duration: 0.15 }}
                      className={`w-full flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'justify-between px-3 py-2'} rounded-xl text-[13px] font-semibold transition-all group cursor-pointer ${
                        isActive
                          ? 'nav-item-active font-bold border'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                      }`}
                    >
                      <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5'}`}>
                        <Icon className={`w-4 h-4 transition-colors ${
                          isActive ? 'active-icon' : 'text-slate-500 group-hover:text-slate-300'
                        }`} />
                        {!isCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
                      </div>
                    </motion.button>
                  );
                })}
              </nav>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Net Worth Ticker */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-6 pt-3 border-t border-slate-800/80 px-1 overflow-hidden"
          >
            <motion.div 
              className="glass-subcard p-3 rounded-2xl relative overflow-hidden"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  NET WORTH
                </span>
                <span className="text-[9px] font-mono text-indigo-400 whitespace-nowrap ml-2">
                  $1 = ₹{fxRate}
                </span>
              </div>

              <div className="text-sm font-extrabold font-mono text-white truncate">
                {summary ? formatMoney(summary.netWorthINR) : '₹...'}
              </div>

              <div className="flex items-center justify-between text-[9px] font-medium text-slate-500 mt-1 pt-1 border-t border-slate-800/50">
                <span className="whitespace-nowrap">XIRR <strong className="text-emerald-400 font-mono">{summary ? summary.xirrPct : 0}%</strong></span>
                <span className="whitespace-nowrap ml-2">ROI <strong className="text-indigo-400 font-mono">+{summary ? summary.absoluteReturnPct : 0}%</strong></span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </aside>
  );
}
