/**
 * Die Regeln der Reise, die man am Tisch sonst im Kopf behält (Wunsch des Spielleiters, 17. 11.
 * 2026: „Dinge, die mit Hand einfach nervig sind, erleichtert Wayfarer – nach den Regeln von
 * D&D“): Reisetempo, Gewaltmarsch, extreme Kälte und Hitze, Hunger und Durst, Gefahren unterwegs
 * und die Nahrungssuche. Wayfarer rechnet den SG und sagt die Folge; geprobt wird am Tisch, und
 * eine Stufe Erschöpfung trägt der Spielleiter mit einem Klick ein.
 *
 * Grundlage ist das Regelwerk von 2024 (SRD 5.2.1). Reine Rechnung.
 */
import type { Hazard, HazardKind, Pace, Yield } from './schema';

// ── Reisetempo ─────────────────────────────────────────────────────────────

/** Was ein Tempo am Tisch bedeutet – neben der Strecke. */
export const PACE_EFFECT: Record<Pace, string> = {
  slow: 'Vorteil auf Weisheit (Wahrnehmung oder Überlebenskunst).',
  normal: 'Nachteil auf Geschicklichkeit (Heimlichkeit).',
  fast: 'Nachteil auf Weisheit (Wahrnehmung oder Überlebenskunst).',
};

// ── Gewaltmarsch ───────────────────────────────────────────────────────────

/** SG des Rettungswurfs am Ende einer Reisestunde nach der achten: 10 + 1 je Stunde darüber. */
export const marchDc = (hoursPastEight: number): number => 10 + Math.max(1, hoursPastEight);

export const marchText = (hoursPastEight: number): string =>
  `Gewaltmarsch, ${8 + hoursPastEight}. Stunde: Jeder legt einen Konstitutionsrettungswurf ab (SG ${marchDc(hoursPastEight)}) – wer scheitert, erhält eine Stufe Erschöpfung.`;

// ── Kälte und Hitze ────────────────────────────────────────────────────────

/** Extreme Kälte: am Ende jeder Stunde im Freien SG 10. */
export const COLD_DC = 10;

export const coldText = (): string =>
  `Extreme Kälte: Jeder, der ungeschützt draußen ist, legt einen Konstitutionsrettungswurf ab (SG ${COLD_DC}) – wer scheitert, erhält eine Stufe Erschöpfung. Resistenz oder Immunität gegen Kälte besteht von selbst.`;

/** Extreme Hitze ohne Trinkwasser: SG 5 in der ersten Stunde, je weitere Stunde +1. */
export const heatDc = (hour: number): number => 5 + Math.max(0, hour - 1);

export const heatText = (hour: number): string =>
  `Extreme Hitze ohne Trinkwasser, ${hour}. Stunde: Jeder legt einen Konstitutionsrettungswurf ab (SG ${heatDc(hour)}) – in mittlerer oder schwerer Rüstung mit Nachteil; wer scheitert, erhält eine Stufe Erschöpfung.`;

// ── Hunger und Durst ───────────────────────────────────────────────────────

/** Unterernährung: weniger als die Hälfte der Nahrung an einem Tag → SG 10, nach fünf Tagen von selbst. */
export const HUNGER_DC = 10;

export const hungerText = (daysWithout: number): string =>
  daysWithout >= 5
    ? `Hunger, ${daysWithout}. Tag ohne Nahrung: Jeder erhält eine Stufe Erschöpfung.`
    : `Hunger: Der Proviant reicht nicht mehr. Wer heute weniger als die Hälfte gegessen hat, legt einen Konstitutionsrettungswurf ab (SG ${HUNGER_DC}) – wer scheitert, erhält eine Stufe Erschöpfung.`;

export const thirstText = (): string =>
  'Durst: Das Wasser reicht nicht mehr. Wer heute weniger als die Hälfte getrunken hat, erhält am Ende des Tages eine Stufe Erschöpfung.';

/** Ob an diesem Halt eine Probe (je Gefährte geschafft oder nicht) oder die Folge für alle gilt. */
export type BodyCheck = 'save' | 'automatic';

export const bodyCheckOf = (kind: string, text: string): BodyCheck | null => {
  if (kind === 'march' || kind === 'cold' || kind === 'heat') return 'save';
  if (kind === 'hunger') return /eine Stufe Erschöpfung\.$/.test(text) ? 'automatic' : 'save';
  if (kind === 'thirst') return 'automatic';
  return null;
};

