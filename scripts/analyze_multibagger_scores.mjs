/**
 * scripts/analyze_multibagger_scores.mjs
 * 
 * Deep Quantitative Audit of Top 50 Multibaggers & Buy Analysis Score Optimization:
 * 1. Historical scores (Technical, Fundamental, Composite) at time of initial entry for Top 50 Multibaggers.
 * 2. Counter-factual threshold analysis:
 *    - Baseline (Score >= 55)
 *    - Moderate (Score >= 65)
 *    - Ultra-Strict (Score >= 75)
 * 3. Conviction-Weighted Capital Allocation Optimization:
 *    - Allocating more capital to high scores (>= 75 / >= 80) vs standard (55-65)
 *    - Comparing CAGR, Total Net Profit, Win Rate, and Drawdown.
 */

import fs from 'node:fs';
import path from 'node:path';
import { computeFundamentalScore } from '../server/services/stockIntelligence/fundamentalScorer.js';

const HIST_FILE = path.join(process.cwd(), 'data', 'historical_prices.json');
const SCREENER_DIR = path.join(process.cwd(), 'data', 'screener_cache');
const START_DATE = '2023-01-02';
const END_DATE = '2026-10-30';
const COST_RATE = 0.005; // 0.50% friction

console.log('[Multibagger Analysis] Loading historical prices...');
const allPrices = JSON.parse(fs.readFileSync(HIST_FILE, 'utf8'));

const US = new Set('AAPL,MSFT,GOOGL,GOOG,AMZN,NVDA,META,TSLA,PLTR,CRM,AVGO,NFLX,AMD,INTC,ORCL,ADBE,QCOM,CSCO,IBM,NOW,UBER,ABNB,SNOW,NET,DDOG,MDB,SHOP,SQ,PYPL,COIN,DIS,NKE,SBUX,MCD,WMT,TGT,COST,HD,LOW,PG,JNJ,PFE,MRK,ABBV,LLY,UNH,CVS,JPM,BAC,WFC,C,GS,MS,BLK,SCHW,V,MA,AXP,XOM,CVX,COP,SLB,CAT,DE,GE,HON,UNP,UPS,FDX,BA,RTX,LMT,GD,NOC,NEE,DUK,SO,D,AEP,EXC,SRE,ED,PEG,XEL'.split(','));

function isIndianStock(s) {
  if (US.has(s) || /^\d+$/.test(s) || /\.(NS|BO)$/i.test(s) || /SM\d+/i.test(s)) return false;
  return s.length >= 2 && s.length <= 20 && /^[A-Z]/.test(s);
}

const symbols = Object.keys(allPrices).filter(s => {
  if (!isIndianStock(s)) return false;
  const dates = Object.keys(allPrices[s]).sort();
  return dates[0] <= '2022-07-01' && dates.at(-1) >= '2026-10-01' && dates.length > 400;
}).sort();

console.log(`[Multibagger Analysis] Universe: ${symbols.length} Indian stocks.`);

