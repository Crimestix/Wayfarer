import { describe, expect, it } from 'vitest';
import {
  auctionBid,
  auctionDetail,
  bidStep,
  buyShare,
  demandOf,
  demandText,
  isWideRarity,
  looksLikeAuction,
  looksLikeMarket,
  rarityOf,
  readDemandFactor,
  type Die,
} from '../market';
import { createEntity, createShop } from '../schema';

/** Ein Würfel, der der Reihe nach diese Augen zeigt. */
const loaded =
  (...faces: number[]): Die =>
  () =>
    faces.shift() ?? 1;

describe('Handelsplätze', () => {
  it('erkennt Märkte, Häfen, Auktionshäuser und Hehler – nur als Hinweis', () => {
    expect(looksLikeMarket('Wochenmarkt')).toBe(true);
    expect(looksLikeMarket('', 'Hafen von Hohenfurt')).toBe(true);
    expect(looksLikeMarket('Auktionshaus')).toBe(true);
    expect(looksLikeMarket('Hehler')).toBe(true);
    expect(looksLikeMarket('Schmiede')).toBe(false);
    expect(looksLikeAuction('Versteigerung bei Ilka Sturmfels')).toBe(true);
    expect(looksLikeAuction('Markt')).toBe(false);
  });

  it('liest Auf- und Abschläge, wie man sie schreibt', () => {
    expect(readDemandFactor('+50 %')).toBe(1.5);
    expect(readDemandFactor('50%')).toBe(1.5);
    expect(readDemandFactor('−30 %')).toBe(0.7);
    expect(readDemandFactor('-25')).toBe(0.75);
    expect(readDemandFactor('x2')).toBe(2);
    expect(readDemandFactor('×1,5')).toBe(1.5);
    expect(readDemandFactor('-100 %')).toBeNull();
    expect(readDemandFactor('viel')).toBeNull();
    expect(demandText(1.5)).toBe('+50 %');
    expect(demandText(0.7)).toBe('−30 %');
    expect(demandText(1)).toBe('±0 %');
  });

  it('findet, was gesucht oder nicht gefragt ist – Name vor Einordnung und Art', () => {
    const shop = createShop({
      market: true,
      demand: [
        { id: 'a', text: 'Salz', factor: 1.5 },
        { id: 'b', text: 'Pelz', factor: 0.7 },
        { id: 'c', text: 'Gestein', factor: 1.2 },
      ],
    });
    expect(demandOf(shop, { name: 'Steinsalz', kind: 'Gestein' })?.id).toBe('a');
    expect(demandOf(shop, { name: 'Wolfspelz' })?.id).toBe('b');
    expect(demandOf(shop, { name: 'Eisenerz', kind: 'Gestein' })?.id).toBe('c');
    expect(demandOf(shop, { name: 'Seil' })).toBeNull();
    expect(demandOf(null, { name: 'Salz' })).toBeNull();
    // Was etwas ist, steht im Deutschen am Ende: eine Salzdistel ist eine Distel, kein Salz.
    expect(demandOf(shop, { name: 'Salzdistel', kind: 'Pflanze' })).toBeNull();
    expect(demandOf(shop, { name: 'Pelze' })?.id).toBe('b');
    expect(demandOf(shop, { name: 'Grobes Salz' })?.id).toBe('a');
  });

  it('zahlt auf dem Markt den vollen Wert für Handelsgüter, sonst den Ankauf – mal Gesuchtem', () => {
    const salt = createEntity({ kind: 'mineral', name: 'Salz', mineral: { price: 0.05 } });
    const sword = createEntity({ kind: 'item', name: 'Graufelser Klinge', item: { price: 40 } });
    const shop = createShop({ buyFactor: 0.5 });
    expect(buyShare(shop, salt)).toBe(0.5);
    const market = { ...shop, market: true };
    expect(buyShare(market, salt)).toBe(1);
    expect(buyShare(market, sword)).toBe(0.5);
    const wanted = { ...market, demand: [{ id: 'a', text: 'Salz', factor: 1.5 }] };
    expect(buyShare(wanted, salt)).toBe(1.5);
    expect(buyShare(null, sword)).toBe(0.5);
  });
});

describe('Versteigern', () => {
  it('bietet in Schritten nach der Höhe', () => {
    expect(bidStep(0.5)).toBe(0.01);
    expect(bidStep(5)).toBe(0.1);
    expect(bidStep(50)).toBe(1);
    expect(bidStep(500)).toBe(5);
    expect(bidStep(5000)).toBe(50);
    expect(bidStep(50000)).toBe(500);
  });

  it('würfelt vier W6: die Mitte ist der Wert, 5 % je Punkt – 50 bis 150 %', () => {
    const mid = auctionBid(100, false, loaded(3, 4, 3, 4));
    expect(mid).toMatchObject({ dice: [3, 4, 3, 4], share: 1, bid: 100, low: 50, high: 150 });
    expect(auctionBid(100, false, loaded(1, 1, 1, 1))).toMatchObject({ share: 0.5, bid: 50 });
    expect(auctionBid(100, false, loaded(6, 6, 6, 6))).toMatchObject({ share: 1.5, bid: 150 });
    const odd = auctionBid(37, false, loaded(6, 5, 2, 3));
    // 16 Augen → 110 % von 37 GM = 40,7 → in ganzen Gold geboten.
    expect(odd).toMatchObject({ share: 1.1, bid: 41 });
    expect(auctionDetail(odd)).toBe('4 W6: 6, 5, 2, 3 → 110 % des Werts');
  });

  it('bietet bei seltenen Dingen breiter: ein Viertel bis sieben Viertel', () => {
    const low = auctionBid(4000, true, loaded(1, 1, 1, 1));
    expect(low).toMatchObject({ share: 0.25, bid: 1000, low: 1000, high: 7000, wide: true });
    expect(auctionBid(4000, true, loaded(6, 6, 6, 6)).bid).toBe(7000);
    expect(isWideRarity('rare')).toBe(true);
    expect(isWideRarity('uncommon')).toBe(false);
    const gem = createEntity({
      kind: 'mineral',
      name: 'Sternsaphir',
      mineral: { rarity: 'very-rare' },
    });
    expect(rarityOf(gem)).toBe('very-rare');
    expect(rarityOf(null)).toBe('');
  });

  it('bietet nie null für etwas mit Wert und nichts für etwas ohne', () => {
    expect(auctionBid(0.01, false, loaded(1, 1, 1, 1)).bid).toBe(0.01);
    expect(auctionBid(0, false, loaded(6, 6, 6, 6)).bid).toBe(0);
  });
});
