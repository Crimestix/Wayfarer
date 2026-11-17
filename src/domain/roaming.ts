/**
 * Begegnungstabellen, wie der Spielleiter sie will (17. 11.): je Zeile nur „Was – Häufigkeit –
 * Wann“. Was zum Wesen gehört, steht im Bestiarium (`creature.roaming`: wie viele man trifft,
 * woran man es vorher merkt, wann es unterwegs ist) und in den Beständen (sein Bau mit den
 * Bewohnern, die noch übrig sind). Wayfarer holt es sich dort – so greift das Worldbuilding in die
 * Tabellen, ohne dass etwas zweimal eingetragen wird.
 *
 * Gewählt wird nach Häufigkeit (die Breite einer Zeile), tags und nachts nur, was dann unterwegs
 * ist; unter der Erde zählt die Tageszeit nicht. Reine Funktionen.
 */
import { creatureChain } from './creature';
import { placeSubtreeIds } from './derive';
import type { CampaignData, Creature, RollTable, Stock } from './schema';
import { MINUTES_PER_DAY } from './time/calendar';

export type Frequency = 'often' | 'sometimes' | 'rare';

/** Häufigkeit in Worten und ihr Gewicht: Häufiges kommt viermal so oft wie Seltenes. */
export const FREQUENCIES: readonly { key: Frequency; label: string; weight: number }[] = [
  { key: 'often', label: 'häufig', weight: 4 },
  { key: 'sometimes', label: 'gelegentlich', weight: 2 },
  { key: 'rare', label: 'selten', weight: 1 },
];

/** Die Häufigkeit zu einem Gewicht (eingefügte Bereiche haben auch andere Breiten). */
export function frequencyOf(weight: number): Frequency {
  if (weight >= 4) return 'often';
  if (weight >= 2) return 'sometimes';
  return 'rare';
}

export const weightOfFrequency = (key: Frequency): number =>
  FREQUENCIES.find((entry) => entry.key === key)?.weight ?? 1;

export type When = 'day' | 'night';
export const WHEN_LABEL: Record<When | 'always', string> = {
  always: 'immer',
  day: 'tags',
  night: 'nachts',
};

/** Nachts ist es von 20 bis 6 Uhr. */
export function isNightAt(at: number): boolean {
  const minute = ((at % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return minute >= 20 * 60 || minute < 6 * 60;
}

export interface Roaming {
  appearing: string;
  signs: string;
  active: When | null;
}

/** Was ein Wesen unterwegs ausmacht – eigene Angaben vor geerbten (Vorlage, Variante). */
export function roamingOf(
  data: Pick<CampaignData, 'creatures'>,
  creatureId: string | null,
): Roaming {
  const out: Roaming = { appearing: '', signs: '', active: null };
  if (!creatureId) return out;
  // Die Kette geht von der Vorlage zum Einzelnen: Spätere Angaben gelten.
  for (const link of creatureChain(data.creatures, creatureId)) {
    const own = link.roaming;
    if (own.appearing.trim()) out.appearing = own.appearing.trim();
    if (own.signs.trim()) out.signs = own.signs.trim();
    if (own.active) out.active = own.active;
  }
  return out;
}

type Row = RollTable['entries'][number];

/** Wann eine Zeile gilt: ihre eigene Angabe, sonst die des Wesens; null = immer. */
export function rowWhen(data: Pick<CampaignData, 'creatures'>, row: Row): When | null {
  return row.when ?? roamingOf(data, row.creatureId).active;
}

/** Wählt würfeln: eine Zahl von 1 bis `sides`. */
export type Roll = (sides: number) => number;

/**
 * Wählt eine Zeile nach Häufigkeit. `night`: true/false filtert nach Tageszeit, null (unter der
 * Erde) nicht. Gibt die Zeile und die Zahl der Zeilen zurück, aus denen gewählt wurde.
 */
export function pickRow(
  data: Pick<CampaignData, 'creatures'>,
  table: Pick<RollTable, 'entries'>,
  roll: Roll,
  night: boolean | null,
): { row: Row; from: number } | null {
  const rows = table.entries.filter((row) => {
    if (!row.text.trim() && !row.creatureId) return false;
    if (night === null) return true;
    const when = rowWhen(data, row);
    return when === null || (when === 'night') === night;
  });
  const total = rows.reduce((sum, row) => sum + row.max - row.min + 1, 0);
  if (!total) return null;
  let value = roll(total);
  for (const row of rows) {
    value -= row.max - row.min + 1;
    if (value <= 0) return { row, from: rows.length };
  }
  return { row: rows[rows.length - 1]!, from: rows.length };
}

/** Eine Anzahl aus „2–5“, „2-5“ oder „3“ würfeln; null, wenn nichts dasteht. */
export function rollAppearing(text: string, roll: Roll): number | null {
  const range = /^\s*(\d{1,3})\s*[–—-]\s*(\d{1,3})\s*$/.exec(text);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    const low = Math.min(a, b);
    return low + roll(Math.abs(b - a) + 1) - 1;
  }
  const one = /^\s*(\d{1,3})\s*$/.exec(text);
  return one ? Number(one[1]) : null;
}

export interface Lair {
  stock: Stock;
  /** Bewohner dieser Art, die dort noch übrig sind. */
  left: number;
}

/** Der Bau eines Wesens in einer Gegend (oder darin): ein Bestand mit Bewohnern dieser Art. */
export function lairOf(
  data: CampaignData,
  creatureId: string | null,
  regionId: string | null,
): Lair | null {
  if (!creatureId || !regionId) return null;
  const inside = placeSubtreeIds(data, regionId);
  const kin = (id: string) =>
    id === creatureId ||
    creatureChain(data.creatures, id).some((link: Creature) => link.id === creatureId);
  let best: Lair | null = null;
  for (const stock of Object.values(data.stocks)) {
    if (!stock.placeId || !inside.has(stock.placeId)) continue;
    const left = stock.groups
      .filter((group) => kin(group.creatureId))
      .reduce((sum, group) => sum + Math.max(0, group.count - group.lost), 0);
    const counted = stock.groups.some((group) => kin(group.creatureId));
    if (counted && (!best || left > best.left)) best = { stock, left };
  }
  return best;
}

export interface Meeting {
  /** Was die Tabelle sagt (oder der Name des Wesens). */
  what: string;
  count: number | null;
  signs: string;
  lair: Lair | null;
}

/** Eine gewählte Zeile mit allem, was das Bestiarium dazu weiß. */
export function meetingOf(
  data: CampaignData,
  row: Row,
  regionId: string | null,
  roll: Roll,
): Meeting {
  const creature = row.creatureId ? data.creatures[row.creatureId] : undefined;
  const roaming = roamingOf(data, row.creatureId);
  return {
    what: row.text.trim() || creature?.name || '',
    count: roaming.appearing ? rollAppearing(roaming.appearing, roll) : null,
    signs: roaming.signs,
    lair: lairOf(data, row.creatureId, regionId),
  };
}

/** „Sporenläufer (4) · vorher: zertretene Pilzhüte · aus: Brutkammer (noch 7)“. */
export function meetingLine(meeting: Meeting): string {
  return [
    `${meeting.what}${meeting.count !== null ? ` (${meeting.count})` : ''}`,
    meeting.signs ? `vorher: ${meeting.signs}` : '',
    meeting.lair
      ? `aus: ${meeting.lair.stock.name}${meeting.lair.left ? ` (noch ${meeting.lair.left})` : ' (leer)'}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}
