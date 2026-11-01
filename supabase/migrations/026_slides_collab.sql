-- Folien gemeinsam bearbeiten und teilen: Mitbearbeiter (Freunde), Ansehen-Link, Anwesenheit im Editor
ALTER TABLE quiz.slide_decks ADD COLUMN share_token TEXT UNIQUE;

CREATE TABLE quiz.slide_collaborators (
  deck_id BIGINT NOT NULL REFERENCES quiz.slide_decks(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  PRIMARY KEY (deck_id, user_id)
);
CREATE INDEX slide_collaborators_user_idx ON quiz.slide_collaborators (user_id);

-- Wer gerade im Editor ist, auf welcher Folie und an welchem Element
CREATE TABLE quiz.slide_presence (
  deck_id    BIGINT NOT NULL REFERENCES quiz.slide_decks(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  slide_id   TEXT,
  element_id TEXT,
  seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deck_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.slide_collaborators, quiz.slide_presence TO quiz_app;
