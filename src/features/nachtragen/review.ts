/**
 * Eine gelesene Session prüfen – in reinen Funktionen: wie weit das Prüfen ist, die Notizen mit
 * markierten Namen, Tagen und Sätzen, was ein Vorschlag beim Annehmen zusätzlich tun kann
 * (Steckbrief, „Was geschah“, Artikel) und was genau beim Annehmen festgehalten wird
 * (`planAccept`). Geschrieben wird nur in `reviewActions.ts`.
 */
import { FATE_LABEL, type RecordInput } from '../../domain/chronicleKinds';
import { activeParty, entityName } from '../../domain/derive';
import { placeForEntry } from '../../domain/history';
import type { Recognized, RecognizedPayload } from '../../domain/recognize';
import type {
  CampaignData,
  ChroniclePrecision,
  Entity,
  EntityKind,
  ReadProposal,
  ReadProposalKind,
  ReadQuestion,
  ReadSectionKind,
  Session,
  SessionReading,
} from '../../domain/schema';
import {
  formatDate,
  formatDateTime,
  type CalendarDef,
  type WorldTime,
} from '../../domain/time/calendar';
import type { LootInput, LootWhen } from '../beute/actions';
import {
  choiceOfRecognized,
  draftFromRecognized,
  partOf,
  recordCheck,
  recordInputOf,
  type RecordCommon,
  type RecordDraft,
  type RecordFieldsKind,
} from '../chronik/recordDraft';
import { FIELD_LABEL, type FactField } from '../wiki/facts';
import { foldName, mentions, readingText } from './readNames';
import { isSafeProposal, proposalInput, sessionNotes } from './readSession';
import { timeMarks } from './readTime';

// ── Wie weit das Prüfen ist ────────────────────────────────────────────────

export interface ReviewProgress {
  /** Die Notizen wurden gelesen. */
  read: boolean;
  /** Vorschläge, die noch in den Notizen stehen. */
  total: number;
  open: number;
  accepted: number;
  dismissed: number;
  /** Offene Vorschläge mit einem Widerspruch. */
  contradictions: number;
  /** Offene Fragen zu Namen. */
  questions: number;
  /** Offene Vorschläge, die sich ohne Rückfrage annehmen lassen. */
  safe: number;
}

/** Zählt, was an einer Session schon geprüft ist. */
export function reviewProgress(session: Session): ReviewProgress {
  const reading = session.reading;
  if (!reading)
    return {
      read: false,
      total: 0,
      open: 0,
      accepted: 0,
      dismissed: 0,
      contradictions: 0,
      questions: 0,
      safe: 0,
    };
  const current = reading.proposals.filter((p) => !p.stale);
  const open = current.filter((p) => p.state === 'open');
  return {
    read: true,
    total: current.length,
    open: open.length,
    accepted: current.filter((p) => p.state === 'accepted').length,
    dismissed: current.filter((p) => p.state === 'dismissed').length,
    contradictions: open.filter((p) => p.hints.length > 0).length,
    questions: reading.questions.filter((q) => q.state === 'open').length,
    safe: open.filter((p) => isSafeProposal(reading, p)).length,
  };
}

export type ReviewTone = 'ok' | 'warn' | 'mute' | '';

