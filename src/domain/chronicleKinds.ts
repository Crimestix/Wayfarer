/**
 * Die Arten der Chronik in Worten: Bezeichnungen, die fünf Gruppen des Festhaltens, kurze
 * Erklärungen, Kopfzeilen und die Bezeichnungen der Angaben (Ausgang, Stand eines Gerüchts …).
 * Reine Daten und Funktionen ohne React; die Icons stehen in `ui/chronicle.tsx`.
 */
import { entityName, type PromiseOutcome } from './derive';
import { conditionEnding, fateSince } from './history';
import { relationLabel } from './relations';
import {
  PARTY_ID,
  type CampaignData,
  type ChronicleEntry,
  type ChronicleKind,
  type ChroniclePrecision,
  type FightOutcome,
  type PersonStatus,
  type PromiseSort,
  type RumorTruth,
} from './schema';
import { formatDate, formatDayMonth, fromTime, type WorldTime } from './time/calendar';

/** Arten, die der Spielleiter festhält – alle außer dem automatisch eingetretenen Termin. */
export type RecordKind = Exclude<ChronicleKind, 'event'>;

export const isRecordKind = (kind: ChronicleKind): kind is RecordKind => kind !== 'event';

// ── Eingabe ────────────────────────────────────────────────────────────────

/**
 * Was festgehalten wird (`recordEntry` in `data/record.ts`). Nur die Angabe der gewählten Art
 * zählt; alles andere hat Vorgaben.
 */
export interface RecordInput {
  kind: RecordKind;
  text?: string;
  /** Vorgabe: jetzt. Nie in der Zukunft. */
  at?: WorldTime;
  /** undefined = die Session, in deren Weltzeit `at` fällt (jetzt: die laufende). */
  sessionId?: string | null;
  /** undefined = Ort der Gruppe zu dieser Zeit. Bei `discovery`: der entdeckte Ort. */
  placeId?: string | null;
  refs?: string[];
  /** Nur für die Spielleitung. */
  secret?: boolean;
  /** undefined = bei Hinweis und Aufgedecktem die Geschichte des Fadens bzw. Geheimnisses. */
  storyId?: string | null;
  /** undefined = nachgetragen, wenn `at` vor jetzt liegt. */
  backfilled?: boolean;
  precision?: ChroniclePrecision;

  travel?: { toId: string | null };
  attitude?: { fromId: string; toId: string; value: number | null };
  /** `sort: 'job'` = ein Auftrag an die Gruppe (Auftraggeber ist refs[0]). */
  promise?: { due?: WorldTime | null; outcome?: PromiseOutcome; sort?: PromiseSort };
  fight?: { outcome?: FightOutcome; encounterId?: string | null };
  rest?: { long: boolean };
  /** Für Personen und Gefährten. */
  fate?: { entityId: string; status: PersonStatus };
  whereabouts?: { entityId: string; placeId: string | null };
  rumor?: { sourceId?: string | null; truth?: RumorTruth };
  bond?: {
    fromId: string;
    toId: string;
    /** Schlüssel aus RELATION_TYPES; Vorgabe „knows“. */
    type?: string;
    label?: string;
    ended?: boolean;
    /** Die Beziehung, um die es geht; sonst die zwischen beiden mit dieser Art. */
    relationId?: string | null;
  };
  condition?: { entityId: string; ended?: boolean; endsId?: string | null };
  milestone?: { characterId: string; level?: number | null };
  wish?: { characterId: string; setGoal?: boolean };
  clue?: { threadId: string | null; hintId?: string | null };
  /**
   * `alias`: ein enthüllter wahrer Name oder Deckname, der als zweiter Name zum Eintrag kommt
   * (Wirkung: `entity.aliases`).
   */
  reveal?: { prepSecretId: string | null; alias?: { entityId: string; name: string } | null };
  /**
   * Schriftstück, wörtlich im Text. `articleId`: schon abgelegt als dieser Artikel.
   * `createArticle`: als Artikel im Ordner „Schriftstücke“ ablegen – das übernimmt
   * `recordFiled` in `features/chronik/actions.ts` (Artikel entstehen über `wiki/actions`).
   */
  writing?: { title?: string; articleId?: string | null; createArticle?: boolean };
  /** Zwischenzeit von `days` Tagen ab `at`; stellt nie die Weltzeit vor. */
  downtime?: { days: number; activities?: { characterId: string; text: string }[] };
  /** Wandlung eines Gefährten; der Text sagt, welche. */
  transformation?: { characterId: string };
  /** Ein Tier oder Wesen (Person) kommt zur Gruppe (`joined`) oder geht; `ownerId` = Gefährte. */
  companion?: { entityId: string; joined?: boolean; ownerId?: string | null };
}

