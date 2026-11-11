/**
 * Unter der Erde: Dort gibt es keinen Himmel – kein Wetter, keine Sonne, keine Monde. Was am Tisch
 * stattdessen zählt, rechnet diese Datei: wie hell es am Ort ist, wie er riecht und klingt, welche
 * Lichter der Gruppe brennen, wer im Dunkeln sieht und wie lange die Gruppe schon unten ist.
 *
 * Erzeugt wird nur Stimmung (Licht, Luft, Geräusche), nach festen Regeln und wiederholbar wie das
 * Wetter: derselbe Ort ist immer gleich hell und riecht gleich, die Geräusche wechseln mit dem Tag.
 * Wie hell ein Ort ist, kann der Spielleiter von Hand festlegen (`place.light`).
 */
import { activeParty, partyStays } from './derive';
import { placeChain } from './planet';
import { rngOf, seedOf } from './random';
import type { CampaignData, Character, Place, PlaceLight, Timer } from './schema';
import { dayIndexOf, MINUTES_PER_DAY, type WorldTime } from './time/calendar';
import { weatherZone } from './weatherZone';

/** Liegt der Ort unter der Erde? Festgelegt über das Klima oder gelesen aus den Namen. */
export const isUnderground = (data: CampaignData, placeId: string | null): boolean =>
  placeId !== null && weatherZone(data, placeId).preset === 'underground';

// ── Licht am Ort ───────────────────────────────────────────────────────────

export const LIGHT_LABEL: Record<PlaceLight, string> = {
  dark: 'Dunkelheit',
  dim: 'Dämmriges Licht',
  bright: 'Helles Licht',
};

/** Was die Helligkeit nach den Regeln bedeutet. */
export const LIGHT_RULE: Record<PlaceLight, string> = {
  dark: 'Wer weder Licht noch Dunkelsicht hat, sieht nichts und gilt als blind.',
  dim: 'Nachteil auf Würfe für Wahrnehmung, die auf Sicht beruhen.',
  bright: 'Sicht wie am Tag.',
};

export interface Surroundings {
  light: PlaceLight;
  /** Woher das Licht kommt – oder dass es keines gibt. */
  lightFrom: string;
  /** Von Hand festgelegt statt errechnet. */
  manual: boolean;
  /** Wie die Luft ist. Bleibt am selben Ort gleich. */
  air: string;
  /** Was man hört. Wechselt mit dem Tag. */
  sound: string;
  /** Der Ort, nach dem sich Licht und Luft richten. */
  place: Place;
}

const plain = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Worte, die auf Bewohner schließen lassen: Dort brennt Licht, dort ist es nie still. */
const SETTLED_WORDS =
  /stadt|siedlung|dorf|markt|hafen|festung|burg\b|tempel|taverne|gasthaus|schenke|palast|viertel|lager\b|posten|enklave|akademie|turm\b|\bhaus\b|halle\b|werkstatt|schmiede/;

const GLOW = [
  'Leuchtende Pilze an den Wänden',
  'Glimmende Flechten',
  'Schimmernde Kristalle im Gestein',
  'Ein fahles Leuchten aus dem Fels',
];
const AIR = [
  'Kühl und still',
  'Feucht und schwer',
  'Trocken und staubig',
  'Modrig',
  'Ein steter, kalter Luftzug',
  'Es riecht nach nassem Stein',
];
const SOUND_WILD = [
  'Fernes Tropfen',
  'Stille, die in den Ohren rauscht',
  'Wasser rauscht irgendwo in der Tiefe',
  'Leises Knirschen im Gestein',
  'Ein Luftzug heult durch enge Gänge',
  'Jeder Schritt hallt weit',
];
const SOUND_SETTLED = [
  'Stimmen und Schritte hallen von den Wänden',
  'Hämmern aus einer Werkstatt',
  'Gedämpftes Treiben',
  'Fernes Rufen, das der Fels verschluckt',
  'Ketten und Räder knarren',
];

/**
 * Wie es am Ort der Gruppe ist – null, wenn er nicht unter der Erde liegt. Licht und Luft hängen
 * am Ort, die Geräusche zusätzlich am Tag.
 */