export interface ReviewState {
  text: string;
  tone: ReviewTone;
  /** Entschieden und insgesamt. */
  done: number;
  total: number;
  /** Anteil des Entschiedenen in Prozent für den Balken; null = kein Balken (nichts oder alles geprüft). */
  bar: number | null;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Der Stand einer nachgetragenen Session in Worten – für die Liste. */
export function reviewState(session: Session): ReviewState {
  const p = reviewProgress(session);
  const done = p.accepted + p.dismissed;
  const state = (text: string, tone: ReviewTone): ReviewState => ({
    text,
    tone,
    done,
    total: p.total,
    bar: p.total > 0 && p.open > 0 ? Math.round((100 * done) / p.total) : null,
  });
  if (!p.read) return state('noch nicht gelesen', 'mute');
  if (p.total === 0) return state('gelesen · nichts vorgeschlagen', 'ok');
  if (p.open === 0) return state(`geprüft · ${count(p.accepted, 'Eintrag', 'Einträge')}`, 'ok');
  if (p.contradictions)
    return state(count(p.contradictions, 'Widerspruch', 'Widersprüche'), 'warn');
  if (done === 0) return state(`gelesen · ${count(p.total, 'Vorschlag', 'Vorschläge')}`, '');
  return state(`${done} von ${p.total} geprüft`, '');
}

/** Ist das Prüfen dieser Session fertig? */
export const isReviewed = (session: Session): boolean => {
  const p = reviewProgress(session);
  return p.read && p.open === 0;
};

/** Die erste nachgetragene Session (nach Nummer), die noch zu prüfen ist. */
export function nextToReview(sessions: readonly Session[]): Session | null {
  // Ohne Notizen gibt es nichts zu prüfen – sonst bliebe „Session N prüfen“ dort hängen.
  return sessions.find((s) => s.source && sessionNotes(s).trim() && !isReviewed(s)) ?? null;
}

// ── Vorschläge in Worten ───────────────────────────────────────────────────

/** Wann ein Vorschlag geschah, so genau, wie es bekannt ist. */
export function proposalWhen(cal: CalendarDef, p: Pick<ReadProposal, 'at' | 'precision'>): string {
  if (p.precision === 'exact') return formatDateTime(cal, p.at);
  if (p.precision === 'day') return formatDate(cal, p.at);
  return `ungefähr ${formatDate(cal, p.at)}`;
}

/** Farbe des Etiketts einer Art: Gefahr, Wert, Geheimes, die Gruppe – oder schlicht. */
export type ProposalTone = 'blood' | 'gold' | 'arcane' | 'moss' | '';

const TONES: Partial<Record<ReadProposalKind, ProposalTone>> = {
  fate: 'blood',
  fight: 'blood',
  promise: 'gold',
  meeting: 'gold',
  loot: 'gold',
  bond: 'gold',
  attitude: 'gold',
  writing: 'gold',
  rumor: 'arcane',
  knowledge: 'arcane',
  lore: 'arcane',
  reveal: 'arcane',
  clue: 'arcane',
  thread: 'arcane',
  condition: 'moss',
  milestone: 'moss',
  wish: 'moss',
  transformation: 'moss',
  companion: 'moss',
  downtime: 'moss',
};

export const proposalTone = (kind: ReadProposalKind): ProposalTone => TONES[kind] ?? '';

/** Was sich ohne Rückfrage annehmen lässt – in der Reihenfolge der Notizen. */
export function safeProposals(reading: SessionReading): ReadProposal[] {
  return reading.proposals.filter((p) => isSafeProposal(reading, p));
}

/** Vorschläge, wie sie rechts stehen: in der Reihenfolge der Weltzeit, dann des Textes. */
export function proposalsInOrder(reading: SessionReading): ReadProposal[] {
  return [...reading.proposals].sort(
    (a, b) => Number(a.stale) - Number(b.stale) || a.at - b.at || a.from - b.from,
  );
}

// ── Die Notizen mit Markierungen ───────────────────────────────────────────

/** Ein Stück einer Zeile mit dem, was darin erkannt wurde. */
export interface NoteSegment {
  text: string;
  from: number;
  to: number;
  /** Ein Name der Welt. */
  entityId: string | null;
  /** Ein unbekannter Name (Schlüssel der Frage). */
  question: string | null;
  /** Eine Zeitangabe. */
  date: boolean;
  /** Vorschläge, deren Satz hier steht. */
  proposals: string[];
}

export interface NoteLineView {
  /** Zeile, 1-basiert. */
  line: number;
  from: number;
  to: number;
  segments: NoteSegment[];
  /** Abschnitt, zu dem die Zeile gehört. */
  section: ReadSectionKind | null;
  /** Bezeichnung eines Abschnitts, der mit dieser Zeile beginnt. */
  heading: string | null;
}

/** Wie Abschnitte über den Notizen heißen; die übrigen bekommen keine eigene Bezeichnung. */
export const SECTION_LABEL: Partial<Record<ReadSectionKind, string>> = {
  recap: 'Rückblick für die Spieler – daraus wird nichts vorgeschlagen',
  rules: 'Regelnotizen – nur zum Nachlesen',
  hooks: 'Offene Fäden',
  loot: 'Beute',
  purchases: 'Einkäufe',
  writing: 'Schriftstück',
  order: 'Bestellung',
};

interface Mark {
  from: number;
  to: number;
  entityId?: string;
  question?: string;
  date?: boolean;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Stellen, an denen ein unbekannter Name steht (Groß- und Kleinschreibung egal, ganze Wörter). */
function questionMarks(text: string, questions: readonly ReadQuestion[]): Mark[] {
  const out: Mark[] = [];
  const lower = text.toLocaleLowerCase('de');
  for (const q of questions) {
    if (q.state !== 'open' || !q.name.trim()) continue;
    const needle = q.name.toLocaleLowerCase('de');
    let at = lower.indexOf(needle);
    while (at >= 0) {
      const end = at + needle.length;
      const before = at > 0 ? text[at - 1]! : ' ';
      const after = end < text.length ? text[end]! : ' ';
      if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after))
        out.push({ from: at, to: end, question: q.key });
      at = lower.indexOf(needle, end);
    }
  }
  return out;
}

