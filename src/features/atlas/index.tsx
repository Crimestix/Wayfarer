/**
 * Atlas – der Planet und wo alles liegt. Links die Orte, rechts die Weltkarte. Ein Ort bekommt
 * seine Lage, indem man ihn wählt und auf die Karte klickt; Orte darunter erben sie.
 */
import { useMemo, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import {
  Check,
  Crosshair,
  Globe as GlobeIcon,
  ImagePlus,
  MapPin,
  MapPinOff,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entitiesOfKind, placeAncestors, placePath } from '../../domain/derive';
import type { LonLat } from '../../domain/geo';
import type { Place } from '../../domain/schema';
import { formatDays, travelDays } from '../../domain/terrain';
import {
  Button,
  Checkbox,
  EmptyState,
  Field,
  IconButton,
  Input,
  confirmDialog,
  cx,
  entityHref,
  toast,
} from '../../ui';
import { addLand, isOwnLand, removeLand, setLandRelief, setPlaceGeo } from './actions';
import {
  daylightAt,
  describeTerrain,
  formatGeo,
  formatHours,
  formatKm,
  geoIndex,
  legBetween,
  mapsOfPlace,
  placeGeo,
  placedPlaces,
  planetOf,
  reliefOf,
  terrainAt,
} from './model';
import { Globe } from './Globe';
import { placeShape, type Placement, type TracedShape } from './trace';
import { TraceDialog } from './TraceDialog';
import { WorldMap, type MapPlace } from './WorldMap';
import './atlas.css';

/** Karte oder Kugel – bleibt beim Wechsel des Bereichs erhalten. */
const memory = { shape: 'map' as 'map' | 'globe' };

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export default function AtlasPage() {
  const db = useDb();
  const data = useData();
  const { id } = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const planet = planetOf(data);
  const grid = reliefOf(data);
  const [query, setQuery] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [hover, setHover] = useState<LonLat | null>(null);
  const [focus, setFocus] = useState<LonLat | null>(null);
  const [shape, setShape] = useState(memory.shape);
  // Eine Landmasse aus einem Bild: erst gelesen, dann auf der Karte eingepasst.
  const [tracing, setTracing] = useState(false);
  const [fit, setFit] = useState<{
    name: string;
    shape: TracedShape;
    placement: Placement;
    keepAspect: boolean;
  } | null>(null);
  const radiusKm = planet?.radiusKm ?? 0;
  const draft = useMemo(
    () => (fit && radiusKm ? placeShape(fit.shape, fit.placement, radiusKm) : null),
    [fit, radiusKm],
  );
  const View = shape === 'globe' ? Globe : WorldMap;

  // Große Orte zuerst: Kontinente und Länder vor Städten, Städte vor einzelnen Räumen.
  const places = useMemo(() => {
    const depth = new Map<string, number>();
    const all = entitiesOfKind(data, 'place');
    for (const entry of all) depth.set(entry.id, placeAncestors(data, entry.id).length);
    return all.sort(
      (a, b) => depth.get(a.id)! - depth.get(b.id)! || a.name.localeCompare(b.name, 'de'),
    );
  }, [data]);
  const placed = useMemo(() => placedPlaces(data), [data]);
  const selected = id ? data.entities[id] : undefined;
  const place: Place | null = selected?.kind === 'place' ? selected : null;
  const viaMaps = useMemo(() => placed.filter((p) => p.via).length, [placed]);
  const located = place ? placeGeo(data, place.id) : null;
  const onMaps = useMemo(
    () => (place && !place.place.geo ? mapsOfPlace(data, place.id) : []),
    [data, place],
  );
  const party = placeGeo(data, data.state.placeId);

  const shown = useMemo(() => {
    const q = fold(query.trim());
    return places
      .filter((p) => (!q || fold(p.name).includes(q)) && (!onlyMissing || !placeGeo(data, p.id)))
      .slice(0, 300);
  }, [places, query, onlyMissing, data]);

  const mapPlaces = useMemo<MapPlace[]>(
    () => placed.map((p) => ({ id: p.place.id, name: p.place.name, geo: p.geo, major: p.major })),
    [placed],
  );

  if (!planet)
    return (
      <div className="wf-atlas-empty">
        <EmptyState
          icon={<GlobeIcon />}
          title="Noch kein Atlas"
          action={
            <Button variant="primary" onClick={() => navigate('/einstellungen')}>
              Zu den Einstellungen
            </Button>
          }
        >
          Hier erscheint der Planet mit seinen Küsten, Seen und Höhen. In den Einstellungen unter
          „Atlas übernehmen“ liest Wayfarer die Weltdatei deines alten Atlas ein.
        </EmptyState>
      </div>
    );

  const place_ = (change: Partial<Placement>) =>
    setFit((current) => {
      if (!current) return current;
      const next = { ...current.placement, ...change };
      // Mit festem Seitenverhältnis folgt die Breite der Höhe (und umgekehrt).
      if (current.keepAspect) {
        const ratio = current.shape.width / current.shape.height;
        if (change.heightDeg !== undefined) next.widthDeg = Math.min(360, next.heightDeg * ratio);
        else if (change.widthDeg !== undefined)
          next.heightDeg = Math.min(180, next.widthDeg / ratio);
      }
      return { ...current, placement: next };
    });
  const applyFit = () => {
    if (!fit || !draft) return;
    const undo = addLand(db, { name: fit.name, ...draft });
    setFit(null);
    toast({
      title: `„${fit.name}“ liegt jetzt auf dem Planeten`,
      body: `${draft.rings.length === 1 ? 'Eine Fläche' : `${draft.rings.length} Flächen`}. Die Höhen erzeugt Wayfarer; in der Liste „Aus Bildern eingelesen“ lässt sich das Land auch flach stellen.`,
      action: { label: 'Rückgängig', run: undo },
      duration: 10000,
    });
  };
  // Ein Gebiet reicht höchstens bis zur Gegenseite des Planeten.
  const maxWidthKm = fit
    ? Math.floor(
        (Math.PI * planet.radiusKm) /
          Math.max(1, Math.hypot(1, fit.shape.height / fit.shape.width)) /
          50,
      ) * 50
    : 0;
  const ownLands = planet ? planet.doc.lands.filter(isOwnLand) : [];
  const dropLand = async (land: { id: string; name: string }) => {
    const ok = await confirmDialog({
      title: `„${land.name}“ vom Planeten nehmen?`,
      body: 'Die Küsten dieser Landmasse werden entfernt. Orte, die dort liegen, behalten ihre Lage.',
      confirmLabel: 'Entfernen',
      danger: true,
    });
    if (ok) removeLand(db, land.id);
  };

  const select = (placeId: string) => {
    const target = placeGeo(data, placeId);
    navigate(`/atlas/${placeId}`);
    setPlacing(target === null);
    if (target) setFocus({ ...target.geo });
  };

  const pick = (point: LonLat) => {
    // Beim Einpassen setzt ein Klick die Mitte der neuen Landmasse.
    if (fit) return place_({ lon: point.lon, lat: point.lat });
    if (!place || !placing) return;
    const before = geoIndex(data).derived.size;
    const undo = setPlaceGeo(db, place.id, point);
    setPlacing(false);
    // Hängt damit eine Karte im Planeten, haben auf einen Schlag viele Orte eine Lage.
    const gained = geoIndex(db.getSnapshot()).derived.size - before;
    toast({
      title: `„${place.name}“ liegt jetzt hier`,
      body: `${formatGeo(point)} · ${describeTerrain(terrainAt(planet, grid, point))}${
        gained > 0
          ? `. Über Karten ${gained === 1 ? 'hat jetzt ein weiterer Ort' : `haben jetzt ${gained} weitere Orte`} eine Lage.`
          : ''
      }`,
      duration: gained > 0 ? 10000 : undefined,
      action: { label: 'Rückgängig', run: undo },
    });
  };

  const clear = () => {
    if (!place) return;
    const undo = setPlaceGeo(db, place.id, null);
    toast({
      title: `Lage von „${place.name}“ entfernt`,
      action: { label: 'Rückgängig', run: undo },
    });
  };

  const hoverTerrain = hover ? terrainAt(planet, grid, hover) : null;
  const leg = place && data.state.placeId ? legBetween(data, data.state.placeId, place.id) : null;
  const daylight = located ? daylightAt(data, located.geo, data.state.now) : null;

  return (
    <div className="wf-atlas">
      <aside className="wf-atlas-side" aria-label="Orte">
        <div className="wf-atlas-side__head">
          <h1 className="wf-atlas-side__title">Atlas</h1>
          <span className="wf-atlas-side__total">
            {placed.length - viaMaps} von {places.length} Orten gesetzt
            {viaMaps > 0 && `, ${viaMaps} über Karten`}
          </span>
          <IconButton
            label="Landmasse aus einem Kartenbild einlesen"
            size="sm"
            onClick={() => setTracing(true)}
          >
            <ImagePlus />
          </IconButton>
        </div>
        {fit && (
          <div className="wf-atlas-fit">
            <div className="wf-atlas-fit__title">„{fit.name}“ einpassen</div>
            <div className="wf-atlas-fit__kinds" role="group" aria-label="Das Bild zeigt">
              {(
                [
                  [
                    'local',
                    'Ein Gebiet',
                    'Größe in Kilometern – die Formen bleiben überall erhalten, auch am Pol',
                  ],
                  [
                    'grid',
                    'Einen Weltstreifen',
                    'Wie die Weltkarte: von Pol zu Pol oder rund um den Planeten',
                  ],
                ] as const
              ).map(([kind, label, hint]) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={fit.placement.kind === kind}
                  title={hint}
                  onClick={() => place_({ kind })}
                >
                  {label}
                </button>
              ))}
            </div>
            {fit.placement.kind === 'local' ? (
              <>
                <p className="wf-mute">
                  Klicke auf die Karte, wo die Mitte des Bildes liegen soll. Die Breite liest du am
                  Maßstab des Bildes ab.
                </p>
                <Field label="Breite des Bildes in Kilometern">
                  <div className="wf-atlas-fit__km">
                    <input
                      type="range"
                      min={100}
                      max={maxWidthKm}
                      step={50}
                      value={Math.min(maxWidthKm, fit.placement.widthKm)}
                      onChange={(event) => place_({ widthKm: Number(event.target.value) })}
                    />
                    <Input
                      type="number"
                      min={100}
                      max={maxWidthKm}
                      step={50}
                      value={Math.round(fit.placement.widthKm)}
                      aria-label="Breite in Kilometern"
                      onChange={(event) => {
                        const km = Number(event.target.value);
                        if (km > 0) place_({ widthKm: Math.min(maxWidthKm, km) });
                      }}
                    />
                  </div>
                </Field>
                <Field
                  label={`Drehung: ${Math.round(fit.placement.turnDeg)}°`}
                  hint="Dreht das Bild um seine Mitte – etwa bis ein Pol im Bild auf dem Pol liegt."
                >
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={fit.placement.turnDeg}
                    onChange={(event) => place_({ turnDeg: Number(event.target.value) })}
                  />
                </Field>
                <p className="wf-soft">
                  Mitte: {formatGeo(fit.placement)} · {formatKm(fit.placement.widthKm)} breit,{' '}
                  {formatKm((fit.placement.widthKm * fit.shape.height) / fit.shape.width)} hoch
                </p>
              </>
            ) : (
              <>
                <p className="wf-mute">
                  Klicke auf die Karte, wo die Mitte des Bildes liegen soll. Mit Höhe und Breite
                  bestimmst du, wie viel vom Planeten es überdeckt.
                </p>
                <Field label={`Höhe: ${Math.round(fit.placement.heightDeg)}° – von Nord nach Süd`}>
                  <input
                    type="range"
                    min={2}
                    max={180}
                    step={1}
                    value={fit.placement.heightDeg}
                    onChange={(event) => place_({ heightDeg: Number(event.target.value) })}
                  />
                </Field>
                <Field label={`Breite: ${Math.round(fit.placement.widthDeg)}° – von West nach Ost`}>
                  <input
                    type="range"
                    min={2}
                    max={360}
                    step={1}
                    value={fit.placement.widthDeg}
                    onChange={(event) => place_({ widthDeg: Number(event.target.value) })}
                  />
                </Field>
                <Checkbox
                  checked={fit.keepAspect}
                  onChange={(keepAspect) =>
                    setFit((current) => current && { ...current, keepAspect })
                  }
                >
                  Seitenverhältnis des Bildes halten
                </Checkbox>
                <p className="wf-soft">
                  Mitte: {formatGeo(fit.placement)} ·{' '}
                  {formatKm((fit.placement.heightDeg / 360) * 2 * Math.PI * planet.radiusKm)} von
                  Nord nach Süd
                </p>
              </>
            )}
            <div className="wf-atlas-card__acts">
              <Button
                size="sm"
                onClick={() => place_({ kind: 'grid', lat: 0, heightDeg: 180 })}
                title="Das Bild reicht vom Nordpol bis zum Südpol"
              >
                Von Pol zu Pol
              </Button>
              <Button size="sm" onClick={() => setFit(null)}>
                Verwerfen
              </Button>
              <Button size="sm" variant="primary" icon={<Check />} onClick={applyFit}>
                Übernehmen
              </Button>
            </div>
          </div>
        )}
        <div className="wf-atlas-search">
          <Search aria-hidden />
          <Input
            placeholder="Ort suchen …"
            value={query}
            aria-label="Ort suchen"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" aria-label="Suche leeren" onClick={() => setQuery('')}>
              <X />
            </button>
          )}
        </div>
        <div className="wf-atlas-side__filter">
          <Checkbox checked={onlyMissing} onChange={setOnlyMissing}>
            Nur Orte ohne Lage
          </Checkbox>
        </div>
        <div className="wf-atlas-side__list">
          {shown.length ? (
            shown.map((entry) => {
              const geo = placeGeo(data, entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className="wf-atlas-row"
                  data-current={entry.id === id}
                  title={placePath(data, entry.id)}
                  onClick={() => select(entry.id)}
                >
                  {geo ? (
                    <MapPin className={cx(!geo.own && 'wf-atlas-row__inherited')} aria-hidden />
                  ) : (
                    <MapPinOff className="wf-atlas-row__none" aria-hidden />
                  )}
                  <span className="wf-atlas-row__name">{entry.name}</span>
                  <span className="wf-atlas-row__state">
                    {geo
                      ? geo.own
                        ? ''
                        : geo.exact
                          ? 'über Karte'
                          : `wie ${geo.from.name}`
                      : 'ohne Lage'}
                  </span>
                </button>
              );
            })
          ) : (
            <p className="wf-atlas-side__none">
              {places.length
                ? 'Kein Ort passt dazu.'
                : 'Es gibt noch keine Orte. Lege sie in der Welt an oder schreibe sie im Wiki.'}
            </p>
          )}
        </div>

        {ownLands.length > 0 && !fit && (
          <div className="wf-atlas-lands">
            <div className="wf-atlas-lands__title">Aus Bildern eingelesen</div>
            {ownLands.map((land) => (
              <div key={land.id} className="wf-atlas-lands__row">
                <span>{land.name || 'Ohne Namen'}</span>
                <button
                  type="button"
                  className="wf-atlas-lands__relief"
                  aria-pressed={land.relief !== 'flat'}
                  title={
                    land.relief === 'flat'
                      ? 'Flaches Land. Anklicken: Wayfarer erzeugt Höhen – an der Küste niedrig, im Inneren Gebirgszüge.'
                      : 'Die Höhen sind von Wayfarer erzeugt. Anklicken: flaches Land ohne Höhen.'
                  }
                  onClick={() =>
                    setLandRelief(db, land.id, land.relief === 'flat' ? 'generated' : 'flat')
                  }
                >
                  {land.relief === 'flat' ? 'flach' : 'Gelände erzeugt'}
                </button>
                <IconButton
                  label={`„${land.name}“ vom Planeten nehmen`}
                  size="sm"
                  variant="ghost"
                  onClick={() => void dropLand(land)}
                >
                  <Trash2 />
                </IconButton>
              </div>
            ))}
          </div>
        )}
        {place && (
          <div className="wf-atlas-card">
            <div className="wf-atlas-card__name">{place.name}</div>
            {located ? (
              <dl className="wf-atlas-card__facts">
                <dt>Lage</dt>
                <dd>
                  {formatGeo(located.geo)}
                  {!located.own &&
                    (located.exact && located.via
                      ? ` – gerechnet aus der Karte „${located.via.name}“`
                      : ` – übernommen von ${located.from.name}`)}
                </dd>
                <dt>Dort</dt>
                <dd>{describeTerrain(terrainAt(planet, grid, located.geo))}</dd>
                {leg && (
                  <>
                    <dt>Von der Gruppe</dt>
                    <dd>
                      {formatKm(leg.km)} Luftlinie nach {leg.direction} · zu Fuß etwa{' '}
                      {formatDays(travelDays(leg.km))}
                    </dd>
                  </>
                )}
                {daylight !== null && (
                  <>
                    <dt>Tageslicht heute</dt>
                    <dd>{formatHours(daylight)}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="wf-mute">Dieser Ort hat noch keine Lage.</p>
            )}
            {!located?.exact &&
              onMaps
                .filter((entry) => !entry.anchored)
                .slice(0, 2)
                .map((entry) => (
                  <p key={entry.map.id} className="wf-mute">
                    Liegt auf der Karte „{entry.map.name}“. Sobald dort zwei Orte eine Lage haben,
                    ergibt sich die aller anderen von selbst –{' '}
                    {entry.placed === 0 ? 'noch fehlen beide' : 'noch fehlt einer'}.
                  </p>
                ))}
            <div className="wf-atlas-card__acts">
              <Button
                size="sm"
                variant={placing ? 'primary' : undefined}
                icon={<Crosshair />}
                onClick={() => setPlacing((on) => !on)}
              >
                {placing ? 'Auf die Karte klicken …' : located?.own ? 'Neu setzen' : 'Lage setzen'}
              </Button>
              {place.place.geo && (
                <Button size="sm" onClick={clear}>
                  Lage entfernen
                </Button>
              )}
              <Button size="sm" onClick={() => navigate(entityHref(place))}>
                In der Welt öffnen
              </Button>
            </div>
          </div>
        )}
      </aside>

      <div className="wf-atlas-main">
        <View
          planet={planet}
          grid={grid}
          places={mapPlaces}
          selectedId={place?.id ?? null}
          party={party?.geo ?? null}
          placing={fit !== null || (placing && place !== null)}
          focus={focus}
          draft={draft}
          onPick={pick}
          onSelect={select}
          onHover={setHover}
        />
        <div className="wf-atlas-shape" role="group" aria-label="Ansicht">
          {(
            [
              ['map', 'Karte', 'Die ganze Welt flach ausgebreitet'],
              ['globe', 'Kugel', 'Der Planet als drehbare Kugel'],
            ] as const
          ).map(([key, label, hint]) => (
            <button
              key={key}
              type="button"
              aria-pressed={shape === key}
              title={hint}
              onClick={() => {
                memory.shape = key;
                setShape(key);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="wf-atlas-readout" aria-live="off">
          {fit ? (
            <b>Klicke dorthin, wo die Mitte von „{fit.name}“ liegt.</b>
          ) : placing && place ? (
            <b>Klicke dorthin, wo „{place.name}“ liegt.</b>
          ) : (
            <span>{planet.doc.name || 'Der Planet'}</span>
          )}
          {hover && hoverTerrain && (
            <span className="wf-num">
              {formatGeo(hover)} · {describeTerrain(hoverTerrain)}
            </span>
          )}
        </div>
      </div>
      {tracing && (
        <TraceDialog
          onClose={() => setTracing(false)}
          onTraced={(name, traced) => {
            setTracing(false);
            // Anfangs als Gebiet, ein Zehntel des Umfangs breit. Als Weltstreifen wäre es ein
            // Sechstel des Planeten hoch; die Breite folgt dem Bild.
            const heightDeg = 60;
            setFit({
              name,
              shape: traced,
              keepAspect: true,
              placement: {
                kind: 'local',
                lon: focus?.lon ?? 0,
                lat: 0,
                widthKm: Math.round((planet.radiusKm * 2 * Math.PI) / 10 / 100) * 100,
                turnDeg: 0,
                heightDeg,
                widthDeg: Math.min(360, (heightDeg * traced.width) / traced.height),
              },
            });
          }}
        />
      )}
    </div>
  );
}
