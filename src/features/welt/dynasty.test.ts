import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity, createRelation, type CampaignData, type Entity } from '../../domain/schema';
import { adoptFamilies } from './actions';
import { DERIVED_FAMILY_TAG, familyKey, planFamilies, surnameOf } from './dynasty';
import { families, groupMembers } from './model';

const person = (name: string) => createEntity({ kind: 'person', name });
const world = (...entities: Entity[]): CampaignData => ({
  ...elarisCampaign(),
  entities: Object.fromEntries(entities.map((e) => [e.id, e])),
});

describe('Nachname erkennen', () => {
  it('nimmt den letzten Namen, wenn Vor- und Nachname da sind', () => {
    expect(surnameOf('Ardo Venn')).toEqual({ text: 'Venn', key: 'venn' });
    expect(surnameOf('Anna Maria Kornblum')?.text).toBe('Kornblum');
    expect(surnameOf('  Ardo   Venn  ')?.key).toBe('venn');
  });

  it('behält Namenszusätze beim Namen, vergleicht aber ohne sie', () => {
    expect(surnameOf('Edda von Hohenfels')).toEqual({ text: 'von Hohenfels', key: 'hohenfels' });
    expect(surnameOf('Jan van der Berg')).toEqual({ text: 'van der Berg', key: 'berg' });
    expect(surnameOf('Luc de la Tour')?.key).toBe('tour');
  });

  it('streift Titel ab und erkennt dann nur noch Eindeutiges', () => {
    expect(surnameOf('Hauptmann Ardo Venn')?.text).toBe('Venn');
    expect(surnameOf('Königin Mira Sturmfels')?.text).toBe('Sturmfels');
    // Titel und ein einzelner Name: Vor- oder Nachname? Das lässt sich nicht sagen.
    expect(surnameOf('Hauptmann Voss')).toBeNull();
    expect(surnameOf('Bruder Teoric')).toBeNull();
  });

  it('hält Beinamen, Einzelnamen und Spitznamen nicht für Nachnamen', () => {
    expect(surnameOf('Erik der Rote')).toBeNull();
    expect(surnameOf('Mira die Stille')).toBeNull();
    expect(surnameOf('Der Fährmann')).toBeNull();
    expect(surnameOf('Teoric')).toBeNull();
    expect(surnameOf('')).toBeNull();
    expect(surnameOf('Ardo „Graubart“ Venn')?.text).toBe('Venn');
    expect(surnameOf('Ardo Venn (verschollen)')?.text).toBe('Venn');
    expect(surnameOf('Ardo Venn II')?.text).toBe('Venn');
    expect(surnameOf('Kessa vom hafen')).toBeNull();
  });

  it('bildet für Haus, Familie und bloßen Namen denselben Schlüssel', () => {
    for (const name of ['Venn', 'Familie Venn', 'Haus Venn', 'haus venn', 'Sippe Venn'])
      expect(familyKey(name)).toBe('venn');
    expect(familyKey('Haus von Hohenfels')).toBe('hohenfels');
    expect(familyKey('Familie Égaré')).toBe('egare');
  });
});

describe('Familien aus Nachnamen planen', () => {
  it('fasst Personen mit gleichem Nachnamen zu einer neuen Familie zusammen', () => {
    const ardo = person('Ardo Venn');
    const edda = person('Edda Venn');
    const ilse = person('Ilse Kornblum');
    const voss = person('Hauptmann Voss');
    const plan = planFamilies(world(ardo, edda, ilse, voss));
    expect(plan.create.map((c) => [c.name, c.personIds.length])).toEqual([
      ['Familie Kornblum', 1],
      ['Familie Venn', 2],
    ]);
    expect(plan.join).toEqual([]);
  });

  it('ordnet einer vorhandenen Familie zu – auch einem „Haus“ unter den Fraktionen', () => {
    const ardo = person('Ardo Venn');
    const maera = person('Maera Duskryn');
    const venn = createEntity({ kind: 'family', name: 'Die Venns', aliases: ['Venn'] });
    const haus = createEntity({ kind: 'faction', name: 'Haus Duskryn' });
    const gilde = createEntity({ kind: 'faction', name: 'Kornblum' });
    const ilse = person('Ilse Kornblum');
    const plan = planFamilies(world(ardo, maera, venn, haus, gilde, ilse));
    expect(plan.join).toEqual([
      { personId: ardo.id, familyId: venn.id },
      { personId: maera.id, familyId: haus.id },
    ]);
    // Eine Fraktion, die nur zufällig so heißt, ist keine Familie.
    expect(plan.create.map((c) => c.name)).toEqual(['Familie Kornblum']);
  });

  it('lässt in Ruhe, wer schon zu einer Familie gehört, und beschränkt sich auf Wunsch auf einzelne', () => {
    const ardo = person('Ardo Venn');
    const edda = person('Edda Venn');
    const other = createEntity({ kind: 'family', name: 'Familie Graufels' });
    const data = world(ardo, edda, other);
    const linked = {
      ...data,
      relations: Object.fromEntries(
        [createRelation({ from: ardo.id, to: other.id, type: 'member' })].map((r) => [r.id, r]),
      ),
    };
    expect(planFamilies(linked).create[0]!.personIds).toEqual([edda.id]);
    expect(planFamilies(data, [ardo.id]).create[0]!.personIds).toEqual([ardo.id]);
  });
});

describe('Familien anlegen', () => {
  it('legt Familien samt Mitgliedschaft an, meldet es in einem Satz und lässt sich zurücknehmen', async () => {
    const ardo = person('Ardo Venn');
    const edda = person('Edda Venn');
    const db = await CampaignDb.create(new MemoryStore(), world(ardo, edda));
    const result = adoptFamilies(db)!;
    expect(result.text).toBe('Familie Venn angelegt (2 Mitglieder)');
    const data = db.getSnapshot();
    const family = data.entities[result.familyId!]!;
    expect(family).toMatchObject({
      kind: 'family',
      name: 'Familie Venn',
      tags: [DERIVED_FAMILY_TAG],
    });
    expect(families(data, ardo.id)).toEqual([family.id]);
    expect(groupMembers(data, family.id).map((m) => m.entity.name)).toEqual([
      'Ardo Venn',
      'Edda Venn',
    ]);
    // Ein zweiter Lauf findet nichts mehr zu tun.
    expect(adoptFamilies(db)).toBeNull();
    result.undo();
    expect(Object.values(db.getSnapshot().entities).some((e) => e.kind === 'family')).toBe(false);
    expect(Object.keys(db.getSnapshot().relations)).toEqual([]);
  });

  it('nimmt beim Zurücknehmen nichts weg, was inzwischen bearbeitet wurde', async () => {
    const ardo = person('Ardo Venn');
    const db = await CampaignDb.create(new MemoryStore(), world(ardo));
    const result = adoptFamilies(db, [ardo.id])!;
    db.patch('entities', result.familyId!, { notes: 'Alte Zöllnerfamilie.' });
    result.undo();
    expect(db.getSnapshot().entities[result.familyId!]).toBeDefined();
  });
});
