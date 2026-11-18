import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';
import { supabaseAdmin } from '../../supabaseAdminClient.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'stock_intelligence_state.json');
const CONFIG_FILE = path.join(DATA_DIR, 'stock_intelligence_config.json');
const CLOUD_STORAGE_KEY = 'configs/stock_intelligence_config.json.gz';
const BUCKET_NAME = 'ladder_backups';

const DEFAULT_CONFIG = {
  maxPositionWeightPct: null,
  externalCashBudget: 200000,
  periodicIncrement: 200000,
  baseRecycledCapital: 4500000,
  recycledCapitalBaselineDate: '2026-10-31',
  recyclingMode: 'FULL_AND_TRIMS',
  maxDailyBuys: 5,
  dailyDeploymentCap: 350000,
  minMarketCapCr: 2500,
  activeStopLosses: {},
  updatedAt: null
};

// In-memory document cache to avoid repeated disk I/O
let inMemoryConfigDoc = null;
let cloudSyncTimeout = null;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function atomicWrite(file, payload) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

/**
 * Persists config to Supabase Cloud Storage (lossless gzip, ~3 KB, zero table schema bloat)
 */
async function syncConfigToCloud(document) {
  if (!supabaseAdmin) return;
  try {
    const raw = JSON.stringify(document || {});
    const compressed = zlib.gzipSync(Buffer.from(raw, 'utf-8'));
    const { error } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(CLOUD_STORAGE_KEY, compressed, { upsert: true, contentType: 'application/gzip' });
    if (error) {
      console.warn('[StockIntelligence Config] Cloud sync warning:', error.message);
    } else {
      console.log(`[StockIntelligence Config] Persisted to Supabase storage (${(compressed.length / 1024).toFixed(1)} KB).`);
    }
  } catch (err) {
    console.warn('[StockIntelligence Config] Cloud sync failed:', err.message);
  }
}

function debouncedSyncToCloud(document) {
  if (cloudSyncTimeout) clearTimeout(cloudSyncTimeout);
  cloudSyncTimeout = setTimeout(() => {
    syncConfigToCloud(document);
  }, 1500);
}

/**
 * Initializes and restores config from Supabase cloud storage on cold boot if local file is missing/empty
 */
export async function initIntelligenceConfigFromCloud() {
  if (inMemoryConfigDoc) return inMemoryConfigDoc;
  
  // 1. Try local disk first
  let doc = readJson(CONFIG_FILE, null);
  
  // 2. If missing or empty on ephemeral container, restore from Supabase Cloud Storage
  if ((!doc || !doc.byUser || Object.keys(doc.byUser).length === 0) && supabaseAdmin) {
    try {
      console.log('[StockIntelligence Config] Checking cloud backup for intelligence config...');
      const { data, error } = await supabaseAdmin.storage
        .from(BUCKET_NAME)
        .download(CLOUD_STORAGE_KEY);
      if (!error && data) {
        const arrayBuffer = await data.arrayBuffer();
        const decompressed = zlib.gunzipSync(Buffer.from(arrayBuffer)).toString('utf-8');
        const restored = JSON.parse(decompressed);
        if (restored && restored.byUser) {
          doc = restored;
          atomicWrite(CONFIG_FILE, doc);
          console.log('[StockIntelligence Config] Successfully restored config & GTT stops from Supabase cloud storage!');
        }
      }
    } catch (e) {
      console.warn('[StockIntelligence Config] Cloud restore warning:', e.message);
    }
  }

  inMemoryConfigDoc = doc || { byUser: {} };
  return inMemoryConfigDoc;
}

// Kick off async cloud restore on module load
initIntelligenceConfigFromCloud().catch(() => {});

function loadConfigDocument() {
  if (!inMemoryConfigDoc) {
    inMemoryConfigDoc = readJson(CONFIG_FILE, { byUser: {} });
  }
  return inMemoryConfigDoc;
}

function persistConfigDocument(document) {
  inMemoryConfigDoc = document;
  atomicWrite(CONFIG_FILE, document);
  debouncedSyncToCloud(document);
}

