// Rechtschreibprüfung für Eingabefelder (Lernsets): findet Tippfehler und Wörter, die das System nicht kennt.
// Rechnet im Browser (Wörterbuch + Fachwortschatz, siehe spell-core.mjs); Text verlässt das Gerät nicht.
const Spell = (() => {
  let worker = null;
  let seq = 0;
  let off = false;                 // Worker oder Wörterbuch nicht verfügbar: Prüfung stillschweigend aus
  let loaded = false;
  const pending = new Map();
  const cache = new Map();         // Wort → { ok, suggestions }
  const KEY = 'spell-user';
  const mine = new Set();
  try { JSON.parse(localStorage.getItem(KEY) || '[]').forEach((w) => mine.add(String(w).toLowerCase())); } catch { /* egal */ }

  function start() {
    if (worker || off) return;
    try {
      worker = new Worker('/js/spell-worker.mjs', { type: 'module' });
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.error) { off = true; p.resolve(null); return; }
        loaded = true;
        e.data.results.forEach((r) => cache.set(r.w, { ok: r.ok, suggestions: r.suggestions || [] }));
        p.resolve(true);
      };
      worker.onerror = () => { off = true; pending.forEach((p) => p.resolve(null)); pending.clear(); };
    } catch { off = true; }
  }

  // Wörter im Text: Buchstaben (mit Bindestrich), ab 4 Buchstaben; Kürzel (StGB, PolG), Wörter mit Ziffern und reine Großbuchstaben bleiben unberührt
  function tokens(text) {
    const out = [];
    for (const m of String(text).matchAll(/(?<![\p{L}\p{N}§])\p{L}+(?:-\p{L}+)*(?![\p{L}\p{N}])/gu)) {
      const w = m[0];
      if (w.replace(/-/g, '').length < 4 || /\p{Lu}/u.test(w.slice(1).replace(/-\p{L}/gu, '')) || w === w.toUpperCase()) continue;
      out.push({ word: w, start: m.index, end: m.index + w.length });
    }
    return out;
  }

  // Liefert die auffälligen Wörter: [{ word, start, end, suggestions }] (leer = alles in Ordnung oder Prüfung nicht verfügbar)
  async function check(text) {
    const toks = tokens(text).filter((t) => !mine.has(t.word.toLowerCase()));
    if (!toks.length || off) return [];
    const unknown = [...new Set(toks.map((t) => t.word))].filter((w) => !cache.has(w));
    if (unknown.length) {
      start();
      if (off) return [];
      const ok = await new Promise((resolve) => { const id = ++seq; pending.set(id, { resolve }); worker.postMessage({ id, words: unknown }); });
      if (!ok) return [];
    }
    return toks.filter((t) => cache.get(t.word) && !cache.get(t.word).ok).map((t) => ({ ...t, suggestions: cache.get(t.word).suggestions }));
  }

  // „Stimmt so“: dauerhaft auf diesem Gerät merken
  function accept(word) {
    mine.add(word.toLowerCase());
    try { localStorage.setItem(KEY, JSON.stringify([...mine])); } catch { /* egal */ }
  }

  return { check, accept, preload: start, get ready() { return loaded; }, get off() { return off; } };
})();
