-- Learnworld: Rechtsfächer, denen eigene Dokumente (Vorlesungsmitschriften) und Lernsets zugeordnet werden.
-- Aus einem Dokument kann ein Lernset „angefragt“ werden (lw_requests); die Karten werden danach über die Sicht lw_open_requests bearbeitet.
CREATE TABLE quiz.lw_courses (
  id         SERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  icon       TEXT NOT NULL DEFAULT '📘',
  subject_id INTEGER REFERENCES quiz.subjects(id),   -- passendes Fach der Lernsets/Quiz (falls vorhanden)
  position   INTEGER NOT NULL DEFAULT 0
);
INSERT INTO quiz.lw_courses (slug, name, icon, subject_id, position) VALUES
  ('staatsrecht', 'Staats- und Verfassungsrecht', '📜', (SELECT id FROM quiz.subjects WHERE name = 'Staatsrecht'), 1),
  ('eingriffsrecht', 'Eingriffsrecht', '⚖️', (SELECT id FROM quiz.subjects WHERE name = 'Eingriffsrecht'), 2),
  ('strafrecht', 'Strafrecht', '🔨', (SELECT id FROM quiz.subjects WHERE name = 'Strafrecht'), 3),
  ('strafverfahrensrecht', 'Strafverfahrensrecht', '🧑‍⚖️', NULL, 4),
  ('verkehrsrecht', 'Verkehrsrecht', '🚦', (SELECT id FROM quiz.subjects WHERE name = 'Verkehrsrecht'), 5),
  ('beamtenrecht', 'Beamtenrecht', '👮', (SELECT id FROM quiz.subjects WHERE name = 'Beamtenrecht'), 6),
  ('verwaltungsrecht', 'Verwaltungsrecht', '🏛️', NULL, 7),
  ('zivilrecht', 'Zivilrecht', '📑', NULL, 8),
  ('europarecht', 'Europarecht', '🇪🇺', NULL, 9);

ALTER TABLE quiz.docs ADD COLUMN course_id INTEGER REFERENCES quiz.lw_courses(id) ON DELETE SET NULL;
CREATE INDEX docs_course_idx ON quiz.docs (owner_id, course_id);
ALTER TABLE quiz.study_sets ADD COLUMN course_id INTEGER REFERENCES quiz.lw_courses(id) ON DELETE SET NULL;
CREATE INDEX study_sets_course_idx ON quiz.study_sets (owner_id, course_id);

CREATE TABLE quiz.lw_requests (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  course_id  INTEGER NOT NULL REFERENCES quiz.lw_courses(id) ON DELETE CASCADE,
  doc_id     BIGINT REFERENCES quiz.docs(id) ON DELETE SET NULL,
  doc_title  TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
  set_id     BIGINT REFERENCES quiz.study_sets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at    TIMESTAMPTZ
);
CREATE INDEX lw_requests_user_idx ON quiz.lw_requests (user_id, status);
CREATE UNIQUE INDEX lw_requests_open_once ON quiz.lw_requests (doc_id) WHERE status = 'open';

-- Offene Anfragen mit dem Text des Dokuments (zum Bearbeiten; nicht für die App)
CREATE VIEW quiz.lw_open_requests AS
SELECT r.id, u.username, r.user_id, c.name AS course, c.subject_id, c.id AS course_id, r.doc_id, r.doc_title, r.note, r.created_at,
       (SELECT string_agg(op->>'insert', '' ORDER BY ord) FROM quiz.docs d, jsonb_array_elements(d.delta) WITH ORDINALITY AS t(op, ord)
        WHERE d.id = r.doc_id AND jsonb_typeof(op->'insert') = 'string') AS text
FROM quiz.lw_requests r
JOIN quiz.users u ON u.id = r.user_id
JOIN quiz.lw_courses c ON c.id = r.course_id
WHERE r.status = 'open'
ORDER BY r.created_at;

GRANT SELECT ON quiz.lw_courses TO quiz_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.lw_requests TO quiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA quiz TO quiz_app;
