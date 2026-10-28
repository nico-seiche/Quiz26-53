-- Mehrfachauswahl (mehrere richtige Antworten) und Umfragen (Quiz ohne richtig/falsch, mit Ergebnis-Diagrammen)
ALTER TABLE quiz.quizzes ADD COLUMN kind TEXT NOT NULL DEFAULT 'quiz' CHECK (kind IN ('quiz', 'poll'));
ALTER TABLE quiz.questions ADD COLUMN multi BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE quiz.questions ADD COLUMN correct_mask INTEGER;       -- Bitmaske der richtigen Antworten (nur bei Mehrfachauswahl im Quiz)
ALTER TABLE quiz.game_answers ADD COLUMN mask INTEGER;            -- Bitmaske der gewählten Antworten (bei Mehrfachauswahl mehrere Bits)

-- Gespeicherte Umfrage-Ergebnisse, damit man sie nach dem Spiel noch ansehen kann
CREATE TABLE quiz.poll_runs (
  id           BIGSERIAL PRIMARY KEY,
  quiz_id      BIGINT REFERENCES quiz.quizzes(id) ON DELETE SET NULL,
  owner_id     BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  participants INTEGER NOT NULL,
  results      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX poll_runs_quiz_idx ON quiz.poll_runs (quiz_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.poll_runs TO quiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA quiz TO quiz_app;
