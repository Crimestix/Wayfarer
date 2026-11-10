/** Familien, Spezies, Sprachen, Schriften, Fähigkeiten, Arbeitsplatz und die Galerie der Personen. */
import { describe, expect, it } from 'vitest';
import { deleteEntity } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { demoCampaign } from '../../data/__fixtures__/demoWorld';
import { MemoryStore } from '../../data/store';
import { detailLinks, linksTo, replaceLink } from '../../domain/derive';
import {
  createEntity,
  createRelation,
  type CampaignData,
  type Entity,
  type Person,
} from '../../domain/schema';
import { discardUnusedDrafts, syncLinkedRelations } from './actions';
import {
  PERSON_LINKS,
  WORLD_KINDS,
  deletionImpact,
  draftChanged,
  draftOf,
  emptyDraft,
  entityFacts,
  entityFromDraft,
  entitySubline,
  families,
  galleryPeople,
  groupMembers,
  languagesInScript,
  linkedFrom,
  linkedIds,
  speciesMembers,
  workersAt,
  type WorldEntity,
} from './model';

const dbOf = (data: CampaignData) => CampaignDb.create(new MemoryStore(), data);

const byName = (data: CampaignData, name: string): Entity =>
  Object.values(data.entities).find((e) => e.name === name)!;

/** Beispielwelt mit einer Familie, Spezies, Sprache samt Schrift und Fähigkeit rund um Isolde. */
function world() {
  const base = demoCampaign();
  const elf = createEntity({ kind: 'species', name: 'Elf', species: { category: 'Humanoid' } });
  const runes = createEntity({ kind: 'script', name: 'Runen' });
  const elvish = createEntity({
    kind: 'language',
    name: 'Elfisch',
    language: { scriptId: runes.id },
  });
  const sight = createEntity({ kind: 'ability', name: 'Zweites Gesicht' });
  const isolde = byName(base, 'Isolde Rabenschwinge') as Person;
  const dornhafen = byName(base, 'Dornhafen');
  const family = createEntity({
    kind: 'family',
    name: 'Haus Rabenschwinge',
    family: { seatId: dornhafen.id },
  });
  const person = {
    ...isolde,
    person: { ...isolde.person, speciesId: elf.id, workplaceId: dornhafen.id },
  };
  const relations = [
    createRelation({ from: isolde.id, to: elvish.id, type: 'speaks' }),
    createRelation({ from: isolde.id, to: sight.id, type: 'has-ability' }),
    createRelation({ from: isolde.id, to: family.id, type: 'member' }),
  ];
  const data: CampaignData = {
    ...base,
    entities: {
      ...base.entities,
      [person.id]: person,
      ...Object.fromEntries([elf, runes, elvish, sight, family].map((e) => [e.id, e])),
    },
    relations: {
      ...base.relations,
      ...Object.fromEntries(relations.map((r) => [r.id, r])),
    },
  };
  return { data, elf, runes, elvish, sight, family, isolde: person, dornhafen };
}

