/**
 * Das Fadenbrett: eine Pinnwand. Geschichten und lose Fäden liegen als Karten darauf, daneben die
 * Personen, Orte und Fraktionen, an denen sie hängen – verbunden durch Fäden. Wo zwei Karten am
 * selben Namen hängen, berühren sich ihre Geschichten. Alles lässt sich frei legen; was der
 * Spielleiter nicht hingelegt hat, legt Wayfarer aus. Die Rechnung steht in `domain/story.ts`.
 */
import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useLocation } from 'wouter';
import {
  Eye,
  EyeOff,
  LayoutGrid,
  Maximize,
  Minus,
  Pencil,
  Plus,
  TriangleAlert,
  Waypoints,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  BOARD_CARD,
  ENTRY_STANDING_LABEL,
  NEARNESS_LABEL,
  PACE_LABEL,
  THREAD_STATE_LABEL,
  boardCards,
  boardLayout,
  entryFit,
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
  newStory,
  pinToCard,
  placeOnBoard,
  setHintFound,
  setThreadState,
  storyFromClock,
  tidyBoard,
} from './actions';
import { ThreadDialog } from './Dialogs';
import './faeden.css';

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

type OpenDialog =
  | { type: 'thread'; thread: Thread | null; storyId: string | null }
  /** Die Uhr einer Geschichte – `before`: welche Uhren es beim Öffnen schon gab. */
  | { type: 'clock'; clock: Clock | null; storyId: string; before: ReadonlySet<string> }
  | null;

export default function FaedenPage() {
  const db = useDb();
  const data = useData();
  const [view, setView] = useState<BoardView>('truth');
  /** Die gewählte Karte (`story:…`, `thread:…`) oder der gewählte Name (`node:…`). */
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  // Aus der Suche geöffnet: Die gesuchte Karte ist gleich gewählt.
  useFocus(['card'], (focus) => setSelected(focus.key));

  const cards = useMemo(() => boardCards(data, view), [data, view]);
  const links = useMemo(() => touches(cards), [cards]);
  // Auf dem Brett liegen die Geschichten – und die losen Fäden, die hingelegt wurden.
  const open = cards.filter((card) => !card.closed && card.onBoard);
  const closed = cards.filter((card) => card.closed);
  /** Uhren, die zu keiner Geschichte gehören – sie lassen sich zu einer machen. */
  const orphans = useMemo(() => looseClocks(data), [data]);
  const current = cards.find((card) => card.key === selected) ?? null;

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

  /** Ziehen legt hin, ein Klick wählt. */
  const grab = (key: string, at: Spot) => (event: PointerEvent) => {
    event.stopPropagation();
    wall.drag(event, {
      onMove: (dx, dy) => setMoving({ key, x: at.x + dx, y: at.y + dy }),
      onEnd: (moved, dx, dy) => {
        setMoving(null);
        if (moved) placeOnBoard(db, key, at.x + dx, at.y + dy);
        else setSelected(key === selected ? null : key);
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
          {open.filter((card) => card.story).length} Geschichten ·{' '}
          {open.reduce((sum, card) => sum + card.threads.filter(threadLive).length, 0)} Fäden
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
        <div className="wf-faden-body">
          <div
            ref={frame}
            className="wf-faden-wall"
            onPointerDown={(event) => wall.pan(event, () => setSelected(null))}
            onDoubleClick={(event) => {
              // Die Karte liegt später dort, wo geklickt wurde.
              if (view === 'truth') write(wall.toBoard(event.clientX, event.clientY));
            }}
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
                  onGrab={grab(card.key, layout.cards[card.key]!)}
                />
              ))}
            </div>
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
                      onClick={() => setSelected(card.key)}
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
          {pin ? (
            <PinSide pin={pin} cards={cards} onSelect={setSelected} />
          ) : (
            <Side
              card={current}
              view={view}
              links={links}
              cards={cards}
              onSelect={setSelected}
              onEdit={setDialog}
            />
          )}
        </div>
      )}

      {dialog?.type === 'thread' && (
        <ThreadDialog
          thread={dialog.thread}
          storyId={dialog.storyId}
          onClose={() => setDialog(null)}
          onSaved={(thread) => {
            setDialog(null);
            setSelected(thread.storyId ? `story:${thread.storyId}` : `thread:${thread.id}`);
          }}
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
  onGrab,
}: {
  card: BoardCard;
  at: Spot;
  selected: boolean;
  dim: boolean;
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
      data-near={card.nearness}
      data-dim={dim}
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
      </aside>
    );

  const story = card.story;
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
