const db = require('./db');
const { requireAuth } = require('./auth');

// Experimentelle Funktionen (§-Sammlung, Folien) sind nur für freigeschaltete Nutzer da: quiz.app_settings,
// experimental_user_ids (kommagetrennte Nutzer-IDs; ersatzweise gesetze_user_ids). Fehlt beides, gilt der Name „Nico“.
async function allowed(user) {
  const row = await db.one("SELECT value FROM quiz.app_settings WHERE key IN ('experimental_user_ids', 'gesetze_user_ids') ORDER BY (key = 'experimental_user_ids') DESC LIMIT 1");
  if (row) return row.value.split(',').map((x) => x.trim()).includes(String(user.id));
  return user.username.toLowerCase() === 'nico';
}

const experimentalOnly = [requireAuth, async (req, res, next) => {
  if (!(await allowed(req.user))) return res.status(403).json({ error: 'Diese Funktion ist noch nicht für dich freigeschaltet' });
  next();
}];

module.exports = { experimentalOnly, allowed };
