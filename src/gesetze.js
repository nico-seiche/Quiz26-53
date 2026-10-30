const express = require('express');
const { experimentalOnly } = require('./experimental');

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
router.use(experimentalOnly);

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
