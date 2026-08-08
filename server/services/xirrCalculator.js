// XIRR (Extended Internal Rate of Return) Calculator
// Uses Newton-Raphson method for precise annual rate calculation

export function calculateXirr(cashflows, guess = 0.1) {
  if (!cashflows || cashflows.length < 2) return 0;

  // Ensure cashflows sorted by date ascending
  const sorted = [...cashflows].sort((a, b) => new Date(a.date) - new Date(b.date));
  const t0 = new Date(sorted[0].date).getTime();

  function xnpv(rate) {
    let sum = 0;
    for (const cf of sorted) {
      const dt = (new Date(cf.date).getTime() - t0) / (1000 * 3600 * 24 * 365);
      sum += cf.amount / Math.pow(1 + rate, dt);
    }
    return sum;
  }

  function dxnpv(rate) {
    let sum = 0;
    for (const cf of sorted) {
      const dt = (new Date(cf.date).getTime() - t0) / (1000 * 3600 * 24 * 365);
      sum -= (dt * cf.amount) / Math.pow(1 + rate, dt + 1);
    }
    return sum;
  }

  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const f = xnpv(rate);
    const df = dxnpv(rate);
    if (Math.abs(df) < 1e-7) break;
    const nextRate = rate - f / df;
    if (Math.abs(nextRate - rate) < 1e-6) {
      return Number((nextRate * 100).toFixed(2));
    }
    rate = nextRate;
  }

  return Number((rate * 100).toFixed(2));
}

export function calculateAbsoluteReturn(invested, currentValue) {
  if (invested <= 0) return 0;
  const gain = currentValue - invested;
  return Number(((gain / invested) * 100).toFixed(2));
}
