/**
 * Zwei Einträge zu einem zusammenlegen (Rückmeldung des Spielleiters, 18. 11. 2026: „Bspw. gibt es
 * zweimal Elaris. Wir müssen irgendwie zusammenführen“ – Altlast aus dem Ordnerbaum von
 * LegendKeeper). Einer bleibt, der andere geht in ihm auf:
 * - Alles, was auf den anderen zeigte, zeigt danach auf den, der bleibt – in jeder Sammlung und im
 *   Spielstand (`rewireId`): Orte darin, Personen dort, Beziehungen, Chronik, Geschichten, Karten.
 * - Der eine Satz, Notizen, Geheimnis, Schlagworte und Beinamen kommen zusammen; was der Bleibende
 *   nicht hat (Lebensdaten, Bild, Angaben seiner Kategorie), nimmt er vom anderen.
 * - Haben beide einen Artikel, bleibt der des Bleibenden: Der Text des anderen steht darunter, seine
 *   Unterartikel hängen danach an ihm, und der alte Artikel liegt im Papierkorb.
 * - Doppelte Beziehungen in derselben Richtung werden eine.
 * Mit Rückgängig. Erfunden wird nichts – es steht nur beieinander, was der Spielleiter schrieb.
 */
import type { CampaignDb } from '../../data/db';
import { ownKindOf } from '../../domain/ownKind';
import {
  COLLECTION_NAMES,
  type CampaignData,
  type CollectionName,
  type CollectionTypes,
  type Entity,
  type PlayState,
} from '../../domain/schema';
import { SUGGESTION, isDismissed } from '../../domain/dismiss';
import { deleteArticle, moveArticle, savePageText } from '../wiki/actions';
import { flushEdits } from '../wiki/editing';
import { pageText } from '../wiki/text';
import { rewireId } from './house';
import { isWorldEntity, type WorldEntity } from './model';

const joinText = (...parts: string[]) =>
  parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');

const fold = (text: string) => text.replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');

const isEmpty = (value: unknown) =>
  value === null ||
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0);

/** Was der Bleibende an Angaben seiner Kategorie nicht hat, nimmt er vom anderen. */
function fillEmpty<T extends Record<string, unknown>>(keep: T, drop: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...keep };
  for (const [key, value] of Object.entries(drop))
    if (key in keep && isEmpty(keep[key]) && !isEmpty(value)) out[key] = value;
  return out as T;
}

const detailsOf = (entity: Entity) =>
  (entity as unknown as Record<string, Record<string, unknown>>)[entity.kind] ?? {};

