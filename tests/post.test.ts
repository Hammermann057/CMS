// Der Mailversand gegen einen nachgebauten Mailserver: ohne Verschlüsselung,
// mit TLS von Anfang an (Port 465) und mit STARTTLS (Port 587).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer as tcpServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { createServer as tlsServer, TLSSocket } from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { baueMail, SmtpPost } from '../src/post.ts';
import type { Verschluesselung } from '../src/post.ts';

interface Mitschnitt {
  befehle: string[];
  mails: string[];
}

/** Ein Mailserver, der nur so viel kann, wie der Versand braucht. */
function nachgebauterServer(art: Verschluesselung, schluessel?: { key: string; cert: string }, authAntwort = '235 ok'): Promise<{ server: Server; port: number; mitschnitt: Mitschnitt }> {
  const mitschnitt: Mitschnitt = { befehle: [], mails: [] };
  const bedienen = (start: Socket): void => {
    let socket: Socket = start;
    let puffer = '';
    let inDaten = false;
    const lesen = (teil: Buffer): void => {
      puffer += teil.toString('utf8');
      while (true) {
        if (inDaten) {
          const ende = puffer.indexOf('\r\n.\r\n');
          if (ende < 0) return;
          mitschnitt.mails.push(puffer.slice(0, ende));
          puffer = puffer.slice(ende + 5);
          inDaten = false;
          socket.write('250 angenommen\r\n');
          continue;
        }
        const zeilenende = puffer.indexOf('\r\n');
        if (zeilenende < 0) return;
        const zeile = puffer.slice(0, zeilenende);
        puffer = puffer.slice(zeilenende + 2);
        mitschnitt.befehle.push(zeile);
        if (zeile.startsWith('EHLO')) {
          const tls = socket instanceof TLSSocket;
          socket.write(`250-test\r\n${art === 'starttls' && !tls ? '250-STARTTLS\r\n' : ''}250 AUTH PLAIN\r\n`);
        } else if (zeile === 'STARTTLS') {
          socket.write('220 los\r\n');
          socket.removeAllListeners('data');
          socket = new TLSSocket(socket, { isServer: true, ...schluessel });
          socket.on('data', lesen);
        } else if (zeile.startsWith('AUTH')) socket.write(`${authAntwort}\r\n`);
        else if (zeile === 'DATA') {
          socket.write('354 los\r\n');
          inDaten = true;
        } else if (zeile === 'QUIT') socket.end('221 tschüss\r\n');
        else socket.write('250 ok\r\n');
      }
    };
    socket.on('data', lesen);
    socket.on('error', () => undefined);
    socket.write('220 nachgebaut ESMTP\r\n');
  };
  const server = art === 'tls' ? tlsServer({ ...schluessel }, bedienen) : tcpServer(bedienen);
  return new Promise((fertig) => {
    server.listen(0, '127.0.0.1', () => fertig({ server, port: (server.address() as AddressInfo).port, mitschnitt }));
  });
}

function textAus(mail: string): string {
  const [, inhalt] = mail.split('\r\n\r\n');
  return Buffer.from(inhalt.replace(/\r\n/g, ''), 'base64').toString('utf8');
}

const NACHRICHT = { an: 'mo@agentur.test', betreff: 'Dein Anmelde-Link für das Agenturtool', text: 'Hallo Mö,\n.\nhier ist dein Link.' };

test('Eine Mail kodiert Umlaute im Betreff und Inhalt, Punkte am Zeilenanfang stören nicht', () => {
  const mail = baueMail('Agentür <noreply@agentur.test>', NACHRICHT, new Date('2026-11-12T10:00:00Z'));
  assert.match(mail, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <noreply@agentur.test>\r\n/);
  assert.ok(mail.includes('Subject: =?UTF-8?B?'));
  assert.ok(mail.includes('Date: Thu, 12 Nov 2026 10:00:00 +0000'));
  assert.ok(mail.includes('Message-ID: <') && mail.includes('@agentur.test>'));
  assert.equal(textAus(mail), 'Hallo Mö,\r\n.\r\nhier ist dein Link.');
  assert.ok(!/\r\n\./.test(mail.split('\r\n\r\n')[1]), 'Keine Zeile beginnt mit einem Punkt');
});

