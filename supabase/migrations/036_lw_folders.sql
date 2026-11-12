-- Learnworld: Ordner (auch verschachtelt) innerhalb eines Fachs, um Dokumente zu sortieren
CREATE TABLE quiz.lw_folders (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  course_id  INTEGER NOT NULL REFERENCES quiz.lw_courses(id) ON DELETE CASCADE,
  parent_id  BIGINT REFERENCES quiz.lw_folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX lw_folders_user_idx ON quiz.lw_folders (user_id, course_id);
ALTER TABLE quiz.docs ADD COLUMN folder_id BIGINT REFERENCES quiz.lw_folders(id) ON DELETE SET NULL;
CREATE INDEX docs_folder_idx ON quiz.docs (folder_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.lw_folders TO quiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA quiz TO quiz_app;
