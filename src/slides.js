const express = require('express');
const db = require('./db');
const { experimentalOnly } = require('./experimental');

// Folien (experimentell, nur für freigeschaltete Nutzer). Eine Präsentation ist ein JSON-Dokument (siehe cleanDeck),
// Bilder liegen als Zeilen in slide_assets und werden über /api/slides/assets/:id ausgeliefert.
const MAX_SLIDES = 200;
const MAX_ELEMENTS = 300;
const MAX_JSON_BYTES = 1500000;
const MAX_ASSETS_PER_DECK = 40;
const MAX_ASSET_BYTES = 1500000;
const ASSET_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const FONTS = ['sans', 'serif', 'mono', 'display'];
const ALIGN = ['left', 'center', 'right'];
const VALIGN = ['top', 'middle', 'bottom'];
const LISTS = ['none', 'bullet', 'number'];
const SHAPES = ['rect', 'ellipse', 'triangle'];
const FITS = ['contain', 'cover'];
const TRANSITIONS = ['none', 'fade', 'slide'];

const router = express.Router();
router.use(experimentalOnly('slides'));

const isId = (v) => /^\d{1,15}$/.test(String(v));
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, min, max, dflt) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dflt);
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
const bool = (v) => v === true;
// Farben: #rgb/#rrggbb/#rrggbbaa oder „auto“ (Kontrastfarbe zum Hintergrund) bzw. „none“ (keine Füllung)
const color = (v, dflt) => (typeof v === 'string' && (/^#[0-9a-f]{3,8}$/i.test(v) || v === 'auto' || v === 'none') ? v : dflt);
const assetUrl = (v) => (typeof v === 'string' && /^\/api\/slides\/assets\/\d{1,15}$/.test(v) ? v : '');
const eid = (v, i) => (typeof v === 'string' && /^[\w-]{1,24}$/.test(v) ? v : `e${i}`);

function cleanTextProps(e, out) {
  out.text = str(e.text, 5000);
  out.size = num(e.size, 8, 240, 32);
  out.color = color(e.color, 'auto');
  out.bold = bool(e.bold);
  out.italic = bool(e.italic);
  out.underline = bool(e.underline);
  out.align = pick(e.align, ALIGN, 'left');
  out.valign = pick(e.valign, VALIGN, 'top');
  out.font = pick(e.font, FONTS, 'sans');
  out.list = pick(e.list, LISTS, 'none');
  return out;
}

function cleanElement(e, i) {
  if (!e || typeof e !== 'object') return null;
  const base = {
    id: eid(e.id, i),
    x: num(e.x, -2000, 3000, 0), y: num(e.y, -2000, 3000, 0),
    w: num(e.w, 4, 3000, 100), h: num(e.h, 4, 3000, 60),
    opacity: num(e.opacity, 0, 1, 1),
  };
  if (e.type === 'text') {
    const out = { type: 'text', ...base, fill: color(e.fill, 'none') };
    return cleanTextProps(e, out);
  }
  if (e.type === 'shape') {
    const out = {
      type: 'shape', ...base, kind: pick(e.kind, SHAPES, 'rect'),
      fill: color(e.fill, '#4f6cf5'), stroke: color(e.stroke, 'none'), strokeWidth: num(e.strokeWidth, 0, 40, 0), radius: num(e.radius, 0, 300, 0),
    };
    return cleanTextProps(e, out);
  }
  if (e.type === 'image') {
    const src = assetUrl(e.src);
    if (!src) return null;
    return { type: 'image', ...base, src, fit: pick(e.fit, FITS, 'contain'), radius: num(e.radius, 0, 300, 0) };
  }
  return null;
}

function cleanBg(bg) {
  if (bg && typeof bg === 'object') return { from: color(bg.from, '#ffffff'), to: color(bg.to, '#ffffff'), angle: num(bg.angle, 0, 360, 135) };
  return color(bg, '#ffffff');
}

function cleanDeck(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.slides)) throw new Error('Ungültige Präsentation');
  if (data.slides.length < 1) throw new Error('Mindestens eine Folie nötig');
  if (data.slides.length > MAX_SLIDES) throw new Error(`Höchstens ${MAX_SLIDES} Folien`);
  const slides = data.slides.map((s, i) => {
    const src = s && typeof s === 'object' ? s : {};
    const list = Array.isArray(src.elements) ? src.elements : [];
    if (list.length > MAX_ELEMENTS) throw new Error(`Höchstens ${MAX_ELEMENTS} Elemente pro Folie`);
    return {
      id: typeof src.id === 'string' && /^[\w-]{1,24}$/.test(src.id) ? src.id : `s${i}`,
      bg: cleanBg(src.bg),
      notes: str(src.notes, 5000),
      transition: pick(src.transition, TRANSITIONS, 'fade'),
      elements: list.map(cleanElement).filter(Boolean),
    };
  });
  const out = { v: 1, slides };
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_JSON_BYTES) throw new Error('Die Präsentation ist zu groß');
  return out;
}

const cleanTitle = (t) => str(t, 120).trim() || 'Neue Präsentation';

const blankDeck = () => ({
  v: 1,
  slides: [{
    id: 's1', bg: '#ffffff', notes: '', transition: 'fade',
    elements: [
      { type: 'text', id: 'e1', x: 140, y: 240, w: 1000, h: 130, text: 'Titel der Präsentation', size: 72, bold: true, align: 'center', valign: 'middle', color: 'auto', font: 'sans' },
      { type: 'text', id: 'e2', x: 240, y: 390, w: 800, h: 70, text: 'Untertitel oder Name', size: 32, align: 'center', valign: 'top', color: '#667085', font: 'sans' },
    ],
  }],
});

