const express = require('express');
const QRCode = require('qrcode');
const db = require('./db');
const { requireAuth } = require('./auth');
const { loadQuiz, canEdit } = require('./quizzes');
const { MIN_PLAYERS_FOR_SCORING, TEAM_COUNT, MIN_PLAYERS_PER_TEAM, streakBonus } = require('./config');
const { standings } = require('./teams');
const { awardForGame, publicInfo } = require('./achievements');
const { answerMask, correctMask, isFullyCorrect, share, indexes, bit } = require('./answers');

// Der Spielstand liegt in der Datenbank. Nach jeder Änderung wird per Supabase Realtime
// ein "update"-Signal an den Kanal game:<pin> geschickt; die Browser laden dann ihren Stand neu.

// Punkte für eine Antwort; später leicht austauschbar
// Mehrfachauswahl: anteilig (richtige Treffer minus Fehlgriffe); Umfragen geben keine Punkte
function scoreAnswer(question, answer, questionStartedAt) {
  const fraction = question.multi ? share(question, answer) : (isFullyCorrect(question, answer) ? 1 : 0);
  if (!fraction) return 0;
  const elapsed = (answer.answered_at - questionStartedAt) / 1000;
  const speed = Math.max(0, 1 - elapsed / question.timeLimit);
  return Math.round((500 + 500 * speed) * fraction);
}

const isPoll = (game) => game.quiz.kind === 'poll';

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
  if (isPoll(game)) {   // Umfrage: keine Punkte, nur die Auflösung (Verteilung) zeigen
    await client.query("UPDATE quiz.games SET state = 'reveal' WHERE pin = $1", [game.pin]);
    return;
  }
  const { rows: answers } = await client.query(
    'SELECT * FROM quiz.game_answers WHERE game_pin = $1 AND question_index = $2',
    [game.pin, game.question_index],
  );
  // Welche früheren Fragen hat jeder richtig beantwortet? (für die Serie; unbeantwortet zählt als falsch)
  const { rows: earlier } = await client.query(
    'SELECT player_key, question_index, choice, mask FROM quiz.game_answers WHERE game_pin = $1 AND question_index < $2',
    [game.pin, game.question_index],
  );
  const correctBefore = new Map();
  for (const a of earlier) {
    if (!isFullyCorrect(game.quiz.questions[a.question_index], a)) continue;
    if (!correctBefore.has(a.player_key)) correctBefore.set(a.player_key, new Set());
    correctBefore.get(a.player_key).add(a.question_index);
  }
  for (const answer of answers) {
    const base = scoreAnswer(q, answer, game.question_started_at);
    const full = isFullyCorrect(q, answer);   // Serie und Bonus gibt es nur für vollständig richtige Antworten
    let streak = 0;
    if (full) {  // richtig beantwortet: Serie = diese Antwort plus die richtigen Antworten direkt davor
      streak = 1;
      const before = correctBefore.get(answer.player_key) || new Set();
      for (let i = game.question_index - 1; before.has(i); i--) streak++;
    }
    const bonus = full ? streakBonus(streak) : 0;
    const points = base + bonus;
    await client.query(
      `UPDATE quiz.game_answers SET points = $4, streak = $5, bonus = $6
       WHERE game_pin = $1 AND question_index = $2 AND player_key = $3`,
      [game.pin, game.question_index, answer.player_key, points, streak, bonus],
    );
    await client.query(
      'UPDATE quiz.game_players SET score = score + $3 WHERE game_pin = $1 AND key = $2',
      [game.pin, answer.player_key, points],
    );
  }
  await client.query("UPDATE quiz.games SET state = 'reveal' WHERE pin = $1", [game.pin]);
}

// Team-Modus: Spieler mischen und reihum auf die Teams verteilen (Teamgrößen unterscheiden sich um höchstens 1)
async function assignTeams(client, game) {
  const { rows } = await client.query('SELECT key FROM quiz.game_players WHERE game_pin = $1', [game.pin]);
  const keys = rows.map((r) => r.key);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  await client.query(`
    UPDATE quiz.game_players p SET team = t.team
    FROM unnest($2::text[], $3::int[]) AS t(key, team)
    WHERE p.game_pin = $1 AND p.key = t.key
  `, [game.pin, keys, keys.map((_, i) => i % game.team_count)]);
}

