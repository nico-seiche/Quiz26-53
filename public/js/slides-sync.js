// Gemeinsames Bearbeiten von Präsentationen: Änderungen werden als kleine Operationen übertragen (nicht das ganze Dokument),
// damit mehrere Personen gleichzeitig an verschiedenen Folien und Elementen arbeiten können.
// Dieselbe Datei läuft im Browser (Editor) und auf dem Server (src/slides.js).
//
// Dokument: { title, slides: [{ id, bg, notes, transition, elements: [{ id, type, x, y, … }] }], palette, gradients }
// Operationen:
//   { t: 'title', v } · { t: 'palette', v } · { t: 'gradients', v }
//   { t: 'slideAdd', slide, after } · { t: 'slideDel', id } · { t: 'slideMove', id, after } · { t: 'slideSet', id, f }
//   { t: 'elAdd', s, el, after } · { t: 'elDel', s, id } · { t: 'elMove', s, id, after } · { t: 'elSet', s, id, f, d }
// „after“ ist die ID des Vorgängers (null = ganz vorn). Gleichzeitige Änderungen am selben Feld: die zuletzt gespeicherte gewinnt.
const SlidesSync = (() => {
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
  const SLIDE_FIELDS = ['bg', 'notes', 'transition'];

  // ----- Unterschied zweier Listen mit IDs → Löschen, Einfügen, Verschieben -----
  function listOps(baseList, curList, { del, add, move }) {
    const bIds = baseList.map((x) => x.id);
    const cIds = curList.map((x) => x.id);
    const inCur = new Set(cIds);
    const inBase = new Set(bIds);
    const ops = [];
    bIds.forEach((id) => { if (!inCur.has(id)) ops.push(del(id)); });
    curList.forEach((x, i) => { if (!inBase.has(x.id)) ops.push(add(x, i ? cIds[i - 1] : null)); });
    // Reihenfolge der Elemente, die es vorher und nachher gibt
    const sim = bIds.filter((id) => inCur.has(id));
    const want = cIds.filter((id) => inBase.has(id));
    want.forEach((id, i) => {
      if (sim[i] === id) return;
      sim.splice(sim.indexOf(id), 1);
      sim.splice(i, 0, id);
      const at = cIds.indexOf(id);
      ops.push(move(id, at ? cIds[at - 1] : null));
    });
    return ops;
  }

  function diff(base, cur) {
    const ops = [];
    if (base.title !== cur.title) ops.push({ t: 'title', v: cur.title });
    if (!same(base.palette || [], cur.palette || [])) ops.push({ t: 'palette', v: cur.palette || [] });
    if (!same(base.gradients || [], cur.gradients || [])) ops.push({ t: 'gradients', v: cur.gradients || [] });
    ops.push(...listOps(base.slides, cur.slides, {
      del: (id) => ({ t: 'slideDel', id }),
      add: (slide, after) => ({ t: 'slideAdd', slide: clone(slide), after }),
      move: (id, after) => ({ t: 'slideMove', id, after }),
    }));
    const baseById = new Map(base.slides.map((s) => [s.id, s]));
    cur.slides.forEach((s) => {
      const b = baseById.get(s.id);
      if (!b) return;            // neue Folie: steckt schon komplett in slideAdd
      const f = {};
      SLIDE_FIELDS.forEach((k) => { if (!same(b[k], s[k])) f[k] = clone(s[k]); });
      if (Object.keys(f).length) ops.push({ t: 'slideSet', id: s.id, f });
      ops.push(...listOps(b.elements, s.elements, {
        del: (id) => ({ t: 'elDel', s: s.id, id }),
        add: (el, after) => ({ t: 'elAdd', s: s.id, el: clone(el), after }),
        move: (id, after) => ({ t: 'elMove', s: s.id, id, after }),
      }));
      const bEls = new Map(b.elements.map((e) => [e.id, e]));
      s.elements.forEach((e) => {
        const be = bEls.get(e.id);
        if (!be) return;
        const fe = {}; const d = [];
        new Set([...Object.keys(be), ...Object.keys(e)]).forEach((k) => {
          if (k === 'id') return;
          if (!(k in e)) d.push(k); else if (!same(be[k], e[k])) fe[k] = clone(e[k]);
        });
        if (Object.keys(fe).length || d.length) ops.push({ t: 'elSet', s: s.id, id: e.id, f: fe, d });
      });
    });
    return ops;
  }

  // ----- Operationen auf ein Dokument anwenden (verändert doc) -----
  function insertAfter(list, item, after) {
    if (after === null || after === undefined) { list.splice(after === null ? 0 : list.length, 0, item); return; }
    const i = list.findIndex((x) => x.id === after);
    list.splice(i < 0 ? list.length : i + 1, 0, item);
  }
  function apply(doc, ops) {
    const slide = (id) => doc.slides.find((s) => s.id === id);
    for (const op of ops) {
      if (!op || typeof op !== 'object') continue;
      switch (op.t) {
        case 'title': if (typeof op.v === 'string') doc.title = op.v; break;
        case 'palette': if (Array.isArray(op.v)) doc.palette = op.v; break;
        case 'gradients': if (Array.isArray(op.v)) doc.gradients = op.v; break;
        case 'slideAdd': if (op.slide && !slide(op.slide.id)) insertAfter(doc.slides, clone(op.slide), op.after); break;
        case 'slideDel': doc.slides = doc.slides.filter((s) => s.id !== op.id); break;
        case 'slideMove': {
          const s = slide(op.id);
          if (s && op.after !== op.id) { doc.slides = doc.slides.filter((x) => x !== s); insertAfter(doc.slides, s, op.after); }
          break;
        }
        case 'slideSet': {
          const s = slide(op.id);
          if (s && op.f) SLIDE_FIELDS.forEach((k) => { if (k in op.f) s[k] = clone(op.f[k]); });
          break;
        }
        case 'elAdd': { const s = slide(op.s); if (s && op.el && !s.elements.some((e) => e.id === op.el.id)) insertAfter(s.elements, clone(op.el), op.after); break; }
        case 'elDel': { const s = slide(op.s); if (s) s.elements = s.elements.filter((e) => e.id !== op.id); break; }
        case 'elMove': {
          const s = slide(op.s);
          const e = s && s.elements.find((x) => x.id === op.id);
          if (e && op.after !== op.id) { s.elements = s.elements.filter((x) => x !== e); insertAfter(s.elements, e, op.after); }
          break;
        }
        case 'elSet': {
          const s = slide(op.s);
          const e = s && s.elements.find((x) => x.id === op.id);
          if (!e) break;
          Object.keys(op.f || {}).forEach((k) => { if (!FORBIDDEN.has(k) && k !== 'id') e[k] = clone(op.f[k]); });
          (op.d || []).forEach((k) => { if (!FORBIDDEN.has(k) && k !== 'id') delete e[k]; });
          break;
        }
        default: break;
      }
    }
    return doc;
  }

  // Eigene noch ungesicherte Änderungen (sent → local) auf den neuen Stand des Servers legen
  const rebase = (sent, local, server) => apply(clone(server), diff(sent, local));

  return { diff, apply, rebase, clone, same };
})();
if (typeof module !== 'undefined') module.exports = SlidesSync;
