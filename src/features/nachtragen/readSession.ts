/**
 * Eine nachgetragene Session lesen (Schritt 3): Aus den Notizen des Spielleiters werden
 * Vorschläge – Fäden aus der Liste offener Fäden, Beute aus Beute- und Einkaufslisten,
 * Schriftstücke aus wörtlichen Briefen, und aus den Sätzen, was `recognizeEntry` darin erkennt
 * (Schicksal, Ortswechsel, Begegnung …). Der Rückblick für die Spieler wird herausgelöst und nie
 * als Geschehen gelesen; Regelwerte bleiben bloß sichtbar. Jeder Vorschlag nennt den Satz, aus dem
 * er stammt, bekommt eine Weltzeit in der Reihenfolge des Textes und gilt erst, wenn der
 * Spielleiter ihn annimmt. Rein und ohne Netz; erneutes Lesen behält Entscheidungen
 * (`mergeReading`).
 */
import {
  FATE_LABEL,
  FIGHT_OUTCOME_LABEL,
  KIND_LABEL,
  type RecordInput,
} from '../../domain/chronicleKinds';
import { entityName } from '../../domain/derive';
import {
  recognizeEntry,
  recognizedInput,
  type Recognized,
  type RecognizedPayload,
} from '../../domain/recognize';
import {
  newId,
  type CampaignData,
  type ChroniclePrecision,
  type EntityKind,
  type FightOutcome,
  type PersonStatus,
  type ReadProposal,
  type ReadProposalKind,
  type ReadQuestion,
  type ReadSectionKind,
  type Session,
  type SessionReading,
} from '../../domain/schema';
import type { WorldTime } from '../../domain/time/calendar';
import {
  blockText,
  coinGold,
  noteBlocks,
  recapOf,
  stripBullet,
  titleCase,
  writingTitle,
  type NoteBlock,
  type NoteLine,
} from './readBlocks';
import {
  entitiesNamed,
  foldName,
  mentions,
  readingText,
  tolerantWorld,
  unknownNames,
  type Mention,
  type TextPiece,
} from './readNames';
import { spreadTimes } from './readTime';

/** So viele Vorschläge höchstens je Session – „nicht jedes Wort wird ein Eintrag“. */
export const MAX_PROPOSALS = 20;
/** So viele Vorschläge mindestens, wenn die Notizen genug erzählen. */
const MIN_PROPOSALS = 8;
/** Ab dieser Wichtigkeit bleibt ein Vorschlag immer (Schicksal, Beute, Faden, Schriftstück …). */
const ALWAYS = 9;
/** Höchstens so viele Vorschläge je Satz. */
const PER_SENTENCE = 2;

const PEOPLE: EntityKind[] = ['person', 'character', 'faction', 'family'];
/** Eine Beuteliste von Toten: „plünderten die Gefallenen“, „bei den Toten fand die Gruppe“. */
const CORPSES =
  /(?<![\p{L}])(?:leiche|leichen|toten|gefallenen|erschlagenen|leichnam|leichname)(?![\p{L}])/iu;
const LIVING: EntityKind[] = ['person', 'character'];

// ── Sätze ──────────────────────────────────────────────────────────────────

export interface SentenceSpan {
  from: number;
  to: number;
}

/** Abkürzungen, nach denen der Punkt keinen Satz beendet. */
const ABBREVIATIONS =
  /(?:^|\s)(?:dr|prof|st|nr|ca|bzw|usw|etc|vgl|evtl|ggf|inkl|z\.b|u\.a|d\.h|lv|min|max|std|mio|bspw)$/iu;

/**
 * Teilt eine Zeile in Sätze. Was in Anführungszeichen steht, bleibt beim Satz; „8. Runde“, „Dr.“
 * und Initialen („K.“) beenden keinen.
 */
export function splitSentences(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '„' || ch === '»') depth++;
    else if (ch === '“') depth = depth > 0 ? depth - 1 : depth + 1;
    else if (ch === '”' || ch === '«') depth = Math.max(0, depth - 1);
    else if (ch === '"') depth = depth > 0 ? depth - 1 : depth + 1;
    else if (depth === 0 && /[.!?;]/.test(ch)) {
      const before = text.slice(start, i);
      if (ch === '.') {
        if (/\d$/.test(before) && /^\s*\p{L}/u.test(text.slice(i + 1, i + 4))) continue;
        if (ABBREVIATIONS.test(before)) continue;
        if (/(?:^|\s)\p{Lu}$/u.test(before)) continue;
      }
      let end = i + 1;
      while (end < text.length && /[.!?;“”"«]/.test(text[end]!)) end++;
      if (text.slice(start, end).trim()) out.push({ from: start, to: end });
      start = end;
      i = end - 1;
    }
  }
  if (text.slice(start).trim()) out.push({ from: start, to: text.length });
  // Leerraum am Rand gehört nicht zum Satz.
  return out.map((span) => {
    const raw = text.slice(span.from, span.to);
    const lead = raw.length - raw.trimStart().length;
    return { from: span.from + lead, to: span.from + raw.trimEnd().length };
  });
}

// ── Geheimes ───────────────────────────────────────────────────────────────

/** Nur für die Spielleitung – ab hier bis zum Ende der Zeile. */
const SECRET_REST =
  /(?:was|das|wovon)\s+(?:er|sie|es|die\s+gruppe|die\s+spieler)\s+(?:selbst\s+)?(?:noch\s+)?nicht\s+(?:weiß|wissen|ahnt|ahnen)\s*:|spielte\s+(?:noch\s+|bisher\s+|bislang\s+)?keine\s+rolle|nur\s+für\s+(?:mich|die\s+spielleitung|den\s+spielleiter)\s*:/iu;
/** Nur für die Spielleitung – dieser Satz. */
const SECRET_HERE =
  /(?:was|das|wovon)\s+(?:er|sie|es|die\s+gruppe|die\s+spieler)\s+(?:selbst\s+)?(?:noch\s+)?nicht\s+(?:weiß|wissen|ahnt|ahnen)|weiß\s+(?:er|sie|es)\s+(?:aber\s+|jedoch\s+)?(?:noch\s+)?nicht|wissen\s+(?:sie|die\s+spieler)\s+(?:aber\s+|jedoch\s+)?(?:noch\s+)?nicht|\(\s*geheim\s*\)|nur\s+für\s+(?:mich|die\s+spielleitung|den\s+spielleiter)|(?:erzählte|verriet|sagte)\s[^.!?]{0,60}\bnoch\s+nicht(?![\p{L}])/iu;

/** Ob die Sätze einer Zeile nur für die Spielleitung sind. */
export function secretSentences(line: string, spans: SentenceSpan[]): boolean[] {
  let rest = false;
  return spans.map((span) => {
    const text = line.slice(span.from, span.to);
    if (SECRET_REST.test(text)) rest = true;
    return rest || SECRET_HERE.test(text);
  });
}

// ── Kandidaten ─────────────────────────────────────────────────────────────

interface Candidate {
  kind: ReadProposalKind;
  label: string;
  quote: string;
  text: string;
  from: number;
  to: number;
  line: number;
  refs: string[];
  payload: Record<string, unknown>;
  secret: boolean;
  priority: number;
  /** Satz, aus dem er stammt (Stelle im Text) – für die Grenze je Satz. */
  sentence: number;
}

/** Wichtigkeit eines erkannten Vorschlags: Was die Welt verändert, zuerst. */
function priorityOf(item: Pick<Recognized, 'kind' | 'refs' | 'payload'>): number {
  const named = item.refs.length > 0;
  switch (item.kind) {
    case 'fate':
      return item.payload.fate?.entityId ? 10 : 5;
    case 'companion':
    case 'transformation':
    case 'writing':
      return 9;
    case 'milestone':
      return item.payload.milestone?.characterId || item.payload.milestone?.level ? 9 : 4;
    case 'downtime':
    case 'travel':
      return 8;
    case 'whereabouts':
    case 'promise':
    case 'fight':
    case 'reveal':
      return 7;
    case 'discovery':
      return item.payload.placeId ? 6 : 3;
    case 'meeting':
    case 'condition':
    case 'bond':
      return named ? 6 : 2;
    case 'rumor':
    case 'quote':
      return 5;
    case 'knowledge':
      return named ? 5 : 3;
    case 'decision':
    case 'wish':
      return 4;
    case 'attitude':
    case 'rest':
    case 'clue':
      return 3;
    default:
      return 2;
  }
}

/** Präteritum oder Perfekt: Ein Satz erzählt, was geschah. */
const PAST =
  /(?<![\p{L}])(?:war|waren|hatte|hatten|wurde|wurden|ging|gingen|kam|kamen|sah|sahen|fand|fanden|sprach|sprachen|nahm|nahmen|gab|gaben|traf|trafen|lief|liefen|fiel|fielen|rief|riefen|hielt|hielten|ließ|ließen|bekam|bekamen|erfuhr|erfuhren|half|halfen|schlief|schliefen|brachte|brachten|wusste|wussten|zog|zogen|stand|standen|saß|trat|traten|bot|boten|schlug|schlugen|warf|warfen|blieb|blieben|tat|taten|las|lasen|entschied|entschieden|entschloss|entschlossen|beschloss|beschlossen|verlor|verloren|floh|flohen|starb|starben|schwor|schworen|verließ|verließen|begann|begannen|gewann|gewannen|\p{Ll}{2,}(?:te|ten|ierte|ierten))(?![\p{L}])|(?<![\p{L}])\p{Ll}*ge\p{Ll}{2,}(?:t|en)(?![\p{L}])/u;
const TELLS =
  /(?<![\p{L}])(?:erfuhr|erfuhren|erfahren|herausgefunden|erzählte|erzählten|offenbarte|zeigte|verriet|erklärte|gestand|entdeckte|entdeckten)(?![\p{L}])/iu;
/** „Hier endete die Session.“ – eine Randbemerkung, kein Geschehen. */
const SESSION_END =
  /(?:^|\s)(?:hier\s+)?(?:endete|endet|beendet|ende)\b[^.]{0,40}\bsession\b|\bsession\s+(?:beendet|endete|endet|vorbei)\b|\bdie\s+session\s+endete\b/iu;

