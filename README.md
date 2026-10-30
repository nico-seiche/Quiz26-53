# Quiz26-53

Quiz-Plattform für den Studienkurs: Quiz erstellen und live zusammen spielen – ein Host zeigt Fragen, QR-Code und PIN auf dem großen Bildschirm, alle anderen spielen am Handy mit.

- **Mitspielen** geht immer, auch ohne Konto als Gast (nur mit Namen).
- **Ein Konto** braucht man, um Quiz zu speichern und zu hosten. Wer eingeloggt mitspielt, bekommt seine Punkte gespeichert.

## Architektur

```
Browser ──HTTP──▶ Vercel (statische Seiten + Express-API als Serverless-Funktion)
   ▲                           │
   │                           ▼
   └──Realtime-Signal── Supabase (Postgres + Realtime)
```

- **Vercel** liefert `public/` aus und betreibt die API (`api/index.js` → `src/app.js`).
- **Supabase Postgres** speichert Konten, Quiz, laufende Spiele und Ergebnisse (Schema `quiz`, nicht über die Supabase-REST-API erreichbar; die API verbindet sich mit der eigenen Rolle `quiz_app`).
- **Supabase Realtime**: Nach jeder Änderung an einem Spiel schickt die Datenbank ein `update`-Signal in den Kanal `game:<PIN>`. Host und Spieler laden daraufhin ihren Stand über die API neu. Ohne Realtime fragen die Seiten alle 2 Sekunden nach (Polling).
- **Timer**: Es gibt keinen dauerhaft laufenden Server. Eine Frage wird beim nächsten Abruf aufgelöst, sobald die Zeit abgelaufen ist oder alle geantwortet haben; die Browser fragen dafür zum Ablauf der Zeit automatisch nach.

## Lokal entwickeln

Voraussetzung: Node.js 22+ und eine Postgres-Datenbank.

```bash
npm install
psql "$ADMIN_DB_URL" -f supabase/migrations/001_init.sql -f supabase/migrations/002_app_role.sql
psql "$ADMIN_DB_URL" -c "ALTER ROLE quiz_app PASSWORD 'local'"
cp .env.example .env   # DATABASE_URL eintragen
npm run dev            # http://localhost:3000
```

Ohne `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` läuft alles per Polling.

## Deployment (Vercel + Supabase)

1. Migrationen aus `supabase/migrations/` im Supabase-Projekt ausführen und ein Passwort für `quiz_app` setzen.
2. Vercel-Projekt mit diesem GitHub-Repo verbinden (Framework: „Other“, kein Build nötig).
3. Umgebungsvariablen in Vercel setzen:
   - `DATABASE_URL` – Pooler-Verbindung (Transaction Mode, Port 6543) mit Benutzer `quiz_app.<projekt-ref>`
   - `SUPABASE_URL` – z. B. `https://<projekt-ref>.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY` – Publishable Key des Projekts (öffentlich, nicht geheim)
4. Jeder Push auf `master` wird automatisch deployt. `/api/health` prüft die Datenbankverbindung.

## Ablauf

1. **Konto** erstellen bzw. anmelden (`/`) – nur zum Erstellen/Hosten und Punktesammeln nötig
2. **Navigation:** Nach dem Login führt eine schwebende Leiste am unteren Bildschirmrand zu **Home** (`/dashboard`: PIN eingeben, Kennzahlen, zuletzt gespielt), **Quiz** (`/quizzes`: eigene Quiz verwalten und starten), **Bestenliste** (`/leaderboard`) und **Profil** (`/profile`: Statistik, Erfolge, Ergebnisse, Abmelden). Sie steht nicht im Editor und nicht im Spiel selbst (Host-Bildschirm, Handy-Ansicht).
3. **Editor** (`/edit`): Titel, Fach, Fragen mit 2–4 Antworten, richtige Antwort, Zeitlimit
4. **Starten** → **Host-Bildschirm** (`/host?pin=…`) mit QR-Code, PIN und Teilnehmerliste
5. Teilnehmende scannen den QR-Code oder geben die PIN ein (`/play`) – als Gast mit Namen oder eingeloggt mit ihrem Nutzernamen
6. Host steuert: Quiz starten → Auflösen (automatisch nach Ablauf der Zeit oder wenn alle geantwortet haben) → **Zwischenstand** (Rangliste, Überholte tauschen per Animation die Plätze) → Nächste Frage … → **Siegerehrung** (Treppchen mit Platz 3, 2, 1 nacheinander)

## Aufbau

```
api/index.js       Einstiegspunkt für Vercel
server.js          Lokaler Entwicklungsserver (API + statische Seiten)
src/app.js         Express-App mit allen API-Routen
src/db.js          Postgres-Verbindung
src/auth.js        Registrierung, Login, Sessions (httpOnly-Cookie, bcrypt)
src/quizzes.js     Quiz erstellen/bearbeiten/löschen
src/game.js        Live-Spiele: PIN, QR-Code, Spielablauf, Gäste, Punkte
src/config.js      Spielregeln (Mindestteilnehmer für die Wertung)
src/achievements.js Erfolge: Definitionen, Vergabe am Spielende, API
src/leaderboard.js Bestenliste (gesamt und je Fach)
src/results.js     Statistik und gespeicherte Ergebnisse eingeloggter Spieler
public/            Frontend (reines HTML/CSS/JS, kein Build-Schritt); js/common.js enthält u. a. die Navigation
supabase/          Datenbank-Migrationen
```

