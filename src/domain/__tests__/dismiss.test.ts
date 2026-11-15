import { describe, expect, it } from 'vitest';
import { dismissSuggestion, restoreSuggestions } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { demoCampaign } from '../../data/__fixtures__/demoWorld';
import { MemoryStore } from '../../data/store';
import { entitiesOfKind } from '../derive';
import { SUGGESTION, dismissedSorts, isDismissed, withoutDismissed } from '../dismiss';
import { storyFits } from '../looseThreads';
import { placeOffers } from '../prepOffers';
import { roomCandidates } from '../rooms';
import { createEntity, createStory, createThread } from '../schema';
import { threadFits } from '../storySheet';
import { EMPTY_PREP } from '../prep';

async function demoDb() {
  return CampaignDb.create(new MemoryStore(), demoCampaign());
}

describe('Vorschläge wegklicken', () => {
  it('merkt, holt zurück und nimmt zurück', async () => {
    const db = await demoDb();
    const undo = dismissSuggestion(db, SUGGESTION.room('ort1'));
    dismissSuggestion(db, SUGGESTION.fit('f1', 's1'));
    expect(isDismissed(db.getSnapshot(), 'room:ort1')).toBe(true);
    expect(dismissedSorts(db.getSnapshot()).map((s) => [s.sort, s.count])).toEqual([
      ['room', 1],
      ['fit', 1],
    ]);
    undo();
    expect(isDismissed(db.getSnapshot(), 'room:ort1')).toBe(false);
    const back = restoreSuggestions(db, 'fit');
    expect(db.getSnapshot().state.dismissed).toEqual([]);
    back();
    expect(db.getSnapshot().state.dismissed).toEqual(['fit:f1:s1']);
    expect(withoutDismissed(db.getSnapshot(), ['f1', 'f2'], (id) => `fit:${id}:s1`)).toEqual([
      'f2',
    ]);
  });

  it('ein weggeklickter Faden passt nicht mehr – auf dem Brett und auf dem Blatt', async () => {
    const db = await demoDb();
    const voss = entitiesOfKind(db.getSnapshot(), 'person').find(
      (p) => p.name === 'Hauptmann Voss',
    )!;
    const story = db.put('stories', createStory({ title: 'Die Zollkette', refs: [voss.id] }));
    const thread = db.put('threads', createThread({ title: 'Wer zahlt Voss?', refs: [voss.id] }));
    const has = () => ({
      sheet: threadFits(db.getSnapshot(), story).some((fit) => fit.thread.id === thread.id),
      board: storyFits(db.getSnapshot(), thread).some((fit) => fit.story.id === story.id),
    });
    expect(has()).toEqual({ sheet: true, board: true });
    dismissSuggestion(db, SUGGESTION.fit(thread.id, story.id));
    expect(has()).toEqual({ sheet: false, board: false });
  });

  it('Räume: ein weggeklickter Ort bietet keine mehr an', async () => {
    const db = await demoDb();
    const burg = db.put('entities', createEntity({ kind: 'place', name: 'Burg' }));
    db.put(
      'entities',
      createEntity({
        kind: 'place',
        name: 'Halle',
        place: { parentId: burg.id, category: 'Raum' },
      }),
    );
    expect(roomCandidates(db.getSnapshot(), burg.id)).toHaveLength(1);
    dismissSuggestion(db, SUGGESTION.room(burg.id));
    expect(roomCandidates(db.getSnapshot(), burg.id)).toHaveLength(0);
  });

  it('Abend vorbereiten: ein weggeklickter Ort wird nicht mehr angeboten', async () => {
    const db = await demoDb();
    const offers = placeOffers(db.getSnapshot(), EMPTY_PREP);
    expect(offers.length).toBeGreaterThan(0);
    const first = offers[0]!.place.id;
    dismissSuggestion(db, SUGGESTION.prep('place', first));
    expect(placeOffers(db.getSnapshot(), EMPTY_PREP).some((o) => o.place.id === first)).toBe(false);
  });
});
