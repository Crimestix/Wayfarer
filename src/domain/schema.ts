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
  /** Der wärmste Monat des Jahres (0-basiert) für das Wetter; null = aus dem Kalender abgeleitet. */
  warmestMonth: z.number().int().nonnegative().nullable().default(null),
  /** Das Sprachmodell, das für diese Kampagne Artikel liest (`features/ki`). */
  aiModel: z.string().default('claude-haiku-5-5'),
  /** Eigene Zustände neben den 14 des Regelwerks, z. B. „Verflucht“. */
  customConditions: z
    .array(z.object({ name: z.string().min(1), rule: z.string().default('') }))
    .default([]),
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

export const ENTITY_KINDS = [
  'person',
  'place',
  'faction',
  'character',
  'item',
  'topic',
  'family',
  'species',
  'language',
  'script',
  'ability',
] as const;
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
  /** Verknüpfter Artikel im Wiki (der Name des Feldes stammt aus der Zeit vor dem eigenen Wiki). */
  lk: LkLinkSchema.nullable().default(null),
  /**
   * Was Wayfarer aus dem Steckbrief des verknüpften Artikels übernommen hat: je Angabe (etwa
   * `homeId`) der Wortlaut, der dort stand. Ändert sich der Wortlaut im Artikel, gilt der Artikel;
   * bleibt er gleich, bleibt stehen, was seither von Hand geändert wurde.
   */
  fromArticle: z.record(z.string(), z.string()).default({}),
};

export const PERSON_STATUS = ['alive', 'dead', 'missing', 'unknown'] as const;
export type PersonStatus = (typeof PERSON_STATUS)[number];

const PersonDetails = z.object({
  /** Freitext aus der ersten Welle; `speciesId` hat Vorrang, wenn gesetzt. */
  species: z.string().default(''),
  /** Eintrag der Art „species“. */
  speciesId: id.nullable().default(null),
  /** Wo oder bei wem die Person arbeitet (Ort oder Fraktion). */
  workplaceId: id.nullable().default(null),
  /** Beruf, Amt oder Funktion in der Geschichte. */
  role: z.string().default(''),
  /**
   * Geschlecht, nur für die Wörter der Verwandtschaft („Schwester“ statt „Geschwister“). Wayfarer
   * merkt es sich aus dem ersten eingetragenen Wort; null = unbekannt.
   */
  gender: z.enum(['f', 'm']).nullable().default(null),
  status: z.enum(PERSON_STATUS).default('alive'),
  /** Wo sich die Person gerade aufhält. */
  placeId: id.nullable().default(null),
  /** Wo sie zu Hause ist. */
  homeId: id.nullable().default(null),
  /** Hat die Gruppe die Person schon getroffen? */
  met: z.boolean().default(false),
});

/** Wie hell es an einem Ort ist – nach den Stufen der Regeln. */
export const PLACE_LIGHTS = ['dark', 'dim', 'bright'] as const;
export type PlaceLight = (typeof PLACE_LIGHTS)[number];

const PlaceDetails = z.object({
  /** Übergeordneter Ort. */
  parentId: id.nullable().default(null),
  /** Freie Art: Region, Stadt, Dorf, Gebäude, Wildnis … */
  category: z.string().default(''),
  /** Klimazone für das Wetter; null = die des übergeordneten Ortes. */
  climateId: id.nullable().default(null),
  /**
   * Lage auf dem Planeten in Grad (Länge −180…180, Breite −90…90). Ohne Angabe gilt die Lage des
   * nächsten übergeordneten Ortes, der eine hat.
   */
  geo: z.object({ lon: z.number(), lat: z.number() }).nullable().default(null),
  /**
   * Helligkeit unter der Erde, von Hand festgelegt; gilt auch für die Orte darunter. null =
   * Wayfarer errechnet sie (`domain/underground.ts`).
   */
  light: z.enum(PLACE_LIGHTS).nullable().default(null),
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
  /** Aktuelle Trefferpunkte; null = wird nicht mitgeführt. */
  hp: z.number().int().nonnegative().nullable().default(null),
  /** Initiativebonus, z. B. +3. */
  initiative: z.number().int().nullable().default(null),
  /** Zauberrettungswurf-SG. */
  spellSaveDc: z.number().int().nullable().default(null),
  /** Dunkelsicht in Fuß; null = keine. */
  darkvision: z.number().int().nonnegative().nullable().default(null),
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

/** Familie, Haus oder Sippe. Mitglieder über Beziehungen der Art „member“. */
const FamilyDetails = z.object({
  /** Stammsitz. */
  seatId: id.nullable().default(null),
  category: z.string().default(''),
});

const SpeciesDetails = z.object({
  /** Freie Einordnung, z. B. Humanoid, Fee, Untoter. */
  category: z.string().default(''),
});

/** Sprache. Wer sie spricht, steht in Beziehungen der Art „speaks“. */
const LanguageDetails = z.object({
  /** Schrift, in der sie gewöhnlich geschrieben wird. */
  scriptId: id.nullable().default(null),
  category: z.string().default(''),
});

const ScriptDetails = z.object({
  category: z.string().default(''),
});

/** Besondere Fähigkeit, Gabe oder Fluch. Wer sie hat, steht in Beziehungen der Art „has-ability“. */
const AbilityDetails = z.object({
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
  z.object({ ...entityBase, kind: z.literal('family'), family: FamilyDetails.prefault({}) }),
  z.object({ ...entityBase, kind: z.literal('species'), species: SpeciesDetails.prefault({}) }),
  z.object({ ...entityBase, kind: z.literal('language'), language: LanguageDetails.prefault({}) }),
  z.object({ ...entityBase, kind: z.literal('script'), script: ScriptDetails.prefault({}) }),
  z.object({ ...entityBase, kind: z.literal('ability'), ability: AbilityDetails.prefault({}) }),
]);
export type Entity = z.infer<typeof EntitySchema>;
export type EntityOf<K extends EntityKind> = Extract<Entity, { kind: K }>;
export type Person = EntityOf<'person'>;
export type Place = EntityOf<'place'>;
export type Faction = EntityOf<'faction'>;
export type Character = EntityOf<'character'>;
export type Item = EntityOf<'item'>;
export type Topic = EntityOf<'topic'>;
export type Family = EntityOf<'family'>;
export type Species = EntityOf<'species'>;
export type Language = EntityOf<'language'>;
export type Script = EntityOf<'script'>;
export type Ability = EntityOf<'ability'>;

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
  /** Haltung von `from` gegenüber `to`: −5 (Todfeind) … +5 (Ergeben), null = unbekannt. */
  attitude: z.number().int().min(-5).max(5).nullable().default(null),
  note: z.string().default(''),
  /** Die Gruppe weiß nichts davon. */
  secret: z.boolean().default(false),
  /** Beziehung besteht nicht mehr. */
  ended: z.boolean().default(false),
  /**
   * Verwandtschaft: was `from` für `to` ist – ein Schlüssel aus `KIN_TYPES` (`domain/kin.ts`),
   * etwa `sibling` oder `aunt`. null = keine Verwandtschaft.
   */
  kin: z.string().nullable().default(null),
  /** Vorschläge zu dieser Verwandtschaft, die der Spielleiter abgelehnt hat (ihre Schlüssel). */
  kinSkip: z.array(z.string()).default([]),
  /** Aus dem Steckbrief dieses Artikels gelesen; null = von Hand eingetragen. */
  articleId: id.nullable().default(null),
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
  /** Der Eintrag stammt von einer Uhr: ihr Schritt ist eingetreten oder wurde verhindert. */
  clockId: id.nullable().default(null),
  stepId: id.nullable().default(null),
  /** Nur für die Spielleitung: fehlt in der Zusammenfassung für die Spieler. */
  secret: z.boolean().default(false),
});
export type ChronicleEntry = z.infer<typeof ChronicleEntrySchema>;

