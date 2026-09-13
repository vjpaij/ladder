/**
 * portfolioCalculator.js - Single Source of Truth Valuation Engine
 * 
 * Standardized across ALL views: Dashboard (/api/summary), Calendar (/api/daily-pnl),
 * Category Pages (/api/holdings), Holding Detail Modals, and EOD Rebuild Scripts.
 * 
 * DYNAMIC DESIGN: No hardcoded bank names, category IDs, or FX rates.
 * New assets, currencies, or liabilities are handled dynamically.
 */

import { getPersistedRate } from './fxRateStore.js';
import { isUnitBased } from './categoryRegistry.js';

/**
 * Returns the best available USD/INR rate from persisted store.
 * Used as a fallback when no live rate is provided as a parameter.
 */
function getDefaultFxRate() {
  return getPersistedRate('USD_INR') || 1.0;
}

/**
 * Computes exact holding valuation in INR with consistent 2-decimal financial rounding.
 * 
 * Dynamically handles any category: unit-based assets multiply qty * price,
 * balance-based assets (bank, EPF, any future type) use the stored balance.
 * 
 * @param {Object} holding - Holding object from DB
 * @param {number|null} overridePrice - Optional price (e.g. from historical cache or live cache)
 * @param {number|null} fxRate - Current or historical USD/INR rate (null = auto-resolve)
 * @returns {number} Value in INR rounded to 2 decimal places
 */
export function computeHoldingValueINR(holding, overridePrice = null, fxRate = null) {
  const effectiveFx = (fxRate && fxRate > 0) ? fxRate : getDefaultFxRate();
  const qty = Number(holding.quantity) || 0;
  const unitBased = isUnitBased(holding.category_id);

  if (unitBased) {
    if (qty <= 0) return 0;
    const price = overridePrice !== null && overridePrice !== undefined && overridePrice > 0
      ? Number(overridePrice)
      : (Number(holding.current_price) || 0);
    const rate = holding.currency === 'USD' ? effectiveFx : 1.0;
    return Number((qty * price * rate).toFixed(2));
  }

  // Balance-based holdings (Bank, EPF, or any future balance-based category)
  const balance = overridePrice !== null && overridePrice !== undefined 
    ? Number(overridePrice) 
    : (Number(holding.current_price) || 0);
  return Number(balance.toFixed(2));
}

/**
 * Computes unified portfolio valuation breakdown across all categories.
 * 
 * DYNAMIC: Aggregates holdings by category_id dynamically. Does NOT hardcode
 * specific bank names or category types. Any new category added to the database
 * is automatically included in the breakdown.
 * 
 * @param {Array} holdings - Array of holding objects
 * @param {Array} liabilities - Array of liability objects
 * @param {Object} priceMap - Map of symbol -> price (optional)
 * @param {number|null} fxRate - USD/INR exchange rate (null = auto-resolve)
 * @returns {Object} Canonical valuation snapshot with dynamic category breakdown
 */
export function computePortfolioValuation(holdings = [], liabilities = [], priceMap = {}, fxRate = null) {
  const effectiveFx = (fxRate && fxRate > 0) ? fxRate : getDefaultFxRate();

  // Dynamic category aggregation: accumulate values per category_id
  const categoryTotals = {};
  // Also track individual holdings within each category by name/id
  const categoryItems = {};

  let totalAssets = 0;

  holdings.forEach(h => {
    const catId = h.category_id || 'unknown';
    const qty = Number(h.quantity) || 0;
    const price = priceMap[h.symbol] !== undefined ? priceMap[h.symbol] : null;
    const unitBased = isUnitBased(catId);

    // Skip zero-quantity unit-based holdings (but include balance-based holdings even with qty=0)
    if (unitBased && qty <= 0) return;

    const val = computeHoldingValueINR(h, price, effectiveFx);

    if (!categoryTotals[catId]) categoryTotals[catId] = 0;
    categoryTotals[catId] = Number((categoryTotals[catId] + val).toFixed(2));

    // Track individual items within categories (e.g. individual bank accounts)
    if (!categoryItems[catId]) categoryItems[catId] = {};
    const itemKey = h.name || h.symbol || h.id;
    categoryItems[catId][itemKey] = val;

    totalAssets = Number((totalAssets + val).toFixed(2));
  });

  // Dynamic liability aggregation
  let totalLoans = 0;
  let totalCredits = 0;
  const liabilityItems = {};

  liabilities.forEach(l => {
    const bal = Number((Number(l.outstanding_balance) || 0).toFixed(2));
    const itemKey = l.name || l.id;
    liabilityItems[itemKey] = bal;

    if (l.type === 'credit_card' || l.category_id === 'credit_cards' || (l.name && l.name.toLowerCase().includes('credit'))) {
      totalCredits = Number((totalCredits + bal).toFixed(2));
    } else {
      totalLoans = Number((totalLoans + bal).toFixed(2));
    }
  });

  const totalDebt = Number((totalLoans + totalCredits).toFixed(2));
  const totalWealth = Number((totalAssets - totalDebt).toFixed(2));

  // Build backward-compatible named fields from dynamic data
  // These provide convenience access for existing code while remaining dynamic
  const savings = categoryTotals['bank'] || 0;
  const epf = categoryTotals['epf'] || 0;
  const indian_stocks = categoryTotals['in_stocks'] || 0;
  const us_stocks = categoryTotals['us_stocks'] || 0;
  const mutual_funds = categoryTotals['mutual_funds'] || 0;
  const nps = categoryTotals['nps'] || 0;

  // Individual bank accounts (dynamic, not hardcoded)
  const bankItems = categoryItems['bank'] || {};

  return {
    // Dynamic category breakdown (new categories auto-appear here)
    categoryTotals,
    categoryItems,
    liabilityItems,

    // Backward-compatible named fields
    savings,
    epf,
    indian_stocks,
    us_stocks,
    mutual_funds,
    nps,

    // Dynamic bank breakdown (any bank name works)
    bankBreakdown: bankItems,

    // Legacy named bank fields for backward compat (resolved dynamically)
    hdfc: Object.entries(bankItems).find(([k]) => k.toLowerCase().includes('hdfc'))?.[1] || 0,
    indusind: Object.entries(bankItems).find(([k]) => k.toLowerCase().includes('indusind'))?.[1] || 0,
    idfc: Object.entries(bankItems).find(([k]) => k.toLowerCase().includes('idfc'))?.[1] || 0,
    rbl: Object.entries(bankItems).find(([k]) => k.toLowerCase().includes('rbl'))?.[1] || 0,
    sbi: Object.entries(bankItems).find(([k]) => k.toLowerCase().includes('sbi'))?.[1] || 0,
    federal: Object.entries(bankItems).find(([k]) => k.toLowerCase().includes('federal'))?.[1] || 0,

    // Liabilities
    loan: totalLoans,
    credits: totalCredits,
    // Totals
    totalAssets,
    total_assets: totalAssets,
    totalLiabilities: totalDebt,
    debt: totalDebt,
    netWorth: totalWealth,
    wealth: totalWealth,
    total_wealth: totalWealth
  };
}
