/**
 * Eine Geschichte auf einem Blatt: von oben nach unten, was man für sie braucht – wer was will,
 * was auf dem Spiel steht, was geschieht, wenn niemand eingreift, die Fragen mit ihren Hinweisen,
 * Einstiege, Szenen, Leute und Orte, wie es enden kann. Geschrieben wird sofort; es gibt kein
 * Speichern. Rechts steht, was noch leer ist – als Rat, nie als Pflicht (`storyAdvice`).
 * Wayfarer schreibt nichts davon selbst.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import {
  ArrowLeft,
  Check,
  Circle,
  Hourglass,
  Plus,
  Swords,
  Trash2,
  TriangleAlert,
  Waypoints,
  X,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { clockView } from '../../domain/clock';
import {
  ENTRY_STANDINGS,
  SCENE_ODDS,
  THREAD_STATES,
  createEntity,
  newId,
  type EntryStanding,
  type SceneOdds,
  type Story,
  type StoryEntry,
  type StoryScene,
  type Thread,
  type ThreadHint,
  type ThreadState,
} from '../../domain/schema';
import {
  ENTRY_STANDING_LABEL,
  HINTS_WANTED,
  NEARNESS_LABEL,
  THREAD_STATE_HINT,
  THREAD_STATE_LABEL,
  boardCards,
  storyAdvice,
  threadsOf,
  touchReason,
  touches,
  untilText,
} from '../../domain/story';
import { formatDayMonth } from '../../domain/time/calendar';
import { focusOn } from '../../shell/focus';
import {
  Button,
  Checkbox,
  EmptyState,
  EntityPicker,
  EntityRefsEditor,
  IconButton,
  Input,
  Select,
  Written,
  confirmDialog,
  cx,
  toast,
} from '../../ui';
import { newEncounter } from '../bestiarium/encounterActions';
import { ClockDialog } from '../kalender/ClockDialog';
import {
  patchStory,
  patchThread,
  removeStory,
  removeThread,
  saveThread,
  setStorySteps,
  type StepInput,
} from './actions';
import './faeden.css';

const SCENE_ODDS_LABEL: Record<SceneOdds, string> = {
  sure: 'kommt sicher',
  maybe: 'vielleicht',
  unlikely: 'eher nicht',
};

export default function StoryPage() {
  const params = useParams<{ id: string }>();
  const data = useData();
  const story = data.stories[params.id];
  if (!story)
    return (
      <div className="wf-faden-blank">
        <EmptyState
          icon={<Waypoints />}
          title="Diese Geschichte gibt es nicht mehr"
          action={
            <Link href="/faeden" className="wf-btn">
              Zum Fadenbrett
            </Link>
          }
        >
          Vielleicht wurde sie gelöscht.
        </EmptyState>
      </div>
    );
  return <StorySheet key={story.id} story={story} />;
}

/**
 * Eine Liste zum Schreiben: Getippt wird nur hier; geschrieben wird beim Verlassen eines Feldes
 * (`flush`) oder sofort bei einer Auswahl (`set`). Leere Zeilen bleiben stehen, bis etwas darin
 * steht – gespeichert werden sie nie.
 */
function useDraftList<T extends { id: string }>(
  source: readonly T[],
  save: (items: T[]) => void,
  isEmpty: (item: T) => boolean,
) {
  const [items, setItems] = useState<T[]>(() => [...source]);
  const key = JSON.stringify(source);
  // Ändert sich der Spielstand (auch durch das eigene Speichern), gilt er – leere Zeilen bleiben.
  useEffect(() => {
    setItems((before) => [
      ...source,
      ...before.filter((item) => isEmpty(item) && !source.some((kept) => kept.id === item.id)),
    ]);
    // `source` und `isEmpty` sind bei jedem Zeichnen neu; gemeint ist der Inhalt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const filled = (list: T[]) => list.filter((item) => !isEmpty(item));
  return {
    items,
    /** Tippen: nur hier. */
    edit: (id: string, change: Partial<T>) =>
      setItems((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item))),
    /** Feld verlassen: schreiben. */
    flush: () => save(filled(items)),
    /** Eine Auswahl: gleich schreiben. */
    set: (id: string, change: Partial<T>) => {
      const next = items.map((item) => (item.id === id ? { ...item, ...change } : item));
      setItems(next);
      save(filled(next));
    },
    add: (item: T) => setItems((list) => [...list, item]),
    remove: (id: string) => {
      const next = items.filter((item) => item.id !== id);
      setItems(next);
      save(filled(next));
    },
  };
}

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  /** Was hierhin gehört – ein Satz. */
  hint: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="wf-faden-blatt__sec">
      <header className="wf-faden-blatt__head">
        <h2>{title}</h2>
        {action}
      </header>
      <p className="wf-faden-blatt__hint">{hint}</p>
      {children}
    </section>
  );
}

