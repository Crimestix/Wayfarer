/**
 * Die Zeichenfläche des Dungeon-Editors: malt die Ebene und nimmt Maus und Rad entgegen. Der
 * Zeiger über der Karte und das Verschieben stehen nie im Zustand der Seite – sie zeichnen nur
 * die Leinwand neu.
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  addMarker,
  addRoom,
  addStair,
  addTrap,
  assignRoom,
  brushCells,
  cellsOfEdge,
  digPath,
  edgeKey,
  isFloor,
  levelBounds,
  lineCells,
  linkStairs,
  markerAt,
  paintTiles,
  patchTrap,
  rectCells,
  removeMarker,
  removeStair,
  removeTrap,
  roomAt,
  sameCell,
  setEdge,
  stairAt,
  thingAt,
  toggleCell,
  trapAt,
  type Side,
} from '../../domain/dungeon';
import type { DungeonCell, DungeonLevel } from '../../domain/schema';
import { toast } from '../../ui';
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  drawScene,
  readPalette,
  type Palette,
  type View,
} from './draw';
import type { DungeonEditor } from './editor';

/** Die Ansicht je Ebene – sie übersteht den Wechsel der Ebene und der Seite. */
const views = new Map<string, View>();

/** So nah an einer Kante (in Anteilen des Feldes) gilt ein Klick mit „Auswählen“ der Kante. */
const EDGE_NEAR = 0.24;
/** Beim Entlangziehen einer Wand: so nah muss der Zeiger der Kante sein. */
const EDGE_DRAG = 0.3;

interface Hit {
  cell: DungeonCell;
  edge: string;
  /** Abstand zur nächsten Kante in Anteilen des Feldes. */
  edgeDist: number;
}

type Gesture =
  | { type: 'pan'; x: number; y: number }
  | { type: 'rect'; from: DungeonCell; to: DungeonCell; mode: 'room' | 'floor' | 'rock' | 'area' }
  | { type: 'paint'; last: DungeonCell }
  | { type: 'wall'; set: boolean; done: Set<string> }
  | { type: 'trap'; trapId: string };