## Design, Level und Serie

Die Oberfläche folgt einem weichen Verlaufs-Design mit runden Karten, Level-Anzeige und bunter Navigation. Hinter den Home-Kacheln stehen echte Daten:

- **Level:** alle 2.000 Level-Punkte (gewertete Quizpunkte plus Lernpunkte) ein Level (`POINTS_PER_LEVEL` in `src/config.js`).
- **Tage-Serie:** aufeinanderfolgende Tage (Europa/Berlin) mit mindestens einem gewerteten Spiel; sie bleibt bestehen, wenn man gestern gespielt hat.
- **„+X heute“:** gewertete Punkte des heutigen Tages.
- **„Aufsteiger!“:** der Platz in der Gesamtwertung ist seit dem letzten gewerteten Spiel besser geworden.
- **Sammler-Titel:** Einsteiger, Entdecker, Sammler, Legende je nach Anzahl der Erfolge.
- Avatare sind der Anfangsbuchstabe auf einem Farbverlauf, Fach-Symbole Emojis.

## Freunde

Jeder Nutzer hat eine eindeutige fünfstellige ID (`quiz.users.friend_code`, 10000–99999, angezeigt als `#12345`; bei der Registrierung zufällig vergeben, Bestandsnutzer wurden per Migration `013_friends.sql` nachträglich versorgt). Unter **Profil → Freunde** (`/friends`) sucht man Spieler nach Namen (Teilstück) oder ID (Anfang); Treffer erscheinen beim Tippen als Vorschläge (`GET /api/friends/search`). Eine Anfrage wird erst mit „Annehmen“ zur Freundschaft; hat die Person schon angefragt, entsteht die Freundschaft sofort. Offene Anfragen zeigt ein roter Zähler am Profil-Symbol der Navigation. Interagieren kann man mit Freunden bisher nur, indem man sie im Quiz-Editor zum gemeinsamen Bearbeiten einlädt – dort werden Freunde beim Tippen vorgeschlagen, und nur Freunde lassen sich einladen (Tabelle `quiz.friendships`).

## Automatischer Ablauf

Nach dem Klick auf „Quiz starten“ läuft ein Spiel standardmäßig von selbst weiter (`quiz.games.auto`, im Host-Kopf per „⏩ Automatik“ umschaltbar): Eine Frage endet, sobald die Zeit um ist oder alle geantwortet haben; danach bleibt die Auflösung 5 s stehen (`AUTO_DELAY.reveal`), dann der Zwischenstand 4 s (`AUTO_DELAY.scoreboard`), dann geht es mit der nächsten Frage weiter bzw. nach der letzten in die Siegerehrung; die Team-Anzeige wartet 6 s. Der Host sieht „Weiter in n s“ und kann mit „⏭ Sofort weiter“ überspringen. Die Schritte führt der Server aus (`advanceState`/`updateGame` in `src/game.js`): Bei jedem Abruf wird geprüft, ob die Wartezeit seit dem letzten Zustandswechsel abgelaufen ist (`state_since`, per Trigger gesetzt). Die Seiten laden kurz nach dem erwarteten Wechsel von selbst neu (`autoAt`), sonst reicht das normale Aktualisieren. Es braucht also mindestens einen offenen Host- oder Spielerbildschirm, der abfragt.

## Host-Lobby: Infoleiste, schwebende Namen, Reaktionen

Der Host-Bildschirm zeigt in der Warteschlange oben eine kleine Infoleiste (Teilnehmer, Modus Einzel/Team, Zahl der Fragen, Fach, „zählt“ bzw. „noch n“ bis zur Mindestteilnehmerzahl), darunter QR-Code und PIN und eine große Fläche, auf der die Teilnehmer als Blasen mit Avatar langsam umherschweben (`.bubble`, reine CSS-Animation; bei „Bewegung reduzieren“ stehen sie still). Teilnehmer sehen auf dem Handy vier Emojis (👋 🔥 😂 🎉); ein Tipp ruft `POST /api/games/:pin/react` auf (höchstens eine Reaktion alle 0,6 s pro Spieler, nur in der Lobby, Tabelle `quiz.game_reactions`). Der Host holt neue Reaktionen beim normalen Aktualisieren (`GET /api/games/:pin/host?after=<id>`, zusätzlich per Supabase-Realtime beschleunigt) und lässt das Emoji bei der Blase des Spielers aufsteigen.

## Lernpunkte

