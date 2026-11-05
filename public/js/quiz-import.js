// Quiz-Import aus Text (z. B. von einer KI erstellt). Das Format ist absichtlich einfach, damit jede KI es sicher einhält:
//   TITEL: …          (optional)
//   FACH: …           (optional, Name aus der Fächerliste)
//   ART: Quiz|Umfrage (optional, Standard Quiz)
//
//   FRAGE: …          (Zeile für Zeile, Fragen durch Leerzeile getrennt)
//   ZEIT: 20          (optional, 5–120 Sekunden)
//   [x] richtige Antwort
//   [ ] falsche Antwort
// Mehrere [x] = Mehrfachauswahl. Bei Umfragen gibt es keine [x]. 2–4 Antworten pro Frage.
const QuizImport = (() => {
  const MAX_QUESTIONS = 100;

  function prompt(subjects, topicHint = '') {
    return `Erstelle ein Quiz${topicHint ? ` zum Thema: ${topicHint}` : ' zum Thema: [HIER THEMA, ZIELGRUPPE UND ANZAHL DER FRAGEN EINTRAGEN]'}.

Antworte AUSSCHLIESSLICH mit dem Quiz im folgenden Textformat – ohne Einleitung, ohne Erklärungen, ohne Markdown-Formatierung (keine Sterne, keine Tabellen, keine Nummerierung):

TITEL: <kurzer Titel>
FACH: <genau eines aus: ${subjects.map((s) => s.name).join(' | ') || '(egal)'}>
ART: Quiz

FRAGE: <Fragetext>
ZEIT: <Sekunden zum Antworten, 5 bis 120, Standard 20>
[x] <richtige Antwort>
[ ] <falsche Antwort>
[ ] <falsche Antwort>
[ ] <falsche Antwort>

FRAGE: <nächste Frage>
…

Regeln:
- Jede Frage beginnt mit "FRAGE:" und wird durch eine Leerzeile von der nächsten getrennt.
- Jede Frage hat 2 bis 4 Antworten; jede Antwort steht in einer eigenen Zeile und beginnt mit "[ ]" (falsch) oder "[x]" (richtig).
- Normalerweise genau eine richtige Antwort. Bei Mehrfachauswahl-Fragen dürfen mehrere Antworten "[x]" haben (mindestens eine, aber nicht alle).
- Die Reihenfolge der richtigen Antworten soll variieren (nicht immer die erste).
- Antworten kurz halten (am besten unter 80 Zeichen), Fragen eindeutig und fachlich korrekt formulieren.
- "ZEIT:" ist optional; ohne die Zeile gelten 20 Sekunden.
- Für eine Umfrage statt eines Quiz: "ART: Umfrage" und keine Antwort mit "[x]" markieren.`;
  }

  const clean = (s) => s.replace(/\*\*|__|`/g, '').replace(/^[\s>#]+/, '').trim();

  // → { title, subjectName, kind, questions: [{ text, answers, correct, correctSet, multi, timeLimit }], errors: [], warnings: [] }
  function parse(raw) {
    const out = { title: '', subjectName: '', kind: null, questions: [], errors: [], warnings: [] };
    const lines = String(raw || '').replace(/\r/g, '').split('\n');
    let cur = null;
    let n = 0;
    const finish = () => {
      if (!cur) return;
      const nr = out.questions.length + 1;
      const label = `Frage ${nr}${cur.text ? ` („${cur.text.slice(0, 40)}${cur.text.length > 40 ? '…' : ''}“)` : ''}`;
      const answers = cur.answers;
      const marked = answers.map((a, i) => (a.ok ? i : -1)).filter((i) => i >= 0);
      if (!cur.text) out.errors.push(`${label}: Fragetext fehlt`);
      else if (answers.length < 2) out.errors.push(`${label}: mindestens 2 Antworten nötig`);
      else if (answers.length > 4) out.errors.push(`${label}: höchstens 4 Antworten möglich (hat ${answers.length})`);
      else {
        out.questions.push({ text: cur.text, answers: answers.map((a) => a.t), marked, timeLimit: cur.time, line: cur.line, label });
      }
      cur = null;
    };
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^\s*```/.test(line)) continue;
      const t = clean(line);
      if (!t) { if (cur && cur.answers.length) finish(); continue; }
      let m;
      if ((m = /^(titel|thema)\s*:\s*(.+)$/i.exec(t)) && !cur) { out.title = m[2].trim().slice(0, 120); continue; }
      if ((m = /^fach\s*:\s*(.+)$/i.exec(t)) && !cur) { out.subjectName = m[1].trim(); continue; }
      if ((m = /^art\s*:\s*(.+)$/i.exec(t)) && !cur) { out.kind = /umfrage|poll/i.test(m[1]) ? 'poll' : 'quiz'; continue; }
      if ((m = /^(?:frage|f)\s*\d*\s*[:.)]\s*(.*)$/i.exec(t))) { finish(); n += 1; cur = { text: m[1].trim(), answers: [], time: 20, line: i + 1 }; continue; }
      if ((m = /^(?:zeit|zeitlimit)\s*:\s*(\d+)/i.exec(t)) && cur) {
        const s = Number(m[1]);
        if (s >= 5 && s <= 120) cur.time = s; else out.warnings.push(`Frage ${out.questions.length + 1}: Zeit ${s}s liegt außerhalb 5–120 – 20 Sekunden genommen`);
        continue;
      }
      if ((m = /^(?:[-*•]\s*)?\[\s*([xX✓✔]?)\s*\]\s*(.+)$/.exec(t)) && cur) {
        cur.answers.push({ ok: Boolean(m[1]), t: m[2].replace(/^[A-Da-d][).]\s+/, '').trim() });
        continue;
      }
      // Fortsetzung des Fragetexts (mehrzeilig), solange noch keine Antwort kam
      if (cur && !cur.answers.length) cur.text = `${cur.text} ${t}`.trim();
      else if (cur && cur.answers.length) cur.answers[cur.answers.length - 1].t += ` ${t}`;
      else out.warnings.push(`Zeile ${i + 1} ignoriert: „${t.slice(0, 50)}“`);
    }
    finish();
    if (out.questions.length > MAX_QUESTIONS) { out.warnings.push(`Nur die ersten ${MAX_QUESTIONS} Fragen werden übernommen.`); out.questions.length = MAX_QUESTIONS; }
    if (!out.questions.length && !out.errors.length) out.errors.push('Keine Fragen erkannt – beginnt jede Frage mit „FRAGE:“?');
    return out;
  }

  // Prüft Fragen gegen die Art (Quiz/Umfrage) und liefert Editor-Fragen; Fehler → in errors
  function finalize(parsed, kind) {
    const errors = [...parsed.errors];
    const questions = [];
    for (const q of parsed.questions) {
      const answers = q.answers.slice(0, 4);
      if (kind === 'poll') {
        questions.push({ text: q.text, answers, correct: 0, multi: false, correctSet: [], timeLimit: q.timeLimit });
        continue;
      }
      if (!q.marked.length) { errors.push(`${q.label}: keine richtige Antwort mit [x] markiert`); continue; }
      if (q.marked.length === answers.length) { errors.push(`${q.label}: alle Antworten sind als richtig markiert`); continue; }
      const multi = q.marked.length > 1;
      questions.push({ text: q.text, answers, correct: q.marked[0], multi, correctSet: multi ? q.marked : [], timeLimit: q.timeLimit });
    }
    return { questions, errors };
  }

  return { prompt, parse, finalize };
})();
