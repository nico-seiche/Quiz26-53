-- Eigene Datenbank-Rolle für die Vercel-API (nur Zugriff auf das Schema "quiz").
-- Das Passwort wird separat gesetzt: ALTER ROLE quiz_app PASSWORD '...';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quiz_app') THEN
    CREATE ROLE quiz_app LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA quiz TO quiz_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA quiz TO quiz_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA quiz TO quiz_app;
GRANT EXECUTE ON FUNCTION quiz.notify(TEXT) TO quiz_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA quiz GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quiz_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA quiz GRANT USAGE, SELECT ON SEQUENCES TO quiz_app;
ALTER ROLE quiz_app SET search_path = quiz;
