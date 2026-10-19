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
import HoldingLogo from '../components/HoldingLogo';
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
    color: 'from-neutral-500 to-neutral-400',
    bgColor: 'bg-white/[0.04]',
    borderColor: 'border-[var(--border-color)]',
    textColor: 'text-[var(--text-muted)]',
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
    color: 'from-neutral-500 to-neutral-400',
    bgColor: 'bg-white/[0.04]',
    borderColor: 'border-[var(--border-color)]',
    textColor: 'text-[var(--text-muted)]',
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
    slate: 'bg-[var(--border-color)]'
  };
  const dotColor = colors[color] || 'bg-emerald-400';

  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: dots }).map((_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all ${size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5'} ${i < filled ? dotColor : 'bg-[var(--border-color)]'}`}
        />
      ))}
      <span className={`font-mono font-bold ${size === 'sm' ? 'text-xs' : 'text-sm'} text-[var(--text-primary)] ml-1`}>{score}</span>
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
function EarningsBadge({ earningsCatalyst, onBadgeClick }) {
  if (!earningsCatalyst) return null;
  const { quarterlyResultStatus, daysAgo, daysToResult, dateConfidence, resultVerdict } = earningsCatalyst;

  if (quarterlyResultStatus === 'RESULTS_OUT') {
    const isBlowout = resultVerdict === 'BLOWOUT_BEAT';
    return (
      <span
        onClick={(e) => {
          if (onBadgeClick) {
            e.stopPropagation();
            onBadgeClick(isBlowout ? 'BLOWOUT_BEAT' : 'RESULTS_OUT');
          }
        }}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${
          isBlowout
            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 font-semibold'
            : 'bg-green-500/15 border-green-500/30 text-green-300'
        } ${onBadgeClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
        title={onBadgeClick ? `Click to filter by ${isBlowout ? 'Blowout Beat' : 'Results Out'}` : undefined}
      >
        <CheckCircle2 className="w-2.5 h-2.5" />
        {`Results Out ${daysAgo !== null && daysAgo !== undefined ? `(${daysAgo}d ago)` : ''}`}
      </span>
    );
  }

  if (daysToResult === null || daysToResult < -5 || daysToResult > 45) return null;

  const color = daysToResult <= 7
    ? 'bg-red-500/20 border-red-500/40 text-red-400 font-semibold'
    : daysToResult <= 15
    ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
    : 'bg-blue-500/20 border-blue-500/40 text-blue-400';

  return (
    <span
      onClick={(e) => {
        if (onBadgeClick) {
          e.stopPropagation();
          onBadgeClick('EARNINGS_SOON');
        }
      }}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs ${color} ${onBadgeClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
      title={onBadgeClick ? 'Click to filter by Earnings Dates Soon' : undefined}
    >
      <Calendar className="w-2.5 h-2.5" />
      {`Results ${dateConfidence === 'CONFIRMED' ? 'Confirmed' : 'Est.'} in ${daysToResult}d`}
    </span>
  );
}

// ─── News Sentiment Badge ─────────────────────────────────────────────────────
function NewsBadge({ newsSignal, onBadgeClick }) {
  if (!newsSignal || newsSignal.articleCount === 0) return null;
  return (
    <span
      onClick={(e) => {
        if (onBadgeClick) {
          e.stopPropagation();
          onBadgeClick('POSITIVE_NEWS');
        }
      }}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs bg-blue-500/10 border-blue-500/25 text-blue-300 ${onBadgeClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
      title={onBadgeClick ? 'Click to filter by Positive News' : undefined}
    >
      <Newspaper className="w-2.5 h-2.5" />
      News context · {newsSignal.articleCount}
    </span>
  );
}

// ─── Tag Pill ─────────────────────────────────────────────────────────────────
function TagPill({ tag, onTagClick }) {
  const colors = {
    emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
    cyan: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
    blue: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
    purple: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
    red: 'bg-red-500/15 text-red-400 border-red-500/20',
    amber: 'bg-amber-500/15 text-amber-400 border-amber-500/20'
  };
  const colorClass = colors[tag.color] || colors.cyan;
  const tagKey = tag.tag || tag;
  return (
    <span
      onClick={(e) => {
        if (onTagClick) {
          e.stopPropagation();
          onTagClick(tagKey);
        }
      }}
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border ${colorClass} ${onTagClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
      title={onTagClick ? `Click to filter by ${tag.label || tagKey}` : undefined}
    >
      {tag.label}
    </span>
  );
}

// ─── Stock Analysis Card ──────────────────────────────────────────────────────
function BuySignalCard({ analysis, onSipPlanClick, onSyncSymbol, syncingSymbol, holdings = [], onSelectHolding, onBadgeClick }) {
  const { formatMoney } = useThemeAuth();
  const [expanded, setExpanded] = useState(false);
  const config = SIGNAL_CONFIG[analysis.buySignal] || SIGNAL_CONFIG.MONITOR;
  const fundScore = analysis.fundamentalScore || 0;
  const techScore = analysis.technicalScore || 0;

  const fundColor = fundScore >= 70 ? 'emerald' : fundScore >= 55 ? 'cyan' : fundScore >= 40 ? 'amber' : 'slate';
  const techColor = techScore >= 70 ? 'emerald' : techScore >= 55 ? 'cyan' : techScore >= 40 ? 'amber' : 'slate';

  const hasSip = Boolean(analysis.sipPlan);
  const hasEarnings = analysis.earningsCatalyst?.nextResultDate;
  const hasNews = Boolean(analysis.newsSignal?.articles?.length > 0 || analysis.newsSignal?.articleCount > 0);

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
            {/* Company Logo */}
            <HoldingLogo
              holding={analysis}
              symbol={analysis.symbol}
              name={analysis.name}
              category="in_stocks"
              className="w-10 h-10 rounded-xl shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>{analysis.symbol}</span>
                <SignalBadge signal={analysis.buySignal} size="sm" />
                {analysis.inPortfolio && (
                  <span
                    onClick={(e) => {
                      if (onBadgeClick) {
                        e.stopPropagation();
                        onBadgeClick('IN_PORTFOLIO');
                      }
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 ${onBadgeClick ? 'cursor-pointer hover:opacity-80' : ''}`}
                    title={onBadgeClick ? 'Click to filter Portfolio stocks' : undefined}
                  >
                    IN PORTFOLIO
                  </span>
                )}
                {analysis.isIpo && (
                  <span
                    onClick={(e) => {
                      if (onBadgeClick) {
                        e.stopPropagation();
                        onBadgeClick('IPO_DEMERGER');
                      }
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-400 border border-purple-500/30 font-semibold flex items-center gap-1 ${onBadgeClick ? 'cursor-pointer hover:opacity-80' : ''}`}
                    title={onBadgeClick ? 'Click to filter IPO / Demerger stocks' : undefined}
                  >
                    <Zap className="w-2.5 h-2.5" /> IPO / DEMERGER
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">{analysis.name}</p>
              {/* Badges row */}
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <EarningsBadge earningsCatalyst={analysis.earningsCatalyst} onBadgeClick={onBadgeClick} />
                <NewsBadge newsSignal={analysis.newsSignal} onBadgeClick={onBadgeClick} />
                {analysis.qualitativeTags?.slice(0, 3).map(t => <TagPill key={t.tag || t} tag={t} onTagClick={onBadgeClick} />)}
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
              <span className="text-[9px] text-[var(--text-muted)]">Close {analysis.lastPriceDate}{Number.isFinite(analysis.latestPriceAgeDays) ? ` · ${analysis.latestPriceAgeDays}d old` : ''}</span>
            )}
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${analysis.fundamentalsStatus === 'AVAILABLE' ? 'border-emerald-500/30 text-emerald-400' : 'border-[var(--border-color)] text-[var(--text-muted)]'}`}>
              {analysis.source}
            </span>
          </div>
        </div>

        {/* Score Row */}
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Technical</span>
            <ScoreGauge score={techScore} color={techColor} />
          </div>
          <div className="w-px h-4 bg-[var(--border-color)]" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Fundamental</span>
            <ScoreGauge score={fundScore} color={fundColor} />
          </div>
          <div className="w-px h-4 bg-[var(--border-color)]" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide">Composite</span>
            <span className={`font-bold text-sm font-mono ${config.textColor}`}>{analysis.compositeScore}</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            {onSelectHolding && analysis.inPortfolio && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const cleanSym = String(analysis.symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');
                  const targetHolding = holdings.find(h =>
                    String(h.symbol).toUpperCase().replace(/\.(NS|BO)$/i, '') === cleanSym
                  );
                  if (targetHolding) onSelectHolding(targetHolding);
                }}
                className="rounded-lg border border-[var(--border-color)] reports-subcard px-2.5 py-1 text-[10px] font-bold text-[var(--text-primary)] hover:border-emerald-500/40 hover:text-emerald-400 transition-colors cursor-pointer"
                title="Open holding transaction ledger"
              >
                Open Ledger
              </button>
            )}
            <a
              href={analysis.screenerUrl || `https://www.screener.in/company/${encodeURIComponent((analysis.symbol || '').replace(/\.(NS|BO)$/i, '').trim())}/consolidated/`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] font-bold text-cyan-300 hover:bg-cyan-500/20 flex items-center gap-1 transition-colors cursor-pointer"
              title="Open company financial statement on Screener.in"
            >
              Screener.in <ExternalLink className="w-2.5 h-2.5" />
            </a>
            <a
              href={`https://gocharting.com/terminal?ticker=${analysis.symbol?.endsWith('.BO') ? 'BSE:' : 'NSE:'}${encodeURIComponent((analysis.symbol || '').replace(/\.(NS|BO)$/i, '').trim())}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-bold text-amber-300 hover:bg-amber-500/20 flex items-center gap-1 transition-colors cursor-pointer"
              title="Open chart on GoCharting"
            >
              GoCharting <ExternalLink className="w-2.5 h-2.5" />
            </a>
            {hasSip && (
              <button
                onClick={(e) => { e.stopPropagation(); onSipPlanClick(analysis); }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 text-xs border border-purple-500/30 transition-colors cursor-pointer"
              >
                <Layers className="w-3 h-3" />
                SIP Plan
              </button>
            )}
            {hasNews && (
              <span
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs border font-medium ${
                  analysis.newsSignal?.overallSentiment?.includes('POSITIVE')
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : analysis.newsSignal?.overallSentiment?.includes('NEGATIVE')
                    ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                    : 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                }`}
              >
                <Newspaper className="w-3 h-3" />
                {analysis.newsSignal?.overallSentiment === 'STRONGLY_POSITIVE' || analysis.newsSignal?.overallSentiment === 'POSITIVE'
                  ? 'Catalyst'
                  : analysis.newsSignal?.overallSentiment?.includes('NEGATIVE')
                  ? 'News Alert'
                  : 'News'}
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onSyncSymbol?.(analysis.symbol); }}
              disabled={syncingSymbol === analysis.symbol}
              title="Sync latest live quote and Screener fundamentals on demand"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg reports-subcard hover:bg-white/5 text-[var(--text-primary)] text-xs border border-[var(--border-color)] transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${syncingSymbol === analysis.symbol ? 'animate-spin text-emerald-400' : ''}`} />
              {syncingSymbol === analysis.symbol ? 'Syncing...' : 'Sync'}
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg reports-subcard hover:bg-white/5 text-[var(--text-primary)] text-xs border border-[var(--border-color)] transition-colors cursor-pointer"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? 'Less' : 'Detail'}
            </button>
          </div>
        </div>

        {/* Signal Reason (always visible) */}
        <p className="text-xs text-[var(--text-secondary)] mt-2.5 leading-relaxed">{analysis.signalReason}</p>
        {(analysis.buySignal === 'BUY' || analysis.buySignal === 'WATCH') && analysis.strongBuyBlockers?.length > 0 && (
          <p className="text-[10px] text-[var(--text-muted)] mt-1">Strong Buy gates pending: {analysis.strongBuyBlockers.slice(0, 3).join('; ')}.</p>
        )}

        {/* Executive Action Stance Banner (always visible) */}
        {analysis.executiveStrategy && (
          <div className="mt-2.5 rounded-lg border border-purple-500/30 bg-purple-500/10 p-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <span
                onClick={(e) => {
                  if (onBadgeClick) {
                    e.stopPropagation();
                    onBadgeClick(analysis.executiveStrategy.stance);
                  }
                }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r ${analysis.executiveStrategy.badgeTheme} text-white shadow-sm ${onBadgeClick ? 'cursor-pointer hover:opacity-85 transition-opacity' : ''} shrink-0`}
                title={`Click to filter by ${analysis.executiveStrategy.stanceLabel}`}
              >
                <Target className="w-2.5 h-2.5" />
                {analysis.executiveStrategy.stanceLabel}
              </span>
              <span className="text-[var(--text-primary)] font-medium text-xs truncate">
                {analysis.executiveStrategy.immediateAction}
              </span>
            </div>
            <div className="flex items-center gap-2.5 text-[11px] text-[var(--text-secondary)] shrink-0 font-mono">
              <span>Dip: <span className="text-cyan-400 font-bold">{analysis.executiveStrategy.whenToInvestAgain?.dipBuy?.levelRange}</span></span>
              <span className="text-[var(--text-muted)]">•</span>
              <span>Stop: <span className="text-rose-400 font-bold">{analysis.executiveStrategy.riskAndExit?.stopLoss ? `₹${analysis.executiveStrategy.riskAndExit.stopLoss.toLocaleString('en-IN')}` : '50-EMA'}</span></span>
            </div>
          </div>
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
            className="border-t border-[var(--border-color)] reports-card"
          >
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Executive Investment Strategy & Action Roadmap (Full Detailed Section) */}
              {analysis.executiveStrategy && (
                <div className="reports-subcard rounded-xl p-3.5 md:col-span-2 border border-purple-500/30 bg-purple-500/10">
                  <div className="flex items-center justify-between mb-2.5 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-purple-400" />
                      <h4 className="text-xs font-bold text-purple-300 uppercase tracking-wider">
                        Executive Investment Strategy & Staged Accumulation Plan
                      </h4>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-gradient-to-r ${analysis.executiveStrategy.badgeTheme} text-white shadow-sm`}>
                      {analysis.executiveStrategy.stanceLabel}
                    </span>
                  </div>

                  {/* How to Go About It */}
                  <div className="rounded-lg reports-subcard border border-[var(--border-color)] p-3 mb-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400 mb-1">
                      How to Go About It (Execution Stance)
                    </div>
                    <p className="text-xs text-[var(--text-primary)] leading-relaxed font-medium">
                      {analysis.executiveStrategy.howToGoAboutIt}
                    </p>
                  </div>

                  {/* When to Invest Again: 3-Tranche Staged Roadmap */}
                  <div className="mb-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2 flex items-center justify-between">
                      <span>When to Invest Again (Staged Accumulation Roadmap)</span>
                      <span className="text-[10px] text-[var(--text-muted)] font-normal">Tranche allocation sizing</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                      {analysis.executiveStrategy.tranches?.map((tranche) => (
                        <div key={tranche.tranche} className="rounded-lg reports-subcard border border-[var(--border-color)] p-2.5 flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-[var(--text-primary)]">{tranche.label}</span>
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                {tranche.pctLabel}
                              </span>
                            </div>
                            <div className="text-xs font-mono font-bold text-cyan-400 mt-1.5">
                              {tranche.tranche === 1
                                ? (tranche.triggerPrice ? `₹${tranche.triggerPrice.toLocaleString('en-IN')}` : 'CMP')
                                : tranche.tranche === 2
                                ? analysis.executiveStrategy.whenToInvestAgain?.dipBuy?.levelRange
                                : (analysis.executiveStrategy.whenToInvestAgain?.breakoutBuy?.level ? `Above ₹${analysis.executiveStrategy.whenToInvestAgain.breakoutBuy.level.toLocaleString('en-IN')}` : 'Swing High')}
                            </div>
                            <p className="text-[10px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                              {tranche.triggerDescription}
                            </p>
                          </div>
                          <div className="mt-2.5 pt-2 border-t border-[var(--border-color)] flex items-center justify-between">
                            <span className="text-[9px] text-[var(--text-muted)]">Execution Status</span>
                            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${
                              tranche.status === 'READY' ? 'bg-emerald-500/20 text-emerald-400' :
                              tranche.status === 'ARMED' ? 'bg-amber-500/20 text-amber-400' :
                              'reports-subcard border border-[var(--border-color)] text-[var(--text-muted)]'
                            }`}>
                              {tranche.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Capital Protection, Profit Harvest & Catalyst Triggers */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2 border-t border-[var(--border-color)]">
                    <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2.5">
                      <div className="text-[9px] font-bold text-red-400 uppercase tracking-wide flex items-center justify-between">
                        <span>Capital Invalidation Floor</span>
                        <span className="font-mono text-red-300 font-bold">
                          {analysis.executiveStrategy.riskAndExit?.stopLoss ? `₹${analysis.executiveStrategy.riskAndExit.stopLoss.toLocaleString('en-IN')}` : '50-EMA'}
                          {analysis.executiveStrategy.riskAndExit?.riskPct && ` (${analysis.executiveStrategy.riskAndExit.riskPct})`}
                        </span>
                      </div>
                      <p className="text-[9px] text-[var(--text-secondary)] mt-1 leading-tight">
                        {analysis.executiveStrategy.riskAndExit?.invalidationRule}
                      </p>
                    </div>

                    <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5">
                      <div className="text-[9px] font-bold text-emerald-400 uppercase tracking-wide flex items-center justify-between">
                        <span>Target & Profit Harvest</span>
                        <span className="font-mono text-emerald-300 font-bold">
                          {analysis.executiveStrategy.riskAndExit?.targetPrice ? `₹${analysis.executiveStrategy.riskAndExit.targetPrice.toLocaleString('en-IN')}` : '2.5:1 R:R'}
                          {analysis.executiveStrategy.riskAndExit?.rewardPct && ` (${analysis.executiveStrategy.riskAndExit.rewardPct})`}
                        </span>
                      </div>
                      <p className="text-[9px] text-[var(--text-secondary)] mt-1 leading-tight">
                        {analysis.executiveStrategy.riskAndExit?.profitTakingRule}
                      </p>
                    </div>

                    <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-2.5">
                      <div className="text-[9px] font-bold text-blue-400 uppercase tracking-wide">
                        <span>Earnings Catalyst Milestone</span>
                      </div>
                      <p className="text-[9px] text-[var(--text-secondary)] mt-1 leading-tight">
                        {analysis.executiveStrategy.whenToInvestAgain?.catalystTrigger?.note}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Technical Signals */}
              <div className="reports-subcard rounded-xl p-3 border border-[var(--border-color)]">
                <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <BarChart3 className="w-3.5 h-3.5" /> Technical Signals
                </h4>
                <ul className="space-y-1">
                  {analysis.technicalSignals?.slice(0, 6).map((sig, i) => (
                    <li key={i} className="text-xs text-[var(--text-secondary)] flex items-start gap-1.5">
                      <span className={`mt-0.5 shrink-0 ${sig.includes('✓') ? 'text-emerald-400' : sig.includes('⚠') ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>
                        {sig.includes('✓') ? '✓' : sig.includes('⚠') ? '⚠' : '·'}
                      </span>
                      <span>{sig.replace(' ✓', '').replace(' ⚠', '')}</span>
                    </li>
                  ))}
                </ul>
                {analysis.stopLoss && (
                  <div className="mt-2 pt-2 border-t border-[var(--border-color)] flex items-center justify-between">
                    <span className="text-[10px] text-[var(--text-muted)]">Stop Loss</span>
                    <span className="text-xs font-mono font-semibold text-red-400">₹{analysis.stopLoss?.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {analysis.riskRewardRatio && (
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-[var(--text-muted)]">R:R Ratio</span>
                    <span className={`text-xs font-mono font-semibold ${analysis.riskRewardRatio >= 2 ? 'text-emerald-400' : 'text-amber-400'}`}>{analysis.riskRewardRatio}:1</span>
                  </div>
                )}
                {analysis.targetPrice && (
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-[var(--text-muted)]">Next close pivot estimate</span>
                    <span className="text-xs font-mono font-semibold text-cyan-400">₹{analysis.targetPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                {analysis.weinsteinStageLabel && (
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-[var(--text-muted)]">Weinstein Stage</span>
                    <span className={`text-xs ${analysis.weinsteinStage === 2 ? 'text-emerald-400' : analysis.weinsteinStage === 1 ? 'text-amber-400' : 'text-red-400'}`}>{analysis.weinsteinStageLabel?.split(' (')[0]}</span>
                  </div>
                )}
              </div>

              {/* Fundamentals Detail */}
              <div className="reports-subcard rounded-xl p-3 border border-[var(--border-color)]">
                <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5" /> Fundamentals
                </h4>
                {analysis.fundamentalsStatus !== 'AVAILABLE' ? (
                  <p className="text-xs text-[var(--text-muted)]">{analysis.fundamentalDataReason || 'No current authorized fundamental snapshot is available.'}</p>
                ) : (
                  <div className="space-y-1.5">
                    {Object.entries(analysis.fundamentalBreakdown || {}).map(([key, val]) => (
                      <div key={key} className="flex items-center justify-between">
                        <span className="text-[10px] text-[var(--text-muted)] capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-[var(--text-secondary)]">{val.value}</span>
                          <span className={`text-xs font-bold ${val.pts >= val.max * 0.7 ? 'text-emerald-400' : val.pts >= val.max * 0.4 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>
                            {val.pts}/{val.max}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-[var(--text-muted)] mt-2">Coverage {analysis.fundamentalCoveragePct ?? 0}%. Snapshot status: {analysis.dataQuality || 'UNKNOWN'}.</p>
                {analysis.screenerUrl && (
                  <a href={analysis.screenerUrl} target="_blank" rel="noreferrer"
                    className="mt-2 flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300">
                    <ExternalLink className="w-2.5 h-2.5" /> Screener.in
                  </a>
                )}
              </div>

              {/* Earnings Catalyst & Quarterly Results Detail */}
              {analysis.earningsCatalyst && (
                <div className="reports-subcard rounded-xl p-3 border border-[var(--border-color)]">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-cyan-400" /> Quarterly Results & Catalysts
                    </h4>
                    {analysis.earningsCatalyst.quarterlyResultStatus === 'RESULTS_OUT' ? (
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                        analysis.earningsCatalyst.resultVerdict === 'BLOWOUT_BEAT'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-green-500/15 text-green-300 border border-green-500/25'
                      }`}>
                        {analysis.earningsCatalyst.resultVerdict?.replace('_', ' ')}
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/25">
                        UPCOMING
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5 text-xs">
                    {analysis.earningsCatalyst.quarterlyResultStatus === 'RESULTS_OUT' ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-[var(--text-muted)]">Latest Reported Quarter</span>
                          <span className="font-semibold text-emerald-400">{analysis.earningsCatalyst.latestReportedQuarter}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-[var(--text-muted)]">Announcement Date</span>
                          <span className="font-mono text-[var(--text-secondary)]">
                            {analysis.earningsCatalyst.lastResultDate} {analysis.earningsCatalyst.daysAgo !== null ? `(${analysis.earningsCatalyst.daysAgo}d ago)` : ''}
                          </span>
                        </div>
                        {analysis.earningsCatalyst.lastResultTitle && (
                          <div className="text-[10px] text-[var(--text-secondary)] italic reports-subcard border border-[var(--border-color)] p-1.5 rounded truncate">
                            {analysis.earningsCatalyst.lastResultTitle}
                          </div>
                        )}
                        <div className="grid grid-cols-3 gap-1.5 pt-1 text-center font-mono">
                          <div className="reports-subcard border border-[var(--border-color)] p-1.5 rounded">
                            <div className="text-[9px] text-[var(--text-muted)]">YoY PAT</div>
                            <div className={`text-xs font-bold ${(analysis.yoyPatGrowthPct || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {(analysis.yoyPatGrowthPct || 0) >= 0 ? '+' : ''}{analysis.yoyPatGrowthPct ?? '—'}%
                            </div>
                          </div>
                          <div className="reports-subcard border border-[var(--border-color)] p-1.5 rounded">
                            <div className="text-[9px] text-[var(--text-muted)]">YoY Sales</div>
                            <div className={`text-xs font-bold ${(analysis.yoySalesGrowthPct || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {(analysis.yoySalesGrowthPct || 0) >= 0 ? '+' : ''}{analysis.yoySalesGrowthPct ?? '—'}%
                            </div>
                          </div>
                          <div className="reports-subcard border border-[var(--border-color)] p-1.5 rounded">
                            <div className="text-[9px] text-[var(--text-muted)]">OPM</div>
                            <div className="text-xs font-bold text-cyan-400">
                              {analysis.earningsCatalyst.latestOpmPct ? `${analysis.earningsCatalyst.latestOpmPct}%` : '—'}
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-[var(--text-muted)]">Target Result Date</span>
                          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{analysis.earningsCatalyst.nextResultDate}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-[var(--text-muted)]">Days Away</span>
                          <span className={`font-bold ${(analysis.earningsCatalyst.daysToResult || 0) <= 7 ? 'text-red-400' : (analysis.earningsCatalyst.daysToResult || 0) <= 15 ? 'text-amber-400' : 'text-[var(--text-primary)]'}`}>
                            {analysis.earningsCatalyst.daysToResult !== null ? `${analysis.earningsCatalyst.daysToResult} days` : 'N/A'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-[var(--text-muted)]">Date Status</span>
                          <span className="font-semibold text-[var(--text-secondary)]">{analysis.earningsCatalyst.dateConfidence || 'UNKNOWN'}</span>
                        </div>
                      </>
                    )}

                    {analysis.earningsCatalyst.signalNote && (
                      <p className="text-[10px] text-[var(--text-secondary)] mt-1.5 leading-relaxed reports-subcard p-2 rounded border border-[var(--border-color)]">
                        {analysis.earningsCatalyst.signalNote}
                      </p>
                    )}

                    {/* How to Know Beforehand Decision Support */}
                    {analysis.earningsCatalyst.howToKnowBeforehand && (
                      <div className="mt-2 pt-2 border-t border-[var(--border-color)]">
                        <div className="text-[10px] font-semibold text-purple-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                          <Target className="w-3 h-3" /> Pre/Post Earnings Decision Playbook
                        </div>
                        <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed font-medium mb-1.5">
                          {analysis.earningsCatalyst.howToKnowBeforehand.strategy}
                        </p>
                        <ul className="space-y-0.5">
                          {analysis.earningsCatalyst.howToKnowBeforehand.keyRules?.map((rule, rIdx) => (
                            <li key={rIdx} className="text-[9px] text-[var(--text-muted)] flex items-start gap-1">
                              <span className="text-purple-400 mt-0.5">•</span>
                              <span>{rule}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* News & Corporate Intelligence Panel */}
              <div className="reports-subcard rounded-xl p-3 border border-[var(--border-color)]">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1.5">
                    <Newspaper className="w-3.5 h-3.5 text-cyan-400" /> Corporate & Market Intelligence
                  </h4>
                  {analysis.newsSignal?.articles?.length > 0 && (
                    <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                      analysis.newsSignal.overallSentiment?.includes('POSITIVE')
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : analysis.newsSignal.overallSentiment?.includes('NEGATIVE')
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'reports-subcard border border-[var(--border-color)] text-[var(--text-secondary)]'
                    }`}>
                      {analysis.newsSignal.overallSentiment}
                    </span>
                  )}
                </div>
                {analysis.newsSignal?.articles?.length > 0 ? (
                  <ul className="space-y-2">
                    {analysis.newsSignal.articles.slice(0, 3).map((article, i) => (
                      <li key={i} className="border-b border-[var(--border-color)] pb-2 last:border-0 last:pb-0">
                        <a href={article.link} target="_blank" rel="noreferrer"
                          className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] leading-relaxed line-clamp-2 block">
                          {article.title}
                        </a>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className="text-[9px] text-[var(--text-muted)] font-mono">{article.feedName}</span>
                          {article.signals?.map((sig, j) => (
                            <span key={j} className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${sig.weight > 0 ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/15 text-red-400 border border-red-500/20'}`}>
                              {sig.label} {sig.weight > 0 ? `+${sig.weight}` : sig.weight}
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--text-muted)] py-1">
                    No material corporate filings, order awards, or regulatory disclosures detected in recent RSS & BSE feeds.
                  </p>
                )}
              </div>

              {/* SIP Plan Summary (inline) */}
              {analysis.sipPlan && (
                <div className="reports-subcard rounded-xl p-3 border border-[var(--border-color)] md:col-span-2">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-purple-400" /> Opportunistic SIP Plan
                    </h4>
                    <button
                      onClick={() => onSipPlanClick(analysis)}
                      className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1 cursor-pointer"
                    >
                      <ExternalLink className="w-2.5 h-2.5" /> Full Plan
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {analysis.sipPlan.tranches?.map(t => (
                      <div key={t.tranche} className="reports-subcard border border-[var(--border-color)] rounded-lg p-2">
                        <div className="text-[9px] text-[var(--text-muted)] uppercase">{t.label}</div>
                        <div className="text-xs font-bold text-purple-400 font-mono mt-0.5">{t.amount ? `₹${t.amount.toLocaleString('en-IN')}` : `${Math.round(t.ratio * 100)}% of budget`}</div>
                        <div className="text-[9px] text-[var(--text-muted)] mt-0.5 leading-tight">{t.triggerType === 'IMMEDIATE' ? 'Now' : t.triggerType === 'PRICE_PULLBACK' ? 'On pullback' : 'On 52wk high'}</div>
                        <div className={`text-[9px] mt-1 px-1 py-0.5 rounded text-center ${t.status === 'READY' ? 'bg-emerald-500/20 text-emerald-400' : t.status === 'ARMED' ? 'bg-amber-500/20 text-amber-400' : 'reports-subcard border border-[var(--border-color)] text-[var(--text-muted)]'}`}>
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
function SummaryBar({ summary, onCardClick, activeSignal, activeBadge }) {
  if (!summary) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
      {[
        { label: 'STRONG BUY', value: summary.strongBuyCount, color: 'text-emerald-500 dark:text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', type: 'signal', val: 'STRONG_BUY' },
        { label: 'BUY', value: summary.buyCount, color: 'text-cyan-500 dark:text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20', type: 'signal', val: 'BUY' },
        { label: 'WATCH', value: summary.watchCount, color: 'text-amber-500 dark:text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', type: 'signal', val: 'WATCH' },
        { label: 'AWAITING DATA', value: summary.insufficientDataCount, color: 'text-[var(--text-muted)]', bg: 'bg-[var(--bg-surface)] border-[var(--border-color)]', type: 'signal', val: 'INSUFFICIENT_DATA' },
        { label: 'SIP Plans', value: summary.withSipPlans, color: 'text-purple-500 dark:text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', type: 'badge', val: 'SIP_READY' },
        { label: 'Earnings Dates Soon', value: summary.withEarningsCatalyst, color: 'text-blue-500 dark:text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', type: 'badge', val: 'EARNINGS_SOON' },
      ].map(item => {
        const isActive = (item.type === 'signal' && activeSignal === item.val) || (item.type === 'badge' && activeBadge === item.val);
        return (
          <div
            key={item.label}
            onClick={() => onCardClick && onCardClick(item.type, item.val)}
            className={`reports-subcard border ${item.bg} ${isActive ? 'ring-2 ring-emerald-400/80 shadow-md scale-[1.02]' : ''} rounded-xl p-3 text-center cursor-pointer hover:scale-[1.02] transition-all`}
            title={`Click to filter by ${item.label}`}
          >
            <div className={`text-2xl font-black font-mono ${item.color}`}>{item.value ?? 0}</div>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mt-0.5">{item.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// Module-level client cache for instant 0ms switching across views
let _clientBuyAnalysisCache = null;
export function getClientBuyAnalysisCache() {
  return _clientBuyAnalysisCache;
}

// ─── Main View ────────────────────────────────────────────────────────────────
export default function BuyAnalysisView({ embedded = false, onStatsChange, holdings = [], onSelectHolding }) {
  const [data, setData] = useState(_clientBuyAnalysisCache);
  const [loading, setLoading] = useState(!_clientBuyAnalysisCache);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [signalFilter, setSignalFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [badgeFilter, setBadgeFilter] = useState('ALL');
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
  const [syncingSymbol, setSyncingSymbol] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);

  useEffect(() => {
    let active = true;
    const checkSyncStatus = async () => {
      try {
        const res = await axios.get(`${API_BASE}/buy-analysis/sync-status`);
        if (active && res.data) {
          setSyncStatus(res.data);
        }
      } catch (_) {}
    };
    checkSyncStatus();
    const interval = setInterval(checkSyncStatus, 8000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const handleSyncSymbol = async (symbol) => {
    try {
      setSyncingSymbol(symbol);
      const res = await axios.post(`${API_BASE}/buy-analysis/refresh-fundamentals`, { symbol });
      if (res.data?.analysis) {
        setData(prev => {
          if (!prev) return prev;
          const nextAnalyses = (prev.analyses || []).map(a => a.symbol === symbol ? res.data.analysis : a);
          const nextSummary = res.data.summary || prev.summary;
          const updated = { ...prev, analyses: nextAnalyses, summary: nextSummary };
          _clientBuyAnalysisCache = updated;
          return updated;
        });
        setNotice(`✓ Live data synced for ${symbol}: ${res.data.analysis.buySignal} (Score: ${res.data.analysis.compositeScore})`);
        setTimeout(() => setNotice(''), 4000);
      }
    } catch (err) {
      setNotice(`Failed to sync ${symbol}: ${err.response?.data?.error || err.message}`);
      setTimeout(() => setNotice(''), 4000);
    } finally {
      setSyncingSymbol(null);
    }
  };

  useEffect(() => {
    if (onStatsChange && _clientBuyAnalysisCache?.analyses) {
      const strongBuy = _clientBuyAnalysisCache.analyses.filter(a => a.buySignal === 'STRONG_BUY').length;
      const buy = _clientBuyAnalysisCache.analyses.filter(a => a.buySignal === 'BUY').length;
      const watch = _clientBuyAnalysisCache.analyses.filter(a => a.buySignal === 'WATCH').length;
      onStatsChange({ strongBuy, buy, watch, total: _clientBuyAnalysisCache.analyses.length });
    }
  }, [onStatsChange]);

  const fetchData = useCallback(async (force = false) => {
    try {
      if (!_clientBuyAnalysisCache || force) {
        setLoading(true);
      }
      setError(null);
      const params = new URLSearchParams();
      if (force) params.set('refresh', 'true');
      const res = await axios.get(`${API_BASE}/buy-analysis?${params}`);
      _clientBuyAnalysisCache = res.data;
      setData(res.data);
      if (onStatsChange && res.data?.analyses) {
        const strongBuy = res.data.analyses.filter(a => a.buySignal === 'STRONG_BUY').length;
        const buy = res.data.analyses.filter(a => a.buySignal === 'BUY').length;
        const watch = res.data.analyses.filter(a => a.buySignal === 'WATCH').length;
        onStatsChange({ strongBuy, buy, watch, total: res.data.analyses.length });
      }
    } catch (err) {
      if (!_clientBuyAnalysisCache) {
        setError(err.response?.data?.error || err.message || 'Failed to load buy analysis');
      }
    } finally {
      setLoading(false);
    }
  }, [onStatsChange]);

  useEffect(() => {
    fetchData();
    const timer = setInterval(() => fetchData(true), 15 * 60 * 1000);
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') fetchData(false);
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, [fetchData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await axios.post(`${API_BASE}/buy-analysis/refresh-fundamentals`).catch(() => {});
      await fetchData(true);
    } catch (_) {}
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
    // Badge / Tag filter
    if (badgeFilter !== 'ALL') {
      if (badgeFilter === 'FII_ACCUMULATING') {
        list = list.filter(a => a.qualitativeTags?.some(t => (t.tag || t) === 'FII_ACCUMULATING'));
      } else if (badgeFilter === 'PROMOTER_BUYING') {
        list = list.filter(a => a.qualitativeTags?.some(t => (t.tag || t) === 'PROMOTER_BUYING'));
      } else if (badgeFilter === 'IPO_DEMERGER') {
        list = list.filter(a => a.isIpo || a.qualitativeTags?.some(t => (t.tag || t) === 'NEW_LISTING_OR_DEMERGER'));
      } else if (badgeFilter === 'BLOWOUT_BEAT') {
        list = list.filter(a => a.earningsCatalyst?.resultVerdict === 'BLOWOUT_BEAT');
      } else if (badgeFilter === 'RESULTS_OUT') {
        list = list.filter(a => a.earningsCatalyst?.quarterlyResultStatus === 'RESULTS_OUT');
      } else if (badgeFilter === 'EARNINGS_SOON') {
        list = list.filter(a => (a.earningsCatalyst?.daysToResult !== null && a.earningsCatalyst?.daysToResult >= 0 && a.earningsCatalyst?.daysToResult <= 21) || a.earningsCatalyst?.isPreDriftZone || a.earningsCatalyst?.isConfirmedDate);
      } else if (badgeFilter === 'POSITIVE_NEWS') {
        list = list.filter(a => ['POSITIVE', 'STRONGLY_POSITIVE'].includes(a.newsSignal?.overallSentiment));
      } else if (badgeFilter === 'SIP_READY') {
        list = list.filter(a => Boolean(a.sipPlan));
      } else if (badgeFilter === 'IN_PORTFOLIO') {
        list = list.filter(a => a.inPortfolio);
      } else if (badgeFilter === 'STAGE_2') {
        list = list.filter(a => a.weinsteinStage === 2);
      } else if (badgeFilter === 'EXTENDED_RUNNER') {
        list = list.filter(a => a.executiveStrategy?.stance === 'EXTENDED_RUNNER');
      } else if (badgeFilter === 'PRIME_SETUP') {
        list = list.filter(a => a.executiveStrategy?.stance === 'PRIME_SETUP');
      }
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
  }, [data?.analyses, signalFilter, sourceFilter, badgeFilter, searchQuery, sortBy]);

  const innerContent = (
    <div className={embedded ? "space-y-5" : "p-4 md:p-6 max-w-7xl mx-auto space-y-5"}>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          {!embedded && (
            <h1 className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
              Buy Analysis
            </h1>
          )}
          {data?.generatedAt && (
            <p className="text-xs text-[var(--text-muted)] mt-0.5 flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-emerald-400" />
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
                    className="p-1.5 rounded-lg reports-subcard border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowWatchlistInput(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 text-purple-600 dark:text-purple-400 border border-purple-500/30 text-sm transition-colors cursor-pointer">
                  <PlusCircle className="w-3.5 h-3.5" /> Watchlist
                </button>
              )}
            </div>
            <button
              onClick={handleRefresh}
              disabled={loading || refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg reports-subcard border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Summary Stats */}
        {data?.summary && (
          <SummaryBar
            summary={data.summary}
            activeSignal={signalFilter}
            activeBadge={badgeFilter}
            onCardClick={(type, val) => {
              if (type === 'signal') {
                setSignalFilter(prev => prev === val ? 'ALL' : val);
              } else if (type === 'badge') {
                setBadgeFilter(prev => prev === val ? 'ALL' : val);
              }
            }}
          />
        )}

        {notice && <div className="reports-card border rounded-xl px-4 py-3 text-xs text-[var(--text-secondary)]" style={{ borderColor: 'var(--border-subtle)' }}>{notice}</div>}

        {/* Filters & Search */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Signal filter tabs */}
          <div className="flex items-center gap-1 reports-subcard rounded-xl p-1 border" style={{ borderColor: 'var(--border-subtle)' }}>
            {['ALL', 'STRONG_BUY', 'BUY', 'WATCH', 'INSUFFICIENT_DATA', 'MONITOR'].map(s => (
              <button
                key={s}
                onClick={() => setSignalFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${signalFilter === s
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'}`}
              >
                {s === 'ALL' ? 'All' : s === 'STRONG_BUY' ? 'Strong Buy' : s === 'BUY' ? 'Buy' : s === 'WATCH' ? 'Watch' : s === 'INSUFFICIENT_DATA' ? 'Awaiting Data' : 'Monitor'}
              </button>
            ))}
          </div>

          {/* Source filter */}
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            className="reports-subcard border rounded-lg px-3 py-1.5 text-sm focus:outline-none cursor-pointer"
            style={{ color: 'var(--text-primary)', borderColor: 'var(--border-subtle)' }}
          >
            <option value="ALL">All Sources</option>
            <option value="Chartink Breakout">Chartink Breakouts</option>
            <option value="Portfolio">My Portfolio</option>
            <option value="NSE500">NSE 500</option>
            <option value="Watchlist">Watchlist</option>
          </select>

          {/* Badge / Tag filter */}
          <div className="flex items-center gap-1.5">
            <select
              value={badgeFilter}
              onChange={e => setBadgeFilter(e.target.value)}
              className={`reports-subcard border rounded-lg px-3 py-1.5 text-sm focus:outline-none cursor-pointer ${badgeFilter !== 'ALL' ? 'border-purple-500/50 text-purple-600 dark:text-purple-300 font-semibold' : ''}`}
              style={{ color: badgeFilter !== 'ALL' ? undefined : 'var(--text-primary)', borderColor: badgeFilter !== 'ALL' ? undefined : 'var(--border-subtle)' }}
            >
              <option value="ALL">All Badges & Tags</option>
              <option value="FII_ACCUMULATING">FII Accumulating</option>
              <option value="PROMOTER_BUYING">Promoter Buying</option>
              <option value="IPO_DEMERGER">IPO / Demerger Base</option>
              <option value="EARNINGS_SOON">Earnings Dates Soon</option>
              <option value="BLOWOUT_BEAT">Blowout Q2 Beat</option>
              <option value="RESULTS_OUT">Results Out (Sep 2026)</option>
              <option value="POSITIVE_NEWS">Positive News</option>
              <option value="SIP_READY">SIP Plan Ready</option>
              <option value="IN_PORTFOLIO">In My Portfolio</option>
              <option value="STAGE_2">Stage 2 Bull Runner</option>
              <option value="PRIME_SETUP">Prime Setup (3-Tranche Buy)</option>
              <option value="EXTENDED_RUNNER">Extended Runner (Dip Buy First)</option>
            </select>
            {badgeFilter !== 'ALL' && (
              <button
                onClick={() => setBadgeFilter('ALL')}
                className="px-2 py-1 text-xs rounded reports-subcard border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                title="Reset badge filter"
              >
                Clear
              </button>
            )}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="reports-subcard border rounded-lg px-3 py-1.5 text-sm focus:outline-none cursor-pointer"
            style={{ color: 'var(--text-primary)', borderColor: 'var(--border-subtle)' }}
          >
            <option value="signal">Sort: Signal Strength</option>
            <option value="score">Sort: Composite Score</option>
            <option value="gainPct">Sort: Today's Gain</option>
          </select>

          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search symbol or name..."
              className="w-full reports-subcard border rounded-lg pl-9 pr-8 py-1.5 text-sm focus:outline-none placeholder-[var(--text-muted)]"
              style={{ color: 'var(--text-primary)', borderColor: 'var(--border-subtle)' }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {filteredAnalyses.length > 0 && (
            <span className="text-xs text-[var(--text-muted)]">{filteredAnalyses.length} results</span>
          )}
        </div>

        {/* Content */}
        {loading && !data ? (
          <div className="flex items-center justify-center py-24 text-[var(--text-muted)]">
            <RefreshCw className="w-6 h-6 animate-spin mr-3 text-cyan-400" />
            <span>Running buy analysis across {200}+ stocks...</span>
          </div>
        ) : error ? (
          <div className="reports-card border border-red-500/30 rounded-2xl p-6 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <p className="text-red-400 font-semibold">{error}</p>
            <button onClick={() => fetchData(true)} className="mt-3 px-4 py-2 reports-subcard border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] hover:bg-white/10 text-sm cursor-pointer">Retry</button>
          </div>
        ) : filteredAnalyses.length === 0 ? (
          <div className="reports-card rounded-2xl p-8 text-center text-[var(--text-muted)]">
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
                onSyncSymbol={handleSyncSymbol}
                syncingSymbol={syncingSymbol}
                holdings={holdings}
                onSelectHolding={onSelectHolding}
                onBadgeClick={tag => setBadgeFilter(prev => prev === tag ? 'ALL' : tag)}
              />
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="reports-card rounded-2xl p-4 border" style={{ borderColor: 'var(--border-subtle)' }}>
          <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Signal Guide</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.entries(SIGNAL_CONFIG).map(([key, config]) => (
              <div key={key} className={`${config.bgColor} border ${config.borderColor} rounded-xl p-2.5`}>
                <SignalBadge signal={key} size="sm" />
                <p className="text-[10px] text-[var(--text-muted)] mt-1.5 leading-tight">{config.description}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-[var(--border-color)]">
            <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
              <strong className="text-[var(--text-primary)] font-bold">Scores:</strong> Fundamentals with incomplete or stale coverage are labeled insufficient. Buy states require a close-based setup with an estimated reward/risk of at least 2:1. Strong Buy also requires confirmed volume, valuation, filing, pledge, leverage, and portfolio-risk evidence; missing evidence blocks the label.
              SIP plans are manual, budgeted by the user, and expire for re-evaluation. News and estimated result dates do not independently change a signal.
            </p>
          </div>
        </div>

        {/* SIP Plan Modal */}
        {selectedSipAnalysis && (
          <SipPlanModal
            analysis={selectedSipAnalysis}
            onClose={() => setSelectedSipSymbol(null)}
          />
        )}
      </div>
  );

  if (embedded) {
    return innerContent;
  }

  return (
    <AnimatedPage>
      {innerContent}
    </AnimatedPage>
  );
}
