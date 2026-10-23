const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

function loadQuiz(id) {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(id);
  if (!quiz) return null;
  quiz.questions = db
    .prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY position')
    .all(id)
    .map((q) => ({
      text: q.text,
      answers: JSON.parse(q.answers),
      correct: q.correct,
      timeLimit: q.time_limit,
    }));
  return quiz;
}

// Prüft die Fragen aus dem Request und liefert eine bereinigte Liste oder wirft einen Fehlertext
function validateQuestions(input) {
  if (!Array.isArray(input)) throw 'Fragen fehlen';
  return input.map((q, i) => {
    const nr = i + 1;
    const text = String(q.text || '').trim();
    const answers = (Array.isArray(q.answers) ? q.answers : []).map((a) => String(a || '').trim());
    const correct = Number(q.correct);
    const timeLimit = Number(q.timeLimit) || 20;
    if (!text) throw `Frage ${nr}: Fragetext fehlt`;
    if (answers.length < 2 || answers.length > 4) throw `Frage ${nr}: 2–4 Antworten erforderlich`;
    if (answers.some((a) => !a)) throw `Frage ${nr}: leere Antwort`;
    if (!Number.isInteger(correct) || correct < 0 || correct >= answers.length) {
      throw `Frage ${nr}: richtige Antwort markieren`;
    }
    if (timeLimit < 5 || timeLimit > 120) throw `Frage ${nr}: Zeitlimit 5–120 Sekunden`;
    return { text, answers, correct, timeLimit };
  });
}

const saveQuestions = db.transaction((quizId, questions) => {
  db.prepare('DELETE FROM questions WHERE quiz_id = ?').run(quizId);
  const insert = db.prepare(`
    INSERT INTO questions (quiz_id, position, text, answers, correct, time_limit)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  questions.forEach((q, i) => {
    insert.run(quizId, i, q.text, JSON.stringify(q.answers), q.correct, q.timeLimit);
  });
});

function readBody(req, res) {
  const title = String(req.body.title || '').trim();
  if (!title) {
    res.status(400).json({ error: 'Titel fehlt' });
    return null;
  }
  try {
    return { title, questions: validateQuestions(req.body.questions || []) };
  } catch (msg) {
    res.status(400).json({ error: msg });
    return null;
  }
}

router.get('/', (req, res) => {
  const quizzes = db.prepare(`
    SELECT q.id, q.title, q.updated_at,
           (SELECT COUNT(*) FROM questions WHERE quiz_id = q.id) AS question_count
    FROM quizzes q WHERE q.owner_id = ? ORDER BY q.updated_at DESC
  `).all(req.user.id);
  res.json(quizzes);
});

router.post('/', (req, res) => {
  const body = readBody(req, res);
  if (!body) return;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO quizzes (owner_id, title) VALUES (?, ?)')
    .run(req.user.id, body.title);
  saveQuestions(lastInsertRowid, body.questions);
  res.json({ id: lastInsertRowid });
});

router.get('/:id', (req, res) => {
  const quiz = loadQuiz(req.params.id);
  if (!quiz || quiz.owner_id !== req.user.id) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  res.json(quiz);
});

router.put('/:id', (req, res) => {
  const quiz = db.prepare('SELECT * FROM quizzes WHERE id = ?').get(req.params.id);
  if (!quiz || quiz.owner_id !== req.user.id) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  const body = readBody(req, res);
  if (!body) return;
  db.prepare("UPDATE quizzes SET title = ?, updated_at = datetime('now') WHERE id = ?")
    .run(body.title, quiz.id);
  saveQuestions(quiz.id, body.questions);
  res.json({ id: quiz.id });
});

router.delete('/:id', (req, res) => {
  const result = db
    .prepare('DELETE FROM quizzes WHERE id = ? AND owner_id = ?')
    .run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  res.json({ ok: true });
});

module.exports = { router, loadQuiz };
