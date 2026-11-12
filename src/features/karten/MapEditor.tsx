/**
 * Die Zeichenfläche einer gezeichneten Karte: Gelände malen, Straßen, Pfade und Flüsse ziehen,
 * Orte setzen. Was gezeichnet ist, bedeutet etwas – ein Klick zeigt, was Wayfarer daraus liest.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import {
  Hand,
  MapPin,
  Maximize2,
  Minus,
  Paintbrush,
  Plus,
  Settings2,
  Spline,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { GROUNDS, LEVEL_GROUNDS, lineDistance, lineLabel, markerNear } from '../../domain/mapDraw';
import { createEntity, type GameMap, type MapGround, type MapLine } from '../../domain/schema';
import { formatWayTime } from '../../domain/ways';
import { Button, Dialog, EntityPicker, Field, IconButton, Input, cx, entityHref } from '../../ui';
import {
  drawLine,
  paintGround,
  paintRect,
  placeMarker,
  removeLine,
  removeMarker,
  renameLine,
} from './actions';
import { drawMap, makeTextures, paletteOf, type Draft, type Palette, type Textures } from './draw';
import {
  BRUSHES,
  clampView,
  fitView,
  formatLength,
  groundFacts,
  lineFacts,
  toMap,
  zoomView,
  type BrushId,
  type View,
} from './model';
import { shapesOf } from './shapes';

type Tool = 'hand' | 'ground' | 'line' | 'marker';
type Selection =
  | { kind: 'line'; id: string }
  | { kind: 'marker'; id: string }
  | { kind: 'ground'; at: [number, number] };

const TOOLS: { id: Tool; label: string; icon: typeof Hand; hint: string }[] = [
  {
    id: 'hand',
    label: 'Ansehen',
    icon: Hand,
    hint: 'Ziehen verschiebt die Karte, das Mausrad vergrößert. Ein Klick zeigt, was dort ist.',
  },
  { id: 'ground', label: 'Gelände', icon: Paintbrush, hint: '' },
  {
    id: 'line',
    label: 'Linie',
    icon: Spline,
    hint: 'Von Ort zu Ort gezogen, wird eine Straße oder ein Pfad zum Weg im Wegenetz.',
  },
  {
    id: 'marker',
    label: 'Ort',
    icon: MapPin,
    hint: 'Ein Klick auf die Karte setzt einen Ort.',
  },
];
const LINE_KINDS: MapLine['kind'][] = ['road', 'path', 'river', 'border'];

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function MapEditor({
  map,
  onEdit,
  onRemove,
}: {
  map: GameMap;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textures = useRef<{ level: GameMap['level']; paper: Textures } | null>(null);
  const palette = useRef<{ level: GameMap['level']; colors: Palette } | null>(null);
  const view = useRef<View | null>(null);
  const size = useRef({ width: 0, height: 0, dpr: 1 });
  const draft = useRef<Draft | null>(null);
  const pointer = useRef<[number, number] | null>(null);
  const gesture = useRef<{ pan: boolean; x: number; y: number; moved: boolean; from: View } | null>(
    null,
  );

  const [tool, setTool] = useState<Tool>('hand');
  const below = map.level === 'underground';
  const grounds = LEVEL_GROUNDS[map.level];
  const [picked, setGround] = useState<MapGround>(below ? 'cave' : 'forest');
  /** Wechselt die Ebene der Karte, gilt das Gelände dieser Ebene. */
  const ground = grounds.includes(picked) ? picked : grounds[1]!;
  /** Ein Pinsel – oder „rect“: ein Rechteck aufziehen, etwa für einen Raum. */
  const [brush, setBrush] = useState<BrushId | 'rect'>('medium');
  const [lineKind, setLineKind] = useState<MapLine['kind']>('road');
  const [selection, setSelection] = useState<Selection | null>(null);
  /** Die Karte mit den Angaben weicht dem Gewählten aus: liegt es links, steht sie rechts. */
  const [cardRight, setCardRight] = useState(false);
  const [undo, setUndo] = useState<(() => void)[]>([]);
  const [pin, setPin] = useState<[number, number] | null>(null);

  const frame = map.frame ?? { width: 1000, height: 700 };
  const brushWidth = BRUSHES.find((entry) => entry.id === brush)?.width ?? 0;
  /** Die Formen der Karte – neu gerechnet, sobald sich Gelände oder Gänge ändern. */
  const shapes = useMemo(
    () => shapesOf(map),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map.id, map.strokes, map.lines, map.ground, map.level, map.frame],
  );
  const labels = useMemo(() => {
    const names = new Map<string, string>();
    for (const marker of map.markers) {
      const name = (marker.entityId && data.entities[marker.entityId]?.name) || marker.label;
      if (name) names.set(marker.id, name);
    }
    return names;
  }, [map.markers, data.entities]);

  const selectedId = selection && selection.kind !== 'ground' ? selection.id : null;

  /** Zeichnet die Karte neu – sofort, ohne auf das nächste Bild zu warten. */
  const paint = () => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx || !view.current || !size.current.width) return;
    if (palette.current?.level !== map.level)
      palette.current = { level: map.level, colors: paletteOf(element, map.level) };
    if (textures.current?.level !== map.level)
      textures.current = { level: map.level, paper: makeTextures(map.level) };
    drawMap(
      ctx,
      textures.current.paper,
      {
        map,
        view: view.current,
        ...size.current,
        shapes,
        labels,
        draft: draft.current,
        selected: selectedId,
        brush:
          tool === 'ground' && brush !== 'rect' && pointer.current
            ? { at: pointer.current, width: brushWidth }
            : null,
      },
      palette.current.colors,
    );
  };
  const paintNow = useRef(paint);
  paintNow.current = paint;
  useLayoutEffect(() => paint());

  // Größe der Zeichenfläche: folgt ihrem Platz; beim ersten Mal die ganze Karte zeigen.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { width: box.width, height: box.height, dpr };
      if (canvas.current) {
        canvas.current.width = Math.round(box.width * dpr);
        canvas.current.height = Math.round(box.height * dpr);
      }
      if (box.width && box.height)
        view.current = view.current
          ? clampView(view.current, frame, box.width, box.height)
          : fitView(frame, box.width, box.height);
      paintNow.current();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.width, frame.height]);

  // Mausrad vergrößert um die Stelle unter dem Zeiger.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!view.current) return;
      const box = element.getBoundingClientRect();
      view.current = zoomView(
        view.current,
        Math.exp(-event.deltaY * 0.0015),
        event.clientX - box.left,
        event.clientY - box.top,
        frame,
        size.current.width,
        size.current.height,
      );
      paintNow.current();
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame.width, frame.height]);

  const remember = (step: () => void) => setUndo((steps) => [...steps, step]);
  const undoLast = () => {
    const step = undo[undo.length - 1];
    if (!step) return;
    step();
    setUndo(undo.slice(0, -1));
    setSelection(null);
  };
  const removeSelected = () => {
    if (!selection || selection.kind === 'ground') return;
    remember(
      selection.kind === 'line'
        ? removeLine(db, map.id, selection.id)
        : removeMarker(db, map.id, selection.id),
    );
    setSelection(null);
  };

  const keys = useRef({ undoLast, removeSelected });
  keys.current = { undoLast, removeSelected };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target) || document.querySelector('dialog[open]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        keys.current.undoLast();
      } else if (event.key === 'Escape') setSelection(null);
      else if (event.key === 'Delete' || event.key === 'Backspace') keys.current.removeSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const local = (event: { clientX: number; clientY: number }): [number, number] => {
    const box = canvas.current!.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };
  const zoomBy = (factor: number) => {
    if (!view.current) return;
    const { width, height } = size.current;
    view.current = zoomView(view.current, factor, width / 2, height / 2, frame, width, height);
    paint();
  };

  const select = (next: Selection, at: readonly [number, number]) => {
    const current = view.current;
    if (current) setCardRight((at[0] - current.x) * current.zoom < size.current.width / 2);
    setSelection(next);
  };

  /** Ein Klick: Ort setzen oder zeigen, was an der Stelle ist. */
  const click = (at: [number, number]) => {
    const zoom = view.current!.zoom;
    const inside = at[0] >= 0 && at[1] >= 0 && at[0] <= frame.width && at[1] <= frame.height;
    if (tool === 'marker') {
      if (inside) setPin(at);
      return;
    }
    const marker = markerNear(map.markers, at[0], at[1], 12 / zoom);
    if (marker) return select({ kind: 'marker', id: marker.id }, at);
    let best: MapLine | null = null;
    let distance = 8 / zoom;
    for (const line of map.lines) {
      const d = lineDistance(line.points, at[0], at[1]);
      if (d <= distance) [best, distance] = [line, d];
    }
    if (best) return select({ kind: 'line', id: best.id }, at);
    if (inside) select({ kind: 'ground', at }, at);
    else setSelection(null);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view.current) return;
    const [x, y] = local(event);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Ohne Zeigerfang geht es auch – dann endet das Ziehen am Rand der Zeichenfläche.
    }
    const pan = event.button !== 0 || tool === 'hand' || tool === 'marker';
    gesture.current = { pan, x, y, moved: false, from: view.current };
    if (!pan) {
      const at = toMap(view.current, x, y);
      draft.current =
        tool !== 'ground'
          ? { kind: 'line', line: lineKind, points: [at] }
          : brush === 'rect'
            ? { kind: 'rect', ground, from: at, to: at }
            : { kind: 'ground', ground, width: brushWidth, points: [at] };
      paint();
    }
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view.current) return;
    const [x, y] = local(event);
    const active = gesture.current;
    pointer.current = toMap(view.current, x, y);
    if (!active) {
      if (tool === 'ground') paint();
      return;
    }
    if (Math.hypot(x - active.x, y - active.y) > 4) active.moved = true;
    if (active.pan) {
      if (!active.moved) return;
      const zoom = active.from.zoom;
      view.current = clampView(
        {
          zoom,
          x: active.from.x - (x - active.x) / zoom,
          y: active.from.y - (y - active.y) / zoom,
        },
        frame,
        size.current.width,
        size.current.height,
      );
    } else if (draft.current) {
      const current = draft.current;
      const at = pointer.current;
      if (current.kind === 'rect') current.to = at;
      // Mit der Umschalt-Taste wird die Linie gerade: vom Anfang bis unter den Zeiger.
      else if (current.kind === 'line' && event.shiftKey) current.points = [current.points[0]!, at];
      else {
        const last = current.points[current.points.length - 1]!;
        if (Math.hypot(at[0] - last[0], at[1] - last[1]) * view.current.zoom >= 2)
          current.points.push(at);
      }
    }
    paint();
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const active = gesture.current;
    gesture.current = null;
    if (!active || !view.current) return;
    if (active.pan) {
      if (!active.moved && event.button === 0) click(toMap(view.current, ...local(event)));
      return;
    }
    const drawn = draft.current;
    draft.current = null;
    if (drawn?.kind === 'ground')
      remember(paintGround(db, map.id, drawn.ground, drawn.width, drawn.points));
    else if (drawn?.kind === 'rect') {
      if (active.moved) remember(paintRect(db, map.id, drawn.ground, drawn.from, drawn.to));
    } else if (drawn && active.moved && drawn.points.length >= 2) {
      const result = drawLine(db, map.id, drawn.line, drawn.points);
      if (result.line) {
        remember(result.undo);
        const points = result.line.points;
        select({ kind: 'line', id: result.line.id }, points[Math.floor(points.length / 2)]!);
      }
    }
    paint();
  };

  const place = map.placeId ? data.entities[map.placeId] : undefined;
  const widthKm = map.scale ? map.scale.kmPerUnit * frame.width : null;
  const hint =
    tool !== 'line'
      ? TOOLS.find((entry) => entry.id === tool)!.hint
      : below
        ? 'Ein Gang gräbt sich durch den Fels. Von Ort zu Ort gezogen, wird er zum Weg im Wegenetz. Umschalt-Taste: gerade.'
        : 'Von Ort zu Ort gezogen, wird eine Straße oder ein Pfad zum Weg im Wegenetz. Umschalt-Taste: gerade.';

  return (
    <div className="wf-karten-editor">
      <div className="wf-karten-bar">
        <div className="wf-karten-bar__title">
          <h2>{map.name}</h2>
          <span>
            {[place?.name, widthKm ? `${formatLength(widthKm)} breit` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
        <div className="wf-karten-tools" role="group" aria-label="Werkzeug">
          {TOOLS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="wf-karten-tool"
              aria-pressed={tool === entry.id}
              onClick={() => {
                setTool(entry.id);
                if (entry.id !== 'hand') setSelection(null);
              }}
            >
              <entry.icon aria-hidden />
              {entry.label}
            </button>
          ))}
        </div>
        <div className="wf-karten-bar__acts">
          <Button
            size="sm"
            icon={<Undo2 aria-hidden />}
            disabled={!undo.length}
            onClick={undoLast}
            title="Den letzten Strich zurücknehmen (Strg + Z)"
          >
            Rückgängig
          </Button>
          <IconButton size="sm" label="Name, Maßstab und Grund der Karte" onClick={onEdit}>
            <Settings2 aria-hidden />
          </IconButton>
          <IconButton size="sm" label="Karte löschen" onClick={onRemove}>
            <Trash2 aria-hidden />
          </IconButton>
        </div>
      </div>

      <div className="wf-karten-options">
        {tool === 'ground' && (
          <>
            <div className="wf-karten-chips" role="group" aria-label="Gelände">
              {grounds.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className="wf-karten-chip"
                  aria-pressed={ground === entry}
                  onClick={() => setGround(entry)}
                >
                  <i className={`wf-karten-swatch wf-karten-swatch--${entry}`} aria-hidden />
                  {GROUNDS[entry].label}
                </button>
              ))}
            </div>
            <div className="wf-karten-chips" role="group" aria-label="Pinsel">
              {BRUSHES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="wf-karten-chip"
                  aria-pressed={brush === entry.id}
                  onClick={() => setBrush(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
              <button
                type="button"
                className="wf-karten-chip"
                aria-pressed={brush === 'rect'}
                title="Aufziehen ergibt ein Rechteck – etwa einen Raum"
                onClick={() => setBrush('rect')}
              >
                Rechteck
              </button>
            </div>
          </>
        )}
        {tool === 'line' && (
          <div className="wf-karten-chips" role="group" aria-label="Art der Linie">
            {LINE_KINDS.map((entry) => (
              <button
                key={entry}
                type="button"
                className="wf-karten-chip"
                aria-pressed={lineKind === entry}
                onClick={() => setLineKind(entry)}
              >
                {lineLabel(entry, map.level)}
              </button>
            ))}
          </div>
        )}
        {hint && <span className="wf-karten-options__hint">{hint}</span>}
      </div>

      <div className="wf-karten-stage" ref={stage}>
        <canvas
          ref={canvas}
          className={cx(
            'wf-karten-canvas',
            `wf-karten-canvas--${tool === 'ground' && brush === 'rect' ? 'line' : tool}`,
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            gesture.current = null;
            draft.current = null;
            paint();
          }}
          onPointerLeave={() => {
            pointer.current = null;
            if (!gesture.current) paint();
          }}
          onContextMenu={(event) => event.preventDefault()}
        />
        <div className="wf-karten-zoom">
          <IconButton size="sm" label="Vergrößern" onClick={() => zoomBy(1.5)}>
            <Plus aria-hidden />
          </IconButton>
          <IconButton size="sm" label="Verkleinern" onClick={() => zoomBy(1 / 1.5)}>
            <Minus aria-hidden />
          </IconButton>
          <IconButton
            size="sm"
            label="Die ganze Karte zeigen"
            onClick={() => {
              view.current = fitView(frame, size.current.width, size.current.height);
              paint();
            }}
          >
            <Maximize2 aria-hidden />
          </IconButton>
        </div>
        {selection && (
          <SelectionCard
            key={selection.kind === 'ground' ? 'ground' : selection.id}
            map={map}
            selection={selection}
            right={cardRight}
            onRemove={removeSelected}
            onOpen={(href) => navigate(href)}
          />
        )}
      </div>

      {pin && (
        <PinDialog
          onClose={() => setPin(null)}
          onPlace={(entityId, label) => {
            remember(placeMarker(db, map.id, pin, entityId, label));
            setPin(null);
          }}
        />
      )}
    </div>
  );
}

