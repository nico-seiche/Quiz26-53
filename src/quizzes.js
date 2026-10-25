const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { areFriends, findUser } = require('./friends');

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
    id: Number(q.id),
    rev: q.rev,
    text: q.text,
    answers: q.answers,
    correct: q.correct,
    timeLimit: q.time_limit,
  }));
  return quiz;
}

// Darf der Nutzer das Quiz bearbeiten und starten? Besitzer oder eingeladener Mitarbeiter.
async function canEdit(quiz, userId) {
  if (quiz.owner_id === userId) return true;
  return Boolean(await db.one('SELECT 1 FROM quiz.quiz_collaborators WHERE quiz_id = $1 AND user_id = $2', [quiz.id, userId]));
}

// Versionsstand eines Quiz als Text (µs-genau), um gleichzeitiges Speichern zu erkennen
const VERSION_SQL = `to_char(q.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

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
           u.username AS owner, (q.owner_id = $1) AS mine,
           (SELECT COUNT(*)::int FROM quiz.questions WHERE quiz_id = q.id) AS question_count,
           (SELECT COUNT(*)::int FROM quiz.quiz_collaborators WHERE quiz_id = q.id) AS collaborator_count
    FROM quiz.quizzes q
    JOIN quiz.users u ON u.id = q.owner_id
    LEFT JOIN quiz.subjects s ON s.id = q.subject_id
    WHERE q.owner_id = $1 OR EXISTS (SELECT 1 FROM quiz.quiz_collaborators c WHERE c.quiz_id = q.id AND c.user_id = $1)
    ORDER BY q.updated_at DESC
  `, [req.user.id]);
  res.json(quizzes);
});

router.post('/', async (req, res) => {
  const body = await readBody(req, res);
  if (!body) return;
  const id = await db.tx(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO quiz.quizzes (owner_id, title, subject_id, mode, updated_by) VALUES ($1, $2, $3, $4, $1) RETURNING id',
      [req.user.id, body.title, body.subjectId, body.mode],
    );
    await saveQuestions(client, rows[0].id, body.questions);
    return Number(rows[0].id);
  });
  res.json({ id });
});

router.get('/:id', async (req, res) => {
  const quiz = await loadQuiz(req.params.id);
  if (!quiz || !(await canEdit(quiz, req.user.id))) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  const [info, collaborators] = await Promise.all([
    db.one(`SELECT ${VERSION_SQL} AS version, o.username AS owner, ub.username AS updated_by_name
            FROM quiz.quizzes q JOIN quiz.users o ON o.id = q.owner_id LEFT JOIN quiz.users ub ON ub.id = q.updated_by
            WHERE q.id = $1`, [quiz.id]),
    db.query(`SELECT u.username FROM quiz.quiz_collaborators c JOIN quiz.users u ON u.id = c.user_id
              WHERE c.quiz_id = $1 ORDER BY c.added_at`, [quiz.id]),
  ]);
  res.json({
    ...quiz, isOwner: quiz.owner_id === req.user.id, owner: info.owner, version: info.version,
    updatedBy: info.updated_by_name, collaborators: collaborators.map((c) => c.username),
  });
});

// --- Gleichzeitiges Bearbeiten ---
// Lock-Dauer: Der Browser meldet sich alle paar Sekunden; wer länger schweigt, verliert seine Sperre.
const LOCK_SECONDS = 8;
const isId = (v) => /^\d+$/.test(String(v));
const notifyQuiz = (quizId) => db.query('SELECT quiz.notify($1)', [`q${quizId}`]).catch(() => {});

// Prüft eine einzelne Frage (gleiche Regeln wie beim Anlegen eines Quiz) und liefert sie bereinigt
function cleanQuestion(input) {
  try {
    const q = { ...input, answers: (Array.isArray(input.answers) ? input.answers : []).map((a) => String(a || '')) };
    // Leere Antwortfelder am Ende gelten als nicht vorhanden (Fragen mit 2–3 Antworten)
    while (q.answers.length > 2 && !q.answers[q.answers.length - 1].trim()) q.answers.pop();
    return { ok: validateQuestions([q])[0] };
  } catch (msg) {
    return { error: String(msg).replace(/^Frage 1: /, '') };
  }
}

