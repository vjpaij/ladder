/**
 * server/services/tradingJournalService.js
 * 
 * In-memory & JSON-backed Trading Journal Service for Ladder.
 * Supports complete trade lifecycle, Indian statutory charges, psychology/mistake tracking,
 * analytics computation, and seamless 1-click sync with Ladder portfolio transactions.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import db from '../db.js';
import { calculateTradingCharges } from './tradingChargesCalculator.js';
import { getHistoricalFxRate, getBestFxRate } from './fxRateStore.js';

import zlib from 'node:zlib';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../supabaseClient.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const JOURNAL_FILE = path.join(DATA_DIR, 'trading_journal.json');

// In-memory cache for instantaneous read latency (< 1ms)
let cachedJournal = null;
let adminClient = null;

function getAdminClient() {
  if (!adminClient) {
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (url && key) {
      adminClient = createClient(url, key);
    } else {
      adminClient = supabase;
    }
  }
  return adminClient;
}

// Debounced cloud sync to Supabase storage (ladder_backups/trading_journal/trading_journal.json.gz)
let cloudSyncTimeout = null;
export async function syncJournalToSupabase() {
  try {
    const client = getAdminClient();
    const trades = loadJournalFromDisk();
    const dataStr = JSON.stringify(trades || []);
    // Compress losslessly with gzip: turns ~450 KB into ~38 KB (< 0.004% of 1 GB free bucket limit)
    const compressed = zlib.gzipSync(Buffer.from(dataStr, 'utf-8'));

    const { error: storageError } = await client.storage
      .from('ladder_backups')
      .upload('trading_journal/trading_journal.json.gz', compressed, {
        upsert: true,
        contentType: 'application/gzip'
      });

    if (storageError) {
      console.warn('[TradingJournal] Supabase storage upload warning:', storageError.message);
    } else {
      console.log(`[TradingJournal] Persisted compressed journal to Supabase (${(compressed.length / 1024).toFixed(1)} KB, zero bloat).`);
    }

    // Also attempt relational table upsert if public.trading_journal exists
    try {
      const { error: tableError } = await client.from('trading_journal').select('id', { head: true, count: 'exact' });
      if (!tableError && Array.isArray(cachedJournal)) {
        const batchSize = 100;
        for (let i = 0; i < cachedJournal.length; i += batchSize) {
          const slice = cachedJournal.slice(i, i + batchSize).map(t => ({
            id: String(t.id),
            symbol: t.symbol,
            name: t.name,
            market: t.market || 'IN',
            segment: t.segment || 'IN_EQUITY',
            trade_type: t.tradeType || 'LONG',
            status: t.status || 'CLOSED',
            entry_date: t.entryDate || null,
            exit_date: t.exitDate || null,
            entry_price: t.entryPrice,
            exit_price: t.exitPrice,
            quantity: t.quantity,
            brokerage: t.brokerage,
            stt: t.stt,
            exchange_charges: t.exchangeCharges,
            gst: t.gst,
            stamp_duty: t.stampDuty,
            sebi_charges: t.sebiCharges,
            total_charges: t.totalCharges,
            gross_pnl: t.grossPnl,
            net_pnl: t.netPnl,
            roi_pct: t.roiPct,
            setup: t.setup,
            timeframe: t.timeframe,
            emotions: t.emotions,
            discipline: t.discipline,
            tags: t.tags || [],
            notes: t.notes || '',
            chart_url: t.chartUrl || '',
            rating: t.rating || 4,
            updated_at: new Date().toISOString()
          }));
          await client.from('trading_journal').upsert(slice);
        }
        console.log(`[TradingJournal] Synced ${cachedJournal.length} rows to Supabase trading_journal table.`);
      }
    } catch (_) {
      // Table doesn't exist yet, safe in compressed storage
    }
  } catch (err) {
    console.warn('[TradingJournal] Supabase cloud sync error:', err.message);
  }
}

export function debouncedSyncToCloud() {
  if (cloudSyncTimeout) clearTimeout(cloudSyncTimeout);
  cloudSyncTimeout = setTimeout(() => {
    syncJournalToSupabase();
  }, 2500);
}

// Debounced auto-sync trigger for portfolio mutations (buys, sells, splits, deletes)
let autoSyncPortfolioTimeout = null;
export function scheduleAutoSyncFromPortfolio(delayMs = 300) {
  if (autoSyncPortfolioTimeout) clearTimeout(autoSyncPortfolioTimeout);
  autoSyncPortfolioTimeout = setTimeout(async () => {
    try {
      console.log('[TradingJournal] Auto-syncing journal from portfolio transactions (debounced)...');
      await syncFromPortfolioTransactions();
    } catch (err) {
      console.warn('[TradingJournal] scheduleAutoSyncFromPortfolio failed:', err.message);
    }
  }, delayMs);
}

function loadJournalFromDisk() {
  if (cachedJournal !== null) return cachedJournal;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(JOURNAL_FILE)) {
      const content = fs.readFileSync(JOURNAL_FILE, 'utf-8');
      cachedJournal = JSON.parse(content || '[]');
      if (!Array.isArray(cachedJournal)) cachedJournal = [];
      return cachedJournal;
    }
  } catch (err) {
    console.warn('[TradingJournal] Error reading trading_journal.json:', err.message);
  }
  cachedJournal = [];
  return cachedJournal;
}

function saveJournalToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(JOURNAL_FILE, JSON.stringify(cachedJournal || [], null, 2), 'utf-8');
    debouncedSyncToCloud();
  } catch (err) {
    console.error('[TradingJournal] Error writing to trading_journal.json:', err.message);
  }
}

/**
 * Format trade entity with full charges and metrics recalculation
 */
