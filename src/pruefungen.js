// Prüfungsvorlagen für die Learnworld: ein Dokument mit Feld für den Sachverhalt und allen Prüfungspunkten als Überschriften,
// unter die man seine Prüfung schreibt (im Editor lassen sich die Abschnitte per Chevron ein- und ausklappen).
const N = (t, ...c) => ({ t, c });

const TEMPLATES = {
  praeventiv: {
    title: 'Prüfung präventiv',
    icon: '🛡️',
    courses: ['eingriffsrecht'],
    nodes: [
      N('Vorprüfung',
        N('Nennen der Maßnahme(n)'),
        N('Grundrechtsprüfung (Eingriff, sachlicher Schutzbereich)'),
        N('Präventive oder repressive Zielrichtung (PolG NRW oder StPO oder OWiG)'),
        N('Rechtsnatur der Eingriffsmaßnahme (Verwaltungsakt gem. § 35 VwVfG oder Realakt)')),
      N('Formelle Rechtmäßigkeit',
        N('Sachliche Zuständigkeit – §§ 1 I S. 1 und S. 2 (oder S. 1 und S. 3) PolG i.V.m. §§ 10, 11 I Nr. 1 POG'),
        N('Örtliche Zuständigkeit – § 7 I POG'),
        N('Allgemeine Verfahrensvorschriften (§§ 28 I, 37 I VwVfG) und Formvorschriften (§§ 37 II und III, 39, 41, 43 VwVfG)')),
      N('Materielle Rechtmäßigkeit',
        N('Zulässigkeit der Eingriffsmaßnahme'),
        N('Ermächtigungsgrundlage',
          N('Tatbestandsvoraussetzungen'),
          N('Rechtsfolge'),
          N('Anordnungs- und Durchführungskompetenz'),
          N('Verfahrens- und Formvorschriften')),
        N('Adressat'),
        N('Pflichtgemäße Ermessensausübung'),
        N('Übermaßverbot (Geeignetheit, Erforderlichkeit, Angemessenheit)')),
      N('Ergebnisfeststellung'),
    ],
  },
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const LETTER = (i) => String.fromCharCode(65 + i);
// Gliederungszeichen je Ebene: A. / I. / 1.
const label = (depth, i) => (depth === 0 ? `${LETTER(i)}.` : depth === 1 ? `${ROMAN[i] || i + 1}.` : `${i + 1}.`);

// Quill-Delta: „Sachverhalt“ mit leerem Textabsatz, danach jeder Prüfungspunkt als Überschrift (Ebene 1–3) mit leerem Absatz darunter
function buildDelta(template) {
  const ops = [];
  const heading = (text, level) => { ops.push({ insert: text }, { insert: '\n', attributes: { header: level } }); };
  const blank = () => ops.push({ insert: '\n' });
  heading('Sachverhalt', 1);
  blank();
  const walk = (nodes, depth) => nodes.forEach((n, i) => {
    heading(`${label(depth, i)} ${n.t}`, Math.min(depth + 1, 3));
    if (n.c && n.c.length) walk(n.c, depth + 1); else blank();
  });
  walk(template.nodes, 0);
  return ops;
}

const forCourse = (slug) => Object.entries(TEMPLATES).filter(([, t]) => t.courses.includes(slug)).map(([id, t]) => ({ id, title: t.title, icon: t.icon }));

module.exports = { TEMPLATES, buildDelta, forCourse };
