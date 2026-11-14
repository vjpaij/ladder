/**
 * taxPnlService.js
 * ---------------------------------------------------------------------------
 * Comprehensive Financial Year & Custom Calendar Capital Gains (STCG & LTCG)
 * and Investment Analytics Engine for Ladder.
 *
 * Rules:
 * - STCG (Short-Term Capital Gains): Holding period <= 365 days.
 * - LTCG (Long-Term Capital Gains): Holding period > 365 days.
 * - Multi-Asset Coverage: Indian Stocks, US Stocks (at trade-date FX), Mutual Funds.
 * - Flexible Period Selection: Indian Statutory Financial Years (April 1 to March 31)
 *   and Arbitrary Custom Calendar Ranges (startDate to endDate).
 * - Read-heavy operations use in-memory dbCache (0 Supabase egress).
 * - Dynamic Algorithmic Engine: Generates FYs from inception (2019-20) through
 *   the current/future fiscal years without static hardcoding (Rule 13).
 * ---------------------------------------------------------------------------
 */
import { db } from '../db.js';
import { getAllTrades } from './tradingJournalService.js';
import { getHistoricalFxRate, getPersistedRate } from './fxRateStore.js';
import { fetchFxRate } from './priceEngine.js';

/**
 * Dynamically generate Indian Financial Year presets (April 1 to March 31).
 * Algorithmically derives years from startYear (2019-20) up to current date / transaction date.
 */
export function getFinancialYearPresets(referenceDate = new Date(), startYear = 2019) {
  const d = new Date(referenceDate);
  const curYear = isNaN(d.getTime()) ? 2026 : d.getFullYear();
  const curMonth = isNaN(d.getTime()) ? 10 : d.getMonth(); // 0-indexed: 3 = April
  const currentFyStart = curMonth >= 3 ? curYear : curYear - 1;

  const presets = [];
  for (let y = currentFyStart; y >= startYear; y--) {
    const next2 = String(y + 1).slice(-2);
    presets.push({
      id: `${y}-${next2}`,
      label: `FY ${y}-${next2}${y === currentFyStart ? ' (Current)' : ''}`,
      start: `${y}-04-01`,
      end: `${y + 1}-03-31`
    });
  }

  presets.push({
    id: 'ALL',
    label: 'All Time (Inception)',
    start: '2000-01-01',
    end: '2099-12-31'
  });

  return presets;
}

export const FINANCIAL_YEAR_PRESETS = getFinancialYearPresets();

/**
 * Replay Mutual Fund transactions using strict FIFO to produce closed tax lot records.
 */
