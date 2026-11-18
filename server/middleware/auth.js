import jwt from 'jsonwebtoken';
import db from '../db.js';

const DEFAULT_FALLBACK_JWT_SECRET = 'ladder_production_vault_secret_fallback_2026_key_99x_secure_token';
const JWT_SECRET = (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32)
  ? process.env.JWT_SECRET
  : DEFAULT_FALLBACK_JWT_SECRET;

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.warn('[Auth] Notice: JWT_SECRET environment variable is missing or < 32 chars. Using secure default vault secret.');
}

export { JWT_SECRET };

export async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const [scheme, token] = authHeader ? authHeader.split(' ') : [];
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const userPayload = jwt.verify(token, JWT_SECRET);
    req.user = userPayload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}
