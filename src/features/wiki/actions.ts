/** Befehle des Bereichs „Wiki“. */
import type { CampaignDb } from '../../data/db';
import { kinInSentence } from '../../domain/kin';
import {
  ArticleSchema,
  createEntity,
  createRelation,
  newId,
  nowIso,
  type Article,
  type ArticleDoc,
  type CampaignData,
  type Entity,
  type EntityKind,
} from '../../domain/schema';
import type { ImportSections } from '../import/v157';
import { adoptFamilies, type FamilyAdoption } from '../welt/actions';
import type { LkImportPlan } from './apply';
import { articleFacts, planFacts, statedKind, twins } from './facts';
import { addBlankFactLines } from './factLines';
import { scaffoldOf, scaffoldText, withScaffold, type ScaffoldKind } from './scaffold';
import type { RelationHint } from './sentences';
import { articleAsText, linkIndex, pageText, relinked, titleKey } from './text';

export interface AppliedLkImport {
  at: string;
  fileName: string;
  sections: ImportSections;
  /** Der Stand vor der Übernahme – zum Zurücknehmen. */
  before: CampaignData;
  /** Der Stand direkt danach. Solange er unverändert ist, lässt sich die Übernahme zurücknehmen. */
  after: CampaignData;
  /** Was die Steckbriefe der Artikel gleich mit in die Welt gebracht haben. */
  facts: { created: number; changed: number };
}

// Bewusst nur im Arbeitsspeicher: gilt, bis Wayfarer geschlossen wird.
let last: AppliedLkImport | null = null;

export const lastLkImport = (): AppliedLkImport | null => last;

/**
 * Schreibt eine geplante Übernahme in den Spielstand und legt Familien aus gemeinsamen Nachnamen
 * an. Wirft, wenn der Stand nicht geschrieben werden darf.
 */
export function applyLkImport(
  db: CampaignDb,
  plan: LkImportPlan,
  fileName: string,
  options: { facts?: boolean } = {},
): FamilyAdoption | null {
  const before = db.getSnapshot();
  db.replaceAll(plan.data);
  // Bei so vielen neuen Personen entsteht eine Familie erst ab zwei Trägern des Nachnamens.
  const families = plan.personIds.length ? adoptFamilies(db, undefined, 2) : null;
  // Wer schon in der Welt stand und jetzt einen Artikel gleichen Namens bekommt, gehört zu ihm.
  linkTwins(db);
  // Die Steckbriefe gleich auswerten: Beruf, Aufenthaltsort, Zugehörigkeit … stehen dann schon
  // in der Welt, ohne dass jemand einen Knopf drücken muss.
  const sync = options.facts ? syncFacts(db) : null;
  last = {
    at: nowIso(),
    fileName,
    sections: plan.sections,
    before,
    after: db.getSnapshot(),
    facts: { created: sync?.created.length ?? 0, changed: sync?.changed.length ?? 0 },
  };
  return families;
}

/** Lässt sich die letzte Übernahme noch zurücknehmen? Nur, solange seither nichts geändert wurde. */
export const canUndoLkImport = (db: CampaignDb): boolean =>
  last !== null && db.getSnapshot() === last.after;

/** Stellt den Stand vor der letzten Übernahme wieder her. */
export function undoLkImport(db: CampaignDb): boolean {
  if (!last || !canUndoLkImport(db)) return false;
  db.replaceAll(last.before);
  last = null;
  return true;
}

/**
 * Verbindet Artikel und Einträge gleichen Namens, die noch nichts voneinander wissen (`twins`):
 * Der Eintrag bekommt den Artikel als seinen Text. Das folgt eindeutig und geschieht deshalb
 * still. Gibt die verbundenen Einträge zurück, wie sie vorher waren.
 */
export function linkTwins(db: CampaignDb): Entity[] {
  const found = twins(db.getSnapshot());
  if (!found.length) return [];
  db.batch(() => {
    for (const { article, entity } of found)
      db.put('entities', { ...entity, lk: { resourceId: article.id, title: article.title } });
  });
  return found.map((twin) => twin.entity);
}