function computeMutualFundTaxTrades(transactions = [], holdings = [], liveFxRate = 94.24) {
  const hMap = new Map((holdings || []).map(h => [String(h.id), h]));
  const mfTxsByHolding = new Map();

  for (const t of transactions) {
    const h = hMap.get(String(t.holding_id));
    const isMf = h?.category_id === 'mutual_funds' || /^\d+$/.test(t.symbol);
    if (!isMf) continue;

    const key = t.holding_id || t.symbol;
    if (!mfTxsByHolding.has(key)) mfTxsByHolding.set(key, []);
    mfTxsByHolding.get(key).push(t);
  }

  const mfClosedTrades = [];

  for (const [key, txList] of mfTxsByHolding.entries()) {
    txList.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    const lots = [];

    for (const t of txList) {
      const type = (t.type || 'BUY').toUpperCase();
      const qty = Number(t.quantity) || 0;
      const price = Number(t.price) || 0;
      const date = t.date || '';

      if (['BUY', 'INVESTMENT', 'INVESTMENT (SIP)', 'BONUS', 'SPLIT'].includes(type)) {
        if (qty > 0) {
          lots.push({ date, qty, rem: qty, price });
        }
      } else if (['SELL', 'WITHDRAWAL', 'REDEEM'].includes(type)) {
        let remToSell = qty;
        let costSold = 0;
        let matchedBuyDate = date;

        while (remToSell > 0.000001 && lots.length > 0) {
          const l = lots[0];
          const take = Math.min(remToSell, l.rem);
          costSold += take * l.price;
          l.rem -= take;
          remToSell -= take;

          if (matchedBuyDate === date) matchedBuyDate = l.date;
          if (l.rem <= 0.000001) lots.shift();
        }

        const proceeds = qty * price;
        const netPnl = proceeds - costSold;
        const holdingDays = Math.max(0, Math.round((new Date(date) - new Date(matchedBuyDate)) / 86400000));
        const taxTerm = holdingDays > 365 ? 'LTCG' : 'STCG';

        const h = hMap.get(String(t.holding_id));

        mfClosedTrades.push({
          id: `mf_trade_${t.id || `${date}_${key}`}`,
          date,
          entryDate: matchedBuyDate,
          exitDate: date,
          holdingDays,
          taxTerm,
          assetClass: 'mutual_funds',
          symbol: t.symbol || h?.symbol || key,
          name: h?.name || t.symbol || 'Mutual Fund Scheme',
          quantity: qty,
          entryPrice: costSold > 0 && qty > 0 ? costSold / qty : 0,
          exitPrice: price,
          investedCost: Number(costSold.toFixed(2)),
          proceeds: Number(proceeds.toFixed(2)),
          netPnlInr: Number(netPnl.toFixed(2)),
          roiPct: costSold > 0 ? Number(((netPnl / costSold) * 100).toFixed(2)) : 0
        });
      }
    }
  }

  return mfClosedTrades;
}

/**
 * Compute Tax P&L & Investment Performance for a specific Financial Year or Custom Date Range.
 */
