import { describe, expect, it } from 'vitest';
import {
  addDweller,
  addLevel,
  addMarker,
  addRoom,
  patchDweller,
  toggleMarkerLink,
  addStair,
  addTrap,
  digPath,
  edgeKeyBetween,
  lineCells,
  linkStairs,
  patchTrap,
  rectCells,
  setEdge,
  withLevel,
} from '../dungeon';
import {
  addToken,
  foeTurn,
  rollInits,
  stirFoes,
  unsyncedMinutes,
  useMarker,
  edgeFoundKey,
  hiddenNear,
  moveTokens,
  nextTurn,
  playerLevel,
  routeBetween,
  setDoor,
  setLight,
  startPlay,
  startRounds,
  trapState,
  useStair,
  visibleCells,
} from '../dungeonPlay';
import { DungeonPlaySchema, DungeonSchema, type Dungeon, type DungeonLevel } from '../schema';

/**
 * Halle (0..4 × 0..2), ein Gang nach Osten (5..12, y = 1), an seinem Ende eine Kammer (13..15 ×
 * 0..2). Zwischen Halle und Gang ein Durchgang, zwischen Gang und Kammer eine Tür.
 */
function world(change: (level: DungeonLevel) => DungeonLevel = (l) => l): Dungeon {
  const base = addLevel({ levels: [] as DungeonLevel[] }, 'above', 'Oben');
  let level = addRoom(base.level, rectCells({ x: 0, y: 0 }, { x: 4, y: 2 }), 'Halle').level;
  level = addRoom(level, rectCells({ x: 13, y: 0 }, { x: 15, y: 2 }), 'Kammer').level;
  level = digPath(level, lineCells({ x: 4, y: 1 }, { x: 13, y: 1 }), 'floor');
  level = setEdge(level, edgeKeyBetween({ x: 12, y: 1 }, { x: 13, y: 1 })!, { kind: 'door' });
  return DungeonSchema.parse({ id: 'd', name: 'Probe', levels: [change(level)] });
}

const hero = (over: object = {}) => ({ name: 'Mira', passive: 12, ...over });

function started(dungeon: Dungeon, heroes = [hero()], at = { x: 1, y: 1 }): Dungeon {
  const play = startPlay(dungeon, heroes, dungeon.levels[0]!.id, at)!;
  return { ...dungeon, play };
}

describe('Weg und Bewegung', () => {
  it('der Weg führt durch den Durchgang, nie durch die Wand', () => {
    const d = started(world());
    const route = routeBetween(d, d.levels[0]!.id, { x: 1, y: 0 }, { x: 6, y: 1 })!;
    expect(route.cells.some((c) => c.x === 4 && c.y === 1)).toBe(true);
    expect(route.feet).toBe(25);
    expect(routeBetween(d, d.levels[0]!.id, { x: 1, y: 1 }, { x: 7, y: 5 })).toBeNull();
  });

  it('vor einer geschlossenen Tür hält die Gruppe; ist sie offen, geht es hindurch', () => {
    const d = started(world());
    const id = d.play!.tokens[0]!.id;
    const stop = moveTokens(d, [id], { x: 14, y: 1 })!;
    expect(stop.halt?.type).toBe('door');
    expect(stop.play.tokens[0]).toMatchObject({ x: 12, y: 1 });
    const key = edgeKeyBetween({ x: 12, y: 1 }, { x: 13, y: 1 })!;
    const opened = {
      ...d,
      play: setDoor({ ...d, play: stop.play }, d.levels[0]!.id, key, { opened: true })!,
    };
    const through = moveTokens(opened, [id], { x: 14, y: 1 })!;
    expect(through.halt).toBeNull();
    expect(through.play.tokens[0]).toMatchObject({ x: 14, y: 1 });
    // Das Gebaute bleibt, wie es war.
    expect(d.levels[0]!.edges[key]!.opened).toBe(false);
  });

  it('die anderen folgen auf der Spur, und die Zeit vergeht mit dem Weg', () => {
    const d = started(world(), [hero(), hero({ name: 'Tolk' })]);
    const ids = d.play!.tokens.map((t) => t.id);
    const moved = moveTokens(d, ids, { x: 10, y: 1 })!;
    expect(moved.play.tokens[0]).toMatchObject({ x: 10, y: 1 });
    expect(moved.play.tokens[1]).toMatchObject({ x: 9, y: 1 });
    // 45 Fuß bei 30 Fuß je Runde: neun Sekunden.
    expect(moved.feet).toBe(45);
    expect(moved.play.seconds).toBe(9);
  });

  it('in Runden endet der Weg mit der Bewegungsrate', () => {
    const d = started(world());
    const play = startRounds(d.play!);
    const id = play.tokens[0]!.id;
    const moved = moveTokens({ ...d, play }, [id], { x: 11, y: 1 })!;
    expect(moved.halt?.type).toBe('spent');
    expect(moved.feet).toBe(30);
    const next = nextTurn(moved.play);
    expect(next.play.rounds).toMatchObject({ round: 2, moved: 0 });
    expect(next.play.seconds).toBe(6);
  });
});

