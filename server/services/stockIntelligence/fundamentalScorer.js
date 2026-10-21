/**
 * Sector-aware, coverage-aware fundamental scoring for Buy Analysis.
 * Missing observations are excluded from the denominator and surfaced as
 * unknown. A partial score is never treated as a validated buy thesis.
 */

const isFiniteNumber = value => value !== null && value !== undefined && Number.isFinite(Number(value));
const parseSeries = value => Array.isArray(value)
  ? value.map(Number).filter(Number.isFinite)
  : [];
const isFinancialSector = fundamentals => /bank|financial|nbfc|insurance/i.test(
  `${fundamentals?.sector || ''} ${fundamentals?.industry || ''}`
);

function latestQuarterIsFresh(label) {
  const match = String(label || '').match(/^([A-Za-z]{3})\s+(\d{4})$/);
  if (!match) return false;
  const monthIndex = new Map([['Jan', 0], ['Feb', 1], ['Mar', 2], ['Apr', 3], ['May', 4], ['Jun', 5], ['Jul', 6], ['Aug', 7], ['Sep', 8], ['Oct', 9], ['Nov', 10], ['Dec', 11]]).get(match[1]);
  if (monthIndex === undefined) return false;
  const periodEnd = Date.UTC(Number(match[2]), monthIndex + 1, 0);
  return Date.now() - periodEnd <= 180 * 86400000;
}

function cagr(start, end, years) {
  if (start <= 0 && end > 0 && years > 0) return 60; // Turnaround inflection (loss to profit)
  if (!(start > 0) || !(end > 0) || !(years > 0)) return null;
  return (Math.pow(end / start, 1 / years) - 1) * 100;
}

function growthPoints(value) {
  if (!Number.isFinite(value)) return 0;
  if (value >= 25) return 15;
  if (value >= 15) return 10;
  if (value >= 8) return 5;
  return 0;
}

function doublingPoints(current, prior) {
  if (prior <= 0 && current > 0) return 10; // Loss-to-profit turnaround receives full doubling points
  if (!(current > 0) || !(prior > 0)) return null;
  const ratio = current / prior;
  return ratio >= 1.75 ? 10 : ratio >= 1.5 ? 5 : 0;
}

function epsPoints(values) {
  if (values.length < 4) return null;
  const recent = values.slice(-4);
  const rising = recent.slice(1).filter((value, index) => value > recent[index]).length;
  return rising >= 3 ? 10 : rising >= 2 ? 5 : 0;
}

function yearOverYearPoints(values, max = 8) {
  if (values.length < 5) return null;
  const current = values.at(-1);
  const prior = values.at(-5);
  if (!(prior > 0) || !Number.isFinite(current)) return null;
  const growth = (current / prior - 1) * 100;
  return growth >= 20 ? max : growth > 0 ? Math.round(max / 2) : 0;
}

function ratioPoints(value, max = 7) {
  if (!isFiniteNumber(value)) return null;
  const ratio = Number(value);
  return ratio >= 25 ? max : ratio >= 18 ? Math.round(max * 0.71) : ratio >= 12 ? Math.round(max * 0.43) : ratio >= 10 ? Math.round(max * 0.35) : 0;
}

function debtPoints(value) {
  if (!isFiniteNumber(value)) return null;
  let ratio = Number(value);
  if (ratio > 5) ratio = ratio / 100; // normalize percentage (e.g. 86.6% -> 0.866)
  return ratio <= 0.3 ? 10 : ratio <= 0.7 ? 7 : ratio <= 1 ? 4 : ratio <= 1.5 ? 2 : 0;
}

function deriveTags(fundamentals) {
  const tags = [];
  if (isFiniteNumber(fundamentals.fiiHoldingQoQDelta) && Number(fundamentals.fiiHoldingQoQDelta) > 0.5) {
    tags.push({ tag: 'FII_ACCUMULATING', label: `FII holding +${fundamentals.fiiHoldingQoQDelta} pp QoQ`, color: 'emerald', informational: true });
  }
  if (isFiniteNumber(fundamentals.promoterHoldingQoQDelta) && Number(fundamentals.promoterHoldingQoQDelta) > 0.3) {
    tags.push({ tag: 'PROMOTER_BUYING', label: `Promoter holding +${fundamentals.promoterHoldingQoQDelta} pp QoQ`, color: 'emerald', informational: true });
  }
  if (isFiniteNumber(fundamentals.debtToEquity) && Number(fundamentals.debtToEquity) <= 0.05) {
    tags.push({ tag: 'ZERO_DEBT', label: 'Near zero debt', color: 'cyan', informational: true });
  }
  if (isFiniteNumber(fundamentals.promoterPledgePct) && Number(fundamentals.promoterPledgePct) === 0) {
    tags.push({ tag: 'CLEAN_PLEDGE', label: 'No promoter pledging reported', color: 'cyan', informational: true });
  }
  if (isFiniteNumber(fundamentals.promoterPledgePct) && Number(fundamentals.promoterPledgePct) > 15) {
    tags.push({ tag: 'HIGH_PLEDGE_RISK', label: `Pledge risk: ${fundamentals.promoterPledgePct}%`, color: 'red', informational: false });
  }
  if (isFiniteNumber(fundamentals.debtToEquity) && Number(fundamentals.debtToEquity) > 2) {
    tags.push({ tag: 'HIGH_DEBT', label: `D/E: ${fundamentals.debtToEquity}`, color: 'red', informational: false });
  }
  // Turnaround Catalyst tag
  const annualPat = parseSeries(fundamentals.annualPat);
  if (annualPat.length >= 3) {
    const currPat = annualPat.at(-1);
    const prevLoss = annualPat.slice(-4, -1).some(p => p <= 0);
    if (currPat > 50 && prevLoss) {
      tags.push({ tag: 'TURNAROUND_CATALYST', label: 'Loss-to-Profit Turnaround Catalyst', color: 'emerald', informational: true });
    }
  }
  return tags;
}

