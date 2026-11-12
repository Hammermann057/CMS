// Seiten im Projekt, der Editor aus Bausteinen und der Prüf-Link.
// Ohne JavaScript benutzbar: Ein Formular trägt alle Bausteine, jeder Knopf speichert mit
// und führt danach seine Aktion aus. So geht beim Verschieben nichts Getipptes verloren.
import { BAUSTEIN_NAMEN, BAUSTEIN_TYPEN, gleich, neuerBaustein, verschiebe } from '../kern/bausteine.ts';
import { hinweiseSeite } from '../kern/pruefer.ts';
import { darf } from '../kern/rechte.ts';
import { esc, renderSeitenInhalt } from '../renderer/seite.ts';
import type { BildUrl } from '../renderer/seite.ts';
import type { Baustein, BausteinTyp, Hinweis, Medium, Person, Projekt, Seite, SeitenStand, Stand, Website } from '../kern/typen.ts';
import { anzahl, zeit } from './format.ts';

const BAUSTEIN_ERKLAERUNG: Record<BausteinTyp, string> = {
  kopf: 'Hauptüberschrift oben auf der Seite, mit Unterzeile und Bild',
  text: 'Absätze. Eine Leerzeile beginnt einen neuen Absatz.',
  zwischenueberschrift: 'Gliedert längere Seiten',
  bild: 'Ein Bild mit Beschreibung und Bildunterschrift',
  galerie: 'Mehrere Bilder im Raster',
  zitat: 'Eine Stimme von Kund:innen oder Gästen, mit Quelle',
  knopf: 'Führt zu einer Adresse, einer Mail oder einer Telefonnummer',
};

// --- Hinweise -------------------------------------------------------------------

export function teilHinweise(liste: readonly Hinweis[]): string {
  if (!liste.length) return '';
  return `<ul class="hinweise">${liste
    .map(
      (h) => `<li><strong>${esc(h.regel)}</strong><span><b>Folge:</b> ${esc(h.folge)}</span><span><b>Grund:</b> ${esc(h.grund)}</span><span><b>Ausweg:</b> ${esc(h.ausweg)}</span></li>`,
    )
    .join('')}</ul>`;
}

// --- Seitenliste im Projekt ---------------------------------------------------

export function teilSeiten(person: Person, projekt: Projekt, seiten: readonly Seite[]): string {
  const aufbau = darf(person, 'seite.aufbau', projekt);
  const liste = seiten.length
    ? `<ol class="seitenliste">${seiten
        .map((s, i) => {
          const hinweise = hinweiseSeite(s).length;
          const knoepfe = aufbau
            ? `<div class="knoepfe-klein">
<form method="post" action="/projekte/${esc(projekt.id)}/seiten/${esc(s.id)}/verschieben"><input type="hidden" name="richtung" value="hoch"><button type="submit" class="leise"${i === 0 ? ' disabled' : ''}>Nach oben<span class="nur-vorlesen"> verschieben: ${esc(s.titel)}</span></button></form>
<form method="post" action="/projekte/${esc(projekt.id)}/seiten/${esc(s.id)}/verschieben"><input type="hidden" name="richtung" value="runter"><button type="submit" class="leise"${i === seiten.length - 1 ? ' disabled' : ''}>Nach unten<span class="nur-vorlesen"> verschieben: ${esc(s.titel)}</span></button></form>
</div>`
            : '';
          return `<li><div><a href="/projekte/${esc(projekt.id)}/seiten/${esc(s.id)}"><strong>${esc(s.titel)}</strong></a>
<small>${i === 0 ? 'Startseite · ' : ''}${anzahl(s.bausteine.length, 'Baustein', 'Bausteine')}${hinweise ? ` · ${anzahl(hinweise, 'Hinweis', 'Hinweise')}` : ''} · zuletzt ${esc(s.geaendertVon)}, ${zeit(s.geaendertAm)}</small></div>${knoepfe}</li>`;
        })
        .join('')}</ol>`
    : `<p class="leer">${aufbau ? 'Noch keine Seite. Leg unten die erste an, sie wird die Startseite.' : 'Die Agentur hat noch keine Seite angelegt.'}</p>`;
  const neu = aufbau
    ? `<form method="post" action="/projekte/${esc(projekt.id)}/seiten" class="felder reihe">
<label for="seitentitel">Neue Seite</label>
<div class="eingabe-mit-knopf"><input id="seitentitel" name="titel" required maxlength="80" placeholder="zum Beispiel Speisekarte"><button type="submit">Seite anlegen</button></div>
</form>`
    : '';
  return `<section id="seiten"><h2>Seiten</h2>${liste}${neu}</section>`;
}

