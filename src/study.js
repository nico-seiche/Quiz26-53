const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');

const router = express.Router();
router.use(requireAuth);

const MAX_CARDS = 300;
// Leitner-Boxen: nach wie vielen Tagen eine Karte in Box 0–4 wieder fällig wird (Box 0 = sofort)
const BOX_DAYS = [0, 1, 3, 7, 21];
const MASTERED_BOX = 3;

// Lernpunkte je Lernart: Höchstpunkte pro Karte, bei Lückentext/Aus dem Kopf/Tippen anteilig nach Richtigkeit.
// Karteikarten sind Selbsteinschätzung: gewusst 5, nicht gewusst 1 (fürs Üben).
const LEARN_MAX = { cards: 5, cloze: 10, free: 15, type: 15 };
// Je Karte und Tag zählen höchstens so viele Wiederholungen (verhindert Punkte-Farmen an einer Karte)
const LEARN_PER_CARD_PER_DAY = 3;
const DAY = "(created_at AT TIME ZONE 'Europe/Berlin')::date";
const TODAY = "(now() AT TIME ZONE 'Europe/Berlin')::date";

const isId = (id) => /^\d+$/.test(String(id));

// Prüft Titel, Fach und Karten aus dem Request; liefert die bereinigten Daten oder wirft einen Fehlertext
async function readBody(body) {
  const title = String(body.title || '').trim();
  if (!title) throw 'Titel fehlt';
  if (title.length > 100) throw 'Titel ist zu lang (höchstens 100 Zeichen)';
  const subjectId = Number(body.subjectId);
  if (!Number.isInteger(subjectId) || !(await db.one('SELECT id FROM quiz.subjects WHERE id = $1', [subjectId]))) {
    throw 'Bitte ein Fach auswählen';
  }
  if (!Array.isArray(body.cards)) throw 'Karten fehlen';
  if (body.cards.length > MAX_CARDS) throw `Höchstens ${MAX_CARDS} Karten pro Set`;
  const cards = body.cards.map((c, i) => {
    const term = String(c.term || '').trim();
    const definition = String(c.definition || '').replace(/\s+/g, ' ').trim();
    if (!term) throw `Karte ${i + 1}: Begriff fehlt`;
    if (!definition) throw `Karte ${i + 1}: Definition fehlt`;
    if (term.length > 200) throw `Karte ${i + 1}: Begriff ist zu lang`;
    if (definition.length > 4000) throw `Karte ${i + 1}: Definition ist zu lang`;
    return { id: isId(c.id) ? Number(c.id) : null, term, definition };
  });
  return { title, subjectId, isPublic: Boolean(body.isPublic), cards };
}

// Lernset laden, wenn es dem Nutzer gehört oder öffentlich ist
async function loadSet(id, userId) {
  if (!isId(id)) return null;
  const set = await db.one(`
    SELECT st.id, st.owner_id, st.title, st.subject_id, st.is_public, u.username AS owner,
           s.name AS subject, s.icon AS subject_icon
    FROM quiz.study_sets st
    JOIN quiz.users u ON u.id = st.owner_id
    LEFT JOIN quiz.subjects s ON s.id = st.subject_id
    WHERE st.id = $1 AND (st.owner_id = $2 OR st.is_public)
  `, [id, userId]);
  if (!set) return null;
  set.id = Number(set.id);
  set.owner_id = Number(set.owner_id);
  return set;
}

router.get('/', async (req, res) => {
  const rows = await db.query(`
    SELECT st.id, st.owner_id, st.title, st.is_public, st.updated_at, u.username AS owner,
           s.name AS subject, s.icon AS subject_icon,
           COUNT(c.id)::int AS card_count,
           COUNT(c.id) FILTER (WHERE p.card_id IS NULL OR p.due_at <= now())::int AS due_count,
           COUNT(c.id) FILTER (WHERE p.box >= $2)::int AS mastered_count
    FROM quiz.study_sets st
    JOIN quiz.users u ON u.id = st.owner_id
    LEFT JOIN quiz.subjects s ON s.id = st.subject_id
    LEFT JOIN quiz.study_cards c ON c.set_id = st.id
    LEFT JOIN quiz.card_progress p ON p.card_id = c.id AND p.user_id = $1
    WHERE st.owner_id = $1 OR st.is_public
    GROUP BY st.id, u.username, s.name, s.icon
    ORDER BY st.updated_at DESC
  `, [req.user.id, MASTERED_BOX]);
  const sets = rows.map((r) => ({ ...r, id: Number(r.id), mine: Number(r.owner_id) === req.user.id }));
  res.json({ mine: sets.filter((s) => s.mine), shared: sets.filter((s) => !s.mine) });
});

