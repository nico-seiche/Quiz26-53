-- Handschrift (Apple Pencil) über einem Paragraphen im Gesetz, privat pro Nutzer; Aufbau der Striche wie bei quiz.docs.ink (Anker = laufende Nummer der Textzeile)
CREATE TABLE quiz.law_ink (
  user_id    BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  law        TEXT NOT NULL,
  num        TEXT NOT NULL,
  ink        JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, law, num)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.law_ink TO quiz_app;
