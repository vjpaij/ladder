import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Layers, Target, ShieldCheck, TrendingUp, Calendar,
  CheckCircle2, Clock, AlertTriangle, ChevronRight, DollarSign
} from 'lucide-react';

const STATUS_STYLES = {
  READY: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  ARMED: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  CONTINGENT: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  PENDING: 'bg-slate-500/20 text-slate-400 border-slate-600',
};

const TRANCHE_COLORS = ['from-emerald-500 to-teal-400', 'from-amber-500 to-orange-400', 'from-purple-500 to-violet-400'];

function TrancheCard({ tranche, index }) {
  const gradColor = TRANCHE_COLORS[index % TRANCHE_COLORS.length];
  const statusStyle = STATUS_STYLES[tranche.status] || STATUS_STYLES.PENDING;

  return (
    <div className="reports-subcard border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border-subtle)' }}>
      {/* Tranche header */}
      <div className={`bg-gradient-to-r ${gradColor} p-3 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-white text-xs font-black">
            {tranche.tranche}
          </div>
          <span className="text-white font-bold text-sm">{tranche.label}</span>
        </div>
        <div className="text-right">
          <div className="text-white font-black text-lg font-mono">₹{tranche.amount?.toLocaleString('en-IN')}</div>
          {tranche.estimatedShares && (
            <div className="text-white/70 text-xs">~{tranche.estimatedShares} shares @ ₹{tranche.estimatedAvgPrice?.toFixed(0)}</div>
          )}
        </div>
      </div>

      {/* Tranche details */}
      <div className="p-3 space-y-2">
        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Status</span>
          <span className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${statusStyle}`}>{tranche.status}</span>
        </div>

        {/* Trigger */}
        <div>
          <span className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Trigger</span>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>{tranche.triggerDescription}</p>
        </div>

        {/* Price Range */}
        {tranche.triggerPriceRange && (
          <div className="flex items-center justify-between bg-slate-800/60 rounded-lg px-2.5 py-1.5">
            <span className="text-[10px] text-slate-500">Target Price Range</span>
            <span className="text-xs font-mono font-bold text-amber-400">
              {tranche.triggerPriceRange.low !== null ? `₹${tranche.triggerPriceRange.low?.toLocaleString('en-IN')}` : ''}
              {tranche.triggerPriceRange.high !== null ? ` – ₹${tranche.triggerPriceRange.high?.toLocaleString('en-IN')}` : '+'}
            </span>
          </div>
        )}

        {/* Rationale */}
        <div>
          <span className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Rationale</span>
          <p className="text-[10px] text-slate-400 leading-relaxed">{tranche.rationale}</p>
        </div>

        {/* Entry Conditions */}
        {tranche.conditions?.length > 0 && (
          <div>
            <span className="text-[10px] text-slate-500 uppercase tracking-wide block mb-1">Conditions Before Buying</span>
            <ul className="space-y-1">
              {tranche.conditions.map((c, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[10px] text-slate-400">
                  <ChevronRight className="w-2.5 h-2.5 text-slate-600 mt-0.5 shrink-0" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SipPlanModal({ analysis, onClose }) {
  const [budgetInput, setBudgetInput] = useState('');
  const [maxLossInput, setMaxLossInput] = useState('');
  const budget = Number(budgetInput);
  const maxLoss = Number(maxLossInput);
  const sipPlan = analysis?.sipPlan;
  const entry = Number(analysis?.currentPrice);
  const stop = Number(sipPlan?.stopLoss);
  const lossFraction = entry > stop && stop > 0 ? (entry - stop) / entry : null;
  const riskBudgetCap = maxLoss > 0 && lossFraction > 0 ? maxLoss / lossFraction : null;
  const effectiveBudget = budget > 0 && riskBudgetCap > 0 ? Math.min(budget, riskBudgetCap) : null;
  const displayTranches = useMemo(() => (sipPlan?.tranches || []).map(tranche => {
    const amount = Number.isFinite(effectiveBudget) && effectiveBudget > 0 ? Math.round(effectiveBudget * tranche.ratio) : null;
    const shares = amount && tranche.estimatedAvgPrice > 0 ? Math.floor(amount / tranche.estimatedAvgPrice) : null;
    return { ...tranche, amount, estimatedShares: shares };
  }), [sipPlan?.tranches, effectiveBudget]);

  if (!analysis || !sipPlan) return null;

  const totalShares = displayTranches
    ?.filter(t => t.estimatedShares)
    .reduce((sum, t) => sum + (t.estimatedShares || 0), 0);

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
        style={{ backgroundColor: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          onClick={e => e.stopPropagation()}
          className="modal-surface reports-card border border-inherit rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-inherit sticky top-0 modal-surface rounded-t-2xl z-10">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-500/20 flex items-center justify-center">
                <Layers className="w-4.5 h-4.5 text-purple-400" style={{ width: '18px', height: '18px' }} />
              </div>
              <div>
                <h2 className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
                  SIP Accumulation Plan
                </h2>
              <p className="text-xs text-slate-400">{analysis.symbol} · {analysis.buySignal?.replace('_', ' ')} · Opportunistic</p>
                <p className="text-[10px] text-slate-500">Review by {new Date(sipPlan.expiresAt).toLocaleDateString('en-IN')}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            <div className="reports-subcard rounded-xl p-3 border" style={{ borderColor: 'var(--border-subtle)' }}>
              <label htmlFor="sip-budget" className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Total budget (optional)</label>
              <input
                id="sip-budget"
                type="number"
                min="1"
                step="1000"
                value={budgetInput}
                onChange={event => setBudgetInput(event.target.value)}
                placeholder="Enter an amount to estimate tranche sizes"
                className="w-full reports-subcard border rounded-lg px-3 py-2 text-sm"
                style={{ color: 'var(--text-primary)', borderColor: 'var(--border-subtle)' }}
              />
              <label htmlFor="sip-max-loss" className="block text-xs font-semibold mt-3 mb-2" style={{ color: 'var(--text-primary)' }}>Maximum acceptable loss for this position (optional)</label>
              <input
                id="sip-max-loss"
                type="number"
                min="1"
                step="500"
                value={maxLossInput}
                onChange={event => setMaxLossInput(event.target.value)}
                placeholder="Enter a rupee risk limit"
                className="w-full reports-subcard border rounded-lg px-3 py-2 text-sm"
                style={{ color: 'var(--text-primary)', borderColor: 'var(--border-subtle)' }}
              />
              {budget > 0 && maxLoss > 0 && (
                <p className="text-[10px] text-slate-500 mt-2">Risk-based budget cap: {riskBudgetCap ? `₹${riskBudgetCap.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : 'unavailable because no verified stop distance is available'}.</p>
              )}
              <p className="text-[10px] text-slate-500 mt-1">Use the lower of your budget and this risk cap. Check portfolio concentration and liquidity separately; gaps can exceed the indicated loss.</p>
            </div>
            {/* Key Metrics Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Risk-Capped Budget', value: effectiveBudget ? `₹${effectiveBudget.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : 'Not set', color: 'text-purple-400', icon: DollarSign },
                { label: 'Est. Total Shares', value: totalShares ? `~${totalShares}` : '—', color: 'text-cyan-400', icon: TrendingUp },
                { label: 'Stop Loss', value: sipPlan.stopLoss ? `₹${sipPlan.stopLoss?.toLocaleString('en-IN')}` : '—', color: 'text-red-400', icon: ShieldCheck },
                { label: 'Exit Target', value: sipPlan.exitTarget ? `₹${sipPlan.exitTarget?.toLocaleString('en-IN')}` : '—', color: 'text-emerald-400', icon: Target },
              ].map(item => (
                <div key={item.label} className="reports-subcard rounded-xl p-3 text-center border" style={{ borderColor: 'var(--border-subtle)' }}>
                  <item.icon className={`w-4 h-4 mx-auto mb-1.5 ${item.color}`} />
                  <div className={`font-bold text-base font-mono ${item.color}`}>{item.value}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{item.label}</div>
                </div>
              ))}
            </div>

            {/* R:R and Commentary */}
            <div className="reports-subcard rounded-xl p-3 border" style={{ borderColor: 'var(--border-subtle)' }}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Risk:Reward</span>
                  <div className={`text-lg font-black font-mono mt-0.5 ${sipPlan.riskRewardRatio >= 2.5 ? 'text-emerald-400' : sipPlan.riskRewardRatio >= 2 ? 'text-cyan-400' : 'text-amber-400'}`}>
                    {sipPlan.riskRewardRatio ? `${sipPlan.riskRewardRatio}:1` : 'N/A'}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">Plan Type</span>
                  <div className="text-xs font-semibold text-purple-400 mt-0.5">Opportunistic (Event-Triggered)</div>
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">{sipPlan.scoreCommentary}</p>
            </div>

            {/* Earnings Warning */}
            {sipPlan.earningsNote && (
              <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-300 leading-relaxed">{sipPlan.earningsNote}</p>
              </div>
            )}

            {/* Tranches */}
            <div>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> Accumulation Tranches
              </h3>
              <div className="space-y-3">
                {displayTranches.map((tranche, i) => (
                  <TrancheCard key={tranche.tranche} tranche={tranche} index={i} />
                ))}
              </div>
            </div>

            {/* Notes */}
            {sipPlan.notes?.length > 0 && (
              <div className="reports-subcard rounded-xl p-3 border" style={{ borderColor: 'var(--border-subtle)' }}>
                <h4 className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Important Notes</h4>
                <ul className="space-y-1.5">
                  {sipPlan.notes.map((note, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-slate-500 mt-0.5 shrink-0" />
                      <span className="text-xs text-slate-400 leading-relaxed">{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Philosophy footer */}
            <div className="text-center pt-2 border-t border-slate-800/50">
              <p className="text-[10px] text-slate-600 italic">
                Tranches are triggered by price events (pullbacks, breakouts), not calendar dates.
                Never deploy all tranches on the same day. Always verify fundamentals before Tranche 3.
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
