/** Event-driven, user-budgeted accumulation plan suggestions. */
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const SIP_PLANS_DIR = path.join(DATA_DIR, 'sip_plans');
const TRANCHE_RATIOS = [0.30, 0.35, 0.35];
const PLAN_VALID_DAYS = 30;

export function shouldGenerateSipPlan(analysis = {}, earningsCatalyst = {}) {
  if (!['BUY', 'STRONG_BUY'].includes(analysis.buySignal)) return false;
  if (analysis.fundamentalDataValid === false || (analysis.fundamentalScore !== undefined && analysis.fundamentalScore < 50)) return false;
  if (earningsCatalyst?.daysToResult !== null && earningsCatalyst?.daysToResult !== undefined
      && earningsCatalyst.daysToResult >= 0 && earningsCatalyst.daysToResult <= 15) return false;
  return true;
}

function sharesForAmount(amount, price) {
  if (!Number.isFinite(amount) || !Number.isFinite(price) || amount <= 0 || price <= 0) return null;
  return Math.floor(amount / price);
}

export function buildSipPlan({
  symbol, name, buySignal, currentPrice, ema50, high52w, fundamentalScore,
  technicalScore, earningsCatalyst = {}, customBudget = null, stopLoss = null, targetPrice = null,
  riskRewardRatio = null
}) {
  const budget = Number.isFinite(Number(customBudget)) && Number(customBudget) > 0 ? Number(customBudget) : null;
  const amounts = budget ? [
    Math.round(budget * TRANCHE_RATIOS[0]),
    Math.round(budget * TRANCHE_RATIOS[1]),
    budget - Math.round(budget * TRANCHE_RATIOS[0]) - Math.round(budget * TRANCHE_RATIOS[1])
  ] : [null, null, null];

  // Price triggers are displayed as review levels, not executable orders.
  // Require a confirmed reaction and an intact thesis before any tranche.
  const support = Number.isFinite(Number(ema50)) && Number(ema50) > 0 ? Number(ema50) : null;
  const pullbackLow = support ? Number((support * 0.99).toFixed(2)) : null;
  const pullbackHigh = support ? Number((support * 1.01).toFixed(2)) : null;
  const breakoutLevel = Number.isFinite(Number(high52w)) && Number(high52w) > 0 ? Number(high52w.toFixed(2)) : null;
  const safeStop = Number.isFinite(Number(stopLoss)) && Number(stopLoss) > 0 ? Number(stopLoss)
    : Number.isFinite(Number(ema50)) && Number(ema50) > 0 ? Number((Number(ema50) * 0.95).toFixed(2))
    : Number.isFinite(Number(currentPrice)) && Number(currentPrice) > 0 ? Number((Number(currentPrice) * 0.92).toFixed(2))
    : null;
  const exitTarget = Number.isFinite(Number(targetPrice)) && Number(targetPrice) > 0 ? Number(targetPrice)
    : Number.isFinite(Number(high52w)) && Number(high52w) > 0 ? Number(high52w.toFixed(2))
    : (safeStop && Number.isFinite(Number(currentPrice))) ? Number((Number(currentPrice) + (Number(currentPrice) - safeStop) * 2.5).toFixed(2))
    : null;
  const daysToResult = earningsCatalyst?.daysToResult;
  const earningsNote = earningsCatalyst?.isConfirmedDate && daysToResult >= 0 && daysToResult <= 30
    ? `Confirmed results date is ${daysToResult} days away. Reassess after the official filing.`
    : earningsCatalyst?.dateConfidence === 'ESTIMATED' && daysToResult >= 0 && daysToResult <= 30
      ? 'Estimated results date is near. Verify the date from an official company or exchange announcement.' : null;

  const tranches = [
    {
      tranche: 1, label: 'Initial position', ratio: TRANCHE_RATIOS[0], amount: amounts[0],
      triggerType: 'ENTRY_CONFIRMATION', triggerDescription: 'Execute initial entry on verified signal confirmation with defined stop-loss invalidation level.',
      triggerPriceRange: null, estimatedShares: sharesForAmount(amounts[0], currentPrice), estimatedAvgPrice: currentPrice,
      rationale: 'Initial 30% position establishes core exposure. Stop-loss protects capital against thesis breakdown.',
      status: 'READY', conditions: ['Price remains above trailing stop floor', 'Stage 2 or base breakout structure intact', 'Size calibrated within portfolio risk limit']
    },
    {
      tranche: 2, label: 'Support retest', ratio: TRANCHE_RATIOS[1], amount: amounts[1],
      triggerType: 'SUPPORT_RETEST', triggerDescription: support ? `Accumulate on orderly pullback into 50-EMA support zone ₹${pullbackLow}–₹${pullbackHigh} with confirmed rebound.` : 'Accumulate on 50-EMA support retest with confirmed rebound.',
      triggerPriceRange: support ? { low: pullbackLow, high: pullbackHigh } : null,
      estimatedShares: sharesForAmount(amounts[1], support), estimatedAvgPrice: support,
      rationale: 'Second 35% tranche lowers average cost basis during constructive consolidation above rising moving averages.',
      status: 'ARMED', conditions: ['Price tests 50-EMA support and prints a recovery candle', 'Weekly technical trend remains bullish', 'Cancel if 50-EMA support fails on a closing basis']
    },
    {
      tranche: 3, label: 'Trend continuation', ratio: TRANCHE_RATIOS[2], amount: amounts[2],
      triggerType: 'TREND_CONTINUATION', triggerDescription: breakoutLevel ? `Deploy final tranche on high-volume breakout close above ₹${breakoutLevel}.` : 'Deploy final tranche on confirmed swing-high breakout.',
      triggerPriceRange: breakoutLevel ? { low: breakoutLevel, high: null } : null,
      estimatedShares: sharesForAmount(amounts[2], breakoutLevel), estimatedAvgPrice: breakoutLevel,
      rationale: 'Final 35% tranche scales into established trend acceleration. Confirms institutional accumulation.',
      status: 'CONTINGENT', conditions: ['Closing breakout above 52-week or swing high', 'Volume expansion accompanies breakout', 'Total position does not exceed single-stock portfolio allocation cap']
    }
  ];

  const generatedAt = new Date();
  const expiresAt = new Date(generatedAt.getTime() + PLAN_VALID_DAYS * 86400000).toISOString();
  return {
    symbol: String(symbol).toUpperCase().replace(/\.(NS|BO)$/i, ''), name, buySignal,
    generatedAt: generatedAt.toISOString(), expiresAt, planType: 'OPPORTUNISTIC_ACCUMULATION',
    totalBudget: budget, budgetRequired: !budget, trancheRatios: TRANCHE_RATIOS,
    tranches, stopLoss: safeStop, exitTarget,
    riskRewardRatio: riskRewardRatio !== null && riskRewardRatio !== undefined && Number.isFinite(Number(riskRewardRatio)) ? Number(riskRewardRatio) : null,
    daysToResult: daysToResult ?? null, earningsNote,
    notes: [
      'Suggestions require manual review; no orders are placed or recorded.',
      'Deploy at most one tranche per trading session, even if multiple triggers occur together.',
      'Set a total budget only after applying portfolio risk, concentration, cash, and liquidity limits.',
      'Plan expires after 30 days and must be re-evaluated; cancel it after a thesis-breaking event.',
      safeStop ? `Reference invalidation level: ₹${safeStop.toFixed(2)}. Gaps can execute below this level.` : 'No verified invalidation level is available; position sizing is not ready.',
      earningsNote
    ].filter(Boolean),
    fundamentalScore, technicalScore,
    scoreCommentary: `Fundamental score ${fundamentalScore}/100; technical score ${technicalScore}/100. Scores do not determine allocation.`
  };
}

export function saveSipPlan(plan) {
  if (!plan?.symbol) return null;
  if (!fs.existsSync(SIP_PLANS_DIR)) fs.mkdirSync(SIP_PLANS_DIR, { recursive: true });
  const filePath = path.join(SIP_PLANS_DIR, `${String(plan.symbol).toUpperCase()}.json`);
  fs.writeFileSync(filePath, JSON.stringify(plan, null, 2), 'utf8');
  return plan;
}

export function loadSipPlan(symbol) {
  const clean = String(symbol || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const filePath = path.join(SIP_PLANS_DIR, `${clean}.json`);
  if (!clean || !fs.existsSync(filePath)) return null;
  try {
    const plan = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Date.parse(plan.expiresAt) > Date.now() ? plan : null;
  } catch {
    return null;
  }
}