// Wer hält gerade welche Sperre? Nur frische Einträge zählen.
const fresh = `seen_at > now() - interval '${LOCK_SECONDS} seconds'`;

// Lebenszeichen + Lesen: wird alle paar Sekunden vom Editor aufgerufen.
// editing: Frage-ID, die ich bearbeiten will (Sperre anfordern), null = keine, fehlt = unverändert lassen.
router.post('/:id/live', async (req, res) => {
  const quiz = await loadQuiz(req.params.id);
  if (!quiz || !(await canEdit(quiz, req.user.id))) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  const { editing, leave } = req.body || {};
  let denied = null;
  let lockChanged = false;

  if (leave) {
    await db.query('DELETE FROM quiz.quiz_presence WHERE quiz_id = $1 AND user_id = $2', [quiz.id, req.user.id]);
    await notifyQuiz(quiz.id);
    return res.json({ ok: true });
  }

  await db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [quiz.id]);
    const { rows: [mine] } = await client.query(
      `SELECT question_id, (${fresh}) AS alive FROM quiz.quiz_presence WHERE quiz_id = $1 AND user_id = $2`, [quiz.id, req.user.id]);
    const before = mine && mine.alive && mine.question_id ? Number(mine.question_id) : null;
    let qid = before;
    if (editing === null) qid = null;
    else if (editing !== undefined && isId(editing) && quiz.questions.some((q) => q.id === Number(editing))) {
      const { rows: [holder] } = await client.query(`
        SELECT u.username FROM quiz.quiz_presence p JOIN quiz.users u ON u.id = p.user_id
        WHERE p.quiz_id = $1 AND p.question_id = $2 AND p.user_id <> $3 AND p.${fresh}`, [quiz.id, editing, req.user.id]);
      if (holder) denied = { question: Number(editing), by: holder.username };
      else qid = Number(editing);
    }
    await client.query(`
      INSERT INTO quiz.quiz_presence (quiz_id, user_id, question_id, seen_at) VALUES ($1, $2, $3, now())
      ON CONFLICT (quiz_id, user_id) DO UPDATE SET question_id = $3, seen_at = now()`, [quiz.id, req.user.id, qid]);
    lockChanged = qid !== before;
  });
  if (lockChanged) await notifyQuiz(quiz.id);

  const fresh2 = await loadQuiz(quiz.id);
  const [presence, meta] = await Promise.all([
    db.query(`SELECT u.username, p.question_id, (p.user_id = $2) AS me FROM quiz.quiz_presence p JOIN quiz.users u ON u.id = p.user_id
              WHERE p.quiz_id = $1 AND p.${fresh} ORDER BY p.seen_at`, [quiz.id, req.user.id]),
    db.one('SELECT title, subject_id, mode FROM quiz.quizzes WHERE id = $1', [quiz.id]),
  ]);
  res.json({
    serverNow: Date.now(),
    meta: { title: meta.title, subjectId: meta.subject_id, mode: meta.mode },
    questions: fresh2.questions,
    presence: presence.map((p) => ({ username: p.username, editing: p.question_id ? Number(p.question_id) : null, me: p.me })),
    denied,
  });
});

// Hält der Nutzer gerade die (frische) Sperre dieser Frage? Sonst Fehlertext für die Antwort.
async function lockProblem(quizId, questionId, userId) {
  const mine = await db.one(`SELECT 1 FROM quiz.quiz_presence WHERE quiz_id = $1 AND user_id = $2 AND question_id = $3 AND ${fresh}`,
    [quizId, userId, questionId]);
  if (mine) return null;
  const other = await db.one(`SELECT u.username FROM quiz.quiz_presence p JOIN quiz.users u ON u.id = p.user_id
    WHERE p.quiz_id = $1 AND p.question_id = $2 AND p.user_id <> $3 AND p.${fresh}`, [quizId, questionId, userId]);
  return other ? { by: other.username, error: `${other.username} bearbeitet diese Frage gerade.` }
    : { lost: true, error: 'Die Bearbeitung war kurz unterbrochen – bitte noch einmal versuchen.' };
}

