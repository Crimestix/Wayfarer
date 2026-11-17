/**
 * Testmodus: Beim Einschalten legt Wayfarer den ganzen Spielstand beiseite, beim Ausschalten
 * stellt es ihn wieder her – was dazwischen angelegt, geändert oder gelöscht wurde, ist weg.
 * Zum Ausprobieren in der echten Welt, mit allen Artikeln. (Wunsch des Spielleiters, 18. 11. 2026;
 * darf später wieder entfallen.)
 *
 * Hier steht nur die Rechnung: den Stand in Dateien zerlegen und wieder zusammensetzen. Die
 * Dateien liegen oben im Kampagnenordner und passen bewusst nicht auf das Muster des Abgleichs
 * (`isSyncedPath`) – sie verlassen diesen Rechner nie.
 */
import {
  COLLECTION_NAMES,
  emptyCollections,
  type CampaignData,
  type CampaignMeta,
  type CollectionName,
  type PlayState,
} from './schema';

export const TEST_FORMAT = 'wayfarer-testmodus';

/** Das Zeichen, dass der Testmodus läuft – zuletzt geschrieben, zuerst entfernt. */
export const TEST_MANIFEST = 'testmodus.json';

/** Der n-te Teil des beiseitegelegten Stands (ab 0). */
export const testPartPath = (index: number): string =>
  `testmodus-${String(index + 1).padStart(4, '0')}.json`;

/** So viele Zeichen fasst ein Teil ungefähr – weit unter der Grenze einer Datei der Ablage. */
export const PART_CHARS = 2_000_000;

export interface TestManifest {
  format: typeof TEST_FORMAT;
  version: 1;
  /** Echte Zeit, zu der der Testmodus eingeschaltet wurde. */
  startedAt: string;
  /** Aus so vielen Teilen besteht der Stand. */
  parts: number;
  campaign: CampaignMeta;
  state: PlayState;
}

export interface TestFiles {
  manifest: string;
  parts: string[];
}

/** Zerlegt den Spielstand in das Zeichen und seine Teile. */
export function snapshotFiles(
  data: CampaignData,
  startedAt: string,
  limit: number = PART_CHARS,
): TestFiles {
  const parts: string[] = [];
  let pieces: string[] = [];
  let size = 0;
  const close = () => {
    if (!pieces.length) return;
    parts.push(`{"format":"${TEST_FORMAT}","docs":[${pieces.join(',')}]}`);
    pieces = [];
    size = 0;
  };
  for (const name of COLLECTION_NAMES) {
    const ids = Object.keys(data[name]).sort();
    for (const id of ids) {
      const piece = JSON.stringify({ c: name, d: (data[name] as Record<string, unknown>)[id] });
      if (size > 0 && size + piece.length > limit) close();
      pieces.push(piece);
      size += piece.length;
    }
  }
  close();
  const manifest: TestManifest = {
    format: TEST_FORMAT,
    version: 1,
    startedAt,
    parts: parts.length,
    campaign: data.campaign,
    state: data.state,
  };
  return { manifest: JSON.stringify(manifest), parts };
}

const isObj = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Liest das Zeichen – null, wenn es keines ist. */
export function readManifest(text: string | null): TestManifest | null {
  if (text === null) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (!isObj(raw) || raw.format !== TEST_FORMAT) return null;
    if (typeof raw.parts !== 'number' || !isObj(raw.campaign) || !isObj(raw.state)) return null;
    return raw as unknown as TestManifest;
  } catch {
    return null;
  }
}

/**
 * Setzt den beiseitegelegten Stand wieder zusammen. Wirft mit einem deutschen Satz, wenn ein Teil
 * fehlt oder unlesbar ist – dann bleibt alles, wie es ist. Geprüft wird der Stand beim Einsetzen
 * (`db.replaceAll`).
 */
export function joinSnapshot(
  manifestText: string | null,
  partTexts: readonly (string | null)[],
): CampaignData {
  const manifest = readManifest(manifestText);
  if (!manifest)
    throw new Error(
      'Der Stand von vor dem Testmodus ist nicht mehr lesbar. Es wurde nichts geändert.',
    );
  if (partTexts.length !== manifest.parts || partTexts.some((text) => text === null))
    throw new Error('Vom Stand von vor dem Testmodus fehlt ein Teil. Es wurde nichts geändert.');
  const collections = emptyCollections() as Record<CollectionName, Record<string, unknown>>;
  for (const text of partTexts) {
    let raw: unknown;
    try {
      raw = JSON.parse(text!);
    } catch {
      throw new Error(
        'Ein Teil des Stands von vor dem Testmodus ist unlesbar. Es wurde nichts geändert.',
      );
    }
    if (!isObj(raw) || raw.format !== TEST_FORMAT || !Array.isArray(raw.docs))
      throw new Error(
        'Ein Teil des Stands von vor dem Testmodus ist unlesbar. Es wurde nichts geändert.',
      );
    for (const entry of raw.docs) {
      if (!isObj(entry) || typeof entry.c !== 'string' || !isObj(entry.d)) continue;
      const name = entry.c as CollectionName;
      if (!COLLECTION_NAMES.includes(name) || typeof entry.d.id !== 'string') continue;
      collections[name][entry.d.id] = entry.d;
    }
  }
  return {
    campaign: manifest.campaign,
    state: manifest.state,
    ...collections,
  } as unknown as CampaignData;
}
