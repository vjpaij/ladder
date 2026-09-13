import db from '../db.js';

/**
 * Dynamic Category Registry Engine
 * 
 * Complies with strict project Anti-Hardcoding rules:
 * In future, any new asset, currency, or liability added to the database
 * is automatically handled dynamically without modifying core computation code.
 */

// In-memory cache of category definitions: id -> CategoryConfig
const categoryCache = new Map();
let isInitialized = false;

// Fallback registry in case DB is unreachable on initial cold start
const FALLBACK_CATEGORIES = [
  { id: 'bank', name: 'Bank Accounts & FDs', type: 'ASSET', valuation_model: 'BALANCE_BASED', default_currency: 'INR', default_exchange: 'NSE', price_fetcher: 'NONE', has_dividends: false },
  { id: 'epf', name: 'Employee Provident Fund (EPF)', type: 'ASSET', valuation_model: 'BALANCE_BASED', default_currency: 'INR', default_exchange: 'NSE', price_fetcher: 'NONE', has_dividends: false },
  { id: 'in_stocks', name: 'Indian Stocks (NSE/BSE)', type: 'ASSET', valuation_model: 'UNIT_BASED', default_currency: 'INR', default_exchange: 'NSE', price_fetcher: 'YAHOO', has_dividends: true },
  { id: 'us_stocks', name: 'US Equities (NASDAQ/NYSE)', type: 'ASSET', valuation_model: 'UNIT_BASED', default_currency: 'USD', default_exchange: 'NASDAQ', price_fetcher: 'YAHOO', has_dividends: true },
  { id: 'mutual_funds', name: 'Mutual Funds (AMFI)', type: 'ASSET', valuation_model: 'UNIT_BASED', default_currency: 'INR', default_exchange: 'AMFI', price_fetcher: 'MFAPI', has_dividends: false },
  { id: 'nps', name: 'National Pension System (NPS)', type: 'ASSET', valuation_model: 'UNIT_BASED', default_currency: 'INR', default_exchange: 'CRA', price_fetcher: 'PROTEAN', has_dividends: false },
  { id: 'loans', name: 'Home & Personal Loans', type: 'LIABILITY', valuation_model: 'BALANCE_BASED', default_currency: 'INR', default_exchange: 'NSE', price_fetcher: 'NONE', has_dividends: false },
  { id: 'credit_cards', name: 'Credit Card Balances', type: 'LIABILITY', valuation_model: 'BALANCE_BASED', default_currency: 'INR', default_exchange: 'NSE', price_fetcher: 'NONE', has_dividends: false }
];

// Initialize seed data
FALLBACK_CATEGORIES.forEach(c => categoryCache.set(c.id, c));

/**
 * Loads categories from the database into memory.
 */
export async function loadCategoryRegistry() {
  try {
    const cats = await db.select('categories');
    if (cats && Array.isArray(cats) && cats.length > 0) {
      cats.forEach(c => {
        categoryCache.set(c.id, {
          id: c.id,
          name: c.name,
          type: c.type || 'ASSET',
          valuation_model: c.valuation_model || (c.type === 'LIABILITY' || ['bank', 'epf'].includes(c.id) ? 'BALANCE_BASED' : 'UNIT_BASED'),
          default_currency: c.default_currency || 'INR',
          default_exchange: c.default_exchange || 'NSE',
          price_fetcher: c.price_fetcher || 'NONE',
          has_dividends: Boolean(c.has_dividends)
        });
      });
      isInitialized = true;
    }
  } catch (err) {
    console.warn('[Category Registry] Failed to fetch categories from DB, using cached registry:', err.message);
  }
  return Array.from(categoryCache.values());
}

/**
 * Get category configuration by ID
 */
export function getCategory(categoryId) {
  if (!categoryId) return null;
  return categoryCache.get(categoryId) || {
    id: categoryId,
    name: categoryId,
    type: 'ASSET',
    valuation_model: 'UNIT_BASED',
    default_currency: 'INR',
    default_exchange: 'NSE',
    price_fetcher: 'NONE',
    has_dividends: false
  };
}

/**
 * Checks if a category operates on unit-based valuation (quantity * price)
 */
export function isUnitBased(categoryId) {
  const cat = getCategory(categoryId);
  return cat ? cat.valuation_model === 'UNIT_BASED' : true;
}

/**
 * Checks if a category operates on balance-based valuation (direct balance/amount)
 */
export function isBalanceBased(categoryId) {
  const cat = getCategory(categoryId);
  return cat ? cat.valuation_model === 'BALANCE_BASED' : false;
}

/**
 * Returns default currency for a category
 */
export function getDefaultCurrency(categoryId) {
  const cat = getCategory(categoryId);
  return cat?.default_currency || 'INR';
}

/**
 * Returns price fetcher engine type for a category
 */
export function getPriceFetcher(categoryId) {
  const cat = getCategory(categoryId);
  return cat?.price_fetcher || 'NONE';
}

/**
 * Checks if a category supports dividend tracking
 */
export function hasDividends(categoryId) {
  const cat = getCategory(categoryId);
  return Boolean(cat?.has_dividends);
}

/**
 * Dynamically registers or updates a category definition at runtime
 */
export function registerCategory(categoryConfig) {
  if (!categoryConfig || !categoryConfig.id) return;
  categoryCache.set(categoryConfig.id, {
    valuation_model: 'UNIT_BASED',
    default_currency: 'INR',
    default_exchange: 'NSE',
    price_fetcher: 'NONE',
    has_dividends: false,
    ...categoryConfig
  });
}

// Initial load
loadCategoryRegistry().catch(err => console.warn('[Category Registry Init Error]:', err.message));
