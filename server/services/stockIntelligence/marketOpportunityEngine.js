/**
 * marketOpportunityEngine.js — Dynamic Market Opportunity Index (MOI) & Execution Mode Engine
 *
 * Replaces static/arbitrary buy caps with dynamic, data-driven market regime detection.
 * Evaluates candidate quality density, 50-EMA pullback support, VCP base compression,
 * sector momentum breadth, and portfolio momentum tailwind to determine:
 *
 * 1. Market Opportunity Index (MOI, 0–100)
 * 2. Execution Mode:
 *    - 'OPPORTUNITY_STRIKE' (Aggressive / Lump-Sum Mode):
 *      Activated when MOI >= strikeMoiThreshold (65) or when a high-conviction cluster (>= 3 stocks with MPS >= 80)
 *      emerges during market pullbacks. Expands daily budget to fund ALL qualifying compounders
 *      without arbitrary daily count limits, ensuring zero multibaggers are missed.
 *    - 'STAGGERED_ACCUMULATION' (Measured Staged Mode):
 *      Activated when MOI < strikeMoiThreshold. Staggers capital in measured tranches (30–50% of purchasing power)
 *      into highest-ranked leaders while preserving dry powder during extended or uncertain conditions.
 * 3. Dynamic Deployment Budget (replaces static rupee caps).
 */

const DEFAULT_CONFIG = {
  // MOI Component Weights (sum = 1.0)
  weights: {
    qualityDensity: 0.30,
    ema50PullbackSupport: 0.25,
    vcpBaseCompression: 0.25,
    sectorGroupMomentum: 0.20,
  },

  // Quality Density configuration
  qualityDensity: {
    minCandidatesForFullScore: 8,
    mpsThresholds: {
      exceptional: 80,
      strong: 70,
      good: 60,
    },
    avgMpsWeight: 0.70,
    densityBonusMultiplier: 20,
    exceptionalBonusMultiplier: 10,
  },

  // 50-EMA Pullback Support Corridor configuration
  ema50Pullback: {
    sweetSpotMinPct: -4.0,       // Undercut shakeout limit (-4%)
    sweetSpotMaxPct: 8.0,        // Sweet spot pullback zone (up to +8% above 50-EMA)
    moderateExtensionMaxPct: 12.0, // Moderate extension (8% to 12% gets partial credit)
    partialSupportWeight: 0.50,
  },

  // VCP Base Compression configuration
  vcpCompression: {
    maxRiskPct: 8.5,             // Max stop-loss risk distance (%)
    maxDepthFromHighPct: 16.0,   // Max base pullback from 52-week high (%)
    bufferRiskPct: 3.0,          // Secondary acceptable risk buffer (+3%)
    bufferDepthPct: 5.0,         // Secondary acceptable depth buffer (+5%)
    partialTightWeight: 0.50,
    defaultRiskPct: 10.0,
  },

  // Sector Group Momentum configuration
  sectorGroupMomentum: {
    scoreMultiplier: 150,
    scoreFloor: 20,
    neutralFallbackScore: 50,
  },

  // Portfolio Momentum Tailwind (from enrichedHoldings)
  portfolioTailwind: {
    winnerRatioBonusMax: 5.0,    // Extra bonus points for MOI if user's current holdings are in profit
    minHoldingsForAnalysis: 3,
  },

  // Deployment Mode & Scaling Thresholds
  deployment: {
    strikeMoiThreshold: 65,
    highQualityClusterThreshold: 3, // Min candidates with MPS >= 80 to trigger strike mode
    highQualityMpsThreshold: 80,
    strikeProgressTargetMoi: 85,
    staggeredBaseMoi: 50,
    budgetRatio: {
      strike: { min: 0.75, max: 1.00 },
      staggered: { min: 0.30, max: 0.50 },
    },
  },

  // Rounding & Formatting precision
  rounding: {
    moi: 1,
    ratio: 2,
    percentage: 1,
    currency: 0,
  },
};

function round(value, decimals) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function isPositiveFinite(val) {
  const num = Number(val);
  return Number.isFinite(num) && num > 0;
}

/**
 * Calculates Quality Density Score (0-100)
 */
