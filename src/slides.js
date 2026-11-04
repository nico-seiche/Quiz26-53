const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const crypto = require('crypto');
const { areFriends, findUser } = require('./friends');
const SlidesSync = require('../public/js/slides-sync.js');

// Folien. Eine Präsentation ist ein JSON-Dokument (siehe cleanDeck),
// Bilder liegen als Zeilen in slide_assets und werden über /api/slides/assets/:id ausgeliefert.
const MAX_SLIDES = 200;
const MAX_ELEMENTS = 300;
const MAX_JSON_BYTES = 1500000;
const MAX_ASSETS_PER_DECK = 100;
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

const isId = (v) => /^\d{1,15}$/.test(String(v));
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v, min, max, dflt) => (Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : dflt);
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
const bool = (v) => v === true;
// Farben: #rgb/#rrggbb/#rrggbbaa oder „auto“ (Kontrastfarbe zum Hintergrund) bzw. „none“ (keine Füllung)
const color = (v, dflt) => (typeof v === 'string' && (/^#[0-9a-f]{3,8}$/i.test(v) || v === 'auto' || v === 'none') ? v : dflt);
const assetUrl = (v) => (typeof v === 'string' && /^\/api\/slides\/assets\/\d{1,15}$/.test(v) ? v : '');
const eid = (v, i) => (typeof v === 'string' && /^[\w-]{1,24}$/.test(v) ? v : `e${i}`);

const MAX_TABLE_ROWS = 30;
const MAX_TABLE_COLS = 10;

function cleanRows(rows) {
  const list = (Array.isArray(rows) ? rows : []).slice(0, MAX_TABLE_ROWS).map((r) => (Array.isArray(r) ? r : []).slice(0, MAX_TABLE_COLS).map((c) => str(c, 500)));
  const cols = Math.max(1, ...list.map((r) => r.length));
  const out = list.map((r) => [...r, ...Array(cols - r.length).fill('')]);
  return out.length ? out : [['']];
}

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
    const out = { type: 'text', ...base, fill: color(e.fill, 'none'), goto: num(e.goto, 0, MAX_SLIDES, 0) | 0 };
    return cleanTextProps(e, out);
  }
  if (e.type === 'table') {
    return {
      type: 'table', ...base, rows: cleanRows(e.rows), header: e.header !== false, zebra: bool(e.zebra),
      size: num(e.size, 8, 120, 24), color: color(e.color, 'auto'), align: pick(e.align, ALIGN, 'left'), font: pick(e.font, FONTS, 'sans'),
      headFill: color(e.headFill, '#4f6cf5'), headColor: color(e.headColor, '#ffffff'), border: color(e.border, '#cbd2ee'),
    };
  }
  if (e.type === 'placeholder') {
    return { type: 'placeholder', ...base, label: str(e.label, 60), radius: num(e.radius, 0, 300, 16) };
  }
  if (e.type === 'shape') {
    const out = {
      type: 'shape', ...base, kind: pick(e.kind, SHAPES, 'rect'),
      fill: color(e.fill, '#4f6cf5'), stroke: color(e.stroke, 'none'), strokeWidth: num(e.strokeWidth, 0, 40, 0), radius: num(e.radius, 0, 300, 0), goto: num(e.goto, 0, MAX_SLIDES, 0) | 0,
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

// Hintergrund: Farbe (String), Farbverlauf { from, to, angle } oder Bild { image, fit, overlay, color }
function cleanBg(bg) {
  if (bg && typeof bg === 'object') {
    const image = assetUrl(bg.image);
    if (image) return { image, fit: pick(bg.fit, ['cover', 'contain'], 'cover'), overlay: num(bg.overlay, -0.9, 0.9, 0), color: color(bg.color, '#ffffff') };
    return { from: color(bg.from, '#ffffff'), to: color(bg.to, '#ffffff'), angle: num(bg.angle, 0, 360, 135) };
  }
  return color(bg, '#ffffff');
}
const hexOnly = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);

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
  // Eigene Farben und Verläufe der Präsentation (für die Auswahl im Editor)
  const palette = (Array.isArray(data.palette) ? data.palette : []).map(hexOnly).filter(Boolean).slice(0, 24);
  const gradients = (Array.isArray(data.gradients) ? data.gradients : []).slice(0, 12)
    .map((g) => (g && typeof g === 'object' && hexOnly(g.from) && hexOnly(g.to) ? { from: hexOnly(g.from), to: hexOnly(g.to), angle: num(g.angle, 0, 360, 135) } : null)).filter(Boolean);
  const out = { v: 1, slides, palette: [...new Set(palette)], gradients };
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

const COLLAB = (deckCol, userParam) => `EXISTS (SELECT 1 FROM quiz.slide_collaborators c WHERE c.deck_id = ${deckCol} AND c.user_id = ${userParam})`;
const PRESENCE_SECONDS = 8;
const notifyDeck = (id) => db.query('SELECT quiz.notify($1)', [`d${id}`]).catch(() => {});

// ---------- öffentlich: Ansehen-Link und Bilder ----------
const validToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(t);

router.get('/shared/:token', async (req, res) => {
  if (!validToken(req.params.token)) return res.status(404).json({ error: 'Dieser Link ist ungültig oder wurde beendet.' });
  const d = await db.one('SELECT id, title, data FROM quiz.slide_decks WHERE share_token = $1', [req.params.token]);
  if (!d) return res.status(404).json({ error: 'Dieser Link ist ungültig oder wurde beendet.' });
  res.set('Cache-Control', 'no-store').json({ id: Number(d.id), title: d.title, data: d.data });
});

// Bilder: Besitzer und Mitbearbeiter, oder mit dem Ansehen-Link (?t=…)
router.get('/assets/:aid', async (req, res) => {
  if (!isId(req.params.aid)) return res.status(404).end();
  const t = validToken(req.query.t) ? req.query.t : null;
  const a = await db.one(`SELECT a.mime, a.data FROM quiz.slide_assets a JOIN quiz.slide_decks d ON d.id = a.deck_id
                          WHERE a.id = $1 AND ((d.share_token IS NOT NULL AND d.share_token = $3) OR d.owner_id = $2 OR ${COLLAB('d.id', '$2')})`,
  [req.params.aid, req.user ? req.user.id : 0, t]);
  if (!a) return res.status(404).end();
  res.set({ 'Content-Type': a.mime, 'Cache-Control': t ? 'public, max-age=3600' : 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).send(a.data);
});

router.use(requireAuth);

// ---------- Zugriff ----------
// Besitzer oder Mitbearbeiter; ownerOnly: nur der Besitzer
async function accessDeck(req, { ownerOnly = false } = {}) {
  if (!isId(req.params.id)) return null;
  const d = await db.one(`
    SELECT d.id, d.owner_id, d.title, d.data, d.rev, d.share_token, d.updated_at, u.username AS owner
    FROM quiz.slide_decks d JOIN quiz.users u ON u.id = d.owner_id
    WHERE d.id = $1 AND (d.owner_id = $2 ${ownerOnly ? '' : `OR ${COLLAB('d.id', '$2')}`})`, [req.params.id, req.user.id]);
  if (d) { d.id = Number(d.id); d.owner_id = Number(d.owner_id); d.isOwner = d.owner_id === req.user.id; }
  return d;
}
const notFound = (res) => res.status(404).json({ error: 'Präsentation nicht gefunden' });

const listRow = (r) => ({ id: Number(r.id), title: r.title, updatedAt: r.updated_at, slides: r.slides, first: r.first, owner: r.owner });

router.get('/', async (req, res) => {
  const rows = await db.query(`
    SELECT d.id, d.title, d.updated_at, jsonb_array_length(d.data->'slides') AS slides, d.data->'slides'->0 AS first, u.username AS owner, (d.owner_id = $1) AS mine
    FROM quiz.slide_decks d JOIN quiz.users u ON u.id = d.owner_id
    WHERE d.owner_id = $1 OR ${COLLAB('d.id', '$1')} ORDER BY d.updated_at DESC`, [req.user.id]);
  res.json({ mine: rows.filter((r) => r.mine).map(listRow), shared: rows.filter((r) => !r.mine).map(listRow) });
});

router.post('/', async (req, res) => {
  const row = await db.one('INSERT INTO quiz.slide_decks (owner_id, title, data) VALUES ($1, $2, $3) RETURNING id',
    [req.user.id, cleanTitle(req.body.title), JSON.stringify(cleanDeck(blankDeck()))]);
  res.json({ id: Number(row.id) });
});

async function people(deckId) {
  return (await db.query(`SELECT u.username FROM quiz.slide_collaborators c JOIN quiz.users u ON u.id = c.user_id WHERE c.deck_id = $1 ORDER BY lower(u.username)`, [deckId])).map((r) => r.username);
}

router.get('/:id', async (req, res) => {
  const d = await accessDeck(req);
  if (!d) return notFound(res);
  res.json({
    id: d.id, title: d.title, data: d.data, rev: d.rev, updatedAt: d.updated_at,
    isOwner: d.isOwner, owner: d.owner, collaborators: await people(d.id), shareToken: d.isOwner ? d.share_token : null,
  });
});

// ---------- gemeinsames Bearbeiten ----------
// Änderungen als Operationen (siehe public/js/slides-sync.js): werden unter Zeilensperre auf den aktuellen Stand angewendet,
// dadurch gehen gleichzeitige Änderungen anderer nicht verloren. Antwort: der neue Gesamtstand.
router.post('/:id/ops', async (req, res) => {
  const ops = req.body && req.body.ops;
  if (!Array.isArray(ops) || ops.length > 3000) return res.status(400).json({ error: 'Ungültige Änderungen' });
  const probe = await accessDeck(req);
  if (!probe) return notFound(res);
  let result;
  try {
    result = await db.tx(async (client) => {
      const { rows: [d] } = await client.query('SELECT title, data FROM quiz.slide_decks WHERE id = $1 FOR UPDATE', [probe.id]);
      const doc = { title: d.title, slides: d.data.slides, palette: d.data.palette || [], gradients: d.data.gradients || [] };
      SlidesSync.apply(doc, ops);
      if (!doc.slides.length) doc.slides.push(blankDeck().slides[0]);      // alle Folien gleichzeitig gelöscht: eine leere bleibt
      const data = cleanDeck({ slides: doc.slides, palette: doc.palette, gradients: doc.gradients });
      const title = cleanTitle(doc.title);
      const { rows: [row] } = await client.query('UPDATE quiz.slide_decks SET title = $1, data = $2, rev = rev + 1, updated_at = now() WHERE id = $3 RETURNING rev',
        [title, JSON.stringify(data), probe.id]);
      return { rev: row.rev, title, data };
    });
  } catch (err) { return res.status(400).json({ error: err.message || 'Änderungen konnten nicht gespeichert werden' }); }
  await notifyDeck(probe.id);
  res.json(result);
});

// Alle paar Sekunden (und bei Realtime-Hinweis): Anwesenheit melden und prüfen, ob es einen neuen Stand gibt
router.get('/:id/live', async (req, res) => {
  const d = await accessDeck(req);
  if (!d) return notFound(res);
  const slideId = typeof req.query.slide === 'string' ? req.query.slide.slice(0, 24) : null;
  const elId = typeof req.query.el === 'string' && req.query.el ? req.query.el.slice(0, 24) : null;
  await db.query(`INSERT INTO quiz.slide_presence (deck_id, user_id, slide_id, element_id, seen_at) VALUES ($1, $2, $3, $4, now())
                  ON CONFLICT (deck_id, user_id) DO UPDATE SET slide_id = $3, element_id = $4, seen_at = now()`, [d.id, req.user.id, slideId, elId]);
  const presence = await db.query(`
    SELECT u.username, p.slide_id, p.element_id, (p.user_id = $2) AS me FROM quiz.slide_presence p JOIN quiz.users u ON u.id = p.user_id
    WHERE p.deck_id = $1 AND p.seen_at > now() - make_interval(secs => $3) ORDER BY lower(u.username)`, [d.id, req.user.id, PRESENCE_SECONDS]);
  const out = { rev: d.rev, presence: presence.map((p) => ({ username: p.username, slide: p.slide_id, el: p.element_id, me: p.me })) };
  if (Number(req.query.rev) !== d.rev) { out.title = d.title; out.data = d.data; }
  res.json(out);
});

router.delete('/:id', async (req, res) => {
  const d = await accessDeck(req, { ownerOnly: true });
  if (!d) return notFound(res);
  await db.query('DELETE FROM quiz.slide_decks WHERE id = $1', [d.id]);
  res.json({ ok: true });
});

router.post('/:id/duplicate', async (req, res) => {
  const d = await accessDeck(req);
  if (!d) return notFound(res);
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
  const d = await accessDeck(req);
  if (!d) return notFound(res);
  const mime = String(req.headers['content-type'] || '').split(';')[0];
  if (!ASSET_TYPES.includes(mime) || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Nur Bilder (JPEG, PNG, WebP, GIF)' });
  if (req.body.length > MAX_ASSET_BYTES) return res.status(413).json({ error: 'Das Bild ist zu groß' });
  const { n } = await db.one('SELECT COUNT(*)::int AS n FROM quiz.slide_assets WHERE deck_id = $1', [d.id]);
  if (n >= MAX_ASSETS_PER_DECK) return res.status(400).json({ error: `Höchstens ${MAX_ASSETS_PER_DECK} Bilder pro Präsentation` });
  const row = await db.one('INSERT INTO quiz.slide_assets (deck_id, mime, data) VALUES ($1, $2, $3) RETURNING id', [d.id, mime, req.body]);
  res.json({ id: Number(row.id), url: `/api/slides/assets/${row.id}` });
});

// ---------- Teilen ----------
// Mitbearbeiter einladen (nur Freunde), wie bei Quiz und Lernsets
router.post('/:id/collaborators', async (req, res) => {
  const d = await accessDeck(req, { ownerOnly: true });
  if (!d) return notFound(res);
  const input = String(req.body.username || '').trim();
  if (!input) return res.status(400).json({ error: 'Nutzername oder #ID fehlt' });
  const user = await findUser(input);
  if (!user) return res.status(404).json({ error: `Spieler „${input}“ nicht gefunden.` });
  if (Number(user.id) === req.user.id) return res.status(400).json({ error: 'Die Präsentation gehört dir bereits.' });
  if (!(await areFriends(req.user.id, user.id))) return res.status(403).json({ error: `${user.username} ist noch nicht dein Freund. Schicke zuerst unter Profil → Freunde eine Anfrage.` });
  await db.query('INSERT INTO quiz.slide_collaborators (deck_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [d.id, user.id]);
  await notifyDeck(d.id);
  res.json({ username: user.username });
});

// Entfernen: der Besitzer jeden, ein Mitbearbeiter sich selbst
router.delete('/:id/collaborators/:username', async (req, res) => {
  const d = await accessDeck(req);
  if (!d) return notFound(res);
  const user = await db.one('SELECT id FROM quiz.users WHERE lower(username) = lower($1)', [String(req.params.username).normalize('NFC')]);
  if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden' });
  if (!d.isOwner && Number(user.id) !== req.user.id) return res.status(403).json({ error: 'Nur der Besitzer kann andere entfernen' });
  await db.query('DELETE FROM quiz.slide_collaborators WHERE deck_id = $1 AND user_id = $2', [d.id, user.id]);
  await db.query('DELETE FROM quiz.slide_presence WHERE deck_id = $1 AND user_id = $2', [d.id, user.id]);
  await notifyDeck(d.id);
  res.json({ ok: true });
});

// Link zum Ansehen (ohne Anmeldung, nur lesen): ein-/ausschalten oder neu erzeugen
router.post('/:id/share', async (req, res) => {
  const d = await accessDeck(req, { ownerOnly: true });
  if (!d) return notFound(res);
  const enabled = req.body.enabled !== false;
  const token = enabled ? (req.body.renew || !d.share_token ? crypto.randomBytes(18).toString('base64url') : d.share_token) : null;
  await db.query('UPDATE quiz.slide_decks SET share_token = $1 WHERE id = $2', [token, d.id]);
  res.json({ token });
});

module.exports = { router, cleanDeck };
