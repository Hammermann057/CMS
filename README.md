# Agenturtool

CMS und Arbeitsraum für Agenturen. Material kommt in ein Projekt, wird dort zur Seite
und geht erst nach einer Freigabe per Prüf-Link online.

Stand: **Etappe 1** mit Anmeldung per Mail-Link und **Etappe 3**: Seiten aus Bausteinen und das Regelwerk.

## Was schon geht

- **Anmeldung ohne Passwort:** Mail-Adresse eingeben, Link aus der Mail anklicken, 30 Tage angemeldet bleiben
- **Team:** Die Leitung gibt Zugänge (Leitung, Mitarbeit, Kund:in für ein Projekt), lädt per Mail ein
  und kann Zugänge entziehen oder wieder geben
- Projektübersicht mit dem nächsten Schritt je Projekt
- Material per Drag-and-drop hochladen (PNG, JPEG, WebP, GIF, PDF, bis 25 MB)
- Neues und geändertes Material wird markiert, bis es jemand als gesehen markiert
- **Seiten aus Bausteinen:** beliebig viele Seiten je Projekt, die erste ist die Startseite.
  Bausteine: Kopf, Text, Zwischenüberschrift, Bild, Galerie, Zitat, Knopf.
  Verschieben, entfernen, hinzufügen, alles in einem Formular, ohne dass Getipptes verloren geht.
- **Vorschau** neben dem Editor; ein Klick auf einen Teil der Vorschau springt zum Baustein
- **Hinweise am Baustein** mit Folge, Grund und Ausweg: fehlende Bildbeschreibung, zu lange Überschrift,
  Knopf ohne klares Ziel, langer Text ohne Zwischenüberschrift, zweite Hauptüberschrift und mehr.
  Sie sperren nichts.
- **Agentur baut, Kund:innen füllen:** Kund:innen ändern nur Inhalte in Bausteinen, die die Agentur
  nicht gesperrt hat. Titel, Reihenfolge und Aufbau bleiben bei der Agentur, auch wenn jemand am Formular vorbei schickt.
- Stand einreichen: Alle Seiten werden eingefroren. Der Prüf-Link zeigt Seite für Seite, was neu ist,
  was sich geändert hat und was entfällt; ohne Konto freigeben oder Änderung wünschen
- **Regelwerk je Projekt:** Farben, Schriften, Textgrößen, Ecken, Abstände, Breite. Die Vorschau zeigt Änderungen
  schon beim Tippen. Kontraste werden nach WCAG 2.2 geprüft; reicht einer nicht, schlägt das Werkzeug die nächstgelegene
  Farbe im selben Farbton vor, die genügt, und übernimmt sie auf Klick. Nur Schriften, die auf den Geräten schon liegen,
  damit keine Adressen an Schriftanbieter gehen.
- **Design-Tokens:** Das Regelwerk lässt sich im Format der W3C Design Tokens Community Group (2025.10) ausgeben
  und einlesen. Was beim Einlesen nicht passt, wird mit Grund genannt.
- Auch das Regelwerk geht erst mit der Freigabe online; der Prüf-Link zeigt, was sich an der Gestaltung ändert.
- Die freigegebene Website wird unter `/seiten/<projekt>` mit Navigation ausgeliefert.
  Bilder dort sind nur erreichbar, wenn sie auf der Website vorkommen.
- Verlauf: wer hat was hochgeladen, geändert, eingereicht, freigegeben

## Was bewusst noch fehlt

- Eigene Schriftdateien hochladen und Regeln zu Marke und Tonalität kommen später
- Text ohne Formatierung wie fett oder Links im Fließtext
- Kein Eingang über Google Drive, Mail oder Handy (Etappe 2)
- Keine Kommentare am Element, keine Zeitvorschläge (Etappe 4)
- Eine Mail-Adresse gehört zu genau einer Agentur. Kund:innen mehrerer Agenturen kommen,
  wenn das Werkzeug an andere Agenturen geht (Etappe 7).

## Starten auf dem eigenen Rechner

Braucht Node.js ab Version 22.18, sonst nichts. Es gibt keine Abhängigkeiten.

```
npm start
```

Dann http://localhost:3000 öffnen. Beim ersten Mal richtest du dort die Agentur ein, danach
meldest du dich per Klick als eine der Personen an. Über „Abmelden“ kommst du zurück zur Auswahl
und kannst so ausprobieren, was Mitarbeit oder Kund:innen sehen.

Dieser **lokale Modus** gilt nur, solange kein Mailserver eingestellt ist und die Anfrage von
diesem Rechner an `localhost` geht. Im Netz läuft die Anmeldung immer über den Link per Mail,
und die Einrichtung geht dort nur über die Kommandozeile (`npm run einrichten`), damit sich niemand
zur Leitung macht, der die Adresse zuerst findet.

Daten liegen im Ordner `daten/`.

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
| `src/kern/bausteine.ts` | Bausteine anlegen, prüfen, vergleichen. |
| `src/kern/regelwerk.ts` | Regelwerk: Felder, Prüfung, Design-Tokens ein und aus. |
| `src/kern/farbe.ts` | Kontrast nach WCAG und Farbvorschläge. |
| `src/kern/pruefer.ts` | Hinweise mit Folge, Grund und Ausweg, für Bausteine und Regelwerk. |
| `src/renderer/` | Macht aus dem Inhalt HTML, für Vorschau, Prüf-Link und Website gleich. |
| `src/server.ts` | Verteiler, Anmeldung, Projekte, Team und die ausgelieferten Seiten. |
| `src/oberflaeche/` | Editor, Seitenliste, Regelwerk und Prüf-Link. |
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
