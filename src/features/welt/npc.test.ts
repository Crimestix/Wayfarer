import { describe, expect, it } from 'vitest';
import { elarisCampaign } from '../../data/seed';
import { rngOf, seedOf } from '../../domain/random';
import { createEntity, type CampaignData, type Entity } from '../../domain/schema';
import { CORPUS_MIN, learnedName, nameCorpus, rolesFor, suggestNpc, syllableName } from './npc';

const world = (...entities: Entity[]): CampaignData => ({
  ...elarisCampaign(),
  entities: Object.fromEntries(entities.map((e) => [e.id, e])),
});
const person = (name: string, details: Record<string, unknown> = {}) =>
  createEntity({ kind: 'person', name, person: details });

const NAMES = [
  'Ardo Venn',
  'Edda Venn',
  'Ilse Kornblum',
  'Hauptmann Brann Eisenhaken',
  'Maera von Hohenfels',
  'Kessa Flutwind',
  'Teoric',
  'Isolde Rabenschwinge',
];

describe('Wiederholbarer Zufall', () => {
  it('liefert zum selben Ausgangswert dieselbe Folge', () => {
    const a = rngOf(seedOf('wetter', 12));
    const b = rngOf(seedOf('wetter', 12));
    const c = rngOf(seedOf('wetter', 13));
    const take = (r: ReturnType<typeof rngOf>) => Array.from({ length: 5 }, () => r.next());
    const first = take(a);
    expect(take(b)).toEqual(first);
    expect(take(c)).not.toEqual(first);
    for (const n of first) (expect(n).toBeGreaterThanOrEqual(0), expect(n).toBeLessThan(1));
  });

  it('wählt nach Gewichten und hält Grenzen ein', () => {
    const rng = rngOf(7);
    for (let i = 0; i < 200; i++) {
      const n = rng.int(2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
      expect(rng.weighted(['nie', 'immer'], (x) => (x === 'nie' ? 0 : 1))).toBe('immer');
    }
    expect(rng.pick([])).toBeUndefined();
    expect(rng.weighted(['a'], () => 0)).toBeUndefined();
  });
});

describe('Namen aus der Welt', () => {
  it('trennt Vor- und Nachnamen und lässt Titel weg', () => {
    const corpus = nameCorpus(world(...NAMES.map((n) => person(n))));
    expect(corpus.given).toEqual([
      'Ardo',
      'Brann',
      'Edda',
      'Ilse',
      'Isolde',
      'Kessa',
      'Maera',
      'Teoric',
    ]);
    expect(corpus.family).toEqual([
      'Eisenhaken',
      'Flutwind',
      'Kornblum',
      'Rabenschwinge',
      'Venn',
      'von Hohenfels',
    ]);
  });

  it('lernt nur aus der gewünschten Spezies', () => {
    const elf = createEntity({ kind: 'species', name: 'Elf' });
    const data = world(elf, person('Sael Morgentau', { speciesId: elf.id }), person('Ardo Venn'));
    expect(nameCorpus(data, elf.id).given).toEqual(['Sael']);
  });

  it('baut neue Namen aus dem Klang der Vorlagen – keinen davon, aber mit deren Buchstaben', () => {
    const samples = ['Ardo', 'Brann', 'Edda', 'Ilse', 'Isolde', 'Kessa', 'Maera', 'Teoric'];
    const letters = new Set(samples.join('').toLowerCase());
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const name = learnedName(rngOf(seed), samples);
      if (!name) continue;
      seen.add(name);
      expect(samples).not.toContain(name);
      expect(name[0]).toBe(name[0]!.toUpperCase());
      for (const char of name.toLowerCase()) expect(letters.has(char)).toBe(true);
    }
    expect(seen.size).toBeGreaterThan(5);
    expect(learnedName(rngOf(1), ['Bo'])).toBeNull();
  });

  it('fällt auf allgemeine Silben zurück, solange die Welt zu wenige Namen hat', () => {
    const name = syllableName(rngOf(3));
    expect(name).toMatch(/^\p{Lu}\p{Ll}+$/u);
    const few = suggestNpc(world(person('Ardo Venn')), {}, 5);
    expect(few.nameSource).toBe('generic');
    expect(CORPUS_MIN).toBeGreaterThan(2);
  });
});

describe('Vorschlag für eine Nebenfigur', () => {
  const tavern = createEntity({
    kind: 'place',
    name: 'Zum Salzigen Raben',
    place: { category: 'Taverne' },
  });
  const species = createEntity({ kind: 'species', name: 'Mensch' });
  const people = NAMES.map((n) => person(n, { placeId: tavern.id, speciesId: species.id }));
  const data = world(tavern, species, ...people);

  it('ist wiederholbar: gleicher Ausgangswert, gleicher Vorschlag', () => {
    expect(suggestNpc(data, { placeId: tavern.id }, 42)).toEqual(
      suggestNpc(data, { placeId: tavern.id }, 42),
    );
    const many = new Set(
      Array.from({ length: 30 }, (_, i) => suggestNpc(data, { placeId: tavern.id }, i).name),
    );
    expect(many.size).toBeGreaterThan(15);
  });

  it('passt zur Welt: Ort, Spezies, Tätigkeit und Klang der Namen', () => {
    const existing = new Set(NAMES.map((n) => n.toLowerCase()));
    let sharedFamily = 0;
    for (let seed = 0; seed < 40; seed++) {
      const npc = suggestNpc(data, { placeId: tavern.id }, seed);
      expect(npc.placeId).toBe(tavern.id);
      expect(npc.homeId).toBe(tavern.id);
      expect(npc.speciesId).toBe(species.id);
      expect(npc.nameSource).toBe('world');
      expect(rolesFor(data, tavern.id)).toContain(npc.role);
      expect(npc.tagline).toMatch(/^.+\. .+\.$/);
      expect(existing.has(npc.name.toLowerCase())).toBe(false);
      if (/ (Venn|Kornblum|Eisenhaken|Flutwind|Rabenschwinge|von Hohenfels)$/.test(npc.name))
        sharedFamily++;
    }
    // Ein guter Teil trägt einen Nachnamen, den es am Ort schon gibt – so wachsen Familien.
    expect(sharedFamily).toBeGreaterThan(5);
  });

  it('wählt die Tätigkeit nach der Art des Ortes, sonst nach dem Ort darüber', () => {
    expect(rolesFor(data, tavern.id)).toContain('Schankdienst');
    const harbour = createEntity({ kind: 'place', name: 'Dornhafen' });
    const lane = createEntity({ kind: 'place', name: 'Gasse', place: { parentId: harbour.id } });
    const more = world(harbour, lane);
    expect(rolesFor(more, lane.id)).toContain('Fischerei');
    const mill = createEntity({ kind: 'place', name: 'Alte Mühle' });
    expect(rolesFor(world(mill), mill.id)).toContain('Müllerei');
    expect(rolesFor(more, null)).toContain('Botengänge');
  });

  it('achtet eine fest gewählte Spezies und erfindet keine', () => {
    const elf = createEntity({ kind: 'species', name: 'Elf' });
    const withElf = world(tavern, species, elf, ...people);
    expect(suggestNpc(withElf, { speciesId: elf.id }, 9).speciesId).toBe(elf.id);
    expect(suggestNpc(world(tavern), { placeId: tavern.id }, 9).speciesId).toBeNull();
  });
});
