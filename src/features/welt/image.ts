/** Bild eines Eintrags: Datei lesen, im Browser verkleinern, als Data-URL zurückgeben. */
import { fitWithin } from './model';

/** Längste Kante eines gespeicherten Bildes in Pixeln. */
export const IMAGE_MAX_EDGE = 512;

/**
 * Liest eine Bilddatei und verkleinert sie auf höchstens 512 Pixel Kantenlänge. So bleibt die
 * Datei des Eintrags klein genug, um im Kampagnenordner mitzureisen.
 */
export async function fileToImage(file: File): Promise<string> {
  if (file.type && !file.type.startsWith('image/')) throw new Error('Bitte eine Bilddatei wählen.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error('Diese Datei lässt sich nicht als Bild lesen.');
    }
    const size = fitWithin(img.naturalWidth, img.naturalHeight, IMAGE_MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Das Bild konnte nicht verkleinert werden.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, size.width, size.height);
    // WebP bleibt klein und behält Transparenz. Wo es fehlt, liefert der Browser PNG zurück;
    // dann JPEG auf dunklem Grund.
    const webp = canvas.toDataURL('image/webp', 0.86);
    if (webp.startsWith('data:image/webp')) return webp;
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle =
      getComputedStyle(document.documentElement).getPropertyValue('--bg-1').trim() || 'black';
    ctx.fillRect(0, 0, size.width, size.height);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}
