-- Alle Tabellen liegen im Schema "quiz". Es ist nicht über die Supabase-REST-API
-- erreichbar; Zugriff nur über die Vercel-API mit der Rolle "quiz_app".
CREATE SCHEMA IF NOT EXISTS quiz;

CREATE TABLE quiz.users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_key ON quiz.users (lower(username));

CREATE TABLE quiz.sessions (
  token      TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE quiz.quizzes (
  id         BIGSERIAL PRIMARY KEY,
  owner_id   BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- answers: JSON-Array mit Antworttexten, correct: Index der richtigen Antwort
CREATE TABLE quiz.questions (
  id         BIGSERIAL PRIMARY KEY,
  quiz_id    BIGINT NOT NULL REFERENCES quiz.quizzes(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  text       TEXT NOT NULL,
  answers    JSONB NOT NULL,
  correct    INTEGER NOT NULL,
  time_limit INTEGER NOT NULL DEFAULT 20
);

-- Laufende Spiele; das Quiz wird beim Start als Kopie abgelegt
CREATE TABLE quiz.games (
  pin                 TEXT PRIMARY KEY,
  host_user_id        BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  quiz_id             BIGINT,
  quiz                JSONB NOT NULL,
  state               TEXT NOT NULL DEFAULT 'lobby',
  question_index      INTEGER NOT NULL DEFAULT -1,
  question_started_at TIMESTAMPTZ,
  ends_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- key: "u:<user_id>" für eingeloggte Spieler, "g:<gast-id>" für Gäste
CREATE TABLE quiz.game_players (
  game_pin  TEXT NOT NULL REFERENCES quiz.games(pin) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  user_id   BIGINT REFERENCES quiz.users(id) ON DELETE SET NULL,
  name      TEXT NOT NULL,
  score     INTEGER NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_pin, key)
);
CREATE UNIQUE INDEX game_players_name_key ON quiz.game_players (game_pin, lower(name));

CREATE TABLE quiz.game_answers (
  game_pin       TEXT NOT NULL,
  question_index INTEGER NOT NULL,
  player_key     TEXT NOT NULL,
  choice         INTEGER NOT NULL,
  answered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  points         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_pin, question_index, player_key),
  FOREIGN KEY (game_pin, player_key) REFERENCES quiz.game_players(game_pin, key) ON DELETE CASCADE
);

-- Ergebnisse eingeloggter Spieler; Titel wird kopiert, damit Ergebnisse gelöschte Quizze überleben
CREATE TABLE quiz.game_results (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES quiz.users(id) ON DELETE CASCADE,
  quiz_id      BIGINT,
  quiz_title   TEXT NOT NULL,
  score        INTEGER NOT NULL,
  rank         INTEGER NOT NULL,
  player_count INTEGER NOT NULL,
  played_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX game_results_user_idx ON quiz.game_results (user_id, played_at DESC);

-- Schickt ein "update"-Signal an alle Browser im Kanal "game:<pin>" (Supabase Realtime).
-- Ohne Supabase (lokale Entwicklung) ist die Funktion wirkungslos.
DO $$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION quiz.notify(pin TEXT) RETURNS void
      LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $body$
        SELECT realtime.send(jsonb_build_object('at', now()), 'update', 'game:' || pin, false);
      $body$
    $f$;
  ELSE
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION quiz.notify(pin TEXT) RETURNS void
      LANGUAGE sql AS $body$ SELECT $body$
    $f$;
  END IF;
END $$;