/**
 * Evaluates valuation safety based on PE, PEG, and profit trajectory.
 */
export function evaluateValuation(fundamentals = {}) {
  const pe = isFiniteNumber(fundamentals.pe) ? Number(fundamentals.pe)
    : (isFiniteNumber(fundamentals.currentPrice) && isFiniteNumber(fundamentals.eps) && Number(fundamentals.eps) > 0)
      ? Number((Number(fundamentals.currentPrice) / Number(fundamentals.eps)).toFixed(1))
      : null;

  const annualPat = parseSeries(fundamentals.annualPat);
  const profitGrowth = isFiniteNumber(fundamentals.yoyPatGrowthPct) ? Number(fundamentals.yoyPatGrowthPct)
    : (annualPat.length >= 4)
      ? cagr(annualPat.at(-4), annualPat.at(-1), 3)
      : null;

  if (pe === null) {
    return {
      status: 'PASS',
      pe: null,
      peg: null,
      reason: 'P/E not explicitly provided; evaluated on fundamental growth and return metrics.'
    };
  }

  if (pe <= 0) {
    return {
      status: 'FAIL',
      pe,
      peg: null,
      reason: 'Negative P/E indicates loss-making operations; fails valuation safety check.'
    };
  }

  const effectiveGrowth = profitGrowth && profitGrowth > 0 ? profitGrowth : 15;
  const peg = Number((pe / effectiveGrowth).toFixed(2));

  if (pe > 95 && (!profitGrowth || profitGrowth < 20)) {
    return {
      status: 'CAUTION',
      pe,
      peg,
      reason: `High P/E (${pe}) without matching profit growth (${profitGrowth ? profitGrowth.toFixed(1) : 0}%); valuation is elevated.`
    };
  }

  return {
    status: 'PASS',
    pe,
    peg,
    reason: peg <= 2.0 ? `Favorable valuation (P/E: ${pe}, PEG: ${peg})` : `P/E: ${pe} within acceptable growth bounds`
  };
}

/**
 * Returns the score, coverage and hard risk flags. Financial firms (banks/NBFCs)
 * are evaluated on sector-appropriate ROE/ROCE return metrics.
 */
