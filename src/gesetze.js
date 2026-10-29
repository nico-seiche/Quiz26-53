const express = require('express');
const { requireAuth } = require('./auth');

// Experimentell: die §-Sammlung ist vorerst nur für den Nutzer „Nico“ freigeschaltet.
// Weitere Gesetze: mit scripts/import-recht-nrw.js erzeugen und hier eintragen.
const LAWS = [require('./gesetze/polg-nrw.json')];

const router = express.Router();
router.use(requireAuth, (req, res, next) => {
  if (req.user.username.toLowerCase() !== 'nico') return res.status(403).json({ error: 'Die §-Sammlung ist noch nicht für dich freigeschaltet' });
  next();
});

router.get('/', (req, res) => {
  res.json(LAWS.map((l) => ({ slug: l.slug, short: l.short, title: l.title, validFrom: l.validFrom, count: l.items.filter((i) => i.type === 'par').length })));
});

router.get('/:slug', (req, res) => {
  const law = LAWS.find((l) => l.slug === req.params.slug);
  if (!law) return res.status(404).json({ error: 'Gesetz nicht gefunden' });
  res.set('Cache-Control', 'private, max-age=3600').json(law);
});

module.exports = { router };
