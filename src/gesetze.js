const express = require('express');
const { requireAuth } = require('./auth');
const db = require('./db');

// Gesetzessammlung für alle angemeldeten Nutzer.
// Weitere Gesetze: mit scripts/import-recht-nrw.js (Landesrecht NRW) oder scripts/import-gii.js (Bundesrecht) erzeugen und hier eintragen.
// Die Texte werden erst bei Bedarf geladen (große JSON-Dateien); die Liste kommt aus index.json (scripts/build-gesetze-index.js).
const INDEX = require('./gesetze/index.json');
const LOADERS = {
  'polg-nrw': () => require('./gesetze/polg-nrw.json'),
  'obg-nrw': () => require('./gesetze/obg-nrw.json'),
  'pog-nrw': () => require('./gesetze/pog-nrw.json'),
  stgb: () => require('./gesetze/stgb.json'),
  stpo: () => require('./gesetze/stpo.json'),
  owig_1968: () => require('./gesetze/owig_1968.json'),
  stvo_2013: () => require('./gesetze/stvo_2013.json'),
  stvzo_2012: () => require('./gesetze/stvzo_2012.json'),
  gg: () => require('./gesetze/gg.json'),
  bgb: () => require('./gesetze/bgb.json'),
  'vwvg-nrw': () => require('./gesetze/vwvg-nrw.json'),
  'lbg-nrw': () => require('./gesetze/lbg-nrw.json'),
  stvg: () => require('./gesetze/stvg.json'),
  fev_2010: () => require('./gesetze/fev_2010.json'),
  versammlg: () => require('./gesetze/versammlg.json'),
  waffg_2002: () => require('./gesetze/waffg_2002.json'),
  btmg_1981: () => require('./gesetze/btmg_1981.json'),
  jgg: () => require('./gesetze/jgg.json'),
  gvg: () => require('./gesetze/gvg.json'),
  vwgo: () => require('./gesetze/vwgo.json'),
  vwvfg: () => require('./gesetze/vwvfg.json'),
  beamtstg: () => require('./gesetze/beamtstg.json'),
  bdsg_2018: () => require('./gesetze/bdsg_2018.json'),
  aufenthg_2004: () => require('./gesetze/aufenthg_2004.json'),
};

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(INDEX);
});

// Persönliche Bibliothek: ausgeblendete Gesetze und Reihenfolge
router.get('/prefs/me', async (req, res) => {
  const row = await db.one('SELECT hidden, sort_order FROM quiz.law_prefs WHERE user_id = $1', [req.user.id]);
  res.json({ hidden: row ? row.hidden : [], order: row ? row.sort_order : [] });
});
router.put('/prefs/me', async (req, res) => {
  const list = (v) => [...new Set((Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && Object.hasOwn(LOADERS, x)))];
  const hidden = list(req.body && req.body.hidden);
  const order = list(req.body && req.body.order);
  await db.query(
    `INSERT INTO quiz.law_prefs (user_id, hidden, sort_order, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id) DO UPDATE SET hidden = EXCLUDED.hidden, sort_order = EXCLUDED.sort_order, updated_at = now()`,
    [req.user.id, hidden, order],
  );
  res.json({ hidden, order });
});

