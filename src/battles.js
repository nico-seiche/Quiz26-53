const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { areFriends, findUser } = require('./friends');
// Dieselbe Lückenlogik wie im Lernen-Modus (Füllwörter, Tippfehler-Toleranz)
const Cloze = require('../public/js/cloze.js');

// Spielregeln eines Battles
const ROUND_SECONDS = Number(process.env.BATTLE_ROUND_SECONDS) || 45;
const REVEAL_SECONDS = Number(process.env.BATTLE_REVEAL_SECONDS) || 7;
const ROUNDS = 5;                 // Runden pro Battle (weniger, wenn das Set kürzer ist)
const MIN_ROUNDS = 3;
const MIN_BLANK_POOL = 4;         // eine Karte braucht mindestens so viele Inhaltswörter
const BLANKS_MIN = 3;
const BLANKS_MAX = 8;
const POINTS_PER_BLANK = 100;
const SPEED_BONUS = 100;          // Zusatz, wenn alle Lücken stimmen: je schneller, desto mehr
const INVITE_HOURS = 24;
const GRACE_MS = 1500;            // Netzlaufzeit beim Ablauf der Runde

const router = express.Router();
router.use(requireAuth);

const notify = (id) => db.query('SELECT quiz.notify($1)', [`b${id}`]).catch(() => {});

