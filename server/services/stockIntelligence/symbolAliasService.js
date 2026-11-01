/**
 * symbolAliasService.js
 * Centralized Canonical Symbol Alias & Rename Registry
 *
 * Maps old, renamed, merged, or BSE-only ticker symbols to their
 * official active exchange trading symbols for Yahoo Finance, NSE, and BSE feeds.
 */

export const KNOWN_SYMBOL_ALIASES = {
  // Tata Motors DVR conversion / TMPV
  'TATAMOTORS': 'TMPV.NS',
  'TATAMTRDVR': 'TMPV.NS',
  'TMPV': 'TMPV.NS',

  // GMR Infrastructure renamed to GMR Airports Infrastructure
  'GMRINFRA': 'GMRAIRPORT.NS',
  'GMRAIRPORT': 'GMRAIRPORT.NS',

  // Reliance Infrastructure ticker change
  'RINFRA': 'RELINFRA.NS',
  'RELINFRA': 'RELINFRA.NS',

  // L&T Infotech + Mindtree merger
  'LTI': 'LTIM.NS',
  'MINDTREE': 'LTIM.NS',
  'LTIM': 'LTIM.NS',

  // IDFC First Bank historical alias
  'IDFCBANK': 'IDFCFIRSTB.NS',

  // BSE-only or BSE Scrip-mapped listings
  'NSE': 'NSE.BO',
  '544937': 'NSE.BO',
  'SWANENERGY': '503310.BO',
  'BARBEQUE': '543283.BO',
  'DRONEACHARYA': 'DRONACHARYA.BO'
};

/**
 * Resolves a symbol to its canonical active trading ticker.
 * If an alias exists, returns the mapped exchange ticker (e.g. 'GMRAIRPORT.NS').
 * Otherwise returns the input symbol.
 *
 * @param {string} symbol
 * @returns {string}
 */
export function resolveCanonicalTicker(symbol) {
  if (!symbol) return '';
  const clean = String(symbol).toUpperCase().replace(/\.(NS|BO)$/i, '').trim();
  return KNOWN_SYMBOL_ALIASES[clean] || symbol;
}

/**
 * Returns the clean base symbol without exchange suffix.
 *
 * @param {string} symbol
 * @returns {string}
 */
export function getCleanSymbol(symbol) {
  if (!symbol) return '';
  return String(symbol).toUpperCase().replace(/\.(NS|BO)$/i, '').trim();
}
