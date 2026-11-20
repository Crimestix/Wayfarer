/**
 * Befehle der Seite eines Dings: ein Feld im Steckbrief-Kasten schreiben (in den Text des
 * Artikels, nie daneben) und einen Laden, der direkt an einer Stadt steht, zu einem eigenen Ort
 * machen. Regeln in `page.ts`.
 */
import type { CampaignDb } from '../../data/db';
import type { Entity } from '../../domain/schema';
import { shopTitle } from '../../domain/shop';
import { continueWriting, createArticleOfKind, savePageText } from '../wiki/actions';
import { flushEdits } from '../wiki/editing';
import { scaffoldOf } from '../wiki/scaffold';
import { pageText } from '../wiki/text';
import { writeBoxText } from './page';
import { addFromWriting } from './writing';

/** Der Artikel eines Eintrags, wenn er im eigenen Wiki liegt. */
export function articleOf(db: CampaignDb, entityId: string) {
  const data = db.getSnapshot();
  const entity = data.entities[entityId];
  const article = entity?.lk ? data.articles[entity.lk.resourceId] : undefined;
  return article ?? null;
}

/**
 * Schreibt ein Feld des Steckbrief-Kastens in den Text des Artikels (`> [!steckbrief]`) – über
 * `savePageText`, damit die frühere Fassung bleibt. Hat der Eintrag noch keinen Artikel, entsteht
 * mit dem ersten Wort einer mit dem Gerüst seiner Art (`createArticleOfKind`, verbunden mit diesem
 * Eintrag – nie ein zweiter). Ein leerer Wert legt nichts an. Gibt die Kennung des Artikels zurück
 * (danach liest `syncFacts` den Steckbrief in die Welt) oder null, wenn nichts geschah.
 */
export function writeBoxField(
  db: CampaignDb,
  entity: Pick<Entity, 'id' | 'kind' | 'name'>,
  label: string,
  value: string,
): string | null {
  flushEdits();
  const scaffold = scaffoldOf(db.getSnapshot().campaign, entity.kind);
  let article = articleOf(db, entity.id);
  if (!article) {
    if (!value.trim()) return null;
    const made = createArticleOfKind(db, {
      title: entity.name,
      kind: entity.kind,
      scaffold: true,
      entityId: entity.id,
    });
    if (!made || made.entity?.id !== entity.id) return made?.article.id ?? null;
    article = made.article;
  }
  const doc = article.docs.find((d) => d.kind === 'page');
  if (!doc) return null;
  const articles = db.getSnapshot().articles;
  const current = articles[article.id] ?? article;
  const page = current.docs.find((d) => d.id === doc.id) ?? doc;
  const before = pageText(articles, current, page);
  const after = writeBoxText(before, label, value, scaffold);
  if (after !== before) savePageText(db, current.id, page.id, after);
  return current.id;
}

/**
 * Ein Laden, der direkt an einer Stadt (einem Viertel, einer Gegend) steht, bekommt einen eigenen
 * Ort darin – nur auf Klick des Spielleiters. Heißt schon ein Ort so, wird er genommen (Regeln
 * der Namen, `addFromWriting`), sonst entsteht ein Platzhalter in der Stadt. Gibt den Ort und
 * `undo` zurück; null, wenn es den Laden oder seinen Ort nicht gibt oder der Name einem Eintrag
 * anderer Art gehört.
 */
export function shopToOwnPlace(
  db: CampaignDb,
  shopId: string,
): { placeId: string; created: boolean; undo: () => void } | null {
  const data = db.getSnapshot();
  const shop = data.shops[shopId];
  const city = shop?.placeId ? data.entities[shop.placeId] : undefined;
  if (!shop || city?.kind !== 'place') return null;
  const name = shopTitle(data, shop);
  return db.batch(() => {
    const result = addFromWriting(db, { name, kind: 'place' });
    if (!result || result.entity.kind !== 'place') return null;
    const place = result.entity;
    if (place.id === city.id) return null;
    const fresh = db.getSnapshot().entities[place.id];
    if (result.created && fresh?.kind === 'place')
      db.patch('entities', place.id, { place: { ...fresh.place, parentId: city.id } });
    db.patch('shops', shop.id, { placeId: place.id });
    return {
      placeId: place.id,
      created: result.created,
      undo: () =>
        db.batch(() => {
          if (db.getSnapshot().shops[shop.id]) db.patch('shops', shop.id, { placeId: city.id });
          result.undo();
        }),
    };
  });
}

/** Der Text eines Dings beginnt hier: Artikel mit dem Gerüst seiner Art, gleich zum Schreiben. */
export function startEntityText(db: CampaignDb, entity: Entity, typed = ''): string | null {
  flushEdits();
  const made = createArticleOfKind(db, {
    title: entity.name,
    kind: entity.kind,
    scaffold: true,
    entityId: entity.id,
  });
  if (!made) return null;
  continueWriting(db, made.article.id, typed);
  return made.article.id;
}
