import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Fehler, Kern, LINK_GUELTIG_MINUTEN, MAX_GROESSE, NichtGefunden, SITZUNG_GUELTIG_TAGE } from './kern/kern.ts';
import { darf, Verboten } from './kern/rechte.ts';
import { esc, regelwerkCss, renderWebsite } from './renderer/seite.ts';
import { seiteRegelwerk, teilRegelwerk } from './oberflaeche/regelwerk.ts';
import { alsTokens, ausTokens, STANDARD_REGELWERK } from './kern/regelwerk.ts';
import { ausFormular, seiteEditor, seitePruefen, teilSeiten, wendeAktionAn } from './oberflaeche/editor.ts';
import { groesse, ROLLEN_NAME, zeit } from './oberflaeche/format.ts';
import { Protokollpost, smtpAusUmgebung } from './post.ts';
import type { Post } from './post.ts';
import type { Ereignis, Medium, Person, Projekt, ProjektUebersicht, Rolle, Stand } from './kern/typen.ts';

export interface Einstellungen {
  /** Adresse, unter der das Werkzeug erreichbar ist, etwa `https://tool.agentur.de`. Links in Mails bauen darauf auf. */
  basisUrl: string;
  post: Post;
  /**
   * Arbeit auf dem eigenen Rechner: Einrichten im Browser und Anmelden per Klick, ohne Mail.
   * Gilt nur für Anfragen, die von diesem Rechner an localhost gehen.
   */
  lokal?: boolean;
}

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
function pruefeHerkunft(req: IncomingMessage, basisUrl: string): void {
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new Verboten('Anfrage von fremder Seite abgelehnt.');
  const herkunft = req.headers.origin;
  if (!herkunft || herkunft === new URL(basisUrl).origin) return;
  let host = '';
  try {
    host = new URL(herkunft).host;
  } catch {
    // ungültige Herkunft fällt unten durch
  }
  if (host !== req.headers.host) throw new Verboten('Anfrage von fremder Seite abgelehnt.');
}

// --- Sitzung -------------------------------------------------------------------

/** Unter HTTPS mit dem Präfix `__Host-`: Dann nimmt der Browser das Cookie nur von genau dieser Adresse an. */
const cookieName = (sicher: boolean): string => (sicher ? '__Host-sitzung' : 'sitzung');

function sitzungAusCookie(req: IncomingMessage, sicher: boolean): string | null {
  for (const teil of (req.headers.cookie ?? '').split(';')) {
    const [name, ...wert] = teil.trim().split('=');
    if (name === cookieName(sicher) && /^[A-Za-z0-9_-]{43}$/.test(wert.join('='))) return wert.join('=');
  }
  return null;
}

/** Kommt die Anfrage von diesem Rechner und ist an localhost gerichtet? Über einen Proxy aus dem Netz nie. */
function vonDiesemRechner(req: IncomingMessage): boolean {
  const absender = req.socket.remoteAddress ?? '';
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(absender) && ['localhost', '127.0.0.1', '[::1]'].includes(host);
}

function sitzungsCookie(wert: string, sicher: boolean, sekunden: number): string {
  return `${cookieName(sicher)}=${wert}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sekunden}${sicher ? '; Secure' : ''}`;
}

// --- Antworten ----------------------------------------------------------------

function sendeHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, KOPF_HTML);
  res.end(html);
}

function sendeCss(res: ServerResponse, css: string): void {
  res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
  res.end(css);
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

function rahmen(titel: string, inhalt: string, person?: Person, breit = false, stile: string[] = []): string {
  const navigation = person
    ? `<nav class="navigation" aria-label="Hauptnavigation">
<a href="/">Projekte</a>${darf(person, 'team.ansehen') ? '<a href="/team">Team</a>' : ''}
<span class="wer">${esc(person.name)}, ${ROLLEN_NAME[person.rolle]}</span>
<form method="post" action="/abmelden"><button type="submit" class="zweit">Abmelden</button></form>
</nav>`
    : '';
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titel)} · Agenturtool</title>
<link rel="stylesheet" href="/stil.css">
<link rel="stylesheet" href="/seite.css">
${stile.map((href) => `<link rel="stylesheet" href="${esc(href)}">`).join('\n')}
<script src="/app.js" defer></script>
</head>
<body>
<header class="kopf"><a href="/" class="marke">Agenturtool</a>${navigation}</header>
<main${breit ? ' class="breit"' : ''}>${inhalt}</main>
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
  return `<section id="material"><h2>Material</h2>${ablage}${liste}</section>`;
}

