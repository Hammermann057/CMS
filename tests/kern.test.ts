import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { erkenneTyp, Fehler, Kern, NichtGefunden, slugAus } from '../src/kern/kern.ts';
import { Verboten } from '../src/kern/rechte.ts';
import { hinweise } from '../src/kern/pruefer.ts';
import { renderAusschnitt } from '../src/renderer/seite.ts';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('bild-eins')]);
const PNG_ANDERS = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('bild-zwei')]);

function aufbau() {
  const kern = new Kern(mkdtempSync(join(tmpdir(), 'kern-')));
  const agentur = kern.agenturAnlegen('Agentur A');
  const leitung = kern.erstePersonAnlegen(agentur.id, 'Lea');
  const mitarbeit = kern.personAnlegen(leitung, { name: 'Mo', rolle: 'mitarbeit' });
  const projekt = kern.projektAnlegen(mitarbeit, { name: 'Tischlerei Müller', kunde: 'Müller' });
  return { kern, agentur, leitung, mitarbeit, projekt };
}

test('Slug: Umlaute werden ausgeschrieben, doppelte Namen bekommen eine Nummer', () => {
  assert.equal(slugAus('Tischlerei Müller & Söhne'), 'tischlerei-mueller-soehne');
  assert.equal(slugAus('!!!'), 'projekt');
  const { kern, mitarbeit, projekt } = aufbau();
  assert.equal(projekt.slug, 'tischlerei-mueller');
  assert.equal(kern.projektAnlegen(mitarbeit, { name: 'Tischlerei Müller', kunde: '' }).slug, 'tischlerei-mueller-2');
});

test('Rechte: Kund:innen sehen nur ihr Projekt und legen keine Projekte an', () => {
  const { kern, leitung, mitarbeit, projekt } = aufbau();
  const anderes = kern.projektAnlegen(mitarbeit, { name: 'Anderes Projekt', kunde: '' });
  const kundin = kern.personAnlegen(leitung, { name: 'Frau Müller', rolle: 'kundin', projektId: projekt.id });

  assert.deepEqual(kern.projekte(kundin).map((p) => p.id), [projekt.id]);
  assert.throws(() => kern.projekt(kundin, anderes.id), Verboten);
  assert.throws(() => kern.projektAnlegen(kundin, { name: 'Eigenes', kunde: '' }), Verboten);
  assert.throws(() => kern.seiteSpeichern(kundin, projekt.id, { ueberschrift: 'Hallo' }), Verboten);
  assert.throws(() => kern.personAnlegen(mitarbeit, { name: 'X', rolle: 'mitarbeit' }), Verboten);
  // Material liefern dürfen Kund:innen.
  assert.equal(kern.mediumHinzufuegen(kundin, projekt.id, { dateiname: 'foto.png', daten: PNG }).ergebnis, 'neu');
});

test('Trennung: Eine fremde Agentur sieht das Projekt nicht einmal als vorhanden', () => {
  const { kern, projekt } = aufbau();
  const fremd = kern.erstePersonAnlegen(kern.agenturAnlegen('Agentur B').id, 'Bo');
  assert.deepEqual(kern.projekte(fremd), []);
  assert.throws(() => kern.projekt(fremd, projekt.id), NichtGefunden);
  assert.throws(() => kern.mediumHinzufuegen(fremd, projekt.id, { dateiname: 'a.png', daten: PNG }), NichtGefunden);
  assert.throws(() => kern.personAnlegen(fremd, { name: 'K', rolle: 'kundin', projektId: projekt.id }), NichtGefunden);
});

test('Medien: neu, unverändert und geändert werden unterschieden', () => {
  const { kern, mitarbeit, projekt } = aufbau();
  const erst = kern.mediumHinzufuegen(mitarbeit, projekt.id, { dateiname: 'C:\\Bilder\\logo.png', daten: PNG });
  assert.equal(erst.ergebnis, 'neu');
  assert.equal(erst.medium.dateiname, 'logo.png');
  assert.equal(erst.medium.zustand, 'neu');
  assert.equal(kern.projekte(mitarbeit)[0].neueMedien, 1);

  assert.equal(kern.mediumHinzufuegen(mitarbeit, projekt.id, { dateiname: 'logo.png', daten: PNG }).ergebnis, 'unveraendert');

  kern.mediumGesehen(mitarbeit, erst.medium.id);
  assert.equal(kern.projekte(mitarbeit)[0].neueMedien, 0);

  const neu = kern.mediumHinzufuegen(mitarbeit, projekt.id, { dateiname: 'logo.png', daten: PNG_ANDERS });
  assert.equal(neu.ergebnis, 'geaendert');
  assert.equal(neu.medium.id, erst.medium.id);
  assert.equal(neu.medium.version, 2);
  assert.equal(neu.medium.zustand, 'geaendert');
  assert.equal(kern.medien(mitarbeit, projekt.id).length, 1);
  assert.deepEqual(kern.mediumDatei(mitarbeit, erst.medium.id).daten, PNG_ANDERS);
});

