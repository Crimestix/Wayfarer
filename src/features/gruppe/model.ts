/**
 * Fachlogik des Bereichs „Gefährten“: Erschöpfung und Zustände nach D&D 2024, Kennzahlen der
 * Gruppe, Lange Rast, Eingaben des Bearbeiten-Dialogs. Reine Funktionen ohne React.
 */
import { byName, relationPairs } from '../../domain/derive';
import type { CampaignData, Character, Entity, Relation } from '../../domain/schema';

type Details = Character['character'];

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
const sameText = (a: string, b: string) => collator.compare(a.trim(), b.trim()) === 0;

// ── Erschöpfung (D&D 2024) ─────────────────────────────────────────────────

export const EXHAUSTION_MAX = 6;
/** Abzug auf W20-Prüfungen je Stufe. */
export const EXHAUSTION_D20_STEP = 2;
/** Abzug auf die Bewegungsrate in Fuß je Stufe. */
export const EXHAUSTION_SPEED_STEP = 5;

export const EXHAUSTION_RULE =
  'Je Stufe −2 auf alle W20-Prüfungen und −5 Fuß Bewegungsrate. Stufe 6 bedeutet den Tod. ' +
  'Eine Lange Rast senkt die Erschöpfung um 1.';

export interface ExhaustionEffect {
  level: number;
  /** Abzug auf W20-Prüfungen (0 oder negativ). */
  d20: number;
  /** Abzug auf die Bewegungsrate in Fuß (0 oder negativ). */
  speed: number;
  dead: boolean;
}

const clampExhaustion = (level: number) =>
  Math.max(0, Math.min(EXHAUSTION_MAX, Math.trunc(Number.isFinite(level) ? level : 0)));

export function exhaustionEffect(level: number): ExhaustionEffect {
  const l = clampExhaustion(level);
  return {
    level: l,
    d20: l === 0 ? 0 : -EXHAUSTION_D20_STEP * l,
    speed: l === 0 ? 0 : -EXHAUSTION_SPEED_STEP * l,
    dead: l >= EXHAUSTION_MAX,
  };
}

/**
 * Die Auswirkung der Stufe in Worten: „−4 auf W20-Prüfungen, −10 Fuß“.
 * `long` schreibt „Bewegungsrate“ dazu, wo Platz ist.
 */
export function exhaustionText(level: number, long = false): string {
  const effect = exhaustionEffect(level);
  if (effect.level === 0) return 'nicht erschöpft';
  if (effect.dead) return 'Stufe 6 – der Gefährte stirbt';
  return `−${-effect.d20} auf W20-Prüfungen, −${-effect.speed} Fuß${long ? ' Bewegungsrate' : ''}`;
}

/**
 * Klick auf eine der sechs Marken: setzt die Stufe auf diese Marke; ein Klick auf die
 * aktuelle Stufe nimmt eine Stufe zurück.
 */
export function clickExhaustionMark(current: number, mark: number): number {
  const m = clampExhaustion(mark);
  return clampExhaustion(current) === m ? Math.max(0, m - 1) : m;
}

export interface SpeedInfo {
  /** Eingetragene Bewegungsrate in Fuß. */
  base: number;
  /** Was im Augenblick davon bleibt. */
  value: number;
  /** In Worten, warum weniger bleibt; null = unverändert. */
  reason: string | null;
}

/**
 * Bewegungsrate im Augenblick: Erschöpfung zieht je Stufe 5 Fuß ab (nie unter 0); Zustände wie
 * Gepackt oder Festgesetzt setzen sie auf 0.
 */
export function speedInfo(
  details: Pick<Details, 'speed' | 'exhaustion'> & { conditions?: readonly string[] },
): SpeedInfo {
  const base = details.speed;
  const tired = Math.max(0, base + exhaustionEffect(details.exhaustion).speed);
  const halting = sortConditions(details.conditions ?? []).filter((name) => haltsMovement(name));
  if (halting.length)
    return {
      base,
      value: 0,
      reason: `${joinNames(halting)}: Bewegungsrate 0 statt ${tired} Fuß`,
    };
  return {
    base,
    value: tired,
    reason:
      tired === base
        ? null
        : `Bewegungsrate ${base} Fuß, durch Erschöpfung auf ${tired} Fuß gesenkt`,
  };
}

