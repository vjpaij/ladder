/**
 * buyAnalysisService.js
 * Core Buy Signal Engine — mirrors analysisService.js but for entries.
 *
 * Signal Classification:
 *   WATCH       → TechScore ≥ 40 OR FundScore ≥ 50 (one pillar strong)
 *   BUY         → TechScore ≥ 55 AND FundScore ≥ 55 (dual-pillar confluence)
 *   STRONG_BUY  → dual-pillar confluence plus complete data and risk gates
 *
 * STRONG_BUY additionally requires:
 *   - Weinstein Stage 2 confirmed
 *   - Volume breakout confirmed
 *   - EPS rising for 3+ quarters
 *   - D/E ≤ 1.0
 *   - No promoter pledging > 10%
 *   - R:R ≥ 2.5:1
 */

import { analyzeTechnicalTrend, normalizePriceSeries } from './technicalIndicators.js';
import { computeFundamentalScore } from './fundamentalScorer.js';
import { applyChartinkFilter } from './buyUniverseProvider.js';
import { computeEarningsCatalyst } from './earningsCatalystService.js';
import { shouldGenerateSipPlan, buildSipPlan } from './sipPositionBuilder.js';
import { buildExecutiveStrategy } from './executiveStrategyBuilder.js';

const BUY_ANALYSIS_VERSION = 'buy-analysis-v1.0';

/**
 * Calculates a technical buy score for a stock.
 * Separate from the Sell Analysis technical logic — focuses on ENTRY signals.
 *
 * @param {Object} trendData - from analyzeTechnicalTrend
 * @param {Object} chartinkFilter - from applyChartinkFilter
 * @param {number} currentPrice
 * @param {number} high52w
 * @returns {{ score: number, signals: string[], stopLoss: number|null, rrRatio: number|null }}
 */
function findCloseResistance(prices = [], currentPrice = 0) {
  const closes = prices.slice(-252).map(row => Number(row.close)).filter(Number.isFinite);
  const pivots = [];
  for (let i = 1; i < closes.length - 1; i += 1) {
    if (closes[i] >= closes[i - 1] && closes[i] > closes[i + 1] && closes[i] > currentPrice) pivots.push(closes[i]);
  }
  return pivots.length ? Math.min(...pivots) : null;
}

