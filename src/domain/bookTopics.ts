/**
 * Themen der Welt zum Durchsehen – für die Auswahl eines Buches: Arten, Einordnungen,
 * Schlagworte, Gegenden und Ordner des Wikis. Ein Thema (`BookTopic`) ist eine Bedingung aus
 * diesen Angaben; alle gesetzten gelten zusammen. Ein Buch nimmt alles aus seinen Themen
 * (`selection.rules`, früher eine einzige Regel aus Arten, Gegenden und Einordnungen –
 * `legacyRules`), dazu einzeln dazugenommene, ohne einzeln weggenommene (`domain/book.ts`).
 * Räume stehen nicht einzeln (`isRoom`) und kommen über ein Thema nie hinein. Reine Funktionen.
 */
import { KIND_LABEL_PLURAL, byName, entityCategory, entityName, normalize } from './derive';
import { isRoom } from './rooms';
import { scopeMembers } from './scope';
import {
  BookTopicSchema,
  ENTITY_KINDS,
  type Article,
  type BookSelection,
  type BookTopic,
  type CampaignData,
  type Entity,
  type EntityKind,
} from './schema';

export type { BookTopic };

/** Das leere Thema: schränkt nichts ein. */
export const emptyTopic = (): BookTopic => BookTopicSchema.parse({});

/** Ein Wort zum Vergleichen: ohne Leerraum am Rand, ohne Groß- und Kleinschreibung. */
export const wordKey = (word: string) =>
  word.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');

/** Schränkt das Thema überhaupt ein? */
export const isEmptyTopic = (topic: BookTopic) =>
  !topic.kind &&
  !wordKey(topic.category) &&
  !wordKey(topic.tag) &&
  !topic.regionId &&
  !topic.folderId;

/** Ein Schlüssel je Thema – gleiche Themen, gleicher Schlüssel. */
export const topicKey = (topic: BookTopic) =>
  [
    topic.kind ?? '',
    wordKey(topic.category),
    wordKey(topic.tag),
    topic.regionId ?? '',
    topic.folderId ?? '',
  ].join('|');

export const sameTopic = (a: BookTopic, b: BookTopic) => topicKey(a) === topicKey(b);

/** Ohne doppelte Themen und ohne leere – ein leeres nähme die ganze Welt ins Buch. */
export function distinctTopics(topics: readonly BookTopic[]): BookTopic[] {
  const seen = new Set<string>();
  const out: BookTopic[] = [];
  for (const topic of topics) {
    const k = topicKey(topic);
    if (isEmptyTopic(topic) || seen.has(k)) continue;
    seen.add(k);
    out.push(topic);
  }
  return out;
}

/**
 * Die ältere Form der Auswahl (je eine Liste Arten, Gegenden, Einordnungen, die zusammen gelten)
 * als Themen: jede Verbindung aus Art, Gegend und Einordnung ist eines. Leere Liste = jede.
 */
export function legacyRules(selection: BookSelection): BookTopic[] {
  const { kinds, regionIds, categories } = selection;
  const words = categories.map((c) => c.trim()).filter(Boolean);
  if (!kinds.length && !regionIds.length && !words.length) return [];
  const out: BookTopic[] = [];
  for (const kind of kinds.length ? kinds : [null])
    for (const regionId of regionIds.length ? regionIds : [null])
      for (const category of words.length ? words : [''])
        out.push({ ...emptyTopic(), kind, regionId, category });
  return distinctTopics(out);
}

/** Alle Themen, aus denen das Buch alles nimmt – die ältere Regel eingeschlossen. */
export const bookRules = (selection: BookSelection): BookTopic[] =>
  distinctTopics([...legacyRules(selection), ...selection.rules]);

/** Ein Thema in Worten: „Pflanzen · Kraut · „giftig“ · in Hohenfurt · Ordner Kräuter“. */
export function topicLabel(data: CampaignData, topic: BookTopic): string {
  const parts = [topic.kind ? KIND_LABEL_PLURAL[topic.kind] : 'Alles'];
  if (topic.category.trim()) parts.push(topic.category.trim());
  if (topic.tag.trim()) parts.push(`„${topic.tag.trim()}“`);
  if (topic.regionId) parts.push(`in ${entityName(data, topic.regionId)}`);
  if (topic.folderId) parts.push(`Ordner ${data.articles[topic.folderId]?.title ?? 'gelöscht'}`);
  return parts.join(' · ');
}

// ── Prüfen, ob ein Eintrag zu einem Thema gehört ───────────────────────────

/**
 * Prüft Einträge gegen Themen. Was teuer ist (alles in einer Gegend, die Ordner über einem
 * Artikel), rechnet er einmal je Gegend und Artikel.
 */
