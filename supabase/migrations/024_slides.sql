-- Folien (Präsentationen wie PowerPoint), experimentell. Eine Präsentation ist ein JSON-Dokument; Bilder liegen als eigene Zeilen.
CREATE TABLE quiz.slide_decks (
  id         BIGSERIAL PRIMARY KEY,
  owner_id   BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  data       JSONB NOT NULL,
  rev        INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX slide_decks_owner_idx ON quiz.slide_decks (owner_id, updated_at DESC);

CREATE TABLE quiz.slide_assets (
  id         BIGSERIAL PRIMARY KEY,
  deck_id    BIGINT NOT NULL REFERENCES quiz.slide_decks(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX slide_assets_deck_idx ON quiz.slide_assets (deck_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.slide_decks, quiz.slide_assets TO quiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA quiz TO quiz_app;
