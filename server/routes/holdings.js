import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { 
  fetchFxRate, 
  liveQuoteCache, 
  fetchStockQuote, 
  fetchMutualFundNav, 
  fetchNpsNavFallback, 
  fetchNpsHistoricalNav, 
  formatCleanQuoteDate 
} from '../services/priceEngine.js';
import { getHistoricalFxRate, getPersistedRate } from '../services/fxRateStore.js';
import { getHistoricalPricesMap, formatDateDDMMYYYY } from '../services/historicalPriceStore.js';
import { computeHoldingValueINR } from '../services/portfolioCalculator.js';
import { recalculateHoldingState } from '../services/recalculator.js';
import { calculateXirr } from '../services/xirrCalculator.js';
import { invalidateBenchmarkCache } from '../services/benchmarkEngine.js';
import { triggerEodRebuildIfPastDate } from '../services/eodSync.js';
import { getLoanAmortizationData } from '../services/loanEngine.js';
import { authenticateToken } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// -------------------------------------------------------------
// Holdings List API
// -------------------------------------------------------------
router.get('/holdings', authenticateToken, async (req, res) => {
  try {
    const fxRate = await fetchFxRate();

    const holdings = await db.select('holdings');
    const categories = await db.select('categories');
    const catMap = {};
    categories.forEach(c => catMap[c.id] = c);

    // Compute exact weighted transaction FX rates for US stocks using cached transactions
    const allTxs = await db.select('transactions');
    const usTxs = allTxs.filter(t => t.currency === 'USD' && t.type === 'BUY');
    const usFxMap = {};
    usTxs.forEach(t => {
      const key = t.holding_id || t.symbol;
      if (!usFxMap[key]) usFxMap[key] = { totalUSD: 0, totalINR: 0 };
      const amt = Number(t.total_amount) || 0;
      const rate = Number(t.fx_rate) || (t.date ? getHistoricalFxRate(t.date) : null) || getPersistedRate('USD_INR') || fxRate || 1.0;
      usFxMap[key].totalUSD += amt;
      usFxMap[key].totalINR += amt * rate;
    });

    // Fetch Asset Metadata to map sector and capitalisation
    let metaData = null;
    try {
      const { data } = await supabase.from('asset_metadata').select('*');
      metaData = data;
    } catch (e) {
      console.warn('[Holdings Route] Supabase asset_metadata query failed:', e.message);
    }

    // Fallback to local cache if DB was unreachable or empty
    if (!metaData || metaData.length === 0) {
      try {
        const localPath = path.join(__dirname, '../../data/asset_metadata.json');
        if (fs.existsSync(localPath)) {
          metaData = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        }
      } catch (e) {
        console.warn('[Holdings Route] Local asset_metadata.json read error:', e.message);
      }
    }

    const metadataMap = {};
    if (metaData) {
      metaData.forEach(m => {
        if (m.symbol) {
          metadataMap[m.symbol] = m;
          metadataMap[m.symbol.toUpperCase()] = m;
          metadataMap[m.symbol.toLowerCase()] = m;
        }
      });
    }

    const historicalPricesCache = getHistoricalPricesMap();

    const allDivs = await db.select('dividends');
    const divStatsMap = {};
    allDivs.forEach(d => {
      const key = d.holding_id || d.symbol;
      if (!divStatsMap[key]) divStatsMap[key] = { inr: 0, orig: 0 };
      divStatsMap[key].inr += Number(d.amount_inr) || 0;
      divStatsMap[key].orig += Number(d.amount_original) || (Number(d.amount_inr) / (Number(d.fx_rate) || 1));
    });

    const sellStatsMap = {};
    allTxs.forEach(t => {
      if (t.type === 'SELL' || t.type === 'REDEEM' || t.type === 'REDEMPTION') {
        const key = t.holding_id || t.symbol;
        if (!sellStatsMap[key]) sellStatsMap[key] = { qty: 0, grossUSD: 0, grossINR: 0, chargesUSD: 0, chargesINR: 0, netUSD: 0, netINR: 0 };
        const q = Number(t.quantity) || 0;
        const p = Number(t.price) || 0;
        const amt = Number(t.total_amount) || (q * p);
        const chg = Number(t.charges) || 0;
        const r = (t.currency === 'USD') ? (Number(t.fx_rate) || getHistoricalFxRate(t.date) || fxRate || 1.0) : 1.0;

        sellStatsMap[key].qty += q;
        sellStatsMap[key].grossUSD += (t.currency === 'USD' ? amt : amt / r);
        sellStatsMap[key].grossINR += (t.currency === 'USD' ? amt * r : amt);
        sellStatsMap[key].chargesUSD += (t.currency === 'USD' ? chg : chg / r);
        sellStatsMap[key].chargesINR += (t.currency === 'USD' ? chg * r : chg);
        sellStatsMap[key].netUSD += (t.currency === 'USD' ? (amt - chg) : (amt - chg) / r);
        sellStatsMap[key].netINR += (t.currency === 'USD' ? (amt - chg) * r : (amt - chg));
      }
    });

    const formatted = holdings.map(h => {
      const liveRate = h.currency === 'USD' ? fxRate : 1.0;
      let txRate = 1.0;
      if (h.currency === 'USD') {
        const m = usFxMap[h.id] || usFxMap[h.symbol];
        txRate = (m && m.totalUSD > 0) ? (m.totalINR / m.totalUSD) : (getHistoricalFxRate(h.created_at) || getPersistedRate('USD_INR') || fxRate || 1.0);
      }

      const sStats = sellStatsMap[h.id] || sellStatsMap[h.symbol] || { qty: 0, grossUSD: 0, grossINR: 0, netUSD: 0, netINR: 0 };
      const dStats = divStatsMap[h.id] || divStatsMap[h.symbol] || { inr: 0, orig: 0 };
      const isUSD = h.currency === 'USD';
      const isFundOrNps = h.category_id === 'mutual_funds' || h.category_id === 'nps';

      const soldQty = Number(h.sell_qty) || sStats.qty || Number(h.buy_qty) || 0;
      const avgSellPrice = sStats.qty > 0 
        ? Number((isUSD ? (sStats.grossUSD / sStats.qty) : (sStats.grossINR / sStats.qty)).toFixed(isFundOrNps ? 4 : 2))
        : 0;
      const redeemedValue = Number((isUSD ? sStats.netUSD : sStats.netINR).toFixed(2));
      const grossRedeemed = Number((isUSD ? sStats.grossUSD : sStats.grossINR).toFixed(2));
      const totalDividends = Number((isUSD ? dStats.orig : dStats.inr).toFixed(2));

      const liveQuote = liveQuoteCache.get(h.symbol);
      const currentPriceNum = (liveQuote && liveQuote.price > 0) ? liveQuote.price : (Number(h.current_price) || 0);
      const currentValueOriginal = (Number(h.quantity) || 0) * currentPriceNum;
      const currentValueINR = computeHoldingValueINR(h, currentPriceNum, fxRate);

      const investedValueOriginal = (Number(h.quantity) || 0) * (Number(h.avg_buy_price) || 0);
      const investedValueINR = investedValueOriginal * txRate;

      const gainINR = currentValueINR - investedValueINR;
      const gainPct = investedValueINR > 0 ? ((gainINR / investedValueINR) * 100).toFixed(2) : 0;

      // Calculate Day Change & Day Change %
      let prevPrice = currentPriceNum;
      let dayChange = (liveQuote && liveQuote.dayChange !== undefined) ? liveQuote.dayChange : h.day_change;
      let dayChangePct = (liveQuote && liveQuote.dayChangePct !== undefined) ? liveQuote.dayChangePct : h.day_change_pct;

      if (dayChange === undefined || dayChangePct === undefined) {
        const cleanSym = (h.symbol || '').replace(/\.(NS|BO)$/i, '');
        const hist = historicalPricesCache[h.symbol] || historicalPricesCache[cleanSym] || historicalPricesCache[`${cleanSym}.NS`] || {};
        const dates = Object.keys(hist).sort();
        if (dates.length >= 2) {
          prevPrice = Number(hist[dates[dates.length - 2]]) || currentPriceNum;
        } else if (dates.length === 1) {
          prevPrice = Number(hist[dates[0]]) || currentPriceNum;
        }
        dayChange = currentPriceNum - prevPrice;
        dayChangePct = prevPrice > 0 ? Number(((dayChange / prevPrice) * 100).toFixed(2)) : 0;
      } else {
        prevPrice = currentPriceNum - Number(dayChange);
      }

      const cleanSym = (h.symbol || '').replace(/\.(NS|BO)$/i, '').trim();
      const meta = metadataMap[h.symbol] || metadataMap[cleanSym] || metadataMap[cleanSym.toUpperCase()] || {};

      const finalSector = (meta.sector && meta.sector !== 'Unknown') ? meta.sector : (h.sector && h.sector !== 'Unknown' ? h.sector : 'Unknown');
      const finalMcap = (meta.mcap_category && meta.mcap_category !== 'Unknown') ? meta.mcap_category : (meta.capitalisation && meta.capitalisation !== 'Unknown') ? meta.capitalisation : (h.market_cap && h.market_cap !== 'Unknown' ? h.market_cap : 'Unknown');

      let finalName = h.name;
      if (h.category_id === 'us_stocks' && typeof finalName === 'string') {
        finalName = finalName.replace(/\b(Common Stock|Capital Stock|Registry Share|Registry Shares|Class A|Class B|Class C|Ordinary Shares|Ordinary Share)\b/ig, '')
                             .replace(/,\s*Inc\.?$/i, ' Inc.')
                             .replace(/,\s*Corp\.?$/i, ' Corp.')
                             .replace(/[,\.\-\s]+$/, '')
                             .trim();
      }

      return {
        ...h,
        name: finalName || h.name,
        current_price: currentPriceNum,
        sector: finalSector,
        market_cap: finalMcap,
        market_cap_cr: meta.market_cap || null,
        industry: meta.industry || null,
        category_name: catMap[h.category_id] ? catMap[h.category_id].name : h.category_id,
        category_color: catMap[h.category_id] ? catMap[h.category_id].color : '#3B82F6',
        fxRate: liveRate,
        txFxRate: Number(txRate.toFixed(2)),
        day_change: (h.category_id === 'mutual_funds' || h.category_id === 'nps') 
          ? Number(Number(dayChange || 0).toFixed(4)) 
          : Number(Number(dayChange || 0).toFixed(2)),
        day_change_pct: Number(Number(dayChangePct || 0).toFixed(2)),
        prev_price: (h.category_id === 'mutual_funds' || h.category_id === 'nps')
          ? Number(prevPrice.toFixed(4))
          : Number(prevPrice.toFixed(2)),
        quote_date: liveQuote?.quoteDate || (h.updated_at ? h.updated_at.split('T')[0] : null),
        currentValueOriginal: Number(currentValueOriginal.toFixed(2)),
        currentValueINR: Number(currentValueINR.toFixed(2)),
        investedValueINR: Number(investedValueINR.toFixed(2)),
        gainINR: Number(gainINR.toFixed(2)),
        gainPct: Number(gainPct),
        sold_qty: soldQty,
        avg_sell_price: avgSellPrice,
        redeemed_value: redeemedValue,
        gross_redeemed: grossRedeemed,
        total_dividends: totalDividends
      };
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    res.json(formatted);
  } catch (err) {
    console.error('[Get Holdings Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Holdings Management
// -------------------------------------------------------------
router.post('/holdings', authenticateToken, async (req, res) => {
  try {
    const { category_id, symbol, name, exchange, quantity, avg_buy_price, current_price, currency, sector, market_cap } = req.body;
    const newHolding = await db.insert('holdings', {
      category_id,
      symbol,
      name,
      exchange: exchange || 'NSE',
      quantity: Number(quantity),
      avg_buy_price: Number(avg_buy_price),
      current_price: Number(current_price || avg_buy_price),
      nse_price: exchange === 'NSE' ? Number(current_price || avg_buy_price) : 0,
      bse_price: exchange === 'BSE' ? Number(current_price || avg_buy_price) : 0,
      currency: currency || 'INR',
      sector: sector || 'General',
      market_cap: market_cap || 'Unknown',
      status: Number(quantity) > 0 ? 'active' : 'closed'
    });

    await db.insert('transactions', {
      holding_id: newHolding.id,
      type: 'BUY',
      quantity: Number(quantity),
      price: Number(avg_buy_price),
      total_amount: Number(quantity) * Number(avg_buy_price),
      currency: currency || 'INR',
      date: new Date().toISOString().split('T')[0],
      notes: `Initial purchase of ${name} (${symbol})`
    });

    import('../../scripts/sync_asset_metadata.mjs')
      .then(m => m.syncAssetMetadata(false))
      .catch(e => console.error('[Background Sync Error]:', e));

    res.json({ success: true, id: newHolding.id });
  } catch (err) {
    console.error('[Post Holdings Error]:', err);
    res.status(400).json({ error: err.message });
  }
});

router.put('/holdings/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, avg_buy_price, current_price, name, symbol, sector, market_cap } = req.body;
    await db.update('holdings', id, {
      quantity: Number(quantity),
      avg_buy_price: Number(avg_buy_price),
      current_price: Number(current_price),
      name,
      symbol,
      sector,
      market_cap,
      status: Number(quantity) > 0 ? 'active' : 'closed'
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[Put Holdings Error]:', err);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/holdings/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await supabase.from('transactions').delete().eq('holding_id', id);
    await supabase.from('dividends').delete().eq('holding_id', id);
    await supabase.from('sips').delete().eq('holding_id', id);
    const { error: holdErr } = await supabase.from('holdings').delete().eq('id', id);
    if (holdErr) throw new Error(holdErr.message);
    db.invalidateCache();

    res.json({ success: true, message: 'Holding and all associated records deleted successfully.' });
  } catch (err) {
    console.error('[Delete Holding Error]:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Holding Detail API (for HoldingDetailModal)
// -------------------------------------------------------------
router.get('/holding/:holdingId/detail', authenticateToken, async (req, res) => {
  try {
    const { holdingId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    const fxRate = await fetchFxRate();

    const holdings = await db.select('holdings');
    let holding = holdings.find(h => h.id === holdingId || h.id == holdingId || h.symbol === holdingId);

    if (!holding) {
      const liabilities = await db.select('liabilities');
      const liab = liabilities.find(l => l.id === holdingId || l.id == holdingId || l.category_id === holdingId);
      if (liab) {
        holding = {
          id: liab.id,
          name: liab.name,
          symbol: liab.category_id === 'loans' ? 'LOAN' : 'CREDITS',
          category_id: liab.category_id,
          quantity: 1,
          avg_buy_price: liab.outstanding_balance,
          current_price: liab.outstanding_balance,
          currency: 'INR'
        };
      }
    }

    if (!holding) return res.status(404).json({ error: 'Holding not found' });

    // Check if Bank, EPF, or Liability account with EOD daily tracking
    const eodKeyMap = {
      'HDFC-SAVINGS': 'hdfc',
      'INDUSIND-SAVINGS': 'indusind',
      'IDFC-SAVINGS': 'idfc',
      'RBL-SAVINGS': 'rbl',
      'SBI-SAVINGS': 'sbi',
      'FEDERAL-SAVINGS': 'federal',
      'EPF-RETIREMENT': 'epf',
      'LOAN': 'loan',
      'CREDITS': 'credits'
    };
    let eodKey = eodKeyMap[holding.symbol];
    if (!eodKey) {
      if (holding.category_id === 'bank') {
        if (holding.name.includes('HDFC')) eodKey = 'hdfc';
        else if (holding.name.includes('IndusInd')) eodKey = 'indusind';
        else if (holding.name.includes('IDFC')) eodKey = 'idfc';
        else if (holding.name.includes('RBL')) eodKey = 'rbl';
        else if (holding.name.includes('SBI')) eodKey = 'sbi';
        else if (holding.name.includes('Federal')) eodKey = 'federal';
        else eodKey = 'savings';
      } else if (holding.category_id === 'epf') {
        eodKey = 'epf';
      } else if (holding.category_id === 'loans') {
        eodKey = 'loan';
      } else if (holding.category_id === 'credit_cards') {
        eodKey = 'credits';
      }
    }

    if (eodKey) {
      const eodLogsPath = path.join(__dirname, '../../data/portfolio_eod_logs.json');
      let eodLogs = [];
      try {
        if (fs.existsSync(eodLogsPath)) {
          eodLogs = JSON.parse(fs.readFileSync(eodLogsPath, 'utf-8'));
        }
      } catch (err) {
        console.error('[Detail API] Error reading eodLogs:', err.message);
      }

      if (eodLogs.length > 0) {
        const activeLogs = eodLogs.filter(l => l[eodKey] !== undefined && l[eodKey] !== null);
        const firstNonZeroIdx = activeLogs.findIndex(l => l[eodKey] > 0);
        const validLogs = firstNonZeroIdx >= 0 ? activeLogs.slice(firstNonZeroIdx) : (activeLogs.length > 0 ? activeLogs : [{ date: today, [eodKey]: 0 }]);

        const livePrice = holding.current_price !== undefined && holding.current_price !== null ? Number(holding.current_price) : NaN;
        const currentVal = !isNaN(livePrice)
          ? livePrice
          : (validLogs[validLogs.length - 1]?.[eodKey] || 0);
        const peakVal = Math.max(...validLogs.map(l => l[eodKey] || 0), currentVal);
        const minVal = Math.min(...validLogs.map(l => l[eodKey] || 0), currentVal);
        const startVal = validLogs[0]?.[eodKey] || 0;
        const startDate = validLogs[0]?.date || '—';

        // Calculate 1 Year Delta
        const oneYearAgoDate = new Date();
        oneYearAgoDate.setFullYear(oneYearAgoDate.getFullYear() - 1);
        const oneYearAgoStr = oneYearAgoDate.toISOString().split('T')[0];
        const yearAgoLog = validLogs.find(l => l.date >= oneYearAgoStr) || validLogs[0];
        const yearAgoVal = yearAgoLog?.[eodKey] || startVal;
        const oneYearDelta = currentVal - yearAgoVal;
        const oneYearPct = yearAgoVal > 0 ? ((oneYearDelta / yearAgoVal) * 100).toFixed(2) : 0;

        const timelineINR = [];
        for (let i = 0; i < validLogs.length; i++) {
          const item = validLogs[i];
          const val = Number((item[eodKey] || 0).toFixed(2));
          timelineINR.push({
            label: item.date,
            invested: val,
            value: val,
            balance: val
          });
        }
        const lastLog = validLogs[validLogs.length - 1];
        if (timelineINR.length > 0 && lastLog && timelineINR[timelineINR.length - 1].label !== lastLog.date) {
          const lastVal = Number((lastLog[eodKey] || 0).toFixed(2));
          timelineINR.push({
            label: lastLog.date,
            invested: lastVal,
            value: lastVal,
            balance: lastVal
          });
        }
        if (timelineINR.length > 0 && timelineINR[timelineINR.length - 1].label < today) {
          timelineINR.push({
            label: today,
            invested: currentVal,
            value: currentVal,
            balance: currentVal
          });
        } else if (timelineINR.length > 0 && timelineINR[timelineINR.length - 1].label === today) {
          timelineINR[timelineINR.length - 1] = {
            label: today,
            invested: currentVal,
            value: currentVal,
            balance: currentVal
          };
        }

        let txs = [];
        const { data: realTxs } = await supabase
          .from('transactions')
          .select('*')
          .or(`holding_id.eq.${holding.id},liability_id.eq.${holding.id},symbol.eq.${holding.symbol}`)
          .order('date', { ascending: false });
        
        if (realTxs && realTxs.length > 0) {
          txs = realTxs;
        } else {
          let prevVal = 0;
          const txStep = Math.max(1, Math.floor(validLogs.length / 60));
          for (let i = 0; i < validLogs.length; i += txStep) {
            const l = validLogs[i];
            const val = l[eodKey] || 0;
            const diff = val - prevVal;
            txs.push({
              id: `eod_${l.date}_${i}`,
              holding_id: holding.id,
              symbol: holding.symbol || 'EOD',
              name: holding.name,
              type: diff >= 0 ? 'BUY' : 'SELL',
              quantity: 1,
              price: val,
              total_amount: Math.abs(diff),
              date: l.date,
              notes: `EOD Balance: ₹${val.toLocaleString('en-IN')}`
            });
            prevVal = val;
          }
          txs = txs.reverse();
        }

        return res.json({
          holding: {
            ...holding,
            current_price: currentVal,
            avg_buy_price: startVal
          },
          fxRate: 1.0,
          transactions: txs,
          dividends: [],
          timelineUSD: timelineINR,
          timelineINR,
          metricsUSD: {
            totalInvested: startVal,
            currentValue: currentVal,
            unrealizedPnl: currentVal - startVal,
            unrealizedPct: startVal > 0 ? Number((((currentVal - startVal) / startVal) * 100).toFixed(2)) : 0,
            peakValue: peakVal,
            minValue: minVal,
            oneYearDelta,
            oneYearPct,
            startDate
          },
          metricsINR: {
            totalInvested: startVal,
            currentValue: currentVal,
            unrealizedPnl: currentVal - startVal,
            unrealizedPct: startVal > 0 ? Number((((currentVal - startVal) / startVal) * 100).toFixed(2)) : 0,
            peakValue: peakVal,
            minValue: minVal,
            oneYearDelta,
            oneYearPct,
            startDate
          },
          timeline: timelineINR,
          metrics: {
            totalInvested: startVal,
            currentValue: currentVal,
            unrealizedPnl: currentVal - startVal,
            unrealizedPct: startVal > 0 ? Number((((currentVal - startVal) / startVal) * 100).toFixed(2)) : 0,
            peakValue: peakVal,
            minValue: minVal,
            oneYearDelta,
            oneYearPct,
            startDate
          },
          amortization: holding.category_id === 'loans' ? await getLoanAmortizationData(holding.id) : null
        });
      }
    }

    const isUSStock = holding.currency === 'USD';
    const currentFx = await fetchFxRate();
    const liveRate = isUSStock ? currentFx : 1.0;

    const { data: txsData, error: txErr } = await supabase
      .from('transactions')
      .select('*')
      .or(`holding_id.eq.${holding.id},symbol.eq.${holding.symbol}`)
      .order('date', { ascending: true });
    if (txErr) console.error('[Detail API] Tx Fetch Error:', txErr.message);
    const txs = txsData || [];

    const { data: divsData, error: divErr } = await supabase
      .from('dividends')
      .select('*')
      .or(`holding_id.eq.${holding.id},symbol.eq.${holding.symbol}`)
      .order('ex_date', { ascending: true });
    if (divErr) console.error('[Detail API] Div Fetch Error:', divErr.message);
    const divs = divsData || [];

    let totalInvestedUSD = 0;
    let totalInvestedINR = 0;
    let totalRedeemedUSD = 0;
    let totalRedeemedINR = 0;
    let realizedPnlUSD = 0;
    let realizedPnlINR = 0;
    let totalBuyChargesUSD = 0;
    let totalBuyChargesINR = 0;
    let totalSellChargesUSD = 0;
    let totalSellChargesINR = 0;

    const buyLotsUSD = [];
    const buyLotsINR = [];

    for (const tx of txs) {
      const qty = Number(tx.quantity) || 0;
      const price = Number(tx.price) || 0;
      const amountUSD = Number(tx.total_amount) || (qty * price);
      const txRate = isUSStock ? (Number(tx.fx_rate) || getHistoricalFxRate(tx.date)) : 1.0;
      const amountINR = amountUSD * txRate;
      const chargesUSD = Number(tx.charges) || 0;
      const chargesINR = chargesUSD * txRate;

      if (tx.type === 'BUY') {
        totalBuyChargesUSD += chargesUSD;
        totalBuyChargesINR += chargesINR;
        totalInvestedUSD += amountUSD + chargesUSD;
        totalInvestedINR += amountINR + chargesINR;
        buyLotsUSD.push({ qty, price, charges: chargesUSD, rem: qty });
        buyLotsINR.push({ qty, priceUSD: price, fxRate: txRate, charges: chargesINR, rem: qty });
      } else if (tx.type === 'BONUS' || tx.type === 'DIVIDEND_REINVEST') {
        buyLotsUSD.push({ qty, price, charges: 0, rem: qty });
        buyLotsINR.push({ qty, priceUSD: price, fxRate: txRate, charges: 0, rem: qty });
      } else if (tx.type === 'SPLIT') {
        let ratio = 1;
        const match = (tx.notes || '').match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
        if (match) {
          const o = parseFloat(match[1]);
          const n = parseFloat(match[2]);
          if (o > 0 && n > 0) ratio = n / o;
        } else if (tx.notes && tx.notes.includes('Multiplier')) {
          const m = tx.notes.match(/Multiplier\s+(\d+(?:\.\d+)?)x/i);
          if (m) ratio = parseFloat(m[1]);
        } else if (Number(tx.quantity) > 0) {
          const curLots = buyLotsINR.reduce((s, l) => s + l.rem, 0);
          if (curLots > 0) ratio = (curLots + Number(tx.quantity)) / curLots;
        }
        if (ratio > 0 && ratio !== 1) {
          for (const lot of buyLotsUSD) {
            lot.rem *= ratio;
            lot.qty *= ratio;
            lot.price /= ratio;
          }
          for (const lot of buyLotsINR) {
            lot.rem *= ratio;
            lot.qty *= ratio;
            lot.priceUSD /= ratio;
          }
        }
      } else if (tx.type === 'SELL') {
        totalSellChargesUSD += chargesUSD;
        totalSellChargesINR += chargesINR;
        totalRedeemedUSD += amountUSD - chargesUSD;
        totalRedeemedINR += amountINR - chargesINR;

        realizedPnlUSD -= chargesUSD;
        realizedPnlINR -= chargesINR;

        let remUSD = qty;
        while (remUSD > 0 && buyLotsUSD.length > 0) {
          const lot = buyLotsUSD[0];
          const used = Math.min(lot.rem, remUSD);
          const lotChargesUSD = lot.qty > 0 ? (used / lot.qty) * (lot.charges || 0) : 0;
          realizedPnlUSD += (used * (price - lot.price)) - lotChargesUSD;
          lot.rem -= used;
          remUSD -= used;
          if (lot.rem <= 0) buyLotsUSD.shift();
        }

        let remINR = qty;
        while (remINR > 0 && buyLotsINR.length > 0) {
          const lot = buyLotsINR[0];
          const used = Math.min(lot.rem, remINR);
          const lotChargesINR = lot.qty > 0 ? (used / lot.qty) * (lot.charges || 0) : 0;
          realizedPnlINR += ((used * price * txRate) - (used * lot.priceUSD * lot.fxRate)) - lotChargesINR;
          lot.rem -= used;
          remINR -= used;
          if (lot.rem <= 0) buyLotsINR.shift();
        }
      }
    }

    const liveQuote = liveQuoteCache.get(holding.symbol);
    const currentQty = Number(holding.quantity) || 0;
    const currentPriceUSD = (liveQuote && liveQuote.price > 0) ? liveQuote.price : (Number(holding.current_price) || 0);
    const avgBuyPriceUSD = Number(holding.avg_buy_price) || 0;

    const currentValueUSD = currentQty * currentPriceUSD;
    const costBasisUSD = currentQty * avgBuyPriceUSD;
    const unrealizedPnlUSD = currentValueUSD - costBasisUSD;
    const unrealizedPctUSD = costBasisUSD > 0 ? Number(((unrealizedPnlUSD / costBasisUSD) * 100).toFixed(2)) : 0;

    const currentValueINR = currentValueUSD * liveRate;
    const activeLotsINR = buyLotsINR.filter(l => l.rem > 0);
    const costBasisINR = activeLotsINR.length > 0
      ? activeLotsINR.reduce((s, l) => {
          const lotCost = l.rem * l.priceUSD * l.fxRate;
          const lotCharge = l.qty > 0 ? (l.rem / l.qty) * (l.charges || 0) : 0;
          return s + lotCost + lotCharge;
        }, 0)
      : (costBasisUSD * (totalInvestedUSD > 0 ? (totalInvestedINR / totalInvestedUSD) : liveRate));

    const unrealizedPnlINR = currentValueINR - costBasisINR;
    const unrealizedPctINR = costBasisINR > 0 ? Number(((unrealizedPnlINR / costBasisINR) * 100).toFixed(2)) : 0;

    const totalDividendsUSD = isUSStock
      ? divs.reduce((s, d) => s + (Number(d.amount_original) || 0), 0)
      : 0;
    const totalDividendsINR = divs.reduce((s, d) => s + (Number(d.amount_inr) || 0), 0);

    realizedPnlUSD += totalDividendsUSD;
    realizedPnlINR += totalDividendsINR;

    // Cashflows & XIRR
    const cashflowsUSD = txs
      .filter(t => t.type === 'BUY' || t.type === 'SELL')
      .map(t => {
        const amt = Number(t.total_amount) || 0;
        const charges = Number(t.charges) || 0;
        return {
          date: t.date,
          amount: (t.type === 'BUY') ? -(amt + charges) : (amt - charges)
        };
      });

    if (isUSStock) {
      for (const d of divs) {
        cashflowsUSD.push({ date: d.ex_date || d.payment_date, amount: (Number(d.amount_original) || 0) });
      }
    }

    if (currentQty > 0) cashflowsUSD.push({ date: today, amount: currentValueUSD });
    const totalXirrUSD = calculateXirr(cashflowsUSD);

    const cashflowsINR = txs
      .filter(t => t.type === 'BUY' || t.type === 'SELL')
      .map(t => {
        const r = isUSStock ? (Number(t.fx_rate) || getHistoricalFxRate(t.date)) : 1.0;
        const amt = (Number(t.total_amount) || 0) * r;
        const charges = (Number(t.charges) || 0) * r;
        return {
          date: t.date,
          amount: (t.type === 'BUY') ? -(amt + charges) : (amt - charges)
        };
      });

    for (const d of divs) {
      cashflowsINR.push({ date: d.ex_date || d.payment_date, amount: (Number(d.amount_inr) || 0) });
    }

    if (currentQty > 0) cashflowsINR.push({ date: today, amount: currentValueINR });
    const totalXirrINR = calculateXirr(cashflowsINR);

    const timelineUSD = [];
    const timelineINR = [];

    const divsByDate = {};
    for (const d of divs) {
      const dDate = d.ex_date || d.payment_date || d.created_at || today;
      const dStr = dDate.split('T')[0];
      if (!divsByDate[dStr]) divsByDate[dStr] = [];
      divsByDate[dStr].push(d);
    }

    // Historical daily NAV timeline for NPS
    if (holding.category_id === 'nps' && txs.length > 0) {
      const npsNavMap = await fetchNpsHistoricalNav(holding.symbol);
      if (npsNavMap && npsNavMap.size > 0) {
        const sortedNavDates = Array.from(npsNavMap.keys()).sort();
        const firstTxDate = txs[0].date;
        const lastTxDate = txs[txs.length - 1].date;
        const isExited = (Number(holding.quantity) || 0) === 0;
        const relevantDates = sortedNavDates.filter(d => d >= firstTxDate && (!isExited || d <= lastTxDate));

        let runningQ = 0;
        let runningInv = 0;
        let txIdx = 0;

        for (const d of relevantDates) {
          let dayEvents = [];

          while (txIdx < txs.length && txs[txIdx].date <= d) {
            const tx = txs[txIdx];
            const qty = Number(tx.quantity) || 0;
            const amt = Number(tx.total_amount) || (qty * (Number(tx.price) || 0));

            if (tx.date === d && tx.type !== 'DIVIDEND') {
              dayEvents.push({
                type: tx.type,
                qty: qty,
                quantity: qty,
                price: Number(tx.price) || 0,
                priceUSD: Number(tx.price) || 0,
                priceINR: Number(tx.price) || 0,
                amount: amt,
                amountUSD: amt,
                amountINR: amt,
                notes: tx.notes
              });
            }

            if (tx.type === 'BUY' || tx.type === 'BONUS') {
              runningQ += qty;
              runningInv += amt;
            } else if (tx.type === 'SELL') {
              runningQ = Math.max(0, runningQ - qty);
              runningInv = Math.max(0, runningInv - amt);
            }
            txIdx++;
          }

          if (divsByDate[d]) {
            for (const div of divsByDate[d]) {
              const divAmtUSD = Number(div.amount_original) || 0;
              const divAmtINR = Number(div.amount_inr) || divAmtUSD;
              dayEvents.push({
                type: 'DIVIDEND',
                qty: 0,
                quantity: 0,
                price: divAmtINR,
                priceUSD: divAmtUSD,
                priceINR: divAmtINR,
                amount: divAmtINR,
                amountUSD: divAmtUSD,
                amountINR: divAmtINR,
                notes: 'Dividend payout'
              });
            }
          }

          const nav = npsNavMap.get(d) || 0;
          const val = Math.max(0, runningQ * nav);
          timelineINR.push({
            label: d,
            invested: Number(Math.max(0, runningInv).toFixed(2)),
            value: Number(val.toFixed(2)),
            price: Number(nav.toFixed(4)),
            events: dayEvents.length > 0 ? dayEvents : null
          });
        }

        if (!isExited && (timelineINR.length === 0 || timelineINR[timelineINR.length - 1].label !== today)) {
          const navToday = (Number(holding.current_price) || 0);
          timelineINR.push({
            label: today,
            invested: Number(Math.max(0, costBasisINR).toFixed(2)),
            value: Number(currentValueINR.toFixed(2)),
            price: Number(navToday.toFixed(4)),
            events: null
          });
        }
      }
    }

    // Dense Timeline Construction (for stocks, MFs, and fallback)
    const historicalPricesCache = getHistoricalPricesMap();
    if (timelineINR.length === 0 && txs.length > 0) {
      const histPrices = historicalPricesCache[holding.symbol] || {};
      const firstTxDate = txs[0].date;
      const lastTxDate = txs[txs.length - 1].date;
      const isExited = (Number(holding.quantity) || 0) <= 0;
      const endLimitStr = isExited ? lastTxDate : today;

      let runningQ = 0;
      let runningInvUSD = 0;
      let runningInvINR = 0;
      let txIdx = 0;
      let lastKnownPriceUSD = avgBuyPriceUSD || (Number(holding.current_price) || 0);
      let lastKnownPriceINR = lastKnownPriceUSD * liveRate;

      const startDate = new Date(firstTxDate);
      const endDate = new Date(endLimitStr);
      if (endDate > new Date(today)) endDate.setTime(new Date(today).getTime());

      let currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        const dStr = currentDate.toISOString().split('T')[0];
        let dayEvents = [];

        while (txIdx < txs.length && txs[txIdx].date <= dStr) {
          const tx = txs[txIdx];
          const qty = Number(tx.quantity) || 0;
          const price = Number(tx.price) || 0;
          const amtUSD = Number(tx.total_amount) || qty * price;
          const txRate = isUSStock ? (Number(tx.fx_rate) || getHistoricalFxRate(tx.date)) : 1.0;
          const amtINR = amtUSD * txRate;

          if (tx.date === dStr && tx.type !== 'DIVIDEND') {
            dayEvents.push({
              type: tx.type,
              qty: qty,
              quantity: qty,
              price: isUSStock ? price : (price * txRate),
              priceUSD: price,
              priceINR: price * txRate,
              amount: isUSStock ? amtUSD : amtINR,
              amountUSD: amtUSD,
              amountINR: amtINR,
              notes: tx.notes
            });
          }

          if (tx.type === 'BUY') {
            runningQ += qty;
            const txChargesUSD = Number(tx.charges) || 0;
            const txChargesINR = txChargesUSD * txRate;
            runningInvUSD += amtUSD + txChargesUSD;
            runningInvINR += amtINR + txChargesINR;
            if (qty > 0) {
              lastKnownPriceUSD = price;
              lastKnownPriceINR = price * txRate;
            }
          } else if (tx.type === 'SELL') {
            const sellCostUSD = runningQ > 0 ? (qty * (runningInvUSD / runningQ)) : 0;
            const sellCostINR = runningQ > 0 ? (qty * (runningInvINR / runningQ)) : 0;
            runningQ = Math.max(0, runningQ - qty);
            runningInvUSD = Math.max(0, runningInvUSD - sellCostUSD);
            runningInvINR = Math.max(0, runningInvINR - sellCostINR);
          }
          if (runningQ <= 1e-6) {
            runningQ = 0;
            runningInvUSD = 0;
            runningInvINR = 0;
          }
          txIdx++;
        }

        if (divsByDate[dStr]) {
          for (const d of divsByDate[dStr]) {
            const divAmtUSD = Number(d.amount_original) || (Number(d.amount_inr) / (Number(d.fx_rate) || 1));
            const divAmtINR = Number(d.amount_inr) || (divAmtUSD * (Number(d.fx_rate) || liveRate));
            dayEvents.push({
              type: 'DIVIDEND',
              qty: 0,
              quantity: 0,
              price: isUSStock ? divAmtUSD : divAmtINR,
              priceUSD: divAmtUSD,
              priceINR: divAmtINR,
              amount: isUSStock ? divAmtUSD : divAmtINR,
              amountUSD: divAmtUSD,
              amountINR: divAmtINR,
              notes: 'Dividend payout'
            });
          }
        }

        if (dStr === today && currentPriceUSD > 0) {
          lastKnownPriceUSD = currentPriceUSD;
          lastKnownPriceINR = isUSStock ? currentPriceUSD * liveRate : currentPriceUSD;
        } else if (histPrices[dStr] !== undefined) {
          lastKnownPriceUSD = isUSStock ? histPrices[dStr] : histPrices[dStr] / getHistoricalFxRate(dStr);
          lastKnownPriceINR = isUSStock ? histPrices[dStr] * getHistoricalFxRate(dStr) : histPrices[dStr];
        }

        const valUSD = Math.max(0, runningQ * lastKnownPriceUSD);
        const valINR = Math.max(0, runningQ * lastKnownPriceINR);

        timelineUSD.push({
          label: dStr,
          invested: Number(Math.max(0, runningInvUSD).toFixed(2)),
          value: Number(valUSD.toFixed(2)),
          price: Number(lastKnownPriceUSD.toFixed(4)),
          events: dayEvents.length > 0 ? dayEvents : null
        });
        timelineINR.push({
          label: dStr,
          invested: Number(Math.max(0, runningInvINR).toFixed(2)),
          value: Number(valINR.toFixed(2)),
          price: Number(lastKnownPriceINR.toFixed(4)),
          events: dayEvents.length > 0 ? dayEvents : null
        });

        currentDate.setDate(currentDate.getDate() + 1);
      }
    }

    const activeTimelineData = isUSStock ? timelineUSD : timelineINR;
    let quotePrice = (liveQuote && liveQuote.price > 0) ? liveQuote.price : (Number(holding.current_price) || 0);
    let prevClose = (liveQuote && liveQuote.previousClose) ? Number(liveQuote.previousClose) : quotePrice;
    let dayHigh = (liveQuote && liveQuote.high) ? Number(liveQuote.high) : quotePrice;
    let dayLow = (liveQuote && liveQuote.low) ? Number(liveQuote.low) : quotePrice;
    let openPrice = (liveQuote && liveQuote.open) ? Number(liveQuote.open) : quotePrice;
    let fiftyTwoWeekHigh = (liveQuote && liveQuote.fiftyTwoWeekHigh) ? Number(liveQuote.fiftyTwoWeekHigh) : (Number(holding.fifty_two_week_high) || quotePrice * 1.2);
    let fiftyTwoWeekLow = (liveQuote && liveQuote.fiftyTwoWeekLow) ? Number(liveQuote.fiftyTwoWeekLow) : (Number(holding.fifty_two_week_low) || quotePrice * 0.8);
    let quoteDateStr = liveQuote?.quoteDate || null;

    const cleanSym = (holding.symbol || '').replace(/\.(NS|BO)$/i, '');
    const hist = historicalPricesCache[holding.symbol] || historicalPricesCache[cleanSym] || historicalPricesCache[`${cleanSym}.NS`] || {};
    const histDates = Object.keys(hist).sort();
    if (!liveQuote || !liveQuote.previousClose) {
      if (histDates.length >= 2) {
        prevClose = Number(hist[histDates[histDates.length - 2]]) || quotePrice;
      } else if (histDates.length === 1) {
        prevClose = Number(hist[histDates[0]]) || quotePrice;
      }
    }

    if (activeTimelineData && activeTimelineData.length > 0) {
      const last365 = activeTimelineData.slice(-252);
      const yearPrices = last365.map(p => Number(p.price) || 0).filter(p => p > 0);
      if (yearPrices.length > 0) {
        fiftyTwoWeekHigh = Math.max(...yearPrices, fiftyTwoWeekHigh);
        fiftyTwoWeekLow = Math.min(...yearPrices, fiftyTwoWeekLow);
      }
    }

    if ((!liveQuote || !liveQuote.price) && (holding.category_id === 'in_stocks' || holding.category_id === 'us_stocks')) {
      const sym = holding.category_id === 'in_stocks' ? `${cleanSym}.NS` : holding.symbol;
      try {
        const liveQ = await fetchStockQuote(sym);
        if (liveQ) {
          if (liveQ.price) quotePrice = Number(liveQ.price);
          if (liveQ.previousClose) prevClose = Number(liveQ.previousClose);
          if (liveQ.open) openPrice = Number(liveQ.open);
          dayHigh = Number(liveQ.high) || Math.max(quotePrice, prevClose);
          dayLow = Number(liveQ.low) || Math.min(quotePrice, prevClose);
          if (liveQ.fiftyTwoWeekHigh) fiftyTwoWeekHigh = Number(liveQ.fiftyTwoWeekHigh);
          if (liveQ.fiftyTwoWeekLow) fiftyTwoWeekLow = Number(liveQ.fiftyTwoWeekLow);
          if (liveQ.quoteDate) quoteDateStr = liveQ.quoteDate;
        }
      } catch (e) {
        console.warn(`[Holding Detail] Live stock quote fetch warning for ${sym}:`, e.message);
      }
    } else if (holding.category_id === 'mutual_funds') {
      try {
        const mfQ = await fetchMutualFundNav(holding.symbol);
        if (mfQ) {
          if (mfQ.nav) quotePrice = Number(mfQ.nav);
          if (mfQ.previousNav) prevClose = Number(mfQ.previousNav);
          openPrice = Number(mfQ.open) || prevClose;
          dayHigh = Number(mfQ.high) || quotePrice;
          dayLow = Number(mfQ.low) || quotePrice;
          if (mfQ.fiftyTwoWeekHigh) fiftyTwoWeekHigh = Number(mfQ.fiftyTwoWeekHigh);
          if (mfQ.fiftyTwoWeekLow) fiftyTwoWeekLow = Number(mfQ.fiftyTwoWeekLow);
          if (mfQ.quoteDate) quoteDateStr = mfQ.quoteDate;
        }
      } catch (e) {
        console.warn(`[Holding Detail] Live MF NAV fetch warning for ${holding.symbol}:`, e.message);
      }
    }

    if (!quoteDateStr && holding.category_id === 'nps') {
      try {
        const npsQ = await fetchNpsNavFallback(holding.symbol);
        if (npsQ?.quoteDate) quoteDateStr = npsQ.quoteDate;
      } catch (e) {
        console.warn(`[Holding Detail] NPS NAV fallback warning for ${holding.symbol}:`, e.message);
      }
    }

    if (!quoteDateStr) quoteDateStr = liveQuoteCache.get(holding.symbol)?.quoteDate;
    if (!quoteDateStr && (holding.category_id === 'mutual_funds' || holding.category_id === 'nps')) {
      const lastPoint = activeTimelineData && activeTimelineData.length > 0 ? activeTimelineData[activeTimelineData.length - 1] : null;
      if (lastPoint && lastPoint.label) {
        quoteDateStr = formatCleanQuoteDate(lastPoint.label);
      }
    }
    if (!quoteDateStr && holding.updated_at) {
      quoteDateStr = formatCleanQuoteDate(holding.updated_at);
    }

    const dayChange = quotePrice - prevClose;
    const dayChangePct = prevClose > 0 ? Number(((dayChange / prevClose) * 100).toFixed(2)) : 0;

    const nonDivTxs = txs.filter(t => t.type !== 'DIVIDEND');
    const divTxs = txs.filter(t => t.type === 'DIVIDEND');

    const matchedDivTxIds = new Set();
    const formattedDivs = (divs || []).map(d => {
      const dDate = d.payment_date || d.ex_date || '';
      const amtUSD = Number(d.amount_original) || (Number(d.amount_inr) / (Number(d.fx_rate) || 1));
      const amtINR = Number(d.amount_inr) || (amtUSD * (Number(d.fx_rate) || liveRate));
      const dRate = Number(d.fx_rate) || (isUSStock ? (getHistoricalFxRate(dDate) || liveRate) : 1.0);
      const targetAmt = isUSStock ? amtUSD : amtINR;

      // Check if a corresponding dividend transaction exists in transactions table
      const matchedTx = divTxs.find(t =>
        !matchedDivTxIds.has(t.id) &&
        t.date === dDate &&
        Math.abs(Number(t.total_amount || 0) - targetAmt) < 0.05
      );
      if (matchedTx) {
        matchedDivTxIds.add(matchedTx.id);
      }

      return {
        id: matchedTx ? matchedTx.id : `div-${d.id}`,
        div_id: d.id,
        holding_id: d.holding_id || holding.id,
        user_id: d.user_id,
        symbol: d.symbol || holding.symbol,
        name: d.name || holding.name,
        type: 'DIVIDEND',
        quantity: 0,
        price: 0,
        total_amount: isUSStock ? Number(amtUSD.toFixed(2)) : Number(amtINR.toFixed(2)),
        currency: isUSStock ? 'USD' : 'INR',
        fx_rate: Number(dRate.toFixed(4)),
        charges: 0,
        date: dDate,
        notes: matchedTx?.notes || `Dividend: ${isUSStock ? '$' + amtUSD.toFixed(2) : '₹' + amtINR.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      };
    });

    // If there are any dividend transactions in transactions table that were not in dividends table, include them
    const orphanDivTxs = divTxs.filter(t => !matchedDivTxIds.has(t.id));

    const txTypePriority = { BUY: 1, BONUS: 1, DIVIDEND_REINVEST: 1, SPLIT: 2, SELL: 3, DIVIDEND: 4 };
    const mergedTransactions = [...nonDivTxs, ...formattedDivs, ...orphanDivTxs].sort((a, b) => {
      const da = a.date || '';
      const db = b.date || '';
      if (da !== db) return da.localeCompare(db);
      return (txTypePriority[a.type] || 9) - (txTypePriority[b.type] || 9);
    });

    const isFundOrNps = holding.category_id === 'mutual_funds' || holding.category_id === 'nps';
    const quoteDigits = isFundOrNps ? 4 : 2;

    res.json({
      holding,
      quote: {
        price: Number(quotePrice.toFixed(quoteDigits)),
        previousClose: Number(prevClose.toFixed(quoteDigits)),
        open: Number(openPrice.toFixed(quoteDigits)),
        high: Number(dayHigh.toFixed(quoteDigits)),
        low: Number(dayLow.toFixed(quoteDigits)),
        close: Number(quotePrice.toFixed(quoteDigits)),
        fiftyTwoWeekHigh: Number(fiftyTwoWeekHigh.toFixed(quoteDigits)),
        fiftyTwoWeekLow: Number(fiftyTwoWeekLow.toFixed(quoteDigits)),
        dayChange: Number(dayChange.toFixed(quoteDigits)),
        dayChangePct,
        quoteDate: quoteDateStr || 'Latest Available',
        currency: isUSStock ? 'USD' : 'INR'
      },
      fxRate: liveRate,
      transactions: mergedTransactions,
      dividends: divs,
      timelineUSD,
      timelineINR,
      metricsUSD: {
        totalInvested: Number(totalInvestedUSD.toFixed(2)),
        totalRedeemed: Number(totalRedeemedUSD.toFixed(2)),
        currentInvested: Number(costBasisUSD.toFixed(2)),
        totalCharges: Number((totalBuyChargesUSD + totalSellChargesUSD).toFixed(2)),
        buyCharges: Number(totalBuyChargesUSD.toFixed(2)),
        sellCharges: Number(totalSellChargesUSD.toFixed(2)),
        currentValue: Number(currentValueUSD.toFixed(2)),
        unrealizedPnl: Number(unrealizedPnlUSD.toFixed(2)),
        unrealizedPct: unrealizedPctUSD,
        realizedPnl: Number(realizedPnlUSD.toFixed(2)),
        totalDividends: Number(totalDividendsUSD.toFixed(2)),
        dividendCount: divs.length,
        totalXirr: totalXirrUSD
      },
      metricsINR: {
        totalInvested: Number(totalInvestedINR.toFixed(2)),
        totalRedeemed: Number(totalRedeemedINR.toFixed(2)),
        currentInvested: Number(costBasisINR.toFixed(2)),
        totalCharges: Number((totalBuyChargesINR + totalSellChargesINR).toFixed(2)),
        buyCharges: Number(totalBuyChargesINR.toFixed(2)),
        sellCharges: Number(totalSellChargesINR.toFixed(2)),
        currentValue: Number(currentValueINR.toFixed(2)),
        unrealizedPnl: Number(unrealizedPnlINR.toFixed(2)),
        unrealizedPct: unrealizedPctINR,
        realizedPnl: Number(realizedPnlINR.toFixed(2)),
        totalDividends: Number(totalDividendsINR.toFixed(2)),
        dividendCount: divs.length,
        totalXirr: totalXirrINR
      },
      timeline: isUSStock ? timelineUSD : timelineINR,
      metrics: {
        totalInvested: Number((isUSStock ? totalInvestedUSD : totalInvestedINR).toFixed(2)),
        totalRedeemed: Number((isUSStock ? totalRedeemedUSD : totalRedeemedINR).toFixed(2)),
        currentInvested: Number((isUSStock ? costBasisUSD : costBasisINR).toFixed(2)),
        totalCharges: Number(((isUSStock ? totalBuyChargesUSD : totalBuyChargesINR) + (isUSStock ? totalSellChargesUSD : totalSellChargesINR)).toFixed(2)),
        buyCharges: Number((isUSStock ? totalBuyChargesUSD : totalBuyChargesINR).toFixed(2)),
        sellCharges: Number((isUSStock ? totalSellChargesUSD : totalSellChargesINR).toFixed(2)),
        currentValue: Number((isUSStock ? currentValueUSD : currentValueINR).toFixed(2)),
        unrealizedPnl: Number((isUSStock ? unrealizedPnlUSD : unrealizedPnlINR).toFixed(2)),
        unrealizedPct: isUSStock ? unrealizedPctUSD : unrealizedPctINR,
        realizedPnl: Number((isUSStock ? realizedPnlUSD : realizedPnlINR).toFixed(2)),
        totalDividends: Number((isUSStock ? totalDividendsUSD : totalDividendsINR).toFixed(2)),
        dividendCount: divs.length,
        totalXirr: isUSStock ? totalXirrUSD : totalXirrINR
      }
    });
  } catch (err) {
    console.error('[API Error - /api/holding/detail]:', err);
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Unified Add Investment Endpoint
// -------------------------------------------------------------
router.post('/add-investment', authenticateToken, async (req, res) => {
  try {
    const { portfolio, data } = req.body;

    if (!portfolio || !data) {
      return res.status(400).json({ error: 'Missing portfolio type or data' });
    }

    const fxRate = await fetchFxRate();

    // Handle market-based portfolios (equities, mutual funds, NPS)
    if (['in_stocks', 'us_stocks', 'mutual_funds', 'nps'].includes(portfolio)) {
      const { symbol, name, quantity, price, amount, date, type, charges, fxRateOverride, schemeCode } = data;

      if (!symbol || !symbol.trim()) return res.status(400).json({ error: 'Symbol/Identifier Code is required and cannot be empty.' });
      if (!name || !name.trim()) return res.status(400).json({ error: 'Asset Name is required and cannot be empty.' });

      const txType = (type || 'BUY').toUpperCase();
      const txDate = date || new Date().toISOString().split('T')[0];

      if (!/^\d{4}-\d{2}-\d{2}$/.test(txDate)) {
        return res.status(400).json({ error: `Invalid date format '${txDate}'. Must be YYYY-MM-DD.` });
      }

      const rawQty = Number(quantity);
      const rawPrice = Number(price);
      const rawCharges = Number(charges) || 0;

      if (['BUY', 'SELL', 'REDEEM'].includes(txType)) {
        if ((isNaN(rawQty) || rawQty <= 0) && (isNaN(Number(amount)) || Number(amount) <= 0)) {
          return res.status(400).json({ error: `Invalid quantity '${quantity}'. Must be a positive number greater than zero.` });
        }
        if (isNaN(rawPrice) || rawPrice <= 0) {
          return res.status(400).json({ error: `Invalid price/NAV '${price}'. Must be a positive number greater than zero.` });
        }
      }

      let txQty = Math.abs(rawQty || 0);
      let txPrice = Math.abs(rawPrice || 0);
      let txCharges = Math.abs(rawCharges || 0);
      let txAmount = txQty * txPrice;

      if (txType === 'BUY') {
        txAmount += txCharges;
      } else if (txType === 'SELL') {
        txAmount -= txCharges;
      }

      // Handle MF SIP 0.015% automatic charges if amount was provided
      if (portfolio === 'mutual_funds' && txType === 'BUY' && data.amount) {
        const inputAmount = Math.abs(Number(data.amount));
        txCharges = Number((inputAmount * 0.00015).toFixed(4));
        txAmount = inputAmount - txCharges;
        txQty = Number((txAmount / txPrice).toFixed(4));
      }

      if (txType === 'BONUS') {
        txPrice = 0;
        txAmount = 0;
      }

      const isUS = portfolio === 'us_stocks';
      const currency = isUS ? 'USD' : 'INR';
      const txFxRate = isUS ? (Number(fxRateOverride) || (txDate ? getHistoricalFxRate(txDate) : null) || fxRate) : null;

      const symbolKey = (portfolio === 'mutual_funds' && schemeCode) ? schemeCode : symbol.trim().toUpperCase();

      let holdingId;
      const existingHoldings = await db.selectWhere('holdings', { category_id: portfolio, symbol: symbolKey });

      if (txType === 'SELL' || txType === 'REDEEM') {
        if (existingHoldings.length === 0 || (Number(existingHoldings[0].quantity) || 0) <= 0) {
          return res.status(400).json({
            error: `Cannot sell ${symbolKey}: you do not have any active shares of this investment in your portfolio.`
          });
        }
        const currentOpenShares = Number(existingHoldings[0].quantity) || 0;
        if (txQty > currentOpenShares + 0.0001) {
          return res.status(400).json({
            error: `Cannot sell ${txQty} shares of ${symbolKey}: only ${currentOpenShares.toLocaleString('en-IN', { maximumFractionDigits: 4 })} shares are currently held in your portfolio.`
          });
        }
      }

      if (existingHoldings.length > 0) {
        holdingId = existingHoldings[0].id;
      } else {
        const exchange = portfolio === 'in_stocks' ? 'NSE' :
          portfolio === 'us_stocks' ? 'NASDAQ' :
            portfolio === 'mutual_funds' ? 'AMFI' : 'NPS';

        const newHolding = await db.insert('holdings', {
          category_id: portfolio,
          symbol: symbolKey,
          name: name.trim(),
          exchange: exchange,
          quantity: 0,
          avg_buy_price: 0,
          current_price: txPrice,
          currency: currency,
          status: 'ACTIVE'
        });
        holdingId = newHolding.id;
      }

      if (txType === 'DIVIDEND') {
        const divAmount = Number(data.dividendAmount) || txAmount;
        if (isNaN(divAmount) || divAmount <= 0) {
          return res.status(400).json({ error: 'Dividend amount must be a positive number.' });
        }

        await db.insert('dividends', {
          holding_id: holdingId,
          symbol: symbolKey,
          name: name.trim(),
          amount_original: divAmount,
          currency: currency,
          fx_rate: txFxRate || 1.0,
          amount_inr: isUS ? divAmount * (txFxRate || fxRate) : divAmount,
          payment_date: txDate
        });

        return res.json({ success: true, holdingId, action: 'dividend_recorded' });
      }

      if (txType === 'SPLIT') {
        const oldQty = Number(data.splitOldQty) || 1;
        const newQtyRatio = Number(data.splitNewQty) || 1;
        if (isNaN(oldQty) || oldQty <= 0 || isNaN(newQtyRatio) || newQtyRatio <= 0) {
          return res.status(400).json({ error: 'Split Old Ratio and New Ratio must be valid numbers greater than zero.' });
        }

        if (existingHoldings.length === 0 || (Number(existingHoldings[0].quantity) || 0) <= 0) {
          return res.status(400).json({ error: `Cannot perform stock split on ${symbolKey}: no active shares found in portfolio.` });
        }

        const splitRatio = newQtyRatio / oldQty;
        const holding = existingHoldings[0];
        const preSplitQty = Number(holding.quantity) || 0;
        const preSplitAvg = Number(holding.avg_buy_price) || 0;

        const newQty = preSplitQty * splitRatio;
        const newAvg = preSplitAvg / splitRatio;
        const newBuyQty = (Number(holding.buy_qty) || preSplitQty) * splitRatio;
        const addedShares = newQty - preSplitQty;

        await db.update('holdings', holdingId, {
          quantity: parseFloat(newQty.toFixed(4)),
          buy_qty: parseFloat(newBuyQty.toFixed(4)),
          avg_buy_price: parseFloat(newAvg.toFixed(4)),
          updated_at: new Date().toISOString()
        });

        await db.insert('transactions', {
          holding_id: holdingId,
          type: 'SPLIT',
          quantity: parseFloat(addedShares.toFixed(4)),
          price: 0,
          total_amount: 0,
          charges: 0,
          currency: currency,
          date: txDate,
          symbol: symbolKey,
          name: name.trim(),
          notes: `Stock split ${oldQty}:${newQtyRatio} — holding scaled from ${preSplitQty} to ${newQty} shares, avg cost adjusted from ₹${preSplitAvg.toFixed(2)} to ₹${newAvg.toFixed(2)}`
        });

        await recalculateHoldingState(holdingId);
        return res.json({ success: true, holdingId, action: 'split_applied' });
      }

      if (txType === 'BONUS') {
        if (isNaN(txQty) || txQty <= 0) {
          return res.status(400).json({ error: 'Bonus quantity must be a positive number greater than zero.' });
        }

        if (existingHoldings.length === 0 || (Number(existingHoldings[0].quantity) || 0) <= 0) {
          return res.status(400).json({ error: `Cannot credit bonus shares for ${symbolKey}: no active shares found in portfolio.` });
        }

        const holding = existingHoldings[0];
        const preBonusQty = Number(holding.quantity) || 0;
        const preBonusAvg = Number(holding.avg_buy_price) || 0;

        const newQty = preBonusQty + txQty;
        const newAvg = (preBonusQty * preBonusAvg) / newQty;
        const newBuyQty = (Number(holding.buy_qty) || preBonusQty) + txQty;

        await db.update('holdings', holdingId, {
          quantity: parseFloat(newQty.toFixed(4)),
          buy_qty: parseFloat(newBuyQty.toFixed(4)),
          avg_buy_price: parseFloat(newAvg.toFixed(4)),
          updated_at: new Date().toISOString()
        });

        await db.insert('transactions', {
          holding_id: holdingId,
          type: 'BONUS',
          quantity: txQty,
          price: 0,
          total_amount: 0,
          charges: txCharges,
          currency: currency,
          date: txDate,
          symbol: symbolKey,
          name: name.trim(),
          notes: `Bonus issue (+${txQty} shares credited at ₹0 cost, avg cost diluted from ₹${preBonusAvg.toFixed(2)} to ₹${newAvg.toFixed(2)})`
        });

        await recalculateHoldingState(holdingId);
        return res.json({ success: true, holdingId, action: 'bonus_applied' });
      }

      const txRecord = {
        holding_id: holdingId,
        type: txType,
        quantity: txQty,
        price: txPrice,
        total_amount: txAmount,
        charges: txCharges,
        currency: currency,
        date: txDate,
        symbol: symbolKey,
        name: name.trim(),
        notes: data.notes || `${txType} ${txQty} units of ${name} @ ${currency === 'USD' ? '$' : '₹'}${txPrice}`
      };

      if (txFxRate) txRecord.fx_rate = txFxRate;

      await db.insert('transactions', txRecord);
      await recalculateHoldingState(holdingId);
      invalidateBenchmarkCache();
      triggerEodRebuildIfPastDate(txDate);

      if (existingHoldings.length === 0 && (portfolio === 'in_stocks' || portfolio === 'us_stocks')) {
        import('../../scripts/sync_asset_metadata.mjs')
          .then(m => m.syncAssetMetadata(false))
          .catch(e => console.error('[Background Sync Error]:', e));
      }

      return res.json({ success: true, holdingId, action: 'transaction_recorded' });
    }

    // Handle Bank / EPF
    if (portfolio === 'bank' || portfolio === 'epf') {
      const { name: accName, balance, amount, type: rawType, date: entryDate, notes } = data;
      if (!accName) return res.status(400).json({ error: 'Account name is required' });

      const symbolKey = portfolio === 'epf' ? 'EPF-RETIREMENT' :
        accName.toUpperCase().replace(/\s+/g, '-') + '-SAVINGS';

      const existing = await db.selectWhere('holdings', { category_id: portfolio, symbol: symbolKey });
      let holdingId;

      if (existing.length > 0) {
        holdingId = existing[0].id;
      } else {
        const newHolding = await db.insert('holdings', {
          category_id: portfolio,
          symbol: symbolKey,
          name: accName,
          exchange: portfolio === 'bank' ? 'BANK' : 'EPF',
          quantity: 1,
          avg_buy_price: 0,
          current_price: 0,
          currency: 'INR',
          status: 'ACTIVE'
        });
        holdingId = newHolding[0]?.id || newHolding.id;
      }

      const txDate = entryDate || new Date().toISOString().split('T')[0];

      if (amount !== undefined && Number(amount) > 0) {
        const amt = Number(amount);
        let txType = (rawType || '').toUpperCase();
        if (!txType) {
          txType = portfolio === 'epf' ? 'CONTRIBUTION' : 'CREDIT';
        }

        await db.insert('transactions', {
          holding_id: holdingId,
          type: txType,
          quantity: 1,
          price: amt,
          total_amount: amt,
          charges: 0,
          currency: 'INR',
          date: txDate,
          symbol: symbolKey,
          name: accName,
          notes: notes || `${portfolio === 'epf' ? 'EPF' : 'Bank'} ${txType}: ₹${amt.toFixed(2)}`
        });
      } else if (balance !== undefined) {
        const currentBal = existing.length > 0 ? (Number(existing[0].current_price) || 0) : 0;
        const targetBal = Math.max(0, Number(balance));
        const diff = targetBal - currentBal;

        if (Math.abs(diff) > 0.001) {
          let txType;
          if (portfolio === 'epf') {
            txType = diff > 0 ? 'CONTRIBUTION' : 'WITHDRAWAL';
          } else {
            txType = diff > 0 ? 'CREDIT' : 'DEBIT';
          }

          await db.insert('transactions', {
            holding_id: holdingId,
            type: txType,
            quantity: 1,
            price: Math.abs(diff),
            total_amount: Math.abs(diff),
            charges: 0,
            currency: 'INR',
            date: txDate,
            symbol: symbolKey,
            name: accName,
            notes: notes || `Balance Adjustment (${diff > 0 ? '+' : '-'}₹${Math.abs(diff).toFixed(2)})`
          });
        }
      }

      await recalculateHoldingState(holdingId);
      triggerEodRebuildIfPastDate(txDate);
      return res.json({ success: true, holdingId, action: 'ledger_updated' });
    }

    // Handle Loan
    if (portfolio === 'loans') {
      const { name: loanName, balance, amount, type: rawType, date: entryDate, notes } = data;
      if (!loanName) return res.status(400).json({ error: 'Loan name is required' });

      const existing = await db.selectWhere('liabilities', { category_id: 'loans', name: loanName });
      let liabilityId;

      if (existing.length > 0) {
        liabilityId = existing[0].id;
      } else {
        const inserted = await db.insert('liabilities', {
          category_id: 'loans',
          name: loanName,
          total_principal: Number(balance || amount || 0),
          outstanding_balance: 0,
          updated_at: new Date().toISOString()
        });
        liabilityId = inserted[0]?.id || inserted.id;
      }

      const txDate = entryDate || new Date().toISOString().split('T')[0];

      if (amount !== undefined && Number(amount) > 0) {
        const amt = Number(amount);
        const txType = (rawType || 'EMI_PAYMENT').toUpperCase();

        await db.insert('transactions', {
          holding_id: null,
          liability_id: liabilityId,
          type: txType,
          quantity: 1,
          price: amt,
          total_amount: amt,
          charges: 0,
          currency: 'INR',
          date: txDate,
          symbol: 'LOAN',
          name: loanName,
          notes: notes || `Loan ${txType}: ₹${amt.toFixed(2)}`
        });
      } else if (balance !== undefined) {
        const currentBal = existing.length > 0 ? (Number(existing[0].outstanding_balance) || 0) : 0;
        const targetBal = Math.max(0, Number(balance));
        const diff = targetBal - currentBal;

        if (Math.abs(diff) > 0.001) {
          const txType = diff > 0 ? 'BORROW' : 'EMI_PAYMENT';
          await db.insert('transactions', {
            holding_id: null,
            liability_id: liabilityId,
            type: txType,
            quantity: 1,
            price: Math.abs(diff),
            total_amount: Math.abs(diff),
            charges: 0,
            currency: 'INR',
            date: txDate,
            symbol: 'LOAN',
            name: loanName,
            notes: notes || `Loan Adjustment (${diff > 0 ? '+' : '-'}₹${Math.abs(diff).toFixed(2)})`
          });
        }
      }

      await recalculateHoldingState(liabilityId);
      triggerEodRebuildIfPastDate(txDate);
      return res.json({ success: true, liabilityId, action: 'loan_ledger_updated' });
    }

    // Handle Credit Card
    if (portfolio === 'credit_cards') {
      const { name: cardName, balance, amount, type: rawType, date: entryDate, notes } = data;
      if (!cardName) return res.status(400).json({ error: 'Card name is required' });

      const existing = await db.selectWhere('liabilities', { category_id: 'credit_cards', name: cardName });
      let cardId;

      if (existing.length > 0) {
        cardId = existing[0].id;
      } else {
        const newCard = await db.insert('liabilities', {
          category_id: 'credit_cards',
          name: cardName,
          total_principal: 0,
          outstanding_balance: 0,
          updated_at: new Date().toISOString()
        });
        cardId = newCard[0]?.id || newCard.id;
      }

      const txDate = entryDate || new Date().toISOString().split('T')[0];

      if (amount !== undefined && Number(amount) > 0) {
        const amt = Number(amount);
        const txType = (rawType || 'CHARGE').toUpperCase();

        await db.insert('transactions', {
          holding_id: null,
          liability_id: cardId,
          type: txType,
          quantity: 1,
          price: amt,
          total_amount: amt,
          charges: 0,
          currency: 'INR',
          date: txDate,
          symbol: 'CARD',
          name: cardName,
          notes: notes || `Card ${txType}: ₹${amt.toFixed(2)}`
        });
      } else if (balance !== undefined) {
        const currentBal = existing.length > 0 ? (Number(existing[0].outstanding_balance) || 0) : 0;
        const targetBal = Math.max(0, Number(balance));
        const diff = targetBal - currentBal;

        if (Math.abs(diff) > 0.001) {
          const txType = diff > 0 ? 'CHARGE' : 'BILL_PAYMENT';
          await db.insert('transactions', {
            holding_id: null,
            liability_id: cardId,
            type: txType,
            quantity: 1,
            price: Math.abs(diff),
            total_amount: Math.abs(diff),
            charges: 0,
            currency: 'INR',
            date: txDate,
            symbol: 'CARD',
            name: cardName,
            notes: notes || `Card Adjustment (${diff > 0 ? '+' : '-'}₹${Math.abs(diff).toFixed(2)})`
          });
        }
      }

      await recalculateHoldingState(cardId);
      triggerEodRebuildIfPastDate(txDate);
      return res.json({ success: true, cardId, action: 'card_ledger_updated' });
    }

    return res.status(400).json({ error: `Unknown portfolio type: ${portfolio}` });
  } catch (err) {
    console.error('[Add Investment Error]:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
