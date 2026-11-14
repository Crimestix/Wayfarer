/**
 * Fortbewegung: Reittiere, Fahrzeuge und Schiffe (`mounts`). Ein Fortbewegungsmittel ist ein
 * Eintrag mit Reisedaten – Tempo, Plätze, Ladung, Unterhalt, Zustand; sein Name in der Welt
 * (das Schiff „Seewind“ als Gegenstand) hängt optional über `entityId` daran. Womit die Gruppe
 * reist, steht in `state.travelBy` (null = zu Fuß).
 *
 * Nach den Reiseregeln (D&D 2024) reisen Reittiere und Fuhrwerke im Tempo der Gruppe; nur Schiffe
 * haben ein eigenes Tempo in Meilen je Stunde, das sich nach dem Reisetempo nicht richtet. Wer
 * seinem Pferd ein eigenes Tempo gibt, bekommt es. Passt ein Mittel nicht zum Weg – ein Schiff
 * an Land, eine Kutsche auf schmalem Pfad –, gibt es einen ruhigen Hinweis, nie ein Verbot:
 * Dieser Abschnitt geht dann eben zu Fuß.
 *
 * Reine Funktionen; die Dauer eines Weges rechnet `domain/ways.ts` damit.
 */
import { entityName } from './derive';
import { formatPrice } from './shop';
import type {
  CampaignData,
  Entity,
  Mount,
  MountCondition,
  MountKind,
  Pace,
  Session,
  Terrain,
  TravelPath,
} from './schema';
import { srdItem, srdMatch } from './srd/lookup';
import { SRD_TRAVEL } from './srd/travel';
import { TERRAIN_LABEL } from './terrain';
import { dayIndexOf } from './time/calendar';

export const MOUNT_KIND_LABEL: Record<MountKind, string> = {
  mount: 'Reittier',
  vehicle: 'Fahrzeug',
  ship: 'Schiff oder Boot',
};

export const MOUNT_KIND_HINT: Record<MountKind, string> = {
  mount: 'Pferd, Pony, Maultier, Kamel – reist auf Land.',
  vehicle: 'Kutsche, Wagen, Karren, Schlitten – braucht einen Weg.',
  ship: 'Schiff, Boot, Kahn, Floß – fährt auf Wasserwegen.',
};

export const MOUNT_CONDITION_LABEL: Record<MountCondition, string> = {
  ready: 'bereit',
  tired: 'erschöpft',
  damaged: 'beschädigt',
};

const KM_PER_MILE = 1.609344;
/** Stunden eines Reisetags (Regelwerk 2024): Ein Tempo „je Tag“ verteilt sich auf sie. */
export const TRAVEL_DAY_HOURS = 8;
/** Das Reisetempo der Gruppe im Verhältnis zum normalen: 2, 3 oder 4 Meilen je Stunde. */
const PACE_FACTOR: Record<Pace, number> = { slow: 2 / 3, normal: 1, fast: 4 / 3 };

/** Wie die Gruppe reist: in welchem Tempo und womit (null = zu Fuß). */
export interface Travel {
  pace: Pace;
  by: Mount | null;
}

/** Ein Reisetempo allein heißt: zu Fuß. */
export type Going = Pace | Travel;

export const travelOf = (how: Going): Travel =>
  typeof how === 'string' ? { pace: how, by: null } : how;

/** Das Mittel, mit dem die Gruppe gerade reist – null zu Fuß (oder wenn es das Mittel nicht mehr gibt). */
export function partyMeans(data: Pick<CampaignData, 'state' | 'mounts'>): Mount | null {
  const id = data.state.travelBy;
  return id ? (data.mounts[id] ?? null) : null;
}

/** Wie die Gruppe gerade reist – für Wege, Routen und Entfernungen am Tisch. */
export const partyTravel = (
  data: Pick<CampaignData, 'state' | 'mounts'>,
  pace: Pace = 'normal',
): Travel => ({ pace, by: partyMeans(data) });

