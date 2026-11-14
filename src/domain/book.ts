/**
 * Bücher in der Welt: Ein Buch ist ein Gegenstand mit Verfasser, dessen Seiten Wayfarer aus den
 * Artikeln des Spielleiters zusammenstellt – ein Kräuterbuch aus den Pflanzen einer Gegend, eine
 * Chronik der Häuser, ein Bestiarium eines Gelehrten. Wayfarer formuliert nie selbst: Eine Seite
 * ist der Steckbrief und der Wortlaut des Artikels, wie der Spielleiter ihn geschrieben hat – ohne
 * Kästen für die Spielleitung, ohne Geheimnis und Notizen des Eintrags. Eine überschriebene Seite
 * steht in den Worten des Verfassers (mit seinen Irrtümern) und wächst nicht mehr mit dem Artikel
 * mit. Reine Funktionen; geschrieben wird über `features/welt/book.ts`.
 */
import { articleParts, plainMarkdown, withoutSecrets, type ArticleFact } from './articleText';
import { KIND_LABEL_PLURAL, byName, entityCategory, entityName } from './derive';
import {
  bookRules,
  isEmptyTopic,
  nameMatches,
  ruleMembers,
  sameTopic,
  topicEntries,
  type BookTopic,
} from './bookTopics';
import { formatDatePoint } from './lifespan';
import {
  BookSchema,
  ENTITY_KINDS,
  PARTY_ID,
  type Book,
  type BookOrder,
  type CampaignData,
  type Entity,
  type EntityKind,
  type Handout,
  type Item,
} from './schema';

export type { ArticleFact };

export const BOOK_ORDER_LABEL: Record<BookOrder, string> = {
  alpha: 'Nach Namen',
  region: 'Nach Gegend',
  category: 'Nach Einordnung',
};

/** Ein neues, leeres Buch. */
export const emptyBook = (): Book => BookSchema.parse({});

/** Ein Gegenstand, der ein Buch ist. */
export type BookItem = Item & { item: { book: Book } };

export const isBook = (entity: Entity | undefined): entity is BookItem =>
  entity?.kind === 'item' && entity.item.book !== null;

// ── Auswahl ────────────────────────────────────────────────────────────────

/**
 * Die Einträge, die im Buch stehen – nach Namen: alles aus den Themen des Buches (`bookRules`,
 * ohne Räume), dazu die einzeln dazugenommenen, ohne die einzeln weggenommenen. Das Buch selbst
 * steht nie darin.
 */
export function bookEntries(data: CampaignData, item: Entity): Entity[] {
  if (!isBook(item)) return [];
  const { selection } = item.item.book;
  const out = ruleMembers(data, selection, item.id);
  for (const id of selection.include) if (data.entities[id]) out.add(id);
  for (const id of selection.exclude) out.delete(id);
  out.delete(item.id);
  return [...out].map((id) => data.entities[id]!).sort(byName);
}

// ── Durchsehen: ein Thema mit Kästchen ─────────────────────────────────────

/** Ein Eintrag beim Durchsehen. */
export interface TopicRow {
  entity: Entity;
  /** Steht im Buch. */
  inBook: boolean;
  /** Steht über ein Thema des Buches darin (und nicht nur einzeln). */
  byRule: boolean;
  /** Sein Artikel ist vor den Spielern verborgen – im Buch fehlt die Seite. */
  withheld: boolean;
}

export interface TopicRowGroup {
  label: string;
  rows: TopicRow[];
}

export interface TopicListing {
  /** Weder Thema noch Suche – es gibt nichts zu zeigen. */
  idle: boolean;
  groups: TopicRowGroup[];
  /** So viele Einträge zeigt die Liste, so viele davon stehen im Buch. */
  total: number;
  inBook: number;
  /** Nimmt das Buch alles aus diesem Thema – auch, was später dazukommt? */
  ruleOn: boolean;
  /** Was einzeln im Buch steht, aber nicht zum Thema gehört (ohne Thema: alles Einzelne). */
  elsewhere: Entity[];
  /** So viele Einträge stehen außerhalb des Themas über ein Thema des Buches darin. */
  elsewhereByRule: number;
}

