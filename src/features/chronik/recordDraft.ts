/**
 * Was „Festhalten“ (shell/dialogs.tsx) und der Eintrag der Chronik (EntryDialog) zusammenstellen,
 * bevor es über `recordEntry` / `recordEntries` (data/record.ts) in die Chronik geht: die Angaben
 * einer Art als Entwurf (`RecordDraft`), die gewählten Arten eines Satzes (`RecordPart`) und die
 * übernommenen Vorschläge des Erkennens. Reine Funktionen; die Felder dazu stehen in
 * `RecordFields.tsx`.
 */
import { recordProblem } from '../../data/record';
import { KIND_LABEL, isJob, type RecordInput, type RecordKind } from '../../domain/chronicleKinds';
import { promiseOutcome, type PromiseOutcome } from '../../domain/derive';
import { threadsInOrder } from '../../domain/looseThreads';
import { allSecrets } from '../../domain/prep';

import type { DeliveryOffer, Recognized } from '../../domain/recognize';
import {
  PARTY_ID,
  type CampaignData,
  type ChronicleEntry,
  type ChroniclePrecision,
  type EntityKind,
  type FightOutcome,
  type PersonStatus,
  type RumorTruth,
} from '../../domain/schema';
import { MINUTES_PER_DAY, startOfDay, type WorldTime } from '../../domain/time/calendar';

// ── Entwurf einer Art ──────────────────────────────────────────────────────

/**
 * Eine Art, wie man sie wählt: jede Art außer dem Termin, dazu „Ruf“ (Haltung einer Fraktion) und
 * „Auftrag“ (eine Abmachung der Sorte `job`).
 */
export type RecordFieldsKind = RecordKind | 'repute' | 'job';

/** Die Art hinter einer Wahl. */
export const kindOfFields = (choice: RecordFieldsKind): RecordKind =>
  choice === 'repute' ? 'attitude' : choice === 'job' ? 'promise' : choice;

/** Wie eine Wahl heißt – „Ruf“ und „Auftrag“ haben eigene Namen. */
export const fieldsLabel = (choice: RecordFieldsKind): string =>
  choice === 'repute' ? 'Ruf' : choice === 'job' ? 'Auftrag' : KIND_LABEL[choice];

/** Die Wahl, zu der ein vorhandener Eintrag gehört (ein Auftrag ist „Auftrag“). */
export const choiceOfEntry = (entry: ChronicleEntry): RecordFieldsKind =>
  isJob(entry) ? 'job' : entry.kind === 'event' ? 'note' : entry.kind;

/**
 * Die Angaben einer Art, so wie sie im Dialog stehen. Jede Art nutzt nur einen Teil davon;
 * dieselben Felder werden über Arten hinweg geteilt, damit beim Wechsel der Art die gewählte
 * Person stehen bleibt.
 */
export interface RecordDraft {
  /**
   * Um wen es geht: Schicksal, Aufenthalt, Zustand (Person oder Gefährte), Meilenstein und
   * Spielerwunsch (Gefährte), Haltung und Beziehung (von wem), Wer was weiß (wer es erfährt),
   * Zitat (wer es sagte), Gerücht (wer es erzählt).
   */
  whoId: string | null;
  /** Gegenüber wem: Haltung (leer = die Gruppe), Beziehung (mit wem). */
  towardId: string | null;
  /** Ein Ort: Ziel des Ortswechsels, neuer Aufenthalt, entdeckter Ort. */
  placeId: string | null;
  /** Mehrere: wer getroffen wurde (Begegnung), gegen wen gekämpft wurde (Kampf). */
  withIds: string[];
  /** Schicksal. */
  status: PersonStatus;
  /** Haltung von −5 bis +5; null = noch nicht gewählt. */
  attitude: number | null;
  fightOutcome: FightOutcome;
  /** Kampf: die Begegnung des Bestiariums, wenn es eine gab. */
  encounterId: string | null;
  /** Rast: lang statt kurz. */
  longRest: boolean;
  /** Gerücht: Stand. */
  truth: RumorTruth;
  /** Beziehung: Schlüssel aus RELATION_TYPES. */
  relationType: string;
  /** Beziehung endet bzw. Zustand ist aufgehoben. */
  ended: boolean;
  /** Zustand aufheben: welcher Beginn (null = der mit gleichem Wortlaut). */
  endsId: string | null;
  /** Meilenstein: neue Stufe, wie getippt; leer = ohne Stufe. */
  level: string;
  /** Spielerwunsch: als Ziel des Gefährten übernehmen. */
  setGoal: boolean;
  /** Hinweis gefunden. */
  threadId: string | null;
  hintId: string | null;
  /** Aufgedeckt: Geheimnis vom Abend-Blatt. */
  prepSecretId: string | null;
  /** Abmachung: Frist in Tagen ab dem Zeitpunkt des Eintrags, wie getippt; leer = ohne Frist. */
  dueDays: string;
  promiseOutcome: PromiseOutcome;
  /** Schriftstück: Titel und ob es als Artikel abgelegt wird; `articleId` = schon abgelegt. */
  title: string;
  createArticle: boolean;
  articleId: string | null;
  /** Zwischenzeit: Tage, wie getippt, und die Tätigkeiten je Gefährte. */
  days: string;
  activities: { characterId: string; text: string }[];
  /** Aufgedeckt: ein zweiter Name für den Eintrag in „Wer“ (wahrer Name, Deckname). */
  aliasName: string;
}

