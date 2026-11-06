-- Freie Handschrift (Apple Pencil) über dem ganzen Dokument: Striche mit Verankerung am Text (siehe public/js/docs-pen.js)
ALTER TABLE quiz.docs ADD COLUMN ink JSONB NOT NULL DEFAULT '[]';
