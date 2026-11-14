/**
 * Zeitleiste in Bahnen: was war und was kommt, Bahn für Bahn auf einer Achse der Weltzeit – die
 * Gruppe, Geschichten mit Uhr, Fraktionen, ausgewählte Personen und Orte, die Termine. Die Abende
 * liegen als Bänder darüber, „Jetzt“ ist eine Messinglinie. Zoomen mit dem Mausrad oder den
 * Knöpfen (von Stunden bis Jahrhunderten), Ziehen verschiebt. Die Rechnung steht in
 * `domain/timeline.ts`; gezeichnet wird nur, was im Bild ist.
 */
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { useLocation } from 'wouter';
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Maximize,
  Minus,
  Plus,
  Rows3,
  Users,
  X,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { useMediaSrc } from '../../data/media';
import type { ChronicleEntry } from '../../domain/schema';
import { KIND_LABEL as ENTRY_KIND_LABEL } from '../../domain/chronicleKinds';
import { dayIndexOf } from '../../domain/time/calendar';
import {
  AXIS_UNITS,
  AXIS_UNIT_LABEL,
  axisContext,
  axisTicks,
  centerView,
  evenings,
  eveningsInView,
  fitView,
  laneChoices,
  laneKeysOf,
  laneOf,
  layoutLane,
  panView,
  pieceWhen,
  timelineExtent,
  toX,
  zoomPreset,
  zoomUnit,
  zoomView,
  type AxisUnit,
  type LaidPiece,
  type PieceLink,
  type TimelineLane,
  type TimelinePiece,
  type TimelineView,
} from '../../domain/timeline';
import { focusOn } from '../../shell/focus';
import {
  Button,
  Checkbox,
  EmptyState,
  EntityPicker,
  IconButton,
  Popover,
  cx,
  entityHref,
} from '../../ui';
import { EntryDialog } from '../chronik/EntryDialog';
import { showSessionInChronicle } from '../chronik/link';
import { addLane, moveLane, removeLane, resetLanes } from './actions';
import './zeitleiste.css';

/** Breite der Köpfe links. */
const HEAD_W = 244;
/** Höhe einer Reihe und Rand einer Bahn – wie in zeitleiste.css. */
const ROW_H = 26;
const LANE_PAD = 9;

/** Wo die Zeitleiste stand, solange die App läuft. */
const memory: { from: number | null; mpp: number | null } = { from: null, mpp: null };

const KIND_WORD: Record<TimelinePiece['kind'], string> = {
  stay: 'Aufenthalt der Gruppe',
  visit: 'Besuch der Gruppe',
  milestone: 'Meilenstein',
  step: 'Schritt der Uhr',
  life: 'Lebensdaten',
  entry: 'Eintrag der Chronik',
  event: 'Termin',
  rail: 'Laufzeit',
};

const TONE_WORD: Partial<Record<TimelinePiece['tone'], string>> = {
  future: 'steht noch aus',
  prevented: 'verhindert',
  blocked: 'die Uhr steht',
  overdue: 'überfällig',
};

type Hover = { item: LaidPiece; x: number; y: number };

