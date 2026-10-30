-- Rangliste zurücksetzen, ohne Spielergebnisse zu löschen: sie zählt nur Spiele ab diesem Stichtag.
-- Nächster Reset: UPDATE quiz.app_settings SET value = now()::text WHERE key = 'leaderboard_since';
CREATE TABLE quiz.app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO quiz.app_settings (key, value) VALUES ('leaderboard_since', now()::text);
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.app_settings TO quiz_app;
