import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { emailAus, erkenneTyp, Fehler, Kern, NichtGefunden, slugAus } from '../src/kern/kern.ts';
import { Verboten } from '../src/kern/rechte.ts';
import { hinweiseSeite } from '../src/kern/pruefer.ts';
import { bereinige, neuerBaustein, zielAus } from '../src/kern/bausteine.ts';
import { renderSeitenInhalt, renderWebsite } from '../src/renderer/seite.ts';
import type { Baustein } from '../src/kern/typen.ts';

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
  assert.throws(() => kern.seiteAnlegen(kundin, projekt.id, 'Eigene Seite'), Verboten);
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

/** Baut Bausteine für Tests mit festen Inhalten. */
function baustein<T extends Baustein['typ']>(typ: T, felder: Partial<Extract<Baustein, { typ: T }>> = {}): Baustein {
  return { ...neuerBaustein(typ), ...felder } as Baustein;
}

test('Seiten: Neue Seiten beginnen mit einem Kopf, Adressen sind eindeutig, Reihenfolge lässt sich ändern', () => {
  const { kern, mitarbeit, projekt } = aufbau();
  const start = kern.seiteAnlegen(mitarbeit, projekt.id, 'Startseite');
  const karte = kern.seiteAnlegen(mitarbeit, projekt.id, 'Speisekarte');
  const doppelt = kern.seiteAnlegen(mitarbeit, projekt.id, 'Speisekarte');
  assert.deepEqual([start.slug, karte.slug, doppelt.slug], ['startseite', 'speisekarte', 'speisekarte-2']);
  assert.equal(start.bausteine[0].typ, 'kopf');
  assert.equal(start.bausteine[0].typ === 'kopf' && start.bausteine[0].ueberschrift, 'Startseite');
  assert.throws(() => kern.seiteAnlegen(mitarbeit, projekt.id, '  '), Fehler);

  kern.seiteVerschieben(mitarbeit, karte.id, -1);
  assert.deepEqual(kern.seiten(mitarbeit, projekt.id).map((s) => s.titel), ['Speisekarte', 'Startseite', 'Speisekarte']);
  kern.seiteLoeschen(mitarbeit, doppelt.id);
  assert.equal(kern.seiten(mitarbeit, projekt.id).length, 2);

  // Umbenennen ändert die Adresse, ohne mit anderen Seiten zu kollidieren.
  const umbenannt = kern.seiteSpeichern(mitarbeit, karte.id, { titel: 'Startseite', bausteine: karte.bausteine });
  assert.equal(umbenannt.slug, 'startseite-2');
  assert.deepEqual(kern.verlauf(mitarbeit, projekt.id).slice(0, 2).map((e) => e.art), ['seite.gespeichert', 'seite.geloescht']);
});

test('Bausteine: Eingaben werden geprüft, fremde Bilder und gefährliche Ziele abgelehnt', () => {
  const { kern, mitarbeit, projekt } = aufbau();
  const anderes = kern.projektAnlegen(mitarbeit, { name: 'Anderes', kunde: '' });
  const fremd = kern.mediumHinzufuegen(mitarbeit, anderes.id, { dateiname: 'fremd.png', daten: PNG }).medium;
  const seite = kern.seiteAnlegen(mitarbeit, projekt.id, 'Start');

  assert.throws(() => kern.seiteSpeichern(mitarbeit, seite.id, { bausteine: [baustein('bild', { bildId: fremd.id })] }), Fehler);
  assert.throws(() => kern.seiteSpeichern(mitarbeit, seite.id, { bausteine: [{ id: 'abcdefgh-1', typ: 'video' }] }), Fehler);
  assert.throws(() => kern.seiteSpeichern(mitarbeit, seite.id, { bausteine: [baustein('knopf', { beschriftung: 'X', ziel: 'javascript:alert(1)' })] }), Fehler);
  const doppelt = baustein('text', { text: 'a' });
  assert.throws(() => kern.seiteSpeichern(mitarbeit, seite.id, { bausteine: [doppelt, doppelt] }), Fehler);

  assert.equal(zielAus('www.cafe-ahoi.de/karte'), 'https://www.cafe-ahoi.de/karte');
  assert.equal(zielAus('hallo@cafe-ahoi.de'), 'mailto:hallo@cafe-ahoi.de');
  assert.equal(zielAus('tel:+49 40 123'), 'tel:+49 40 123');
  assert.equal(zielAus('/speisekarte'), '/speisekarte');
  assert.throws(() => zielAus('//boese.example'), Fehler);
  assert.throws(() => zielAus('https://x.de/"><script>'), Fehler);

  // Ohne Bild gibt es keine Bildbeschreibung, und überlange Eingaben werden gekürzt.
  const b = bereinige({ ...baustein('kopf'), ueberschrift: 'x'.repeat(500), bildAlt: 'verwaist' }, new Set());
  assert.ok(b.typ === 'kopf' && b.ueberschrift.length === 200 && b.bildAlt === '');
});

