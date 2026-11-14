/**
 * Das Formular eines Fortbewegungsmittels als reine Funktionen: aus dem Eintrag die Felder in
 * Worten, aus den Feldern wieder die Werte – mit dem, was nicht lesbar ist.
 */
import { formatPrice } from '../../domain/shop';
import { parseCoins } from '../../domain/priceList';
import type { Mount, MountCondition, MountKind } from '../../domain/schema';
import type { MeansInput } from './actions';

export interface MeansDraft {
  name: string;
  kind: MountKind;
  ownerId: string | null;
  entityId: string | null;
  creatureId: string | null;
  pace: string;
  paceUnit: 'hour' | 'day';
  flies: boolean;
  speed: string;
  capacity: string;
  passengers: string;
  cargo: string;
  crew: string;
  upkeep: string;
  condition: MountCondition;
  notes: string;
}

const text = (n: number | null): string =>
  n === null ? '' : n.toLocaleString('de-DE', { maximumFractionDigits: 2, useGrouping: false });

/** Die Felder eines vorhandenen Mittels – oder eines neuen mit Vorgaben. */
export function meansDraft(mount?: Partial<Mount>): MeansDraft {
  return {
    name: mount?.name ?? '',
    kind: mount?.kind ?? 'mount',
    ownerId: mount?.ownerId ?? null,
    entityId: mount?.entityId ?? null,
    creatureId: mount?.creatureId ?? null,
    pace: text(mount?.pace ?? null),
    paceUnit: mount?.paceUnit ?? 'hour',
    flies: mount?.flies ?? false,
    speed: text(mount?.speed ?? null),
    capacity: text(mount?.capacity ?? null),
    passengers: text(mount?.passengers ?? null),
    cargo: text(mount?.cargo ?? null),
    crew: text(mount?.crew ?? null),
    upkeep: mount?.upkeep ? formatPrice(mount.upkeep) : '',
    condition: mount?.condition ?? 'ready',
    notes: mount?.notes ?? '',
  };
}

/** „1,5“ → 1,5; leer → null; Unlesbares (oder unter null) → undefined. */
export function readNumber(raw: string): number | null | undefined {
  const value = raw.trim().replace(/\s+/g, '').replace(',', '.');
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const LABELS: Record<
  'pace' | 'speed' | 'capacity' | 'passengers' | 'cargo' | 'crew' | 'upkeep',
  string
> = {
  pace: 'Tempo',
  speed: 'Bewegungsrate',
  capacity: 'Traglast',
  passengers: 'Plätze',
  cargo: 'Ladung',
  crew: 'Besatzung',
  upkeep: 'Unterhalt',
};

/**
 * Die Werte aus den Feldern – oder, was sich nicht lesen lässt: „Tempo und Plätze sind keine
 * Zahlen.“ Ganze Zahlen (Plätze, Besatzung, Bewegungsrate) werden gerundet.
 */
export function meansInputOf(draft: MeansDraft): { input: MeansInput } | { problem: string } {
  if (!draft.name.trim()) return { problem: 'Wie heißt es?' };
  const bad: string[] = [];
  const read = (key: Exclude<keyof typeof LABELS, 'upkeep'>, whole = false) => {
    const n = readNumber(draft[key]);
    if (n === undefined) bad.push(LABELS[key]);
    return n === undefined || n === null ? null : whole ? Math.round(n) : n;
  };
  const pace = read('pace');
  const values = {
    speed: read('speed', true),
    capacity: read('capacity'),
    passengers: read('passengers', true),
    cargo: read('cargo'),
    crew: read('crew', true),
  };
  const upkeep = parseCoins(draft.upkeep);
  if (upkeep === undefined) bad.push(LABELS.upkeep);
  if (bad.length)
    return {
      problem: `${bad.length === 1 ? bad[0] : `${bad.slice(0, -1).join(', ')} und ${bad[bad.length - 1]}`} ${bad.length === 1 ? 'ist keine Zahl' : 'sind keine Zahlen'}.`,
    };
  return {
    input: {
      name: draft.name,
      kind: draft.kind,
      ownerId: draft.ownerId,
      entityId: draft.entityId,
      creatureId: draft.creatureId,
      // Ein Tempo von null wäre Stillstand: Es heißt „im Tempo der Gruppe“.
      pace: pace === 0 ? null : pace,
      paceUnit: draft.paceUnit,
      flies: draft.flies,
      ...values,
      upkeep: upkeep ?? null,
      condition: draft.condition,
      notes: draft.notes,
    },
  };
}
