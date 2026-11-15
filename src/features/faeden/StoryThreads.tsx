/**
 * „Fragen und Hinweise“ auf dem Blatt einer Geschichte: Jede Frage ist ein Faden mit dem, was
 * dahintersteckt, und ihren Hinweisen. Eine neue Frage entsteht mit dem ersten Wort; eine Frage
 * lässt sich von der Geschichte lösen (sie wird ein loser Faden). Darunter die losen Fäden, die
 * zu dieser Geschichte passen könnten (`threadFits`) – als Frage, als Hinweis oder als Einstieg
 * hereinzuholen. Gefundene Hinweise und beantwortete Fragen bleiben getrennt.
 */
import { useMemo } from 'react';
import { Link, useLocation } from 'wouter';
import { Trash2, TriangleAlert, Unlink, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  THREAD_STATES,
  newId,
  type Story,
  type Thread,
  type ThreadHint,
  type ThreadState,
} from '../../domain/schema';
import {
  THREAD_STATE_HINT,
  THREAD_STATE_LABEL,
  isLooseThread,
  threadLive,
  threadsOf,
} from '../../domain/story';
import { eveningSecretsOf, hintsOnEvening } from '../../domain/prepOffers';
import { hintsNote, threadFits, type ThreadFit } from '../../domain/storySheet';
import {
  Button,
  Checkbox,
  EntityPicker,
  IconButton,
  NewLine,
  Select,
  SheetSection,
  Written,
  confirmDialog,
  cx,
  toast,
  useDraftList,
} from '../../ui';
import {
  moveThread,
  patchThread,
  removeThread,
  saveThread,
  threadToEntry,
  threadToHint,
} from './actions';
import { useStoryMention } from './storyMention';

/** Wie die Zeile für einen neuen Hinweis heißt – so findet sie auch der Rat am Rand. */
export const newHintLabel = (title: string): string => `Neuer Hinweis zu „${title}“`;

/** Mehr lose Fäden schlägt das Blatt nicht auf einmal vor. */
const FITS_SHOWN = 4;

export function StoryThreads({ story }: { story: Story }) {
  const db = useDb();
  const data = useData();
  const mention = useStoryMention(story);
  const threads = threadsOf(data, story.id);
  /** Geheimnisse des Abends, die zu dieser Geschichte gehören – ohne die, die ein Hinweis sind. */
  const ready = useMemo(() => eveningSecretsOf(data, story.id), [data, story.id]);
  return (
    <SheetSection
      id="threads"
      title="Fragen und Hinweise"
      hint="Was soll die Gruppe herausfinden – und was steckt dahinter? Zu jeder Frage führen am besten drei Hinweise."
    >
      {threads.map((thread) => (
        <ThreadBlock key={thread.id} thread={thread} story={story} />
      ))}
      <NewLine
        label="Neue Frage"
        placeholder={threads.length ? 'Eine weitere Frage' : 'Die Frage, in einem Satz'}
        mention={mention}
        onAdd={(title) =>
          saveThread(db, {
            title,
            truth: '',
            state: 'open',
            storyId: story.id,
            refs: [],
            known: false,
            hints: [],
          })
        }
      />
      {ready.length > 0 && (
        <div className="wf-faden-fits">
          <div className="wf-faden-frage__sub">
            <span>Für den Abend bereit</span>
            <Link href="/abend" className="wf-faden-link">
              Abend vorbereiten …
            </Link>
          </div>
          {ready.map(({ secret, which }) => (
            <span key={secret.id} className="wf-faden-bereit">
              {secret.text}
              <em>
                {' '}
                – Geheimnis auf dem Blatt für {which === 'now' ? 'diesen' : 'den nächsten'} Abend
              </em>
            </span>
          ))}
        </div>
      )}
      <LooseFits story={story} questions={threads.filter(threadLive)} />
    </SheetSection>
  );
}

