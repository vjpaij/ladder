import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../data/index_history.json');

export const BENCHMARK_INDICES = [
  { key: 'NIFTY_50', ticker: '^NSEI', name: 'Nifty 50' },
  { key: 'NIFTY_MIDCAP_150', ticker: 'NIFTYMIDCAP150.NS', name: 'Nifty Midcap 150' },
  { key: 'NIFTY_SMALLCAP_250', ticker: 'HDFCSML250.NS', name: 'Nifty Smallcap 250' },
  { key: 'SP_500', ticker: '^GSPC', name: 'S&P 500' },
  { key: 'NASDAQ', ticker: '^IXIC', name: 'NASDAQ' }
];

export async function fetchIndexDailyCloses(ticker, range = '10y') {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return {};
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return {};

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const dateMap = {};

    for (let i = 0; i < timestamps.length; i++) {
      const val = closes[i];
      if (val !== null && val !== undefined && !isNaN(val)) {
        const d = new Date(timestamps[i] * 1000);
        const iso = d.toISOString().split('T')[0];
        dateMap[iso] = Number(val.toFixed(2));
      }
    }
    return dateMap;
  } catch (err) {
    console.error(`[Index Sync] Failed fetching ${ticker}:`, err.message);
    return {};
  }
}

export async function syncIndexHistory() {
  console.log('[Index Sync] Fetching 10 years of daily data for benchmark indices...');
  const indexHistory = {};

  for (const idx of BENCHMARK_INDICES) {
    console.log(`[Index Sync] Fetching ${idx.name} (${idx.ticker})...`);
    const closes = await fetchIndexDailyCloses(idx.ticker, '10y');
    indexHistory[idx.key] = {
      name: idx.name,
      ticker: idx.ticker,
      last_updated: new Date().toISOString(),
      closes
    };
    console.log(`✓ ${idx.name}: ${Object.keys(closes).length} trading dates fetched.`);
  }

  fs.writeFileSync(DATA_FILE, JSON.stringify(indexHistory, null, 2), 'utf8');
  console.log(`[Index Sync] Successfully saved index history to ${DATA_FILE}`);
  return indexHistory;
}

if (process.argv[1] && process.argv[1].endsWith('sync_index_history.mjs')) {
  syncIndexHistory().then(() => {
    console.log('Done!');
    process.exit(0);
  }).catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
}
