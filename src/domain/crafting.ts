/**
 * Herstellen nach den Regeln von 2024: Was ein Gegenstand an Arbeitstagen und Rohstoffen kostet,
 * was man dafür braucht und wofür eine Pflanze, ein Gestein oder ein Tier gebraucht wird. Reine
 * Funktionen; das Rezept steht am Gegenstand (`item.recipe`).
 */
import { MAGIC_RARITY_LABEL, isCraftRarity, itemRarity } from './magicItem';
import type {
  CampaignData,
  Entity,
  Ingredient,
  Item,
  Magic,
  MagicRarity,
  Profession,
  Rarity,
  Recipe,
} from './schema';
import { RecipeSchema } from './schema';

/**
 * Die Regelwerte an einer Stelle – der Spielleiter kann sie hier prüfen. Ein Rezept kann Dauer und
 * Kosten selbst angeben; dann gilt das Rezept.
 *
 * - Gewöhnlicher Gegenstand: Die Rohstoffe kosten die Hälfte des Preises; je Arbeitstag entstehen
 *   Dinge im Wert von 10 Gold (Arbeitstage = Preis ÷ 10, aufgerundet, mindestens 1).
 * - Magischer Gegenstand: Tage und Gold nach Seltenheit.
 * - Verbrauchsgut (Trank, Schriftrolle): halbe Zeit und halbe Kosten.
 * - Mehrere Helfer mit passendem Werkzeug teilen sich die Arbeitstage.
 */
export const CRAFTING_RULES = {
  goldPerDay: 10,
  materialShare: 0.5,
  consumableShare: 0.5,
  magic: {
    common: { days: 5, gold: 50 },
    uncommon: { days: 10, gold: 200 },
    rare: { days: 50, gold: 2000 },
    'very-rare': { days: 125, gold: 20000 },
    legendary: { days: 250, gold: 100000 },
  } satisfies Record<Rarity, { days: number; gold: number }>,
} as const;

/** Die Seltenheit eines magischen Gegenstands, wie sie die Regeln nennen (`domain/magicItem.ts`). */
export { MAGIC_RARITY_LABEL };

/** Ein leeres Rezept mit allen Vorgaben. */
export const emptyRecipe = (): Recipe => RecipeSchema.parse({});

export type PlanSource = 'recipe' | 'rules' | 'missing';

export interface CraftPlan {
  /** Arbeitstage insgesamt (ganze Tage, aufgerundet); null = lässt sich nicht rechnen. */
  days: number | null;
  /** Kosten der Rohstoffe in Gold; null = lässt sich nicht rechnen. */
  cost: number | null;
  daysFrom: PlanSource;
  costFrom: PlanSource;
  /** Worauf die Regel fußt: „Preis 15 GM“, „selten, Verbrauchsgut“. */
  basis: string;
  magic: boolean;
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name);

const wholeDays = (days: number) => Math.max(1, Math.ceil(days - 1e-9));
const gold = (value: number) => Math.round(value * 100) / 100;

/**
 * Dauer und Kosten eines Rezepts: was im Rezept steht, sonst nach den Regeln. Ohne eigenen Preis
 * im Rezept gilt der Listenpreis des Gegenstands (`listPrice`). Ist der Gegenstand magisch
 * (`magic`), gelten Seltenheit und Verbrauchsgut der Magie – die Seltenheit steht nur dort; die
 * des Rezepts gilt nur noch für ältere Stände ohne Magie.
 */
