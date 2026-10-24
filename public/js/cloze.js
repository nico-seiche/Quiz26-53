// Hilfen zum Auswendiglernen langer Definitionen: Lücken erzeugen und Antworten tolerant vergleichen.
// Reine Funktionen ohne Seitenzugriff, damit sie sich auch in Node testen lassen.
const Cloze = (() => {
  // Füllwörter, die nicht als Lücke taugen (die Lücken sollen die Begriffe sein, auf die es ankommt)
  const STOP = new Set(('der die das den dem des ein eine einer einem einen eines und oder aber wenn dann als wie ' +
    'bei mit von vom zum zur zu im in am an auf aus für nach über unter ist sind wird werden war hat haben kann ' +
    'können sich es er sie nicht auch nur so sein ihre ihrer ihren dass').split(' '));

  // Zerlegt in Wörter und Trennstücke (Leerzeichen, Satzzeichen), damit der Text unverändert angezeigt werden kann
  function tokenize(text) {
    return (String(text).match(/[\p{L}\p{N}][\p{L}\p{N}-]*|[^\p{L}\p{N}]+/gu) || [])
      .map((t) => ({ text: t, word: /^[\p{L}\p{N}]/u.test(t) }));
  }

  // Vergleichsform: Kleinbuchstaben, ohne Akzente/Umlaut-Striche, ß = ss
  function fold(w) {
    return w.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function distance(a, b) {
    const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let diag = prev[0];
      prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
        diag = tmp;
      }
    }
    return prev[b.length];
  }

  // Kleine Tippfehler werden bei längeren Wörtern verziehen
  function matches(input, expected) {
    const a = fold(String(input).trim());
    const b = fold(expected);
    if (!a) return false;
    if (a === b) return true;
    const tolerance = b.length >= 9 ? 2 : b.length >= 5 ? 1 : 0;
    return tolerance > 0 && distance(a, b) <= tolerance;
  }

  // Wählt anteilig Wörter als Lücken aus (Indizes in tokens); Füllwörter nur, wenn sonst zu wenig übrig bleibt
  function pickBlanks(tokens, ratio, random = Math.random) {
    const words = tokens.map((t, i) => (t.word ? i : -1)).filter((i) => i >= 0);
    const strong = words.filter((i) => tokens[i].text.length >= 4 && !STOP.has(tokens[i].text.toLowerCase()));
    const pool = strong.length >= 3 ? strong : words;
    const count = Math.min(pool.length, Math.max(1, Math.round(pool.length * ratio)));
    const shuffled = pool.map((i) => [random(), i]).sort((x, y) => x[0] - y[0]);
    return new Set(shuffled.slice(0, count).map(([, i]) => i));
  }

  // Freitext-Vergleich: längste gemeinsame Wortfolge zwischen Vorlage und Eingabe.
  // Ergebnis: Vorlage mit ok/missing je Wort, Anzahl richtiger Wörter und überzählige Eingabewörter.
  function compare(expected, input) {
    const exp = tokenize(expected);
    const expWords = exp.filter((t) => t.word);
    const inWords = tokenize(input).filter((t) => t.word).map((t) => t.text);
    const n = expWords.length;
    const m = inWords.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = matches(inWords[j], expWords[i].text) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    const ok = new Set();
    const used = new Set();
    for (let i = 0, j = 0; i < n && j < m;) {
      if (matches(inWords[j], expWords[i].text) && lcs[i][j] === lcs[i + 1][j + 1] + 1) { ok.add(i); used.add(j); i++; j++; }
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
      else j++;
    }
    let w = -1;
    const tokens = exp.map((t) => (t.word ? { ...t, ok: ok.has(++w) } : t));
    return { tokens, correct: ok.size, total: n, extra: inWords.filter((_, j) => !used.has(j)) };
  }

  // Begriff-Definition-Paare aus eingefügtem Text, z. B. aus Skripten:
  // eine Karte beginnt in einer Zeile mit "Begriff - Definition" (auch – oder : als Trenner);
  // Zeilen ohne Trenner gehören zur vorigen Definition (Zeilenumbrüche aus PDFs).
  function parseCards(text) {
    const cards = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const m = line.match(/^(.{2,80}?)\s+[-–—]\s+(.+)$/) || line.match(/^([^:]{2,60}):\s+(.+)$/);
      if (m && m[1].split(/\s+/).length <= 8) cards.push({ term: m[1].trim(), definition: m[2].trim() });
      else if (cards.length) cards[cards.length - 1].definition += ' ' + line;
      else cards.push({ term: line, definition: '' });
    }
    return cards.map((c) => ({ ...c, definition: c.definition.replace(/\s+/g, ' ').trim() }));
  }

  return { tokenize, matches, pickBlanks, compare, parseCards, fold };
})();

if (typeof module !== 'undefined') module.exports = Cloze;
