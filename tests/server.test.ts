import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Kern } from '../src/kern/kern.ts';
import { ersteinrichtung, erstelleServer } from '../src/server.ts';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('bild')]);

let server: Server;
let basis = '';

before(async () => {
  const kern = new Kern(mkdtempSync(join(tmpdir(), 'server-')));
  ersteinrichtung(kern);
  server = erstelleServer(kern);
  await new Promise<void>((fertig) => server.listen(0, '127.0.0.1', fertig));
  basis = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

const sende = (pfad: string, felder: Record<string, string>): Promise<Response> =>
  fetch(basis + pfad, { method: 'POST', body: new URLSearchParams(felder), redirect: 'manual' });

test('Der ganze Ablauf: Projekt, Material, Entwurf, Prüf-Link, veröffentlichte Seite', async () => {
  const angelegt = await sende('/projekte', { name: 'Café Ahoi', kunde: 'Ahoi GmbH' });
  assert.equal(angelegt.status, 303);
  const projektPfad = angelegt.headers.get('location') ?? '';
  assert.match(projektPfad, /^\/projekte\/[0-9a-f-]{36}$/);

  const hochgeladen = await fetch(`${basis}${projektPfad}/medien?name=${encodeURIComponent('tresen <1>.png')}`, { method: 'PUT', body: PNG });
  assert.deepEqual(await hochgeladen.json(), { ergebnis: 'neu', dateiname: 'tresen <1>.png' });

  const abgelehnt = await fetch(`${basis}${projektPfad}/medien?name=boese.html`, { method: 'PUT', body: '<script>1</script>' });
  assert.equal(abgelehnt.status, 400);

  let seite = await (await fetch(basis + projektPfad)).text();
  const bildId = /<option value="([0-9a-f-]{36})">tresen &lt;1&gt;\.png<\/option>/.exec(seite)?.[1] ?? '';
  assert.ok(bildId, 'Das Bild steht maskiert in der Auswahl');
  assert.ok(seite.includes('Neu'));

  await sende(`${projektPfad}/seite`, { ueberschrift: 'Kaffee <am> Hafen', text: 'Täglich ab 8 Uhr.', bildId, bildAlt: '' });
  seite = await (await fetch(basis + projektPfad)).text();
  assert.ok(seite.includes('Folge: Menschen mit Screenreader'), 'Der Alt-Text-Hinweis erscheint');

  assert.equal((await fetch(`${basis}/seiten/cafe-ahoi`)).status, 404);
  await sende(`${projektPfad}/einreichen`, {});
  seite = await (await fetch(basis + projektPfad)).text();
  const pruefPfad = /value="http:\/\/[^"/]+(\/pruefen\/[A-Za-z0-9_-]+)"/.exec(seite)?.[1] ?? '';
  assert.ok(pruefPfad, 'Der Prüf-Link steht auf der Projektseite');

  const pruefSeite = await fetch(basis + pruefPfad);
  // „same-origin“ hält das Token von fremden Seiten fern und lässt eigene Formulare durch die Herkunftsprüfung.
  assert.equal(pruefSeite.headers.get('referrer-policy'), 'same-origin');
  const pruefText = await pruefSeite.text();
  assert.ok(pruefText.includes('Kaffee &lt;am&gt; Hafen'));
  assert.ok(pruefText.includes('Noch nichts veröffentlicht'));
  assert.equal((await fetch(`${basis}${pruefPfad}/bild`)).headers.get('content-type'), 'image/png');

  assert.equal((await sende(pruefPfad, { entscheidung: 'freigeben', name: '' })).status, 400);
  assert.equal((await sende(pruefPfad, { entscheidung: 'freigeben', name: 'Frau Ahoi' })).status, 303);

  const online = await fetch(`${basis}/seiten/cafe-ahoi`);
  assert.equal(online.status, 200);
  assert.ok((await online.text()).includes('<h1>Kaffee &lt;am&gt; Hafen</h1>'));
  assert.deepEqual(Buffer.from(await (await fetch(`${basis}/seiten/cafe-ahoi/bild`)).arrayBuffer()), PNG);

  const uebersicht = await (await fetch(basis)).text();
  assert.ok(uebersicht.includes('Café Ahoi'));
});

test('Schreibende Anfragen von fremden Seiten werden abgelehnt', async () => {
  const antwort = await fetch(`${basis}/projekte`, {
    method: 'POST',
    body: new URLSearchParams({ name: 'Eingeschleust' }),
    headers: { Origin: 'https://boese.example' },
    redirect: 'manual',
  });
  assert.equal(antwort.status, 403);
  assert.ok(!(await (await fetch(basis)).text()).includes('Eingeschleust'));
});

test('Unbekannte Adressen und ungültige Prüf-Links liefern 404', async () => {
  assert.equal((await fetch(`${basis}/gibt-es-nicht`)).status, 404);
  assert.equal((await fetch(`${basis}/pruefen/${'x'.repeat(32)}`)).status, 404);
  assert.equal((await fetch(`${basis}/medien/00000000-0000-0000-0000-000000000000`)).status, 404);
});
