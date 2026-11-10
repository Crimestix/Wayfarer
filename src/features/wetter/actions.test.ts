import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity, type Place } from '../../domain/schema';
import { dayIndexOf } from '../../domain/time/calendar';
import { warmestMonth, weatherAt, weatherZone, zoneWeather } from '../../domain/weatherZone';
import { readBackup, createBackup } from '../einstellungen/backup';
import { clearManualWeather, setManualWeather, setPlaceClimate, setWarmestMonth } from './actions';

async function setup() {
  const base = elarisCampaign();
  const land = createEntity({ kind: 'place', name: 'Graumark' });
  const city = createEntity({ kind: 'place', name: 'Hohenfurt', place: { parentId: land.id } });
  const store = new MemoryStore();
  const db = await CampaignDb.create(store, {
    ...base,
    entities: { ...base.entities, [land.id]: land, [city.id]: city },
  });
  return { db, store, land, city };
}

describe('Wetter festlegen', () => {
  it('legt das Klima eines Ortes fest und nimmt es zurück', async () => {
    const { db, store, land, city } = await setup();
    expect(weatherZone(db.getSnapshot(), city.id).source).toBe('default');

    const undo = setPlaceClimate(db, land.id, 'desert')!;
    let data = db.getSnapshot();
    expect((data.entities[land.id] as Place).place.climateId).toBe('klima-desert');
    expect(data.climates['klima-desert']?.months).toHaveLength(12);
    expect(weatherZone(data, city.id)).toMatchObject({
      source: 'chosen',
      preset: 'desert',
      from: { id: land.id },
    });
    await db.flush();
    expect(store.files.has('climates/klima-desert.json')).toBe(true);

    // Festlegung aufheben: Wayfarer erkennt das Klima wieder selbst.
    setPlaceClimate(db, land.id, null);
    expect(weatherZone(db.getSnapshot(), city.id).source).toBe('default');
    setPlaceClimate(db, land.id, 'cold');
    undo();
    data = db.getSnapshot();
    expect((data.entities[land.id] as Place).place.climateId).toBeNull();
    // Für etwas, das kein Ort ist, geschieht nichts.
    expect(setPlaceClimate(db, 'gibtsnicht', 'cold')).toBeNull();
  });

  it('setzt das Wetter eines Tages von Hand und überlässt es wieder Wayfarer', async () => {
    const { db, store, city } = await setup();
    const now = db.getSnapshot().state.now;
    const day = dayIndexOf(now);
    const zone = weatherZone(db.getSnapshot(), city.id);
    const simulated = zoneWeather(db.getSnapshot(), zone, day);

    setManualWeather(db, zone, day, {
      temperature: 33,
      precipitation: 'none',
      wind: 'strong',
      fog: false,
      note: 'Glutwind aus dem Süden',
    });
    let at = weatherAt(db.getSnapshot(), city.id, now);
    expect(at.today).toMatchObject({
      manual: true,
      high: 33,
      wind: 'strong',
      note: 'Glutwind aus dem Süden',
    });
    // Die angenommene Zone liegt jetzt im Spielstand, damit das Wetter seinen Platz behält.
    expect(db.getSnapshot().climates[zone.climate.id]).toBeDefined();
    // Der Ort ist dadurch nicht festgelegt.
    expect(weatherZone(db.getSnapshot(), city.id).source).toBe('default');

    // Ein zweites Festlegen ersetzt das erste.
    setManualWeather(db, zone, day, {
      temperature: 5,
      precipitation: 'heavy',
      wind: 'none',
      fog: false,
      note: '',
    });
    expect(Object.keys(db.getSnapshot().weather)).toHaveLength(1);
    expect(weatherAt(db.getSnapshot(), city.id, now).today).toMatchObject({
      high: 5,
      precipitation: 'heavy',
    });

    // Übersteht Speichern, Laden und eine Sicherung.
    await db.flush();
    const reopened = await CampaignDb.open(store);
    expect(reopened.problems).toEqual([]);
    expect(weatherAt(reopened.getSnapshot(), city.id, now).today.manual).toBe(true);
    const restored = readBackup(JSON.parse(JSON.stringify(createBackup(db.getSnapshot()))));
    expect(restored.skipped).toEqual([]);
    expect(weatherAt(restored.data, city.id, now).today).toMatchObject({ manual: true, high: 5 });

    clearManualWeather(db, zone, day);
    at = weatherAt(db.getSnapshot(), city.id, now);
    expect(at.today.manual).toBe(false);
    expect(at.today).toEqual(simulated);
  });

  it('merkt sich den wärmsten Monat', async () => {
    const { db, city } = await setup();
    const before = weatherZone(db.getSnapshot(), city.id).climate.months.map((m) => m.tempMax);
    setWarmestMonth(db, 10);
    expect(warmestMonth(db.getSnapshot())).toBe(10);
    const after = weatherZone(db.getSnapshot(), city.id).climate.months.map((m) => m.tempMax);
    expect(after.indexOf(Math.max(...after))).toBe(10);
    expect(after).not.toEqual(before);
    setWarmestMonth(db, null);
    expect(weatherZone(db.getSnapshot(), city.id).climate.months.map((m) => m.tempMax)).toEqual(
      before,
    );
  });
});
