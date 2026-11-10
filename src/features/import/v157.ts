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
  CalendarEventSchema,
  CampaignMetaSchema,
  ChronicleEntrySchema,
  EntitySchema,
  PARTY_ID,
  PlayStateSchema,
  RelationSchema,
  SessionSchema,
  TimerSchema,
  newId,
  nowIso,
  safeId,
  type CalendarEvent,
  type CampaignData,
  type ChronicleEntry,
  type Entity,
  type Relation,
  type Session,
  type Timer,
} from '../../domain/schema';
import { attitudeLabel } from '../../domain/relations';
import { formatDate, formatDateTime, isValidDate, type CalendarDef } from '../../domain/time/calendar';
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
/** Stufe, die die alte Version anzeigte, solange keine eingetragen war. */
const LEGACY_DEFAULT_LEVEL = 6;

/** Alte Meinungsskala 1–6 (0 = unbekannt gab es nur als „kein Wert“). */
export const LEGACY_OPINIONS = ['Hass', 'Abneigung', 'Skepsis', 'Wohlwollen', 'Zuneigung', 'Liebe'] as const;

/**
 * Alte Meinung (1 Hass … 6 Liebe) → neue Haltung (−3 Feindselig … +3 Ergeben).
 * Die alte Skala hatte keine neutrale Mitte, deshalb bleibt 0 unbesetzt.
 */
export function opinionToAttitude(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 6) return null;
  return value <= 3 ? value - 4 : value - 3;
}

