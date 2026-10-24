-- Gemeinsam an Quiz arbeiten: Besitzer laden andere Nutzer als Mitarbeiter ein.
-- Mitarbeiter dürfen Fragen bearbeiten und das Quiz starten, aber es nicht löschen oder Mitarbeiter verwalten.
CREATE TABLE quiz.quiz_collaborators (
  quiz_id  BIGINT NOT NULL REFERENCES quiz.quizzes(id) ON DELETE CASCADE,
  user_id  BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (quiz_id, user_id)
);
CREATE INDEX quiz_collaborators_user_idx ON quiz.quiz_collaborators (user_id);

-- Wer hat zuletzt gespeichert (für die Hinweise bei gleichzeitigem Bearbeiten)
ALTER TABLE quiz.quizzes ADD COLUMN updated_by BIGINT REFERENCES quiz.users(id) ON DELETE SET NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.quiz_collaborators TO quiz_app;