export const emptyRecordDraft = (): RecordDraft => ({
  whoId: null,
  towardId: null,
  placeId: null,
  withIds: [],
  status: 'dead',
  attitude: null,
  fightOutcome: 'open',
  encounterId: null,
  longRest: false,
  truth: 'unchecked',
  relationType: 'knows',
  ended: false,
  endsId: null,
  level: '',
  setGoal: false,
  threadId: null,
  hintId: null,
  prepSecretId: null,
  dueDays: '',
  promiseOutcome: 'open',
  title: '',
  createArticle: false,
  articleId: null,
  days: '',
  activities: [],
  aliasName: '',
});

const PEOPLE: EntityKind[] = ['person', 'character', 'faction', 'family'];
const LIVING: EntityKind[] = ['person', 'character'];

/** Welche Einträge im Feld „Wer“ (`whoId`) einer Art stehen dürfen. */
export const WHO_KINDS: Partial<Record<RecordFieldsKind, EntityKind[]>> = {
  attitude: PEOPLE,
  repute: ['faction'],
  bond: PEOPLE,
  quote: PEOPLE,
  rumor: PEOPLE,
  knowledge: PEOPLE,
  fate: LIVING,
  whereabouts: LIVING,
  condition: LIVING,
  milestone: ['character'],
  wish: ['character'],
  job: PEOPLE,
  writing: PEOPLE,
  transformation: ['character'],
  companion: ['person'],
};

/**
 * Füllt „Wer“ aus „Betrifft“, wenn dort genau ein passender Eintrag steht – etwa „Ruf“, geöffnet
 * auf der Seite einer Fraktion. Das ist die Wahl des Spielleiters, kein Raten; bei mehreren
 * passenden bleibt das Feld leer.
 */
export function prefillFromRefs(
  data: CampaignData,
  choice: RecordFieldsKind,
  draft: RecordDraft,
  refs: string[],
): RecordDraft {
  const kinds = WHO_KINDS[choice];
  if (!kinds || draft.whoId) return draft;
  const fitting = refs.filter((id) => {
    const kind = data.entities[id]?.kind;
    return !!kind && kinds.includes(kind);
  });
  return fitting.length === 1 ? { ...draft, whoId: fitting[0]! } : draft;
}

/** Arten, die nur aus Text bestehen: Für sie gibt es keine eigenen Felder. */
const TEXT_ONLY: readonly RecordFieldsKind[] = ['note', 'change', 'decision', 'lore'];

/** Hat die Art eigene Felder (`RecordFields`)? */
export const hasRecordFields = (choice: RecordFieldsKind): boolean => !TEXT_ONLY.includes(choice);

/** Was für alle Arten eines Festhaltens gilt. */
export interface RecordCommon {
  text: string;
  /** undefined = jetzt. */
  at?: WorldTime;
  /** undefined = die Session, in deren Weltzeit der Zeitpunkt fällt. */
  sessionId?: string | null;
  /** undefined = Ort der Gruppe zu dieser Zeit. */
  placeId?: string | null;
  refs: string[];
  secret: boolean;
  precision?: ChroniclePrecision;
  storyId?: string | null;
}

const unique = (ids: (string | null | undefined)[]) => [
  ...new Set(ids.filter((id): id is string => !!id)),
];

