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
    SELECT d.id, d.title, d.preview, d.updated_at, d.folder_id, r.id AS request_id, r.status AS request_status, r.set_id AS request_set, r.note AS request_note
    FROM quiz.docs d
    LEFT JOIN LATERAL (SELECT id, status, set_id, note FROM quiz.lw_requests WHERE doc_id = d.id AND user_id = $1 AND status <> 'cancelled' ORDER BY created_at DESC LIMIT 1) r ON true
    WHERE d.owner_id = $1 AND d.course_id = $2 ORDER BY d.updated_at DESC`, [req.user.id, c.id]);
  const sets = await db.query(`
    SELECT s.id, s.title, s.updated_at, (SELECT COUNT(*)::int FROM quiz.study_cards k WHERE k.set_id = s.id) AS cards
    FROM quiz.study_sets s WHERE s.owner_id = $1 AND s.course_id = $2 ORDER BY s.updated_at DESC`, [req.user.id, c.id]);
  const folders = await db.query('SELECT id, parent_id, name FROM quiz.lw_folders WHERE user_id = $1 AND course_id = $2 ORDER BY name', [req.user.id, c.id]);
  res.json({
    course: c,
    folders: folders.map((f) => ({ id: Number(f.id), parentId: f.parent_id ? Number(f.parent_id) : null, name: f.name })),
    docs: docs.map((d) => ({ id: Number(d.id), folderId: d.folder_id ? Number(d.folder_id) : null, title: d.title, preview: d.preview, updatedAt: d.updated_at, request: d.request_id ? { id: Number(d.request_id), status: d.request_status, setId: d.request_set ? Number(d.request_set) : null, note: d.request_note } : null })),
    sets: sets.map((s) => ({ id: Number(s.id), title: s.title, cards: s.cards, updatedAt: s.updated_at })),
  });
});

// Ordner-ID prüfen: gehört dem Nutzer und liegt im richtigen Fach (sonst null = oberste Ebene)
async function ownFolder(userId, courseId, id) {
  if (!isId(id)) return null;
  const f = await db.one('SELECT id FROM quiz.lw_folders WHERE id = $1 AND user_id = $2 AND course_id = $3', [id, userId, courseId]);
  return f ? Number(f.id) : null;
}

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
  const folderId = await ownFolder(req.user.id, c.id, req.body && req.body.folderId);
  const row = await db.one('INSERT INTO quiz.docs (owner_id, title, delta, course_id, folder_id) VALUES ($1, $2, $3, $4, $5) RETURNING id', [req.user.id, title, JSON.stringify([{ insert: '\n' }]), c.id, folderId]);
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
  let sql = `UPDATE quiz.${table} SET course_id = $1 WHERE id = $2 AND owner_id = $3 RETURNING id`;
  let params = [courseId, req.params.id, req.user.id];
  if (table === 'docs') {      // Ordner mitgeben oder beim Fachwechsel zurücksetzen
    const folderId = courseId ? await ownFolder(req.user.id, courseId, req.body && req.body.folderId) : null;
    sql = 'UPDATE quiz.docs SET course_id = $1, folder_id = $4 WHERE id = $2 AND owner_id = $3 RETURNING id';
    params = [courseId, req.params.id, req.user.id, folderId];
  }
  const row = await db.one(sql, params);
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

// ----- Ordner -----
const cleanName = (v) => String(v || '').trim().replace(/\s+/g, ' ').slice(0, 80);
const folderOf = (id, userId) => (isId(id) ? db.one('SELECT id, course_id, parent_id FROM quiz.lw_folders WHERE id = $1 AND user_id = $2', [id, userId]) : null);

router.post('/courses/:slug/folders', async (req, res) => {
  const c = await course(req.params.slug);
  if (!c) return res.status(404).json({ error: 'Fach nicht gefunden' });
  const name = cleanName(req.body && req.body.name);
  if (!name) return res.status(400).json({ error: 'Bitte einen Namen eingeben' });
  const parentId = await ownFolder(req.user.id, c.id, req.body && req.body.parentId);
  const { n } = await db.one('SELECT COUNT(*)::int AS n FROM quiz.lw_folders WHERE user_id = $1', [req.user.id]);
  if (n >= 300) return res.status(400).json({ error: 'Zu viele Ordner' });
  const row = await db.one('INSERT INTO quiz.lw_folders (user_id, course_id, parent_id, name) VALUES ($1, $2, $3, $4) RETURNING id', [req.user.id, c.id, parentId, name]);
  res.json({ id: Number(row.id) });
});
router.patch('/folders/:id', async (req, res) => {
  const f = await folderOf(req.params.id, req.user.id);
  if (!f) return res.status(404).json({ error: 'Ordner nicht gefunden' });
  const name = cleanName(req.body && req.body.name);
  if (!name) return res.status(400).json({ error: 'Bitte einen Namen eingeben' });
  await db.query('UPDATE quiz.lw_folders SET name = $1 WHERE id = $2', [name, f.id]);
  res.json({ ok: true });
});
// Ordner verschieben (parentId = null: oberste Ebene); nicht in sich selbst oder einen eigenen Unterordner
router.put('/folders/:id/parent', async (req, res) => {
  const f = await folderOf(req.params.id, req.user.id);
  if (!f) return res.status(404).json({ error: 'Ordner nicht gefunden' });
  const parentId = await ownFolder(req.user.id, f.course_id, req.body && req.body.parentId);
  if (parentId) {
    const { rows } = await db.pool.query(`WITH RECURSIVE up AS (SELECT id, parent_id FROM quiz.lw_folders WHERE id = $1 UNION ALL SELECT p.id, p.parent_id FROM quiz.lw_folders p JOIN up ON p.id = up.parent_id) SELECT 1 FROM up WHERE id = $2`, [parentId, f.id]);
    if (rows.length) return res.status(400).json({ error: 'Ein Ordner kann nicht in sich selbst liegen' });
  }
  await db.query('UPDATE quiz.lw_folders SET parent_id = $1 WHERE id = $2', [parentId, f.id]);
  res.json({ ok: true });
});
// Ordner löschen: Dokumente und Unterordner rücken in den übergeordneten Ordner
router.delete('/folders/:id', async (req, res) => {
  const f = await folderOf(req.params.id, req.user.id);
  if (!f) return res.status(404).json({ error: 'Ordner nicht gefunden' });
  await db.tx(async (client) => {
    await client.query('UPDATE quiz.docs SET folder_id = $1 WHERE folder_id = $2', [f.parent_id, f.id]);
    await client.query('UPDATE quiz.lw_folders SET parent_id = $1 WHERE parent_id = $2', [f.parent_id, f.id]);
    await client.query('DELETE FROM quiz.lw_folders WHERE id = $1', [f.id]);
  });
  res.json({ ok: true });
});
// Dokument in einen Ordner legen (folderId = null: oberste Ebene des Fachs)
router.put('/docs/:id/folder', async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Nicht gefunden' });
  const d = await db.one('SELECT id, course_id FROM quiz.docs WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
  if (!d || !d.course_id) return res.status(404).json({ error: 'Dokument nicht gefunden' });
  const folderId = await ownFolder(req.user.id, d.course_id, req.body && req.body.folderId);
  await db.query('UPDATE quiz.docs SET folder_id = $1 WHERE id = $2', [folderId, d.id]);
  res.json({ ok: true });
});

module.exports = { router };
