const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

// Dokumente (Word-Alternative). Der Text ist ein Quill-Delta: Liste von { insert, attributes }. Jedes Delta wird beim Speichern
// streng gegen eine Positivliste geprüft (erlaubte Formate, nur eigene Bild-URLs, Handschrift-Blöcke mit Zahlen), damit nichts
// Gefährliches gespeichert wird.
const MAX_JSON_BYTES = 1800000;
const MAX_OPS = 30000;
const MAX_ASSETS_PER_DOC = 100;
const MAX_ASSET_BYTES = 1500000;
const ASSET_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_STROKES = 3000;
const MAX_POINTS = 120000;

const router = express.Router();
router.use(requireAuth);

const isId = (v) => /^\d{1,15}$/.test(String(v));
const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : null);
const num = (v, min, max, d) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const SIZES = ['10px', '12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '40px'];
const FONTS = ['sans', 'serif', 'mono'];
const ASSET_URL = /^\/api\/docs\/assets\/\d{1,15}$/;
const LINK = /^(https?:\/\/|mailto:)[^\s"'<>]{1,500}$/i;

function cleanAttributes(a) {
  if (!a || typeof a !== 'object') return undefined;
  const out = {};
  for (const k of ['bold', 'italic', 'underline', 'strike', 'blockquote']) if (a[k] === true) out[k] = true;
  if (a['code-block']) out['code-block'] = 'plain';
  for (const k of ['color', 'background']) { const h = hex(a[k]); if (h) out[k] = h; }
  if (FONTS.includes(a.font)) out.font = a.font;
  if (SIZES.includes(a.size)) out.size = a.size;
  if (a.script === 'sub' || a.script === 'super') out.script = a.script;
  if ([1, 2, 3].includes(a.header)) out.header = a.header;
  if (['ordered', 'bullet', 'checked', 'unchecked'].includes(a.list)) out.list = a.list;
  if (Number.isInteger(a.indent) && a.indent >= 1 && a.indent <= 8) out.indent = a.indent;
  if (['center', 'right', 'justify'].includes(a.align)) out.align = a.align;
  if (typeof a.link === 'string' && LINK.test(a.link)) out.link = a.link;
  if (typeof a.table === 'string' && /^[\w-]{1,40}$/.test(a.table)) out.table = a.table;
  return Object.keys(out).length ? out : undefined;
}

function cleanInk(v) {
  if (!v || typeof v !== 'object') return null;
  const strokes = [];
  let points = 0;
  for (const s of (Array.isArray(v.strokes) ? v.strokes : []).slice(0, MAX_STROKES)) {
    if (!s || !Array.isArray(s.p)) continue;
    const p = [];
    for (const pt of s.p) {
      if (!Array.isArray(pt) || pt.length < 2 || points >= MAX_POINTS) continue;
      p.push([Math.round(num(pt[0], -50, 1050, 0) * 10) / 10, Math.round(num(pt[1], -50, 5000, 0) * 10) / 10, Math.round(num(pt[2], 0, 1, 0.5) * 100) / 100]);
      points += 1;
    }
    if (p.length) strokes.push({ c: hex(s.c) || '#1b1d3a', w: num(s.w, 0.5, 40, 3), p });
  }
  return { h: Math.round(num(v.h, 120, 2000, 360)), strokes };
}

function cleanDelta(ops) {
  if (!Array.isArray(ops) || ops.length > MAX_OPS) throw new Error('Ungültiges Dokument');
  const out = [];
  for (const op of ops) {
    if (!op || typeof op !== 'object') continue;
    const attributes = cleanAttributes(op.attributes);
    let insert = op.insert;
    if (typeof insert === 'string') {
      if (!insert) continue;
      insert = insert.slice(0, 200000);
    } else if (insert && typeof insert === 'object') {
      if (typeof insert.image === 'string' && ASSET_URL.test(insert.image)) insert = { image: insert.image };
      else if (insert.ink) { const ink = cleanInk(insert.ink); if (!ink) continue; insert = { ink }; }
      else continue;
    } else continue;
    out.push(attributes ? { insert, attributes } : { insert });
  }
  if (!out.length || typeof out[out.length - 1].insert !== 'string' || !out[out.length - 1].insert.endsWith('\n')) out.push({ insert: '\n' });   // Quill-Dokumente enden immer mit einem Zeilenumbruch
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_JSON_BYTES) throw new Error('Das Dokument ist zu groß (zu viele Handschrift-Striche oder zu viel Text)');
  return out;
}

const previewOf = (delta) => delta.filter((o) => typeof o.insert === 'string').map((o) => o.insert).join('').replace(/\s+/g, ' ').trim().slice(0, 200);
const cleanTitle = (t) => (typeof t === 'string' ? t.slice(0, 120).trim() : '') || 'Neues Dokument';

router.get('/', async (req, res) => {
  const rows = await db.query('SELECT id, title, preview, updated_at FROM quiz.docs WHERE owner_id = $1 ORDER BY updated_at DESC', [req.user.id]);
  res.json(rows.map((r) => ({ id: Number(r.id), title: r.title, preview: r.preview, updatedAt: r.updated_at })));
});

router.post('/', async (req, res) => {
  const row = await db.one('INSERT INTO quiz.docs (owner_id, title, delta) VALUES ($1, $2, $3) RETURNING id', [req.user.id, cleanTitle(req.body.title), JSON.stringify([{ insert: '\n' }])]);
  res.json({ id: Number(row.id) });
});

router.get('/assets/:aid', async (req, res) => {
  if (!isId(req.params.aid)) return res.status(404).end();
  const a = await db.one('SELECT a.mime, a.data FROM quiz.doc_assets a JOIN quiz.docs d ON d.id = a.doc_id WHERE a.id = $1 AND d.owner_id = $2', [req.params.aid, req.user.id]);
  if (!a) return res.status(404).end();
  res.set({ 'Content-Type': a.mime, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(a.data);
});

const own = (req) => (isId(req.params.id) ? db.one('SELECT id, title, delta, rev FROM quiz.docs WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]) : null);

router.get('/:id', async (req, res) => {
  const d = await own(req);
  if (!d) return res.status(404).json({ error: 'Dokument nicht gefunden' });
  res.json({ id: Number(d.id), title: d.title, delta: d.delta, rev: d.rev });
});

// Speichern; rev schützt davor, dass ein zweiter Tab/Gerät unbemerkt überschrieben wird
router.put('/:id', async (req, res) => {
  const d = await own(req);
  if (!d) return res.status(404).json({ error: 'Dokument nicht gefunden' });
  let delta;
  try { delta = cleanDelta(req.body.delta); } catch (err) { return res.status(400).json({ error: err.message }); }
  const row = await db.one(`UPDATE quiz.docs SET title = $1, delta = $2, preview = $3, rev = rev + 1, updated_at = now()
                            WHERE id = $4 AND owner_id = $5 AND rev = $6 RETURNING rev`,
  [cleanTitle(req.body.title), JSON.stringify(delta), previewOf(delta), d.id, req.user.id, Number(req.body.rev)]);
  if (!row) return res.status(409).json({ error: 'Das Dokument wurde woanders geändert – bitte neu laden.' });
  res.json({ rev: row.rev });
});

router.delete('/:id', async (req, res) => {
  const d = await own(req);
  if (!d) return res.status(404).json({ error: 'Dokument nicht gefunden' });
  await db.query('DELETE FROM quiz.docs WHERE id = $1', [d.id]);
  res.json({ ok: true });
});

router.post('/:id/duplicate', async (req, res) => {
  const d = await own(req);
  if (!d) return res.status(404).json({ error: 'Dokument nicht gefunden' });
  const id = await db.tx(async (client) => {
    const { rows: [n] } = await client.query('INSERT INTO quiz.docs (owner_id, title, delta, preview) SELECT owner_id, $2, delta, preview FROM quiz.docs WHERE id = $1 RETURNING id', [d.id, `${d.title} (Kopie)`.slice(0, 120)]);
    let json = JSON.stringify(d.delta);
    const { rows: assets } = await client.query('SELECT id, mime, data FROM quiz.doc_assets WHERE doc_id = $1', [d.id]);
    for (const a of assets) {
      const { rows: [c] } = await client.query('INSERT INTO quiz.doc_assets (doc_id, mime, data) VALUES ($1, $2, $3) RETURNING id', [n.id, a.mime, a.data]);
      json = json.split(`/api/docs/assets/${a.id}"`).join(`/api/docs/assets/@${c.id}"`);
    }
    json = json.replace(/\/api\/docs\/assets\/@/g, '/api/docs/assets/');
    await client.query('UPDATE quiz.docs SET delta = $1 WHERE id = $2', [json, n.id]);
    return Number(n.id);
  });
  res.json({ id });
});

// Bilder: roher Upload (Content-Type = Bildtyp), siehe express.raw in app.js
router.post('/:id/assets', async (req, res) => {
  const d = await own(req);
  if (!d) return res.status(404).json({ error: 'Dokument nicht gefunden' });
  const mime = String(req.headers['content-type'] || '').split(';')[0];
  if (!ASSET_TYPES.includes(mime) || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Nur Bilder (JPEG, PNG, WebP, GIF)' });
  if (req.body.length > MAX_ASSET_BYTES) return res.status(413).json({ error: 'Das Bild ist zu groß' });
  const { n } = await db.one('SELECT COUNT(*)::int AS n FROM quiz.doc_assets WHERE doc_id = $1', [d.id]);
  if (n >= MAX_ASSETS_PER_DOC) return res.status(400).json({ error: `Höchstens ${MAX_ASSETS_PER_DOC} Bilder pro Dokument` });
  const row = await db.one('INSERT INTO quiz.doc_assets (doc_id, mime, data) VALUES ($1, $2, $3) RETURNING id', [d.id, mime, req.body]);
  res.json({ id: Number(row.id), url: `/api/docs/assets/${row.id}` });
});

module.exports = { router, cleanDelta };