/** Ein Wasserweg: Fluss, See, Meer. */
export const isWaterWay = (path: Pick<TravelPath, 'terrain'>): boolean => path.terrain === 'water';

/** Trägt das Mittel die Gruppe auf diesem Weg? Schiffe auf dem Wasser, alles andere an Land, Fliegendes überall. */
export function carries(mount: Mount, path: Pick<TravelPath, 'terrain'>): boolean {
  if (mount.flies) return true;
  return mount.kind === 'ship' ? isWaterWay(path) : !isWaterWay(path);
}

/** Gelände bremst es nicht: Schiffe auf dem Wasser und alles, was fliegt. */
export const ignoresGround = (mount: Mount): boolean => mount.flies || mount.kind === 'ship';

/** Das eingetragene Tempo in Meilen je Stunde – null, wenn keins eingetragen ist. */
export function meansMph(mount: Pick<Mount, 'pace' | 'paceUnit'>): number | null {
  if (mount.pace === null) return null;
  return mount.paceUnit === 'day' ? mount.pace / TRAVEL_DAY_HOURS : mount.pace;
}

/**
 * Wie schnell das Mittel reist, in km je Stunde – null = im Tempo der Gruppe zu Fuß. Schiffe und
 * Fliegendes halten ihr Tempo; Reittiere und Fahrzeuge mit eigenem Tempo werden beim langsamen
 * Reisen langsamer und beim schnellen schneller, wie die Gruppe zu Fuß.
 */
export function meansKmh(mount: Mount, pace: Pace = 'normal'): number | null {
  const mph = meansMph(mount);
  if (mph === null) return null;
  return mph * KM_PER_MILE * (ignoresGround(mount) ? 1 : PACE_FACTOR[pace]);
}

/** Womit ein Weg tatsächlich gegangen wird: das Mittel, wenn es den Weg trägt – sonst zu Fuß. */
export function meansOnWay(how: Going, path: Pick<TravelPath, 'terrain'>): Mount | null {
  const { by } = travelOf(how);
  return by && carries(by, path) ? by : null;
}

/** Gelände, auf dem ein Fahrzeug nur auf befestigtem Weg gut vorankommt. */
const ROUGH: ReadonlySet<Terrain> = new Set([
  'mountains',
  'swamp',
  'forest',
  'arctic',
  'desert',
  'hills',
  'underdark',
]);

/**
 * Ein ruhiger Hinweis, wenn Mittel und Weg nicht zusammenpassen – null, wenn alles passt. Nie ein
 * Verbot: Der Weg bleibt begehbar, der Spielleiter entscheidet.
 */
export function wayFit(how: Going, path: Pick<TravelPath, 'terrain' | 'road'>): string | null {
  const { by } = travelOf(how);
  const water = isWaterWay(path);
  if (!by) return water ? 'Ein Wasserweg – ohne Schiff braucht die Gruppe eine Überfahrt' : null;
  if (by.flies) return null;
  if (by.kind === 'ship')
    return water ? null : `${by.name} fährt nur auf dem Wasser – dieser Weg geht zu Fuß`;
  if (water) return `Ein Wasserweg – ${by.name} braucht ein Schiff oder eine Fähre`;
  if (by.kind === 'vehicle') {
    if (path.road === 'none' && path.terrain !== 'urban')
      return `${by.name} kommt hier schwer voran: Es gibt keinen Weg für Räder`;
    if (path.road === 'trail' && ROUGH.has(path.terrain))
      return `${by.name} kommt hier schwer voran: ein schmaler Pfad (${TERRAIN_LABEL[path.terrain]})`;
  }
  return null;
}

/**
 * Hinweise zur ganzen Reise mit einem Mittel: sein Zustand und ob die Tiere unterwegs Rast
 * brauchen. Nur Hinweise – Wayfarer bremst nichts und zieht nichts ab.
 */
