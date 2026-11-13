// Farben nachrechnen: Kontrast nach WCAG 2.2 und ein Vorschlag, wenn er nicht reicht.

/** Mindestkontrast für Fließtext (WCAG 2.2, 1.4.3, Stufe AA). */
export const KONTRAST_TEXT = 4.5;
/** Mindestkontrast für Bedienelemente gegen ihre Umgebung (WCAG 2.2, 1.4.11). */
export const KONTRAST_BEDIENELEMENT = 3;

type Rgb = [number, number, number];

export function hexZuRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

export function rgbZuHex(rgb: Rgb): string {
  return `#${rgb.map((k) => Math.round(Math.min(255, Math.max(0, k))).toString(16).padStart(2, '0')).join('')}`;
}

/** Relative Leuchtdichte nach WCAG. */
export function leuchtdichte(hex: string): number {
  const [r, g, b] = hexZuRgb(hex).map((k) => {
    const s = k / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function kontrast(a: string, b: string): number {
  const [hell, dunkel] = [leuchtdichte(a), leuchtdichte(b)].sort((x, y) => y - x);
  return (hell + 0.05) / (dunkel + 0.05);
}

/** Abgerundet, damit nie „4,5 : 1“ dasteht, wo 4,49 gemeint ist. */
export const kontrastText = (wert: number): string => `${(Math.floor(wert * 10) / 10).toFixed(1).replace('.', ',')} : 1`;

function zuHsl([r, g, b]: Rgb): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [h / 6, s, l];
}

function ausHsl(h: number, s: number, l: number): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const kanal = (t: number): number => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [kanal(h + 1 / 3) * 255, kanal(h) * 255, kanal(h - 1 / 3) * 255];
}

/**
 * Die nächstgelegene Farbe im selben Farbton, die gegen `gegen` mindestens `ziel` erreicht.
 * Sie wird so wenig wie nötig heller oder dunkler, damit die Marke erkennbar bleibt.
 */
export function vorschlag(farbe: string, gegen: string, ziel: number): string {
  if (kontrast(farbe, gegen) >= ziel) return farbe;
  const [h, s, l] = zuHsl(hexZuRgb(farbe));
  const dunkler = kontrast('#000000', gegen) >= kontrast('#ffffff', gegen);
  for (let schritt = 1; schritt <= 100; schritt++) {
    const neu = dunkler ? l - schritt / 100 : l + schritt / 100;
    if (neu < 0 || neu > 1) break;
    const kandidat = rgbZuHex(ausHsl(h, s, neu));
    if (kontrast(kandidat, gegen) >= ziel) return kandidat;
  }
  return dunkler ? '#000000' : '#ffffff';
}
