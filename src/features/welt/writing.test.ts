/** Anlegen beim Schreiben und Verbindungen als Befehl. Erfundene Welt. */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { findRelation } from '../../domain/derive';
import { PARTY_ID, createEntity, createStory } from '../../domain/schema';
import { isStub } from '../../domain/stub';
import { createArticle, savePageText } from '../wiki/actions';
import { relate, unrelate } from './actions';
import { addFromWriting, finishStub } from './writing';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const hohenfurt = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const mira = db.put(
    'entities',
    createEntity({ kind: 'person', name: 'Mira Tannhaus', aliases: ['Die Fährfrau'] }),
  );
  const zoll = db.put('stories', createStory({ title: 'Der Zoll an der Furt' }));
  return { db, hohenfurt, mira, zoll };
}

const count = (db: CampaignDb) => Object.keys(db.getSnapshot().entities).length;

describe('Anlegen beim Schreiben', () => {
  it('legt einen Platzhalter an: Name, Art, ein Satz, aus welcher Geschichte', async () => {
    const { db, zoll } = await setup();
    const before = count(db);
    const result = addFromWriting(db, {
      name: '  Lando   Furtner ',
      kind: 'person',
      line: ' Fährmann an der Furt ',
      storyId: zoll.id,
    })!;
    expect(result.created).toBe(true);
    expect(result.otherKind).toBe(false);
    const entity = db.getSnapshot().entities[result.entity.id]!;
    expect(entity).toMatchObject({
      kind: 'person',
      name: 'Lando Furtner',
      tagline: 'Fährmann an der Furt',
      stub: true,
      fromStoryId: zoll.id,
    });
    expect(isStub(db.getSnapshot(), entity)).toBe(true);
    expect(count(db)).toBe(before + 1);
    result.undo();
    expect(count(db)).toBe(before);
  });

  it('nimmt den vorhandenen Eintrag – nie ein zweiter für einen Namen', async () => {
    const { db, mira, hohenfurt } = await setup();
    const before = count(db);
    const same = addFromWriting(db, { name: 'mira tannhaus', kind: 'person' })!;
    expect(same).toMatchObject({ created: false, otherKind: false });
    expect(same.entity.id).toBe(mira.id);
    // Auch über den Zweitnamen.
    expect(addFromWriting(db, { name: 'Die Fährfrau', kind: 'person' })!.entity.id).toBe(mira.id);
    // Eine andere Art: Der vorhandene bleibt, wie er ist – das Ergebnis sagt es.
    const other = addFromWriting(db, { name: 'Hohenfurt', kind: 'faction', line: 'egal' })!;
    expect(other).toMatchObject({ created: false, otherKind: true });
    expect(other.entity.id).toBe(hohenfurt.id);
    expect(db.getSnapshot().entities[hohenfurt.id]).toMatchObject({ kind: 'place', stub: false });
    expect(count(db)).toBe(before);
    // Zurücknehmen lässt einen Eintrag, den es schon gab, in Ruhe.
    other.undo();
    expect(db.getSnapshot().entities[hohenfurt.id]).toBeDefined();
  });

  it('sagt ohne Namen nichts und merkt sich keine Geschichte, die es nicht gibt', async () => {
    const { db } = await setup();
    expect(addFromWriting(db, { name: '   ', kind: 'place' })).toBeNull();
    const result = addFromWriting(db, { name: 'Salzgrotte', kind: 'place', storyId: 'weg' })!;
    expect(result.entity.fromStoryId).toBeNull();
    expect(result.entity.tagline).toBe('');
  });

  it('verbindet einen freien Artikel gleichen Titels statt eines zweiten Dings', async () => {
    const { db } = await setup();
    const article = createArticle(db, { title: 'Burg Graufels', parentId: null })!;
    savePageText(db, article.id, article.docs[0]!.id, 'Eine Burg über dem Fluss.');
    const result = addFromWriting(db, { name: 'burg graufels', kind: 'place' })!;
    expect(result.created).toBe(true);
    const entity = db.getSnapshot().entities[result.entity.id]!;
    expect(entity.name).toBe('Burg Graufels');
    expect(entity.lk?.resourceId).toBe(article.id);
    // Er hat schon einen geschriebenen Artikel: kein Platzhalter.
    expect(isStub(db.getSnapshot(), entity)).toBe(false);
  });

  it('endet als Platzhalter von selbst mit dem ersten Eigenen – oder von Hand', async () => {
    const { db } = await setup();
    const a = addFromWriting(db, { name: 'Salzgrotte', kind: 'place' })!.entity;
    const b = addFromWriting(db, { name: 'Ilka Sturmfels', kind: 'person' })!.entity;
    db.patch('entities', a.id, { notes: 'Eine Höhle voller Salz.' });
    expect(isStub(db.getSnapshot(), db.getSnapshot().entities[a.id])).toBe(false);
    const undo = finishStub(db, b.id);
    expect(isStub(db.getSnapshot(), db.getSnapshot().entities[b.id])).toBe(false);
    undo();
    expect(isStub(db.getSnapshot(), db.getSnapshot().entities[b.id])).toBe(true);
  });
});

