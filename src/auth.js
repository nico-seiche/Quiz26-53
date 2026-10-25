const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { MIN_PLAYERS_FOR_SCORING, levelInfo } = require('./config');

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
  for (const part of (req.headers.cookie || '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(value.join('='));
  }
  return null;
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
  // Fünfstellige Freunde-ID (10000–99999); bei Kollision (selten) neu würfeln
  let user = null;
  for (let attempt = 0; attempt < 30 && !user; attempt++) {
    const code = String(10000 + Math.floor(Math.random() * 90000));
    try {
      user = await db.one(
        'INSERT INTO quiz.users (username, password_hash, friend_code) VALUES ($1, $2, $3) RETURNING id',
        [username, hash, code],
      );
    } catch (err) {
      if (err.code !== '23505' || !/friend_code/.test(err.constraint || err.detail || '')) throw err;
    }
  }
  if (!user) return res.status(503).json({ error: 'Gerade keine freie ID – bitte noch einmal versuchen' });
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

router.get('/me', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet' });
  // Gewertete Gesamtpunkte und Level (für die Anzeige in der Kopfzeile)
  const { points } = await db.one(
    'SELECT COALESCE(SUM(score), 0)::int AS points FROM quiz.game_results WHERE user_id = $1 AND player_count >= $2',
    [req.user.id, MIN_PLAYERS_FOR_SCORING],
  );
  const [{ friend_code: code }, { requests }, battleInvites, avatar] = await Promise.all([
    db.one('SELECT friend_code FROM quiz.users WHERE id = $1', [req.user.id]),
    db.one("SELECT COUNT(*)::int AS requests FROM quiz.friendships WHERE addressee_id = $1 AND status = 'pending'", [req.user.id]),
    require('./battles').inviteCount(req.user.id),
    db.one('SELECT EXTRACT(EPOCH FROM updated_at)::bigint AS ver FROM quiz.user_avatars WHERE user_id = $1', [req.user.id]),
  ]);
  res.json({ ...req.user, code, friendRequests: requests, battleInvites, avatarVer: avatar ? Number(avatar.ver) : 0, points, ...levelInfo(points) });
});

module.exports = { router, loadUser, requireAuth };
