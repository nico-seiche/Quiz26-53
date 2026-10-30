const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

// Experimentell: die §-Sammlung ist vorerst nur für den Nutzer „Nico“ freigeschaltet.
// Weitere Gesetze: mit scripts/import-recht-nrw.js (Landesrecht NRW) oder scripts/import-gii.js (Bundesrecht) erzeugen und hier eintragen.
const LAWS = [
  require('./gesetze/polg-nrw.json'),
  require('./gesetze/stgb.json'),
  require('./gesetze/stpo.json'),
  require('./gesetze/stvo_2013.json'),
  require('./gesetze/stvzo_2012.json'),
];

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
  res.json(LAWS.map((l) => ({ slug: l.slug, short: l.short, title: l.title, validFrom: l.validFrom, count: l.items.filter((i) => i.type === 'par').length })));
});

router.get('/:slug', (req, res) => {
  const law = LAWS.find((l) => l.slug === req.params.slug);
  if (!law) return res.status(404).json({ error: 'Gesetz nicht gefunden' });
  res.set('Cache-Control', 'private, max-age=3600').json(law);
});

module.exports = { router };
