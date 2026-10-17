import fs from 'node:fs';
import path from 'node:path';

/**
 * Loads cached institutional US stock fundamentals from data/us_fundamentals_snapshot.json
 */
export function loadAllCachedUsFundamentals(symbols = []) {
  const filePath = path.join(process.cwd(), 'data', 'us_fundamentals_snapshot.json');
  const result = {};
  if (!fs.existsSync(filePath)) return result;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const sym of symbols) {
      const clean = String(sym || '').trim().toUpperCase();
      if (raw[clean]) {
        const item = raw[clean];
        const num = (v) => {
          if (v === null || v === undefined || v === '-' || v === 'N/A') return null;
          const cleaned = String(v).replace(/%/g, '').trim();
          const n = Number(cleaned);
          return isNaN(n) ? null : n;
        };

        result[clean] = {
          status: 'AVAILABLE',
          source: 'Finviz Institutional',
          symbol: clean,
          peRatio: num(item.pe),
          forwardPe: num(item.forwardPe),
          pegRatio: num(item.peg),
          pbRatio: num(item.pb),
          psRatio: num(item.ps),
          marketCap: item.marketCap || null,
          enterpriseValue: item.enterpriseValue || null,
          latestOpmPct: num(item.opmPct),
          netMarginPct: num(item.netMarginPct),
          grossMarginPct: num(item.grossMarginPct),
          roePct: num(item.roePct),
          roaPct: num(item.roaPct),
          roicPct: num(item.roicPct),
          debtToEquity: num(item.debtToEquity),
          currentRatio: num(item.currentRatio),
          quickRatio: num(item.quickRatio),
          yoySalesGrowthPct: num(item.salesYoYPct),
          yoyPatGrowthPct: num(item.epsYoYPct),
          qoqSalesGrowthPct: num(item.salesQoQPct),
          qoqPatGrowthPct: num(item.epsQoQPct),
          epsTTM: num(item.epsTTM),
          rsi14: num(item.rsi14),
          atr14: num(item.atr14),
          beta: num(item.beta),
          opmTrendDirection: (num(item.opmPct) || 0) >= 20 ? 'EXPANDING' : 'STABLE',
          promoterPledgePct: 0,
          screenerUrl: `https://finviz.com/quote.ashx?t=${clean}`
        };
      }
    }
  } catch (err) {
    console.warn('[US Fundamentals] Failed to parse snapshot:', err.message);
  }

  return result;
}