// ── Kalender: Termine, Sessions, Timer ─────────────────────────────────────

export const EVENT_KINDS = ['world', 'plan', 'deadline'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_WEIGHTS = ['auto', 'important', 'everyday'] as const;
export type EventWeightChoice = (typeof EVENT_WEIGHTS)[number];

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
  /** Tage (Tagesindex), an denen ein wiederkehrender Termin ausnahmsweise ausfällt. */
  skip: z.array(z.number().int().nonnegative()).default([]),
  /** Erledigt bzw. eingetreten und abgehakt. */
  done: z.boolean().default(false),
  /**
   * Ob der Termin im Kalender steht: auto = Wayfarer entscheidet (`domain/weight.ts`),
   * important = immer, everyday = Alltag – wird geführt, aber nicht gezeigt.
   */
  weight: z.enum(EVENT_WEIGHTS).default('auto'),
  /** Der Faden der Geschichte, zu dem der Termin gehört. */
  threadId: id.nullable().default(null),
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

/** Ein Schritt einer Uhr: was eintritt und wie viele Tage nach dem vorigen Schritt. */
export const ClockStepSchema = z.object({
  id,
  text: z.string(),
  /** Tage nach dem vorigen Schritt (beim ersten: nach dem Beginn der Uhr). */
  days: z.number().positive(),
  /** Aufschub in Minuten – durch Anhalten oder Verzögern; negativ, wenn vorgezogen. */
  delay: z.number().int().default(0),
  /** Wann der Schritt eingetreten ist (oder verhindert wurde); null = steht noch aus. */
  at: worldTime.nullable().default(null),
  /** Die Gruppe hat ihn verhindert. */
  skipped: z.boolean().default(false),
});
export type ClockStep = z.infer<typeof ClockStepSchema>;

/**
 * Eine Uhr: ein Vorhaben der Welt, das ohne die Gruppe weiterläuft. Die Schritte schreibt der
 * Spielleiter; Wayfarer lässt sie mit der Weltzeit eintreten (`domain/clock.ts`).
 */
export const ClockSchema = z.object({
  ...base,
  title: z.string(),
  /** Wer das Vorhaben betreibt – meist eine Fraktion oder Person. */
  ownerId: id.nullable().default(null),
  /** Wo es sich abspielt. */
  placeId: id.nullable().default(null),
  refs: z.array(id).default([]),
  /** Nur für die Spielleitung: Die Spieler wissen (noch) nichts davon. */
  secret: z.boolean().default(true),
  /** Ab wann die Frist des ersten Schrittes läuft. */
  start: worldTime,
  steps: z.array(ClockStepSchema).default([]),
  /** Angehalten seit – solange tritt nichts ein. */
  pausedAt: worldTime.nullable().default(null),
  note: z.string().default(''),
});
export type Clock = z.infer<typeof ClockSchema>;

// ── Geschichten und Fäden ──────────────────────────────────────────────────

/** offen = noch nicht aufgegriffen; aktiv = die Gruppe ist dran; ruhend = liegen gelassen. */
export const THREAD_STATES = ['open', 'active', 'dormant', 'solved', 'lost'] as const;
export type ThreadState = (typeof THREAD_STATES)[number];

/** Ein Hinweis an einem Faden: wo man ihn findet, wer davon weiß, ob die Gruppe ihn hat. */
export const ThreadHintSchema = z.object({
  id,
  text: z.string(),
  placeId: id.nullable().default(null),
  sourceId: id.nullable().default(null),
  found: z.boolean().default(false),
});
export type ThreadHint = z.infer<typeof ThreadHintSchema>;

/**
 * Ein Faden: eine Frage, die die Geschichte stellt, oder eine Spur, der die Gruppe folgen kann.
 * Er hängt an Personen, Orten und Fraktionen (`domain/story.ts`).
 */
export const ThreadSchema = z.object({
  ...base,
  /** Die Frage oder die Spur, in einem Satz. */
  title: z.string(),
  /** Was dahintersteckt – nur für die Spielleitung. */
  truth: z.string().default(''),
  state: z.enum(THREAD_STATES).default('open'),
  /** Die Geschichte, zu der er gehört; null = ein loser Faden. */
  storyId: id.nullable().default(null),
  refs: z.array(id).default([]),
  /** Die Gruppe kennt den Faden. */
  known: z.boolean().default(true),
  hints: z.array(ThreadHintSchema).default([]),
  /** Der Artikel, aus dem er stammt. */
  articleId: id.nullable().default(null),
});
export type Thread = z.infer<typeof ThreadSchema>;

/** Ein Einstieg: wo und wie die Gruppe auf eine Geschichte stoßen kann. */
export const StoryEntrySchema = z.object({
  id,
  text: z.string(),
  placeId: id.nullable().default(null),
});
export type StoryEntry = z.infer<typeof StoryEntrySchema>;

/**
 * Eine Geschichte ist ein Vorhaben, kein Plot: Jemand treibt sie an, eine Uhr sagt, was geschieht,
 * wenn niemand eingreift. Geschrieben vom Spielleiter; Wayfarer zeigt, wie nah die Gruppe dran
 * ist und wo Geschichten sich berühren.
 */
export const StorySchema = z.object({
  ...base,
  title: z.string(),
  /** Worum es geht. */
  summary: z.string().default(''),
  /** Wer sie antreibt: eine Person oder Fraktion. */
  ownerId: id.nullable().default(null),
  /** Was passiert, wenn niemand eingreift. */
  clockId: id.nullable().default(null),
  /** Personen, Orte und Fraktionen, die dazugehören. */
  refs: z.array(id).default([]),
  entries: z.array(StoryEntrySchema).default([]),
  /** Die Gruppe weiß von dieser Geschichte. */
  known: z.boolean().default(false),
  /** Zu Ende erzählt. */
  closed: z.boolean().default(false),
});
export type Story = z.infer<typeof StorySchema>;

export const TIMER_KINDS = ['effect', 'task', 'spell', 'light'] as const;
export type TimerKind = (typeof TIMER_KINDS)[number];

export const TimerSchema = z.object({
  ...base,
  label: z.string(),
  /**
   * effect = wirkt bis zum Ende; task = Tätigkeit, die bis dahin dauert; spell = Zauber;
   * light = eine Lichtquelle der Gruppe, die bis dahin brennt.
   */
  kind: z.enum(TIMER_KINDS).default('effect'),
  start: worldTime,
  end: worldTime,
  refs: z.array(id).default([]),
  note: z.string().default(''),
  /** Abgelaufen und zur Kenntnis genommen, oder vorzeitig beendet. */
  done: z.boolean().default(false),
  /** Wer den Zauber wirkt oder die Tätigkeit ausführt (Gefährte oder Person). */
  casterId: id.nullable().default(null),
  /** Zauber, der Konzentration erfordert. Ein Wirker hält höchstens eine Konzentration. */
  concentration: z.boolean().default(false),
  /** Betroffene Gefährten (Teilgruppe); leer = alle oder nicht zugeordnet. */
  participants: z.array(id).default([]),
});
export type Timer = z.infer<typeof TimerSchema>;

// ── Karten, Wege, Reisen ───────────────────────────────────────────────────

/** Punkt in Karteneinheiten (Pixel des Kartenbilds, Ursprung oben links). */
const point = z.tuple([z.number(), z.number()]);
export type MapPoint = z.infer<typeof point>;

/** Verweis auf eine Karte in LegendKeeper. */
const LkMapSchema = z.object({
  resourceId: z.string(),
  docId: z.string(),
});

export const MapMarkerSchema = z.object({
  id,
  x: z.number(),
  y: z.number(),
  /** Verknüpfter Eintrag der Weltdatenbank (meist ein Ort). */
  entityId: id.nullable().default(null),
  /** Kartenfeature aus LegendKeeper, aus dem der Marker stammt. */
  lkFeatureId: z.string().nullable().default(null),
  label: z.string().default(''),
  /** Artikel im Wiki, zu dem der Marker führt. */
  articleId: id.nullable().default(null),
});

/** Linie (Weg, Fluss, Grenze) oder Fläche (Gebiet) auf einer Karte. */
export const MapShapeSchema = z.object({
  id,
  kind: z.enum(['path', 'region']).default('path'),
  label: z.string().default(''),
  points: z.array(point).default([]),
  articleId: id.nullable().default(null),
});
export type MapShape = z.infer<typeof MapShapeSchema>;
export type MapMarker = z.infer<typeof MapMarkerSchema>;

export const MapScaleSchema = z.object({
  /** Kilometer je Karteneinheit. */
  kmPerUnit: z.number().positive(),
  /** Wenn aus zwei Punkten bekannter Entfernung bestimmt: die Punkte und die Entfernung. */
  calibration: z.object({ a: point, b: point, km: z.number().positive() }).nullable().default(null),
});
export type MapScale = z.infer<typeof MapScaleSchema>;

/** Gelände, das sich auf eine Karte malen lässt (`domain/mapDraw.ts`). */
export const MAP_GROUNDS = [
  'plain',
  'forest',
  'hills',
  'mountains',
  'swamp',
  'desert',
  'snow',
  'water',
  // Unter der Erde
  'rock',
  'cave',
  'fungus',
  'rubble',
  'chasm',
] as const;
export type MapGround = (typeof MAP_GROUNDS)[number];

/** Ein Pinselstrich Gelände: eine Linie mit Breite. Spätere Striche liegen über früheren. */
export const MapStrokeSchema = z.object({
  id,
  ground: z.enum(MAP_GROUNDS),
  /** Breite des Pinsels in Karteneinheiten. */
  width: z.number().positive(),
  points: z.array(point).default([]),
  /**
   * round = Pinsel mit runden Enden; butt = stumpfe Enden. Ein gerader Strich mit stumpfen Enden
   * ist ein Rechteck – so entstehen Räume.
   */
  cap: z.enum(['round', 'butt']).default('round'),
});
export type MapStroke = z.infer<typeof MapStrokeSchema>;

/** Eine gezeichnete Linie mit Bedeutung: Straße, Pfad, Fluss oder Grenze. */
export const MapLineSchema = z.object({
  id,
  kind: z.enum(['road', 'path', 'river', 'border']).default('path'),
  name: z.string().default(''),
  points: z.array(point).default([]),
  /** Der Weg des Wegenetzes, der aus dieser Linie entstanden ist. */
  pathId: id.nullable().default(null),
  /** Geheimgang, verborgener Pfad: Die Gruppe kennt ihn noch nicht. */
  secret: z.boolean().default(false),
});
export type MapLine = z.infer<typeof MapLineSchema>;

/**
 * Ein Zeichen an einem Gang, einer Straße oder in einem Raum: eine Tür oder eine Falle. Liegt es
 * auf einer Linie, gilt es für den Weg, der über sie führt (`domain/mapDraw.ts`).
 */
export const MapSignSchema = z.object({
  id,
  kind: z.enum(['door', 'trap']),
  x: z.number(),
  y: z.number(),
  name: z.string().default(''),
  /** Tür: offen, geschlossen oder verschlossen. Eine verschlossene Tür versperrt den Weg. */
  door: z.enum(['open', 'closed', 'locked']).default('closed'),
  /** Falle: scharf – oder ausgelöst und entschärft. */
  armed: z.boolean().default(true),
  /** Die Gruppe weiß nichts davon: eine Geheimtür, eine unentdeckte Falle. */
  hidden: z.boolean().default(false),
  note: z.string().default(''),
});
export type MapSign = z.infer<typeof MapSignSchema>;

export const MapSchema = z.object({
  ...base,
  name: z.string(),
  /**
   * image = ein Kartenbild mit Punkten darauf; drawn = in Wayfarer gezeichnet: Jeder Strich
   * bedeutet etwas (Gelände, Wege, Flüsse).
   */
  kind: z.enum(['image', 'drawn']).default('image'),
  /** Oberwelt oder Unterreich – bestimmt, wie die Karte gezeichnet wird. */
  level: z.enum(['surface', 'underground']).default('surface'),
  /** Gezeichnete Karte: das Gelände, wo nichts gemalt ist. */
  ground: z.enum(MAP_GROUNDS).default('plain'),
  /** Gezeichnete Karte: das gemalte Gelände, Strich für Strich. */
  strokes: z.array(MapStrokeSchema).default([]),
  /** Gezeichnete Karte: Straßen, Pfade, Flüsse, Grenzen. */
  lines: z.array(MapLineSchema).default([]),
  /** Gezeichnete Karte: Türen und Fallen. */
  signs: z.array(MapSignSchema).default([]),
  /** Bild und Pins kommen aus LegendKeeper; Maßstab und Verknüpfungen sind Wayfarer-Daten. */
  lk: LkMapSchema.nullable().default(null),
  /** Welcher Ort auf der Karte zu sehen ist. */
  placeId: id.nullable().default(null),
  /** Größe des Kartenbilds in Karteneinheiten, sobald bekannt. */
  frame: z
    .object({ width: z.number().positive(), height: z.number().positive() })
    .nullable()
    .default(null),
  scale: MapScaleSchema.nullable().default(null),
  markers: z.array(MapMarkerSchema).default([]),
  shapes: z.array(MapShapeSchema).default([]),
  /** Adresse des Kartenbilds (bis die Bilder lokal liegen: bei LegendKeeper). */
  image: z.string().nullable().default(null),
  notes: z.string().default(''),
});
export type GameMap = z.infer<typeof MapSchema>;

/** Gelände nach den Reiseregeln (D&D 2024). */
export const TERRAINS = [
  'grassland',
  'forest',
  'hills',
  'mountains',
  'swamp',
  'desert',
  'arctic',
  'coast',
  'water',
  'underdark',
  'urban',
] as const;
export type Terrain = (typeof TERRAINS)[number];

export const ROAD_KINDS = ['none', 'trail', 'road'] as const;
export type RoadKind = (typeof ROAD_KINDS)[number];

/**
 * Ein Weg zwischen zwei Orten – Grundlage für Reisen und Pointcrawl. Besteht unabhängig von
 * einer Reise und wird wiederverwendet. Ohne Karte (Stadt ohne Plan) nur Orte und Wege.
 */
export const PathSchema = z.object({
  ...base,
  fromId: id,
  toId: id,
  name: z.string().default(''),
  /** Länge in km; null = aus den Punkten und dem Kartenmaßstab berechnen. */
  distanceKm: z.number().nonnegative().nullable().default(null),
  /** Fester Aufwand in Minuten (z. B. Gasse durch die Stadt), unabhängig vom Tempo. */
  minutes: z.number().int().nonnegative().nullable().default(null),
  terrain: z.enum(TERRAINS).default('grassland'),
  road: z.enum(ROAD_KINDS).default('none'),
  /** Besonderheiten: Zoll, Brücke eingestürzt, nur bei Ebbe … */
  conditions: z.string().default(''),
  /** Nur in Richtung from → to begehbar. */
  oneWay: z.boolean().default(false),
  /** Die Gruppe kennt diesen Weg noch nicht. */
  secret: z.boolean().default(false),
  mapId: id.nullable().default(null),
  /** Verlauf auf der Karte, von from nach to. */
  points: z.array(point).default([]),
});
export type TravelPath = z.infer<typeof PathSchema>;

export const PACES = ['slow', 'normal', 'fast'] as const;
export type Pace = (typeof PACES)[number];

export const JOURNEY_STATUS = ['planned', 'underway', 'arrived', 'aborted'] as const;
export type JourneyStatus = (typeof JOURNEY_STATUS)[number];

/** Ein Abschnitt einer Reise: entweder ein gespeicherter Weg oder eine freie Strecke auf der Karte. */
export const JourneyLegSchema = z.object({
  id,
  pathId: id.nullable().default(null),
  /** Gespeicherten Weg in Gegenrichtung (to → from) gehen. */
  reverse: z.boolean().default(false),
  /** Freie Strecke: Karte, Verlauf und Ziel. */
  mapId: id.nullable().default(null),
  points: z.array(point).default([]),
  toId: id.nullable().default(null),
  distanceKm: z.number().nonnegative().nullable().default(null),
  terrain: z.enum(TERRAINS).nullable().default(null),
});
export type JourneyLeg = z.infer<typeof JourneyLegSchema>;

export const JourneyLogSchema = z.object({
  at: worldTime,
  text: z.string(),
  /** Zugehöriger Chronikeintrag, falls einer geschrieben wurde. */
  chronicleId: id.nullable().default(null),
});

export const JourneySchema = z.object({
  ...base,
  name: z.string().default(''),
  startId: id.nullable().default(null),
  /** Reisende Gefährten; leer = die ganze aktive Gruppe. */
  participants: z.array(id).default([]),
  legs: z.array(JourneyLegSchema).default([]),
  pace: z.enum(PACES).default('normal'),
  /** Reittiere aus der Bibliothek (mounts). */
  mountIds: z.array(id).default([]),
  vehicleId: id.nullable().default(null),
  /** Geplanter oder tatsächlicher Aufbruch. */
  departAt: worldTime.nullable().default(null),
  status: z.enum(JOURNEY_STATUS).default('planned'),
  /** Wo die Reise gerade steht: Abschnitt und zurückgelegte km darin. */
  progress: z
    .object({ leg: z.number().int().nonnegative(), km: z.number().nonnegative() })
    .prefault({ leg: 0, km: 0 }),
  log: z.array(JourneyLogSchema).default([]),
  notes: z.string().default(''),
});
export type Journey = z.infer<typeof JourneySchema>;

/** Reittier oder Fahrzeug aus der kleinen Bibliothek der Kampagne. */
export const MountSchema = z.object({
  ...base,
  kind: z.enum(['mount', 'vehicle']).default('mount'),
  name: z.string(),
  /** Bewegungsrate in Fuß. */
  speed: z.number().int().nonnegative().nullable().default(null),
  /** Traglast in Pfund. */
  capacity: z.number().nonnegative().nullable().default(null),
  /** Besonderheiten. */
  notes: z.string().default(''),
  /** Aus den Vorgaben des Regelwerks angelegt (sonst vom Spielleiter). */
  builtIn: z.boolean().default(false),
});
export type Mount = z.infer<typeof MountSchema>;

// ── Wetter ─────────────────────────────────────────────────────────────────

const percent = z.number().min(0).max(100);

/** Klimazone: je Monat des Kalenders Temperaturbereich und Neigungen. */
export const ClimateSchema = z.object({
  ...base,
  name: z.string(),
  months: z
    .array(
      z.object({
        /** °C */
        tempMin: z.number(),
        tempMax: z.number(),
        /** Wahrscheinlichkeit für Niederschlag an einem Tag, 0–100. */
        precipitation: percent.default(30),
        /** Wahrscheinlichkeit für Wind an einem Tag, 0–100. */
        wind: percent.default(30),
        /** Wahrscheinlichkeit für Nebel an einem Tag, 0–100. */
        fog: percent.default(5),
      }),
    )
    .default([]),
  notes: z.string().default(''),
});
export type Climate = z.infer<typeof ClimateSchema>;

export const PRECIPITATION = ['none', 'light', 'heavy'] as const;
export const WIND = ['none', 'light', 'strong'] as const;

/**
 * Wetter eines Tages in einer Zone. Das Wetter wird reproduzierbar ausgewürfelt; gespeichert wird
 * nur, was festgehalten oder von Hand gesetzt wurde. ID: `<climateId>-<Tagesindex>`.
 */
export const WeatherSchema = z.object({
  ...base,
  climateId: id,
  /** Tagesindex (ganze Tage seit Beginn der Weltzeit). */
  day: z.number().int().nonnegative(),
  temperature: z.number(),
  precipitation: z.enum(PRECIPITATION).default('none'),
  wind: z.enum(WIND).default('none'),
  fog: z.boolean().default(false),
  /** Von Hand gesetzt – nie neu auswürfeln. */
  manual: z.boolean().default(false),
  note: z.string().default(''),
});
export type Weather = z.infer<typeof WeatherSchema>;

export const weatherId = (climateId: string, day: number) => `${climateId}-${day}`;

// ── Erkundung und Tabellen ─────────────────────────────────────────────────

export const HexSchema = z.object({
  /** Axiale Koordinaten. */
  q: z.number().int(),
  r: z.number().int(),
  terrain: z.enum(TERRAINS).nullable().default(null),
  placeId: id.nullable().default(null),
  note: z.string().default(''),
  discovered: z.boolean().default(false),
  /** Vorbereitetes Ereignis, das beim Betreten eintritt. */
  prepared: z.string().default(''),
  /** Besonderheit der Landschaft, die Wayfarer erzeugt hat (z. B. „Lichtung“); frei änderbar. */
  feature: z.string().default(''),
  /** Ein Fluss des Atlas fließt durch dieses Feld: sein Name, sonst „Fluss“. Leer = keiner. */
  river: z.string().default(''),
  /** Abweichende Tabellen für dieses Hex. */
  tableIds: z.array(id).default([]),
});
export type Hex = z.infer<typeof HexSchema>;

/** Erkundungsgebiet: Hexraster über einer Karte. */
export const AreaSchema = z.object({
  ...base,
  name: z.string(),
  mapId: id.nullable().default(null),
  /** Hexgröße in km (von Seite zu Seite). */
  hexKm: z.number().positive().default(10),
  /** Lage des Rasters auf der Karte: Mittelpunkt von Hex (0, 0) und Hexgröße in Karteneinheiten. */
  origin: point.default([0, 0]),
  hexUnits: z.number().positive().nullable().default(null),
  orientation: z.enum(['flat', 'pointy']).default('flat'),
  hexes: z.array(HexSchema).default([]),
  /** Tabellen, die im ganzen Gebiet gelten. */
  tableIds: z.array(id).default([]),
  notes: z.string().default(''),
  /** Erzeugte Karte zwischen zwei Orten: Start, Ziel, Landschaft und Ausgangswert des Zufalls. */
  fromId: id.nullable().default(null),
  toId: id.nullable().default(null),
  biome: z.enum(TERRAINS).nullable().default(null),
  seed: z.number().int().nonnegative().nullable().default(null),
  /** Entfernung zwischen Start und Ziel in km, wie sie beim Erzeugen galt. */
  distanceKm: z.number().positive().nullable().default(null),
  /** Wo die Gruppe auf dieser Karte steht; null = sie ist nicht auf dieser Karte unterwegs. */
  party: z
    .object({
      q: z.number().int(),
      r: z.number().int(),
      pace: z.enum(PACES).default('normal'),
      /** Welttag der letzten Reise und die Reisezeit an diesem Tag in Minuten. */
      day: z.number().int().nonnegative().default(0),
      minutes: z.number().int().nonnegative().default(0),
      /** Die Felder, über die die Gruppe gekommen ist, in der Reihenfolge des Wegs. */
      trail: z.array(z.object({ q: z.number().int(), r: z.number().int() })).default([]),
    })
    .nullable()
    .default(null),
});
export type Area = z.infer<typeof AreaSchema>;

export const TABLE_KINDS = ['encounter', 'discovery'] as const;
export type TableKind = (typeof TABLE_KINDS)[number];

/** Begegnungs- oder Entdeckungstabelle, kampagnenweit wiederverwendbar. */
export const RollTableSchema = z.object({
  ...base,
  name: z.string(),
  kind: z.enum(TABLE_KINDS).default('encounter'),
  /** Region, für die sie gedacht ist (Ort), oder null. */
  placeId: id.nullable().default(null),
  /** Würfel für die Tabelle, z. B. 8 für W8. */
  die: z.number().int().min(2).default(6),
  /** Schwierigkeit der Begegnungsprüfung; null = keine Prüfung, immer würfeln. */
  dc: z.number().int().min(1).max(30).nullable().default(null),
  entries: z
    .array(
      z.object({
        id,
        /** Bereich auf dem Würfel, z. B. 1–2. */
        min: z.number().int().min(1),
        max: z.number().int().min(1),
        text: z.string().default(''),
        refs: z.array(id).default([]),
      }),
    )
    .default([]),
  notes: z.string().default(''),
});
export type RollTable = z.infer<typeof RollTableSchema>;

// ── Wiki ───────────────────────────────────────────────────────────────────

/**
 * Inhalt eines Artikels als Knoten der Anzeige (`ArticleNode` in
 * `features/legendkeeper/model.ts`) – die alte Form, in der Artikel aus LegendKeeper ankommen.
 * Hier nur als Liste von Objekten geprüft; ihre Form kennt der Bereich Wiki.
 */
const articleNodes = z.array(z.record(z.string(), z.unknown())).default([]);

export const ARTICLE_DOC_KINDS = ['page', 'map', 'board', 'time'] as const;

/** Eine Seite eines Artikels: Text, Karte, Board oder Zeitleiste. */
export const ArticleDocSchema = z.object({
  id,
  title: z.string().default(''),
  kind: z.enum(ARTICLE_DOC_KINDS).default('page'),
  /** In LegendKeeper vor den Spielern verborgen. */
  hidden: z.boolean().default(false),
  /** Der Text der Seite als Markdown (`features/wiki/markdown.ts`) – die Quelle der Anzeige. */
  text: z.string().default(''),
  /** Alte Form vor der Umstellung auf Text; wird beim Lesen in Text umgeschrieben. */
  nodes: articleNodes,
  /** kind = map: die Karte in der Sammlung `maps`. */
  mapId: id.nullable().default(null),
});
export type ArticleDoc = z.infer<typeof ArticleDocSchema>;

/**
 * Ein Artikel des eigenen Wikis. Artikel bilden einen Baum; ein Eintrag der Weltdatenbank gehört
 * zu einem Artikel, wenn seine LegendKeeper-Verknüpfung (`lk.resourceId`) die Kennung des
 * Artikels trägt – übernommene Artikel behalten ihre Kennung aus LegendKeeper.
 */
/**
 * Ein Vorschlag des KI-Lesers an einem Artikel: ein Termin, eine Beziehung oder etwas Offenes,
 * gelesen aus dem Text. Er gilt erst, wenn der Spielleiter ihn annimmt.
 */
export const AiHintSchema = z.object({
  id,
  /** Woran derselbe Vorschlag wiedererkannt wird – er erscheint nicht zweimal. */
  key: z.string(),
  kind: z.enum(['event', 'relation', 'thread']),
  /** Der Vorschlag in einem Satz. */
  line: z.string(),
  /** Der Satz aus dem Artikel, aus dem er gelesen wurde. */
  quote: z.string().default(''),
  /** Was beim Annehmen angelegt wird. */
  payload: z.record(z.string(), z.unknown()),
  state: z.enum(['open', 'accepted', 'dismissed']).default('open'),
});
export type AiHint = z.infer<typeof AiHintSchema>;

export const ArticleSchema = z.object({
  ...base,
  title: z.string(),
  parentId: id.nullable().default(null),
  /** Sortierschlüssel unter den Geschwistern (aufsteigend, als Text verglichen). */
  order: z.string().default(''),
  aliases: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  /** Name des Symbols aus LegendKeeper, z. B. „user“ oder „map-pin“. */
  icon: z.string().default(''),
  /** Bild über dem Artikel. */
  banner: z.string().nullable().default(null),
  hidden: z.boolean().default(false),
  /** Vorlage für neue Artikel, kein Inhalt der Welt. */
  template: z.boolean().default(false),
  /**
   * Der Titel und die Zweitnamen werden im Text anderer Artikel von selbst als Verweis erkannt.
   * Abschalten, wenn der Titel ein gewöhnliches Wort ist und zu oft trifft.
   */
  autoLink: z.boolean().default(true),
  /**
   * Vorschläge aus dem Text dieses Artikels, die der Spielleiter abgelehnt hat (Schlüssel aus
   * `features/wiki/sentences.ts`). Sie werden nicht noch einmal gezeigt.
   */
  dismissedHints: z.array(z.string()).default([]),
  /** Vorschläge des KI-Lesers zu diesem Artikel – offene, angenommene und abgelehnte. */
  aiHints: z.array(AiHintSchema).default([]),
  /** Wann der KI-Leser den Artikel zuletzt gelesen hat, womit und in welchem Wortlaut. */
  aiRead: z
    .object({
      at: z.string(),
      model: z.string(),
      /** Fingerabdruck des gelesenen Textes: Hat er sich seither geändert? */
      mark: z.string(),
      inputTokens: z.number().nonnegative().default(0),
      outputTokens: z.number().nonnegative().default(0),
    })
    .nullable()
    .default(null),
  /** Alte Form: Steckbrief als Knoten. Steht seit der Umstellung auf Text oben auf der ersten Seite. */
  sidebar: articleNodes,
  docs: z.array(ArticleDocSchema).default([]),
  /** Woher der Artikel stammt. */
  source: z.enum(['legendkeeper', 'wayfarer']).default('wayfarer'),
});
export type Article = z.infer<typeof ArticleSchema>;

// ── Rast und Wachen ────────────────────────────────────────────────────────

export const RestSchema = z.object({
  ...base,
  kind: z.enum(['short', 'long']).default('long'),
  /** Rastende Gefährten; leer = die ganze aktive Gruppe. */
  participants: z.array(id).default([]),
  placeId: id.nullable().default(null),
  sessionId: id.nullable().default(null),
  start: worldTime,
  end: worldTime.nullable().default(null),
  status: z.enum(['running', 'done', 'interrupted']).default('running'),
  /** Wachplan: wer wann wacht. */
  watches: z
    .array(
      z.object({ id, start: worldTime, end: worldTime, characterIds: z.array(id).default([]) }),
    )
    .default([]),
  /** Unterbrechungen der Rast. */
  interruptions: z
    .array(z.object({ at: worldTime, minutes: z.number().int().nonnegative(), text: z.string() }))
    .default([]),
  note: z.string().default(''),
});
export type Rest = z.infer<typeof RestSchema>;

// ── Atlas: der Planet ──────────────────────────────────────────────────────

/** Ein Ring als flache Liste `[Länge, Breite, Länge, Breite, …]` (siehe `domain/geo.ts`). */
const ring = z.array(z.number());

/**
 * Der Planet, wie er aus dem Atlas übernommen wurde. Zwei Dokumente: `planet` (Gestalt, Küsten,
 * Gewässer) und `relief` (das Höhenraster). Getrennt, weil das Raster groß ist und sich nie ändert.
 */
export const AtlasSchema = z.object({
  ...base,
  kind: z.enum(['planet', 'relief']).default('planet'),
  name: z.string().default(''),
  radiusKm: z.number().positive().default(6371),
  /** Länge eines Tages in Stunden und eines Jahres in Tagen. */
  dayHours: z.number().positive().default(24),
  yearDays: z.number().positive().default(365),
  /** Neigung der Achse in Grad – bestimmt, wie stark sich die Tageslänge übers Jahr ändert. */
  obliquityDeg: z.number().min(0).max(90).default(0),
  /** Landmassen: Küsten als Ringe, Binnenmeere und große Seen als Löcher. */
  lands: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().default(''),
        rings: z.array(ring).default([]),
        holes: z.array(ring).default([]),
        /**
         * Der Ort der Welt, der diese Landmasse ist (ein Kontinent, eine Insel) – von Hand
         * zugeordnet. null = Wayfarer erkennt ihn am Namen (`landOwners`).
         */
        placeId: id.nullable().default(null),
        /**
         * Nur für Landmassen aus einem Kartenbild, die keine Höhen mitbringen: Wayfarer erzeugt
         * ein Gelände (`generated`) oder lässt das Land flach (`flat`).
         */
        relief: z.enum(['generated', 'flat']).default('generated'),
      }),
    )
    .default([]),
  /**
   * Landmassen der Weltdatei, die ausgeblendet sind – etwa weil ein eingelesenes Kartenbild sie
   * ersetzt. Sie bleiben im Spielstand und lassen sich wieder einblenden.
   */
  hiddenLands: z.array(z.string()).default([]),
  lakes: z.array(z.object({ id: z.string(), name: z.string().default(''), ring })).default([]),
  /** Flüsse als Linie; die Breite gilt für den ganzen Lauf. */
  rivers: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().default(''),
        points: ring,
        widthKm: z.number().nonnegative().default(0),
      }),
    )
    .default([]),
  /** Höhenraster: Breite und Höhe in Zellen; Zeile 0 liegt im Norden, Spalte 0 bei Länge −180. */
  width: z.number().int().nonnegative().default(0),
  height: z.number().int().nonnegative().default(0),
  /** Höhen in Metern als 16-Bit-Zahlen, Base64; −32768 = keine Angabe. */
  heights: z.string().default(''),
  /** Woher die Daten stammen (Name der übernommenen Datei). */
  source: z.string().default(''),
});
export type Atlas = z.infer<typeof AtlasSchema>;