// ── Gefahren unterwegs ─────────────────────────────────────────────────────

export const HAZARD_LABEL: Record<HazardKind, string> = {
  climb: 'Kletterei',
  slope: 'Steiler Abhang',
  scree: 'Geröll',
  water: 'Wasser',
  ice: 'Eis',
  other: 'Gefahr',
};

/** Was zu einer Gefahr geprobt wird, als Vorschlag – der Spielleiter entscheidet am Tisch. */
export const HAZARD_CHECK: Record<HazardKind, string> = {
  climb: 'Stärke (Athletik)',
  slope: 'Geschicklichkeit (Akrobatik)',
  scree: 'Geschicklichkeit (Akrobatik)',
  water: 'Stärke (Athletik)',
  ice: 'Geschicklichkeit (Akrobatik)',
  other: 'eine passende Probe',
};

/** Sturzschaden nach dem Regelwerk: 1W6 Wucht je 10 Fuß, höchstens 20W6. */
export function fallDice(feet: number): string {
  const dice = Math.min(20, Math.floor(feet / 10));
  return dice > 0 ? `${dice}W6 Wucht` : '';
}

/** Eine Gefahr in einem Satz: „Steiler Abhang – Geschicklichkeit (Akrobatik) SG 13 · Sturz 40 Fuß: 4W6 Wucht“. */
export function hazardLine(hazard: Hazard): string {
  const parts = [
    hazard.text.trim() || HAZARD_LABEL[hazard.kind],
    hazard.dc !== null && hazard.dc > 0 ? `${HAZARD_CHECK[hazard.kind]} SG ${hazard.dc}` : '',
    hazard.fallFeet && fallDice(hazard.fallFeet)
      ? `wer scheitert, stürzt ${hazard.fallFeet} Fuß: ${fallDice(hazard.fallFeet)}`
      : '',
  ].filter(Boolean);
  return parts.join(' – ');
}

// ── Nahrungssuche ──────────────────────────────────────────────────────────

export const YIELD_LABEL: Record<Yield, string> = {
  rich: 'reich – Wild, Früchte, Wasser',
  modest: 'mäßig – mit Mühe zu finden',
  poor: 'karg – kaum etwas',
};

/** Vorschlag für den SG der Nahrungssuche (Weisheit, Überlebenskunst) nach dem, was die Gegend hergibt. */
export const FORAGE_DC: Record<Yield, number> = { rich: 10, modest: 15, poor: 20 };

export const forageText = (yieldOf: Yield | null, water: boolean | null): string =>
  [
    `Nahrung suchen: Weisheit (Überlebenskunst) SG ${FORAGE_DC[yieldOf ?? 'modest']}${yieldOf ? '' : ' (Vorschlag – die Gegend sagt nichts dazu)'}.`,
    water === true
      ? 'Trinkwasser gibt es hier.'
      : water === false
        ? 'Trinkwasser gibt es hier keins.'
        : '',
  ]
    .filter(Boolean)
    .join(' ');

// ── Reittiere und Zugtiere ─────────────────────────────────────────────────

/**
 * Auch Tiere brauchen Futter und Wasser (Regelwerk: nach Größe – ein großes Tier wie ein Pferd
 * 4 Pfund und 4 Gallonen am Tag, viermal so viel wie ein Gefährte). Die Vorräte der Reise zählen
 * in Tagen; dieser Satz erinnert nur daran, die Tiere mitzurechnen, und sagt, ob sie hier grasen
 * und saufen können. null = kein Tier dabei (zu Fuß, Schiff).
 */
export function animalFeedText(
  means: { kind: 'mount' | 'vehicle' | 'ship'; name: string } | null,
  yieldOf: Yield | null,
  water: boolean | null,
): string | null {
  if (!means || means.kind === 'ship') return null;
  const who = means.kind === 'vehicle' ? `Die Zugtiere (${means.name})` : means.name;
  return [
    `${who}: Auch Tiere brauchen Futter und Wasser – ein großes Tier viermal so viel wie ein Gefährte (4 Pfund, 4 Gallonen am Tag).`,
    yieldOf === 'rich' || yieldOf === 'modest'
      ? 'Hier können sie grasen.'
      : yieldOf === 'poor'
        ? 'Hier finden sie kaum etwas zu fressen.'
        : '',
    water === true ? 'Wasser gibt es hier.' : water === false ? 'Wasser gibt es hier keins.' : '',
  ]
    .filter(Boolean)
    .join(' ');
}
