const express = require('express');
const { requireAuth } = require('./auth');
const db = require('./db');

// Gesetzessammlung für alle angemeldeten Nutzer.
// Weitere Gesetze: mit scripts/import-recht-nrw.js (Landesrecht NRW) oder scripts/import-gii.js (Bundesrecht) erzeugen und hier eintragen.
// Die Texte werden erst bei Bedarf geladen (große JSON-Dateien); die Liste kommt aus index.json (scripts/build-gesetze-index.js).
const INDEX = require('./gesetze/index.json');
const LOADERS = {
  'polg-nrw': () => require('./gesetze/polg-nrw.json'),
  'obg-nrw': () => require('./gesetze/obg-nrw.json'),
  'pog-nrw': () => require('./gesetze/pog-nrw.json'),
  stgb: () => require('./gesetze/stgb.json'),
  stpo: () => require('./gesetze/stpo.json'),
  owig_1968: () => require('./gesetze/owig_1968.json'),
  stvo_2013: () => require('./gesetze/stvo_2013.json'),
  stvzo_2012: () => require('./gesetze/stvzo_2012.json'),
  gg: () => require('./gesetze/gg.json'),
  bgb: () => require('./gesetze/bgb.json'),
};

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(INDEX);
});

// Favoriten (Paragraphen, die man sich markiert hat)
const NUMBER = /^[0-9]{1,4}[a-z]{0,2}$/;
const known = (slug) => Object.hasOwn(LOADERS, slug);
router.get('/favorites/all', async (req, res) => {
  res.json(await db.query('SELECT law, num, title FROM quiz.law_favorites WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]));
});
router.put('/favorites/:slug/:num', async (req, res) => {
  if (!known(req.params.slug) || !NUMBER.test(req.params.num)) return res.status(400).json({ error: 'Ungültiger Paragraph' });
  const title = String((req.body && req.body.title) || '').slice(0, 200);
  await db.query(
    `INSERT INTO quiz.law_favorites (user_id, law, num, title) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, law, num) DO UPDATE SET title = EXCLUDED.title`,
    [req.user.id, req.params.slug, req.params.num, title],
  );
  res.json({ ok: true });
});
router.delete('/favorites/:slug/:num', async (req, res) => {
  await db.query('DELETE FROM quiz.law_favorites WHERE user_id = $1 AND law = $2 AND num = $3', [req.user.id, req.params.slug, req.params.num]);
  res.json({ ok: true });
});

router.get('/:slug', (req, res) => {
  const load = Object.hasOwn(LOADERS, req.params.slug) && LOADERS[req.params.slug];
  if (!load) return res.status(404).json({ error: 'Gesetz nicht gefunden' });
  const law = load();
  res.set('Cache-Control', 'private, max-age=3600').json(law);
});

module.exports = { router };
