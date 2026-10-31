/**
 * scripts/backtest_realistic_45L_optimized.mjs
 * 
 * Realistic Capital Backtest (Jan 2, 2023 → Oct 30, 2026):
 * - Initial Capital: ₹45,00,000 on Day 1
 * - Monthly Fresh Savings Infusion: ₹2,00,000 / month on 1st trading day of each month
 * - Recycled Capital: 100% of sale proceeds recycled into liquid cash pool
 * 
 * Compares:
 * 1. Current Production Strategy (Strategy C)
 * 2. New Optimized High-Alpha Multibagger Engine (Strategy O) with:
 *    - Relative Strength + Composite Score Multibagger Probability Ranking
 *    - Asymmetric Conviction Sizing (Prime Ultra ₹2.0L, High ₹1.25L, Std ₹75k, Turnaround ₹40k)
 *    - Tiered Trailing Stop Corridor (Tight before +25% profit, Wide max(20%, 3.5xATR) after +25% cushion)
 *    - Dynamic 10% Portfolio Weight Cap
 */

import fs from 'node:fs';
import path from 'node:path';
import { computeFundamentalScore } from '../server/services/stockIntelligence/fundamentalScorer.js';

const HIST_FILE = path.join(process.cwd(), 'data', 'historical_prices.json');
const SCREENER_DIR = path.join(process.cwd(), 'data', 'screener_cache');
const START_DATE = '2023-01-02';
const END_DATE = '2026-10-30';
const COST_RATE = 0.005; // 0.50% statutory charges + slippage

const INITIAL_CAPITAL = 4500000;  // ₹45 Lakhs
const MONTHLY_SIP = 200000;       // ₹2 Lakhs / month

console.log('[Realistic Backtest] Loading price data...');
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

console.log(`[Realistic Backtest] Universe: ${symbols.length} Indian stocks.`);

