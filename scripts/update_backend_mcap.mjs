import fs from 'fs';

// 1. Update server/routes/holdings.js
let holdingsPath = 'server/routes/holdings.js';
let holdingsCode = fs.readFileSync(holdingsPath, 'utf8');

if (!holdingsCode.includes('function resolveCanonicalMarketCap')) {
  // Add resolveCanonicalMarketCap helper above router.get('/holdings'
  const helperCode = `export function resolveCanonicalMarketCap(meta = {}, holding = {}) {
  if (meta?.mcap_category && meta.mcap_category !== 'Unknown') return meta.mcap_category;
  if (meta?.capitalisation && meta.capitalisation !== 'Unknown') return meta.capitalisation;
  if (holding?.market_cap && holding.market_cap !== 'Unknown') return holding.market_cap;
  const cr = Number(meta?.market_cap);
  if (cr > 0) {
    if (cr >= 500000) return 'Mega Cap';
    if (cr >= 85000) return 'Large Cap';
    if (cr >= 27500) return 'Mid Cap';
    if (cr >= 5000) return 'Small Cap';
    return 'Micro Cap';
  }
  return 'Small Cap';
}

`;
  holdingsCode = holdingsCode.replace("router.get('/holdings',", helperCode + "router.get('/holdings',");
}

holdingsCode = holdingsCode.replace(
  "const finalMcap = (meta.mcap_category && meta.mcap_category !== 'Unknown') ? meta.mcap_category : (meta.capitalisation && meta.capitalisation !== 'Unknown') ? meta.capitalisation : (h.market_cap && h.market_cap !== 'Unknown' ? h.market_cap : 'Unknown');",
  "const finalMcap = resolveCanonicalMarketCap(meta, h);"
);

// In /holding/:holdingId/detail enrich updatedHolding with sector and market_cap
if (!holdingsCode.includes('const detailMcap = resolveCanonicalMarketCap')) {
  const targetDetailHolding = `    const updatedHolding = {
      ...holding,
      current_price: Number(quotePrice.toFixed(quoteDigits)),`;

  const replDetailHolding = `    const cleanSym = (holding.symbol || '').replace(/\\.(NS|BO)$/i, '').trim();
    let metaList = [];
    try {
      metaList = await db.select('asset_metadata');
    } catch (_) {}
    const metaRow = (metaList || []).find(m => m.symbol === holding.symbol || m.symbol === cleanSym || m.symbol === cleanSym.toUpperCase()) || {};
    const detailSector = (holding.sector && holding.sector !== 'Unknown' && holding.sector !== 'US Equities')
      ? holding.sector
      : (metaRow.sector && metaRow.sector !== 'Unknown')
        ? metaRow.sector
        : resolveCanonicalSector(metaRow, holding.name, holding.symbol);
    const detailMcap = resolveCanonicalMarketCap(metaRow, holding);

    const updatedHolding = {
      ...holding,
      sector: detailSector,
      market_cap: detailMcap,
      market_cap_cr: metaRow.market_cap || null,
      current_price: Number(quotePrice.toFixed(quoteDigits)),`;

  holdingsCode = holdingsCode.replace(targetDetailHolding, replDetailHolding);
}

fs.writeFileSync(holdingsPath, holdingsCode, 'utf8');
console.log('Updated server/routes/holdings.js');

// 2. Update server/services/stockIntelligence/analysisService.js
let analysisPath = 'server/services/stockIntelligence/analysisService.js';
let analysisCode = fs.readFileSync(analysisPath, 'utf8');

if (!analysisCode.includes('market_cap: (holding.market_cap')) {
  analysisCode = analysisCode.replace(
    `: resolveCanonicalSector(meta || {}, holding.name, holding.symbol),
      quantity,`,
    `: resolveCanonicalSector(meta || {}, holding.name, holding.symbol),
      market_cap: (holding.market_cap && holding.market_cap !== 'Unknown')
        ? holding.market_cap
        : (meta?.mcap_category && meta.mcap_category !== 'Unknown')
          ? meta.mcap_category
          : (meta?.capitalisation && meta.capitalisation !== 'Unknown')
            ? meta.capitalisation
            : 'Small Cap',
      market_cap_cr: meta?.market_cap || null,
      quantity,`
  );
  fs.writeFileSync(analysisPath, analysisCode, 'utf8');
  console.log('Updated server/services/stockIntelligence/analysisService.js');
}

// 3. Update server/services/stockIntelligence/buyAnalysisService.js
let buyPath = 'server/services/stockIntelligence/buyAnalysisService.js';
let buyCode = fs.readFileSync(buyPath, 'utf8');

if (!buyCode.includes('market_cap: fundamentals.mcapCategory')) {
  buyCode = buyCode.replace(
    `sector: resolveCanonicalSector(fundamentals, resolvedName, clean),
        industry: fundamentals.industry || 'Unknown',`,
    `sector: resolveCanonicalSector(fundamentals, resolvedName, clean),
        industry: fundamentals.industry || 'Unknown',
        market_cap: fundamentals.mcapCategory || (fundamentals.marketCapCr ? (fundamentals.marketCapCr >= 500000 ? 'Mega Cap' : fundamentals.marketCapCr >= 85000 ? 'Large Cap' : fundamentals.marketCapCr >= 27500 ? 'Mid Cap' : fundamentals.marketCapCr >= 5000 ? 'Small Cap' : 'Micro Cap') : 'Small Cap'),
        market_cap_cr: fundamentals.marketCapCr || null,`
  );
  fs.writeFileSync(buyPath, buyCode, 'utf8');
  console.log('Updated server/services/stockIntelligence/buyAnalysisService.js');
}

// 4. Update server/services/tradingJournalService.js
let journalPath = 'server/services/tradingJournalService.js';
let journalCode = fs.readFileSync(journalPath, 'utf8');

if (!journalCode.includes('market_cap: (holding && holding.market_cap')) {
  journalCode = journalCode.replace(
    `const sector = (holding && holding.sector && holding.sector !== 'Unknown')
      ? holding.sector
      : (metaRow && metaRow.sector && metaRow.sector !== 'Unknown')
        ? metaRow.sector
        : resolveCanonicalSector(metaRow || {}, group.name, group.symbol);

    return {
      symbol: group.symbol,
      name: group.name,
      sector,`,
    `const sector = (holding && holding.sector && holding.sector !== 'Unknown')
      ? holding.sector
      : (metaRow && metaRow.sector && metaRow.sector !== 'Unknown')
        ? metaRow.sector
        : resolveCanonicalSector(metaRow || {}, group.name, group.symbol);

    const market_cap = (holding && holding.market_cap && holding.market_cap !== 'Unknown')
      ? holding.market_cap
      : (metaRow && metaRow.mcap_category && metaRow.mcap_category !== 'Unknown')
        ? metaRow.mcap_category
        : (metaRow && metaRow.capitalisation && metaRow.capitalisation !== 'Unknown')
          ? metaRow.capitalisation
          : 'Small Cap';

    return {
      symbol: group.symbol,
      name: group.name,
      sector,
      market_cap,`
  );
  fs.writeFileSync(journalPath, journalCode, 'utf8');
  console.log('Updated server/services/tradingJournalService.js');
}
