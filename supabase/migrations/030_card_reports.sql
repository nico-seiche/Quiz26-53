-- Fehler melden bei Lernsets: Spieler markieren eine Karte (Tippfehler, inhaltlich falsch, Sonstiges); Besitzer und Mitarbeiter arbeiten die Meldungen ab
CREATE TABLE quiz.card_reports (
  id          BIGSERIAL PRIMARY KEY,
  card_id     BIGINT NOT NULL REFERENCES quiz.study_cards(id) ON DELETE CASCADE,
  set_id      BIGINT NOT NULL REFERENCES quiz.study_sets(id) ON DELETE CASCADE,
  reporter_id BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('typo', 'wrong', 'other')),
  note        TEXT NOT NULL DEFAULT '',
  term        TEXT NOT NULL,
  definition  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dismissed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by BIGINT REFERENCES quiz.users(id) ON DELETE SET NULL
);
CREATE INDEX card_reports_set_idx ON quiz.card_reports (set_id, status);
CREATE UNIQUE INDEX card_reports_open_once ON quiz.card_reports (card_id, reporter_id) WHERE status = 'open';
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.card_reports TO quiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA quiz TO quiz_app;