// ── Sammlungen ─────────────────────────────────────────────────────────────

export const COLLECTION_SCHEMAS = {
  entities: EntitySchema,
  relations: RelationSchema,
  chronicle: ChronicleEntrySchema,
  events: CalendarEventSchema,
  sessions: SessionSchema,
  timers: TimerSchema,
  maps: MapSchema,
  paths: PathSchema,
  journeys: JourneySchema,
  mounts: MountSchema,
  climates: ClimateSchema,
  weather: WeatherSchema,
  areas: AreaSchema,
  tables: RollTableSchema,
  rests: RestSchema,
  articles: ArticleSchema,
  atlas: AtlasSchema,
  clocks: ClockSchema,
  threads: ThreadSchema,
  stories: StorySchema,
} as const;

export type CollectionName = keyof typeof COLLECTION_SCHEMAS;
export const COLLECTION_NAMES = Object.keys(COLLECTION_SCHEMAS) as CollectionName[];

/** Sammlungen, die mit der zweiten Welle hinzukamen; ältere Sicherungen kennen sie nicht. */
export const LATER_COLLECTIONS: readonly CollectionName[] = [
  'maps',
  'paths',
  'journeys',
  'mounts',
  'climates',
  'weather',
  'areas',
  'tables',
  'rests',
  'articles',
  'atlas',
  'clocks',
  'threads',
  'stories',
];

