/**
 * Das Fadenbrett: alle Geschichten nebeneinander – geordnet danach, wie nah die Gruppe ihnen ist
 * (Hier · Erreichbar · Fern), mit dem Stand ihrer Uhr, ihren Fäden und goldenen Linien, wo zwei
 * sich berühren. Die Rechnung steht in `domain/story.ts`.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Eye, EyeOff, Pencil, Plus, TriangleAlert, Waypoints } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  ENTRY_STANDING_LABEL,
  NEARNESS_LABEL,
  PACE_LABEL,
  THREAD_STATE_LABEL,
  boardCards,
  entryFit,
  reputeOf,
  threadLive,
  threadWarning,
  touchReason,
  touches,
  untilText,
  type BoardCard,
  type BoardView,
  type Nearness,
  type Touch,
} from '../../domain/story';
import { THREAD_STATES, type Story, type Thread, type ThreadState } from '../../domain/schema';
import { formatDayMonth } from '../../domain/time/calendar';
import { isNear } from '../../domain/weight';
import { openAttitude } from '../../shell/commands';
import { AttitudeBadge, Button, Checkbox, EmptyState, Select, cx, entityHref } from '../../ui';
import { setHintFound, setThreadState } from './actions';
import { StoryDialog, ThreadDialog } from './Dialogs';
import './faeden.css';

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const COLUMNS: Nearness[] = ['here', 'reachable', 'far'];
const COLUMN_HINT: Record<Nearness, string> = {
  here: 'Hängt an dem Ort, an dem die Gruppe gerade ist.',
  reachable: 'Ein bekannter Weg führt hin, oder es liegt in derselben Gegend.',
  far: 'Weit weg – oder noch an keinem Ort festgemacht.',
};

type OpenDialog =
  | { type: 'story'; story: Story | null }
  | { type: 'thread'; thread: Thread | null; storyId: string | null }
  | null;

interface Line {
  key: string;
  d: string;
  x: number;
  y: number;
  label: string;
  active: boolean;
}

export default function FaedenPage() {
  const data = useData();
  const [view, setView] = useState<BoardView>('truth');
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);

  const cards = useMemo(() => boardCards(data, view), [data, view]);
  const links = useMemo(() => touches(cards), [cards]);
  const open = cards.filter((card) => !card.closed);
  const closed = cards.filter((card) => card.closed);
  const current = cards.find((card) => card.key === selected) ?? null;
  /** Knoten, über die sich zwei Karten berühren. */
  const shared = useMemo(() => new Set(links.flatMap((link) => link.via)), [links]);

  // Die goldenen Linien: von Karte zu Karte, gemessen an dem, was wirklich auf dem Brett liegt.
  const board = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = useState<Line[]>([]);
  const [measure, setMeasure] = useState(0);
  useEffect(() => {
    const element = board.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setMeasure((count) => count + 1));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = board.current;
    if (!element) return;
    const frame = element.getBoundingClientRect();
    // Mehrere Linien an einer Karte setzen untereinander an, nicht alle an derselben Stelle.
    const used = new Map<string, number>();
    const box = (key: string) => {
      const rect = elements.current.get(key)?.getBoundingClientRect();
      if (!rect) return null;
      const count = used.get(key) ?? 0;
      used.set(key, count + 1);
      return {
        left: rect.left - frame.left,
        right: rect.right - frame.left,
        mid: rect.top - frame.top + Math.min(rect.height - 14, 30 + count * 26),
      };
    };
    const next: Line[] = [];
    for (const link of links) {
      const [a, b] = [box(link.a), box(link.b)];
      if (!a || !b) continue;
      const [first, second] = a.left <= b.left ? [a, b] : [b, a];
      const same = Math.abs(a.left - b.left) < 4;
      // Im selben Stapel läuft die Linie rechts außen herum, sonst von Rand zu Rand.
      const [x1, x2] = same ? [first.right, second.right] : [first.right, second.left];
      const bend = same ? 34 : Math.max(24, (x2 - x1) / 2);
      const d = same
        ? `M ${x1} ${first.mid} C ${x1 + bend} ${first.mid}, ${x2 + bend} ${second.mid}, ${x2} ${second.mid}`
        : `M ${x1} ${first.mid} C ${x1 + bend} ${first.mid}, ${x2 - bend} ${second.mid}, ${x2} ${second.mid}`;
      next.push({
        key: `${link.a}|${link.b}`,
        d,
        x: same ? x1 + bend * 0.75 : (x1 + x2) / 2,
        y: (first.mid + second.mid) / 2,
        label: touchReason(data, link),
        active: selected === link.a || selected === link.b,
      });
    }
    setLines(next);
  }, [links, data, selected, measure, view]);

  const column = (near: Nearness) => open.filter((card) => card.nearness === near);
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
          onClick={() => setDialog({ type: 'story', story: null })}
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
              : 'Eine Geschichte ist ein Vorhaben: Jemand will etwas, und eine Uhr sagt, was geschieht, wenn niemand eingreift. Ein Faden ist eine Frage oder Spur, der die Gruppe folgen kann. Du schreibst beides – Wayfarer zeigt, wie nah die Gruppe dran ist und wo sich Geschichten berühren.'}
          </EmptyState>
        </div>
      ) : (
        <div className="wf-faden-body">
          <div className="wf-faden-scroll">
            <div
              className="wf-faden-board"
              ref={board}
              style={{
                // Ein leerer Stapel braucht wenig Platz.
                gridTemplateColumns: COLUMNS.map((near) =>
                  column(near).length ? 'minmax(0, 1fr)' : 'minmax(0, 0.42fr)',
                ).join(' '),
              }}
            >
              <svg className="wf-faden-lines" aria-hidden>
                {lines.map((line) => (
                  <path key={line.key} d={line.d} data-active={line.active} />
                ))}
              </svg>
              {COLUMNS.map((near) => (
                <section key={near} className="wf-faden-col" aria-label={NEARNESS_LABEL[near]}>
                  <h2 className="wf-faden-col__title" title={COLUMN_HINT[near]}>
                    {NEARNESS_LABEL[near]}
                    <span>{column(near).length}</span>
                  </h2>
                  {column(near).map((card) => (
                    <Card
                      key={card.key}
                      card={card}
                      selected={card.key === selected}
                      shared={shared}
                      onSelect={() => setSelected(card.key === selected ? null : card.key)}
                      register={(element) => {
                        if (element) elements.current.set(card.key, element);
                        else elements.current.delete(card.key);
                      }}
                    />
                  ))}
                  {column(near).length === 0 && (
                    <p className="wf-faden-col__none">{COLUMN_HINT[near]}</p>
                  )}
                </section>
              ))}
              {lines.map((line) => (
                <span
                  key={line.key}
                  className={line.active ? 'wf-faden-touch' : 'wf-faden-knot'}
                  title={line.label}
                  style={{ left: line.x, top: line.y }}
                >
                  {line.active ? line.label : ''}
                </span>
              ))}
            </div>
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
          <Side
            card={current}
            view={view}
            links={links}
            cards={cards}
            onSelect={setSelected}
            onEdit={setDialog}
          />
        </div>
      )}

      {dialog?.type === 'story' && (
        <StoryDialog
          story={dialog.story}
          onClose={() => setDialog(null)}
          onSaved={(story) => {
            setDialog(null);
            setSelected(`story:${story.id}`);
          }}
        />
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
    </div>
  );
}

