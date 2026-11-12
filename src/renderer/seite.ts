// Macht aus Bausteinen HTML. Vorschau im Editor, Prüf-Link und ausgelieferte Website
// nutzen denselben Weg, damit freigegeben wird, was später online steht.
import { istLeer, zielAus } from '../kern/bausteine.ts';
import type { Baustein, SeitenStand, Website } from '../kern/typen.ts';

export function esc(text: unknown): string {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Bilder liegen je nach Ort unter einer anderen Adresse: im Werkzeug, im Prüf-Link, online. */
export type BildUrl = (mediumId: string) => string;

function absaetze(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((absatz) => absatz.trim())
    .filter(Boolean)
    .map((absatz) => `<p>${esc(absatz).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

function sicheresZiel(ziel: string): string | null {
  try {
    return zielAus(ziel) || null;
  } catch {
    return null;
  }
}

function renderBaustein(b: Baustein, bildUrl: BildUrl, erstesBild: { offen: boolean }): string {
  const bild = (id: string, alt: string): string => {
    // Das erste Bild lädt sofort, alle weiteren erst, wenn sie in Sicht kommen.
    const laden = erstesBild.offen ? '' : ' loading="lazy"';
    erstesBild.offen = false;
    return `<img src="${esc(bildUrl(id))}" alt="${esc(alt)}"${laden}>`;
  };
  switch (b.typ) {
    case 'kopf':
      return `<header class="b-kopf">${b.bildId ? bild(b.bildId, b.bildAlt) : ''}${b.ueberschrift ? `<h1>${esc(b.ueberschrift)}</h1>` : ''}${
        b.unterzeile ? `<p class="b-unterzeile">${esc(b.unterzeile)}</p>` : ''
      }</header>`;
    case 'text':
      return `<div class="b-text">${absaetze(b.text)}</div>`;
    case 'zwischenueberschrift':
      return `<h2 class="b-zwischen">${esc(b.text)}</h2>`;
    case 'bild':
      return `<figure class="b-bild">${bild(b.bildId ?? '', b.bildAlt)}${b.unterschrift ? `<figcaption>${esc(b.unterschrift)}</figcaption>` : ''}</figure>`;
    case 'galerie':
      return `<div class="b-galerie">${b.bilder.map((g) => `<figure>${bild(g.bildId, g.bildAlt)}</figure>`).join('')}</div>`;
    case 'zitat':
      return `<figure class="b-zitat"><blockquote>${absaetze(b.text)}</blockquote>${b.quelle ? `<figcaption>${esc(b.quelle)}</figcaption>` : ''}</figure>`;
    case 'knopf': {
      const ziel = sicheresZiel(b.ziel);
      return ziel ? `<div class="b-knopf"><a href="${esc(ziel)}">${esc(b.beschriftung)}</a></div>` : '';
    }
  }
}

/** Der Inhalt einer Seite. Leere Bausteine fallen weg. `data-baustein` erlaubt der Vorschau, zum Baustein zu springen. */
export function renderSeitenInhalt(seite: Pick<SeitenStand, 'bausteine'>, bildUrl: BildUrl, mitKennung = false): string {
  const erstesBild = { offen: true };
  const teile = seite.bausteine
    .filter((b) => !istLeer(b))
    .map((b) => {
      const html = renderBaustein(b, bildUrl, erstesBild);
      return mitKennung ? `<div data-baustein="${esc(b.id)}">${html}</div>` : html;
    });
  return `<article class="seite">${teile.join('')}</article>`;
}

/** Eine Seite der veröffentlichten Website als ganzes Dokument, mit Navigation, wenn es mehrere Seiten gibt. */
export function renderWebsite(
  website: Website,
  seite: SeitenStand,
  optionen: { projektName: string; bildUrl: BildUrl; seitenUrl: (s: SeitenStand, index: number) => string },
): string {
  const kopf = seite.bausteine.find((b) => b.typ === 'kopf' && b.ueberschrift);
  const ueberschrift = kopf?.typ === 'kopf' ? kopf.ueberschrift : seite.titel;
  const titel = website.seiten[0]?.id === seite.id ? optionen.projektName : `${ueberschrift} · ${optionen.projektName}`;
  const navigation =
    website.seiten.length > 1
      ? `<nav class="website-nav" aria-label="Seiten"><ul>${website.seiten
          .map(
            (s, i) =>
              `<li><a href="${esc(optionen.seitenUrl(s, i))}"${s.id === seite.id ? ' aria-current="page"' : ''}>${esc(s.titel)}</a></li>`,
          )
          .join('')}</ul></nav>`
      : '';
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titel)}</title>
<link rel="stylesheet" href="/seite.css">
</head>
<body class="oeffentlich">
${navigation}
<main>${renderSeitenInhalt(seite, optionen.bildUrl)}</main>
</body>
</html>`;
}
