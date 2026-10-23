-- Spielmodus des Quiz: 'single' (jeder für sich) oder 'team' (zwei Teams). Bestehende Quizze bleiben Einzel.
ALTER TABLE quiz.quizzes ADD COLUMN mode TEXT NOT NULL DEFAULT 'single' CHECK (mode IN ('single', 'team'));