/**
 * Die Notizen einer Session Zeile für Zeile, zerlegt in Stücke: Namen der Welt, unbekannte
 * Namen, Zeitangaben und die Sätze der Vorschläge. Namen überlagern sich nicht; ein Stück kann
 * zu mehreren Vorschlägen gehören.
 */
export function noteView(data: CampaignData, session: Session): NoteLineView[] {
  const text = sessionNotes(session);
  if (!text) return [];
  const reading = session.reading;
  const cal = data.campaign.calendar;
  const sections = reading?.sections ?? [];
  const sectionOf = (line: number) => sections.find((s) => line >= s.from && line <= s.to) ?? null;

  // Namen: über den tolerant gelesenen Text (gleich lang wie das Original).
  const names: Mark[] = [];
  const skip = new Set<ReadSectionKind>(['recap', 'rules']);
  for (const m of mentions(data, readingText(text))) names.push({ ...m, entityId: m.id });
  const questions = questionMarks(text, reading?.questions ?? []);
  const dates: Mark[] = timeMarks(cal, text, session.startAt).map((m) => ({
    from: m.at,
    to: m.to,
    date: true,
  }));
  // Wer zuerst kommt, gewinnt: Namen vor Fragen vor Zeitangaben.
  const marks: Mark[] = [];
  for (const mark of [...names, ...questions, ...dates].sort((a, b) => a.from - b.from)) {
    if (mark.to <= mark.from) continue;
    if (marks.some((m) => mark.from < m.to && m.from < mark.to)) continue;
    marks.push(mark);
  }
  marks.sort((a, b) => a.from - b.from);
  const proposals = (reading?.proposals ?? [])
    .filter((p) => !p.stale && p.to > p.from)
    .map((p) => ({ id: p.id, from: p.from, to: p.to }));

  const out: NoteLineView[] = [];
  let offset = 0;
  const lines = text.split('\n');
  let previous: ReturnType<typeof sectionOf> = null;
  lines.forEach((raw, index) => {
    const from = offset;
    const to = from + raw.length;
    offset = to + 1;
    const line = index + 1;
    const section = sectionOf(line);
    const heading =
      section && section !== previous && line === section.from
        ? (SECTION_LABEL[section.kind] ?? null)
        : null;
    previous = section;
    const quiet = !!section && skip.has(section.kind);
    // Grenzen der Stücke in dieser Zeile.
    const cuts = new Set<number>([from, to]);
    const inLine = marks.filter((m) => !quiet && m.from < to && m.to > from);
    for (const m of inLine) {
      cuts.add(Math.max(from, m.from));
      cuts.add(Math.min(to, m.to));
    }
    const own = proposals.filter((p) => p.from < to && p.to > from);
    for (const p of own) {
      cuts.add(Math.max(from, p.from));
      cuts.add(Math.min(to, p.to));
    }
    const points = [...cuts].sort((a, b) => a - b);
    const segments: NoteSegment[] = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      if (b <= a) continue;
      const mark = inLine.find((m) => m.from <= a && m.to >= b);
      segments.push({
        text: text.slice(a, b),
        from: a,
        to: b,
        entityId: mark?.entityId ?? null,
        question: mark?.question ?? null,
        date: !!mark?.date,
        proposals: own.filter((p) => p.from <= a && p.to >= b).map((p) => p.id),
      });
    }
    out.push({ line, from, to, segments, section: section?.kind ?? null, heading });
  });
  return out;
}

