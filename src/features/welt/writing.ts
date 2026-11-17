/**
 * Anlegen beim Schreiben: Die Welt wächst aus der Geschichte. Wo der Spielleiter einen Eintrag
 * wählt oder einen Namen schreibt, den es noch nicht gibt, entsteht ein Platzhalter – Name, Art,
 * höchstens ein Satz –, ohne die Seite zu verlassen. Fertig geschrieben wird später („Noch zu
 * schreiben“). Nie ein zweiter Eintrag für einen Namen: Gibt es ihn schon, wird er genommen.
 */
import type { CampaignDb } from '../../data/db';
import type { Article, Entity, EntityKind, Prep, Story, Thread } from '../../domain/schema';
import { createArticleOfKind, createNamedEntity } from '../wiki/actions';
import { flushEdits } from '../wiki/editing';
import { entryForTitle } from '../wiki/facts';
import { linkIndex } from '../wiki/text';

export interface WritingInput {
  name: string;
  kind: EntityKind;
  /** Ein Satz dazu – kann später kommen. */
  line?: string | undefined;
  /** Die Geschichte, bei deren Schreiben der Eintrag entsteht. */
  storyId?: string | null | undefined;
}

export interface WritingResult {
  entity: Entity;
  /** Gerade erst entstanden – sonst gab es den Namen schon. */
  created: boolean;
  /** Den Namen gab es schon, aber mit einer anderen Art als gewünscht. */
  otherKind: boolean;
  /**
   * Nimmt das Anlegen zurück – auch aus den Blättern, in die der Eintrag seither gewählt wurde.
   * Bei einem Eintrag, den es schon gab, geschieht nichts.
   */
  undo: () => void;
}

/**
 * Nimmt einen eben angelegten Eintrag aus den Blättern, in die er seither gewählt wurde: aus
 * Geschichten (Antreiber, Beteiligte, Ort eines Einstiegs oder einer Szene), ihren Uhren,
 * Fäden (Namen, „Wo?“ und „Wer weiß es?“ der Hinweise) und Abenden (Ort einer Szene, Orte und
 * Personen des Abends). Sonst
 * bliebe dort nach „Rückgängig“ ein „Gelöschter Eintrag“ stehen. Der geschriebene Text bleibt.
 */
function takeFromSheets(db: CampaignDb, entityId: string): void {
  const data = db.getSnapshot();
  const other = (id: string) => id !== entityId;
  const placed = (list: readonly { placeId: string | null }[]) =>
    list.some((item) => item.placeId === entityId);
  const unplaced = <T extends { placeId: string | null }>(list: readonly T[]): T[] =>
    list.map((item) => (item.placeId === entityId ? { ...item, placeId: null } : item));
  for (const story of Object.values(data.stories)) {
    const change: Partial<Story> = {};
    if (story.ownerId === entityId) change.ownerId = null;
    if (story.refs.includes(entityId)) change.refs = story.refs.filter(other);
    if (story.roles[entityId])
      change.roles = Object.fromEntries(
        Object.entries(story.roles).filter(([id]) => id !== entityId),
      );
    if (placed(story.entries)) change.entries = unplaced(story.entries);
    if (placed(story.scenes)) change.scenes = unplaced(story.scenes);
    if (Object.keys(change).length) db.patch('stories', story.id, change);
  }
  // Die Uhr einer Geschichte gehört ihrem Antreiber.
  for (const clock of Object.values(data.clocks))
    if (clock.ownerId === entityId) db.patch('clocks', clock.id, { ownerId: null });
  for (const thread of Object.values(data.threads)) {
    const change: Partial<Thread> = {};
    if (thread.refs.includes(entityId)) change.refs = thread.refs.filter(other);
    if (thread.hints.some((hint) => hint.placeId === entityId || hint.sourceId === entityId))
      change.hints = thread.hints.map((hint) => ({
        ...hint,
        placeId: hint.placeId === entityId ? null : hint.placeId,
        sourceId: hint.sourceId === entityId ? null : hint.sourceId,
      }));
    if (Object.keys(change).length) db.patch('threads', thread.id, change);
  }
  for (const prep of Object.values(data.preps)) {
    const change: Partial<Prep> = {};
    if (placed(prep.scenes)) change.scenes = unplaced(prep.scenes);
    if (prep.placeIds.includes(entityId)) change.placeIds = prep.placeIds.filter(other);
    if (prep.personIds.includes(entityId)) change.personIds = prep.personIds.filter(other);
    if (Object.keys(change).length) db.patch('preps', prep.id, change);
  }
}

/**
 * Nimmt den Eintrag dieses Namens oder legt ihn als Platzhalter an. Es gelten die Regeln der
 * Welt für Namen (`entryForTitle`): gleicher Name oder Zweitname, auch der Titel des Artikels –
 * nie ein ähnlicher. Ein Artikel dieses Titels ohne Eintrag wird der Text des neuen Eintrags
 * (`createNamedEntity`). null, wenn kein Name dasteht.
 */