// Pre-load fundamental scores
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
        sector: data.sector || 'Unknown'
      });
    } catch {
      fundScores.set(sym, { score: 50, grade: 'C', sector: 'Unknown' });
    }
  } else {
    fundScores.set(sym, { score: 50, grade: 'C', sector: 'Unknown' });
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

  // 50 EMA & 21 EMA
  const ema50 = new Float64Array(n);
  const ema21 = new Float64Array(n);
  const k50 = 2 / 51;
  const k21 = 2 / 22;
  let cur50 = dailyCloses[0], cur21 = dailyCloses[0];
  for (let i = 0; i < n; i++) {
    cur50 = cur50 * (1 - k50) + dailyCloses[i] * k50;
    cur21 = cur21 * (1 - k21) + dailyCloses[i] * k21;
    ema50[i] = cur50;
    ema21[i] = cur21;
  }

  // 252-day High
  const high252 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let mx = dailyCloses[i];
    const s = Math.max(0, i - 251);
    for (let j = s; j < i; j++) { if (dailyCloses[j] > mx) mx = dailyCloses[j]; }
    high252[i] = mx;
  }

  // 126-day Momentum (6-Month Mansfield RS Proxy)
  const momentum126 = new Float64Array(n);
  for (let i = 126; i < n; i++) {
    momentum126[i] = (dailyCloses[i] / dailyCloses[i - 126] - 1) * 100;
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
    momentum126,
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

// ─── Realistic Capital Simulation Harness ───────────────────────────────────
function runRealisticPortfolioSimulation(mode = 'CURRENT') {
  // Cash reserves tracking
  let cash = INITIAL_CAPITAL;
  let totalInfusedFromPocket = INITIAL_CAPITAL;
  let lastInfusedMonth = START_DATE.slice(0, 7);

  const positions = new Map();
  const trades = [];
  const dailyEquityCurve = [];
  const initialEntryScores = new Map();

  for (let di = 0; di < calendar.length; di++) {
    const date = calendar[di];
    const curMonth = date.slice(0, 7);

    // Monthly fresh cash injection (₹2.0L on 1st trading day of each month)
    if (curMonth !== lastInfusedMonth) {
      cash += MONTHLY_SIP;
      totalInfusedFromPocket += MONTHLY_SIP;
      lastInfusedMonth = curMonth;
    }

    // Current open valuation
    let currentOpenValuation = 0;
    for (const [sym, pos] of positions) {
      const p = getPriceAt(sym, date) || pos.avgPrice;
      currentOpenValuation += pos.qty * p;
    }
    const totalPortfolioValuation = cash + currentOpenValuation;

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
      const peakGainPct = pos.peakPrice / pos.avgPrice - 1;

      // Fresh buy hard circuit breaker
      if (isRecent && pnlPct <= -0.08) {
        const trimQty = Math.max(1, Math.round(pos.qty * 0.33));
        const proceeds = trimQty * price * (1 - COST_RATE);
        cash += proceeds;
        pos.qty -= trimQty;
        trades.push({
          date, sym, type: 'TRIM_CIRCUIT_BREAKER', qty: trimQty, price, amount: proceeds,
          reason: `Fresh buy circuit breaker down ${(pnlPct * 100).toFixed(1)}%`
        });
        pos.tranche1Done = true;
      }

      // Tranche 1 Trim
      const wIdx = sd.dailyToWeeklyIdx[dIdx];
      const atr = sd.weeklyAtr[wIdx];

      let chandelierFloor;
      if (mode === 'OPTIMIZED') {
        // Tiered Trailing Stop Corridor:
        // Before +25% profit cushion: standard 3.0 ATR / 15%
        // After +25% profit cushion established: WIDEN stop floor to max(20%, 3.5x ATR) to avoid premature shakeouts!
        if (peakGainPct >= 0.25) {
          const widePctFloor = pos.peakPrice * 0.80; // 20% pullback allowance
          const wideAtrFloor = pos.peakPrice - 3.5 * atr;
          chandelierFloor = Math.max(widePctFloor, wideAtrFloor);
        } else {
          chandelierFloor = pos.peakPrice - 3.0 * atr;
        }
      } else {
        // Standard Current Strategy: fixed 3.0 ATR
        chandelierFloor = pos.peakPrice - 3.0 * atr;
      }

      if (!pos.tranche1Done && !isRecent && price <= chandelierFloor && pos.qty > 0) {
        const trimQty = Math.max(1, Math.round(pos.qty * 0.33));
        const proceeds = trimQty * price * (1 - COST_RATE);
        cash += proceeds;
        pos.qty -= trimQty;
        trades.push({
          date, sym, type: 'TRIM_T1', qty: trimQty, price, amount: proceeds,
          reason: `Breached trailing stop floor ₹${chandelierFloor.toFixed(2)}`
        });
        pos.tranche1Done = true;
      }

      // Tranche 2 Exit: 30w-SMA structural breakdown
      const sma = sd.sma30w[wIdx];
      if (!isRecent && price <= sma && sma > 0 && pos.qty > 0) {
        const exitQty = pos.qty;
        const proceeds = exitQty * price * (1 - COST_RATE);
        cash += proceeds;
        trades.push({
          date, sym, type: 'SELL_FULL', qty: exitQty, price, amount: proceeds,
          reason: `Structural breakdown below 30w-SMA ₹${sma.toFixed(2)}`
        });
        pos.qty = 0;
        toDelete.push(sym);
      }
    }
    for (const sym of toDelete) positions.delete(sym);

    // 2. BUY EVALUATION & RANKED DEPLOYMENT
    const candidates = [];
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

      const fund = fundScores.get(sym) || { score: 50, grade: 'C', sector: 'Unknown' };
      const fundScore = fund.score;
      const compositeScore = Math.round((techScore + fundScore) / 2);
      const rsScore = sd.momentum126[dIdx];

      candidates.push({
        sym, price, techScore, fundScore, compositeScore, rsScore, stage, ema50, wIdx, dIdx
      });
    }

    if (mode === 'OPTIMIZED') {
      // Multibagger Probability Score (MPS): 50% Relative Strength + 50% Composite Score
      candidates.forEach(c => {
        // Normalize RS (0 to 100 scale, where 0% 6m return = 50 score, +50% = 75, +100% = 100)
        const normalizedRs = Math.max(0, Math.min(100, 50 + c.rsScore * 0.5));
        c.mps = Math.round(0.50 * normalizedRs + 0.50 * c.compositeScore);
      });

      // Sort by MPS descending: highest multibagger probability gets first cash deployment
      candidates.sort((a, b) => b.mps - a.mps);
    }

    // Deploy cash into candidates
    for (const cand of candidates) {
      if (cash <= 5000) break; // Cash exhausted for today

      const { sym, price, techScore, fundScore, compositeScore, stage, mps } = cand;

      // Sizing & Gating
      let alloc = 0;
      if (mode === 'OPTIMIZED') {
        if (mps >= 80) alloc = 200000;      // Prime Ultra: ₹2.0L
        else if (mps >= 70) alloc = 125000; // High Conviction: ₹1.25L
        else if (mps >= 60) alloc = 75000;  // Standard: ₹75k
        else if (mps >= 50) alloc = 40000;  // Turnaround Catalyst: ₹40k
        else continue;                      // Reject laggards (<50)
      } else {
        // Standard Current Logic
        if (techScore >= 65 && stage === 2) alloc = 100000;
        else if (techScore >= 55) alloc = 50000;
        else continue;
      }

      // Check dynamic position cap
      const maxCap = mode === 'OPTIMIZED'
        ? Math.max(150000, totalPortfolioValuation * 0.10) // Dynamic 10% portfolio weight cap
        : 200000; // Legacy 2.0L cap

      if (!positions.has(sym)) {
        const actualAlloc = Math.min(alloc, cash);
        if (actualAlloc < 20000) continue; // Minimum tranche size

        const buyQty = Math.max(1, Math.floor(actualAlloc / (price * (1 + COST_RATE))));
        const cost = buyQty * price * (1 + COST_RATE);
        if (cost > cash) continue;

        cash -= cost;
        positions.set(sym, {
          sym,
          qty: buyQty,
          avgPrice: price,
          peakPrice: price,
          buyDate: date,
          buyIdx: cand.dIdx,
          tranche1Done: false,
          totalInvested: cost,
          tranches: 1
        });

        if (!initialEntryScores.has(sym)) {
          initialEntryScores.set(sym, {
            sym,
            firstBuyDate: date,
            firstBuyPrice: price,
            techScore,
            fundScore,
            compositeScore,
            mps: mps || compositeScore
          });
        }

        trades.push({
          date, sym, type: 'BUY', qty: buyQty, price, amount: cost,
          signal: alloc >= 100000 ? 'STRONG_BUY' : 'BUY',
          reason: mode === 'OPTIMIZED'
            ? `MPS ${mps}/100 (RS + Fund + Tech), Stage ${stage} Bull`
            : `TechScore ${techScore}/100, Stage ${stage} Bull`
        });
      } else {
        // Pyramiding on confirmed pullback
        const pos = positions.get(sym);
        const sd = stockData[sym];
        const dist50 = Math.abs(price - cand.ema50) / cand.ema50 * 100;
        const ema21 = sd.ema21[cand.dIdx];
        const dist21 = Math.abs(price - ema21) / ema21 * 100;
        const isPullback = (dist50 <= 3.0 || dist21 <= 2.5) && price > pos.avgPrice;

        const currentVal = pos.qty * price;
        const remainingCap = Math.max(0, maxCap - currentVal);

        if (isPullback && remainingCap >= 20000 && pos.tranches < 3 && cand.dIdx - pos.buyIdx >= 10) {
          const pyramidTranche = mode === 'OPTIMIZED' && mps >= 75 ? 75000 : 50000;
          const actualAlloc = Math.min(pyramidTranche, cash, remainingCap);
          if (actualAlloc < 15000) continue;

          const addQty = Math.max(1, Math.floor(actualAlloc / (price * (1 + COST_RATE))));
          const addCost = addQty * price * (1 + COST_RATE);
          if (addCost > cash) continue;

          cash -= addCost;
          const newQty = pos.qty + addQty;
          pos.avgPrice = ((pos.avgPrice * pos.qty) + (price * addQty)) / newQty;
          pos.qty = newQty;
          pos.totalInvested += addCost;
          pos.tranches++;

          trades.push({
            date, sym, type: 'BUY_ADD', qty: addQty, price, amount: addCost,
            signal: 'PYRAMID_ADDITION',
            reason: `Pullback near 21/50-EMA support. Tranche #${pos.tranches}`
          });
        }
      }
    }

    // Record daily snapshot
    let endDayOpenVal = 0;
    for (const [sym, pos] of positions) {
      const p = getPriceAt(sym, date) || pos.avgPrice;
      endDayOpenVal += pos.qty * p;
    }
    const netWorth = cash + endDayOpenVal;

    dailyEquityCurve.push({
      date,
      cash,
      openVal: endDayOpenVal,
      netWorth,
      positionsCount: positions.size
    });
  }

  // Final Aggregation & P&L Statement
  const finalSnapshot = dailyEquityCurve[dailyEquityCurve.length - 1];
  const finalValuation = finalSnapshot.netWorth;
  const endingOpenHoldingsVal = finalSnapshot.openVal;
  const endingCashReserve = finalSnapshot.cash;

  const totalNetProfit = finalValuation - totalInfusedFromPocket;
  const roiOnInfusedCapital = (totalNetProfit / totalInfusedFromPocket) * 100;

  // Annualized CAGR (3.83 years)
  const years = 3.83;
  const cagr = (Math.pow(finalValuation / totalInfusedFromPocket, 1 / years) - 1) * 100;

  // Stock summary
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

  for (const [sym, pos] of positions) {
    const curP = getPriceAt(sym, END_DATE) || pos.avgPrice;
    if (stockSummary[sym]) {
      stockSummary[sym].heldQty = pos.qty;
      stockSummary[sym].currentPrice = curP;
      stockSummary[sym].openVal = pos.qty * curP;
    }
  }

  const stockRows = Object.values(stockSummary).map(s => {
    const openVal = s.openVal || 0;
    const netPnl = s.totalSoldAmt + openVal - s.totalBoughtAmt;
    const returnPct = s.totalBoughtAmt > 0 ? (netPnl / s.totalBoughtAmt) * 100 : 0;
    const scores = initialEntryScores.get(s.sym) || {};
    return {
      sym: s.sym,
      totalBoughtAmt: Math.round(s.totalBoughtAmt),
      totalSoldAmt: Math.round(s.totalSoldAmt),
      openVal: Math.round(openVal),
      heldQty: s.heldQty || 0,
      netPnl: Math.round(netPnl),
      returnPct: Number(returnPct.toFixed(1)),
      tradesCount: s.tradesCount,
      ...scores
    };
  }).sort((a, b) => b.netPnl - a.netPnl);

  const wins = stockRows.filter(r => r.netPnl > 0);
  const losses = stockRows.filter(r => r.netPnl < 0);
  const winRate = stockRows.length > 0 ? (wins.length / stockRows.length) * 100 : 0;
  const grossGains = wins.reduce((acc, r) => acc + r.netPnl, 0);
  const grossLosses = Math.abs(losses.reduce((acc, r) => acc + r.netPnl, 0));
  const profitFactor = grossLosses > 0 ? (grossGains / grossLosses) : grossGains;

  // Maximum Drawdown
  let peak = 0;
  let maxDd = 0;
  for (const snap of dailyEquityCurve) {
    if (snap.netWorth > peak) peak = snap.netWorth;
    const dd = ((snap.netWorth - peak) / peak) * 100;
    if (dd < maxDd) maxDd = dd;
  }

  return {
    mode,
    totalInfusedFromPocket,
    endingCashReserve,
    endingOpenHoldingsVal,
    finalValuation,
    totalNetProfit,
    roiOnInfusedCapital,
    cagr,
    maxDd,
    winRate,
    profitFactor,
    totalTrades: trades.length,
    totalStocksTraded: stockRows.length,
    activePositionsCount: positions.size,
    stockRows,
    dailyEquityCurve
  };
}

