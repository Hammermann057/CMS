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
