const pushLogos = (urls, domain) => {
  if (!domain) return;
  urls.push(`https://unavatar.io/${domain}?fallback=false`);
  urls.push(`https://logos.hunter.io/${domain}`);
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
    
    const firstWord = n.split(' ')[0].replace(/[^a-z0-9]/g, '');
    if (firstWord) pushLogos(urls, `${firstWord}.com`);
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
    
    const firstWord = n.split(' ')[0].replace(/[^a-z0-9]/g, '');
    if (firstWord) pushLogos(urls, `${firstWord}.com`);
    return urls;
  }

  // Indian Stocks (Default / Fallback)
  if (s) {
    urls.push(`https://dharunashokkumar.github.io/indian-listed-company-logos/nse/NSE_${s}.svg`);
    urls.push(`https://dharunashokkumar.github.io/indian-listed-company-logos/bse/BSE_${s}.svg`);
    urls.push(`https://assets.parqet.com/logos/symbol/${s}`);
    urls.push(`https://companiesmarketcap.com/img/company-logos/64/${s}.webp`);
    urls.push(`https://storage.googleapis.com/iex/api/logos/${s}.png`);
  }
  
  // Clean company name guesses
  const cleanCompanyName = n.replace(/\b(ltd|limited|company|corp|corporation|inc|industries|finance|financial|services)\b/g, '').trim();
  const words = cleanCompanyName.split(' ').map(w => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  
  if (words.length > 0) {
    if (words.length > 1) pushLogos(urls, `${words[0]}${words[1]}.com`); 
    pushLogos(urls, `${words[0]}.com`); 
    pushLogos(urls, `${words[0]}.in`); 
    pushLogos(urls, `${words[0]}.co.in`); 
  }
  
  // Final fallback to symbol.com
  if (s) {
    pushLogos(urls, `${s.toLowerCase()}.com`);
  }

  return urls;
};
