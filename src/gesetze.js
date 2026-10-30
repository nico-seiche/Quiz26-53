const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

// Experimentell: die §-Sammlung ist vorerst nur für den Nutzer „Nico“ freigeschaltet.
// Weitere Gesetze: mit scripts/import-recht-nrw.js (Landesrecht NRW) oder scripts/import-gii.js (Bundesrecht) erzeugen und hier eintragen.
// Die Texte werden erst bei Bedarf geladen (große JSON-Dateien); die Liste kommt aus index.json (scripts/build-gesetze-index.js).
const INDEX = require('./gesetze/index.json');
const LOADERS = {
  'polg-nrw': () => require('./gesetze/polg-nrw.json'),
  'obg-nrw': () => require('./gesetze/obg-nrw.json'),
  stgb: () => require('./gesetze/stgb.json'),
  stpo: () => require('./gesetze/stpo.json'),
  owig_1968: () => require('./gesetze/owig_1968.json'),
  stvo_2013: () => require('./gesetze/stvo_2013.json'),
  stvzo_2012: () => require('./gesetze/stvzo_2012.json'),
  gg: () => require('./gesetze/gg.json'),
  bgb: () => require('./gesetze/bgb.json'),
};

const router = express.Router();
// Freigeschaltet sind die Nutzer-IDs in quiz.app_settings (gesetze_user_ids, kommagetrennt), damit eine Namensänderung nichts kaputt macht.
// Solange der Eintrag fehlt, gilt der Name „Nico“.
router.use(requireAuth, async (req, res, next) => {
  const row = await db.one("SELECT value FROM quiz.app_settings WHERE key = 'gesetze_user_ids'");
  const allowed = row ? row.value.split(',').map((x) => x.trim()) : null;
  const ok = allowed ? allowed.includes(String(req.user.id)) : req.user.username.toLowerCase() === 'nico';
  if (!ok) return res.status(403).json({ error: 'Die §-Sammlung ist noch nicht für dich freigeschaltet' });
  next();
});

router.get('/', (req, res) => {
  res.json(INDEX);
});

router.get('/:slug', (req, res) => {
  const load = Object.hasOwn(LOADERS, req.params.slug) && LOADERS[req.params.slug];
  if (!load) return res.status(404).json({ error: 'Gesetz nicht gefunden' });
  const law = load();
  res.set('Cache-Control', 'private, max-age=3600').json(law);
});

module.exports = { router };
