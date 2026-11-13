import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { removeRecorded } from '../../data/record';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { saveLoot, giveLoot } from '../../features/beute/actions';
import { onTheRoad } from '../../features/gruppe/march';
import {
  acceptShopSuggestions,
  newShop,
  takePriceList,
  tradeAt,
} from '../../features/laden/actions';
import { recordHeadline } from '../chronicleKinds';
import { holdersOf, itemHistory } from '../itemHistory';
import { lootBook } from '../loot';
import { parsePriceLines, planPriceLines } from '../priceList';
import { createEntity, type Item } from '../schema';
import {
  buysThing,
  filterRows,
  formatPrice,
  groupItems,
  priceLevelLabel,
  readFactor,
  sellPrice,
  sellables,
  shopSuggestions,
  shopTitle,
  shopTrades,
  shopsHere,
  shopsOf,
  stockRows,
  tradeTotals,
} from '../shop';

/** Hohenfurt mit dem Markt, Krämer Odo Tannhaus und zwei erfundenen Gefährten. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  for (const entity of Object.values(db.getSnapshot().entities))
    if (entity.kind === 'character') db.remove('entities', entity.id);
  const data = () => db.getSnapshot();
  const put = <E extends Parameters<typeof db.put<'entities'>>[1]>(entity: E) =>
    db.put('entities', entity) as E;
  const town = put(createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const market = put(createEntity({ kind: 'place', name: 'Markt', place: { parentId: town.id } }));
  const grotto = put(createEntity({ kind: 'place', name: 'Salzgrotte' }));
  db.setState({ placeId: town.id });
  const odo = put(
    createEntity({ kind: 'person', name: 'Odo Tannhaus', person: { placeId: market.id } }),
  );
  const mira = put(createEntity({ kind: 'character', name: 'Mira' }));
  const lando = put(createEntity({ kind: 'character', name: 'Lando Furtner' }));
  const rope = put(
    createEntity({ kind: 'item', name: 'Seil', item: { price: 1, category: 'Ausrüstung' } }),
  );
  const potion = put(
    createEntity({ kind: 'item', name: 'Heiltrank', item: { price: 50, category: 'Trank' } }),
  );
  const compass = put(
    createEntity({
      kind: 'item',
      name: 'Kompass der Tiefe',
      item: { price: 80, holderId: odo.id },
    }),
  );
  const herb = put(
    createEntity({
      kind: 'plant',
      name: 'Mondkraut',
      plant: { category: 'Kraut', price: 0.2, regionIds: [town.id] },
    }),
  );
  const shop = newShop(db, {
    title: '',
    kind: 'Krämer',
    keeperId: odo.id,
    placeId: market.id,
    priceFactor: 1.25,
    stock: [
      { id: 'seil', entityId: rope.id, text: 'Seil', price: null, qty: null },
      { id: 'trank', entityId: potion.id, text: 'Heiltrank', price: null, qty: 3 },
      { id: 'kompass', entityId: compass.id, text: 'Kompass der Tiefe', price: 100, qty: 1 },
      { id: 'wurst', entityId: null, text: 'Räucherwurst', price: 0.05, qty: null },
    ],
  });
  return { db, data, town, market, grotto, odo, mira, lando, rope, potion, compass, herb, shop };
}

describe('Preise', () => {
  it('schreibt Preise, wie man sie am Tisch liest', () => {
    expect(formatPrice(50)).toBe('50 GM');
    expect(formatPrice(1.25)).toBe('1,25 GM');
    expect(formatPrice(0.5)).toBe('5 SM');
    expect(formatPrice(0.03)).toBe('3 KM');
    expect(priceLevelLabel(1.25)).toBe('teuer');
    expect(priceLevelLabel(1.1)).toBe('110 %');
    expect(readFactor('1,25')).toBe(1.25);
    expect(readFactor('80 %')).toBe(0.8);
    expect(readFactor('teuer')).toBeNull();
  });
});

describe('Läden', () => {
  it('rechnet den Bestand: eigener Preis oder Listenpreis mal Faktor', async () => {
    const { data, shop } = await setup();
    const rows = stockRows(data(), data().shops[shop.id]!);
    expect(rows.map((r) => [r.name, r.price, r.own, r.qty, r.single])).toEqual([
      ['Seil', 1.25, false, null, false],
      ['Heiltrank', 62.5, false, 3, false],
      ['Kompass der Tiefe', 100, true, 1, true],
      ['Räucherwurst', 0.05, true, null, false],
    ]);
    expect(filterRows(rows, 'trank').map((r) => r.name)).toEqual(['Heiltrank']);
    expect(filterRows(rows, 'ausrüst').map((r) => r.name)).toEqual(['Seil']);
    expect(shopTitle(data(), shop)).toBe('Krämer · Odo Tannhaus');
  });

  it('steht am Ort der Gruppe, an Orten darin und beim Händler', async () => {
    const { db, data, shop, odo, market, grotto } = await setup();
    expect(shopsHere(data()).map((s) => s.id)).toEqual([shop.id]);
    expect(shopsOf(data(), market.id).map((s) => s.id)).toEqual([shop.id]);
    expect(shopsOf(data(), odo.id).map((s) => s.id)).toEqual([shop.id]);
    db.setState({ placeId: grotto.id });
    expect(shopsHere(data())).toEqual([]);
    // Ein fahrender Händler: Der Laden ist dort, wo er ist.
    db.patch('shops', shop.id, { placeId: null });
    db.put('entities', { ...odo, person: { ...odo.person, placeId: grotto.id } });
    expect(shopsHere(data()).map((s) => s.id)).toEqual([shop.id]);
  });

  it('kauft an, was zu seinen Einordnungen passt – zum halben Listenpreis', async () => {
    const { data, shop, potion, herb } = await setup();
    const s = { ...data().shops[shop.id]!, buys: ['Pflanze'] };
    expect(buysThing(s, herb)).toBe(true);
    expect(buysThing(s, potion)).toBe(false);
    expect(buysThing({ ...s, buys: [] }, potion)).toBe(true);
    expect(sellPrice(s, potion)).toBe(25);
    expect(sellPrice(null, herb)).toBe(0.1);
  });
});

describe('Handel', () => {
  it('hält einen Kauf als einen Eintrag fest und zieht den Bestand mit', async () => {
    const { db, data, shop, mira, rope, potion } = await setup();
    const result = tradeAt(db, {
      shopId: shop.id,
      direction: 'buy',
      toId: mira.id,
      lines: [
        { entityId: rope.id, qty: 2, price: 1.25 },
        { entityId: potion.id, qty: 2, price: 62.5, stockId: 'trank' },
      ],
    });
    if ('problem' in result) throw new Error(result.problem);
    const entries = Object.values(data().chronicle).filter((e) => e.kind === 'trade');
    expect(entries).toHaveLength(1);
    expect(result.entry.trade!.total).toBe(127.5);
    expect(result.entry.placeId).toBe(data().shops[shop.id]!.placeId);
    expect(result.entry.refs).toEqual(expect.arrayContaining([mira.id, rope.id, potion.id]));
    expect(recordHeadline(data(), result.entry)).toBe(
      'Mira kauft bei Krämer · Odo Tannhaus: 2× Seil, 2× Heiltrank · 127,5 GM',
    );
    expect(data().shops[shop.id]!.stock.find((s) => s.id === 'trank')!.qty).toBe(1);
    expect(data().shops[shop.id]!.stock.find((s) => s.id === 'seil')!.qty).toBeNull();
    // Kaufen ist keine Beute.
    expect(lootBook(data()).gold).toBe(0);
    expect(shopTrades(data(), shop.id).map((e) => e.id)).toEqual([result.entry.id]);
    expect(tradeTotals(data())).toMatchObject({ spent: 127.5, earned: 0 });

    result.undo();
    expect(data().shops[shop.id]!.stock.find((s) => s.id === 'trank')!.qty).toBe(3);
    expect(shopTrades(data(), shop.id)).toEqual([]);
  });

  it('verkauft nicht mehr, als da ist', async () => {
    const { db, shop, potion } = await setup();
    const result = tradeAt(db, {
      shopId: shop.id,
      direction: 'buy',
      lines: [{ entityId: potion.id, qty: 4, price: 62.5 }],
    });
    expect(result).toEqual({ problem: 'Von Heiltrank sind nur noch 3 da.' });
  });

  it('gibt ein einzelnes Stück dem Käufer – und Löschen nimmt es zurück', async () => {
    const { db, data, shop, mira, compass, odo } = await setup();
    const result = tradeAt(db, {
      shopId: shop.id,
      direction: 'buy',
      toId: mira.id,
      lines: [{ entityId: compass.id, qty: 1, price: 100 }],
    });
    if ('problem' in result) throw new Error(result.problem);
    const item = () => data().entities[compass.id] as Item;
    expect(item().item.holderId).toBe(mira.id);
    expect(data().shops[shop.id]!.stock.find((s) => s.id === 'kompass')!.qty).toBe(0);
    expect(itemHistory(data(), compass.id).map((e) => e.label)).toContain('Gekauft');
    expect(holdersOf(data(), compass.id).map((h) => h.holderId)).toEqual([odo.id, mira.id]);
    // Ein zweites Mal geht nicht: Er ist ausverkauft.
    expect(
      tradeAt(db, {
        shopId: shop.id,
        direction: 'buy',
        lines: [{ entityId: compass.id, price: 100 }],
      }),
    ).toEqual({ problem: 'Kompass der Tiefe ist ausverkauft.' });

    removeRecorded(db, result.entry.id);
    expect(item().item.holderId).toBe(odo.id);
    expect(data().shops[shop.id]!.stock.find((s) => s.id === 'kompass')!.qty).toBe(1);
  });

  it('verkauft Gegenstände der Gruppe an den Laden', async () => {
    const { db, data, shop, mira, lando, odo } = await setup();
    const sword = db.put(
      'entities',
      createEntity({
        kind: 'item',
        name: 'Graufelser Klinge',
        item: { price: 40, holderId: lando.id },
      }),
    );
    const idol = db.put(
      'entities',
      createEntity({ kind: 'item', name: 'Krummzahns Götze', item: { price: 30 } }),
    );
    giveLoot(
      db,
      saveLoot(db, { text: '', gold: 0, itemId: idol.id, toId: null, source: '', storyId: null })!
        .id,
    );
    expect(groupItems(data()).has(idol.id)).toBe(true);
    const offer = sellables(data(), data().shops[shop.id]!);
    expect(offer.map((s) => [s.entity.name, s.ownerId, s.price])).toEqual([
      ['Krummzahns Götze', null, 15],
      ['Graufelser Klinge', lando.id, 20],
    ]);
    const result = tradeAt(db, {
      shopId: shop.id,
      direction: 'sell',
      toId: lando.id,
      lines: [{ entityId: sword.id, price: 20 }],
    });
    if ('problem' in result) throw new Error(result.problem);
    expect((data().entities[sword.id] as Item).item.holderId).toBe(odo.id);
    const added = data().shops[shop.id]!.stock.find((s) => s.entityId === sword.id);
    expect(added).toMatchObject({ qty: 1, price: null });
    expect(tradeTotals(data()).net.get(lando.id)).toBe(20);
    expect(recordHeadline(data(), result.entry)).toBe(
      'Lando Furtner verkauft an Krämer · Odo Tannhaus: Graufelser Klinge · 20 GM',
    );

    removeRecorded(db, result.entry.id);
    expect((data().entities[sword.id] as Item).item.holderId).toBe(lando.id);
    expect(data().shops[shop.id]!.stock.some((s) => s.entityId === sword.id)).toBe(false);
    expect(mira.id).toBeTruthy();
  });

  it('zieht Gekauftes vom Gold der Gruppe ab und zählt Verkauftes dazu', async () => {
    const { db, data, mira } = await setup();
    giveLoot(
      db,
      saveLoot(db, { text: '', gold: 100, itemId: null, toId: null, source: '', storyId: null })!
        .id,
    );
    tradeAt(db, { direction: 'buy', lines: [{ text: 'Proviant', qty: 4, price: 0.5 }] });
    tradeAt(db, { direction: 'sell', toId: mira.id, lines: [{ text: 'Wolfsfell', price: 3 }] });
    const road = onTheRoad(data());
    expect(road).toMatchObject({ groupGold: 98, totalGold: 101, groupTrade: -2, totalTrade: 1 });
  });

  it('handelt auch ohne Laden, mit Worten statt Einträgen', async () => {
    const { db, data } = await setup();
    const result = tradeAt(
      db,
      { direction: 'sell', lines: [{ text: 'Wolfsfelle', qty: 3, price: 2 }] },
      { text: 'beim Gerber am Fluss' },
    );
    if ('problem' in result) throw new Error(result.problem);
    expect(recordHeadline(data(), result.entry)).toBe('Die Gruppe verkauft: 3× Wolfsfelle · 6 GM');
    expect(tradeAt(db, { direction: 'buy', lines: [] })).toEqual({ problem: 'Was wird gekauft?' });
  });
});

describe('Bestand pflegen', () => {
  it('übernimmt eine Preisliste: vorhandene Einträge nach Namen, fehlende als Gegenstände', async () => {
    const { db, data, herb } = await setup();
    const shop = newShop(db, { kind: 'Kräuterhändler' });
    db.patch('entities', herb.id, { plant: { ...herb.plant, price: null } });
    const plan = planPriceLines(
      data(),
      parsePriceLines('## Tränke\nHeiltrank: 45 GM (2)\nMondkraut: 3 SM\nGegengift: 25 GM').lines,
    );
    const result = takePriceList(
      db,
      shop.id,
      plan.map((p) => ({ plan: p, entityId: p.entityId })),
    );
    expect(result).toMatchObject({ created: 1, priced: 1, stocked: 3 });
    const antidote = Object.values(data().entities).find((e) => e.name === 'Gegengift') as Item;
    expect(antidote.item).toMatchObject({ price: 25, category: 'Tränke' });
    const rows = stockRows(data(), data().shops[shop.id]!);
    expect(rows.map((r) => [r.name, r.price, r.own, r.qty])).toEqual([
      ['Heiltrank', 45, true, 2],
      ['Mondkraut', 0.3, false, null],
      ['Gegengift', 25, false, null],
    ]);
    // Kein Name doppelt: ein zweites Mal legt nichts an.
    const again = planPriceLines(data(), parsePriceLines('Gegengift: 25 GM').lines);
    expect(again[0]).toMatchObject({ entityId: antidote.id, create: false });

    result.undo();
    expect(data().entities[antidote.id]).toBeUndefined();
    expect(data().shops[shop.id]!.stock).toEqual([]);
    expect(
      data().entities[herb.id]!.kind === 'plant' &&
        (data().entities[herb.id] as typeof herb).plant.price,
    ).toBeNull();
  });

  it('schlägt Einträge des Spielleiters vor, die zum Laden passen – nur auf Annahme', async () => {
    const { db, data, town, potion } = await setup();
    const shop = newShop(db, { kind: 'Kräuterhändlerin', placeId: town.id, buys: ['Trank'] });
    const suggestions = shopSuggestions(data(), shop);
    expect(suggestions.map((s) => [s.entity.name, s.price])).toEqual([
      ['Mondkraut', 0.2],
      ['Heiltrank', 50],
    ]);
    expect(suggestions[0]!.reason).toBe('wächst hier');
    expect(data().shops[shop.id]!.stock).toEqual([]);
    const undo = acceptShopSuggestions(db, shop.id, [potion.id])!;
    expect(stockRows(data(), data().shops[shop.id]!).map((r) => r.name)).toEqual(['Heiltrank']);
    expect(shopSuggestions(data(), data().shops[shop.id]!).map((s) => s.entity.name)).toEqual([
      'Mondkraut',
    ]);
    undo();
    expect(data().shops[shop.id]!.stock).toEqual([]);
  });
});
