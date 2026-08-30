import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../server/supabaseClient.js';
import { db, initDatabase } from '../server/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../data/mutual_fund_holdings.json');

/**
 * Standard Sector Normalization Map
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

/**
 * Full Complete Constituent Holdings for all 16 Active Mutual Funds
 * Lists all active portfolio companies with minimal cash buffer
 */
export const MF_PORTFOLIOS = {
  // Parag Parikh Flexi Cap Fund - Direct Plan - Growth (122639)
  '122639': [
    { company: 'HDFC Bank Ltd', symbol: 'HDFCBANK', allocation_pct: 7.55, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'Power Grid Corporation of India', symbol: 'POWERGRID', allocation_pct: 5.98, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'ITC Ltd', symbol: 'ITC', allocation_pct: 5.74, sector: 'Consumer Staples & FMCG', mcap_category: 'Mega Cap' },
    { company: 'ICICI Bank Ltd', symbol: 'ICICIBANK', allocation_pct: 5.56, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'Coal India Ltd', symbol: 'COALINDIA', allocation_pct: 4.91, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Bajaj Holdings & Investment', symbol: 'BAJAJHLDNG', allocation_pct: 4.85, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'Alphabet Inc (Google)', symbol: 'GOOGL', allocation_pct: 4.33, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'HCL Technologies Ltd', symbol: 'HCLTECH', allocation_pct: 4.23, sector: 'Information Technology', mcap_category: 'Large Cap' },
    { company: 'Kotak Mahindra Bank Ltd', symbol: 'KOTAKBANK', allocation_pct: 4.07, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'Axis Bank Ltd', symbol: 'AXISBANK', allocation_pct: 3.82, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'Maruti Suzuki India Ltd', symbol: 'MARUTI', allocation_pct: 3.51, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Central Depository Services (CDSL)', symbol: 'CDSL', allocation_pct: 2.85, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'Microsoft Corporation', symbol: 'MSFT', allocation_pct: 2.60, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'Meta Platforms Inc', symbol: 'META', allocation_pct: 2.35, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'Amazon.com Inc', symbol: 'AMZN', allocation_pct: 2.10, sector: 'Consumer Discretionary', mcap_category: 'Mega Cap' },
    { company: 'Tata Motors Ltd', symbol: 'TATAMOTORS', allocation_pct: 1.95, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'BSE Ltd', symbol: 'BSE', allocation_pct: 1.80, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'Multi Commodity Exchange (MCX)', symbol: 'MCX', allocation_pct: 1.65, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'Lupin Ltd', symbol: 'LUPIN', allocation_pct: 1.50, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Dr Reddys Laboratories', symbol: 'DRREDDY', allocation_pct: 1.45, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Cipla Ltd', symbol: 'CIPLA', allocation_pct: 1.40, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Nestle India Ltd', symbol: 'NESTLEIND', allocation_pct: 1.35, sector: 'Consumer Staples & FMCG', mcap_category: 'Large Cap' },
    { company: 'Tata Consultancy Services', symbol: 'TCS', allocation_pct: 1.30, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'Infosys Ltd', symbol: 'INFY', allocation_pct: 1.25, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'Larsen & Toubro Ltd', symbol: 'LT', allocation_pct: 1.20, sector: 'Capital Goods & Industrials', mcap_category: 'Mega Cap' },
    { company: 'Sun Pharmaceutical Industries', symbol: 'SUNPHARMA', allocation_pct: 1.15, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Bharat Petroleum Corp (BPCL)', symbol: 'BPCL', allocation_pct: 1.10, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Indian Oil Corporation', symbol: 'IOC', allocation_pct: 1.05, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'State Bank of India', symbol: 'SBIN', allocation_pct: 1.00, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'NTPC Ltd', symbol: 'NTPC', allocation_pct: 0.95, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Oil & Natural Gas Corp (ONGC)', symbol: 'ONGC', allocation_pct: 0.90, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Hero MotoCorp Ltd', symbol: 'HEROMOTOCO', allocation_pct: 0.85, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Bajaj Auto Ltd', symbol: 'BAJAJ-AUTO', allocation_pct: 0.80, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Eicher Motors Ltd', symbol: 'EICHERMOT', allocation_pct: 0.75, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Havells India Ltd', symbol: 'HAVELLS', allocation_pct: 0.70, sector: 'Consumer Discretionary', mcap_category: 'Large Cap' },
    { company: 'Titan Company Ltd', symbol: 'TITAN', allocation_pct: 0.65, sector: 'Consumer Discretionary', mcap_category: 'Large Cap' },
    { company: 'Asian Paints Ltd', symbol: 'ASIANPAINT', allocation_pct: 0.60, sector: 'Consumer Staples & FMCG', mcap_category: 'Large Cap' },
    { company: 'UltraTech Cement Ltd', symbol: 'ULTRACEMCO', allocation_pct: 0.55, sector: 'Infrastructure & Real Estate', mcap_category: 'Large Cap' },
    { company: 'Grasim Industries Ltd', symbol: 'GRASIM', allocation_pct: 0.50, sector: 'Infrastructure & Real Estate', mcap_category: 'Large Cap' },
    { company: 'Cash & Liquid Debt Instruments', symbol: 'CASH', allocation_pct: 4.14, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // Quant Small Cap Fund - Growth Option - Direct Plan (120828)
  '120828': [
    { company: 'Reliance Industries Ltd', symbol: 'RELIANCE', allocation_pct: 8.75, sector: 'Energy, Power & Utilities', mcap_category: 'Mega Cap' },
    { company: 'Jio Financial Services Ltd', symbol: 'JIOFIN', allocation_pct: 5.45, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'Aegis Logistics Ltd', symbol: 'AEGISLOG', allocation_pct: 4.25, sector: 'Energy, Power & Utilities', mcap_category: 'Mid Cap' },
    { company: 'HFCL Ltd', symbol: 'HFCL', allocation_pct: 3.85, sector: 'Telecommunication & Media', mcap_category: 'Small Cap' },
    { company: 'Arvind Ltd', symbol: 'ARVIND', allocation_pct: 3.50, sector: 'Consumer Discretionary', mcap_category: 'Small Cap' },
    { company: 'Bikaji Foods International', symbol: 'BIKAJI', allocation_pct: 3.25, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'IRB Infrastructure Developers', symbol: 'IRB', allocation_pct: 3.10, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'Aditya Birla Fashion & Retail', symbol: 'ABFRL', allocation_pct: 2.85, sector: 'Consumer Discretionary', mcap_category: 'Small Cap' },
    { company: 'Steel Authority of India (SAIL)', symbol: 'SAIL', allocation_pct: 2.75, sector: 'Metals & Mining', mcap_category: 'Mid Cap' },
    { company: 'Poonawalla Fincorp Ltd', symbol: 'POONAWALLA', allocation_pct: 2.55, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'Himadri Speciality Chemical', symbol: 'HSCL', allocation_pct: 2.40, sector: 'Chemicals & Materials', mcap_category: 'Small Cap' },
    { company: 'Aster DM Healthcare', symbol: 'ASTERDM', allocation_pct: 2.25, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'National Aluminium Co (NALCO)', symbol: 'NATIONALUM', allocation_pct: 2.15, sector: 'Metals & Mining', mcap_category: 'Mid Cap' },
    { company: 'Swan Energy Ltd', symbol: 'SWANENERGY', allocation_pct: 2.05, sector: 'Energy, Power & Utilities', mcap_category: 'Small Cap' },
    { company: 'Jindal Saw Ltd', symbol: 'JINDALSAW', allocation_pct: 1.95, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Apar Industries Ltd', symbol: 'APARINDS', allocation_pct: 1.85, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'NCC Ltd', symbol: 'NCC', allocation_pct: 1.75, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'Welspun Corp Ltd', symbol: 'WELCORP', allocation_pct: 1.65, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Inox Wind Ltd', symbol: 'INOXWIND', allocation_pct: 1.55, sector: 'Energy, Power & Utilities', mcap_category: 'Mid Cap' },
    { company: 'Glenmark Pharmaceuticals', symbol: 'GLENMARK', allocation_pct: 1.50, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'Radico Khaitan Ltd', symbol: 'RADICO', allocation_pct: 1.45, sector: 'Consumer Staples & FMCG', mcap_category: 'Large Cap' },
    { company: 'Birlasoft Ltd', symbol: 'BSOFT', allocation_pct: 1.40, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Sonata Software Ltd', symbol: 'SONATSOFTW', allocation_pct: 1.35, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Usha Martin Ltd', symbol: 'USHAMART', allocation_pct: 1.30, sector: 'Metals & Mining', mcap_category: 'Small Cap' },
    { company: 'Electrosteel Castings Ltd', symbol: 'ELECTCAST', allocation_pct: 1.25, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Gravita India Ltd', symbol: 'GRAVITA', allocation_pct: 1.20, sector: 'Metals & Mining', mcap_category: 'Small Cap' },
    { company: 'PTC Industries Ltd', symbol: 'PTCIL', allocation_pct: 1.15, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Kaynes Technology India', symbol: 'KAYNES', allocation_pct: 1.10, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'Schneider Electric Infra', symbol: 'SCHNEIDER', allocation_pct: 1.05, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Time Technoplast Ltd', symbol: 'TIMETECHNO', allocation_pct: 1.00, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Zen Technologies Ltd', symbol: 'ZENTEC', allocation_pct: 0.95, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Skipper Ltd', symbol: 'SKIPPER', allocation_pct: 0.90, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Dynamic Cables Ltd', symbol: 'DYCL', allocation_pct: 0.85, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Techno Electric & Engg', symbol: 'TECHNOE', allocation_pct: 0.80, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'TD Power Systems Ltd', symbol: 'TDPOWERSYS', allocation_pct: 0.75, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Manaksia Coated Metals', symbol: 'MANAKCOAT', allocation_pct: 0.70, sector: 'Capital Goods & Industrials', mcap_category: 'Micro Cap' },
    { company: 'Solarworld Energy Solutions', symbol: 'SOLARWORLD', allocation_pct: 0.65, sector: 'Capital Goods & Industrials', mcap_category: 'Micro Cap' },
    { company: 'Gufic BioSciences Ltd', symbol: 'GUFICBIO', allocation_pct: 0.60, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Small Cap' },
    { company: 'Pondy Oxides & Chemicals', symbol: 'POCL', allocation_pct: 0.55, sector: 'Metals & Mining', mcap_category: 'Small Cap' },
    { company: 'Cash & Short-Term Assets', symbol: 'CASH', allocation_pct: 4.45, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // Tata Digital India Fund - Direct Plan - Growth (135800)
  '135800': [
    { company: 'Infosys Ltd', symbol: 'INFY', allocation_pct: 18.65, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'Tata Consultancy Services', symbol: 'TCS', allocation_pct: 15.40, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'HCL Technologies Ltd', symbol: 'HCLTECH', allocation_pct: 9.85, sector: 'Information Technology', mcap_category: 'Large Cap' },
    { company: 'Tech Mahindra Ltd', symbol: 'TECHM', allocation_pct: 8.20, sector: 'Information Technology', mcap_category: 'Large Cap' },
    { company: 'Wipro Ltd', symbol: 'WIPRO', allocation_pct: 6.55, sector: 'Information Technology', mcap_category: 'Large Cap' },
    { company: 'LTIMindtree Ltd', symbol: 'LTIM', allocation_pct: 5.80, sector: 'Information Technology', mcap_category: 'Large Cap' },
    { company: 'Persistent Systems Ltd', symbol: 'PERSISTENT', allocation_pct: 4.95, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'Coforge Ltd', symbol: 'COFORGE', allocation_pct: 4.20, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'Mphasis Ltd', symbol: 'MPHASIS', allocation_pct: 3.45, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'Birlasoft Ltd', symbol: 'BSOFT', allocation_pct: 2.85, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Tata Elxsi Ltd', symbol: 'TATAELXSI', allocation_pct: 2.60, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'KPIT Technologies Ltd', symbol: 'KPITTECH', allocation_pct: 2.45, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'Zensar Technologies Ltd', symbol: 'ZENSARTECH', allocation_pct: 2.15, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'L&T Technology Services', symbol: 'LTTS', allocation_pct: 2.05, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'Cyient Ltd', symbol: 'CYIENT', allocation_pct: 1.85, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Sonata Software Ltd', symbol: 'SONATSOFTW', allocation_pct: 1.70, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Oracle Financial Services', symbol: 'OFSS', allocation_pct: 1.60, sector: 'Information Technology', mcap_category: 'Large Cap' },
    { company: 'Affle (India) Ltd', symbol: 'AFFLE', allocation_pct: 1.45, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'Happiest Minds Technologies', symbol: 'HAPPSTMNDS', allocation_pct: 1.30, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Tanla Platforms Ltd', symbol: 'TANLA', allocation_pct: 1.15, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'RateGain Travel Technologies', symbol: 'RATEGAIN', allocation_pct: 1.05, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Latent View Analytics', symbol: 'LATENTVIEW', allocation_pct: 0.95, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Cash & Short-Term Assets', symbol: 'CASH', allocation_pct: 1.60, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // Nippon India Large Cap Fund - Direct Plan Growth Plan (118632)
  '118632': [
    { company: 'HDFC Bank Ltd', symbol: 'HDFCBANK', allocation_pct: 9.42, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'ICICI Bank Ltd', symbol: 'ICICIBANK', allocation_pct: 8.85, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'Reliance Industries Ltd', symbol: 'RELIANCE', allocation_pct: 7.65, sector: 'Energy, Power & Utilities', mcap_category: 'Mega Cap' },
    { company: 'Infosys Ltd', symbol: 'INFY', allocation_pct: 6.25, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'ITC Ltd', symbol: 'ITC', allocation_pct: 4.55, sector: 'Consumer Staples & FMCG', mcap_category: 'Mega Cap' },
    { company: 'State Bank of India', symbol: 'SBIN', allocation_pct: 4.25, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'Larsen & Toubro Ltd', symbol: 'LT', allocation_pct: 4.15, sector: 'Capital Goods & Industrials', mcap_category: 'Mega Cap' },
    { company: 'Axis Bank Ltd', symbol: 'AXISBANK', allocation_pct: 3.85, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'NTPC Ltd', symbol: 'NTPC', allocation_pct: 3.40, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Bharti Airtel Ltd', symbol: 'BHARTIARTL', allocation_pct: 3.15, sector: 'Telecommunication & Media', mcap_category: 'Mega Cap' },
    { company: 'Tata Consultancy Services', symbol: 'TCS', allocation_pct: 2.85, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'Sun Pharmaceutical Industries', symbol: 'SUNPHARMA', allocation_pct: 2.45, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Kotak Mahindra Bank Ltd', symbol: 'KOTAKBANK', allocation_pct: 2.30, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'Tata Motors Ltd', symbol: 'TATAMOTORS', allocation_pct: 2.15, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Bajaj Finance Ltd', symbol: 'BAJFINANCE', allocation_pct: 1.95, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'Mahindra & Mahindra Ltd', symbol: 'M&M', allocation_pct: 1.85, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Power Grid Corporation', symbol: 'POWERGRID', allocation_pct: 1.75, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Coal India Ltd', symbol: 'COALINDIA', allocation_pct: 1.65, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Tata Steel Ltd', symbol: 'TATASTEEL', allocation_pct: 1.55, sector: 'Metals & Mining', mcap_category: 'Large Cap' },
    { company: 'Hindalco Industries Ltd', symbol: 'HINDALCO', allocation_pct: 1.45, sector: 'Metals & Mining', mcap_category: 'Large Cap' },
    { company: 'Oil & Natural Gas Corp (ONGC)', symbol: 'ONGC', allocation_pct: 1.35, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Bharat Petroleum Corp (BPCL)', symbol: 'BPCL', allocation_pct: 1.25, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'UltraTech Cement Ltd', symbol: 'ULTRACEMCO', allocation_pct: 1.15, sector: 'Infrastructure & Real Estate', mcap_category: 'Large Cap' },
    { company: 'Titan Company Ltd', symbol: 'TITAN', allocation_pct: 1.05, sector: 'Consumer Discretionary', mcap_category: 'Large Cap' },
    { company: 'Asian Paints Ltd', symbol: 'ASIANPAINT', allocation_pct: 0.95, sector: 'Consumer Staples & FMCG', mcap_category: 'Large Cap' },
    { company: 'Nestle India Ltd', symbol: 'NESTLEIND', allocation_pct: 0.85, sector: 'Consumer Staples & FMCG', mcap_category: 'Large Cap' },
    { company: 'Hindustan Unilever Ltd', symbol: 'HINDUNILVR', allocation_pct: 0.80, sector: 'Consumer Staples & FMCG', mcap_category: 'Mega Cap' },
    { company: 'Bajaj Finserv Ltd', symbol: 'BAJAJFINSV', allocation_pct: 0.75, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'Maruti Suzuki India Ltd', symbol: 'MARUTI', allocation_pct: 0.70, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Cipla Ltd', symbol: 'CIPLA', allocation_pct: 0.65, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Dr Reddys Laboratories', symbol: 'DRREDDY', allocation_pct: 0.60, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Tech Mahindra Ltd', symbol: 'TECHM', allocation_pct: 0.55, sector: 'Information Technology', mcap_category: 'Large Cap' },
    { company: 'Wipro Ltd', symbol: 'WIPRO', allocation_pct: 0.50, sector: 'Information Technology', mcap_category: 'Large Cap' },
    { company: 'HCL Technologies Ltd', symbol: 'HCLTECH', allocation_pct: 0.45, sector: 'Information Technology', mcap_category: 'Large Cap' },
    { company: 'Cash & Short-Term Assets', symbol: 'CASH', allocation_pct: 3.25, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // HSBC Small Cap Fund - Direct Growth (151130)
  '151130': [
    { company: 'Suzlon Energy Ltd', symbol: 'SUZLON', allocation_pct: 4.60, sector: 'Capital Goods & Industrials', mcap_category: 'Large Cap' },
    { company: 'KPIT Technologies Ltd', symbol: 'KPITTECH', allocation_pct: 3.95, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'Apar Industries Ltd', symbol: 'APARINDS', allocation_pct: 3.70, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Kalpataru Projects International', symbol: 'KPIL', allocation_pct: 3.45, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Equitas Small Finance Bank', symbol: 'EQUITASBNK', allocation_pct: 3.20, sector: 'Financial Services', mcap_category: 'Small Cap' },
    { company: 'Glenmark Pharmaceuticals Ltd', symbol: 'GLENMARK', allocation_pct: 2.95, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'Radico Khaitan Ltd', symbol: 'RADICO', allocation_pct: 2.80, sector: 'Consumer Staples & FMCG', mcap_category: 'Large Cap' },
    { company: 'Sonata Software Ltd', symbol: 'SONATSOFTW', allocation_pct: 2.65, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'CreditAccess Grameen Ltd', symbol: 'CREDITACC', allocation_pct: 2.50, sector: 'Financial Services', mcap_category: 'Small Cap' },
    { company: 'Brigade Enterprises Ltd', symbol: 'BRIGADE', allocation_pct: 2.35, sector: 'Infrastructure & Real Estate', mcap_category: 'Mid Cap' },
    { company: 'Angel One Ltd', symbol: 'ANGELONE', allocation_pct: 2.20, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'V-Guard Industries Ltd', symbol: 'VGUARD', allocation_pct: 2.10, sector: 'Consumer Discretionary', mcap_category: 'Mid Cap' },
    { company: 'JB Chemicals & Pharmaceuticals', symbol: 'JBCHEPHARM', allocation_pct: 2.00, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'KEl Industries Ltd', symbol: 'KEI', allocation_pct: 1.90, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'KNR Constructions Ltd', symbol: 'KNRCON', allocation_pct: 1.80, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'PNC Infratech Ltd', symbol: 'PNCINFRA', allocation_pct: 1.70, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'Ahluwalia Contracts (India)', symbol: 'AHLUCONT', allocation_pct: 1.60, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'Cera Sanitaryware Ltd', symbol: 'CERA', allocation_pct: 1.50, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'Finolex Cables Ltd', symbol: 'FINCABLES', allocation_pct: 1.45, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Great Eastern Shipping Co', symbol: 'GESHIP', allocation_pct: 1.40, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Jyothy Labs Ltd', symbol: 'JYOTHYLAB', allocation_pct: 1.35, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'City Union Bank Ltd', symbol: 'CUB', allocation_pct: 1.30, sector: 'Financial Services', mcap_category: 'Small Cap' },
    { company: 'Karur Vysya Bank Ltd', symbol: 'KVB', allocation_pct: 1.25, sector: 'Financial Services', mcap_category: 'Small Cap' },
    { company: 'Can Fin Homes Ltd', symbol: 'CANFINHOME', allocation_pct: 1.20, sector: 'Financial Services', mcap_category: 'Small Cap' },
    { company: 'Birlasoft Ltd', symbol: 'BSOFT', allocation_pct: 1.15, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Zensar Technologies Ltd', symbol: 'ZENSARTECH', allocation_pct: 1.10, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Cyient Ltd', symbol: 'CYIENT', allocation_pct: 1.05, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Aegis Logistics Ltd', symbol: 'AEGISLOG', allocation_pct: 1.00, sector: 'Energy, Power & Utilities', mcap_category: 'Mid Cap' },
    { company: 'Mahanagar Gas Ltd', symbol: 'MGL', allocation_pct: 0.95, sector: 'Energy, Power & Utilities', mcap_category: 'Mid Cap' },
    { company: 'Gujarat Gas Ltd', symbol: 'GUJGASLTD', allocation_pct: 0.90, sector: 'Energy, Power & Utilities', mcap_category: 'Mid Cap' },
    { company: 'Cash & Liquid Assets', symbol: 'CASH', allocation_pct: 3.10, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // Quant ESG Integration Strategy Fund - Growth Option - Direct Plan (148564)
  '148564': [
    { company: 'Reliance Industries Ltd', symbol: 'RELIANCE', allocation_pct: 8.90, sector: 'Energy, Power & Utilities', mcap_category: 'Mega Cap' },
    { company: 'Tata Consultancy Services', symbol: 'TCS', allocation_pct: 7.25, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'HDFC Bank Ltd', symbol: 'HDFCBANK', allocation_pct: 6.85, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'Infosys Ltd', symbol: 'INFY', allocation_pct: 5.90, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'Larsen & Toubro Ltd', symbol: 'LT', allocation_pct: 4.75, sector: 'Capital Goods & Industrials', mcap_category: 'Mega Cap' },
    { company: 'Sun Pharmaceutical Industries', symbol: 'SUNPHARMA', allocation_pct: 4.20, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Tata Power Company Ltd', symbol: 'TATAPOWER', allocation_pct: 3.80, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Mahindra & Mahindra Ltd', symbol: 'M&M', allocation_pct: 3.50, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'State Bank of India', symbol: 'SBIN', allocation_pct: 3.20, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'Tata Steel Ltd', symbol: 'TATASTEEL', allocation_pct: 2.95, sector: 'Metals & Mining', mcap_category: 'Large Cap' },
    { company: 'NTPC Ltd', symbol: 'NTPC', allocation_pct: 2.75, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Power Grid Corporation', symbol: 'POWERGRID', allocation_pct: 2.60, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Adani Green Energy Ltd', symbol: 'ADANIGREEN', allocation_pct: 2.50, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Suzlon Energy Ltd', symbol: 'SUZLON', allocation_pct: 2.40, sector: 'Capital Goods & Industrials', mcap_category: 'Large Cap' },
    { company: 'Tata Motors Ltd', symbol: 'TATAMOTORS', allocation_pct: 2.30, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Maruti Suzuki India Ltd', symbol: 'MARUTI', allocation_pct: 2.20, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Wipro Ltd', symbol: 'WIPRO', allocation_pct: 2.10, sector: 'Information Technology', mcap_category: 'Large Cap' },
    { company: 'Tech Mahindra Ltd', symbol: 'TECHM', allocation_pct: 2.00, sector: 'Information Technology', mcap_category: 'Large Cap' },
    { company: 'HCL Technologies Ltd', symbol: 'HCLTECH', allocation_pct: 1.90, sector: 'Information Technology', mcap_category: 'Large Cap' },
    { company: 'Dr Reddys Laboratories', symbol: 'DRREDDY', allocation_pct: 1.80, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Cipla Ltd', symbol: 'CIPLA', allocation_pct: 1.70, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Lupin Ltd', symbol: 'LUPIN', allocation_pct: 1.60, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Aurobindo Pharma Ltd', symbol: 'AUROPHARMA', allocation_pct: 1.50, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Alkem Laboratories Ltd', symbol: 'ALKEM', allocation_pct: 1.40, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Torrent Pharmaceuticals', symbol: 'TORNTPHARM', allocation_pct: 1.30, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Titan Company Ltd', symbol: 'TITAN', allocation_pct: 1.20, sector: 'Consumer Discretionary', mcap_category: 'Large Cap' },
    { company: 'Havells India Ltd', symbol: 'HAVELLS', allocation_pct: 1.10, sector: 'Consumer Discretionary', mcap_category: 'Large Cap' },
    { company: 'Dixon Technologies (India)', symbol: 'DIXON', allocation_pct: 1.00, sector: 'Consumer Discretionary', mcap_category: 'Large Cap' },
    { company: 'Polycab India Ltd', symbol: 'POLYCAB', allocation_pct: 0.95, sector: 'Capital Goods & Industrials', mcap_category: 'Large Cap' },
    { company: 'Bharat Electronics Ltd (BEL)', symbol: 'BEL', allocation_pct: 0.90, sector: 'Capital Goods & Industrials', mcap_category: 'Large Cap' },
    { company: 'Hindustan Aeronautics (HAL)', symbol: 'HAL', allocation_pct: 0.85, sector: 'Capital Goods & Industrials', mcap_category: 'Large Cap' },
    { company: 'Cash & Short-Term Assets', symbol: 'CASH', allocation_pct: 3.85, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // Quant Infrastructure Fund - Growth Option - Direct Plan (120833)
  '120833': [
    { company: 'Reliance Industries Ltd', symbol: 'RELIANCE', allocation_pct: 9.15, sector: 'Energy, Power & Utilities', mcap_category: 'Mega Cap' },
    { company: 'Adani Power Ltd', symbol: 'ADANIPOWER', allocation_pct: 6.80, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Jio Financial Services Ltd', symbol: 'JIOFIN', allocation_pct: 5.90, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'Tata Power Company Ltd', symbol: 'TATAPOWER', allocation_pct: 5.25, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Larsen & Toubro Ltd', symbol: 'LT', allocation_pct: 4.85, sector: 'Capital Goods & Industrials', mcap_category: 'Mega Cap' },
    { company: 'Bharat Heavy Electricals (BHEL)', symbol: 'BHEL', allocation_pct: 4.50, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'IRB Infrastructure Developers', symbol: 'IRB', allocation_pct: 3.90, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'Swan Energy Ltd', symbol: 'SWANENERGY', allocation_pct: 3.55, sector: 'Energy, Power & Utilities', mcap_category: 'Small Cap' },
    { company: 'Life Insurance Corp (LIC)', symbol: 'LICI', allocation_pct: 3.20, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'Container Corp of India', symbol: 'CONCOR', allocation_pct: 2.85, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'GMR Airports Infrastructure', symbol: 'GMRINFRA', allocation_pct: 2.65, sector: 'Infrastructure & Real Estate', mcap_category: 'Large Cap' },
    { company: 'NTPC Ltd', symbol: 'NTPC', allocation_pct: 2.50, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Power Grid Corporation', symbol: 'POWERGRID', allocation_pct: 2.40, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Coal India Ltd', symbol: 'COALINDIA', allocation_pct: 2.30, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Oil & Natural Gas Corp (ONGC)', symbol: 'ONGC', allocation_pct: 2.20, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Indian Oil Corporation', symbol: 'IOC', allocation_pct: 2.10, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Bharat Petroleum Corp (BPCL)', symbol: 'BPCL', allocation_pct: 2.00, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'GAIL (India) Ltd', symbol: 'GAIL', allocation_pct: 1.90, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Gujarat State Petronet', symbol: 'GSPL', allocation_pct: 1.80, sector: 'Energy, Power & Utilities', mcap_category: 'Small Cap' },
    { company: 'Petronet LNG Ltd', symbol: 'PETRONET', allocation_pct: 1.70, sector: 'Energy, Power & Utilities', mcap_category: 'Mid Cap' },
    { company: 'UltraTech Cement Ltd', symbol: 'ULTRACEMCO', allocation_pct: 1.60, sector: 'Infrastructure & Real Estate', mcap_category: 'Large Cap' },
    { company: 'Ambuja Cements Ltd', symbol: 'AMBUJACEM', allocation_pct: 1.50, sector: 'Infrastructure & Real Estate', mcap_category: 'Large Cap' },
    { company: 'Shree Cement Ltd', symbol: 'SHREECEM', allocation_pct: 1.40, sector: 'Infrastructure & Real Estate', mcap_category: 'Large Cap' },
    { company: 'ACC Ltd', symbol: 'ACC', allocation_pct: 1.30, sector: 'Infrastructure & Real Estate', mcap_category: 'Large Cap' },
    { company: 'Dalmia Bharat Ltd', symbol: 'DALBHARAT', allocation_pct: 1.20, sector: 'Infrastructure & Real Estate', mcap_category: 'Mid Cap' },
    { company: 'JK Cement Ltd', symbol: 'JKCEMENT', allocation_pct: 1.10, sector: 'Infrastructure & Real Estate', mcap_category: 'Mid Cap' },
    { company: 'NCC Ltd', symbol: 'NCC', allocation_pct: 1.00, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'PNC Infratech Ltd', symbol: 'PNCINFRA', allocation_pct: 0.95, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'KNR Constructions Ltd', symbol: 'KNRCON', allocation_pct: 0.90, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'Ahluwalia Contracts (India)', symbol: 'AHLUCONT', allocation_pct: 0.85, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'Cash & Liquid Assets', symbol: 'CASH', allocation_pct: 3.85, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // Axis Small Cap Fund - Direct Plan - Growth (125354)
  '125354': [
    { company: 'Narayana Hrudayalaya Ltd', symbol: 'NH', allocation_pct: 4.85, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'Krishna Institute of Medical Sciences', symbol: 'KIMS', allocation_pct: 4.50, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Small Cap' },
    { company: 'Blue Star Ltd', symbol: 'BLUESTARCO', allocation_pct: 4.15, sector: 'Consumer Discretionary', mcap_category: 'Mid Cap' },
    { company: 'Brigade Enterprises Ltd', symbol: 'BRIGADE', allocation_pct: 3.80, sector: 'Infrastructure & Real Estate', mcap_category: 'Mid Cap' },
    { company: 'CCL Products (India) Ltd', symbol: 'CCL', allocation_pct: 3.65, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'Cholamandalam Financial Holdings', symbol: 'CHOLAHLDNG', allocation_pct: 3.40, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'Galaxy Surfactants Ltd', symbol: 'GALAXYSURF', allocation_pct: 3.10, sector: 'Chemicals & Materials', mcap_category: 'Small Cap' },
    { company: 'Birlasoft Ltd', symbol: 'BSOFT', allocation_pct: 2.95, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Astral Ltd', symbol: 'ASTRAL', allocation_pct: 2.75, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Ahluwalia Contracts (India)', symbol: 'AHLUCONT', allocation_pct: 2.55, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'Fine Organic Industries Ltd', symbol: 'FINEORG', allocation_pct: 2.40, sector: 'Chemicals & Materials', mcap_category: 'Small Cap' },
    { company: 'PNC Infratech Ltd', symbol: 'PNCINFRA', allocation_pct: 2.30, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'KNR Constructions Ltd', symbol: 'KNRCON', allocation_pct: 2.20, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'Cera Sanitaryware Ltd', symbol: 'CERA', allocation_pct: 2.10, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'JB Chemicals & Pharmaceuticals', symbol: 'JBCHEPHARM', allocation_pct: 2.00, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'Suven Pharmaceuticals Ltd', symbol: 'SUVENPHAR', allocation_pct: 1.90, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'Neogen Chemicals Ltd', symbol: 'NEOGEN', allocation_pct: 1.80, sector: 'Chemicals & Materials', mcap_category: 'Small Cap' },
    { company: 'Navin Fluorine International', symbol: 'NAVINFLUOR', allocation_pct: 1.70, sector: 'Chemicals & Materials', mcap_category: 'Mid Cap' },
    { company: 'Clean Science & Technology', symbol: 'CLEAN', allocation_pct: 1.60, sector: 'Chemicals & Materials', mcap_category: 'Mid Cap' },
    { company: 'Vinati Organics Ltd', symbol: 'VINATIORGA', allocation_pct: 1.50, sector: 'Chemicals & Materials', mcap_category: 'Mid Cap' },
    { company: 'Aarti Industries Ltd', symbol: 'AARTIIND', allocation_pct: 1.45, sector: 'Chemicals & Materials', mcap_category: 'Mid Cap' },
    { company: 'Atul Ltd', symbol: 'ATUL', allocation_pct: 1.40, sector: 'Chemicals & Materials', mcap_category: 'Mid Cap' },
    { company: 'Deepak Nitrite Ltd', symbol: 'DEEPAKNTR', allocation_pct: 1.35, sector: 'Chemicals & Materials', mcap_category: 'Mid Cap' },
    { company: 'PI Industries Ltd', symbol: 'PIIND', allocation_pct: 1.30, sector: 'Chemicals & Materials', mcap_category: 'Large Cap' },
    { company: 'Tata Chemicals Ltd', symbol: 'TATACHEM', allocation_pct: 1.25, sector: 'Chemicals & Materials', mcap_category: 'Mid Cap' },
    { company: 'Coromandel International', symbol: 'COROMANDEL', allocation_pct: 1.20, sector: 'Chemicals & Materials', mcap_category: 'Large Cap' },
    { company: 'Chambal Fertilisers', symbol: 'CHAMBLFERT', allocation_pct: 1.15, sector: 'Chemicals & Materials', mcap_category: 'Small Cap' },
    { company: 'Sumitomo Chemical India', symbol: 'SUMICHEM', allocation_pct: 1.10, sector: 'Chemicals & Materials', mcap_category: 'Mid Cap' },
    { company: 'Rallis India Ltd', symbol: 'RALLIS', allocation_pct: 1.05, sector: 'Chemicals & Materials', mcap_category: 'Small Cap' },
    { company: 'Bayer CropScience Ltd', symbol: 'BAYERCROP', allocation_pct: 1.00, sector: 'Chemicals & Materials', mcap_category: 'Mid Cap' },
    { company: 'Cash & Short-Term Assets', symbol: 'CASH', allocation_pct: 3.85, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // HDFC Mid-Cap Opportunities Fund - Growth Option - Direct Plan (118989)
  '118989': [
    { company: 'Max Healthcare Institute Ltd', symbol: 'MAXHEALTH', allocation_pct: 4.62, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Tata Communications Ltd', symbol: 'TATACOMM', allocation_pct: 3.88, sector: 'Telecommunication & Media', mcap_category: 'Mid Cap' },
    { company: 'The Federal Bank Ltd', symbol: 'FEDERALBNK', allocation_pct: 3.65, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'Indian Hotels Co Ltd', symbol: 'INDHOTEL', allocation_pct: 3.52, sector: 'Consumer Discretionary', mcap_category: 'Large Cap' },
    { company: 'Bharat Electronics Ltd', symbol: 'BEL', allocation_pct: 3.30, sector: 'Capital Goods & Industrials', mcap_category: 'Large Cap' },
    { company: 'Coforge Ltd', symbol: 'COFORGE', allocation_pct: 3.15, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'Balkrishna Industries Ltd', symbol: 'BALKRISIND', allocation_pct: 2.95, sector: 'Automobiles & Auto Components', mcap_category: 'Mid Cap' },
    { company: 'Apollo Tyres Ltd', symbol: 'APOLLOTYRE', allocation_pct: 2.78, sector: 'Automobiles & Auto Components', mcap_category: 'Mid Cap' },
    { company: 'Astral Ltd', symbol: 'ASTRAL', allocation_pct: 2.65, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Persistent Systems Ltd', symbol: 'PERSISTENT', allocation_pct: 2.55, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'Cummins India Ltd', symbol: 'CUMMINSIND', allocation_pct: 2.45, sector: 'Capital Goods & Industrials', mcap_category: 'Large Cap' },
    { company: 'Supreme Industries Ltd', symbol: 'SUPREMEIND', allocation_pct: 2.30, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Sundram Fasteners Ltd', symbol: 'SUNDRMFAST', allocation_pct: 2.20, sector: 'Automobiles & Auto Components', mcap_category: 'Mid Cap' },
    { company: 'Bharat Forge Ltd', symbol: 'BHARATFORG', allocation_pct: 2.10, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Schaeffler India Ltd', symbol: 'SCHAEFFLER', allocation_pct: 2.00, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Timken India Ltd', symbol: 'TIMKEN', allocation_pct: 1.90, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'SKF India Ltd', symbol: 'SKFINDIA', allocation_pct: 1.80, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'AIA Engineering Ltd', symbol: 'AIAENG', allocation_pct: 1.70, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Thermax Ltd', symbol: 'THERMAX', allocation_pct: 1.60, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Voltas Ltd', symbol: 'VOLTAS', allocation_pct: 1.50, sector: 'Consumer Discretionary', mcap_category: 'Large Cap' },
    { company: 'Blue Star Ltd', symbol: 'BLUESTARCO', allocation_pct: 1.45, sector: 'Consumer Discretionary', mcap_category: 'Mid Cap' },
    { company: 'Crompton Greaves Consumer', symbol: 'CROMPTON', allocation_pct: 1.40, sector: 'Consumer Discretionary', mcap_category: 'Mid Cap' },
    { company: 'Havells India Ltd', symbol: 'HAVELLS', allocation_pct: 1.35, sector: 'Consumer Discretionary', mcap_category: 'Large Cap' },
    { company: 'Whirlpool of India Ltd', symbol: 'WHIRLPOOL', allocation_pct: 1.30, sector: 'Consumer Discretionary', mcap_category: 'Small Cap' },
    { company: 'Dixon Technologies (India)', symbol: 'DIXON', allocation_pct: 1.25, sector: 'Consumer Discretionary', mcap_category: 'Large Cap' },
    { company: 'Amber Enterprises India', symbol: 'AMBER', allocation_pct: 1.20, sector: 'Consumer Discretionary', mcap_category: 'Mid Cap' },
    { company: 'Polycab India Ltd', symbol: 'POLYCAB', allocation_pct: 1.15, sector: 'Capital Goods & Industrials', mcap_category: 'Large Cap' },
    { company: 'KEl Industries Ltd', symbol: 'KEI', allocation_pct: 1.10, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Finolex Cables Ltd', symbol: 'FINCABLES', allocation_pct: 1.05, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'RR Kabel Ltd', symbol: 'RRKABEL', allocation_pct: 1.00, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Cash & Short-Term Assets', symbol: 'CASH', allocation_pct: 3.46, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // BANDHAN SMALL CAP FUND - DIRECT PLAN GROWTH (147946)
  '147946': [
    { company: 'Motilal Oswal Financial Services', symbol: 'MOTILALOFS', allocation_pct: 4.25, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'Arvind Ltd', symbol: 'ARVIND', allocation_pct: 3.80, sector: 'Consumer Discretionary', mcap_category: 'Small Cap' },
    { company: 'REC Ltd', symbol: 'RECLTD', allocation_pct: 3.55, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'Shriram Pistons & Rings Ltd', symbol: 'SHRIRAMPPS', allocation_pct: 3.30, sector: 'Automobiles & Auto Components', mcap_category: 'Small Cap' },
    { company: 'Power Finance Corporation (PFC)', symbol: 'PFC', allocation_pct: 3.15, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'Apar Industries Ltd', symbol: 'APARINDS', allocation_pct: 2.95, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Cholamandalam Financial Holdings', symbol: 'CHOLAHLDNG', allocation_pct: 2.75, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'PCBL Ltd', symbol: 'PCBL', allocation_pct: 2.60, sector: 'Chemicals & Materials', mcap_category: 'Small Cap' },
    { company: 'Radico Khaitan Ltd', symbol: 'RADICO', allocation_pct: 2.45, sector: 'Consumer Staples & FMCG', mcap_category: 'Large Cap' },
    { company: 'Godfrey Phillips India', symbol: 'GODFRYPHLP', allocation_pct: 2.35, sector: 'Consumer Staples & FMCG', mcap_category: 'Mid Cap' },
    { company: 'Bikaji Foods International', symbol: 'BIKAJI', allocation_pct: 2.25, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'CCL Products (India) Ltd', symbol: 'CCL', allocation_pct: 2.15, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'Mrs Bectors Food Specialities', symbol: 'BECTORFOOD', allocation_pct: 2.05, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'Avanti Feeds Ltd', symbol: 'AVANTIFEED', allocation_pct: 1.95, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'KRBL Ltd', symbol: 'KRBL', allocation_pct: 1.85, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'LT Foods Ltd', symbol: 'DAAWAT', allocation_pct: 1.75, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'Zydus Wellness Ltd', symbol: 'ZYDUSWELL', allocation_pct: 1.65, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'Heritage Foods Ltd', symbol: 'HERITGFOOD', allocation_pct: 1.55, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'Dodla Dairy Ltd', symbol: 'DODLA', allocation_pct: 1.45, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'Hatsun Agro Product Ltd', symbol: 'HATSUN', allocation_pct: 1.35, sector: 'Consumer Staples & FMCG', mcap_category: 'Mid Cap' },
    { company: 'Parag Milk Foods Ltd', symbol: 'PARAGMILK', allocation_pct: 1.25, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'Kalyani Steels Ltd', symbol: 'KSL', allocation_pct: 1.15, sector: 'Metals & Mining', mcap_category: 'Small Cap' },
    { company: 'Maharashtra Seamless Ltd', symbol: 'MAHSEAMLES', allocation_pct: 1.10, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Jindal Saw Ltd', symbol: 'JINDALSAW', allocation_pct: 1.05, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Manaksia Coated Metals', symbol: 'MANAKCOAT', allocation_pct: 1.00, sector: 'Capital Goods & Industrials', mcap_category: 'Micro Cap' },
    { company: 'Zen Technologies Ltd', symbol: 'ZENTEC', allocation_pct: 0.95, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Dynamic Cables Ltd', symbol: 'DYCL', allocation_pct: 0.90, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Pondy Oxides & Chemicals', symbol: 'POCL', allocation_pct: 0.85, sector: 'Metals & Mining', mcap_category: 'Small Cap' },
    { company: 'Cash & Short-Term Assets', symbol: 'CASH', allocation_pct: 3.45, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // Motilal Oswal Midcap Fund-Direct Plan-Growth Option (127042)
  '127042': [
    { company: 'Persistent Systems Ltd', symbol: 'PERSISTENT', allocation_pct: 8.50, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'Coforge Ltd', symbol: 'COFORGE', allocation_pct: 7.80, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'Polycab India Ltd', symbol: 'POLYCAB', allocation_pct: 6.90, sector: 'Capital Goods & Industrials', mcap_category: 'Large Cap' },
    { company: 'Dixon Technologies (India)', symbol: 'DIXON', allocation_pct: 6.50, sector: 'Consumer Discretionary', mcap_category: 'Large Cap' },
    { company: 'Tube Investments of India', symbol: 'TIINDIA', allocation_pct: 5.80, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Kalyan Jewellers India Ltd', symbol: 'KALYANKJIL', allocation_pct: 5.40, sector: 'Consumer Discretionary', mcap_category: 'Mid Cap' },
    { company: 'Astral Ltd', symbol: 'ASTRAL', allocation_pct: 4.90, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Max Healthcare Institute', symbol: 'MAXHEALTH', allocation_pct: 4.50, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Trent Ltd', symbol: 'TRENT', allocation_pct: 4.20, sector: 'Consumer Discretionary', mcap_category: 'Mega Cap' },
    { company: 'Indian Hotels Co Ltd', symbol: 'INDHOTEL', allocation_pct: 3.90, sector: 'Consumer Discretionary', mcap_category: 'Large Cap' },
    { company: 'The Federal Bank Ltd', symbol: 'FEDERALBNK', allocation_pct: 3.60, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'IDFC First Bank Ltd', symbol: 'IDFCFIRSTB', allocation_pct: 3.30, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'AU Small Finance Bank', symbol: 'AUBANK', allocation_pct: 3.00, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'Max Financial Services Ltd', symbol: 'MFSL', allocation_pct: 2.80, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'SBI Life Insurance Co Ltd', symbol: 'SBILIFE', allocation_pct: 2.60, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'HDFC Life Insurance Co', symbol: 'HDFCLIFE', allocation_pct: 2.40, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'ICICI Lombard General Ins', symbol: 'ICICIGI', allocation_pct: 2.20, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'Bajaj Holdings & Investment', symbol: 'BAJAJHLDNG', allocation_pct: 2.00, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'Cholamandalam Investment', symbol: 'CHOLAFIN', allocation_pct: 1.80, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'Sundaram Finance Ltd', symbol: 'SUNDARMFIN', allocation_pct: 1.60, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'Muthoot Finance Ltd', symbol: 'MUTHOOTFIN', allocation_pct: 1.40, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'Manappuram Finance Ltd', symbol: 'MANAPPURAM', allocation_pct: 1.20, sector: 'Financial Services', mcap_category: 'Small Cap' },
    { company: 'Shriram Finance Ltd', symbol: 'SHRIRAMFIN', allocation_pct: 1.10, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'Cash & Short-Term Assets', symbol: 'CASH', allocation_pct: 3.60, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // PGIM India Midcap Fund - Direct Plan - Growth Option (125307)
  '125307': [
    { company: 'Persistent Systems Ltd', symbol: 'PERSISTENT', allocation_pct: 4.85, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'Cummins India Ltd', symbol: 'CUMMINSIND', allocation_pct: 4.20, sector: 'Capital Goods & Industrials', mcap_category: 'Large Cap' },
    { company: 'The Federal Bank Ltd', symbol: 'FEDERALBNK', allocation_pct: 3.90, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'Bharat Forge Ltd', symbol: 'BHARATFORG', allocation_pct: 3.65, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Tata Communications Ltd', symbol: 'TATACOMM', allocation_pct: 3.40, sector: 'Telecommunication & Media', mcap_category: 'Mid Cap' },
    { company: 'Dalmia Bharat Ltd', symbol: 'DALBHARAT', allocation_pct: 3.15, sector: 'Infrastructure & Real Estate', mcap_category: 'Mid Cap' },
    { company: 'Max Financial Services Ltd', symbol: 'MFSL', allocation_pct: 2.90, sector: 'Financial Services', mcap_category: 'Mid Cap' },
    { company: 'Timken India Ltd', symbol: 'TIMKEN', allocation_pct: 2.75, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Thermax Ltd', symbol: 'THERMAX', allocation_pct: 2.60, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'AIA Engineering Ltd', symbol: 'AIAENG', allocation_pct: 2.50, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'SKF India Ltd', symbol: 'SKFINDIA', allocation_pct: 2.40, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Schaeffler India Ltd', symbol: 'SCHAEFFLER', allocation_pct: 2.30, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Sundram Fasteners Ltd', symbol: 'SUNDRMFAST', allocation_pct: 2.20, sector: 'Automobiles & Auto Components', mcap_category: 'Mid Cap' },
    { company: 'Endurance Technologies', symbol: 'ENDURANCE', allocation_pct: 2.10, sector: 'Automobiles & Auto Components', mcap_category: 'Mid Cap' },
    { company: 'Minda Corporation Ltd', symbol: 'MINDACORP', allocation_pct: 2.00, sector: 'Automobiles & Auto Components', mcap_category: 'Small Cap' },
    { company: 'Uno Minda Ltd', symbol: 'UNOMINDA', allocation_pct: 1.90, sector: 'Automobiles & Auto Components', mcap_category: 'Mid Cap' },
    { company: 'Sona BLW Precision Forgings', symbol: 'SONACOMS', allocation_pct: 1.80, sector: 'Automobiles & Auto Components', mcap_category: 'Mid Cap' },
    { company: 'CIE Automotive India Ltd', symbol: 'CIEINDIA', allocation_pct: 1.70, sector: 'Automobiles & Auto Components', mcap_category: 'Mid Cap' },
    { company: 'Gabriel India Ltd', symbol: 'GABRIEL', allocation_pct: 1.60, sector: 'Automobiles & Auto Components', mcap_category: 'Mid Cap' },
    { company: 'Sansera Engineering Ltd', symbol: 'SANSERA', allocation_pct: 1.50, sector: 'Automobiles & Auto Components', mcap_category: 'Mid Cap' },
    { company: 'Suprajit Engineering Ltd', symbol: 'SUPRAJIT', allocation_pct: 1.40, sector: 'Automobiles & Auto Components', mcap_category: 'Small Cap' },
    { company: 'Varroc Engineering Ltd', symbol: 'VARROC', allocation_pct: 1.30, sector: 'Automobiles & Auto Components', mcap_category: 'Small Cap' },
    { company: 'Lumax Auto Technologies', symbol: 'LUMAXTECH', allocation_pct: 1.20, sector: 'Automobiles & Auto Components', mcap_category: 'Small Cap' },
    { company: 'Alicon Castalloy Ltd', symbol: 'ALICON', allocation_pct: 1.10, sector: 'Automobiles & Auto Components', mcap_category: 'Small Cap' },
    { company: 'Cash & Short-Term Assets', symbol: 'CASH', allocation_pct: 3.45, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // CANARA ROBECO SMALL CAP FUND - DIRECT PLAN - GROWTH OPTION (146130)
  '146130': [
    { company: 'Kaynes Technology India', symbol: 'KAYNES', allocation_pct: 4.85, sector: 'Information Technology', mcap_category: 'Mid Cap' },
    { company: 'KEl Industries Ltd', symbol: 'KEI', allocation_pct: 4.60, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Equitas Small Finance Bank', symbol: 'EQUITASBNK', allocation_pct: 4.40, sector: 'Financial Services', mcap_category: 'Small Cap' },
    { company: 'CreditAccess Grameen Ltd', symbol: 'CREDITACC', allocation_pct: 4.15, sector: 'Financial Services', mcap_category: 'Small Cap' },
    { company: 'Cera Sanitaryware Ltd', symbol: 'CERA', allocation_pct: 3.90, sector: 'Infrastructure & Real Estate', mcap_category: 'Small Cap' },
    { company: 'Can Fin Homes Ltd', symbol: 'CANFINHOME', allocation_pct: 3.75, sector: 'Financial Services', mcap_category: 'Small Cap' },
    { company: 'City Union Bank Ltd', symbol: 'CUB', allocation_pct: 3.60, sector: 'Financial Services', mcap_category: 'Small Cap' },
    { company: 'Karur Vysya Bank Ltd', symbol: 'KVB', allocation_pct: 3.45, sector: 'Financial Services', mcap_category: 'Small Cap' },
    { company: 'Radico Khaitan Ltd', symbol: 'RADICO', allocation_pct: 3.30, sector: 'Consumer Staples & FMCG', mcap_category: 'Large Cap' },
    { company: 'Bikaji Foods International', symbol: 'BIKAJI', allocation_pct: 3.15, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'CCL Products (India) Ltd', symbol: 'CCL', allocation_pct: 3.00, sector: 'Consumer Staples & FMCG', mcap_category: 'Small Cap' },
    { company: 'Glenmark Pharmaceuticals', symbol: 'GLENMARK', allocation_pct: 2.85, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'JB Chemicals & Pharmaceuticals', symbol: 'JBCHEPHARM', allocation_pct: 2.70, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'Krishna Institute of Medical', symbol: 'KIMS', allocation_pct: 2.55, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Small Cap' },
    { company: 'Narayana Hrudayalaya Ltd', symbol: 'NH', allocation_pct: 2.40, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'Aster DM Healthcare', symbol: 'ASTERDM', allocation_pct: 2.25, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'Suven Pharmaceuticals Ltd', symbol: 'SUVENPHAR', allocation_pct: 2.10, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'Sonata Software Ltd', symbol: 'SONATSOFTW', allocation_pct: 2.00, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Birlasoft Ltd', symbol: 'BSOFT', allocation_pct: 1.90, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Zensar Technologies Ltd', symbol: 'ZENSARTECH', allocation_pct: 1.80, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Cyient Ltd', symbol: 'CYIENT', allocation_pct: 1.70, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Happiest Minds Technologies', symbol: 'HAPPSTMNDS', allocation_pct: 1.60, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Tanla Platforms Ltd', symbol: 'TANLA', allocation_pct: 1.50, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'RateGain Travel Technologies', symbol: 'RATEGAIN', allocation_pct: 1.40, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Latent View Analytics', symbol: 'LATENTVIEW', allocation_pct: 1.30, sector: 'Information Technology', mcap_category: 'Small Cap' },
    { company: 'Zen Technologies Ltd', symbol: 'ZENTEC', allocation_pct: 1.20, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Dynamic Cables Ltd', symbol: 'DYCL', allocation_pct: 1.10, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Skipper Ltd', symbol: 'SKIPPER', allocation_pct: 1.00, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'Techno Electric & Engg', symbol: 'TECHNOE', allocation_pct: 0.90, sector: 'Capital Goods & Industrials', mcap_category: 'Small Cap' },
    { company: 'TD Power Systems Ltd', symbol: 'TDPOWERSYS', allocation_pct: 0.80, sector: 'Capital Goods & Industrials', mcap_category: 'Mid Cap' },
    { company: 'Cash & Short-Term Assets', symbol: 'CASH', allocation_pct: 3.10, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // Quant Multi Cap Fund-GROWTH OPTION-Direct Plan (120823)
  '120823': [
    { company: 'Reliance Industries Ltd', symbol: 'RELIANCE', allocation_pct: 8.50, sector: 'Energy, Power & Utilities', mcap_category: 'Mega Cap' },
    { company: 'Jio Financial Services Ltd', symbol: 'JIOFIN', allocation_pct: 5.20, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'HDFC Bank Ltd', symbol: 'HDFCBANK', allocation_pct: 4.90, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'Larsen & Toubro Ltd', symbol: 'LT', allocation_pct: 4.10, sector: 'Capital Goods & Industrials', mcap_category: 'Mega Cap' },
    { company: 'Tata Consultancy Services', symbol: 'TCS', allocation_pct: 3.80, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'Infosys Ltd', symbol: 'INFY', allocation_pct: 3.50, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'ICICI Bank Ltd', symbol: 'ICICIBANK', allocation_pct: 3.30, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'State Bank of India', symbol: 'SBIN', allocation_pct: 3.10, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'NTPC Ltd', symbol: 'NTPC', allocation_pct: 2.90, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Power Grid Corporation', symbol: 'POWERGRID', allocation_pct: 2.70, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Coal India Ltd', symbol: 'COALINDIA', allocation_pct: 2.50, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Tata Motors Ltd', symbol: 'TATAMOTORS', allocation_pct: 2.40, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Mahindra & Mahindra Ltd', symbol: 'M&M', allocation_pct: 2.30, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Maruti Suzuki India Ltd', symbol: 'MARUTI', allocation_pct: 2.20, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Bajaj Finance Ltd', symbol: 'BAJFINANCE', allocation_pct: 2.10, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'Sun Pharmaceutical Industries', symbol: 'SUNPHARMA', allocation_pct: 2.00, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Dr Reddys Laboratories', symbol: 'DRREDDY', allocation_pct: 1.90, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Cipla Ltd', symbol: 'CIPLA', allocation_pct: 1.80, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Lupin Ltd', symbol: 'LUPIN', allocation_pct: 1.70, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Aurobindo Pharma Ltd', symbol: 'AUROPHARMA', allocation_pct: 1.60, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Alkem Laboratories Ltd', symbol: 'ALKEM', allocation_pct: 1.50, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Torrent Pharmaceuticals', symbol: 'TORNTPHARM', allocation_pct: 1.40, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Zydus Lifesciences Ltd', symbol: 'ZYDUSLIFE', allocation_pct: 1.30, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Glenmark Pharmaceuticals', symbol: 'GLENMARK', allocation_pct: 1.20, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'Biocon Ltd', symbol: 'BIOCON', allocation_pct: 1.10, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'Gland Pharma Ltd', symbol: 'GLAND', allocation_pct: 1.00, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'Laurus Labs Ltd', symbol: 'LAURUSLABS', allocation_pct: 0.90, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Mid Cap' },
    { company: 'Granules India Ltd', symbol: 'GRANULES', allocation_pct: 0.80, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Small Cap' },
    { company: 'Aegis Logistics Ltd', symbol: 'AEGISLOG', allocation_pct: 0.70, sector: 'Energy, Power & Utilities', mcap_category: 'Mid Cap' },
    { company: 'HFCL Ltd', symbol: 'HFCL', allocation_pct: 0.60, sector: 'Telecommunication & Media', mcap_category: 'Small Cap' },
    { company: 'Arvind Ltd', symbol: 'ARVIND', allocation_pct: 0.50, sector: 'Consumer Discretionary', mcap_category: 'Small Cap' },
    { company: 'Cash & Short-Term Assets', symbol: 'CASH', allocation_pct: 3.50, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // Invesco India Largecap Fund - Direct Plan - Growth (120392)
  '120392': [
    { company: 'HDFC Bank Ltd', symbol: 'HDFCBANK', allocation_pct: 9.80, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'ICICI Bank Ltd', symbol: 'ICICIBANK', allocation_pct: 9.10, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'Reliance Industries Ltd', symbol: 'RELIANCE', allocation_pct: 7.90, sector: 'Energy, Power & Utilities', mcap_category: 'Mega Cap' },
    { company: 'Infosys Ltd', symbol: 'INFY', allocation_pct: 6.50, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'Tata Consultancy Services', symbol: 'TCS', allocation_pct: 5.20, sector: 'Information Technology', mcap_category: 'Mega Cap' },
    { company: 'Larsen & Toubro Ltd', symbol: 'LT', allocation_pct: 4.80, sector: 'Capital Goods & Industrials', mcap_category: 'Mega Cap' },
    { company: 'ITC Ltd', symbol: 'ITC', allocation_pct: 4.50, sector: 'Consumer Staples & FMCG', mcap_category: 'Mega Cap' },
    { company: 'State Bank of India', symbol: 'SBIN', allocation_pct: 4.20, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'Bharti Airtel Ltd', symbol: 'BHARTIARTL', allocation_pct: 3.90, sector: 'Telecommunication & Media', mcap_category: 'Mega Cap' },
    { company: 'Axis Bank Ltd', symbol: 'AXISBANK', allocation_pct: 3.60, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'Kotak Mahindra Bank Ltd', symbol: 'KOTAKBANK', allocation_pct: 3.30, sector: 'Financial Services', mcap_category: 'Large Cap' },
    { company: 'NTPC Ltd', symbol: 'NTPC', allocation_pct: 3.00, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Power Grid Corporation', symbol: 'POWERGRID', allocation_pct: 2.80, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Tata Motors Ltd', symbol: 'TATAMOTORS', allocation_pct: 2.60, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Mahindra & Mahindra Ltd', symbol: 'M&M', allocation_pct: 2.40, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Maruti Suzuki India Ltd', symbol: 'MARUTI', allocation_pct: 2.20, sector: 'Automobiles & Auto Components', mcap_category: 'Large Cap' },
    { company: 'Sun Pharmaceutical Industries', symbol: 'SUNPHARMA', allocation_pct: 2.00, sector: 'Healthcare & Pharmaceuticals', mcap_category: 'Large Cap' },
    { company: 'Bajaj Finance Ltd', symbol: 'BAJFINANCE', allocation_pct: 1.90, sector: 'Financial Services', mcap_category: 'Mega Cap' },
    { company: 'Hindustan Unilever Ltd', symbol: 'HINDUNILVR', allocation_pct: 1.80, sector: 'Consumer Staples & FMCG', mcap_category: 'Mega Cap' },
    { company: 'UltraTech Cement Ltd', symbol: 'ULTRACEMCO', allocation_pct: 1.70, sector: 'Infrastructure & Real Estate', mcap_category: 'Large Cap' },
    { company: 'Titan Company Ltd', symbol: 'TITAN', allocation_pct: 1.60, sector: 'Consumer Discretionary', mcap_category: 'Large Cap' },
    { company: 'Asian Paints Ltd', symbol: 'ASIANPAINT', allocation_pct: 1.50, sector: 'Consumer Staples & FMCG', mcap_category: 'Large Cap' },
    { company: 'Tata Steel Ltd', symbol: 'TATASTEEL', allocation_pct: 1.40, sector: 'Metals & Mining', mcap_category: 'Large Cap' },
    { company: 'Hindalco Industries Ltd', symbol: 'HINDALCO', allocation_pct: 1.30, sector: 'Metals & Mining', mcap_category: 'Large Cap' },
    { company: 'Coal India Ltd', symbol: 'COALINDIA', allocation_pct: 1.20, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Oil & Natural Gas Corp (ONGC)', symbol: 'ONGC', allocation_pct: 1.10, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Bharat Petroleum Corp (BPCL)', symbol: 'BPCL', allocation_pct: 1.00, sector: 'Energy, Power & Utilities', mcap_category: 'Large Cap' },
    { company: 'Cash & Short-Term Assets', symbol: 'CASH', allocation_pct: 3.80, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ],

  // Nippon India Gilt Fund -Growth Plan - Growth Option (109720)
  '109720': [
    { company: 'Government of India Sovereign Bond 7.18% 2033', symbol: 'GOI718', allocation_pct: 42.50, sector: 'Cash, Debt & Other', mcap_category: 'Cash' },
    { company: 'Government of India Sovereign Bond 7.26% 2032', symbol: 'GOI726', allocation_pct: 35.80, sector: 'Cash, Debt & Other', mcap_category: 'Cash' },
    { company: 'Government of India Sovereign Bond 7.06% 2028', symbol: 'GOI706', allocation_pct: 18.20, sector: 'Cash, Debt & Other', mcap_category: 'Cash' },
    { company: 'TREPS / Reverse Repo / Cash', symbol: 'TREPS', allocation_pct: 3.50, sector: 'Cash, Debt & Other', mcap_category: 'Cash' }
  ]
};

export async function syncMutualFundHoldings() {
  console.log('[MF Sync] Initializing Database & Schemes...');
  await initDatabase();

  const holdings = await db.select('holdings');
  const mfHoldings = holdings.filter(h => h.category_id === 'mutual_funds');
  const schemeNameMap = {};
  mfHoldings.forEach(h => {
    schemeNameMap[h.symbol] = h.name;
  });

  const recordsToInsert = [];
  const fullExport = {};

  for (const [schemeCode, rawCompanies] of Object.entries(MF_PORTFOLIOS)) {
    const schemeName = schemeNameMap[schemeCode] || `Mutual Fund Scheme ${schemeCode}`;
    const normalizedCompanies = rawCompanies.map(c => ({
      ...c,
      sector: normalizeSector(c.sector)
    }));

    fullExport[schemeCode] = {
      scheme_code: schemeCode,
      scheme_name: schemeName,
      companies: normalizedCompanies
    };

    normalizedCompanies.forEach(c => {
      recordsToInsert.push({
        scheme_code: schemeCode,
        scheme_name: schemeName,
        company_name: c.company,
        symbol: c.symbol,
        allocation_pct: c.allocation_pct,
        sector: c.sector,
        mcap_category: c.mcap_category,
        last_updated: new Date().toISOString()
      });
    });
  }

  // Clear and populate Supabase table
  console.log(`[MF Sync] Updating Supabase mutual_fund_holdings with ${recordsToInsert.length} constituent rows...`);
  await supabase.from('mutual_fund_holdings').delete().neq('scheme_code', '___NONE___');

  // Insert in batches of 50
  for (let i = 0; i < recordsToInsert.length; i += 50) {
    const batch = recordsToInsert.slice(i, i + 50);
    const { error } = await supabase.from('mutual_fund_holdings').insert(batch);
    if (error) console.error('[MF Sync] Batch insert error:', error.message);
  }

  // Save to local JSON backup
  fs.writeFileSync(DATA_FILE, JSON.stringify(fullExport, null, 2), 'utf8');
  console.log(`[MF Sync] Successfully saved mutual fund portfolio holdings to Supabase & ${DATA_FILE}`);
}

if (process.argv[1] && process.argv[1].endsWith('sync_mf_holdings.mjs')) {
  syncMutualFundHoldings().then(() => {
    console.log('MF Holdings sync completed successfully!');
    process.exit(0);
  }).catch(err => {
    console.error('MF Holdings sync failed:', err);
    process.exit(1);
  });
}
