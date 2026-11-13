import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kontrast, kontrastText, vorschlag } from '../src/kern/farbe.ts';
import { alsTokens, ausTokens, bereinigeRegelwerk, STANDARD_REGELWERK, unterschiede } from '../src/kern/regelwerk.ts';
import { hinweiseRegelwerk } from '../src/kern/pruefer.ts';
import { regelwerkCss } from '../src/renderer/seite.ts';
import { Fehler, Kern, NichtGefunden } from '../src/kern/kern.ts';
import { Verboten } from '../src/kern/rechte.ts';

test('Kontrast nach WCAG, abgerundet angezeigt', () => {
  assert.equal(kontrast('#000000', '#ffffff'), 21);
  assert.equal(kontrast('#ffffff', '#ffffff'), 1);
  // #777777 auf Weiß liegt knapp unter 4,5 und darf nicht als 4,5 erscheinen.
  assert.ok(kontrast('#777777', '#ffffff') < 4.5);
  assert.equal(kontrastText(kontrast('#777777', '#ffffff')), '4,4 : 1');
});

test('Vorschlag: gleicher Farbton, so wenig verändert wie nötig, und er reicht wirklich', () => {
  const orange = '#f59e0b';
  const neu = vorschlag(orange, '#ffffff', 4.5);
  assert.ok(kontrast(neu, '#ffffff') >= 4.5);
  assert.notEqual(neu, '#000000');
  // Rot bleibt größer als Blau: Der Farbton kippt nicht.
  const [r, , b] = [1, 3, 5].map((i) => parseInt(neu.slice(i, i + 2), 16));
  assert.ok(r > b);
  assert.equal(vorschlag('#17181a', '#ffffff', 4.5), '#17181a', 'Was reicht, bleibt');
  assert.ok(kontrast(vorschlag('#1e3a8a', '#0b1020', 4.5), '#0b1020') >= 4.5, 'Auf dunklem Grund wird es heller');
});

test('Regelwerk: Eingaben werden geprüft, Zahlen in ihren Bereich gerückt', () => {
  const r = bereinigeRegelwerk({ akzent: 'C2410C', text: '#123', groesseText: '99', radius: '-4', schriftText: 'serif' });
  assert.equal(r.akzent, '#c2410c');
  assert.equal(r.text, '#112233');
  assert.equal(r.groesseText, 24);
  assert.equal(r.radius, 0);
  assert.equal(r.schriftText, 'serif');
  assert.equal(r.hintergrund, STANDARD_REGELWERK.hintergrund, 'Fehlende Werte bleiben');
  assert.throws(() => bereinigeRegelwerk({ text: 'rot' }), Fehler);
  assert.throws(() => bereinigeRegelwerk({ text: '#12345g' }), Fehler);
  assert.throws(() => bereinigeRegelwerk({ schriftText: 'comic' }), Fehler);
  assert.throws(() => bereinigeRegelwerk({ abstand: 'viel' }), Fehler);
  assert.deepEqual(
    unterschiede(STANDARD_REGELWERK, r).map((u) => [u.feld.name, u.vorher, u.nachher]),
    [
      ['Text', '#17181a', '#112233'],
      ['Akzent', '#17181a', '#c2410c'],
      ['Schrift für Text', 'Systemschrift', 'Serifenschrift'],
      ['Textgröße', '18 px', '24 px'],
      ['Ecken', '6 px', '0 px'],
    ],
  );
});

test('Hinweise zum Regelwerk bringen einen Vorschlag mit, der genügt', () => {
  assert.deepEqual(hinweiseRegelwerk(STANDARD_REGELWERK), []);
  const blass = { ...STANDARD_REGELWERK, text: '#999999', akzent: '#fde68a', akzentText: '#ffffff', groesseText: 14 };
  const liste = hinweiseRegelwerk(blass);
  assert.deepEqual(liste.map((h) => h.regel), ['Kontrast Text', 'Knopf vor Hintergrund', 'Kontrast Knopf', 'Textgröße']);
  for (const h of liste) {
    assert.ok(h.folge && h.grund && h.ausweg && h.loesung);
    const korrigiert = bereinigeRegelwerk({ [h.loesung.feld]: h.loesung.wert }, blass);
    assert.ok(!hinweiseRegelwerk(korrigiert).some((x) => x.regel === h.regel), `${h.regel} ist mit dem Vorschlag erledigt`);
  }
});

test('Design-Tokens: Ausgabe im DTCG-Format 2025.10 und zurück', () => {
  const r = { ...STANDARD_REGELWERK, akzent: '#c2410c', schriftUeberschrift: 'antiqua' as const, radius: 0 };
  const tokens = alsTokens(r, 'Café') as Record<string, Record<string, Record<string, unknown>>>;
  assert.equal(tokens.farbe.$type, 'color');
  assert.deepEqual(tokens.farbe.akzent.$value, { colorSpace: 'srgb', components: [0.7608, 0.2549, 0.0471], hex: '#c2410c' });
  assert.equal(tokens.groesse.$type, 'dimension');
  assert.deepEqual(tokens.groesse.text.$value, { value: 18, unit: 'px' });
  assert.deepEqual(tokens.form.radius.$value, { value: 0, unit: 'px' }, 'Auch 0 hat eine Einheit');
  assert.equal(tokens.schrift.$type, 'fontFamily');
  assert.ok(Array.isArray(tokens.schrift.ueberschrift.$value));

  const zurueck = ausTokens(JSON.parse(JSON.stringify(tokens)), STANDARD_REGELWERK);
  assert.deepEqual(zurueck.regelwerk, r);
  assert.equal(zurueck.uebernommen.length, 12);
  assert.deepEqual(zurueck.ignoriert, []);
});