/** Eine Karte auf dem Brett: eine Geschichte mit Antreiber, Uhr und Fäden – oder ein loser Faden. */
function Card({
  card,
  selected,
  shared,
  onSelect,
  register,
}: {
  card: BoardCard;
  selected: boolean;
  shared: ReadonlySet<string>;
  onSelect: () => void;
  register: (element: HTMLElement | null) => void;
}) {
  const data = useData();
  const now = data.state.now;
  const owner = card.story?.ownerId ? data.entities[card.story.ownerId] : undefined;
  const repute = owner ? reputeOf(data, owner.id).party : null;
  const lone = card.story ? null : card.threads[0]!;
  const found = lone ? lone.hints.filter((hint) => hint.found).length : 0;
  const nodes = card.nodes.slice(0, 6);
  return (
    <button
      ref={register}
      type="button"
      className={cx('wf-faden-card', !card.story && 'wf-faden-card--thread')}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="wf-faden-card__top">
        <span className="wf-faden-card__sort">{card.story ? 'Geschichte' : 'Loser Faden'}</span>
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
      <span className="wf-faden-card__title">{card.title}</span>
      {owner && (
        <span className="wf-faden-card__owner">
          Treibt an: {owner.name}
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
      {card.story && card.threads.length > 0 && (
        <span className="wf-faden-card__threads">
          {card.threads.slice(0, 4).map((thread) => (
            <span key={thread.id} className={`wf-faden-thread wf-faden-thread--${thread.state}`}>
              <i aria-hidden />
              <span className="wf-clamp-2">{thread.title}</span>
              {threadWarning(thread) && <TriangleAlert aria-label="Warnung" />}
            </span>
          ))}
          {card.threads.length > 4 && (
            <span className="wf-faden-card__more">und {card.threads.length - 4} weitere Fäden</span>
          )}
        </span>
      )}
      {lone && lone.hints.length > 0 && (
        <span className="wf-faden-card__owner">
          {found} von {lone.hints.length} Hinweisen gefunden
          {threadWarning(lone) && <TriangleAlert aria-label="Warnung" />}
        </span>
      )}
      {nodes.length > 0 && (
        <span className="wf-faden-card__nodes">
          {nodes.map((id) => (
            <span key={id} className="wf-faden-node" data-shared={shared.has(id)}>
              {data.entities[id]?.name}
            </span>
          ))}
          {card.nodes.length > nodes.length && (
            <span className="wf-faden-node wf-faden-node--more">
              +{card.nodes.length - nodes.length}
            </span>
          )}
        </span>
      )}
    </button>
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
          Goldene Linien verbinden Geschichten, die an derselben Person, demselben Ort oder
          derselben Fraktion hängen.
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
          <Button size="sm" icon={<Pencil />} onClick={() => onEdit({ type: 'story', story })}>
            Ändern
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

      {card.clock && (
        <section>
          <h3 className="wf-faden-side__sub">
            Wenn niemand eingreift
            <span className={`wf-faden-pace wf-faden-pace--${card.pace}`}>
              {PACE_LABEL[card.pace]}
            </span>
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

      {card.nodes.length > 0 && (
        <section>
          <h3 className="wf-faden-side__sub">Hängt an</h3>
          <div className="wf-faden-card__nodes">
            {card.nodes.map((id) => (
              <span key={id} className="wf-faden-node">
                {link(id)}
              </span>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}
