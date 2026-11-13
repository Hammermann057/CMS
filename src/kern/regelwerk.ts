// Das Regelwerk einer Website: Farben, Schriften, Maße. Reine Funktionen ohne Datenbank.
// Ausgabe und Einlesen im Format der W3C Design Tokens Community Group, Fassung 2025.10.
import { Fehler } from './fehler.ts';
import type { Regelwerk, SchriftId } from './typen.ts';

/**
 * Nur Schriften, die schon auf den Geräten liegen. Webfonts von fremden Servern würden
 * die Adressen der Besucher:innen weitergeben. Eigene Schriftdateien kommen später.
 */
export const SCHRIFTEN: Record<SchriftId, { name: string; stapel: string[] }> = {
  system: { name: 'Systemschrift', stapel: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
  grotesk: { name: 'Grotesk', stapel: ['Helvetica Neue', 'Helvetica', 'Arial', 'Nimbus Sans', 'sans-serif'] },
  humanistisch: { name: 'Humanistisch', stapel: ['Seravek', 'Gill Sans Nova', 'Ubuntu', 'Calibri', 'DejaVu Sans', 'sans-serif'] },
  serif: { name: 'Serifenschrift', stapel: ['Charter', 'Bitstream Charter', 'Sitka Text', 'Cambria', 'Georgia', 'serif'] },
  antiqua: { name: 'Klassische Antiqua', stapel: ['Iowan Old Style', 'Palatino Linotype', 'URW Palladio L', 'P052', 'serif'] },
  mono: { name: 'Monospace', stapel: ['ui-monospace', 'Cascadia Code', 'Source Code Pro', 'Menlo', 'Consolas', 'monospace'] },
};

export const SCHRIFT_IDS = Object.keys(SCHRIFTEN) as SchriftId[];

/** Für CSS: Namen mit Leerzeichen in Anführungszeichen, allgemeine Familien ohne. */
export const schriftCss = (id: SchriftId): string =>
  SCHRIFTEN[id].stapel.map((name) => (/^[a-z-]+$/.test(name) ? name : `'${name}'`)).join(', ');

export const STANDARD_REGELWERK: Regelwerk = {
  hintergrund: '#ffffff',
  text: '#17181a',
  leise: '#55585f',
  akzent: '#17181a',
  akzentText: '#ffffff',
  schriftText: 'system',
  schriftUeberschrift: 'system',
  groesseText: 18,
  groesseUeberschrift: 48,
  radius: 6,
  abstand: 24,
  breite: 760,
};

type Art = 'farbe' | 'schrift' | 'px';

export interface Feld {
  schluessel: keyof Regelwerk;
  name: string;
  art: Art;
  /** Pfad im Design-Token-Format. */
  token: string;
  hilfe?: string;
  min?: number;
  max?: number;
}

export const FELDER: Feld[] = [
  { schluessel: 'hintergrund', name: 'Hintergrund', art: 'farbe', token: 'farbe.hintergrund' },
  { schluessel: 'text', name: 'Text', art: 'farbe', token: 'farbe.text' },
  { schluessel: 'leise', name: 'Leiser Text', art: 'farbe', token: 'farbe.leise', hilfe: 'Unterzeilen, Bildunterschriften, Quellen' },
  { schluessel: 'akzent', name: 'Akzent', art: 'farbe', token: 'farbe.akzent', hilfe: 'Knöpfe und die Linie am Zitat' },
  { schluessel: 'akzentText', name: 'Text auf Akzent', art: 'farbe', token: 'farbe.akzent-text', hilfe: 'Beschriftung der Knöpfe' },
  { schluessel: 'schriftText', name: 'Schrift für Text', art: 'schrift', token: 'schrift.text' },
  { schluessel: 'schriftUeberschrift', name: 'Schrift für Überschriften', art: 'schrift', token: 'schrift.ueberschrift' },
  { schluessel: 'groesseText', name: 'Textgröße', art: 'px', token: 'groesse.text', min: 14, max: 24 },
  { schluessel: 'groesseUeberschrift', name: 'Hauptüberschrift, größte Stufe', art: 'px', token: 'groesse.ueberschrift', min: 28, max: 96, hilfe: 'Auf dem Handy wird sie kleiner.' },
  { schluessel: 'radius', name: 'Ecken', art: 'px', token: 'form.radius', min: 0, max: 32, hilfe: '0 für eckig' },
  { schluessel: 'abstand', name: 'Abstand zwischen Bausteinen', art: 'px', token: 'abstand.bausteine', min: 8, max: 96 },
  { schluessel: 'breite', name: 'Breite des Inhalts', art: 'px', token: 'breite.inhalt', min: 480, max: 1200 },
];

export function farbeAus(eingabe: unknown, name: string): string {
  const roh = String(eingabe ?? '').trim().toLowerCase();
  const kurz = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(roh);
  if (kurz) return `#${kurz[1]}${kurz[1]}${kurz[2]}${kurz[2]}${kurz[3]}${kurz[3]}`;
  const lang = /^#?([0-9a-f]{6})$/.exec(roh);
  if (!lang) throw new Fehler(`${name}: „${String(eingabe ?? '')}“ ist keine Farbe im Format #rrggbb.`);
  return `#${lang[1]}`;
}

/** Prüft ein Regelwerk aus einer Eingabe. Fehlende Werte kommen aus `basis`, Zahlen werden in ihren Bereich gerückt. */
export function bereinigeRegelwerk(eingabe: unknown, basis: Regelwerk = STANDARD_REGELWERK): Regelwerk {
  const e = (eingabe ?? {}) as Record<string, unknown>;
  const neu: Record<string, unknown> = { ...basis };
  for (const feld of FELDER) {
    const wert = e[feld.schluessel];
    if (wert === undefined || wert === null || wert === '') continue;
    if (feld.art === 'farbe') neu[feld.schluessel] = farbeAus(wert, feld.name);
    if (feld.art === 'schrift') {
      if (!SCHRIFT_IDS.includes(String(wert) as SchriftId)) throw new Fehler(`${feld.name}: Diese Schrift gibt es nicht.`);
      neu[feld.schluessel] = String(wert);
    }
    if (feld.art === 'px') {
      const zahl = Math.round(Number(String(wert).replace(',', '.')));
      if (!Number.isFinite(zahl)) throw new Fehler(`${feld.name}: „${String(wert)}“ ist keine Zahl.`);
      neu[feld.schluessel] = Math.min(feld.max ?? zahl, Math.max(feld.min ?? zahl, zahl));
    }
  }
  return neu as unknown as Regelwerk;
}

export function wertText(feld: Feld, r: Regelwerk): string {
  const wert = r[feld.schluessel];
  if (feld.art === 'schrift') return SCHRIFTEN[wert as SchriftId].name;
  if (feld.art === 'px') return `${wert} px`;
  return String(wert);
}

/** Was sich zwischen zwei Regelwerken unterscheidet, lesbar für den Prüf-Link und den Verlauf. */
export function unterschiede(alt: Regelwerk, neu: Regelwerk): { feld: Feld; vorher: string; nachher: string }[] {
  return FELDER.filter((f) => alt[f.schluessel] !== neu[f.schluessel]).map((feld) => ({
    feld,
    vorher: wertText(feld, alt),
    nachher: wertText(feld, neu),
  }));
}

// --- Design-Tokens ------------------------------------------------------------

const TYPEN: Record<Art, string> = { farbe: 'color', schrift: 'fontFamily', px: 'dimension' };

/** Das Regelwerk als Design-Tokens (W3C DTCG, Fassung 2025.10). */
export function alsTokens(r: Regelwerk, projektName: string): Record<string, unknown> {
  const wurzel: Record<string, Record<string, unknown>> = {};
  for (const feld of FELDER) {
    const [gruppe, name] = feld.token.split('.');
    wurzel[gruppe] ??= { $type: TYPEN[feld.art] };
    const wert = r[feld.schluessel];
    let $value: unknown;
    if (feld.art === 'farbe') {
      const hex = String(wert);
      $value = { colorSpace: 'srgb', components: [1, 3, 5].map((i) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 10000) / 10000), hex };
    } else if (feld.art === 'schrift') {
      $value = SCHRIFTEN[wert as SchriftId].stapel;
    } else {
      $value = { value: wert, unit: 'px' };
    }
    wurzel[gruppe][name] = { $value, $description: feld.hilfe ? `${feld.name}: ${feld.hilfe}` : feld.name };
  }
  return { $description: `Regelwerk der Website ${projektName}, aus dem Agenturtool`, ...wurzel };
}

