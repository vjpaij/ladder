import stockLogosMap from '../data/stockLogosMap.js';
import stockDomainsMap from '../data/stockDomainsMap.js';
import stockTvLogosMap from '../data/stockTvLogosMap.js';

const pushLogos = (urls, domain) => {
  if (!domain) return;
  const cleanDomain = String(domain).replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].trim().toLowerCase();
  if (!cleanDomain) return;
  urls.push(`https://logos.hunter.io/${cleanDomain}`);
  urls.push(`https://unavatar.io/${cleanDomain}?fallback=false`);
};

// Known custom domain mappings for companies or schemes
const KNOWN_STOCK_DOMAINS = {
  'ATHERENERG': 'atherenergy.com',
  'CORONA': 'coronaremedies.com',
  'GABRIEL': 'anandgroupindia.com',
  'INDGN': 'indegene.com',
  'RADICO': 'radicokhaitan.com',
  'SANSERA': 'sansera.in',
  'AFFLE': 'affle.com',
  'AWL': 'adaniwilmar.com',
  'BECTORFOOD': 'bectorfoods.com',
  'BSOFT': 'birlasoft.com',
  'BOROSCI': 'borosilscientific.com',
  'DATAPATTNS': 'datapatterns.co.in',
  'DYCL': 'dynamiccables.co.in',
  'INDHOTEL': 'ihcltata.com',
  'INDOTECH': 'indo-tech.com',
  'IRCON': 'ircon.org',
  'JKLAKSHMI': 'jklakshmicement.com',
  'KEI': 'kei-ind.com',
  'KPITTECH': 'kpit.com',
  'KPIT': 'kpit.com',
  'KPRMILL': 'kprmilllimited.com',
  'MOLDTECH': 'moldtekgroup.com',
  'MOLDTKPAC': 'moldtekpackaging.com',
  'NETWEB': 'netwebindia.com',
  'NYKAA': 'nykaa.com',
  'OFSS': 'oracle.com',
  'ORIENTCEM': 'orientcement.com',
  'RAMCOSYS': 'ramco.com',
  'RICOAUTO': 'ricoauto.com',
  'SCHAEFFLER': 'schaeffler.com',
  'SHANTIGEAR': 'shanthigears.com',
  'SHYAMMETL': 'shyammetalics.com',
  'TRITURBINE': 'triveniturbines.com',
  'UJJIVANSFB': 'ujjivansfb.in',
  'VOLTAS': 'voltas.com',
  'WAAREEENER': 'waaree.com',
  'WEBELSOLAR': 'websolenergy.com',
  'SWANENERGY': 'swanenergy.com',
  'SEQUENT': 'sequent.in',
  'DHOOTTRANS': 'dhoottransmission.com',
  'SHANKESH': 'shankeshjewellers.com',
  'ARTEMISMED': 'artemishospitals.com',
  ...stockDomainsMap
};

// Direct high-res verified official corporate brand logos
const KNOWN_STOCK_LOGOS = {
  'AIAENG': '/logos/aiaeng.png',
  'SHANKESH': '/logos/shankesh.png',
  'ARTEMISMED': '/logos/artemis.png',
  'DYCL': 'https://www.dynamiccables.co.in/images/logo-dark.png',
  'GABRIEL': 'https://www.anandgroupindia.com/wp-content/uploads/2017/10/gabriel_child.gif',
  'DHOOTTRANS': '/logos/dhoottrans.png',
  'INDGN': '/logos/indegene.png',
  'FRACTAL': '/logos/fractal.png',
  'ANANTRAJ': '/logos/anantraj.png',
  'VAML': '/logos/vaml.png',
  'VEDPOWER': '/logos/vaml.png',
  'VOGL': '/logos/vaml.png',
  'SBCL': '/logos/sbcl.jpg',
  'TARIL': '/logos/taril.png',
  'HBLENGINE': '/logos/hblengine.png',
  'HBLPOWER': '/logos/hblengine.png',
  'PNB': '/logos/pnb.svg',
  'TVSMOTOR': '/logos/tvsmotor.svg',
  'SYRMA': '/logos/syrma.png',
  'SUDEEPPHRM': '/logos/sudeep.png',
  'EMMVEE': 'https://emmvee.com/wp-content/uploads/2019/08/emvlogo.png',
  'SHYAMMETL': '/logos/shyammetl.png',
  'JBCHEPHARM': '/logos/jbchepharm.svg',
  'SBIN': '/logos/sbi.png',
  'SBI': '/logos/sbi.png',
  'STATEBANK': '/logos/sbi.png'
};