// Neue Frage ans Ende; der Ersteller behält sie gleich in Bearbeitung
router.post('/:id/questions', async (req, res) => {
  const quiz = await loadQuiz(req.params.id);
  if (!quiz || !(await canEdit(quiz, req.user.id))) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  const { ok, error } = cleanQuestion(req.body);
  if (error) return res.status(400).json({ error });
  const created = await db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [quiz.id]);
    const { rows: [pos] } = await client.query('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM quiz.questions WHERE quiz_id = $1', [quiz.id]);
    const { rows: [row] } = await client.query(`
      INSERT INTO quiz.questions (quiz_id, position, text, answers, correct, time_limit)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, rev`, [quiz.id, pos.next, ok.text, JSON.stringify(ok.answers), ok.correct, ok.timeLimit]);
    await client.query(`
      INSERT INTO quiz.quiz_presence (quiz_id, user_id, question_id, seen_at) VALUES ($1, $2, $3, now())
      ON CONFLICT (quiz_id, user_id) DO UPDATE SET question_id = $3, seen_at = now()`, [quiz.id, req.user.id, row.id]);
    await client.query('UPDATE quiz.quizzes SET updated_at = now(), updated_by = $1 WHERE id = $2', [req.user.id, quiz.id]);
    return row;
  });
  await notifyQuiz(quiz.id);
  res.json({ id: Number(created.id), rev: created.rev });
});

router.put('/:id/questions/:qid', async (req, res) => {
  const quiz = await loadQuiz(req.params.id);
  if (!quiz || !(await canEdit(quiz, req.user.id)) || !quiz.questions.some((q) => q.id === Number(req.params.qid))) {
    return res.status(404).json({ error: 'Frage nicht gefunden' });
  }
  const problem = await lockProblem(quiz.id, Number(req.params.qid), req.user.id);
  if (problem) return res.status(409).json({ ...problem, lock: true });
  const { ok, error } = cleanQuestion(req.body);
  if (error) return res.status(400).json({ error });
  const row = await db.one(`
    UPDATE quiz.questions SET text = $1, answers = $2, correct = $3, time_limit = $4, rev = rev + 1
    WHERE id = $5 AND quiz_id = $6 RETURNING rev`, [ok.text, JSON.stringify(ok.answers), ok.correct, ok.timeLimit, req.params.qid, quiz.id]);
  await db.query('UPDATE quiz.quizzes SET updated_at = now(), updated_by = $1 WHERE id = $2', [req.user.id, quiz.id]);
  await notifyQuiz(quiz.id);
  res.json({ rev: row.rev });
});

router.delete('/:id/questions/:qid', async (req, res) => {
  const quiz = await loadQuiz(req.params.id);
  if (!quiz || !(await canEdit(quiz, req.user.id)) || !quiz.questions.some((q) => q.id === Number(req.params.qid))) {
    return res.status(404).json({ error: 'Frage nicht gefunden' });
  }
  const other = await db.one(`SELECT u.username FROM quiz.quiz_presence p JOIN quiz.users u ON u.id = p.user_id
    WHERE p.quiz_id = $1 AND p.question_id = $2 AND p.user_id <> $3 AND p.${fresh}`, [quiz.id, req.params.qid, req.user.id]);
  if (other) return res.status(409).json({ error: `${other.username} bearbeitet diese Frage gerade.` });
  await db.tx(async (client) => {
    await client.query('DELETE FROM quiz.questions WHERE id = $1 AND quiz_id = $2', [req.params.qid, quiz.id]);
    await client.query(`UPDATE quiz.questions q SET position = n.pos FROM
      (SELECT id, row_number() OVER (ORDER BY position, id) - 1 AS pos FROM quiz.questions WHERE quiz_id = $1) n
      WHERE q.id = n.id`, [quiz.id]);
    await client.query('UPDATE quiz.quizzes SET updated_at = now(), updated_by = $1 WHERE id = $2', [req.user.id, quiz.id]);
  });
  await notifyQuiz(quiz.id);
  res.json({ ok: true });
});

