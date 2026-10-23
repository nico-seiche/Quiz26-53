const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { MIN_PLAYERS_FOR_SCORING } = require('./config');

const router = express.Router();
const LIMIT = 200;

// Bestenliste aller registrierten Nutzer: gesamt (subject=all) oder für ein Fach (subject=<id>).
// Es zählen nur Spiele mit genug Teilnehmern, genau wie in der persönlichen Statistik.
router.get('/', requireAuth, async (req, res) => {
  const subjects = await db.query('SELECT id, name FROM quiz.subjects ORDER BY position, id');
  const wanted = req.query.subject === undefined ? 'all' : String(req.query.subject);
  let subjectId = null;
  if (wanted !== 'all') {
    subjectId = Number(wanted);
    if (!subjects.some((s) => s.id === subjectId)) return res.status(400).json({ error: 'Unbekanntes Fach' });
  }

  // Gleiche Punkte = gleicher Platz; wer noch nichts gespielt hat, steht mit 0 Punkten am Ende
  const ranked = `
    WITH ranked AS (
      SELECT u.id, u.username,
             COALESCE(SUM(r.score), 0)::int AS points,
             COUNT(r.id)::int AS games,
             RANK() OVER (ORDER BY COALESCE(SUM(r.score), 0) DESC)::int AS rank
      FROM quiz.users u
      LEFT JOIN quiz.game_results r
        ON r.user_id = u.id AND r.player_count >= $1 AND ($2::int IS NULL OR r.subject_id = $2)
      GROUP BY u.id
    )`;
  const params = [MIN_PLAYERS_FOR_SCORING, subjectId];
  const entries = await db.query(
    `${ranked} SELECT id, username, points, games, rank FROM ranked ORDER BY points DESC, lower(username) LIMIT ${LIMIT}`,
    params,
  );
  const [{ count }] = await db.query('SELECT COUNT(*)::int AS count FROM quiz.users');
  const me = await db.one(`${ranked} SELECT points, games, rank FROM ranked WHERE id = $3`, [...params, req.user.id]);

  // Platz vor meinem letzten gewerteten Spiel: so erkennt man Aufsteiger
  const last = await db.one(`
    SELECT MAX(played_at) AS at FROM quiz.game_results
    WHERE user_id = $1 AND player_count >= $2 AND ($3::int IS NULL OR subject_id = $3)
  `, [req.user.id, MIN_PLAYERS_FOR_SCORING, subjectId]);
  me.prevRank = null;
  if (last.at) {
    const before = await db.one(`
      WITH ranked AS (
        SELECT u.id, RANK() OVER (ORDER BY COALESCE(SUM(r.score), 0) DESC)::int AS rank
        FROM quiz.users u
        LEFT JOIN quiz.game_results r
          ON r.user_id = u.id AND r.player_count >= $1 AND ($2::int IS NULL OR r.subject_id = $2) AND r.played_at < $4
        GROUP BY u.id
      ) SELECT rank FROM ranked WHERE id = $3
    `, [MIN_PLAYERS_FOR_SCORING, subjectId, req.user.id, last.at]);
    me.prevRank = before.rank;
  }

  res.json({
    minPlayers: MIN_PLAYERS_FOR_SCORING,
    subjects,
    selected: subjectId === null ? 'all' : subjectId,
    userCount: count,
    me,
    entries: entries.map((e) => ({
      rank: e.rank, username: e.username, points: e.points, games: e.games, isMe: String(e.id) === String(req.user.id),
    })),
  });
});

module.exports = { router };
