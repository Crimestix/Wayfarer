import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  allOwnKindSuggestions,
  categoryGroups,
  entriesOfOwnKind,
  guessBase,
  kindLabelOf,
  kindPathOf,
  ownKindCounts,
  ownKindOf,
  ownKindSuggestions,
  ownKindsOfBase,
  ownPlural,
  templateSuggestions,
} from '../../domain/ownKind';
import { createEntity } from '../../domain/schema';
import { createArticle } from '../wiki/actions';
import { galleryEntries, galleryFacets } from './galleryModel';
import { draftOf, draftWithKind, entityFromDraft, type WorldEntity } from './model';
import { addOwnKind, ownKindFromWord, patchOwnKind, removeOwnKind, setOwnKind } from './ownKinds';
import { newEntry } from './writing';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const put = (entity: ReturnType<typeof createEntity>) =>
    db.put('entities', entity) as WorldEntity;
  return { db, data: () => db.getSnapshot(), put };
}

describe('Eigene Kategorien', () => {
  it('legt eine an, die sich wie eine Kategorie von Wayfarer verhält – nie zwei gleichen Namens', async () => {
    const { db, data } = await setup();
    const made = addOwnKind(db, { name: '  Stadt ', plural: 'Städte', base: 'place' })!;
    expect(made.created).toBe(true);
    expect(made.own).toMatchObject({ name: 'Stadt', plural: 'Städte', base: 'place' });
    const again = addOwnKind(db, { name: 'stadt', base: 'place' })!;
    expect(again.created).toBe(false);
    expect(again.own.id).toBe(made.own.id);
    // Derselbe Name darf sich anderswo anders verhalten.
    expect(addOwnKind(db, { name: 'Stadt', base: 'faction' })!.created).toBe(true);
    expect(ownKindsOfBase(data(), 'place')).toHaveLength(1);
    expect(addOwnKind(db, { name: '   ', base: 'place' })).toBeNull();
  });

  it('gibt einem Eintrag ihren Namen – er bleibt, was er ist', async () => {
    const { db, data, put } = await setup();
    const { own } = addOwnKind(db, { name: 'Stadt', plural: 'Städte', base: 'place' })!;
    const town = put(
      createEntity({ kind: 'place', name: 'Grauhafen', place: { category: 'Hafenstadt' } }),
    );
    const person = put(createEntity({ kind: 'person', name: 'Tomas' }));
    setOwnKind(db, [town.id, person.id], own.id);
    // Nur was zur Grundkategorie passt, bekommt sie.
    expect(kindLabelOf(data(), data().entities[town.id]!)).toBe('Stadt');
    // Die eigene Kategorie steht unter der von Wayfarer, nie darüber.
    expect(kindPathOf(data(), data().entities[town.id]!)).toBe('Ort · Stadt');
    expect(kindPathOf(data(), data().entities[person.id]!)).toBe('Person');
    expect(kindLabelOf(data(), data().entities[person.id]!)).toBe('Person');
    expect(data().entities[town.id]).toMatchObject({
      kind: 'place',
      place: { category: 'Hafenstadt' },
    });
    expect(entriesOfOwnKind(data(), own.id).map((entity) => entity.name)).toEqual(['Grauhafen']);
    expect(ownKindCounts(data()).get(own.id)).toBe(1);
    expect(ownPlural(own)).toBe('Städte');
  });

  it('gilt nicht mehr, wenn der Eintrag die Kategorie wechselt', async () => {
    const { db, data, put } = await setup();
    const { own } = addOwnKind(db, { name: 'Stadt', base: 'place' })!;
    const wrong = put(createEntity({ kind: 'place', name: 'Jana Becker', ownKindId: own.id }));
    const changed = entityFromDraft(draftWithKind(draftOf(wrong, data()), 'person'), wrong);
    expect(changed.ownKindId).toBeNull();
    // Auch ein alter Verweis zählt nicht, wenn die Grundkategorie nicht passt.
    expect(ownKindOf(data(), { kind: 'person', ownKindId: own.id })).toBeNull();
  });

  it('entsteht beim Anlegen über „Neu“ gleich mit', async () => {
    const { db, data } = await setup();
    const { own } = addOwnKind(db, { name: 'Dungeon', base: 'place' })!;
    const made = newEntry(db, {
      name: 'Die Schwarzen Gewölbe',
      kind: 'place',
      withText: false,
      ownKindId: own.id,
    })!;
    expect(made.entity).toMatchObject({ kind: 'place', ownKindId: own.id });
    expect(kindLabelOf(data(), made.entity!)).toBe('Dungeon');
  });

  it('lässt sich umbenennen und entfernen – die Einträge bleiben, mit Rückgängig', async () => {
    const { db, data, put } = await setup();
    const { own } = addOwnKind(db, { name: 'Stadt', base: 'place' })!;
    const town = put(createEntity({ kind: 'place', name: 'Grauhafen', ownKindId: own.id }));
    patchOwnKind(db, own.id, { name: 'Großstadt', plural: 'Großstädte' });
    expect(kindLabelOf(data(), data().entities[town.id]!)).toBe('Großstadt');

    const undo = removeOwnKind(db, own.id)!;
    expect(data().campaign.ownKinds).toEqual([]);
    expect(data().entities[town.id]).toMatchObject({ kind: 'place', ownKindId: null });
    undo();
    expect(kindLabelOf(data(), data().entities[town.id]!)).toBe('Großstadt');
  });

  it('schlägt ein häufiges eigenes Wort als Kategorie vor und macht es auf Klick dazu', async () => {
    const { db, data, put } = await setup();
    for (const name of ['Aldmoor', 'Brackwasser', 'Carn', 'Dunmere', 'Eschfurt'])
      put(createEntity({ kind: 'place', name, place: { category: 'Stadt' } }));
    put(createEntity({ kind: 'place', name: 'Zur Eiche', place: { category: 'Taverne' } }));
    put(createEntity({ kind: 'place', name: 'Ohne Wort' }));

    const [suggestion] = ownKindSuggestions(data(), 'place');
    expect(suggestion).toMatchObject({ base: 'place', word: 'Stadt' });
    expect(suggestion!.entityIds).toHaveLength(5);
    // Fünf Tavernen gibt es nicht – also kein zweiter Vorschlag.
    expect(ownKindSuggestions(data(), 'place')).toHaveLength(1);

    const made = ownKindFromWord(db, suggestion!)!;
    expect(ownKindCounts(data()).get(made.own.id)).toBe(5);
    // Das eigene Wort der Einträge bleibt stehen.
    expect(
      Object.values(data().entities).filter(
        (e) => e.kind === 'place' && e.place.category === 'Stadt',
      ),
    ).toHaveLength(5);
    expect(ownKindSuggestions(data(), 'place')).toEqual([]);

    // In den Kacheln der Orte ist sie ein Filter – schon allein.
    const filter = { query: '', placeId: null, known: 'all' as const };
    const entries = galleryEntries(data(), 'place', filter);
    const facet = galleryFacets(data(), 'place', entries).find((f) => f.key === 'own');
    expect(facet?.options).toEqual([{ value: made.own.id, label: 'Stadt', count: 5 }]);

    made.undo();
    expect(data().campaign.ownKinds).toEqual([]);
    expect(ownKindSuggestions(data(), 'place')).toHaveLength(1);
  });

  it('schlägt die Vorlagen des Wikis als Kategorien vor – mit einer Vorwahl, wie sie sich verhalten', async () => {
    const { db, data } = await setup();
    const template = (title: string) => {
      const article = createArticle(db, { title })!;
      db.put('articles', { ...article, template: true });
    };
    template('Stadt');
    template('Major NPC');
    template('Kultur');
    // Was Wayfarer schon als Kategorie hat, wird nicht noch einmal vorgeschlagen.
    template('Fraktion');
    createArticle(db, { title: 'Kein Vorschlag' });

    expect(templateSuggestions(data()).map((s) => [s.name, s.base])).toEqual([
      ['Kultur', 'topic'],
      ['Major NPC', 'person'],
      ['Stadt', 'place'],
    ]);
    expect(guessBase('Historische Person')).toBe('person');
    expect(guessBase('Point of Interest')).toBe('place');
    expect(guessBase('Himmelskörper')).toBe('celestial');

    addOwnKind(db, { name: 'Stadt', base: 'place' });
    expect(templateSuggestions(data()).map((s) => s.name)).toEqual(['Kultur', 'Major NPC']);
  });

  it('nimmt bei Personen die Rolle als eigenes Wort', async () => {
    const { data, put } = await setup();
    for (const name of ['Ada', 'Bero', 'Cilla', 'Dorn', 'Ebba'])
      put(createEntity({ kind: 'person', name, person: { role: 'Stadtwache' } }));
    expect(allOwnKindSuggestions(data(), ['place', 'person'])).toMatchObject([
      { base: 'person', word: 'Stadtwache' },
    ]);
  });

  it('gliedert die Liste einer Kategorie: eigene Kategorien, gemeinsame Wörter, der Rest', async () => {
    const { db, data, put } = await setup();
    const { own } = addOwnKind(db, { name: 'Stadt', plural: 'Städte', base: 'place' })!;
    put(createEntity({ kind: 'place', name: 'Grauhafen', ownKindId: own.id }));
    put(createEntity({ kind: 'place', name: 'Elaris', place: { category: 'Planet' } }));
    put(createEntity({ kind: 'place', name: 'Elysium', place: { category: 'planet' } }));
    put(createEntity({ kind: 'place', name: 'Kosmologie', place: { category: 'Region' } }));
    put(createEntity({ kind: 'place', name: 'Brakka' }));
    const places = Object.values(data().entities).filter((e) => e.kind === 'place');
    const split = categoryGroups(data(), places)!;
    expect(split.groups.map((g) => [g.label, g.entities.map((e) => e.name)])).toEqual([
      ['Städte', ['Grauhafen']],
      ['Planet', ['Elaris', 'Elysium']],
    ]);
    // Ein Wort, das nur ein Eintrag trägt, und Einträge ohne Wort stehen unter „Weitere“.
    expect(split.rest.map((e) => e.name)).toEqual(['Brakka', 'Kosmologie']);
    // Ohne Wörter und eigene Kategorien gibt es nichts zu gliedern.
    expect(categoryGroups(data(), [places.find((e) => e.name === 'Brakka')!])).toBeNull();
  });
});
