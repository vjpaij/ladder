import React from 'react';
import { motion } from 'framer-motion';
import { 
  Building2, ShieldCheck, TrendingUp, Percent, DollarSign, 
  ChevronRight, Calendar, Award, Lock, Sparkles
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer 
} from 'recharts';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage, AnimatedItem, AnimatedCard } from '../components/AnimatedPage';

function fmtINR(val) {
  const n = Number(val) || 0;
  if (Math.abs(n) >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (Math.abs(n) >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export default function EpfView({ holdings, onSelectHolding, onOpenAddModal }) {
  const { formatMoney } = useThemeAuth();

  // Find EPF holding
  const epfHolding = holdings.find(h => h.category_id === 'epf' || h.symbol === 'EPF-RETIREMENT') || {
    id: '00000000-0000-0000-0000-000000000007',
    name: 'EPF',
    symbol: 'EPF-RETIREMENT',
    category_id: 'epf',
    current_price: 4606949
  };

  const currentVal = Number(epfHolding.current_price) || 4606949;
  const annualInterestRate = 8.25; // EPFO current interest rate
  const estAnnualInterest = Math.round(currentVal * (annualInterestRate / 100));

  return (
    <AnimatedPage className="space-y-6">
      
      {/* Top Hero Banner */}
      <AnimatedItem>
        <div className="glass-card p-6 rounded-3xl border border-slate-800 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 tracking-wider uppercase">
                GOVT RETIREMENT FUND
              </span>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                • EEE Tax Exempt
              </span>
            </div>
            <h2 className="text-2xl font-black text-white flex items-center gap-2.5">
              <ShieldCheck className="w-6 h-6 text-indigo-400" />
              EPF
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Government guaranteed statutory retirement accumulation compounding annually at official EPFO interest rates.
            </p>
          </div>

          <div className="flex items-center gap-5 relative z-10 shrink-0">
            <div className="text-right">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
                Current EPF Accumulation
              </span>
              <div className="text-2xl font-black font-mono bg-gradient-to-r from-indigo-400 via-purple-300 to-amber-300 bg-clip-text text-transparent">
                {formatMoney(currentVal)}
              </div>
              <div className="text-[10px] text-indigo-400 font-bold font-mono mt-0.5">
                Yield: {annualInterestRate}% p.a. (~{fmtINR(estAnnualInterest)}/yr)
              </div>
            </div>

            <motion.button
              onClick={() => onSelectHolding(epfHolding)}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-black rounded-2xl text-xs shadow-lg shadow-indigo-500/25"
            >
              <Sparkles className="w-4 h-4 fill-white" />
              Inspect EPF Timeline
            </motion.button>
          </div>

          {/* Background glowing orb */}
          <div className="absolute -right-10 -bottom-10 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        </div>
      </AnimatedItem>

      {/* Key Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <AnimatedCard>
          <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">Accumulation Balance</span>
              <Building2 className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-xl font-black font-mono text-white mb-1">{formatMoney(currentVal)}</div>
            <div className="text-[10px] text-indigo-400 font-bold">100% Capital Guaranteed</div>
          </div>
        </AnimatedCard>

        <AnimatedCard>
          <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">Interest Rate</span>
              <Percent className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-xl font-black font-mono text-amber-400 mb-1">{annualInterestRate}% p.a.</div>
            <div className="text-[10px] text-slate-500 font-medium">EPFO Official FY25-26 Rate</div>
          </div>
        </AnimatedCard>

        <AnimatedCard>
          <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">Est. Annual Interest</span>
              <Award className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xl font-black font-mono text-emerald-400 mb-1">+{fmtINR(estAnnualInterest)}</div>
            <div className="text-[10px] text-slate-500 font-medium">Credited annually into EPF</div>
          </div>
        </AnimatedCard>

        <AnimatedCard>
          <div className="glass-card p-5 rounded-3xl border border-slate-800 flex flex-col justify-between h-full">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-extrabold uppercase text-slate-500 tracking-wider">Tax Status</span>
              <Lock className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-xl font-black font-mono text-cyan-300 mb-1">EEE Tax Free</div>
            <div className="text-[10px] text-slate-500 font-medium">Exempt-Exempt-Exempt</div>
          </div>
        </AnimatedCard>
      </div>

      {/* Main EPF Detail Card & Actions */}
      <AnimatedItem>
        <div 
          onClick={() => onSelectHolding(epfHolding)}
          className="glass-card p-6 rounded-3xl border border-slate-800/90 hover:border-indigo-500/40 transition-all duration-300 group cursor-pointer space-y-5"
        >
          <div className="flex items-center justify-between">
            <div>
              <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                MEMBER EPF ACCOUNT
              </span>
              <h3 className="text-lg font-bold text-white group-hover:text-indigo-300 transition-colors mt-2">
                Employee Provident Fund Organisation (EPFO)
              </h3>
              <p className="text-xs text-slate-500">Universal Account Number (UAN) • EOD Snapshot Ingested</p>
            </div>

            <button className="px-4 py-2 rounded-2xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-bold transition-all flex items-center gap-1.5">
              <span>View Daily Ledger & Timeline</span>
              <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-slate-800">
            <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Employee Share</span>
              <span className="text-base font-extrabold font-mono text-white">~50% of Corpus</span>
              <span className="text-[10px] text-slate-500 block mt-0.5">Monthly salary deduction</span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Employer Share</span>
              <span className="text-base font-extrabold font-mono text-white">~50% of Corpus</span>
              <span className="text-[10px] text-slate-500 block mt-0.5">Matching employer contribution</span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800/80">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Compounding Frequency</span>
              <span className="text-base font-extrabold font-mono text-amber-400">Annual Compounding</span>
              <span className="text-[10px] text-slate-500 block mt-0.5">Monthly interest calculation</span>
            </div>
          </div>
        </div>
      </AnimatedItem>

    </AnimatedPage>
  );
}
