import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { rollTables } from '../../domain/journey';
import {
  frequencyOf,
  isNightAt,
  lairOf,
  meetingLine,
  meetingOf,
  pickRow,
  roamingOf,
  rollAppearing,
} from '../../domain/roaming';
import { createCreature, createEntity, createStock, type Place } from '../../domain/schema';
import { MINUTES_PER_DAY } from '../../domain/time/calendar';
import { regionRows, regionTable, saveRegionRows } from './actions';

/** Ein Würfel, der der Reihe nach die gegebenen Zahlen zeigt (danach 1). */
const dice = (...values: number[]) => {
  const queue = [...values];
  return () => queue.shift() ?? 1;
};

/** Eine erfundene Gegend mit einem Wesen im Bestiarium und seinem Bau. */
async function world() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const wood = db.put('entities', createEntity({ kind: 'place', name: 'Morchelwald' })) as Place;
  const slope = db.put(
    'entities',
    createEntity({ kind: 'place', name: 'Moderhang', place: { parentId: wood.id } }),
  ) as Place;
  const template = db.put(
    'creatures',
    createCreature({
      name: 'Sporenläufer',
      roaming: { appearing: '2–5', signs: 'Zertretene Pilzhüte', active: 'night' },
    }),
  );
  const variant = db.put(
    'creatures',
    createCreature({
      name: 'Alter Sporenläufer',
      kind: 'variant',
      parentId: template.id,
      roaming: { appearing: '1', signs: '', active: null },
    }),
  );
  db.put(
    'stocks',
    createStock({
      name: 'Brutkammer',
      placeId: slope.id,
      groups: [{ id: 'g', creatureId: template.id, count: 9, lost: 2 }],
    }),
  );
  return { db, data: () => db.getSnapshot(), wood, slope, template, variant };
}

describe('Begegnungen: Was, Häufigkeit, Wann', () => {
  it('nennt Häufigkeiten in Worten', () => {
    expect(frequencyOf(4)).toBe('often');
    expect(frequencyOf(2)).toBe('sometimes');
    expect(frequencyOf(3)).toBe('sometimes');
    expect(frequencyOf(1)).toBe('rare');
  });

  it('kennt Nacht und Tag', () => {
    const day = 10 * MINUTES_PER_DAY;
    expect(isNightAt(day + 3 * 60)).toBe(true);
    expect(isNightAt(day + 12 * 60)).toBe(false);
    expect(isNightAt(day + 21 * 60)).toBe(true);
  });

  it('erbt Unterwegs von der Vorlage, eigene Angaben gehen vor', async () => {
    const { data, variant } = await world();
    expect(roamingOf(data(), variant.id)).toEqual({
      appearing: '1',
      signs: 'Zertretene Pilzhüte',
      active: 'night',
    });
  });

  it('würfelt die Anzahl aus „2–5“', () => {
    expect(rollAppearing('2–5', () => 1)).toBe(2);
    expect(rollAppearing('2-5', () => 4)).toBe(5);
    expect(rollAppearing('3', () => 1)).toBe(3);
    expect(rollAppearing('viele', () => 1)).toBeNull();
  });

  it('schreibt die Tabelle Zeile für Zeile und hängt Wesen mit genauem Namen an', async () => {
    const { db, data, wood, template } = await world();
    saveRegionRows(
      db,
      wood.id,
      'encounter',
      [
        { text: 'sporenläufer', creatureId: null, weight: 4, when: null },
        { text: 'Pilzsammler', creatureId: null, weight: 2, when: 'day' },
        { text: '  ', creatureId: null, weight: 1, when: null },
      ],
      null,
    );
    const rows = regionRows(regionTable(data(), wood.id, 'encounter'));
    expect(rows).toEqual([
      { text: 'sporenläufer', creatureId: template.id, weight: 4, when: null },
      { text: 'Pilzsammler', creatureId: null, weight: 2, when: 'day' },
    ]);
  });

  it('wählt nach Häufigkeit und nachts nur, was nachts unterwegs ist', async () => {
    const { db, data, wood } = await world();
    saveRegionRows(
      db,
      wood.id,
      'encounter',
      [
        // Laut Bestiarium nur nachts unterwegs.
        { text: 'Sporenläufer', creatureId: null, weight: 4, when: null },
        { text: 'Pilzsammler', creatureId: null, weight: 2, when: 'day' },
        { text: 'Hirsche', creatureId: null, weight: 1, when: null },
      ],
      null,
    );
    const table = regionTable(data(), wood.id, 'encounter')!;
    // Tags: Pilzsammler (2) und Hirsche (1).
    expect(pickRow(data(), table, () => 2, false)).toMatchObject({
      row: { text: 'Pilzsammler' },
      from: 2,
    });
    expect(pickRow(data(), table, () => 3, false)!.row.text).toBe('Hirsche');
    // Nachts: Sporenläufer (4) und Hirsche (1).
    expect(pickRow(data(), table, () => 4, true)!.row.text).toBe('Sporenläufer');
    expect(pickRow(data(), table, () => 5, true)!.row.text).toBe('Hirsche');
    // Unter der Erde zählt die Tageszeit nicht: alle drei.
    expect(pickRow(data(), table, () => 7, null)).toMatchObject({
      row: { text: 'Hirsche' },
      from: 3,
    });
  });

  it('holt Anzahl, Spuren und Bau aus dem Bestiarium', async () => {
    const { db, data, wood, template } = await world();
    expect(lairOf(data(), template.id, wood.id)).toMatchObject({ left: 7 });
    saveRegionRows(
      db,
      wood.id,
      'encounter',
      [{ text: 'Sporenläufer', creatureId: null, weight: 4, when: null }],
      null,
    );
    const row = regionTable(data(), wood.id, 'encounter')!.entries[0]!;
    const meeting = meetingOf(data(), row, wood.id, () => 3);
    expect(meeting).toMatchObject({ what: 'Sporenläufer', count: 4, signs: 'Zertretene Pilzhüte' });
    expect(meetingLine(meeting)).toBe(
      'Sporenläufer (4) · vorher: Zertretene Pilzhüte · aus: Brutkammer (noch 7)',
    );
  });

  it('würfelt unterwegs nachts im Lager und schreibt den ganzen Satz', async () => {
    const { db, data, wood } = await world();
    saveRegionRows(
      db,
      wood.id,
      'encounter',
      [{ text: 'Sporenläufer', creatureId: null, weight: 4, when: null }],
      null,
    );
    expect(rollTables(data(), wood.id, 'encounter', dice(1, 2), 'night')!.text).toBe(
      'Sporenläufer (3) · vorher: Zertretene Pilzhüte · aus: Brutkammer (noch 7)',
    );
    const noon = Math.floor(data().state.now / MINUTES_PER_DAY) * MINUTES_PER_DAY + 12 * 60;
    expect(rollTables(data(), wood.id, 'encounter', dice(1, 2), noon)).toBeNull();
  });
});