/** Bewegungsrate im Augenblick, siehe speedInfo. */
export function effectiveSpeed(
  details: Pick<Details, 'speed' | 'exhaustion'> & { conditions?: readonly string[] },
): number {
  return speedInfo(details).value;
}

// ── Zustände (D&D 2024) ────────────────────────────────────────────────────

export interface ConditionDef {
  name: string;
  /** Regel in einem Satz. */
  rule: string;
  /** Der Zustand setzt die Bewegungsrate auf 0. */
  halts?: boolean;
}

export const CONDITIONS: ConditionDef[] = [
  {
    name: 'Betäubt',
    rule: 'Kampfunfähig. Stärke- und Geschicklichkeitsrettungswürfe scheitern. Angriffe gegen das Ziel sind im Vorteil.',
  },
  {
    name: 'Bewusstlos',
    rule: 'Kampfunfähig und liegend, lässt alles fallen, Bewegungsrate 0. Stärke- und Geschicklichkeitsrettungswürfe scheitern. Angriffe gegen das Ziel sind im Vorteil; Treffer aus 5 Fuß sind kritisch.',
    halts: true,
  },
  {
    name: 'Bezaubert',
    rule: 'Kann den Bezaubernden weder angreifen noch mit Schädlichem belegen. Der Bezaubernde hat Vorteil bei sozialen Prüfungen gegen das Ziel.',
  },
  {
    name: 'Blind',
    rule: 'Sieht nichts; Prüfungen, die Sicht verlangen, scheitern. Angriffe gegen das Ziel sind im Vorteil, eigene Angriffe im Nachteil.',
  },
  {
    name: 'Festgesetzt',
    rule: 'Bewegungsrate 0. Angriffe gegen das Ziel sind im Vorteil, eigene Angriffe im Nachteil. Nachteil bei Geschicklichkeitsrettungswürfen.',
    halts: true,
  },
  {
    name: 'Gelähmt',
    rule: 'Kampfunfähig, Bewegungsrate 0. Stärke- und Geschicklichkeitsrettungswürfe scheitern. Angriffe gegen das Ziel sind im Vorteil; Treffer aus 5 Fuß sind kritisch.',
    halts: true,
  },
  {
    name: 'Gepackt',
    rule: 'Bewegungsrate 0. Nachteil bei Angriffen gegen alle außer dem Packenden. Der Packende kann das Ziel mit sich ziehen.',
    halts: true,
  },
  {
    name: 'Kampfunfähig',
    rule: 'Keine Aktionen, Bonusaktionen oder Reaktionen. Konzentration endet. Kann nicht sprechen. Nachteil bei Initiative.',
  },
  {
    name: 'Liegend',
    rule: 'Kann nur kriechen; Aufstehen kostet die halbe Bewegungsrate. Eigene Angriffe im Nachteil. Angriffe aus 5 Fuß gegen das Ziel im Vorteil, aus größerer Entfernung im Nachteil.',
  },
  { name: 'Taub', rule: 'Hört nichts; Prüfungen, die Gehör verlangen, scheitern.' },
  {
    name: 'Unsichtbar',
    rule: 'Vorteil bei Initiative. Lässt sich nicht durch Sicht anvisieren. Eigene Angriffe im Vorteil, Angriffe gegen das Ziel im Nachteil.',
  },
  {
    name: 'Verängstigt',
    rule: 'Nachteil bei Attributswürfen und Angriffen, solange die Quelle der Angst in Sicht ist. Kann sich ihr nicht freiwillig nähern.',
  },
  { name: 'Vergiftet', rule: 'Nachteil bei Angriffswürfen und Attributswürfen.' },
  {
    name: 'Versteinert',
    rule: 'Zu Stein geworden: kampfunfähig, Bewegungsrate 0. Stärke- und Geschicklichkeitsrettungswürfe scheitern, Angriffe gegen das Ziel sind im Vorteil. Resistenz gegen jeden Schaden, immun gegen Gift.',
    halts: true,
  },
];

const conditionIndex = (name: string) => CONDITIONS.findIndex((c) => sameText(c.name, name));

/** Regeltext zu einem Zustand; leer bei eigenen Bezeichnungen. */
export function conditionRule(name: string): string {
  return CONDITIONS[conditionIndex(name)]?.rule ?? '';
}

/** Setzt dieser Zustand die Bewegungsrate auf 0? */
export function haltsMovement(name: string): boolean {
  return CONDITIONS[conditionIndex(name)]?.halts === true;
}