describe('Neue Arten der Weltdatenbank', () => {
  it('führt sie in der Weltdatenbank', () => {
    for (const kind of ['family', 'species', 'language', 'script', 'ability'])
      expect(WORLD_KINDS).toContain(kind);
  });

  it('zeigt bei einer Person Spezies, Arbeitsplatz, Familie, Sprachen und Fähigkeiten', () => {
    const { data, isolde, elf, dornhafen, family, elvish, sight } = world();
    const facts = Object.fromEntries(entityFacts(data, isolde).map((f) => [f.label, f]));
    expect(facts.Spezies!.ids).toEqual([elf.id]);
    expect(facts.Volk).toBeUndefined();
    expect(facts['Arbeitet bei']!.ids).toEqual([dornhafen.id]);
    expect(facts.Familie).toMatchObject({ ids: [family.id], list: true });
    expect(facts.Sprachen!.ids).toEqual([elvish.id]);
    expect(facts['Fähigkeiten']!.ids).toEqual([sight.id]);
  });

  it('zeigt den alten Freitext „Volk“, solange keine Spezies gewählt ist', () => {
    const person = createEntity({ kind: 'person', name: 'Probe', person: { species: 'Zwerg' } });
    const facts = entityFacts(demoCampaign(), person);
    expect(facts.find((f) => f.label === 'Volk')?.text).toBe('Zwerg');
  });

  it('beschreibt Sprache und Familie in Listen mit Schrift bzw. Stammsitz', () => {
    const { data, elvish, family } = world();
    expect(entitySubline(data, elvish)).toBe('Runen');
    expect(entitySubline(data, family)).toBe('Dornhafen');
  });

  it('findet Vertreter, Sprecher, Träger, Mitglieder und Arbeitende', () => {
    const { data, isolde, elf, elvish, sight, family, runes, dornhafen } = world();
    expect(speciesMembers(data, elf.id).map((p) => p.id)).toEqual([isolde.id]);
    expect(linkedFrom(data, elvish.id, 'speaks').map((p) => p.id)).toEqual([isolde.id]);
    expect(linkedFrom(data, sight.id, 'has-ability').map((p) => p.id)).toEqual([isolde.id]);
    expect(languagesInScript(data, runes.id).map((l) => l.id)).toEqual([elvish.id]);
    expect(families(data, isolde.id)).toEqual([family.id]);
    expect(linkedIds(data, isolde.id, 'speaks', ['language'])).toEqual([elvish.id]);
    expect(workersAt(data, dornhafen.id).map((p) => p.id)).toEqual([isolde.id]);
    expect(groupMembers(data, family.id).map((m) => m.entity.id)).toEqual([isolde.id]);
  });

  it('zählt Personen, die bei einer Fraktion arbeiten, zu ihren Mitgliedern', () => {
    const base = demoCampaign();
    const lotsen = byName(base, 'Bruderschaft der Lotsen');
    const worker = createEntity({
      kind: 'person',
      name: 'Hafenschreiber',
      person: { workplaceId: lotsen.id },
    });
    const data = { ...base, entities: { ...base.entities, [worker.id]: worker } };
    const member = groupMembers(data, lotsen.id).find((m) => m.entity.id === worker.id);
    expect(member).toMatchObject({ relation: null, label: 'arbeitet hier' });
  });
});

describe('Bearbeiten-Dialog', () => {
  it('liest Auswahl über Beziehungen in den Entwurf und erkennt Änderungen an Listen', () => {
    const { data, isolde, family, elvish, sight } = world();
    const draft = draftOf(isolde as WorldEntity, data);
    expect(draft).toMatchObject({
      familyIds: [family.id],
      languageIds: [elvish.id],
      abilityIds: [sight.id],
    });
    expect(draftChanged({ ...draft, languageIds: [...draft.languageIds] }, draft)).toBe(false);
    expect(draftChanged({ ...draft, languageIds: [] }, draft)).toBe(true);
  });

  it('legt neue Arten an und übernimmt Schrift und Stammsitz', () => {
    const language = entityFromDraft({
      ...emptyDraft('language'),
      name: 'Zwergisch',
      scriptId: 'r1',
    });
    expect(language).toMatchObject({ kind: 'language', language: { scriptId: 'r1' } });
    const family = entityFromDraft({
      ...emptyDraft('family'),
      name: 'Haus X',
      seatId: 'o1',
      category: 'Adelshaus',
    });
    expect(family).toMatchObject({
      kind: 'family',
      family: { seatId: 'o1', category: 'Adelshaus' },
    });
    const ability = entityFromDraft({ ...emptyDraft('ability'), name: 'Fluch', category: 'Fluch' });
    expect(ability).toMatchObject({ kind: 'ability', ability: { category: 'Fluch' } });
  });

  it('verwirft den alten Freitext, sobald eine Spezies gewählt ist, und behält unbekannte Felder', () => {
    const { isolde, elf } = world();
    const saved = entityFromDraft(
      { ...draftOf(isolde as WorldEntity), species: 'Elfe', speciesId: elf.id },
      isolde as WorldEntity,
    );
    expect(saved.kind === 'person' && saved.person).toMatchObject({
      species: '',
      speciesId: elf.id,
    });
    const place = createEntity({ kind: 'place', name: 'Ort', place: { climateId: 'gemaessigt' } });
    const again = entityFromDraft({ ...draftOf(place), name: 'Ort 2' }, place);
    expect(again.kind === 'place' && again.place.climateId).toBe('gemaessigt');
  });
});

