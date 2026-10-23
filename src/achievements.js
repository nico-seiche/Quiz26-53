const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { MIN_PLAYERS_FOR_SCORING } = require('./config');
const { buildTeams, rankTeams } = require('./teams');

// Erfolge gibt es nur für eingeloggte Spieler in Spielen, die für die Gesamtwertung zählen.
// progress: Fortschrittsanzeige im Dashboard (stat = Wert aus loadStats, target = Zielwert)
const ACHIEVEMENTS = [
  // Dabeisein
  { key: 'first_game', icon: '🌱', name: 'Neuling', description: 'Spiele dein erstes gewertetes Quiz.' },
  { key: 'regular_5', icon: '📚', name: 'Stammgast', description: 'Spiele 5 gewertete Quiz.', progress: { stat: 'games', target: 5 } },
  { key: 'regular_20', icon: '🎓', name: 'Veteran', description: 'Spiele 20 gewertete Quiz.', progress: { stat: 'games', target: 20 } },
  { key: 'all_subjects', icon: '🧭', name: 'Allrounder', description: 'Spiele in jedem Fach mindestens ein gewertetes Quiz.', progress: { stat: 'subjects', target: 'subjectCount' } },
  { key: 'points_10000', icon: '💎', name: 'Punktesammler', description: 'Sammle insgesamt 10.000 Punkte.', progress: { stat: 'points', target: 10000 } },
  // Siege
  { key: 'podium', icon: '🥉', name: 'Treppchen', description: 'Komm in einem Quiz unter die ersten 3.' },
  { key: 'winner', icon: '🥇', name: 'Siegertyp', description: 'Gewinne ein Quiz.' },
  { key: 'winner_3', icon: '👑', name: 'Seriensieger', description: 'Gewinne 3 Quiz.', progress: { stat: 'wins', target: 3 } },
  // Starke Runden
  { key: 'perfect', icon: '🎯', name: 'Volltreffer', description: 'Beantworte in einem Quiz mit mindestens 5 Fragen alle richtig.' },
  { key: 'streak_5', icon: '🔥', name: 'Heißer Lauf', description: 'Beantworte 5 Fragen in Folge richtig.' },
  { key: 'speedy', icon: '⚡', name: 'Blitzmerker', description: 'Antworte dreimal in einem Quiz richtig und innerhalb der ersten 10 % der Zeit.' },
  { key: 'rocket', icon: '🚀', name: 'Raketenstart', description: 'Steige in einer einzigen Runde um mindestens 3 Plätze auf.' },
  // Spielleitung
  { key: 'team_win', icon: '🤝', name: 'Teamgeist', description: 'Gewinne ein Quiz im Team-Modus mit deinem Team.' },
  { key: 'host', icon: '🎤', name: 'Quizmaster', description: 'Leite ein gewertetes Quiz als Host.' },
];
const BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));

const publicInfo = (key) => {
  const { icon, name, description } = BY_KEY.get(key);
  return { key, icon, name, description };
};

// Zahlen aus allen gewerteten Spielen der Nutzer (Spiele mit genug Teilnehmern)
async function loadStats(run, userIds) {
  const rows = await run(`
    SELECT user_id, COUNT(*)::int AS games,
           COUNT(*) FILTER (WHERE rank = 1 AND score > 0)::int AS wins,
           COALESCE(SUM(score), 0)::int AS points,
           COUNT(DISTINCT subject_id)::int AS subjects
    FROM quiz.game_results
    WHERE user_id = ANY($1::bigint[]) AND player_count >= $2
    GROUP BY user_id
  `, [userIds, MIN_PLAYERS_FOR_SCORING]);
  const stats = new Map(rows.map((r) => [String(r.user_id), r]));
  return (id) => stats.get(String(id)) || { games: 0, wins: 0, points: 0, subjects: 0 };
}

// Rang aller Spieler nach jeder Frage, rekonstruiert aus den gespeicherten Antworten
function rankHistory(players, answersByPlayer, questionCount) {
  const totals = new Map(players.map((p) => [p.key, 0]));
  const history = [];
  for (let q = 0; q < questionCount; q++) {
    for (const p of players) totals.set(p.key, totals.get(p.key) + ((answersByPlayer.get(p.key) || new Map()).get(q)?.points || 0));
    const order = [...players].sort((a, b) => totals.get(b.key) - totals.get(a.key) || a.joined_at - b.joined_at);
    history.push(new Map(order.map((p, i) => [p.key, i + 1])));
  }
  return history;
}

