// XIRR (Extended Internal Rate of Return) Calculator
// Uses Newton-Raphson with bisection fallback for guaranteed convergence

export function calculateXirr(cashflows, guess = 0.1) {
  if (!cashflows || !Array.isArray(cashflows)) return 0;
  const valid = cashflows.filter(cf => cf && cf.date && !Number.isNaN(Number(cf.amount)) && Number(cf.amount) !== 0);
  if (valid.length < 2) return 0;

  // Need at least one negative (outflow) and one positive (inflow/valuation)
  const hasNeg = valid.some(cf => cf.amount < 0);
  const hasPos = valid.some(cf => cf.amount > 0);
  if (!hasNeg || !hasPos) return 0;

  // Ensure cashflows sorted by date ascending
  const sorted = [...valid].sort((a, b) => new Date(a.date) - new Date(b.date));
  const t0 = new Date(sorted[0].date).getTime();
  const MS_PER_YEAR = 1000 * 3600 * 24 * 365.25;

  function xnpv(rate) {
    let sum = 0;
    for (const cf of sorted) {
      const dt = (new Date(cf.date).getTime() - t0) / MS_PER_YEAR;
      const denom = Math.pow(1 + rate, dt);
      if (!Number.isFinite(denom) || denom === 0) return NaN;
      sum += cf.amount / denom;
    }
    return sum;
  }

  function dxnpv(rate) {
    let sum = 0;
    for (const cf of sorted) {
      const dt = (new Date(cf.date).getTime() - t0) / MS_PER_YEAR;
      const denom = Math.pow(1 + rate, dt + 1);
      if (!Number.isFinite(denom) || denom === 0) return NaN;
      sum -= (dt * cf.amount) / denom;
    }
    return sum;
  }

  const sanitizeRate = (r) => {
    if (!Number.isFinite(r)) return 0;
    // Cap XIRR between -99.9% and +300% to prevent extreme mathematical artifacts
    const clamped = Math.max(-0.999, Math.min(3.0, r));
    return Number((clamped * 100).toFixed(2));
  };

  // 1. Try Newton-Raphson first (fast convergence)
  let rate = guess;
  for (let i = 0; i < 200; i++) {
    const f = xnpv(rate);
    const df = dxnpv(rate);
    if (!Number.isFinite(f) || !Number.isFinite(df) || Math.abs(df) < 1e-10) break;
    const nextRate = rate - f / df;
    if (!Number.isFinite(nextRate)) break;
    if (nextRate <= -1) { rate = -0.99; break; } // clamp
    if (Math.abs(nextRate - rate) < 1e-7) {
      return sanitizeRate(nextRate);
    }
    rate = nextRate;
  }

  // 2. Bisection fallback (guaranteed convergence)
  let lo = -0.99;
  let hi = 3.0; // 300% XIRR cap
  let fLo = xnpv(lo);
  let fHi = xnpv(hi);

  // Expand bounds if needed
  if (Number.isFinite(fLo) && Number.isFinite(fHi)) {
    if (fLo * fHi > 0) {
      for (let bound = 4; bound <= 10; bound += 2) {
        fHi = xnpv(bound);
        if (Number.isFinite(fHi) && fLo * fHi < 0) { hi = bound; break; }
      }
    }
  }

  fLo = xnpv(lo);
  fHi = xnpv(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) {
    if (Number.isFinite(rate) && rate > -1) return sanitizeRate(rate);
    return 0;
  }

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = xnpv(mid);
    if (!Number.isFinite(fMid)) break;
    if (Math.abs(fMid) < 1e-6 || (hi - lo) < 1e-8) {
      return sanitizeRate(mid);
    }
    if (fMid * fLo < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }

  const finalRate = (lo + hi) / 2;
  return sanitizeRate(finalRate);
}

export function calculateAbsoluteReturn(invested, currentValue) {
  if (invested <= 0) return 0;
  const gain = currentValue - invested;
  return Number(((gain / invested) * 100).toFixed(2));
}
