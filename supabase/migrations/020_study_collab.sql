-- Lernsets gemeinsam bearbeiten: Mitarbeiter (Freunde), Live-Sperre pro Karte, Kartenstand (rev).
ALTER TABLE quiz.study_cards ADD COLUMN rev INTEGER NOT NULL DEFAULT 1;

CREATE TABLE quiz.study_set_collaborators (
  set_id   BIGINT NOT NULL REFERENCES quiz.study_sets(id) ON DELETE CASCADE,
  user_id  BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (set_id, user_id)
);
CREATE INDEX study_set_collaborators_user_idx ON quiz.study_set_collaborators (user_id);

-- Wer bearbeitet gerade welche Karte (Eintrag verfällt ohne Lebenszeichen)
CREATE TABLE quiz.study_presence (
  set_id  BIGINT NOT NULL REFERENCES quiz.study_sets(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  card_id BIGINT REFERENCES quiz.study_cards(id) ON DELETE SET NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (set_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.study_set_collaborators, quiz.study_presence TO quiz_app;
