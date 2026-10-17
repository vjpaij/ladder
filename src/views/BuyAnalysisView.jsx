import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Star, Zap, Eye, AlertTriangle, BarChart3,
  RefreshCw, Search, Filter, ExternalLink, ChevronDown, ChevronUp,
  Calendar, Newspaper, DollarSign, Target, ShieldCheck, PlusCircle,
  Minus, BookOpen, Info, X, CheckCircle2, Clock, Layers
} from 'lucide-react';
import { useThemeAuth } from '../context/ThemeAuthContext';
import { AnimatedPage } from '../components/AnimatedPage';
import SipPlanModal from '../components/SipPlanModal';
import axios from 'axios';

const API_BASE = '/api';

// ─── Signal Config ───────────────────────────────────────────────────────────
const SIGNAL_CONFIG = {
  STRONG_BUY: {
    label: 'STRONG BUY',
    shortLabel: 'S.BUY',
    color: 'from-emerald-500 to-green-400',
    bgColor: 'bg-emerald-500/15',
    borderColor: 'border-emerald-500/40',
    textColor: 'text-emerald-400',
    glowColor: 'shadow-emerald-500/20',
    icon: Star,
    description: 'High evidence bar; portfolio risk limits still determine any position size'
  },
  BUY: {
    label: 'BUY',
    shortLabel: 'BUY',
    color: 'from-cyan-500 to-teal-400',
    bgColor: 'bg-cyan-500/15',
    borderColor: 'border-cyan-500/40',
    textColor: 'text-cyan-400',
    glowColor: 'shadow-cyan-500/20',
    icon: TrendingUp,
    description: 'Entry evidence meets the rule; position size requires separate risk budgeting'
  },
  WATCH: {
    label: 'WATCH',
    shortLabel: 'WATCH',
    color: 'from-amber-500 to-yellow-400',
    bgColor: 'bg-amber-500/15',
    borderColor: 'border-amber-500/40',
    textColor: 'text-amber-400',
    glowColor: 'shadow-amber-500/20',
    icon: Eye,
    description: 'Developing — wait for second pillar'
  },
  MONITOR: {
    label: 'MONITOR',
    shortLabel: 'MON',
    color: 'from-slate-500 to-slate-400',
    bgColor: 'bg-slate-500/10',
    borderColor: 'border-slate-500/30',
    textColor: 'text-slate-400',
    glowColor: '',
    icon: BarChart3,
    description: 'Below thresholds — monitoring'
  },
  AVOID: {
    label: 'AVOID',
    shortLabel: 'AVOID',
    color: 'from-red-500 to-rose-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    textColor: 'text-red-400',
    glowColor: '',
    icon: AlertTriangle,
    description: 'Risk flags — capital preservation'
  },
  INSUFFICIENT_DATA: {
    label: 'INSUFFICIENT DATA',
    shortLabel: 'DATA',
    color: 'from-slate-500 to-slate-400',
    bgColor: 'bg-slate-500/10',
    borderColor: 'border-slate-500/30',
    textColor: 'text-slate-400',
    glowColor: '',
    icon: Info,
    description: 'Required price or financial evidence is missing, stale, or unsupported'
  }
};

// ─── Score Gauge ─────────────────────────────────────────────────────────────
function ScoreGauge({ score, max = 100, color = 'emerald', size = 'sm' }) {
  const pct = Math.min(100, Math.max(0, (score / max) * 100));
  const dots = 5;
  const filled = Math.round((pct / 100) * dots);
  const colors = {
    emerald: 'bg-emerald-400',
    cyan: 'bg-cyan-400',
    amber: 'bg-amber-400',
    red: 'bg-red-400',
    slate: 'bg-slate-500'
  };
  const dotColor = colors[color] || 'bg-emerald-400';

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: dots }).map((_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all ${size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5'} ${i < filled ? dotColor : 'bg-slate-700'}`}
        />
      ))}
      <span className={`font-mono font-bold ${size === 'sm' ? 'text-xs' : 'text-sm'} text-slate-300 ml-1`}>{score}</span>
    </div>
  );
}

