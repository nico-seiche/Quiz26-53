const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

const CODE = /^#?(\d{1,5})$/;

// Nutzer anhand von Name oder #ID finden (exakt)
async function findUser(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const m = text.match(/^#(\d{5})$/) || (/^\d{5}$/.test(text) ? [null, text] : null);
  if (m) return db.one('SELECT id, username, friend_code FROM quiz.users WHERE friend_code = $1', [m[1]]);
  return db.one('SELECT id, username, friend_code FROM quiz.users WHERE lower(username) = lower($1)', [text]);
}

// Befreundet (angenommen)? Wird auch von den Quiz-Einladungen genutzt.
async function areFriends(a, b) {
  return Boolean(await db.one(
    "SELECT 1 FROM quiz.friendships WHERE status = 'accepted' AND LEAST(requester_id, addressee_id) = LEAST($1::bigint, $2::bigint) AND GREATEST(requester_id, addressee_id) = GREATEST($1::bigint, $2::bigint)",
    [a, b],
  ));
}

const publicUser = (u) => ({ username: u.username, code: `#${u.friend_code}` });

// Freunde, offene Anfragen an mich und von mir
router.get('/', async (req, res) => {
  const rows = await db.query(`
    SELECT f.status, (f.requester_id = $1) AS outgoing, u.username, u.friend_code
    FROM quiz.friendships f
    JOIN quiz.users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
    WHERE f.requester_id = $1 OR f.addressee_id = $1
    ORDER BY lower(u.username)
  `, [req.user.id]);
  const me = await db.one('SELECT friend_code FROM quiz.users WHERE id = $1', [req.user.id]);
  res.json({
    code: `#${me.friend_code}`,
    friends: rows.filter((r) => r.status === 'accepted').map(publicUser),
    incoming: rows.filter((r) => r.status === 'pending' && !r.outgoing).map(publicUser),
    outgoing: rows.filter((r) => r.status === 'pending' && r.outgoing).map(publicUser),
  });
});

// Vorschläge beim Tippen: Name (Teilstück) oder #ID (Anfang)
router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 30);
  if (q.length < 1) return res.json([]);
  const code = q.match(CODE);
  let rows;
  if (code && (q.startsWith('#') || /^\d+$/.test(q))) {
    rows = await db.query('SELECT id, username, friend_code FROM quiz.users WHERE friend_code LIKE $1 AND id <> $2 ORDER BY friend_code LIMIT 8',
      [`${code[1]}%`, req.user.id]);
  } else {
    if (q.length < 2) return res.json([]);
    const like = q.replace(/[\\%_]/g, '\\$&');
    rows = await db.query(`
      SELECT id, username, friend_code FROM quiz.users
      WHERE username ILIKE $1 AND id <> $2
      ORDER BY (username ILIKE $3) DESC, lower(username) LIMIT 8`, [`%${like}%`, req.user.id, `${like}%`]);
  }
  const rel = await db.query(`
    SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS other, status, (requester_id = $1) AS outgoing
    FROM quiz.friendships WHERE requester_id = $1 OR addressee_id = $1`, [req.user.id]);
  const byId = new Map(rel.map((r) => [Number(r.other), r]));
  res.json(rows.map((u) => {
    const r = byId.get(Number(u.id));
    return { ...publicUser(u), relation: !r ? 'none' : r.status === 'accepted' ? 'friend' : r.outgoing ? 'requested' : 'incoming' };
  }));
});

// Anfrage senden (Name oder #ID). Hat die Person mir schon angefragt, werden wir direkt Freunde.
router.post('/request', async (req, res) => {
  const user = await findUser(req.body.user);
  if (!user) return res.status(404).json({ error: 'Spieler nicht gefunden' });
  if (Number(user.id) === req.user.id) return res.status(400).json({ error: 'Das bist du selbst.' });
  const existing = await db.one(`
    SELECT requester_id, status FROM quiz.friendships
    WHERE LEAST(requester_id, addressee_id) = LEAST($1::bigint, $2::bigint) AND GREATEST(requester_id, addressee_id) = GREATEST($1::bigint, $2::bigint)`,
  [req.user.id, user.id]);
  if (existing) {
    if (existing.status === 'accepted') return res.status(409).json({ error: `Du bist schon mit ${user.username} befreundet.` });
    if (Number(existing.requester_id) === req.user.id) return res.status(409).json({ error: 'Die Anfrage ist schon gesendet.' });
    await db.query("UPDATE quiz.friendships SET status = 'accepted' WHERE requester_id = $1 AND addressee_id = $2", [user.id, req.user.id]);
    return res.json({ status: 'accepted', user: publicUser(user) });
  }
  // Begrenzung gegen Anfrage-Spam: höchstens 30 offene Anfragen
  const open = await db.one("SELECT COUNT(*)::int AS n FROM quiz.friendships WHERE requester_id = $1 AND status = 'pending'", [req.user.id]);
  if (open.n >= 30) return res.status(429).json({ error: 'Du hast schon 30 offene Anfragen.' });
  await db.query('INSERT INTO quiz.friendships (requester_id, addressee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, user.id]);
  res.json({ status: 'requested', user: publicUser(user) });
});

router.post('/accept', async (req, res) => {
  const user = await findUser(req.body.user);
  const rows = user && await db.query(
    "UPDATE quiz.friendships SET status = 'accepted' WHERE requester_id = $1 AND addressee_id = $2 AND status = 'pending' RETURNING 1",
    [user.id, req.user.id]);
  if (!rows || !rows.length) return res.status(404).json({ error: 'Keine Anfrage gefunden' });
  res.json({ ok: true });
});

// Anfrage ablehnen (eingehend) bzw. zurückziehen (ausgehend) und Freund entfernen: alles löscht die Beziehung
router.delete('/:user', async (req, res) => {
  const user = await findUser(decodeURIComponent(req.params.user));
  const rows = user && await db.query(`
    DELETE FROM quiz.friendships
    WHERE LEAST(requester_id, addressee_id) = LEAST($1::bigint, $2::bigint) AND GREATEST(requester_id, addressee_id) = GREATEST($1::bigint, $2::bigint)
    RETURNING 1`, [req.user.id, user.id]);
  if (!rows || !rows.length) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json({ ok: true });
});

module.exports = { router, areFriends, findUser };
