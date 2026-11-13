/**
 * Herstellen auf den Seiten der Welt: „Herstellung“ am Gegenstand (Beruf, Werkzeug, Zutaten,
 * Dauer und Kosten nach den Regeln von 2024), „Was man damit herstellt“ am Beruf und „Wofür man
 * es braucht“ an Pflanze, Gestein, Tier und Gegenstand. Gerechnet wird in `domain/crafting.ts`;
 * geschrieben wird beim Verlassen eines Feldes.
 */
import { useState } from 'react';
import { Hammer, Plus, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  CRAFTING_RULES,
  MAGIC_RARITY_LABEL,
  emptyRecipe,
  madeBy,
  planLine,
  readDays,
  recipeView,
  usedIn,
} from '../../domain/crafting';
import { priceText, readPrice } from '../../domain/nature';
import {
  RARITIES,
  createEntity,
  type Entity,
  type EntityKind,
  type Ingredient,
  type Item,
  type Recipe,
} from '../../domain/schema';
import { Button, Checkbox, EntityLink, Field, IconButton, Input, Select, Written } from '../../ui';
import { patchDetails } from './actions';
import { EntryRow, Hint, Picker, Section } from './parts';
import './craft.css';

const INGREDIENT_KINDS: EntityKind[] = ['plant', 'mineral', 'animal', 'item'];
const SOURCE: Record<string, string> = { rules: 'nach den Regeln', recipe: 'eigene Angabe' };

/** „Herstellung“ auf der Seite eines Gegenstands. */
export function RecipeSection({ item }: { item: Item }) {
  const db = useDb();
  const data = useData();
  const view = recipeView(data, item);
  const save = (change: Partial<Recipe>) =>
    patchDetails(db, item, { recipe: { ...(item.item.recipe ?? emptyRecipe()), ...change } });

  if (!view)
    return (
      <Section title="Herstellung">
        <Hint
          action={
            <Button size="sm" icon={<Hammer />} onClick={() => save({})}>
              Rezept anlegen
            </Button>
          }
        >
          Wer ihn herstellt, womit und woraus – Dauer und Kosten rechnet Wayfarer nach den Regeln.
        </Hint>
      </Section>
    );

  const { recipe, plan, profession } = view;
  const setIngredients = (ingredients: Ingredient[]) => save({ ingredients });
  const professionTool = profession?.profession.tool.trim() ?? '';
  return (
    <Section
      title="Herstellung"
      action={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => patchDetails(db, item, { recipe: null })}
          title="Das Rezept entfernen; der Gegenstand bleibt"
        >
          Rezept entfernen
        </Button>
      }
    >
      <div className="wf-welt-recipe">
        <p className="wf-welt-recipe__sum">
          {planLine(plan) || 'Dauer und Kosten noch offen – Preis oder Seltenheit angeben.'}
          {plan.basis && <span> · {plan.basis}</span>}
        </p>
        <div className="wf-welt-recipe__grid">
          <Field label="Beruf">
            <Picker
              value={recipe.professionId}
              onChange={(professionId) => save({ professionId })}
              kinds={['profession']}
              placeholder="Welcher Beruf stellt ihn her?"
              onCreate={(name) => db.put('entities', createEntity({ kind: 'profession', name })).id}
            />
          </Field>
          <Field
            label="Werkzeug"
            hint={recipe.toolText ? undefined : professionTool && 'vom Beruf'}
          >
            <Written
              label="Werkzeug"
              value={recipe.toolText}
              placeholder={professionTool || 'z. B. Schmiedewerkzeug'}
              onSave={(toolText) => save({ toolText: toolText.trim() })}
            />
          </Field>
          <Field label="Magie">
            <Select
              value={recipe.rarity}
              onChange={(e) => save({ rarity: e.target.value as Recipe['rarity'] })}
            >
              <option value="">Nicht magisch</option>
              {RARITIES.map((rarity) => (
                <option key={rarity} value={rarity}>
                  Magisch, {MAGIC_RARITY_LABEL[rarity]} ({CRAFTING_RULES.magic[rarity].days} Tage,{' '}
                  {CRAFTING_RULES.magic[rarity].gold.toLocaleString('de-DE')} GM)
                </option>
              ))}
            </Select>
          </Field>
          {recipe.rarity === '' && (
            <Field
              label="Preis in Gold"
              hint={`Grundlage: ${CRAFTING_RULES.goldPerDay} Gold Wert je Arbeitstag`}
            >
              <NumberField
                label="Preis in Gold"
                value={priceText(recipe.price)}
                placeholder={
                  item.item.price !== null
                    ? `${priceText(item.item.price)} wie der Listenpreis`
                    : undefined
                }
                read={readPrice}
                onSave={(price) => save({ price })}
              />
            </Field>
          )}
          <Field label="Arbeitstage" hint={SOURCE[plan.daysFrom]}>
            <NumberField
              label="Arbeitstage"
              value={recipe.days === null ? '' : String(recipe.days)}
              placeholder={plan.daysFrom === 'rules' ? String(plan.days) : 'nach den Regeln'}
              read={readDays}
              onSave={(days) => save({ days })}
            />
          </Field>
          <Field label="Rohstoffe in Gold" hint={SOURCE[plan.costFrom]}>
            <NumberField
              label="Rohstoffe in Gold"
              value={priceText(recipe.cost)}
              placeholder={
                plan.costFrom === 'rules' ? priceText(plan.cost) : 'die Hälfte des Preises'
              }
              read={readPrice}
              onSave={(cost) => save({ cost })}
            />
          </Field>
        </div>
        <Checkbox checked={recipe.consumable} onChange={(consumable) => save({ consumable })}>
          Verbrauchsgut (Trank, Schriftrolle …): halbe Zeit, halbe Kosten
        </Checkbox>
        <Ingredients ingredients={recipe.ingredients} itemId={item.id} onChange={setIngredients} />
      </div>
    </Section>
  );
}

