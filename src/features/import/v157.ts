/**
 * Übernahme eines Backups der alten Wayfarer-Version (v157) in das neue Datenmodell.
 *
 * Das Backup ist der vollständige Zustand der alten App als JSON (`version: 1`). Diese Datei
 * liest ihn nachsichtig: Was fehlt oder unlesbar ist, wird übersprungen und im Bericht genannt,
 * nie geraten. Was im neuen Modell (noch) keinen Platz hat, wird nicht übertragen, sondern
 * ebenfalls im Bericht aufgeführt. Die Weltzeit beider Versionen ist identisch (Minuten seit
 * Beginn des kosmischen Jahres 1) und wird unverändert übernommen.
 */
import {
  AreaSchema,
  CalendarEventSchema,
  CampaignMetaSchema,
  ChronicleEntrySchema,
  EntitySchema,
  MapSchema,
  PARTY_ID,
  PathSchema,
  PlayStateSchema,
  emptyCollections,
  RelationSchema,
  RestSchema,
  RollTableSchema,
  SessionSchema,
  TimerSchema,
  newId,
  nowIso,
  safeId,
  type Area,
  type CalendarEvent,
  type CampaignData,
  type ChronicleEntry,
  type Entity,
  type GameMap,
  type MapPoint,
  type Relation,
  type Rest,
  type RollTable,
  type Session,
  type Timer,
  type TravelPath,
} from '../../domain/schema';
import { attitudeLabel } from '../../domain/relations';
import {
  formatDate,
  formatDateTime,
  isValidDate,
  type CalendarDef,
} from '../../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../../domain/time/elaris';
import { repairReferences } from './integrity';

export interface ImportSections {
  /** Was übernommen wurde. */
  adopted: string[];
  /** Was beim Übernehmen umgedeutet oder vereinfacht wurde. */
  hints: string[];
  /** Was im neuen Wayfarer (noch) keinen Platz hat. */
  omitted: string[];
  /** Was unlesbar war und übersprungen wurde. */
  skipped: string[];
}

export interface ImportResult {
  data: CampaignData;
  /** Was übernommen wurde und was nicht – in ganzen Sätzen für die Anzeige. */
  report: string[];
  /** Derselbe Bericht, gegliedert. */
  sections: ImportSections;
}

// ── Festwerte der alten Version ────────────────────────────────────────────

/** Die Gruppe war in der alten Version fest eingebaut. */
export const LEGACY_PARTY = [
  { id: 'tomlin', name: 'Tomlin', className: 'Magier · Illusion' },
  { id: 'naelmira', name: 'Naelmira', className: 'Schurkin · Arkaner Betrüger' },
  { id: 'neil', name: 'Neil', className: 'Hexenmeister · Pact of the Many' },
  { id: 'corrin', name: 'Corrin', className: 'Barde · College of Dance' },
  { id: 'veres', name: 'Veres', className: 'Paladin · Schwur der Alten' },
  { id: 'nex', name: 'Nex', className: 'Kleriker / Druide' },
] as const;
/** Schlagwort für Personen, deren Name nicht im Backup stand (nur ein Verweis auf LegendKeeper). */
export const MISSING_NAME_TAG = 'Name fehlt';
/** Kurzbeschreibung solcher Personen, bis der Name nachgetragen ist. */
export const MISSING_NAME_TAGLINE =
  'Der Name stand nicht im Backup – er steht im verknüpften LegendKeeper-Artikel.';
/** Vorläufiger Name einer Person, von der nur die Kennung des LegendKeeper-Artikels bekannt ist. */
export const placeholderName = (resourceId: string) =>
  `Person aus LegendKeeper (${resourceId.slice(0, 8)})`;
/** Stufe, die die alte Version anzeigte, solange keine eingetragen war. */
const LEGACY_DEFAULT_LEVEL = 6;

/** Alte Meinungsskala 1–6 (0 = unbekannt gab es nur als „kein Wert“). */
export const LEGACY_OPINIONS = [
  'Hass',
  'Abneigung',
  'Skepsis',
  'Wohlwollen',
  'Zuneigung',
  'Liebe',
] as const;

/**
 * Alte Meinung (1 Hass … 6 Liebe) → neue Haltung auf der Skala −5 … +5: Hass → Hasserfüllt (−4),
 * Abneigung → Ablehnend (−2), Skepsis → Misstrauisch (−1), Wohlwollen → Wohlgesonnen (+2),
 * Zuneigung → Befreundet (+3), Liebe → Ergeben (+5). Die alte Skala hatte keine neutrale Mitte
 * und keine Zwischenstufen; die bleiben frei für spätere Feinheiten.
 */
const OPINION_ATTITUDE = [-4, -2, -1, 2, 3, 5] as const;
export function opinionToAttitude(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 6) return null;
  return OPINION_ATTITUDE[value - 1]!;
}

const PLACE_KIND_LABEL: Record<string, string> = {
  region: 'Region',
  city: 'Stadt',
  site: '',
  route: 'Reiseabschnitt',
};
/** Kategorien der alten Weltdatenbank, die im neuen Wayfarer eine eigene Art sind. */
const RECORD_KIND = {
  species: 'species',
  abilities: 'ability',
  languages: 'language',
  scripts: 'script',
} as const;
const RECORD_KIND_PLURAL: Record<keyof typeof RECORD_KIND, [one: string, many: string]> = {
  species: ['Spezies', 'Spezies'],
  abilities: ['Fähigkeit', 'Fähigkeiten'],
  languages: ['Sprache', 'Sprachen'],
  scripts: ['Schrift', 'Schriften'],
};
const JOURNAL_PREFIX: Record<string, string> = {
  promise: 'Zusage',
  debt: 'Schuld',
  favor: 'Gefallen',
  agreement: '',
};
const PROFICIENCY_KIND: Record<string, string> = {
  skill: 'Fertigkeit',
  save: 'Rettungswurf',
  tool: 'Werkzeug',
  other: 'Weitere Übung',
};
const KNOWN_TOP_LEVEL = new Set([
  'version',
  'now',
  'previous',
  'lk',
  'split',
  'active',
  'notes',
  'events',
  'sky',
  'travelScales',
  'travelLibrary',
  'world',
  'dungeons',
  'explorations',
  'npcOpinions',
  'npcKnowledge',
  'dossierJournal',
  'rests',
  'removedTimers',
  'timers',
  'characters',
]);

