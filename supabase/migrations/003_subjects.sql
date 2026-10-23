-- Fächer, denen Quizze zugeordnet werden. Neue Fächer einfach per INSERT ergänzen:
--   INSERT INTO quiz.subjects (name, position) VALUES ('Statistik', 4);
CREATE TABLE quiz.subjects (
  id       SERIAL PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL DEFAULT 0
);

INSERT INTO quiz.subjects (name, position) VALUES
  ('Politik', 1),
  ('Soziologie', 2),
  ('Psychologie', 3);

-- Bestehende Quizze/Ergebnisse haben noch kein Fach (NULL)
ALTER TABLE quiz.quizzes ADD COLUMN subject_id INTEGER REFERENCES quiz.subjects(id);
ALTER TABLE quiz.game_results ADD COLUMN subject_id INTEGER REFERENCES quiz.subjects(id);
CREATE INDEX game_results_subject_idx ON quiz.game_results (user_id, subject_id);

GRANT SELECT ON quiz.subjects TO quiz_app;
