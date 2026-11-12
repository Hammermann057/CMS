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

// --- Seiten aus Bausteinen ---------------------------------------------------

export type BausteinTyp = 'kopf' | 'text' | 'zwischenueberschrift' | 'bild' | 'galerie' | 'zitat' | 'knopf';

interface BausteinBasis {
  /** Bleibt über alle Stände gleich, damit sich Bausteine vergleichen und später kommentieren lassen. */
  id: string;
  /** Gesperrte Bausteine ändert nur die Agentur. */
  gesperrt: boolean;
}

export interface KopfBaustein extends BausteinBasis {
  typ: 'kopf';
  ueberschrift: string;
  unterzeile: string;
  bildId: string | null;
  bildAlt: string;
}

export interface TextBaustein extends BausteinBasis {
  typ: 'text';
  text: string;
}

export interface ZwischenueberschriftBaustein extends BausteinBasis {
  typ: 'zwischenueberschrift';
  text: string;
}

export interface BildBaustein extends BausteinBasis {
  typ: 'bild';
  bildId: string | null;
  bildAlt: string;
  unterschrift: string;
}

export interface GalerieBild {
  bildId: string;
  bildAlt: string;
}

export interface GalerieBaustein extends BausteinBasis {
  typ: 'galerie';
  bilder: GalerieBild[];
}

export interface ZitatBaustein extends BausteinBasis {
  typ: 'zitat';
  text: string;
  quelle: string;
}

export interface KnopfBaustein extends BausteinBasis {
  typ: 'knopf';
  beschriftung: string;
  /** https://, http://, mailto:, tel: oder ein Pfad auf derselben Website. */
  ziel: string;
}

export type Baustein =
  | KopfBaustein
  | TextBaustein
  | ZwischenueberschriftBaustein
  | BildBaustein
  | GalerieBaustein
  | ZitatBaustein
  | KnopfBaustein;

/** Eine Seite im Entwurf. */
export interface Seite {
  id: string;
  agenturId: string;
  projektId: string;
  /** Teil der Adresse, etwa `ueber-uns`. */
  slug: string;
  titel: string;
  position: number;
  bausteine: Baustein[];
  geaendertVon: string;
  geaendertAm: string;
}

/** Eine Seite, wie sie in einem Stand eingefroren oder online ist. */
export interface SeitenStand {
  id: string;
  slug: string;
  titel: string;
  bausteine: Baustein[];
}

/** Alle Seiten eines Projekts zu einem Zeitpunkt. Die erste ist die Startseite. */
export interface Website {
  seiten: SeitenStand[];
}

export type StandZustand = 'eingereicht' | 'freigegeben' | 'abgelehnt' | 'ersetzt';

export interface Stand {
  id: string;
  agenturId: string;
  projektId: string;
  zustand: StandZustand;
  inhalt: Website;
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

/** Eine Regel, die sich erklärt: was passiert, warum, und was man tun kann. */
export interface Hinweis {
  regel: string;
  folge: string;
  grund: string;
  ausweg: string;
  /** Der Baustein, an dem der Hinweis hängt. `null` gilt für die ganze Seite. */
  bausteinId: string | null;
}
