/** Befehle unter der Erde: ein Licht anzünden, löschen, die Helligkeit eines Ortes festlegen. */
import type { CampaignDb } from '../../data/db';
import { createTimer, type PlaceLight } from '../../domain/schema';
import type { LightPreset } from '../../domain/underground';

/** Zündet eine Lichtquelle an: Sie brennt ab jetzt für ihre Dauer. `undo` nimmt sie wieder weg. */
export function lightUp(db: CampaignDb, preset: LightPreset): () => void {
  const now = db.getSnapshot().state.now;
  const timer = db.put(
    'timers',
    createTimer({
      label: preset.label,
      kind: 'light',
      start: now,
      end: now + preset.minutes,
      note: preset.reach,
    }),
  );
  return () => {
    if (db.getSnapshot().timers[timer.id]) db.remove('timers', timer.id);
  };
}

/** Löscht ein Licht vorzeitig. `undo` lässt es weiterbrennen. */
export function putOut(db: CampaignDb, timerId: string): (() => void) | null {
  if (!db.getSnapshot().timers[timerId]) return null;
  db.patch('timers', timerId, { done: true });
  return () => {
    if (db.getSnapshot().timers[timerId]) db.patch('timers', timerId, { done: false });
  };
}

/**
 * Legt fest, wie hell es an einem Ort ist (gilt auch für die Orte darunter) – oder überlässt es
 * mit null wieder Wayfarer.
 */
export function setPlaceLight(db: CampaignDb, placeId: string, light: PlaceLight | null): void {
  const place = db.getSnapshot().entities[placeId];
  if (place?.kind !== 'place') return;
  db.patch('entities', placeId, { place: { ...place.place, light } });
}
