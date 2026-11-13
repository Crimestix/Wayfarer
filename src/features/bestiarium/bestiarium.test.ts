import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  difficultyOf,
  encounterView,
  partyLevels,
  resolveCreature,
  statsOf,
  xpBudget,
} from '../../domain/creature';
import {
  importStatblock,
  linkAnimalCreature,
  makeIndividual,
  makeVariant,
  removeCreature,
  saveCreature,
  setCreatureHp,
  type CreatureInput,
} from './actions';
import { addFoes, newEncounter, removeFoe, resetEncounter, setFoeHp } from './encounterActions';
import { fielded, lossPlan, stockSummary, stockView, stocksHere } from '../../domain/stock';
import { createEntity } from '../../domain/schema';
import { animalsOfCreature, creatureOfAnimal } from '../../domain/nature';
import { animalPreset } from './draft';
import {
  addGroup,
  bookLosses,
  fieldFromStock,
  loseFromGroup,
  newStock,
  updateStock,
} from './stockActions';
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
          uses: '',
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

describe('Begegnungen', () => {
  it('jedes Exemplar bekommt einen Namen und eigene Trefferpunkte', async () => {
    const { db, data, base, tooth } = await setup();
    const fight = newEncounter(db, 'Hinterhalt am Kai');
    addFoes(db, fight.id, base.id, 3);
    const names = () => data().encounters[fight.id]!.foes.map((foe) => foe.name);
    expect(names()).toEqual(['Grubenschleicher 1', 'Grubenschleicher 2', 'Grubenschleicher 3']);
    // Die kleinste freie Nummer wird wieder vergeben.
    removeFoe(db, fight.id, data().encounters[fight.id]!.foes[1]!.id);
    addFoes(db, fight.id, base.id);
    expect(names()).toEqual(['Grubenschleicher 1', 'Grubenschleicher 3', 'Grubenschleicher 2']);
    // Ein Einzelner kommt mit seinem Namen und seinen jetzigen Trefferpunkten – und nur einmal.
    setCreatureHp(db, tooth.id, 11);
    addFoes(db, fight.id, tooth.id, 4);
    const last = data().encounters[fight.id]!.foes.at(-1)!;
    expect(last).toMatchObject({ name: 'Krummzahn', hp: 11 });
    expect(data().encounters[fight.id]!.foes).toHaveLength(4);
  });

  it('führt Schaden je Exemplar und zählt, wer noch steht', async () => {
    const { db, data, base } = await setup();
    const fight = newEncounter(db);
    addFoes(db, fight.id, base.id, 2);
    const [first, second] = data().encounters[fight.id]!.foes;
    setFoeHp(db, fight.id, first!.id, 4);
    setFoeHp(db, fight.id, second!.id, -3);
    let view = encounterView(data(), data().encounters[fight.id]!);
    expect(view.foes.map((entry) => [entry.hp, entry.max, entry.down])).toEqual([
      [4, 9, false],
      [0, 9, true],
    ]);
    expect(view.standing).toBe(1);
    // Die EP zählen so, wie die Begegnung angelegt ist – auch für Besiegte.
    expect(view.xp).toBe(100);
    resetEncounter(db, fight.id);
    view = encounterView(data(), data().encounters[fight.id]!);
    expect(view.foes.every((entry) => entry.hp === 9 && !entry.down)).toBe(true);
  });

  it('ordnet die Begegnung nach dem EP-Budget der Gruppe ein', async () => {
    const { db, data, base, eel } = await setup();
    const fight = newEncounter(db);
    addFoes(db, fight.id, eel.id, 2);
    addFoes(db, fight.id, base.id, 1);
    const view = encounterView(data(), data().encounters[fight.id]!);
    expect(view.xp).toBe(950);
    expect(view.levels).toEqual(partyLevels(data()));
    expect(view.levels.length).toBeGreaterThan(0);
    expect(view.budget).toEqual(xpBudget(view.levels));
    expect(view.difficulty).toBe(difficultyOf(950, view.budget));
    // Ein gelöschtes Wesen zählt nicht mehr mit – das Exemplar bleibt als Erinnerung stehen.
    removeCreature(db, eel.id);
    const after = encounterView(data(), data().encounters[fight.id]!);
    expect(after.xp).toBe(50);
    expect(after.foes.filter((entry) => entry.resolved === null)).toHaveLength(2);
    expect(after.standing).toBe(1);
  });
});