// --- Editor ---------------------------------------------------------------------

const feld = (id: string, name: string, beschriftung: string, wert: string, optionen: { max: number; zeilen?: number; platzhalter?: string; hilfe?: string }): string => {
  const kennung = `${id}-${name}`;
  const hilfe = optionen.hilfe ? `<small id="${kennung}-hilfe">${esc(optionen.hilfe)}</small>` : '';
  const beschrieben = optionen.hilfe ? ` aria-describedby="${kennung}-hilfe"` : '';
  const platzhalter = optionen.platzhalter ? ` placeholder="${esc(optionen.platzhalter)}"` : '';
  const eingabe = optionen.zeilen
    ? `<textarea id="${kennung}" name="${esc(id)}.${name}" rows="${optionen.zeilen}" maxlength="${optionen.max}"${platzhalter}${beschrieben}>${esc(wert)}</textarea>`
    : `<input id="${kennung}" name="${esc(id)}.${name}" value="${esc(wert)}" maxlength="${optionen.max}"${platzhalter}${beschrieben}>`;
  return `<label for="${kennung}">${esc(beschriftung)}</label>${eingabe}${hilfe}`;
};

function bildWahl(id: string, name: string, gewaehlt: string | null, bilder: readonly Medium[], leer = 'Kein Bild'): string {
  const kennung = `${id}-${name}`;
  const vorschau = gewaehlt ? `<img class="mini" src="/medien/${esc(gewaehlt)}" alt="">` : '';
  return `<label for="${kennung}">Bild</label><div class="bildwahl">${vorschau}<select id="${kennung}" name="${esc(id)}.${name}"><option value="">${esc(leer)}</option>${bilder
    .map((m) => `<option value="${esc(m.id)}"${m.id === gewaehlt ? ' selected' : ''}>${esc(m.dateiname)}</option>`)
    .join('')}</select></div>`;
}

const BESCHREIBUNG_HILFE = 'Ein Satz, was zu sehen ist. Hilft Menschen mit Screenreader und Suchmaschinen.';

function felderFuer(b: Baustein, bilder: readonly Medium[]): string {
  switch (b.typ) {
    case 'kopf':
      return (
        feld(b.id, 'ueberschrift', 'Überschrift', b.ueberschrift, { max: 200 }) +
        feld(b.id, 'unterzeile', 'Unterzeile', b.unterzeile, { max: 400, zeilen: 2 }) +
        bildWahl(b.id, 'bildId', b.bildId, bilder) +
        feld(b.id, 'bildAlt', 'Bildbeschreibung', b.bildAlt, { max: 300, hilfe: BESCHREIBUNG_HILFE })
      );
    case 'text':
      return feld(b.id, 'text', 'Text', b.text, { max: 20_000, zeilen: 8, hilfe: 'Eine Leerzeile beginnt einen neuen Absatz.' });
    case 'zwischenueberschrift':
      return feld(b.id, 'text', 'Zwischenüberschrift', b.text, { max: 200 });
    case 'bild':
      return (
        bildWahl(b.id, 'bildId', b.bildId, bilder) +
        feld(b.id, 'bildAlt', 'Bildbeschreibung', b.bildAlt, { max: 300, hilfe: BESCHREIBUNG_HILFE }) +
        feld(b.id, 'unterschrift', 'Bildunterschrift', b.unterschrift, { max: 400, hilfe: 'Steht sichtbar unter dem Bild. Kann leer bleiben.' })
      );
    case 'galerie': {
      const liste = b.bilder.length
        ? `<ol class="galerie-liste">${b.bilder
            .map(
              (g, n) => `<li><img class="mini" src="/medien/${esc(g.bildId)}" alt="">
<input type="hidden" name="${esc(b.id)}.galerie.bild" value="${esc(g.bildId)}">
<div><label for="${esc(b.id)}-alt-${n}">Beschreibung zu Bild ${n + 1}</label><input id="${esc(b.id)}-alt-${n}" name="${esc(b.id)}.galerie.alt" value="${esc(g.bildAlt)}" maxlength="300"></div>
<button type="submit" name="aktion" value="bildweg:${esc(b.id)}:${n}" class="leise">Entfernen<span class="nur-vorlesen"> Bild ${n + 1}</span></button></li>`,
            )
            .join('')}</ol>`
        : '<p class="leer">Noch keine Bilder in der Galerie.</p>';
      const frei = bilder.filter((m) => !b.bilder.some((g) => g.bildId === m.id));
      const dazu = frei.length
        ? `<label for="${esc(b.id)}-dazu">Bild hinzufügen</label><div class="eingabe-mit-knopf"><select id="${esc(b.id)}-dazu" name="${esc(b.id)}.dazu"><option value="">Bild wählen</option>${frei
            .map((m) => `<option value="${esc(m.id)}">${esc(m.dateiname)}</option>`)
            .join('')}</select><button type="submit" name="aktion" value="speichern" class="zweit">Hinzufügen</button></div>`
        : '';
      return liste + dazu;
    }
    case 'zitat':
      return feld(b.id, 'text', 'Zitat', b.text, { max: 2000, zeilen: 3 }) + feld(b.id, 'quelle', 'Quelle', b.quelle, { max: 200, platzhalter: 'zum Beispiel Anna K., Stammgast' });
    case 'knopf':
      return (
        feld(b.id, 'beschriftung', 'Beschriftung', b.beschriftung, { max: 80, platzhalter: 'zum Beispiel Tisch reservieren' }) +
        feld(b.id, 'ziel', 'Ziel', b.ziel, { max: 2000, platzhalter: 'www.beispiel.de, name@beispiel.de oder tel:+49…', hilfe: 'Web-Adresse, Mail-Adresse oder tel: mit Telefonnummer.' })
      );
  }
}

