import { describe, expect, it } from 'vitest';
import { generateCaves } from '../caves';
import { hexBand, hexLine } from '../hex';
import {
  DIR_DOWN,
  cheapestPath,
  indexHexes,
  isRock,
  passageBetween,
  passagesFrom,
  setPassage,
} from '../passages';
import { HexSchema, type Hex } from '../schema';
import { sensesAt } from '../senses';
import { emptyCollections, type CampaignData } from '../schema';

const rock = (q: number, r: number, level = 0): Hex => HexSchema.parse({ q, r, level, exits: [] });

describe('Ausgänge', () => {
  it('öffnet einen Gang auf beiden Seiten, einen Abbruch nur auf einer', () => {
    // Das Feld darunter hat selbst einen Gang – sonst wäre es Fels.
    const below = { ...rock(0, 0, 1), exits: [{ dir: 1, kind: 'open' as const, found: false }] };
    let hexes = [rock(0, 0), rock(1, 0), below];
    hexes = setPassage(hexes, { q: 0, r: 0 }, 1, 'narrow');
    const index = indexHexes(hexes);
    expect(passageBetween(index, hexes[0]!, { q: 1, r: 0 })?.kind).toBe('narrow');
    expect(passageBetween(index, hexes[1]!, { q: 0, r: 0 })?.kind).toBe('narrow');
    hexes = setPassage(hexes, { q: 0, r: 0 }, DIR_DOWN, 'drop');
    const again = indexHexes(hexes);
    expect(passageBetween(again, hexes[0]!, { q: 0, r: 0, level: 1 })).not.toBeNull();
    expect(passageBetween(again, hexes[2]!, { q: 0, r: 0 })).toBeNull();
    // Schließen nimmt beide Seiten.
    hexes = setPassage(hexes, { q: 0, r: 0 }, 1, null);
    expect(isRock(hexes[1]!)).toBe(true);
  });

  it('verborgene Gänge zählen erst, wenn sie gefunden sind', () => {
    const hexes = setPassage([rock(0, 0), rock(1, 0)], { q: 0, r: 0 }, 1, 'hidden');
    const index = indexHexes(hexes);
    expect(passagesFrom(index, hexes[0]!)).toHaveLength(0);
    expect(passagesFrom(index, hexes[0]!, { secrets: true })).toHaveLength(1);
  });

  it('findet den Weg durch ein erzeugtes Netz, auch über Ebenen', () => {
    const start = { q: 0, r: 0 };
    const goal = { q: 14, r: 0 };
    const cells = hexBand(hexLine(start, goal), 3);
    const { cells: made } = generateCaves({ cells, start, goal, levels: 2, seed: 99 });
    const hexes = made.map(({ role, river, ...c }) =>
      HexSchema.parse({ ...c, terrain: 'underdark', river: river ? 'Fluss' : '', feature: role }),
    );
    const found = cheapestPath(indexHexes(hexes), start, goal, () => 1);
    expect(found?.steps.at(-1)).toMatchObject(goal);
  });
});

describe('Witterung', () => {
  it('sagt, was die Gruppe aus den Gängen ringsum bemerkt – nicht durch Fels, nicht von hinten', () => {
    let hexes = [
      rock(0, 0),
      { ...rock(1, 0), feature: 'Pilzwald' },
      { ...rock(-1, 0), sign: 'Schwefelgeruch' },
      { ...rock(0, 1), feature: 'Pilzwald' },
    ];
    hexes = setPassage(hexes, { q: 0, r: 0 }, 1, 'open');
    hexes = setPassage(hexes, { q: 0, r: 0 }, 4, 'narrow');
    const data = { ...emptyCollections() } as unknown as CampaignData;
    const senses = sensesAt(data, { hexes }, { q: 0, r: 0 });
    expect(senses.map((s) => s.where)).toEqual([
      'Aus dem östlichen Gang',
      'Aus dem westlichen Gang',
    ]);
    expect(senses[0]!.noticed[0]).toMatch(/Pilzgeruch/);
    expect(senses[1]!.noticed).toEqual(['Schwefelgeruch', 'der Gang wird eng']);
    // Von dort gekommen: das kennt die Gruppe schon.
    expect(sensesAt(data, { hexes }, { q: 0, r: 0 }, { q: -1, r: 0 })).toHaveLength(1);
  });
});