function teilFreigabe(stand: Stand | null, projektId: string, slug: string, basisUrl: string, darfEinreichen: boolean): string {
  let zustand = '<p class="leer">Noch kein Stand eingereicht.</p>';
  if (stand?.zustand === 'eingereicht') {
    zustand = `<p>Eingereicht von ${esc(stand.eingereichtVon)} am ${zeit(stand.eingereichtAm)}. Wartet auf Freigabe.</p>
<label for="link">Prüf-Link zum Weitergeben</label>
<input id="link" readonly value="${esc(basisUrl)}/pruefen/${esc(stand.token)}">`;
  } else if (stand?.zustand === 'freigegeben') {
    zustand = `<p>Freigegeben von ${esc(stand.entschiedenVon)} am ${zeit(stand.entschiedenAm ?? stand.eingereichtAm)}.
<a href="/seiten/${esc(slug)}">Website ansehen</a></p>`;
  } else if (stand?.zustand === 'abgelehnt') {
    zustand = `<p>Änderung gewünscht von ${esc(stand.entschiedenVon)} am ${zeit(stand.entschiedenAm ?? stand.eingereichtAm)}.</p>
${stand.kommentar ? `<blockquote>${esc(stand.kommentar)}</blockquote>` : ''}`;
  }
  const knopf = darfEinreichen
    ? `<form method="post" action="/projekte/${esc(projektId)}/einreichen"><button type="submit">Alle Seiten als Stand einreichen</button></form>`
    : '';
  return `<section><h2>Freigabe</h2>${zustand}${knopf}</section>`;
}

function teilVerlauf(ereignisse: Ereignis[]): string {
  return `<section><h2>Verlauf</h2><ol class="verlauf">${ereignisse
    .map((e) => `<li><time datetime="${esc(e.zeit)}">${zeit(e.zeit)}</time><span>${esc(e.personName)}</span><span>${esc(e.text)}</span></li>`)
    .join('')}</ol></section>`;
}

function seiteProjekt(kern: Kern, person: Person, projektId: string, basisUrl: string): string {
  const projekt = kern.projekt(person, projektId);
  return `<p class="pfad"><a href="/">Projekte</a></p>
<h1>${esc(projekt.name)}</h1>
${projekt.kunde ? `<p class="unterzeile">${esc(projekt.kunde)}</p>` : ''}
${teilSeiten(person, projekt, kern.seiten(person, projekt.id))}
${teilRegelwerk(person, projekt, kern.regelwerk(person, projekt.id))}
${teilMedien(person, projekt.id, kern.medien(person, projekt.id))}
${teilFreigabe(kern.letzterStand(person, projekt.id), projekt.id, projekt.slug, basisUrl, darf(person, 'stand.einreichen', projekt))}
${teilVerlauf(kern.verlauf(person, projekt.id))}`;
}

function seiteAnmelden(): string {
  return `<div class="schmal">
<h1>Anmelden</h1>
<p>Gib deine Mail-Adresse ein. Du bekommst einen Link, mit dem du dich ohne Passwort anmeldest.</p>
<form method="post" action="/anmelden" class="felder">
<label for="email">Mail-Adresse</label>
<input id="email" name="email" type="email" required maxlength="254" autocomplete="email" autofocus>
<button type="submit">Link schicken</button>
</form>
</div>`;
}

