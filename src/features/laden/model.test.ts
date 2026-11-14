import { describe, expect, it } from 'vitest';
import { createEntity, createShop, type ShopStock } from '../../domain/schema';
import type { Sellable, StockRow } from '../../domain/shop';
import { srdItem } from '../../domain/srd/lookup';
import {
  addEntity,
  addFree,
  addRow,
  addRuleItem,
  addSellable,
  basketProblem,
  basketTotal,
  inBasket,
  newKindOf,
  sellerOf,
  setPrice,
  setQty,
  tradeInputOf,
} from './model';

const line = (init: Partial<ShopStock>): ShopStock => ({
  id: 'l1',
  entityId: null,
  text: '',
  price: null,
  qty: null,
  srdId: null,
  ...init,
});

const row = (init: Partial<StockRow>): StockRow => ({
  line: line({}),
  entity: null,
  name: 'Seil',
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
    });
    const one = addSellable([], sellable(sword, 'lando'));
    expect(sellerOf(one)).toBe('lando');
    expect(sellerOf(addSellable(one, sellable(idol, null)))).toBeUndefined();
    expect(tradeInputOf(one, 'shop', 'sell', 'lando')).toEqual({
      shopId: 'shop',
      direction: 'sell',
      toId: 'lando',
      lines: [{ entityId: sword.id, stockId: null, text: 'Graufelser Klinge', qty: 1, price: 10 }],
    });
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
