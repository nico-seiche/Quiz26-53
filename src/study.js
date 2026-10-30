const express = require('express');
const db = require('./db');
const { requireAuth } = require('./auth');
const { areFriends, findUser } = require('./friends');

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

// Lernset laden, wenn es dem Nutzer gehört, öffentlich ist oder er als Mitarbeiter eingeladen wurde
const COLLAB = (setCol, userParam) => `EXISTS (SELECT 1 FROM quiz.study_set_collaborators c WHERE c.set_id = ${setCol} AND c.user_id = ${userParam})`;
async function loadSet(id, userId) {
  if (!isId(id)) return null;
  const set = await db.one(`
    SELECT st.id, st.owner_id, st.title, st.subject_id, st.is_public, st.updated_at, u.username AS owner,
           s.name AS subject, s.icon AS subject_icon,
           (st.owner_id = $2 OR ${COLLAB('st.id', '$2')}) AS can_edit
    FROM quiz.study_sets st
    JOIN quiz.users u ON u.id = st.owner_id
    LEFT JOIN quiz.subjects s ON s.id = st.subject_id
    WHERE st.id = $1 AND (st.owner_id = $2 OR st.is_public OR ${COLLAB('st.id', '$2')})
  `, [id, userId]);
  if (!set) return null;
  set.id = Number(set.id);
  set.owner_id = Number(set.owner_id);
  return set;
}

router.get('/', async (req, res) => {
  const rows = await db.query(`
    SELECT st.id, st.owner_id, st.title, st.is_public, st.updated_at, u.username AS owner,
           (st.owner_id = $1 OR ${COLLAB('st.id', '$1')}) AS can_edit,
           s.name AS subject, s.icon AS subject_icon,
           COUNT(c.id)::int AS card_count,
           COUNT(c.id) FILTER (WHERE p.card_id IS NULL OR p.due_at <= now())::int AS due_count,
           COUNT(c.id) FILTER (WHERE p.box >= $2)::int AS mastered_count
    FROM quiz.study_sets st
    JOIN quiz.users u ON u.id = st.owner_id
    LEFT JOIN quiz.subjects s ON s.id = st.subject_id
    LEFT JOIN quiz.study_cards c ON c.set_id = st.id
    LEFT JOIN quiz.card_progress p ON p.card_id = c.id AND p.user_id = $1
    WHERE st.owner_id = $1 OR st.is_public OR ${COLLAB('st.id', '$1')}
    GROUP BY st.id, u.username, s.name, s.icon
    ORDER BY st.updated_at DESC
  `, [req.user.id, MASTERED_BOX]);
  // mine = darf ich bearbeiten (Besitzer oder Mitarbeiter), isOwner = gehört mir
  const sets = rows.map((r) => ({ ...r, id: Number(r.id), isOwner: Number(r.owner_id) === req.user.id, mine: r.can_edit }));
  // Eigene Kopien fremder Sets: das Original ist ausgeblendet, solange die Kopie aktuell ist; sonst „Update verfügbar“
  const copies = new Map((await db.query(
    'SELECT DISTINCT ON (copied_from) copied_from, id, synced_to FROM quiz.study_sets WHERE owner_id = $1 AND copied_from IS NOT NULL ORDER BY copied_from, created_at DESC',
    [req.user.id])).map((c) => [Number(c.copied_from), c]));
  const shared = [];
  for (const st of sets.filter((x) => !x.mine)) {
    const copy = copies.get(st.id);
    if (!copy) { shared.push(st); continue; }
    if (copy.synced_to && new Date(st.updated_at) > new Date(copy.synced_to)) shared.push({ ...st, copyId: Number(copy.id) });
  }
  res.json({ mine: sets.filter((s) => s.mine), shared });
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
    isPublic: set.is_public, owner: set.owner, canEdit: set.can_edit, isOwner: set.owner_id === req.user.id,
    collaborators: (await db.query(`SELECT u.username FROM quiz.study_set_collaborators c JOIN quiz.users u ON u.id = c.user_id
                                    WHERE c.set_id = $1 ORDER BY c.added_at`, [set.id])).map((r) => r.username),
    masteredBox: MASTERED_BOX,
    cards: cards.map((c) => ({ ...c, id: Number(c.id), box: Number(c.box), rev: undefined })),
  });
});

