const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { MIN_PLAYERS_FOR_SCORING } = require('./config');

const router = express.Router();

// Statistik und gespeicherte Ergebnisse des eingeloggten Nutzers.
// In die Statistik fließen nur Spiele mit genug Teilnehmern ein; die Ergebnisliste zeigt alle Spiele.
router.get('/', requireAuth, async (req, res) => {
  // Alle Fächer, auch solche ohne Punkte
  const subjects = await db.query(`
    SELECT s.id, s.name, COALESCE(SUM(r.score), 0)::int AS points, COUNT(r.id)::int AS games
    FROM quiz.subjects s
    LEFT JOIN quiz.game_results r
      ON r.subject_id = s.id AND r.user_id = $1 AND r.player_count >= $2
    GROUP BY s.id ORDER BY s.position, s.id
  `, [req.user.id, MIN_PLAYERS_FOR_SCORING]);

  // Ergebnisse aus Quizzen ohne Fach (z. B. vor Einführung der Fächer)
  const other = await db.one(`
    SELECT COALESCE(SUM(score), 0)::int AS points, COUNT(*)::int AS games
    FROM quiz.game_results WHERE user_id = $1 AND subject_id IS NULL AND player_count >= $2
  `, [req.user.id, MIN_PLAYERS_FOR_SCORING]);
  if (other.games) subjects.push({ id: null, name: 'Ohne Fach', ...other });

  const results = await db.query(`
    SELECT r.quiz_title, s.name AS subject, r.score, r.rank, r.player_count, r.played_at,
           r.player_count >= $2 AS counted
    FROM quiz.game_results r LEFT JOIN quiz.subjects s ON s.id = r.subject_id
    WHERE r.user_id = $1 ORDER BY r.played_at DESC, r.id DESC LIMIT 50
  `, [req.user.id, MIN_PLAYERS_FOR_SCORING]);

  res.json({
    total: subjects.reduce((sum, s) => sum + s.points, 0),
    games: subjects.reduce((sum, s) => sum + s.games, 0),
    minPlayers: MIN_PLAYERS_FOR_SCORING,
    subjects,
    results,
  });
});

module.exports = { router };