export function craftPlan(
  recipe: Recipe,
  listPrice: number | null = null,
  magic: Pick<Magic, 'rarity' | 'consumable'> | null = null,
): CraftPlan {
  if (recipe.price === null && listPrice !== null) recipe = { ...recipe, price: listPrice };
  if (magic)
    recipe = {
      ...recipe,
      rarity: isCraftRarity(magic.rarity) ? magic.rarity : '',
      consumable: magic.consumable,
    };
  const artifact = magic?.rarity === 'artifact';
  const share = recipe.consumable ? CRAFTING_RULES.consumableShare : 1;
  let ruleDays: number | null = null;
  let ruleCost: number | null = null;
  let basis = '';
  if (artifact) {
    basis = 'Artefakt – die Regeln nennen dafür keine Dauer und keine Kosten';
  } else if (recipe.rarity) {
    const row = CRAFTING_RULES.magic[recipe.rarity];
    ruleDays = wholeDays(row.days * share);
    ruleCost = gold(row.gold * share);
    basis = `magisch, ${MAGIC_RARITY_LABEL[recipe.rarity]}${recipe.consumable ? ', Verbrauchsgut' : ''}`;
  } else if (recipe.price !== null) {
    ruleDays = wholeDays((recipe.price / CRAFTING_RULES.goldPerDay) * share);
    ruleCost = gold(recipe.price * CRAFTING_RULES.materialShare * share);
    basis = `Preis ${recipe.price.toLocaleString('de-DE')} GM${recipe.consumable ? ', Verbrauchsgut' : ''}`;
  }
  const days = recipe.days !== null ? wholeDays(recipe.days) : ruleDays;
  const cost = recipe.cost !== null ? gold(recipe.cost) : ruleCost;
  return {
    days,
    cost,
    daysFrom: recipe.days !== null ? 'recipe' : ruleDays !== null ? 'rules' : 'missing',
    costFrom: recipe.cost !== null ? 'recipe' : ruleCost !== null ? 'rules' : 'missing',
    basis,
    magic: magic !== null || recipe.rarity !== '',
  };
}

/** Dauer und Kosten für einen Gegenstand mit Rezept – mit Listenpreis und Magie; null ohne Rezept. */
export function itemCraftPlan(item: Item): CraftPlan | null {
  return item.item.recipe ? craftPlan(item.item.recipe, item.item.price, item.item.magic) : null;
}

/** Wie viele Tage es dauert, wenn mehrere mit passendem Werkzeug zusammen arbeiten. */
export function daysWithHelpers(workDays: number, helpers: number): number {
  return Math.max(1, Math.ceil(workDays / Math.max(1, Math.floor(helpers))));
}

export interface IngredientView {
  ingredient: Ingredient;
  /** Der Eintrag der Welt, wenn es ihn (noch) gibt. */
  entity: Entity | null;
  /** Name des Eintrags oder das Wort. */
  name: string;
}

export interface RecipeView {
  item: Item;
  recipe: Recipe;
  profession: Profession | null;
  /** Das Werkzeug: aus dem Rezept, sonst das des Berufs; '' = keins genannt. */
  tool: string;
  ingredients: IngredientView[];
  plan: CraftPlan;
  /** Die Seltenheit, nach der gerechnet wird: die der Magie, sonst die eines älteren Rezepts. */
  rarity: MagicRarity | '';
}

/** Das Werkzeug eines Rezepts: was im Rezept steht, sonst das Werkzeug des Berufs. */
export function recipeTool(data: Pick<CampaignData, 'entities'>, recipe: Recipe): string {
  if (recipe.toolText.trim()) return recipe.toolText.trim();
  const profession = recipe.professionId ? data.entities[recipe.professionId] : undefined;
  return profession?.kind === 'profession' ? profession.profession.tool.trim() : '';
}

/** Ein Rezept, wie es auf der Seite steht; null = der Gegenstand hat keins. */
export function recipeView(data: Pick<CampaignData, 'entities'>, item: Item): RecipeView | null {
  const recipe = item.item.recipe;
  if (!recipe) return null;
  const found = recipe.professionId ? data.entities[recipe.professionId] : undefined;
  return {
    item,
    recipe,
    profession: found?.kind === 'profession' ? found : null,
    tool: recipeTool(data, recipe),
    ingredients: recipe.ingredients.map((ingredient) => {
      const entity = (ingredient.entityId && data.entities[ingredient.entityId]) || null;
      return { ingredient, entity, name: entity?.name ?? ingredient.text.trim() };
    }),
    plan: craftPlan(recipe, item.item.price, item.item.magic),
    rarity: itemRarity(item),
  };
}

