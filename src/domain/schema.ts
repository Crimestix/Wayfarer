/**
 * Datenmodell von Wayfarer. Jedes Dokument ist eine eigene JSON-Datei im Kampagnenordner;
 * diese Schemata prüfen sie beim Laden und füllen fehlende Felder mit Vorgaben.
 */
import { z } from 'zod';

/** Pseudo-ID für „die Gruppe als Ganzes“ in Beziehungen. */
export const PARTY_ID = 'party';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const worldTime = z.number().int().nonnegative();

const base = {
  id,
  /** Zählt jede Speicherung; dient der Konflikterkennung. */
  rev: z.number().int().nonnegative().default(0),
  created: z.string().default(''),
  updated: z.string().default(''),
};

// ── Kalender ───────────────────────────────────────────────────────────────

export const CalendarSchema = z.object({
  id: z.string(),
  name: z.string(),
  months: z
    .array(
      z.object({
        name: z.string(),
        days: z.number().int().positive(),
        leapDays: z.number().int().optional(),
      }),
    )
    .min(1),
  weekdays: z.array(z.string()).min(1),
  leapRule: z.enum(['none', 'gregorian']),
  weekdayAnchor: z.object({ day: z.number().int(), weekday: z.number().int().nonnegative() }),
  eras: z.array(z.object({ id: z.string(), label: z.string(), offset: z.number().int() })).min(1),
  moons: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      period: z.number().positive(),
      anchor: z.number(),
      color: z.string(),
    }),
  ),
});

// ── Kampagne und Spielstand ────────────────────────────────────────────────

export const CampaignMetaSchema = z.object({
  id: z.literal('campaign'),
  schema: z.literal(1),
  rev: base.rev,
  name: z.string(),
  calendar: CalendarSchema,
  created: z.string().default(''),
  updated: z.string().default(''),
});
export type CampaignMeta = z.infer<typeof CampaignMetaSchema>;

export const PlayStateSchema = z.object({
  id: z.literal('state'),
  rev: base.rev,
  /** Aktuelle Weltzeit. */
  now: worldTime,
  /** Weltzeit vor dem letzten Zeitsprung (für „rückgängig“), sonst null. */
  previousNow: worldTime.nullable().default(null),
  /** Aufenthaltsort der Gruppe. */
  placeId: id.nullable().default(null),
  /** Laufende Session. */
  sessionId: id.nullable().default(null),
  updated: z.string().default(''),
});
export type PlayState = z.infer<typeof PlayStateSchema>;

// ── Weltdatenbank ──────────────────────────────────────────────────────────

