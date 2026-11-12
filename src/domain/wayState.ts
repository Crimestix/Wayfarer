/**
 * Zustände von Wegen, die von selbst entstehen: Das Wetter wirkt auf den Weg. Ein unbefestigter
 * Weg verschlammt bei Starkregen, einer durch nassen Grund geht dabei verloren, starker Schnee
 * macht jeden Weg im Freien beschwerlich. Das folgt eindeutig aus Wetter und Boden – deshalb
 * geschieht es einfach, ohne Meldung: Man sieht es am Weg („Zustand statt Meldung“).
 *
 * Nichts wird gespeichert: Der Zustand ergibt sich jederzeit aus dem Wetter der letzten Tage, das
 * selbst nach festen Regeln entsteht. Reine Funktionen.
 */
import { GROUNDS, groundAt } from './mapDraw';
import type { CampaignData, TravelPath } from './schema';
import { dayIndexOf } from './time/calendar';
import type { DayWeather, Level } from './weather';
import { weatherZone, zoneWeather } from './weatherZone';

/** frei – verschlammt – verschneit – verloren (nicht passierbar, bis er abtrocknet). */
export type WayStateKind = 'clear' | 'muddy' | 'snowed' | 'lost';

export interface WayCondition {
  state: WayStateKind;
  /** So viel länger dauert der Weg: 1 = wie sonst, 2 = schwieriges Gelände. */
  factor: number;
  /** „Verschlammt: Starkregen gestern“ – leer, wenn der Weg frei ist. */
  text: string;
}

export const WAY_STATE_LABEL: Record<WayStateKind, string> = {
  clear: 'frei',
  muddy: 'verschlammt',
  snowed: 'verschneit',
  lost: 'nicht passierbar',
};

const CLEAR: WayCondition = { state: 'clear', factor: 1, text: '' };

/**
 * Der Boden eines Weges: `paved` = befestigt (eine Straße, eine Gasse in der Stadt); `wet` =
 * nasser Grund (Sumpf, Moor); `firm` = alles andere im Freien; `sheltered` = unter der Erde.
 */
export type Soil = 'paved' | 'firm' | 'wet' | 'sheltered';

export function soilOf(data: Pick<CampaignData, 'maps'>, path: TravelPath): Soil {
  const map = path.mapId ? data.maps[path.mapId] : undefined;
  if (path.terrain === 'underdark' || (map?.kind === 'drawn' && map.level === 'underground'))
    return 'sheltered';
  if (path.terrain === 'urban' || path.road === 'road') return 'paved';
  if (path.terrain === 'swamp') return 'wet';
  // Auf einer gezeichneten Karte: Führt ein gutes Stück durch Sumpf, ist der Grund nass.
  if (map?.kind === 'drawn' && path.points.length >= 2) {
    let [wet, all] = [0, 0];
    for (let i = 1; i < path.points.length; i++) {
      const [a, b] = [path.points[i - 1]!, path.points[i]!];
      const parts = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 12));
      for (let k = 0; k < parts; k++) {
        const t = (k + 0.5) / parts;
        const ground = groundAt(map, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
        all++;
        if (GROUNDS[ground].terrain === 'swamp') wet++;
      }
    }
    if (all && wet / all >= 0.2) return 'wet';
  }
  return 'firm';
}

/**
 * Was für ein Weg das ist – so, wie der Spielleiter es sagt. Daraus folgt der Boden und damit,
 * was das Wetter mit dem Weg macht.
 */
export const WAY_SORTS = ['street', 'road', 'trail', 'swamp', 'underground'] as const;
export type WaySort = (typeof WAY_SORTS)[number];

export const WAY_SORT_LABEL: Record<WaySort, string> = {
  street: 'Gasse oder Straße in einer Stadt',
  road: 'Befestigte Straße',
  trail: 'Pfad oder Feldweg',
  swamp: 'Pfad durch Sumpf oder Moor',
  underground: 'Gang unter der Erde',
};

export const WAY_SORT_HINT: Record<WaySort, string> = {
  street: 'Das Wetter ändert nichts an ihm.',
  road: 'Regen macht ihr nichts; starker Schnee bremst.',
  trail: 'Verschlammt bei Starkregen, verschneit bei starkem Schnee – dann halbes Tempo.',
  swamp: 'Bei Starkregen nicht passierbar, danach noch tagelang verschlammt.',
  underground: 'Kein Wetter.',
};