export type CollectionTypes = {
  [C in CollectionName]: z.infer<(typeof COLLECTION_SCHEMAS)[C]>;
};

/** Der gesamte geladene Spielstand. Unveränderlich; jede Änderung erzeugt ein neues Objekt. */
export type CampaignData = {
  campaign: CampaignMeta;
  state: PlayState;
} & { [C in CollectionName]: Readonly<Record<string, CollectionTypes[C]>> };

/** Alle Sammlungen leer – für neue Kampagnen und Tests. */
export function emptyCollections(): { [C in CollectionName]: Record<string, CollectionTypes[C]> } {
  return Object.fromEntries(COLLECTION_NAMES.map((name) => [name, {}])) as {
    [C in CollectionName]: Record<string, CollectionTypes[C]>;
  };
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

export function createThread(init: Partial<Thread> & { title: string }): Thread {
  const stamp = nowIso();
  return ThreadSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createStory(init: Partial<Story> & { title: string }): Story {
  const stamp = nowIso();
  return StorySchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createClock(init: Partial<Clock> & { title: string; start: number }): Clock {
  const stamp = nowIso();
  return ClockSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createMap(init: Partial<GameMap> & { name: string }): GameMap {
  const stamp = nowIso();
  return MapSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createPath(
  init: Partial<TravelPath> & { fromId: string; toId: string },
): TravelPath {
  const stamp = nowIso();
  return PathSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createTimer(
  init: Partial<Timer> & { label: string; start: number; end: number },
): Timer {
  const stamp = nowIso();
  return TimerSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}