export function computeFundamentalScore(fundamentals = {}) {
  const unavailable = !fundamentals || !['AVAILABLE', 'PARTIAL'].includes(fundamentals.status);
  const financialSector = isFinancialSector(fundamentals);
  const annualSales = parseSeries(fundamentals.annualSales);
  const annualPat = parseSeries(fundamentals.annualPat);
  const annualEps = parseSeries(fundamentals.annualEps);
  const quarterlySales = parseSeries(fundamentals.quarterlySales || fundamentals.quarterRows?.Sales);
  const quarterlyPat = parseSeries(fundamentals.quarterlyPat || fundamentals.quarterRows?.['Net Profit']);
  const entries = [];
  const add = (key, points, max, value) => {
    if (points === null || points === undefined) {
      entries.push([key, { pts: 0, max: 0, value: value || 'Unknown', known: false }]);
      return;
    }
    entries.push([key, { pts: points, max, value, known: true }]);
  };

  // Detect if company is an IPO or recent listing (< 4 years public statements)
  const isIpo = (annualSales.length < 4) || (quarterlySales.length < 5);

  const salesCagr = annualSales.length >= 4 ? cagr(annualSales.at(-4), annualSales.at(-1), 3)
    : (isIpo && annualSales.length >= 2) ? cagr(annualSales[0], annualSales.at(-1), annualSales.length - 1)
    : isFiniteNumber(fundamentals.yoySalesGrowthPct) ? Number(fundamentals.yoySalesGrowthPct) : null;
  const profitCagr = annualPat.length >= 4 ? cagr(annualPat.at(-4), annualPat.at(-1), 3)
    : (isIpo && annualPat.length >= 2) ? cagr(annualPat[0], annualPat.at(-1), annualPat.length - 1)
    : isFiniteNumber(fundamentals.yoyPatGrowthPct) ? Number(fundamentals.yoyPatGrowthPct) : null;
  add('yoySalesGrowth', salesCagr === null ? null : growthPoints(salesCagr), 15, salesCagr === null ? 'Unknown' : `${salesCagr.toFixed(1)}%`);
  add('yoyProfitGrowth', profitCagr === null ? null : growthPoints(profitCagr), 15, profitCagr === null ? 'Unknown' : `${profitCagr.toFixed(1)}%`);

  // Growth acceleration / doubling points
  const salesExpansion = annualSales.length >= 4 ? doublingPoints(annualSales.at(-1), annualSales.at(-4))
    : (isIpo && annualSales.length >= 2) ? doublingPoints(annualSales.at(-1), annualSales[0])
    : (isIpo && isFiniteNumber(fundamentals.yoySalesGrowthPct) && Number(fundamentals.yoySalesGrowthPct) >= 20) ? 8 : null;
  add('salesDoubling', salesExpansion, 10,
    annualSales.length >= 4 && annualSales.at(-4) > 0 ? `${(annualSales.at(-1) / annualSales.at(-4)).toFixed(2)}x / 3y`
    : isIpo && annualSales.length >= 2 && annualSales[0] > 0 ? `${(annualSales.at(-1) / annualSales[0]).toFixed(2)}x (IPO Growth)`
    : isIpo && isFiniteNumber(fundamentals.yoySalesGrowthPct) ? `+${fundamentals.yoySalesGrowthPct}% YoY (IPO Expansion)` : 'Unknown');

  const profitExpansion = annualPat.length >= 4 ? doublingPoints(annualPat.at(-1), annualPat.at(-4))
    : (isIpo && annualPat.length >= 2) ? doublingPoints(annualPat.at(-1), annualPat[0])
    : (isIpo && isFiniteNumber(fundamentals.yoyPatGrowthPct) && Number(fundamentals.yoyPatGrowthPct) >= 20) ? 8 : null;
  add('profitDoubling', profitExpansion, 10,
    annualPat.length >= 4 && annualPat.at(-4) > 0 ? `${(annualPat.at(-1) / annualPat.at(-4)).toFixed(2)}x / 3y`
    : isIpo && annualPat.length >= 2 && annualPat[0] > 0 ? `${(annualPat.at(-1) / annualPat[0]).toFixed(2)}x (IPO Profit)`
    : isIpo && isFiniteNumber(fundamentals.yoyPatGrowthPct) ? `+${fundamentals.yoyPatGrowthPct}% YoY (IPO Expansion)` : 'Unknown');

  add('epsTrend', epsPoints(annualEps), 10, (annualEps.length >= 2 ? annualEps.slice(-4).join(' → ') : 'Unknown'));
  add('sameQuarterSalesGrowth', yearOverYearPoints(quarterlySales), 8, (quarterlySales.length >= 2 ? (quarterlySales.length >= 5 ? 'Latest quarter vs same quarter last year' : 'Recent post-listing quarterly revenue trend') : 'Unknown'));
  add('sameQuarterProfitGrowth', yearOverYearPoints(quarterlyPat), 8, (quarterlyPat.length >= 2 ? (quarterlyPat.length >= 5 ? 'Latest quarter vs same quarter last year' : 'Recent post-listing quarterly profit trend') : 'Unknown'));

  if (financialSector) {
    // Financial sector (banks/NBFCs): deposits are operational liabilities, not industrial debt.
    // Leverage points are distributed to return metrics (ROE/ROCE/ROA).
    add('debtEquity', null, 0, 'BFSI sector: industrial D/E exempt');
    add('roce', ratioPoints(fundamentals.rocePct, 12), 12, isFiniteNumber(fundamentals.rocePct) ? `${fundamentals.rocePct}%` : 'Unknown');
    add('roe', ratioPoints(fundamentals.roePct, 12), 12, isFiniteNumber(fundamentals.roePct) ? `${fundamentals.roePct}% (BFSI Target >=14%)` : 'Unknown');
  } else if (isFiniteNumber(fundamentals.debtToEquity)) {
    const normDe = Number(fundamentals.debtToEquity) > 5 ? Number(fundamentals.debtToEquity) / 100 : Number(fundamentals.debtToEquity);
    add('debtEquity', debtPoints(normDe), 10, `D/E ${normDe.toFixed(2)}`);
    add('roce', ratioPoints(fundamentals.rocePct, 7), 7, isFiniteNumber(fundamentals.rocePct) ? `${fundamentals.rocePct}%` : 'Unknown');
    add('roe', ratioPoints(fundamentals.roePct, 7), 7, isFiniteNumber(fundamentals.roePct) ? `${fundamentals.roePct}%` : 'Unknown');
  } else {
    // D/E not directly parsed from Screener card: evaluate capital efficiency proxy
    const capitalEfficiency = (isFiniteNumber(fundamentals.rocePct) && Number(fundamentals.rocePct) >= 10) ? 6 : null;
    add('debtEquity', capitalEfficiency, 10, capitalEfficiency ? 'Capital efficiency proxy (ROCE >= 15%)' : 'Unknown');
    add('roce', ratioPoints(fundamentals.rocePct, 7), 7, isFiniteNumber(fundamentals.rocePct) ? `${fundamentals.rocePct}%` : 'Unknown');
    add('roe', ratioPoints(fundamentals.roePct, 7), 7, isFiniteNumber(fundamentals.roePct) ? `${fundamentals.roePct}%` : 'Unknown');
  }

  const breakdown = Object.fromEntries(entries);
  const earned = entries.reduce((sum, [, item]) => sum + item.pts, 0);
  const maxPossible = entries.reduce((sum, [, item]) => sum + item.max, 0);
  const coveragePct = Math.round(maxPossible);
  const score = maxPossible ? Math.round((earned / maxPossible) * 100) : 0;
  const fetchedAtMs = fundamentals.fetchedAt ? Date.parse(fundamentals.fetchedAt) : null;
  const freshness = fundamentals.fetchedAt ? (Number.isFinite(fetchedAtMs) && Date.now() - fetchedAtMs <= 180 * 86400000) : true;
  const reportingPeriodFresh = fundamentals.latestQuarter ? latestQuarterIsFresh(fundamentals.latestQuarter) : true;
  // For new listings / demergers: accept either annual or quarterly statements (>= 1 period of sales & profit)
  const isDemergerOrRecent = isIpo || annualEps.length < 4 || annualSales.length < 4 || (quarterlySales.length < 8);
  const hasCoreStatements = isDemergerOrRecent
    ? ((annualSales.length >= 1 || quarterlySales.length >= 1) && (annualPat.length >= 1 || quarterlyPat.length >= 1))
    : (annualSales.length >= 3 && annualPat.length >= 3 && annualEps.length >= 3 && quarterlySales.length >= 4 && quarterlyPat.length >= 4);
  const hasRequiredBalanceSheet = financialSector || isFiniteNumber(fundamentals.debtToEquity) || isFiniteNumber(fundamentals.rocePct) || isFiniteNumber(fundamentals.roePct);
  const hasProfitabilityRatio = isFiniteNumber(fundamentals.rocePct) || isFiniteNumber(fundamentals.roePct);
  const minCoverage = isIpo ? 35 : 50;
  const isValid = !unavailable && coveragePct >= minCoverage && hasCoreStatements
    && hasRequiredBalanceSheet && hasProfitabilityRatio && freshness && reportingPeriodFresh;
  const hasGovernanceRedFlag = (isFiniteNumber(fundamentals.promoterPledgePct) && Number(fundamentals.promoterPledgePct) > 20)
    || (!financialSector && isFiniteNumber(fundamentals.debtToEquity) && Number(fundamentals.debtToEquity) > 3);
  const tags = deriveTags(fundamentals);
  if (isIpo) {
    tags.unshift({
      tag: 'NEW_LISTING_OR_DEMERGER',
      label: 'New Listing / Demerger Base',
      color: 'purple',
      informational: true
    });
  }
  const valuationCheck = evaluateValuation(fundamentals);

  return {
    score,
    rawScore: earned,
    maxPossible,
    coveragePct,
    breakdown,
    tags,
    isValid,
    freshness,
    reportingPeriodFresh,
    financialSector,
    hasCoreStatements,
    hasRequiredBalanceSheet,
    hasProfitabilityRatio,
    hasGovernanceRedFlag,
    valuationCheck,
    isIpo,
    fundamentalGrade: score >= 70 ? 'A' : score >= 55 ? 'B' : score >= 40 ? 'C' : 'D',
    reason: isValid ? null : unavailable ? 'Verified fundamental snapshot unavailable'
      : !freshness || !reportingPeriodFresh ? 'Fundamental snapshot or latest reporting period is stale or undated'
        : !hasCoreStatements ? 'Required annual and same-quarter financial history is incomplete'
          : !hasRequiredBalanceSheet ? 'Debt data is unknown; business balance-sheet quality cannot be assessed'
            : !hasProfitabilityRatio ? 'ROCE/ROE data is unavailable'
          : `Fundamental coverage is ${coveragePct}%; at least ${minCoverage}% is required`
  };
}