function seiteLokalEinrichten(): string {
  return `<div class="schmal">
<h1>Agentur einrichten</h1>
<p>Das Werkzeug läuft auf diesem Rechner. Leg die Agentur und dich als Leitung an, weitere Personen kommen danach unter „Team“ dazu.</p>
<form method="post" action="/lokal/einrichten" class="felder">
<label for="agentur">Name der Agentur</label><input id="agentur" name="agentur" required maxlength="120" autofocus>
<label for="name">Dein Name</label><input id="name" name="name" required maxlength="80" autocomplete="name">
<label for="email">Deine Mail-Adresse</label><input id="email" name="email" type="email" required maxlength="254" autocomplete="email">
<button type="submit">Einrichten</button>
</form>
<p class="leer">Die Mail-Adresse braucht es erst, wenn das Werkzeug im Netz läuft. Dann kommt der Anmelde-Link dorthin.</p>
</div>`;
}

function seiteLokalAnmelden(personen: Person[]): string {
  return `<div class="schmal">
<h1>Anmelden</h1>
<p>Auf diesem Rechner geht es ohne Mail: einfach die Person wählen. So lässt sich auch ausprobieren, was Mitarbeit oder Kund:innen sehen.</p>
<ul class="team">${personen
    .map(
      (p) => `<li><div><strong>${esc(p.name)}</strong><small>${ROLLEN_NAME[p.rolle]}</small></div>
<form method="post" action="/lokal/anmelden"><input type="hidden" name="person" value="${esc(p.id)}"><button type="submit">Anmelden</button></form></li>`,
    )
    .join('')}</ul>
</div>`;
}

function seiteLinkUnterwegs(): string {
  return `<div class="schmal">
<h1>Schau in dein Postfach</h1>
<p>Wenn die Adresse einen Zugang hat, ist ein Link unterwegs. Er gilt ${LINK_GUELTIG_MINUTEN} Minuten und funktioniert einmal.</p>
<p class="leer">Nichts gekommen? Sieh im Spam-Ordner nach oder <a href="/anmelden">fordere einen neuen Link an</a>.</p>
</div>`;
}

function seiteLinkBestaetigen(person: Person): string {
  return `<div class="schmal">
<h1>Anmelden als ${esc(person.name)}</h1>
<p class="unterzeile">${esc(person.email ?? '')}</p>
<form method="post" class="felder">
<button type="submit">Jetzt anmelden</button>
</form>
<p class="leer">Du bleibst ${SITZUNG_GUELTIG_TAGE} Tage auf diesem Gerät angemeldet. Der Knopf ist da, weil manche Mailprogramme Links vorab öffnen und sie sonst verbrauchen würden.</p>
</div>`;
}

const ROLLEN_WAHL: Rolle[] = ['mitarbeit', 'leitung', 'kundin'];

function seiteTeam(kern: Kern, person: Person): string {
  const verwalten = darf(person, 'team.verwalten');
  const projekte = verwalten ? kern.projekte(person) : [];
  const projektName = new Map<string, Projekt>(projekte.map((p) => [p.id, p]));
  const liste = `<ul class="team">${kern
    .team(person)
    .map((p) => {
      const projekt = p.projektId ? projektName.get(p.projektId) : undefined;
      const rolle = `${ROLLEN_NAME[p.rolle]}${projekt ? ` für ${esc(projekt.name)}` : ''}`;
      let knopf = '';
      if (verwalten && p.id !== person.id) {
        knopf = p.aktiv
          ? `<form method="post" action="/team/${esc(p.id)}/entziehen"><button type="submit" class="leise">Zugang entziehen</button></form>`
          : `<form method="post" action="/team/${esc(p.id)}/wiedergeben"><button type="submit" class="leise">Zugang wieder geben</button></form>`;
      }
      return `<li${p.aktiv ? '' : ' class="inaktiv"'}><div><strong>${esc(p.name)}</strong>
<small>${esc(p.email ?? 'keine Mail-Adresse')} · ${rolle}${p.aktiv ? '' : ' · kein Zugang mehr'}</small></div>${knopf}</li>`;
    })
    .join('')}</ul>`;
  const neu = verwalten
    ? `<section><h2>Zugang geben</h2>
<form method="post" action="/team" class="felder">
<label for="name">Name</label><input id="name" name="name" required maxlength="80" autocomplete="off">
<label for="email">Mail-Adresse</label><input id="email" name="email" type="email" required maxlength="254" autocomplete="off">
<label for="rolle">Rolle</label><select id="rolle" name="rolle">${ROLLEN_WAHL.map(
        (r) => `<option value="${r}">${ROLLEN_NAME[r]}</option>`,
      ).join('')}</select>
<label for="projektId">Projekt, nur für Kund:innen</label><select id="projektId" name="projektId"><option value="">Kein Projekt</option>${projekte
        .map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
        .join('')}</select>
<label class="haken"><input type="checkbox" name="einladen" value="ja" checked> Einladung per Mail schicken</label>
<button type="submit">Zugang geben</button>
</form>
<p class="leer">Kund:innen sehen nur ihr Projekt und können dort Material ablegen. Freigaben laufen weiter über den Prüf-Link, dafür braucht niemand einen Zugang.</p>
</section>`
    : '';
  return `<h1>Team</h1><section><h2>Wer Zugang hat</h2>${liste}</section>${neu}`;
}

