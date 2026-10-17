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

  // Use chartink technical score as foundation
  if (chartinkFilter.technicalScore) {
    score = chartinkFilter.technicalScore;
    signals.push(...(chartinkFilter.reasons || []));
  }

  // Boost for Weinstein Stage 2 (the core buy stage)
  if (trendData.weinsteinStage === 2) {
    score = Math.min(100, score + 10);
    signals.push('Stage 2 Bull confirmed ✓');
  } else if (trendData.weinsteinStage === 1) {
    // Stage 1 (base) is the accumulation phase — watch signal
    score = Math.min(100, score + 5);
    signals.push('Stage 1 Base (accumulation phase) — watch for breakout');
  } else if (trendData.weinsteinStage === 3 || trendData.weinsteinStage === 4) {
    score = Math.max(0, score - 20);
    signals.push(`⚠ Stage ${trendData.weinsteinStage} — not a buy candidate`);
  }

  // Chandelier stop provides risk reference — if above stop, adds confidence
  if (trendData.chandelierStopPrice && currentPrice > trendData.chandelierStopPrice) {
    const buffer = ((currentPrice / trendData.chandelierStopPrice) - 1) * 100;
    if (Number.isFinite(buffer) && buffer >= 5) {
      score = Math.min(100, score + 5);
      signals.push(`${buffer.toFixed(1)}% above trailing stop floor ✓`);
    }
  }

  // 30-week SMA slope (positive slope = bullish structure)
  if (Number.isFinite(trendData.sma30WeekFourWeekSlopePct)) {
    if (trendData.sma30WeekFourWeekSlopePct > 1.0) {
      score = Math.min(100, score + 8);
      signals.push(`30-week SMA rising +${Number(trendData.sma30WeekFourWeekSlopePct).toFixed(1)}%/4w ✓`);
    } else if (trendData.sma30WeekFourWeekSlopePct > 0) {
      score = Math.min(100, score + 3);
      signals.push('30-week SMA slightly rising');
    }
  }

  // Momentum: price vs 20-week peak
  if (Number.isFinite(trendData.drawdownFrom20WeekHighPct)) {
    const drawdown = trendData.drawdownFrom20WeekHighPct;
    if (drawdown >= -5) {
      // Near or at 20-week peak — strong momentum
      score = Math.min(100, score + 8);
      signals.push(`Near 20-week peak (${Number(drawdown).toFixed(1)}% from high) ✓`);
    } else if (drawdown >= -15) {
      score = Math.min(100, score + 3);
      signals.push(`Within 15% of 20-week peak`);
    }
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
  const isSetupEligible = chartinkFilter.passes || trendData.weinsteinStage === 2;
  if (!isSetupEligible) {
    const detail = chartinkFilter.failReasons?.slice(0, 2).join('; ') || 'Neither fresh 50-EMA breakout nor Stage 2 bull trend established';
    return { signal: 'WATCH', reason: `Setup not confirmed: ${detail}.`, isStrongBuyEligible: false };
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
  const isStrongBuyTech = techScore >= 65 && trendData.weinsteinStage === 2;
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
    opts = { today: o.today, maxResults: o.maxResults, includeSipPlans: o.includeSipPlans };
  }

  const todayStr = opts.today || new Date().toISOString().slice(0, 10);
  const results = [];

  for (const candidate of (candidates || [])) {
    try {
      const { symbol, name, source, inPortfolio, portfolioQuantity, portfolioAvgPrice } = candidate;
      const clean = String(symbol).toUpperCase().replace(/\.(NS|BO)$/i, '');

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
          name: name || clean,
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
          ruleVersion: BUY_ANALYSIS_VERSION,
          evaluatedAt: todayStr,
          dataQuality: 'INCOMPLETE'
        });
        continue;
      }

      // Compute 52-week high from price history
      const last252 = prices.slice(-252);
      const high52w = last252.length > 0 ? Math.max(...last252.map(p => p.close)) : currentPrice;

      // Technical trend analysis (reusing existing engine)
      const priceSeriesAsOf = Object.fromEntries(prices.map(row => [row.date, row.close]));
      const trendData = analyzeTechnicalTrend(priceSeriesAsOf, { today: todayStr });
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
          name,
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

      const analysis = {
        // Identity
        symbol: clean,
        name,
        source,
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
    withEarningsCatalyst: analyses.filter(a => a.earningsCatalyst?.isPreDriftZone).length,
    withPositiveNews: analyses.filter(a => ['POSITIVE', 'STRONGLY_POSITIVE'].includes(a.newsSignal?.overallSentiment)).length,
    ruleVersion: BUY_ANALYSIS_VERSION
  };
}
