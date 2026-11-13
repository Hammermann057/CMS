// Die Regelwerk-Seite eines Projekts: Farben, Schriften, Maße, mit Vorschau,
// Hinweisen zum Kontrast und Ein- und Ausgabe als Design-Tokens.
import { neuerBaustein } from '../kern/bausteine.ts';
import { kontrast, kontrastText } from '../kern/farbe.ts';
import { hinweiseRegelwerk } from '../kern/pruefer.ts';
import { FELDER, schriftCss, SCHRIFT_IDS, SCHRIFTEN } from '../kern/regelwerk.ts';
import type { Feld } from '../kern/regelwerk.ts';
import { darf } from '../kern/rechte.ts';
import { esc, renderSeitenInhalt } from '../renderer/seite.ts';
import type { Baustein, Hinweis, Person, Projekt, Regelwerk } from '../kern/typen.ts';
import { anzahl } from './format.ts';

const VARIABLE: Record<keyof Regelwerk, string> = {
  hintergrund: '--r-hintergrund',
  text: '--r-text',
  leise: '--r-leise',
  akzent: '--r-akzent',
  akzentText: '--r-akzent-text',
  schriftText: '--r-schrift-text',
  schriftUeberschrift: '--r-schrift-ueberschrift',
  groesseText: '--r-groesse-text',
  groesseUeberschrift: '--r-groesse-ueberschrift',
  radius: '--r-radius',
  abstand: '--r-abstand',
  breite: '--r-breite',
};

/** Welche Farbe gegen welche geprüft wird, und wie viel sie braucht. */
const KONTRASTE: Partial<Record<keyof Regelwerk, { gegen: keyof Regelwerk; ziel: number; text: string }>> = {
  text: { gegen: 'hintergrund', ziel: 4.5, text: 'zum Hintergrund' },
  leise: { gegen: 'hintergrund', ziel: 4.5, text: 'zum Hintergrund' },
  akzentText: { gegen: 'akzent', ziel: 4.5, text: 'zum Akzent' },
  akzent: { gegen: 'hintergrund', ziel: 3, text: 'zum Hintergrund' },
};

/** Eine Musterseite, auf der jede Einstellung sichtbar wird. */
function musterseite(): Baustein[] {
  const b = (typ: Baustein['typ'], felder: Record<string, unknown>): Baustein => ({ ...neuerBaustein(typ), ...felder }) as Baustein;
  return [
    b('kopf', { ueberschrift: 'Überschrift der Seite', unterzeile: 'Die Unterzeile steht in der leisen Farbe.' }),
    b('text', { text: 'So sieht Fließtext aus. Ein Absatz mit ein paar Sätzen zeigt Schrift, Größe und Zeilenabstand.\n\nEin zweiter Absatz zeigt den Abstand dazwischen.' }),
    b('zwischenueberschrift', { text: 'Eine Zwischenüberschrift' }),
    b('zitat', { text: 'Der beste Kaffee am Hafen.', quelle: 'Anna K., Stammgast' }),
    b('knopf', { beschriftung: 'Tisch reservieren', ziel: '#' }),
  ];
}

function feldHtml(feld: Feld, r: Regelwerk): string {
  const id = `r-${feld.schluessel}`;
  const wert = r[feld.schluessel];
  const hilfe = feld.hilfe ? `<small id="${id}-hilfe">${esc(feld.hilfe)}</small>` : '';
  const beschrieben = feld.hilfe ? ` aria-describedby="${id}-hilfe"` : '';
  if (feld.art === 'farbe') {
    const pruefung = KONTRASTE[feld.schluessel];
    const k = pruefung ? kontrast(String(wert), String(r[pruefung.gegen])) : 0;
    const kontrastZeile = pruefung
      ? `<small data-kontrast="${feld.schluessel}:${pruefung.gegen}:${pruefung.ziel}" class="${k >= pruefung.ziel ? 'reicht' : 'reicht-nicht'}">Kontrast ${pruefung.text}: <span>${kontrastText(k)}</span>, nötig ${String(pruefung.ziel).replace('.', ',')} : 1</small>`
      : '';
    return `<label for="${id}">${esc(feld.name)}</label>
<div class="farbwahl"><input type="color" value="${esc(wert)}" data-farbe-fuer="${feld.schluessel}" aria-label="Farbwähler: ${esc(feld.name)}" tabindex="-1">
<input id="${id}" name="${feld.schluessel}" value="${esc(wert)}" maxlength="7" required pattern="#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?" data-art="farbe" data-variable="${VARIABLE[feld.schluessel]}"${beschrieben}></div>
${hilfe}${kontrastZeile}`;
  }
  if (feld.art === 'schrift') {
    return `<label for="${id}">${esc(feld.name)}</label>
<select id="${id}" name="${feld.schluessel}" data-variable="${VARIABLE[feld.schluessel]}"${beschrieben}>${SCHRIFT_IDS.map(
      (s) => `<option value="${s}" data-stapel="${esc(schriftCss(s))}"${s === wert ? ' selected' : ''}>${esc(SCHRIFTEN[s].name)}</option>`,
    ).join('')}</select>${hilfe}`;
  }
  return `<label for="${id}">${esc(feld.name)}</label>
<div class="zahl-mit-einheit"><input id="${id}" name="${feld.schluessel}" type="number" value="${esc(wert)}" min="${feld.min}" max="${feld.max}" step="1" required data-variable="${VARIABLE[feld.schluessel]}" data-einheit="px"${beschrieben}><span>px</span></div>${hilfe}`;
}

