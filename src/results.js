const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();

// Gespeicherte Ergebnisse des eingeloggten Nutzers
router.get('/', requireAuth, (req, res) => {
  const results = db.prepare(`
    SELECT quiz_title, score, rank, player_count, played_at
    FROM game_results WHERE user_id = ? ORDER BY played_at DESC, id DESC LIMIT 50
  `).all(req.user.id);
  const total = db.prepare('SELECT COALESCE(SUM(score), 0) AS total FROM game_results WHERE user_id = ?')
    .get(req.user.id).total;
  res.json({ total, results });
});

module.exports = { router };
