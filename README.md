# Agenturtool

CMS und Arbeitsraum für Agenturen. Material kommt in ein Projekt, wird dort zur Seite
und geht erst nach einer Freigabe per Prüf-Link online.

Dieser Stand ist **Etappe 1, erster Schnitt**: der Kern und einmal der ganze Ablauf in klein.

## Was schon geht

- Projektübersicht mit dem nächsten Schritt je Projekt
- Material per Drag-and-drop hochladen (PNG, JPEG, WebP, GIF, PDF, bis 25 MB)
- Neues und geändertes Material wird markiert, bis es jemand als gesehen markiert
- Eine Seite je Projekt: Überschrift, Text, Bild, Alt-Text
- Hinweise, die Folge und Grund nennen (Platzhalter für das Regelwerk)
- Stand einreichen, Prüf-Link weitergeben, ohne Konto freigeben oder Änderung wünschen
- Die freigegebene Seite wird unter `/seiten/<name>` ausgeliefert
- Verlauf: wer hat was hochgeladen, geändert, eingereicht, freigegeben
- Rollen: Leitung, Mitarbeit, Kund:in. Jede Zeile gehört zu einer Agentur.

## Was bewusst noch fehlt

- **Keine Anmeldung.** Wer die Seite öffnet, wählt oben eine Person aus. Der Server
  lauscht deshalb nur auf dem eigenen Rechner. Nicht ins Netz stellen.
- Kein Editor im Layout, kein Regelwerk mit Tokens (Etappe 3)
- Kein Eingang über Google Drive, Mail oder Handy (Etappe 2)
- Keine Kommentare am Element, keine Zeitvorschläge (Etappe 4)

## Starten

Braucht Node.js ab Version 22.18, sonst nichts. Es gibt keine Abhängigkeiten.

```
npm start
```

Dann http://localhost:3000 öffnen. Daten liegen im Ordner `daten/`.
Mit `PORT=4000 npm start` läuft es auf einem anderen Port, mit `DATEN=/pfad` an einem anderen Ort.

## Tests

```
npm test
```

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `src/kern/` | Projekte, Personen, Rechte, Medien, Stände, Verlauf. Kennt kein HTTP. |
| `src/kern/pruefer.ts` | Hinweise mit Folge und Grund. Wird in Etappe 3 zum Regelwerk. |
| `src/renderer/` | Macht aus dem Inhalt HTML, für Vorschau, Prüf-Link und Website gleich. |
| `src/server.ts` | Die Oberfläche und die ausgelieferten Seiten. |
| `src/web/` | Stylesheets und das Skript für die Ablage. |
| `tests/` | Tests für Kern und Server. |

## Entscheidungen

- **Eigener kleiner Kern statt eines fertigen CMS.** Das Ziel ist, alle Funktionen selbst zu besitzen.
- **Ohne Abhängigkeiten gestartet.** Node bringt Datenbank (SQLite), Tests und TypeScript mit.
  Ein Framework für den Editor kommt, wenn Etappe 3 es braucht.
- **Freigabe per Prüf-Link.** Die zweite Stufe über die Leitung ist auf später gelegt.
- **Dateityp am Inhalt erkannt**, nicht an der Dateiendung.