// Reihenfolge: komplette Liste der Frage-IDs
router.put('/:id/order', async (req, res) => {
  const quiz = await loadQuiz(req.params.id);
  if (!quiz || !(await canEdit(quiz, req.user.id))) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number) : [];
  const have = quiz.questions.map((q) => q.id).sort((a, b) => a - b);
  if (ids.length !== have.length || [...ids].sort((a, b) => a - b).some((v, i) => v !== have[i])) {
    return res.status(409).json({ error: 'Die Fragen haben sich inzwischen geändert.', stale: true });
  }
  await db.tx(async (client) => {
    for (const [i, qid] of ids.entries()) await client.query('UPDATE quiz.questions SET position = $1 WHERE id = $2 AND quiz_id = $3', [i, qid, quiz.id]);
  });
  await notifyQuiz(quiz.id);
  res.json({ ok: true });
});

// Titel, Fach und Spielmodus ändert nur der Besitzer
router.patch('/:id/meta', async (req, res) => {
  const quiz = await loadQuiz(req.params.id);
  if (!quiz || quiz.owner_id !== req.user.id) return res.status(403).json({ error: 'Nur der Besitzer ändert Titel, Fach und Modus.' });
  const body = await readBody({ body: { ...req.body, questions: [] } }, res);
  if (!body) return;
  await db.query('UPDATE quiz.quizzes SET title = $1, subject_id = $2, mode = $3, updated_at = now(), updated_by = $4 WHERE id = $5',
    [body.title, body.subjectId, body.mode, req.user.id, quiz.id]);
  await notifyQuiz(quiz.id);
  res.json({ ok: true });
});

// Mitarbeiter einladen (nur Besitzer)
router.post('/:id/collaborators', async (req, res) => {
  const quiz = await loadQuiz(req.params.id);
  if (!quiz || quiz.owner_id !== req.user.id) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  const input = String(req.body.username || '').trim();
  if (!input) return res.status(400).json({ error: 'Nutzername oder #ID fehlt' });
  const user = await findUser(input);
  if (!user) return res.status(404).json({ error: `Spieler „${input}“ nicht gefunden.` });
  if (Number(user.id) === req.user.id) return res.status(400).json({ error: 'Das Quiz gehört dir bereits.' });
  if (!(await areFriends(req.user.id, user.id))) {
    return res.status(403).json({ error: `${user.username} ist noch nicht dein Freund. Schicke zuerst unter Profil → Freunde eine Anfrage.` });
  }
  await db.query('INSERT INTO quiz.quiz_collaborators (quiz_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [quiz.id, user.id]);
  res.json({ username: user.username });
});

// Mitarbeiter entfernen: der Besitzer jeden, ein Mitarbeiter sich selbst ("Verlassen")
router.delete('/:id/collaborators/:username', async (req, res) => {
  const quiz = await loadQuiz(req.params.id);
  if (!quiz || !(await canEdit(quiz, req.user.id))) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  const user = await db.one('SELECT id FROM quiz.users WHERE lower(username) = lower($1)', [req.params.username]);
  if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden' });
  if (quiz.owner_id !== req.user.id && Number(user.id) !== req.user.id) return res.status(403).json({ error: 'Nur der Besitzer kann andere entfernen' });
  await db.query('DELETE FROM quiz.quiz_collaborators WHERE quiz_id = $1 AND user_id = $2', [quiz.id, user.id]);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  const rows = await db.query('DELETE FROM quiz.quizzes WHERE id = $1 AND owner_id = $2 RETURNING id', [
    req.params.id, req.user.id,
  ]);
  if (!rows.length) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  res.json({ ok: true });
});

module.exports = { router, loadQuiz, canEdit };
