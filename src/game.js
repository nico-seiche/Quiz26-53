const express = require('express');
const QRCode = require('qrcode');
const db = require('./db');
const { requireAuth } = require('./auth');
const { loadQuiz } = require('./quizzes');
const { MIN_PLAYERS_FOR_SCORING } = require('./config');
const { awardForGame, publicInfo } = require('./achievements');

// Der Spielstand liegt in der Datenbank. Nach jeder Änderung wird per Supabase Realtime
// ein "update"-Signal an den Kanal game:<pin> geschickt; die Browser laden dann ihren Stand neu.

// Punkte für eine Antwort; später leicht austauschbar
function scoreAnswer(question, answer, questionStartedAt) {
  if (answer.choice !== question.correct) return 0;
  const elapsed = (answer.answered_at - questionStartedAt) / 1000;
  const speed = Math.max(0, 1 - elapsed / question.timeLimit);
  return Math.round(500 + 500 * speed);
}

// Spieler-Schlüssel: Konto oder zufällige Gast-ID aus dem Browser (Header X-Guest-Id)
function playerKey(req) {
  if (req.user) return `u:${req.user.id}`;
  const id = String(req.get('x-guest-id') || '');
  return /^[A-Za-z0-9-]{16,64}$/.test(id) ? `g:${id}` : null;
}

function currentQuestion(game) {
  return game.quiz.questions[game.question_index];
}

async function lockGame(client, pin) {
  const { rows } = await client.query('SELECT * FROM quiz.games WHERE pin = $1 FOR UPDATE', [pin]);
  return rows[0] || null;
}

async function notify(client, pin) {
  await client.query('SELECT quiz.notify($1)', [pin]);
}

// Zeit abgelaufen oder alle haben geantwortet?
async function revealDue(client, game) {
  if (game.state !== 'question') return false;
  if (Date.now() >= game.ends_at.getTime()) return true;
  const { rows } = await client.query(`
    SELECT (SELECT COUNT(*) FROM quiz.game_players WHERE game_pin = $1)::int AS players,
           (SELECT COUNT(*) FROM quiz.game_answers WHERE game_pin = $1 AND question_index = $2)::int AS answers
  `, [game.pin, game.question_index]);
  return rows[0].players > 0 && rows[0].answers >= rows[0].players;
}

async function startQuestion(client, game, index) {
  const q = game.quiz.questions[index];
  await client.query(`
    UPDATE quiz.games SET state = 'question', question_index = $2, question_started_at = now(),
           ends_at = now() + make_interval(secs => $3)
    WHERE pin = $1
  `, [game.pin, index, q.timeLimit]);
}

async function reveal(client, game) {
  const q = currentQuestion(game);
  const { rows: answers } = await client.query(
    'SELECT * FROM quiz.game_answers WHERE game_pin = $1 AND question_index = $2',
    [game.pin, game.question_index],
  );
  for (const answer of answers) {
    const points = scoreAnswer(q, answer, game.question_started_at);
    await client.query(
      'UPDATE quiz.game_answers SET points = $4 WHERE game_pin = $1 AND question_index = $2 AND player_key = $3',
      [game.pin, game.question_index, answer.player_key, points],
    );
    await client.query(
      'UPDATE quiz.game_players SET score = score + $3 WHERE game_pin = $1 AND key = $2',
      [game.pin, answer.player_key, points],
    );
  }
  await client.query("UPDATE quiz.games SET state = 'reveal' WHERE pin = $1", [game.pin]);
}

