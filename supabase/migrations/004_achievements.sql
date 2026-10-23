-- Erreichte Erfolge (Definitionen stehen im Code: src/achievements.js).
-- game_pin merkt sich das Spiel, in dem der Erfolg erreicht wurde (ohne Fremdschlüssel, Spiele werden aufgeräumt).
CREATE TABLE quiz.user_achievements (
  user_id         BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  earned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  game_pin        TEXT,
  PRIMARY KEY (user_id, achievement_key)
);
CREATE INDEX user_achievements_game_idx ON quiz.user_achievements (game_pin);

GRANT SELECT, INSERT ON quiz.user_achievements TO quiz_app;
