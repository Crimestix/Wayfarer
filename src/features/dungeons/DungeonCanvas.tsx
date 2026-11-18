/**
 * Die Zeichenfläche des Dungeon-Editors: malt die Ebene und nimmt Maus und Rad entgegen. Der
 * Zeiger über der Karte und das Verschieben stehen nie im Zustand der Seite – sie zeichnen nur
 * die Leinwand neu.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  addDweller,
  addMarker,
  addRoom,
  addStair,
  addZone,
  addTrap,
  assignRoom,
  brushCells,
  cellsOfEdge,
  digPath,
  dwellerAt,
  edgeKey,
  edgeRun,
  isFloor,
  levelBeside,
  levelBounds,
  lineCells,
  linkStairs,
  markerAt,
  moveRoom,
  paintTiles,
  patchDweller,
  patchTrap,
  patchZone,
  rectCells,
  removeDweller,
  removeEdgeRun,
  removeMarker,
  removeStair,
  removeTrap,
  roomAt,
  roomCells,
  roundBetween,
  roundCells,
  sameCell,
  setEdge,
  stairAt,
  thingAt,
  toggleCell,
  toggleMarkerLink,
  toggleZoneLink,
  zoneAt,
  trapAt,
  type DungeonPick,
  type Side,
} from '../../domain/dungeon';
import {
  cornerNear,
  generateCave,
  pasteStamp,
  setCave,
  setCorner,
  setHeights,
  setRough,
} from '../../domain/dungeonTerrain';
import type { DungeonCell, DungeonEdgeKind, DungeonLevel } from '../../domain/schema';
import { toast } from '../../ui';
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  drawScene,
  readPalette,
  type Palette,
  type PlayOverlay,
  type View,
} from './draw';
import { isTyping, type DungeonEditor } from './editor';

/** Die Ansicht je Dungeon – sie übersteht den Wechsel der Ebene und der Seite. */
const views = new Map<string, View>();

/** So nah an einer Kante (in Anteilen des Feldes) gilt ein Klick mit „Auswählen“ der Kante. */
const EDGE_NEAR = 0.24;
/** Beim Entlangziehen einer Wand: so nah muss der Zeiger der Kante sein. */
const EDGE_DRAG = 0.3;

/** Worauf eine Wirkung zeigen kann, wenn ein Feld angeklickt wird – nie auf den, der sie auslöst. */
function linkOfThing(
  level: DungeonLevel,
  cell: DungeonCell,
  self: string,
): { kind: 'trap' | 'stair' | 'dweller' | 'marker' | 'zone'; levelId: string; ref: string } | null {
  const thing = thingAt(level, cell);
  if (thing && thing.type !== 'room' && thing.type !== 'edge' && thing.type !== 'zone') {
    if (thing.id === self) return null;
    if (thing.type !== 'marker') return { kind: thing.type, levelId: level.id, ref: thing.id };
    // Von der Einrichtung lassen sich nur Lichter schalten.
    const marker = level.markers.find((m) => m.id === thing.id);
    if (marker?.kind === 'fire' || marker?.kind === 'torch')
      return { kind: 'marker', levelId: level.id, ref: thing.id };
  }
  const zone = zoneAt(level, cell);
  return zone && zone.id !== self ? { kind: 'zone', levelId: level.id, ref: zone.id } : null;
}

/** Liegen zwei Kanten in einer Linie? */
function inLine(a: string, b: string): boolean {
  const [ax, ay, aside] = a.split(',');
  const [bx, by, bside] = b.split(',');
  return aside === bside && (aside === 'n' ? ay === by : ax === bx);
}

interface Hit {
  cell: DungeonCell;
  edge: string;
  /** Abstand zur nächsten Kante in Anteilen des Feldes. */
  edgeDist: number;
  /** Wo im Feld der Zeiger steht (0–1). */
  fx: number;
  fy: number;
}

