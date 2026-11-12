import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { request } from 'node:http';
import type { Server } from 'node:http';
import { Kern } from '../src/kern/kern.ts';
import { erstelleServer } from '../src/server.ts';
import { Sammelpost } from '../src/post.ts';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('bild')]);
// Die Links in Mails zeigen auf die eingestellte Adresse, nicht auf den Testserver.
const BASIS_URL = 'http://agenturtool.test';

let server: Server;
let basis = '';
const post = new Sammelpost();

async function starte(s: Server): Promise<string> {
  await new Promise<void>((fertig) => s.listen(0, '127.0.0.1', fertig));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

before(async () => {
  const kern = new Kern(mkdtempSync(join(tmpdir(), 'server-')));
  kern.erstePersonAnlegen(kern.agenturAnlegen('Testagentur').id, { name: 'Lea <Leitung>', email: 'lea@agentur.test' });
  server = erstelleServer(kern, { basisUrl: BASIS_URL + '/', post });
  basis = await starte(server);
});

after(() => {
  server.close();
});

type Felder = Record<string, string>;
const sende = (pfad: string, felder: Felder, cookie = '', ziel = basis): Promise<Response> =>
  fetch(ziel + pfad, { method: 'POST', body: new URLSearchParams(felder), redirect: 'manual', headers: { cookie } });
const hole = (pfad: string, cookie = ''): Promise<Response> => fetch(basis + pfad, { redirect: 'manual', headers: { cookie } });

/** Fordert einen Link an, holt ihn aus der Mail und löst ihn ein. Gibt das Cookie zurück. */
async function anmelden(email: string, ziel = basis): Promise<string> {
  const vorher = post.gesendet.length;
  assert.equal((await sende('/anmelden', { email }, '', ziel)).status, 200);
  await new Promise((fertig) => setImmediate(fertig));
  const mail = post.gesendet.at(-1);
  assert.equal(post.gesendet.length, vorher + 1, `Mail an ${email} verschickt`);
  assert.ok(mail);
  const pfad = new RegExp(`${BASIS_URL}(/anmelden/[A-Za-z0-9_-]+)`).exec(mail.text)?.[1] ?? '';
  assert.ok(pfad, 'Die Mail enthält den Link mit der eingestellten Adresse');
  const eingeloest = await sende(pfad, {}, '', ziel);
  assert.equal(eingeloest.status, 303);
  return (eingeloest.headers.get('set-cookie') ?? '').split(';')[0];
}

test('Ohne Anmeldung geht nichts außer Anmelden, Prüf-Link und veröffentlichten Seiten', async () => {
  const start = await hole('/');
  assert.equal(start.status, 303);
  assert.equal(start.headers.get('location'), '/anmelden');
  assert.equal((await fetch(`${basis}/projekte/00000000-0000-0000-0000-000000000000/medien?name=a.png`, { method: 'PUT', body: PNG })).status, 401);
  const angelegt = await sende('/projekte', { name: 'Eingeschleust' });
  assert.equal(angelegt.headers.get('location'), '/anmelden');
  assert.equal((await hole('/anmelden')).status, 200);
  assert.equal((await hole('/seiten/gibt-es-nicht')).status, 404);
});

test('Anmeldung: Unbekannte Adressen bekommen dieselbe Antwort, aber keine Mail', async () => {
  const vorher = post.gesendet.length;
  const antwort = await sende('/anmelden', { email: 'fremd@nirgends.test' });
  assert.equal(antwort.status, 200);
  assert.ok((await antwort.text()).includes('Schau in dein Postfach'));
  await new Promise((fertig) => setImmediate(fertig));
  assert.equal(post.gesendet.length, vorher);
});

test('Anmeldung: Der Link zeigt erst eine Bestätigung, gilt einmal, Abmelden beendet die Sitzung', async () => {
  assert.equal((await sende('/anmelden', { email: 'LEA@agentur.test' })).status, 200);
  await new Promise((fertig) => setImmediate(fertig));
  const mail = post.gesendet.at(-1);
  assert.equal(mail?.an, 'lea@agentur.test');
  const pfad = /(\/anmelden\/[A-Za-z0-9_-]+)/.exec(mail?.text ?? '')?.[1] ?? '';

  // Öffnen allein meldet nicht an, damit Link-Vorschauen den Link nicht verbrauchen.
  const bestaetigung = await hole(pfad);
  assert.equal(bestaetigung.status, 200);
  assert.ok((await bestaetigung.text()).includes('Anmelden als Lea &lt;Leitung&gt;'));
  assert.equal((await hole(pfad)).status, 200);

  const eingeloest = await sende(pfad, {});
  assert.equal(eingeloest.status, 303);
  const setzen = eingeloest.headers.get('set-cookie') ?? '';
  assert.match(setzen, /^sitzung=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  const cookie = setzen.split(';')[0];

  assert.equal((await sende(pfad, {})).status, 400, 'Zweites Einlösen scheitert');
  assert.equal((await hole(pfad)).status, 400);

  const start = await hole('/', cookie);
  assert.equal(start.status, 200);
  assert.ok((await start.text()).includes('Lea &lt;Leitung&gt;, Leitung'));
  assert.equal((await hole('/anmelden', cookie)).headers.get('location'), '/');

  const ab = await sende('/abmelden', {}, cookie);
  assert.equal(ab.headers.get('location'), '/anmelden');
  assert.match(ab.headers.get('set-cookie') ?? '', /Max-Age=0/);
  assert.equal((await hole('/', cookie)).status, 303);
});

test('Der ganze Ablauf: Projekt, Material, Entwurf, Prüf-Link, veröffentlichte Seite', async () => {
  const cookie = await anmelden('lea@agentur.test');
  const angelegt = await sende('/projekte', { name: 'Café Ahoi', kunde: 'Ahoi GmbH' }, cookie);
  assert.equal(angelegt.status, 303);
  const projektPfad = angelegt.headers.get('location') ?? '';
  assert.match(projektPfad, /^\/projekte\/[0-9a-f-]{36}$/);

  const hochladen = (name: string, body: BodyInit) =>
    fetch(`${basis}${projektPfad}/medien?name=${encodeURIComponent(name)}`, { method: 'PUT', body, headers: { cookie } });
  assert.deepEqual(await (await hochladen('tresen <1>.png', new Uint8Array(PNG))).json(), { ergebnis: 'neu', dateiname: 'tresen <1>.png' });
  assert.equal((await hochladen('boese.html', '<script>1</script>')).status, 400);

  let seite = await (await hole(projektPfad, cookie)).text();
  const bildId = /<option value="([0-9a-f-]{36})">tresen &lt;1&gt;\.png<\/option>/.exec(seite)?.[1] ?? '';
  assert.ok(bildId, 'Das Bild steht maskiert in der Auswahl');
  assert.ok(seite.includes('Neu'));

  await sende(`${projektPfad}/seite`, { ueberschrift: 'Kaffee <am> Hafen', text: 'Täglich ab 8 Uhr.', bildId, bildAlt: '' }, cookie);
  seite = await (await hole(projektPfad, cookie)).text();
  assert.ok(seite.includes('Folge: Menschen mit Screenreader'), 'Der Alt-Text-Hinweis erscheint');

  assert.equal((await hole('/seiten/cafe-ahoi')).status, 404);
  await sende(`${projektPfad}/einreichen`, {}, cookie);
  seite = await (await hole(projektPfad, cookie)).text();
  const pruefPfad = new RegExp(`value="${BASIS_URL}(/pruefen/[A-Za-z0-9_-]+)"`).exec(seite)?.[1] ?? '';
  assert.ok(pruefPfad, 'Der Prüf-Link steht mit der eingestellten Adresse auf der Projektseite');

  // Der Prüf-Link braucht keine Anmeldung.
  const pruefSeite = await hole(pruefPfad);
  // „same-origin“ hält das Token von fremden Seiten fern und lässt eigene Formulare durch die Herkunftsprüfung.
  assert.equal(pruefSeite.headers.get('referrer-policy'), 'same-origin');
  const pruefText = await pruefSeite.text();
  assert.ok(pruefText.includes('Kaffee &lt;am&gt; Hafen'));
  assert.ok(pruefText.includes('Noch nichts veröffentlicht'));
  assert.equal((await hole(`${pruefPfad}/bild`)).headers.get('content-type'), 'image/png');

  assert.equal((await sende(pruefPfad, { entscheidung: 'freigeben', name: '' })).status, 400);
  assert.equal((await sende(pruefPfad, { entscheidung: 'freigeben', name: 'Frau Ahoi' })).status, 303);

  const online = await hole('/seiten/cafe-ahoi');
  assert.equal(online.status, 200);
  assert.ok((await online.text()).includes('<h1>Kaffee &lt;am&gt; Hafen</h1>'));
  assert.deepEqual(Buffer.from(await (await hole('/seiten/cafe-ahoi/bild')).arrayBuffer()), PNG);
  assert.ok((await (await hole('/', cookie)).text()).includes('Café Ahoi'));
});

test('Team: Leitung gibt Zugang mit Einladung und entzieht ihn wieder', async () => {
  const leitung = await anmelden('lea@agentur.test');
  const vorher = post.gesendet.length;
  const angelegt = await sende('/team', { name: 'Mo', email: 'mo@agentur.test', rolle: 'mitarbeit', einladen: 'ja' }, leitung);
  assert.equal(angelegt.status, 303);
  const einladung = post.gesendet[vorher];
  assert.equal(einladung.an, 'mo@agentur.test');
  assert.ok(einladung.text.includes(`${BASIS_URL}/anmelden`));
  assert.equal((await sende('/team', { name: 'Mo 2', email: 'mo@agentur.test', rolle: 'mitarbeit' }, leitung)).status, 400);
  assert.equal((await sende('/team', { name: 'X', email: 'x@agentur.test', rolle: 'chefin' }, leitung)).status, 400);

  const mo = await anmelden('mo@agentur.test');
  const teamSeite = await (await hole('/team', mo)).text();
  assert.ok(teamSeite.includes('mo@agentur.test'));
  assert.ok(!teamSeite.includes('Zugang geben'), 'Mitarbeit sieht das Team, verwaltet es aber nicht');
  assert.equal((await sende('/team', { name: 'Y', email: 'y@agentur.test', rolle: 'leitung' }, mo)).status, 403);

  const moId = /action="\/team\/([0-9a-f-]{36})\/entziehen"/.exec(await (await hole('/team', leitung)).text())?.[1] ?? '';
  assert.ok(moId);
  assert.equal((await sende(`/team/${moId}/entziehen`, {}, leitung)).status, 303);
  assert.equal((await hole('/', mo)).status, 303, 'Die Sitzung endet sofort');
  assert.ok((await (await hole('/team', leitung)).text()).includes('kein Zugang mehr'));

  // Versehentlich entzogen: wieder geben, dann klappt die Anmeldung erneut.
  assert.equal((await sende(`/team/${moId}/wiedergeben`, {}, mo)).status, 303, 'Ohne Sitzung geht es zur Anmeldung');
  assert.equal((await sende(`/team/${moId}/wiedergeben`, {}, leitung)).status, 303);
  assert.ok(await anmelden('mo@agentur.test'));
});

test('Schreibende Anfragen von fremden Seiten werden abgelehnt', async () => {
  const cookie = await anmelden('lea@agentur.test');
  const anlegen = (name: string, headers: Record<string, string>) =>
    fetch(`${basis}/projekte`, { method: 'POST', body: new URLSearchParams({ name }), headers: { cookie, ...headers }, redirect: 'manual' });
  assert.equal((await anlegen('Eingeschleust', { Origin: 'https://boese.example' })).status, 403);
  assert.equal((await anlegen('Eingeschleust', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.ok(!(await (await hole('/', cookie)).text()).includes('Eingeschleust'));
  assert.equal((await anlegen('Von der eigenen Adresse', { Origin: BASIS_URL })).status, 303, 'Die eingestellte Adresse gilt als eigene Herkunft');
});

test('Unbekannte Adressen und ungültige Links liefern 404 oder 400', async () => {
  const cookie = await anmelden('lea@agentur.test');
  assert.equal((await hole('/gibt-es-nicht', cookie)).status, 404);
  assert.equal((await hole(`/pruefen/${'x'.repeat(32)}`)).status, 404);
  assert.equal((await hole('/medien/00000000-0000-0000-0000-000000000000', cookie)).status, 404);
  assert.equal((await hole(`/anmelden/${'x'.repeat(43)}`)).status, 400);
});

test('Unter HTTPS heißt das Cookie __Host-sitzung und ist als Secure markiert', async () => {
  const kern = new Kern(mkdtempSync(join(tmpdir(), 'sicher-')));
  kern.erstePersonAnlegen(kern.agenturAnlegen('Sicher').id, { name: 'Sina', email: 'sina@agentur.test' });
  const sicher = erstelleServer(kern, { basisUrl: 'https://tool.agentur.test', post });
  const ziel = await starte(sicher);
  try {
    await sende('/anmelden', { email: 'sina@agentur.test' }, '', ziel);
    await new Promise((fertig) => setImmediate(fertig));
    const pfad = /(\/anmelden\/[A-Za-z0-9_-]+)/.exec(post.gesendet.at(-1)?.text ?? '')?.[1] ?? '';
    const setzen = (await sende(pfad, {}, '', ziel)).headers.get('set-cookie') ?? '';
    assert.match(setzen, /^__Host-sitzung=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
    // Ein Cookie ohne Präfix zählt dort nicht.
    const ohnePraefix = setzen.split(';')[0].replace('__Host-', '');
    assert.equal((await fetch(ziel + '/', { redirect: 'manual', headers: { cookie: ohnePraefix } })).status, 303);
  } finally {
    sicher.close();
  }
});

test('Lokal: Einrichten im Browser und Anmelden per Klick, aber nur auf diesem Rechner', async () => {
  const kern = new Kern(mkdtempSync(join(tmpdir(), 'lokal-')));
  const lokal = erstelleServer(kern, { basisUrl: 'http://localhost:3000', post: new Sammelpost(), lokal: true });
  const ziel = (await starte(lokal)).replace('127.0.0.1', 'localhost');
  try {
    const leer = await (await fetch(`${ziel}/anmelden`)).text();
    assert.ok(leer.includes('Agentur einrichten'));
    const eingerichtet = await sende('/lokal/einrichten', { agentur: 'Studio <A>', name: 'Tim', email: 'tim@agentur.test' }, '', ziel);
    assert.equal(eingerichtet.status, 303);
    const cookie = (eingerichtet.headers.get('set-cookie') ?? '').split(';')[0];
    assert.equal((await fetch(`${ziel}/`, { headers: { cookie }, redirect: 'manual' })).status, 200);
    assert.equal((await sende('/lokal/einrichten', { agentur: 'B', name: 'X', email: 'x@agentur.test' }, '', ziel)).status, 400);

    const auswahl = await (await fetch(`${ziel}/anmelden`)).text();
    const personId = /name="person" value="([0-9a-f-]{36})"/.exec(auswahl)?.[1] ?? '';
    assert.ok(auswahl.includes('Tim') && personId);
    assert.equal((await sende('/lokal/anmelden', { person: personId }, '', ziel)).status, 303);

    // Über einen Proxy mit fremdem Namen kommt der lokale Weg nicht an.
    const ueberProxy = await new Promise<{ status: number; text: string }>((fertig, scheitern) => {
      const anfrage = request(`${ziel}/anmelden`, { headers: { host: 'tool.agentur.test' } }, (antwort) => {
        let text = '';
        antwort.on('data', (teil: Buffer) => (text += teil.toString()));
        antwort.on('end', () => fertig({ status: antwort.statusCode ?? 0, text }));
      });
      anfrage.on('error', scheitern);
      anfrage.end();
    });
    assert.equal(ueberProxy.status, 200);
    assert.ok(ueberProxy.text.includes('Link schicken') && !ueberProxy.text.includes('name="person"'));
  } finally {
    lokal.close();
  }
  // Ohne lokalen Modus gibt es den Weg gar nicht.
  assert.equal((await sende('/lokal/anmelden', { person: '00000000-0000-0000-0000-000000000000' })).status, 404);
});