export default function ZeitleistePage() {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const [, navigate] = useLocation();
  const stage = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<TimelineView | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const [editing, setEditing] = useState<ChronicleEntry | null>(null);
  const [choosing, setChoosing] = useState(false);
  const chooser = useRef<HTMLButtonElement>(null);
  const dragged = useRef(false);
  /** Beendet ein Ziehen, das noch läuft. */
  const endDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => endDrag.current?.(), []);

  // Die Breite der Bühne – beim Öffnen steht „Jetzt“ etwas rechts der Mitte.
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, el.clientWidth - HEAD_W));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!width) return;
    setView((current) => {
      if (current) return { ...current, width };
      const mpp = memory.mpp ?? zoomPreset(cal, 'day');
      const start = { from: 0, mpp, width };
      return memory.from !== null
        ? { ...start, from: memory.from }
        : centerView(start, now, width * 0.62);
    });
    // Nur beim Messen – die Weltzeit verschiebt das Bild nicht.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);
  useEffect(() => {
    if (!view) return;
    memory.from = view.from;
    memory.mpp = view.mpp;
  }, [view]);

  const keys = useMemo(() => laneKeysOf(data), [data]);
  // Alles außer den Terminen hängt nur am Spielstand; Termine am Fenster (wiederkehrende).
  const fixedLanes = useMemo(
    () =>
      new Map(
        keys
          .filter((key) => key !== 'events')
          .map((key) => [key, laneOf(data, key, { from: 0, to: 0 })] as const),
      ),
    [data, keys],
  );
  const bucket = view ? windowBucket(view) : null;
  const eventsLane = useMemo(
    () => (bucket && keys.includes('events') ? laneOf(data, 'events', bucket) : null),
    // Das Fenster ist gestuft: Es ändert sich erst, wenn das Bild weit genug gewandert ist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, keys, bucket?.from, bucket?.to],
  );
  const lanes = useMemo(
    () =>
      keys
        .map((key) => (key === 'events' ? eventsLane : fixedLanes.get(key)))
        .filter((lane): lane is TimelineLane => !!lane),
    [keys, eventsLane, fixedLanes],
  );
  const bands = useMemo(() => evenings(data), [data]);
  const empty = lanes.every((lane) => lane.pieces.length === 0) && bands.length === 0;

  // Mausrad: zoomen um die Stelle unter der Maus; waagrecht (oder mit Umschalt) verschieben.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const x = event.clientX - rect.left - HEAD_W;
      if (x < 0) return;
      event.preventDefault();
      setHover(null);
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;
      setView((current) => {
        if (!current) return current;
        if (horizontal) return panView(current, -(event.shiftKey ? event.deltaY : event.deltaX));
        const factor = Math.exp(Math.max(-0.5, Math.min(0.5, event.deltaY * 0.0022)));
        return zoomView(cal, current, factor, x);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [cal]);

  // Ziehen verschiebt; ein Klick ohne Ziehen öffnet, was darunter liegt.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !view) return;
    const target = event.target as HTMLElement;
    if (target.closest('.wf-zeitleiste-head, button, a, input')) {
      if (!target.closest('.wf-zeitleiste-piece')) return;
    }
    endDrag.current?.();
    const startX = event.clientX;
    let last = startX;
    dragged.current = false;
    const move = (e: PointerEvent) => {
      // Losgelassen, ohne dass es hier ankam (etwa außerhalb des Fensters): Schluss.
      if (e.buttons === 0) return up();
      if (!dragged.current && Math.abs(e.clientX - startX) < 4) return;
      if (!dragged.current) {
        dragged.current = true;
        stage.current?.classList.add('is-dragging');
        setHover(null);
      }
      const dx = e.clientX - last;
      last = e.clientX;
      setView((v) => (v ? panView(v, dx) : v));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      endDrag.current = null;
      stage.current?.classList.remove('is-dragging');
      // Der Klick nach dem Ziehen zählt nicht.
      setTimeout(() => (dragged.current = false), 0);
    };
    endDrag.current = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const open = (link: PieceLink | null) => {
    if (!link || dragged.current) return;
    switch (link.type) {
      case 'entity': {
        const entity = data.entities[link.id];
        if (entity) navigate(entityHref(entity));
        return;
      }
      case 'story':
        navigate(`/geschichte/${link.id}`);
        return;
      case 'clock':
        focusOn({ type: 'clock', id: link.id });
        navigate('/geschehen');
        return;
      case 'chronicle': {
        const entry = data.chronicle[link.id];
        if (entry) setEditing(entry);
        return;
      }
      case 'session':
        showSessionInChronicle(link.id);
        navigate('/chronik');
        return;
      case 'event':
        focusOn({ type: 'day', day: dayIndexOf(link.at) });
        navigate('/kalender');
        return;
    }
  };
  const openItem = (item: LaidPiece) => {
    if (dragged.current || !view) return;
    if (item.cluster) {
      setHover(null);
      setView(fitView(cal, view, { from: item.cluster.from, to: item.cluster.to }));
      return;
    }
    open(item.piece.link);
  };
  const openLane = (lane: TimelineLane) => {
    if (lane.kind === 'party') navigate('/gruppe');
    else if (lane.kind === 'events') navigate('/kalender');
    else open(lane.link);
  };

  const unit: AxisUnit | null = view ? zoomUnit(cal, view.mpp) : null;
  const zoomTo = (next: AxisUnit) =>
    setView((v) => (v ? zoomView(cal, v, zoomPreset(cal, next) / v.mpp, v.width / 2) : v));
  const zoomBy = (factor: number) =>
    setView((v) =>
      v
        ? zoomView(
            cal,
            v,
            factor,
            toX(v, now) > 0 && toX(v, now) < v.width ? toX(v, now) : v.width / 2,
          )
        : v,
    );
  const toNow = () => setView((v) => (v ? centerView(v, now, v.width * 0.62) : v));
  const showAll = () =>
    setView((v) => (v ? fitView(cal, v, timelineExtent(lanes, bands, now)) : v));

  return (
    <div className="wf-page wf-zeitleiste">
      <header className="wf-page__head wf-zeitleiste-top">
        <div>
          <h1 className="wf-page__title">Zeitleiste</h1>
          <p className="wf-page__lead">
            Was war und was kommt – Bahn für Bahn. Mausrad zoomt, Ziehen verschiebt, ein Klick
            öffnet.
          </p>
        </div>
        <span className="wf-grow" />
        <div className="wf-btn-group" role="group" aria-label="Zoomstufe">
          {AXIS_UNITS.map((entry) => (
            <Button
              key={entry}
              size="sm"
              aria-pressed={unit === entry}
              onClick={() => zoomTo(entry)}
            >
              {AXIS_UNIT_LABEL[entry]}
            </Button>
          ))}
        </div>
        <div className="wf-zeitleiste-tools">
          <IconButton label="Kleiner – mehr Zeit im Bild" size="sm" onClick={() => zoomBy(1.6)}>
            <Minus />
          </IconButton>
          <IconButton label="Größer – weniger Zeit im Bild" size="sm" onClick={() => zoomBy(0.625)}>
            <Plus />
          </IconButton>
          <IconButton label="Alles zeigen" size="sm" onClick={showAll}>
            <Maximize />
          </IconButton>
          <Button size="sm" icon={<Crosshair />} onClick={toNow}>
            Zum Jetzt
          </Button>
          <Button
            ref={chooser}
            size="sm"
            icon={<Rows3 />}
            aria-expanded={choosing}
            onClick={() => setChoosing((o) => !o)}
          >
            Bahnen
          </Button>
        </div>
        <LaneChooser open={choosing} onClose={() => setChoosing(false)} anchor={chooser} />
      </header>

      <div className="wf-zeitleiste-frame wf-panel">
        <div
          ref={stage}
          className="wf-zeitleiste-stage"
          onPointerDown={onPointerDown}
          // Waagrecht wird nie gerollt – auch nicht, wenn der Browser ein Stück ins Bild holen will.
          onScroll={(event) => {
            if (event.currentTarget.scrollLeft) event.currentTarget.scrollLeft = 0;
          }}
        >
          {view && (
            <Board
              view={view}
              lanes={lanes}
              bands={bands}
              now={now}
              onHover={setHover}
              onOpen={openItem}
              onOpenLane={openLane}
              onRemove={(key) => removeLane(db, key)}
              onMove={(key, by) => moveLane(db, key, by)}
              onAdd={() => setChoosing(true)}
            />
          )}
          {empty && (
            <div className="wf-zeitleiste-blank">
              <EmptyState icon={<Rows3 />} title="Noch nichts auf der Zeitleiste">
                Hier stehen die Abende, wo die Gruppe war, die Schritte der Uhren, Feste und
                Lebensdaten – sobald du sie in Chronik, Kalender und auf den Blättern der
                Geschichten einträgst.
              </EmptyState>
            </div>
          )}
        </div>
      </div>

      {hover && view && <Tip hover={hover} />}
      {editing && (
        <EntryDialog request={{ mode: 'edit', entry: editing }} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** Ein Fenster für wiederkehrende Termine, gestuft – damit nicht jedes Verschieben neu rechnet. */
function windowBucket(view: TimelineView): { from: number; to: number } {
  const span = Math.pow(2, Math.ceil(Math.log2(Math.max(60, view.width * view.mpp))));
  const from = Math.floor(view.from / span) * span - span;
  return { from: Math.max(0, from), to: from + 4 * span };
}

// ── Die Bühne ──────────────────────────────────────────────────────────────

function Board({
  view,
  lanes,
  bands,
  now,
  onHover,
  onOpen,
  onOpenLane,
  onRemove,
  onMove,
  onAdd,
}: {
  view: TimelineView;
  lanes: TimelineLane[];
  bands: ReturnType<typeof evenings>;
  now: number;
  onHover: (hover: Hover | null) => void;
  onOpen: (item: LaidPiece) => void;
  onOpenLane: (lane: TimelineLane) => void;
  onRemove: (key: string) => void;
  onMove: (key: string, by: -1 | 1) => void;
  onAdd: () => void;
}) {
  const data = useData();
  const cal = data.campaign.calendar;
  const axis = useMemo(() => axisTicks(cal, view), [cal, view]);
  const where = axisContext(cal, view);
  const visibleBands = eveningsInView(bands, view);
  const nowX = toX(view, now);
  const showNow = nowX >= -2 && nowX <= view.width + 2;

  return (
    <div className="wf-zeitleiste-board" style={{ ['--head-w' as string]: `${HEAD_W}px` }}>
      {/* Die Achse oben – bleibt beim Rollen stehen. */}
      <div className="wf-zeitleiste-axis">
        <div className="wf-zeitleiste-corner">
          {where && <span className="wf-zeitleiste-corner__where">{where}</span>}
          <span className="wf-caps">{AXIS_UNIT_LABEL[axis.unit]}</span>
        </div>
        <div className="wf-zeitleiste-ruler" style={{ width: view.width }}>
          {axis.ticks.map((tick) => {
            const x = toX(view, tick.at);
            return (
              <div
                key={tick.at}
                className="wf-zeitleiste-tick"
                data-major={tick.major !== null || undefined}
                style={{ transform: `translateX(${x}px)` }}
              >
                {tick.major && <span className="wf-zeitleiste-tick__major">{tick.major}</span>}
                <span className="wf-zeitleiste-tick__label wf-num">{tick.label}</span>
              </div>
            );
          })}
          {visibleBands.map((band) => {
            const x = Math.max(0, toX(view, band.from));
            const w = toX(view, band.to) - x;
            // Zu schmal für eine Beschriftung: Das Band selbst genügt.
            if (w < 24) return null;
            return (
              <span
                key={band.key}
                className="wf-zeitleiste-evening-tag"
                data-running={band.running || undefined}
                style={{ transform: `translateX(${x}px)`, maxWidth: w }}
                title={band.title}
              >
                {w > 84 ? band.title : band.number}
              </span>
            );
          })}
          {showNow && (
            <span
              className="wf-zeitleiste-now-tag"
              style={{ transform: `translateX(${nowX}px) translateX(-50%)` }}
            >
              Jetzt
            </span>
          )}
        </div>
      </div>

      <div className="wf-zeitleiste-lanes">
        {/* Abende, Monatsgrenzen und „Jetzt“ liegen über allen Bahnen. */}
        <div className="wf-zeitleiste-veil" style={{ width: view.width }} aria-hidden>
          {axis.ticks.map((tick) => (
            <span
              key={tick.at}
              className="wf-zeitleiste-gridline"
              data-major={tick.major !== null || undefined}
              style={{ transform: `translateX(${toX(view, tick.at)}px)` }}
            />
          ))}
          {visibleBands.map((band) => {
            const x = toX(view, band.from);
            return (
              <span
                key={band.key}
                className="wf-zeitleiste-evening"
                data-running={band.running || undefined}
                style={{
                  transform: `translateX(${x}px)`,
                  width: Math.max(2, toX(view, band.to) - x),
                }}
              />
            );
          })}
        </div>
        {lanes.map((lane, index) => (
          <Lane
            key={lane.key}
            lane={lane}
            view={view}
            first={index === 0}
            last={index === lanes.length - 1}
            onHover={onHover}
            onOpen={onOpen}
            onOpenLane={onOpenLane}
            onRemove={onRemove}
            onMove={onMove}
          />
        ))}
        <div className="wf-zeitleiste-more">
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={onAdd}>
            Bahn hinzufügen
          </Button>
          <span className="wf-zeitleiste-more__hint">
            Geschichten mit Uhr, Fraktionen, Personen, Orte – die Auswahl bleibt im Spielstand.
          </span>
        </div>
        {showNow && (
          <div className="wf-zeitleiste-nowlayer" style={{ width: view.width }} aria-hidden>
            <span className="wf-zeitleiste-now" style={{ transform: `translateX(${nowX}px)` }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Eine Bahn ──────────────────────────────────────────────────────────────

const Lane = memo(function Lane({
  lane,
  view,
  first,
  last,
  onHover,
  onOpen,
  onOpenLane,
  onRemove,
  onMove,
}: {
  lane: TimelineLane;
  view: TimelineView;
  first: boolean;
  last: boolean;
  onHover: (hover: Hover | null) => void;
  onOpen: (item: LaidPiece) => void;
  onOpenLane: (lane: TimelineLane) => void;
  onRemove: (key: string) => void;
  onMove: (key: string, by: -1 | 1) => void;
}) {
  const layout = useMemo(() => layoutLane(lane.pieces, view), [lane.pieces, view]);
  const height = LANE_PAD * 2 + layout.rows * ROW_H;
  const rowY = (row: number) => LANE_PAD + row * ROW_H + ROW_H / 2;
  const enter = (item: LaidPiece) => (event: ReactPointerEvent) =>
    onHover({ item, x: event.clientX, y: event.clientY });

  return (
    <section className="wf-zeitleiste-lane" data-kind={lane.kind} style={{ height }}>
      <div className="wf-zeitleiste-head">
        <Seal lane={lane} />
        <button
          type="button"
          className="wf-zeitleiste-head__text"
          onClick={() => onOpenLane(lane)}
          title={`${lane.title} öffnen`}
        >
          <span className="wf-zeitleiste-head__title wf-clamp-1">{lane.title}</span>
          <span className="wf-zeitleiste-head__sub wf-clamp-1">{lane.sub}</span>
        </button>
        <span className="wf-zeitleiste-head__tools">
          <IconButton
            label="Nach oben"
            size="sm"
            disabled={first}
            onClick={() => onMove(lane.key, -1)}
          >
            <ChevronUp />
          </IconButton>
          <IconButton
            label="Nach unten"
            size="sm"
            disabled={last}
            onClick={() => onMove(lane.key, 1)}
          >
            <ChevronDown />
          </IconButton>
          <IconButton label="Bahn ausblenden" size="sm" onClick={() => onRemove(lane.key)}>
            <X />
          </IconButton>
        </span>
      </div>
      <div className="wf-zeitleiste-track" style={{ width: view.width }}>
        {layout.rails.map((rail) => (
          <span
            key={rail.key}
            className="wf-zeitleiste-rail"
            data-tone={rail.piece.tone}
            data-soft={rail.piece.precision !== 'exact' || undefined}
            style={{
              transform: `translate(${rail.x}px, ${rowY(0)}px)`,
              width: Math.max(0, rail.w),
            }}
          />
        ))}
        {layout.items.map((item) => (
          <Piece
            key={item.key}
            item={item}
            y={rowY(item.row)}
            onEnter={enter(item)}
            onLeave={() => onHover(null)}
            onOpen={() => onOpen(item)}
          />
        ))}
        {lane.pieces.length === 0 && (
          <span className="wf-zeitleiste-lane__none">Noch nichts mit Datum</span>
        )}
      </div>
    </section>
  );
});

/** Das Siegel einer Bahn: das eigene Bild des Eintrags, sonst sein Monogramm. */
function Seal({ lane }: { lane: TimelineLane }) {
  const src = useMediaSrc();
  const image = lane.image ? src(lane.image) : undefined;
  return (
    <span className="wf-zeitleiste-seal" aria-hidden>
      {image ? (
        <img src={image} alt="" loading="lazy" decoding="async" draggable={false} />
      ) : lane.kind === 'party' ? (
        <Users />
      ) : lane.kind === 'events' ? (
        <CalendarDays />
      ) : (
        <span className="wf-zeitleiste-seal__mono">{lane.monogram}</span>
      )}
    </span>
  );
}

function Piece({
  item,
  y,
  onEnter,
  onLeave,
  onOpen,
}: {
  item: LaidPiece;
  y: number;
  onEnter: (event: ReactPointerEvent) => void;
  onLeave: () => void;
  onOpen: () => void;
}) {
  const p = item.piece;
  const spread = item.w === 0 && item.hi - item.lo > 6;
  const common = {
    'data-kind': p.kind,
    'data-tone': p.tone,
    'data-weight': p.weight,
    'data-soft': p.precision !== 'exact' || undefined,
    onPointerEnter: onEnter,
    onPointerLeave: onLeave,
    onClick: onOpen,
  };
  if (item.w > 0)
    return (
      <button
        type="button"
        className="wf-zeitleiste-piece wf-zeitleiste-bar"
        {...common}
        style={{ transform: `translate(${item.x}px, ${y}px)`, width: item.w }}
      >
        {item.labelW > 0 && (
          <span className="wf-zeitleiste-bar__label" style={{ maxWidth: item.w - 12 }}>
            {p.text}
          </span>
        )}
      </button>
    );
  return (
    <>
      {spread && (
        <span
          className="wf-zeitleiste-spread"
          data-tone={p.tone}
          style={{ transform: `translate(${item.lo}px, ${y}px)`, width: item.hi - item.lo }}
          aria-hidden
        />
      )}
      <button
        type="button"
        className={cx('wf-zeitleiste-piece wf-zeitleiste-mark', item.cluster && 'is-cluster')}
        {...common}
        style={{ transform: `translate(${item.x}px, ${y}px)` }}
      >
        {item.cluster ? (
          <span className="wf-zeitleiste-cluster wf-num">{item.cluster.count}</span>
        ) : (
          <span className="wf-zeitleiste-mark__glyph" />
        )}
        {item.labelW > 0 && (
          <span className="wf-zeitleiste-mark__label" style={{ maxWidth: item.labelW }}>
            {p.text}
          </span>
        )}
      </button>
    </>
  );
}

// ── Was beim Darüberfahren steht ───────────────────────────────────────────

function Tip({ hover }: { hover: Hover }) {
  const data = useData();
  const cal = data.campaign.calendar;
  const { item } = hover;
  const p = item.piece;
  const left = Math.min(hover.x + 16, window.innerWidth - 340);
  const top = hover.y + 18 > window.innerHeight - 120 ? hover.y - 110 : hover.y + 18;
  if (item.cluster)
    return (
      <div className="wf-zeitleiste-tip" style={{ left, top }} role="tooltip">
        <span className="wf-zeitleiste-tip__kind">
          {item.cluster.count} Stücke dicht beieinander
        </span>
        <span className="wf-zeitleiste-tip__when">
          {pieceWhen(cal, { from: item.cluster.from, to: item.cluster.to, precision: 'day' })}
        </span>
        <span className="wf-zeitleiste-tip__hint">Klicken zum Heranzoomen</span>
      </div>
    );
  const entry = p.link?.type === 'chronicle' ? data.chronicle[p.link.id] : undefined;
  const kind = entry ? ENTRY_KIND_LABEL[entry.kind] : KIND_WORD[p.kind];
  const tone = TONE_WORD[p.tone];
  return (
    <div className="wf-zeitleiste-tip" data-tone={p.tone} style={{ left, top }} role="tooltip">
      <span className="wf-zeitleiste-tip__kind">
        {kind}
        {tone && ` · ${tone}`}
      </span>
      <span className="wf-zeitleiste-tip__text">{p.text}</span>
      <span className="wf-zeitleiste-tip__when">{pieceWhen(cal, p)}</span>
    </div>
  );
}

// ── Bahnen wählen ──────────────────────────────────────────────────────────

function LaneChooser({
  open,
  onClose,
  anchor,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLButtonElement | null>;
}) {
  const db = useDb();
  const data = useData();
  const keys = laneKeysOf(data);
  const choices = useMemo(() => laneChoices(data), [data]);
  const toggle = (key: string, on: boolean) => (on ? addLane(db, key) : removeLane(db, key));
  const extra = keys.filter((key) => !choices.some((choice) => choice.key === key));
  const groups: { title: string; kinds: string[] }[] = [
    { title: 'Immer zur Hand', kinds: ['party', 'events'] },
    { title: 'Geschichten mit Uhr', kinds: ['story'] },
    { title: 'Fraktionen und Familien', kinds: ['faction'] },
  ];
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} width={340}>
      <div className="wf-zeitleiste-chooser">
        {groups.map((group) => {
          const list = choices.filter((choice) => group.kinds.includes(choice.kind));
          if (!list.length) return null;
          return (
            <div key={group.title} className="wf-zeitleiste-chooser__group">
              <span className="wf-zeitleiste-chooser__title">{group.title}</span>
              {list.map((choice) => (
                <Checkbox
                  key={choice.key}
                  checked={keys.includes(choice.key)}
                  onChange={(on) => toggle(choice.key, on)}
                >
                  <span className="wf-clamp-1">{choice.title}</span>
                </Checkbox>
              ))}
            </div>
          );
        })}
        <div className="wf-zeitleiste-chooser__group">
          <span className="wf-zeitleiste-chooser__title">Personen, Orte und mehr</span>
          {extra.map((key) => {
            const entity = data.entities[key.slice(7)];
            if (!entity) return null;
            return (
              <Checkbox key={key} checked onChange={() => removeLane(db, key)}>
                <span className="wf-clamp-1">{entity.name}</span>
              </Checkbox>
            );
          })}
          <EntityPicker
            value={null}
            placeholder="Hinzufügen …"
            exclude={keys.filter((key) => key.startsWith('entity:')).map((key) => key.slice(7))}
            onChange={(id) => id && addLane(db, `entity:${id}`)}
          />
        </div>
        {data.state.timelineLanes !== null && (
          <Button size="sm" onClick={() => resetLanes(db)}>
            Wie Wayfarer es wählt
          </Button>
        )}
      </div>
    </Popover>
  );
}
