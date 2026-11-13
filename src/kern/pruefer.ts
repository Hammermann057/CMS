// Regeln, die sich erklären. Jeder Hinweis sagt, was passiert, warum das zählt,
// und was man tun kann. Er sperrt nichts: Entscheiden tun Menschen.
// Später kommen die Regeln aus dem Regelwerk der Agentur (Tokens, Marke, Tonalität).
import { istLeer, BAUSTEIN_NAMEN } from './bausteine.ts';
import { kontrast, kontrastText, KONTRAST_BEDIENELEMENT, KONTRAST_TEXT, vorschlag } from './farbe.ts';
import type { Baustein, Hinweis, Regelwerk } from './typen.ts';

export const MAX_UEBERSCHRIFT = 60;
export const MAX_TEXT_OHNE_ZWISCHENTITEL = 1200;

const NICHTSSAGEND = new Set(['hier', 'hier klicken', 'klick', 'klicken', 'mehr', 'mehr erfahren', 'weiter', 'link', 'los', 'click here', 'read more', 'more']);

const altText = (bausteinId: string, anzahl?: { fehlt: number; von: number }): Hinweis => ({
  regel: 'Bildbeschreibung',
  folge: anzahl
    ? `Bei ${anzahl.fehlt} von ${anzahl.von} Bildern erfahren Menschen mit Screenreader nicht, was zu sehen ist.`
    : 'Menschen mit Screenreader erfahren nicht, was das Bild zeigt.',
  grund: 'Jedes Bild, das etwas zeigt, braucht eine kurze Beschreibung. Auch Suchmaschinen lesen sie.',
  ausweg: 'In einem Satz beschreiben, was zu sehen ist, etwa „Tresen mit Siebträgermaschine am Morgen“.',
  bausteinId,
});

export function hinweiseSeite(seite: { titel: string; bausteine: readonly Baustein[] }): Hinweis[] {
  const liste: Hinweis[] = [];
  const koepfe = seite.bausteine.filter((b) => b.typ === 'kopf' && b.ueberschrift);

  if (koepfe.length === 0) {
    liste.push({
      regel: 'Hauptüberschrift',
      folge: 'Die Seite hat keine Hauptüberschrift.',
      grund: 'Suchmaschinen und Screenreader ordnen eine Seite über ihre Hauptüberschrift ein.',
      ausweg: 'Oben einen Kopf mit Überschrift einsetzen.',
      bausteinId: null,
    });
  }

  seite.bausteine.forEach((b, i) => {
    if (istLeer(b)) {
      liste.push({
        regel: 'Leerer Baustein',
        folge: b.typ === 'knopf' && b.beschriftung ? 'Der Knopf führt nirgendwohin und erscheint deshalb nicht.' : `${BAUSTEIN_NAMEN[b.typ]} ist leer und erscheint nicht auf der Seite.`,
        grund: 'Leere Bausteine lässt die Website weg, damit keine Lücken entstehen.',
        ausweg: b.typ === 'knopf' && b.beschriftung ? 'Ein Ziel eintragen: eine Web-Adresse, eine Mail-Adresse oder tel: mit Nummer.' : 'Füllen oder entfernen.',
        bausteinId: b.id,
      });
      return;
    }
    switch (b.typ) {
      case 'kopf': {
        if (koepfe[0] && koepfe[0].id !== b.id && b.ueberschrift) {
          liste.push({
            regel: 'Eine Hauptüberschrift',
            folge: 'Die Seite hat mehr als eine Hauptüberschrift.',
            grund: 'Mit einer Hauptüberschrift bleibt klar, worum es auf der Seite geht.',
            ausweg: 'Diesen Kopf durch eine Zwischenüberschrift ersetzen.',
            bausteinId: b.id,
          });
        } else if (i > 0 && koepfe[0]?.id === b.id) {
          liste.push({
            regel: 'Kopf oben',
            folge: 'Besucher:innen sehen zuerst etwas anderes als die Hauptüberschrift.',
            grund: 'Der Kopf sagt, wo man ist. Er gehört an den Anfang.',
            ausweg: 'Den Kopf ganz nach oben schieben.',
            bausteinId: b.id,
          });
        }
        if (b.ueberschrift.length > MAX_UEBERSCHRIFT) {
          liste.push({
            regel: 'Länge der Überschrift',
            folge: `Die Überschrift hat ${b.ueberschrift.length} Zeichen und läuft auf dem Handy voraussichtlich über mehr als drei Zeilen.`,
            grund: `Unter ${MAX_UEBERSCHRIFT} Zeichen lässt sie sich auf einen Blick erfassen, und der Rest des Kopfs bleibt sichtbar.`,
            ausweg: 'Kürzen und Einzelheiten in die Unterzeile verschieben.',
            bausteinId: b.id,
          });
        }
        if (b.bildId && !b.bildAlt) liste.push(altText(b.id));
        break;
      }
      case 'bild':
        if (!b.bildAlt) liste.push(altText(b.id));
        break;
      case 'galerie': {
        const fehlt = b.bilder.filter((g) => !g.bildAlt).length;
        if (fehlt) liste.push(altText(b.id, { fehlt, von: b.bilder.length }));
        break;
      }
      case 'text':
        if (b.text.length > MAX_TEXT_OHNE_ZWISCHENTITEL) {
          liste.push({
            regel: 'Langer Text',
            folge: `Der Text ist ${b.text.length} Zeichen lang und erscheint auf dem Handy als lange Fläche ohne Halt.`,
            grund: 'Zwischenüberschriften helfen, einen Text zu überfliegen und die passende Stelle zu finden.',
            ausweg: 'Den Text teilen und eine Zwischenüberschrift dazwischensetzen.',
            bausteinId: b.id,
          });
        }
        break;
      case 'knopf':
        if (NICHTSSAGEND.has(b.beschriftung.toLowerCase().replace(/[.!…]+$/, ''))) {
          liste.push({
            regel: 'Knopf nennt das Ziel',
            folge: `Wer mit Screenreader von Link zu Link springt, hört nur „${b.beschriftung}“.`,
            grund: 'Die Beschriftung soll sagen, was passiert, auch ohne den Text drumherum.',
            ausweg: 'Zum Beispiel „Tisch reservieren“ oder „Speisekarte ansehen“.',
            bausteinId: b.id,
          });
        }
        break;
      case 'zitat':
        if (!b.quelle) {
          liste.push({
            regel: 'Quelle beim Zitat',
            folge: 'Unklar, wer das gesagt hat.',
            grund: 'Ein Zitat überzeugt erst mit Namen.',
            ausweg: 'Name und, wenn passend, Rolle oder Ort ergänzen.',
            bausteinId: b.id,
          });
        }
        break;
      case 'zwischenueberschrift':
        break;
    }
  });
  return liste;
}

