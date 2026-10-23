const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

async function loadQuiz(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const quiz = await db.one('SELECT * FROM quiz.quizzes WHERE id = $1', [id]);
  if (!quiz) return null;
  quiz.id = Number(quiz.id);
  quiz.owner_id = Number(quiz.owner_id);
  const rows = await db.query('SELECT * FROM quiz.questions WHERE quiz_id = $1 ORDER BY position', [id]);
  quiz.questions = rows.map((q) => ({
    text: q.text,
    answers: q.answers,
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

async function saveQuestions(client, quizId, questions) {
  await client.query('DELETE FROM quiz.questions WHERE quiz_id = $1', [quizId]);
  for (const [i, q] of questions.entries()) {
    await client.query(`
      INSERT INTO quiz.questions (quiz_id, position, text, answers, correct, time_limit)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [quizId, i, q.text, JSON.stringify(q.answers), q.correct, q.timeLimit]);
  }
}

async function readBody(req, res) {
  const title = String(req.body.title || '').trim();
  if (!title) {
    res.status(400).json({ error: 'Titel fehlt' });
    return null;
  }
  const mode = req.body.mode === undefined ? 'single' : req.body.mode;
  if (!['single', 'team'].includes(mode)) {
    res.status(400).json({ error: 'Ungültiger Spielmodus' });
    return null;
  }
  const subjectId = Number(req.body.subjectId);
  const subject = Number.isInteger(subjectId)
    && await db.one('SELECT id FROM quiz.subjects WHERE id = $1', [subjectId]);
  if (!subject) {
    res.status(400).json({ error: 'Bitte ein Fach auswählen' });
    return null;
  }
  try {
    return { title, subjectId, mode, questions: validateQuestions(req.body.questions || []) };
  } catch (msg) {
    res.status(400).json({ error: msg });
    return null;
  }
}

router.get('/', async (req, res) => {
  const quizzes = await db.query(`
    SELECT q.id, q.title, q.updated_at, q.mode, s.name AS subject, s.icon AS subject_icon,
           (SELECT COUNT(*)::int FROM quiz.questions WHERE quiz_id = q.id) AS question_count
    FROM quiz.quizzes q LEFT JOIN quiz.subjects s ON s.id = q.subject_id
    WHERE q.owner_id = $1 ORDER BY q.updated_at DESC
  `, [req.user.id]);
  res.json(quizzes);
});

router.post('/', async (req, res) => {
  const body = await readBody(req, res);
  if (!body) return;
  const id = await db.tx(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO quiz.quizzes (owner_id, title, subject_id, mode) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.user.id, body.title, body.subjectId, body.mode],
    );
    await saveQuestions(client, rows[0].id, body.questions);
    return Number(rows[0].id);
  });
  res.json({ id });
});

router.get('/:id', async (req, res) => {
  const quiz = await loadQuiz(req.params.id);
  if (!quiz || quiz.owner_id !== req.user.id) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  res.json(quiz);
});

router.put('/:id', async (req, res) => {
  const quiz = await loadQuiz(req.params.id);
  if (!quiz || quiz.owner_id !== req.user.id) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  const body = await readBody(req, res);
  if (!body) return;
  await db.tx(async (client) => {
    await client.query('UPDATE quiz.quizzes SET title = $1, subject_id = $2, mode = $3, updated_at = now() WHERE id = $4', [
      body.title, body.subjectId, body.mode, quiz.id,
    ]);
    await saveQuestions(client, quiz.id, body.questions);
  });
  res.json({ id: quiz.id });
});

router.delete('/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  const rows = await db.query('DELETE FROM quiz.quizzes WHERE id = $1 AND owner_id = $2 RETURNING id', [
    req.params.id, req.user.id,
  ]);
  if (!rows.length) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  res.json({ ok: true });
});

module.exports = { router, loadQuiz };
