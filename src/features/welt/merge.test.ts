import { describe, expect, it } from 'vitest';
import { dismissSuggestion, moveParty } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity, createRelation, type Place } from '../../domain/schema';
import { liesIn } from '../../domain/worlds';
import { createArticleOfKind } from '../wiki/actions';
import { pageText } from '../wiki/text';
import { mergeEntities, nameTwins, referencesTo } from './merge';
import type { WorldEntity } from './model';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const put = (entity: ReturnType<typeof createEntity>) =>
    db.put('entities', entity) as WorldEntity;
  return { db, data: () => db.getSnapshot(), put };
}

const textOf = (db: CampaignDb, articleId: string) => {
  const data = db.getSnapshot();
  const article = data.articles[articleId]!;
  return pageText(
    data.articles,
    article,
    article.docs.find((doc) => doc.kind === 'page')!,
  );
};

describe('Zusammenlegen', () => {
  it('lässt alles, was auf den anderen zeigte, auf den Bleibenden zeigen', async () => {
    const { db, data, put } = await setup();
    const keep = put(
      createEntity({
        kind: 'place',
        name: 'Aurelis',
        tagline: 'Die Welt der Spieler',
        tags: ['welt'],
      }),
    );
    const drop = put(
      createEntity({
        kind: 'place',
        name: 'aurelis',
        notes: 'Alter Ordner.',
        secret: 'Hier schläft etwas.',
        tags: ['ordner'],
        aliases: ['Die Scherbe'],
      }),
    );
    const town = put(
      createEntity({ kind: 'place', name: 'Grauhafen', place: { parentId: drop.id } }),
    ) as Place;
    const person = put(
      createEntity({
        kind: 'person',
        name: 'Tomas',
        person: { placeId: drop.id, homeId: drop.id },
      }),
    );
    db.put('relations', createRelation({ from: person.id, to: drop.id, type: 'knows' }));
    moveParty(db, drop.id);
    expect(referencesTo(data(), drop.id)).toBeGreaterThanOrEqual(3);

    const result = mergeEntities(db, keep.id, drop.id)!;
    expect(result.keepId).toBe(keep.id);
    expect(data().entities[drop.id]).toBeUndefined();
    expect(data().entities[keep.id]).toMatchObject({
      name: 'Aurelis',
      tagline: 'Die Welt der Spieler',
      notes: 'Alter Ordner.',
      secret: 'Hier schläft etwas.',
      tags: ['welt', 'ordner'],
      // Der gleiche Name wird kein Beiname, die Beinamen des anderen kommen mit.
      aliases: ['Die Scherbe'],
    });
    expect((data().entities[town.id] as Place).place.parentId).toBe(keep.id);
    expect(data().entities[person.id]).toMatchObject({
      person: { placeId: keep.id, homeId: keep.id },
    });
    expect(Object.values(data().relations).map((r) => r.to)).toEqual([keep.id]);
    expect(data().state.placeId).toBe(keep.id);
    expect(
      Object.values(data().chronicle).every((entry) => !JSON.stringify(entry).includes(drop.id)),
    ).toBe(true);

    // Rückgängig: beide stehen wieder da, wie sie waren.
    result.undo();
    expect(data().entities[drop.id]).toMatchObject({ name: 'aurelis', notes: 'Alter Ordner.' });
    expect(data().entities[keep.id]).toMatchObject({ notes: '', aliases: [] });
    expect((data().entities[town.id] as Place).place.parentId).toBe(drop.id);
    expect(data().state.placeId).toBe(drop.id);
  });

  it('legt den Text des anderen unter den des Bleibenden und hängt seine Unterartikel um', async () => {
    const { db, data } = await setup();
    const kept = createArticleOfKind(db, {
      title: 'Aurelis',
      parentId: null,
      kind: 'celestial',
      scaffold: false,
    })!;
    const folder = createArticleOfKind(db, {
      title: 'Aurelis (Ordner)',
      parentId: null,
      kind: 'place',
      scaffold: false,
    })!;
    const child = createArticleOfKind(db, {
      title: 'Westmark',
      parentId: folder.article.id,
      kind: 'place',
      scaffold: false,
    })!;
    const page = (articleId: string) =>
      data().articles[articleId]!.docs.find((doc) => doc.kind === 'page')!;
    db.put('articles', {
      ...data().articles[kept.article.id]!,
      docs: [{ ...page(kept.article.id), text: 'Der Planet der Spieler.' }],
    });
    db.put('articles', {
      ...data().articles[folder.article.id]!,
      docs: [{ ...page(folder.article.id), text: 'Alles über die Welt.' }],
    });

    const result = mergeEntities(db, kept.entity!.id, folder.entity!.id)!;
    expect(result.textJoined).toBe(true);
    const text = textOf(db, kept.article.id);
    expect(text).toContain('Der Planet der Spieler.');
    expect(text).toContain('## Aus „Aurelis (Ordner)“');
    expect(text).toContain('Alles über die Welt.');
    // Der alte Artikel liegt im Papierkorb, sein Unterartikel hängt am Bleibenden.
    expect(data().articles[folder.article.id]).toBeUndefined();
    expect(data().articles[child.article.id]!.parentId).toBe(kept.article.id);
    expect(Object.values(data().versions).some((v) => v.reason === 'delete')).toBe(true);
    // Der Ort, der im Ordner-Ort lag, liegt jetzt auf dem Himmelskörper – „liegt in“ läuft durch.
    expect(data().entities[kept.entity!.id]!.kind).toBe('celestial');

    result.undo();
    expect(data().articles[folder.article.id]).toBeDefined();
    expect(data().articles[child.article.id]!.parentId).toBe(folder.article.id);
    expect(textOf(db, kept.article.id)).toBe('Der Planet der Spieler.');
    expect(Object.values(data().versions).some((v) => v.reason === 'delete')).toBe(false);
  });

  it('nimmt vom anderen, was dem Bleibenden fehlt, und zeigt nie auf sich selbst', async () => {
    const { db, data, put } = await setup();
    const above = put(createEntity({ kind: 'place', name: 'Nordreich' }));
    const keep = put(createEntity({ kind: 'place', name: 'Eisfurt' }));
    // Der andere liegt im Bleibenden und trägt, was diesem fehlt.
    const drop = put(
      createEntity({
        kind: 'place',
        name: 'Eisfurt (alt)',
        place: { parentId: above.id, category: 'Stadt', ground: 'Eis und Fels' },
      }),
    );
    db.put('entities', {
      ...(data().entities[keep.id] as Place),
      place: { ...(data().entities[keep.id] as Place).place, parentId: drop.id },
    });
    mergeEntities(db, keep.id, drop.id);
    const merged = data().entities[keep.id] as Place;
    // Lag der Bleibende im anderen, liegt er jetzt dort, wo der andere lag.
    expect(merged.place).toMatchObject({
      parentId: above.id,
      category: 'Stadt',
      ground: 'Eis und Fels',
    });
    expect(merged.aliases).toEqual(['Eisfurt (alt)']);
    expect(liesIn(data(), merged).map((e) => e.name)).toEqual(['Nordreich']);
  });

  it('macht aus doppelten Beziehungen eine und lässt keine auf sich selbst', async () => {
    const { db, data, put } = await setup();
    const keep = put(createEntity({ kind: 'faction', name: 'Bleiche Legion' }));
    const drop = put(createEntity({ kind: 'person', name: 'Die Bleichen Legionäre' }));
    const friend = put(createEntity({ kind: 'person', name: 'Tomas' }));
    db.put('relations', createRelation({ from: friend.id, to: keep.id, type: 'member' }));
    db.put(
      'relations',
      createRelation({ from: friend.id, to: drop.id, type: 'member', attitude: 2 }),
    );
    db.put('relations', createRelation({ from: drop.id, to: keep.id, type: 'knows' }));
    mergeEntities(db, keep.id, drop.id);
    const relations = Object.values(data().relations);
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({ from: friend.id, to: keep.id, attitude: 2 });
    // Über Kategorien hinweg bleibt die des Bleibenden.
    expect(data().entities[keep.id]!.kind).toBe('faction');
  });

  it('legt nichts zusammen, was nicht geht', async () => {
    const { db, put } = await setup();
    const place = put(createEntity({ kind: 'place', name: 'Grauhafen' }));
    expect(mergeEntities(db, place.id, place.id)).toBeNull();
    expect(mergeEntities(db, place.id, 'gibt-es-nicht')).toBeNull();
  });
});

describe('Doppelte Namen', () => {
  it('nennt Einträge, die genau gleich heißen – bis der Spielleiter sagt, sie sind verschieden', async () => {
    const { db, data, put } = await setup();
    put(createEntity({ kind: 'place', name: 'Aurelis' }));
    put(createEntity({ kind: 'celestial', name: 'aurelis ' }));
    put(createEntity({ kind: 'place', name: 'Aurelisfeld' }));
    const twins = nameTwins(data());
    expect(twins).toHaveLength(1);
    expect(twins[0]!.entities.map((entity) => entity.kind).sort()).toEqual(['celestial', 'place']);
    dismissSuggestion(db, twins[0]!.key);
    expect(nameTwins(data())).toEqual([]);
  });
});