export function travelNotes(how: Going, minutes: number): string[] {
  const { by } = travelOf(how);
  if (!by) return [];
  const notes: string[] = [];
  if (by.condition === 'tired') notes.push(`${by.name} ist erschöpft – eine Rast täte gut`);
  if (by.condition === 'damaged') notes.push(`${by.name} ist beschädigt`);
  if (by.kind !== 'ship' && !by.flies && minutes > TRAVEL_DAY_HOURS * 60)
    notes.push(
      by.kind === 'mount'
        ? 'Länger als ein Reisetag von acht Stunden: Die Tiere brauchen unterwegs Rast'
        : 'Länger als ein Reisetag von acht Stunden: Die Zugtiere brauchen unterwegs Rast',
    );
  return notes;
}

/** „3 Meilen je Stunde“, „40 Meilen am Tag“, „im Tempo der Gruppe“. */
export function paceText(mount: Pick<Mount, 'pace' | 'paceUnit'>): string {
  if (mount.pace === null) return 'im Tempo der Gruppe';
  const n = mount.pace.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  const miles = mount.pace === 1 ? 'Meile' : 'Meilen';
  return mount.paceUnit === 'day' ? `${n} ${miles} am Tag` : `${n} ${miles} je Stunde`;
}

/** „Reitpferd“ oder „mit Seewind“ – womit die Gruppe reist, in Worten. */
export const travelLabel = (by: Mount | null): string => (by ? by.name : 'Zu Fuß');

/** Wem es gehört, in Worten: „der Gruppe“, „Brann Eichwald“. */
export const ownerText = (data: CampaignData, mount: Pick<Mount, 'ownerId'>): string =>
  mount.ownerId ? entityName(data, mount.ownerId) : 'der Gruppe';

/** Alle Fortbewegungsmittel in Gruppen: der Gruppe, der Gefährten, anderer – je nach Name. */
export interface MeansGroup {
  key: 'party' | 'companions' | 'others';
  label: string;
  mounts: Mount[];
}

export function meansGroups(data: CampaignData): MeansGroup[] {
  const owner = (mount: Mount) => (mount.ownerId ? data.entities[mount.ownerId] : undefined);
  const byName = (a: Mount, b: Mount) =>
    entityName(data, a.ownerId).localeCompare(entityName(data, b.ownerId), 'de') ||
    a.name.localeCompare(b.name, 'de') ||
    a.id.localeCompare(b.id);
  const all = Object.values(data.mounts).sort(byName);
  const groups: MeansGroup[] = [
    {
      key: 'party',
      label: 'Der Gruppe',
      // Gehört es niemandem mehr, den es gibt, gehört es der Gruppe.
      mounts: all.filter((m) => !m.ownerId || !owner(m)),
    },
    {
      key: 'companions',
      label: 'Der Gefährten',
      mounts: all.filter((m) => owner(m)?.kind === 'character'),
    },
    {
      key: 'others',
      label: 'Anderer',
      mounts: all.filter((m) => owner(m) && owner(m)!.kind !== 'character'),
    },
  ];
  return groups.filter((group) => group.mounts.length > 0);
}

/** Der letzte Abend: die jüngste Session, die schon begonnen hat – null, wenn es keine gibt. */
export function lastEvening(data: Pick<CampaignData, 'sessions' | 'state'>): Session | null {
  let last: Session | null = null;
  for (const session of Object.values(data.sessions))
    if (session.startAt <= data.state.now && (!last || session.startAt > last.startAt))
      last = session;
  return last;
}

export interface Upkeep {
  /** Ganze Tage seit dem Beginn des letzten Abends. */
  days: number;
  /** Gold für alle Mittel zusammen. */
  gold: number;
  /** Der letzte Abend, von dem an gezählt wird. */
  since: Session;
}

/**
 * Was der Unterhalt der Mittel seit dem letzten Abend kostet – Tage mal Gold je Tag. Nur ein
 * Hinweis: Abgezogen wird nichts. null ohne Abend oder ohne eingetragenen Unterhalt.
 */
