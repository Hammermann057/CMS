import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { emailAus, erkenneTyp, Fehler, Kern, NichtGefunden, slugAus } from '../src/kern/kern.ts';
import { Verboten } from '../src/kern/rechte.ts';
import { hinweise } from '../src/kern/pruefer.ts';
import { renderAusschnitt } from '../src/renderer/seite.ts';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('bild-eins')]);
const PNG_ANDERS = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('bild-zwei')]);

function aufbau() {
  // Eine Uhr, die sich im Test vorstellen lässt.
  const uhr = { jetzt: new Date('2026-11-12T10:00:00Z') };
  const verzeichnis = mkdtempSync(join(tmpdir(), 'kern-'));
  const kern = new Kern(verzeichnis, { uhr: () => uhr.jetzt });
  const agentur = kern.agenturAnlegen('Agentur A');
  const leitung = kern.erstePersonAnlegen(agentur.id, { name: 'Lea', email: 'lea@agentur.test' });
  const mitarbeit = kern.personAnlegen(leitung, { name: 'Mo', email: 'mo@agentur.test', rolle: 'mitarbeit' });
  const projekt = kern.projektAnlegen(mitarbeit, { name: 'Tischlerei Müller', kunde: 'Müller' });
  const vorstellen = (minuten: number): void => {
    uhr.jetzt = new Date(uhr.jetzt.getTime() + minuten * 60 * 1000);
  };
  return { kern, verzeichnis, agentur, leitung, mitarbeit, projekt, vorstellen };
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
  const kundin = kern.personAnlegen(leitung, { name: 'Frau Müller', email: 'mueller@kundin.test', rolle: 'kundin', projektId: projekt.id });

  assert.deepEqual(kern.projekte(kundin).map((p) => p.id), [projekt.id]);
  assert.throws(() => kern.projekt(kundin, anderes.id), Verboten);
  assert.throws(() => kern.projektAnlegen(kundin, { name: 'Eigenes', kunde: '' }), Verboten);
  assert.throws(() => kern.seiteSpeichern(kundin, projekt.id, { ueberschrift: 'Hallo' }), Verboten);
  assert.throws(() => kern.personAnlegen(mitarbeit, { name: 'X', email: 'x@agentur.test', rolle: 'mitarbeit' }), Verboten);
  assert.throws(() => kern.team(kundin), Verboten);
  // Material liefern dürfen Kund:innen.
  assert.equal(kern.mediumHinzufuegen(kundin, projekt.id, { dateiname: 'foto.png', daten: PNG }).ergebnis, 'neu');
});

test('Trennung: Eine fremde Agentur sieht das Projekt nicht einmal als vorhanden', () => {
  const { kern, projekt } = aufbau();
  const fremd = kern.erstePersonAnlegen(kern.agenturAnlegen('Agentur B').id, { name: 'Bo', email: 'bo@andere.test' });
  assert.deepEqual(kern.projekte(fremd), []);
  assert.throws(() => kern.projekt(fremd, projekt.id), NichtGefunden);
  assert.throws(() => kern.mediumHinzufuegen(fremd, projekt.id, { dateiname: 'a.png', daten: PNG }), NichtGefunden);
  assert.throws(() => kern.personAnlegen(fremd, { name: 'K', email: 'k@kundin.test', rolle: 'kundin', projektId: projekt.id }), NichtGefunden);
  assert.deepEqual(kern.team(fremd).map((p) => p.name), ['Bo']);
});

test('Team: Mail-Adressen werden geprüft und sind eindeutig', () => {
  const { kern, leitung, mitarbeit } = aufbau();
  assert.equal(emailAus('  Tim@Agentur.DE '), 'tim@agentur.de');
  assert.equal(emailAus('kein-at-zeichen'), null);
  assert.equal(emailAus('a@b.de\r\nBcc: x@y.de'), null);
  assert.throws(() => kern.personAnlegen(leitung, { name: 'Ohne', email: 'quatsch', rolle: 'mitarbeit' }), Fehler);
  assert.throws(() => kern.personAnlegen(leitung, { name: 'Doppelt', email: 'MO@agentur.test', rolle: 'mitarbeit' }), Fehler);
  assert.deepEqual(kern.team(mitarbeit).map((p) => p.email), ['lea@agentur.test', 'mo@agentur.test']);
});

test('Anmeldung: Ein Link meldet genau einmal an, die Sitzung hält bis zum Abmelden', () => {
  const { kern, verzeichnis, mitarbeit } = aufbau();
  assert.equal(kern.anmeldungAnfordern('unbekannt@agentur.test'), null);
  assert.equal(kern.anmeldungAnfordern('keine adresse'), null);

  const link = kern.anmeldungAnfordern(' MO@agentur.test ');
  assert.ok(link);
  assert.equal(link.person.id, mitarbeit.id);
  assert.equal(kern.anmeldungPruefen(link.token).name, 'Mo');

  const { sitzung } = kern.anmeldungEinloesen(link.token);
  assert.equal(kern.sitzungPerson(sitzung)?.id, mitarbeit.id);
  assert.throws(() => kern.anmeldungEinloesen(link.token), Fehler);
  assert.throws(() => kern.anmeldungPruefen('ausgedacht'), Fehler);

  // In der Datenbank stehen nur Prüfsummen, keine verwendbaren Tokens.
  const db = new DatabaseSync(join(verzeichnis, 'kern.sqlite'));
  const gespeichert = JSON.stringify([db.prepare('SELECT * FROM anmeldung').all(), db.prepare('SELECT * FROM sitzung').all()]);
  db.close();
  assert.ok(!gespeichert.includes(link.token));
  assert.ok(!gespeichert.includes(sitzung));

  kern.abmelden(sitzung);
  assert.equal(kern.sitzungPerson(sitzung), null);
});

