/**
 * Eine Geschichte auf einem Blatt, an dem man entlang denken kann – von oben nach unten: wer was
 * will, was ihm noch fehlt, was geschieht, wenn niemand eingreift, was auf dem Spiel steht, wer
 * beteiligt ist und wie sie zueinander stehen, wen es persönlich betrifft, wie die Gruppe
 * hineinkommt, welche Fragen sie stellt, wo sie spielt, was bereitliegt, wie es enden kann. Jedes
 * Fach ist freiwillig; sein Satz ist eine Leitfrage zur Form, nie ein Inhalt. Alles geht von der
 * Geschichte aus: Was es in der Welt noch nicht gibt, entsteht hier als Platzhalter. Geschrieben
 * wird sofort; es gibt kein Speichern. Oben steht der Stand (`storyStage`), am Rand der Rat
 * (`storyAdvice`) – nie als Pflicht. Wayfarer schreibt nichts davon selbst.
 */
import { Fragment, useMemo } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ArrowLeft, Plus, Trash2, Waypoints } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import type { CampaignData, Story } from '../../domain/schema';
import {
  NEARNESS_LABEL,
  PACE_LABEL,
  STAGE_LABEL,
  boardCards,
  storyAdvice,
  storyAttached,
  storyStage,
  storyTexts,
  touchReason,
  touches,
  type StoryAdvice,
  type StoryStageView,
} from '../../domain/story';
import { parentChoices, storyHangs, storyParts } from '../../domain/storySheet';
import { formatDayMonth } from '../../domain/time/calendar';
import { focusOn } from '../../shell/focus';
import { backLink, previousLocation } from '../../shell/trail';
import {
  Button,
  Checkbox,
  EmptyState,
  EntityPicker,
  Select,
  SheetAdvice,
  SheetSection,
  Written,
  confirmDialog,
  focusSheetSection,
} from '../../ui';
import { LootList } from '../beute/LootList';
import { newSubStory, patchStory, removeStory, setAdviceOff } from './actions';
import { StoryCast } from './StoryCast';
import { StoryEntries, StoryHeroes, StoryScenes } from './StoryLists';
import { StoryPlaces } from './StoryPlaces';
import { StorySteps } from './StorySteps';
import { StoryThreads, newHintLabel } from './StoryThreads';
import { useStoryMention } from './storyMention';
import './faeden.css';

/** Namen, die eine Geschichte beim Anlegen bekommt – beim ersten Klick ist er ganz markiert. */
const DEFAULT_TITLES = ['Neue Geschichte', 'Neues Vorhaben', 'Neue Teilgeschichte'];

const STAGES_HELP =
  'Keim: Jemand will etwas, und es gibt einen nächsten Schritt. Spielbar: dazu ein Einstieg, ein Ort, eine Frage mit drei Hinweisen, eine Szene. Rund: der Rest. Ein Rat, keine Pflicht.';

/** Beschriftungen der Felder, in die ein Rat führt, wenn sein Fach mehrere Dinge fasst. */
const LABEL_GOAL = 'Was der Antreiber will';
const LABEL_REWARD = 'Was die Gruppe davon hat';

/** Springt zum Fach eines Rats – und dort in das Feld, das er meint. */
function goToAdvice(data: CampaignData, entry: StoryAdvice): void {
  const thread = entry.threadId ? data.threads[entry.threadId] : undefined;
  const label =
    entry.key === 'goal'
      ? LABEL_GOAL
      : entry.key === 'reward'
        ? LABEL_REWARD
        : thread
          ? newHintLabel(thread.title)
          : undefined;
  focusSheetSection(entry.section, label);
}

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

/** Der Stand in einer ruhigen Zeile: was sie ist – und die ein bis drei Dinge, die als Nächstes fehlen. */
function StageLine({
  view,
  onPick,
}: {
  view: StoryStageView;
  onPick: (entry: StoryAdvice) => void;
}) {
  return (
    <p className="wf-faden-stand">
      <b title={STAGES_HELP}>{STAGE_LABEL[view.stage]}</b>
      {view.next.length === 0 ? (
        ' – alles da, was eine Geschichte am Tisch trägt.'
      ) : (
        <>
          {view.stage === 'playable' ? ' – rund wird sie mit: ' : ' – als Nächstes: '}
          {view.next.map((entry, index) => (
            <Fragment key={entry.key}>
              {index > 0 && ' · '}
              <button
                type="button"
                className="wf-faden-link"
                title={entry.why}
                onClick={() => onPick(entry)}
              >
                {entry.text}
              </button>
            </Fragment>
          ))}
        </>
      )}
    </p>
  );
}

