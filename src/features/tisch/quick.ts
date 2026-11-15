/**
 * Die Mitschrift kann alles, was die Chronik kann: „/“ am Zeilenanfang wählt die Art, und was
 * Wayfarer im Satz erkennt (`recognizeEntry`), steht als Knopf darunter. Hier steht die
 * Rechnung dahinter – welche Arten es gibt, was ein Kürzel meint, wohin eine Art führt (eigener
 * Handgriff wie Ortswechsel oder Rast, sonst Festhalten) und ob ein Satz ohne Rückfrage
 * festgehalten werden kann.
 */
import { RECORD_GROUPS, type RecordChoice, type RecordInput } from '../../domain/chronicleKinds';
import { namesIn, recognizeEntry, type Recognized } from '../../domain/recognize';
import type { CampaignData } from '../../domain/schema';
import {
  choiceOfRecognized,
  emptyRecordDraft,
  partOf,
  prefillFromRefs,
  recordCheck,
  recordInputs,
  toggleRecognized,
  type RecordFieldsKind,
  type RecordPart,
} from '../chronik/recordDraft';

/** Eine Art der Kurzwahl: alle Wahlen des Festhaltens und dazu „Zauber“. */
export type QuickChoice = RecordChoice | 'spell';

export interface QuickOption {
  choice: QuickChoice;
  label: string;
  /** Weitere Wörter, unter denen man die Art findet („ort“ für Ortswechsel). */
  words: readonly string[];
}

const WORDS: Partial<Record<QuickChoice, readonly string[]>> = {
  travel: ['ort', 'reise', 'weiter', 'gehen'],
  attitude: ['haltung'],
  repute: ['ruf', 'fraktion'],
  loot: ['beute', 'schatz', 'gold'],
  trade: ['handel', 'kauf', 'kaufen', 'verkauf', 'laden'],
  fate: ['schicksal', 'tot', 'stirbt', 'gestorben'],
  fight: ['kampf'],
  rest: ['rast', 'schlaf', 'lager'],
  promise: ['abmachung', 'versprechen', 'deal'],
  job: ['auftrag'],
  rumor: ['gerücht'],
  meeting: ['begegnung', 'treffen', 'kennen'],
  decision: ['entscheidung'],
  quote: ['zitat', 'sagt'],
  condition: ['zustand', 'vergiftet', 'verflucht'],
  whereabouts: ['aufenthalt', 'wo'],
  discovery: ['entdeckung'],
  change: ['veränderung'],
  clue: ['hinweis'],
  reveal: ['aufgedeckt', 'geheimnis'],
  milestone: ['meilenstein', 'stufe'],
  wish: ['wunsch', 'spielerwunsch'],
  spell: ['zauber', 'konzentration', 'wirkt'],
  downtime: ['freie', 'zwischenzeit'],
  guess: ['vermutung'],
};

/** Alle Arten der Kurzwahl in der Reihenfolge des Festhaltens; „Zauber“ steht hinter „Kampf“. */
export const QUICK_OPTIONS: readonly QuickOption[] = RECORD_GROUPS.flatMap((group) =>
  group.choices.flatMap((info) => {
    const option: QuickOption = {
      choice: info.choice,
      label: info.label || choiceLabel(info.choice),
      words: WORDS[info.choice] ?? [],
    };
    return info.choice === 'fight'
      ? [option, { choice: 'spell' as const, label: 'Zauber', words: WORDS.spell! }]
      : [option];
  }),
);

function choiceLabel(choice: RecordChoice): string {
  switch (choice) {
    case 'loot':
      return 'Beute';
    case 'repute':
      return 'Ruf';
    case 'job':
      return 'Auftrag';
    case 'guess':
      return 'Vermutung';
    default:
      return choice;
  }
}

const fold = (text: string) =>
  text
    .toLocaleLowerCase('de')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/**
 * Eine Zeile, die mit „/“ beginnt: das Kürzel dahinter und der Rest. `typing` = es steht noch
 * kein Leerzeichen hinter dem Kürzel – die Auswahl ist offen.
 */
export function slashOf(text: string): { query: string; rest: string; typing: boolean } | null {
  if (!text.startsWith('/')) return null;
  const match = /^\/(\S*)(\s+)?([\s\S]*)$/.exec(text);
  if (!match) return null;
  return { query: match[1] ?? '', rest: match[3] ?? '', typing: match[2] === undefined };
}

/**
 * Die Arten zu einem Kürzel: Name oder ein Wort fängt so an, sonst steckt es im Namen. Ohne
 * Kürzel alle. Nie leer gefiltert ohne Grund – was nicht passt, steht nur nicht vorn.
 */