test('Kund:innen füllen freigegebene Bausteine, Aufbau und gesperrte Bausteine bleiben bei der Agentur', () => {
  const { kern, leitung, mitarbeit, projekt } = aufbau();
  const kundin = kern.personAnlegen(leitung, { name: 'Frau Müller', email: 'mueller@kundin.test', rolle: 'kundin', projektId: projekt.id });
  const seite = kern.seiteAnlegen(mitarbeit, projekt.id, 'Start');
  const kopf = { ...seite.bausteine[0], gesperrt: true };
  const text = baustein('text', { text: 'Platzhalter' });
  kern.seiteSpeichern(mitarbeit, seite.id, { bausteine: [kopf, text] });

  const versuch = kern.seiteSpeichern(kundin, seite.id, {
    titel: 'Umbenannt',
    bausteine: [
      { ...text, text: 'Unser Café öffnet um 8 Uhr.', gesperrt: true },
      { ...kopf, ueberschrift: 'Gekapert', gesperrt: false },
      baustein('knopf', { beschriftung: 'Eingeschmuggelt', ziel: 'https://x.de' }),
    ],
  });
  assert.equal(versuch.titel, 'Start', 'Titel bleibt');
  assert.deepEqual(versuch.bausteine.map((b) => b.id), [kopf.id, text.id], 'Reihenfolge bleibt, nichts kommt dazu');
  assert.equal(versuch.bausteine[0].typ === 'kopf' && versuch.bausteine[0].ueberschrift, 'Start', 'Gesperrter Kopf bleibt');
  assert.equal(versuch.bausteine[1].typ === 'text' && versuch.bausteine[1].text, 'Unser Café öffnet um 8 Uhr.', 'Freier Text ist geändert');
  assert.equal(versuch.bausteine[1].gesperrt, false, 'Sperren kann nur die Agentur');
  assert.throws(() => kern.seiteVerschieben(kundin, seite.id, 1), Verboten);
  assert.throws(() => kern.seiteLoeschen(kundin, seite.id), Verboten);
  assert.throws(() => kern.standEinreichen(kundin, projekt.id), Verboten);

  const fremd = kern.erstePersonAnlegen(kern.agenturAnlegen('Agentur B').id, { name: 'Bo', email: 'bo@andere.test' });
  assert.throws(() => kern.seite(fremd, seite.id), NichtGefunden);
  assert.throws(() => kern.seiteSpeichern(fremd, seite.id, { bausteine: [] }), NichtGefunden);
});