// ── Arten ──────────────────────────────────────────────────────────────────

/** Name jeder Art, wie er in Listen, Filtern und am Eintrag steht. */
export const KIND_LABEL: Record<ChronicleKind, string> = {
  note: 'Notiz',
  travel: 'Ortswechsel',
  attitude: 'Haltung',
  event: 'Termin',
  promise: 'Abmachung',
  change: 'Veränderung',
  meeting: 'Begegnung',
  decision: 'Entscheidung',
  fight: 'Kampf',
  rest: 'Rast',
  quote: 'Zitat',
  fate: 'Schicksal',
  whereabouts: 'Aufenthalt',
  discovery: 'Entdeckung',
  rumor: 'Gerücht',
  lore: 'Weltwissen',
  bond: 'Beziehung',
  condition: 'Zustand',
  milestone: 'Meilenstein',
  wish: 'Spielerwunsch',
  clue: 'Hinweis gefunden',
  reveal: 'Aufgedeckt',
  knowledge: 'Wer was weiß',
  writing: 'Schriftstück',
  downtime: 'Zwischenzeit',
  transformation: 'Wandlung',
  companion: 'Begleiter',
};

/** Ein Satz je Art: was hierher gehört und was der Eintrag bewirkt. */
export const KIND_HINT: Record<RecordKind, string> = {
  note: 'Was am Tisch passiert ist.',
  meeting: 'Wen die Gruppe getroffen hat. Personen gelten danach als bekannt.',
  decision: 'Was die Gruppe entschieden hat.',
  fight: 'Gegen wen gekämpft wurde und wie es ausging.',
  rest: 'Eine Rast, nur als Eintrag – die Zeit bleibt stehen.',
  quote: 'Ein Satz, wörtlich – und wer ihn sagte.',
  change:
    'Etwas in der Welt hat sich verändert – erscheint bei den verknüpften Orten und Personen.',
  fate: 'Jemand ist tot, verschollen oder wieder aufgetaucht. Gilt auch für den Eintrag der Person.',
  whereabouts: 'Wo sich jemand nun aufhält. Gilt auch für den Eintrag der Person.',
  discovery: 'Ein Ort, den die Gruppe entdeckt hat.',
  rumor: 'Etwas, das man sich erzählt. Gilt nicht als Tatsache, bis es geprüft ist.',
  lore: 'Etwas, das am Tisch über die Welt festgelegt wurde.',
  promise: 'Ein Versprechen, eine Schuld oder ein Auftrag. Bleibt offen, bis du es abhakst.',
  attitude: 'Wie jemand nun zur Gruppe oder zu jemandem steht.',
  bond: 'Eine Beziehung beginnt oder endet.',
  travel: 'Die Gruppe ist an einen anderen Ort gezogen.',
  condition: 'Ein Zustand wie „Pfeil im Bein“ oder „verflucht“ – bis er aufgehoben wird.',
  milestone: 'Ein Meilenstein eines Gefährten, auf Wunsch mit neuer Stufe.',
  wish: 'Was ein Spieler für seinen Gefährten will.',
  clue: 'Die Gruppe hat einen Hinweis zu einem Faden gefunden.',
  reveal: 'Die Gruppe hat ein Geheimnis erfahren.',
  knowledge: 'Wer etwas erfahren hat – und was.',
  writing: 'Ein Brief, eine Botschaft, ein Aushang – wörtlich. Auf Wunsch auch als Artikel.',
  downtime:
    'Zeit vergeht mit Tätigkeiten der Gefährten. Nur der Eintrag – die Weltzeit bleibt stehen.',
  transformation: 'Ein Gefährte wandelt sich: neue Kräfte, neue Gestalt, ein verlorenes Glied …',
  companion: 'Ein Tier oder Wesen kommt zur Gruppe oder geht.',
};

/** Ein Satz zu den zweiten Eingängen des Festhaltens. */
export const CHOICE_HINT = {
  job: 'Ein Auftrag an die Gruppe – von wem, was. Bleibt offen, bis du ihn abhakst.',
  repute: 'Wie eine Fraktion zur Gruppe steht',
  loot: 'Öffnet die Ausgabe des Beute-Buchs',
} as const;

