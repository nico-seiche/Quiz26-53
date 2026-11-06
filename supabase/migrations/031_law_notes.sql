-- Markierungen und Notizen in den Gesetzen (privat, pro Nutzer).
-- line = Zeilennummer im Text des Paragraphen (0, 1, …), start/end = Zeichenposition in dieser Zeile; line = -1 ist eine Notiz zum ganzen Paragraphen.
-- quote ist der markierte Wortlaut (zum Wiederfinden, falls sich der Gesetzestext ändert).
CREATE TABLE quiz.law_notes (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  law        TEXT NOT NULL,
  num        TEXT NOT NULL,
  line       INTEGER NOT NULL DEFAULT -1,
  start_pos  INTEGER NOT NULL DEFAULT 0,
  end_pos    INTEGER NOT NULL DEFAULT 0,
  quote      TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT 'yellow' CHECK (color IN ('yellow', 'green', 'blue', 'pink')),
  note       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX law_notes_user_idx ON quiz.law_notes (user_id, law, num);
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.law_notes TO quiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA quiz TO quiz_app;