test('Design-Tokens einlesen: nachsichtig bei Schreibweisen, ehrlich bei allem anderen', () => {
  const { regelwerk, uebernommen, ignoriert } = ausTokens(
    {
      farbe: { $type: 'color', akzent: { $value: '#0f766e' }, text: { $value: { colorSpace: 'srgb', components: [0, 0, 0] } }, marke: { $value: '#ff0000' } },
      groesse: { text: { $value: '1.25rem' } },
      schrift: { text: { $value: ['Georgia', 'serif'] }, ueberschrift: { $value: 'Comic Sans MS' } },
      abstand: { bausteine: { $value: 'viel' } },
    },
    STANDARD_REGELWERK,
  );
  assert.equal(regelwerk.akzent, '#0f766e');
  assert.equal(regelwerk.text, '#000000');
  assert.equal(regelwerk.groesseText, 20);
  assert.equal(regelwerk.schriftText, 'serif');
  assert.deepEqual(uebernommen, ['Akzent', 'Text', 'Textgröße', 'Schrift für Text']);
  assert.deepEqual(ignoriert, [
    'farbe.marke: kein passendes Feld im Regelwerk',
    'schrift.ueberschrift: Schrift ist hier nicht hinterlegt',
    'abstand.bausteine: Wert nicht lesbar',
  ]);
  assert.throws(() => ausTokens([1, 2], STANDARD_REGELWERK), Fehler);
});

test('CSS aus dem Regelwerk enthält nur geprüfte Werte', () => {
  const css = regelwerkCss({ ...STANDARD_REGELWERK, schriftText: 'serif', akzent: '#c2410c' }, '.oeffentlich');
  assert.ok(css.startsWith('.oeffentlich{--r-hintergrund:#ffffff;'));
  // Namen in Anführungszeichen, allgemeine Familien wie serif ohne: sonst erkennt der Browser sie nicht.
  assert.ok(css.includes("--r-schrift-text:'Charter', 'Bitstream Charter', 'Sitka Text', 'Cambria', 'Georgia', serif;"));
  assert.ok(css.includes('--r-schrift-ueberschrift:system-ui, -apple-system,'));
  assert.ok(css.includes('--r-akzent:#c2410c;') && css.includes('--r-breite:760px}'));
});

test('Regelwerk im Kern: Agentur ändert, online erst nach Freigabe, Kund:innen nur lesen', () => {
  const kern = new Kern(mkdtempSync(join(tmpdir(), 'regelwerk-')));
  const leitung = kern.erstePersonAnlegen(kern.agenturAnlegen('A').id, { name: 'Lea', email: 'lea@a.test' });
  const projekt = kern.projektAnlegen(leitung, { name: 'Café', kunde: '' });
  const kundin = kern.personAnlegen(leitung, { name: 'K', email: 'k@kundin.test', rolle: 'kundin', projektId: projekt.id });
  assert.deepEqual(kern.regelwerk(kundin, projekt.id), STANDARD_REGELWERK);
  assert.throws(() => kern.regelwerkSpeichern(kundin, projekt.id, { akzent: '#ff0000' }), Verboten);
  const fremd = kern.erstePersonAnlegen(kern.agenturAnlegen('B').id, { name: 'Bo', email: 'bo@b.test' });
  assert.throws(() => kern.regelwerk(fremd, projekt.id), NichtGefunden);

  kern.regelwerkSpeichern(leitung, projekt.id, { akzent: '#c2410c', schriftUeberschrift: 'antiqua' });
  assert.match(kern.verlauf(leitung, projekt.id)[0].text, /Regelwerk geändert: Akzent, Schrift für Überschriften/);
  const anzahlVorher = kern.verlauf(leitung, projekt.id).length;
  kern.regelwerkSpeichern(leitung, projekt.id, { akzent: '#C2410C' });
  assert.equal(kern.verlauf(leitung, projekt.id).length, anzahlVorher, 'Ohne Änderung kein Eintrag');

  kern.seiteAnlegen(leitung, projekt.id, 'Start');
  const stand = kern.standEinreichen(leitung, projekt.id);
  assert.equal(stand.inhalt.regelwerk?.akzent, '#c2410c');
  kern.standEntscheiden(stand.token, { freigeben: true, name: 'K' });
  kern.regelwerkSpeichern(leitung, projekt.id, { akzent: '#0f766e' });
  assert.equal(kern.veroeffentlicht(projekt.slug)?.website.regelwerk?.akzent, '#c2410c', 'Online bleibt die freigegebene Farbe');
});