// ── Kleine Lesehilfen ──────────────────────────────────────────────────────

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const obj = (v: unknown): Raw => (isObj(v) ? v : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const idOf = (v: unknown): string => (typeof v === 'string' ? v : '');
const time = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;
const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];
const strings = (v: unknown): string[] => unique(list(v).map(text));
const isImageData = (v: string) => /^data:image\/(png|jpeg|webp);base64,/.test(v);

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Kartenschlüssel der alten Version: eine JSON-Liste `["resourceId","docId"]` aus LegendKeeper. */
function parseMapKey(key: string): { resourceId: string; docId: string } | null {
  try {
    const value: unknown = JSON.parse(key);
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((part) => typeof part === 'string' && part)
    )
      return { resourceId: value[0] as string, docId: value[1] as string };
  } catch {
    // Kein gültiger Schlüssel.
  }
  return null;
}
type Frame = { width: number; height: number };
const frameOf = (v: unknown): Frame | null => {
  const [w, h] = list(v).map(num);
  return w && h && w > 0 && h > 0 ? { width: w, height: h } : null;
};
const pointOf = (v: unknown): MapPoint | null => {
  const [x, y] = list(v).map(num);
  return x !== null && x !== undefined && y !== null && y !== undefined ? [x, y] : null;
};
/** Name ohne Akzente, Apostrophe, Satzzeichen und vorangestellten Artikel – zum Vergleichen. */
export const looseName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('de')
    .replace(/['’`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(der|die|das|the) /, '');

/** Rechnet einen Punkt aus dem Bildformat, in dem er gespeichert war, ins Format der Karte um. */
const toFrame = (p: MapPoint, from: Frame | null, to: Frame | null): MapPoint =>
  from && to && (from.width !== to.width || from.height !== to.height)
    ? [(p[0] * to.width) / from.width, (p[1] * to.height) / from.height]
    : p;

/** Gebiete der Würfeltabellen einer Erkundung in der alten Version. */
const PROFILE_LABEL: Record<string, string> = {
  city: 'Stadt',
  outskirts: 'Randgebiet',
  deep: 'Tiefe Wildnis',
};
const EXPLORATION_STATUS: Record<string, string> = {
  finished: 'abgeschlossen',
  active: 'unterwegs',
  planned: 'geplant',
  cancelled: 'abgebrochen',
};
const joinAnd = (parts: string[]): string =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;

/** Vergibt gültige, eindeutige Kennungen und merkt sich, welche alte zu welcher neuen gehört. */
type Space =
  | 'entities'
  | 'relations'
  | 'chronicle'
  | 'events'
  | 'sessions'
  | 'timers'
  | 'maps'
  | 'paths'
  | 'areas'
  | 'tables'
  | 'rests';

class Ids {
  /** Vergebene Kennungen je Sammlung, kleingeschrieben. */
  private used = new Map<Space, Set<string>>();
  private map = new Map<string, string>();

  /**
   * Unter Windows verbotene Dateinamen dürfen keine Kennung werden (jedes Dokument ist eine
   * Datei); „party“ ist die Gruppe selbst.
   */
  private static reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|party)$/i;

  /** Macht aus einer alten Kennung eine gültige: unerlaubte Zeichen werden zu einzelnen Strichen. */
  private static clean(wish: string): string {
    return safeId(wish.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || newId());
  }

  /**
   * Vergibt die Kennung für `key` in der Sammlung `space`. Die alte Kennung bleibt erhalten,
   * wenn sie gültig und noch frei ist; sonst gibt es eine neue.
   */
  claim(space: Space, key: string, wish = ''): string {
    const known = this.map.get(key);
    if (known) return known;
    let used = this.used.get(space);
    if (!used) this.used.set(space, (used = new Set()));
    let id = wish ? Ids.clean(wish) : newId();
    // Groß-/Kleinschreibung zählt nicht: macOS und Windows unterscheiden Dateinamen so nicht.
    while (used.has(id.toLowerCase()) || Ids.reserved.test(id)) id = newId();
    used.add(id.toLowerCase());
    this.map.set(key, id);
    return id;
  }
  alias(key: string, id: string) {
    this.map.set(key, id);
  }
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
}

// ── Der Import ─────────────────────────────────────────────────────────────

interface NpcOpinions {
  entityId: string;
  /** Ausdrücklich gesetzte Meinung zur Gruppe (alte Skala). */
  group: number | null;
  /** Meinung zu einzelnen Gefährten (alte Skala), nur gesetzte Werte. */
  members: Map<string, number>;
}

class Importer {
  private readonly stamp = nowIso();
  private readonly ids = new Ids();
  private readonly cal: CalendarDef;
  private readonly now: number;

  private readonly entities = new Map<string, Entity>();
  private readonly relations = new Map<string, Relation>();
  /** „von→zu“ → Beziehung, damit es je Richtung nur eine gibt. */
  private readonly relationByPair = new Map<string, string>();
  private readonly chronicle: ChronicleEntry[] = [];
  private readonly events: CalendarEvent[] = [];
  private readonly sessions: Session[] = [];
  private readonly timers: Timer[] = [];
  private readonly maps = new Map<string, GameMap>();
  private readonly paths: TravelPath[] = [];
  private readonly areas: Area[] = [];
  private readonly tables: RollTable[] = [];
  private readonly rests: Rest[] = [];
  private readonly opinions = new Map<string, NpcOpinions>();
  /** Alte Timer nach Kennung – für Reisen, die an Ortswechseln hängen. */
  private readonly legacyTimers = new Map<string, Raw>();

  private readonly adopted: string[] = [];
  private readonly hints: string[] = [];
  private readonly omitted: string[] = [];
  private readonly skippedCounts = new Map<string, number>();

  private placeId: string | null = null;
  private sessionId: string | null = null;
  /** Personen, die nur als LegendKeeper-Verweis existierten und deshalb keinen Namen haben. */
  private unnamed = 0;
  /** Personen der Weltdatenbank, die wegen einer Meinung als „getroffen“ gelten. */
  private metByOpinion = 0;

  constructor(private readonly raw: Raw) {
    const moons = ELARIS_CALENDAR.moons.map((moon) => {
      const anchor = time(obj(raw.sky)[moon.id]);
      return anchor === null ? moon : { ...moon, anchor };
    });
    this.cal = { ...ELARIS_CALENDAR, moons };
    const now = time(raw.now);
    if (now === null)
      this.hints.push(
        'Die Weltzeit im Backup war unlesbar; sie steht jetzt auf dem Startdatum von Elaris (17. Tauwind 701 AD, 16:00 Uhr).',
      );
    this.now = now ?? ELARIS_START;
  }

  run(): ImportResult {
    this.checkShapes();
    this.guard('Orte', () => this.importPlaces());
    this.guard('Einträge der Weltdatenbank', () => this.importRecords());
    this.guard('Gefährten', () => this.importParty());
    this.guard('Personen der Weltdatenbank', () => this.importPersons());
    this.guard('Beziehungen der Weltdatenbank', () => this.importDatabaseRelations());
    this.guard('Meinungen', () => this.importOpinions());
    this.guard('Dossiereinträge', () => this.importJournal());
    this.guard('Timer', () => this.importTimers());
    this.guard('Ortswechsel', () => this.importVisits());
    this.guard('Termine', () => this.importEvents());
    this.guard('Notizen', () => this.importNotes());
    this.guard('Karten und Routen', () => this.importMaps());
    this.guard('Erkundungen', () => this.importExplorations());
    this.guard('Rasten', () => this.importRests());
    this.assignSessions();
    this.reportSky();
    this.reportOmitted();
    return this.finish();
  }

  /**
   * Bereiche, die vorhanden sind, aber eine ganz falsche Form haben (etwa Text statt Liste),
   * werden beim Lesen wie leere behandelt. Damit sie nicht stillschweigend verschwinden,
   * nennt der Bericht sie hier. Fehlende Bereiche (ältere Backups) sind kein Fehler.
   */
  private checkShapes() {
    const world = this.raw.world;
    const database = obj(world).database;
    const shapes: [value: unknown, expected: 'list' | 'object', label: string][] = [
      [this.raw.notes, 'list', 'Notizen'],
      [this.raw.events, 'list', 'Termine'],
      [this.raw.timers, 'list', 'Timer'],
      [this.raw.removedTimers, 'list', 'Gelöschte Timer'],
      [world, 'object', 'Welt'],
      [obj(world).places, 'list', 'Orte'],
      [obj(world).visits, 'list', 'Ortswechsel'],
      [database, 'object', 'Weltdatenbank'],
      [obj(database).records, 'object', 'Weltdatenbank'],
      [this.raw.characters, 'object', 'Gefährten'],
      [this.raw.npcOpinions, 'object', 'Meinungen'],
      [this.raw.npcKnowledge, 'object', 'Bekanntheit der Personen'],
      [this.raw.dossierJournal, 'object', 'Dossiereinträge'],
      [this.raw.sky, 'object', 'Mond-Kalibrierung'],
    ];
    const broken = new Set<string>();
    for (const [value, expected, label] of shapes) {
      if (value === undefined || value === null) continue;
      const fits = expected === 'list' ? Array.isArray(value) : isObj(value);
      if (!fits) broken.add(label);
    }
    for (const label of broken)
      this.skip(
        `Bereich „${label}“ (unerwarteter Aufbau)`,
        `Bereiche „${label}“ (unerwarteter Aufbau)`,
      );
  }

  /** Ein kaputter Bereich darf den Rest nicht aufhalten. */
  private guard(label: string, fn: () => void) {
    try {
      fn();
    } catch {
      this.skip(
        `Bereich „${label}“ (unerwarteter Aufbau)`,
        `Bereiche „${label}“ (unerwarteter Aufbau)`,
      );
    }
  }

  private skip(one: string, many = one) {
    const key = `${one}\u0000${many}`;
    this.skippedCounts.set(key, (this.skippedCounts.get(key) ?? 0) + 1);
  }

  private date(at: number): string {
    return formatDate(this.cal, at);
  }
  private dateTime(at: number): string {
    return `${formatDateTime(this.cal, at)} Uhr`;
  }

  // ── Einträge anlegen ─────────────────────────────────────────────────────

  private addEntity(init: Raw & { id: string; kind: Entity['kind']; name: string }): Entity | null {
    const parsed = EntitySchema.safeParse({ created: this.stamp, updated: this.stamp, ...init });
    if (!parsed.success) return null;
    this.entities.set(parsed.data.id, parsed.data);
    return parsed.data;
  }

  private entityId(legacyId: unknown): string | null {
    const id = typeof legacyId === 'string' && legacyId ? this.ids.get(`db:${legacyId}`) : null;
    return id && this.entities.has(id) ? id : null;
  }
  private entityOfKind(legacyId: unknown, kind: Entity['kind']): string | null {
    const id = this.entityId(legacyId);
    return id && this.entities.get(id)?.kind === kind ? id : null;
  }
  private placeIdOf(legacyId: unknown): string | null {
    const id = this.entityId(legacyId);
    return id && this.entities.get(id)?.kind === 'place' ? id : null;
  }
  private name(entityId: string | null): string {
    return (entityId && this.entities.get(entityId)?.name) || '';
  }
  private names(legacyIds: unknown): string[] {
    return unique(list(legacyIds).map((id) => this.name(this.entityId(id))));
  }

  /**
   * Legt eine Beziehung an. Gibt es in dieser Richtung schon eine, wird sie ergänzt statt
   * verdoppelt – das neue Modell kennt je Richtung genau eine Beziehung.
   */
  private relate(
    from: string,
    to: string,
    init: { type?: string; label?: string; note?: string; attitude?: number | null },
  ): boolean {
    if (from === to) return false;
    const pair = `${from}→${to}`;
    const existingId = this.relationByPair.get(pair);
    const existing = existingId ? this.relations.get(existingId) : undefined;
    if (existing) {
      // Eine bloße Haltung („kennt“) nimmt die genauere Art an; sonst wandert die zweite
      // Verbindung als Zusatz in die Notiz.
      const adopt = existing.type === 'knows' && !!init.type && init.type !== 'knows';
      const extra = adopt ? (init.note ?? '') : [init.label, init.note].filter(Boolean).join(': ');
      this.relations.set(existing.id, {
        ...existing,
        type: adopt ? init.type! : existing.type,
        label: adopt ? (init.label ?? '') : existing.label,
        note:
          extra && !existing.note.includes(extra)
            ? [existing.note, extra].filter(Boolean).join(' · ')
            : existing.note,
        attitude: init.attitude === undefined ? existing.attitude : init.attitude,
      });
      return false;
    }
    const parsed = RelationSchema.safeParse({
      id: this.ids.claim('relations', `relation:${pair}`),
      created: this.stamp,
      updated: this.stamp,
      from,
      to,
      type: init.type ?? 'knows',
      label: init.label ?? '',
      note: init.note ?? '',
      attitude: init.attitude ?? null,
    });
    if (!parsed.success) return false;
    this.relations.set(parsed.data.id, parsed.data);
    this.relationByPair.set(pair, parsed.data.id);
    return true;
  }

  private addChronicle(init: Raw & { id: string; at: number }): boolean {
    const parsed = ChronicleEntrySchema.safeParse({
      created: this.stamp,
      updated: this.stamp,
      ...init,
    });
    if (parsed.success) this.chronicle.push(parsed.data);
    return parsed.success;
  }

  /** Felder, die Orte und alle Datenbankeinträge der alten Version gemeinsam haben. */
  private common(e: Raw): { aliases: string[]; tags: string[]; notes: string[]; link: string } {
    const link = text(e.wikiUrl);
    return {
      aliases: unique([text(e.alias), ...strings(e.aliases)]),
      tags: unique([...strings(e.tags), ...strings(e.roles)]),
      notes: [text(e.description)].filter(Boolean),
      link,
    };
  }

  private static composeNotes(body: string[], facts: string[]): string {
    return [...body, facts.join('\n')].filter(Boolean).join('\n\n');
  }

  // ── Orte ─────────────────────────────────────────────────────────────────

  private importPlaces() {
    const world = obj(this.raw.world);
    const places = list(world.places);
    const valid: Raw[] = [];
    for (const p of places) {
      if (!isObj(p) || !idOf(p.id) || !text(p.name) || this.ids.get(`db:${idOf(p.id)}`)) {
        this.skip('Ort', 'Orte');
        continue;
      }
      this.ids.claim('entities', `db:${idOf(p.id)}`, idOf(p.id));
      valid.push(p);
    }
    let linked = 0;
    for (const p of valid) {
      const id = this.ids.get(`db:${idOf(p.id)}`)!;
      const { aliases, tags, notes, link } = this.common(p);
      const kind = PLACE_KIND_LABEL[idOf(p.kind)] ?? '';
      const placeClass =
        text(p.placeClass) === 'Raumcontainer' ? 'Welt / Ebene' : text(p.placeClass);
      const type = text(p.type);
      const facts: string[] = [];
      if (type && placeClass) facts.push(`Einordnung: ${placeClass}`);
      const wikiId = idOf(p.wikiId);
      if (link && !wikiId) facts.push(`LegendKeeper: ${link}`);
      if (wikiId) linked++;
      const parentKey = idOf(p.parentId);
      const added = this.addEntity({
        id,
        kind: 'place',
        name: text(p.name),
        aliases,
        tags,
        notes: Importer.composeNotes(notes, facts),
        lk: wikiId ? { resourceId: wikiId, title: '' } : null,
        place: {
          // Der Elternort wird unten geprüft, wenn alle Orte bekannt sind.
          parentId: parentKey ? this.ids.get(`db:${parentKey}`) : null,
          category: type || placeClass || kind,
        },
      });
      if (!added) this.skip('Ort', 'Orte');
    }
    if (this.entities.size)
      this.adopted.push(
        `${count(this.entities.size, 'Ort wurde', 'Orte wurden')} mit Gliederung, Beschreibung und Schlagworten übernommen` +
          (linked ? `, ${linked} davon mit Verknüpfung zu einem LegendKeeper-Artikel.` : '.'),
      );
  }

  // ── Weltdatenbank: Themen und Fraktionen ─────────────────────────────────

  private records(category: string): Raw[] {
    const records = obj(obj(obj(this.raw.world).database).records);
    const out: Raw[] = [];
    for (const r of list(records[category])) {
      if (!isObj(r) || !idOf(r.id) || !text(r.name) || this.ids.get(`db:${idOf(r.id)}`)) {
        this.skip('Eintrag der Weltdatenbank', 'Einträge der Weltdatenbank');
        continue;
      }
      out.push(r);
    }
    return out;
  }

  private importRecords() {
    const records = obj(obj(obj(this.raw.world).database).records);
    const unknown = Object.keys(records).filter(
      (key) =>
        !['characters', 'organizations', 'families', ...Object.keys(RECORD_KIND)].includes(key),
    );
    if (unknown.length)
      this.omitted.push(
        `Nicht übernommen: unbekannte Kategorien der Weltdatenbank (${unknown.join(', ')}).`,
      );

    // Erst alle Kennungen vergeben, damit Einträge aufeinander verweisen können.
    const topics = (Object.keys(RECORD_KIND) as (keyof typeof RECORD_KIND)[]).flatMap((category) =>
      this.records(category).map((r) => ({ r, category })),
    );
    for (const { r } of topics) this.ids.claim('entities', `db:${idOf(r.id)}`, idOf(r.id));
    const topicName = (legacyId: unknown) =>
      text(topics.find(({ r }) => r.id === legacyId && typeof legacyId === 'string')?.r.name);
    const topicNames = (legacyIds: unknown) => unique(list(legacyIds).map(topicName));

    const topicCounts = new Map<keyof typeof RECORD_KIND, number>();
    for (const { r, category } of topics) {
      const { aliases, tags, notes, link } = this.common(r);
      const facts: string[] = [];
      if (category === 'species') {
        const parent = topicName(r.parentSpeciesId);
        if (parent) facts.push(`Übergeordnete Spezies: ${parent}`);
        if (typeof r.lifespan === 'number' && Number.isFinite(r.lifespan))
          facts.push(`Lebenserwartung: ${r.lifespan} Jahre`);
        const abilities = topicNames(r.abilityIds);
        if (abilities.length) facts.push(`Fähigkeiten: ${abilities.join(', ')}`);
        const excluded = topicNames(r.excludedAbilityIds);
        if (excluded.length) facts.push(`Nicht geerbte Fähigkeiten: ${excluded.join(', ')}`);
      }
      if (link) facts.push(`LegendKeeper: ${link}`);
      const kind = RECORD_KIND[category];
      const added = this.addEntity({
        id: this.ids.get(`db:${idOf(r.id)}`)!,
        kind,
        name: text(r.name),
        aliases,
        tags,
        notes: Importer.composeNotes(notes, facts),
        [kind]: { category: text(r.type) },
      });
      if (added) topicCounts.set(category, (topicCounts.get(category) ?? 0) + 1);
      else this.skip('Eintrag der Weltdatenbank', 'Einträge der Weltdatenbank');
    }

    let factions = 0;
    let families = 0;
    for (const category of ['organizations', 'families'] as const) {
      for (const r of this.records(category)) {
        const { aliases, notes, link } = this.common(r);
        const facts: string[] = [];
        // Bei Organisationen waren „Rollen“ Vorschläge für Mitgliederrollen, keine Schlagworte.
        const roles = strings(r.roles);
        if (roles.length) facts.push(`Rollen: ${roles.join(', ')}`);
        if (link) facts.push(`LegendKeeper: ${link}`);
        const kind = category === 'families' ? 'family' : 'faction';
        const added = this.addEntity({
          id: this.ids.claim('entities', `db:${idOf(r.id)}`, idOf(r.id)),
          kind,
          name: text(r.name),
          aliases,
          tags: strings(r.tags),
          notes: Importer.composeNotes(notes, facts),
          [kind]: { category: text(r.type) },
        });
        if (!added) this.skip('Eintrag der Weltdatenbank', 'Einträge der Weltdatenbank');
        else if (category === 'families') families++;
        else factions++;
      }
    }

    // Schrift einer Sprache: erst jetzt sind alle Schriften angelegt.
    for (const { r, category } of topics) {
      if (category !== 'languages') continue;
      const language = this.entities.get(this.ids.get(`db:${idOf(r.id)}`) ?? '');
      const scriptId = this.entityOfKind(r.scriptId, 'script');
      if (language?.kind === 'language' && scriptId)
        this.entities.set(language.id, {
          ...language,
          language: { ...language.language, scriptId },
        });
    }

    const parts: string[] = [];
    if (factions) parts.push(count(factions, 'Fraktion', 'Fraktionen'));
    if (families) parts.push(count(families, 'Familie', 'Familien'));
    for (const [category, n] of topicCounts) {
      const [one, many] = RECORD_KIND_PLURAL[category];
      parts.push(count(n, one, many));
    }
    if (parts.length) this.adopted.push(`Aus der Weltdatenbank: ${joinAnd(parts)}.`);
  }

  // ── Gefährten ────────────────────────────────────────────────────────────

  private importParty() {
    const characters = obj(this.raw.characters);
    const unknown = Object.keys(characters).filter((id) => !LEGACY_PARTY.some((p) => p.id === id));
    unknown.forEach(() =>
      this.skip('Gefährte mit unbekannter Kennung', 'Gefährten mit unbekannter Kennung'),
    );
    let clamped = 0;
    let linkedPortraits = 0;
    let builtInPortraits = 0;
    let withValues = 0;
    for (const member of LEGACY_PARTY) {
      const c = obj(characters[member.id]);
      if (Object.keys(c).length) withValues++;
      // Ohne eigenes Bild zeigte die alte Version ein mitgeliefertes Porträt, das nicht im Backup steht.
      if (!Object.hasOwn(c, 'portrait')) builtInPortraits++;
      const facts: string[] = [];
      const level = int(c.level) ?? LEGACY_DEFAULT_LEVEL;
      if (level > 20) {
        clamped++;
        facts.push(`Stufe in der alten Version: ${level}`);
      }
      for (const p of list(c.proficiencies)) {
        if (!isObj(p) || !text(p.name)) continue;
        const details = [
          PROFICIENCY_KIND[idOf(p.kind)] ?? 'Übung',
          p.rank === 'expertise' ? 'Expertise' : 'geübt',
          int(p.bonus) !== null ? `${int(p.bonus)! >= 0 ? '+' : ''}${int(p.bonus)}` : '',
        ].filter(Boolean);
        facts.push(`Übung: ${text(p.name)} (${details.join(', ')})`);
      }
      const history = list(c.locationHistory)
        .filter((r): r is Raw => isObj(r) && !!text(r.name) && time(r.at) !== null)
        .sort((a, b) => time(a.at)! - time(b.at)!);
      if (history.length)
        facts.push(
          'Frühere Aufenthalte abseits der Gruppe:\n' +
            history.map((r) => `– ${this.dateTime(time(r.at)!)}: ${text(r.name)}`).join('\n'),
        );
      const condition = obj(c.condition);
      const exhaustion = int(condition.exhaustion);
      const portrait = text(c.portrait);
      if (portrait && !isImageData(portrait)) {
        linkedPortraits++;
        facts.push(`Bild (Link): ${portrait}`);
      }
      const added = this.addEntity({
        id: this.ids.claim('entities', `party:${member.id}`, member.id),
        kind: 'character',
        name: member.name,
        notes: Importer.composeNotes([text(c.notes)].filter(Boolean), facts),
        image: isImageData(portrait) ? portrait : null,
        character: {
          className: text(c.className) || member.className,
          level: Math.max(1, Math.min(20, level)),
          armorClass: int(c.ac),
          spellSaveDc: int(c.spellDC),
          passivePerception: int(c.perception),
          passiveInvestigation: int(c.investigation),
          passiveInsight: int(c.insight),
          languages: strings(c.languages),
          exhaustion: exhaustion !== null ? Math.max(0, Math.min(6, exhaustion)) : 0,
        },
      });
      if (!added) this.skip('Gefährte', 'Gefährten');
    }
    this.adopted.push(
      `Die ${LEGACY_PARTY.length} Gefährten wurden angelegt` +
        (withValues
          ? `; für ${withValues} von ihnen standen Werte im Backup (Klasse, Stufe, Rüstungsklasse, Zauber-SG, passive Werte, Sprachen, Erschöpfung, Bild). ` +
            'Übungen und frühere Aufenthalte stehen als Text in ihren Notizen.'
          : ' – eigene Werte standen nicht im Backup, deshalb gelten Klasse und Stufe 6 wie in der alten Anzeige.'),
    );
    if (clamped)
      this.hints.push(
        `${count(clamped, 'Gefährte hatte', 'Gefährten hatten')} eine Stufe über 20; eingetragen ist Stufe 20, der alte Wert steht in den Notizen.`,
      );
    if (builtInPortraits)
      this.hints.push(
        `${count(builtInPortraits, 'Gefährte zeigte', 'Gefährten zeigten')} in der alten Version das mitgelieferte Porträt. Es steht nicht im Backup; das Bild lässt sich im Bereich „Gefährten“ neu einfügen.`,
      );
    if (linkedPortraits)
      this.hints.push(
        `${count(linkedPortraits, 'Bild war', 'Bilder waren')} nur als Internet-Link hinterlegt. Der Link steht in den Notizen; das Bild selbst muss neu eingefügt werden.`,
      );
  }

  // ── Weltdatenbank: Personen ──────────────────────────────────────────────

  private importPersons() {
    const knowledge = obj(this.raw.npcKnowledge);
    const npcOpinions = obj(this.raw.npcOpinions);
    let persons = 0;
    let merged = 0;
    let linkedPortraits = 0;
    const personRecords = this.records('characters');
    for (const r of personRecords) {
      const partyId = idOf(r.partyId);
      const member = this.ids.get(`party:${partyId}`);
      if (partyId && member && this.entities.has(member))
        this.ids.alias(`db:${idOf(r.id)}`, member);
      else this.ids.claim('entities', `db:${idOf(r.id)}`, idOf(r.id));
    }
    for (const r of personRecords) {
      const id = this.ids.get(`db:${idOf(r.id)}`)!;
      const { aliases, tags, notes, link } = this.common(r);
      const dynamic = obj(r.dynamic);
      const facts: string[] = [];
      if (text(r.title)) facts.push(`Titel: ${text(r.title)}`);
      const fullName = [text(r.firstName), text(r.lastName)].filter(Boolean).join(' ');
      if (fullName && fullName !== text(r.name)) facts.push(`Voller Name: ${fullName}`);
      if (text(r.gender)) facts.push(`Geschlecht: ${text(r.gender)}`);
      const birth = this.birthText(r.birth);
      const birthPlace = this.name(this.placeIdOf(r.birthPlaceId));
      if (birth || birthPlace)
        facts.push(
          `Geboren: ${[birth, birthPlace && `in ${birthPlace}`].filter(Boolean).join(' ')}` +
            (r.birthGenerated === true ? ' (Datum aus dem Alter errechnet)' : ''),
        );
      if (typeof r.biologicalAge === 'number')
        facts.push(`Biologisches Alter: ${r.biologicalAge} Jahre`);
      const estimate = obj(r.ageEstimate);
      if (int(estimate.age) !== null) {
        const asOf = this.birthText(estimate.asOf);
        facts.push(
          `Geschätztes Alter: ${int(estimate.age)} Jahre${asOf ? ` (Stand ${asOf})` : ''}`,
        );
      }
      const work = this.placeIdOf(r.workPlaceId);
      const languages = this.names(r.languageIds);
      if (text(dynamic.health)) facts.push(`Zustand: ${text(dynamic.health)}`);
      if (text(dynamic.goals)) facts.push(`Ziele: ${text(dynamic.goals)}`);
      if (link) facts.push(`LegendKeeper: ${link}`);
      const portrait = text(r.portrait);
      if (portrait && !isImageData(portrait)) {
        linkedPortraits++;
        facts.push(`Bild (Link): ${portrait}`);
      }
      const speciesId = this.entityOfKind(r.speciesId, 'species');
      const species = this.name(speciesId);
      const home = this.placeIdOf(r.homeId);

      const existing = this.entities.get(id);
      if (existing?.kind === 'character') {
        // Stammdaten eines Gefährten: in dessen Eintrag einarbeiten.
        if (home) facts.push(`Heimat: ${this.name(home)}`);
        if (work) facts.push(`Arbeitsort: ${this.name(work)}`);
        if (text(r.profession)) facts.push(`Beruf: ${text(r.profession)}`);
        const abilities = this.names(r.abilityIds);
        if (abilities.length) facts.push(`Fähigkeiten: ${abilities.join(', ')}`);
        const scripts = this.names(r.scriptIds);
        if (scripts.length) facts.push(`Schriften: ${scripts.join(', ')}`);
        this.entities.set(id, {
          ...existing,
          aliases: unique([...existing.aliases, ...aliases]),
          tags: unique([...existing.tags, ...tags]),
          notes: Importer.composeNotes([existing.notes, ...notes].filter(Boolean), facts),
          image: existing.image ?? (isImageData(portrait) ? portrait : null),
          character: {
            ...existing.character,
            species: existing.character.species || species,
            languages: unique([...existing.character.languages, ...languages]),
          },
        });
        merged++;
        continue;
      }

      const ref = obj(r.npcRef);
      const project = idOf(ref.projectId);
      const resource = idOf(ref.resourceId);
      const isLinked = !!project && !!resource;
      if (isLinked) this.ids.alias(`npc:${project}:${resource}`, id);
      const own = obj(dynamic.opinions);
      const fromNpc = isLinked ? obj(obj(npcOpinions[project])[resource]) : {};
      const members = new Map<string, number>();
      for (const p of LEGACY_PARTY) {
        const value = opinionToAttitude(fromNpc[p.id]) !== null ? fromNpc[p.id] : own[p.id];
        if (opinionToAttitude(value) !== null) members.set(p.id, value as number);
      }
      const group = opinionToAttitude(own.group) !== null ? (own.group as number) : null;
      // „Der Gruppe bekannt“ war bei LegendKeeper-Personen eine eigene Angabe, unabhängig von
      // Meinungen. Für Personen nur aus der Weltdatenbank gab es sie nicht; dort gilt eine
      // Meinung zur Gruppe oder zu Gefährten als Zeichen, dass man sich begegnet ist.
      const known = isLinked
        ? obj(knowledge[project])[resource] === true
        : group !== null || members.size > 0;
      if (!isLinked && known) this.metByOpinion++;
      const added = this.addEntity({
        id,
        kind: 'person',
        name: text(r.name),
        aliases,
        tags,
        notes: Importer.composeNotes(notes, facts),
        image: isImageData(portrait) ? portrait : null,
        lk: isLinked ? { resourceId: resource, title: '' } : null,
        person: {
          speciesId,
          workplaceId: work,
          role: text(r.profession),
          placeId: this.placeIdOf(dynamic.locationId),
          homeId: home,
          met: known,
        },
      });
      if (!added) {
        this.skip('Person', 'Personen');
        continue;
      }
      persons++;
      // Sprachen, Schriften und Fähigkeiten sind eigene Einträge, verbunden über Beziehungen.
      for (const [field, type, kind] of [
        ['languageIds', 'speaks', 'language'],
        ['scriptIds', 'writes', 'script'],
        ['abilityIds', 'has-ability', 'ability'],
      ] as const)
        for (const legacy of list(r[field])) {
          const target = this.entityOfKind(legacy, kind);
          if (target) this.relate(id, target, { type });
        }
      if (group !== null || members.size) this.opinions.set(id, { entityId: id, group, members });
    }
    if (persons)
      this.adopted.push(
        `${count(persons, 'Person wurde', 'Personen wurden')} aus der Weltdatenbank übernommen – mit Beruf, Spezies, Heimat und Aufenthaltsort; ` +
          'Titel, Geburt, Alter, Zustand und Ziele stehen als Text in den Notizen.',
      );
    if (merged)
      this.adopted.push(
        `Die Stammdaten von ${count(merged, 'Gefährten', 'Gefährten')} aus der Weltdatenbank wurden in ${merged === 1 ? 'dessen' : 'deren'} Eintrag eingearbeitet.`,
      );
    if (linkedPortraits)
      this.hints.push(
        `${count(linkedPortraits, 'Personenbild war', 'Personenbilder waren')} nur als Internet-Link hinterlegt; der Link steht in den Notizen.`,
      );
    if (persons)
      this.hints.push(
        'Als „getroffen“ gelten Personen aus LegendKeeper, die in der alten Version als der Gruppe bekannt markiert waren. ' +
          'Für Personen, die es nur in der Weltdatenbank gab, fehlte diese Angabe' +
          (this.metByOpinion
            ? `; ${count(this.metByOpinion, 'von ihnen gilt', 'von ihnen gelten')} als getroffen, weil eine Meinung zur Gruppe oder zu Gefährten eingetragen war.`
            : '; sie gelten als noch nicht getroffen.'),
      );
  }

  /** „12. Sonnfeld 660 AD“ aus { year (AD), month, day } der alten Version. */
  private birthText(value: unknown): string {
    const b = obj(value);
    const year = int(b.year);
    const month = int(b.month);
    const day = int(b.day);
    if (year === null || month === null || day === null) return '';
    const era = this.cal.eras[0]!;
    if (!isValidDate(this.cal, { year: year + era.offset, month, day, hour: 0, minute: 0 }))
      return '';
    return `${day}. ${this.cal.months[month]!.name} ${year} ${era.label}`;
  }

  // ── Weltdatenbank: Beziehungen ───────────────────────────────────────────

  private importDatabaseRelations() {
    const relations = list(obj(obj(this.raw.world).database).relations);
    let created = 0;
    let parents = 0;
    let seats = 0;
    const add = (from: string, to: string, init: Parameters<Importer['relate']>[2]) => {
      if (this.relate(from, to, init)) created++;
    };
    for (const r of relations) {
      const type = isObj(r) ? idOf(r.type) : '';
      const from = isObj(r) ? this.entityId(r.from) : null;
      const to = isObj(r) ? this.entityId(r.to) : null;
      if (!isObj(r) || !from || !to || from === to) {
        this.skip('Beziehung der Weltdatenbank', 'Beziehungen der Weltdatenbank');
        continue;
      }
      const role = text(r.role);
      const sentence = (verb: string) => `${this.name(from)} ${verb} ${this.name(to)}.`;
      switch (type) {
        case 'contains':
          if (this.setParent(to, from)) parents++;
          else
            add(to, from, {
              type: 'custom',
              label: 'räumlich zugeordnet',
              note: sentence('enthält'),
            });
          break;
        case 'partOf':
        case 'container':
          if (this.setParent(from, to)) parents++;
          else
            add(from, to, {
              type: 'custom',
              label: 'räumlich zugeordnet',
              note: sentence(type === 'partOf' ? 'ist Teil von' : 'liegt in der Welt / Ebene'),
            });
          break;
        case 'political':
          add(from, to, { type: 'member', note: 'Politisch zugeordnet' });
          break;
        case 'overlaps':
          add(from, to, { type: 'custom', label: 'überlappt sich mit' });
          break;
        case 'connects':
        case 'connection':
          add(from, to, { type: 'custom', label: 'verbunden mit' });
          break;
        case 'seat': {
          const group = this.entities.get(from);
          const isPlace = this.entities.get(to)?.kind === 'place';
          if (group?.kind === 'faction' && group.faction.seatId === null && isPlace) {
            this.entities.set(from, { ...group, faction: { ...group.faction, seatId: to } });
            seats++;
          } else if (group?.kind === 'family' && group.family.seatId === null && isPlace) {
            this.entities.set(from, { ...group, family: { ...group.family, seatId: to } });
            seats++;
          } else add(from, to, { type: 'resides', note: 'Weiterer Sitz' });
          break;
        }
        case 'operates':
          add(from, to, { type: 'resides', note: 'Wirkungsgebiet' });
          break;
        case 'orgPart':
          add(from, to, { type: 'member', note: 'Teilorganisation' });
          break;
        case 'membership':
        case 'familyMember':
          add(from, to, { type: 'member', note: role });
          break;
        case 'mother':
          add(from, to, { type: 'family', note: sentence('ist die Mutter von') });
          break;
        case 'father':
          add(from, to, { type: 'family', note: sentence('ist der Vater von') });
          break;
        case 'parent':
          add(from, to, { type: 'family', note: sentence('ist ein Elternteil von') });
          break;
        case 'sibling':
          add(from, to, { type: 'family', note: 'Geschwister' });
          break;
        case 'spouse':
          add(from, to, { type: 'lover', note: 'Verheiratet' });
          break;
        case 'guardian':
          add(from, to, { type: 'custom', label: 'Vormundschaft', note: sentence('betreut') });
          break;
        default:
          this.skip('Beziehung unbekannter Art', 'Beziehungen unbekannter Art');
      }
    }
    if (created + parents + seats) {
      const parts = [
        created
          ? count(created, 'Beziehung', 'Beziehungen') +
            ' (Mitgliedschaften, Familie, Wirkungsgebiete, Verbindungen)'
          : '',
        seats ? count(seats, 'Sitz einer Fraktion', 'Sitze von Fraktionen') : '',
        parents
          ? count(parents, 'räumliche Zuordnung', 'räumliche Zuordnungen') +
            ' als übergeordneter Ort'
          : '',
      ].filter(Boolean);
      this.adopted.push(`Verknüpfungen der Weltdatenbank: ${joinAnd(parts)}.`);
      this.hints.push(
        'Das neue Wayfarer kennt je Ort genau einen übergeordneten Ort. Lag ein Ort in mehreren Gebieten, steht die erste Zuordnung in der Gliederung und jede weitere als Beziehung „räumlich zugeordnet“. Abstammung (Mutter, Vater) steht als Satz in der Notiz der Beziehung „verwandt mit“.',
      );
    }
  }

  /** Setzt den Elternort, wenn der Ort noch keinen hat und kein Kreis entsteht. */
  private setParent(childId: string, parentId: string): boolean {
    const child = this.entities.get(childId);
    const parent = this.entities.get(parentId);
    if (child?.kind !== 'place' || parent?.kind !== 'place') return false;
    if (child.place.parentId === parentId) return true;
    if (child.place.parentId !== null) return false;
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === childId || seen.has(cursor)) return false;
      seen.add(cursor);
      const next = this.entities.get(cursor);
      cursor = next?.kind === 'place' ? next.place.parentId : null;
    }
    this.entities.set(childId, { ...child, place: { ...child.place, parentId } });
    return true;
  }

  // ── Meinungen ────────────────────────────────────────────────────────────

  /** Person zu einem LegendKeeper-Verweis; legt sie an, wenn es sie noch nicht gibt. */
  private npc(project: string, resource: string): string | null {
    if (!project || !resource) return null;
    const key = `npc:${project}:${resource}`;
    const known = this.ids.get(key);
    if (known && this.entities.has(known)) return known;
    const id = this.ids.claim('entities', key, resource);
    const added = this.addEntity({
      id,
      kind: 'person',
      name: placeholderName(resource),
      tagline: MISSING_NAME_TAGLINE,
      tags: [MISSING_NAME_TAG],
      lk: { resourceId: resource, title: '' },
      person: { met: obj(obj(this.raw.npcKnowledge)[project])[resource] === true },
    });
    if (!added) return null;
    this.unnamed++;
    return id;
  }

  private importOpinions() {
    // Personen, die es nur als Verweis auf LegendKeeper gab: aus Meinungen und Bekanntheit.
    for (const [project, rows] of Object.entries(obj(this.raw.npcOpinions))) {
      for (const [resource, values] of Object.entries(obj(rows))) {
        const members = new Map<string, number>();
        for (const p of LEGACY_PARTY) {
          const value = obj(values)[p.id];
          if (opinionToAttitude(value) !== null) members.set(p.id, value as number);
        }
        if (!members.size) continue;
        const id = this.npc(project, resource);
        if (!id) {
          this.skip('Meinung ohne gültigen Verweis', 'Meinungen ohne gültigen Verweis');
          continue;
        }
        if (!this.opinions.has(id)) this.opinions.set(id, { entityId: id, group: null, members });
      }
    }
    for (const [project, rows] of Object.entries(obj(this.raw.npcKnowledge)))
      for (const [resource, known] of Object.entries(obj(rows)))
        if (known === true) this.npc(project, resource);
    for (const e of Object.values(obj(this.raw.dossierJournal)))
      if (isObj(e)) this.npc(idOf(e.projectId), idOf(e.resourceId));

    let toParty = 0;
    let toMembers = 0;
    for (const { entityId, group, members } of this.opinions.values()) {
      const values = LEGACY_PARTY.map((p) => members.get(p.id));
      const shared = values.every((v) => v !== undefined && v === values[0]) ? values[0]! : null;
      const party = group ?? shared;
      if (party !== null) {
        this.relate(entityId, PARTY_ID, { attitude: opinionToAttitude(party) });
        toParty++;
      }
      for (const p of LEGACY_PARTY) {
        const value = members.get(p.id);
        const character = this.ids.get(`party:${p.id}`);
        if (value === undefined || value === party || !character || !this.entities.has(character))
          continue;
        this.relate(entityId, character, { attitude: opinionToAttitude(value) });
        toMembers++;
      }
    }
    if (this.unnamed)
      this.adopted.push(
        `${count(this.unnamed, 'Person kannte', 'Personen kannte')} die alte Version nur als Verweis auf einen LegendKeeper-Artikel. ` +
          `${this.unnamed === 1 ? 'Sie wurde' : 'Sie wurden'} mit dieser Verknüpfung angelegt und ${this.unnamed === 1 ? 'trägt' : 'tragen'} das Schlagwort „${MISSING_NAME_TAG}“, weil der Name nicht im Backup steht. Steht die Verbindung zu LegendKeeper, holt ein Klick in den Einstellungen unter „Alten Spielstand übernehmen“ die Namen nach.`,
      );
    if (toParty + toMembers) {
      this.adopted.push(
        `Haltungen: ${joinAnd(
          [
            toParty ? `${toParty} gegenüber der Gruppe` : '',
            toMembers ? `${toMembers} gegenüber einzelnen Gefährten` : '',
          ].filter(Boolean),
        )}.`,
      );
      this.hints.push(
        'Die alte Meinungsskala wurde so übertragen: ' +
          LEGACY_OPINIONS.map((label, i) => {
            const value = opinionToAttitude(i + 1)!;
            return `${label} → ${attitudeLabel(value)} (${value > 0 ? '+' : '−'}${Math.abs(value)})`;
          }).join(', ') +
          '. Die neue Skala hat elf Stufen von Todfeind (−5) bis Ergeben (+5); „Neutral“ (0) und die Zwischenstufen gab es in der alten Version nicht – sie stehen jetzt zum Nachschärfen bereit. War die Meinung zu allen sechs Gefährten gleich, gilt sie jetzt als Haltung gegenüber der Gruppe; abweichende Meinungen stehen bei den einzelnen Gefährten.',
      );
    }
  }

  // ── Dossier-Journal ──────────────────────────────────────────────────────

  private importJournal() {
    let notes = 0;
    let promises = 0;
    let done = 0;
    let changes = 0;
    const entries = Object.entries(obj(this.raw.dossierJournal));
    for (const [key, e] of entries) {
      const at = isObj(e) ? time(e.at) : null;
      const npc = isObj(e) ? this.npc(idOf(e.projectId), idOf(e.resourceId)) : null;
      if (!isObj(e) || at === null || !npc) {
        this.skip('Dossiereintrag', 'Dossiereinträge');
        continue;
      }
      const created =
        typeof e.createdAt === 'number' && e.createdAt > 0 && e.createdAt < 8.64e15
          ? new Date(e.createdAt).toISOString()
          : this.stamp;
      const participants = strings(e.participants)
        .map((p) => this.ids.get(`party:${p}`))
        .filter((id): id is string => !!id && this.entities.has(id));
      const everyone = participants.length === LEGACY_PARTY.length;
      const kind = idOf(e.kind);
      const body = text(e.text);
      if (kind === 'opinion') {
        const changed = Object.entries(obj(e.changes))
          .map(([person, c]) => ({
            character: this.ids.get(`party:${person}`),
            from: obj(c).from,
            to: obj(c).to,
          }))
          .filter(
            (c): c is { character: string; from: unknown; to: unknown } =>
              !!c.character && this.entities.has(c.character),
          );
        if (!changed.length) {
          this.skip('Dossiereintrag', 'Dossiereinträge');
          continue;
        }
        const same =
          changed.length === LEGACY_PARTY.length &&
          changed.every((c) => c.from === changed[0]!.from && c.to === changed[0]!.to);
        const targets = same ? [{ ...changed[0]!, character: PARTY_ID }] : changed;
        targets.forEach((c, i) => {
          const ok = this.addChronicle({
            id: this.ids.claim('chronicle', `journal:${key}:${i}`, i === 0 ? key : ''),
            kind: 'attitude',
            at,
            created,
            text: body,
            refs: [npc, c.character].filter((id) => id !== PARTY_ID),
            attitude: {
              fromId: npc,
              toId: c.character,
              before: opinionToAttitude(c.from),
              after: opinionToAttitude(c.to),
            },
          });
          if (ok) changes++;
        });
        continue;
      }
      if (!body || !(kind === 'note' || kind in JOURNAL_PREFIX)) {
        this.skip('Dossiereintrag', 'Dossiereinträge');
        continue;
      }
      const isNote = kind === 'note';
      const prefix = JOURNAL_PREFIX[kind] ?? '';
      const ok = this.addChronicle({
        id: this.ids.claim('chronicle', `journal:${key}`, key),
        kind: isNote ? 'note' : 'promise',
        at,
        created,
        text: prefix ? `${prefix}: ${body}` : body,
        refs: [npc, ...(everyone ? [] : participants)],
        promise: isNote ? null : { due: time(e.dueAt), done: time(e.doneAt) !== null },
      });
      if (!ok) this.skip('Dossiereintrag', 'Dossiereinträge');
      else if (isNote) notes++;
      else {
        promises++;
        if (time(e.doneAt) !== null) done++;
      }
    }
    if (notes + promises)
      this.adopted.push(
        `Aus den Dossiers stehen ${joinAnd(
          [
            notes ? count(notes, 'Notiz', 'Notizen') : '',
            promises
              ? count(promises, 'Abmachung', 'Abmachungen') +
                (done ? ` (davon ${done} erledigt)` : '')
              : '',
          ].filter(Boolean),
        )} samt Fristen in der Chronik bei der jeweiligen Person. Zusagen, Schulden und Gefallen sind am Wort vor dem Text zu erkennen.`,
      );
    if (changes)
      this.adopted.push(
        `${count(changes, 'Haltungsänderung steht', 'Haltungsänderungen stehen')} mit Grund und Zeitpunkt in der Chronik und bilden den Verlauf bei der Person.`,
      );
  }

  // ── Timer ────────────────────────────────────────────────────────────────

  private importTimers() {
    const removed = new Set(strings(this.raw.removedTimers));
    let running = 0;
    for (const t of list(this.raw.timers)) {
      const start = isObj(t) ? time(t.start) : null;
      const end = isObj(t) ? time(t.end) : null;
      if (
        !isObj(t) ||
        !idOf(t.id) ||
        !text(t.name) ||
        start === null ||
        end === null ||
        end <= start ||
        this.legacyTimers.has(idOf(t.id))
      ) {
        this.skip('Timer', 'Timer');
        continue;
      }
      if (removed.has(idOf(t.id))) continue;
      this.legacyTimers.set(idOf(t.id), t);
      const stopped = time(t.stoppedAt);
      const participants = strings(t.participants)
        .map((p) => this.ids.get(`party:${p}`))
        .filter((id): id is string => !!id && this.entities.has(id));
      const note = [
        t.activityType === 'travel' ? 'Reise' : '',
        text(t.who) && `${t.kind === 'activity' ? 'Ausführend' : 'Wirkender'}: ${text(t.who)}`,
        text(t.target) && `Ziel / Ort: ${text(t.target)}`,
        t.concentration === true ? 'Konzentration' : '',
        stopped !== null ? `Vorzeitig beendet am ${this.dateTime(stopped)}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const done = stopped !== null || end <= this.now;
      const concentration = t.concentration === true;
      const subgroup = participants.length === LEGACY_PARTY.length ? [] : participants;
      const parsed = TimerSchema.safeParse({
        id: this.ids.claim('timers', `timer:${idOf(t.id)}`, idOf(t.id)),
        created: this.stamp,
        updated: this.stamp,
        label: text(t.name),
        // Konzentration gibt es nur bei Zaubern.
        kind: t.kind === 'activity' ? 'task' : concentration ? 'spell' : 'effect',
        start,
        end,
        refs: subgroup,
        note,
        done,
        casterId: this.whoId(text(t.who)),
        concentration,
        participants: subgroup,
      });
      if (!parsed.success) {
        this.skip('Timer', 'Timer');
        continue;
      }
      this.timers.push(parsed.data);
      if (!done) running++;
    }
    if (this.timers.length)
      this.adopted.push(
        `${count(this.timers.length, 'Timer wurde', 'Timer wurden')} übernommen` +
          (running
            ? ` (${running === 1 ? '1 läuft' : `${running} laufen`} noch)`
            : ' (alle bereits abgelaufen oder beendet)') +
          '; Wirkender, Konzentration und Teilnehmer sind eingetragen, das Ziel steht in der Notiz.',
      );
  }

  /** Gefährte oder Person mit diesem Namen – für „Wirkender“ und „Ausführend“ der alten Timer. */
  private whoId(name: string): string | null {
    const wanted = name.trim().toLocaleLowerCase('de');
    if (!wanted) return null;
    for (const entity of this.entities.values())
      if (
        (entity.kind === 'character' || entity.kind === 'person') &&
        entity.name.trim().toLocaleLowerCase('de') === wanted
      )
        return entity.id;
    return null;
  }

  // ── Ortswechsel der Gruppe ───────────────────────────────────────────────

  private importVisits() {
    const visits = list(obj(this.raw.world).visits)
      .filter((v): v is Raw => {
        const ok =
          isObj(v) && time(v.at) !== null && (v.placeId === null || !!this.placeIdOf(v.placeId));
        if (!ok) this.skip('Ortswechsel', 'Ortswechsel');
        return ok;
      })
      .sort((a, b) => time(a.at)! - time(b.at)!);
    const steps: { at: number; placeId: string | null; text: string; key: string }[] = [];
    let future = 0;
    let pending = 0;
    visits.forEach((v, index) => {
      const at = time(v.at)!;
      if (at > this.now) {
        future++;
        return;
      }
      const nextAt =
        index + 1 < visits.length ? time(visits[index + 1]!.at)! : Number.POSITIVE_INFINITY;
      const here = v.placeId === null ? null : this.placeIdOf(v.placeId);
      const travel = v.travelId ? this.legacyTimers.get(idOf(v.travelId)) : undefined;
      if (!travel) {
        steps.push({ at, placeId: here, text: '', key: `visit:${idOf(v.id) || at}` });
        return;
      }
      // Verfolgte Reise: unterwegs gilt der Reiseabschnitt, danach der Ankunftsort –
      // oder wieder der Ausgangsort, wenn die Reise abgebrochen wurde.
      const start = time(travel.start)!;
      const stopped = time(travel.stoppedAt);
      const end = stopped ?? time(travel.end)!;
      const origin = this.placeIdOf(v.originId);
      const arrival = this.placeIdOf(v.arrivalId);
      const label = text(travel.name);
      const placeAt = (t: number) =>
        t >= end ? (stopped !== null ? origin : arrival) : t < start ? origin : here;
      const textAt = (t: number) =>
        t >= end
          ? stopped !== null
            ? `Reise abgebrochen: ${label}`
            : `Ankunft: ${label}`
          : t < start
            ? ''
            : label;
      for (const t of unique([at, start, end].filter((x) => x >= at).map(String))
        .map(Number)
        .sort((a, b) => a - b)) {
        if (t >= nextAt) break;
        if (t > this.now) {
          pending++;
          break;
        }
        steps.push({
          at: t,
          placeId: placeAt(t),
          text: textAt(t),
          key: `visit:${idOf(v.id) || at}:${t}`,
        });
      }
    });
    let previous: string | null = null;
    let moves = 0;
    for (const step of steps) {
      if (step.placeId === previous) continue;
      const ok = this.addChronicle({
        id: this.ids.claim('chronicle', step.key),
        kind: 'travel',
        at: step.at,
        text: step.text,
        placeId: step.placeId,
        refs: [step.placeId, previous].filter((id): id is string => !!id),
        travel: { fromId: previous, toId: step.placeId },
      });
      if (!ok) continue;
      previous = step.placeId;
      moves++;
    }
    this.placeId = previous;
    if (moves)
      this.adopted.push(
        `${count(moves, 'Ortswechsel der Gruppe steht', 'Ortswechsel der Gruppe stehen')} in der Chronik; daraus ergeben sich die Besuche der Orte. ` +
          (previous
            ? `Die Gruppe ist jetzt in „${this.name(previous)}“.`
            : 'Der Aufenthaltsort der Gruppe ist offen.'),
      );
    if (future)
      this.hints.push(
        `${count(future, 'Ortswechsel lag', 'Ortswechsel lagen')} nach der aktuellen Weltzeit (die Uhr wurde zurückgestellt) und ${future === 1 ? 'wurde' : 'wurden'} nicht übernommen.`,
      );
    if (pending)
      this.hints.push(
        'Eine Reise der Gruppe läuft noch. Die Ankunft ist nicht eingetragen – bitte den Ort wechseln, sobald die Gruppe ankommt.',
      );
  }

  // ── Termine ──────────────────────────────────────────────────────────────

  private importEvents() {
    let repeating = 0;
    let byMonth = 0;
    let important = 0;
    let local = 0;
    for (const e of list(this.raw.events)) {
      const at = isObj(e) ? time(e.at) : null;
      if (
        !isObj(e) ||
        !text(e.title) ||
        at === null ||
        (idOf(e.id) && this.ids.get(`event:${idOf(e.id)}`))
      ) {
        this.skip('Termin', 'Termine');
        continue;
      }
      const repeat = obj(e.repeat);
      const every = int(repeat.interval);
      const unit = idOf(repeat.unit);
      const hasRepeat =
        every !== null && every >= 1 && ['day', 'week', 'month', 'year'].includes(unit);
      const duration = int(e.durationDays);
      const parsed = CalendarEventSchema.safeParse({
        id: this.ids.claim('events', `event:${idOf(e.id) || newId()}`, idOf(e.id)),
        created: this.stamp,
        updated: this.stamp,
        title: text(e.title),
        at,
        timed: e.timed === true,
        kind: e.kind === 'plan' ? 'plan' : 'world',
        details: text(e.details),
        placeId: this.placeIdOf(e.locationId),
        durationDays: duration !== null && duration >= 1 ? duration : null,
        repeat: hasRepeat ? { every, unit } : null,
        done: e.done === true,
      });
      if (!parsed.success) {
        this.skip('Termin', 'Termine');
        continue;
      }
      this.events.push(parsed.data);
      if (hasRepeat) repeating++;
      if (hasRepeat && (unit === 'month' || unit === 'year')) byMonth++;
      if (e.important === true) important++;
      if (e.category === 'local') local++;
    }
    if (this.events.length)
      this.adopted.push(
        `${count(this.events.length, 'Termin wurde', 'Termine wurden')} übernommen` +
          (repeating ? ` (davon ${repeating} mit Wiederholung)` : '') +
          ' – mit Art, Uhrzeit, Dauer, Ort und Erledigt-Haken.',
      );
    const flags = [
      important ? `„wichtig“ (${important} ${important === 1 ? 'Termin' : 'Termine'})` : '',
      local ? `„lokales Ereignis“ (${local} ${local === 1 ? 'Termin' : 'Termine'})` : '',
    ].filter(Boolean);
    if (flags.length)
      this.hints.push(
        `Die ${flags.length === 1 ? 'Kennzeichnung' : 'Kennzeichnungen'} ${joinAnd(flags)} gibt es im neuen Kalender nicht` +
          (local ? '; lokale Ereignisse sind weiter an ihrem Ort zu erkennen.' : '.'),
      );
    if (byMonth)
      this.hints.push(
        'Monatliche und jährliche Wiederholungen am 29.–31. fallen in kürzeren Monaten jetzt auf den letzten Tag des Monats; die alte Version ließ sie dort aus.',
      );
  }

  // ── Notizen und Sessions ─────────────────────────────────────────────────

  private importNotes() {
    const sessions: Session[] = [];
    let free = 0;
    let empty = 0;
    for (const n of list(this.raw.notes)) {
      if (
        !isObj(n) ||
        typeof n.title !== 'string' ||
        typeof n.body !== 'string' ||
        (idOf(n.id) && this.ids.get(`note:${idOf(n.id)}`))
      ) {
        this.skip('Notiz', 'Notizen');
        continue;
      }
      const at = time(n.at) ?? this.now;
      const title = n.title.trim();
      const match =
        /^(?:session|sitzung|spielsitzung|spielabend)\s*#?\s*(\d{1,6})\b[\s:–—·-]*(.*)$/i.exec(
          title,
        );
      if (match) {
        const parsed = SessionSchema.safeParse({
          id: this.ids.claim('sessions', `note:${idOf(n.id) || newId()}`, idOf(n.id)),
          created: this.stamp,
          updated: this.stamp,
          number: Number(match[1]),
          title: match[2]!.trim(),
          startAt: at,
          notes: n.body.trim(),
        });
        if (parsed.success) sessions.push(parsed.data);
        else this.skip('Notiz', 'Notizen');
        continue;
      }
      if (!n.body.trim()) {
        empty++;
        continue;
      }
      const added = this.addEntity({
        id: this.ids.claim('entities', `note:${idOf(n.id) || newId()}`, idOf(n.id)),
        kind: 'topic',
        name: title || 'Notiz ohne Titel',
        tagline: `Notiz aus der alten Version, angelegt am ${this.date(at)}.`,
        notes: n.body.trim(),
        topic: { category: 'Notiz' },
      });
      if (added) free++;
      else this.skip('Notiz', 'Notizen');
    }
    sessions.sort((a, b) => a.startAt - b.startAt || a.number - b.number);
    sessions.forEach((session, i) => {
      const next = sessions[i + 1];
      this.sessions.push(
        next ? { ...session, endAt: Math.max(session.startAt, next.startAt) } : session,
      );
    });
    const last = this.sessions[this.sessions.length - 1];
    this.sessionId = last?.id ?? null;
    if (last)
      this.adopted.push(
        `${count(this.sessions.length, 'Session wurde', 'Sessions wurden')} aus den Notizen mit dem Titel „Session …“ angelegt, der Notiztext steht in der Mitschrift. ` +
          `Session ${last.number} gilt als laufende Session.`,
      );
    if (free)
      this.adopted.push(
        `${count(free, 'weitere Notiz wurde', 'weitere Notizen wurden')} als Thema der Art „Notiz“ in die Welt übernommen, weil sie zu keiner Session ${free === 1 ? 'gehört' : 'gehören'}.`,
      );
    if (empty)
      this.hints.push(`${count(empty, 'leere Notiz wurde', 'leere Notizen wurden')} weggelassen.`);
  }

  /** Ordnet Chronikeinträge der Session zu, in deren Zeitraum sie fallen. */
  private assignSessions() {
    if (!this.sessions.length) return;
    let assigned = 0;
    for (let i = 0; i < this.chronicle.length; i++) {
      const entry = this.chronicle[i]!;
      const session = [...this.sessions].reverse().find((s) => s.startAt <= entry.at);
      if (!session) continue;
      this.chronicle[i] = { ...entry, sessionId: session.id };
      assigned++;
    }
    if (assigned)
      this.hints.push(
        'Die Chronikeinträge wurden anhand ihrer Weltzeit der Session zugeordnet, in deren Zeitraum sie fallen; Einträge vor der ersten Session gehören zu keiner.',
      );
  }

  /** Ort mit genau diesem Namen (ohne Rücksicht auf Groß- und Kleinschreibung), sonst null. */
  private placeByName(name: string): string | null {
    const wanted = name.trim().toLocaleLowerCase('de');
    if (!wanted) return null;
    const places = [...this.entities.values()].filter((e) => e.kind === 'place');
    const exact = places.find((p) => p.name.trim().toLocaleLowerCase('de') === wanted);
    if (exact) return exact.id;
    // Kleine Schreibunterschiede (Apostrophe, Akzente, vorangestellter Artikel: „Der Markt“ / „Markt“)
    // gelten als derselbe Ort – aber nur, wenn es genau einen solchen gibt.
    const loose = looseName(name);
    const similar = places.filter((p) => looseName(p.name) === loose);
    return loose && similar.length === 1 ? similar[0]!.id : null;
  }

  /** Ort, der mit diesem LegendKeeper-Artikel verknüpft ist („lk://resources/abc“ oder „abc“). */
  private placeByLk(uri: string): string | null {
    const resourceId = uri.replace(/^lk:\/\/resources\//, '').trim();
    if (!resourceId) return null;
    for (const entity of this.entities.values())
      if (entity.kind === 'place' && entity.lk?.resourceId === resourceId) return entity.id;
    return null;
  }

  private partyNames(legacyIds: unknown): string[] {
    return strings(legacyIds).map((id) => LEGACY_PARTY.find((p) => p.id === id)?.name ?? id);
  }

  private partyIds(legacyIds: unknown): string[] {
    return strings(legacyIds)
      .map((id) => this.ids.get(`party:${id}`))
      .filter((id): id is string => !!id && this.entities.has(id));
  }

  // ── Karten, Kartenpunkte und Routen ──────────────────────────────────────

  private importMaps() {
    const world = obj(this.raw.world);
    const library = obj(this.raw.travelLibrary);
    const scales = obj(this.raw.travelScales);
    const info = new Map<string, Raw>();
    for (const m of list(world.maps))
      if (isObj(m) && parseMapKey(idOf(m.id))) info.set(idOf(m.id), m);
    const anchors = list(library.anchors).filter(
      (a): a is Raw => isObj(a) && !!idOf(a.id) && !!parseMapKey(idOf(a.mapKey)),
    );
    const routes = list(library.routes);
    const keys = unique([
      ...info.keys(),
      ...anchors.map((a) => idOf(a.mapKey)),
      ...routes.map((r) => (isObj(r) && parseMapKey(idOf(r.mapKey)) ? idOf(r.mapKey) : '')),
    ]);

    let scaled = 0;
    for (const key of keys) {
      const lk = parseMapKey(key)!;
      const m = info.get(key) ?? {};
      const placeId = this.placeIdOf(m.placeId);
      const frame = frameOf(m.frame) ?? frameOf(anchors.find((a) => idOf(a.mapKey) === key)?.frame);
      const kmPerUnit = this.mapScale(scales, key, lk, frame);
      if (kmPerUnit) scaled++;
      const notes = [
        idOf(m.kind) === 'city' ? 'Stadtkarte' : idOf(m.kind) === 'region' ? 'Regionalkarte' : '',
        idOf(m.environment) === 'underdark' ? 'im Unterreich' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const parsed = MapSchema.safeParse({
        id: this.ids.claim('maps', `map:${key}`, `${lk.resourceId}-${lk.docId}`),
        created: this.stamp,
        updated: this.stamp,
        name: this.name(placeId) || `Karte ${lk.resourceId}`,
        lk,
        placeId,
        frame,
        scale: kmPerUnit ? { kmPerUnit } : null,
        notes: notes ? `${notes} (laut alter Version).` : '',
      });
      if (parsed.success) this.maps.set(key, parsed.data);
      else this.skip('Karte', 'Karten');
    }

    // Kartenpunkte: Marker auf der Karte, verbunden mit dem Ort, sofern bekannt.
    const anchorById = new Map<string, Raw>();
    const anchorPlace = new Map<string, string | null>();
    const markerOf = new Map<string, { mapKey: string; markerId: string }>();
    let markers = 0;
    let deleted = 0;
    for (const a of anchors) {
      const anchorId = idOf(a.id);
      if (anchorById.has(anchorId)) continue;
      anchorById.set(anchorId, a);
      const map = this.maps.get(idOf(a.mapKey));
      const point = pointOf(a.point);
      anchorPlace.set(
        anchorId,
        this.placeIdOf(a.placeId) ??
          this.placeByLk(text(a.sourceUri)) ??
          this.placeByName(text(a.name)),
      );
      if (!map || !point) {
        this.skip('Kartenpunkt', 'Kartenpunkte');
        continue;
      }
      if (a.deleted === true) {
        deleted++;
        continue;
      }
      const [x, y] = toFrame(point, frameOf(a.frame), map.frame);
      const markerId = newId();
      map.markers.push({
        id: markerId,
        x,
        y,
        entityId: anchorPlace.get(anchorId) ?? null,
        lkFeatureId: idOf(a.sourceId) || null,
        label: text(a.name),
        articleId: null,
      });
      markerOf.set(anchorId, { mapKey: idOf(a.mapKey), markerId });
      markers++;
    }

    // Routen werden zu Wegen zwischen zwei Orten. Kartenpunkte ohne Ort bekommen einen.
    const newPlaces: string[] = [];
    const placeOfAnchor = (anchorId: string): string | null => {
      const known = anchorPlace.get(anchorId);
      if (known) return known;
      const a = anchorById.get(anchorId);
      if (!a || !text(a.name)) return null;
      const map = this.maps.get(idOf(a.mapKey));
      const added = this.addEntity({
        id: this.ids.claim('entities', `anchor:${anchorId}`),
        kind: 'place',
        name: text(a.name),
        tagline: 'Kartenpunkt aus der alten Version.',
        place: { parentId: map?.placeId ?? null, category: 'Kartenpunkt' },
      });
      if (!added) return null;
      anchorPlace.set(anchorId, added.id);
      newPlaces.push(added.name);
      const marker = markerOf.get(anchorId);
      const onMap = marker && this.maps.get(marker.mapKey);
      if (onMap)
        onMap.markers = onMap.markers.map((mk) =>
          mk.id === marker.markerId ? { ...mk, entityId: added.id } : mk,
        );
      return added.id;
    };
    let paths = 0;
    for (const r of routes) {
      if (!isObj(r) || !idOf(r.id)) {
        this.skip('Route', 'Routen');
        continue;
      }
      const mapKey = idOf(r.mapKey);
      const map = this.maps.get(mapKey);
      const fromId = placeOfAnchor(idOf(r.startId));
      const toId = placeOfAnchor(idOf(r.endId));
      if (!fromId || !toId || fromId === toId) {
        this.skip('Route ohne lesbaren Start oder Ziel', 'Routen ohne lesbaren Start oder Ziel');
        continue;
      }
      const m = info.get(mapKey) ?? {};
      const terrain =
        idOf(m.kind) === 'city'
          ? 'urban'
          : idOf(m.environment) === 'underdark'
            ? 'underdark'
            : undefined;
      const parsed = PathSchema.safeParse({
        id: this.ids.claim('paths', `route:${idOf(r.id)}`, idOf(r.id)),
        created: this.stamp,
        updated: this.stamp,
        fromId,
        toId,
        name: text(r.name),
        terrain,
        mapId: map?.id ?? null,
        points: list(r.points)
          .map(pointOf)
          .filter((p): p is MapPoint => p !== null)
          .map((p) => toFrame(p, frameOf(r.frame), map?.frame ?? null)),
      });
      if (!parsed.success) {
        this.skip('Route', 'Routen');
        continue;
      }
      this.paths.push(parsed.data);
      paths++;
    }

    if (this.maps.size)
      this.adopted.push(
        `${count(this.maps.size, 'Karte wurde', 'Karten wurden')} mit LegendKeeper-Verweis übernommen` +
          (scaled ? ` (${scaled === 1 ? 'eine' : scaled} mit Maßstab)` : '') +
          (markers ? `, dazu ${count(markers, 'Kartenpunkt', 'Kartenpunkte')}` : '') +
          (paths
            ? ` und ${count(paths, 'gespeicherte Route', 'gespeicherte Routen')} als Wege`
            : '') +
          '. Der Verlauf der Routen liegt auf der Karte; die Länge berechnet Wayfarer aus dem Maßstab.',
      );
    if (newPlaces.length)
      this.hints.push(
        `${count(newPlaces.length, 'Kartenpunkt', 'Kartenpunkte')} ohne Ort in der alten Version (${joinAnd(newPlaces)}) ${newPlaces.length === 1 ? 'wurde' : 'wurden'} als Ort der Art „Kartenpunkt“ angelegt, damit die Routen daran hängen.`,
      );
    if (paths)
      this.hints.push(
        'Das Gelände der Wege ist aus der Karte abgeleitet (Stadtkarte: Stadt, Unterreich: Unterreich, sonst Grasland) – bitte bei Gelegenheit prüfen.',
      );
    if (deleted)
      this.hints.push(
        `${count(deleted, 'gelöschter Kartenpunkt wurde', 'gelöschte Kartenpunkte wurden')} weggelassen.`,
      );
  }

  /**
   * Maßstab einer Karte in km je Karteneinheit. Die alte Version speicherte ihn unter
   * „elaris-travel-scale:<resourceId>:<docId>:<Breite>x<Höhe>“ – in km je Pixel dieses Bildformats.
   */
  private mapScale(
    scales: Raw,
    key: string,
    lk: { resourceId: string; docId: string },
    frame: Frame | null,
  ): number | null {
    const direct = num(scales[key]);
    if (direct && direct > 0) return direct;
    const prefix = `elaris-travel-scale:${lk.resourceId}:${lk.docId}:`;
    for (const [name, value] of Object.entries(scales)) {
      const km = num(value);
      if (!name.startsWith(prefix) || !km || km <= 0) continue;
      const [w] = name
        .slice(prefix.length)
        .split('x')
        .map((n) => Number(n));
      // Anderes Bildformat: auf die Breite der Karte umrechnen.
      return frame && w && w > 0 && w !== frame.width ? (km * w) / frame.width : km;
    }
    return null;
  }

  // ── Erkundungen ──────────────────────────────────────────────────────────

  private importExplorations() {
    let areas = 0;
    let tables = 0;
    for (const e of Object.values(obj(this.raw.explorations))) {
      if (!isObj(e) || !idOf(e.id) || !text(e.name)) {
        this.skip('Erkundung', 'Erkundungen');
        continue;
      }
      const name = text(e.name);
      const tableIds = new Map<string, string[]>();
      for (const [profile, t] of Object.entries(obj(e.tables))) {
        if (!isObj(t)) continue;
        const label = PROFILE_LABEL[profile] ?? profile;
        const die = int(t.die);
        const dc = int(t.dc);
        const values = [
          die !== null ? `Würfel W${die}` : '',
          dc !== null ? `Schwierigkeit ${dc}` : '',
        ].filter(Boolean);
        const origin =
          `Aus der Erkundung „${name}“ der alten Version, Gebiet „${label}“.` +
          (values.length ? ` Dort eingestellt: ${values.join(', ')}.` : '');
        const ids: string[] = [];
        for (const [kind, field, title] of [
          ['encounter', 'encounters', 'Begegnungen'],
          ['discovery', 'contents', 'Entdeckungen'],
        ] as const) {
          const rows = list(t[field]).map(text);
          const entries = rows
            .map((row, i) => ({ id: newId(), min: i + 1, max: i + 1, text: row }))
            .filter((row) => row.text && row.text !== '—');
          if (!entries.length) continue;
          const parsed = RollTableSchema.safeParse({
            id: this.ids.claim('tables', `table:${idOf(e.id)}:${profile}:${kind}`),
            created: this.stamp,
            updated: this.stamp,
            name: `${title} · ${label} (${name})`,
            kind,
            die: Math.max(2, rows.length),
            entries,
            notes:
              origin +
              (rows.length > entries.length ? ' Leere Zeilen („—“) bedeuten: nichts.' : ''),
          });
          if (!parsed.success) {
            this.skip('Würfeltabelle', 'Würfeltabellen');
            continue;
          }
          this.tables.push(parsed.data);
          ids.push(parsed.data.id);
          tables++;
        }
        tableIds.set(profile, ids);
      }

      const hexes = Object.entries(obj(e.hexes)).flatMap(([key, h]) => {
        const [q, r] = key.split(',').map((n) => Number(n));
        if (!isObj(h) || !Number.isInteger(q) || !Number.isInteger(r)) return [];
        const content = text(h.content);
        const placeId = this.placeByName(content);
        const scene = obj(h.scene);
        const note = [
          !placeId && content ? content : '',
          text(h.notes),
          text(scene.description),
          text(scene.outcome) && `Ausgespielt: ${text(scene.outcome)}`,
        ]
          .filter(Boolean)
          .join('\n');
        return [
          {
            q,
            r,
            placeId,
            note,
            discovered: h.visited === true,
            tableIds: tableIds.get(idOf(h.profile)) ?? [],
          },
        ];
      });
      const route = list(e.route).length;
      const participants = this.partyNames(e.participants);
      const log = list(e.log)
        .filter((l): l is Raw => isObj(l) && time(l.at) !== null && !!text(l.text))
        .map((l) => `${this.dateTime(time(l.at)!)}: ${text(l.text).replace(/\n/g, ' · ')}`);
      const notes = [
        [
          text(e.origin) && `Von ${text(e.origin)}`,
          text(e.destination) && `nach ${text(e.destination)}`,
        ]
          .filter(Boolean)
          .join(' '),
        route ? `Geplanter Weg: ${route} Hexfelder.` : '',
        num(e.directDistanceKm) ? `Luftlinie: ${Math.round(num(e.directDistanceKm)!)} km.` : '',
        int(e.minutesPerHex) ? `Zeit je Hexfeld: ${int(e.minutesPerHex)} Min.` : '',
        participants.length ? `Teilnehmer: ${participants.join(', ')}.` : '',
        EXPLORATION_STATUS[idOf(e.status)]
          ? `Stand in der alten Version: ${EXPLORATION_STATUS[idOf(e.status)]}.`
          : '',
        log.length ? `Verlauf:\n${log.map((l) => `– ${l}`).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const parsed = AreaSchema.safeParse({
        id: this.ids.claim('areas', `area:${idOf(e.id)}`, idOf(e.id)),
        created: this.stamp,
        updated: this.stamp,
        name,
        hexKm: num(e.hexKm) && num(e.hexKm)! > 0 ? num(e.hexKm) : undefined,
        hexes,
        tableIds: [...tableIds.values()].flat(),
        notes,
      });
      if (!parsed.success) {
        this.skip('Erkundung', 'Erkundungen');
        continue;
      }
      this.areas.push(parsed.data);
      areas++;
    }
    if (areas)
      this.adopted.push(
        `${count(areas, 'Erkundung wurde', 'Erkundungen wurden')} als Erkundungsgebiet übernommen – mit den besuchten Hexfeldern, dem Verlauf als Notiz` +
          (tables
            ? ` und ${count(tables, 'Würfeltabelle', 'Würfeltabellen')} für Begegnungen und Entdeckungen`
            : '') +
          '. Ein Gebiet liegt noch auf keiner Karte; das lässt sich mit dem Bereich Karten nachholen.',
      );
  }

  // ── Rasten ───────────────────────────────────────────────────────────────

  private importRests() {
    let rests = 0;
    for (const r of Object.values(obj(this.raw.rests))) {
      const steps = (isObj(r) ? list(r.steps) : [])
        .filter((s): s is Raw => isObj(s) && time(s.at) !== null)
        .sort((a, b) => time(a.at)! - time(b.at)!);
      if (!isObj(r) || !idOf(r.id) || !steps.length) {
        this.skip('Rast', 'Rasten');
        continue;
      }
      const legacyParticipants = strings(r.participants);
      const participants = this.partyIds(r.participants);
      const start = time(steps[0]!.at)!;
      const closure = obj(r.closure);
      const closedAt = time(closure.at);
      const last = steps[steps.length - 1]!;
      const results = obj(last.results);
      const complete =
        legacyParticipants.length > 0 && legacyParticipants.every((p) => !!results[p]);
      const status =
        closedAt !== null
          ? closure.kind === 'cancelled'
            ? 'interrupted'
            : 'done'
          : complete
            ? 'done'
            : 'running';
      const end = closedAt ?? (complete ? time(last.at) : null);

      // Wachen: wer in einem Abschnitt wacht, wacht bis zum nächsten Abschnitt.
      const watches: { id: string; start: number; end: number; characterIds: string[] }[] = [];
      steps.forEach((step, i) => {
        const from = time(step.at)!;
        const until = i + 1 < steps.length ? time(steps[i + 1]!.at)! : (end ?? from);
        const watching = Object.entries(obj(step.modes))
          .filter(([, mode]) => mode === 'watch')
          .map(([id]) => this.ids.get(`party:${id}`))
          .filter((id): id is string => !!id && this.entities.has(id));
        if (!watching.length || until <= from) return;
        const previous = watches[watches.length - 1];
        if (previous && previous.end === from && previous.characterIds.join() === watching.join())
          previous.end = until;
        else watches.push({ id: newId(), start: from, end: until, characterIds: watching });
      });
      const first = steps[0]!;
      const noteId = idOf(r.noteId);
      const sessionId = noteId ? this.ids.get(`note:${noteId}`) : null;
      const note = [
        text(r.place) && `Ort laut alter Version: ${text(r.place)}`,
        first.safe === true
          ? 'sicherer Lagerplatz'
          : first.safe === false
            ? 'unsicherer Lagerplatz'
            : '',
        first.fire === true ? 'mit Feuer' : '',
        closure.kind === 'cancelled' ? 'abgebrochen' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const parsed = RestSchema.safeParse({
        id: this.ids.claim('rests', `rest:${idOf(r.id)}`, idOf(r.id)),
        created: this.stamp,
        updated: this.stamp,
        kind: r.kind === 'short' ? 'short' : 'long',
        participants: participants.length === LEGACY_PARTY.length ? [] : participants,
        placeId: this.placeByName(text(r.place)),
        sessionId: sessionId && this.sessions.some((s) => s.id === sessionId) ? sessionId : null,
        start,
        end,
        status,
        watches,
        note,
      });
      if (!parsed.success) {
        this.skip('Rast', 'Rasten');
        continue;
      }
      this.rests.push(parsed.data);
      rests++;
    }
    if (rests)
      this.adopted.push(
        `${count(rests, 'Rast wurde', 'Rasten wurden')} mit Teilnehmern, Wachen und Ausgang übernommen; Lagerplatz und Feuer stehen in der Notiz.`,
      );
  }

  // ── Berichtsteile ohne eigene Daten ──────────────────────────────────────

  private reportSky() {
    const sky = obj(this.raw.sky);
    const moons = ELARIS_CALENDAR.moons.filter((m) => time(sky[m.id]) !== null).map((m) => m.name);
    if (moons.length)
      this.adopted.push(
        `Die Mond-Kalibrierung für ${joinAnd(moons)} wurde in den Kalender übernommen.`,
      );
  }

  private reportOmitted() {
    const raw = this.raw;
    const world = obj(raw.world);
    const rooms = Object.values(obj(raw.dungeons)).reduce<number>(
      (n, d) => n + Object.keys(obj(obj(d).rooms)).length,
      0,
    );
    if (rooms)
      this.omitted.push(
        `Nicht übernommen: Stand und Notizen zu ${count(rooms, 'Dungeonraum', 'Dungeonräumen')}.`,
      );
    const assignments = list(world.wikiAssignments).length;
    if (assignments)
      this.omitted.push(
        `Nicht übernommen: ${count(assignments, 'Einordnung', 'Einordnungen')} von LegendKeeper-Artikeln (Tagging). Verknüpfte Artikel an Orten und Personen bleiben erhalten.`,
      );
    const checks = Object.values(obj(raw.characters)).reduce<number>(
      (n, c) => n + list(obj(obj(c).condition).checks).length,
      0,
    );
    if (checks)
      this.omitted.push(
        `Nicht übernommen: ${count(checks, 'Gewaltmarsch-Prüfung', 'Gewaltmarsch-Prüfungen')} und die aufgelaufene Reisezeit der Gefährten – folgt mit dem Bereich Reisen.`,
      );
    if (text(raw.lk))
      this.omitted.push(
        'Nicht übernommen: der Link zum LegendKeeper-Projekt. Die Verbindung wird in den Einstellungen unter „LegendKeeper“ neu eingerichtet.',
      );
    const unknown = Object.keys(raw).filter((key) => !KNOWN_TOP_LEVEL.has(key));
    if (unknown.length)
      this.omitted.push(
        `Nicht übernommen: unbekannte Bereiche des Backups (${unknown.join(', ')}).`,
      );
  }

  // ── Abschluss ────────────────────────────────────────────────────────────

  private finish(): ImportResult {
    const index = <T extends { id: string }>(docs: Iterable<T>): Record<string, T> =>
      Object.fromEntries([...docs].map((d) => [d.id, d]));
    const previous = time(this.raw.previous);
    const built: CampaignData = {
      campaign: CampaignMetaSchema.parse({
        id: 'campaign',
        schema: 1,
        name: 'Elaris',
        calendar: this.cal,
        created: this.stamp,
        updated: this.stamp,
      }),
      state: PlayStateSchema.parse({
        id: 'state',
        now: this.now,
        previousNow: previous !== null && previous < this.now ? previous : null,
        placeId: this.placeId,
        sessionId: this.sessionId,
        updated: this.stamp,
      }),
      ...emptyCollections(),
      entities: index(this.entities.values()),
      relations: index(this.relations.values()),
      chronicle: index(this.chronicle),
      events: index(this.events),
      sessions: index(this.sessions),
      timers: index(this.timers),
      maps: index(this.maps.values()),
      paths: index(this.paths),
      areas: index(this.areas),
      tables: index(this.tables),
      rests: index(this.rests),
    };
    const { data, repaired } = repairReferences(built);
    if (repaired)
      this.hints.push(
        `${count(repaired, 'Verweis zeigte', 'Verweise zeigten')} auf etwas, das im Backup fehlte, und ${repaired === 1 ? 'wurde' : 'wurden'} entfernt.`,
      );

    const head = `Die Weltzeit steht auf dem ${this.dateTime(this.now)}.`;
    const skipped = [...this.skippedCounts].map(([key, n]) => {
      const [one, many] = key.split('\u0000') as [string, string];
      return `Übersprungen, weil unlesbar: ${n} ${n === 1 ? one : many}.`;
    });
    const sections: ImportSections = {
      adopted: [head, ...this.adopted],
      hints: this.hints,
      omitted: this.omitted,
      skipped,
    };
    return {
      data,
      sections,
      report: [...sections.adopted, ...sections.hints, ...sections.omitted, ...sections.skipped],
    };
  }
}

/**
 * Liest ein Backup der alten Wayfarer-Version (v157) und baut daraus eine neue Kampagne –
 * ohne etwas zu merken. Für die Vorschau, bei der noch abgebrochen werden kann.
 */
export function previewV157Backup(raw: unknown): ImportResult {
  if (!isObj(raw))
    throw new Error('Diese Datei enthält keinen Spielstand der alten Wayfarer-Version.');
  if (raw.format === 'wayfarer-sicherung')
    throw new Error(
      'Das ist eine Sicherung des neuen Wayfarer. Bitte unter „Sicherung einspielen“ wählen.',
    );
  if (raw.version !== 1 || !(Array.isArray(raw.notes) || Array.isArray(raw.events) || 'now' in raw))
    throw new Error(
      'Diese Datei ist kein Backup der alten Wayfarer-Version (erwartet wird die Datei „elaris-backup-….json“).',
    );
  return new Importer(raw).run();
}

export interface AppliedImport {
  sections: ImportSections;
  /** Name der Backup-Datei, soweit bekannt. */
  fileName: string;
  /** Echte Zeit der Übernahme. */
  at: string;
}

let applied: AppliedImport | null = null;

/** Merkt sich den Bericht einer vollzogenen Übernahme, damit er in den Einstellungen nachzulesen ist. */
export function rememberImport(result: ImportResult, fileName = ''): void {
  applied = { sections: result.sections, fileName, at: nowIso() };
}

/** Bericht der letzten Übernahme seit dem Start von Wayfarer; null, wenn es keine gab. */
export function lastImport(): AppliedImport | null {
  return applied;
}

/**
 * Liest ein Backup der alten Wayfarer-Version (v157) und baut daraus eine neue Kampagne.
 * Der Bericht bleibt bis zum Schließen der App unter „Einstellungen“ einsehbar.
 */
export function importV157Backup(raw: unknown): ImportResult {
  const result = previewV157Backup(raw);
  rememberImport(result);
  return result;
}
