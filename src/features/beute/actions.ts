/**
 * Befehle des Beute-Buchs: Beute bereitlegen, ausgeben, zurücknehmen. Eine Ausgabe steht auch in
 * der Chronik; ein Gegenstand der Welt wechselt dabei zu dem, der ihn bekommt – und beim
 * Zurücknehmen dorthin, wo er vorher war (`loot.holderBefore`).
 */
import { logEntry } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import { recordEntry } from '../../data/record';
import { lootLine, lootRecipient } from '../../domain/loot';
import {
  createLoot,
  type CampaignData,
  type ChronicleEntry,
  type ChroniclePrecision,
  type Loot,
} from '../../domain/schema';
import type { WorldTime } from '../../domain/time/calendar';

export type LootInput = Pick<Loot, 'text' | 'gold' | 'itemId' | 'toId' | 'source' | 'storyId'>;

const clean = (db: CampaignDb, input: LootInput): LootInput => {
  const data = db.getSnapshot();
  const exists = (id: string | null, kind: string) =>
    id && data.entities[id]?.kind === kind ? id : null;
  return {
    text: input.text.replace(/\s+/g, ' ').trim(),
    gold: Number.isFinite(input.gold) && input.gold > 0 ? Math.round(input.gold * 100) / 100 : 0,
    itemId: exists(input.itemId, 'item'),
    toId: exists(input.toId, 'character'),
    source: input.source.trim(),
    storyId: input.storyId && data.stories[input.storyId] ? input.storyId : null,
  };
};

/** Die Zeile der Chronik zu einer Ausgabe. */
const lineOf = (data: Pick<CampaignData, 'entities'>, loot: Loot) => ({
  text: `Beute: ${lootLine(data, loot)} – an ${lootRecipient(data, loot)}${loot.source ? ` (${loot.source})` : ''}`,
  refs: [loot.toId, loot.itemId].filter((ref): ref is string => !!ref),
  storyId: loot.storyId,
});

/**
 * Der Gegenstand einer Ausgabe geht an den Empfänger (an die Gruppe: an niemanden Bestimmten –
 * er liegt dann nicht mehr dort, wo er lag). Gibt zurück, wer ihn vorher hatte.
 */
function claimItem(db: CampaignDb, loot: Loot): string | null {
  const item = loot.itemId ? db.getSnapshot().entities[loot.itemId] : undefined;
  if (item?.kind !== 'item') return null;
  const before = item.item.holderId;
  if (before !== loot.toId)
    db.put('entities', { ...item, item: { ...item.item, holderId: loot.toId } });
  return before;
}

/** Der Gegenstand kehrt dorthin zurück, wo er vorher war – wenn ihn noch der Empfänger hat. */
function releaseItem(db: CampaignDb, loot: Loot): void {
  const item = loot.itemId ? db.getSnapshot().entities[loot.itemId] : undefined;
  if (item?.kind !== 'item' || item.item.holderId !== loot.toId) return;
  if (loot.holderBefore !== loot.toId)
    db.put('entities', { ...item, item: { ...item.item, holderId: loot.holderBefore } });
}

/**
 * Legt Beute bereit oder ändert einen Eintrag. Ohne Inhalt entsteht nichts. Ist der Eintrag schon
 * ausgegeben, ziehen Gegenstand und Zeile der Chronik mit; Abend, Ort und Zeit bleiben.
 */
export function saveLoot(db: CampaignDb, input: LootInput, id?: string): Loot | null {
  const values = clean(db, input);
  if (!values.text && !values.gold && !values.itemId) return null;
  const before = id ? db.getSnapshot().loot[id] : undefined;
  if (!before) return db.put('loot', createLoot(values));
  if (!before.given) return db.patch('loot', before.id, values);
  let saved = before;
  db.batch(() => {
    releaseItem(db, before);
    const next = { ...before, ...values };
    const holderBefore = claimItem(db, next);
    saved = db.patch('loot', before.id, { ...values, holderBefore });
    const data = db.getSnapshot();
    if (before.chronicleId && data.chronicle[before.chronicleId])
      db.patch('chronicle', before.chronicleId, lineOf(data, saved));
  });
  return saved;
}

/**
 * Gibt Beute aus: Sie steht ab jetzt im Beute-Buch – mit Abend, Ort und Zeit – und in der
 * Chronik. Ein Gegenstand der Welt gehört danach dem, der ihn bekommt. `undo` nimmt genau das
 * zurück.
 */
export function giveLoot(db: CampaignDb, id: string): (() => void) | null {
  const data = db.getSnapshot();
  const loot = data.loot[id];
  if (!loot || loot.given) return null;
  db.batch(() => {
    const entry = logEntry(db, lineOf(data, loot));
    const holderBefore = claimItem(db, loot);
    db.patch('loot', id, {
      given: true,
      at: data.state.now,
      sessionId: data.state.sessionId,
      placeId: data.state.placeId,
      chronicleId: entry.id,
      holderBefore,
    });
  });
  return () => takeBackLoot(db, id);
}

