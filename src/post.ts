// Mailversand. Selbst geschrieben statt einer Bibliothek, weil für Anmelde-Links
// ein kleiner Teil von SMTP reicht: verbinden, anmelden, eine Textmail abgeben.
import { connect as tcpVerbinden } from 'node:net';
import type { Socket } from 'node:net';
import { connect as tlsVerbinden } from 'node:tls';
import type { TLSSocket } from 'node:tls';
import { randomUUID } from 'node:crypto';

export interface Nachricht {
  an: string;
  betreff: string;
  text: string;
}

export interface Post {
  senden(nachricht: Nachricht): Promise<void>;
}

/** Für die Entwicklung: Die Mail landet im Protokoll des Servers statt im Postfach. */
export class Protokollpost implements Post {
  async senden(n: Nachricht): Promise<void> {
    console.log(`\n--- Mail an ${n.an} ---\nBetreff: ${n.betreff}\n\n${n.text}\n--- Ende der Mail ---\n`);
  }
}

/** Für Tests: sammelt die Mails. */
export class Sammelpost implements Post {
  gesendet: Nachricht[] = [];
  async senden(n: Nachricht): Promise<void> {
    this.gesendet.push(n);
  }
}

export type Verschluesselung = 'tls' | 'starttls' | 'keine';

export interface SmtpEinstellungen {
  host: string;
  /** 465 für TLS von Anfang an, 587 für STARTTLS. */
  port: number;
  verschluesselung: Verschluesselung;
  benutzer: string;
  passwort: string;
  /** Absender, zum Beispiel `Agenturtool <noreply@agentur.de>`. */
  absender: string;
  /** Eigene Zertifizierungsstelle, etwa für einen Mailserver im Büro. */
  ca?: string;
}

const ZEILENENDE = '\r\n';

function ohneZeilenumbruch(wert: string, feld: string): string {
  if (/[\r\n]/.test(wert)) throw new Error(`${feld} darf keinen Zeilenumbruch enthalten.`);
  return wert;
}

/** Nur die Adresse aus `Name <adresse>`. */
function adresseAus(absender: string): string {
  return /<([^>]+)>/.exec(absender)?.[1] ?? absender.trim();
}

/** Kopfzeilen mit Umlauten werden nach RFC 2047 kodiert. */
function kodiereKopf(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function kodiereAbsender(absender: string): string {
  const treffer = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(absender);
  if (!treffer || !treffer[1]) return absender.trim();
  const name = treffer[1].replace(/^"|"$/g, '');
  return `${/^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, '')}"` : kodiereKopf(name)} <${treffer[2]}>`;
}

/** Baut die Mail als Text. Der Inhalt geht base64-kodiert, damit Umlaute und Punkte am Zeilenanfang nichts kaputtmachen. */
export function baueMail(absender: string, n: Nachricht, datum = new Date()): string {
  const domain = adresseAus(absender).split('@')[1] ?? 'agenturtool.local';
  const inhalt = Buffer.from(n.text.replace(/\r?\n/g, ZEILENENDE), 'utf8').toString('base64').replace(/.{76}/g, `$&${ZEILENENDE}`);
  return [
    `From: ${kodiereAbsender(absender)}`,
    `To: <${n.an}>`,
    `Subject: ${kodiereKopf(n.betreff)}`,
    `Date: ${datum.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    inhalt,
  ].join(ZEILENENDE);
}

/** Liest Antworten des Servers. Eine Antwort endet mit einer Zeile „250 …“ (Leerzeichen nach der Zahl). */
class Leser {
  #puffer = '';
  #wartend: ((zeilen: string) => void) | null = null;
  #fehler: Error | null = null;
  #fehlerMelden: ((f: Error) => void) | null = null;

