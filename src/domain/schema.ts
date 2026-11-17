/**
 * Datenmodell von Wayfarer. Jedes Dokument ist eine eigene JSON-Datei im Kampagnenordner;
 * diese Schemata prüfen sie beim Laden und füllen fehlende Felder mit Vorgaben.
 */
import { z } from 'zod';

/** Pseudo-ID für „die Gruppe als Ganzes“ in Beziehungen. */
export const PARTY_ID = 'party';

/**
 * Datenstand für den Abgleich (`domain/sync.ts`): steigt bei jeder Änderung der Gestalt der
 * Schemata. Ein Rechner mit kleinerer Zahl holt weiter, lädt aber nichts hoch, damit er keine
 * Felder wegspeichert, die er nicht kennt. `DATA_SHAPE` ist der Fingerabdruck der Gestalt – der
 * Test `dataVersion.test.ts` sagt, wann beides neu zu setzen ist.
 */
export const DATA_VERSION = 29;
export const DATA_SHAPE = '25a5b948bc6bb756';

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
  /** Jahreszeiten des Spielleiters (`domain/seasons.ts`); leer = um den wärmsten Monat errechnet. */
  seasons: z
    .array(z.object({ name: z.string(), months: z.array(z.number().int().nonnegative()) }))
    .default([]),
});

// ── Kampagne und Spielstand ────────────────────────────────────────────────

/**
 * Ein Zeitalter: ein Abschnitt der Weltgeschichte mit Namen, Beginn und Ende (null = bis heute).
 * Beginn und Ende sind so genau, wie der Spielleiter sie kennt – meist ein Jahr.
 */
export const AgeSchema = z.object({
  id,
  name: z.string(),
  from: z.object({ at: worldTime, precision: z.enum(['day', 'month', 'year']).default('year') }),
  to: z
    .object({ at: worldTime, precision: z.enum(['day', 'month', 'year']).default('year') })
    .nullable()
    .default(null),
});
export type Age = z.infer<typeof AgeSchema>;

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
  /**
   * Regeln des Tisches: Hausregeln und Absprachen der Runde, Markdown wie die Artikel – vom
   * Spielleiter geschrieben (`domain/tableRules.ts`).
   */
  tableRules: z.string().default(''),
  /**
   * Steckbrief-Gerüste des Spielleiters: je Art die Felder, die ein neuer Artikel leer bekommt
   * (`features/wiki/scaffold.ts`). Fehlt eine Art, gilt die Vorgabe; eine leere Liste = kein Gerüst.
   */
  factScaffolds: z.record(z.string(), z.array(z.string())).default({}),
  /**
   * Eigene Vorlagen durch Merken (`domain/pageTemplate.ts`): je Kategorie und Wort („place:taverne“)
   * die Form einer Seite, die der Spielleiter einmal so geschrieben hat, wie er sie will.
   */
  pageTemplates: z
    .record(
      z.string(),
      z.object({ kind: z.string(), word: z.string(), text: z.string().default('') }),
    )
    .default({}),
  /**
   * Zeitalter der Welt, vom Spielleiter benannt (`domain/ages.ts`): als breite Bänder über der
   * Zeitleiste. Leer = keine.
   */
  ages: z.array(AgeSchema).default([]),
  created: z.string().default(''),
  updated: z.string().default(''),
});
export type CampaignMeta = z.infer<typeof CampaignMetaSchema>;

/**
 * Eine Teilgruppe, solange die Gruppe getrennt ist (`domain/party.ts`): wer dabei ist, wo sie ist
 * und ihre eigene Uhr. Für die geleitete Teilgruppe gelten `state.placeId` und `state.now` – ihre
 * Felder hier sind nur der Stand beim letzten Umschalten.
 */
export const PartyGroupSchema = z.object({
  id,
  /** Aktive Gefährten (und Begleiter), die zu dieser Teilgruppe gehören. */
  memberIds: z.array(id).default([]),
  placeId: id.nullable().default(null),
  /** Die Zeit dieser Teilgruppe – ihre eigene Uhr. */
  now: worldTime,
  /**
   * Woran sie zuletzt war: eine Tätigkeit oder ein Weg mit Beginn und Ende (ihr Eintrag in der
   * Chronik). Aus Sicht der anderen zu deren Zeit: „bis 16:20“ oder „fertig seit …“.
   */
  doing: z
    .object({ entryId: id.nullable().default(null), from: worldTime, until: worldTime })
    .nullable()
    .default(null),
});
export type PartyGroup = z.infer<typeof PartyGroupSchema>;

export const PlayStateSchema = z.object({
  id: z.literal('state'),
  rev: base.rev,
  /** Aktuelle Weltzeit. */
  now: worldTime,
  /** Weltzeit vor dem letzten Zeitsprung (für „rückgängig“), sonst null. */
  previousNow: worldTime.nullable().default(null),
  /** Aufenthaltsort der Gruppe – bei getrennter Gruppe der der geleiteten Teilgruppe. */
  placeId: id.nullable().default(null),
  /**
   * Getrennte Wege: die Teilgruppen mit eigener Uhr (`domain/party.ts`). Leer = alle zusammen.
   * `now` und `placeId` oben sind dann die der geleiteten Teilgruppe (`leadId`).
   */
  groups: z.array(PartyGroupSchema).default([]),
  /** Die geleitete Teilgruppe; null = keine Trennung. */
  leadId: id.nullable().default(null),
  /** Laufende Session. */
  sessionId: id.nullable().default(null),
  /**
   * Was der Spielleiter beobachtet (Personen, Orte, Fraktionen): Alles zu ihnen steht in „Die
   * Welt dreht sich weiter“ ganz oben, egal wie weit weg.
   */
  watch: z.array(id).default([]),
  /**
   * Das Fadenbrett: wo der Spielleiter Karten und Namen hingelegt hat. Schlüssel sind
   * `story:<id>`, `thread:<id>`, `knot:<id>` (Faden als Knoten), `node:<id>` (Eintrag der Welt)
   * und `article:<id>` (Artikel); ein Name oder Artikel, der hier steht, liegt auf dem Brett, auch
   * wenn noch nichts an ihm hängt. Was hier fehlt, legt Wayfarer selbst aus
   * (`boardLayout` in `domain/story.ts`).
   */
  board: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).default({}),
  /**
   * Bereiche auf dem Fadenbrett: benannte Rahmen zum Ordnen („Menzoberranzan“, „Akt 2“) – nur
   * Ordnung, ohne Bedeutung für die Welt (`domain/boardAreas.ts`). Was in einem Bereich liegt,
   * zieht mit, wenn er verschoben wird.
   */
  /**
   * Freie Schnüre auf dem Fadenbrett: zwei Stücke (`node:`, `article:`, `story:`, `thread:`,
   * `knot:`), die der Spielleiter verbunden hat, ohne dass daraus schon etwas in der Welt folgt –
   * etwa zwei Namen, bevor eine Beziehung eingetragen ist. `word` sagt, was sie verbindet.
   */
  boardLinks: z
    .array(
      z.object({
        id,
        a: z.string(),
        b: z.string(),
        word: z.string().default(''),
        /** `to` = ein Pfeil von `a` nach `b` („führt zu“); `none` = eine Schnur ohne Richtung. */
        dir: z.enum(['to', 'none']).default('to'),
      }),
    )
    .default([]),
  /**
   * Wo die Gruppe auf dem Storyboard gerade steht: der Schlüssel einer Karte (`thread:`,
   * `story:`) – am Spieltisch mit dem, wohin ihre Pfeile führen. null = nirgends markiert.
   */
  boardNow: z.preprocess(
    // Früher eine einzige Stelle (oder keine) – heute so viele, wie Geschichten laufen.
    (value) =>
      value === null || value === undefined ? [] : typeof value === 'string' ? [value] : value,
    z.array(z.string()),
  ),
  /**
   * Der gespielte Weg auf dem Storyboard: Karten, an denen die Gruppe schon war (in der
   * Reihenfolge). Geschrieben wird eine Möglichkeit – gespielt wird, was die Spieler daraus machen.
   */
  boardPlayed: z.array(z.string()).default([]),
  /** Karten, die der Spielleiter als Einstieg einer Geschichte markiert hat (`frameReadiness`). */
  boardStarts: z.array(z.string()).default([]),
  /**
   * Was auf einer Karte der Pinnwand steht, gehört zur Karte, nicht zum Ding (Konzeptbesprechung
   * 16. 11.): je Schlüssel (`node:`, `article:`) eine eigene Notiz und ob das Bild des Eintrags
   * auf der Karte steht.
   */
  boardNotes: z
    .record(
      z.string(),
      z.object({ text: z.string().default(''), image: z.boolean().default(false) }),
    )
    .default({}),
  /**
   * Schnüre, die der Spielleiter auf dem Fadenbrett ausgeblendet hat – nur das Bild, nie die
   * Welt: Der Name bleibt Teil der Geschichte, der Faden ihr Faden (Schlüssel der Schnur, etwa
   * `name:story:<id>|node:<id>`).
   */
  boardHidden: z.array(z.string()).default([]),
  boardAreas: z
    .array(
      z.object({
        id,
        title: z.string().default(''),
        x: z.number(),
        y: z.number(),
        w: z.number().positive(),
        h: z.number().positive(),
        /**
         * Der Rahmen ist eine Geschichte: Was in ihm liegt, gehört zu ihr (`frameMembers`) – für
         * Gefährten, Spieltisch, „Kommt vor in“. null = nur ein Rahmen zum Ordnen.
         */
        storyId: id.nullable().default(null),
      }),
    )
    .default([]),
  /**
   * „Sind verschieden“: Gruppen von Fäden mit fast gleichem Satz, die der Spielleiter nicht
   * zusammenlegen will – je Gruppe ihr Schlüssel aus `threadTwins` (`domain/looseThreads.ts`).
   */
  twinsApart: z.array(z.string()).default([]),
  /**
   * Das Fraktionsnetz in „Welt“: wo der Spielleiter Fraktionen, Familien, Personen und die Gruppe
   * (`party`) hingelegt hat – je Kennung die Stelle. Was fehlt, legt `factionNet()` aus.
   */
  netBoard: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).default({}),
  /** Marschordnung: Reihen von vorn nach hinten, je Reihe die Gefährten (`gruppe/march.ts`). */
  march: z.array(z.array(id)).default([]),
  /** Womit die Gruppe reist: ein Fortbewegungsmittel (`mounts`); null = zu Fuß. */
  travelBy: id.nullable().default(null),
  /**
   * „Passt so“: Widersprüche, die der Spielleiter für richtig erklärt hat – je Punkt sein
   * Schlüssel aus `continuityIssues` (`domain/continuity.ts`).
   */
  continuityOk: z.array(z.string()).default([]),
  /**
   * Gedächtnis beim Tippen: Unter Mitschrift und Festhalten steht leise das Wichtigste zu den
   * genannten Namen (`domain/memory.ts`). false = ausgeblendet.
   */
  nameMemory: z.boolean().default(true),
  /**
   * Die Bahnen der Zeitleiste in ihrer Reihenfolge: `party`, `events`, `story:<id>` und
   * `entity:<id>` (`domain/timeline.ts`). null = Wayfarer wählt (`defaultLaneKeys`).
   */
  timelineLanes: z.array(z.string()).nullable().default(null),
  /**
   * „Letztes Mal“ am Spieltisch: die Session, für die der Spielleiter den Rückblick weggeklickt
   * hat (`domain/recap.ts`); null = keiner.
   */
  recapDismissed: id.nullable().default(null),
  /**
   * „Im Blick“ am Spieltisch: Personen (und andere Einträge), die der Spielleiter gerade braucht
   * – sie stehen über „Wer hier ist“ und lassen sich im Kurzblick durchblättern
   * (`features/tisch/peek.ts`). Ordnet nur, schränkt nichts ein.
   */
  inView: z.array(id).default([]),
  /**
   * Vorschläge, die der Spielleiter weggeklickt hat – je Vorschlag sein Schlüssel
   * (`domain/dismiss.ts`). Sie bleiben weg, bis er sie in den Einstellungen zurückholt.
   */
  dismissed: z.array(z.string()).default([]),
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
  'plant',
  'animal',
  'mineral',
  'profession',
  'deity',
  'realm',
  'happening',
  'landscape',
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Ein Tag, Monat oder Jahr der Welt – für Lebensdaten, bei denen oft nur das Jahr bekannt ist. */
export const DatePointSchema = z.object({
  at: worldTime,
  precision: z.enum(['day', 'month', 'year']).default('day'),
});
export type DatePoint = z.infer<typeof DatePointSchema>;

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
  /** Geboren, gegründet, geschaffen (`domain/lifespan.ts`). */
  born: DatePointSchema.nullable().default(null),
  /** Gestorben, aufgelöst, zerstört – bei Personen sonst aus der Chronik (Schicksal). */
  ended: DatePointSchema.nullable().default(null),
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
  /**
   * Platzhalter, noch zu schreiben: beim Schreiben einer Geschichte angelegt (`addFromWriting`),
   * mit Namen, Art und höchstens einem Satz. Gefragt wird über `isStub()` (`domain/stub.ts`) –
   * sobald etwas Eigenes dasteht, gilt er von selbst nicht mehr als Platzhalter.
   */
  stub: z.boolean().default(false),
  /** Die Geschichte, bei deren Schreiben der Eintrag entstand. */
  fromStoryId: id.nullable().default(null),
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