function ThreadBlock({ thread, story }: { thread: Thread; story: Story }) {
  const db = useDb();
  const data = useData();
  const onEvening = useMemo(() => hintsOnEvening(data), [data]);
  const mention = useStoryMention(story);
  const patch = (change: Parameters<typeof patchThread>[2]) => patchThread(db, thread.id, change);
  const hints = useDraftList<ThreadHint>(
    thread.hints,
    (items) => patch({ hints: items }),
    (hint) => !hint.text.trim(),
  );
  const note = threadLive(thread)
    ? hintsNote(thread.hints.filter((hint) => hint.text.trim()).length)
    : null;
  const remove = async () => {
    const ok = await confirmDialog({
      title: `„${thread.title}“ löschen?`,
      body: 'Die Frage und ihre Hinweise verschwinden.',
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (ok) removeThread(db, thread.id);
  };
  const loosen = () => {
    const undo = moveThread(db, thread.id, null);
    if (undo)
      toast({
        title: 'Von der Geschichte gelöst',
        body: `„${thread.title}“ steht jetzt am Fadenbrett unter „Lose Fäden“.`,
        action: { label: 'Rückgängig', run: undo },
      });
  };
  return (
    <div className={cx('wf-faden-frage', `wf-faden-thread--${thread.state}`)}>
      <div className="wf-faden-frage__head">
        <Written
          className="wf-faden-frage__title"
          label="Die Frage"
          wrap
          value={thread.title}
          mention={mention}
          onSave={(title) => patch({ title })}
        />
        <Select
          value={thread.state}
          aria-label="Zustand der Frage"
          title={THREAD_STATE_HINT[thread.state]}
          onChange={(event) => patch({ state: event.target.value as ThreadState })}
        >
          {THREAD_STATES.map((state) => (
            <option key={state} value={state}>
              {THREAD_STATE_LABEL[state]}
            </option>
          ))}
        </Select>
        <IconButton
          label="Von der Geschichte lösen – die Frage wird ein loser Faden"
          size="sm"
          variant="ghost"
          onClick={loosen}
        >
          <Unlink />
        </IconButton>
        <IconButton label="Frage löschen" size="sm" variant="ghost" onClick={remove}>
          <Trash2 />
        </IconButton>
      </div>
      <Written
        label="Was dahintersteckt"
        grow
        value={thread.truth}
        placeholder="Die Antwort – das siehst nur du."
        mention={mention}
        onSave={(truth) => patch({ truth })}
      />
      <div className="wf-faden-frage__hints">
        <div className="wf-faden-frage__sub">
          <span>Hinweise</span>
          {note && (
            <span className={note.thin ? 'wf-faden-frage__thin' : 'wf-faden-frage__fine'}>
              {note.thin && <TriangleAlert aria-hidden />}
              {note.text}
            </span>
          )}
        </div>
        {hints.items.map((hint) => (
          <div key={hint.id} className="wf-sheet-list__row wf-sheet-list__row--hint">
            <Checkbox checked={hint.found} onChange={(found) => hints.set(hint.id, { found })}>
              <span className="wf-sheet-list__sr">Die Gruppe hat den Hinweis</span>
            </Checkbox>
            <Written
              label="Hinweis"
              wrap
              value={hint.text}
              mention={mention}
              onSave={(text) => hints.set(hint.id, { text })}
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
            {onEvening.has(`${thread.id}:${hint.id}`) && (
              <Link
                href="/abend"
                className="wf-faden-abend"
                title="Dieser Hinweis liegt als Geheimnis auf dem Blatt des Abends – aufgedeckt heißt hier gefunden"
              >
                liegt auf dem Abend-Blatt
              </Link>
            )}
          </div>
        ))}
        <NewLine
          className="wf-faden-frage__new"
          label={newHintLabel(thread.title)}
          placeholder="Was die Gruppe findet oder erfährt"
          mention={mention}
          onAdd={(text) =>
            patch({
              hints: [
                ...thread.hints,
                { id: newId(), text, placeId: null, sourceId: null, found: false },
              ],
            })
          }
        />
        <Checkbox checked={thread.known} onChange={(known) => patch({ known })}>
          Die Gruppe kennt diese Frage
        </Checkbox>
      </div>
    </div>
  );
}

/** Lose Fäden, die zu dieser Geschichte passen könnten – zum Hereinholen. */
function LooseFits({ story, questions }: { story: Story; questions: readonly Thread[] }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const fits = threadFits(data, story);
  const loose = Object.values(data.threads).filter(
    (thread) => isLooseThread(data, thread) && threadLive(thread),
  ).length;
  if (!loose) return null;
  const done = (title: string, body: string, undo: (() => void) | null) => {
    if (undo) toast({ title, body, action: { label: 'Rückgängig', run: undo } });
  };
  const asQuestion = ({ thread }: ThreadFit) =>
    done(
      'Als Frage übernommen',
      `„${thread.title}“ gehört jetzt zu dieser Geschichte.`,
      moveThread(db, thread.id, story.id),
    );
  const asHint = ({ thread }: ThreadFit, questionId: string) =>
    done(
      'Als Hinweis übernommen',
      `„${thread.title}“ ist jetzt ein Hinweis zu „${data.threads[questionId]?.title ?? ''}“. Den losen Faden gibt es nicht mehr.`,
      threadToHint(db, thread.id, questionId),
    );
  const asEntry = ({ thread }: ThreadFit) =>
    done(
      'Als Einstieg übernommen',
      `„${thread.title}“ ist jetzt ein Einstieg. Den losen Faden gibt es nicht mehr.`,
      threadToEntry(db, thread.id, story.id),
    );
  return (
    <div className="wf-faden-fits">
      <div className="wf-faden-frage__sub">
        <span>Lose Fäden, die passen könnten</span>
        <button type="button" className="wf-faden-link" onClick={() => navigate('/faeden')}>
          Alle losen Fäden …
        </button>
      </div>
      {fits.length === 0 && (
        <p className="wf-sheet__none">
          Keiner der losen Fäden nennt einen Namen dieser Geschichte.
        </p>
      )}
      {fits.slice(0, FITS_SHOWN).map((fit) => (
        <div key={fit.thread.id} className="wf-faden-fit">
          <span className="wf-faden-fit__title">
            {fit.thread.title} <em>– {fit.reason}</em>
          </span>
          <span className="wf-faden-fit__acts">
            <Button size="sm" onClick={() => asQuestion(fit)}>
              als Frage übernehmen
            </Button>
            {questions.length > 0 && (
              <Select
                value=""
                aria-label={`„${fit.thread.title}“ als Hinweis zu einer Frage übernehmen`}
                onChange={(event) => event.target.value && asHint(fit, event.target.value)}
              >
                <option value="">als Hinweis zu …</option>
                {questions.map((question) => (
                  <option key={question.id} value={question.id}>
                    {question.title}
                  </option>
                ))}
              </Select>
            )}
            <Button size="sm" variant="ghost" onClick={() => asEntry(fit)}>
              als Einstieg
            </Button>
          </span>
        </div>
      ))}
      {fits.length > FITS_SHOWN && (
        <p className="wf-sheet__none">
          Und {fits.length - FITS_SHOWN} weitere – am Fadenbrett stehen alle unter „Lose Fäden“.
        </p>
      )}
    </div>
  );
}