function hinweiseMitLoesung(liste: readonly Hinweis[], projekt: Projekt, darfAendern: boolean): string {
  if (!liste.length) return '<p class="hinweis-zahl ok">Kontraste und Größen passen.</p>';
  return `<p class="hinweis-zahl">${anzahl(liste.length, 'Hinweis', 'Hinweise')} zum Regelwerk</p><ul class="hinweise">${liste
    .map((h) => {
      const knopf =
        darfAendern && h.loesung
          ? `<form method="post" action="/projekte/${esc(projekt.id)}/regelwerk/vorschlag"><input type="hidden" name="feld" value="${esc(h.loesung.feld)}"><input type="hidden" name="wert" value="${esc(h.loesung.wert)}"><button type="submit" class="zweit">Vorschlag übernehmen: ${esc(h.loesung.wert)}</button></form>`
          : '';
      return `<li><strong>${esc(h.regel)}</strong><span><b>Folge:</b> ${esc(h.folge)}</span><span><b>Grund:</b> ${esc(h.grund)}</span><span><b>Ausweg:</b> ${esc(h.ausweg)}</span>${knopf}</li>`;
    })
    .join('')}</ul>`;
}

export function seiteRegelwerk(
  person: Person,
  projekt: Projekt,
  r: Regelwerk,
  meldung?: { uebernommen: string[]; ignoriert: string[] },
): string {
  const darfAendern = darf(person, 'regelwerk.bearbeiten', projekt);
  const gruppen: [string, Feld['art']][] = [
    ['Farben', 'farbe'],
    ['Schriften', 'schrift'],
    ['Größen und Abstände', 'px'],
  ];
  const felder = gruppen
    .map(([titel, art]) => `<fieldset${darfAendern ? '' : ' disabled'}><legend>${titel}</legend><div class="felder">${FELDER.filter((f) => f.art === art).map((f) => feldHtml(f, r)).join('')}</div></fieldset>`)
    .join('');
  const meldungHtml = meldung
    ? `<section class="meldung" role="status"><h2>Tokens eingelesen</h2>
<p>${meldung.uebernommen.length ? `Übernommen: ${esc(meldung.uebernommen.join(', '))}.` : 'Nichts übernommen.'}</p>
${meldung.ignoriert.length ? `<p>Nicht übernommen:</p><ul>${meldung.ignoriert.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}</section>`
    : '';
  const tokens = `<section><h2>Als Design-Tokens</h2>
<p>Das Regelwerk lässt sich als Datei im offenen Format der W3C Design Tokens Community Group (Fassung 2025.10) ausgeben und wieder einlesen, etwa um Farben aus einem Design-Werkzeug zu übernehmen.</p>
<p><a href="/projekte/${esc(projekt.id)}/regelwerk.tokens.json" download>Regelwerk als .tokens.json herunterladen</a></p>
${
  darfAendern
    ? `<form method="post" action="/projekte/${esc(projekt.id)}/regelwerk/tokens" class="felder">
<label for="tokens">Tokens einfügen</label>
<textarea id="tokens" name="json" rows="6" maxlength="200000" required aria-describedby="tokens-hilfe" spellcheck="false"></textarea>
<small id="tokens-hilfe">JSON mit Gruppen wie farbe.akzent oder groesse.text. Was nicht passt, wird mit Grund genannt.</small>
<button type="submit" class="zweit">Einlesen</button>
</form>`
    : ''
}</section>`;

  return `<p class="pfad"><a href="/">Projekte</a> › <a href="/projekte/${esc(projekt.id)}">${esc(projekt.name)}</a></p>
<h1>Regelwerk</h1>
<p class="unterzeile">Farben, Schriften und Abstände der Website. Änderungen gehen wie Seiten erst mit dem nächsten freigegebenen Stand online.</p>
${meldungHtml}
${hinweiseMitLoesung(hinweiseRegelwerk(r), projekt, darfAendern)}
<div class="editor">
<form method="post" action="/projekte/${esc(projekt.id)}/regelwerk" class="editor-formular regelwerk-formular" data-editor data-regelwerk-form>
${felder}
${darfAendern ? '<div class="speicherleiste"><button type="submit">Speichern</button><span>Die Vorschau zeigt Änderungen schon vor dem Speichern.</span></div>' : '<p class="leer">Das Regelwerk legt die Agentur fest.</p>'}
</form>
<aside class="editor-vorschau" aria-labelledby="vorschau-titel"><h2 id="vorschau-titel">Vorschau</h2>
<p class="leer">Eine Musterseite mit allen Arten von Text.</p>
<div class="vorschau" data-regelwerk-vorschau>${renderSeitenInhalt({ bausteine: musterseite() }, () => '')}</div></aside>
</div>
${tokens}`;
}

/** Kurzfassung für die Projektseite. */
export function teilRegelwerk(person: Person, projekt: Projekt, r: Regelwerk): string {
  const hinweise = hinweiseRegelwerk(r);
  return `<section id="regelwerk"><h2>Regelwerk</h2>
<p>${esc(SCHRIFTEN[r.schriftText].name)}${r.schriftUeberschrift !== r.schriftText ? ` und ${esc(SCHRIFTEN[r.schriftUeberschrift].name)}` : ''}, Text ${r.groesseText} px, Akzent ${esc(r.akzent)}${
    hinweise.length ? ` · <span class="hinweis-zahl">${anzahl(hinweise.length, 'Hinweis', 'Hinweise')}</span>` : ''
  }</p>
<p><a href="/projekte/${esc(projekt.id)}/regelwerk">${darf(person, 'regelwerk.bearbeiten', projekt) ? 'Regelwerk bearbeiten' : 'Regelwerk ansehen'}</a></p></section>`;
}