/** Wann, an welchem Abend und wo eine nachgetragene Ausgabe geschah. */
export interface LootWhen {
  at: WorldTime;
  sessionId: string | null;
  placeId: string | null;
  /** Wie genau die Zeit bekannt ist (Vorgabe: genau). */
  precision?: ChroniclePrecision;
  /** Die Zeile der Chronik nur für die Spielleitung. */
  secret?: boolean;
}

/**
 * Gibt Beute zu einer früheren Zeit aus – beim Nachtragen alter Sessions: Der Eintrag entsteht
 * gleich als ausgegeben, mit Abend, Ort und Zeit von damals, und seine Zeile steht nachgetragen
 * in der Chronik. Nichts davon hängt an „jetzt“. Ein Gegenstand der Welt gehört danach dem
 * Empfänger. `undo` löscht den Eintrag samt Zeile (wie `removeLoot`).
 */
export function giveLootAt(
  db: CampaignDb,
  input: LootInput,
  when: LootWhen,
): { loot: Loot; undo: () => void } | { problem: string } {
  const values = clean(db, input);
  if (!values.text && !values.gold && !values.itemId)
    return { problem: 'Die Beute braucht einen Inhalt.' };
  return db.batch(() => {
    const data = db.getSnapshot();
    const draft = createLoot(values);
    const line = lineOf(data, draft);
    const recorded = recordEntry(db, {
      kind: 'note',
      text: line.text,
      refs: line.refs,
      storyId: line.storyId,
      at: when.at,
      sessionId: when.sessionId,
      placeId: when.placeId,
      secret: when.secret ?? false,
      backfilled: when.at < data.state.now,
      precision: when.precision ?? 'exact',
    });
    if ('problem' in recorded) return recorded;
    const holderBefore = claimItem(db, draft);
    const loot = db.put('loot', {
      ...draft,
      given: true,
      at: when.at,
      sessionId: when.sessionId,
      placeId: when.placeId,
      chronicleId: recorded.entry.id,
      holderBefore,
    });
    return { loot, undo: () => void removeLoot(db, loot.id) };
  });
}

/**
 * Nimmt eine Ausgabe zurück: Die Beute liegt wieder bereit, ihr Eintrag in der Chronik geht, und
 * ein Gegenstand der Welt ist wieder dort, wo er vorher war. `undo` gibt sie wieder aus – mit
 * dem Abend, dem Ort und der Zeit von damals.
 */
export function takeBackLoot(db: CampaignDb, id: string): (() => void) | null {
  const data = db.getSnapshot();
  const loot = data.loot[id];
  if (!loot?.given) return null;
  const entry = loot.chronicleId ? data.chronicle[loot.chronicleId] : undefined;
  db.batch(() => {
    if (entry) db.remove('chronicle', entry.id);
    releaseItem(db, loot);
    db.patch('loot', id, {
      given: false,
      at: null,
      sessionId: null,
      placeId: null,
      chronicleId: null,
      holderBefore: null,
    });
  });
  return () => regive(db, loot, entry);
}

/** Gibt eine zurückgenommene oder gelöschte Ausgabe so wieder aus, wie sie war. */
function regive(db: CampaignDb, was: Loot, entry: ChronicleEntry | undefined): void {
  db.batch(() => {
    const now = db.getSnapshot();
    const current = now.loot[was.id];
    if (current?.given) return;
    let chronicleId = was.chronicleId;
    if (entry && !now.chronicle[entry.id]) db.put('chronicle', { ...entry, rev: 0 });
    else if (!entry) chronicleId = logEntry(db, lineOf(now, was)).id;
    const holderBefore = claimItem(db, was);
    const doc = { ...was, chronicleId, holderBefore };
    if (current) db.put('loot', { ...doc, rev: current.rev });
    else db.put('loot', { ...doc, rev: 0 });
  });
}

/** Löscht einen Eintrag – und, wenn er ausgegeben war, seine Zeile in der Chronik. */
export function removeLoot(db: CampaignDb, id: string): (() => void) | null {
  const data = db.getSnapshot();
  const loot = data.loot[id];
  if (!loot) return null;
  const entry = loot.chronicleId ? data.chronicle[loot.chronicleId] : undefined;
  db.batch(() => {
    if (loot.given) {
      if (entry) db.remove('chronicle', entry.id);
      releaseItem(db, loot);
    }
    db.remove('loot', id);
  });
  return () => {
    if (db.getSnapshot().loot[id]) return;
    if (loot.given) regive(db, loot, entry);
    else db.put('loot', { ...loot, rev: 0 });
  };
}

/**
 * Wird die Zeile einer Ausgabe aus der Chronik gelöscht, gilt die Ausgabe als nicht geschehen:
 * Die Beute liegt wieder bereit. Gibt `undo` zurück – oder null, wenn die Zeile zu keiner Beute
 * gehört.
 */
export function dropLootLine(db: CampaignDb, entryId: string): (() => void) | null {
  const loot = lootOfLine(db.getSnapshot(), entryId);
  return loot ? takeBackLoot(db, loot.id) : null;
}

/** Gehört diese Zeile der Chronik zu einer Ausgabe im Beute-Buch? */
export const lootOfLine = (data: Pick<CampaignData, 'loot'>, entryId: string): Loot | undefined =>
  Object.values(data.loot).find((loot) => loot.given && loot.chronicleId === entryId);
