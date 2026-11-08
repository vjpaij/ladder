import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import db from '../db.js';
import { JWT_SECRET, authenticateToken } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const allUsers = await db.select('users');
    const user = allUsers.find(u => 
      u.email.toLowerCase() === normalizedEmail || 
      (normalizedEmail === 'vijaypaij@gmail.com' && u.email.toLowerCase() === 'admin@ladder.com')
    );

    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    // Single active device enforcement: assign unique session ID
    const sessionId = crypto.randomUUID();
    await db.update('users', user.id, {
      active_session_id: sessionId,
      last_login_at: new Date().toISOString()
    });

    const token = jwt.sign({ userId: user.id, email: user.email, sessionId }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    console.error('[Auth Login Error]:', err);
    res.status(500).json({ error: 'Internal server error during login.' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
      return res.status(400).json({ error: 'Name must be between 2 and 80 characters.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
    }

    const existingUsers = await db.selectWhere('users', { email: normalizedEmail });
    if (existingUsers.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const sessionId = crypto.randomUUID();
    const user = await db.insert('users', {
      name: name.trim(),
      email: normalizedEmail,
      password_hash: await bcrypt.hash(password, 12),
      active_session_id: sessionId,
      created_at: new Date().toISOString(),
      last_login_at: new Date().toISOString()
    });
    const token = jwt.sign({ userId: user.id, email: user.email, sessionId }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    if (String(err?.message || '').toLowerCase().includes('duplicate')) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    console.error('[Auth Register Error]:', err);
    res.status(500).json({ error: 'Unable to create account.' });
  }
});

router.post('/change-password', async (req, res) => {
  try {
    const { email, currentPassword, newPassword } = req.body || {};
    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Email address is required.' });
    }
    if (typeof currentPassword !== 'string' || !currentPassword) {
      return res.status(400).json({ error: 'Current password is required.' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({ error: 'New password must be between 8 and 128 characters.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const allUsers = await db.select('users');
    const user = allUsers.find(u => 
      u.email.toLowerCase() === normalizedEmail || 
      (normalizedEmail === 'vijaypaij@gmail.com' && u.email.toLowerCase() === 'admin@ladder.com')
    );

    if (!user) {
      return res.status(404).json({ error: 'No account found with this email address.' });
    }

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    const sessionId = crypto.randomUUID();
    
    // Ensure email is also updated to vijaypaij@gmail.com if it was previously admin@ladder.com
    const targetEmail = normalizedEmail === 'vijaypaij@gmail.com' ? 'vijaypaij@gmail.com' : user.email;

    await db.update('users', user.id, {
      email: targetEmail,
      password_hash: newHash,
      active_session_id: sessionId,
      last_login_at: new Date().toISOString()
    });

    const token = jwt.sign({ userId: user.id, email: targetEmail, sessionId }, JWT_SECRET, { expiresIn: '7d' });
    res.json({
      success: true,
      message: 'Password updated successfully.',
      token,
      user: { id: user.id, email: targetEmail, name: user.name }
    });
  } catch (err) {
    console.error('[Auth Change Password Error]:', err);
    res.status(500).json({ error: 'Unable to update password.' });
  }
});

router.get('/session-check', authenticateToken, (req, res) => {
  res.json({ valid: true, userId: req.user?.userId });
});

export default router;