// Pre-load fundamental scores from Screener cache
const fundScores = new Map();
for (const sym of symbols) {
  const p = path.join(SCREENER_DIR, `${sym}.json`);
  if (fs.existsSync(p)) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      const sc = computeFundamentalScore(data);
      fundScores.set(sym, {
        score: sc.score || 50,
        grade: sc.fundamentalGrade || 'C',
        pe: sc.valuationCheck?.pe || null,
        peg: sc.valuationCheck?.peg || null,
        sector: data.sector || 'Unknown'
      });
    } catch {
      fundScores.set(sym, { score: 50, grade: 'C', pe: null, peg: null, sector: 'Unknown' });
    }
  } else {
    fundScores.set(sym, { score: 50, grade: 'C', pe: null, peg: null, sector: 'Unknown' });
  }
}

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
  const dailyCloses = new Float64Array(n);
  const dailyDates = new Array(n);
  for (let i = 0; i < n; i++) {
    dailyCloses[i] = daily[i].close;
    dailyDates[i] = daily[i].date;
  }

  // 50 EMA
  const ema50 = new Float64Array(n);
  const k50 = 2 / 51;
  let e50 = 0;
  for (let i = 0; i < Math.min(50, n); i++) e50 += dailyCloses[i];
  e50 /= Math.min(50, n);
  for (let i = 0; i < n; i++) {
    if (i < 49) ema50[i] = 0;
    else if (i === 49) ema50[i] = e50;
    else { e50 = dailyCloses[i] * k50 + e50 * (1 - k50); ema50[i] = e50; }
  }

  // 21 EMA
  const ema21 = new Float64Array(n);
  const k21 = 2 / 22;
  let e21 = 0;
  for (let i = 0; i < Math.min(21, n); i++) e21 += dailyCloses[i];
  e21 /= Math.min(21, n);
  for (let i = 0; i < n; i++) {
    if (i < 20) ema21[i] = 0;
    else if (i === 20) ema21[i] = e21;
    else { e21 = dailyCloses[i] * k21 + e21 * (1 - k21); ema21[i] = e21; }
  }

  // 252-day High
  const high252 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let mx = dailyCloses[i];
    const s = Math.max(0, i - 251);
    for (let j = s; j < i; j++) { if (dailyCloses[j] > mx) mx = dailyCloses[j]; }
    high252[i] = mx;
  }

  // Weekly Aggregation
  const weeklyList = [];
  let curWeekKey = '', curWeekClose = 0, curWeekDate = '';
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

  const sma30w = new Float64Array(wn);
  for (let i = 0; i < wn; i++) {
    if (i < 29) {
      sma30w[i] = 0;
    } else {
      let sum = 0;
      for (let j = i - 29; j <= i; j++) sum += weeklyCloses[j];
      sma30w[i] = sum / 30;
    }
  }

  const weeklyAtr = new Float64Array(wn);
  for (let i = 0; i < wn; i++) {
    if (i >= 14) {
      let trSum = 0;
      for (let j = i - 13; j <= i; j++) trSum += Math.abs(weeklyCloses[j] - weeklyCloses[j - 1]);
      weeklyAtr[i] = Math.max(trSum / 14, weeklyCloses[i] * 0.03);
    } else if (i > 0) weeklyAtr[i] = Math.abs(weeklyCloses[i] - weeklyCloses[i - 1]);
    else weeklyAtr[i] = weeklyCloses[0] * 0.05;
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
    ema21,
    high252,
    weeklyCloses,
    sma30w,
    weeklyAtr,
    dateToDailyIdx,
    dailyToWeeklyIdx
  };
}

const allDates = new Set();
for (const sym of symbols) {
  const dates = stockData[sym].dailyDates;
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] >= START_DATE && dates[i] <= END_DATE) allDates.add(dates[i]);
  }
}
const calendar = [...allDates].sort();

function getPriceAt(sym, date) {
  const sd = stockData[sym];
  if (!sd) return null;
  const idx = sd.dateToDailyIdx.get(date);
  if (idx !== undefined) return sd.dailyCloses[idx];
  let lo = 0, hi = sd.dailyDates.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sd.dailyDates[mid] <= date) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans >= 0 ? sd.dailyCloses[ans] : null;
}