// Spiel beenden und Punkte aller eingeloggten Spieler dauerhaft speichern (Gäste nicht)
// Auswertung einer Umfrage: je Frage, wie oft jede Antwort gewählt wurde
async function pollResults(client, game) {
  const { rows: answers } = await client.query('SELECT question_index, choice, mask FROM quiz.game_answers WHERE game_pin = $1', [game.pin]);
  const { rows: [{ n }] } = await client.query('SELECT COUNT(*)::int AS n FROM quiz.game_players WHERE game_pin = $1', [game.pin]);
  return {
    participants: n,
    questions: game.quiz.questions.map((q, qi) => {
      const counts = q.answers.map(() => 0);
      let respondents = 0;
      for (const a of answers.filter((x) => x.question_index === qi)) {
        respondents++;
        for (const i of indexes(answerMask(a), counts.length)) counts[i]++;
      }
      return { text: q.text, answers: q.answers, multi: Boolean(q.multi), counts, respondents };
    }),
  };
}

async function finish(client, game) {
  await client.query("UPDATE quiz.games SET state = 'finished' WHERE pin = $1", [game.pin]);
  if (game.question_index < 0) return;
  if (isPoll(game)) {   // Umfrage: Ergebnis speichern statt Punkte; keine Ranglisten-Einträge, keine Erfolge
    const results = await pollResults(client, game);
    await client.query(
      'INSERT INTO quiz.poll_runs (quiz_id, owner_id, title, participants, results) VALUES ($1, $2, $3, $4, $5)',
      [game.quiz_id, game.host_user_id, game.quiz.title, results.participants, JSON.stringify(results)],
    );
    return;
  }
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

// Automatischer Ablauf: so lange bleibt jeder Zustand stehen, bevor es von selbst weitergeht (Sekunden)
const AUTO_DELAY = { teams: 6, reveal: 5, scoreboard: 4 };
// Umfragen zeigen die Verteilung etwas länger (zum Besprechen) und haben keinen Zwischenstand
const autoDelay = (game) => (isPoll(game) && game.state === 'reveal' ? 8 : AUTO_DELAY[game.state]);

// Ein Schritt im Ablauf (vom Host per Klick oder automatisch ausgelöst)
async function advanceState(client, game) {
  if (game.state === 'lobby' && game.team_count > 0) {
    const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM quiz.game_players WHERE game_pin = $1', [game.pin]);
    const needed = game.team_count * MIN_PLAYERS_PER_TEAM;
    if (rows[0].n < needed) {
      return { error: `Für ${game.team_count} Teams braucht es mindestens ${needed} Teilnehmer.`, status: 409 };
    }
    await assignTeams(client, game);
    await client.query("UPDATE quiz.games SET state = 'teams' WHERE pin = $1", [game.pin]);
  } else if (game.state === 'lobby' || game.state === 'teams') {
    await startQuestion(client, game, 0);
  } else if (game.state === 'question') {
    await reveal(client, game);
  } else if (game.state === 'reveal' && isPoll(game)) {
    const next = game.question_index + 1;   // Umfrage: ohne Zwischenstand direkt weiter
    if (next < game.quiz.questions.length) await startQuestion(client, game, next);
    else await finish(client, game);
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
}

// Ist im Automatik-Modus der nächste Schritt fällig? (Zeit seit dem letzten Zustandswechsel, gemessen von der Datenbank)
async function autoDue(client, game) {
  const delay = autoDelay(game);
  if (!game.auto || !delay) return false;
  const { rows } = await client.query('SELECT EXTRACT(EPOCH FROM (now() - state_since)) AS since FROM quiz.games WHERE pin = $1', [game.pin]);
  return Number(rows[0].since) >= delay;
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
    // Automatik: einen fälligen Schritt von selbst ausführen (höchstens einer pro Aufruf, danach beginnt die Wartezeit neu)
    if (await autoDue(client, game)) {
      const step = await advanceState(client, game);
      if (step.changed) {
        changed = true;
        Object.assign(game, await lockGame(client, pin));
      }
    }
    const result = (fn && (await fn(client, game))) || {};
    if (changed || result.changed) await notify(client, pin);
    return result;
  });
}

