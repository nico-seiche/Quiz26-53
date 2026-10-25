// Neuigkeiten. Neuer Eintrag = neues Objekt GANZ OBEN (id eindeutig, z. B. Datum);
// danach sehen alle das Fenster einmal wieder. Nur Einträge mit coolen Neuerungen aufnehmen.
const CHANGELOG = [
  {
    id: '2026-10-27',
    title: 'Neu: Lobby-Reaktionen',
    items: [
      ['🫧', 'Schwebende Namen', 'In der Warteschlange schweben alle Teilnehmer als Blasen über den Host-Bildschirm.'],
      ['🔥', 'Reaktionen', 'Wer wartet, kann dem Host-Bildschirm 👋 🔥 😂 🎉 schicken – sie steigen bei der Person auf.'],
      ['ℹ️', 'Infoleiste', 'Oben stehen kompakt Teilnehmerzahl, Modus, Fragen, Fach und ob das Quiz zählt.'],
    ],
  },
  {
    id: '2026-10-26b',
    title: 'Neu: Profilbild',
    items: [
      ['📷', 'Dein eigenes Bild', 'Tippe auf dein Profilbild unter „Profil“ und mach ein Foto oder wähle eins aus der Galerie.'],
      ['👀', 'Überall sichtbar', 'Freunde sehen dein Bild in der Bestenliste, in der Freundesliste und im Battle.'],
    ],
  },
  {
    id: '2026-10-26',
    title: 'Neu: Battle',
    items: [
      ['⚔️', 'Gegen einen Freund spielen', 'Fordere unter „Lernen“ bei einem Lernset einen Freund zum Lückentext-Battle heraus.'],
      ['⏱️', 'Gleichzeitig, schnell und genau', 'Ihr füllt in 5 Runden dieselben Lücken aus. Jede richtige Lücke zählt, wer alles richtig hat, bekommt einen Tempo-Bonus.'],
      ['🏆', 'Sieg & Revanche', 'Am Ende siehst du das Ergebnis jeder Runde – und kannst direkt Revanche fordern.'],
    ],
  },
  {
    id: '2026-10-25c',
    title: 'Neu: Gleichzeitig bearbeiten',
    items: [
      ['⚡', 'Live zusammen arbeiten', 'Mehrere Freunde können dasselbe Quiz gleichzeitig bearbeiten. Änderungen speichern sich automatisch und erscheinen bei allen nach wenigen Sekunden.'],
      ['🔒', 'Eine Frage, eine Person', 'Wer eine Frage bearbeitet, sperrt sie kurz für die anderen („Anna bearbeitet“). So überschreibt sich niemand.'],
      ['🟢', 'Wer ist dabei?', 'Oben siehst du, wer gerade im Quiz ist und an welcher Frage.'],
    ],
  },
  {
    id: '2026-10-25b',
    title: 'Neu: Freunde',
    items: [
      ['#️⃣', 'Deine ID', 'Jeder hat jetzt eine fünfstellige ID wie #12345. Du findest sie unter Profil → Freunde.'],
      ['🔎', 'Freunde finden', 'Such nach Namen oder ID – passende Spieler werden beim Tippen vorgeschlagen. Eine Anfrage wird erst mit „Annehmen“ zur Freundschaft.'],
      ['👥', 'Zum Quiz einladen', 'Freunde kannst du im Quiz-Editor zum gemeinsamen Bearbeiten einladen.'],
    ],
  },
  {
    id: '2026-10-25',
    title: 'Neu: Gemeinsam an Quiz arbeiten',
    items: [
      ['👥', 'Freunde einladen', 'Im Quiz-Editor unter „Zusammen bearbeiten“ lädst du Freunde per Nutzername ein. Sie sehen das Quiz dann unter „Quiz“.'],
      ['✏️', 'Gemeinsam bearbeiten und starten', 'Eingeladene können Fragen ändern und das Quiz starten. Löschen und Einladen bleibt beim Besitzer.'],
      ['🛡️', 'Nichts geht verloren', 'Haben zwei gleichzeitig gespeichert, fragt die App nach, bevor sie etwas überschreibt.'],
    ],
  },
  {
    id: '2026-10-24e',
    title: 'Neu: Tippen',
    items: [
      ['⌨️', 'Definition abtippen', 'Neue Lernart: Tippe die Definition Wort für Wort ab. Weißt du nicht weiter, deckt „Nächstes Wort“ (oder Enter) das nächste Wort auf – danach tippst du einfach weiter.'],
      ['🔴', 'Fehler direkt korrigieren', 'Falsche Wörter werden rot markiert. Ein Klick darauf ersetzt sie durch das richtige Wort.'],
    ],
  },
  {
    id: '2026-10-24d',
    title: 'Neu: Lernen mit den Ohren',
    items: [
      ['🎧', 'Hören', 'Neue Lernart: Begriffe und Definitionen werden nacheinander vorgelesen – ideal für unterwegs. Tempo und Stimme sind wählbar.'],
      ['🎙️', 'Natürliche Stimme', 'Wähle unter „Stimme“ die natürlich klingende Open-Source-Stimme Thorsten. Sie wird einmal geladen (ca. 60 MB, am besten im WLAN) und läuft dann direkt auf deinem Gerät.'],
      ['🔊', 'Vorlesen', 'Bei Karteikarten und im Lückentext lässt sich die Lösung per Knopf anhören.'],
    ],
  },
  {
    id: '2026-10-24b',
    title: 'Neu: Lernen',
    items: [
      ['📚', 'Lernsets', 'Lege Begriffe mit ihren Definitionen an – oder füge ganze Passagen aus deinem Skript auf einmal ein.'],
      ['🃏', 'Karteikarten', 'Begriff ansehen, Definition aufdecken, bewerten. Sicheres kommt seltener, Unsicheres öfter.'],
      ['✏️', 'Lückentext', 'Lange Definitionen Schritt für Schritt auswendig lernen: Lücken entstehen automatisch bei den wichtigen Begriffen, Füllwörter wie „der“ oder „von“ bleiben stehen.'],
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
