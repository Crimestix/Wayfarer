/**
 * Eigene Kategorien (Wunsch des Spielleiters, 18. 11. 2026: „feste Kategorien, die man anlegen
 * kann“ – in LegendKeeper hatte er dafür Vorlagen: Stadt, Distrikt, Dungeon, Major NPC …).
 *
 * Eine eigene Kategorie ist eine benannte Gruppe **innerhalb** einer Kategorie von Wayfarer: Sie
 * „verhält sich wie“ diese (`base`). Eine „Stadt“ kann alles, was ein Ort kann – Lage, Leute
 * darin, Wege –, weil sie ein Ort ist; sie steht nur unter ihrem eigenen Namen: als Gruppe in der
 * Liste, mit eigenen Kacheln, bei „Neu“ und im Kopf der Seite. Wayfarer liefert keine mit.
 *
 * Die Kategorien stehen in `campaign.ownKinds`, ein Eintrag trägt seine in `ownKindId`. Reine
 * Rechnung; angelegt und geändert wird über `features/welt/ownKinds.ts`.
 */
import { KIND_LABEL, KIND_LABEL_PLURAL, entityCategory } from './derive';
import { isDismissed, SUGGESTION } from './dismiss';
import type { CampaignData, CampaignMeta, Entity, EntityKind } from './schema';

export type OwnKind = CampaignMeta['ownKinds'][number];

type WithKinds = Pick<CampaignData, 'campaign'>;

/** Alle eigenen Kategorien, nach Namen. */
export function ownKinds(data: WithKinds): OwnKind[] {
  return [...data.campaign.ownKinds].sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Die eigenen Kategorien, die sich wie `base` verhalten. */
export const ownKindsOfBase = (data: WithKinds, base: EntityKind): OwnKind[] =>
  ownKinds(data).filter((own) => own.base === base);

export const ownKindById = (data: WithKinds, id: string | null | undefined): OwnKind | null =>
  (id && data.campaign.ownKinds.find((own) => own.id === id)) || null;

/**
 * Die eigene Kategorie eines Eintrags – null, wenn er keine hat, es sie nicht mehr gibt oder sie
 * sich wie etwas anderes verhält als der Eintrag (nach einem Wechsel der Kategorie).
 */
export function ownKindOf(
  data: WithKinds,
  entity: Pick<Entity, 'kind' | 'ownKindId'>,
): OwnKind | null {
  const own = ownKindById(data, entity.ownKindId);
  return own && own.base === entity.kind ? own : null;
}

/** Wie die Kategorie eines Eintrags heißt: die eigene, sonst die von Wayfarer. */
export const kindLabelOf = (data: WithKinds, entity: Pick<Entity, 'kind' | 'ownKindId'>): string =>
  ownKindOf(data, entity)?.name ?? KIND_LABEL[entity.kind];

/** Die Mehrzahl einer eigenen Kategorie – ohne Angabe der Name. */
export const ownPlural = (own: OwnKind): string => own.plural.trim() || own.name;

/** Die Einträge einer eigenen Kategorie. */
export function entriesOfOwnKind(data: CampaignData, ownId: string): Entity[] {
  const own = ownKindById(data, ownId);
  if (!own) return [];
  return Object.values(data.entities).filter(
    (entity) => entity.ownKindId === ownId && entity.kind === own.base,
  );
}

/** Wie viele Einträge jede eigene Kategorie hat. */
export function ownKindCounts(data: CampaignData): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entity of Object.values(data.entities)) {
    const own = ownKindOf(data, entity);
    if (own) counts.set(own.id, (counts.get(own.id) ?? 0) + 1);
  }
  return counts;
}

const fold = (text: string) => text.trim().toLocaleLowerCase('de');

/** Gibt es die Kategorie schon – gleicher Name, gleiche Grundkategorie? */
export const ownKindNamed = (data: WithKinds, base: EntityKind, name: string): OwnKind | null =>
  data.campaign.ownKinds.find((own) => own.base === base && fold(own.name) === fold(name)) ?? null;

/** Ab so vielen Einträgen mit demselben eigenen Wort lohnt der Vorschlag. */
export const OWN_KIND_FROM = 5;

export interface OwnKindSuggestion {
  base: EntityKind;
  /** Das eigene Wort, so wie es am häufigsten geschrieben ist. */
  word: string;
  entityIds: string[];
  key: string;
}

/**
 * Vorschläge aus den eigenen Wörtern: „47 Orte heißen Stadt – als eigene Kategorie führen?“ Nur
 * Wörter, die oft genug vorkommen, noch keine eigene Kategorie sind und nicht weggeklickt wurden;
 * die häufigsten zuerst. Einträge, die schon eine eigene Kategorie haben, zählen nicht.
 */
export function ownKindSuggestions(data: CampaignData, base: EntityKind): OwnKindSuggestion[] {
  const groups = new Map<string, { words: Map<string, number>; ids: string[] }>();
  for (const entity of Object.values(data.entities)) {
    if (entity.kind !== base || ownKindOf(data, entity)) continue;
    const word = entityCategory(entity).trim();
    if (!word) continue;
    const group = groups.get(fold(word)) ?? { words: new Map<string, number>(), ids: [] };
    group.words.set(word, (group.words.get(word) ?? 0) + 1);
    group.ids.push(entity.id);
    groups.set(fold(word), group);
  }
  const own = { one: fold(KIND_LABEL[base]), many: fold(KIND_LABEL_PLURAL[base]) };
  return [...groups]
    .filter(
      ([key, group]) => group.ids.length >= OWN_KIND_FROM && key !== own.one && key !== own.many,
    )
    .map(([, group]) => {
      const word = [...group.words].sort((a, b) => b[1] - a[1])[0]![0];
      return { base, word, entityIds: group.ids, key: SUGGESTION.ownKind(base, word) };
    })
    .filter((suggestion) => !ownKindNamed(data, base, suggestion.word))
    .filter((suggestion) => !isDismissed(data, suggestion.key))
    .sort((a, b) => b.entityIds.length - a.entityIds.length || a.word.localeCompare(b.word, 'de'));
}
