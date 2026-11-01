export const PALETTE = [
  '#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#06B6D4', 
  '#EC4899', '#6366F1', '#14B8A6', '#F97316', '#A855F7', 
  '#64748B', '#E11D48', '#0284C7', '#84CC16', '#F43F5E',
  '#22C55E', '#EAB308', '#38BDF8', '#D946EF', '#475569',
  '#059669', '#2563EB', '#7C3AED', '#D97706'
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

export const CANONICAL_SECTORS = [
  'Automobile & Auto Components',
  'Banking',
  'Financial Services & NBFC',
  'Information Technology & Software',
  'Semiconductors & Hardware',
  'Enterprise Cloud & Internet',
  'Consumer Electronics & Hardware',
  'Pharmaceuticals & Biotechnology',
  'Healthcare Services & Hospitals',
  'Capital Goods & Heavy Engineering',
  'Power & Electrical Equipment',
  'Chemicals & Specialty Chemicals',
  'Metals, Mining & Materials',
  'Consumer Discretionary & Retail',
  'Consumer Staples & FMCG',
  'Gems, Jewellery & Luxury',
  'Logistics & Transportation',
  'Travel, Tourism & Hospitality',
  'Real Estate & Construction',
  'Oil, Gas & Energy',
  'Telecommunication & Media',
  'Diversified & Other'
];

/**
 * Standard Unified Sector Normalization
 * Preserves exact canonical sectors from Stock Analysis & asset_metadata.json
 * Maps granular Screener / Yahoo / NSE classifications into the unified 22-sector taxonomy.
 */
export function normalizeSector(raw) {
  if (!raw) return 'Diversified & Other';
  const trimmed = String(raw).trim();
  if (CANONICAL_SECTORS.includes(trimmed)) return trimmed;

  const s = trimmed.toLowerCase();

  // 1. Automobile & Components
  if (s.includes('auto') || s.includes('vehicle') || s.includes('tyre') || s.includes('tire') || s.includes('ancillar') || s.includes('motor') || s.includes('two wheeler') || s.includes('four wheeler') || s.includes('commercial vehicle') || s.includes('electric vehicle') || s.includes('ev ') || s.includes('bearing') || s.includes('forging') || s.includes('powertrain')) {
    return 'Automobile & Auto Components';
  }

  // 2. Banking
  if (s.includes('bank') || s.includes('banking') || s.includes('small finance bank') || s.includes('sf bank') || s.includes('psu bank') || s.includes('private bank')) {
    return 'Banking';
  }

  // 3. Financial Services & NBFC
  if (s.includes('finance') || s.includes('financial') || s.includes('nbfc') || s.includes('wealth') || s.includes('amc') || s.includes('stock exchange') || s.includes('depository') || s.includes('rating') || s.includes('capital market') || s.includes('fintech') || s.includes('housing fin') || s.includes('broking') || s.includes('insurance') || s.includes('lending') || s.includes('investment') || s.includes('credit')) {
    return 'Financial Services & NBFC';
  }

  // 4. Semiconductors & Hardware
  if (s.includes('semiconductor') || s.includes('chip') || s.includes('foundry') || s.includes('electronic manufacturing') || s.includes('ems') || s.includes('electronics hardware') || s.includes('hardware & networking') || s.includes('pcb')) {
    return 'Semiconductors & Hardware';
  }

  // 5. Enterprise Cloud & Internet
  if (s.includes('cloud') || s.includes('internet') || s.includes('e-commerce') || s.includes('ecommerce') || s.includes('search engine') || s.includes('social media') || s.includes('enterprise software') || s.includes('hyperscaler') || s.includes('saas') || s.includes('platform')) {
    return 'Enterprise Cloud & Internet';
  }

  // 6. Consumer Electronics
  if (s.includes('consumer electronics') || s.includes('mobile phone') || s.includes('smartphone') || s.includes('wearable')) {
    return 'Consumer Electronics & Hardware';
  }

  // 7. Information Technology & Software
  if (s.includes('tech') || s.includes('information') || s.includes('software') || s.includes('it ') || s === 'it' || s.includes('it services') || s.includes('consulting') || s.includes('analytics') || s.includes('artificial intelligence') || s.includes('ai') || s.includes('data')) {
    return 'Information Technology & Software';
  }

  // 8. Healthcare Services & Hospitals
  if (s.includes('hospital') || s.includes('diagnostic') || s.includes('pathology') || s.includes('eyecare') || s.includes('clinic') || s.includes('healthcare service') || s.includes('medical equipment') || s.includes('medical device')) {
    return 'Healthcare Services & Hospitals';
  }

  // 9. Pharmaceuticals & Biotechnology
  if (s.includes('pharma') || s.includes('biotech') || s.includes('drug') || s.includes('formulation') || s.includes('api') || s.includes('cdmo') || s.includes('cro') || s.includes('lyophilized') || s.includes('active pharma') || s.includes('vaccine') || s.includes('therapeutics')) {
    return 'Pharmaceuticals & Biotechnology';
  }

  // 10. Power & Electrical Equipment
  if (s.includes('transformer') || s.includes('electrical equipment') || s.includes('generator') || s.includes('transmission') || s.includes('power generation') || s.includes('power grid') || s.includes('hydro') || s.includes('solar equipment') || s.includes('wind equipment') || s.includes('electricals') || s.includes('switchgear') || s.includes('cables') || s.includes('wire')) {
    return 'Power & Electrical Equipment';
  }

  // 11. Capital Goods & Heavy Engineering
  if (s.includes('capital good') || s.includes('heavy engineering') || s.includes('machinery') || s.includes('machine tool') || s.includes('cnc') || s.includes('industrial machinery') || s.includes('cryogenic') || s.includes('defense') || s.includes('defence') || s.includes('aerospace') || s.includes('engineering') || s.includes('industrial') || s.includes('pumps') || s.includes('valves') || s.includes('hoses')) {
    return 'Capital Goods & Heavy Engineering';
  }

  // 12. Chemicals & Specialty Chemicals
  if (s.includes('chemical') || s.includes('specialty chem') || s.includes('fluorochem') || s.includes('fertilizer') || s.includes('agrochem') || s.includes('dye') || s.includes('pigment') || s.includes('petrochem') || s.includes('polymer') || s.includes('resin') || s.includes('bromine')) {
    return 'Chemicals & Specialty Chemicals';
  }

  // 13. Metals, Mining & Materials
  if (s.includes('metal') || s.includes('mining') || s.includes('steel') || s.includes('iron') || s.includes('aluminium') || s.includes('aluminum') || s.includes('copper') || s.includes('zinc') || s.includes('alloys') || s.includes('refractory') || s.includes('bimetal') || s.includes('materials') || s.includes('minerals') || s.includes('foundry')) {
    return 'Metals, Mining & Materials';
  }

  // 14. Gems, Jewellery & Luxury
  if (s.includes('jewel') || s.includes('gem') || s.includes('diamond') || s.includes('gold') || s.includes('luxury') || s.includes('precious')) {
    return 'Gems, Jewellery & Luxury';
  }

  // 15. Logistics & Transportation
  if (s.includes('logistics') || s.includes('transport') || s.includes('freight') || s.includes('cargo') || s.includes('courier') || s.includes('warehousing') || s.includes('supply chain') || s.includes('shipping') || s.includes('port')) {
    return 'Logistics & Transportation';
  }

  // 16. Travel, Tourism & Hospitality
  if (s.includes('hotel') || s.includes('resort') || s.includes('travel') || s.includes('tourism') || s.includes('hospitality') || s.includes('restaurant') || s.includes('airline') || s.includes('aviation') || s.includes('gaming') || s.includes('casino')) {
    return 'Travel, Tourism & Hospitality';
  }

  // 17. Consumer Staples & FMCG
  if (s.includes('fmcg') || s.includes('food') || s.includes('beverage') || s.includes('edible oil') || s.includes('tobacco') || s.includes('distiller') || s.includes('brewery') || s.includes('alcohol') || s.includes('liquor') || s.includes('personal care') || s.includes('household') || s.includes('staple') || s.includes('dairy') || s.includes('sugar') || s.includes('tea') || s.includes('coffee')) {
    return 'Consumer Staples & FMCG';
  }

  // 18. Consumer Discretionary & Retail
  if (s.includes('retail') || s.includes('fashion') || s.includes('apparel') || s.includes('footwear') || s.includes('garment') || s.includes('consumer durable') || s.includes('textile') || s.includes('furnish') || s.includes('home appliance') || s.includes('consumer disc')) {
    return 'Consumer Discretionary & Retail';
  }

  // 19. Real Estate & Construction
  if (s.includes('realty') || s.includes('real estate') || s.includes('construction') || s.includes('cement') || s.includes('building material') || s.includes('infra') || s.includes('civil') || s.includes('housing') || s.includes('property')) {
    return 'Real Estate & Construction';
  }

  // 20. Oil, Gas & Energy
  if (s.includes('energy') || s.includes('oil') || s.includes('gas') || s.includes('petroleum') || s.includes('refin') || s.includes('renewable') || s.includes('solar energy') || s.includes('green energy') || s.includes('cng') || s.includes('lpg')) {
    return 'Oil, Gas & Energy';
  }

  // 21. Telecommunication & Media
  if (s.includes('telecom') || s.includes('media') || s.includes('entertainment') || s.includes('broadcasting') || s.includes('communication') || s.includes('publishing') || s.includes('television') || s.includes('multiplex')) {
    return 'Telecommunication & Media';
  }

  // 22. Cash & Debt Instruments
  if (s.includes('cash') || s.includes('debt') || s.includes('treps') || s.includes('repo') || s.includes('reverse repo') || s.includes('debenture') || s.includes('commercial paper') || s.includes('money market') || s.includes('gilt') || s.includes('treasury')) {
    return 'Cash, Debt & Other';
  }

  return 'Diversified & Other';
}
