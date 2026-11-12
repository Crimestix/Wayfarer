import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  GROUNDS,
  LEVEL_GROUNDS,
  groundAt,
  lineLabel,
  symbolSites,
  walkAlong,
} from '../../domain/mapDraw';
import { createEntity } from '../../domain/schema';
import { wayMinutes } from '../../domain/ways';
import { createDrawnMap, drawLine, paintGround, paintRect, placeMarker } from './actions';
import { formatLength, groundFacts, lineFacts, scaleBar } from './model';

/**
 * Eine erfundene Tiefe: die Gewölbe unter Graufels, 2 km breit, alles Fels. Im Westen die
 * Pilzgrotte (eine gemalte Höhle), im Osten die Torhalle (ein Raum).
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string) => db.put('entities', createEntity({ kind: 'place', name }));
  const grotto = place('Pilzgrotte');
  const hall = place('Torhalle');
  const map = createDrawnMap(db, {
    name: 'Die Tiefen unter Graufels',
    widthKm: 2,
    placeId: null,
    level: 'underground',
    ground: 'rock',
  });
  // Die Grotte: ein breiter Pinselstrich von (100, 300) bis (220, 300).
  paintGround(db, map.id, 'cave', 100, [
    [100, 300],
    [220, 300],
  ]);
  // Die Halle: ein Rechteck von (700, 250) bis (800, 350).
  paintRect(db, map.id, 'cave', [800, 350], [700, 250]);
  placeMarker(db, map.id, [220, 300], grotto.id);
  placeMarker(db, map.id, [700, 300], hall.id);
  const data = () => db.getSnapshot();
  const current = () => data().maps[map.id]!;
  return { db, data, current, mapId: map.id, grotto, hall };
}

describe('Gelände unter der Erde', () => {
  it('bietet je Ebene eigenes Gelände – unter der Erde ist Fels der übliche Grund', () => {
    expect(LEVEL_GROUNDS.underground[0]).toBe('rock');
    expect(LEVEL_GROUNDS.surface[0]).toBe('plain');
    expect(LEVEL_GROUNDS.underground.map((ground) => GROUNDS[ground].label)).toEqual([
      'Fels',
      'Höhle',
      'Pilzwald',
      'Geröll',
      'Wasser',
      'Abgrund',
    ]);
  });

  it('Fels ist überall, wo nichts herausgearbeitet ist', async () => {
    const { current } = await setup();
    expect(groundAt(current(), 500, 100)).toBe('rock');
    expect(groundAt(current(), 160, 300)).toBe('cave');
    expect(groundFacts(current(), 500, 100).note).toMatch(/Kein Durchkommen/);
  });

  it('ein Raum ist ein Rechteck mit geraden Kanten', async () => {
    const { current } = await setup();
    const room = current().strokes[1]!;
    expect(room.cap).toBe('butt');
    expect(room.width).toBe(100);
    expect(room.points).toEqual([
      [700, 300],
      [800, 300],
    ]);
    expect(groundAt(current(), 701, 251)).toBe('cave');
    expect(groundAt(current(), 799, 349)).toBe('cave');
    // Knapp daneben ist Fels – ein Pinsel hätte hier runde Enden.
    expect(groundAt(current(), 695, 300)).toBe('rock');
    expect(groundAt(current(), 750, 355)).toBe('rock');
    // Die gemalte Grotte dagegen reicht um ihre halbe Breite über ihre Enden hinaus.
    expect(groundAt(current(), 60, 300)).toBe('cave');
  });

  it('ein zu kleines Rechteck wird nicht gemalt', async () => {
    const { db, current, mapId } = await setup();
    paintRect(db, mapId, 'cave', [400, 400], [400.5, 480]);
    expect(current().strokes).toHaveLength(2);
  });

  it('Pilzwald bremst, über einen Abgrund kommt kein Pfad', async () => {
    const { db, current, mapId } = await setup();
    paintGround(db, mapId, 'fungus', 40, [[160, 300]]);
    paintGround(db, mapId, 'chasm', 10, [
      [200, 250],
      [200, 350],
    ]);
    const across: [number, number][] = [
      [110, 300],
      [260, 300],
    ];
    const path = walkAlong(current(), across, false)!;
    expect(path.difficult).toBeGreaterThan(0.1);
    expect(path.blocked).toBe(true);
    expect(walkAlong(current(), across, true)!.blocked).toBe(false);
    expect(symbolSites(current(), 8).every((site) => site.symbol === 'mushroom')).toBe(true);
    expect(symbolSites(current(), 8).length).toBeGreaterThan(3);
  });
});

describe('Gänge', () => {
  it('heißen unter der Erde Gang, oben Straße', () => {
    expect(lineLabel('road', 'underground')).toBe('Gang');
    expect(lineLabel('road', 'surface')).toBe('Straße');
    expect(lineLabel('path', 'underground')).toBe('Pfad');
  });

  it('ein Gang gräbt sich durch den Fels – und wird von Ort zu Ort zum Weg', async () => {
    const { db, data, current, mapId, grotto, hall } = await setup();
    const { line } = drawLine(db, mapId, 'road', [
      [222, 301],
      [698, 299],
    ]);
    // Im Gang ist begehbarer Boden, gleich daneben Fels.
    expect(groundAt(current(), 450, 300)).toBe('cave');
    expect(groundAt(current(), 450, 305)).toBe('cave');
    expect(groundAt(current(), 450, 308)).toBe('rock');
    // Auf der Oberwelt gräbt eine Straße nichts.
    expect(groundAt({ ...current(), level: 'surface' }, 450, 300)).toBe('rock');

    const path = data().paths[line!.pathId!]!;
    expect([path.fromId, path.toId]).toEqual([grotto.id, hall.id]);
    // 480 Einheiten bei 2 m je Einheit: 960 m, zwölf Minuten.
    expect(wayMinutes(data(), path)).toBe(12);
    expect(lineFacts(data(), current(), current().lines[0]!)).toMatchObject({
      sort: 'Gang',
      minutes: 12,
      blocked: false,
      way: { from: 'Pilzgrotte', to: 'Torhalle' },
    });
  });

  it('ein Pfad durch den Fels wird gemeldet – außer er folgt einem Gang', async () => {
    const { db, data, current, mapId } = await setup();
    const through: [number, number][] = [
      [220, 300],
      [700, 300],
    ];
    drawLine(db, mapId, 'path', through);
    expect(lineFacts(data(), current(), current().lines[0]!).blocked).toBe(true);
    drawLine(db, mapId, 'road', through);
    expect(lineFacts(data(), current(), current().lines[0]!).blocked).toBe(false);
  });
});

describe('Kleine Maßstäbe', () => {
  it('schreibt kurze Strecken in Metern', () => {
    expect(formatLength(0.25)).toBe('250 m');
    expect(formatLength(0.96)).toBe('960 m');
    expect(formatLength(3.26)).toBe('3,3 km');
    expect(formatLength(1240.4)).toBe('1.240 km');
  });

  it('hat für ein Gewölbe einen Maßstab in Metern', () => {
    expect(scaleBar(0.0001)).toEqual({ km: 0.01, px: 100 });
    expect(formatLength(scaleBar(0.0001).km)).toBe('10 m');
  });
});