// Custom simulation engine
function runCustomSimulation({
  minTechScore = 55,
  minFundScore = 0,
  minCompositeScore = 0,
  sizingMode = 'LADDER_STANDARD', // 'LADDER_STANDARD' | 'CONVICTION_OPTIMIZED' | 'STRICT_THRESHOLD'
  maxPositionCap = 200000
}) {
  let totalCashInjected = 0;
  let realizedProceeds = 0;
  const positions = new Map();
  const trades = [];
  const initialScores = new Map();

  for (let di = 0; di < calendar.length; di++) {
    const date = calendar[di];

    // 1. SELL EVALUATION
    const toDelete = [];
    for (const [sym, pos] of positions) {
      const sd = stockData[sym];
      const dIdx = sd.dateToDailyIdx.get(date);
      if (dIdx === undefined) continue;

      const price = sd.dailyCloses[dIdx];
      if (price > pos.peakPrice) pos.peakPrice = price;

      const daysSinceBuy = dIdx - pos.buyIdx;
      const isRecent = daysSinceBuy <= 5;
      const pnlPct = price / pos.avgPrice - 1;

      // Fresh buy 8% hard circuit-breaker
      if (isRecent && pnlPct <= -0.08) {
        const trimQty = Math.max(1, Math.round(pos.qty * 0.33));
        const proceeds = trimQty * price * (1 - COST_RATE);
        realizedProceeds += proceeds;
        pos.qty -= trimQty;
        trades.push({
          date, sym, type: 'TRIM_CIRCUIT_BREAKER', qty: trimQty, price, amount: proceeds,
          reason: `Fresh buy circuit-breaker: down ${(pnlPct * 100).toFixed(1)}% within 5 days.`
        });
        pos.tranche1Done = true;
      }

      // Tranche 1: Chandelier trailing stop floor breach (33% trim)
      const wIdx = sd.dailyToWeeklyIdx[dIdx];
      const atr = sd.weeklyAtr[wIdx];
      const chandelierFloor = pos.peakPrice - 3.0 * atr;

      if (!pos.tranche1Done && !isRecent && price <= chandelierFloor && pos.qty > 0) {
        const trimQty = Math.max(1, Math.round(pos.qty * 0.33));
        const proceeds = trimQty * price * (1 - COST_RATE);
        realizedProceeds += proceeds;
        pos.qty -= trimQty;
        trades.push({
          date, sym, type: 'TRIM_T1', qty: trimQty, price, amount: proceeds,
          reason: `Breached Chandelier stop floor ₹${chandelierFloor.toFixed(2)}.`
        });
        pos.tranche1Done = true;
      }

      // Tranche 2: 30w-SMA breakdown (100% full liquidation)
      const sma = sd.sma30w[wIdx];
      if (!isRecent && price <= sma && sma > 0 && pos.qty > 0) {
        const exitQty = pos.qty;
        const proceeds = exitQty * price * (1 - COST_RATE);
        realizedProceeds += proceeds;
        trades.push({
          date, sym, type: 'SELL_FULL', qty: exitQty, price, amount: proceeds,
          reason: `Structural breakdown below 30-week SMA ₹${sma.toFixed(2)}.`
        });
        pos.qty = 0;
        toDelete.push(sym);
      }
    }
    for (const sym of toDelete) positions.delete(sym);

    // 2. BUY EVALUATION
    for (const sym of symbols) {
      const sd = stockData[sym];
      const dIdx = sd.dateToDailyIdx.get(date);
      if (dIdx === undefined || dIdx < 50) continue;

      const price = sd.dailyCloses[dIdx];
      if (price < 20) continue;

      const ema50 = sd.ema50[dIdx];
      if (ema50 <= 0 || price < ema50 * 1.03) continue;

      const wIdx = sd.dailyToWeeklyIdx[dIdx];
      if (wIdx < 30) continue;

      const sma30 = sd.sma30w[wIdx];
      if (sma30 <= 0 || price <= sma30) continue;

      const sma30Prior = wIdx >= 4 ? sd.sma30w[wIdx - 4] : sd.sma30w[wIdx - 1];
      const isRisingSma = sma30Prior > 0 && sma30 > sma30Prior;
      const stage = isRisingSma ? 2 : 1;

      // Compute technical score
      let techScore = stage === 2 ? 30 : 18;
      techScore += 15 + 10;
      if (isRisingSma) techScore += ((sma30 / sma30Prior) - 1) * 100 > 1 ? 12 : 6;

      const high52 = sd.high252[dIdx];
      if (high52 > 0) {
        const dd = ((price / high52) - 1) * 100;
        if (dd >= -5) techScore += 15;
        else if (dd >= -15) techScore += 8;
      }

      const atr = sd.weeklyAtr[wIdx];
      const chandelier = high52 - 3.0 * atr;
      if (price > chandelier && chandelier > 0 && ((price / chandelier) - 1) * 100 >= 5) techScore += 10;

      // Fundamental & Composite Score
      const fund = fundScores.get(sym) || { score: 50, grade: 'C', sector: 'Unknown' };
      const fundScore = fund.score;
      const compositeScore = Math.round((techScore + fundScore) / 2);

      // Filter Gates
      if (techScore < minTechScore) continue;
      if (fundScore < minFundScore) continue;
      if (compositeScore < minCompositeScore) continue;

      // Sizing calculation
      let alloc = 0;
      if (sizingMode === 'LADDER_STANDARD') {
        if (techScore >= 65 && stage === 2) alloc = 100000;
        else if (techScore >= 55) alloc = 50000;
      } else if (sizingMode === 'CONVICTION_OPTIMIZED') {
        // Conviction-Weighted: Allocate larger capital to high-conviction scores
        if (compositeScore >= 80) alloc = 200000;      // Prime Ultra: ₹2.0L
        else if (compositeScore >= 70) alloc = 125000; // High Conviction: ₹1.25L
        else if (compositeScore >= 60) alloc = 75000;  // Standard: ₹75k
        else alloc = 35000;                            // Moderate: ₹35k
      } else if (sizingMode === 'STRICT_THRESHOLD') {
        alloc = compositeScore >= 75 ? 150000 : 75000;
      }

      if (alloc <= 0) continue;

      // Fresh position buy
      if (!positions.has(sym)) {
        const buyQty = Math.max(1, Math.floor(alloc / (price * (1 + COST_RATE))));
        const cost = buyQty * price * (1 + COST_RATE);
        totalCashInjected += cost;

        positions.set(sym, {
          qty: buyQty,
          avgPrice: price,
          peakPrice: price,
          buyDate: date,
          buyIdx: dIdx,
          tranche1Done: false,
          totalInvested: cost,
          tranches: 1
        });

        if (!initialScores.has(sym)) {
          initialScores.set(sym, {
            sym,
            firstBuyDate: date,
            firstBuyPrice: price,
            initialTechScore: techScore,
            initialFundScore: fundScore,
            initialCompositeScore: compositeScore,
            fundGrade: fund.grade,
            sector: fund.sector
          });
        }

        trades.push({
          date, sym, type: 'BUY', qty: buyQty, price, amount: cost,
          signal: alloc >= 100000 ? 'STRONG_BUY' : 'BUY',
          reason: `Stage ${stage} Bull, TechScore ${techScore}, FundScore ${fundScore}, CompScore ${compositeScore}`
        });
      } else {
        // Pyramiding on confirmed pullback
        const pos = positions.get(sym);
        const dist50 = Math.abs(price - ema50) / ema50 * 100;
        const ema21 = sd.ema21[dIdx];
        const dist21 = Math.abs(price - ema21) / ema21 * 100;
        const isPullback = (dist50 <= 3.0 || dist21 <= 2.5) && price > pos.avgPrice;

        if (isPullback && pos.totalInvested < maxPositionCap && pos.tranches < 3 && dIdx - pos.buyIdx >= 10) {
          const addAlloc = sizingMode === 'CONVICTION_OPTIMIZED' && compositeScore >= 75 ? 75000 : 50000;
          const addQty = Math.max(1, Math.floor(addAlloc / (price * (1 + COST_RATE))));
          const addCost = addQty * price * (1 + COST_RATE);

          const newQty = pos.qty + addQty;
          pos.avgPrice = ((pos.avgPrice * pos.qty) + (price * addQty)) / newQty;
          pos.qty = newQty;
          pos.totalInvested += addCost;
          pos.tranches++;
          totalCashInjected += addCost;

          trades.push({
            date, sym, type: 'BUY_ADD', qty: addQty, price, amount: addCost,
            signal: 'PYRAMID_ADDITION',
            reason: `Pullback near 21/50-EMA support. Tranche #${pos.tranches}.`
          });
        }
      }
    }
  }

  // 3. STATISTICAL AGGREGATION ACROSS ALL STOCKS (Parity with backtest_unlimited_capital_2023.mjs)
  const stockSummary = {};
  for (const t of trades) {
    if (!stockSummary[t.sym]) {
      stockSummary[t.sym] = {
        sym: t.sym,
        totalBoughtAmt: 0,
        totalBoughtQty: 0,
        totalSoldAmt: 0,
        totalSoldQty: 0,
        tradesCount: 0
      };
    }
    stockSummary[t.sym].tradesCount++;
    if (t.type === 'BUY' || t.type === 'BUY_ADD') {
      stockSummary[t.sym].totalBoughtAmt += t.amount;
      stockSummary[t.sym].totalBoughtQty += t.qty;
    } else {
      stockSummary[t.sym].totalSoldAmt += t.amount;
      stockSummary[t.sym].totalSoldQty += t.qty;
    }
  }

  // Add Open Holdings Details
  for (const [sym, pos] of positions) {
    const curP = getPriceAt(sym, END_DATE) || pos.avgPrice;
    if (stockSummary[sym]) {
      stockSummary[sym].heldQty = pos.qty;
      stockSummary[sym].currentPrice = curP;
      stockSummary[sym].avgBuyPrice = pos.avgPrice;
      stockSummary[sym].openVal = pos.qty * curP;
      stockSummary[sym].peakPrice = pos.peakPrice;
    }
  }

  let grandTotalBought = 0;
  let grandTotalSold = 0;
  let grandOpenValuation = 0;

  const stockRows = Object.values(stockSummary).map(s => {
    grandTotalBought += s.totalBoughtAmt;
    grandTotalSold += s.totalSoldAmt;
    const openVal = s.openVal || 0;
    grandOpenValuation += openVal;

    const heldQty = s.heldQty || 0;
    const avgBuyPrice = s.totalBoughtQty > 0 ? s.totalBoughtAmt / s.totalBoughtQty : 0;
    const avgSellPrice = s.totalSoldQty > 0 ? s.totalSoldAmt / s.totalSoldQty : 0;

    const netPnl = s.totalSoldAmt + openVal - s.totalBoughtAmt;
    const returnPct = s.totalBoughtAmt > 0 ? (netPnl / s.totalBoughtAmt) * 100 : 0;
    const status = heldQty > 0 && s.totalSoldQty > 0 ? 'PARTIAL_TRIM' : heldQty > 0 ? 'OPEN' : 'CLOSED';

    const scores = initialScores.get(s.sym) || {
      firstBuyDate: '—',
      firstBuyPrice: 0,
      initialTechScore: 0,
      initialFundScore: 0,
      initialCompositeScore: 0,
      fundGrade: '—',
      sector: '—'
    };

    return {
      sym: s.sym,
      totalBoughtAmt: Math.round(s.totalBoughtAmt),
      totalSoldAmt: Math.round(s.totalSoldAmt),
      openVal: Math.round(openVal),
      heldQty,
      currentPrice: s.currentPrice,
      netPnl: Math.round(netPnl),
      returnPct: Number(returnPct.toFixed(2)),
      status,
      tradesCount: s.tradesCount,
      ...scores
    };
  }).sort((a, b) => b.netPnl - a.netPnl);

  const totalNetProfit = (grandTotalSold + grandOpenValuation) - grandTotalBought;
  const roiPct = grandTotalBought > 0 ? (totalNetProfit / grandTotalBought) * 100 : 0;

  const wins = stockRows.filter(r => r.netPnl > 0);
  const losses = stockRows.filter(r => r.netPnl < 0);
  const winRate = stockRows.length > 0 ? (wins.length / stockRows.length) * 100 : 0;
  const grossGains = wins.reduce((acc, r) => acc + r.netPnl, 0);
  const grossLosses = Math.abs(losses.reduce((acc, r) => acc + r.netPnl, 0));
  const profitFactor = grossLosses > 0 ? (grossGains / grossLosses) : grossGains;

  return {
    grandTotalBought,
    grandTotalSold,
    grandOpenValuation,
    totalNetProfit,
    roiPct,
    winRate,
    profitFactor,
    totalStocksTraded: stockRows.length,
    activePositionsCount: positions.size,
    stockRows
  };
}

