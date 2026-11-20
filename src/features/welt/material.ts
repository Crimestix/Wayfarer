/**
 * Die Mappe (F05): Material, das zur Arbeit an einem Text oder einer Geschichte gehört – Einträge,
 * andere Texte, Geschichten, Wegenetze, Hexkarten, Dungeons. Angeheftet wird nur ein Verweis; was
 * angeheftet ist, öffnet man mit einem Klick, und auf dem Material steht der Rückweg („Liegt in der
 * Mappe von …“). Text, Brett und Karte bleiben gleichberechtigt: Jede Art kann jede andere tragen.
 */
import type { CampaignDb } from '../../data/db';
import type { CampaignData, MaterialRef } from '../../domain/schema';
import { recentWork } from './model';

/** Wem eine Mappe gehört: ein Text oder eine Geschichte. */
export type MaterialOwner = { type: 'article' | 'story'; id: string };

export interface MaterialItem {
  ref: MaterialRef;
  title: string;
  /** Was es ist, in einem Wort: „Text“, „Geschichte“, „Hexkarte“ … oder die Kategorie. */
  label: string;
  href: string;
}

const TYPE_OF_LABEL: Record<string, MaterialRef['type']> = {
  Text: 'article',
  Geschichte: 'story',
  Wegenetz: 'net',
  Hexkarte: 'area',
  Dungeon: 'dungeon',
};

export function sameRef(a: MaterialRef, b: MaterialRef): boolean {
  return a.type === b.type && a.id === b.id;
}

/**
 * Alles, was sich anheften lässt, zuletzt Bearbeitetes zuerst – dieselbe Liste wie
 * „Weiterarbeiten“ (`recentWork`). Ein Text, der einem Eintrag gehört, steht als dieser Eintrag da.
 */
export function materialChoices(data: CampaignData): MaterialItem[] {
  return recentWork(data, Number.MAX_SAFE_INTEGER).map((work) => ({
    ref: { type: work.entity ? 'entity' : (TYPE_OF_LABEL[work.label] ?? 'article'), id: work.key },
    title: work.title,
    label: work.label,
    href: work.href,
  }));
}

/** Ein Verweis in Worten und mit Adresse; null, wenn es ihn nicht mehr gibt. */
export function materialItem(data: CampaignData, ref: MaterialRef): MaterialItem | null {
  return materialChoices(data).find((item) => sameRef(item.ref, ref)) ?? null;
}

/** Ein Text, der einem Eintrag gehört, zählt als der Eintrag – so gibt es keine Doppel. */
export function normalRef(data: CampaignData, ref: MaterialRef): MaterialRef {
  return normalizer(data)(ref);
}

/** Wie `normalRef`, aber mit einmal gebautem Verzeichnis – für viele Verweise auf einmal. */
function normalizer(data: CampaignData): (ref: MaterialRef) => MaterialRef {
  const ownerOf = new Map<string, string>();
  for (const entity of Object.values(data.entities))
    if (entity.lk?.resourceId) ownerOf.set(entity.lk.resourceId, entity.id);
  return (ref) => {
    if (ref.type !== 'article') return ref;
    const owner = ownerOf.get(ref.id);
    return owner ? { type: 'entity', id: owner } : ref;
  };
}

function listOf(data: CampaignData, owner: MaterialOwner): MaterialRef[] {
  return owner.type === 'article'
    ? (data.articles[owner.id]?.material ?? [])
    : (data.stories[owner.id]?.material ?? []);
}

/** Die Mappe eines Textes oder einer Geschichte, in ihrer Reihenfolge; Verschwundenes fällt weg. */
export function materialOf(data: CampaignData, owner: MaterialOwner): MaterialItem[] {
  const choices = materialChoices(data);
  return listOf(data, owner)
    .map((ref) => choices.find((item) => sameRef(item.ref, ref)))
    .filter((item): item is MaterialItem => !!item);
}

/** Der Verweis auf den Besitzer einer Mappe selbst (um sich nicht selbst anzuheften). */
export function ownerRef(data: CampaignData, owner: MaterialOwner): MaterialRef {
  return normalRef(data, { type: owner.type, id: owner.id });
}

/** In wessen Mappen etwas liegt – für den Rückweg auf dem Material. */
export function pinnedIn(data: CampaignData, ref: MaterialRef): MaterialItem[] {
  const normal = normalizer(data);
  const target = normal(ref);
  const owners: MaterialOwner[] = [
    ...Object.values(data.articles)
      .filter((a) => a.material.some((r) => sameRef(normal(r), target)))
      .map((a) => ({ type: 'article' as const, id: a.id })),
    ...Object.values(data.stories)
      .filter((s) => s.material.some((r) => sameRef(normal(r), target)))
      .map((s) => ({ type: 'story' as const, id: s.id })),
  ];
  if (!owners.length) return [];
  const choices = materialChoices(data);
  return owners
    .map((owner) => choices.find((item) => sameRef(item.ref, normal(owner))))
    .filter((item): item is MaterialItem => !!item);
}

/** Heftet an (nie doppelt, nie sich selbst). Gibt `undo` zurück, sonst null. */
export function pinMaterial(
  db: CampaignDb,
  owner: MaterialOwner,
  ref: MaterialRef,
): (() => void) | null {
  const data = db.getSnapshot();
  const target = normalRef(data, ref);
  const list = listOf(data, owner);
  if (sameRef(target, ownerRef(data, owner))) return null;
  if (list.some((r) => sameRef(normalRef(data, r), target))) return null;
  write(db, owner, [...list, target]);
  return () => unpinMaterial(db, owner, target);
}

/** Nimmt aus der Mappe – das Material selbst bleibt. Gibt `undo` zurück. */
export function unpinMaterial(db: CampaignDb, owner: MaterialOwner, ref: MaterialRef): () => void {
  const data = db.getSnapshot();
  const list = listOf(data, owner);
  const index = list.findIndex((r) => sameRef(r, ref));
  if (index < 0) return () => {};
  write(
    db,
    owner,
    list.filter((_, i) => i !== index),
  );
  return () => {
    const now = listOf(db.getSnapshot(), owner);
    if (now.some((r) => sameRef(r, ref))) return;
    write(db, owner, [...now.slice(0, index), ref, ...now.slice(index)]);
  };
}

function write(db: CampaignDb, owner: MaterialOwner, material: MaterialRef[]): void {
  if (owner.type === 'article') db.patch('articles', owner.id, { material });
  else db.patch('stories', owner.id, { material });
}
