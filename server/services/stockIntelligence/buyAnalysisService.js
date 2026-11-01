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
export function resolveCanonicalSector(fundamentals = {}, name = '', symbol = '') {
  const raw = String(fundamentals.sector || fundamentals.industry || '').trim();
  const s = raw.toLowerCase();
  const n = (name + ' ' + symbol).toLowerCase();

  // 1. Automobile & Auto Components
  if (s.includes('auto') || s.includes('vehicle') || s.includes('tyre') || s.includes('tire') || s.includes('ancillar') || s.includes('motor') || s.includes('forging') || s.includes('two wheeler') || s.includes('electric vehicle') || s.includes('ev ') ||
      n.includes('motor') || n.includes('auto') || n.includes('maruti') || n.includes('bajaj') || n.includes('tvs') || n.includes('lumax') || n.includes('sona') || n.includes('gabriel') || n.includes('sansera') || n.includes('ather') || n.includes('rkforge') || n.includes('dhoot') || n.includes('grpltd') || n.includes('grp ltd')) {
    return 'Automobile & Auto Components';
  }

  // 2. Banking
  if (s.includes('bank') || s.includes('banking') || s.includes('small finance bank') ||
      n.includes('bank') || n.includes('pnb') || n.includes('sbi') || n.includes('hdfc bank') || n.includes('icici bank') || n.includes('esaf')) {
    return 'Banking';
  }

  // 3. Financial Services & NBFC
  if (s.includes('finance') || s.includes('financial') || s.includes('nbfc') || s.includes('wealth') || s.includes('amc') || s.includes('stock exchange') || s.includes('depository') || s.includes('rating') || s.includes('capital market') || s.includes('fintech') || s.includes('broking') || s.includes('insurance') || s.includes('credit') ||
      n.includes('finance') || n.includes('fin ') || n.includes('finserve') || n.includes('fincorp') || n.includes('poonawalla') || n.includes('sgfin') || n.includes('360one') || n.includes('bse') || n.includes('nse') || n.includes('protean')) {
    return 'Financial Services & NBFC';
  }

  // 4. Semiconductors & Hardware (EMS / Chips)
  if (s.includes('semiconductor') || s.includes('chip') || s.includes('foundry') || s.includes('electronic manufacturing') || s.includes('ems') || s.includes('electronics hardware') ||
      n.includes('syrma') || n.includes('avalon') || n.includes('ebgng') || n.includes('nvidia') || n.includes('tsmc') || n.includes('broadcom') || n.includes('arista')) {
    return 'Semiconductors & Hardware';
  }

  // 5. Enterprise Cloud & Internet
  if (s.includes('cloud') || s.includes('internet') || s.includes('e-commerce') || s.includes('ecommerce') || s.includes('search engine') || s.includes('social media') || s.includes('enterprise software') ||
      n.includes('microsoft') || n.includes('google') || n.includes('meta') || n.includes('amazon') || n.includes('salesforce') || n.includes('palantir')) {
    return 'Enterprise Cloud & Internet';
  }

  // 6. Consumer Electronics & Hardware
  if (s.includes('consumer electronics') || s.includes('mobile phone') || s.includes('smartphone') || n.includes('apple')) {
    return 'Consumer Electronics & Hardware';
  }

  // 7. Healthcare Services & Hospitals
  if (s.includes('hospital') || s.includes('diagnostic') || s.includes('pathology') || s.includes('eyecare') || s.includes('clinic') || s.includes('healthcare service') ||
      n.includes('artemis') || n.includes('lalpath') || n.includes('agarwal') || n.includes('apollo') || n.includes('fortis') || n.includes('max health') || n.includes('indgn') || n.includes('sagility')) {
    return 'Healthcare Services & Hospitals';
  }

  // 8. Pharmaceuticals & Biotechnology
  if (s.includes('pharma') || s.includes('biotech') || s.includes('drug') || s.includes('formulation') || s.includes('api') || s.includes('cdmo') || s.includes('cro') || s.includes('active pharma') ||
      n.includes('pharma') || n.includes('lab') || n.includes('ipca') || n.includes('solara') || n.includes('corona') || n.includes('gufic') || n.includes('sailife') || n.includes('sudeep') || n.includes('sanofi') || n.includes('pghl') || n.includes('saiparent')) {
    return 'Pharmaceuticals & Biotechnology';
  }

  // 9. Power & Electrical Equipment
  if (s.includes('transformer') || s.includes('electrical equipment') || s.includes('generator') || s.includes('transmission') || s.includes('power generation') || s.includes('power grid') || s.includes('hydro') || s.includes('electricals') ||
      n.includes('tdpowersys') || n.includes('taril') || n.includes('hbl') || n.includes('enrin') || n.includes('qpower') || n.includes('marsons') || n.includes('nhpc') || n.includes('ntpc')) {
    return 'Power & Electrical Equipment';
  }

  // 10. Capital Goods & Heavy Engineering
  if (s.includes('capital good') || s.includes('heavy engineering') || s.includes('machinery') || s.includes('machine tool') || s.includes('cnc') || s.includes('industrial machinery') || s.includes('cryogenic') || s.includes('defense') || s.includes('defence') || s.includes('engineering') || s.includes('valves') || s.includes('hoses') ||
      n.includes('bhel') || n.includes('aeroflex') || n.includes('inoxindia') || n.includes('macpower') || n.includes('jash') || /\b(l&t|larsen)\b/i.test(n)) {
    return 'Capital Goods & Heavy Engineering';
  }

  // 11. Chemicals & Specialty Chemicals
  if (s.includes('chemical') || s.includes('specialty chem') || s.includes('fluorochem') || s.includes('fertilizer') || s.includes('agrochem') || s.includes('dye') || s.includes('pigment') || s.includes('petrochem') ||
      n.includes('fluorochem') || n.includes('neogen') || n.includes('hscl') || n.includes('igpl') || n.includes('fcl') || n.includes('fineotex') || n.includes('shreepushk') || n.includes('bodal') || n.includes('kiri') || n.includes('garware')) {
    return 'Chemicals & Specialty Chemicals';
  }

  // 12. Metals, Mining & Materials
  if (s.includes('metal') || s.includes('mining') || s.includes('steel') || s.includes('iron') || s.includes('aluminium') || s.includes('aluminum') || s.includes('copper') || s.includes('zinc') || s.includes('alloys') || s.includes('refractory') || s.includes('bimetal') ||
      n.includes('vaml') || n.includes('sbcl') || n.includes('rpel') || n.includes('manakcoat') || n.includes('mmp') || n.includes('tata steel') || n.includes('jsw')) {
    return 'Metals, Mining & Materials';
  }

  // 13. Gems, Jewellery & Luxury
  if (s.includes('jewel') || s.includes('gem') || s.includes('diamond') || s.includes('gold') || s.includes('luxury') ||
      n.includes('shankesh') || n.includes('igil') || n.includes('titan') || n.includes('kalyan')) {
    return 'Gems, Jewellery & Luxury';
  }

  // 14. Logistics & Transportation
  if (s.includes('logistics') || s.includes('transport') || s.includes('freight') || s.includes('cargo') || s.includes('courier') || s.includes('warehousing') || s.includes('port') ||
      n.includes('vrllog') || n.includes('vrl logistics') || n.includes('concor') || n.includes('delhivery')) {
    return 'Logistics & Transportation';
  }

  // 15. Travel, Tourism & Hospitality
  if (s.includes('hotel') || s.includes('resort') || s.includes('travel') || s.includes('tourism') || s.includes('hospitality') || s.includes('restaurant') || s.includes('airline') || s.includes('gaming') ||
      n.includes('tbotek') || n.includes('tbo tek') || n.includes('deltacorp') || n.includes('delta corp') || n.includes('indian hotels') || n.includes('easemytrip')) {
    return 'Travel, Tourism & Hospitality';
  }

  // 16. Consumer Staples & FMCG
  if (s.includes('fmcg') || s.includes('food') || s.includes('beverage') || s.includes('edible oil') || s.includes('tobacco') || s.includes('distiller') || s.includes('brewery') || s.includes('alcohol') || s.includes('personal care') || s.includes('staple') ||
      n.includes('radico') || n.includes('modinatur') || n.includes('tastybite') || n.includes('itc') || n.includes('nestle') || n.includes('hul') || n.includes('dabur')) {
    return 'Consumer Staples & FMCG';
  }

  // 17. Consumer Discretionary & Retail
  if (s.includes('retail') || s.includes('fashion') || s.includes('apparel') || s.includes('footwear') || s.includes('garment') || s.includes('consumer durable') || s.includes('furniture') ||
      n.includes('trent') || n.includes('redington') || n.includes('nilkamal')) {
    return 'Consumer Discretionary & Retail';
  }

  // 18. Information Technology & Software
  if (s.includes('tech') || s.includes('information') || s.includes('software') || s.includes('it ') || s === 'it' || s.includes('it services') || s.includes('consulting') || s.includes('analytics') ||
      n.includes('techm') || n.includes('eclerx') || n.includes('fractal') || n.includes('tcs') || n.includes('infy') || n.includes('wipro') || n.includes('hcl')) {
    return 'Information Technology & Software';
  }

  // 19. Real Estate & Construction
  if (s.includes('realty') || s.includes('real estate') || s.includes('construction') || s.includes('cement') || s.includes('infra') || n.includes('dlf') || n.includes('godrej prop')) {
    return 'Real Estate & Construction';
  }

  // 20. Oil, Gas & Energy
  if (s.includes('energy') || s.includes('oil') || s.includes('gas') || s.includes('petroleum') || s.includes('refin') || s.includes('renewable') || n.includes('ongc') || n.includes('reliance') || n.includes('ioc')) {
    return 'Oil, Gas & Energy';
  }

  // 21. Telecommunication & Media
  if (s.includes('telecom') || s.includes('media') || s.includes('entertainment') || s.includes('broadcasting') || n.includes('bharti') || n.includes('airtel') || n.includes('zee') || n.includes('pvr')) {
    return 'Telecommunication & Media';
  }

  return raw && raw !== 'Unknown' ? raw : 'Diversified & Other';
}

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
  const currentPrice = Number(chartinkFilter?.currentPrice) || Number(trendData?.weeklyClose) || 0;
  const mcap = Number(fundamentals.marketCapCr);

  // 1. Penny stock price exclusion (CMP < ₹20.00)
  if (currentPrice > 0 && currentPrice < 20.00) {
    return {
      signal: 'AVOID',
      reason: `Penny stock price (CMP ₹${currentPrice.toFixed(2)} < ₹20.00). High risk of operator manipulation, wide bid-ask spreads, and illiquid circuit lockouts.`,
      isStrongBuyEligible: false
    };
  }

  // 2. Sub-institutional microcap exclusion (Market Cap < ₹1,000 Cr)
  if (Number.isFinite(mcap) && mcap > 0 && mcap < 1000) {
    return {
      signal: 'AVOID',
      reason: `Sub-institutional microcap (Market Cap ₹${Math.round(mcap)} Cr < ₹1,000 Cr threshold). High risk of illiquid lower circuit lockouts, absence of institutional support, and accounting volatility.`,
      isStrongBuyEligible: false
    };
  }

  // 3. Governance red flag overrides everything
  if (hasGovernanceRedFlag) {
    return {
      signal: 'AVOID',
      reason: 'Governance red flag detected (high promoter pledge >20% or extreme debt >3.0 D/E). Capital preservation priority.',
      isStrongBuyEligible: false
    };
  }

  // 4. Critical news red flag
  if (newsSignal?.hasVerifiedCriticalRedFlag) {
    return {
      signal: 'AVOID',
      reason: `Critical negative news: ${newsSignal.articles?.find(a => a.hasCriticalRedFlag)?.title || 'See news panel'}.`,
      isStrongBuyEligible: false
    };
  }

  // 5. Downtrend (Stage 4) or trading below 30-week SMA — strictly prohibited from Buy entry
  if (trendData.weinsteinStage === 4 || (!trendData.isIpo && trendData.sma30Week && currentPrice <= trendData.sma30Week)) {
    return {
      signal: 'AVOID',
      reason: trendData.weinsteinStage === 4
        ? 'Stock in Stage 4 structural decline — wait for Stage 1 base before considering entry.'
        : `Trading below 30-week moving average (CMP ₹${currentPrice.toFixed(2)} ≤ SMA ₹${trendData.sma30Week.toFixed(2)}). Bottom-fishing in sub-SMA territory is strictly prohibited.`,
      isStrongBuyEligible: false
    };
  }

  // 6. Chronic loss-maker gate: quarterly net loss bars BUY entry
  const quarterlyPat = Array.isArray(fundamentals.quarterlyPat || fundamentals.quarterRows?.['Net Profit'])
    ? (fundamentals.quarterlyPat || fundamentals.quarterRows?.['Net Profit']).map(Number).filter(Number.isFinite)
    : [];
  const latestQuarterPat = quarterlyPat.length > 0 ? quarterlyPat.at(-1) : null;
  if (latestQuarterPat !== null && latestQuarterPat < 0) {
    return {
      signal: 'WATCH',
      reason: `Latest reported quarter posted a net loss (PAT: ₹${latestQuarterPat} Cr). Awaiting profitability turnaround before allocating fresh buy capital.`,
      isStrongBuyEligible: false
    };
  }

  // 7. Excessive leverage gate: non-BFSI debt-to-equity > 1.8 cannot enter BUY
  const isBfsi = fundResult.financialSector;
  const de = Number(fundamentals.debtToEquity);
  if (!isBfsi && Number.isFinite(de) && de > 1.8) {
    return {
      signal: 'WATCH',
      reason: `High balance sheet leverage (D/E ${de.toFixed(2)} > 1.8 safety ceiling). High interest burden increases vulnerability during economic slowdowns.`,
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

      // Relative Strength Momentum vs Benchmark (126-day / 6-month momentum proxy)
      const idx126 = prices.length - 1 - 126;
      const p126 = idx126 >= 0 ? prices[idx126].close : (prices[0]?.close || currentPrice);
      const rsScore = p126 > 0 ? ((currentPrice / p126) - 1) * 100 : 0;
      const normalizedRs = Math.max(0, Math.min(100, Math.round(50 + rsScore * 0.5)));

      // Technical buy score
      const techResult = computeTechnicalBuyScore(trendData, chartinkFilter, currentPrice, high52w, prices);
      if (normalizedRs >= 80) {
        techResult.signals.push(`Top-decile Relative Strength momentum (+${rsScore.toFixed(1)}%/6mo, RS ${normalizedRs}/100) ✓`);
      } else if (normalizedRs >= 65) {
        techResult.signals.push(`Strong Relative Strength momentum (+${rsScore.toFixed(1)}%/6mo, RS ${normalizedRs}/100) ✓`);
      }

      // Fundamental score
      const fundResult = computeFundamentalScore(fundamentals);
      if (normalizedRs >= 75 && Array.isArray(fundResult.tags) && !fundResult.tags.some(t => t.tag === 'HIGH_RS')) {
        fundResult.tags.unshift({
          tag: 'HIGH_RS',
          label: `High Relative Strength (RS ${normalizedRs})`,
          color: 'emerald',
          informational: true
        });
      }

      // Multibagger Probability Score (MPS): 50% Relative Strength + 50% Fundamental/Technical Composite
      const baseComposite = Math.round((techResult.score + fundResult.score) / 2);
      const mps = Math.round(0.50 * normalizedRs + 0.50 * baseComposite);

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
        sector: resolveCanonicalSector(fundamentals, resolvedName, clean),
        industry: fundamentals.industry || 'Unknown',
        market_cap: fundamentals.mcapCategory || (fundamentals.marketCapCr ? (fundamentals.marketCapCr >= 500000 ? 'Mega Cap' : fundamentals.marketCapCr >= 85000 ? 'Large Cap' : fundamentals.marketCapCr >= 27500 ? 'Mid Cap' : fundamentals.marketCapCr >= 5000 ? 'Small Cap' : 'Micro Cap') : 'Small Cap'),
        market_cap_cr: fundamentals.marketCapCr || null,
        inPortfolio,
        portfolioQuantity: inPortfolio ? portfolioQuantity : 0,
        portfolioAvgPrice: inPortfolio ? portfolioAvgPrice : 0,

        // Scores
        technicalScore: techResult.score,
        fundamentalScore: fundResult.score,
        compositeScore: baseComposite,
        rsScore: Number(rsScore.toFixed(1)),
        normalizedRs,
        mps,
        multibaggerProbabilityScore: mps,
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
        cmp: currentPrice,
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
        marketCap: fundamentals.marketCapCr || null,
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
      if (a.normalizedRs !== undefined) {
        a.mps = Math.min(100, Math.round(0.50 * a.normalizedRs + 0.50 * a.compositeScore));
        a.multibaggerProbabilityScore = a.mps;
      }
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
  // Within signals: prioritize Multibagger Probability Score (MPS) descending, then compositeScore descending
  const signalOrder = { STRONG_BUY: 0, BUY: 1, WATCH: 2, INSUFFICIENT_DATA: 3, MONITOR: 4, AVOID: 5 };
  results.sort((a, b) => {
    const orderDiff = (signalOrder[a.buySignal] ?? 99) - (signalOrder[b.buySignal] ?? 99);
    if (orderDiff !== 0) return orderDiff;
    const mpsDiff = (b.mps ?? b.compositeScore) - (a.mps ?? a.compositeScore);
    if (mpsDiff !== 0) return mpsDiff;
    return b.compositeScore - a.compositeScore; // Within same signal and MPS, higher score first
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
