-- Dokumente (Word-Alternative): Text als Quill-Delta (JSON), Bilder als eigene Zeilen
CREATE TABLE quiz.docs (
  id         BIGSERIAL PRIMARY KEY,
  owner_id   BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  delta      JSONB NOT NULL,
  preview    TEXT NOT NULL DEFAULT '',
  rev        INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX docs_owner_idx ON quiz.docs (owner_id, updated_at DESC);

CREATE TABLE quiz.doc_assets (
  id         BIGSERIAL PRIMARY KEY,
  doc_id     BIGINT NOT NULL REFERENCES quiz.docs(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX doc_assets_doc_idx ON quiz.doc_assets (doc_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.docs, quiz.doc_assets TO quiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA quiz TO quiz_app;
