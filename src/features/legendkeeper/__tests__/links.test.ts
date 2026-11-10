import { describe, expect, it } from 'vitest';
import type { Entity } from '../../../domain/schema';
import { entriesByArticle, entryNames } from '../links';

/** Nur die Felder, auf die es hier ankommt. */
const entity = (id: string, name: string, resourceId: string | null, kind = 'person'): Entity =>
  ({ id, name, kind, lk: resourceId ? { resourceId, title: name } : null }) as unknown as Entity;

describe('Einträge je LegendKeeper-Artikel', () => {
  const map = entriesByArticle([
    entity('e1', 'Hauptmann Voss', 'persvoss'),
    entity('e2', 'Dornhafen', 'dornhafn', 'place'),
    entity('e3', 'Brann Eisenhaken', null),
    entity('e4', 'Die Dornenstadt', 'dornhafn', 'topic'),
    entity('e5', '  ', 'namenlos'),
  ]);

  it('ordnet verknüpfte Einträge ihrem Artikel zu, nach Namen sortiert', () => {
    expect(map.get('persvoss')).toEqual([{ id: 'e1', name: 'Hauptmann Voss', kind: 'person' }]);
    expect(map.get('dornhafn')?.map((entry) => entry.name)).toEqual([
      'Die Dornenstadt',
      'Dornhafen',
    ]);
    expect(map.get('namenlos')?.[0]?.name).toBe('Unbenannter Eintrag');
  });

  it('lässt Einträge ohne Verknüpfung weg', () => {
    expect([...map.keys()].sort()).toEqual(['dornhafn', 'namenlos', 'persvoss']);
    expect(entriesByArticle([]).size).toBe(0);
  });

  it('nennt die Einträge in einem lesbaren Satzteil', () => {
    const names = (count: number) =>
      entryNames(
        Array.from({ length: count }, (_, i) => ({
          id: `e${i}`,
          name: `N${i + 1}`,
          kind: 'person' as const,
        })),
      );
    expect(names(1)).toBe('„N1“');
    expect(names(2)).toBe('„N1“ und „N2“');
    expect(names(3)).toBe('„N1“, „N2“ und ein weiterer');
    expect(names(5)).toBe('„N1“, „N2“ und 3 weitere');
  });
});
