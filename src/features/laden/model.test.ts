import { describe, expect, it } from 'vitest';
import { createCreature, createEntity, createShop, type ShopStock } from '../../domain/schema';
import type { Sellable, StockRow } from '../../domain/shop';
import { srdItem } from '../../domain/srd/lookup';
import {
  addCreature,
  addEntity,
  addFree,
  addRow,
  addRuleItem,
  addSellable,
  basketProblem,
  basketTotal,
  inBasket,
  newKindOf,
  ruleChoice,
  ruleSections,
  sellerOf,
  setPrice,
  setQty,
  tradeInputOf,
  auctionFor,
  readQty,
  setUnit,
  meansInBasket,
} from './model';
import type { Die } from '../../domain/market';

const line = (init: Partial<ShopStock>): ShopStock => ({
  id: 'l1',
  entityId: null,
  text: '',
  price: null,
  qty: null,
  srdId: null,
  creatureId: null,
  unit: '',
  ...init,
});

const row = (init: Partial<StockRow>): StockRow => ({
  line: line({}),
  entity: null,
  creature: null,
  name: 'Seil',
  unit: '',
  price: 1,
  own: false,
  listPrice: 1,
  rule: null,
  qty: null,
  soldOut: false,
  single: false,
  category: '',
  ...init,
});