// --- Verteiler ----------------------------------------------------------------

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TOKEN = '[A-Za-z0-9_-]{20,}';
const SLUG = '[a-z0-9-]+';
const R = {
  website: new RegExp(`^/seiten/(${SLUG})$`),
  websiteSeite: new RegExp(`^/seiten/(${SLUG})/(${SLUG})$`),
  websiteBild: new RegExp(`^/seiten/(${SLUG})/_bilder/(${UUID})$`),
  websiteRegelwerk: new RegExp(`^/seiten/(${SLUG})/_regelwerk\\.css$`),
  pruefenRegelwerk: new RegExp(`^/pruefen/(${TOKEN})/regelwerk\\.css$`),
  regelwerk: new RegExp(`^/projekte/(${UUID})/regelwerk$`),
  regelwerkCss: new RegExp(`^/projekte/(${UUID})/regelwerk\\.css$`),
  regelwerkTokens: new RegExp(`^/projekte/(${UUID})/regelwerk\\.tokens\\.json$`),
  regelwerkVorschlag: new RegExp(`^/projekte/(${UUID})/regelwerk/vorschlag$`),
  regelwerkEinlesen: new RegExp(`^/projekte/(${UUID})/regelwerk/tokens$`),
  pruefen: new RegExp(`^/pruefen/(${TOKEN})$`),
  pruefenBild: new RegExp(`^/pruefen/(${TOKEN})/bilder/(${UUID})$`),
  anmeldeLink: new RegExp(`^/anmelden/(${TOKEN})$`),
  projekt: new RegExp(`^/projekte/(${UUID})$`),
  projektMedien: new RegExp(`^/projekte/(${UUID})/medien$`),
  projektSeiten: new RegExp(`^/projekte/(${UUID})/seiten$`),
  seite: new RegExp(`^/projekte/(${UUID})/seiten/(${UUID})$`),
  seiteVerschieben: new RegExp(`^/projekte/(${UUID})/seiten/(${UUID})/verschieben$`),
  seiteLoeschen: new RegExp(`^/projekte/(${UUID})/seiten/(${UUID})/loeschen$`),
  projektEinreichen: new RegExp(`^/projekte/(${UUID})/einreichen$`),
  medium: new RegExp(`^/medien/(${UUID})$`),
  mediumGesehen: new RegExp(`^/medien/(${UUID})/gesehen$`),
  zugangEntziehen: new RegExp(`^/team/(${UUID})/entziehen$`),
  zugangWiedergeben: new RegExp(`^/team/(${UUID})/wiedergeben$`),
};

