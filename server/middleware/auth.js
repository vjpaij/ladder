import jwt from 'jsonwebtoken';
import db from '../db.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('FATAL: JWT_SECRET environment variable must be configured with at least 32 characters. Set it in your .env file. The server will not start without a secure secret.');
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

    // Concurrency / Single-session enforcement across devices
    if (userPayload?.userId && userPayload?.sessionId) {
      try {
        const users = await db.selectWhere('users', { id: userPayload.userId });
        const dbUser = users[0];
        if (dbUser && dbUser.active_session_id && dbUser.active_session_id !== userPayload.sessionId) {
          return res.status(401).json({
            error: 'Session terminated: This account has logged in from another device.',
            code: 'SESSION_SUPERSEDED'
          });
        }
      } catch (dbErr) {
        // Graceful fallback
      }
    }

    req.user = userPayload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}