async function saveCards(client, setId, cards) {
  const keep = cards.filter((c) => c.id).map((c) => c.id);
  // Nur Karten dieses Sets behalten/ändern, damit fremde IDs nichts bewirken
  await client.query('DELETE FROM quiz.study_cards WHERE set_id = $1 AND NOT (id = ANY($2::bigint[]))', [setId, keep]);
  const existing = new Set((await client.query('SELECT id FROM quiz.study_cards WHERE set_id = $1', [setId]))
    .rows.map((r) => Number(r.id)));
  for (const [i, c] of cards.entries()) {
    if (c.id && existing.has(c.id)) {
      await client.query('UPDATE quiz.study_cards SET position = $1, term = $2, definition = $3 WHERE id = $4',
        [i, c.term, c.definition, c.id]);
    } else {
      await client.query('INSERT INTO quiz.study_cards (set_id, position, term, definition) VALUES ($1, $2, $3, $4)',
        [setId, i, c.term, c.definition]);
    }
  }
}

router.post('/', async (req, res) => {
  let body;
  try { body = await readBody(req.body); } catch (msg) { return res.status(400).json({ error: String(msg) }); }
  const id = await db.tx(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO quiz.study_sets (owner_id, title, subject_id, is_public) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.user.id, body.title, body.subjectId, body.isPublic],
    );
    await saveCards(client, rows[0].id, body.cards.map((c) => ({ ...c, id: null })));
    return Number(rows[0].id);
  });
  res.json({ id });
});

// Übersicht der eigenen Lernpunkte (Profil)
router.get('/stats', async (req, res) => {
  const [total, byMode, days] = await Promise.all([
    db.one(`SELECT COALESCE(SUM(points), 0)::int AS total, COUNT(*)::int AS reviews,
              COALESCE(SUM(points) FILTER (WHERE ${DAY} = ${TODAY}), 0)::int AS today,
              COALESCE(SUM(points) FILTER (WHERE ${DAY} > ${TODAY} - 7), 0)::int AS week
            FROM quiz.learn_events WHERE user_id = $1`, [req.user.id]),
    db.query('SELECT mode, SUM(points)::int AS points, COUNT(*)::int AS reviews FROM quiz.learn_events WHERE user_id = $1 GROUP BY mode ORDER BY SUM(points) DESC', [req.user.id]),
    db.query(`SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COALESCE(SUM(e.points), 0)::int AS points
              FROM generate_series(${TODAY} - 6, ${TODAY}, interval '1 day') AS d(day)
              LEFT JOIN quiz.learn_events e ON e.user_id = $1 AND ${DAY.replace('created_at', 'e.created_at')} = d.day::date
              GROUP BY d.day ORDER BY d.day`, [req.user.id]),
  ]);
  res.json({ ...total, byMode, days });
});

// Kartenreihenfolge ist fest; Fortschritt (box, fällig) gehört dem jeweiligen Nutzer
router.get('/:id', async (req, res) => {
  const set = await loadSet(req.params.id, req.user.id);
  if (!set) return res.status(404).json({ error: 'Lernset nicht gefunden' });
  const cards = await db.query(`
    SELECT c.id, c.term, c.definition, COALESCE(p.box, 0) AS box, (p.card_id IS NULL OR p.due_at <= now()) AS due,
           COALESCE(p.reviews, 0) AS reviews
    FROM quiz.study_cards c
    LEFT JOIN quiz.card_progress p ON p.card_id = c.id AND p.user_id = $2
    WHERE c.set_id = $1 ORDER BY c.position, c.id
  `, [set.id, req.user.id]);
  res.json({
    id: set.id, title: set.title, subjectId: set.subject_id, subject: set.subject, subjectIcon: set.subject_icon,
    isPublic: set.is_public, owner: set.owner, canEdit: set.owner_id === req.user.id,
    masteredBox: MASTERED_BOX,
    cards: cards.map((c) => ({ ...c, id: Number(c.id), box: Number(c.box) })),
  });
});

