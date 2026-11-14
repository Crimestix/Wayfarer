import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { saveRun } from '../../features/geschehen/actions';
import { bookCrossing, saveWay } from '../../features/wege/actions';
import { crossingsHere, departureText, passagePrices, tripDays } from '../crossing';
import { createEntity, type Place } from '../schema';
import { MINUTES_PER_DAY } from '../time/calendar';

const DAY = MINUTES_PER_DAY;

/**
 * Erfundene Küste: Hohenfurt mit seinem Hafen. Vom Hafen fährt die Aalfähre alle zwei Tage zur
 * Salzgrotte (Wasserweg, 3 Std.); von Burg Graufels eine Kutschlinie, die hier nichts angeht.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string, parentId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId } })) as Place;
  const town = place('Hohenfurt');
  const harbour = place('Hafen', town.id);
  const inn = place('Zum Aal', town.id);
  const grotto = place('Salzgrotte');
  const castle = place('Burg Graufels');
  saveWay(db, { fromId: harbour.id, toId: grotto.id, minutes: 180, sort: 'water' });
  saveWay(db, { fromId: castle.id, toId: town.id, minutes: 600, sort: 'street' });
  const brann = db.put('entities', createEntity({ kind: 'character', name: 'Brann Eichwald' }));
  const data = () => db.getSnapshot();
  const now = data().state.now;
  const base = {
    carrier: 'Fähre',
    operatorId: null,
    stoppedAt: null,
    stopReason: '',
    note: '',
    every: { every: 2, unit: 'day' as const },
  };
  const ferry = saveRun(db, {
    ...base,
    name: 'Aalfähre',
    fromId: harbour.id,
    toId: grotto.id,
    start: now - DAY + 60,
  });
  saveRun(db, { ...base, name: 'Kutschlinie', fromId: castle.id, toId: town.id, start: now });
  db.setState({ placeId: inn.id });
  return { db, data, now, town, harbour, inn, grotto, castle, ferry, brann };
}

describe('Überfahrten', () => {
  it('zeigt die nächste Fahrt von hier – auch vom Hafen der Stadt', async () => {
    const { data, now, ferry, grotto } = await setup();
    // Im Gasthaus: Die Stadt umschließt den Hafen, von dort fährt die Fähre.
    const crossings = crossingsHere(data());
    expect(crossings.map((c) => c.run.name)).toEqual(['Aalfähre']);
    const [first] = crossings;
    expect(first!.run.id).toBe(ferry.id);
    expect(first!.elsewhere).toBe(true);
    expect(first!.run.toId).toBe(grotto.id);
    expect(first!.next!.departs).toBe(now + DAY + 60);
    expect(first!.next!.arrives - first!.next!.departs).toBe(180);
  });

  it('aus der Stadt nur ihre Häfen, nie alle der Gegend – aus einem Raum die seines Hauses', async () => {
    const { db, data, town, inn } = await setup();
    // Hohenfurt liegt in der Nordmark; von Brückwacht, auch in der Nordmark, fährt ein Floß.
    const mark = db.put('entities', createEntity({ kind: 'place', name: 'Nordmark' })) as Place;
    db.patch('entities', town.id, { place: { ...town.place, parentId: mark.id } });
    const bridge = db.put(
      'entities',
      createEntity({ kind: 'place', name: 'Brückwacht', place: { parentId: mark.id } }),
    ) as Place;
    saveRun(db, {
      name: 'Floß',
      fromId: bridge.id,
      toId: inn.id,
      start: data().state.now,
      every: { every: 1, unit: 'day' },
      carrier: '',
      operatorId: null,
      stoppedAt: null,
      stopReason: '',
      note: '',
    });
    // Kein Weg geht von Hohenfurt selbst ab – auch dann bleibt es bei der Stadt.
    for (const path of Object.values(data().paths))
      if (path.toId === town.id || path.fromId === town.id) db.remove('paths', path.id);
    db.setState({ placeId: town.id });
    expect(crossingsHere(data()).map((c) => c.run.name)).toEqual(['Aalfähre']);
    const cellar = db.put(
      'entities',
      createEntity({ kind: 'place', name: 'Keller', place: { parentId: inn.id, room: true } }),
    ) as Place;
    db.setState({ placeId: cellar.id });
    expect(crossingsHere(data()).map((c) => c.run.name)).toEqual(['Aalfähre']);
  });

  it('sagt, wann es losgeht', async () => {
    const { data } = await setup();
    const cal = data().campaign.calendar;
    const midnight = Math.floor(data().state.now / DAY) * DAY;
    const at = (hour: number) => midnight + hour * 60;
    expect(departureText(cal, at(8), at(11))).toBe('heute 11:00 (in 3 Std.)');
    expect(departureText(cal, at(8), at(24 + 6))).toBe('morgen 06:00');
    expect(departureText(cal, at(8), at(4 * 24 + 6))).toMatch(/^\d+\. .+, 06:00 \(in 4 Tagen\)$/);
  });

  it('nennt die Preise des Regelwerks je angefangenem Tag', () => {
    expect(tripDays({ departs: 0, arrives: 180 })).toBe(1);
    expect(tripDays({ departs: 0, arrives: DAY + 1 })).toBe(2);
    expect(passagePrices({ departs: 0, arrives: DAY + 1 })).toEqual([
      { label: 'Hängematte', gold: 1 },
      { label: 'Eigene Kabine', gold: 4 },
    ]);
  });

  it('bucht und fährt mit: Handel in der Mitschrift, Ankunft nach Fahrplan', async () => {
    const { db, data, now, ferry, grotto, brann } = await setup();
    const trip = crossingsHere(data())[0]!.next!;
    const result = bookCrossing(db, {
      runId: ferry.id,
      departs: trip.departs,
      arrives: trip.arrives,
      price: 0.5,
      payerId: brann.id,
      ride: true,
    });
    if ('problem' in result) throw new Error(result.problem);
    expect(result.entry!.trade!.total).toBe(0.5);
    expect(result.entry!.trade!.lines[0]!.text).toBe('Überfahrt nach Salzgrotte (Aalfähre)');
    expect(data().state.now).toBe(trip.arrives);
    expect(data().state.placeId).toBe(grotto.id);
    expect(data().chronicle[result.walk!.entry!.id]!.text).toBe('mit Aalfähre · 3 Std.');
    result.undo();
    expect(data().state.now).toBe(now);
    expect(data().chronicle[result.entry!.id]).toBeUndefined();
  });

  it('bucht auch nur, ohne mitzufahren – und meldet eine verpasste Fahrt', async () => {
    const { db, data, now, ferry } = await setup();
    const result = bookCrossing(db, {
      runId: ferry.id,
      departs: now - 10,
      arrives: now + 170,
      price: null,
      payerId: null,
      ride: true,
    });
    expect(result).toEqual({ problem: 'Diese Fahrt ist schon abgefahren.' });
    const only = bookCrossing(db, {
      runId: ferry.id,
      departs: now + 60,
      arrives: now + 240,
      price: 2,
      payerId: null,
      ride: false,
    });
    if ('problem' in only) throw new Error(only.problem);
    expect(only.walk).toBeNull();
    expect(data().state.now).toBe(now);
  });
});
