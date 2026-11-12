// Gemeinsame Typen des Kerns. Jede Zeile in der Datenbank gehört zu genau
// einer Agentur, damit das Werkzeug später mehrere Agenturen trennen kann.

export type Rolle = 'leitung' | 'mitarbeit' | 'kundin';

export interface Agentur {
  id: string;
  name: string;
}

export interface Person {
  id: string;
  agenturId: string;
  name: string;
  rolle: Rolle;
  /** Nur bei Kund:innen gesetzt: das eine Projekt, das sie sehen dürfen. */
  projektId: string | null;
  /** Hierhin geht der Anmelde-Link. Personen aus Etappe 1 haben noch keine. */
  email: string | null;
  /** Ohne Zugang bleibt die Person im Verlauf, kann sich aber nicht mehr anmelden. */
  aktiv: boolean;
}

export interface Projekt {
  id: string;
  agenturId: string;
  name: string;
  kunde: string;
  slug: string;
  angelegtAm: string;
}

export interface ProjektUebersicht extends Projekt {
  neueMedien: number;
  offenerStand: boolean;
  veroeffentlicht: boolean;
}

export type MediumZustand = 'neu' | 'geaendert' | 'gesehen';

export interface Medium {
  id: string;
  agenturId: string;
  projektId: string;
  dateiname: string;
  typ: string;
  groesse: number;
  pruefsumme: string;
  version: number;
  zustand: MediumZustand;
  hochgeladenVon: string;
  hochgeladenAm: string;
}

/** Inhalt der einen Seite, die jedes Projekt in Etappe 1 hat. */
export interface Inhalt {
  ueberschrift: string;
  text: string;
  bildId: string | null;
  bildAlt: string;
}

export type StandZustand = 'eingereicht' | 'freigegeben' | 'abgelehnt' | 'ersetzt';

export interface Stand {
  id: string;
  agenturId: string;
  projektId: string;
  inhalt: Inhalt;
  zustand: StandZustand;
  token: string;
  eingereichtVon: string;
  eingereichtAm: string;
  entschiedenVon: string | null;
  entschiedenAm: string | null;
  kommentar: string | null;
}

export interface Ereignis {
  id: string;
  projektId: string;
  personName: string;
  art: string;
  text: string;
  zeit: string;
}

export interface Hinweis {
  regel: string;
  folge: string;
  grund: string;
}
