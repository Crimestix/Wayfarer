import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { lineOfSign, signsAlong } from '../../domain/mapDraw';
import { MapSchema, createEntity, type Place } from '../../domain/schema';
import { routeBetween, routeNotes, waysFrom } from '../../domain/ways';
import {
  createDrawnMap,
  drawLine,
  placeMarker,
  placeSign,
  removeSign,
  setLineSecret,
  updateSign,
} from './actions';
import { lineFacts, pickAt, routeWarnings, signFacts } from './model';

/**
 * Erfundene Gewölbe unter Graufels: Von der Pilzgrotte führt ein Gang geradewegs zur Torhalle
 * (960 m, zwölf Minuten) – und ein Umweg über die Brunnenkammer.
 */
async function setup(detour = true) {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string) =>
    db.put('entities', createEntity({ kind: 'place', name })) as Place;
  const grotto = place('Pilzgrotte');
  const hall = place('Torhalle');
  const well = place('Brunnenkammer');
  const map = createDrawnMap(db, {
    name: 'Die Tiefen unter Graufels',
    widthKm: 2,
    placeId: null,
    level: 'underground',
    ground: 'rock',
  });
  placeMarker(db, map.id, [220, 300], grotto.id);
  placeMarker(db, map.id, [700, 300], hall.id);
  placeMarker(db, map.id, [460, 520], well.id);
  const direct = drawLine(db, map.id, 'road', [
    [220, 300],
    [700, 300],
  ]).line!;
  if (detour) {
    drawLine(db, map.id, 'road', [
      [220, 300],
      [460, 520],
    ]);
    drawLine(db, map.id, 'road', [
      [460, 520],
      [700, 300],
    ]);
  }
  const data = () => db.getSnapshot();
  const current = () => data().maps[map.id]!;
  const door = (at: [number, number] = [450, 304]) =>
    placeSign(db, map.id, { kind: 'door', hidden: false }, at).sign!;
  const trap = (at: [number, number]) =>
    placeSign(db, map.id, { kind: 'trap', hidden: true }, at).sign!;
  return { db, data, current, map, grotto, hall, well, direct, door, trap };
}

describe('Ein Zeichen setzen', () => {
  it('rastet auf dem Gang ein, wenn es nahe an ihm gesetzt wird', async () => {
    const { current, door } = await setup();
    const sign = door([450, 310]);
    expect([sign.x, sign.y]).toEqual([450, 300]);
    expect(lineOfSign(current(), sign)?.line.kind).toBe('road');
  });

  it('steht frei, wenn kein Gang in der Nähe ist – dann gilt es für keinen Weg', async () => {
    const { data, current, grotto, door } = await setup();
    const sign = door([450, 400]);
    expect([sign.x, sign.y]).toEqual([450, 400]);
    expect(lineOfSign(current(), sign)).toBeNull();
    expect(signFacts(data(), current(), sign).meaning).toContain('versperrt keinen Weg');
    expect(waysFrom(data(), grotto.id).every((way) => way.signs.length === 0)).toBe(true);
  });

  it('eine alte Karte ohne Zeichen bleibt lesbar', () => {
    const old = MapSchema.parse({
      id: 'karte',
      created: '2026-11-12T10:00:00.000Z',
      updated: '2026-11-12T10:00:00.000Z',
      name: 'Alt',
      kind: 'drawn',
      lines: [{ id: 'gang', kind: 'road', points: [] }],
    });
    expect(old.signs).toEqual([]);
    expect(old.lines[0]!.secret).toBe(false);
  });
});

describe('Eine Tür im Gang', () => {
  it('geschlossen hält sie niemanden auf', async () => {
    const { data, grotto, hall, door } = await setup();
    door();
    const route = routeBetween(data(), grotto.id, hall.id)!;
    expect(route).toMatchObject({ minutes: 12, via: [], barred: false });
    expect(routeNotes(data(), route)).toEqual([]);
  });

  it('verschlossen versperrt sie den Weg: Die Gruppe nimmt den Umweg', async () => {
    const { db, data, map, grotto, hall, well, door } = await setup();
    const sign = door();
    updateSign(db, map.id, sign.id, { door: 'locked', name: 'Eisentor' });
    const route = routeBetween(data(), grotto.id, hall.id)!;
    expect(route.via).toEqual([well.id]);
    expect(route.barred).toBe(false);
    expect(route.minutes).toBeGreaterThan(12);
    expect(routeWarnings(data(), grotto.id, hall.id).detour).toBe(
      'Der direkte Weg ist versperrt: Tür „Eisentor“ ist verschlossen',
    );
    // In beiden Richtungen.
    expect(routeBetween(data(), hall.id, grotto.id)!.via).toEqual([well.id]);
    // Aufgeschlossen ist der kurze Weg wieder frei.
    updateSign(db, map.id, sign.id, { door: 'open' });
    expect(routeBetween(data(), grotto.id, hall.id)!.via).toEqual([]);
  });

  it('ohne anderen Weg bleibt die Route – als versperrt gemeldet', async () => {
    const { db, data, current, map, grotto, hall, door } = await setup(false);
    const sign = door();
    updateSign(db, map.id, sign.id, { door: 'locked', name: 'Eisentor' });
    const route = routeBetween(data(), grotto.id, hall.id)!;
    expect(route).toMatchObject({ minutes: 12, barred: true });
    expect(routeWarnings(data(), grotto.id, hall.id)).toEqual({
      notes: ['Tür „Eisentor“ ist verschlossen'],
      barred: true,
      detour: null,
    });
    expect(waysFrom(data(), grotto.id)[0]!.barred).toBe(true);
    expect(signFacts(data(), current(), current().signs[0]!).meaning).toBe(
      'Der Weg zwischen Pilzgrotte und Torhalle ist versperrt, bis sie offen ist.',
    );
  });

  it('eine Geheimtür: Der Weg führt durch sie, die Gruppe kennt sie nicht', async () => {
    const { db, data, current, map, grotto, hall } = await setup(false);
    const sign = placeSign(db, map.id, { kind: 'door', hidden: true }, [450, 300]).sign!;
    expect(routeWarnings(data(), grotto.id, hall.id)).toEqual({
      notes: ['Geheimtür – die Gruppe kennt sie noch nicht'],
      barred: false,
      detour: null,
    });
    updateSign(db, map.id, sign.id, { hidden: false });
    expect(routeWarnings(data(), grotto.id, hall.id).notes).toEqual([]);
    expect(signFacts(data(), current(), current().signs[0]!).sort).toBe('Tür');
  });
});

