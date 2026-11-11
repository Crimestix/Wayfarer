import { describe, expect, it } from 'vitest';
import { NODATA } from '../geo';
import {
  coastDistance,
  fillRing,
  generatedHeight,
  landCells,
  withGeneratedRelief,
} from '../landRelief';

/** Ein Raster von 36 × 18 Zellen: jede 10° breit und hoch. */
const W = 36;
const H = 18;
const cell = (lon: number, lat: number) =>
  Math.floor((90 - lat) / 10) * W + Math.floor((lon + 180) / 10);
const count = (mask: Uint8Array) => mask.reduce((sum, v) => sum + v, 0);

describe('Landmassen ins Raster legen', () => {
  it('füllt die Zellen, deren Mitte im Ring liegt', () => {
    const mask = new Uint8Array(W * H);
    // 0° bis 40° Ost, 0° bis 30° Nord: vier Zellen breit, drei hoch.
    fillRing(mask, W, H, [0, 0, 40, 0, 40, 30, 0, 30], 1);
    expect(count(mask)).toBe(12);
    expect(mask[cell(5, 5)]).toBe(1);
    expect(mask[cell(35, 25)]).toBe(1);
    expect(mask[cell(45, 5)]).toBe(0);
    expect(mask[cell(5, -5)]).toBe(0);
  });

  it('nimmt Gewässer wieder heraus und kommt mit der Datumsgrenze zurecht', () => {
    const land = {
      id: 'probe',
      rings: [[160, -20, -160, -20, -160, 20, 160, 20]],
      holes: [[170, -10, -170, -10, -170, 10, 170, 10]],
    };
    const mask = landCells(land, W, H);
    // Vier Zellen breit, vier hoch – minus zwei mal zwei in der Mitte.
    expect(count(mask)).toBe(12);
    expect(mask[cell(165, 15)]).toBe(1);
    expect(mask[cell(-165, -15)]).toBe(1);
    expect(mask[cell(175, 5)]).toBe(0);
    expect(mask[cell(0, 0)]).toBe(0);
  });

  it('füllt um einen Pol herum', () => {
    const mask = new Uint8Array(W * H);
    fillRing(mask, W, H, [-180, -70, -90, -70, 0, -70, 90, -70], 1);
    // Die beiden südlichsten Zeilen ganz, sonst nichts.
    expect(count(mask)).toBe(2 * W);
    expect(mask[cell(123, -85)]).toBe(1);
    expect(mask[cell(123, -65)]).toBe(0);
  });
});

describe('Erzeugtes Gelände', () => {
  it('misst den Abstand zur Küste in Zellen', () => {
    const mask = new Uint8Array(W * H);
    fillRing(mask, W, H, [0, -20, 50, -20, 50, 30, 0, 30], 1);
    const distance = coastDistance(mask, W, H);
    expect(distance[cell(-5, 5)]).toBe(0);
    expect(distance[cell(5, 5)]).toBe(1);
    expect(distance[cell(25, 5)]).toBe(3);
  });

  it('ist an der Küste niedrig, im Inneren höher und immer dasselbe', () => {
    let coast = 0;
    let inland = 0;
    for (let lon = 0; lon < 60; lon += 1.7) {
      coast += generatedHeight(11, lon, 20, 20);
      inland += generatedHeight(11, lon, 20, 1500);
    }
    expect(inland).toBeGreaterThan(coast * 1.5);
    expect(generatedHeight(11, 12.5, 20, 20)).toBeGreaterThanOrEqual(40);
    expect(generatedHeight(11, 12.5, 20, 800)).toBe(generatedHeight(11, 12.5, 20, 800));
    expect(generatedHeight(12, 12.5, 20, 800)).not.toBe(generatedHeight(11, 12.5, 20, 800));
  });

  it('ergänzt nur, wo das Raster keine Höhe kennt', () => {
    const data = new Int16Array(W * H).fill(NODATA);
    data[cell(5, 5)] = 1234;
    const grid = { width: W, height: H, data };
    const land = { id: 'bild-probe', rings: [[0, 0, 40, 0, 40, 30, 0, 30]], holes: [] };
    const full = withGeneratedRelief(grid, [land], 6000);
    expect(full).not.toBe(grid);
    expect(full.data[cell(5, 5)]).toBe(1234);
    expect(full.data[cell(25, 15)]).toBeGreaterThan(0);
    expect(full.data[cell(45, 5)]).toBe(NODATA);
    // Das alte Raster bleibt unberührt; ohne Landmassen kommt dasselbe zurück.
    expect(grid.data[cell(25, 15)]).toBe(NODATA);
    expect(withGeneratedRelief(grid, [], 6000)).toBe(grid);
    expect([...withGeneratedRelief(grid, [land], 6000).data]).toEqual([...full.data]);
  });
});
