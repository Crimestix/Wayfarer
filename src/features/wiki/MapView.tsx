/** Eine Karte aus dem Wiki: das Bild, die Punkte darauf und eingezeichnete Wege und Gebiete. */
import { useState } from 'react';
import { useLocation } from 'wouter';
import { ImageOff, Minus, Plus } from 'lucide-react';
import { useData } from '../../data/hooks';
import type { GameMap, MapMarker } from '../../domain/schema';
import { Checkbox, IconButton, cx, entityHref } from '../../ui';

/** Vergrößerungen: 1 = die ganze Karte in der Breite. */
const ZOOMS = [1, 1.5, 2.25, 3.5, 5];

export function MapView({ map }: { map: GameMap }) {
  const data = useData();
  const [, navigate] = useLocation();
  const [zoom, setZoom] = useState(0);
  const [labels, setLabels] = useState(true);
  const [broken, setBroken] = useState(false);
  const frame = map.frame;

  if (!map.image || !frame)
    return <p className="wf-lk-blank">Zu dieser Karte liegt kein Kartenbild vor.</p>;

  const target = (marker: MapMarker): string | null => {
    if (marker.articleId && data.articles[marker.articleId]) return `/wiki/${marker.articleId}`;
    const entity = marker.entityId ? data.entities[marker.entityId] : undefined;
    return entity ? entityHref(entity) : null;
  };
  const nameOf = (marker: MapMarker): string =>
    marker.label ||
    (marker.articleId ? data.articles[marker.articleId]?.title : undefined) ||
    (marker.entityId ? data.entities[marker.entityId]?.name : undefined) ||
    '';
  const named = map.markers
    .map((marker) => ({ marker, name: nameOf(marker), href: target(marker) }))
    .filter((entry) => entry.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  return (
    <div className="wf-wiki-map">
      <div className="wf-wiki-map__bar">
        <span className="wf-wiki-map__count">
          {map.markers.length === 1 ? '1 Kartenpunkt' : `${map.markers.length} Kartenpunkte`}
          {map.shapes.length > 0 &&
            ` · ${map.shapes.length === 1 ? '1 Weg oder Gebiet' : `${map.shapes.length} Wege und Gebiete`}`}
        </span>
        {map.markers.length > 0 && (
          <Checkbox checked={labels} onChange={setLabels}>
            Namen zeigen
          </Checkbox>
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
            Das Kartenbild ließ sich nicht laden. Es liegt noch bei LegendKeeper – ohne Verbindung
            ins Netz oder nach einer Kündigung dort ist es nicht erreichbar.
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
            <img src={map.image} alt={map.name} onError={() => setBroken(true)} />
            {map.shapes.length > 0 && (
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
              </svg>
            )}
            {map.markers.map((marker) => {
              const href = target(marker);
              const name = nameOf(marker);
              return (
                <button
                  key={marker.id}
                  type="button"
                  className={cx('wf-wiki-pin', href && 'wf-wiki-pin--linked')}
                  style={{
                    left: `${(marker.x / frame.width) * 100}%`,
                    top: `${(marker.y / frame.height) * 100}%`,
                  }}
                  title={name ? (href ? `${name} öffnen` : name) : undefined}
                  aria-label={name || 'Kartenpunkt ohne Namen'}
                  disabled={!href}
                  onClick={() => href && navigate(href)}
                >
                  <span className="wf-wiki-pin__dot" aria-hidden />
                  {labels && name && <span className="wf-wiki-pin__label">{name}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {named.length > 0 && (
        <nav className="wf-lk-children" aria-label="Punkte auf dieser Karte">
          <div className="wf-lk-label">Auf dieser Karte</div>
          <p>
            {named.map(({ marker, name, href }, index) => (
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
                    onClick={() => navigate(href)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') navigate(href);
                    }}
                  >
                    {name}
                  </span>
                ) : (
                  name
                )}
              </span>
            ))}
          </p>
        </nav>
      )}
    </div>
  );
}