function calculateQualityDensity(candidateEvaluations, config) {
  if (!Array.isArray(candidateEvaluations) || candidateEvaluations.length === 0) {
    return { score: 0, details: { candidateCount: 0, avgMps: 0, highQualityCount: 0, exceptionalCount: 0 } };
  }

  const {
    minCandidatesForFullScore,
    mpsThresholds,
    avgMpsWeight,
    densityBonusMultiplier,
    exceptionalBonusMultiplier
  } = config.qualityDensity;

  const validCandidates = candidateEvaluations.filter(c => c && Number.isFinite(Number(c.mps)));

  if (validCandidates.length === 0) {
    return { score: 0, details: { candidateCount: 0, avgMps: 0, highQualityCount: 0, exceptionalCount: 0 } };
  }

  const mpsValues = validCandidates.map(c => Number(c.mps));
  const avgMps = mpsValues.reduce((a, b) => a + b, 0) / mpsValues.length;
  const highQualityCount = mpsValues.filter(m => m >= mpsThresholds.strong).length;
  const exceptionalCount = mpsValues.filter(m => m >= mpsThresholds.exceptional).length;

  const avgMpsScore = clamp(avgMps, 0, 100);
  const densityRatio = Math.min(validCandidates.length / minCandidatesForFullScore, 1.5);
  const densityBonus = (highQualityCount / Math.max(validCandidates.length, 1)) * densityBonusMultiplier * densityRatio;
  const exceptionalBonus = (exceptionalCount / Math.max(validCandidates.length, 1)) * exceptionalBonusMultiplier;

  const rawScore = clamp(avgMpsScore * avgMpsWeight + densityBonus + exceptionalBonus, 0, 100);

  return {
    score: round(rawScore, config.rounding.moi),
    details: {
      candidateCount: validCandidates.length,
      avgMps: round(avgMps, config.rounding.moi),
      highQualityCount,
      exceptionalCount,
      densityRatio: round(densityRatio, config.rounding.ratio),
    },
  };
}

/**
 * Calculates 50-EMA Pullback Support Ratio Score (0-100)
 */
function calculateEma50PullbackSupport(candidateEvaluations, config) {
  if (!Array.isArray(candidateEvaluations) || candidateEvaluations.length === 0) {
    return { score: 50, details: { evaluated: 0, supported: 0, supportRatio: 0 } };
  }

  const {
    sweetSpotMinPct,
    sweetSpotMaxPct,
    moderateExtensionMaxPct,
    partialSupportWeight
  } = config.ema50Pullback;

  let supportedCount = 0;
  let evaluatedCount = 0;

  for (const c of candidateEvaluations) {
    if (!c) continue;
    const cmp = Number(c.cmp ?? c.currentPrice);
    const ema50 = Number(c.ema50);
    let pctEma50 = Number.isFinite(Number(c.pctFromEma50)) ? Number(c.pctFromEma50) : null;

    if (pctEma50 === null && isPositiveFinite(cmp) && isPositiveFinite(ema50)) {
      pctEma50 = ((cmp - ema50) / ema50) * 100;
    }

    if (!Number.isFinite(pctEma50)) continue;
    evaluatedCount++;

    // 1. Sweet-spot pullback zone: testing 50-EMA support corridor (-4% to +8%)
    if (pctEma50 >= sweetSpotMinPct && pctEma50 <= sweetSpotMaxPct) {
      supportedCount += 1.0;
    }
    // 2. Moderate extension zone (+8% to +12%): partial support credit
    else if (pctEma50 > sweetSpotMaxPct && pctEma50 <= moderateExtensionMaxPct) {
      supportedCount += partialSupportWeight;
    }
  }

  if (evaluatedCount === 0) {
    return { score: 50, details: { evaluated: 0, supported: 0, supportRatio: 0 } };
  }

  const supportRatio = supportedCount / evaluatedCount;
  const rawScore = clamp(supportRatio * 100, 0, 100);

  return {
    score: round(rawScore, config.rounding.moi),
    details: {
      evaluated: evaluatedCount,
      supported: Math.round(supportedCount),
      supportRatio: round(supportRatio, config.rounding.ratio),
    },
  };
}

/**
 * Calculates VCP Base Compression Ratio Score (0-100)
 */
