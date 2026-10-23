const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();

// Gespeicherte Ergebnisse des eingeloggten Nutzers
router.get('/', requireAuth, async (req, res) => {
  const results = await db.query(`
    SELECT quiz_title, score, rank, player_count, played_at
    FROM quiz.game_results WHERE user_id = $1 ORDER BY played_at DESC, id DESC LIMIT 50
  `, [req.user.id]);
  const { total } = await db.one(
    'SELECT COALESCE(SUM(score), 0)::int AS total FROM quiz.game_results WHERE user_id = $1',
    [req.user.id],
  );
  res.json({ total, results });
});

module.exports = { router };
