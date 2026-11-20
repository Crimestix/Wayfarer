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
import { generateArea, groundOf, hexSizeOptions, recognize, suggestHexKm } from './generate';
import { MAX_SIDE, MILE_KM, SCALE_PRESETS, blankArea, scaleWords } from './freeMap';
import { landscapesOf } from '../../domain/landscape';

/** Landschaften, die als Grundlage einer Karte taugen (eine Siedlung ist keine). */
const BIOMES = TERRAINS.filter((t) => t !== 'urban');

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
  // Zwei Wege zu einer Karte: zwischen zwei Orten erkannt – oder frei, mit eigenem Maßstab.
  const [mode, setMode] = useState<'between' | 'free'>('between');
  if (mode === 'free')
    return <FreeDialog onClose={onClose} onCreated={onCreated} onMode={() => setMode('between')} />;
  return <BetweenDialog onClose={onClose} onCreated={onCreated} onMode={() => setMode('free')} />;
}

/** Umschalter oben in beiden Fenstern. */
function ModeSwitch({ free, onMode }: { free: boolean; onMode: () => void }) {
  return (
    <div className="wf-btn-group" role="group" aria-label="Art der Karte">
      <Button aria-pressed={!free} onClick={free ? onMode : undefined}>
        Zwischen zwei Orten
      </Button>
      <Button aria-pressed={free} onClick={free ? undefined : onMode}>
        Freie Karte
      </Button>
    </div>
  );
}

function BetweenDialog({
  onClose,
  onCreated,
  onMode,
}: {
  onClose: () => void;
  onCreated: (areaId: string) => void;
  onMode: () => void;
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
  const size = hexKm ?? suggestHexKm(km, land);
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
        <ModeSwitch free={false} onMode={onMode} />
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
              <Field
                label="Feldgröße"
                hint={
                  hexKm !== null
                    ? 'Von dir gewählt.'
                    : land === 'underdark'
                      ? 'Unter der Erde: sechs Meilen je Feld.'
                      : undefined
                }
              >
                <Select value={String(size)} onChange={(e) => setHexKm(Number(e.target.value))}>
                  {hexSizeOptions(size).map((s) => (
                    <option key={s} value={String(s)}>
                      {scaleWords(s)}
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

/**
 * Eine freie Hexkarte: Name, Größe in Feldern, Maßstab (Vorschlag oder eigener Wert in Meilen,
 * km oder m) und der Grund – ein Gelände oder eine Landschaft deiner Welt. Gemalt wird danach.
 */
function FreeDialog({
  onClose,
  onCreated,
  onMode,
}: {
  onClose: () => void;
  onCreated: (areaId: string) => void;
  onMode: () => void;
}) {
  const db = useDb();
  const data = useData();
  const lands = landscapesOf(data);
  const [name, setName] = useState('');
  const [cols, setCols] = useState('12');
  const [rows, setRows] = useState('10');
  const [scale, setScale] = useState('0');
  const [own, setOwn] = useState('');
  const [unit, setUnit] = useState<'mi' | 'km' | 'm'>('mi');
  const [ground, setGround] = useState<string>('grassland');
  const ownNumber = parseKm(own);
  const ownKm =
    ownNumber === null
      ? null
      : unit === 'mi'
        ? ownNumber * MILE_KM
        : unit === 'm'
          ? ownNumber / 1000
          : ownNumber;
  const hexKm = scale === 'own' ? ownKm : SCALE_PRESETS[Number(scale)]!.km;
  const c = Number(cols);
  const r = Number(rows);
  const problem =
    !Number.isInteger(c) || !Number.isInteger(r) || c < 1 || r < 1
      ? 'Breite und Höhe sind ganze Zahlen ab 1.'
      : c > MAX_SIDE || r > MAX_SIDE
        ? `Höchstens ${MAX_SIDE} Felder je Seite.`
        : hexKm === null
          ? 'Trag den Maßstab als Zahl ein.'
          : '';
  const create = () => {
    if (problem || hexKm === null) return;
    const picked = ground.startsWith('landscape:') ? data.entities[ground.slice(10)] : undefined;
    const land = picked?.kind === 'landscape' ? picked : null;
    const area = db.put(
      'areas',
      blankArea({
        name,
        cols: c,
        rows: r,
        hexKm,
        terrain: land ? land.landscape.base : (ground as Terrain),
        landscape: land,
      }),
    );
    toast({ title: 'Hexkarte angelegt', body: `${area.name} · ${area.hexes.length} Felder` });
    onCreated(area.id);
  };
  const size =
    hexKm === null ? '' : ` · etwa ${Math.round(c * hexKm)} × ${Math.round(r * hexKm * 0.866)} km`;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Neue Hexkarte"
      width={620}
      footer={
        <>
          <span className="wf-grow wf-erk-form__status" role="status">
            {problem || `${c * r} Felder · ${scaleWords(hexKm!)}${size}`}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" icon={<Hexagon />} onClick={create} disabled={!!problem}>
            Karte anlegen
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <ModeSwitch free onMode={onMode} />
        <div className="wf-form-grid">
          <Field label="Name der Karte" className="wf-span-2">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Der Nebelforst"
            />
          </Field>
          <Field label="Breite (Felder)">
            <Input inputMode="numeric" value={cols} onChange={(e) => setCols(e.target.value)} />
          </Field>
          <Field label="Höhe (Felder)">
            <Input inputMode="numeric" value={rows} onChange={(e) => setRows(e.target.value)} />
          </Field>
          <Field label="Maßstab" className={scale === 'own' ? undefined : 'wf-span-2'}>
            <Select value={scale} onChange={(e) => setScale(e.target.value)}>
              {SCALE_PRESETS.map((preset, index) => (
                <option key={preset.label} value={index}>
                  {preset.label}
                </option>
              ))}
              <option value="own">Eigener Maßstab …</option>
            </Select>
          </Field>
          {scale === 'own' && (
            <Field label="Ein Feld misst">
              <span className="wf-row" style={{ gap: 'var(--s-2)' }}>
                <Input
                  inputMode="decimal"
                  value={own}
                  placeholder="z. B. 3"
                  onChange={(e) => setOwn(e.target.value)}
                />
                <Select
                  value={unit}
                  aria-label="Einheit"
                  onChange={(e) => setUnit(e.target.value as 'mi' | 'km' | 'm')}
                >
                  <option value="mi">Meilen</option>
                  <option value="km">km</option>
                  <option value="m">m</option>
                </Select>
              </span>
            </Field>
          )}
          <Field
            label="Grund"
            className="wf-span-2"
            hint="Womit die Karte beginnt – gemalt wird danach mit dem Gelände-Pinsel."
          >
            <Select value={ground} onChange={(e) => setGround(e.target.value)}>
              {lands.length > 0 && (
                <optgroup label="Landschaften deiner Welt">
                  {lands.map((land) => (
                    <option key={land.id} value={`landscape:${land.id}`}>
                      {land.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Gelände">
                {TERRAINS.map((terrain) => (
                  <option key={terrain} value={terrain}>
                    {TERRAIN_LABEL[terrain]}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>
        </div>
        <p className="wf-erk-form__known">
          Eine freie Karte gehört keinem Weg: Du malst Landschaften, setzt Orte, belebst sie – und
          zoomst in ein Feld hinein, wenn die Gruppe dort genauer unterwegs ist.
        </p>
      </div>
    </Dialog>
  );
}
