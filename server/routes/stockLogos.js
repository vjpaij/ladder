/**
 * stockLogos.js — Express Router for Dynamic Stock Logo Discovery & Serving
 */

import express from 'express';
import { getLogoForSymbol, getAllStockLogos, registerStockLogo } from '../services/stockLogoService.js';

const router = express.Router();

// GET /api/stock-logo/:symbol — Resolves or discovers a company's logo from the web
router.get('/stock-logo/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const name = req.query.name || '';
    const forceRefresh = req.query.refresh === 'true';
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol parameter is required' });
    }

    const logoData = await getLogoForSymbol(symbol, name, forceRefresh);
    if (logoData && logoData.logoUrl) {
      return res.json(logoData);
    }

    return res.status(404).json({ error: 'Logo not found for symbol', symbol });
  } catch (error) {
    console.error(`[StockLogoRoute] Error resolving logo for ${req.params.symbol}:`, error.message);
    return res.status(500).json({ error: 'Internal server error resolving logo' });
  }
});

// GET /api/stock-logos — Returns all cached/discovered stock logos
router.get('/stock-logos', (req, res) => {
  try {
    const all = getAllStockLogos();
    return res.json(all);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch logos map' });
  }
});

// POST /api/stock-logo/:symbol — Manually register or override a stock logo
router.post('/stock-logo/:symbol', express.json(), (req, res) => {
  try {
    const { symbol } = req.params;
    const { domain, logoUrl } = req.body;
    if (!domain) {
      return res.status(400).json({ error: 'Domain is required' });
    }
    registerStockLogo(symbol, domain, logoUrl);
    return res.json({ success: true, symbol, domain, logoUrl });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to register stock logo' });
  }
});

export default router;
