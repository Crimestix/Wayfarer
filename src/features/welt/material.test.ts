/** F05: Material anheften, öffnen, Rückweg – nur Verweise, mit Rückgängig. */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { newStory } from '../faeden/actions';
import { materialChoices, materialOf, pinMaterial, pinnedIn, unpinMaterial } from './material';
import { newEntry, startFreeText } from './writing';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  return { db, data: () => db.getSnapshot() };
}

describe('F05: die Mappe', () => {
  it('heftet Geschichte und Eintrag an einen freien Text, mit Rückweg und Rückgängig', async () => {
    const { db, data } = await setup();
    const outline = startFreeText(db, 'Reise nach Norden')!.article!;
    const story = newStory(db, { title: 'Die Fähre' });
    const mara = newEntry(db, { name: 'Mara Fenn', kind: 'person', withText: true })!;
    const owner = { type: 'article' as const, id: outline.id };

    const undo = pinMaterial(db, owner, { type: 'story', id: story.id })!;
    // Der Text eines Eintrags zählt als der Eintrag.
    pinMaterial(db, owner, { type: 'article', id: mara.article!.id });
    // Nie doppelt, nie sich selbst.
    expect(pinMaterial(db, owner, { type: 'entity', id: mara.entity!.id })).toBeNull();
    expect(pinMaterial(db, owner, { type: 'article', id: outline.id })).toBeNull();

    const items = materialOf(data(), owner);
    expect(items.map((i) => [i.label, i.title, i.href])).toEqual([
      ['Geschichte', 'Die Fähre', `/geschichte/${story.id}`],
      ['Person', 'Mara Fenn', `/welt/${mara.entity!.id}`],
    ]);
    expect(pinnedIn(data(), { type: 'story', id: story.id }).map((i) => i.title)).toEqual([
      'Reise nach Norden',
    ]);

    undo();
    expect(materialOf(data(), owner).map((i) => i.title)).toEqual(['Mara Fenn']);
    const back = unpinMaterial(db, owner, { type: 'entity', id: mara.entity!.id });
    expect(materialOf(data(), owner)).toEqual([]);
    back();
    expect(materialOf(data(), owner).map((i) => i.title)).toEqual(['Mara Fenn']);
    // Das Material selbst bleibt immer bestehen.
    expect(data().stories[story.id]).toBeDefined();
  });

  it('eine Geschichte trägt ebenso eine Mappe; zur Wahl steht alles', async () => {
    const { db, data } = await setup();
    const story = newStory(db, { title: 'Die Fähre' });
    const outline = startFreeText(db, 'Reise nach Norden')!.article!;
    pinMaterial(db, { type: 'story', id: story.id }, { type: 'article', id: outline.id });
    expect(materialOf(data(), { type: 'story', id: story.id }).map((i) => i.label)).toEqual([
      'Text',
    ]);
    const labels = new Set(materialChoices(data()).map((i) => i.label));
    expect(labels.has('Geschichte') && labels.has('Text')).toBe(true);
  });
});