export function resolveConfigUserKey(userId, document) {
  if (userId && document?.byUser?.[userId]) return userId;
  if (!userId || userId === '1' || userId === 1 || userId === 'default' || userId === 'admin@ladder.com') {
    if (document?.byUser?.['vijaypaij@gmail.com']) return 'vijaypaij@gmail.com';
  }
  const keys = Object.keys(document?.byUser || {});
  if (keys.includes('vijaypaij@gmail.com')) return 'vijaypaij@gmail.com';
  if (keys.length > 0) return keys[0];
  return userId ? String(userId) : 'vijaypaij@gmail.com';
}

export function getIntelligenceConfig(userId) {
  const document = loadConfigDocument();
  const key = resolveConfigUserKey(userId, document);
  return { ...DEFAULT_CONFIG, ...(document.byUser?.[key] || {}) };
}

export function saveIntelligenceConfig(userId, input) {
  const document = loadConfigDocument();
  const key = resolveConfigUserKey(userId, document);
  const current = getIntelligenceConfig(key);

  let targetWeight = current.maxPositionWeightPct;
  if (input?.maxPositionWeightPct !== undefined) {
    const val = input.maxPositionWeightPct;
    targetWeight = val === null || val === '' ? null : Number(val);
    if (targetWeight !== null && (!Number.isFinite(targetWeight) || targetWeight <= 0 || targetWeight > 100)) {
      throw new Error('Maximum position weight must be between 0 and 100, or blank to disable.');
    }
  }

  let externalBudget = current.externalCashBudget ?? 200000;
  if (input?.externalCashBudget !== undefined) {
    const val = Number(input.externalCashBudget);
    if (Number.isFinite(val) && val >= 0) {
      externalBudget = Math.round(val);
    }
  }

  let periodicIncr = current.periodicIncrement ?? 200000;
  if (input?.periodicIncrement !== undefined) {
    const val = Number(input.periodicIncrement);
    if (Number.isFinite(val) && val >= 0) {
      periodicIncr = Math.round(val);
    }
  }

  let recMode = current.recyclingMode || 'FULL_AND_TRIMS';
  if (input?.recyclingMode && ['FULL_AND_TRIMS', 'FULL_ONLY', 'EXTERNAL_ONLY'].includes(input.recyclingMode)) {
    recMode = input.recyclingMode;
  }

  let baseRecycled = current.baseRecycledCapital ?? 4500000;
  if (input?.baseRecycledCapital !== undefined) {
    const val = Number(input.baseRecycledCapital);
    if (Number.isFinite(val) && val >= 0) {
      baseRecycled = Math.round(val);
    }
  }

  const baselineDate = input?.recycledCapitalBaselineDate || current.recycledCapitalBaselineDate || '2026-10-31';

  let maxDailyBuys = current.maxDailyBuys ?? 5;
  if (input?.maxDailyBuys !== undefined) {
    let val = Number(input.maxDailyBuys);
    if (Number.isFinite(val)) {
      val = Math.round(val);
      val = Math.max(1, Math.min(15, val));
      maxDailyBuys = val;
    }
  }

  let dailyDeploymentCap = current.dailyDeploymentCap ?? 350000;
  if (input?.dailyDeploymentCap !== undefined) {
    const val = Number(input.dailyDeploymentCap);
    if (Number.isFinite(val) && val >= 0) {
      dailyDeploymentCap = Math.round(val);
    }
  }

  const config = {
    maxPositionWeightPct: targetWeight,
    externalCashBudget: externalBudget,
    periodicIncrement: periodicIncr,
    baseRecycledCapital: baseRecycled,
    recycledCapitalBaselineDate: baselineDate,
    recyclingMode: recMode,
    maxDailyBuys,
    dailyDeploymentCap,
    minMarketCapCr: input?.minMarketCapCr !== undefined ? Number(input.minMarketCapCr) : (current.minMarketCapCr ?? 2500),
    activeStopLosses: input?.activeStopLosses !== undefined ? input.activeStopLosses : (current.activeStopLosses || {}),
    updatedAt: new Date().toISOString()
  };
  document.byUser = { ...(document.byUser || {}), [key]: config };
  persistConfigDocument(document);
  return config;
}

