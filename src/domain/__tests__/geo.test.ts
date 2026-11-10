import { describe, expect, it } from 'vitest';
import {
  NODATA,
  along,
  bearingDeg,
  compass,
  daylightHours,
  destination,
  distanceKm,
  heightAt,
  inRing,
  ringBounds,
  simplifyRing,
  wrapLon,
  type HeightGrid,
} from '../geo';

/** Ein Planet mit 40 000 km Umfang – ein Grad am Äquator sind dann rund 111 km. */
const R = 40000 / (2 * Math.PI);
const at = (lon: number, lat: number) => ({ lon, lat });
const square = (west: number, south: number, east: number, north: number) => [
  west,
  south,
  east,
  south,
  east,
  north,
  west,
  north,
];

describe('Entfernung und Richtung', () => {
  it('misst über die Oberfläche', () => {
    expect(distanceKm(R, at(0, 0), at(90, 0))).toBeCloseTo(10000, 6);
    expect(distanceKm(R, at(0, 0), at(0, 90))).toBeCloseTo(10000, 6);
    expect(distanceKm(R, at(0, 90), at(0, -90))).toBeCloseTo(20000, 6);
    // Über die Datumsgrenze ist es kurz, nicht einmal um die Welt.
    expect(distanceKm(R, at(179, 0), at(-179, 0))).toBeCloseTo((2 / 360) * 40000, 6);
    expect(distanceKm(R, at(12, 34), at(12, 34))).toBe(0);
  });

  it('nennt die Richtung beim Aufbruch', () => {
    expect(bearingDeg(at(0, 0), at(0, 10))).toBeCloseTo(0, 6);
    expect(bearingDeg(at(0, 0), at(10, 0))).toBeCloseTo(90, 6);
    expect(bearingDeg(at(0, 0), at(0, -10))).toBeCloseTo(180, 6);
    expect(bearingDeg(at(179, 0), at(-179, 0))).toBeCloseTo(90, 6);
    expect(compass(0)).toBe('Norden');
    expect(compass(50)).toBe('Nordosten');
    expect(compass(350)).toBe('Norden');
    expect(compass(-90)).toBe('Westen');
  });

  it('findet das Ziel einer Strecke und Punkte unterwegs', () => {
    const goal = destination(R, at(10, 0), 90, 1000);
    expect(goal.lat).toBeCloseTo(0, 6);
    expect(goal.lon).toBeCloseTo(10 + 9, 6);
    // Hin und zurück gemessen stimmt die Strecke.
    const far = destination(R, at(-30, 40), 123, 2500);
    expect(distanceKm(R, at(-30, 40), far)).toBeCloseTo(2500, 6);
    const middle = along(at(0, 0), at(90, 0), 0.5);
    expect(middle.lon).toBeCloseTo(45, 6);
    expect(middle.lat).toBeCloseTo(0, 6);
    expect(along(at(170, 0), at(-170, 0), 0.5).lon).toBeCloseTo(-180, 6);
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-540)).toBe(-180);
  });
});

