-- Favoriten bei den Gesetzen: pro Nutzer markierte Paragraphen (Titel als Merkzettel, damit die Übersicht keine Gesetze laden muss)
CREATE TABLE quiz.law_favorites (
  user_id    BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  law        TEXT NOT NULL,
  num        TEXT NOT NULL,
  title      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, law, num)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.law_favorites TO quiz_app;