export function quickMatches(query: string): QuickOption[] {
  const q = fold(query.trim());
  if (!q) return [...QUICK_OPTIONS];
  const starts = (option: QuickOption) =>
    [option.label, ...option.words].some((word) =>
      fold(word)
        .split(/\s+/)
        .some((part) => part.startsWith(q)),
    );
  const inside = (option: QuickOption) => fold(option.label).includes(q);
  return [
    ...QUICK_OPTIONS.filter(starts),
    ...QUICK_OPTIONS.filter((option) => !starts(option) && inside(option)),
  ];
}

/** Die Art zu einem fertig getippten Kürzel („/ort Menzoberranzan“) – nur, wenn sie eindeutig ist. */
export function quickChoiceOf(query: string): QuickOption | null {
  const found = quickMatches(query);
  if (!query.trim() || !found.length) return null;
  const exact = found.find((option) =>
    [option.label, ...option.words].some((word) => fold(word) === fold(query)),
  );
  return exact ?? found[0]!;
}

/**
 * Wohin eine Art am Tisch führt. Ortswechsel, Rast, freie Zeit, Handel, Beute, Vermutung und
 * Zauber haben ihren eigenen Handgriff (die Zeit des Weges vergeht, der Laden öffnet sich …);
 * alles andere wird festgehalten – ohne Rückfrage, wenn nichts fehlt.
 */
export type QuickRoute =
  'move' | 'rest' | 'downtime' | 'shop' | 'loot' | 'guess' | 'spell' | 'record';

export function routeOf(choice: QuickChoice): QuickRoute {
  switch (choice) {
    case 'travel':
      return 'move';
    case 'rest':
      return 'rest';
    case 'downtime':
      return 'downtime';
    case 'trade':
      return 'shop';
    case 'loot':
      return 'loot';
    case 'guess':
      return 'guess';
    case 'spell':
      return 'spell';
    default:
      return 'record';
  }
}

/** Die Dinge, die ein Satz nennt: verknüpfte (@) und erkannte Namen der Welt. */
export function namedIn(data: CampaignData, text: string, refs: readonly string[]): string[] {
  const found = namesIn(data, text, refs).flatMap((hit) => (hit.id ? [hit.id] : []));
  return [...new Set([...refs, ...found])];
}

/**
 * Der Ort, den ein Satz für einen Ortswechsel nennt: der erste genannte Ort, sonst ein Ort,
 * dessen ganzer Name im Satz steht (ohne Groß/Klein – „zum Salzigen Raben“), der längste
 * zuerst. Nie ein ähnlicher Name.
 */
