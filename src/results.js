const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { MIN_PLAYERS_FOR_SCORING, levelInfo } = require('./config');

const router = express.Router();

// Anzahl aufeinanderfolgender Spieltage; die Serie lebt weiter, wenn man gestern gespielt hat und heute noch nicht
function dayStreak(days) {
  const set = new Set(days);
  const berlin = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });  // YYYY-MM-DD
  const cursor = new Date();
  if (!set.has(berlin(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (set.has(berlin(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  return streak;
}

// Statistik und gespeicherte Ergebnisse des eingeloggten Nutzers.
// In die Statistik fließen nur Spiele mit genug Teilnehmern ein; die Ergebnisliste zeigt alle Spiele.
router.get('/', requireAuth, async (req, res) => {
  // Alle Fächer, auch solche ohne Punkte
  const subjects = await db.query(`
    SELECT s.id, s.name, s.icon, COALESCE(SUM(r.score), 0)::int AS points, COUNT(r.id)::int AS games
    FROM quiz.subjects s
    LEFT JOIN quiz.game_results r
      ON r.subject_id = s.id AND r.user_id = $1 AND r.player_count >= $2
    GROUP BY s.id ORDER BY s.position, s.id
  `, [req.user.id, MIN_PLAYERS_FOR_SCORING]);

  // Ergebnisse aus Spielen ohne Fach (z. B. vor Einführung der Fächer)
  const other = await db.one(`
    SELECT COALESCE(SUM(score), 0)::int AS points, COUNT(*)::int AS games
    FROM quiz.game_results WHERE user_id = $1 AND subject_id IS NULL AND player_count >= $2
  `, [req.user.id, MIN_PLAYERS_FOR_SCORING]);
  if (other.games) subjects.push({ id: null, name: 'Ohne Fach', icon: '📘', ...other });

  const results = await db.query(`
    SELECT r.quiz_title, s.name AS subject, s.icon AS subject_icon, r.score, r.rank, r.player_count, r.played_at,
           r.player_count >= $2 AS counted
    FROM quiz.game_results r LEFT JOIN quiz.subjects s ON s.id = r.subject_id
    WHERE r.user_id = $1 ORDER BY r.played_at DESC, r.id DESC LIMIT 50
  `, [req.user.id, MIN_PLAYERS_FOR_SCORING]);

  // Punkte von heute und Serie aufeinanderfolgender Spieltage (Tage nach deutscher Zeit, nur gewertete Spiele)
  const { today } = await db.one(`
    SELECT COALESCE(SUM(score), 0)::int AS today FROM quiz.game_results
    WHERE user_id = $1 AND player_count >= $2
      AND (played_at AT TIME ZONE 'Europe/Berlin')::date = (now() AT TIME ZONE 'Europe/Berlin')::date
  `, [req.user.id, MIN_PLAYERS_FOR_SCORING]);
  const dayRows = await db.query(`
    SELECT DISTINCT to_char(played_at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS day
    FROM quiz.game_results WHERE user_id = $1 AND player_count >= $2 ORDER BY day DESC LIMIT 400
  `, [req.user.id, MIN_PLAYERS_FOR_SCORING]);

  const total = subjects.reduce((sum, s) => sum + s.points, 0);
  res.json({
    total,
    level: levelInfo(total),
    today,
    dayStreak: dayStreak(dayRows.map((r) => r.day)),
    games: subjects.reduce((sum, s) => sum + s.games, 0),
    minPlayers: MIN_PLAYERS_FOR_SCORING,
    subjects,
    results,
  });
});

module.exports = { router, dayStreak };