/** Was das Gewählte bedeutet: Länge und Dauer einer Linie, das Gelände einer Stelle, ein Ort. */
function SelectionCard({
  map,
  selection,
  right,
  onRemove,
  onOpen,
}: {
  map: GameMap;
  selection: Selection;
  right: boolean;
  onRemove: () => void;
  onOpen: (href: string) => void;
}) {
  const db = useDb();
  const data = useData();
  const line =
    selection.kind === 'line' ? map.lines.find((entry) => entry.id === selection.id) : undefined;
  const [name, setName] = useState(line?.name ?? '');
  const box = cx('wf-karten-card', right && 'wf-karten-card--right');

  if (selection.kind === 'ground') {
    const facts = groundFacts(map, selection.at[0], selection.at[1]);
    return (
      <div className={box}>
        <div className="wf-karten-card__sort">Gelände</div>
        <div className="wf-karten-card__name">{GROUNDS[facts.ground].label}</div>
        <p>{facts.note}</p>
      </div>
    );
  }

  if (selection.kind === 'marker') {
    const marker = map.markers.find((entry) => entry.id === selection.id);
    if (!marker) return null;
    const entity = marker.entityId ? data.entities[marker.entityId] : undefined;
    return (
      <div className={box}>
        <div className="wf-karten-card__sort">
          {entity ? 'Ort der Welt' : 'Punkt auf der Karte'}
        </div>
        <div className="wf-karten-card__name">{entity?.name ?? (marker.label || 'Ohne Namen')}</div>
        {!entity && (
          <p className="wf-mute">Nur eine Beschriftung – kein Eintrag der Welt hängt daran.</p>
        )}
        <div className="wf-karten-card__acts">
          {entity && (
            <Button size="sm" onClick={() => onOpen(entityHref(entity))}>
              Eintrag öffnen
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Trash2 aria-hidden />} onClick={onRemove}>
            Entfernen
          </Button>
        </div>
      </div>
    );
  }

  if (!line) return null;
  const facts = lineFacts(data, map, line);
  const walkable = line.kind === 'road' || line.kind === 'path';
  const commit = () => {
    if (name.trim() !== line.name) renameLine(db, map.id, line.id, name.trim());
  };
  return (
    <div className={box}>
      <div className="wf-karten-card__sort">{facts.sort}</div>
      <Input
        value={name}
        placeholder="Name – etwa „Alte Handelsstraße“"
        aria-label="Name der Linie"
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <dl className="wf-karten-card__facts">
        {facts.km !== null && (
          <>
            <dt>Länge</dt>
            <dd>{formatLength(facts.km)}</dd>
          </>
        )}
        {facts.minutes !== null && (
          <>
            <dt>Zu Fuß</dt>
            <dd>{formatWayTime(facts.minutes)}</dd>
          </>
        )}
        {walkable && facts.km !== null && (
          <>
            <dt>Gelände</dt>
            <dd>
              {line.kind === 'road'
                ? `${facts.sort} – volles Tempo`
                : facts.difficult > 0.02
                  ? `${Math.round(facts.difficult * 100)} % schwierig`
                  : 'leicht'}
            </dd>
          </>
        )}
      </dl>
      {facts.wet && (
        <p className="wf-karten-card__warn">
          Der Pfad führt durch Wasser. Ohne Brücke oder Furt kommt hier niemand zu Fuß hinüber.
        </p>
      )}
      {facts.blocked && (
        <p className="wf-karten-card__warn">
          Der Pfad führt durch Fels oder über einen Abgrund. Dort kommt nur ein Gang hindurch.
        </p>
      )}
      {facts.way ? (
        <p>
          Im Wegenetz: {facts.way.from} ↔ {facts.way.to}. Die Gruppe kann diesen Weg gehen; die
          Dauer folgt dem Gelände.
        </p>
      ) : (
        walkable && (
          <p className="wf-mute">
            Beginnt und endet die Linie an einem Ort der Welt, wird sie zum Weg im Wegenetz.
          </p>
        )
      )}
      <div className="wf-karten-card__acts">
        <Button size="sm" variant="ghost" icon={<Trash2 aria-hidden />} onClick={onRemove}>
          Entfernen
        </Button>
      </div>
    </div>
  );
}

/** Einen Ort auf die Karte setzen: einen Eintrag der Welt oder nur eine Beschriftung. */
function PinDialog({
  onClose,
  onPlace,
}: {
  onClose: () => void;
  onPlace: (entityId: string | null, label: string) => void;
}) {
  const db = useDb();
  const [entityId, setEntityId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const ready = entityId !== null || label.trim() !== '';
  return (
    <Dialog
      open
      onClose={onClose}
      title="Ort setzen"
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => onPlace(entityId, label.trim())}
          >
            Setzen
          </Button>
        </>
      }
    >
      <div className="wf-col">
        <Field
          label="Ort der Welt"
          hint="Zwei Orte der Welt, mit einer Straße, einem Gang oder einem Pfad verbunden, ergeben einen Weg."
        >
          <EntityPicker
            value={entityId}
            onChange={setEntityId}
            kinds={['place']}
            placeholder="Ort suchen oder neu anlegen …"
            onCreate={(name) => db.put('entities', createEntity({ kind: 'place', name })).id}
            autoFocus
          />
        </Field>
        {entityId === null && (
          <Field label="Oder nur eine Beschriftung" hint="Für Kleinigkeiten ohne eigenen Eintrag.">
            <Input
              value={label}
              placeholder="etwa „Alte Eiche“"
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
        )}
      </div>
    </Dialog>
  );
}