function computeTechnicalBuyScore(trendData = {}, chartinkFilter = {}, currentPrice = 0, high52w = 0, prices = []) {
  let score = 0;
  const signals = [];

  // 1. Core Trend Foundation: Stan Weinstein Stage Structure (up to 30 pts)
  if (trendData.weinsteinStage === 2) {
    score += 30;
    signals.push('Stage 2 Bull confirmed (Institutional Markup) ✓');
  } else if (trendData.weinsteinStage === 1) {
    score += 18;
    signals.push('Stage 1 Accumulation Base (Early Entry Setup) ✓');
  } else if (trendData.weinsteinStage === 3) {
    score -= 15;
    signals.push('⚠ Stage 3 Distribution Top — exercise caution');
  } else if (trendData.weinsteinStage === 4) {
    score -= 30;
    signals.push('⚠ Stage 4 Structural Downtrend — avoid long entry');
  }

  // Adaptive IPO Base setup
  if (trendData?.isIpo) {
    if (trendData.weinsteinStage === 2) {
      score += 30;
      signals.push('New Listing / Demerger Base Breakout confirmed ✓');
    } else if (trendData.weinsteinStage === 1) {
      score += 18;
      signals.push('Consolidating in Base (New Listing / Demerger) ✓');
    }
    if (Number.isFinite(trendData.drawdownFrom20WeekHighPct) && trendData.drawdownFrom20WeekHighPct >= -10) {
      score += 20;
      signals.push('Within 10% of post-listing all-time high ✓');
    }
  }

  // 2. Moving Average Alignment: 50-EMA & 30-Week SMA (up to 25 pts)
  const ema50 = chartinkFilter?.ema50;
  if (ema50 && currentPrice > ema50) {
    const emaBuffer = ((currentPrice / ema50) - 1) * 100;
    score += 15;
    signals.push(`Trading above 50-EMA (+${emaBuffer.toFixed(1)}%) ✓`);
  }
  if (trendData.sma30Week && currentPrice > trendData.sma30Week) {
    score += 10;
    signals.push('Trading above 30-week institutional SMA ✓');
  }

  // 3. Slope & Trend Momentum (up to 20 pts)
  if (Number.isFinite(trendData.sma30WeekFourWeekSlopePct)) {
    if (trendData.sma30WeekFourWeekSlopePct > 1.0) {
      score += 12;
      signals.push(`30-week SMA rising strongly (+${Number(trendData.sma30WeekFourWeekSlopePct).toFixed(1)}%/4w) ✓`);
    } else if (trendData.sma30WeekFourWeekSlopePct > 0) {
      score += 6;
      signals.push('30-week SMA upward sloping ✓');
    }
  }

  // 4. Proximity to 52-Week / 20-Week Highs (up to 15 pts)
  if (Number.isFinite(trendData.drawdownFrom20WeekHighPct)) {
    const drawdown = trendData.drawdownFrom20WeekHighPct;
    if (drawdown >= -5) {
      score += 15;
      signals.push(`At/near 20-week momentum high (${Number(drawdown).toFixed(1)}%) ✓`);
    } else if (drawdown >= -15) {
      score += 8;
      signals.push(`Within 15% consolidation of recent high ✓`);
    }
  }

  // 5. Chandelier Volatility Floor (up to 10 pts)
  if (trendData.chandelierStopPrice && currentPrice > trendData.chandelierStopPrice) {
    const buffer = ((currentPrice / trendData.chandelierStopPrice) - 1) * 100;
    if (Number.isFinite(buffer) && buffer >= 5) {
      score += 10;
      signals.push(`${buffer.toFixed(1)}% buffer above Chandelier stop floor ✓`);
    }
  }

  // 6. Chartink Fresh Breakout Confirmation (Bonus: +10 pts)
  if (chartinkFilter.passes) {
    score += 10;
    signals.push('Chartink 50-EMA Volume/Price Breakout confirmed ✓');
  } else if (chartinkFilter.activeFilterStatus?.emaBufferPass) {
    score += 5;
    signals.push('Holding above 50-EMA (+3% buffer) ✓');
  }

  const stopLoss = trendData.chandelierStopPrice || trendData.trailingFloorPrice || (currentPrice > 0 ? Number((currentPrice * 0.93).toFixed(2)) : null);
  const risk = Number.isFinite(Number(stopLoss)) && currentPrice > Number(stopLoss) ? currentPrice - Number(stopLoss) : (currentPrice * 0.07);

  // In swing/momentum trading, target price is either:
  // 1) 52-week high if it offers substantial upside (>= 1.5x risk)
  // 2) Or standard 2.5x risk projection for Stage 2 breakouts / all-time high runners
  let targetPrice = null;
  if (Number.isFinite(Number(high52w)) && Number(high52w) >= currentPrice + risk * 1.5) {
    targetPrice = Number(Number(high52w).toFixed(2));
  } else if (risk > 0) {
    targetPrice = Number((currentPrice + risk * 2.5).toFixed(2));
  }
  const rrRatio = targetPrice && risk > 0
    ? Number(((targetPrice - currentPrice) / risk).toFixed(2)) : 2.5;

  return {
    score: Math.min(100, Math.max(0, score)),
    signals: [...new Set(signals)], // deduplicate
    stopLoss: Number.isFinite(Number(stopLoss)) ? Number(Number(stopLoss).toFixed(2)) : null,
    targetPrice,
    rrRatio
  };
}

/**
 * Determines the final buy signal classification.
 *
 * @param {number} techScore
 * @param {Object} fundResult
 * @param {Object} trendData
 * @param {Object} fundamentals
 * @param {Object} earningsCatalyst
 * @param {Object} newsSignal
 * @param {boolean} hasGovernanceRedFlag
 * @param {number} rrRatio
 * @param {boolean} volumeConfirmed
 * @param {Object} chartinkFilter
 * @returns {{ signal: string, reason: string, isStrongBuyEligible: boolean }}
 */
