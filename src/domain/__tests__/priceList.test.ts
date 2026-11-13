import { describe, expect, it } from 'vitest';
import { parseCoins, parsePriceLines, planPriceLines } from '../priceList';
import { createEntity, type CampaignData, type Entity } from '../schema';

const world = (...entities: Entity[]): Pick<CampaignData, 'entities'> => ({
  entities: Object.fromEntries(entities.map((e) => [e.id, e])),
});

describe('Münzen lesen', () => {
  it('liest Gold, Silber, Kupfer und Platin – ausgeschrieben und abgekürzt', () => {
    expect(parseCoins('1 GM')).toBe(1);
    expect(parseCoins('50 Gold')).toBe(50);
    expect(parseCoins('2,5 GM')).toBe(2.5);
    expect(parseCoins('5 SM')).toBe(0.5);
    expect(parseCoins('5 Silberstücke')).toBe(0.5);
    expect(parseCoins('2 KM')).toBe(0.02);
    expect(parseCoins('3 Kupfer')).toBe(0.03);
    expect(parseCoins('1 PM')).toBe(10);
    expect(parseCoins('2 Platinmünzen')).toBe(20);
    expect(parseCoins('50gp')).toBe(50);
    expect(parseCoins('5 sp')).toBe(0.5);
    expect(parseCoins('1 EM')).toBe(0.5);
    expect(parseCoins('1.250 GM')).toBe(1250);
    expect(parseCoins('12')).toBe(12);
  });

  it('zählt zusammengesetzte Preise zusammen', () => {
    expect(parseCoins('1 GM 5 SM')).toBe(1.5);
    expect(parseCoins('1 Gold, 5 Silber und 2 Kupfer')).toBe(1.52);
    expect(parseCoins('2 GM + 3 KM')).toBe(2.03);
  });

  it('sagt, was es nicht lesen kann', () => {
    expect(parseCoins('')).toBeNull();
    expect(parseCoins('viel')).toBeUndefined();
    expect(parseCoins('5 Äpfel')).toBeUndefined();
  });
});

describe('Preislisten lesen', () => {
  it('liest Name und Preis mit verschiedenen Trennzeichen', () => {
    const { lines, unreadable } = parsePriceLines(
      [
        'Seil (15 m): 1 GM',
        'Heiltrank – 50 Gold',
        'Fackel ..... 1 KM',
        'Laterne = 5 GM',
        'Rucksack\t2 GM',
        'Kreide 1 KM',
      ].join('\n'),
    );
    expect(unreadable).toEqual([]);
    expect(lines.map((l) => [l.name, l.price])).toEqual([
      ['Seil (15 m)', 1],
      ['Heiltrank', 50],
      ['Fackel', 0.01],
      ['Laterne', 5],
      ['Rucksack', 2],
      ['Kreide', 0.01],
    ]);
  });

  it('nimmt Aufzählungszeichen, Verweise und Fettdruck weg', () => {
    const { lines } = parsePriceLines(
      '- [[Heiltrank]]: 50 GM\n* **Gegengift**: 25 GM\n1. Salbe: 3 SM',
    );
    expect(lines.map((l) => l.name)).toEqual(['Heiltrank', 'Gegengift', 'Salbe']);
  });

  it('liest Mengen vor dem Namen und hinter dem Preis', () => {
    const { lines } = parsePriceLines(
      '3× Heiltrank: 50 GM\nPfeile (20): 1 GM\nGegengift: 25 GM (2 Stück)\nKraut: 2 SM je Bund',
    );
    expect(lines.map((l) => [l.name, l.price, l.qty])).toEqual([
      ['Heiltrank', 50, 3],
      ['Pfeile (20)', 1, null],
      ['Gegengift', 25, 2],
      ['Kraut', 0.2, null],
    ]);
  });

  it('nimmt Überschriften als Einordnung der Zeilen darunter', () => {
    const { lines } = parsePriceLines('## Waffen\nDolch: 2 GM\n\nRüstungen:\nLederrüstung: 10 GM');
    expect(lines.map((l) => [l.name, l.category])).toEqual([
      ['Dolch', 'Waffen'],
      ['Lederrüstung', 'Rüstungen'],
    ]);
  });

  it('liest Tabellen', () => {
    const { lines } = parsePriceLines(
      '| Ware | Preis |\n|---|---|\n| Seil | 1 GM |\n| Fackel | 1 KM |',
    );
    expect(lines.map((l) => [l.name, l.price])).toEqual([
      ['Seil', 1],
      ['Fackel', 0.01],
    ]);
  });

  it('nimmt Zeilen ohne Preis, meldet aber unlesbare Preise', () => {
    const { lines, unreadable } = parsePriceLines('Wasserschlauch\nKarte: 3 Säcke Mehl');
    expect(lines.map((l) => [l.name, l.price])).toEqual([['Wasserschlauch', null]]);
    expect(unreadable).toEqual([{ line: 2, text: 'Karte: 3 Säcke Mehl' }]);
  });
});

describe('Zeilen und Einträge der Welt', () => {
  const rope = createEntity({ kind: 'item', name: 'Seil' });
  const potion = createEntity({ kind: 'item', name: 'Heiltrank', aliases: ['Roter Trank'] });
  const herb = createEntity({ kind: 'plant', name: 'Mondkraut' });
  const herbItem = createEntity({ kind: 'item', name: 'Mondkraut' });
  const odo = createEntity({ kind: 'person', name: 'Odo Tannhaus' });

  it('nimmt vorhandene Einträge nach Namen, auch ohne Zusatz in Klammern', () => {
    const plan = planPriceLines(
      world(rope, potion, herb, odo),
      parsePriceLines('Seil (15 m): 1 GM\nroter trank: 50 GM\nMondkraut: 2 SM\nZunder: 1 KM').lines,
    );
    expect(plan.map((p) => [p.entityId, p.create])).toEqual([
      [rope.id, false],
      [potion.id, false],
      [herb.id, false],
      [null, true],
    ]);
  });

  it('legt nie einen Namen doppelt an, den es schon gibt', () => {
    const plan = planPriceLines(world(odo), parsePriceLines('Odo Tannhaus: 5 GM').lines);
    expect(plan[0]).toMatchObject({ entityId: null, create: false });
    expect(plan[0]!.takenBy).toContain('Odo Tannhaus');
  });

  it('lässt wählen, wenn mehrere passen – Gegenstände zuerst', () => {
    const plan = planPriceLines(world(herb, herbItem), parsePriceLines('Mondkraut: 2 SM').lines);
    expect(plan[0]!.entityId).toBe(herbItem.id);
    expect(plan[0]!.choices).toEqual([herbItem.id, herb.id]);
  });
});
