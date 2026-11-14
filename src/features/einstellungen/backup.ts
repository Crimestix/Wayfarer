/**
 * Sicherung der gesamten Kampagne als eine Datei – und der Weg zurück.
 *
 * Format (Version 1): ein JSON-Objekt mit `format: "wayfarer-sicherung"`, `version`, dem
 * Zeitpunkt der Sicherung, `campaign`, `state` und je Sammlung einer Liste der Dokumente.
 * Beim Einspielen geht jedes Dokument durch sein Schema; was unlesbar ist, wird ausgelassen
 * und gemeldet, nie stillschweigend repariert.
 */
import { KIND_LABEL, KIND_LABEL_PLURAL } from '../../domain/derive';
import {
  COLLECTION_NAMES,
  COLLECTION_SCHEMAS,
  CampaignMetaSchema,
  ENTITY_KINDS,
  LATER_COLLECTIONS,
  PlayStateSchema,
  nowIso,
  type CampaignData,
  type CampaignMeta,
  type CollectionName,
  type CollectionTypes,
  type PlayState,
} from '../../domain/schema';
import { formatDateTime } from '../../domain/time/calendar';
import { repairReferences } from '../import/integrity';

export const BACKUP_FORMAT = 'wayfarer-sicherung';
export const BACKUP_VERSION = 1;

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** Echte Zeit, zu der die Sicherung entstand. */
  exportedAt: string;
  campaign: CampaignMeta;
  state: PlayState;
} & { [C in CollectionName]: CollectionTypes[C][] };

const COLLECTION_LABEL: Record<CollectionName, [one: string, many: string]> = {
  entities: ['Eintrag der Welt', 'Einträge der Welt'],
  relations: ['Beziehung', 'Beziehungen'],
  chronicle: ['Chronikeintrag', 'Chronikeinträge'],
  events: ['Termin', 'Termine'],
  sessions: ['Session', 'Sessions'],
  timers: ['Timer', 'Timer'],
  maps: ['Karte', 'Karten'],
  paths: ['Weg', 'Wege'],
  journeys: ['Reise', 'Reisen'],
  mounts: ['Reittier, Fahrzeug oder Schiff', 'Reittiere, Fahrzeuge und Schiffe'],
  climates: ['Klimazone', 'Klimazonen'],
  weather: ['Tageswetter', 'Tageswetter'],
  areas: ['Erkundungsgebiet', 'Erkundungsgebiete'],
  tables: ['Tabelle', 'Tabellen'],
  rests: ['Rast', 'Rasten'],
  articles: ['Artikel', 'Artikel'],
  atlas: ['Atlas-Teil', 'Atlas-Teile'],
  clocks: ['Uhr', 'Uhren'],
  threads: ['Faden', 'Fäden'],
  stories: ['Geschichte', 'Geschichten'],
  creatures: ['Kreatur', 'Kreaturen'],
  encounters: ['Begegnung', 'Begegnungen'],
  stocks: ['Bestand', 'Bestände'],
  runs: ['Ablauf', 'Abläufe'],
  nets: ['Wegenetz', 'Wegenetze'],
  preps: ['Abend-Vorbereitung', 'Abend-Vorbereitungen'],
  loot: ['Eintrag im Beute-Buch', 'Einträge im Beute-Buch'],
  tracks: ['Fortschrittsleiste', 'Fortschrittsleisten'],
  handouts: ['Handout', 'Handouts'],
  bastions: ['Bastion', 'Bastionen'],
  guesses: ['Vermutung', 'Vermutungen'],
  shops: ['Laden', 'Läden'],
  assortments: ['Ladenvorlage', 'Ladenvorlagen'],
  versions: ['Frühere Fassung eines Artikels', 'Frühere Fassungen der Artikel'],
};

export function createBackup(data: CampaignData, exportedAt: string = nowIso()): BackupFile {
  const byId = (docs: Readonly<Record<string, { id: string }>>) =>
    Object.values(docs).sort((a, b) => a.id.localeCompare(b.id));
  const collections = Object.fromEntries(
    COLLECTION_NAMES.map((name) => [name, byId(data[name])]),
  ) as unknown as { [C in CollectionName]: CollectionTypes[C][] };
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt,
    campaign: data.campaign,
    state: data.state,
    ...collections,
  };
}

export function serializeBackup(data: CampaignData, exportedAt?: string): string {
  return JSON.stringify(createBackup(data, exportedAt), null, 1) + '\n';
}

/**
 * „wayfarer-sicherung-elaris-2026-11-10-1405.json“ – auf macOS und Windows ein gültiger
 * Dateiname. Die Uhrzeit verhindert, dass zwei Sicherungen desselben Tages einander überschreiben.
 */
export function backupFileName(campaignName: string, date: Date = new Date()): string {
  const slug = campaignName
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
  return `wayfarer-sicherung-${slug || 'kampagne'}-${day}-${pad(date.getHours())}${pad(date.getMinutes())}.json`;
}

export interface SkippedDoc {
  /** Lesbare Bezeichnung, z. B. „Chronikeintrag 3“. */
  label: string;
  reason: string;
}

