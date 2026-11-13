import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { deleteEntity } from '../../data/actions';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  CRAFTING_RULES,
  craftPlan,
  daysWithHelpers,
  emptyRecipe,
  madeBy,
  planLine,
  readDays,
  recipeView,
  usedIn,
} from '../crafting';
import { linksTo } from '../derive';
import { createEntity, type Item, type Recipe } from '../schema';

const recipe = (more: Partial<Recipe>): Recipe => ({ ...emptyRecipe(), ...more });

describe('Herstellen nach den Regeln', () => {
  it('rechnet gewöhnliche Dinge aus dem Preis: halbe Rohstoffe, 10 Gold je Tag', () => {
    expect(craftPlan(recipe({ price: 15 }))).toMatchObject({
      days: 2,
      cost: 7.5,
      daysFrom: 'rules',
      costFrom: 'rules',
      magic: false,
    });
    // Mindestens ein Tag, auch für Kleinigkeiten.
    expect(craftPlan(recipe({ price: 0.5 })).days).toBe(1);
    expect(craftPlan(recipe({ price: 1500 })).days).toBe(150);
  });

  it('rechnet magische Dinge nach Seltenheit, Verbrauchsgüter zur Hälfte', () => {
    expect(craftPlan(recipe({ rarity: 'rare' }))).toMatchObject({ days: 50, cost: 2000 });
    expect(craftPlan(recipe({ rarity: 'legendary' }))).toMatchObject({ days: 250, cost: 100000 });
    expect(craftPlan(recipe({ rarity: 'uncommon', consumable: true }))).toMatchObject({
      days: 5,
      cost: 100,
    });
    // Halbe Tage werden auf ganze aufgerundet.
    expect(craftPlan(recipe({ rarity: 'common', consumable: true }))).toMatchObject({
      days: 3,
      cost: 25,
    });
    expect(CRAFTING_RULES.magic['very-rare']).toEqual({ days: 125, gold: 20000 });
  });

  it('lässt das Rezept die Regeln übersteuern und sagt, was fehlt', () => {
    expect(craftPlan(recipe({ price: 100, days: 3, cost: 12 }))).toMatchObject({
      days: 3,
      cost: 12,
      daysFrom: 'recipe',
      costFrom: 'recipe',
    });
    expect(craftPlan(recipe({}))).toMatchObject({
      days: null,
      cost: null,
      daysFrom: 'missing',
      costFrom: 'missing',
    });
  });

  it('schreibt Dauer und Kosten in eine Zeile und liest Arbeitstage', () => {
    expect(planLine(craftPlan(recipe({ price: 40 })))).toBe('4 Arbeitstage · Rohstoffe 20 GM');
    expect(planLine({ days: 1, cost: null })).toBe('1 Arbeitstag');
    expect(planLine({ days: null, cost: null })).toBe('');
    expect(readDays('')).toBeNull();
    expect(readDays('12 Tage')).toBe(12);
    expect(readDays('2,5')).toBe(2.5);
    expect(readDays('bald')).toBeUndefined();
  });

  it('teilt die Arbeitstage unter Helfern', () => {
    expect(daysWithHelpers(10, 1)).toBe(10);
    expect(daysWithHelpers(10, 2)).toBe(5);
    expect(daysWithHelpers(10, 3)).toBe(4);
    expect(daysWithHelpers(1, 4)).toBe(1);
  });
});

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const smith = db.put(
    'entities',
    createEntity({
      kind: 'profession',
      name: 'Kesselschmied',
      profession: { category: 'Handwerk', tool: 'Schmiedewerkzeug' },
    }),
  );
  const ore = db.put('entities', createEntity({ kind: 'mineral', name: 'Graufelser Eisen' }));
  const herb = db.put('entities', createEntity({ kind: 'plant', name: 'Mondkraut' }));
  const kettle = db.put(
    'entities',
    createEntity({
      kind: 'item',
      name: 'Salzkessel',
      item: {
        recipe: recipe({
          professionId: smith.id,
          price: 40,
          ingredients: [
            { entityId: ore.id, text: 'Graufelser Eisen', qty: '3 Barren' },
            { entityId: null, text: 'Holzkohle', qty: 'ein Sack' },
          ],
        }),
      },
    }),
  );
  const potion = db.put(
    'entities',
    createEntity({
      kind: 'item',
      name: 'Fiebertrank',
      item: {
        category: 'Trank',
        recipe: recipe({
          rarity: 'common',
          consumable: true,
          toolText: 'Kräuterkundeausrüstung',
          ingredients: [{ entityId: herb.id, text: 'Mondkraut', qty: '2' }],
        }),
      },
    }),
  );
  return { db, smith, ore, herb, kettle, potion, data: () => db.getSnapshot() };
}

describe('Rezepte in der Welt', () => {
  it('zeigt Beruf, Werkzeug und Zutaten; das Werkzeug kommt sonst vom Beruf', async () => {
    const { data, kettle, potion } = await setup();
    const view = recipeView(data(), data().entities[kettle.id] as Item)!;
    expect(view.profession?.name).toBe('Kesselschmied');
    expect(view.tool).toBe('Schmiedewerkzeug');
    expect(view.ingredients.map((i) => `${i.name} (${i.ingredient.qty})`)).toEqual([
      'Graufelser Eisen (3 Barren)',
      'Holzkohle (ein Sack)',
    ]);
    expect(view.plan).toMatchObject({ days: 4, cost: 20 });
    expect(recipeView(data(), data().entities[potion.id] as Item)!.tool).toBe(
      'Kräuterkundeausrüstung',
    );
  });

  it('weiß, was ein Beruf herstellt und wofür man eine Zutat braucht', async () => {
    const { data, smith, ore, herb } = await setup();
    expect(madeBy(data(), smith.id).map((i) => i.name)).toEqual(['Salzkessel']);
    expect(usedIn(data(), ore.id).map((u) => `${u.item.name}: ${u.qty}`)).toEqual([
      'Salzkessel: 3 Barren',
    ]);
    expect(usedIn(data(), herb.id).map((u) => u.item.name)).toEqual(['Fiebertrank']);
  });

  it('zählt das Rezept als Verweis und lässt beim Löschen den Namen der Zutat stehen', async () => {
    const { db, data, kettle, ore, smith } = await setup();
    expect(linksTo(data().entities[kettle.id]!, ore.id)).toBe(true);
    expect(linksTo(data().entities[kettle.id]!, smith.id)).toBe(true);
    deleteEntity(db, ore.id);
    deleteEntity(db, smith.id);
    const after = data().entities[kettle.id] as Item;
    expect(after.item.recipe?.professionId).toBeNull();
    expect(after.item.recipe?.ingredients[0]).toEqual({
      entityId: null,
      text: 'Graufelser Eisen',
      qty: '3 Barren',
    });
  });
});
