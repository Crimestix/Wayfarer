import { describe, expect, it } from 'vitest';
import {
  attackMath,
  averageOf,
  crCheck,
  creatureChildren,
  difficultyOf,
  formatDice,
  parseDice,
  proficiencyOf,
  resolveCreature,
  saveDcOf,
  sensesText,
  speedText,
  statsOf,
  typeLine,
  xpBudget,
  xpOf,
} from '../creature';
import { createCreature, newId, type Creature, type CreatureFeature } from '../schema';

const feature = (name: string, more: Partial<CreatureFeature> = {}): CreatureFeature => ({
  id: newId(),
  section: 'trait',
  name,
  text: '',
  attack: null,
  saveAbility: null,
  saveDc: null,
  uses: '',
  ...more,
});

/**
 * Erfundene Wesen: der Grubenschleicher (Vorlage), sein Treiber (Variante) und Krummzahn, ein
 * bestimmter Treiber (Einzelner).
 */
function setup() {
  const base = createCreature({
    name: 'Grubenschleicher',
    source: 'Eigenbau',
    block: {
      size: 'small',
      type: 'Humanoider',
      tags: 'Goblinoide',
      alignment: 'neutral böse',
      ac: 15,
      hitDice: 2,
      speed: { walk: 30, fly: 0, swim: 0, climb: 20, burrow: 0 },
      abilities: { str: 8, dex: 14, con: 12, int: 10, wis: 8, cha: 8 },
      skills: { stealth: 2, perception: 1 },
      senses: { darkvision: 60, blindsight: 0, tremorsense: 0, truesight: 0 },
      cr: '1/4',
      habitat: 'Unterreich, Hügel',
    },
    features: [
      feature('Feige', { text: 'Flieht, sobald er allein ist.' }),
      feature('Krummsäbel', {
        section: 'action',
        attack: {
          ranged: false,
          ability: 'dex',
          bonus: null,
          reach: '5 Fuß',
          dice: '1W6',
          addMod: true,
          damageType: 'Hieb',
        },
      }),
    ],
  });
  const driver = createCreature({
    name: 'Grubenschleicher-Treiber',
    kind: 'variant',
    parentId: base.id,
    block: { hitDice: 4, cr: '1' },
    dropped: ['Feige'],
    features: [
      feature('Krummsäbel', {
        section: 'action',
        text: 'Der Treiber schlägt zweimal zu.',
        attack: {
          ranged: false,
          ability: 'dex',
          bonus: null,
          reach: '5 Fuß',
          dice: '1W8',
          addMod: true,
          damageType: 'Hieb',
        },
      }),
      feature('Peitsche', { section: 'bonus', saveAbility: 'cha' }),
    ],
  });
  const tooth = createCreature({
    name: 'Krummzahn',
    kind: 'individual',
    parentId: driver.id,
    hpNow: 7,
  });
  const all = (list: Creature[]) => Object.fromEntries(list.map((entry) => [entry.id, entry]));
  return { base, driver, tooth, creatures: all([base, driver, tooth]), all };
}

describe('Was sich rechnen lässt', () => {
  it('Übungsbonus und Erfahrungspunkte folgen dem Herausforderungsgrad', () => {
    expect(['0', '1/4', '4', '5', '8', '9', '17', '30'].map(proficiencyOf)).toEqual([
      2, 2, 2, 3, 3, 4, 6, 9,
    ]);
    expect(['0', '1/8', '1/4', '1', '5', '30'].map(xpOf)).toEqual([10, 25, 50, 200, 1800, 155000]);
  });

  it('Würfel: lesen, Durchschnitt, schreiben', () => {
    expect(parseDice('2W6 + 3')).toEqual({ count: 2, sides: 6, bonus: 3 });
    expect(parseDice('1d8−1')).toEqual({ count: 1, sides: 8, bonus: -1 });
    expect(parseDice('W4')).toEqual({ count: 1, sides: 4, bonus: 0 });
    expect(parseDice('3')).toEqual({ count: 0, sides: 0, bonus: 3 });
    expect(parseDice('viel')).toBeNull();
    expect(averageOf({ count: 2, sides: 6, bonus: 3 })).toBe(10);
    expect(averageOf({ count: 1, sides: 6, bonus: 2 })).toBe(5);
    expect(formatDice({ count: 2, sides: 6, bonus: 3 })).toBe('2W6 + 3');
    expect(formatDice({ count: 1, sides: 8, bonus: -1 })).toBe('1W8 − 1');
    expect(formatDice({ count: 1, sides: 4, bonus: 0 })).toBe('1W4');
  });

  it('Trefferpunkte, Initiative, Rettungswürfe, Fertigkeiten, passive Wahrnehmung', () => {
    const { base, creatures } = setup();
    const stats = statsOf(resolveCreature(creatures, base.id)!.block);
    // Klein: W6. Zwei Trefferwürfel, Konstitution +1.
    expect(stats).toMatchObject({ pb: 2, xp: 50, hp: 9, hpFormula: '2W6 + 2', initiative: 2 });
    expect(stats.saves).toMatchObject({ dex: 2, con: 1, wis: -1 });
    expect(stats.skills).toEqual([
      { key: 'stealth', label: 'Heimlichkeit', bonus: 6 },
      { key: 'perception', label: 'Wahrnehmung', bonus: 1 },
    ]);
    expect(stats.passivePerception).toBe(11);
  });

  it('Angriff: Bonus aus Attribut und Übung, Schaden aus Würfeln und Attribut', () => {
    const { base, creatures } = setup();
    const resolved = resolveCreature(creatures, base.id)!;
    const sabre = resolved.features.find((entry) => entry.name === 'Krummsäbel')!;
    expect(attackMath(resolved.block, sabre.attack!)).toMatchObject({
      bonus: 4,
      average: 5,
      formula: '1W6 + 2',
    });
    // Ein fester Bonus und Schaden ohne Attribut gelten, wie sie eingetragen sind.
    expect(
      attackMath(resolved.block, { ...sabre.attack!, bonus: 7, addMod: false, dice: '2W4 + 1' }),
    ).toMatchObject({ bonus: 7, average: 6, formula: '2W4 + 1' });
    expect(saveDcOf(resolved.block, { saveAbility: 'dex', saveDc: null })).toBe(12);
    expect(saveDcOf(resolved.block, { saveAbility: 'dex', saveDc: 15 })).toBe(15);
    expect(saveDcOf(resolved.block, { saveAbility: null, saveDc: null })).toBeNull();
  });

  it('schreibt Art, Bewegung und Sinne wie im Statblock', () => {
    const { base, creatures } = setup();
    const block = resolveCreature(creatures, base.id)!.block;
    expect(typeLine(block)).toBe('Klein · Humanoider (Goblinoide), neutral böse');
    expect(speedText(block)).toBe('30 Fuß, Klettern 20 Fuß');
    expect(sensesText(block)).toBe('Dunkelsicht 60 Fuß; passive Wahrnehmung 11');
  });
});