const WITHOUT_CATEGORY = 'Ohne Einordnung';

/**
 * Ein Thema zum Durchsehen: seine Einträge (mit der Suche nach Namen eingegrenzt), jeweils ob sie
 * im Buch stehen – nach Einordnung, wenn eine Art gewählt ist, sonst nach Art. Dazu, was sonst
 * noch im Buch steht.
 */
export function topicListing(
  data: CampaignData,
  item: BookItem,
  topic: BookTopic,
  query = '',
): TopicListing {
  const { selection } = item.item.book;
  const emptyTopic = isEmptyTopic(topic);
  const inBook = new Set(bookEntries(data, item).map((entity) => entity.id));
  const byRule = ruleMembers(data, selection, item.id);
  const ruleOn = !emptyTopic && bookRules(selection).some((rule) => sameTopic(rule, topic));
  const all = emptyTopic && !query.trim() ? [] : topicEntries(data, topic, item.id);
  const inTopic = new Set(all.map((entity) => entity.id));
  // Was über ein Thema darin steht, nur gezählt – sonst stünden hier ganze Themen Name für Name.
  const outside = [...inBook].filter((id) => !inTopic.has(id));
  const elsewhere = outside
    .filter((id) => !byRule.has(id))
    .map((id) => data.entities[id]!)
    .sort(byName);
  const elsewhereByRule = outside.length - elsewhere.length;
  if (emptyTopic && !query.trim())
    return {
      idle: true,
      groups: [],
      total: 0,
      inBook: 0,
      ruleOn,
      elsewhere,
      elsewhereByRule,
    };

  const shown = all.filter((entity) => nameMatches(entity, query));
  // Nach Einordnung nur, wenn es welche gibt – Personen haben keine.
  const byCategory = !!topic.kind && shown.some((entity) => entityCategory(entity).trim());
  const groups = new Map<string, TopicRow[]>();
  for (const entity of shown) {
    const label = byCategory
      ? entityCategory(entity).trim() || WITHOUT_CATEGORY
      : KIND_LABEL_PLURAL[entity.kind];
    const article = entity.lk ? data.articles[entity.lk.resourceId] : undefined;
    const row: TopicRow = {
      entity,
      inBook: inBook.has(entity.id),
      byRule: byRule.has(entity.id),
      withheld: !!article?.hidden && !article.template,
    };
    const list = groups.get(label);
    if (list) list.push(row);
    else groups.set(label, [row]);
  }
  const kindOrder = (label: string) =>
    ENTITY_KINDS.findIndex((kind) => KIND_LABEL_PLURAL[kind] === label);
  const sorted = [...groups.entries()].sort(([a], [b]) =>
    byCategory
      ? Number(a === WITHOUT_CATEGORY) - Number(b === WITHOUT_CATEGORY) ||
        a.localeCompare(b, 'de', { numeric: true })
      : kindOrder(a) - kindOrder(b),
  );
  return {
    idle: false,
    groups: sorted.map(([label, rows]) => ({ label, rows })),
    total: shown.length,
    inBook: shown.filter((entity) => inBook.has(entity.id)).length,
    ruleOn,
    elsewhere,
    elsewhereByRule,
  };
}

// ── Seiten ─────────────────────────────────────────────────────────────────

/** Was der Artikel eines Eintrags den Lesern sagt: sein Wortlaut ohne die Kästen für die Spielleitung. */
export interface ArticleWording {
  articleId: string | null;
  /** Steckbrief und Text, ohne Geheimes – Markdown wie im Wiki. */
  text: string;
  /** Der Artikel ist vor den Spielern verborgen: Nichts daraus steht im Buch. */
  withheld: boolean;
}

