import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ausFormular, vergleiche, wendeAktionAn } from '../src/oberflaeche/editor.ts';
import { neuerBaustein } from '../src/kern/bausteine.ts';

test('Das Editor-Formular wird zu Bausteinen, Galerie-Bilder bleiben ihren Beschreibungen zugeordnet', () => {
  const felder = new URLSearchParams();
  felder.append('titel', 'Start');
  felder.append('baustein', 'aaaaaaaa-1');
  felder.append('aaaaaaaa-1.typ', 'kopf');
  felder.append('aaaaaaaa-1.gesperrt', 'ja');
  felder.append('aaaaaaaa-1.ueberschrift', 'Hallo');
  felder.append('baustein', 'bbbbbbbb-2');
  felder.append('bbbbbbbb-2.typ', 'galerie');
  felder.append('bbbbbbbb-2.gesperrt', 'nein');
  felder.append('bbbbbbbb-2.galerie.bild', 'bild-1');
  felder.append('bbbbbbbb-2.galerie.alt', 'Tresen');
  felder.append('bbbbbbbb-2.galerie.bild', 'bild-2');
  felder.append('bbbbbbbb-2.galerie.alt', '');
  felder.append('bbbbbbbb-2.dazu', 'bild-3');
  const { titel, bausteine } = ausFormular(felder);
  assert.equal(titel, 'Start');
  assert.deepEqual(bausteine[0], { id: 'aaaaaaaa-1', typ: 'kopf', gesperrt: true, ueberschrift: 'Hallo' });
  assert.deepEqual(bausteine[1].bilder, [
    { bildId: 'bild-1', bildAlt: 'Tresen' },
    { bildId: 'bild-2', bildAlt: '' },
    { bildId: 'bild-3', bildAlt: '' },
  ]);
});

test('Knöpfe im Editor: verschieben, sperren, entfernen, hinzufügen, Bild aus der Galerie nehmen', () => {
  const a = { id: 'a', typ: 'text' };
  const b = { id: 'b', typ: 'galerie', bilder: [{ bildId: '1' }, { bildId: '2' }] };
  const c = { id: 'c', typ: 'text' };
  const ids = (x: { bausteine: Record<string, unknown>[] }) => x.bausteine.map((y) => y.id);
  assert.deepEqual(ids(wendeAktionAn([a, b, c], 'hoch:b', null)), ['b', 'a', 'c']);
  assert.deepEqual(ids(wendeAktionAn([a, b, c], 'runter:c', null)), ['a', 'b', 'c'], 'Am Rand passiert nichts');
  const weg = wendeAktionAn([a, b, c], 'weg:b', null);
  assert.deepEqual([ids(weg), weg.ziel], [['a', 'c'], 'c']);
  assert.equal(wendeAktionAn([a, b, c], 'sperren:a', null).bausteine[0].gesperrt, true);
  const neu = wendeAktionAn([a], 'neu', 'zitat');
  assert.equal(neu.bausteine[1].typ, 'zitat');
  assert.equal(neu.ziel, neu.bausteine[1].id);
  assert.equal(wendeAktionAn([a], 'neu', 'gibt-es-nicht').bausteine[1].typ, 'text');
  assert.deepEqual(wendeAktionAn([b], 'bildweg:b:0', null).bausteine[0].bilder, [{ bildId: '2' }]);
  assert.deepEqual(ids(wendeAktionAn([a, b], 'speichern', null)), ['a', 'b']);
});

test('Der Prüf-Link vergleicht Seite für Seite mit dem, was online ist', () => {
  const kopf = { ...neuerBaustein('kopf', 'k1'), ueberschrift: 'Willkommen' };
  const start = { id: 's1', slug: 'start', titel: 'Start', bausteine: [kopf] };
  const karte = { id: 's2', slug: 'karte', titel: 'Karte', bausteine: [] };
  const alt = { id: 's3', slug: 'alt', titel: 'Alt', bausteine: [] };
  const online = { seiten: [start, alt, karte] };
  const neu = { seiten: [start, { ...karte, titel: 'Speisekarte' }, { id: 's4', slug: 'kontakt', titel: 'Kontakt', bausteine: [] }] };
  const { seiten, entfallen } = vergleiche(neu, online);
  assert.deepEqual(seiten.map((v) => [v.seite.titel, v.art]), [['Start', 'gleich'], ['Speisekarte', 'geaendert'], ['Kontakt', 'neu']]);
  assert.deepEqual(entfallen.map((s) => s.titel), ['Alt']);
  assert.deepEqual(vergleiche(neu, null).seiten.map((v) => v.art), ['neu', 'neu', 'neu']);
});
