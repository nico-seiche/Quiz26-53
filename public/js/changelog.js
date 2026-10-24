// Neuigkeiten. Neuer Eintrag = neues Objekt GANZ OBEN (id eindeutig, z. B. Datum);
// danach sehen alle das Fenster einmal wieder. Nur Einträge mit coolen Neuerungen aufnehmen.
const CHANGELOG = [
  {
    id: '2026-10-24',
    title: 'Neu: Lernen',
    items: [
      ['📚', 'Lernsets', 'Lege Begriffe mit ihren Definitionen an – oder füge ganze Passagen aus deinem Skript auf einmal ein.'],
      ['🃏', 'Karteikarten', 'Begriff ansehen, Definition aufdecken, bewerten. Sicheres kommt seltener, Unsicheres öfter.'],
      ['✏️', 'Lückentext', 'Lange Definitionen Schritt für Schritt auswendig lernen: erst wenige, dann alle Wörter als Lücke.'],
      ['🧠', 'Aus dem Kopf', 'Schreib die Definition komplett auf – fehlende Wörter werden markiert.'],
      ['🌍', 'Teilen', 'Lernsets lassen sich für den Kurs freigeben und kopieren.'],
    ],
  },
  {
    id: '2026-10-23',
    title: 'Neues Design & Level',
    items: [
      ['🎨', 'Frisches Design', 'Neuer Look mit weichen Farben, runden Karten und bunter Navigation.'],
      ['🏅', 'Level & Tage-Serie', 'Alle 2.000 Punkte steigst du ein Level auf. Spiel an aufeinanderfolgenden Tagen für eine Serie 🔥.'],
      ['📈', 'Aufsteiger-Anzeige', 'Home zeigt deine Punkte von heute, deinen Platz und ob du in der Bestenliste aufgestiegen bist.'],
      ['👥', 'Teammodus & Streak-Bonus', 'Zwei Teams mit Geist-Spieler und Bonuspunkte für Antwortserien.'],
      ['🏆', 'Erfolge & Bestenliste', '14 Erfolge zum Sammeln und eine Bestenliste insgesamt und pro Fach.'],
    ],
  },
];

function showChangelog() {
  const latest = CHANGELOG[0];
  try { if (localStorage.getItem('changelog-seen') === latest.id) return; } catch {}
  const box = document.createElement('div');
  box.className = 'changelog-backdrop';
  box.innerHTML = `
    <div class="changelog card" role="dialog" aria-modal="true" aria-labelledby="changelog-title">
      <button type="button" class="changelog-x" aria-label="Schließen">✕</button>
      <span class="tag">✨ Neu</span>
      <h2 id="changelog-title">${escapeHtml(latest.title)}</h2>
      <ul>${latest.items.map(([icon, name, text]) => `
        <li><span class="changelog-icon" aria-hidden="true">${icon}</span>
          <div><strong>${escapeHtml(name)}</strong><br><span class="muted">${escapeHtml(text)}</span></div></li>`).join('')}
      </ul>
      <button type="button" class="primary changelog-ok">Los geht’s!</button>
    </div>`;
  const close = () => {
    try { localStorage.setItem('changelog-seen', latest.id); } catch {}
    box.remove();
  };
  box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('.changelog-x, .changelog-ok')) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, { once: true });
  document.body.appendChild(box);
  box.querySelector('.changelog-ok').focus();
}
