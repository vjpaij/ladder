export const getLogoUrlsForHolding = (name = '', symbol = '', category = '') => {
  const n = name.toLowerCase();
  const s = (symbol || '').toUpperCase();
  const urls = [];

  // US Stocks
  if (category === 'us_stocks') {
    urls.push(`https://assets.parqet.com/logos/symbol/${s}`);
    urls.push(`https://storage.googleapis.com/iex/api/logos/${s}.png`);
    urls.push(`https://companiesmarketcap.com/img/company-logos/64/${s}.webp`);
    urls.push(`https://logos.hunter.io/${s.toLowerCase()}.com`);
    return urls;
  }

  // Mutual Funds & NPS
  if (category === 'mutual_funds' || category === 'nps') {
    if (n.includes('hdfc')) urls.push('https://logos.hunter.io/hdfcfund.com');
    if (n.includes('sbi')) urls.push('https://logos.hunter.io/sbimf.com');
    if (n.includes('icici') || n.includes('pru')) urls.push('https://logos.hunter.io/icicipruamc.com');
    if (n.includes('axis')) urls.push('https://logos.hunter.io/axismf.com');
    if (n.includes('kotak')) urls.push('https://logos.hunter.io/kotakmf.com');
    if (n.includes('nippon')) urls.push('https://logos.hunter.io/nipponindiaim.com');
    if (n.includes('dsp')) urls.push('https://logos.hunter.io/dspim.com');
    if (n.includes('mirae')) urls.push('https://logos.hunter.io/miraeassetmf.co.in');
    if (n.includes('aditya') || n.includes('birl') || n.includes('absl')) urls.push('https://logos.hunter.io/adityabirlacapital.com');
    if (n.includes('uti')) urls.push('https://logos.hunter.io/utimf.com');
    if (n.includes('tata')) urls.push('https://logos.hunter.io/tatamutualfund.com');
    if (n.includes('lic')) urls.push('https://logos.hunter.io/licmf.com');
    if (n.includes('edelweiss')) urls.push('https://logos.hunter.io/edelweissmf.com');
    if (n.includes('lic')) urls.push('https://logos.hunter.io/licmf.com');
    if (n.includes('edelweiss')) urls.push('https://logos.hunter.io/edelweissmf.com');
    if (n.includes('motilal')) urls.push('https://logos.hunter.io/motilaloswalmf.com');
    if (n.includes('franklin')) urls.push('https://logos.hunter.io/franklintempletonindia.com');
    if (n.includes('canara') || n.includes('robeco')) urls.push('https://logos.hunter.io/canararobeco.com');
    if (n.includes('quant')) urls.push('https://logos.hunter.io/quantmutual.com');
    if (n.includes('bandhan')) urls.push('https://logos.hunter.io/bandhanmutual.com');
    if (n.includes('invesco')) urls.push('https://logos.hunter.io/invescomutualfund.com');
    if (n.includes('hsbc')) urls.push('https://logos.hunter.io/assetmanagement.hsbc.co.in');
    
    const firstWord = n.split(' ')[0].replace(/[^a-z0-9]/g, '');
    if (firstWord) urls.push(`https://logos.hunter.io/${firstWord}.com`);
    return urls;
  }

  // Banking & Financial institutions
  if (category === 'bank' || category === 'loans' || category === 'credit_cards') {
    if (n.includes('federal')) urls.push('https://logos.hunter.io/federalbank.co.in');
    if (n.includes('idfc')) urls.push('https://logos.hunter.io/idfcfirstbank.com');
    if (n.includes('hdfc')) urls.push('https://logos.hunter.io/hdfcbank.com');
    if (n.includes('sbi') || n.includes('state bank')) urls.push('https://logos.hunter.io/sbi.co.in');
    if (n.includes('icici')) urls.push('https://logos.hunter.io/icicibank.com');
    if (n.includes('axis')) urls.push('https://logos.hunter.io/axisbank.com');
    if (n.includes('indusind')) urls.push('https://logos.hunter.io/indusind.com');
    if (n.includes('rbl')) urls.push('https://logos.hunter.io/rblbank.com');
    
    const firstWord = n.split(' ')[0].replace(/[^a-z0-9]/g, '');
    if (firstWord) urls.push(`https://logos.hunter.io/${firstWord}.com`);
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
    if (words.length > 1) urls.push(`https://logos.hunter.io/${words[0]}${words[1]}.com`); 
    urls.push(`https://logos.hunter.io/${words[0]}.com`); 
  }
  
  // Final fallback to just symbol.com
  urls.push(`https://logos.hunter.io/${s.toLowerCase()}.com`);

  return urls;
};
