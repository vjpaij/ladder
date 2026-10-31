import stockLogosMap from '../data/stockLogosMap.js';
import stockDomainsMap from '../data/stockDomainsMap.js';

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
  'SHANKESH': 'https://shankeshjewellers.com/web_assets/assets/images/logos/Shankesh-logo.png',
  'ARTEMISMED': '/logos/artemis.png',
  'DYCL': 'https://www.dynamiccables.co.in/images/logo-dark.png',
  'GABRIEL': 'https://www.anandgroupindia.com/wp-content/uploads/2017/10/gabriel_child.gif',
  'RADICO': 'https://logos.hunter.io/radicokhaitan.com',
  'ATHERENERG': 'https://logos.hunter.io/atherenergy.com',
  'CORONA': 'https://logos.hunter.io/coronaremedies.com',
  'INDGN': '/logos/indegene.png',
  'FRACTAL': '/logos/fractal.png',
  'ANANTRAJ': '/logos/anantraj.png',
  'VAML': '/logos/vaml.png',
  'SBCL': '/logos/sbcl.jpg',
  'TARIL': '/logos/taril.png',
  'HBLENGINE': '/logos/hblengine.png',
  'HBLPOWER': '/logos/hblengine.png',
  'PNB': '/logos/pnb.svg',
  'TVSMOTOR': '/logos/tvsmotor.svg',
  'SYRMA': '/logos/syrma.png',
  'SANSERA': 'https://logos.hunter.io/sansera.in',
  'AFFLE': 'https://logos.hunter.io/affle.com',
  'AWL': 'https://logos.hunter.io/adaniwilmar.com',
  'BECTORFOOD': 'https://logos.hunter.io/bectorfoods.com',
  'BSOFT': 'https://logos.hunter.io/birlasoft.com',
  'BOROSCI': 'https://logos.hunter.io/borosilscientific.com',
  'DATAPATTNS': 'https://logos.hunter.io/datapatterns.co.in',
  'INDHOTEL': 'https://logos.hunter.io/ihcltata.com',
  'INDOTECH': 'https://logos.hunter.io/indo-tech.com',
  'IRCON': 'https://logos.hunter.io/ircon.org',
  'JKLAKSHMI': 'https://logos.hunter.io/jklakshmicement.com',
  'KEI': 'https://logos.hunter.io/kei-ind.com',
  'KPITTECH': 'https://logos.hunter.io/kpit.com',
  'KPIT': 'https://logos.hunter.io/kpit.com',
  'KPRMILL': 'https://logos.hunter.io/kprmilllimited.com',
  'MOLDTECH': 'https://logos.hunter.io/moldtekgroup.com',
  'MOLDTKPAC': 'https://logos.hunter.io/moldtekpackaging.com',
  'NETWEB': 'https://logos.hunter.io/netwebindia.com',
  'NYKAA': 'https://logos.hunter.io/nykaa.com',
  'OFSS': 'https://logos.hunter.io/oracle.com',
  'ORIENTCEM': 'https://logos.hunter.io/orientcement.com',
  'RAMCOSYS': 'https://logos.hunter.io/ramco.com',
  'RICOAUTO': 'https://logos.hunter.io/ricoauto.com',
  'SCHAEFFLER': 'https://logos.hunter.io/schaeffler.com',
  'SHANTIGEAR': 'https://logos.hunter.io/shanthigears.com',
  'SHYAMMETL': 'https://logos.hunter.io/shyammetalics.com',
  'TRITURBINE': 'https://logos.hunter.io/triveniturbines.com',
  'UJJIVANSFB': 'https://logos.hunter.io/ujjivansfb.in',
  'VOLTAS': 'https://logos.hunter.io/voltas.com',
  'WAAREEENER': 'https://logos.hunter.io/waaree.com',
  'WEBELSOLAR': 'https://logos.hunter.io/websolenergy.com',
  'SUDEEPPHRM': '/logos/sudeep.png',
  'EMMVEE': 'https://emmvee.com/wp-content/uploads/2019/08/emvlogo.png'
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
    if (n.includes('hdfc')) { pushLogos(urls, 'hdfcfund.com'); pushLogos(urls, 'hdfclife.com'); }
    if (n.includes('sbi') || n.includes('state bank')) { pushLogos(urls, 'sbimf.com'); pushLogos(urls, 'sbipensionfunds.com'); }
    if (n.includes('icici') || n.includes('pru')) { pushLogos(urls, 'icicipruamc.com'); pushLogos(urls, 'iciciprulife.com'); }
    if (n.includes('axis')) { pushLogos(urls, 'axismf.com'); pushLogos(urls, 'axisbank.com'); }
    if (n.includes('kotak')) { pushLogos(urls, 'kotakmf.com'); pushLogos(urls, 'kotakpension.com'); }
    if (n.includes('nippon')) pushLogos(urls, 'nipponindiaim.com');
    if (n.includes('dsp')) pushLogos(urls, 'dspim.com');
    if (n.includes('mirae')) pushLogos(urls, 'miraeassetmf.co.in');
    if (n.includes('aditya') || n.includes('birl') || n.includes('absl')) pushLogos(urls, 'adityabirlacapital.com');
    if (n.includes('uti')) { pushLogos(urls, 'utimf.com'); pushLogos(urls, 'utiretirement.com'); }
    if (n.includes('tata')) { pushLogos(urls, 'tatamutualfund.com'); pushLogos(urls, 'tatapension.com'); }
    if (n.includes('lic')) { pushLogos(urls, 'licmf.com'); pushLogos(urls, 'licpensionfund.in'); }
    if (n.includes('motilal')) pushLogos(urls, 'motilaloswalmf.com');
    if (n.includes('franklin')) pushLogos(urls, 'franklintempletonindia.com');
    if (n.includes('canara') || n.includes('robeco')) pushLogos(urls, 'canararobeco.com');
    if (n.includes('quant')) pushLogos(urls, 'quantmutual.com');
    if (n.includes('parag') || n.includes('ppfas')) pushLogos(urls, 'amc.ppfas.com');
    if (n.includes('bandhan')) pushLogos(urls, 'bandhanmutual.com');
    if (n.includes('invesco')) pushLogos(urls, 'invescomutualfund.com');
    if (n.includes('hsbc')) pushLogos(urls, 'assetmanagement.hsbc.co.in');
    if (n.includes('sundaram')) pushLogos(urls, 'sundarammutual.com');
    if (n.includes('pgim')) pushLogos(urls, 'pgimindiamf.com');
    if (n.includes('whiteoak')) pushLogos(urls, 'whiteoakamc.com');
    if (n.includes('edelweiss')) pushLogos(urls, 'edelweissmf.com');
    if (n.includes('navi')) pushLogos(urls, 'navi.com');
    if (n.includes('samco')) pushLogos(urls, 'samcomf.com');
    if (n.includes('baroda')) pushLogos(urls, 'barodabnpparibasmf.in');
    if (n.includes('mahindra')) pushLogos(urls, 'mahindramanulife.com');
    if (n.includes('union')) pushLogos(urls, 'unionmf.com');
    if (n.includes('max')) { pushLogos(urls, 'maxlifeinsurance.com'); pushLogos(urls, 'maxpension.co.in'); }
    return urls;
  }

  // Banking & Financial institutions (Loans, Credit Cards, Banks)
  if (category === 'bank' || category === 'loans' || category === 'credit_cards') {
    if (n.includes('federal')) pushLogos(urls, 'federalbank.co.in');
    if (n.includes('idfc')) pushLogos(urls, 'idfcfirstbank.com');
    if (n.includes('hdfc')) pushLogos(urls, 'hdfcbank.com');
    if (n.includes('sbi') || n.includes('state bank')) pushLogos(urls, 'sbi.co.in');
    if (n.includes('icici')) pushLogos(urls, 'icicibank.com');
    if (n.includes('axis')) pushLogos(urls, 'axisbank.com');
    if (n.includes('kotak')) pushLogos(urls, 'kotak.com');
    if (n.includes('indusind')) pushLogos(urls, 'indusind.com');
    if (n.includes('rbl')) pushLogos(urls, 'rblbank.com');
    if (n.includes('bank of baroda') || n.includes('bob')) pushLogos(urls, 'bankofbaroda.in');
    if (n.includes('punjab national') || n.includes('pnb')) pushLogos(urls, 'pnbindia.in');
    if (n.includes('canara')) pushLogos(urls, 'canarabank.com');
    if (n.includes('union bank')) pushLogos(urls, 'unionbankofindia.co.in');
    if (n.includes('yes bank')) pushLogos(urls, 'yesbank.in');
    if (n.includes('standard chartered') || n.includes('scb')) pushLogos(urls, 'sc.com');
    if (n.includes('hsbc')) pushLogos(urls, 'hsbc.co.in');
    if (n.includes('citi')) pushLogos(urls, 'citibank.co.in');
    if (n.includes('amex') || n.includes('american express')) pushLogos(urls, 'americanexpress.com');
    if (n.includes('onecard') || n.includes('one card')) pushLogos(urls, 'getonecard.app');
    if (n.includes('amazon')) pushLogos(urls, 'amazon.in');
    if (n.includes('flipkart')) pushLogos(urls, 'flipkart.com');
    if (n.includes('tata neu') || n.includes('tataneu')) pushLogos(urls, 'tatadigital.com');
    if (n.includes('bajaj')) pushLogos(urls, 'bajajfinserv.in');
    if (n.includes('credila')) pushLogos(urls, 'hdfccredila.com');
    return urls;
  }

  // Indian Stocks (Default / Fallback)
  // Priority 0: Direct high-res verified official corporate logo override
  if (KNOWN_STOCK_LOGOS[cleanSym] || KNOWN_STOCK_LOGOS[rawSym]) {
    urls.push(KNOWN_STOCK_LOGOS[cleanSym] || KNOWN_STOCK_LOGOS[rawSym]);
  }

  // Priority 1: Verified corporate domain brand logos (Hunter -> Unavatar -> Google S2)
  if (KNOWN_STOCK_DOMAINS[cleanSym] || KNOWN_STOCK_DOMAINS[rawSym]) {
    pushLogos(urls, KNOWN_STOCK_DOMAINS[cleanSym] || KNOWN_STOCK_DOMAINS[rawSym]);
  }

  // Priority 2: Institutional financial brand logo APIs
  if (s) {
    urls.push(`https://assets.parqet.com/logos/symbol/${s}`);
    urls.push(`https://companiesmarketcap.com/img/company-logos/64/${s}.webp`);
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
    urls.push(`https://raw.githubusercontent.com/dharunashokkumar/indian-listed-company-logos/main/data/logos/nse/NSE_${s}.svg`);
    urls.push(`https://cdn.jsdelivr.net/gh/dharunashokkumar/indian-listed-company-logos@main/data/logos/bse/BSE_${s}.svg`);
    urls.push(`https://raw.githubusercontent.com/dharunashokkumar/indian-listed-company-logos/main/data/logos/bse/BSE_${s}.svg`);
  }

  return urls;
};
