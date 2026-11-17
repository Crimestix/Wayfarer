/**
 * Was die Fäden auf dem Brett sagen (Konzeptbesprechung 16. 11.: „Die Wörter an den Fäden darf
 * Wayfarer verstehen“; Wunsch 17. 11.: vom Fadenbrett aus zu einer spielbaren Geschichte). Wayfarer
 * liest drei Sorten von Wörtern – nie mehr, und ein Faden ohne Wort bleibt eine Schnur:
 *
 * - **liegt in** („liegt in“, „versteckt bei“, „zu finden in“ …): ein Ding liegt an einem Ort. Am
 *   Spieltisch steht es dort unter „Hier zu finden“.
 * - **weiß von** („weiß von“, „kennt“, „hat gesehen“, „belauscht“ …): jemand weiß etwas. Steht er
 *   bei der Gruppe, zeigt der Spieltisch, wovon er weiß.
 * - **führt zu** (das Wort oder ein Pfeil ohne Wort): eine Spur. Daraus zählt Wayfarer, auf wie
 *   vielen Wegen die Gruppe zum Kern einer Geschichte kommt.
 *
 * Reine Funktionen über `state.boardLinks`; ohne Abhängigkeit von `story.ts`, damit der Stand einer
 * Geschichte sie nutzen kann.
 */
import type { CampaignData, Entity } from './schema';

export type BoardFactKind = 'located' | 'knows' | 'leads';

export interface BoardFact {
  kind: BoardFactKind;
  /** Das Ding, das liegt / wer weiß / woher die Spur kommt (Schlüssel des Bretts). */
  from: string;
  /** Der Ort / was gewusst wird / wohin die Spur führt. */
  to: string;
  word: string;
  linkId: string;
}

/** Ein Muster aus Wörtern, das auch Umlaute und „ß“ als Teil eines Wortes kennt. */
const words = (list: string, start = '') =>
  new RegExp(`${start}(?<!\\p{L})(?:${list})(?!\\p{L})`, 'iu');
const LOCATED_WORDS = words(
  'liegt|liegen|steckt|stecken|versteckt|vergraben|verborgen|befindet|findet man|zu finden|wartet|bewahrt|aufbewahrt|gelagert|steht',
);
const LOCATED_START = /^(in|im|bei|beim|unter|auf|am)\s/iu;
const KNOWS = words(
  'weiß|wissen|wusste|kennt|kennen|kannte|ahnt|ahnte|hat gesehen|sah|gesehen|belauscht|belauschte|erzählt|verrät|verriet|hat gehört|hörte|erinnert',
);
const LEADS = words('führt|führen|dann|danach|weiter zu|als nächstes');

const idOf = (key: string) => key.slice(key.indexOf(':') + 1);
const isPlaceKey = (data: Pick<CampaignData, 'entities'>, key: string) =>
  key.startsWith('node:') && data.entities[idOf(key)]?.kind === 'place';

/** Welche Sorte ein Wort an einem Faden meint – null, wenn Wayfarer es nicht versteht. */
export function factKindOf(word: string): BoardFactKind | null {
  const clean = word.trim();
  if (!clean) return null;
  if (LEADS.test(clean)) return 'leads';
  if (KNOWS.test(clean)) return 'knows';
  if (LOCATED_WORDS.test(clean) || LOCATED_START.test(`${clean} `)) return 'located';
  return null;
}

/**
 * Was die Fäden sagen – auf dem ganzen Brett oder nur zwischen den Schlüsseln in `keys` (ein
 * Rahmen). „liegt in“ dreht Wayfarer so, dass der Ort am Ende steht; ein Pfeil ohne Wort ist eine
 * Spur „führt zu“, eine Schnur ohne Richtung und ohne Wort sagt nichts.
 */
export function boardFacts(
  data: Pick<CampaignData, 'state' | 'entities'>,
  keys: ReadonlySet<string> | null = null,
): BoardFact[] {
  const out: BoardFact[] = [];
  for (const link of data.state.boardLinks) {
    if (keys && !(keys.has(link.a) && keys.has(link.b))) continue;
    const word = link.word.trim();
    const kind = factKindOf(word) ?? (!word && link.dir === 'to' ? 'leads' : null);
    if (!kind) continue;
    let [from, to] = [link.a, link.b];
    if (kind === 'located' && isPlaceKey(data, from) && !isPlaceKey(data, to))
      [from, to] = [to, from];
    out.push({ kind, from, to, word, linkId: link.id });
  }
  return out;
}

/**
 * Was an einem Ort zu finden ist, laut Brett: alles, was mit „liegt in“ an ihm hängt – auch an
 * seinen Räumen. In der Reihenfolge der Fäden.
 */
export function foundAt(
  data: Pick<CampaignData, 'state' | 'entities'>,
  placeId: string,
): BoardFact[] {
  const here = new Set([placeId]);
  for (const entity of Object.values(data.entities))
    if (entity.kind === 'place' && entity.place.room && entity.place.parentId === placeId)
      here.add(entity.id);
  return boardFacts(data).filter((fact) => fact.kind === 'located' && here.has(idOf(fact.to)));
}

/** Wovon jemand weiß, laut Brett („weiß von“, „kennt“ …). */
export function knownBy(
  data: Pick<CampaignData, 'state' | 'entities'>,
  entityId: string,
): BoardFact[] {
  return boardFacts(data).filter(
    (fact) => fact.kind === 'knows' && fact.from === `node:${entityId}`,
  );
}

/**
 * Wie viele verschiedene Fäden zum Kern führen: jede Spur, jedes Wissen und jedes Ding, das mit
 * einem verstandenen Wort am Kern hängt – je Ausgangspunkt einmal.
 */
export function leadsInto(facts: readonly BoardFact[], core: string): number {
  const sources = new Set<string>();
  for (const fact of facts) {
    if (fact.to === core && fact.from !== core) sources.add(fact.from);
    // „liegt in“ zählt auch, wenn der Kern der Ort ist, an dem etwas liegt.
  }
  return sources.size;
}

/** Ist das ein Eintrag der Welt auf dem Brett? Gibt ihn zurück. */
export function entityOfKey(data: Pick<CampaignData, 'entities'>, key: string): Entity | null {
  return key.startsWith('node:') ? (data.entities[idOf(key)] ?? null) : null;
}

/** Wie Wayfarer ein Wort an einem Faden liest – in Worten für das Menü der Schnur. */
export const FACT_LABEL: Record<BoardFactKind, string> = {
  located: '„liegt in“ – am Spieltisch steht es an diesem Ort unter „Hier zu finden“',
  knows: '„weiß von“ – ist er bei der Gruppe, zeigt der Spieltisch, wovon er weiß',
  leads: '„führt zu“ – eine Spur; sie zählt für den Weg zum Kern einer Geschichte',
};
