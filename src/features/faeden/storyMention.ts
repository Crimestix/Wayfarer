/**
 * „@“ in den Textfeldern des Blatts einer Geschichte: Wer so erwähnt wird, gehört danach zur
 * Geschichte; was es noch nicht gibt, entsteht als Platzhalter aus dieser Geschichte. Ohne
 * Suchwort stehen zuerst die da, die schon dazugehören.
 */
import { useMemo } from 'react';
import { useData, useDb } from '../../data/hooks';
import type { Story } from '../../domain/schema';
import { storyAttached } from '../../domain/story';
import type { MentionOptions } from '../../ui';
import { attachToStory } from './actions';

export function useStoryMention(story: Story): MentionOptions {
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
