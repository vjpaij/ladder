const pushLogos = (urls, domain) => {
  urls.push(`https://unavatar.io/${domain}?fallback=false`);
  urls.push(`https://logos.hunter.io/${domain}`);
};

export const getLogoUrlsForHolding = (name = '', symbol = '', category = '') => {
  const n = name.toLowerCase();
  const s = (symbol || '').toUpperCase();
  const urls = [];

  // US Stocks
  if (category === 'us_stocks') {
    urls.push(`https://assets.parqet.com/logos/symbol/${s}`);
    urls.push(`https://storage.googleapis.com/iex/api/logos/${s}.png`);
    urls.push(`https://companiesmarketcap.com/img/company-logos/64/${s}.webp`);
    pushLogos(urls, `${s.toLowerCase()}.com`);
    return urls;
  }

  // Mutual Funds & NPS
  if (category === 'mutual_funds' || category === 'nps') {
    if (n.includes('hdfc')) pushLogos(urls, `hdfcfund.com`);
    if (n.includes('sbi')) pushLogos(urls, `sbimf.com`);
    if (n.includes('icici') || n.includes('pru')) pushLogos(urls, `icicipruamc.com`);
    if (n.includes('axis')) pushLogos(urls, `axismf.com`);
    if (n.includes('kotak')) pushLogos(urls, `kotakmf.com`);
    if (n.includes('nippon')) pushLogos(urls, `nipponindiaim.com`);
    if (n.includes('dsp')) pushLogos(urls, `dspim.com`);
    if (n.includes('mirae')) pushLogos(urls, `miraeassetmf.co.in`);
    if (n.includes('aditya') || n.includes('birl') || n.includes('absl')) pushLogos(urls, `adityabirlacapital.com`);
    if (n.includes('uti')) pushLogos(urls, `utimf.com`);
    if (n.includes('tata')) pushLogos(urls, `tatamutualfund.com`);
    if (n.includes('lic')) pushLogos(urls, `licmf.com`);
    if (n.includes('edelweiss')) pushLogos(urls, `edelweissmf.com`);
    if (n.includes('lic')) pushLogos(urls, `licmf.com`);
    if (n.includes('edelweiss')) pushLogos(urls, `edelweissmf.com`);
    if (n.includes('motilal')) pushLogos(urls, `motilaloswalmf.com`);
    if (n.includes('franklin')) pushLogos(urls, `franklintempletonindia.com`);
    if (n.includes('canara') || n.includes('robeco')) pushLogos(urls, `canararobeco.com`);
    if (n.includes('quant')) pushLogos(urls, `quantmutual.com`);
    if (n.includes('bandhan')) pushLogos(urls, `bandhanmutual.com`);
    if (n.includes('invesco')) pushLogos(urls, `invescomutualfund.com`);
    if (n.includes('hsbc')) pushLogos(urls, `assetmanagement.hsbc.co.in`);
    
    const firstWord = n.split(' ')[0].replace(/[^a-z0-9]/g, '');
    if (firstWord) pushLogos(urls, `${firstWord}.com`);
    return urls;
  }

  // Banking & Financial institutions
  if (category === 'bank' || category === 'loans' || category === 'credit_cards') {
    if (n.includes('federal')) pushLogos(urls, `federalbank.co.in`);
    if (n.includes('idfc')) pushLogos(urls, `idfcfirstbank.com`);
    if (n.includes('hdfc')) pushLogos(urls, `hdfcbank.com`);
    if (n.includes('sbi') || n.includes('state bank')) pushLogos(urls, `sbi.co.in`);
    if (n.includes('icici')) pushLogos(urls, `icicibank.com`);
    if (n.includes('axis')) pushLogos(urls, `axisbank.com`);
    if (n.includes('indusind')) pushLogos(urls, `indusind.com`);
    if (n.includes('rbl')) pushLogos(urls, `rblbank.com`);
    
    const firstWord = n.split(' ')[0].replace(/[^a-z0-9]/g, '');
    if (firstWord) pushLogos(urls, `${firstWord}.com`);
    return urls;
  }

  // Indian Stocks (Default / Fallback)
  // Try Github Pages community repo
  urls.push(`https://dharunashokkumar.github.io/indian-listed-company-logos/nse/NSE_${s}.svg`);
  urls.push(`https://dharunashokkumar.github.io/indian-listed-company-logos/bse/BSE_${s}.svg`);
  
  // Hunter generic guesses based on name
  const cleanName = n.replace(/\b(ltd|limited|company|corp|corporation|inc)\b/g, '').trim();
  const words = cleanName.split(' ').map(w => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
  
  if (words.length > 0) {
    if (words.length > 1) pushLogos(urls, `${words[0]}${words[1]}.com`); 
    pushLogos(urls, `${words[0]}.com`); 
  }
  
  // Final fallback to just symbol.com
  pushLogos(urls, `${s.toLowerCase()}.com`);

  return urls;
};