describe('Der Korb', () => {
  it('zählt dieselbe Ware hoch – nie über den Bestand', () => {
    const potion = row({ line: line({ id: 'p', qty: 2 }), name: 'Heiltrank', price: 50, qty: 2 });
    let basket = addRow([], potion);
    basket = addRow(basket, potion);
    basket = addRow(basket, potion);
    expect(inBasket(basket, 'stock:p')).toBe(2);
    expect(setQty(basket, 'stock:p', 9)[0]!.qty).toBe(2);
    expect(setQty(basket, 'stock:p', 0)).toEqual([]);
    expect(addRow([], row({ line: line({ id: 'x', qty: 0 }), qty: 0 }))).toEqual([]);
  });

  it('rechnet die Summe und sagt, was fehlt', () => {
    let basket = addRow([], row({ line: line({ id: 's' }), price: 1.25 }));
    basket = setQty(basket, 'stock:s', 3);
    basket = addFree(basket, 'Räucherwurst', null);
    expect(basketTotal(basket)).toBe(3.75);
    expect(basketProblem(basket, 'buy')).toBe('Für Räucherwurst fehlt ein Preis.');
    basket = setPrice(basket, basket[1]!.key, 0.05);
    expect(basketProblem(basket, 'buy')).toBe('');
    expect(basketTotal(basket)).toBe(3.8);
    expect(basketProblem([], 'buy')).toBe('Der Korb ist leer.');
  });

  it('nimmt Einträge der Welt zum Preis des Ladens oder zum Ankauf', () => {
    const shop = createShop({ priceFactor: 1.5, buyFactor: 0.5 });
    const sword = createEntity({ kind: 'item', name: 'Graufelser Klinge', item: { price: 40 } });
    expect(addEntity([], sword, shop, 'buy')[0]!.price).toBe(60);
    expect(addEntity([], sword, shop, 'sell')[0]!.price).toBe(20);
    expect(addEntity([], sword, null, 'buy')[0]!.price).toBe(40);
  });

  it('kennt den Verkäufer, wenn alles einem gehört', () => {
    const sword = createEntity({ kind: 'item', name: 'Graufelser Klinge' });
    const idol = createEntity({ kind: 'item', name: 'Götze' });
    const sellable = (entity: typeof sword, ownerId: string | null): Sellable => ({
      entity,
      ownerId,
      price: 10,
      wanted: true,
      demand: null,
    });
    const one = addSellable([], sellable(sword, 'lando'));
    expect(sellerOf(one)).toBe('lando');
    expect(sellerOf(addSellable(one, sellable(idol, null)))).toBeUndefined();
    expect(tradeInputOf(one, 'shop', 'sell', 'lando')).toEqual({
      shopId: 'shop',
      direction: 'sell',
      toId: 'lando',
      lines: [
        {
          entityId: sword.id,
          stockId: null,
          text: 'Graufelser Klinge',
          qty: 1,
          price: 10,
          unit: '',
        },
      ],
    });
  });

  it('nimmt Mengen und Einheiten in Worten – und Gesuchtes als Hinweis beim Verkauf', () => {
    const market = createShop({ market: true, demand: [{ id: 'd', text: 'Salz', factor: 1.5 }] });
    const sold = addFree([], 'Steinsalz', 0.05, {
      shop: market,
      direction: 'sell',
      qty: 40,
      unit: 'Pfund',
    });
    expect(sold[0]).toMatchObject({ qty: 40, unit: 'je Pfund', worth: 0.05 });
    expect(sold[0]!.demand?.id).toBe('d');
    expect(
      addFree([], 'Steinsalz', 0.05, { shop: market, direction: 'buy' })[0]!.demand,
    ).toBeNull();
    expect(readQty('12')).toBe(12);
    expect(readQty('0')).toBeNull();
    expect(readQty('2,5')).toBeNull();
    expect(setUnit(sold, sold[0]!.key, 'Sack')[0]!.unit).toBe('je Sack');
  });

  it('versteigert eine Zeile um ihren Wert – Seltenes breiter', () => {
    const [line] = addFree([], 'Sternsaphir', 400);
    const six: Die = () => 6;
    expect(auctionFor(line!, six)).toMatchObject({ bid: 600, wide: false });
    expect(auctionFor({ ...line!, rarity: 'rare' }, six)).toMatchObject({ bid: 700, wide: true });
    expect(auctionFor({ ...line!, worth: null, price: null }, six)).toBeNull();
  });

  it('zahlt für ein Tier des Bestiariums auf einem Handelsplatz den vollen Wert – wie für Vieh der Welt', () => {
    const mastiff = createCreature({ name: 'Mastiff', block: { type: 'Tier' } });
    const ghoul = createCreature({ name: 'Grubenschleicher', block: { type: 'Untoter' } });
    const data = { creatures: { [mastiff.id]: mastiff, [ghoul.id]: ghoul } };
    const shop = createShop({ buyFactor: 0.5 });
    const market = createShop({ buyFactor: 0.5, market: true });
    expect(addCreature([], data, mastiff.id, shop, 'sell')[0]!.price).toBe(12.5);
    expect(addCreature([], data, mastiff.id, market, 'sell')[0]!.price).toBe(25);
    expect(addCreature([], data, mastiff.id, market, 'buy')[0]!.price).toBe(25);
    // Ohne Preis im Regelwerk bleibt er offen – der Spielleiter nennt ihn.
    expect(addCreature([], data, ghoul.id, market, 'sell')[0]!.price).toBeNull();
  });
});

describe('Neue Namen einer Preisliste', () => {
  it('legt sie nach fester Regel als Pflanze, Gestein, Tier oder Gegenstand an', () => {
    const kind = (name: string, category = '') => newKindOf({ name, category });
    // Was der Name sagt: gewachsen, aus dem Boden, von Hand gemacht.
    expect(kind('Mondkraut')).toBe('plant');
    expect(kind('Fliegenpilz')).toBe('plant');
    expect(kind('Eisenerz')).toBe('mineral');
    expect(kind('Heiltrank', 'Kräuter')).toBe('item');
    // Sonst die Überschrift darüber.
    expect(kind('Salbei', 'Kräuter')).toBe('plant');
    expect(kind('Maultier', 'Reittiere')).toBe('animal');
    expect(kind('Bergkristall (klein)', 'Edelsteine')).toBe('mineral');
    // Ware aus Tieren ist kein Tier; ohne Hinweis ein Gegenstand.
    expect(kind('Räucherfisch')).toBe('item');
    expect(kind('Seil (15 m)', 'Ausrüstung')).toBe('item');
  });
});