/**
 * Der Wortlaut des Artikels zu einem Eintrag, wie ein Buch ihn wiedergibt: alle Textseiten, die
 * nicht verborgen sind (weitere Seiten mit ihrem Titel als Überschrift), ohne `> [!geheim]`.
 */
export function articleWording(data: CampaignData, entity: Entity): ArticleWording {
  const article = entity.lk ? data.articles[entity.lk.resourceId] : undefined;
  if (!article || article.template) return { articleId: null, text: '', withheld: false };
  if (article.hidden) return { articleId: article.id, text: '', withheld: true };
  const parts = article.docs
    .filter((doc) => doc.kind === 'page' && !doc.hidden && doc.text.trim())
    .map((doc, index) =>
      index > 0 && doc.title.trim() ? `## ${doc.title.trim()}\n\n${doc.text}` : doc.text,
    );
  return { articleId: article.id, text: withoutSecrets(parts.join('\n\n')), withheld: false };
}

/** Eine Seite des Buches. */
export interface BookPageView {
  entityId: string;
  /** Der Name des Eintrags – die Kopfzeile der Seite. */
  title: string;
  kind: EntityKind;
  /** Die Abteilung im Inhaltsverzeichnis: Buchstabe, Gegend oder Einordnung. */
  group: string;
  /** Zeilen „Feld: Wert“ aus dem Steckbrief. */
  facts: ArticleFact[];
  /** Kurztexte aus dem Steckbrief, die keine Felder sind. */
  box: string;
  /** Der Text der Seite (Markdown). */
  text: string;
  /** In den Worten des Verfassers – der Spielleiter hat die Seite überschrieben. */
  own: boolean;
  /** Überschrieben, und der Artikel hat sich seither geändert. */
  changed: boolean;
  /** Der Artikel ist vor den Spielern verborgen. */
  withheld: boolean;
  articleId: string | null;
  /** Der Wortlaut des Artikels ohne Geheimes – Ausgangspunkt, wenn man die Seite überschreibt. */
  source: string;
}

export interface BookGroup {
  label: string;
  pages: BookPageView[];
}

/** Wo ein Eintrag ist – für die Ordnung nach Gegend. */
export function entryPlaceId(data: CampaignData, entity: Entity): string | null {
  const place = (id: string | null | undefined) =>
    id && data.entities[id]?.kind === 'place' ? id : null;
  switch (entity.kind) {
    case 'place':
      return place(entity.place.parentId) ?? entity.id;
    case 'person':
      return (
        place(entity.person.placeId) ??
        place(entity.person.homeId) ??
        place(entity.person.workplaceId)
      );
    case 'character':
      return place(entity.character.placeId);
    case 'faction':
      return place(entity.faction.seatId);
    case 'family':
      return place(entity.family.seatId);
    case 'item': {
      const holder = entity.item.holderId ? data.entities[entity.item.holderId] : undefined;
      if (!holder || holder.id === entity.id) return null;
      return holder.kind === 'place'
        ? holder.id
        : holder.kind === 'item'
          ? null
          : entryPlaceId(data, holder);
    }
    case 'plant':
      return entity.plant.regionIds.map(place).find(Boolean) ?? null;
    case 'animal':
      return entity.animal.regionIds.map(place).find(Boolean) ?? null;
    case 'mineral':
      return entity.mineral.regionIds.map(place).find(Boolean) ?? null;
    default:
      return null;
  }
}

const NO_PLACE = 'Ohne Ort';

/** Der Anfangsbuchstabe für das Inhaltsverzeichnis: Ä bei A, Zahlen und Zeichen unter „#“. */
function initial(name: string): string {
  const first = name
    .trim()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .charAt(0)
    .toUpperCase();
  return /\p{L}/u.test(first) ? first : '#';
}

function groupOf(data: CampaignData, order: BookOrder, entity: Entity): string {
  if (order === 'alpha') return initial(entity.name);
  if (order === 'region') {
    const placeId = entryPlaceId(data, entity);
    return placeId ? entityName(data, placeId) : NO_PLACE;
  }
  return entityCategory(entity).trim() || KIND_LABEL_PLURAL[entity.kind];
}

