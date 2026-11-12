import type { Hinweis, Inhalt } from './typen.ts';

export const MAX_UEBERSCHRIFT = 60;

/**
 * Platzhalter für das Regelwerk aus Etappe 3. Jeder Hinweis nennt die Folge
 * und den Grund, damit die Regel sich erklärt statt nur zu sperren.
 */
export function hinweise(inhalt: Inhalt): Hinweis[] {
  const liste: Hinweis[] = [];
  const titel = inhalt.ueberschrift.trim();
  if (!titel) {
    liste.push({
      regel: 'Überschrift vorhanden',
      folge: 'Die Seite hat keinen Titel.',
      grund: 'Suchmaschinen und Screenreader brauchen eine Überschrift, um die Seite einzuordnen.',
    });
  } else if (titel.length > MAX_UEBERSCHRIFT) {
    liste.push({
      regel: 'Überschrift, Länge',
      folge: `Die Überschrift hat ${titel.length} Zeichen und läuft auf schmalen Bildschirmen voraussichtlich über mehr als zwei Zeilen.`,
      grund: `Titel bleiben unter ${MAX_UEBERSCHRIFT} Zeichen, damit das Bild darunter sichtbar bleibt.`,
    });
  }
  if (inhalt.bildId && !inhalt.bildAlt.trim()) {
    liste.push({
      regel: 'Alt-Text',
      folge: 'Menschen mit Screenreader erfahren nicht, was das Bild zeigt.',
      grund: 'Jedes inhaltliche Bild braucht eine kurze Beschreibung.',
    });
  }
  return liste;
}