// --- Zusammenarbeit: Mitarbeiter und gleichzeitiges Bearbeiten (wie bei Quiz, aber Karte für Karte) ---
const LOCK_SECONDS = 8;
const notifySet = (setId) => db.query('SELECT quiz.notify($1)', [`s${setId}`]).catch(() => {});
const fresh = `seen_at > now() - interval '${LOCK_SECONDS} seconds'`;

// Darf der Nutzer dieses Set bearbeiten? Sonst null.
async function editableSet(id, userId) {
  const set = await loadSet(id, userId);
  return set && set.can_edit ? set : null;
}

// Eine einzelne Karte prüfen
function cleanCard(input) {
  const term = String(input.term || '').trim();
  const definition = String(input.definition || '').replace(/\s+/g, ' ').trim();
  if (!term) return { error: 'Begriff fehlt' };
  if (!definition) return { error: 'Definition fehlt' };
  if (term.length > 200) return { error: 'Begriff ist zu lang' };
  if (definition.length > 4000) return { error: 'Definition ist zu lang' };
  return { ok: { term, definition } };
}

const cardsOf = async (setId) => (await db.query('SELECT id, rev, term, definition FROM quiz.study_cards WHERE set_id = $1 ORDER BY position, id', [setId]))
  .map((c) => ({ id: Number(c.id), rev: c.rev, term: c.term, definition: c.definition }));

// Lebenszeichen + Lesen (alle paar Sekunden). editing: Karten-ID sperren, null = freigeben, fehlt = unverändert.
router.post('/:id/live', async (req, res) => {
  const set = await editableSet(req.params.id, req.user.id);
  if (!set) return res.status(404).json({ error: 'Lernset nicht gefunden' });
  const { editing, leave } = req.body || {};
  if (leave) {
    await db.query('DELETE FROM quiz.study_presence WHERE set_id = $1 AND user_id = $2', [set.id, req.user.id]);
    await notifySet(set.id);
    return res.json({ ok: true });
  }
  const cards = await cardsOf(set.id);
  let denied = null;
  let lockChanged = false;
  await db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [set.id]);
    const { rows: [mine] } = await client.query(`SELECT card_id, (${fresh}) AS alive FROM quiz.study_presence WHERE set_id = $1 AND user_id = $2`, [set.id, req.user.id]);
    const before = mine && mine.alive && mine.card_id ? Number(mine.card_id) : null;
    let cid = before;
    if (editing === null) cid = null;
    else if (editing !== undefined && isId(editing) && cards.some((c) => c.id === Number(editing))) {
      const { rows: [holder] } = await client.query(`
        SELECT u.username FROM quiz.study_presence p JOIN quiz.users u ON u.id = p.user_id
        WHERE p.set_id = $1 AND p.card_id = $2 AND p.user_id <> $3 AND p.${fresh}`, [set.id, editing, req.user.id]);
      if (holder) denied = { card: Number(editing), by: holder.username };
      else cid = Number(editing);
    }
    await client.query(`
      INSERT INTO quiz.study_presence (set_id, user_id, card_id, seen_at) VALUES ($1, $2, $3, now())
      ON CONFLICT (set_id, user_id) DO UPDATE SET card_id = $3, seen_at = now()`, [set.id, req.user.id, cid]);
    lockChanged = cid !== before;
  });
  if (lockChanged) await notifySet(set.id);
  const [presence, meta] = await Promise.all([
    db.query(`SELECT u.username, p.card_id, (p.user_id = $2) AS me FROM quiz.study_presence p JOIN quiz.users u ON u.id = p.user_id
              WHERE p.set_id = $1 AND p.${fresh} ORDER BY p.seen_at`, [set.id, req.user.id]),
    db.one('SELECT title, subject_id, is_public FROM quiz.study_sets WHERE id = $1', [set.id]),
  ]);
  res.json({
    serverNow: Date.now(),
    meta: { title: meta.title, subjectId: meta.subject_id, isPublic: meta.is_public },
    cards: await cardsOf(set.id),
    presence: presence.map((p) => ({ username: p.username, editing: p.card_id ? Number(p.card_id) : null, me: p.me })),
    denied,
  });
});