test('Freigabe: Online geht die ganze Website, wie sie eingereicht wurde', () => {
  const { kern, mitarbeit, projekt } = aufbau();
  assert.throws(() => kern.standEinreichen(mitarbeit, projekt.id), Fehler);

  const { medium } = kern.mediumHinzufuegen(mitarbeit, projekt.id, { dateiname: 'werkstatt.png', daten: PNG });
  const anderesBild = kern.mediumHinzufuegen(mitarbeit, projekt.id, { dateiname: 'privat.png', daten: PNG_ANDERS }).medium;
  const start = kern.seiteAnlegen(mitarbeit, projekt.id, 'Start');
  kern.seiteSpeichern(mitarbeit, start.id, {
    bausteine: [{ ...start.bausteine[0], ueberschrift: 'Neue Werkstatt', bildId: medium.id, bildAlt: 'Werkbank' }, baustein('text', { text: 'Erster Absatz.' })],
  });
  kern.seiteAnlegen(mitarbeit, projekt.id, 'Kontakt');
  const stand = kern.standEinreichen(mitarbeit, projekt.id);
  assert.deepEqual(stand.inhalt.seiten.map((s) => s.titel), ['Start', 'Kontakt']);
  assert.equal(kern.veroeffentlicht(projekt.slug), null);
  assert.equal(kern.projekte(mitarbeit)[0].offenerStand, true);
  assert.deepEqual(kern.bildZumStand(stand.token, medium.id)?.daten, PNG);
  assert.equal(kern.bildZumStand(stand.token, anderesBild.id), null, 'Nur Bilder aus dem Stand sind über den Link sichtbar');

  // Der Entwurf ändert sich nach dem Einreichen, der Stand bleibt wie eingereicht.
  kern.seiteSpeichern(mitarbeit, start.id, { bausteine: [baustein('text', { text: 'Später geändert' })] });
  assert.throws(() => kern.standEntscheiden(stand.token, { freigeben: true, name: '  ' }), Fehler);
  assert.equal(kern.standEntscheiden(stand.token, { freigeben: true, name: 'Frau Müller' }).zustand, 'freigegeben');

  const online = kern.veroeffentlicht(projekt.slug);
  assert.equal(online?.website.seiten.length, 2);
  const kopf = online?.website.seiten[0].bausteine[0];
  assert.equal(kopf?.typ === 'kopf' && kopf.ueberschrift, 'Neue Werkstatt');
  assert.deepEqual(kern.bildVeroeffentlicht(projekt.slug, medium.id)?.daten, PNG);
  assert.equal(kern.bildVeroeffentlicht(projekt.slug, anderesBild.id), null, 'Unveröffentlichte Bilder bleiben privat');
  assert.equal(kern.projekte(mitarbeit)[0].veroeffentlicht, true);
  assert.throws(() => kern.standEntscheiden(stand.token, { freigeben: false, name: 'Frau Müller' }), Fehler);
  assert.throws(() => kern.standPerToken('gibt-es-nicht'), NichtGefunden);

  // Eine gelöschte Seite bleibt online, bis der nächste Stand freigegeben ist.
  kern.seiteLoeschen(mitarbeit, start.id);
  assert.equal(kern.veroeffentlicht(projekt.slug)?.website.seiten.length, 2);
});

