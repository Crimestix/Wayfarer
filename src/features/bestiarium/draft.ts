/**
 * Der Entwurf auf der Seite „Wesen bearbeiten“: was der Spielleiter gerade einträgt, was sich
 * daraus ergibt (über `resolveCreature`), wovon es erben darf, Rückgängig und Wiederholen.
 * Reine Funktionen – die Seite rechnet nicht selbst.
 */
import { creatureChain, resolveCreature, type Resolved } from '../../domain/creature';
import type {
  Creature,
  CreatureBlock,
  CreatureFeature,
  CreatureKind,
  FeatureSection,
} from '../../domain/schema';
import type { CreatureInput } from './actions';

export type CreatureDraft = CreatureInput & { speciesId: string | null };

type Creatures = Readonly<Record<string, Creature>>;

/** Der Entwurf zu einem Wesen – oder ein leerer für ein neues. */
export function draftOf(
  creature: Creature | null,
  preset: Partial<CreatureDraft> = {},
): CreatureDraft {
  return {
    name: creature?.name ?? '',
    kind: creature?.kind ?? 'template',
    parentId: creature?.parentId ?? null,
    block: creature?.block ?? {},
    features: creature?.features ?? [],
    dropped: creature?.dropped ?? [],
    source: creature?.source ?? '',
    notes: creature?.notes ?? '',
    speciesId: creature?.speciesId ?? null,
    ...preset,
  };
}

/**
 * Was „Variante“ und „Einzelner“ beim Öffnen vorbelegen: Art, Vorlage und Name. Ohne gültige
 * Vorlage ein gewöhnliches neues Wesen.
 */
export function presetFor(
  creatures: Creatures,
  kind: string | null,
  parentId: string | null,
): Partial<CreatureDraft> {
  const parent = parentId ? creatures[parentId] : undefined;
  if (!parent || parent.kind === 'individual') return {};
  if (kind === 'variant' && parent.kind === 'template')
    return {
      kind: 'variant',
      parentId,
      name: `${parent.name} (Variante)`,
      speciesId: parent.speciesId,
    };
  if (kind === 'individual')
    return { kind: 'individual', parentId, name: parent.name, speciesId: parent.speciesId };
  return {};
}

/** Unterscheiden sich zwei Entwürfe? */
export const draftsDiffer = (a: CreatureDraft, b: CreatureDraft): boolean =>
  JSON.stringify(a) !== JSON.stringify(b);

/** Erbt der Entwurf? Nur Varianten und Einzelne mit gewählter Vorlage. */
export const draftInherits = (draft: CreatureDraft): boolean =>
  draft.kind !== 'template' && draft.parentId !== null;

/** Das Wesen so, wie es gerade eingetragen ist – mit allem, was es erbt. */
export function resolveDraft(
  creatures: Creatures,
  draft: CreatureDraft,
  stored: Creature | null,
): Resolved {
  const id = stored?.id ?? 'entwurf';
  const self: Creature = {
    id,
    rev: stored?.rev ?? 0,
    created: stored?.created ?? '',
    updated: stored?.updated ?? '',
    hpNow: stored?.hpNow ?? null,
    placeId: stored?.placeId ?? null,
    ...draft,
    parentId: draftInherits(draft) ? draft.parentId : null,
  } as Creature;
  return resolveCreature({ ...creatures, [id]: self }, id)!;
}

/**
 * Wovon ein Wesen erben darf: Eine Variante erbt von einer Vorlage, ein Einzelner von Vorlage oder
 * Variante. Nie von sich selbst und nie von etwas, das von ihm erbt – sonst drehte sich die Kette
 * im Kreis.
 */