// ── Was beim Annehmen zusätzlich geschieht ─────────────────────────────────

/** fact: Zeile im Steckbrief; happened: „Was geschah“; article: Schriftstück als Artikel. */
export type ConsequenceKey = 'fact' | 'happened' | 'article';

export interface Consequence {
  key: ConsequenceKey;
  label: string;
  /** Vorgabe des Häkchens. */
  checked: boolean;
}

/** Steckbrief und „Was geschah“ gelten für diesen Eintrag. */
export interface ArticleTarget {
  entityId: string;
  articleId: string;
  /** Feld im Steckbrief, wenn die Art eines setzt. */
  fact: { kind: EntityKind; field: FactField; value: string } | null;
}

const articleIdOf = (data: CampaignData, entity: Entity | undefined): string | null =>
  entity?.lk && data.articles[entity.lk.resourceId] ? entity.lk.resourceId : null;

/** Um wen es bei einer Eingabe geht – für den Artikel. */
export function entityOfInput(input: RecordInput): string | null {
  return (
    input.fate?.entityId ??
    input.whereabouts?.entityId ??
    input.condition?.entityId ??
    input.transformation?.characterId ??
    input.companion?.entityId ??
    input.milestone?.characterId ??
    input.reveal?.alias?.entityId ??
    input.bond?.fromId ??
    null
  );
}

/** Die Bezeichnungen des Steckbriefs gelten für Gefährten wie für Personen. */
const vocabularyKind = (kind: EntityKind): EntityKind => (kind === 'character' ? 'person' : kind);

/** In welchen Artikel eine Eingabe schreiben kann – null, wenn das Ding keinen hat. */
export function articleTarget(data: CampaignData, input: RecordInput): ArticleTarget | null {
  const entityId = entityOfInput(input);
  const entity = entityId ? data.entities[entityId] : undefined;
  const articleId = articleIdOf(data, entity);
  if (!entity || !articleId) return null;
  let fact: ArticleTarget['fact'] = null;
  if (input.kind === 'fate' && input.fate)
    fact = {
      kind: vocabularyKind(entity.kind),
      field: 'status',
      value: FATE_LABEL[input.fate.status],
    };
  if (input.kind === 'whereabouts' && input.whereabouts?.placeId)
    fact = {
      kind: vocabularyKind(entity.kind),
      field: 'whereabouts',
      value: entityName(data, input.whereabouts.placeId),
    };
  return { entityId: entity.id, articleId, fact };
}

/** Arten, deren Geschehen beim Ding unter „Was geschah“ stehen darf. */
const HAPPENED_KINDS: readonly RecordInput['kind'][] = [
  'fate',
  'whereabouts',
  'condition',
  'transformation',
  'companion',
  'milestone',
  'reveal',
  'bond',
];

/** Was beim Annehmen außer dem Eintrag selbst geschehen kann – als Häkchen. */
export function consequencesOf(
  data: CampaignData,
  input: RecordInput | null,
  secret = false,
): Consequence[] {
  if (!input) return [];
  if (input.kind === 'writing')
    return [{ key: 'article', label: 'Als Artikel unter „Schriftstücke“ ablegen', checked: true }];
  const target = articleTarget(data, input);
  if (!target) return [];
  const name = entityName(data, target.entityId);
  const out: Consequence[] = [];
  if (target.fact)
    out.push({
      key: 'fact',
      label: `${FIELD_LABEL[target.fact.field]} bei ${name}: ${target.fact.value} – auch im Steckbrief`,
      checked: true,
    });
  if (HAPPENED_KINDS.includes(input.kind))
    out.push({
      key: 'happened',
      label: secret
        ? `Bei ${name} unter „Was geschah“ deinen Satz eintragen (nur für die Spielleitung)`
        : `Bei ${name} unter „Was geschah“ deinen Satz eintragen`,
      checked: !secret,
    });
  return out;
}

