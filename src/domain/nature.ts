/**
 * Was in der Natur vorkommt: Pflanzen, Tiere und Gesteine, wie der Spielleiter sie angelegt hat –
 * und wo und wann. Feste Regeln, nichts wird erfunden: Wayfarer liest die Lebensräume (Wörter wie
 * „Wald“, „Sumpf“, „Höhle“), die Gegenden (Orte mit allem darunter) und die Jahreszeiten (Namen
 * der Jahreszeiten oder Monate des Kalenders) der Einträge und vergleicht sie mit dem Ort: seinen
 * Namen und seiner Art, seinem Klima, seiner Lage auf dem Planeten, dem Gelände eines Feldes.
 *
 * Regel für die Gegend: Wer Gegenden hat, kommt nur dort vor (der Lebensraum ist dann nur ein
 * weiterer Grund). Wer keine hat, kommt überall vor, wo sein Lebensraum passt. Wer weder das
 * eine noch das andere hat, steht nirgends von selbst. Steht das Gelände einer Stelle fest (ein
 * Feld der Hexkarte), muss auch ein Lebensraum, den Wayfarer kennt, dazu passen: Die Sumpfblume
 * der Nordmark wächst nicht auf jedem Bergfeld der Nordmark.
 */
import { byName, entitiesOfKind, placeAncestors } from './derive';
import { parseGold } from './loot';
import { coastKm, placeChain, placeGeo, planetOf, reliefOf, terrainAt } from './planet';
import type { Area, CampaignData, EntityKind, Hex, NatureEntity, Rarity, Terrain } from './schema';
import { readSeasons, seasonsAt } from './seasons';
import { fromTime, type WorldTime } from './time/calendar';
import { weatherZone } from './weatherZone';
import type { ClimatePreset } from './weather';

export const NATURE_KINDS = ['plant', 'animal', 'mineral'] as const;
export type NatureKind = (typeof NATURE_KINDS)[number];

export const isNatureKind = (kind: EntityKind): kind is NatureKind =>
  (NATURE_KINDS as readonly string[]).includes(kind);

export const isNature = (entity: { kind: EntityKind } | undefined): entity is NatureEntity =>
  !!entity && isNatureKind(entity.kind);

/** Die Angaben zur Natur eines Eintrags – gleich für Pflanze, Tier und Gestein. */
export const natureOf = (entity: NatureEntity) =>
  entity.kind === 'plant'
    ? entity.plant
    : entity.kind === 'animal'
      ? entity.animal
      : entity.mineral;

// ── Seltenheit ─────────────────────────────────────────────────────────────

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'häufig',
  uncommon: 'ungewöhnlich',
  rare: 'selten',
  'very-rare': 'sehr selten',
  legendary: 'legendär',
};

/** Reihenfolge zum Sortieren: Häufiges zuerst, ohne Angabe am Ende. */
export const rarityRank = (rarity: Rarity | ''): number =>
  rarity === '' ? 5 : ['common', 'uncommon', 'rare', 'very-rare', 'legendary'].indexOf(rarity);

