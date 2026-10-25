const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

// Profilbilder: kleines JPEG pro Nutzer. Anzeige für alle angemeldeten Nutzer, Ändern nur für sich selbst.
const MAX_BYTES = 150 * 1024;

// Bild eines Nutzers (nach Name). ETag + kurzer Cache, damit Listen mit vielen Bildern schnell bleiben.
const imageRouter = express.Router();
imageRouter.get('/:username', requireAuth, async (req, res) => {
  const row = await db.one(`
    SELECT a.image, EXTRACT(EPOCH FROM a.updated_at)::bigint AS ver
    FROM quiz.user_avatars a JOIN quiz.users u ON u.id = a.user_id WHERE lower(u.username) = lower($1)`, [req.params.username]);
  res.set('Cache-Control', 'private, max-age=600');
  if (!row) return res.status(404).end();
  const etag = `"av${row.ver}"`;
  res.set('ETag', etag);
  if (req.get('If-None-Match') === etag) return res.status(304).end();
  res.type('image/jpeg').send(row.image);
});

// Eigenes Bild setzen oder entfernen
const meRouter = express.Router();
meRouter.use(requireAuth);
meRouter.post('/', async (req, res) => {
  const img = req.body;
  if (!Buffer.isBuffer(img) || img.length < 100) return res.status(400).json({ error: 'Kein Bild erhalten' });
  if (img.length > MAX_BYTES) return res.status(413).json({ error: 'Das Bild ist zu groß' });
  // Muss wirklich ein JPEG sein (Dateianfang FF D8 FF)
  if (!(img[0] === 0xff && img[1] === 0xd8 && img[2] === 0xff)) return res.status(400).json({ error: 'Bitte ein Foto (JPEG) hochladen' });
  const row = await db.one(`
    INSERT INTO quiz.user_avatars (user_id, image) VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET image = $2, updated_at = now()
    RETURNING EXTRACT(EPOCH FROM updated_at)::bigint AS ver`, [req.user.id, img]);
  res.json({ ver: Number(row.ver) });
});
meRouter.delete('/', async (req, res) => {
  await db.query('DELETE FROM quiz.user_avatars WHERE user_id = $1', [req.user.id]);
  res.json({ ok: true });
});

module.exports = { imageRouter, meRouter };