function StorySheet({ story }: { story: Story }) {
  const db = useDb();
  const data = useData();
  const [location, navigate] = useLocation();
  const advice = useMemo(() => storyAdvice(data, story), [data, story]);
  const stage = useMemo(() => storyStage(data, story, advice), [data, story, advice]);
  const cards = useMemo(() => boardCards(data), [data]);
  const card = cards.find((entry) => entry.key === `story:${story.id}`);
  const touching = useMemo(
    () =>
      touches(cards)
        .filter((touch) => touch.a === `story:${story.id}` || touch.b === `story:${story.id}`)
        .map((touch) => ({
          touch,
          other: cards.find(
            (entry) => entry.key === (touch.a === `story:${story.id}` ? touch.b : touch.a),
          ),
        }))
        .filter((row) => row.other),
    [cards, story.id],
  );
  const patch = (change: Parameters<typeof patchStory>[2]) => patchStory(db, story.id, change);
  const mention = useStoryMention(story);
  const texts = useMemo(() => storyTexts(data, story), [data, story]);
  const attached = useMemo(() => storyAttached(data, story), [data, story]);
  const back = backLink(data, previousLocation(location));
  const parent = story.parentId ? data.stories[story.parentId] : undefined;
  const parents = useMemo(() => parentChoices(data, story), [data, story]);
  const parts = useMemo(() => storyParts(data, story.id), [data, story.id]);
  const hangs = useMemo(() => storyHangs(data, story), [data, story]);
  const cal = data.campaign.calendar;

  const remove = async () => {
    const ok = await confirmDialog({
      title: `„${story.title}“ löschen?`,
      body: 'Die Geschichte verschwindet mit ihrer Uhr. Ihre Fragen bleiben als lose Fäden am Fadenbrett, ihre Wegenetze und Teilgeschichten bleiben für sich; was schon eingetreten ist, steht weiter in der Chronik.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    navigate('/faeden');
    removeStory(db, story.id);
  };
  const addPart = () => {
    const part = newSubStory(db, story.id);
    if (part) navigate(`/geschichte/${part.id}`);
  };

  return (
    <div className="wf-sheet">
      <div className="wf-sheet__main">
        <header className="wf-sheet__top">
          <Link href={back.href} className="wf-sheet__back">
            <ArrowLeft aria-hidden /> <span className="wf-clamp-1">{back.label}</span>
          </Link>
          <div className="wf-sheet__kicker">
            Geschichte
            {parent && (
              <>
                {' · Teil von '}
                <Link href={`/geschichte/${parent.id}`}>{parent.title}</Link>
              </>
            )}
          </div>
          <Written
            className="wf-sheet__name"
            label="Name der Geschichte"
            value={story.title}
            placeholder="Wie heißt sie?"
            selectAll={DEFAULT_TITLES.includes(story.title)}
            onSave={(title) => patch({ title })}
          />
          <StageLine view={stage} onPick={(entry) => goToAdvice(data, entry)} />
        </header>

        <SheetSection
          id="text"
          title="Die Geschichte"
          hint="In deinen Worten, so lang du willst. Alles darunter ist freiwillig – füll aus, was dir hilft."
        >
          <Written
            className="wf-sheet__story"
            label="Die Geschichte in deinen Worten"
            grow
            value={story.text}
            placeholder="Schreib einfach drauflos: was passiert, wer was will, wie es ausgehen könnte. Mit @ erwähnst du jemanden – oder legst ihn gleich an."
            mention={mention}
            onSave={(text) => patch({ text })}
          />
        </SheetSection>

        <SheetSection
          id="who"
          title="Wer will was"
          hint="Ein Vorhaben, kein Ablauf: Wer treibt das an – und was will er?"
        >
          <div className="wf-sheet__pair">
            <span className="wf-sheet__label">Wer sie antreibt</span>
            <EntityPicker
              value={story.ownerId}
              onChange={(ownerId) => patch({ ownerId })}
              kinds={['person', 'faction', 'family']}
              placeholder="Wählen – oder neu anlegen …"
              create={{ storyId: story.id }}
            />
          </div>
          <div className="wf-sheet__pair wf-sheet__pair--top">
            <span className="wf-sheet__label">Was er will</span>
            <Written
              label={LABEL_GOAL}
              grow
              value={story.summary}
              placeholder="In einem Satz, aus seiner Sicht. Mit @ erwähnst du jemanden – oder legst ihn gleich an."
              mention={mention}
              onSave={(summary) => patch({ summary })}
            />
          </div>
        </SheetSection>

        <SheetSection
          id="needs"
          title="Was ihm noch fehlt"
          hint="Was braucht er noch, bevor er am Ziel ist? Jede Hürde ist ein Schritt."
        >
          <Written
            label="Was ihm noch fehlt"
            grow
            value={story.needs}
            mention={mention}
            onSave={(needs) => patch({ needs })}
          />
        </SheetSection>

        <StorySteps story={story} />

        <SheetSection
          id="stakes"
          title="Was auf dem Spiel steht"
          hint="Ein bis drei offene Fragen, deren Antwort du dem Spiel überlässt."
        >
          <Written
            label="Was auf dem Spiel steht"
            grow
            value={story.stakes}
            mention={mention}
            onSave={(stakes) => patch({ stakes })}
          />
        </SheetSection>

        <StoryCast story={story} texts={texts} attached={attached} />
        <StoryHeroes story={story} />
        <StoryEntries story={story} />
        <StoryThreads story={story} />
        <StoryPlaces story={story} />
        <StoryScenes story={story} />

        <SheetSection
          id="ending"
          title="Wie es enden kann"
          hint="Zwei, drei mögliche Enden – offen. Der Höhepunkt und was danach anders ist, nicht der Weg dorthin."
        >
          <Written
            label="Wie es enden kann"
            grow
            value={story.ending}
            mention={mention}
            onSave={(ending) => patch({ ending })}
          />
          <div className="wf-sheet__pair wf-sheet__pair--top">
            <span className="wf-sheet__label">Was die Gruppe davon hat</span>
            <Written
              label={LABEL_REWARD}
              grow
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
          id="memo"
          title="Merkzettel"
          hint="Woran du am Tisch denken willst. Steht am Spieltisch, wenn die Geschichte im Spiel ist."
        >
          <Written
            label="Merkzettel"
            grow
            value={story.memo}
            mention={mention}
            onSave={(memo) => patch({ memo })}
          />
        </SheetSection>

        {parts.length > 0 && (
          <SheetSection
            id="parts"
            title="Teilgeschichten"
            hint="Kleinere Geschichten, die zu dieser gehören – jede auf ihrem eigenen Blatt."
            action={
              <Button size="sm" icon={<Plus />} onClick={addPart}>
                Teilgeschichte
              </Button>
            }
          >
            {parts.map((part) => (
              <Link
                key={part.story.id}
                href={`/geschichte/${part.story.id}`}
                className="wf-faden-teil"
                data-closed={part.story.closed}
              >
                <span className="wf-faden-teil__name wf-clamp-1">{part.story.title}</span>
                <span className="wf-faden-teil__stand">
                  {part.story.closed ? 'zu Ende erzählt' : STAGE_LABEL[part.stage]}
                  {part.pace !== 'none' && !part.story.closed && ` · Uhr ${PACE_LABEL[part.pace]}`}
                </span>
                <em className="wf-clamp-1">{part.next ?? ''}</em>
              </Link>
            ))}
          </SheetSection>
        )}

        <footer className="wf-sheet__foot">
          {parts.length === 0 && (
            <Button
              variant="ghost"
              icon={<Plus />}
              onClick={addPart}
              title="Eine kleinere Geschichte, die zu dieser gehört – sie übernimmt den Antreiber"
            >
              Teilgeschichte anlegen
            </Button>
          )}
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
          <h3 className="wf-faden-side__sub" title={STAGES_HELP}>
            Stand: {STAGE_LABEL[stage.stage]}
          </h3>
          <SheetAdvice
            items={advice}
            onPick={(entry) => goToAdvice(data, entry)}
            onOff={(entry, off) => setAdviceOff(db, story.id, entry.key, off)}
          />
        </section>

        {parents.length > 0 && (
          <section>
            <h3 className="wf-faden-side__sub">Teil von</h3>
            <Select
              value={parent?.id ?? ''}
              aria-label="Die große Geschichte, zu der diese gehört"
              onChange={(event) => patch({ parentId: event.target.value || null })}
            >
              <option value="">steht für sich</option>
              {parents.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </Select>
          </section>
        )}

        {hangs.handouts.length + hangs.events.length + hangs.promises.length + hangs.notes.length >
          0 && (
          <section>
            <h3 className="wf-faden-side__sub">Was sonst daran hängt</h3>
            {hangs.handouts.map((handout) => (
              <button
                key={handout.id}
                type="button"
                className="wf-faden-touchrow"
                onClick={() => {
                  focusOn({ type: 'handout', id: handout.id });
                  navigate('/handouts');
                }}
              >
                <span className="wf-clamp-1">{handout.title || 'Handout ohne Titel'}</span>
                <em>{handout.givenAt === null ? 'Handout' : 'übergeben'}</em>
              </button>
            ))}
            {hangs.events.map((event) => (
              <button
                key={event.id}
                type="button"
                className="wf-faden-touchrow"
                onClick={() => navigate('/kalender')}
              >
                <span className="wf-clamp-1">{event.title}</span>
                <em>{event.repeat ? 'Termin' : `Termin · ${formatDayMonth(cal, event.at)}`}</em>
              </button>
            ))}
            {hangs.promises.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="wf-faden-touchrow"
                onClick={() => navigate('/offen')}
              >
                <span className="wf-clamp-2">{entry.text}</span>
                <em>Abmachung</em>
              </button>
            ))}
            {hangs.notes.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="wf-faden-touchrow"
                onClick={() => navigate('/chronik')}
              >
                <span className="wf-clamp-2">{entry.text}</span>
                <em>{formatDayMonth(cal, entry.at)}</em>
              </button>
            ))}
          </section>
        )}

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