const items = (data: Pick<CampaignData, 'entities'>): Item[] =>
  Object.values(data.entities).filter((e): e is Item => e.kind === 'item');

/** Was ein Beruf herstellt: alle Gegenstände, deren Rezept ihn nennt. */
export function madeBy(data: Pick<CampaignData, 'entities'>, professionId: string): Item[] {
  return items(data)
    .filter((item) => item.item.recipe?.professionId === professionId)
    .sort(byName);
}

export interface Use {
  item: Item;
  /** Die Menge, wie sie im Rezept steht. */
  qty: string;
}

/** Wofür man etwas braucht: alle Gegenstände, in deren Rezept es eine Zutat ist. */
export function usedIn(data: Pick<CampaignData, 'entities'>, entityId: string): Use[] {
  const out: Use[] = [];
  for (const item of items(data)) {
    if (item.id === entityId) continue;
    const ingredient = item.item.recipe?.ingredients.find((i) => i.entityId === entityId);
    if (ingredient) out.push({ item, qty: ingredient.qty.trim() });
  }
  return out.sort((a, b) => byName(a.item, b.item));
}

/** Gegenstände mit Rezept – für die Wahl „Herstellen“ in der freien Zeit. */
export function craftableItems(data: Pick<CampaignData, 'entities'>): Item[] {
  return items(data)
    .filter((item) => item.item.recipe)
    .sort(byName);
}

/**
 * Das Rezept ohne Verweis auf einen gelöschten Eintrag: Der Beruf fällt weg, eine Zutat bleibt
 * mit ihrem Namen stehen – dem heutigen (`name`), sonst dem bei der Wahl gemerkten. Unverändert,
 * wenn nichts darauf zeigt.
 */
export function recipeWithout(recipe: Recipe, entityId: string, name = ''): Recipe {
  const touchesIngredients = recipe.ingredients.some((i) => i.entityId === entityId);
  if (recipe.professionId !== entityId && !touchesIngredients) return recipe;
  return {
    ...recipe,
    professionId: recipe.professionId === entityId ? null : recipe.professionId,
    ingredients: touchesIngredients
      ? recipe.ingredients.map((i) =>
          i.entityId === entityId
            ? { ...i, entityId: null, text: name.trim() || i.text.trim() }
            : i,
        )
      : recipe.ingredients,
  };
}

/** Alle Einträge, auf die ein Rezept zeigt (Beruf und Zutaten). */
export function recipeLinks(recipe: Recipe | null): { field: string; id: string }[] {
  if (!recipe) return [];
  return [
    ...(recipe.professionId ? [{ field: 'recipe.professionId', id: recipe.professionId }] : []),
    ...recipe.ingredients.flatMap((i) =>
      i.entityId ? [{ field: 'recipe.ingredients', id: i.entityId }] : [],
    ),
  ];
}

const dayWord = (n: number) =>
  n === 1 ? '1 Arbeitstag' : `${n.toLocaleString('de-DE')} Arbeitstage`;
const goldWord = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('de-DE')} GM`;

/** Dauer und Kosten in einer Zeile: „4 Arbeitstage · Rohstoffe 20 GM“; '' = nichts bekannt. */
export function planLine(plan: Pick<CraftPlan, 'days' | 'cost'>): string {
  return [
    plan.days !== null ? dayWord(plan.days) : '',
    plan.cost !== null ? `Rohstoffe ${goldWord(plan.cost)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Arbeitstage aus einem Feld: leer = nach den Regeln (null), Unlesbares = undefined. */
export function readDays(text: string): number | null | undefined {
  const value = text.trim().replace(',', '.');
  if (!value) return null;
  const days = Number(value.replace(/\s*(?:arbeits)?tage?$/i, ''));
  return Number.isFinite(days) && days > 0 ? days : undefined;
}
