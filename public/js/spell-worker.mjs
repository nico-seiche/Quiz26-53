// Läuft im Hintergrund (Web Worker), damit das Laden des Wörterbuchs die Seite nicht anhält.
import { createChecker } from './spell-core.mjs';

const DICT = 'https://cdn.jsdelivr.net/npm/dictionary-de@3.0.0';
let checker = null;
let ready = null;

async function init() {
  const [aff, dic, words, mod] = await Promise.all([
    fetch(`${DICT}/index.aff`).then((r) => { if (!r.ok) throw new Error('Wörterbuch nicht erreichbar'); return r.text(); }),
    fetch(`${DICT}/index.dic`).then((r) => { if (!r.ok) throw new Error('Wörterbuch nicht erreichbar'); return r.text(); }),
    fetch('/data/wortschatz.json').then((r) => r.json()),
    import('https://cdn.jsdelivr.net/npm/nspell@2.1.5/+esm'),
  ]);
  const sp = mod.default(aff, dic);
  const corpus = new Set(words);
  checker = createChecker({ correct: (w) => sp.correct(w), hasWord: (w) => corpus.has(w) });
}

self.onmessage = async (e) => {
  const { id, words } = e.data;
  try {
    await (ready || (ready = init()));
    self.postMessage({ id, results: words.map((w) => ({ w, ...checker.check(w) })) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
