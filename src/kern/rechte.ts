import type { Person, Rolle } from './typen.ts';

export type Aktion =
  | 'team.ansehen'
  | 'team.verwalten'
  | 'projekt.anlegen'
  | 'projekt.ansehen'
  | 'medium.hochladen'
  | 'seite.aufbau'
  | 'seite.inhalt'
  | 'regelwerk.bearbeiten'
  | 'stand.einreichen';

const ERLAUBT: Record<Rolle, readonly Aktion[]> = {
  leitung: [
    'team.ansehen',
    'team.verwalten',
    'projekt.anlegen',
    'projekt.ansehen',
    'medium.hochladen',
    'seite.aufbau',
    'seite.inhalt',
    'regelwerk.bearbeiten',
    'stand.einreichen',
  ],
  mitarbeit: ['team.ansehen', 'projekt.anlegen', 'projekt.ansehen', 'medium.hochladen', 'seite.aufbau', 'seite.inhalt', 'regelwerk.bearbeiten', 'stand.einreichen'],
  // Kund:innen liefern Material und füllen Bausteine, die die Agentur nicht gesperrt hat.
  // Aufbau und Reihenfolge legt die Agentur fest. Freigeben geht über den Prüf-Link, ohne Konto.
  kundin: ['projekt.ansehen', 'medium.hochladen', 'seite.inhalt'],
};

export class Verboten extends Error {}

/**
 * Prüft Rolle, Agentur und bei Kund:innen das zugewiesene Projekt.
 * Ohne Projekt wird nur die Rolle geprüft.
 */
export function darf(person: Person, aktion: Aktion, projekt?: { id: string; agenturId: string }): boolean {
  if (!person.aktiv || !ERLAUBT[person.rolle].includes(aktion)) return false;
  if (projekt) {
    if (projekt.agenturId !== person.agenturId) return false;
    if (person.rolle === 'kundin' && person.projektId !== projekt.id) return false;
  }
  return true;
}
