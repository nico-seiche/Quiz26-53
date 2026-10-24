-- Lernplattform: Lernsets mit Karteikarten (Begriff + Definition) und Lernfortschritt je Nutzer.
-- Fortschritt nach dem Leitner-System: box 0 = neu/nicht gewusst, 1–4 = zunehmend sicher;
-- due_at ist der Zeitpunkt, ab dem die Karte wieder fällig ist.
CREATE TABLE quiz.study_sets (
  id         BIGSERIAL PRIMARY KEY,
  owner_id   BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  subject_id INTEGER REFERENCES quiz.subjects(id),
  is_public  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX study_sets_owner_idx ON quiz.study_sets (owner_id);

CREATE TABLE quiz.study_cards (
  id         BIGSERIAL PRIMARY KEY,
  set_id     BIGINT NOT NULL REFERENCES quiz.study_sets(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  term       TEXT NOT NULL,
  definition TEXT NOT NULL
);
CREATE INDEX study_cards_set_idx ON quiz.study_cards (set_id, position);

CREATE TABLE quiz.card_progress (
  user_id    BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  card_id    BIGINT NOT NULL REFERENCES quiz.study_cards(id) ON DELETE CASCADE,
  box        SMALLINT NOT NULL DEFAULT 0,
  due_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviews    INTEGER NOT NULL DEFAULT 0,
  last_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.study_sets, quiz.study_cards, quiz.card_progress TO quiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA quiz TO quiz_app;