export function hasCondition(conditions: readonly string[], name: string): boolean {
  return conditions.some((c) => sameText(c, name));
}

/** Zustände in fester Reihenfolge der Regelliste, eigene Bezeichnungen dahinter; ohne Doppelte. */
export function sortConditions(conditions: readonly string[]): string[] {
  const unique: string[] = [];
  for (const raw of conditions) {
    const name = raw.trim();
    if (name && !hasCondition(unique, name))
      unique.push(CONDITIONS[conditionIndex(name)]?.name ?? name);
  }
  return unique.sort((a, b) => {
    const ia = conditionIndex(a);
    const ib = conditionIndex(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return collator.compare(a, b);
  });
}

/** Schaltet einen Zustand an oder aus. */
export function toggleCondition(conditions: readonly string[], name: string): string[] {
  return hasCondition(conditions, name)
    ? sortConditions(conditions.filter((c) => !sameText(c, name)))
    : sortConditions([...conditions, name]);
}

// ── Sprachen ───────────────────────────────────────────────────────────────

/** Sprachen des Grundregelwerks (2024) auf Deutsch – als Vorschläge beim Eintragen. */
export const LANGUAGE_SUGGESTIONS = [
  'Gemeinsprache',
  'Gebärdensprache',
  'Drakonisch',
  'Elfisch',
  'Gnomisch',
  'Goblinisch',
  'Halblingisch',
  'Orkisch',
  'Riesisch',
  'Zwergisch',
  'Abyssisch',
  'Celestisch',
  'Diebessprache',
  'Druidisch',
  'Gemeinsprache der Unterreiche',
  'Infernalisch',
  'Primordial',
  'Sylvanisch',
  'Tiefensprache',
];

/**
 * Nimmt eine Eingabe wie „Elfisch, zwergisch“ in die Liste auf: trennt an Komma und Semikolon,
 * überspringt Leeres und was schon dasteht (Groß-/Kleinschreibung egal).
 */
export function addLanguages(languages: readonly string[], input: string): string[] {
  const out = [...languages];
  for (const part of input.split(/[,;\n]/)) {
    const name = part.trim().replace(/\s+/g, ' ');
    if (name && !out.some((l) => sameText(l, name))) out.push(name);
  }
  return out;
}

/**
 * Vorschläge beim Eintragen: zuerst, was andere Gefährten schon sprechen, dann die Sprachen des
 * Regelwerks – ohne das, was der Gefährte bereits spricht.
 */
export function languageSuggestions(
  known: readonly string[],
  current: readonly string[],
): string[] {
  return addLanguages([], [...known, ...LANGUAGE_SUGGESTIONS].join(',')).filter(
    (l) => !current.some((c) => sameText(c, l)),
  );
}

export function removeLanguage(languages: readonly string[], name: string): string[] {
  return languages.filter((l) => !sameText(l, name));
}

// ── Darstellung ────────────────────────────────────────────────────────────

/** „Elfin · Waldläuferin · Stufe 5“ – lässt aus, was noch nicht eingetragen ist. */
export function classLine(details: Pick<Details, 'species' | 'className' | 'level'>): string {
  return [details.species.trim(), details.className.trim(), `Stufe ${details.level}`]
    .filter(Boolean)
    .join(' · ');
}

/** Fehlen noch alle Spielwerte? Dann lädt die Karte zum Eintragen ein. */
export function lacksValues(details: Details): boolean {
  return (
    !details.className.trim() &&
    !details.species.trim() &&
    details.armorClass === null &&
    details.hpMax === null &&
    details.passivePerception === null &&
    details.passiveInsight === null &&
    details.passiveInvestigation === null &&
    details.languages.length === 0
  );
}

/**
 * Macht aus dem eingetragenen Link eine Adresse, die sich gefahrlos öffnen lässt.
 * Nur http und https; alles andere ergibt null.
 */
export function sheetHref(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

// ── Kennzahlen der Gruppe ──────────────────────────────────────────────────

export interface NamedValue {
  value: number;
  /** Wen es betrifft, nach Namen sortiert. */
  names: string[];
}

export interface LanguageSpeakers {
  language: string;
  speakers: string[];
  /** IDs der Sprecher, in derselben Reihenfolge wie die Namen. */
  speakerIds: string[];
}

export interface PartySummary {
  count: number;
  /** Niedrigste und höchste Stufe; null bei leerer Gruppe. */
  levels: { min: number; max: number } | null;
  /** Langsamste Bewegungsrate (Erschöpfung eingerechnet). */
  slowest: NamedValue | null;
  /** Niedrigste und höchste passive Wahrnehmung unter denen, bei denen sie eingetragen ist. */
  perception: {
    lowest: NamedValue;
    highest: NamedValue;
    /** Niedrigster und höchster Wert sind gleich. */
    uniform: boolean;
    /** Bei wem der Wert noch nicht eingetragen ist. */
    missing: string[];
  } | null;
  /** Sprachen, die alle sprechen. */
  commonLanguages: string[];
  /** Sprachen, die nicht alle sprechen – nach Namen sortiert, damit man sie schnell findet. */
  partialLanguages: LanguageSpeakers[];
  /** Höchste Erschöpfung; null, wenn niemand erschöpft ist. */
  exhaustion: NamedValue | null;
  /** Wie viele überhaupt erschöpft sind. */
  exhaustedCount: number;
  /** Gefährten, die abseits der Gruppe unterwegs sind. */
  away: string[];
}

function extreme(
  party: Character[],
  pick: (c: Character) => number | null,
  better: (a: number, b: number) => boolean,
): NamedValue | null {
  let best: NamedValue | null = null;
  for (const c of party) {
    const value = pick(c);
    if (value === null) continue;
    if (!best || better(value, best.value)) best = { value, names: [c.name] };
    else if (value === best.value) best.names.push(c.name);
  }
  return best;
}

/** Kennzahlen für die Kopfzeile. `party` sind die aktiven Gefährten. */
export function partySummary(party: Character[]): PartySummary {
  const sorted = [...party].sort(byName);
  const lower = (a: number, b: number) => a < b;
  const higher = (a: number, b: number) => a > b;

  const perceptionLow = extreme(sorted, (c) => c.character.passivePerception, lower);
  const perceptionHigh = extreme(sorted, (c) => c.character.passivePerception, higher);

  // Sprachen: je Sprache (ohne Rücksicht auf Groß-/Kleinschreibung), wer sie spricht.
  const languages: LanguageSpeakers[] = [];
  for (const c of sorted) {
    for (const raw of c.character.languages) {
      const name = raw.trim();
      if (!name) continue;
      let entry = languages.find((l) => sameText(l.language, name));
      if (!entry) languages.push((entry = { language: name, speakers: [], speakerIds: [] }));
      if (!entry.speakerIds.includes(c.id)) {
        entry.speakers.push(c.name);
        entry.speakerIds.push(c.id);
      }
    }
  }
  const everyone = sorted.length;
  const byLanguage = (a: LanguageSpeakers, b: LanguageSpeakers) =>
    collator.compare(a.language, b.language);
  const exhaustion = extreme(sorted, (c) => c.character.exhaustion || null, higher);

  return {
    count: everyone,
    levels: everyone
      ? {
          min: Math.min(...sorted.map((c) => c.character.level)),
          max: Math.max(...sorted.map((c) => c.character.level)),
        }
      : null,
    slowest: extreme(sorted, (c) => effectiveSpeed(c.character), lower),
    perception:
      perceptionLow && perceptionHigh
        ? {
            lowest: perceptionLow,
            highest: perceptionHigh,
            uniform: perceptionLow.value === perceptionHigh.value,
            missing: sorted
              .filter((c) => c.character.passivePerception === null)
              .map((c) => c.name),
          }
        : null,
    commonLanguages: languages
      .filter((l) => everyone > 0 && l.speakers.length === everyone)
      .sort(byLanguage)
      .map((l) => l.language),
    partialLanguages: languages.filter((l) => l.speakers.length < everyone).sort(byLanguage),
    exhaustion,
    exhaustedCount: sorted.filter((c) => c.character.exhaustion > 0).length,
    away: sorted.filter((c) => c.character.placeId !== null).map((c) => c.name),
  };
}

/** „Tomlin“, „Tomlin und Neil“, „Tomlin, Neil und Veres“. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
}

/** Sprachen, die in der aktiven Gruppe nur dieser eine Gefährte spricht. */
export function soleLanguages(summary: PartySummary, characterId: string): string[] {
  return summary.partialLanguages
    .filter((l) => l.speakerIds.length === 1 && l.speakerIds[0] === characterId)
    .map((l) => l.language);
}

/** Bis zu zwei Namen ausgeschrieben, darüber „Tomlin und 2 weitere“. */
export function shortNames(names: readonly string[]): string {
  if (names.length <= 2) return joinNames(names);
  return `${names[0]} und ${names.length - 1} weitere`;
}

/** Unterzeile zur Gruppe: „alle Stufe 5“ oder „Stufe 4–5“, dazu wer abseits unterwegs ist. */
export function groupLine(summary: PartySummary): string {
  const { levels, away } = summary;
  if (!levels) return '';
  const level =
    levels.min === levels.max
      ? summary.count === 1
        ? `Stufe ${levels.min}`
        : `alle Stufe ${levels.min}`
      : `Stufe ${levels.min}–${levels.max}`;
  return away.length ? `${level}, ${away.length} abseits` : level;
}

/** Unterzeile zur langsamsten Bewegungsrate. */
export function slowestLine(summary: PartySummary): string {
  const slowest = summary.slowest;
  if (!slowest) return '';
  if (summary.count === 1) return slowest.names[0] ?? '';
  if (slowest.names.length === summary.count) return 'alle gleich schnell';
  return `${shortNames(slowest.names)} am langsamsten`;
}

/** Unterzeile zur höchsten Erschöpfung: wen sie trifft und wie viele sonst noch erschöpft sind. */
export function exhaustionLine(summary: PartySummary): string {
  const worst = summary.exhaustion;
  if (!worst) return 'niemand ist erschöpft';
  const others = summary.exhaustedCount - worst.names.length;
  const names = shortNames(worst.names);
  if (others <= 0) return names;
  return `${names}, dazu ${others} ${others === 1 ? 'weiterer' : 'weitere'}`;
}

/**
 * Wer eine Sprache spricht, knapp für die Kopfzeile: ein oder zwei Namen ausgeschrieben,
 * darüber „4 von 6“.
 */
export function speakersLabel(entry: LanguageSpeakers, count: number): string {
  return entry.speakers.length <= 2
    ? entry.speakers.join(', ')
    : `${entry.speakers.length} von ${count}`;
}

// ── Beziehungen zu einem Gefährten ─────────────────────────────────────────

export interface CharacterBond {
  other: Entity;
  /** Wie das Gegenüber zum Gefährten steht. */
  incoming: Relation | null;
  /** Wie der Gefährte zum Gegenüber steht. */
  outgoing: Relation | null;
  /** Besteht keine der beiden Beziehungen mehr? */
  ended: boolean;
}

/** „Wer wie zu ihm steht“: Beziehungen zwischen einem Gefährten und Einträgen der Welt. */
export function characterBonds(data: CampaignData, characterId: string): CharacterBond[] {
  const bonds: CharacterBond[] = [];
  for (const pair of relationPairs(data, characterId)) {
    const other = data.entities[pair.otherId];
    if (!other) continue;
    const relations = [pair.incoming, pair.outgoing].filter((r): r is Relation => r !== null);
    bonds.push({
      other,
      incoming: pair.incoming,
      outgoing: pair.outgoing,
      ended: relations.every((r) => r.ended),
    });
  }
  // Beendete Beziehungen ans Ende; sonst bleibt die Reihenfolge nach Namen.
  return bonds.sort((a, b) => Number(a.ended) - Number(b.ended));
}

// ── Bearbeiten-Dialog ──────────────────────────────────────────────────────

/** Eingaben des Dialogs: Zahlen als Text, damit Felder leer sein dürfen. */
export interface CharacterDraft {
  name: string;
  tagline: string;
  image: string | null;
  player: string;
  className: string;
  species: string;
  level: string;
  speed: string;
  armorClass: string;
  hpMax: string;
  hp: string;
  initiative: string;
  spellSaveDc: string;
  darkvision: string;
  passivePerception: string;
  passiveInsight: string;
  passiveInvestigation: string;
  languages: string[];
  exhaustion: number;
  conditions: string[];
  placeId: string | null;
  active: boolean;
  sheetUrl: string;
  /** Was der Gefährte will. */
  goal: string;
}

const text = (n: number | null) => (n === null ? '' : String(n));

export function emptyDraft(): CharacterDraft {
  return {
    name: '',
    tagline: '',
    image: null,
    player: '',
    className: '',
    species: '',
    level: '1',
    speed: '30',
    armorClass: '',
    hpMax: '',
    hp: '',
    initiative: '',
    spellSaveDc: '',
    darkvision: '',
    passivePerception: '',
    passiveInsight: '',
    passiveInvestigation: '',
    languages: [],
    exhaustion: 0,
    conditions: [],
    placeId: null,
    active: true,
    sheetUrl: '',
    goal: '',
  };
}

export function draftFromCharacter(c: Character): CharacterDraft {
  const d = c.character;
  return {
    name: c.name,
    tagline: c.tagline,
    image: c.image,
    player: d.player,
    className: d.className,
    species: d.species,
    level: String(d.level),
    speed: String(d.speed),
    armorClass: text(d.armorClass),
    hpMax: text(d.hpMax),
    hp: text(d.hp),
    initiative: d.initiative === null ? '' : signed(d.initiative),
    spellSaveDc: text(d.spellSaveDc),
    darkvision: text(d.darkvision),
    passivePerception: text(d.passivePerception),
    passiveInsight: text(d.passiveInsight),
    passiveInvestigation: text(d.passiveInvestigation),
    languages: [...d.languages],
    exhaustion: d.exhaustion,
    conditions: sortConditions(d.conditions),
    placeId: d.placeId,
    active: d.active,
    sheetUrl: d.sheetUrl,
    goal: d.goal,
  };
}

export type DraftField =
  | 'name'
  | 'level'
  | 'speed'
  | 'armorClass'
  | 'hpMax'
  | 'hp'
  | 'initiative'
  | 'spellSaveDc'
  | 'darkvision'
  | 'passivePerception'
  | 'passiveInsight'
  | 'passiveInvestigation'
  | 'sheetUrl';

export interface DraftResult {
  /** Fehlermeldungen je Feld; leer = alles in Ordnung. */
  errors: Partial<Record<DraftField, string>>;
  /** Die geprüften Werte; null, solange es Fehler gibt. */
  value: {
    name: string;
    tagline: string;
    image: string | null;
    character: Details;
  } | null;
}

/** „+3“, „0“, „−1“ – ein Bonus mit Vorzeichen. */
export const signed = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** Liest einen Bonus mit Vorzeichen; versteht „+3“, „3“, „-1“ und „−1“. */
export function parseSigned(raw: string, min: number, max: number): number | null | 'invalid' {
  const trimmed = raw.trim().replace(/[−–]/g, '-');
  if (!trimmed) return null;
  if (!/^[+-]?\d+$/.test(trimmed)) return 'invalid';
  const n = Number(trimmed);
  return n >= min && n <= max ? n : 'invalid';
}

/** Neue Trefferpunkte nach Schaden (negativ) oder Heilung (positiv), in den Grenzen 0 … Maximum. */
export function adjustHp(current: number | null, max: number | null, delta: number): number {
  const base = current ?? max ?? 0;
  const next = Math.max(0, base + delta);
  return max === null ? next : Math.min(max, next);
}

/** Die Werte unter der Leiste: nur was eingetragen ist. */
export function combatFacts(details: {
  initiative: number | null;
  spellSaveDc: number | null;
  darkvision: number | null;
}): { label: string; value: string; title: string }[] {
  const facts: { label: string; value: string; title: string }[] = [];
  if (details.initiative !== null)
    facts.push({
      label: 'Initiative',
      value: signed(details.initiative),
      title: 'Initiativebonus',
    });
  if (details.spellSaveDc !== null)
    facts.push({
      label: 'Zauber-SG',
      value: String(details.spellSaveDc),
      title: 'Zauberrettungswurf-Schwierigkeitsgrad',
    });
  if (details.darkvision !== null && details.darkvision > 0)
    facts.push({
      label: 'Dunkelsicht',
      value: `${details.darkvision} Fuß`,
      title: 'Reichweite der Dunkelsicht',
    });
  return facts;
}

/** Ein eigener Zustand der Kampagne. */
export interface CustomCondition {
  name: string;
  rule: string;
}

/** Regeltext eines Zustands – aus dem Regelwerk oder aus den eigenen Zuständen der Kampagne. */
export function ruleOf(name: string, custom: readonly CustomCondition[] = []): string {
  return conditionRule(name) || (custom.find((c) => sameText(c.name, name))?.rule ?? '');
}

/**
 * Nimmt einen eigenen Zustand in die Liste der Kampagne auf. Namen des Regelwerks und schon
 * vorhandene eigene bleiben, wie sie sind; gibt die (ggf. unveränderte) Liste zurück.
 */
export function addCustomCondition(
  custom: readonly CustomCondition[],
  name: string,
  rule = '',
): CustomCondition[] {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean || conditionIndex(clean) >= 0 || custom.some((c) => sameText(c.name, clean)))
    return [...custom];
  return [...custom, { name: clean, rule: rule.trim() }].sort((a, b) =>
    collator.compare(a.name, b.name),
  );
}

function wholeNumber(raw: string, min: number, max: number): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  const n = Number(trimmed);
  return n >= min && n <= max ? n : 'invalid';
}