Beim Üben mit Lernsets (`POST /api/study/cards/:id/review` mit `mode` und `share`) gibt es kleine Punkte (Tabelle `quiz.learn_events`): Karteikarten 5 (gewusst) bzw. 1, Lückentext bis 10, „Aus dem Kopf“ und „Tippen“ bis 15, anteilig nach dem Anteil richtiger Wörter. Pro Karte und Tag zählen höchstens 3 Wiederholungen (`LEARN_PER_CARD_PER_DAY` in `src/study.js`). Die Punkte zählen **fürs Level** (Level-Punkte = gewertete Quizpunkte + Lernpunkte, alle `POINTS_PER_LEVEL`), aber **nicht** für Bestenliste und Erfolge; angezeigt werden sie im eigenen Profil und auf dem Spielerprofil für andere („🧠 Lernpunkte“: gesamt, heute, 7 Tage, Balken der letzten 7 Tage und Aufteilung nach Lernart, `GET /api/study/stats`). Beim Lernen blendet ein „🧠 +8“ die Punkte ein, die Zusammenfassung nennt die Summe der Runde. Hören gibt keine Punkte.

## Animationen (auch bei reduzierter Bewegung)

Systeme wie Windows („Animationseffekte“ aus) melden `prefers-reduced-motion: reduce`; dann schaltete die Seite Animationen ab – im Edge sah man deshalb nichts Bewegtes. Jetzt sind Animationen **standardmäßig immer an**; die Klasse `reduce-motion` am `<html>` (gesetzt vom kleinen Skript im `<head>` aller Seiten) entsteht nur, wenn `localStorage.motion` auf `off` steht oder auf `auto` (= Gerät folgen) und das Gerät reduzierte Bewegung meldet. Zusätzlich verwenden die Animationen nur klassisches `transform`/`opacity` (keine einzelnen `translate`/`scale`-Eigenschaften), damit sie auch in älteren Browsern laufen. Auf der Profilseite gibt es dafür die Auswahl „🎬 Animationen“ (An / Wie mein Gerät / Aus) samt Hinweis. Die Regeln dafür stehen in `public/style.css` als `.reduce-motion …`; Host- und Spielseite lesen dieselbe Klasse.

## Hell/Dunkel-Schalter

Oben rechts neben dem Level (auf Seiten mit Navigation; auf dem Profil neben „Abmelden“) steht ein Schalter ☀️/🌙. Ohne Eingriff folgt die Seite dem Gerät (`prefers-color-scheme`); wer den Schalter benutzt, legt sein Thema in `localStorage` fest (`theme`: `light`/`dark`, als `data-theme` am `<html>`; ein kleines Skript im `<head>` setzt es vor dem Zeichnen, damit nichts aufblitzt). Die dunklen Farben stehen in `public/style.css` doppelt: einmal in der Medienabfrage (`:root:not([data-theme="light"])`) und einmal für `:root[data-theme="dark"]` – bei neuen dunklen Anpassungen beide ergänzen.

## Spielerprofile

Namen und Avatare registrierter Spieler sind Links (`profileLink()` in `public/js/common.js`) zu `/user?name=…` (Bestenliste, Freunde, Battle, Quiz-Editor). `GET /api/users/:name` (`src/users.js`) liefert Level, Gesamtpunkte, Platz, Tage-Serie, Punkte je Fach, Erfolge, Battle-Bilanz (gesamt und gegen den Betrachter) sowie die letzten fünf gewerteten Spiele; der Betrachter kann dort eine Freundschaftsanfrage senden/annehmen oder einen Freund entfernen. Dazu kommen die Lernpunkte (gesamt, 7 Tage, nach Lernart); der Lernfortschritt je Karte gehört nicht dazu. Das eigene Profil leitet auf `/profile` um. Gäste haben kein Profil und sind nicht verlinkt.

## Profilbild

Auf der Profilseite tippt man auf das eigene Bild und nimmt ein Foto auf oder wählt eins aus der Galerie. Der Browser schneidet quadratisch aus der Mitte zu, verkleinert auf 256 × 256 px und lädt es als JPEG hoch (`POST /api/me/avatar`, höchstens 150 kB, Dateianfang wird geprüft). Gespeichert wird es in `quiz.user_avatars`; `GET /api/avatar/<name>` liefert es nur angemeldeten Nutzern (ETag, 10 Minuten Cache). `avatarHtml()` in `public/js/common.js` legt das Bild über den Anfangsbuchstaben und entfernt es bei 404 – deshalb zeigen Bestenliste, Freunde, Battle usw. automatisch das Foto. Eigene Änderungen sind sofort sichtbar, andere sehen sie nach spätestens 10 Minuten.

## Lernsets gemeinsam bearbeiten

