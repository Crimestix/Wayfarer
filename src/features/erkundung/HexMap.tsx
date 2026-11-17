/** Die gezeichnete Hexkarte: Gelände, Besonderheiten, Orte und der direkte Weg. */
import { lairsOnArea } from '../../domain/landscape';
import { kindKeyOf, kindLabelOf } from '../../domain/hexKinds';
import { memo, useMemo, type ReactNode } from 'react';
import {
  HEX_DIRECTIONS,
  hexCenter,
  hexCorners,
  hexKey,
  hexNeighbors,
  sameHex,
  type HexCoord,
} from '../../domain/hex';
import { PASSAGE_LABEL, indexHexes, isRock, passagesFrom } from '../../domain/passages';
import type { Area, CampaignData, Hex, Terrain } from '../../domain/schema';
import { areaLine } from './generate';
import { partyMeans } from '../../domain/mounts';
import { hexMinutes } from './travel';

/** Zeichen im Feld, je Gelände; gezeichnet in einem Feld der Größe 1 um den Ursprung. */
export const GLYPH: Record<Terrain, ReactNode> = {
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

/**
 * Zeichen der Geländearten (`domain/hexKinds.ts`) – kleine Striche in Feldgröße 1. Arten ohne
 * eigenes Zeichen tragen das ihres Grundgeländes.
 */
export const KIND_GLYPH: Record<string, ReactNode> = {
  meadow: (
    <path d="M-0.2 0.1 v-0.08 M-0.12 0.1 v-0.12 M0 0.12 v-0.1 M0.1 0.1 v-0.14 M0.2 0.12 v-0.08" />
  ),
  farmland: <path d="M-0.24 -0.08 h0.48 M-0.24 0.02 h0.48 M-0.24 0.12 h0.48" />,
  valley: <path d="M-0.26 -0.1 q0.26 0.3 0.52 0" />,
  heath: (
    <path d="M-0.18 0.1 l0.04 -0.08 l0.04 0.08 M0.02 0.12 l0.04 -0.08 l0.04 0.08 M-0.08 -0.04 l0.04 -0.08 l0.04 0.08" />
  ),
  steppe: (
    <path d="M-0.24 0.06 h0.12 M-0.04 0.06 h0.12 M0.14 0.06 h0.1 M-0.14 -0.06 h0.12 M0.06 -0.06 h0.12" />
  ),
  savanna: (
    <path d="M-0.02 0.14 v-0.18 M-0.16 -0.06 q0.14 -0.1 0.28 0 M-0.24 0.14 h0.08 M0.14 0.14 h0.1" />
  ),
  'dense-forest': (
    <path
      d="M-0.26 0.14 l0.09 -0.22 l0.09 0.22 z M-0.06 0.16 l0.1 -0.26 l0.1 0.26 z M0.12 0.12 l0.08 -0.2 l0.08 0.2 z"
      data-fill
    />
  ),
  pine: <path d="M0 -0.2 l0.12 0.18 h-0.08 l0.1 0.14 h-0.28 l0.1 -0.14 h-0.08 z" data-fill />,
  jungle: (
    <path d="M-0.16 0.14 q0 -0.2 0.12 -0.24 M-0.04 -0.1 q0.14 -0.04 0.2 0.08 M0.08 0.14 q0 -0.16 -0.1 -0.22" />
  ),
  glade: (
    <path d="M-0.2 0.12 l0.07 -0.18 l0.07 0.18 z M0.1 0.12 h0.001 M0.18 0.02 h0.001" data-fill />
  ),
  'dead-forest': (
    <path d="M-0.1 0.16 v-0.3 M-0.1 -0.04 l-0.08 -0.08 M-0.1 -0.08 l0.08 -0.08 M0.12 0.16 v-0.22 M0.12 0 l0.06 -0.06" />
  ),
  marsh: <path d="M-0.22 0.08 h0.44 M-0.12 0.08 v-0.14 M0 0.08 v-0.2 M0.12 0.08 v-0.12" />,
  bog: (
    <path d="M-0.22 0.02 q0.11 0.08 0.22 0 t0.22 0 M-0.12 0.14 h0.24 M-0.06 -0.1 h0.001 M0.1 -0.08 h0.001" />
  ),
  mangrove: (
    <path d="M0 -0.18 v0.2 M0 0.02 l-0.12 0.12 M0 0.02 l0.12 0.12 M-0.14 -0.12 q0.14 -0.1 0.28 0" />
  ),
  crag: (
    <path d="M-0.24 0.14 l0.08 -0.16 l0.06 0.06 l0.08 -0.18 l0.1 0.14 l0.06 -0.04 l0.08 0.18" />
  ),
  highpeak: (
    <path d="M-0.3 0.16 l0.18 -0.36 l0.1 0.18 l0.08 -0.14 l0.16 0.32 M-0.16 -0.08 l0.04 0.04 l0.04 -0.04" />
  ),
  volcano: (
    <path d="M-0.26 0.16 l0.16 -0.28 h0.2 l0.16 0.28 M-0.04 -0.16 q0.04 -0.08 0 -0.14 M0.06 -0.16 q0.06 -0.06 0.02 -0.12" />
  ),
  lava: <path d="M-0.24 -0.06 q0.12 0.1 0.24 0 t0.24 0 M-0.24 0.1 q0.12 0.1 0.24 0 t0.24 0" />,
  dunes: (
    <path d="M-0.26 0.08 q0.13 -0.16 0.26 0 M0 0.08 q0.13 -0.16 0.26 0 M-0.12 -0.06 q0.12 -0.12 0.24 0" />
  ),
  badlands: <path d="M-0.26 0.14 v-0.1 h0.1 v-0.08 h0.12 v0.08 h0.08 v-0.14 h0.1 v0.24" />,
  canyon: <path d="M-0.2 -0.16 q0.1 0.16 0 0.32 M0.2 -0.16 q-0.1 0.16 0 0.32" />,
  crater: <path d="M-0.18 0 a0.18 0.1 0 1 0 0.36 0 a0.18 0.1 0 1 0 -0.36 0" />,
  salt: (
    <path d="M-0.2 -0.06 l0.08 0.08 M0 -0.1 l0.08 0.08 M-0.12 0.08 l0.08 0.08 M0.1 0.06 l0.08 0.08" />
  ),
  oasis: (
    <path d="M-0.02 0.08 v-0.2 M-0.14 -0.08 q0.12 -0.1 0.24 0 M-0.2 0.14 q0.18 -0.08 0.36 0" />
  ),
  tundra: (
    <path d="M-0.2 0.06 h0.12 M0.04 0.06 h0.16 M-0.1 -0.06 h0.001 M0.12 -0.08 h0.001 M-0.02 0.14 h0.001" />
  ),
  glacier: (
    <path d="M-0.26 0.14 l0.12 -0.24 l0.08 0.1 l0.1 -0.14 l0.12 0.28 M-0.12 0.04 l0.08 0.04" />
  ),
  lake: <path d="M-0.16 0 q0.08 -0.06 0.16 0 t0.16 0" />,
  reef: (
    <path d="M-0.2 0.06 l0.06 -0.08 l0.06 0.08 l0.06 -0.08 l0.06 0.08 l0.06 -0.08 l0.06 0.08 M-0.2 -0.08 q0.1 -0.06 0.2 0" />
  ),
  village: (
    <path d="M-0.2 0.12 v-0.1 l0.08 -0.06 l0.08 0.06 v0.1 z M0.04 0.12 v-0.12 l0.08 -0.06 l0.08 0.06 v0.12 z" />
  ),
  ruins: (
    <path d="M-0.2 0.14 v-0.2 h0.06 v0.06 M0 0.14 v-0.12 h0.06 v0.04 M0.12 0.14 v-0.24 h0.06 v0.24" />
  ),
  fungus: (
    <path
      d="M-0.16 -0.02 q0.1 -0.14 0.2 0 z M-0.06 -0.02 v0.16 M0.08 0.04 q0.06 -0.08 0.12 0 z M0.14 0.04 v0.1"
      data-fill
    />
  ),
  crystal: (
    <path d="M-0.12 0.14 l-0.04 -0.16 l0.06 -0.12 l0.06 0.12 l-0.04 0.16 z M0.06 0.14 l0.02 -0.2 l0.08 0.08 l-0.02 0.12 z" />
  ),
  'deep-lake': <path d="M-0.2 0 q0.1 -0.08 0.2 0 t0.2 0 M-0.12 0.12 q0.06 -0.05 0.12 0 t0.12 0" />,
  magma: (
    <path d="M-0.22 -0.04 l0.1 0.06 l0.08 -0.08 l0.1 0.1 l0.12 -0.08 M-0.16 0.12 l0.1 -0.04 l0.12 0.06" />
  ),
};

interface Props {
  area: Area;
  data: CampaignData;
  /** Größe eines Feldes in Bildpunkten (Abstand zweier Nachbarn). */
  size: number;
  selected: HexCoord | null;
  /** `add`: mit Umschalt- oder Strg-Taste geklickt – zur Auswahl dazu (Vorbereiten). */
  onSelect: (hex: HexCoord | null, add?: boolean) => void;
  /** Weitere gewählte Felder (Vorbereiten: mehrere Felder auf einmal). */
  marked?: readonly HexCoord[];
  /** Unentdecktes gedämpft zeigen (Spielen); beim Vorbereiten sieht man alles. */
  fog?: boolean;
  /** Der geplante Weg der Gruppe zum Ziel, ab dem nächsten Schritt. */
  plan?: readonly HexCoord[];
  /** Die Ebene, die gezeigt wird (Unterreich); ohne Angabe die oberste. */
  level?: number;
  /**
   * Bearbeiten: Ein Strich beginnt mit dem Drücken auf ein Feld und geht über jedes Feld, über das
   * die Maus mit gedrückter Taste fährt. Ohne `paint` ist die Karte nur zum Ansehen.
   */
  paint?: {
    /** `pick`: mit Strg oder Alt gedrückt – das Gelände des Feldes aufnehmen (Pipette). */
    onStart: (hex: HexCoord, pick?: boolean) => void;
    onMove: (hex: HexCoord) => void;
    onEnd: () => void;
    /** Freie Plätze am Rand, an denen sich ein Feld anfügen lässt (Werkzeug „Felder“). */
    slots?: readonly HexCoord[];
    onSlot?: (hex: HexCoord) => void;
    /** Die Gegend, mit der gerade gemalt wird – ihre Felder treten hervor. */
    regionId?: string | null;
  };
}

interface Cell {
  hex: Hex;
  x: number;
  y: number;
  points: string;
}

/** Wohin von einem Feld unter der Erde Gänge führen, als Wörter für den Titel. */
function exitWords(hex: Hex): string {
  const exits = hex.exits ?? [];
  const sides = exits.filter((exit) => exit.dir < 6).length;
  const kinds = [...new Set(exits.map((exit) => exit.kind).filter((k) => k !== 'open'))].map(
    (kind) => PASSAGE_LABEL[kind],
  );
  return [
    `${sides} ${sides === 1 ? 'Ausgang' : 'Ausgänge'}`,
    exits.some((exit) => exit.dir === 6) && 'Schacht hinauf',
    exits.some((exit) => exit.dir === 7) && 'Schacht hinab',
    ...kinds,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Die Gänge eines Feldes unter der Erde: von der Mitte zu jeder offenen Seite, nach Art
 * gezeichnet; Höhlen (vier Ausgänge und mehr) als weite Kammer, Schächte als Dreieck.
 */
function Passages({ hex, x, y, size }: { hex: Hex; x: number; y: number; size: number }) {
  const exits = hex.exits ?? [];
  const sides = exits.filter((exit) => exit.dir < 6);
  const cave = sides.length >= 4;
  return (
    <g className="wf-hex__cave" pointerEvents="none">
      {sides.map((exit) => {
        const d = HEX_DIRECTIONS[exit.dir]!;
        const edge = hexCenter({ q: d.q, r: d.r });
        return (
          <line
            key={exit.dir}
            className={`wf-hex__gang wf-hex__gang--${exit.kind}`}
            x1={x}
            y1={y}
            x2={x + edge.x * size * 0.5}
            y2={y + edge.y * size * 0.5}
            style={{ strokeWidth: size * (exit.kind === 'narrow' ? 0.09 : 0.2) }}
          />
        );
      })}
      <circle
        className={cave ? 'wf-hex__chamber' : 'wf-hex__knot'}
        cx={x}
        cy={y}
        r={size * (cave ? 0.27 : 0.1)}
      />
      {hex.river && <circle className="wf-hex__pool" cx={x} cy={y} r={size * 0.08} />}
      {exits.some((exit) => exit.dir === 7) && (
        <path
          className="wf-hex__shaft"
          d={`M ${x - size * 0.12} ${y - size * 0.06} h ${size * 0.24} l ${-size * 0.12} ${size * 0.18} z`}
        />
      )}
      {exits.some((exit) => exit.dir === 6) && (
        <path
          className="wf-hex__shaft wf-hex__shaft--up"
          d={`M ${x - size * 0.12} ${y + size * 0.06} h ${size * 0.24} l ${-size * 0.12} ${-size * 0.18} z`}
        />
      )}
    </g>
  );
}

/** Eine Karte kann über tausend Felder haben; neu gezeichnet wird nur, wenn sich wirklich etwas ändert. */
const Cells = memo(function Cells({
  cells,
  size,
  onSelect,
  painting,
  fog,
  regionNames,
  landscapeNames,
  activeRegion,
}: {
  cells: Cell[];
  size: number;
  onSelect: (hex: HexCoord, add?: boolean) => void;
  painting: Props['paint'] | undefined;
  fog: boolean;
  regionNames: Record<string, string>;
  /** Namen der gemalten Landschaften – sie heißen auf dem Feld statt der Geländeart. */
  landscapeNames: Record<string, string>;
  activeRegion: string | null;
}) {
  return (
    <>
      {cells.map(({ hex, x, y, points }) => (
        <g
          key={hexKey(hex)}
          className="wf-hex"
          data-hex={`${hex.q},${hex.r},${hex.level}`}
          data-terrain={hex.terrain ?? 'none'}
          data-kind={kindKeyOf(hex) ?? undefined}
          data-hidden={(fog && !painting && !hex.discovered) || undefined}
          onClick={
            painting
              ? undefined
              : (event) =>
                  onSelect(
                    { q: hex.q, r: hex.r, level: hex.level },
                    event.shiftKey || event.ctrlKey || event.metaKey,
                  )
          }
          onPointerDown={
            painting
              ? (event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  painting.onStart(
                    { q: hex.q, r: hex.r, level: hex.level },
                    event.ctrlKey || event.altKey || event.metaKey,
                  );
                }
              : undefined
          }
        >
          <polygon
            points={points}
            data-rock={isRock(hex) || undefined}
            data-cave={(hex.exits !== null && !isRock(hex)) || undefined}
          />
          {hex.exits !== null && !isRock(hex) && <Passages hex={hex} x={x} y={y} size={size} />}
          {hex.regionId && (
            <polygon
              className="wf-hex__region"
              data-active={hex.regionId === activeRegion || undefined}
              points={points
                .split(' ')
                .map((pair) => {
                  const [px, py] = pair.split(',').map(Number);
                  return `${(x + (px! - x) * 0.8).toFixed(1)},${(y + (py! - y) * 0.8).toFixed(1)}`;
                })
                .join(' ')}
            />
          )}
          {hex.terrain && hex.exits === null && size >= 22 && (
            <g className="wf-hex__glyph" transform={`translate(${x} ${y}) scale(${size})`}>
              {KIND_GLYPH[kindKeyOf(hex) ?? ''] ?? GLYPH[hex.terrain]}
            </g>
          )}
          {hex.river && hex.discovered && hex.exits === null && (
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
          {hex.afar && (
            // Von fern zu sehen: eine kleine Spitze oben links.
            <path
              className="wf-hex__afar"
              data-sighted={hex.sighted || hex.discovered || undefined}
              d={`M ${x - size * 0.3} ${y - size * 0.14} L ${x - size * 0.24} ${y - size * 0.36} L ${x - size * 0.18} ${y - size * 0.14} Z`}
            />
          )}
          {hex.hidden && (
            // Verborgen: ein Ring unten links – gestrichelt, solange niemand gesucht hat.
            <circle
              className="wf-hex__hidden"
              data-searched={hex.searched || undefined}
              cx={x - size * 0.26}
              cy={y + size * 0.24}
              r={size * 0.07}
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
            {hex.regionId && regionNames[hex.regionId] ? `${regionNames[hex.regionId]} · ` : ''}
            {[
              isRock(hex)
                ? 'Fels'
                : (hex.landscapeId && landscapeNames[hex.landscapeId]) || kindLabelOf(hex),
              hex.exits !== null && !isRock(hex) && exitWords(hex),
              hex.river && (hex.river === 'Fluss' ? 'ein Fluss' : `Fluss ${hex.river}`),
              hex.feature,
              hex.afar &&
                `von fern: ${hex.afar}${hex.sighted && !hex.discovered ? ' (gesehen)' : ''}`,
              hex.hidden && `verborgen: ${hex.hidden}`,
              hex.searched && 'durchsucht',
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

export function HexMap({
  area,
  data,
  size,
  selected,
  onSelect,
  plan,
  paint,
  level = 0,
  marked = [],
  fog = true,
}: Props) {
  const orientation = area.orientation;
  const caves = area.hexes.some((hex) => hex.exits !== null);
  const layout = useMemo(() => {
    // Der Rahmen umfasst alle Ebenen, damit die Karte beim Umschalten nicht springt.
    const all = area.hexes.map((hex) => hexCenter(hex, orientation));
    const cells: Cell[] = area.hexes
      .filter((hex) => hex.level === level)
      .map((hex) => {
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
    const xs = all.map((c) => c.x * size);
    const ys = all.map((c) => c.y * size);
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
  }, [area.hexes, orientation, size, level]);

  const line = useMemo(
    () =>
      (caves ? [] : areaLine(area))
        .map((hex) => {
          const c = hexCenter(hex, orientation);
          return `${(c.x * size).toFixed(1)},${(c.y * size).toFixed(1)}`;
        })
        .join(' '),
    [area, orientation, size],
  );
  const places = layout.cells.filter((c) => c.hex.placeId && data.entities[c.hex.placeId]);
  /** Baue auf der Karte (`Beleben`): beim Vorbereiten alle, beim Spielen nur auf entdeckten Feldern. */
  const lairCells = useMemo(() => {
    const lairs = lairsOnArea(data, area.id);
    return layout.cells
      .map((cell) => ({
        cell,
        lairs: lairs.filter(
          (stock) =>
            stock.at!.q === cell.hex.q &&
            stock.at!.r === cell.hex.r &&
            (stock.at!.level ?? 0) === (cell.hex.level ?? 0),
        ),
      }))
      .filter((entry) => entry.lairs.length && (!fog || entry.cell.hex.discovered));
  }, [data, area.id, layout.cells, fog]);

  // Die Gruppe auf der Karte: wo sie steht, woher sie kam, wohin sie als Nächstes kann.
  const party = area.party;
  const by = partyMeans(data);
  const at = (hex: HexCoord) => {
    const c = hexCenter(hex, orientation);
    return `${(c.x * size).toFixed(1)},${(c.y * size).toFixed(1)}`;
  };
  const here = party && party.level === level ? hexCenter(party, orientation) : null;
  // Spur und Plan nur auf dieser Ebene – in Stücken, wo sie die Ebene wechseln.
  const runs = (coords: readonly HexCoord[]) => {
    const out: string[] = [];
    let run: HexCoord[] = [];
    for (const coord of coords) {
      if ((coord.level ?? 0) === level) run.push(coord);
      else {
        if (run.length > 1) out.push(run.map(at).join(' '));
        run = [];
      }
    }
    if (run.length > 1) out.push(run.map(at).join(' '));
    return out;
  };
  const trails = party && party.trail.length ? runs([...party.trail, party]) : [];
  const plans = party && plan?.length ? runs([party, ...plan]) : [];
  const partyCell = party ? area.hexes.find((hex) => sameHex(hex, party)) : undefined;
  const reach =
    party && partyCell
      ? passagesFrom(indexHexes(area.hexes), partyCell)
          .filter((p) => p.to.level === level)
          .map((p) => layout.cells.find((c) => c.hex === p.to))
          .filter(
            (cell): cell is Cell =>
              !!cell && hexMinutes(area.hexKm, cell.hex.terrain, party.pace, by) !== null,
          )
      : [];
  const chosen = selected ? layout.cells.find((c) => sameHex(c.hex, selected)) : undefined;
  const markedCells = marked
    .map((coord) => layout.cells.find((c) => sameHex(c.hex, coord)))
    .filter((cell): cell is Cell => !!cell && cell !== chosen);
  // Straßen, Pfade und Flüsse verbinden Nachbarn, die dieselbe Linie tragen.
  const links = useMemo(() => {
    const byKey = new Map(layout.cells.map((cell) => [hexKey(cell.hex), cell]));
    const out: { key: string; kind: 'road' | 'trail' | 'river'; d: string }[] = [];
    for (const cell of layout.cells)
      for (const n of hexNeighbors(cell.hex)) {
        const other = byKey.get(hexKey(n));
        if (!other || hexKey(other.hex) < hexKey(cell.hex)) continue;
        const d = `M ${cell.x.toFixed(1)} ${cell.y.toFixed(1)} L ${other.x.toFixed(1)} ${other.y.toFixed(1)}`;
        const road = (h: Hex) => h.road !== 'none';
        if (road(cell.hex) && road(other.hex))
          out.push({
            key: `r${hexKey(cell.hex)}-${hexKey(other.hex)}`,
            kind: cell.hex.road === 'road' && other.hex.road === 'road' ? 'road' : 'trail',
            d,
          });
        if (cell.hex.river && other.hex.river && cell.hex.exits === null)
          out.push({ key: `w${hexKey(cell.hex)}-${hexKey(other.hex)}`, kind: 'river', d });
      }
    return out;
  }, [layout.cells]);
  const regionNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const hex of area.hexes)
      if (hex.regionId && !out[hex.regionId])
        out[hex.regionId] = data.entities[hex.regionId]?.name ?? '';
    return out;
  }, [area.hexes, data.entities]);
  const landscapeNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const hex of area.hexes)
      if (hex.landscapeId && !out[hex.landscapeId])
        out[hex.landscapeId] = data.entities[hex.landscapeId]?.name ?? '';
    return out;
  }, [area.hexes, data.entities]);
  const slots = useMemo(
    () =>
      (paint?.slots ?? []).map((coord) => ({
        coord,
        points: hexCorners(coord, orientation)
          .map((p) => `${(p.x * size).toFixed(1)},${(p.y * size).toFixed(1)}`)
          .join(' '),
      })),
    [paint?.slots, orientation, size],
  );

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
      onPointerMove={
        paint
          ? (event) => {
              if (!(event.buttons & 1)) return;
              // Das Feld unter der Maus – auch, wenn die Maus schnell über mehrere hinweg fährt.
              const under = document.elementFromPoint(event.clientX, event.clientY);
              const cell = under?.closest('[data-hex]')?.getAttribute('data-hex');
              if (!cell) return;
              const [q, r, lv] = cell.split(',').map(Number);
              paint.onMove({ q: q!, r: r!, level: lv ?? 0 });
            }
          : undefined
      }
      onPointerUp={paint ? () => paint.onEnd() : undefined}
      onPointerLeave={paint ? () => paint.onEnd() : undefined}
      data-painting={paint ? true : undefined}
    >
      <Cells
        cells={layout.cells}
        size={size}
        onSelect={onSelect}
        painting={paint}
        fog={fog}
        regionNames={regionNames}
        landscapeNames={landscapeNames}
        activeRegion={paint?.regionId ?? null}
      />
      {links.map((link) => (
        <path
          key={link.key}
          className={`wf-hexmap__link wf-hexmap__link--${link.kind}`}
          d={link.d}
        />
      ))}
      {slots.map((slot) => (
        <polygon
          key={hexKey(slot.coord)}
          className="wf-hexmap__slot"
          points={slot.points}
          onClick={() => paint?.onSlot?.(slot.coord)}
        >
          <title>Hier ein Feld anfügen</title>
        </polygon>
      ))}
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
      {lairCells.map(({ cell, lairs }) => (
        <g key={`bau${hexKey(cell.hex)}`} className="wf-hexmap__lair">
          <polygon
            points={[
              [cell.x + size * 0.22, cell.y + size * 0.12],
              [cell.x + size * 0.36, cell.y + size * 0.36],
              [cell.x + size * 0.08, cell.y + size * 0.36],
            ]
              .map(([px, py]) => `${px!.toFixed(1)},${py!.toFixed(1)}`)
              .join(' ')}
          />
          <title>
            {lairs
              .map(
                (stock) =>
                  `${stock.name}: ${stock.groups.map((group) => `${data.creatures[group.creatureId]?.name ?? 'Wesen'} (${group.count - group.lost})`).join(', ')}`,
              )
              .join(' · ')}
          </title>
        </g>
      ))}
      {reach.map((cell) => (
        <polygon key={hexKey(cell.hex)} className="wf-hexmap__reach" points={cell.points} />
      ))}
      {trails.map((points) => (
        <polyline key={`t${points}`} className="wf-hexmap__trail" points={points} />
      ))}
      {plans.map((points) => (
        <polyline key={`p${points}`} className="wf-hexmap__plan" points={points} />
      ))}
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
      {markedCells.map((cell) => (
        <polygon key={`m${hexKey(cell.hex)}`} className="wf-hexmap__marked" points={cell.points} />
      ))}
      {chosen && <polygon className="wf-hexmap__chosen" points={chosen.points} />}
    </svg>
  );
}
