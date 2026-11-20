/**
 * Wegenetze: Strecken und Gegenden vorbereiten – Punkte auf einem Blatt, Wege dazwischen, und zu
 * jedem Punkt und jedem Weg, was dort wartet. Die Rechnung steht in `domain/net.ts`, die Wege
 * selbst gehören zum Wegenetz der Welt (`domain/ways.ts`): Was hier vorbereitet ist, geht die
 * Gruppe am Spieltisch mit einem Klick.
 */
import { MaterialBack } from '../welt/MaterialBox';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import {
  EyeOff,
  Footprints,
  Maximize,
  Minus,
  PenLine,
  Plus,
  Route as RouteIcon,
  TriangleAlert,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { netView, type NetLinkView, type NetPointView } from '../../domain/net';
import { createEntity, type Net } from '../../domain/schema';
import { formatWayTime } from '../../domain/ways';
import { Button, Dialog, EmptyState, EntityPicker, IconButton, Select, cx, toast } from '../../ui';
import { useBoard } from '../../ui/board';
import { addNet, addPoint, connectPoints, movePoint } from './actions';
import { LinkPanel, NetPanel, PointPanel } from './panels';
import { RouteDialog } from './RouteDialog';
import './wegenetz.css';

type Selected = { type: 'point'; id: string } | { type: 'link'; id: string } | null;
type OpenDialog = { type: 'route' } | { type: 'add'; at: { x: number; y: number } | null } | null;

export default function WegenetzPage() {
  const db = useDb();
  const data = useData();
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const nets = useMemo(
    () => Object.values(data.nets).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [data.nets],
  );
  const net = params.id ? data.nets[params.id] : nets[0];
  const create = () => navigate(`/wegenetze/${addNet(db).id}`);

  if (!nets.length)
    return (
      <div className="wf-netz wf-netz--empty">
        <EmptyState
          icon={<RouteIcon />}
          title="Noch kein Wegenetz"
          action={
            <Button variant="primary" icon={<Plus />} onClick={create}>
              Erstes Wegenetz anlegen
            </Button>
          }
        >
          Ein Wegenetz ist eine vorbereitete Strecke oder Gegend: Punkte, die Wege dazwischen und
          was an jedem Punkt und auf jedem Weg wartet – mit allen Abzweigungen. Du schreibst die
          Strecke einfach hin („A -&gt; B (4 Std.) -&gt; C“) oder setzt die Punkte von Hand. Am
          Spieltisch geht die Gruppe die Wege dann mit einem Klick.
        </EmptyState>
      </div>
    );

  return (
    <div className="wf-netz">
      {net ? (
        <NetSheet key={net.id} net={net} nets={nets} onCreate={create} />
      ) : (
        <div className="wf-netz-gone">
          <EmptyState icon={<RouteIcon />} title="Dieses Wegenetz gibt es nicht mehr">
            Wähle links ein anderes.
          </EmptyState>
        </div>
      )}
    </div>
  );
}

/** Der Abstand, um den Wege zwischen denselben zwei Punkten auseinanderrücken. */
const PARALLEL_GAP = 34;

interface Shape {
  link: NetLinkView;
  /** Der Verlauf als SVG-Pfad. */
  d: string;
  /** Die Mitte – dort steht die Dauer. */
  mid: { x: number; y: number };
  /** Richtung des Weges in Grad, für den Pfeil eines Weges „nur in dieser Richtung“. */
  angle: number;
}

function NetSheet({ net, nets, onCreate }: { net: Net; nets: Net[]; onCreate: () => void }) {
  const [, navigate] = useLocation();
  const db = useDb();
  const data = useData();
  const view = useMemo(() => netView(data, net), [data, net]);
  const frame = useRef<HTMLDivElement>(null);
  const board = useBoard(frame);
  const [selected, setSelected] = useState<Selected>(null);
  /** Von diesem Punkt aus wird gerade ein Weg gezogen. */
  const [linking, setLinking] = useState<string | null>(null);
  /** Ein Punkt wird gerade gezogen: seine Stelle, bis er losgelassen wird. */
  const [moving, setMoving] = useState<{ id: string; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const at = (point: NetPointView) => (moving?.id === point.place.id ? moving : point);
  const showAll = () => board.fit(view.points, 80);
  // Beim Öffnen liegt das ganze Netz im Bild.
  useLayoutEffect(showAll, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLinking(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shapes = useMemo(() => {
    const pairs = new Map<string, NetLinkView[]>();
    for (const link of view.links) {
      const key = [link.from.place.id, link.to.place.id].sort().join('|');
      pairs.set(key, [...(pairs.get(key) ?? []), link]);
    }
    const out: Shape[] = [];
    for (const group of pairs.values())
      group.forEach((link, index) => {
        const [a, b] = [at(link.from), at(link.to)];
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        // Mehrere Wege zwischen denselben Punkten biegen sich auseinander – immer zur selben
        // Seite, gleich in welcher Richtung der Weg eingetragen ist.
        const flip = link.from.place.id < link.to.place.id ? 1 : -1;
        const bend = (index - (group.length - 1) / 2) * PARALLEL_GAP * 2 * flip;
        const cx = (a.x + b.x) / 2 + (-(b.y - a.y) / length) * bend;
        const cy = (a.y + b.y) / 2 + ((b.x - a.x) / length) * bend;
        out.push({
          link,
          d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`,
          mid: { x: (a.x + 2 * cx + b.x) / 4, y: (a.y + 2 * cy + b.y) / 4 },
          angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
        });
      });
    return out;
    // `moving` gehört dazu: Die Linien folgen dem Punkt, der gerade gezogen wird.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, moving]);

  const clickPoint = (id: string) => {
    if (linking && linking !== id) {
      const path = connectPoints(db, net.id, linking, id);
      setLinking(null);
      setSelected(path ? { type: 'link', id: path.id } : { type: 'point', id });
    } else {
      setLinking(null);
      setSelected({ type: 'point', id });
    }
  };
  const point =
    selected?.type === 'point' ? view.points.find((p) => p.place.id === selected.id) : undefined;
  const link =
    selected?.type === 'link' ? view.links.find((l) => l.path.id === selected.id) : undefined;

  return (
    <>
      <section className="wf-netz-stage">
        <header className="wf-netz-head">
          <Select
            className="wf-netz-pick"
            value={net.id}
            aria-label="Wegenetz wählen"
            onChange={(event) => navigate(`/wegenetze/${event.target.value}`)}
          >
            {nets.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </Select>
          <Button icon={<Plus />} onClick={onCreate} title="Ein weiteres Wegenetz anlegen">
            Neues Netz
          </Button>
          <MaterialBack refTo={{ type: 'net', id: net.id }} />
          <span className="wf-grow" />
          <Button icon={<Plus />} onClick={() => setDialog({ type: 'add', at: null })}>
            Ort hinzufügen
          </Button>
          <Button variant="primary" icon={<PenLine />} onClick={() => setDialog({ type: 'route' })}>
            Strecke schreiben
          </Button>
        </header>
        <div
          ref={frame}
          className={cx('wf-netz-board', linking && 'wf-netz-board--linking')}
          onPointerDown={(event) =>
            board.pan(event, () => {
              setSelected(null);
              setLinking(null);
            })
          }
          onDoubleClick={(event) =>
            setDialog({ type: 'add', at: board.toBoard(event.clientX, event.clientY) })
          }
        >
          <div className="wf-netz-layer" style={{ transform: board.transform }}>
            <svg className="wf-netz-lines" aria-hidden>
              {shapes.map(({ link: l, d }) => (
                <g key={l.path.id}>
                  <path
                    d={d}
                    className={cx(
                      'wf-netz-line',
                      l.path.secret && 'wf-netz-line--secret',
                      l.barred && 'wf-netz-line--barred',
                      l.path.id === link?.path.id && 'wf-netz-line--on',
                    )}
                  />
                  <path
                    d={d}
                    className="wf-netz-line__hit"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => setSelected({ type: 'link', id: l.path.id })}
                  />
                </g>
              ))}
            </svg>
            {shapes.map(({ link: l, mid, angle }) => (
              <button
                key={l.path.id}
                type="button"
                className={cx(
                  'wf-netz-time',
                  l.minutes === null && 'wf-netz-time--open',
                  l.barred && 'wf-netz-time--barred',
                  l.path.id === link?.path.id && 'wf-netz-time--on',
                )}
                style={{ left: mid.x, top: mid.y }}
                title={[
                  `${l.from.place.name} ${l.path.oneWay ? '→' : '–'} ${l.to.place.name}`,
                  l.path.name,
                  l.path.conditions,
                  l.path.secret ? 'Die Gruppe kennt diesen Weg noch nicht.' : '',
                ]
                  .filter(Boolean)
                  .join('\n')}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={() => setSelected({ type: 'link', id: l.path.id })}
              >
                {l.path.oneWay && (
                  <span
                    className="wf-netz-time__arrow"
                    style={{ transform: `rotate(${angle}deg)` }}
                    aria-label="nur in dieser Richtung"
                  >
                    ➤
                  </span>
                )}
                {l.minutes === null ? 'Dauer offen' : formatWayTime(l.minutes)}
                {l.eventful && <TriangleAlert aria-label="Unterwegs wartet etwas" />}
                {l.path.secret && <EyeOff aria-label="Der Gruppe unbekannt" />}
              </button>
            ))}
            {view.points.map((p) => {
              const spot = at(p);
              return (
                <button
                  key={p.place.id}
                  type="button"
                  className={cx(
                    'wf-netz-point',
                    p.here && 'wf-netz-point--here',
                    p.prepared && 'wf-netz-point--prepared',
                    p.place.id === point?.place.id && 'wf-netz-point--on',
                    p.place.id === linking && 'wf-netz-point--from',
                  )}
                  style={{ left: spot.x, top: spot.y }}
                  title={p.here ? `${p.place.name} – die Gruppe ist hier` : p.place.name}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    board.drag(event, {
                      onMove: (dx, dy) => setMoving({ id: p.place.id, x: p.x + dx, y: p.y + dy }),
                      onEnd: (moved, dx, dy) => {
                        setMoving(null);
                        if (moved) movePoint(db, net.id, p.place.id, p.x + dx, p.y + dy);
                        else clickPoint(p.place.id);
                      },
                    });
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <span className="wf-netz-point__dot">{p.here && <Footprints />}</span>
                  <span className="wf-netz-point__name">{p.place.name}</span>
                  {p.hanging > 0 && (
                    <span
                      className="wf-netz-point__count"
                      title="So viel hängt an diesem Punkt: Geschichten, Fäden, Uhren, Bestände, Begegnungen"
                    >
                      {p.hanging}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="wf-netz-tools" onPointerDown={(event) => event.stopPropagation()}>
            <IconButton label="Größer" size="sm" onClick={() => board.zoom(1.25)}>
              <Plus />
            </IconButton>
            <IconButton label="Kleiner" size="sm" onClick={() => board.zoom(0.8)}>
              <Minus />
            </IconButton>
            <IconButton label="Alles zeigen" size="sm" onClick={showAll}>
              <Maximize />
            </IconButton>
          </div>
          {linking && (
            <div className="wf-netz-hint" role="status">
              Wähle den Punkt, zu dem der Weg führt – Esc bricht ab.
            </div>
          )}
          {view.points.length === 0 && (
            <div className="wf-netz-blank" onPointerDown={(event) => event.stopPropagation()}>
              <EmptyState
                icon={<RouteIcon />}
                title="Das Blatt ist leer"
                action={
                  <Button icon={<PenLine />} onClick={() => setDialog({ type: 'route' })}>
                    Strecke schreiben
                  </Button>
                }
              >
                Schreib die Strecke hin, Punkt für Punkt mit Pfeilen dazwischen – oder setz einen
                ersten Ort mit einem Doppelklick aufs Blatt.
              </EmptyState>
            </div>
          )}
        </div>
      </section>

      <aside className="wf-netz-panel" aria-label="Angaben">
        {point ? (
          <PointPanel
            key={point.place.id}
            net={net}
            point={point}
            links={view.links.filter((l) => l.from === point || l.to === point)}
            linking={linking === point.place.id}
            onLink={() => setLinking(linking ? null : point.place.id)}
            onSelect={setSelected}
          />
        ) : link ? (
          <LinkPanel key={link.path.id} link={link} onGone={() => setSelected(null)} />
        ) : (
          <NetPanel key={net.id} net={net} view={view} />
        )}
      </aside>

      {dialog?.type === 'route' && (
        <RouteDialog
          net={net}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            // Erst nach dem nächsten Zeichnen kennt das Blatt die neuen Punkte.
            requestAnimationFrame(() =>
              board.fit(db.getSnapshot().nets[net.id]?.points ?? view.points, 80),
            );
          }}
        />
      )}
      {dialog?.type === 'add' && (
        <AddPointDialog
          net={net}
          onClose={() => setDialog(null)}
          onPick={(placeId) => {
            addPoint(db, net.id, placeId, dialog.at);
            setDialog(null);
            setSelected({ type: 'point', id: placeId });
          }}
        />
      )}
    </>
  );
}

/** Einen Ort der Welt als Punkt aufs Blatt holen – oder einen neuen anlegen. */
function AddPointDialog({
  net,
  onPick,
  onClose,
}: {
  net: Net;
  onPick: (placeId: string) => void;
  onClose: () => void;
}) {
  const db = useDb();
  const exclude = useMemo(() => net.points.map((point) => point.placeId), [net.points]);
  return (
    <Dialog open onClose={onClose} title="Ort hinzufügen" width={460} guard={false}>
      <div className="wf-col" style={{ gap: 'var(--s-3)' }}>
        <EntityPicker
          value={null}
          onChange={(id) => {
            if (id) onPick(id);
          }}
          kinds={['place']}
          exclude={exclude}
          autoFocus
          placeholder="Ort wählen oder neu anlegen …"
          onCreate={(text) => {
            const place = db.put('entities', createEntity({ kind: 'place', name: text }));
            toast({ title: `„${place.name}“ steht jetzt in der Welt`, body: 'als Ort' });
            return place.id;
          }}
        />
        <p className="wf-mute">
          Ein Punkt ist ein Ort deiner Welt. Wege, die es zwischen den Punkten schon gibt,
          erscheinen von selbst.
        </p>
      </div>
    </Dialog>
  );
}