function calculateVcpBaseCompression(candidateEvaluations, config) {
  if (!Array.isArray(candidateEvaluations) || candidateEvaluations.length === 0) {
    return { score: 50, details: { evaluated: 0, tightBases: 0, tightBaseRatio: 0 } };
  }

  const {
    maxRiskPct,
    maxDepthFromHighPct,
    bufferRiskPct,
    bufferDepthPct,
    partialTightWeight,
    defaultRiskPct
  } = config.vcpCompression;

  let tightCount = 0;
  let evaluatedCount = 0;

  for (const c of candidateEvaluations) {
    if (!c) continue;
    const cmp = Number(c.cmp ?? c.currentPrice);
    const sl = Number(c.sl ?? c.stopLoss);
    const rawPctFromHigh = Number(c.pctFromHigh52w ?? c.pctFrom52wHigh);
    const pctFromHigh = Number.isFinite(rawPctFromHigh) ? Math.abs(rawPctFromHigh) : 0;

    if (!isPositiveFinite(cmp)) continue;
    evaluatedCount++;

    const riskPct = isPositiveFinite(sl)
      ? Math.abs((cmp - sl) / cmp * 100)
      : defaultRiskPct;

    const isTight = riskPct <= maxRiskPct && pctFromHigh <= maxDepthFromHighPct;
    const isModerate = riskPct <= (maxRiskPct + bufferRiskPct) && pctFromHigh <= (maxDepthFromHighPct + bufferDepthPct);

    if (isTight) {
      tightCount += 1.0;
    } else if (isModerate) {
      tightCount += partialTightWeight;
    }
  }

  if (evaluatedCount === 0) {
    return { score: 50, details: { evaluated: 0, tightBases: 0, tightBaseRatio: 0 } };
  }

  const tightBaseRatio = tightCount / evaluatedCount;
  const rawScore = clamp(tightBaseRatio * 100, 0, 100);

  return {
    score: round(rawScore, config.rounding.moi),
    details: {
      evaluated: evaluatedCount,
      tightBases: Math.round(tightCount),
      tightBaseRatio: round(tightBaseRatio, config.rounding.ratio),
    },
  };
}

/**
 * Calculates Sector Group Momentum Score (0-100)
 */
function calculateSectorGroupMomentum(topSectors, candidateEvaluations, config) {
  if (!Array.isArray(candidateEvaluations) || candidateEvaluations.length === 0) {
    return { score: config.sectorGroupMomentum.neutralFallbackScore, details: { topSectorMatches: 0, topSectorRatio: 0 } };
  }

  const topSectorSet = new Set((topSectors || []).filter(Boolean));
  let matches = 0;
  let total = 0;

  for (const c of candidateEvaluations) {
    if (!c) continue;
    total++;
    const sector = c.sector;
    if (sector && topSectorSet.has(sector)) {
      matches++;
    }
  }

  if (total === 0) {
    return { score: config.sectorGroupMomentum.neutralFallbackScore, details: { topSectorMatches: 0, topSectorRatio: 0 } };
  }

  const ratio = matches / total;
  const { scoreMultiplier, scoreFloor } = config.sectorGroupMomentum;
  const rawScore = clamp(ratio * scoreMultiplier + scoreFloor, scoreFloor, 100);

  return {
    score: round(rawScore, config.rounding.moi),
    details: {
      topSectorMatches: matches,
      totalCandidates: total,
      topSectorRatio: round(ratio, config.rounding.ratio),
    },
  };
}

/**
 * Calculates Portfolio Health Tailwind from enriched holdings
 */
function calculatePortfolioTailwind(enrichedHoldings, config) {
  if (!Array.isArray(enrichedHoldings) || enrichedHoldings.length < config.portfolioTailwind.minHoldingsForAnalysis) {
    return { bonus: 0, winnerRatio: 0 };
  }

  const equityHoldings = enrichedHoldings.filter(h =>
    h && Number(h.quantity) > 0 && isPositiveFinite(h.current_price)
  );

  if (equityHoldings.length === 0) return { bonus: 0, winnerRatio: 0 };

  const winningHoldings = equityHoldings.filter(h => {
    const avg = Number(h.avg_buy_price || h.average_buy_price || 0);
    const cmp = Number(h.current_price || 0);
    return avg > 0 && cmp > avg;
  });

  const winnerRatio = winningHoldings.length / equityHoldings.length;
  const bonus = clamp(winnerRatio * config.portfolioTailwind.winnerRatioBonusMax, 0, config.portfolioTailwind.winnerRatioBonusMax);

  return {
    bonus: round(bonus, config.rounding.moi),
    winnerRatio: round(winnerRatio, config.rounding.ratio),
    totalEquityHoldings: equityHoldings.length,
    winningHoldings: winningHoldings.length
  };
}