test('Versand ohne Verschlüsselung an einen Mailserver auf diesem Rechner', async () => {
  const { server, port, mitschnitt } = await nachgebauterServer('keine');
  try {
    const post = new SmtpPost({ host: '127.0.0.1', port, verschluesselung: 'keine', benutzer: 'nutzer', passwort: 'geheim', absender: 'Agenturtool <noreply@agentur.test>' });
    await post.senden(NACHRICHT);
    assert.deepEqual(mitschnitt.befehle.map((b) => b.split(' ')[0]), ['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
    assert.equal(Buffer.from(mitschnitt.befehle[1].split(' ')[2], 'base64').toString(), '\u0000nutzer\u0000geheim');
    assert.equal(mitschnitt.befehle[2], 'MAIL FROM:<noreply@agentur.test>');
    assert.equal(mitschnitt.befehle[3], 'RCPT TO:<mo@agentur.test>');
    assert.ok(textAus(mitschnitt.mails[0]).includes('hier ist dein Link.'));
  } finally {
    server.close();
  }
});

test('Ohne Verschlüsselung wird nur lokal gesendet, Zeilenumbrüche in Adressen werden abgelehnt', async () => {
  assert.throws(() => new SmtpPost({ host: 'smtp.example.com', port: 25, verschluesselung: 'keine', benutzer: '', passwort: '', absender: 'a@b.de' }));
  const post = new SmtpPost({ host: '127.0.0.1', port: 1, verschluesselung: 'keine', benutzer: '', passwort: '', absender: 'a@b.de' });
  await assert.rejects(post.senden({ ...NACHRICHT, an: 'mo@agentur.test\r\nRCPT TO:<x@y.de>' }), /Zeilenumbruch/);
});

test('Eine abgelehnte Anmeldung beim Mailserver nennt den Grund, aber nie das Passwort', async () => {
  const { server, port } = await nachgebauterServer('keine', undefined, '535 falsche Zugangsdaten');
  try {
    const post = new SmtpPost({ host: '127.0.0.1', port, verschluesselung: 'keine', benutzer: 'nutzer', passwort: 'geheim', absender: 'noreply@agentur.test' });
    await assert.rejects(post.senden(NACHRICHT), (fehler: Error) => {
      assert.match(fehler.message, /535 falsche Zugangsdaten/);
      assert.ok(!fehler.message.includes(Buffer.from('\u0000nutzer\u0000geheim').toString('base64')));
      return true;
    });
  } finally {
    server.close();
  }
});

function testZertifikat(): { key: string; cert: string } | null {
  try {
    const ordner = mkdtempSync(join(tmpdir(), 'zert-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost', '-keyout', join(ordner, 'k.pem'), '-out', join(ordner, 'c.pem')], { stdio: 'ignore' });
    return { key: readFileSync(join(ordner, 'k.pem'), 'utf8'), cert: readFileSync(join(ordner, 'c.pem'), 'utf8') };
  } catch {
    return null;
  }
}

for (const art of ['tls', 'starttls'] as const) {
  test(`Versand mit ${art === 'tls' ? 'TLS von Anfang an' : 'STARTTLS'}`, async (t) => {
    const schluessel = testZertifikat();
    if (!schluessel) return t.skip('openssl fehlt, ohne Zertifikat lässt sich TLS hier nicht prüfen');
    const { server, port, mitschnitt } = await nachgebauterServer(art, schluessel);
    try {
      const post = new SmtpPost({ host: 'localhost', port, verschluesselung: art, benutzer: 'nutzer', passwort: 'geheim', absender: 'noreply@agentur.test', ca: schluessel.cert });
      await post.senden(NACHRICHT);
      const befehle = mitschnitt.befehle.map((b) => b.split(' ')[0]);
      assert.deepEqual(befehle, art === 'tls' ? ['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT'] : ['EHLO', 'STARTTLS', 'EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
      assert.ok(textAus(mitschnitt.mails[0]).includes('Hallo Mö'));
    } finally {
      server.close();
    }
  });
}

test('Ein Zertifikat, dem nicht vertraut wird, bricht den Versand ab', async (t) => {
  const schluessel = testZertifikat();
  if (!schluessel) return t.skip('openssl fehlt');
  const { server, port, mitschnitt } = await nachgebauterServer('tls', schluessel);
  try {
    const post = new SmtpPost({ host: 'localhost', port, verschluesselung: 'tls', benutzer: 'nutzer', passwort: 'geheim', absender: 'noreply@agentur.test' });
    await assert.rejects(post.senden(NACHRICHT));
    assert.ok(!mitschnitt.befehle.some((b) => b.startsWith('AUTH')), 'Das Passwort geht nicht an einen unbekannten Server');
  } finally {
    server.close();
  }
});