/** Die Häkchen mit ihren Vorgaben – geändert, wo der Spielleiter etwas angeklickt hat. */
export function checksOf(
  consequences: readonly Consequence[],
  changed: Partial<Record<ConsequenceKey, boolean>> = {},
): Record<ConsequenceKey, boolean> {
  const out: Record<ConsequenceKey, boolean> = { fact: false, happened: false, article: false };
  for (const c of consequences) out[c.key] = changed[c.key] ?? c.checked;
  return out;
}

/** Der Punkt unter „Was geschah“: „<Tag> (Session N): <Satz des Spielleiters>“. */
export function happenedText(
  cal: CalendarDef,
  session: Pick<Session, 'number'>,
  at: WorldTime,
  precision: ChroniclePrecision,
  quote: string,
): string {
  const day = formatDate(cal, at);
  const when = precision === 'approx' || precision === 'order' ? `ungefähr ${day}` : day;
  return `${when} (Session ${session.number}): ${quote.replace(/\s+/g, ' ').trim()}`;
}

// ── Was beim Annehmen festgehalten wird ────────────────────────────────────

/** Was der Spielleiter vor dem Annehmen geändert hat („Ändern“ und Häkchen). */
export interface ProposalChange {
  /** Ein Eintrag der Chronik, wie er in „Ändern“ zusammengestellt wurde. */
  input?: RecordInput;
  /** Beute, wie sie in „Ändern“ steht. */
  loot?: LootInput;
  /** Ein Faden, wie er in „Ändern“ steht. */
  thread?: { title: string; refs: string[] };
  checks?: Partial<Record<ConsequenceKey, boolean>>;
}

export type AcceptPlan =
  | {
      kind: 'record';
      inputs: RecordInput[];
      checks: Record<ConsequenceKey, boolean>;
      /** Zweite Namen, die mit dem Eintrag zum Ding kommen (Decknamen aus einer Notiz). */
      aliases: { entityId: string; name: string }[];
    }
  | { kind: 'loot'; loot: LootInput; when: LootWhen }
  | { kind: 'thread'; thread: { title: string; refs: string[] } };

/** Warum sich ein Vorschlag nicht ohne „Ändern“ annehmen lässt. */
const NEEDS: Partial<Record<ReadProposalKind, string>> = {
  fate: 'Wessen Schicksal ist es? Wähle es über „Ändern“.',
  whereabouts: 'Um wen geht es? Wähle es über „Ändern“.',
  travel: 'Wohin ging die Gruppe? Wähle den Ort über „Ändern“.',
  attitude: 'Eine Haltung braucht einen Wert – wähle ihn über „Ändern“.',
  condition: 'Wen betrifft der Zustand? Wähle es über „Ändern“.',
  milestone: 'Welcher Gefährte? Wähle ihn über „Ändern“.',
  wish: 'Welcher Gefährte? Wähle ihn über „Ändern“.',
  meeting: 'Wen hat die Gruppe getroffen? Wähle es über „Ändern“.',
  knowledge: 'Wer erfährt es? Wähle es über „Ändern“.',
  transformation: 'Welcher Gefährte? Wähle ihn über „Ändern“.',
  companion: 'Welches Wesen? Wähle es über „Ändern“.',
};

const asPayload = (p: ReadProposal) =>
  p.payload as RecognizedPayload & {
    party?: boolean;
    aliases?: { entityId: string; name: string }[];
    title?: string;
    text?: string;
    gold?: number;
    toId?: string | null;
    source?: string;
  };

/**
 * Was genau beim Annehmen geschieht: die Eingaben für `recordEntries` (ein Aufstieg „aller“ wird
 * ein Eintrag je Gefährte), Beute mit der Zeit der Session oder ein Faden. Ohne Weltzeit „jetzt“:
 * Alles bekommt die Zeit und Genauigkeit des Vorschlags.
 */
