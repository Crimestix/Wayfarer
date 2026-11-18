/**
 * Noch zu schreiben: wo das Wiki Lücken hat. Verweise auf Artikel, die es noch nicht gibt (je
 * Titel, wie oft und wo), Einträge der Welt ohne Artikel, Artikel, auf die nichts verweist, und
 * Artikel, die noch sehr kurz sind. Wayfarer zählt und zeigt nur – was davon geschrieben wird,
 * entscheidet der Spielleiter. Reine Funktionen.
 */
import { articleParts, plainMarkdown } from '../../domain/articleText';
import { isRoom, roomArticleIds } from '../../domain/rooms';
import type { Article, CampaignData, Entity, EntityKind } from '../../domain/schema';
import {
  articleFacts,
  factField,
  kindFromFolderTitle,
  statedKind,
  targetKinds,
  worldIndex,
} from './facts';
import { splitTarget } from './markdown';
import { backlinks } from './model';
import { linkIndex, pageText, titleKey } from './text';

type Articles = CampaignData['articles'];
/** Mehr als Artikel und Einträge braucht die Rechnung nicht – so gilt sie über Zeit und Zustand hinweg. */
export type WikiData = Pick<CampaignData, 'articles' | 'entities'>;

/** Unter so vielen Wörtern Fließtext (ohne Steckbrief) gilt ein Artikel als Stummel. */
export const STUB_WORDS = 30;

/** Eine Stelle, an der etwas erwähnt wird: der Artikel, wie oft, und ein Stück Text drumherum. */
export interface GapMention {
  articleId: string;
  title: string;
  count: number;
  /** Die erste Erwähnung mit etwas Text davor und danach. */
  snippet: string;
}

export interface MissingTitle {
  /** So steht der Titel im ersten Verweis. */
  title: string;
  /** Wie oft insgesamt darauf verwiesen wird. */
  count: number;
  /** Die Artikel, die darauf verweisen – die häufigsten zuerst. */
  mentions: GapMention[];
  /**
   * Als was er wohl anzulegen ist – gelesen aus dem Feld des Steckbriefs, in dem der Verweis
   * steht („Wohnort: [[Salzgrotte]]“ meint einen Ort). Leer = verrät nichts. Nur ein Vorschlag.
   */
  kinds: EntityKind[];
}

export interface EntryWithoutArticle {
  entity: Entity;
  /** Wie oft im Wiki auf diesen Namen verwiesen wird, ohne dass es den Artikel gibt. */
  count: number;
  mentions: GapMention[];
}

export interface StubArticle {
  article: Article;
  /** Wörter im Fließtext, ohne Steckbrief. */
  words: number;
  /** Wie viele andere Artikel ihn erwähnen. */
  mentionedBy: number;
}

export interface WikiGaps {
  /** Verweise auf Titel ohne Artikel und ohne Eintrag – am häufigsten erwähnte zuerst. */
  missing: MissingTitle[];
  /** Einträge der Welt ohne Artikel – erwähnte zuerst, dann nach Namen. */
  entries: EntryWithoutArticle[];
  /** Artikel, auf die nichts verweist – ohne Ordnerseiten, Vorlagen und Räume. */
  orphans: Article[];
  /** Sehr kurze Artikel – oft erwähnte zuerst. */
  stubs: StubArticle[];
}

