import type { Inhalt } from '../kern/typen.ts';

export function esc(text: unknown): string {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Der Inhalt als HTML-Ausschnitt, für Vorschau, Prüf-Link und Website gleich. */
export function renderAusschnitt(inhalt: Inhalt, bildUrl: string | null): string {
  const absaetze = inhalt.text
    .split(/\n{2,}/)
    .map((absatz) => absatz.trim())
    .filter(Boolean)
    .map((absatz) => `<p>${esc(absatz).replaceAll('\n', '<br>')}</p>`)
    .join('');
  const bild = inhalt.bildId && bildUrl ? `<img src="${esc(bildUrl)}" alt="${esc(inhalt.bildAlt)}">` : '';
  return `<article class="seite">${bild}<h1>${esc(inhalt.ueberschrift)}</h1>${absaetze}</article>`;
}

/** Die veröffentlichte Seite als ganzes Dokument. */
export function renderSeite(inhalt: Inhalt, bildUrl: string | null): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(inhalt.ueberschrift)}</title>
<link rel="stylesheet" href="/seite.css">
</head>
<body class="oeffentlich">
<main>${renderAusschnitt(inhalt, bildUrl)}</main>
</body>
</html>`;
}
