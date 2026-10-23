# Quiz26-53

Quiz-Plattform für den Studienkurs: Quizze erstellen und live zusammen spielen – ein Host zeigt Fragen, QR-Code und PIN auf dem großen Bildschirm, alle anderen spielen am Handy mit.

- **Mitspielen** geht immer, auch ohne Konto als Gast (nur mit Namen).
- **Ein Konto** braucht man, um Quizze zu speichern und zu hosten. Wer eingeloggt mitspielt, bekommt seine Punkte gespeichert.

## Architektur

```
Browser ──HTTP──▶ Vercel (statische Seiten + Express-API als Serverless-Funktion)
   ▲                           │
   │                           ▼
   └──Realtime-Signal── Supabase (Postgres + Realtime)
```

- **Vercel** liefert `public/` aus und betreibt die API (`api/index.js` → `src/app.js`).
- **Supabase Postgres** speichert Konten, Quizze, laufende Spiele und Ergebnisse (Schema `quiz`, nicht über die Supabase-REST-API erreichbar; die API verbindet sich mit der eigenen Rolle `quiz_app`).
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
2. **Dashboard** (`/dashboard`): eigene Quizze verwalten, gespeicherte Ergebnisse ansehen, per PIN beitreten
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
src/quizzes.js     Quizze erstellen/bearbeiten/löschen
src/game.js        Live-Spiele: PIN, QR-Code, Spielablauf, Gäste, Punkte
src/config.js      Spielregeln (Mindestteilnehmer für die Wertung)
src/achievements.js Erfolge: Definitionen, Vergabe am Spielende, API
src/leaderboard.js Bestenliste (gesamt und je Fach)
src/results.js     Statistik und gespeicherte Ergebnisse eingeloggter Spieler
public/            Frontend (reines HTML/CSS/JS, kein Build-Schritt)
supabase/          Datenbank-Migrationen
```

## Fächer und Statistik

Jedes Quiz gehört zu einem Fach. Die Fächer liegen in der Tabelle `quiz.subjects` (aktuell Politik, Soziologie, Psychologie). Ein neues Fach ergänzt man im Supabase-SQL-Editor:

```sql
INSERT INTO quiz.subjects (name, position) VALUES ('Statistik', 4);
```

`position` bestimmt die Reihenfolge. Das Dashboard zeigt eingeloggten Spielern ihre Gesamtpunkte und die Punkte je Fach. Quizze aus der Zeit vor den Fächern erscheinen unter „Ohne Fach“.

**Mindestteilnehmer:** In Gesamtpunkte und Fächer-Statistik fließen nur Spiele mit mindestens 10 Teilnehmern ein (Gäste mitgezählt). Kleinere Spiele bleiben in „Meine Ergebnisse“ sichtbar, sind dort aber als „zählt nicht“ markiert. Der Wert steht in `src/config.js` (`MIN_PLAYERS_FOR_SCORING`) und wird beim Abruf der Statistik angewendet, eine Änderung gilt also auch rückwirkend.

## Bestenliste

Unter `/leaderboard` (Dashboard → „🏆 Bestenliste“) sehen eingeloggte Nutzer alle registrierten Konten nach Punkten. Oben wählt man zwischen **Gesamt** und den einzelnen **Fächern**; die Auswahl steckt in der Adresse (`/leaderboard?subject=2`). Gleiche Punkte teilen sich den Platz, wer noch nichts gespielt hat, steht mit 0 Punkten am Ende. Die eigene Zeile ist hervorgehoben. Es zählen dieselben Spiele wie in der persönlichen Statistik (mindestens 10 Teilnehmer). Die Liste ist nur für eingeloggte Nutzer sichtbar.

## Serien-Bonus

Wer mehrere Fragen in Folge richtig beantwortet, bekommt Extrapunkte: ab der 2. richtigen Antwort in Folge +50 pro Serienschritt, höchstens +250 (also 2 in Folge: +50, 3: +100, … ab 6: +250). Eine falsche oder unbeantwortete Frage beendet die Serie. Auf dem Handy steht vor der Frage die aktuelle Serie samt möglichem Bonus, nach der Auflösung der erhaltene Bonus. Die Werte stehen in `src/config.js` (`STREAK_BONUS_PER_STEP`, `STREAK_BONUS_MAX`). Der Bonus zählt zu den normalen Punkten (Rangliste, Gesamtwertung); der Erfolg „Blitzmerker“ berücksichtigt nur die Basispunkte.

## Team-Modus

Der Spielmodus wird beim Erstellen (und Bearbeiten) eines Quiz festgelegt: **Einzel** oder **Team**. Bei einem Team-Quiz werden die Teilnehmer nach dem Klick auf „Teams bilden“ zufällig in **zwei Teams** (🦊 Füchse, 🦉 Eulen) verteilt, mindestens 4 Teilnehmer. Danach werden die Teams auf dem großen Bildschirm vorgestellt, jeder sieht auf dem Handy sein Team. Im Dashboard sind Team-Quizze mit „👥 Team“ gekennzeichnet.

- **Teampunkte** = Summe der Punkte aller Mitglieder; die Rangliste nach jeder Runde und die Siegerehrung zeigen die Teams (darunter die besten Einzelspieler).
- **Ungerade Teilnehmerzahl:** Ein Team hat dann genau einen Spieler mehr. Das kleinere Team bekommt einen **Geist-Spieler 👻**, der immer so viele Punkte hat wie der Durchschnitt seiner echten Mitspieler (aufgerundet auf ganze Punkte). Bei gerader Zahl gibt es keinen Geist.
- Jeder sammelt weiter seine Einzelpunkte (Gesamtwertung, Erfolge). Der Geist-Spieler hat keinen Einfluss darauf; Wertung und Mindestteilnehmerzahl gelten wie im normalen Spiel.

## Erfolge

Eingeloggte Spieler sammeln Erfolge (Dashboard → „Meine Erfolge“, am Spielende poppen neue auf dem Handy auf, der Host sieht sie unter der Siegerehrung). Sie werden nur in Spielen vergeben, die für die Gesamtwertung zählen (mindestens 10 Teilnehmer), und nur für Konten, nie für Gäste.

| Gruppe | Erfolg | Bedingung |
|---|---|---|
| Dabeisein | 🌱 Neuling | erstes gewertetes Quiz gespielt |
| | 📚 Stammgast / 🎓 Veteran | 5 / 20 gewertete Quizze |
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