function enrichTrade(trade) {
  const isUs = trade.market === 'US' || trade.segment === 'US_EQUITY';
  const charges = calculateTradingCharges({
    market: trade.market || 'IN',
    segment: trade.segment || (isUs ? 'US_EQUITY' : 'IN_EQUITY'),
    tradeType: trade.tradeType || 'LONG',
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    quantity: trade.quantity,
    brokeragePerOrder: trade.brokeragePerOrder ?? (isUs ? 0 : 20)
  });

  const entryDate = trade.entryDate || trade.date;
  const exitDate = trade.exitDate;
  let holdingDays = 0;
  let taxTerm = 'STCG';

  if (exitDate && entryDate) {
    holdingDays = Math.max(0, Math.round((new Date(exitDate) - new Date(entryDate)) / (1000 * 60 * 60 * 24)));
    taxTerm = holdingDays > 365 ? 'LTCG' : 'STCG';
  } else if (entryDate) {
    holdingDays = Math.max(0, Math.round((new Date() - new Date(entryDate)) / (1000 * 60 * 60 * 24)));
    taxTerm = holdingDays > 365 ? 'LTCG' : 'STCG';
  }

  const isClosed = (trade.exitPrice !== null && trade.exitPrice !== undefined && trade.exitPrice > 0);
  const isCorporateAction = trade.tradeType === 'BONUS' || trade.tradeType === 'SPLIT' || trade.status === 'CORPORATE_ACTION';

  // Base values in native currency (USD for US, INR for IN)
  // Strictly respect authentic charges from transaction entries when provided
  const totalCharges = isCorporateAction ? 0 : ((trade.totalCharges !== undefined && trade.totalCharges !== null) ? Number(trade.totalCharges) : charges.totalCharges);
  const grossPnl = isCorporateAction ? 0 : (isClosed ? ((trade.grossPnl !== undefined && trade.grossPnl !== null) ? Number(trade.grossPnl) : charges.grossPnl) : 0);
  const netPnl = isCorporateAction ? 0 : (isClosed ? ((trade.netPnl !== undefined && trade.netPnl !== null) ? Number(trade.netPnl) : Number((grossPnl - totalCharges).toFixed(2))) : 0);
  const costBasis = (trade.entryPrice || 0) * (trade.quantity || 0);
  const roiPct = isCorporateAction ? 0 : (isClosed ? ((trade.roiPct !== undefined && trade.roiPct !== null) ? Number(trade.roiPct) : (costBasis > 0 ? Number(((netPnl / costBasis) * 100).toFixed(2)) : 0)) : 0);

  // Proportional breakdown scaling for authentic transaction charges
  const hasCustomCharges = (trade.totalCharges !== undefined && trade.totalCharges !== null);
  let brokerage = charges.brokerage;
  let stt = charges.stt;
  let exchangeCharges = charges.exchangeCharges;
  let sebiCharges = charges.sebiCharges;
  let stampDuty = charges.stampDuty;
  let dpCharges = charges.dpCharges;
  let gst = charges.gst;

  if (hasCustomCharges) {
    if (totalCharges === 0) {
      brokerage = 0; stt = 0; exchangeCharges = 0; sebiCharges = 0; stampDuty = 0; dpCharges = 0; gst = 0;
    } else if (charges.totalCharges > 0) {
      const scale = totalCharges / charges.totalCharges;
      brokerage = Math.round(charges.brokerage * scale * 100) / 100;
      stt = Math.round(charges.stt * scale * 100) / 100;
      exchangeCharges = Math.round(charges.exchangeCharges * scale * 100) / 100;
      sebiCharges = Math.round(charges.sebiCharges * scale * 100) / 100;
      stampDuty = Math.round(charges.stampDuty * scale * 100) / 100;
      dpCharges = Math.round(charges.dpCharges * scale * 100) / 100;
      gst = Math.round((totalCharges - (brokerage + stt + exchangeCharges + sebiCharges + stampDuty + dpCharges)) * 100) / 100;
    }
  }

  // FX Rate handling
  let entryFxRate = Number(trade.entryFxRate || trade.fxRate) || null;
  let exitFxRate = Number(trade.exitFxRate || trade.fxRate) || null;

  if (isUs) {
    if (!entryFxRate && entryDate) {
      entryFxRate = getHistoricalFxRate(entryDate) || getBestFxRate() || 94.92;
    }
    if (!exitFxRate && exitDate) {
      exitFxRate = getHistoricalFxRate(exitDate) || getBestFxRate() || 94.92;
    } else if (!exitFxRate) {
      exitFxRate = getBestFxRate() || entryFxRate || 94.92;
    }
  } else {
    entryFxRate = 1;
    exitFxRate = 1;
  }

  // Transaction-date INR calculations
  let entryPriceInr = trade.entryPriceInr;
  let exitPriceInr = trade.exitPriceInr;
  let costBasisInr = trade.costBasisInr;
  let saleProceedsInr = trade.saleProceedsInr;
  let totalChargesInr = trade.totalChargesInr;
  let grossPnlInr = trade.grossPnlInr;
  let netPnlInr = trade.netPnlInr;
  let roiPctInr = trade.roiPctInr;

  if (isUs) {
    if (entryPriceInr === undefined || entryPriceInr === null) {
      entryPriceInr = trade.entryPrice ? Number((trade.entryPrice * (entryFxRate || 1)).toFixed(2)) : 0;
    }
    if (exitPriceInr === undefined || exitPriceInr === null) {
      exitPriceInr = isClosed && trade.exitPrice ? Number((trade.exitPrice * (exitFxRate || 1)).toFixed(2)) : null;
    }
    if (costBasisInr === undefined || costBasisInr === null) {
      costBasisInr = Number((entryPriceInr * (trade.quantity || 0)).toFixed(2));
    }
    if (saleProceedsInr === undefined || saleProceedsInr === null) {
      saleProceedsInr = isClosed && exitPriceInr ? Number((exitPriceInr * (trade.quantity || 0)).toFixed(2)) : 0;
    }
    if (totalChargesInr === undefined || totalChargesInr === null) {
      totalChargesInr = isCorporateAction ? 0 : Number((totalCharges * (exitFxRate || entryFxRate || 1)).toFixed(2));
    }
    if (grossPnlInr === undefined || grossPnlInr === null) {
      grossPnlInr = isCorporateAction ? 0 : (isClosed ? Number((saleProceedsInr - costBasisInr).toFixed(2)) : 0);
    }
    if (netPnlInr === undefined || netPnlInr === null) {
      netPnlInr = isCorporateAction ? 0 : (isClosed ? Number((grossPnlInr - totalChargesInr).toFixed(2)) : 0);
    }
    if (roiPctInr === undefined || roiPctInr === null) {
      roiPctInr = isCorporateAction ? 0 : (isClosed && costBasisInr > 0 ? Number(((netPnlInr / costBasisInr) * 100).toFixed(2)) : 0);
    }
  } else {
    // IN market: exact parity
    entryPriceInr = trade.entryPrice;
    exitPriceInr = trade.exitPrice;
    costBasisInr = (trade.entryPrice || 0) * (trade.quantity || 0);
    saleProceedsInr = isClosed ? (trade.exitPrice || 0) * (trade.quantity || 0) : 0;
    totalChargesInr = totalCharges;
    grossPnlInr = grossPnl;
    netPnlInr = netPnl;
    roiPctInr = roiPct;
  }

  return {
    ...trade,
    holdingDays,
    taxTerm,
    buyTurnover: charges.buyTurnover,
    sellTurnover: charges.sellTurnover,
    totalTurnover: charges.totalTurnover,
    brokerage,
    stt,
    exchangeCharges,
    sebiCharges,
    stampDuty,
    dpCharges,
    gst,
    totalCharges: Math.round(totalCharges * 100) / 100,
    grossPnl: Math.round(grossPnl * 100) / 100,
    netPnl: Math.round(netPnl * 100) / 100,
    roiPct: Math.round(roiPct * 100) / 100,
    breakevenExit: charges.breakevenExit,
    status: isCorporateAction ? 'CORPORATE_ACTION' : (isClosed ? 'CLOSED' : 'OPEN'),
    // Currency & Trade Date FX fields
    fxRate: trade.fxRate || exitFxRate || entryFxRate || 1,
    entryFxRate: entryFxRate || 1,
    exitFxRate: exitFxRate || 1,
    entryPriceInr: Math.round((entryPriceInr ?? 0) * 100) / 100,
    exitPriceInr: exitPriceInr !== null && exitPriceInr !== undefined ? Math.round(exitPriceInr * 100) / 100 : null,
    costBasisInr: Math.round((costBasisInr ?? 0) * 100) / 100,
    saleProceedsInr: Math.round((saleProceedsInr ?? 0) * 100) / 100,
    totalChargesInr: Math.round((totalChargesInr ?? 0) * 100) / 100,
    grossPnlInr: Math.round((grossPnlInr ?? 0) * 100) / 100,
    netPnlInr: Math.round((netPnlInr ?? 0) * 100) / 100,
    roiPctInr: Math.round((roiPctInr ?? 0) * 100) / 100
  };
}