function classifyBuySignal(techScore, fundResult, trendData, fundamentals, earningsCatalyst, newsSignal, hasGovernanceRedFlag, rrRatio, volumeConfirmed, chartinkFilter) {
  const fundScore = fundResult.score;
  // Governance red flag overrides everything
  if (hasGovernanceRedFlag) {
    return {
      signal: 'AVOID',
      reason: 'Governance red flag detected (high promoter pledge or extreme debt). Capital preservation priority.',
      isStrongBuyEligible: false
    };
  }

  // Critical news red flag
  if (newsSignal?.hasVerifiedCriticalRedFlag) {
    return {
      signal: 'AVOID',
      reason: `Critical negative news: ${newsSignal.articles?.find(a => a.hasCriticalRedFlag)?.title || 'See news panel'}.`,
      isStrongBuyEligible: false
    };
  }

  // Downtrend (Stage 4) — not a buy
  if (trendData.weinsteinStage === 4) {
    return {
      signal: 'AVOID',
      reason: 'Stock in Stage 4 structural decline — wait for Stage 1 base before considering entry.',
      isStrongBuyEligible: false
    };
  }

  // Insufficient data
  if (trendData.state === 'DATA_UNAVAILABLE' || !fundResult.isValid) {
    return {
      signal: 'INSUFFICIENT_DATA',
      reason: fundResult.reason || 'Insufficient price or fundamental history for evaluation.',
      isStrongBuyEligible: false
    };
  }

  const currentPrice = chartinkFilter?.currentPrice || 0;
  // Dynamic setup eligibility: Stage 2 Bull, Stage 1 Base Breakout, 50-EMA support, or Blowout earnings
  const isSetupEligible = trendData.weinsteinStage === 2
    || (trendData.weinsteinStage === 1 && (trendData.drawdownFrom20WeekHighPct >= -15 || currentPrice >= (chartinkFilter?.high52w || 0) * 0.85))
    || (currentPrice > (chartinkFilter?.ema50 || 0) && techScore >= 50)
    || (trendData.isIpo && trendData.weinsteinStage <= 2)
    || (earningsCatalyst?.quarterlyResultStatus === 'RESULTS_OUT' && earningsCatalyst?.resultVerdict === 'BLOWOUT_BEAT')
    || chartinkFilter.passes;

  if (!isSetupEligible) {
    return { signal: 'WATCH', reason: 'Setup consolidating: awaiting Stage 2 confirmation, 50-EMA recovery, or breakout catalyst.', isStrongBuyEligible: false };
  }

  const hasBuyScore = (techScore >= 55 && fundScore >= 55)
    || (techScore >= 70 && fundScore >= 40)
    || (fundScore >= 70 && techScore >= 40);

  if (hasBuyScore && fundResult.valuationCheck?.status === 'FAIL') {
    return {
      signal: 'WATCH',
      reason: `Valuation check failed (${fundResult.valuationCheck.reason}); waiting for earnings expansion before buy entry.`,
      isStrongBuyEligible: false
    };
  }

  // STRONG BUY — Dual-pillar excellence, Stage 2 Bull, favorable R:R, no red flags
  const isStrongBuyTech = techScore >= 65 && (trendData.weinsteinStage === 2 || (trendData.isIpo && trendData.weinsteinStage <= 2));
  const isStrongBuyFund = fundScore >= 68;
  const isStrongBuyRR = Number.isFinite(rrRatio) && rrRatio >= 2.0;
  const epsHistory = Array.isArray(fundamentals.annualEps) ? fundamentals.annualEps.map(Number) : [];
  const epsRising = epsHistory.length < 3 || epsHistory.slice(-3).every((value, index, rows) => index === 0 || value >= rows[index - 1]);
  const pledgeAcceptable = !Number.isFinite(Number(fundamentals.promoterPledgePct)) || Number(fundamentals.promoterPledgePct) <= 15;
  const debtAcceptable = fundResult.financialSector || !Number.isFinite(Number(fundamentals.debtToEquity)) || Number(fundamentals.debtToEquity) <= 1.2;
  const valuationAcceptable = fundResult.valuationCheck?.status !== 'FAIL';
  const hasBlowoutResults = earningsCatalyst?.quarterlyResultStatus === 'RESULTS_OUT' && earningsCatalyst.resultVerdict === 'BLOWOUT_BEAT';
  const earningsCaution = earningsCatalyst?.quarterlyResultStatus === 'UPCOMING'
    && earningsCatalyst?.daysToResult !== null
    && earningsCatalyst.daysToResult >= 0 && earningsCatalyst.daysToResult <= 7;

  if (
    ((isStrongBuyTech && isStrongBuyFund) || (hasBlowoutResults && techScore >= 60 && fundScore >= 65))
    && isStrongBuyRR && pledgeAcceptable && debtAcceptable && valuationAcceptable
    && !hasGovernanceRedFlag && !earningsCaution
  ) {
    const reason = `High confluence setup: Technical (${techScore}/100, Stage 2 Bull) + Fundamental (${fundScore}/100, Grade ${fundResult.fundamentalGrade}). Estimated R:R ${rrRatio}:1.${hasBlowoutResults ? ' Q2 results blowout beat confirmed.' : ''}`;
    return { signal: 'STRONG_BUY', reason, isStrongBuyEligible: true };
  }

  // BUY — dual pillar at standard threshold
  if (
    ((techScore >= 55 && fundScore >= 55) || (techScore >= 70 && fundScore >= 45) || (fundScore >= 70 && techScore >= 45))
    && Number.isFinite(rrRatio) && rrRatio >= 2.0 && valuationAcceptable
  ) {
    let reason = `Dual-pillar confluence: Technical ${techScore}/100 + Fundamental ${fundScore}/100 with estimated R:R ${rrRatio}:1.`;
    if (earningsCatalyst?.quarterlyResultStatus === 'RESULTS_OUT') {
      reason += ` Latest results OUT (${earningsCatalyst.resultVerdict}).`;
    } else if (earningsCaution) {
      reason += ` Result date is ${earningsCatalyst.daysToResult} days away; consider staging entry.`;
    }
    return { signal: 'BUY', reason, isStrongBuyEligible: false };
  }

  if (techScore >= 55 && fundScore >= 55 && (!Number.isFinite(rrRatio) || rrRatio < 2)) {
    return {
      signal: 'WATCH',
      reason: 'Both evidence scores are positive, but resistance setup does not yet establish at least 2:1 estimated reward/risk.',
      isStrongBuyEligible: false
    };
  }

  // WATCH — one pillar ready
  if (techScore >= 40 || fundScore >= 50) {
    const readyPillar = techScore >= 40 ? `Technical (${techScore}/100)` : `Fundamental (${fundScore}/100)`;
    return {
      signal: 'WATCH',
      reason: `${readyPillar} is ready. Waiting for second pillar to confirm before full entry.`,
      isStrongBuyEligible: false
    };
  }

  return {
    signal: 'MONITOR',
    reason: `Tech ${techScore}/100 + Fund ${fundScore}/100. Both pillars below thresholds. Continue monitoring.`,
    isStrongBuyEligible: false
  };
}

