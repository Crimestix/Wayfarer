/**
 * Die Texturen der Dungeonkarte: Stein, Fels, Wasser, Lava, Holz. Frei nutzbares Material
 * (Poly Haven, CC0), auf die Farben der Karte abgestimmt – siehe `ui/assets/dungeon/LIESMICH.md`.
 * Geladen wird einmal, wenn die erste Karte gezeichnet wird; bis dahin zeichnet die Karte mit
 * ihren Farben.
 */
import acid from '../../ui/assets/dungeon/acid.webp';
import chasm from '../../ui/assets/dungeon/chasm.webp';
import flag from '../../ui/assets/dungeon/flag.webp';
import ground from '../../ui/assets/dungeon/ground.webp';
import ice from '../../ui/assets/dungeon/ice.webp';
import lava from '../../ui/assets/dungeon/lava.webp';
import mud from '../../ui/assets/dungeon/mud.webp';
import rock from '../../ui/assets/dungeon/rock.webp';
import wall from '../../ui/assets/dungeon/wall.webp';
import water from '../../ui/assets/dungeon/water.webp';
import wood from '../../ui/assets/dungeon/wood.webp';
import thingChest from '../../ui/assets/dungeon/dinge/chest.webp';
import thingTable from '../../ui/assets/dungeon/dinge/table.webp';
import thingBed from '../../ui/assets/dungeon/dinge/bed.webp';
import thingCoffin from '../../ui/assets/dungeon/dinge/coffin.webp';
import thingAltar from '../../ui/assets/dungeon/dinge/altar.webp';
import thingPillar from '../../ui/assets/dungeon/dinge/pillar.webp';
import thingStatue from '../../ui/assets/dungeon/dinge/statue.webp';
import thingThrone from '../../ui/assets/dungeon/dinge/throne.webp';

const SOURCES = { acid, chasm, flag, ground, ice, lava, mud, rock, wall, water, wood };
export type TextureName = keyof typeof SOURCES;

/**
 * Gemalte Einzelbilder der Einrichtung, von oben gesehen und freigestellt (erzeugt, Herkunft in
 * `ui/assets/dungeon/LIESMICH.md`). Nicht jedes Ding hat eines – ohne Bild zeichnet die Karte
 * sein Zeichen.
 */
const THING_SOURCES = {
  chest: thingChest,
  table: thingTable,
  bed: thingBed,
  coffin: thingCoffin,
  altar: thingAltar,
  pillar: thingPillar,
  statue: thingStatue,
  throne: thingThrone,
} as const;
export type ThingImageName = keyof typeof THING_SOURCES;

const loaded: Partial<Record<TextureName, HTMLImageElement>> = {};
const loadedThings: Partial<Record<ThingImageName, HTMLImageElement>> = {};
const waiting = new Set<() => void>();
let started = false;

/** Lädt die Texturen (einmal) und ruft `onReady`, sobald eine weitere da ist. Gibt das Abmelden zurück. */
export function loadTextures(onReady: () => void): () => void {
  waiting.add(onReady);
  if (!started) {
    started = true;
    for (const [name, src] of Object.entries(SOURCES) as [TextureName, string][]) {
      const image = new Image();
      image.onload = () => {
        loaded[name] = image;
        for (const call of waiting) call();
      };
      image.src = src;
    }
    for (const [name, src] of Object.entries(THING_SOURCES) as [ThingImageName, string][]) {
      const image = new Image();
      image.onload = () => {
        loadedThings[name] = image;
        for (const call of waiting) call();
      };
      image.src = src;
    }
  }
  return () => {
    waiting.delete(onReady);
  };
}

/** Die Textur, wenn sie geladen ist. */
export const textureOf = (name: TextureName): HTMLImageElement | null => loaded[name] ?? null;

/** Das gemalte Bild eines Dings, wenn es eines gibt und es geladen ist. */
export const thingImageOf = (kind: string): HTMLImageElement | null =>
  loadedThings[kind as ThingImageName] ?? null;
