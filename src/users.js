const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { MIN_PLAYERS_FOR_SCORING, SINCE_RESET, levelInfo } = require('./config');
const { dayStreak } = require('./results');
const { ACHIEVEMENTS, collectorTitle } = require('./achievements');

const router = express.Router();
router.use(requireAuth);

// Öffentliches Profil eines Spielers: Level, Punkte, Platz, Fächer, Erfolge, Battles, zuletzt gespielt.
// Lernpunkte (gesamt, 7 Tage, nach Lernart) sind sichtbar, der Lernfortschritt je Karte nicht.
const TODAY = "(now() AT TIME ZONE 'Europe/Berlin')::date";
const DAY = "(created_at AT TIME ZONE 'Europe/Berlin')::date";
router.get('/:username', async (req, res) => {
  const user = await db.one('SELECT id, username, friend_code, created_at FROM quiz.users WHERE lower(username) = lower($1)', [req.params.username]);
  if (!user) return res.status(404).json({ error: 'Spieler nicht gefunden' });
  const id = Number(user.id);
  const me = req.user.id;

  const [subjects, other, rankRow, userCount, days, earnedRows, recent, battles, relation, learn, learnModes] = await Promise.all([
    db.query(`
      SELECT s.name, s.icon, COALESCE(SUM(r.score), 0)::int AS points, COUNT(r.id)::int AS games
      FROM quiz.subjects s LEFT JOIN quiz.game_results r ON r.subject_id = s.id AND r.user_id = $1 AND r.player_count >= $2
      GROUP BY s.id ORDER BY s.position, s.id`, [id, MIN_PLAYERS_FOR_SCORING]),
    db.one('SELECT COALESCE(SUM(score), 0)::int AS points, COUNT(*)::int AS games FROM quiz.game_results WHERE user_id = $1 AND subject_id IS NULL AND player_count >= $2',
      [id, MIN_PLAYERS_FOR_SCORING]),
    db.one(`
      WITH ranked AS (
        SELECT u.id, RANK() OVER (ORDER BY COALESCE(SUM(r.score), 0) DESC)::int AS rank
        FROM quiz.users u LEFT JOIN quiz.game_results r ON r.user_id = u.id AND r.player_count >= $1 AND ${SINCE_RESET} GROUP BY u.id
      ) SELECT rank FROM ranked WHERE id = $2`, [MIN_PLAYERS_FOR_SCORING, id]),
    db.one('SELECT COUNT(*)::int AS n FROM quiz.users'),
    db.query(`SELECT DISTINCT to_char(played_at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS day
              FROM quiz.game_results WHERE user_id = $1 AND player_count >= $2 ORDER BY day DESC LIMIT 400`, [id, MIN_PLAYERS_FOR_SCORING]),
    db.query('SELECT achievement_key, earned_at FROM quiz.user_achievements WHERE user_id = $1 ORDER BY earned_at', [id]),
    db.query(`
      SELECT r.quiz_title, s.name AS subject, s.icon AS subject_icon, r.score, r.rank, r.player_count, r.played_at
      FROM quiz.game_results r LEFT JOIN quiz.subjects s ON s.id = r.subject_id
      WHERE r.user_id = $1 AND r.player_count >= $2 ORDER BY r.played_at DESC, r.id DESC LIMIT 5`, [id, MIN_PLAYERS_FOR_SCORING]),
    db.query(`
      SELECT winner_id, challenger_id, opponent_id FROM quiz.battles
      WHERE status = 'finished' AND (challenger_id = $1 OR opponent_id = $1)`, [id]),
    db.one(`
      SELECT status, (requester_id = $1) AS outgoing FROM quiz.friendships
      WHERE LEAST(requester_id, addressee_id) = LEAST($1::bigint, $2::bigint) AND GREATEST(requester_id, addressee_id) = GREATEST($1::bigint, $2::bigint)`, [me, id]),
    db.one(`SELECT COALESCE(SUM(points), 0)::int AS total, COALESCE(SUM(points) FILTER (WHERE ${DAY} > ${TODAY} - 7), 0)::int AS week
            FROM quiz.learn_events WHERE user_id = $1`, [id]),
    db.query('SELECT mode, SUM(points)::int AS points, COUNT(*)::int AS reviews FROM quiz.learn_events WHERE user_id = $1 GROUP BY mode ORDER BY SUM(points) DESC', [id]),
  ]);

  if (other.games) subjects.push({ name: 'Ohne Fach', icon: '📘', ...other });
  const points = subjects.reduce((sum, s) => sum + s.points, 0);
  const earned = new Set(earnedRows.map((r) => r.achievement_key));
  const record = { wins: 0, losses: 0, draws: 0 };
  const vsMe = { wins: 0, losses: 0, draws: 0 };
  for (const b of battles) {
    const key = !b.winner_id ? 'draws' : Number(b.winner_id) === id ? 'wins' : 'losses';
    record[key]++;
    const against = Number(b.challenger_id) === id ? Number(b.opponent_id) : Number(b.challenger_id);
    if (against === me) vsMe[key]++;
  }

  res.json({
    username: user.username, code: `#${user.friend_code}`, memberSince: user.created_at, isMe: id === me,
    relation: id === me ? 'self' : !relation ? 'none' : relation.status === 'accepted' ? 'friend' : relation.outgoing ? 'requested' : 'incoming',
    points, xp: points + learn.total, ...levelInfo(points + learn.total), rank: rankRow.rank, userCount: userCount.n,
    games: subjects.reduce((sum, s) => sum + s.games, 0), dayStreak: dayStreak(days.map((d) => d.day)),
    subjects, minPlayers: MIN_PLAYERS_FOR_SCORING,
    achievements: {
      earned: earned.size, total: ACHIEVEMENTS.length, title: collectorTitle(earned.size),
      items: ACHIEVEMENTS.map((a) => ({ icon: a.icon, name: a.name, description: a.description, earned: earned.has(a.key) })),
    },
    battles: record, vsMe, recent,
    learn: { total: learn.total, week: learn.week, byMode: learnModes },
  });
});

module.exports = { router };
