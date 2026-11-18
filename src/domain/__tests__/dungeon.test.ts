import { describe, expect, it } from 'vitest';
import {
  addLevel,
  addRoom,
  addStair,
  addTrap,
  assignRoom,
  canPass,
  digPath,
  dungeonNotes,
  edgeBetween,
  edgeKey,
  edgeKeyBetween,
  edgeName,
  edgeRun,
  patchEdgeRun,
  removeEdgeRun,
  edgeSegments,
  extendRoom,
  findStair,
  healStairs,
  levelsSorted,
  lineCells,
  linkStairs,
  moveRoom,
  patchRoomEverywhere,
  roomCells,
  roomSpan,
  roundBetween,
  roundCells,
  roundOf,
  moveLevel,
  paintTiles,
  rectCells,
  removeLevel,
  removeStair,
  roomHasAccess,
  roomSize,
  setEdge,
  trapSpots,
  withLevel,
} from '../dungeon';
import { DungeonLevelSchema, type DungeonLevel } from '../schema';

const blank = (id = 'eins', order = 0): DungeonLevel =>
  DungeonLevelSchema.parse({ id, name: id, order });

/** Ein Raum von 3 × 2 Feldern bei (0,0). */
const withRoom = () => addRoom(blank(), rectCells({ x: 0, y: 0 }, { x: 2, y: 1 }), 'Halle');