function bausteinKarte(b: Baustein, i: number, gesamt: number, aufbau: boolean, bilder: readonly Medium[], hinweise: readonly Hinweis[]): string {
  const name = BAUSTEIN_NAMEN[b.typ];
  const kennung = `<input type="hidden" name="baustein" value="${esc(b.id)}"><input type="hidden" name="${esc(b.id)}.typ" value="${b.typ}"><input type="hidden" name="${esc(b.id)}.gesperrt" value="${b.gesperrt ? 'ja' : 'nein'}">`;
  const bearbeitbar = aufbau || !b.gesperrt;
  const steuerung = aufbau
    ? `<div class="knoepfe-klein">
<button type="submit" name="aktion" value="hoch:${esc(b.id)}" class="leise"${i === 0 ? ' disabled' : ''}>Nach oben<span class="nur-vorlesen">: ${name}</span></button>
<button type="submit" name="aktion" value="runter:${esc(b.id)}" class="leise"${i === gesamt - 1 ? ' disabled' : ''}>Nach unten<span class="nur-vorlesen">: ${name}</span></button>
<button type="submit" name="aktion" value="${b.gesperrt ? 'entsperren' : 'sperren'}:${esc(b.id)}" class="leise">${b.gesperrt ? 'Für Kund:innen freigeben' : 'Für Kund:innen sperren'}<span class="nur-vorlesen">: ${name}</span></button>
<button type="submit" name="aktion" value="weg:${esc(b.id)}" class="leise gefahr">Entfernen<span class="nur-vorlesen">: ${name}</span></button>
</div>`
    : '';
  const marke = b.gesperrt ? `<span class="marke-sperre">${aufbau ? 'Für Kund:innen gesperrt' : 'Von der Agentur festgelegt'}</span>` : '';
  const inhalt = bearbeitbar
    ? `<div class="felder">${felderFuer(b, bilder)}</div>`
    : `<div class="vorschau klein">${renderSeitenInhalt({ bausteine: [b] }, (id) => `/medien/${id}`)}</div>`;
  return `<li class="baustein${b.gesperrt ? ' ist-gesperrt' : ''}" id="b-${esc(b.id)}">${kennung}
<div class="baustein-kopf"><h3>${name}</h3>${marke}${steuerung}</div>
${inhalt}${teilHinweise(hinweise)}</li>`;
}

