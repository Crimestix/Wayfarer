/** F02: Eine Geschichte ist zuerst eine freie Arbeitsfläche; Stand und Rat sind zuschaltbar. */
import { describe, expect, it } from 'vitest';
import { createStory, StorySchema } from '../../domain/schema';

describe('F02: Hinweise zur Form', () => {
  it('sind bei einer neuen Geschichte aus', () => {
    expect(createStory({ title: 'Reise nach Norden' }).guide).toBe(false);
  });
  it('ältere Geschichten ohne die Angabe lesen sich ebenso ohne Hinweise', () => {
    const story = createStory({ title: 'Alt' });
    const { guide: _guide, ...stored } = story;
    expect(StorySchema.parse(stored).guide).toBe(false);
  });
});