/**
 * Was man im Festhalten wählen kann: eine Art oder einer der zweiten Eingänge – „Beute“ (das
 * Beute-Buch), „Ruf“ (Haltung einer Fraktion) und „Auftrag“ (eine Abmachung der Sorte `job`).
 */
export type RecordChoice = RecordKind | 'loot' | 'repute' | 'job';

export interface RecordChoiceInfo {
  choice: RecordChoice;
  label: string;
}

export interface RecordGroup {
  id: 'table' | 'world' | 'people' | 'party' | 'secrets';
  label: string;
  choices: RecordChoiceInfo[];
}

const choice = (c: RecordChoice, label?: string): RecordChoiceInfo => ({
  choice: c,
  label: label ?? (c === 'loot' || c === 'repute' || c === 'job' ? '' : KIND_LABEL[c]),
});

/**
 * Die fünf Gruppen des Festhaltens. „Beute“ öffnet die Ausgabe des Beute-Buchs (keine eigene
 * Art), „Ruf“ ist die Haltung einer Fraktion zur Gruppe.
 */
export const RECORD_GROUPS: RecordGroup[] = [
  {
    id: 'table',
    label: 'Am Tisch',
    choices: [
      choice('note'),
      choice('meeting'),
      choice('decision'),
      choice('fight'),
      choice('rest'),
      choice('downtime'),
      choice('quote'),
    ],
  },
  {
    id: 'world',
    label: 'Die Welt',
    choices: [
      choice('change'),
      choice('fate'),
      choice('whereabouts'),
      choice('discovery'),
      choice('rumor'),
      choice('lore'),
    ],
  },
  {
    id: 'people',
    label: 'Zwischen Leuten',
    choices: [
      choice('promise'),
      choice('job', 'Auftrag'),
      choice('attitude'),
      choice('bond'),
      choice('repute', 'Ruf'),
    ],
  },
  {
    id: 'party',
    label: 'Die Gruppe',
    choices: [
      choice('travel'),
      choice('loot', 'Beute'),
      choice('condition'),
      choice('milestone'),
      choice('wish'),
      choice('transformation'),
      choice('companion'),
    ],
  },
  {
    id: 'secrets',
    label: 'Geheimnisse',
    choices: [choice('clue'), choice('reveal'), choice('knowledge'), choice('writing')],
  },
];

/**
 * Die Art hinter einer Wahl: „Ruf“ ist eine Haltung, „Auftrag“ eine Abmachung, „Beute“ keine
 * Art (null).
 */
export function kindOfChoice(c: RecordChoice): RecordKind | null {
  if (c === 'loot') return null;
  if (c === 'repute') return 'attitude';
  if (c === 'job') return 'promise';
  return c;
}

/** Ist der Eintrag ein Auftrag (eine Abmachung der Sorte `job`)? */
export const isJob = (entry: Pick<ChronicleEntry, 'kind' | 'promise'>): boolean =>
  entry.kind === 'promise' && entry.promise?.sort === 'job';

/** Name der Art eines Eintrags – „Auftrag“ statt „Abmachung“ bei einem Auftrag. */
export const entryKindLabel = (entry: Pick<ChronicleEntry, 'kind' | 'promise'>): string =>
  isJob(entry) ? 'Auftrag' : KIND_LABEL[entry.kind];

/** Tage in Worten: „1 Tag“, „6 Wochen“, „10 Tage“. */
export function daysLabel(days: number): string {
  if (days === 1) return '1 Tag';
  if (days >= 7 && days % 7 === 0) return days === 7 ? '1 Woche' : `${days / 7} Wochen`;
  return `${days} Tage`;
}

/** Alle Arten in der Reihenfolge der Gruppen, der automatische Termin zuletzt – für Filter. */
export const KIND_ORDER: ChronicleKind[] = [
  ...RECORD_GROUPS.flatMap((group) =>
    group.choices.map((c) => kindOfChoice(c.choice)).filter((k): k is RecordKind => k !== null),
  ).filter((kind, index, all) => all.indexOf(kind) === index),
  'event',
];

/** Die Gruppe, zu der eine Art gehört; null beim Termin. */
export function groupOfKind(kind: ChronicleKind): RecordGroup | null {
  return (
    RECORD_GROUPS.find((group) => group.choices.some((c) => kindOfChoice(c.choice) === kind)) ??
    null
  );
}

