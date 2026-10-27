-- Automatischer Ablauf: das Quiz läuft nach dem Start von selbst weiter (Auflösung → Rangliste → nächste Frage).
-- state_since merkt sich, seit wann das Spiel im aktuellen Zustand ist (Trigger setzt es bei jedem Zustandswechsel).
ALTER TABLE quiz.games ADD COLUMN auto BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE quiz.games ADD COLUMN state_since TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION quiz.games_state_since() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN NEW.state_since = now(); END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER games_state_since BEFORE UPDATE ON quiz.games
  FOR EACH ROW EXECUTE FUNCTION quiz.games_state_since();
