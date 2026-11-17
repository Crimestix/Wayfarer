/** Befehle rund ums Wetter: Klima eines Ortes festlegen, Wetter eines Tages von Hand setzen. */
import type { CampaignDb } from '../../data/db';
import { newId, nowIso, weatherId, WeatherSchema, type Weather } from '../../domain/schema';
import { presetClimate, presetClimateId, type ClimatePreset } from '../../domain/weather';
import { warmestMonth, type WeatherZone } from '../../domain/weatherZone';

/**
 * Sorgt dafür, dass die Klimazone im Spielstand liegt. Erkannte und angenommene Zonen entstehen
 * erst im Arbeitsspeicher; sobald etwas an ihnen hängt (ein Ort, ein festgelegtes Wetter),
 * werden sie gespeichert.
 */
function ensureClimate(db: CampaignDb, preset: ClimatePreset): string {
  const data = db.getSnapshot();
  const id = presetClimateId(preset);
  if (!data.climates[id])
    db.put(
      'climates',
      presetClimate(preset, data.campaign.calendar.months.length, warmestMonth(data), nowIso()),
    );
  return id;
}

/**
 * Legt das Klima eines Ortes fest (es gilt für alle Orte darunter) oder nimmt die Festlegung
 * zurück – dann erkennt Wayfarer das Klima wieder selbst. `undo` stellt den alten Stand her.
 */
export function setPlaceClimate(
  db: CampaignDb,
  placeId: string,
  preset: ClimatePreset | null,
): (() => void) | null {
  const place = db.getSnapshot().entities[placeId];
  if (place?.kind !== 'place') return null;
  const before = place.place.climateId;
  const set = (climateId: string | null) => {
    const current = db.getSnapshot().entities[placeId];
    if (current?.kind === 'place')
      db.patch('entities', placeId, { place: { ...current.place, climateId } });
  };
  db.batch(() => set(preset ? ensureClimate(db, preset) : null));
  return () => set(before);
}

export interface ManualWeather {
  temperature: number;
  precipitation: Weather['precipitation'];
  wind: Weather['wind'];
  fog: boolean;
  note: string;
}

/** Legt das Wetter eines Tages in einer Zone von Hand fest. Es wird nie neu errechnet. */
export function setManualWeather(
  db: CampaignDb,
  zone: WeatherZone,
  day: number,
  values: ManualWeather,
): void {
  db.batch(() => {
    // Die Zone muss im Spielstand liegen, damit das Wetter beim Laden seinen Platz findet.
    if (!db.getSnapshot().climates[zone.climate.id])
      db.put('climates', { ...zone.climate, created: nowIso(), updated: nowIso() });
    const id = weatherId(zone.climate.id, day);
    const existing = db.getSnapshot().weather[id];
    const stamp = nowIso();
    db.put(
      'weather',
      WeatherSchema.parse({
        id,
        rev: existing?.rev ?? 0,
        created: existing?.created ?? stamp,
        updated: stamp,
        climateId: zone.climate.id,
        day,
        ...values,
        manual: true,
      }),
    );
  });
}

/** Überlässt das Wetter eines Tages wieder Wayfarer. */
export function clearManualWeather(db: CampaignDb, zone: WeatherZone, day: number): void {
  db.remove('weather', weatherId(zone.climate.id, day));
}

/** Legt fest, welcher Monat der wärmste des Jahres ist; null = aus dem Kalender abgeleitet. */
export function setWarmestMonth(db: CampaignDb, month: number | null): void {
  db.setCampaign({ warmestMonth: month });
}

/**
 * Ein eigenes Klima für einen Ort (Wunsch 17. 11.: „eigene Temperaturen und Niederschläge“): eine
 * Kopie des Klimas, das dort gerade gilt, unter eigenem Namen – danach je Monat änderbar
 * (`patchClimateMonth`). Gibt die Kennung und `undo` zurück.
 */
export function ownClimate(
  db: CampaignDb,
  placeId: string,
  zone: WeatherZone,
): { id: string; undo: () => void } | null {
  const place = db.getSnapshot().entities[placeId];
  if (place?.kind !== 'place') return null;
  const before = place.place.climateId;
  const stamp = nowIso();
  const id = newId();
  db.batch(() => {
    db.put('climates', {
      ...zone.climate,
      id,
      name: `Klima von ${place.name}`,
      created: stamp,
      updated: stamp,
    });
    db.patch('entities', placeId, { place: { ...place.place, climateId: id } });
  });
  return {
    id,
    undo: () =>
      db.batch(() => {
        const current = db.getSnapshot().entities[placeId];
        if (current?.kind === 'place')
          db.patch('entities', placeId, { place: { ...current.place, climateId: before } });
        if (db.getSnapshot().climates[id]) db.remove('climates', id);
      }),
  };
}

/** Ändert einen Monat eines eigenen Klimas: Temperaturen in °C, Niederschlag in Prozent. */
export function patchClimateMonth(
  db: CampaignDb,
  climateId: string,
  month: number,
  change: { tempMin?: number; tempMax?: number; precipitation?: number },
): void {
  const climate = db.getSnapshot().climates[climateId];
  if (!climate?.months[month]) return;
  db.patch('climates', climateId, {
    months: climate.months.map((entry, index) =>
      index === month ? { ...entry, ...change } : entry,
    ),
  });
}
