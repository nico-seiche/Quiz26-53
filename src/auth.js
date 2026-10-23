const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { parseCookie } = require('cookie');
const db = require('./db');

const COOKIE_NAME = 'sid';
const SESSION_DAYS = 30;

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.query('INSERT INTO quiz.sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [
    token, userId, expiresAt,
  ]);
  return { token, expiresAt };
}

function sessionToken(req) {
  return parseCookie(req.headers.cookie || '')[COOKIE_NAME];
}

// Hängt den eingeloggten Nutzer ({ id, username }) als req.user an, sonst null
async function loadUser(req, res, next) {
  req.user = null;
  const token = sessionToken(req);
  if (token) {
    const row = await db.one(`
      SELECT u.id, u.username FROM quiz.sessions s
      JOIN quiz.users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()
    `, [token]);
    if (row) req.user = { id: Number(row.id), username: row.username };
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  next();
}

function setSessionCookie(req, res, { token, expiresAt }) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    expires: expiresAt,
  });
}

const router = express.Router();

router.post('/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Nutzername: 3–20 Zeichen (Buchstaben, Zahlen, _ . -)' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen haben' });
  }
  const exists = await db.one('SELECT 1 FROM quiz.users WHERE lower(username) = lower($1)', [username]);
  if (exists) return res.status(409).json({ error: 'Nutzername ist schon vergeben' });

  const hash = await bcrypt.hash(password, 10);
  const user = await db.one(
    'INSERT INTO quiz.users (username, password_hash) VALUES ($1, $2) RETURNING id',
    [username, hash],
  );
  setSessionCookie(req, res, await createSession(user.id));
  res.json({ id: Number(user.id), username });
});

router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = await db.one('SELECT * FROM quiz.users WHERE lower(username) = lower($1)', [username]);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Nutzername oder Passwort falsch' });
  }
  setSessionCookie(req, res, await createSession(user.id));
  res.json({ id: Number(user.id), username: user.username });
});

router.post('/logout', async (req, res) => {
  const token = sessionToken(req);
  if (token) await db.query('DELETE FROM quiz.sessions WHERE token = $1', [token]);
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  res.json(req.user);
});

module.exports = { router, loadUser, requireAuth };