export async function computeTaxPnl({ fy = null, startDate = null, endDate = null } = {}) {
  const fxRate = await fetchFxRate();
  const holdings = await db.select('holdings');
  const transactions = await db.select('transactions');

  // Dynamically generate presets from inception (2019-20)
  const presets = getFinancialYearPresets();
  const defaultFy = presets[0]?.id || '2026-27';
  const targetFy = fy || defaultFy;

  // 1. Resolve date boundaries
  let rangeStart = presets[0]?.start || '2026-04-01';
  let rangeEnd = presets[0]?.end || '2027-03-31';
  let rangeLabel = presets[0]?.label || `FY ${targetFy}`;
  let isCustom = false;

  if (startDate && endDate) {
    rangeStart = String(startDate).slice(0, 10);
    rangeEnd = String(endDate).slice(0, 10);
    rangeLabel = `${rangeStart} to ${rangeEnd}`;
    isCustom = true;
  } else if (targetFy) {
    const preset = presets.find(p => p.id === targetFy);
    if (preset) {
      rangeStart = preset.start;
      rangeEnd = preset.end;
      rangeLabel = preset.label;
    } else if (/^\d{4}-\d{2}$/.test(targetFy)) {
      const startYear = parseInt(targetFy.slice(0, 4), 10);
      rangeStart = `${startYear}-04-01`;
      rangeEnd = `${startYear + 1}-03-31`;
      rangeLabel = `FY ${targetFy}`;
    }
  }

  // 2. Fetch Closed Trades for Indian & US Equities from Trading Journal
  const journalTrades = getAllTrades() || [];
  const closedStockTrades = journalTrades
    .filter(t => t.exitPrice > 0 && t.date)
    .map(t => {
      const isUs = t.market === 'US' || t.segment === 'US_EQUITY';
      return {
        id: t.id,
        date: t.date,
        entryDate: t.entryDate || t.date,
        exitDate: t.exitDate || t.date,
        holdingDays: t.holdingDays || 0,
        taxTerm: t.taxTerm || ((t.holdingDays || 0) > 365 ? 'LTCG' : 'STCG'),
        assetClass: isUs ? 'us_stocks' : 'in_stocks',
        symbol: t.symbol,
        name: t.name || t.symbol,
        quantity: t.quantity,
        entryPrice: isUs ? (t.entryPriceInr || t.entryPrice) : t.entryPrice,
        exitPrice: isUs ? (t.exitPriceInr || t.exitPrice) : t.exitPrice,
        investedCost: Number(((t.quantity * (t.entryPriceInr || t.entryPrice || 0))).toFixed(2)),
        proceeds: Number(((t.quantity * (t.exitPriceInr || t.exitPrice || 0))).toFixed(2)),
        netPnlInr: Number((t.netPnlInr || 0).toFixed(2)),
        roiPct: Number((t.roiPctInr || t.roiPct || 0).toFixed(2))
      };
    });

  // 3. Compute Closed Trades for Mutual Funds
  const mfClosedTrades = computeMutualFundTaxTrades(transactions, holdings, fxRate);

  // 4. Combine all closed trades
  const allClosedTrades = [...closedStockTrades, ...mfClosedTrades];

  // 5. Filter for the selected active range
  const activePeriodTrades = allClosedTrades.filter(t => t.date >= rangeStart && t.date <= rangeEnd);

  // 6. Calculate Invested Amount in the period by asset class
  // Sum of BUY / INVESTMENT transactions executed between rangeStart and rangeEnd
  const hMap = new Map((holdings || []).map(h => [String(h.id), h]));
  const periodInvested = {
    in_stocks: 0,
    us_stocks: 0,
    mutual_funds: 0,
    total: 0
  };

  for (const t of transactions) {
    if (!t.date || t.date < rangeStart || t.date > rangeEnd) continue;
    const type = (t.type || 'BUY').toUpperCase();
    if (!['BUY', 'INVESTMENT', 'INVESTMENT (SIP)'].includes(type)) continue;

    const h = hMap.get(String(t.holding_id));
    const cat = h?.category_id || (/^\d+$/.test(t.symbol) ? 'mutual_funds' : 'in_stocks');
    const isUs = t.currency === 'USD' || cat === 'us_stocks';

    let amtINR = Number(t.total_amount) || (Number(t.quantity || 0) * Number(t.price || 0));
    if (isUs) {
      const lotFx = Number(t.fx_rate) || getHistoricalFxRate(t.date) || getPersistedRate('USD_INR') || fxRate || 1.0;
      amtINR = amtINR * lotFx;
    }

    if (cat === 'in_stocks') {
      periodInvested.in_stocks += amtINR;
    } else if (cat === 'us_stocks') {
      periodInvested.us_stocks += amtINR;
    } else if (cat === 'mutual_funds') {
      periodInvested.mutual_funds += amtINR;
    }
  }

  periodInvested.in_stocks = Number(periodInvested.in_stocks.toFixed(2));
  periodInvested.us_stocks = Number(periodInvested.us_stocks.toFixed(2));
  periodInvested.mutual_funds = Number(periodInvested.mutual_funds.toFixed(2));
  periodInvested.total = Number((periodInvested.in_stocks + periodInvested.us_stocks + periodInvested.mutual_funds).toFixed(2));

  // 7. Aggregate Period Performance Metrics per Asset Class
  function aggregateClassMetrics(trades, classInvested) {
    let realizedPnl = 0;
    let stcgPnl = 0;
    let ltcgPnl = 0;
    let proceeds = 0;
    let costSold = 0;
    let winCount = 0;
    let lossCount = 0;

    for (const t of trades) {
      const pnl = t.netPnlInr || 0;
      realizedPnl += pnl;
      proceeds += (t.proceeds || 0);
      costSold += (t.investedCost || 0);

      if (t.taxTerm === 'LTCG') {
        ltcgPnl += pnl;
      } else {
        stcgPnl += pnl;
      }

      if (pnl > 0) winCount++;
      else if (pnl < 0) lossCount++;
    }

    const tradeCount = trades.length;
    const winRate = tradeCount > 0 ? Number(((winCount / tradeCount) * 100).toFixed(1)) : 0;
    const roiPct = costSold > 0 ? Number(((realizedPnl / costSold) * 100).toFixed(2)) : 0;

    return {
      invested: classInvested,
      proceeds: Number(proceeds.toFixed(2)),
      costSold: Number(costSold.toFixed(2)),
      realizedPnl: Number(realizedPnl.toFixed(2)),
      stcgPnl: Number(stcgPnl.toFixed(2)),
      ltcgPnl: Number(ltcgPnl.toFixed(2)),
      tradeCount,
      winCount,
      lossCount,
      winRate,
      roiPct
    };
  }

  const inTrades = activePeriodTrades.filter(t => t.assetClass === 'in_stocks');
  const usTrades = activePeriodTrades.filter(t => t.assetClass === 'us_stocks');
  const mfTrades = activePeriodTrades.filter(t => t.assetClass === 'mutual_funds');

  const summaryByClass = {
    in_stocks: aggregateClassMetrics(inTrades, periodInvested.in_stocks),
    us_stocks: aggregateClassMetrics(usTrades, periodInvested.us_stocks),
    mutual_funds: aggregateClassMetrics(mfTrades, periodInvested.mutual_funds),
    total: aggregateClassMetrics(activePeriodTrades, periodInvested.total)
  };

  // 8. Multi-Year Historical Trend for Charting
  const fyTrends = presets
    .filter(p => p.id !== 'ALL')
    .map(preset => {
      const fyTrades = allClosedTrades.filter(t => t.date >= preset.start && t.date <= preset.end);

      // Period investment for this preset
      let fyInvested = 0;
      let fyInInvested = 0;
      let fyUsInvested = 0;
      let fyMfInvested = 0;

      for (const t of transactions) {
        if (!t.date || t.date < preset.start || t.date > preset.end) continue;
        const type = (t.type || 'BUY').toUpperCase();
        if (!['BUY', 'INVESTMENT', 'INVESTMENT (SIP)'].includes(type)) continue;

        const h = hMap.get(String(t.holding_id));
        const cat = h?.category_id || (/^\d+$/.test(t.symbol) ? 'mutual_funds' : 'in_stocks');
        const isUs = t.currency === 'USD' || cat === 'us_stocks';

        let amtINR = Number(t.total_amount) || (Number(t.quantity || 0) * Number(t.price || 0));
        if (isUs) {
          const lotFx = Number(t.fx_rate) || getHistoricalFxRate(t.date) || getPersistedRate('USD_INR') || fxRate || 1.0;
          amtINR = amtINR * lotFx;
        }

        if (cat === 'in_stocks') fyInInvested += amtINR;
        else if (cat === 'us_stocks') fyUsInvested += amtINR;
        else if (cat === 'mutual_funds') fyMfInvested += amtINR;
      }
      fyInvested = fyInInvested + fyUsInvested + fyMfInvested;

      const inT = fyTrades.filter(t => t.assetClass === 'in_stocks');
      const usT = fyTrades.filter(t => t.assetClass === 'us_stocks');
      const mfT = fyTrades.filter(t => t.assetClass === 'mutual_funds');

      const stcg = fyTrades.filter(t => t.taxTerm === 'STCG').reduce((s, t) => s + (t.netPnlInr || 0), 0);
      const ltcg = fyTrades.filter(t => t.taxTerm === 'LTCG').reduce((s, t) => s + (t.netPnlInr || 0), 0);
      const netPnl = fyTrades.reduce((s, t) => s + (t.netPnlInr || 0), 0);

      return {
        fyId: preset.id,
        fyLabel: preset.label,
        invested: Number(fyInvested.toFixed(2)),
        inInvested: Number(fyInInvested.toFixed(2)),
        usInvested: Number(fyUsInvested.toFixed(2)),
        mfInvested: Number(fyMfInvested.toFixed(2)),
        realizedPnl: Number(netPnl.toFixed(2)),
        stcgPnl: Number(stcg.toFixed(2)),
        ltcgPnl: Number(ltcg.toFixed(2)),
        inRealizedPnl: Number(inT.reduce((s, t) => s + (t.netPnlInr || 0), 0).toFixed(2)),
        usRealizedPnl: Number(usT.reduce((s, t) => s + (t.netPnlInr || 0), 0).toFixed(2)),
        mfRealizedPnl: Number(mfT.reduce((s, t) => s + (t.netPnlInr || 0), 0).toFixed(2)),
        tradesCount: fyTrades.length
      };
    });

  // 9. Consolidated Stock-Level Summaries
  const stockMap = new Map();
  for (const t of activePeriodTrades) {
    const key = `${t.assetClass}_${t.symbol}`;
    if (!stockMap.has(key)) {
      stockMap.set(key, {
        key,
        symbol: t.symbol,
        name: t.name || t.symbol,
        assetClass: t.assetClass,
        totalInvested: 0,
        totalProceeds: 0,
        netRealizedPnl: 0,
        stcgPnl: 0,
        stcgInvested: 0,
        stcgProceeds: 0,
        stcgTradeCount: 0,
        ltcgPnl: 0,
        ltcgInvested: 0,
        ltcgProceeds: 0,
        ltcgTradeCount: 0,
        tradeCount: 0,
        winCount: 0,
        lossCount: 0,
        trades: []
      });
    }

    const item = stockMap.get(key);
    const pnl = Number(t.netPnlInr || 0);
    const invested = Number(t.investedCost || 0);
    const proceeds = Number(t.proceeds || 0);

    item.totalInvested += invested;
    item.totalProceeds += proceeds;
    item.netRealizedPnl += pnl;
    item.tradeCount++;
    if (pnl > 0) item.winCount++;
    else if (pnl < 0) item.lossCount++;

    if (t.taxTerm === 'LTCG') {
      item.ltcgPnl += pnl;
      item.ltcgInvested += invested;
      item.ltcgProceeds += proceeds;
      item.ltcgTradeCount++;
    } else {
      item.stcgPnl += pnl;
      item.stcgInvested += invested;
      item.stcgProceeds += proceeds;
      item.stcgTradeCount++;
    }
    item.trades.push(t);
  }

  const stockSummaries = Array.from(stockMap.values()).map(s => {
    s.totalInvested = Number(s.totalInvested.toFixed(2));
    s.totalProceeds = Number(s.totalProceeds.toFixed(2));
    s.netRealizedPnl = Number(s.netRealizedPnl.toFixed(2));
    s.stcgPnl = Number(s.stcgPnl.toFixed(2));
    s.stcgInvested = Number(s.stcgInvested.toFixed(2));
    s.stcgProceeds = Number(s.stcgProceeds.toFixed(2));
    s.ltcgPnl = Number(s.ltcgPnl.toFixed(2));
    s.ltcgInvested = Number(s.ltcgInvested.toFixed(2));
    s.ltcgProceeds = Number(s.ltcgProceeds.toFixed(2));
    s.winRate = s.tradeCount > 0 ? Number(((s.winCount / s.tradeCount) * 100).toFixed(1)) : 0;
    s.roiPct = s.totalInvested > 0 ? Number(((s.netRealizedPnl / s.totalInvested) * 100).toFixed(2)) : 0;
    s.trades.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return s;
  }).sort((a, b) => Math.abs(b.netRealizedPnl) - Math.abs(a.netRealizedPnl));

  // 10. Sort active trades chronologically descending
  const sortedPeriodTrades = activePeriodTrades.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return {
    selectedRange: {
      fy: isCustom ? null : targetFy,
      label: rangeLabel,
      startDate: rangeStart,
      endDate: rangeEnd,
      isCustom
    },
    presets,
    summary: summaryByClass,
    trends: fyTrends,
    stockSummaries,
    trades: sortedPeriodTrades
  };
}