export function saveActiveStopLoss(userId, symbol, triggerPrice, metadata = {}) {
  const document = loadConfigDocument();
  const key = resolveConfigUserKey(userId, document);
  const userConfig = document.byUser?.[key] || { ...DEFAULT_CONFIG };
  const currentSlMap = userConfig.activeStopLosses || {};
  const updatedSlMap = {
    ...currentSlMap,
    [symbol]: {
      triggerPrice: Number(Number(triggerPrice).toFixed(2)),
      tier: metadata.tier || 'INITIAL_8PCT',
      rationale: metadata.rationale || '',
      setAt: new Date().toISOString()
    }
  };
  userConfig.activeStopLosses = updatedSlMap;
  userConfig.updatedAt = new Date().toISOString();
  document.byUser = { ...(document.byUser || {}), [key]: userConfig };
  persistConfigDocument(document);
  return updatedSlMap;
}

export function saveBulkActiveStopLosses(userId, entries = []) {
  const document = loadConfigDocument();
  const key = resolveConfigUserKey(userId, document);
  const userConfig = document.byUser?.[key] || { ...DEFAULT_CONFIG };
  const currentSlMap = { ...(userConfig.activeStopLosses || {}) };
  const now = new Date().toISOString();
  for (const entry of entries) {
    if (entry.symbol && entry.triggerPrice) {
      currentSlMap[entry.symbol] = {
        triggerPrice: Number(Number(entry.triggerPrice).toFixed(2)),
        tier: entry.tier || 'INITIAL_8PCT',
        rationale: entry.rationale || '',
        setAt: now
      };
    }
  }
  userConfig.activeStopLosses = currentSlMap;
  userConfig.updatedAt = now;
  document.byUser = { ...(document.byUser || {}), [key]: userConfig };
  persistConfigDocument(document);
  return currentSlMap;
}

export function deleteActiveStopLoss(userId, symbol) {
  const document = loadConfigDocument();
  const key = resolveConfigUserKey(userId, document);
  const userConfig = document.byUser?.[key] || { ...DEFAULT_CONFIG };
  if (userConfig.activeStopLosses && userConfig.activeStopLosses[symbol]) {
    delete userConfig.activeStopLosses[symbol];
    userConfig.updatedAt = new Date().toISOString();
    document.byUser = { ...(document.byUser || {}), [key]: userConfig };
    persistConfigDocument(document);
  }
  return userConfig.activeStopLosses || {};
}

export function pruneActiveStopLosses(userId, symbols = []) {
  if (!Array.isArray(symbols) || symbols.length === 0) return {};
  const document = loadConfigDocument();
  const key = resolveConfigUserKey(userId, document);
  const userConfig = document.byUser?.[key] || { ...DEFAULT_CONFIG };
  if (!userConfig.activeStopLosses) return {};
  let modified = false;
  for (const sym of symbols) {
    if (userConfig.activeStopLosses[sym]) {
      delete userConfig.activeStopLosses[sym];
      modified = true;
    }
  }
  if (modified) {
    userConfig.updatedAt = new Date().toISOString();
    document.byUser = { ...(document.byUser || {}), [key]: userConfig };
    persistConfigDocument(document);
  }
  return userConfig.activeStopLosses || {};
}

export function recordStateTransitions(userId, analyses) {
  const document = readJson(STATE_FILE, { states: {}, events: [] });
  const events = [];
  for (const analysis of analyses) {
    const key = `${userId}:${analysis.holdingId}`;
    const previous = document.states[key];
    const next = {
      state: analysis.state,
      symbol: analysis.symbol,
      evaluatedAt: new Date().toISOString(),
      ruleVersion: analysis.ruleVersion,
      dataQuality: analysis.dataQuality
    };
    if (!previous || previous.state !== next.state) {
      const event = { id: `${key}:${Date.now()}:${events.length}`, userId, holdingId: analysis.holdingId, symbol: analysis.symbol, from: previous?.state || null, to: next.state, at: next.evaluatedAt, evidence: analysis.evidence || [] };
      document.events.push(event);
      events.push(event);
    }
    document.states[key] = next;
  }
  document.events = document.events.slice(-5000);
  atomicWrite(STATE_FILE, document);
  return events;
}

export function getStateHistory(userId, holdingId = null) {
  const document = readJson(STATE_FILE, { states: {}, events: [] });
  return document.events.filter(event => event.userId === userId && (!holdingId || event.holdingId === holdingId)).slice().reverse();
}