export function seiteEditor(person: Person, projekt: Projekt, seite: Seite, medien: readonly Medium[], basisUrl: string): string {
  const aufbau = darf(person, 'seite.aufbau', projekt);
  const bilder = medien.filter((m) => m.typ.startsWith('image/'));
  const hinweise = hinweiseSeite(seite);
  const proBaustein = (id: string | null) => hinweise.filter((h) => h.bausteinId === id);
  const adresse = `${basisUrl}/seiten/${projekt.slug}${seite.position === 0 ? '' : `/${seite.slug}`}`;

  const titel = aufbau
    ? `<div class="felder"><label for="titel">Titel der Seite</label><input id="titel" name="titel" value="${esc(seite.titel)}" required maxlength="80" aria-describedby="titel-hilfe"><small id="titel-hilfe">Steht in der Navigation der Website.</small></div>`
    : '';
  const ueberblick = hinweise.length
    ? `<p class="hinweis-zahl">${anzahl(hinweise.length, 'Hinweis', 'Hinweise')} auf dieser Seite. Sie stehen beim jeweiligen Baustein und sperren nichts.</p>`
    : '<p class="hinweis-zahl ok">Keine Hinweise auf dieser Seite.</p>';
  const neu = aufbau
    ? `<div class="neu-baustein"><label for="neuTyp">Baustein hinzufügen</label>
<div class="eingabe-mit-knopf"><select id="neuTyp" name="neuTyp">${BAUSTEIN_TYPEN.map((t) => `<option value="${t}">${BAUSTEIN_NAMEN[t]}: ${esc(BAUSTEIN_ERKLAERUNG[t])}</option>`).join('')}</select>
<button type="submit" name="aktion" value="neu" class="zweit">Hinzufügen</button></div></div>`
    : '';
  const bilderHinweis = bilder.length
    ? ''
    : `<p class="leer">Bilder kommen aus dem Material des Projekts. <a href="/projekte/${esc(projekt.id)}#material">Material hochladen</a></p>`;
  const loeschen = aufbau
    ? `<section class="gefahrenzone"><h2>Seite löschen</h2>
<form method="post" action="/projekte/${esc(projekt.id)}/seiten/${esc(seite.id)}/loeschen" class="felder">
<label class="haken"><input type="checkbox" name="sicher" value="ja" required> Ja, „${esc(seite.titel)}“ löschen</label>
<small>Was online ist, bleibt online, bis ein neuer Stand freigegeben wird.</small>
<button type="submit" class="zweit">Seite löschen</button>
</form></section>`
    : '';

  return `<p class="pfad"><a href="/">Projekte</a> › <a href="/projekte/${esc(projekt.id)}#seiten">${esc(projekt.name)}</a></p>
<h1>${esc(seite.titel)}</h1>
<p class="unterzeile">Nach der Freigabe unter <code>${esc(adresse)}</code></p>
<div class="editor">
<form method="post" action="/projekte/${esc(projekt.id)}/seiten/${esc(seite.id)}" class="editor-formular" data-editor>
<button type="submit" name="aktion" value="speichern" class="nur-vorlesen" tabindex="-1" aria-hidden="true">Speichern</button>
${titel}${ueberblick}${teilHinweise(proBaustein(null))}${bilderHinweis}
<ol class="bausteine">${seite.bausteine.map((b, i) => bausteinKarte(b, i, seite.bausteine.length, aufbau, bilder, proBaustein(b.id))).join('')}</ol>
${neu}
<div class="speicherleiste"><button type="submit" name="aktion" value="speichern">Speichern</button>
<span>Zuletzt gespeichert von ${esc(seite.geaendertVon)}, ${zeit(seite.geaendertAm)}</span></div>
</form>
<aside class="editor-vorschau" aria-labelledby="vorschau-titel"><h2 id="vorschau-titel">Vorschau</h2>
<p class="leer">So sieht die Seite nach dem Speichern aus. Leere Bausteine fehlen hier mit Absicht.</p>
<div class="vorschau" data-vorschau>${renderSeitenInhalt(seite, (id) => `/medien/${id}`, true)}</div></aside>
</div>
${loeschen}`;
}

// --- Formular lesen ------------------------------------------------------------

