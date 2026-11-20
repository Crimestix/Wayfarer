import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { hexKey, type HexCoord } from '../../domain/hex';
import { SOLID_ROCK, hexKind, kindsByGroup } from '../../domain/hexKinds';
import {
  connectLine,
  eraseLine,
  hexIndex,
  lineEntityId,
  lineRun,
  linkSides,
  markLine,
  namedLines,
  setLineEntity,
} from '../../domain/hexLines';
import { HexSchema, type Hex } from '../../domain/schema';
import { addHex, fillRim, mapExtent, rimSlots } from './actions';
import { blankArea } from './freeMap';
import { brushPaint } from './HexEditor';

/** Eine Reihe von Feldern nebeneinander (r = 0) und eine darunter (r = 1). */
const grid = (): Hex[] =>
  [0, 1].flatMap((r) => [0, 1, 2, 3].map((q) => HexSchema.parse({ q, r, terrain: 'grassland' })));
const at = (q: number, r: number): HexCoord => ({ q, r, level: 0 });
const road = { kind: 'road', road: 'road' } as const;
const river = { kind: 'river', name: 'Graulauf' } as const;
const sidesAt = (hexes: Hex[], q: number, r: number, kind: 'road' | 'river') =>
  linkSides(
    hexes.find((hex) => hex.q === q && hex.r === r)!,
    kind,
    hexIndex(hexes),
  );

describe('Wege und Flüsse als Linien', () => {
  it('verbindet nur, was gezogen wurde – nicht jedes Nachbarfeld', () => {
    let hexes = grid();
    hexes = markLine(hexes, at(0, 0), road);
    hexes = connectLine(hexes, at(0, 0), at(1, 0), road);
    hexes = connectLine(hexes, at(1, 0), at(1, 1), road);
    // (0,0) und (1,1) liegen nicht nebeneinander; (0,1) liegt neben beiden Enden, trägt aber nichts.
    expect(sidesAt(hexes, 0, 0, 'road')).toEqual([1]);
    expect(sidesAt(hexes, 1, 0, 'road')).toEqual([2, 4]);
    expect(sidesAt(hexes, 1, 1, 'road')).toEqual([5]);
    // Ein eigener Weg daneben bleibt für sich, obwohl seine Felder an den ersten grenzen.
    hexes = markLine(hexes, at(0, 1), road);
    expect(sidesAt(hexes, 0, 1, 'road')).toEqual([]);
    expect(sidesAt(hexes, 1, 1, 'road')).toEqual([5]);
    expect(lineRun(hexes, at(0, 0), 'road').map(hexKey).sort()).toEqual(
      [at(0, 0), at(1, 0), at(1, 1)].map(hexKey).sort(),
    );
    expect(lineRun(hexes, at(0, 1), 'road')).toHaveLength(1);
  });

  it('liest ältere Karten wie früher: jeder Nachbar mit derselben Linie', () => {
    const hexes = grid().map((hex) => (hex.r === 0 ? { ...hex, river: 'Fluss' } : hex));
    expect(sidesAt(hexes, 1, 0, 'river')).toEqual([1, 4]);
    // Wird dort weitergezogen, bleiben die alten Verbindungen bestehen.
    const drawn = connectLine(hexes, at(1, 0), at(1, 1), river);
    expect(sidesAt(drawn, 1, 0, 'river')).toEqual([1, 2, 4]);
    // Der Fluss behält seinen Namen; neue Felder bekommen den des Strichs.
    expect(drawn.find((hex) => hex.q === 1 && hex.r === 0)!.river).toBe('Fluss');
    expect(drawn.find((hex) => hex.q === 1 && hex.r === 1)!.river).toBe('Graulauf');
  });

  it('radiert ein Feld aus der Linie und löst die Nachbarn davon', () => {
    let hexes = grid();
    hexes = markLine(hexes, at(0, 0), road);
    for (const [a, b] of [
      [at(0, 0), at(1, 0)],
      [at(1, 0), at(2, 0)],
      [at(2, 0), at(3, 0)],
    ] as const)
      hexes = connectLine(hexes, a, b, road);
    hexes = eraseLine(hexes, [at(1, 0)], 'road');
    expect(hexes.find((hex) => hex.q === 1 && hex.r === 0)!.road).toBe('none');
    expect(sidesAt(hexes, 0, 0, 'road')).toEqual([]);
    expect(lineRun(hexes, at(2, 0), 'road')).toHaveLength(2);
  });

  it('gibt einer Linie ihren Eintrag – wer anschließt, gehört dazu', () => {
    let hexes = grid();
    hexes = markLine(hexes, at(0, 0), river);
    hexes = connectLine(hexes, at(0, 0), at(1, 0), river);
    const run = lineRun(hexes, at(0, 0), 'river');
    hexes = setLineEntity(hexes, run, 'river', 'fluss-1', 'Silberlauf');
    expect(hexes.find((hex) => hex.q === 1 && hex.r === 0)).toMatchObject({
      riverId: 'fluss-1',
      river: 'Silberlauf',
    });
    hexes = connectLine(hexes, at(1, 0), at(2, 0), river);
    const whole = lineRun(hexes, at(2, 0), 'river');
    expect(whole).toHaveLength(3);
    expect(lineEntityId(whole, 'river')).toBe('fluss-1');
    expect(hexes.find((hex) => hex.q === 2 && hex.r === 0)!.riverId).toBe('fluss-1');
    // Für die Beschriftung: eine Linie, ihr Name steht am mittleren Feld.
    const [named] = namedLines(hexes);
    expect(named).toMatchObject({ kind: 'river', entityId: 'fluss-1' });
    expect([named!.at.q, named!.at.r]).toEqual([1, 0]);
  });
});