test('Anmeldung: Links laufen nach 15 Minuten ab, Sitzungen nach 30 Tagen', () => {
  const { kern, vorstellen } = aufbau();
  const alt = kern.anmeldungAnfordern('mo@agentur.test');
  vorstellen(16);
  assert.throws(() => kern.anmeldungEinloesen(alt?.token ?? ''), Fehler);

  const neu = kern.anmeldungAnfordern('mo@agentur.test');
  vorstellen(14);
  const { sitzung } = kern.anmeldungEinloesen(neu?.token ?? '');
  vorstellen(29 * 24 * 60);
  assert.ok(kern.sitzungPerson(sitzung));
  vorstellen(2 * 24 * 60);
  assert.equal(kern.sitzungPerson(sitzung), null);
});

test('Anmeldung: Nach dem Einlösen verfallen ältere offene Links derselben Person', () => {
  const { kern } = aufbau();
  const erster = kern.anmeldungAnfordern('mo@agentur.test');
  const zweiter = kern.anmeldungAnfordern('mo@agentur.test');
  kern.anmeldungEinloesen(zweiter?.token ?? '');
  assert.throws(() => kern.anmeldungEinloesen(erster?.token ?? ''), Fehler);
});

test('Anmeldung: Höchstens fünf Links pro Stunde und Adresse', () => {
  const { kern, vorstellen } = aufbau();
  for (let i = 0; i < 5; i++) assert.ok(kern.anmeldungAnfordern('mo@agentur.test'));
  assert.equal(kern.anmeldungAnfordern('mo@agentur.test'), null);
  // Andere Personen sind davon nicht betroffen.
  assert.ok(kern.anmeldungAnfordern('lea@agentur.test'));
  vorstellen(61);
  assert.ok(kern.anmeldungAnfordern('mo@agentur.test'));
});

test('Zugang entziehen: Sitzung und Links enden sofort, der Verlauf bleibt', () => {
  const { kern, leitung, mitarbeit, projekt } = aufbau();
  const { sitzung } = kern.anmeldungEinloesen(kern.anmeldungAnfordern('mo@agentur.test')?.token ?? '');
  const offen = kern.anmeldungAnfordern('mo@agentur.test');

  assert.throws(() => kern.zugangEntziehen(mitarbeit, leitung.id), Verboten);
  assert.throws(() => kern.zugangEntziehen(leitung, leitung.id), Fehler);
  const fremd = kern.erstePersonAnlegen(kern.agenturAnlegen('Agentur B').id, { name: 'Bo', email: 'bo@andere.test' });
  assert.throws(() => kern.zugangEntziehen(fremd, mitarbeit.id), NichtGefunden);

  const gesperrt = kern.zugangEntziehen(leitung, mitarbeit.id);
  assert.equal(gesperrt.aktiv, false);
  assert.equal(kern.sitzungPerson(sitzung), null);
  assert.throws(() => kern.anmeldungEinloesen(offen?.token ?? ''), Fehler);
  assert.equal(kern.anmeldungAnfordern('mo@agentur.test'), null);
  // Auch ein noch gehaltenes Personen-Objekt darf nichts mehr.
  assert.throws(() => kern.projekt(gesperrt, projekt.id), Verboten);
  assert.ok(kern.verlauf(leitung, projekt.id).some((e) => e.personName === 'Mo'));

  assert.throws(() => kern.zugangWiedergeben(fremd, mitarbeit.id), NichtGefunden);
  kern.zugangWiedergeben(leitung, mitarbeit.id);
  assert.ok(kern.anmeldungAnfordern('mo@agentur.test'), 'Danach geht die Anmeldung wieder');
});

test('Alte Datenbank aus Etappe 1 bekommt die neuen Spalten', () => {
  const verzeichnis = mkdtempSync(join(tmpdir(), 'alt-'));
  const db = new DatabaseSync(join(verzeichnis, 'kern.sqlite'));
  db.exec(`CREATE TABLE agentur (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE person (id TEXT PRIMARY KEY, agentur_id TEXT NOT NULL REFERENCES agentur(id), name TEXT NOT NULL, rolle TEXT NOT NULL, projekt_id TEXT);
    INSERT INTO agentur VALUES ('a', 'Alt');
    INSERT INTO person VALUES ('p', 'a', 'Leitung', 'leitung', NULL);`);
  db.close();
  const kern = new Kern(verzeichnis);
  const [person] = kern.team({ id: 'x', agenturId: 'a', name: '', rolle: 'leitung', projektId: null, email: null, aktiv: true });
  assert.equal(person.email, null);
  assert.equal(person.aktiv, true);
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
