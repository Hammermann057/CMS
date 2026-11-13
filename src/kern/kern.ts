import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { darf, Verboten } from './rechte.ts';
import type { Aktion } from './rechte.ts';
import { Fehler, NichtGefunden } from './fehler.ts';
import { bereinige, bilderIn, gleich, MAX_BAUSTEINE, neuerBaustein, verschiebe } from './bausteine.ts';
import { bereinigeRegelwerk, STANDARD_REGELWERK, unterschiede } from './regelwerk.ts';
import type {
  Agentur,
  Baustein,
  Ereignis,
  Medium,
  Person,
  Projekt,
  ProjektUebersicht,
  Regelwerk,
  Rolle,
  Seite,
  SeitenStand,
  Stand,
  Website,
} from './typen.ts';

export { Fehler, NichtGefunden };

export const MAX_GROESSE = 25 * 1024 * 1024;

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
  id TEXT PRIMARY KEY, agentur_id TEXT NOT NULL, projekt_id TEXT NOT NULL REFERENCES projekt(id),
  slug TEXT NOT NULL, titel TEXT NOT NULL, position INTEGER NOT NULL, bausteine TEXT NOT NULL,
  geaendert_von TEXT NOT NULL, geaendert_am TEXT NOT NULL,
  UNIQUE (projekt_id, slug)
);
CREATE TABLE IF NOT EXISTS regelwerk (
  projekt_id TEXT PRIMARY KEY REFERENCES projekt(id), agentur_id TEXT NOT NULL,
  werte TEXT NOT NULL, geaendert_von TEXT NOT NULL, geaendert_am TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS veroeffentlichung (
  projekt_id TEXT PRIMARY KEY REFERENCES projekt(id), agentur_id TEXT NOT NULL,
  website TEXT NOT NULL, stand_id TEXT NOT NULL, veroeffentlicht_am TEXT NOT NULL
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

/** Etappe 1 kannte eine Seite mit Überschrift, Text und Bild. So sieht sie als Bausteine aus. */
interface InhaltEtappe1 {
  ueberschrift: string;
  text: string;
  bildId: string | null;
  bildAlt: string;
}

function ausEtappe1(alt: InhaltEtappe1, kennung: string): Baustein[] {
  const bausteine: Baustein[] = [
    { id: `${kennung}-kopf`, gesperrt: false, typ: 'kopf', ueberschrift: alt.ueberschrift ?? '', unterzeile: '', bildId: alt.bildId ?? null, bildAlt: alt.bildAlt ?? '' },
  ];
  if (alt.text) bausteine.push({ id: `${kennung}-text`, gesperrt: false, typ: 'text', text: alt.text });
  return bausteine;
}

function websiteAus(json: string, kennung: string): Website {
  const roh = JSON.parse(json) as Website | InhaltEtappe1;
  if ('seiten' in roh) return roh;
  return { seiten: [{ id: `${kennung}-seite`, slug: 'startseite', titel: 'Startseite', bausteine: ausEtappe1(roh, kennung) }] };
}

function alsSeite(z: Zeile): Seite {
  return {
    id: String(z.id),
    agenturId: String(z.agentur_id),
    projektId: String(z.projekt_id),
    slug: String(z.slug),
    titel: String(z.titel),
    position: Number(z.position),
    bausteine: JSON.parse(String(z.bausteine)) as Baustein[],
    geaendertVon: String(z.geaendert_von),
    geaendertAm: String(z.geaendert_am),
  };
}

const alsSeitenStand = (s: Seite): SeitenStand => ({ id: s.id, slug: s.slug, titel: s.titel, bausteine: s.bausteine });

function alsStand(z: Zeile): Stand {
  return {
    id: String(z.id),
    agenturId: String(z.agentur_id),
    projektId: String(z.projekt_id),
    inhalt: websiteAus(String(z.inhalt), String(z.id)),
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
    const alteSeiten = this.#spalten('seite').has('entwurf');
    if (alteSeiten) this.#db.exec('ALTER TABLE seite RENAME TO seite_etappe1');
    this.#db.exec(SCHEMA);
    this.#ergaenzeAlteDatenbank();
    if (alteSeiten) this.#seitenAusEtappe1();
  }

  /** Datenbanken aus Etappe 1 kennen noch keine Mail-Adressen. */
  #spalten(tabelle: string): Set<string> {
    return new Set((this.#db.prepare(`PRAGMA table_info(${tabelle})`).all() as Zeile[]).map((z) => String(z.name)));
  }

  /** Aus der einen Seite je Projekt in Etappe 1 wird eine Startseite aus Bausteinen. */
  #seitenAusEtappe1(): void {
    this.#db.exec('BEGIN');
    try {
      for (const z of this.#db.prepare('SELECT * FROM seite_etappe1').all() as Zeile[]) {
        const projektId = String(z.projekt_id);
        const id = randomUUID();
        const bausteine = ausEtappe1(JSON.parse(String(z.entwurf)) as InhaltEtappe1, id).map((b) => ({ ...b, id: randomUUID() }));
        this.#db
          .prepare(
            `INSERT INTO seite (id, agentur_id, projekt_id, slug, titel, position, bausteine, geaendert_von, geaendert_am)
             VALUES (?, ?, ?, 'startseite', 'Startseite', 0, ?, 'Übernahme aus Etappe 1', ?)`,
          )
          .run(id, String(z.agentur_id), projektId, JSON.stringify(bausteine), String(z.geaendert_am));
        if (z.veroeffentlicht !== null) {
          const stand = this.#db
            .prepare(`SELECT id FROM stand WHERE projekt_id = ? AND zustand = 'freigegeben' ORDER BY entschieden_am DESC LIMIT 1`)
            .get(projektId) as Zeile | undefined;
          this.#db
            .prepare('INSERT INTO veroeffentlichung (projekt_id, agentur_id, website, stand_id, veroeffentlicht_am) VALUES (?, ?, ?, ?, ?)')
            .run(projektId, String(z.agentur_id), JSON.stringify(websiteAus(String(z.veroeffentlicht), projektId)), String(stand?.id ?? ''), String(z.geaendert_am));
        }
      }
      this.#db.exec('DROP TABLE seite_etappe1');
      this.#db.exec('COMMIT');
    } catch (fehler) {
      this.#db.exec('ROLLBACK');
      throw fehler;
    }
  }

  #ergaenzeAlteDatenbank(): void {
    const spalten = this.#spalten('person');
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
           (SELECT COUNT(*) FROM veroeffentlichung v WHERE v.projekt_id = p.id) AS online
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

  /** Bilder des Projekts, die sich in Bausteine einsetzen lassen. */
  #bilderDesProjekts(projektId: string): Set<string> {
    const zeilen = this.#db.prepare(`SELECT id FROM medium WHERE projekt_id = ? AND typ LIKE 'image/%'`).all(projektId) as Zeile[];
    return new Set(zeilen.map((z) => String(z.id)));
  }

  /** Bild ohne Anmeldung, nur wenn es in dieser Website vorkommt: für Prüf-Link und veröffentlichte Seiten. */
  #bildAusWebsite(projektId: string, website: Website, mediumId: string): { medium: Medium; daten: Buffer } | null {
    if (!website.seiten.some((s) => bilderIn(s.bausteine).includes(mediumId))) return null;
    const z = this.#db.prepare('SELECT * FROM medium WHERE id = ? AND projekt_id = ?').get(mediumId, projektId) as Zeile | undefined;
    if (!z) return null;
    return { medium: alsMedium(z), daten: readFileSync(join(this.#medienOrdner, String(z.datei))) };
  }

  // --- Seiten ---------------------------------------------------------------

  seiten(als: Person, projektId: string): Seite[] {
    const projekt = this.#projektMitRecht(als, projektId, 'projekt.ansehen');
    return this.#seitenLaden(projekt.id);
  }

  #seitenLaden(projektId: string): Seite[] {
    const zeilen = this.#db.prepare('SELECT * FROM seite WHERE projekt_id = ? ORDER BY position, rowid').all(projektId) as Zeile[];
    return zeilen.map(alsSeite);
  }

  seite(als: Person, seiteId: string): Seite {
    return this.#seiteMitRecht(als, seiteId, 'projekt.ansehen').seite;
  }

  #seiteMitRecht(als: Person, seiteId: string, aktion: Aktion): { seite: Seite; projekt: Projekt } {
    const z = this.#db.prepare('SELECT * FROM seite WHERE id = ?').get(seiteId) as Zeile | undefined;
    if (!z) throw new NichtGefunden('Seite nicht gefunden.');
    const projekt = this.#projektMitRecht(als, String(z.projekt_id), aktion);
    return { seite: alsSeite(z), projekt };
  }

  #freierSeitenSlug(projektId: string, titel: string, ausser?: string): string {
    const belegt = this.#db.prepare('SELECT 1 FROM seite WHERE projekt_id = ? AND slug = ? AND id != ?');
    const basis = slugAus(titel) === 'projekt' ? 'seite' : slugAus(titel);
    let slug = basis;
    for (let n = 2; belegt.get(projektId, slug, ausser ?? ''); n++) slug = `${basis}-${n}`;
    return slug;
  }

  /** Neue Seite am Ende. Sie beginnt mit einem Kopf, in dem schon der Titel steht. */
  seiteAnlegen(als: Person, projektId: string, eingabeTitel: string): Seite {
    const projekt = this.#projektMitRecht(als, projektId, 'seite.aufbau');
    const titel = kurz(eingabeTitel, 80);
    if (!titel) throw new Fehler('Die Seite braucht einen Titel.');
    const anzahl = this.#db.prepare('SELECT COUNT(*) AS n, MAX(position) AS letzte FROM seite WHERE projekt_id = ?').get(projekt.id) as Zeile;
    if (Number(anzahl.n) >= 50) throw new Fehler('Mehr als 50 Seiten hat ein Projekt nicht.');
    const kopf = neuerBaustein('kopf');
    if (kopf.typ === 'kopf') kopf.ueberschrift = titel;
    const seite: Seite = {
      id: randomUUID(),
      agenturId: projekt.agenturId,
      projektId: projekt.id,
      slug: this.#freierSeitenSlug(projekt.id, titel),
      titel,
      position: anzahl.letzte === null ? 0 : Number(anzahl.letzte) + 1,
      bausteine: [kopf],
      geaendertVon: als.name,
      geaendertAm: this.#jetzt(),
    };
    this.#db
      .prepare(
        `INSERT INTO seite (id, agentur_id, projekt_id, slug, titel, position, bausteine, geaendert_von, geaendert_am)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(seite.id, seite.agenturId, seite.projektId, seite.slug, seite.titel, seite.position, JSON.stringify(seite.bausteine), seite.geaendertVon, seite.geaendertAm);
    this.#merke(projekt, als.name, 'seite.angelegt', `Seite „${titel}“ angelegt`);
    return seite;
  }

  /**
   * Speichert Titel und Bausteine einer Seite.
   * Die Agentur darf alles. Kund:innen ändern nur Inhalte in Bausteinen, die nicht gesperrt sind:
   * Titel, Reihenfolge, Art und Sperre bleiben, wie die Agentur sie angelegt hat, egal was ankommt.
   */
  seiteSpeichern(als: Person, seiteId: string, eingabe: { titel?: string; bausteine: unknown[] }): Seite {
    const { seite: alt, projekt } = this.#seiteMitRecht(als, seiteId, 'seite.inhalt');
    if (!Array.isArray(eingabe.bausteine)) throw new Fehler('Keine Bausteine übergeben.');
    if (eingabe.bausteine.length > MAX_BAUSTEINE) throw new Fehler(`Mehr als ${MAX_BAUSTEINE} Bausteine hat eine Seite nicht.`);
    const bilder = this.#bilderDesProjekts(projekt.id);
    const neu = eingabe.bausteine.map((b) => bereinige(b, bilder));
    if (new Set(neu.map((b) => b.id)).size !== neu.length) throw new Fehler('Zwei Bausteine haben dieselbe Kennung.');

    let titel = alt.titel;
    let slug = alt.slug;
    let bausteine: Baustein[];
    if (darf(als, 'seite.aufbau', projekt)) {
      bausteine = neu;
      const neuerTitel = kurz(eingabe.titel ?? alt.titel, 80);
      if (!neuerTitel) throw new Fehler('Die Seite braucht einen Titel.');
      if (neuerTitel !== alt.titel) {
        titel = neuerTitel;
        slug = this.#freierSeitenSlug(projekt.id, titel, alt.id);
      }
    } else {
      const eingang = new Map(neu.map((b) => [b.id, b]));
      bausteine = alt.bausteine.map((b) => {
        const geaendert = eingang.get(b.id);
        if (b.gesperrt || !geaendert || geaendert.typ !== b.typ) return b;
        return { ...geaendert, gesperrt: false };
      });
    }

    if (titel === alt.titel && gleich(bausteine, alt.bausteine)) return alt;
    const zeit = this.#jetzt();
    this.#db
      .prepare('UPDATE seite SET titel = ?, slug = ?, bausteine = ?, geaendert_von = ?, geaendert_am = ? WHERE id = ?')
      .run(titel, slug, JSON.stringify(bausteine), als.name, zeit, alt.id);
    this.#merke(projekt, als.name, 'seite.gespeichert', `Seite „${titel}“ gespeichert`);
    return { ...alt, titel, slug, bausteine, geaendertVon: als.name, geaendertAm: zeit };
  }

  seiteVerschieben(als: Person, seiteId: string, richtung: -1 | 1): void {
    const { seite, projekt } = this.#seiteMitRecht(als, seiteId, 'seite.aufbau');
    const neu = verschiebe(this.#seitenLaden(projekt.id), seite.id, richtung);
    const setzen = this.#db.prepare('UPDATE seite SET position = ? WHERE id = ?');
    neu.forEach((s, i) => setzen.run(i, s.id));
  }

  /** Löscht den Entwurf. Was online ist, bleibt online, bis ein neuer Stand freigegeben wird. */
  seiteLoeschen(als: Person, seiteId: string): void {
    const { seite, projekt } = this.#seiteMitRecht(als, seiteId, 'seite.aufbau');
    this.#db.prepare('DELETE FROM seite WHERE id = ?').run(seite.id);
    this.#merke(projekt, als.name, 'seite.geloescht', `Seite „${seite.titel}“ gelöscht`);
  }

  // --- Regelwerk -------------------------------------------------------------

  /** Das Regelwerk des Projekts. Solange niemand etwas festgelegt hat, gilt das Standard-Regelwerk. */
  regelwerk(als: Person, projektId: string): Regelwerk {
    const projekt = this.#projektMitRecht(als, projektId, 'projekt.ansehen');
    return this.#regelwerkLaden(projekt.id);
  }

  #regelwerkLaden(projektId: string): Regelwerk {
    const z = this.#db.prepare('SELECT werte FROM regelwerk WHERE projekt_id = ?').get(projektId) as Zeile | undefined;
    // Neue Felder späterer Versionen bekommen so ihren Standardwert.
    return z ? bereinigeRegelwerk(JSON.parse(String(z.werte)), STANDARD_REGELWERK) : STANDARD_REGELWERK;
  }

  /** Speichert Änderungen am Regelwerk. Online geht es erst mit dem nächsten freigegebenen Stand. */
  regelwerkSpeichern(als: Person, projektId: string, eingabe: unknown): Regelwerk {
    const projekt = this.#projektMitRecht(als, projektId, 'regelwerk.bearbeiten');
    const alt = this.#regelwerkLaden(projekt.id);
    const neu = bereinigeRegelwerk(eingabe, alt);
    const geaendert = unterschiede(alt, neu);
    if (!geaendert.length) return alt;
    this.#db
      .prepare(
        `INSERT INTO regelwerk (projekt_id, agentur_id, werte, geaendert_von, geaendert_am) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (projekt_id) DO UPDATE SET werte = excluded.werte, geaendert_von = excluded.geaendert_von, geaendert_am = excluded.geaendert_am`,
      )
      .run(projekt.id, projekt.agenturId, JSON.stringify(neu), als.name, this.#jetzt());
    this.#merke(projekt, als.name, 'regelwerk.gespeichert', `Regelwerk geändert: ${geaendert.map((u) => u.feld.name).join(', ')}`);
    return neu;
  }

  // --- Stände und Freigabe --------------------------------------------------

  /** Friert alle Seiten ein, so wie sie jetzt sind, und erzeugt den Prüf-Link. */
  standEinreichen(als: Person, projektId: string): Stand {
    const projekt = this.#projektMitRecht(als, projektId, 'stand.einreichen');
    const seiten = this.#seitenLaden(projekt.id);
    if (!seiten.length) throw new Fehler('Es gibt noch keine Seite, die sich einreichen ließe.');
    const website: Website = { seiten: seiten.map(alsSeitenStand), regelwerk: this.#regelwerkLaden(projekt.id) };
    this.#db
      .prepare(`UPDATE stand SET zustand = 'ersetzt' WHERE projekt_id = ? AND zustand = 'eingereicht'`)
      .run(projekt.id);
    const id = randomUUID();
    this.#db
      .prepare(
        `INSERT INTO stand (id, agentur_id, projekt_id, inhalt, zustand, token, eingereicht_von, eingereicht_am)
         VALUES (?, ?, ?, ?, 'eingereicht', ?, ?, ?)`,
      )
      .run(id, projekt.agenturId, projekt.id, JSON.stringify(website), randomBytes(24).toString('base64url'), als.name, this.#jetzt());
    this.#merke(projekt, als.name, 'stand.eingereicht', `Stand mit ${seiten.length === 1 ? 'einer Seite' : `${seiten.length} Seiten`} zur Freigabe eingereicht`);
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
  standPerToken(token: string): { stand: Stand; projekt: Projekt; veroeffentlicht: Website | null } {
    const z = this.#db.prepare('SELECT * FROM stand WHERE token = ?').get(token) as Zeile | undefined;
    if (!z) throw new NichtGefunden('Dieser Prüf-Link ist nicht gültig.');
    const stand = alsStand(z);
    const projekt = alsProjekt(this.#db.prepare('SELECT * FROM projekt WHERE id = ?').get(stand.projektId) as Zeile);
    return { stand, projekt, veroeffentlicht: this.#veroeffentlichteWebsite(projekt.id) };
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
        this.#db
          .prepare(
            `INSERT INTO veroeffentlichung (projekt_id, agentur_id, website, stand_id, veroeffentlicht_am) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (projekt_id) DO UPDATE SET website = excluded.website, stand_id = excluded.stand_id, veroeffentlicht_am = excluded.veroeffentlicht_am`,
          )
          .run(projekt.id, projekt.agenturId, JSON.stringify(stand.inhalt), stand.id, zeit);
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

  bildZumStand(token: string, mediumId: string): { medium: Medium; daten: Buffer } | null {
    const { stand } = this.standPerToken(token);
    return this.#bildAusWebsite(stand.projektId, stand.inhalt, mediumId);
  }

  // --- Veröffentlichte Website ----------------------------------------------

  #veroeffentlichteWebsite(projektId: string): Website | null {
    const z = this.#db.prepare('SELECT website FROM veroeffentlichung WHERE projekt_id = ?').get(projektId) as Zeile | undefined;
    return z ? websiteAus(String(z.website), projektId) : null;
  }

  veroeffentlicht(projektSlug: string): { projekt: Projekt; website: Website } | null {
    const z = this.#db.prepare('SELECT * FROM projekt WHERE slug = ?').get(projektSlug) as Zeile | undefined;
    if (!z) return null;
    const projekt = alsProjekt(z);
    const website = this.#veroeffentlichteWebsite(projekt.id);
    return website && website.seiten.length ? { projekt, website } : null;
  }

  bildVeroeffentlicht(projektSlug: string, mediumId: string): { medium: Medium; daten: Buffer } | null {
    const online = this.veroeffentlicht(projektSlug);
    return online ? this.#bildAusWebsite(online.projekt.id, online.website, mediumId) : null;
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
