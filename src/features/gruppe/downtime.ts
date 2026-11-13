/**
 * Freie Zeit verbringen: Die Weltzeit vergeht um die gewählten Tage (Termine und Uhren treten
 * dabei ein wie sonst auch), die Vorhaben der Gefährten wachsen, und ein Eintrag steht in der
 * Chronik. Fertig Hergestelltes kann dem Gefährten gehören. Die Rechnung steht in
 * `domain/downtime.ts`; hier wird geschrieben.
 */
import { advanceTime, logEntry, undoTimeAdvance, type TimeAdvanceResult } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import { recordEntry } from '../../data/record';
import {
  itemsToHand,
  planDowntime,
  type DowntimeInput,
  type ProjectProgress,
} from '../../domain/downtime';
import { createTrack, type Entity, type Track } from '../../domain/schema';
import { MINUTES_PER_DAY } from '../../domain/time/calendar';
import { noteHolderChange } from '../welt/actions';

export interface DowntimeResult {
  advance: TimeAdvanceResult;
  /** Der Eintrag der Chronik. */
  text: string;
  /** Was in dieser Zeit fertig geworden ist. */
  finished: ProjectProgress[];
  /** Gegenstände, die jetzt einem Gefährten gehören: Name des Gegenstands und des Gefährten. */
  handed: { item: string; holder: string }[];
  undo: () => void;
}

/**
 * Verbringt freie Zeit. Ohne ganze Tage geschieht nichts (null). `undo` nimmt alles zurück, was
 * seither nicht von Hand geändert wurde – die Zeit nur, wenn seither kein weiterer Sprung kam.
 */
export function spendDowntime(db: CampaignDb, input: DowntimeInput): DowntimeResult | null {
  const before = db.getSnapshot();
  const plan = planDowntime(before, input);
  if (plan.days < 1) return null;
  const from = before.state.now;
  const to = from + plan.days * MINUTES_PER_DAY;
  const hand = itemsToHand(before, plan);

  const { advance, created, entryId, holderEntries } = db.batch(() => {
    const advance = advanceTime(db, to);
    const created: string[] = [];
    for (const p of plan.progress) {
      if (p.trackId) {
        db.patch('tracks', p.trackId, {
          value: p.after,
          ...(p.finished ? { done: true } : {}),
        });
        continue;
      }
      const track = db.put(
        'tracks',
        createTrack({
          name: p.name,
          ownerId: p.ownerId,
          kind: 'count',
          target: p.target,
          step: 1,
          unit: 'Tage',
          value: p.after,
          done: p.finished,
          downtime: { activity: p.activity, itemId: p.itemId },
        }),
      );
      created.push(track.id);
    }
    // Ein Eintrag „Zwischenzeit“ am Beginn der freien Zeit, je Gefährte seine Tätigkeit – so
    // steht er wie ein von Hand festgehaltener in Chronik, Rückblick und Nachtragen.
    const recorded = recordEntry(db, {
      kind: 'downtime',
      at: from,
      backfilled: false,
      refs: plan.refs,
      downtime: { days: plan.days, activities: plan.activities },
    });
    const entry =
      'entry' in recorded ? recorded.entry : logEntry(db, { text: plan.text, refs: plan.refs });
    const holderEntries: string[] = [];
    for (const { itemId, holderId } of hand) {
      const current = db.getSnapshot().entities[itemId];
      if (current?.kind !== 'item') continue;
      const saved = db.put('entities', { ...current, item: { ...current.item, holderId } });
      const noted = noteHolderChange(db, current, saved);
      if (noted) holderEntries.push(noted.id);
    }
    return { advance, created, entryId: entry.id, holderEntries };
  });

  const handed = hand.map(({ itemId, holderId }) => ({
    item: before.entities[itemId]?.name ?? '',
    holder: before.entities[holderId]?.name ?? '',
  }));

  const undo = () =>
    db.batch(() => {
      const current = db.getSnapshot();
      if (current.state.now === to && current.state.previousNow === from) undoTimeAdvance(db);
      for (const id of created) if (db.getSnapshot().tracks[id]) db.remove('tracks', id);
      for (const p of plan.progress) {
        if (!p.trackId) continue;
        const track: Track | undefined = db.getSnapshot().tracks[p.trackId];
        const was = before.tracks[p.trackId];
        // Nur zurücksetzen, was seither niemand von Hand geändert hat.
        if (track && was && track.value === p.after)
          db.patch('tracks', p.trackId, { value: was.value, done: was.done });
      }
      if (db.getSnapshot().chronicle[entryId]) db.remove('chronicle', entryId);
      for (const id of holderEntries)
        if (db.getSnapshot().chronicle[id]) db.remove('chronicle', id);
      for (const { itemId, holderId } of hand) {
        const item: Entity | undefined = db.getSnapshot().entities[itemId];
        const was = before.entities[itemId];
        if (item?.kind === 'item' && was?.kind === 'item' && item.item.holderId === holderId)
          db.put('entities', { ...item, item: { ...item.item, holderId: was.item.holderId } });
      }
    });

  return {
    advance,
    text: plan.text,
    finished: plan.progress.filter((p) => p.finished && p.before < p.after),
    handed,
    undo,
  };
}
