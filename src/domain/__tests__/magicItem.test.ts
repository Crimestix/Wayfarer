import { describe, expect, it } from 'vitest';
import { craftPlan, emptyRecipe } from '../crafting';
import {
  ATTUNEMENT_LIMIT,
  attunementOf,
  chargesText,
  emptyMagic,
  itemsByRarity,
  magicRarityFromText,
  magicTag,
  nextDawn,
  playerFacts,
  playerMagicLine,
  rarityRuleItem,
  readAttunement,
  readCharges,
  rechargedCharges,
  rechargesDue,
  rollRecharge,
  rollText,
  stepCharges,
  valueOf,
  withMaxCharges,
} from '../magicItem';
import { isWideRarity, rarityOf } from '../market';
import {
  PARTY_ID,
  createEntity,
  emptyCollections,
  type CampaignData,
  type Charges,
  type Item,
  type Magic,
  type Rest,
} from '../schema';
import { listOrRulePrice, ruleItemOf, sellPrice } from '../shop';

const item = (name: string, more: Partial<Item['item']> = {}): Item =>
  createEntity({ kind: 'item', name, item: more });
const magic = (more: Partial<Magic> = {}) => emptyMagic(more);
const charges = (more: Partial<Charges> = {}): Charges => ({
  max: 7,
  current: 7,
  recharge: '1W6+1 bei Morgengrauen',
  spentAt: null,
  ...more,
});

/** Eine erfundene Welt: Mira und Lando, dazu was sie tragen. */
function world(items: Item[], now = 10_000, rests: Rest[] = []): CampaignData {
  const data = emptyCollections();
  const mira = { ...createEntity({ kind: 'character', name: 'Mira' }), id: 'mira' };
  const lando = { ...createEntity({ kind: 'character', name: 'Lando Furtner' }), id: 'lando' };
  for (const entity of [mira, lando, ...items]) data.entities[entity.id] = entity;
  for (const rest of rests) data.rests[rest.id] = rest;
  return { ...data, state: { now } } as unknown as CampaignData;
}

describe('Wert eines Gegenstands', () => {
  it('nimmt den eigenen Preis, sonst den Richtwert nach Seltenheit', () => {
    expect(valueOf(item('Seil', { price: 1 }))).toEqual({ gold: 1, from: 'own', note: '' });
    expect(valueOf(item('Brannsche Laterne', { magic: magic({ rarity: 'rare' }) }))).toEqual({
      gold: 4000,
      from: 'rarity',
      note: 'Richtwert nach Seltenheit',
    });
    // Ein eigener Preis geht immer vor.
    expect(
      valueOf(item('Brannsche Laterne', { price: 900, magic: magic({ rarity: 'rare' }) }))?.gold,
    ).toBe(900);
    expect(valueOf(item('Stein'))).toBeNull();
    expect(valueOf(createEntity({ kind: 'person', name: 'Odo Tannhaus' }))).toBeNull();
  });

  it('halbiert Verbrauchsgüter wie das SRD – außer Zauberschriftrollen', () => {
    const potion = item('Salzgrottentrank', {
      magic: magic({ rarity: 'uncommon', consumable: true, type: 'Trank' }),
    });
    expect(valueOf(potion)?.gold).toBe(200);
    const scroll = item('Schriftrolle der Furt', {
      magic: magic({ rarity: 'uncommon', consumable: true, type: 'Zauberschriftrolle' }),
    });
    expect(valueOf(scroll)?.gold).toBe(400);
  });

  it('gibt Artefakten und Magie ohne Seltenheit keinen Richtwert', () => {
    expect(valueOf(item('Eichwalds Krone', { magic: magic({ rarity: 'artifact' }) }))).toBeNull();
    expect(valueOf(item('Seltsamer Stein', { magic: magic() }))).toBeNull();
  });

  it('liest alte Rezepte mit Seltenheit weiter', () => {
    const old = item('Alter Ring', { recipe: { ...emptyRecipe(), rarity: 'very-rare' } });
    expect(rarityRuleItem(old)?.price).toBe(40000);
    expect(rarityOf(old)).toBe('very-rare');
  });

  it('gilt in Läden: Listenpreis, Ankauf und Seltenes breit geboten', () => {
    const ring = item('Ring der Furt', { magic: magic({ rarity: 'rare' }) });
    expect(ruleItemOf(ring)?.id).toBe('srd-magic-rare');
    expect(listOrRulePrice(ring)).toBe(4000);
    expect(sellPrice(null, ring)).toBe(2000);
    expect(isWideRarity(rarityOf(item('Krone', { magic: magic({ rarity: 'artifact' }) })))).toBe(
      true,
    );
    // Ein magischer Gegenstand mit dem Namen einer Ausrüstung richtet sich nach der Seltenheit.
    expect(listOrRulePrice(item('Langschwert', { magic: magic({ rarity: 'uncommon' }) }))).toBe(
      400,
    );
  });
});

