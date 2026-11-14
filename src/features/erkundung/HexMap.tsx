/** Die gezeichnete Hexkarte: Gelände, Besonderheiten, Orte und der direkte Weg. */
import { memo, useMemo, type ReactNode } from 'react';
import { hexCenter, hexCorners, hexKey, hexNeighbors, type HexCoord } from '../../domain/hex';
import type { Area, CampaignData, Hex, Terrain } from '../../domain/schema';
import { TERRAIN_LABEL } from '../../domain/terrain';
import { areaLine } from './generate';
import { partyMeans } from '../../domain/mounts';
import { hexMinutes } from './travel';

/** Zeichen im Feld, je Gelände; gezeichnet in einem Feld der Größe 1 um den Ursprung. */
const GLYPH: Record<Terrain, ReactNode> = {
  grassland: <path d="M-0.16 0.1 l0.05 -0.12 l0.05 0.12 M0.06 0.14 l0.05 -0.12 l0.05 0.12" />,
  forest: (
    <path d="M-0.2 0.14 l0.1 -0.24 l0.1 0.24 z M0.02 0.16 l0.11 -0.28 l0.11 0.28 z" data-fill />
  ),
  hills: <path d="M-0.26 0.1 q0.12 -0.22 0.24 0 M-0.02 0.12 q0.13 -0.24 0.26 0" />,
  mountains: <path d="M-0.28 0.16 l0.15 -0.32 l0.1 0.2 l0.07 -0.12 l0.14 0.24" />,
  swamp: (
    <path d="M-0.24 0.02 h0.2 M-0.06 0.12 h0.26 M0.04 -0.08 h0.18 M-0.14 0.02 v-0.1 M0.08 0.12 v-0.1" />
  ),
  desert: (
    <path d="M-0.18 -0.04 h0.001 M0.02 0.06 h0.001 M0.16 -0.08 h0.001 M-0.06 0.14 h0.001 M0.12 0.14 h0.001" />
  ),
  arctic: <path d="M0 -0.16 v0.32 M-0.14 -0.08 l0.28 0.16 M-0.14 0.08 l0.28 -0.16" />,
  coast: (
    <path d="M-0.24 0.06 q0.06 -0.08 0.12 0 t0.12 0 t0.12 0 t0.12 0 M-0.1 -0.1 h0.001 M0.1 -0.08 h0.001" />
  ),
  water: (
    <path d="M-0.24 -0.04 q0.06 -0.08 0.12 0 t0.12 0 t0.12 0 t0.12 0 M-0.24 0.1 q0.06 -0.08 0.12 0 t0.12 0 t0.12 0 t0.12 0" />
  ),
  underdark: <path d="M-0.2 -0.12 l0.06 0.2 l0.06 -0.2 M0.04 -0.12 l0.07 0.26 l0.07 -0.26" />,
  urban: <path d="M-0.14 0.12 v-0.16 l0.14 -0.1 l0.14 0.1 v0.16 z" />,
};

interface Props {
  area: Area;
  data: CampaignData;
  /** Größe eines Feldes in Bildpunkten (Abstand zweier Nachbarn). */
  size: number;
  selected: HexCoord | null;
  onSelect: (hex: HexCoord | null) => void;
  /** Der geplante Weg der Gruppe zum Ziel, ab dem nächsten Schritt. */
  plan?: readonly HexCoord[];
}

interface Cell {
  hex: Hex;
  x: number;
  y: number;
  points: string;
}

/** Eine Karte kann über tausend Felder haben; neu gezeichnet wird nur, wenn sich wirklich etwas ändert. */
const Cells = memo(function Cells({
  cells,
  size,
  onSelect,
}: {
  cells: Cell[];
  size: number;
  onSelect: (hex: HexCoord) => void;
}) {
  return (
    <>
      {cells.map(({ hex, x, y, points }) => (
        <g
          key={hexKey(hex)}
          className="wf-hex"
          data-terrain={hex.terrain ?? 'none'}
          data-hidden={!hex.discovered || undefined}
          onClick={() => onSelect({ q: hex.q, r: hex.r })}
        >
          <polygon points={points} />
          {hex.terrain && size >= 22 && (
            <g className="wf-hex__glyph" transform={`translate(${x} ${y}) scale(${size})`}>
              {GLYPH[hex.terrain]}
            </g>
          )}
          {hex.river && hex.discovered && (
            <path
              className="wf-hex__river"
              d={`M ${x - size * 0.34} ${y + size * 0.08} q ${size * 0.085} ${-size * 0.12} ${size * 0.17} 0 t ${size * 0.17} 0 t ${size * 0.17} 0 t ${size * 0.17} 0`}
            />
          )}
          {hex.feature && (
            <rect
              className="wf-hex__feature"
              x={x - size * 0.07}
              y={y + size * 0.24}
              width={size * 0.14}
              height={size * 0.14}
              transform={`rotate(45 ${x} ${y + size * 0.31})`}
            />
          )}
          {(hex.note || hex.prepared) && (
            <circle
              className="wf-hex__note"
              cx={x + size * 0.26}
              cy={y - size * 0.26}
              r={size * 0.07}
            />
          )}
          <title>
            {[
              hex.terrain ? TERRAIN_LABEL[hex.terrain] : 'Ohne Gelände',
              hex.river && (hex.river === 'Fluss' ? 'ein Fluss' : `Fluss ${hex.river}`),
              hex.feature,
              hex.discovered ? '' : 'noch nicht entdeckt',
            ]
              .filter(Boolean)
              .join(' · ')}
          </title>
        </g>
      ))}
    </>
  );
});