type Gesture =
  | { type: 'pan'; x: number; y: number }
  | {
      type: 'rect';
      from: DungeonCell;
      to: DungeonCell;
      mode: 'room' | 'floor' | 'rock' | 'area' | 'height' | 'zone' | 'region';
    }
  | { type: 'paint'; last: DungeonCell }
  | { type: 'wall'; kind: DungeonEdgeKind; set: boolean; done: Set<string>; first: string }
  | { type: 'trap'; trapId: string }
  | { type: 'move'; roomId: string; from: DungeonCell; to: DungeonCell }
  | { type: 'token'; id: string; from: DungeonCell; to: DungeonCell };

/**
 * Am Tisch gehört die Karte dem Spiel: Die Seite sagt, was zu sehen ist und was ein Klick tut.
 */
export interface PlayControl {
  /** Die Ebene, wie sie gerade gilt (Türen der Gruppe; in der Sicht der Spieler nur Gesehenes). */
  level: DungeonLevel;
  overlay: Omit<PlayOverlay, 'route'>;
  pick: DungeonPick | null;
  tokenAt: (cell: DungeonCell) => string | null;
  /** Der Weg, den die Gewählten dorthin gingen. */
  preview: (cell: DungeonCell) => { cells: DungeonCell[]; feet: number } | null;
  onToken: (id: string, add: boolean) => void;
  /** Ein Klick auf die Karte: ein Feld, und die Kante, wenn er nah an einer lag. */
  onCell: (cell: DungeonCell, edge: string | null) => void;
  /** Eine Figur von Hand irgendwohin gezogen. */
  onPlace: (id: string, cell: DungeonCell) => void;
}