describe('Fallen und Geheimtüren', () => {
  const trapped = (findDc: number | null) =>
    world((level) => {
      const made = addTrap(level, { x: 8, y: 1 });
      return patchTrap(made.level, made.trap.id, { findDc, name: 'Speerfalle' });
    });

  it('wer genug passive Wahrnehmung hat, bemerkt die Falle und bleibt davor stehen', () => {
    const d = started(trapped(12));
    const moved = moveTokens(d, [d.play!.tokens[0]!.id], { x: 11, y: 1 })!;
    expect(moved.halt?.type).toBe('trap-found');
    expect(moved.play.tokens[0]!.x).toBeLessThan(8);
    expect(trapState(moved.play, d.levels[0]!.traps[0]!)).toBe('found');
    // Danach meidet der Weg sie, wenn es anders geht – hier geht es nicht anders: Sie löst aus.
    const on = moveTokens({ ...d, play: moved.play }, [d.play!.tokens[0]!.id], { x: 11, y: 1 })!;
    expect(on.halt?.type).toBe('trap-sprung');
  });

  it('wer sie nicht bemerkt, tritt hinein', () => {
    const d = started(trapped(15));
    const moved = moveTokens(d, [d.play!.tokens[0]!.id], { x: 11, y: 1 })!;
    expect(moved.halt?.type).toBe('trap-sprung');
    expect(moved.play.tokens[0]).toMatchObject({ x: 8, y: 1 });
    expect(moved.play.sprung).toHaveLength(1);
  });

  it('eine Geheimtür ist eine Wand, bis sie jemand findet', () => {
    const secret = world((level) => {
      const dug = digPath(level, lineCells({ x: 2, y: 3 }, { x: 2, y: 6 }), 'secret');
      return setEdge(dug, edgeKeyBetween({ x: 2, y: 2 }, { x: 2, y: 3 })!, {
        kind: 'secret',
        findDc: 16,
      });
    });
    const d = started(secret, [hero({ darkvision: 60 })]);
    const levelId = d.levels[0]!.id;
    expect(routeBetween(d, levelId, { x: 1, y: 1 }, { x: 2, y: 5 })).toBeNull();
    expect(visibleCells(d, levelId).has('2,4')).toBe(false);
    const near = hiddenNear(d, d.play!.tokens[0]!.id);
    expect(near.map((h) => [h.label, h.dc])).toEqual([['Geheimtür', 16]]);
    // Für die Spieler ist dort eine Wand.
    const key = edgeKeyBetween({ x: 2, y: 2 }, { x: 2, y: 3 })!;
    expect(playerLevel(d.levels[0]!, d.play!).edges[key]?.kind).toBe('wall');
    const found = { ...d.play!, found: [edgeFoundKey(levelId, key)] };
    const route = routeBetween({ ...d, play: found }, levelId, { x: 1, y: 1 }, { x: 2, y: 5 });
    expect(route).not.toBeNull();
    // Hohe passive Wahrnehmung bemerkt sie im Vorbeigehen.
    const sharp = started(secret, [hero({ passive: 17 })]);
    const moved = moveTokens(sharp, [sharp.play!.tokens[0]!.id], { x: 3, y: 2 })!;
    expect(moved.halt?.type).toBe('secret-found');
  });
});

