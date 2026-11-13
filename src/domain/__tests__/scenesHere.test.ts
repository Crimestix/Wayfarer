import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { patchPrep, setSceneDone } from '../../features/abend/actions';
import { newStory, patchStory } from '../../features/faeden/actions';
import { scenesHere } from '../scenesHere';
import { createEntity, newId } from '../schema';

/** Hohenfurt mit dem Markt darin, und die Salzgrotte – erfunden. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const town = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const market = db.put(
    'entities',
    createEntity({ kind: 'place', name: 'Markt', place: { parentId: town.id } } as never),
  );
  const grotto = db.put('entities', createEntity({ kind: 'place', name: 'Salzgrotte' }));
  return { db, town, market, grotto, data: () => db.getSnapshot() };
}

describe('Szenen am Ort der Gruppe', () => {
  it('zeigt Szenen des Abends und der Geschichten, die hier spielen können', async () => {
    const { db, town, market, grotto, data } = await setup();
    const here = newId();
    const there = newId();
    patchPrep(db, {
      scenes: [
        { id: here, text: 'Ein leeres Boot treibt heran', done: false, placeId: market.id },
        { id: there, text: 'Steinschlag', done: false, placeId: grotto.id },
        { id: newId(), text: 'Ohne Ort', done: false, placeId: null },
      ],
    });
    const story = newStory(db);
    patchStory(db, story.id, {
      title: 'Die Aalfischer schweigen',
      scenes: [
        {
          id: newId(),
          text: 'Mira bittet um Hilfe',
          encounterId: null,
          odds: 'sure',
          placeId: town.id,
        },
      ],
    });
    // Ohne Ort der Gruppe: nichts.
    db.setState({ placeId: null });
    expect(scenesHere(data())).toEqual([]);

    // Auf dem Markt: die Szene am Markt und die in Hohenfurt (darüber) – die sichere zuerst.
    db.setState({ placeId: market.id });
    expect(scenesHere(data()).map((scene) => [scene.text, scene.from])).toEqual([
      ['Mira bittet um Hilfe', 'story'],
      ['Ein leeres Boot treibt heran', 'prep'],
    ]);

    // Gespielt fällt weg; eine abgeschlossene Geschichte auch.
    setSceneDone(db, here, true);
    patchStory(db, story.id, { closed: true });
    expect(scenesHere(data())).toEqual([]);

    db.setState({ placeId: grotto.id });
    expect(scenesHere(data()).map((scene) => scene.text)).toEqual(['Steinschlag']);
  });
});