// Runde aus einer Karte bauen: Anzeige ohne Lösung + die gesuchten Wörter. null, wenn die Karte zu kurz ist.
function buildRound(card) {
  const tokens = Cloze.tokenize(card.definition);
  const pool = tokens.map((t, i) => (t.word && Cloze.isContent(t.text) ? i : -1)).filter((i) => i >= 0);
  if (pool.length < MIN_BLANK_POOL) return null;
  const target = Math.max(BLANKS_MIN, Math.min(BLANKS_MAX, Math.round(pool.length * 0.5)));
  const blanks = [...Cloze.pickBlanks(tokens, Math.min(1, target / pool.length))].sort((a, b) => a - b);
  const blankSet = new Set(blanks);
  return {
    term: card.term,
    tokens: tokens.map((t, i) => (blankSet.has(i) ? { blank: true, len: t.text.length } : { text: t.text })),
    expected: blanks.map((i) => tokens[i].text),
  };
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Zeitgesteuerte Übergänge (Runde zu Ende → Auflösung → nächste Runde → Ende). Läuft bei jedem Zugriff unter Zeilensperre.
async function advance(client, id) {
  const { rows: [b] } = await client.query(`
    SELECT *, EXTRACT(EPOCH FROM (now() - phase_started_at)) AS elapsed FROM quiz.battles WHERE id = $1 FOR UPDATE`, [id]);
  if (!b || b.status !== 'active') return b;
  const elapsed = Number(b.elapsed);
  if (b.phase === 'question') {
    const { rows: [{ n }] } = await client.query('SELECT COUNT(*)::int AS n FROM quiz.battle_answers WHERE battle_id = $1 AND idx = $2', [id, b.round_index]);
    if (n >= 2 || elapsed * 1000 >= ROUND_SECONDS * 1000 + GRACE_MS) {
      await client.query("UPDATE quiz.battles SET phase = 'reveal', phase_started_at = now() WHERE id = $1", [id]);
      b.phase = 'reveal';
    }
  } else if (elapsed >= REVEAL_SECONDS) {
    if (b.round_index + 1 >= b.rounds) {
      const { rows: [s] } = await client.query(`
        SELECT COALESCE(SUM(points) FILTER (WHERE user_id = $2), 0)::int AS c, COALESCE(SUM(points) FILTER (WHERE user_id = $3), 0)::int AS o
        FROM quiz.battle_answers WHERE battle_id = $1`, [id, b.challenger_id, b.opponent_id]);
      const winner = s.c === s.o ? null : s.c > s.o ? b.challenger_id : b.opponent_id;
      await client.query(`UPDATE quiz.battles SET status = 'finished', score_challenger = $2, score_opponent = $3, winner_id = $4, finished_at = now() WHERE id = $1`,
        [id, s.c, s.o, winner]);
      b.status = 'finished';
    } else {
      await client.query("UPDATE quiz.battles SET round_index = round_index + 1, phase = 'question', phase_started_at = now() WHERE id = $1", [id]);
      b.round_index += 1; b.phase = 'question';
    }
  }
  return b;
}

// Was ein Spieler sehen darf. Ergebnisse der laufenden Runde erst nach der Auflösung.
async function view(id, userId) {
  const b = await db.one(`
    SELECT b.*, EXTRACT(EPOCH FROM phase_started_at) * 1000 AS started_ms, c.username AS challenger, o.username AS opponent
    FROM quiz.battles b JOIN quiz.users c ON c.id = b.challenger_id JOIN quiz.users o ON o.id = b.opponent_id WHERE b.id = $1`, [id]);
  if (!b) return null;
  const cid = Number(b.challenger_id);
  const oid = Number(b.opponent_id);
  if (userId !== cid && userId !== oid) return null;
  const meId = userId;
  const otherId = userId === cid ? oid : cid;
  const names = { [cid]: b.challenger, [oid]: b.opponent };
  const out = {
    id: Number(b.id), status: b.status, setTitle: b.set_title, setId: b.set_id ? Number(b.set_id) : null, rounds: b.rounds, serverNow: Date.now(),
    me: { username: names[meId], score: 0 }, opponent: { username: names[otherId], score: 0 },
    youAreChallenger: meId === cid, round: b.round_index + 1, phase: b.phase,
    config: { roundSeconds: ROUND_SECONDS, revealSeconds: REVEAL_SECONDS },
  };
  if (b.status === 'invited') {
    out.invitedAt = b.created_at;
    return out;
  }
  if (b.status !== 'active' && b.status !== 'finished') return out;

  const answers = await db.query('SELECT idx, user_id, answers, correct, points FROM quiz.battle_answers WHERE battle_id = $1', [id]);
  const finished = b.status === 'finished';
  // Punkte zählen nur für abgeschlossene Runden
  const counted = (a) => finished || a.idx < b.round_index || (a.idx === b.round_index && b.phase === 'reveal');
  for (const a of answers) if (counted(a)) (Number(a.user_id) === meId ? out.me : out.opponent).score += a.points;

  if (!finished) {
    const round = await db.one('SELECT term, tokens, expected FROM quiz.battle_rounds WHERE battle_id = $1 AND idx = $2', [id, b.round_index]);
    const mine = answers.find((a) => a.idx === b.round_index && Number(a.user_id) === meId);
    const theirs = answers.find((a) => a.idx === b.round_index && Number(a.user_id) === otherId);
    out.endsAt = Number(b.started_ms) + (b.phase === 'question' ? ROUND_SECONDS : REVEAL_SECONDS) * 1000;
    out.question = { term: round.term, tokens: round.tokens };
    out.submitted = Boolean(mine);
    out.opponentSubmitted = Boolean(theirs);
    if (b.phase === 'reveal') {
      const pack = (a) => (a ? { answers: a.answers, correct: a.correct, points: a.points } : { answers: [], correct: 0, points: 0 });
      out.reveal = { expected: round.expected, mine: pack(mine), theirs: pack(theirs) };
    }
  } else {
    out.winner = b.winner_id ? names[Number(b.winner_id)] : null;
    out.result = b.winner_id ? (Number(b.winner_id) === meId ? 'win' : 'loss') : 'draw';
    const rounds = await db.query('SELECT idx, term FROM quiz.battle_rounds WHERE battle_id = $1 ORDER BY idx', [id]);
    out.history = rounds.map((r) => ({
      term: r.term,
      mine: (answers.find((a) => a.idx === r.idx && Number(a.user_id) === meId) || { points: 0 }).points,
      theirs: (answers.find((a) => a.idx === r.idx && Number(a.user_id) === otherId) || { points: 0 }).points,
    }));
  }
  return out;
}

// Wenn jemand das Battle zur Zeit nicht beobachtet, laufen die Zeiten trotzdem weiter: bei jedem Zugriff nachziehen.
async function load(id, userId) {
  const before = await db.tx(async (client) => {
    const b = await advance(client, id);
    return b ? { status: b.status, phase: b.phase, round: b.round_index } : null;
  });
  if (!before) return null;
  return view(id, userId);
}

const isId = (v) => /^\d+$/.test(String(v));

// Übersicht: Einladungen, laufende und letzte Battles
router.get('/', async (req, res) => {
  const rows = await db.query(`
    SELECT b.id, b.status, b.set_title, b.created_at, b.finished_at, b.winner_id, b.score_challenger, b.score_opponent,
           b.challenger_id, c.username AS challenger, o.username AS opponent
    FROM quiz.battles b JOIN quiz.users c ON c.id = b.challenger_id JOIN quiz.users o ON o.id = b.opponent_id
    WHERE (b.challenger_id = $1 OR b.opponent_id = $1)
      AND (b.status = 'active' OR (b.status = 'invited' AND b.created_at > now() - make_interval(hours => $2))
           OR (b.status = 'finished' AND b.finished_at > now() - interval '7 days'))
    ORDER BY COALESCE(b.finished_at, b.created_at) DESC LIMIT 30`, [req.user.id, INVITE_HOURS]);
  const list = rows.map((b) => {
    const iAmChallenger = Number(b.challenger_id) === req.user.id;
    return {
      id: Number(b.id), status: b.status, setTitle: b.set_title, setId: b.set_id ? Number(b.set_id) : null, iAmChallenger,
      opponent: iAmChallenger ? b.opponent : b.challenger,
      myScore: iAmChallenger ? b.score_challenger : b.score_opponent, theirScore: iAmChallenger ? b.score_opponent : b.score_challenger,
      result: b.status !== 'finished' ? null : !b.winner_id ? 'draw' : Number(b.winner_id) === req.user.id ? 'win' : 'loss',
    };
  });
  res.json({
    invites: list.filter((b) => b.status === 'invited' && !b.iAmChallenger),
    waiting: list.filter((b) => b.status === 'invited' && b.iAmChallenger),
    active: list.filter((b) => b.status === 'active'),
    recent: list.filter((b) => b.status === 'finished').slice(0, 8),
  });
});

// Herausfordern: Lernset + Freund (Name oder #ID)
router.post('/', async (req, res) => {
  const user = await findUser(req.body.friend);
  if (!user) return res.status(404).json({ error: 'Spieler nicht gefunden' });
  if (Number(user.id) === req.user.id) return res.status(400).json({ error: 'Du kannst dich nicht selbst herausfordern.' });
  if (!(await areFriends(req.user.id, user.id))) return res.status(403).json({ error: `${user.username} ist noch nicht dein Freund.` });
  if (!isId(req.body.setId)) return res.status(400).json({ error: 'Lernset fehlt' });
  if (req.body.mode !== undefined && req.body.mode !== 'cloze') return res.status(400).json({ error: 'Diesen Spielmodus gibt es noch nicht' });
  const set = await db.one('SELECT id, title FROM quiz.study_sets WHERE id = $1 AND (owner_id = $2 OR is_public OR EXISTS (SELECT 1 FROM quiz.study_set_collaborators c WHERE c.set_id = study_sets.id AND c.user_id = $2))', [req.body.setId, req.user.id]);
  if (!set) return res.status(404).json({ error: 'Lernset nicht gefunden' });
  const cards = await db.query('SELECT term, definition FROM quiz.study_cards WHERE set_id = $1', [set.id]);
  if (cards.filter((c) => buildRound(c)).length < MIN_ROUNDS) {
    return res.status(400).json({ error: `Für ein Battle braucht das Lernset mindestens ${MIN_ROUNDS} Karten mit längeren Definitionen (je mind. ${MIN_BLANK_POOL} wichtige Wörter).` });
  }
  const open = await db.one(`
    SELECT 1 FROM quiz.battles WHERE status IN ('invited', 'active')
      AND LEAST(challenger_id, opponent_id) = LEAST($1::bigint, $2::bigint) AND GREATEST(challenger_id, opponent_id) = GREATEST($1::bigint, $2::bigint)
      AND (status = 'active' OR created_at > now() - make_interval(hours => $3))`, [req.user.id, user.id, INVITE_HOURS]);
  if (open) return res.status(409).json({ error: `Mit ${user.username} läuft schon ein Battle oder eine Einladung.` });
  const row = await db.one(`INSERT INTO quiz.battles (set_id, set_title, challenger_id, opponent_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [set.id, set.title, req.user.id, user.id]);
  res.json({ id: Number(row.id) });
});

router.get('/:id', async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Battle nicht gefunden' });
  const state = await load(req.params.id, req.user.id);
  if (!state) return res.status(404).json({ error: 'Battle nicht gefunden' });
  res.json(state);
});

// Einladung annehmen: Runden werden jetzt aus dem Set gezogen und das Battle beginnt sofort
router.post('/:id/accept', async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Battle nicht gefunden' });
  const result = await db.tx(async (client) => {
    const { rows: [b] } = await client.query('SELECT * FROM quiz.battles WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!b || Number(b.opponent_id) !== req.user.id) return { code: 404, error: 'Battle nicht gefunden' };
    if (b.status === 'active') return { ok: true };
    if (b.status !== 'invited') return { code: 409, error: 'Diese Einladung ist nicht mehr gültig.' };
    if (Date.now() - new Date(b.created_at).getTime() > INVITE_HOURS * 3600e3) return { code: 409, error: 'Diese Einladung ist abgelaufen.' };
    const { rows: cards } = await client.query('SELECT term, definition FROM quiz.study_cards WHERE set_id = $1', [b.set_id]);
    const rounds = shuffle(cards).map(buildRound).filter(Boolean).slice(0, ROUNDS);
    if (rounds.length < MIN_ROUNDS) return { code: 409, error: 'Das Lernset ist inzwischen zu kurz für ein Battle.' };
    for (const [i, r] of rounds.entries()) {
      await client.query('INSERT INTO quiz.battle_rounds (battle_id, idx, term, tokens, expected) VALUES ($1, $2, $3, $4, $5)',
        [b.id, i, r.term, JSON.stringify(r.tokens), JSON.stringify(r.expected)]);
    }
    await client.query("UPDATE quiz.battles SET status = 'active', rounds = $2, round_index = 0, phase = 'question', phase_started_at = now() WHERE id = $1", [b.id, rounds.length]);
    return { ok: true };
  });
  if (result.error) return res.status(result.code).json({ error: result.error });
  await notify(req.params.id);
  res.json(await load(req.params.id, req.user.id));
});

// Ablehnen (Eingeladener) bzw. zurückziehen (Herausforderer)
router.post('/:id/decline', async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Battle nicht gefunden' });
  const rows = await db.query(`
    UPDATE quiz.battles SET status = CASE WHEN opponent_id = $2 THEN 'declined' ELSE 'cancelled' END
    WHERE id = $1 AND status = 'invited' AND (opponent_id = $2 OR challenger_id = $2) RETURNING id`, [req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Battle nicht gefunden' });
  await notify(req.params.id);
  res.json({ ok: true });
});

// Aufgeben: der andere gewinnt
router.post('/:id/forfeit', async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Battle nicht gefunden' });
  const done = await db.tx(async (client) => {
    const b = await advance(client, req.params.id);
    if (!b || b.status !== 'active' || (Number(b.challenger_id) !== req.user.id && Number(b.opponent_id) !== req.user.id)) return false;
    const winner = Number(b.challenger_id) === req.user.id ? b.opponent_id : b.challenger_id;
    const { rows: [s] } = await client.query(`
      SELECT COALESCE(SUM(points) FILTER (WHERE user_id = $2), 0)::int AS c, COALESCE(SUM(points) FILTER (WHERE user_id = $3), 0)::int AS o
      FROM quiz.battle_answers WHERE battle_id = $1`, [b.id, b.challenger_id, b.opponent_id]);
    await client.query("UPDATE quiz.battles SET status = 'finished', winner_id = $2, score_challenger = $3, score_opponent = $4, finished_at = now() WHERE id = $1",
      [b.id, winner, s.c, s.o]);
    return true;
  });
  if (!done) return res.status(404).json({ error: 'Battle nicht gefunden' });
  await notify(req.params.id);
  res.json(await load(req.params.id, req.user.id));
});

// Antwort der laufenden Runde abgeben (einmal pro Runde)
router.post('/:id/answer', async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Battle nicht gefunden' });
  const given = Array.isArray(req.body.answers) ? req.body.answers.map((a) => String(a || '').slice(0, 60)) : null;
  if (!given) return res.status(400).json({ error: 'Antworten fehlen' });
  const outcome = await db.tx(async (client) => {
    const b = await advance(client, req.params.id);
    if (!b || (Number(b.challenger_id) !== req.user.id && Number(b.opponent_id) !== req.user.id)) return { code: 404, error: 'Battle nicht gefunden' };
    if (b.status !== 'active' || b.phase !== 'question') return { code: 409, error: 'Die Runde ist schon vorbei.' };
    const { rows: [round] } = await client.query('SELECT expected FROM quiz.battle_rounds WHERE battle_id = $1 AND idx = $2', [b.id, b.round_index]);
    const expected = round.expected;
    const { rows: [t] } = await client.query('SELECT EXTRACT(EPOCH FROM (now() - phase_started_at)) AS elapsed FROM quiz.battles WHERE id = $1', [b.id]);
    const answers = expected.map((_, i) => given[i] || '');
    const correct = answers.filter((a, i) => Cloze.matches(a, expected[i])).length;
    const remaining = Math.max(0, 1 - Number(t.elapsed) / ROUND_SECONDS);
    const points = correct * POINTS_PER_BLANK + (correct === expected.length ? Math.round(SPEED_BONUS * remaining) : 0);
    const ins = await client.query(`
      INSERT INTO quiz.battle_answers (battle_id, idx, user_id, answers, correct, points) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING 1`,
    [b.id, b.round_index, req.user.id, JSON.stringify(answers), correct, points]);
    if (!ins.rowCount) return { code: 409, error: 'Du hast diese Runde schon abgegeben.' };
    await advance(client, req.params.id);   // sind beide fertig, geht es sofort in die Auflösung
    return { ok: true };
  });
  if (outcome.error) return res.status(outcome.code).json({ error: outcome.error });
  await notify(req.params.id);
  res.json(await load(req.params.id, req.user.id));
});

// Zahl offener Einladungen (für den Hinweispunkt in der Navigation)
async function inviteCount(userId) {
  const row = await db.one(`SELECT COUNT(*)::int AS n FROM quiz.battles WHERE opponent_id = $1 AND status = 'invited' AND created_at > now() - make_interval(hours => $2)`,
    [userId, INVITE_HOURS]);
  return row.n;
}

module.exports = { router, inviteCount };