/** „… das klären wir beim nächsten Mal“ – ein Ausblick, kein Geschehen. */
const NEXT_TIME =
  /(?<![\p{L}])(?:beim\s+nächsten\s+mal|nächstes\s+mal|(?:in\s+der\s+)?nächsten\s+(?:session|sitzung|runde))(?![\p{L}])/iu;

/** Wie sicher eine Notiz etwas erzählt: Namen der Welt, Erfahrenes, Länge. */
function noteWeight(data: CampaignData, text: string, found: Mention[], unknown: number): number {
  const kinds = found.map((m) => data.entities[m.id]?.kind);
  const others = new Set(
    found.filter((m) => data.entities[m.id]?.kind !== 'character').map((m) => m.id),
  ).size;
  const words = text.split(/\s+/).filter(Boolean).length;
  let weight = 1 + Math.min(3, others) * 1.5 + (kinds.includes('character') ? 0.5 : 0);
  weight += Math.min(2, unknown);
  if (TELLS.test(text)) weight += 1;
  if (!PAST.test(text)) weight -= 2;
  weight += Math.min(1.5, words / 20);
  return weight;
}

const isQuoteLike = (sentence: string, item: Recognized, lineText: string) => {
  const quoted =
    /[„"»‚“]([^„"»«“”‚‘]{2,})[“”"«‘]/u.exec(lineText.slice(item.from, item.to + 1))?.[1] ??
    lineText.slice(item.from, item.to);
  const words = quoted.trim().split(/\s+/).length;
  if (/[.!?…]/.test(quoted)) return true;
  if (/:\s*[„"»“]?\s*$/.test(lineText.slice(0, item.from))) return words >= 2;
  return (
    words >= 4 &&
    /(?<![\p{L}])(?:sagte|sagt|rief|fragte|meinte|antwortete|flüsterte|schrie|murmelte|sprach|erwiderte)(?![\p{L}])/iu.test(
      sentence,
    )
  );
};

/** Wo ein Name nach einer Stelle steht – oder ein großgeschriebenes Wort, das einer sein könnte. */
function nameAt(
  found: Mention[],
  text: string,
  at: number,
): { id: string | null; name: string } | null {
  const rest = text.slice(at);
  const lead = rest.length - rest.trimStart().length;
  const mention = found.find((m) => m.from === at + lead);
  if (mention) return { id: mention.id, name: text.slice(mention.from, mention.to) };
  const word = /^\s*(\p{Lu}[\p{L}’'-]+)/u.exec(rest);
  return word ? { id: null, name: word[1]! } : null;
}

interface LineContext {
  data: CampaignData;
  /** Wortlaut der Zeile und Lesetext (gleich lang). */
  line: NoteLine;
  work: string;
  spans: SentenceSpan[];
  secret: boolean[];
  found: Mention[];
}

const sentenceOf = (ctx: LineContext, at: number) =>
  Math.max(
    0,
    ctx.spans.findIndex((span) => at >= span.from && at < Math.max(span.to, span.from + 1)),
  );

/** Arten, die nur zählen, wenn der Satz erzählt, was geschah (Präteritum oder Perfekt). */
const NEEDS_PAST = new Set(['fight', 'meeting', 'knowledge', 'rest', 'decision']);
/** Ohne genanntes Ding ist es kein eigener Eintrag – der Satz bleibt eine Notiz. */
function needsThing(item: Recognized): boolean {
  switch (item.kind) {
    case 'knowledge':
    case 'meeting':
    case 'transformation':
    case 'companion':
    case 'whereabouts':
      return !item.refs.length;
    case 'discovery':
      return !item.payload.placeId;
    case 'condition':
      return !item.payload.condition?.entityId;
    case 'attitude':
      return !item.payload.attitude?.fromId || !item.payload.attitude.toId;
    default:
      return false;
  }
}
const PARTY_HERE = /(?<![\p{L}])(?:gruppe|wir|uns|sie|alle)(?![\p{L}])/iu;
/**
 * Vorgeschichte und Erinnerung („traf sie als Kind …“, „vor 60 Jahren“, „konnte sich erinnern,
 * dass …“): erzählt, was früher geschah – kein Geschehen dieses Abends.
 */
const BACKSTORY =
  /(?<![\p{L}])(?:als\s+kind|damals|früher|einst(?:mals)?|in\s+seiner\s+jugend|in\s+ihrer\s+jugend|vor\s+(?:etwa\s+|ungefähr\s+|über\s+|rund\s+)?\d+\s+jahren|erinnerte\s+sich|erinnern|erinnert)(?![\p{L}])/iu;
/** „Odo erzählte Mira seine Vergangenheit.“ – die ganze Zeile erzählt Vorgeschichte. */
const BACKSTORY_LINE =
  /(?<![\p{L}])(?:seine|ihre|seiner|ihrer|deren|dessen)\s+(?:vergangenheit|vorgeschichte|lebensgeschichte)(?![\p{L}])/iu;
/** Arten, die in der Vorgeschichte kein Eintrag dieses Abends sind. */
const NOT_IN_BACKSTORY = new Set([
  'meeting',
  'fight',
  'promise',
  'decision',
  'travel',
  'rest',
  'discovery',
  'whereabouts',
]);
const DISGUISE = /verkleid|illusion|tarnung|getarnt|disguise/iu;

/** Erkanntes aus `recognizeEntry` – zurechtgerückt, wo die Sätze der Notizen es verlangen. */
function recognized(ctx: LineContext): Candidate[] {
  const { data, work } = ctx;
  const out: Candidate[] = [];
  const items = recognizeEntry(data, work);
  const deaths = new Map<string, number>();
  const ending = SESSION_END.test(work) || NEXT_TIME.test(work);
  for (const raw of items) {
    let item: Recognized = raw;
    const sentenceIndex = sentenceOf(ctx, item.from);
    const span = ctx.spans[sentenceIndex] ?? { from: 0, to: work.length };
    const sentence = work.slice(span.from, span.to);
    // Ein erwähntes Schriftstück ohne Wortlaut ist kein Schriftstück – das ist der Satz selbst.
    if (item.kind === 'writing') continue;
    if (item.kind === 'quote' && !isQuoteLike(sentence, item, work)) continue;
    // „Hier endete die Session vor dem Kampf …“: nur Aufstieg und Schicksal zählen dort.
    if (ending && item.kind !== 'milestone' && item.kind !== 'fate') continue;
    if (NEEDS_PAST.has(item.kind) && !PAST.test(sentence)) continue;
    if (NOT_IN_BACKSTORY.has(item.kind) && (BACKSTORY.test(sentence) || BACKSTORY_LINE.test(work)))
      continue;
    // „Der Mann floh.“: Ein anderer flieht – das ist kein Kampf der Gruppe, die geflohen wäre.
    if (
      item.kind === 'fight' &&
      /^(?:floh|flohen|flieht|fliehen|geflohen|flüchtete|flüchteten)$/iu.test(
        work.slice(item.from, item.to),
      ) &&
      /^\s*(?:der|die|das|ein|eine)\s+\p{L}+\s+$/iu.test(work.slice(span.from, item.from)) &&
      !/^\s*die\s+gruppe\s+$/iu.test(work.slice(span.from, item.from))
    )
      continue;
    // „A und B kämpften gegeneinander“: ein Kampf anderer, solange kein Gefährte davor handelt.
    if (
      item.kind === 'fight' &&
      /(?<![\p{L}])gegeneinander(?![\p{L}])/iu.test(sentence) &&
      !ctx.found.some(
        (m) =>
          m.from >= span.from &&
          m.to <= item.from &&
          data.entities[m.id]?.kind === 'character' &&
          !/(?:mit|gegen|von)\s+$/iu.test(work.slice(span.from, m.from)),
      )
    )
      continue;
    if (
      item.kind === 'rest' &&
      !PARTY_HERE.test(sentence) &&
      !ctx.found.some((m) => data.entities[m.id]?.kind === 'character')
    )
      continue;
    // „Insgesamt 5 Tage vergangen“ ist die Länge der Session, keine Zwischenzeit.
    if (item.kind === 'downtime' && /insgesamt/iu.test(sentence)) continue;
    if (item.kind === 'transformation') {
      const after = work.slice(item.to);
      const clause = work.slice(
        Math.max(work.lastIndexOf(',', item.from) + 1, span.from),
        item.from,
      );
      // „…, das sich in einen Stab verwandelte“, „verwandelte ihn in Stein“, eine Verkleidung.
      if (/^\s*(?:das|der|die|welche[rs]?)\s/iu.test(clause)) continue;
      if (
        /^verwandelte?n?$/iu.test(work.slice(item.from, item.to)) &&
        /^\s+(?:ihn|es|den|das|einen|eine|ein)(?![\p{L}])/iu.test(after)
      )
        continue;
      if (DISGUISE.test(sentence)) continue;
    }
    if (needsThing(item)) continue;
    if (item.kind === 'fate') {
      const fixed = fixFate(ctx, item);
      if (!fixed) continue;
      item = fixed;
      if (!fixed.payload.fate?.entityId && !(fixed.payload as { name?: string }).name) continue;
    }
    // Ein ganzer Stufenaufstieg der Gruppe ist ein Vorschlag, nicht einer je Gefährte.
    if (
      item.kind === 'milestone' &&
      out.some((c) => c.kind === 'milestone' && c.sentence === ctx.line.from + span.from)
    )
      continue;
    let party = false;
    if (
      item.kind === 'milestone' &&
      items.filter((i) => i.kind === 'milestone' && sentenceOf(ctx, i.from) === sentenceIndex)
        .length > 1
    ) {
      const level = item.payload.milestone?.level ?? null;
      party = true;
      item = {
        ...item,
        label: `Meilenstein: alle Gefährten${level !== null ? ` → Stufe ${level}` : ''}`,
        payload: { milestone: { characterId: null, level } },
        refs: [],
      };
    }
    const candidate = toCandidate(ctx, item, span, sentenceIndex);
    if (party) candidate.payload = { ...candidate.payload, party: true };
    if (item.kind === 'fate' && item.payload.fate?.entityId) {
      const key = `${item.payload.fate.entityId}:${item.payload.fate.status}`;
      const before = deaths.get(key);
      // Zweimal dasselbe Schicksal in einer Zeile: der spätere Satz zählt.
      if (before !== undefined) out.splice(before, 1);
      deaths.set(key, out.length);
    }
    out.push(candidate);
  }
  return out;
}

function toCandidate(
  ctx: LineContext,
  item: Pick<Recognized, 'kind' | 'label' | 'payload' | 'refs' | 'from' | 'to'>,
  span: SentenceSpan,
  sentenceIndex: number,
  priority = priorityOf(item),
): Candidate {
  const quote = ctx.line.text.slice(span.from, span.to).trim();
  return {
    kind: item.kind,
    label: item.label,
    quote,
    text: quote,
    from: ctx.line.from + span.from,
    to: ctx.line.from + span.to,
    line: ctx.line.index + 1,
    refs: item.refs,
    payload: { ...item.payload },
    secret: ctx.secret[sentenceIndex] ?? false,
    priority,
    sentence: ctx.line.from + span.from,
  };
}

const ACTIVE_KILL =
  /^(?:tötete|töteten|tötet|erschlug|erschlugen|ermordete|ermordeten|erstach|erstachen|köpfte|köpften|enthauptete|enthaupteten)$/iu;
const ARTICLE_AFTER =
  /^\s*(?:den|die|das|dem|einen|eine|ein|einem|alle|beide|zwei|drei|vier|mehrere|einige)(?![\p{L}])/iu;

/**
 * Ein erkanntes Schicksal, an den Satz der Notizen angepasst: „auf Geheiß von X“ ist kein Opfer,
 * in „erschlug A B“ stirbt B, in „…, der X tötete“ stirbt X; „tötete den Wolf“ ist ein Kampf.
 */
function fixFate(ctx: LineContext, item: Recognized): Recognized | null {
  const { work, data, found } = ctx;
  const fate = item.payload.fate!;
  const cue = work.slice(item.from, item.to);
  const spanEnd = ctx.spans[sentenceOf(ctx, item.from)]?.to ?? work.length;
  const setTo = (id: string | null, name: string | null): Recognized => ({
    ...item,
    label: id
      ? `Schicksal: ${entityName(data, id)} → ${FATE_LABEL[fate.status]}`
      : name
        ? `Schicksal: ${name} → ${FATE_LABEL[fate.status]}`
        : `Schicksal: ${FATE_LABEL[fate.status]}`,
    payload: { fate: { entityId: id, status: fate.status }, ...(name && !id ? { name } : {}) },
    refs: id ? [id] : [],
  });
  // Ohne Namen: „…, der Mira kurz sofort tötete“ – der Name im Nebensatz davor.
  const sentenceStart = ctx.spans[sentenceOf(ctx, item.from)]?.from ?? 0;
  const relativeVictim = (): Recognized | null => {
    const clauseStart = Math.max(
      sentenceStart,
      Math.max(work.lastIndexOf(',', item.from), work.lastIndexOf(';', item.from)) + 1,
    );
    const inClause = found.filter(
      (m) =>
        m.from >= clauseStart && m.to <= item.from && LIVING.includes(data.entities[m.id]!.kind),
    );
    // Nur ein Nebensatz nach einem Komma: „Der Eid holte …“ am Satzanfang ist keiner.
    return clauseStart > sentenceStart &&
      /^\s*(?:die|der|das|den|welche|welcher|welches)\s/iu.test(work.slice(clauseStart)) &&
      inClause.length === 1
      ? setTo(inClause[0]!.id, null)
      : null;
  };
  if (ACTIVE_KILL.test(cue)) {
    // „Im Hof erschlug Brann Krummzahn“: Nach dem Verb steht erst wer tötet, dann das Opfer.
    const first = nameAt(found, work.slice(0, spanEnd), item.to);
    if (!first) return relativeVictim();
    const afterFirst = work.indexOf(first.name, item.to) + first.name.length;
    const second = /^\s+\p{Lu}/u.test(work.slice(afterFirst))
      ? nameAt(found, work, afterFirst)
      : null;
    if (second && /^\s+$/.test(work.slice(afterFirst, work.indexOf(second.name, afterFirst))))
      return setTo(second.id, second.name);
    // „erstach auf Geheiß von X …“: X ist der Auftraggeber.
    const gap = work.slice(item.to, work.indexOf(first.name, item.to));
    if (/(?:von|vom|durch)\s+$/iu.test(gap)) return null;
    if (fate.entityId && first.id === fate.entityId) return item;
    return setTo(first.id, first.name);
  }
  // „um verbannt zu werden“: geplant, nicht geschehen.
  if (
    /^\s*zu\s+werden(?![\p{L}])/iu.test(work.slice(item.to)) ||
    /(?<![\p{L}])um\s+$/iu.test(work.slice(Math.max(0, item.from - 4), item.from))
  )
    return null;
  if (fate.entityId) {
    const own = found.filter((m) => m.id === fate.entityId);
    const near = own.sort((a, b) => Math.abs(a.from - item.from) - Math.abs(b.from - item.from))[0];
    // Der Täter nach „von“ ist kein Opfer.
    if (near && near.from > item.to && /(?:von|vom|durch)\s+$/iu.test(work.slice(0, near.from)))
      return null;
    // Wer stirbt, steht im selben Teilsatz: „Mira, deren Amulett verschwunden war“ meint nicht sie.
    if (near) {
      const between =
        near.to <= item.from ? work.slice(near.to, item.from) : work.slice(item.to, near.from);
      if (/[,;:–—]|\s-\s/.test(between)) return null;
      // Steht direkt davor ein anderes Hauptwort („das Amulett war verschwunden“), meint es das.
      const noun = /(\p{Lu}[\p{L}’'-]*)\s+(?:(?:war|ist|sind|waren|wurde|wurden)\s+)?$/u.exec(
        work.slice(0, item.from),
      );
      const agent = noun && /(?:von|vom|durch)\s+$/iu.test(work.slice(0, noun.index));
      const named = noun && found.some((m) => m.from <= noun.index && m.to > noun.index);
      if (near.to <= item.from && noun && noun.index >= near.to && !agent && !named) return null;
    }
    return item;
  }
  const relative = relativeVictim();
  if (relative) return relative;
  // „Wilmar wurde getötet.“ – ein Name, den die Welt nicht kennt: als Name vorschlagen.
  const subject =
    /(?:^|[\s,;:])(\p{Lu}[\p{L}’'-]+)\s+(?:wurde|wurden|ist|war|sind|waren)\s+(?:[^,.;!?]{0,30}\s)?$/u.exec(
      work.slice(sentenceStart, item.from),
    )?.[1];
  if (subject && !PRONOUNS.test(subject)) return setTo(null, subject);
  return ARTICLE_AFTER.test(work.slice(item.to)) ? null : item;
}

/** Wörter am Satzanfang, die kein Name sind. */
const PRONOUNS =
  /^(?:der|die|das|er|sie|es|man|ein|eine|einer|dieser|diese|dieses|jeder|jede|alle|wer|niemand|jemand|keiner|beide|dort|hier|dann|danach|auch|doch)$/iu;

/** Zusätzliche Regeln des Lesens: Schicksal in Wendungen, wahre Namen, Decknamen, Beute im Satz. */
function extras(ctx: LineContext): Candidate[] {
  const { data, work, found } = ctx;
  const out: Candidate[] = [];
  const add = (
    kind: ReadProposalKind,
    label: string,
    at: number,
    to: number,
    payload: Record<string, unknown>,
    refs: string[],
    priority: number,
  ) => {
    const index = sentenceOf(ctx, at);
    const span = ctx.spans[index] ?? { from: 0, to: work.length };
    const candidate = toCandidate(
      ctx,
      { kind: 'note', label, payload: {}, refs, from: at, to },
      span,
      index,
      priority,
    );
    candidate.kind = kind;
    candidate.payload = payload;
    out.push(candidate);
  };
  const fate = (
    m: { id: string | null; name: string },
    status: PersonStatus,
    at: number,
    to: number,
  ) => {
    if (m.id && !LIVING.includes(data.entities[m.id]!.kind)) return;
    add(
      'fate',
      `Schicksal: ${m.id ? entityName(data, m.id) : m.name} → ${FATE_LABEL[status]}`,
      at,
      to,
      { fate: { entityId: m.id, status }, ...(m.id ? {} : { name: m.name }) },
      m.id ? [m.id] : [],
      m.id ? 10 : 5,
    );
  };
  // „…, doch Pfeile besiegelten Miras Schicksal“
  for (const match of work.matchAll(
    /(\p{Lu}[\p{L}’'-]+)\s+Schicksal\s+(?:war\s+|wurde\s+|ist\s+)?(?:besiegelt|besiegelte|besiegelten)(?![\p{L}])/gu,
  )) {
    const who = nameAt(found, work, match.index);
    if (who?.id) fate(who, 'dead', match.index, match.index + match[0].length);
  }
  // „Brann hat Krummzahn geköpft“
  for (const match of work.matchAll(
    /(?:hat|haben|hatte|hatten)\s+(\p{Lu}[\p{L}’'-]+)\s+geköpft(?![\p{L}])/gu,
  )) {
    const who = nameAt(found, work, match.index + match[0].indexOf(match[1]!));
    if (who) fate(who, 'dead', match.index, match.index + match[0].length);
  }
  // „Lando brachte Krummzahn am Fluss um“, „brachte Brann Krummzahn um“
  for (const match of work.matchAll(
    /(?<![\p{L}])(?:brachte|brachten|bringt)\s+([^,.;!?]{1,60}?)\s+um(?=[\s,.;!?]|$)/gu,
  )) {
    const inner = match[1]!;
    const base = match.index + match[0].indexOf(inner);
    const names: { id: string | null; name: string }[] = [];
    for (const word of inner.matchAll(/\p{Lu}[\p{L}’'-]+/gu)) {
      const hit = nameAt(found, work, base + word.index);
      if (hit && (hit.id || !/^(?:in|im|an|am)$/iu.test(word[0]))) names.push(hit);
    }
    const before = found.filter(
      (m) => m.to <= match.index && m.from >= (ctx.spans[sentenceOf(ctx, match.index)]?.from ?? 0),
    );
    const victim =
      names.length >= 2 ? names[1]! : names.length === 1 && before.length ? names[0]! : null;
    if (victim) fate(victim, 'dead', match.index, match.index + match[0].length);
  }
  // Rückkehr ins Leben: „Ein alter Eid holte Mira zurück“, „wurde wiederbelebt“
  for (const match of work.matchAll(
    /(?<![\p{L}])(?:brachte|brachten|bringt|holte|holten)\s+(\p{Lu}[\p{L}’'-]+)\s+(?:(?:ins\s+leben|von\s+den\s+toten|wieder)\s+)?zurück(?!\s+(?:nach|zu|zum|zur|in|ins|an)(?![\p{L}]))/giu,
  )) {
    const who = nameAt(found, work, match.index + match[0].indexOf(match[1]!));
    if (who?.id) fate(who, 'alive', match.index, match.index + match[0].length);
  }
  for (const match of work.matchAll(
    /(?<![\p{L}])(?:wurde|wurden|ist|sind|war)\s+(?:wieder\s+)?(?:wiederbelebt|wiedererweckt|auferweckt|auferstanden)(?![\p{L}])/giu,
  )) {
    const before = found.filter((m) => m.to <= match.index).pop();
    if (before)
      fate({ id: before.id, name: '' }, 'alive', match.index, match.index + match[0].length);
  }
  // Ein wahrer Name wird enthüllt.
  for (const match of work.matchAll(
    /(?<![\p{L}])(?:offenbarte|verriet|nannte|enthüllte|gestand)(?![\p{L}])[^.!?]{0,40}?(?:seinen|ihren|den|seinem|ihrem)\s+(?:richtigen|wahren|echten|vollen|eigentlichen)\s+Namen\s*[-–—:,]?\s*[„"“]?(\p{Lu}[\p{L}’'-]*(?:\s+\p{Lu}[\p{L}’'-]*){0,4})/gu,
  )) {
    const name = match[1]!.trim();
    const owner = found
      .filter((m) => m.to <= match.index && LIVING.includes(data.entities[m.id]!.kind))
      .pop();
    add(
      'reveal',
      owner ? `Wahrer Name: ${name} (${entityName(data, owner.id)})` : `Wahrer Name: ${name}`,
      match.index,
      match.index + match[0].length,
      { reveal: { prepSecretId: null, alias: owner ? { entityId: owner.id, name } : null }, name },
      owner ? [owner.id] : [],
      8,
    );
  }
  // Ein Deckname: „gab sich als Wido aus“, „stellte sich als Wido vor“
  for (const match of work.matchAll(
    /(?:stellte|gab)\s+sich\s+(?:jedoch\s+|aber\s+|dabei\s+|ihm\s+|ihr\s+)*als\s+(\p{Lu}[\p{L}’'-]+(?:\s+\p{Lu}[\p{L}’'-]+)?)\s+(?:vor|aus)(?![\p{L}])/gu,
  )) {
    const name = match[1]!;
    const owner = found
      .filter((m) => m.to <= match.index && LIVING.includes(data.entities[m.id]!.kind))
      .pop();
    if (!owner) continue;
    add(
      'note',
      `Zweiter Name: ${name} (${entityName(data, owner.id)})`,
      match.index,
      match.index + match[0].length,
      { aliases: [{ entityId: owner.id, name }] },
      [owner.id],
      7,
    );
  }
  // Decknamen in Klammern: „Decknamen (Brann: Bert Eiche, Lando: Lars Furt)“
  for (const match of work.matchAll(/Decknamen?\s*[(:]\s*([^)]{3,200})\)?/giu)) {
    const aliases: { entityId: string; name: string }[] = [];
    for (const pair of match[1]!.split(/[,;]/)) {
      const parts = /^\s*([^:]+?)\s*:\s*(.+?)\s*$/u.exec(pair);
      if (!parts) continue;
      const ids = entitiesNamed(data, parts[1]!, LIVING);
      if (ids.length === 1) aliases.push({ entityId: ids[0]!, name: parts[2]! });
    }
    if (!aliases.length) continue;
    add(
      'note',
      `Zweite Namen: ${aliases.map((a) => `${a.name} (${entityName(data, a.entityId)})`).join(', ')}`,
      match.index,
      match.index + match[0].length,
      { aliases },
      aliases.map((a) => a.entityId),
      7,
    );
  }
  // Wandlung eines Gefährten: „hat Hörner aus Bernstein bekommen“, „verlor seinen linken Arm“.
  for (const match of work.matchAll(
    /(?:hat|haben|hatte|hatten)\s+[^.;!?]{0,40}?(?<![\p{L}])(?:Flügel|Kräfte|Kraft|Resistenz|resistenz|Dunkelsicht|Telepathie|Gestalt|Augen|Hörner|Schuppen)(?![\p{L}])[^.;!?]{0,40}?(?<![\p{L}])(?:bekommen|erhalten|erlangt)(?![\p{L}])|(?<![\p{L}])(?:der|die)\s+(?:sein|ihr)(?:e|en|em)?\s+[^.;!?]{0,40}?(?<![\p{L}])(?:Flügel|Kräfte|Kraft|Resistenz|resistenz|Dunkelsicht|Telepathie|Gestalt|Augen|Hörner|Schuppen)(?![\p{L}])[^.;!?]{0,40}?(?<![\p{L}])(?:bekommen|erhalten|erlangt)\s+(?:hat|hatte)(?![\p{L}])|(?<![\p{L}])(?:erwachte|erwacht|erwachten)\s+mit\s+(?:den\s+|neuen\s+)?(?:Kräften|Kraft|Flügeln)|(?<![\p{L}])(?:verlor|verliert|verloren)\s+(?:sein|ihr|seinen|ihren|seine|ihre)\s+(?:(?:linke|rechte)[snm]?\s+)?(?:Arm|Bein|Auge|Hand|Fuß|Ohr|Flügel)(?![\p{L}])/gu,
  )) {
    const spanFrom = ctx.spans[sentenceOf(ctx, match.index)]?.from ?? 0;
    const who = found
      .filter(
        (m) =>
          m.from >= spanFrom && m.to <= match.index && data.entities[m.id]?.kind === 'character',
      )
      .pop();
    if (!who) continue;
    add(
      'transformation',
      `Wandlung: ${entityName(data, who.id)}`,
      match.index,
      match.index + match[0].length,
      { transformation: { characterId: who.id } },
      [who.id],
      9,
    );
  }
  // Aufstieg der Gruppe: „am Ende haben alle Stufe 4 erreicht“
  for (const match of work.matchAll(
    /(?<![\p{L}])(?:level|stufe)\s+(\d{1,2})(?![\p{N}])[^.;!?]{0,40}?(?<![\p{L}])(?:erhalten|erreicht|bekommen|aufgestiegen)(?![\p{L}])/giu,
  )) {
    const level = Number(match[1]);
    if (level < 1 || level > 20) continue;
    add(
      'milestone',
      `Meilenstein: alle Gefährten → Stufe ${level}`,
      match.index,
      match.index + match[0].length,
      { milestone: { characterId: null, level }, party: true },
      [],
      9,
    );
  }
  // Beute, die jemand an sich nimmt: „nahm die Laterne an sich“, „hat den Schlüssel behalten“,
  // „Mira hat einen Kompass gefunden“ (gefunden nur, wenn ein Gefährte es selbst fand).
  for (const match of work.matchAll(OWNED)) {
    let object = (match[1] ?? match[2] ?? match[3] ?? match[4])!;
    const verb = match[0];
    let objectAt = match.index + verb.indexOf(object);
    // „haben den Wolf getötet und die Perle an sich genommen“: genommen wurde nur die Perle.
    const joined = new RegExp(
      String.raw`^.*\s(?:und|sowie)\s+(?:\p{Ll}+\s+)?(?=${OWN_DET}\s)`,
      'iu',
    ).exec(object);
    if (joined) {
      objectAt += joined[0].length;
      object = object.slice(joined[0].length);
    }
    const spanFrom = ctx.spans[sentenceOf(ctx, match.index)]?.from ?? 0;
    const clauseFrom = Math.max(spanFrom, work.lastIndexOf(',', match.index) + 1);
    const before = work.slice(clauseFrom, match.index);
    // Was jemand nimmt, ist kein Name der Welt („haben den Krummzahn gefunden“) – „eine Karte
    // von Hohenfurt“ schon.
    if (namesThing(found, object, objectAt)) continue;
    if (/(?<![\p{L}])(?:nichts|niemanden|heraus|sich)(?![\p{L}])/iu.test(object)) continue;
    const owner = found.find(
      (m) =>
        m.from >= clauseFrom &&
        m.to <= match.index &&
        data.entities[m.id]?.kind === 'character' &&
        /^\s*$/.test(work.slice(clauseFrom, m.from)),
    );
    const party =
      /^\s*(?:haben|hat|hatten)(?![\p{L}])/iu.test(work.slice(spanFrom, match.index)) ||
      /(?<![\p{L}])(?:die gruppe|wir)(?![\p{L}])/iu.test(before);
    const finding = /(?:gefunden|fand|fanden)\s*$|^\S*\s*(?:fand|fanden)(?![\p{L}])/iu.test(verb);
    if (finding ? !owner : !owner && !party) continue;
    const item = itemName(ctx.line.text.slice(objectAt, objectAt + object.length));
    if (item.length < 3) continue;
    const toId = owner?.id ?? null;
    add(
      'loot',
      `Beute: ${item}${toId ? ` → ${entityName(data, toId)}` : ''}`,
      match.index,
      match.index + verb.length,
      lootPayload([item], '', toId),
      toId ? [toId] : [],
      8,
    );
  }
  // Geschenkt oder übergeben: „Odo gab Mira eine Karte“, „schenkte der Gruppe ein Seil“.
  for (const match of work.matchAll(GIVEN)) {
    const to = match[1]!;
    const toAt = match.index + match[0].indexOf(to);
    const object = match[2]!;
    const objectAt = match.index + match[0].lastIndexOf(object);
    if (namesThing(found, object, objectAt)) continue;
    const receiver = found.find((m) => m.from === toAt);
    const group = /^der\s+gruppe$/iu.test(to);
    if (!group && data.entities[receiver?.id ?? '']?.kind !== 'character') continue;
    const toId = group ? null : receiver!.id;
    const spanFrom = ctx.spans[sentenceOf(ctx, match.index)]?.from ?? 0;
    const giver = found
      .filter(
        (m) =>
          m.from >= spanFrom &&
          m.to <= match.index &&
          ['person', 'faction', 'family', 'character'].includes(data.entities[m.id]?.kind ?? ''),
      )
      .pop();
    const item = itemName(ctx.line.text.slice(objectAt, objectAt + object.length));
    if (item.length < 3) continue;
    add(
      'loot',
      `Beute: ${item}${toId ? ` → ${entityName(data, toId)}` : ''}`,
      match.index,
      match.index + match[0].length,
      lootPayload([item], giver ? entityName(data, giver.id) : '', toId),
      [...new Set([...(toId ? [toId] : []), ...(giver ? [giver.id] : [])])],
      8,
    );
  }
  // Beute im Satz: „Erbeutet: 2 Wolfspelze, 1 Silberkette …“
  for (const match of work.matchAll(
    /(?:^|[\s:])(?:bekommen|erbeutet|erhalten|loot|beute)\s*:\s*([^.!?]{3,})/giu,
  )) {
    const list = ctx.line.text
      .slice(match.index + match[0].indexOf(match[1]!), match.index + match[0].length)
      .trim();
    const items = list.split(/\s*,\s*|\s+sowie\s+|\s+und\s+/u).filter(Boolean);
    add(
      'loot',
      `Beute: ${list}`,
      match.index,
      match.index + match[0].length,
      lootPayload(items, '', null),
      [],
      9,
    );
  }
  return out;
}

const OWN_DET = String.raw`(?:den|die|das|einen|eine|ein|sein|seine|seinen|ihr|ihre|ihren|\d+)`;
const OWN_OBJECT = String.raw`(${OWN_DET}\s+[^,.;:!?]{2,60}?)`;
/** „nahm … an sich“, „… an sich genommen“, „hat … behalten / gefunden“, „behielt / fand …“. */
const OWNED = new RegExp(
  [
    String.raw`(?<![\p{L}])(?:nahm|nahmen)\s+${OWN_OBJECT}\s+an\s+sich(?![\p{L}])`,
    String.raw`(?<![\p{L}])${OWN_OBJECT}\s+an\s+sich\s+genommen(?![\p{L}])`,
    String.raw`(?<![\p{L}])(?:hat|haben|hatte|hatten)\s+${OWN_OBJECT}\s+(?:behalten|gefunden|eingesteckt)(?![\p{L}])`,
    String.raw`(?<![\p{L}])(?:behielt|behielten|fand|fanden)\s+${OWN_OBJECT}(?=\s*(?:[,.;!?]|$)|\s+und\s)`,
  ].join('|'),
  'giu',
);

/**
 * „gab Mira eine Karte“, „schenkte der Gruppe ein Seil“ – an einen Gefährten oder die Gruppe;
 * „gab ihnen …“ bleibt offen (wem?).
 */
const GIVEN = new RegExp(
  String.raw`(?<![\p{L}])(?:gab|gaben|schenkte|schenkten|überreichte|überreichten|übergab|übergaben)\s+(der\s+Gruppe|\p{Lu}[\p{L}’'-]+)\s+${OWN_OBJECT}(?=\s*(?:[,.;!?]|$)|\s+(?:und|zurück)(?![\p{L}]))`,
  'giu',
);

/** Steht hinter dem Begleiter gleich ein Name der Welt („den Krummzahn“)? */
function namesThing(found: Mention[], object: string, objectAt: number): boolean {
  const head = objectAt + (/^\S+\s+/u.exec(object)?.[0].length ?? 0);
  return found.some((m) => m.from === head);
}

/** Der Gegenstand ohne Begleiter und ohne Ort dahinter: „die Laterne im Keller“ → „Laterne“. */
function itemName(text: string): string {
  return text
    .replace(/^(?:den|die|das|dem|einen|eine|ein|sein|seine|seinen|ihr|ihre|ihren)\s+/iu, '')
    .replace(/\s+(?:im|in|am|an|auf|beim|bei|unter|aus|hinter|neben)\s+[^,]*$/iu, '')
    .trim();
}

/** Tötet die Gruppe etwas, das kein Name der Welt ist („Haben den Grubenwurm getötet“). */
const PARTY_KILL =
  /(?<![\p{L}])(?:tötete|töteten|getötet|töten|erschlug|erschlugen|erschlagen|besiegt|besiegten|ausgeschaltet)(?![\p{L}])/giu;
const KILL_OBJECT_AFTER =
  /^\s+(?:den|die|das|einen|eine|ein|mehrere|alle|beide|zwei|drei|vier|fünf)(?![\p{L}])/iu;
const KILL_OBJECT_BEFORE =
  /(?<![\p{L}])(?:den|die|das|einen|eine|ein|mehrere|alle|beide|\d+)\s+[^,.;:!?]{1,40}$/iu;

/**
 * Ein Kampf, den die Gruppe gewinnt, weil sie ihren Gegner tötet: Steht in der Zeile schon ein
 * Kampf, ist er gewonnen; sonst wird es einer. Tötet sie eine Person der Welt, ist das ein Schicksal.
 */
function partyKills(ctx: LineContext, found: Candidate[]): Candidate[] {
  const { work } = ctx;
  for (const match of work.matchAll(PARTY_KILL)) {
    const index = sentenceOf(ctx, match.index);
    const span = ctx.spans[index] ?? { from: 0, to: work.length };
    const sentence = ctx.line.from + span.from;
    const before = work.slice(span.from, match.index);
    const party =
      /^\s*(?:haben|hat|hatten)(?![\p{L}])/iu.test(before) ||
      /(?<![\p{L}])(?:die gruppe|der gruppe|wir)(?![\p{L}])/iu.test(before);
    if (!party) continue;
    const finite = /^(?:tötete|töteten|erschlug|erschlugen|besiegten)$/iu.test(match[0]);
    const object = finite
      ? KILL_OBJECT_AFTER.test(work.slice(match.index + match[0].length))
      : KILL_OBJECT_BEFORE.test(before);
    if (!object) continue;
    if (
      found.some(
        (c) =>
          c.sentence === sentence &&
          c.kind === 'fate' &&
          (c.payload.fate as { entityId: string | null } | undefined)?.entityId,
      )
    )
      continue;
    const fights = found.filter((c) => c.kind === 'fight');
    if (fights.length) {
      for (const fight of fights) {
        const outcome = (fight.payload.fight as { outcome?: string } | undefined)?.outcome;
        if (outcome && outcome !== 'open') continue;
        fight.payload = { ...fight.payload, fight: { outcome: 'won' } };
        fight.label = `${fight.label} · ${FIGHT_OUTCOME_LABEL.won}`;
      }
      continue;
    }
    found.push(
      toCandidate(
        ctx,
        {
          kind: 'fight',
          label: `Kampf · ${FIGHT_OUTCOME_LABEL.won}`,
          payload: { fight: { outcome: 'won' } },
          refs: [],
          from: match.index,
          to: match.index + match[0].length,
        },
        span,
        index,
      ),
    );
  }
  return found;
}

/** Beute in den Angaben eines Vorschlags: Gegenstände, Gold in Goldmünzen, Empfänger (null = Gruppe). */
function lootPayload(lines: string[], source: string, toId: string | null) {
  let gold = 0;
  const items: string[] = [];
  for (const line of lines) {
    const coins = coinGold(line);
    if (coins !== null) gold += coins;
    else if (line.trim()) items.push(line.trim());
  }
  return { text: items.join(', '), gold: Math.round(gold * 100) / 100, toId, source, items };
}

// ── Lesen ──────────────────────────────────────────────────────────────────

export interface ReadOptions {
  /** ISO-Zeit des Lesens; Vorgabe: jetzt am Rechner. */
  readAt?: string;
  /** Der vorige Stand: Entscheidungen bleiben (`mergeReading`). */
  previous?: SessionReading | null;
}

/** Ein kurzer Fingerabdruck eines Textes. */
export function textMark(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`;
}

/** Woran ein Vorschlag beim erneuten Lesen wiedererkannt wird: Art, Satz, Stelle unter Gleichen. */
export function proposalKey(kind: ReadProposalKind, quote: string, ordinal = 0): string {
  const base = foldName(quote)
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
  return `${kind}:${base}${ordinal ? `#${ordinal}` : ''}`;
}

const sectionOf = (kind: NoteBlock['kind']): ReadSectionKind => kind;

/** Die Notizen einer Session: nachgetragen (`source`) oder die eigene Mitschrift. */
export const sessionNotes = (session: Session) => session.source?.text ?? session.notes ?? '';

/** Was eine Session sonst noch über Leben und Tod sagt – für Widersprüche über Sessions hinweg. */
interface SessionFacts {
  number: number;
  /** Wer erwähnt wird – und in welcher Zeile zuerst. */
  mentioned: Map<string, number>;
  /** Wer (wieder) lebt bzw. stirbt. */
  alive: Set<string>;
  dead: Set<string>;
}

/**
 * Handelt der Genannte selbst? Er steht vorn im Satz oder Teilsatz und ein Tun folgt – „der
 * Grabstein von Krummzahn“ oder „das Lager von Krummzahn“ zählen nicht.
 */
function acting(text: string, m: Mention): boolean {
  const before = text.slice(0, m.from);
  if (/(?:von|vom|des|der|den|dem|zu|mit|bei|für|über|um|an|auf)\s+$/iu.test(before)) return false;
  // „die Leichen von Odo und Krummzahn lagen …“: auch der zweite Name hängt am „von“.
  if (
    /(?<![\p{L}])(?:von|vom|des|der|den|dem|zu|mit|bei|für|über|um|an|auf)\s+\p{Lu}[\p{L}’'-]*(?:\s+\p{Lu}[\p{L}’'-]*)?(?:\s*,\s*\p{Lu}[\p{L}’'-]*(?:\s+\p{Lu}[\p{L}’'-]*)?)*\s+(?:und|oder|sowie)\s+$/u.test(
      before,
    )
  )
    return false;
  if (!/(?:^|[.!?:;,]\s*|\s(?:und|dann|als|während)\s+)$/u.test(before)) return false;
  return /^\s+\p{Ll}/u.test(text.slice(m.to));
}

const factsCache = new WeakMap<CampaignData['entities'], WeakMap<Session, SessionFacts>>();

function sessionFacts(world: CampaignData, session: Session): SessionFacts {
  let byWorld = factsCache.get(world.entities);
  if (!byWorld) factsCache.set(world.entities, (byWorld = new WeakMap()));
  const cached = byWorld.get(session);
  if (cached) return cached;
  const text = sessionNotes(session);
  const blocks = noteBlocks(text);
  const work = readingText(text);
  const local = tolerantWorld(world, work);
  const facts: SessionFacts = {
    number: session.number,
    mentioned: new Map(),
    alive: new Set(),
    dead: new Set(),
  };
  for (const block of blocks) {
    if (block.kind === 'recap' || block.kind === 'rules') continue;
    for (const line of block.lines) {
      const lineWork = work.slice(line.from, line.to);
      const found = mentions(local, lineWork);
      for (const m of found)
        if (!facts.mentioned.has(m.id) && acting(lineWork, m))
          facts.mentioned.set(m.id, line.index + 1);
      if (block.kind !== 'text') continue;
      const spans = splitSentences(lineWork);
      const ctx: LineContext = {
        data: local,
        line,
        work: lineWork,
        spans,
        secret: spans.map(() => false),
        found,
      };
      for (const c of [...recognized(ctx), ...extras(ctx)]) {
        if (c.kind !== 'fate') continue;
        const fate = c.payload.fate as
          { entityId: string | null; status: PersonStatus } | undefined;
        if (!fate?.entityId) continue;
        (fate.status === 'alive' ? facts.alive : facts.dead).add(fate.entityId);
      }
    }
  }
  byWorld.set(session, facts);
  return facts;
}

/**
 * Hinweise auf Widersprüche: Stirbt jemand in dieser Session und kommt in einer späteren wieder
 * vor (ohne dass dort steht, dass er zurückkehrt), oder steht in der Chronik später etwas anderes.
 */
function contradictions(
  data: CampaignData,
  world: CampaignData,
  session: Session,
  candidate: Candidate,
  at: WorldTime,
): string[] {
  if (candidate.kind !== 'fate') return [];
  const fate = candidate.payload.fate as
    { entityId: string | null; status: PersonStatus } | undefined;
  if (!fate?.entityId) return [];
  const id = fate.entityId;
  const name = entityName(data, id);
  const hints: string[] = [];
  const others = Object.values(data.sessions)
    .filter((s) => s.id !== session.id && sessionNotes(s).trim())
    .sort((a, b) => a.number - b.number || a.startAt - b.startAt);
  if (fate.status === 'dead' || fate.status === 'missing') {
    for (const later of others.filter((s) => s.number > session.number)) {
      const facts = sessionFacts(world, later);
      if (facts.alive.has(id)) break;
      const line = facts.mentioned.get(id);
      if (line !== undefined) {
        hints.push(
          `In Session ${later.number} (Zeile ${line}) kommt ${name} wieder vor – ${fate.status === 'dead' ? 'tot' : 'verschollen'} hier, aber dort ohne Rückkehr.`,
        );
        break;
      }
      if (facts.dead.has(id)) break;
    }
  } else if (fate.status === 'alive') {
    const earlier = others.filter((s) => s.number < session.number);
    const died = earlier.some((s) => sessionFacts(world, s).dead.has(id));
    const status = data.entities[id]?.kind === 'person' || data.entities[id]?.kind === 'character';
    const recorded = Object.values(data.chronicle).some(
      (e) =>
        e.kind === 'fate' && e.fate?.entityId === id && e.fate.status !== 'alive' && e.at <= at,
    );
    if (status && !died && !recorded)
      hints.push(`Vorher steht nirgends, dass ${name} tot oder verschollen war.`);
  }
  for (const entry of Object.values(data.chronicle)) {
    if (entry.kind !== 'fate' || entry.fate?.entityId !== id || entry.at <= at) continue;
    if (entry.fate.status === fate.status) continue;
    hints.push(`In der Chronik steht später: ${name} – ${FATE_LABEL[entry.fate.status]}.`);
    break;
  }
  return hints;
}

/**
 * Liest die Notizen einer Session und schlägt vor, was daraus für die Chronik, die Fäden und das
 * Beute-Buch folgt. `data` ist der Spielstand (für Namen, andere Sessions und die Chronik).
 */
export function readSession(
  data: CampaignData,
  session: Session,
  options: ReadOptions = {},
): SessionReading {
  const text = sessionNotes(session);
  const blocks = noteBlocks(text);
  const work = readingText(text);
  const world = tolerantWorld(data, work);
  const recap = recapOf(blocks);
  const candidates: Candidate[] = [];
  const pieces: TextPiece[] = [];
  const notes: { candidate: Candidate; weight: number }[] = [];

  const ctxOf = (line: NoteLine): LineContext => {
    const lineWork = work.slice(line.from, line.to);
    const spans = splitSentences(lineWork);
    return {
      data: world,
      line,
      work: lineWork,
      spans,
      secret: secretSentences(lineWork, spans),
      found: mentions(world, lineWork),
    };
  };

  let previousText = '';
  let previousLine: NoteLine | null = null;
  /** Zeilen, die nur ein Schriftstück ankündigen – sie werden keine eigene Notiz. */
  const introLines = new Set<number>();
  for (const block of blocks) {
    for (const line of namedLines(block))
      pieces.push({ text: work.slice(line.from, line.to), line: line.index });
    const at = block.lines[0]!;
    const whole = (lines: NoteLine[]) => ({
      from: lines[0]!.from,
      to: lines[lines.length - 1]!.to,
      quote: blockText(lines).trim(),
    });
    switch (block.kind) {
      case 'hooks':
        for (const item of block.items) {
          const title = stripBullet(item.text);
          const found = mentions(world, work.slice(item.from, item.to));
          candidates.push({
            kind: 'thread',
            label: `Faden: ${title}`,
            quote: item.text.trim(),
            text: title,
            from: item.from,
            to: item.to,
            line: item.index + 1,
            refs: [...new Set(found.map((m) => m.id))],
            payload: { title },
            secret: false,
            priority: ALWAYS,
            sentence: item.from,
          });
        }
        break;
      case 'loot':
        for (const group of block.groups) {
          const source = group.source?.text.trim() ?? '';
          const payload = lootPayload(
            group.items.map((l) => l.text),
            source,
            null,
          );
          const lines = [...(group.source ? [group.source] : []), ...group.items];
          const span = whole(lines);
          const shown = [payload.text, payload.gold ? `${payload.gold} Gold` : '']
            .filter(Boolean)
            .join(', ');
          candidates.push({
            kind: 'loot',
            label: `Beute${source ? ` von ${source}` : ''}: ${shown}`,
            quote: span.quote,
            text: payload.text,
            from: span.from,
            to: span.to,
            line: lines[0]!.index + 1,
            // Die Quelle ist oft ein Name der Welt (wessen Leiche).
            refs: group.source
              ? [
                  ...new Set(
                    mentions(world, work.slice(group.source.from, group.source.to)).map(
                      (m) => m.id,
                    ),
                  ),
                ]
              : [],
            payload,
            secret: false,
            priority: ALWAYS,
            sentence: span.from,
          });
          // „Bei den Toten fand die Gruppe:“ – wessen Beute, der ist tot.
          const head = block.head;
          if (head && group.source && CORPSES.test(head.text)) {
            const dead = mentions(world, work.slice(group.source.from, group.source.to)).filter(
              (m) => world.entities[m.id]?.kind === 'person',
            );
            if (dead.length === 1) {
              const id = dead[0]!.id;
              candidates.push({
                kind: 'fate',
                label: `Schicksal: ${entityName(world, id)} → ${FATE_LABEL.dead}`,
                quote: `${head.text.trim()} ${source}`,
                text: `${head.text.trim()} ${source}`,
                from: group.source.from,
                to: group.source.to,
                line: group.source.index + 1,
                refs: [id],
                payload: { fate: { entityId: id, status: 'dead' } },
                secret: false,
                priority: ALWAYS,
                sentence: group.source.from,
              });
            }
          }
        }
        break;
      case 'purchases':
        for (const row of block.rows) {
          if (
            /nicht\s+(?:gekauft|genommen|mitgenommen)|zurückgelassen|abgelehnt|liegen\s+gelassen/iu.test(
              row.note,
            )
          )
            continue;
          const to =
            /(?:[Gg]egeben|[Gg]eschenkt|[Üü]berreicht|[Üü]bergeben)\s+an\s+(\p{Lu}[\p{L}’'-]+)/u.exec(
              row.note,
            )?.[1] ??
            /(?:[Gg]ekauft|[Bb]ezahlt|[Ee]rworben)\s+für\s+(\p{Lu}[\p{L}’'-]+)/u.exec(
              row.note,
            )?.[1] ??
            row.who;
          const ids = entitiesNamed(world, to, ['character']);
          const toId = ids.length === 1 ? ids[0]! : null;
          candidates.push({
            kind: 'loot',
            label: `Beute: ${row.item} → ${toId ? entityName(world, toId) : to}`,
            quote: row.line.text.trim(),
            text: row.item,
            from: row.line.from,
            to: row.line.to,
            line: row.line.index + 1,
            refs: toId ? [toId] : [],
            payload: {
              ...lootPayload([row.item], row.note, toId),
              ...(toId ? {} : { toName: to }),
            },
            secret: false,
            priority: ALWAYS,
            sentence: row.line.from,
          });
        }
        break;
      case 'writing': {
        const body = whole(block.body);
        const title = writingTitle(block, previousText);
        // Die Zeile davor kündigte das Schriftstück an („brachte eine Nachricht von …“).
        if (!block.intro && previousLine && title !== 'Schriftstück')
          introLines.add(previousLine.index + 1);
        else if (
          block.intro &&
          /^\s*(?:dort|darauf|darin|hier)\s+stand/iu.test(block.intro.text) &&
          previousLine
        )
          introLines.add(previousLine.index + 1);
        const sender = /(?:von|vom)\s+(\p{Lu}[\p{L}’'-]+(?:\s+\p{Lu}[\p{L}’'-]+)?)\s*$/u.exec(
          title,
        )?.[1];
        const named = sender ? entitiesNamed(world, sender, PEOPLE) : [];
        const ids = named.length
          ? named
          : sender
            ? [
                ...new Set(
                  mentions(world, sender)
                    .filter((m) => PEOPLE.includes(world.entities[m.id]!.kind))
                    .map((m) => m.id),
                ),
              ]
            : [];
        candidates.push({
          kind: 'writing',
          label: `Schriftstück: ${title}`,
          quote: body.quote,
          text: body.quote,
          from: body.from,
          to: body.to,
          line: block.body[0]!.index + 1,
          refs: ids.length === 1 ? [ids[0]!] : [],
          payload: { writing: { title } },
          secret: false,
          priority: ALWAYS,
          sentence: body.from,
        });
        break;
      }
      case 'quote': {
        const joined = `${work.slice(block.intro.from, block.intro.to)} ${work.slice(block.said.from, block.said.to)}`;
        const item = recognizeEntry(world, joined).find((i) => i.kind === 'quote');
        const said = block.said.text.trim();
        candidates.push({
          kind: 'quote',
          label: item?.label ?? 'Zitat',
          quote: `${block.intro.text.trim()} ${said}`,
          text: said,
          from: block.intro.from,
          to: block.said.to,
          line: block.said.index + 1,
          refs: item?.refs ?? [],
          payload: {},
          secret: false,
          priority: 5,
          sentence: block.intro.from,
        });
        break;
      }
      case 'order': {
        const span = whole(block.lines);
        candidates.push({
          kind: 'note',
          label: 'Bestellung',
          quote: span.quote,
          text: span.quote,
          from: span.from,
          to: span.to,
          line: at.index + 1,
          refs: [...new Set(mentions(world, work.slice(span.from, span.to)).map((m) => m.id))],
          payload: {},
          secret: false,
          priority: 5,
          sentence: span.from,
        });
        break;
      }
      case 'text': {
        const line = block.lines[0]!;
        const ctx = ctxOf(line);
        const found = partyKills(ctx, [...recognized(ctx), ...extras(ctx)]);
        // Je Satz höchstens zwei – die wichtigsten.
        const bySentence = new Map<number, Candidate[]>();
        for (const c of found) {
          const list = bySentence.get(c.sentence) ?? [];
          list.push(c);
          bySentence.set(c.sentence, list);
        }
        const kept: Candidate[] = [];
        for (const list of bySentence.values()) {
          const unique = list.filter(
            (c, i) =>
              !list.some(
                (o, j) =>
                  j < i &&
                  o.kind === c.kind &&
                  JSON.stringify(o.payload) === JSON.stringify(c.payload),
              ),
          );
          kept.push(...unique.sort((a, b) => b.priority - a.priority).slice(0, PER_SENTENCE));
        }
        // Ein Absatz erzählt meist einen Kampf: nur der erste wird ein Vorschlag – mit dem
        // Ausgang, den ein späterer Satz nennt.
        const fights = kept.filter((c) => c.kind === 'fight').sort((a, b) => a.from - b.from);
        const outcomeOf = (c: Candidate) =>
          (c.payload.fight as { outcome?: FightOutcome } | undefined)?.outcome ?? 'open';
        for (const extra of fights.slice(1)) {
          const first = fights[0]!;
          const outcome = outcomeOf(extra);
          if (outcomeOf(first) === 'open' && outcome !== 'open') {
            first.payload = { ...first.payload, fight: { outcome } };
            first.label = `${first.label} · ${FIGHT_OUTCOME_LABEL[outcome]}`;
          }
          kept.splice(kept.indexOf(extra), 1);
        }
        candidates.push(...kept);
        // Sätze ohne Erkanntes: eine Notiz je Zeile (Geheimes für sich), wenn sie etwas erzählt.
        if (SESSION_END.test(line.text) && !kept.length) break;
        const claimed = new Set(kept.map((c) => c.sentence - line.from));
        let group: { from: number; to: number; secret: boolean } | null = null;
        const flush = () => {
          if (!group) return;
          const textPart = line.text.slice(group.from, group.to).trim();
          const workPart = ctx.work.slice(group.from, group.to);
          const words = textPart.split(/\s+/).filter(Boolean).length;
          const own = ctx.found.filter((m) => m.from >= group!.from && m.to <= group!.to);
          if (words >= 4 && !SESSION_END.test(textPart)) {
            const candidate: Candidate = {
              kind: 'note',
              label: group.secret ? 'Notiz (nur für die Spielleitung)' : 'Notiz',
              quote: textPart,
              text: textPart,
              from: line.from + group.from,
              to: line.from + group.to,
              line: line.index + 1,
              refs: [...new Set(own.map((m) => m.id))],
              payload: {},
              secret: group.secret,
              priority: 0,
              sentence: line.from + group.from,
            };
            notes.push({
              candidate,
              weight: noteWeight(world, workPart, own, 0) + (group.secret ? 1 : 0),
            });
          }
          group = null;
        };
        ctx.spans.forEach((span, index) => {
          if (claimed.has(span.from)) {
            flush();
            return;
          }
          const secret = ctx.secret[index] ?? false;
          if (group && group.secret !== secret) flush();
          if (!group) group = { from: span.from, to: span.to, secret };
          else group.to = span.to;
        });
        flush();
        break;
      }
      default:
        break;
    }
    if (block.kind === 'text') {
      previousText = block.lines[0]!.text;
      previousLine = block.lines[0]!;
    }
  }

  for (let i = notes.length - 1; i >= 0; i--)
    if (introLines.has(notes[i]!.candidate.line)) notes.splice(i, 1);

  // Zwischenzeit: „Mira Downtime: …“, „Lando Downtime: …“ – ein Vorschlag mit den Tätigkeiten.
  mergeDowntimes(world, text, candidates, notes);

  // Fragen zu unbekannten Namen.
  const corpus = Object.values(data.sessions)
    .filter((s) => s.id !== session.id)
    .map(sessionNotes)
    .filter(Boolean);
  const questionDrafts = unknownNames(world, pieces, corpus);
  for (const note of notes) {
    const unknown = questionDrafts.filter(
      (q) => note.candidate.line - 1 === q.lines.find((l) => l === note.candidate.line - 1),
    ).length;
    note.weight += Math.min(2, unknown);
  }

  // Dasselbe Schicksal mehrmals in einer Session: das erste zählt („lebt“ nach der Rückkehr
  // noch einmal erwähnt).
  // In einer Zeile zählt der spätere Satz („beinahe getötet …, dann besiegelt“).
  const seenFates = new Map<string, Candidate>();
  for (const c of [...candidates].sort((a, b) => a.from - b.from)) {
    const fate =
      c.kind === 'fate' ? (c.payload.fate as { entityId: string | null; status: string }) : null;
    if (!fate?.entityId) continue;
    const key = `${fate.entityId}:${fate.status}`;
    const first = seenFates.get(key);
    if (!first) {
      seenFates.set(key, c);
      continue;
    }
    const drop = first.line === c.line ? first : c;
    candidates.splice(candidates.indexOf(drop), 1);
    if (drop === first) seenFates.set(key, c);
  }

  // Auswahl: Wichtiges immer, dann nach Wichtigkeit bis zur Grenze; Notizen füllen auf.
  const always = candidates.filter((c) => c.priority >= ALWAYS);
  const rest = candidates
    .filter((c) => c.priority < ALWAYS)
    .sort((a, b) => b.priority - a.priority);
  const room = Math.max(0, MAX_PROPOSALS - always.length);
  const chosen = [...always, ...rest.slice(0, room)];
  const noteRoom = Math.max(0, MAX_PROPOSALS - chosen.length);
  // Notizen: die gewichtigen; sind es zu wenige Vorschläge, auch schwächere, die etwas erzählen.
  const ranked = notes.sort((a, b) => b.weight - a.weight);
  const strong = ranked.filter((n) => n.weight >= 2);
  const weak = ranked.filter((n) => n.weight < 2 && n.weight >= 1);
  const fill = Math.max(0, MIN_PROPOSALS - chosen.length - strong.length);
  const goodNotes = [...strong, ...weak.slice(0, fill)].slice(0, noteRoom).map((n) => n.candidate);
  const selected = [...chosen, ...goodNotes].sort(
    (a, b) => a.from - b.from || b.priority - a.priority,
  );

  // Zeit in der Reihenfolge des Textes.
  const now = data.state.now;
  const times = spreadTimes(
    data.campaign.calendar,
    {
      startAt: session.startAt,
      endAt: session.endAt,
      precision: session.source?.precision ?? 'exact',
    },
    text,
    selected.map((c) => c.from),
    now,
  );

  const ordinals = new Map<string, number>();
  const proposals: ReadProposal[] = selected.map((c, i) => {
    const base = proposalKey(
      c.kind,
      c.kind === 'loot' || c.kind === 'thread' ? `${c.quote}|${c.text}` : c.quote,
    );
    const ordinal = ordinals.get(base) ?? 0;
    ordinals.set(base, ordinal + 1);
    const time = times[i]!;
    const names = questionDrafts
      .filter((q) => q.lines.includes(c.line - 1) && foldName(c.quote).includes(q.key))
      .map((q) => q.key);
    return {
      id: newId(),
      key: ordinal ? `${base}#${ordinal}` : base,
      kind: c.kind,
      label: c.label,
      quote: c.quote,
      text: c.text,
      line: c.line,
      from: c.from,
      to: c.to,
      at: time.at,
      precision: time.precision as ChroniclePrecision,
      secret: c.secret,
      refs: c.refs,
      payload: c.payload,
      hints: contradictions(data, world, session, c, time.at),
      names,
      state: 'open',
      created: [],
      edits: [],
      stale: false,
    };
  });

  const questions: ReadQuestion[] = questionDrafts.map((q) => ({
    key: q.key,
    name: q.name,
    count: q.count,
    lines: q.lines.map((l) => l + 1),
    state: 'open',
    entityId: null,
  }));

  const sections = sectionsOf(blocks);
  const reading: SessionReading = {
    readAt: options.readAt ?? new Date().toISOString(),
    mark: textMark(text),
    recap,
    proposals,
    questions,
    sections,
  };
  return options.previous ? mergeReading(options.previous, reading) : reading;
}

/** Zeilen, in denen Namen stehen dürfen: kein Rückblick, keine Regeln, aus Listen nur die Namen davor. */
function namedLines(block: NoteBlock): NoteLine[] {
  switch (block.kind) {
    case 'recap':
    case 'rules':
      return [];
    case 'loot':
      return block.groups.flatMap((group) => (group.source ? [group.source] : []));
    case 'purchases':
      return block.rows.map((row) => ({
        ...row.line,
        to: row.line.from + row.line.text.indexOf(':'),
        text: row.who,
      }));
    case 'order':
      return [block.head];
    default:
      return block.lines;
  }
}

/** Die Abschnitte zum Anzeigen: aufeinanderfolgender Text zusammengefasst. */
function sectionsOf(blocks: NoteBlock[]): SessionReading['sections'] {
  const out: SessionReading['sections'] = [];
  for (const block of blocks) {
    const from = block.lines[0]!.index + 1;
    const to = block.lines[block.lines.length - 1]!.index + 1;
    const kind = sectionOf(block.kind);
    const last = out[out.length - 1];
    if (last && last.kind === kind && (kind === 'text' || kind === 'rules')) {
      last.to = to;
      continue;
    }
    const title =
      block.kind === 'writing'
        ? block.title || block.intro?.text.trim() || ''
        : 'head' in block && block.head
          ? block.head.text.trim().replace(/:\s*$/, '')
          : block.kind === 'heading'
            ? block.lines[0]!.text.trim().replace(/:\s*$/, '')
            : '';
    out.push({ kind, from, to, title: titleCase(title) });
  }
  return out;
}

const DOWNTIME_LINE =
  /^\s*(\p{Lu}[\p{L}’'-]+(?:\s+\p{Lu}[\p{L}’'-]+)?)\s+(?:downtime|zwischenzeit)\s*:\s*(.+)$/iu;

/**
 * Mehrere Zeilen „Name Downtime: Tätigkeit“ werden ein Vorschlag „Zwischenzeit“ mit den
 * Tätigkeiten der Gefährten; Tage, wenn eine Zeile sie nennt („drei Wochen lang“).
 */
function mergeDowntimes(
  world: CampaignData,
  text: string,
  candidates: Candidate[],
  notes: { candidate: Candidate }[],
) {
  const lines = text.split('\n');
  const activities: { characterId: string; text: string }[] = [];
  const rows: number[] = [];
  lines.forEach((raw, index) => {
    const match = DOWNTIME_LINE.exec(raw.replace(/\r$/, ''));
    if (!match) return;
    const ids = entitiesNamed(world, match[1]!, ['character']);
    if (ids.length !== 1) return;
    activities.push({ characterId: ids[0]!, text: match[2]!.trim() });
    rows.push(index + 1);
  });
  if (!activities.length) return;
  // Was in diesen Zeilen sonst erkannt wurde („übt im Kampf“), ist Tätigkeit, kein Geschehen.
  const own = candidates.filter((c) => rows.includes(c.line));
  for (let i = notes.length - 1; i >= 0; i--)
    if (rows.includes(notes[i]!.candidate.line)) notes.splice(i, 1);
  const days =
    own
      .map((c) => (c.payload.downtime as { days: number | null } | undefined)?.days ?? null)
      .find((d): d is number => d !== null) ?? null;
  const first = own[0] ?? candidates.find((c) => c.line === rows[0]);
  for (const c of own) candidates.splice(candidates.indexOf(c), 1);
  const start =
    text
      .split('\n')
      .slice(0, rows[0]! - 1)
      .join('\n').length + (rows[0]! > 1 ? 1 : 0);
  const end = text
    .split('\n')
    .slice(0, rows[rows.length - 1]!)
    .join('\n').length;
  const quote = text.slice(start, end).replace(/\r/g, '').trim();
  candidates.push({
    kind: 'downtime',
    label: `Zwischenzeit${days !== null ? `: ${days === 1 ? '1 Tag' : `${days} Tage`}` : ''} – ${activities.map((a) => entityName(world, a.characterId)).join(', ')}`,
    quote,
    text: quote,
    from: first?.from ?? start,
    to: end,
    line: rows[0]!,
    refs: activities.map((a) => a.characterId),
    payload: { downtime: { days, activities } },
    secret: false,
    priority: ALWAYS,
    sentence: start,
  });
}

/**
 * Erneutes Lesen: Was der Spielleiter angenommen oder verworfen hat, bleibt – über den Schlüssel
 * aus Art und Satz. Entschiedenes, das nicht mehr in den Notizen steht, bleibt als „nicht mehr
 * da“ stehen; Antworten auf Fragen zu Namen bleiben.
 */
export function mergeReading(previous: SessionReading, next: SessionReading): SessionReading {
  const before = new Map(previous.proposals.map((p) => [p.key, p]));
  const used = new Set<string>();
  const proposals = next.proposals.map((p) => {
    const old = before.get(p.key);
    if (!old) return p;
    used.add(p.key);
    if (old.state === 'open') return { ...p, id: old.id };
    // Entschieden: so, wie es entschieden wurde – nur die Stelle im Text folgt den Notizen.
    return { ...old, line: p.line, from: p.from, to: p.to, stale: false };
  });
  for (const old of previous.proposals)
    if (!used.has(old.key) && old.state !== 'open') proposals.push({ ...old, stale: true });
  const answers = new Map(previous.questions.map((q) => [q.key, q]));
  const questions = next.questions.map((q) => {
    const old = answers.get(q.key);
    return old && old.state !== 'open' ? { ...q, state: old.state, entityId: old.entityId } : q;
  });
  return { ...next, proposals, questions };
}

/** Kurz in Worten, was ein Vorschlag ist – „Schicksal“, „Faden“, „Beute“. */
export function proposalKindLabel(kind: ReadProposalKind): string {
  if (kind === 'thread') return 'Faden';
  if (kind === 'loot') return 'Beute';
  return KIND_LABEL[kind];
}

/** Sicher = ohne offene Frage und ohne Widerspruch, und alle nötigen Dinge stehen fest. */
export function isSafeProposal(reading: SessionReading, proposal: ReadProposal): boolean {
  if (proposal.state !== 'open' || proposal.stale || proposal.hints.length) return false;
  const open = new Set(reading.questions.filter((q) => q.state === 'open').map((q) => q.key));
  if (proposal.names.some((key) => open.has(key))) return false;
  const p = proposal.payload as RecognizedPayload & { name?: string };
  if (p.fate && !p.fate.entityId) return false;
  if (p.whereabouts && !p.whereabouts.entityId) return false;
  if (p.travel && !p.travel.toId) return false;
  if (p.condition && !p.condition.entityId) return false;
  if (p.transformation && !p.transformation.characterId) return false;
  if (p.companion && !p.companion.entityId) return false;
  if (p.attitude) return false; // Haltung braucht immer einen Wert vom Spielleiter.
  if (proposal.kind === 'meeting' || proposal.kind === 'knowledge') return proposal.refs.length > 0;
  return true;
}

/**
 * Was beim Annehmen festgehalten wird (`recordEntries`): nachgetragen, zur Zeit und mit der
 * Genauigkeit des Vorschlags. null bei Faden und Beute (eigene Befehle), bei einem Aufstieg
 * „aller“ (je Gefährte ein Eintrag) und wenn erst ein Ding gewählt werden muss.
 */
export function proposalInput(proposal: ReadProposal, sessionId: string): RecordInput | null {
  if (proposal.kind === 'thread' || proposal.kind === 'loot' || proposal.kind === 'event')
    return null;
  const payload = proposal.payload as RecognizedPayload & {
    party?: boolean;
    writing?: { title?: string };
    downtime?: { days: number | null; activities?: { characterId: string; text: string }[] };
    reveal?: { prepSecretId: string | null; alias: { entityId: string; name: string } | null };
  };
  if (proposal.kind === 'milestone' && payload.party) return null;
  const base = {
    text: proposal.text,
    at: proposal.at,
    sessionId,
    secret: proposal.secret,
    backfilled: true,
    precision: proposal.precision,
  };
  if (proposal.kind === 'writing')
    return {
      ...base,
      kind: 'writing',
      refs: proposal.refs,
      writing: { title: payload.writing?.title ?? '' },
    };
  if (proposal.kind === 'downtime')
    return {
      ...base,
      kind: 'downtime',
      refs: proposal.refs,
      downtime: {
        days: payload.downtime?.days ?? 0,
        activities: payload.downtime?.activities ?? [],
      },
    };
  if (proposal.kind === 'reveal')
    return {
      ...base,
      kind: 'reveal',
      refs: proposal.refs,
      reveal: { prepSecretId: null, alias: payload.reveal?.alias ?? null },
    };
  const input = recognizedInput({
    kind: proposal.kind,
    label: proposal.label,
    payload,
    refs: proposal.refs,
    from: proposal.from,
    to: proposal.to,
  });
  return input ? { ...input, ...base } : null;
}
