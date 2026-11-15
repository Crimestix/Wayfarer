import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { demoCampaign } from '../../data/__fixtures__/demoWorld';
import { MemoryStore } from '../../data/store';
import { entitiesOfKind } from '../../domain/derive';
import { createStory, createThread } from '../../domain/schema';
import { threadToCast, threadToScene } from './actions';
import { threadIsName, threadNames } from './attach';

async function setup(title: string, extra: Partial<Parameters<typeof createThread>[0]> = {}) {
  const db = await CampaignDb.create(new MemoryStore(), demoCampaign());
  const story = db.put('stories', createStory({ title: 'Die Belagerung' }));
  const thread = db.put('threads', createThread({ title, ...extra }));
  return { db, story, thread };
}

describe('Fäden, die zu einer Geschichte gehören', () => {
  it('erkennt den Eintrag, der so heißt wie der Faden, und Namen im Satz', async () => {
    const { db, thread } = await setup('Dornhafen');
    const data = db.getSnapshot();
    expect(threadIsName(data, thread)).toBe(true);
    expect(threadNames(data, thread).map((e) => e.name)).toEqual(['Dornhafen']);
    const other = db.put('threads', createThread({ title: 'Kriegslager der Duergar' }));
    expect(threadIsName(db.getSnapshot(), other)).toBe(false);
    expect(threadNames(db.getSnapshot(), other)).toEqual([]);
  });

  it('nimmt einen vorhandenen Eintrag zu den Beteiligten, der Faden geht', async () => {
    const { db, story, thread } = await setup('Dornhafen');
    const hafen = entitiesOfKind(db.getSnapshot(), 'place').find((p) => p.name === 'Dornhafen')!;
    const result = threadToCast(db, thread.id, story.id, { entityId: hafen.id })!;
    let data = db.getSnapshot();
    expect(result.created).toBe(false);
    expect(data.stories[story.id]!.refs).toContain(hafen.id);
    expect(data.threads[thread.id]).toBeUndefined();
    result.undo();
    data = db.getSnapshot();
    expect(data.stories[story.id]!.refs).not.toContain(hafen.id);
    expect(data.threads[thread.id]).toBeDefined();
  });

  it('legt einen neuen Namen als Platzhalter der Geschichte an, mit dem Geheimnis des Fadens', async () => {
    const { db, story, thread } = await setup('Kriegslager der Duergar', {
      truth: 'Dort liegt die Karte.',
    });
    const result = threadToCast(db, thread.id, story.id, { kind: 'place' })!;
    const data = db.getSnapshot();
    const camp = data.entities[result.entity.id]!;
    expect(result.created).toBe(true);
    expect(camp.kind).toBe('place');
    expect(camp.stub).toBe(true);
    expect(camp.secret).toBe('Dort liegt die Karte.');
    expect(data.stories[story.id]!.refs).toContain(camp.id);
    result.undo();
    expect(db.getSnapshot().entities[camp.id]).toBeUndefined();
    expect(db.getSnapshot().threads[thread.id]).toBeDefined();
  });

  it('macht einen Faden zur Szene, mit Ort', async () => {
    const { db, story } = await setup('egal');
    const hafen = entitiesOfKind(db.getSnapshot(), 'place').find((p) => p.name === 'Dornhafen')!;
    const thread = db.put(
      'threads',
      createThread({ title: 'Überfall am Kai', refs: [hafen.id], truth: 'Bezahlt von Voss' }),
    );
    const undo = threadToScene(db, thread.id, story.id)!;
    const scene = db.getSnapshot().stories[story.id]!.scenes.at(-1)!;
    expect(scene).toMatchObject({ text: 'Überfall am Kai – Bezahlt von Voss', placeId: hafen.id });
    expect(db.getSnapshot().threads[thread.id]).toBeUndefined();
    undo();
    expect(db.getSnapshot().stories[story.id]!.scenes).toHaveLength(0);
  });

  it('lässt Hinweise nie verloren gehen: der Faden bleibt dann als Frage', async () => {
    const { db, story } = await setup('egal');
    const thread = db.put(
      'threads',
      createThread({
        title: 'Wer hat das Tor geöffnet?',
        hints: [
          { id: 'h1', text: 'Ein Schlüssel fehlt', placeId: null, sourceId: null, found: false },
        ],
      }),
    );
    threadToScene(db, thread.id, story.id);
    expect(db.getSnapshot().threads[thread.id]?.storyId).toBe(story.id);
  });
});