const PLACE_KIND_LABEL: Record<string, string> = { region: 'Region', city: 'Stadt', site: '', route: 'Reiseabschnitt' };
const TOPIC_CATEGORY: Record<string, string> = {
  species: 'Spezies',
  abilities: 'Fähigkeit',
  languages: 'Sprache',
  scripts: 'Schrift',
};
const JOURNAL_PREFIX: Record<string, string> = { promise: 'Zusage', debt: 'Schuld', favor: 'Gefallen', agreement: '' };
const PROFICIENCY_KIND: Record<string, string> = {
  skill: 'Fertigkeit',
  save: 'Rettungswurf',
  tool: 'Werkzeug',
  other: 'Weitere Übung',
};
const KNOWN_TOP_LEVEL = new Set([
  'version', 'now', 'previous', 'lk', 'split', 'active', 'notes', 'events', 'sky', 'travelScales', 'travelLibrary',
  'world', 'dungeons', 'explorations', 'npcOpinions', 'npcKnowledge', 'dossierJournal', 'rests', 'removedTimers',
  'timers', 'characters',
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
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const unique = (values: string[]): string[] => [...new Set(values.filter(Boolean))];
const strings = (v: unknown): string[] => unique(list(v).map(text));
const isImageData = (v: string) => /^data:image\/(png|jpeg|webp);base64,/.test(v);

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const joinAnd = (parts: string[]): string =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;

/** Vergibt gültige, eindeutige Kennungen und merkt sich, welche alte zu welcher neuen gehört. */
type Space = 'entities' | 'relations' | 'chronicle' | 'events' | 'sessions' | 'timers';

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

  constructor(private readonly raw: Raw) {
    const moons = ELARIS_CALENDAR.moons.map((moon) => {
      const anchor = time(obj(raw.sky)[moon.id]);
      return anchor === null ? moon : { ...moon, anchor };
    });
    this.cal = { ...ELARIS_CALENDAR, moons };
    const now = time(raw.now);
    if (now === null) this.hints.push('Die Weltzeit im Backup war unlesbar; sie steht jetzt auf dem Startdatum von Elaris (17. Tauwind 701 AD, 16:00 Uhr).');
    this.now = now ?? ELARIS_START;
  }

  run(): ImportResult {
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
    this.assignSessions();
    this.reportSky();
    this.reportOmitted();
    return this.finish();
  }

  /** Ein kaputter Bereich darf den Rest nicht aufhalten. */
  private guard(label: string, fn: () => void) {
    try {
      fn();
    } catch {
      this.skip(`Bereich „${label}“ (unerwarteter Aufbau)`, `Bereiche „${label}“ (unerwarteter Aufbau)`);
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
      const extra = [init.label, init.note].filter(Boolean).join(': ');
      this.relations.set(existing.id, {
        ...existing,
        type: existing.type === 'knows' && init.type ? init.type : existing.type,
        label: existing.type === 'knows' && init.type === 'custom' ? (init.label ?? '') : existing.label,
        note: extra && !existing.note.includes(extra) ? [existing.note, extra].filter(Boolean).join(' · ') : existing.note,
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
    const parsed = ChronicleEntrySchema.safeParse({ created: this.stamp, updated: this.stamp, ...init });
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
      const placeClass = text(p.placeClass) === 'Raumcontainer' ? 'Welt / Ebene' : text(p.placeClass);
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
      (key) => !['characters', 'organizations', 'families', ...Object.keys(TOPIC_CATEGORY)].includes(key),
    );
    if (unknown.length)
      this.omitted.push(`Nicht übernommen: unbekannte Kategorien der Weltdatenbank (${unknown.join(', ')}).`);

    // Erst alle Kennungen vergeben, damit Einträge aufeinander verweisen können.
    const topics = Object.keys(TOPIC_CATEGORY).flatMap((category) =>
      this.records(category).map((r) => ({ r, category })),
    );
    for (const { r } of topics) this.ids.claim('entities', `db:${idOf(r.id)}`, idOf(r.id));
    const topicName = (legacyId: unknown) =>
      text(topics.find(({ r }) => r.id === legacyId && typeof legacyId === 'string')?.r.name);
    const topicNames = (legacyIds: unknown) => unique(list(legacyIds).map(topicName));

    const topicCounts = new Map<string, number>();
    for (const { r, category } of topics) {
      const { aliases, tags, notes, link } = this.common(r);
      const facts: string[] = [];
      if (text(r.type)) facts.push(`Art: ${text(r.type)}`);
      if (category === 'species') {
        const parent = topicName(r.parentSpeciesId);
        if (parent) facts.push(`Übergeordnete Spezies: ${parent}`);
        if (typeof r.lifespan === 'number' && Number.isFinite(r.lifespan)) facts.push(`Lebenserwartung: ${r.lifespan} Jahre`);
        const abilities = topicNames(r.abilityIds);
        if (abilities.length) facts.push(`Fähigkeiten: ${abilities.join(', ')}`);
        const excluded = topicNames(r.excludedAbilityIds);
        if (excluded.length) facts.push(`Nicht geerbte Fähigkeiten: ${excluded.join(', ')}`);
      }
      if (link) facts.push(`LegendKeeper: ${link}`);
      const added = this.addEntity({
        id: this.ids.get(`db:${idOf(r.id)}`)!,
        kind: 'topic',
        name: text(r.name),
        aliases,
        tags,
        notes: Importer.composeNotes(notes, facts),
        topic: { category: TOPIC_CATEGORY[category] },
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
        const added = this.addEntity({
          id: this.ids.claim('entities', `db:${idOf(r.id)}`, idOf(r.id)),
          kind: 'faction',
          name: text(r.name),
          aliases,
          tags: strings(r.tags),
          notes: Importer.composeNotes(notes, facts),
          faction: { category: category === 'families' ? 'Familie' : text(r.type) },
        });
        if (!added) this.skip('Eintrag der Weltdatenbank', 'Einträge der Weltdatenbank');
        else if (category === 'families') families++;
        else factions++;
      }
    }

    const parts: string[] = [];
    if (factions + families)
      parts.push(
        count(factions + families, 'Fraktion', 'Fraktionen') +
          (families ? ` (davon ${count(families, 'Familie', 'Familien')})` : ''),
      );
    const topicTotal = [...topicCounts.values()].reduce((a, b) => a + b, 0);
    if (topicTotal) {
      const kinds = [...topicCounts.keys()].map((c) =>
        c === 'species' ? 'Spezies' : c === 'abilities' ? 'Fähigkeiten' : c === 'languages' ? 'Sprachen' : 'Schriften',
      );
      parts.push(`${count(topicTotal, 'Thema', 'Themen')} (${joinAnd(kinds)})`);
    }
    if (parts.length) this.adopted.push(`Aus der Weltdatenbank: ${joinAnd(parts)}.`);
  }

  // ── Gefährten ────────────────────────────────────────────────────────────

  private importParty() {
    const characters = obj(this.raw.characters);
    const unknown = Object.keys(characters).filter((id) => !LEGACY_PARTY.some((p) => p.id === id));
    unknown.forEach(() => this.skip('Gefährte mit unbekannter Kennung', 'Gefährten mit unbekannter Kennung'));
    let clamped = 0;
    let linkedPortraits = 0;
    let withValues = 0;
    for (const member of LEGACY_PARTY) {
      const c = obj(characters[member.id]);
      if (Object.keys(c).length) withValues++;
      const facts: string[] = [];
      const level = int(c.level) ?? LEGACY_DEFAULT_LEVEL;
      if (level > 20) {
        clamped++;
        facts.push(`Stufe in der alten Version: ${level}`);
      }
      if (int(c.spellDC) !== null) facts.push(`Zauberrettungs-SG: ${int(c.spellDC)}`);
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
          ? `; für ${withValues} von ihnen standen Werte im Backup (Klasse, Stufe, Rüstungsklasse, passive Werte, Sprachen, Erschöpfung, Bild). ` +
            'Zauberrettungs-SG, Übungen und frühere Aufenthalte stehen als Text in ihren Notizen.'
          : ' – eigene Werte standen nicht im Backup, deshalb gelten Klasse und Stufe 6 wie in der alten Anzeige.'),
    );
    if (clamped)
      this.hints.push(
        `${count(clamped, 'Gefährte hatte', 'Gefährten hatten')} eine Stufe über 20; eingetragen ist Stufe 20, der alte Wert steht in den Notizen.`,
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
    const journal = Object.values(obj(this.raw.dossierJournal)).filter(isObj);
    let persons = 0;
    let merged = 0;
    let linkedPortraits = 0;
    const personRecords = this.records('characters');
    for (const r of personRecords) {
      const partyId = idOf(r.partyId);
      const member = this.ids.get(`party:${partyId}`);
      if (partyId && member && this.entities.has(member)) this.ids.alias(`db:${idOf(r.id)}`, member);
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
      if (typeof r.biologicalAge === 'number') facts.push(`Biologisches Alter: ${r.biologicalAge} Jahre`);
      const estimate = obj(r.ageEstimate);
      if (int(estimate.age) !== null) {
        const asOf = this.birthText(estimate.asOf);
        facts.push(`Geschätztes Alter: ${int(estimate.age)} Jahre${asOf ? ` (Stand ${asOf})` : ''}`);
      }
      const work = this.placeIdOf(r.workPlaceId);
      const abilities = this.names(r.abilityIds);
      if (abilities.length) facts.push(`Fähigkeiten: ${abilities.join(', ')}`);
      const languages = this.names(r.languageIds);
      const languagesAt = facts.length;
      const scripts = this.names(r.scriptIds);
      if (scripts.length) facts.push(`Schriften: ${scripts.join(', ')}`);
      if (text(dynamic.health)) facts.push(`Zustand: ${text(dynamic.health)}`);
      if (text(dynamic.goals)) facts.push(`Ziele: ${text(dynamic.goals)}`);
      if (link) facts.push(`LegendKeeper: ${link}`);
      const portrait = text(r.portrait);
      if (portrait && !isImageData(portrait)) {
        linkedPortraits++;
        facts.push(`Bild (Link): ${portrait}`);
      }
      const species = this.name(this.entityId(r.speciesId));
      const home = this.placeIdOf(r.homeId);

      const existing = this.entities.get(id);
      if (existing?.kind === 'character') {
        // Stammdaten eines Gefährten: in dessen Eintrag einarbeiten.
        if (home) facts.push(`Heimat: ${this.name(home)}`);
        if (work) facts.push(`Arbeitsort: ${this.name(work)}`);
        if (text(r.profession)) facts.push(`Beruf: ${text(r.profession)}`);
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

      if (languages.length) facts.splice(languagesAt, 0, `Sprachen: ${languages.join(', ')}`);
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
      const hasJournal = isLinked && journal.some((e) => e.projectId === project && e.resourceId === resource);
      const known = isLinked && obj(knowledge[project])[resource] === true;
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
          species,
          role: text(r.profession),
          placeId: this.placeIdOf(dynamic.locationId),
          homeId: home,
          met: known || hasJournal || group !== null || members.size > 0,
        },
      });
      if (!added) {
        this.skip('Person', 'Personen');
        continue;
      }
      persons++;
      if (work) this.relate(id, work, { type: 'resides', note: 'Arbeitsort' });
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
  }

  /** „12. Sonnfeld 660 AD“ aus { year (AD), month, day } der alten Version. */
  private birthText(value: unknown): string {
    const b = obj(value);
    const year = int(b.year);
    const month = int(b.month);
    const day = int(b.day);
    if (year === null || month === null || day === null) return '';
    const era = this.cal.eras[0]!;
    if (!isValidDate(this.cal, { year: year + era.offset, month, day, hour: 0, minute: 0 })) return '';
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
          else add(to, from, { type: 'custom', label: 'räumlich zugeordnet', note: sentence('enthält') });
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
          const faction = this.entities.get(from);
          if (faction?.kind === 'faction' && faction.faction.seatId === null && this.entities.get(to)?.kind === 'place') {
            this.entities.set(from, { ...faction, faction: { ...faction.faction, seatId: to } });
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
        created ? count(created, 'Beziehung', 'Beziehungen') + ' (Mitgliedschaften, Familie, Wirkungsgebiete, Verbindungen)' : '',
        seats ? count(seats, 'Sitz einer Fraktion', 'Sitze von Fraktionen') : '',
        parents ? count(parents, 'räumliche Zuordnung', 'räumliche Zuordnungen') + ' als übergeordneter Ort' : '',
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
      name: `Person aus LegendKeeper (${resource.slice(0, 8)})`,
      tagline: 'Der Name stand nicht im Backup – er steht im verknüpften LegendKeeper-Artikel.',
      tags: ['Name fehlt'],
      lk: { resourceId: resource, title: '' },
      person: { met: true },
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
      for (const [resource, known] of Object.entries(obj(rows))) if (known === true) this.npc(project, resource);
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
        if (value === undefined || value === party || !character || !this.entities.has(character)) continue;
        this.relate(entityId, character, { attitude: opinionToAttitude(value) });
        toMembers++;
      }
    }
    if (this.unnamed)
      this.adopted.push(
        `${count(this.unnamed, 'Person kannte', 'Personen kannte')} die alte Version nur als Verweis auf einen LegendKeeper-Artikel. ` +
          `${this.unnamed === 1 ? 'Sie wurde' : 'Sie wurden'} mit dieser Verknüpfung angelegt und ${this.unnamed === 1 ? 'trägt' : 'tragen'} das Schlagwort „Name fehlt“, weil der Name nicht im Backup steht.`,
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
          '. „Neutral“ (0) gab es in der alten Version nicht. War die Meinung zu allen sechs Gefährten gleich, gilt sie jetzt als Haltung gegenüber der Gruppe; abweichende Meinungen stehen bei den einzelnen Gefährten.',
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
      const created = typeof e.createdAt === 'number' && e.createdAt > 0 && e.createdAt < 8.64e15
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
          .filter((c): c is { character: string; from: unknown; to: unknown } => !!c.character && this.entities.has(c.character));
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
              ? count(promises, 'Abmachung', 'Abmachungen') + (done ? ` (davon ${done} erledigt)` : '')
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
        !isObj(t) || !idOf(t.id) || !text(t.name) || start === null || end === null || end <= start ||
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
      const parsed = TimerSchema.safeParse({
        id: this.ids.claim('timers', `timer:${idOf(t.id)}`, idOf(t.id)),
        created: this.stamp,
        updated: this.stamp,
        label: text(t.name),
        kind: t.kind === 'activity' ? 'task' : 'effect',
        start,
        end,
        refs: participants.length === LEGACY_PARTY.length ? [] : participants,
        note,
        done,
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
          (running ? ` (${running === 1 ? '1 läuft' : `${running} laufen`} noch)` : ' (alle bereits abgelaufen oder beendet)') +
          '; Wirkender, Ziel und Konzentration stehen in der Notiz.',
      );
  }

  // ── Ortswechsel der Gruppe ───────────────────────────────────────────────

  private importVisits() {
    const visits = list(obj(this.raw.world).visits)
      .filter((v): v is Raw => {
        const ok = isObj(v) && time(v.at) !== null && (v.placeId === null || !!this.placeIdOf(v.placeId));
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
      const nextAt = index + 1 < visits.length ? time(visits[index + 1]!.at)! : Number.POSITIVE_INFINITY;
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
        t >= end ? (stopped !== null ? `Reise abgebrochen: ${label}` : `Ankunft: ${label}`) : t < start ? '' : label;
      for (const t of unique([at, start, end].filter((x) => x >= at).map(String)).map(Number).sort((a, b) => a - b)) {
        if (t >= nextAt) break;
        if (t > this.now) {
          pending++;
          break;
        }
        steps.push({ at: t, placeId: placeAt(t), text: textAt(t), key: `visit:${idOf(v.id) || at}:${t}` });
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
          (previous ? `Die Gruppe ist jetzt in „${this.name(previous)}“.` : 'Der Aufenthaltsort der Gruppe ist offen.'),
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
      if (!isObj(e) || !text(e.title) || at === null || (idOf(e.id) && this.ids.get(`event:${idOf(e.id)}`))) {
        this.skip('Termin', 'Termine');
        continue;
      }
      const repeat = obj(e.repeat);
      const every = int(repeat.interval);
      const unit = idOf(repeat.unit);
      const hasRepeat = every !== null && every >= 1 && ['day', 'week', 'month', 'year'].includes(unit);
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
        !isObj(n) || typeof n.title !== 'string' || typeof n.body !== 'string' ||
        (idOf(n.id) && this.ids.get(`note:${idOf(n.id)}`))
      ) {
        this.skip('Notiz', 'Notizen');
        continue;
      }
      const at = time(n.at) ?? this.now;
      const title = n.title.trim();
      const match = /^session\s*#?\s*(\d{1,6})\b[\s:–—·-]*(.*)$/i.exec(title);
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
      this.sessions.push(next ? { ...session, endAt: Math.max(session.startAt, next.startAt) } : session);
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
    if (empty) this.hints.push(`${count(empty, 'leere Notiz wurde', 'leere Notizen wurden')} weggelassen.`);
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

  // ── Berichtsteile ohne eigene Daten ──────────────────────────────────────

  private reportSky() {
    const sky = obj(this.raw.sky);
    const moons = ELARIS_CALENDAR.moons.filter((m) => time(sky[m.id]) !== null).map((m) => m.name);
    if (moons.length)
      this.adopted.push(`Die Mond-Kalibrierung für ${joinAnd(moons)} wurde in den Kalender übernommen.`);
  }

  private reportOmitted() {
    const raw = this.raw;
    const world = obj(raw.world);
    const library = obj(raw.travelLibrary);
    const routes = list(library.routes).length;
    const anchors = list(library.anchors).filter((a) => isObj(a) && a.deleted !== true).length;
    const maps = list(world.maps).length;
    const scales = Object.keys(obj(raw.travelScales)).length;
    const travel = [
      routes ? count(routes, 'gespeicherte Route', 'gespeicherte Routen') : '',
      anchors ? count(anchors, 'Kartenanker', 'Kartenanker') : '',
      maps ? count(maps, 'Kartenzuordnung', 'Kartenzuordnungen') : '',
      scales ? count(scales, 'Kartenmaßstab', 'Kartenmaßstäbe') : '',
    ].filter(Boolean);
    if (travel.length) this.omitted.push(`Nicht übernommen: ${joinAnd(travel)} – folgt mit dem Bereich Reisen.`);

    const explorations = Object.keys(obj(raw.explorations)).length;
    if (explorations)
      this.omitted.push(
        `Nicht übernommen: ${count(explorations, 'Erkundung', 'Erkundungen')} mit Hexfeldern und Würfeltabellen – dafür gibt es im neuen Wayfarer noch keinen Bereich.`,
      );
    const rests = Object.keys(obj(raw.rests)).length;
    if (rests)
      this.omitted.push(
        `Nicht übernommen: ${count(rests, 'protokollierte Rast', 'protokollierte Rasten')} mit Wachen und Schlafzeiten. Die Erschöpfung der Gefährten ist übernommen.`,
      );
    const rooms = Object.values(obj(raw.dungeons)).reduce<number>(
      (n, d) => n + Object.keys(obj(obj(d).rooms)).length,
      0,
    );
    if (rooms)
      this.omitted.push(`Nicht übernommen: Stand und Notizen zu ${count(rooms, 'Dungeonraum', 'Dungeonräumen')}.`);
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
    if (unknown.length) this.omitted.push(`Nicht übernommen: unbekannte Bereiche des Backups (${unknown.join(', ')}).`);
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
      entities: index(this.entities.values()),
      relations: index(this.relations.values()),
      chronicle: index(this.chronicle),
      events: index(this.events),
      sessions: index(this.sessions),
      timers: index(this.timers),
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

/** Liest ein Backup der alten Wayfarer-Version (v157) und baut daraus eine neue Kampagne. */
export function importV157Backup(raw: unknown): ImportResult {
  if (!isObj(raw)) throw new Error('Diese Datei enthält keinen Spielstand der alten Wayfarer-Version.');
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
