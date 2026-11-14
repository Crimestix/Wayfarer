/**
 * Das Fadenbrett: eine Pinnwand. Geschichten liegen als Karten darauf, daneben die Personen, Orte
 * und Fraktionen, an denen sie hängen – verbunden durch Fäden. Wo zwei Karten am selben Namen
 * hängen, berühren sich ihre Geschichten. Alles lässt sich frei legen; was der Spielleiter nicht
 * hingelegt hat, legt Wayfarer aus. Lose Fäden stehen in der Liste daneben (`LooseDrawer`) – aufs
 * Brett kommt einer nur, wenn der Spielleiter ihn hinlegt oder ins Spiel nimmt; von dort (und aus
 * der Liste) lässt er sich auf eine Geschichte ziehen. Die Rechnung steht in `domain/story.ts`
 * und `domain/looseThreads.ts`.
 */
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
} from 'react';
import { useLocation } from 'wouter';
import {
  Eye,
  EyeOff,
  LayoutGrid,
  Link2,
  Maximize,
  Minus,
  Pencil,
  Plus,
  TriangleAlert,
  Waypoints,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { looseThreads, threadTwins } from '../../domain/looseThreads';
import {
  BOARD_CARD,
  ENTRY_STANDING_LABEL,
  NEARNESS_LABEL,
  PACE_LABEL,
  THREAD_STATE_LABEL,
  boardCards,
  boardLayout,
  entryFit,
  isLooseThread,
  looseClocks,
  reputeOf,
  threadLive,
  threadWarning,
  touchReason,
  touches,
  untilText,
  type BoardCard,
  type BoardPin,
  type BoardView,
  type Spot,
  type Touch,
} from '../../domain/story';
import { THREAD_STATES, type Clock, type Thread, type ThreadState } from '../../domain/schema';
import { formatDayMonth } from '../../domain/time/calendar';
import { isNear } from '../../domain/weight';
import { openAttitude } from '../../shell/commands';
import { useFocus } from '../../shell/focus';
import {
  AttitudeBadge,
  Button,
  Checkbox,
  EmptyState,
  EntityPicker,
  IconButton,
  KindIcon,
  Select,
  cx,
  entityHref,
  toast,
} from '../../ui';
import { useBoard } from '../../ui/board';
import { ClockDialog } from '../kalender/ClockDialog';
import {
  moveThreads,
  newStory,
  pinToCard,
  placeOnBoard,
  setHintFound,
  setThreadOnBoard,
  setThreadState,
  storyFromClock,
  tidyBoard,
} from './actions';
import { ThreadDialog } from './Dialogs';
import { AttachDialog } from './LooseDialogs';
import { LooseDrawer, THREAD_DRAG } from './LooseDrawer';
import './faeden.css';

/** Mit etwas Abstand zueinander, wenn mehrere Fäden auf einmal aufs Brett gezogen werden. */
const DROP_STEP = 36;

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

type OpenDialog =
  | { type: 'thread'; thread: Thread | null; storyId: string | null }
  /** Die Uhr einer Geschichte – `before`: welche Uhren es beim Öffnen schon gab. */
  | { type: 'clock'; clock: Clock | null; storyId: string; before: ReadonlySet<string> }
  /** Lose Fäden an eine Geschichte hängen. */
  | { type: 'attach'; ids: string[] }
  | null;

export default function FaedenPage() {
  const db = useDb();
  const data = useData();
  const [view, setView] = useState<BoardView>('truth');
  /** Die gewählte Karte (`story:…`, `thread:…`) oder der gewählte Name (`node:…`). */
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const cards = useMemo(() => boardCards(data, view), [data, view]);
  // Auf dem Brett liegen die Geschichten – und die losen Fäden, die hingelegt wurden.
  const open = useMemo(() => cards.filter((card) => !card.closed && card.onBoard), [cards]);
  const links = useMemo(() => touches(open), [open]);
  const closed = cards.filter((card) => card.closed);
  /** Die losen Fäden – sie stehen in der Liste neben dem Brett. */
  const loose = useMemo(() => looseThreads(data, view, cards), [data, view, cards]);
  const twins = useMemo(() => threadTwins(data), [data]);
  const looseCount = loose.filter((row) => !row.resting).length;
  /** Uhren, die zu keiner Geschichte gehören – sie lassen sich zu einer machen. */
  const orphans = useMemo(() => looseClocks(data), [data]);
  const current = cards.find((card) => card.key === selected) ?? null;
  /** Der Seitenteil: die gewählte Karte – oder die Liste der losen Fäden. */
  const [side, setSide] = useState<'card' | 'loose'>(() => (loose.length ? 'loose' : 'card'));
  /** Der lose Faden, der in der Liste gleich im Bild stehen soll. */
  const [looseFocus, setLooseFocus] = useState<string | null>(null);
  /**
   * Wählt eine Karte. Ein loser Faden, der nicht auf dem Brett liegt, steht in der Liste – dort
   * wird er gezeigt.
   */
  const select = (key: string | null) => {
    const card = key ? cards.find((entry) => entry.key === key) : undefined;
    if (card && !card.story && !card.closed && !card.onBoard) {
      setLooseFocus(card.threads[0]!.id);
      setSide('loose');
      setSelected(null);
      return;
    }
    setSelected(key);
    if (key) setSide('card');
  };
  // Aus der Suche geöffnet: Die gesuchte Karte ist gleich gewählt.
  useFocus(['card'], (focus) => select(focus.key));

  // Die Pinnwand: frei verschieben, vergrößern, Karten und Namen ziehen.
  const frame = useRef<HTMLDivElement>(null);
  const wall = useBoard(frame);
  /** Was gerade gezogen wird – seine Stelle, bis es losgelassen wird. */
  const [moving, setMoving] = useState<{ key: string; x: number; y: number } | null>(null);
  const [, navigate] = useLocation();
  /** Eine neue Geschichte: Sie entsteht leer und wird auf ihrem Blatt geschrieben. */
  const write = (at?: Spot) => {
    const story = newStory(db);
    if (at) placeOnBoard(db, `story:${story.id}`, at.x, at.y);
    navigate(`/geschichte/${story.id}`);
  };
  const placed = data.state.board;
  const layout = useMemo(
    () =>
      boardLayout(
        cards,
        moving ? { ...placed, [moving.key]: { x: moving.x, y: moving.y } } : placed,
      ),
    [cards, placed, moving],
  );
  const pin = layout.pins.find((entry) => entry.key === selected) ?? null;
  const showAll = (least?: number) =>
    wall.fit(
      [
        ...Object.values(layout.cards).flatMap((at) => [
          at,
          { x: at.x, y: at.y + BOARD_CARD.height },
        ]),
        ...layout.pins,
      ],
      // Die Karten sind breit: Platz für eine halbe Karte am Rand.
      140,
      least,
    );
  // Beim Öffnen liegt das Brett im Bild – aber nie so klein, dass man nichts mehr lesen kann.
  useLayoutEffect(() => showAll(0.62), []);
  /** Eine Karte, die gerade aufs Brett kam: Sobald sie ausgelegt ist, rückt alles ins Bild. */
  const [arriving, setArriving] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!arriving || !layout.cards[arriving]) return;
    showAll();
    setArriving(null);
  }, [arriving, layout]);

  /** Was zum Gewählten gehört – alles andere tritt zurück. */
  const related = useMemo(() => {
    if (!selected) return null;
    const keys = new Set([selected]);
    for (const entry of layout.pins) {
      if (entry.key === selected) entry.cards.forEach((key) => keys.add(key));
      else if (entry.cards.includes(selected)) {
        keys.add(entry.key);
        // Karten, die über diesen Namen berührt werden, bleiben sichtbar.
        entry.cards.forEach((key) => keys.add(key));
      }
    }
    return keys;
  }, [selected, layout.pins]);

  const strings = layout.pins.flatMap((entry) =>
    entry.cards.flatMap((key) => {
      const card = layout.cards[key];
      if (!card) return [];
      const from = { x: card.x, y: card.y + 56 };
      // Ein Faden hängt leicht durch.
      const [mx, my] = [(from.x + entry.x) / 2, (from.y + entry.y) / 2 + 28];
      return [
        {
          key: `${key}|${entry.key}`,
          d: `M ${from.x} ${from.y} Q ${mx} ${my} ${entry.x} ${entry.y}`,
          shared: entry.cards.length > 1,
          active: selected === key || selected === entry.key,
        },
      ];
    }),
  );

  /** Die Geschichte, auf der ein gezogener loser Faden gerade liegt – dort würde er angehängt. */
  const [dropOn, setDropOn] = useState<string | null>(null);
  const truth = view === 'truth';
  /** Die Geschichte unter einer Stelle des Bretts (Mitte der Oberkante einer gezogenen Karte). */
  const storyUnder = (x: number, y: number, except: string): string | null =>
    open.find((card) => {
      const at = layout.cards[card.key];
      return (
        card.story !== null &&
        card.key !== except &&
        at !== undefined &&
        Math.abs(x - at.x) < BOARD_CARD.width / 2 &&
        y + 30 > at.y &&
        y + 30 < at.y + BOARD_CARD.height
      );
    })?.key ?? null;
  /**
   * Hängt lose Fäden an eine Geschichte – mit Meldung und Rückgängig. Vom Brett aus ist danach
   * die Geschichte gewählt; aus der Liste gezogen bleibt die Liste offen, für den nächsten.
   */
  const attach = (threadIds: readonly string[], storyKey: string, show: boolean) => {
    const story = data.stories[storyKey.slice('story:'.length)];
    const undo = story ? moveThreads(db, threadIds, story.id) : null;
    if (!story || !undo) return;
    const first = data.threads[threadIds[0]!];
    if (show) select(storyKey);
    toast({
      title: 'An die Geschichte gehängt',
      body:
        threadIds.length === 1
          ? `„${first?.title ?? ''}“ ist jetzt eine Frage von „${story.title}“.`
          : `${threadIds.length} Fäden sind jetzt Fragen von „${story.title}“.`,
      action: { label: 'Rückgängig', run: undo },
    });
  };
  /** Ziehen legt hin, ein Klick wählt. Ein loser Faden, auf eine Geschichte gezogen, hängt an ihr. */
  const grab = (key: string, at: Spot) => (event: PointerEvent) => {
    event.stopPropagation();
    const threadId = key.startsWith('thread:') ? key.slice('thread:'.length) : null;
    const thread = threadId ? data.threads[threadId] : undefined;
    const hangs = truth && thread !== undefined && isLooseThread(data, thread);
    const target = (dx: number, dy: number) =>
      hangs ? storyUnder(at.x + dx, at.y + dy, key) : null;
    wall.drag(event, {
      onMove: (dx, dy) => {
        setMoving({ key, x: at.x + dx, y: at.y + dy });
        setDropOn(target(dx, dy));
      },
      onEnd: (moved, dx, dy) => {
        setMoving(null);
        setDropOn(null);
        const story = moved ? target(dx, dy) : null;
        if (story && threadId) attach([threadId], story, true);
        else if (moved) placeOnBoard(db, key, at.x + dx, at.y + dy);
        else select(key === selected ? null : key);
      },
    });
  };
  /** Die Fäden, die gerade aus der Liste herübergezogen werden. */
  const dragged = (event: DragEvent): boolean => event.dataTransfer.types.includes(THREAD_DRAG);
  const cardUnder = (event: DragEvent): string | null => {
    const key = (event.target as HTMLElement).closest<HTMLElement>('[data-card]')?.dataset.card;
    return key?.startsWith('story:') ? key : null;
  };
  /** Aus der Liste aufs Brett: auf eine Geschichte = anhängen, sonst liegt er dort als Karte. */
  const drop = (event: DragEvent) => {
    if (!dragged(event)) return;
    event.preventDefault();
    setDropOn(null);
    let ids: string[] = [];
    try {
      ids = (JSON.parse(event.dataTransfer.getData(THREAD_DRAG)) as string[]).filter(
        (id) => data.threads[id] !== undefined,
      );
    } catch {
      return;
    }
    if (!ids.length) return;
    const story = cardUnder(event);
    if (story) return attach(ids, story, false);
    const at = wall.toBoard(event.clientX, event.clientY);
    const undos = db.batch(() =>
      ids.map((id, index) =>
        setThreadOnBoard(db, id, true, {
          x: at.x + index * DROP_STEP,
          y: at.y + index * DROP_STEP,
        }),
      ),
    );
    toast({
      title: ids.length === 1 ? 'Aufs Brett gelegt' : `${ids.length} Fäden aufs Brett gelegt`,
      body: 'Als Karte – von dort lässt er sich weiter auf eine Geschichte ziehen.',
      action: {
        label: 'Rückgängig',
        run: () => db.batch(() => [...undos].reverse().forEach((undo) => undo?.())),
      },
    });
  };
  const tidy = () => {
    const undo = tidyBoard(db);
    requestAnimationFrame(() => showAll());
    toast({
      title: 'Brett aufgeräumt',
      body: 'Wayfarer hat alles neu ausgelegt.',
      action: { label: 'Rückgängig', run: undo },
    });
  };
  const isEmpty = cards.length === 0;

  return (
    <div className="wf-page wf-faden">
      <header className="wf-page__head wf-faden-head">
        <h1 className="wf-page__title">Fadenbrett</h1>
        <span className="wf-faden-head__sub">
          {count(open.filter((card) => card.story).length, 'Geschichte', 'Geschichten')} ·{' '}
          {count(looseCount, 'loser Faden', 'lose Fäden')}
        </span>
        <span className="wf-grow" />
        <div className="wf-btn-group" role="group" aria-label="Sicht">
          <Button
            icon={<Eye />}
            aria-pressed={view === 'truth'}
            title="Alles, was du weißt"
            onClick={() => setView('truth')}
          >
            Wahrheit
          </Button>
          <Button
            icon={<EyeOff />}
            aria-pressed={view === 'party'}
            title="Nur die Fäden, die die Gruppe kennt, und die Hinweise, die sie hat"
            onClick={() => setView('party')}
          >
            Was die Gruppe weiß
          </Button>
        </div>
        <Button
          icon={<Plus />}
          onClick={() => setDialog({ type: 'thread', thread: null, storyId: null })}
        >
          Faden
        </Button>
        <Button
          variant="primary"
          icon={<Plus />}
          onClick={() => write()}
          title="Eine neue Geschichte schreiben"
        >
          Geschichte
        </Button>
      </header>

      {isEmpty ? (
        <div className="wf-faden-blank">
          <EmptyState
            icon={<Waypoints aria-hidden />}
            title={
              view === 'party' ? 'Die Gruppe kennt noch keinen Faden' : 'Noch keine Geschichte'
            }
          >
            {view === 'party'
              ? 'Sobald die Gruppe einen Faden kennt oder einen Hinweis findet, steht er hier.'
              : 'Eine Geschichte ist ein Vorhaben: Jemand will etwas, und eine Uhr sagt, was geschieht, wenn niemand eingreift. Ein Faden ist eine Frage oder Spur, der die Gruppe folgen kann. Du schreibst beides – auf dem Brett verbinden Fäden jede Geschichte mit den Personen und Orten, an denen sie hängt.'}
          </EmptyState>
        </div>
      ) : (
        <div className="wf-faden-body" data-side={side}>
          <div
            ref={frame}
            className="wf-faden-wall"
            onPointerDown={(event) => wall.pan(event, () => setSelected(null))}
            onDoubleClick={(event) => {
              // Die Karte liegt später dort, wo geklickt wurde.
              if (view === 'truth') write(wall.toBoard(event.clientX, event.clientY));
            }}
            onDragOver={(event) => {
              if (!truth || !dragged(event)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDropOn(cardUnder(event));
            }}
            onDragLeave={() => setDropOn(null)}
            onDrop={drop}
          >
            <div className="wf-faden-layer" style={{ transform: wall.transform }}>
              <svg className="wf-faden-strings" aria-hidden>
                {strings.map((line) => (
                  <path
                    key={line.key}
                    d={line.d}
                    data-shared={line.shared}
                    data-active={line.active}
                    data-dim={selected !== null && !line.active}
                  />
                ))}
              </svg>
              {layout.pins.map((entry) => {
                const entity = data.entities[entry.id];
                if (!entity) return null;
                return (
                  <button
                    key={entry.key}
                    type="button"
                    className="wf-faden-pin"
                    style={{ left: entry.x, top: entry.y }}
                    data-shared={entry.cards.length > 1}
                    data-dim={related !== null && !related.has(entry.key)}
                    aria-pressed={entry.key === selected}
                    title={
                      entry.cards.length > 1
                        ? `${entity.name} – hier berühren sich ${entry.cards.length} Karten`
                        : entity.name
                    }
                    onPointerDown={grab(entry.key, entry)}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    <KindIcon kind={entity.kind} />
                    <span className="wf-clamp-1">{entity.name}</span>
                  </button>
                );
              })}
              {open.map((card) => (
                <Card
                  key={card.key}
                  card={card}
                  at={layout.cards[card.key]!}
                  selected={card.key === selected}
                  dim={related !== null && !related.has(card.key)}
                  drop={card.key === dropOn}
                  lifted={card.key === moving?.key}
                  onGrab={grab(card.key, layout.cards[card.key]!)}
                />
              ))}
            </div>
            {open.length === 0 && (
              <p className="wf-faden-wall__none">
                {truth
                  ? 'Noch liegt nichts auf dem Brett. Eine Geschichte entsteht mit einem Doppelklick – oder aus losen Fäden der Liste.'
                  : 'Von dem, was auf dem Brett liegt, kennt die Gruppe noch nichts.'}
              </p>
            )}
            <div className="wf-faden-tools" onPointerDown={(event) => event.stopPropagation()}>
              <IconButton label="Größer" size="sm" onClick={() => wall.zoom(1.25)}>
                <Plus />
              </IconButton>
              <IconButton label="Kleiner" size="sm" onClick={() => wall.zoom(0.8)}>
                <Minus />
              </IconButton>
              <IconButton label="Alles zeigen" size="sm" onClick={() => showAll()}>
                <Maximize />
              </IconButton>
              <IconButton
                label="Aufräumen – Wayfarer legt alles neu aus"
                size="sm"
                disabled={Object.keys(placed).length === 0}
                onClick={tidy}
              >
                <LayoutGrid />
              </IconButton>
            </div>
            <div
              className="wf-faden-shelf"
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {view === 'truth' && orphans.length > 0 && (
                <details className="wf-faden-closed">
                  <summary title="Uhren aus der Zeit, als sie im Kalender angelegt wurden">
                    Uhren ohne Geschichte · {orphans.length}
                  </summary>
                  {orphans.map((clock) => (
                    <button
                      key={clock.id}
                      type="button"
                      className="wf-faden-closed__row"
                      title="Eine Geschichte daraus machen und ihr Blatt öffnen"
                      onClick={() => {
                        const story = storyFromClock(db, clock.id);
                        if (story) navigate(`/geschichte/${story.id}`);
                      }}
                    >
                      {clock.title}
                      <span>Geschichte daraus machen</span>
                    </button>
                  ))}
                </details>
              )}
              {closed.length > 0 && (
                <details className="wf-faden-closed">
                  <summary>Abgeschlossen · {closed.length}</summary>
                  {closed.map((card) => (
                    <button
                      key={card.key}
                      type="button"
                      className="wf-faden-closed__row"
                      onClick={() => select(card.key)}
                    >
                      {card.title}
                      <span>
                        {card.story ? 'Geschichte' : THREAD_STATE_LABEL[card.threads[0]!.state]}
                      </span>
                    </button>
                  ))}
                </details>
              )}
            </div>
          </div>
          <div className="wf-faden-sidecol">
            <div className="wf-btn-group wf-faden-sidetabs" role="group" aria-label="Seitenteil">
              <Button
                size="sm"
                aria-pressed={side === 'card'}
                title="Alles zur gewählten Karte des Bretts"
                onClick={() => setSide('card')}
              >
                Gewählte Karte
              </Button>
              <Button
                size="sm"
                aria-pressed={side === 'loose'}
                title="Fäden, die zu keiner Geschichte gehören – zum Aufräumen und Verbinden"
                onClick={() => setSide('loose')}
              >
                Lose Fäden · {looseCount}
              </Button>
            </div>
            {side === 'loose' ? (
              <LooseDrawer
                rows={loose}
                twins={twins}
                view={view}
                focusId={looseFocus}
                onEdit={(thread) => setDialog({ type: 'thread', thread, storyId: thread.storyId })}
                onShow={setArriving}
              />
            ) : pin ? (
              <PinSide pin={pin} cards={cards} onSelect={select} />
            ) : (
              <Side
                card={current}
                view={view}
                links={links}
                cards={cards}
                onSelect={select}
                onEdit={setDialog}
              />
            )}
          </div>
        </div>
      )}

      {dialog?.type === 'thread' && (
        <ThreadDialog
          thread={dialog.thread}
          storyId={dialog.storyId}
          onClose={() => setDialog(null)}
          onSaved={(thread) => {
            setDialog(null);
            // Ein loser Faden steht in der Liste – dort wird er gezeigt, wenn er nicht auf dem
            // Brett liegt.
            if (thread.storyId) select(`story:${thread.storyId}`);
            else if (thread.inPlay || thread.onBoard) select(`thread:${thread.id}`);
            else {
              setLooseFocus(thread.id);
              setSide('loose');
            }
          }}
        />
      )}
      {dialog?.type === 'attach' && (
        <AttachDialog
          ids={dialog.ids}
          onClose={() => setDialog(null)}
          onDone={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'clock' && (
        <ClockDialog
          key={dialog.clock?.id ?? 'neu'}
          clock={dialog.clock}
          onClose={() => {
            // Eine Uhr, die in diesem Fenster entstanden ist, gehört zur Geschichte.
            const now = db.getSnapshot();
            const fresh = Object.keys(now.clocks).filter((id) => !dialog.before.has(id));
            if (fresh.length === 1 && now.stories[dialog.storyId])
              db.patch('stories', dialog.storyId, { clockId: fresh[0]! });
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

/** Eine Karte auf dem Brett: das Wichtigste auf einen Blick – alles Weitere steht im Seitenteil. */
function Card({
  card,
  at,
  selected,
  dim,
  drop,
  lifted,
  onGrab,
}: {
  card: BoardCard;
  at: Spot;
  selected: boolean;
  dim: boolean;
  /** Ein loser Faden wird gerade auf diese Geschichte gezogen. */
  drop: boolean;
  /** Die Karte wird gerade gezogen: Sie liegt über allen anderen. */
  lifted: boolean;
  onGrab: (event: PointerEvent) => void;
}) {
  const data = useData();
  const now = data.state.now;
  const owner = card.story?.ownerId ? data.entities[card.story.ownerId] : undefined;
  const repute = owner ? reputeOf(data, owner.id).party : null;
  const lone = card.story ? null : card.threads[0]!;
  const live = card.threads.filter(threadLive);
  const warnings = card.threads.filter((thread) => threadWarning(thread)).length;
  const found = lone ? lone.hints.filter((hint) => hint.found).length : 0;
  return (
    <button
      type="button"
      className={cx('wf-faden-card', !card.story && 'wf-faden-card--thread')}
      style={{ left: at.x, top: at.y }}
      data-card={card.key}
      data-near={card.nearness}
      data-dim={dim}
      data-drop={drop}
      data-lifted={lifted}
      aria-pressed={selected}
      onPointerDown={onGrab}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="wf-faden-card__top">
        <span className="wf-faden-card__sort">
          {card.story ? 'Geschichte' : 'Loser Faden'} · {NEARNESS_LABEL[card.nearness]}
        </span>
        {card.story ? (
          card.pace !== 'none' && (
            <span className={`wf-faden-pace wf-faden-pace--${card.pace}`}>
              {PACE_LABEL[card.pace]}
            </span>
          )
        ) : (
          <span className={`wf-faden-state wf-faden-state--${lone!.state}`}>
            {THREAD_STATE_LABEL[lone!.state]}
          </span>
        )}
      </span>
      <span className="wf-faden-card__title wf-clamp-2">{card.title}</span>
      {card.partOf && (
        <span className="wf-faden-card__part wf-clamp-1">Teil von {card.partOf.title}</span>
      )}
      {owner && (
        <span className="wf-faden-card__owner">
          <span className="wf-clamp-1">Treibt an: {owner.name}</span>
          {repute !== null && (
            <span className="wf-faden-card__repute" title={`Ruf der Gruppe bei ${owner.name}`}>
              <AttitudeBadge value={repute} />
            </span>
          )}
        </span>
      )}
      {card.clock && (
        <span className="wf-faden-clock">
          <span className="wf-faden-clock__pips" aria-hidden>
            {card.clock.steps.map((step) => (
              <i key={step.step.id} data-state={step.state} />
            ))}
          </span>
          <span className="wf-faden-clock__next wf-clamp-2">
            {card.clock.next
              ? `${card.clock.paused ? 'Angehalten vor' : upper(untilText(card.clock.next.at - now))}: ${card.clock.next.step.text}`
              : 'Alles ist geschehen.'}
          </span>
        </span>
      )}
      {card.story && live.length > 0 && (
        <span className="wf-faden-card__owner">
          {live.length === 1 ? '1 Faden' : `${live.length} Fäden`}
          {warnings > 0 && (
            <>
              <TriangleAlert aria-hidden />
              {warnings === 1 ? '1 Warnung' : `${warnings} Warnungen`}
            </>
          )}
        </span>
      )}
      {lone && lone.hints.length > 0 && (
        <span className="wf-faden-card__owner">
          {found} von {lone.hints.length} Hinweisen gefunden
          {threadWarning(lone) && <TriangleAlert aria-label="Warnung" />}
        </span>
      )}
    </button>
  );
}

/** Der Seitenteil zu einem Namen auf dem Brett: wer das ist und welche Karten an ihm hängen. */
function PinSide({
  pin,
  cards,
  onSelect,
}: {
  pin: BoardPin;
  cards: BoardCard[];
  onSelect: (key: string) => void;
}) {
  const data = useData();
  const [, navigate] = useLocation();
  const entity = data.entities[pin.id];
  if (!entity) return null;
  const hanging = pin.cards
    .map((key) => cards.find((card) => card.key === key))
    .filter((card): card is BoardCard => !!card);
  return (
    <aside className="wf-faden-side">
      <div className="wf-faden-side__head">
        <span className="wf-faden-card__sort">
          {hanging.length > 1 ? 'Hier berühren sich Geschichten' : 'Hängt an einer Karte'}
        </span>
        <Button size="sm" onClick={() => navigate(entityHref(entity))}>
          Seite öffnen
        </Button>
      </div>
      <h2 className="wf-faden-side__title">{entity.name}</h2>
      {entity.tagline && <p className="wf-prose">{entity.tagline}</p>}
      <section>
        <h3 className="wf-faden-side__sub">Karten an diesem Namen</h3>
        {hanging.map((card) => (
          <button
            key={card.key}
            type="button"
            className="wf-faden-touchrow"
            onClick={() => onSelect(card.key)}
          >
            <span>{card.title}</span>
            <em>{card.story ? 'Geschichte' : 'Loser Faden'}</em>
          </button>
        ))}
      </section>
      <p className="wf-mute">
        Du kannst den Namen frei legen – er bleibt dort. „Aufräumen“ unten rechts legt alles neu
        aus.
      </p>
    </aside>
  );
}

/** Der Seitenteil: alles zur gewählten Karte – Uhr, Fäden mit Hinweisen, Einstiege, Berührungen. */
function Side({
  card,
  view,
  links,
  cards,
  onSelect,
  onEdit,
}: {
  card: BoardCard | null;
  view: BoardView;
  links: Touch[];
  cards: BoardCard[];
  onSelect: (key: string) => void;
  onEdit: (dialog: OpenDialog) => void;
}) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const cal = data.campaign.calendar;
  const truth = view === 'truth';

  if (!card)
    return (
      <aside className="wf-faden-side wf-faden-side--blank">
        <p>
          Wähle eine Karte: Dann stehen hier ihre Uhr, ihre Fäden mit den Hinweisen, ihre Einstiege
          und was sie berührt.
        </p>
        <p className="wf-mute">
          Fäden verbinden jede Karte mit den Personen, Orten und Fraktionen, an denen sie hängt.
          Hängen zwei Karten am selben Namen, berühren sich ihre Geschichten – der Name ist dann
          golden.
        </p>
        <p className="wf-mute">
          Karten und Namen legst du frei: einfach ziehen. Das Brett selbst ziehst du am leeren
          Grund, das Mausrad vergrößert, ein Doppelklick legt eine neue Geschichte an.
        </p>
        <p className="wf-mute">
          Fäden ohne Geschichte stehen unter „Lose Fäden“ – von dort hängst du sie an eine
          Geschichte oder legst sie aufs Brett.
        </p>
      </aside>
    );

  const story = card.story;
  /** Der lose Faden dieser Karte – wie er gespeichert ist. */
  const lone = story ? null : (data.threads[card.threads[0]?.id ?? ''] ?? null);
  const owner = story?.ownerId ? data.entities[story.ownerId] : undefined;
  const repute = owner ? reputeOf(data, owner.id) : { party: null, members: [] };
  const link = (id: string | null | undefined) => {
    const entity = id ? data.entities[id] : undefined;
    return entity ? (
      <button type="button" className="wf-faden-link" onClick={() => navigate(entityHref(entity))}>
        {entity.name}
      </button>
    ) : null;
  };
  const touching = links
    .filter((entry) => entry.a === card.key || entry.b === card.key)
    .map((entry) => ({
      entry,
      other: cards.find((other) => other.key === (entry.a === card.key ? entry.b : entry.a)),
    }))
    .filter((row) => row.other);

  return (
    <aside className="wf-faden-side">
      <div className="wf-faden-side__head">
        <span className="wf-faden-card__sort">
          {story ? 'Geschichte' : 'Loser Faden'} · {NEARNESS_LABEL[card.nearness]}
        </span>
        {truth && story && (
          <Button
            size="sm"
            icon={<Pencil />}
            onClick={() => navigate(`/geschichte/${story.id}`)}
            title="Die Geschichte auf ihrem Blatt schreiben"
          >
            Schreiben
          </Button>
        )}
      </div>
      <h2 className="wf-faden-side__title">{card.title}</h2>
      {story?.summary && truth && <p className="wf-prose">{story.summary}</p>}
      {owner && (
        <p>
          <span className="wf-mute">Treibt an:</span> {link(owner.id)}
        </p>
      )}
      {!truth && (
        <p className="wf-faden-side__note">
          Sicht der Gruppe: nur, was sie kennt. Zum Ändern auf „Wahrheit“ wechseln.
        </p>
      )}
      {truth && lone && (
        <div className="wf-faden-side__acts">
          <Button
            size="sm"
            icon={<Link2 />}
            title="Als Frage, Hinweis oder Einstieg – oder zieh die Karte auf eine Geschichte"
            onClick={() => onEdit({ type: 'attach', ids: [lone.id] })}
          >
            An Geschichte hängen …
          </Button>
          {card.onBoard && !card.closed && (
            <Button
              size="sm"
              variant="ghost"
              disabled={lone.inPlay}
              title={
                lone.inPlay
                  ? 'Er liegt auf dem Brett, solange er im Spiel ist.'
                  : 'Er steht dann nur noch in der Liste „Lose Fäden“.'
              }
              onClick={() => {
                const undo = setThreadOnBoard(db, lone.id, false);
                if (undo)
                  toast({
                    title: 'Vom Brett genommen',
                    body: `„${lone.title}“ steht nur noch in der Liste „Lose Fäden“.`,
                    action: { label: 'Rückgängig', run: undo },
                  });
              }}
            >
              Vom Brett nehmen
            </Button>
          )}
        </div>
      )}

      {truth && story && !card.clock && (
        <section>
          <h3 className="wf-faden-side__sub">
            Wenn niemand eingreift
            <Button
              size="sm"
              icon={<Plus />}
              onClick={() =>
                onEdit({
                  type: 'clock',
                  clock: null,
                  storyId: story.id,
                  before: new Set(Object.keys(data.clocks)),
                })
              }
            >
              Uhr
            </Button>
          </h3>
          <p className="wf-mute">
            Noch keine Uhr. Sie sagt Schritt für Schritt, was geschieht, wenn die Gruppe nichts tut.
          </p>
        </section>
      )}
      {card.clock && (
        <section>
          <h3 className="wf-faden-side__sub">
            Wenn niemand eingreift
            <span className={`wf-faden-pace wf-faden-pace--${card.pace}`}>
              {PACE_LABEL[card.pace]}
            </span>
            {truth && story && (
              <Button
                size="sm"
                icon={<Pencil />}
                onClick={() =>
                  onEdit({
                    type: 'clock',
                    clock: card.clock!.clock,
                    storyId: story.id,
                    before: new Set(Object.keys(data.clocks)),
                  })
                }
              >
                Uhr
              </Button>
            )}
          </h3>
          <ol className="wf-faden-steps">
            {card.clock.steps.map((step) => (
              <li key={step.step.id} data-state={step.state}>
                <i aria-hidden />
                <span>{step.step.text}</span>
                <em>
                  {step.state === 'prevented'
                    ? 'verhindert'
                    : step.state === 'done'
                      ? formatDayMonth(cal, step.at)
                      : card.clock!.paused
                        ? 'angehalten'
                        : formatDayMonth(cal, step.at)}
                </em>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section>
        <h3 className="wf-faden-side__sub">
          {story ? 'Fäden' : 'Der Faden'}
          {truth && story && (
            <Button
              size="sm"
              icon={<Plus />}
              onClick={() => onEdit({ type: 'thread', thread: null, storyId: story.id })}
            >
              Faden
            </Button>
          )}
        </h3>
        {card.threads.length === 0 && (
          <p className="wf-mute">
            Noch kein Faden. Ein Faden ist eine Frage, die diese Geschichte stellt.
          </p>
        )}
        {card.threads.map((thread) => {
          const warning = truth ? threadWarning(thread) : null;
          const stored = data.threads[thread.id] ?? thread;
          return (
            <div key={thread.id} className={`wf-faden-block wf-faden-thread--${thread.state}`}>
              <div className="wf-faden-block__head">
                <i aria-hidden />
                <span className="wf-faden-block__title">{thread.title}</span>
                {truth && (
                  <button
                    type="button"
                    className="wf-faden-link"
                    onClick={() =>
                      onEdit({ type: 'thread', thread: stored, storyId: stored.storyId })
                    }
                  >
                    Ändern
                  </button>
                )}
              </div>
              <div className="wf-faden-block__meta">
                {truth ? (
                  <Select
                    value={thread.state}
                    aria-label="Zustand des Fadens"
                    onChange={(event) =>
                      setThreadState(db, thread.id, event.target.value as ThreadState)
                    }
                  >
                    {THREAD_STATES.map((state) => (
                      <option key={state} value={state}>
                        {THREAD_STATE_LABEL[state]}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span>{THREAD_STATE_LABEL[thread.state]}</span>
                )}
                {truth && !thread.known && <span>Die Gruppe kennt ihn nicht</span>}
              </div>
              {thread.truth && <p className="wf-faden-block__truth">{thread.truth}</p>}
              {warning && (
                <p className="wf-faden-block__warn">
                  <TriangleAlert aria-hidden /> {warning}
                </p>
              )}
              {thread.hints.map((hint) => (
                <div key={hint.id} className="wf-faden-hint" data-found={hint.found}>
                  {truth ? (
                    <Checkbox
                      checked={hint.found}
                      onChange={(found) => setHintFound(db, thread.id, hint.id, found)}
                    >
                      {hint.text}
                    </Checkbox>
                  ) : (
                    <span>{hint.text}</span>
                  )}
                  {(hint.placeId || hint.sourceId) && (
                    <span className="wf-faden-hint__where">
                      {hint.placeId && <>in {link(hint.placeId)}</>}
                      {hint.placeId && hint.sourceId && ' · '}
                      {hint.sourceId && <>weiß {link(hint.sourceId)}</>}
                      {hint.placeId && isNear(data, hint.placeId) && !hint.found && (
                        <b> – liegt hier bereit</b>
                      )}
                    </span>
                  )}
                </div>
              ))}
              {truth && thread.hints.length === 0 && threadLive(thread) && !warning && (
                <p className="wf-mute">Noch keine Hinweise eingetragen.</p>
              )}
            </div>
          );
        })}
      </section>

      {truth && owner && (
        <section>
          <h3 className="wf-faden-side__sub">
            Ruf · {owner.name}
            <Button size="sm" onClick={() => openAttitude({ fromId: owner.id })}>
              {repute.party === null ? 'Festlegen' : 'Ändern'}
            </Button>
          </h3>
          <div className="wf-faden-repute">
            <span>Die Gruppe</span>
            {repute.party === null ? (
              <em>noch nicht festgelegt</em>
            ) : (
              <AttitudeBadge value={repute.party} />
            )}
          </div>
          {repute.members.map((member) => (
            <div key={member.id} className="wf-faden-repute">
              <span>{member.name}</span>
              <AttitudeBadge value={member.value} />
            </div>
          ))}
          <p className="wf-mute">
            Der Ruf ändert nicht die Geschichte – nur, wie die Gruppe hineinkommt.
          </p>
        </section>
      )}

      {truth && story && story.entries.length > 0 && (
        <section>
          <h3 className="wf-faden-side__sub">Einstiege</h3>
          {story.entries.map((entry) => {
            const fit = entryFit(data, story, entry);
            return (
              <div key={entry.id} className="wf-faden-hint" data-found={!fit.fits}>
                <span>{entry.text}</span>
                <span className="wf-faden-hint__where wf-faden-hint__where--flat">
                  {entry.placeId && <>in {link(entry.placeId)}</>}
                  {entry.placeId && isNear(data, entry.placeId) && <b> – die Gruppe ist hier</b>}
                  {entry.standing !== 'any' && (
                    <>
                      {entry.placeId && ' · '}
                      {ENTRY_STANDING_LABEL[entry.standing]}: {fit.note}
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </section>
      )}

      {touching.length > 0 && (
        <section>
          <h3 className="wf-faden-side__sub">Berührt</h3>
          {touching.map(({ entry, other }) => (
            <button
              key={other!.key}
              type="button"
              className="wf-faden-touchrow"
              onClick={() => onSelect(other!.key)}
            >
              <span>{other!.title}</span>
              <em>{touchReason(data, entry)}</em>
            </button>
          ))}
        </section>
      )}

      {(card.nodes.length > 0 || truth) && (
        <section>
          <h3 className="wf-faden-side__sub">Hängt an</h3>
          <div className="wf-faden-card__nodes">
            {card.nodes.map((id) => (
              <span key={id} className="wf-faden-node">
                {link(id)}
              </span>
            ))}
          </div>
          {truth && (
            <EntityPicker
              value={null}
              onChange={(id) => {
                if (id) pinToCard(db, card.key, id);
              }}
              kinds={['person', 'place', 'faction', 'family', 'item']}
              exclude={card.nodes}
              placeholder="Person, Ort oder Fraktion anheften …"
              create={{ storyId: card.story?.id ?? null }}
            />
          )}
        </section>
      )}
    </aside>
  );
}
