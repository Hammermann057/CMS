import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Fehler, Kern, MAX_GROESSE, NichtGefunden } from './kern/kern.ts';
import { darf, Verboten } from './kern/rechte.ts';
import { hinweise } from './kern/pruefer.ts';
import { esc, renderAusschnitt, renderSeite } from './renderer/seite.ts';
import type { Ereignis, Hinweis, Medium, Person, ProjektUebersicht, Stand } from './kern/typen.ts';

const WEB = join(dirname(fileURLToPath(import.meta.url)), 'web');
const STATISCH: Record<string, { typ: string; inhalt: Buffer }> = {
  '/stil.css': { typ: 'text/css; charset=utf-8', inhalt: readFileSync(join(WEB, 'stil.css')) },
  '/seite.css': { typ: 'text/css; charset=utf-8', inhalt: readFileSync(join(WEB, 'seite.css')) },
  '/app.js': { typ: 'text/javascript; charset=utf-8', inhalt: readFileSync(join(WEB, 'app.js')) },
};

const KOPF_HTML = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  // Der Prüf-Link trägt ein Token in der Adresse. Es soll nicht an fremde Seiten weiterwandern.
  // Nicht „no-referrer“: Damit schickt der Browser bei Formularen „Origin: null“,
  // und die Herkunftsprüfung unten würde die eigenen Formulare ablehnen.
  'Referrer-Policy': 'same-origin',
};

const ROLLEN_NAME: Record<Person['rolle'], string> = { leitung: 'Leitung', mitarbeit: 'Mitarbeit', kundin: 'Kund:in' };
const zeitFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
const zeit = (iso: string): string => zeitFormat.format(new Date(iso));

function groesse(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// --- Anfrage lesen ------------------------------------------------------------

async function lies(req: IncomingMessage, max: number): Promise<Buffer> {
  if (Number(req.headers['content-length'] ?? 0) > max) throw new Fehler('Die Datei ist größer als 25 MB.');
  const teile: Buffer[] = [];
  let summe = 0;
  for await (const teil of req) {
    summe += (teil as Buffer).length;
    if (summe > max) throw new Fehler('Die Datei ist größer als 25 MB.');
    teile.push(teil as Buffer);
  }
  return Buffer.concat(teile);
}

async function formular(req: IncomingMessage): Promise<URLSearchParams> {
  return new URLSearchParams((await lies(req, 100_000)).toString('utf8'));
}

/** Schreibende Anfragen müssen von dieser Seite selbst kommen. */
function pruefeHerkunft(req: IncomingMessage): void {
  const herkunft = req.headers.origin;
  if (!herkunft) return;
  let host = '';
  try {
    host = new URL(herkunft).host;
  } catch {
    // ungültige Herkunft fällt unten durch
  }
  if (host !== req.headers.host) throw new Verboten('Anfrage von fremder Seite abgelehnt.');
}

function personAusCookie(kern: Kern, req: IncomingMessage): Person {
  const treffer = /(?:^|;\s*)person=([0-9a-f-]{36})/.exec(req.headers.cookie ?? '');
  const gewaehlt = treffer ? kern.person(treffer[1]) : null;
  if (gewaehlt) return gewaehlt;
  const agentur = kern.agenturen()[0];
  const erste = agentur ? kern.personen(agentur.id)[0] : undefined;
  if (!erste) throw new Fehler('Es ist noch keine Agentur eingerichtet.');
  return erste;
}

// --- Antworten ----------------------------------------------------------------

function sendeHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, KOPF_HTML);
  res.end(html);
}

function sendeJson(res: ServerResponse, status: number, daten: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(daten));
}

function umleiten(res: ServerResponse, ziel: string, cookie?: string): void {
  res.writeHead(303, cookie ? { Location: ziel, 'Set-Cookie': cookie } : { Location: ziel });
  res.end();
}