// ─── Signal Badge ─────────────────────────────────────────────────────────────
function SignalBadge({ signal, size = 'md' }) {
  const config = SIGNAL_CONFIG[signal] || SIGNAL_CONFIG.MONITOR;
  const Icon = config.icon;
  const sizes = { sm: 'px-2 py-0.5 text-xs', md: 'px-3 py-1 text-xs font-bold', lg: 'px-4 py-1.5 text-sm font-bold' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r ${config.color} text-white ${sizes[size]} shadow-sm`}>
      <Icon className={size === 'lg' ? 'w-3.5 h-3.5' : 'w-3 h-3'} />
      {size === 'sm' ? config.shortLabel : config.label}
    </span>
  );
}

// ─── Earnings Badge ───────────────────────────────────────────────────────────
function EarningsBadge({ earningsCatalyst }) {
  if (!earningsCatalyst?.nextResultDate) return null;
  const { daysToResult, dateConfidence } = earningsCatalyst;
  if (daysToResult === null || daysToResult < -5 || daysToResult > 45) return null;

  const color = daysToResult <= 7
    ? 'bg-red-500/20 border-red-500/40 text-red-400'
    : daysToResult <= 15
    ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
    : 'bg-blue-500/20 border-blue-500/40 text-blue-400';

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${color}`}>
      <Calendar className="w-2.5 h-2.5" />
      {daysToResult <= 0
        ? `Results ${Math.abs(daysToResult)}d ago`
        : `${dateConfidence === 'CONFIRMED' ? 'Results' : 'Est. results'} in ${daysToResult}d`}
    </span>
  );
}

// ─── News Sentiment Badge ─────────────────────────────────────────────────────
function NewsBadge({ newsSignal }) {
  if (!newsSignal || newsSignal.articleCount === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs bg-blue-500/10 border-blue-500/25 text-blue-300">
      <Newspaper className="w-2.5 h-2.5" />
      News context · {newsSignal.articleCount}
    </span>
  );
}