/** Die Größen eines Ortes, die etwas ändern (Wer hier ist, Räume, Läden). */
export const PLACE_SCALES = ['region', 'settlement', 'building'] as const;
export type PlaceScale = (typeof PLACE_SCALES)[number];

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
  /**
   * Ein Raum des Ortes darüber (Festung, Verlies, Haus): steht nicht einzeln in der Welt und im
   * Wiki, sondern auf der Seite des Ortes darüber unter „Räume“ (`domain/rooms.ts`).
   */
  room: z.boolean().default(false),
  /** Stand eines Raums in Worten: frei, verschlossen, eingestürzt, Falle … */
  roomState: z.string().default(''),
  /**
   * Das Gelände dieser Gegend für Reisen, in den Worten des Spielleiters: „Enge Kriechgänge“,
   * „Pilzwald“ … Es gilt für alles darunter (`groundOf`). '' = keines eingetragen.
   */
  ground: z.string().default(''),
  /** Schwer zu durchqueren: Reisen hier dauern doppelt so lange (Regelwerk: schwieriges Gelände). */
  groundSlow: z.boolean().default(false),
  /**
   * Orientierung abseits von Wegen: der Schwierigkeitsgrad, den die Gruppe hier schaffen muss,
   * um sich nicht zu verirren. null = Vorschlag nach Gelände (`navDc`), 0 = nie prüfen.
   */
  navDc: z.number().int().min(0).max(30).nullable().default(null),
  /**
   * Wie groß der Ort ist (Konzeptbesprechung 16. 11.): Gegend, Siedlung, Gebäude – ein Raum ist
   * `room`. '' = nicht festgelegt; dann schätzt `placeScale()` aus Wort und Orten darin.
   */
  scale: z.enum(['', ...PLACE_SCALES]).default(''),
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
  /** Was der Gefährte will – was ihn in den nächsten Abend zieht. */
  goal: z.string().default(''),
  /**
   * Die Backstory, wie die Spieler sie geschrieben haben – vom Spielleiter als Text eingetragen.
   * Einzelne Absätze holt er als Haken für Geschichten aufs Fadenbrett (`backstoryToBoard`).
   */
  backstory: z.string().default(''),
  /**
   * Schicksal wie bei Personen: Ein toter Gefährte bleibt in der Gruppe sichtbar, aber als tot
   * gekennzeichnet. Gesetzt über Einträge der Art „Schicksal“ (`data/record.ts`).
   */
  status: z.enum(PERSON_STATUS).default('alive'),
  /**
   * Zwei Gefährten, ein Körper (`domain/body.ts`): der andere Gefährte, mit dem er sich den
   * Körper teilt; null = keiner. Beide tragen die Kennung des anderen.
   */
  bodyWith: id.nullable().default(null),
  /** Er ruht im Körper – der andere hat gerade die Kontrolle (nur mit `bodyWith`). */
  resting: z.boolean().default(false),
});

/**
 * Wie selten etwas in der Natur ist – die Stufen der Regeln für Gegenstände, auf Pflanzen, Tiere
 * und Gesteine übertragen. '' = nicht angegeben.
 */
