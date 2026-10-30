const db = require('./db');
const { requireAuth } = require('./auth');

// Experimentelle Funktionen sind nur für freigeschaltete Nutzer da. Je Funktion gibt es in quiz.app_settings einen Eintrag
// „<funktion>_user_ids“ (kommagetrennte Nutzer-IDs), z. B. slides_user_ids oder gesetze_user_ids. Fehlt er, gilt
// experimental_user_ids und zuletzt der Name „Nico“.
async function allowed(user, feature) {
  const keys = [`${feature}_user_ids`, 'experimental_user_ids'];
  const rows = await db.query('SELECT key, value FROM quiz.app_settings WHERE key = ANY($1::text[])', [keys]);
  const row = keys.map((k) => rows.find((r) => r.key === k)).find(Boolean);
  if (row) return row.value.split(',').map((x) => x.trim()).includes(String(user.id));
  return user.username.toLowerCase() === 'nico';
}

const experimentalOnly = (feature) => [requireAuth, async (req, res, next) => {
  if (!(await allowed(req.user, feature))) return res.status(403).json({ error: 'Diese Funktion ist noch nicht für dich freigeschaltet' });
  next();
}];

module.exports = { experimentalOnly, allowed };