function StorySheet({ story }: { story: Story }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const advice = useMemo(() => storyAdvice(data, story), [data, story]);
  const open = advice.filter((entry) => !entry.done);
  const card = useMemo(
    () => boardCards(data).find((entry) => entry.key === `story:${story.id}`),
    [data, story.id],
  );
  const touching = useMemo(() => {
    const cards = boardCards(data);
    return touches(cards)
      .filter((touch) => touch.a === `story:${story.id}` || touch.b === `story:${story.id}`)
      .map((touch) => ({
        touch,
        other: cards.find(
          (entry) => entry.key === (touch.a === `story:${story.id}` ? touch.b : touch.a),
        ),
      }))
      .filter((row) => row.other);
  }, [data, story.id]);
  const patch = (change: Parameters<typeof patchStory>[2]) => patchStory(db, story.id, change);
  const createEntityOf = (kind: 'person' | 'place' | 'faction') => (name: string) =>
    db.put('entities', createEntity({ kind, name })).id;

  const remove = async () => {
    const ok = await confirmDialog({
      title: `„${story.title}“ löschen?`,
      body: 'Die Geschichte verschwindet mit ihrer Uhr. Ihre Fragen bleiben als lose Fäden auf dem Brett; was schon eingetreten ist, steht weiter in der Chronik.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    navigate('/faeden');
    removeStory(db, story.id);
  };

  return (
    <div className="wf-faden-blatt">
      <div className="wf-faden-blatt__main">
        <header className="wf-faden-blatt__top">
          <Link href="/faeden" className="wf-faden-blatt__back">
            <ArrowLeft aria-hidden /> Fadenbrett
          </Link>
          <div className="wf-faden-blatt__kicker">Geschichte</div>
          <Written
            className="wf-faden-blatt__name"
            label="Name der Geschichte"
            value={story.title}
            placeholder="Wie heißt sie?"
            onSave={(title) => patch({ title })}
          />
        </header>

        <Section title="Worum es geht" hint="Wer will was – ein Vorhaben, kein Ablauf.">
          <Written
            label="Worum es geht"
            rows={3}
            value={story.summary}
            placeholder="Die Aalfischer wollen den Zoll am Hafen an sich reißen …"
            onSave={(summary) => patch({ summary })}
          />
          <div className="wf-faden-blatt__pair">
            <span className="wf-faden-blatt__label">Wer sie antreibt</span>
            <EntityPicker
              value={story.ownerId}
              onChange={(ownerId) => patch({ ownerId })}
              kinds={['person', 'faction', 'family']}
              placeholder="Person oder Fraktion …"
              onCreate={createEntityOf('faction')}
            />
          </div>
        </Section>

        <Section
          title="Was auf dem Spiel steht"
          hint="Was geht verloren, wenn die Gruppe nichts tut? Bedrohlich – aber kein Weltuntergang, sonst hat sie keine Wahl."
        >
          <Written
            label="Was auf dem Spiel steht"
            rows={2}
            value={story.stakes}
            onSave={(stakes) => patch({ stakes })}
          />
        </Section>

        <Steps story={story} />
        <Threads story={story} />
        <Entries story={story} />
        <Scenes story={story} />

        <Section
          title="Leute und Orte"
          hint="Wer und was dazugehört. Daran erkennt Wayfarer, wie nah die Gruppe dran ist und wo Geschichten sich berühren."
        >
          <EntityRefsEditor
            value={story.refs}
            onChange={(refs) => patch({ refs })}
            kinds={['person', 'place', 'faction', 'family', 'item']}
            placeholder="Person, Ort oder Fraktion hinzufügen …"
          />
        </Section>

        <Section
          title="Wie es enden kann"
          hint="Der Höhepunkt und was danach anders ist – nicht der Weg dorthin."
        >
          <Written
            label="Wie es enden kann"
            rows={3}
            value={story.ending}
            onSave={(ending) => patch({ ending })}
          />
          <div className="wf-faden-blatt__pair wf-faden-blatt__pair--top">
            <span className="wf-faden-blatt__label">Was die Gruppe davon hat</span>
            <Written
              label="Was die Gruppe davon hat"
              rows={2}
              value={story.reward}
              placeholder="Beute, ein Gefallen, ein Verbündeter, Wissen …"
              onSave={(reward) => patch({ reward })}
            />
          </div>
        </Section>

        <Section
          title="Merkzettel"
          hint="Woran du am Tisch denken willst. Steht am Spieltisch, wenn die Geschichte im Spiel ist."
        >
          <Written
            label="Merkzettel"
            rows={3}
            value={story.memo}
            onSave={(memo) => patch({ memo })}
          />
        </Section>

        <footer className="wf-faden-blatt__foot">
          <Button variant="ghost" icon={<Trash2 />} onClick={remove}>
            Geschichte löschen
          </Button>
        </footer>
      </div>

      <aside className="wf-faden-blatt__side">
        <section>
          <h3 className="wf-faden-side__sub">Am Tisch</h3>
          <Checkbox checked={story.inPlay} onChange={(inPlay) => patch({ inPlay })}>
            Im Spiel – steht am Spieltisch
          </Checkbox>
          <Checkbox checked={story.known} onChange={(known) => patch({ known })}>
            Die Gruppe weiß von dieser Geschichte
          </Checkbox>
          <Checkbox checked={story.closed} onChange={(closed) => patch({ closed })}>
            Zu Ende erzählt
          </Checkbox>
          {card && (
            <p className="wf-mute">
              Nähe zur Gruppe: <b>{NEARNESS_LABEL[card.nearness]}</b>
            </p>
          )}
          <Button
            size="sm"
            icon={<Waypoints />}
            onClick={() => {
              focusOn({ type: 'card', key: `story:${story.id}` });
              navigate('/faeden');
            }}
          >
            Auf dem Fadenbrett zeigen
          </Button>
        </section>

        <section>
          <h3 className="wf-faden-side__sub">
            {open.length === 0 ? 'Alles da' : `Noch offen · ${open.length}`}
          </h3>
          <p className="wf-mute">
            Ein Rat, keine Pflicht: Was hier fehlt, trägt eine Geschichte am Tisch.
          </p>
          <ul className="wf-faden-rat">
            {advice.map((entry) => (
              <li key={entry.key} data-done={entry.done} title={entry.why}>
                {entry.done ? <Check aria-label="geschrieben" /> : <Circle aria-label="offen" />}
                <span>
                  {entry.text}
                  {!entry.done && <em>{entry.why}</em>}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {touching.length > 0 && (
          <section>
            <h3 className="wf-faden-side__sub">Berührt</h3>
            {touching.map(({ touch, other }) => (
              <button
                key={other!.key}
                type="button"
                className="wf-faden-touchrow"
                onClick={() =>
                  other!.story
                    ? navigate(`/geschichte/${other!.story.id}`)
                    : (focusOn({ type: 'card', key: other!.key }), navigate('/faeden'))
                }
              >
                <span>{other!.title}</span>
                <em>{touchReason(data, touch)}</em>
              </button>
            ))}
          </section>
        )}
      </aside>
    </div>
  );
}

// ── Die Uhr: was geschieht, wenn niemand eingreift ─────────────────────────

interface StepDraft {
  id: string;
  text: string;
  days: string;
}

const daysOf = (text: string): number => {
  const days = Number(text.replace(',', '.'));
  return Number.isFinite(days) && days > 0 ? days : 0;
};

function Steps({ story }: { story: Story }) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const clock = story.clockId ? data.clocks[story.clockId] : undefined;
  const view = clock ? clockView(clock, now) : null;
  const behind = view?.steps.filter((s) => s.state === 'done' || s.state === 'prevented') ?? [];
  const [dialog, setDialog] = useState(false);
  const source: StepDraft[] = (clock?.steps ?? [])
    .filter((step) => step.at === null)
    .map((step) => ({ id: step.id, text: step.text, days: String(step.days) }));
  const list = useDraftList<StepDraft>(
    source,
    (items) =>
      setStorySteps(
        db,
        story.id,
        items.map((item): StepInput => ({ id: item.id, text: item.text, days: daysOf(item.days) })),
      ),
    (item) => !item.text.trim(),
  );

  return (
    <Section
      title="Wenn niemand eingreift"
      hint="Schritt für Schritt bis zum schlimmen Ende. Die Schritte treten von selbst ein, wenn die Weltzeit vergeht."
      action={
        clock && (
          <Button
            size="sm"
            icon={<Hourglass />}
            onClick={() => setDialog(true)}
            title="Anhalten, verzögern, einen Schritt jetzt eintreten lassen oder verhindern, Bedingungen setzen"
          >
            Eingreifen
          </Button>
        )
      }
    >
      {view && (
        <p className="wf-faden-blatt__status">
          {view.blocked
            ? `Blockiert: ${view.blocked}`
            : view.paused
              ? 'Die Uhr ist angehalten.'
              : view.next
                ? `Nächster Schritt ${untilText(view.next.at - now)} (${formatDayMonth(cal, view.next.at)}).`
                : 'Alles ist geschehen.'}
        </p>
      )}
      <ol className="wf-faden-liste">
        {behind.map((step) => (
          <li key={step.step.id} className="wf-faden-liste__row wf-faden-liste__row--done">
            <span className="wf-faden-liste__mark">{step.state === 'prevented' ? '×' : '✓'}</span>
            <span>{step.step.text}</span>
            <em>
              {step.state === 'prevented' ? 'verhindert' : `am ${formatDayMonth(cal, step.at)}`}
            </em>
          </li>
        ))}
        {list.items.map((step, index) => (
          <li key={step.id} className="wf-faden-liste__row">
            <span className="wf-faden-liste__mark">{behind.length + index + 1}.</span>
            <Input
              value={step.text}
              aria-label={`Schritt ${behind.length + index + 1}`}
              placeholder="Was tritt ein?"
              onChange={(event) => list.edit(step.id, { text: event.target.value })}
              onBlur={list.flush}
            />
            <span className="wf-faden-liste__unit">nach</span>
            <Input
              className="wf-faden-liste__days"
              value={step.days}
              inputMode="decimal"
              aria-label="Tage nach dem vorigen Schritt"
              aria-invalid={daysOf(step.days) === 0}
              onChange={(event) => list.edit(step.id, { days: event.target.value })}
              onBlur={list.flush}
            />
            <span className="wf-faden-liste__unit">Tagen</span>
            <IconButton
              label="Schritt entfernen"
              size="sm"
              variant="ghost"
              onClick={() => list.remove(step.id)}
            >
              <X />
            </IconButton>
          </li>
        ))}
      </ol>
      <div>
        <Button
          size="sm"
          icon={<Plus />}
          onClick={() => list.add({ id: newId(), text: '', days: '3' })}
        >
          Schritt
        </Button>
      </div>
      {dialog && clock && (
        <ClockDialog key={clock.id} clock={clock} onClose={() => setDialog(false)} />
      )}
    </Section>
  );
}

// ── Fragen und Hinweise ────────────────────────────────────────────────────

function Threads({ story }: { story: Story }) {
  const db = useDb();
  const data = useData();
  const threads = threadsOf(data, story.id);
  const add = () =>
    saveThread(db, {
      title: 'Neue Frage',
      truth: '',
      state: 'open',
      storyId: story.id,
      refs: [],
      known: false,
      hints: [],
    });
  return (
    <Section
      title="Fragen und Hinweise"
      hint="Was die Gruppe herausfinden soll. Zu jeder Frage führen am besten drei Hinweise – einen übersieht sie, einen versteht sie falsch."
      action={
        <Button size="sm" icon={<Plus />} onClick={add}>
          Frage
        </Button>
      }
    >
      {threads.length === 0 && (
        <p className="wf-faden-blatt__none">
          Noch keine Frage. Eine Frage ist ein Faden, dem die Gruppe folgen kann: „Wer bezahlt den
          Zöllner?“
        </p>
      )}
      {threads.map((thread) => (
        <ThreadBlock key={thread.id} thread={thread} />
      ))}
    </Section>
  );
}

function ThreadBlock({ thread }: { thread: Thread }) {
  const db = useDb();
  const patch = (change: Parameters<typeof patchThread>[2]) => patchThread(db, thread.id, change);
  const hints = useDraftList<ThreadHint>(
    thread.hints,
    (items) => patch({ hints: items }),
    (hint) => !hint.text.trim(),
  );
  const written = thread.hints.filter((hint) => hint.text.trim()).length;
  const thin = written < HINTS_WANTED && thread.state !== 'solved' && thread.state !== 'lost';
  const remove = async () => {
    const ok = await confirmDialog({
      title: `„${thread.title}“ löschen?`,
      body: 'Die Frage und ihre Hinweise verschwinden.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (ok) removeThread(db, thread.id);
  };
  return (
    <div className={cx('wf-faden-frage', `wf-faden-thread--${thread.state}`)}>
      <div className="wf-faden-frage__head">
        <Written
          className="wf-faden-frage__title"
          label="Die Frage"
          value={thread.title}
          onSave={(title) => patch({ title })}
        />
        <Select
          value={thread.state}
          aria-label="Zustand"
          title={THREAD_STATE_HINT[thread.state]}
          onChange={(event) => patch({ state: event.target.value as ThreadState })}
        >
          {THREAD_STATES.map((state) => (
            <option key={state} value={state}>
              {THREAD_STATE_LABEL[state]}
            </option>
          ))}
        </Select>
        <IconButton label="Frage löschen" size="sm" variant="ghost" onClick={remove}>
          <Trash2 />
        </IconButton>
      </div>
      <Written
        label="Was dahintersteckt"
        rows={2}
        value={thread.truth}
        placeholder="Die Antwort – das siehst nur du."
        onSave={(truth) => patch({ truth })}
      />
      <div className="wf-faden-frage__hints">
        <div className="wf-faden-frage__sub">
          <span>Hinweise</span>
          <span className={thin ? 'wf-faden-frage__thin' : undefined}>
            {thin && <TriangleAlert aria-hidden />}
            {written} von {HINTS_WANTED}
          </span>
        </div>
        {hints.items.map((hint) => (
          <div key={hint.id} className="wf-faden-liste__row wf-faden-liste__row--hint">
            <Checkbox checked={hint.found} onChange={(found) => hints.set(hint.id, { found })}>
              <span className="wf-faden-liste__sr">Die Gruppe hat den Hinweis</span>
            </Checkbox>
            <Input
              value={hint.text}
              aria-label="Hinweis"
              placeholder="Was die Gruppe findet oder erfährt"
              onChange={(event) => hints.edit(hint.id, { text: event.target.value })}
              onBlur={hints.flush}
            />
            <EntityPicker
              value={hint.placeId}
              onChange={(placeId) => hints.set(hint.id, { placeId })}
              kinds={['place']}
              placeholder="Wo?"
            />
            <EntityPicker
              value={hint.sourceId}
              onChange={(sourceId) => hints.set(hint.id, { sourceId })}
              kinds={['person', 'faction']}
              placeholder="Wer weiß es?"
            />
            <IconButton
              label="Hinweis entfernen"
              size="sm"
              variant="ghost"
              onClick={() => hints.remove(hint.id)}
            >
              <X />
            </IconButton>
          </div>
        ))}
        <div className="wf-row" style={{ gap: 'var(--s-4)' }}>
          <Button
            size="sm"
            icon={<Plus />}
            onClick={() =>
              hints.add({ id: newId(), text: '', placeId: null, sourceId: null, found: false })
            }
          >
            Hinweis
          </Button>
          <Checkbox checked={thread.known} onChange={(known) => patch({ known })}>
            Die Gruppe kennt diese Frage
          </Checkbox>
        </div>
      </div>
    </div>
  );
}

// ── Einstiege ──────────────────────────────────────────────────────────────

function Entries({ story }: { story: Story }) {
  const db = useDb();
  const list = useDraftList<StoryEntry>(
    story.entries,
    (entries) => patchStory(db, story.id, { entries }),
    (entry) => !entry.text.trim(),
  );
  return (
    <Section
      title="Einstiege"
      hint="Wo und wie die Gruppe auf die Geschichte stößt. Zwei an verschiedenen Orten sind sicherer als einer."
      action={
        <Button
          size="sm"
          icon={<Plus />}
          onClick={() => list.add({ id: newId(), text: '', placeId: null, standing: 'any' })}
        >
          Einstieg
        </Button>
      }
    >
      {list.items.length === 0 && <p className="wf-faden-blatt__none">Noch kein Einstieg.</p>}
      {list.items.map((entry) => (
        <div key={entry.id} className="wf-faden-liste__row wf-faden-liste__row--entry">
          <Input
            value={entry.text}
            aria-label="Einstieg"
            placeholder="Ein Aushang, ein Gerücht, ein Hilferuf …"
            onChange={(event) => list.edit(entry.id, { text: event.target.value })}
            onBlur={list.flush}
          />
          <EntityPicker
            value={entry.placeId}
            onChange={(placeId) => list.set(entry.id, { placeId })}
            kinds={['place']}
            placeholder="Wo?"
          />
          <Select
            value={entry.standing}
            aria-label="Wann der Einstieg passt"
            onChange={(event) =>
              list.set(entry.id, { standing: event.target.value as EntryStanding })
            }
          >
            {ENTRY_STANDINGS.map((standing) => (
              <option key={standing} value={standing}>
                {ENTRY_STANDING_LABEL[standing]}
              </option>
            ))}
          </Select>
          <IconButton
            label="Einstieg entfernen"
            size="sm"
            variant="ghost"
            onClick={() => list.remove(entry.id)}
          >
            <X />
          </IconButton>
        </div>
      ))}
    </Section>
  );
}

// ── Szenen und Begegnungen ─────────────────────────────────────────────────

function Scenes({ story }: { story: Story }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const list = useDraftList<StoryScene>(
    story.scenes,
    (scenes) => patchStory(db, story.id, { scenes }),
    (scene) => !scene.text.trim() && !scene.encounterId,
  );
  const encounters = Object.values(data.encounters).sort((a, b) =>
    a.name.localeCompare(b.name, 'de'),
  );
  const prepare = (scene: StoryScene) => {
    const encounter = newEncounter(db, scene.text.trim().slice(0, 60) || story.title);
    list.set(scene.id, { encounterId: encounter.id });
    toast({
      title: 'Begegnung angelegt',
      body: `„${encounter.name}“ – im Bestiarium stellst du sie zusammen.`,
      action: { label: 'Öffnen', run: () => navigate(`/begegnungen/${encounter.id}`) },
    });
  };
  return (
    <Section
      title="Szenen und Begegnungen"
      hint="Was bereitliegt. Jede Szene bringt die Gruppe voran, hält sie auf oder verrät etwas."
      action={
        <Button
          size="sm"
          icon={<Plus />}
          onClick={() => list.add({ id: newId(), text: '', encounterId: null, odds: 'maybe' })}
        >
          Szene
        </Button>
      }
    >
      {list.items.length === 0 && <p className="wf-faden-blatt__none">Noch keine Szene.</p>}
      {list.items.map((scene) => (
        <div key={scene.id} className="wf-faden-liste__row wf-faden-liste__row--scene">
          <Input
            value={scene.text}
            aria-label="Szene"
            placeholder="Was geschieht?"
            onChange={(event) => list.edit(scene.id, { text: event.target.value })}
            onBlur={list.flush}
          />
          <Select
            value={scene.odds}
            aria-label="Wie sicher die Szene kommt"
            onChange={(event) => list.set(scene.id, { odds: event.target.value as SceneOdds })}
          >
            {SCENE_ODDS.map((odds) => (
              <option key={odds} value={odds}>
                {SCENE_ODDS_LABEL[odds]}
              </option>
            ))}
          </Select>
          <Select
            value={scene.encounterId ?? ''}
            aria-label="Begegnung zur Szene"
            onChange={(event) =>
              event.target.value === '+'
                ? prepare(scene)
                : list.set(scene.id, { encounterId: event.target.value || null })
            }
          >
            <option value="">ohne Begegnung</option>
            {encounters.map((encounter) => (
              <option key={encounter.id} value={encounter.id}>
                {encounter.name}
              </option>
            ))}
            <option value="+">Neue Begegnung …</option>
          </Select>
          {scene.encounterId && data.encounters[scene.encounterId] ? (
            <IconButton
              label="Begegnung öffnen"
              size="sm"
              onClick={() => navigate(`/begegnungen/${scene.encounterId}`)}
            >
              <Swords />
            </IconButton>
          ) : (
            <span />
          )}
          <IconButton
            label="Szene entfernen"
            size="sm"
            variant="ghost"
            onClick={() => list.remove(scene.id)}
          >
            <X />
          </IconButton>
        </div>
      ))}
    </Section>
  );
}
