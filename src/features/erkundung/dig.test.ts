import { describe, expect, it } from 'vitest';
import { hexKey, type HexCoord } from '../../domain/hex';
import { SOLID_ROCK, paintOfKind } from '../../domain/hexKinds';
import { dirTo } from '../../domain/passages';
import { HexSchema, type Hex } from '../../domain/schema';
import { digCave, isWideCave } from './dig';

/** Ein Block Fels: q von 0 bis 5, r von 0 bis 3. */
const rock = (): Hex[] => {
  const out: Hex[] = [];
  for (let r = 0; r < 4; r++)
    for (let q = 0; q < 6; q++)
      out.push(HexSchema.parse({ q, r, terrain: 'underdark', kind: SOLID_ROCK, exits: [] }));
  return out;
};
const at = (q: number, r: number): HexCoord => ({ q, r, level: 0 });
const find = (hexes: Hex[], q: number, r: number) =>
  hexes.find((hex) => hexKey(hex) === hexKey(at(q, r)))!;
const joined = (hexes: Hex[], a: HexCoord, b: HexCoord) => {
  const there = find(hexes, a.q, a.r).exits?.some((exit) => exit.dir === dirTo(a, b)) ?? false;
  const back = find(hexes, b.q, b.r).exits?.some((exit) => exit.dir === dirTo(b, a)) ?? false;
  expect(there).toBe(back);
  return there;
};

/** Ein Strich mit dem Pinsel über die genannten Felder. */
const stroke = (hexes: Hex[], kind: string, cells: HexCoord[]): Hex[] => {
  let from: HexCoord | null = null;
  for (const cell of cells) {
    hexes = digCave(hexes, { at: cell, coords: [cell], kind, paint: paintOfKind(kind)!, from });
    from = cell;
  }
  return hexes;
};

