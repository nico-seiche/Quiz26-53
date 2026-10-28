// Antworten und richtige Lösungen als Bitmasken: Bit i = Antwort i. So behandeln Einzel- und Mehrfachauswahl dasselbe.
const popcount = (n) => { let c = 0; for (let x = n; x; x &= x - 1) c++; return c; };
const bit = (i) => 1 << i;

// Gewählte Antworten einer gespeicherten Antwort (ältere Zeilen haben nur "choice")
const answerMask = (answer) => (answer.mask != null ? answer.mask : bit(answer.choice));

// Richtige Antworten einer Frage; 0 bei Umfragen (es gibt kein richtig/falsch)
const correctMask = (q) => (q.multi ? (q.correctMask || 0) : (q.correct == null ? 0 : bit(q.correct)));

const indexes = (mask, n) => Array.from({ length: n }, (_, i) => i).filter((i) => mask & bit(i));

// Genau die richtigen Antworten gewählt?
function isFullyCorrect(q, answer) {
  const c = correctMask(q);
  return c !== 0 && answerMask(answer) === c;
}

// Anteil 0…1 für Mehrfachauswahl: richtige Treffer minus Fehlgriffe, geteilt durch die Zahl richtiger Antworten
function share(q, answer) {
  const c = correctMask(q);
  if (!c) return 0;
  const picked = answerMask(answer);
  return Math.max(0, (popcount(picked & c) - popcount(picked & ~c)) / popcount(c));
}

module.exports = { popcount, bit, answerMask, correctMask, indexes, isFullyCorrect, share };
