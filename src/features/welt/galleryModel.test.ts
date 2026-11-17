import { describe, expect, it } from 'vitest';
import { demoCampaign } from '../../data/__fixtures__/demoWorld';
import { createEntity, type CampaignData, type Entity } from '../../domain/schema';
import { galleryEntries, galleryWhere, knowsKnown } from './galleryModel';

const all = { query: '', placeId: null, known: 'all' } as const;
const named = (data: CampaignData, name: string): Entity =>
  Object.values(data.entities).find((e) => e.name === name)!;

describe('Galerie für jede Art', () => {
  it('zeigt jede Art, sucht und grenzt nach Ort ein', () => {
    const data = demoCampaign();
    const factions = galleryEntries(data, 'faction', all).map((e) => e.name);
    expect(factions.length).toBeGreaterThan(0);
    expect(factions).toEqual([...factions].sort((a, b) => a.localeCompare(b, 'de')));
    const first = factions[0]!;
    expect(galleryEntries(data, 'faction', { ...all, query: first }).map((e) => e.name)).toContain(
      first,
    );
    // Eingegrenzt auf einen Ort: nur, was dort liegt oder dort seinen Sitz hat – nie der Ort selbst.
    const harbor = named(data, 'Dornhafen');
    const inHarbor = galleryEntries(data, 'place', { ...all, placeId: harbor.id });
    expect(inHarbor.map((e) => e.id)).not.toContain(harbor.id);
    expect(inHarbor.every((e) => e.kind === 'place')).toBe(true);
  });

  it('trennt nach „bekannt“ nur bei Personen und Orten', () => {
    expect(knowsKnown('person')).toBe(true);
    expect(knowsKnown('place')).toBe(true);
    expect(knowsKnown('item')).toBe(false);
    const base = demoCampaign();
    const met = createEntity({ kind: 'person', name: 'Ulla Kerb', person: { met: true } });
    const stranger = createEntity({ kind: 'person', name: 'Oswin Taube', person: { met: false } });
    const data = {
      ...base,
      entities: { ...base.entities, [met.id]: met, [stranger.id]: stranger },
    };
    const known = galleryEntries(data, 'person', { ...all, known: 'known' }).map((e) => e.name);
    expect(known).toContain('Ulla Kerb');
    expect(known).not.toContain('Oswin Taube');
  });

  it('sagt auf der Karte, wo es ist oder wem es gehört', () => {
    const data = demoCampaign();
    const harbor = named(data, 'Dornhafen');
    expect(galleryWhere(data, harbor)).toBe('in Nebelküste');
  });
});

describe('Filter, die zur Kategorie passen', () => {
  it('Personen nach Rolle, Volk und Haltung – nur Filter mit mindestens zwei Möglichkeiten', async () => {
    const { CampaignDb } = await import('../../data/db');
    const { MemoryStore } = await import('../../data/store');
    const { elarisCampaign } = await import('../../data/seed');
    const { createEntity } = await import('../../domain/schema');
    const { galleryFacets, withFacets } = await import('./galleryModel');
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const elf = db.put('entities', createEntity({ kind: 'species', name: 'Waldvolk' }));
    const a = db.put(
      'entities',
      createEntity({
        kind: 'person',
        name: 'Ilma',
        person: { role: 'Fährfrau', speciesId: elf.id },
      }),
    );
    db.put('entities', createEntity({ kind: 'person', name: 'Bero', person: { role: 'Schmied' } }));
    const data = db.getSnapshot();
    const people = Object.values(data.entities).filter(
      (e): e is Extract<typeof e, { kind: 'person' }> => e.kind === 'person',
    );
    const facets = galleryFacets(data, 'person', people);
    expect(facets.map((f) => f.key)).toContain('word');
    // Nur einer hat ein Volk: kein Filter „Volk“ mit einer einzigen Möglichkeit.
    expect(facets.map((f) => f.key)).not.toContain('species');
    expect(withFacets(data, people, { word: 'fährfrau' }).map((e) => e.id)).toEqual([a.id]);
  });
});
