import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  addRuleItems,
  newShop,
  stockLineToItem,
  takePriceList,
} from '../../features/laden/actions';
import { parsePriceLines, planPriceLines, withRulePrices } from '../priceList';
import { createEntity, createShop } from '../schema';
import {
  listOrRulePrice,
  ruleHits,
  rulePrice,
  ruleSuggestions,
  sellPrice,
  stockRows,
  stockedRuleIds,
} from '../shop';
import { SRD_ATTRIBUTION } from '../srd/attribution';
import { SRD_EQUIPMENT, SRD_GROUPS, srdCostToGold } from '../srd/equipment';
import { srdForShopKind, srdItem, srdMatch, srdSearch, srdWeightText } from '../srd/lookup';

/** Das Ergebnis von „Als Gegenstand anlegen“, wenn etwas angelegt oder verbunden wurde. */
const made_ = (result: ReturnType<typeof stockLineToItem>) => {
  if (!result || 'takenBy' in result) throw new Error('nicht angelegt');
  return result;
};

const byId = (id: string) => {
  const item = srdItem(id);
  if (!item) throw new Error(`fehlt: ${id}`);
  return item;
};

describe('Ausrüstung aus dem SRD 5.2.1', () => {
  it('hat stabile, eindeutige Kennungen und eindeutige Namen', () => {
    const ids = SRD_EQUIPMENT.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^srd-[a-z0-9-]+$/.test(id))).toBe(true);
    const names = SRD_EQUIPMENT.map((item) => item.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const en = SRD_EQUIPMENT.map((item) => item.en.toLowerCase());
    expect(new Set(en).size).toBe(en.length);
  });

  it('hat nur Preise ab null und lesbare Preise wie im SRD', () => {
    for (const item of SRD_EQUIPMENT) {
      expect(item.price).toBeGreaterThanOrEqual(0);
      expect(item.price).toBe(srdCostToGold(item.cost));
      if (item.lb !== null) expect(item.lb).toBeGreaterThan(0);
    }
    expect(() => srdCostToGold('1,000 GP')).toThrow();
  });

  it('füllt jede Gruppe', () => {
    for (const group of SRD_GROUPS)
      expect(SRD_EQUIPMENT.some((item) => item.group === group.id)).toBe(true);
    expect(SRD_EQUIPMENT.filter((item) => item.group === 'weapons')).toHaveLength(38);
    expect(SRD_EQUIPMENT.filter((item) => item.group === 'armor')).toHaveLength(13);
  });

  it('kennt bekannte Preise des SRD', () => {
    expect(byId('srd-longsword')).toMatchObject({ name: 'Langschwert', price: 15, lb: 3 });
    expect(byId('srd-dagger').price).toBe(2);
    expect(byId('srd-club').price).toBe(0.1);
    expect(byId('srd-dart').price).toBe(0.05);
    expect(byId('srd-plate-armor')).toMatchObject({ price: 1500, lb: 65 });
    expect(byId('srd-chain-mail')).toMatchObject({ price: 75, lb: 55 });
    expect(byId('srd-shield').price).toBe(10);
    expect(byId('srd-rope').price).toBe(1);
    expect(byId('srd-potion-of-healing').price).toBe(50);
    expect(byId('srd-spyglass').price).toBe(1000);
    expect(byId('srd-healers-kit').price).toBe(5);
    expect(byId('srd-riding-horse').price).toBe(75);
    expect(byId('srd-warhorse').price).toBe(400);
    expect(byId('srd-ale').price).toBe(0.04);
    expect(byId('srd-inn-modest').price).toBe(0.5);
    expect(byId('srd-airship').price).toBe(40000);
    expect(byId('srd-thieves-tools').price).toBe(25);
    expect(byId('srd-lute').price).toBe(35);
    expect(byId('srd-magic-rare').price).toBe(4000);
    expect(byId('srd-lifestyle-wretched').price).toBe(0);
  });

  it('nennt die Lizenz im geforderten Wortlaut', () => {
    expect(SRD_ATTRIBUTION.en).toContain('System Reference Document 5.2.1');
    expect(SRD_ATTRIBUTION.en).toContain('Creative Commons Attribution 4.0 International License');
    expect(SRD_ATTRIBUTION.en).toContain('https://www.dndbeyond.com/srd');
  });
});

