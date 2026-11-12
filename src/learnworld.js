const express = require('express');
const { requireAuth } = require('./auth');
const db = require('./db');

// Learnworld: Rechtsfächer mit eigenen Dokumenten (Vorlesungsmitschriften) und Lernsets.
// Aus einem Dokument lässt sich ein Lernset „anfragen“; die Anfragen stehen in quiz.lw_open_requests und werden von Hand
// bearbeitet (die Karten legt jemand mit dem Dokumenttext vor sich an – siehe README „Learnworld“).
const router = express.Router();
router.use(requireAuth);

const isId = (v) => /^\d{1,15}$/.test(String(v));
const course = (slug) => db.one('SELECT id, slug, name, icon, subject_id FROM quiz.lw_courses WHERE slug = $1', [String(slug)]);

router.get('/', async (req, res) => {
  const rows = await db.query(`
    SELECT c.id, c.slug, c.name, c.icon,
      (SELECT COUNT(*)::int FROM quiz.docs d WHERE d.owner_id = $1 AND d.course_id = c.id) AS docs,
      (SELECT COUNT(*)::int FROM quiz.study_sets s WHERE s.owner_id = $1 AND s.course_id = c.id) AS sets,
      (SELECT COUNT(*)::int FROM quiz.lw_requests r WHERE r.user_id = $1 AND r.course_id = c.id AND r.status = 'open') AS open_requests
    FROM quiz.lw_courses c ORDER BY c.position, c.id`, [req.user.id]);
  res.json(rows);
});

router.get('/courses/:slug', async (req, res) => {
  const c = await course(req.params.slug);
  if (!c) return res.status(404).json({ error: 'Fach nicht gefunden' });
  const docs = await db.query(`
    SELECT d.id, d.title, d.preview, d.updated_at, r.id AS request_id, r.status AS request_status, r.set_id AS request_set, r.note AS request_note
    FROM quiz.docs d
    LEFT JOIN LATERAL (SELECT id, status, set_id, note FROM quiz.lw_requests WHERE doc_id = d.id AND user_id = $1 AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 1) r ON true
    WHERE d.owner_id = $1 AND d.course_id = $2 ORDER BY d.updated_at DESC`, [req.user.id, c.id]);
  const sets = await db.query(`
    SELECT s.id, s.title, s.updated_at, (SELECT COUNT(*)::int FROM quiz.study_cards k WHERE k.set_id = s.id) AS cards
    FROM quiz.study_sets s WHERE s.owner_id = $1 AND s.course_id = $2 ORDER BY s.updated_at DESC`, [req.user.id, c.id]);
  res.json({
    course: c,
    docs: docs.map((d) => ({ id: Number(d.id), title: d.title, preview: d.preview, updatedAt: d.updated_at, request: d.request_id ? { id: Number(d.request_id), status: d.request_status, setId: d.request_set ? Number(d.request_set) : null, note: d.request_note } : null })),
    sets: sets.map((s) => ({ id: Number(s.id), title: s.title, cards: s.cards, updatedAt: s.updated_at })),
  });
});

// Noch keinem Fach zugeordnete eigene Dokumente und Lernsets (zum Einsortieren)
router.get('/unassigned', async (req, res) => {
  const [docs, sets] = await Promise.all([
    db.query('SELECT id, title FROM quiz.docs WHERE owner_id = $1 AND course_id IS NULL ORDER BY updated_at DESC LIMIT 100', [req.user.id]),
    db.query('SELECT id, title FROM quiz.study_sets WHERE owner_id = $1 AND course_id IS NULL ORDER BY updated_at DESC LIMIT 100', [req.user.id]),
  ]);
  res.json({ docs: docs.map((d) => ({ id: Number(d.id), title: d.title })), sets: sets.map((s) => ({ id: Number(s.id), title: s.title })) });
});

// Neues leeres Dokument direkt in einem Fach anlegen
router.post('/courses/:slug/docs', async (req, res) => {
  const c = await course(req.params.slug);
  if (!c) return res.status(404).json({ error: 'Fach nicht gefunden' });
  const title = String((req.body && req.body.title) || '').trim().slice(0, 120) || `${c.name} – Mitschrift`;
  const row = await db.one('INSERT INTO quiz.docs (owner_id, title, delta, course_id) VALUES ($1, $2, $3, $4) RETURNING id', [req.user.id, title, JSON.stringify([{ insert: '\n' }]), c.id]);
  res.json({ id: Number(row.id) });
});

// Dokument / Lernset einem Fach zuordnen (slug = null: aus dem Fach nehmen)
async function assign(table, req, res) {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Nicht gefunden' });
  let courseId = null;
  if (req.body && req.body.slug) {
    const c = await course(req.body.slug);
    if (!c) return res.status(404).json({ error: 'Fach nicht gefunden' });
    courseId = c.id;
  }
  const row = await db.one(`UPDATE quiz.${table} SET course_id = $1 WHERE id = $2 AND owner_id = $3 RETURNING id`, [courseId, req.params.id, req.user.id]);
  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });
  if (table === 'docs' && courseId === null) await db.query("UPDATE quiz.lw_requests SET status = 'cancelled' WHERE doc_id = $1 AND user_id = $2 AND status = 'open'", [req.params.id, req.user.id]);
  res.json({ ok: true });
}
router.put('/docs/:id/course', (req, res) => assign('docs', req, res));
router.put('/sets/:id/course', (req, res) => assign('study_sets', req, res));

// Lernset aus einem Dokument anfragen
router.post('/requests', async (req, res) => {
  const b = req.body || {};
  if (!isId(b.docId)) return res.status(400).json({ error: 'Dokument fehlt' });
  const d = await db.one('SELECT id, title, course_id FROM quiz.docs WHERE id = $1 AND owner_id = $2', [b.docId, req.user.id]);
  if (!d || !d.course_id) return res.status(404).json({ error: 'Das Dokument muss zuerst einem Fach zugeordnet sein' });
  const open = await db.one("SELECT id FROM quiz.lw_requests WHERE doc_id = $1 AND status = 'open'", [d.id]);
  if (open) return res.status(409).json({ error: 'Für dieses Dokument läuft schon eine Anfrage' });
  const { n } = await db.one("SELECT COUNT(*)::int AS n FROM quiz.lw_requests WHERE user_id = $1 AND status = 'open'", [req.user.id]);
  if (n >= 20) return res.status(400).json({ error: 'Es warten schon 20 Anfragen – bitte erst abwarten' });
  const row = await db.one('INSERT INTO quiz.lw_requests (user_id, course_id, doc_id, doc_title, note) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [req.user.id, d.course_id, d.id, d.title, String(b.note || '').trim().slice(0, 1000)]);
  res.json({ id: Number(row.id) });
});
router.delete('/requests/:id', async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Nicht gefunden' });
  await db.query("UPDATE quiz.lw_requests SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status = 'open'", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

module.exports = { router };
