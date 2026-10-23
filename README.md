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
3. **Editor** (`/edit`): Titel, Fragen mit 2–4 Antworten, richtige Antwort, Zeitlimit
4. **Starten** → **Host-Bildschirm** (`/host?pin=…`) mit QR-Code, PIN und Teilnehmerliste
5. Teilnehmende scannen den QR-Code oder geben die PIN ein (`/play`) – als Gast mit Namen oder eingeloggt mit ihrem Nutzernamen
6. Host steuert: Quiz starten → Auflösen (automatisch nach Ablauf der Zeit oder wenn alle geantwortet haben) → Nächste Frage → Endstand

## Aufbau

```
api/index.js       Einstiegspunkt für Vercel
server.js          Lokaler Entwicklungsserver (API + statische Seiten)
src/app.js         Express-App mit allen API-Routen
src/db.js          Postgres-Verbindung
src/auth.js        Registrierung, Login, Sessions (httpOnly-Cookie, bcrypt)
src/quizzes.js     Quizze erstellen/bearbeiten/löschen
src/game.js        Live-Spiele: PIN, QR-Code, Spielablauf, Gäste, Punkte
src/results.js     Gespeicherte Ergebnisse eingeloggter Spieler
public/            Frontend (reines HTML/CSS/JS, kein Build-Schritt)
supabase/          Datenbank-Migrationen
```

## Punkte

Aktuell einfache Wertung: richtige Antwort = 500–1000 Punkte, je schneller desto mehr. Die Logik steckt in `scoreAnswer()` in `src/game.js`. Am Spielende werden die Punkte aller eingeloggten Teilnehmenden in `quiz.game_results` gespeichert; Gäste werden nicht gespeichert. Laufende Spiele werden nach einem Tag gelöscht.
