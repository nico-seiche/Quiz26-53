# Quiz26-53

Quiz-Plattform für den Studienkurs: Quizze erstellen und live zusammen spielen – ein Host zeigt Fragen, QR-Code und PIN auf dem großen Bildschirm, alle anderen spielen am Handy mit.

- **Mitspielen** geht immer, auch ohne Konto als Gast (nur mit Namen).
- **Ein Konto** braucht man, um Quizze zu speichern und zu hosten. Wer eingeloggt mitspielt, bekommt seine Punkte gespeichert.

## Starten

Voraussetzung: Node.js 22 oder neuer.

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # mit automatischem Neustart bei Änderungen
```

Die Datenbank (SQLite) wird automatisch unter `data/quiz.db` angelegt.

### Im Netzwerk spielen

Damit andere per QR-Code beitreten können, muss der Server für sie erreichbar sein (gleiches WLAN oder Hosting). Der QR-Code verwendet die Adresse, unter der der Host die Seite geöffnet hat. Öffnest du als Host `localhost`, setze die öffentliche Adresse explizit:

```bash
PUBLIC_URL=http://192.168.0.42:3000 npm start
```

## Ablauf

1. **Konto** erstellen bzw. anmelden (`/`) – nur zum Erstellen/Hosten und Punktesammeln nötig
2. **Dashboard** (`/dashboard`): eigene Quizze verwalten, gespeicherte Ergebnisse ansehen, per PIN beitreten
3. **Editor** (`/edit`): Titel, Fragen mit 2–4 Antworten, richtige Antwort, Zeitlimit
4. **Starten** → **Host-Bildschirm** (`/host?pin=…`) mit QR-Code, PIN und Teilnehmerliste
5. Teilnehmende scannen den QR-Code oder geben die PIN ein (`/play`) – als Gast mit Namen oder eingeloggt mit ihrem Nutzernamen
6. Host steuert: Quiz starten → Auflösen (automatisch nach Ablauf der Zeit oder wenn alle geantwortet haben) → Nächste Frage → Endstand

## Aufbau

```
server.js          Express + Socket.IO
src/db.js          SQLite-Schema (users, sessions, quizzes, questions, game_results)
src/auth.js        Registrierung, Login, Sessions (httpOnly-Cookie, bcrypt)
src/quizzes.js     REST-API zum Erstellen/Bearbeiten/Löschen von Quizzen
src/game.js        Live-Spiele: PIN, QR-Code, Spielablauf über WebSockets, Gäste
src/results.js     Gespeicherte Ergebnisse eingeloggter Spieler
public/            Frontend (reines HTML/CSS/JS, kein Build-Schritt)
```

Laufende Spiele werden nur im Arbeitsspeicher gehalten – ein Neustart des Servers beendet sie.

## Punkte

Aktuell einfache Wertung: richtige Antwort = 500–1000 Punkte, je schneller desto mehr. Die Logik steckt in `scoreAnswer()` in `src/game.js` und lässt sich dort anpassen. Am Spielende werden die Punkte aller eingeloggten Teilnehmenden in `game_results` gespeichert; Gäste werden nicht gespeichert.
