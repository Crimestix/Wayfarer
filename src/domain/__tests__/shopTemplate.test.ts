import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  addProposedLines,
  newShop,
  newShopTemplate,
  rememberAsTemplate,
  removeShopTemplate,
  tradeAt,
} from '../../features/laden/actions';
import { recordHeadline } from '../chronicleKinds';
import { parsePriceLines } from '../priceList';
import { createCreature, createEntity } from '../schema';
import {
  amountText,
  creatureSuggestions,
  priceWithUnit,
  readUnit,
  sellPrice,
  shopSuggestions,
  shopsHereTitle,
  stockLine,
  stockRows,
  wareGroups,
} from '../shop';
import {
  inStock,
  kindKey,
  templateFit,
  templateProposals,
  templateTextOf,
  templatesFor,
  wayfarerProposals,
} from '../shopTemplate';

/** Hohenfurt mit Brann Eichwalds Schmiede, ein paar Waren und einem Wesen des Bestiariums. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const data = () => db.getSnapshot();
  const put = <E extends Parameters<typeof db.put<'entities'>>[1]>(entity: E) =>
    db.put('entities', entity) as E;
  const town = put(createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const house = put(
    createEntity({ kind: 'place', name: 'Haus am Markt', place: { parentId: town.id } }),
  );
  db.setState({ placeId: town.id });
  const brann = put(createEntity({ kind: 'person', name: 'Brann Eichwald' }));
  const mira = put(createEntity({ kind: 'character', name: 'Mira' }));
  const sword = put(
    createEntity({ kind: 'item', name: 'Langschwert', item: { category: 'Waffe' } }),
  );
  const arrows = put(
    createEntity({ kind: 'item', name: 'Eschenpfeile', item: { price: 1, category: 'Munition' } }),
  );
  const salt = put(
    createEntity({
      kind: 'mineral',
      name: 'Salz',
      mineral: { price: 0.05, category: 'Würze', regionIds: [town.id] },
    }),
  );
  const ferret = put(
    createEntity({ kind: 'animal', name: 'Frettchen', animal: { price: 3, category: 'Haustier' } }),
  );
  const mastiff = db.put('creatures', createCreature({ name: 'Mastiff', block: { type: 'Tier' } }));
  const ghoul = db.put(
    'creatures',
    createCreature({ name: 'Grubenschleicher', block: { type: 'Untoter' } }),
  );
  const smithy = newShop(db, { kind: 'Schmiede', keeperId: brann.id, placeId: town.id });
  return {
    db,
    data,
    town,
    house,
    brann,
    mira,
    sword,
    arrows,
    salt,
    ferret,
    mastiff,
    ghoul,
    smithy,
  };
}

describe('Einheiten und Mengen', () => {
  it('liest und schreibt Einheiten für Handelsgüter', () => {
    expect(readUnit('Pfund')).toBe('je Pfund');
    expect(readUnit('pro Sack')).toBe('je Sack');
    expect(readUnit('/ Fass')).toBe('je Fass');
    expect(readUnit('Stück')).toBe('');
    expect(readUnit('')).toBe('');
    expect(priceWithUnit(0.05, 'je Pfund')).toBe('5 KM je Pfund');
    expect(amountText(20, 'Salz', 'je Pfund')).toBe('20 Pfund Salz');
    expect(amountText(3, 'Seil')).toBe('3× Seil');
    expect(amountText(1, 'Seil')).toBe('Seil');
  });

  it('liest die Einheit in einer Preisliste mit', () => {
    const { lines } = parsePriceLines('Salz: 5 KM je Pfund (40)\nTuch: 1 SM pro elle\nSeil: 1 GM');
    expect(lines.map((l) => [l.name, l.price, l.unit, l.qty])).toEqual([
      ['Salz', 0.05, 'je Pfund', 40],
      ['Tuch', 0.1, 'je Elle', null],
      ['Seil', 1, '', null],
    ]);
  });

  it('hält Handelsgüter mit Einheit fest: „20 Pfund Salz“', async () => {
    const { db, data, smithy, salt, mira } = await setup();
    db.patch('shops', smithy.id, {
      stock: [
        stockLine({ id: 'salz', entityId: salt.id, text: 'Salz', unit: 'je Pfund', qty: 50 }),
      ],
    });
    const row = stockRows(data(), data().shops[smithy.id]!)[0]!;
    expect(row).toMatchObject({ unit: 'je Pfund', price: 0.05, qty: 50 });
    const result = tradeAt(db, {
      shopId: smithy.id,
      direction: 'buy',
      toId: mira.id,
      lines: [{ entityId: salt.id, qty: 20, price: 0.05, unit: 'je Pfund' }],
    });
    if ('problem' in result) throw new Error(result.problem);
    expect(result.entry.trade!.total).toBe(1);
    expect(recordHeadline(data(), result.entry)).toBe(
      'Mira kauft bei Schmiede · Brann Eichwald: 20 Pfund Salz · 1 GM',
    );
    expect(data().shops[smithy.id]!.stock[0]!.qty).toBe(30);
  });
});

describe('Läden ohne Grenzen', () => {
  it('handelt jeden Eintrag der Welt – auch ein Haus', async () => {
    const { db, data, house, smithy } = await setup();
    const result = tradeAt(db, {
      shopId: smithy.id,
      direction: 'buy',
      lines: [{ entityId: house.id, price: 800 }],
    });
    if ('problem' in result) throw new Error(result.problem);
    expect(result.entry.trade!.lines[0]).toMatchObject({
      entityId: house.id,
      text: 'Haus am Markt',
    });
    expect(result.entry.refs).toContain(house.id);
    expect(data().entities[house.id]!.kind).toBe('place');
  });

  it('führt Wesen des Bestiariums im Bestand – mit Preis nach dem Regelwerk, wenn es passt', async () => {
    const { db, data, smithy, mastiff, ghoul } = await setup();
    db.patch('shops', smithy.id, {
      stock: [
        stockLine({ id: 'm', creatureId: mastiff.id }),
        stockLine({ id: 'g', creatureId: ghoul.id, price: 12 }),
      ],
    });
    const rows = stockRows(data(), data().shops[smithy.id]!);
    expect(rows.map((r) => [r.name, r.category, r.price, r.creature?.id])).toEqual([
      ['Mastiff', 'Tier', 25, mastiff.id],
      ['Grubenschleicher', 'Untoter', 12, ghoul.id],
    ]);
  });

  it('gruppiert alles zur Wahl nach Art – als Hilfe, nichts fällt weg', async () => {
    const { data, house, sword, salt } = await setup();
    const groups = wareGroups(data(), '');
    const labels = groups.map((g) => g.label);
    expect(labels.slice(0, 4)).toEqual([
      'Gegenstände',
      'Tiere',
      'Gesteine',
      'Wesen des Bestiariums',
    ]);
    expect(labels.at(-1)).toBe('Weitere Einträge der Welt');
    const rest = groups.at(-1)!.options.map((o) => o.entityId);
    expect(rest).toContain(house.id);
    const found = wareGroups(data(), 'mast');
    expect(found.map((g) => g.label)).toEqual(['Wesen des Bestiariums']);
    expect(found[0]!.options[0]).toMatchObject({ name: 'Mastiff', sub: 'Tier', price: 25 });
    const without = wareGroups(data(), '', { exclude: new Set([sword.id, salt.id]) });
    expect(without.flatMap((g) => g.options).some((o) => o.entityId === sword.id)).toBe(false);
    expect(without.map((g) => g.label)).not.toContain('Gesteine');
  });

  it('zahlt auf einem Handelsplatz für Handelsgüter den vollen Wert und schlägt Gesuchtes auf', async () => {
    const { data, smithy, salt, sword } = await setup();
    const shop = { ...data().shops[smithy.id]!, buyFactor: 0.5 };
    expect(sellPrice(shop, salt)).toBe(0.03);
    const market = { ...shop, market: true, demand: [{ id: 'd', text: 'Salz', factor: 2 }] };
    expect(sellPrice(market, salt)).toBe(0.1);
    expect(sellPrice(market, sword)).toBe(7.5);
  });

  it('nennt den Abschnitt am Tisch nach dem, was dort steht', () => {
    expect(shopsHereTitle([{ market: false }])).toBe('Läden hier');
    expect(shopsHereTitle([{ market: false }, { market: true }])).toBe(
      'Läden und Handelsplätze hier',
    );
    expect(shopsHereTitle([{ market: true }])).toBe('Handelsplatz hier');
    expect(shopsHereTitle([{ market: true }, { market: true }])).toBe('Handelsplätze hier');
  });
});

describe('Vorlagen für Ladenarten', () => {
  it('vergleicht Ladenarten ohne Endungen und ordnet Vorlagen, ohne eine wegzulassen', async () => {
    const { db, data } = await setup();
    expect(kindKey('Schmiede')).toBe(kindKey('Schmied'));
    expect(kindKey('Kräuterhändlerin')).toBe(kindKey('Kräuterhändler'));
    expect(templateFit({ kind: 'Schmied' }, 'Waffenschmiede')).toBe(1);
    expect(templateFit({ kind: 'Schmied' }, 'Bäcker')).toBeNull();
    const smith = newShopTemplate(db, { kind: 'Schmied', text: 'Hufeisen: 2 SM' });
    const baker = newShopTemplate(db, { kind: 'Bäcker', text: 'Brot' });
    const sorted = templatesFor(data(), 'Schmiede');
    expect(sorted.fitting.map((t) => t.id)).toEqual([smith.id]);
    expect(sorted.others.map((t) => t.id)).toEqual([baker.id]);
    const undo = removeShopTemplate(db, baker.id)!;
    expect(data().assortments[baker.id]).toBeUndefined();
    undo();
    expect(data().assortments[baker.id]).toBeDefined();
  });

  it('macht aus einer Vorlage Zeilen zum Ankreuzen – Welt, Bestiarium, Regelwerk, Worte', async () => {
    const { db, data, smithy, sword, mastiff, salt } = await setup();
    const template = newShopTemplate(db, {
      kind: 'Schmiede',
      text: '## Waffen\nLangschwert: 18 GM\nKurzschwert\nMastiff\nSalz: 5 KM je Pfund (20)\nHufeisen: 2 SM',
    });
    const { proposals, unreadable } = templateProposals(data(), data().shops[smithy.id]!, template);
    expect(unreadable).toEqual([]);
    expect(
      proposals.map((p) => [p.name, p.line.entityId, p.line.creatureId, p.line.srdId, p.price]),
    ).toEqual([
      ['Langschwert', sword.id, null, null, 18],
      ['Kurzschwert', null, null, 'srd-shortsword', 10],
      ['Mastiff', null, mastiff.id, null, 25],
      ['Salz', salt.id, null, null, 0.05],
      ['Hufeisen', null, null, null, 0.2],
    ]);
    expect(proposals[0]!.reason).toBe('Waffen');
    // Ein Preis gleich dem Listenpreis ist kein eigener Preis des Ladens.
    expect(proposals[3]!.line).toMatchObject({ price: null, unit: 'je Pfund', qty: 20 });
    expect(proposals[4]!.line.price).toBe(0.2);
    expect(data().shops[smithy.id]!.stock).toEqual([]);

    const picked = proposals.filter((p) => p.name !== 'Hufeisen').map((p) => p.line);
    const result = addProposedLines(db, smithy.id, picked)!;
    expect(result.added).toBe(4);
    const after = templateProposals(data(), data().shops[smithy.id]!, template).proposals;
    expect(after.map((p) => p.have)).toEqual([true, true, true, true, false]);
    // Ein zweites Mal kommt nichts doppelt.
    expect(addProposedLines(db, smithy.id, picked)!.added).toBe(0);
    result.undo();
    expect(data().shops[smithy.id]!.stock).toEqual([]);
  });

  it('merkt einen Laden als Vorlage seiner Art – und liest sie gleich wieder', async () => {
    const { db, data, smithy, sword, salt, mastiff } = await setup();
    db.patch('shops', smithy.id, {
      stock: [
        stockLine({ entityId: sword.id, text: 'Langschwert', price: 18 }),
        stockLine({ entityId: salt.id, text: 'Salz', unit: 'je Pfund', qty: 20 }),
        stockLine({ text: 'Kurzschwert', srdId: 'srd-shortsword', qty: 3 }),
        stockLine({ creatureId: mastiff.id }),
        stockLine({ text: 'Zauber wirken lassen: Zaubertrick', srdId: 'srd-spellcasting-cantrip' }),
      ],
    });
    const shop = data().shops[smithy.id]!;
    expect(templateTextOf(data(), shop)).toBe(
      [
        'Langschwert: 18 GM',
        'Salz: 5 KM je Pfund (20)',
        'Kurzschwert: 10 GM (3)',
        'Mastiff',
        'Zauber wirken lassen: Zaubertrick: 30 GM',
      ].join('\n'),
    );
    const first = rememberAsTemplate(db, smithy.id)!;
    expect(first).toMatchObject({ replaced: false, template: { kind: 'Schmiede' } });
    const again = templateProposals(data(), shop, data().assortments[first.template.id]!);
    expect(again.proposals.every((p) => p.have)).toBe(true);
    expect(again.proposals[1]!.line).toMatchObject({
      entityId: salt.id,
      unit: 'je Pfund',
      qty: 20,
    });

    db.patch('shops', smithy.id, { stock: [stockLine({ text: 'Hufeisen', price: 0.2 })] });
    const second = rememberAsTemplate(db, smithy.id)!;
    expect(second.replaced).toBe(true);
    expect(data().assortments[first.template.id]!.text).toBe('Hufeisen: 2 SM');
    second.undo();
    expect(data().assortments[first.template.id]!.text).toContain('Langschwert');
    db.patch('shops', smithy.id, { kind: '' });
    expect(rememberAsTemplate(db, smithy.id)).toBeNull();
  });

  it('schlägt vor: Regelwerk, Einträge mit passendem Namen, Tiere beim Tierhändler', async () => {
    const { db, data, smithy, sword, ferret, salt, mastiff, ghoul } = await setup();
    const proposals = wayfarerProposals(data(), data().shops[smithy.id]!);
    expect(proposals.ruleLabels).toEqual(['Schmiede']);
    expect(proposals.rules.some((p) => p.line.srdId === 'srd-longsword')).toBe(true);
    expect(proposals.world.map((p) => [p.name, p.reason])).toContainEqual([
      'Langschwert',
      'passt zu „Schmiede“',
    ]);
    expect(proposals.world.map((p) => p.line.entityId)).toContain(sword.id);
    expect(proposals.creatures).toEqual([]);

    const pets = newShop(db, { kind: 'Haustierhändlerin', placeId: data().state.placeId });
    expect(shopSuggestions(data(), pets).map((s) => s.entity.id)).toEqual(
      expect.arrayContaining([ferret.id]),
    );
    expect(shopSuggestions(data(), pets).map((s) => s.entity.id)).not.toContain(salt.id);
    const beasts = creatureSuggestions(data(), pets);
    expect(beasts.map((s) => [s.creature.id, s.price])).toEqual([[mastiff.id, 25]]);
    expect(beasts.map((s) => s.creature.id)).not.toContain(ghoul.id);
    const ruled = wayfarerProposals(data(), pets);
    expect(ruled.ruleLabels).toEqual(['Tierhandel']);
    expect(ruled.creatures.map((p) => p.line.creatureId)).toEqual([mastiff.id]);
  });

  it('erkennt, was der Laden schon führt – auch an Namen', async () => {
    const { db, data, smithy } = await setup();
    db.patch('shops', smithy.id, { stock: [stockLine({ text: 'Hufeisen' })] });
    const shop = data().shops[smithy.id]!;
    expect(
      inStock(data(), shop, { entityId: null, creatureId: null, srdId: null, text: 'hufeisen' }),
    ).toBe(true);
    expect(
      inStock(data(), shop, { entityId: null, creatureId: null, srdId: null, text: 'Nagel' }),
    ).toBe(false);
  });
});