/** Nimmt einen Artikel von Hand als Eintrag in die Welt auf. */
export function adoptArticle(db: CampaignDb, article: Article, kind: EntityKind): Entity {
  return db.put(
    'entities',
    createEntity({
      kind,
      name: article.title,
      aliases: article.aliases,
      lk: { resourceId: article.id, title: article.title },
    }),
  );
}

// ── Schreiben ──────────────────────────────────────────────────────────────

type Articles = CampaignData['articles'];

/**
 * Bringt einen Artikel in die Textform, falls er noch in der alten liegt, und macht ihn zu einem
 * Artikel von Wayfarer: Was hier geschrieben wurde, überschreibt ein späterer Import nicht mehr.
 */
function owned(articles: Articles, article: Article): Article {
  const legacy =
    article.sidebar.length > 0 || article.docs.some((doc) => doc.nodes.length > 0 && !doc.text);
  const base = legacy ? articleAsText(articles, article).article : article;
  return base.source === 'wayfarer' ? base : { ...base, source: 'wayfarer' };
}

/** Schreibt die Artikel, deren Verweise nach einer Änderung der Titel nachgezogen wurden. */
function putRelinked(db: CampaignDb, before: Articles): number {
  const changed = relinked(before, db.getSnapshot().articles);
  for (const article of changed) db.put('articles', article);
  return changed.length;
}

/** Speichert den Text einer Seite. Ohne Änderung geschieht nichts. */
export function savePageText(db: CampaignDb, articleId: string, docId: string, text: string): void {
  const articles = db.getSnapshot().articles;
  const current = articles[articleId];
  if (!current) return;
  const article = owned(articles, current);
  const doc = article.docs.find((d) => d.id === docId);
  if (!doc || doc.kind !== 'page') return;
  if (doc.text === text && article === current) return;
  db.put('articles', {
    ...article,
    docs: article.docs.map((d) => (d.id === docId ? { ...d, text, nodes: [] } : d)),
  });
}

/** Sortierschlüssel hinter dem letzten Geschwister-Artikel. */
function orderAfterLast(articles: Articles, parentId: string | null, exceptId?: string): string {
  const last = Object.values(articles)
    .filter((a) => a.parentId === parentId && a.id !== exceptId && !a.template)
    .map((a) => a.order)
    .sort()
    .pop();
  return last ? `${last}V` : 'V';
}

const emptyPage = (title = ''): ArticleDoc => ({
  id: newId(),
  title,
  kind: 'page',
  hidden: false,
  text: '',
  nodes: [],
  mapId: null,
});

/**
 * Legt einen neuen Artikel an – ganz oben oder unter einem anderen. Heißt schon ein Artikel so,
 * bleiben die bisherigen Verweise bei ihm.
 */
export function createArticle(
  db: CampaignDb,
  input: { title: string; parentId?: string | null; text?: string },
): Article | null {
  const title = input.title.replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const before = db.getSnapshot().articles;
  const parentId = input.parentId && before[input.parentId] ? input.parentId : null;
  const stamp = nowIso();
  return db.batch(() => {
    const article = db.put(
      'articles',
      ArticleSchema.parse({
        id: newId(),
        created: stamp,
        updated: stamp,
        title,
        parentId,
        order: orderAfterLast(before, parentId),
        docs: [{ ...emptyPage(), text: input.text ?? '' }],
        source: 'wayfarer',
      }),
    );
    putRelinked(db, before);
    // Steht ein Eintrag dieses Namens schon in der Welt, ist das sein Artikel.
    linkTwins(db);
    return article;
  });
}

/**
 * Legt einen Artikel einer Art an: auf Wunsch mit dem Steckbrief-Gerüst dieser Art (leere Felder,
 * `scaffold.ts`) und als Eintrag dieser Art in der Welt. Steht dort schon ein Eintrag dieses Namens
 * ohne Artikel, wird er verbunden statt ein zweiter angelegt. Ohne Art ist es ein gewöhnlicher
 * Artikel. Gibt den Artikel und seinen Eintrag zurück.
 */
