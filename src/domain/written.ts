/**
 * Namen im geschriebenen Text eines Blatts (Geschichte, Abend): wer genannt ist, aber noch nicht
 * dazugehört – und Eigennamen, die es in der Welt noch nicht gibt. Die Welt wächst aus der
 * Geschichte: Wayfarer zeigt nur, was im Text steht; dazunehmen und anlegen tut der Spielleiter.
 * Bekannte Namen folgen den Regeln des Erkennens (`namesIn`), unbekannte denen des Nachtragens
 * (`unknownNames`) – nie einem eigenen Muster.
 */
import { foldName, unknownNames } from './readNames';
import { namesIn } from './recognize';
import type { CampaignData, Entity, EntityKind } from './schema';

/** Wer auf einem Blatt als „genannt“ gilt: Leute, Orte, Gruppen und Dinge – keine Begriffe. */
export const WRITTEN_KINDS: readonly EntityKind[] = [
  'person',
  'character',
  'place',
  'faction',
  'family',
  'item',
];

/** Mehr zeigt die Zeile unter dem Feld nicht – sie soll ruhig bleiben. */
export const WRITTEN_KNOWN = 6;
export const WRITTEN_UNKNOWN = 4;

export interface UnknownName {
  /** Woran der Name wiedererkannt wird (für „nicht gemeint“). */
  key: string;
  /** Wie er im Text steht. */
  name: string;
}

export interface WrittenNames {
  /** Einträge der Welt, die im Text genannt, aber noch nicht angeheftet sind – wie sie vorkommen. */
  known: Entity[];
  /** Eigennamen, die mehrfach oder eindeutig als Name dastehen und in der Welt fehlen. */
  unknown: UnknownName[];
}

/**
 * Was der Text nennt. `attachedIds` – was schon dazugehört (macht auch mehrdeutige Namen
 * eindeutig); `ignored` – was der Spielleiter weggeklickt hat: Kennungen von Einträgen und
 * unbekannte Namen. Mehrdeutige Namen zählen nicht.
 */
export function writtenNames(
  data: CampaignData,
  texts: readonly string[],
  attachedIds: readonly string[],
  ignored: readonly string[] = [],
  kinds: readonly EntityKind[] = WRITTEN_KINDS,
): WrittenNames {
  const written = texts.filter((text) => text.trim());
  if (!written.length) return { known: [], unknown: [] };
  const skip = new Set(ignored);
  const skipNames = new Set(ignored.map(foldName));
  const attached = new Set(attachedIds);

  const known: Entity[] = [];
  for (const text of written)
    for (const hit of namesIn(data, text, attachedIds)) {
      if (!hit.id || attached.has(hit.id) || skip.has(hit.id)) continue;
      const entity = data.entities[hit.id];
      if (!entity || !kinds.includes(entity.kind) || known.includes(entity)) continue;
      known.push(entity);
    }

  const unknown = unknownNames(
    data,
    written.map((text, line) => ({ text, line })),
    [],
    WRITTEN_UNKNOWN + skipNames.size,
    true,
  )
    .filter((entry) => !skipNames.has(entry.key))
    .slice(0, WRITTEN_UNKNOWN)
    .map(({ key, name }) => ({ key, name }));

  return { known: known.slice(0, WRITTEN_KNOWN), unknown };
}
