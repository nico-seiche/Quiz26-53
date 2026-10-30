-- Kopierte Lernsets merken ihr Original: Das Original verschwindet aus „Von anderen geteilt“, solange die Kopie aktuell ist,
-- und taucht mit „Update verfügbar“ wieder auf, wenn es danach geändert wurde.
ALTER TABLE quiz.study_sets ADD COLUMN copied_from BIGINT REFERENCES quiz.study_sets(id) ON DELETE SET NULL;
ALTER TABLE quiz.study_sets ADD COLUMN synced_to TIMESTAMPTZ;           -- Stand (updated_at) des Originals, mit dem die Kopie abgeglichen ist
ALTER TABLE quiz.study_cards ADD COLUMN source_card_id BIGINT;          -- Karte des Originals, aus der diese Karte stammt
CREATE INDEX study_sets_copied_from_idx ON quiz.study_sets (copied_from) WHERE copied_from IS NOT NULL;