describe('Licht und Sicht', () => {
  it('ohne Licht und Dunkelsicht sieht man nur das eigene Feld', () => {
    const d = started(world());
    expect([...visibleCells(d, d.levels[0]!.id)]).toEqual(['1,1']);
  });

  it('eine Fackel reicht 40 Fuß, eine geschlossene Tür versperrt die Sicht', () => {
    const d = started(world(), [hero()], { x: 9, y: 1 });
    const id = d.play!.tokens[0]!.id;
    const lit = { ...d, play: setLight(d, id, 'torch')! };
    const seen = visibleCells(lit, d.levels[0]!.id);
    expect(seen.has('12,1')).toBe(true);
    expect(seen.has('13,1')).toBe(false);
    expect(seen.has('1,1')).toBe(true);
    expect(seen.has('0,1')).toBe(false);
    const key = edgeKeyBetween({ x: 12, y: 1 }, { x: 13, y: 1 })!;
    const open = { ...lit, play: setDoor(lit, d.levels[0]!.id, key, { opened: true })! };
    expect(visibleCells(open, d.levels[0]!.id).has('14,1')).toBe(true);
  });

  it('Dunkelsicht sieht ohne Licht – so weit sie reicht', () => {
    const d = started(world(), [hero({ darkvision: 30 })], { x: 8, y: 1 });
    const seen = visibleCells(d, d.levels[0]!.id);
    expect(seen.has('5,1')).toBe(true);
    // Weiter als die Dunkelsicht reicht nichts, und hinter der Tür ist nichts zu sehen.
    expect(seen.has('1,1')).toBe(false);
    expect(seen.has('13,1')).toBe(false);
  });

  it('die Fackel erlischt nach einer Stunde – die Gruppe hält', () => {
    const d = started(world(), [hero()], { x: 9, y: 1 });
    const id = d.play!.tokens[0]!.id;
    const lit = setLight(d, id, 'torch')!;
    const late = { ...d, play: { ...lit, seconds: 3598 } };
    const moved = moveTokens(late, [id], { x: 5, y: 1 })!;
    expect(moved.halt?.type).toBe('light');
    expect(moved.play.tokens[0]!.light).toBe('none');
  });
});

describe('Etagenwechsel und Gegner', () => {
  it('die Gruppe kommt am Gegenstück an – auf der anderen Ebene', () => {
    let d = world();
    const top = d.levels[0]!.id;
    let stairId = '';
    d = withLevel(d, top, (level) => {
      const made = addStair(level, { x: 3, y: 1 });
      stairId = made.stair.id;
      return made.level;
    });
    const below = addLevel(d, 'below', 'Keller');
    d = withLevel(
      below.dungeon,
      below.level.id,
      (level) => addRoom(level, rectCells({ x: 2, y: 0 }, { x: 5, y: 2 }), 'Gruft').level,
    );
    d = linkStairs(d, { levelId: top, stairId }, { levelId: below.level.id, x: 3, y: 1 });
    const s = started(d, [hero(), hero({ name: 'Tolk' })]);
    const used = useStair(
      s,
      s.play!.tokens.map((t) => t.id),
      top,
      stairId,
    )!;
    expect(used.levelId).toBe(below.level.id);
    expect(used.play.tokens.every((t) => t.levelId === below.level.id)).toBe(true);
    expect(new Set(used.play.tokens.map((t) => `${t.x},${t.y}`)).size).toBe(2);
    // Der Stand bleibt gültig – nichts von der Treppe gerät in die Figuren.
    expect(() => DungeonPlaySchema.parse(used.play)).not.toThrow();
    expect(used.play.tokens.map((t) => t.kind)).toEqual(['hero', 'hero']);
  });

  it('ein Gegner, der in Sicht kommt, hält die Gruppe an', () => {
    const d = started(world(), [hero({ darkvision: 60 })]);
    const foe = addToken(d.play!, 'foe', d.levels[0]!.id, { x: 11, y: 1 });
    const moved = moveTokens({ ...d, play: foe.play }, [d.play!.tokens[0]!.id], { x: 6, y: 1 })!;
    expect(moved.halt?.type).toBe('foe');
    expect(moved.halt?.title).toBe('In Sicht: Gegner 1');
  });
});