export function getAllTrades(filters = {}) {
  if (cachedJournal === null) {
    loadJournalFromDisk();
  }
  if (!cachedJournal || cachedJournal.length === 0) {
    syncFromPortfolioTransactions().catch(err => {
      console.warn('[TradingJournal] Auto-sync in getAllTrades caught error:', err.message);
    });
  }
  const trades = cachedJournal || [];
  let result = [...trades];

  if (filters.market && filters.market !== 'ALL') {
    result = result.filter(t => t.market === filters.market);
  }
  if (filters.segment && filters.segment !== 'ALL') {
    result = result.filter(t => t.segment === filters.segment);
  }
  if (filters.status && filters.status !== 'ALL') {
    result = result.filter(t => t.status === filters.status);
  }
  if (filters.query) {
    const q = filters.query.toLowerCase().trim();
    result = result.filter(t => 
      (t.symbol && t.symbol.toLowerCase().includes(q)) ||
      (t.name && t.name.toLowerCase().includes(q)) ||
      (t.setup && t.setup.toLowerCase().includes(q)) ||
      (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q)))
    );
  }
  if (filters.outcome && filters.outcome !== 'ALL') {
    if (filters.outcome === 'WIN') result = result.filter(t => t.status === 'CLOSED' && t.netPnl > 0);
    if (filters.outcome === 'LOSS') result = result.filter(t => t.status === 'CLOSED' && t.netPnl < 0);
    if (filters.outcome === 'BE') result = result.filter(t => t.status === 'CLOSED' && t.netPnl === 0);
  }

  // Sort by entryDate desc by default
  result.sort((a, b) => new Date(b.entryDate || b.date) - new Date(a.entryDate || a.date));
  return result;
}

export function getTradeById(id) {
  const trades = loadJournalFromDisk();
  return trades.find(t => String(t.id) === String(id)) || null;
}