describe('Herstellen nach der Seltenheit der Magie', () => {
  it('nimmt Seltenheit und Verbrauchsgut aus der Magie, nicht aus dem Rezept', () => {
    const recipe = { ...emptyRecipe(), rarity: 'common' as const };
    expect(craftPlan(recipe, null, { rarity: 'rare', consumable: true })).toMatchObject({
      days: 25,
      cost: 1000,
      magic: true,
    });
    const artifact = craftPlan(emptyRecipe(), null, { rarity: 'artifact', consumable: false });
    expect(artifact).toMatchObject({ days: null, cost: null, daysFrom: 'missing', magic: true });
  });
});

describe('Steckbrief', () => {
  it('liest Seltenheit, Einstimmung und Ladungen', () => {
    expect(magicRarityFromText('Sehr selten')).toBe('very-rare');
    expect(magicRarityFromText('Artefakt')).toBe('artifact');
    expect(magicRarityFromText('selten (W100)')).toBe('rare');
    expect(magicRarityFromText('gewöhnlich')).toBe('common');
    expect(magicRarityFromText('irgendwie')).toBeNull();

    expect(readAttunement('erfordert Einstimmung')).toEqual({ required: true, by: '' });
    expect(readAttunement('Einstimmung durch einen Zauberwirker')).toEqual({
      required: true,
      by: 'durch einen Zauberwirker',
    });
    expect(readAttunement('nein')).toEqual({ required: false, by: '' });
    expect(readAttunement('ja')).toEqual({ required: true, by: '' });

    expect(readCharges('7 Ladungen, 1W6+1 bei Morgengrauen')).toEqual({
      max: 7,
      recharge: '1W6+1 bei Morgengrauen',
    });
    expect(readCharges('3 (alle bei Morgengrauen)')).toEqual({
      max: 3,
      recharge: 'alle bei Morgengrauen',
    });
    expect(readCharges('10')).toEqual({ max: 10, recharge: '' });
    expect(readCharges('keine')).toBeNull();
  });
});

describe('Ladungen', () => {
  it('würfelt den Ausdruck aus dem Text', () => {
    const roll = rollRecharge(charges({ current: 1 }), () => 4);
    expect(roll).toEqual({ gained: 5, rolls: [4], bonus: 1, formula: '1W6+1' });
    expect(rollText(roll!)).toBe('1W6+1: 4 + 1 = 5');
    expect(rollRecharge(charges({ recharge: '2d4 nach einer langen Rast' }), () => 3)).toEqual({
      gained: 6,
      rolls: [3, 3],
      bonus: 0,
      formula: '2W4',
    });
    expect(rollRecharge(charges({ recharge: 'alle bei Morgengrauen' }), () => 1)?.gained).toBe(7);
    expect(rollRecharge(charges({ recharge: '' }), () => 1)).toBeNull();
  });

  it('frischt nie über den Höchstwert auf und schließt das Angebot', () => {
    expect(rechargedCharges(charges({ current: 5, spentAt: 10 }), 6)).toMatchObject({
      current: 7,
      spentAt: null,
    });
  });

  it('merkt sich die erste verbrauchte Ladung', () => {
    const one = stepCharges(charges(), -1, 100);
    expect(one).toMatchObject({ current: 6, spentAt: 100 });
    expect(stepCharges(one, -1, 200)).toMatchObject({ current: 5, spentAt: 100 });
    expect(stepCharges(charges({ current: 0 }), -1, 300).current).toBe(0);
    expect(stepCharges(charges({ current: 6, spentAt: 100 }), 1, 300)).toMatchObject({
      current: 7,
      spentAt: null,
    });
    expect(chargesText(charges({ current: 3 }))).toBe('3 von 7 Ladungen, 1W6+1 bei Morgengrauen');
    // Ein neuer Höchstwert füllt nur auf, wenn alle da waren.
    expect(withMaxCharges(charges({ max: 1, current: 1 }), 7).current).toBe(7);
    expect(withMaxCharges(charges({ current: 3 }), 10).current).toBe(3);
    expect(withMaxCharges(charges({ current: 6 }), 4).current).toBe(4);
  });

  it('bietet das Auffrischen nach Morgengrauen für Gegenstände der Gruppe an', () => {
    const spent = 2 * 1440 + 20 * 60; // Tag 3, 20 Uhr
    const staff = item('Stab der Salzgrotte', {
      holderId: 'mira',
      magic: magic({ charges: charges({ current: 2, spentAt: spent }) }),
    });
    const elsewhere = item('Fremder Stab', {
      holderId: null,
      magic: magic({ charges: charges({ current: 2, spentAt: spent }) }),
    });
    expect(nextDawn(spent)).toBe(3 * 1440 + 360);
    expect(rechargesDue(world([staff, elsewhere], spent + 60))).toEqual([]);
    const due = rechargesDue(world([staff, elsewhere], 3 * 1440 + 400));
    expect(due.map((d) => d.item.name)).toEqual(['Stab der Salzgrotte']);
    expect(due[0]!.reason).toBe('Morgengrauen');
  });

  it('wartet bei „nach einer langen Rast“ auf eine beendete Lange Rast', () => {
    const spent = 1000;
    const wand = item('Furtstab', {
      holderId: PARTY_ID,
      magic: magic({
        charges: charges({ current: 0, recharge: 'alle nach einer Langen Rast', spentAt: spent }),
      }),
    });
    expect(rechargesDue(world([wand], 5000))).toEqual([]);
    const rest = { id: 'r1', kind: 'long', status: 'done', start: 1100, end: 1580 } as Rest;
    expect(rechargesDue(world([wand], 5000, [rest]))[0]?.reason).toBe('Lange Rast');
  });
});