/**
 * Arten, die nur die Gruppe selbst betreffen (steht in `derive.ts`, weil `placeStatus` sie
 * braucht): Sie zählen nicht zu dem, was sich an einem Ort verändert hat.
 */
export { PARTY_KINDS } from './derive';

/** Geschehen in der Welt, das auch ohne die Gruppe passiert – für „Weltgeschehen“. */
export const WORLD_CHRONICLE_KINDS: readonly ChronicleKind[] = [
  'change',
  'event',
  'fate',
  'whereabouts',
];

/** Arten, deren Text wörtlich gilt und als Ganzes stehen bleibt (Zitat, Schriftstück). */
export const VERBATIM_KINDS: readonly ChronicleKind[] = ['quote', 'writing'];

// ── Angaben ────────────────────────────────────────────────────────────────

export const FIGHT_OUTCOME_LABEL: Record<FightOutcome, string> = {
  won: 'gewonnen',
  lost: 'verloren',
  fled: 'geflohen',
  truce: 'Waffenruhe',
  open: 'offen',
};

export const RUMOR_TRUTH_LABEL: Record<RumorTruth, string> = {
  unchecked: 'ungeprüft',
  true: 'stimmt',
  false: 'falsch',
};

/** Ein Schicksal in einem Wort, klein wie im Satz: „Krummzahn: tot“. */
export const FATE_LABEL: Record<PersonStatus, string> = {
  alive: 'lebt',
  dead: 'tot',
  missing: 'verschollen',
  unknown: 'ungewiss',
};

export const PRECISION_LABEL: Record<ChroniclePrecision, string> = {
  exact: 'genau',
  day: 'nur der Tag',
  approx: 'ungefähr',
  order: 'nur die Reihenfolge',
};

/** Ist der Zeitpunkt nur ungefähr bekannt? Dann steht in der Chronik „ungefähr“. */
export const isApproximate = (entry: Pick<ChronicleEntry, 'precision'>): boolean =>
  entry.precision === 'approx' || entry.precision === 'order';

// ── Kopfzeilen ─────────────────────────────────────────────────────────────

const names = (data: CampaignData, ids: string[]) =>
  ids
    .filter((id) => id === PARTY_ID || data.entities[id])
    .map((id) => entityName(data, id))
    .join(', ');

/** Verweise ohne den Ort des Geschehens. */
const others = (entry: ChronicleEntry) => entry.refs.filter((id) => id !== entry.placeId);

/**
 * Kurzfassung dessen, was ein Eintrag der neuen Arten bedeutet: „Krummzahn: tot“, „Kampf gegen
 * Krummzahn: gewonnen“. Leer bei Arten, die nur aus Text bestehen, und bei den sechs alten Arten
 * (deren Kopfzeile kommt aus `entryHeadline` in `features/chronik/model.ts`).
 */