describe('Nachschlagen', () => {
  it('erkennt Namen deutsch und englisch, mit und ohne Zusatz', () => {
    expect(srdMatch('Langschwert')?.id).toBe('srd-longsword');
    expect(srdMatch('longsword')?.id).toBe('srd-longsword');
    expect(srdMatch('Seil (15 m)')?.id).toBe('srd-rope');
    expect(srdMatch('Pfeile')?.id).toBe('srd-arrows');
    expect(srdMatch('Thieves’ Tools')?.id).toBe('srd-thieves-tools');
    expect(srdMatch('Bottle, Glass')?.id).toBe('srd-glass-bottle');
    expect(srdMatch('HEILTRANK')?.id).toBe('srd-potion-of-healing');
    // Mehrdeutig oder unbekannt: keiner.
    expect(srdMatch('Zauberschriftrolle')).toBeNull();
    expect(srdMatch('Räucherwurst')).toBeNull();
    expect(srdMatch('')).toBeNull();
  });

  it('sucht deutsch und englisch, Namensanfang zuerst', () => {
    expect(srdSearch('schwert').map((i) => i.id)).toEqual(
      expect.arrayContaining(['srd-longsword', 'srd-shortsword', 'srd-greatsword']),
    );
    expect(srdSearch('sword')[0]?.id).not.toBeUndefined();
    expect(srdSearch('lang')[0]?.name.startsWith('Lang')).toBe(true);
    expect(srdSearch('armbrust schwer').map((i) => i.id)).toEqual(['srd-heavy-crossbow']);
    expect(srdSearch('', ['armor'])).toHaveLength(13);
  });

  it('schlägt nach Art des Ladens vor', () => {
    const smith = srdForShopKind('Waffenschmiede');
    expect(smith.items.some((i) => i.id === 'srd-longsword')).toBe(true);
    expect(smith.items.some((i) => i.id === 'srd-plate-armor')).toBe(true);
    expect(smith.items.some((i) => i.id === 'srd-ale')).toBe(false);
    const inn = srdForShopKind('Gasthaus');
    expect(inn.items.some((i) => i.id === 'srd-inn-modest')).toBe(true);
    expect(inn.labels).toEqual(['Gasthaus']);
    const stable = srdForShopKind('Pferdehändler');
    expect(stable.items.some((i) => i.id === 'srd-riding-saddle')).toBe(true);
    // „Pferdehändler“ ist kein Krämer.
    expect(stable.items.some((i) => i.id === 'srd-backpack')).toBe(false);
    expect(srdForShopKind('Krämer').items.some((i) => i.id === 'srd-backpack')).toBe(true);
    expect(srdForShopKind('Kräuterhändlerin').items.map((i) => i.id)).toEqual(
      expect.arrayContaining(['srd-healers-kit', 'srd-antitoxin']),
    );
    expect(srdForShopKind('Goldschmied').items.some((i) => i.id === 'srd-longsword')).toBe(false);
    expect(srdForShopKind('Werkzeugmacher').items.some((i) => i.id === 'srd-smiths-tools')).toBe(
      true,
    );
    expect(srdForShopKind('', '  ').items).toEqual([]);
    // „Fähre“ ist ein Hafen, „erfahren“ nicht.
    expect(srdForShopKind('Fähre').labels).toEqual(['Hafen']);
    expect(srdForShopKind('Erfahrene Klingen').labels).toEqual(['Waffen']);
  });

  it('zeigt Gewichte wie die deutschen Regelbücher', () => {
    expect(srdWeightText(3)).toBe('1,5 kg');
    expect(srdWeightText(null)).toBe('');
  });
});

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const town = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const shop = newShop(db, { title: 'Eichwalds Esse', kind: 'Schmiede', placeId: town.id });
  return { db, town, shop };
}