export function DungeonCanvas({
  editor,
  play,
}: {
  editor: DungeonEditor;
  play?: PlayControl | null;
}) {
  const playRef = useRef(play ?? null);
  playRef.current = play ?? null;
  const route = useRef<{ key: string; value: ReturnType<PlayControl['preview']> } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const palette = useRef<Palette | null>(null);
  const size = useRef({ width: 0, height: 0 });
  const hover = useRef<Hit | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const space = useRef(false);
  const frame = useRef(0);
  const live = useRef(editor);
  live.current = editor;

  const level = editor.level;
  const levelId = level?.id ?? '';
  // Alle Ebenen eines Dungeons teilen sich eine Ansicht: Beim Wechsel bleibt alles an seiner Stelle.
  const viewKey = editor.dungeon.id;

  /** Passt eine Ansicht so ein, dass die ganze Ebene zu sehen ist; eine leere Ebene liegt mittig. */
  const fitView = useCallback((view: View) => {
    const lv = live.current.level;
    const { width, height } = size.current;
    if (!lv || width === 0) return false;
    const bounds = levelBounds(lv);
    if (!bounds) {
      view.zoom = DEFAULT_ZOOM;
      view.ox = Math.round(width / 2 - 8 * DEFAULT_ZOOM);
      view.oy = Math.round(height / 2 - 6 * DEFAULT_ZOOM);
      return true;
    }
    const w = bounds.maxX - bounds.minX + 1;
    const h = bounds.maxY - bounds.minY + 1;
    const zoom = Math.max(MIN_ZOOM, Math.min(44, Math.min((width - 96) / w, (height - 96) / h)));
    view.zoom = zoom;
    view.ox = Math.round(width / 2 - (bounds.minX + w / 2) * zoom);
    view.oy = Math.round(height / 2 - (bounds.minY + h / 2) * zoom);
    return true;
  }, []);

  /** Die Ansicht dieses Dungeons; ist er zum ersten Mal offen, passt er sich ein. */
  const unfitted = useRef(new Set<string>());
  const viewOf = useCallback((): View => {
    let view = views.get(viewKey);
    if (!view) {
      view = { zoom: DEFAULT_ZOOM, ox: 0, oy: 0 };
      views.set(viewKey, view);
      if (!fitView(view)) unfitted.current.add(viewKey);
    } else if (unfitted.current.has(viewKey) && fitView(view)) unfitted.current.delete(viewKey);
    return view;
  }, [viewKey, fitView]);

  const paint = useCallback(() => {
    const el = canvas.current;
    const ed = live.current;
    if (!el || !ed.level) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    palette.current ??= readPalette(el);
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const ctl = playRef.current;
    const lv = ctl?.level ?? ed.level;
    const g = gesture.current;
    const h = hover.current;
    let hoverCells: DungeonCell[] = [];
    let hoverEdge: string | null = null;
    const round =
      g?.type === 'rect' && g.mode === 'room' && ed.roomShape === 'round'
        ? roundBetween(g.from, g.to)
        : null;
    let shown: PlayOverlay | null = null;
    if (ctl) {
      // Am Tisch: die Figur, die gezogen wird, oder der Weg zum Feld unter dem Zeiger.
      if (g?.type === 'token') {
        if (!sameCell(g.from, g.to)) hoverCells = [g.to];
      } else if (h && !g && !ctl.tokenAt(h.cell)) {
        const key = `${h.cell.x},${h.cell.y}`;
        if (route.current?.key !== key) route.current = { key, value: ctl.preview(h.cell) };
      } else route.current = null;
      shown = { ...ctl.overlay, route: g ? null : (route.current?.value ?? null) };
    } else if (g?.type === 'rect') hoverCells = rectCells(g.from, g.to);
    else if (g?.type === 'move') {
      const dx = g.to.x - g.from.x;
      const dy = g.to.y - g.from.y;
      if (dx !== 0 || dy !== 0)
        hoverCells = roomCells(lv, g.roomId).map((c) => ({ x: c.x + dx, y: c.y + dy }));
    } else if (h && !g) {
      if (ed.pickMode) hoverCells = [h.cell];
      else if (
        ed.tool === 'floor' ||
        ed.tool === 'rock' ||
        ed.tool === 'area' ||
        ed.tool === 'height'
      )
        hoverCells = brushCells(h.cell, ed.size);
      else if (ed.tool === 'region' && ed.pasting && ed.clip)
        hoverCells = [h.cell, { x: h.cell.x + ed.clip.w - 1, y: h.cell.y + ed.clip.h - 1 }];
      else if (ed.tool === 'corner' || ed.tool === 'zone') hoverCells = [h.cell];
      else if (
        ed.tool === 'room' ||
        ed.tool === 'trap' ||
        ed.tool === 'stair' ||
        ed.tool === 'marker' ||
        ed.tool === 'dweller'
      )
        hoverCells = [h.cell];
      else if (ed.tool === 'wall' || ed.tool === 'door') hoverEdge = h.edge;
      else if (ed.tool === 'erase')
        if (thingAt(lv, h.cell)) hoverCells = [h.cell];
        else if (lv.edges[h.edge]) hoverEdge = h.edge;
    }
    const mode = ed.pickMode;
    const trap =
      mode?.type === 'trap-cells' || mode?.type === 'trap-spots'
        ? lv.traps.find((t) => t.id === mode.trapId)
        : null;
    const zoned = mode?.type === 'zone-cells' ? lv.zones.find((z) => z.id === mode.zoneId) : null;
    // Der aufgezogene Ausschnitt bleibt gestrichelt stehen, bis ein anderer gewählt ist.
    const marked =
      ed.tool === 'region' && ed.region && !ctl
        ? [
            { x: ed.region.x, y: ed.region.y },
            { x: ed.region.x + ed.region.w - 1, y: ed.region.y + ed.region.h - 1 },
          ]
        : null;
    const walker =
      mode?.type === 'dweller-route' ? lv.dwellers.find((d) => d.id === mode.dwellerId) : null;
    const sorted = [...ed.dungeon.levels].sort((a, b) => b.order - a.order);
    const index = sorted.findIndex((l) => l.id === lv.id);
    drawScene(ctx, {
      level: lv,
      ghost: ed.ghost ? (sorted[index + 1] ?? sorted[index - 1] ?? null) : null,
      below: levelBeside(ed.dungeon, lv.id, 'down'),
      hoverRound: round,
      view: viewOf(),
      width: size.current.width,
      height: size.current.height,
      palette: palette.current,
      selection: ctl ? ctl.pick : ed.selection,
      play: shown,
      hoverCells,
      hoverEdge,
      region: marked,
      pickCells: zoned
        ? zoned.cells
        : walker
          ? walker.route
          : trap
            ? mode?.type === 'trap-spots'
              ? trap.spots
              : trap.cells
            : null,
    });
  }, [viewOf]);

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(paint);
  }, [paint]);

  // Bei jeder Änderung des Editors neu zeichnen.
  useEffect(schedule);

  const fit = useCallback(() => void fitView(viewOf()), [fitView, viewOf]);

  // Größe der Fläche.
  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const resize = () => {
      const rect = el.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      size.current = { width: rect.width, height: rect.height };
      cv.width = Math.round(rect.width * ratio);
      cv.height = Math.round(rect.height * ratio);
      cv.style.width = `${rect.width}px`;
      cv.style.height = `${rect.height}px`;
      paint();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    return () => observer.disconnect();
  }, [paint]);

  // „Einpassen“ und „Dorthin springen“.
  const command = editor.viewCommand;
  const seen = useRef(command.nonce);
  useEffect(() => {
    if (seen.current === command.nonce) return;
    seen.current = command.nonce;
    if (command.type === 'fit') fit();
    else if (command.cell) {
      // Nur holen, was nicht schon im Bild ist – sonst springt die Karte ohne Not.
      const view = viewOf();
      const px = (command.cell.x + 0.5) * view.zoom + view.ox;
      const py = (command.cell.y + 0.5) * view.zoom + view.oy;
      const margin = view.zoom * 2;
      const { width, height } = size.current;
      if (px < margin || py < margin || px > width - margin || py > height - margin) {
        view.ox = Math.round(width / 2 - (command.cell.x + 0.5) * view.zoom);
        view.oy = Math.round(height / 2 - (command.cell.y + 0.5) * view.zoom);
      }
    }
    schedule();
  }, [command, fit, viewOf, schedule]);

  /** Das Feld und die nächste Kante unter einer Stelle der Fläche. */
  const hitAt = useCallback(
    (clientX: number, clientY: number): Hit => {
      const rect = canvas.current!.getBoundingClientRect();
      const view = viewOf();
      const gx = (clientX - rect.left - view.ox) / view.zoom;
      const gy = (clientY - rect.top - view.oy) / view.zoom;
      const cell = { x: Math.floor(gx), y: Math.floor(gy) };
      const fx = gx - cell.x;
      const fy = gy - cell.y;
      const sides: [Side, number][] = [
        ['n', fy],
        ['s', 1 - fy],
        ['w', fx],
        ['e', 1 - fx],
      ];
      sides.sort((a, b) => a[1] - b[1]);
      const [side, dist] = sides[0]!;
      return { cell, edge: edgeKey(cell, side), edgeDist: dist, fx, fy };
    },
    [viewOf],
  );

  // Mausrad: vergrößern um die Stelle unter dem Zeiger; mit Umschalt seitlich rollen.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = viewOf();
      if (event.shiftKey) {
        view.ox -= event.deltaY || event.deltaX;
      } else {
        const rect = el.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const zoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, view.zoom * Math.exp(-event.deltaY * 0.0015)),
        );
        view.ox = px - ((px - view.ox) / view.zoom) * zoom;
        view.oy = py - ((py - view.oy) / view.zoom) * zoom;
        view.zoom = zoom;
      }
      schedule();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewOf, schedule]);

  // Leertaste: die Karte mit der Maus verschieben.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isTyping(event.target)) return;
      space.current = true;
      event.preventDefault();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /** Ein Pinselstrich von einem Feld zum nächsten. */
  const stroke = (from: DungeonCell, to: DungeonCell, first: boolean) => {
    const ed = live.current;
    const path = lineCells(from, to);
    const steps = first ? path : path.slice(1);
    if (steps.length === 0) return;
    const cells = steps.flatMap((cell) => brushCells(cell, ed.size));
    if (ed.tool === 'floor') {
      // „Schwierig“ setzt nur die Eigenschaft; sonst wird gemalt – auf Wunsch als Höhle.
      if (ed.rough) ed.applyLevel((lv) => setRough(lv, cells, ed.rough === 'on'));
      else
        ed.applyLevel((lv) =>
          setCave(
            digPath(lv, path, ed.tile, ed.size),
            path.flatMap((c) => brushCells(c, ed.size)),
            ed.caveLook,
          ),
        );
      return;
    }
    if (ed.tool === 'height') {
      ed.applyLevel((lv) => setHeights(lv, cells, ed.heightFeet));
      return;
    }
    if (ed.tool === 'rock') ed.applyLevel((lv) => paintTiles(lv, cells, null));
    else if (ed.tool === 'area') ed.applyLevel((lv) => assignRoom(lv, cells, ed.areaRoomId));
  };

  /** Ein Feld, auf das etwas gelegt wird, ist danach Boden. */
  const floored = (lv: DungeonLevel, cell: DungeonCell): DungeonLevel =>
    isFloor(lv, cell) ? lv : paintTiles(lv, [cell], 'floor');

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const ed = live.current;
    const lv = ed.level;
    if (!lv) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.button !== 0 || space.current) {
      gesture.current = { type: 'pan', x: event.clientX, y: event.clientY };
      return;
    }
    const hit = hitAt(event.clientX, event.clientY);
    const { cell } = hit;

    // Am Tisch: Figur wählen und ziehen, sonst gilt der Klick dem Feld.
    const ctl = playRef.current;
    if (ctl) {
      route.current = null;
      const tokenId = ctl.tokenAt(cell);
      if (tokenId) {
        ctl.onToken(tokenId, event.shiftKey);
        gesture.current = { type: 'token', id: tokenId, from: cell, to: cell };
      } else ctl.onCell(cell, hit.edgeDist < EDGE_NEAR ? hit.edge : null);
      return;
    }

    // Erst, was gerade gewählt wird.
    const mode = ed.pickMode;
    if (mode?.type === 'stair-target') {
      const from = mode.from;
      ed.apply((d) => linkStairs(d, from, { levelId: lv.id, ...cell }));
      ed.setPickMode(null);
      ed.setTool('select');
      // Das Gegenstück liegt jetzt auf diesem Feld.
      window.setTimeout(() => {
        const there = live.current.level ? stairAt(live.current.level, cell) : null;
        if (there) live.current.setSelection({ type: 'stair', id: there.id });
      }, 0);
      toast({ title: 'Verbunden – der Weg führt in beide Richtungen.', slot: 'dungeon' });
      return;
    }
    if (mode?.type === 'dweller-route') {
      ed.applyLevel((level) => {
        const dweller = level.dwellers.find((d) => d.id === mode.dwellerId);
        if (!dweller || !isFloor(level, cell)) return level;
        return patchDweller(level, dweller.id, { route: toggleCell(dweller.route, cell) });
      });
      return;
    }
    if (mode?.type === 'zone-cells') {
      ed.applyLevel((level) => {
        const zone = level.zones.find((z) => z.id === mode.zoneId);
        if (!zone || !isFloor(level, cell)) return level;
        return patchZone(level, zone.id, { cells: toggleCell(zone.cells, cell) });
      });
      return;
    }
    if (mode?.type === 'zone-edge') {
      const edge = lv.edges[hit.edge];
      if (!edge || edge.kind === 'wall') return;
      const ref = edgeRun(lv, hit.edge)[0]!;
      ed.apply((d) => ({
        ...d,
        levels: d.levels.map((level) =>
          level.zones.some((z) => z.id === mode.zoneId)
            ? patchZone(level, mode.zoneId, { edgeRef: ref, when: 'open' })
            : level,
        ),
      }));
      ed.setPickMode(null);
      return;
    }
    if (mode?.type === 'zone-link') {
      const edge = hit.edgeDist < EDGE_NEAR ? lv.edges[hit.edge] : undefined;
      const link =
        edge && edge.kind !== 'wall' && edge.kind !== 'open'
          ? { kind: 'edge' as const, levelId: lv.id, ref: edgeRun(lv, hit.edge)[0]! }
          : linkOfThing(lv, cell, mode.zoneId);
      if (!link) return;
      ed.apply((d) => ({
        ...d,
        levels: d.levels.map((level) =>
          level.zones.some((z) => z.id === mode.zoneId)
            ? toggleZoneLink(level, mode.zoneId, link)
            : level,
        ),
      }));
      return;
    }
    if (mode?.type === 'marker-link') {
      // Eine Kante, wenn der Klick nah an einer Tür lag; sonst, was auf dem Feld liegt.
      const edge = hit.edgeDist < EDGE_NEAR ? lv.edges[hit.edge] : undefined;
      const link =
        edge && edge.kind !== 'wall' && edge.kind !== 'open'
          ? { kind: 'edge' as const, levelId: lv.id, ref: edgeRun(lv, hit.edge)[0]! }
          : linkOfThing(lv, cell, mode.markerId);
      if (!link) return;
      // Der Schalter kann auf einer anderen Ebene liegen als sein Ziel.
      ed.apply((d) => ({
        ...d,
        levels: d.levels.map((level) =>
          level.markers.some((m) => m.id === mode.markerId)
            ? toggleMarkerLink(level, mode.markerId, link)
            : level,
        ),
      }));
      return;
    }
    if (mode) {
      const field = mode.type === 'trap-cells' ? 'cells' : 'spots';
      ed.applyLevel((level) => {
        const trap = level.traps.find((t) => t.id === mode.trapId);
        if (!trap) return level;
        const next = toggleCell(trap[field], cell);
        // Eine Falle ohne Auslöser gibt es nicht.
        if (field === 'cells' && next.length === 0) return level;
        return patchTrap(floored(level, cell), trap.id, { [field]: next });
      });
      return;
    }

    switch (ed.tool) {
      case 'select': {
        const thing = thingAt(lv, cell);
        if (hit.edgeDist < EDGE_NEAR && lv.edges[hit.edge])
          ed.setSelection({ type: 'edge', key: hit.edge });
        else if (thing) ed.setSelection(thing);
        else {
          const roomId = roomAt(lv, cell);
          ed.setSelection(roomId ? { type: 'room', id: roomId } : null);
          // Ein Raum lässt sich an eine andere Stelle ziehen.
          if (roomId) gesture.current = { type: 'move', roomId, from: cell, to: cell };
        }
        return;
      }
      case 'room':
        gesture.current = { type: 'rect', from: cell, to: cell, mode: 'room' };
        return;
      case 'zone': {
        const there = zoneAt(lv, cell);
        if (there) ed.setSelection({ type: 'zone', id: there.id });
        else gesture.current = { type: 'rect', from: cell, to: cell, mode: 'zone' };
        return;
      }
      case 'corner':
        ed.applyLevel((level) => setCorner(level, cell, cornerNear(hit.fx, hit.fy)));
        return;
      case 'region':
        if (ed.pasting && ed.clip) {
          const stamp = ed.clip;
          ed.applyLevel((level) => pasteStamp(level, stamp, cell));
          ed.setRegion({ x: cell.x, y: cell.y, w: stamp.w, h: stamp.h });
          ed.setPasting(false);
        } else gesture.current = { type: 'rect', from: cell, to: cell, mode: 'region' };
        return;
      case 'floor':
      case 'rock':
      case 'area':
      case 'height':
        if (event.shiftKey) {
          gesture.current = { type: 'rect', from: cell, to: cell, mode: ed.tool };
          return;
        }
        ed.beginStroke();
        gesture.current = { type: 'paint', last: cell };
        stroke(cell, cell, true);
        return;
      case 'wall': {
        const set = lv.edges[hit.edge]?.kind !== 'wall';
        ed.beginStroke();
        ed.applyLevel((level) => setEdge(level, hit.edge, set ? { kind: 'wall' } : null));
        gesture.current = {
          type: 'wall',
          kind: 'wall',
          set,
          done: new Set([hit.edge]),
          first: hit.edge,
        };
        return;
      }
      case 'door': {
        // Klicken setzt eine; entlangziehen setzt mehrere nebeneinander – eine Doppeltür.
        const same = lv.edges[hit.edge]?.kind === ed.edgeKind;
        ed.beginStroke();
        ed.applyLevel((level) => setEdge(level, hit.edge, same ? null : { kind: ed.edgeKind }));
        ed.setSelection(same ? null : { type: 'edge', key: hit.edge });
        gesture.current = {
          type: 'wall',
          kind: ed.edgeKind,
          set: !same,
          done: new Set([hit.edge]),
          first: hit.edge,
        };
        return;
      }
      case 'trap': {
        const there = trapAt(lv, cell);
        if (there) {
          ed.setSelection({ type: 'trap', id: there.id });
          return;
        }
        ed.beginStroke();
        let trapId = '';
        ed.applyLevel((level) => {
          const made = addTrap(floored(level, cell), cell);
          trapId = made.trap.id;
          return made.level;
        });
        ed.setSelection({ type: 'trap', id: trapId });
        gesture.current = { type: 'trap', trapId };
        return;
      }
      case 'stair': {
        const there = stairAt(lv, cell);
        if (there) {
          ed.setSelection({ type: 'stair', id: there.id });
          return;
        }
        let stairId = '';
        ed.applyLevel((level) => {
          const made = addStair(floored(level, cell), cell, { kind: ed.stairKind });
          stairId = made.stair.id;
          return made.level;
        });
        ed.setSelection({ type: 'stair', id: stairId });
        return;
      }
      case 'marker': {
        const there = markerAt(lv, cell);
        if (there) {
          ed.setSelection({ type: 'marker', id: there.id });
          return;
        }
        let markerId = '';
        ed.applyLevel((level) => {
          const made = addMarker(floored(level, cell), cell, ed.markerKind);
          markerId = made.marker.id;
          return made.level;
        });
        ed.setSelection({ type: 'marker', id: markerId });
        return;
      }
      case 'dweller': {
        const there = dwellerAt(lv, cell);
        if (there) {
          ed.setSelection({ type: 'dweller', id: there.id });
          return;
        }
        let dwellerId = '';
        ed.applyLevel((level) => {
          const made = addDweller(floored(level, cell), cell);
          dwellerId = made.dweller.id;
          return made.level;
        });
        ed.setSelection({ type: 'dweller', id: dwellerId });
        return;
      }
      case 'erase': {
        const thing = thingAt(lv, cell);
        if (thing?.type === 'dweller') ed.applyLevel((level) => removeDweller(level, thing.id));
        else if (thing?.type === 'stair')
          ed.apply((d) => removeStair(d, { levelId: lv.id, stairId: thing.id }));
        else if (thing?.type === 'marker') ed.applyLevel((level) => removeMarker(level, thing.id));
        else if (thing?.type === 'trap') ed.applyLevel((level) => removeTrap(level, thing.id));
        else if (lv.edges[hit.edge]) ed.applyLevel((level) => removeEdgeRun(level, hit.edge));
        return;
      }
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (g?.type === 'pan') {
      const view = viewOf();
      view.ox += event.clientX - g.x;
      view.oy += event.clientY - g.y;
      g.x = event.clientX;
      g.y = event.clientY;
      schedule();
      return;
    }
    const hit = hitAt(event.clientX, event.clientY);
    hover.current = hit;
    const ed = live.current;
    if (g?.type === 'rect' || g?.type === 'move' || g?.type === 'token') g.to = hit.cell;
    else if (g?.type === 'paint') {
      if (!sameCell(g.last, hit.cell)) {
        stroke(g.last, hit.cell, false);
        g.last = hit.cell;
      }
    } else if (g?.type === 'wall') {
      if (hit.edgeDist < EDGE_DRAG && !g.done.has(hit.edge)) {
        g.done.add(hit.edge);
        ed.applyLevel((level) => {
          const { a, b } = cellsOfEdge(hit.edge);
          // Eine Wand steht nur zwischen zwei Bodenfeldern; alles andere braucht wenigstens eines.
          const floors = Number(isFloor(level, a)) + Number(isFloor(level, b));
          if (g.set && floors < (g.kind === 'wall' ? 2 : 1)) return level;
          if (!g.set && level.edges[hit.edge]?.kind !== g.kind) return level;
          // Türen entstehen beim Ziehen nur in einer Linie – nie um die Ecke.
          if (g.kind !== 'wall' && !inLine(g.first, hit.edge)) return level;
          return setEdge(level, hit.edge, g.set ? { kind: g.kind } : null);
        });
      }
    } else if (g?.type === 'trap') {
      ed.applyLevel((level) => {
        const trap = level.traps.find((t) => t.id === g.trapId);
        if (!trap || trap.cells.some((c) => sameCell(c, hit.cell)) || trapAt(level, hit.cell))
          return level;
        return patchTrap(floored(level, hit.cell), trap.id, { cells: [...trap.cells, hit.cell] });
      });
    }
    schedule();
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    const ed = live.current;
    if (g?.type === 'token') {
      if (!sameCell(g.from, g.to)) playRef.current?.onPlace(g.id, g.to);
    } else if (g?.type === 'rect') {
      const shape =
        g.mode === 'room' && ed.roomShape === 'round' ? roundBetween(g.from, g.to) : null;
      const cells = shape ? roundCells(shape) : rectCells(g.from, g.to);
      const box = roundBetween(g.from, g.to);
      if (g.mode === 'region') ed.setRegion(box);
      else if (g.mode === 'zone') {
        let zoneId = '';
        ed.applyLevel((level) => {
          const made = addZone(
            level,
            cells.filter((c) => isFloor(level, c)),
          );
          zoneId = made.zone.id;
          return made.level;
        });
        if (zoneId) ed.setSelection({ type: 'zone', id: zoneId });
      } else if (g.mode === 'height')
        ed.applyLevel((level) => setHeights(level, cells, ed.heightFeet));
      else if (g.mode === 'room' && ed.roomShape === 'cave') {
        // Eine Höhle: erzeugt nach fester Regel – dieselbe Fläche und Fassung, dieselbe Höhle.
        const cave = generateCave(box, `${ed.dungeon.id}:${ed.caveVariant}`);
        ed.applyLevel((level) => setCave(paintTiles(level, cave, 'floor'), cave, true));
      } else if (g.mode === 'room') {
        let roomId = '';
        ed.applyLevel((level) => {
          const made = addRoom(level, cells, undefined, { round: shape });
          roomId = made.room.id;
          return made.level;
        });
        if (roomId) ed.setSelection({ type: 'room', id: roomId });
      } else if (g.mode === 'floor')
        ed.applyLevel((level) =>
          ed.rough
            ? setRough(level, cells, ed.rough === 'on')
            : setCave(paintTiles(level, cells, ed.tile), cells, ed.caveLook),
        );
      else if (g.mode === 'rock') ed.applyLevel((level) => paintTiles(level, cells, null));
      else ed.applyLevel((level) => assignRoom(level, cells, ed.areaRoomId));
    } else if (g?.type === 'move') {
      const dx = g.to.x - g.from.x;
      const dy = g.to.y - g.from.y;
      if (dx !== 0 || dy !== 0) {
        let blocked = false;
        ed.applyLevel((level) => {
          const moved = moveRoom(level, g.roomId, dx, dy);
          blocked = moved === null;
          return moved ?? level;
        });
        if (blocked)
          toast({
            title: 'Dort liegt schon anderer Boden – der Raum bleibt, wo er ist.',
            slot: 'dungeon',
          });
      }
    } else if (g?.type === 'paint' || g?.type === 'wall' || g?.type === 'trap') ed.endStroke();
    schedule();
  };

  // Wechselt die Ebene mitten in einem Strich, endet er.
  useEffect(() => () => live.current.endStroke(), [levelId]);

  return (
    <div className="wf-dungeon-canvas" ref={wrap}>
      <canvas
        ref={canvas}
        aria-label="Karte der Ebene"
        data-tool={play ? 'play' : editor.pickMode ? 'pick' : editor.tool}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          hover.current = null;
          schedule();
        }}
        onContextMenu={(event) => event.preventDefault()}
      />
    </div>
  );
}
