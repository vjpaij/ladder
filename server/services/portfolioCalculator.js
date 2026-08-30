/**
 * portfolioCalculator.js - Single Source of Truth Valuation Engine
 * 
 * Standardized across ALL views: Dashboard (/api/summary), Calendar (/api/daily-pnl),
 * Category Pages (/api/holdings), Holding Detail Modals, and EOD Rebuild Scripts.
 */

/**
 * Computes exact holding valuation in INR with consistent 2-decimal financial rounding.
 * 
 * @param {Object} holding - Holding object from DB
 * @param {number|null} overridePrice - Optional price (e.g. from historical cache or live cache)
 * @param {number} fxRate - Current or historical USD/INR rate
 * @returns {number} Value in INR rounded to 2 decimal places
 */
export function computeHoldingValueINR(holding, overridePrice = null, fxRate = 87.25) {
  const qty = Number(holding.quantity) || 0;
  if (qty <= 0) {
    // EOD / Balance based holdings (Bank, EPF, Loan, etc.)
    const balance = overridePrice !== null && overridePrice !== undefined 
      ? Number(overridePrice) 
      : (Number(holding.current_price) || 0);
    return Number(balance.toFixed(2));
  }

  const price = overridePrice !== null && overridePrice !== undefined && overridePrice > 0
    ? Number(overridePrice)
    : (Number(holding.current_price) || 0);

  const rate = holding.currency === 'USD' ? fxRate : 1.0;
  return Number((qty * price * rate).toFixed(2));
}

/**
 * Computes unified portfolio valuation breakdown across all categories.
 * 
 * @param {Array} holdings - Array of holding objects
 * @param {Array} liabilities - Array of liability objects
 * @param {Object} priceMap - Map of symbol -> price (optional)
 * @param {number} fxRate - USD/INR exchange rate
 * @returns {Object} Canonical valuation snapshot
 */
export function computePortfolioValuation(holdings = [], liabilities = [], priceMap = {}, fxRate = 87.25) {
  let savings = 0;
  let hdfc = 0;
  let indusind = 0;
  let idfc = 0;
  let rbl = 0;
  let sbi = 0;
  let federal = 0;
  let epf = 0;
  let mutual_funds = 0;
  let indian_stocks = 0;
  let us_stocks = 0;
  let nps = 0;

  holdings.forEach(h => {
    const qty = Number(h.quantity) || 0;
    const price = priceMap[h.symbol] !== undefined ? priceMap[h.symbol] : null;

    if (h.category_id === 'bank') {
      const val = computeHoldingValueINR(h, price, fxRate);
      const name = (h.name || '').toLowerCase();
      if (name.includes('hdfc')) hdfc = val;
      else if (name.includes('indusind')) indusind = val;
      else if (name.includes('idfc')) idfc = val;
      else if (name.includes('rbl')) rbl = val;
      else if (name.includes('sbi')) sbi = val;
      else if (name.includes('federal')) federal = val;
      savings = Number((savings + val).toFixed(2));
    } else if (h.category_id === 'epf') {
      epf = computeHoldingValueINR(h, price, fxRate);
    } else if (qty > 0) {
      const val = computeHoldingValueINR(h, price, fxRate);
      if (h.category_id === 'in_stocks') indian_stocks = Number((indian_stocks + val).toFixed(2));
      else if (h.category_id === 'us_stocks') us_stocks = Number((us_stocks + val).toFixed(2));
      else if (h.category_id === 'mutual_funds') mutual_funds = Number((mutual_funds + val).toFixed(2));
      else if (h.category_id === 'nps') nps = Number((nps + val).toFixed(2));
    }
  });

  // If specific bank balances weren't itemized, ensure savings equals their sum
  const bankSum = Number((hdfc + indusind + idfc + rbl + sbi + federal).toFixed(2));
  if (bankSum > 0 && Math.abs(savings - bankSum) > 0.05) {
    savings = bankSum;
  }

  let loan = 0;
  let credits = 0;
  liabilities.forEach(l => {
    const bal = Number((Number(l.outstanding_balance) || 0).toFixed(2));
    if (l.type === 'credit_card' || l.category_id === 'credit_cards' || (l.name && l.name.toLowerCase().includes('credit'))) {
      credits = Number((credits + bal).toFixed(2));
    } else {
      loan = Number((loan + bal).toFixed(2));
    }
  });
  const debt = Number((loan + credits).toFixed(2));

  const total_assets = Number((savings + epf + mutual_funds + indian_stocks + us_stocks + nps).toFixed(2));
  const total_wealth = Number((total_assets - debt).toFixed(2));

  return {
    hdfc,
    indusind,
    idfc,
    rbl,
    sbi,
    federal,
    savings,
    mutual_funds,
    indian_stocks,
    us_stocks,
    nps,
    epf,
    loan,
    credits,
    debt,
    total_assets,
    wealth: total_wealth,
    total_wealth
  };
}