test('Freigabe: Ein Änderungswunsch veröffentlicht nichts und steht im Verlauf', () => {
  const { kern, mitarbeit, projekt } = aufbau();
  kern.seiteAnlegen(mitarbeit, projekt.id, 'Erster Wurf');
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

test('Übernahme: Seite, Veröffentlichung und Stände aus Etappe 1 werden zu Bausteinen', () => {
  const verzeichnis = mkdtempSync(join(tmpdir(), 'etappe1-'));
  const alt = new Kern(verzeichnis);
  const agentur = alt.agenturAnlegen('Alt');
  const leitung = alt.erstePersonAnlegen(agentur.id, { name: 'Lea', email: 'lea@alt.test' });
  const projekt = alt.projektAnlegen(leitung, { name: 'Café', kunde: '' });
  alt.schliessen();

  // So lagen die Daten in Etappe 1.
  const db = new DatabaseSync(join(verzeichnis, 'kern.sqlite'));
  const inhalt = JSON.stringify({ ueberschrift: 'Kaffee am Hafen', text: 'Ab 8 Uhr.', bildId: null, bildAlt: '' });
  db.exec('DROP TABLE seite; DROP TABLE veroeffentlichung;');
  db.exec(`CREATE TABLE seite (projekt_id TEXT PRIMARY KEY REFERENCES projekt(id), agentur_id TEXT NOT NULL, entwurf TEXT NOT NULL, veroeffentlicht TEXT, geaendert_am TEXT NOT NULL)`);
  db.prepare('INSERT INTO seite VALUES (?, ?, ?, ?, ?)').run(projekt.id, agentur.id, inhalt, inhalt, '2026-11-12T10:00:00.000Z');
  db.prepare(`INSERT INTO stand (id, agentur_id, projekt_id, inhalt, zustand, token, eingereicht_von, eingereicht_am, entschieden_von, entschieden_am)
    VALUES ('s1', ?, ?, ?, 'freigegeben', 'token-aus-etappe-eins-123', 'Lea', '2026-11-12T09:00:00.000Z', 'Kundin', '2026-11-12T10:00:00.000Z')`).run(agentur.id, projekt.id, inhalt);
  db.close();

  const kern = new Kern(verzeichnis);
  const [seite] = kern.seiten(leitung, projekt.id);
  assert.equal(seite.titel, 'Startseite');
  assert.deepEqual(seite.bausteine.map((b) => b.typ), ['kopf', 'text']);
  const online = kern.veroeffentlicht(projekt.slug)?.website.seiten[0].bausteine[0];
  assert.equal(online?.typ === 'kopf' && online.ueberschrift, 'Kaffee am Hafen');
  const stand = kern.standPerToken('token-aus-etappe-eins-123').stand;
  assert.equal(stand.inhalt.seiten[0].bausteine[1].typ === 'text' && stand.inhalt.seiten[0].bausteine[1].text, 'Ab 8 Uhr.');
  kern.schliessen();
  // Ein zweiter Start ändert nichts mehr.
  assert.equal(new Kern(verzeichnis).seiten(leitung, projekt.id).length, 1);
});

test('Hinweise nennen Folge, Grund und Ausweg und hängen am Baustein', () => {
  const kopf = baustein('kopf', { ueberschrift: 'x'.repeat(61), bildId: 'b1' });
  const galerie = baustein('galerie', { bilder: [{ bildId: 'b2', bildAlt: 'Tresen' }, { bildId: 'b3', bildAlt: '' }] });
  const knopf = baustein('knopf', { beschriftung: 'Hier klicken', ziel: 'https://x.de' });
  const leer = baustein('text');
  const zweiterKopf = baustein('kopf', { ueberschrift: 'Noch ein Titel' });
  const liste = hinweiseSeite({ titel: 'Start', bausteine: [kopf, galerie, knopf, leer, zweiterKopf, baustein('text', { text: 'x'.repeat(1300) }), baustein('zitat', { text: 'Toll!' })] });
  assert.deepEqual(liste.map((h) => h.regel), [
    'Länge der Überschrift',
    'Bildbeschreibung',
    'Bildbeschreibung',
    'Knopf nennt das Ziel',
    'Leerer Baustein',
    'Eine Hauptüberschrift',
    'Langer Text',
    'Quelle beim Zitat',
  ]);
  assert.ok(liste.every((h) => h.folge && h.grund && h.ausweg));
  assert.equal(liste[2].bausteinId, galerie.id);
  assert.match(liste[2].folge, /1 von 2 Bildern/);

  const ohneKopf = hinweiseSeite({ titel: 'Leer', bausteine: [baustein('text', { text: 'Hallo' })] });
  assert.deepEqual(ohneKopf.map((h) => [h.regel, h.bausteinId]), [['Hauptüberschrift', null]]);
  const kopfUnten = baustein('kopf', { ueberschrift: 'Titel' });
  assert.deepEqual(hinweiseSeite({ titel: 'X', bausteine: [baustein('text', { text: 'a' }), kopfUnten] }).map((h) => h.regel), ['Kopf oben']);
});

test('Renderer maskiert alle Eingaben, lässt Leeres weg und baut keine gefährlichen Links', () => {
  const html = renderSeitenInhalt(
    {
      bausteine: [
        baustein('kopf', { ueberschrift: '<script>x</script>', bildId: 'b1', bildAlt: '"><img src=x>' }),
        baustein('text', { text: 'a < b\nzweite Zeile\n\n"Absatz"' }),
        baustein('zwischenueberschrift'),
        baustein('knopf', { beschriftung: 'Böse', ziel: 'javascript:alert(1)' }),
        baustein('zitat', { text: 'Bester Kaffee', quelle: 'Anna <K>' }),
      ],
    },
    (id) => `/bilder/${id}`,
  );
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('<h1>&lt;script&gt;x&lt;/script&gt;</h1>'));
  assert.ok(html.includes('<p>a &lt; b<br>zweite Zeile</p><p>&quot;Absatz&quot;</p>'));
  assert.ok(html.includes('alt="&quot;&gt;&lt;img src=x&gt;"'));
  assert.ok(!html.includes('<h2'), 'Leere Zwischenüberschrift fehlt');
  assert.ok(!html.includes('javascript:'), 'Gefährlicher Knopf fehlt');
  assert.ok(html.includes('<figcaption>Anna &lt;K&gt;</figcaption>'));

  const website = {
    seiten: [
      { id: 's1', slug: 'start', titel: 'Start', bausteine: [baustein('kopf', { ueberschrift: 'Willkommen' })] },
      { id: 's2', slug: 'karte', titel: 'Karte & Preise', bausteine: [baustein('kopf', { ueberschrift: 'Unsere Karte' })] },
    ],
  };
  const seite2 = renderWebsite(website, website.seiten[1], { projektName: 'Café', bildUrl: (id) => id, seitenUrl: (s, i) => (i === 0 ? '/' : `/${s.slug}`) });
  assert.ok(seite2.includes('<title>Unsere Karte · Café</title>'));
  assert.ok(seite2.includes('<a href="/karte" aria-current="page">Karte &amp; Preise</a>'));
  assert.ok(renderWebsite(website, website.seiten[0], { projektName: 'Café', bildUrl: (id) => id, seitenUrl: () => '/' }).includes('<title>Café</title>'));
});
