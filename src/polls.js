const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { loadQuiz, canEdit } = require('./quizzes');

// Gespeicherte Umfrage-Ergebnisse: für alle, die die Umfrage bearbeiten dürfen (Besitzer und Mitarbeiter)
const router = express.Router();
router.use(requireAuth);

// Alle Durchläufe einer Umfrage (neueste zuerst)
router.get('/quiz/:quizId', async (req, res) => {
  const quiz = await loadQuiz(req.params.quizId);
  if (!quiz || !(await canEdit(quiz, req.user.id))) return res.status(404).json({ error: 'Umfrage nicht gefunden' });
  const runs = await db.query(
    'SELECT id, participants, created_at FROM quiz.poll_runs WHERE quiz_id = $1 ORDER BY created_at DESC LIMIT 50', [quiz.id]);
  res.json({ title: quiz.title, runs: runs.map((r) => ({ id: Number(r.id), participants: r.participants, createdAt: r.created_at })) });
});

// Ergebnis eines Durchlaufs
router.get('/run/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Ergebnis nicht gefunden' });
  const run = await db.one('SELECT id, quiz_id, owner_id, title, participants, results, created_at FROM quiz.poll_runs WHERE id = $1', [req.params.id]);
  if (!run) return res.status(404).json({ error: 'Ergebnis nicht gefunden' });
  let allowed = Number(run.owner_id) === req.user.id;
  if (!allowed && run.quiz_id) { const quiz = await loadQuiz(run.quiz_id); allowed = Boolean(quiz && await canEdit(quiz, req.user.id)); }
  if (!allowed) return res.status(404).json({ error: 'Ergebnis nicht gefunden' });
  res.json({ id: Number(run.id), quizId: run.quiz_id ? Number(run.quiz_id) : null, title: run.title, participants: run.participants, createdAt: run.created_at, questions: run.results.questions });
});

module.exports = { router };