export function addFromWriting(db: CampaignDb, input: WritingInput): WritingResult | null {
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  // Ein offener Editor speichert zuerst – sonst kennt die Welt seinen Titel noch nicht.
  flushEdits();
  const data = db.getSnapshot();
  const owner = entryForTitle(data, name);
  if (owner) {
    const entity = 'free' in owner ? owner.free : owner.taken;
    return { entity, created: false, otherKind: entity.kind !== input.kind, undo: () => {} };
  }
  const storyId = input.storyId && data.stories[input.storyId] ? input.storyId : null;
  const { entity, undo } = createNamedEntity(db, name, input.kind, [], {
    tagline: (input.line ?? '').replace(/\s+/g, ' ').trim(),
    stub: true,
    fromStoryId: storyId,
  });
  return {
    entity,
    created: true,
    otherKind: false,
    undo: () =>
      db.batch(() => {
        if (!db.getSnapshot().entities[entity.id]) return;
        takeFromSheets(db, entity.id);
        undo();
      }),
  };
}

/**
 * „Fertig – kein Platzhalter mehr“: Der Eintrag gilt als gewöhnlicher Eintrag, auch wenn noch
 * nichts weiter dasteht. Gibt `undo` zurück.
 */
export function finishStub(db: CampaignDb, entityId: string): () => void {
  const entity = db.getSnapshot().entities[entityId];
  if (!entity?.stub) return () => {};
  db.patch('entities', entityId, { stub: false });
  return () => {
    const now = db.getSnapshot().entities[entityId];
    if (now && !now.stub) db.patch('entities', entityId, { stub: true });
  };
}

export interface NewEntryInput {
  name: string;
  /** null = nur ein Text, ohne Art (ein Artikel ohne Eintrag der Welt). */
  kind: EntityKind | null;
  /** Gleich den Text anfangen – mit dem Steckbrief-Gerüst der Art. */
  withText: boolean;
  /** Wo der neue Text im Baum liegt (ein Artikel); sonst ganz oben. */
  parentId?: string | null | undefined;
  /** Das eigene Wort unter der Kategorie: Fischerdorf, Gilde, Tagebuch … (bei Personen die Rolle). */
  word?: string | undefined;
  /** Die eigene Vorlage für Kategorie und Wort – der Text beginnt mit ihr statt mit dem Gerüst. */
  template?: string | undefined;
}

export interface NewEntryResult {
  /** Der Eintrag – neu oder der, dem der Name schon gehört. null bei einem Text ohne Art. */
  entity: Entity | null;
  /** Der Text, wenn einer da ist (neu oder schon vorhanden). */
  article: Article | null;
  /** Gerade erst entstanden – sonst gab es den Namen schon und wird nur geöffnet. */
  created: boolean;
}

/**
 * Das eine „Neu“ der Welt: Name und Art. Gibt es den Namen schon (`entryForTitle`, bei einem
 * Text ohne Art auch der Titel eines Artikels), entsteht nichts – der vorhandene wird geöffnet.
 * Sonst ein gewöhnlicher Eintrag (kein Platzhalter: er entsteht nicht beim Schreiben einer
 * Geschichte, sondern mit Absicht); ein Artikel dieses Titels ohne Eintrag wird sein Text
 * (`createNamedEntity`). Auf Wunsch gleich der Text mit dem Gerüst der Art. null ohne Namen.
 */
/** Setzt das eigene Wort eines Eintrags (bei Personen die Rolle, sonst „Genauer“). */
function withOwnWord(db: CampaignDb, entity: Entity, word: string): Entity {
  if (entity.kind === 'character') return entity;
  if (entity.kind === 'person')
    return db.patch('entities', entity.id, { person: { ...entity.person, role: word } }) ?? entity;
  const details = (entity as unknown as Record<string, object>)[entity.kind];
  return (
    db.patch('entities', entity.id, {
      [entity.kind]: { ...details, category: word },
    } as Partial<Entity>) ?? entity
  );
}

export function newEntry(db: CampaignDb, input: NewEntryInput): NewEntryResult | null {
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  flushEdits();
  const data = db.getSnapshot();
  const articleOf = (entity: Entity | null) =>
    entity?.lk ? (data.articles[entity.lk.resourceId] ?? null) : null;
  const owner = entryForTitle(data, name);
  if (owner) {
    const entity = 'free' in owner ? owner.free : owner.taken;
    return { entity, article: articleOf(entity), created: false };
  }
  if (input.kind === null) {
    const found = linkIndex(data.articles).resolve(name);
    const existing = found ? data.articles[found.id] : undefined;
    if (existing && !existing.template) return { entity: null, article: existing, created: false };
    const made = createArticleOfKind(db, {
      title: name,
      parentId: input.parentId ?? null,
      kind: null,
      scaffold: false,
    });
    return made ? { entity: null, article: made.article, created: true } : null;
  }
  return db.batch(() => {
    const made0 = createNamedEntity(db, name, input.kind!, []);
    const word = (input.word ?? '').replace(/\s+/g, ' ').trim();
    const entity = word ? withOwnWord(db, made0.entity, word) : made0.entity;
    const now = db.getSnapshot();
    const adopted = entity.lk ? (now.articles[entity.lk.resourceId] ?? null) : null;
    if (adopted || !input.withText) return { entity, article: adopted, created: true };
    const made = createArticleOfKind(db, {
      title: name,
      parentId: input.parentId ?? null,
      kind: input.kind,
      scaffold: true,
      entityId: entity.id,
      ...(input.template ? { template: input.template } : {}),
    });
    return {
      entity: (made?.entity ?? db.getSnapshot().entities[entity.id]) || entity,
      article: made?.article ?? null,
      created: true,
    };
  });
}