describe('Die Karte wächst am Rand', () => {
  it('zeigt den leeren Rand so weit wie gewünscht und füllt ihn auf einen Klick', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const area = db.put(
      'areas',
      blankArea({ name: 'Wiese', cols: 3, rows: 3, terrain: 'grassland', hexKm: 10 }),
    );
    const data = () => db.getSnapshot();
    expect(mapExtent(area)).toMatchObject({ cells: 9, height: 3 });
    const one = rimSlots(area, 1);
    const two = rimSlots(area, 2);
    expect(one).toHaveLength(14);
    expect(two.length).toBeGreaterThan(one.length);
    // Ein Feld weiter draußen lässt sich gleich mit dem Gelände des Pinsels anfügen.
    const far = two.find((slot) => !one.some((near) => hexKey(near) === hexKey(slot)))!;
    expect(addHex(db, area.id, far, brushPaint(data(), 'bog'))).toBe(true);
    expect(data().areas[area.id]!.hexes.at(-1)).toMatchObject({
      terrain: 'swamp',
      kind: 'bog',
      manual: true,
    });
    expect(addHex(db, area.id, far)).toBe(false);
    // Ohne Pinsel bekommt ein Feld das Gelände seiner Nachbarn.
    const near = rimSlots(data().areas[area.id]!, 1)[0]!;
    addHex(db, area.id, near);
    expect(data().areas[area.id]!.hexes.at(-1)!.terrain).toBeTruthy();
    const before = data().areas[area.id]!.hexes.length;
    const added = fillRim(db, area.id, 1, brushPaint(data(), 'forest'));
    expect(added).toBeGreaterThan(0);
    expect(data().areas[area.id]!.hexes).toHaveLength(before + added);
    expect(data().areas[area.id]!.hexes.at(-1)!.terrain).toBe('forest');
  });

  it('beginnt unter der Erde als Fels – auch am Rand', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const area = db.put(
      'areas',
      blankArea({ name: 'Tiefe', cols: 3, rows: 2, terrain: 'underdark', hexKm: 10 }),
    );
    expect(area.hexes.every((hex) => hex.kind === SOLID_ROCK)).toBe(true);
    addHex(db, area.id, rimSlots(area, 1)[0]!);
    expect(db.getSnapshot().areas[area.id]!.hexes.at(-1)).toMatchObject({
      terrain: 'underdark',
      kind: SOLID_ROCK,
    });
  });
});

describe('Gelände unter der Erde', () => {
  it('kennt Fels, offenen Boden und was dort wächst – unter der Erde zuerst', () => {
    for (const key of ['solid-rock', 'cave-floor', 'cavern', 'fungus', 'stalagmites', 'chasm'])
      expect(hexKind(key)).toMatchObject({ base: 'underdark', group: 'underdark' });
    expect(hexKind('underdark')!.label).toBe('Ganggeflecht');
    expect(kindsByGroup('', 'underdark')[0]!.group).toBe('underdark');
    expect(kindsByGroup()[0]!.group).toBe('lowland');
    // Die Suche findet eine Art in jeder Gruppe.
    expect(kindsByGroup('massiv').flatMap((entry) => entry.kinds.map((kind) => kind.key))).toEqual([
      'solid-rock',
    ]);
  });
});