export function createArticleOfKind(
  db: CampaignDb,
  input: {
    title: string;
    parentId?: string | null;
    kind: EntityKind | null;
    scaffold: boolean;
    /** Der Eintrag, dessen Artikel das wird (er hat noch keinen). */
    entityId?: string;
  },
): { article: Article; entity: Entity | null } | null {
  const { kind } = input;
  const labels = kind && input.scaffold ? scaffoldOf(db.getSnapshot().campaign, kind) : [];
  return db.batch(() => {
    const article = createArticle(db, {
      title: input.title,
      parentId: input.parentId ?? null,
      text: scaffoldText(labels),
    });
    if (!article) return null;
    const owner = Object.values(db.getSnapshot().entities).find(
      (entity) => entity.lk?.resourceId === article.id,
    );
    if (owner) return { article, entity: owner };
    const data = db.getSnapshot();
    const meant = input.entityId ? data.entities[input.entityId] : undefined;
    if (meant && !(meant.lk && data.articles[meant.lk.resourceId])) {
      const linked = db.put('entities', {
        ...meant,
        lk: { resourceId: article.id, title: article.title },
      });
      return { article, entity: linked };
    }
    if (!kind || kind === 'character') return { article, entity: null };
    return { article, entity: adoptArticle(db, article, kind) };
  });
}

/**
 * Setzt das Steckbrief-Gerüst einer Art (Einstellungen). `null` oder die Vorgabe selbst stellt die
 * Vorgabe wieder her; eine leere Liste heißt: diese Art bekommt kein Gerüst.
 */
export function setFactScaffold(
  db: CampaignDb,
  kind: ScaffoldKind,
  labels: readonly string[] | null,
): void {
  const current = db.getSnapshot().campaign.factScaffolds;
  const next = withScaffold(current, kind, labels);
  const same =
    Object.keys(next).length === Object.keys(current).length &&
    Object.entries(next).every(
      ([key, list]) =>
        current[key]?.length === list.length &&
        list.every((label, i) => current[key]![i] === label),
    );
  if (!same) db.setCampaign({ factScaffolds: next });
}

/**
 * Fügt dem Steckbrief der ersten Textseite leere Felder hinzu (fehlt er, entsteht er oben). Der
 * übrige Text bleibt. Gibt `undo` zurück – es nimmt die Zeilen zurück, solange niemand weiterschrieb.
 */
export function addScaffoldFields(
  db: CampaignDb,
  articleId: string,
  labels: readonly string[],
): (() => void) | null {
  const articles = db.getSnapshot().articles;
  const article = articles[articleId];
  const doc = article?.docs.find((d) => d.kind === 'page');
  if (!article || !doc) return null;
  const before = pageText(articles, article, doc);
  const after = addBlankFactLines(before, labels);
  if (after === before) return null;
  savePageText(db, articleId, doc.id, after);
  return () => {
    const now = db.getSnapshot().articles[articleId];
    const page = now?.docs.find((d) => d.id === doc.id);
    if (page?.text === after) savePageText(db, articleId, doc.id, before);
  };
}

export type RenameProblem = 'empty' | 'missing';

/**
 * Benennt einen Artikel um. Alle Verweise auf ihn ziehen mit; Einträge der Welt, die zu ihm
 * gehören, merken sich den neuen Titel. Gibt zurück, in wie vielen Artikeln Verweise angepasst
 * wurden.
 */
export function renameArticle(
  db: CampaignDb,
  articleId: string,
  newTitle: string,
): { relinked: number } | RenameProblem {
  const title = newTitle.replace(/\s+/g, ' ').trim();
  if (!title) return 'empty';
  const before = db.getSnapshot().articles;
  const current = before[articleId];
  if (!current) return 'missing';
  if (current.title === title) return { relinked: 0 };
  return db.batch(() => {
    db.put('articles', { ...owned(before, current), title });
    const count = putRelinked(db, before);
    for (const entity of Object.values(db.getSnapshot().entities))
      if (entity.lk?.resourceId === articleId && entity.lk.title !== title)
        db.put('entities', { ...entity, lk: { ...entity.lk, title } });
    return { relinked: count };
  });
}