// Hält der Nutzer die (frische) Sperre dieser Karte? Sonst Fehlerinfo.
async function lockProblem(setId, cardId, userId) {
  const mine = await db.one(`SELECT 1 FROM quiz.study_presence WHERE set_id = $1 AND user_id = $2 AND card_id = $3 AND ${fresh}`, [setId, userId, cardId]);
  if (mine) return null;
  const other = await db.one(`SELECT u.username FROM quiz.study_presence p JOIN quiz.users u ON u.id = p.user_id
    WHERE p.set_id = $1 AND p.card_id = $2 AND p.user_id <> $3 AND p.${fresh}`, [setId, cardId, userId]);
  return other ? { by: other.username, error: `${other.username} bearbeitet diese Karte gerade.` }
    : { lost: true, error: 'Die Bearbeitung war kurz unterbrochen – bitte noch einmal versuchen.' };
}

// Neue Karte ans Ende; der Ersteller behält sie gleich in Bearbeitung
router.post('/:id/cards', async (req, res) => {
  const set = await editableSet(req.params.id, req.user.id);
  if (!set) return res.status(404).json({ error: 'Lernset nicht gefunden' });
  const { ok, error } = cleanCard(req.body);
  if (error) return res.status(400).json({ error });
  const created = await db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [set.id]);
    const { rows: [n] } = await client.query('SELECT COUNT(*)::int AS n, COALESCE(MAX(position) + 1, 0) AS next FROM quiz.study_cards WHERE set_id = $1', [set.id]);
    if (n.n >= MAX_CARDS) return { error: `Höchstens ${MAX_CARDS} Karten pro Set` };
    const { rows: [row] } = await client.query('INSERT INTO quiz.study_cards (set_id, position, term, definition) VALUES ($1, $2, $3, $4) RETURNING id, rev',
      [set.id, n.next, ok.term, ok.definition]);
    await client.query(`
      INSERT INTO quiz.study_presence (set_id, user_id, card_id, seen_at) VALUES ($1, $2, $3, now())
      ON CONFLICT (set_id, user_id) DO UPDATE SET card_id = $3, seen_at = now()`, [set.id, req.user.id, row.id]);
    await client.query('UPDATE quiz.study_sets SET updated_at = now() WHERE id = $1', [set.id]);
    return row;
  });
  if (created.error) return res.status(400).json({ error: created.error });
  await notifySet(set.id);
  res.json({ id: Number(created.id), rev: created.rev });
});

// Mehrere Karten auf einmal (Text einfügen)
router.post('/:id/cards/bulk', async (req, res) => {
  const set = await editableSet(req.params.id, req.user.id);
  if (!set) return res.status(404).json({ error: 'Lernset nicht gefunden' });
  const input = Array.isArray(req.body.cards) ? req.body.cards : [];
  const cleaned = [];
  for (const [i, c] of input.entries()) {
    const r = cleanCard(c);
    if (r.error) return res.status(400).json({ error: `Karte ${i + 1}: ${r.error}` });
    cleaned.push(r.ok);
  }
  if (!cleaned.length) return res.status(400).json({ error: 'Keine Karten erhalten' });
  const result = await db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [set.id]);
    const { rows: [n] } = await client.query('SELECT COUNT(*)::int AS n, COALESCE(MAX(position) + 1, 0) AS next FROM quiz.study_cards WHERE set_id = $1', [set.id]);
    if (n.n + cleaned.length > MAX_CARDS) return { error: `Höchstens ${MAX_CARDS} Karten pro Set` };
    for (const [i, c] of cleaned.entries()) {
      await client.query('INSERT INTO quiz.study_cards (set_id, position, term, definition) VALUES ($1, $2, $3, $4)', [set.id, n.next + i, c.term, c.definition]);
    }
    await client.query('UPDATE quiz.study_sets SET updated_at = now() WHERE id = $1', [set.id]);
    return { added: cleaned.length };
  });
  if (result.error) return res.status(400).json({ error: result.error });
  await notifySet(set.id);
  res.json(result);
});