/** Ein Zahlenfeld, das beim Verlassen schreibt; Unlesbares bleibt stehen, bis es stimmt. */
function NumberField({
  label,
  value,
  placeholder,
  read,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  read: (text: string) => number | null | undefined;
  onSave: (value: number | null) => void;
}) {
  return (
    <Written
      label={label}
      value={value}
      placeholder={placeholder}
      onSave={(text) => {
        const next = read(text);
        if (next !== undefined) onSave(next);
      }}
    />
  );
}

function Ingredients({
  ingredients,
  itemId,
  onChange,
}: {
  ingredients: Ingredient[];
  itemId: string;
  onChange: (next: Ingredient[]) => void;
}) {
  const data = useData();
  const [word, setWord] = useState('');
  const add = (ingredient: Ingredient) => onChange([...ingredients, ingredient]);
  const addWord = () => {
    const text = word.replace(/\s+/g, ' ').trim();
    if (!text) return;
    add({ entityId: null, text, qty: '' });
    setWord('');
  };
  const taken = ingredients.flatMap((i) => (i.entityId ? [i.entityId] : []));
  return (
    <div className="wf-welt-recipe__parts">
      <div className="wf-field__label">Zutaten</div>
      {ingredients.length > 0 && (
        <ul className="wf-welt-recipe__list">
          {ingredients.map((ingredient, index) => {
            const entity = ingredient.entityId ? data.entities[ingredient.entityId] : undefined;
            return (
              <li key={`${ingredient.entityId ?? ingredient.text}-${index}`}>
                <span className="wf-welt-recipe__qty">
                  <Written
                    label={`Menge: ${entity?.name ?? ingredient.text}`}
                    value={ingredient.qty}
                    placeholder="Menge"
                    onSave={(qty) =>
                      onChange(
                        ingredients.map((i, n) => (n === index ? { ...i, qty: qty.trim() } : i)),
                      )
                    }
                  />
                </span>
                <span className="wf-welt-recipe__name">
                  {entity ? <EntityLink id={entity.id} /> : ingredient.text}
                </span>
                <IconButton
                  label="Zutat entfernen"
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange(ingredients.filter((_, n) => n !== index))}
                >
                  <X />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      <div className="wf-welt-recipe__add">
        <Picker
          value={null}
          onChange={(id) => {
            const entity = id ? data.entities[id] : undefined;
            if (entity) add({ entityId: entity.id, text: entity.name, qty: '' });
          }}
          kinds={INGREDIENT_KINDS}
          exclude={[itemId, ...taken]}
          placeholder="Pflanze, Gestein, Tier oder Gegenstand …"
        />
        <Input
          value={word}
          aria-label="Zutat in Worten"
          placeholder="… oder in Worten"
          onChange={(e) => setWord(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addWord();
          }}
        />
        <IconButton label="Zutat in Worten hinzufügen" size="sm" onClick={addWord}>
          <Plus />
        </IconButton>
      </div>
    </div>
  );
}

/** „Was man damit herstellt“ auf der Seite eines Berufs – nur, wenn es etwas gibt. */
export function MadeBy({ professionId }: { professionId: string }) {
  const data = useData();
  const items = madeBy(data, professionId);
  if (!items.length) return null;
  return (
    <Section title="Was man damit herstellt" count={items.length}>
      <div className="wf-welt-rows">
        {items.map((item) => (
          <EntryRow key={item.id} entity={item} sub={recipeSub(data, item)} />
        ))}
      </div>
    </Section>
  );
}

/** „Wofür man es braucht“ an Pflanze, Gestein, Tier und Gegenstand – nur, wenn es etwas gibt. */
export function UsedIn({ entity }: { entity: Entity }) {
  const data = useData();
  const uses = usedIn(data, entity.id);
  if (!uses.length) return null;
  return (
    <Section title="Wofür man es braucht" count={uses.length}>
      <div className="wf-welt-rows">
        {uses.map((use) => (
          <EntryRow
            key={use.item.id}
            entity={use.item}
            sub={[use.qty, use.item.item.category].filter(Boolean).join(' · ') || undefined}
          />
        ))}
      </div>
    </Section>
  );
}

function recipeSub(data: Parameters<typeof recipeView>[0], item: Item): string | undefined {
  const view = recipeView(data, item);
  return view ? planLine(view.plan) || item.item.category || undefined : undefined;
}