describe('Land oder Wasser', () => {
  it('prüft, ob eine Lage in einem Ring liegt', () => {
    const land = square(10, 20, 30, 40);
    expect(inRing(land, at(20, 30))).toBe(true);
    expect(inRing(land, at(5, 30))).toBe(false);
    expect(inRing(land, at(20, 45))).toBe(false);
    expect(ringBounds(land)).toMatchObject({
      south: 20,
      north: 40,
      lon: 20,
      halfWidth: 10,
      polar: null,
    });
  });

  it('kommt mit der Datumsgrenze zurecht', () => {
    const land = square(170, -10, -170, 10);
    expect(ringBounds(land)).toMatchObject({ lon: -180, halfWidth: 10, polar: null });
    expect(inRing(land, at(179, 0))).toBe(true);
    expect(inRing(land, at(-175, 5))).toBe(true);
    expect(inRing(land, at(160, 0))).toBe(false);
    expect(inRing(land, at(0, 0))).toBe(false);
  });

  it('kennt Ringe um die Pole', () => {
    const north = [-180, 70, -90, 72, 0, 70, 90, 72];
    const south = [-180, -70, 90, -72, 0, -70, -90, -72];
    expect(ringBounds(north).polar).toBe('north');
    expect(ringBounds(south).polar).toBe('south');
    expect(inRing(north, at(45, 85))).toBe(true);
    expect(inRing(north, at(45, 60))).toBe(false);
    expect(inRing(south, at(-120, -85))).toBe(true);
    expect(inRing(south, at(-120, -60))).toBe(false);
  });

  it('vereinfacht Küsten, ohne ihre Gestalt zu verlieren', () => {
    // Ein Quadrat mit vielen Zwischenpunkten auf den Kanten und einer kleinen Zacke.
    const ring: number[] = [];
    for (let x = 0; x <= 10; x++) ring.push(x, 0);
    for (let y = 1; y <= 10; y++) ring.push(10, y);
    for (let x = 9; x >= 0; x--) ring.push(x, x === 5 ? 10.004 : 10);
    for (let y = 9; y >= 1; y--) ring.push(0, y);
    const simple = simplifyRing(ring, 0.01);
    expect(simple).toEqual([0, 0, 10, 0, 10, 10, 0, 10]);
    // Feiner hingesehen bleibt die Zacke.
    expect(simplifyRing(ring, 0.001).length).toBeGreaterThan(8);
    expect(inRing(simple, at(5, 5))).toBe(true);
  });
});

describe('Höhe', () => {
  const grid: HeightGrid = {
    width: 4,
    height: 2,
    // Nordhalbkugel 100 … 400 m, Südhalbkugel ohne Angabe bis auf eine Zelle.
    data: Int16Array.from([100, 200, 300, 400, NODATA, NODATA, 1000, NODATA]),
  };

  it('liest die Höhe an einer Lage, zwischen den Zellen gemittelt', () => {
    // Zellmitten: Länge −135, −45, 45, 135; Breite 45 und −45.
    expect(heightAt(grid, at(-135, 45))).toBeCloseTo(100, 6);
    expect(heightAt(grid, at(-90, 45))).toBeCloseTo(150, 6);
    // Über die Datumsgrenze hinweg wird weiter gemittelt.
    expect(heightAt(grid, at(180, 45))).toBeCloseTo(250, 6);
    // Ohne Angabe: null; am Rand zählt nur, was es gibt.
    expect(heightAt(grid, at(-135, -45))).toBeNull();
    expect(heightAt(grid, at(45, -45))).toBeCloseTo(1000, 6);
    expect(heightAt(grid, at(45, 0))).toBeCloseTo(650, 6);
  });
});

describe('Tageslänge', () => {
  it('folgt Breite, Jahreszeit und Achsneigung', () => {
    // Zur Tagundnachtgleiche überall zwölf Stunden.
    expect(daylightHours(0, 28, 0)).toBeCloseTo(12, 6);
    expect(daylightHours(60, 28, 0)).toBeCloseTo(12, 6);
    expect(daylightHours(-45, 28, 0.5)).toBeCloseTo(12, 6);
    // Zur Sommersonnenwende im Norden lang, im Süden kurz – und spiegelbildlich.
    const summer = daylightHours(45, 28, 0.25);
    const winter = daylightHours(45, 28, 0.75);
    expect(summer).toBeGreaterThan(15);
    expect(summer + winter).toBeCloseTo(24, 6);
    expect(daylightHours(-45, 28, 0.25)).toBeCloseTo(winter, 6);
    // Am Äquator bleibt es bei zwölf Stunden; jenseits des Polarkreises gibt es Tag ohne Nacht.
    expect(daylightHours(0, 28, 0.25)).toBeCloseTo(12, 6);
    expect(daylightHours(75, 28, 0.25)).toBe(24);
    expect(daylightHours(75, 28, 0.75)).toBe(0);
    // Mit stärkerer Neigung sind die Unterschiede größer.
    expect(daylightHours(45, 28, 0.25)).toBeGreaterThan(daylightHours(45, 10, 0.25));
  });
});