export const getLogoUrlsForHolding = (name = '', symbol = '', category = '') => {
  const n = (name || '').toLowerCase();
  const rawSym = (symbol || '').toUpperCase().trim();
  const cleanSym = rawSym.replace(/\.(NS|BO|BSE|NSE)$/i, '').replace(/[^A-Z0-9]/g, '').trim();
  const s = cleanSym || rawSym;
  const urls = [];

  // US Stocks
  if (category === 'us_stocks') {
    if (s) {
      urls.push(`https://assets.parqet.com/logos/symbol/${s}`);
      urls.push(`https://storage.googleapis.com/iex/api/logos/${s}.png`);
      urls.push(`https://companiesmarketcap.com/img/company-logos/64/${s}.webp`);
      pushLogos(urls, `${s.toLowerCase()}.com`);
    }
    return urls;
  }

  // Employee Provident Fund (EPF)
  if (category === 'epf' || n.includes('epf') || n.includes('provident fund') || s.includes('EPF')) {
    urls.push('https://www.epfindia.gov.in/site_docs/images/epfo_logo.png');
    urls.push('https://upload.wikimedia.org/wikipedia/en/thumb/e/ef/Employees%27_Provident_Fund_Organisation_Logo.svg/1200px-Employees%27_Provident_Fund_Organisation_Logo.svg.png');
    pushLogos(urls, 'epfindia.gov.in');
    return urls;
  }

  // Mutual Funds & NPS
  if (category === 'mutual_funds' || category === 'nps') {
    if (n.includes('hdfc')) {
      urls.push('https://s3-symbol-logo.tradingview.com/hdfc-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/HDFCAMC.NS.png');
      pushLogos(urls, 'hdfcfund.com');
      pushLogos(urls, 'hdfclife.com');
    }
    if (n.includes('sbi') || n.includes('state bank')) {
      urls.push('/logos/sbi.png');
      urls.push('https://s3-symbol-logo.tradingview.com/state-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/SBIN.NS.png');
      pushLogos(urls, 'sbimf.com');
      pushLogos(urls, 'sbipensionfunds.com');
    }
    if (n.includes('icici') || n.includes('pru')) {
      urls.push('https://s3-symbol-logo.tradingview.com/icici-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/ICICIPRULI.NS.png');
      pushLogos(urls, 'icicipruamc.com');
      pushLogos(urls, 'iciciprulife.com');
    }
    if (n.includes('axis')) {
      urls.push('https://s3-symbol-logo.tradingview.com/axis-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/AXISBANK.NS.png');
      pushLogos(urls, 'axismf.com');
      pushLogos(urls, 'axisbank.com');
    }
    if (n.includes('kotak')) {
      urls.push('https://s3-symbol-logo.tradingview.com/kotak-mahindra-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/KOTAKBANK.NS.png');
      pushLogos(urls, 'kotakmf.com');
      pushLogos(urls, 'kotakpension.com');
    }
    if (n.includes('lic')) {
      urls.push('https://s3-symbol-logo.tradingview.com/life-insurance-corporation-of-india--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/LICI.NS.png');
      pushLogos(urls, 'licmf.com');
      pushLogos(urls, 'licindia.in');
    }
    if (n.includes('tata')) {
      urls.push('https://companiesmarketcap.com/img/company-logos/256/TATAMOTORS.NS.png');
      pushLogos(urls, 'tatamutualfund.com');
      pushLogos(urls, 'tatapension.com');
    }
    if (n.includes('aditya') || n.includes('birl') || n.includes('absl')) {
      urls.push('https://companiesmarketcap.com/img/company-logos/256/ABCAPITAL.NS.png');
      pushLogos(urls, 'adityabirlacapital.com');
    }
    if (n.includes('canara') || n.includes('robeco')) {
      urls.push('https://s3-symbol-logo.tradingview.com/canara-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/CANBK.NS.png');
      pushLogos(urls, 'canararobeco.com');
    }
    if (n.includes('nippon')) {
      urls.push('https://companiesmarketcap.com/img/company-logos/256/NAM-INDIA.NS.png');
      pushLogos(urls, 'nipponindiaim.com');
    }
    if (n.includes('uti')) {
      urls.push('https://companiesmarketcap.com/img/company-logos/256/UTIAMC.NS.png');
      pushLogos(urls, 'utimf.com');
      pushLogos(urls, 'utiretirement.com');
    }
    if (n.includes('mirae')) {
      pushLogos(urls, 'miraeassetmf.co.in');
      pushLogos(urls, 'miraeasset.co.in');
    }
    if (n.includes('dsp')) pushLogos(urls, 'dspim.com');
    if (n.includes('motilal')) {
      urls.push('https://companiesmarketcap.com/img/company-logos/256/MOTILALOFS.NS.png');
      pushLogos(urls, 'motilaloswalmf.com');
    }
    if (n.includes('franklin')) pushLogos(urls, 'franklintempletonindia.com');
    if (n.includes('quant')) pushLogos(urls, 'quantmutual.com');
    if (n.includes('parag') || n.includes('ppfas')) pushLogos(urls, 'amc.ppfas.com');
    if (n.includes('bandhan')) {
      urls.push('https://companiesmarketcap.com/img/company-logos/256/BANDHANBNK.NS.png');
      pushLogos(urls, 'bandhanmutual.com');
    }
    if (n.includes('invesco')) pushLogos(urls, 'invescomutualfund.com');
    if (n.includes('hsbc')) pushLogos(urls, 'assetmanagement.hsbc.co.in');
    if (n.includes('sundaram')) pushLogos(urls, 'sundarammutual.com');
    if (n.includes('pgim')) pushLogos(urls, 'pgimindiamf.com');
    if (n.includes('whiteoak')) pushLogos(urls, 'whiteoakamc.com');
    if (n.includes('edelweiss')) {
      urls.push('https://companiesmarketcap.com/img/company-logos/256/EDELWEISS.NS.png');
      pushLogos(urls, 'edelweissmf.com');
    }
    if (n.includes('navi')) pushLogos(urls, 'navi.com');
    if (n.includes('samco')) pushLogos(urls, 'samcomf.com');
    if (n.includes('baroda')) {
      urls.push('https://s3-symbol-logo.tradingview.com/bank-of-baroda--600.png');
      pushLogos(urls, 'barodabnpparibasmf.in');
    }
    if (n.includes('mahindra')) {
      urls.push('https://companiesmarketcap.com/img/company-logos/256/M&M.NS.png');
      pushLogos(urls, 'mahindramanulife.com');
    }
    if (n.includes('union')) {
      urls.push('https://s3-symbol-logo.tradingview.com/union-bank-of-india--600.png');
      pushLogos(urls, 'unionmf.com');
    }
    if (n.includes('max')) {
      urls.push('https://companiesmarketcap.com/img/company-logos/256/MFSL.NS.png');
      pushLogos(urls, 'maxlifeinsurance.com');
      pushLogos(urls, 'maxpension.co.in');
    }
    return urls;
  }

  // Banking & Financial institutions (Loans, Credit Cards, Banks)
  if (category === 'bank' || category === 'loans' || category === 'credit_cards') {
    if (n.includes('federal')) {
      urls.push('https://s3-symbol-logo.tradingview.com/fed-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/FEDERALBNK.NS.png');
      pushLogos(urls, 'federalbank.co.in');
    }
    if (n.includes('idfc')) {
      urls.push('https://s3-symbol-logo.tradingview.com/idfc-first-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/IDFCFIRSTB.NS.png');
      pushLogos(urls, 'idfcfirstbank.com');
    }
    if (n.includes('hdfc')) {
      urls.push('https://s3-symbol-logo.tradingview.com/hdfc-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/HDFCBANK.NS.png');
      pushLogos(urls, 'hdfcbank.com');
    }
    if (n.includes('sbi') || n.includes('state bank')) {
      urls.push('/logos/sbi.png');
      urls.push('https://s3-symbol-logo.tradingview.com/state-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/SBIN.NS.png');
      pushLogos(urls, 'sbi.co.in');
    }
    if (n.includes('icici')) {
      urls.push('https://s3-symbol-logo.tradingview.com/icici-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/ICICIBANK.NS.png');
      pushLogos(urls, 'icicibank.com');
    }
    if (n.includes('axis')) {
      urls.push('https://s3-symbol-logo.tradingview.com/axis-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/AXISBANK.NS.png');
      pushLogos(urls, 'axisbank.com');
    }
    if (n.includes('kotak')) {
      urls.push('https://s3-symbol-logo.tradingview.com/kotak-mahindra-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/KOTAKBANK.NS.png');
      pushLogos(urls, 'kotak.com');
    }
    if (n.includes('indusind')) {
      urls.push('https://companiesmarketcap.com/img/company-logos/256/INDUSINDBK.NS.png');
      pushLogos(urls, 'indusind.com');
    }
    if (n.includes('rbl')) {
      urls.push('https://companiesmarketcap.com/img/company-logos/256/RBLBANK.NS.png');
      pushLogos(urls, 'rblbank.com');
    }
    if (n.includes('bank of baroda') || n.includes('bob')) {
      urls.push('https://s3-symbol-logo.tradingview.com/bank-of-baroda--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/BANKBARODA.NS.png');
      pushLogos(urls, 'bankofbaroda.in');
    }
    if (n.includes('punjab national') || n.includes('pnb')) {
      urls.push('/logos/pnb.svg');
      urls.push('https://s3-symbol-logo.tradingview.com/punjab-natl-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/PNB.NS.png');
      pushLogos(urls, 'pnbindia.in');
    }
    if (n.includes('canara')) {
      urls.push('https://s3-symbol-logo.tradingview.com/canara-bank--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/CANBK.NS.png');
      pushLogos(urls, 'canarabank.com');
    }
    if (n.includes('union bank')) {
      urls.push('https://s3-symbol-logo.tradingview.com/union-bank-of-india--600.png');
      urls.push('https://companiesmarketcap.com/img/company-logos/256/UNIONBANK.NS.png');
      pushLogos(urls, 'unionbankofindia.co.in');
    }
    if (n.includes('yes bank')) {
      urls.push('https://companiesmarketcap.com/img/company-logos/256/YESBANK.NS.png');
      pushLogos(urls, 'yesbank.in');
    }
    if (n.includes('standard chartered') || n.includes('scb')) pushLogos(urls, 'sc.com');
    if (n.includes('hsbc')) pushLogos(urls, 'hsbc.co.in');
    if (n.includes('citi')) pushLogos(urls, 'citibank.co.in');
    if (n.includes('amex') || n.includes('american express')) pushLogos(urls, 'americanexpress.com');
    if (n.includes('onecard') || n.includes('one card')) pushLogos(urls, 'getonecard.app');
    if (n.includes('amazon')) pushLogos(urls, 'amazon.in');
    if (n.includes('flipkart')) pushLogos(urls, 'flipkart.com');
    if (n.includes('tata neu') || n.includes('tataneu')) pushLogos(urls, 'tatadigital.com');
    if (n.includes('bajaj')) {
      urls.push('https://companiesmarketcap.com/img/company-logos/256/BAJAJFINSV.NS.png');
      pushLogos(urls, 'bajajfinserv.in');
    }
    if (n.includes('credila')) pushLogos(urls, 'hdfccredila.com');
    return urls;
  }

  // Indian Stocks (Default / Fallback)
  // Priority 0: Direct verified local high-res official corporate logo override
  if (KNOWN_STOCK_LOGOS[cleanSym] || KNOWN_STOCK_LOGOS[rawSym]) {
    urls.push(KNOWN_STOCK_LOGOS[cleanSym] || KNOWN_STOCK_LOGOS[rawSym]);
  }
  if (n.includes('sudeep pharma') || s === 'SUDEEPPHRM' || s === 'SUDEEP') {
    urls.push('/logos/sudeep.png');
  }
  if (n.includes('shyam metal') || s === 'SHYAMMETL' || s === 'SHYAM') {
    urls.push('/logos/shyammetl.png');
  }
  if (n.includes('jb chem') || n.includes('j b chem') || n.includes('jb pharma') || s === 'JBCHEPHARM' || s === 'JBCHEM') {
    urls.push('/logos/jbchepharm.svg');
  }

  // Priority 1: Curated Institutional Financial Brand Portals (TradingView 600px & CompaniesMarketCap 256px & Parqet)
  // Check TradingView 600px verified universe logos first (548 mapped symbols)
  const tvLogoid = stockTvLogosMap[rawSym] || stockTvLogosMap[cleanSym];
  if (tvLogoid) {
    urls.push(`https://s3-symbol-logo.tradingview.com/${tvLogoid}--600.png`);
    urls.push(`https://s3-symbol-logo.tradingview.com/${tvLogoid}.svg`);
  }

  // CompaniesMarketCap 256px & Parqet
  if (rawSym) {
    urls.push(`https://companiesmarketcap.com/img/company-logos/256/${rawSym}.NS.png`);
    urls.push(`https://assets.parqet.com/logos/symbol/${rawSym}.NS`);
    urls.push(`https://companiesmarketcap.com/img/company-logos/256/${rawSym}.png`);
    urls.push(`https://assets.parqet.com/logos/symbol/${rawSym}`);
  }
  if (cleanSym && cleanSym !== rawSym) {
    urls.push(`https://companiesmarketcap.com/img/company-logos/256/${cleanSym}.NS.png`);
    urls.push(`https://assets.parqet.com/logos/symbol/${cleanSym}.NS`);
    urls.push(`https://companiesmarketcap.com/img/company-logos/256/${cleanSym}.png`);
    urls.push(`https://assets.parqet.com/logos/symbol/${cleanSym}`);
  }

  // Priority 2: Verified corporate domain brand logos (Hunter -> Unavatar)
  if (KNOWN_STOCK_DOMAINS[cleanSym] || KNOWN_STOCK_DOMAINS[rawSym]) {
    pushLogos(urls, KNOWN_STOCK_DOMAINS[cleanSym] || KNOWN_STOCK_DOMAINS[rawSym]);
  }

  // Priority 3: Dynamic domain heuristics for any future stock without explicit mapping
  if (cleanSym) {
    pushLogos(urls, `${cleanSym.toLowerCase()}.com`);
    pushLogos(urls, `${cleanSym.toLowerCase()}.in`);
    pushLogos(urls, `${cleanSym.toLowerCase()}.co.in`);
  }

  const cleanCompanyName = n.replace(/\b(ltd|limited|company|corp|corporation|inc|industries|finance|financial|services)\b/g, '').trim();
  const words = cleanCompanyName.split(' ').map(w => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);

  if (words.length > 1) {
    pushLogos(urls, `${words[0]}${words[1]}.com`);
    pushLogos(urls, `${words[0]}-${words[1]}.com`);
    pushLogos(urls, `${words[0]}${words[1]}.co.in`);
    pushLogos(urls, `${words[0]}${words[1]}.in`);
  } else if (words.length === 1 && words[0].length > 3) {
    pushLogos(urls, `${words[0]}.com`);
    pushLogos(urls, `${words[0]}.in`);
    pushLogos(urls, `${words[0]}.co.in`);
  }

  // Priority 4: Final fallback: mapped SVG or exchange repo icon (demoted to avoid single-letter initial avatars)
  const mappedFile = stockLogosMap[cleanSym] || stockLogosMap[rawSym];
  if (mappedFile) {
    urls.push(`https://cdn.jsdelivr.net/gh/dharunashokkumar/indian-listed-company-logos@main/data/logos/${mappedFile}`);
    urls.push(`https://raw.githubusercontent.com/dharunashokkumar/indian-listed-company-logos/main/data/logos/${mappedFile}`);
  }

  if (s) {
    urls.push(`https://cdn.jsdelivr.net/gh/dharunashokkumar/indian-listed-company-logos@main/data/logos/nse/NSE_${s}.svg`);
    urls.push(`https://raw.githubusercontent.com/dharunashokkumar/indian-listed-company-logos@main/data/logos/nse/NSE_${s}.svg`);
    urls.push(`https://cdn.jsdelivr.net/gh/dharunashokkumar/indian-listed-company-logos@main/data/logos/bse/BSE_${s}.svg`);
    urls.push(`https://raw.githubusercontent.com/dharunashokkumar/indian-listed-company-logos@main/data/logos/bse/BSE_${s}.svg`);
  }

  return urls;
};