// Erfolge, die sich aus dem Verlauf dieses einen Spiels ergeben
function gameAchievements(game, player, rank, answers, history) {
  const questions = game.quiz.questions;
  const keys = [];
  if (rank <= 3 && player.score > 0) keys.push('podium');

  const correct = questions.map((q, i) => answers.get(i)?.choice === q.correct);
  if (questions.length >= 5 && correct.every(Boolean)) keys.push('perfect');

  let run = 0;
  let best = 0;
  for (const ok of correct) { run = ok ? run + 1 : 0; best = Math.max(best, run); }
  if (best >= 5) keys.push('streak_5');

  // Basispunkte ab 950 (ohne Serien-Bonus) bedeuten: richtig und in den ersten 10 % der Zeit
  const fast = questions.filter((q, i) => correct[i] && answers.get(i).points - answers.get(i).bonus >= 950).length;
  if (fast >= 3) keys.push('speedy');

  for (let q = 1; q < history.length; q++) {
    if (history[q - 1].get(player.key) - history[q].get(player.key) >= 3) { keys.push('rocket'); break; }
  }
  return keys;
}

// Vergibt am Spielende die Erfolge; players ist nach Rang sortiert (inkl. user_id/key/score/joined_at)
async function awardForGame(client, game, players) {
  if (players.length < MIN_PLAYERS_FOR_SCORING) return;
  const run = async (text, params) => (await client.query(text, params)).rows;

  const registered = players.filter((p) => p.user_id);
  const stats = await loadStats(run, registered.map((p) => p.user_id));
  const [{ count: subjectCount }] = await run('SELECT COUNT(*)::int AS count FROM quiz.subjects');

  const answerRows = await run(
    'SELECT player_key, question_index, choice, points, bonus FROM quiz.game_answers WHERE game_pin = $1',
    [game.pin],
  );
  const answersByPlayer = new Map();
  for (const a of answerRows) {
    if (!answersByPlayer.has(a.player_key)) answersByPlayer.set(a.player_key, new Map());
    answersByPlayer.get(a.player_key).set(a.question_index, a);
  }
  const history = rankHistory(players, answersByPlayer, game.quiz.questions.length);

  // Team-Modus: das Team mit den meisten Punkten (inkl. Geist-Spieler, eindeutig, nicht gleichauf) gewinnt
  let winningTeam = null;
  if (game.team_count > 0) {
    const ranked = rankTeams(buildTeams(players, game.team_count));
    if (ranked[0].score > 0 && (!ranked[1] || ranked[0].score > ranked[1].score)) winningTeam = ranked[0].index;
  }

  const awards = []; // [userId, key]
  for (const [i, p] of players.entries()) {
    if (!p.user_id) continue;
    const s = stats(p.user_id);
    const keys = gameAchievements(game, p, i + 1, answersByPlayer.get(p.key) || new Map(), history);
    if (s.games >= 1) keys.push('first_game');
    if (s.games >= 5) keys.push('regular_5');
    if (s.games >= 20) keys.push('regular_20');
    if (s.wins >= 1) keys.push('winner');
    if (s.wins >= 3) keys.push('winner_3');
    if (s.points >= 10000) keys.push('points_10000');
    if (subjectCount > 0 && s.subjects >= subjectCount) keys.push('all_subjects');
    if (winningTeam !== null && p.team === winningTeam) keys.push('team_win');
    for (const key of keys) awards.push([p.user_id, key]);
  }
  awards.push([game.host_user_id, 'host']);

  await client.query(`
    INSERT INTO quiz.user_achievements (user_id, achievement_key, game_pin)
    SELECT u, k, $3 FROM unnest($1::bigint[], $2::text[]) AS t(u, k)
    ON CONFLICT DO NOTHING
  `, [awards.map((a) => a[0]), awards.map((a) => a[1]), game.pin]);
}

const router = express.Router();

// Alle Erfolge mit Stand des eingeloggten Nutzers
router.get('/', requireAuth, async (req, res) => {
  const earned = new Map((await db.query(
    'SELECT achievement_key, earned_at FROM quiz.user_achievements WHERE user_id = $1',
    [req.user.id],
  )).map((r) => [r.achievement_key, r.earned_at]));
  const stats = (await loadStats(db.query, [req.user.id]))(req.user.id);
  const [{ count: subjectCount }] = await db.query('SELECT COUNT(*)::int AS count FROM quiz.subjects');

  const achievements = ACHIEVEMENTS.map((a) => {
    const item = { key: a.key, icon: a.icon, name: a.name, description: a.description, earned: earned.has(a.key) };
    if (item.earned) item.earnedAt = earned.get(a.key);
    else if (a.progress) {
      const target = a.progress.target === 'subjectCount' ? subjectCount : a.progress.target;
      item.progress = { value: Math.min(stats[a.progress.stat], target), target };
    }
    return item;
  });
  res.json({ minPlayers: MIN_PLAYERS_FOR_SCORING, earned: earned.size, total: ACHIEVEMENTS.length, achievements });
});

module.exports = { router, awardForGame, publicInfo, ACHIEVEMENTS };
