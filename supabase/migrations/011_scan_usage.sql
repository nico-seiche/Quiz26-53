-- Zähler für Foto-Scans pro Nutzer und Tag (begrenzt die Kosten der Handschrift-Erkennung)
CREATE TABLE quiz.scan_usage (
  user_id BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  day     DATE NOT NULL,
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.scan_usage TO quiz_app;