function farbeAusToken(wert: unknown): string | null {
  if (typeof wert === 'string') return farbeAus(wert, 'Farbe');
  const w = wert as { hex?: unknown; colorSpace?: unknown; components?: unknown };
  if (w && typeof w.hex === 'string') return farbeAus(w.hex, 'Farbe');
  if (w && w.colorSpace === 'srgb' && Array.isArray(w.components) && w.components.length === 3) {
    return `#${w.components.map((k) => Math.round(Math.min(1, Math.max(0, Number(k))) * 255).toString(16).padStart(2, '0')).join('')}`;
  }
  return null;
}

function pixelAusToken(wert: unknown): number | null {
  if (typeof wert === 'number') return wert;
  if (typeof wert === 'string') {
    const t = /^(-?[\d.]+)(px|rem)?$/.exec(wert.trim());
    return t ? Number(t[1]) * (t[2] === 'rem' ? 16 : 1) : null;
  }
  const w = wert as { value?: unknown; unit?: unknown };
  if (w && typeof w.value === 'number' && (w.unit === 'px' || w.unit === 'rem')) return w.value * (w.unit === 'rem' ? 16 : 1);
  return null;
}

function schriftAusToken(wert: unknown): SchriftId | null {
  const namen = (Array.isArray(wert) ? wert : [wert]).map((n) => String(n).toLowerCase());
  return SCHRIFT_IDS.find((id) => SCHRIFTEN[id].stapel.some((n) => n.toLowerCase() === namen[0])) ?? null;
}

