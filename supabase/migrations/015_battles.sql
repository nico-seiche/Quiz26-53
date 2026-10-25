-- Battle: zwei Freunde spielen gleichzeitig Lückentext zu den Karten eines Lernsets gegeneinander.
CREATE TABLE quiz.battles (
  id               BIGSERIAL PRIMARY KEY,
  set_id           BIGINT REFERENCES quiz.study_sets(id) ON DELETE SET NULL,
  set_title        TEXT NOT NULL,
  challenger_id    BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  opponent_id      BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'finished', 'declined', 'cancelled')),
  rounds           INTEGER NOT NULL DEFAULT 5,
  round_index      INTEGER NOT NULL DEFAULT 0,
  phase            TEXT NOT NULL DEFAULT 'question' CHECK (phase IN ('question', 'reveal')),
  phase_started_at TIMESTAMPTZ,
  score_challenger INTEGER NOT NULL DEFAULT 0,
  score_opponent   INTEGER NOT NULL DEFAULT 0,
  winner_id        BIGINT REFERENCES quiz.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  CHECK (challenger_id <> opponent_id)
);
CREATE INDEX battles_challenger_idx ON quiz.battles (challenger_id);
CREATE INDEX battles_opponent_idx ON quiz.battles (opponent_id);

-- Pro Runde: dieselbe Karte mit denselben Lücken für beide
CREATE TABLE quiz.battle_rounds (
  battle_id BIGINT NOT NULL REFERENCES quiz.battles(id) ON DELETE CASCADE,
  idx       INTEGER NOT NULL,
  term      TEXT NOT NULL,
  tokens    JSONB NOT NULL,     -- Anzeige: [{text}] oder [{blank, len}] (ohne die Lösung)
  expected  JSONB NOT NULL,     -- die gesuchten Wörter in Lückenreihenfolge
  PRIMARY KEY (battle_id, idx)
);

CREATE TABLE quiz.battle_answers (
  battle_id    BIGINT NOT NULL,
  idx          INTEGER NOT NULL,
  user_id      BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  answers      JSONB NOT NULL,
  correct      INTEGER NOT NULL,
  points       INTEGER NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (battle_id, idx, user_id),
  FOREIGN KEY (battle_id, idx) REFERENCES quiz.battle_rounds(battle_id, idx) ON DELETE CASCADE
);

GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.battles, quiz.battle_rounds, quiz.battle_answers TO quiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA quiz TO quiz_app;