/** Tage aus dem Feld; null, wenn leer oder keine ganze Zahl ab 0. */
const daysOf = (text: string): number | null => {
  const value = Number(text.trim());
  return text.trim() && Number.isInteger(value) && value >= 0 ? value : null;
};

/** Die Stufe aus dem Feld; null, wenn leer oder keine ganze Zahl. */
const levelOf = (text: string): number | null => {
  const value = Number(text.trim());
  return text.trim() && Number.isFinite(value) ? value : null;
};

/**
 * Die Eingabe für `recordEntry` aus Art, Entwurf und Gemeinsamem. `now` ist die Weltzeit, ab der
 * eine Frist bei „jetzt“ zählt.
 */
export function recordInputOf(
  choice: RecordFieldsKind,
  draft: RecordDraft,
  common: RecordCommon,
  now: WorldTime,
): RecordInput {
  const kind = kindOfFields(choice);
  const input: RecordInput = {
    kind,
    text: common.text,
    at: common.at,
    sessionId: common.sessionId,
    placeId: common.placeId,
    refs: [...common.refs],
    secret: common.secret,
    precision: common.precision,
    storyId: common.storyId,
  };
  const d = draft;
  switch (kind) {
    case 'travel':
      if (d.placeId) input.travel = { toId: d.placeId };
      break;
    case 'attitude':
      if (d.whoId)
        input.attitude = { fromId: d.whoId, toId: d.towardId ?? PARTY_ID, value: d.attitude };
      break;
    case 'promise': {
      const days = Number(d.dueDays);
      const from = common.at ?? now;
      input.promise = {
        due: d.dueDays.trim() && days >= 0 ? from + Math.round(days * 1440) : null,
        outcome: d.promiseOutcome,
        ...(choice === 'job' ? { sort: 'job' as const } : {}),
      };
      // Beim Auftrag steht der Auftraggeber vorn.
      if (choice === 'job') input.refs = unique([d.whoId, ...common.refs]);
      break;
    }
    case 'writing':
      input.writing = {
        title: d.title,
        articleId: d.articleId,
        createArticle: d.createArticle && !d.articleId,
      };
      // Absender oder Fundort steht vorn.
      input.refs = unique([d.whoId, ...common.refs]);
      break;
    case 'downtime':
      input.downtime = {
        days: daysOf(d.days) ?? 0,
        activities: d.activities.filter((a) => a.text.trim()),
      };
      break;
    case 'transformation':
      if (d.whoId) input.transformation = { characterId: d.whoId };
      break;
    case 'companion':
      if (d.whoId) input.companion = { entityId: d.whoId, joined: !d.ended, ownerId: d.towardId };
      break;
    case 'fight':
      input.fight = { outcome: d.fightOutcome, encounterId: d.encounterId };
      input.refs = unique([...d.withIds, ...common.refs]);
      break;
    case 'meeting':
      input.refs = unique([...d.withIds, ...common.refs]);
      break;
    case 'rest':
      input.rest = { long: d.longRest };
      break;
    case 'fate':
      if (d.whoId) input.fate = { entityId: d.whoId, status: d.status };
      break;
    case 'whereabouts':
      if (d.whoId) input.whereabouts = { entityId: d.whoId, placeId: d.placeId };
      break;
    case 'discovery':
      if (d.placeId) input.placeId = d.placeId;
      break;
    case 'rumor':
      input.rumor = { sourceId: d.whoId, truth: d.truth };
      break;
    case 'bond':
      if (d.whoId && d.towardId)
        input.bond = { fromId: d.whoId, toId: d.towardId, type: d.relationType, ended: d.ended };
      break;
    case 'condition':
      if (d.whoId)
        input.condition = {
          entityId: d.whoId,
          ended: d.ended,
          endsId: d.ended ? d.endsId : null,
        };
      break;
    case 'milestone':
      if (d.whoId) input.milestone = { characterId: d.whoId, level: levelOf(d.level) };
      break;
    case 'wish':
      if (d.whoId) input.wish = { characterId: d.whoId, setGoal: d.setGoal };
      break;
    case 'clue':
      input.clue = { threadId: d.threadId, hintId: d.threadId ? d.hintId : null };
      break;
    case 'reveal':
      input.reveal = {
        prepSecretId: d.prepSecretId,
        alias:
          d.whoId && d.aliasName.trim() ? { entityId: d.whoId, name: d.aliasName.trim() } : null,
      };
      break;
    case 'quote':
    case 'knowledge':
      // Wer es sagte bzw. wer es erfährt, steht vorn.
      input.refs = unique([d.whoId, ...common.refs]);
      break;
    default:
      break;
  }
  return input;
}

