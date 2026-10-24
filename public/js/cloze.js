// Hilfen zum Auswendiglernen langer Definitionen: Lücken erzeugen und Antworten tolerant vergleichen.
// Reine Funktionen ohne Seitenzugriff, damit sie sich auch in Node testen lassen.
const Cloze = (() => {
  // Füllwörter, die nie als Lücke dienen sollen: Artikel, Präpositionen, Konjunktionen, Pronomen,
  // Hilfs-/Modalverben und häufige Adverbien. Übrig bleiben die Begriffe, auf die es ankommt.
  const STOP = new Set(`
    der die das den dem des ein eine einer einem einen eines kein keine keiner keinem keinen keines
    und oder aber sondern denn sowie sowohl auch noch nur schon bereits bzw usw etc ggf evtl
    wenn dann als wie weil da dass ob obwohl während bevor nachdem indem damit falls sofern soweit solange sobald
    von vom zu zum zur zum bei beim mit ohne nach aus auf an am im in ins um für gegen durch über unter vor hinter neben
    zwischen bis seit ab außer entlang trotz wegen statt innerhalb außerhalb gemäß laut per pro
    ich du er sie es wir ihr man sich mich dich uns euch ihn ihm ihnen ihre ihrer ihren ihrem ihres sein seine seiner seinen
    seinem seines mein dein unser euer dieser diese dieses diesem diesen jener jene jenes welche welcher welches welchen
    wer was wo wann wie wohin woher wobei wodurch wofür dabei dafür dagegen davon dazu daher deshalb deswegen darum
    ist sind war waren wird werden wurde wurden worden wäre wären sei seien bin bist seid hat haben hatte hatten hätte
    kann können konnte konnten könnte könnten muss müssen musste müsste soll sollen sollte sollten darf dürfen durfte
    will wollen wollte mag mögen möchte möchten lässt lassen gibt geben gilt gelten liegt liegen vor
    nicht kein nichts nie niemals immer oft meist meistens manchmal selten stets jeweils jeder jede jedes jedem jeden
    alle allen aller alles aller viele vielen mehr mehrere einige einigen etwa etwas sehr ganz gar fast eher zudem zwar
    also somit dennoch jedoch doch hier dort dann nun jetzt heute bereits ebenso ebenfalls sonst ansonsten insbesondere
    sog sogenannte sogenannten sogenannter bestimmte bestimmten bestimmter bestimmtes bzw
  `.split(/\s+/).filter(Boolean).map((w) => fold(w)));

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

  // Inhaltswort = kein Füllwort und mindestens 4 Buchstaben (oder eine Zahl)
  function isContent(word) {
    return !STOP.has(fold(word)) && (word.length >= 4 || /\d/.test(word));
  }

  // Wählt anteilig Inhaltswörter als Lücken aus (Indizes in tokens). Füllwörter werden nie gewählt;
  // nur wenn ein Text gar keine Inhaltswörter hat, bleibt keine Lücke übrig und es wird das längste Wort genommen.
  function pickBlanks(tokens, ratio, random = Math.random) {
    const words = tokens.map((t, i) => (t.word ? i : -1)).filter((i) => i >= 0);
    let pool = words.filter((i) => isContent(tokens[i].text));
    if (!pool.length && words.length) pool = [words.reduce((a, b) => (tokens[b].text.length > tokens[a].text.length ? b : a))];
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

  // --- Lernart "Tippen": Definition Wort für Wort abtippen, mit Aufdecken und Korrektur per Klick ---

  // Die Wörter, die getippt werden müssen (ohne Satzzeichen)
  const typingWords = (definition) => tokenize(definition).filter((t) => t.word).map((t) => t.text);

  // Eingabe säubern: Satzzeichen an den Rändern weg
  const cleanWord = (w) => String(w).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

  // Gleichheit beim Tippen: Groß-/Kleinschreibung egal, ß = ss, Umlaute und Buchstaben müssen stimmen
  const sameWord = (a, b) => cleanWord(a).toLowerCase().replace(/ß/g, 'ss') === cleanWord(b).toLowerCase().replace(/ß/g, 'ss');

  // Bewertet die bisher eingegebenen Wörter (entries: {text, hint}) gegen die erwarteten.
  // 'ok' = richtig, 'bad' = der erste Fehler, 'pending' = nach dem ersten Fehler, wird erst danach bewertet.
  function typingStatus(entries, expected) {
    let broken = false;
    return entries.map((e, i) => {
      if (broken) return 'pending';
      if (i < expected.length && (e.hint || sameWord(e.text, expected[i]))) return 'ok';
      broken = true;
      return 'bad';
    });
  }

  return { tokenize, matches, isContent, pickBlanks, compare, parseCards, fold, typingWords, cleanWord, sameWord, typingStatus };
})();

if (typeof module !== 'undefined') module.exports = Cloze;