// Liest das Spiel; ist die Zeit einer Frage abgelaufen, wird sie erst aufgelöst
async function loadGame(pin) {
  let game = await db.one('SELECT * FROM quiz.games WHERE pin = $1', [pin]);
  const sinceRow = game && game.auto && AUTO_DELAY[game.state]
    ? await db.one('SELECT EXTRACT(EPOCH FROM (now() - state_since)) AS since FROM quiz.games WHERE pin = $1', [pin]) : null;
  if (game && ((game.state === 'question' && Date.now() >= game.ends_at.getTime())
      || (sinceRow && Number(sinceRow.since) >= autoDelay(game)))) {
    await updateGame(pin);
    game = await db.one('SELECT * FROM quiz.games WHERE pin = $1', [pin]);
  }
  if (!game) return null;
  const players = await db.query(
    'SELECT key, user_id, name, score, team, joined_at FROM quiz.game_players WHERE game_pin = $1 ORDER BY score DESC, joined_at',
    [pin],
  );
  const answers = await db.query(
    'SELECT player_key, choice, mask, points, streak, bonus FROM quiz.game_answers WHERE game_pin = $1 AND question_index = $2',
    [pin, game.question_index],
  );
  // Serien nach der vorherigen Frage (zeigt während einer Frage, welche Serie man gerade hat)
  const previous = game.question_index > 0
    ? await db.query(
      'SELECT player_key, streak FROM quiz.game_answers WHERE game_pin = $1 AND question_index = $2',
      [pin, game.question_index - 1],
    )
    : [];
  // Erfolge, die in diesem Spiel erreicht wurden (erst nach Spielende vorhanden)
  const achievements = game.state === 'finished'
    ? await db.query(`
        SELECT a.user_id, a.achievement_key, u.username
        FROM quiz.user_achievements a JOIN quiz.users u ON u.id = a.user_id
        WHERE a.game_pin = $1 ORDER BY a.earned_at, a.achievement_key
      `, [pin])
    : [];
  // Sekunden seit dem letzten Zustandswechsel (für die Anzeige „weiter in …“)
  const since = await db.one('SELECT EXTRACT(EPOCH FROM (now() - state_since)) AS s FROM quiz.games WHERE pin = $1', [pin]);
  game.since_s = Number(since.s);
  const poll = game.state === 'finished' && isPoll(game) ? await pollResults(db.pool, game) : null;
  return { game, players, answers, previous, achievements, poll };
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
    teamCount: game.team_count,
    kind: game.quiz.kind || 'quiz',
    auto: game.auto,
    serverNow: Date.now(),
  };
  // Zeitpunkt des nächsten automatischen Schritts (Millisekunden, Serveruhr)
  if (game.auto && AUTO_DELAY[game.state]) view.autoAt = Date.now() + Math.max(0, autoDelay(game) - game.since_s) * 1000;
  if (game.state === 'question' || game.state === 'reveal') {
    const q = currentQuestion(game);
    view.question = { text: q.text, answers: q.answers, timeLimit: q.timeLimit, multi: Boolean(q.multi) };
    view.endsAt = game.ends_at.getTime();
    if (game.state === 'reveal' && !isPoll(game)) {
      view.question.correct = q.correct;
      view.question.correctSet = indexes(correctMask(q), q.answers.length);
    }
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
    team: p.team,
  }));
  view.answeredCount = data.answers.length;
  if (data.game.team_count > 0 && data.game.state !== 'lobby') {
    view.teams = standings(rankPlayers(data), data.game.team_count).map((t) => ({
      index: t.index,
      name: t.name,
      emoji: t.emoji,
      color: t.color,
      size: t.size,
      members: t.members.map((m) => ({ name: m.name, guest: !m.user_id, score: m.score })),
      score: t.score,
      prevScore: t.prevScore,
      gained: t.gained,
      rank: t.rank,
      prevRank: t.prevRank,
      ghost: t.ghost,
      bonus: t.bonus,
    }));
  }
  if (data.poll) view.poll = data.poll;
  if (data.game.state === 'finished' && !isPoll(data.game)) {
    const byUser = new Map();
    for (const a of data.achievements) {
      if (!byUser.has(a.username)) byUser.set(a.username, []);
      byUser.get(a.username).push(publicInfo(a.achievement_key));
    }
    view.achievements = [...byUser].map(([name, items]) => ({ name, items }));
  }
  if (data.game.state === 'reveal') {
    view.distribution = view.question.answers.map(() => 0);
    for (const a of data.answers) for (const i of indexes(answerMask(a), view.distribution.length)) view.distribution[i]++;
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
    view.myAnswers = mine ? indexes(answerMask(mine), view.question.answers.length) : [];
    if (isPoll(data.game) && data.game.state === 'reveal') {   // Umfrage: Verteilung auch auf dem Handy zeigen
      view.distribution = view.question.answers.map(() => 0);
      for (const a of data.answers) for (const i of indexes(answerMask(a), view.distribution.length)) view.distribution[i]++;
      view.respondents = data.answers.length;
    }
    if (data.game.state === 'reveal') view.lastPoints = mine ? mine.points : 0;
  }
  // Serie: vor der Antwort die laufende Serie, nach der Auflösung die Serie samt Bonus dieser Frage
  if (data.game.state === 'question') {
    const prev = data.previous.find((a) => a.player_key === key);
    view.streak = prev ? prev.streak : 0;
    view.nextBonus = streakBonus(view.streak + 1);
  } else if (data.game.state === 'reveal' || data.game.state === 'scoreboard') {
    view.streak = mine ? mine.streak : 0;
    view.lastBonus = mine ? mine.bonus : 0;
  }
  if (data.game.state === 'scoreboard') view.lastPoints = player.gained;
  if (data.game.team_count > 0 && player.team !== null) {
    const teams = standings(players, data.game.team_count);
    const mineTeam = teams.find((t) => t.index === player.team);
    view.team = { index: mineTeam.index, name: mineTeam.name, emoji: mineTeam.emoji, color: mineTeam.color, ghost: mineTeam.ghost };
    view.teammates = mineTeam.members.filter((m) => m.key !== key).map((m) => m.name);
    view.teamStanding = { rank: mineTeam.rank, prevRank: mineTeam.prevRank, score: mineTeam.score, teams: teams.length };
  }
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

