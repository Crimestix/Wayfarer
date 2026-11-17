import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity, createPath } from '../../domain/schema';
import { wayMinutes, waysFrom } from '../../domain/ways';
import {
  createDrawnMap,
  drawLine,
  paintGround,
  placeMarker,
  removeDrawnMap,
  removeLine,
  renameLine,
  updateDrawnMap,
} from './actions';
import { fitView, groundFacts, lineFacts, mapRows, scaleBar, toMap, zoomView } from './model';

/**
 * Eine erfundene Gegend: das Umland von Hohenfurt, 100 km breit. Hohenfurt liegt im Westen,
 * Graufels im Osten, dazwischen ein Wald.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string) => db.put('entities', createEntity({ kind: 'place', name }));
  const town = place('Hohenfurt');
  const rock = place('Graufels');
  const map = createDrawnMap(db, {
    name: 'Das Umland von Hohenfurt',
    widthKm: 100,
    placeId: town.id,
    level: 'surface',
    ground: 'plain',
  });
  placeMarker(db, map.id, [100, 300], town.id);
  placeMarker(db, map.id, [900, 300], rock.id);
  paintGround(db, map.id, 'forest', 100, [
    [500, 0],
    [500, 700],
  ]);
  const data = () => db.getSnapshot();
  const current = () => data().maps[map.id]!;
  return { db, data, current, town, rock, mapId: map.id };
}

describe('Karte anlegen', () => {
  it('rechnet den Maßstab aus der Breite', async () => {
    const { current, town } = await setup();
    expect(current().kind).toBe('drawn');
    expect(current().frame).toEqual({ width: 1000, height: 700 });
    expect(current().scale?.kmPerUnit).toBeCloseTo(0.1, 6);
    expect(current().placeId).toBe(town.id);
    expect(current().markers).toHaveLength(2);
    expect(current().strokes).toHaveLength(1);
  });

  it('ändert Angaben, ohne das Gezeichnete anzufassen', async () => {
    const { db, current, mapId } = await setup();
    updateDrawnMap(db, mapId, {
      name: 'Die Westmark',
      widthKm: 50,
      placeId: null,
      level: 'underground',
      ground: 'water',
    });
    expect(current().name).toBe('Die Westmark');
    expect(current().scale?.kmPerUnit).toBeCloseTo(0.05, 6);
    expect(current().level).toBe('underground');
    expect(current().ground).toBe('water');
    expect(current().strokes).toHaveLength(1);
  });

  it('nimmt einen Pinselstrich wieder zurück', async () => {
    const { db, current, mapId } = await setup();
    const undo = paintGround(db, mapId, 'hills', 50, [[200, 200]]);
    expect(current().strokes).toHaveLength(2);
    undo();
    expect(current().strokes).toHaveLength(1);
  });

  it('Zurücknehmen lässt stehen, was seither sonst geändert wurde', async () => {
    const { db, current, mapId, town } = await setup();
    const undo = paintGround(db, mapId, 'hills', 50, [[200, 200]]);
    updateDrawnMap(db, mapId, {
      name: 'Die Westmark',
      widthKm: 100,
      placeId: town.id,
      level: 'surface',
      ground: 'plain',
    });
    placeMarker(db, mapId, [300, 300], null, 'Alte Eiche');
    undo();
    expect(current().strokes.map((stroke) => stroke.ground)).toEqual(['forest']);
    expect(current().name).toBe('Die Westmark');
    expect(current().markers.map((marker) => marker.label)).toContain('Alte Eiche');
  });
});

describe('Linien, die etwas bedeuten', () => {
  it('eine Straße von Ort zu Ort wird zum Weg – die Dauer folgt der Karte', async () => {
    const { db, data, current, town, rock, mapId } = await setup();
    // Die Enden liegen nur in der Nähe der Orte: Sie docken an.
    const { line } = drawLine(db, mapId, 'road', [
      [108, 306],
      [500, 300],
      [893, 296],
    ]);
    expect(line?.points[0]).toEqual([100, 300]);
    expect(line?.points[line.points.length - 1]).toEqual([900, 300]);
    const path = data().paths[line!.pathId!]!;
    expect([path.fromId, path.toId, path.road, path.minutes]).toEqual([
      town.id,
      rock.id,
      'road',
      null,
    ]);
    // 80 km Straße, drei Meilen die Stunde: 16 Std. 40 Min. – der Wald bremst auf der Straße nicht.
    expect(wayMinutes(data(), path)).toBe(1000);
    expect(waysFrom(data(), town.id).map((way) => [way.toId, way.minutes])).toEqual([
      [rock.id, 1000],
    ]);
    expect(waysFrom(data(), rock.id).map((way) => way.toId)).toEqual([town.id]);
    const facts = lineFacts(data(), current(), current().lines[0]!);
    expect(facts).toMatchObject({
      sort: 'Straße',
      minutes: 1000,
      wet: false,
      way: { from: 'Hohenfurt', to: 'Graufels' },
    });
    expect(facts.km).toBeCloseTo(80, 5);
  });

  it('gibt es schon einen Weg ohne Karte, wird die gezeichnete Straße dieser Weg', async () => {
    const { db, data, town, rock, mapId } = await setup();
    const known = db.put('paths', createPath({ fromId: rock.id, toId: town.id, minutes: 240 }));
    const { line, undo } = drawLine(db, mapId, 'road', [
      [108, 306],
      [893, 296],
    ]);
    expect(line?.pathId).toBe(known.id);
    expect(Object.keys(data().paths)).toHaveLength(1);
    const path = data().paths[known.id]!;
    // Der Weg läuft von Graufels nach Hohenfurt – sein Verlauf auch; die feste Dauer bleibt.
    expect([path.mapId, path.road, path.minutes, path.points[0]]).toEqual([
      mapId,
      'road',
      240,
      [900, 300],
    ]);
    undo();
    expect(data().paths[known.id]).toMatchObject({ mapId: null, points: [], road: 'none' });
  });

  it('ein Pfad durch den Wald braucht länger als die Straße', async () => {
    const { db, data, mapId } = await setup();
    const { line } = drawLine(db, mapId, 'path', [
      [100, 300],
      [900, 300],
    ]);
    const path = data().paths[line!.pathId!]!;
    expect(path.road).toBe('trail');
    // 70 km frei, 10 km Wald zählen doppelt: 90 km Aufwand.
    expect(Math.abs(wayMinutes(data(), path)! - 1125)).toBeLessThanOrEqual(10);
  });

  it('wird das Gelände umgemalt, ändert sich die Dauer des Weges', async () => {
    const { db, data, mapId } = await setup();
    const { line } = drawLine(db, mapId, 'path', [
      [100, 300],
      [900, 300],
    ]);
    paintGround(db, mapId, 'plain', 120, [
      [500, 0],
      [500, 700],
    ]);
    expect(wayMinutes(data(), data().paths[line!.pathId!]!)).toBe(1000);
  });

  it('Flüsse, Grenzen und lose Enden ergeben keinen Weg', async () => {
    const { db, data, current, mapId } = await setup();
    drawLine(db, mapId, 'river', [
      [100, 300],
      [900, 300],
    ]);
    drawLine(db, mapId, 'road', [
      [100, 300],
      [600, 600],
    ]);
    drawLine(db, mapId, 'road', [
      [100, 300],
      [104, 303],
    ]);
    expect(current().lines.map((line) => line.pathId)).toEqual([null, null, null]);
    expect(Object.keys(data().paths)).toHaveLength(0);
    expect(lineFacts(data(), current(), current().lines[0]!)).toMatchObject({
      sort: 'Fluss',
      minutes: null,
      way: null,
    });
  });

  it('Zurücknehmen und Entfernen nehmen den Weg mit', async () => {
    const { db, data, current, mapId } = await setup();
    const across: [number, number][] = [
      [100, 300],
      [900, 300],
    ];
    const first = drawLine(db, mapId, 'road', across);
    first.undo();
    expect(current().lines).toHaveLength(0);
    expect(Object.keys(data().paths)).toHaveLength(0);

    const second = drawLine(db, mapId, 'road', across);
    renameLine(db, mapId, second.line!.id, 'Alte Handelsstraße');
    expect(current().lines[0]!.name).toBe('Alte Handelsstraße');
    const restore = removeLine(db, mapId, second.line!.id);
    expect(current().lines).toHaveLength(0);
    expect(Object.keys(data().paths)).toHaveLength(0);
    restore();
    expect(current().lines).toHaveLength(1);
    expect(Object.keys(data().paths)).toEqual([second.line!.pathId]);

    removeDrawnMap(db, mapId);
    expect(data().maps[mapId]).toBeUndefined();
    expect(Object.keys(data().paths)).toHaveLength(0);
  });
});

describe('Was die Seite zeigt', () => {
  it('listet gezeichnete Karten vor Bildkarten und findet sie über Namen und Ort', async () => {
    const { db, data } = await setup();
    createDrawnMap(db, {
      name: 'Aalinsel',
      widthKm: 8,
      placeId: null,
      level: 'underground',
      ground: 'water',
    });
    expect(mapRows(data()).map((row) => [row.name, row.line])).toEqual([
      ['Aalinsel', 'Unterreich'],
      ['Das Umland von Hohenfurt', 'Gezeichnet · Hohenfurt'],
    ]);
    expect(mapRows(data(), 'hohenf').map((row) => row.name)).toEqual(['Das Umland von Hohenfurt']);
    expect(mapRows(data(), 'unterreich').map((row) => row.name)).toEqual(['Aalinsel']);
    expect(mapRows(data(), 'nichts')).toEqual([]);
  });

  it('sagt, was an einer Stelle ist', async () => {
    const { current } = await setup();
    expect(groundFacts(current(), 500, 300).ground).toBe('forest');
    expect(groundFacts(current(), 500, 300).note).toMatch(/halb so schnell/);
    expect(groundFacts(current(), 200, 300).ground).toBe('plain');
  });

  it('zeigt erst die ganze Karte und vergrößert um die Stelle unter dem Zeiger', () => {
    const frame = { width: 1000, height: 700 };
    const view = fitView(frame, 1000, 700);
    expect(view.zoom).toBeCloseTo(0.94, 5);
    expect(toMap(view, 500, 350)).toEqual([500, 350]);
    const closer = zoomView(view, 2, 250, 175, frame, 1000, 700);
    expect(closer.zoom).toBeCloseTo(1.88, 5);
    const [bx, by] = toMap(view, 250, 175);
    const [ax, ay] = toMap(closer, 250, 175);
    expect(ax).toBeCloseTo(bx, 5);
    expect(ay).toBeCloseTo(by, 5);
    // Weiter hinaus als bis knapp unter „ganze Karte“ geht es nicht.
    expect(zoomView(view, 0.01, 500, 350, frame, 1000, 700).zoom).toBeCloseTo(0.564, 3);
  });

  it('wählt für den Maßstab eine runde Strecke', () => {
    expect(scaleBar(0.1)).toEqual({ km: 10, px: 100 });
    expect(scaleBar(0.002)).toEqual({ km: 0.25, px: 125 });
  });
});