export interface RestoreResult {
  data: CampaignData;
  exportedAt: string;
  /** Dokumente der Sicherung, die nicht gelesen werden konnten. */
  skipped: SkippedDoc[];
  /** Verweise, die ins Leere zeigten und entfernt wurden. */
  repaired: number;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Prüft eine Sicherung vollständig und baut daraus den Spielstand. Wirft mit einem deutschen Satz. */
export function readBackup(raw: unknown): RestoreResult {
  if (!isObj(raw)) throw new Error('Diese Datei ist keine Wayfarer-Sicherung.');
  if (raw.format !== BACKUP_FORMAT) {
    if (raw.version === 1 && (Array.isArray(raw.notes) || Array.isArray(raw.events)))
      throw new Error(
        'Das ist ein Backup der alten Wayfarer-Version. Bitte weiter unten „Alten Spielstand übernehmen“ wählen.',
      );
    throw new Error('Diese Datei ist keine Wayfarer-Sicherung.');
  }
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1)
    throw new Error('Diese Sicherung trägt keine gültige Versionsangabe.');
  if (raw.version > BACKUP_VERSION)
    throw new Error(
      'Diese Sicherung stammt aus einer neueren Version von Wayfarer. Bitte Wayfarer aktualisieren und es dann noch einmal versuchen.',
    );

  const campaign = CampaignMetaSchema.safeParse(raw.campaign);
  if (!campaign.success)
    throw new Error(
      'Name und Kalender der Kampagne in dieser Sicherung sind unlesbar. Sie lässt sich nicht einspielen.',
    );
  const state = PlayStateSchema.safeParse(raw.state);
  if (!state.success)
    throw new Error(
      'Weltzeit und Aufenthaltsort in dieser Sicherung sind unlesbar. Sie lässt sich nicht einspielen.',
    );

  const skipped: SkippedDoc[] = [];
  const collections = {} as Record<CollectionName, Record<string, CollectionTypes[CollectionName]>>;
  for (const name of COLLECTION_NAMES) {
    const docs: Record<string, CollectionTypes[CollectionName]> = {};
    const list = raw[name];
    if (list === undefined && LATER_COLLECTIONS.includes(name)) {
      // Sicherung aus der Zeit, bevor es diesen Bereich gab: einfach leer.
    } else if (!Array.isArray(list)) {
      skipped.push({
        label: COLLECTION_LABEL[name][1],
        reason: 'Der ganze Bereich fehlt in der Sicherung.',
      });
    } else {
      const seen = new Set<string>();
      list.forEach((item, index) => {
        const label = `${COLLECTION_LABEL[name][0]} ${index + 1}`;
        const parsed = COLLECTION_SCHEMAS[name].safeParse(item);
        if (!parsed.success) {
          skipped.push({
            label: describe(label, item),
            reason: 'Die Angaben sind unvollständig oder haben eine falsche Form.',
          });
        } else if (seen.has(parsed.data.id.toLowerCase())) {
          skipped.push({ label: describe(label, item), reason: 'Die Kennung kommt doppelt vor.' });
        } else {
          seen.add(parsed.data.id.toLowerCase());
          docs[parsed.data.id] = parsed.data;
        }
      });
    }
    collections[name] = docs;
  }
  const built = {
    campaign: campaign.data,
    state: state.data,
    ...collections,
  } as unknown as CampaignData;
  const { data, repaired } = repairReferences(built);
  return {
    data,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    skipped,
    repaired,
  };
}

function describe(label: string, item: unknown): string {
  if (!isObj(item)) return label;
  const name = [item.name, item.title, item.label, item.text].find(
    (v) => typeof v === 'string' && v.trim(),
  );
  return typeof name === 'string' ? `${label} („${name.trim().slice(0, 60)}“)` : label;
}

/** Liest den Text einer Sicherungsdatei. */
export function parseBackupText(text: string): RestoreResult {
  return readBackup(parseJson(text));
}

/** JSON lesen mit verständlicher Fehlermeldung. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      'Die Datei lässt sich nicht lesen – sie ist beschädigt oder keine Wayfarer-Datei.',
    );
  }
}

export interface CampaignSummary {
  name: string;
  /** „19. Tauwind 701 AD, 21:00“ */
  worldDate: string;
  /** „7 Personen“, „6 Orte“, … – nur was vorkommt. */
  parts: string[];
}

/** Was in einem Spielstand steckt – für Rückfragen und die Anzeige unter „Sicherung“. */
export function summarize(data: CampaignData): CampaignSummary {
  const parts: string[] = [];
  const entities = Object.values(data.entities);
  for (const kind of ENTITY_KINDS) {
    const n = entities.filter((e) => e.kind === kind).length;
    if (n) parts.push(`${n} ${n === 1 ? KIND_LABEL[kind] : KIND_LABEL_PLURAL[kind]}`);
  }
  for (const name of COLLECTION_NAMES) {
    if (name === 'entities') continue;
    const n = Object.keys(data[name]).length;
    if (n) parts.push(`${n} ${COLLECTION_LABEL[name][n === 1 ? 0 : 1]}`);
  }
  return {
    name: data.campaign.name,
    worldDate: formatDateTime(data.campaign.calendar, data.state.now),
    parts,
  };
}

/** „10. November 2026, 14:05 Uhr“ für den Zeitpunkt einer Sicherung; leer, wenn unlesbar. */
export function formatRealTime(iso: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  const day = new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
  const clock = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(
    date,
  );
  return `${day}, ${clock} Uhr`;
}