// Neues Spiel aus einem eigenen oder geteilten Quiz starten
router.post('/', requireAuth, async (req, res) => {
  const quiz = await loadQuiz(req.body.quizId);
  if (!quiz || !(await canEdit(quiz, req.user.id))) return res.status(404).json({ error: 'Quiz nicht gefunden' });
  if (!quiz.questions.length) return res.status(400).json({ error: 'Das Quiz hat noch keine Fragen' });

  // Alte Spiele aufräumen (Ergebnisse bleiben in game_results erhalten)
  await db.query("DELETE FROM quiz.games WHERE created_at < now() - interval '1 day'");

  const snapshot = { title: quiz.title, subjectId: quiz.subject_id, kind: quiz.kind || 'quiz', questions: quiz.questions };
  for (let attempt = 0; attempt < 10; attempt++) {
    const rows = await db.query(`
      INSERT INTO quiz.games (pin, host_user_id, quiz_id, quiz, team_count) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (pin) DO NOTHING RETURNING pin
    `, [generatePin(), req.user.id, quiz.id, JSON.stringify(snapshot), quiz.kind !== 'poll' && quiz.mode === 'team' ? TEAM_COUNT : 0]);
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

// Die vier Reaktionen, die Teilnehmer in der Lobby schicken können
const REACTIONS = ['👋', '🔥', '😂', '🎉'];

router.get('/:pin/host', requireAuth, requireHost, async (req, res) => {
  const data = await loadGame(req.params.pin);
  const view = hostView(data);
  // Fach des Quiz (für die Infoleiste in der Lobby)
  const sid = data.game.quiz.subjectId;
  const subject = sid ? await db.one('SELECT name, icon FROM quiz.subjects WHERE id = $1', [sid]) : null;
  view.subject = subject ? { name: subject.name, icon: subject.icon } : null;
  // Neue Reaktionen seit dem letzten Abruf (after = zuletzt gesehene ID); ohne after nur der aktuelle Stand
  if (data.game.state === 'lobby') {
    const after = /^\d+$/.test(String(req.query.after)) ? req.query.after : null;
    const rows = after === null ? [] : await db.query(
      'SELECT id, name, emoji FROM quiz.game_reactions WHERE game_pin = $1 AND id > $2 ORDER BY id LIMIT 30', [req.params.pin, after]);
    const { max } = await db.one('SELECT COALESCE(MAX(id), 0)::text AS max FROM quiz.game_reactions WHERE game_pin = $1', [req.params.pin]);
    view.reactions = rows.map((r) => ({ id: Number(r.id), name: r.name, emoji: r.emoji }));
    view.reactionCursor = Number(max);
  }
  res.json(view);
});

// Reaktion eines Teilnehmers in der Lobby (Gäste und Angemeldete)
router.post('/:pin/react', async (req, res) => {
  const key = playerKey(req);
  const emoji = String(req.body.emoji || '');
  if (!key || !REACTIONS.includes(emoji)) return res.status(400).json({ error: 'Ungültige Reaktion' });
  const row = await db.one(`
    SELECT p.name, g.state, (SELECT MAX(created_at) FROM quiz.game_reactions r WHERE r.game_pin = g.pin AND r.player_key = p.key) AS last
    FROM quiz.games g JOIN quiz.game_players p ON p.game_pin = g.pin AND p.key = $2 WHERE g.pin = $1`, [req.params.pin, key]);
  if (!row) return res.status(404).json({ error: 'Du bist diesem Spiel nicht beigetreten' });
  if (row.state !== 'lobby') return res.status(409).json({ error: 'Reaktionen gibt es nur in der Warteschlange' });
  // Höchstens eine Reaktion alle 0,6 Sekunden pro Spieler (gegen Dauerfeuer)
  if (row.last && Date.now() - new Date(row.last).getTime() < 600) return res.status(429).json({ error: 'Nicht so schnell' });
  await db.query('INSERT INTO quiz.game_reactions (game_pin, player_key, name, emoji) VALUES ($1, $2, $3, $4)', [req.params.pin, key, row.name, emoji]);
  await db.query("DELETE FROM quiz.game_reactions WHERE game_pin = $1 AND created_at < now() - interval '10 minutes'", [req.params.pin]);
  await db.query('SELECT quiz.notify($1)', [req.params.pin]).catch(() => {});
  res.json({ ok: true });
});

router.post('/:pin/next', requireAuth, requireHost, async (req, res) => {
  const result = await updateGame(req.params.pin, (client, game) => advanceState(client, game));
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(hostView(await loadGame(req.params.pin)));
});

// Automatik an/aus (der Host kann jederzeit selbst weiterklicken)
router.post('/:pin/auto', requireAuth, requireHost, async (req, res) => {
  const result = await updateGame(req.params.pin, async (client, game) => {
    await client.query('UPDATE quiz.games SET auto = $2 WHERE pin = $1', [game.pin, Boolean(req.body.auto)]);
    return { changed: true };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
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
  // Einzelwahl: choice (Zahl); Mehrfachauswahl: choices (Liste von Zahlen)
  const picked = Array.isArray(req.body.choices) ? req.body.choices : [req.body.choice];
  await updateGame(req.params.pin, async (client, game) => {
    if (game.state !== 'question') return {};
    const q = currentQuestion(game);
    const unique = [...new Set(picked)];
    if (!unique.length || unique.some((c) => !Number.isInteger(c) || c < 0 || c >= q.answers.length)) return {};
    if (!q.multi && unique.length !== 1) return {};   // bei Einzelwahl genau eine Antwort
    const mask = unique.reduce((m, c) => m | bit(c), 0);
    const { rowCount } = await client.query(`
      INSERT INTO quiz.game_answers (game_pin, question_index, player_key, choice, mask)
      SELECT $1, $2, $3, $4, $5 WHERE EXISTS (
        SELECT 1 FROM quiz.game_players WHERE game_pin = $1 AND key = $3
      ) ON CONFLICT DO NOTHING
    `, [game.pin, game.question_index, key, Math.min(...unique), mask]);
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