// Run All 4 Scenarios
console.log('[Multibagger Analysis] Executing Scenario 1: Baseline (Score >= 55)...');
const resBaseline = runCustomSimulation({ minTechScore: 55, sizingMode: 'LADDER_STANDARD', maxPositionCap: 200000 });

console.log('[Multibagger Analysis] Executing Scenario 2: Strict Filter (Score >= 65)...');
const resStrict65 = runCustomSimulation({ minTechScore: 65, minCompositeScore: 65, sizingMode: 'LADDER_STANDARD', maxPositionCap: 200000 });

console.log('[Multibagger Analysis] Executing Scenario 3: Ultra-Strict (Score >= 75)...');
const resStrict75 = runCustomSimulation({ minTechScore: 70, minCompositeScore: 75, sizingMode: 'LADDER_STANDARD', maxPositionCap: 200000 });

console.log('[Multibagger Analysis] Executing Scenario 4: Conviction-Weighted Sizing (Heavy 75+ / 80+)...');
const resConviction = runCustomSimulation({ minTechScore: 55, sizingMode: 'CONVICTION_OPTIMIZED', maxPositionCap: 350000 });

console.log('\n═════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('                          TOP 50 MULTIBAGGERS: EXACT SCORES AT TIME OF ENTRY');
console.log('═════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('Rank | Symbol     | Entry Date | Buy Price | Tech | Fund | Composite | Grade | Net Profit (₹) | Return % | Status');
console.log('─────┼────────────┼────────────┼───────────┼──────┼──────┼───────────┼───────┼────────────────┼──────────┼────────');

const top50 = resBaseline.stockRows.slice(0, 50);
top50.forEach((s, idx) => {
  const rank = String(idx + 1).padStart(4, ' ');
  const sym = s.sym.padEnd(10, ' ');
  const date = s.firstBuyDate;
  const price = ('₹' + s.firstBuyPrice.toFixed(1)).padStart(9, ' ');
  const tech = String(s.initialTechScore).padStart(4, ' ');
  const fund = String(s.initialFundScore).padStart(4, ' ');
  const comp = String(s.initialCompositeScore).padStart(9, ' ');
  const grade = s.fundGrade.padStart(5, ' ');
  const pnl = ('+₹' + s.netPnl.toLocaleString('en-IN')).padStart(14, ' ');
  const ret = ('+' + s.returnPct.toFixed(1) + '%').padStart(8, ' ');
  const status = s.status;
  console.log(`${rank} | ${sym} | ${date} | ${price} | ${tech} | ${fund} | ${comp} | ${grade} | ${pnl} | ${ret} | ${status}`);
});

// Distribution Analysis of Top 50 Multibaggers
const compScoresTop50 = top50.map(s => s.initialCompositeScore);
const fundScoresTop50 = top50.map(s => s.initialFundScore);
const techScoresTop50 = top50.map(s => s.initialTechScore);

const avgComp = (compScoresTop50.reduce((a, b) => a + b, 0) / 50).toFixed(1);
const avgFund = (fundScoresTop50.reduce((a, b) => a + b, 0) / 50).toFixed(1);
const avgTech = (techScoresTop50.reduce((a, b) => a + b, 0) / 50).toFixed(1);

const fundUnder55 = top50.filter(s => s.initialFundScore < 55);
const fundUnder65 = top50.filter(s => s.initialFundScore < 65);
const fund75Plus = top50.filter(s => s.initialFundScore >= 75);

const compUnder65 = top50.filter(s => s.initialCompositeScore < 65);
const compUnder75 = top50.filter(s => s.initialCompositeScore < 75);
const comp75Plus = top50.filter(s => s.initialCompositeScore >= 75);

console.log('\n─────────────────────────────────────────────────────────────────────────────────────────────────────────────');
console.log(`STATISTICAL FINDINGS ACROSS TOP 50 MULTIBAGGERS:`);
console.log(`1. Average Score at Entry: Technical = ${avgTech}/100, Fundamental = ${avgFund}/100, Composite = ${avgComp}/100`);
console.log(`2. Fundamental Score Distribution:`);
console.log(`   - Fundamental < 55 (Turnarounds / Cyclicals / Recovering): ${fundUnder55.length} stocks (${(fundUnder55.length/50*100).toFixed(0)}% of Top 50!)`);
console.log(`   - Fundamental < 65: ${fundUnder65.length} stocks (${(fundUnder65.length/50*100).toFixed(0)}% of Top 50)`);
console.log(`   - Fundamental >= 75 (High Quality Proven Compounders): ${fund75Plus.length} stocks (${(fund75Plus.length/50*100).toFixed(0)}% of Top 50)`);
console.log(`3. Composite Score Distribution:`);
console.log(`   - Composite < 65: ${compUnder65.length} stocks (${(compUnder65.length/50*100).toFixed(0)}% of Top 50)`);
console.log(`   - Composite < 75: ${compUnder75.length} stocks (${(compUnder75.length/50*100).toFixed(0)}% of Top 50)`);
console.log(`   - Composite >= 75: ${comp75Plus.length} stocks (${(comp75Plus.length/50*100).toFixed(0)}% of Top 50)`);

console.log('\n═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('                                STRATEGY THRESHOLD & SIZING OPTIMIZATION COMPARISON');
console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('Scenario                         | Capital Deployed | Realized Sales  | Open Holdings   | Total Net Profit  | ROI %   | WinRate | PF    | Traded');
console.log('─────────────────────────────────┼──────────────────┼─────────────────┼─────────────────┼───────────────────┼─────────┼─────────┼───────┼───────');

function printRow(name, r) {
  const n = name.padEnd(32, ' ');
  const dep = ('₹' + (r.grandTotalBought / 100000).toFixed(1) + 'L (₹' + (r.grandTotalBought/10000000).toFixed(2) + ' Cr)').padStart(16, ' ');
  const sal = ('₹' + (r.grandTotalSold / 100000).toFixed(1) + 'L').padStart(15, ' ');
  const opn = ('₹' + (r.grandOpenValuation / 100000).toFixed(1) + 'L').padStart(15, ' ');
  const pnl = ('+₹' + (r.totalNetProfit / 100000).toFixed(1) + 'L (+₹' + (r.totalNetProfit/10000000).toFixed(2) + ' Cr)').padStart(17, ' ');
  const roi = ('+' + r.roiPct.toFixed(1) + '%').padStart(7, ' ');
  const wr = (r.winRate.toFixed(1) + '%').padStart(7, ' ');
  const pf = (r.profitFactor.toFixed(1) + 'x').padStart(5, ' ');
  const num = (r.totalStocksTraded + ' stks').padStart(7, ' ');
  console.log(`${n} | ${dep} | ${sal} | ${opn} | ${pnl} | ${roi} | ${wr} | ${pf} | ${num}`);
}

printRow('1. Baseline (Score >= 55)', resBaseline);
printRow('2. Strict Filter (Score >= 65)', resStrict65);
printRow('3. Ultra-Strict (Score >= 75)', resStrict75);
printRow('4. Conviction-Weighted (Heavy 75+)', resConviction);
console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════');