/** Prüft die Eingaben und wandelt sie in gespeicherte Werte. */
export function parseDraft(draft: CharacterDraft): DraftResult {
  const errors: DraftResult['errors'] = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'Ein Gefährte braucht einen Namen.';

  const level = wholeNumber(draft.level, 1, 20);
  if (level === null || level === 'invalid') errors.level = 'Stufe 1 bis 20.';
  const speed = wholeNumber(draft.speed, 0, 300);
  if (speed === null || speed === 'invalid') errors.speed = 'Bewegungsrate in Fuß, z. B. 30.';

  const optional = (field: DraftField, raw: string, max: number, hint: string) => {
    const n = wholeNumber(raw, 0, max);
    if (n === 'invalid') errors[field] = hint;
    return n === 'invalid' ? null : n;
  };
  const armorClass = optional(
    'armorClass',
    draft.armorClass,
    40,
    'Eine Zahl wie 16 – oder leer lassen.',
  );
  const hpMax = optional('hpMax', draft.hpMax, 999, 'Eine Zahl wie 38 – oder leer lassen.');
  const hp = optional('hp', draft.hp, 999, 'Eine Zahl wie 24 – oder leer lassen.');
  if (hp !== null && hpMax !== null && hp > hpMax && !errors.hp)
    errors.hp = 'Nicht mehr als die maximalen Trefferpunkte.';
  const spellSaveDc = optional(
    'spellSaveDc',
    draft.spellSaveDc,
    40,
    'Eine Zahl wie 15 – oder leer lassen.',
  );
  const darkvision = optional(
    'darkvision',
    draft.darkvision,
    600,
    'Reichweite in Fuß, z. B. 60 – oder leer lassen.',
  );
  const initiative = parseSigned(draft.initiative, -10, 30);
  if (initiative === 'invalid') errors.initiative = 'Ein Bonus wie +3 oder −1 – oder leer lassen.';
  const passivePerception = optional(
    'passivePerception',
    draft.passivePerception,
    40,
    'Eine Zahl wie 14 – oder leer lassen.',
  );
  const passiveInsight = optional(
    'passiveInsight',
    draft.passiveInsight,
    40,
    'Eine Zahl wie 12 – oder leer lassen.',
  );
  const passiveInvestigation = optional(
    'passiveInvestigation',
    draft.passiveInvestigation,
    40,
    'Eine Zahl wie 11 – oder leer lassen.',
  );

  const sheetUrl = draft.sheetUrl.trim();
  if (sheetUrl && !sheetHref(sheetUrl)) errors.sheetUrl = 'Das ist keine gültige Internetadresse.';

  if (Object.keys(errors).length) return { errors, value: null };
  return {
    errors,
    value: {
      name,
      tagline: draft.tagline.trim(),
      image: draft.image,
      character: {
        player: draft.player.trim(),
        className: draft.className.trim(),
        species: draft.species.trim(),
        level: level as number,
        speed: speed as number,
        armorClass,
        hpMax,
        hp,
        initiative: initiative === 'invalid' ? null : initiative,
        spellSaveDc,
        darkvision,
        passivePerception,
        passiveInsight,
        passiveInvestigation,
        languages: addLanguages([], draft.languages.join(',')),
        exhaustion: clampExhaustion(draft.exhaustion),
        conditions: sortConditions(draft.conditions),
        placeId: draft.placeId,
        active: draft.active,
        sheetUrl: sheetUrl ? (sheetHref(sheetUrl) ?? sheetUrl) : '',
        goal: draft.goal.trim(),
      },
    },
  };
}

// ── Bild ───────────────────────────────────────────────────────────────────

export const PORTRAIT_MAX = 512;

/** Verkleinert Maße so, dass die längere Seite höchstens `max` misst. Vergrößert nie. */
export function fitWithin(
  width: number,
  height: number,
  max = PORTRAIT_MAX,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
