import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { emptyRecipe } from '../../domain/crafting';
import { createEntity, type Item } from '../../domain/schema';
import { postponeRecharge, rechargeItem, setMagical, stepItemCharges } from './magic';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const wand = db.put(
    'entities',
    createEntity({
      kind: 'item',
      name: 'Furtstab',
      item: { recipe: { ...emptyRecipe(), rarity: 'uncommon', consumable: true } },
    }),
  ) as Item;
  const item = () => db.getSnapshot().entities[wand.id] as Item;
  return { db, wand, item };
}

describe('Magische Gegenstände – Befehle', () => {
  it('nimmt die Seltenheit eines alten Rezepts in die Magie mit – und zurück', async () => {
    const { db, wand, item } = await setup();
    const undo = setMagical(db, wand.id, true)!;
    expect(item().item.magic).toMatchObject({ rarity: 'uncommon', consumable: true });
    expect(item().item.recipe?.rarity).toBe('');
    expect(setMagical(db, wand.id, true)).toBeNull();
    undo();
    expect(item().item.magic).toBeNull();
    expect(item().item.recipe?.rarity).toBe('uncommon');
  });

  it('verbraucht, frischt auf und schiebt das Angebot', async () => {
    const { db, wand, item } = await setup();
    setMagical(db, wand.id, true);
    const magic = item().item.magic!;
    db.put('entities', {
      ...item(),
      item: {
        ...item().item,
        magic: { ...magic, charges: { max: 3, current: 3, recharge: 'alle', spentAt: null } },
      },
    });
    const now = db.getSnapshot().state.now;
    stepItemCharges(db, wand.id, -1);
    stepItemCharges(db, wand.id, -1);
    expect(item().item.magic?.charges).toMatchObject({ current: 1, spentAt: now });
    const undo = rechargeItem(db, wand.id, 5)!;
    expect(item().item.magic?.charges).toMatchObject({ current: 3, spentAt: null });
    undo();
    expect(item().item.magic?.charges?.current).toBe(1);
    postponeRecharge(db, wand.id);
    expect(item().item.magic?.charges?.spentAt).toBe(now);
  });
});
