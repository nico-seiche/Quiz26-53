-- Serien-Bonus: Länge der Serie und Bonuspunkte je Antwort (points enthält den Bonus bereits)
ALTER TABLE quiz.game_answers ADD COLUMN streak INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quiz.game_answers ADD COLUMN bonus INTEGER NOT NULL DEFAULT 0;

-- Team-Modus: Anzahl der Teams im Spiel (0 = aus) und Team (0-3) je Spieler, vergeben beim Start
ALTER TABLE quiz.games ADD COLUMN team_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quiz.game_players ADD COLUMN team INTEGER;