describe('Aus dem Regelwerk in den Korb', () => {
  it('nimmt den Preis des Regelwerks mal Preisfaktor und zählt hoch', () => {
    const sword = srdItem('srd-longsword')!;
    const shop = createShop({ priceFactor: 1.5 });
    let basket = addRuleItem([], sword, shop);
    basket = addRuleItem(basket, sword, shop);
    expect(basket).toEqual([
      expect.objectContaining({
        key: 'srd:srd-longsword',
        text: 'Langschwert',
        qty: 2,
        price: 22.5,
      }),
    ]);
    expect(addRuleItem([], sword, null)[0]!.price).toBe(15);
    expect(tradeInputOf(basket, shop.id, 'buy', null).lines[0]).toMatchObject({
      entityId: null,
      text: 'Langschwert',
      qty: 2,
      price: 22.5,
    });
  });
});

describe('Reittiere und Schiffe im Korb', () => {
  it('erkennt sie aus dem Regelwerk, der Welt und dem Bestand', () => {
    const shop = createShop({
      stock: [
        {
          id: 's1',
          entityId: null,
          text: 'Pony',
          price: null,
          qty: null,
          srdId: 'srd-pony',
          creatureId: 'c1',
          unit: '',
        },
      ],
    });
    const seewind = createEntity({ kind: 'item', name: 'Seewind', item: { category: 'Schiff' } });
    const data = { entities: { [seewind.id]: seewind } };
    let basket = addRuleItem([], srdItem('srd-riding-horse')!, shop);
    basket = addRuleItem(basket, srdItem('srd-rope')!, shop);
    basket = addFree(basket, 'Ochsenkarren', 12, { shop, direction: 'buy' });
    basket = [
      ...basket,
      {
        key: 'stock:s1',
        entityId: null,
        stockId: 's1',
        text: 'Pony',
        qty: 2,
        price: 30,
        max: null,
      },
      {
        key: 'e',
        entityId: seewind.id,
        stockId: null,
        text: 'Seewind',
        qty: 1,
        price: 900,
        max: 1,
      },
    ];
    const offers = meansInBasket(data, shop, basket);
    expect(offers.map((o) => [o.values.name, o.values.kind, o.qty])).toEqual([
      ['Reitpferd', 'mount', 1],
      ['Ochsenkarren', 'vehicle', 1],
      ['Pony', 'mount', 2],
      ['Seewind', 'ship', 1],
    ]);
    expect(offers[0]!.values).toMatchObject({ capacity: 480, builtIn: true });
    expect(offers[2]!.values).toMatchObject({ creatureId: 'c1', capacity: 225 });
    expect(offers[3]!.values.entityId).toBe(seewind.id);
  });
});

describe('Das Nachschlagewerk durchsehen', () => {
  it('zeigt die gewählten Gruppen, den Vorschlag und die Suche', () => {
    const none = { groups: [], suggested: null, query: '' };
    expect(ruleChoice(none)).toEqual([]);
    expect(ruleChoice({ ...none, query: 'longsword' }).map((i) => i.id)).toEqual(['srd-longsword']);
    const armor = ruleChoice({ ...none, groups: ['armor'] });
    expect(armor).toHaveLength(13);
    expect(ruleChoice({ ...none, groups: ['armor', 'ammunition'] })).toHaveLength(18);
    expect(ruleChoice({ ...none, groups: ['armor'], query: 'ketten' }).map((i) => i.id)).toEqual([
      'srd-chain-shirt',
      'srd-chain-mail',
    ]);
    const suggested = [srdItem('srd-ale')!, srdItem('srd-bread')!];
    expect(ruleChoice({ ...none, suggested }).map((i) => i.id)).toEqual(['srd-ale', 'srd-bread']);
    expect(ruleSections(armor).map((s) => [s.sub, s.items.length])).toEqual([
      ['Leichte Rüstung', 3],
      ['Mittelschwere Rüstung', 5],
      ['Schwere Rüstung', 4],
      ['Schild', 1],
    ]);
  });
});
