/** Befehle des Bereichs „Atlas“: den Planeten übernehmen, Orte auf ihm setzen. */
import type { CampaignDb } from '../../data/db';
import { wrapLon, type LonLat } from '../../domain/geo';
import { AtlasSchema, nowIso, type Atlas } from '../../domain/schema';
import { PLANET_ID, RELIEF_ID } from './model';

type AtlasInit = Omit<Atlas, 'id' | 'rev' | 'created' | 'updated'>;

function putPart(db: CampaignDb, id: string, init: AtlasInit): Atlas {
  const existing = db.getSnapshot().atlas[id];
  const stamp = nowIso();
  return db.put(
    'atlas',
    AtlasSchema.parse({
      ...init,
      id,
      rev: existing?.rev ?? 0,
      created: existing?.created || stamp,
      updated: stamp,
    }),
  );
}

/**
 * Legt den Planeten in den Spielstand – und, wenn mitgegeben, das Höhenraster. Ein früher
 * übernommener Atlas wird ersetzt; die Lage der Orte bleibt, wie sie ist.
 */
export function applyAtlas(db: CampaignDb, planet: AtlasInit, relief?: AtlasInit | null): void {
  db.batch(() => {
    putPart(db, PLANET_ID, planet);
    if (relief) putPart(db, RELIEF_ID, relief);
  });
}

/** Nimmt den Atlas aus dem Spielstand. Die Lage der Orte bleibt eingetragen. */
export function removeAtlas(db: CampaignDb): void {
  db.batch(() => {
    for (const id of [PLANET_ID, RELIEF_ID]) if (db.getSnapshot().atlas[id]) db.remove('atlas', id);
  });
}

/**
 * Setzt die Lage eines Ortes auf dem Planeten (oder nimmt sie mit `null` wieder weg). Gibt `undo`
 * zurück, das die vorige Lage wiederherstellt.
 */
export function setPlaceGeo(db: CampaignDb, placeId: string, geo: LonLat | null): () => void {
  const place = db.getSnapshot().entities[placeId];
  if (place?.kind !== 'place') return () => {};
  const before = place.place.geo;
  const next = geo
    ? {
        lon: Math.round(wrapLon(geo.lon) * 10000) / 10000,
        lat: Math.round(Math.max(-90, Math.min(90, geo.lat)) * 10000) / 10000,
      }
    : null;
  db.put('entities', { ...place, place: { ...place.place, geo: next } });
  return () => {
    const now = db.getSnapshot().entities[placeId];
    if (now?.kind === 'place') db.put('entities', { ...now, place: { ...now.place, geo: before } });
  };
}