/**
 * Generates a human-readable explanation for the buy signal.
 */
function buildExplanation(analysis) {
  const { buySignal, technicalScore, fundamentalScore, earningsCatalyst, newsSignal } = analysis;
  const lines = [];

  if (buySignal === 'STRONG_BUY') {
    lines.push(`STRONG BUY — High technical and fundamental evidence (Tech: ${technicalScore}/100, Fund: ${fundamentalScore}/100).`);
    lines.push('Position size is not implied by this label; apply portfolio risk, concentration, cash, and liquidity limits.');
  } else if (buySignal === 'BUY') {
    lines.push(`BUY — Evidence meets the entry threshold (Tech: ${technicalScore}/100, Fund: ${fundamentalScore}/100).`);
    lines.push('Set size from a user-approved risk budget.');
  } else if (buySignal === 'WATCH') {
    lines.push(`🟡 WATCH — Developing setup. Monitor for second-pillar confirmation before committing capital.`);
  } else if (buySignal === 'AVOID') {
    lines.push(`🔴 AVOID — Risk flags detected. Capital preservation priority.`);
  } else {
    lines.push(`⚪ MONITOR — Below signal thresholds. No action required.`);
  }

  if (earningsCatalyst?.isPreDriftZone) {
    lines.push(`\nResult date ${earningsCatalyst.dateConfidence?.toLowerCase() || 'unknown'}: ${earningsCatalyst.daysToResult} days away. ${earningsCatalyst.signalNote || ''}`);
  }

  if (newsSignal?.articles?.length > 0 && newsSignal.overallSentiment !== 'NEUTRAL') {
    const sentiment = newsSignal.overallSentiment.includes('POSITIVE') ? '✓ Positive' : '⚠ Negative';
    lines.push(`\n📰 News: ${sentiment} (${newsSignal.articleCount} relevant articles, net signal: ${newsSignal.netSignalWeight > 0 ? '+' : ''}${newsSignal.netSignalWeight})`);
  }

  return lines.join(' ');
}

/**
 * Main function: builds buy analyses for a list of candidate stocks.
 *
 * @param {Array} candidates - from buildCandidateUniverse()
 * @param {Object} historicalPriceMap - symbol → { date: price }
 * @param {Object} fundamentalsMap - symbol → fundamentals object
 * @param {Object} earningsCatalystsMap - symbol → earningsCatalyst
 * @param {Object} newsSignalsMap - symbol → newsSignal (optional, may be empty)
 * @param {Object} opts - { today, maxResults, includeSipPlans }
 * @returns {Array} buy analyses sorted by signal strength + score
 */
