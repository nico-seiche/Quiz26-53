-- Gleichzeitiges Bearbeiten von Quiz: jede Frage hat einen Stand (rev), und wer eine Frage gerade bearbeitet,
-- hält sie in quiz_presence "gesperrt". Der Eintrag verfällt, wenn der Browser sich ein paar Sekunden nicht meldet.
ALTER TABLE quiz.questions ADD COLUMN rev INTEGER NOT NULL DEFAULT 1;

CREATE TABLE quiz.quiz_presence (
  quiz_id     BIGINT NOT NULL REFERENCES quiz.quizzes(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  question_id BIGINT REFERENCES quiz.questions(id) ON DELETE SET NULL,
  seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (quiz_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.quiz_presence TO quiz_app;
