/**
 * Die Wahl „Gehört zur Geschichte“ für einen Faden – überall dieselbe: „keine“ zuerst (dann ist er
 * ein loser Faden), darunter die Geschichten, zu denen er passen könnte, mit ihrem Grund, dann
 * alle übrigen. Genutzt beim Schreiben eines Fadens, beim Annehmen aus nachgetragenen Notizen
 * und beim KI-Leser. Welche passen, sagt `storyChoices` (`domain/looseThreads.ts`).
 */
import { useMemo } from 'react';
import { useData } from '../../data/hooks';
import { storyChoices, type ThreadLike } from '../../domain/looseThreads';
import { Select } from '../../ui';

export function StorySelect({
  thread,
  value,
  onChange,
  label = 'Geschichte',
}: {
  /** Der Faden, wie er gerade dasteht – auch einer, den es noch nicht gibt. */
  thread: ThreadLike;
  value: string | null;
  onChange: (storyId: string | null) => void;
  label?: string;
}) {
  const data = useData();
  const choices = useMemo(() => storyChoices(data, [thread]), [data, thread]);
  const fits = choices.filter((choice) => choice.count > 0);
  const others = choices.filter((choice) => choice.count === 0);
  // Eine Geschichte, die nicht (mehr) zur Wahl steht – etwa eine zu Ende erzählte –, bleibt stehen.
  const kept =
    value && !choices.some((choice) => choice.story.id === value) ? data.stories[value] : undefined;
  return (
    <Select
      value={value ?? ''}
      aria-label={label}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">keine – loser Faden</option>
      {kept && <option value={kept.id}>{kept.title}</option>}
      {fits.length > 0 && (
        <optgroup label="Könnte passen">
          {fits.map(({ story, reason }) => (
            <option key={story.id} value={story.id}>
              {story.title} – {reason}
            </option>
          ))}
        </optgroup>
      )}
      {fits.length > 0 ? (
        <optgroup label="Alle übrigen">
          {others.map(({ story }) => (
            <option key={story.id} value={story.id}>
              {story.title}
            </option>
          ))}
        </optgroup>
      ) : (
        others.map(({ story }) => (
          <option key={story.id} value={story.id}>
            {story.title}
          </option>
        ))
      )}
    </Select>
  );
}
