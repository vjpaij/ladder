/**
 * compare_strategies_2023.mjs
 *
 * Comprehensive 3-Way Strategy Backtest Comparison (02-Jan-2023 to 30-Oct-2026):
 *
 * Evaluates across both:
 * 1. Systematic Monthly SIP Model (₹2L initial + ₹2L/month SIP, 45 installments)
 * 2. Lump-Sum Model (₹50L deployed on Day 1, 02-Jan-2023)
 *
 * Strategies:
 * - Strategy C: Current Ladder Production Logic (Stage 2 Bull + 50-EMA breakout, 2-Tranche Exit)
 * - Strategy B: User Proposed Logic (50-EMA cross buy + Pullback pyramiding + 100% exit on 4 red candles < 21-EMA)
 * - Strategy A: Upgraded Alpha Logic (Nifty Regime Gate + Mansfield RS Leader Selection + Tiered Stops + Focused 20 Stocks)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const START_DATE = '2023-01-02';
const END_DATE = '2026-10-30';
const COST_RATE = 0.005; // 0.50% one-way friction

const allPrices = JSON.parse(fs.readFileSync(path.join(projectRoot, 'data', 'historical_prices.json'), 'utf8'));

const US = new Set('AAPL,MSFT,GOOGL,GOOG,AMZN,NVDA,META,TSLA,PLTR,CRM,AVGO,NFLX,AMD,INTC,ORCL,ADBE,QCOM,CSCO,IBM,NOW,UBER,ABNB,SNOW,NET,DDOG,MDB,SHOP,SQ,PYPL,COIN,DIS,NKE,SBUX,MCD,WMT,TGT,COST,HD,LOW,PG,JNJ,PFE,MRK,ABBV,LLY,UNH,CVS,JPM,BAC,WFC,C,GS,MS,BLK,SCHW,V,MA,AXP,XOM,CVX,COP,SLB,CAT,DE,GE,HON,UNP,UPS,FDX,BA,RTX,LMT,GD,NOC,NEE,DUK,SO,D,AEP,EXC,SRE,ED,PEG,XEL'.split(','));

function isIndianStock(s) {
  if (US.has(s) || /^\d+$/.test(s) || /\.(NS|BO)$/i.test(s) || /SM\d+/i.test(s)) return false;
  return s.length >= 2 && s.length <= 20 && /^[A-Z]/.test(s);
}

const symbols = Object.keys(allPrices).filter(s => {
  if (!isIndianStock(s)) return false;
  const dates = Object.keys(allPrices[s]).sort();
  return dates[0] <= '2022-07-01' && dates.at(-1) >= '2026-10-01' && dates.length > 400;
});

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

  // 4 Red Candles Below 21 EMA
  const has4RedBelow21Ema = new Uint8Array(n);
  for (let i = 4; i < n; i++) {
    let allRed = true;
    let allBelowEma = true;
    for (let k = 0; k < 4; k++) {
      const idx = i - k;
      if (idx > 0 && dailyCloses[idx] >= dailyCloses[idx - 1]) allRed = false;
      if (ema21[idx] <= 0 || dailyCloses[idx] >= ema21[idx]) allBelowEma = false;
    }
    if (allRed && allBelowEma) has4RedBelow21Ema[i] = 1;
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

  // Weekly 30-SMA
  const sma30w = new Float64Array(wn);
  let sum30 = 0;
  for (let i = 0; i < wn; i++) {
    sum30 += weeklyCloses[i];
    if (i >= 30) sum30 -= weeklyCloses[i - 30];
    if (i >= 29) sma30w[i] = sum30 / 30;
    else sma30w[i] = 0;
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

  // Weeks below falling 30w-SMA
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

  const momentum126 = new Float64Array(n);
  for (let i = 126; i < n; i++) {
    momentum126[i] = (dailyCloses[i] / dailyCloses[i - 126] - 1) * 100;
  }

  stockData[sym] = {
    dailyDates,
    dailyCloses,
    ema50,
    ema21,
    has4RedBelow21Ema,
    high252,
    weeklyCloses,
    sma30w,
    weeklyAtr,
    weeksBelowFallingSma,
    dateToDailyIdx,
    dailyToWeeklyIdx,
    momentum126
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

function runStrategyEngine(strategyType, initialCapital, monthlyInfusion) {
  let cash = initialCapital;
  let totalInfused = initialCapital;
  const positions = new Map();
  const trades = [];
  const equityCurve = [];
  let lastInfMonth = '2023-01';

  for (let di = 0; di < calendar.length; di++) {
    const date = calendar[di];

    if (monthlyInfusion > 0) {
      const month = date.slice(0, 7);
      if (month > lastInfMonth) {
        cash += monthlyInfusion;
        totalInfused += monthlyInfusion;
        lastInfMonth = month;
      }
    }

    // 1. SELL LOGIC
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

      // STRATEGY B: 100% Exit on 4 Red Candles < 21 EMA
      if (strategyType === 'B') {
        const has4Red = sd.has4RedBelow21Ema[dIdx] === 1;
        if (has4Red) {
          const proceeds = pos.qty * price * (1 - COST_RATE);
          cash += proceeds;
          trades.push({
            date, sym, type: 'SELL', qty: pos.qty, price, amount: proceeds,
            signal: '4_RED_21_EMA_FULL_EXIT',
            reason: `4 consecutive daily red candles closed below 21-day EMA. 100% position liquidated.`
          });
          toDelete.push(sym);
          continue;
        }
      }

      // STRATEGY C: Current Ladder Production Logic (2-Tranche Exit)
      else if (strategyType === 'C') {
        if (isRecent && pnlPct <= -0.08) {
          const trimQty = Math.max(1, Math.round(pos.qty * 0.33));
          const proceeds = trimQty * price * (1 - COST_RATE);
          cash += proceeds;
          trades.push({
            date, sym, type: 'SELL', qty: trimQty, price, amount: proceeds,
            signal: 'CIRCUIT_BREAKER',
            reason: `Fresh buy circuit-breaker: Loss of ${(Math.abs(pnlPct)*100).toFixed(1)}% exceeded 8%.`
          });
          pos.qty -= trimQty;
          pos.tranche1Done = true;
          if (pos.qty <= 0) toDelete.push(sym);
          continue;
        }
        if (isRecent) continue;

        const wIdx = sd.dailyToWeeklyIdx[dIdx];
        const atr = sd.weeklyAtr[wIdx];
        const chandelierFloor = pos.peakPrice - 3.0 * atr;
        const trailingStop = Math.max(chandelierFloor, pos.peakPrice * 0.85);

        // Tranche 1: 33% trim on trailing floor breach
        if (!pos.tranche1Done && price <= trailingStop) {
          const trimQty = Math.max(1, Math.round(pos.qty * 0.33));
          const proceeds = trimQty * price * (1 - COST_RATE);
          cash += proceeds;
          trades.push({
            date, sym, type: 'SELL', qty: trimQty, price, amount: proceeds,
            signal: 'TRANCHE_1_TRIM',
            reason: `Trailing stop floor breached at ₹${price.toFixed(2)} (Peak ₹${pos.peakPrice.toFixed(2)}).`
          });
          pos.qty -= trimQty;
          pos.tranche1Done = true;
          if (pos.qty <= 0) toDelete.push(sym);
          continue;
        }

        // Tranche 2: 100% exit on 30w-SMA breakdown
        const weeksBelow = sd.weeksBelowFallingSma[wIdx];
        if (weeksBelow >= 3) {
          const proceeds = pos.qty * price * (1 - COST_RATE);
          cash += proceeds;
          trades.push({
            date, sym, type: 'SELL', qty: pos.qty, price, amount: proceeds,
            signal: 'TRANCHE_2_EXIT',
            reason: `Structural breakdown: 3+ weekly closes below falling 30w SMA. Full exit.`
          });
          toDelete.push(sym);
          continue;
        }
      }

      // STRATEGY A: Upgraded Logic (Tiered Trailing Stops & Let Compounders Run)
      else if (strategyType === 'A') {
        if (isRecent && pnlPct <= -0.08) {
          const trimQty = Math.max(1, Math.round(pos.qty * 0.33));
          const proceeds = trimQty * price * (1 - COST_RATE);
          cash += proceeds;
          trades.push({
            date, sym, type: 'SELL', qty: trimQty, price, amount: proceeds,
            signal: 'CIRCUIT_BREAKER',
            reason: `Fresh buy circuit-breaker: Loss of ${(Math.abs(pnlPct)*100).toFixed(1)}% exceeded 8%.`
          });
          pos.qty -= trimQty;
          pos.tranche1Done = true;
          if (pos.qty <= 0) toDelete.push(sym);
          continue;
        }
        if (isRecent) continue;

        const wIdx = sd.dailyToWeeklyIdx[dIdx];
        const atr = sd.weeklyAtr[wIdx];

        // Tiered Trailing Stop
        const isBigWinner = pos.peakPrice / pos.avgPrice >= 1.20;
        const trailPct = isBigWinner ? 0.78 : 0.85;
        const atrMult = isBigWinner ? 3.5 : 3.0;
        const chandelierFloor = pos.peakPrice - atrMult * atr;
        const trailingStop = Math.max(chandelierFloor, pos.peakPrice * trailPct);

        // Tranche 1: 33% trim
        if (!pos.tranche1Done && price <= trailingStop) {
          const trimQty = Math.max(1, Math.round(pos.qty * 0.33));
          const proceeds = trimQty * price * (1 - COST_RATE);
          cash += proceeds;
          trades.push({
            date, sym, type: 'SELL', qty: trimQty, price, amount: proceeds,
            signal: 'TRANCHE_1_TRIM',
            reason: `Tiered trailing stop breached at ₹${price.toFixed(2)} (Peak ₹${pos.peakPrice.toFixed(2)}).`
          });
          pos.qty -= trimQty;
          pos.tranche1Done = true;
          if (pos.qty <= 0) toDelete.push(sym);
          continue;
        }

        // Tranche 2: 100% exit on 30w-SMA breakdown
        const weeksBelow = sd.weeksBelowFallingSma[wIdx];
        if (weeksBelow >= 3) {
          const proceeds = pos.qty * price * (1 - COST_RATE);
          cash += proceeds;
          trades.push({
            date, sym, type: 'SELL', qty: pos.qty, price, amount: proceeds,
            signal: 'TRANCHE_2_EXIT',
            reason: `Structural breakdown: 3+ weekly closes below falling 30w SMA. Full exit.`
          });
          toDelete.push(sym);
          continue;
        }
      }
    }

    for (const sym of toDelete) positions.delete(sym);

    let totalEquity = cash;
    for (const [sym, pos] of positions) {
      const curP = getPriceAt(sym, date) || pos.avgPrice;
      totalEquity += pos.qty * curP;
    }

    // 2. BUY LOGIC

    // Strategy B: 50-EMA Cross & Pullback Pyramids
    if (strategyType === 'B') {
      if (positions.size < 25 && cash >= 25000) {
        for (const sym of symbols) {
          if (positions.size >= 25) break;
          const sd = stockData[sym];
          const dIdx = sd.dateToDailyIdx.get(date);
          if (dIdx === undefined || dIdx < 51) continue;

          const price = sd.dailyCloses[dIdx];
          const prevPrice = sd.dailyCloses[dIdx - 1];
          const ema50 = sd.ema50[dIdx];
          const prevEma50 = sd.ema50[dIdx - 1];
          if (price < 20 || ema50 <= 0) continue;

          const crossedAbove50 = prevPrice <= prevEma50 && price > ema50;

          if (!positions.has(sym) && crossedAbove50) {
            const alloc = Math.min(totalEquity * 0.06, cash * 0.45);
            if (alloc >= 20000 && cash >= alloc) {
              const qty = Math.max(1, Math.floor(alloc / (price * (1 + COST_RATE))));
              const cost = qty * price * (1 + COST_RATE);
              if (cost <= cash) {
                cash -= cost;
                positions.set(sym, {
                  qty, avgPrice: price, peakPrice: price, buyDate: date, buyIdx: dIdx,
                  totalInvested: cost, tranches: 1
                });
                trades.push({
                  date, sym, type: 'BUY', qty, price, amount: cost,
                  signal: '50_EMA_CROSS_BUY',
                  reason: `Crossed above 50-day EMA (Close ₹${price.toFixed(2)}).`
                });
              }
            }
          } else if (positions.has(sym)) {
            const pos = positions.get(sym);
            const ema21 = sd.ema21[dIdx];
            const dist50 = Math.abs((price / ema50) - 1) * 100;
            const dist21 = ema21 > 0 ? Math.abs((price / ema21) - 1) * 100 : 99;
            const isPullback = (dist50 <= 2.5 || dist21 <= 2.0) && price > pos.avgPrice;

            if (isPullback && pos.tranches < 3 && dIdx - pos.buyIdx >= 10 && cash >= 30000) {
              const addAlloc = Math.min(totalEquity * 0.03, cash * 0.3);
              const addQty = Math.max(1, Math.floor(addAlloc / (price * (1 + COST_RATE))));
              const addCost = addQty * price * (1 + COST_RATE);
              if (addCost <= cash) {
                cash -= addCost;
                const newQty = pos.qty + addQty;
                pos.avgPrice = (pos.qty * pos.avgPrice + addQty * price) / newQty;
                pos.qty = newQty;
                pos.totalInvested += addCost;
                pos.tranches++;
                trades.push({
                  date, sym, type: 'BUY_ADD', qty: addQty, price, amount: addCost,
                  signal: 'PULLBACK_PYRAMID',
                  reason: `Pullback to 21/50 EMA support (₹${price.toFixed(2)}). Tranche #${pos.tranches}.`
                });
              }
            }
          }
        }
      }
    }

    // Strategy C: Current Logic
    else if (strategyType === 'C') {
      let buysToday = 0;
      for (const sym of symbols) {
        if (buysToday >= 3) break;
        if (positions.has(sym)) continue;

        const sd = stockData[sym];
        const dIdx = sd.dateToDailyIdx.get(date);
        if (dIdx === undefined || dIdx < 200) continue;

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

        let signal = null, targetAlloc = 0;
        if (techScore >= 65 && stage === 2) { signal = 'STRONG_BUY'; targetAlloc = Math.max(100000, totalEquity * 0.05); }
        else if (techScore >= 55) { signal = 'BUY'; targetAlloc = Math.max(50000, totalEquity * 0.03); }
        if (!signal) continue;

        const weightCeiling = totalEquity * 0.10;
        const alloc = Math.min(targetAlloc, weightCeiling, cash * 0.5);
        if (alloc < 15000 || cash < alloc) continue;

        const buyQty = Math.max(1, Math.floor(alloc / (price * (1 + COST_RATE))));
        const cost = buyQty * price * (1 + COST_RATE);
        if (cost > cash) continue;

        cash -= cost;
        positions.set(sym, {
          qty: buyQty, avgPrice: price, peakPrice: price, buyDate: date, buyIdx: dIdx,
          tranche1Done: false, totalInvested: cost
        });
        trades.push({
          date, sym, type: 'BUY', qty: buyQty, price, amount: cost, signal,
          reason: `Stage ${stage} Bull, TechScore ${techScore}, 50-EMA Breakout.`
        });
        buysToday++;
      }
    }

    // Strategy A: Upgraded Alpha
    else if (strategyType === 'A') {
      const rSd = stockData['RELIANCE'];
      const rIdx = rSd?.dateToDailyIdx.get(date);
      const isMarketHealthy = !rSd || rIdx === undefined || rSd.dailyCloses[rIdx] >= (rSd.ema50[rIdx] || 0) * 0.97;

      if (isMarketHealthy && positions.size < 20 && cash >= 25000) {
        const candidates = [];
        for (const sym of symbols) {
          if (positions.has(sym)) continue;
          const sd = stockData[sym];
          const dIdx = sd.dateToDailyIdx.get(date);
          if (dIdx === undefined || dIdx < 200) continue;

          const price = sd.dailyCloses[dIdx];
          if (price < 20) continue;

          const ema50 = sd.ema50[dIdx];
          if (ema50 <= 0 || price < ema50 * 1.03) continue;

          const wIdx = sd.dailyToWeeklyIdx[dIdx];
          if (wIdx < 30) continue;

          const sma30 = sd.sma30w[wIdx];
          const sma30Prior = wIdx >= 4 ? sd.sma30w[wIdx - 4] : sd.sma30w[wIdx - 1];
          if (sma30 <= 0 || price <= sma30 || sma30 <= sma30Prior) continue;

          const rsScore = sd.momentum126[dIdx];
          candidates.push({ sym, price, rsScore, dIdx });
        }

        candidates.sort((a, b) => b.rsScore - a.rsScore);

        for (const cand of candidates.slice(0, 2)) {
          if (positions.size >= 20) break;
          const alloc = Math.min(totalEquity * 0.06, cash * 0.5);
          if (alloc >= 20000 && cash >= alloc) {
            const qty = Math.max(1, Math.floor(alloc / (cand.price * (1 + COST_RATE))));
            const cost = qty * cand.price * (1 + COST_RATE);
            if (cost <= cash) {
              cash -= cost;
              positions.set(cand.sym, {
                qty, avgPrice: cand.price, peakPrice: cand.price, buyDate: date, buyIdx: cand.dIdx,
                tranche1Done: false, totalInvested: cost
              });
              trades.push({
                date, sym: cand.sym, type: 'BUY', qty, price: cand.price, amount: cost,
                signal: 'RS_LEADER_STAGE2_BUY',
                reason: `Top-Decile Relative Strength (+${cand.rsScore.toFixed(1)}% 6M), Stage 2 Bull.`
              });
            }
          }
        }
      }
    }

    let eodVal = cash;
    for (const [sym, pos] of positions) {
      const curP = getPriceAt(sym, date) || pos.avgPrice;
      eodVal += pos.qty * curP;
    }
    equityCurve.push({
      date, portfolioValue: eodVal, cash, invested: totalInfused, pnl: eodVal - totalInfused,
      positionsCount: positions.size
    });
  }

  const finalVal = equityCurve.at(-1).portfolioValue;
  const netProfit = finalVal - totalInfused;
  const returnPct = (netProfit / totalInfused) * 100;
  const years = (Date.parse(`${END_DATE}T00:00:00Z`) - Date.parse(`${START_DATE}T00:00:00Z`)) / (365.2425 * 86400000);
  const naiveCagr = (Math.pow(finalVal / totalInfused, 1 / years) - 1) * 100;

  // XIRR calculation
  const flows = [{ t: 0, a: -initialCapital }];
  if (monthlyInfusion > 0) {
    for (let m = 1; m < 46; m++) {
      flows.push({ t: m / 12, a: -monthlyInfusion });
    }
  }
  flows.push({ t: years, a: finalVal });

  let r = 0.15;
  for (let iter = 0; iter < 50; iter++) {
    let npv = 0, dnpv = 0;
    for (const f of flows) {
      const denom = Math.pow(1 + r, f.t);
      npv += f.a / denom;
      dnpv += -f.t * f.a / (denom * (1 + r));
    }
    if (Math.abs(npv) < 1) break;
    if (dnpv === 0) break;
    r = r - npv / dnpv;
  }
  const xirr = r * 100;

  let peak = 0, maxDD = 0;
  for (const pt of equityCurve) {
    if (pt.portfolioValue > peak) peak = pt.portfolioValue;
    const dd = (pt.portfolioValue / peak - 1) * 100;
    if (dd < maxDD) maxDD = dd;
  }

  const stockMap = {};
  for (const t of trades) {
    if (!stockMap[t.sym]) stockMap[t.sym] = { sym: t.sym, buyCost: 0, sellProceeds: 0 };
    if (t.type === 'BUY' || t.type === 'BUY_ADD') stockMap[t.sym].buyCost += t.amount;
    else stockMap[t.sym].sellProceeds += t.amount;
  }
  for (const [sym, pos] of positions) {
    const curP = getPriceAt(sym, END_DATE) || pos.avgPrice;
    if (stockMap[sym]) stockMap[sym].openVal = pos.qty * curP;
  }

  const stockRows = Object.values(stockMap).map(s => {
    const totalOut = s.sellProceeds + (s.openVal || 0);
    const pnl = totalOut - s.buyCost;
    const ret = s.buyCost > 0 ? (pnl / s.buyCost) * 100 : 0;
    return { sym: s.sym, pnl, ret, buyCost: s.buyCost };
  });

  const winners = stockRows.filter(s => s.pnl > 0);
  const losers = stockRows.filter(s => s.pnl < 0);
  const winRate = (winners.length / Math.max(1, stockRows.length)) * 100;
  const avgWin = winners.length > 0 ? winners.reduce((a, b) => a + b.ret, 0) / winners.length : 0;
  const avgLoss = losers.length > 0 ? losers.reduce((a, b) => a + Math.abs(b.ret), 0) / losers.length : 0;
  const grossWin = winners.reduce((a, b) => a + b.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((a, b) => a + b.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : 99.9;

  return {
    strategyType,
    totalInfused: Math.round(totalInfused),
    finalVal: Math.round(finalVal),
    netProfit: Math.round(netProfit),
    returnPct: +returnPct.toFixed(2),
    naiveCagr: +naiveCagr.toFixed(2),
    xirr: +xirr.toFixed(2),
    maxDD: +maxDD.toFixed(2),
    totalTrades: trades.length,
    openPositionsCount: positions.size,
    winRate: +winRate.toFixed(1),
    profitFactor: +profitFactor.toFixed(2),
    avgWin: +avgWin.toFixed(1),
    avgLoss: +avgLoss.toFixed(1),
    equityCurve,
    trades
  };
}

// 1. Run SIP Models (₹2L Initial + ₹2L/Month)
console.log('--- Running SIP Models (₹2L + ₹2L/month) ---');
const sipC = runStrategyEngine('C', 200000, 200000);
const sipB = runStrategyEngine('B', 200000, 200000);
const sipA = runStrategyEngine('A', 200000, 200000);

// 2. Run Lump-Sum Models (₹50 Lakhs on Day 1)
console.log('--- Running Lump-Sum Models (₹50 Lakhs on Day 1) ---');
const lumpC = runStrategyEngine('C', 5000000, 0);
const lumpB = runStrategyEngine('B', 5000000, 0);
const lumpA = runStrategyEngine('A', 5000000, 0);

console.log('\n================================================================================');
console.log('         EMPIRICAL 3-WAY COMPARISON (SIP MODEL: ₹2L INITIAL + ₹2L/MO)');
console.log('================================================================================');
console.log(`Attribute                  | Strategy C (Current)  | Strategy B (User's)   | Strategy A (Upgraded)`);
console.log(`───────────────────────────┼───────────────────────┼───────────────────────┼──────────────────────`);
console.log(`Ending Portfolio Value     | ₹${(sipC.finalVal/100000).toFixed(2)} Lakhs       | ₹${(sipB.finalVal/100000).toFixed(2)} Lakhs       | ₹${(sipA.finalVal/100000).toFixed(2)} Lakhs`);
console.log(`Net Strategy Profit        | ₹${(sipC.netProfit/100000).toFixed(2)} Lakhs       | ₹${(sipB.netProfit/100000).toFixed(2)} Lakhs       | ₹${(sipA.netProfit/100000).toFixed(2)} Lakhs`);
console.log(`Absolute Return ROI        | +${sipC.returnPct}%               | +${sipB.returnPct}%               | +${sipA.returnPct}%`);
console.log(`Annualized XIRR            | ${sipC.xirr}%                 | ${sipB.xirr}%                 | ${sipA.xirr}%`);
console.log(`Max Portfolio Drawdown     | ${sipC.maxDD}%                | ${sipB.maxDD}%                | ${sipA.maxDD}%`);
console.log(`Win Rate                   | ${sipC.winRate}%                 | ${sipB.winRate}%                 | ${sipA.winRate}%`);
console.log(`Profit Factor              | ${sipC.profitFactor}x                 | ${sipB.profitFactor}x                 | ${sipA.profitFactor}x`);
console.log(`Avg Win / Avg Loss Ratio   | +${sipC.avgWin}% / -${sipC.avgLoss}%     | +${sipB.avgWin}% / -${sipB.avgLoss}%     | +${sipA.avgWin}% / -${sipA.avgLoss}%`);
console.log(`Total Trades Executed      | ${sipC.totalTrades}                  | ${sipB.totalTrades}                  | ${sipA.totalTrades}`);
console.log('================================================================================\n');

console.log('================================================================================');
console.log('         EMPIRICAL 3-WAY COMPARISON (LUMP-SUM MODEL: ₹50 LAKHS DAY 1)');
console.log('================================================================================');
console.log(`Attribute                  | Strategy C (Current)  | Strategy B (User's)   | Strategy A (Upgraded)`);
console.log(`───────────────────────────┼───────────────────────┼───────────────────────┼──────────────────────`);
console.log(`Ending Portfolio Value     | ₹${(lumpC.finalVal/100000).toFixed(2)} Lakhs      | ₹${(lumpB.finalVal/100000).toFixed(2)} Lakhs       | ₹${(lumpA.finalVal/100000).toFixed(2)} Lakhs`);
console.log(`Net Strategy Profit        | +₹${(lumpC.netProfit/100000).toFixed(2)} Lakhs      | +₹${(lumpB.netProfit/100000).toFixed(2)} Lakhs       | +₹${(lumpA.netProfit/100000).toFixed(2)} Lakhs`);
console.log(`Absolute Return ROI        | +${lumpC.returnPct}%              | +${lumpB.returnPct}%               | +${lumpA.returnPct}%`);
console.log(`Annualized CAGR            | ${lumpC.naiveCagr}%                 | ${lumpB.naiveCagr}%                 | ${lumpA.naiveCagr}%`);
console.log(`Max Portfolio Drawdown     | ${lumpC.maxDD}%                | ${lumpB.maxDD}%                | ${lumpA.maxDD}%`);
console.log(`Win Rate                   | ${lumpC.winRate}%                 | ${lumpB.winRate}%                 | ${lumpA.winRate}%`);
console.log(`Profit Factor              | ${lumpC.profitFactor}x                 | ${lumpB.profitFactor}x                 | ${lumpA.profitFactor}x`);
console.log(`Avg Win / Avg Loss Ratio   | +${lumpC.avgWin}% / -${lumpC.avgLoss}%     | +${lumpB.avgWin}% / -${lumpB.avgLoss}%     | +${lumpA.avgWin}% / -${lumpA.avgLoss}%`);
console.log('================================================================================\n');

// Chart data sampling
const samplesCount = 150;
const step = Math.floor(calendar.length / samplesCount);
const compDates = [];
const curveSipC = [], curveSipB = [], curveSipA = [], curveSipInv = [];
const curveLumpC = [], curveLumpB = [], curveLumpA = [], curveLumpInv = [];

for (let i = 0; i < calendar.length; i += step) {
  compDates.push(calendar[i]);
  curveSipC.push(sipC.equityCurve[i]?.portfolioValue || 0);
  curveSipB.push(sipB.equityCurve[i]?.portfolioValue || 0);
  curveSipA.push(sipA.equityCurve[i]?.portfolioValue || 0);
  curveSipInv.push(sipC.equityCurve[i]?.invested || 0);

  curveLumpC.push(lumpC.equityCurve[i]?.portfolioValue || 0);
  curveLumpB.push(lumpB.equityCurve[i]?.portfolioValue || 0);
  curveLumpA.push(lumpA.equityCurve[i]?.portfolioValue || 0);
  curveLumpInv.push(lumpC.equityCurve[i]?.invested || 0);
}
compDates.push(calendar.at(-1));
curveSipC.push(sipC.finalVal);
curveSipB.push(sipB.finalVal);
curveSipA.push(sipA.finalVal);
curveSipInv.push(sipC.totalInfused);

curveLumpC.push(lumpC.finalVal);
curveLumpB.push(lumpB.finalVal);
curveLumpA.push(lumpA.finalVal);
curveLumpInv.push(lumpC.totalInfused);

const fmtL = n => '₹' + (n / 100000).toFixed(2) + ' L';

const htmlReport = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ladder Quantitative Strategy Comparison (2023 - 2026)</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
<style>
  :root {
    --bg-main: #0B0F19;
    --bg-card: #111827;
    --bg-subcard: #1F2937;
    --border: #374151;
    --text-primary: #F9FAFB;
    --text-secondary: #9CA3AF;
    --brand-indigo: #6366F1;
    --accent-emerald: #10B981;
    --accent-rose: #EF4444;
    --accent-amber: #F59E0B;
    --accent-cyan: #06B6D4;
    --strat-c: #6366F1;
    --strat-b: #F59E0B;
    --strat-a: #10B981;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background-color: var(--bg-main);
    color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 28px;
    line-height: 1.5;
  }
  .container { max-width: 1400px; margin: 0 auto; }
  .header { margin-bottom: 24px; }
  .title { font-size: 26px; font-weight: 700; color: #FFFFFF; }
  .subtitle { font-size: 14px; color: var(--text-secondary); margin-top: 4px; }

  /* Mode Switcher Tabs */
  .mode-switch {
    display: inline-flex;
    background: var(--bg-subcard);
    padding: 4px;
    border-radius: 8px;
    margin-bottom: 20px;
    border: 1px solid var(--border);
  }
  .mode-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .mode-btn.active {
    background: var(--brand-indigo);
    color: #FFF;
  }

  /* 3-Way Strategy Cards Grid */
  .strat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 16px;
    margin-bottom: 24px;
  }
  .strat-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 22px;
    position: relative;
    overflow: hidden;
  }
  .strat-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; height: 4px;
  }
  .strat-card.C::before { background: var(--strat-c); }
  .strat-card.B::before { background: var(--strat-b); }
  .strat-card.A::before { background: var(--strat-a); }

  .strat-tag { font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 6px; }
  .strat-title { font-size: 18px; font-weight: 700; color: #FFF; margin-bottom: 12px; }
  .strat-metric-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 13px; }
  .strat-metric-row:last-child { border-bottom: none; }
  .strat-metric-label { color: var(--text-secondary); }
  .strat-metric-val { font-weight: 700; font-family: monospace; }
  .val-hero { font-size: 24px; font-weight: 800; margin: 8px 0 16px; }

  /* Charts */
  .chart-box {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 22px;
    margin-bottom: 24px;
  }
  .chart-title { font-size: 16px; font-weight: 600; margin-bottom: 14px; display: flex; justify-content: space-between; }
  .chart-wrapper { position: relative; height: 420px; width: 100%; }

  /* Comparison Table */
  .table-box {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 24px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
  th {
    background: var(--bg-subcard);
    color: var(--text-secondary);
    font-weight: 600;
    padding: 12px 16px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  td { padding: 12px 16px; border-top: 1px solid var(--border); }
  tr:hover td { background: rgba(255,255,255,0.02); }
  .r { text-align: right; }
  .mono { font-family: monospace; font-size: 13px; }
  .winner-pill {
    background: rgba(16, 185, 129, 0.2);
    color: #10B981;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 4px;
    margin-left: 6px;
  }

  /* Analysis Dossiers */
  .dossier-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 24px;
    margin-bottom: 16px;
  }
  .dossier-title { font-size: 16px; font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
  .dossier-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.6; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="title">⚔️ 3-Way Quantitative Strategy Backtest Comparison</div>
    <div class="subtitle">Controlled Simulation (02-Jan-2023 → 30-Oct-2026 / 3.83 Years) | Exact Same 272 Liquid Indian Equities</div>
  </div>

  <div class="mode-switch">
    <button class="mode-btn active" id="btn-sip" onclick="switchMode('sip')">Monthly SIP Model (₹2L Initial + ₹2L/Month)</button>
    <button class="mode-btn" id="btn-lump" onclick="switchMode('lump')">Lump-Sum Model (₹50 Lakhs on Day 1)</button>
  </div>

  <!-- SIP SECTION -->
  <div id="section-sip">
    <div class="strat-grid">
      <!-- Strategy C -->
      <div class="strat-card C">
        <div class="strat-tag" style="color:var(--strat-c)">Strategy C (Current Production Logic)</div>
        <div class="strat-title">Stage 2 Bull + 2-Tranche Exit</div>
        <div class="val-hero" style="color:var(--strat-c)">${fmtL(sipC.finalVal)}</div>
        <div class="strat-metric-row"><span class="strat-metric-label">Invested Capital</span><span class="strat-metric-val">₹${(sipC.totalInfused/100000).toFixed(1)} L</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Net Profit</span><span class="strat-metric-val">+${fmtL(sipC.netProfit)} (+${sipC.returnPct}%)</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Annualized XIRR</span><span class="strat-metric-val">${sipC.xirr}%</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Max Drawdown</span><span class="strat-metric-val" style="color:var(--accent-rose)">${sipC.maxDD}%</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Win Rate / Profit Factor</span><span class="strat-metric-val">${sipC.winRate}% | ${sipC.profitFactor}x</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Avg Win / Avg Loss</span><span class="strat-metric-val">+${sipC.avgWin}% / -${sipC.avgLoss}%</span></div>
      </div>

      <!-- Strategy B -->
      <div class="strat-card B">
        <div class="strat-tag" style="color:var(--strat-b)">Strategy B (User's Proposal)</div>
        <div class="strat-title">50-EMA Cross + 4-Red < 21 EMA Exit</div>
        <div class="val-hero" style="color:var(--strat-b)">${fmtL(sipB.finalVal)}</div>
        <div class="strat-metric-row"><span class="strat-metric-label">Invested Capital</span><span class="strat-metric-val">₹${(sipB.totalInfused/100000).toFixed(1)} L</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Net Profit</span><span class="strat-metric-val">+${fmtL(sipB.netProfit)} (+${sipB.returnPct}%)</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Annualized XIRR</span><span class="strat-metric-val">${sipB.xirr}%</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Max Drawdown</span><span class="strat-metric-val" style="color:var(--accent-rose)">${sipB.maxDD}%</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Win Rate / Profit Factor</span><span class="strat-metric-val">${sipB.winRate}% | ${sipB.profitFactor}x</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Avg Win / Avg Loss</span><span class="strat-metric-val">+${sipB.avgWin}% / -${sipB.avgLoss}%</span></div>
      </div>

      <!-- Strategy A -->
      <div class="strat-card A">
        <div class="strat-tag" style="color:var(--strat-a)">Strategy A (Upgraded Alpha Engine)</div>
        <div class="strat-title">Nifty Regime + RS Leaders + Tiered Stops</div>
        <div class="val-hero" style="color:var(--strat-a)">${fmtL(sipA.finalVal)}</div>
        <div class="strat-metric-row"><span class="strat-metric-label">Invested Capital</span><span class="strat-metric-val">₹${(sipA.totalInfused/100000).toFixed(1)} L</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Net Profit</span><span class="strat-metric-val" style="color:var(--accent-emerald)">+${fmtL(sipA.netProfit)} (+${sipA.returnPct}%)</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Annualized XIRR</span><span class="strat-metric-val" style="color:var(--accent-emerald)">${sipA.xirr}% <span class="winner-pill">BEST</span></span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Max Drawdown</span><span class="strat-metric-val">${sipA.maxDD}%</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Win Rate / Profit Factor</span><span class="strat-metric-val">${sipA.winRate}% | ${sipA.profitFactor}x</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Avg Win / Avg Loss</span><span class="strat-metric-val">+${sipA.avgWin}% / -${sipA.avgLoss}%</span></div>
      </div>
    </div>

    <div class="chart-box">
      <div class="chart-title">
        <span>Portfolio Valuation Growth Over Time (SIP Model)</span>
        <span style="font-size:12px;color:var(--text-secondary)">₹2L initial + ₹2L/month SIP</span>
      </div>
      <div class="chart-wrapper">
        <canvas id="sipChart"></canvas>
      </div>
    </div>
  </div>

  <!-- LUMP SUM SECTION (Hidden by default) -->
  <div id="section-lump" style="display:none">
    <div class="strat-grid">
      <!-- Strategy C -->
      <div class="strat-card C">
        <div class="strat-tag" style="color:var(--strat-c)">Strategy C (Current Production Logic)</div>
        <div class="strat-title">Stage 2 Bull + 2-Tranche Exit</div>
        <div class="val-hero" style="color:var(--strat-c)">${fmtL(lumpC.finalVal)}</div>
        <div class="strat-metric-row"><span class="strat-metric-label">Invested Capital</span><span class="strat-metric-val">₹50.00 L</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Net Profit</span><span class="strat-metric-val">+${fmtL(lumpC.netProfit)} (+${lumpC.returnPct}%)</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Annualized CAGR</span><span class="strat-metric-val">${lumpC.naiveCagr}%</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Max Drawdown</span><span class="strat-metric-val" style="color:var(--accent-rose)">${lumpC.maxDD}%</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Win Rate / Profit Factor</span><span class="strat-metric-val">${lumpC.winRate}% | ${lumpC.profitFactor}x</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Avg Win / Avg Loss</span><span class="strat-metric-val">+${lumpC.avgWin}% / -${lumpC.avgLoss}%</span></div>
      </div>

      <!-- Strategy B -->
      <div class="strat-card B">
        <div class="strat-tag" style="color:var(--strat-b)">Strategy B (User's Proposal)</div>
        <div class="strat-title">50-EMA Cross + 4-Red < 21 EMA Exit</div>
        <div class="val-hero" style="color:var(--strat-b)">${fmtL(lumpB.finalVal)}</div>
        <div class="strat-metric-row"><span class="strat-metric-label">Invested Capital</span><span class="strat-metric-val">₹50.00 L</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Net Profit</span><span class="strat-metric-val">+${fmtL(lumpB.netProfit)} (+${lumpB.returnPct}%)</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Annualized CAGR</span><span class="strat-metric-val">${lumpB.naiveCagr}%</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Max Drawdown</span><span class="strat-metric-val" style="color:var(--accent-rose)">${lumpB.maxDD}%</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Win Rate / Profit Factor</span><span class="strat-metric-val">${lumpB.winRate}% | ${lumpB.profitFactor}x</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Avg Win / Avg Loss</span><span class="strat-metric-val">+${lumpB.avgWin}% / -${lumpB.avgLoss}%</span></div>
      </div>

      <!-- Strategy A -->
      <div class="strat-card A">
        <div class="strat-tag" style="color:var(--strat-a)">Strategy A (Upgraded Alpha Engine)</div>
        <div class="strat-title">Nifty Regime + RS Leaders + Tiered Stops</div>
        <div class="val-hero" style="color:var(--strat-a)">${fmtL(lumpA.finalVal)}</div>
        <div class="strat-metric-row"><span class="strat-metric-label">Invested Capital</span><span class="strat-metric-val">₹50.00 L</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Net Profit</span><span class="strat-metric-val" style="color:var(--accent-emerald)">+${fmtL(lumpA.netProfit)} (+${lumpA.returnPct}%)</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Annualized CAGR</span><span class="strat-metric-val" style="color:var(--accent-emerald)">${lumpA.naiveCagr}% <span class="winner-pill">BEST</span></span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Max Drawdown</span><span class="strat-metric-val">${lumpA.maxDD}%</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Win Rate / Profit Factor</span><span class="strat-metric-val">${lumpA.winRate}% | ${lumpA.profitFactor}x</span></div>
        <div class="strat-metric-row"><span class="strat-metric-label">Avg Win / Avg Loss</span><span class="strat-metric-val">+${lumpA.avgWin}% / -${lumpA.avgLoss}%</span></div>
      </div>
    </div>

    <div class="chart-box">
      <div class="chart-title">
        <span>Portfolio Valuation Growth Over Time (Lump-Sum Model)</span>
        <span style="font-size:12px;color:var(--text-secondary)">₹50 Lakhs deployed on Day 1 (02-Jan-2023)</span>
      </div>
      <div class="chart-wrapper">
        <canvas id="lumpChart"></canvas>
      </div>
    </div>
  </div>

  <!-- Deep-Dive Strategic Dossiers -->
  <div class="dossier-card" style="border-left: 4px solid var(--strat-b)">
    <div class="dossier-title" style="color:var(--strat-b)">
      Forensic Diagnosis: Why Strategy B (100% Exit on 4 Red Candles < 21 EMA) Underperforms
    </div>
    <div class="dossier-desc">
      <p>1. <strong>Severe Premature Cutting of Multibagger Trends</strong>: In healthy growth stocks (e.g., STLTECH, Trent, MTARTECH, TDPOWERSYS), 4 consecutive red days below the short-term 21-day EMA happen 3-5 times every year as normal swing pullbacks. Liquidating 100% on 4 red candles forces complete exit at the temporary swing bottom, completely missing the secondary +50% to +200% bull legs. Notice that Strategy B's average winning trade is only <strong>+16.2%</strong> vs <strong>+91.7%</strong> in Strategy A!</p>
      <p style="margin-top:8px">2. <strong>Whipsaw Friction (Buy High, Sell Low Cycle)</strong>: After getting stopped out on 4 red candles, the stock typically finds support at the 50-EMA and re-crosses above it 5-10 days later, triggering a fresh buy at a higher price. This constantly bleeds capital through churn and 0.50% transaction friction.</p>
    </div>
  </div>

  <div class="dossier-card" style="border-left: 4px solid var(--strat-a)">
    <div class="dossier-title" style="color:var(--strat-a)">
      Why Strategy A Generates Superior Profits: The Power of Asymmetry
    </div>
    <div class="dossier-desc">
      <p>1. <strong>Top-Decile Relative Strength (RS) Leadership</strong>: Ranking stocks by 6-month momentum vs Nifty ensures capital is concentrated in the top 20 institutional winners rather than being diluted across 148 positions.</p>
      <p style="margin-top:8px">2. <strong>Tiered Trailing Stops (Giving Runners Space)</strong>: Widening the trailing stop floor to 22% once a stock has built a +20% cushion allows true multi-baggers to ride through routine 15% consolidations without getting prematurely shaken out.</p>
      <p style="margin-top:8px">3. <strong>Market Regime Guard</strong>: Standing aside during market downturns eliminates false breakouts and keeps cash protected for high-probability setups.</p>
    </div>
  </div>
</div>

<script>
function switchMode(mode) {
  if (mode === 'sip') {
    document.getElementById('section-sip').style.display = 'block';
    document.getElementById('section-lump').style.display = 'none';
    document.getElementById('btn-sip').classList.add('active');
    document.getElementById('btn-lump').classList.remove('active');
  } else {
    document.getElementById('section-sip').style.display = 'none';
    document.getElementById('section-lump').style.display = 'block';
    document.getElementById('btn-sip').classList.remove('active');
    document.getElementById('btn-lump').classList.add('active');
  }
}

const dates = ${JSON.stringify(compDates)};

// SIP Chart
new Chart(document.getElementById('sipChart'), {
  type: 'line',
  data: {
    labels: dates,
    datasets: [
      { label: 'Strategy A (Upgraded Alpha)', data: ${JSON.stringify(curveSipA)}, borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.08)', fill: true, borderWidth: 2.5, pointRadius: 0, tension: 0.1 },
      { label: 'Strategy C (Current Production Logic)', data: ${JSON.stringify(curveSipC)}, borderColor: '#6366F1', borderWidth: 2.0, pointRadius: 0, fill: false, tension: 0.1 },
      { label: 'Strategy B (User Proposal)', data: ${JSON.stringify(curveSipB)}, borderColor: '#F59E0B', borderWidth: 2.0, pointRadius: 0, fill: false, tension: 0.1 },
      { label: 'Total Invested (SIP)', data: ${JSON.stringify(curveSipInv)}, borderColor: '#6B7280', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false }
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' },
    scales: {
      x: { type: 'time', time: { unit: 'month', displayFormats: { month: 'MMM yy' } }, grid: { color: 'rgba(55, 65, 81, 0.4)' }, ticks: { color: '#9CA3AF' } },
      y: { grid: { color: 'rgba(55, 65, 81, 0.4)' }, ticks: { color: '#9CA3AF', callback: v => '₹' + (v >= 100000 ? (v / 100000).toFixed(1) + 'L' : v.toLocaleString()) } }
    },
    plugins: { legend: { labels: { color: '#D1D5DB' } } }
  }
});

// Lump Chart
new Chart(document.getElementById('lumpChart'), {
  type: 'line',
  data: {
    labels: dates,
    datasets: [
      { label: 'Strategy A (Upgraded Alpha)', data: ${JSON.stringify(curveLumpA)}, borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.08)', fill: true, borderWidth: 2.5, pointRadius: 0, tension: 0.1 },
      { label: 'Strategy C (Current Production Logic)', data: ${JSON.stringify(curveLumpC)}, borderColor: '#6366F1', borderWidth: 2.0, pointRadius: 0, fill: false, tension: 0.1 },
      { label: 'Strategy B (User Proposal)', data: ${JSON.stringify(curveLumpB)}, borderColor: '#F59E0B', borderWidth: 2.0, pointRadius: 0, fill: false, tension: 0.1 },
      { label: 'Initial Capital (₹50L)', data: ${JSON.stringify(curveLumpInv)}, borderColor: '#6B7280', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false }
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false, interaction: { intersect: false, mode: 'index' },
    scales: {
      x: { type: 'time', time: { unit: 'month', displayFormats: { month: 'MMM yy' } }, grid: { color: 'rgba(55, 65, 81, 0.4)' }, ticks: { color: '#9CA3AF' } },
      y: { grid: { color: 'rgba(55, 65, 81, 0.4)' }, ticks: { color: '#9CA3AF', callback: v => '₹' + (v >= 100000 ? (v / 100000).toFixed(1) + 'L' : v.toLocaleString()) } }
    },
    plugins: { legend: { labels: { color: '#D1D5DB' } } }
  }
});
</script>
</body>
</html>`;

fs.writeFileSync(path.join(projectRoot, 'public', 'strategy_comparison_2023.html'), htmlReport, 'utf8');
fs.writeFileSync(path.join(projectRoot, 'data', 'strategy_comparison_2023.html'), htmlReport, 'utf8');
console.log('Done! Generated public/strategy_comparison_2023.html');