export function planAccept(
  data: CampaignData,
  session: Session,
  proposal: ReadProposal,
  change: ProposalChange = {},
): AcceptPlan | { problem: string } {
  const p = asPayload(proposal);
  if (proposal.kind === 'thread') {
    const thread = change.thread ?? {
      title: (typeof p.title === 'string' && p.title) || proposal.text,
      refs: proposal.refs,
    };
    if (!thread.title.trim()) return { problem: 'Der Faden braucht einen Satz.' };
    return { kind: 'thread', thread };
  }
  if (proposal.kind === 'loot') {
    const loot: LootInput = change.loot ?? {
      text: typeof p.text === 'string' ? p.text : proposal.text,
      gold: typeof p.gold === 'number' ? p.gold : 0,
      itemId: null,
      toId: typeof p.toId === 'string' ? p.toId : null,
      source: typeof p.source === 'string' ? p.source : '',
      storyId: null,
    };
    if (!loot.text.trim() && !(loot.gold > 0) && !loot.itemId)
      return { problem: 'Was wurde erbeutet? Trag es über „Ändern“ ein.' };
    const at = proposal.at;
    return {
      kind: 'loot',
      loot,
      when: {
        at,
        sessionId: session.id,
        placeId: placeForEntry(data, at),
        precision: proposal.precision,
        secret: proposal.secret,
      },
    };
  }
  let inputs: RecordInput[];
  if (change.input) inputs = [change.input];
  else if (proposal.kind === 'milestone' && p.party) {
    const party = activeParty(data);
    if (!party.length) return { problem: 'Es gibt keine aktiven Gefährten.' };
    inputs = party.map((c) => ({
      kind: 'milestone',
      text: proposal.text,
      at: proposal.at,
      sessionId: session.id,
      refs: [c.id],
      secret: proposal.secret,
      backfilled: true,
      precision: proposal.precision,
      milestone: { characterId: c.id, level: p.milestone?.level ?? null },
    }));
  } else {
    const input = proposalInput(proposal, session.id);
    if (!input) return { problem: NEEDS[proposal.kind] ?? 'Erst etwas wählen – über „Ändern“.' };
    inputs = [input];
  }
  const consequences = consequencesOf(data, inputs[0] ?? null, proposal.secret);
  const checks = checksOf(consequences, change.checks);
  inputs = inputs.map((input) =>
    input.kind === 'writing'
      ? { ...input, writing: { ...input.writing, createArticle: checks.article } }
      : input,
  );
  const aliases =
    inputs[0]?.kind === 'note' && Array.isArray(p.aliases)
      ? p.aliases.filter((a) => !!data.entities[a.entityId] && a.name.trim())
      : [];
  return { kind: 'record', inputs, checks, aliases };
}

/** Ein Vorschlag als Erkanntes – so, wie ihn das Festhalten kennt. */
export function recognizedOf(proposal: ReadProposal): Recognized | null {
  if (proposal.kind === 'thread' || proposal.kind === 'loot' || proposal.kind === 'event')
    return null;
  return {
    kind: proposal.kind,
    label: proposal.label,
    payload: proposal.payload as RecognizedPayload,
    refs: proposal.refs,
    from: proposal.from,
    to: proposal.to,
  };
}

/**
 * Der Vorschlag als Entwurf für „Ändern“ (die Felder aus `RecordFields`): Art, Angaben und was
 * unter „Betrifft“ steht. null bei Faden und Beute (eigene Felder).
 */
export function draftOfProposal(
  proposal: ReadProposal,
): { choice: RecordFieldsKind; draft: RecordDraft; refs: string[] } | null {
  const item = recognizedOf(proposal);
  if (!item) return null;
  const { draft, refs } = draftFromRecognized(item);
  const p = proposal.payload as {
    writing?: { title?: string };
    downtime?: { activities?: { characterId: string; text: string }[] };
    reveal?: { alias?: { entityId: string; name: string } | null };
    milestone?: { characterId: string | null };
  };
  if (proposal.kind === 'writing') {
    draft.title = p.writing?.title ?? '';
    draft.createArticle = true;
  }
  if (proposal.kind === 'downtime') draft.activities = [...(p.downtime?.activities ?? [])];
  if (proposal.kind === 'reveal' && p.reveal?.alias) {
    draft.whoId = p.reveal.alias.entityId;
    draft.aliasName = p.reveal.alias.name;
  }
  return { choice: choiceOfRecognized(item), draft, refs };
}