router.put('/:id/cards/:cid', async (req, res) => {
  const set = await editableSet(req.params.id, req.user.id);
  if (!set || !isId(req.params.cid) || !(await db.one('SELECT 1 FROM quiz.study_cards WHERE id = $1 AND set_id = $2', [req.params.cid, set.id]))) {
    return res.status(404).json({ error: 'Karte nicht gefunden' });
  }
  const problem = await lockProblem(set.id, Number(req.params.cid), req.user.id);
  if (problem) return res.status(409).json({ ...problem, lock: true });
  const { ok, error } = cleanCard(req.body);
  if (error) return res.status(400).json({ error });
  const row = await db.one('UPDATE quiz.study_cards SET term = $1, definition = $2, rev = rev + 1 WHERE id = $3 AND set_id = $4 RETURNING rev',
    [ok.term, ok.definition, req.params.cid, set.id]);
  await db.query('UPDATE quiz.study_sets SET updated_at = now() WHERE id = $1', [set.id]);
  await notifySet(set.id);
  res.json({ rev: row.rev });
});

router.delete('/:id/cards/:cid', async (req, res) => {
  const set = await editableSet(req.params.id, req.user.id);
  if (!set || !isId(req.params.cid) || !(await db.one('SELECT 1 FROM quiz.study_cards WHERE id = $1 AND set_id = $2', [req.params.cid, set.id]))) {
    return res.status(404).json({ error: 'Karte nicht gefunden' });
  }
  const other = await db.one(`SELECT u.username FROM quiz.study_presence p JOIN quiz.users u ON u.id = p.user_id
    WHERE p.set_id = $1 AND p.card_id = $2 AND p.user_id <> $3 AND p.${fresh}`, [set.id, req.params.cid, req.user.id]);
  if (other) return res.status(409).json({ error: `${other.username} bearbeitet diese Karte gerade.` });
  await db.query('DELETE FROM quiz.study_cards WHERE id = $1 AND set_id = $2', [req.params.cid, set.id]);
  await db.query('UPDATE quiz.study_sets SET updated_at = now() WHERE id = $1', [set.id]);
  await notifySet(set.id);
  res.json({ ok: true });
});

// Titel, Fach, Sichtbarkeit: nur der Besitzer
router.patch('/:id/meta', async (req, res) => {
  const set = await loadSet(req.params.id, req.user.id);
  if (!set || set.owner_id !== req.user.id) return res.status(403).json({ error: 'Nur der Besitzer ändert Titel, Fach und Sichtbarkeit.' });
  let body;
  try { body = await readBody({ ...req.body, cards: [] }); } catch (msg) { return res.status(400).json({ error: String(msg) }); }
  await db.query('UPDATE quiz.study_sets SET title = $1, subject_id = $2, is_public = $3, updated_at = now() WHERE id = $4',
    [body.title, body.subjectId, body.isPublic, set.id]);
  await notifySet(set.id);
  res.json({ ok: true });
});

// Mitarbeiter einladen (nur Besitzer, nur Freunde)
router.post('/:id/collaborators', async (req, res) => {
  const set = await loadSet(req.params.id, req.user.id);
  if (!set || set.owner_id !== req.user.id) return res.status(404).json({ error: 'Lernset nicht gefunden' });
  const input = String(req.body.username || '').trim();
  if (!input) return res.status(400).json({ error: 'Nutzername oder #ID fehlt' });
  const user = await findUser(input);
  if (!user) return res.status(404).json({ error: `Spieler „${input}“ nicht gefunden.` });
  if (Number(user.id) === req.user.id) return res.status(400).json({ error: 'Das Lernset gehört dir bereits.' });
  if (!(await areFriends(req.user.id, user.id))) {
    return res.status(403).json({ error: `${user.username} ist noch nicht dein Freund. Schicke zuerst unter Profil → Freunde eine Anfrage.` });
  }
  await db.query('INSERT INTO quiz.study_set_collaborators (set_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [set.id, user.id]);
  res.json({ username: user.username });
});

// Entfernen: der Besitzer jeden, ein Mitarbeiter sich selbst
router.delete('/:id/collaborators/:username', async (req, res) => {
  const set = await editableSet(req.params.id, req.user.id);
  if (!set) return res.status(404).json({ error: 'Lernset nicht gefunden' });
  const user = await db.one('SELECT id FROM quiz.users WHERE lower(username) = lower($1)', [String(req.params.username).normalize('NFC')]);
  if (!user) return res.status(404).json({ error: 'Nutzer nicht gefunden' });
  if (set.owner_id !== req.user.id && Number(user.id) !== req.user.id) return res.status(403).json({ error: 'Nur der Besitzer kann andere entfernen' });
  await db.query('DELETE FROM quiz.study_set_collaborators WHERE set_id = $1 AND user_id = $2', [set.id, user.id]);
  await notifySet(set.id);
  res.json({ ok: true });
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
      'INSERT INTO quiz.study_sets (owner_id, title, subject_id, is_public, copied_from, synced_to) VALUES ($1, $2, $3, false, $4, $5) RETURNING id',
      [req.user.id, set.title, set.subject_id, set.id, set.updated_at],
    );
    await client.query(`
      INSERT INTO quiz.study_cards (set_id, position, term, definition, source_card_id)
      SELECT $1, position, term, definition, id FROM quiz.study_cards WHERE set_id = $2
    `, [rows[0].id, set.id]);
    return Number(rows[0].id);
  });
  res.json({ id });
});

