-- Learnworld: nur die fünf Rechtsfächer des Studiums
DELETE FROM quiz.lw_courses WHERE slug NOT IN ('eingriffsrecht', 'strafrecht', 'staatsrecht', 'beamtenrecht', 'verkehrsrecht');
UPDATE quiz.lw_courses SET name = 'Staatsrecht', position = 3 WHERE slug = 'staatsrecht';
UPDATE quiz.lw_courses SET position = 1 WHERE slug = 'eingriffsrecht';
UPDATE quiz.lw_courses SET position = 2 WHERE slug = 'strafrecht';
UPDATE quiz.lw_courses SET position = 4 WHERE slug = 'beamtenrecht';
UPDATE quiz.lw_courses SET position = 5 WHERE slug = 'verkehrsrecht';