export function HexMap({ area, data, size, selected, onSelect, plan }: Props) {
  const orientation = area.orientation;
  const layout = useMemo(() => {
    const cells: Cell[] = area.hexes.map((hex) => {
      const c = hexCenter(hex, orientation);
      return {
        hex,
        x: c.x * size,
        y: c.y * size,
        points: hexCorners(hex, orientation)
          .map((p) => `${(p.x * size).toFixed(1)},${(p.y * size).toFixed(1)}`)
          .join(' '),
      };
    });
    const xs = cells.map((c) => c.x);
    const ys = cells.map((c) => c.y);
    const pad = size * 1.2;
    const minX = Math.min(...xs, 0) - pad;
    const minY = Math.min(...ys, 0) - pad;
    return {
      cells,
      minX,
      minY,
      width: Math.max(...xs, 0) - minX + pad,
      height: Math.max(...ys, 0) - minY + pad,
    };
  }, [area.hexes, orientation, size]);

  const line = useMemo(
    () =>
      areaLine(area)
        .map((hex) => {
          const c = hexCenter(hex, orientation);
          return `${(c.x * size).toFixed(1)},${(c.y * size).toFixed(1)}`;
        })
        .join(' '),
    [area, orientation, size],
  );
  const places = layout.cells.filter((c) => c.hex.placeId && data.entities[c.hex.placeId]);

  // Die Gruppe auf der Karte: wo sie steht, woher sie kam, wohin sie als Nächstes kann.
  const party = area.party;
  const by = partyMeans(data);
  const at = (hex: HexCoord) => {
    const c = hexCenter(hex, orientation);
    return `${(c.x * size).toFixed(1)},${(c.y * size).toFixed(1)}`;
  };
  const here = party ? hexCenter(party, orientation) : null;
  const trail = party && party.trail.length ? [...party.trail, party].map(at).join(' ') : '';
  const planned = party && plan?.length ? [party, ...plan].map(at).join(' ') : '';
  const reach = party
    ? hexNeighbors(party)
        .map((coord) => layout.cells.find((c) => c.hex.q === coord.q && c.hex.r === coord.r))
        .filter(
          (cell): cell is Cell =>
            !!cell && hexMinutes(area.hexKm, cell.hex.terrain, party.pace, by) !== null,
        )
    : [];
  const chosen = selected
    ? layout.cells.find((c) => c.hex.q === selected.q && c.hex.r === selected.r)
    : undefined;

  if (!area.hexes.length) return null;
  return (
    <svg
      className="wf-hexmap"
      width={layout.width}
      height={layout.height}
      viewBox={`${layout.minX} ${layout.minY} ${layout.width} ${layout.height}`}
      role="img"
      aria-label={`Hexkarte ${area.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      <Cells cells={layout.cells} size={size} onSelect={onSelect} />
      {line && <polyline className="wf-hexmap__route" points={line} />}
      {places.map(({ hex, x, y }) => {
        const place = data.entities[hex.placeId!]!;
        const end = hex.placeId === area.fromId || hex.placeId === area.toId;
        return (
          <g key={hexKey(hex)} className="wf-hexmap__place" data-end={end || undefined}>
            <circle cx={x} cy={y} r={size * (end ? 0.2 : 0.14)} />
            <text
              x={x}
              y={y - size * 0.34}
              textAnchor="middle"
              style={{ fontSize: Math.max(11, size * 0.3) }}
            >
              {place.name}
            </text>
          </g>
        );
      })}
      {reach.map((cell) => (
        <polygon key={hexKey(cell.hex)} className="wf-hexmap__reach" points={cell.points} />
      ))}
      {trail && <polyline className="wf-hexmap__trail" points={trail} />}
      {planned && <polyline className="wf-hexmap__plan" points={planned} />}
      {here && (
        <g className="wf-hexmap__party">
          <circle cx={here.x * size} cy={here.y * size} r={Math.max(6, size * 0.3)} />
          <circle
            className="wf-hexmap__party-core"
            cx={here.x * size}
            cy={here.y * size}
            r={Math.max(3, size * 0.14)}
          />
          <title>Hier ist die Gruppe</title>
        </g>
      )}
      {chosen && <polygon className="wf-hexmap__chosen" points={chosen.points} />}
    </svg>
  );
}
