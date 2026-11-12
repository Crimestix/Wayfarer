/**
 * Bestiarium – was die Seite wissen muss, ohne selbst zu rechnen: die Liste mit Suche und Filtern,
 * die Auswahl für die Filter und das Würfeln am Tisch.
 */
import {
  KIND_LABEL,
  crValue,
  habitatsOf,
  resolveCreature,
  type Dice,
  type Resolved,
} from '../../domain/creature';
import type { CampaignData, CreatureKind } from '../../domain/schema';

export interface CreatureRow {
  id: string;
  name: string;
  kind: CreatureKind;
  /** „HG 1/4 · Humanoider“ */
  line: string;
  cr: string;
  /** Einrückung: 0 Vorlage, 1 Variante oder Einzelner darunter, 2 Einzelner einer Variante. */
  depth: number;
  resolved: Resolved;
}

export interface CreatureFilter {
  query: string;
  /** Höchster Herausforderungsgrad – leer = alle. */
  maxCr: string;
  type: string;
  habitat: string;
  source: string;
}

export const NO_FILTER: CreatureFilter = {
  query: '',
  maxCr: '',
  type: '',
  habitat: '',
  source: '',
};

const fold = (text: string) => text.toLocaleLowerCase('de').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Die Wesen als Liste: Vorlagen nach Namen, darunter eingerückt, was von ihnen erbt. Ein Filter
 * trifft ein Wesen selbst; passt eine Variante, steht ihre Vorlage zur Einordnung mit da.
 */
export function creatureRows(
  data: Pick<CampaignData, 'creatures'>,
  filter: CreatureFilter = NO_FILTER,
): CreatureRow[] {
  const all = Object.values(data.creatures);
  const needle = fold(filter.query.trim());
  const matches = (resolved: Resolved): boolean => {
    const { block, creature } = resolved;
    if (needle && !fold(`${creature.name} ${block.type} ${block.tags}`).includes(needle))
      return false;
    if (filter.maxCr && crValue(block.cr) > crValue(filter.maxCr)) return false;
    if (filter.type && fold(block.type) !== fold(filter.type)) return false;
    if (filter.habitat && !habitatsOf(block).some((entry) => fold(entry) === fold(filter.habitat)))
      return false;
    if (filter.source && fold(resolved.source) !== fold(filter.source)) return false;
    return true;
  };
  const rows: CreatureRow[] = [];
  const add = (id: string, depth: number): boolean => {
    const resolved = resolveCreature(data.creatures, id);
    if (!resolved) return false;
    const at = rows.length;
    const children = all
      .filter((entry) => entry.parentId === id)
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
    let any = false;
    for (const child of children) any = add(child.id, depth + 1) || any;
    if (!matches(resolved) && !any) return false;
    const { creature, block } = resolved;
    rows.splice(at, 0, {
      id,
      name: creature.name,
      kind: creature.kind,
      line: [
        creature.kind === 'template' ? '' : KIND_LABEL[creature.kind],
        `HG ${block.cr}`,
        block.type,
      ]
        .filter(Boolean)
        .join(' · '),
      cr: block.cr,
      depth,
      resolved,
    });
    return true;
  };
  for (const root of all
    // Wessen Vorlage fehlt, steht für sich.
    .filter((entry) => !entry.parentId || !data.creatures[entry.parentId])
    .sort((a, b) => a.name.localeCompare(b.name, 'de')))
    add(root.id, 0);
  return rows;
}

/** Was sich filtern lässt: die Typen, Lebensräume und Quellen, die im Bestiarium vorkommen. */
export function creatureFacets(data: Pick<CampaignData, 'creatures'>): {
  types: string[];
  habitats: string[];
  sources: string[];
} {
  const types = new Set<string>();
  const habitats = new Set<string>();
  const sources = new Set<string>();
  for (const creature of Object.values(data.creatures)) {
    const resolved = resolveCreature(data.creatures, creature.id);
    if (!resolved) continue;
    if (resolved.block.type) types.add(resolved.block.type);
    for (const habitat of habitatsOf(resolved.block)) habitats.add(habitat);
    if (resolved.source) sources.add(resolved.source);
  }
  const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b, 'de'));
  return { types: sorted(types), habitats: sorted(habitats), sources: sorted(sources) };
}

// ── Würfeln ────────────────────────────────────────────────────────────────

/** Eine Zahl von 1 bis `sides` – echter Zufall, kein fester Ausgangswert: Das ist ein Wurf. */
export type Die = (sides: number) => number;

export const fairDie: Die = (sides) => {
  const buffer = new Uint32Array(1);
  // Ohne Schlagseite: Werte über dem größten Vielfachen der Seitenzahl werden neu gezogen.
  const limit = Math.floor(0x100000000 / sides) * sides;
  do crypto.getRandomValues(buffer);
  while (buffer[0]! >= limit);
  return (buffer[0]! % sides) + 1;
};

export interface Roll {
  /** „Krummsäbel – Angriff“ */
  label: string;
  total: number;
  /** „W20 (14) + 4“ */
  detail: string;
  /** Eine gewürfelte 20 oder 1 beim Angriff. */
  mark: 'crit' | 'fumble' | null;
}

/** Ein Angriffswurf: W20 plus Bonus. */
export function rollAttack(label: string, bonus: number, die: Die = fairDie): Roll {
  const d20 = die(20);
  const tail = bonus < 0 ? `− ${-bonus}` : `+ ${bonus}`;
  return {
    label: `${label} – Angriff`,
    total: d20 + bonus,
    detail: `W20 (${d20}) ${tail}`,
    mark: d20 === 20 ? 'crit' : d20 === 1 ? 'fumble' : null,
  };
}

/** Ein Schadenswurf – bei einem kritischen Treffer mit doppelt so vielen Würfeln. */
export function rollDamage(
  label: string,
  dice: Dice,
  type: string,
  crit = false,
  die: Die = fairDie,
): Roll {
  const count = dice.count * (crit ? 2 : 1);
  const rolls = Array.from({ length: count }, () => die(dice.sides));
  const sum = rolls.reduce((total, value) => total + value, 0);
  const tail = dice.bonus ? (dice.bonus < 0 ? ` − ${-dice.bonus}` : ` + ${dice.bonus}`) : '';
  return {
    label: `${label} – ${crit ? 'kritischer ' : ''}Schaden${type ? ` (${type})` : ''}`,
    total: Math.max(count ? 1 : 0, sum + dice.bonus),
    detail: count ? `${count}W${dice.sides} (${rolls.join(', ')})${tail}` : String(dice.bonus),
    mark: null,
  };
}
