/**
 * Atlas – der Planet und wo alles liegt. Links die Orte, rechts die Weltkarte. Ein Ort bekommt
 * seine Lage, indem man ihn wählt und auf die Karte klickt; Orte darunter erben sie.
 */
import { useMemo, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { Crosshair, Globe as GlobeIcon, MapPin, MapPinOff, Search, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entitiesOfKind, placeAncestors, placePath } from '../../domain/derive';
import type { LonLat } from '../../domain/geo';
import type { Place } from '../../domain/schema';
import { Button, Checkbox, EmptyState, Input, cx, entityHref, toast } from '../../ui';
import { setPlaceGeo } from './actions';
import {
  daylightAt,
  describeTerrain,
  formatGeo,
  formatHours,
  formatKm,
  legBetween,
  placeGeo,
  placedPlaces,
  planetOf,
  reliefOf,
  terrainAt,
} from './model';
import { Globe } from './Globe';
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
  const located = place ? placeGeo(data, place.id) : null;
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

  const select = (placeId: string) => {
    const target = placeGeo(data, placeId);
    navigate(`/atlas/${placeId}`);
    setPlacing(target === null);
    if (target) setFocus({ ...target.geo });
  };

  const pick = (point: LonLat) => {
    if (!place || !placing) return;
    const undo = setPlaceGeo(db, place.id, point);
    setPlacing(false);
    toast({
      title: `„${place.name}“ liegt jetzt hier`,
      body: `${formatGeo(point)} · ${describeTerrain(terrainAt(planet, grid, point))}`,
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
            {placed.length} von {places.length} Orten gesetzt
          </span>
        </div>
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
                    {geo ? (geo.own ? '' : `wie ${geo.from.name}`) : 'ohne Lage'}
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

        {place && (
          <div className="wf-atlas-card">
            <div className="wf-atlas-card__name">{place.name}</div>
            {located ? (
              <dl className="wf-atlas-card__facts">
                <dt>Lage</dt>
                <dd>
                  {formatGeo(located.geo)}
                  {!located.own && ` – übernommen von ${located.from.name}`}
                </dd>
                <dt>Dort</dt>
                <dd>{describeTerrain(terrainAt(planet, grid, located.geo))}</dd>
                {leg && (
                  <>
                    <dt>Von der Gruppe</dt>
                    <dd>
                      {formatKm(leg.km)} Luftlinie nach {leg.direction}
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
          placing={placing && place !== null}
          focus={focus}
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
          {placing && place ? (
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
    </div>
  );
}
