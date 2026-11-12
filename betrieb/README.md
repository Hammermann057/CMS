# Betrieb: das Agenturtool ins Netz bringen

Ziel: Alles läuft in der EU, Daten verlassen sie nicht. Später kann das Werkzeug auch auf einen
Rechner im Büro umziehen. Weil alles in einem Ordner liegt, heißt Umziehen: Ordner kopieren.

> Die Vorlagen in diesem Ordner sind noch nicht auf einem echten Server ausprobiert.
> Beim ersten Einrichten zusammen durchgehen und diese Zeile dann löschen.

## Was es braucht

| Teil | Empfehlung | Warum |
| --- | --- | --- |
| Server | Kleiner Cloud-Server bei **Hetzner** (Hetzner Online GmbH), Standort **Nürnberg oder Falkenstein** | Deutscher Anbieter, Rechenzentren in Deutschland. Den Vertrag zur Auftragsverarbeitung schließt man im Kundenkonto per Häkchen ab. |
| Größe | Die kleinste Reihe mit 2 vCPU und 4 GB, etwa CX23 | Reicht für 5 Personen und ihre Kund:innen. Im August 2026 rund 6 € netto im Monat mit IPv4. Hetzner hat 2026 mehrfach die Preise geändert, und die günstigen Reihen waren im Herbst zeitweise ausverkauft: vor dem Buchen nachsehen. |
| Mail | Zuerst das **Postfach, das die Agentur schon hat**, etwa `noreply@deine-agentur.de` beim bisherigen Mail-Anbieter | Kein neuer Vertrag, kein neuer Dienstleister. Die paar Anmelde-Mails am Tag schafft jedes Postfach. |
| Mail, wenn es mehr wird | **Scaleway Transactional Email** (Frankreich) | Daten nach Angabe des Anbieters nur in der EU, 300 Mails im Monat frei. Braucht SPF- und DKIM-Einträge im DNS. Weitere europäische Dienste: Lettermint (Niederlande), Sweego (Frankreich), rapidmail (Deutschland). |
| HTTPS | **Caddy** als Proxy auf demselben Server | Holt das Zertifikat selbst und erneuert es. Das Agenturtool lauscht weiter nur auf 127.0.0.1. |
| Adresse | Eine Subdomain der Agentur, etwa `tool.deine-agentur.de` | Im DNS ein A-Eintrag auf die IP des Servers. |

Keine Rechtsberatung: Ob Datenschutzerklärung und Verzeichnis der Verarbeitungstätigkeiten
angepasst werden müssen, klärt am besten, wer das in der Agentur ohnehin betreut.

## Schritte

1. Server anlegen (Ubuntu, Standort Deutschland), SSH-Schlüssel hinterlegen, AVV im Kundenkonto abschließen.
2. Node.js ab 22.18 und Caddy installieren.
3. Nutzer und Ordner anlegen:
   ```
   useradd --system --home /opt/agenturtool agenturtool
   git clone https://github.com/Hammermann057/CMS.git /opt/agenturtool
   mkdir -p /var/lib/agenturtool && chown agenturtool /var/lib/agenturtool
   ```
4. `agenturtool.env.beispiel` nach `/etc/agenturtool.env` kopieren, ausfüllen, `chmod 600`.
5. Einrichten, einmalig:
   ```
   cd /opt/agenturtool
   sudo -u agenturtool DATEN=/var/lib/agenturtool \
     npm run einrichten -- --agentur "Name" --name "Dein Name" --email "du@deine-agentur.de"
   ```
6. `agenturtool.service` nach `/etc/systemd/system/`, dann `systemctl enable --now agenturtool`.
7. `Caddyfile` nach `/etc/caddy/Caddyfile`, Domain eintragen, `systemctl reload caddy`.
8. `https://tool.deine-agentur.de/anmelden` öffnen und anmelden.

## Sicherung

Alles Wichtige liegt in `/var/lib/agenturtool`: die Datenbank `kern.sqlite` und der Ordner `medien/`.
Fürs Erste: den Ordner jede Nacht an einen zweiten Ort in der EU kopieren. Ein eigener Befehl für eine
Sicherung im laufenden Betrieb kommt mit Etappe 2.

## Später im Büro

Ein kleiner Linux-Rechner im Büro reicht. Die Schritte bleiben gleich, nur der Server steht woanders.
Von außen erreichbar wird er über eine Portfreigabe im Router oder einen Tunnel. Das entscheiden wir,
wenn es so weit ist.