/** Ein Text als Wert zum Vergleichen – Leerraum am Rand zählt nicht. */
const same = (a: string, b: string) =>
  a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/** Eine Seite des Buches zu einem Eintrag. */
export function bookPage(data: CampaignData, item: BookItem, entity: Entity): BookPageView {
  const { book } = item.item;
  const wording = articleWording(data, entity);
  const written = book.pages[entity.id];
  const own = written !== undefined;
  // Auch in den Worten des Verfassers bleibt Geheimes draußen.
  const parts = articleParts(own ? withoutSecrets(written.text) : wording.text);
  return {
    entityId: entity.id,
    title: entity.name,
    kind: entity.kind,
    group: groupOf(data, book.order, entity),
    facts: parts.facts,
    box: parts.box,
    text: parts.body,
    own,
    changed: own && written.base.trim() !== '' && !same(written.base, wording.text),
    withheld: wording.withheld,
    articleId: wording.articleId,
    source: wording.text,
  };
}

/** Alle Seiten des Buches, in der Ordnung des Buches. */
export function bookPages(data: CampaignData, item: Entity): BookPageView[] {
  return bookGroups(data, item).flatMap((group) => group.pages);
}

/**
 * Steht die Seite für die Leser im Buch? Nicht, wenn ihr Artikel vor den Spielern verborgen ist –
 * sonst verriete schon der Name im Inhaltsverzeichnis etwas. Hat der Spielleiter die Seite in den
 * Worten des Verfassers geschrieben, steht sie darin.
 */
export const isReadable = (page: Pick<BookPageView, 'withheld' | 'own'>) =>
  page.own || !page.withheld;

/** Die Abteilungen ohne die Seiten, die nicht für die Leser im Buch stehen. */
function readableGroups(groups: BookGroup[]): BookGroup[] {
  return groups
    .map((group) => ({ ...group, pages: group.pages.filter(isReadable) }))
    .filter((group) => group.pages.length > 0);
}

/** Die Seiten nach Abteilungen: Buchstaben, Gegenden („Ohne Ort“ am Ende) oder Einordnungen. */
export function bookGroups(data: CampaignData, item: Entity): BookGroup[] {
  if (!isBook(item)) return [];
  const order = item.item.book.order;
  const groups = new Map<string, BookPageView[]>();
  for (const entity of bookEntries(data, item)) {
    const page = bookPage(data, item, entity);
    const list = groups.get(page.group);
    if (list) list.push(page);
    else groups.set(page.group, [page]);
  }
  const last = (label: string) =>
    (order === 'region' && label === NO_PLACE) ||
    (order === 'alpha' && label === '#') ||
    (order === 'category' && (Object.values(KIND_LABEL_PLURAL) as string[]).includes(label));
  return [...groups.entries()]
    .sort(
      ([a], [b]) =>
        Number(last(a)) - Number(last(b)) || a.localeCompare(b, 'de', { numeric: true }),
    )
    .map(([label, pages]) => ({ label, pages }));
}

// ── Das ganze Buch ─────────────────────────────────────────────────────────

export interface BookView {
  itemId: string;
  title: string;
  /** Der Verfasser: Name des Eintrags oder in Worten; '' = unbekannt. */
  author: string;
  authorId: string | null;
  /** Wann es geschrieben wurde (sonst: wann der Gegenstand entstand); '' = nicht angegeben. */
  written: string;
  intro: string;
  /** Die Seiten für die Leser – ohne die, deren Artikel verborgen ist (`isReadable`). */
  groups: BookGroup[];
  pageCount: number;
  /** Alle Einträge der Auswahl, auch die verborgenen – für die Spielleitung. */
  allGroups: BookGroup[];
  /** So viele Seiten stehen in den Worten des Verfassers. */
  ownCount: number;
  /** So viele Einträge fehlen im Buch, weil ihr Artikel vor den Spielern verborgen ist. */
  withheldCount: number;
}

