// Erste Einrichtung über die Kommandozeile: legt die Agentur und die erste Leitung an.
// Absichtlich nicht im Browser, damit niemand, der die Adresse zuerst findet, sich zur Leitung macht.
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Fehler, Kern } from './kern/kern.ts';

const { values } = parseArgs({
  options: {
    agentur: { type: 'string' },
    name: { type: 'string' },
    email: { type: 'string' },
  },
});

if (!values.agentur || !values.name || !values.email) {
  console.error('Aufruf: npm run einrichten -- --agentur "Name der Agentur" --name "Dein Name" --email "du@agentur.de"');
  process.exit(1);
}

const kern = new Kern(process.env.DATEN ?? join(process.cwd(), 'daten'));
try {
  if (kern.agenturen().length) {
    throw new Fehler('Es gibt schon eine Agentur. Weitere Personen gibst du im Werkzeug unter „Team“ frei. Für einen frischen Anfang den Ordner mit den Daten umbenennen.');
  }
  const agentur = kern.agenturAnlegen(values.agentur);
  const leitung = kern.erstePersonAnlegen(agentur.id, { name: values.name, email: values.email });
  const basisUrl = process.env.BASIS_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  console.log(`Fertig: „${agentur.name}“ mit ${leitung.name} (${leitung.email}) als Leitung.`);
  console.log(`Server starten, dann unter ${basisUrl}/anmelden mit dieser Adresse anmelden.`);
} catch (fehler) {
  console.error(fehler instanceof Fehler ? fehler.message : fehler);
  process.exitCode = 1;
} finally {
  kern.schliessen();
}