describe('Graben unter der Erde', () => {
  it('zieht einen Gang entlang des Strichs – verbunden ist nur, worüber die Maus fuhr', () => {
    const hexes = stroke(rock(), 'underdark', [at(0, 1), at(1, 1), at(2, 1)]);
    expect(joined(hexes, at(0, 1), at(1, 1))).toBe(true);
    expect(joined(hexes, at(1, 1), at(2, 1))).toBe(true);
    expect(find(hexes, 0, 1).exits).toHaveLength(1);
    expect(find(hexes, 1, 1).exits).toHaveLength(2);
    expect(find(hexes, 1, 1).kind).toBeNull();
    // Der Fels daneben bleibt Fels.
    expect(find(hexes, 1, 0).exits).toEqual([]);
    expect(find(hexes, 1, 0).kind).toBe(SOLID_ROCK);
  });

  it('gräbt auch durch Felder, die eine schnelle Maus überspringt', () => {
    const hexes = stroke(rock(), 'underdark', [at(0, 1), at(3, 1)]);
    for (const q of [0, 1, 2]) expect(joined(hexes, at(q, 1), at(q + 1, 1))).toBe(true);
    expect(find(hexes, 1, 1).kind).toBeNull();
    expect(find(hexes, 2, 1).dug).toBe(true);
  });

  it('legt zwei Gänge nebeneinander, ohne sie zu verbinden', () => {
    let hexes = stroke(rock(), 'underdark', [at(0, 0), at(1, 0), at(2, 0), at(3, 0)]);
    hexes = stroke(hexes, 'underdark', [at(5, 2), at(4, 2), at(3, 2), at(2, 2)]);
    hexes = stroke(hexes, 'underdark', [at(0, 1), at(1, 1), at(2, 1)]);
    // Der mittlere Gang beginnt neben dem ersten und schließt dort an – aber nur an einer Stelle.
    expect(find(hexes, 1, 1).exits).toHaveLength(2);
    expect(joined(hexes, at(2, 1), at(2, 2))).toBe(false);
    expect(joined(hexes, at(1, 1), at(1, 0))).toBe(false);
  });

  it('schließt einen Gang, der im Fels beginnt, an Offenes nebenan an – lieber an ein Gangende', () => {
    let hexes = stroke(rock(), 'underdark', [at(0, 1), at(1, 1), at(2, 1)]);
    // (3,1) grenzt an das Ende (2,1) und sonst nur an Fels.
    hexes = stroke(hexes, 'underdark', [at(3, 1)]);
    expect(joined(hexes, at(3, 1), at(2, 1))).toBe(true);
    expect(find(hexes, 3, 1).exits).toHaveLength(1);
    // Mitten im Fels entsteht ein Feld ohne Ausgang: Es wartet auf den nächsten Strich.
    hexes = stroke(hexes, 'underdark', [at(5, 3)]);
    expect(find(hexes, 5, 3).exits).toEqual([]);
    expect(find(hexes, 5, 3).kind).toBeNull();
  });

  it('lässt Höhlen mit jeder Höhle nebenan zusammenwachsen', () => {
    let hexes = stroke(rock(), 'cavern', [at(2, 1)]);
    expect(find(hexes, 2, 1).exits).toEqual([]);
    expect(isWideCave(find(hexes, 2, 1))).toBe(true);
    hexes = stroke(hexes, 'fungus', [at(3, 1)]);
    hexes = stroke(hexes, 'cavern', [at(2, 2)]);
    expect(joined(hexes, at(2, 1), at(3, 1))).toBe(true);
    expect(joined(hexes, at(2, 1), at(2, 2))).toBe(true);
    // (3,1) und (2,2) sind Nachbarn: auch sie hängen zusammen.
    expect(joined(hexes, at(3, 1), at(2, 2))).toBe(true);
    expect(find(hexes, 3, 1).kind).toBe('fungus');
  });

  it('lässt eine Höhle Höhle, wenn ein Gang in ihr beginnt oder durch sie führt', () => {
    let hexes = stroke(rock(), 'crystal', [at(2, 1)]);
    hexes = stroke(hexes, 'underdark', [at(0, 1), at(1, 1), at(2, 1), at(3, 1)]);
    expect(find(hexes, 2, 1).kind).toBe('crystal');
    expect(joined(hexes, at(1, 1), at(2, 1))).toBe(true);
    expect(joined(hexes, at(2, 1), at(3, 1))).toBe(true);
    hexes = stroke(hexes, 'underdark', [at(2, 1), at(2, 2)]);
    expect(find(hexes, 2, 1).kind).toBe('crystal');
    expect(joined(hexes, at(2, 1), at(2, 2))).toBe(true);
  });

  it('ändert einen vorhandenen Durchgang nicht, wenn der Strich noch einmal darüber geht', () => {
    let hexes = stroke(rock(), 'underdark', [at(0, 1), at(1, 1)]);
    hexes = hexes.map((hex) =>
      hexKey(hex) === hexKey(at(0, 1))
        ? { ...hex, exits: hex.exits!.map((exit) => ({ ...exit, kind: 'climb' as const })) }
        : hex,
    );
    hexes = stroke(hexes, 'underdark', [at(0, 1), at(1, 1)]);
    expect(find(hexes, 0, 1).exits![0]!.kind).toBe('climb');
  });

  it('schüttet mit Massivfels zu: kein Ausgang mehr, auch nicht von den Nachbarn', () => {
    let hexes = stroke(rock(), 'underdark', [at(0, 1), at(1, 1), at(2, 1)]);
    hexes = stroke(hexes, SOLID_ROCK, [at(1, 1)]);
    expect(find(hexes, 1, 1).exits).toEqual([]);
    expect(find(hexes, 1, 1).kind).toBe(SOLID_ROCK);
    expect(find(hexes, 0, 1).exits).toEqual([]);
    expect(find(hexes, 2, 1).exits).toEqual([]);
  });

  it('mauert nie das Feld eines Ortes zu', () => {
    let hexes = stroke(rock(), 'underdark', [at(0, 1), at(1, 1)]);
    hexes = hexes.map((hex) =>
      hexKey(hex) === hexKey(at(1, 1)) ? { ...hex, placeId: 'ort' } : hex,
    );
    const after = stroke(hexes, SOLID_ROCK, [at(1, 1)]);
    expect(find(after, 1, 1).exits).toHaveLength(1);
    expect(find(after, 1, 1).placeId).toBe('ort');
  });

  it('merkt nur an Feldern, die sich geändert haben, dass sie von Hand gegraben sind', () => {
    const before = rock();
    const hexes = stroke(before, 'underdark', [at(0, 1), at(1, 1)]);
    expect(find(hexes, 0, 1).manual).toBe(true);
    expect(find(hexes, 0, 1).dug).toBe(true);
    expect(find(hexes, 4, 3)).toBe(find(before, 4, 3));
    expect(find(hexes, 4, 3).dug).toBe(false);
  });
});
