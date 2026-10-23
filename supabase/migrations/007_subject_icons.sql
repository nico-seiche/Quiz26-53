-- Symbol je Fach (Emoji), z. B. für die Anzeige gespielter Quiz. Neue Fächer:
--   INSERT INTO quiz.subjects (name, position, icon) VALUES ('Statistik', 4, '📊');
ALTER TABLE quiz.subjects ADD COLUMN icon TEXT NOT NULL DEFAULT '📘';
UPDATE quiz.subjects SET icon = '🏛️' WHERE name = 'Politik';
UPDATE quiz.subjects SET icon = '👥' WHERE name = 'Soziologie';
UPDATE quiz.subjects SET icon = '🧠' WHERE name = 'Psychologie';