/** Liegt `candidate` unter `ancestorId` (oder ist es derselbe Artikel)? */
export function isWithin(
  articles: Articles,
  candidate: string | null,
  ancestorId: string,
): boolean {
  const seen = new Set<string>();
  let current = candidate;
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = articles[current]?.parentId ?? null;
  }
  return false;
}

/** Hängt einen Artikel unter einen anderen (oder mit `null` ganz nach oben), ans Ende der Reihe. */
export function moveArticle(db: CampaignDb, articleId: string, parentId: string | null): boolean {
  const articles = db.getSnapshot().articles;
  const article = articles[articleId];
  if (!article || article.parentId === parentId) return false;
  if (parentId !== null && (!articles[parentId] || isWithin(articles, parentId, articleId)))
    return false;
  db.put('articles', {
    ...article,
    parentId,
    order: orderAfterLast(articles, parentId, articleId),
  });
  return true;
}

/**
 * Löscht einen Artikel. Unterartikel rücken eine Ebene nach oben; Einträge der Welt bleiben,
 * verlieren aber die Verknüpfung. Verweise auf den Artikel bleiben als Name stehen. `undo`
 * stellt alles wieder her, was seither niemand angefasst hat.
 */
export function deleteArticle(db: CampaignDb, articleId: string): (() => void) | null {
  const data = db.getSnapshot();
  const article = data.articles[articleId];
  if (!article) return null;
  const children = Object.values(data.articles).filter((a) => a.parentId === articleId);
  const owners = Object.values(data.entities).filter((e) => e.lk?.resourceId === articleId);
  db.batch(() => {
    for (const child of children) db.put('articles', { ...child, parentId: article.parentId });
    for (const owner of owners) db.put('entities', { ...owner, lk: null });
    db.remove('articles', articleId);
  });
  return () =>
    db.batch(() => {
      const now = db.getSnapshot();
      if (!now.articles[articleId]) db.put('articles', { ...article, rev: 0 });
      for (const child of children) {
        const current = now.articles[child.id];
        if (current && current.parentId === article.parentId)
          db.put('articles', { ...current, parentId: articleId });
      }
      for (const owner of owners) {
        const current = now.entities[owner.id];
        if (current && current.lk === null) db.put('entities', { ...current, lk: owner.lk });
      }
    });
}

/** Fügt einem Artikel eine weitere Textseite hinzu und gibt ihre Kennung zurück. */
export function addPage(db: CampaignDb, articleId: string, title = ''): string | null {
  const articles = db.getSnapshot().articles;
  const current = articles[articleId];
  if (!current) return null;
  const article = owned(articles, current);
  const page = emptyPage(title.trim());
  // Vor den Seiten, die Wayfarer nicht zeigt (Zeitleiste, Zeichenfläche), aber nach Text und Karten.
  const at = article.docs.filter((d) => d.kind === 'page' || d.kind === 'map').length;
  db.put('articles', {
    ...article,
    docs: [...article.docs.slice(0, at), page, ...article.docs.slice(at)],
  });
  return page.id;
}

/** Benennt eine Seite eines Artikels um. */
export function renamePage(db: CampaignDb, articleId: string, docId: string, title: string): void {
  const articles = db.getSnapshot().articles;
  const current = articles[articleId];
  const doc = current?.docs.find((d) => d.id === docId);
  if (!current || !doc || doc.title === title.trim()) return;
  const article = owned(articles, current);
  db.put('articles', {
    ...article,
    docs: article.docs.map((d) => (d.id === docId ? { ...d, title: title.trim() } : d)),
  });
}

/** Entfernt eine Seite eines Artikels; `undo` holt sie an ihre Stelle zurück. */
export function removePage(db: CampaignDb, articleId: string, docId: string): (() => void) | null {
  const articles = db.getSnapshot().articles;
  const current = articles[articleId];
  if (!current || !current.docs.some((d) => d.id === docId)) return null;
  const article = owned(articles, current);
  const index = article.docs.findIndex((d) => d.id === docId);
  const removed = article.docs[index]!;
  db.put('articles', { ...article, docs: article.docs.filter((d) => d.id !== docId) });
  return () => {
    const now = db.getSnapshot().articles[articleId];
    if (!now || now.docs.some((d) => d.id === docId)) return;
    db.put('articles', {
      ...now,
      docs: [...now.docs.slice(0, index), removed, ...now.docs.slice(index)],
    });
  };
}