describe('Kanten', () => {
  it('jede Kante hat genau einen Schlüssel, von beiden Seiten gleich', () => {
    expect(edgeKey({ x: 2, y: 3 }, 's')).toBe(edgeKey({ x: 2, y: 4 }, 'n'));
    expect(edgeKey({ x: 2, y: 3 }, 'e')).toBe(edgeKey({ x: 3, y: 3 }, 'w'));
    expect(edgeKeyBetween({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe('1,0,w');
    expect(edgeKeyBetween({ x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
  });

  it('Räume haben von selbst Wände – zum Gang und zum Nachbarraum', () => {
    const { level } = withRoom();
    const gang = paintTiles(level, [{ x: 3, y: 0 }], 'floor');
    expect(edgeBetween(gang, { x: 2, y: 0 }, { x: 3, y: 0 })).toMatchObject({
      kind: 'wall',
      implied: true,
    });
    // Im Raum und im Gang ist es offen, am Fels steht Fels.
    expect(edgeBetween(gang, { x: 0, y: 0 }, { x: 1, y: 0 }).kind).toBe('open');
    expect(edgeBetween(gang, { x: 0, y: 0 }, { x: 0, y: -1 }).kind).toBe('rock');
    expect(canPass(gang, { x: 2, y: 0 }, { x: 3, y: 0 })).toBe(false);
  });

  it('eine Tür verbindet, eine Geheimtür nur für den, der sie kennt', () => {
    const { level } = withRoom();
    const gang = paintTiles(level, [{ x: 3, y: 0 }], 'floor');
    const key = edgeKeyBetween({ x: 2, y: 0 }, { x: 3, y: 0 })!;
    const door = setEdge(gang, key, { kind: 'door' });
    expect(canPass(door, { x: 2, y: 0 }, { x: 3, y: 0 })).toBe(true);
    const secret = setEdge(gang, key, { kind: 'secret' });
    expect(canPass(secret, { x: 2, y: 0 }, { x: 3, y: 0 })).toBe(false);
    expect(canPass(secret, { x: 2, y: 0 }, { x: 3, y: 0 }, { secrets: true })).toBe(true);
  });

  it('um einen Geheimgang steht von selbst eine Wand', () => {
    const level = paintTiles(
      paintTiles(blank(), [{ x: 0, y: 0 }], 'floor'),
      [{ x: 1, y: 0 }],
      'secret',
    );
    expect(edgeBetween(level, { x: 0, y: 0 }, { x: 1, y: 0 }).kind).toBe('wall');
  });

  it('gezeichnet wird jede Kante einmal', () => {
    const { level } = withRoom();
    const keys = edgeSegments(level).map((segment) => segment.key);
    expect(new Set(keys).size).toBe(keys.length);
    // 3 × 2 Felder: zehn Kanten am Fels, innen ist alles offen.
    expect(keys).toHaveLength(10);
  });
});

describe('Malen', () => {
  it('ein Strich hängt zusammen – nie diagonal', () => {
    const path = lineCells({ x: 0, y: 0 }, { x: 4, y: 3 });
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 4, y: 3 });
    for (let i = 1; i < path.length; i++) {
      const step = Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y);
      expect(step).toBe(1);
    }
  });

  it('ein Gang, der in einen Raum führt, bekommt dort einen Durchgang', () => {
    const { level } = withRoom();
    const dug = digPath(level, lineCells({ x: 5, y: 0 }, { x: 2, y: 0 }), 'floor');
    expect(edgeBetween(dug, { x: 3, y: 0 }, { x: 2, y: 0 })).toMatchObject({
      kind: 'open',
      implied: false,
    });
    expect(canPass(dug, { x: 3, y: 0 }, { x: 2, y: 0 })).toBe(true);
  });

  it('ein Geheimgang endet an einer Geheimtür', () => {
    const { level } = withRoom();
    const dug = digPath(level, lineCells({ x: 2, y: 0 }, { x: 5, y: 0 }), 'secret');
    // Das Feld im Raum wurde selbst Geheimgang; die Geheimtür sitzt zum nächsten Raumfeld.
    expect(dug.tiles['3,0']).toBe('secret');
    const start = digPath(level, lineCells({ x: 3, y: 0 }, { x: 5, y: 0 }), 'secret');
    const through = digPath(
      start,
      [
        { x: 3, y: 0 },
        { x: 2, y: 0 },
      ],
      'floor',
    );
    expect(edgeBetween(through, { x: 3, y: 0 }, { x: 2, y: 0 }).kind).toBe('open');
  });

  it('Fels nimmt mit, was darauf lag, und leere Räume verschwinden', () => {
    const { level, room } = withRoom();
    const trapped = addTrap(level, { x: 1, y: 0 }).level;
    const stairs = addStair(trapped, { x: 0, y: 0 }).level;
    const rock = paintTiles(stairs, rectCells({ x: 0, y: 0 }, { x: 2, y: 1 }), null);
    expect(rock.traps).toHaveLength(0);
    expect(rock.stairs).toHaveLength(0);
    expect(rock.rooms.some((r) => r.id === room.id)).toBe(false);
    expect(Object.keys(rock.roomOf)).toHaveLength(0);
  });

  it('Boden lässt sich einem Raum zuschlagen und wieder herausnehmen', () => {
    const { level, room } = withRoom();
    const more = paintTiles(level, [{ x: 3, y: 0 }], 'floor');
    const joined = assignRoom(
      more,
      [
        { x: 3, y: 0 },
        { x: 9, y: 9 },
      ],
      room.id,
    );
    expect(joined.roomOf['3,0']).toBe(room.id);
    expect(joined.roomOf['9,9']).toBeUndefined();
    expect(edgeBetween(joined, { x: 2, y: 0 }, { x: 3, y: 0 }).kind).toBe('open');
    expect(assignRoom(joined, [{ x: 3, y: 0 }], null).roomOf['3,0']).toBeUndefined();
  });

  it('nennt die Größe eines rechteckigen Raums in Fuß', () => {
    expect(roomSize(rectCells({ x: 0, y: 0 }, { x: 2, y: 1 }), 5)).toBe('15 × 10 Fuß');
    expect(
      roomSize(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        5,
      ),
    ).toBeNull();
  });
});

describe('Fallen', () => {
  it('ohne gewählte Felder ist eine Falle vom Boden ringsum zu bemerken', () => {
    const { level } = withRoom();
    const { level: trapped, trap } = addTrap(level, { x: 1, y: 0 });
    // Alle sechs Felder des Raums liegen in zwei Feldern Abstand; Fels zählt nicht.
    expect(trapSpots(trapped, trap)).toHaveLength(6);
    expect(trapSpots(trapped, { ...trap, spots: [{ x: 0, y: 1 }] })).toEqual([{ x: 0, y: 1 }]);
  });
});

describe('Ebenen und Etagenwechsel', () => {
  const two = () => {
    const first = addLevel({ levels: [] as DungeonLevel[] }, 'above', 'Oben');
    const second = addLevel(first.dungeon, 'below', 'Keller');
    return { dungeon: second.dungeon, top: first.level, cellar: second.level };
  };

  it('neue Ebenen liegen darüber oder darunter', () => {
    const { dungeon } = two();
    expect(levelsSorted(dungeon).map((level) => level.name)).toEqual(['Oben', 'Keller']);
  });

  it('verbinden legt das Gegenstück an – in beide Richtungen, mit der richtigen Richtung', () => {
    const { dungeon, top, cellar } = two();
    let stairId = '';
    const withStair = withLevel(dungeon, top.id, (level) => {
      const made = addStair(paintTiles(level, [{ x: 1, y: 1 }], 'floor'), { x: 1, y: 1 });
      stairId = made.stair.id;
      return made.level;
    });
    const linked = linkStairs(
      withStair,
      { levelId: top.id, stairId },
      { levelId: cellar.id, x: 4, y: 4 },
    );
    const here = findStair(linked, { levelId: top.id, stairId })!;
    const there = findStair(linked, here.stair.to)!;
    expect(here.stair.dir).toBe('down');
    expect(there.stair.dir).toBe('up');
    expect(there.stair.to).toEqual({ levelId: top.id, stairId });
    // Wo man ankommt, ist danach Boden.
    expect(there.level.tiles['4,4']).toBe('floor');
    expect(dungeonNotes(linked)).toHaveLength(0);

    // Tauschen die Ebenen ihre Lage, drehen sich die Richtungen.
    const swapped = moveLevel(linked, cellar.id, 'up');
    expect(findStair(swapped, { levelId: top.id, stairId })!.stair.dir).toBe('up');

    // Geht ein Ende, bleibt das andere ohne Ziel – und das steht als Hinweis da.
    const removed = removeStair(linked, { levelId: top.id, stairId });
    expect(findStair(removed, here.stair.to)!.stair.to).toBeNull();
    expect(dungeonNotes(removed).map((note) => note.text)).toEqual(['Treppe ohne Ziel']);

    expect(
      findStair(removeLevel(linked, cellar.id), { levelId: top.id, stairId })!.stair.to,
    ).toBeNull();
  });

  it('wird das Feld des Gegenstücks Fels, verliert der Etagenwechsel sein Ziel', () => {
    const { dungeon, top, cellar } = two();
    let stairId = '';
    const withStair = withLevel(dungeon, top.id, (level) => {
      const made = addStair(level, { x: 0, y: 0 });
      stairId = made.stair.id;
      return made.level;
    });
    const linked = linkStairs(
      withStair,
      { levelId: top.id, stairId },
      { levelId: cellar.id, x: 0, y: 0 },
    );
    const rock = withLevel(linked, cellar.id, (level) => paintTiles(level, [{ x: 0, y: 0 }], null));
    expect(findStair(healStairs(rock), { levelId: top.id, stairId })!.stair.to).toBeNull();
  });
});

describe('Hinweise', () => {
  it('ein Raum ohne Zugang und eine Tür in den Fels stehen als Hinweis da', () => {
    const { level, room } = withRoom();
    expect(roomHasAccess(level, room.id)).toBe(false);
    const door = setEdge(level, edgeKey({ x: 0, y: 0 }, 'n'), { kind: 'door' });
    const texts = dungeonNotes({ levels: [door] }).map((note) => note.text);
    expect(texts).toEqual(['Tür führt in den Fels', 'Halle hat keinen Zugang']);
    const open = digPath(level, lineCells({ x: 4, y: 0 }, { x: 2, y: 0 }), 'floor');
    expect(roomHasAccess(open, room.id)).toBe(true);
  });
});

describe('Runde Räume', () => {
  it('ein Kreis von sechs Feldern Durchmesser lässt die Ecken aus', () => {
    const shape = roundBetween({ x: 5, y: 5 }, { x: 0, y: 0 });
    expect(shape).toEqual({ x: 0, y: 0, w: 6, h: 6 });
    const keys = new Set(roundCells(shape).map((c) => `${c.x},${c.y}`));
    expect(keys.has('0,0')).toBe(false);
    expect(keys.has('5,5')).toBe(false);
    expect(keys.has('2,0')).toBe(true);
    expect(keys.has('0,3')).toBe(true);
    expect(keys.size).toBe(32);
  });

  it('rund bleibt ein Raum nur, solange seine Felder die der Ellipse sind', () => {
    const shape = { x: 0, y: 0, w: 4, h: 4 };
    const { level, room } = addRoom(blank(), roundCells(shape), 'Rotunde', { round: shape });
    expect(roundOf(level, level.rooms[0]!)).toEqual(shape);
    const cut = paintTiles(level, [{ x: 1, y: 0 }], null);
    expect(
      roundOf(
        cut,
        cut.rooms.find((r) => r.id === room.id)!,
      ),
    ).toBeNull();
  });
});

describe('Räume verschieben', () => {
  it('nimmt Tür, Falle und Einrichtung mit und weicht anderem Boden nicht aus', () => {
    const { level, room } = withRoom();
    const door = setEdge(level, edgeKey({ x: 2, y: 0 }, 'e'), { kind: 'door' });
    const trapped = addTrap(door, { x: 1, y: 1 }).level;
    const moved = moveRoom(trapped, room.id, 4, 2)!;
    expect(roomCells(moved, room.id)).toHaveLength(6);
    expect(moved.tiles['0,0']).toBeUndefined();
    expect(moved.tiles['4,2']).toBe('floor');
    expect(moved.edges[edgeKey({ x: 6, y: 2 }, 'e')]?.kind).toBe('door');
    expect(moved.traps[0]!.cells).toEqual([{ x: 5, y: 3 }]);
    // Ein Feld weiter überlappt er sich selbst – das geht; in fremden Boden hinein nicht.
    expect(moveRoom(trapped, room.id, 1, 0)).not.toBeNull();
    const blocked = paintTiles(trapped, [{ x: 4, y: 0 }], 'floor');
    expect(moveRoom(blocked, room.id, 2, 0)).toBeNull();
  });
});

describe('Räume über mehrere Ebenen', () => {
  it('nach oben entsteht Luftraum, derselbe Raum – und ein Name gilt für alle Ebenen', () => {
    const { level, room } = withRoom();
    const made = extendRoom({ levels: [level] }, level.id, room.id, 'up')!;
    const upper = made.dungeon.levels.find((l) => l.id === made.levelId)!;
    expect(upper.order).toBeGreaterThan(level.order);
    expect(upper.tiles['0,0']).toBe('air');
    const lower = made.dungeon.levels.find((l) => l.id === level.id)!;
    const span = roomSpan(made.dungeon, lower.rooms[0]!);
    expect(span.map((s) => s.room.id)).toEqual([made.roomId]);

    const renamed = patchRoomEverywhere(made.dungeon, level.id, room.id, { name: 'Große Halle' });
    expect(renamed.levels.flatMap((l) => l.rooms.map((r) => r.name))).toEqual([
      'Große Halle',
      'Große Halle',
    ]);
    // In den Luftraum hinein führt kein Weg – dort fällt man.
    const gallery = paintTiles(upper, [{ x: 0, y: 0 }], 'floor');
    expect(canPass(gallery, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(false);
  });

  it('nach unten entsteht Boden; die Ebene wird angelegt, wenn sie fehlt', () => {
    const { level, room } = withRoom();
    const made = extendRoom({ levels: [level] }, level.id, room.id, 'down')!;
    expect(made.dungeon.levels).toHaveLength(2);
    const lower = made.dungeon.levels.find((l) => l.id === made.levelId)!;
    expect(lower.order).toBeLessThan(level.order);
    expect(lower.tiles['2,1']).toBe('floor');
  });
});

describe('Breite Gänge und Doppeltüren', () => {
  it('ein Gang von zwei Feldern Breite öffnet den Raum auf ganzer Breite', () => {
    const { level } = withRoom();
    const dug = digPath(level, lineCells({ x: 5, y: 0 }, { x: 2, y: 0 }), 'floor', 2);
    expect(edgeBetween(dug, { x: 3, y: 0 }, { x: 2, y: 0 }).kind).toBe('open');
    expect(edgeBetween(dug, { x: 3, y: 1 }, { x: 2, y: 1 }).kind).toBe('open');
    expect(dug.tiles['5,1']).toBe('floor');
  });

  it('zwei Türen nebeneinander sind eine Doppeltür – geändert und entfernt als eine', () => {
    const { level } = withRoom();
    const gang = paintTiles(level, rectCells({ x: 3, y: 0 }, { x: 3, y: 1 }), 'floor');
    const upper = edgeKeyBetween({ x: 2, y: 0 }, { x: 3, y: 0 })!;
    const lower = edgeKeyBetween({ x: 2, y: 1 }, { x: 3, y: 1 })!;
    const doors = setEdge(setEdge(gang, upper, { kind: 'door' }), lower, { kind: 'door' });
    expect(edgeRun(doors, lower)).toEqual([upper, lower]);
    expect(edgeName('door', 2)).toBe('Doppeltür');
    const locked = patchEdgeRun(doors, upper, { locked: true, lockDc: 15 });
    expect(locked.edges[lower]).toMatchObject({ locked: true, lockDc: 15 });
    // Eine andere Art daneben gehört nicht dazu; Wände nie.
    const mixed = setEdge(doors, lower, { kind: 'gate' });
    expect(edgeRun(mixed, upper)).toEqual([upper]);
    expect(Object.keys(removeEdgeRun(doors, upper).edges)).toHaveLength(0);
  });
});