export function recordHeadline(data: CampaignData, entry: ChronicleEntry): string {
  switch (entry.kind) {
    case 'meeting': {
      const who = names(data, others(entry));
      return who ? `Begegnung mit ${who}` : '';
    }
    case 'fight': {
      const against = names(data, others(entry));
      const outcome = entry.fight?.outcome ?? 'open';
      const head = against ? `Kampf gegen ${against}` : 'Kampf';
      return outcome === 'open' ? head : `${head}: ${FIGHT_OUTCOME_LABEL[outcome]}`;
    }
    case 'rest':
      return entry.rest?.long ? 'Lange Rast' : 'Kurze Rast';
    case 'quote': {
      const who = names(data, others(entry).slice(0, 1));
      return who ? `${who} sagte` : '';
    }
    case 'fate':
      return entry.fate
        ? `${entityName(data, entry.fate.entityId)}: ${FATE_LABEL[entry.fate.status]}`
        : '';
    case 'whereabouts': {
      if (!entry.whereabouts) return '';
      const { entityId, placeId } = entry.whereabouts;
      const where = placeId
        ? entityName(data, placeId)
        : data.entities[entityId]?.kind === 'character'
          ? 'wieder bei der Gruppe'
          : 'unbekannt';
      return `${entityName(data, entityId)} → ${where}`;
    }
    case 'discovery':
      return entry.placeId && data.entities[entry.placeId]
        ? `Entdeckt: ${entityName(data, entry.placeId)}`
        : '';
    case 'rumor': {
      const truth = RUMOR_TRUTH_LABEL[entry.rumor?.truth ?? 'unchecked'];
      const source = entry.rumor?.sourceId ? entityName(data, entry.rumor.sourceId) : '';
      return source ? `Gerücht von ${source} · ${truth}` : `Gerücht · ${truth}`;
    }
    case 'bond': {
      if (!entry.bond) return '';
      const { fromId, toId, ended } = entry.bond;
      const line = `${entityName(data, fromId)} ${relationLabel(entry.bond, 'from')} ${entityName(data, toId)}`;
      return ended ? `Beziehung beendet: ${line}` : `Beziehung: ${line}`;
    }
    case 'condition': {
      if (!entry.condition) return '';
      const who = entityName(data, entry.condition.entityId);
      if (entry.condition.ended) return `Zustand von ${who} aufgehoben`;
      return conditionEnding(data, entry.id)
        ? `Zustand von ${who} (aufgehoben)`
        : `Zustand von ${who}`;
    }
    case 'milestone': {
      if (!entry.milestone) return '';
      const who = entityName(data, entry.milestone.characterId);
      return entry.milestone.level !== null
        ? `${who} erreicht Stufe ${entry.milestone.level}`
        : `Meilenstein für ${who}`;
    }
    case 'wish': {
      const who = names(data, others(entry).slice(0, 1));
      if (!who) return '';
      return entry.wish?.setGoal ? `Wunsch von ${who} · als Ziel übernommen` : `Wunsch von ${who}`;
    }
    case 'clue': {
      const thread = entry.clue?.threadId ? data.threads[entry.clue.threadId] : undefined;
      const hint = thread?.hints.find((h) => h.id === entry.clue?.hintId);
      if (hint) return `Hinweis gefunden: ${hint.text} (${thread!.title})`;
      return thread ? `Hinweis gefunden zu: ${thread.title}` : '';
    }
    case 'reveal': {
      const alias = entry.reveal?.alias;
      const named = alias ? `${entityName(data, alias.entityId)} heißt auch „${alias.name}“` : '';
      const id = entry.reveal?.prepSecretId;
      if (!id) return named;
      for (const prep of Object.values(data.preps)) {
        const secret = prep.secrets.find((s) => s.id === id);
        if (secret)
          return named ? `Aufgedeckt: ${secret.text} · ${named}` : `Aufgedeckt: ${secret.text}`;
      }
      return named;
    }
    case 'knowledge': {
      const who = names(data, others(entry).slice(0, 1));
      return who ? `${who} erfährt` : '';
    }
    case 'promise': {
      if (!isJob(entry)) return '';
      const client = names(data, others(entry).slice(0, 1));
      return client ? `Auftrag von ${client}` : 'Auftrag';
    }
    case 'writing': {
      const title = entry.writing?.title.trim() ?? '';
      if (title) return `Schriftstück: ${title}`;
      const from = names(data, others(entry).slice(0, 1));
      return from ? `Schriftstück von ${from}` : '';
    }
    case 'downtime': {
      const days = entry.downtime?.days ?? 0;
      return days > 0 ? `Zwischenzeit: ${daysLabel(days)}` : 'Zwischenzeit';
    }
    case 'transformation':
      return entry.transformation
        ? `Wandlung: ${entityName(data, entry.transformation.characterId)}`
        : '';
    case 'companion': {
      if (!entry.companion) return '';
      const { entityId, ownerId, joined } = entry.companion;
      const owner = ownerId ? entityName(data, ownerId) : 'die Gruppe';
      return joined
        ? `${entityName(data, entityId)} begleitet ${owner}`
        : `${entityName(data, entityId)} verlässt ${owner}`;
    }
    default:
      return '';
  }
}

/** Ein Datum knapp: im laufenden Jahr ohne Jahr („8. Saatmond“), sonst mit. */
function shortDate(data: CampaignData, at: WorldTime): string {
  const cal = data.campaign.calendar;
  return fromTime(cal, at).year === fromTime(cal, data.state.now).year
    ? formatDayMonth(cal, at)
    : formatDate(cal, at);
}

/**
 * Das Schicksal einer Person oder eines Gefährten mit Datum: „Tot seit 8. Saatmond“. null, wenn
 * sie lebt oder kein Eintrag der Chronik sagt, seit wann.
 */
export function fateSinceLabel(data: CampaignData, personId: string): string | null {
  const fate = fateSince(data, personId);
  if (!fate || fate.status === 'alive') return null;
  const word = FATE_LABEL[fate.status];
  return `${word[0]!.toUpperCase()}${word.slice(1)} seit ${shortDate(data, fate.since)}`;
}
