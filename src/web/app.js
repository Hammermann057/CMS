// Ablage für Material: Dateien ziehen oder auswählen, jede Datei geht einzeln an den Server.
const ablage = document.querySelector('[data-ablage]');

if (ablage) {
  const ziel = ablage.dataset.ablage;
  const status = ablage.querySelector('[data-ablage-status]');
  const eingabe = ablage.querySelector('input[type=file]');

  async function ladeHoch(dateien) {
    const fehler = [];
    let fertig = 0;
    for (const datei of dateien) {
      status.textContent = `Lade ${datei.name} hoch …`;
      try {
        const antwort = await fetch(`${ziel}?name=${encodeURIComponent(datei.name)}`, { method: 'PUT', body: datei });
        const daten = await antwort.json();
        if (antwort.ok) fertig += 1;
        else fehler.push(`${datei.name}: ${daten.fehler}`);
      } catch {
        fehler.push(`${datei.name}: Verbindung fehlgeschlagen`);
      }
    }
    if (fehler.length === 0) {
      location.reload();
      return;
    }
    const rest = fertig ? ` ${fertig} weitere Dateien sind angekommen, lade die Seite neu, um sie zu sehen.` : '';
    status.textContent = `${fehler.join(' · ')}${rest}`;
  }

  eingabe.addEventListener('change', () => {
    if (eingabe.files.length) ladeHoch([...eingabe.files]);
  });
  ablage.addEventListener('dragover', (ereignis) => {
    ereignis.preventDefault();
    ablage.classList.add('aktiv');
  });
  ablage.addEventListener('dragleave', () => ablage.classList.remove('aktiv'));
  ablage.addEventListener('drop', (ereignis) => {
    ereignis.preventDefault();
    ablage.classList.remove('aktiv');
    if (ereignis.dataTransfer.files.length) ladeHoch([...ereignis.dataTransfer.files]);
  });
}

// Prüf-Link beim Anklicken ganz markieren, damit er sich leicht kopieren lässt.
const link = document.querySelector('#link');
if (link) link.addEventListener('focus', () => link.select());

// Editor: Warnung vor dem Verlassen mit ungespeicherten Änderungen,
// und ein Klick in der Vorschau springt zum passenden Baustein.
const editor = document.querySelector('[data-editor]');
if (editor) {
  let geaendert = false;
  editor.addEventListener('input', () => {
    geaendert = true;
  });
  editor.addEventListener('submit', () => {
    geaendert = false;
  });
  window.addEventListener('beforeunload', (ereignis) => {
    if (!geaendert) return;
    ereignis.preventDefault();
    ereignis.returnValue = '';
  });
  const vorschau = document.querySelector('[data-vorschau]');
  if (vorschau) {
    vorschau.addEventListener('click', (ereignis) => {
      const block = ereignis.target.closest('[data-baustein]');
      if (!block) return;
      ereignis.preventDefault();
      const karte = document.getElementById(`b-${block.dataset.baustein}`);
      if (!karte) return;
      karte.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const erstesFeld = karte.querySelector('input:not([type=hidden]), textarea, select');
      if (erstesFeld) erstesFeld.focus({ preventScroll: true });
    });
  }
}

// Regelwerk: Änderungen sofort in der Vorschau zeigen und den Kontrast neu rechnen.
const regelForm = document.querySelector('[data-regelwerk-form]');
const regelVorschau = document.querySelector('[data-regelwerk-vorschau]');
if (regelForm && regelVorschau) {
  const istFarbe = (wert) => /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(wert);
  const normFarbe = (wert) => {
    const h = wert.replace('#', '').toLowerCase();
    return `#${h.length === 3 ? [...h].map((z) => z + z).join('') : h}`;
  };
  const leuchtdichte = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const s = parseInt(hex.slice(i, i + 2), 16) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const kontrast = (a, b) => {
    const [hell, dunkel] = [leuchtdichte(a), leuchtdichte(b)].sort((x, y) => y - x);
    return (hell + 0.05) / (dunkel + 0.05);
  };
  const farbeVon = (name) => {
    const feld = regelForm.elements[name];
    return feld && istFarbe(feld.value) ? normFarbe(feld.value) : null;
  };
  const kontrasteNeu = () => {
    for (const zeile of document.querySelectorAll('[data-kontrast]')) {
      const [feld, gegen, ziel] = zeile.dataset.kontrast.split(':');
      const a = farbeVon(feld);
      const b = farbeVon(gegen);
      if (!a || !b) continue;
      const wert = kontrast(a, b);
      zeile.querySelector('span').textContent = `${(Math.floor(wert * 10) / 10).toFixed(1).replace('.', ',')} : 1`;
      zeile.className = wert >= Number(ziel) ? 'reicht' : 'reicht-nicht';
    }
  };
  const zeige = (feld) => {
    const variable = feld.dataset.variable;
    if (!variable) return;
    let wert = feld.value;
    if (feld.dataset.art === 'farbe') {
      if (!istFarbe(wert)) return;
      wert = normFarbe(wert);
    }
    if (feld.tagName === 'SELECT') wert = feld.selectedOptions[0]?.dataset.stapel ?? wert;
    if (feld.dataset.einheit) wert += feld.dataset.einheit;
    regelVorschau.style.setProperty(variable, wert);
  };
  regelForm.addEventListener('input', (ereignis) => {
    const feld = ereignis.target;
    if (feld.dataset.farbeFuer) {
      const text = regelForm.elements[feld.dataset.farbeFuer];
      text.value = feld.value;
      zeige(text);
    } else {
      if (feld.dataset.art === 'farbe' && istFarbe(feld.value)) {
        const waehler = regelForm.querySelector(`[data-farbe-fuer="${feld.name}"]`);
        if (waehler) waehler.value = normFarbe(feld.value);
      }
      zeige(feld);
    }
    kontrasteNeu();
  });
}