describe('Bewohner und Schalter', () => {
  /** Ein Wächter in der Kammer hinter der Tür, der eine Runde durch die Kammer geht. */
  const guarded = (behave: 'patrol' | 'hunt') =>
    world((level) => {
      const made = addDweller(level, { x: 14, y: 1 });
      return patchDweller(made.level, made.dweller.id, {
        name: 'Wächter',
        behave,
        route: [{ x: 14, y: 2 }],
        hp: 11,
      });
    });

  it('vorbereitete Bewohner stehen beim Aufstellen auf dem Brett', () => {
    const d = started(guarded('patrol'));
    const foe = d.play!.tokens.find((t) => t.kind === 'foe')!;
    expect(foe).toMatchObject({ name: 'Wächter', x: 14, y: 1, hp: 11, hpMax: 11 });
  });

  it('wer eine Runde geht, geht sie, während Zeit vergeht – gemächlich', () => {
    const d = started(guarded('patrol'));
    // Zwei Sekunden bei halber Rate: fünf Fuß – ein Feld zum ersten Wegpunkt.
    const stirred = stirFoes(d, d.play!, 2);
    expect(stirred.play.tokens.find((t) => t.kind === 'foe')).toMatchObject({ x: 14, y: 2 });
    expect(stirred.halt).toBeNull();
    // Danach geht es zurück an seinen Platz.
    const back = stirFoes({ ...d, play: stirred.play }, stirred.play, 2);
    expect(back.play.tokens.find((t) => t.kind === 'foe')).toMatchObject({ x: 14, y: 1 });
  });

  it('hinter der geschlossenen Tür bemerkt er niemanden; ist sie offen, merkt er auf und kommt', () => {
    const d = started(guarded('hunt'), [hero()], { x: 9, y: 1 });
    expect(stirFoes(d, d.play!, 6).halt).toBeNull();
    const key = edgeKeyBetween({ x: 12, y: 1 }, { x: 13, y: 1 })!;
    const open = { ...d, play: setDoor(d, d.levels[0]!.id, key, { opened: true })! };
    const noticed = stirFoes(open, open.play!, 6);
    expect(noticed.halt?.title).toBe('Wächter hat die Gruppe bemerkt');
    const before = noticed.play.tokens.find((t) => t.kind === 'foe')!;
    const after = stirFoes({ ...open, play: noticed.play }, noticed.play, 6).play.tokens.find(
      (t) => t.kind === 'foe',
    )!;
    expect(Math.hypot(after.x - 9, after.y - 1)).toBeLessThan(
      Math.hypot(before.x - 9, before.y - 1),
    );
    // In Runden geht er auf seinem Zug auf den Nächsten zu und bleibt daneben stehen.
    const turn = foeTurn({ ...open, play: noticed.play }, before.id)!;
    const stood = turn.play.tokens.find((t) => t.kind === 'foe')!;
    expect(Math.max(Math.abs(stood.x - 9), Math.abs(stood.y - 1))).toBeGreaterThanOrEqual(1);
  });

  it('ein Hebel öffnet die Tür, auf die er wirkt', () => {
    const key = edgeKeyBetween({ x: 12, y: 1 }, { x: 13, y: 1 })!;
    let leverId = '';
    const d = started(
      world((level) => {
        const made = addMarker(level, { x: 1, y: 0 }, 'lever');
        leverId = made.marker.id;
        return toggleMarkerLink(made.level, leverId, { kind: 'edge', levelId: level.id, ref: key });
      }),
    );
    const pulled = useMarker(d, d.levels[0]!.id, leverId)!;
    expect(pulled.doors[`${d.levels[0]!.id}:${key}`]).toEqual({ opened: true, locked: false });
    const again = useMarker({ ...d, play: pulled }, d.levels[0]!.id, leverId)!;
    expect(again.doors[`${d.levels[0]!.id}:${key}`]!.opened).toBe(false);
  });

  it('Initiative wird nur gewürfelt, wo noch keine steht; Minuten zählen bis zur Übernahme', () => {
    const d = started(world());
    const rolled = rollInits(
      { ...d.play!, seconds: 150 },
      () => 12,
      () => 3,
    );
    expect(rolled.tokens[0]!.init).toBe(15);
    expect(
      rollInits(
        rolled,
        () => 1,
        () => 0,
      ).tokens[0]!.init,
    ).toBe(15);
    expect(unsyncedMinutes(rolled)).toBe(2);
  });
});
