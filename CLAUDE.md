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
- Anmeldung per Mail-Link. Tokens und Sitzungen nur als Prüfsumme speichern, nie im Klartext und nie im Protokoll,
  außer bei der Protokollpost für die Entwicklung auf `localhost`.
- Der Server lauscht standardmäßig nur auf 127.0.0.1. Ins Netz geht er über einen Proxy mit HTTPS.
  Links in Mails und Prüf-Links entstehen aus `BASIS_URL`, nie aus dem `Host`-Header der Anfrage.
- Daten bleiben in der EU: keine Dienste einbauen, die Inhalte oder Adressen außerhalb verarbeiten.