// ── Fragen zu Namen ────────────────────────────────────────────────────────

/** Arten, die beim Anlegen eines neuen Eintrags für einen Namen zur Wahl stehen. */
export const QUESTION_KINDS: EntityKind[] = [
  'person',
  'place',
  'faction',
  'family',
  'item',
  'topic',
];

/**
 * Einträge, die mit einem unbekannten Namen gemeint sein könnten – ein Wort des Eintrags beginnt
 * wie der Name, oder der Name beginnt wie ein Wort des Eintrags. Höchstens drei.
 */
export function questionGuesses(data: CampaignData, question: ReadQuestion): Entity[] {
  const key = foldName(question.name).replace(/[^\p{L}\p{N}]/gu, '');
  if (key.length < 3) return [];
  const head = key.slice(0, 4);
  const scored: { entity: Entity; score: number }[] = [];
  for (const entity of Object.values(data.entities)) {
    const words = [entity.name, ...entity.aliases]
      .flatMap((n) => foldName(n).split(/[^\p{L}\p{N}]+/u))
      .filter((w) => w.length >= 3);
    let score = 0;
    for (const word of words) {
      if (word === key) score = Math.max(score, 3);
      else if (key.startsWith(word) || word.startsWith(key)) score = Math.max(score, 2);
      else if (word.startsWith(head)) score = Math.max(score, 1);
    }
    if (score) scored.push({ entity, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.entity.name.localeCompare(b.entity.name, 'de'))
    .slice(0, 3)
    .map((s) => s.entity);
}

/** Die Vorschläge, in deren Satz ein unbekannter Name steht. */
export const proposalsOfQuestion = (reading: SessionReading, key: string): ReadProposal[] =>
  reading.proposals.filter((p) => p.names.includes(key) && !p.stale);

// ── Weltzeit der Session ───────────────────────────────────────────────────

/** Was gegen diese Weltzeit einer nachgetragenen Session spricht; leer, wenn sie passt. */
export function sessionTimeProblem(
  data: CampaignData,
  sessionId: string,
  startAt: WorldTime | null,
  endAt: WorldTime | null,
): string {
  if (startAt === null) return 'Der Beginn ist kein gültiges Datum.';
  if (endAt === null) return 'Das Ende ist kein gültiges Datum.';
  if (endAt < startAt) return 'Das Ende liegt vor dem Beginn.';
  if (endAt > data.state.now) return 'Eine nachgetragene Session endet nicht in der Zukunft.';
  const cal = data.campaign.calendar;
  for (const other of Object.values(data.sessions)) {
    if (other.id === sessionId) continue;
    const otherEnd = other.endAt ?? data.state.now;
    if (other.startAt < endAt && otherEnd > startAt)
      return `In dieser Zeit liegt schon Session ${other.number} (${formatDateTime(cal, other.startAt)} bis ${formatDateTime(cal, otherEnd)}).`;
  }
  return '';
}

// ── „Ändern“ ───────────────────────────────────────────────────────────────

/** Die Häkchen eines Vorschlags, so wie er dasteht (ohne „Ändern“). */
export function proposalConsequences(
  data: CampaignData,
  session: Session,
  proposal: ReadProposal,
): Consequence[] {
  if (proposal.kind === 'thread' || proposal.kind === 'loot' || proposal.kind === 'event')
    return [];
  return consequencesOf(data, proposalInput(proposal, session.id), proposal.secret);
}

/** Die Eingabe aus den Feldern von „Ändern“ – immer nachgetragen. */
export function editedInput(
  choice: RecordFieldsKind,
  draft: RecordDraft,
  common: RecordCommon,
  now: WorldTime,
): RecordInput {
  return { ...recordInputOf(choice, draft, common, now), backfilled: true };
}

/** Was in „Ändern“ noch fehlt oder nicht passt; leer, wenn sich annehmen lässt. */
export function editProblem(
  data: CampaignData,
  choice: RecordFieldsKind,
  draft: RecordDraft,
  common: RecordCommon,
): string {
  if (common.at === undefined) return 'Wann war es? Das Datum gibt es nicht.';
  const { problem } = recordCheck(data, [partOf(choice, draft)], common);
  return problem;
}
