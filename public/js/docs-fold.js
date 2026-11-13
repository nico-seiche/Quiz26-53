// Abschnitte im Dokument ein- und ausklappen: Vor jeder Überschrift (Ebene 1–3) steht ein Chevron; ein Klick darauf blendet alles
// bis zur nächsten Überschrift gleicher oder höherer Ebene aus. Der Zustand wird pro Dokument im Browser gemerkt (nicht im Text).
const DocsFold = (() => {
  const HEAD = /^H([1-3])$/;
  function attach(quill, docId) {
    const root = quill.root;
    const KEY = `fold:${docId}`;
    let folded = new Set();
    try { folded = new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { /* egal */ }
    const save = () => { try { if (folded.size) localStorage.setItem(KEY, JSON.stringify([...folded])); else localStorage.removeItem(KEY); } catch { /* egal */ } };
    const keyOf = (el, n) => `${el.tagName}|${n}|${el.textContent.trim().slice(0, 60)}`;   // Ebene, Nummer unter gleichnamigen Überschriften, Text

    function apply() {
      const seen = {};
      let hideUntil = 0;            // > 0: gerade in einem eingeklappten Abschnitt dieser Ebene
      for (const el of root.children) {
        const m = HEAD.exec(el.tagName);
        let hide = false;
        if (m) {
          const lvl = Number(m[1]);
          if (hideUntil && lvl <= hideUntil) hideUntil = 0;
          hide = Boolean(hideUntil);
          const base = `${el.tagName}|${el.textContent.trim().slice(0, 60)}`;
          seen[base] = (seen[base] || 0) + 1;
          const key = `${base}|${seen[base]}`;
          el.dataset.fk = key;
          const isFolded = folded.has(key);
          if (el.dataset.fold !== (isFolded ? 'closed' : 'open')) el.dataset.fold = isFolded ? 'closed' : 'open';
          if (isFolded && !hideUntil) hideUntil = lvl;
        } else hide = Boolean(hideUntil);
        if (el.hidden !== hide) el.hidden = hide;
      }
    }
    // Klick auf den Chevron (linker Rand der Überschrift)
    root.addEventListener('click', (e) => {
      for (const el of root.children) {
        if (!HEAD.test(el.tagName)) continue;
        const r = el.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= Math.min(r.bottom, r.top + 48) && e.clientX >= r.left - 46 && e.clientX <= r.left + 6) { e.preventDefault(); toggle(el); return; }
      }
    });
    function toggle(el) {
      const k = el.dataset.fk;
      if (!k) return;
      if (folded.has(k)) folded.delete(k); else folded.add(k);
      save(); apply();
    }
    // Cursor landet in ausgeblendetem Text (z. B. neuer Absatz am Ende einer eingeklappten Überschrift): Abschnitt wieder aufklappen
    function reveal() {
      const sel = quill.getSelection();
      if (!sel) return;
      const [leaf] = quill.getLeaf(sel.index);
      let el = leaf && leaf.domNode;
      while (el && el.parentElement !== root) el = el.parentElement;
      if (!el || !el.hidden) return;
      for (let p = el.previousElementSibling; p; p = p.previousElementSibling) {
        if (HEAD.test(p.tagName) && p.dataset.fold === 'closed' && !p.hidden) { folded.delete(p.dataset.fk); break; }
      }
      save(); apply();
    }
    let t = null;
    quill.on('text-change', () => { clearTimeout(t); t = setTimeout(() => { apply(); reveal(); }, 0); });
    apply();
    return {
      all(open) { for (const el of root.querySelectorAll('h1, h2, h3')) { if (open) folded.delete(el.dataset.fk); else if (el.dataset.fk) folded.add(el.dataset.fk); } save(); apply(); },
      apply,
    };
  }

  // Gesperrte Überschriften (Format „locked“): nicht anklickbar zum Schreiben, nicht löschbar, nicht mit dem Nachbarabsatz verschmelzbar
  function lockHeadings(quill) {
    const root = quill.root;
    const mark = () => { for (const el of root.children) { const on = el.classList.contains('ql-locked-yes'); if (on !== (el.getAttribute('contenteditable') === 'false')) { if (on) { el.setAttribute('contenteditable', 'false'); el.dataset.locked = '1'; } else { el.removeAttribute('contenteditable'); delete el.dataset.locked; } } } };
    const lockedAt = (index) => { const [line] = quill.getLine(index); return Boolean(line && line.domNode.classList.contains('ql-locked-yes')); };
    const snapshot = () => quill.getLines(0).filter((l) => l.domNode.classList.contains('ql-locked-yes')).map((l) => l.domNode.textContent).join('\n');
    let snap = snapshot();
    // Zurück-/Entf-Taste am Rand einer gesperrten Überschrift wirkungslos machen
    const guard = (key, hits) => { quill.keyboard.addBinding({ key }, (range) => !(range.length === 0 && hits(range)) && true); const list = quill.keyboard.bindings[key === 'Backspace' ? 'Backspace' : 'Delete']; if (list && list.length) list.unshift(list.pop()); };
    guard('Backspace', (r) => { const [line, off] = quill.getLine(r.index); return off === 0 && quill.getIndex(line) > 0 && lockedAt(quill.getIndex(line) - 1); });
    guard('Delete', (r) => { const [line, off] = quill.getLine(r.index); return off === line.length() - 1 && lockedAt(quill.getIndex(line) + line.length()); });
    // Auffangnetz (Auswahl über mehrere Zeilen, Einfügen …): Änderung an gesperrten Überschriften rückgängig machen
    quill.on('text-change', (d, o, source) => {
      mark();
      if (source === 'user' && snapshot() !== snap) { quill.history.undo(); mark(); }
      snap = snapshot();
    });
    mark();
  }
  return { attach, lockHeadings };
})();