export function surroundingsAt(
  data: CampaignData,
  placeId: string | null,
  now: WorldTime,
): Surroundings | null {
  if (!isUnderground(data, placeId)) return null;
  const chain = placeChain(data, placeId);
  const place = chain[0];
  if (!place) return null;
  const settled = SETTLED_WORDS.test(
    plain(`${place.name} ${place.place.category} ${place.tags.join(' ')}`),
  );
  const rng = rngOf(seedOf(data.campaign.created, 'unter-der-erde', place.id));
  // Die Reihenfolge der Würfe bleibt fest, damit ein Ort seine Luft behält.
  const air = rng.pick(AIR)!;
  const glows = rng.chance(0.28);
  const glow = rng.pick(GLOW)!;
  const daily = rngOf(
    seedOf(data.campaign.created, 'unter-der-erde', place.id, 'tag', dayIndexOf(now)),
  );
  const sound = daily.pick(settled ? SOUND_SETTLED : SOUND_WILD)!;

  // Von Hand festgelegt: am Ort selbst oder an einem Ort darüber (der nächste gilt).
  const chosen = chain.find((p) => p.place.light != null);
  if (chosen) {
    const light = chosen.place.light!;
    return {
      light,
      lightFrom: light === 'dark' ? 'Kein Licht' : 'So festgelegt',
      manual: true,
      air,
      sound,
      place,
    };
  }
  if (settled)
    return {
      light: 'dim',
      lightFrom: 'Lichter der Bewohner',
      manual: false,
      air,
      sound,
      place,
    };
  return {
    light: glows ? 'dim' : 'dark',
    lightFrom: glows ? glow : 'Kein Licht',
    manual: false,
    air,
    sound,
    place,
  };
}

// ── Lichter der Gruppe ─────────────────────────────────────────────────────

export interface LightPreset {
  id: string;
  label: string;
  minutes: number;
  /** Wie weit das Licht reicht – steht als Anmerkung an der Wirkung. */
  reach: string;
}

/** Lichtquellen nach den Regeln von 2024. */
export const LIGHT_PRESETS: readonly LightPreset[] = [
  { id: 'torch', label: 'Fackel', minutes: 60, reach: '20 Fuß hell, weitere 20 Fuß dämmrig' },
  { id: 'lantern', label: 'Laterne', minutes: 360, reach: '30 Fuß hell, weitere 30 Fuß dämmrig' },
  { id: 'candle', label: 'Kerze', minutes: 60, reach: '5 Fuß hell, weitere 5 Fuß dämmrig' },
  {
    id: 'spell',
    label: 'Zauber „Licht“',
    minutes: 60,
    reach: '20 Fuß hell, weitere 20 Fuß dämmrig',
  },
];

/** Die Lichter, die gerade brennen; das zuerst erlöschende zuerst. */
export function burningLights(data: CampaignData, now: WorldTime = data.state.now): Timer[] {
  return Object.values(data.timers)
    .filter((t) => t.kind === 'light' && !t.done && t.start <= now && t.end > now)
    .sort((a, b) => a.end - b.end || a.label.localeCompare(b.label, 'de'));
}

export interface PartySight {
  /** Gefährten mit Dunkelsicht, die weiteste zuerst. */
  sees: Character[];
  /** Gefährten ohne Dunkelsicht. */
  blind: Character[];
}

/** Wer von der Gruppe im Dunkeln sieht. */
export function partySight(data: CampaignData): PartySight {
  const party = activeParty(data).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const range = (c: Character) => c.character.darkvision ?? 0;
  return {
    sees: party.filter((c) => range(c) > 0).sort((a, b) => range(b) - range(a)),
    blind: party.filter((c) => range(c) <= 0),
  };
}

/** Ab so vielen Minuten gilt ein Licht als „geht gleich aus“. */
export const LIGHT_WARNING = 10;

export interface LightStatus {
  surroundings: Surroundings;
  lights: Timer[];
  sight: PartySight;
  /**
   * lit = ein Licht der Gruppe brennt; ambient = der Ort ist hell genug; dark = Dunkelheit ohne
   * eigenes Licht.
   */
  state: 'lit' | 'ambient' | 'dark';
  /** Ein Satz, wenn der Spielleiter jetzt etwas wissen muss; sonst null. */
  warning: string | null;
  /** Kurz, für die Leiste. */
  summary: string;
}

