const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { parseCookie } = require('cookie');
const db = require('./db');

const COOKIE_NAME = 'sid';
const SESSION_DAYS = 30;

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expiresAt);
  return { token, expiresAt };
}

// Liefert { id, username } zum Cookie-Header oder null
function userFromCookieHeader(header) {
  if (!header) return null;
  const token = parseCookie(header)[COOKIE_NAME];
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, s.expires_at FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token = ?
  `).get(token);
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, username: row.username };
}

function loadUser(req, res, next) {
  req.user = userFromCookieHeader(req.headers.cookie);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  next();
}

function setSessionCookie(res, { token, expiresAt }) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    expires: new Date(expiresAt),
  });
}

const router = express.Router();

router.post('/register', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Nutzername: 3–20 Zeichen (Buchstaben, Zahlen, _ . -)' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });
  }
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Nutzername ist schon vergeben' });

  const hash = bcrypt.hashSync(password, 10);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
    .run(username, hash);
  setSessionCookie(res, createSession(lastInsertRowid));
  res.json({ id: lastInsertRowid, username });
});

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Nutzername oder Passwort falsch' });
  }
  setSessionCookie(res, createSession(user.id));
  res.json({ id: user.id, username: user.username });
});

router.post('/logout', (req, res) => {
  const token = parseCookie(req.headers.cookie || '')[COOKIE_NAME];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  res.json(req.user);
});

module.exports = { router, loadUser, requireAuth, userFromCookieHeader };