// Spiel beenden und Punkte aller eingeloggten Spieler dauerhaft speichern (Gäste nicht)
async function finish(client, game) {
  await client.query("UPDATE quiz.games SET state = 'finished' WHERE pin = $1", [game.pin]);
  if (game.question_index < 0) return;
  const { rows: players } = await client.query(
    'SELECT * FROM quiz.game_players WHERE game_pin = $1 ORDER BY score DESC, joined_at',
    [game.pin],
  );
  for (const [i, p] of players.entries()) {
    if (!p.user_id) continue;
    await client.query(`
      INSERT INTO quiz.game_results (user_id, quiz_id, quiz_title, subject_id, score, rank, player_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [p.user_id, game.quiz_id, game.quiz.title, game.quiz.subjectId || null, p.score, i + 1, players.length]);
  }
  await awardForGame(client, game, players);
}

// Führt eine Änderung am Spiel unter Sperre aus; löst vorher fällige Fragen auf und benachrichtigt danach
async function updateGame(pin, fn) {
  return db.tx(async (client) => {
    const game = await lockGame(client, pin);
    if (!game) return { error: 'Kein Spiel mit dieser PIN gefunden', status: 404 };
    let changed = false;
    if (await revealDue(client, game)) {
      await reveal(client, game);
      game.state = 'reveal';
      changed = true;
    }
    const result = (fn && (await fn(client, game))) || {};
    if (changed || result.changed) await notify(client, pin);
    return result;
  });
}

// Liest das Spiel; ist die Zeit einer Frage abgelaufen, wird sie erst aufgelöst
async function loadGame(pin) {
  let game = await db.one('SELECT * FROM quiz.games WHERE pin = $1', [pin]);
  if (game && game.state === 'question' && Date.now() >= game.ends_at.getTime()) {
    await updateGame(pin);
    game = await db.one('SELECT * FROM quiz.games WHERE pin = $1', [pin]);
  }
  if (!game) return null;
  const players = await db.query(
    'SELECT key, user_id, name, score, joined_at FROM quiz.game_players WHERE game_pin = $1 ORDER BY score DESC, joined_at',
    [pin],
  );
  const answers = await db.query(
    'SELECT player_key, choice, points FROM quiz.game_answers WHERE game_pin = $1 AND question_index = $2',
    [pin, game.question_index],
  );
  // Erfolge, die in diesem Spiel erreicht wurden (erst nach Spielende vorhanden)
  const achievements = game.state === 'finished'
    ? await db.query(`
        SELECT a.user_id, a.achievement_key, u.username
        FROM quiz.user_achievements a JOIN quiz.users u ON u.id = a.user_id
        WHERE a.game_pin = $1 ORDER BY a.earned_at, a.achievement_key
      `, [pin])
    : [];
  return { game, players, answers, achievements };
}

// Ergänzt jeden Spieler um Platz, Punkte und Platz vor der aktuellen Frage ("Zwischenstand")
function rankPlayers({ game, players, answers }) {
  const showMoves = game.state === 'reveal' || game.state === 'scoreboard';
  const gained = new Map(answers.map((a) => [a.player_key, showMoves ? a.points : 0]));
  const list = players.map((p, i) => ({
    ...p,
    rank: i + 1,
    gained: gained.get(p.key) || 0,
    prevScore: p.score - (gained.get(p.key) || 0),
  }));
  [...list]
    .sort((a, b) => b.prevScore - a.prevScore || a.joined_at - b.joined_at)
    .forEach((p, i) => { p.prevRank = i + 1; });
  return list;
}

function baseView({ game }) {
  const view = {
    pin: game.pin,
    title: game.quiz.title,
    state: game.state,
    questionIndex: game.question_index,
    total: game.quiz.questions.length,
    minPlayers: MIN_PLAYERS_FOR_SCORING,
    serverNow: Date.now(),
  };
  if (game.state === 'question' || game.state === 'reveal') {
    const q = currentQuestion(game);
    view.question = { text: q.text, answers: q.answers, timeLimit: q.timeLimit };
    view.endsAt = game.ends_at.getTime();
    if (game.state === 'reveal') view.question.correct = q.correct;
  }
  return view;
}

function hostView(data) {
  const view = baseView(data);
  view.players = rankPlayers(data).map((p) => ({
    name: p.name,
    guest: !p.user_id,
    score: p.score,
    prevScore: p.prevScore,
    gained: p.gained,
    rank: p.rank,
    prevRank: p.prevRank,
  }));
  view.answeredCount = data.answers.length;
  if (data.game.state === 'finished') {
    const byUser = new Map();
    for (const a of data.achievements) {
      if (!byUser.has(a.username)) byUser.set(a.username, []);
      byUser.get(a.username).push(publicInfo(a.achievement_key));
    }
    view.achievements = [...byUser].map(([name, items]) => ({ name, items }));
  }
  if (data.game.state === 'reveal') {
    view.distribution = view.question.answers.map(() => 0);
    for (const a of data.answers) view.distribution[a.choice]++;
  }
  return view;
}

function playerView(data, key) {
  const players = rankPlayers(data);
  const player = players.find((p) => p.key === key);
  if (!player) return null;
  const mine = data.answers.find((a) => a.player_key === key);
  const view = baseView(data);
  Object.assign(view, {
    name: player.name,
    guest: !player.user_id,
    score: player.score,
    rank: player.rank,
    prevRank: player.prevRank,
    playerCount: players.length,
  });
  if (view.question) {
    view.myAnswer = mine ? mine.choice : null;
    if (data.game.state === 'reveal') view.lastPoints = mine ? mine.points : 0;
  }
  if (data.game.state === 'scoreboard') view.lastPoints = player.gained;
  if (data.game.state === 'finished') {
    view.achievements = player.user_id
      ? data.achievements.filter((a) => a.user_id === player.user_id).map((a) => publicInfo(a.achievement_key))
      : [];
  }
  return view;
}

function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const router = express.Router();

// Neues Spiel aus einem eigenen Quiz starten
router.post('/', requireAuth, async (req, res) => {
  const quiz = await loadQuiz(req.body.quizId);
  if (!quiz || quiz.owner_id !== req.user.id) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  if (!quiz.questions.length) return res.status(400).json({ error: 'Das Quiz hat noch keine Fragen' });

  // Alte Spiele aufräumen (Ergebnisse bleiben in game_results erhalten)
  await db.query("DELETE FROM quiz.games WHERE created_at < now() - interval '1 day'");

  const snapshot = { title: quiz.title, subjectId: quiz.subject_id, questions: quiz.questions };
  for (let attempt = 0; attempt < 10; attempt++) {
    const rows = await db.query(`
      INSERT INTO quiz.games (pin, host_user_id, quiz_id, quiz) VALUES ($1, $2, $3, $4)
      ON CONFLICT (pin) DO NOTHING RETURNING pin
    `, [generatePin(), req.user.id, quiz.id, JSON.stringify(snapshot)]);
    if (rows.length) return res.json({ pin: rows[0].pin });
  }
  res.status(503).json({ error: 'Keine freie PIN gefunden, bitte erneut versuchen' });
});

// --- Host ---

async function requireHost(req, res, next) {
  const game = await db.one('SELECT host_user_id FROM quiz.games WHERE pin = $1', [req.params.pin]);
  if (!game || Number(game.host_user_id) !== req.user.id) {
    return res.status(404).json({ error: 'Spiel nicht gefunden' });
  }
  next();
}

// QR-Code mit Beitritts-Link für den Host-Bildschirm
router.get('/:pin/qr', requireAuth, requireHost, async (req, res) => {
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const joinUrl = `${base.replace(/\/$/, '')}/play?pin=${req.params.pin}`;
  const qr = await QRCode.toDataURL(joinUrl, { margin: 1, width: 400 });
  res.json({ joinUrl, qr });
});

router.get('/:pin/host', requireAuth, requireHost, async (req, res) => {
  res.json(hostView(await loadGame(req.params.pin)));
});

router.post('/:pin/next', requireAuth, requireHost, async (req, res) => {
  await updateGame(req.params.pin, async (client, game) => {
    if (game.state === 'lobby') {
      await startQuestion(client, game, 0);
    } else if (game.state === 'question') {
      await reveal(client, game);
    } else if (game.state === 'reveal') {
      await client.query("UPDATE quiz.games SET state = 'scoreboard' WHERE pin = $1", [game.pin]);
    } else if (game.state === 'scoreboard') {
      const next = game.question_index + 1;
      if (next < game.quiz.questions.length) await startQuestion(client, game, next);
      else await finish(client, game);
    } else {
      return {};
    }
    return { changed: true };
  });
  res.json(hostView(await loadGame(req.params.pin)));
});

router.post('/:pin/end', requireAuth, requireHost, async (req, res) => {
  await updateGame(req.params.pin, async (client, game) => {
    if (game.state === 'finished') return {};
    await finish(client, game);
    return { changed: true };
  });
  res.json(hostView(await loadGame(req.params.pin)));
});

// --- Spieler (eingeloggt oder Gast) ---

router.post('/:pin/join', async (req, res) => {
  const key = playerKey(req);
  if (!key) return res.status(400).json({ error: 'Ungültige Gast-ID, bitte Seite neu laden' });

  const result = await updateGame(req.params.pin, async (client, game) => {
    const { rows } = await client.query(
      'SELECT 1 FROM quiz.game_players WHERE game_pin = $1 AND key = $2', [game.pin, key],
    );
    if (rows.length) return {};
    if (game.state !== 'lobby') return { error: 'Das Spiel läuft bereits', status: 409 };

    const name = req.user ? req.user.username : String(req.body.name || '').trim().slice(0, 20);
    if (!name) return { error: 'Bitte gib einen Namen ein', status: 400 };
    const taken = await client.query(
      'SELECT 1 FROM quiz.game_players WHERE game_pin = $1 AND lower(name) = lower($2)', [game.pin, name],
    );
    if (taken.rows.length) return { error: 'Dieser Name ist schon vergeben', status: 409 };

    await client.query(
      'INSERT INTO quiz.game_players (game_pin, key, user_id, name) VALUES ($1, $2, $3, $4)',
      [game.pin, key, req.user ? req.user.id : null, name],
    );
    return { changed: true };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(playerView(await loadGame(req.params.pin), key));
});

router.get('/:pin/me', async (req, res) => {
  const data = await loadGame(req.params.pin);
  const view = data && playerView(data, playerKey(req));
  if (!view) return res.status(404).json({ error: 'Du bist diesem Spiel nicht beigetreten', notJoined: true });
  res.json(view);
});

router.post('/:pin/answer', async (req, res) => {
  const key = playerKey(req);
  const choice = req.body.choice;
  await updateGame(req.params.pin, async (client, game) => {
    if (game.state !== 'question' || !Number.isInteger(choice)) return {};
    if (choice < 0 || choice >= currentQuestion(game).answers.length) return {};
    const { rowCount } = await client.query(`
      INSERT INTO quiz.game_answers (game_pin, question_index, player_key, choice)
      SELECT $1, $2, $3, $4 WHERE EXISTS (
        SELECT 1 FROM quiz.game_players WHERE game_pin = $1 AND key = $3
      ) ON CONFLICT DO NOTHING
    `, [game.pin, game.question_index, key, choice]);
    if (!rowCount) return {};
    // Letzte Antwort? Dann direkt auflösen
    if (await revealDue(client, game)) await reveal(client, game);
    return { changed: true };
  });
  const data = await loadGame(req.params.pin);
  const view = data && playerView(data, key);
  if (!view) return res.status(404).json({ error: 'Du bist diesem Spiel nicht beigetreten' });
  res.json(view);
});

module.exports = { router };