/**
 * Was im Dialog noch fehlt, bevor `recordProblem` gefragt wird – Angaben, die `recordEntry`
 * als gültig nähme, die aber hier gewählt sein müssen. Leer, wenn nichts fehlt.
 */
export function draftProblem(choice: RecordFieldsKind, draft: RecordDraft): string {
  switch (choice) {
    case 'travel':
      return draft.placeId ? '' : 'Wohin ist die Gruppe gezogen?';
    case 'attitude':
    case 'repute':
      if (!draft.whoId)
        return choice === 'repute' ? 'Welche Fraktion?' : 'Wessen Haltung hat sich geändert?';
      // Ohne Wert würde die Haltung auf „unbekannt“ gesetzt.
      return draft.attitude === null ? 'Wähle die neue Haltung.' : '';
    case 'fate':
      return draft.whoId ? '' : 'Wessen Schicksal?';
    case 'whereabouts':
      return draft.whoId ? '' : 'Wessen Aufenthalt?';
    case 'bond':
      if (!draft.whoId) return 'Wessen Beziehung?';
      return draft.towardId ? '' : 'Mit wem?';
    case 'condition':
      return draft.whoId ? '' : 'Wessen Zustand?';
    case 'milestone':
      if (!draft.whoId) return 'Welcher Gefährte?';
      return draft.level.trim() && levelOf(draft.level) === null ? 'Die Stufe ist keine Zahl.' : '';
    case 'wish':
      return draft.whoId ? '' : 'Welcher Gefährte?';
    case 'knowledge':
      return draft.whoId ? '' : 'Wer hat es erfahren?';
    case 'promise':
    case 'job':
      return draft.dueDays.trim() && !(Number(draft.dueDays) >= 0)
        ? 'Die Frist ist keine Zahl von Tagen.'
        : '';
    case 'writing':
      return draft.createArticle && !draft.articleId && !draft.title.trim()
        ? 'Wie soll der Artikel heißen? Das Schriftstück braucht einen Titel.'
        : '';
    case 'downtime':
      return draft.days.trim() && daysOf(draft.days) === null
        ? 'Die Zwischenzeit ist keine Zahl von Tagen.'
        : '';
    case 'transformation':
      return draft.whoId ? '' : 'Welcher Gefährte?';
    case 'companion':
      return draft.whoId ? '' : 'Welches Tier oder Wesen?';
    case 'reveal':
      return draft.aliasName.trim() && !draft.whoId ? 'Wessen Name ist das?' : '';
    default:
      return '';
  }
}