/** Der zusammengelegte Eintrag – der Bleibende mit allem, was der andere beiträgt. */
export function mergedEntity(keep: WorldEntity, drop: WorldEntity): WorldEntity {
  const sameKind = keep.kind === drop.kind;
  const names = [
    ...keep.aliases,
    ...(fold(drop.name) === fold(keep.name) ? [] : [drop.name]),
    ...drop.aliases,
  ];
  const seen = new Set([fold(keep.name)]);
  const aliases = names.filter((name) => {
    const key = fold(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const otherLine =
    keep.tagline.trim() && drop.tagline.trim() && fold(keep.tagline) !== fold(drop.tagline)
      ? drop.tagline
      : '';
  return {
    ...keep,
    aliases,
    tagline: keep.tagline.trim() || drop.tagline,
    notes: joinText(keep.notes, otherLine, fold(drop.notes) === fold(keep.notes) ? '' : drop.notes),
    secret: joinText(keep.secret, fold(drop.secret) === fold(keep.secret) ? '' : drop.secret),
    tags: [...new Set([...keep.tags, ...drop.tags])],
    born: keep.born ?? drop.born,
    ended: keep.ended ?? drop.ended,
    image: keep.image ?? drop.image,
    past: keep.past || drop.past,
    lk: keep.lk ?? drop.lk,
    stub: keep.stub && drop.stub,
    fromStoryId: keep.fromStoryId ?? drop.fromStoryId,
    ownKindId: keep.ownKindId ?? (sameKind ? drop.ownKindId : null),
    [keep.kind]: sameKind ? fillEmpty(detailsOf(keep), detailsOf(drop)) : detailsOf(keep),
  } as WorldEntity;
}

/** Wie viele Stellen auf einen Eintrag zeigen – für die Vorschau im Fenster. */
export function referencesTo(data: CampaignData, entityId: string): number {
  let count = 0;
  for (const name of COLLECTION_NAMES)
    for (const doc of Object.values(data[name] as Readonly<Record<string, { id: string }>>))
      if (doc.id !== entityId && rewireId(doc, entityId, '\u0000') !== doc) count++;
  return count;
}

export interface MergeEntitiesResult {
  /** Der Eintrag, der bleibt. */
  keepId: string;
  name: string;
  /** So viele andere Einträge und Dokumente zeigen jetzt auf den Bleibenden. */
  moved: number;
  /** Beide hatten einen Artikel: Der Text des anderen steht jetzt unter dem des Bleibenden. */
  textJoined: boolean;
  undo: () => void;
}

/**
 * Legt `dropId` in `keepId` zusammen. Gibt null zurück, wenn einer fehlt, beide derselbe sind oder
 * einer kein Eintrag der Welt ist (Gefährten bleiben, was sie sind).
 */
export function mergeEntities(
  db: CampaignDb,
  keepId: string,
  dropId: string,
): MergeEntitiesResult | null {
  flushEdits();
  const before = db.getSnapshot();
  const keep = before.entities[keepId];
  const drop = before.entities[dropId];
  if (!isWorldEntity(keep) || !isWorldEntity(drop) || keepId === dropId) return null;
  const keepArticle = keep.lk ? before.articles[keep.lk.resourceId] : undefined;
  const dropArticle = drop.lk ? before.articles[drop.lk.resourceId] : undefined;
  const bothTexts = !!keepArticle && !!dropArticle && keepArticle.id !== dropArticle.id;
  let moved = 0;

  db.batch(() => {
    // 1. Die Texte: Der des anderen kommt unter den des Bleibenden, seine Unterartikel hängen um.
    if (bothTexts) {
      for (const child of Object.values(before.articles))
        if (child.parentId === dropArticle!.id) moveArticle(db, child.id, keepArticle!.id);
      const keepPage = keepArticle!.docs.find((doc) => doc.kind === 'page');
      const dropPage = dropArticle!.docs.find((doc) => doc.kind === 'page');
      const dropText = dropPage ? pageText(before.articles, dropArticle!, dropPage).trim() : '';
      if (keepPage && dropText) {
        const keepText = pageText(before.articles, keepArticle!, keepPage).trim();
        if (fold(keepText) !== fold(dropText))
          savePageText(
            db,
            keepArticle!.id,
            keepPage.id,
            joinText(keepText, `## Aus „${dropArticle!.title}“`, dropText),
          );
      }
      deleteArticle(db, dropArticle!.id);
    }

    // 2. Alles, was auf den anderen zeigt, zeigt jetzt auf den Bleibenden.
    const mid = db.getSnapshot();
    for (const name of COLLECTION_NAMES) {
      const docs = mid[name] as Readonly<Record<string, { id: string }>>;
      for (const doc of Object.values(docs)) {
        if (name === 'entities' && (doc.id === keepId || doc.id === dropId)) continue;
        const next = rewireId(doc, dropId, keepId);
        if (next === doc) continue;
        moved++;
        db.put(name, next as CollectionTypes[typeof name]);
      }
    }
    const state = rewireId(mid.state, dropId, keepId);
    const stateChange: Partial<Omit<PlayState, 'id'>> = {};
    for (const key of Object.keys(state) as (keyof PlayState)[])
      if (key !== 'id' && state[key] !== mid.state[key])
        (stateChange as Record<string, unknown>)[key] = state[key];
    if (Object.keys(stateChange).length) db.setState(stateChange);

    // 3. Der Bleibende nimmt auf, was der andere beiträgt – ohne auf sich selbst zu zeigen.
    const keepNow = db.getSnapshot().entities[keepId] as WorldEntity;
    const dropNow = { ...drop, lk: bothTexts ? null : drop.lk } as WorldEntity;
    let merged = rewireId(mergedEntity(keepNow, dropNow), dropId, keepId);
    const details = detailsOf(merged);
    const own: Record<string, unknown> = { ...details };
    for (const [key, value] of Object.entries(details)) {
      if (value === keepId) {
        // Lag der Bleibende im anderen, liegt er jetzt dort, wo der andere lag.
        const from = detailsOf(drop)[key];
        own[key] = typeof from === 'string' && from !== keepId && from !== dropId ? from : null;
      } else if (Array.isArray(value) && value.includes(keepId))
        own[key] = value.filter((item) => item !== keepId);
    }
    merged = { ...merged, [merged.kind]: own } as WorldEntity;
    // Eine eigene Unterkategorie gilt nur in ihrer Kategorie.
    if (!ownKindOf(db.getSnapshot(), merged)) merged = { ...merged, ownKindId: null };
    db.put('entities', merged);
    db.remove('entities', dropId);

    // 4. Ein Ort liegt nie in einem Ort, der unter ihm liegt.
    const placed = db.getSnapshot().entities[keepId];
    if (placed?.kind === 'place' && placed.place.parentId) {
      const seen = new Set([keepId]);
      let cursor: string | null = placed.place.parentId;
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const above: Entity | undefined = db.getSnapshot().entities[cursor];
        cursor = above?.kind === 'place' ? above.place.parentId : null;
      }
      if (cursor) db.put('entities', { ...placed, place: { ...placed.place, parentId: null } });
    }

    // 5. Was jetzt doppelt dasteht oder auf sich selbst zeigt, fällt weg.
    const kept = new Map<string, string>();
    for (const relation of Object.values(db.getSnapshot().relations)) {
      if (relation.from !== keepId && relation.to !== keepId) continue;
      if (relation.from === relation.to) {
        db.remove('relations', relation.id);
        continue;
      }
      if (relation.kin !== null || relation.ended) continue;
      const pair = `${relation.from}>${relation.to}>${relation.type}`;
      const first = kept.get(pair);
      if (!first) {
        kept.set(pair, relation.id);
        continue;
      }
      const firstRelation = db.getSnapshot().relations[first];
      if (firstRelation && firstRelation.attitude === null && relation.attitude !== null)
        db.patch('relations', first, { attitude: relation.attitude });
      db.remove('relations', relation.id);
    }
  });
  const after = db.getSnapshot();

  const restore = <C extends CollectionName>(name: C) => {
    const was = before[name] as Readonly<Record<string, CollectionTypes[C]>>;
    const became = after[name] as Readonly<Record<string, CollectionTypes[C]>>;
    const now = db.getSnapshot()[name] as Readonly<Record<string, CollectionTypes[C]>>;
    for (const doc of Object.values(was)) {
      if (became[doc.id] === doc) continue;
      const current = now[doc.id];
      // Nur zurückdrehen, was noch so dasteht, wie das Zusammenlegen es hinterlassen hat.
      if (current !== became[doc.id]) continue;
      db.put(name, { ...doc, rev: Math.max(doc.rev, current?.rev ?? 0) });
    }
    // Was dabei erst entstand (die Fassung im Papierkorb), geht wieder.
    for (const doc of Object.values(became))
      if (!was[doc.id] && now[doc.id] === doc) db.remove(name, doc.id);
  };
  const undo = () =>
    db.batch(() => {
      for (const name of COLLECTION_NAMES) restore(name);
      const current = db.getSnapshot().state;
      const change: Partial<Omit<PlayState, 'id'>> = {};
      for (const key of Object.keys(before.state) as (keyof PlayState)[]) {
        if (key === 'id' || before.state[key] === after.state[key]) continue;
        if (current[key] !== after.state[key]) continue;
        (change as Record<string, unknown>)[key] = before.state[key];
      }
      if (Object.keys(change).length) db.setState(change);
    });
  return {
    keepId,
    name: after.entities[keepId]?.name ?? keep.name,
    moved,
    textJoined: bothTexts,
    undo,
  };
}

// ── Doppelte Namen ───────────────────────────────────────────────────────────

export interface NameTwins {
  /** Der gemeinsame Name, so wie er am ersten Eintrag steht. */
  name: string;
  entities: WorldEntity[];
  key: string;
}

/**
 * Einträge der Welt, die genau gleich heißen (ohne Groß/Klein und doppelte Leerzeichen) – nur ein
 * Hinweis: Ob sie dasselbe sind, entscheidet der Spielleiter. Gefährten und Räume zählen nicht;
 * was er mit „×“ weggeklickt hat („sind verschieden“), auch nicht.
 */
export function nameTwins(data: CampaignData): NameTwins[] {
  const groups = new Map<string, WorldEntity[]>();
  for (const entity of Object.values(data.entities)) {
    if (!isWorldEntity(entity)) continue;
    if (entity.kind === 'place' && entity.place.room) continue;
    const key = fold(entity.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), entity]);
  }
  return [...groups]
    .filter(([, entities]) => entities.length > 1)
    .map(([key, entities]) => ({
      name: entities[0]!.name,
      entities,
      key: SUGGESTION.sameName(key),
    }))
    .filter((twins) => !isDismissed(data, twins.key))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}