/** Liest Titel und Bausteine aus dem Editor-Formular. Geprüft wird im Kern. */
export function ausFormular(felder: URLSearchParams): { titel: string | undefined; bausteine: Record<string, unknown>[] } {
  const bausteine = felder.getAll('baustein').map((id) => {
    const f = (name: string): string => felder.get(`${id}.${name}`) ?? '';
    const b: Record<string, unknown> = { id, typ: f('typ'), gesperrt: f('gesperrt') === 'ja' };
    for (const name of ['ueberschrift', 'unterzeile', 'bildId', 'bildAlt', 'text', 'unterschrift', 'quelle', 'beschriftung', 'ziel']) {
      if (felder.has(`${id}.${name}`)) b[name] = f(name);
    }
    if (b.typ === 'galerie') {
      const alt = felder.getAll(`${id}.galerie.alt`);
      const bilder = felder.getAll(`${id}.galerie.bild`).map((bildId, n) => ({ bildId, bildAlt: alt[n] ?? '' }));
      const dazu = f('dazu');
      if (dazu) bilder.push({ bildId: dazu, bildAlt: '' });
      b.bilder = bilder;
    }
    return b;
  });
  return { titel: felder.get('titel') ?? undefined, bausteine };
}

/**
 * Führt die Aktion des gedrückten Knopfs auf den Bausteinen aus.
 * Gibt die Bausteine zurück und den Baustein, zu dem die Seite danach springen soll.
 */
export function wendeAktionAn(bausteine: Record<string, unknown>[], aktion: string, neuTyp: string | null): { bausteine: Record<string, unknown>[]; ziel: string | null } {
  const [art, id = '', nummer] = aktion.split(':');
  const liste = bausteine as (Record<string, unknown> & { id: string })[];
  switch (art) {
    case 'hoch':
    case 'runter':
      return { bausteine: verschiebe(liste, id, art === 'hoch' ? -1 : 1), ziel: id };
    case 'weg': {
      const i = liste.findIndex((b) => b.id === id);
      return { bausteine: liste.filter((b) => b.id !== id), ziel: liste[i + 1]?.id ?? liste[i - 1]?.id ?? null };
    }
    case 'sperren':
    case 'entsperren':
      return { bausteine: liste.map((b) => (b.id === id ? { ...b, gesperrt: art === 'sperren' } : b)), ziel: id };
    case 'bildweg':
      return {
        bausteine: liste.map((b) => (b.id === id && Array.isArray(b.bilder) ? { ...b, bilder: b.bilder.filter((_, n) => n !== Number(nummer)) } : b)),
        ziel: id,
      };
    case 'neu': {
      const typ = (BAUSTEIN_TYPEN as string[]).includes(neuTyp ?? '') ? (neuTyp as BausteinTyp) : 'text';
      const neu = neuerBaustein(typ) as unknown as Record<string, unknown> & { id: string };
      return { bausteine: [...liste, neu], ziel: neu.id };
    }
    default:
      return { bausteine: liste, ziel: null };
  }
}

// --- Prüf-Link ------------------------------------------------------------------

type Vergleich = { seite: SeitenStand; bisher: SeitenStand | null; art: 'neu' | 'geaendert' | 'gleich' };

export function vergleiche(neu: Website, online: Website | null): { seiten: Vergleich[]; entfallen: SeitenStand[] } {
  const bisher = new Map((online?.seiten ?? []).map((s) => [s.id, s]));
  const seiten = neu.seiten.map((seite): Vergleich => {
    const alt = bisher.get(seite.id) ?? null;
    if (!alt) return { seite, bisher: null, art: 'neu' };
    const gleichGeblieben = alt.titel === seite.titel && gleich(alt.bausteine, seite.bausteine);
    return { seite, bisher: alt, art: gleichGeblieben ? 'gleich' : 'geaendert' };
  });
  const ids = new Set(neu.seiten.map((s) => s.id));
  return { seiten, entfallen: (online?.seiten ?? []).filter((s) => !ids.has(s.id)) };
}