/** Die Angaben eines vorhandenen Eintrags als Entwurf – zum Bearbeiten im EntryDialog. */
export function draftOfEntry(entry: ChronicleEntry): RecordDraft {
  const draft = emptyRecordDraft();
  const others = entry.refs.filter((id) => id !== entry.placeId);
  switch (entry.kind) {
    case 'travel':
      draft.placeId = entry.travel?.toId ?? null;
      break;
    case 'attitude':
      draft.whoId = entry.attitude?.fromId ?? null;
      draft.towardId = entry.attitude?.toId ?? null;
      draft.attitude = entry.attitude?.after ?? null;
      break;
    case 'promise':
      draft.promiseOutcome = entry.promise ? promiseOutcome(entry.promise) : 'open';
      if (entry.promise?.due != null)
        draft.dueDays = String(Math.max(0, Math.round((entry.promise.due - entry.at) / 1440)));
      if (isJob(entry)) draft.whoId = others[0] ?? null;
      break;
    case 'writing':
      draft.title = entry.writing?.title ?? '';
      draft.articleId = entry.writing?.articleId ?? null;
      draft.createArticle = !!draft.articleId;
      draft.whoId = others[0] ?? null;
      break;
    case 'downtime':
      draft.days = entry.downtime ? String(entry.downtime.days) : '';
      draft.activities = (entry.downtime?.activities ?? []).map((a) => ({ ...a }));
      break;
    case 'transformation':
      draft.whoId = entry.transformation?.characterId ?? null;
      break;
    case 'companion':
      draft.whoId = entry.companion?.entityId ?? null;
      draft.towardId = entry.companion?.ownerId ?? null;
      draft.ended = !(entry.companion?.joined ?? true);
      break;
    case 'fight':
      draft.fightOutcome = entry.fight?.outcome ?? 'open';
      draft.encounterId = entry.fight?.encounterId ?? null;
      draft.withIds = others;
      break;
    case 'meeting':
      draft.withIds = others;
      break;
    case 'rest':
      draft.longRest = entry.rest?.long ?? false;
      break;
    case 'fate':
      draft.whoId = entry.fate?.entityId ?? null;
      draft.status = entry.fate?.status ?? 'dead';
      break;
    case 'whereabouts':
      draft.whoId = entry.whereabouts?.entityId ?? null;
      draft.placeId = entry.whereabouts?.placeId ?? null;
      break;
    case 'discovery':
      draft.placeId = entry.placeId;
      break;
    case 'rumor':
      draft.whoId = entry.rumor?.sourceId ?? null;
      draft.truth = entry.rumor?.truth ?? 'unchecked';
      break;
    case 'bond':
      draft.whoId = entry.bond?.fromId ?? null;
      draft.towardId = entry.bond?.toId ?? null;
      draft.relationType = entry.bond?.type ?? 'knows';
      draft.ended = entry.bond?.ended ?? false;
      break;
    case 'condition':
      draft.whoId = entry.condition?.entityId ?? null;
      draft.ended = entry.condition?.ended ?? false;
      draft.endsId = entry.condition?.endsId ?? null;
      break;
    case 'milestone':
      draft.whoId = entry.milestone?.characterId ?? null;
      draft.level = entry.milestone?.level != null ? String(entry.milestone.level) : '';
      break;
    case 'wish':
      draft.whoId = entry.refs[0] ?? null;
      draft.setGoal = entry.wish?.setGoal ?? false;
      break;
    case 'clue':
      draft.threadId = entry.clue?.threadId ?? null;
      draft.hintId = entry.clue?.hintId ?? null;
      break;
    case 'reveal':
      draft.prepSecretId = entry.reveal?.prepSecretId ?? null;
      draft.whoId = entry.reveal?.alias?.entityId ?? null;
      draft.aliasName = entry.reveal?.alias?.name ?? '';
      break;
    case 'quote':
    case 'knowledge':
      draft.whoId = others[0] ?? null;
      break;
    default:
      break;
  }
  return draft;
}

// ── Vorschläge des Erkennens ───────────────────────────────────────────────

/** Ein Vorschlag, unabhängig davon, wo im Text er steht – bleibt beim Weitertippen derselbe. */
export const recognizedKey = (item: Recognized): string =>
  `${item.kind}:${JSON.stringify(item.payload)}:${item.refs.join(',')}`;

/**
 * Ein Vorschlag als Entwurf. `refs` sind die Dinge des Vorschlags, die kein Feld der Art
 * aufnimmt – sie gehören zu „Betrifft“.
 */
