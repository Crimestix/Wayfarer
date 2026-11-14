/**
 * Bücher auf den Seiten der Welt: das Buch eines Gegenstands ändern, Seiten in den Worten des
 * Verfassers schreiben und zurücksetzen, eine Seite als Handout übernehmen. Was im Buch steht,
 * rechnet `domain/book.ts`; hier wird nur geschrieben – und der Text einer Seite für die Anzeige
 * gelesen.
 */
import type { CampaignDb } from '../../data/db';
import { emptyBook, pageHandout, type BookPageView, type BookView } from '../../domain/book';
import {
  bookRules,
  isEmptyTopic,
  ruleMembers,
  sameTopic,
  type BookTopic,
} from '../../domain/bookTopics';
import type { Book, BookSelection, CampaignData, Handout } from '../../domain/schema';
import { saveHandout } from '../handouts/actions';
import type { ArticleNode, Inline } from '../legendkeeper/model';
import { parseInline, parseMarkdown } from '../wiki/markdown';
import { linkIndex } from '../wiki/text';
import { patchDetails } from './actions';

/** Das Buch des Gegenstands, wie es jetzt gespeichert ist; null = kein Buch oder kein Gegenstand. */
function current(db: CampaignDb, itemId: string): Book | null {
  const item = db.getSnapshot().entities[itemId];
  return item?.kind === 'item' ? item.item.book : null;
}

/** Macht den Gegenstand zu einem Buch (leer) oder wieder zu einem gewöhnlichen Gegenstand. */
export function setIsBook(db: CampaignDb, itemId: string, on: boolean): void {
  const item = db.getSnapshot().entities[itemId];
  if (item?.kind !== 'item' || (item.item.book !== null) === on) return;
  patchDetails(db, item, { book: on ? emptyBook() : null });
}

/** Ändert Angaben des Buches. */
export function patchBook(db: CampaignDb, itemId: string, change: Partial<Book>): void {
  const item = db.getSnapshot().entities[itemId];
  if (item?.kind !== 'item' || !item.item.book) return;
  patchDetails(db, item, { book: { ...item.item.book, ...change } });
}

/** Ändert die Auswahl des Buches. */
export function patchSelection(
  db: CampaignDb,
  itemId: string,
  change: Partial<BookSelection>,
): void {
  const book = current(db, itemId);
  if (book) patchBook(db, itemId, { selection: { ...book.selection, ...change } });
}

/**
 * Nimmt Einträge ins Buch oder heraus – die Kästchen beim Durchsehen. Dazu: Was über ein Thema
 * ohnehin darin stünde, verliert nur sein „weg“; alles andere kommt unter „dazu“. Heraus: Es
 * verliert sein „dazu“; steht es über ein Thema darin, kommt es unter „weg“. Seine überschriebene
 * Seite bleibt gemerkt, falls es wieder dazukommt.
 */
export function setInBook(db: CampaignDb, itemId: string, entityIds: string[], on: boolean): void {
  const book = current(db, itemId);
  if (!book) return;
  const data = db.getSnapshot();
  const byRule = ruleMembers(data, book.selection, itemId);
  const ids = new Set(entityIds.filter((id) => id !== itemId && data.entities[id]));
  if (!ids.size) return;
  const include = new Set(book.selection.include);
  const exclude = new Set(book.selection.exclude);
  for (const id of ids) {
    if (on) {
      exclude.delete(id);
      if (!byRule.has(id)) include.add(id);
    } else {
      include.delete(id);
      if (byRule.has(id)) exclude.add(id);
    }
  }
  patchSelection(db, itemId, { include: [...include], exclude: [...exclude] });
}