/** Zeigt eine Seite der veröffentlichten Website. */
function sendeWebsite(kern: Kern, res: ServerResponse, projektSlug: string, seitenSlug: string | null): void {
  const online = kern.veroeffentlicht(projektSlug);
  const seite = online && (seitenSlug === null ? online.website.seiten[0] : online.website.seiten.find((s) => s.slug === seitenSlug));
  if (!online || !seite) throw new NichtGefunden('Diese Seite ist nicht veröffentlicht.');
  sendeHtml(
    res,
    200,
    renderWebsite(online.website, seite, {
      projektName: online.projekt.name,
      bildUrl: (id) => `/seiten/${projektSlug}/_bilder/${id}`,
      seitenUrl: (s, i) => (i === 0 ? `/seiten/${projektSlug}` : `/seiten/${projektSlug}/${s.slug}`),
      regelwerkUrl: `/seiten/${projektSlug}/_regelwerk.css`,
    }),
  );
}

async function bearbeite(kern: Kern, e: Einstellungen, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://lokal');
  const pfad = url.pathname;
  const liest = req.method === 'GET' || req.method === 'HEAD';
  const sicher = e.basisUrl.startsWith('https://');
  if (!liest) pruefeHerkunft(req, e.basisUrl);
  let m: RegExpExecArray | null;

  const statisch = STATISCH[pfad];
  if (liest && statisch) {
    res.writeHead(200, { 'Content-Type': statisch.typ, 'X-Content-Type-Options': 'nosniff' });
    res.end(statisch.inhalt);
    return;
  }

  // Öffentlich: veröffentlichte Website und Prüf-Link.
  if (liest && (m = R.website.exec(pfad))) return sendeWebsite(kern, res, m[1], null);
  if (liest && (m = R.websiteBild.exec(pfad))) return sendeMedium(res, kern.bildVeroeffentlicht(m[1], m[2]));
  if (liest && (m = R.websiteRegelwerk.exec(pfad))) {
    const online = kern.veroeffentlicht(m[1]);
    if (!online) throw new NichtGefunden('Diese Seite ist nicht veröffentlicht.');
    return sendeCss(res, regelwerkCss(online.website.regelwerk ?? STANDARD_REGELWERK, '.oeffentlich'));
  }
  if (liest && (m = R.pruefenRegelwerk.exec(pfad))) {
    const { stand, veroeffentlicht } = kern.standPerToken(m[1]);
    return sendeCss(
      res,
      regelwerkCss(stand.inhalt.regelwerk ?? STANDARD_REGELWERK, '.vorschau[data-regelwerk="neu"]') +
        regelwerkCss(veroeffentlicht?.regelwerk ?? STANDARD_REGELWERK, '.vorschau[data-regelwerk="online"]'),
    );
  }
  if (liest && (m = R.websiteSeite.exec(pfad))) return sendeWebsite(kern, res, m[1], m[2]);
  if (liest && (m = R.pruefenBild.exec(pfad))) return sendeMedium(res, kern.bildZumStand(m[1], m[2]));
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
    return sendeHtml(res, 200, rahmen('Stand prüfen', seitePruefen(kern.standPerToken(m[1]), m[1]), undefined, true, [`/pruefen/${m[1]}/regelwerk.css`]));
  }

  // Anmeldung per Mail-Link.
  const sitzung = sitzungAusCookie(req, sicher);
  const person = sitzung ? kern.sitzungPerson(sitzung) : null;

  // Auf dem eigenen Rechner: einrichten und anmelden ohne Mail.
  const lokal = Boolean(e.lokal) && vonDiesemRechner(req);
  if (pfad.startsWith('/lokal/')) {
    if (!lokal || req.method !== 'POST') throw new NichtGefunden('Diese Adresse gibt es nicht.');
    const felder = await formular(req);
    let neu: string;
    if (pfad === '/lokal/einrichten') {
      if (kern.agenturen().length) throw new Fehler('Die Agentur ist schon eingerichtet.');
      const agentur = kern.agenturAnlegen(felder.get('agentur') ?? '');
      const leitung = kern.erstePersonAnlegen(agentur.id, { name: felder.get('name') ?? '', email: felder.get('email') ?? '' });
      neu = kern.sitzungOhneLink(leitung.id).sitzung;
    } else if (pfad === '/lokal/anmelden') {
      neu = kern.sitzungOhneLink(felder.get('person') ?? '').sitzung;
    } else {
      throw new NichtGefunden('Diese Adresse gibt es nicht.');
    }
    return umleiten(res, '/', sitzungsCookie(neu, sicher, SITZUNG_GUELTIG_TAGE * 24 * 60 * 60));
  }

  if (pfad === '/anmelden') {
    if (person) return umleiten(res, '/');
    if (liest && lokal) {
      const personen = kern.anmeldbarePersonen();
      return sendeHtml(res, 200, rahmen('Anmelden', personen.length ? seiteLokalAnmelden(personen) : seiteLokalEinrichten()));
    }
    if (req.method === 'POST') {
      const treffer = kern.anmeldungAnfordern((await formular(req)).get('email') ?? '');
      if (treffer) {
        // Nicht abwarten: Sonst verrät die Antwortzeit, ob es die Adresse gibt.
        e.post
          .senden({
            an: treffer.person.email ?? '',
            betreff: 'Dein Anmelde-Link für das Agenturtool',
            text: `Hallo ${treffer.person.name},

hier ist dein Link zum Anmelden:
${e.basisUrl}/anmelden/${treffer.token}

Er gilt ${LINK_GUELTIG_MINUTEN} Minuten und funktioniert einmal.

Du hast keinen Link angefordert? Dann kannst du diese Mail ignorieren. Ohne den Link meldet sich niemand an.`,
          })
          .catch((fehler: unknown) => console.error('Anmelde-Mail nicht versendet:', fehler));
      }
      return sendeHtml(res, 200, rahmen('Link unterwegs', seiteLinkUnterwegs()));
    }
    return sendeHtml(res, 200, rahmen('Anmelden', seiteAnmelden()));
  }

  if ((m = R.anmeldeLink.exec(pfad))) {
    if (req.method === 'POST') {
      const { sitzung: neu } = kern.anmeldungEinloesen(m[1]);
      return umleiten(res, '/', sitzungsCookie(neu, sicher, SITZUNG_GUELTIG_TAGE * 24 * 60 * 60));
    }
    return sendeHtml(res, 200, rahmen('Anmelden', seiteLinkBestaetigen(kern.anmeldungPruefen(m[1]))));
  }

  if (req.method === 'POST' && pfad === '/abmelden') {
    if (sitzung) kern.abmelden(sitzung);
    return umleiten(res, '/anmelden', sitzungsCookie('', sicher, 0));
  }

  // Ab hier braucht es eine angemeldete Person.
  if (!person) {
    if (req.method === 'PUT') return sendeJson(res, 401, { fehler: 'Bitte neu anmelden.' });
    return umleiten(res, '/anmelden');
  }

  if (liest && pfad === '/') return sendeHtml(res, 200, rahmen('Projekte', seiteUebersicht(kern, person), person));

  if (liest && pfad === '/team') return sendeHtml(res, 200, rahmen('Team', seiteTeam(kern, person), person));

  if (req.method === 'POST' && pfad === '/team') {
    const felder = await formular(req);
    const rolle = felder.get('rolle') as Rolle;
    if (!ROLLEN_WAHL.includes(rolle)) throw new Fehler('Unbekannte Rolle.');
    const neu = kern.personAnlegen(person, {
      name: felder.get('name') ?? '',
      email: felder.get('email') ?? '',
      rolle,
      projektId: rolle === 'kundin' ? felder.get('projektId') || null : null,
    });
    if (felder.get('einladen') === 'ja') {
      try {
        await e.post.senden({
          an: neu.email ?? '',
          betreff: 'Dein Zugang zum Agenturtool',
          text: `Hallo ${neu.name},

${person.name} hat dir einen Zugang zum Agenturtool gegeben.
Zum Anmelden diese Seite öffnen und deine Mail-Adresse eingeben:
${e.basisUrl}/anmelden

Ein Passwort brauchst du nicht. Du bekommst jedes Mal einen Link per Mail.`,
        });
      } catch (fehler) {
        console.error('Einladung nicht versendet:', fehler);
        throw new Fehler(`Der Zugang für ${neu.name} ist angelegt, aber die Einladung ging nicht raus. Die Person kann sich trotzdem unter ${e.basisUrl}/anmelden anmelden.`);
      }
    }
    return umleiten(res, '/team');
  }

  if (req.method === 'POST' && (m = R.zugangEntziehen.exec(pfad))) {
    kern.zugangEntziehen(person, m[1]);
    return umleiten(res, '/team');
  }

  if (req.method === 'POST' && (m = R.zugangWiedergeben.exec(pfad))) {
    kern.zugangWiedergeben(person, m[1]);
    return umleiten(res, '/team');
  }

  if (req.method === 'POST' && pfad === '/projekte') {
    const felder = await formular(req);
    const projekt = kern.projektAnlegen(person, { name: felder.get('name') ?? '', kunde: felder.get('kunde') ?? '' });
    return umleiten(res, `/projekte/${projekt.id}`);
  }

  if (liest && (m = R.projekt.exec(pfad))) {
    return sendeHtml(res, 200, rahmen('Projekt', seiteProjekt(kern, person, m[1], e.basisUrl), person));
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

  if (req.method === 'POST' && (m = R.projektSeiten.exec(pfad))) {
    const seite = kern.seiteAnlegen(person, m[1], (await formular(req)).get('titel') ?? '');
    return umleiten(res, `/projekte/${m[1]}/seiten/${seite.id}`);
  }

  if ((m = R.seite.exec(pfad))) {
    const [, projektId, seiteId] = m;
    const seite = kern.seite(person, seiteId);
    if (seite.projektId !== projektId) throw new NichtGefunden('Seite nicht gefunden.');
    if (liest) {
      const projekt = kern.projekt(person, projektId);
      return sendeHtml(
        res,
        200,
        rahmen(seite.titel, seiteEditor(person, projekt, seite, kern.medien(person, projektId), e.basisUrl), person, true, [`/projekte/${projektId}/regelwerk.css`]),
      );
    }
    if (req.method === 'POST') {
      const felder = await formular(req);
      const eingabe = ausFormular(felder);
      const { bausteine, ziel } = wendeAktionAn(eingabe.bausteine, felder.get('aktion') ?? 'speichern', felder.get('neuTyp'));
      kern.seiteSpeichern(person, seiteId, { titel: eingabe.titel, bausteine });
      return umleiten(res, `/projekte/${projektId}/seiten/${seiteId}${ziel ? `#b-${ziel}` : ''}`);
    }
  }

  // Regelwerk
  if ((m = R.regelwerk.exec(pfad))) {
    const projekt = kern.projekt(person, m[1]);
    if (req.method === 'POST') {
      kern.regelwerkSpeichern(person, projekt.id, Object.fromEntries(await formular(req)));
      return umleiten(res, `/projekte/${projekt.id}/regelwerk`);
    }
    const stile = [`/projekte/${projekt.id}/regelwerk.css`];
    return sendeHtml(res, 200, rahmen('Regelwerk', seiteRegelwerk(person, projekt, kern.regelwerk(person, projekt.id)), person, true, stile));
  }
  if (liest && (m = R.regelwerkCss.exec(pfad))) return sendeCss(res, regelwerkCss(kern.regelwerk(person, m[1]), '.vorschau'));
  if (liest && (m = R.regelwerkTokens.exec(pfad))) {
    const projekt = kern.projekt(person, m[1]);
    res.writeHead(200, {
      'Content-Type': 'application/design-tokens+json; charset=utf-8',
      'Content-Disposition': `attachment; filename="regelwerk-${projekt.slug}.tokens.json"`,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(alsTokens(kern.regelwerk(person, projekt.id), projekt.name), null, 2));
    return;
  }
  if (req.method === 'POST' && (m = R.regelwerkVorschlag.exec(pfad))) {
    const felder = await formular(req);
    kern.regelwerkSpeichern(person, m[1], { [felder.get('feld') ?? '']: felder.get('wert') ?? '' });
    return umleiten(res, `/projekte/${m[1]}/regelwerk`);
  }
  if (req.method === 'POST' && (m = R.regelwerkEinlesen.exec(pfad))) {
    const projekt = kern.projekt(person, m[1]);
    let json: unknown;
    try {
      json = JSON.parse((await formular(req)).get('json') ?? '');
    } catch {
      throw new Fehler('Das ist kein gültiges JSON. Am besten die ganze Datei einfügen.');
    }
    const ergebnis = ausTokens(json, kern.regelwerk(person, projekt.id));
    const neu = kern.regelwerkSpeichern(person, projekt.id, ergebnis.regelwerk);
    return sendeHtml(res, 200, rahmen('Regelwerk', seiteRegelwerk(person, projekt, neu, ergebnis), person, true, [`/projekte/${projekt.id}/regelwerk.css`]));
  }

  if (req.method === 'POST' && (m = R.seiteVerschieben.exec(pfad))) {
    if (kern.seite(person, m[2]).projektId !== m[1]) throw new NichtGefunden('Seite nicht gefunden.');
    kern.seiteVerschieben(person, m[2], (await formular(req)).get('richtung') === 'hoch' ? -1 : 1);
    return umleiten(res, `/projekte/${m[1]}#seiten`);
  }

  if (req.method === 'POST' && (m = R.seiteLoeschen.exec(pfad))) {
    if (kern.seite(person, m[2]).projektId !== m[1]) throw new NichtGefunden('Seite nicht gefunden.');
    if ((await formular(req)).get('sicher') !== 'ja') throw new Fehler('Zum Löschen bitte das Häkchen setzen.');
    kern.seiteLoeschen(person, m[2]);
    return umleiten(res, `/projekte/${m[1]}#seiten`);
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
  sendeHtml(res, status, rahmen('Hinweis', `<div class="schmal"><h1>Hinweis</h1><p>${esc(text)}</p><p><a href="/">Zur Startseite</a></p></div>`));
}

export function erstelleServer(kern: Kern, einstellungen: Einstellungen): Server {
  const e = { ...einstellungen, basisUrl: einstellungen.basisUrl.replace(/\/+$/, '') };
  return createServer((req, res) => {
    bearbeite(kern, e, req, res).catch((fehler) => fehlerSeite(res, fehler));
  });
}

const LOKALE_HOSTS = ['127.0.0.1', '::1', 'localhost'];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  // Standard bleibt 127.0.0.1. Ins Netz geht das Werkzeug über einen Proxy mit HTTPS auf demselben Rechner.
  const host = process.env.HOST ?? '127.0.0.1';
  const basisUrl = (process.env.BASIS_URL ?? `http://localhost:${port}`).replace(/\/+$/, '');
  const entwicklung = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(basisUrl);

  const beenden = (grund: string): never => {
    console.error(grund);
    process.exit(1);
  };
  if (!LOKALE_HOSTS.includes(host) && !basisUrl.startsWith('https://')) {
    beenden('Wer außerhalb dieses Rechners lauscht, braucht eine BASIS_URL mit https://.');
  }
  const smtp = smtpAusUmgebung(process.env);
  if (!smtp && !entwicklung) beenden('Ohne SMTP_HOST gehen keine Anmelde-Mails raus. Die Einstellungen stehen in der README.');

  const kern = new Kern(process.env.DATEN ?? join(process.cwd(), 'daten'));
  if (!kern.agenturen().length && !entwicklung) {
    console.log('Noch keine Agentur eingerichtet. Zuerst: npm run einrichten -- --agentur "Name" --name "Dein Name" --email "du@agentur.de"');
  }
  // Ohne Mailserver auf localhost: Einrichten und Anmelden gehen direkt im Browser.
  const lokal = entwicklung && !smtp;
  erstelleServer(kern, { basisUrl, post: smtp ?? new Protokollpost(), lokal }).listen(port, host, () => {
    console.log(`Agenturtool läuft auf ${basisUrl}${lokal ? ' (lokal: Anmelden per Klick, ohne Mail)' : ''}`);
  });
}
