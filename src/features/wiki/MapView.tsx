/**
 * Eine Karte aus dem Wiki: das Bild, die Punkte darauf und eingezeichnete Wege und Gebiete.
 * Der Punkt, an dem die Gruppe gerade ist, ist hervorgehoben. Ein Klick auf einen Punkt bietet
 * an, was sich damit tun lässt: Artikel lesen, Eintrag der Welt öffnen, die Gruppe dorthin
 * versetzen.
 */
import { useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { BookOpen, Footprints, ImageOff, Minus, Plus } from 'lucide-react';
import { useData } from '../../data/hooks';
import { useMediaSrc } from '../../data/media';
import { markerOfPlace } from '../../domain/mapDraw';
import type { GameMap, MapMarker } from '../../domain/schema';
import { formatWayTime, wayLine, wayMinutes } from '../../domain/ways';
import { openMoveParty } from '../../shell/commands';
import { Checkbox, IconButton, KindIcon, MenuItem, Popover, cx, entityHref } from '../../ui';
import './wiki.css';

/** Vergrößerungen: 1 = die ganze Karte in der Breite. */
const ZOOMS = [1, 1.5, 2.25, 3.5, 5];

export function MapView({
  map,
  onLeave,
}: {
  map: GameMap;
  /** Wird gerufen, bevor ein Klick von der Karte wegführt – etwa um einen Dialog zu schließen. */
  onLeave?: () => void;
}) {
  const data = useData();
  const [, navigate] = useLocation();
  const [zoom, setZoom] = useState(0);
  const [labels, setLabels] = useState(true);
  const [broken, setBroken] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const src = useMediaSrc();
  const frame = map.frame;

  // Wo die Gruppe auf dieser Karte steht: ihr Ort selbst, sonst der nächste Ort darüber, der
  // hier eingetragen ist.
  // Die Wege des Wegenetzes, deren beide Orte auf dieser Karte liegen – als Linien.
  const ways = useMemo(
    () =>
      Object.values(data.paths)
        .map((path) => ({ path, line: wayLine(map, path), minutes: wayMinutes(data, path) }))
        .filter((way) => way.line !== null),
    [data, map],
  );
  const partyPlaceId = data.state.placeId;
  const hereId = useMemo(
    () => markerOfPlace(data, map, partyPlaceId)?.id ?? null,
    [data, map, partyPlaceId],
  );

  if (!map.image || !frame)
    return <p className="wf-lk-blank">Zu dieser Karte liegt kein Kartenbild vor.</p>;

  const optionsOf = (marker: MapMarker) => {
    const article = marker.articleId ? data.articles[marker.articleId] : undefined;
    const entity = marker.entityId ? data.entities[marker.entityId] : undefined;
    return {
      article,
      entity,
      move: entity?.kind === 'place' && entity.id !== partyPlaceId ? entity : undefined,
    };
  };
  const nameOf = (marker: MapMarker): string =>
    marker.label ||
    (marker.articleId ? data.articles[marker.articleId]?.title : undefined) ||
    (marker.entityId ? data.entities[marker.entityId]?.name : undefined) ||
    '';
  const go = (href: string) => {
    setMenu(null);
    onLeave?.();
    navigate(href);
  };
  const named = map.markers
    .map((marker) => ({ marker, name: nameOf(marker), ...optionsOf(marker) }))
    .filter((entry) => entry.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const open = menu ? map.markers.find((m) => m.id === menu) : undefined;
  const openOptions = open ? optionsOf(open) : null;

  return (
    <div className="wf-wiki-map">
      <div className="wf-wiki-map__bar">
        <span className="wf-wiki-map__count">
          {map.markers.length === 0
            ? map.shapes.length === 0
              ? 'Ohne Kartenpunkte'
              : ''
            : map.markers.length === 1
              ? '1 Kartenpunkt'
              : `${map.markers.length} Kartenpunkte`}
          {map.shapes.length > 0 &&
            `${map.markers.length ? ' · ' : ''}${map.shapes.length === 1 ? '1 Weg oder Gebiet' : `${map.shapes.length} Wege und Gebiete`}`}
        </span>
        {map.markers.length > 0 && (
          <Checkbox checked={labels} onChange={setLabels}>
            Namen zeigen
          </Checkbox>
        )}
        {hereId && (
          <span className="wf-wiki-map__here">
            <span className="wf-wiki-pin__dot wf-wiki-pin__dot--here" aria-hidden />
            Hier ist die Gruppe
          </span>
        )}
        <span className="wf-wiki-map__zoom">
          <IconButton
            label="Kleiner"
            onClick={() => setZoom((z) => Math.max(0, z - 1))}
            disabled={zoom === 0}
          >
            <Minus />
          </IconButton>
          <IconButton
            label="Größer"
            onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
            disabled={zoom === ZOOMS.length - 1}
          >
            <Plus />
          </IconButton>
        </span>
      </div>

      {broken ? (
        <div className="wf-wiki-map__broken">
          <ImageOff aria-hidden />
          <p>
            Das Kartenbild ließ sich nicht laden. Es liegt noch im Netz – ohne Verbindung ist es
            nicht erreichbar. In den Einstellungen lassen sich alle Bilder auf diesen Rechner holen.
          </p>
        </div>
      ) : (
        <div className="wf-wiki-map__view">
          <div
            className="wf-wiki-map__sheet"
            style={{
              width: `${ZOOMS[zoom]! * 100}%`,
              aspectRatio: `${frame.width} / ${frame.height}`,
            }}
          >
            <img src={src(map.image)} alt={map.name} onError={() => setBroken(true)} />
            {(map.shapes.length > 0 || ways.length > 0) && (
              <svg
                viewBox={`0 0 ${frame.width} ${frame.height}`}
                preserveAspectRatio="none"
                aria-hidden
              >
                {map.shapes.map((shape) =>
                  shape.kind === 'region' ? (
                    <polygon
                      key={shape.id}
                      className="wf-wiki-map__region"
                      points={shape.points.map((p) => p.join(',')).join(' ')}
                    >
                      {shape.label && <title>{shape.label}</title>}
                    </polygon>
                  ) : (
                    <polyline
                      key={shape.id}
                      className="wf-wiki-map__path"
                      points={shape.points.map((p) => p.join(',')).join(' ')}
                    >
                      {shape.label && <title>{shape.label}</title>}
                    </polyline>
                  ),
                )}
                {ways.map(({ path, line, minutes }) => (
                  <polyline
                    key={path.id}
                    className={cx('wf-wiki-map__way', path.secret && 'wf-wiki-map__way--secret')}
                    points={line!.map((p) => p.join(',')).join(' ')}
                  >
                    <title>
                      {[
                        path.name || 'Weg',
                        minutes === null ? '' : formatWayTime(minutes),
                        path.conditions,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </title>
                  </polyline>
                ))}
              </svg>
            )}
            {map.markers.map((marker) => {
              const options = optionsOf(marker);
              const linked = Boolean(options.article || options.entity);
              const name = nameOf(marker);
              const here = marker.id === hereId;
              return (
                <button
                  key={marker.id}
                  type="button"
                  className={cx(
                    'wf-wiki-pin',
                    linked && 'wf-wiki-pin--linked',
                    here && 'wf-wiki-pin--here',
                  )}
                  style={{
                    left: `${(marker.x / frame.width) * 100}%`,
                    top: `${(marker.y / frame.height) * 100}%`,
                  }}
                  title={here ? `${name} – hier ist die Gruppe` : name || undefined}
                  aria-label={name || 'Kartenpunkt ohne Namen'}
                  aria-haspopup={linked ? 'menu' : undefined}
                  disabled={!linked}
                  onClick={(event) => {
                    anchor.current = event.currentTarget;
                    setMenu((current) => (current === marker.id ? null : marker.id));
                  }}
                >
                  <span
                    className={cx('wf-wiki-pin__dot', here && 'wf-wiki-pin__dot--here')}
                    aria-hidden
                  />
                  {(labels || here) && name && <span className="wf-wiki-pin__label">{name}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <Popover open={open !== undefined} onClose={() => setMenu(null)} anchor={anchor} width={260}>
        {open && openOptions && (
          <>
            <div className="wf-wiki-map__menuhead">{nameOf(open)}</div>
            {openOptions.article && (
              <MenuItem icon={<BookOpen />} onClick={() => go(`/wiki/${openOptions.article!.id}`)}>
                Artikel lesen
              </MenuItem>
            )}
            {openOptions.entity && (
              <MenuItem
                icon={<KindIcon kind={openOptions.entity.kind} />}
                onClick={() => go(entityHref(openOptions.entity!))}
              >
                In der Welt öffnen
              </MenuItem>
            )}
            {openOptions.move && (
              <MenuItem
                icon={<Footprints />}
                onClick={() => {
                  const placeId = openOptions.move!.id;
                  setMenu(null);
                  onLeave?.();
                  openMoveParty({ placeId });
                }}
              >
                Gruppe hierher versetzen …
              </MenuItem>
            )}
          </>
        )}
      </Popover>

      {named.length > 0 && (
        <nav className="wf-lk-children" aria-label="Punkte auf dieser Karte">
          <div className="wf-lk-label">Auf dieser Karte</div>
          <p>
            {named.map(({ marker, name, article, entity }, index) => {
              const href = article ? `/wiki/${article.id}` : entity ? entityHref(entity) : null;
              return (
                <span key={marker.id}>
                  {index > 0 && (
                    <span className="wf-lk-children__sep" aria-hidden>
                      ·
                    </span>
                  )}
                  {href ? (
                    <span
                      role="link"
                      tabIndex={0}
                      className="wf-lk-mention"
                      onClick={() => go(href)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') go(href);
                      }}
                    >
                      {name}
                    </span>
                  ) : (
                    name
                  )}
                </span>
              );
            })}
          </p>
        </nav>
      )}
    </div>
  );
}