test('Medien: Der Typ wird am Inhalt erkannt, Unbekanntes und Leeres wird abgelehnt', () => {
  const { kern, mitarbeit, projekt } = aufbau();
  assert.equal(erkenneTyp(Buffer.from('%PDF-1.7 ...')), 'application/pdf');
  assert.equal(erkenneTyp(Buffer.from('<script>alert(1)</script>')), null);
  assert.throws(() => kern.mediumHinzufuegen(mitarbeit, projekt.id, { dateiname: 'bild.png', daten: Buffer.from('<svg/>') }), Fehler);
  assert.throws(() => kern.mediumHinzufuegen(mitarbeit, projekt.id, { dateiname: 'leer.png', daten: Buffer.alloc(0) }), Fehler);
});

test('Freigabe: Online geht nur, was per Prüf-Link freigegeben wurde', () => {
  const { kern, mitarbeit, projekt } = aufbau();
  assert.throws(() => kern.standEinreichen(mitarbeit, projekt.id), Fehler);

  const { medium } = kern.mediumHinzufuegen(mitarbeit, projekt.id, { dateiname: 'werkstatt.png', daten: PNG });
  kern.seiteSpeichern(mitarbeit, projekt.id, { ueberschrift: 'Neue Werkstatt', text: 'Erster Absatz.', bildId: medium.id, bildAlt: 'Werkbank' });
  const stand = kern.standEinreichen(mitarbeit, projekt.id);
  assert.equal(stand.zustand, 'eingereicht');
  assert.equal(kern.veroeffentlicht(projekt.slug), null);
  assert.equal(kern.projekte(mitarbeit)[0].offenerStand, true);

  // Der Entwurf ändert sich nach dem Einreichen, der Stand bleibt wie eingereicht.
  kern.seiteSpeichern(mitarbeit, projekt.id, { ueberschrift: 'Später geändert' });
  assert.throws(() => kern.standEntscheiden(stand.token, { freigeben: true, name: '  ' }), Fehler);
  const entschieden = kern.standEntscheiden(stand.token, { freigeben: true, name: 'Frau Müller' });
  assert.equal(entschieden.zustand, 'freigegeben');
  assert.equal(kern.veroeffentlicht(projekt.slug)?.inhalt.ueberschrift, 'Neue Werkstatt');
  assert.deepEqual(kern.bildVeroeffentlicht(projekt.slug)?.daten, PNG);
  assert.throws(() => kern.standEntscheiden(stand.token, { freigeben: false, name: 'Frau Müller' }), Fehler);
  assert.throws(() => kern.standPerToken('gibt-es-nicht'), NichtGefunden);
});

test('Freigabe: Ein Änderungswunsch veröffentlicht nichts und steht im Verlauf', () => {
  const { kern, mitarbeit, projekt } = aufbau();
  kern.seiteSpeichern(mitarbeit, projekt.id, { ueberschrift: 'Erster Wurf' });
  const erster = kern.standEinreichen(mitarbeit, projekt.id);
  const zweiter = kern.standEinreichen(mitarbeit, projekt.id);
  assert.equal(kern.standPerToken(erster.token).stand.zustand, 'ersetzt');

  kern.standEntscheiden(zweiter.token, { freigeben: false, name: 'Frau Müller', kommentar: 'Bitte anderes Bild' });
  assert.equal(kern.veroeffentlicht(projekt.slug), null);
  assert.equal(kern.letzterStand(mitarbeit, projekt.id)?.kommentar, 'Bitte anderes Bild');
  const verlauf = kern.verlauf(mitarbeit, projekt.id);
  assert.equal(verlauf[0].art, 'stand.abgelehnt');
  assert.match(verlauf[0].personName, /Frau Müller \(per Prüf-Link\)/);
  assert.equal(verlauf.at(-1)?.art, 'projekt.angelegt');
});

test('Seite: Ein Bild aus einem anderen Projekt lässt sich nicht einsetzen', () => {
  const { kern, mitarbeit, projekt } = aufbau();
  const anderes = kern.projektAnlegen(mitarbeit, { name: 'Anderes', kunde: '' });
  const { medium } = kern.mediumHinzufuegen(mitarbeit, anderes.id, { dateiname: 'fremd.png', daten: PNG });
  assert.throws(() => kern.seiteSpeichern(mitarbeit, projekt.id, { ueberschrift: 'X', bildId: medium.id }), Fehler);
});

test('Hinweise nennen Folge und Grund', () => {
  assert.deepEqual(hinweise({ ueberschrift: 'Kurz', text: '', bildId: null, bildAlt: '' }), []);
  const lang = hinweise({ ueberschrift: 'x'.repeat(61), text: '', bildId: 'b', bildAlt: '' });
  assert.deepEqual(lang.map((h) => h.regel), ['Überschrift, Länge', 'Alt-Text']);
  assert.ok(lang.every((h) => h.folge && h.grund));
});

test('Renderer maskiert HTML in Text, Überschrift und Alt-Text', () => {
  const html = renderAusschnitt(
    { ueberschrift: '<script>x</script>', text: 'a < b\nzweite Zeile\n\n"Absatz"', bildId: 'b', bildAlt: '"><img src=x>' },
    '/bild',
  );
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(html.includes('<p>a &lt; b<br>zweite Zeile</p><p>&quot;Absatz&quot;</p>'));
  assert.ok(html.includes('alt="&quot;&gt;&lt;img src=x&gt;"'));
});