// Kopie mit dem (geänderten) Original abgleichen: neue Karten kommen dazu, geänderte werden übernommen, im Original
// gelöschte entfallen; eigene zusätzliche Karten der Kopie bleiben. Lernfortschritt bleibt bei übernommenen Karten erhalten.
router.post('/:id/sync', async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ error: 'Lernset nicht gefunden' });
  const copy = await db.one('SELECT id, copied_from FROM quiz.study_sets WHERE id = $1 AND owner_id = $2', [req.params.id, req.user.id]);
  if (!copy || !copy.copied_from) return res.status(404).json({ error: 'Das ist keine Kopie eines anderen Lernsets' });
  const original = await loadSet(copy.copied_from, req.user.id);
  if (!original) return res.status(404).json({ error: 'Das Original gibt es nicht mehr oder ist nicht mehr geteilt' });
  const result = await db.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [copy.id]);
    const { rows: src } = await client.query('SELECT id, term, definition FROM quiz.study_cards WHERE set_id = $1 ORDER BY position, id', [original.id]);
    const { rows: mine } = await client.query('SELECT id, term, definition, source_card_id FROM quiz.study_cards WHERE set_id = $1', [copy.id]);
    const bySource = new Map(mine.filter((m) => m.source_card_id).map((m) => [Number(m.source_card_id), m]));
    const srcIds = new Set(src.map((x) => Number(x.id)));
    const own = mine.filter((m) => !m.source_card_id).length;
    if (src.length + own > MAX_CARDS) return { error: `Höchstens ${MAX_CARDS} Karten pro Set` };
    let added = 0; let updated = 0; let removed = 0;
    for (const m of mine) {
      if (m.source_card_id && !srcIds.has(Number(m.source_card_id))) {
        await client.query('DELETE FROM quiz.study_cards WHERE id = $1', [m.id]);
        removed++;
      }
    }
    for (const [i, o] of src.entries()) {
      const m = bySource.get(Number(o.id));
      if (m) {
        if (m.term !== o.term || m.definition !== o.definition) {
          await client.query('UPDATE quiz.study_cards SET term = $1, definition = $2, rev = rev + 1 WHERE id = $3', [o.term, o.definition, m.id]);
          updated++;
        }
        await client.query('UPDATE quiz.study_cards SET position = $1 WHERE id = $2', [i, m.id]);
      } else {
        await client.query('INSERT INTO quiz.study_cards (set_id, position, term, definition, source_card_id) VALUES ($1, $2, $3, $4, $5)', [copy.id, i, o.term, o.definition, o.id]);
        added++;
      }
    }
    // eigene Zusatzkarten hinter die übernommenen sortieren
    await client.query(`
      UPDATE quiz.study_cards c SET position = src.n + r.rn - 1
      FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) AS rn FROM quiz.study_cards WHERE set_id = $1 AND source_card_id IS NULL) r,
           (SELECT $2::int AS n) src
      WHERE c.id = r.id`, [copy.id, src.length]);
    await client.query('UPDATE quiz.study_sets SET synced_to = $2, updated_at = now() WHERE id = $1', [copy.id, original.updated_at]);
    return { added, updated, removed };
  });
  if (result.error) return res.status(400).json({ error: result.error });
  await notifySet(copy.id);
  res.json(result);
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
