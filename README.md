# Agenturtool

CMS und Arbeitsraum für Agenturen. Material kommt in ein Projekt, wird dort zur Seite
und geht erst nach einer Freigabe per Prüf-Link online.

Stand: **Etappe 1** mit Anmeldung per Mail-Link. Der Kern und einmal der ganze Ablauf in klein.

## Was schon geht

- **Anmeldung ohne Passwort:** Mail-Adresse eingeben, Link aus der Mail anklicken, 30 Tage angemeldet bleiben
- **Team:** Die Leitung gibt Zugänge (Leitung, Mitarbeit, Kund:in für ein Projekt), lädt per Mail ein
  und kann Zugänge entziehen oder wieder geben
- Projektübersicht mit dem nächsten Schritt je Projekt
- Material per Drag-and-drop hochladen (PNG, JPEG, WebP, GIF, PDF, bis 25 MB)
- Neues und geändertes Material wird markiert, bis es jemand als gesehen markiert
- Eine Seite je Projekt: Überschrift, Text, Bild, Alt-Text
- Hinweise, die Folge und Grund nennen (Platzhalter für das Regelwerk)
- Stand einreichen, Prüf-Link weitergeben, ohne Konto freigeben oder Änderung wünschen
- Die freigegebene Seite wird unter `/seiten/<name>` ausgeliefert
- Verlauf: wer hat was hochgeladen, geändert, eingereicht, freigegeben

## Was bewusst noch fehlt

- Kein Editor im Layout, kein Regelwerk mit Tokens (Etappe 3)
- Kein Eingang über Google Drive, Mail oder Handy (Etappe 2)
- Keine Kommentare am Element, keine Zeitvorschläge (Etappe 4)
- Eine Mail-Adresse gehört zu genau einer Agentur. Kund:innen mehrerer Agenturen kommen,
  wenn das Werkzeug an andere Agenturen geht (Etappe 7).

## Starten auf dem eigenen Rechner

Braucht Node.js ab Version 22.18, sonst nichts. Es gibt keine Abhängigkeiten.

```
npm run einrichten -- --agentur "Name der Agentur" --name "Dein Name" --email "du@agentur.de"
npm start
```

Dann http://localhost:3000 öffnen und mit der Adresse anmelden. Ohne Mailserver erscheint
der Anmelde-Link im Terminal, in dem der Server läuft.

Daten liegen im Ordner `daten/`. Die Einrichtung geht absichtlich nur über die Kommandozeile:
So kann sich niemand zur Leitung machen, der die Adresse im Netz zuerst findet.

## Einstellungen

| Variable | Bedeutung | Standard |
| --- | --- | --- |
| `BASIS_URL` | Adresse, unter der das Werkzeug erreichbar ist. Daraus entstehen Links in Mails und Prüf-Links. | `http://localhost:<PORT>` |
| `PORT` | Port des Servers | `3000` |
| `HOST` | Wo der Server lauscht. Bleibt auf `127.0.0.1`, wenn ein Proxy davorsteht. Anders nur mit `https://` in `BASIS_URL`. | `127.0.0.1` |
| `DATEN` | Ordner für Datenbank und Dateien | `./daten` |
| `SMTP_HOST` | Mailserver. Ohne ihn startet der Server nur auf `localhost`. | – |
| `SMTP_PORT` | `465` (TLS von Anfang an) oder `587` (STARTTLS) | `465` |
| `SMTP_VERSCHLUESSELUNG` | `tls`, `starttls`, `keine` (nur für einen Mailserver auf demselben Rechner) | nach Port |
| `SMTP_BENUTZER`, `SMTP_PASSWORT` | Zugang zum Mailserver | – |
| `SMTP_ABSENDER` | zum Beispiel `Agenturtool <noreply@agentur.de>` | – |

## Betrieb im Netz

Wie das Werkzeug auf einen Server in Deutschland kommt, steht in [`betrieb/README.md`](betrieb/README.md).

## Tests

```
npm test
```

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `src/kern/` | Projekte, Personen, Anmeldung, Rechte, Medien, Stände, Verlauf. Kennt kein HTTP. |
| `src/kern/pruefer.ts` | Hinweise mit Folge und Grund. Wird in Etappe 3 zum Regelwerk. |
| `src/renderer/` | Macht aus dem Inhalt HTML, für Vorschau, Prüf-Link und Website gleich. |
| `src/server.ts` | Die Oberfläche und die ausgelieferten Seiten. |
| `src/post.ts` | Mailversand über SMTP, selbst geschrieben. |
| `src/einrichten.ts` | Erste Einrichtung über die Kommandozeile. |
| `src/web/` | Stylesheets und das Skript für die Ablage. |
| `betrieb/` | Vorlagen für den Server: Dienst, Proxy, Anleitung. |
| `tests/` | Tests für Kern, Server und Mailversand. |

## Entscheidungen

- **Eigener kleiner Kern statt eines fertigen CMS.** Das Ziel ist, alle Funktionen selbst zu besitzen.
- **Ohne Abhängigkeiten gestartet.** Node bringt Datenbank (SQLite), Tests und TypeScript mit.
  Ein Framework für den Editor kommt, wenn Etappe 3 es braucht.
- **Anmeldung per Mail-Link statt Passwort.** Nichts zu merken, nichts, was sich wiederverwenden lässt.
  Links gelten 15 Minuten und einmal, höchstens fünf pro Stunde und Adresse. Tokens und Sitzungen
  liegen nur als Prüfsumme in der Datenbank. Der Link öffnet erst eine Bestätigung, damit Mailprogramme,
  die Links vorab aufrufen, ihn nicht verbrauchen.
- **Freigabe per Prüf-Link.** Die zweite Stufe über die Leitung ist auf später gelegt.
- **Dateityp am Inhalt erkannt**, nicht an der Dateiendung.
- **Hosting in der EU, später auch im Büro.** Alles liegt in einem Ordner. Umziehen heißt: Ordner kopieren.
