/**
 * Eine Geschichte auf einem Blatt: von oben nach unten, was man für sie braucht – wer was will,
 * was auf dem Spiel steht, was geschieht, wenn niemand eingreift, die Fragen mit ihren Hinweisen,
 * Einstiege, Szenen, Leute und Orte, wie es enden kann. Geschrieben wird sofort; es gibt kein
 * Speichern. Rechts steht, was noch leer ist – als Rat, nie als Pflicht (`storyAdvice`).
 * Wayfarer schreibt nichts davon selbst.
 */
import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import {
  ArrowLeft,
  Hourglass,
  Plus,
  Swords,
  Trash2,
  TriangleAlert,
  Waypoints,
  X,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { LootList } from '../beute/LootList';
import { clockView } from '../../domain/clock';
import { entitiesOfKind } from '../../domain/derive';
import {
  ENTRY_STANDINGS,
  SCENE_ODDS,
  THREAD_STATES,
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
  heroesOf,
  storyAdvice,
  storyAttached,
  storyTexts,
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
  NamesHint,
  Select,
  SheetAdvice,
  SheetSection,
  Written,
  confirmDialog,
  cx,
  entityHref,
  toast,
  useDraftList,
  type MentionOptions,
} from '../../ui';
import { newEncounter } from '../bestiarium/encounterActions';
import { ClockDialog } from '../kalender/ClockDialog';
import {
  attachToStory,
  detachFromStory,
  markNotMeant,
  patchStory,
  patchThread,
  removeStory,
  removeThread,
  saveThread,
  setStorySteps,
  tieHero,
  untieHero,
  type StepInput,
} from './actions';
import './faeden.css';

/**
 * „@“ in den Textfeldern des Blatts: Wer so erwähnt wird, gehört danach zur Geschichte; was es
 * noch nicht gibt, entsteht als Platzhalter aus dieser Geschichte. Ohne Suchwort stehen zuerst
 * die da, die schon dazugehören.
 */
function useStoryMention(story: Story): MentionOptions {
  const db = useDb();
  const data = useData();
  const near = useMemo(() => storyAttached(data, story), [data, story]);
  return useMemo(
    () => ({
      storyId: story.id,
      near,
      onMention: (entityId: string) => attachToStory(db, story.id, entityId),
    }),
    [db, story.id, near],
  );
}

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
  const mention = useStoryMention(story);
  const texts = useMemo(() => storyTexts(data, story), [data, story]);
  const attached = useMemo(() => storyAttached(data, story), [data, story]);

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
    <div className="wf-sheet">
      <div className="wf-sheet__main">
        <header className="wf-sheet__top">
          <Link href="/faeden" className="wf-sheet__back">
            <ArrowLeft aria-hidden /> Fadenbrett
          </Link>
          <div className="wf-sheet__kicker">Geschichte</div>
          <Written
            className="wf-sheet__name"
            label="Name der Geschichte"
            value={story.title}
            placeholder="Wie heißt sie?"
            onSave={(title) => patch({ title })}
          />
        </header>

        <SheetSection title="Worum es geht" hint="Wer will was – ein Vorhaben, kein Ablauf.">
          <Written
            label="Worum es geht"
            rows={3}
            value={story.summary}
            placeholder="Wer will was? Mit @ erwähnst du jemanden – oder legst ihn gleich an."
            mention={mention}
            onSave={(summary) => patch({ summary })}
          />
          <div className="wf-sheet__pair">
            <span className="wf-sheet__label">Wer sie antreibt</span>
            <EntityPicker
              value={story.ownerId}
              onChange={(ownerId) => patch({ ownerId })}
              kinds={['person', 'faction', 'family']}
              placeholder="Person, Fraktion oder Familie …"
              create={{ storyId: story.id }}
            />
          </div>
        </SheetSection>

        <SheetSection
          title="Was auf dem Spiel steht"
          hint="Was geht verloren, wenn die Gruppe nichts tut? Bedrohlich – aber kein Weltuntergang, sonst hat sie keine Wahl."
        >
          <Written
            label="Was auf dem Spiel steht"
            rows={2}
            value={story.stakes}
            mention={mention}
            onSave={(stakes) => patch({ stakes })}
          />
        </SheetSection>

        <Steps story={story} />
        <Threads story={story} />
        <Entries story={story} />
        <Scenes story={story} />

        <SheetSection
          title="Leute und Orte"
          hint="Wer und was dazugehört. Daran erkennt Wayfarer, wie nah die Gruppe dran ist und wo Geschichten sich berühren."
        >
          <EntityRefsEditor
            value={story.refs}
            onChange={(refs) => patch({ refs })}
            kinds={['person', 'place', 'faction', 'family', 'item']}
            placeholder="Person, Ort oder Fraktion hinzufügen …"
            create={{ storyId: story.id }}
          />
          <NamesHint
            texts={texts}
            attached={attached}
            ignored={story.notMeant}
            storyId={story.id}
            kinds={['person', 'place', 'faction', 'family', 'item']}
            onAdd={(entityId) => attachToStory(db, story.id, entityId)}
            onRemove={(entityId) => detachFromStory(db, story.id, entityId)}
            onIgnore={(key) => markNotMeant(db, story.id, key)}
          />
        </SheetSection>

        <Heroes story={story} />

        <SheetSection
          title="Wie es enden kann"
          hint="Der Höhepunkt und was danach anders ist – nicht der Weg dorthin."
        >
          <Written
            label="Wie es enden kann"
            rows={3}
            value={story.ending}
            mention={mention}
            onSave={(ending) => patch({ ending })}
          />
          <div className="wf-sheet__pair wf-sheet__pair--top">
            <span className="wf-sheet__label">Was die Gruppe davon hat</span>
            <Written
              label="Was die Gruppe davon hat"
              rows={2}
              value={story.reward}
              placeholder="Beute, ein Gefallen, ein Verbündeter, Wissen …"
              mention={mention}
              onSave={(reward) => patch({ reward })}
            />
          </div>
          <div className="wf-sheet__pair wf-sheet__pair--top">
            <span className="wf-sheet__label">Beute, die bereitliegt</span>
            <LootList storyId={story.id} />
          </div>
        </SheetSection>

        <SheetSection
          title="Merkzettel"
          hint="Woran du am Tisch denken willst. Steht am Spieltisch, wenn die Geschichte im Spiel ist."
        >
          <Written
            label="Merkzettel"
            rows={3}
            value={story.memo}
            mention={mention}
            onSave={(memo) => patch({ memo })}
          />
        </SheetSection>

        <footer className="wf-sheet__foot">
          <Button variant="ghost" icon={<Trash2 />} onClick={remove}>
            Geschichte löschen
          </Button>
        </footer>
      </div>

      <aside className="wf-sheet__side">
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
          <SheetAdvice items={advice} />
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

// ── Wen es persönlich betrifft ─────────────────────────────────────────────

function Heroes({ story }: { story: Story }) {
  const db = useDb();
  const data = useData();
  const rows = heroesOf(data, story);
  const others = entitiesOfKind(data, 'character')
    .filter((character) => !rows.some((row) => row.character.id === character.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return (
    <SheetSection
      title="Wen es persönlich betrifft"
      hint="Welcher Gefährte hat einen eigenen Grund, sich einzumischen – und welchen? Dann ist es mehr als ein Auftrag."
    >
      {rows.length === 0 && (
        <p className="wf-sheet__none">Noch kein Gefährte hängt an dieser Geschichte.</p>
      )}
      {rows.map(({ hero, character }) => (
        <div key={hero.id} className="wf-sheet-list__row wf-sheet-list__row--hero">
          <Link href={entityHref(character)} className="wf-faden-held wf-clamp-1">
            {character.name}
          </Link>
          <div className="wf-faden-held__why">
            <Written
              label={`Warum es ${character.name} betrifft`}
              value={hero.why}
              placeholder="Sein eigener Grund"
              onSave={(why) =>
                patchStory(db, story.id, {
                  heroes: story.heroes.map((entry) =>
                    entry.id === hero.id ? { ...entry, why: why.trim() } : entry,
                  ),
                })
              }
            />
            {character.character.goal.trim() && (
              <span className="wf-faden-held__goal">
                Sein Ziel: {character.character.goal.trim()}
              </span>
            )}
          </div>
          <IconButton
            label={`${character.name} von der Geschichte lösen`}
            size="sm"
            variant="ghost"
            onClick={() => untieHero(db, story.id, character.id)}
          >
            <X />
          </IconButton>
        </div>
      ))}
      {others.length > 0 && (
        <Select
          className="wf-faden-held__add"
          value=""
          aria-label="Gefährten an die Geschichte heften"
          onChange={(event) => {
            if (event.target.value) tieHero(db, story.id, event.target.value);
          }}
        >
          <option value="">Gefährten hinzufügen …</option>
          {others.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </Select>
      )}
    </SheetSection>
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
    <SheetSection
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
        <p className="wf-sheet__status">
          {view.blocked
            ? `Blockiert: ${view.blocked}`
            : view.paused
              ? 'Die Uhr ist angehalten.'
              : view.next
                ? `Nächster Schritt ${untilText(view.next.at - now)} (${formatDayMonth(cal, view.next.at)}).`
                : 'Alles ist geschehen.'}
        </p>
      )}
      <ol className="wf-sheet-list">
        {behind.map((step) => (
          <li key={step.step.id} className="wf-sheet-list__row wf-sheet-list__row--done">
            <span className="wf-sheet-list__mark">{step.state === 'prevented' ? '×' : '✓'}</span>
            <span>{step.step.text}</span>
            <em>
              {step.state === 'prevented' ? 'verhindert' : `am ${formatDayMonth(cal, step.at)}`}
            </em>
          </li>
        ))}
        {list.items.map((step, index) => (
          <li key={step.id} className="wf-sheet-list__row">
            <span className="wf-sheet-list__mark">{behind.length + index + 1}.</span>
            <Input
              value={step.text}
              aria-label={`Schritt ${behind.length + index + 1}`}
              placeholder="Was tritt ein?"
              onChange={(event) => list.edit(step.id, { text: event.target.value })}
              onBlur={list.flush}
            />
            <span className="wf-sheet-list__unit">nach</span>
            <Input
              className="wf-sheet-list__days"
              value={step.days}
              inputMode="decimal"
              aria-label="Tage nach dem vorigen Schritt"
              aria-invalid={daysOf(step.days) === 0}
              onChange={(event) => list.edit(step.id, { days: event.target.value })}
              onBlur={list.flush}
            />
            <span className="wf-sheet-list__unit">Tagen</span>
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
    </SheetSection>
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
    <SheetSection
      title="Fragen und Hinweise"
      hint="Was die Gruppe herausfinden soll. Zu jeder Frage führen am besten drei Hinweise – einen übersieht sie, einen versteht sie falsch."
      action={
        <Button size="sm" icon={<Plus />} onClick={add}>
          Frage
        </Button>
      }
    >
      {threads.length === 0 && (
        <p className="wf-sheet__none">
          Noch keine Frage. Eine Frage ist ein Faden, dem die Gruppe folgen kann: etwas, das sie
          herausfinden will.
        </p>
      )}
      {threads.map((thread) => (
        <ThreadBlock key={thread.id} thread={thread} story={story} />
      ))}
    </SheetSection>
  );
}

function ThreadBlock({ thread, story }: { thread: Thread; story: Story }) {
  const db = useDb();
  const mention = useStoryMention(story);
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
          mention={mention}
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
        mention={mention}
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
          <div key={hint.id} className="wf-sheet-list__row wf-sheet-list__row--hint">
            <Checkbox checked={hint.found} onChange={(found) => hints.set(hint.id, { found })}>
              <span className="wf-sheet-list__sr">Die Gruppe hat den Hinweis</span>
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
              create={{ storyId: story.id, onlyKinds: true }}
            />
            <EntityPicker
              value={hint.sourceId}
              onChange={(sourceId) => hints.set(hint.id, { sourceId })}
              kinds={['person', 'faction']}
              placeholder="Wer weiß es?"
              create={{ storyId: story.id }}
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
    <SheetSection
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
      {list.items.length === 0 && <p className="wf-sheet__none">Noch kein Einstieg.</p>}
      {list.items.map((entry) => (
        <div key={entry.id} className="wf-sheet-list__row wf-sheet-list__row--entry">
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
            create={{ storyId: story.id, onlyKinds: true }}
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
    </SheetSection>
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
    <SheetSection
      title="Szenen und Begegnungen"
      hint="Was bereitliegt. Jede Szene bringt die Gruppe voran, hält sie auf oder verrät etwas."
      action={
        <Button
          size="sm"
          icon={<Plus />}
          onClick={() =>
            list.add({
              id: newId(),
              text: '',
              encounterId: null,
              odds: 'maybe',
              placeId: null,
              done: false,
            })
          }
        >
          Szene
        </Button>
      }
    >
      {list.items.length === 0 && <p className="wf-sheet__none">Noch keine Szene.</p>}
      {list.items.map((scene) => (
        <div key={scene.id} className="wf-sheet-list__row wf-sheet-list__row--scene">
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
          <div className="wf-faden-scene-place">
            <EntityPicker
              value={scene.placeId}
              onChange={(placeId) => list.set(scene.id, { placeId })}
              kinds={['place']}
              placeholder="Wo? – erscheint dann dort am Spieltisch"
              create={{ storyId: story.id, onlyKinds: true }}
            />
          </div>
        </div>
      ))}
    </SheetSection>
  );
}