export function upkeepSince(
  data: Pick<CampaignData, 'sessions' | 'state'>,
  mounts: readonly Mount[],
): Upkeep | null {
  const since = lastEvening(data);
  const daily = mounts.reduce((sum, mount) => sum + (mount.upkeep ?? 0), 0);
  if (!since || daily <= 0) return null;
  const days = Math.max(0, dayIndexOf(data.state.now) - dayIndexOf(since.startAt));
  return { days, gold: Math.round(days * daily * 100) / 100, since };
}

/** „Unterhalt seit dem letzten Abend: 6 SM (3 Tage)“ – leer, wenn es keinen gibt. */
export function upkeepText(upkeep: Upkeep | null): string {
  if (!upkeep) return '';
  if (upkeep.days === 0) return 'Unterhalt seit dem letzten Abend: noch keiner';
  return `Unterhalt seit dem letzten Abend: ${formatPrice(upkeep.gold)} (${
    upkeep.days === 1 ? '1 Tag' : `${upkeep.days} Tage`
  })`;
}

/** Wortendungen, an denen ein Name ein Fortbewegungsmittel verrät: „Reitpferd“, „Ruderboot“. */
const WORDS: readonly [MountKind, RegExp][] = [
  [
    'ship',
    /(schiff|boot|kahn|floß|floss|galeere|kogge|barke|fähre|faehre|jolle|karavelle|kutter|segler|zille)$/,
  ],
  ['vehicle', /(kutsche|wagen|karren|karre|schlitten|fuhrwerk|droschke|sänfte)$/],
  ['mount', /(pferd|pony|maultier|esel|kamel|ross|elefant|reittier|mastiff|greif)$/],
];

function kindFromWords(...texts: string[]): MountKind | null {
  for (const text of texts) {
    const words = text
      .toLocaleLowerCase('de')
      .split(/[^\p{L}]+/u)
      .filter(Boolean);
    for (const [kind, ending] of WORDS) if (words.some((word) => ending.test(word))) return kind;
  }
  return null;
}

/** Eine Ware, aus der ein Fortbewegungsmittel werden könnte: Eintrag, Regelwerk oder Worte. */
export interface Ware {
  entityId?: string | null;
  text?: string;
  srdId?: string | null;
}

/**
 * Ob eine gekaufte Ware ein Fortbewegungsmittel ist – und mit welchen Werten es angelegt würde:
 * Zeilen des Regelwerks bringen ihre Zahlen mit (Traglast, Tempo der Schiffe, Besatzung …), ein
 * Tier der Welt wird ein Reittier, ein Gegenstand mit passender Einordnung („Schiff“) oder ein
 * passender Name das Entsprechende. null, wenn nichts darauf hindeutet. Nur ein Angebot – angelegt
 * wird erst, wenn der Spielleiter es so will.
 */
export function meansFromWare(
  data: Pick<CampaignData, 'entities'>,
  ware: Ware,
): (Partial<Mount> & { name: string; kind: MountKind }) | null {
  const entity: Entity | undefined = ware.entityId ? data.entities[ware.entityId] : undefined;
  const name = (ware.text ?? '').trim() || entity?.name || '';
  const rule = srdItem(ware.srdId) ?? (name ? srdMatch(name) : null);
  const entityId =
    entity && (entity.kind === 'item' || entity.kind === 'animal') ? entity.id : null;
  if (rule) {
    const values = SRD_TRAVEL[rule.id];
    // Sattel, Futter, Überfahrt: aus dem Regelwerk, aber kein Fortbewegungsmittel.
    if (!values) return null;
    return {
      name: name || rule.name,
      kind: values.kind,
      entityId,
      speed: values.speed ?? null,
      capacity: values.capacity ?? null,
      pace: values.mph ?? null,
      paceUnit: 'hour',
      crew: values.crew ?? null,
      passengers: values.passengers ?? null,
      cargo: values.cargo ?? null,
      flies: values.flies ?? false,
      builtIn: true,
    };
  }
  if (entity?.kind === 'animal')
    return { name, kind: kindFromWords(entity.animal.category, name) ?? 'mount', entityId };
  const category = entity?.kind === 'item' ? entity.item.category : '';
  const kind = kindFromWords(category, name);
  return kind ? { name, kind, entityId } : null;
}
