/**
 * Welche Einträge der Weltdatenbank sind mit welchem LegendKeeper-Artikel verknüpft?
 * Damit führt ein Artikel zurück zum Eintrag in Wayfarer, und beim Verknüpfen ist zu sehen,
 * dass ein Artikel schon vergeben ist. Reine Funktionen.
 */
import type { Entity, EntityKind } from '../../domain/schema';

export interface LinkedEntry {
  id: string;
  name: string;
  kind: EntityKind;
}

export type EntriesByArticle = ReadonlyMap<string, LinkedEntry[]>;

export const NO_LINKED_ENTRIES: EntriesByArticle = new Map();

/** Einträge je Artikelkennung, nach Namen sortiert. */
export function entriesByArticle(entities: Iterable<Entity>): EntriesByArticle {
  const map = new Map<string, LinkedEntry[]>();
  for (const entity of entities) {
    const resourceId = entity.lk?.resourceId;
    if (!resourceId) continue;
    const entry: LinkedEntry = {
      id: entity.id,
      name: entity.name.trim() || 'Unbenannter Eintrag',
      kind: entity.kind,
    };
    const list = map.get(resourceId);
    if (list) list.push(entry);
    else map.set(resourceId, [entry]);
  }
  for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return map;
}

/** „Hauptmann Voss“ · „Voss und Brann“ · „Voss, Brann und 2 weitere“. */
export function entryNames(entries: LinkedEntry[]): string {
  const names = entries.map((entry) => `„${entry.name}“`);
  if (names.length <= 2) return names.join(' und ');
  const rest = names.length - 2;
  return `${names.slice(0, 2).join(', ')} und ${rest === 1 ? 'ein weiterer' : `${rest} weitere`}`;
}
