export const PALETTE = [
  '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#06B6D4', 
  '#EC4899', '#6366F1', '#14B8A6', '#F97316', '#A855F7', 
  '#64748B', '#E11D48', '#0284C7', '#84CC16'
];

export const CAP_COLORS = {
  'Mega Cap': '#10B981',     // Emerald
  'Large Cap': '#3B82F6',    // Blue
  'Mid Cap': '#F59E0B',      // Amber
  'Small Cap': '#8B5CF6',    // Purple
  'Micro Cap': '#EC4899',    // Pink / Rose
  'Cash': '#64748B',         // Slate
  'Unknown': '#94A3B8'
};

export const BENCHMARK_COLORS = {
  'NIFTY_50': '#3B82F6',
  'NIFTY_MIDCAP_150': '#F59E0B',
  'NIFTY_SMALLCAP_250': '#8B5CF6',
  'SP_500': '#EC4899',
  'NASDAQ': '#06B6D4'
};

export const BENCHMARK_LABELS = {
  'NIFTY_50': 'Nifty 50',
  'NIFTY_MIDCAP_150': 'Nifty Midcap 150',
  'NIFTY_SMALLCAP_250': 'Nifty Smallcap 250',
  'SP_500': 'S&P 500',
  'NASDAQ': 'NASDAQ'
};

/**
 * Standard Unified Sector Normalization
 */
export function normalizeSector(raw) {
  if (!raw) return 'Diversified & Other';
  const s = raw.trim().toLowerCase();
  
  if (s.includes('tech') || s.includes('information') || s.includes('software') || s.includes('semiconductor') || s.includes('cloud') || s.includes('it ') || s === 'it') {
    return 'Information Technology';
  }
  if (s.includes('bank') || s.includes('finance') || s.includes('financial') || s.includes('insurance') || s.includes('capital market') || s.includes('amc') || s.includes('housing fin')) {
    return 'Financial Services';
  }
  if (s.includes('health') || s.includes('pharma') || s.includes('biotech') || s.includes('drug') || s.includes('hospital') || s.includes('diagnostic')) {
    return 'Healthcare & Pharmaceuticals';
  }
  if (s.includes('auto') || s.includes('vehicle') || s.includes('tyre') || s.includes('ancillar') || s.includes('motor')) {
    return 'Automobiles & Auto Components';
  }
  if (s.includes('fmcg') || s.includes('consumer good') || s.includes('food') || s.includes('beverage') || s.includes('tobacco') || s.includes('personal care') || s.includes('household') || s.includes('staple')) {
    return 'Consumer Staples & FMCG';
  }
  if (s.includes('consumer disc') || s.includes('retail') || s.includes('apparel') || s.includes('footwear') || s.includes('hotel') || s.includes('restaurant') || s.includes('travel') || s.includes('leisure') || s.includes('luxury')) {
    return 'Consumer Discretionary';
  }
  if (s.includes('industrial') || s.includes('capital good') || s.includes('engineering') || s.includes('machiner') || s.includes('defence') || s.includes('equipment') || s.includes('electrical')) {
    return 'Capital Goods & Industrials';
  }
  if (s.includes('infra') || s.includes('construction') || s.includes('cement') || s.includes('building') || s.includes('realty') || s.includes('real estate') || s.includes('road') || s.includes('port') || s.includes('transport')) {
    return 'Infrastructure & Real Estate';
  }
  if (s.includes('energy') || s.includes('oil') || s.includes('gas') || s.includes('petroleum') || s.includes('refin') || s.includes('power') || s.includes('renewable') || s.includes('solar') || s.includes('green energy') || s.includes('utilit')) {
    return 'Energy, Power & Utilities';
  }
  if (s.includes('metal') || s.includes('mining') || s.includes('steel') || s.includes('aluminum') || s.includes('copper') || s.includes('zinc') || s.includes('iron') || s.includes('commodity') || s.includes('commodities')) {
    return 'Metals & Mining';
  }
  if (s.includes('chemical') || s.includes('fertilizer') || s.includes('agrochem') || s.includes('specialty chem') || s.includes('material')) {
    return 'Chemicals & Materials';
  }
  if (s.includes('telecom') || s.includes('media') || s.includes('entertainment') || s.includes('broadcasting') || s.includes('communication')) {
    return 'Telecommunication & Media';
  }
  if (s.includes('cash') || s.includes('debt') || s.includes('treps') || s.includes('repo') || s.includes('reverse repo') || s.includes('debenture') || s.includes('commercial paper') || s.includes('money market') || s.includes('gilt') || s.includes('treasury')) {
    return 'Cash, Debt & Other';
  }
  return 'Diversified & Other';
}