export function placeIn(data: CampaignData, text: string, refs: readonly string[]): string | null {
  const here = data.state.placeId;
  const named = namedIn(data, text, refs).find(
    (id) => data.entities[id]?.kind === 'place' && id !== here,
  );
  if (named) return named;
  const folded = ` ${fold(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  const whole = Object.values(data.entities)
    .filter((entity) => entity.kind === 'place' && entity.id !== here)
    .map((place) => ({
      id: place.id,
      key: fold(place.name)
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim(),
    }))
    .filter((place) => place.key.length >= 3 && folded.includes(` ${place.key} `))
    .sort((a, b) => b.key.length - a.key.length);
  return whole[0]?.id ?? null;
}

/** Kurze oder Lange Rast – lang, außer der Satz sagt „kurz“. */
export const restKindIn = (text: string): 'short' | 'long' =>
  /\bkurze?n?\b/i.test(text) ? 'short' : 'long';

export type QuickPlan =
  /** Nichts fehlt: so festhalten. */
  | { direct: RecordInput[]; parts: RecordPart[]; refs: string[] }
  /** Es fehlt etwas: „Festhalten“ mit dieser Art und diesen Angaben öffnen. */
  | { direct: null; parts: RecordPart[]; refs: string[] };

/**
 * Was aus einem Satz der Mitschrift mit gewählter Art (oder übernommenem Vorschlag) wird. Wer
 * gemeint ist, kommt aus einem passenden Vorschlag, sonst aus den genannten Namen – nur, wenn
 * genau einer passt (`prefillFromRefs`), nie geraten.
 */
export function quickPlan(
  data: CampaignData,
  input: { text: string; refs: readonly string[] },
  pick: { choice: RecordFieldsKind } | { recognized: Recognized },
): QuickPlan {
  const refs = namedIn(data, input.text, input.refs);
  let parts: RecordPart[];
  let extra: string[] = [];
  if ('recognized' in pick) {
    const taken = toggleRecognized([partOf('note')], pick.recognized);
    parts = taken.parts;
    extra = taken.refs;
  } else {
    const fitting = recognizeEntry(data, input.text, { refs: [...input.refs] }).filter(
      (item) => choiceOfRecognized(item) === pick.choice,
    );
    if (fitting.length === 1) {
      const taken = toggleRecognized([partOf('note')], fitting[0]!);
      parts = taken.parts;
      extra = taken.refs;
    } else parts = [partOf(pick.choice, emptyRecordDraft())];
  }
  const allRefs = [...new Set([...refs, ...extra])];
  // In der Mitschrift handeln meist die Gefährten („weil Corrin ihm geholfen hat“) – gemeint ist
  // der andere. Passt ohne Gefährten genau einer, ist er es; sonst bleibt das Feld leer.
  const others = allRefs.filter((id) => data.entities[id]?.kind !== 'character');
  parts = parts.map((part) => {
    const first = prefillFromRefs(data, part.choice, part.draft, allRefs);
    return {
      ...part,
      draft: first.whoId ? first : prefillFromRefs(data, part.choice, part.draft, others),
    };
  });
  const common = { text: input.text, refs: allRefs, secret: false };
  const check = recordCheck(data, parts, common);
  return check.problem
    ? { direct: null, parts, refs: allRefs }
    : { direct: recordInputs(parts, common, data.state.now), parts, refs: allRefs };
}

/** Füllwörter eines Ortswechsels, die ohne Ort nichts sagen („nach“, „weiter zum“). */
const MOVE_FILLER =
  /^(?:(?:wir|sie|die gruppe|gehen|geht|ziehen|zieht|reisen|reist|laufen|weiter|nach|zum|zur|zu|in|ins|richtung|hinüber|rüber|hin|zurück)\s*)*$/i;

/**
 * Was vom Satz eines Ortswechsels als Anmerkung bleibt: ohne den Namen des Ziels und ohne bloße
 * Füllwörter. „/ort Fischkai“ hat keine Anmerkung, „rüber zum Raben, die Wache folgt“ schon.
 */
export function moveNote(data: CampaignData, text: string, placeId: string | null): string {
  const clean = text.trim();
  const name = placeId ? (data.entities[placeId]?.name ?? '') : '';
  if (!name) return clean;
  const at = clean.toLocaleLowerCase('de').indexOf(name.toLocaleLowerCase('de'));
  const rest = at < 0 ? clean : `${clean.slice(0, at)} ${clean.slice(at + name.length)}`;
  const words = rest
    .replace(/[.,;:!]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return MOVE_FILLER.test(words) ? '' : clean;
}

/**
 * Was „/beute …“ schon sagt: Gold („30 Gold“, „30 GM“, „30 Goldstücke“) und, wenn genau ein
 * Gefährte genannt ist, wer es bekommt. Der Rest des Satzes ist „Was“. Nie geraten: Ohne Zahl
 * kein Gold, ohne eindeutigen Gefährten die Gruppe.
 */
export function lootPreset(
  data: CampaignData,
  text: string,
  refs: readonly string[],
): { text: string; gold: number | null; toId: string | null } {
  const match = /(\d+(?:[.,]\d+)?)\s*(?:Gold(?:stücke|münzen)?|GM)\b/i.exec(text);
  const gold = match ? Number(match[1]!.replace(',', '.')) : null;
  const rest = (match ? text.replace(match[0], ' ') : text)
    .replace(/\s+/g, ' ')
    .replace(/^[\s,:–-]+|[\s,:–-]+$/g, '')
    .trim();
  const mates = namedIn(data, text, refs).filter((id) => data.entities[id]?.kind === 'character');
  return {
    text: rest,
    gold: gold && Number.isFinite(gold) ? gold : null,
    toId: mates.length === 1 ? mates[0]! : null,
  };
}

/**
 * Was unter der Zeile der Mitschrift als Knopf steht: was `recognizeEntry` im Satz erkennt –
 * und für jede genannte Person, die die Gruppe noch nicht getroffen hat, „Begegnung: …“. Wer
 * mit der Gruppe spricht, ist ihr danach bekannt; der Spielleiter entscheidet mit einem Klick.
 */
export function quickSuggestions(
  data: CampaignData,
  text: string,
  refs: readonly string[],
): Recognized[] {
  if (!text.trim()) return [];
  const found = recognizeEntry(data, text, { refs: [...refs] });
  const met = new Set(found.filter((item) => item.kind === 'meeting').flatMap((item) => item.refs));
  const strangers = namedIn(data, text, refs).filter((id) => {
    const entity = data.entities[id];
    return entity?.kind === 'person' && !entity.person.met && !met.has(id);
  });
  const meetings: Recognized[] = strangers.map((id) => ({
    kind: 'meeting',
    label: `Begegnung: ${data.entities[id]!.name}`,
    payload: {},
    refs: [id],
    from: text.length,
    to: text.length,
  }));
  return [...found, ...meetings];
}
