-- Reaktionen (Emojis) von Teilnehmern in der Lobby; der Host-Bildschirm zeigt sie an.
CREATE TABLE quiz.game_reactions (
  id         BIGSERIAL PRIMARY KEY,
  game_pin   TEXT NOT NULL REFERENCES quiz.games(pin) ON DELETE CASCADE,
  player_key TEXT NOT NULL,
  name       TEXT NOT NULL,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX game_reactions_pin_idx ON quiz.game_reactions (game_pin, id);
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.game_reactions TO quiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA quiz TO quiz_app;
