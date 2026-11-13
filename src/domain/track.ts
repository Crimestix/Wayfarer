/**
 * Fortschrittsleisten: Ausbildungswege mit benannten Stufen, eine Zahl bis zu einem Ziel (Schulden,
 * Ruf), Abschnitte wie eine Uhr (Studien, Reparaturen). Reine Funktionen; geändert wird über
 * `features/fortschritt/actions.ts`, jeder Schritt steht in der Chronik.
 */
import type { CampaignData, Track } from './schema';
import { PARTY_ID } from './schema';

const number = (n: number) => n.toLocaleString('de-DE');

/** Das Ende der Leiste: letzte Stufe, Ziel oder Zahl der Abschnitte. */
export function trackMax(track: Track): number {
  if (track.kind === 'stages') return Math.max(0, track.stages.length - 1);
  if (track.kind === 'count') return track.target;
  return track.segments;
}

/** Wert innerhalb der Grenzen; Stufen und Abschnitte sind ganze Zahlen. */
export function clampTrack(track: Track, value: number): number {
  const max = trackMax(track);
  const whole = track.kind === 'count' ? Math.round(value * 100) / 100 : Math.round(value);
  return Math.min(Math.max(0, whole), max > 0 ? max : whole);
}

export interface TrackView {
  track: Track;
  /** „Dunkelgrün“, „12.000 von 50.000 Gold“, „3 von 6“. */
  current: string;
  /** Die nächste Stufe, wenn es eine gibt. */
  next: string | null;
  /** 0…1 für die Anzeige. */
  ratio: number;
  /** Stufen oder Abschnitte: je ein Kästchen, `true` = erreicht. */
  pips: boolean[];
  reached: boolean;
}

export function trackView(track: Track): TrackView {
  const max = trackMax(track);
  const value = clampTrack(track, track.value);
  const ratio = max > 0 ? value / max : 0;
  if (track.kind === 'stages') {
    const stages = track.stages.length ? track.stages : ['–'];
    return {
      track,
      current: stages[value] ?? '',
      next: stages[value + 1] ?? null,
      ratio,
      pips: stages.map((_, index) => index <= value),
      reached: value >= max,
    };
  }
  if (track.kind === 'count') {
    const unit = track.unit.trim() ? ` ${track.unit.trim()}` : '';
    return {
      track,
      current: max > 0 ? `${number(value)} von ${number(max)}${unit}` : `${number(value)}${unit}`,
      next: null,
      ratio,
      pips: [],
      reached: max > 0 && value >= max,
    };
  }
  return {
    track,
    current: `${value} von ${max}`,
    next: null,
    ratio,
    pips: Array.from({ length: max }, (_, index) => index < value),
    reached: value >= max,
  };
}

/** Ein Schritt vor (+1) oder zurück (-1) – bei einer Zahl um die Schrittweite. */
export function steppedValue(track: Track, direction: 1 | -1): number {
  const step = track.kind === 'count' ? track.step : 1;
  return clampTrack(track, track.value + direction * step);
}

/** Wie ein Schritt in der Chronik steht: „Weg zur Dunkelrobe: Dunkelgrün“. */
export function trackLine(track: Track, value: number): string {
  const view = trackView({ ...track, value });
  return `${track.name}: ${view.current}${view.reached && track.kind !== 'stages' ? ' – erreicht' : ''}`;
}

/** Die Leisten eines Eintrags (oder der Gruppe), offene zuerst. */
export function tracksOf(data: Pick<CampaignData, 'tracks'>, ownerId: string): Track[] {
  return Object.values(data.tracks)
    .filter((track) => track.ownerId === ownerId)
    .sort((a, b) => Number(a.done) - Number(b.done) || a.name.localeCompare(b.name, 'de'));
}

export interface TrackGroup {
  ownerId: string | null;
  /** „Die Gruppe“, der Name des Eintrags oder „Ohne Zuordnung“. */
  title: string;
  tracks: Track[];
}

/** Alle Leisten nach Besitzer: erst die Gruppe, dann die Gefährten, dann alle anderen nach Namen. */
export function trackGroups(data: Pick<CampaignData, 'tracks' | 'entities'>): TrackGroup[] {
  const groups = new Map<string, TrackGroup>();
  for (const track of Object.values(data.tracks)) {
    const owner = track.ownerId && (track.ownerId === PARTY_ID || data.entities[track.ownerId]);
    const key = owner ? track.ownerId! : '';
    const title =
      key === PARTY_ID ? 'Die Gruppe' : key ? data.entities[key]!.name : 'Ohne Zuordnung';
    const group = groups.get(key) ?? { ownerId: key || null, title, tracks: [] };
    group.tracks.push(track);
    groups.set(key, group);
  }
  const rank = (group: TrackGroup) =>
    group.ownerId === PARTY_ID
      ? 0
      : group.ownerId && data.entities[group.ownerId]?.kind === 'character'
        ? 1
        : group.ownerId
          ? 2
          : 3;
  for (const group of groups.values())
    group.tracks.sort(
      (a, b) => Number(a.done) - Number(b.done) || a.name.localeCompare(b.name, 'de'),
    );
  return [...groups.values()].sort(
    (a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, 'de'),
  );
}

/** Eine Zahl, wie sie ins Eingabefeld kommt: „12.000“, „1,5“ – `readAmount` liest sie zurück. */
export const amountText = (n: number) => number(n);

/** Liest eine Zahl in deutscher Schreibweise: Punkt trennt Tausender, Komma die Nachkommastellen. */
export function readAmount(text: string): number {
  const value = Number(text.trim().replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Die gewählte Stufe: ihr Name oder – solange noch keine gewählt ist – der gespeicherte Index
 * („2“); sonst die erste.
 */
export function stageIndex(stages: readonly string[], chosen: string): number {
  const named = stages.indexOf(chosen);
  if (named >= 0) return named;
  const index = Number(chosen);
  return Number.isInteger(index) && index >= 0 && index < stages.length ? index : 0;
}

/** Stufen aus Text: je Zeile oder durch „–“, „-“, „→“, „,“ getrennt. */
export function parseStages(text: string): string[] {
  return text
    .split(/\n|\s+[–—-]\s+|\s*→\s*|\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}