/** Ändert Schlagworte, Zweitnamen oder das Symbol eines Artikels. */
export function setArticleMeta(
  db: CampaignDb,
  articleId: string,
  change: Partial<Pick<Article, 'tags' | 'aliases' | 'icon' | 'hidden' | 'autoLink'>>,
): void {
  const before = db.getSnapshot().articles;
  const current = before[articleId];
  if (!current) return;
  /** Ohne Leeres und ohne Doppeltes; bei gleicher Schreibweise bleibt die erste. */
  const clean = (values: string[]) => {
    const seen = new Map<string, string>();
    for (const value of values.map((v) => v.trim()).filter(Boolean))
      if (!seen.has(titleKey(value))) seen.set(titleKey(value), value);
    return [...seen.values()];
  };
  db.batch(() => {
    db.put('articles', {
      ...owned(before, current),
      ...change,
      ...(change.tags ? { tags: clean(change.tags) } : {}),
      ...(change.aliases ? { aliases: clean(change.aliases) } : {}),
    });
    // Ein neuer Zweitname kann Verweise auflösen oder verschieben.
    if (change.aliases) putRelinked(db, before);
  });
}

// ── Steckbrief speist die Welt ─────────────────────────────────────────────

export interface FactsSync {
  /** Einträge, die neu entstanden sind, weil der Steckbrief ihre Art nennt. */
  created: Entity[];
  /** Je geändertem Eintrag, was sich geändert hat. */
  changed: { entity: Entity; changes: string[] }[];
}

/**
 * Liest die Steckbriefe der genannten Artikel (ohne Angabe: aller) und trägt in die Welt ein, was
 * dort steht: Beruf, Zustand, Aufenthaltsort, Zuhause, Zugehörigkeit, Lage, Sitz, Führung … Ein
 * Artikel ohne Eintrag bekommt einen, wenn sein Steckbrief die Art nennt („Art: Dorf“). Gibt
 * zurück, was sich geändert hat, und `undo`, das genau diese Änderungen zurücknimmt.
 */
export function syncFacts(
  db: CampaignDb,
  articleIds?: readonly string[],
): FactsSync & { undo: () => void } {
  const before = db.getSnapshot();
  const ids = articleIds ?? Object.keys(before.articles);
  const out: FactsSync = { created: [], changed: [] };
  const touchedEntities = new Set<string>();
  const addedRelations: string[] = [];
  const removedRelations = new Set<string>();

  db.batch(() => {
    // Was es unter diesem Namen schon gibt, wird verbunden – nie ein zweites Mal angelegt.
    for (const entity of linkTwins(db)) touchedEntities.add(entity.id);
    // Erst fehlende Einträge anlegen, damit sich die Steckbriefe gegenseitig finden.
    for (const id of ids) {
      const article = db.getSnapshot().articles[id];
      if (!article || article.template) continue;
      const data = db.getSnapshot();
      if (Object.values(data.entities).some((e) => e.lk?.resourceId === id)) continue;
      const stated = statedKind(articleFacts(data.articles, article));
      if (!stated) continue;
      const entity = db.put(
        'entities',
        createEntity({
          kind: stated.kind,
          name: article.title,
          aliases: article.aliases,
          lk: { resourceId: article.id, title: article.title },
        }),
      );
      touchedEntities.add(entity.id);
      out.created.push(entity);
    }
    for (const id of ids) {
      const article = db.getSnapshot().articles[id];
      if (!article || article.template) continue;
      const owners = Object.values(db.getSnapshot().entities).filter(
        (e) => e.lk?.resourceId === id,
      );
      for (const owner of owners) {
        const plan = planFacts(db.getSnapshot(), article, owner);
        if (plan.entity !== owner) {
          touchedEntities.add(owner.id);
          db.put('entities', plan.entity);
        }
        for (const relationId of plan.removeRelations) {
          removedRelations.add(relationId);
          db.remove('relations', relationId);
        }
        for (const wish of plan.addRelations)
          addedRelations.push(
            db.put('relations', createRelation({ ...wish, articleId: article.id })).id,
          );
        if (plan.changes.length)
          out.changed.push({
            entity: db.getSnapshot().entities[owner.id] ?? plan.entity,
            changes: plan.changes,
          });
      }
    }
  });

  const undo = () =>
    db.batch(() => {
      const now = db.getSnapshot();
      for (const id of addedRelations) if (now.relations[id]) db.remove('relations', id);
      for (const id of removedRelations) {
        const relation = before.relations[id];
        if (relation && !now.relations[id]) db.put('relations', relation);
      }
      for (const id of touchedEntities) {
        const old = before.entities[id];
        if (old) db.put('entities', old);
        else if (now.entities[id]) db.remove('entities', id);
      }
    });
  return { ...out, undo };
}

