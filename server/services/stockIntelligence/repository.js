import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'stock_intelligence_state.json');
const CONFIG_FILE = path.join(DATA_DIR, 'stock_intelligence_config.json');
const DEFAULT_CONFIG = { maxPositionWeightPct: null, updatedAt: null };

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function atomicWrite(file, payload) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

export function getIntelligenceConfig(userId) {
  const document = readJson(CONFIG_FILE, { byUser: {} });
  return { ...DEFAULT_CONFIG, ...(document.byUser?.[userId] || {}) };
}

export function saveIntelligenceConfig(userId, input) {
  const value = input?.maxPositionWeightPct;
  const target = value === null || value === '' ? null : Number(value);
  if (target !== null && (!Number.isFinite(target) || target <= 0 || target > 100)) {
    throw new Error('Maximum position weight must be between 0 and 100, or blank to disable.');
  }
  const config = { maxPositionWeightPct: target, updatedAt: new Date().toISOString() };
  const document = readJson(CONFIG_FILE, { byUser: {} });
  document.byUser = { ...(document.byUser || {}), [userId]: config };
  atomicWrite(CONFIG_FILE, document);
  return config;
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