/** Regeln zum Regelwerk selbst. Jeder Hinweis bringt eine Farbe mit, die genügt und dem Original am nächsten liegt. */
export function hinweiseRegelwerk(r: Regelwerk): Hinweis[] {
  const liste: Hinweis[] = [];
  const pruefe = (
    feld: 'text' | 'leise' | 'akzentText' | 'akzent',
    gegen: string,
    ziel: number,
    texte: { regel: string; was: string; grund: string },
  ): void => {
    const wert = kontrast(r[feld], gegen);
    if (wert >= ziel) return;
    const neu = vorschlag(r[feld], gegen, ziel);
    liste.push({
      regel: texte.regel,
      folge: `${texte.was} hat nur einen Kontrast von ${kontrastText(wert)}. In der Sonne auf dem Handy oder mit schwächeren Augen ist das schwer zu erkennen.`,
      grund: texte.grund,
      ausweg: `${neu} nehmen: derselbe Farbton, ${kontrastText(kontrast(neu, gegen))}.`,
      bausteinId: null,
      loesung: { feld, wert: neu },
    });
  };
  pruefe('text', r.hintergrund, KONTRAST_TEXT, {
    regel: 'Kontrast Text',
    was: 'Text auf dem Hintergrund',
    grund: 'Für Fließtext gelten mindestens 4,5 : 1 (WCAG 2.2, Stufe AA).',
  });
  pruefe('leise', r.hintergrund, KONTRAST_TEXT, {
    regel: 'Kontrast leiser Text',
    was: 'Leiser Text, etwa Bildunterschriften,',
    grund: 'Auch kleine Nebentexte brauchen 4,5 : 1 (WCAG 2.2, Stufe AA).',
  });
  // Erst die Knopffarbe, dann die Schrift darauf: So baut der zweite Vorschlag auf dem ersten auf.
  pruefe('akzent', r.hintergrund, KONTRAST_BEDIENELEMENT, {
    regel: 'Knopf vor Hintergrund',
    was: 'Der Knopf vor dem Hintergrund',
    grund: 'Bedienelemente brauchen mindestens 3 : 1 zu ihrer Umgebung, damit man sie als solche erkennt (WCAG 2.2, 1.4.11).',
  });
  pruefe('akzentText', r.akzent, KONTRAST_TEXT, {
    regel: 'Kontrast Knopf',
    was: 'Die Beschriftung auf dem Knopf',
    grund: 'Knopfbeschriftungen sind Text und brauchen 4,5 : 1 (WCAG 2.2, Stufe AA).',
  });
  if (r.groesseText < 16) {
    liste.push({
      regel: 'Textgröße',
      folge: `Fließtext mit ${r.groesseText} Pixeln ist auf dem Handy mühsam zu lesen.`,
      grund: 'Browser setzen 16 Pixel als Grundgröße. Darunter wirkt Text schnell gedrängt.',
      ausweg: 'Mindestens 16 Pixel wählen.',
      bausteinId: null,
      loesung: { feld: 'groesseText', wert: '16' },
    });
  }
  return liste;
}
