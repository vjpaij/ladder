/**
 * scripts/simulate_2026_strategy.mjs
 * Simulates current Buy & Sell Analysis strategy from 2026-01-01 to 2026-10-30.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const START_DATE = '2026-01-01';
const END_DATE = '2026-10-30';
const COST_RATE = 0.005; // 0.5% friction
const ATR_MULT = 3.0;
const TRAIL_STOP_PCT = 0.15; // 15% trailing floor
const NOISE_DAYS = 5;
const HARD_STOP_PCT = 0.08; // 8% fresh buy circuit breaker

const allPrices = JSON.parse(fs.readFileSync(path.join(projectRoot, 'data', 'historical_prices.json'), 'utf8'));

const US = new Set('AAPL,MSFT,GOOGL,GOOG,AMZN,NVDA,META,TSLA,PLTR,CRM,AVGO,NFLX,AMD,INTC,ORCL,ADBE,QCOM,CSCO,IBM,NOW,UBER,ABNB,SNOW,NET,DDOG,MDB,SHOP,SQ,PYPL,COIN,DIS,NKE,SBUX,MCD,WMT,TGT,COST,HD,LOW,PG,JNJ,PFE,MRK,ABBV,LLY,UNH,CVS,JPM,BAC,WFC,C,GS,MS,BLK,SCHW,V,MA,AXP,XOM,CVX,COP,SLB,CAT,DE,GE,HON,UNP,UPS,FDX,BA,RTX,LMT,GD,NOC,NEE,DUK,SO,D,AEP,EXC,SRE,ED,PEG,XEL'.split(','));

function isIndianStock(s) {
  if (US.has(s) || /^\d+$/.test(s) || /\.(NS|BO)$/i.test(s) || /SM\d+/i.test(s) || s.startsWith('POP')) return false;
  return s.length >= 2 && s.length <= 20 && /^[A-Z]/.test(s);
}

// Load fundamentals cache for market cap / name / quality filtering
const screenerDir = path.join(projectRoot, 'data', 'screener_cache');
const fundamentalsMap = {};
if (fs.existsSync(screenerDir)) {
  for (const f of fs.readdirSync(screenerDir)) {
    if (!f.endsWith('.json')) continue;
    const sym = f.slice(0, -5).toUpperCase();
    try {
      fundamentalsMap[sym] = JSON.parse(fs.readFileSync(path.join(screenerDir, f), 'utf8'));
    } catch (_) {}
  }
}

const symbols = Object.keys(allPrices).filter(s => {
  if (!isIndianStock(s)) return false;
  const dates = Object.keys(allPrices[s]).sort();
  return dates[0] <= '2025-06-01' && dates.at(-1) >= '2026-10-01' && dates.length > 250;
});

console.log(`[2026 Sim] Filtered ${symbols.length} candidate Indian stocks.`);

function normalizeDaily(raw) {
  return Object.entries(raw)
    .map(([d, v]) => ({ date: d, close: Number(v) }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.close) && r.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function weekStartFast(dStr) {
  const y = parseInt(dStr.slice(0, 4), 10);
  const m = parseInt(dStr.slice(5, 7), 10) - 1;
  const d = parseInt(dStr.slice(8, 10), 10);
  const dt = new Date(Date.UTC(y, m, d));
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0, 10);
}

const stockData = {};

for (const sym of symbols) {
  const daily = normalizeDaily(allPrices[sym]);
  const n = daily.length;
  if (n < 60) continue;

  const dailyCloses = new Float64Array(n);
  const dailyDates = new Array(n);
  for (let i = 0; i < n; i++) {
    dailyCloses[i] = daily[i].close;
    dailyDates[i] = daily[i].date;
  }

  // EMA 50
  const ema50 = new Float64Array(n);
  const k50 = 2 / 51;
  let e50 = 0;
  for (let i = 0; i < Math.min(50, n); i++) e50 += dailyCloses[i];
  e50 /= Math.min(50, n);
  for (let i = 0; i < n; i++) {
    if (i < 49) ema50[i] = 0;
    else if (i === 49) ema50[i] = e50;
    else {
      e50 = dailyCloses[i] * k50 + e50 * (1 - k50);
      ema50[i] = e50;
    }
  }

  // 252-day Rolling High
  const high252 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let mx = dailyCloses[i];
    const s = Math.max(0, i - 251);
    for (let j = s; j < i; j++) {
      if (dailyCloses[j] > mx) mx = dailyCloses[j];
    }
    high252[i] = mx;
  }

  // Weekly series
  const weeklyList = [];
  let curWeekKey = '';
  let curWeekClose = 0;
  let curWeekDate = '';

  for (let i = 0; i < n; i++) {
    const wk = weekStartFast(dailyDates[i]);
    if (wk !== curWeekKey) {
      if (curWeekKey !== '') weeklyList.push({ week: curWeekKey, date: curWeekDate, close: curWeekClose });
      curWeekKey = wk;
    }
    curWeekClose = dailyCloses[i];
    curWeekDate = dailyDates[i];
  }
  if (curWeekKey !== '') weeklyList.push({ week: curWeekKey, date: curWeekDate, close: curWeekClose });

  const wn = weeklyList.length;
  const weeklyCloses = new Float64Array(wn);
  for (let i = 0; i < wn; i++) weeklyCloses[i] = weeklyList[i].close;

  // Weekly 30-SMA
  const sma30w = new Float64Array(wn);
  let sum30 = 0;
  for (let i = 0; i < wn; i++) {
    sum30 += weeklyCloses[i];
    if (i >= 30) sum30 -= weeklyCloses[i - 30];
    sma30w[i] = i >= 29 ? sum30 / 30 : 0;
  }

  // Weekly 14-ATR
  const weeklyAtr = new Float64Array(wn);
  const trs = new Float64Array(wn);
  trs[0] = 0;
  for (let i = 1; i < wn; i++) trs[i] = Math.abs(weeklyCloses[i] - weeklyCloses[i - 1]);
  let sumAtr = 0;
  for (let i = 0; i < wn; i++) {
    sumAtr += trs[i];
    if (i >= 14) sumAtr -= trs[i - 14];
    if (i >= 14) weeklyAtr[i] = sumAtr / 14;
    else if (i > 0) weeklyAtr[i] = sumAtr / i;
    else weeklyAtr[i] = weeklyCloses[0] * 0.05;
  }

  // Weekly consecutive closes below falling 30w SMA
  const weeksBelowFallingSma = new Int32Array(wn);
  for (let i = 29; i < wn; i++) {
    const sma = sma30w[i];
    const smaPrior = i >= 33 ? sma30w[i - 4] : sma30w[i - 1];
    const isFalling = sma < smaPrior;
    if (weeklyCloses[i] < sma && isFalling) {
      weeksBelowFallingSma[i] = (i > 0 ? weeksBelowFallingSma[i - 1] : 0) + 1;
    } else {
      weeksBelowFallingSma[i] = 0;
    }
  }

  const dateToDailyIdx = new Map();
  for (let i = 0; i < n; i++) dateToDailyIdx.set(dailyDates[i], i);

  const dailyToWeeklyIdx = new Int32Array(n);
  let wPtr = 0;
  for (let i = 0; i < n; i++) {
    while (wPtr + 1 < wn && weeklyList[wPtr + 1].date <= dailyDates[i]) wPtr++;
    dailyToWeeklyIdx[i] = wPtr;
  }

  stockData[sym] = {
    dailyDates,
    dailyCloses,
    ema50,
    high252,
    weeklyCloses,
    sma30w,
    weeklyAtr,
    weeksBelowFallingSma,
    dateToDailyIdx,
    dailyToWeeklyIdx
  };
}

// Master Calendar for 2026
const allDates = new Set();
for (const sym of Object.keys(stockData)) {
  const dates = stockData[sym].dailyDates;
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] >= START_DATE && dates[i] <= END_DATE) allDates.add(dates[i]);
  }
}
const calendar = [...allDates].sort();
console.log(`[2026 Sim] Trading calendar: ${calendar.length} sessions (${calendar[0]} to ${calendar.at(-1)}).`);

function getPriceAt(sym, date) {
  const sd = stockData[sym];
  if (!sd) return null;
  const idx = sd.dateToDailyIdx.get(date);
  if (idx !== undefined) return sd.dailyCloses[idx];
  let lo = 0, hi = sd.dailyDates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sd.dailyDates[mid] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans >= 0 ? sd.dailyCloses[ans] : null;
}

// Simulation State
const positions = new Map(); // sym -> { sym, name, qty, avgPrice, peakPrice, buyDate, buyIdx, tranche1Done, totalInvested, trades: [] }
const allTrades = []; // Full execution ledger

for (let di = 0; di < calendar.length; di++) {
  const date = calendar[di];

  // 1. SELL TRIGGERS (Morning evaluation)
  const toDelete = [];
  for (const [sym, pos] of positions) {
    const sd = stockData[sym];
    const dIdx = sd.dateToDailyIdx.get(date);
    if (dIdx === undefined) continue;

    const price = sd.dailyCloses[dIdx];
    if (price > pos.peakPrice) pos.peakPrice = price;

    const daysSinceBuy = dIdx - pos.buyIdx;
    const isRecent = daysSinceBuy <= NOISE_DAYS;
    const pnlPct = price / pos.avgPrice - 1;

    // Rule 1: Fresh Buy 5-Day Circuit-Breaker (-8%)
    if (isRecent && pnlPct <= -HARD_STOP_PCT) {
      const trimQty = Math.max(1, Math.round(pos.qty * 0.33));
      const grossAmt = trimQty * price;
      const netProceeds = grossAmt * (1 - COST_RATE);
      const costBasis = trimQty * pos.avgPrice;
      const realizedPnl = netProceeds - costBasis;

      const trade = {
        date,
        symbol: sym,
        name: pos.name,
        type: 'SELL_TRIM',
        signal: 'CIRCUIT_BREAKER',
        qty: trimQty,
        price: Number(price.toFixed(2)),
        amount: Number(netProceeds.toFixed(2)),
        realizedPnl: Number(realizedPnl.toFixed(2)),
        pnlPct: Number((realizedPnl / costBasis * 100).toFixed(2)),
        reason: `Fresh buy circuit-breaker: -${(Math.abs(pnlPct)*100).toFixed(1)}% dropped below 8% corridor in first 5 days.`
      };
      allTrades.push(trade);
      pos.trades.push(trade);
      pos.qty -= trimQty;
      pos.tranche1Done = true;
      if (pos.qty <= 0) toDelete.push(sym);
      continue;
    }

    if (isRecent) continue;

    const wIdx = sd.dailyToWeeklyIdx[dIdx];
    const atr = sd.weeklyAtr[wIdx];
    const chandelierFloor = pos.peakPrice - ATR_MULT * atr;
    const trailingStop = Math.max(chandelierFloor, pos.peakPrice * (1 - TRAIL_STOP_PCT));

    // Rule 2: Tranche 1 Trim (33%) on Trailing Stop breach
    if (!pos.tranche1Done && price <= trailingStop) {
      const trimQty = Math.max(1, Math.round(pos.qty * 0.33));
      const grossAmt = trimQty * price;
      const netProceeds = grossAmt * (1 - COST_RATE);
      const costBasis = trimQty * pos.avgPrice;
      const realizedPnl = netProceeds - costBasis;

      const trade = {
        date,
        symbol: sym,
        name: pos.name,
        type: 'SELL_TRIM',
        signal: 'TRANCHE_1_TRIM',
        qty: trimQty,
        price: Number(price.toFixed(2)),
        amount: Number(netProceeds.toFixed(2)),
        realizedPnl: Number(realizedPnl.toFixed(2)),
        pnlPct: Number((realizedPnl / costBasis * 100).toFixed(2)),
        reason: `Trailing stop floor breached at ₹${price.toFixed(2)} (Floor ₹${trailingStop.toFixed(2)}, Peak ₹${pos.peakPrice.toFixed(2)}).`
      };
      allTrades.push(trade);
      pos.trades.push(trade);
      pos.qty -= trimQty;
      pos.tranche1Done = true;
      if (pos.qty <= 0) toDelete.push(sym);
      continue;
    }

    // Rule 3: Tranche 2 Full Liquidation (3+ weeks below falling 30w-SMA)
    const weeksBelow = sd.weeksBelowFallingSma[wIdx];
    if (weeksBelow >= 3) {
      const grossAmt = pos.qty * price;
      const netProceeds = grossAmt * (1 - COST_RATE);
      const costBasis = pos.qty * pos.avgPrice;
      const realizedPnl = netProceeds - costBasis;

      const trade = {
        date,
        symbol: sym,
        name: pos.name,
        type: 'SELL_FULL',
        signal: 'TRANCHE_2_EXIT',
        qty: pos.qty,
        price: Number(price.toFixed(2)),
        amount: Number(netProceeds.toFixed(2)),
        realizedPnl: Number(realizedPnl.toFixed(2)),
        pnlPct: Number((realizedPnl / costBasis * 100).toFixed(2)),
        reason: `Structural breakdown: 3+ weekly closes below falling 30-week SMA (${weeksBelow} weeks below). Full exit.`
      };
      allTrades.push(trade);
      pos.trades.push(trade);
      toDelete.push(sym);
      continue;
    }
  }

  for (const sym of toDelete) positions.delete(sym);

  // 2. BUY SIGNALS (Screening across universe)
  for (const sym of symbols) {
    const sd = stockData[sym];
    const dIdx = sd.dateToDailyIdx.get(date);
    if (dIdx === undefined || dIdx < 50) continue;

    const price = sd.dailyCloses[dIdx];
    if (price < 20) continue; // Penny stock gate

    const fund = fundamentalsMap[sym] || {};
    const mcap = Number(fund.marketCapCr);
    if (Number.isFinite(mcap) && mcap > 0 && mcap < 1000) continue; // Microcap gate

    // 50-EMA Breakout Gate: Close >= 3% above 50-EMA
    const ema50 = sd.ema50[dIdx];
    if (ema50 <= 0 || price < ema50 * 1.03) continue;

    const wIdx = sd.dailyToWeeklyIdx[dIdx];
    if (wIdx < 30) continue;

    const sma30 = sd.sma30w[wIdx];
    if (sma30 <= 0 || price <= sma30) continue; // Must be above 30w-SMA

    const sma30Prior = wIdx >= 4 ? sd.sma30w[wIdx - 4] : sd.sma30w[wIdx - 1];
    const isRisingSma = sma30Prior > 0 && sma30 > sma30Prior;
    const stage = isRisingSma ? 2 : 1;

    // Technical Score
    let techScore = stage === 2 ? 30 : 18;
    techScore += 15; // Above 50-EMA
    techScore += 10; // Above 30w-SMA
    if (isRisingSma) {
      const slopePct = ((sma30 / sma30Prior) - 1) * 100;
      techScore += slopePct > 1.0 ? 12 : 6;
    }
    const high52 = sd.high252[dIdx];
    if (high52 > 0) {
      const ddHigh = ((price / high52) - 1) * 100;
      if (ddHigh >= -5) techScore += 15;
      else if (ddHigh >= -15) techScore += 8;
    }
    techScore = Math.min(100, Math.max(0, techScore));

    // Fresh Entry
    if (!positions.has(sym)) {
      // Must have had fresh breakout (2 days ago at or below 50-EMA or prior day up)
      const prevClose = dIdx >= 1 ? sd.dailyCloses[dIdx - 1] : price;
      const twoDaysAgoClose = dIdx >= 2 ? sd.dailyCloses[dIdx - 2] : price;
      const twoDaysAgoEma = dIdx >= 2 ? sd.ema50[dIdx - 2] : ema50;
      const freshBreakout = twoDaysAgoClose <= twoDaysAgoEma || (prevClose > twoDaysAgoClose);
      if (!freshBreakout) continue;

      let signal = null;
      let alloc = 0;
      if (techScore >= 65 && stage === 2) {
        signal = 'STRONG_BUY';
        alloc = 100000;
      } else if (techScore >= 55) {
        signal = 'BUY';
        alloc = 50000;
      }
      if (!signal || alloc <= 0) continue;

      const buyQty = Math.max(1, Math.floor(alloc / (price * (1 + COST_RATE))));
      const totalCost = buyQty * price * (1 + COST_RATE);
      const name = fund.name || sym;

      const trade = {
        date,
        symbol: sym,
        name,
        type: 'BUY',
        signal,
        qty: buyQty,
        price: Number(price.toFixed(2)),
        amount: Number(totalCost.toFixed(2)),
        realizedPnl: 0,
        pnlPct: 0,
        reason: `${signal}: Technical score ${techScore}/100, Stage ${stage} markup, fresh breakout above 50-EMA.`
      };

      allTrades.push(trade);
      positions.set(sym, {
        sym,
        name,
        qty: buyQty,
        avgPrice: price,
        peakPrice: price,
        buyDate: date,
        buyIdx: dIdx,
        tranche1Done: false,
        totalInvested: totalCost,
        trades: [trade]
      });
    } else {
      // Subordinate Pyramid Additions on 50-EMA pullbacks for winning positions
      const pos = positions.get(sym);
      if (pos.totalInvested < 150000 && price > pos.avgPrice * 1.05 && Math.abs(price / ema50 - 1) <= 0.02) {
        const addAlloc = 50000;
        const addQty = Math.max(1, Math.floor(addAlloc / (price * (1 + COST_RATE))));
        const addCost = addQty * price * (1 + COST_RATE);

        const newTotalQty = pos.qty + addQty;
        const newTotalCost = pos.totalInvested + addCost;
        pos.avgPrice = newTotalCost / newTotalQty;
        pos.qty = newTotalQty;
        pos.totalInvested = newTotalCost;

        const trade = {
          date,
          symbol: sym,
          name: pos.name,
          type: 'BUY_PYRAMID',
          signal: 'PYRAMID_ADD',
          qty: addQty,
          price: Number(price.toFixed(2)),
          amount: Number(addCost.toFixed(2)),
          realizedPnl: 0,
          pnlPct: 0,
          reason: `Pyramid tranche: 50-EMA pullback in winning position (+${((price/pos.avgPrice - 1)*100).toFixed(1)}%). Added ${addQty} shares.`
        };
        allTrades.push(trade);
        pos.trades.push(trade);
      }
    }
  }
}

// Group all trades by Stock Symbol
const groupedByStock = {};

for (const t of allTrades) {
  if (!groupedByStock[t.symbol]) {
    groupedByStock[t.symbol] = {
      symbol: t.symbol,
      name: t.name || t.symbol,
      totalBoughtQty: 0,
      totalBoughtAmount: 0,
      totalSoldQty: 0,
      totalSoldAmount: 0,
      realizedPnl: 0,
      trades: []
    };
  }
  const s = groupedByStock[t.symbol];
  s.trades.push(t);
  if (t.type.startsWith('BUY')) {
    s.totalBoughtQty += t.qty;
    s.totalBoughtAmount += t.amount;
  } else if (t.type.startsWith('SELL')) {
    s.totalSoldQty += t.qty;
    s.totalSoldAmount += t.amount;
    s.realizedPnl += t.realizedPnl;
  }
}

// Compute ending open status and unrealized P&L as of 2026-10-30
let totalRealizedPnl = 0;
let totalUnrealizedPnl = 0;
let totalInvestedAll = 0;
let totalSoldAll = 0;
let totalEndingValue = 0;

for (const sym of Object.keys(groupedByStock)) {
  const s = groupedByStock[sym];
  const pos = positions.get(sym);
  const cmp = getPriceAt(sym, END_DATE) || 0;

  s.openQty = s.totalBoughtQty - s.totalSoldQty;
  s.cmp = Number(cmp.toFixed(2));
  s.currentValuation = Number((s.openQty * cmp).toFixed(2));
  s.avgBuyPrice = s.totalBoughtQty > 0 ? Number((s.totalBoughtAmount / s.totalBoughtQty).toFixed(2)) : 0;
  
  // Cost of remaining open shares
  const openCostBasis = s.openQty * s.avgBuyPrice;
  s.unrealizedPnl = s.openQty > 0 ? Number((s.currentValuation - openCostBasis).toFixed(2)) : 0;
  s.unrealizedPnlPct = openCostBasis > 0 ? Number((s.unrealizedPnl / openCostBasis * 100).toFixed(2)) : 0;
  s.netPnl = Number((s.realizedPnl + s.unrealizedPnl).toFixed(2));
  s.totalPnlPct = s.totalBoughtAmount > 0 ? Number((s.netPnl / s.totalBoughtAmount * 100).toFixed(2)) : 0;
  s.status = s.openQty > 0 ? (s.totalSoldQty > 0 ? 'PARTIAL_TRIM' : 'OPEN') : 'CLOSED';

  totalRealizedPnl += s.realizedPnl;
  totalUnrealizedPnl += s.unrealizedPnl;
  totalInvestedAll += s.totalBoughtAmount;
  totalSoldAll += s.totalSoldAmount;
  totalEndingValue += s.currentValuation;
}

const totalNetPnl = totalRealizedPnl + totalUnrealizedPnl;
const totalRoiPct = totalInvestedAll > 0 ? (totalNetPnl / totalInvestedAll * 100) : 0;

console.log('=== 2026 SIMULATION RESULTS ===');
console.log('Total Stocks Traded in 2026:', Object.keys(groupedByStock).length);
console.log('Total Trades Executed:', allTrades.length);
console.log('Total Capital Deployed (Buys):', '₹' + Math.round(totalInvestedAll).toLocaleString('en-IN'));
console.log('Total Sales Proceeds:', '₹' + Math.round(totalSoldAll).toLocaleString('en-IN'));
console.log('Ending Open Portfolio Valuation:', '₹' + Math.round(totalEndingValue).toLocaleString('en-IN'));
console.log('Realized P&L:', '₹' + Math.round(totalRealizedPnl).toLocaleString('en-IN'));
console.log('Unrealized P&L:', '₹' + Math.round(totalUnrealizedPnl).toLocaleString('en-IN'));
console.log('Total Net P&L:', '₹' + Math.round(totalNetPnl).toLocaleString('en-IN'), `(${totalRoiPct.toFixed(2)}%)`);

// Save results to JSON
const outputData = {
  summary: {
    startDate: START_DATE,
    endDate: END_DATE,
    totalStocks: Object.keys(groupedByStock).length,
    totalTrades: allTrades.length,
    totalInvested: Number(totalInvestedAll.toFixed(2)),
    totalSold: Number(totalSoldAll.toFixed(2)),
    endingValuation: Number(totalEndingValue.toFixed(2)),
    realizedPnl: Number(totalRealizedPnl.toFixed(2)),
    unrealizedPnl: Number(totalUnrealizedPnl.toFixed(2)),
    netPnl: Number(totalNetPnl.toFixed(2)),
    roiPct: Number(totalRoiPct.toFixed(2))
  },
  stocks: Object.values(groupedByStock)
};

fs.writeFileSync(path.join(projectRoot, 'data', 'sim_2026_strategy_results.json'), JSON.stringify(outputData, null, 2), 'utf8');
console.log('Saved simulation results to data/sim_2026_strategy_results.json');