router.put('/:id', async (req, res) => {
  const set = await loadSet(req.params.id, req.user.id);
  if (!set || set.owner_id !== req.user.id) return res.status(404).json({ error: 'Lernset nicht gefunden' });
  let body;
  try { body = await readBody(req.body); } catch (msg) { return res.status(400).json({ error: String(msg) }); }
  await db.tx(async (client) => {
    await client.query(
      'UPDATE quiz.study_sets SET title = $1, subject_id = $2, is_public = $3, updated_at = now() WHERE id = $4',
      [body.title, body.subjectId, body.isPublic, set.id],
    );
    await saveCards(client, set.id, body.cards);
  });
  res.json({ id: set.id });
});

router.delete('/:id', async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Lernset nicht gefunden' });
  const rows = await db.query('DELETE FROM quiz.study_sets WHERE id = $1 AND owner_id = $2 RETURNING id', [
    req.params.id, req.user.id,
  ]);
  if (!rows.length) return res.status(404).json({ error: 'Lernset nicht gefunden' });
  res.json({ ok: true });
});

// Öffentliches Set als eigene (private) Kopie übernehmen
router.post('/:id/copy', async (req, res) => {
  const set = await loadSet(req.params.id, req.user.id);
  if (!set) return res.status(404).json({ error: 'Lernset nicht gefunden' });
  const id = await db.tx(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO quiz.study_sets (owner_id, title, subject_id, is_public) VALUES ($1, $2, $3, false) RETURNING id',
      [req.user.id, set.title, set.subject_id],
    );
    await client.query(`
      INSERT INTO quiz.study_cards (set_id, position, term, definition)
      SELECT $1, position, term, definition FROM quiz.study_cards WHERE set_id = $2
    `, [rows[0].id, set.id]);
    return Number(rows[0].id);
  });
  res.json({ id });
});

// Ergebnis einer Wiederholung: gewusst → eine Box höher, nicht gewusst → zurück in Box 0
router.post('/cards/:cardId/review', async (req, res) => {
  if (!isId(req.params.cardId) || typeof req.body.known !== 'boolean') {
    return res.status(400).json({ error: 'Ungültige Anfrage' });
  }
  const card = await db.one('SELECT id, set_id FROM quiz.study_cards WHERE id = $1', [req.params.cardId]);
  if (!card || !(await loadSet(card.set_id, req.user.id))) return res.status(404).json({ error: 'Karte nicht gefunden' });
  const old = await db.one('SELECT box FROM quiz.card_progress WHERE user_id = $1 AND card_id = $2', [req.user.id, card.id]);
  const box = req.body.known ? Math.min((old ? Number(old.box) : 0) + 1, BOX_DAYS.length - 1) : 0;
  const row = await db.one(`
    INSERT INTO quiz.card_progress (user_id, card_id, box, due_at, reviews, last_at)
    VALUES ($1, $2, $3, now() + $4 * interval '1 day', 1, now())
    ON CONFLICT (user_id, card_id) DO UPDATE SET
      box = $3, due_at = now() + $4 * interval '1 day', reviews = card_progress.reviews + 1, last_at = now()
    RETURNING box, due_at
  `, [req.user.id, card.id, box, BOX_DAYS[box]]);

  // Lernpunkte (zählen nur im Profil)
  const mode = String(req.body.mode || 'cards');
  let points = 0;
  if (LEARN_MAX[mode]) {
    const share = mode === 'cards' ? (req.body.known ? 1 : 0.2) : Math.max(0, Math.min(1, Number(req.body.share) || 0));
    const { n } = await db.one(`SELECT COUNT(*)::int AS n FROM quiz.learn_events WHERE user_id = $1 AND card_id = $2 AND ${DAY} = ${TODAY}`, [req.user.id, card.id]);
    if (n < LEARN_PER_CARD_PER_DAY) {
      points = Math.max(1, Math.round(LEARN_MAX[mode] * share));
      await db.query('INSERT INTO quiz.learn_events (user_id, card_id, mode, points) VALUES ($1, $2, $3, $4)', [req.user.id, card.id, mode, points]);
    }
  }
  res.json({ box: Number(row.box), dueAt: row.due_at, points });
});

module.exports = { router };
