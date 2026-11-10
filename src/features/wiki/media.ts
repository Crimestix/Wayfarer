/**
 * Welche Bilder die Kampagne braucht und das Holen auf diesen Rechner. Die Liste ist eine reine
 * Funktion des Spielstands; das Holen selbst geschieht über die Rust-Seite der installierten App.
 */
import { addLocalMedia, hasLocalMedia, mediaName } from '../../data/media';
import { mediaFetch } from '../../data/platform';
import type { CampaignData } from '../../domain/schema';
import { articleNodes } from './text';

/** Sammelt alle Bildadressen aus dem Inhalt eines Artikels (Knoten der Art „image“). */
function collectImages(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 96 || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const part of value) collectImages(part, into, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.type === 'image' && typeof record.url === 'string') into.add(record.url);
  for (const part of Object.values(record)) collectImages(part, into, depth + 1);
}

export interface MediaItem {
  url: string;
  /** Dateiname im Kampagnenordner. */
  name: string;
}

/**
 * Alle Bilder im Netz, auf die der Spielstand verweist: Kartenbilder, Banner und Bilder in
 * Artikeln, Porträts der Einträge. Jede Datei einmal, nach Namen geordnet.
 */
export function campaignImages(data: CampaignData): MediaItem[] {
  const urls = new Set<string>();
  for (const map of Object.values(data.maps)) if (map.image) urls.add(map.image);
  for (const entity of Object.values(data.entities)) if (entity.image) urls.add(entity.image);
  for (const article of Object.values(data.articles)) {
    if (article.banner) urls.add(article.banner);
    collectImages(articleNodes(data.articles, article), urls);
  }
  const byName = new Map<string, MediaItem>();
  for (const url of urls) {
    const name = mediaName(url);
    if (name && !byName.has(name)) byName.set(name, { url, name });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface FetchProgress {
  /** So viele Bilder sind erledigt (geholt oder fehlgeschlagen). */
  done: number;
  total: number;
  /** Zusammen geholte Datenmenge in Bytes. */
  bytes: number;
  failed: { item: MediaItem; reason: string }[];
}

/** Bilder, die gleichzeitig unterwegs sind – genug für Tempo, ohne den Ursprung zu bedrängen. */
const PARALLEL = 4;

/**
 * Holt die fehlenden Bilder in den Kampagnenordner, mehrere zugleich. Ein einzelner Fehlschlag
 * hält die übrigen nicht auf. `signal` bricht nach den laufenden Bildern ab.
 */
export async function fetchImages(
  root: string,
  items: readonly MediaItem[],
  onProgress: (progress: FetchProgress) => void,
  signal?: AbortSignal,
  fetchOne: (root: string, url: string, name: string) => Promise<number> = mediaFetch,
): Promise<FetchProgress> {
  const queue = items.filter((item) => !hasLocalMedia(item.name));
  const progress: FetchProgress = { done: 0, total: queue.length, bytes: 0, failed: [] };
  onProgress({ ...progress });
  let next = 0;
  const work = async () => {
    while (next < queue.length && !signal?.aborted) {
      const item = queue[next++]!;
      try {
        // Erst holen, dann zählen: Mehrere Bilder sind zugleich unterwegs.
        const size = await fetchOne(root, item.url, item.name);
        progress.bytes += size;
        addLocalMedia(item.name);
      } catch (error) {
        progress.failed.push({
          item,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      progress.done++;
      onProgress({ ...progress, failed: [...progress.failed] });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, work));
  return progress;
}

/** „310 MB“, „1,3 GB“ – Datenmengen für Menschen. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9)
    return `${(bytes / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6).toLocaleString('de-DE')} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3)).toLocaleString('de-DE')} KB`;
}
