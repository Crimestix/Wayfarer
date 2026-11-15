import { describe, expect, it } from 'vitest';
import { groupOf, isSplit } from '../../../domain/party';
import { CampaignDb } from '../../../data/db';
import { demoCampaign } from '../../../data/__fixtures__/demoWorld';
import { MemoryStore } from '../../../data/store';
import {
  attitudeHistory,
  chronicleFor,
  entitiesOfKind,
  findRelation,
} from '../../../domain/derive';
import type { Character } from '../../../domain/schema';
import {
  clickExhaustion,
  moveCharacter,
  removeBond,
  saveBond,
  saveCharacter,
  toggleCharacterCondition,
} from '../actions';
import { emptyDraft, parseDraft } from '../model';

async function demoDb() {
  const store = new MemoryStore();
  const db = await CampaignDb.create(store, demoCampaign());
  return { store, db };
}
const hero = (db: CampaignDb, name: string) =>
  entitiesOfKind(db.getSnapshot(), 'character').find((c) => c.name === name) as Character;
const byName = (db: CampaignDb, name: string) =>
  Object.values(db.getSnapshot().entities).find((e) => e.name === name)!;

describe('Gefährten am Tisch', () => {
  it('setzt Erschöpfung per Marke und schaltet Zustände', async () => {
    const { db } = await demoDb();
    const id = hero(db, 'Tomlin').id;
    clickExhaustion(db, id, 2);
    expect(hero(db, 'Tomlin').character.exhaustion).toBe(2);
    clickExhaustion(db, id, 2);
    expect(hero(db, 'Tomlin').character.exhaustion).toBe(1);
    toggleCharacterCondition(db, id, 'Vergiftet');
    toggleCharacterCondition(db, id, 'Blind');
    expect(hero(db, 'Tomlin').character.conditions).toEqual(['Blind', 'Vergiftet']);
    toggleCharacterCondition(db, id, 'Vergiftet');
    expect(hero(db, 'Tomlin').character.conditions).toEqual(['Blind']);
  });

  it('ein Gefährte geht für sich: eine Teilgruppe aus einer Person, zurück und rückgängig', async () => {
    const { db } = await demoDb();
    const neil = hero(db, 'Neil');
    const hafen = byName(db, 'Dornhafen');
    const before = Object.keys(db.getSnapshot().chronicle).length;
    const result = moveCharacter(db, neil.id, hafen.id)!;
    // Kein Aufenthalt am Gefährten mehr, sondern eine Teilgruppe mit eigener Uhr.
    expect(hero(db, 'Neil').character.placeId).toBeNull();
    expect(groupOf(db.getSnapshot(), neil.id)).toMatchObject({
      memberIds: [neil.id],
      placeId: hafen.id,
    });
    const entries = chronicleFor(db.getSnapshot(), neil.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('travel');
    expect(entries[0]!.text).toBe('');
    expect(entries[0]!.travel?.who).toEqual([neil.id]);
    expect(moveCharacter(db, neil.id, hafen.id)).toBeNull();

    const back = moveCharacter(db, neil.id, null)!;
    expect(back.text).toBe('Neil ist wieder bei der Gruppe.');
    expect(isSplit(db.getSnapshot())).toBe(false);
    back.undo();
    expect(groupOf(db.getSnapshot(), neil.id)?.placeId).toBe(hafen.id);
    result.undo();
    expect(isSplit(db.getSnapshot())).toBe(false);
    expect(Object.keys(db.getSnapshot().chronicle)).toHaveLength(before);
  });
});

describe('Anlegen, ändern, wieder laden', () => {
  it('legt einen Gefährten an, ändert ihn und findet beides nach dem Laden wieder', async () => {
    const { store, db } = await demoDb();
    const draft = parseDraft({
      ...emptyDraft(),
      name: 'Sera',
      player: 'Kim',
      armorClass: '14',
      languages: ['Gemeinsprache'],
    });
    const id = saveCharacter(db, null, draft.value!);
    expect(hero(db, 'Sera').character).toMatchObject({
      player: 'Kim',
      armorClass: 14,
      active: true,
    });
    const again = parseDraft({
      ...emptyDraft(),
      name: 'Sera Windlauf',
      armorClass: '15',
      active: false,
    });
    expect(saveCharacter(db, id, again.value!)).toBe(id);
    await db.flush();
    const reopened = await CampaignDb.open(store);
    const sera = reopened.getSnapshot().entities[id] as Character;
    expect(sera.name).toBe('Sera Windlauf');
    expect(sera.character).toMatchObject({ armorClass: 15, active: false, player: '' });
  });
});

describe('Beziehungen zu einem Gefährten', () => {
  it('legt eine Beziehung mit Haltung an und schreibt die Haltung in die Chronik', async () => {
    const { db } = await demoDb();
    const tomlin = hero(db, 'Tomlin');
    const brann = byName(db, 'Brann Eisenhaken');
    const relation = saveBond(db, {
      fromId: brann.id,
      characterId: tomlin.id,
      type: 'owes',
      label: 'wird ignoriert',
      attitude: 1,
      note: ' Tomlin hat ihm das Leben gerettet. ',
      secret: true,
      ended: false,
    });
    expect(relation).toMatchObject({
      from: brann.id,
      to: tomlin.id,
      type: 'owes',
      label: '',
      attitude: 1,
      note: 'Tomlin hat ihm das Leben gerettet.',
      secret: true,
    });
    expect(attitudeHistory(db.getSnapshot(), brann.id, tomlin.id)).toHaveLength(1);

    // Ändern ohne neue Haltung: kein weiterer Chronikeintrag.
    saveBond(db, {
      fromId: brann.id,
      characterId: tomlin.id,
      type: 'custom',
      label: 'trinkt mit',
      attitude: 1,
      note: '',
      secret: false,
      ended: false,
    });
    const changed = findRelation(db.getSnapshot(), brann.id, tomlin.id)!;
    expect(changed).toMatchObject({
      id: relation.id,
      type: 'custom',
      label: 'trinkt mit',
      secret: false,
    });
    expect(attitudeHistory(db.getSnapshot(), brann.id, tomlin.id)).toHaveLength(1);

    removeBond(db, relation.id);
    expect(findRelation(db.getSnapshot(), brann.id, tomlin.id)).toBeUndefined();
  });

  it('legt eine Beziehung ohne Haltung an, ohne die Chronik zu berühren', async () => {
    const { db } = await demoDb();
    const before = Object.keys(db.getSnapshot().chronicle).length;
    saveBond(db, {
      fromId: byName(db, 'Haus Duskryn').id,
      characterId: hero(db, 'Veres').id,
      type: 'seeks',
      label: '',
      attitude: null,
      note: '',
      secret: false,
      ended: false,
    });
    expect(Object.keys(db.getSnapshot().chronicle)).toHaveLength(before);
    expect(
      findRelation(db.getSnapshot(), byName(db, 'Haus Duskryn').id, hero(db, 'Veres').id)?.type,
    ).toBe('seeks');
  });
});