export function draftFromRecognized(item: Recognized): { draft: RecordDraft; refs: string[] } {
  const draft = emptyRecordDraft();
  const p = item.payload;
  let used: (string | null)[] = [];
  switch (item.kind) {
    case 'fate':
      draft.whoId = p.fate?.entityId ?? null;
      draft.status = p.fate?.status ?? 'dead';
      used = [draft.whoId];
      break;
    case 'whereabouts':
      draft.whoId = p.whereabouts?.entityId ?? null;
      draft.placeId = p.whereabouts?.placeId ?? null;
      used = [draft.whoId, draft.placeId];
      break;
    case 'travel':
      draft.placeId = p.travel?.toId ?? null;
      used = [draft.placeId];
      break;
    case 'attitude':
      draft.whoId = p.attitude?.fromId ?? null;
      draft.towardId = p.attitude?.toId === PARTY_ID ? null : (p.attitude?.toId ?? null);
      used = [draft.whoId, draft.towardId];
      break;
    case 'fight':
      draft.fightOutcome = p.fight?.outcome ?? 'open';
      draft.withIds = [...item.refs];
      used = item.refs;
      break;
    case 'meeting':
      draft.withIds = [...item.refs];
      used = item.refs;
      break;
    case 'rest':
      draft.longRest = p.rest?.long ?? false;
      break;
    case 'rumor':
      draft.whoId = p.rumor?.sourceId ?? null;
      used = [draft.whoId];
      break;
    case 'condition':
      draft.whoId = p.condition?.entityId ?? null;
      draft.ended = p.condition?.ended ?? false;
      used = [draft.whoId];
      break;
    case 'milestone':
      draft.whoId = p.milestone?.characterId ?? null;
      draft.level = p.milestone?.level != null ? String(p.milestone.level) : '';
      used = [draft.whoId];
      break;
    case 'wish':
      draft.whoId = p.wish?.characterId ?? null;
      used = [draft.whoId];
      break;
    case 'discovery':
      draft.placeId = p.placeId ?? null;
      used = [draft.placeId];
      break;
    case 'quote':
    case 'knowledge':
    case 'writing':
      draft.whoId = item.refs[0] ?? null;
      used = [draft.whoId];
      break;
    case 'promise':
      if (p.promise?.sort === 'job') {
        draft.whoId = item.refs[0] ?? null;
        used = [draft.whoId];
      }
      break;
    case 'downtime':
      draft.days = p.downtime?.days != null ? String(p.downtime.days) : '';
      break;
    case 'transformation':
      draft.whoId = p.transformation?.characterId ?? null;
      used = [draft.whoId];
      break;
    case 'companion':
      draft.whoId = p.companion?.entityId ?? null;
      draft.towardId = p.companion?.ownerId ?? null;
      draft.ended = !(p.companion?.joined ?? true);
      used = [draft.whoId, draft.towardId];
      break;
    default:
      break;
  }
  return { draft, refs: item.refs.filter((id) => !used.includes(id)) };
}

/** Die Wahl im Raster, die ein Vorschlag trifft – ein erkannter Auftrag ist „Auftrag“. */
export const choiceOfRecognized = (item: Recognized): RecordFieldsKind =>
  item.kind === 'promise' && item.payload.promise?.sort === 'job' ? 'job' : item.kind;

// ── Mehrere Arten in einem Zug ─────────────────────────────────────────────

/** Eine gewählte Art mit ihren Angaben. `source` = der übernommene Vorschlag, aus dem sie stammt. */
export interface RecordPart {
  key: string;
  choice: RecordFieldsKind;
  draft: RecordDraft;
  source: string | null;
  /** Wie der Vorschlag hieß („Schicksal: Krummzahn → tot“) – auch wenn er nicht mehr im Text steht. */
  sourceLabel?: string;
}

export const partOf = (choice: RecordFieldsKind, draft = emptyRecordDraft()): RecordPart => ({
  key: choice,
  choice,
  draft,
  source: null,
});

/** Die Wahl im Raster, zu der ein Teil gehört („Ruf“ bleibt „Ruf“, auch wenn es eine Haltung ist). */
const sameChoice = (part: RecordPart, choice: RecordFieldsKind) => part.choice === choice;

/**
 * Fügt eine Art hinzu oder nimmt sie weg. „Notiz“ ist der schlichte Eintrag: Sie steht allein,
 * und jede andere Art tritt an ihre Stelle. Ohne Art bleibt die Notiz.
 */
export function toggleChoice(parts: RecordPart[], choice: RecordFieldsKind): RecordPart[] {
  if (choice === 'note') return [partOf('note')];
  if (parts.some((part) => sameChoice(part, choice))) {
    const rest = parts.filter((part) => !sameChoice(part, choice));
    return rest.length ? rest : [partOf('note')];
  }
  return [...parts.filter((part) => part.choice !== 'note'), partOf(choice)];
}

/** Ist dieser Vorschlag übernommen? */
export const isAccepted = (parts: RecordPart[], item: Recognized) =>
  parts.some((part) => part.source === recognizedKey(item));

/**
 * Übernimmt einen Vorschlag (Art und Angaben) oder nimmt ihn wieder weg. `refs` sind Dinge, die
 * beim Übernehmen zu „Betrifft“ kommen.
 */
export function toggleRecognized(
  parts: RecordPart[],
  item: Recognized,
): { parts: RecordPart[]; refs: string[] } {
  const key = recognizedKey(item);
  if (parts.some((part) => part.source === key)) {
    const rest = parts.filter((part) => part.source !== key);
    return { parts: rest.length ? rest : [partOf('note')], refs: [] };
  }
  const { draft, refs } = draftFromRecognized(item);
  const choice = choiceOfRecognized(item);
  const part: RecordPart = { key, choice, draft, source: key, sourceLabel: item.label };
  const kept = parts.filter(
    (p) => p.choice !== 'note' && !(p.source === null && p.choice === choice),
  );
  return { parts: [...kept, part], refs };
}

