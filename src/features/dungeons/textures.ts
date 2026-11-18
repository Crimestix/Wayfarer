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

const SOURCES = { acid, chasm, flag, ground, ice, lava, mud, rock, wall, water, wood };
export type TextureName = keyof typeof SOURCES;

const loaded: Partial<Record<TextureName, HTMLImageElement>> = {};
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
  }
  return () => {
    waiting.delete(onReady);
  };
}

/** Die Textur, wenn sie geladen ist. */
export const textureOf = (name: TextureName): HTMLImageElement | null => loaded[name] ?? null;