export const WAY_SORT_VALUES: Record<WaySort, Pick<TravelPath, 'terrain' | 'road'>> = {
  street: { terrain: 'urban', road: 'none' },
  road: { terrain: 'grassland', road: 'road' },
  trail: { terrain: 'grassland', road: 'trail' },
  swamp: { terrain: 'swamp', road: 'trail' },
  underground: { terrain: 'underdark', road: 'none' },
};

/** Die Art eines Weges, abgelesen an Gelände und Befestigung. */
export function sortOfWay(path: Pick<TravelPath, 'terrain' | 'road'>): WaySort {
  if (path.terrain === 'underdark') return 'underground';
  if (path.terrain === 'urban') return 'street';
  if (path.terrain === 'swamp') return 'swamp';
  return path.road === 'road' ? 'road' : 'trail';
}

const RANK: Record<Level, number> = { none: 0, light: 1, heavy: 2 };
const WHEN = ['heute', 'gestern', 'vorgestern'] as const;

/** Regen und Schnee eines Tages am Weg: das Schlimmere seiner beiden Enden. */
function fall(days: (DayWeather | null)[]): { rain: Level; snow: Level } {
  let [rain, snow]: [Level, Level] = ['none', 'none'];
  for (const day of days) {
    if (!day || day.sheltered || !day.kind) continue;
    const level = day.precipitation;
    if (day.kind === 'snow') snow = RANK[level] > RANK[snow] ? level : snow;
    else rain = RANK[level] > RANK[rain] ? level : rain;
  }
  return { rain, snow };
}

const cache = new WeakMap<object, Map<string, WayCondition>>();

/**
 * Der Zustand eines Weges zu einer Weltzeit, aus dem Wetter von heute, gestern und vorgestern an
 * seinen beiden Enden:
 *
 * - Starker Schnee heute oder gestern: jeder Weg im Freien außerhalb der Stadt ist verschneit –
 *   schwieriges Gelände, halbes Tempo.
 * - Unbefestigter Weg, Starkregen heute oder gestern: verschlammt – halbes Tempo.
 * - Weg durch nassen Grund: bei Starkregen heute oder gestern nicht passierbar; war der
 *   Starkregen vorgestern oder regnet es seit zwei Tagen, ist er verschlammt.
 * - Befestigte Wege und Wege unter der Erde kümmert der Regen nicht.
 */
export function wayCondition(
  data: CampaignData,
  path: TravelPath,
  time: number = data.state.now,
): WayCondition {
  const today = dayIndexOf(time);
  let known = cache.get(data);
  if (!known) cache.set(data, (known = new Map()));
  const key = `${path.id}:${today}`;
  const hit = known.get(key);
  if (hit) return hit;

  const soil = soilOf(data, path);
  let result = CLEAR;
  if (soil !== 'sheltered') {
    const zones = [weatherZone(data, path.fromId), weatherZone(data, path.toId)];
    const days = [0, 1, 2].map((back) =>
      fall(today - back < 0 ? [] : zones.map((zone) => zoneWeather(data, zone, today - back))),
    );
    const since = (pick: (day: { rain: Level; snow: Level }) => boolean): number =>
      days.findIndex(pick);
    const heavySnow = since((day) => day.snow === 'heavy');
    const heavyRain = since((day) => day.rain === 'heavy');
    const steady = days[0]!.rain !== 'none' && days[1]!.rain !== 'none';
    if (path.terrain !== 'urban' && heavySnow >= 0 && heavySnow <= 1)
      result = {
        state: 'snowed',
        factor: 2,
        text: `Verschneit: starker Schneefall ${WHEN[heavySnow]} – halbes Tempo`,
      };
    else if (soil === 'wet' && heavyRain >= 0 && heavyRain <= 1)
      result = {
        state: 'lost',
        factor: 2,
        text: `Nicht passierbar: Starkregen ${WHEN[heavyRain]} hat den Weg durch den nassen Grund verschluckt`,
      };
    else if (soil === 'wet' && (heavyRain === 2 || steady))
      result = {
        state: 'muddy',
        factor: 2,
        text:
          heavyRain === 2
            ? 'Verschlammt: Der Grund ist vom Starkregen vorgestern noch tief – halbes Tempo'
            : 'Verschlammt: Es regnet seit Tagen auf nassen Grund – halbes Tempo',
      };
    else if (soil === 'firm' && heavyRain >= 0 && heavyRain <= 1)
      result = {
        state: 'muddy',
        factor: 2,
        text: `Verschlammt: Starkregen ${WHEN[heavyRain]} – halbes Tempo`,
      };
  }
  known.set(key, result);
  return result;
}