/**
 * Liest Design-Tokens ein. Übernommen wird, was zu einem Feld passt; alles andere wird mit Grund genannt,
 * damit nichts stillschweigend verschwindet.
 */
export function ausTokens(json: unknown, basis: Regelwerk): { regelwerk: Regelwerk; uebernommen: string[]; ignoriert: string[] } {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Fehler('Das ist keine Token-Datei: Erwartet wird ein JSON-Objekt.');
  const tokens = new Map<string, unknown>();
  const sammle = (knoten: Record<string, unknown>, pfad: string[]): void => {
    if ('$value' in knoten) {
      tokens.set(pfad.join('.'), knoten.$value);
      return;
    }
    for (const [schluessel, kind] of Object.entries(knoten)) {
      if (!schluessel.startsWith('$') && kind && typeof kind === 'object' && !Array.isArray(kind)) sammle(kind as Record<string, unknown>, [...pfad, schluessel]);
    }
  };
  sammle(json as Record<string, unknown>, []);

  const neu: Record<string, unknown> = { ...basis };
  const uebernommen: string[] = [];
  const ignoriert: string[] = [];
  for (const [pfad, wert] of tokens) {
    const feld = FELDER.find((f) => f.token === pfad);
    if (!feld) {
      ignoriert.push(`${pfad}: kein passendes Feld im Regelwerk`);
      continue;
    }
    try {
      const gelesen = feld.art === 'farbe' ? farbeAusToken(wert) : feld.art === 'px' ? pixelAusToken(wert) : schriftAusToken(wert);
      if (gelesen === null) {
        ignoriert.push(feld.art === 'schrift' ? `${pfad}: Schrift ist hier nicht hinterlegt` : `${pfad}: Wert nicht lesbar`);
        continue;
      }
      neu[feld.schluessel] = gelesen;
      uebernommen.push(feld.name);
    } catch {
      ignoriert.push(`${pfad}: Wert nicht lesbar`);
    }
  }
  return { regelwerk: bereinigeRegelwerk(neu, basis), uebernommen, ignoriert };
}