describe('Erben statt kopieren', () => {
  it('eine Variante hält nur fest, was abweicht', () => {
    const { driver, creatures } = setup();
    const resolved = resolveCreature(creatures, driver.id)!;
    expect(resolved.chain.map((entry) => entry.name)).toEqual([
      'Grubenschleicher',
      'Grubenschleicher-Treiber',
    ]);
    // Geerbt: Größe, Rüstungsklasse, Attribute. Eigen: Trefferwürfel, Herausforderungsgrad.
    expect(resolved.block).toMatchObject({ size: 'small', ac: 15, hitDice: 4, cr: '1' });
    expect([...resolved.own].sort()).toEqual(['cr', 'hitDice']);
    expect(resolved.source).toBe('Eigenbau');
    // „Feige“ fällt weg, der gleichnamige Krummsäbel ersetzt den geerbten, die Peitsche kommt dazu.
    expect(resolved.features.map((entry) => [entry.name, entry.inherited])).toEqual([
      ['Krummsäbel', false],
      ['Peitsche', false],
    ]);
    expect(resolved.features[0]!.attack!.dice).toBe('1W8');
    expect(statsOf(resolved.block).hp).toBe(18);
  });

  it('ändert sich die Vorlage, ziehen alle mit – außer wo sie bewusst abweichen', () => {
    const { base, driver, tooth, all } = setup();
    const changed = all([
      { ...base, block: { ...base.block, ac: 17, hitDice: 3, alignment: 'chaotisch böse' } },
      driver,
      tooth,
    ]);
    const single = resolveCreature(changed, tooth.id)!;
    expect(single.block.ac).toBe(17);
    expect(single.block.alignment).toBe('chaotisch böse');
    // Die Trefferwürfel legt die Variante selbst fest.
    expect(single.block.hitDice).toBe(4);
    expect(single.chain).toHaveLength(3);
    expect(single.features.every((entry) => entry.inherited)).toBe(true);
    expect(single.creature.hpNow).toBe(7);
  });

  it('dreht sich nicht im Kreis und kennt die Erben', () => {
    const { base, driver, creatures, all } = setup();
    expect(creatureChildren(creatures, base.id).map((entry) => entry.name)).toEqual([
      'Grubenschleicher-Treiber',
    ]);
    const loop = all([{ ...base, parentId: driver.id }, driver]);
    expect(resolveCreature(loop, driver.id)!.chain).toHaveLength(2);
    expect(resolveCreature(creatures, 'gibt-es-nicht')).toBeNull();
  });
});

describe('Passt der Herausforderungsgrad?', () => {
  it('ja, wenn Verteidigung und Angriff dazu passen', () => {
    const { base, creatures } = setup();
    const check = crCheck(resolveCreature(creatures, base.id)!);
    expect(check.verdict).toBe('fits');
    expect(check.damage).toBe(5);
    expect(check.text).toContain('HG 1/4 passt');
  });

  it('sagt, wenn er zu hoch oder zu niedrig gegriffen ist', () => {
    const { base, all } = setup();
    const high = all([{ ...base, block: { ...base.block, cr: '6' } }]);
    const check = crCheck(resolveCreature(high, base.id)!);
    expect(check.verdict).toBe('high');
    expect(check.text).toContain('eher hoch gegriffen');
    const low = all([
      { ...base, block: { ...base.block, cr: '0', hitDice: 30, ac: 18, attacksPerRound: 3 } },
    ]);
    expect(crCheck(resolveCreature(low, base.id)!).verdict).toBe('low');
    // Ohne Angriff zählt nur die Verteidigung.
    const peaceful = all([{ ...base, features: [] }]);
    expect(crCheck(resolveCreature(peaceful, base.id)!).offensive).toBeNull();
  });
});

describe('Begegnungen nach dem EP-Budget', () => {
  it('summiert das Budget über die Gefährten und ordnet die Begegnung ein', () => {
    const budget = xpBudget([3, 3, 3, 3]);
    expect(budget).toEqual({ low: 600, moderate: 900, high: 1600 });
    expect(xpBudget([1, 5])).toEqual({ low: 550, moderate: 825, high: 1200 });
    expect(difficultyOf(0, budget)).toBe('none');
    expect(difficultyOf(200, budget)).toBe('trivial');
    expect(difficultyOf(600, budget)).toBe('low');
    expect(difficultyOf(900, budget)).toBe('moderate');
    expect(difficultyOf(1600, budget)).toBe('high');
    expect(difficultyOf(1601, budget)).toBe('beyond');
  });
});