export const ENTITY_KINDS = ['person', 'place', 'faction', 'character', 'item', 'topic'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

const LkLinkSchema = z.object({
  resourceId: z.string(),
  title: z.string().default(''),
});
export type LkLink = z.infer<typeof LkLinkSchema>;

const entityBase = {
  ...base,
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  /** Ein Satz, der am Tisch reicht. */
  tagline: z.string().default(''),
  /** Ausführliche Notizen der Spielleitung. */
  notes: z.string().default(''),
  /** Geheimnisse, die die Gruppe (noch) nicht kennt. */
  secret: z.string().default(''),
  tags: z.array(z.string()).default([]),
  /** Bild als Data-URL. */
  image: z.string().nullable().default(null),
  /** Verknüpfter LegendKeeper-Artikel. */
  lk: LkLinkSchema.nullable().default(null),
};

export const PERSON_STATUS = ['alive', 'dead', 'missing', 'unknown'] as const;
export type PersonStatus = (typeof PERSON_STATUS)[number];

const PersonDetails = z.object({
  species: z.string().default(''),
  /** Beruf, Amt oder Funktion in der Geschichte. */
  role: z.string().default(''),
  status: z.enum(PERSON_STATUS).default('alive'),
  /** Wo sich die Person gerade aufhält. */
  placeId: id.nullable().default(null),
  /** Wo sie zu Hause ist. */
  homeId: id.nullable().default(null),
  /** Hat die Gruppe die Person schon getroffen? */
  met: z.boolean().default(false),
});

const PlaceDetails = z.object({
  /** Übergeordneter Ort. */
  parentId: id.nullable().default(null),
  /** Freie Art: Region, Stadt, Dorf, Gebäude, Wildnis … */
  category: z.string().default(''),
});

const FactionDetails = z.object({
  /** Hauptsitz. */
  seatId: id.nullable().default(null),
  /** Art und Reichweite: Adelshaus, Gilde, Kult … */
  category: z.string().default(''),
});

const CharacterDetails = z.object({
  player: z.string().default(''),
  className: z.string().default(''),
  level: z.number().int().min(1).max(20).default(1),
  species: z.string().default(''),
  /** Bewegungsrate in Fuß. */
  speed: z.number().int().nonnegative().default(30),
  armorClass: z.number().int().nullable().default(null),
  hpMax: z.number().int().nullable().default(null),
  passivePerception: z.number().int().nullable().default(null),
  passiveInsight: z.number().int().nullable().default(null),
  passiveInvestigation: z.number().int().nullable().default(null),
  languages: z.array(z.string()).default([]),
  /** Erschöpfungsstufe 0–6 (D&D 2024). */
  exhaustion: z.number().int().min(0).max(6).default(0),
  conditions: z.array(z.string()).default([]),
  /** null = bei der Gruppe; sonst abweichender Aufenthaltsort. */
  placeId: id.nullable().default(null),
  /** Aktives Mitglied der Gruppe. */
  active: z.boolean().default(true),
  /** Link zum Charakterbogen auf D&D Beyond. */
  sheetUrl: z.string().default(''),
});

const ItemDetails = z.object({
  /** Wo oder bei wem der Gegenstand ist. */
  holderId: id.nullable().default(null),
  category: z.string().default(''),
});

const TopicDetails = z.object({
  category: z.string().default(''),
});

export const EntitySchema = z.discriminatedUnion('kind', [
  z.object({ ...entityBase, kind: z.literal('person'), person: PersonDetails.prefault({}) }),
  z.object({ ...entityBase, kind: z.literal('place'), place: PlaceDetails.prefault({}) }),
  z.object({ ...entityBase, kind: z.literal('faction'), faction: FactionDetails.prefault({}) }),
  z.object({
    ...entityBase,
    kind: z.literal('character'),
    character: CharacterDetails.prefault({}),
  }),
  z.object({ ...entityBase, kind: z.literal('item'), item: ItemDetails.prefault({}) }),
  z.object({ ...entityBase, kind: z.literal('topic'), topic: TopicDetails.prefault({}) }),
]);
export type Entity = z.infer<typeof EntitySchema>;
export type EntityOf<K extends EntityKind> = Extract<Entity, { kind: K }>;
export type Person = EntityOf<'person'>;
export type Place = EntityOf<'place'>;
export type Faction = EntityOf<'faction'>;
export type Character = EntityOf<'character'>;
export type Item = EntityOf<'item'>;
export type Topic = EntityOf<'topic'>;

// ── Beziehungen ────────────────────────────────────────────────────────────

export const RelationSchema = z.object({
  ...base,
  /** Von wem die Beziehung ausgeht (Entity-ID). */
  from: id,
  /** Auf wen sie sich richtet (Entity-ID oder PARTY_ID). */
  to: id,
  /** Schlüssel aus RELATION_TYPES oder „custom“. */
  type: z.string().default('knows'),
  /** Eigene Bezeichnung bei type = custom. */
  label: z.string().default(''),
  /** Haltung von `from` gegenüber `to`: −3 … +3, null = unbekannt. */
  attitude: z.number().int().min(-3).max(3).nullable().default(null),
  note: z.string().default(''),
  /** Die Gruppe weiß nichts davon. */
  secret: z.boolean().default(false),
  /** Beziehung besteht nicht mehr. */
  ended: z.boolean().default(false),
});
export type Relation = z.infer<typeof RelationSchema>;

// ── Chronik: was am Tisch passiert ist ─────────────────────────────────────

export const CHRONICLE_KINDS = [
  'note',
  'travel',
  'attitude',
  'event',
  'promise',
  'change',
] as const;
export type ChronicleKind = (typeof CHRONICLE_KINDS)[number];

export const ChronicleEntrySchema = z.object({
  ...base,
  kind: z.enum(CHRONICLE_KINDS).default('note'),
  /** Weltzeit des Geschehens. */
  at: worldTime,
  sessionId: id.nullable().default(null),
  text: z.string().default(''),
  /** Wo es geschah. */
  placeId: id.nullable().default(null),
  /** Beteiligte oder betroffene Einträge der Weltdatenbank. */
  refs: z.array(id).default([]),
  /** kind = travel: Ortswechsel der Gruppe. */
  travel: z.object({ fromId: id.nullable(), toId: id.nullable() }).nullable().default(null),
  /** kind = attitude: Haltungsänderung. */
  attitude: z
    .object({
      fromId: id,
      toId: id,
      before: z.number().int().nullable(),
      after: z.number().int().nullable(),
    })
    .nullable()
    .default(null),
  /** kind = promise: Abmachung oder Verpflichtung. */
  promise: z
    .object({ due: worldTime.nullable().default(null), done: z.boolean().default(false) })
    .nullable()
    .default(null),
  /** kind = event: eingetretener Termin. */
  eventId: id.nullable().default(null),
});
export type ChronicleEntry = z.infer<typeof ChronicleEntrySchema>;

// ── Kalender: Termine, Sessions, Timer ─────────────────────────────────────

export const EVENT_KINDS = ['world', 'plan', 'deadline'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const RepeatSchema = z.object({
  every: z.number().int().positive(),
  unit: z.enum(['day', 'week', 'month', 'year']),
});
export type Repeat = z.infer<typeof RepeatSchema>;

export const CalendarEventSchema = z.object({
  ...base,
  title: z.string(),
  at: worldTime,
  /** false = nur der Tag steht fest, die Uhrzeit ist offen. */
  timed: z.boolean().default(false),
  /** world = geschieht unabhängig von der Gruppe; plan = Vorhaben; deadline = Frist. */
  kind: z.enum(EVENT_KINDS).default('world'),
  details: z.string().default(''),
  placeId: id.nullable().default(null),
  refs: z.array(id).default([]),
  durationDays: z.number().int().positive().nullable().default(null),
  repeat: RepeatSchema.nullable().default(null),
  /** Erledigt bzw. eingetreten und abgehakt. */
  done: z.boolean().default(false),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const SessionSchema = z.object({
  ...base,
  number: z.number().int().nonnegative(),
  title: z.string().default(''),
  /** Echtes Datum des Spielabends (JJJJ-MM-TT). */
  realDate: z.string().default(''),
  startAt: worldTime,
  endAt: worldTime.nullable().default(null),
  /** Vorbereitung und Mitschrift. */
  notes: z.string().default(''),
});
export type Session = z.infer<typeof SessionSchema>;

export const TimerSchema = z.object({
  ...base,
  label: z.string(),
  /** effect = wirkt bis zum Ende; task = Tätigkeit, die bis dahin dauert. */
  kind: z.enum(['effect', 'task']).default('effect'),
  start: worldTime,
  end: worldTime,
  refs: z.array(id).default([]),
  note: z.string().default(''),
  /** Abgelaufen und zur Kenntnis genommen, oder vorzeitig beendet. */
  done: z.boolean().default(false),
});
export type Timer = z.infer<typeof TimerSchema>;

// ── Sammlungen ─────────────────────────────────────────────────────────────

export const COLLECTION_SCHEMAS = {
  entities: EntitySchema,
  relations: RelationSchema,
  chronicle: ChronicleEntrySchema,
  events: CalendarEventSchema,
  sessions: SessionSchema,
  timers: TimerSchema,
} as const;

export type CollectionName = keyof typeof COLLECTION_SCHEMAS;
export const COLLECTION_NAMES = Object.keys(COLLECTION_SCHEMAS) as CollectionName[];

export interface CollectionTypes {
  entities: Entity;
  relations: Relation;
  chronicle: ChronicleEntry;
  events: CalendarEvent;
  sessions: Session;
  timers: Timer;
}

/** Der gesamte geladene Spielstand. Unveränderlich; jede Änderung erzeugt ein neues Objekt. */
export interface CampaignData {
  campaign: CampaignMeta;
  state: PlayState;
  entities: Readonly<Record<string, Entity>>;
  relations: Readonly<Record<string, Relation>>;
  chronicle: Readonly<Record<string, ChronicleEntry>>;
  events: Readonly<Record<string, CalendarEvent>>;
  sessions: Readonly<Record<string, Session>>;
  timers: Readonly<Record<string, Timer>>;
}

// ── Hilfen ─────────────────────────────────────────────────────────────────

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

/** Macht aus einer fremden Kennung eine gültige ID. */
export function safeId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
  return cleaned || newId();
}

export const nowIso = () => new Date().toISOString();

type EntityInit<K extends EntityKind> = { kind: K; name: string } & Record<string, unknown>;

/** Legt einen vollständigen Eintrag mit allen Vorgaben an. */
export function createEntity<K extends EntityKind>(init: EntityInit<K>): EntityOf<K> {
  const stamp = nowIso();
  return EntitySchema.parse({
    id: newId(),
    created: stamp,
    updated: stamp,
    ...init,
  }) as EntityOf<K>;
}

export function createRelation(init: Partial<Relation> & { from: string; to: string }): Relation {
  const stamp = nowIso();
  return RelationSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createChronicleEntry(
  init: Partial<ChronicleEntry> & { at: number },
): ChronicleEntry {
  const stamp = nowIso();
  return ChronicleEntrySchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createEvent(
  init: Partial<CalendarEvent> & { title: string; at: number },
): CalendarEvent {
  const stamp = nowIso();
  return CalendarEventSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createSession(
  init: Partial<Session> & { number: number; startAt: number },
): Session {
  const stamp = nowIso();
  return SessionSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createTimer(
  init: Partial<Timer> & { label: string; start: number; end: number },
): Timer {
  const stamp = nowIso();
  return TimerSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}