describe('Beziehungen aus der Auswahl abgleichen', () => {
  it('legt fehlende an, entfernt abgewählte und lässt andere Arten in Ruhe', async () => {
    const { data, isolde, elvish } = world();
    const db = await dbOf(data);
    const dwarvish = db.put('entities', createEntity({ kind: 'language', name: 'Zwergisch' }));
    const knows = db.put(
      'relations',
      createRelation({ from: isolde.id, to: byName(data, 'Kessa Flutwind').id, type: 'knows' }),
    );
    syncLinkedRelations(db, isolde.id, 'speaks', ['language'], [dwarvish.id]);
    const after = db.getSnapshot();
    expect(linkedIds(after, isolde.id, 'speaks', ['language'])).toEqual([dwarvish.id]);
    expect(Object.values(after.relations).some((r) => r.to === elvish.id)).toBe(false);
    expect(after.relations[knows.id]).toBeDefined();
    // Noch einmal dasselbe ändert nichts.
    const count = Object.keys(after.relations).length;
    syncLinkedRelations(db, isolde.id, 'speaks', ['language'], [dwarvish.id]);
    expect(Object.keys(db.getSnapshot().relations)).toHaveLength(count);
  });

  it('kennt für jede Auswahl im Dialog Art und Ziel', () => {
    expect(PERSON_LINKS.map((l) => l.type)).toEqual(['member', 'speaks', 'has-ability']);
  });

  it('räumt im Dialog angelegte, aber nicht verwendete Spezies wieder weg', async () => {
    const { data } = world();
    const db = await dbOf(data);
    const used = db.put('entities', createEntity({ kind: 'species', name: 'Gnom' }));
    const unused = db.put('entities', createEntity({ kind: 'species', name: 'Ork' }));
    const person = byName(data, 'Kessa Flutwind') as Person;
    db.put('entities', { ...person, person: { ...person.person, speciesId: used.id } });
    discardUnusedDrafts(db, [used.id, unused.id], []);
    expect(db.getSnapshot().entities[used.id]).toBeDefined();
    expect(db.getSnapshot().entities[unused.id]).toBeUndefined();
  });
});

describe('Verweise der Einzelangaben', () => {
  it('listet sie je Art und ersetzt sie gezielt', () => {
    const { isolde, elf, dornhafen } = world();
    expect(detailLinks(isolde).map((l) => l.field)).toEqual(
      expect.arrayContaining(['speciesId', 'workplaceId']),
    );
    expect(linksTo(isolde, elf.id)).toBe(true);
    const without = replaceLink(isolde, elf.id, null) as Person;
    expect(without.person).toMatchObject({ speciesId: null, workplaceId: dornhafen.id });
    // Unveränderte Einträge bleiben dasselbe Objekt.
    expect(replaceLink(isolde, 'fehlt', null)).toBe(isolde);
  });

  it('leert beim Löschen Spezies, Arbeitsplatz und Schrift und nennt das vorher', async () => {
    const { data, isolde, elf, runes, elvish } = world();
    expect(deletionImpact(data, elf.id).residents).toBe(1);
    const db = await dbOf(data);
    deleteEntity(db, elf.id);
    deleteEntity(db, runes.id);
    const after = db.getSnapshot();
    const person = after.entities[isolde.id] as Person;
    expect(person.person.speciesId).toBeNull();
    const language = after.entities[elvish.id]!;
    expect(language.kind === 'language' && language.language.scriptId).toBeNull();
  });
});

describe('Galerie der Personen', () => {
  it('filtert nach Bekanntheit, Ort (auch Wohn- und Arbeitsort) und Suche', () => {
    const { data, dornhafen, isolde } = world();
    const all = galleryPeople(data, { query: '', placeId: null, known: 'all' });
    expect(all).toHaveLength(6);
    const known = galleryPeople(data, { query: '', placeId: null, known: 'known' });
    const unknown = galleryPeople(data, { query: '', placeId: null, known: 'unknown' });
    expect(known.length + unknown.length).toBe(6);
    expect(known.every((p) => p.person.met)).toBe(true);
    const here = galleryPeople(data, { query: '', placeId: dornhafen.id, known: 'all' });
    expect(here.map((p) => p.id)).toContain(isolde.id);
    const hits = galleryPeople(data, { query: 'isolde', placeId: null, known: 'all' });
    expect(hits.map((p) => p.id)).toEqual([isolde.id]);
    // Alphabetisch.
    expect(all.map((p) => p.name)).toEqual(
      [...all.map((p) => p.name)].sort((a, b) => a.localeCompare(b, 'de')),
    );
  });
});