describe('Bestände', () => {
  it('ein Bau mit Bewohnern: wie viele es waren und wie viele noch da sind', async () => {
    const { db, data, base, driver, tooth } = await setup();
    const den = newStock(db, 'Bau der Grubenschleicher');
    addGroup(db, den.id, base.id, 20);
    addGroup(db, den.id, driver.id, 6);
    addGroup(db, den.id, tooth.id, 1);
    // Dasselbe Wesen noch einmal: Es werden mehr, keine zweite Zeile.
    addGroup(db, den.id, base.id, 3);
    const view = () => stockView(data(), data().stocks[den.id]!);
    expect(view()).toMatchObject({ count: 30, alive: 30 });
    expect(stockSummary(view())).toBe(
      '30 – 23 Grubenschleicher, 6 Grubenschleicher-Treiber, 1 Krummzahn',
    );
    const group = data().stocks[den.id]!.groups[0]!;
    loseFromGroup(db, den.id, group.id, 3);
    expect(stockSummary(view())).toBe(
      '27 von 30 – 20 Grubenschleicher, 6 Grubenschleicher-Treiber, 1 Krummzahn',
    );
    // Nie mehr Verluste, als es waren – und nie weniger als keine.
    loseFromGroup(db, den.id, group.id, 99);
    expect(view().groups[0]!.alive).toBe(0);
    loseFromGroup(db, den.id, group.id, -99);
    expect(view().groups[0]!.alive).toBe(23);
    // 23 × 50 EP, 6 × 200 EP und Krummzahn (200 EP).
    expect(view().xp).toBe(23 * 50 + 6 * 200 + 200);
  });

  it('Bewohner treten in einer Begegnung an – nie mehr, als noch da sind', async () => {
    const { db, data, base } = await setup();
    const den = newStock(db, 'Bau der Grubenschleicher');
    addGroup(db, den.id, base.id, 5);
    const fight = newEncounter(db);
    expect(fieldFromStock(db, fight.id, den.id, base.id, 3)).toBe(3);
    expect(fieldFromStock(db, fight.id, den.id, base.id, 4)).toBe(2);
    expect(fieldFromStock(db, fight.id, den.id, base.id, 1)).toBe(0);
    const foes = () => data().encounters[fight.id]!.foes;
    expect(foes()).toHaveLength(5);
    expect(foes().every((foe) => foe.stockId === den.id)).toBe(true);
    expect(fielded(data().encounters[fight.id]!, den.id, base.id)).toBe(5);
  });

  it('wer besiegt ist, fehlt danach im Bestand – einmal verbucht, nicht doppelt', async () => {
    const { db, data, base, eel } = await setup();
    const den = newStock(db, 'Bau der Grubenschleicher');
    addGroup(db, den.id, base.id, 5);
    const fight = newEncounter(db);
    fieldFromStock(db, fight.id, den.id, base.id, 4);
    // Ein Wesen, das nicht aus dem Bestand stammt, zählt für ihn nicht.
    addFoes(db, fight.id, eel.id, 1);
    const foes = () => data().encounters[fight.id]!.foes;
    setFoeHp(db, fight.id, foes()[0]!.id, 0);
    setFoeHp(db, fight.id, foes()[1]!.id, 0);
    setFoeHp(db, fight.id, foes()[2]!.id, 4);
    setFoeHp(db, fight.id, foes()[4]!.id, 0);
    expect(lossPlan(data(), data().encounters[fight.id]!).losses).toEqual([
      { stockId: den.id, creatureId: base.id, count: 2 },
    ]);
    const alive = () => stockView(data(), data().stocks[den.id]!).alive;
    const booked = bookLosses(db, fight.id)!;
    expect(booked.count).toBe(2);
    expect(alive()).toBe(3);
    expect(bookLosses(db, fight.id)).toBeNull();
    // „Von vorn“ erweckt niemanden, dessen Verlust verbucht ist.
    resetEncounter(db, fight.id);
    expect(foes().map((foe) => foe.hp)).toEqual([0, 0, null, null, null]);
    // Im Bestand sind noch drei; zwei davon stehen schon in der Begegnung.
    expect(fieldFromStock(db, fight.id, den.id, base.id, 5)).toBe(1);
    booked.undo();
    expect(alive()).toBe(5);
    expect(
      foes()
        .slice(0, 2)
        .every((foe) => !foe.booked),
    ).toBe(true);
  });

  it('am Spieltisch steht, wer am Ort der Gruppe haust', async () => {
    const { db, data, base } = await setup();
    const town = db.put('entities', createEntity({ kind: 'place', name: 'Graufels' }));
    const cellar = db.put(
      'entities',
      createEntity({ kind: 'place', name: 'Alter Keller', place: { parentId: town.id } }),
    );
    const far = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
    const den = newStock(db, 'Bau der Grubenschleicher');
    addGroup(db, den.id, base.id, 5);
    updateStock(db, den.id, { placeId: cellar.id });
    const elsewhere = newStock(db, 'Nest am Fluss');
    updateStock(db, elsewhere.id, { placeId: far.id });
    db.setState({ placeId: town.id });
    expect(stocksHere(data()).map((view) => view.stock.name)).toEqual(['Bau der Grubenschleicher']);
    db.setState({ placeId: far.id });
    expect(stocksHere(data()).map((view) => view.stock.name)).toEqual(['Nest am Fluss']);
    db.setState({ placeId: null });
    expect(stocksHere(data())).toEqual([]);
  });
});

describe('Kampfwerte eines Tieres', () => {
  it('verbindet Tier und Wesen in beide Richtungen und löst die Verbindung beim Löschen', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const wolf = db.put(
      'entities',
      createEntity({ kind: 'animal', name: 'Grauwolf', animal: { habitat: ['Wald'] } } as never),
    );
    expect(animalPreset(wolf)).toEqual({ name: 'Grauwolf', block: { habitat: 'Wald' } });
    const creature = saveCreature(db, {
      name: 'Grauwolf',
      kind: 'template',
      parentId: null,
      block: {},
      features: [],
      dropped: [],
      source: '',
      notes: '',
    });
    linkAnimalCreature(db, wolf.id, creature.id);
    const data = () => db.getSnapshot();
    expect(animalsOfCreature(data(), creature.id).map((a) => a.name)).toEqual(['Grauwolf']);
    const linked = data().entities[wolf.id]!;
    expect(linked.kind === 'animal' && creatureOfAnimal(data(), linked)?.id).toBe(creature.id);
    removeCreature(db, creature.id);
    const after = data().entities[wolf.id]!;
    expect(after.kind === 'animal' && after.animal.creatureId).toBeNull();
  });
});
