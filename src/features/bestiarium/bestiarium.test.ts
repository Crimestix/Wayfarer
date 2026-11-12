import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { resolveCreature, statsOf } from '../../domain/creature';
import {
  importStatblock,
  makeIndividual,
  makeVariant,
  removeCreature,
  saveCreature,
  setCreatureHp,
  type CreatureInput,
} from './actions';
import { NO_FILTER, creatureFacets, creatureRows, rollAttack, rollDamage } from './model';
import { parseStatblock } from './parse';

/** Erfundene Wesen: Grubenschleicher (mit Treiber und Krummzahn) und der Aalwächter. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const input = (name: string, more: Partial<CreatureInput> = {}): CreatureInput => ({
    name,
    kind: 'template',
    parentId: null,
    block: {},
    features: [],
    dropped: [],
    source: '',
    notes: '',
    ...more,
  });
  const base = saveCreature(
    db,
    input('Grubenschleicher', {
      source: 'Eigenbau',
      block: {
        size: 'small',
        type: 'Humanoider',
        hitDice: 2,
        abilities: { str: 8, dex: 14, con: 12, int: 10, wis: 8, cha: 8 },
        cr: '1/4',
        habitat: 'Unterreich, Hügel',
      },
      features: [
        {
          id: 'saebel',
          section: 'action',
          name: 'Krummsäbel',
          text: '',
          attack: null,
          saveAbility: null,
          saveDc: null,
        },
      ],
    }),
  );
  const driver = makeVariant(db, base.id)!;
  saveCreature(
    db,
    input('Grubenschleicher-Treiber', {
      kind: 'variant',
      parentId: base.id,
      block: { hitDice: 4, cr: '1' },
    }),
    driver.id,
  );
  const tooth = makeIndividual(db, driver.id, 'Krummzahn')!;
  const eel = saveCreature(
    db,
    input('Aalwächter', {
      source: 'Buch der Tiefen, S. 12',
      block: { size: 'large', type: 'Monstrosität', cr: '2', habitat: 'Küste' },
    }),
  );
  const data = () => db.getSnapshot();
  return { db, data, base, driver, tooth, eel };
}

describe('Die Liste des Bestiariums', () => {
  it('Vorlagen nach Namen, darunter eingerückt, was von ihnen erbt', async () => {
    const { data } = await setup();
    expect(creatureRows(data()).map((row) => [row.name, row.depth, row.line])).toEqual([
      ['Aalwächter', 0, 'HG 2 · Monstrosität'],
      ['Grubenschleicher', 0, 'HG 1/4 · Humanoider'],
      ['Grubenschleicher-Treiber', 1, 'Variante · HG 1 · Humanoider'],
      ['Krummzahn', 2, 'Einzelner · HG 1 · Humanoider'],
    ]);
  });

  it('sucht und filtert – nach geerbten Werten ebenso', async () => {
    const { data } = await setup();
    const names = (filter: Partial<typeof NO_FILTER>) =>
      creatureRows(data(), { ...NO_FILTER, ...filter }).map((row) => row.name);
    expect(names({ query: 'aal' })).toEqual(['Aalwächter']);
    // Krummzahn passt; seine Kette steht zur Einordnung mit da.
    expect(names({ query: 'krummz' })).toEqual([
      'Grubenschleicher',
      'Grubenschleicher-Treiber',
      'Krummzahn',
    ]);
    expect(names({ maxCr: '1/2' })).toEqual(['Grubenschleicher']);
    expect(names({ type: 'Monstrosität' })).toEqual(['Aalwächter']);
    // Der Lebensraum ist geerbt.
    expect(names({ habitat: 'Hügel' })).toHaveLength(3);
    expect(names({ source: 'Eigenbau' })).toHaveLength(3);
    expect(names({ query: 'drache' })).toEqual([]);
    expect(creatureFacets(data())).toEqual({
      types: ['Humanoider', 'Monstrosität'],
      habitats: ['Hügel', 'Küste', 'Unterreich'],
      sources: ['Buch der Tiefen, S. 12', 'Eigenbau'],
    });
  });
});

describe('Einzelne und ihre Trefferpunkte', () => {
  it('führt Schaden und Heilung – zwischen null und dem Höchstwert', async () => {
    const { db, data, tooth } = await setup();
    const max = statsOf(resolveCreature(data().creatures, tooth.id)!.block).hp;
    expect(max).toBe(18);
    setCreatureHp(db, tooth.id, max - 7);
    expect(data().creatures[tooth.id]!.hpNow).toBe(11);
    setCreatureHp(db, tooth.id, -5);
    expect(data().creatures[tooth.id]!.hpNow).toBe(0);
    // Ganz geheilt steht nichts mehr fest: Er zieht mit, wenn sich der Höchstwert ändert.
    setCreatureHp(db, tooth.id, 99);
    expect(data().creatures[tooth.id]!.hpNow).toBeNull();
  });
});

describe('Löschen', () => {
  it('was geerbt hat, behält seine Werte und steht danach für sich', async () => {
    const { db, data, base, driver, tooth } = await setup();
    removeCreature(db, base.id);
    const now = data().creatures[driver.id]!;
    expect(now).toMatchObject({ kind: 'template', parentId: null, source: 'Eigenbau' });
    expect(now.block).toMatchObject({
      size: 'small',
      hitDice: 4,
      cr: '1',
      habitat: 'Unterreich, Hügel',
    });
    expect(now.features.map((feature) => feature.name)).toEqual(['Krummsäbel']);
    // Krummzahn erbt weiter vom Treiber.
    expect(resolveCreature(data().creatures, tooth.id)!.block.hitDice).toBe(4);
  });
});

describe('Übernehmen aus Text', () => {
  it('legt eine Vorlage mit Quelle an', async () => {
    const { db, data } = await setup();
    const parsed = parseStatblock(`Moorhund
Mittelgroßes Tier, gesinnungslos
Rüstungsklasse 13
Trefferpunkte 11 (2W8 + 2)
STR GES KON INT WEI CHA
13 14 12 3 12 6
Herausforderungsgrad 1/4
Biss. Nahkampfangriffswurf: +4, Reichweite 1,5 m. Treffer: 7 (2W4 + 2) Stichschaden.`)!;
    const hound = importStatblock(db, parsed, ' Eigene Notizen ');
    expect(data().creatures[hound.id]).toMatchObject({
      name: 'Moorhund',
      kind: 'template',
      source: 'Eigene Notizen',
    });
    expect(statsOf(resolveCreature(data().creatures, hound.id)!.block).hp).toBe(11);
  });
});

describe('Würfeln am Tisch', () => {
  it('Angriff: W20 plus Bonus, mit 20 und 1 als Zeichen', () => {
    expect(rollAttack('Biss', 4, () => 14)).toEqual({
      label: 'Biss – Angriff',
      total: 18,
      detail: 'W20 (14) + 4',
      mark: null,
    });
    expect(rollAttack('Biss', -1, () => 20)).toMatchObject({ total: 19, mark: 'crit' });
    expect(rollAttack('Biss', 4, () => 1).mark).toBe('fumble');
  });

  it('Schaden: die Würfel plus Bonus – kritisch mit doppelt so vielen Würfeln', () => {
    const dice = { count: 2, sides: 6, bonus: 3 };
    expect(rollDamage('Biss', dice, 'Stich', false, () => 4)).toEqual({
      label: 'Biss – Schaden (Stich)',
      total: 11,
      detail: '2W6 (4, 4) + 3',
      mark: null,
    });
    expect(rollDamage('Biss', dice, 'Stich', true, () => 4)).toMatchObject({
      label: 'Biss – kritischer Schaden (Stich)',
      total: 19,
      detail: '4W6 (4, 4, 4, 4) + 3',
    });
    // Fester Schaden ohne Würfel.
    expect(rollDamage('Stachel', { count: 0, sides: 0, bonus: 1 }, '').total).toBe(1);
  });
});
