/**
 * „Neue Hexkarte“: zwei Orte wählen – den Rest erkennt Wayfarer aus der Welt und schlägt ihn vor.
 * Entfernung, Landschaft und Feldgröße lassen sich überschreiben, bevor die Karte entsteht.
 */
import { useMemo, useState } from 'react';
import { Hexagon } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { freshSeed } from '../../domain/random';
import { TERRAINS, type Terrain } from '../../domain/schema';
import { TERRAIN_LABEL, formatDays, travelDays } from '../../domain/terrain';
import { Button, Dialog, EntityPicker, Field, Input, Select, toast } from '../../ui';
import { generateArea, groundOf, recognize, suggestHexKm } from './generate';

/** Landschaften, die als Grundlage einer Karte taugen (eine Siedlung ist keine). */
const BIOMES = TERRAINS.filter((t) => t !== 'urban');
const SIZES = [2, 10, 50];

const parseKm = (text: string): number | null => {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

export function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (areaId: string) => void;
}) {
  const db = useDb();
  const data = useData();
  const [fromId, setFromId] = useState<string | null>(data.state.placeId);
  const [toId, setToId] = useState<string | null>(null);
  // Eigene Eingaben haben Vorrang vor dem, was Wayfarer erkennt.
  const [distance, setDistance] = useState<string | null>(null);
  const [biome, setBiome] = useState<Terrain | null>(null);
  const [hexKm, setHexKm] = useState<number | null>(null);
  const [name, setName] = useState('');

  const known = useMemo(
    () => (fromId && toId && fromId !== toId ? recognize(data, fromId, toId) : null),
    [data, fromId, toId],
  );
  const km = distance !== null ? parseKm(distance) : (known?.distanceKm ?? null);
  const land = biome ?? known?.biome ?? 'grassland';
  const size = hexKm ?? suggestHexKm(km);
  const length = km ? Math.max(1, Math.round(km / size)) : null;
  const problem = !fromId
    ? 'Wähle den Ort, an dem der Weg beginnt.'
    : !toId
      ? 'Wähle den Ort, zu dem es geht.'
      : fromId === toId
        ? 'Start und Ziel sind derselbe Ort.'
        : km === null
          ? 'Trag die Entfernung in Kilometern ein.'
          : km > 5000
            ? 'Mehr als 5000 km passen auf keine Hexkarte – teile den Weg in Abschnitte.'
            : '';

  const create = () => {
    if (problem || !fromId || !toId || km === null) return;
    const area = db.put(
      'areas',
      generateArea(
        data,
        {
          fromId,
          toId,
          distanceKm: km,
          biome: land,
          hexKm: size,
          seed: freshSeed(),
          direction: known?.direction ?? null,
          between: known?.between ?? [],
          ground: groundOf(data, known?.origin ?? null, size),
          route: known?.route ?? null,
        },
        name,
      ),
    );
    toast({
      title: 'Hexkarte erzeugt',
      body: `${area.name} · ${area.hexes.length} Felder`,
    });
    onCreated(area.id);
  };

  const fromName = fromId ? (data.entities[fromId]?.name ?? '') : '';
  const toName = toId ? (data.entities[toId]?.name ?? '') : '';
  return (
    <Dialog
      open
      onClose={onClose}
      title="Neue Hexkarte"
      width={620}
      footer={
        <>
          <span className="wf-grow wf-erk-form__status" role="status">
            {problem ||
              (length !== null &&
                `${length} ${length === 1 ? 'Feld' : 'Felder'} lang · zu Fuß etwa ${formatDays(travelDays(km!))}`)}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" icon={<Hexagon />} onClick={create} disabled={!!problem}>
            Karte erzeugen
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <div className="wf-form-grid">
          <Field label="Von">
            <EntityPicker
              value={fromId}
              onChange={setFromId}
              kinds={['place']}
              placeholder="Ort wählen …"
              autoFocus={!fromId}
            />
          </Field>
          <Field label="Nach">
            <EntityPicker
              value={toId}
              onChange={setToId}
              kinds={['place']}
              exclude={fromId ? [fromId] : undefined}
              placeholder="Ort wählen …"
              autoFocus={!!fromId}
            />
          </Field>
        </div>

        {known ? (
          <>
            <div className="wf-form-grid">
              <Field
                label="Entfernung (km)"
                hint={distance === null ? known.distanceSource : undefined}
              >
                <Input
                  inputMode="decimal"
                  value={distance ?? (known.distanceKm ? String(Math.round(known.distanceKm)) : '')}
                  onChange={(e) => setDistance(e.target.value)}
                  placeholder="z. B. 120"
                />
              </Field>
              <Field label="Feldgröße">
                <Select value={size} onChange={(e) => setHexKm(Number(e.target.value))}>
                  {SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s} km je Feld
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Landschaft"
                className="wf-span-2"
                hint={biome === null ? known.biomeSource : 'Von dir gewählt.'}
              >
                <Select value={land} onChange={(e) => setBiome(e.target.value as Terrain)}>
                  {BIOMES.map((t) => (
                    <option key={t} value={t}>
                      {TERRAIN_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Name der Karte" className="wf-span-2">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`${fromName} → ${toName}`}
                />
              </Field>
            </div>
            <p className="wf-erk-form__known">
              {known.between.length > 0
                ? `Am Weg liegen laut ${known.fromAtlas ? 'Atlas' : 'Karte'}: ${known.between.map((b) => data.entities[b.placeId]?.name).join(', ')}. Sie stehen an der richtigen Stelle.`
                : known.direction
                  ? `Die Richtung stammt ${known.fromAtlas ? 'vom Planeten' : 'von der Karte'}: Norden ist oben.`
                  : 'Die Lage der beiden Orte zueinander kennt Wayfarer noch nicht – das Ziel liegt auf der Karte im Osten.'}
            </p>
            {known.origin && land !== 'underdark' && (
              <p className="wf-erk-form__known">
                Meer, Küsten, Flüsse und Höhen folgen dem Atlas.{' '}
                {known.route
                  ? 'Die Luftlinie führt übers Wasser – die Karte folgt dem Weg über Land, ums Wasser herum.'
                  : known.seaOnly
                    ? 'Zwischen den beiden Orten gibt es keinen Weg über Land: Die Karte zeigt die gerade Strecke übers Meer, und die Gruppe braucht ein Schiff.'
                    : ''}
              </p>
            )}
          </>
        ) : (
          <p className="wf-erk-form__known">
            Wähle zwei Orte. Wayfarer erkennt aus deiner Welt, wie weit sie auseinanderliegen, was
            für eine Landschaft dazwischen liegt und welche bekannten Orte am Weg sind – und baut
            daraus die Karte.
          </p>
        )}
      </div>
    </Dialog>
  );
}