/**
 * Calculates composite Market Opportunity Index (MOI)
 */
function calculateMoi(componentScores, weights, portfolioTailwindBonus, config) {
  const weightedSum =
    componentScores.qualityDensity * weights.qualityDensity +
    componentScores.ema50PullbackSupport * weights.ema50PullbackSupport +
    componentScores.vcpBaseCompression * weights.vcpBaseCompression +
    componentScores.sectorGroupMomentum * weights.sectorGroupMomentum;

  const totalScore = clamp(weightedSum + portfolioTailwindBonus, 0, 100);
  return round(totalScore, config.rounding.moi);
}

/**
 * Determines deployment mode based on MOI and quality cluster
 */
function determineDeploymentMode(moi, candidateEvaluations, config) {
  const { strikeMoiThreshold, highQualityClusterThreshold, highQualityMpsThreshold } = config.deployment;

  const highQualityCount = Array.isArray(candidateEvaluations)
    ? candidateEvaluations.filter(c => c && Number.isFinite(Number(c.mps)) && Number(c.mps) >= highQualityMpsThreshold).length
    : 0;

  const hasHighQualityCluster = highQualityCount >= highQualityClusterThreshold;
  const isStrikeMode = moi >= strikeMoiThreshold || hasHighQualityCluster;

  return {
    mode: isStrikeMode ? 'OPPORTUNITY_STRIKE' : 'STAGGERED_ACCUMULATION',
    isStrikeMode,
    trigger: {
      moiThresholdMet: moi >= strikeMoiThreshold,
      highQualityCluster: hasHighQualityCluster,
      highQualityCount,
      moi,
      threshold: strikeMoiThreshold,
    },
  };
}

/**
 * Calculates dynamic deployment budget ratio and amount
 */
function calculateDeploymentBudget(modeInfo, totalPurchasingPower, config) {
  const { budgetRatio, strikeProgressTargetMoi, staggeredBaseMoi } = config.deployment;
  const ratios = modeInfo.isStrikeMode ? budgetRatio.strike : budgetRatio.staggered;

  const moi = modeInfo.trigger.moi;
  const threshold = modeInfo.trigger.threshold;

  let ratio;
  if (modeInfo.isStrikeMode) {
    const progress = clamp((moi - threshold) / (strikeProgressTargetMoi - threshold), 0, 1);
    ratio = ratios.min + (ratios.max - ratios.min) * progress;
  } else {
    const progress = clamp(moi / staggeredBaseMoi, 0, 1);
    ratio = ratios.min + (ratios.max - ratios.min) * progress;
  }

  ratio = clamp(ratio, ratios.min, ratios.max);
  const budgetInr = Math.round(Number(totalPurchasingPower || 0) * ratio);

  return {
    ratio: round(ratio, config.rounding.ratio),
    budgetInr: round(budgetInr, config.rounding.currency),
    mode: modeInfo.mode,
  };
}

/**
 * Generates descriptive headline and narrative
 */
