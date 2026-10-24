const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

// Handschrift-/Texterkennung für Karteikarten: das Foto geht an ein Claude-Modell mit Bildverständnis.
// Ohne ANTHROPIC_API_KEY ist die Funktion aus (die App läuft sonst unverändert).
const MODEL = process.env.SCAN_MODEL || 'claude-sonnet-5-5';
const API_URL = process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com/v1/messages';
const DAILY_LIMIT = Number(process.env.SCAN_DAILY_LIMIT) || 60;
const MAX_BASE64 = 5 * 1024 * 1024; // Vercel erlaubt ca. 4,5 MB pro Anfrage; der Browser verkleinert vorher

const PROMPTS = {
  term: 'Das Bild zeigt die Vorderseite einer Karteikarte mit einem Begriff oder einer kurzen Frage.',
  definition: 'Das Bild zeigt die Rückseite einer Karteikarte mit einer Definition oder Erklärung (kann mehrere Zeilen lang sein).',
};

const router = express.Router();
router.use(requireAuth);

router.post('/', async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ error: 'Das Scannen ist noch nicht eingerichtet (ANTHROPIC_API_KEY fehlt).' });
  const { image, kind } = req.body || {};
  const match = typeof image === 'string' && image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !PROMPTS[kind]) return res.status(400).json({ error: 'Ungültiges Bild' });
  if (match[2].length > MAX_BASE64) return res.status(413).json({ error: 'Das Bild ist zu groß' });

  // Tageslimit je Nutzer (zählt vor dem Aufruf, damit Fehlversuche nicht beliebig oft möglich sind)
  const used = await db.one(`
    INSERT INTO quiz.scan_usage (user_id, day, count) VALUES ($1, (now() AT TIME ZONE 'Europe/Berlin')::date, 1)
    ON CONFLICT (user_id, day) DO UPDATE SET count = quiz.scan_usage.count + 1
    RETURNING count
  `, [req.user.id]);
  if (used.count > DAILY_LIMIT) return res.status(429).json({ error: `Tageslimit von ${DAILY_LIMIT} Scans erreicht – morgen geht es weiter.` });

  let reply;
  try {
    reply = await fetch(API_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: 'Du transkribierst Fotos von Karteikarten (Handschrift oder Druck, meist Deutsch) Wort für Wort. '
          + 'Gib ausschließlich den erkannten Text zurück, ohne Einleitung, Anführungszeichen oder Kommentar. '
          + 'Behalte die Rechtschreibung des Originals bei und ergänze nichts. Zeilenumbrüche innerhalb eines Satzes '
          + 'werden zu Leerzeichen. Steht ein Wort unleserlich da, schreibe dein bestes Raten und setze (?) dahinter. '
          + 'Ist gar kein Text erkennbar, antworte mit genau: KEIN_TEXT',
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } },
            { type: 'text', text: `${PROMPTS[kind]} Transkribiere den Text.` },
          ],
        }],
      }),
      signal: AbortSignal.timeout(25000),
    });
  } catch (err) {
    console.error('scan', err);
    return res.status(502).json({ error: 'Die Texterkennung hat nicht geantwortet – bitte noch einmal versuchen.' });
  }
  if (!reply.ok) {
    console.error('scan upstream', reply.status, await reply.text().catch(() => ''));
    return res.status(502).json({ error: 'Die Texterkennung ist gerade nicht verfügbar.' });
  }
  const data = await reply.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').replace(/\s+/g, ' ').trim();
  if (!text || text === 'KEIN_TEXT') return res.status(422).json({ error: 'Es wurde kein Text erkannt – näher heran, mehr Licht, gerade fotografieren.' });
  res.json({ text, remaining: Math.max(DAILY_LIMIT - used.count, 0) });
});

module.exports = { router };
