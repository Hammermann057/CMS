// Bausteine einer Seite: anlegen, prüfen, vergleichen. Reine Funktionen ohne Datenbank.
import { randomUUID } from 'node:crypto';
import { Fehler } from './fehler.ts';
import type { Baustein, BausteinTyp, GalerieBild } from './typen.ts';

export const BAUSTEIN_NAMEN: Record<BausteinTyp, string> = {
  kopf: 'Kopf',
  text: 'Text',
  zwischenueberschrift: 'Zwischenüberschrift',
  bild: 'Bild',
  galerie: 'Galerie',
  zitat: 'Zitat',
  knopf: 'Knopf',
};

export const BAUSTEIN_TYPEN = Object.keys(BAUSTEIN_NAMEN) as BausteinTyp[];

export const MAX_BAUSTEINE = 100;
export const MAX_GALERIE = 24;

function kurz(text: unknown, max: number): string {
  return String(text ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

export function neuerBaustein(typ: BausteinTyp, id: string = randomUUID()): Baustein {
  const basis = { id, gesperrt: false };
  switch (typ) {
    case 'kopf':
      return { ...basis, typ, ueberschrift: '', unterzeile: '', bildId: null, bildAlt: '' };
    case 'text':
      return { ...basis, typ, text: '' };
    case 'zwischenueberschrift':
      return { ...basis, typ, text: '' };
    case 'bild':
      return { ...basis, typ, bildId: null, bildAlt: '', unterschrift: '' };
    case 'galerie':
      return { ...basis, typ, bilder: [] };
    case 'zitat':
      return { ...basis, typ, text: '', quelle: '' };
    case 'knopf':
      return { ...basis, typ, beschriftung: '', ziel: '' };
  }
}

/**
 * Macht aus einer Eingabe ein sicheres Ziel für einen Knopf, oder wirft einen Fehler.
 * `www.beispiel.de` wird zu `https://www.beispiel.de`, weil Menschen Adressen meist so eintippen.
 */
export function zielAus(eingabe: unknown): string {
  const ziel = kurz(eingabe, 2000);
  if (!ziel) return '';
  if (/^(https?:\/\/|mailto:|tel:)/i.test(ziel)) {
    if (/^https?:\/\//i.test(ziel)) {
      try {
        new URL(ziel);
      } catch {
        throw new Fehler(`„${ziel}“ ist keine gültige Adresse.`);
      }
    }
    // Telefonnummern dürfen Leerzeichen haben, alles andere nicht.
    if (/[<>"]/.test(ziel) || (!/^tel:/i.test(ziel) && /\s/.test(ziel))) throw new Fehler(`„${ziel}“ ist keine gültige Adresse.`);
    return ziel;
  }
  if (/^\/(?!\/)[^\s<>"]*$/.test(ziel) || /^#[\w-]*$/.test(ziel)) return ziel;
  if (/^[\w-]+(\.[\w-]+)+(\/[^\s<>"]*)?$/.test(ziel)) return `https://${ziel}`;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ziel)) return `mailto:${ziel}`;
  throw new Fehler(`Das Ziel „${ziel}“ muss eine Web-Adresse, eine Mail-Adresse oder eine Telefonnummer mit tel: sein.`);
}

/**
 * Prüft einen Baustein aus einer Eingabe und bringt ihn in Form.
 * `bilder` sind die Bilder des Projekts; andere lassen sich nicht einsetzen.
 */
export function bereinige(eingabe: unknown, bilder: ReadonlySet<string>): Baustein {
  const e = (eingabe ?? {}) as Record<string, unknown>;
  const typ = String(e.typ) as BausteinTyp;
  if (!BAUSTEIN_TYPEN.includes(typ)) throw new Fehler('Unbekannter Baustein.');
  const id = String(e.id ?? '');
  if (!/^[0-9a-z-]{8,64}$/.test(id)) throw new Fehler('Baustein ohne gültige Kennung.');
  const bild = (wert: unknown): string | null => {
    const bildId = wert ? String(wert) : null;
    if (bildId && !bilder.has(bildId)) throw new Fehler('Das gewählte Bild gehört nicht zu diesem Projekt.');
    return bildId;
  };
  const b = neuerBaustein(typ, id);
  b.gesperrt = e.gesperrt === true;
  switch (b.typ) {
    case 'kopf':
      b.ueberschrift = kurz(e.ueberschrift, 200);
      b.unterzeile = kurz(e.unterzeile, 400);
      b.bildId = bild(e.bildId);
      b.bildAlt = b.bildId ? kurz(e.bildAlt, 300) : '';
      break;
    case 'text':
      b.text = kurz(e.text, 20_000);
      break;
    case 'zwischenueberschrift':
      b.text = kurz(e.text, 200);
      break;
    case 'bild':
      b.bildId = bild(e.bildId);
      b.bildAlt = b.bildId ? kurz(e.bildAlt, 300) : '';
      b.unterschrift = kurz(e.unterschrift, 400);
      break;
    case 'galerie':
      b.bilder = (Array.isArray(e.bilder) ? e.bilder : [])
        .map((g: Partial<GalerieBild>) => ({ bildId: bild(g?.bildId), bildAlt: kurz(g?.bildAlt, 300) }))
        .filter((g): g is GalerieBild => g.bildId !== null)
        .slice(0, MAX_GALERIE);
      break;
    case 'zitat':
      b.text = kurz(e.text, 2000);
      b.quelle = kurz(e.quelle, 200);
      break;
    case 'knopf':
      b.beschriftung = kurz(e.beschriftung, 80);
      b.ziel = zielAus(e.ziel);
      break;
  }
  return b;
}

/** Leere Bausteine lässt die Website weg, damit keine Lücken entstehen. */
export function istLeer(b: Baustein): boolean {
  switch (b.typ) {
    case 'kopf':
      return !b.ueberschrift && !b.unterzeile && !b.bildId;
    case 'text':
    case 'zwischenueberschrift':
      return !b.text;
    case 'bild':
      return !b.bildId;
    case 'galerie':
      return b.bilder.length === 0;
    case 'zitat':
      return !b.text;
    case 'knopf':
      return !b.beschriftung || !b.ziel;
  }
}

/** Alle Bilder, die in den Bausteinen vorkommen. */
export function bilderIn(bausteine: readonly Baustein[]): string[] {
  const ids: string[] = [];
  for (const b of bausteine) {
    if ((b.typ === 'kopf' || b.typ === 'bild') && b.bildId) ids.push(b.bildId);
    if (b.typ === 'galerie') ids.push(...b.bilder.map((g) => g.bildId));
  }
  return ids;
}

/** Verschiebt ein Element um eine Stelle. Am Rand bleibt alles, wie es ist. */
export function verschiebe<T extends { id: string }>(liste: readonly T[], id: string, richtung: -1 | 1): T[] {
  const neu = [...liste];
  const i = neu.findIndex((x) => x.id === id);
  const j = i + richtung;
  if (i < 0 || j < 0 || j >= neu.length) return neu;
  [neu[i], neu[j]] = [neu[j], neu[i]];
  return neu;
}

export const gleich = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