export function parentChoices(
  creatures: Creatures,
  kind: CreatureKind,
  selfId: string | null,
): Creature[] {
  return Object.values(creatures)
    .filter(
      (entry) =>
        entry.kind !== 'individual' &&
        (kind === 'individual' || entry.kind === 'template') &&
        (!selfId || !creatureChain(creatures, entry.id).some((link) => link.id === selfId)),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Was dem Speichern im Weg steht – null, wenn nichts. */
export function draftProblem(draft: CreatureDraft): string | null {
  if (!draft.name.trim()) return 'Das Wesen braucht einen Namen.';
  if (draft.kind !== 'template' && !draft.parentId)
    return 'Wähle, wovon es erbt – oder mach es zur Vorlage.';
  return null;
}

/** Setzt Felder des Statblocks; `undefined` heißt: wieder erben (oder Vorgabe). */
export function withBlock(draft: CreatureDraft, change: CreatureBlock): CreatureDraft {
  const block: CreatureBlock = { ...draft.block, ...change };
  for (const key of Object.keys(block) as (keyof CreatureBlock)[])
    if (block[key] === undefined) delete block[key];
  return { ...draft, block };
}

// ── Fähigkeiten ────────────────────────────────────────────────────────────

const sameName = (a: string, b: string) =>
  a.trim().toLocaleLowerCase('de') === b.trim().toLocaleLowerCase('de');

export interface HeirView {
  feature: CreatureFeature;
  /** Das Wesen hat sie abgelegt. */
  dropped: boolean;
  /** Eine eigene Fähigkeit gleichen Namens ersetzt sie. */
  replaced: boolean;
}

/** Die geerbten Fähigkeiten eines Abschnitts – mit dem, was der Entwurf aus ihnen macht. */
export function heirsOf(
  parent: Resolved | null,
  draft: CreatureDraft,
  section: FeatureSection,
): HeirView[] {
  if (!parent) return [];
  return parent.features
    .filter((feature) => feature.section === section)
    .map(({ inherited: _inherited, ...feature }) => ({
      feature,
      dropped: draft.dropped.some((name) => sameName(name, feature.name)),
      replaced: draft.features.some((own) => sameName(own.name, feature.name)),
    }));
}

/** Legt eine geerbte Fähigkeit ab oder nimmt sie wieder auf. */
export function keepHeir(draft: CreatureDraft, name: string, keep: boolean): CreatureDraft {
  const rest = draft.dropped.filter((entry) => !sameName(entry, name));
  return { ...draft, dropped: keep ? rest : [...rest, name] };
}

/** Verschiebt eine eigene Fähigkeit innerhalb ihres Abschnitts um eine Stelle. */
export function moveFeature(
  features: readonly CreatureFeature[],
  id: string,
  delta: -1 | 1,
): CreatureFeature[] {
  const at = features.findIndex((feature) => feature.id === id);
  if (at < 0) return [...features];
  const section = features[at]!.section;
  let to = at + delta;
  while (to >= 0 && to < features.length && features[to]!.section !== section) to += delta;
  if (to < 0 || to >= features.length) return [...features];
  const next = [...features];
  [next[at], next[to]] = [next[to]!, next[at]!];
  return next;
}

// ── Rückgängig ─────────────────────────────────────────────────────────────

export interface DraftHistory {
  past: CreatureDraft[];
  future: CreatureDraft[];
  /** Welches Feld zuletzt geändert wurde und wann – Tippen im selben Feld ist ein Schritt. */
  lastKey: string | null;
  lastAt: number;
}

export const EMPTY_HISTORY: DraftHistory = { past: [], future: [], lastKey: null, lastAt: 0 };

/** Wie lange Tippen im selben Feld als ein Schritt gilt. */
const TYPING_MS = 1200;
const MAX_STEPS = 200;

/** Merkt sich den Stand vor einer Änderung. Tippen im selben Feld ergibt einen Schritt. */
export function recordStep(
  history: DraftHistory,
  before: CreatureDraft,
  key: string,
  now: number,
): DraftHistory {
  const same = key === history.lastKey && now - history.lastAt < TYPING_MS;
  return {
    past: same ? history.past : [...history.past, before].slice(-MAX_STEPS),
    future: [],
    lastKey: key,
    lastAt: now,
  };
}

/** Nimmt den letzten Schritt zurück – null, wenn es keinen gibt. */
export function undoStep(
  history: DraftHistory,
  current: CreatureDraft,
): { history: DraftHistory; draft: CreatureDraft } | null {
  const draft = history.past[history.past.length - 1];
  if (!draft) return null;
  return {
    draft,
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future],
      lastKey: null,
      lastAt: 0,
    },
  };
}

/** Stellt den zurückgenommenen Schritt wieder her – null, wenn es keinen gibt. */
export function redoStep(
  history: DraftHistory,
  current: CreatureDraft,
): { history: DraftHistory; draft: CreatureDraft } | null {
  const draft = history.future[0];
  if (!draft) return null;
  return {
    draft,
    history: {
      past: [...history.past, current],
      future: history.future.slice(1),
      lastKey: null,
      lastAt: 0,
    },
  };
}

// ── Liegen gelassen, eingelesen ────────────────────────────────────────────

/**
 * Entwürfe, die beim Verlassen der Seite nicht gespeichert waren – nur solange Wayfarer läuft.
 * Kommt der Spielleiter zurück, steht sein Entwurf wieder da.
 */
const parked = new Map<string, CreatureDraft>();

export function parkDraft(key: string, draft: CreatureDraft | null): void {
  if (draft) parked.set(key, draft);
  else parked.delete(key);
}

export function parkedDraft(key: string): CreatureDraft | null {
  return parked.get(key) ?? null;
}

export interface ImportNote {
  missing: string[];
  unread: string[];
  notes: string[];
}

/** Was beim Einlesen eines Statblocks offen blieb – damit der Editor es zeigen kann. */
const imported = new Map<string, ImportNote>();

export function noteImport(id: string, note: ImportNote): void {
  if (note.missing.length || note.unread.length || note.notes.length) imported.set(id, note);
}

export function importNoteOf(id: string): ImportNote | null {
  return imported.get(id) ?? null;
}

export function forgetImport(id: string): void {
  imported.delete(id);
}