describe('Läden mit dem Regelwerk', () => {
  it('nimmt Gegenstände nur auf Wahl in den Bestand – ohne Einträge der Welt, nie doppelt', async () => {
    const { db, shop } = await setup();
    const entities = Object.keys(db.getSnapshot().entities).length;
    const result = addRuleItems(db, shop.id, ['srd-longsword', 'srd-shield', 'srd-longsword']);
    expect(result?.added).toBe(2);
    expect(Object.keys(db.getSnapshot().entities)).toHaveLength(entities);
    const stock = db.getSnapshot().shops[shop.id]!.stock;
    expect(stock.map((s) => [s.text, s.srdId, s.entityId, s.price])).toEqual([
      ['Langschwert', 'srd-longsword', null, null],
      ['Schild', 'srd-shield', null, null],
    ]);
    expect(addRuleItems(db, shop.id, ['srd-longsword'])?.added).toBe(0);
    result!.undo();
    expect(db.getSnapshot().shops[shop.id]!.stock).toEqual([]);
  });

  it('rechnet den Preis nach dem Regelwerk mal Preisfaktor', async () => {
    const { db, shop } = await setup();
    db.patch('shops', shop.id, { priceFactor: 1.25 });
    addRuleItems(db, shop.id, ['srd-longsword']);
    const data = db.getSnapshot();
    const [row] = stockRows(data, data.shops[shop.id]!);
    expect(row).toMatchObject({ price: 18.75, own: false, listPrice: null });
    expect(row!.rule?.id).toBe('srd-longsword');
    expect(row!.category).toBe('Nahkampf-Kriegswaffe');
    expect(rulePrice(data.shops[shop.id]!, byId('srd-longsword'))).toBe(18.75);
  });

  it('nimmt für Worte ohne Preis und Gegenstände ohne Preis den Preis des Regelwerks', async () => {
    const { db, shop } = await setup();
    const rope = db.put('entities', createEntity({ kind: 'item', name: 'Seil' }));
    const priced = db.put(
      'entities',
      createEntity({ kind: 'item', name: 'Dolch', item: { price: 3 } }),
    );
    db.patch('shops', shop.id, {
      stock: [
        { id: 'a', entityId: null, text: 'Kurzschwert', price: null, qty: null, srdId: null },
        { id: 'b', entityId: rope.id, text: 'Seil', price: null, qty: null, srdId: null },
        { id: 'c', entityId: priced.id, text: 'Dolch', price: null, qty: null, srdId: null },
        { id: 'd', entityId: null, text: 'Räucherwurst', price: null, qty: null, srdId: null },
      ],
    });
    const data = db.getSnapshot();
    const rows = stockRows(data, data.shops[shop.id]!);
    expect(rows.map((r) => [r.price, r.rule?.id ?? null])).toEqual([
      [10, 'srd-shortsword'],
      [1, 'srd-rope'],
      [3, null],
      [null, null],
    ]);
    expect(listOrRulePrice(rope)).toBe(1);
    expect(listOrRulePrice(priced)).toBe(3);
    // Der Ankauf richtet sich ebenso danach: die Hälfte.
    expect(sellPrice(data.shops[shop.id]!, rope)).toBe(0.5);
    expect(stockedRuleIds(data, data.shops[shop.id]!)).toEqual(
      new Set(['srd-shortsword', 'srd-rope', 'srd-dagger']),
    );
  });

  it('schlägt nach der Art vor – ohne das, was der Laden schon führt', async () => {
    const { db, shop } = await setup();
    addRuleItems(db, shop.id, ['srd-longsword']);
    const data = db.getSnapshot();
    const { items, labels } = ruleSuggestions(data, data.shops[shop.id]!);
    expect(labels).toContain('Schmiede');
    expect(items.some((i) => i.id === 'srd-shortsword')).toBe(true);
    expect(items.some((i) => i.id === 'srd-longsword')).toBe(false);
    const plain = createShop({ kind: '' });
    expect(ruleSuggestions(data, plain).items).toEqual([]);
  });

  it('findet am Tisch, was nicht im Bestand ist – erst ab zwei Buchstaben', async () => {
    const { db, shop } = await setup();
    addRuleItems(db, shop.id, ['srd-longsword']);
    const data = db.getSnapshot();
    const s = data.shops[shop.id]!;
    expect(ruleHits(data, s, 'l')).toEqual([]);
    const hits = ruleHits(data, s, 'schwert');
    expect(hits.some((i) => i.id === 'srd-longsword')).toBe(false);
    expect(hits.some((i) => i.id === 'srd-shortsword')).toBe(true);
    expect(ruleHits(data, null, 'longsword')[0]?.id).toBe('srd-longsword');
  });

  it('legt eine Zeile nur auf Wunsch als Gegenstand an – und nimmt einen vorhandenen', async () => {
    const { db, shop } = await setup();
    addRuleItems(db, shop.id, ['srd-longsword', 'srd-riding-horse']);
    const [sword, horse] = db.getSnapshot().shops[shop.id]!.stock;
    const made = made_(stockLineToItem(db, shop.id, sword!.id));
    expect(made).toMatchObject({ created: true, rule: true });
    const entity = db.getSnapshot().entities[made.entityId]!;
    expect(entity).toMatchObject({ kind: 'item', name: 'Langschwert' });
    expect(entity.kind === 'item' && entity.item.price).toBe(15);
    expect(db.getSnapshot().shops[shop.id]!.stock[0]!.entityId).toBe(made.entityId);
    // Ein Reittier wird ein Tier.
    const pony = made_(stockLineToItem(db, shop.id, horse!.id));
    expect(db.getSnapshot().entities[pony.entityId]!.kind).toBe('animal');
    // Gibt es den Namen schon, wird er genommen.
    pony.undo();
    made.undo();
    expect(db.getSnapshot().entities[made.entityId]).toBeUndefined();
    const existing = db.put('entities', createEntity({ kind: 'item', name: 'Langschwert' }));
    const linked = stockLineToItem(db, shop.id, sword!.id)!;
    expect(linked).toMatchObject({ created: false, entityId: existing.id });
  });

  it('legt keinen zweiten Eintrag an, wenn eine Person den Namen trägt – nimmt aber ein Tier', async () => {
    const { db, shop } = await setup();
    addRuleItems(db, shop.id, ['srd-pike', 'srd-mastiff']);
    const [pike, dog] = db.getSnapshot().shops[shop.id]!.stock;
    db.put('entities', createEntity({ kind: 'person', name: 'Pike' }));
    const count = Object.keys(db.getSnapshot().entities).length;
    expect(stockLineToItem(db, shop.id, pike!.id)).toEqual({ takenBy: 'Pike (Person)' });
    expect(Object.keys(db.getSnapshot().entities)).toHaveLength(count);
    expect(db.getSnapshot().shops[shop.id]!.stock[0]!.entityId).toBeNull();
    // Ein Tier gleichen Namens ist ein Eintrag zum Handeln: Es wird genommen, nicht verdoppelt.
    const mastiff = db.put('entities', createEntity({ kind: 'animal', name: 'Mastiff' }));
    expect(stockLineToItem(db, shop.id, dog!.id)).toMatchObject({
      created: false,
      entityId: mastiff.id,
    });
    // Eine Zeile ohne Regelwerk wird ein Gegenstand ohne Listenpreis; der Preis im Laden bleibt.
    db.patch('shops', shop.id, {
      stock: [
        ...db.getSnapshot().shops[shop.id]!.stock,
        { id: 'wurst', entityId: null, text: 'Räucherwurst', price: 0.05, qty: null, srdId: null },
      ],
    });
    const wurst = made_(stockLineToItem(db, shop.id, 'wurst'));
    expect(wurst).toMatchObject({ created: true, rule: false });
    const item = db.getSnapshot().entities[wurst.entityId]!;
    expect(item.kind === 'item' && item.item.price).toBeNull();
  });

  it('ergänzt in der Preisliste fehlende Preise nach dem Regelwerk', async () => {
    const { db, shop } = await setup();
    const plans = planPriceLines(
      db.getSnapshot(),
      parsePriceLines('Langschwert\nKurzschwert: 12 GM\nRäucherwurst').lines,
    );
    expect(plans.map((p) => p.rule?.id ?? null)).toEqual(['srd-longsword', 'srd-shortsword', null]);
    const filled = withRulePrices(plans);
    expect(filled.map((p) => p.price)).toEqual([15, 12, null]);
    const result = takePriceList(
      db,
      shop.id,
      filled.map((plan) => ({ plan, entityId: plan.entityId })),
    );
    expect(result.created).toBe(3);
    const sword = Object.values(db.getSnapshot().entities).find((e) => e.name === 'Langschwert');
    expect(sword?.kind === 'item' && sword.item.price).toBe(15);
  });
});