/** Ein Verweis im Text: `[[Ziel]]` oder `[[Ziel|Text]]`, nicht mit „\\“ davor. */
const LINK = /(?<!\\)\[\[([^[\]\n|]+)(?:\|([^[\]\n]*))?\]\]/g;
const FENCE = /^\s*(```|~~~)/;
/** Eine Zeile „Feld: …“ in einem Kasten. */
const QUOTED_FACT = /^(?:>\s?)+([^:\n]{1,60}):/;

const words = (text: string): number =>
  text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Ein Stück Text um die Erwähnung, an Wortgrenzen geschnitten. */
function snippetOf(line: string, shown: string): string {
  const plain = plainMarkdown(line).replace(/\s+/g, ' ').trim();
  const at = plain.toLocaleLowerCase('de').indexOf(shown.toLocaleLowerCase('de'));
  if (at < 0) return plain.length > 140 ? `${plain.slice(0, 140).trimEnd()} …` : plain;
  let from = Math.max(0, at - 60);
  if (from > 0) {
    const space = plain.indexOf(' ', from);
    if (space >= 0 && space < at) from = space + 1;
  }
  let to = Math.min(plain.length, at + shown.length + 70);
  if (to < plain.length) {
    const space = plain.lastIndexOf(' ', to);
    if (space > at + shown.length) to = space;
  }
  return (from > 0 ? '… ' : '') + plain.slice(from, to).trim() + (to < plain.length ? ' …' : '');
}

interface Found {
  title: string;
  total: number;
  byArticle: Map<string, GapMention>;
  kinds: EntityKind[];
}

/** Sammelt alle Verweise, die ins Leere führen – je Titel, mit Stellen und Art aus dem Feld. */
function collectWanted(data: WikiData): Map<string, Found> {
  const articles = data.articles;
  const index = linkIndex(articles);
  const world = worldIndex(data);
  const found = new Map<string, Found>();
  const sorted = Object.values(articles)
    .filter((article) => !article.template)
    .sort((a, b) => a.title.localeCompare(b.title, 'de') || a.id.localeCompare(b.id));
  for (const article of sorted) {
    /** Als was dieser Artikel in der Welt steht – erst gelesen, wenn ein Feld es braucht. */
    let kind: EntityKind | null | undefined;
    const kindOfArticle = (): EntityKind | null => {
      if (kind === undefined)
        kind =
          world.byArticle.get(article.id)?.[0]?.kind ??
          statedKind(articleFacts(articles, article))?.kind ??
          null;
      return kind;
    };
    for (const doc of article.docs) {
      if (doc.kind !== 'page') continue;
      let fence: string | null = null;
      for (const line of pageText(articles, article, doc).split('\n')) {
        const open = FENCE.exec(line);
        if (open) {
          fence = fence === null ? open[1]! : fence === open[1] ? null : fence;
          continue;
        }
        if (fence !== null || !line.includes('[[')) continue;
        for (const match of line.matchAll(LINK)) {
          const target = match[1]!.trim();
          if (!target || index.resolve(target)) continue;
          const title = splitTarget(target).title;
          const key = titleKey(title);
          if (!key) continue;
          let entry = found.get(key);
          if (!entry) {
            entry = { title, total: 0, byArticle: new Map(), kinds: [] };
            found.set(key, entry);
          }
          entry.total++;
          const mention = entry.byArticle.get(article.id);
          if (mention) mention.count++;
          else
            entry.byArticle.set(article.id, {
              articleId: article.id,
              title: article.title,
              count: 1,
              snippet: snippetOf(line, match[2]?.trim() || title),
            });
          // Steht der Verweis in einem Feld des Steckbriefs, sagt das Feld, was gemeint ist.
          const label = QUOTED_FACT.exec(line)?.[1]?.trim();
          const own = label ? kindOfArticle() : null;
          const field = own && label ? factField(own, label) : null;
          for (const target of field ? targetKinds(field) : [])
            if (target !== 'character' && !entry.kinds.includes(target)) entry.kinds.push(target);
        }
      }
    }
  }
  return found;
}

const mentionsOf = (entry: Found): GapMention[] =>
  [...entry.byArticle.values()].sort(
    (a, b) => b.count - a.count || a.title.localeCompare(b.title, 'de'),
  );

/** Hat dieser Eintrag einen Artikel im eigenen Wiki? */
const hasArticle = (articles: Articles, entity: Entity) =>
  !!entity.lk?.resourceId && !!articles[entity.lk.resourceId];

/** Wörter im Fließtext aller Textseiten eines Artikels, ohne Steckbrief. */
export function articleWords(articles: Articles, article: Article): number {
  let total = 0;
  for (const doc of article.docs)
    if (doc.kind === 'page')
      total += words(plainMarkdown(articleParts(pageText(articles, article, doc)).body));
  return total;
}

/**
 * Was im Wiki noch zu schreiben ist. Gerechnet über alle Artikel; die Oberfläche merkt sich das
 * Ergebnis je Stand der Artikel und Einträge.
 */
export function wikiGaps(data: WikiData): WikiGaps {
  const articles = data.articles;
  const world = worldIndex(data);
  const wanted = collectWanted(data);

  // (1) Verweise ins Leere – und Einträge der Welt, zu denen es keinen Artikel gibt.
  const missing: MissingTitle[] = [];
  const entries = new Map<string, EntryWithoutArticle>();
  for (const [key, entry] of wanted) {
    const owner = (world.byName.get(key) ?? []).find(
      (entity) => entity.kind !== 'character' && !hasArticle(articles, entity),
    );
    if (owner) {
      const known = entries.get(owner.id);
      if (known) {
        known.count += entry.total;
        known.mentions = [...known.mentions, ...mentionsOf(entry)];
      } else
        entries.set(owner.id, { entity: owner, count: entry.total, mentions: mentionsOf(entry) });
    } else
      missing.push({
        title: entry.title,
        count: entry.total,
        mentions: mentionsOf(entry),
        kinds: entry.kinds,
      });
  }
  for (const entity of Object.values(data.entities)) {
    if (entity.kind === 'character' || entries.has(entity.id) || hasArticle(articles, entity))
      continue;
    // Räume stehen auf der Seite ihres Ortes; sie brauchen keinen eigenen Artikel.
    if (isRoom(data, entity)) continue;
    entries.set(entity.id, { entity, count: 0, mentions: [] });
  }
  missing.sort(
    (a, b) =>
      b.count - a.count ||
      b.mentions.length - a.mentions.length ||
      a.title.localeCompare(b.title, 'de'),
  );

  // (2) und (3): Waisen und Stummel – ohne Vorlagen, Räume und Ordnerseiten.
  const rooms = roomArticleIds(data);
  const parents = new Set<string>();
  for (const article of Object.values(articles))
    if (article.parentId && articles[article.parentId]) parents.add(article.parentId);
  const links = backlinks(articles);
  const orphans: Article[] = [];
  const stubs: StubArticle[] = [];
  for (const article of Object.values(articles)) {
    if (article.template || rooms.has(article.id) || parents.has(article.id)) continue;
    const mentionedBy = links.get(article.id)?.length ?? 0;
    if (!mentionedBy) orphans.push(article);
    // Eine Karte ist auch Inhalt: Artikel mit Karte zählen nicht als kurz.
    if (article.docs.some((doc) => doc.kind === 'map' && doc.mapId)) continue;
    const count = articleWords(articles, article);
    if (count < STUB_WORDS) stubs.push({ article, words: count, mentionedBy });
  }
  orphans.sort((a, b) => a.title.localeCompare(b.title, 'de'));
  stubs.sort(
    (a, b) =>
      b.mentionedBy - a.mentionedBy ||
      a.words - b.words ||
      a.article.title.localeCompare(b.article.title, 'de'),
  );

  return {
    missing,
    entries: [...entries.values()].sort(
      (a, b) => b.count - a.count || a.entity.name.localeCompare(b.entity.name, 'de'),
    ),
    orphans,
    stubs,
  };
}

/**
 * Die Zahl für „Noch zu schreiben: 12“: Verweise ins Leere, erwähnte Einträge ohne Artikel und
 * Stummel. Waisen und nie erwähnte Einträge stehen in der Sicht, zählen hier aber nicht.
 */
export const gapCount = (gaps: WikiGaps): number =>
  gaps.missing.length + gaps.entries.filter((entry) => entry.count > 0).length + gaps.stubs.length;

/**
 * Wo ein neuer Artikel hingehört: in den Ordner, dessen Name zur Art passt („Orte“ für einen Ort),
 * sonst neben den Artikel, der ihn am häufigsten erwähnt. null = ganz oben. Nur ein Vorschlag.
 */
export function newArticleParent(
  articles: Articles,
  kind: EntityKind | null,
  fromIds: readonly string[],
): Article | null {
  if (kind) {
    const folder = Object.values(articles)
      .filter((article) => !article.template && kindFromFolderTitle(article.title) === kind)
      .sort((a, b) => a.title.localeCompare(b.title, 'de') || a.id.localeCompare(b.id))[0];
    if (folder) return folder;
  }
  for (const id of fromIds) {
    const parentId = articles[id]?.parentId;
    const parent = parentId ? articles[parentId] : undefined;
    if (parent && !parent.template) return parent;
  }
  return null;
}

/** Reihenfolge der Arten in Gruppen: wie die Arten der Welt, ohne Art zuletzt. */
const KIND_ORDER: readonly EntityKind[] = [
  'place',
  'person',
  'faction',
  'family',
  'item',
  'topic',
  'species',
  'language',
  'script',
  'ability',
  'plant',
  'animal',
  'mineral',
  'profession',
  'character',
];

/**
 * Teilt eine Liste nach Art – für „Noch zu schreiben“, das sonst mit Einträgen ohne Text
 * vollläuft. Die Reihenfolge in jeder Gruppe bleibt; Gruppen nach `KIND_ORDER`, ohne Art zuletzt.
 */
export function groupByKind<T>(
  items: readonly T[],
  kindOf: (item: T) => EntityKind | null,
): { kind: EntityKind | null; items: T[] }[] {
  const groups = new Map<EntityKind | null, T[]>();
  for (const item of items) {
    const kind = kindOf(item);
    const list = groups.get(kind) ?? [];
    list.push(item);
    groups.set(kind, list);
  }
  const rank = (kind: EntityKind | null) =>
    kind === null ? KIND_ORDER.length + 1 : KIND_ORDER.indexOf(kind) + 1 || KIND_ORDER.length;
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([kind, list]) => ({ kind, items: list }));
}