/**
 * Nimmt alles aus einem Thema ins Buch – auch, was später dazukommt – oder nicht mehr. Abschalten
 * leert nichts: Was jetzt angekreuzt ist, bleibt einzeln darin; nur Neues kommt nicht mehr von
 * selbst dazu (leeren geht über „Keine“). Die ältere Regel aus Arten, Gegenden und Einordnungen
 * wird dabei zu Themen (`legacyRules`), damit jedes Thema für sich an- und abschaltbar ist.
 * „Dazu“ und „weg“ bleiben nur, wo sie noch etwas ändern.
 */
export function setBookRule(db: CampaignDb, itemId: string, topic: BookTopic, on: boolean): void {
  const book = current(db, itemId);
  if (!book || isEmptyTopic(topic)) return;
  const now = bookRules(book.selection);
  if (now.some((rule) => sameTopic(rule, topic)) === on) return;
  const rules = now.filter((rule) => !sameTopic(rule, topic));
  if (on) rules.push({ ...topic, category: topic.category.trim(), tag: topic.tag.trim() });
  const data = db.getSnapshot();
  const next: BookSelection = {
    ...book.selection,
    rules,
    kinds: [],
    regionIds: [],
    categories: [],
  };
  const before = ruleMembers(data, book.selection, itemId);
  const after = ruleMembers(data, next, itemId);
  const exclude = new Set(book.selection.exclude);
  const include = new Set(book.selection.include);
  // Was eben noch über das Thema darin stand, bleibt einzeln darin.
  for (const id of before) if (!after.has(id) && !exclude.has(id)) include.add(id);
  for (const id of after) include.delete(id);
  for (const id of exclude) if (!after.has(id)) exclude.delete(id);
  patchSelection(db, itemId, { ...next, include: [...include], exclude: [...exclude] });
}

/**
 * Schreibt eine Seite in den Worten des Verfassers. `base` ist der Wortlaut des Artikels, von
 * dem aus geschrieben wurde – daran sieht Wayfarer später, ob sich der Artikel geändert hat.
 */
export function writeBookPage(
  db: CampaignDb,
  itemId: string,
  entityId: string,
  text: string,
  base: string,
): void {
  const book = current(db, itemId);
  if (!book) return;
  // Leer gespeichert heißt: zurück zum Artikel (eine leere Seite „in den Worten des Verfassers“
  // wäre nie gemeint). Weglassen geht über „Aus dem Buch nehmen“.
  if (!text.trim()) return resetBookPage(db, itemId, entityId);
  patchBook(db, itemId, { pages: { ...book.pages, [entityId]: { text, base } } });
}

/** Setzt eine Seite auf den Artikel zurück: Sie wächst wieder mit ihm mit. */
export function resetBookPage(db: CampaignDb, itemId: string, entityId: string): void {
  const book = current(db, itemId);
  if (!book || !book.pages[entityId]) return;
  const pages = { ...book.pages };
  delete pages[entityId];
  patchBook(db, itemId, { pages });
}

/** Legt aus einer Seite ein Handout an – mit dem Wortlaut, wie er im Buch steht. */
export function pageToHandout(db: CampaignDb, view: BookView, page: BookPageView): Handout {
  return saveHandout(db, pageHandout(view, page));
}

// ── Lesen ──────────────────────────────────────────────────────────────────

/** Eine Seite, gelesen für die Anzeige: Felder des Steckbriefs und der Text als Knoten. */
export interface PageReading {
  facts: { label: string; value: Inline[] }[];
  nodes: ArticleNode[];
}

/** Liest Steckbrief und Text einer Seite mit den Verweisen des Wikis. */
export function readBookPage(
  articles: CampaignData['articles'],
  page: Pick<BookPageView, 'facts' | 'box' | 'text'>,
): PageReading {
  const { resolve } = linkIndex(articles);
  const ctx = { resolve, headings: 0 };
  return {
    facts: page.facts.map((fact) => ({ label: fact.label, value: parseInline(fact.value, ctx) })),
    nodes: parseMarkdown([page.box, page.text].filter((part) => part.trim()).join('\n\n'), ctx),
  };
}
