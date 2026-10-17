/**
 * chartinkScanner.js
 * Scrapes live breakout scan candidates directly from Chartink.com
 * using the user's technical breakout filter:
 * - Close > 50-EMA * 1.03 (at least 3% above 50-EMA)
 * - 1 day ago close > 2 days ago close
 * - 2 days ago close <= 2 days ago 50-EMA
 *
 * Caches scan results locally in data/chartink_scan_cache.json with 1-hour TTL.
 */

import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const CACHE_FILE = path.join(DATA_DIR, 'chartink_scan_cache.json');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL

export async function fetchChartinkBreakouts({ forceRefresh = false } = {}) {
  try {
    if (!forceRefresh && fs.existsSync(CACHE_FILE)) {
      try {
        const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        const age = Date.now() - new Date(cached.fetchedAt || 0).getTime();
        if (age < CACHE_TTL_MS && Array.isArray(cached.candidates) && cached.candidates.length > 0) {
          return cached.candidates;
        }
      } catch (_) {}
    }

    // Step 1: Initialize session and get CSRF token & cookies
    const pageRes = await axios.get('https://chartink.com/screener/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    });

    const cookies = pageRes.headers['set-cookie']?.map(c => c.split(';')[0]).join('; ');
    const csrfMatch = pageRes.data.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
    const csrfToken = csrfMatch ? csrfMatch[1] : null;

    if (!csrfToken) {
      console.warn('[Chartink] Could not extract CSRF token from page.');
      if (fs.existsSync(CACHE_FILE)) {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')).candidates || [];
      }
      return [];
    }

    // Step 2: Post the scan clause corresponding to user's criteria
    const scanClause = "( {cash} ( latest close > latest ema( latest close , 50 ) * 1.03 and 1 day ago close > 2 days ago close and 2 days ago close <= 2 days ago ema( 2 days ago close , 50 ) ) )";

    const postRes = await axios.post('https://chartink.com/screener/process', 
      new URLSearchParams({ scan_clause: scanClause }),
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'X-CSRF-TOKEN': csrfToken,
          'Cookie': cookies,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Referer': 'https://chartink.com/screener/'
        },
        timeout: 15000
      }
    );

    const rawStocks = postRes.data?.data || [];
    const candidates = rawStocks.map(s => ({
      symbol: String(s.nsecode || '').trim().toUpperCase(),
      name: s.name || s.nsecode,
      close: Number(s.close) || 0,
      volume: Number(s.volume) || 0,
      source: 'Chartink Breakout'
    })).filter(s => s.symbol && s.close > 0);

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      fetchedAt: new Date().toISOString(),
      count: candidates.length,
      candidates
    }, null, 2), 'utf8');

    console.log(`[Chartink] Successfully fetched & cached ${candidates.length} breakout candidates.`);
    return candidates;
  } catch (err) {
    console.warn('[Chartink] Failed to fetch live breakout scan:', err.message);
    if (fs.existsSync(CACHE_FILE)) {
      try {
        const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        return cached.candidates || [];
      } catch (_) {}
    }
    return [];
  }
}