describe('Einstimmung', () => {
  it('zählt, worauf ein Gefährte eingestimmt ist – mehr als drei ist nur ein Hinweis', () => {
    const rings = Array.from({ length: 4 }, (_, i) =>
      item(`Ring ${i + 1}`, { magic: magic({ attunedTo: 'mira' }) }),
    );
    const two = attunementOf(world(rings.slice(0, 2)), 'mira');
    expect(two).toMatchObject({ count: 2, limit: ATTUNEMENT_LIMIT, hint: '' });
    const four = attunementOf(world(rings), 'mira');
    expect(four.count).toBe(4);
    expect(four.hint).toMatch(/höchstens 3/);
    expect(attunementOf(world(rings), 'lando').count).toBe(0);
  });
});

describe('Was die Spieler sehen', () => {
  const cursed = item('Ring des Brann Eichwald', {
    magic: magic({
      rarity: 'rare',
      type: 'Ring',
      cursed: true,
      charges: charges({ current: 3 }),
    }),
  });
  const known: Item = {
    ...cursed,
    item: { ...cursed.item, magic: { ...cursed.item.magic!, identified: true } },
  };

  it('verrät nichts, solange die Gruppe ihn nicht erkannt hat, und nie den Fluch', () => {
    expect(playerMagicLine(cursed)).toBe('');
    const line = playerMagicLine(known);
    expect(line).toBe('magisch · selten · Ring · 3 von 7 Ladungen, 1W6+1 bei Morgengrauen');
    expect(line).not.toMatch(/fluch/i);
    expect(magicTag(cursed)).toBe('magisch · selten');
  });

  it('lässt im Buch Fluch und unerkannte Magie aus dem Steckbrief weg', () => {
    const facts = [
      { label: 'Art', value: 'Schmuck' },
      { label: 'Seltenheit', value: 'selten' },
      { label: 'Ladungen', value: '7' },
      { label: 'Fluch', value: 'bindet an den Träger' },
    ];
    expect(playerFacts(cursed, facts).map((f) => f.label)).toEqual(['Art']);
    expect(playerFacts(known, facts).map((f) => f.label)).toEqual([
      'Art',
      'Seltenheit',
      'Ladungen',
    ]);
  });
});

describe('Ordnen nach Seltenheit', () => {
  it('zeigt jeden Gegenstand in genau einer Gruppe, Nicht-Magisches zuerst', () => {
    const plain = item('Seil');
    const rare = item('Ring', { magic: magic({ rarity: 'rare' }) });
    const common = item('Kerze', { magic: magic({ rarity: 'common' }) });
    const open = item('Stein', { magic: magic() });
    const groups = itemsByRarity([rare, plain, common, open]);
    expect(groups.map((g) => g.label)).toEqual([
      'Nicht magisch',
      'Magisch, gewöhnlich',
      'Magisch, selten',
      'Magisch, ohne Seltenheit',
    ]);
    expect(groups.flatMap((g) => g.items)).toHaveLength(4);
    expect(itemsByRarity([plain])).toEqual([{ label: '', items: [plain] }]);
  });
});
