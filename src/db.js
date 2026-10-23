const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'quiz.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quizzes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- answers: JSON-Array mit Antworttexten, correct: Index der richtigen Antwort
  CREATE TABLE IF NOT EXISTS questions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id    INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    text       TEXT NOT NULL,
    answers    TEXT NOT NULL,
    correct    INTEGER NOT NULL,
    time_limit INTEGER NOT NULL DEFAULT 20
  );

  -- Ergebnisse eingeloggter Spieler; Titel wird kopiert, damit Ergebnisse gelöschte Quizze überleben
  CREATE TABLE IF NOT EXISTS game_results (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quiz_id      INTEGER,
    quiz_title   TEXT NOT NULL,
    score        INTEGER NOT NULL,
    rank         INTEGER NOT NULL,
    player_count INTEGER NOT NULL,
    played_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
