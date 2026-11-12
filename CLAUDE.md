# Hinweise für die Arbeit in diesem Repository

- Sprache: Oberfläche, Fachbegriffe im Code und Kommentare sind deutsch (Projekt, Stand, Medium, Verlauf).
- Laufzeit: Node.js ab 22.18 führt die `.ts`-Dateien direkt aus. Deshalb nur TypeScript, das sich
  streichen lässt: keine `enum`, keine Parameter-Properties, Typen mit `import type`, Importe mit `.ts`.
- Keine Abhängigkeiten hinzufügen, ohne es vorher abzusprechen.
- `src/kern/` kennt kein HTTP. Jede Methode nimmt die handelnde Person und prüft Rechte und Agentur.
  Fremde Daten sehen aus wie nicht vorhandene (`NichtGefunden`), nicht wie verbotene.
- Alles, was Menschen eingeben, läuft im HTML durch `esc()`.
- Vor jedem Commit: `npm test`. Änderungen an der Oberfläche zusätzlich im Browser durchklicken.
  Der Fehler mit `Referrer-Policy: no-referrer` (Browser schickt dann `Origin: null`) fiel nur dort auf.
- Es gibt noch keine Anmeldung. Der Server darf nur auf 127.0.0.1 lauschen, bis es eine gibt.