Wie bei Quiz: Der Besitzer lädt im Lernset-Editor **Freunde** (Name oder #ID) ein (`quiz.study_set_collaborators`). Eingeladene sehen das Set unter „Lernen“ (mit „🤝 von …“), dürfen Karten ändern, hinzufügen, löschen und per Text einfügen sowie damit lernen und Battles starten; Titel, Fach, Sichtbarkeit und Löschen bleiben beim Besitzer, jeder kann sich selbst austragen. Bestehende Sets werden live bearbeitet: Wer in eine Karte klickt, sperrt sie (`quiz.study_presence`, verfällt nach 8 s ohne Lebenszeichen), tippt, und die Karte wird kurz nach dem letzten Tastendruck automatisch gespeichert, wenn Begriff und Definition ausgefüllt sind. Der Editor ruft alle 2,5 s `POST /api/study/:id/live` (Lebenszeichen, Sperre, Stand der anderen), zusätzlich beschleunigt Supabase-Realtime (`game:s<id>`). Schnittstellen: `POST /cards`, `POST /cards/bulk`, `PUT/DELETE /cards/:cid` (nur mit eigener Sperre), `PATCH /meta`. Der Lernfortschritt bleibt pro Nutzer und Karte getrennt; die Kartenreihenfolge ist die Reihenfolge des Anlegens. Neue Sets legt man weiter einmal mit „Speichern“ an.

## Battle (1 gegen 1, Lückentext)

Bei einem Lernset (`/study`, Knopf „⚔️ Battle“) fordert man einen **Freund** heraus; der Freund nimmt die Einladung an (gültig 24 Stunden, Hinweis am „Lernen“-Symbol und auf Home). Danach spielen beide gleichzeitig bis zu 5 Runden (`/battle?id=…`): Pro Runde wird eine zufällige Karte des Sets gezogen, aus ihrer Definition wählt ein Skript (`public/js/cloze.js`, kein KI-Dienst) 3–8 wichtige Wörter als Lücken – für beide dieselben. Pro richtige Lücke gibt es 100 Punkte (Tippfehler bei längeren Wörtern werden verziehen), bei allen richtig noch bis zu 100 Tempo-Bonus. Eine Runde endet, sobald beide abgegeben haben oder nach 45 Sekunden (`BATTLE_ROUND_SECONDS`), danach folgt 7 Sekunden die Auflösung (`BATTLE_REVEAL_SECONDS`). Der Server entscheidet alles (`src/battles.js`): die Lösungen verlassen ihn erst in der Auflösung, Zeiten laufen bei jedem Zugriff nach. Aktualisiert wird per Polling (1,5 s) plus Supabase-Realtime (`game:b<id>`). Aufgeben lässt den Gegner gewinnen. Battles zählen nicht für Level, Bestenliste oder Erfolge.

## Gemeinsam an Quiz arbeiten

Im Quiz-Editor lädt der Besitzer unter „Zusammen bearbeiten“ Freunde (Name oder #ID) ein (Tabelle `quiz.quiz_collaborators`). Eingeladene sehen das Quiz in „Quiz“ (mit „von …“), dürfen Fragen ändern, hinzufügen, löschen, verschieben und das Quiz starten; Titel, Fach und Modus ändert, löscht und verwaltet nur der Besitzer, jeder kann sich selbst austragen.

**Live-Bearbeitung (Frage für Frage):** Bestehende Quiz werden im Editor automatisch gespeichert (kurz nach dem letzten Tastendruck, nur wenn die Frage vollständig ist). Der Editor meldet sich alle 2,5 s bei `POST /api/quizzes/:id/live` (Lebenszeichen, Sperre, Lesen) und holt dabei den Stand der anderen; zusätzlich beschleunigt ein Supabase-Realtime-Signal (`game:q<id>`, gesendet von `quiz.notify`) das Aktualisieren. Wer eine Frage aufklappt, sperrt sie in `quiz.quiz_presence` (Sperre verfällt nach 8 s ohne Lebenszeichen, `LOCK_SECONDS` in `src/quizzes.js`); die anderen sehen „✏️ Name bearbeitet“, können die Frage nicht ändern, Änderungen erscheinen bei allen. Jede Frage hat einen Zähler `rev`. Einzelne Schnittstellen: `POST /questions`, `PUT/DELETE /questions/:qid` (nur mit eigener Sperre), `PUT /order`, `PATCH /meta` (Besitzer). Neue Quiz werden weiterhin einmal mit „Speichern“ angelegt (`POST /api/quizzes`). Fragen, die gerade bearbeitet werden, fließen erst nach dem Speichern in laufende Spiele ein – Spiele arbeiten mit einer Kopie.

## Lernen (Lernsets)

Unter **Lernen** (`/study`) legt man Lernsets aus Begriff-Definition-Karten an (`/study-edit`). Längere Texte aus dem Skript lassen sich einfügen: pro Karte eine Zeile `Begriff - Definition`, Folgezeilen gehören zur vorigen Definition. Gelernt wird unter `/learn?id=…` auf drei Arten:

- **Karteikarten:** Begriff ansehen, Definition aufdecken, „Gewusst“ oder „Noch nicht“ (Tasten Leertaste, 1, 2).
- **Lückentext:** aus der Definition werden anteilig Wörter zu Lücken (Leicht 30 %, Mittel 60 %, Alle Begriffe 100 %). Die Auswahl erledigt ein Skript ohne KI: Füllwörter (Artikel, Präpositionen, Konjunktionen, Pronomen, Hilfs- und Modalverben, häufige Adverbien; Liste `STOP` in `public/js/cloze.js`) und Wörter unter 4 Buchstaben werden nie zur Lücke; Groß-/Kleinschreibung, Umlaute und kleine Tippfehler bei längeren Wörtern werden verziehen (`public/js/cloze.js`).
- **Tippen:** die Definition Wort für Wort abtippen (Leertaste beendet ein Wort). „💡 Nächstes Wort“ oder Enter ohne Text deckt das nächste Wort auf, danach tippt man weiter. Falsche Wörter werden rot markiert (alles danach ist „ausstehend“, bis der Fehler behoben ist) und lassen sich per Klick durch das richtige ersetzen; Backspace in einem leeren Feld holt das letzte Wort zurück. Groß-/Kleinschreibung und Satzzeichen spielen keine Rolle, Buchstaben müssen stimmen. Aufgedeckte und per Klick korrigierte Wörter zählen als Fehler (gewusst ab 80 %). Die Logik steht in `public/js/cloze.js` (`typingStatus`).
- **Aus dem Kopf:** die ganze Definition aufschreiben; verglichen wird wortweise in der richtigen Reihenfolge, fehlende Wörter werden rot markiert.

Als gewusst gilt eine Karte ab 80 % richtiger Wörter. Der Fortschritt folgt dem Karteikasten-System (Leitner): gewusst → eine Box höher (fällig nach 1, 3, 7, 21 Tagen), nicht gewusst → zurück in Box 0 und sofort wieder fällig; ab Box 3 gilt eine Karte als gelernt. Der Fortschritt gehört jedem Nutzer einzeln (Tabelle `quiz.card_progress`). Lernsets können für alle sichtbar gemacht und kopiert werden; bearbeiten darf nur der Besitzer. Die Intervalle stehen in `src/study.js` (`BOX_DAYS`).

### Hören (Vorlesen)

Die Lernart **🎧 Hören** liest die Karten nacheinander vor (Begriff, Pause, Definition, Pause); zusätzlich gibt es 🔊 „Vorlesen“ bei Karteikarten und im Lückentext/„Aus dem Kopf“. Die Stimme kommt von der Web Speech API des Geräts (`public/js/speech.js`): kein Server, keine Cloud, die Qualität hängt von den installierten deutschen Stimmen ab (Premium/Natural-Stimmen werden bevorzugt). Abkürzungen wie „§“, „Abs.“, „z. B.“ werden vor dem Vorlesen ausgeschrieben, lange Texte satzweise gesprochen (manche Browser brechen sonst ab). Hören ändert den Lernfortschritt nicht. Bei gesperrtem Display stoppt die Sprachausgabe auf vielen Handys. **Natürliche Stimmen (Piper):** Unter „Stimme“ gibt es zusätzlich Open-Source-Stimmen (Piper, Stimme Thorsten) (Code in `public/js/piper.js`, Phonemizer und Modelle von diffusionstudio/piper-wasm bzw. piper-voices). Sie laufen per WebAssembly im Browser; die Stimme (ca. 60 MB) wird beim ersten Wählen einmalig geladen und im Cache `piper-models-v1` gespeichert, das Modell bleibt danach im Arbeitsspeicher, erzeugtes Audio liegt zusätzlich im Cache `piper-audio-v1`. Die Wiedergabe nutzt ein einziges, per Fingertipp freigeschaltetes `<audio>`-Element (sonst blockieren Handys das Abspielen nach dem Rechnen) und hält den Bildschirm wach. Die nächste Karte wird schon während des Abspielens vorbereitet. Laufzeit und Phonemizer kommen zur Laufzeit von `cdn.jsdelivr.net`, die Stimmen von `huggingface.co` (Versionen sind in `public/js/speech.js` festgelegt). Gesetzeskürzel wie StGB werden buchstabiert. Die Erzeugung dauert auf dem Handy länger als das Sprechen; ohne Mehrthread-Unterstützung (kein `crossOriginIsolated`) läuft sie auf einem Kern.

## Fächer und Statistik

Jedes Quiz gehört zu einem Fach. Die Fächer liegen in der Tabelle `quiz.subjects` (aktuell Politik, Soziologie, Psychologie). Ein neues Fach ergänzt man im Supabase-SQL-Editor:

```sql
INSERT INTO quiz.subjects (name, position, icon) VALUES ('Statistik', 4, '📊');
```

`position` bestimmt die Reihenfolge, `icon` ist das Emoji in Quizliste und „Zuletzt gespielt“ (Standard 📘). Das Dashboard zeigt eingeloggten Spielern ihre Gesamtpunkte und die Punkte je Fach. Quiz aus der Zeit vor den Fächern erscheinen unter „Ohne Fach“.

**Mindestteilnehmer:** In Gesamtpunkte und Fächer-Statistik fließen nur Spiele mit mindestens 10 Teilnehmern ein (Gäste mitgezählt). Kleinere Spiele bleiben in „Meine Ergebnisse“ sichtbar, sind dort aber als „zählt nicht“ markiert. Der Wert steht in `src/config.js` (`MIN_PLAYERS_FOR_SCORING`) und wird beim Abruf der Statistik angewendet, eine Änderung gilt also auch rückwirkend.

## Bestenliste

Unter `/leaderboard` (Navigation → „Bestenliste“) sehen eingeloggte Nutzer alle registrierten Konten nach Punkten. Oben wählt man zwischen **Gesamt** und den einzelnen **Fächern**; die Auswahl steckt in der Adresse (`/leaderboard?subject=2`). Gleiche Punkte teilen sich den Platz, wer noch nichts gespielt hat, steht mit 0 Punkten am Ende. Die eigene Zeile ist hervorgehoben. Es zählen dieselben Spiele wie in der persönlichen Statistik (mindestens 10 Teilnehmer). Die Liste ist nur für eingeloggte Nutzer sichtbar.

## Serien-Bonus

Wer mehrere Fragen in Folge richtig beantwortet, bekommt Extrapunkte: ab der 2. richtigen Antwort in Folge +50 pro Serienschritt, höchstens +250 (also 2 in Folge: +50, 3: +100, … ab 6: +250). Eine falsche oder unbeantwortete Frage beendet die Serie. Auf dem Handy steht vor der Frage die aktuelle Serie samt möglichem Bonus, nach der Auflösung der erhaltene Bonus. Die Werte stehen in `src/config.js` (`STREAK_BONUS_PER_STEP`, `STREAK_BONUS_MAX`). Der Bonus zählt zu den normalen Punkten (Rangliste, Gesamtwertung); der Erfolg „Blitzmerker“ berücksichtigt nur die Basispunkte.

## Team-Modus

Der Spielmodus wird beim Erstellen (und Bearbeiten) eines Quiz festgelegt: **Einzel** oder **Team**. Bei einem Team-Quiz werden die Teilnehmer nach dem Klick auf „Teams bilden“ zufällig in **zwei Teams** (🦊 Füchse, 🦉 Eulen) verteilt, mindestens 4 Teilnehmer. Danach werden die Teams auf dem großen Bildschirm vorgestellt, jeder sieht auf dem Handy sein Team. Im Dashboard sind Team-Quiz mit „👥 Team“ gekennzeichnet.

- **Teampunkte** = Summe der Punkte aller Mitglieder; die Rangliste nach jeder Runde und die Siegerehrung zeigen die Teams (darunter die besten Einzelspieler).
- **Ungerade Teilnehmerzahl:** Ein Team hat dann genau einen Spieler mehr. Das kleinere Team bekommt einen **Geist-Spieler 👻**, der immer so viele Punkte hat wie der Durchschnitt seiner echten Mitspieler (aufgerundet auf ganze Punkte). Bei gerader Zahl gibt es keinen Geist.
- Jeder sammelt weiter seine Einzelpunkte (Gesamtwertung, Erfolge). Der Geist-Spieler hat keinen Einfluss darauf; Wertung und Mindestteilnehmerzahl gelten wie im normalen Spiel.

## Erfolge

Eingeloggte Spieler sammeln Erfolge (Dashboard → „Meine Erfolge“, am Spielende poppen neue auf dem Handy auf, der Host sieht sie unter der Siegerehrung). Sie werden nur in Spielen vergeben, die für die Gesamtwertung zählen (mindestens 10 Teilnehmer), und nur für Konten, nie für Gäste.

| Gruppe | Erfolg | Bedingung |
|---|---|---|
| Dabeisein | 🌱 Neuling | erstes gewertetes Quiz gespielt |
| | 📚 Stammgast / 🎓 Veteran | 5 / 20 gewertete Quiz |
| | 🧭 Allrounder | in jedem Fach ein gewertetes Quiz |
| | 💎 Punktesammler | 10.000 Punkte insgesamt |
| Siege | 🥉 Treppchen | unter den ersten 3 |
| | 🥇 Siegertyp / 👑 Seriensieger | 1 / 3 Siege |
| Starke Runden | 🎯 Volltreffer | alle Fragen richtig (mind. 5 Fragen) |
| | 🔥 Heißer Lauf | 5 richtige Antworten in Folge |
| | ⚡ Blitzmerker | 3 richtige Antworten in den ersten 10 % der Zeit |
| | 🚀 Raketenstart | in einer Runde um 3 Plätze aufgestiegen |
| Spielleitung | 🎤 Quizmaster | ein gewertetes Quiz als Host geleitet |
| Team | 🤝 Teamgeist | ein Quiz im Team-Modus mit dem eigenen Team gewonnen |

Die Erfolge sind in `src/achievements.js` definiert (Name, Symbol, Beschreibung); ein neuer Erfolg braucht dort einen Eintrag und eine Bedingung in `awardForGame`. Vergeben wird am Spielende, einmal pro Nutzer und Erfolg (`quiz.user_achievements`).

## Punkte

Aktuell einfache Wertung: richtige Antwort = 500–1000 Punkte, je schneller desto mehr. Die Logik steckt in `scoreAnswer()` in `src/game.js`. Am Spielende werden die Punkte aller eingeloggten Teilnehmenden in `quiz.game_results` gespeichert; Gäste werden nicht gespeichert. Laufende Spiele werden nach einem Tag gelöscht.

## Mehrfachauswahl und Umfragen

- **Mehrfachauswahl:** Im Editor kann jede Frage „Mehrere Antworten gleichzeitig wählbar“ sein (`questions.multi`, richtige Antworten als Bitmaske in `correct_mask`). Spieler schalten Antworten um und geben mit einem Button ab; Antworten werden als Bitmaske in `game_answers.mask` gespeichert (`choice` = kleinster gewählter Index). Punkte: Anteil `(richtige − falsche) / Anzahl richtiger` (mindestens 0) mal die Geschwindigkeitspunkte; Serie, Bonus und Erfolge nur bei komplett richtiger Antwort. Hilfsfunktionen in `src/answers.js`.
- **Umfragen:** `quizzes.kind = 'poll'`. Keine richtige Antwort, keine Punkte, keine Rangliste, kein Eintrag in Erfolgen oder Ergebnissen. Nach jeder Frage zeigt der Host ein Balkendiagramm, am Ende alle Diagramme (`public/js/poll.js`). Das Ergebnis wird in `poll_runs` gespeichert und ist für Besitzer und Mitbearbeiter unter `/poll-results?quiz=<id>` abrufbar (`/api/polls`).
- Migration: `supabase/migrations/021_multi_poll.sql`.

## Gesetze (§-Sammlung)

- Erreichbar über die Startseite und das Profil (`/gesetze`), für alle angemeldeten Nutzer (`/api/gesetze`, `src/gesetze.js`).
- Gesetzestexte liegen als JSON in `src/gesetze/<slug>.json` (Gliederung, Paragraphen, Absätze, Änderungshistorie) und werden mit `scripts/import-recht-nrw.js` aus der amtlichen Fassung auf recht.nrw.de erzeugt, z. B. `node scripts/import-recht-nrw.js <url> polg-nrw "PolG NRW" "Polizeigesetz des Landes Nordrhein-Westfalen"`. Neues Gesetz = JSON erzeugen und in `LAWS` (`src/gesetze.js`) eintragen.
- Oberfläche: Übersichtsseite je Gesetz (Zahlenraster, eine Reihe pro Zehnerblock, Paragraphen mit Buchstaben wie 12a stehen nicht im Raster oder Verzeichnis, sondern als „Dazu gehören“-Chips auf der Seite des Paragraphen; die Suche findet sie), Inhaltsverzeichnis mit Abschnitten (standardmäßig ausgeblendet, per Button), Suche (§-Nummer, Titel, Volltext), Verweise wie „§ 8“ im Text sind anklickbar (Verweise auf andere Gesetze nicht), Blättern mit ← →, Deep-Links `/gesetze#polg-nrw/37a`.
- Bundesgesetze kommen aus der amtlichen XML-Fassung von gesetze-im-internet.de: `node scripts/import-gii.js stpo StPO`. Unter Aufzählungen wie „aus dem Strafgesetzbuch:“ werden §-Angaben nicht verlinkt, weil sie sich auf ein anderes Gesetz beziehen.
- Nach dem Import `node scripts/build-gesetze-index.js` ausführen (schreibt `src/gesetze/index.json`, dort steht auch die Tab-Reihenfolge) und das Gesetz in `LOADERS` (`src/gesetze.js`) eintragen. Die Texte werden erst beim Öffnen geladen.
- Aktuell enthalten: PolG NRW (gültig ab 13.12.2025), OBG NRW (ab 01.07.2026), StGB, StPO, OWiG, StVO, StVZO, GG (Artikel statt Paragraphen) und BGB (z. B. `import-gii.js stgb StGB`, `owig_1968 OWiG`, `stvo_2013 StVO`, `stvzo_2012 StVZO`; Anlagen wie die Verkehrszeichen-Kataloge der StVO sind nicht dabei).

## Rangliste zurücksetzen

Die Bestenliste (und der Platz im Profil) zählt nur Spiele ab dem Stichtag `leaderboard_since` in `quiz.app_settings` (Migration `022_leaderboard_reset.sql`). Gespeicherte Spielergebnisse, Level, Profil-Statistik und Erfolge bleiben unberührt. Neuer Reset: `UPDATE quiz.app_settings SET value = now()::text WHERE key = 'leaderboard_since';`

## Einstellungen

`/settings` (Link im Profil): Profilbild, Passwort (`PATCH /api/auth/password`: altes Passwort + neues zweimal, andere Geräte werden abgemeldet; Mail-Verknüpfung/„Passwort vergessen“ ist bewusst noch nicht gebaut), Nutzername (`PATCH /api/auth/username`, gleiche Regeln wie bei der Registrierung, Punkte/Freunde/Quiz hängen an der Nutzer-ID und bleiben erhalten), Animationen, Freunde-ID. Neue Einstellungen kommen als weitere Karten dazu.

## Lernsets kopieren und aktualisieren

Beim Kopieren merkt sich die Kopie ihr Original (`study_sets.copied_from`, `synced_to`; Karten tragen `source_card_id`). Das Original verschwindet aus „Von anderen geteilt“, solange die Kopie aktuell ist. Wird es danach geändert, erscheint es mit „Update verfügbar“ und dem Knopf „Kopie aktualisieren“ (`POST /api/study/:id/sync`): neue Karten kommen dazu, geänderte werden übernommen, im Original gelöschte entfallen, eigene Zusatzkarten und der Lernfortschritt bleiben. Kopien, die vor Migration 023 entstanden sind, kennen ihr Original nicht und bleiben unverändert sichtbar.

## Folien

Präsentationen wie in PowerPoint: Link im Profil → `/slides` (Liste), `/slides-edit?id=` (Editor), `/slides-present?id=` (Präsentation; `&print=1` öffnet den Druckdialog als zweite Möglichkeit für ein PDF mit auswählbarem Text).

- **Daten:** `quiz.slide_decks` (ein JSON-Dokument je Präsentation, `rev` gegen unbemerktes Überschreiben) und `quiz.slide_assets` (Bilder als Bytes, werden vor dem Hochladen auf max. 1600 px verkleinert). Die API (`src/slides.js`, `/api/slides`) prüft das Dokument streng (Elementtypen, Farben, Schriftlisten, nur eigene Bild-URLs). Migration `024_slides.sql`.
- **Folie:** 1280 × 720 Einheiten, Elemente `text`, `shape` (Rechteck, Kreis, Dreieck) und `image`. Textfarbe „auto“ passt sich dem Hintergrund an. Gezeichnet wird alles von `public/js/slides-render.js` (Editor, Vorschaubilder, Präsentation, PDF).
- **Editor:** Folienleiste mit Ziehen zum Umsortieren, Layouts, Ziehen/Skalieren mit Einrasten (Mitte, Ränder, andere Elemente; Alt = ohne), Doppeltippen zum Texteingeben, Eigenschaften rechts, Rückgängig/Wiederholen, Strg+C/V/D, Pfeiltasten, Bilder per Knopf, Einfügen oder Drag & Drop, automatisches Speichern.
- **Bausteine:** Der Knopf „▦ Blöcke“ im Editor öffnet fertige Blöcke mit Vorschau: Überschrift 1–3, Textabsatz, Zitat, Aufzählung, nummerierte Liste, Buttons (gefüllt/Umriss), Bildplatzhalter (16:9/quadratisch) und Tabellen. Tabellen (`type: table`) lassen sich zellenweise bearbeiten (Doppeltippen, Tab springt weiter) und haben Zeilen-/Spalten-Knöpfe, Kopfzeile und Streifen. Bildplatzhalter (`type: placeholder`) werden per Knopf, Drag & Drop oder Einfügen durch ein Bild ersetzt und erscheinen nicht in Präsentation und PDF. Buttons können in der Präsentation auf eine Folie springen (`goto`).
- **Farben und Hintergrund:** Farbfelder öffnen eine Auswahl mit Standardfarben und eigenen Farben (Farbwähler oder Hex-Code, gespeichert in der Präsentation, ✎ zum Löschen). Der Folienhintergrund ist Farbe, Verlauf (zwei Farben + Richtung, eigene Verläufe speicherbar) oder Bild (hochgeladen, Füllen/Ganz zeigen, heller/dunkler, Farbe dahinter). Nach dem Ändern fragt der Editor, ob der Hintergrund für alle Folien gelten soll.
- **PDF-Export:** Der Knopf „⬇ PDF“ (Editor und Liste) lädt direkt eine Datei herunter: `public/js/slides-pdf.js` zeichnet jede Folie mit dem Renderer, macht ein Bild (html2canvas, 1920 × 1080) und setzt die Seiten mit jsPDF zusammen (beide Bibliotheken werden erst beim ersten Export von cdnjs geladen). Der Text im PDF ist dadurch ein Bild und nicht auswählbar.
- **Präsentation:** Pfeiltasten/Leertaste/Wischen, Übergänge (Überblenden, Schieben), `N` Notizen, `F` Vollbild, `B` schwarz, `Esc` beenden.
- **Zugriff:** für alle angemeldeten Nutzer; jede Präsentation gehört ihrem Ersteller.

## Startseite

Unter „Einem Quiz beitreten“ ist die Schnellauswahl zweigeteilt: links **Erstellen** (Quiz, Umfrage über `/edit?kind=poll`, Lernset, Präsentation), rechts **Ansehen** (Meine Quiz, Lernen, Präsentationen, Gesetze, Bestenliste).

## Zoom

Zoomen per Pinch und Doppeltippen ist abgeschaltet (`maximum-scale=1, user-scalable=no`, `touch-action: pan-x pan-y`, `gesturestart` abgefangen; auf Touch-Geräten haben Eingabefelder mindestens 16 px, damit iOS nicht hineinzoomt).

## Passwort anzeigen

Alle Passwortfelder (Anmelden, Registrieren, Passwort ändern) haben ein Auge zum Anzeigen/Verbergen (`addPasswordToggles` in `public/js/common.js`); beim Absenden und Verlassen der Seite wird das Passwort wieder verdeckt.
