const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { MIN_PLAYERS_FOR_SCORING, SINCE_RESET } = require('./config');

const router = express.Router();
const LIMIT = 200;

// Bestenliste aller registrierten Nutzer: gesamt (subject=all), für ein Fach (subject=<id>) oder für mehrere Fächer zusammen
// (subject=<id>,<id>,… – die Punkte der gewählten Fächer werden addiert).
// Es zählen nur Spiele mit genug Teilnehmern, genau wie in der persönlichen Statistik.
router.get('/', requireAuth, async (req, res) => {
  const subjects = await db.query('SELECT id, name FROM quiz.subjects ORDER BY position, id');
  const wanted = req.query.subject === undefined ? 'all' : String(req.query.subject);
  let subjectIds = null;       // null = alle Fächer
  if (wanted !== 'all') {
    subjectIds = [...new Set(wanted.split(',').map((x) => Number(x)))];
    if (!subjectIds.length || subjectIds.length > 20 || subjectIds.some((id) => !subjects.some((s) => s.id === id))) return res.status(400).json({ error: 'Unbekanntes Fach' });
  }
  // Fächer, die zu den Rechtsfächern der Learnworld gehören (für die Schnellauswahl)
  const lawIds = (await db.query('SELECT DISTINCT subject_id FROM quiz.lw_courses WHERE subject_id IS NOT NULL')).map((r) => r.subject_id);

  // Gleiche Punkte = gleicher Platz; wer noch nichts gespielt hat, steht mit 0 Punkten am Ende
  const ranked = `
    WITH ranked AS (
      SELECT u.id, u.username,
             COALESCE(SUM(r.score), 0)::int AS points,
             COUNT(r.id)::int AS games,
             RANK() OVER (ORDER BY COALESCE(SUM(r.score), 0) DESC)::int AS rank
      FROM quiz.users u
      LEFT JOIN quiz.game_results r
        ON r.user_id = u.id AND r.player_count >= $1 AND ($2::int[] IS NULL OR r.subject_id = ANY($2)) AND ${SINCE_RESET}
      GROUP BY u.id
    )`;
  const params = [MIN_PLAYERS_FOR_SCORING, subjectIds];
  const entries = await db.query(
    `${ranked} SELECT id, username, points, games, rank FROM ranked ORDER BY points DESC, lower(username) LIMIT ${LIMIT}`,
    params,
  );
  const [{ count }] = await db.query('SELECT COUNT(*)::int AS count FROM quiz.users');
  const me = await db.one(`${ranked} SELECT points, games, rank FROM ranked WHERE id = $3`, [...params, req.user.id]);

  // Platz vor meinem letzten gewerteten Spiel: so erkennt man Aufsteiger
  const last = await db.one(`
    SELECT MAX(r.played_at) AS at FROM quiz.game_results r
    WHERE r.user_id = $1 AND r.player_count >= $2 AND ($3::int[] IS NULL OR r.subject_id = ANY($3)) AND ${SINCE_RESET}
  `, [req.user.id, MIN_PLAYERS_FOR_SCORING, subjectIds]);
  me.prevRank = null;
  if (last.at) {
    const before = await db.one(`
      WITH ranked AS (
        SELECT u.id, RANK() OVER (ORDER BY COALESCE(SUM(r.score), 0) DESC)::int AS rank
        FROM quiz.users u
        LEFT JOIN quiz.game_results r
          ON r.user_id = u.id AND r.player_count >= $1 AND ($2::int[] IS NULL OR r.subject_id = ANY($2)) AND r.played_at < $4 AND ${SINCE_RESET}
        GROUP BY u.id
      ) SELECT rank FROM ranked WHERE id = $3
    `, [MIN_PLAYERS_FOR_SCORING, subjectIds, req.user.id, last.at]);
    me.prevRank = before.rank;
  }

  res.json({
    minPlayers: MIN_PLAYERS_FOR_SCORING,
    subjects,
    selected: subjectIds === null ? 'all' : subjectIds,
    groups: lawIds.length > 1 ? [{ name: 'Rechtsfächer', ids: lawIds }] : [],
    userCount: count,
    me,
    entries: entries.map((e) => ({
      rank: e.rank, username: e.username, points: e.points, games: e.games, isMe: String(e.id) === String(req.user.id),
    })),
  });
});

module.exports = { router };