// ─── Tag Pill ─────────────────────────────────────────────────────────────────
function TagPill({ tag }) {
  const colors = {
    emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    cyan: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
    blue: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    purple: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
    red: 'bg-red-500/15 text-red-400 border-red-500/20',
    amber: 'bg-amber-500/15 text-amber-400 border-amber-500/20'
  };
  const colorClass = colors[tag.color] || colors.cyan;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border ${colorClass}`}>
      {tag.label}
    </span>
  );
}

// ─── Stock Analysis Card ──────────────────────────────────────────────────────
function BuySignalCard({ analysis, onSipPlanClick, onNewsClick, newsLoading }) {
  const { formatMoney } = useThemeAuth();
  const [expanded, setExpanded] = useState(false);
  const config = SIGNAL_CONFIG[analysis.buySignal] || SIGNAL_CONFIG.MONITOR;
  const Icon = config.icon;
  const fundScore = analysis.fundamentalScore || 0;
  const techScore = analysis.technicalScore || 0;

  const fundColor = fundScore >= 70 ? 'emerald' : fundScore >= 55 ? 'cyan' : fundScore >= 40 ? 'amber' : 'slate';
  const techColor = techScore >= 70 ? 'emerald' : techScore >= 55 ? 'cyan' : techScore >= 40 ? 'amber' : 'slate';

  const hasSip = Boolean(analysis.sipPlan);
  const hasEarnings = analysis.earningsCatalyst?.nextResultDate;
  const hasNews = analysis.newsSignal?.articleCount > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`reports-card border ${config.borderColor} rounded-2xl overflow-hidden ${analysis.buySignal === 'STRONG_BUY' ? `shadow-lg ${config.glowColor}` : ''}`}
    >
      {/* Card Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          {/* Left: Symbol + Signal */}
          <div className="flex items-start gap-3 min-w-0">
            {/* Signal icon */}
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${config.bgColor}`}>
              <Icon className={`w-4.5 h-4.5 ${config.textColor}`} style={{ width: '18px', height: '18px' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>{analysis.symbol}</span>
                <SignalBadge signal={analysis.buySignal} size="sm" />
                {analysis.inPortfolio && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    IN PORTFOLIO
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5">{analysis.name}</p>
              {/* Badges row */}
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <EarningsBadge earningsCatalyst={analysis.earningsCatalyst} />
                <NewsBadge newsSignal={analysis.newsSignal} />
                {analysis.qualitativeTags?.slice(0, 3).map(t => <TagPill key={t.tag} tag={t} />)}
              </div>
            </div>
          </div>

          {/* Right: Price + Scores */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className="text-lg font-bold font-mono" style={{ color: 'var(--text-primary)' }}>
              {analysis.currentPrice > 0 ? `₹${analysis.currentPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}
            </span>
            {analysis.dailyGainPct !== undefined && analysis.dailyGainPct !== null && (
              <span className={`text-xs font-semibold ${analysis.dailyGainPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {analysis.dailyGainPct >= 0 ? '+' : ''}{analysis.dailyGainPct?.toFixed(2)}% today
              </span>
            )}
            {analysis.lastPriceDate && (
              <span className="text-[9px] text-slate-500">Close {analysis.lastPriceDate}{Number.isFinite(analysis.latestPriceAgeDays) ? ` · ${analysis.latestPriceAgeDays}d old` : ''}</span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${analysis.fundamentalsStatus === 'AVAILABLE' ? 'border-emerald-500/30 text-emerald-500' : 'border-slate-600 text-slate-500'}`}>
              {analysis.source}
            </span>
          </div>
        </div>

        {/* Score Row */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-800/50">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">Technical</span>
            <ScoreGauge score={techScore} color={techColor} />
          </div>
          <div className="w-px h-4 bg-slate-700" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">Fundamental</span>
            <ScoreGauge score={fundScore} color={fundColor} />
          </div>
          <div className="w-px h-4 bg-slate-700" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 uppercase tracking-wide">Composite</span>
            <span className={`font-bold text-sm font-mono ${config.textColor}`}>{analysis.compositeScore}</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {hasSip && (
              <button
                onClick={(e) => { e.stopPropagation(); onSipPlanClick(analysis); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 text-xs border border-purple-500/30 transition-colors"
              >
                <Layers className="w-3 h-3" />
                SIP Plan
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(true); onNewsClick(analysis); }}
              disabled={newsLoading}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 text-xs border border-blue-500/30 transition-colors disabled:opacity-50"
            >
              <Newspaper className="w-3 h-3" />
              {newsLoading ? 'Loading' : hasNews ? 'News' : 'Load News'}
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 text-xs border border-slate-700 transition-colors"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? 'Less' : 'Detail'}
            </button>
          </div>
        </div>

        {/* Signal Reason (always visible) */}
        <p className="text-xs text-slate-400 mt-2.5 leading-relaxed">{analysis.signalReason}</p>
        {(analysis.buySignal === 'BUY' || analysis.buySignal === 'WATCH') && analysis.strongBuyBlockers?.length > 0 && (
          <p className="text-[10px] text-slate-500 mt-1">Strong Buy gates pending: {analysis.strongBuyBlockers.slice(0, 3).join('; ')}.</p>
        )}
      </div>

      {/* Expanded Detail Panel */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="border-t border-slate-800/50 bg-slate-900/30"
          >
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Technical Signals */}
              <div className="reports-subcard rounded-xl p-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5" /> Technical Signals
                </h4>
                <ul className="space-y-1">
                  {analysis.technicalSignals?.slice(0, 6).map((sig, i) => (
                    <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
                      <span className={`mt-0.5 shrink-0 ${sig.includes('✓') ? 'text-emerald-400' : sig.includes('⚠') ? 'text-amber-400' : 'text-slate-500'}`}>
                        {sig.includes('✓') ? '✓' : sig.includes('⚠') ? '⚠' : '·'}
                      </span>
                      <span>{sig.replace(' ✓', '').replace(' ⚠', '')}</span>
                    </li>
                  ))}
                </ul>
                {analysis.stopLoss && (
                  <div className="mt-2 pt-2 border-t border-slate-700/50 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Stop Loss</span>
                    <span className="text-xs font-mono font-semibold text-red-400">₹{analysis.stopLoss?.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {analysis.riskRewardRatio && (
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-slate-500">R:R Ratio</span>
                    <span className={`text-xs font-mono font-semibold ${analysis.riskRewardRatio >= 2 ? 'text-emerald-400' : 'text-amber-400'}`}>{analysis.riskRewardRatio}:1</span>
                  </div>
                )}
                {analysis.targetPrice && (
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-slate-500">Next close pivot estimate</span>
                    <span className="text-xs font-mono font-semibold text-cyan-400">₹{analysis.targetPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                {analysis.weinsteinStageLabel && (
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-slate-500">Weinstein Stage</span>
                    <span className={`text-xs ${analysis.weinsteinStage === 2 ? 'text-emerald-400' : analysis.weinsteinStage === 1 ? 'text-amber-400' : 'text-red-400'}`}>{analysis.weinsteinStageLabel?.split(' (')[0]}</span>
                  </div>
                )}
              </div>

              {/* Fundamentals Detail */}
              <div className="reports-subcard rounded-xl p-3">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5" /> Fundamentals
                </h4>
                {analysis.fundamentalsStatus !== 'AVAILABLE' ? (
                  <p className="text-xs text-slate-500">{analysis.fundamentalDataReason || 'No current authorized fundamental snapshot is available.'}</p>
                ) : (
                  <div className="space-y-1.5">
                    {Object.entries(analysis.fundamentalBreakdown || {}).map(([key, val]) => (
                      <div key={key} className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-500 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400">{val.value}</span>
                          <span className={`text-xs font-bold ${val.pts >= val.max * 0.7 ? 'text-emerald-400' : val.pts >= val.max * 0.4 ? 'text-amber-400' : 'text-slate-500'}`}>
                            {val.pts}/{val.max}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-slate-500 mt-2">Coverage {analysis.fundamentalCoveragePct ?? 0}%. Snapshot status: {analysis.dataQuality || 'UNKNOWN'}.</p>
                {analysis.screenerUrl && (
                  <a href={analysis.screenerUrl} target="_blank" rel="noreferrer"
                    className="mt-2 flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300">
                    <ExternalLink className="w-2.5 h-2.5" /> Screener.in
                  </a>
                )}
              </div>

              {/* Earnings Catalyst Detail */}
              {analysis.earningsCatalyst?.nextResultDate && (
                <div className="reports-subcard rounded-xl p-3">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" /> Earnings Catalyst
                  </h4>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-[10px] text-slate-500">Next Result</span>
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{analysis.earningsCatalyst.nextResultDate}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[10px] text-slate-500">Days Away</span>
                      <span className={`text-xs font-bold ${(analysis.earningsCatalyst.daysToResult || 0) <= 7 ? 'text-red-400' : (analysis.earningsCatalyst.daysToResult || 0) <= 15 ? 'text-amber-400' : 'text-slate-300'}`}>
                        {analysis.earningsCatalyst.daysToResult !== null ? `${analysis.earningsCatalyst.daysToResult} days` : 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[10px] text-slate-500">Date confidence</span>
                      <span className="text-xs font-semibold text-slate-300">{analysis.earningsCatalyst.dateConfidence || 'UNKNOWN'}</span>
                    </div>
                    {analysis.earningsCatalyst.beatRate !== null && analysis.earningsCatalyst.beatRate !== undefined && (
                      <p className="text-[10px] text-slate-500">Historical reported surprises are informational only; dated consensus data is not configured, so this does not affect the signal.</p>
                    )}
                    {analysis.earningsCatalyst.signalNote && (
                      <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">{analysis.earningsCatalyst.signalNote}</p>
                    )}
                    {analysis.earningsCatalyst.educationalContext && (
                      <div className="mt-2 pt-2 border-t border-slate-700/50">
                        <p className="text-[10px] text-slate-500 italic leading-relaxed">{analysis.earningsCatalyst.educationalContext}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* News Panel */}
              {analysis.newsSignal?.articles?.length > 0 && (
                <div className="reports-subcard rounded-xl p-3">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Newspaper className="w-3.5 h-3.5" /> News Intelligence
                  </h4>
                  <ul className="space-y-2">
                    {analysis.newsSignal.articles.slice(0, 3).map((article, i) => (
                      <li key={i} className="border-b border-slate-700/30 pb-2 last:border-0 last:pb-0">
                        <a href={article.link} target="_blank" rel="noreferrer"
                          className="text-[10px] text-slate-300 hover:text-white leading-relaxed line-clamp-2 block">
                          {article.title}
                        </a>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {article.signals?.map((sig, j) => (
                            <span key={j} className={`text-[9px] px-1.5 py-0.5 rounded ${sig.weight > 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                              {sig.label} {sig.weight > 0 ? `+${sig.weight}` : sig.weight}
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.newsSignal?.sourceStatus === 'DISABLED_PENDING_SOURCE_REVIEW' && (
                <div className="reports-subcard rounded-xl p-3">
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">News source status</h4>
                  <p className="text-xs text-slate-500">Automated feeds are disabled until source access and retention terms are confirmed. News keywords cannot change a Buy/Sell state.</p>
                </div>
              )}

              {/* SIP Plan Summary (inline) */}
              {analysis.sipPlan && (
                <div className="reports-subcard rounded-xl p-3 md:col-span-2">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5" /> Opportunistic SIP Plan
                    </h4>
                    <button
                      onClick={() => onSipPlanClick(analysis)}
                      className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1"
                    >
                      <ExternalLink className="w-2.5 h-2.5" /> Full Plan
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {analysis.sipPlan.tranches?.map(t => (
                      <div key={t.tranche} className="bg-slate-800/50 rounded-lg p-2">
                        <div className="text-[9px] text-slate-500 uppercase">{t.label}</div>
                        <div className="text-xs font-bold text-purple-400 font-mono mt-0.5">{t.amount ? `₹${t.amount.toLocaleString('en-IN')}` : `${Math.round(t.ratio * 100)}% of budget`}</div>
                        <div className="text-[9px] text-slate-500 mt-0.5 leading-tight">{t.triggerType === 'IMMEDIATE' ? 'Now' : t.triggerType === 'PRICE_PULLBACK' ? 'On pullback' : 'On 52wk high'}</div>
                        <div className={`text-[9px] mt-1 px-1 py-0.5 rounded text-center ${t.status === 'READY' ? 'bg-emerald-500/20 text-emerald-400' : t.status === 'ARMED' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-700 text-slate-500'}`}>
                          {t.status}
                        </div>
                      </div>
                    ))}
                  </div>
                  {analysis.sipPlan.earningsNote && (
                    <p className="text-[10px] text-amber-400 mt-2">{analysis.sipPlan.earningsNote}</p>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Summary Stats Bar ────────────────────────────────────────────────────────
function SummaryBar({ summary }) {
  if (!summary) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
      {[
        { label: 'STRONG BUY', value: summary.strongBuyCount, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20' },
        { label: 'BUY', value: summary.buyCount, color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20' },
        { label: 'WATCH', value: summary.watchCount, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' },
        { label: 'DATA NEEDED', value: summary.insufficientDataCount, color: 'text-slate-400', bg: 'bg-slate-500/10 border-slate-500/20' },
        { label: 'SIP Plans', value: summary.withSipPlans, color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20' },
        { label: 'Earnings Dates Soon', value: summary.withEarningsCatalyst, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
      ].map(item => (
        <div key={item.label} className={`reports-subcard border ${item.bg} rounded-xl p-3 text-center`}>
          <div className={`text-2xl font-black font-mono ${item.color}`}>{item.value ?? 0}</div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wide mt-0.5">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────
export default function BuyAnalysisView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [signalFilter, setSignalFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('signal'); // 'signal' | 'score' | 'gainPct'
  const [selectedSipSymbol, setSelectedSipSymbol] = useState(null);
  const selectedSipAnalysis = useMemo(() => {
    if (!selectedSipSymbol || !data?.analyses) return null;
    return data.analyses.find(a => a.symbol === selectedSipSymbol) || null;
  }, [data?.analyses, selectedSipSymbol]);
  const [addingWatch, setAddingWatch] = useState(false);
  const [watchlistInput, setWatchlistInput] = useState('');
  const [showWatchlistInput, setShowWatchlistInput] = useState(false);
  const [newsLoadingSymbols, setNewsLoadingSymbols] = useState({});

  const fetchData = useCallback(async (force = false) => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (force) params.set('refresh', 'true');
      const res = await axios.get(`${API_BASE}/buy-analysis?${params}`);
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load buy analysis');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData(true);
    setRefreshing(false);
  };

  const handleRefreshFundamentals = async () => {
    setRefreshing(true);
    try {
      const response = await axios.post(`${API_BASE}/buy-analysis/refresh-fundamentals`);
      setNotice(response.data?.message || 'Fundamental source status updated.');
      setTimeout(() => fetchData(true), 2000);
    } catch (err) {
      setNotice(err.response?.data?.error || err.message || 'Fundamental source could not be refreshed.');
    } finally {
      setRefreshing(false);
    }
  };

  const handleLoadNews = async analysis => {
    const symbol = analysis.symbol;
    setNewsLoadingSymbols(current => ({ ...current, [symbol]: true }));
    try {
      const response = await axios.get(`${API_BASE}/news-intel/${encodeURIComponent(symbol)}`, { params: { name: analysis.name } });
      setData(current => current ? {
        ...current,
        analyses: current.analyses.map(item => item.symbol === symbol ? { ...item, newsSignal: response.data } : item)
      } : current);
    } catch (err) {
      setNotice(err.response?.data?.error || err.message || 'News could not be loaded.');
    } finally {
      setNewsLoadingSymbols(current => ({ ...current, [symbol]: false }));
    }
  };

  const handleAddWatchlist = async () => {
    if (!watchlistInput.trim()) return;
    setAddingWatch(true);
    try {
      await axios.post(`${API_BASE}/buy-watchlist`, { symbol: watchlistInput.trim().toUpperCase() });
      setWatchlistInput('');
      setShowWatchlistInput(false);
      await fetchData(true);
    } catch { /* ignore */ } finally {
      setAddingWatch(false);
    }
  };

  // Filter and sort analyses
  const filteredAnalyses = useMemo(() => {
    if (!data?.analyses) return [];
    const signalOrder = { STRONG_BUY: 0, BUY: 1, WATCH: 2, INSUFFICIENT_DATA: 3, MONITOR: 4, AVOID: 5 };
    let list = data.analyses;

    // Signal filter
    if (signalFilter !== 'ALL') {
      list = list.filter(a => a.buySignal === signalFilter);
    }
    // Source filter
    if (sourceFilter !== 'ALL') {
      list = list.filter(a => a.source?.includes(sourceFilter));
    }
    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toUpperCase();
      list = list.filter(a => a.symbol.includes(q) || (a.name || '').toUpperCase().includes(q));
    }
    // Sort
    if (sortBy === 'score') {
      list = [...list].sort((a, b) => b.compositeScore - a.compositeScore);
    } else if (sortBy === 'gainPct') {
      list = [...list].sort((a, b) => (b.dailyGainPct || 0) - (a.dailyGainPct || 0));
    } else {
      list = [...list].sort((a, b) => {
        const oDiff = (signalOrder[a.buySignal] ?? 99) - (signalOrder[b.buySignal] ?? 99);
        return oDiff !== 0 ? oDiff : b.compositeScore - a.compositeScore;
      });
    }
    return list;
  }, [data?.analyses, signalFilter, sourceFilter, searchQuery, sortBy]);

  return (
    <AnimatedPage>
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
              Buy Analysis
            </h1>
            {data?.generatedAt && (
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                <Clock className="w-3 h-3" />
                Evaluated {new Date(data.generatedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                · {data.candidateCount} candidates screened
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Add to Watchlist */}
            <div className="relative">
              {showWatchlistInput ? (
                <div className="flex items-center gap-1.5">
                  <input
                    value={watchlistInput}
                    onChange={e => setWatchlistInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddWatchlist()}
                    placeholder="Symbol (e.g. DMART)"
                    className="reports-subcard border rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none"
                    style={{ color: 'var(--text-primary)', borderColor: 'var(--border-subtle)' }}
                  />
                  <button onClick={handleAddWatchlist} disabled={addingWatch}
                    className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition-colors">
                    {addingWatch ? '...' : 'Add'}
                  </button>
                  <button onClick={() => setShowWatchlistInput(false)}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowWatchlistInput(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 border border-purple-500/30 text-sm transition-colors">
                  <PlusCircle className="w-3.5 h-3.5" /> Watchlist
                </button>
              )}
            </div>
            <button
              onClick={handleRefreshFundamentals}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-sm border border-slate-700 transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" /> Check Fundamentals Source
            </button>
            <button
              onClick={handleRefresh}
              disabled={loading || refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-sm border border-slate-700 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Summary Stats */}
        {data?.summary && <SummaryBar summary={data.summary} />}

        {notice && <div className="reports-card border rounded-xl px-4 py-3 text-xs text-slate-300" style={{ borderColor: 'var(--border-subtle)' }}>{notice}</div>}

        {data?.backtestStatus === 'BLOCKED_DATA' && (
          <div className="reports-card border rounded-xl px-4 py-3 mb-4 text-xs text-amber-300" style={{ borderColor: 'var(--border-subtle)' }}>
            Buy signals have not been historically backtested. Point-in-time fundamentals, audited OHLCV and corporate-action history, and a complete historical universe are unavailable; performance claims are not supported.
          </div>
        )}

        {/* Filters & Search */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Signal filter tabs */}
          <div className="flex items-center gap-1 reports-subcard rounded-xl p-1 border" style={{ borderColor: 'var(--border-subtle)' }}>
            {['ALL', 'STRONG_BUY', 'BUY', 'WATCH', 'INSUFFICIENT_DATA', 'MONITOR'].map(s => (
              <button
                key={s}
                onClick={() => setSignalFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${signalFilter === s
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'}`}
              >
                {s === 'ALL' ? 'All' : s === 'STRONG_BUY' ? 'Strong Buy' : s === 'BUY' ? 'Buy' : s === 'WATCH' ? 'Watch' : s === 'INSUFFICIENT_DATA' ? 'Data Needed' : 'Monitor'}
              </button>
            ))}
          </div>

          {/* Source filter */}
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            className="reports-subcard border rounded-lg px-3 py-1.5 text-sm focus:outline-none"
            style={{ color: 'var(--text-primary)', borderColor: 'var(--border-subtle)' }}
          >
            <option value="ALL">All Sources</option>
            <option value="Portfolio">My Portfolio</option>
            <option value="NSE500">NSE 500</option>
            <option value="Watchlist">Watchlist</option>
          </select>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="reports-subcard border rounded-lg px-3 py-1.5 text-sm focus:outline-none"
            style={{ color: 'var(--text-primary)', borderColor: 'var(--border-subtle)' }}
          >
            <option value="signal">Sort: Signal Strength</option>
            <option value="score">Sort: Composite Score</option>
            <option value="gainPct">Sort: Today's Gain</option>
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search symbol or name..."
              className="w-full reports-subcard border rounded-lg pl-9 pr-3 py-1.5 text-sm focus:outline-none"
              style={{ color: 'var(--text-primary)', borderColor: 'var(--border-subtle)' }}
            />
          </div>

          {filteredAnalyses.length > 0 && (
            <span className="text-xs text-slate-500">{filteredAnalyses.length} results</span>
          )}
        </div>

        {/* Content */}
        {loading && !data ? (
          <div className="flex items-center justify-center py-24 text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin mr-3" />
            <span>Running buy analysis across {200}+ stocks...</span>
          </div>
        ) : error ? (
          <div className="reports-card border border-red-500/30 rounded-2xl p-6 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <p className="text-red-400 font-semibold">{error}</p>
            <button onClick={() => fetchData(true)} className="mt-3 px-4 py-2 bg-slate-800 rounded-lg text-slate-300 text-sm">Retry</button>
          </div>
        ) : filteredAnalyses.length === 0 ? (
          <div className="reports-card rounded-2xl p-8 text-center text-slate-500">
            <Target className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p>No stocks match the current filters.</p>
            <p className="text-xs mt-1">Try broadening the signal filter or refreshing fundamentals.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredAnalyses.map(analysis => (
              <BuySignalCard
                key={analysis.symbol}
                analysis={analysis}
                onSipPlanClick={a => setSelectedSipSymbol(a.symbol)}
                onNewsClick={handleLoadNews}
                newsLoading={Boolean(newsLoadingSymbols[analysis.symbol])}
              />
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="reports-card rounded-2xl p-4 border" style={{ borderColor: 'var(--border-subtle)' }}>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Signal Guide</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.entries(SIGNAL_CONFIG).map(([key, config]) => (
              <div key={key} className={`${config.bgColor} border ${config.borderColor} rounded-xl p-2.5`}>
                <SignalBadge signal={key} size="sm" />
                <p className="text-[10px] text-slate-500 mt-1.5 leading-tight">{config.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/50">
            <p className="text-[10px] text-slate-500 leading-relaxed">
              <strong className="text-slate-400">Scores:</strong> Fundamentals with incomplete or stale coverage are labeled insufficient. Buy states require a close-based setup with an estimated reward/risk of at least 2:1. Strong Buy also requires confirmed volume, valuation, filing, pledge, leverage, and portfolio-risk evidence; missing evidence blocks the label.
              SIP plans are manual, budgeted by the user, and expire for re-evaluation. News and estimated result dates do not independently change a signal.
            </p>
          </div>
        </div>
      </div>

      {/* SIP Plan Modal */}
      {selectedSipAnalysis && (
        <SipPlanModal
          analysis={selectedSipAnalysis}
          onClose={() => setSelectedSipSymbol(null)}
        />
      )}
    </AnimatedPage>
  );
}