const names = (list: readonly Character[]): string =>
  list.length <= 1
    ? (list[0]?.name ?? '')
    : `${list
        .slice(0, -1)
        .map((c) => c.name)
        .join(', ')} und ${list[list.length - 1]!.name}`;

const minutesLabel = (minutes: number): string =>
  minutes < 60
    ? `${Math.max(1, Math.round(minutes))} Min.`
    : minutes % 60 === 0
      ? `${minutes / 60} Std.`
      : `${Math.floor(minutes / 60)} Std. ${Math.round(minutes % 60)} Min.`;

/** Wie es um das Licht der Gruppe steht – null, wenn sie nicht unter der Erde ist. */
export function lightStatus(
  data: CampaignData,
  placeId: string | null = data.state.placeId,
  now: WorldTime = data.state.now,
): LightStatus | null {
  const surroundings = surroundingsAt(data, placeId, now);
  if (!surroundings) return null;
  const lights = burningLights(data, now);
  const sight = partySight(data);
  const first = lights[0];
  if (first) {
    const left = first.end - now;
    const last = lights.length === 1;
    return {
      surroundings,
      lights,
      sight,
      state: 'lit',
      warning:
        left <= LIGHT_WARNING
          ? `${first.label} erlischt in ${minutesLabel(left)}${last ? ' – danach brennt kein Licht mehr.' : ''}`
          : null,
      summary: `${first.label} · ${minutesLabel(left)}`,
    };
  }
  if (surroundings.light !== 'dark')
    return {
      surroundings,
      lights,
      sight,
      state: 'ambient',
      warning: null,
      summary: LIGHT_LABEL[surroundings.light],
    };
  return {
    surroundings,
    lights,
    sight,
    state: 'dark',
    warning: !sight.blind.length
      ? null
      : sight.sees.length === 0 && sight.blind.length > 1
        ? 'Kein Licht: Niemand in der Gruppe sieht etwas.'
        : `Kein Licht: ${names(sight.blind)} ${sight.blind.length === 1 ? 'sieht' : 'sehen'} nichts.`,
    summary: 'Dunkelheit',
  };
}

// ── Zeit ohne Himmel ───────────────────────────────────────────────────────

/**
 * Seit wann die Gruppe ohne Unterbrechung unter der Erde ist: der Beginn des ersten Aufenthalts
 * der laufenden Folge. Null, wenn sie nicht unten ist oder die Chronik keinen Ortswechsel kennt.
 */
export function belowSince(data: CampaignData): WorldTime | null {
  if (!isUnderground(data, data.state.placeId)) return null;
  const known = new Map<string, boolean>();
  const below = (placeId: string) => {
    if (!known.has(placeId)) known.set(placeId, isUnderground(data, placeId));
    return known.get(placeId)!;
  };
  const stays = partyStays(data);
  let since: WorldTime | null = null;
  for (let i = stays.length - 1; i >= 0; i--) {
    const stay = stays[i]!;
    if (!below(stay.placeId)) break;
    since = stay.from;
  }
  return since;
}

/** „seit 12 Tagen“, „seit gestern“, „seit heute“ – in Welt-Tagen gezählt. */
export function describeBelow(since: WorldTime, now: WorldTime): string {
  const days = dayIndexOf(now) - dayIndexOf(since);
  if (days <= 0) return 'seit heute';
  if (days === 1) return 'seit gestern';
  return `seit ${days} Tagen`;
}

/** Wie spät es oben ist – die Gruppe sieht es nicht, der Spielleiter weiß es. */
export function surfaceDaytime(now: WorldTime): string {
  const hour = (now - dayIndexOf(now) * MINUTES_PER_DAY) / 60;
  if (hour < 5 || hour >= 22) return 'Nacht';
  if (hour < 8) return 'Morgen';
  if (hour < 12) return 'Vormittag';
  if (hour < 14) return 'Mittag';
  if (hour < 18) return 'Nachmittag';
  return 'Abend';
}
