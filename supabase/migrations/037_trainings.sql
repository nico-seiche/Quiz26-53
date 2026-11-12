-- Übungen für Gutachten & Co.: Schemata (Prüfungsaufbau) und Muster (Musterformulierungen), einem Fach der Learnworld zugeordnet.
-- data: schema → { intro, nodes: [{ t, c: [...] }] }, muster → { intro, sections: [{ title, hint, blocks: [{ role, text mit {{Lücke|Alternative}} }] }] }
CREATE TABLE quiz.trainings (
  id         BIGSERIAL PRIMARY KEY,
  owner_id   BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  course_id  INTEGER REFERENCES quiz.lw_courses(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('schema', 'muster')),
  data       JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trainings_owner_idx ON quiz.trainings (owner_id, course_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.trainings TO quiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA quiz TO quiz_app;