console.log('[Realistic Backtest] Simulating Strategy C (Current Production Logic)...');
const resCurrent = runRealisticPortfolioSimulation('CURRENT');

console.log('[Realistic Backtest] Simulating Strategy O (Optimized High-Alpha Multibagger Engine)...');
const resOptimized = runRealisticPortfolioSimulation('OPTIMIZED');

console.log('\n═════════════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('              REALISTIC CAPITAL BACKTEST: ₹45L INITIAL + ₹2L/MONTH (JAN 2023 → OCT 2026)');
console.log('═════════════════════════════════════════════════════════════════════════════════════════════════════════════');
console.log('Performance Metric               | Current Production Logic    | Optimized Multibagger Engine | Outperformance');
console.log('─────────────────────────────────┼─────────────────────────────┼──────────────────────────────┼────────────────');

function fmt(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }
function fmtL(n) { return '₹' + (n / 100000).toFixed(2) + ' Lakhs'; }
function fmtCr(n) { return '₹' + (n / 10000000).toFixed(2) + ' Crores'; }

console.log(`Total Capital Invested (Pocket)  | ${fmtL(resCurrent.totalInfusedFromPocket)} (${fmtCr(resCurrent.totalInfusedFromPocket)}) | ${fmtL(resOptimized.totalInfusedFromPocket)} (${fmtCr(resOptimized.totalInfusedFromPocket)}) | Exact Match`);
console.log(`Ending Cash Reserve (Liquid)     | ${fmtL(resCurrent.endingCashReserve)}              | ${fmtL(resOptimized.endingCashReserve)}              | ${fmtL(resOptimized.endingCashReserve - resCurrent.endingCashReserve)}`);
console.log(`Ending Open Holdings Value       | ${fmtL(resCurrent.endingOpenHoldingsVal)}            | ${fmtL(resOptimized.endingOpenHoldingsVal)}            | ${fmtL(resOptimized.endingOpenHoldingsVal - resCurrent.endingOpenHoldingsVal)}`);
console.log(`FINAL PORTFOLIO VALUATION        | ${fmtCr(resCurrent.finalValuation)} (${fmtL(resCurrent.finalValuation)}) | ${fmtCr(resOptimized.finalValuation)} (${fmtL(resOptimized.finalValuation)}) | +${fmtCr(resOptimized.finalValuation - resCurrent.finalValuation)}`);
console.log(`TOTAL NET STRATEGY PROFIT        | +${fmtCr(resCurrent.totalNetProfit)} (+${fmtL(resCurrent.totalNetProfit)}) | +${fmtCr(resOptimized.totalNetProfit)} (+${fmtL(resOptimized.totalNetProfit)}) | +${fmtL(resOptimized.totalNetProfit - resCurrent.totalNetProfit)} Profit`);
console.log(`Absolute Return on Invested Cash | +${resCurrent.roiOnInfusedCapital.toFixed(2)}%                     | +${resOptimized.roiOnInfusedCapital.toFixed(2)}%                     | +${(resOptimized.roiOnInfusedCapital - resCurrent.roiOnInfusedCapital).toFixed(2)}% ROI`);
console.log(`ANNUALIZED CAGR (3.83 Years)     | ${resCurrent.cagr.toFixed(2)}%                       | ${resOptimized.cagr.toFixed(2)}%                       | +${(resOptimized.cagr - resCurrent.cagr).toFixed(2)}% Alpha`);
console.log(`Maximum Portfolio Drawdown       | ${resCurrent.maxDd.toFixed(2)}%                      | ${resOptimized.maxDd.toFixed(2)}%                      | ${(resCurrent.maxDd - resOptimized.maxDd).toFixed(2)}% Buffer`);
console.log(`Strategy Win Rate                | ${resCurrent.winRate.toFixed(1)}%                      | ${resOptimized.winRate.toFixed(1)}%                      | ${(resOptimized.winRate - resCurrent.winRate).toFixed(1)}%`);
console.log(`Profit Factor                    | ${resCurrent.profitFactor.toFixed(2)}x                        | ${resOptimized.profitFactor.toFixed(2)}x                        | +${(resOptimized.profitFactor - resCurrent.profitFactor).toFixed(2)}x`);
console.log(`Total Trades Executed            | ${resCurrent.totalTrades} trades                 | ${resOptimized.totalTrades} trades                 | ${resCurrent.totalTrades - resOptimized.totalTrades} fewer trades`);
console.log(`Active Open Positions (Today)    | ${resCurrent.activePositionsCount} stocks                  | ${resOptimized.activePositionsCount} stocks                   | Focused concentration`);
console.log('═════════════════════════════════════════════════════════════════════════════════════════════════════════════');

console.log('\nTop 10 Multibaggers in Optimized Engine:');
resOptimized.stockRows.slice(0, 10).forEach((s, idx) => {
  console.log(`${idx + 1}. ${s.sym}: Bought ${fmt(s.totalBoughtAmt)}, Sold ${fmt(s.totalSoldAmt)}, Open ${fmt(s.openVal)}, Net Profit ${fmt(s.netPnl)} (+${s.returnPct}%)`);
});
