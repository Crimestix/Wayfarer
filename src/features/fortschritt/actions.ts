/**
 * Befehle der Fortschrittsleisten: anlegen, ändern, löschen, einen Schritt gehen. Jeder Schritt
 * steht als Veränderung in der Chronik – beim Besitzer der Leiste.
 */
import { logEntry } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import { clampTrack, steppedValue, trackLine } from '../../domain/track';
import { PARTY_ID, createTrack, type Track } from '../../domain/schema';

export type TrackInput = Pick<
  Track,
  | 'name'
  | 'ownerId'
  | 'kind'
  | 'stages'
  | 'target'
  | 'step'
  | 'unit'
  | 'segments'
  | 'value'
  | 'note'
>;

/** Legt eine Leiste an oder ändert sie. Ohne Namen entsteht nichts. */
export function saveTrack(db: CampaignDb, input: TrackInput, id?: string): Track | null {
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const values: TrackInput = {
    ...input,
    name,
    unit: input.unit.trim(),
    note: input.note.trim(),
    stages: input.stages.map((stage) => stage.trim()).filter(Boolean),
    target: Math.max(0, input.target),
    step: input.step > 0 ? input.step : 1,
    segments: Math.min(24, Math.max(1, Math.round(input.segments))),
  };
  const shaped = { ...values, value: clampTrack(values as Track, values.value) };
  if (id && db.getSnapshot().tracks[id]) return db.patch('tracks', id, shaped);
  return db.put('tracks', createTrack(shaped));
}

/** Geht einen Schritt vor oder zurück – oder setzt einen Wert – und hält es fest. `undo` nimmt es zurück. */
export function moveTrack(
  db: CampaignDb,
  id: string,
  to: number | 1 | -1,
  options: { exact?: boolean } = {},
): (() => void) | null {
  const track = db.getSnapshot().tracks[id];
  if (!track) return null;
  const value = options.exact ? clampTrack(track, to) : steppedValue(track, to === -1 ? -1 : 1);
  if (value === track.value) return null;
  const before = track.value;
  const owner = track.ownerId && track.ownerId !== PARTY_ID ? [track.ownerId] : [];
  const entry = db.batch(() => {
    db.patch('tracks', id, { value });
    return logEntry(db, {
      kind: 'change',
      text: trackLine(track, value),
      refs: owner,
      placeId: null,
      storyId: track.storyId,
    });
  });
  return () =>
    db.batch(() => {
      if (db.getSnapshot().tracks[id]) db.patch('tracks', id, { value: before });
      if (db.getSnapshot().chronicle[entry.id]) db.remove('chronicle', entry.id);
    });
}

export function setTrackDone(db: CampaignDb, id: string, done: boolean): void {
  if (db.getSnapshot().tracks[id]) db.patch('tracks', id, { done });
}

/** Löscht eine Leiste; ihre Schritte bleiben in der Chronik. */
export function removeTrack(db: CampaignDb, id: string): (() => void) | null {
  const track = db.getSnapshot().tracks[id];
  if (!track) return null;
  db.remove('tracks', id);
  return () => {
    if (!db.getSnapshot().tracks[id]) db.put('tracks', { ...track, rev: 0 });
  };
}
