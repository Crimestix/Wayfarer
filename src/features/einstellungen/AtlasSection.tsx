/**
 * Atlas übernehmen: Liest die Weltdatei des alten Atlas (Planet, Küsten, Seen, Flüsse) und – wenn
 * gewünscht – seine Höhenkarte und legt beides verkleinert in den Spielstand.
 */
import { useState } from 'react';
import { useLocation } from 'wouter';
import { Check, Globe, Mountain, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { Button, confirmDialog, toast } from '../../ui';
import { applyAtlas, removeAtlas } from '../atlas/actions';
import { convertAtlasWorld, convertHeights, type AtlasConversion } from '../atlas/import';
import { PLANET_ID, RELIEF_ID, planetOf } from '../atlas/model';
import { errorText } from './files';
import { ActionRow, Notice, useFilePicker } from './parts';

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;

export function AtlasSection() {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const [world, setWorld] = useState<(AtlasConversion & { fileName: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const planet = planetOf(data);
  const relief = data.atlas[RELIEF_ID];

  const worldPicker = useFilePicker(async (file) => {
    setBusy(true);
    setError('');
    try {
      const conversion = convertAtlasWorld(JSON.parse(await file.text()), file.name);
      setWorld({ ...conversion, fileName: file.name });
    } catch (e) {
      setWorld(null);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  });

  const heightPicker = useFilePicker(async (file) => {
    setBusy(true);
    setError('');
    try {
      const current = db.getSnapshot().atlas[PLANET_ID];
      if (!current) throw new Error('Zuerst die Weltdatei übernehmen – die Höhen gehören zu ihr.');
      const { id: _id, rev: _rev, created: _created, updated: _updated, ...init } = current;
      applyAtlas(db, init, convertHeights(await file.arrayBuffer(), file.name));
      toast({ title: 'Höhenkarte übernommen', body: 'Die Weltkarte zeigt jetzt das Gelände.' });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }, '.f32,application/octet-stream');

  const apply = () => {
    if (!world) return;
    try {
      applyAtlas(db, world.planet);
      setWorld(null);
      toast({
        title: 'Atlas übernommen',
        body: `${world.planet.name || 'Der Planet'} liegt jetzt in Wayfarer.`,
        action: { label: 'Zur Weltkarte', run: () => navigate('/atlas') },
        duration: 10000,
      });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Atlas entfernen?',
      body: 'Küsten, Gewässer und Höhen werden aus dem Spielstand genommen. Die Lage, die du Orten gegeben hast, bleibt eingetragen.',
      confirmLabel: 'Entfernen',
      danger: true,
    });
    if (ok) removeAtlas(db);
  };

  return (
    <div className="wf-einstellungen-stack">
      <div className="wf-einstellungen-actions">
        <ActionRow
          icon={<Globe />}
          title="Weltdatei des Atlas einlesen"
          action={
            <Button icon={<Globe />} onClick={worldPicker.open} disabled={busy}>
              {busy ? 'Wird gelesen …' : 'Weltdatei wählen …'}
            </Button>
          }
        >
          Die Datei „world.json“ liegt im Ordner des Atlas unter „inputs“. Sie enthält den Planeten
          mit seinen Küsten, Seen und Flüssen. Wayfarer zeigt zuerst, was daraus wird.
        </ActionRow>
        <ActionRow
          icon={<Mountain />}
          title="Höhenkarte dazu einlesen"
          action={
            <Button icon={<Mountain />} onClick={heightPicker.open} disabled={busy || !planet}>
              Höhenkarte wählen …
            </Button>
          }
        >
          Die Datei „height.f32“ liegt unter „artifacts“ im Ordner „4096x2048“. Mit ihr kennt
          Wayfarer die Höhe jeder Stelle und zeichnet das Gelände. Sie wird dafür verkleinert.
          {!planet && ' Erst möglich, wenn die Weltdatei übernommen ist.'}
        </ActionRow>
      </div>
      {worldPicker.input}
      {heightPicker.input}

      {error && (
        <Notice tone="danger" title="Das hat nicht geklappt">
          {error}
        </Notice>
      )}

      {world && (
        <Notice
          icon={<Globe />}
          title={`Gelesen: ${world.planet.name || world.fileName}`}
          action={
            <span className="wf-row">
              <Button onClick={() => setWorld(null)}>Verwerfen</Button>
              <Button variant="primary" icon={<Check />} onClick={apply}>
                Übernehmen
              </Button>
            </span>
          }
        >
          {count(world.stats.lands, 'Landmasse', 'Landmassen')},{' '}
          {count(world.stats.lakes, 'See', 'Seen')} mit eigener Uferlinie und{' '}
          {count(world.stats.rivers, 'Fluss', 'Flüsse')}. Die Küsten werden von{' '}
          {world.stats.pointsBefore.toLocaleString('de-DE')} auf{' '}
          {world.stats.pointsAfter.toLocaleString('de-DE')} Punkte vereinfacht – auf etwa 700 Meter
          genau. Radius {Math.round(world.planet.radiusKm).toLocaleString('de-DE')} km, ein Tag{' '}
          {world.planet.dayHours.toLocaleString('de-DE')} Stunden, ein Jahr{' '}
          {world.planet.yearDays.toLocaleString('de-DE')} Tage, Achsneigung{' '}
          {world.planet.obliquityDeg.toLocaleString('de-DE')}°.
          {planet && ' Der bisherige Atlas wird ersetzt; die Lage deiner Orte bleibt.'}
        </Notice>
      )}

      {planet && !world && (
        <Notice
          icon={<Check />}
          title={`Im Spielstand: ${planet.doc.name || 'der Planet'}`}
          action={
            <span className="wf-row">
              <Button onClick={() => navigate('/atlas')}>Zur Weltkarte</Button>
              <Button icon={<Trash2 />} onClick={() => void remove()}>
                Entfernen
              </Button>
            </span>
          }
        >
          {count(planet.lands.length, 'Landmasse', 'Landmassen')},{' '}
          {count(planet.doc.lakes.length, 'See', 'Seen')},{' '}
          {count(planet.doc.rivers.length, 'Fluss', 'Flüsse')}.{' '}
          {relief
            ? `Mit Höhenkarte (${relief.width} × ${relief.height} Felder).`
            : 'Noch ohne Höhenkarte – die Karte zeigt Land und Wasser, aber kein Gelände.'}
        </Notice>
      )}
    </div>
  );
}
