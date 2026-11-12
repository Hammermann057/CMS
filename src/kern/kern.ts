import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { darf, Verboten } from './rechte.ts';
import type { Aktion } from './rechte.ts';
import type {
  Agentur,
  Ereignis,
  Inhalt,
  Medium,
  Person,
  Projekt,
  ProjektUebersicht,
  Rolle,
  Stand,
} from './typen.ts';

/** Fehler, dessen Text der Person gezeigt werden darf. */
export class Fehler extends Error {}
export class NichtGefunden extends Error {}

export const MAX_GROESSE = 25 * 1024 * 1024;
export const LEERER_INHALT: Inhalt = { ueberschrift: '', text: '', bildId: null, bildAlt: '' };

const ENDUNG: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agentur (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS person (
  id TEXT PRIMARY KEY, agentur_id TEXT NOT NULL REFERENCES agentur(id),
  name TEXT NOT NULL, rolle TEXT NOT NULL, projekt_id TEXT,
  email TEXT, aktiv INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS projekt (
  id TEXT PRIMARY KEY, agentur_id TEXT NOT NULL REFERENCES agentur(id),
  name TEXT NOT NULL, kunde TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, angelegt_am TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS medium (
  id TEXT PRIMARY KEY, agentur_id TEXT NOT NULL, projekt_id TEXT NOT NULL REFERENCES projekt(id),
  dateiname TEXT NOT NULL, datei TEXT NOT NULL, typ TEXT NOT NULL, groesse INTEGER NOT NULL,
  pruefsumme TEXT NOT NULL, version INTEGER NOT NULL, zustand TEXT NOT NULL,
  hochgeladen_von TEXT NOT NULL, hochgeladen_am TEXT NOT NULL,
  UNIQUE (projekt_id, dateiname)
);
CREATE TABLE IF NOT EXISTS seite (
  projekt_id TEXT PRIMARY KEY REFERENCES projekt(id), agentur_id TEXT NOT NULL,
  entwurf TEXT NOT NULL, veroeffentlicht TEXT, geaendert_am TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stand (
  id TEXT PRIMARY KEY, agentur_id TEXT NOT NULL, projekt_id TEXT NOT NULL REFERENCES projekt(id),
  inhalt TEXT NOT NULL, zustand TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
  eingereicht_von TEXT NOT NULL, eingereicht_am TEXT NOT NULL,
  entschieden_von TEXT, entschieden_am TEXT, kommentar TEXT
);
CREATE TABLE IF NOT EXISTS ereignis (
  id TEXT PRIMARY KEY, agentur_id TEXT NOT NULL, projekt_id TEXT NOT NULL,
  person_name TEXT NOT NULL, art TEXT NOT NULL, text TEXT NOT NULL, zeit TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ereignis_projekt ON ereignis (projekt_id, zeit);
CREATE TABLE IF NOT EXISTS anmeldung (
  token_hash TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person(id),
  angefordert_am TEXT NOT NULL, gueltig_bis TEXT NOT NULL, eingeloest_am TEXT
);
CREATE INDEX IF NOT EXISTS anmeldung_person ON anmeldung (person_id, angefordert_am);
CREATE TABLE IF NOT EXISTS sitzung (
  id_hash TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person(id),
  angelegt_am TEXT NOT NULL, gueltig_bis TEXT NOT NULL
);
`;

type Zeile = Record<string, unknown>;

export function slugAus(name: string): string {
  const s = name
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'projekt';
}

/** Erkennt den Dateityp am Inhalt, nicht an der Angabe des Browsers. */
export function erkenneTyp(daten: Buffer): string | null {
  if (daten.length >= 8 && daten.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (daten.length >= 3 && daten[0] === 0xff && daten[1] === 0xd8 && daten[2] === 0xff) return 'image/jpeg';
  const kopf = daten.subarray(0, 12).toString('latin1');
  if (kopf.startsWith('GIF87a') || kopf.startsWith('GIF89a')) return 'image/gif';
  if (kopf.startsWith('RIFF') && kopf.slice(8, 12) === 'WEBP') return 'image/webp';
  if (kopf.startsWith('%PDF-')) return 'application/pdf';
  return null;
}

function saubererName(name: string): string {
  const ohnePfad = name.split(/[\\/]/).pop() ?? '';
  const sauber = ohnePfad.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  return sauber || 'datei';
}

function kurz(text: unknown, max: number): string {
  return String(text ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
}

// --- Anmeldung ------------------------------------------------------------------

/** So lange gilt ein Link aus der Anmelde-Mail. */
export const LINK_GUELTIG_MINUTEN = 15;
/** So lange bleibt man nach dem Klick angemeldet. */
export const SITZUNG_GUELTIG_TAGE = 30;
/** Mehr Anmelde-Mails pro Stunde und Adresse gehen nicht raus. */
export const MAX_LINKS_PRO_STUNDE = 5;

const ABGELAUFEN = 'Dieser Anmelde-Link ist abgelaufen oder wurde schon benutzt. Fordere einfach einen neuen an.';

/** Tokens liegen nur als Prüfsumme in der Datenbank. Wer die Datei liest, kann sich damit nicht anmelden. */
const pruefsummeVon = (wert: string): string => createHash('sha256').update(wert).digest('hex');
const zufall = (): string => randomBytes(32).toString('base64url');

/** Bereinigt eine Mail-Adresse oder gibt null zurück, wenn sie nicht wie eine aussieht. */
export function emailAus(eingabe: unknown): string | null {
  const email = String(eingabe ?? '').trim().toLowerCase();
  if (email.length > 254) return null;
  // Bewusst schlicht. Ob die Adresse lebt, zeigt erst die Mail.
  if (!/^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/.test(email)) return null;
  return email;
}

function alsPerson(z: Zeile): Person {
  return {
    id: String(z.id),
    agenturId: String(z.agentur_id),
    name: String(z.name),
    rolle: String(z.rolle) as Rolle,
    projektId: z.projekt_id === null ? null : String(z.projekt_id),
    email: z.email === null || z.email === undefined ? null : String(z.email),
    aktiv: Number(z.aktiv ?? 1) === 1,
  };
}

function alsProjekt(z: Zeile): Projekt {
  return {
    id: String(z.id),
    agenturId: String(z.agentur_id),
    name: String(z.name),
    kunde: String(z.kunde),
    slug: String(z.slug),
    angelegtAm: String(z.angelegt_am),
  };
}

function alsMedium(z: Zeile): Medium {
  return {
    id: String(z.id),
    agenturId: String(z.agentur_id),
    projektId: String(z.projekt_id),
    dateiname: String(z.dateiname),
    typ: String(z.typ),
    groesse: Number(z.groesse),
    pruefsumme: String(z.pruefsumme),
    version: Number(z.version),
    zustand: String(z.zustand) as Medium['zustand'],
    hochgeladenVon: String(z.hochgeladen_von),
    hochgeladenAm: String(z.hochgeladen_am),
  };
}

function alsStand(z: Zeile): Stand {
  return {
    id: String(z.id),
    agenturId: String(z.agentur_id),
    projektId: String(z.projekt_id),
    inhalt: JSON.parse(String(z.inhalt)) as Inhalt,
    zustand: String(z.zustand) as Stand['zustand'],
    token: String(z.token),
    eingereichtVon: String(z.eingereicht_von),
    eingereichtAm: String(z.eingereicht_am),
    entschiedenVon: z.entschieden_von === null ? null : String(z.entschieden_von),
    entschiedenAm: z.entschieden_am === null ? null : String(z.entschieden_am),
    kommentar: z.kommentar === null ? null : String(z.kommentar),
  };
}

export class Kern {
  #db: DatabaseSync;
  #medienOrdner: string;
  #uhr: () => Date;

  /**
   * `verzeichnis` nimmt Datenbank und hochgeladene Dateien auf.
   * `uhr` lässt sich in Tests ersetzen, um Ablaufzeiten zu prüfen.
   */
  constructor(verzeichnis: string, optionen: { uhr?: () => Date } = {}) {
    this.#uhr = optionen.uhr ?? (() => new Date());
    this.#medienOrdner = join(verzeichnis, 'medien');
    mkdirSync(this.#medienOrdner, { recursive: true });
    this.#db = new DatabaseSync(join(verzeichnis, 'kern.sqlite'));
    this.#db.exec('PRAGMA foreign_keys = ON');
    this.#db.exec(SCHEMA);
    this.#ergaenzeAlteDatenbank();
  }

  /** Datenbanken aus Etappe 1 kennen noch keine Mail-Adressen. */
  #ergaenzeAlteDatenbank(): void {
    const spalten = new Set((this.#db.prepare('PRAGMA table_info(person)').all() as Zeile[]).map((z) => String(z.name)));
    if (!spalten.has('email')) this.#db.exec('ALTER TABLE person ADD COLUMN email TEXT');
    if (!spalten.has('aktiv')) this.#db.exec('ALTER TABLE person ADD COLUMN aktiv INTEGER NOT NULL DEFAULT 1');
    this.#db.exec('CREATE UNIQUE INDEX IF NOT EXISTS person_email ON person (email) WHERE email IS NOT NULL');
  }

  #jetzt(abstandMs = 0): string {
    return new Date(this.#uhr().getTime() + abstandMs).toISOString();
  }

  schliessen(): void {
    this.#db.close();
  }

  // --- Agentur und Personen -------------------------------------------------

  agenturAnlegen(name: string): Agentur {
    const agentur = { id: randomUUID(), name: kurz(name, 120) || 'Agentur' };
    this.#db.prepare('INSERT INTO agentur (id, name) VALUES (?, ?)').run(agentur.id, agentur.name);
    return agentur;
  }

  /** Erste Person einer Agentur. Danach legt nur die Leitung weitere an. */
  erstePersonAnlegen(agenturId: string, daten: { name: string; email: string }): Person {
    const vorhanden = this.#db.prepare('SELECT COUNT(*) AS n FROM person WHERE agentur_id = ?').get(agenturId) as Zeile;
    if (Number(vorhanden.n) > 0) throw new Verboten('Diese Agentur hat schon Personen.');
    return this.#personEinfuegen(agenturId, daten.name, daten.email, 'leitung', null);
  }

  personAnlegen(als: Person, daten: { name: string; email: string; rolle: Rolle; projektId?: string | null }): Person {
    if (!darf(als, 'team.verwalten')) throw new Verboten('Nur die Leitung gibt Zugänge.');
    let projektId: string | null = null;
    if (daten.rolle === 'kundin') {
      if (!daten.projektId) throw new Fehler('Kund:innen brauchen ein Projekt.');
      projektId = this.#projektMitRecht(als, daten.projektId, 'projekt.ansehen').id;
    }
    return this.#personEinfuegen(als.agenturId, daten.name, daten.email, daten.rolle, projektId);
  }

  #personEinfuegen(agenturId: string, name: string, eingabeEmail: string, rolle: Rolle, projektId: string | null): Person {
    const email = emailAus(eingabeEmail);
    if (!email) throw new Fehler('Bitte eine gültige Mail-Adresse angeben.');
    if (this.#db.prepare('SELECT 1 FROM person WHERE email = ?').get(email)) {
      throw new Fehler('Diese Mail-Adresse hat schon einen Zugang.');
    }
    const person: Person = { id: randomUUID(), agenturId, name: kurz(name, 80) || 'Ohne Namen', rolle, projektId, email, aktiv: true };
    this.#db
      .prepare('INSERT INTO person (id, agentur_id, name, rolle, projekt_id, email, aktiv) VALUES (?, ?, ?, ?, ?, ?, 1)')
      .run(person.id, agenturId, person.name, rolle, projektId, email);
    return person;
  }

  /** Alle Personen der eigenen Agentur. Kund:innen sehen das Team nicht. */
  team(als: Person): Person[] {
    if (!darf(als, 'team.ansehen')) throw new Verboten('Das Team sieht nur die Agentur selbst.');
    const zeilen = this.#db
      .prepare('SELECT * FROM person WHERE agentur_id = ? ORDER BY aktiv DESC, rowid')
      .all(als.agenturId) as Zeile[];
    return zeilen.map(alsPerson);
  }

  /** Sperrt den Zugang sofort: offene Links und Sitzungen verfallen. Der Verlauf bleibt. */
  zugangEntziehen(als: Person, personId: string): Person {
    if (!darf(als, 'team.verwalten')) throw new Verboten('Nur die Leitung verwaltet Zugänge.');
    const z = this.#db.prepare('SELECT * FROM person WHERE id = ?').get(personId) as Zeile | undefined;
    if (!z || String(z.agentur_id) !== als.agenturId) throw new NichtGefunden('Person nicht gefunden.');
    if (String(z.id) === als.id) throw new Fehler('Den eigenen Zugang kannst du nicht entziehen.');
    this.#db.prepare('UPDATE person SET aktiv = 0 WHERE id = ?').run(personId);
    this.#db.prepare('DELETE FROM sitzung WHERE person_id = ?').run(personId);
    this.#db.prepare('UPDATE anmeldung SET eingeloest_am = ? WHERE person_id = ? AND eingeloest_am IS NULL').run(this.#jetzt(), personId);
    return { ...alsPerson(z), aktiv: false };
  }

  zugangWiedergeben(als: Person, personId: string): Person {
    if (!darf(als, 'team.verwalten')) throw new Verboten('Nur die Leitung verwaltet Zugänge.');
    const z = this.#db.prepare('SELECT * FROM person WHERE id = ?').get(personId) as Zeile | undefined;
    if (!z || String(z.agentur_id) !== als.agenturId) throw new NichtGefunden('Person nicht gefunden.');
    this.#db.prepare('UPDATE person SET aktiv = 1 WHERE id = ?').run(personId);
    return { ...alsPerson(z), aktiv: true };
  }

  // --- Anmeldung per Mail-Link ----------------------------------------------

  /**
   * Legt einen Einmal-Link an und gibt das Token für die Mail zurück.
   * `null` heißt: unbekannte Adresse, gesperrter Zugang oder zu viele Anfragen.
   * Wer aufruft, zeigt in jedem Fall dieselbe Antwort, damit niemand ausprobieren kann,
   * welche Adressen einen Zugang haben.
   */
  anmeldungAnfordern(eingabeEmail: string): { person: Person; token: string } | null {
    const email = emailAus(eingabeEmail);
    if (!email) return null;
    const z = this.#db.prepare('SELECT * FROM person WHERE email = ? AND aktiv = 1').get(email) as Zeile | undefined;
    if (!z) return null;
    const person = alsPerson(z);
    const zuletzt = this.#db
      .prepare('SELECT COUNT(*) AS n FROM anmeldung WHERE person_id = ? AND angefordert_am > ?')
      .get(person.id, this.#jetzt(-60 * 60 * 1000)) as Zeile;
    if (Number(zuletzt.n) >= MAX_LINKS_PRO_STUNDE) return null;

    const token = zufall();
    this.#db
      .prepare('INSERT INTO anmeldung (token_hash, person_id, angefordert_am, gueltig_bis) VALUES (?, ?, ?, ?)')
      .run(pruefsummeVon(token), person.id, this.#jetzt(), this.#jetzt(LINK_GUELTIG_MINUTEN * 60 * 1000));
    // Aufräumen: Was älter als einen Tag ist, zählt auch für die Grenze nicht mehr.
    this.#db.prepare('DELETE FROM anmeldung WHERE angefordert_am < ?').run(this.#jetzt(-24 * 60 * 60 * 1000));
    return { person, token };
  }

  /** Zeigt, für wen ein Link gilt, ohne ihn zu verbrauchen. */
  anmeldungPruefen(token: string): Person {
    const z = this.#db
      .prepare(
        `SELECT p.* FROM anmeldung a JOIN person p ON p.id = a.person_id
         WHERE a.token_hash = ? AND a.eingeloest_am IS NULL AND a.gueltig_bis > ? AND p.aktiv = 1`,
      )
      .get(pruefsummeVon(token), this.#jetzt()) as Zeile | undefined;
    if (!z) throw new Fehler(ABGELAUFEN);
    return alsPerson(z);
  }

  /** Verbraucht den Link und legt eine Sitzung an. Jeder Link geht genau einmal. */
  anmeldungEinloesen(token: string): { sitzung: string; person: Person; gueltigBis: string } {
    const person = this.anmeldungPruefen(token);
    const jetzt = this.#jetzt();
    // Die Bedingung im UPDATE verhindert, dass zwei gleichzeitige Klicks beide durchkommen.
    const ergebnis = this.#db
      .prepare('UPDATE anmeldung SET eingeloest_am = ? WHERE token_hash = ? AND eingeloest_am IS NULL AND gueltig_bis > ?')
      .run(jetzt, pruefsummeVon(token), jetzt);
    if (Number(ergebnis.changes) !== 1) throw new Fehler(ABGELAUFEN);
    // Ältere, noch offene Links derselben Person werden mit verbraucht.
    this.#db.prepare('UPDATE anmeldung SET eingeloest_am = ? WHERE person_id = ? AND eingeloest_am IS NULL').run(jetzt, person.id);

    const sitzung = zufall();
    const gueltigBis = this.#jetzt(SITZUNG_GUELTIG_TAGE * 24 * 60 * 60 * 1000);
    this.#db
      .prepare('INSERT INTO sitzung (id_hash, person_id, angelegt_am, gueltig_bis) VALUES (?, ?, ?, ?)')
      .run(pruefsummeVon(sitzung), person.id, jetzt, gueltigBis);
    this.#db.prepare('DELETE FROM sitzung WHERE gueltig_bis < ?').run(jetzt);
    return { sitzung, person, gueltigBis };
  }

  /** Die angemeldete Person zu einer Sitzung, oder null. */
  sitzungPerson(sitzung: string): Person | null {
    const z = this.#db
      .prepare(
        `SELECT p.* FROM sitzung s JOIN person p ON p.id = s.person_id
         WHERE s.id_hash = ? AND s.gueltig_bis > ? AND p.aktiv = 1`,
      )
      .get(pruefsummeVon(sitzung), this.#jetzt()) as Zeile | undefined;
    return z ? alsPerson(z) : null;
  }

  /**
   * Nur für die Arbeit auf dem eigenen Rechner: Sitzung ohne Mail-Link.
   * Der Server bietet das nur an, wenn kein Mailserver eingestellt ist und die Anfrage von diesem Rechner kommt.
   */
  sitzungOhneLink(personId: string): { sitzung: string; person: Person } {
    const z = this.#db.prepare('SELECT * FROM person WHERE id = ? AND aktiv = 1').get(personId) as Zeile | undefined;
    if (!z) throw new NichtGefunden('Person nicht gefunden.');
    const sitzung = zufall();
    this.#db
      .prepare('INSERT INTO sitzung (id_hash, person_id, angelegt_am, gueltig_bis) VALUES (?, ?, ?, ?)')
      .run(pruefsummeVon(sitzung), personId, this.#jetzt(), this.#jetzt(SITZUNG_GUELTIG_TAGE * 24 * 60 * 60 * 1000));
    return { sitzung, person: alsPerson(z) };
  }

  /** Nur für die Arbeit auf dem eigenen Rechner: alle, als die man sich dort per Klick anmelden kann. */
  anmeldbarePersonen(): Person[] {
    return (this.#db.prepare('SELECT * FROM person WHERE aktiv = 1 ORDER BY rowid').all() as Zeile[]).map(alsPerson);
  }

  abmelden(sitzung: string): void {
    this.#db.prepare('DELETE FROM sitzung WHERE id_hash = ?').run(pruefsummeVon(sitzung));
  }

  /** Nur für die Einrichtung über die Kommandozeile. */
  agenturen(): Agentur[] {
    const zeilen = this.#db.prepare('SELECT * FROM agentur ORDER BY rowid').all() as Zeile[];
    return zeilen.map((z) => ({ id: String(z.id), name: String(z.name) }));
  }

  // --- Projekte -------------------------------------------------------------

  projektAnlegen(als: Person, daten: { name: string; kunde: string }): Projekt {
    if (!darf(als, 'projekt.anlegen')) throw new Verboten('Diese Rolle legt keine Projekte an.');
    const name = kurz(daten.name, 120);
    if (!name) throw new Fehler('Das Projekt braucht einen Namen.');
    const projekt: Projekt = {
      id: randomUUID(),
      agenturId: als.agenturId,
      name,
      kunde: kurz(daten.kunde, 120),
      slug: this.#freierSlug(slugAus(name)),
      angelegtAm: this.#jetzt(),
    };
    this.#db
      .prepare('INSERT INTO projekt (id, agentur_id, name, kunde, slug, angelegt_am) VALUES (?, ?, ?, ?, ?, ?)')
      .run(projekt.id, projekt.agenturId, projekt.name, projekt.kunde, projekt.slug, projekt.angelegtAm);
    this.#merke(projekt, als.name, 'projekt.angelegt', `Projekt „${projekt.name}“ angelegt`);
    return projekt;
  }

  #freierSlug(basis: string): string {
    const belegt = this.#db.prepare('SELECT 1 FROM projekt WHERE slug = ?');
    let slug = basis;
    for (let n = 2; belegt.get(slug); n++) slug = `${basis}-${n}`;
    return slug;
  }

  /** Alle Projekte, die die Person sehen darf, mit dem Stand für die Übersicht. */
  projekte(als: Person): ProjektUebersicht[] {
    const zeilen = this.#db
      .prepare(
        `SELECT p.*,
           (SELECT COUNT(*) FROM medium m WHERE m.projekt_id = p.id AND m.zustand != 'gesehen') AS neue_medien,
           (SELECT COUNT(*) FROM stand s WHERE s.projekt_id = p.id AND s.zustand = 'eingereicht') AS offen,
           (SELECT COUNT(*) FROM seite t WHERE t.projekt_id = p.id AND t.veroeffentlicht IS NOT NULL) AS online
         FROM projekt p WHERE p.agentur_id = ? ORDER BY p.angelegt_am DESC`,
      )
      .all(als.agenturId) as Zeile[];
    return zeilen
      .map((z) => ({
        ...alsProjekt(z),
        neueMedien: Number(z.neue_medien),
        offenerStand: Number(z.offen) > 0,
        veroeffentlicht: Number(z.online) > 0,
      }))
      .filter((p) => darf(als, 'projekt.ansehen', p));
  }

  projekt(als: Person, projektId: string): Projekt {
    return this.#projektMitRecht(als, projektId, 'projekt.ansehen');
  }

  #projektMitRecht(als: Person, projektId: string, aktion: Aktion): Projekt {
    const z = this.#db.prepare('SELECT * FROM projekt WHERE id = ?').get(projektId) as Zeile | undefined;
    // Fremde Projekte sehen aus wie nicht vorhandene, damit niemand Ids erraten kann.
    if (!z || String(z.agentur_id) !== als.agenturId) throw new NichtGefunden('Projekt nicht gefunden.');
    const projekt = alsProjekt(z);
    if (!darf(als, aktion, projekt)) throw new Verboten('Dafür reicht diese Rolle nicht.');
    return projekt;
  }

  // --- Medien ---------------------------------------------------------------

  mediumHinzufuegen(
    als: Person,
    projektId: string,
    datei: { dateiname: string; daten: Buffer },
  ): { medium: Medium; ergebnis: 'neu' | 'geaendert' | 'unveraendert' } {
    const projekt = this.#projektMitRecht(als, projektId, 'medium.hochladen');
    if (datei.daten.length === 0) throw new Fehler('Die Datei ist leer.');
    if (datei.daten.length > MAX_GROESSE) throw new Fehler('Die Datei ist größer als 25 MB.');
    const typ = erkenneTyp(datei.daten);
    if (!typ) throw new Fehler('Dieser Dateityp wird noch nicht angenommen. Erlaubt sind PNG, JPEG, WebP, GIF und PDF.');
    const dateiname = saubererName(datei.dateiname);
    const pruefsumme = createHash('sha256').update(datei.daten).digest('hex');
    const vorhanden = this.#db
      .prepare('SELECT * FROM medium WHERE projekt_id = ? AND dateiname = ?')
      .get(projekt.id, dateiname) as Zeile | undefined;

    if (vorhanden && String(vorhanden.pruefsumme) === pruefsumme) {
      return { medium: alsMedium(vorhanden), ergebnis: 'unveraendert' };
    }

    const id = vorhanden ? String(vorhanden.id) : randomUUID();
    const version = vorhanden ? Number(vorhanden.version) + 1 : 1;
    const ablage = `${id}-v${version}.${ENDUNG[typ]}`;
    writeFileSync(join(this.#medienOrdner, ablage), datei.daten);
    const zeit = this.#jetzt();

    if (vorhanden) {
      this.#db
        .prepare(
          `UPDATE medium SET datei = ?, typ = ?, groesse = ?, pruefsumme = ?, version = ?, zustand = 'geaendert',
             hochgeladen_von = ?, hochgeladen_am = ? WHERE id = ?`,
        )
        .run(ablage, typ, datei.daten.length, pruefsumme, version, als.name, zeit, id);
      this.#merke(projekt, als.name, 'medium.geaendert', `„${dateiname}“ ersetzt, Version ${version}`);
    } else {
      this.#db
        .prepare(
          `INSERT INTO medium (id, agentur_id, projekt_id, dateiname, datei, typ, groesse, pruefsumme, version,
             zustand, hochgeladen_von, hochgeladen_am) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'neu', ?, ?)`,
        )
        .run(id, projekt.agenturId, projekt.id, dateiname, ablage, typ, datei.daten.length, pruefsumme, als.name, zeit);
      this.#merke(projekt, als.name, 'medium.neu', `„${dateiname}“ hochgeladen`);
    }
    const zeile = this.#db.prepare('SELECT * FROM medium WHERE id = ?').get(id) as Zeile;
    return { medium: alsMedium(zeile), ergebnis: vorhanden ? 'geaendert' : 'neu' };
  }

  medien(als: Person, projektId: string): Medium[] {
    const projekt = this.#projektMitRecht(als, projektId, 'projekt.ansehen');
    const zeilen = this.#db
      .prepare('SELECT * FROM medium WHERE projekt_id = ? ORDER BY hochgeladen_am DESC')
      .all(projekt.id) as Zeile[];
    return zeilen.map(alsMedium);
  }

  mediumGesehen(als: Person, mediumId: string): Medium {
    const { medium } = this.#mediumMitRecht(als, mediumId);
    this.#db.prepare(`UPDATE medium SET zustand = 'gesehen' WHERE id = ?`).run(medium.id);
    return { ...medium, zustand: 'gesehen' };
  }

  mediumDatei(als: Person, mediumId: string): { medium: Medium; daten: Buffer } {
    const { medium, ablage } = this.#mediumMitRecht(als, mediumId);
    return { medium, daten: readFileSync(join(this.#medienOrdner, ablage)) };
  }

  #mediumMitRecht(als: Person, mediumId: string): { medium: Medium; ablage: string } {
    const z = this.#db.prepare('SELECT * FROM medium WHERE id = ?').get(mediumId) as Zeile | undefined;
    if (!z) throw new NichtGefunden('Datei nicht gefunden.');
    this.#projektMitRecht(als, String(z.projekt_id), 'projekt.ansehen');
    return { medium: alsMedium(z), ablage: String(z.datei) };
  }

  /** Bild eines Inhalts ohne Anmeldung, nur für Prüf-Link und veröffentlichte Seite. */
  #bildZuInhalt(projektId: string, inhalt: Inhalt): { medium: Medium; daten: Buffer } | null {
    if (!inhalt.bildId) return null;
    const z = this.#db
      .prepare('SELECT * FROM medium WHERE id = ? AND projekt_id = ?')
      .get(inhalt.bildId, projektId) as Zeile | undefined;
    if (!z) return null;
    return { medium: alsMedium(z), daten: readFileSync(join(this.#medienOrdner, String(z.datei))) };
  }

  // --- Seite ----------------------------------------------------------------

  seite(als: Person, projektId: string): { entwurf: Inhalt; veroeffentlicht: Inhalt | null } {
    const projekt = this.#projektMitRecht(als, projektId, 'projekt.ansehen');
    return this.#seiteLaden(projekt.id);
  }

  #seiteLaden(projektId: string): { entwurf: Inhalt; veroeffentlicht: Inhalt | null } {
    const z = this.#db.prepare('SELECT * FROM seite WHERE projekt_id = ?').get(projektId) as Zeile | undefined;
    if (!z) return { entwurf: { ...LEERER_INHALT }, veroeffentlicht: null };
    return {
      entwurf: JSON.parse(String(z.entwurf)) as Inhalt,
      veroeffentlicht: z.veroeffentlicht === null ? null : (JSON.parse(String(z.veroeffentlicht)) as Inhalt),
    };
  }

  seiteSpeichern(als: Person, projektId: string, eingabe: Partial<Inhalt>): Inhalt {
    const projekt = this.#projektMitRecht(als, projektId, 'seite.bearbeiten');
    let bildId: string | null = eingabe.bildId ? String(eingabe.bildId) : null;
    if (bildId) {
      const bild = this.#db
        .prepare('SELECT typ FROM medium WHERE id = ? AND projekt_id = ?')
        .get(bildId, projekt.id) as Zeile | undefined;
      if (!bild || !String(bild.typ).startsWith('image/')) throw new Fehler('Das gewählte Bild gehört nicht zu diesem Projekt.');
    }
    const inhalt: Inhalt = {
      ueberschrift: kurz(eingabe.ueberschrift, 200),
      text: kurz(eingabe.text, 20000),
      bildId,
      bildAlt: bildId ? kurz(eingabe.bildAlt, 300) : '',
    };
    this.#db
      .prepare(
        `INSERT INTO seite (projekt_id, agentur_id, entwurf, veroeffentlicht, geaendert_am) VALUES (?, ?, ?, NULL, ?)
         ON CONFLICT (projekt_id) DO UPDATE SET entwurf = excluded.entwurf, geaendert_am = excluded.geaendert_am`,
      )
      .run(projekt.id, projekt.agenturId, JSON.stringify(inhalt), this.#jetzt());
    this.#merke(projekt, als.name, 'seite.gespeichert', 'Entwurf der Seite gespeichert');
    return inhalt;
  }

  // --- Stände und Freigabe --------------------------------------------------

  standEinreichen(als: Person, projektId: string): Stand {
    const projekt = this.#projektMitRecht(als, projektId, 'stand.einreichen');
    const { entwurf } = this.#seiteLaden(projekt.id);
    if (!entwurf.ueberschrift) throw new Fehler('Ohne Überschrift lässt sich kein Stand einreichen.');
    this.#db
      .prepare(`UPDATE stand SET zustand = 'ersetzt' WHERE projekt_id = ? AND zustand = 'eingereicht'`)
      .run(projekt.id);
    const id = randomUUID();
    this.#db
      .prepare(
        `INSERT INTO stand (id, agentur_id, projekt_id, inhalt, zustand, token, eingereicht_von, eingereicht_am)
         VALUES (?, ?, ?, ?, 'eingereicht', ?, ?, ?)`,
      )
      .run(id, projekt.agenturId, projekt.id, JSON.stringify(entwurf), randomBytes(24).toString('base64url'), als.name, this.#jetzt());
    this.#merke(projekt, als.name, 'stand.eingereicht', 'Stand zur Freigabe eingereicht');
    return alsStand(this.#db.prepare('SELECT * FROM stand WHERE id = ?').get(id) as Zeile);
  }

  letzterStand(als: Person, projektId: string): Stand | null {
    const projekt = this.#projektMitRecht(als, projektId, 'projekt.ansehen');
    const z = this.#db
      .prepare(`SELECT * FROM stand WHERE projekt_id = ? AND zustand != 'ersetzt' ORDER BY eingereicht_am DESC LIMIT 1`)
      .get(projekt.id) as Zeile | undefined;
    return z ? alsStand(z) : null;
  }

  /** Der Prüf-Link: Wer das Token kennt, sieht genau diesen Stand, ohne Konto. */
  standPerToken(token: string): { stand: Stand; projekt: Projekt; veroeffentlicht: Inhalt | null } {
    const z = this.#db.prepare('SELECT * FROM stand WHERE token = ?').get(token) as Zeile | undefined;
    if (!z) throw new NichtGefunden('Dieser Prüf-Link ist nicht gültig.');
    const stand = alsStand(z);
    const projekt = alsProjekt(this.#db.prepare('SELECT * FROM projekt WHERE id = ?').get(stand.projektId) as Zeile);
    return { stand, projekt, veroeffentlicht: this.#seiteLaden(projekt.id).veroeffentlicht };
  }

  standEntscheiden(token: string, daten: { freigeben: boolean; name: string; kommentar?: string }): Stand {
    const { stand, projekt } = this.standPerToken(token);
    if (stand.zustand !== 'eingereicht') throw new Fehler('Dieser Stand wurde schon entschieden oder ersetzt.');
    const name = kurz(daten.name, 80);
    if (!name) throw new Fehler('Bitte den eigenen Namen angeben.');
    const kommentar = kurz(daten.kommentar, 2000) || null;
    const zeit = this.#jetzt();
    this.#db.exec('BEGIN');
    try {
      this.#db
        .prepare('UPDATE stand SET zustand = ?, entschieden_von = ?, entschieden_am = ?, kommentar = ? WHERE id = ?')
        .run(daten.freigeben ? 'freigegeben' : 'abgelehnt', name, zeit, kommentar, stand.id);
      if (daten.freigeben) {
        this.#db.prepare('UPDATE seite SET veroeffentlicht = ? WHERE projekt_id = ?').run(JSON.stringify(stand.inhalt), projekt.id);
      }
      this.#db.exec('COMMIT');
    } catch (fehler) {
      this.#db.exec('ROLLBACK');
      throw fehler;
    }
    const wer = `${name} (per Prüf-Link)`;
    if (daten.freigeben) {
      this.#merke(projekt, wer, 'stand.freigegeben', 'Stand freigegeben und veröffentlicht');
    } else {
      this.#merke(projekt, wer, 'stand.abgelehnt', kommentar ? `Änderung gewünscht: ${kommentar}` : 'Änderung gewünscht');
    }
    return this.standPerToken(token).stand;
  }

  bildZumStand(token: string): { medium: Medium; daten: Buffer } | null {
    const { stand } = this.standPerToken(token);
    return this.#bildZuInhalt(stand.projektId, stand.inhalt);
  }

  // --- Veröffentlichte Seite ------------------------------------------------

  veroeffentlicht(slug: string): { projekt: Projekt; inhalt: Inhalt } | null {
    const z = this.#db.prepare('SELECT * FROM projekt WHERE slug = ?').get(slug) as Zeile | undefined;
    if (!z) return null;
    const projekt = alsProjekt(z);
    const inhalt = this.#seiteLaden(projekt.id).veroeffentlicht;
    return inhalt ? { projekt, inhalt } : null;
  }

  bildVeroeffentlicht(slug: string): { medium: Medium; daten: Buffer } | null {
    const seite = this.veroeffentlicht(slug);
    return seite ? this.#bildZuInhalt(seite.projekt.id, seite.inhalt) : null;
  }

  // --- Verlauf --------------------------------------------------------------

  verlauf(als: Person, projektId: string, grenze = 100): Ereignis[] {
    const projekt = this.#projektMitRecht(als, projektId, 'projekt.ansehen');
    const zeilen = this.#db
      .prepare('SELECT * FROM ereignis WHERE projekt_id = ? ORDER BY zeit DESC, rowid DESC LIMIT ?')
      .all(projekt.id, grenze) as Zeile[];
    return zeilen.map((z) => ({
      id: String(z.id),
      projektId: String(z.projekt_id),
      personName: String(z.person_name),
      art: String(z.art),
      text: String(z.text),
      zeit: String(z.zeit),
    }));
  }

  #merke(projekt: Projekt, personName: string, art: string, text: string): void {
    this.#db
      .prepare('INSERT INTO ereignis (id, agentur_id, projekt_id, person_name, art, text, zeit) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), projekt.agenturId, projekt.id, personName, art, text, this.#jetzt());
  }
}
