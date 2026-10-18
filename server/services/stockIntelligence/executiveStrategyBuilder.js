/**
 * executiveStrategyBuilder.js
 * Generates actionable executive investment strategies and staged accumulation roadmaps for all stocks.
 * Answers:
 *   1. "How to go about it" (Immediate execution stance, sizing, whether extended vs prime setup)
 *   2. "When to invest again" (Dip buy levels at 50-EMA, breakout levels, post-earnings triggers, stop-loss invalidation)
 */

export function buildExecutiveStrategy({
  symbol = '',
  name = '',
  buySignal = 'WATCH',
  compositeScore = 50,
  technicalScore = 50,
  fundamentalScore = 50,
  fundamentalGrade = 'C',
  currentPrice = 0,
  high52w = 0,
  ema50 = null,
  sma30w = null,
  weinsteinStage = null,
  weinsteinStageLabel = '',
  stopLoss = null,
  targetPrice = null,
  riskRewardRatio = null,
  pctFromHigh52w = null,
  isIpo = false,
  peRatio = null,
  earningsCatalyst = null,
  newsSignal = null,
  qualitativeTags = [],
  strongBuyBlockers = []
} = {}) {
  const cleanSymbol = String(symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '');
  const curr = Number(currentPrice) || 0;
  const high = Number(high52w) || curr;
  const e50 = Number.isFinite(Number(ema50)) && Number(ema50) > 0 ? Number(Number(ema50).toFixed(2)) : null;
  const s30w = Number.isFinite(Number(sma30w)) && Number(sma30w) > 0 ? Number(Number(sma30w).toFixed(2)) : null;

  // Extension calculations
  const extAbove30w = s30w && curr > 0 ? Number((((curr / s30w) - 1) * 100).toFixed(1)) : null;
  const extAbove50e = e50 && curr > 0 ? Number((((curr / e50) - 1) * 100).toFixed(1)) : null;

  // Extended runner determination
  // A stock is extended if it is >35% above 30w-SMA, or >16% above 50-EMA, or has extreme PE with significant run-up
  const isExtended = (extAbove30w !== null && extAbove30w > 35)
    || (extAbove50e !== null && extAbove50e > 16)
    || (peRatio && peRatio > 80 && extAbove30w !== null && extAbove30w > 25);

  // Invalidation & Target levels
  const safeStop = Number.isFinite(Number(stopLoss)) && Number(stopLoss) > 0
    ? Number(Number(stopLoss).toFixed(2))
    : e50 ? Number((e50 * 0.95).toFixed(2))
    : curr > 0 ? Number((curr * 0.92).toFixed(2))
    : null;

  const safeTarget = Number.isFinite(Number(targetPrice)) && Number(targetPrice) > 0
    ? Number(Number(targetPrice).toFixed(2))
    : high > curr ? Number(high.toFixed(2))
    : safeStop && curr > safeStop ? Number((curr + (curr - safeStop) * 2.5).toFixed(2))
    : curr > 0 ? Number((curr * 1.25).toFixed(2))
    : null;

  const riskPct = safeStop && curr > 0 ? Number((((curr - safeStop) / curr) * 100).toFixed(1)) : null;
  const rewardPct = safeTarget && curr > 0 ? Number((((safeTarget - curr) / curr) * 100).toFixed(1)) : null;

  // Dip buy levels (Pullback zone centered on 50-EMA or base support)
  const supportRef = e50 || (curr > 0 ? Number((curr * 0.93).toFixed(2)) : null);
  const dipLow = supportRef ? Number((supportRef * 0.99).toFixed(2)) : null;
  const dipHigh = supportRef ? Number((supportRef * 1.01).toFixed(2)) : null;
  const dipRangeLabel = dipLow && dipHigh ? `₹${dipLow.toLocaleString('en-IN')} – ₹${dipHigh.toLocaleString('en-IN')}` : '50-EMA Retest';

  // Breakout level (52-week high or swing pivot + 0.5%)
  const breakoutLevel = high > curr ? Number(high.toFixed(2)) : curr > 0 ? Number((curr * 1.035).toFixed(2)) : null;

  // Earnings calendar status
  const daysToResult = earningsCatalyst?.daysToResult;
  const isEarningsImminent = earningsCatalyst?.quarterlyResultStatus === 'UPCOMING'
    && daysToResult !== null && daysToResult !== undefined && daysToResult >= 0 && daysToResult <= 10;
  const hasBlowoutResults = earningsCatalyst?.quarterlyResultStatus === 'RESULTS_OUT' && earningsCatalyst.resultVerdict === 'BLOWOUT_BEAT';

  // Determine Stance & How to go about it
  let stance = 'PRIME_SETUP';
  let stanceLabel = 'Prime Setup · 3-Tranche Accumulation';
  let badgeTheme = 'from-emerald-500 to-green-400';
  let howToGoAboutIt = '';
  let immediateAction = '';

  if (buySignal === 'AVOID' || weinsteinStage === 4) {
    stance = 'CAPITAL_PRESERVATION';
    stanceLabel = 'Capital Protection · No Entry';
    badgeTheme = 'from-red-500 to-rose-400';
    howToGoAboutIt = `Stock in Stage 4 structural decline or governance/debt red flag. Strict capital preservation priority. Zero long exposure recommended until a verified Stage 1 accumulation base forms.`;
    immediateAction = `Preserve capital; avoid new entries until structural base and fundamentals recover.`;
  } else if (buySignal === 'INSUFFICIENT_DATA') {
    stance = 'DATA_INCOMPLETE';
    stanceLabel = 'Insufficient Data · Awaiting Statements';
    badgeTheme = 'from-slate-500 to-slate-400';
    howToGoAboutIt = `Required price series or multi-year financial statements are awaiting exchange updates. Roadmap will compute once statements are cached.`;
    immediateAction = `Awaiting verified exchange data.`;
  } else if (isEarningsImminent) {
    stance = 'PRE_EARNINGS';
    stanceLabel = 'Pre-Earnings · Awaiting Filing';
    badgeTheme = 'from-purple-500 to-indigo-400';
    howToGoAboutIt = `Quarterly earnings scheduled in ${daysToResult} days (${earningsCatalyst?.nextResultDate || 'soon'}). Avoid taking binary risk ahead of the filing. Prepare to accumulate post-results on verified margin expansion and positive guidance.`;
    immediateAction = `Hold off on new entries. Review official Q2 numbers upon filing before deploying capital.`;
  } else if (['STRONG_BUY', 'BUY'].includes(buySignal) && isExtended) {
    stance = 'EXTENDED_RUNNER';
    stanceLabel = 'Extended Runner · Staged Dip Accumulation';
    badgeTheme = 'from-amber-500 to-orange-400';
    const extNote = extAbove30w ? `+${extAbove30w}% above 30w-SMA` : extAbove50e ? `+${extAbove50e}% above 50-EMA` : 'extended from baseline';
    howToGoAboutIt = `High-quality Stage 2 momentum runner (Composite: ${compositeScore}/100, Grade ${fundamentalGrade}), but currently extended (${extNote}). Do NOT enter with an aggressive lump-sum at 52-week highs. Deploy Ladder's 3-tranche opportunistic accumulation: 25-30% initial test allocation at CMP, keeping 70% dry powder for the 50-EMA support retest.`;
    immediateAction = `Deploy 25-30% initial test tranche at CMP ₹${curr.toLocaleString('en-IN')}; maintain 70% dry powder for support pullbacks.`;
  } else if (['STRONG_BUY', 'BUY'].includes(buySignal)) {
    stance = 'PRIME_SETUP';
    stanceLabel = 'Prime Setup · 3-Tranche Accumulation';
    badgeTheme = 'from-emerald-500 to-green-400';
    const rrNote = riskRewardRatio ? `${riskRewardRatio}:1` : '2.5:1';
    howToGoAboutIt = `High-confluence entry setup with favorable reward-to-risk (${rrNote}). Technical structure confirmed above key moving averages with strong fundamentals. Initiate Tranche 1 (30%) at CMP ₹${curr.toLocaleString('en-IN')} with defined capital protection floor at ₹${safeStop?.toLocaleString('en-IN') || 'support'}.`;
    immediateAction = `Initiate Tranche 1 (30% position) at CMP ₹${curr.toLocaleString('en-IN')} with stop-loss at ₹${safeStop?.toLocaleString('en-IN') || 'support'}.`;
  } else {
    // WATCH or MONITOR
    stance = 'BREAKOUT_WATCH';
    stanceLabel = 'Base Consolidation · Awaiting Breakout';
    badgeTheme = 'from-blue-500 to-cyan-400';
    howToGoAboutIt = `Stock is consolidating in a constructive base or approaching resistance. Maintain on active watch list; await a confirmed daily closing breakout above ₹${breakoutLevel?.toLocaleString('en-IN') || 'resistance'} on expanding volume before deploying capital.`;
    immediateAction = `Wait for breakout confirmation. No entry until daily close clears ₹${breakoutLevel?.toLocaleString('en-IN') || 'pivot'} on >1.5x volume.`;
  }

  // Construct Explicit "When to Invest Again" Triggers
  const whenToInvestAgain = {
    immediate: {
      action: immediateAction,
      targetPrice: curr,
      sizing: ['STRONG_BUY', 'BUY'].includes(buySignal) ? '25% - 30% of target budget' : '0% (Wait for trigger)'
    },
    dipBuy: {
      levelRange: dipRangeLabel,
      low: dipLow,
      high: dipHigh,
      trigger: supportRef
        ? `Accumulate Tranche 2 (35%) on an orderly pullback to 50-EMA support zone (${dipRangeLabel}) accompanied by contracting volume and a bullish recovery bounce candle.`
        : 'Accumulate Tranche 2 on confirmed 50-EMA support bounce.'
    },
    breakoutBuy: {
      level: breakoutLevel,
      trigger: breakoutLevel
        ? `Deploy final Tranche 3 (35%) on a decisive daily closing breakout above ₹${breakoutLevel.toLocaleString('en-IN')} accompanied by >1.5x average volume expansion.`
        : 'Deploy final Tranche 3 on confirmed swing-high breakout.'
    },
    catalystTrigger: {
      status: earningsCatalyst?.quarterlyResultStatus || 'UPCOMING',
      note: hasBlowoutResults
        ? `Q2 results delivered blowout beat. Add to position on constructive consolidation above 50-EMA.`
        : daysToResult !== null && daysToResult !== undefined
        ? `Next fundamental buy window: After official results filing (${earningsCatalyst?.nextResultDate || 'in ~' + daysToResult + 'd'}), if YoY PAT exceeds 20% and margins expand.`
        : 'Reassess position sizing after the next quarterly earnings filing.'
    }
  };

  // Capital Protection & Profit Harvest Rules
  const riskAndExit = {
    stopLoss: safeStop,
    riskPct: riskPct !== null ? `-${riskPct}%` : 'N/A',
    invalidationRule: safeStop
      ? `Hard invalidation: Exit cleanly on a daily close below ₹${safeStop.toLocaleString('en-IN')} (-${riskPct}%), neutralizing the bullish thesis.`
      : 'Maintain trailing stop below 50-EMA support.',
    targetPrice: safeTarget,
    rewardPct: rewardPct !== null ? `+${rewardPct}%` : 'N/A',
    profitTakingRule: safeTarget
      ? `Harvest 30-50% partial profits at ₹${safeTarget.toLocaleString('en-IN')} (+${rewardPct}%); trail remaining balance along the rising 50-EMA.`
      : 'Harvest partial gains at +20%; trail remaining balance with 50-EMA.'
  };

  // 3-Tranche Staged Accumulation Roadmap
  const tranches = [
    {
      tranche: 1,
      label: 'Tranche 1: Initial / Pilot Entry',
      ratio: 0.30,
      pctLabel: '30% of Budget',
      triggerType: isExtended ? 'PILOT_TEST' : 'ENTRY_CONFIRMATION',
      triggerPrice: curr,
      triggerDescription: isExtended
        ? `Initiate small 25-30% pilot position at CMP ₹${curr.toLocaleString('en-IN')} to establish exposure without chasing highs.`
        : `Execute initial entry at CMP ₹${curr.toLocaleString('en-IN')} with defined stop-loss invalidation level.`,
      status: ['STRONG_BUY', 'BUY'].includes(buySignal) ? 'READY' : 'WATCH'
    },
    {
      tranche: 2,
      label: 'Tranche 2: 50-EMA Dip Buy',
      ratio: 0.35,
      pctLabel: '35% of Budget',
      triggerType: 'SUPPORT_RETEST',
      triggerPriceRange: dipLow && dipHigh ? { low: dipLow, high: dipHigh } : null,
      triggerDescription: supportRef
        ? `Accumulate on orderly pullback into 50-EMA support zone (${dipRangeLabel}) with confirmed rebound.`
        : 'Accumulate on 50-EMA support retest with confirmed rebound.',
      status: 'ARMED'
    },
    {
      tranche: 3,
      label: 'Tranche 3: Continuation Breakout',
      ratio: 0.35,
      pctLabel: '35% of Budget',
      triggerType: 'MOMENTUM_BREAKOUT',
      triggerPrice: breakoutLevel,
      triggerDescription: breakoutLevel
        ? `Deploy final tranche on high-volume breakout close above ₹${breakoutLevel.toLocaleString('en-IN')}.`
        : 'Deploy final tranche on confirmed swing-high breakout.',
      status: 'CONTINGENT'
    }
  ];

  return {
    symbol: cleanSymbol,
    name,
    buySignal,
    compositeScore,
    technicalScore,
    fundamentalScore,
    fundamentalGrade,
    currentPrice: curr,
    high52w: high,
    ema50: e50,
    sma30w: s30w,
    isExtended,
    extAbove30w,
    extAbove50e,
    stance,
    stanceLabel,
    badgeTheme,
    howToGoAboutIt,
    whenToInvestAgain,
    riskAndExit,
    tranches,
    generatedAt: new Date().toISOString()
  };
}