export function seitePruefen(daten: { stand: Stand; projekt: Projekt; veroeffentlicht: Website | null }, token: string): string {
  const { stand, projekt, veroeffentlicht } = daten;
  const neuBild: BildUrl = (id) => `/pruefen/${token}/bilder/${id}`;
  const altBild: BildUrl = (id) => `/seiten/${projekt.slug}/_bilder/${id}`;
  const { seiten, entfallen } = vergleiche(stand.inhalt, veroeffentlicht);
  const geaendert = seiten.filter((v) => v.art !== 'gleich');
  const gleichGeblieben = seiten.filter((v) => v.art === 'gleich');
  const ARTEN = { neu: 'Neue Seite', geaendert: 'Geändert', gleich: '' };

  const zusammenfassung = [
    geaendert.filter((v) => v.art === 'geaendert').length ? anzahl(geaendert.filter((v) => v.art === 'geaendert').length, 'Seite geändert', 'Seiten geändert') : '',
    geaendert.filter((v) => v.art === 'neu').length ? anzahl(geaendert.filter((v) => v.art === 'neu').length, 'Seite neu', 'Seiten neu') : '',
    entfallen.length ? anzahl(entfallen.length, 'Seite entfällt', 'Seiten entfallen') : '',
    gleichGeblieben.length ? anzahl(gleichGeblieben.length, 'Seite unverändert', 'Seiten unverändert') : '',
  ].filter(Boolean);

  const abschnitte = geaendert
    .map(
      (v) => `<section class="pruef-seite"><h2>${esc(v.seite.titel)} <span class="marke-neu">${ARTEN[v.art]}</span></h2>
<div class="vergleich">
<div><h3>Bisher online</h3><div class="vorschau">${v.bisher ? renderSeitenInhalt(v.bisher, altBild) : '<p class="leer">Diese Seite gibt es online noch nicht.</p>'}</div></div>
<div><h3>Neuer Stand</h3><div class="vorschau">${renderSeitenInhalt(v.seite, neuBild)}</div></div>
</div>${teilHinweise(hinweiseSeite(v.seite))}</section>`,
    )
    .join('');
  const weg = entfallen.length
    ? `<section><h2>Entfällt</h2><p>Diese Seiten sind im neuen Stand nicht mehr dabei und verschwinden nach der Freigabe von der Website:</p><ul>${entfallen
        .map((s) => `<li>${esc(s.titel)}</li>`)
        .join('')}</ul></section>`
    : '';
  const unveraendert = gleichGeblieben.length
    ? `<details class="unveraendert"><summary>${anzahl(gleichGeblieben.length, 'Seite bleibt', 'Seiten bleiben')} unverändert</summary><ul>${gleichGeblieben
        .map((v) => `<li>${esc(v.seite.titel)}</li>`)
        .join('')}</ul></details>`
    : '';
  const nichts = !geaendert.length && !entfallen.length ? '<p class="leer">Dieser Stand entspricht der Website, die schon online ist.</p>' : '';

  let entscheidung = '';
  if (stand.zustand === 'eingereicht') {
    entscheidung = `<form method="post" class="felder">
<label for="name">Ihr Name</label><input id="name" name="name" required maxlength="80" autocomplete="name">
<label for="kommentar">Anmerkung</label><textarea id="kommentar" name="kommentar" rows="3" maxlength="2000"></textarea>
<div class="knoepfe">
<button type="submit" name="entscheidung" value="freigeben">Freigeben und veröffentlichen</button>
<button type="submit" name="entscheidung" value="aendern" class="zweit">Änderung wünschen</button>
</div>
</form>`;
  } else if (stand.zustand === 'freigegeben') {
    entscheidung = `<p class="erledigt">Freigegeben von ${esc(stand.entschiedenVon)} am ${zeit(stand.entschiedenAm ?? stand.eingereichtAm)}.
<a href="/seiten/${esc(projekt.slug)}">Website ansehen</a></p>`;
  } else if (stand.zustand === 'abgelehnt') {
    entscheidung = `<p class="erledigt">Änderung gewünscht von ${esc(stand.entschiedenVon)}. Die Agentur meldet sich mit einem neuen Stand.</p>`;
  } else {
    entscheidung = '<p class="erledigt">Dieser Stand wurde durch einen neueren ersetzt.</p>';
  }

  return `<h1>Stand zur Freigabe: ${esc(projekt.name)}</h1>
<p class="unterzeile">Eingereicht von ${esc(stand.eingereichtVon)} am ${zeit(stand.eingereichtAm)}${zusammenfassung.length ? ` · ${zusammenfassung.join(' · ')}` : ''}</p>
${nichts}${abschnitte}${weg}${unveraendert}
<section><h2>Entscheidung</h2>${entscheidung}</section>`;
}
