-- Lernpunkte: kleine Punkte fürs Üben (Karteikarten, Lückentext, Aus dem Kopf, Tippen).
-- Sie zählen nicht für Bestenliste, Level oder Erfolge, sondern erscheinen nur im eigenen Profil.
CREATE TABLE quiz.learn_events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  card_id    BIGINT REFERENCES quiz.study_cards(id) ON DELETE SET NULL,
  mode       TEXT NOT NULL CHECK (mode IN ('cards', 'cloze', 'free', 'type')),
  points     INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX learn_events_user_idx ON quiz.learn_events (user_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.learn_events TO quiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA quiz TO quiz_app;
