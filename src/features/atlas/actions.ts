/** Befehle des Bereichs „Atlas“: den Planeten übernehmen, Orte auf ihm setzen. */
import type { CampaignDb } from '../../data/db';
import { wrapLon, type LonLat } from '../../domain/geo';
import { AtlasSchema, newId, nowIso, type Atlas } from '../../domain/schema';
import { OWN_LAND_PREFIX, PLANET_ID, RELIEF_ID, isOwnLand } from './model';

export { isOwnLand };

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
    // Landmassen, die aus einem Bild eingelesen wurden, gehören nicht zur Weltdatei – sie bleiben.
    const before = db.getSnapshot().atlas[PLANET_ID];
    const own = (before?.lands ?? []).filter(isOwnLand);
    // Was von Hand einem Ort zugeordnet war, bleibt zugeordnet.
    const assigned = new Map((before?.lands ?? []).map((land) => [land.id, land.placeId]));
    const fresh = planet.lands
      .filter((land) => !isOwnLand(land))
      .map((land) => ({ ...land, placeId: assigned.get(land.id) ?? land.placeId }));
    // Was ausgeblendet war, bleibt es – sofern die Weltdatei die Landmasse noch kennt.
    const hiddenLands = (before?.hiddenLands ?? []).filter((id) =>
      fresh.some((land) => land.id === id),
    );
    putPart(db, PLANET_ID, { ...planet, lands: [...fresh, ...own], hiddenLands });
    if (relief) putPart(db, RELIEF_ID, relief);
  });
}

/**
 * Fügt dem Planeten eine Landmasse hinzu – Küsten und Gewässer als Ringe in Länge und Breite.
 * Gibt `undo` zurück.
 */
export function addLand(
  db: CampaignDb,
  land: { name: string; rings: number[][]; holes: number[][] },
): () => void {
  const planet = db.getSnapshot().atlas[PLANET_ID];
  if (!planet) return () => {};
  const id = `${OWN_LAND_PREFIX}${newId()}`;
  db.put('atlas', {
    ...planet,
    lands: [
      ...planet.lands,
      {
        id,
        name: land.name.trim(),
        placeId: null,
        rings: land.rings,
        holes: land.holes,
        relief: 'generated' as const,
      },
    ],
  });
  return removeLand.bind(null, db, id);
}

/** Legt fest, ob eine eingelesene Landmasse ein erzeugtes Gelände bekommt oder flach bleibt. */
export function setLandRelief(db: CampaignDb, landId: string, relief: 'generated' | 'flat'): void {
  const planet = db.getSnapshot().atlas[PLANET_ID];
  if (!planet || !planet.lands.some((land) => land.id === landId)) return;
  db.put('atlas', {
    ...planet,
    lands: planet.lands.map((land) => (land.id === landId ? { ...land, relief } : land)),
  });
}

/**
 * Blendet eine Landmasse der Weltdatei aus oder wieder ein. Ausgeblendet fehlt sie auf Karte und
 * Kugel und in allen Abfragen – samt ihren Seen, Flüssen und Höhen.
 */
export function setLandHidden(db: CampaignDb, landId: string, hidden: boolean): void {
  const planet = db.getSnapshot().atlas[PLANET_ID];
  if (!planet || !planet.lands.some((land) => land.id === landId)) return;
  const rest = planet.hiddenLands.filter((id) => id !== landId);
  db.put('atlas', { ...planet, hiddenLands: hidden ? [...rest, landId] : rest });
}

/** Nimmt eine Landmasse wieder vom Planeten. */
export function removeLand(db: CampaignDb, landId: string): void {
  const planet = db.getSnapshot().atlas[PLANET_ID];
  if (!planet || !planet.lands.some((land) => land.id === landId)) return;
  db.put('atlas', { ...planet, lands: planet.lands.filter((land) => land.id !== landId) });
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
/**
 * Ordnet eine Landmasse einem Ort der Welt zu (ein Kontinent ist dieser Ort) – oder überlässt es
 * mit null wieder Wayfarer, das am Namen erkennt.
 */
export function setLandPlace(db: CampaignDb, landId: string, placeId: string | null): void {
  const planet = db.getSnapshot().atlas[PLANET_ID];
  if (!planet) return;
  db.patch('atlas', PLANET_ID, {
    lands: planet.lands.map((land) => (land.id === landId ? { ...land, placeId } : land)),
  });
}

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
