/**
 * Vorschläge wegklicken: Wayfarer schlägt vor, der Spielleiter entscheidet – auch, dass ein
 * Vorschlag nicht passt. Was er wegklickt, steht mit seinem Schlüssel in `state.dismissed` und
 * bleibt weg, bis er es in den Einstellungen zurückholt. Ein Schlüssel nennt die Sorte und das,
 * worum es geht (nie einen Text, der sich ändern kann). Reine Rechnung.
 */
import type { CampaignData } from './schema';

/** Die Schlüssel der Vorschläge – eine Stelle, damit dieselbe Sache überall gleich heißt. */
export const SUGGESTION = {
  /** Ein loser Faden könnte zu einer Geschichte passen (Fadenbrett, Blatt der Geschichte). */
  fit: (threadId: string, storyId: string) => `fit:${threadId}:${storyId}`,
  /** Am Spieltisch: Geschichte oder Faden berührt den Ort der Gruppe. */
  here: (cardKey: string, placeId: string) => `here:${cardKey}:${placeId}`,
  /** Ein Ort sieht aus wie ein Raum. */
  room: (placeId: string) => `room:${placeId}`,
  /** Ein Beruf, den Wayfarer im Text gefunden hat. */
  profession: (name: string) => `profession:${name.trim().toLocaleLowerCase('de')}`,
  /** Familien aus Nachnamen anlegen. */
  family: (name: string) => `family:${name.trim().toLocaleLowerCase('de')}`,
  /** Abend vorbereiten: was die Karten der Geschichten und der Welt anbieten. */
  prep: (sort: string, id: string) => `prep:${sort}:${id}`,
  /** Zwei Fäden könnten zusammengehören (gleicher Ort, gleicher Name) – gleich in welcher Folge. */
  tie: (a: string, b: string) => `tie:${[a, b].sort().join(':')}`,
  /** Eine Fraktion und eine Familie könnten dasselbe Haus sein („Haus Orvyndra“ / „Orvyndra“). */
  house: (factionId: string, familyId: string) => `house:${factionId}:${familyId}`,
  /** Eine Leitfrage am Rand einer Seite (`KIND_QUESTIONS`) – je Kategorie und Frage. */
  question: (kind: string, question: string) => `question:${kind}:${question}`,
} as const;

export function isDismissed(data: Pick<CampaignData, 'state'>, key: string): boolean {
  return data.state.dismissed.includes(key);
}

/** Nur, was nicht weggeklickt ist. */
export function withoutDismissed<T>(
  data: Pick<CampaignData, 'state'>,
  items: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  if (!data.state.dismissed.length) return [...items];
  const gone = new Set(data.state.dismissed);
  return items.filter((item) => !gone.has(keyOf(item)));
}

/** Die Sorten in Worten – für die Einstellungen („3 bei Geschichten …“). */
export const SUGGESTION_SORTS: Record<string, string> = {
  fit: 'Fäden, die zu einer Geschichte passen könnten',
  here: 'Geschichten und Fäden am Ort der Gruppe',
  room: 'Orte, die wie ein Raum aussehen',
  profession: 'Berufe aus dem Text',
  family: 'Familien aus Nachnamen',
  prep: 'Angebote beim Vorbereiten eines Abends',
  tie: 'Fäden, die sich verbinden ließen',
  house: 'Fraktionen und Familien, die dasselbe Haus sein könnten',
  question: 'Leitfragen am Rand einer Seite',
};

/** Wie viele weggeklickte Vorschläge es je Sorte gibt. */
export function dismissedSorts(
  data: Pick<CampaignData, 'state'>,
): { sort: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const key of data.state.dismissed) {
    const sort = key.split(':')[0] ?? '';
    counts.set(sort, (counts.get(sort) ?? 0) + 1);
  }
  return [...counts].map(([sort, count]) => ({
    sort,
    label: SUGGESTION_SORTS[sort] ?? 'Weitere Vorschläge',
    count,
  }));
}
