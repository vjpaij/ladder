import express from 'express';
import { fetchFxRate } from '../services/priceEngine.js';
import { getHistoricalFxRate, getHistoricalFxRatesMap, getPersistedRate } from '../services/fxRateStore.js';

const router = express.Router();

// Live & Historical USD/INR Rate
router.get('/fx-rate', async (req, res) => {
  try {
    const { date } = req.query;
    const liveRate = await fetchFxRate();
    if (date) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (date >= todayStr) {
        return res.json({ rate: liveRate, date, isHistorical: false, timestamp: Date.now() });
      }
      const histRate = getHistoricalFxRate(date);
      return res.json({ 
        rate: Number(Number(histRate || liveRate).toFixed(2)), 
        date, 
        isHistorical: true, 
        timestamp: Date.now() 
      });
    }
    res.json({ rate: liveRate, timestamp: Date.now() });
  } catch (err) {
    const fallbackRate = getPersistedRate('USD_INR');
    if (fallbackRate) {
      res.json({ rate: fallbackRate, timestamp: Date.now(), source: 'persisted-fallback' });
    } else {
      res.status(503).json({ error: 'FX rate temporarily unavailable. No live source or persisted rate available.', timestamp: Date.now() });
    }
  }
});

// Real-time & Historical USD/INR Forex Series Endpoint
router.get('/fx-history', async (req, res) => {
  try {
    const { timeframe = '1Y', startDate, endDate } = req.query;
    const liveRate = await fetchFxRate();
    const today = new Date().toISOString().split('T')[0];

    // Merge cached historical rates with today's live rate
    const historicalMap = getHistoricalFxRatesMap();
    const fxMap = { ...historicalMap };
    fxMap[today] = Number(liveRate.toFixed(4));

    const sortedDates = Object.keys(fxMap).sort();
    if (sortedDates.length === 0) {
      return res.json({ currentRate: liveRate, today, series: [], table: [], stats: {} });
    }

    // Determine start date based on timeframe
    let filterStart = '2010-01-01';
    const now = new Date();
    const rangeMatch = String(timeframe).match(/^(\d+)([DWMYdwmy])$/);

    if (timeframe === 'ALL') {
      filterStart = '2010-01-01';
    } else if (rangeMatch) {
      const count = parseInt(rangeMatch[1], 10) || 1;
      const u = rangeMatch[2].toUpperCase();
      const d = new Date(now);
      if (u === 'D') d.setDate(d.getDate() - count);
      else if (u === 'W') d.setDate(d.getDate() - count * 7);
      else if (u === 'M') d.setMonth(d.getMonth() - count);
      else if (u === 'Y') d.setFullYear(d.getFullYear() - count);
      filterStart = d.toISOString().split('T')[0];
    } else if (timeframe === '1M') {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      filterStart = d.toISOString().split('T')[0];
    } else if (timeframe === '3M') {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 3);
      filterStart = d.toISOString().split('T')[0];
    } else if (timeframe === '6M') {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 6);
      filterStart = d.toISOString().split('T')[0];
    } else if (timeframe === '1Y') {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 1);
      filterStart = d.toISOString().split('T')[0];
    } else if (timeframe === '3Y') {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 3);
      filterStart = d.toISOString().split('T')[0];
    } else if (timeframe === '5Y') {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 5);
      filterStart = d.toISOString().split('T')[0];
    } else if (timeframe === 'CUSTOM' && startDate) {
      filterStart = startDate;
    }

    let filterEnd = (timeframe === 'CUSTOM' && endDate) ? endDate : today;
    const filteredDates = sortedDates.filter(d => d >= filterStart && d <= filterEnd);
    
    // Compute itemized daily points with change
    let prevRate = null;
    const series = [];
    let high = -Infinity;
    let highDate = null;
    let low = Infinity;
    let lowDate = null;
    let sumRate = 0;

    filteredDates.forEach(date => {
      const rate = Number(Number(fxMap[date]).toFixed(2));
      const change = prevRate !== null ? Number((rate - prevRate).toFixed(2)) : 0;
      const changePct = (prevRate !== null && prevRate > 0) ? Number(((change / prevRate) * 100).toFixed(2)) : 0;

      if (rate > high) {
        high = rate;
        highDate = date;
      }
      if (rate < low) {
        low = rate;
      }
      sumRate += rate;

      series.push({
        date,
        rate,
        change,
        changePct
      });
      prevRate = rate;
    });

    const count = series.length;
    const avg = count > 0 ? Number((sumRate / count).toFixed(2)) : liveRate;
    const firstRate = count > 0 ? series[0].rate : liveRate;
    const lastRate = count > 0 ? series[count - 1].rate : liveRate;
    const periodChange = Number((lastRate - firstRate).toFixed(2));
    const periodChangePct = firstRate > 0 ? Number(((periodChange / firstRate) * 100).toFixed(2)) : 0;
    const table = [...series].reverse();

    res.json({
      currentRate: Number(liveRate.toFixed(2)),
      today,
      timeframe,
      series,
      table,
      stats: {
        high: high !== -Infinity ? high : Number(liveRate.toFixed(2)),
        highDate,
        low: low !== Infinity ? low : Number(liveRate.toFixed(2)),
        lowDate,
        avg,
        periodChange,
        periodChangePct,
        totalRecords: count
      }
    });
  } catch (err) {
    console.error('Error fetching FX history:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