function sendeMedium(res: ServerResponse, datei: { medium: Medium; daten: Buffer } | null): void {
  if (!datei) throw new NichtGefunden('Datei nicht gefunden.');
  res.writeHead(200, {
    'Content-Type': datei.medium.typ,
    'Content-Length': datei.daten.length,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(datei.medium.dateiname)}`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-cache',
  });
  res.end(datei.daten);
}

// --- Seiten -------------------------------------------------------------------

function rahmen(titel: string, inhalt: string, wer?: { person: Person; alle: Person[] }): string {
  const wechsel = wer
    ? `<form method="post" action="/wechseln" class="wechsel">
<label for="person">Angemeldet als</label>
<select id="person" name="person">${wer.alle
        .map((p) => `<option value="${esc(p.id)}"${p.id === wer.person.id ? ' selected' : ''}>${esc(p.name)}, ${ROLLEN_NAME[p.rolle]}</option>`)
        .join('')}</select>
<button type="submit">Wechseln</button>
</form>`
    : '';
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titel)} · Agenturtool</title>
<link rel="stylesheet" href="/stil.css">
<link rel="stylesheet" href="/seite.css">
<script src="/app.js" defer></script>
</head>
<body>
<header class="kopf"><a href="/" class="marke">Agenturtool</a>${wechsel}</header>
<main>${inhalt}</main>
</body>
</html>`;
}

function naechsterSchritt(p: ProjektUebersicht): string {
  if (p.offenerStand) return 'Wartet auf Freigabe per Prüf-Link';
  if (p.neueMedien > 0) return p.neueMedien === 1 ? '1 neue Datei ansehen' : `${p.neueMedien} neue Dateien ansehen`;
  if (!p.veroeffentlicht) return 'Seite füllen und Stand einreichen';
  return 'Veröffentlicht';
}

function seiteUebersicht(kern: Kern, person: Person): string {
  const projekte = kern.projekte(person);
  const liste = projekte.length
    ? `<ul class="projekte">${projekte
        .map(
          (p) => `<li><a href="/projekte/${esc(p.id)}"><strong>${esc(p.name)}</strong>${p.kunde ? `<span>${esc(p.kunde)}</span>` : ''}</a>
<span class="schritt">${esc(naechsterSchritt(p))}</span></li>`,
        )
        .join('')}</ul>`
    : '<p class="leer">Noch kein Projekt. Leg unten das erste an.</p>';
  const neu = darf(person, 'projekt.anlegen')
    ? `<section><h2>Neues Projekt</h2>
<form method="post" action="/projekte" class="felder">
<label for="name">Projektname</label><input id="name" name="name" required maxlength="120">
<label for="kunde">Kund:in</label><input id="kunde" name="kunde" maxlength="120">
<button type="submit">Projekt anlegen</button>
</form></section>`
    : '';
  return `<h1>Projekte</h1>${liste}${neu}`;
}

function teilMedien(person: Person, projektId: string, medien: Medium[]): string {
  const marke: Record<Medium['zustand'], string> = { neu: 'Neu', geaendert: 'Geändert', gesehen: '' };
  const liste = medien.length
    ? `<ul class="medien">${medien
        .map((m) => {
          const bild = m.typ.startsWith('image/')
            ? `<img src="/medien/${esc(m.id)}" alt="" loading="lazy">`
            : '<span class="pdf" aria-hidden="true">PDF</span>';
          const gesehen =
            m.zustand === 'gesehen'
              ? ''
              : `<span class="marke-neu">${marke[m.zustand]}</span>
<form method="post" action="/medien/${esc(m.id)}/gesehen"><button type="submit" class="leise">Als gesehen markieren</button></form>`;
          return `<li>${bild}<div><a href="/medien/${esc(m.id)}">${esc(m.dateiname)}</a>
<small>${groesse(m.groesse)} · Version ${m.version} · ${esc(m.hochgeladenVon)} · ${zeit(m.hochgeladenAm)}</small></div>${gesehen}</li>`;
        })
        .join('')}</ul>`
    : '<p class="leer">Noch kein Material.</p>';
  const ablage = darf(person, 'medium.hochladen')
    ? `<div class="ablage" data-ablage="/projekte/${esc(projektId)}/medien">
<label for="dateien">Dateien hierher ziehen oder auswählen</label>
<input id="dateien" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf">
<p data-ablage-status role="status"></p>
</div>`
    : '';
  return `<section><h2>Material</h2>${ablage}${liste}</section>`;
}

function teilHinweise(liste: Hinweis[]): string {
  if (!liste.length) return '';
  return `<ul class="hinweise">${liste
    .map((h) => `<li><strong>${esc(h.regel)}</strong><span>Folge: ${esc(h.folge)}</span><span>Grund: ${esc(h.grund)}</span></li>`)
    .join('')}</ul>`;
}

function teilFreigabe(stand: Stand | null, projektId: string, slug: string, host: string, darfEinreichen: boolean): string {
  let zustand = '<p class="leer">Noch kein Stand eingereicht.</p>';
  if (stand?.zustand === 'eingereicht') {
    zustand = `<p>Eingereicht von ${esc(stand.eingereichtVon)} am ${zeit(stand.eingereichtAm)}. Wartet auf Freigabe.</p>
<label for="link">Prüf-Link zum Weitergeben</label>
<input id="link" readonly value="http://${esc(host)}/pruefen/${esc(stand.token)}">`;
  } else if (stand?.zustand === 'freigegeben') {
    zustand = `<p>Freigegeben von ${esc(stand.entschiedenVon)} am ${zeit(stand.entschiedenAm ?? stand.eingereichtAm)}.
<a href="/seiten/${esc(slug)}">Veröffentlichte Seite ansehen</a></p>`;
  } else if (stand?.zustand === 'abgelehnt') {
    zustand = `<p>Änderung gewünscht von ${esc(stand.entschiedenVon)} am ${zeit(stand.entschiedenAm ?? stand.eingereichtAm)}.</p>
${stand.kommentar ? `<blockquote>${esc(stand.kommentar)}</blockquote>` : ''}`;
  }
  const knopf = darfEinreichen
    ? `<form method="post" action="/projekte/${esc(projektId)}/einreichen"><button type="submit">Gespeicherten Entwurf als Stand einreichen</button></form>`
    : '';
  return `<section><h2>Freigabe</h2>${zustand}${knopf}</section>`;
}

function teilVerlauf(ereignisse: Ereignis[]): string {
  return `<section><h2>Verlauf</h2><ol class="verlauf">${ereignisse
    .map((e) => `<li><time datetime="${esc(e.zeit)}">${zeit(e.zeit)}</time><span>${esc(e.personName)}</span><span>${esc(e.text)}</span></li>`)
    .join('')}</ol></section>`;
}

function seiteProjekt(kern: Kern, person: Person, projektId: string, host: string): string {
  const projekt = kern.projekt(person, projektId);
  const medien = kern.medien(person, projektId);
  const { entwurf } = kern.seite(person, projektId);
  const bilder = medien.filter((m) => m.typ.startsWith('image/'));
  const bearbeiten = darf(person, 'seite.bearbeiten', projekt);
  const formularSeite = bearbeiten
    ? `<form method="post" action="/projekte/${esc(projekt.id)}/seite" class="felder">
<label for="ueberschrift">Überschrift</label><input id="ueberschrift" name="ueberschrift" value="${esc(entwurf.ueberschrift)}" maxlength="200">
<label for="text">Text</label><textarea id="text" name="text" rows="8">${esc(entwurf.text)}</textarea>
<label for="bildId">Bild</label><select id="bildId" name="bildId"><option value="">Kein Bild</option>${bilder
        .map((m) => `<option value="${esc(m.id)}"${m.id === entwurf.bildId ? ' selected' : ''}>${esc(m.dateiname)}</option>`)
        .join('')}</select>
<label for="bildAlt">Alt-Text zum Bild</label><input id="bildAlt" name="bildAlt" value="${esc(entwurf.bildAlt)}" maxlength="300">
<button type="submit">Entwurf speichern</button>
</form>`
    : '';
  const vorschau = entwurf.ueberschrift
    ? `<div class="vorschau">${renderAusschnitt(entwurf, entwurf.bildId ? `/medien/${entwurf.bildId}` : null)}</div>`
    : '';
  return `<p class="pfad"><a href="/">Projekte</a></p>
<h1>${esc(projekt.name)}</h1>
${projekt.kunde ? `<p class="unterzeile">${esc(projekt.kunde)}</p>` : ''}
${teilMedien(person, projekt.id, medien)}
<section><h2>Seite</h2>${formularSeite}${teilHinweise(hinweise(entwurf))}${vorschau}</section>
${teilFreigabe(kern.letzterStand(person, projekt.id), projekt.id, projekt.slug, host, darf(person, 'stand.einreichen', projekt))}
${teilVerlauf(kern.verlauf(person, projekt.id))}`;
}

function seitePruefen(kern: Kern, token: string): string {
  const { stand, projekt, veroeffentlicht } = kern.standPerToken(token);
  const bisher = veroeffentlicht
    ? renderAusschnitt(veroeffentlicht, veroeffentlicht.bildId ? `/seiten/${projekt.slug}/bild` : null)
    : '<p class="leer">Noch nichts veröffentlicht.</p>';
  const neu = renderAusschnitt(stand.inhalt, stand.inhalt.bildId ? `/pruefen/${token}/bild` : null);
  let entscheidung = '';
  if (stand.zustand === 'eingereicht') {
    entscheidung = `<form method="post" class="felder">
<label for="name">Ihr Name</label><input id="name" name="name" required maxlength="80" autocomplete="name">
<label for="kommentar">Anmerkung</label><textarea id="kommentar" name="kommentar" rows="3" maxlength="2000"></textarea>
<div class="knoepfe">
<button type="submit" name="entscheidung" value="freigeben">Freigeben und veröffentlichen</button>
<button type="submit" name="entscheidung" value="aendern" class="zweit">Änderung wünschen</button>
</div>
</form>`;
  } else if (stand.zustand === 'freigegeben') {
    entscheidung = `<p class="erledigt">Freigegeben von ${esc(stand.entschiedenVon)} am ${zeit(stand.entschiedenAm ?? stand.eingereichtAm)}.
<a href="/seiten/${esc(projekt.slug)}">Veröffentlichte Seite ansehen</a></p>`;
  } else if (stand.zustand === 'abgelehnt') {
    entscheidung = `<p class="erledigt">Änderung gewünscht von ${esc(stand.entschiedenVon)}. Die Agentur meldet sich mit einem neuen Stand.</p>`;
  } else {
    entscheidung = '<p class="erledigt">Dieser Stand wurde durch einen neueren ersetzt.</p>';
  }
  return `<h1>Stand zur Freigabe: ${esc(projekt.name)}</h1>
<p class="unterzeile">Eingereicht von ${esc(stand.eingereichtVon)} am ${zeit(stand.eingereichtAm)}</p>
<div class="vergleich">
<section><h2>Bisher online</h2><div class="vorschau">${bisher}</div></section>
<section><h2>Neuer Stand</h2><div class="vorschau">${neu}</div></section>
</div>
${teilHinweise(hinweise(stand.inhalt))}
<section><h2>Entscheidung</h2>${entscheidung}</section>`;
}

// --- Verteiler ----------------------------------------------------------------

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const R = {
  seite: /^\/seiten\/([a-z0-9-]+)$/,
  seiteBild: /^\/seiten\/([a-z0-9-]+)\/bild$/,
  pruefen: /^\/pruefen\/([A-Za-z0-9_-]{20,})$/,
  pruefenBild: /^\/pruefen\/([A-Za-z0-9_-]{20,})\/bild$/,
  projekt: new RegExp(`^/projekte/(${UUID})$`),
  projektMedien: new RegExp(`^/projekte/(${UUID})/medien$`),
  projektSeite: new RegExp(`^/projekte/(${UUID})/seite$`),
  projektEinreichen: new RegExp(`^/projekte/(${UUID})/einreichen$`),
  medium: new RegExp(`^/medien/(${UUID})$`),
  mediumGesehen: new RegExp(`^/medien/(${UUID})/gesehen$`),
};

async function bearbeite(kern: Kern, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://lokal');
  const pfad = url.pathname;
  const liest = req.method === 'GET' || req.method === 'HEAD';
  const host = req.headers.host ?? 'localhost';
  if (!liest) pruefeHerkunft(req);
  let m: RegExpExecArray | null;

  const statisch = STATISCH[pfad];
  if (liest && statisch) {
    res.writeHead(200, { 'Content-Type': statisch.typ, 'X-Content-Type-Options': 'nosniff' });
    res.end(statisch.inhalt);
    return;
  }

  // Öffentlich: veröffentlichte Seite und Prüf-Link.
  if (liest && (m = R.seite.exec(pfad))) {
    const seite = kern.veroeffentlicht(m[1]);
    if (!seite) throw new NichtGefunden('Diese Seite ist nicht veröffentlicht.');
    sendeHtml(res, 200, renderSeite(seite.inhalt, seite.inhalt.bildId ? `/seiten/${m[1]}/bild` : null));
    return;
  }
  if (liest && (m = R.seiteBild.exec(pfad))) return sendeMedium(res, kern.bildVeroeffentlicht(m[1]));
  if (liest && (m = R.pruefenBild.exec(pfad))) return sendeMedium(res, kern.bildZumStand(m[1]));
  if ((m = R.pruefen.exec(pfad))) {
    if (req.method === 'POST') {
      const felder = await formular(req);
      kern.standEntscheiden(m[1], {
        freigeben: felder.get('entscheidung') === 'freigeben',
        name: felder.get('name') ?? '',
        kommentar: felder.get('kommentar') ?? '',
      });
      return umleiten(res, pfad);
    }
    return sendeHtml(res, 200, rahmen('Stand prüfen', seitePruefen(kern, m[1])));
  }

  // Ab hier braucht es eine Person aus der Agentur.
  const person = personAusCookie(kern, req);
  const wer = { person, alle: kern.personen(person.agenturId) };

  if (liest && pfad === '/') return sendeHtml(res, 200, rahmen('Projekte', seiteUebersicht(kern, person), wer));

  if (req.method === 'POST' && pfad === '/wechseln') {
    const gewaehlt = kern.person((await formular(req)).get('person') ?? '');
    if (!gewaehlt || gewaehlt.agenturId !== person.agenturId) throw new NichtGefunden('Person nicht gefunden.');
    return umleiten(res, '/', `person=${gewaehlt.id}; Path=/; HttpOnly; SameSite=Lax`);
  }

  if (req.method === 'POST' && pfad === '/projekte') {
    const felder = await formular(req);
    const projekt = kern.projektAnlegen(person, { name: felder.get('name') ?? '', kunde: felder.get('kunde') ?? '' });
    return umleiten(res, `/projekte/${projekt.id}`);
  }

  if (liest && (m = R.projekt.exec(pfad))) {
    return sendeHtml(res, 200, rahmen('Projekt', seiteProjekt(kern, person, m[1], host), wer));
  }

  if (req.method === 'PUT' && (m = R.projektMedien.exec(pfad))) {
    try {
      const daten = await lies(req, MAX_GROESSE);
      const { medium, ergebnis } = kern.mediumHinzufuegen(person, m[1], { dateiname: url.searchParams.get('name') ?? '', daten });
      return sendeJson(res, 200, { ergebnis, dateiname: medium.dateiname });
    } catch (fehler) {
      if (fehler instanceof Fehler) return sendeJson(res, 400, { fehler: fehler.message });
      if (fehler instanceof Verboten) return sendeJson(res, 403, { fehler: fehler.message });
      throw fehler;
    }
  }

  if (req.method === 'POST' && (m = R.projektSeite.exec(pfad))) {
    const felder = await formular(req);
    kern.seiteSpeichern(person, m[1], {
      ueberschrift: felder.get('ueberschrift') ?? '',
      text: felder.get('text') ?? '',
      bildId: felder.get('bildId') || null,
      bildAlt: felder.get('bildAlt') ?? '',
    });
    return umleiten(res, `/projekte/${m[1]}`);
  }

  if (req.method === 'POST' && (m = R.projektEinreichen.exec(pfad))) {
    kern.standEinreichen(person, m[1]);
    return umleiten(res, `/projekte/${m[1]}`);
  }

  if (liest && (m = R.medium.exec(pfad))) return sendeMedium(res, kern.mediumDatei(person, m[1]));

  if (req.method === 'POST' && (m = R.mediumGesehen.exec(pfad))) {
    const medium = kern.mediumGesehen(person, m[1]);
    return umleiten(res, `/projekte/${medium.projektId}`);
  }

  throw new NichtGefunden('Diese Adresse gibt es nicht.');
}

function fehlerSeite(res: ServerResponse, fehler: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  let status = 500;
  let text = 'Da ist etwas schiefgegangen. Der Fehler steht im Protokoll des Servers.';
  if (fehler instanceof NichtGefunden) [status, text] = [404, fehler.message];
  else if (fehler instanceof Verboten) [status, text] = [403, fehler.message];
  else if (fehler instanceof Fehler) [status, text] = [400, fehler.message];
  else console.error(fehler);
  sendeHtml(res, status, rahmen('Hinweis', `<h1>Hinweis</h1><p>${esc(text)}</p><p><a href="/">Zur Projektübersicht</a></p>`));
}

export function erstelleServer(kern: Kern): Server {
  return createServer((req, res) => {
    bearbeite(kern, req, res).catch((fehler) => fehlerSeite(res, fehler));
  });
}

/** Legt beim ersten Start eine Agentur mit zwei Personen an. */
export function ersteinrichtung(kern: Kern): void {
  if (kern.agenturen().length) return;
  const agentur = kern.agenturAnlegen('Meine Agentur');
  const leitung = kern.erstePersonAnlegen(agentur.id, 'Leitung');
  kern.personAnlegen(leitung, { name: 'Mitarbeit', rolle: 'mitarbeit' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const kern = new Kern(process.env.DATEN ?? join(process.cwd(), 'daten'));
  ersteinrichtung(kern);
  const port = Number(process.env.PORT ?? 3000);
  // Es gibt noch keine Anmeldung, deshalb nur auf diesem Rechner erreichbar.
  erstelleServer(kern).listen(port, '127.0.0.1', () => {
    console.log(`Agenturtool läuft auf http://localhost:${port}`);
  });
}
