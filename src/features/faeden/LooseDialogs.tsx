/**
 * Die beiden Fenster der Liste „Lose Fäden“: Fäden an eine Geschichte hängen (die passenden
 * Geschichten zuerst; ein einzelner Faden so, wie er gemeint ist – als Ort, Person …, Szene,
 * Frage, Hinweis oder Einstieg, `ThreadTake`) und
 * eine neue Geschichte aus Fäden machen – ihren Namen schreibt der Spielleiter.
 */
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useData, useDb } from '../../data/hooks';
import { filterStoryChoices, storyChoices, type StoryChoice } from '../../domain/looseThreads';
import type { Story, Thread } from '../../domain/schema';
import { threadLive, threadsOf } from '../../domain/story';
import { Button, Dialog, Field, Input, toast } from '../../ui';
import { moveThreads, storyFromThreads } from './actions';
import { ThreadTake } from './ThreadTake';

/** Ab so vielen Geschichten hilft ein Suchfeld. */
const SEARCH_FROM = 8;
/** So viele Sätze nennt das Fenster, bevor es zählt. */
const TITLES_SHOWN = 5;

const present = (threads: readonly (Thread | undefined)[]): Thread[] =>
  threads.filter((thread): thread is Thread => thread !== undefined);

export function AttachDialog({
  ids,
  onClose,
  onDone,
}: {
  ids: readonly string[];
  onClose: () => void;
  /** Etwas ist geschehen: Das Fenster schließt, die Auswahl ist erledigt. */
  onDone: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [query, setQuery] = useState('');
  const threads = useMemo(() => present(ids.map((id) => data.threads[id])), [ids, data.threads]);
  const choices = useMemo(() => storyChoices(data, threads), [data, threads]);
  const shown = filterStoryChoices(data, choices, query);
  const fits = shown.filter((choice) => choice.count > 0);
  const others = shown.filter((choice) => choice.count === 0);
  const single = threads.length === 1 ? threads[0]! : null;

  const done = (title: string, body: string, undo: (() => void) | null) => {
    if (!undo) return;
    toast({ title, body, action: { label: 'Rückgängig', run: undo } });
    onDone();
  };
  const asQuestions = (story: Story) =>
    done(
      'An die Geschichte gehängt',
      single
        ? `„${single.title}“ ist jetzt eine Frage von „${story.title}“.`
        : `${threads.length} Fäden sind jetzt Fragen von „${story.title}“.`,
      moveThreads(
        db,
        threads.map((thread) => thread.id),
        story.id,
      ),
    );
  const row = ({ story, reason }: StoryChoice) => {
    const owner = story.ownerId ? data.entities[story.ownerId] : undefined;
    const questions = single ? threadsOf(data, story.id).filter(threadLive) : [];
    return (
      <div key={story.id} className="wf-faden-attach__row">
        <div className="wf-faden-attach__what">
          <span className="wf-faden-attach__title">{story.title}</span>
          {reason && <em>{reason}</em>}
          {!reason && owner && <span className="wf-mute">Treibt an: {owner.name}</span>}
        </div>
        <div className="wf-faden-attach__acts">
          {single ? (
            <ThreadTake thread={single} story={story} questions={questions} onDone={done} />
          ) : (
            <Button size="sm" onClick={() => asQuestions(story)}>
              als Fragen
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      guard={false}
      width={640}
      title={
        single
          ? 'Faden an eine Geschichte hängen'
          : `${threads.length} Fäden an eine Geschichte hängen`
      }
      footer={
        <Button variant="ghost" onClick={onClose}>
          Abbrechen
        </Button>
      }
    >
      <div className="wf-col wf-faden-attach">
        <Titles threads={threads} />
        {choices.length === 0 ? (
          <p className="wf-mute">
            Noch keine Geschichte, an die sich ein Faden hängen ließe. Mit „Neue Geschichte daraus“
            entsteht eine aus diesen Fäden.
          </p>
        ) : (
          <>
            {choices.length > SEARCH_FROM && (
              <Input
                value={query}
                autoFocus
                placeholder="Geschichte suchen"
                aria-label="Geschichte suchen"
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
            {fits.length > 0 && (
              <section>
                <h3 className="wf-faden-side__sub">Könnte passen</h3>
                {fits.map(row)}
              </section>
            )}
            {others.length > 0 && (
              <section>
                <h3 className="wf-faden-side__sub">
                  {fits.length > 0 ? 'Alle übrigen Geschichten' : 'Geschichten'}
                </h3>
                {others.map(row)}
              </section>
            )}
            {shown.length === 0 && <p className="wf-mute">Keine Geschichte heißt so.</p>}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Die Sätze der gewählten Fäden – damit klar ist, worum es geht. */
function Titles({ threads }: { threads: readonly Thread[] }) {
  return (
    <ul className="wf-faden-attach__titles">
      {threads.slice(0, TITLES_SHOWN).map((thread) => (
        <li key={thread.id}>{thread.title}</li>
      ))}
      {threads.length > TITLES_SHOWN && (
        <li className="wf-mute">und {threads.length - TITLES_SHOWN} weitere</li>
      )}
    </ul>
  );
}

export function NewStoryDialog({
  ids,
  onClose,
  onDone,
}: {
  ids: readonly string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const [title, setTitle] = useState('');
  const threads = present(ids.map((id) => data.threads[id]));
  const create = () => {
    const made = storyFromThreads(
      db,
      threads.map((thread) => thread.id),
      title,
    );
    if (!made) return onClose();
    onDone();
    toast({
      title: 'Geschichte angelegt',
      body:
        threads.length === 1
          ? `„${threads[0]!.title}“ ist ihre erste Frage.`
          : `${threads.length} Fäden sind ihre Fragen.`,
      action: {
        label: 'Rückgängig',
        run: () => {
          made.undo();
          // Zurück ans Brett – aber nur von ihrem Blatt aus, das es jetzt nicht mehr gibt.
          if (window.location.hash.includes(`/geschichte/${made.story.id}`)) navigate('/faeden');
        },
      },
    });
    navigate(`/geschichte/${made.story.id}`);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      width={520}
      title={
        threads.length === 1
          ? 'Neue Geschichte aus diesem Faden'
          : 'Neue Geschichte aus diesen Fäden'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={create}>
            Anlegen und Blatt öffnen
          </Button>
        </>
      }
    >
      <div className="wf-col wf-faden-attach">
        <Titles threads={threads} />
        <Field
          label="Name der Geschichte"
          hint="Ohne Namen heißt sie vorerst „Neue Geschichte“ – auf ihrem Blatt lässt er sich jederzeit ändern."
        >
          <Input
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') create();
            }}
          />
        </Field>
        <p className="wf-mute">
          {threads.length === 1 ? 'Der Faden wird ihre Frage' : 'Die Fäden werden ihre Fragen'};
          woran {threads.length === 1 ? 'er hängt' : 'sie hängen'}, gehört zu den Beteiligten. Alles
          Weitere schreibst du auf ihrem Blatt.
        </p>
      </div>
    </Dialog>
  );
}