// Markierungen und Notizen (privat)
const COLORS = ['yellow', 'green', 'blue', 'pink'];
const idOk = (v) => /^\d{1,15}$/.test(String(v));
const MAX_NOTES = 3000;
router.get('/notes/all', async (req, res) => {
  const rows = await db.query('SELECT id, law, num, line, start_pos, end_pos, quote, color, note, updated_at FROM quiz.law_notes WHERE user_id = $1 ORDER BY law, num, line, start_pos', [req.user.id]);
  res.json(rows.map((r) => ({ id: Number(r.id), law: r.law, num: r.num, line: r.line, start: r.start_pos, end: r.end_pos, quote: r.quote, color: r.color, note: r.note, updatedAt: r.updated_at })));
});
function cleanNote(b, partial) {
  const out = {};
  if (!partial || b.color !== undefined) { if (!COLORS.includes(b.color)) return { error: 'Ungültige Farbe' }; out.color = b.color; }
  if (!partial || b.note !== undefined) out.note = String(b.note || '').slice(0, 2000);
  return { out };
}
router.post('/notes', async (req, res) => {
  const b = req.body || {};
  if (!known(b.law) || !NUMBER.test(String(b.num))) return res.status(400).json({ error: 'Ungültiger Paragraph' });
  const line = Number(b.line);
  const quote = String(b.quote || '');
  const start = Number(b.start) || 0;
  const end = Number(b.end) || 0;
  if (!Number.isInteger(line) || line < -1 || line > 500) return res.status(400).json({ error: 'Ungültige Stelle' });
  if (line >= 0 && (!quote.trim() || quote.length > 1500 || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > 30000)) return res.status(400).json({ error: 'Ungültige Markierung' });
  const c = cleanNote({ color: b.color || 'yellow', note: b.note }, false);
  if (c.error) return res.status(400).json({ error: c.error });
  if (line < 0 && !c.out.note.trim()) return res.status(400).json({ error: 'Notiz ist leer' });
  const { n } = await db.one('SELECT COUNT(*)::int AS n FROM quiz.law_notes WHERE user_id = $1', [req.user.id]);
  if (n >= MAX_NOTES) return res.status(400).json({ error: 'Zu viele Markierungen – bitte ein paar löschen' });
  if (line < 0) {   // Paragraphen-Notiz: nur eine je Paragraph
    const old = await db.one('SELECT id FROM quiz.law_notes WHERE user_id = $1 AND law = $2 AND num = $3 AND line = -1', [req.user.id, b.law, b.num]);
    if (old) { await db.query('UPDATE quiz.law_notes SET note = $1, updated_at = now() WHERE id = $2', [c.out.note, old.id]); return res.json({ id: Number(old.id) }); }
  }
  const row = await db.one(`INSERT INTO quiz.law_notes (user_id, law, num, line, start_pos, end_pos, quote, color, note)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [req.user.id, b.law, b.num, line, line < 0 ? 0 : start, line < 0 ? 0 : end, line < 0 ? '' : quote, c.out.color, c.out.note]);
  res.json({ id: Number(row.id) });
});
router.patch('/notes/:id', async (req, res) => {
  if (!idOk(req.params.id)) return res.status(404).json({ error: 'Nicht gefunden' });
  const c = cleanNote(req.body || {}, true);
  if (c.error) return res.status(400).json({ error: c.error });
  const row = await db.one('UPDATE quiz.law_notes SET color = COALESCE($1::text, color), note = COALESCE($2::text, note), updated_at = now() WHERE id = $3 AND user_id = $4 RETURNING id',
    [c.out.color ?? null, c.out.note ?? null, req.params.id, req.user.id]);
  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json({ ok: true });
});
router.delete('/notes/:id', async (req, res) => {
  if (!idOk(req.params.id)) return res.status(404).json({ error: 'Nicht gefunden' });
  await db.query('DELETE FROM quiz.law_notes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// Favoriten (Paragraphen, die man sich markiert hat)
const NUMBER = /^[0-9]{1,4}[a-z]{0,2}$/;
const known = (slug) => Object.hasOwn(LOADERS, slug);
router.get('/favorites/all', async (req, res) => {
  res.json(await db.query('SELECT law, num, title FROM quiz.law_favorites WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]));
});
router.put('/favorites/:slug/:num', async (req, res) => {
  if (!known(req.params.slug) || !NUMBER.test(req.params.num)) return res.status(400).json({ error: 'Ungültiger Paragraph' });
  const title = String((req.body && req.body.title) || '').slice(0, 200);
  await db.query(
    `INSERT INTO quiz.law_favorites (user_id, law, num, title) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, law, num) DO UPDATE SET title = EXCLUDED.title`,
    [req.user.id, req.params.slug, req.params.num, title],
  );
  res.json({ ok: true });
});
router.delete('/favorites/:slug/:num', async (req, res) => {
  await db.query('DELETE FROM quiz.law_favorites WHERE user_id = $1 AND law = $2 AND num = $3', [req.user.id, req.params.slug, req.params.num]);
  res.json({ ok: true });
});

router.get('/:slug', (req, res) => {
  const load = Object.hasOwn(LOADERS, req.params.slug) && LOADERS[req.params.slug];
  if (!load) return res.status(404).json({ error: 'Gesetz nicht gefunden' });
  const law = load();
  res.set('Cache-Control', 'private, max-age=3600').json(law);
});

module.exports = { router };