export const RARITIES = ['common', 'uncommon', 'rare', 'very-rare', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

/** Eine Zutat eines Rezepts: eine Pflanze, ein Gestein, ein Tier, ein Gegenstand – oder nur ein Wort. */
export const IngredientSchema = z.object({
  /** Der Eintrag der Welt; null = nur in Worten. */
  entityId: id.nullable().default(null),
  /** Der Name in Worten; bei einem Eintrag sein Name zur Zeit der Wahl (bleibt, wenn er gelöscht wird). */
  text: z.string().default(''),
  /** Menge in Worten: „3“, „eine Handvoll“, „2 Pfund“. */
  qty: z.string().default(''),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

/**
 * Wie ein Gegenstand hergestellt wird (`domain/crafting.ts`). Dauer und Kosten folgen den Regeln
 * von 2024, solange hier nichts Eigenes steht.
 */
export const RecipeSchema = z.object({
  /** Der Beruf, der ihn herstellt (Art „Beruf“). */
  professionId: id.nullable().default(null),
  /** Werkzeug in Worten; leer = das Werkzeug des Berufs. */
  toolText: z.string().default(''),
  ingredients: z.array(IngredientSchema).default([]),
  /** Preis des fertigen Gegenstands in Gold – Grundlage der Regeln für gewöhnliche Dinge. */
  price: z.number().nonnegative().nullable().default(null),
  /** Arbeitstage; null = nach den Regeln. */
  days: z.number().positive().nullable().default(null),
  /** Kosten der Rohstoffe in Gold; null = nach den Regeln. */
  cost: z.number().nonnegative().nullable().default(null),
  /** Magisch: die Seltenheit; '' = ein gewöhnlicher Gegenstand. */
  rarity: z.enum(['', ...RARITIES]).default(''),
  /** Verbrauchsgut (Trank, Schriftrolle …): halbe Zeit und halbe Kosten. */
  consumable: z.boolean().default(false),
});
export type Recipe = z.infer<typeof RecipeSchema>;

/** Wie die Seiten eines Buches geordnet sind: nach Namen, nach Gegend oder nach Einordnung. */
export const BOOK_ORDERS = ['alpha', 'region', 'category'] as const;
export type BookOrder = (typeof BOOK_ORDERS)[number];

/**
 * Ein Thema der Welt, nach dem man Einträge zusammensucht: eine Art, eine Einordnung, ein
 * Schlagwort, eine Gegend, ein Ordner des Wikis. Alle gesetzten Angaben gelten zusammen; was leer
 * bleibt, schränkt nicht ein (`domain/bookTopics.ts`).
 */
export const BookTopicSchema = z.object({
  kind: z.enum(ENTITY_KINDS).nullable().default(null),
  /** Einordnung („Kraut“), ohne Groß- und Kleinschreibung verglichen; '' = jede. */
  category: z.string().default(''),
  /** Schlagwort des Eintrags oder seines Artikels; '' = jedes. */
  tag: z.string().default(''),
  /** Ort mit allem, was darunter liegt und dazugehört. */
  regionId: id.nullable().default(null),
  /** Artikel des Wikis, unter dem der Artikel des Eintrags liegt (oder der es selbst ist). */
  folderId: id.nullable().default(null),
});
export type BookTopic = z.infer<typeof BookTopicSchema>;

/** Welche Einträge der Welt in einem Buch stehen. Leere Listen schränken nicht ein. */
export const BookSelectionSchema = z.object({
  /** Themen, aus denen alles im Buch steht – auch, was später dazukommt. */
  rules: z.array(BookTopicSchema).default([]),
  // Ältere Form: eine einzige Regel aus Arten, Gegenden und Einordnungen (`legacyRules`).
  kinds: z.array(z.enum(ENTITY_KINDS)).default([]),
  /** Orte und Gegenden – mit allem, was darunter liegt und dazugehört. */
  regionIds: z.array(id).default([]),
  /** Einordnungen („Kraut“, „Erz“), ohne Groß- und Kleinschreibung verglichen. */
  categories: z.array(z.string()).default([]),
  /** Einzelne Einträge dazu – auch, wenn sie sonst nicht passen. */
  include: z.array(id).default([]),
  /** Einzelne Einträge weg – auch, wenn sie passen. */
  exclude: z.array(id).default([]),
});
export type BookSelection = z.infer<typeof BookSelectionSchema>;

/** Eine Seite in den Worten des Verfassers – sie gilt statt des Artikels. */
export const BookPageSchema = z.object({
  /** Der Wortlaut des Verfassers (Markdown wie im Wiki). */
  text: z.string().default(''),
  /** Der Wortlaut des Artikels, als die Seite überschrieben wurde – zeigt, ob er sich seither änderte. */
  base: z.string().default(''),
});
export type BookPage = z.infer<typeof BookPageSchema>;

/**
 * Ein Buch in der Welt: ein Gegenstand mit Verfasser, dessen Seiten Wayfarer aus den Artikeln des
 * Spielleiters zusammenstellt (`domain/book.ts`). Wayfarer formuliert nichts – überschriebene
 * Seiten schreibt der Spielleiter in den Worten des Verfassers.
 */
export const BookSchema = z.object({
  /** Wer es geschrieben hat – ein Eintrag der Welt … */
  authorId: id.nullable().default(null),
  /** … oder in Worten, wenn es keinen Eintrag gibt. */
  authorText: z.string().default(''),
  /** Wann es geschrieben wurde; null = nicht angegeben. */
  written: DatePointSchema.nullable().default(null),
  selection: BookSelectionSchema.prefault({}),
  order: z.enum(BOOK_ORDERS).default('alpha'),
  /** Überschriebene Seiten je Eintrag. */
  pages: z.record(id, BookPageSchema).default({}),
  /** Das Vorwort, vom Spielleiter. */
  intro: z.string().default(''),
});
export type Book = z.infer<typeof BookSchema>;

/** Die Seltenheit eines magischen Gegenstands: die Stufen der Regeln und dazu das Artefakt. */
export const MAGIC_RARITIES = [...RARITIES, 'artifact'] as const;
export type MagicRarity = (typeof MAGIC_RARITIES)[number];

/** Ladungen eines magischen Gegenstands. */
export const ChargesSchema = z.object({
  max: z.number().int().nonnegative().default(1),
  current: z.number().int().nonnegative().default(1),
  /** Wie sie wiederkommen, in Worten: „1W6+1 bei Morgengrauen“. */
  recharge: z.string().default(''),
  /**
   * Wann zuletzt eine Ladung verbraucht (oder das Auffrischen verschoben) wurde – ab dann bietet
   * Wayfarer nach Morgengrauen oder einer Langen Rast das Auffrischen an. null = nichts offen.
   */
  spentAt: worldTime.nullable().default(null),
});
export type Charges = z.infer<typeof ChargesSchema>;

/**
 * Was einen Gegenstand magisch macht (`domain/magicItem.ts`). Wirkung und Beschreibung stehen als
 * Text im Artikel; hier nur, womit Wayfarer rechnet.
 */
export const MagicSchema = z.object({
  /** '' = noch nicht festgelegt. */
  rarity: z.enum(['', ...MAGIC_RARITIES]).default(''),
  /** Art in Worten: Waffe, Ring, Trank, Wundersamer Gegenstand … */
  type: z.string().default(''),
  attunement: z
    .object({
      required: z.boolean().default(false),
      /** Wer sich einstimmen kann, in Worten: „durch einen Zauberwirker“; '' = jeder. */
      by: z.string().default(''),
    })
    .prefault({}),
  /** Auf wen der Gegenstand eingestimmt ist – ein Gefährte oder eine Person. */
  attunedTo: id.nullable().default(null),
  charges: ChargesSchema.nullable().default(null),
  /** Verbrauchsgut (Trank, Schriftrolle …): wird beim Gebrauch verbraucht. */
  consumable: z.boolean().default(false),
  /** Verbraucht – aufgebraucht oder zerstört. */
  spent: z.boolean().default(false),
  /** Verflucht – weiß nur die Spielleitung. */
  cursed: z.boolean().default(false),
  /** Die Gruppe hat erkannt, was er kann: Erst dann stehen Seltenheit, Art und Ladungen für sie da. */
  identified: z.boolean().default(false),
});
export type Magic = z.infer<typeof MagicSchema>;

const ItemDetails = z.object({
  /** Wo oder bei wem der Gegenstand ist. */
  holderId: id.nullable().default(null),
  category: z.string().default(''),
  /**
   * „Lebenslauf führen“: Wayfarer sammelt, was dem Gegenstand geschah (`domain/itemHistory.ts`),
   * und hält jeden Wechsel des Besitzers, der in Wayfarer von Hand gesetzt wird, als Veränderung
   * in der Chronik fest. Aus = alles wie ohne.
   */
  history: z.boolean().default(false),
  /** Wie er hergestellt wird; null = kein Rezept. */
  recipe: RecipeSchema.nullable().default(null),
  /** Ein Buch in der Welt (`domain/book.ts`); null = kein Buch. */
  book: BookSchema.nullable().default(null),
  /** Listenpreis in Goldmünzen – was er gewöhnlich kostet (`domain/shop.ts`); null = nicht angegeben. */
  price: z.number().nonnegative().nullable().default(null),
  /** Ein magischer Gegenstand (`domain/magicItem.ts`); null = nicht magisch. */
  magic: MagicSchema.nullable().default(null),
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

/**
 * Was Pflanzen, Tiere und Gesteine gemeinsam haben: wo und wann sie vorkommen, wie selten sie
 * sind und was sie wert sind. Aussehen, Wirkung und Nutzen stehen als Text im Artikel.
 */
const natureDetails = {
  /** Freie Einordnung: Kraut, Baum, Pilz; Wild, Reittier, Vogel; Erz, Edelstein … */
  category: z.string().default(''),
  /** Lebensräume als Wörter: Wald, Sumpf, Küste, Höhle, Unter der Erde … (`domain/nature.ts`). */
  habitat: z.array(z.string()).default([]),
  /** Orte und Gegenden, in denen es vorkommt – mit allem, was darunter liegt. */
  regionIds: z.array(id).default([]),
  /** Wann: Jahreszeiten oder Monatsnamen des Kalenders („Blüthain bis Erntfall“); leer = immer. */
  seasons: z.array(z.string()).default([]),
  rarity: z.enum(['', ...RARITIES]).default(''),
  /** Wert in Goldmünzen; null = nicht angegeben. */
  price: z.number().nonnegative().nullable().default(null),
};

/** Pflanze: alles, was wächst – auch Pilze, Moose und Algen. */
const PlantDetails = z.object(natureDetails);

/** Tier: alles, was lebt und kein Einzelner mit Namen und eigener Geschichte ist. */
const AnimalDetails = z.object({
  ...natureDetails,
  /** Die Kampfwerte im Bestiarium; null = keine. */
  creatureId: id.nullable().default(null),
});

/** Gestein: was aus dem Boden kommt – Erze, Edelsteine, Gesteine, Salze. */
const MineralDetails = z.object(natureDetails);

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

/**
 * Gottheit (Konzeptbesprechung 16. 11.): Göttin, Dämonenfürst, Schutzgeist … Anhänger stehen in
 * Beziehungen, Tempel sind Orte, Feiertage Termine – hier nur, wofür sie steht.
 */
const DeityDetails = z.object({
  category: z.string().default(''),
  /** Wofür sie steht, als Wörter: Meer, Tod, Schmiedekunst … */
  domains: z.array(z.string()).default([]),
  /** Ihr wichtigster Tempel oder heiliger Ort. */
  seatId: id.nullable().default(null),
});

/** Reich: Königreich, Stadtstaat, Grenzmark … – ein Gebiet mit Herrschaft. */
const RealmDetails = z.object({
  category: z.string().default(''),
  /** Hauptstadt oder Sitz der Herrschaft. */
  seatId: id.nullable().default(null),
  /** Die Orte und Gegenden, die dazugehören – mit allem darunter. */
  regionIds: z.array(id).default([]),
});

/**
 * Ereignis der Weltgeschichte: Krieg, Gründung, Katastrophe … Wann es war, steht in den
 * Lebensdaten (`born` = Beginn, `ended` = Ende) – so steht es von selbst in der Zeitleiste.
 */
const HappeningDetails = z.object({
  category: z.string().default(''),
  /** Wo es geschah. */
  placeId: id.nullable().default(null),
});

/**
 * Landschaft (Wunsch des Spielleiters, 17. 11. 2026: „Unsere Gelände funktionieren ähnlich wie
 * Biome“): eine Art Gegend – „Wald“, „Schwarzmoor“, „Kristallhöhlen“ –, geschrieben wie jeder
 * Artikel und auf Hexkarten gemalt (`hex.landscapeId`). Für die Regeln zählt das Grundgelände
 * (`base`); wie sie aussieht, sagt eine Geländeart (`look`, `domain/hexKinds.ts`). Wer dort lebt,
 * steht hier (`dwellerIds`: Wesen des Bestiariums, Tiere, Spezies) oder am Bewohner als
 * Lebensraum – gelesen über `dwellersOf` (`domain/landscape.ts`).
 */
const LandscapeDetails = z.object({
  category: z.string().default(''),
  base: z.enum(TERRAINS).default('grassland'),
  /** Schlüssel einer Geländeart für Farbe und Zeichen; null = das Grundgelände. */
  look: z.string().nullable().default(null),
  /** Schwer zu durchqueren: Jede Dauer verdoppelt sich wie in einer langsamen Gegend. */
  slow: z.boolean().default(false),
  /** Wer hier lebt – Kennungen von Wesen des Bestiariums oder Einträgen der Welt. */
  dwellerIds: z.array(id).default([]),
});

/** Beruf: ein Handwerk, Gewerbe oder Amt. Wer ihn ausübt, steht in Beziehungen der Art „practises“. */
const ProfessionDetails = z.object({
  /** Handwerk, Handel, Gelehrsamkeit, Heilkunde, Dienst, Land und Wasser … */
  category: z.string().default(''),
  /** Werkzeug nach den Regeln, frei geschrieben: „Schmiedewerkzeug“. */
  tool: z.string().default(''),
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
  z.object({ ...entityBase, kind: z.literal('plant'), plant: PlantDetails.prefault({}) }),
  z.object({ ...entityBase, kind: z.literal('animal'), animal: AnimalDetails.prefault({}) }),
  z.object({ ...entityBase, kind: z.literal('mineral'), mineral: MineralDetails.prefault({}) }),
  z.object({
    ...entityBase,
    kind: z.literal('profession'),
    profession: ProfessionDetails.prefault({}),
  }),
  z.object({ ...entityBase, kind: z.literal('deity'), deity: DeityDetails.prefault({}) }),
  z.object({ ...entityBase, kind: z.literal('realm'), realm: RealmDetails.prefault({}) }),
  z.object({
    ...entityBase,
    kind: z.literal('happening'),
    happening: HappeningDetails.prefault({}),
  }),
  z.object({
    ...entityBase,
    kind: z.literal('landscape'),
    landscape: LandscapeDetails.prefault({}),
  }),
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
export type Deity = EntityOf<'deity'>;
export type Realm = EntityOf<'realm'>;
export type Happening = EntityOf<'happening'>;
export type Landscape = EntityOf<'landscape'>;
export type Language = EntityOf<'language'>;
export type Script = EntityOf<'script'>;
export type Ability = EntityOf<'ability'>;
export type Plant = EntityOf<'plant'>;
export type Animal = EntityOf<'animal'>;
export type Mineral = EntityOf<'mineral'>;
export type Profession = EntityOf<'profession'>;
/** Was in der Natur vorkommt: Pflanzen, Tiere, Gesteine. */
export type NatureEntity = Plant | Animal | Mineral;

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

/**
 * Arten eines Eintrags. Die ersten sechs gibt es seit der ersten Welle; die übrigen hält der
 * Spielleiter beim Festhalten fest (Bezeichnungen und Gruppen in `domain/chronicleKinds.ts`).
 * `event` entsteht nur automatisch.
 */
export const CHRONICLE_KINDS = [
  'note',
  'travel',
  'attitude',
  'event',
  'promise',
  'change',
  // Am Tisch
  'meeting',
  'decision',
  'fight',
  'rest',
  'quote',
  // Die Welt
  'fate',
  'whereabouts',
  'discovery',
  'rumor',
  'lore',
  // Zwischen Leuten
  'bond',
  // Die Gruppe
  'condition',
  'milestone',
  'wish',
  // Geheimnisse
  'clue',
  'reveal',
  'knowledge',
  // Seit Schritt 1b
  'writing',
  'downtime',
  'transformation',
  'companion',
  // Läden und Preise
  'trade',
] as const;
export type ChronicleKind = (typeof CHRONICLE_KINDS)[number];

/** Faden (`threads/`): offen = noch nicht aufgegriffen; aktiv = die Gruppe ist dran; ruhend = liegen gelassen. */
export const THREAD_STATES = ['open', 'active', 'dormant', 'solved', 'lost'] as const;
export type ThreadState = (typeof THREAD_STATES)[number];

/** Wie genau der Zeitpunkt eines Eintrags bekannt ist; `order` = nur die Reihenfolge. */
export const CHRONICLE_PRECISIONS = ['exact', 'day', 'approx', 'order'] as const;
export type ChroniclePrecision = (typeof CHRONICLE_PRECISIONS)[number];

/** Wie ein Kampf ausging. */
export const FIGHT_OUTCOMES = ['won', 'lost', 'fled', 'truce', 'open'] as const;
export type FightOutcome = (typeof FIGHT_OUTCOMES)[number];

/** Stimmt ein Gerücht? Nie als Tatsache behandeln, solange es nicht geprüft ist. */
export const RUMOR_TRUTHS = ['unchecked', 'true', 'false'] as const;
export type RumorTruth = (typeof RUMOR_TRUTHS)[number];

/**
 * Was eine Abmachung ist: ein Versprechen, eine Schuld … (`promise`) oder ein Auftrag an die
 * Gruppe (`job`). Beide haben Frist und Stand; der Auftrag heißt nur anders.
 */
export const PROMISE_SORTS = ['promise', 'job'] as const;
export type PromiseSort = (typeof PROMISE_SORTS)[number];

/** Wie eine Beziehung vor einem Eintrag der Art `bond` stand – zum Zurücknehmen. */
export const BOND_BEFORE = ['none', 'active', 'ended'] as const;
export type BondBefore = (typeof BOND_BEFORE)[number];

/** Kaufen oder verkaufen (aus Sicht der Gruppe). */
export const TRADE_DIRECTIONS = ['buy', 'sell'] as const;
export type TradeDirection = (typeof TRADE_DIRECTIONS)[number];

/** Eine Zeile eines Handels: was, wie viele, zu welchem Stückpreis. */
export const TradeLineSchema = z.object({
  /** Ein Eintrag der Welt (meist Gegenstand, Pflanze, Tier, Gestein); null = nur in Worten. */
  entityId: id.nullable().default(null),
  /** Der Name in Worten, wie er zur Zeit des Handels hieß. */
  text: z.string().default(''),
  qty: z.number().int().positive().default(1),
  /** Stückpreis in Goldmünzen. */
  price: z.number().nonnegative().default(0),
  /** Die Einheit des Preises: „je Pfund“; leer = je Stück. */
  unit: z.string().default(''),
  /** Die Zeile des Ladenbestands, aus der es kam bzw. in die es ging; null = keine. */
  stockId: id.nullable().default(null),
  /** Beim Verkauf: Die Zeile des Bestands entstand erst durch diesen Handel. */
  stockAdded: z.boolean().default(false),
  /** Ein einzelnes Stück wechselte den Besitzer; `holderBefore` = bei wem es vorher war. */
  claimed: z.boolean().default(false),
  holderBefore: id.nullable().default(null),
});
export type TradeLine = z.infer<typeof TradeLineSchema>;

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
  /**
   * kind = travel: Ortswechsel der Gruppe. `who` = wer gezogen ist, solange die Gruppe getrennt
   * ist; leer = die ganze Gruppe (`domain/party.ts`).
   */
  travel: z
    .object({
      fromId: id.nullable(),
      toId: id.nullable(),
      who: z.array(id).optional(),
      /** Wie lange der Weg dauerte (Minuten bis zur Ankunft) – zählt für den Gewaltmarsch. */
      minutes: z.number().int().nonnegative().optional(),
    })
    .nullable()
    .default(null),
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
  /**
   * kind = promise: Abmachung oder Verpflichtung. `done` = sie ist nicht mehr offen; `failed`
   * sagt, wie sie ausging: eingelöst oder gescheitert (gebrochen, geplatzt, Frist verstrichen).
   * Gescheitert ist immer auch `done`.
   */
  promise: z
    .object({
      due: worldTime.nullable().default(null),
      done: z.boolean().default(false),
      failed: z.boolean().default(false),
      /** Versprechen oder Auftrag (Auftraggeber ist dann refs[0]); fehlt = Versprechen. */
      sort: z.enum(PROMISE_SORTS).optional(),
    })
    .nullable()
    .default(null),
  /** kind = event: eingetretener Termin. */
  eventId: id.nullable().default(null),
  /** Die Geschichte, zu der der Eintrag gehört – am Spieltisch zu ihr notiert. */
  storyId: id.nullable().default(null),
  /**
   * Wer dabei war: die Mitglieder der geleiteten Teilgruppe, solange die Gruppe getrennt ist
   * (von selbst gesetzt wie die Session, `partyStamp`); leer = die ganze Gruppe.
   */
  party: z.array(id).default([]),
  /** Der Eintrag stammt von einer Uhr: ihr Schritt ist eingetreten oder wurde verhindert. */
  clockId: id.nullable().default(null),
  stepId: id.nullable().default(null),
  /** Nur für die Spielleitung: fehlt in der Zusammenfassung für die Spieler. */
  secret: z.boolean().default(false),
  /** Nachgetragen: später festgehalten, als es geschah. */
  backfilled: z.boolean().default(false),
  /** Wie genau `at` bekannt ist. */
  precision: z.enum(CHRONICLE_PRECISIONS).default('exact'),
  /**
   * Hängt noch offen: `open` = vom Spielleiter angeheftet, `settled` = erledigt (fällt aus „Noch
   * offen“). null = Wayfarer entscheidet nach der Art (`looseEnds` in `domain/looseEnds.ts`).
   */
  loose: z.enum(['open', 'settled']).nullable().default(null),

  // Angaben der Arten, die beim Festhalten dazukamen. Was ein Eintrag am heutigen Stand geändert
  // hat, merkt er sich (`before`, `firstMet` …), damit Löschen es zurücknehmen kann.
  /** kind = meeting: wen die Gruppe dabei zum ersten Mal getroffen hat (met war vorher false). */
  meeting: z
    .object({ firstMet: z.array(id).default([]) })
    .nullable()
    .default(null),
  /** kind = fight: Ausgang und die Begegnung des Bestiariums, falls es eine gab. */
  fight: z
    .object({
      outcome: z.enum(FIGHT_OUTCOMES).default('open'),
      encounterId: id.nullable().default(null),
    })
    .nullable()
    .default(null),
  /** kind = rest: lange oder kurze Rast. */
  rest: z
    .object({ long: z.boolean().default(false) })
    .nullable()
    .default(null),
  /** kind = fate: Eine Person oder ein Gefährte ist nun tot, verschollen … `before` = Zustand davor. */
  fate: z
    .object({
      entityId: id,
      status: z.enum(PERSON_STATUS),
      before: z.enum(PERSON_STATUS).nullable().default(null),
    })
    .nullable()
    .default(null),
  /** kind = whereabouts: Eine Person oder ein Gefährte ist nun an einem Ort (null = unbekannt bzw. bei der Gruppe). */
  whereabouts: z
    .object({
      entityId: id,
      placeId: id.nullable().default(null),
      before: id.nullable().default(null),
    })
    .nullable()
    .default(null),
  /** kind = rumor: von wem es stammt und ob es stimmt. */
  rumor: z
    .object({
      sourceId: id.nullable().default(null),
      truth: z.enum(RUMOR_TRUTHS).default('unchecked'),
    })
    .nullable()
    .default(null),
  /**
   * kind = bond: Eine Beziehung beginnt (`ended` = false) oder endet. `before` sagt, wie die
   * Beziehung vor dem Eintrag stand; null = der Eintrag hat nichts geändert.
   */
  bond: z
    .object({
      relationId: id.nullable().default(null),
      fromId: id,
      toId: id,
      type: z.string().default('knows'),
      label: z.string().default(''),
      ended: z.boolean().default(false),
      before: z.enum(BOND_BEFORE).nullable().default(null),
    })
    .nullable()
    .default(null),
  /**
   * kind = condition: ein Zustand („Pfeil im Bein“) – der Text ist der Zustand. Ein späterer
   * Eintrag mit `ended` hebt ihn auf; `endsId` nennt den Eintrag, den er aufhebt.
   */
  condition: z
    .object({
      entityId: id,
      ended: z.boolean().default(false),
      endsId: id.nullable().default(null),
    })
    .nullable()
    .default(null),
  /** kind = milestone: neue Stufe eines Gefährten (null = ohne Stufe); `before` = Stufe davor. */
  milestone: z
    .object({
      characterId: id,
      level: z.number().int().min(1).max(20).nullable().default(null),
      before: z.number().int().min(1).max(20).nullable().default(null),
    })
    .nullable()
    .default(null),
  /**
   * kind = wish: Der Gefährte ist refs[0]. `setGoal` = der Text wurde sein Ziel; `before` = sein
   * Ziel davor.
   */
  wish: z
    .object({
      setGoal: z.boolean().default(false),
      before: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  /** kind = clue: der gefundene Hinweis; `before` = Stand des Fadens, falls der Eintrag ihn gefunden hat. */
  clue: z
    .object({
      threadId: id.nullable().default(null),
      hintId: id.nullable().default(null),
      before: z
        .object({ known: z.boolean(), state: z.enum(THREAD_STATES) })
        .nullable()
        .default(null),
    })
    .nullable()
    .default(null),
  /**
   * kind = reveal: das Geheimnis vom Abend-Blatt; `applied` = der Eintrag hat es aufgedeckt.
   * `alias`: ein enthüllter wahrer Name (oder Deckname), der als zweiter Name zum Eintrag kam;
   * `added` = der Eintrag hat ihn hinzugefügt (Löschen nimmt ihn dann wieder weg).
   */
  reveal: z
    .object({
      prepSecretId: id.nullable().default(null),
      applied: z.boolean().default(false),
      /**
       * Das Geheimnis war der Hinweis einer Frage: Der Eintrag hat ihn gefunden; `before` = Stand
       * des Fadens davor (wie bei `clue`).
       */
      hint: z
        .object({
          threadId: id,
          hintId: id,
          before: z.object({ known: z.boolean(), state: z.enum(THREAD_STATES) }),
        })
        .nullable()
        .default(null),
      alias: z
        .object({ entityId: id, name: z.string(), added: z.boolean().default(false) })
        .nullable()
        .default(null),
    })
    .nullable()
    .default(null),
  /**
   * kind = writing: ein Schriftstück – Brief, Botschaft, Aushang –, wörtlich im Text. `articleId`
   * = der Artikel im Wiki, als den der Spielleiter es abgelegt hat.
   */
  writing: z
    .object({
      title: z.string().default(''),
      articleId: id.nullable().default(null),
    })
    .nullable()
    .default(null),
  /**
   * kind = downtime: Zwischenzeit – so viele Tage vergehen mit Tätigkeiten der Gefährten. Der
   * Eintrag steht am Beginn; er stellt nie die Weltzeit vor.
   */
  downtime: z
    .object({
      days: z.number().int().nonnegative().default(0),
      /**
       * Eine Tätigkeit einer Teilgruppe mit Dauer in Minuten („in der Bibliothek, 3 Std.“);
       * fehlt = Tage der freien Zeit wie oben.
       */
      minutes: z.number().int().positive().optional(),
      activities: z.array(z.object({ characterId: id, text: z.string().default('') })).default([]),
    })
    .nullable()
    .default(null),
  /** kind = transformation: Wandlung eines Gefährten (neue Kräfte, Gestalt …) – der Text sagt, welche. */
  transformation: z.object({ characterId: id }).nullable().default(null),
  /**
   * kind = companion: Ein Tier oder Wesen (Eintrag der Art „person“) kommt zur Gruppe oder geht.
   * `ownerId` = der Gefährte, zu dem es gehört (null = die ganze Gruppe). Die Wirkung ist eine
   * Beziehung der Art „companion“; `before` sagt wie bei `bond`, wie sie vorher stand.
   */
  companion: z
    .object({
      entityId: id,
      joined: z.boolean().default(true),
      ownerId: id.nullable().default(null),
      relationId: id.nullable().default(null),
      before: z.enum(BOND_BEFORE).nullable().default(null),
    })
    .nullable()
    .default(null),
  /**
   * kind = change: Ein Gegenstand mit Lebenslauf ist jetzt bei `holderId` (null = unbekannt);
   * `before` = bei wem er vorher war. Nur festgehalten – den Besitzer hat der Spielleiter selbst
   * gesetzt; Löschen des Eintrags ändert ihn nicht.
   */
  holder: z
    .object({
      itemId: id,
      holderId: id.nullable().default(null),
      before: id.nullable().default(null),
    })
    .nullable()
    .default(null),
  /**
   * kind = trade: Die Gruppe hat gekauft (`buy`) oder verkauft (`sell`) – in einem Laden
   * (`shopId`) oder ohne. `toId` = der Gefährte, der kauft bzw. verkauft; null = die Gruppe.
   * Je Zeile Stückpreis und Menge; `total` = die Summe. Was der Eintrag geändert hat, merkt er
   * sich, damit Löschen es zurücknimmt: Bestand (`stockId`, `stockAdded`) und Besitzer eines
   * einzelnen Stücks (`holderBefore`, `claimed`).
   */
  trade: z
    .object({
      shopId: id.nullable().default(null),
      direction: z.enum(TRADE_DIRECTIONS).default('buy'),
      toId: id.nullable().default(null),
      lines: z.array(TradeLineSchema).default([]),
      total: z.number().nonnegative().default(0),
    })
    .nullable()
    .default(null),
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

/** Woher die Notizen einer nachgetragenen Session stammen – und die Notizen selbst. */
export const SessionSourceSchema = z.object({
  /** Dateiname, wie er gewählt wurde. */
  file: z.string(),
  /** Die Notizen, unverändert. */
  text: z.string(),
  /** Zeile der Grenze in der Datei (1-basiert), 0 = unbekannt. */
  line: z.number().int().nonnegative().default(0),
  /** Wie genau die Weltzeit der Session beim Übernehmen bekannt war. */
  precision: z.enum(CHRONICLE_PRECISIONS).default('exact'),
});
export type SessionSource = z.infer<typeof SessionSourceSchema>;

/** Was aus einem Vorschlag beim Lesen der Notizen werden kann: eine Art der Chronik, ein Faden oder Beute. */
export const READ_PROPOSAL_KINDS = [...CHRONICLE_KINDS, 'thread', 'loot'] as const;
export type ReadProposalKind = (typeof READ_PROPOSAL_KINDS)[number];
export const READ_PROPOSAL_STATES = ['open', 'accepted', 'dismissed'] as const;
export type ReadProposalState = (typeof READ_PROPOSAL_STATES)[number];

/**
 * Ein Vorschlag aus den Notizen einer Session (`features/nachtragen/readSession.ts`). Er gilt erst,
 * wenn der Spielleiter ihn annimmt; `key` (aus Satz und Art) hält die Entscheidung über erneutes
 * Lesen hinweg.
 */
export const ReadProposalSchema = z.object({
  id,
  key: z.string(),
  kind: z.enum(READ_PROPOSAL_KINDS),
  /** Der Vorschlag in Worten: „Schicksal: Krummzahn → tot“. */
  label: z.string().default(''),
  /** Der Satz (bzw. die Zeilen) der Notizen, aus dem er stammt – wörtlich. */
  quote: z.string().default(''),
  /** Text des Eintrags – meist das Zitat; beim Schriftstück der ganze Wortlaut. */
  text: z.string().default(''),
  /** Zeile in den Notizen (1-basiert) und Stelle im Text (`session.source.text`). */
  line: z.number().int().nonnegative().default(0),
  from: z.number().int().nonnegative().default(0),
  to: z.number().int().nonnegative().default(0),
  /** Geschätzte Weltzeit und wie genau sie ist. */
  at: worldTime,
  precision: z.enum(CHRONICLE_PRECISIONS).default('order'),
  secret: z.boolean().default(false),
  refs: z.array(id).default([]),
  /** Angaben der Art (wie beim Erkennen: offene Dinge sind null); Faden: `title`; Beute: `text`, `gold`, `toId`, `source`. */
  payload: z.record(z.string(), z.unknown()).default({}),
  /** Hinweise zum Prüfen, etwa ein Widerspruch zu einer späteren Session. */
  hints: z.array(z.string()).default([]),
  /** Unbekannte Namen im Satz (Schlüssel der Fragen). */
  names: z.array(z.string()).default([]),
  state: z.enum(READ_PROPOSAL_STATES).default('open'),
  /** Was das Annehmen angelegt hat (zum Zurücknehmen). */
  created: z.array(z.object({ collection: z.string(), id })).default([]),
  /**
   * Was das Annehmen an Vorhandenem geändert hat, zum Zurücknehmen: eine Zeile im Steckbrief
   * (`fact`, `before` = die Zeile davor), eine Zeile unter „Was geschah“ (`happened`) – beide im
   * Artikel `targetId` – oder ein zweiter Name am Eintrag `targetId` (`alias`). `made` = der
   * Steckbrief bzw. Abschnitt entstand dabei erst. Bei einem Faden: `source` = den Faden
   * `targetId` gab es schon, die Session (`line`) kam nur als Quelle dazu; `story` = der neue
   * Faden `targetId` kam gleich an die Geschichte `line`.
   */
  edits: z
    .array(
      z.object({
        kind: z.enum(['fact', 'happened', 'alias', 'source', 'story']),
        targetId: id,
        line: z.string(),
        before: z.string().nullable().default(null),
        made: z.boolean().default(false),
      }),
    )
    .default([]),
  /** Stand beim letzten Lesen nicht mehr in den Notizen – bleibt, weil schon entschieden. */
  stale: z.boolean().default(false),
});
export type ReadProposal = z.infer<typeof ReadProposalSchema>;

/** Eine Frage zu einem Namen, den Wayfarer in der Welt nicht findet: „Wer oder was ist X?“ */
export const ReadQuestionSchema = z.object({
  /** Der Name, vereinheitlicht – woran die Antwort beim erneuten Lesen hängt. */
  key: z.string(),
  /** Wie er in den Notizen steht. */
  name: z.string(),
  count: z.number().int().nonnegative().default(0),
  /** Zeilen (1-basiert), in denen er steht. */
  lines: z.array(z.number().int().nonnegative()).default([]),
  /** offen; `linked` = ein vorhandener Eintrag (der Name wurde sein zweiter Name); `created` = neu angelegt; `none` = niemand Bestimmtes. */
  state: z.enum(['open', 'linked', 'created', 'none']).default('open'),
  entityId: id.nullable().default(null),
});
export type ReadQuestion = z.infer<typeof ReadQuestionSchema>;

/** Abschnitte der Notizen, wie sie gelesen wurden (Rückblick, Fäden, Beute, Regelnotizen …). */
export const READ_SECTION_KINDS = [
  'recap',
  'heading',
  'text',
  'hooks',
  'loot',
  'purchases',
  'order',
  'writing',
  'quote',
  'rules',
  'list',
] as const;
export type ReadSectionKind = (typeof READ_SECTION_KINDS)[number];

/**
 * Stand des Lesens einer nachgetragenen Session (Schritt 3, `features/nachtragen/readSession.ts`):
 * Vorschläge mit ihrem Zustand, Fragen zu unbekannten Namen und die erkannten Abschnitte.
 * Weitere Angaben bleiben beim Laden erhalten.
 */
export const SessionReadingSchema = z.looseObject({
  /** Wann zuletzt gelesen wurde (ISO-Zeit des Rechners). */
  readAt: z.string().default(''),
  /** Fingerabdruck der gelesenen Notizen: Haben sie sich seither geändert? */
  mark: z.string().default(''),
  /** Vorlesetext und Rückblick, wie sie gelesen wurden (wörtlich) – daraus kommen keine Vorschläge. */
  recap: z.string().default(''),
  proposals: z.array(ReadProposalSchema).default([]),
  questions: z.array(ReadQuestionSchema).default([]),
  sections: z
    .array(
      z.object({
        kind: z.enum(READ_SECTION_KINDS),
        /** Zeilen (1-basiert, einschließlich). */
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
        title: z.string().default(''),
      }),
    )
    .default([]),
});
export type SessionReading = z.infer<typeof SessionReadingSchema>;

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
  /**
   * Die Notizen des Spielleiters, aus denen die Session nachgetragen wurde – wörtlich, wie sie in
   * der Datei standen (ohne die Zeile der Grenze). `null` = nicht aus Notizen nachgetragen.
   */
  source: SessionSourceSchema.nullable().default(null),
  /** Vorlesetext und Rückblick für die Spieler, aus den Notizen herausgelöst (Schritt 3). */
  recap: z.string().default(''),
  /** Stand des Lesens der Notizen (Schritt 3); `null` = noch nicht gelesen. */
  reading: SessionReadingSchema.nullable().default(null),
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
  /** Bedingung in Worten: Der Schritt tritt nur ein, wenn sie gilt („Die Lieferung trifft ein“). */
  needs: z.string().default(''),
  /** Der Ablauf, an dem die Bedingung hängt: Bleibt er aus, ist die Uhr blockiert. */
  runId: id.nullable().default(null),
  /** Woran die Gruppe merkt, dass der Schritt eingetreten ist – in Worten des Spielleiters. */
  sign: z.string().default(''),
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
  /**
   * Blockiert: Die Bedingung des nächsten Schrittes ist weggefallen. Der Grund in Worten; leer =
   * nicht blockiert. Eine blockierte Uhr steht (`pausedAt`) und plant nie von selbst um – wie
   * es weitergeht, entscheidet der Spielleiter.
   */
  blocked: z.string().default(''),
  note: z.string().default(''),
});
export type Clock = z.infer<typeof ClockSchema>;

// ── Geschichten und Fäden ──────────────────────────────────────────────────

/** Ein Hinweis an einem Faden: wo man ihn findet, wer davon weiß, ob die Gruppe ihn hat. */
export const ThreadHintSchema = z.object({
  id,
  text: z.string(),
  placeId: id.nullable().default(null),
  sourceId: id.nullable().default(null),
  found: z.boolean().default(false),
  /**
   * Der Faden, zu dem dieser Hinweis führt – findet die Gruppe ihn, geht die Spur dort weiter
   * (`domain/threadWeb.ts`). Leer = er führt nirgendwohin.
   */
  leadsTo: id.nullable().optional(),
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
  /** Ein loser Faden steht am Spieltisch unter „Im Spiel“ (`domain/play.ts`). */
  inPlay: z.boolean().default(false),
  /**
   * Ein loser Faden liegt als Karte auf dem Brett – der Spielleiter hat ihn hingelegt. Sonst
   * steht er nur in der Liste „Lose Fäden“ (`threadOnBoard` in `domain/story.ts`).
   */
  onBoard: z.boolean().default(false),
  hints: z.array(ThreadHintSchema).default([]),
  /** Der Artikel, aus dem er stammt. */
  articleId: id.nullable().default(null),
  /** Die nachgetragenen Sessions, in deren Notizen er steht (`threadOrigin`). */
  sessionIds: z.array(id).default([]),
  /**
   * Fäden, mit denen dieser verbunden ist – das Netz der Fäden, quer über Geschichten. Eine
   * Verbindung gilt in beide Richtungen und steht nur an einem der beiden; gelesen wird immer
   * über `tiesOf` (`domain/threadWeb.ts`). `word` sagt, was sie verbindet – frei, darf leer sein.
   */
  ties: z.array(z.object({ id, word: z.string().default('') })).default([]),
  /** Artikel des Wikis, die zu diesem Faden gehören (auch solche ohne Eintrag der Welt). */
  articleIds: z.array(id).default([]),
  /**
   * Das Stück Geschichte in den eigenen Worten des Spielleiters – frei, so lang er will; auf dem
   * Fadenbrett steht es auf der Karte unter der Überschrift (`title`).
   */
  text: z.string().default(''),
  /** Namen im Text, die nicht gemeint sind (wie bei Geschichten `notMeant`). */
  notMeant: z.array(z.string()).default([]),
});
export type Thread = z.infer<typeof ThreadSchema>;

export const ENTRY_STANDINGS = ['any', 'good', 'bad'] as const;
export type EntryStanding = (typeof ENTRY_STANDINGS)[number];

/** Ein Einstieg: wo und wie die Gruppe auf eine Geschichte stoßen kann. */
export const StoryEntrySchema = z.object({
  id,
  text: z.string(),
  placeId: id.nullable().default(null),
  /**
   * Wann der Einstieg passt: immer – oder nur bei gutem bzw. schlechtem Ruf beim Antreiber der
   * Geschichte (`entryFit` in `domain/story.ts`).
   */
  standing: z.enum(ENTRY_STANDINGS).default('any'),
});
export type StoryEntry = z.infer<typeof StoryEntrySchema>;

/**
 * Ein Eintrag im Beute-Buch (`domain/loot.ts`): etwas, das die Gruppe bekommt – bereitgelegt oder
 * schon ausgegeben. Wayfarer führt kein Inventar; es merkt sich nur, was hinausging.
 */
export const LootSchema = z.object({
  ...base,
  /** Was es ist, in Worten. */
  text: z.string().default(''),
  /** Gold in Goldmünzen; 0 = keins. */
  gold: z.number().nonnegative().default(0),
  /** Ein Gegenstand der Welt, wenn es einer ist (etwa ein magisches Einzelstück). */
  itemId: id.nullable().default(null),
  /** Der Gefährte, der es bekommt; null = die Gruppe. */
  toId: id.nullable().default(null),
  /** Woher es stammt: „aus dem Hort des Aalwächters“. */
  source: z.string().default(''),
  /** Die Geschichte, zu der es gehört. */
  storyId: id.nullable().default(null),
  /** Ausgegeben – steht im Beute-Buch. Sonst liegt es bereit. */
  given: z.boolean().default(false),
  /** Wann, an welchem Abend und wo es ausgegeben wurde. */
  at: worldTime.nullable().default(null),
  sessionId: id.nullable().default(null),
  placeId: id.nullable().default(null),
  /** Die Zeile der Chronik zu dieser Ausgabe. */
  chronicleId: id.nullable().default(null),
  /** Wer den Gegenstand der Welt vor der Ausgabe hatte – dorthin kehrt er beim Zurücknehmen zurück. */
  holderBefore: id.nullable().default(null),
});
export type Loot = z.infer<typeof LootSchema>;

/** Eine mögliche Szene eines Abends – ein paar Sätze, bereit, verworfen zu werden. */
export const PrepSceneSchema = z.object({
  id,
  text: z.string(),
  /** Gespielt. */
  done: z.boolean().default(false),
  /** Wo die Szene spielen kann – am Spieltisch erscheint sie, sobald die Gruppe dort ist. */
  placeId: id.nullable().default(null),
  /** Die Geschichte, zu der sie gehört – wenn sie zu einer gehört. */
  storyId: id.nullable().default(null),
  /** Die vorbereitete Begegnung dazu, wenn es eine gibt. */
  encounterId: id.nullable().default(null),
  /**
   * Die Szene einer Geschichte, die hier auf den Abend gelegt wurde: Abgehakt wird beides
   * zusammen (`resolveContent` in `domain/prep.ts`). null = nur auf diesem Blatt geschrieben.
   */
  from: z.object({ storyId: id, sceneId: id }).nullable().default(null),
  /** Von wie vielen früheren Abenden sie übrig geblieben ist; 0 = hier geschrieben. */
  carried: z.number().int().nonnegative().default(0),
});
export type PrepScene = z.infer<typeof PrepSceneSchema>;

/**
 * Ein Geheimnis oder Hinweis für einen Abend: etwas, das die Gruppe erfahren könnte – noch an
 * keinem Ort und keiner Person festgemacht. Wo sie es findet, entscheidet sich am Tisch.
 */
export const PrepSecretSchema = z.object({
  id,
  text: z.string(),
  /** Die Geschichte, zu der es gehört – wenn es zu einer gehört. */
  storyId: id.nullable().default(null),
  /** Die Gruppe hat es erfahren. */
  revealed: z.boolean().default(false),
  revealedAt: worldTime.nullable().default(null),
  /**
   * Der Hinweis einer Frage, der hier auf den Abend gelegt wurde: „Aufgedeckt“ heißt „gefunden“
   * und umgekehrt (`resolveContent` in `domain/prep.ts`). null = nur auf diesem Blatt geschrieben.
   */
  hint: z.object({ threadId: id, hintId: id }).nullable().default(null),
  /** Von wie vielen früheren Abenden es übrig geblieben ist; 0 = hier geschrieben. */
  carried: z.number().int().nonnegative().default(0),
});
export type PrepSecret = z.infer<typeof PrepSecretSchema>;

/**
 * Das Blatt eines Abends (`domain/prep.ts`): was der Spielleiter für ihn bereitlegt. Ohne
 * Session gilt es dem kommenden Abend; beginnt eine, gehört es zu ihr.
 */
export const PrepSchema = z.object({
  ...base,
  sessionId: id.nullable().default(null),
  /** Der starke Einstieg: Etwas passiert. */
  start: z.string().default(''),
  scenes: z.array(PrepSceneSchema).default([]),
  secrets: z.array(PrepSecretSchema).default([]),
  /** Begegnungen, die bereitliegen. */
  encounterIds: z.array(id).default([]),
  /** Beute, die der Abend bringen kann. */
  treasure: z.string().default(''),
  /** Was die Gruppe vorhat – in den Worten des Spielleiters (oder aus der Chronik übernommen). */
  plan: z.string().default(''),
  /** Der Einstieg ist gespielt – am Spieltisch abgehakt. */
  startDone: z.boolean().default(false),
  /** Orte, die der Abend brauchen kann – Verweise, kein Abschreiben. */
  placeIds: z.array(id).default([]),
  /** Personen, die der Abend brauchen kann. */
  personIds: z.array(id).default([]),
  /** Fächer, die der Spielleiter für diesen Abend abgewählt hat („heute nicht nötig“). */
  skipped: z.array(z.string()).default([]),
  /**
   * Was vom letzten Abend herübergekommen und noch nicht angesehen ist: `scene:<id>`,
   * `secret:<id>`, `encounter:<id>`, `start`, `treasure` (`leftoverLines` in `domain/prep.ts`).
   */
  pending: z.array(z.string()).default([]),
  /** Die Blätter früherer Abende, deren Übriges dieses Blatt schon übernommen hat. */
  carriedFrom: z.array(id).default([]),
  /** Wie oft die „Namen für den Notfall“ neu gewürfelt wurden – der Ausgangswert bleibt stabil. */
  namesRound: z.number().int().nonnegative().default(0),
  /** Namen aus dem Text des Blatts, die der Spielleiter weggeklickt hat („nicht gemeint“). */
  notMeant: z.array(z.string()).default([]),
});
export type Prep = z.infer<typeof PrepSchema>;

export const SCENE_ODDS = ['sure', 'maybe', 'unlikely'] as const;
export type SceneOdds = (typeof SCENE_ODDS)[number];

/**
 * Eine Szene, die der Spielleiter für eine Geschichte bereithält – mit oder ohne vorbereitete
 * Begegnung. Sie bringt die Gruppe voran, hält sie auf oder verrät etwas.
 */
export const StorySceneSchema = z.object({
  id,
  text: z.string(),
  /** Die vorbereitete Begegnung dazu, wenn es eine gibt. */
  encounterId: id.nullable().default(null),
  /** Kommt sicher, vielleicht oder eher nicht. */
  odds: z.enum(SCENE_ODDS).default('maybe'),
  /** Wo die Szene spielen kann – am Spieltisch erscheint sie, sobald die Gruppe dort ist. */
  placeId: id.nullable().default(null),
  /** Gespielt: abgehakt auf dem Blatt oder am Spieltisch. */
  done: z.boolean().default(false),
});
export type StoryScene = z.infer<typeof StorySceneSchema>;

/** Was ein Beteiligter in einer Geschichte ist und was er dort will – beides in freien Worten. */
export const StoryRoleSchema = z.object({
  /** Seine Rolle in dieser Geschichte: Handlanger, Zeuge, Schauplatz … – ein freies Wort. */
  role: z.string().default(''),
  /** Was er hier will – ein Satz. */
  wants: z.string().default(''),
});
export type StoryRole = z.infer<typeof StoryRoleSchema>;

/** Ein Gefährte, den eine Geschichte persönlich betrifft – und warum. */
export const StoryHeroSchema = z.object({
  id,
  characterId: id,
  /** Sein eigener Grund, sich einzumischen. */
  why: z.string().default(''),
});
export type StoryHero = z.infer<typeof StoryHeroSchema>;

/**
 * Eine Geschichte ist ein Vorhaben, kein Plot: Jemand treibt sie an, eine Uhr sagt, was geschieht,
 * wenn niemand eingreift. Geschrieben vom Spielleiter; Wayfarer zeigt, wie nah die Gruppe dran
 * ist und wo Geschichten sich berühren.
 */
export const StorySchema = z.object({
  ...base,
  title: z.string(),
  /** Was der Antreiber will – in einem Satz, aus seiner Sicht. */
  summary: z.string().default(''),
  /** Wer sie antreibt: eine Person, Fraktion, Familie – oder was immer der Spielleiter wählt. */
  ownerId: id.nullable().default(null),
  /** Was dem Antreiber noch fehlt, bevor er am Ziel ist – jede Hürde ist ein Schritt der Uhr. */
  needs: z.string().default(''),
  /** Was auf dem Spiel steht – offene Fragen, deren Antwort das Spiel gibt. */
  stakes: z.string().default(''),
  /** Was passiert, wenn niemand eingreift. */
  clockId: id.nullable().default(null),
  /** Gefährten, die sie persönlich betrifft. */
  heroes: z.array(StoryHeroSchema).default([]),
  /** Szenen und Begegnungen, die bereitliegen. */
  scenes: z.array(StorySceneSchema).default([]),
  /** Wie es enden kann: Höhepunkt und Folgen – ohne den Weg dorthin festzulegen. */
  ending: z.string().default(''),
  /** Was die Gruppe davon hat. */
  reward: z.string().default(''),
  /** Die Beteiligten: Einträge jeder Art, die dazugehören. */
  refs: z.array(id).default([]),
  /**
   * Rolle und Absicht der Beteiligten in dieser Geschichte, je Eintrag (`castOf` in
   * `domain/storySheet.ts`). Wer hier fehlt, gehört trotzdem dazu – `refs` bleibt die Liste.
   */
  roles: z.record(z.string(), StoryRoleSchema).default({}),
  /** Die große Geschichte, zu der diese gehört; null = sie steht für sich. */
  parentId: id.nullable().default(null),
  /** Ratschläge, die der Spielleiter abgewählt hat („brauche ich nicht“) – Schlüssel aus `storyAdvice`. */
  adviceOff: z.array(z.string()).default([]),
  entries: z.array(StoryEntrySchema).default([]),
  /** Die Gruppe weiß von dieser Geschichte. */
  known: z.boolean().default(false),
  /** Zu Ende erzählt. */
  closed: z.boolean().default(false),
  /** Steht am Spieltisch unter „Im Spiel“ – der Spielleiter nimmt sie herein und heraus. */
  inPlay: z.boolean().default(false),
  /** Auf dem Fadenbrett aufgeklappt: Ihre Fäden hängen als eigene Knoten an ihr. */
  unfolded: z.boolean().default(false),
  /** Auf dem Fadenbrett eingeklappt: Ihre Teilgeschichten liegen nicht dort, nur ihre Zahl. */
  partsFolded: z.boolean().default(false),
  /** Artikel des Wikis, die zu dieser Geschichte gehören (auch solche ohne Eintrag der Welt). */
  articleIds: z.array(id).default([]),
  /**
   * Geschichten, mit denen der Spielleiter diese von Hand verbunden hat (Fadenbrett) – in beide
   * Richtungen, steht nur an einer; `word` sagt, was sie verbindet. Daneben bleibt, was Wayfarer
   * an Berührungen selbst ableitet (`touches`). Gelesen über `storyTiesOf`.
   */
  ties: z.array(z.object({ id, word: z.string().default('') })).default([]),
  /** Merkzettel für den Tisch: woran der Spielleiter bei dieser Geschichte denken will. */
  memo: z.string().default(''),
  /**
   * Die Geschichte in den eigenen Worten des Spielleiters – frei, so lang er will, ohne Fächer.
   * Alles andere auf dem Blatt ist freiwillig dazu.
   */
  text: z.string().default(''),
  /**
   * Namen aus dem Text des Blatts, die der Spielleiter weggeklickt hat („nicht gemeint“): die
   * Kennung eines Eintrags oder ein unbekannter Name (`writtenNames` in `domain/written.ts`).
   */
  notMeant: z.array(z.string()).default([]),
});
export type Story = z.infer<typeof StorySchema>;

// ── Bestiarium ─────────────────────────────────────────────────────────────

export const CREATURE_SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;
export type CreatureSize = (typeof CREATURE_SIZES)[number];
export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];
export const FEATURE_SECTIONS = ['trait', 'action', 'bonus', 'reaction', 'legendary'] as const;
export type FeatureSection = (typeof FEATURE_SECTIONS)[number];

const abilityScores = z.object({
  str: z.number().int().min(1).max(30),
  dex: z.number().int().min(1).max(30),
  con: z.number().int().min(1).max(30),
  int: z.number().int().min(1).max(30),
  wis: z.number().int().min(1).max(30),
  cha: z.number().int().min(1).max(30),
});
const feet = z.number().int().nonnegative();

/** Ein Angriff: Wayfarer rechnet Bonus und Schaden aus Attribut, Übungsbonus und Würfeln. */
export const CreatureAttackSchema = z.object({
  ranged: z.boolean().default(false),
  ability: z.enum(ABILITY_KEYS).default('str'),
  /** Fester Angriffsbonus – nur, wenn er nicht aus Attribut und Übungsbonus folgt. */
  bonus: z.number().int().nullable().default(null),
  /** „5 Fuß“, „80/320 Fuß“ */
  reach: z.string().default(''),
  /** Schadenswürfel, etwa „1W6“ oder „2W8“. */
  dice: z.string().default(''),
  /** Der Modifikator des Attributs zählt zum Schaden. */
  addMod: z.boolean().default(true),
  damageType: z.string().default(''),
});
export type CreatureAttack = z.infer<typeof CreatureAttackSchema>;

/** Ein Merkmal, eine Aktion, Bonusaktion, Reaktion oder legendäre Aktion. */
export const CreatureFeatureSchema = z.object({
  id,
  section: z.enum(FEATURE_SECTIONS).default('trait'),
  name: z.string(),
  text: z.string().default(''),
  attack: CreatureAttackSchema.nullable().default(null),
  /** Rettungswurf gegen diese Fähigkeit: SG = 8 + Übungsbonus + Modifikator dieses Attributs. */
  saveAbility: z.enum(ABILITY_KEYS).nullable().default(null),
  /** Fester SG – nur, wenn er nicht aus dem Attribut folgt. */
  saveDc: z.number().int().nullable().default(null),
  /** Wie oft: „Aufladung 5–6“, „3/Tag“, „kostet 2 Aktionen“ – leer = ohne Grenze. */
  uses: z.string().default(''),
});
export type CreatureFeature = z.infer<typeof CreatureFeatureSchema>;

/**
 * Die Werte eines Statblocks nach den Regeln von 2024. Jedes Feld darf fehlen: Eine Variante hält
 * nur fest, was von ihrer Vorlage abweicht (`resolveCreature` in `domain/creature.ts`).
 * Längen stehen in Fuß.
 */
export const CreatureBlockSchema = z
  .object({
    size: z.enum(CREATURE_SIZES),
    /** „Humanoider“, „Untoter“ … */
    type: z.string(),
    /** Zusatz in Klammern, etwa „Goblinoide“. */
    tags: z.string(),
    alignment: z.string(),
    ac: z.number().int().min(0).max(40),
    acNote: z.string(),
    /** Anzahl der Trefferwürfel; ihre Größe folgt aus der Größe des Wesens. */
    hitDice: z.number().int().min(1).max(100),
    /** Feste Trefferpunkte, wenn sie nicht aus Trefferwürfeln und Konstitution folgen. */
    hp: z.number().int().positive().nullable(),
    /** Übung in Initiative: 0 keine, 1 geübt, 2 Expertise. */
    initiative: z.number().int().min(0).max(2),
    speed: z.object({ walk: feet, fly: feet, swim: feet, climb: feet, burrow: feet }),
    hover: z.boolean(),
    abilities: abilityScores,
    /** Attribute mit Übung im Rettungswurf. */
    saves: z.array(z.enum(ABILITY_KEYS)),
    /** Fertigkeit → 1 geübt, 2 Expertise. */
    skills: z.record(z.string(), z.number().int().min(1).max(2)),
    vulnerable: z.string(),
    resistant: z.string(),
    immune: z.string(),
    conditionImmune: z.string(),
    senses: z.object({
      darkvision: feet,
      blindsight: feet,
      tremorsense: feet,
      truesight: feet,
    }),
    languages: z.string(),
    /** Herausforderungsgrad: „0“, „1/8“, „1/4“, „1/2“, „1“ … „30“. */
    cr: z.string(),
    /** Wie viele Angriffe das Wesen je Runde macht – für die Einschätzung des HG. */
    attacksPerRound: z.number().int().min(1).max(10),
    /** Legendäre Aktionen je Runde; 0 = ohne Angabe. */
    legendaryUses: z.number().int().min(0).max(10),
    gear: z.string(),
    /** Lebensräume, mit Komma getrennt: „Wald, Hügel“. */
    habitat: z.string(),
    treasure: z.string(),
  })
  .partial();
export type CreatureBlock = z.infer<typeof CreatureBlockSchema>;

export const CREATURE_KINDS = ['template', 'variant', 'individual'] as const;
export type CreatureKind = (typeof CREATURE_KINDS)[number];

/**
 * Ein Eintrag des Bestiariums: eine Vorlage (der Statblock), eine Variante (erbt und hält nur
 * fest, was abweicht) oder ein Einzelner (ein bestimmtes Wesen mit Namen und eigenen
 * Trefferpunkten). Monster aus Büchern liegen nur im Kampagnenordner.
 */
export const CreatureSchema = z.object({
  ...base,
  name: z.string(),
  kind: z.enum(CREATURE_KINDS).default('template'),
  /** Wovon geerbt wird: bei einer Variante die Vorlage, bei einem Einzelnen Vorlage oder Variante. */
  parentId: id.nullable().default(null),
  block: CreatureBlockSchema.default({}),
  /** Eigene Fähigkeiten. Trägt eine den Namen einer geerbten, ersetzt sie diese. */
  features: z.array(CreatureFeatureSchema).default([]),
  /** Namen geerbter Fähigkeiten, die dieses Wesen nicht hat. */
  dropped: z.array(z.string()).default([]),
  /** Woher der Statblock stammt: „Eigenbau“, ein Buch mit Seite … */
  source: z.string().default(''),
  notes: z.string().default(''),
  /** Die Spezies der Weltdatenbank, zu der das Wesen gehört. */
  speciesId: id.nullable().default(null),
  /** Einzelner: aktuelle Trefferpunkte; null = unverletzt. */
  hpNow: z.number().int().nonnegative().nullable().default(null),
  /** Einzelner: wo er sich aufhält. */
  placeId: id.nullable().default(null),
  /**
   * Unterwegs (Wunsch 17. 11.: „Die Menge von Monstern könnte im Bestiarium angelegt sein“): was
   * Begegnungstabellen von diesem Wesen wissen – wie viele man trifft, woran man es vorher merkt,
   * wann es unterwegs ist. Leer = geerbt (`roamingOf`, `domain/roaming.ts`).
   */
  roaming: z
    .object({
      /** Wie viele man meist trifft: „2–5“, „3“. */
      appearing: z.string().default(''),
      /** Woran man es vorher merkt: Spuren, Losung, Geräusche. */
      signs: z.string().default(''),
      /** Wann es unterwegs ist; null = immer. */
      active: z.enum(['day', 'night']).nullable().default(null),
      /** Wie groß das Revier eines Baus ist, in km² – „Beleben“ setzt so viele Baue, wie Platz ist. */
      territoryKm2: z.number().positive().nullable().optional(),
    })
    .default({ appearing: '', signs: '', active: null }),
});
export type Creature = z.infer<typeof CreatureSchema>;

/** Ein Exemplar in einer Begegnung: ein Wesen des Bestiariums mit eigenen Trefferpunkten. */
export const EncounterFoeSchema = z.object({
  id,
  creatureId: id,
  /** „Grubenschleicher 2“ */
  name: z.string(),
  /** Aktuelle Trefferpunkte; null = unverletzt. */
  hp: z.number().int().nonnegative().nullable().default(null),
  note: z.string().default(''),
  /** Der Bestand, aus dem das Exemplar stammt (`domain/stock.ts`). */
  stockId: id.nullable().default(null),
  /** Sein Verlust ist im Bestand schon verbucht. */
  booked: z.boolean().default(false),
});
export type EncounterFoe = z.infer<typeof EncounterFoeSchema>;

/**
 * Eine Begegnung: Wesen des Bestiariums, zusammengestellt vom Spielleiter. Wie schwer sie für die
 * Gruppe ist, rechnet Wayfarer aus dem EP-Budget (`domain/creature.ts`).
 */
export const EncounterSchema = z.object({
  ...base,
  name: z.string(),
  placeId: id.nullable().default(null),
  foes: z.array(EncounterFoeSchema).default([]),
  notes: z.string().default(''),
});
export type Encounter = z.infer<typeof EncounterSchema>;

/** Eine Gruppe von Bewohnern eines Bestands: wie viele es waren und wie viele fehlen. */
export const StockGroupSchema = z.object({
  id,
  creatureId: id,
  count: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative().default(0),
});
export type StockGroup = z.infer<typeof StockGroupSchema>;

/**
 * Ein Bestand: ein Bau, Hort oder Nest an einem Ort – mit Bewohnern aus dem Bestiarium, Vorräten,
 * Beute und Revier. Verluste im Kampf fehlen danach (`domain/stock.ts`).
 */
export const StockSchema = z.object({
  ...base,
  name: z.string(),
  placeId: id.nullable().default(null),
  /**
   * Wo der Bau auf einer Hexkarte liegt (von „Beleben“ gesetzt oder von Hand). Ohne Ort ist er nur
   * dort; „Als Ort anlegen“ macht ihn zu einem Ort der Welt. null = auf keiner Hexkarte.
   */
  at: z
    .object({
      areaId: id,
      q: z.number().int(),
      r: z.number().int(),
      level: z.number().int().nonnegative().default(0),
    })
    .nullable()
    .default(null),
  /** Von „Beleben“ gesetzt – nicht von Hand. Neu beleben nimmt nur solche weg, die keiner angefasst hat. */
  generated: z.boolean().default(false),
  groups: z.array(StockGroupSchema).default([]),
  stores: z.string().default(''),
  loot: z.string().default(''),
  range: z.string().default(''),
  notes: z.string().default(''),
});
export type Stock = z.infer<typeof StockSchema>;

/**
 * Ein regelmäßiger Ablauf: eine wiederkehrende Reise mit Strecke, Fahrplan, Träger und Betreiber
 * (`domain/runs.ts`). Geschrieben vom Spielleiter; Wayfarer lässt ihn laufen.
 */
export const RunSchema = z.object({
  ...base,
  name: z.string(),
  fromId: id,
  toId: id,
  /** Die erste Abfahrt; der Fahrplan zählt von hier. */
  start: worldTime,
  every: RepeatSchema,
  /** Der Träger in Worten: „Flusskahn“, „Karawane“. */
  carrier: z.string().default(''),
  /** Der Träger als Eintrag der Welt – fehlt er, fällt der Ablauf aus. */
  carrierId: id.nullable().default(null),
  /** Wer den Ablauf betreibt – meist eine Fraktion. Fehlt er, fällt der Ablauf aus. */
  operatorId: id.nullable().default(null),
  /** Ausgesetzt seit; null = läuft. */
  stoppedAt: worldTime.nullable().default(null),
  stopReason: z.string().default(''),
  /** Abfahrten, die ausgefallen sind – vom Spielleiter so entschieden. */
  missed: z.array(worldTime).default([]),
  /** Abfahrten, bei denen der Spielleiter entschieden hat: Sie fand trotzdem statt. */
  decided: z.array(worldTime).default([]),
  note: z.string().default(''),
});
export type Run = z.infer<typeof RunSchema>;

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
  /**
   * Das Gelände dieses Weges als Hexkarte („Gelände dazwischen“): Unterwegs wird der Weg dann Feld
   * für Feld gereist, und die Hexkarte zeigt, wo die Gruppe ist. null = keine.
   */
  areaId: id.nullable().default(null),
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
  /** Was unterwegs wartet – ein Hindernis, eine Szene, eine Probe. Nur für die Spielleitung. */
  onTheWay: z.string().default(''),
  /** Eine vorbereitete Begegnung, die auf diesem Weg wartet. */
  encounterId: id.nullable().default(null),
  mapId: id.nullable().default(null),
  /** Verlauf auf der Karte, von from nach to. */
  points: z.array(point).default([]),
});
export type TravelPath = z.infer<typeof PathSchema>;

/** Ein Punkt eines Wegenetzes: ein Ort der Welt und wo er auf dem Blatt liegt. */
export const NetPointSchema = z.object({ placeId: id, x: z.number(), y: z.number() });
export type NetPoint = z.infer<typeof NetPointSchema>;

/**
 * Ein Wegenetz: eine vorbereitete Strecke oder Gegend aus Punkten und den Wegen dazwischen
 * (`domain/net.ts`). Die Wege selbst liegen in `paths` – zum Netz gehört jeder, dessen beide
 * Orte Punkte des Netzes sind. Geschrieben vom Spielleiter, nie erzeugt.
 */
export const NetSchema = z.object({
  ...base,
  name: z.string(),
  /** Worum es bei dieser Strecke geht – nur für die Spielleitung. */
  note: z.string().default(''),
  /** Was für Wege hier neu entstehen: Gasse, Straße, Pfad, Sumpfpfad, Gang, Wasserweg (`WaySort`). */
  waySort: z.enum(['street', 'road', 'trail', 'swamp', 'underground', 'water']).default('trail'),
  points: z.array(NetPointSchema).default([]),
  /** Die Geschichte, für die das Netz vorbereitet ist (`netsOfStory`); null = es steht für sich. */
  storyId: id.nullable().default(null),
});
export type Net = z.infer<typeof NetSchema>;

export const PACES = ['slow', 'normal', 'fast'] as const;
export type Pace = (typeof PACES)[number];

export const JOURNEY_STATUS = ['planned', 'underway', 'arrived', 'aborted'] as const;
export type JourneyStatus = (typeof JOURNEY_STATUS)[number];

/**
 * Ein Abschnitt einer Reise (`domain/journey.ts`): ein Weg der Welt oder eine freie Strecke
 * zwischen zwei Orten. Dauer und Gelände werden beim Aufbruch festgehalten, damit die Reise
 * nicht unterwegs ihre Länge ändert.
 */
export const JourneyLegSchema = z.object({
  id,
  pathId: id.nullable().default(null),
  /** Gespeicherten Weg in Gegenrichtung (to → from) gehen. */
  reverse: z.boolean().default(false),
  fromId: id.nullable().default(null),
  toId: id.nullable().default(null),
  /** Dauer in Minuten, mit dem Gelände gerechnet. */
  minutes: z.number().int().nonnegative().default(0),
  distanceKm: z.number().nonnegative().nullable().default(null),
  /** Gelände der Gegend in den Worten des Spielleiters (`place.ground`); '' = keines eingetragen. */
  ground: z.string().default(''),
  /** Die Gegend ist schwer zu durchqueren: Die Strecke dauert doppelt so lange. */
  slow: z.boolean().default(false),
  /** Die Gegend, aus der Gelände und Tabellen stammen. */
  regionId: id.nullable().default(null),
  /** Die Hexkarte des Weges: Unterwegs geht es Feld für Feld, `hexes` mit Minuten ab Beginn. */
  areaId: id.nullable().default(null),
  hexes: z
    .array(
      z.object({
        q: z.number().int(),
        r: z.number().int(),
        /** Ebene der Hexkarte (0 = oberste); ein Schacht führt hinab oder hinauf. */
        level: z.number().int().nonnegative().default(0),
        at: z.number().int().nonnegative(),
      }),
    )
    .default([]),
  // Aus dem ersten Entwurf; ungenutzt.
  mapId: id.nullable().default(null),
  points: z.array(point).default([]),
  terrain: z.enum(TERRAINS).nullable().default(null),
});
export type JourneyLeg = z.infer<typeof JourneyLegSchema>;

export const JourneyLogSchema = z.object({
  at: worldTime,
  text: z.string(),
  /** Zugehöriger Chronikeintrag, falls einer geschrieben wurde. */
  chronicleId: id.nullable().default(null),
});

/** Warum die Reise angehalten hat (`domain/journey.ts`, `HALT_LABEL`). */
export const HALT_KINDS = [
  'place',
  'feature',
  'river',
  'passage',
  'sighted',
  'search',
  'navigate',
  'prepared',
  'encounter',
  'discovery',
  'event',
  'clock',
  'light',
  'rest',
  'hour',
  'arrived',
] as const;
export type HaltKind = (typeof HALT_KINDS)[number];

/**
 * Eine Reise (Station 2 auf dem Weg zu Version 1.0): Solange sie unterwegs ist (`underway`), zeigt
 * der Spieltisch sie statt eines Ortes. Gegangen wird „bis zur nächsten Entscheidung“
 * (`travelOn`); was unterwegs geschah, steht in der Chronik.
 */
export const JourneySchema = z.object({
  ...base,
  name: z.string().default(''),
  startId: id.nullable().default(null),
  /** Das Ziel der Reise. */
  toId: id.nullable().default(null),
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
  /** Wo die Reise gerade steht: Abschnitt und darin vergangene Minuten. */
  progress: z
    .object({
      leg: z.number().int().nonnegative(),
      minutes: z.number().int().nonnegative().default(0),
      km: z.number().nonnegative().default(0),
    })
    .prefault({ leg: 0, minutes: 0, km: 0 }),
  /** Reiseminuten seit der letzten Prüfung auf Begegnungen. */
  sinceCheck: z.number().int().nonnegative().default(0),
  /** Der Welttag, an dem zuletzt auf Orientierung geprüft wurde – einmal am Tag. */
  navDay: z.number().int().nullable().default(null),
  /** Verirrt: so viele Minuten Umweg kostet der nächste Abschnitt der Reise, ohne voranzukommen. */
  lostMinutes: z.number().int().nonnegative().default(0),
  /** Gereiste Stücke mitten auf einem Abschnitt – für den Gewaltmarsch (`domain/march.ts`). */
  steps: z.array(z.object({ at: worldTime, minutes: z.number().int().nonnegative() })).default([]),
  /** Vorräte beim Aufbruch in Tagen – nur ein Hinweis, abgezogen wird nichts. null = nicht gezählt. */
  supplies: z
    .object({
      food: z.number().nonnegative().nullable().default(null),
      water: z.number().nonnegative().nullable().default(null),
    })
    .prefault({}),
  /** Woran die Reise zuletzt angehalten hat; null = sie ist gerade nicht angehalten. */
  halt: z
    .object({
      kind: z.enum(HALT_KINDS),
      text: z.string().default(''),
      at: worldTime,
      /** Was gewürfelt wurde, in Worten: „W20 = 16 (ab 15) · W8 = 3“. */
      roll: z.string().default(''),
      /** Eine Begegnung aus der Tabelle, die sich öffnen lässt. */
      encounterId: id.nullable().default(null),
    })
    .nullable()
    .default(null),
  log: z.array(JourneyLogSchema).default([]),
  notes: z.string().default(''),
});
export type Journey = z.infer<typeof JourneySchema>;

/** Reittier, Fahrzeug (Kutsche, Wagen, Schlitten) oder Schiff (auch Boot, Floß, Kahn). */
export const MOUNT_KINDS = ['mount', 'vehicle', 'ship'] as const;
export type MountKind = (typeof MOUNT_KINDS)[number];

/** Bereit, erschöpft (braucht Rast) oder beschädigt (braucht Ausbesserung) – nur Hinweise. */
export const MOUNT_CONDITIONS = ['ready', 'tired', 'damaged'] as const;
export type MountCondition = (typeof MOUNT_CONDITIONS)[number];

/**
 * Ein Fortbewegungsmittel: Reittier, Fahrzeug oder Schiff mit seinen Reisedaten
 * (`domain/mounts.ts`). Sein Name und Artikel in der Welt sind optional über `entityId` – das
 * Schiff „Seewind“ als Gegenstand, das Pferd als Tier. Womit die Gruppe reist, steht in
 * `state.travelBy`.
 */
export const MountSchema = z.object({
  ...base,
  kind: z.enum(MOUNT_KINDS).default('mount'),
  name: z.string(),
  /** Bewegungsrate in Fuß (Kampf). */
  speed: z.number().int().nonnegative().nullable().default(null),
  /** Traglast in Pfund. */
  capacity: z.number().nonnegative().nullable().default(null),
  /** Wem es gehört: ein Gefährte, eine Person, eine Fraktion; null = die Gruppe. */
  ownerId: id.nullable().default(null),
  /** Der Eintrag der Welt dazu (Tier, Gegenstand), wenn es einen gibt. */
  entityId: id.nullable().default(null),
  /** Kampfwerte aus dem Bestiarium. */
  creatureId: id.nullable().default(null),
  /**
   * Reisetempo in Meilen – je Stunde (`paceUnit: 'hour'`) oder je Reisetag von acht Stunden
   * (`'day'`). null = so schnell wie die Gruppe zu Fuß (Regelwerk: Reittiere und Fuhrwerke
   * reisen im Tempo der Gruppe).
   */
  pace: z.number().positive().nullable().default(null),
  paceUnit: z.enum(['hour', 'day']).default('hour'),
  /** Fliegt: Gelände und Wasser halten es nicht auf (Greif, Luftschiff). */
  flies: z.boolean().default(false),
  /** Plätze für Mitreisende. */
  passengers: z.number().int().nonnegative().nullable().default(null),
  /** Ladung in Tonnen (Schiffe; Reittiere und Fahrzeuge tragen `capacity` Pfund). */
  cargo: z.number().nonnegative().nullable().default(null),
  /** Nötige Besatzung. */
  crew: z.number().int().nonnegative().nullable().default(null),
  /** Unterhalt in Gold je Tag (Futter, Stall, Heuer); null = keiner eingetragen. */
  upkeep: z.number().nonnegative().nullable().default(null),
  condition: z.enum(MOUNT_CONDITIONS).default('ready'),
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

/**
 * Wie ein Ausgang eines Feldes beschaffen ist (`domain/passages.ts`): ein gewöhnlicher Gang, eine
 * Engstelle oder Kletterei (doppelte Zeit), Wasser (schwimmen oder ein Boot), verborgen (erst
 * nutzbar, wenn die Gruppe ihn gefunden hat), ein Abbruch (nur in eine Richtung).
 */
export const PASSAGE_KINDS = ['open', 'narrow', 'climb', 'water', 'hidden', 'drop'] as const;
export type PassageKind = (typeof PASSAGE_KINDS)[number];

/**
 * Ein Ausgang: Seite 0–5 (wie `HEX_DIRECTIONS`), 6 = hinauf, 7 = hinab (dasselbe Feld eine Ebene
 * darüber oder darunter).
 */
export const ExitSchema = z.object({
  dir: z.number().int().min(0).max(7),
  kind: z.enum(PASSAGE_KINDS).default('open'),
  /** Ein verborgener Ausgang, den die Gruppe gefunden hat. */
  found: z.boolean().default(false),
});
export type Exit = z.infer<typeof ExitSchema>;

export const HexSchema = z.object({
  /** Axiale Koordinaten. */
  q: z.number().int(),
  r: z.number().int(),
  terrain: z.enum(TERRAINS).nullable().default(null),
  /**
   * Geländeart (`domain/hexKinds.ts`): wie das Feld aussieht und heißt – „Moor“, „Vulkan“. Für die
   * Regeln zählt `terrain`. null = das Grundgelände selbst.
   */
  kind: z.string().nullable().default(null),
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
  /**
   * Die Gegend der Welt, die hier gilt (ein Ort mit Gelände, Tempo und Tabellen,
   * `domain/journey.ts`) – vom Spielleiter auf die Felder gemalt. null = keine.
   */
  regionId: id.nullable().default(null),
  /** Die Landschaft, die auf dieses Feld gemalt ist (`landscape`); ihr Gelände gilt hier. */
  landscapeId: id.nullable().optional(),
  /** Straße oder Pfad durch dieses Feld: Reisen hier gehen im normalen Tempo, auch im Sumpf. */
  road: z.enum(ROAD_KINDS).default('none'),
  /** Von Hand geändert: Neu würfeln behält dieses Feld, wie es ist. */
  manual: z.boolean().default(false),
  /**
   * Ausgänge des Feldes. null = alle sechs Seiten offen (Oberwelt, ältere Karten). Eine Liste =
   * nur diese; eine leere Liste ist Fels, den niemand betritt.
   */
  exits: z.array(ExitSchema).nullable().default(null),
  /** Ebene der Karte: 0 = oberste, 1 darunter … */
  level: z.number().int().nonnegative().default(0),
  /**
   * Woran die Gruppe dieses Feld vom Nachbarfeld aus bemerkt („Schwefelgeruch“) – vom
   * Spielleiter; ohne Eintrag sagt es die Besonderheit (`domain/senses.ts`).
   */
  sign: z.string().default(''),
  /** Gänge, Fels oder Schacht von Hand gesetzt: Neu würfeln behält die Ausgänge dieses Feldes. */
  dug: z.boolean().default(false),
  /**
   * Von fern zu sehen („Eine Rauchsäule“): Die Gruppe sieht es aus mehreren Feldern Entfernung
   * (`domain/afar.ts`). Leer = nichts.
   */
  afar: z.string().default(''),
  /** Die Gruppe hat es von fern gesehen (die Reise hält dafür nur einmal). */
  sighted: z.boolean().default(false),
  /** Verborgen: findet die Gruppe nur, wenn sie das Feld durchsucht. Leer = nichts. */
  hidden: z.string().default(''),
  /** Die Gruppe hat das Feld durchsucht. */
  searched: z.boolean().default(false),
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
  /**
   * Hineingezoomt: Diese Karte zeigt ein Feld einer gröberen Karte im Kleinen (`domain/zoom.ts`).
   * null = eine Karte für sich.
   */
  parent: z
    .object({
      areaId: id,
      q: z.number().int(),
      r: z.number().int(),
      level: z.number().int().nonnegative().default(0),
    })
    .nullable()
    .default(null),
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
      trail: z
        .array(
          z.object({
            q: z.number().int(),
            r: z.number().int(),
            level: z.number().int().nonnegative().default(0),
          }),
        )
        .default([]),
      /** Die Ebene, auf der die Gruppe steht. */
      level: z.number().int().nonnegative().default(0),
      /**
       * Die Schritte der letzten 24 Stunden: Ende und Dauer – für den Gewaltmarsch, der seit der
       * letzten Langen Rast zählt (`domain/march.ts`), nicht ab Mitternacht.
       */
      legs: z
        .array(z.object({ at: worldTime, minutes: z.number().int().nonnegative() }))
        .default([]),
    })
    .nullable()
    .default(null),
});
export type Area = z.infer<typeof AreaSchema>;

export const TABLE_KINDS = ['encounter', 'discovery', 'generator'] as const;
export type TableKind = (typeof TABLE_KINDS)[number];

/** Begegnungs- oder Entdeckungstabelle, kampagnenweit wiederverwendbar. */
export const RollTableSchema = z.object({
  ...base,
  name: z.string(),
  kind: z.enum(TABLE_KINDS).default('encounter'),
  /** Region, für die sie gedacht ist (Ort), oder null. */
  placeId: id.nullable().default(null),
  /**
   * Nur Würfeltabellen der Erzeuger (`kind: 'generator'`, `features/erkundung/tables.ts`): wo ein
   * Erzeuger sie nimmt („site“, „hidden“, „feature:forest“ …); null = nur über `[Name]` erreichbar.
   */
  slot: z.string().nullable().default(null),
  /** Würfel für die Tabelle, z. B. 8 für W8. */
  die: z.number().int().min(2).default(6),
  /** Schwierigkeit der Begegnungsprüfung; null = keine Prüfung, immer würfeln. */
  dc: z.number().int().min(1).max(30).nullable().default(null),
  entries: z
    .array(
      z.object({
        id,
        /** Bereich auf dem Würfel, z. B. 1–2 – die Breite ist die Häufigkeit. */
        min: z.number().int().min(1),
        max: z.number().int().min(1),
        text: z.string().default(''),
        refs: z.array(id).default([]),
        /** Ein Wesen des Bestiariums: Anzahl, Spuren und Bau kommen von dort (`domain/roaming.ts`). */
        creatureId: id.nullable().default(null),
        /** Nur tags oder nur nachts; null = immer bzw. wie das Wesen im Bestiarium. */
        when: z.enum(['day', 'night']).nullable().default(null),
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

// ── Fortschrittsleisten ─────────────────────────────────────────────────────

/** stages = benannte Stufen; count = eine Zahl bis zu einem Ziel; steps = Abschnitte wie eine Uhr. */
export const TRACK_KINDS = ['stages', 'count', 'steps'] as const;
export type TrackKind = (typeof TRACK_KINDS)[number];

/** Was ein Gefährte in freier Zeit tun kann (`domain/downtime.ts`). */
export const DOWNTIME_ACTIVITIES = [
  'craft',
  'train',
  'research',
  'work',
  'recover',
  'custom',
] as const;
export type DowntimeActivity = (typeof DOWNTIME_ACTIVITIES)[number];

/**
 * Eine Fortschrittsleiste (`domain/track.ts`): ein Ausbildungsweg, Ruf, eine Schuld, eine Studie, eine
 * Reparatur. Sie gehört einem Eintrag der Welt oder der Gruppe; jeder Schritt steht in der Chronik.
 */
export const TrackSchema = z.object({
  ...base,
  name: z.string(),
  /** Wem sie gehört: Gefährte, Person, Fraktion, Ort … oder die Gruppe (`PARTY_ID`). */
  ownerId: z.string().nullable().default(null),
  kind: z.enum(TRACK_KINDS).default('steps'),
  /** stages: die Namen der Stufen, von der ersten bis zur letzten. */
  stages: z.array(z.string()).default([]),
  /** count: Ziel und Schrittweite, dazu ein Wort für die Einheit („Gold“). */
  target: z.number().nonnegative().default(0),
  step: z.number().positive().default(1),
  unit: z.string().default(''),
  /** steps: Zahl der Abschnitte. */
  segments: z.number().int().min(1).max(24).default(4),
  /** Erreicht: Stufe (Index), Zahl oder gefüllte Abschnitte. */
  value: z.number().nonnegative().default(0),
  note: z.string().default(''),
  /** Die Geschichte, zu der sie gehört. */
  storyId: id.nullable().default(null),
  /** Abgeschlossen – bleibt sichtbar, steht aber unten. */
  done: z.boolean().default(false),
  /**
   * Ein Vorhaben der freien Zeit (`domain/downtime.ts`): was getan wird und – beim Herstellen –
   * welcher Gegenstand dabei entsteht. Die Leiste zählt dann Arbeitstage; null = keins.
   */
  downtime: z
    .object({
      activity: z.enum(DOWNTIME_ACTIVITIES).default('custom'),
      itemId: id.nullable().default(null),
    })
    .nullable()
    .default(null),
});
export type Track = z.infer<typeof TrackSchema>;

// ── Bastion (Regeln von 2024) ──────────────────────────────────────────────

/** Befehle einer besonderen Einrichtung. Wayfarer bringt nur die Wörter mit, keine Buchinhalte. */
export const BASTION_ORDERS = [
  'craft',
  'empower',
  'harvest',
  'maintain',
  'recruit',
  'research',
  'trade',
] as const;
export type BastionOrder = (typeof BASTION_ORDERS)[number];
export const FACILITY_STATES = ['ready', 'damaged', 'repairing'] as const;
export type FacilityState = (typeof FACILITY_STATES)[number];

export const BastionFacilitySchema = z.object({
  id,
  name: z.string(),
  /** Der Raum der Bastion, in dem sie liegt (`place.room`). */
  roomId: id.nullable().default(null),
  /** basic = einfache Einrichtung (ohne Befehle), special = besondere. */
  kind: z.enum(['basic', 'special']).default('special'),
  /** Der Gefährte, dem sie gehört; null = der Gruppe. */
  ownerId: id.nullable().default(null),
  orders: z.array(z.enum(BASTION_ORDERS)).default([]),
  /** Gefolgsleute in Worten: „Hagen, Ute“. */
  hirelings: z.string().default(''),
  state: z.enum(FACILITY_STATES).default('ready'),
  /** Die Fortschrittsleiste der Reparatur. */
  trackId: id.nullable().default(null),
  /** Der laufende Befehl: was daraus wird und wie viele Züge er noch braucht. */
  order: z
    .object({
      name: z.enum(BASTION_ORDERS),
      text: z.string().default(''),
      turnsLeft: z.number().int().nonnegative().default(0),
    })
    .nullable()
    .default(null),
  notes: z.string().default(''),
});
export type BastionFacility = z.infer<typeof BastionFacilitySchema>;

/**
 * Eine Bastion (`domain/bastion.ts`): ein Ort mit Einrichtungen. Alle `turnDays` Tage ist ein
 * Bastionszug fällig – Wayfarer schlägt ihn vor, ausgeführt wird er nur vom Spielleiter.
 */
export const BastionSchema = z.object({
  ...base,
  name: z.string(),
  placeId: id.nullable().default(null),
  /** Wann der letzte Zug war; daraus folgt der nächste. */
  lastTurnAt: worldTime.nullable().default(null),
  turnDays: z.number().int().min(1).default(7),
  defenders: z.number().int().nonnegative().default(0),
  /** Die Ereignistabelle des Spielleiters: je Zeile „1–50: Alles ruhig“. */
  events: z.string().default(''),
  eventDie: z.number().int().min(2).default(100),
  facilities: z.array(BastionFacilitySchema).default([]),
});
export type Bastion = z.infer<typeof BastionSchema>;

// ── Handouts ───────────────────────────────────────────────────────────────

/** letter = Brief, note = Notiz/Zettel, decree = Erlass/Aushang, card = Hinweiskarte. */
export const HANDOUT_KINDS = ['letter', 'note', 'decree', 'card'] as const;
export type HandoutKind = (typeof HANDOUT_KINDS)[number];

/**
 * Ein Handout zum Ausdrucken (`features/handouts`): ein Brief, eine Notiz, ein Erlass oder eine
 * Hinweiskarte – geschrieben vom Spielleiter, gedruckt auf Pergament. „Übergeben“ hält in der
 * Chronik fest, wann die Gruppe es bekam.
 */
export const HandoutSchema = z.object({
  ...base,
  title: z.string().default(''),
  kind: z.enum(HANDOUT_KINDS).default('letter'),
  /** Der Wortlaut; Leerzeilen trennen Absätze. */
  text: z.string().default(''),
  /** Unterschrift oder Absender, unten rechts. */
  signature: z.string().default(''),
  /** Ein Siegel mit diesem Zeichen (ein, zwei Buchstaben); leer = kein Siegel. */
  seal: z.string().default(''),
  storyId: id.nullable().default(null),
  /** Woher der Wortlaut stammt: ein Schriftstück der Chronik oder ein Artikel. */
  sourceId: z.string().nullable().default(null),
  /** Übergeben an die Gruppe – mit der Zeile in der Chronik. */
  givenAt: worldTime.nullable().default(null),
  chronicleId: id.nullable().default(null),
});
export type Handout = z.infer<typeof HandoutSchema>;

// ── Vermutungen ────────────────────────────────────────────────────────────

/** Ob eine Vermutung der Spieler stimmt – das weiß nur die Spielleitung. */
export const GUESS_TRUTHS = ['open', 'true', 'half', 'false'] as const;
export type GuessTruth = (typeof GUESS_TRUTHS)[number];

/**
 * Eine Vermutung der Spieler (`domain/playerBook.ts`): was die Gruppe glaubt, mit den Dingen, um
 * die es geht. Ob sie stimmt, steht nur in der Fassung für die Spielleitung – für die Spieler
 * bleibt sie offen.
 */
export const GuessSchema = z.object({
  ...base,
  /** Die Vermutung in den Worten der Spieler. */
  text: z.string().default(''),
  /** Die Einträge der Welt (oder Geschichten), um die es geht. */
  refs: z.array(id).default([]),
  /** Wann die Gruppe das vermutet hat. */
  at: worldTime.default(0),
  sessionId: id.nullable().default(null),
  truth: z.enum(GUESS_TRUTHS).default('open'),
  /** Bemerkung der Spielleitung – nie für die Spieler. */
  note: z.string().default(''),
});
export type Guess = z.infer<typeof GuessSchema>;

// ── Läden ──────────────────────────────────────────────────────────────────

/** Eine Zeile im Bestand eines Ladens. */
export const ShopStockSchema = z.object({
  id,
  /** Ein Eintrag der Welt – jeder Art (meist Gegenstand, Tier, Pflanze, Gestein); null = keiner. */
  entityId: id.nullable().default(null),
  /** Der Name in Worten; bei einem Eintrag sein Name zur Zeit der Wahl (bleibt, wenn er gelöscht wird). */
  text: z.string().default(''),
  /** Eigener Preis in diesem Laden; null = Listenpreis des Eintrags mal Preisfaktor. */
  price: z.number().nonnegative().nullable().default(null),
  /** Wie viele da sind; null = so viele man will. */
  qty: z.number().int().nonnegative().nullable().default(null),
  /**
   * Aus dem Nachschlagewerk übernommen (`domain/srd`, etwa „srd-longsword“): Ohne eigenen Preis
   * gilt dessen Preis mal Preisfaktor. null = nicht aus dem Regelwerk.
   */
  srdId: z.string().nullable().default(null),
  /** Ein Wesen des Bestiariums (ein abgerichtetes Tier, ein Reittier …); null = keins. */
  creatureId: id.nullable().default(null),
  /** Die Einheit des Preises: „je Pfund“, „je Sack“, „je Fass“; leer = je Stück. */
  unit: z.string().default(''),
});
export type ShopStock = z.infer<typeof ShopStockSchema>;

/**
 * Was ein Handelsplatz gerade sucht oder nicht haben will (`domain/market.ts`): ein Wort, das
 * auf Namen, Einordnung oder Art einer Ware passt („Salz“, „Pelz“, „Waffe“), und ein Faktor auf
 * den Ankauf – 1,5 = +50 % (gesucht), 0,7 = −30 % (nicht gefragt). Nur ein Hinweis des
 * Spielleiters; am Tisch gilt der Preis, den er nennt.
 */
export const ShopDemandSchema = z.object({
  id,
  text: z.string().default(''),
  factor: z.number().positive().default(1.5),
});
export type ShopDemand = z.infer<typeof ShopDemandSchema>;

/**
 * Ein Laden (`domain/shop.ts`): ein Ort, der etwas verkauft – mit Händler, Bestand und Preisen.
 * Was er verkauft und angekauft hat, steht nur in der Chronik (Einträge der Art „Handel“).
 */
export const ShopSchema = z.object({
  ...base,
  /** Wie er heißt: „Zum Rostigen Anker“; leer = Art und Händler. */
  title: z.string().default(''),
  /** Frei: Schmiede, Krämer, Kräuterhändler … */
  kind: z.string().default(''),
  /** Wo er steht; null = dort, wo der Händler ist (fahrender Händler). */
  placeId: id.nullable().default(null),
  /** Wer verkauft (Person oder Fraktion). */
  keeperId: id.nullable().default(null),
  /** Preise im Verhältnis zum Listenpreis: 1 = Listenpreis, 0,8 = billig, 1,5 = Wucher. */
  priceFactor: z.number().positive().default(1),
  /** Was er beim Ankauf zahlt, im Verhältnis zum Listenpreis. */
  buyFactor: z.number().nonnegative().default(0.5),
  /**
   * Was er gern ankauft („Kraut“, „Waffe“, „Pflanze“) – nur ein Hinweis: Am Tisch kauft jeder
   * Laden alles an, zum Preis, den der Spielleiter nennt.
   */
  buys: z.array(z.string()).default([]),
  stock: z.array(ShopStockSchema).default([]),
  notes: z.string().default(''),
  /**
   * Ein Handelsplatz (Markt, Hafen, Auktionshaus, Hehler): ein Ort, an dem die Gruppe vor allem
   * verkauft – am Tisch steht „Verkaufen“ vorn (`domain/market.ts`).
   */
  market: z.boolean().default(false),
  /** Was hier gesucht ist (Faktor über 1) oder nicht gefragt (unter 1) – Hinweise beim Ankauf. */
  demand: z.array(ShopDemandSchema).default([]),
});
export type Shop = z.infer<typeof ShopSchema>;

/**
 * Eine Vorlage für eine Ladenart (`domain/shopTemplate.ts`): die eigene Liste des Spielleiters,
 * was ein Laden dieser Art führt – geschrieben wie eine Preisliste („Langschwert: 15 GM“, „Salz:
 * 5 KM je Pfund (20)“). In einen Laden kommt sie nur Zeile für Zeile, wenn er sie ankreuzt.
 */
export const ShopTemplateSchema = z.object({
  ...base,
  /** Die Ladenart, frei: „Schmiede“, „Tierhändler“. */
  kind: z.string().default(''),
  /** Die Liste in Worten – eine Ware je Zeile, Überschriften als Einordnung. */
  text: z.string().default(''),
});
export type ShopTemplate = z.infer<typeof ShopTemplateSchema>;

// ── Frühere Fassungen der Artikel ──────────────────────────────────────────

export const VERSION_REASONS = ['edit', 'restore', 'delete'] as const;
export type VersionReason = (typeof VERSION_REASONS)[number];

/**
 * Eine frühere Fassung einer Textseite (`domain/versions.ts`): der Wortlaut, wie er vor einer
 * Änderung stand. `edit` entsteht beim Schreiben, `restore` vor dem Zurückholen einer älteren
 * Fassung, `delete` beim Löschen des ganzen Artikels – sie ist sein Platz im Papierkorb und trägt
 * den Artikel vollständig (`article`), damit er sich wiederherstellen lässt.
 */
export const ArticleVersionSchema = z.object({
  ...base,
  articleId: id,
  /** Die Textseite, zu der der Wortlaut gehört; `null` bei `delete` (der ganze Artikel). */
  docId: id.nullable().default(null),
  /** Der Titel des Artikels zu der Zeit. */
  title: z.string().default(''),
  text: z.string().default(''),
  /** Wann die Fassung abgelegt wurde – echte Uhrzeit (ISO), nicht die Weltzeit. */
  savedAt: z.string().default(''),
  reason: z.enum(VERSION_REASONS).default('edit'),
  /** Nur bei `delete`: der Artikel, wie er vor dem Löschen war. */
  article: ArticleSchema.nullable().default(null),
  /** Nur bei `delete`: die Einträge der Welt, deren Text er war. */
  entityIds: z.array(id).default([]),
  /** Nur bei `delete`: die Unterartikel, die beim Löschen eine Ebene nach oben rückten. */
  childIds: z.array(id).default([]),
});
export type ArticleVersion = z.infer<typeof ArticleVersionSchema>;

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
  creatures: CreatureSchema,
  encounters: EncounterSchema,
  stocks: StockSchema,
  runs: RunSchema,
  nets: NetSchema,
  preps: PrepSchema,
  loot: LootSchema,
  tracks: TrackSchema,
  handouts: HandoutSchema,
  bastions: BastionSchema,
  guesses: GuessSchema,
  shops: ShopSchema,
  assortments: ShopTemplateSchema,
  versions: ArticleVersionSchema,
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
  'creatures',
  'encounters',
  'stocks',
  'runs',
  'nets',
  'preps',
  'loot',
  'tracks',
  'handouts',
  'bastions',
  'guesses',
  'shops',
  'assortments',
  'versions',
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

export function createCreature(init: Partial<Creature> & { name: string }): Creature {
  const stamp = nowIso();
  return CreatureSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createEncounter(init: Partial<Encounter> & { name: string }): Encounter {
  const stamp = nowIso();
  return EncounterSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createStock(init: Partial<Stock> & { name: string }): Stock {
  const stamp = nowIso();
  return StockSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createRun(
  init: Partial<Run> & { name: string; fromId: string; toId: string; start: number },
): Run {
  const stamp = nowIso();
  return RunSchema.parse({
    id: newId(),
    created: stamp,
    updated: stamp,
    every: { every: 1, unit: 'week' },
    ...init,
  });
}

export function createJourney(init: Partial<Journey>): Journey {
  const stamp = nowIso();
  return JourneySchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createRollTable(
  init: Partial<z.input<typeof RollTableSchema>> & { name: string },
): RollTable {
  const stamp = nowIso();
  return RollTableSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createBastion(init: Partial<Bastion> & { name: string }): Bastion {
  const stamp = nowIso();
  return BastionSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createHandout(init: Partial<Handout> = {}): Handout {
  const stamp = nowIso();
  return HandoutSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createGuess(init: Partial<Guess> = {}): Guess {
  const stamp = nowIso();
  return GuessSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createShop(init: Partial<Shop> = {}): Shop {
  const stamp = nowIso();
  return ShopSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createShopTemplate(init: Partial<ShopTemplate> = {}): ShopTemplate {
  const stamp = nowIso();
  return ShopTemplateSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createVersion(
  init: Partial<ArticleVersion> & { articleId: string },
): ArticleVersion {
  const stamp = nowIso();
  return ArticleVersionSchema.parse({
    id: newId(),
    created: stamp,
    updated: stamp,
    savedAt: stamp,
    ...init,
  });
}

export function createTrack(init: Partial<Track> & { name: string }): Track {
  const stamp = nowIso();
  return TrackSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createLoot(init: Partial<Loot> = {}): Loot {
  const stamp = nowIso();
  return LootSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createPrep(init: Partial<Prep> = {}): Prep {
  const stamp = nowIso();
  return PrepSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createNet(init: Partial<Net> & { name: string }): Net {
  const stamp = nowIso();
  return NetSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createThread(init: Partial<Thread> & { title: string }): Thread {
  const stamp = nowIso();
  return ThreadSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createStory(init: Partial<Story> & { title: string }): Story {
  const stamp = nowIso();
  return StorySchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createClock(
  init: Partial<Omit<Clock, 'steps'>> & {
    title: string;
    start: number;
    /** Was an einem Schritt fehlt (`sign`), füllt die Vorgabe. */
    steps?: (Omit<ClockStep, 'sign'> & { sign?: string | undefined })[];
  },
): Clock {
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

export function createMount(init: Partial<Mount> & { name: string }): Mount {
  const stamp = nowIso();
  return MountSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}

export function createTimer(
  init: Partial<Timer> & { label: string; start: number; end: number },
): Timer {
  const stamp = nowIso();
  return TimerSchema.parse({ id: newId(), created: stamp, updated: stamp, ...init });
}
