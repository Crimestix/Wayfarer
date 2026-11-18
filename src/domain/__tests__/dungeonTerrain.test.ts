import { describe, expect, it } from 'vitest';
import { addRoom, canPass, edgeBetween, edgeKeyBetween, rectCells, setEdge } from '../dungeon';
import {
  climbBetween,
  copyRegion,
  fallWords,
  generateCave,
  isSlow,
  mirrorStamp,
  pasteStamp,
  rotateStamp,
  setCorner,
  setHeights,
  setRough,
} from '../dungeonTerrain';
import { DungeonLevelSchema, type DungeonLevel } from '../schema';

const blank = (): DungeonLevel => DungeonLevelSchema.parse({ id: 'eins', name: 'eins' });
const hall = () => addRoom(blank(), rectCells({ x: 0, y: 0 }, { x: 3, y: 2 }), 'Halle').level;

describe('Gelände', () => {
  it('schwieriges Gelände kommt von der Art oder vom Häkchen', () => {
    const level = setRough(
      hall(),
      [
        { x: 1, y: 1 },
        { x: 9, y: 9 },
      ],
      true,
    );
    expect(isSlow(level, { x: 1, y: 1 })).toBe(true);
    expect(isSlow(level, { x: 0, y: 0 })).toBe(false);
    expect(level.rough).toEqual(['1,1']);
    expect(isSlow({ ...level, tiles: { ...level.tiles, '0,0': 'mud' } }, { x: 0, y: 0 })).toBe(
      true,
    );
  });

  it('eine Stufe geht man, hinauf klettert man, zehn Fuß hinab sind ein Sturz', () => {
    const level = setHeights(setHeights(hall(), [{ x: 1, y: 0 }], 5), [{ x: 2, y: 0 }], 20);
    expect(climbBetween(level, { x: 0, y: 0 }, { x: 1, y: 0 }).kind).toBe('level');
    expect(climbBetween(level, { x: 1, y: 0 }, { x: 2, y: 0 })).toEqual({
      diff: 15,
      extra: 15,
      kind: 'climb',
    });
    expect(climbBetween(level, { x: 2, y: 0 }, { x: 1, y: 0 }).kind).toBe('drop');
    expect(fallWords(25)).toBe('2W6 Wucht');
  });

  it('eine schräge Wand sperrt die beiden Seiten ihrer Ecke', () => {
    const level = setCorner(hall(), { x: 1, y: 1 }, 'nw');
    expect(edgeBetween(level, { x: 1, y: 1 }, { x: 1, y: 0 }).kind).toBe('rock');
    expect(canPass(level, { x: 0, y: 1 }, { x: 1, y: 1 })).toBe(false);
    expect(canPass(level, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(true);
    // Dieselbe Ecke noch einmal nimmt sie weg.
    expect(setCorner(level, { x: 1, y: 1 }, 'nw').corners).toEqual({});
  });

  it('eine Einbahntür geht nur in ihre Richtung', () => {
    const key = edgeKeyBetween({ x: 1, y: 0 }, { x: 2, y: 0 })!;
    const level = setEdge(hall(), key, { kind: 'door', oneWay: 'ab' });
    expect(canPass(level, { x: 1, y: 0 }, { x: 2, y: 0 })).toBe(true);
    expect(canPass(level, { x: 2, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });
});

describe('Höhlen', () => {
  it('gleicher Ausgangswert, gleiche Höhle – zusammenhängend und im Rechteck', () => {
    const rect = { x: 3, y: 4, w: 16, h: 12 };
    const cave = generateCave(rect, 'probe');
    expect(generateCave(rect, 'probe')).toEqual(cave);
    expect(generateCave(rect, 'andere')).not.toEqual(cave);
    expect(cave.length).toBeGreaterThan(20);
    expect(cave.every((c) => c.x >= 3 && c.x < 19 && c.y >= 4 && c.y < 16)).toBe(true);
    // Zusammenhängend: Von einem Feld aus sind alle zu erreichen.
    const keys = new Set(cave.map((c) => `${c.x},${c.y}`));
    const seen = new Set([`${cave[0]!.x},${cave[0]!.y}`]);
    const queue = [cave[0]!];
    while (queue.length) {
      const c = queue.pop()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const key = `${c.x + dx},${c.y + dy}`;
        if (keys.has(key) && !seen.has(key)) {
          seen.add(key);
          queue.push({ x: c.x + dx, y: c.y + dy });
        }
      }
    }
    expect(seen.size).toBe(cave.length);
  });
});

describe('Ausschnitte', () => {
  it('kopiert einen Raum mit seiner Tür, und die Kopie ist ein eigener Raum', () => {
    const key = edgeKeyBetween({ x: 1, y: 0 }, { x: 2, y: 0 })!;
    const level = setEdge(hall(), key, { kind: 'door' });
    const stamp = copyRegion(level, { x: 0, y: 0, w: 4, h: 3 });
    const pasted = pasteStamp(level, stamp, { x: 10, y: 5 });
    expect(pasted.tiles['13,7']).toBe('floor');
    expect(pasted.edges[edgeKeyBetween({ x: 11, y: 5 }, { x: 12, y: 5 })!]?.kind).toBe('door');
    expect(pasted.rooms).toHaveLength(2);
    expect(new Set(pasted.rooms.map((r) => r.id)).size).toBe(2);
  });

  it('dreht und spiegelt – viermal gedreht ist wieder dasselbe', () => {
    const key = edgeKeyBetween({ x: 1, y: 0 }, { x: 2, y: 0 })!;
    const level = setCorner(setEdge(hall(), key, { kind: 'door' }), { x: 0, y: 0 }, 'nw');
    const stamp = copyRegion(level, { x: 0, y: 0, w: 4, h: 3 });
    const turned = rotateStamp(stamp);
    expect([turned.w, turned.h]).toEqual([3, 4]);
    // Die Ecke oben links liegt nach der Drehung oben rechts.
    expect(turned.corners['2,0']).toBe('ne');
    // Die Tür zwischen (1,0) und (2,0) liegt jetzt zwischen (2,1) und (2,2).
    expect(turned.edges['2,2,n']?.kind).toBe('door');
    const full = rotateStamp(rotateStamp(rotateStamp(turned)));
    expect(full.tiles).toEqual(stamp.tiles);
    expect(full.edges).toEqual(stamp.edges);
    expect(full.corners).toEqual(stamp.corners);
    expect(mirrorStamp(mirrorStamp(stamp)).edges).toEqual(stamp.edges);
    expect(mirrorStamp(stamp).corners['3,0']).toBe('ne');
  });
});
