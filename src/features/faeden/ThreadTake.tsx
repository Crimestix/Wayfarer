/**
 * Einen losen Faden in eine Geschichte holen – so, wie er gemeint ist: als Ort, Person … der
 * Geschichte, als Szene, als Frage, als Hinweis zu einer Frage oder als Einstieg. Dieselben
 * Knöpfe am Fadenbrett („An Geschichte hängen“) und auf dem Blatt der Geschichte.
 */
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import { CREATE_KINDS } from '../../domain/pick';
import type { EntityKind, Story, Thread } from '../../domain/schema';
import { Button, Select } from '../../ui';
import { moveThread, threadToCast, threadToEntry, threadToHint, threadToScene } from './actions';
import { threadIsName, threadNames } from './attach';

export function ThreadTake({
  thread,
  story,
  questions,
  onDone,
}: {
  thread: Thread;
  story: Story;
  /** Die offenen Fragen der Geschichte – für „als Hinweis zu …“. */
  questions: readonly Thread[];
  onDone: (title: string, body: string, undo: (() => void) | null) => void;
}) {
  const db = useDb();
  const data = useData();
  const named = threadNames(data, thread);
  const isName = threadIsName(data, thread);
  const staysWithHints = thread.hints.length
    ? ' Mit seinen Hinweisen bleibt er auch als Frage dort.'
    : '';

  const asCast = (value: string) => {
    const [how, what] = value.split(':') as [string, string];
    const result = threadToCast(
      db,
      thread.id,
      story.id,
      how === 'id' ? { entityId: what } : { kind: what as EntityKind },
    );
    if (!result) return;
    onDone(
      'Gehört jetzt dazu',
      `${result.entity.name}${result.created ? ` (neu, ${KIND_LABEL[result.entity.kind]})` : ''} gehört jetzt zu „${story.title}“.${staysWithHints}`,
      result.undo,
    );
  };

  return (
    <>
      <Select
        value=""
        aria-label={`„${thread.title}“ als Ort, Person … zu „${story.title}“ nehmen`}
        onChange={(event) => event.target.value && asCast(event.target.value)}
      >
        <option value="">als Ort, Person … dazu</option>
        {named.map((entity) => (
          <option key={entity.id} value={`id:${entity.id}`}>
            {entity.name} ({KIND_LABEL[entity.kind]})
          </option>
        ))}
        {!isName &&
          CREATE_KINDS.map((kind) => (
            <option key={kind} value={`new:${kind}`}>
              „{thread.title}“ neu als {KIND_LABEL[kind]}
            </option>
          ))}
      </Select>
      <Button
        size="sm"
        onClick={() =>
          onDone(
            'Als Szene übernommen',
            `„${thread.title}“ ist jetzt eine Szene von „${story.title}“.${staysWithHints}`,
            threadToScene(db, thread.id, story.id),
          )
        }
      >
        als Szene
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          onDone(
            'Als Frage übernommen',
            `„${thread.title}“ ist jetzt eine Frage von „${story.title}“.`,
            moveThread(db, thread.id, story.id),
          )
        }
      >
        als Frage
      </Button>
      {questions.length > 0 && (
        <Select
          value=""
          aria-label={`„${thread.title}“ als Hinweis zu einer Frage von „${story.title}“ übernehmen`}
          onChange={(event) => {
            const questionId = event.target.value;
            if (!questionId) return;
            onDone(
              'Als Hinweis übernommen',
              `„${thread.title}“ ist jetzt ein Hinweis zu „${data.threads[questionId]?.title ?? ''}“. Den losen Faden gibt es nicht mehr.`,
              threadToHint(db, thread.id, questionId),
            );
          }}
        >
          <option value="">als Hinweis zu …</option>
          {questions.map((question) => (
            <option key={question.id} value={question.id}>
              {question.title}
            </option>
          ))}
        </Select>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          onDone(
            'Als Einstieg übernommen',
            `„${thread.title}“ ist jetzt ein Einstieg von „${story.title}“. Den losen Faden gibt es nicht mehr.`,
            threadToEntry(db, thread.id, story.id),
          )
        }
      >
        als Einstieg
      </Button>
    </>
  );
}