describe('Verbindungen als Befehl', () => {
  it('verbindet zwei Einträge und nimmt es zurück', async () => {
    const { db, mira } = await setup();
    const zunft = db.put('entities', createEntity({ kind: 'faction', name: 'Fährleute' }));
    const result = relate(db, {
      from: mira.id,
      to: zunft.id,
      type: 'leads',
      note: ' seit Jahren ',
    })!;
    expect(result.created).toBe(true);
    expect(findRelation(db.getSnapshot(), mira.id, zunft.id)).toMatchObject({
      type: 'leads',
      note: 'seit Jahren',
      secret: false,
    });
    result.undo();
    expect(findRelation(db.getSnapshot(), mira.id, zunft.id)).toBeUndefined();
  });

  it('legt nie zwei in derselben Richtung an: Die vorhandene bekommt die neue Art', async () => {
    const { db, mira } = await setup();
    const zunft = db.put('entities', createEntity({ kind: 'faction', name: 'Fährleute' }));
    const first = relate(db, { from: mira.id, to: zunft.id, type: 'member', note: 'Lehrling' })!;
    const second = relate(db, { from: mira.id, to: zunft.id, type: 'leads', secret: true })!;
    expect(second.created).toBe(false);
    expect(second.relation.id).toBe(first.relation.id);
    const all = Object.values(db.getSnapshot().relations).filter(
      (relation) => relation.from === mira.id && relation.to === zunft.id,
    );
    expect(all).toHaveLength(1);
    // Was nicht angegeben ist, bleibt.
    expect(all[0]).toMatchObject({ type: 'leads', note: 'Lehrling', secret: true });
    second.undo();
    expect(findRelation(db.getSnapshot(), mira.id, zunft.id)).toMatchObject({
      type: 'member',
      note: 'Lehrling',
      secret: false,
    });
    // Die Gegenrichtung ist eine eigene Beziehung.
    expect(relate(db, { from: zunft.id, to: mira.id, type: 'knows' })!.created).toBe(true);
  });

  it('führt die Haltung zur Gruppe über den Verlauf', async () => {
    const { db, mira } = await setup();
    const before = Object.keys(db.getSnapshot().chronicle).length;
    const result = relate(db, {
      from: mira.id,
      to: PARTY_ID,
      type: 'ally',
      attitude: 2,
      reason: 'Die Gruppe hat ihr Boot geflickt',
    })!;
    expect(findRelation(db.getSnapshot(), mira.id, PARTY_ID)).toMatchObject({
      type: 'ally',
      attitude: 2,
    });
    const entries = Object.values(db.getSnapshot().chronicle);
    expect(entries).toHaveLength(before + 1);
    expect(entries.find((entry) => entry.kind === 'attitude')?.attitude).toMatchObject({
      fromId: mira.id,
      toId: PARTY_ID,
      after: 2,
    });
    result.undo();
    expect(findRelation(db.getSnapshot(), mira.id, PARTY_ID)).toBeUndefined();
    expect(Object.keys(db.getSnapshot().chronicle)).toHaveLength(before);
  });

  it('verbindet nicht, was es nicht gibt, und nie von der Gruppe aus', async () => {
    const { db, mira } = await setup();
    expect(relate(db, { from: PARTY_ID, to: mira.id, type: 'knows' })).toBeNull();
    expect(relate(db, { from: mira.id, to: 'weg', type: 'knows' })).toBeNull();
    expect(relate(db, { from: mira.id, to: mira.id, type: 'knows' })).toBeNull();
    expect(Object.keys(db.getSnapshot().relations)).toHaveLength(0);
  });

  it('löst eine Verbindung – auf Wunsch nur eine bestimmte Art', async () => {
    const { db, mira, hohenfurt } = await setup();
    relate(db, { from: mira.id, to: hohenfurt.id, type: 'knows' });
    expect(unrelate(db, { from: mira.id, to: hohenfurt.id, type: 'leads' })).toBeNull();
    const undo = unrelate(db, { from: mira.id, to: hohenfurt.id })!;
    expect(findRelation(db.getSnapshot(), mira.id, hohenfurt.id)).toBeUndefined();
    undo();
    expect(findRelation(db.getSnapshot(), mira.id, hohenfurt.id)).toMatchObject({ type: 'knows' });
    expect(unrelate(db, { from: hohenfurt.id, to: mira.id })).toBeNull();
  });
});