describe('Eine Falle im Gang', () => {
  it('wird vor dem Aufbruch gemeldet, solange sie scharf ist', async () => {
    const { db, data, current, map, grotto, hall, direct, trap } = await setup(false);
    const sign = trap([600, 298]);
    updateSign(db, map.id, sign.id, { name: 'Fallgrube' });
    expect(routeWarnings(data(), grotto.id, hall.id)).toEqual({
      notes: ['Falle „Fallgrube“ – die Gruppe ahnt nichts'],
      barred: false,
      detour: null,
    });
    expect(lineFacts(data(), current(), current().lines[0]!).notes).toHaveLength(1);
    expect(direct.pathId).not.toBeNull();
    updateSign(db, map.id, sign.id, { hidden: false });
    expect(routeWarnings(data(), grotto.id, hall.id).notes).toEqual([
      'Falle „Fallgrube“ – die Gruppe weiß davon',
    ]);
    updateSign(db, map.id, sign.id, { armed: false });
    expect(routeWarnings(data(), grotto.id, hall.id).notes).toEqual([]);
  });

  it('Zeichen stehen in der Reihenfolge, in der man sie erreicht', async () => {
    const { data, current, grotto, hall, direct, door, trap } = await setup(false);
    trap([600, 300]);
    door([300, 300]);
    expect(signsAlong(current(), direct.points).map((sign) => sign.kind)).toEqual(['door', 'trap']);
    const kinds = (fromId: string) => waysFrom(data(), fromId)[0]!.signs.map((sign) => sign.kind);
    expect(kinds(grotto.id)).toEqual(['door', 'trap']);
    expect(kinds(hall.id)).toEqual(['trap', 'door']);
  });
});

describe('Ein Geheimgang', () => {
  it('steht im Wegenetz als Weg, den die Gruppe noch nicht kennt', async () => {
    const { db, data, current, map, grotto, well } = await setup(false);
    const { line } = drawLine(
      db,
      map.id,
      'road',
      [
        [220, 300],
        [460, 520],
      ],
      true,
    );
    expect(line!.secret).toBe(true);
    expect(data().paths[line!.pathId!]!.secret).toBe(true);
    // Der Spielleiter kennt ihn: Die Route führt hindurch.
    expect(routeBetween(data(), grotto.id, well.id)).not.toBeNull();

    const undo = setLineSecret(db, map.id, line!.id, false);
    expect(current().lines.find((entry) => entry.id === line!.id)!.secret).toBe(false);
    expect(data().paths[line!.pathId!]!.secret).toBe(false);
    undo();
    expect(current().lines.find((entry) => entry.id === line!.id)!.secret).toBe(true);
    expect(data().paths[line!.pathId!]!.secret).toBe(true);
  });

  it('ein Fluss oder eine Grenze kann nicht geheim sein', async () => {
    const { db, map } = await setup(false);
    const { line } = drawLine(
      db,
      map.id,
      'river',
      [
        [100, 100],
        [300, 100],
      ],
      true,
    );
    expect(line!.secret).toBe(false);
  });
});

describe('Zeichen ändern und zurücknehmen', () => {
  it('nimmt genau die eine Änderung zurück', async () => {
    const { db, current, map, door } = await setup(false);
    const sign = door();
    const undoLock = updateSign(db, map.id, sign.id, { door: 'locked' });
    updateSign(db, map.id, sign.id, { name: 'Eisentor' });
    undoLock();
    expect(current().signs[0]).toMatchObject({ door: 'closed', name: 'Eisentor' });
    const undoRemove = removeSign(db, map.id, sign.id);
    expect(current().signs).toEqual([]);
    undoRemove();
    expect(current().signs[0]!.name).toBe('Eisentor');
  });

  it('ein Klick trifft das Zeichen vor dem Gang, auf dem es sitzt', async () => {
    const { current, direct, door } = await setup(false);
    const sign = door();
    expect(pickAt(current(), [452, 302], 1)).toEqual({ kind: 'sign', id: sign.id });
    expect(pickAt(current(), [520, 302], 1)).toEqual({ kind: 'line', id: direct.id });
  });
});
