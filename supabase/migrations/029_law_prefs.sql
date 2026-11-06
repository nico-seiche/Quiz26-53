-- Persönliche Gesetzes-Bibliothek: welche Gesetze ein Nutzer sieht und in welcher Reihenfolge (neue Gesetze erscheinen standardmäßig)
CREATE TABLE quiz.law_prefs (
  user_id    BIGINT PRIMARY KEY REFERENCES quiz.users(id) ON DELETE CASCADE,
  hidden     TEXT[] NOT NULL DEFAULT '{}',
  sort_order TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON quiz.law_prefs TO quiz_app;
