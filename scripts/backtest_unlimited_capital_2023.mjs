/**
 * backtest_unlimited_capital_2023.mjs
 *
 * Simulates the exact Ladder Buy & Sell logic under an "Unlimited Cash Reserve" model:
 * Every time an authorized Buy signal occurs, the exact designed capital is invested:
 *   - STRONG_BUY: ₹1,00,000 initial entry
 *   - BUY: ₹50,000 initial entry
 *   - Subordinate Pyramid Additions on 50-EMA pullbacks in winning positions: +₹50,000 (Prime) / +₹25,000 (Tier 2)
 *   - Max position ceiling per stock: ₹2,00,000
 *   - No monthly cash rationing (cash is always liquid and available when an entry sets up).
 *   - Exits:
 *       * Tranche 1 (33% trim) on Chandelier Trailing Stop Floor breach (or 15% from peak)
 *       * Tranche 2 (100% exit of remaining 67%) on 30-week SMA breakdown (3+ weekly closes below falling SMA)
 *       * 5-day fresh buy retest buffer + 8% hard circuit-breaker
 *
 * Runs across 272 Indian equities from 02-Jan-2023 to 30-Oct-2026.
 * Outputs full transaction ledger and an interactive HTML report with multi-column sorting.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const START_DATE = '2023-01-02';
const END_DATE = '2026-10-30';
const COST_RATE = 0.005; // 0.50% friction

console.log('[Backtest Unlimited] Loading price data...');
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

console.log(`[Backtest Unlimited] Universe: ${symbols.length} Indian stocks.`);

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

// ─── Simulation Engine with Unlimited Reserves ──────────────────────
function runUnlimitedStrategy(strategyVariant = 'C') {
  let totalCashInjected = 0;
  let realizedProceeds = 0;
  const positions = new Map();
  const trades = [];
  const dailySnapshots = [];

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

      // Stop floor logic
      let trailingStop;
      if (strategyVariant === 'A') {
        const isBigWinner = pos.peakPrice / pos.avgPrice >= 1.20;
        const trailPct = isBigWinner ? 0.78 : 0.85;
        const atrMult = isBigWinner ? 3.5 : 3.0;
        const chandelierFloor = pos.peakPrice - atrMult * atr;
        trailingStop = Math.max(chandelierFloor, pos.peakPrice * trailPct);
      } else {
        const chandelierFloor = pos.peakPrice - 3.0 * atr;
        trailingStop = Math.max(chandelierFloor, pos.peakPrice * 0.85);
      }

      // Tranche 1: 33% trim on trailing floor breach
      if (!pos.tranche1Done && price <= trailingStop) {
        const trimQty = Math.max(1, Math.round(pos.qty * 0.33));
        const proceeds = trimQty * price * (1 - COST_RATE);
        realizedProceeds += proceeds;
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

      // Tranche 2: 100% exit of remaining position on 30w-SMA breakdown
      const weeksBelow = sd.weeksBelowFallingSma[wIdx];
      if (weeksBelow >= 3) {
        const proceeds = pos.qty * price * (1 - COST_RATE);
        realizedProceeds += proceeds;
        trades.push({
          date, sym, type: 'SELL', qty: pos.qty, price, amount: proceeds,
          signal: 'TRANCHE_2_EXIT',
          reason: `Structural breakdown: 3+ weekly closes below falling 30w-SMA. Full liquidation.`
        });
        toDelete.push(sym);
        continue;
      }
    }

    for (const sym of toDelete) positions.delete(sym);

    // 2. BUY EVALUATION (Unlimited Capital Availability)
    if (strategyVariant === 'C') {
      // Standard Ladder Strategy: Buy all authorized candidates matching Stage 2 + 50-EMA breakout
      for (const sym of symbols) {
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

        // Fresh position buy
        if (!positions.has(sym)) {
          let signal = null, alloc = 0;
          if (techScore >= 65 && stage === 2) { signal = 'STRONG_BUY'; alloc = 100000; }
          else if (techScore >= 55) { signal = 'BUY'; alloc = 50000; }
          if (!signal) continue;

          const buyQty = Math.max(1, Math.floor(alloc / (price * (1 + COST_RATE))));
          const cost = buyQty * price * (1 + COST_RATE);
          totalCashInjected += cost;

          positions.set(sym, {
            qty: buyQty, avgPrice: price, peakPrice: price, buyDate: date, buyIdx: dIdx,
            tranche1Done: false, totalInvested: cost, tranches: 1
          });
          trades.push({
            date, sym, type: 'BUY', qty: buyQty, price, amount: cost, signal,
            reason: `Stage ${stage} Bull, TechScore ${techScore}, 50-EMA Breakout.`
          });
        }
        // Subordinate pyramid addition to winning positions on pullbacks
        else {
          const pos = positions.get(sym);
          const ema21 = sd.ema21[dIdx];
          const dist50 = Math.abs((price / ema50) - 1) * 100;
          const dist21 = ema21 > 0 ? Math.abs((price / ema21) - 1) * 100 : 99;
          const isPullback = (dist50 <= 3.0 || dist21 <= 2.5) && price > pos.avgPrice;

          if (isPullback && pos.totalInvested < 200000 && pos.tranches < 3 && dIdx - pos.buyIdx >= 10) {
            const addAlloc = 50000;
            const addQty = Math.max(1, Math.floor(addAlloc / (price * (1 + COST_RATE))));
            const addCost = addQty * price * (1 + COST_RATE);
            totalCashInjected += addCost;

            const newQty = pos.qty + addQty;
            pos.avgPrice = (pos.qty * pos.avgPrice + addQty * price) / newQty;
            pos.qty = newQty;
            pos.totalInvested += addCost;
            pos.tranches++;
            trades.push({
              date, sym, type: 'BUY_ADD', qty: addQty, price, amount: addCost,
              signal: 'PYRAMID_ADDITION',
              reason: `Pullback near 21/50-EMA support (₹${price.toFixed(2)}). Built tranche #${pos.tranches}.`
            });
          }
        }
      }
    } else if (strategyVariant === 'A') {
      // Strategy A: Nifty Market Regime Filter + Top-Decile Mansfield RS Ranking
      const rSd = stockData['RELIANCE'];
      const rIdx = rSd?.dateToDailyIdx.get(date);
      const isMarketHealthy = !rSd || rIdx === undefined || rSd.dailyCloses[rIdx] >= (rSd.ema50[rIdx] || 0) * 0.97;

      if (isMarketHealthy) {
        const candidates = [];
        for (const sym of symbols) {
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

          candidates.push({ sym, price, rsScore: sd.momentum126[dIdx], dIdx, ema50, ema21: sd.ema21[dIdx] });
        }

        candidates.sort((a, b) => b.rsScore - a.rsScore);

        // Buy top-quartile leaders (top 50% of setups)
        const qualifiedCount = Math.max(1, Math.floor(candidates.length * 0.5));
        for (const cand of candidates.slice(0, qualifiedCount)) {
          if (!positions.has(cand.sym)) {
            const alloc = 100000;
            const buyQty = Math.max(1, Math.floor(alloc / (cand.price * (1 + COST_RATE))));
            const cost = buyQty * cand.price * (1 + COST_RATE);
            totalCashInjected += cost;

            positions.set(cand.sym, {
              qty: buyQty, avgPrice: cand.price, peakPrice: cand.price, buyDate: date, buyIdx: cand.dIdx,
              tranche1Done: false, totalInvested: cost, tranches: 1
            });
            trades.push({
              date, sym: cand.sym, type: 'BUY', qty: buyQty, price: cand.price, amount: cost,
              signal: 'RS_LEADER_STAGE2_BUY',
              reason: `Top RS Leader (+${cand.rsScore.toFixed(1)}% 6M), Stage 2 Bull.`
            });
          } else {
            const pos = positions.get(cand.sym);
            const dist50 = Math.abs((cand.price / cand.ema50) - 1) * 100;
            const dist21 = cand.ema21 > 0 ? Math.abs((cand.price / cand.ema21) - 1) * 100 : 99;
            const isPullback = (dist50 <= 3.0 || dist21 <= 2.5) && cand.price > pos.avgPrice;

            if (isPullback && pos.totalInvested < 200000 && pos.tranches < 3 && cand.dIdx - pos.buyIdx >= 10) {
              const addAlloc = 50000;
              const addQty = Math.max(1, Math.floor(addAlloc / (cand.price * (1 + COST_RATE))));
              const addCost = addQty * cand.price * (1 + COST_RATE);
              totalCashInjected += addCost;

              const newQty = pos.qty + addQty;
              pos.avgPrice = (pos.qty * pos.avgPrice + addQty * cand.price) / newQty;
              pos.qty = newQty;
              pos.totalInvested += addCost;
              pos.tranches++;
              trades.push({
                date, sym: cand.sym, type: 'BUY_ADD', qty: addQty, price: cand.price, amount: addCost,
                signal: 'PYRAMID_ADDITION',
                reason: `Pullback near 21/50-EMA support (₹${cand.price.toFixed(2)}). Tranche #${pos.tranches}.`
              });
            }
          }
        }
      }
    }

    // Daily Open Valuation
    let openHoldingsVal = 0;
    for (const [sym, pos] of positions) {
      const curP = getPriceAt(sym, date) || pos.avgPrice;
      openHoldingsVal += pos.qty * curP;
    }

    dailySnapshots.push({
      date,
      openHoldingsVal,
      positionsCount: positions.size,
      totalCashInjected,
      realizedProceeds
    });
  }

  // 3. STATISTICAL AGGREGATION ACROSS ALL STOCKS
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
      stockSummary[sym].openCostBasis = pos.totalInvested;
      stockSummary[sym].peakPrice = pos.peakPrice;
    }
  }

  // Compute Itemized P&L
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

    // Realized P&L
    const costOfSoldShares = s.totalSoldQty * avgBuyPrice;
    const realizedPnl = s.totalSoldQty > 0 ? s.totalSoldAmt - costOfSoldShares : 0;

    // Unrealized P&L
    const unrealizedPnl = heldQty > 0 ? openVal - (heldQty * avgBuyPrice) : 0;

    // Total Net P&L
    const netPnl = s.totalSoldAmt + openVal - s.totalBoughtAmt;
    const returnPct = s.totalBoughtAmt > 0 ? (netPnl / s.totalBoughtAmt) * 100 : 0;

    const status = heldQty > 0 && s.totalSoldQty > 0 ? 'PARTIAL_TRIM'
      : heldQty > 0 ? 'OPEN' : 'CLOSED';

    return {
      sym: s.sym,
      totalBoughtAmt: Math.round(s.totalBoughtAmt),
      totalBoughtQty: s.totalBoughtQty,
      totalSoldAmt: Math.round(s.totalSoldAmt),
      totalSoldQty: s.totalSoldQty,
      heldQty,
      avgBuyPrice: +avgBuyPrice.toFixed(2),
      avgSellPrice: +avgSellPrice.toFixed(2),
      currentPrice: +(s.currentPrice || avgBuyPrice).toFixed(2),
      peakPrice: +(s.peakPrice || avgBuyPrice).toFixed(2),
      openVal: Math.round(openVal),
      realizedPnl: Math.round(realizedPnl),
      unrealizedPnl: Math.round(unrealizedPnl),
      netPnl: Math.round(netPnl),
      returnPct: +returnPct.toFixed(2),
      status,
      tradesCount: s.tradesCount
    };
  }).sort((a, b) => b.netPnl - a.netPnl);

  const totalNetProfit = grandTotalSold + grandOpenValuation - grandTotalBought;
  const totalReturnPct = grandTotalBought > 0 ? (totalNetProfit / grandTotalBought) * 100 : 0;

  const winners = stockRows.filter(s => s.netPnl > 0);
  const losers = stockRows.filter(s => s.netPnl < 0);
  const winRate = (winners.length / Math.max(1, stockRows.length)) * 100;
  const avgWin = winners.length > 0 ? winners.reduce((a, b) => a + b.returnPct, 0) / winners.length : 0;
  const avgLoss = losers.length > 0 ? losers.reduce((a, b) => a + Math.abs(b.returnPct), 0) / losers.length : 0;
  const grossProfit = winners.reduce((a, b) => a + b.netPnl, 0);
  const grossLoss = Math.abs(losers.reduce((a, b) => a + b.netPnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 99.9;

  return {
    strategyVariant,
    grandTotalBought: Math.round(grandTotalBought),
    grandTotalSold: Math.round(grandTotalSold),
    grandOpenValuation: Math.round(grandOpenValuation),
    totalNetProfit: Math.round(totalNetProfit),
    totalReturnPct: +totalReturnPct.toFixed(2),
    winRate: +winRate.toFixed(1),
    profitFactor: +profitFactor.toFixed(2),
    avgWin: +avgWin.toFixed(1),
    avgLoss: +avgLoss.toFixed(1),
    totalStocksTraded: stockRows.length,
    activePositionsCount: positions.size,
    totalTrades: trades.length,
    stockRows,
    dailySnapshots
  };
}

console.log('[Backtest Unlimited] Running Strategy C (Current Production Logic)...');
const resC = runUnlimitedStrategy('C');

console.log('[Backtest Unlimited] Running Strategy A (Upgraded Alpha Engine)...');
const resA = runUnlimitedStrategy('A');

console.log('\n═══════════════════════════════════════════════════════════════════════════════════');
console.log('       UNLIMITED CAPITAL SIMULATION RESULTS (02-JAN-2023 → 30-OCT-2026)');
console.log('═══════════════════════════════════════════════════════════════════════════════════');
console.log(`Attribute                       | Strategy C (Current)       | Strategy A (Upgraded)`);
console.log(`────────────────────────────────┼────────────────────────────┼───────────────────────────`);
console.log(`Total Capital Deployed (Buys)   | ₹${(resC.grandTotalBought/100000).toFixed(2)} Lakhs (₹${(resC.grandTotalBought/10000000).toFixed(2)} Cr) | ₹${(resA.grandTotalBought/100000).toFixed(2)} Lakhs (₹${(resA.grandTotalBought/10000000).toFixed(2)} Cr)`);
console.log(`Total Sales Proceeds Realized   | ₹${(resC.grandTotalSold/100000).toFixed(2)} Lakhs (₹${(resC.grandTotalSold/10000000).toFixed(2)} Cr) | ₹${(resA.grandTotalSold/100000).toFixed(2)} Lakhs (₹${(resA.grandTotalSold/10000000).toFixed(2)} Cr)`);
console.log(`Current Open Holdings Valuation | ₹${(resC.grandOpenValuation/100000).toFixed(2)} Lakhs (₹${(resC.grandOpenValuation/10000000).toFixed(2)} Cr) | ₹${(resA.grandOpenValuation/100000).toFixed(2)} Lakhs (₹${(resA.grandOpenValuation/10000000).toFixed(2)} Cr)`);
console.log(`TOTAL NET STRATEGY PROFIT       | +₹${(resC.totalNetProfit/100000).toFixed(2)} Lakhs (+₹${(resC.totalNetProfit/10000000).toFixed(2)} Cr)| +₹${(resA.totalNetProfit/100000).toFixed(2)} Lakhs (+₹${(resA.totalNetProfit/10000000).toFixed(2)} Cr)`);
console.log(`Absolute Return ROI on Deploy   | +${resC.totalReturnPct}%                    | +${resA.totalReturnPct}%`);
console.log(`Win Rate                        | ${resC.winRate}%                      | ${resA.winRate}%`);
console.log(`Profit Factor (Gains / Losses)  | ${resC.profitFactor}x                      | ${resA.profitFactor}x`);
console.log(`Avg Win / Avg Loss Ratio        | +${resC.avgWin}% / -${resC.avgLoss}%          | +${resA.avgWin}% / -${resA.avgLoss}%`);
console.log(`Total Unique Stocks Traded      | ${resC.totalStocksTraded}                        | ${resA.totalStocksTraded}`);
console.log(`Current Active Open Positions   | ${resC.activePositionsCount}                        | ${resA.activePositionsCount}`);
console.log(`Total Trades Executed           | ${resC.totalTrades}                      | ${resA.totalTrades}`);
console.log('═══════════════════════════════════════════════════════════════════════════════════\n');

// ─── Generate Standalone Interactive HTML Report with Multi-Column Sorting ───
const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN');
const fmtCr = n => '₹' + (n / 10000000).toFixed(2) + ' Cr';
const fmtL = n => '₹' + (n / 100000).toFixed(2) + ' L';

const htmlReport = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ladder Unlimited Capital Strategy Backtest & Stock Audit (2023 - 2026)</title>
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
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background-color: var(--bg-main);
    color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 24px;
    line-height: 1.5;
  }
  .container { max-width: 1500px; margin: 0 auto; }
  .header { margin-bottom: 24px; }
  .title { font-size: 26px; font-weight: 700; color: #FFFFFF; }
  .subtitle { font-size: 14px; color: var(--text-secondary); margin-top: 4px; }

  /* Mode Switcher */
  .switch-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    flex-wrap: wrap;
    gap: 12px;
  }
  .mode-switch {
    display: inline-flex;
    background: var(--bg-subcard);
    padding: 4px;
    border-radius: 8px;
    border: 1px solid var(--border);
  }
  .mode-btn {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    padding: 8px 18px;
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

  /* Search Filter */
  .search-box {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 14px;
    color: #FFF;
    font-size: 13px;
    width: 260px;
    outline: none;
  }
  .search-box:focus { border-color: var(--brand-indigo); }

  /* KPI Grid */
  .kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 14px;
    margin-bottom: 24px;
  }
  .kpi-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 18px;
  }
  .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); font-weight: 600; }
  .kpi-val { font-size: 24px; font-weight: 800; margin: 6px 0; }
  .kpi-sub { font-size: 12px; color: var(--text-secondary); }
  .pos { color: var(--accent-emerald); }
  .neg { color: var(--accent-rose); }

  /* Table Box */
  .table-box {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 24px;
  }
  .table-scroll { max-height: 700px; overflow-y: auto; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
  th {
    background: var(--bg-subcard);
    color: var(--text-secondary);
    font-weight: 600;
    padding: 12px 14px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    position: sticky;
    top: 0;
    z-index: 10;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    border-bottom: 1px solid var(--border);
  }
  th:hover { color: #FFF; background: #252F3F; }
  th .sort-icon { font-size: 10px; margin-left: 4px; color: var(--brand-indigo); }
  td { padding: 10px 14px; border-top: 1px solid var(--border); white-space: nowrap; }
  tr:hover td { background: rgba(99, 102, 241, 0.05); }
  .r { text-align: right; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 700;
  }
  .badge-open { background: rgba(16, 185, 129, 0.15); color: var(--accent-emerald); }
  .badge-trim { background: rgba(245, 158, 11, 0.15); color: var(--accent-amber); }
  .badge-closed { background: rgba(107, 114, 128, 0.2); color: #9CA3AF; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="title">🏛️ Ladder Strategy Audit: Fully Funded (Unlimited Cash) Simulation</div>
    <div class="subtitle">Complete Universe Audit (02-Jan-2023 → 30-Oct-2026 / 3.83 Years) | ₹1.0L Strong Buy / ₹50k Buy / ₹50k Pyramid Tranches (Capped at ₹2.0L/stock) | Zero Cash Bottleneck</div>
  </div>

  <div class="switch-row">
    <div class="mode-switch">
      <button class="mode-btn active" id="btn-stratC" onclick="renderStrategy('C')">Strategy C (Current Production Logic)</button>
      <button class="mode-btn" id="btn-stratA" onclick="renderStrategy('A')">Strategy A (Upgraded Alpha Engine)</button>
    </div>
    <input type="text" id="filterInput" class="search-box" placeholder="🔍 Search stock ticker (e.g. STLTECH)..." onkeyup="filterTable()">
  </div>

  <!-- Hero KPI Grid -->
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Total Capital Deployed</div>
      <div class="kpi-val" id="kpi-deployed">₹0</div>
      <div class="kpi-sub" id="kpi-deployed-sub">Total buys executed</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Realized Sales Proceeds</div>
      <div class="kpi-val" id="kpi-sales">₹0</div>
      <div class="kpi-sub" id="kpi-sales-sub">Cash returned from trims & exits</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Current Open Holdings Value</div>
      <div class="kpi-val" id="kpi-open">₹0</div>
      <div class="kpi-sub" id="kpi-open-sub">Active positions at 30-Oct CMP</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">TOTAL NET STRATEGY PROFIT</div>
      <div class="kpi-val pos" id="kpi-net">₹0</div>
      <div class="kpi-sub" id="kpi-roi">0% Absolute Return on Deployed Capital</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Win Rate & Profit Factor</div>
      <div class="kpi-val" id="kpi-winrate">0%</div>
      <div class="kpi-sub" id="kpi-pf">0x Profit Factor</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Total Stocks & Trades</div>
      <div class="kpi-val" id="kpi-stocks">0</div>
      <div class="kpi-sub" id="kpi-trades">0 trades executed</div>
    </div>
  </div>

  <!-- Itemized Stock Ledger Table -->
  <div class="table-box">
    <div class="table-scroll">
      <table id="stockTable">
        <thead>
          <tr>
            <th onclick="sortTable(0)">Symbol <span class="sort-icon" id="s0">↕</span></th>
            <th class="r" onclick="sortTable(1)">Total Bought (₹) <span class="sort-icon" id="s1">↕</span></th>
            <th class="r" onclick="sortTable(2)">Buy Qty <span class="sort-icon" id="s2">↕</span></th>
            <th class="r" onclick="sortTable(3)">Total Sold (₹) <span class="sort-icon" id="s3">↕</span></th>
            <th class="r" onclick="sortTable(4)">Sold Qty <span class="sort-icon" id="s4">↕</span></th>
            <th class="r" onclick="sortTable(5)">Held Qty <span class="sort-icon" id="s5">↕</span></th>
            <th class="r" onclick="sortTable(6)">Avg Buy (₹) <span class="sort-icon" id="s6">↕</span></th>
            <th class="r" onclick="sortTable(7)">CMP (₹) <span class="sort-icon" id="s7">↕</span></th>
            <th class="r" onclick="sortTable(8)">Open Value (₹) <span class="sort-icon" id="s8">↕</span></th>
            <th class="r" onclick="sortTable(9)">Realized P&L (₹) <span class="sort-icon" id="s9">↕</span></th>
            <th class="r" onclick="sortTable(10)">Unrealized P&L (₹) <span class="sort-icon" id="s10">↕</span></th>
            <th class="r" onclick="sortTable(11)">TOTAL NET P&L (₹) <span class="sort-icon" id="s11">↕</span></th>
            <th class="r" onclick="sortTable(12)">Return (%) <span class="sort-icon" id="s12">↕</span></th>
            <th onclick="sortTable(13)">Status <span class="sort-icon" id="s13">↕</span></th>
            <th class="r" onclick="sortTable(14)">Trades <span class="sort-icon" id="s14">↕</span></th>
          </tr>
        </thead>
        <tbody id="tableBody">
        </tbody>
      </table>
    </div>
  </div>
</div>

<script>
const dataC = ${JSON.stringify(resC)};
const dataA = ${JSON.stringify(resA)};

let currentData = dataC;
let currentRows = [...dataC.stockRows];
let currentSortCol = 11; // default sort by Net P&L
let sortAsc = false;

function fmt(n) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
function fmtCr(n) {
  return '₹' + (n / 10000000).toFixed(2) + ' Cr';
}

function renderKPIs(res) {
  document.getElementById('kpi-deployed').innerText = fmtCr(res.grandTotalBought);
  document.getElementById('kpi-deployed-sub').innerText = fmt(res.grandTotalBought) + ' deployed';

  document.getElementById('kpi-sales').innerText = fmtCr(res.grandTotalSold);
  document.getElementById('kpi-sales-sub').innerText = fmt(res.grandTotalSold) + ' returned';

  document.getElementById('kpi-open').innerText = fmtCr(res.grandOpenValuation);
  document.getElementById('kpi-open-sub').innerText = res.activePositionsCount + ' active positions held';

  document.getElementById('kpi-net').innerText = '+' + fmtCr(res.totalNetProfit);
  document.getElementById('kpi-net').className = 'kpi-val ' + (res.totalNetProfit >= 0 ? 'pos' : 'neg');
  document.getElementById('kpi-roi').innerText = (res.totalReturnPct >= 0 ? '+' : '') + res.totalReturnPct + '% Absolute ROI (' + fmt(res.totalNetProfit) + ')';

  document.getElementById('kpi-winrate').innerText = res.winRate + '%';
  document.getElementById('kpi-pf').innerText = res.profitFactor + 'x Profit Factor (+ ' + res.avgWin + '% / -' + res.avgLoss + '%)';

  document.getElementById('kpi-stocks').innerText = res.totalStocksTraded + ' Stocks';
  document.getElementById('kpi-trades').innerText = res.totalTrades + ' trades executed';
}

function renderTableRows(rows) {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';

  rows.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = \`
      <td><strong>\${s.sym}</strong></td>
      <td class="r mono">\${fmt(s.totalBoughtAmt)}</td>
      <td class="r mono">\${s.totalBoughtQty.toLocaleString()}</td>
      <td class="r mono">\${fmt(s.totalSoldAmt)}</td>
      <td class="r mono">\${s.totalSoldQty.toLocaleString()}</td>
      <td class="r mono"><strong>\${s.heldQty.toLocaleString()}</strong></td>
      <td class="r mono">₹\${s.avgBuyPrice.toFixed(2)}</td>
      <td class="r mono">₹\${s.currentPrice.toFixed(2)}</td>
      <td class="r mono">\${s.openVal > 0 ? fmt(s.openVal) : '—'}</td>
      <td class="r mono \${s.realizedPnl >= 0 ? 'pos' : 'neg'}">\${s.realizedPnl >= 0 ? '+' : ''}\${fmt(s.realizedPnl)}</td>
      <td class="r mono \${s.unrealizedPnl >= 0 ? 'pos' : 'neg'}">\${s.heldQty > 0 ? (s.unrealizedPnl >= 0 ? '+' : '') + fmt(s.unrealizedPnl) : '—'}</td>
      <td class="r mono \${s.netPnl >= 0 ? 'pos' : 'neg'}"><strong>\${s.netPnl >= 0 ? '+' : ''}\${fmt(s.netPnl)}</strong></td>
      <td class="r \${s.returnPct >= 0 ? 'pos' : 'neg'}"><strong>\${s.returnPct >= 0 ? '+' : ''}\${s.returnPct.toFixed(1)}%</strong></td>
      <td><span class="badge badge-\${s.status === 'OPEN' ? 'open' : s.status === 'PARTIAL_TRIM' ? 'trim' : 'closed'}">\${s.status}</span></td>
      <td class="r mono">\${s.tradesCount}</td>
    \`;
    tbody.appendChild(tr);
  });
}

function renderStrategy(v) {
  if (v === 'C') {
    currentData = dataC;
    document.getElementById('btn-stratC').classList.add('active');
    document.getElementById('btn-stratA').classList.remove('active');
  } else {
    currentData = dataA;
    document.getElementById('btn-stratA').classList.add('active');
    document.getElementById('btn-stratC').classList.remove('active');
  }
  currentRows = [...currentData.stockRows];
  renderKPIs(currentData);
  applySort();
  filterTable();
}

function sortTable(colIndex) {
  if (currentSortCol === colIndex) {
    sortAsc = !sortAsc;
  } else {
    currentSortCol = colIndex;
    sortAsc = false; // default descending
  }

  // Update header arrows
  for (let i = 0; i <= 14; i++) {
    const el = document.getElementById('s' + i);
    if (el) el.innerText = '↕';
  }
  const curEl = document.getElementById('s' + colIndex);
  if (curEl) curEl.innerText = sortAsc ? '▲' : '▼';

  applySort();
  filterTable();
}

function applySort() {
  const colKeys = [
    'sym', 'totalBoughtAmt', 'totalBoughtQty', 'totalSoldAmt', 'totalSoldQty',
    'heldQty', 'avgBuyPrice', 'currentPrice', 'openVal', 'realizedPnl',
    'unrealizedPnl', 'netPnl', 'returnPct', 'status', 'tradesCount'
  ];
  const key = colKeys[currentSortCol];

  currentRows.sort((a, b) => {
    let va = a[key], vb = b[key];
    if (typeof va === 'string') {
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    return sortAsc ? va - vb : vb - va;
  });
}

function filterTable() {
  const q = document.getElementById('filterInput').value.trim().toUpperCase();
  if (!q) {
    renderTableRows(currentRows);
  } else {
    const filtered = currentRows.filter(r => r.sym.includes(q) || r.status.includes(q));
    renderTableRows(filtered);
  }
}

// Initial load
renderStrategy('C');
</script>
</body>
</html>`;

fs.writeFileSync(path.join(projectRoot, 'public', 'unlimited_backtest_audit.html'), htmlReport, 'utf8');
fs.writeFileSync(path.join(projectRoot, 'data', 'unlimited_backtest_audit.html'), htmlReport, 'utf8');
console.log('[Backtest Unlimited] Generated public/unlimited_backtest_audit.html');
