// Rechtschreibprüfung für Lernsets – ohne KI, komplett im Browser.
// Ein Wort gilt als richtig, wenn es im Hunspell-Wörterbuch (correct) oder im Fachwortschatz aus den Gesetzen (hasWord) steht
// oder sich aus solchen Wörtern zusammensetzen lässt (deutsche Zusammensetzungen: „Gefahren|abwehr“, „Verwaltungs|akt“).
// Gemeldet wird nur, wenn sich ein Wort mit einer kleinen Änderung (ein Buchstabe falsch/fehlend/zu viel/vertauscht, ae→ä …)
// zu einem gültigen Wort machen lässt – so erscheinen kaum Fehlalarme bei Namen und seltenen Wörtern.
const LINKS = ['s', 'es', 'n', 'en', 'e', 'er', 'ens'];
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzäöüß'.split('');
const TRANSLIT = [['ae', 'ä'], ['oe', 'ö'], ['ue', 'ü'], ['ss', 'ß'], ['ä', 'ae'], ['ö', 'oe'], ['ü', 'ue'], ['ß', 'ss']];

export function createChecker({ correct, hasWord }) {
  const knownCache = new Map();
  const validCache = new Map();
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // Einzelnes Wort (keine Zusammensetzung) bekannt?
  function known(part) {
    const low = part.toLowerCase();
    if (knownCache.has(low)) return knownCache.get(low);
    const ok = hasWord(low) || correct(part) || correct(low) || correct(cap(low));
    knownCache.set(low, ok);
    return ok;
  }

  // Teil einer Zusammensetzung (nicht am Anfang): normalerweise ein Hauptwort. Als Hauptwort zählt, was im Fachwortschatz steht oder
  // groß geschrieben im Wörterbuch vorkommt, klein geschrieben aber nicht („Akt“ ja, „sackt“ als Verbform nein). Längere
  // kleingeschriebene Wörter („rechtlich“) sind als Endung ebenfalls erlaubt.
  const noun = (part) => hasWord(part) || (correct(cap(part)) && !correct(part)) || (part.length >= 6 && correct(part));

  // Letzter Teil mit Endung („Rechtsguts“, „Vollzugsplans“): ohne Endung ein Hauptwort?
  const endsInflected = (part) => ['s', 'es', 'e', 'en', 'n', 'er'].some((e) => part.length - e.length >= 3 && part.endsWith(e) && noun(part.slice(0, -e.length)));

  // Zusammensetzung aus bekannten Wörtern (Fugenelemente erlaubt). Güte: Länge des kürzesten Teils, bei Gleichstand mehr Teile aus dem
  // Fachwortschatz besser (0 = keine Zusammensetzung)
  function compoundScore(word) {
    const s = word.toLowerCase();
    const n = s.length;
    if (n < 6 || n > 45) return 0;
    const best = new Array(n + 1).fill(null);       // { min, corp } je Position
    best[0] = { min: 99, corp: 0 };
    const better = (a, b) => !b || a.min > b.min || (a.min === b.min && a.corp > b.corp);
    let final = null;
    for (let i = 0; i < n; i++) {
      if (!best[i]) continue;
      for (let j = i + 3; j <= n; j++) {
        const part = s.slice(i, j);
        if (!(i === 0 ? known(part) : noun(part)) && !(j === n && i > 0 && endsInflected(part))) continue;
        const cur = { min: Math.min(best[i].min, part.length), corp: best[i].corp + (hasWord(part) ? 1 : 0) };
        if (j === n) { if (i > 0 && better(cur, final)) final = cur; continue; }
        if (better(cur, best[j])) best[j] = cur;
        for (const link of LINKS) if (s.startsWith(link, j) && j + link.length < n && better(cur, best[j + link.length])) best[j + link.length] = cur;
      }
    }
    return final ? Math.max(1, final.min * 10 + Math.min(9, final.corp)) : 0;
  }
  const compound = (word) => compoundScore(word) > 0;

  function isValid(word) {
    if (validCache.has(word)) return validCache.get(word);
    let ok = known(word) || compound(word);
    if (!ok && word.includes('-')) ok = word.split('-').filter(Boolean).every((p) => p.length < 3 || known(p) || compound(p));
    validCache.set(word, ok);
    return ok;
  }

  // Wörter, die sich durch eine kleine Änderung ergeben
  function candidates(word) {
    const out = new Set();
    for (const [a, b] of TRANSLIT) {
      let idx = word.toLowerCase().indexOf(a);
      while (idx >= 0) { out.add(word.slice(0, idx) + (word[idx] === word[idx].toUpperCase() && idx === 0 ? cap(b) : b) + word.slice(idx + a.length)); idx = word.toLowerCase().indexOf(a, idx + 1); }
    }
    // Umschrift im ganzen Wort auf einmal („Verhaeltnismaessigkeit“ → „Verhältnismäßigkeit“)
    const all = (pairs) => pairs.reduce((w, [a, b]) => w.replace(new RegExp(a, 'g'), b).replace(new RegExp(cap(a), 'g'), cap(b)), word);
    out.add(all([['ae', 'ä'], ['oe', 'ö'], ['ue', 'ü']]));
    out.add(all([['ss', 'ß']]));
    out.add(all([['ae', 'ä'], ['oe', 'ö'], ['ue', 'ü'], ['ss', 'ß']]));
    const n = word.length;
    for (let i = 0; i < n; i++) out.add(word.slice(0, i) + word.slice(i + 1));                                  // ein Buchstabe zu viel
    for (let i = 0; i < n - 1; i++) out.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));       // vertauscht
    for (let i = 0; i < n; i++) for (const c of ALPHABET) if (c !== word[i].toLowerCase()) out.add(word.slice(0, i) + (i === 0 && word[0] === word[0].toUpperCase() ? c.toUpperCase() : c) + word.slice(i + 1)); // falscher Buchstabe
    for (let i = 0; i <= n; i++) for (const c of ALPHABET) out.add(word.slice(0, i) + (i === 0 && word[0] === word[0].toUpperCase() ? c.toUpperCase() : c) + word.slice(i));                       // Buchstabe fehlt
    out.delete(word);
    return [...out];
  }

  // Vorschläge für ein unbekanntes Wort (leer = kein naheliegender Tippfehler); beste zuerst:
  // bekannte Einzelwörter, dann Zusammensetzungen mit langen Teilen
  function suggest(word, max = 2) {
    const found = [];
    for (const c of candidates(word)) {
      if (c.length < 3 || c.toLowerCase() === word.toLowerCase()) continue;
      if (known(c)) found.push({ c, q: 1000 });
      else { const q = compoundScore(c); if (q > 0 || (c.includes('-') && isValid(c))) found.push({ c, q: Math.max(q, 1) }); }
    }
    const seen = new Set();
    const sorted = found
      .sort((a, b) => b.q - a.q || Math.abs(a.c.length - word.length) - Math.abs(b.c.length - word.length))
      .filter((x) => (seen.has(x.c) ? false : seen.add(x.c)));
    // nur gleich gute Vorschläge zeigen (sonst erscheinen zusätzlich zweifelhafte Zusammensetzungen)
    return sorted.filter((x) => x.q >= sorted[0].q).slice(0, max).map((x) => x.c);
  }

  // Prüft ein Wort: { ok: true } oder { ok: false, suggestions: [...] } (suggestions leer = unbekannt, aber kein naheliegender Fehler)
  function check(word) {
    if (isValid(word)) return { ok: true };
    return { ok: false, suggestions: word.length <= 32 ? suggest(word) : [] };
  }

  return { check, isValid, suggest };
}