router.get('/', async (req, res) => {
  const rows = await db.query(`
    SELECT id, title, updated_at, jsonb_array_length(data->'slides') AS slides, data->'slides'->0 AS first
    FROM quiz.slide_decks WHERE owner_id = $1 ORDER BY updated_at DESC`, [req.user.id]);
  res.json(rows.map((r) => ({ id: Number(r.id), title: r.title, updatedAt: r.updated_at, slides: r.slides, first: r.first })));
});

router.post('/', async (req, res) => {
  const row = await db.one('INSERT INTO quiz.slide_decks (owner_id, title, data) VALUES ($1, $2, $3) RETURNING id',
    [req.user.id, cleanTitle(req.body.title), JSON.stringify(cleanDeck(blankDeck()))]);
  res.json({ id: Number(row.id) });
});

// Bilder: roher Upload (Content-Type = Bildtyp), siehe express.raw in app.js
router.get('/assets/:aid', async (req, res) => {
  if (!isId(req.params.aid)) return res.status(404).end();
  const a = await db.one(`SELECT a.mime, a.data FROM quiz.slide_assets a JOIN quiz.slide_decks d ON d.id = a.deck_id
                          WHERE a.id = $1 AND d.owner_id = $2`, [req.params.aid, req.user.id]);
  if (!a) return res.status(404).end();
  res.set({ 'Content-Type': a.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(a.data);
});

async function ownDeck(req) {
  if (!isId(req.params.id)) return null;
  return db.one('SELECT id, owner_id, title, data, rev, updated_at FROM quiz.slide_decks WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
}

router.get('/:id', async (req, res) => {
  const d = await ownDeck(req);
  if (!d) return res.status(404).json({ error: 'Präsentation nicht gefunden' });
  res.json({ id: Number(d.id), title: d.title, data: d.data, rev: d.rev, updatedAt: d.updated_at });
});

// Speichern; rev schützt davor, dass ein zweiter Tab/Gerät unbemerkt überschrieben wird
router.put('/:id', async (req, res) => {
  const d = await ownDeck(req);
  if (!d) return res.status(404).json({ error: 'Präsentation nicht gefunden' });
  let data;
  try { data = cleanDeck(req.body.data); } catch (err) { return res.status(400).json({ error: err.message }); }
  const row = await db.one(`
    UPDATE quiz.slide_decks SET title = $1, data = $2, rev = rev + 1, updated_at = now()
    WHERE id = $3 AND owner_id = $4 AND rev = $5 RETURNING rev`,
  [cleanTitle(req.body.title), JSON.stringify(data), d.id, req.user.id, Number(req.body.rev)]);
  if (!row) return res.status(409).json({ error: 'Die Präsentation wurde woanders geändert – bitte neu laden.' });
  res.json({ rev: row.rev });
});

router.delete('/:id', async (req, res) => {
  const d = await ownDeck(req);
  if (!d) return res.status(404).json({ error: 'Präsentation nicht gefunden' });
  await db.query('DELETE FROM quiz.slide_decks WHERE id = $1', [d.id]);
  res.json({ ok: true });
});

router.post('/:id/duplicate', async (req, res) => {
  const d = await ownDeck(req);
  if (!d) return res.status(404).json({ error: 'Präsentation nicht gefunden' });
  const id = await db.tx(async (client) => {
    const { rows: [n] } = await client.query('INSERT INTO quiz.slide_decks (owner_id, title, data) VALUES ($1, $2, $3) RETURNING id', [req.user.id, `${d.title} (Kopie)`.slice(0, 120), JSON.stringify(d.data)]);
    // Bilder mitkopieren und die Verweise im Dokument umschreiben
    const { rows: assets } = await client.query('SELECT id, mime, data FROM quiz.slide_assets WHERE deck_id = $1', [d.id]);
    let json = JSON.stringify(d.data);
    for (const a of assets) {
      const { rows: [c] } = await client.query('INSERT INTO quiz.slide_assets (deck_id, mime, data) VALUES ($1, $2, $3) RETURNING id', [n.id, a.mime, a.data]);
      json = json.split(`/api/slides/assets/${a.id}"`).join(`/api/slides/assets/@${c.id}"`);   // „@“ verhindert, dass eine neue ID später nochmal ersetzt wird
    }
    json = json.replace(/\/api\/slides\/assets\/@/g, '/api/slides/assets/');
    await client.query('UPDATE quiz.slide_decks SET data = $1 WHERE id = $2', [json, n.id]);
    return Number(n.id);
  });
  res.json({ id });
});

router.post('/:id/assets', async (req, res) => {
  const d = await ownDeck(req);
  if (!d) return res.status(404).json({ error: 'Präsentation nicht gefunden' });
  const mime = String(req.headers['content-type'] || '').split(';')[0];
  if (!ASSET_TYPES.includes(mime) || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Nur Bilder (JPEG, PNG, WebP, GIF)' });
  if (req.body.length > MAX_ASSET_BYTES) return res.status(413).json({ error: 'Das Bild ist zu groß' });
  const { n } = await db.one('SELECT COUNT(*)::int AS n FROM quiz.slide_assets WHERE deck_id = $1', [d.id]);
  if (n >= MAX_ASSETS_PER_DECK) return res.status(400).json({ error: `Höchstens ${MAX_ASSETS_PER_DECK} Bilder pro Präsentation` });
  const row = await db.one('INSERT INTO quiz.slide_assets (deck_id, mime, data) VALUES ($1, $2, $3) RETURNING id', [d.id, mime, req.body]);
  res.json({ id: Number(row.id), url: `/api/slides/assets/${row.id}` });
});

module.exports = { router, cleanDeck };