export function buildBuyAnalyses(
  candidatesOrOpts = [],
  historicalPriceMap = {},
  fundamentalsMap = {},
  earningsCatalystsMap = {},
  newsSignalsMap = {},
  options = {}
) {
  let candidates = candidatesOrOpts;
  let historyMap = historicalPriceMap;
  let fundMap = fundamentalsMap;
  let catalystsMap = earningsCatalystsMap;
  let newsMap = newsSignalsMap;
  let opts = options;

  if (!Array.isArray(candidatesOrOpts) && typeof candidatesOrOpts === 'object') {
    const o = candidatesOrOpts;
    candidates = o.candidates || (o.holdings || []).map(h => ({
      symbol: h.symbol,
      name: h.name,
      source: 'Portfolio',
      inPortfolio: true,
      portfolioQuantity: h.quantity,
      portfolioAvgPrice: h.avg_price || h.current_price
    }));
    historyMap = o.priceHistory || o.historicalPriceMap || {};
    fundMap = o.fundamentalsCache || o.fundamentalsMap || {};
    catalystsMap = o.earningsCatalystsMap || {};
    newsMap = o.newsSignalsMap || {};
    opts = {
      today: o.today,
      maxResults: o.maxResults,
      includeSipPlans: o.includeSipPlans,
      sellAnalyses: o.sellAnalyses,
      excludedSymbols: o.excludedSymbols
    };
  }

  const todayStr = opts.today || new Date().toISOString().slice(0, 10);
  const results = [];

  // Index stocks flagged for exit or trim in Sell Analysis to guarantee 100% mutual exclusivity
  const sellFlaggedSymbols = new Set();
  if (Array.isArray(opts.sellAnalyses)) {
    for (const s of opts.sellAnalyses) {
      if (['FULL_EXIT', 'REVIEW_PARTIAL_SALE', 'REVIEW_FUNDAMENTAL_TRIM', 'REVIEW_RISK_TRIM'].includes(s.action) ||
          ['FULL_EXIT_CANDIDATE', 'TECHNICAL_TRIM_CANDIDATE', 'FUNDAMENTAL_TRIM_CANDIDATE', 'PORTFOLIO_RISK_TRIM'].includes(s.state) ||
          Boolean(s.stopFloorBreached) || Boolean(s.has4RedBreakdown)) {
        sellFlaggedSymbols.add(String(s.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, ''));
      }
    }
  }
  if (Array.isArray(opts.excludedSymbols)) {
    for (const sym of opts.excludedSymbols) {
      sellFlaggedSymbols.add(String(sym || '').toUpperCase().replace(/\.(NS|BO)$/i, ''));
    }
  }

  for (const candidate of (candidates || [])) {
    try {
      const { symbol, name, source, inPortfolio, portfolioQuantity, portfolioAvgPrice } = candidate;
      const clean = String(symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');

      // Strictly exclude any stock currently flagged for FULL_EXIT or REVIEW_PARTIAL_SALE in Sell Analysis.
      // 100% mutual exclusivity: No stock may EVER appear in both Buy Analysis and Sell Analysis at the same time.
      if (sellFlaggedSymbols.has(clean)) {
        continue;
      }
      const fundObj = fundMap[clean] || fundMap[symbol] || {};
      const resolvedName = (name && name !== clean) ? name : (fundObj.name || name || clean);

      // Get raw price series for this symbol
      const rawSeries = historyMap[symbol]
        || historyMap[clean]
        || historyMap[`${clean}.NS`]
        || historyMap[`${clean}.BO`]
        || {};

      const prices = normalizePriceSeries(rawSeries).filter(row => row.date <= todayStr);
      const currentPrice = prices.length > 0 ? prices[prices.length - 1].close : 0;

      if (currentPrice <= 0) {
        results.push({
          symbol: clean,
          name: resolvedName,
          source,
          inPortfolio: Boolean(inPortfolio),
          portfolioQuantity: inPortfolio ? Number(portfolioQuantity) || 0 : 0,
          currentPrice: null,
          technicalScore: 0,
          fundamentalScore: 0,
          compositeScore: 0,
          buySignal: 'INSUFFICIENT_DATA',
          signalReason: 'No current authorized price history is available for this candidate.',
          isStrongBuyEligible: false,
          strongBuyBlockers: ['Current price history unavailable'],
          fundamentalsStatus: (fundMap[clean] || fundMap[symbol] || {}).status || 'UNAVAILABLE',
          fundamentalDataValid: false,
          fundamentalCoveragePct: 0,
          fundamentalDataReason: 'Price history unavailable; fundamentals cannot be evaluated as a buy setup.',
          technicalSignals: [],
          qualitativeTags: [],
          earningsCatalyst: catalystsMap[clean] || null,
          newsSignal: newsMap[clean] || null,
          sipPlan: null,
          executiveStrategy: null,
          ruleVersion: BUY_ANALYSIS_VERSION,
        isIpo: false,
          evaluatedAt: todayStr,
          dataQuality: 'INCOMPLETE'
        });
        continue;
      }

      // Compute 52-week high from price history
      const last252 = prices.slice(-252);
      const high52w = last252.length > 0 ? Math.max(...last252.map(p => p.close)) : currentPrice;

      // Technical trend analysis (reusing existing engine with adaptive IPO Base support)
      const priceSeriesAsOf = Object.fromEntries(prices.map(row => [row.date, row.close]));
      let trendData = analyzeTechnicalTrend(priceSeriesAsOf, { today: todayStr });
      const isIpoListing = prices.length >= 15 && (trendData.state === 'DATA_UNAVAILABLE' || prices.length < 200);

      if (isIpoListing && trendData.state === 'DATA_UNAVAILABLE') {
        const ipoCloses = prices.map(p => p.close);
        const ipoHigh = Math.max(...ipoCloses);
        const ipoLow = Math.min(...ipoCloses);
        const drawdownFromHigh = ((currentPrice / ipoHigh) - 1) * 100;
        const isNearHighs = drawdownFromHigh >= -12;
        const isConsolidating = currentPrice >= ipoLow * 1.05;
        const weinsteinStage = isNearHighs ? 2 : isConsolidating ? 1 : 4;

        trendData = {
          state: 'NORMAL',
          isIpo: true,
          dailyObservations: prices.length,
          weinsteinStage,
          weinsteinStageLabel: isNearHighs ? 'Stage 2 (Base Breakout · New Listing / Demerger)' : isConsolidating ? 'Stage 1 (Base Consolidation · New Listing / Demerger)' : 'Stage 4 (Base Breakdown)',
          drawdownFrom20WeekHighPct: drawdownFromHigh,
          chandelierStopPrice: Math.max(ipoLow, Number((currentPrice * 0.92).toFixed(2))),
          sma30Week: null,
          evidence: ['Adaptive IPO Base evaluated from post-listing trading history']
        };
      }
      const latestPriceAgeDays = Math.floor((Date.parse(`${todayStr}T00:00:00Z`)
        - Date.parse(`${prices[prices.length - 1].date}T00:00:00Z`)) / 86400000);

      const fundamentals = fundMap[clean] || fundMap[symbol] || {};
      // Chartink active conditions are evaluated separately from the company-quality score.
      const chartinkFilter = applyChartinkFilter(historyMap, symbol, fundamentals, { asOfDate: todayStr });

      // Technical buy score
      const techResult = computeTechnicalBuyScore(trendData, chartinkFilter, currentPrice, high52w, prices);

      // Fundamental score
      const fundResult = computeFundamentalScore(fundamentals);

      // Earnings catalyst
      const earningsCatalyst = catalystsMap[clean] || computeEarningsCatalyst(clean, fundamentals, todayStr);

      // News signals
      const newsSignal = newsMap[clean] || null;

      // Signal classification
      const volumeConfirmed = chartinkFilter.volumeConfirmed === true;
      const preliminary = classifyBuySignal(
        techResult.score,
        fundResult,
        trendData,
        fundamentals,
        earningsCatalyst,
        newsSignal,
        fundResult.hasGovernanceRedFlag,
        techResult.rrRatio,
        volumeConfirmed,
        chartinkFilter
      );
      const { signal, reason, isStrongBuyEligible } = latestPriceAgeDays > 45
        ? { signal: 'INSUFFICIENT_DATA', reason: `Latest cached close is ${latestPriceAgeDays} days old.`, isStrongBuyEligible: false }
        : preliminary;
      const recentEps = Array.isArray(fundamentals.annualEps) ? fundamentals.annualEps.slice(-4).map(Number) : [];
      const strongBuyBlockers = [
        !(Number.isFinite(techResult.rrRatio) && techResult.rrRatio >= 2.0) ? 'Estimated reward/risk below 2.0:1 or unavailable' : null,
        trendData.weinsteinStage !== 2 ? 'Stage 2 Bull trend structure not confirmed' : null,
        fundResult.score < 70 ? 'Fundamental score below 70 threshold' : null,
        Number.isFinite(Number(fundamentals.promoterPledgePct)) && Number(fundamentals.promoterPledgePct) > 15 ? 'Promoter pledge exceeds 15% safety limit' : null,
        !fundResult.financialSector && Number.isFinite(Number(fundamentals.debtToEquity)) && Number(fundamentals.debtToEquity) > 1.2 ? 'Leverage exceeds 1.2 D/E safety threshold' : null,
        fundResult.valuationCheck?.status === 'FAIL' ? 'Valuation check failed' : null,
        earningsCatalyst?.daysToResult >= 0 && earningsCatalyst.daysToResult <= 15 ? 'Earnings announcement is within 15 days' : null
      ].filter(Boolean);

      // SIP plan (only for BUY and STRONG_BUY)
      let sipPlan = null;
      if (opts.includeSipPlans !== false && shouldGenerateSipPlan({ buySignal: signal, fundamentalScore: fundResult.score, fundamentalDataValid: fundResult.isValid }, earningsCatalyst)) {
        sipPlan = buildSipPlan({
          symbol: clean,
          name: resolvedName,
          buySignal: signal,
          currentPrice,
          ema50: chartinkFilter.ema50,
          sma30w: trendData.sma30Week,
          high52w,
          fundamentalScore: fundResult.score,
          technicalScore: techResult.score,
          earningsCatalyst,
          fundamentals,
          stopLoss: techResult.stopLoss,
          targetPrice: techResult.targetPrice,
          riskRewardRatio: techResult.rrRatio
        });
      }

      // Executive Investment Strategy & When to Invest Again Roadmap (computed for all stocks)
      const executiveStrategy = buildExecutiveStrategy({
        symbol: clean,
        name: resolvedName,
        buySignal: signal,
        compositeScore: Math.round((techResult.score + fundResult.score) / 2),
        technicalScore: techResult.score,
        fundamentalScore: fundResult.score,
        fundamentalGrade: fundResult.fundamentalGrade,
        currentPrice,
        high52w,
        ema50: chartinkFilter.ema50,
        sma30w: trendData.sma30Week,
        weinsteinStage: trendData.weinsteinStage,
        weinsteinStageLabel: trendData.weinsteinStageLabel,
        stopLoss: techResult.stopLoss,
        targetPrice: techResult.targetPrice,
        riskRewardRatio: techResult.rrRatio,
        pctFromHigh52w: chartinkFilter.pctFromHigh52w,
        isIpo: Boolean(trendData?.isIpo || fundResult?.isIpo),
        peRatio: fundamentals.peRatio || null,
        earningsCatalyst,
        newsSignal,
        qualitativeTags: fundResult.tags,
        strongBuyBlockers
      });

      const analysis = {
        // Identity
        symbol: clean,
        name: resolvedName,
        source,
        sector: fundamentals.sector || 'Unknown',
        industry: fundamentals.industry || 'Unknown',
        inPortfolio,
        portfolioQuantity: inPortfolio ? portfolioQuantity : 0,
        portfolioAvgPrice: inPortfolio ? portfolioAvgPrice : 0,

        // Scores
        technicalScore: techResult.score,
        fundamentalScore: fundResult.score,
        compositeScore: Math.round((techResult.score + fundResult.score) / 2),
        fundamentalGrade: fundResult.fundamentalGrade,
        fundamentalCoveragePct: fundResult.coveragePct,
        fundamentalDataValid: fundResult.isValid,
        fundamentalDataReason: fundResult.reason,
        fundamentalDataFresh: fundResult.freshness,
        dataQuality: fundResult.isValid ? 'CURRENT_SNAPSHOT' : 'INCOMPLETE',

        // Signal
        buySignal: signal,
        signalReason: reason,
        isStrongBuyEligible,
        strongBuyBlockers,
        ruleVersion: BUY_ANALYSIS_VERSION,
        isIpo: Boolean(trendData?.isIpo || fundResult?.isIpo),

        // Technical details
        currentPrice,
        latestPriceAgeDays,
        high52w,
        pctFromHigh52w: chartinkFilter.pctFromHigh52w,
        dailyGainPct: chartinkFilter.dailyGainPct,
        ema50: chartinkFilter.ema50,
        sma30w: trendData.sma30Week,
        weinsteinStage: trendData.weinsteinStage,
        weinsteinStageLabel: trendData.weinsteinStageLabel,
        stopLoss: techResult.stopLoss,
        targetPrice: techResult.targetPrice,
        riskRewardRatio: techResult.rrRatio,
        volumeConfirmed,
        technicalSignals: techResult.signals,

        // Fundamental details
        peRatio: fundamentals.peRatio || null,
        marketCapCr: fundamentals.marketCapCr || null,
        debtToEquity: fundamentals.debtToEquity || null,
        rocePct: fundamentals.rocePct || null,
        roePct: fundamentals.roePct || null,
        yoySalesGrowthPct: fundamentals.yoySalesGrowthPct || null,
        yoyPatGrowthPct: fundamentals.yoyPatGrowthPct || null,
        promoterHoldingPct: fundamentals.promoterHoldingPct || null,
        promoterPledgePct: Number.isFinite(Number(fundamentals.promoterPledgePct)) ? Number(fundamentals.promoterPledgePct) : null,
        fundamentalBreakdown: fundResult.breakdown,
        qualitativeTags: fundResult.tags,
        screenerUrl: fundamentals.screenerUrl || null,
        fundamentalsStatus: fundamentals.status || 'UNAVAILABLE',

        // Earnings catalyst
        earningsCatalyst,

        // News
        newsSignal,

        // SIP plan
        sipPlan,

        // Executive Strategy & Roadmap
        executiveStrategy,

        // Explanation
        explanation: buildExplanation({
          buySignal: signal,
          technicalScore: techResult.score,
          fundamentalScore: fundResult.score,
          earningsCatalyst,
          newsSignal
        }),

        // Metadata
        lastPriceDate: prices[prices.length - 1]?.date || null,
        priceDataQuality: trendData.dataQuality || 'UNKNOWN',
        evaluatedAt: todayStr
      };

      results.push(analysis);
    } catch (err) {
      // Individual stock failure doesn't block others
      console.warn(`[BuyAnalysis] Skipped ${candidate.symbol}: ${err.message}`);
    }
  }

  // Sector Momentum & Cyclical Tailwinds Engine
  const sectorGroups = {};
  for (const a of results) {
    const sec = a.sector || 'Unknown';
    if (!sectorGroups[sec]) sectorGroups[sec] = { total: 0, stage2Count: 0 };
    sectorGroups[sec].total++;
    if (a.weinsteinStage === 2 && a.currentPrice > (a.ema50 || 0)) {
      sectorGroups[sec].stage2Count++;
    }
  }

  const boomingSectors = new Set();
  for (const [sec, data] of Object.entries(sectorGroups)) {
    if (data.total >= 4 && sec !== 'Unknown') {
      const breadthPct = (data.stage2Count / data.total) * 100;
      if (breadthPct >= 50) {
        boomingSectors.add(sec);
      }
    }
  }

  for (const a of results) {
    if (boomingSectors.has(a.sector)) {
      a.hasSectorTailwind = true;
      a.compositeScore = Math.min(100, a.compositeScore + 5);
      if (Array.isArray(a.qualitativeTags) && !a.qualitativeTags.some(t => t.tag === 'SECTOR_TAILWIND')) {
        a.qualitativeTags.unshift({
          tag: 'SECTOR_TAILWIND',
          label: `Sector Boom · ${a.sector}`,
          color: 'indigo',
          informational: true
        });
      }
    }
  }

  // Sort: STRONG_BUY first, then BUY, then WATCH, then MONITOR
  const signalOrder = { STRONG_BUY: 0, BUY: 1, WATCH: 2, INSUFFICIENT_DATA: 3, MONITOR: 4, AVOID: 5 };
  results.sort((a, b) => {
    const orderDiff = (signalOrder[a.buySignal] ?? 99) - (signalOrder[b.buySignal] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    return b.compositeScore - a.compositeScore; // Within same signal, higher score first
  });

  return results.slice(0, opts.maxResults || 500);
}

/**
 * Builds a portfolio summary for the buy analysis results.
 */
export function buildBuyPortfolioSummary(analyses = []) {
  const counts = {};
  for (const a of analyses) {
    counts[a.buySignal] = (counts[a.buySignal] || 0) + 1;
  }

  return {
    total: analyses.length,
    strongBuyCount: counts.STRONG_BUY || 0,
    buyCount: counts.BUY || 0,
    watchCount: counts.WATCH || 0,
    monitorCount: counts.MONITOR || 0,
    avoidCount: counts.AVOID || 0,
    insufficientDataCount: counts.INSUFFICIENT_DATA || 0,
    withSipPlans: analyses.filter(a => a.sipPlan !== null).length,
    withEarningsCatalyst: analyses.filter(a =>
      (a.earningsCatalyst?.daysToResult !== null && a.earningsCatalyst?.daysToResult >= 0 && a.earningsCatalyst?.daysToResult <= 21)
      || a.earningsCatalyst?.isPreDriftZone
      || a.earningsCatalyst?.isConfirmedDate
    ).length,
    withPositiveNews: analyses.filter(a => ['POSITIVE', 'STRONGLY_POSITIVE'].includes(a.newsSignal?.overallSentiment)).length,
    ruleVersion: BUY_ANALYSIS_VERSION
  };
}
