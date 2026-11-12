import type { Person, Rolle } from './typen.ts';

export type Aktion =
  | 'person.anlegen'
  | 'projekt.anlegen'
  | 'projekt.ansehen'
  | 'medium.hochladen'
  | 'seite.bearbeiten'
  | 'stand.einreichen';

const ERLAUBT: Record<Rolle, readonly Aktion[]> = {
  leitung: [
    'person.anlegen',
    'projekt.anlegen',
    'projekt.ansehen',
    'medium.hochladen',
    'seite.bearbeiten',
    'stand.einreichen',
  ],
  mitarbeit: ['projekt.anlegen', 'projekt.ansehen', 'medium.hochladen', 'seite.bearbeiten', 'stand.einreichen'],
  // Kund:innen liefern Material und sehen ihr Projekt. Freigeben können sie
  // über den Prüf-Link, dafür brauchen sie kein Konto.
  kundin: ['projekt.ansehen', 'medium.hochladen'],
};

export class Verboten extends Error {}

/**
 * Prüft Rolle, Agentur und bei Kund:innen das zugewiesene Projekt.
 * Ohne Projekt wird nur die Rolle geprüft.
 */
export function darf(person: Person, aktion: Aktion, projekt?: { id: string; agenturId: string }): boolean {
  if (!ERLAUBT[person.rolle].includes(aktion)) return false;
  if (projekt) {
    if (projekt.agenturId !== person.agenturId) return false;
    if (person.rolle === 'kundin' && person.projektId !== projekt.id) return false;
  }
  return true;
}
