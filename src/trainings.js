const express = require('express');
const { requireAuth } = require('./auth');
const db = require('./db');

// Übungen (Schemata und Muster) für die Learnworld: werden mit dem Dokumentinhalt vorbereitet und hier nur gelesen.
const router = express.Router();
router.use(requireAuth);
const isId = (v) => /^\d{1,15}$/.test(String(v));

router.get('/:id', async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Übung nicht gefunden' });
  const t = await db.one(`SELECT t.id, t.title, t.kind, t.data, c.slug AS course_slug, c.name AS course_name
    FROM quiz.trainings t LEFT JOIN quiz.lw_courses c ON c.id = t.course_id WHERE t.id = $1 AND t.owner_id = $2`, [req.params.id, req.user.id]);
  if (!t) return res.status(404).json({ error: 'Übung nicht gefunden' });
  res.json({ id: Number(t.id), title: t.title, kind: t.kind, data: t.data, course: t.course_slug ? { slug: t.course_slug, name: t.course_name } : null });
});
router.delete('/:id', async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Übung nicht gefunden' });
  await db.query('DELETE FROM quiz.trainings WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

module.exports = { router };
