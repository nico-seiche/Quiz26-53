const express = require('express');
const auth = require('./auth');
const quizzes = require('./quizzes');
const game = require('./game');
const results = require('./results');
const achievements = require('./achievements');
const leaderboard = require('./leaderboard');
const study = require('./study');
const friends = require('./friends');
const battles = require('./battles');
const db = require('./db');

// Die API; lokal von server.js gestartet, auf Vercel als Serverless-Funktion (api/index.js)
const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(auth.loadUser);

// Öffentliche Supabase-Daten für Realtime im Browser (der Publishable Key ist nicht geheim)
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY || null,
  });
});

// Fächer, denen Quiz zugeordnet werden
app.get('/api/subjects', async (req, res) => {
  res.json(await db.query('SELECT id, name, icon FROM quiz.subjects ORDER BY position, id'));
});

// Prüft die Datenbankverbindung
app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1 FROM quiz.users LIMIT 1');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(503).json({ ok: false, error: 'Datenbank nicht erreichbar' });
  }
});

app.use('/api/auth', auth.router);
app.use('/api/quizzes', quizzes.router);
app.use('/api/games', game.router);
app.use('/api/results', results.router);
app.use('/api/achievements', achievements.router);
app.use('/api/leaderboard', leaderboard.router);
app.use('/api/study', study.router);
app.use('/api/friends', friends.router);
app.use('/api/battles', battles.router);

app.use('/api', (req, res) => res.status(404).json({ error: 'Nicht gefunden' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Serverfehler, bitte erneut versuchen' });
});

module.exports = app;