export function DungeonCanvas({ editor }: { editor: DungeonEditor }) {
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

  /** Die Ansicht dieser Ebene; eine Ebene, die zum ersten Mal offen ist, passt sich ein. */
  const unfitted = useRef(new Set<string>());
  const viewOf = useCallback((): View => {
    let view = views.get(levelId);
    if (!view) {
      view = { zoom: DEFAULT_ZOOM, ox: 0, oy: 0 };
      views.set(levelId, view);
      if (!fitView(view)) unfitted.current.add(levelId);
    } else if (unfitted.current.has(levelId) && fitView(view)) unfitted.current.delete(levelId);
    return view;
  }, [levelId, fitView]);

  const paint = useCallback(() => {
    const el = canvas.current;
    const ed = live.current;
    if (!el || !ed.level) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    palette.current ??= readPalette(el);
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const lv = ed.level;
    const g = gesture.current;
    const h = hover.current;
    let hoverCells: DungeonCell[] = [];
    let hoverEdge: string | null = null;
    if (g?.type === 'rect') hoverCells = rectCells(g.from, g.to);
    else if (h && !g) {
      if (ed.pickMode) hoverCells = [h.cell];
      else if (ed.tool === 'floor' || ed.tool === 'rock' || ed.tool === 'area')
        hoverCells = brushCells(h.cell, ed.size);
      else if (
        ed.tool === 'room' ||
        ed.tool === 'trap' ||
        ed.tool === 'stair' ||
        ed.tool === 'marker'
      )
        hoverCells = [h.cell];
      else if (ed.tool === 'wall' || ed.tool === 'door') hoverEdge = h.edge;
      else if (ed.tool === 'erase')
        if (thingAt(lv, h.cell)) hoverCells = [h.cell];
        else if (lv.edges[h.edge]) hoverEdge = h.edge;
    }
    const mode = ed.pickMode;
    const trap =
      mode && mode.type !== 'stair-target' ? lv.traps.find((t) => t.id === mode.trapId) : null;
    const sorted = [...ed.dungeon.levels].sort((a, b) => b.order - a.order);
    const index = sorted.findIndex((l) => l.id === lv.id);
    drawScene(ctx, {
      level: lv,
      ghost: ed.ghost ? (sorted[index + 1] ?? sorted[index - 1] ?? null) : null,
      view: viewOf(),
      width: size.current.width,
      height: size.current.height,
      palette: palette.current,
      selection: ed.selection,
      hoverCells,
      hoverEdge,
      pickCells: trap ? (mode?.type === 'trap-spots' ? trap.spots : trap.cells) : null,
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
      const view = viewOf();
      view.ox = Math.round(size.current.width / 2 - (command.cell.x + 0.5) * view.zoom);
      view.oy = Math.round(size.current.height / 2 - (command.cell.y + 0.5) * view.zoom);
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
      return { cell, edge: edgeKey(cell, side), edgeDist: dist };
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
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || typing(event.target)) return;
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
    if (ed.tool === 'floor' && ed.size === 1) {
      ed.applyLevel((lv) => digPath(lv, path, ed.tile));
      return;
    }
    const cells = steps.flatMap((cell) => brushCells(cell, ed.size));
    if (ed.tool === 'floor') ed.applyLevel((lv) => paintTiles(lv, cells, ed.tile));
    else if (ed.tool === 'rock') ed.applyLevel((lv) => paintTiles(lv, cells, null));
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
        }
        return;
      }
      case 'room':
        gesture.current = { type: 'rect', from: cell, to: cell, mode: 'room' };
        return;
      case 'floor':
      case 'rock':
      case 'area':
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
        gesture.current = { type: 'wall', set, done: new Set([hit.edge]) };
        return;
      }
      case 'door': {
        const same = lv.edges[hit.edge]?.kind === ed.edgeKind;
        ed.applyLevel((level) => setEdge(level, hit.edge, same ? null : { kind: ed.edgeKind }));
        ed.setSelection(same ? null : { type: 'edge', key: hit.edge });
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
          const made = addMarker(floored(level, cell), cell);
          markerId = made.marker.id;
          return made.level;
        });
        ed.setSelection({ type: 'marker', id: markerId });
        return;
      }
      case 'erase': {
        const thing = thingAt(lv, cell);
        if (thing?.type === 'stair')
          ed.apply((d) => removeStair(d, { levelId: lv.id, stairId: thing.id }));
        else if (thing?.type === 'marker') ed.applyLevel((level) => removeMarker(level, thing.id));
        else if (thing?.type === 'trap') ed.applyLevel((level) => removeTrap(level, thing.id));
        else if (lv.edges[hit.edge]) ed.applyLevel((level) => setEdge(level, hit.edge, null));
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
    if (g?.type === 'rect') g.to = hit.cell;
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
          // Eine Wand steht nur zwischen zwei Bodenfeldern.
          if (g.set && !(isFloor(level, a) && isFloor(level, b))) return level;
          return setEdge(level, hit.edge, g.set ? { kind: 'wall' } : null);
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
    if (g?.type === 'rect') {
      const cells = rectCells(g.from, g.to);
      if (g.mode === 'room') {
        let roomId = '';
        ed.applyLevel((level) => {
          const made = addRoom(level, cells);
          roomId = made.room.id;
          return made.level;
        });
        if (roomId) ed.setSelection({ type: 'room', id: roomId });
      } else if (g.mode === 'floor') ed.applyLevel((level) => paintTiles(level, cells, ed.tile));
      else if (g.mode === 'rock') ed.applyLevel((level) => paintTiles(level, cells, null));
      else ed.applyLevel((level) => assignRoom(level, cells, ed.areaRoomId));
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
        data-tool={editor.pickMode ? 'pick' : editor.tool}
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
