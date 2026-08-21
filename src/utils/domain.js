export const getLogoUrlsForHolding = (name = '', symbol = '', category = '') => {
  const n = name.toLowerCase();
  const s = (symbol || '').toUpperCase();
  const urls = [];

  // US Stocks
  if (category === 'us_stocks') {
    urls.push(`https://assets.parqet.com/logos/symbol/${s}`);
    urls.push(`https://storage.googleapis.com/iex/api/logos/${s}.png`);
    urls.push(`https://companiesmarketcap.com/img/company-logos/64/${s}.webp`);
    urls.push(`https://icon.horse/icon/${s.toLowerCase()}.com`);
    urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${s.toLowerCase()}.com&size=128`);
    urls.push(`https://logos.hunter.io/${s.toLowerCase()}.com`);
    return urls;
  }

  // Mutual Funds & NPS
  if (category === 'mutual_funds' || category === 'nps') {
    if (n.includes('hdfc')) urls.push(`https://icon.horse/icon/hdfcfund.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://hdfcfund.com&size=128`); urls.push(`https://logos.hunter.io/hdfcfund.com`);
    if (n.includes('sbi')) urls.push(`https://icon.horse/icon/sbimf.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://sbimf.com&size=128`); urls.push(`https://logos.hunter.io/sbimf.com`);
    if (n.includes('icici') || n.includes('pru')) urls.push(`https://icon.horse/icon/icicipruamc.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://icicipruamc.com&size=128`); urls.push(`https://logos.hunter.io/icicipruamc.com`);
    if (n.includes('axis')) urls.push(`https://icon.horse/icon/axismf.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://axismf.com&size=128`); urls.push(`https://logos.hunter.io/axismf.com`);
    if (n.includes('kotak')) urls.push(`https://icon.horse/icon/kotakmf.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://kotakmf.com&size=128`); urls.push(`https://logos.hunter.io/kotakmf.com`);
    if (n.includes('nippon')) urls.push(`https://icon.horse/icon/nipponindiaim.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://nipponindiaim.com&size=128`); urls.push(`https://logos.hunter.io/nipponindiaim.com`);
    if (n.includes('dsp')) urls.push(`https://icon.horse/icon/dspim.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://dspim.com&size=128`); urls.push(`https://logos.hunter.io/dspim.com`);
    if (n.includes('mirae')) urls.push(`https://icon.horse/icon/miraeassetmf.co.in`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://miraeassetmf.co.in&size=128`); urls.push(`https://logos.hunter.io/miraeassetmf.co.in`);
    if (n.includes('aditya') || n.includes('birl') || n.includes('absl')) urls.push(`https://icon.horse/icon/adityabirlacapital.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://adityabirlacapital.com&size=128`); urls.push(`https://logos.hunter.io/adityabirlacapital.com`);
    if (n.includes('uti')) urls.push(`https://icon.horse/icon/utimf.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://utimf.com&size=128`); urls.push(`https://logos.hunter.io/utimf.com`);
    if (n.includes('tata')) urls.push(`https://icon.horse/icon/tatamutualfund.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://tatamutualfund.com&size=128`); urls.push(`https://logos.hunter.io/tatamutualfund.com`);
    if (n.includes('lic')) urls.push(`https://icon.horse/icon/licmf.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://licmf.com&size=128`); urls.push(`https://logos.hunter.io/licmf.com`);
    if (n.includes('edelweiss')) urls.push(`https://icon.horse/icon/edelweissmf.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://edelweissmf.com&size=128`); urls.push(`https://logos.hunter.io/edelweissmf.com`);
    if (n.includes('lic')) urls.push(`https://icon.horse/icon/licmf.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://licmf.com&size=128`); urls.push(`https://logos.hunter.io/licmf.com`);
    if (n.includes('edelweiss')) urls.push(`https://icon.horse/icon/edelweissmf.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://edelweissmf.com&size=128`); urls.push(`https://logos.hunter.io/edelweissmf.com`);
    if (n.includes('motilal')) urls.push(`https://icon.horse/icon/motilaloswalmf.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://motilaloswalmf.com&size=128`); urls.push(`https://logos.hunter.io/motilaloswalmf.com`);
    if (n.includes('franklin')) urls.push(`https://icon.horse/icon/franklintempletonindia.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://franklintempletonindia.com&size=128`); urls.push(`https://logos.hunter.io/franklintempletonindia.com`);
    if (n.includes('canara') || n.includes('robeco')) urls.push(`https://icon.horse/icon/canararobeco.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://canararobeco.com&size=128`); urls.push(`https://logos.hunter.io/canararobeco.com`);
    if (n.includes('quant')) urls.push(`https://icon.horse/icon/quantmutual.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://quantmutual.com&size=128`); urls.push(`https://logos.hunter.io/quantmutual.com`);
    if (n.includes('bandhan')) urls.push(`https://icon.horse/icon/bandhanmutual.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://bandhanmutual.com&size=128`); urls.push(`https://logos.hunter.io/bandhanmutual.com`);
    if (n.includes('invesco')) urls.push(`https://icon.horse/icon/invescomutualfund.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://invescomutualfund.com&size=128`); urls.push(`https://logos.hunter.io/invescomutualfund.com`);
    if (n.includes('hsbc')) urls.push(`https://icon.horse/icon/assetmanagement.hsbc.co.in`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://assetmanagement.hsbc.co.in&size=128`); urls.push(`https://logos.hunter.io/assetmanagement.hsbc.co.in`);
    
    const firstWord = n.split(' ')[0].replace(/[^a-z0-9]/g, '');
    if (firstWord) {

      urls.push(`https://icon.horse/icon/${firstWord}.com`);

      urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${firstWord}.com&size=128`);

      urls.push(`https://logos.hunter.io/${firstWord}.com`);

    }
    return urls;
  }

  // Banking & Financial institutions
  if (category === 'bank' || category === 'loans' || category === 'credit_cards') {
    if (n.includes('federal')) urls.push(`https://icon.horse/icon/federalbank.co.in`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://federalbank.co.in&size=128`); urls.push(`https://logos.hunter.io/federalbank.co.in`);
    if (n.includes('idfc')) urls.push(`https://icon.horse/icon/idfcfirstbank.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://idfcfirstbank.com&size=128`); urls.push(`https://logos.hunter.io/idfcfirstbank.com`);
    if (n.includes('hdfc')) urls.push(`https://icon.horse/icon/hdfcbank.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://hdfcbank.com&size=128`); urls.push(`https://logos.hunter.io/hdfcbank.com`);
    if (n.includes('sbi') || n.includes('state bank')) urls.push(`https://icon.horse/icon/sbi.co.in`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://sbi.co.in&size=128`); urls.push(`https://logos.hunter.io/sbi.co.in`);
    if (n.includes('icici')) urls.push(`https://icon.horse/icon/icicibank.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://icicibank.com&size=128`); urls.push(`https://logos.hunter.io/icicibank.com`);
    if (n.includes('axis')) urls.push(`https://icon.horse/icon/axisbank.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://axisbank.com&size=128`); urls.push(`https://logos.hunter.io/axisbank.com`);
    if (n.includes('indusind')) urls.push(`https://icon.horse/icon/indusind.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://indusind.com&size=128`); urls.push(`https://logos.hunter.io/indusind.com`);
    if (n.includes('rbl')) urls.push(`https://icon.horse/icon/rblbank.com`); urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://rblbank.com&size=128`); urls.push(`https://logos.hunter.io/rblbank.com`);
    
    const firstWord = n.split(' ')[0].replace(/[^a-z0-9]/g, '');
    if (firstWord) {

      urls.push(`https://icon.horse/icon/${firstWord}.com`);

      urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${firstWord}.com&size=128`);

      urls.push(`https://logos.hunter.io/${firstWord}.com`);

    }
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
    if (words.length > 1) {

      urls.push(`https://icon.horse/icon/${words[0]}${words[1]}.com`);

      urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${words[0]}${words[1]}.com&size=128`);

      urls.push(`https://logos.hunter.io/${words[0]}${words[1]}.com`);

    } 
    urls.push(`https://icon.horse/icon/${words[0]}.com`); 
    urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${words[0]}.com&size=128`); 
    urls.push(`https://logos.hunter.io/${words[0]}.com`); 
  }
  
  // Final fallback to just symbol.com
  urls.push(`https://icon.horse/icon/${s.toLowerCase()}.com`);
  urls.push(`https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${s.toLowerCase()}.com&size=128`);
  urls.push(`https://logos.hunter.io/${s.toLowerCase()}.com`);

  return urls;
};