/**
 * Legt zu einem Namen aus einem Steckbrief den fehlenden Eintrag an und liest die Steckbriefe, die
 * ihn nennen, gleich neu – damit sie auf ihn zeigen. Gibt es einen Artikel dieses Titels, der noch
 * keinen Eintrag hat, wird er der Artikel des neuen Eintrags.
 */
export function createNamedEntity(
  db: CampaignDb,
  name: string,
  kind: EntityKind,
  articleIds: readonly string[],
): { entity: Entity; undo: () => void } {
  const clean = name.replace(/\s+/g, ' ').trim();
  let created: Entity | null = null;
  let sync: ReturnType<typeof syncFacts> | null = null;
  db.batch(() => {
    const data = db.getSnapshot();
    const found = linkIndex(data.articles).resolve(clean);
    const article = found ? data.articles[found.id] : undefined;
    const free =
      article &&
      !article.template &&
      !Object.values(data.entities).some((e) => e.lk?.resourceId === article.id);
    created = free
      ? adoptArticle(db, article, kind)
      : db.put('entities', createEntity({ kind, name: clean }));
    sync = syncFacts(db, free ? [...articleIds, article.id] : articleIds);
  });
  const entity = created!;
  return {
    entity,
    undo: () =>
      db.batch(() => {
        sync?.undo();
        if (db.getSnapshot().entities[entity.id]) db.remove('entities', entity.id);
      }),
  };
}

// ── Vorschläge aus Sätzen ──────────────────────────────────────────────────

/** Trägt eine Beziehung ein, die Wayfarer in einem Satz gelesen hat. Gibt `undo` zurück. */
export function acceptHint(db: CampaignDb, hint: RelationHint): () => void {
  const data = db.getSnapshot();
  if (hint.type === 'home') {
    const person = data.entities[hint.from.id];
    if (person?.kind !== 'person') return () => {};
    const before = person.person.homeId;
    db.put('entities', { ...person, person: { ...person.person, homeId: hint.to.id } });
    return () => {
      const now = db.getSnapshot().entities[person.id];
      if (now?.kind === 'person' && now.person.homeId === hint.to.id)
        db.put('entities', { ...now, person: { ...now.person, homeId: before } });
    };
  }
  const relation = db.put(
    'relations',
    createRelation({
      from: hint.from.id,
      to: hint.to.id,
      type: hint.type,
      // „Schwester von Odo“: Das Wort sagt, welche Verwandtschaft es ist.
      kin: hint.type === 'family' ? (kinInSentence(hint.sentence)?.kin ?? null) : null,
    }),
  );
  return () => {
    if (db.getSnapshot().relations[relation.id]) db.remove('relations', relation.id);
  };
}

/** Merkt sich, dass ein Vorschlag aus diesem Artikel nicht stimmt – er kommt nicht wieder. */
export function dismissHint(db: CampaignDb, articleId: string, key: string): () => void {
  const article = db.getSnapshot().articles[articleId];
  if (!article || article.dismissedHints.includes(key)) return () => {};
  db.put('articles', { ...article, dismissedHints: [...article.dismissedHints, key] });
  return () => {
    const now = db.getSnapshot().articles[articleId];
    if (now)
      db.put('articles', {
        ...now,
        dismissedHints: now.dismissedHints.filter((entry) => entry !== key),
      });
  };
}