  verbinde(socket: Socket | TLSSocket): void {
    // Kein setEncoding: Bei STARTTLS übernimmt TLS denselben Socket und braucht die rohen Bytes.
    socket.on('data', (teil: Buffer) => {
      this.#puffer += teil.toString('utf8');
      this.#pruefe();
    });
    socket.on('error', (f: Error) => this.#scheitern(f));
    socket.on('close', () => this.#scheitern(new Error('Der Mailserver hat die Verbindung beendet.')));
  }

  #scheitern(f: Error): void {
    this.#fehler ??= f;
    this.#fehlerMelden?.(f);
  }

  #pruefe(): void {
    if (!this.#wartend) return;
    const zeilen = this.#puffer.split(ZEILENENDE);
    for (let i = 0; i < zeilen.length - 1; i++) {
      if (/^\d{3}(?: |$)/.test(zeilen[i])) {
        const antwort = zeilen.slice(0, i + 1).join('\n');
        this.#puffer = zeilen.slice(i + 1).join(ZEILENENDE);
        const fertig = this.#wartend;
        this.#wartend = null;
        fertig(antwort);
        return;
      }
    }
  }

  antwort(): Promise<string> {
    if (this.#fehler) return Promise.reject(this.#fehler);
    return new Promise((fertig, scheitern) => {
      this.#wartend = fertig;
      this.#fehlerMelden = scheitern;
      this.#pruefe();
    });
  }
}

export class SmtpPost implements Post {
  #e: SmtpEinstellungen;

  constructor(einstellungen: SmtpEinstellungen) {
    if (einstellungen.verschluesselung === 'keine' && !['127.0.0.1', 'localhost', '::1'].includes(einstellungen.host)) {
      throw new Error('Ohne Verschlüsselung wird nur an einen Mailserver auf diesem Rechner gesendet.');
    }
    this.#e = einstellungen;
  }

  async senden(n: Nachricht): Promise<void> {
    ohneZeilenumbruch(n.an, 'Empfänger');
    ohneZeilenumbruch(n.betreff, 'Betreff');
    const e = this.#e;
    const leser = new Leser();
    const vorbereiten = (s: Socket | TLSSocket): void => {
      leser.verbinde(s);
      s.setTimeout(20_000, () => s.destroy(new Error('Der Mailserver antwortet nicht.')));
    };
    let socket: Socket | TLSSocket = await this.#oeffne(e.verschluesselung === 'tls');
    vorbereiten(socket);

    const befehl = async (zeile: string | null, erwartet: number[]): Promise<string> => {
      if (zeile !== null) socket.write(zeile + ZEILENENDE);
      const antwort = await leser.antwort();
      const code = Number(antwort.slice(0, 3));
      if (!erwartet.includes(code)) {
        // Das Passwort taucht nie in Fehlermeldungen auf.
        const gesendet = zeile?.startsWith('AUTH') ? 'AUTH PLAIN …' : zeile;
        throw new Error(`Mailserver lehnt ab (${gesendet ?? 'Begrüßung'}): ${antwort}`);
      }
      return antwort;
    };

    try {
      await befehl(null, [220]);
      const ich = adresseAus(e.absender).split('@')[1] ?? 'localhost';
      let faehigkeiten = await befehl(`EHLO ${ich}`, [250]);
      if (e.verschluesselung === 'starttls') {
        if (!/STARTTLS/i.test(faehigkeiten)) throw new Error('Der Mailserver bietet kein STARTTLS an.');
        await befehl('STARTTLS', [220]);
        socket.removeAllListeners('data').removeAllListeners('error').removeAllListeners('close').setTimeout(0);
        socket = await this.#oeffne(true, socket);
        vorbereiten(socket);
        faehigkeiten = await befehl(`EHLO ${ich}`, [250]);
      }
      if (e.benutzer) {
        const zugang = Buffer.from(`\u0000${e.benutzer}\u0000${e.passwort}`, 'utf8').toString('base64');
        await befehl(`AUTH PLAIN ${zugang}`, [235]);
      }
      await befehl(`MAIL FROM:<${ohneZeilenumbruch(adresseAus(e.absender), 'Absender')}>`, [250]);
      await befehl(`RCPT TO:<${n.an}>`, [250, 251]);
      await befehl('DATA', [354]);
      await befehl(`${baueMail(e.absender, n)}${ZEILENENDE}.`, [250]);
      await befehl('QUIT', [221]).catch(() => undefined);
    } finally {
      socket.destroy();
    }
  }

  #oeffne(mitTls: boolean, bestehend?: Socket): Promise<Socket | TLSSocket> {
    const e = this.#e;
    return new Promise((fertig, scheitern) => {
      if (!mitTls) {
        const s = tcpVerbinden({ host: e.host, port: e.port }, () => fertig(s));
        s.once('error', scheitern);
        return;
      }
      const s = tlsVerbinden(
        { host: e.host, port: e.port, servername: e.host, socket: bestehend, ca: e.ca, minVersion: 'TLSv1.2' },
        () => fertig(s),
      );
      s.once('error', scheitern);
    });
  }
}

/** Liest die Einstellungen aus Umgebungsvariablen. Ohne `SMTP_HOST` gibt es keinen Versand. */
export function smtpAusUmgebung(umgebung: NodeJS.ProcessEnv): SmtpPost | null {
  if (!umgebung.SMTP_HOST) return null;
  const port = Number(umgebung.SMTP_PORT ?? 465);
  const verschluesselung = (umgebung.SMTP_VERSCHLUESSELUNG ?? (port === 465 ? 'tls' : 'starttls')) as Verschluesselung;
  if (!['tls', 'starttls', 'keine'].includes(verschluesselung)) throw new Error('SMTP_VERSCHLUESSELUNG ist tls, starttls oder keine.');
  if (!umgebung.SMTP_ABSENDER) throw new Error('SMTP_ABSENDER fehlt, zum Beispiel "Agenturtool <noreply@agentur.de>".');
  return new SmtpPost({
    host: umgebung.SMTP_HOST,
    port,
    verschluesselung,
    benutzer: umgebung.SMTP_BENUTZER ?? '',
    passwort: umgebung.SMTP_PASSWORT ?? '',
    absender: umgebung.SMTP_ABSENDER,
  });
}