/** Alle Eingaben für `recordEntries`, in der Reihenfolge der Teile. */
export function recordInputs(
  parts: RecordPart[],
  common: RecordCommon,
  now: WorldTime,
): RecordInput[] {
  return parts.map((part) => recordInputOf(part.choice, part.draft, common, now));
}

/**
 * Was gegen das Festhalten spricht. `onlyText`: Es fehlt nur der Text – dann muss der Dialog das
 * nicht laut sagen, solange noch nichts geschrieben ist.
 */
export function recordCheck(
  data: CampaignData,
  parts: RecordPart[],
  common: RecordCommon,
): { problem: string; onlyText: boolean } {
  const many = parts.length > 1;
  const label = (part: RecordPart) => fieldsLabel(part.choice);
  for (const part of parts) {
    const missing = draftProblem(part.choice, part.draft);
    if (missing) return { problem: many ? `${label(part)}: ${missing}` : missing, onlyText: false };
    const problem = recordProblem(
      data,
      recordInputOf(part.choice, part.draft, common, data.state.now),
    );
    if (problem) {
      const withText = common.text.trim()
        ? problem
        : recordProblem(
            data,
            recordInputOf(part.choice, part.draft, { ...common, text: '…' }, data.state.now),
          );
      return {
        problem: many && !problem.includes(label(part)) ? `${label(part)}: ${problem}` : problem,
        onlyText: !withText,
      };
    }
  }
  return { problem: '', onlyText: false };
}

// ── Lieferung als Termin ───────────────────────────────────────────────────

/** Längste Bezeichnung eines Termins aus einem Satz. */
const TITLE_MAX = 120;

/**
 * Der Termin, den „Festhalten“ für eine Bestellung oder Lieferung anbietet („in 3 Tagen da“):
 * an dem Tag, der so viele Tage nach dem Zeitpunkt des Eintrags liegt, ohne Uhrzeit; die
 * Bezeichnung ist der Satz des Spielleiters. null, wenn der Tag nicht nach jetzt liegt – was
 * schon vorbei ist, tritt nicht mehr ein.
 */
export function deliveryEvent(
  offer: DeliveryOffer,
  at: WorldTime,
  now: WorldTime,
): { title: string; at: WorldTime } | null {
  const day = startOfDay(at) + offer.days * MINUTES_PER_DAY;
  if (day <= now) return null;
  const sentence = offer.sentence.replace(/\s+/g, ' ').trim();
  const title =
    sentence.length > TITLE_MAX ? `${sentence.slice(0, TITLE_MAX - 1).trimEnd()}…` : sentence;
  return { title, at: day };
}

// ── Auswahllisten ──────────────────────────────────────────────────────────

export interface ClueChoice {
  threadId: string;
  title: string;
  hints: { id: string; text: string; found: boolean }[];
}

/**
 * Fäden zum Wählen bei „Hinweis gefunden“ – in der Reihung, in der Fäden überall zur Wahl stehen
 * (`threadsInOrder`): offene zuerst, darin was am Ort der Gruppe hängt, dann nach dem Satz.
 */
export function clueChoices(data: CampaignData): ClueChoice[] {
  return threadsInOrder(data).map((thread) => ({
    threadId: thread.id,
    title: thread.title,
    hints: thread.hints.map((hint) => ({ id: hint.id, text: hint.text, found: hint.found })),
  }));
}

/**
 * Geheimnisse der Abend-Blätter, die die Gruppe noch nicht kennt – fürs „Aufgedeckt“. `keepId`
 * bleibt wählbar, auch wenn es schon aufgedeckt ist (beim Bearbeiten des Eintrags, der es aufdeckte).
 */
export function secretChoices(
  data: CampaignData,
  keepId: string | null = null,
): { id: string; text: string }[] {
  // Jedes Geheimnis einmal: Was auf ein späteres Blatt herüberkam, zählt dort (`allSecrets`).
  return allSecrets(data)
    .filter((secret) => (!secret.revealed || secret.id === keepId) && secret.text.trim())
    .map((secret) => ({ id: secret.id, text: secret.text }));
}
