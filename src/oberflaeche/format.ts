import type { Person } from '../kern/typen.ts';

export const ROLLEN_NAME: Record<Person['rolle'], string> = { leitung: 'Leitung', mitarbeit: 'Mitarbeit', kundin: 'Kund:in' };

const zeitFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
export const zeit = (iso: string): string => zeitFormat.format(new Date(iso));

export function groesse(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const anzahl = (n: number, eins: string, mehr: string): string => `${n} ${n === 1 ? eins : mehr}`;
