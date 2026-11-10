/** Bild eines Gefährten: Datei lesen, im Browser verkleinern, als Data-URL zurückgeben. */
import { PORTRAIT_MAX, fitWithin } from './model';

interface Drawable {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function load(file: File): Promise<Drawable> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Manche Formate (z. B. SVG) kann createImageBitmap nicht; dann über ein Bildelement.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('Diese Datei lässt sich nicht als Bild lesen.');
  }
}

/**
 * Liest eine Bilddatei und verkleinert sie so, dass die längere Seite höchstens 512 Pixel misst.
 * Das Ergebnis ist klein genug, um im Kampagnenordner mitzureisen.
 */
export async function fileToPortrait(file: File): Promise<string> {
  if (file.type && !file.type.startsWith('image/')) throw new Error('Bitte eine Bilddatei wählen.');
  const image = await load(file);
  try {
    const size = fitWithin(image.width, image.height, PORTRAIT_MAX);
    if (!size.width || !size.height)
      throw new Error('Diese Datei lässt sich nicht als Bild lesen.');
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Das Bild konnte nicht verkleinert werden.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image.source, 0, 0, size.width, size.height);
    // WebP behält Transparenz und bleibt klein. Wo es fehlt, liefert der Browser PNG zurück;
    // dann lieber JPEG auf dunklem Grund, damit die Datei nicht unnötig groß wird.
    const webp = canvas.toDataURL('image/webp', 0.86);
    if (webp.startsWith('data:image/webp')) return webp;
    const flat = document.createElement('canvas');
    flat.width = size.width;
    flat.height = size.height;
    const flatCtx = flat.getContext('2d');
    if (!flatCtx) return webp;
    flatCtx.fillStyle =
      getComputedStyle(document.documentElement).getPropertyValue('--bg-1').trim() || 'black';
    flatCtx.fillRect(0, 0, size.width, size.height);
    flatCtx.drawImage(canvas, 0, 0);
    return flat.toDataURL('image/jpeg', 0.86);
  } finally {
    image.release();
  }
}