function generateModeNarrative(modeInfo, budgetInfo, componentScores, config) {
  const { isStrikeMode, trigger } = modeInfo;
  const moi = trigger.moi;
  const highQualityCount = trigger.highQualityCount;
  const formattedBudget = '₹' + Math.round(budgetInfo.budgetInr / 1000).toLocaleString('en-IN') + 'k';

  let headline, narrative;

  if (isStrikeMode) {
    if (trigger.highQualityCluster) {
      headline = `🎯 OPPORTUNITY STRIKE: High-Quality Cluster Active (${highQualityCount} stocks ≥ ${config.deployment.highQualityMpsThreshold} MPS, MOI ${moi}/100)`;
      narrative = `Market opportunity is exceptionally ripe. High density of prime breakout setups and profitable compounder additions detected. Dynamic budget expanded to ${formattedBudget} (${Math.round(budgetInfo.ratio * 100)}% of purchasing power) to fund all qualifying setups without artificial limits.`;
    } else {
      headline = `⚡ OPPORTUNITY STRIKE: Broad Market Opportunity (MOI ${moi}/100)`;
      narrative = `Strong confluence across 50-EMA support tests, VCP compressions, and sector leadership. Strike mode active: deploying ${formattedBudget} aggressively into top-decile compounders.`;
    }
  } else {
    headline = `⏳ STAGGERED ACCUMULATION: Measured Staged Execution (MOI ${moi}/100)`;
    narrative = `Selective market environment. Staggering ${formattedBudget} (${Math.round(budgetInfo.ratio * 100)}% of purchasing power) into highest-conviction leaders while preserving dry powder until broad momentum solidifies.`;
  }

  return { headline, narrative };
}

/**
 * Main Entry Point: Calculates complete Market Opportunity assessment
 */
export function calculateMarketOpportunity({
  candidateEvaluations = [],
  enrichedHoldings = [],
  topSectors = [],
  totalPurchasingPower = 0,
  config: customConfig = {}
} = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...customConfig,
    weights: { ...DEFAULT_CONFIG.weights, ...(customConfig.weights || {}) },
    qualityDensity: { ...DEFAULT_CONFIG.qualityDensity, ...(customConfig.qualityDensity || {}) },
    ema50Pullback: { ...DEFAULT_CONFIG.ema50Pullback, ...(customConfig.ema50Pullback || {}) },
    vcpCompression: { ...DEFAULT_CONFIG.vcpCompression, ...(customConfig.vcpCompression || {}) },
    sectorGroupMomentum: { ...DEFAULT_CONFIG.sectorGroupMomentum, ...(customConfig.sectorGroupMomentum || {}) },
    portfolioTailwind: { ...DEFAULT_CONFIG.portfolioTailwind, ...(customConfig.portfolioTailwind || {}) },
    deployment: { ...DEFAULT_CONFIG.deployment, ...(customConfig.deployment || {}) },
    rounding: { ...DEFAULT_CONFIG.rounding, ...(customConfig.rounding || {}) },
  };

  const qualityDensity = calculateQualityDensity(candidateEvaluations, config);
  const ema50PullbackSupport = calculateEma50PullbackSupport(candidateEvaluations, config);
  const vcpBaseCompression = calculateVcpBaseCompression(candidateEvaluations, config);
  const sectorGroupMomentum = calculateSectorGroupMomentum(topSectors, candidateEvaluations, config);
  const portfolioTailwind = calculatePortfolioTailwind(enrichedHoldings, config);

  const componentScores = {
    qualityDensity: qualityDensity.score,
    ema50PullbackSupport: ema50PullbackSupport.score,
    vcpBaseCompression: vcpBaseCompression.score,
    sectorGroupMomentum: sectorGroupMomentum.score,
  };

  const componentDetails = {
    qualityDensity: qualityDensity.details,
    ema50PullbackSupport: ema50PullbackSupport.details,
    vcpBaseCompression: vcpBaseCompression.details,
    sectorGroupMomentum: sectorGroupMomentum.details,
    portfolioTailwind,
  };

  const moi = calculateMoi(componentScores, config.weights, portfolioTailwind.bonus, config);
  const modeInfo = determineDeploymentMode(moi, candidateEvaluations, config);
  const budgetInfo = calculateDeploymentBudget(modeInfo, totalPurchasingPower, config);
  const { headline, narrative } = generateModeNarrative(modeInfo, budgetInfo, componentScores, config);

  return {
    moi,
    deploymentMode: modeInfo.mode,
    isStrikeMode: modeInfo.isStrikeMode,
    deploymentBudgetRatio: budgetInfo.ratio,
    dynamicDeploymentBudget: budgetInfo.budgetInr,
    headline,
    description: narrative,
    trigger: modeInfo.trigger,
    componentScores,
    componentDetails,
  };
}

export default {
  calculateMarketOpportunity,
};