/** Ein Buch zum Lesen und Drucken: Titelseite, Vorwort, Inhaltsverzeichnis, Seiten. */
export function bookView(data: CampaignData, item: Entity): BookView | null {
  if (!isBook(item)) return null;
  const { book } = item.item;
  const author = data.entities[book.authorId ?? '']?.name ?? book.authorText.trim();
  const when = book.written ?? item.born;
  const allGroups = bookGroups(data, item);
  const groups = readableGroups(allGroups);
  const all = allGroups.flatMap((group) => group.pages);
  const pages = groups.flatMap((group) => group.pages);
  return {
    itemId: item.id,
    title: item.name,
    author,
    authorId: book.authorId && data.entities[book.authorId] ? book.authorId : null,
    written: when ? formatDatePoint(data.campaign.calendar, when) : '',
    intro: book.intro.trim(),
    groups,
    pageCount: pages.length,
    allGroups,
    ownCount: pages.filter((page) => page.own).length,
    withheldCount: all.length - pages.length,
  };
}

/** Die Seiten, die für die Leser im Buch stehen, in der Ordnung des Buches. */
export function readablePages(data: CampaignData, item: Entity): BookPageView[] {
  return bookPages(data, item).filter(isReadable);
}

/** Eine Seite als reiner Text: Felder des Steckbriefs, Kurztexte, Text. */
export function pagePlainText(page: Pick<BookPageView, 'facts' | 'box' | 'text'>): string {
  const facts = page.facts.map((fact) => `${fact.label}: ${plainMarkdown(fact.value)}`).join('\n');
  return [facts, plainMarkdown(page.box), plainMarkdown(page.text)]
    .filter((part) => part.trim())
    .join('\n\n');
}

/** Eine Seite als Handout: der Wortlaut, wie er im Buch steht – unterschrieben vom Verfasser. */
export function pageHandout(
  view: Pick<BookView, 'itemId' | 'title' | 'author'>,
  page: BookPageView,
): Pick<Handout, 'title' | 'kind' | 'text' | 'signature' | 'seal' | 'storyId' | 'sourceId'> {
  return {
    title: `${view.title} – ${page.title}`,
    kind: 'letter',
    text: [page.title, pagePlainText(page)].filter((part) => part.trim()).join('\n\n'),
    signature: view.author,
    seal: '',
    storyId: null,
    sourceId: `book:${view.itemId}:${page.entityId}`,
  };
}

// ── Bücher der Gruppe ──────────────────────────────────────────────────────

/** Hat die Gruppe den Gegenstand – sie selbst oder ein Gefährte? */
export function heldByGroup(data: CampaignData, item: Item): boolean {
  const holder = item.item.holderId;
  return holder === PARTY_ID || (holder !== null && data.entities[holder]?.kind === 'character');
}

/** Die Bücher, die die Gruppe oder ein Gefährte bei sich hat – nach Namen. */
export function groupBooks(data: CampaignData): BookItem[] {
  return Object.values(data.entities)
    .filter((entity): entity is BookItem => isBook(entity) && heldByGroup(data, entity))
    .sort(byName);
}

/** Was ein Buch der Gruppe über einen Eintrag sagt. */
export interface BookKnowledge {
  bookId: string;
  bookName: string;
  page: BookPageView;
}

/**
 * Die Seiten aus Büchern der Gruppe zu einem Eintrag – in der Fassung des Buches. Eine Seite,
 * deren Artikel verborgen ist, steht nicht im Buch (`isReadable`).
 */
export function booksAbout(data: CampaignData, entityId: string): BookKnowledge[] {
  const entity = data.entities[entityId];
  if (!entity) return [];
  const out: BookKnowledge[] = [];
  for (const book of groupBooks(data)) {
    if (!bookEntries(data, book).some((entry) => entry.id === entityId)) continue;
    const page = bookPage(data, book, entity);
    if (isReadable(page)) out.push({ bookId: book.id, bookName: book.name, page });
  }
  return out;
}