export function topicMatcher(data: CampaignData) {
  const regions = new Map<string, Set<string>>();
  const chains = new Map<string, Set<string>>();
  const tagsOf = new Map<string, Set<string>>();

  const region = (placeId: string): Set<string> => {
    let members = regions.get(placeId);
    if (!members) {
      // Eine Gegend, die es nicht (mehr) gibt, lässt nichts übrig.
      members = data.entities[placeId]?.kind === 'place' ? scopeMembers(data, placeId) : new Set();
      regions.set(placeId, members);
    }
    return members;
  };
  /** Der Artikel und alle Artikel darüber. */
  const chain = (articleId: string): Set<string> => {
    let ids = chains.get(articleId);
    if (!ids) {
      ids = new Set();
      let current: Article | undefined = data.articles[articleId];
      while (current && !ids.has(current.id)) {
        ids.add(current.id);
        current = current.parentId ? data.articles[current.parentId] : undefined;
      }
      chains.set(articleId, ids);
    }
    return ids;
  };
  const tags = (entity: Entity): Set<string> => {
    let words = tagsOf.get(entity.id);
    if (!words) {
      const article = entity.lk ? data.articles[entity.lk.resourceId] : undefined;
      words = new Set([...entity.tags, ...(article?.tags ?? [])].map(wordKey).filter(Boolean));
      tagsOf.set(entity.id, words);
    }
    return words;
  };

  const inFolder = (entity: Entity, folderId: string) =>
    !!entity.lk &&
    !!data.articles[entity.lk.resourceId] &&
    chain(entity.lk.resourceId).has(folderId);

  /** Gehört der Eintrag zum Thema? Räume nie. Das leere Thema nimmt alles. */
  const matches = (topic: BookTopic, entity: Entity): boolean => {
    if (isRoom(data, entity)) return false;
    if (topic.kind && entity.kind !== topic.kind) return false;
    const category = wordKey(topic.category);
    if (category && wordKey(entityCategory(entity)) !== category) return false;
    const tag = wordKey(topic.tag);
    if (tag && !tags(entity).has(tag)) return false;
    if (topic.folderId && !inFolder(entity, topic.folderId)) return false;
    if (topic.regionId && !region(topic.regionId).has(entity.id)) return false;
    return true;
  };
  return { matches, tags };
}

/**
 * Die Einträge eines Themas, nach Namen – ohne Räume und ohne `withoutId` (das Buch selbst).
 * Das leere Thema nimmt alles.
 */
export function topicEntries(data: CampaignData, topic: BookTopic, withoutId?: string): Entity[] {
  const { matches } = topicMatcher(data);
  return Object.values(data.entities)
    .filter((entity) => entity.id !== withoutId && matches(topic, entity))
    .sort(byName);
}

/** Die Einträge, die ein Buch über seine Themen nimmt (ohne „dazu“ und „weg“, ohne sich selbst). */
export function ruleMembers(
  data: CampaignData,
  selection: BookSelection,
  selfId: string,
): Set<string> {
  const rules = bookRules(selection);
  const out = new Set<string>();
  if (!rules.length) return out;
  const { matches } = topicMatcher(data);
  for (const entity of Object.values(data.entities))
    if (entity.id !== selfId && rules.some((rule) => matches(rule, entity))) out.add(entity.id);
  return out;
}

/** Sucht in Namen und Beinamen. */
export function nameMatches(entity: Entity, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  return [entity.name, ...entity.aliases].some((name) => normalize(name).includes(q));
}

// ── Was es zum Durchsehen gibt ─────────────────────────────────────────────

export interface TopicChoice {
  /** Das Wort, wie es zuerst geschrieben steht. */
  label: string;
  count: number;
}

export interface PlaceChoice {
  id: string;
  name: string;
  /** Wie tief der Ort liegt – zum Einrücken. */
  depth: number;
}

export interface FolderChoice {
  id: string;
  title: string;
  /** Die Ordner darüber, vom obersten an. */
  path: string[];
  depth: number;
  /** So viele Einträge liegen darin. */
  count: number;
}

export interface BookTopics {
  /** Arten mit Einträgen, in der Reihenfolge der Arten. */
  kinds: { kind: EntityKind; count: number }[];
  /** Einordnungen der gewählten Art (ohne Art: aller), nach Namen. */
  categories: TopicChoice[];
  /** Schlagworte der gewählten Art (ohne Art: aller) – des Eintrags oder seines Artikels. */
  tags: TopicChoice[];
  /** Gegenden: alle Orte ohne Räume, als Baum wie in der Welt. */
  regions: PlaceChoice[];
  /** Ordner des Wikis: Artikel mit Artikeln darunter, in denen Einträge liegen – wie im Baum. */
  folders: FolderChoice[];
}

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Zählt Wörter ohne Rücksicht auf Groß- und Kleinschreibung. */
function tally(words: Iterable<string>, into: Map<string, TopicChoice>) {
  for (const raw of words) {
    const word = raw.trim();
    const k = wordKey(word);
    if (!k) continue;
    const seen = into.get(k);
    if (seen) seen.count++;
    else into.set(k, { label: word, count: 1 });
  }
}

