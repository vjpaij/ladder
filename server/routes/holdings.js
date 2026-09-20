import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { supabase } from '../supabaseClient.js';
import { 
  fetchFxRate, 
  liveQuoteCache, 
  resolveHoldingPrice,
  fetchStockQuote, 
  fetchMutualFundNav, 
  fetchNpsNavFallback, 
  fetchNpsHistoricalNav, 
  formatCleanQuoteDate 
} from '../services/priceEngine.js';
import { getHistoricalFxRate, getPersistedRate } from '../services/fxRateStore.js';
import { getHistoricalPricesMap, ensureHistoricalPricesForSymbol, formatDateDDMMYYYY } from '../services/historicalPriceStore.js';
import { computeHoldingValueINR } from '../services/portfolioCalculator.js';
import { recalculateHoldingState } from '../services/recalculator.js';
import { calculateXirr } from '../services/xirrCalculator.js';
import { invalidateBenchmarkCache } from '../services/benchmarkEngine.js';
import { triggerEodRebuildIfPastDate } from '../services/eodSync.js';
import { getLoanAmortizationData } from '../services/loanEngine.js';
import { authenticateToken } from '../middleware/auth.js';
import { recordDividend, getHoldingDividends } from '../services/dividendService.js';
import { applyStockSplit } from '../services/corporateActionService.js';

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
    const allDivs = await db.select('dividends');

    // Pre-group transactions by holding_id and symbol
    const txsByHolding = new Map();
    for (const t of allTxs) {
      const k1 = t.holding_id;
      const k2 = t.symbol;
      if (k1) {
        if (!txsByHolding.has(k1)) txsByHolding.set(k1, []);
        txsByHolding.get(k1).push(t);
      }
      if (k2 && k2 !== k1) {
        if (!txsByHolding.has(k2)) txsByHolding.set(k2, []);
        txsByHolding.get(k2).push(t);
      }
    }

    // Pre-group dividends by holding_id and symbol
    const divsByHolding = new Map();
    for (const d of allDivs) {
      const k1 = d.holding_id;
      const k2 = d.symbol;
      if (k1) {
        if (!divsByHolding.has(k1)) divsByHolding.set(k1, []);
        divsByHolding.get(k1).push(d);
      }
      if (k2 && k2 !== k1) {
        if (!divsByHolding.has(k2)) divsByHolding.set(k2, []);
        divsByHolding.get(k2).push(d);
      }
    }

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

    // Fetch Asset Metadata to map sector and capitalisation (via cached db.select to eliminate egress)
    let metaData = null;
    try {
      metaData = await db.select('asset_metadata');
    } catch (e) {
      console.warn('[Holdings Route] Cached asset_metadata query failed:', e.message);
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

    const formatted = holdings.map(h => {
      const isUSD = h.currency === 'USD';
      const liveRate = isUSD ? fxRate : 1.0;
      let txRate = 1.0;
      if (isUSD) {
        const m = usFxMap[h.id] || usFxMap[h.symbol];
        txRate = (m && m.totalUSD > 0) ? (m.totalINR / m.totalUSD) : (getHistoricalFxRate(h.created_at) || getPersistedRate('USD_INR') || fxRate || 1.0);
      }

      const isFundOrNps = h.category_id === 'mutual_funds' || h.category_id === 'nps';
      const precisionDigits = isFundOrNps ? 4 : 2;

      // Transactions FIFO simulation for this holding
      const txs = (txsByHolding.get(h.id) || (h.symbol ? txsByHolding.get(h.symbol) : null) || [])
        .slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));

      let openLots = [];
      let totalBuyQty = 0;
      let totalBuyCostUSD = 0;
      let totalBuyCostINR = 0;
      let totalSellQty = 0;
      let grossSellProceedsUSD = 0;
      let grossSellProceedsINR = 0;
      let netSellProceedsUSD = 0;
      let netSellProceedsINR = 0;
      let realizedTradingPnlUSD = 0;
      let realizedTradingPnlINR = 0;

      for (const tx of txs) {
        const type = (tx.type || 'BUY').toUpperCase();
        const qty = Number(tx.quantity) || 0;
        const price = Number(tx.price) || 0;
        const charges = Number(tx.charges) || 0;
        const lotFxRate = isUSD ? (Number(tx.fx_rate) || getHistoricalFxRate(tx.date) || txRate || 1.0) : 1.0;

        if (type === 'BUY' || type === 'INVESTMENT' || type === 'INVESTMENT (SIP)') {
          totalBuyQty += qty;
          const storedAmt = Number(tx.total_amount);
          const amtUSD = (isFundOrNps && Number.isFinite(storedAmt)) ? storedAmt : (qty * price);
          const amtINR = (isFundOrNps && Number.isFinite(storedAmt)) ? storedAmt : (amtUSD * lotFxRate);

          totalBuyCostUSD += amtUSD + charges;
          totalBuyCostINR += amtINR + (charges * lotFxRate);

          openLots.push({
            qty,
            rem: qty,
            priceUSD: price,
            chargesUSD: charges,
            fxRate: lotFxRate,
            amount: storedAmt
          });
        } else if (type === 'BONUS' || type === 'SPLIT') {
          if (qty > 0) {
            totalBuyQty += qty;
            openLots.push({
              qty,
              rem: qty,
              priceUSD: 0,
              chargesUSD: 0,
              fxRate: lotFxRate,
              amount: 0
            });
          }
        } else if (type === 'SELL' || type === 'REDEEM' || type === 'REDEMPTION') {
          totalSellQty += qty;
          const rawProceedsUSD = qty * price;
          const rawProceedsINR = rawProceedsUSD * lotFxRate;
          grossSellProceedsUSD += rawProceedsUSD;
          grossSellProceedsINR += rawProceedsINR;
          netSellProceedsUSD += Math.max(0, rawProceedsUSD - charges);
          netSellProceedsINR += Math.max(0, rawProceedsINR - (charges * lotFxRate));

          let remToSell = qty;
          let costSoldUSD = 0;
          let costSoldINR = 0;

          for (const lot of openLots) {
            if (remToSell <= 0) break;
            if (lot.rem > 0) {
              const take = Math.min(lot.rem, remToSell);
              lot.rem -= take;
              const lotChargeRatioUSD = (lot.qty > 0 && lot.chargesUSD > 0) ? (take / lot.qty) * lot.chargesUSD : 0;

              if (isFundOrNps && Number.isFinite(lot.amount)) {
                const unitCost = lot.qty > 0 ? (lot.amount + (lot.chargesUSD || 0)) / lot.qty : 0;
                costSoldUSD += take * unitCost;
                costSoldINR += take * unitCost * lot.fxRate;
              } else {
                costSoldUSD += (take * lot.priceUSD) + lotChargeRatioUSD;
                costSoldINR += (take * lot.priceUSD * lot.fxRate) + (lotChargeRatioUSD * lot.fxRate);
              }
              remToSell -= take;
            }
          }

          realizedTradingPnlUSD += (rawProceedsUSD - charges - costSoldUSD);
          realizedTradingPnlINR += (rawProceedsINR - (charges * lotFxRate) - costSoldINR);
        }
      }

      // Dividends for this holding
      const divs = divsByHolding.get(h.id) || (h.symbol ? divsByHolding.get(h.symbol) : null) || [];
      let totalDividendsUSD = 0;
      let totalDividendsINR = 0;
      for (const d of divs) {
        const dAmtOrig = Number(d.amount_original) || 0;
        const dAmtINR = Number(d.amount_inr) || 0;
        const dFx = Number(d.fx_rate) || 1.0;
        if (isUSD) {
          totalDividendsUSD += dAmtOrig || (dAmtINR / dFx);
          totalDividendsINR += dAmtINR || (dAmtOrig * dFx);
        } else {
          totalDividendsINR += dAmtINR || dAmtOrig;
          totalDividendsUSD += dAmtOrig || dAmtINR;
        }
      }

      // Active lots and FIFO cost basis
      const activeLots = openLots.filter(l => l.rem > 0);
      const openShares = activeLots.reduce((s, l) => s + l.rem, 0);

      let openCostUSD = 0;
      let openCostINR = 0;
      for (const lot of activeLots) {
        const lotChargeUSD = (lot.qty > 0 && lot.chargesUSD > 0) ? (lot.rem / lot.qty) * lot.chargesUSD : 0;
        if (isFundOrNps && Number.isFinite(lot.amount)) {
          const unitCost = lot.qty > 0 ? (lot.amount + (lot.chargesUSD || 0)) / lot.qty : 0;
          openCostUSD += lot.rem * unitCost;
          openCostINR += lot.rem * unitCost * lot.fxRate;
        } else {
          openCostUSD += (lot.rem * lot.priceUSD) + lotChargeUSD;
          openCostINR += (lot.rem * lot.priceUSD * lot.fxRate) + (lotChargeUSD * lot.fxRate);
        }
      }

      const unrealizedAvgBuyUSD = openShares > 0 ? (openCostUSD / openShares) : (Number(h.avg_buy_price) || 0);
      const unrealizedAvgBuyINR = openShares > 0 ? (openCostINR / openShares) : (Number(h.avg_buy_price) || 0);

      const consolidatedAvgBuyUSD = totalBuyQty > 0 ? (totalBuyCostUSD / totalBuyQty) : (Number(h.avg_buy_price) || 0);
      const consolidatedAvgBuyINR = totalBuyQty > 0 ? (totalBuyCostINR / totalBuyQty) : (Number(h.avg_buy_price) || 0);

      const qty = Number(h.quantity) || 0;
      const isClosed = qty <= 0;

      // Required Avg Price logic:
      // Active holding: Unrealized FIFO average buy price
      // Fully sold holding: Consolidated average buy price of all purchases
      let finalAvgBuyPrice = 0;
      if (!isClosed) {
        finalAvgBuyPrice = isUSD ? unrealizedAvgBuyUSD : unrealizedAvgBuyINR;
        if (txs.length === 0 || openShares <= 0) {
          finalAvgBuyPrice = Number(h.avg_buy_price) || 0;
        }
      } else {
        finalAvgBuyPrice = isUSD ? consolidatedAvgBuyUSD : consolidatedAvgBuyINR;
        if (txs.length === 0 || totalBuyQty <= 0) {
          finalAvgBuyPrice = Number(h.avg_buy_price) || 0;
        }
      }

      const liveQuote = liveQuoteCache.get(h.symbol);
      const currentPriceNum = resolveHoldingPrice(h, liveQuote);
      const currentValueOriginal = qty * currentPriceNum;
      const currentValueINR = computeHoldingValueINR(h, currentPriceNum, fxRate);

      // Rule 5: Zero-quantity assets must have investedValueINR = 0
      const investedValueOriginal = !isClosed ? (qty * finalAvgBuyPrice) : 0;
      const investedValueINR = !isClosed ? (isUSD ? (openCostINR > 0 ? openCostINR : investedValueOriginal * txRate) : investedValueOriginal) : 0;

      const gainINR = !isClosed ? (currentValueINR - investedValueINR) : 0;
      const gainPct = (!isClosed && investedValueINR > 0) ? Number(((gainINR / investedValueINR) * 100).toFixed(2)) : 0;

      const unrealizedPnlOriginal = !isClosed ? (currentValueOriginal - investedValueOriginal) : 0;
      const unrealizedPnlINR = gainINR;

      const soldQty = isClosed 
        ? (Number(h.sell_qty) || totalSellQty || Number(h.buy_qty) || 0)
        : totalSellQty;
      const avgSellPrice = totalSellQty > 0
        ? Number((isUSD ? (grossSellProceedsUSD / totalSellQty) : (grossSellProceedsINR / totalSellQty)).toFixed(precisionDigits))
        : (Number(h.avg_sell_price) || 0);
      const redeemedValue = Number((isUSD ? netSellProceedsUSD : netSellProceedsINR).toFixed(2));
      const grossRedeemed = Number((isUSD ? grossSellProceedsUSD : grossSellProceedsINR).toFixed(2));

      const realizedPnlUSD = (txs.length > 0) ? realizedTradingPnlUSD : (Number(h.realized_pnl) || 0);
      const realizedPnlINR = (txs.length > 0) ? realizedTradingPnlINR : ((Number(h.realized_pnl) || 0) * (isUSD ? fxRate : 1.0));
      const totalDividends = Number((isUSD ? totalDividendsUSD : totalDividendsINR).toFixed(2));

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
        avg_buy_price: Number(finalAvgBuyPrice.toFixed(precisionDigits)),
        unrealized_avg_buy_price: Number((isUSD ? unrealizedAvgBuyUSD : unrealizedAvgBuyINR).toFixed(precisionDigits)),
        consolidated_avg_buy_price: Number((isUSD ? consolidatedAvgBuyUSD : consolidatedAvgBuyINR).toFixed(precisionDigits)),
        current_price: currentPriceNum,
        nse_price: (liveQuote && liveQuote.nse_price > 0) ? liveQuote.nse_price : (Number(h.nse_price) || 0),
        bse_price: (liveQuote && liveQuote.bse_price > 0) ? liveQuote.bse_price : (Number(h.bse_price) || 0),
        sector: finalSector,
        market_cap: finalMcap,
        market_cap_cr: meta.market_cap || null,
        industry: meta.industry || null,
        category_name: catMap[h.category_id] ? catMap[h.category_id].name : h.category_id,
        category_color: catMap[h.category_id] ? catMap[h.category_id].color : '#3B82F6',
        fxRate: liveRate,
        txFxRate: Number(txRate.toFixed(2)),
        day_change: isFundOrNps ? Number(Number(dayChange || 0).toFixed(4)) : Number(Number(dayChange || 0).toFixed(2)),
        day_change_pct: Number(Number(dayChangePct || 0).toFixed(2)),
        prev_price: isFundOrNps ? Number(prevPrice.toFixed(4)) : Number(prevPrice.toFixed(2)),
        quote_date: liveQuote?.quoteDate || (h.updated_at ? h.updated_at.split('T')[0] : null),
        currentValueOriginal: Number(currentValueOriginal.toFixed(2)),
        currentValueINR: Number(currentValueINR.toFixed(2)),
        investedValueINR: Number(investedValueINR.toFixed(2)),
        investedValueOriginal: Number(investedValueOriginal.toFixed(2)),
        gainINR: Number(gainINR.toFixed(2)),
        gainPct: Number(gainPct),
        unrealized_pnl: Number((isUSD ? unrealizedPnlOriginal : unrealizedPnlINR).toFixed(2)),
        unrealized_pnl_inr: Number(unrealizedPnlINR.toFixed(2)),
        unrealized_pnl_pct: Number(gainPct),
        realized_pnl: Number((isUSD ? realizedPnlUSD : realizedPnlINR).toFixed(2)),
        realized_pnl_inr: Number(realizedPnlINR.toFixed(2)),
        realized_pnl_total: Number(((isUSD ? realizedPnlUSD : realizedPnlINR) + (isUSD ? totalDividendsUSD : totalDividendsINR)).toFixed(2)),
        total_dividends: totalDividends,
        total_dividends_inr: Number(totalDividendsINR.toFixed(2)),
        sold_qty: soldQty,
        avg_sell_price: avgSellPrice,
        redeemed_value: redeemedValue,
        gross_redeemed: grossRedeemed
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
        try {
          const allTxs = await db.select('transactions');
          const matched = (allTxs || []).filter(t => 
            String(t.holding_id) === String(holding.id) ||
            String(t.liability_id) === String(holding.id) ||
            (t.symbol && t.symbol === holding.symbol)
          ).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          if (matched.length > 0) txs = matched;
        } catch (e) {
          console.warn('[Detail API db.select transactions Warning]:', e.message);
        }
        if (txs.length === 0) {
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
        }

        if (holding.category_id === 'loans') {
          try {
            const { data: amortRows } = await supabase
              .from('loan_amortization')
              .select('date, closing_balance')
              .eq('liability_id', holding.id);
            if (amortRows && amortRows.length > 0) {
              const amortMap = new Map();
              amortRows.forEach(r => amortMap.set(r.date, Number(r.closing_balance)));
              txs = txs.map(t => ({
                ...t,
                runningBalance: amortMap.has(t.date) ? amortMap.get(t.date) : t.runningBalance
              }));
            }
          } catch (err) {
            console.warn('[Loan Detail Amort Map Error]:', err.message);
          }
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

    let txs = [];
    try {
      const allTxs = await db.select('transactions');
      txs = (allTxs || []).filter(t => 
        String(t.holding_id) === String(holding.id) || (t.symbol && t.symbol === holding.symbol)
      ).sort((a, b) => {
        const dDiff = (a.date || '').localeCompare(b.date || '');
        if (dDiff !== 0) return dDiff;
        return (a.created_at || '').localeCompare(b.created_at || '');
      });
    } catch (txErr) {
      console.warn('[Detail API db.select transactions Warning]:', txErr.message);
    }
    if (txs.length === 0) {
      const { data: txsData, error: txErr } = await supabase
        .from('transactions')
        .select('*')
        .or(`holding_id.eq.${holding.id},symbol.eq.${holding.symbol}`)
        .order('date', { ascending: true })
        .order('created_at', { ascending: true });
      if (txErr) console.error('[Detail API] Tx Fetch Error:', txErr.message);
      txs = txsData || [];
    }

    let divs = [];
    try {
      const allDivs = await db.select('dividends');
      divs = (allDivs || []).filter(d => 
        String(d.holding_id) === String(holding.id) || (d.symbol && d.symbol === holding.symbol)
      ).sort((a, b) => (a.ex_date || a.payment_date || '').localeCompare(b.ex_date || b.payment_date || ''));
    } catch (divErr) {
      console.warn('[Detail API db.select dividends Warning]:', divErr.message);
    }
    if (divs.length === 0) {
      const { data: divsData, error: divErr } = await supabase
        .from('dividends')
        .select('*')
        .or(`holding_id.eq.${holding.id},symbol.eq.${holding.symbol}`)
        .order('ex_date', { ascending: true });
      if (divErr) console.error('[Detail API] Div Fetch Error:', divErr.message);
      divs = divsData || [];
    }

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
      const rawPrincipalUSD = qty * price;
      const txRate = isUSStock ? (Number(tx.fx_rate) || getHistoricalFxRate(tx.date)) : 1.0;
      const rawPrincipalINR = rawPrincipalUSD * txRate;
      const chargesUSD = Number(tx.charges) || 0;
      const chargesINR = chargesUSD * txRate;

      if (tx.type === 'BUY') {
        totalBuyChargesUSD += chargesUSD;
        totalBuyChargesINR += chargesINR;
        const storedAmount = Number(tx.total_amount);
        const transactionAmountUSD = (holding.category_id === 'mutual_funds' && Number.isFinite(storedAmount))
          ? storedAmount
          : rawPrincipalUSD;
        totalInvestedUSD += transactionAmountUSD + chargesUSD;
        totalInvestedINR += (holding.category_id === 'mutual_funds' && Number.isFinite(storedAmount)
          ? storedAmount
          : rawPrincipalINR) + chargesINR;
        buyLotsUSD.push({ qty, price, charges: chargesUSD, rem: qty });
        buyLotsINR.push({
          qty,
          priceUSD: price,
          fxRate: txRate,
          amount: Number(tx.total_amount),
          charges: chargesINR,
          rem: qty
        });
      } else if (tx.type === 'BONUS' || tx.type === 'DIVIDEND_REINVEST') {
        if (qty > 0) {
          buyLotsUSD.push({ qty, price: 0, charges: 0, rem: qty });
          buyLotsINR.push({ qty, priceUSD: 0, fxRate: txRate, charges: 0, rem: qty });
        }
      } else if (tx.type === 'SPLIT') {
        const splitQty = Number(tx.quantity) || 0;
        if (splitQty > 0) {
          buyLotsUSD.push({ qty: splitQty, price: 0, charges: 0, rem: splitQty });
          buyLotsINR.push({ qty: splitQty, priceUSD: 0, fxRate: txRate, charges: 0, rem: splitQty });
        }
      } else if (tx.type === 'SELL' || tx.type === 'REDEEM' || tx.type === 'REDEMPTION') {
        totalSellChargesUSD += chargesUSD;
        totalSellChargesINR += chargesINR;
        const netProceedsUSD = Math.max(0, rawPrincipalUSD - chargesUSD);
        const netProceedsINR = Math.max(0, rawPrincipalINR - chargesINR);
        totalRedeemedUSD += netProceedsUSD;
        totalRedeemedINR += netProceedsINR;

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
        if (remUSD > 0) {
          realizedPnlUSD += (remUSD * price);
          remUSD = 0;
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
        if (remINR > 0) {
          realizedPnlINR += (remINR * price * txRate);
          remINR = 0;
        }
      }
    }

    const liveQuote = liveQuoteCache.get(holding.symbol);
    const activeLotsINR = buyLotsINR.filter(l => l.rem > 0);
    const dynamicOpenShares = activeLotsINR.reduce((s, l) => s + l.rem, 0);
    const currentQty = (txs.length > 0) ? dynamicOpenShares : (Number(holding.quantity) || 0);

    const activeLotsUSD = buyLotsUSD.filter(l => l.rem > 0);
    let dynamicCostBasisUSD = 0;
    for (const lot of activeLotsUSD) {
      const lotCost = lot.rem * lot.price;
      const lotCharge = lot.qty > 0 ? (lot.rem / lot.qty) * (lot.charges || 0) : 0;
      dynamicCostBasisUSD += lotCost + lotCharge;
    }
    const avgBuyPriceUSD = (dynamicOpenShares > 0 && txs.length > 0)
      ? (dynamicCostBasisUSD / dynamicOpenShares)
      : (Number(holding.avg_buy_price) || 0);

    const currentPriceUSD = resolveHoldingPrice(holding, liveQuote);

    const currentValueUSD = currentQty * currentPriceUSD;
    const costBasisUSD = dynamicCostBasisUSD > 0 ? dynamicCostBasisUSD : (currentQty * avgBuyPriceUSD);
    const unrealizedPnlUSD = currentValueUSD - costBasisUSD;
    const unrealizedPctUSD = costBasisUSD > 0 ? Number(((unrealizedPnlUSD / costBasisUSD) * 100).toFixed(2)) : 0;

    const currentValueINR = currentValueUSD * liveRate;
    const costBasisINR = activeLotsINR.length > 0
      ? activeLotsINR.reduce((s, l) => {
          if (holding.category_id === 'mutual_funds' && Number.isFinite(l.amount)) {
            const lotCost = l.amount + (l.charges || 0);
            return s + (l.qty > 0 ? (l.rem / l.qty) * lotCost : 0);
          }
          const lotCost = l.rem * l.priceUSD * l.fxRate;
          const lotCharge = l.qty > 0 ? (l.rem / l.qty) * (l.charges || 0) : 0;
          return s + lotCost + lotCharge;
        }, 0)
      : (costBasisUSD * (totalInvestedUSD > 0 ? (totalInvestedINR / totalInvestedUSD) : liveRate));

    const unrealizedPnlINR = currentValueINR - costBasisINR;
    const unrealizedPctINR = costBasisINR > 0 ? Number(((unrealizedPnlINR / costBasisINR) * 100).toFixed(2)) : 0;

    // Unify all dividends for the holding via canonical dividend domain service
    const nonDivTxs = txs.filter(t => t.type !== 'DIVIDEND');
    const holdingDivData = await getHoldingDividends(holding.id);
    const allHoldingDividends = holdingDivData.dividends;

    const totalDividendsUSD = isUSStock
      ? allHoldingDividends.reduce((s, d) => s + (Number(d.amount_usd || d.amount_original) || 0), 0)
      : 0;
    const totalDividendsINR = allHoldingDividends.reduce((s, d) => s + (Number(d.amount_inr) || 0), 0);

    realizedPnlUSD += totalDividendsUSD;
    realizedPnlINR += totalDividendsINR;

    // Cashflows & XIRR
    const cashflowsUSD = txs
      .filter(t => ['BUY', 'INVESTMENT', 'INVESTMENT (SIP)', 'SELL', 'REDEEM', 'REDEMPTION'].includes(t.type))
      .map(t => {
        const amt = Number(t.total_amount) || 0;
        const charges = Number(t.charges) || 0;
        return {
          date: t.date,
          amount: (t.type === 'BUY' || t.type === 'INVESTMENT' || t.type === 'INVESTMENT (SIP)') ? -(amt + charges) : (amt - charges)
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
      .filter(t => ['BUY', 'INVESTMENT', 'INVESTMENT (SIP)', 'SELL', 'REDEEM', 'REDEMPTION'].includes(t.type))
      .map(t => {
        const r = isUSStock ? (Number(t.fx_rate) || getHistoricalFxRate(t.date)) : 1.0;
        const amt = (Number(t.total_amount) || 0) * r;
        const charges = (Number(t.charges) || 0) * r;
        return {
          date: t.date,
          amount: (t.type === 'BUY' || t.type === 'INVESTMENT' || t.type === 'INVESTMENT (SIP)') ? -(amt + charges) : (amt - charges)
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

            if (tx.type === 'BUY' || tx.type === 'BONUS' || tx.type === 'INVESTMENT' || tx.type === 'INVESTMENT (SIP)') {
              runningQ += qty;
              runningInv += amt;
            } else if (tx.type === 'SELL' || tx.type === 'REDEEM' || tx.type === 'REDEMPTION') {
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
    let historicalPricesCache = getHistoricalPricesMap();
    if (timelineINR.length === 0 && txs.length > 0) {
      const cleanSym = (holding.symbol || '').replace(/\.(NS|BO)$/i, '');
      let histPrices = historicalPricesCache[holding.symbol] || 
                       historicalPricesCache[cleanSym] || 
                       historicalPricesCache[`${cleanSym}.NS`] || 
                       historicalPricesCache[`${cleanSym}.BO`] || {};
      const firstTxDate = txs[0].date;

      // Automatically fetch and cache historical prices if missing or incomplete
      if (Object.keys(histPrices).length === 0 || !histPrices[firstTxDate]) {
        try {
          const freshPrices = await ensureHistoricalPricesForSymbol(holding.symbol, holding.category_id, firstTxDate);
          if (freshPrices && Object.keys(freshPrices).length > 0) {
            histPrices = freshPrices;
          }
        } catch (e) {
          console.warn(`[Detail API] Auto-fetch historical prices error for ${holding.symbol}:`, e.message);
        }
      }
      const lastTxDate = txs[txs.length - 1].date;
      const isExited = (Number(holding.quantity) || 0) <= 0;
      const endLimitStr = isExited ? lastTxDate : today;

      let runningQ = 0;
      let runningInvUSD = 0;
      let runningInvINR = 0;
      let txIdx = 0;
      let lastKnownPriceUSD = avgBuyPriceUSD || (Number(holding.current_price) || 0);
      let lastKnownPriceINR = lastKnownPriceUSD * liveRate;

      // Dynamically detect corporate action / split scale checkpoints from trade history
      // When stocks undergo a split, Yahoo Finance quotes and trade prices may be pre or post split.
      // We detect the ratio between trade prices and Yahoo quotes and adapt the multiplier dynamically.
      const standardSplitMultipliers = [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 10.0, 0.5, 0.4, 0.2, 0.1];
      const tradeScaleCheckpoints = [];

      for (const t of txs) {
        if ((['BUY', 'INVESTMENT', 'INVESTMENT (SIP)', 'SELL', 'REDEEM', 'REDEMPTION'].includes(t.type)) && Number(t.price) > 0) {
          const tDate = t.date;
          let hp = histPrices[tDate];
          if (!hp) {
            const tTime = new Date(tDate).getTime();
            let minDiff = Infinity;
            for (const [hdStr, hVal] of Object.entries(histPrices)) {
              const diff = Math.abs(new Date(hdStr).getTime() - tTime);
              if (diff <= 5 * 86400 * 1000 && diff < minDiff && hVal > 0) {
                minDiff = diff;
                hp = hVal;
              }
            }
          }
          if (hp && hp > 0) {
            const rawRatio = Number(t.price) / hp;
            let bestRatio = 1.0;
            let minDev = Infinity;
            for (const sm of standardSplitMultipliers) {
              const dev = Math.abs(rawRatio - sm) / sm;
              if (dev <= 0.20 && dev < minDev) {
                minDev = dev;
                bestRatio = sm;
              }
            }
            tradeScaleCheckpoints.push({ date: tDate, scale: bestRatio });
          }
        } else if (t.type === 'SPLIT' || t.type === 'BONUS') {
          // If a split or bonus exists, identify the market ex-date where historical prices dropped
          let splitMultiplier = 1;
          const match = (t.notes || '').match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/);
          if (match) {
            const o = parseFloat(match[1]);
            const n = parseFloat(match[2]);
            if (o > 0 && n > 0) splitMultiplier = n / o;
          } else if (t.type === 'BONUS') {
             // For bonus, if we don't have a ratio, we can estimate it based on the quantity added vs running quantity.
             // But simpler: just look for ANY massive price drop (>= 20%) in the 45 days prior to the bonus transaction.
             splitMultiplier = 1.25; // Minimum drop to look for (20% drop = 1.25 multiplier)
          }

          let exDate = t.date;
          const hpDates = Object.keys(histPrices).sort();
          
          if (splitMultiplier > 1) {
            // Search backwards from the recorded transaction date to identify the true market ex-date where historical prices dropped
            for (let i = hpDates.length - 1; i >= 1; i--) {
              if (hpDates[i] > t.date) continue;
              // Allow searching back up to 365 days from the recorded transaction date
              const daysDiff = (new Date(t.date).getTime() - new Date(hpDates[i]).getTime()) / (1000 * 3600 * 24);
              if (daysDiff > 365) break;

              const prevP = Number(histPrices[hpDates[i - 1]]) || 0;
              const curP = Number(histPrices[hpDates[i]]) || 0;
              if (prevP > 0 && curP > 0) {
                const dropRatio = curP / prevP;
                const expectedDrop = 1 / splitMultiplier;
                // For explicitly known splits, require 20% tolerance. For BONUS, accept drop matching ratio within 20% or drop >= 15%
                if (t.type === 'SPLIT' && match) {
                  if (Math.abs(dropRatio - expectedDrop) / expectedDrop <= 0.20) {
                    exDate = hpDates[i];
                    break;
                  }
                } else if (Math.abs(dropRatio - expectedDrop) / expectedDrop <= 0.20 || dropRatio <= 0.85) {
                  exDate = hpDates[i];
                  break;
                }
              }
            }
          }
          tradeScaleCheckpoints.push({ date: exDate, scale: 1.0 });
          // Shift the transaction date backwards so that runningQ updates exactly on the ex-date to prevent chart troughs
          t.effectiveDate = exDate;
        }
      }

      tradeScaleCheckpoints.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

      let currentTradeScale = tradeScaleCheckpoints.length > 0 ? tradeScaleCheckpoints[0].scale : 1.0;
      let scaleIdx = 0;

      const startDate = new Date(firstTxDate);
      const endDate = new Date(endLimitStr);
      if (endDate > new Date(today)) endDate.setTime(new Date(today).getTime());

      let currentDate = new Date(startDate);

      // Sort txs by effectiveDate (or date) so that shifted bonus/split transactions are processed in chronological order
      txs.sort((a, b) => {
        const dDiff = (a.effectiveDate || a.date || '').localeCompare(b.effectiveDate || b.date || '');
        if (dDiff !== 0) return dDiff;
        return (a.created_at || '').localeCompare(b.created_at || '');
      });

      while (currentDate <= endDate) {
        const dStr = currentDate.toISOString().split('T')[0];
        let dayEvents = [];

        while (scaleIdx < tradeScaleCheckpoints.length && tradeScaleCheckpoints[scaleIdx].date <= dStr) {
          currentTradeScale = tradeScaleCheckpoints[scaleIdx].scale;
          scaleIdx++;
        }

        while (txIdx < txs.length && (txs[txIdx].effectiveDate || txs[txIdx].date) <= dStr) {
          const tx = txs[txIdx];
          const qty = Number(tx.quantity) || 0;
          let eventQty = qty;
          if (eventQty === 0 && tx.type === 'BONUS') {
            const bMatch = (tx.notes || '').match(/\+([\d.,]+)\s*Shares/i);
            if (bMatch) {
              eventQty = parseFloat(bMatch[1].replace(/,/g, ''));
            }
          }
          const price = Number(tx.price) || 0;
          const rawPrincipalUSD = qty * price;
          const txRate = isUSStock ? (Number(tx.fx_rate) || getHistoricalFxRate(tx.date)) : 1.0;
          const rawPrincipalINR = rawPrincipalUSD * txRate;
          const txChargesUSD = Number(tx.charges) || 0;
          const txChargesINR = txChargesUSD * txRate;
          const amtUSD = ['SELL', 'REDEEM', 'REDEMPTION'].includes(tx.type) ? Math.max(0, rawPrincipalUSD - txChargesUSD) : (rawPrincipalUSD + txChargesUSD);
          const amtINR = ['SELL', 'REDEEM', 'REDEMPTION'].includes(tx.type) ? Math.max(0, rawPrincipalINR - txChargesINR) : (rawPrincipalINR + txChargesINR);

          if ((txs[txIdx].effectiveDate || txs[txIdx].date) === dStr && tx.type !== 'DIVIDEND') {
            dayEvents.push({
              type: tx.type,
              qty: eventQty,
              quantity: eventQty,
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
            runningInvUSD += rawPrincipalUSD + txChargesUSD;
            runningInvINR += rawPrincipalINR + txChargesINR;
            if (qty > 0) {
              lastKnownPriceUSD = price;
              lastKnownPriceINR = price * txRate;
            }
          } else if (tx.type === 'BONUS' || tx.type === 'DIVIDEND_REINVEST') {
            runningQ += qty;
            const txChargesUSD = Number(tx.charges) || 0;
            const txChargesINR = txChargesUSD * txRate;
            runningInvUSD += txChargesUSD;
            runningInvINR += txChargesINR;
          } else if (tx.type === 'SPLIT') {
            if (qty > 0) {
              runningQ += qty;
            }
          } else if (tx.type === 'SELL' || tx.type === 'REDEEM' || tx.type === 'REDEMPTION') {
            const sellCostUSD = runningQ > 0 ? (qty * (runningInvUSD / runningQ)) : 0;
            const sellCostINR = runningQ > 0 ? (qty * (runningInvINR / runningQ)) : 0;
            runningQ = Math.max(0, runningQ - qty);
            runningInvUSD = Math.max(0, runningInvUSD - sellCostUSD);
            runningInvINR = Math.max(0, runningInvINR - sellCostINR);
          }
          if (runningQ <= 1e-6 || (isExited && txIdx === txs.length - 1 && ['SELL', 'REDEEM', 'REDEMPTION'].includes(tx.type))) {
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
          const rawPrice = Number(histPrices[dStr]) || 0;
          const scaledPrice = rawPrice * (currentTradeScale || 1.0);
          lastKnownPriceUSD = isUSStock ? scaledPrice : scaledPrice / getHistoricalFxRate(dStr);
          lastKnownPriceINR = isUSStock ? scaledPrice * getHistoricalFxRate(dStr) : scaledPrice;
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
    let quotePrice = resolveHoldingPrice(holding, liveQuote);
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
      try {
        let liveQ = null;
        if (holding.category_id === 'in_stocks') {
          const [nseQ, bseQ] = await Promise.all([
            fetchStockQuote(`${cleanSym}.NS`),
            fetchStockQuote(`${cleanSym}.BO`)
          ]);
          const nseP = Number(nseQ?.price) || 0;
          const bseP = Number(bseQ?.price) || 0;
          if (bseP > nseP && bseP > 0) {
            liveQ = bseQ;
          } else {
            liveQ = nseQ || bseQ;
          }
        } else {
          liveQ = await fetchStockQuote(holding.symbol);
        }

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
        console.warn(`[Holding Detail] Live stock quote fetch warning for ${holding.symbol}:`, e.message);
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

    const txTypePriority = { BUY: 1, BONUS: 1, DIVIDEND_REINVEST: 1, SPLIT: 2, SELL: 3, REDEEM: 3, REDEMPTION: 3, DIVIDEND: 4 };
    const mergedTransactions = [...nonDivTxs, ...allHoldingDividends].sort((a, b) => {
      const da = a.date || '';
      const db = b.date || '';
      if (da !== db) return da.localeCompare(db);
      return (txTypePriority[a.type] || 9) - (txTypePriority[b.type] || 9);
    });

    const isFundOrNps = holding.category_id === 'mutual_funds' || holding.category_id === 'nps';
    const quoteDigits = isFundOrNps ? 4 : 2;
    const resolvedNse = (liveQuote && liveQuote.nse_price > 0) ? liveQuote.nse_price : (Number(holding.nse_price) || 0);
    const resolvedBse = (liveQuote && liveQuote.bse_price > 0) ? liveQuote.bse_price : (Number(holding.bse_price) || 0);

    const updatedHolding = {
      ...holding,
      current_price: Number(quotePrice.toFixed(quoteDigits)),
      nse_price: resolvedNse,
      bse_price: resolvedBse,
      quantity: Number(currentQty.toFixed(4)),
      avg_buy_price: Number((isUSStock ? avgBuyPriceUSD : (activeLotsINR.length > 0 && currentQty > 0 ? (costBasisINR / currentQty) : avgBuyPriceUSD)).toFixed(4))
    };

    res.json({
      holding: updatedHolding,
      quote: {
        price: Number(quotePrice.toFixed(quoteDigits)),
        nse_price: resolvedNse,
        bse_price: resolvedBse,
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
      dividends: allHoldingDividends,
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
        dividendCount: allHoldingDividends.length,
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
        dividendCount: allHoldingDividends.length,
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
        dividendCount: allHoldingDividends.length,
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

      if (txType === 'REDEEM' || txType === 'REDEMPTION') {
        txType = 'SELL';
      }

      if (['BUY', 'SELL'].includes(txType)) {
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

      // Handle MF SIP 0.005% automatic charges if amount was provided
      if (portfolio === 'mutual_funds' && txType === 'BUY' && data.amount) {
        const inputAmount = Math.abs(Number(data.amount));
        txCharges = Number((inputAmount * 0.00005).toFixed(4));
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
        const divAmount = Number(data.dividendAmount) || Number(data.amount) || txAmount;
        if (isNaN(divAmount) || divAmount <= 0) {
          return res.status(400).json({ error: 'Dividend amount must be a positive number.' });
        }

        await recordDividend({
          holdingId,
          date: txDate,
          amount: divAmount,
          currency,
          fxRate: txFxRate || fxRate,
          notes: data.notes || '',
          symbol: symbolKey,
          name: name.trim()
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

        await applyStockSplit({
          holdingId,
          splitOld: oldQty,
          splitNew: newQtyRatio,
          date: txDate,
          notes: data.notes || '',
          symbol: symbolKey,
          name: name.trim(),
          currency
        });

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
          notes: data.notes || `Bonus issue (+${txQty} shares credited at ₹0 cost, avg cost diluted from ₹${preBonusAvg.toFixed(2)} to ₹${newAvg.toFixed(2)})`
        });

        await recalculateHoldingState(holdingId);
        triggerEodRebuildIfPastDate(txDate);
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
        notes: data.notes || ''
      };

      if (txFxRate) txRecord.fx_rate = txFxRate;

      // Automatically populate historical daily prices for new or existing holdings
      if (['in_stocks', 'us_stocks', 'mutual_funds', 'nps'].includes(portfolio)) {
        try {
          await ensureHistoricalPricesForSymbol(symbolKey, portfolio, txDate);
        } catch (e) {
          console.warn(`[Auto-Price Sync] Failed to ensure historical prices for ${symbolKey}:`, e.message);
        }
      }

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
          notes: notes || ''
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
          notes: notes || ''
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
          notes: notes || ''
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