/** „selten“ aus dem Steckbrief – auch „Seltenheit: sehr selten (W100)“. Null, wenn unklar. */
export function rarityFromText(text: string): Rarity | null {
  const value = plain(text).replace(/\(.*$/, '').trim();
  if (/^(sehr selten|very rare)/.test(value)) return 'very-rare';
  if (/^(legendar|legendary|einzigartig)/.test(value)) return 'legendary';
  if (/^(ungewohnlich|uncommon|gelegentlich)/.test(value)) return 'uncommon';
  if (/^(selten|rare|rar)\b/.test(value)) return 'rare';
  if (/^(haufig|gewohnlich|common|verbreitet|weit verbreitet|alltaglich|uberall)/.test(value))
    return 'common';
  return null;
}

// ── Preis ──────────────────────────────────────────────────────────────────

const COIN = /^(gm|gp|gold\w*|sm|sp|silber\w*|km|cp|kupfer\w*|pm|pp|platin\w*)$/;

/**
 * Liest einen Wert in Gold: „12“, „12,5 GM“, „5 Silber“, „3 KM“; Silber zählt ein Zehntel, Kupfer
 * ein Hundertstel, Platin zehnfach. Leer = null (keine Angabe), Unlesbares = undefined. Was nach
 * der Münze folgt („je Bund“), gehört nicht zum Wert.
 */
export function readPrice(text: string): number | null | undefined {
  const value = text.trim();
  if (!value) return null;
  const match = /^(\d[\d.,]*)\s*([\p{L}]*)\.?(?:\s|$)/u.exec(value);
  if (!match) return undefined;
  const unit = plain(match[2] ?? '');
  if (unit && !COIN.test(unit)) return undefined;
  const amount = parseGold(match[1]!);
  if (amount === null) return undefined;
  const factor = /^(sm|sp|silber)/.test(unit)
    ? 0.1
    : /^(km|cp|kupfer)/.test(unit)
      ? 0.01
      : /^(pm|pp|platin)/.test(unit)
        ? 10
        : 1;
  return Math.round(amount * factor * 100) / 100;
}

/** Ein Preis zum Ändern im Feld: „12,5“. */
export const priceText = (price: number | null): string =>
  price === null ? '' : price.toLocaleString('de-DE', { useGrouping: false });

// ── Wörter ─────────────────────────────────────────────────────────────────

/** Kleinbuchstaben ohne Akzente; „ß“ wird „ss“. */
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ein Wort zum Vergleichen: nur Buchstaben und Ziffern. */
const compact = (text: string): string => plain(text).replace(/[^a-z0-9]+/g, '');

/** Die einzelnen Wörter eines Textes, verglichen ohne Zeichen. */
const wordsOf = (text: string): string[] =>
  plain(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

// ── Lebensräume ────────────────────────────────────────────────────────────

export const HABITAT_KEYS = [
  'wald',
  'dschungel',
  'sumpf',
  'kueste',
  'meer',
  'gewaesser',
  'gebirge',
  'huegel',
  'grasland',
  'feld',
  'wueste',
  'eis',
  'hoehle',
  'unten',
  'siedlung',
] as const;
export type HabitatKey = (typeof HABITAT_KEYS)[number];

/**
 * Die Lebensräume, die Wayfarer kennt: Bezeichnung und Wortstämme. Ein Stamm trifft ein Wort,
 * wenn es gleich ist oder (ab vier Buchstaben) damit beginnt oder endet: „Mischwald“, „Wälder“.
 */
const HABITATS: Record<HabitatKey, { label: string; stems: string[] }> = {
  wald: { label: 'Wald', stems: ['wald', 'walder', 'forst', 'hain', 'geholz', 'dickicht'] },
  dschungel: { label: 'Dschungel', stems: ['dschungel', 'urwald', 'regenwald', 'tropen'] },
  sumpf: {
    label: 'Sumpf',
    stems: ['sumpf', 'sumpfe', 'moor', 'marsch', 'morast', 'fenn', 'ried', 'feuchtgebiet'],
  },
  kueste: {
    label: 'Küste',
    stems: ['kuste', 'strand', 'gestade', 'bucht', 'kap', 'hafen', 'klippe', 'klippen', 'watt'],
  },
  meer: { label: 'Meer', stems: ['meer', 'meere', 'ozean', 'hochsee', 'salzwasser'] },
  gewaesser: {
    label: 'Fluss und See',
    stems: [
      'fluss',
      'flusse',
      'strom',
      'bach',
      'see',
      'seen',
      'teich',
      'weiher',
      'tumpel',
      'ufer',
      'quelle',
      'gewasser',
      'susswasser',
    ],
  },
  gebirge: {
    label: 'Gebirge',
    stems: ['gebirg', 'berg', 'berge', 'gipfel', 'hochland', 'schlucht', 'klamm', 'hochgebirge'],
  },
  huegel: { label: 'Hügelland', stems: ['hugel', 'hugelland', 'anhohe', 'hohenzug'] },
  grasland: {
    label: 'Grasland',
    stems: ['grasland', 'steppe', 'prarie', 'savanne', 'wiese', 'wiesen', 'heide', 'ebene'],
  },
  feld: { label: 'Feld und Garten', stems: ['feld', 'felder', 'acker', 'garten', 'weinberg'] },
  wueste: { label: 'Wüste', stems: ['wuste', 'dune', 'dunen', 'oase'] },
  eis: { label: 'Eis und Schnee', stems: ['eis', 'gletscher', 'tundra', 'schnee', 'polar'] },
  hoehle: {
    label: 'Höhle',
    stems: ['hohle', 'hohlen', 'grotte', 'kaverne', 'stollen', 'mine', 'bergwerk', 'gewolbe'],
  },
  unten: {
    label: 'Unter der Erde',
    stems: ['unterreich', 'unterwelt', 'unterirdisch', 'untertage', 'unterdererde'],
  },
  siedlung: {
    label: 'Siedlung',
    stems: ['siedlung', 'stadt', 'stadte', 'dorf', 'dorfer', 'weiler', 'kanalisation'],
  },
};

export const HABITAT_LABEL: Record<HabitatKey, string> = Object.fromEntries(
  HABITAT_KEYS.map((key) => [key, HABITATS[key].label]),
) as Record<HabitatKey, string>;

/** Vorschläge für die Lebensräume im Dialog – die üblichen Wörter, kurz. */
export const HABITAT_SUGGESTIONS = [
  'Wald',
  'Sumpf',
  'Küste',
  'Meer',
  'Fluss',
  'See',
  'Gebirge',
  'Hügel',
  'Grasland',
  'Feld',
  'Wüste',
  'Eis',
  'Höhle',
  'Unter der Erde',
  'Dschungel',
  'Siedlung',
];

const hits = (stem: string, word: string): boolean =>
  word === stem || (stem.length >= 4 && (word.startsWith(stem) || word.endsWith(stem)));

/** Welche Lebensräume ein Wort meint: „Bergwald“ ist Gebirge und Wald. */
export function habitatKeysOf(text: string): HabitatKey[] {
  const candidates = [compact(text), ...wordsOf(text)].filter(Boolean);
  return HABITAT_KEYS.filter((key) =>
    HABITATS[key].stems.some((stem) => candidates.some((word) => hits(stem, word))),
  );
}

/** Das Gelände eines Feldes der Hexkarte als Lebensraum. */
export const TERRAIN_HABITATS: Record<Terrain, HabitatKey[]> = {
  grassland: ['grasland'],
  forest: ['wald'],
  hills: ['huegel'],
  mountains: ['gebirge'],
  swamp: ['sumpf'],
  desert: ['wueste'],
  arctic: ['eis'],
  coast: ['kueste'],
  water: ['gewaesser'],
  underdark: ['unten', 'hoehle'],
  urban: ['siedlung'],
};

/** Was ein Klima über die Landschaft sagt; gemäßigt, kühl und warm sagen nichts. */
const PRESET_HABITATS: Partial<Record<ClimatePreset, HabitatKey[]>> = {
  desert: ['wueste'],
  arctic: ['eis'],
  tropical: ['dschungel'],
  mountain: ['gebirge'],
  maritime: ['kueste'],
  underground: ['unten', 'hoehle'],
};

/** Höhen, ab denen eine Lage als Hügelland und als Gebirge gilt, in Metern. */
const HILLS_M = 500;
const MOUNTAINS_M = 1500;
/** Bis zu dieser Entfernung vom Meer gilt eine Lage als Küste, in km. */
const COAST_KM = 10;
/** So viele Orte der Kette zählen mit ihren Worten: der Ort und zwei darüber. */
const CHAIN_WORDS = 3;

export interface SpotHabitats {
  keys: Set<HabitatKey>;
  /** Die Wörter des Ortes (Name, Art, Schlagworte), ohne Zeichen – für eigene Lebensräume. */
  words: string[];
  underground: boolean;
}

/**
 * Die Lebensräume eines Ortes: aus Namen, Art und Schlagworten des Ortes und der zwei Orte
 * darüber, aus seinem Klima und aus seiner Lage auf dem Planeten (Wasser, Höhe, Küste). Unter
 * der Erde zählen nur die Höhle und der Ort selbst – kein Wald darüber.
 */
export function placeHabitats(data: CampaignData, placeId: string | null): SpotHabitats {
  const keys = new Set<HabitatKey>();
  const chain = placeChain(data, placeId);
  if (!chain.length) return { keys, words: [], underground: false };
  const zone = weatherZone(data, placeId);
  const underground = zone.preset === 'underground';
  const counted = underground ? chain.slice(0, 1) : chain.slice(0, CHAIN_WORDS);
  const words: string[] = [];
  for (const place of counted) {
    for (const text of [place.name, place.place.category, ...place.tags]) {
      for (const key of habitatKeysOf(text)) keys.add(key);
      words.push(...wordsOf(text));
    }
  }
  if (zone.source !== 'default' && zone.preset)
    for (const key of PRESET_HABITATS[zone.preset] ?? []) keys.add(key);
  if (!underground) {
    // Die Lage selbst – nur, wenn sie zu genau diesem Ort gehört, nicht zu einem darüber.
    const geo = placeGeo(data, placeId);
    const planet = geo?.exact ? planetOf(data) : null;
    if (geo && planet) {
      const terrain = terrainAt(planet, reliefOf(data), geo.geo);
      if (terrain.water === 'sea') keys.add('meer');
      if (terrain.water === 'lake') keys.add('gewaesser');
      if (terrain.heightM !== null && terrain.heightM >= MOUNTAINS_M) keys.add('gebirge');
      else if (terrain.heightM !== null && terrain.heightM >= HILLS_M) keys.add('huegel');
      if (!terrain.water) {
        const coast = coastKm(planet, geo.geo);
        if (coast !== null && coast <= COAST_KM) keys.add('kueste');
      }
    }
  }
  return { keys, words, underground };
}

// ── Jahreszeiten ───────────────────────────────────────────────────────────

// Die Jahreszeiten stehen in `domain/seasons.ts`; hier nur weitergereicht, wo sie schon gelesen wurden.
export {
  SEASONS,
  SEASON_LABEL,
  monthsOfChoice,
  readSeasons,
  seasonNow,
  seasonOfMonth,
  type Season,
  type SeasonReading,
} from './seasons';

// ── Was hier vorkommt ──────────────────────────────────────────────────────

export type NatureReason =
  | { kind: 'region'; placeId: string; text: string }
  | { kind: 'habitat'; word: string; text: string };

export interface NatureHit {
  entity: NatureEntity;
  /** Warum es hier vorkommen kann – die Gegend zuerst. */
  reasons: NatureReason[];
  /** Die Angaben „wann“, wenn sie es auf einen Teil des Jahres beschränken. */
  seasonal: string;
}

export interface NatureSpot {
  /** Der Ort, dessen Gegend zählt – und, ohne eigene Lebensräume, dessen Lebensräume. */
  placeId: string | null;
  /** Lebensräume der Stelle, wenn sie schon feststehen (das Gelände eines Feldes der Hexkarte). */
  habitats?: readonly HabitatKey[];
  /**
   * Zählen die Lebensräume des Ortes mit? Ohne eigene Lebensräume immer; auf einem Feld nur,
   * wenn der Ort auf dem Feld liegt – nicht, wenn er nur die Gegend der ganzen Karte ist.
   */
  placeHabitats?: boolean;
  /** Die Jahreszeit nicht beachten – für Sichten über das ganze Jahr. */
  allYear?: boolean;
}

const VERB: Record<NatureKind, (where: string | null) => string> = {
  plant: (where) => (where ? `wächst in ${where}` : 'wächst hier'),
  animal: (where) => (where ? `lebt in ${where}` : 'lebt hier'),
  mineral: (where) => (where ? `kommt in ${where} vor` : 'kommt hier vor'),
};

const KIND_ORDER: Record<NatureKind, number> = { plant: 0, animal: 1, mineral: 2 };

/**
 * Was aus den Einträgen des Spielleiters an einer Stelle vorkommen kann – jetzt, zu dieser
 * Jahreszeit. Je Eintrag mit Grund: „wächst in Krummzahn“, „passt zum Lebensraum Sumpf“.
 */
export function natureAt(
  data: CampaignData,
  spot: NatureSpot,
  now: WorldTime = data.state.now,
): NatureHit[] {
  const chain = placeChain(data, spot.placeId);
  const regions = new Map(chain.map((place, depth) => [place.id, { place, depth }]));
  const read: SpotHabitats = {
    keys: new Set(spot.habitats ?? []),
    words: [],
    underground: false,
  };
  if (spot.placeHabitats ?? !spot.habitats) {
    const own = placeHabitats(data, spot.placeId);
    for (const key of own.keys) read.keys.add(key);
    read.words.push(...own.words);
  }
  const cal = data.campaign.calendar;
  const year = seasonsAt(data, spot.placeId);
  const month = fromTime(cal, now).month;
  /** Das Gelände steht fest: Ein bekannter Lebensraum muss passen, auch in der eigenen Gegend. */
  const firm = (spot.habitats?.length ?? 0) > 0;

  const out: NatureHit[] = [];
  for (const kind of NATURE_KINDS) {
    for (const entity of entitiesOfKind(data, kind)) {
      const details = natureOf(entity);
      const reasons: NatureReason[] = [];
      // Die Gegend: der Ort selbst oder einer darüber, der nächste zuerst.
      const region = details.regionIds
        .map((id) => regions.get(id))
        .filter((hit) => hit !== undefined)
        .sort((a, b) => a.depth - b.depth)[0];
      if (details.regionIds.length && !region) continue;
      if (region)
        reasons.push({
          kind: 'region',
          placeId: region.place.id,
          text: VERB[kind](region.depth === 0 ? null : region.place.name),
        });
      let known = false;
      let fitting = false;
      for (const word of details.habitat) {
        const keys = habitatKeysOf(word);
        if (keys.length) known = true;
        const fits = keys.length
          ? keys.some((key) => read.keys.has(key))
          : ownWordFits(word, read.words);
        if (fits) {
          fitting = true;
          reasons.push({ kind: 'habitat', word, text: `passt zum Lebensraum ${word.trim()}` });
          break;
        }
      }
      if (!reasons.length || (firm && known && !fitting)) continue;
      const when = readSeasons(cal, year, details.seasons);
      if (!spot.allYear && when.months && !when.months.has(month)) continue;
      out.push({ entity, reasons, seasonal: when.months ? details.seasons.join(', ') : '' });
    }
  }
  return out.sort(
    (a, b) =>
      Number(a.reasons[0]!.kind !== 'region') - Number(b.reasons[0]!.kind !== 'region') ||
      KIND_ORDER[a.entity.kind] - KIND_ORDER[b.entity.kind] ||
      rarityRank(natureOf(a.entity).rarity) - rarityRank(natureOf(b.entity).rarity) ||
      byName(a.entity, b.entity),
  );
}

/** Ein eigenes Wort des Spielleiters („Salzwiesen“), das Wayfarer nicht kennt, im Ort wiederfinden. */
function ownWordFits(word: string, placeWords: readonly string[]): boolean {
  const key = compact(word);
  return key.length >= 4 && placeWords.some((w) => w === key || (w.length >= 4 && hits(key, w)));
}

/** Was am Ort vorkommen kann – der Ort der Gruppe am Spieltisch. */
export const natureHere = (
  data: CampaignData,
  placeId: string | null,
  now: WorldTime = data.state.now,
): NatureHit[] => (placeId ? natureAt(data, { placeId }, now) : []);

/** Der nächste Ort, der über beiden liegt (oder einer von beiden ist) – die Gegend dazwischen. */
export function commonPlace(
  data: CampaignData,
  aId: string | null,
  bId: string | null,
): string | null {
  if (!aId || !bId) return aId ?? bId;
  const above = new Set([aId, ...placeAncestors(data, aId).map((p) => p.id)]);
  for (const place of placeChain(data, bId)) if (above.has(place.id)) return place.id;
  return null;
}

/**
 * Was auf einem Feld der Hexkarte vorkommen kann: das Gelände des Feldes (und ein Fluss) als
 * Lebensraum; als Gegend der Ort auf dem Feld, sonst der nächste Ort über Start und Ziel.
 */
export function natureOnHex(
  data: CampaignData,
  area: Pick<Area, 'fromId' | 'toId' | 'biome'>,
  hex: Pick<Hex, 'terrain' | 'river' | 'placeId'>,
  now: WorldTime = data.state.now,
): NatureHit[] {
  const terrain = hex.terrain ?? area.biome;
  const habitats = new Set<HabitatKey>(terrain ? TERRAIN_HABITATS[terrain] : []);
  if (hex.river) habitats.add('gewaesser');
  const placeId = hex.placeId ?? commonPlace(data, area.fromId, area.toId);
  return natureAt(
    data,
    { placeId, habitats: [...habitats], placeHabitats: hex.placeId !== null },
    now,
  );
}

/** Die Tiere, deren Kampfwerte dieses Wesen des Bestiariums sind. */
export const animalsOfCreature = (data: Pick<CampaignData, 'entities'>, creatureId: string) =>
  Object.values(data.entities)
    .filter(
      (entity): entity is Extract<NatureEntity, { kind: 'animal' }> =>
        entity.kind === 'animal' && entity.animal.creatureId === creatureId,
    )
    .sort(byName);

/** Die Kampfwerte eines Tieres – nur, wenn das Wesen noch im Bestiarium steht. */
export const creatureOfAnimal = (
  data: Pick<CampaignData, 'creatures'>,
  animal: Extract<NatureEntity, { kind: 'animal' }>,
) => (animal.animal.creatureId ? (data.creatures[animal.animal.creatureId] ?? null) : null);