const byLabel = (a: TopicChoice, b: TopicChoice) => collator.compare(a.label, b.label);

/**
 * Alles, wonach man Einträge der Welt zusammensuchen kann. Einordnungen und Schlagworte gelten
 * für die gewählte Art; Gegenden und Ordner für die ganze Welt.
 */
export function bookTopics(data: CampaignData, kind: EntityKind | null = null): BookTopics {
  const entries = Object.values(data.entities).filter((entity) => !isRoom(data, entity));
  const { tags } = topicMatcher(data);

  const kindCount = new Map<EntityKind, number>();
  const categories = new Map<string, TopicChoice>();
  const tagChoices = new Map<string, TopicChoice>();
  for (const entity of entries) {
    kindCount.set(entity.kind, (kindCount.get(entity.kind) ?? 0) + 1);
    if (kind && entity.kind !== kind) continue;
    tally([entityCategory(entity)], categories);
    // Schlagworte mit der Schreibweise des Eintrags, sonst des Artikels.
    const article = entity.lk ? data.articles[entity.lk.resourceId] : undefined;
    const written = new Map<string, string>();
    for (const word of [...entity.tags, ...(article?.tags ?? [])])
      if (!written.has(wordKey(word))) written.set(wordKey(word), word);
    tally(
      [...tags(entity)].map((k) => written.get(k) ?? k),
      tagChoices,
    );
  }

  return {
    kinds: ENTITY_KINDS.filter((k) => kindCount.has(k)).map((k) => ({
      kind: k,
      count: kindCount.get(k)!,
    })),
    categories: [...categories.values()].sort(byLabel),
    tags: [...tagChoices.values()].sort(byLabel),
    regions: regionChoices(data),
    folders: folderChoices(data, entries),
  };
}

/**
 * Alle Orte als Baum, ohne Räume (sie gehören zu ihrem Ort). Auch ein Ort ohne Orte darunter ist
 * eine Gegend: Im Dunkelwald wachsen Kräuter, in der Salzgrotte (nur mit Räumen) hausen Wesen.
 */
function regionChoices(data: CampaignData): PlaceChoice[] {
  const places = Object.values(data.entities).filter(
    (entity) => entity.kind === 'place' && !isRoom(data, entity),
  );
  const kids = new Map<string, Entity[]>();
  const roots: Entity[] = [];
  for (const place of places) {
    const parentId = place.kind === 'place' ? place.place.parentId : null;
    if (parentId && data.entities[parentId]?.kind === 'place' && parentId !== place.id) {
      const list = kids.get(parentId);
      if (list) list.push(place);
      else kids.set(parentId, [place]);
    } else roots.push(place);
  }
  const out: PlaceChoice[] = [];
  const seen = new Set<string>();
  const walk = (place: Entity, depth: number) => {
    if (seen.has(place.id)) return;
    seen.add(place.id);
    const children = (kids.get(place.id) ?? []).sort(byName);
    out.push({ id: place.id, name: place.name, depth });
    for (const child of children) walk(child, depth + 1);
  };
  for (const root of roots.sort(byName)) walk(root, 0);
  return out;
}

/** Ordner des Wikis, in denen Einträge liegen – in der Reihenfolge des Baums. */
function folderChoices(data: CampaignData, entries: Entity[]): FolderChoice[] {
  const articles = Object.values(data.articles).filter((article) => !article.template);
  const kids = new Map<string, Article[]>();
  const roots: Article[] = [];
  for (const article of articles) {
    const parent = article.parentId ? data.articles[article.parentId] : undefined;
    if (parent && !parent.template && parent.id !== article.id) {
      const list = kids.get(parent.id);
      if (list) list.push(article);
      else kids.set(parent.id, [article]);
    } else roots.push(article);
  }
  // Wie viele Einträge in jedem Artikel und darunter liegen.
  const own = new Map<string, number>();
  for (const entity of entries)
    if (entity.lk && data.articles[entity.lk.resourceId])
      own.set(entity.lk.resourceId, (own.get(entity.lk.resourceId) ?? 0) + 1);
  const byOrder = (a: Article, b: Article) =>
    a.order < b.order ? -1 : a.order > b.order ? 1 : collator.compare(a.title, b.title);

  const out: FolderChoice[] = [];
  const seen = new Set<string>();
  const walk = (article: Article, path: string[]): number => {
    if (seen.has(article.id)) return 0;
    seen.add(article.id);
    const children = (kids.get(article.id) ?? []).sort(byOrder);
    const at = out.length;
    let count = own.get(article.id) ?? 0;
    const below = [...path, article.title];
    for (const child of children) count += walk(child, below);
    if (children.length && count > 0)
      out.splice(at, 0, { id: article.id, title: article.title, path, depth: path.length, count });
    return count;
  };
  for (const root of roots.sort(byOrder)) walk(root, []);
  return out;
}
