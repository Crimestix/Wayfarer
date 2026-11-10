/**
 * Bilder der Kampagne auf diesem Rechner.
 *
 * Im Spielstand steht bei jedem Bild die Adresse, von der es stammt (etwa der Bildspeicher von
 * LegendKeeper). Ist das Bild in den Kampagnenordner geholt worden, zeigt Wayfarer die Datei von
 * dort – ohne Netz und unabhängig davon, ob es den Ursprung noch gibt. Welche Datei zu welcher
 * Adresse gehört, sagt allein der Name: der letzte Teil der Adresse.
 */
import { useSyncExternalStore } from 'react';
import { isDesktopApp, mediaAddress, mediaList } from './platform';

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,118}\.(png|jpe?g|webp|gif|avif)$/i;

/**
 * Der Dateiname, unter dem ein Bild im Kampagnenordner liegt – oder null, wenn die Adresse kein
 * Bild im Netz ist (etwa ein eingebettetes Bild) oder keinen brauchbaren Namen hat.
 */
export function mediaName(url: string | null | undefined): string | null {
  if (!url || !url.startsWith('https://')) return null;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const name = path.slice(path.lastIndexOf('/') + 1);
  return NAME.test(name) && !name.includes('..') ? name : null;
}

let local: ReadonlySet<string> = new Set();
let version = 0;
const listeners = new Set<() => void>();

const changed = () => {
  version++;
  listeners.forEach((listener) => listener());
};

/** Setzt die Liste der Bilder, die auf diesem Rechner liegen. */
export function setLocalMedia(names: Iterable<string>): void {
  local = new Set(names);
  changed();
}

/** Ein Bild ist gerade dazugekommen. */
export function addLocalMedia(name: string): void {
  if (local.has(name)) return;
  local = new Set(local).add(name);
  changed();
}

export const hasLocalMedia = (name: string): boolean => local.has(name);
export const localMediaCount = (): number => local.size;

/**
 * Die Adresse, unter der ein Bild jetzt zu laden ist: die Datei auf diesem Rechner, wenn sie da
 * ist, sonst die Adresse im Netz. `resolve` übersetzt einen Dateinamen in die Adresse der Datei.
 */
export function resolveMedia(
  url: string | null | undefined,
  have: ReadonlySet<string>,
  resolve: (name: string) => string,
): string | undefined {
  if (!url) return undefined;
  const name = mediaName(url);
  return name && have.has(name) ? resolve(name) : url;
}

/**
 * Gibt die Funktion zurück, die Bildadressen für die Anzeige auflöst. Als Hook, damit die
 * Anzeige nachzieht, sobald ein Bild geholt wurde.
 */
export function useMediaSrc(): (url: string | null | undefined) => string | undefined {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
  return (url) => resolveMedia(url, local, mediaAddress);
}

/** Anzahl der Bilder auf diesem Rechner; zieht nach, wenn welche dazukommen. */
export function useLocalMediaCount(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => local.size,
  );
}

/**
 * Liest beim Öffnen einer Kampagne, welche Bilder im Kampagnenordner liegen. In der Vorschau im
 * Browser gibt es keinen Ordner; dort kommen alle Bilder aus dem Netz.
 */
export async function loadLocalMedia(root: string): Promise<void> {
  if (!isDesktopApp()) return;
  try {
    setLocalMedia(await mediaList(root));
  } catch (error) {
    // Ohne die Liste bleibt alles beim Netz – die App läuft weiter.
    console.warn('Die Bilder im Kampagnenordner ließen sich nicht auflisten:', error);
  }
}