export function createTrade(data) {
  const trades = loadJournalFromDisk();
  const id = data.id || `tj_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  
  const rawTrade = {
    id,
    date: data.date || new Date().toISOString().split('T')[0],
    entryDate: data.entryDate || data.date || new Date().toISOString().split('T')[0],
    exitDate: data.exitDate || null,
    symbol: (data.symbol || '').toUpperCase().trim(),
    name: data.name || data.symbol,
    market: data.market || (data.symbol?.endsWith('.US') || data.symbol?.includes('NASDAQ') ? 'US' : 'IN'),
    segment: data.segment || 'IN_EQUITY',
    tradeType: data.tradeType || 'LONG',
    entryPrice: Number(data.entryPrice) || 0,
    exitPrice: data.exitPrice !== undefined && data.exitPrice !== null && data.exitPrice !== '' ? Number(data.exitPrice) : null,
    quantity: Number(data.quantity) || 1,
    targetPrice: data.targetPrice ? Number(data.targetPrice) : null,
    stopLossPrice: data.stopLossPrice ? Number(data.stopLossPrice) : null,
    plannedRiskReward: data.plannedRiskReward || null,
    setup: data.setup || 'Breakout',
    timeframe: data.timeframe || 'Daily',
    emotions: data.emotions || 'Disciplined',
    discipline: data.discipline !== undefined ? Boolean(data.discipline) : true,
    tags: Array.isArray(data.tags) ? data.tags : [],
    notes: data.notes || '',
    chartUrl: data.chartUrl || '',
    rating: Number(data.rating) || 3,
    linkedHoldingId: data.linkedHoldingId || null,
    linkedTransactionId: data.linkedTransactionId || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const enriched = enrichTrade(rawTrade);
  trades.unshift(enriched);
  saveJournalToDisk();
  return enriched;
}

export function updateTrade(id, updates) {
  const trades = loadJournalFromDisk();
  const index = trades.findIndex(t => String(t.id) === String(id));
  if (index === -1) return null;

  const existing = trades[index];
  const merged = {
    ...existing,
    ...updates,
    id: existing.id,
    updatedAt: new Date().toISOString()
  };

  const enriched = enrichTrade(merged);
  trades[index] = enriched;
  saveJournalToDisk();
  return enriched;
}

export function updateTradeNotesAndTags(id, { notes, tags }) {
  const updates = {};
  if (notes !== undefined) updates.notes = String(notes);
  if (tags !== undefined) updates.tags = Array.isArray(tags) ? tags : [String(tags)];
  return updateTrade(id, updates);
}

export function deleteTrade(id) {
  const trades = loadJournalFromDisk();
  const index = trades.findIndex(t => String(t.id) === String(id));
  if (index === -1) return false;

  trades.splice(index, 1);
  saveJournalToDisk();
  return true;
}

/**
 * Compute exhaustive executive statistics for the Journal
 */
export function computeJournalStats(filters = {}) {
  const trades = getAllTrades(filters);
  const closedTrades = trades.filter(t => t.status === 'CLOSED');
  const openTrades = trades.filter(t => t.status === 'OPEN');

  const winners = closedTrades.filter(t => t.netPnl > 0);
  const losers = closedTrades.filter(t => t.netPnl < 0);
  const breakevens = closedTrades.filter(t => t.netPnl === 0);

  const totalClosed = closedTrades.length;
  const winCount = winners.length;
  const lossCount = losers.length;
  const winRatePct = totalClosed > 0 ? (winCount / totalClosed) * 100 : 0;

  const grossPnl = closedTrades.reduce((sum, t) => sum + (t.grossPnl || 0), 0);
  const totalCharges = closedTrades.reduce((sum, t) => sum + (t.totalCharges || 0), 0);
  const netPnl = closedTrades.reduce((sum, t) => sum + (t.netPnl || 0), 0);

  const grossPnlInr = closedTrades.reduce((sum, t) => sum + (t.grossPnlInr ?? t.grossPnl ?? 0), 0);
  const totalChargesInr = closedTrades.reduce((sum, t) => sum + (t.totalChargesInr ?? t.totalCharges ?? 0), 0);
  const netPnlInr = closedTrades.reduce((sum, t) => sum + (t.netPnlInr ?? t.netPnl ?? 0), 0);

  const totalGains = winners.reduce((sum, t) => sum + t.netPnl, 0);
  const totalLosses = Math.abs(losers.reduce((sum, t) => sum + t.netPnl, 0));
  const profitFactor = totalLosses > 0 ? (totalGains / totalLosses) : totalGains > 0 ? 99.9 : 0;

  const totalGainsInr = winners.reduce((sum, t) => sum + (t.netPnlInr ?? t.netPnl ?? 0), 0);
  const totalLossesInr = Math.abs(losers.reduce((sum, t) => sum + (t.netPnlInr ?? t.netPnl ?? 0), 0));
  const profitFactorInr = totalLossesInr > 0 ? (totalGainsInr / totalLossesInr) : totalGainsInr > 0 ? 99.9 : 0;

  const avgWin = winCount > 0 ? totalGains / winCount : 0;
  const avgLoss = lossCount > 0 ? totalLosses / lossCount : 0;
  const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 99.9 : 0;

  const avgWinInr = winCount > 0 ? totalGainsInr / winCount : 0;
  const avgLossInr = lossCount > 0 ? totalLossesInr / lossCount : 0;

  const maxWin = winners.reduce((max, t) => Math.max(max, t.netPnl || 0), 0);
  const maxLoss = losers.reduce((min, t) => Math.min(min, t.netPnl || 0), 0);

  const maxWinInr = winners.reduce((max, t) => Math.max(max, t.netPnlInr ?? t.netPnl ?? 0), 0);
  const maxLossInr = losers.reduce((min, t) => Math.min(min, t.netPnlInr ?? t.netPnl ?? 0), 0);

  // Discipline & Psychology metrics
  const disciplinedTrades = closedTrades.filter(t => t.discipline).length;
  const disciplineScorePct = totalClosed > 0 ? (disciplinedTrades / totalClosed) * 100 : 100;

  // Streak calculations (chronological order)
  const chronologicalClosed = [...closedTrades].sort((a, b) => new Date(a.exitDate || a.date) - new Date(b.exitDate || b.date));
  let currentStreak = 0;
  let currentStreakType = null; // 'WIN' | 'LOSS'
  let maxWinStreak = 0;
  let maxLossStreak = 0;
  let tempStreak = 0;
  let tempType = null;

  for (const t of chronologicalClosed) {
    const isWin = t.netPnl > 0;
    const isLoss = t.netPnl < 0;
    const type = isWin ? 'WIN' : isLoss ? 'LOSS' : 'BE';
    if (type === 'BE') continue;

    if (type === tempType) {
      tempStreak++;
    } else {
      tempType = type;
      tempStreak = 1;
    }

    if (tempType === 'WIN') maxWinStreak = Math.max(maxWinStreak, tempStreak);
    if (tempType === 'LOSS') maxLossStreak = Math.max(maxLossStreak, tempStreak);
  }

  if (chronologicalClosed.length > 0) {
    const last = chronologicalClosed[chronologicalClosed.length - 1];
    currentStreakType = last.netPnl > 0 ? 'WIN' : last.netPnl < 0 ? 'LOSS' : 'BE';
    currentStreak = 0;
    for (let i = chronologicalClosed.length - 1; i >= 0; i--) {
      const type = chronologicalClosed[i].netPnl > 0 ? 'WIN' : chronologicalClosed[i].netPnl < 0 ? 'LOSS' : 'BE';
      if (type === currentStreakType) currentStreak++;
      else break;
    }
  }

  // Mistake Tag analysis & cost
  const mistakeCostMap = {};
  closedTrades.forEach(t => {
    if (Array.isArray(t.tags)) {
      t.tags.forEach(tag => {
        if (!mistakeCostMap[tag]) {
          mistakeCostMap[tag] = { count: 0, netPnl: 0, winCount: 0, lossCount: 0 };
        }
        mistakeCostMap[tag].count++;
        mistakeCostMap[tag].netPnl += (t.netPnl || 0);
        if (t.netPnl > 0) mistakeCostMap[tag].winCount++;
        else if (t.netPnl < 0) mistakeCostMap[tag].lossCount++;
      });
    }
  });

  const mistakeBreakdown = Object.entries(mistakeCostMap)
    .map(([tag, data]) => ({
      tag,
      count: data.count,
      netPnl: Math.round(data.netPnl * 100) / 100,
      winRatePct: data.count > 0 ? Math.round((data.winCount / data.count) * 100) : 0
    }))
    .sort((a, b) => a.netPnl - b.netPnl); // Largest losses first

  // Setup / Strategy performance
  const setupPerformanceMap = {};
  closedTrades.forEach(t => {
    const s = t.setup || 'General';
    if (!setupPerformanceMap[s]) {
      setupPerformanceMap[s] = { count: 0, netPnl: 0, winCount: 0 };
    }
    setupPerformanceMap[s].count++;
    setupPerformanceMap[s].netPnl += (t.netPnl || 0);
    if (t.netPnl > 0) setupPerformanceMap[s].winCount++;
  });

  const setupBreakdown = Object.entries(setupPerformanceMap)
    .map(([setup, data]) => ({
      setup,
      count: data.count,
      netPnl: Math.round(data.netPnl * 100) / 100,
      winRatePct: data.count > 0 ? Math.round((data.winCount / data.count) * 100) : 0
    }))
    .sort((a, b) => b.netPnl - a.netPnl);

  // Cumulative P&L curve over time
  let runningPnl = 0;
  let runningPnlInr = 0;
  const pnlTimeline = chronologicalClosed.map(t => {
    runningPnl += (t.netPnl || 0);
    runningPnlInr += (t.netPnlInr ?? t.netPnl ?? 0);
    return {
      date: t.exitDate || t.date,
      tradeId: t.id,
      symbol: t.symbol,
      netPnl: Math.round((t.netPnl || 0) * 100) / 100,
      cumulativeNetPnl: Math.round(runningPnl * 100) / 100,
      netPnlInr: Math.round((t.netPnlInr ?? t.netPnl ?? 0) * 100) / 100,
      cumulativeNetPnlInr: Math.round(runningPnlInr * 100) / 100
    };
  });

  return {
    totalTrades: trades.length,
    openTradesCount: openTrades.length,
    closedTradesCount: totalClosed,
    winCount,
    lossCount,
    breakevenCount: breakevens.length,
    winRatePct: Math.round(winRatePct * 100) / 100,
    grossPnl: Math.round(grossPnl * 100) / 100,
    totalCharges: Math.round(totalCharges * 100) / 100,
    netPnl: Math.round(netPnl * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    winLossRatio: Math.round(winLossRatio * 100) / 100,
    maxWin: Math.round(maxWin * 100) / 100,
    maxLoss: Math.round(maxLoss * 100) / 100,
    // INR aggregates
    grossPnlInr: Math.round(grossPnlInr * 100) / 100,
    totalChargesInr: Math.round(totalChargesInr * 100) / 100,
    netPnlInr: Math.round(netPnlInr * 100) / 100,
    profitFactorInr: Math.round(profitFactorInr * 100) / 100,
    avgWinInr: Math.round(avgWinInr * 100) / 100,
    avgLossInr: Math.round(avgLossInr * 100) / 100,
    maxWinInr: Math.round(maxWinInr * 100) / 100,
    maxLossInr: Math.round(maxLossInr * 100) / 100,
    disciplineScorePct: Math.round(disciplineScorePct * 100) / 100,
    currentStreak,
    currentStreakType,
    maxWinStreak,
    maxLossStreak,
    mistakeBreakdown,
    setupBreakdown,
    pnlTimeline
  };
}

/**
 * 1-Click Sync: Scans user transactions in Ladder and imports stock sales / positions
 * Uses true chronological FIFO lot matching to determine accurate cost basis and entry dates.
 */
export async function syncFromPortfolioTransactions() {
  const existingTrades = loadJournalFromDisk();
  // Preserve custom manually created trades (pruning any legacy synthetic tj_open_ positions)
  const manualTrades = existingTrades.filter(t => !String(t.id).startsWith('tj_open_') && (!t.linkedTransactionId || String(t.linkedTransactionId).startsWith('manual_')));

  const allTransactions = await db.select('transactions');
  const allHoldings = await db.select('holdings');

  const holdingsMap = new Map();
  allHoldings.forEach(h => holdingsMap.set(String(h.id), h));

  // Pre-calculate total charges and total traded quantity per (date, symbol) to distribute authentic charges
  const dateSymbolChargesMap = new Map();
  for (const tx of allTransactions) {
    const h = holdingsMap.get(String(tx.holding_id));
    const sym = (tx.symbol || h?.symbol || h?.name || '').toUpperCase().trim();
    const txDate = tx.date ? String(tx.date).split('T')[0] : '';
    if (!sym || !txDate) continue;

    const key = `${txDate}__${sym}`;
    if (!dateSymbolChargesMap.has(key)) {
      dateSymbolChargesMap.set(key, { totalCharges: 0, totalQty: 0 });
    }
    const entry = dateSymbolChargesMap.get(key);
    entry.totalCharges += Number(tx.charges) || 0;
    entry.totalQty += Number(tx.quantity) || 0;
  }

  function getAllocatedCharges(tx, sym) {
    const txDate = tx.date ? String(tx.date).split('T')[0] : '';
    const cleanSym = String(sym || '').toUpperCase().trim();
    const key = `${txDate}__${cleanSym}`;
    const entry = dateSymbolChargesMap.get(key);
    const qty = Number(tx.quantity) || 0;

    if (entry && entry.totalQty > 0 && entry.totalCharges > 0) {
      const proportional = (qty / entry.totalQty) * entry.totalCharges;
      return Math.round(proportional * 100) / 100;
    }
    return Math.round((Number(tx.charges) || 0) * 100) / 100;
  }

  // Filter for stock transactions (equity)
  const stockHoldings = allHoldings.filter(h => {
    const cat = String(h.category_id || '').toLowerCase();
    return cat.includes('stock') || cat.includes('equity') || cat.includes('us');
  });

  const syncedTrades = [];

  for (const h of stockHoldings) {
    const isUs = String(h.category_id || '').toLowerCase().includes('us');
    const market = isUs ? 'US' : 'IN';
    const segment = isUs ? 'US_EQUITY' : 'IN_EQUITY';

    // Get all transactions for this holding and sort chronologically
    const holdingTxs = allTransactions
      .filter(tx => String(tx.holding_id) === String(h.id))
      .sort((a, b) => {
        const dDiff = (a.date || '').localeCompare(b.date || '');
        if (dDiff !== 0) return dDiff;
        return (a.created_at || '').localeCompare(b.created_at || '');
      });

    if (holdingTxs.length === 0) continue;

    let openLots = []; // FIFO Queue: { qty, price, date, charges, txId, rem }

    for (const tx of holdingTxs) {
      const type = String(tx.type || '').toUpperCase();
      const qty = Number(tx.quantity) || 0;
      const price = Number(tx.price) || 0;
      const allocatedCharges = getAllocatedCharges(tx, h.symbol || h.name);

      if (['BUY', 'INVESTMENT', 'INVESTMENT (SIP)', 'DEMERGER', 'MERGER', 'SWAP', 'RIGHTS', 'ALLOTMENT'].includes(type)) {
        if (qty > 0) {
          const txFx = Number(tx.fx_rate) || (isUs ? (getHistoricalFxRate(tx.date) || 94.92) : 1);
          openLots.push({
            qty,
            rem: qty,
            price,
            fxRate: txFx,
            date: tx.date,
            charges: allocatedCharges,
            txId: tx.id
          });

          // Ingest authentic BUY trade entry for chronological journal review
          const buyTrade = {
            id: `tj_buy_${tx.id}`,
            date: tx.date,
            entryDate: tx.date,
            exitDate: null,
            symbol: h.symbol || h.name,
            name: h.name || h.symbol,
            market,
            segment,
            tradeType: 'BUY',
            entryPrice: Number(price),
            exitPrice: null,
            quantity: qty,
            entryPriceInr: isUs ? Math.round(price * txFx * 100) / 100 : price,
            costBasisInr: isUs ? Math.round(price * qty * txFx * 100) / 100 : Math.round(price * qty * 100) / 100,
            totalCharges: allocatedCharges,
            totalChargesInr: isUs ? Math.round(allocatedCharges * txFx * 100) / 100 : allocatedCharges,
            fxRate: txFx,
            entryFxRate: txFx,
            exitFxRate: txFx,
            setup: type === 'BUY' ? 'Purchase Entry' : type,
            timeframe: 'Daily',
            emotions: 'Disciplined',
            discipline: true,
            tags: ['Portfolio Buy', type],
            notes: tx.notes || `Purchased ${qty} shares @ ${isUs ? '$' : '₹'}${Number(price).toFixed(2)}${isUs ? ` (FX: ₹${txFx.toFixed(2)}/$)` : ''} on ${tx.date}`,
            rating: 4,
            linkedHoldingId: h.id,
            linkedTransactionId: tx.id,
            createdAt: tx.created_at || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'OPEN'
          };
          syncedTrades.push(enrichTrade(buyTrade));
        }
      } else if (type === 'BONUS') {
        if (qty > 0) {
          openLots.push({
            qty,
            rem: qty,
            price: 0,
            date: tx.date,
            charges: 0,
            txId: tx.id
          });
        }
        // Ingest BONUS corporate action event trade
        const bonusTrade = {
          id: `tj_bonus_${tx.id}`,
          date: tx.date,
          entryDate: tx.date,
          exitDate: null,
          symbol: h.symbol || h.name,
          name: h.name || h.symbol,
          market,
          segment,
          tradeType: 'BONUS',
          entryPrice: 0,
          exitPrice: null,
          quantity: qty > 0 ? qty : 0,
          setup: 'Bonus Issue',
          timeframe: 'Corporate Action',
          emotions: 'Disciplined',
          discipline: true,
          tags: ['Corporate Action', 'Bonus Issue'],
          notes: tx.notes || 'Bonus Issue credited @ zero cost',
          rating: 4,
          linkedHoldingId: h.id,
          linkedTransactionId: tx.id,
          createdAt: tx.created_at || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'CORPORATE_ACTION'
        };
        syncedTrades.push(enrichTrade(bonusTrade));
      } else if (type === 'SPLIT') {
        if (qty > 0 && openLots.length > 0) {
          const currentTotal = openLots.reduce((s, l) => s + l.rem, 0);
          if (currentTotal > 0) {
            const ratio = (currentTotal + qty) / currentTotal;
            for (const lot of openLots) {
              lot.rem *= ratio;
              lot.qty *= ratio;
              lot.price /= ratio;
            }
          }
        }
        // Ingest SPLIT corporate action event trade
        const splitTrade = {
          id: `tj_split_${tx.id}`,
          date: tx.date,
          entryDate: tx.date,
          exitDate: null,
          symbol: h.symbol || h.name,
          name: h.name || h.symbol,
          market,
          segment,
          tradeType: 'SPLIT',
          entryPrice: 0,
          exitPrice: null,
          quantity: qty > 0 ? qty : 0,
          setup: 'Stock Split',
          timeframe: 'Corporate Action',
          emotions: 'Disciplined',
          discipline: true,
          tags: ['Corporate Action', 'Stock Split'],
          notes: tx.notes || 'Stock Split corporate action',
          rating: 4,
          linkedHoldingId: h.id,
          linkedTransactionId: tx.id,
          createdAt: tx.created_at || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'CORPORATE_ACTION'
        };
        syncedTrades.push(enrichTrade(splitTrade));
      } else if (type === 'SELL' || type === 'REDEEM' || type === 'REDEMPTION') {
        if (qty <= 0) continue;

        const exitFx = Number(tx.fx_rate) || (isUs ? (getHistoricalFxRate(tx.date) || 94.92) : 1);
        let remToSell = qty;
        let costSoldUsd = 0;
        let costSoldInr = 0;
        let matchedLotsDates = [];

        // FIFO consumption with authentic lot-date FX rates
        for (const lot of openLots) {
          if (remToSell <= 0) break;
          if (lot.rem > 0) {
            const take = Math.min(lot.rem, remToSell);
            lot.rem -= take;
            const lotFx = lot.fxRate || exitFx;
            costSoldUsd += (take * lot.price);
            costSoldInr += (take * lot.price * lotFx);
            if (!matchedLotsDates.includes(lot.date)) {
              matchedLotsDates.push(lot.date);
            }
            remToSell -= take;
          }
        }

        const weightedEntryPriceUsd = qty > 0 ? (costSoldUsd / qty) : (Number(h.avg_buy_price) || price);
        const weightedEntryPriceInr = qty > 0 ? (costSoldInr / qty) : (weightedEntryPriceUsd * exitFx);
        const avgEntryFx = costSoldUsd > 0 ? (costSoldInr / costSoldUsd) : exitFx;

        const exitPriceUsd = Number(price);
        const exitPriceInr = isUs ? Math.round(exitPriceUsd * exitFx * 100) / 100 : exitPriceUsd;

        const saleProceedsUsd = qty * exitPriceUsd;
        const saleProceedsInr = isUs ? Math.round(saleProceedsUsd * exitFx * 100) / 100 : saleProceedsUsd;

        // Use authentic statutory charges from transactions table distributed proportionally by trade quantity
        const totalChargesUsd = isUs ? allocatedCharges : 0;
        const totalChargesInr = isUs ? Math.round(allocatedCharges * exitFx * 100) / 100 : allocatedCharges;
        const totalChargesNative = isUs ? totalChargesUsd : totalChargesInr;

        const grossPnlUsd = saleProceedsUsd - costSoldUsd;
        const grossPnlInr = isUs ? Math.round((saleProceedsInr - costSoldInr) * 100) / 100 : grossPnlUsd;

        const netPnlUsd = Math.round((grossPnlUsd - totalChargesUsd) * 100) / 100;
        const netPnlInr = Math.round((grossPnlInr - totalChargesInr) * 100) / 100;

        const roiPctUsd = costSoldUsd > 0 ? (netPnlUsd / costSoldUsd) * 100 : 0;
        const roiPctInr = costSoldInr > 0 ? (netPnlInr / costSoldInr) * 100 : 0;

        const entryDate = matchedLotsDates.length > 0 ? matchedLotsDates[0] : tx.date;
        const exitDate = tx.date;
        const daysHeld = Math.max(0, Math.round((new Date(exitDate) - new Date(entryDate)) / (1000 * 60 * 60 * 24)));
        const taxTerm = daysHeld > 365 ? 'LTCG' : 'STCG';

        const trade = {
          id: `tj_exit_${tx.id}`,
          date: tx.date,
          entryDate,
          exitDate,
          holdingDays: daysHeld,
          taxTerm,
          symbol: h.symbol || h.name,
          name: h.name || h.symbol,
          market,
          segment,
          tradeType: 'SELL',
          entryPrice: Math.round(weightedEntryPriceUsd * 100) / 100,
          exitPrice: Number(price),
          quantity: qty,
          entryPriceInr: Math.round(weightedEntryPriceInr * 100) / 100,
          exitPriceInr: Math.round(exitPriceInr * 100) / 100,
          costBasisInr: Math.round(costSoldInr * 100) / 100,
          saleProceedsInr: Math.round(saleProceedsInr * 100) / 100,
          totalCharges: totalChargesNative,
          totalChargesInr: totalChargesInr,
          grossPnl: isUs ? Math.round(grossPnlUsd * 100) / 100 : Math.round(grossPnlInr * 100) / 100,
          grossPnlInr: Math.round(grossPnlInr * 100) / 100,
          netPnl: isUs ? Math.round(netPnlUsd * 100) / 100 : Math.round(netPnlInr * 100) / 100,
          netPnlInr: Math.round(netPnlInr * 100) / 100,
          roiPct: Math.round(roiPctUsd * 100) / 100,
          roiPctInr: Math.round(roiPctInr * 100) / 100,
          fxRate: exitFx,
          entryFxRate: Math.round(avgEntryFx * 100) / 100,
          exitFxRate: exitFx,
          setup: 'Portfolio Exit',
          timeframe: 'Daily',
          emotions: 'Disciplined',
          discipline: true,
          tags: ['Portfolio Auto-Sync', taxTerm],
          notes: `FIFO Closed Exit: ${qty} shares (sold @ ${isUs ? '$' : '₹'}${price.toFixed(2)}, FIFO cost basis @ ${isUs ? '$' : '₹'}${weightedEntryPriceUsd.toFixed(2)}${isUs ? ` [INR cost basis: ₹${weightedEntryPriceInr.toFixed(2)}, exit FX: ₹${exitFx.toFixed(2)}/$]` : ''}, held ${daysHeld}d [${taxTerm}])`,
          rating: 4,
          linkedHoldingId: h.id,
          linkedTransactionId: tx.id,
          createdAt: tx.created_at || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: 'CLOSED'
        };

        syncedTrades.push(enrichTrade(trade));
      }
    }
  }

  // Combine manual trades + synced trades
  cachedJournal = [...manualTrades, ...syncedTrades];
  saveJournalToDisk();
  debouncedSyncToCloud();

  return {
    importedCount: syncedTrades.length,
    totalTrades: cachedJournal.length
  };
}

/**
 * Loads Buy & Sell Analysis badges and holdings to cross-reference each symbol
 */
function loadAnalysisBadgesMap() {
  const badgeMap = new Map();

  // 1. Ingest Buy Analysis snapshot
  try {
    const buySnapshotPath = path.join(DATA_DIR, 'buy_analysis_snapshot.json');
    if (fs.existsSync(buySnapshotPath)) {
      const snap = JSON.parse(fs.readFileSync(buySnapshotPath, 'utf8') || '{}');
      if (Array.isArray(snap.analyses)) {
        snap.analyses.forEach(a => {
          if (!a.symbol) return;
          const clean = a.symbol.toUpperCase().trim();
          const badges = badgeMap.get(clean) || [];

          if (a.buySignal === 'STRONG_BUY') {
            badges.push({ label: 'Strong Buy', type: 'buy', tone: 'emerald' });
          } else if (a.buySignal === 'BUY') {
            badges.push({ label: 'Buy Signal', type: 'buy', tone: 'emerald' });
          } else if (a.buySignal === 'WATCH') {
            badges.push({ label: 'Watch', type: 'buy', tone: 'amber' });
          }

          if (a.weinsteinStageLabel?.includes('Stage 2') || a.technicalSignals?.includes('Stage 2') || a.weinsteinStage === 'STAGE_2') {
            badges.push({ label: 'Stage 2 Bull', type: 'tech', tone: 'emerald' });
          }

          if (a.executiveStrategy?.stance === 'EXTENDED_RUNNER') {
            badges.push({ label: 'Extended Runner', type: 'stance', tone: 'purple' });
          } else if (a.executiveStrategy?.stance === 'PRIME_SETUP') {
            badges.push({ label: 'Prime Setup', type: 'stance', tone: 'cyan' });
          }

          if (a.earningsCatalyst?.verdict === 'BLOWOUT_BEAT' || a.earningsCatalyst?.status === 'RESULTS_OUT') {
            badges.push({ label: 'Q2 Beat', type: 'catalyst', tone: 'cyan' });
          }

          if (Array.isArray(a.qualitativeTags)) {
            a.qualitativeTags.slice(0, 2).forEach(t => {
              const rawTag = typeof t === 'string' ? t : (t?.tag || t?.label || '');
              if (!rawTag) return;
              const label = String(rawTag).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
              badges.push({ label, type: 'fund', tone: 'neutral' });
            });
          }

          badgeMap.set(clean, badges);
        });
      }
    }
  } catch (err) {
    console.warn('[TradingJournal] Error reading buy analysis snapshot:', err.message);
  }

  return badgeMap;
}

/**
 * Returns symbol-wise aggregated metrics for the Trade Journal master table
 */
export async function getSymbolAggregatedTrades(filters = {}) {
  if (cachedJournal === null) {
    loadJournalFromDisk();
  }
  if (!cachedJournal || cachedJournal.length === 0) {
    try {
      await syncFromPortfolioTransactions();
    } catch (err) {
      console.warn('[TradingJournal] Auto-sync in getSymbolAggregatedTrades caught error:', err.message);
    }
  }
  const allTrades = getAllTrades(filters);
  const badgeMap = loadAnalysisBadgesMap();

  // Load active holdings from database
  let holdings = [];
  try {
    holdings = await db.select('holdings');
  } catch (err) {
    console.warn('[TradingJournal] Could not load holdings for badge mapping:', err.message);
  }
  const holdingsMap = new Map();
  holdings.forEach(h => {
    if (h.symbol) holdingsMap.set(h.symbol.toUpperCase().trim(), h);
  });

  // Group trades by Symbol
  const symbolMap = new Map();

  for (const trade of allTrades) {
    const sym = (trade.symbol || 'UNKNOWN').toUpperCase().trim();
    if (!symbolMap.has(sym)) {
      symbolMap.set(sym, {
        symbol: sym,
        name: trade.name || sym,
        market: trade.market || 'IN',
        segment: trade.segment || 'IN_EQUITY',
        trades: [],
        totalTrades: 0,
        closedTrades: 0,
        openTrades: 0,
        winCount: 0,
        lossCount: 0,
        breakevenCount: 0,
        totalQuantity: 0,
        totalCapital: 0,
        totalCharges: 0,
        grossPnl: 0,
        netPnl: 0,
        totalCapitalInr: 0,
        totalChargesInr: 0,
        grossPnlInr: 0,
        netPnlInr: 0,
        bestTradePnl: -Infinity,
        worstTradePnl: Infinity,
        bestTradePnlInr: -Infinity,
        worstTradePnlInr: Infinity,
        latestDate: trade.date || trade.entryDate,
        earliestDate: trade.date || trade.entryDate,
        setups: new Set(),
        tags: new Set(),
        emotions: new Set()
      });
    }

    const group = symbolMap.get(sym);
    group.trades.push(trade);
    group.totalTrades++;

    if (trade.setup) group.setups.add(trade.setup);
    if (trade.emotions) group.emotions.add(trade.emotions);
    if (Array.isArray(trade.tags)) trade.tags.forEach(t => group.tags.add(t));

    const tDate = trade.date || trade.entryDate;
    if (tDate && tDate > group.latestDate) group.latestDate = tDate;
    if (tDate && tDate < group.earliestDate) group.earliestDate = tDate;

    if (trade.status === 'CLOSED') {
      group.closedTrades++;
      group.closedTradesQty = (group.closedTradesQty || 0) + (trade.quantity || 0);
      group.totalCapital += ((trade.entryPrice || 0) * (trade.quantity || 0));
      group.totalCharges += (trade.totalCharges || 0);
      group.grossPnl += (trade.grossPnl || 0);
      group.netPnl += (trade.netPnl || 0);

      group.totalCapitalInr += (trade.costBasisInr ?? ((trade.entryPriceInr ?? trade.entryPrice ?? 0) * (trade.quantity || 0)));
      group.totalChargesInr += (trade.totalChargesInr ?? trade.totalCharges ?? 0);
      group.grossPnlInr += (trade.grossPnlInr ?? trade.grossPnl ?? 0);
      group.netPnlInr += (trade.netPnlInr ?? trade.netPnl ?? 0);

      if (trade.netPnl > group.bestTradePnl) group.bestTradePnl = trade.netPnl;
      if (trade.netPnl < group.worstTradePnl) group.worstTradePnl = trade.netPnl;

      const netInr = trade.netPnlInr ?? trade.netPnl;
      if (netInr > group.bestTradePnlInr) group.bestTradePnlInr = netInr;
      if (netInr < group.worstTradePnlInr) group.worstTradePnlInr = netInr;

      if (trade.netPnl > 0) group.winCount++;
      else if (trade.netPnl < 0) group.lossCount++;
      else group.breakevenCount++;
    } else if (trade.tradeType === 'BUY') {
      group.buyTrades = (group.buyTrades || 0) + 1;
      group.buyTradesQty = (group.buyTradesQty || 0) + (trade.quantity || 0);
      group.totalCharges += (trade.totalCharges || 0);
      group.totalChargesInr += (trade.totalChargesInr ?? trade.totalCharges ?? 0);
    }
  }

  // Finalize computations per symbol
  const symbols = Array.from(symbolMap.values()).map(group => {
    // Sort trades for this symbol chronologically
    group.trades.sort((a, b) => new Date(b.date || b.entryDate) - new Date(a.date || a.entryDate));

    // Cumulative P&L timeline for this symbol
    const chronologicalClosed = [...group.trades]
      .filter(t => t.status === 'CLOSED')
      .sort((a, b) => new Date(a.exitDate || a.date) - new Date(b.exitDate || b.date));

    let runPnl = 0;
    let runPnlInr = 0;
    const pnlTimeline = chronologicalClosed.map(t => {
      runPnl += (t.netPnl || 0);
      runPnlInr += (t.netPnlInr ?? t.netPnl ?? 0);
      return {
        date: t.exitDate || t.date,
        netPnl: Math.round((t.netPnl || 0) * 100) / 100,
        cumulativeNetPnl: Math.round(runPnl * 100) / 100,
        netPnlInr: Math.round((t.netPnlInr ?? t.netPnl ?? 0) * 100) / 100,
        cumulativeNetPnlInr: Math.round(runPnlInr * 100) / 100
      };
    });

    const winRatePct = group.closedTrades > 0 ? (group.winCount / group.closedTrades) * 100 : 0;
    const roiPct = group.totalCapital > 0 ? (group.netPnl / group.totalCapital) * 100 : 0;
    const holding = holdingsMap.get(group.symbol);
    const inPortfolio = !!(holding && Number(holding.quantity) > 0);

    // Merge analysis badges
    const analysisBadges = [...(badgeMap.get(group.symbol) || [])];
    if (inPortfolio) {
      analysisBadges.unshift({ label: 'In Portfolio', type: 'portfolio', tone: 'cyan' });
    }

    const closedQty = group.closedTradesQty || 0;
    const openQty = holding ? (Number(holding.quantity) || 0) : 0;
    const totalVolume = closedQty + openQty;

    return {
      symbol: group.symbol,
      name: group.name,
      market: group.market,
      segment: group.segment,
      totalTrades: group.totalTrades,
      closedTrades: group.closedTrades,
      openTrades: inPortfolio ? 1 : 0,
      closedTradesQty: closedQty,
      openTradesQty: openQty,
      totalVolumeQty: totalVolume,
      winCount: group.winCount,
      lossCount: group.lossCount,
      breakevenCount: group.breakevenCount,
      winRatePct: Math.round(winRatePct * 10) / 10,
      totalQuantity: group.totalQuantity,
      totalCapital: Math.round(group.totalCapital * 100) / 100,
      totalCharges: Math.round(group.totalCharges * 100) / 100,
      grossPnl: Math.round(group.grossPnl * 100) / 100,
      netPnl: Math.round(group.netPnl * 100) / 100,
      roiPct: Math.round(roiPct * 100) / 100,
      bestTradePnl: group.bestTradePnl === -Infinity ? 0 : Math.round(group.bestTradePnl * 100) / 100,
      worstTradePnl: group.worstTradePnl === Infinity ? 0 : Math.round(group.worstTradePnl * 100) / 100,
      // INR aggregates
      totalCapitalInr: Math.round((group.totalCapitalInr || group.totalCapital) * 100) / 100,
      totalChargesInr: Math.round((group.totalChargesInr || group.totalCharges) * 100) / 100,
      grossPnlInr: Math.round((group.grossPnlInr || group.grossPnl) * 100) / 100,
      netPnlInr: Math.round((group.netPnlInr || group.netPnl) * 100) / 100,
      roiPctInr: (group.totalCapitalInr || 0) > 0 ? Math.round(((group.netPnlInr || 0) / group.totalCapitalInr) * 10000) / 100 : Math.round(roiPct * 100) / 100,
      bestTradePnlInr: group.bestTradePnlInr === -Infinity ? 0 : Math.round(group.bestTradePnlInr * 100) / 100,
      worstTradePnlInr: group.worstTradePnlInr === Infinity ? 0 : Math.round(group.worstTradePnlInr * 100) / 100,
      latestDate: group.latestDate,
      earliestDate: group.earliestDate,
      setups: Array.from(group.setups),
      tags: Array.from(group.tags),
      emotions: Array.from(group.emotions),
      trades: group.trades,
      pnlTimeline,
      analysisBadges,
      inPortfolio,
      isOpen: inPortfolio || openQty > 0,
      isFullyExited: (!inPortfolio && openQty === 0) && group.closedTrades > 0,
      portfolioHolding: holding ? {
        quantity: holding.quantity,
        avgBuyPrice: holding.avg_buy_price,
        currentPrice: holding.current_price,
        currentValue: holding.current_value,
        unrealizedPnl: holding.unrealized_pnl,
        unrealizedPnlPct: holding.unrealized_pnl_pct
      } : null
    };
  });

  // Sorting
  const sortField = filters.sortField || 'netPnl';
  const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;

  symbols.sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];
    if (typeof aVal === 'string') {
      return sortOrder * aVal.localeCompare(bVal);
    }
    return sortOrder * ((aVal ?? 0) - (bVal ?? 0));
  });

  return symbols;
}

