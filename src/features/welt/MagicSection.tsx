/**
 * „Magie“ auf der Seite eines Gegenstands: ob er magisch ist, Seltenheit, Art, Einstimmung,
 * Ladungen (mit − / + und „Auffrischen“), verbraucht, verflucht (nur für dich) und ob die Gruppe
 * ihn erkannt hat. Wirkung und Beschreibung stehen im Text des Artikels. Gerechnet wird in
 * `domain/magicItem.ts`; geschrieben beim Verlassen eines Feldes.
 */
import { useId, useState } from 'react';
import { EyeOff, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { formatGold } from '../../domain/loot';
import {
  ATTUNEMENT_LIMIT,
  MAGIC_RARITY_LABEL,
  MAGIC_TYPES,
  attunementOf,
  valueOf,
  withMaxCharges,
} from '../../domain/magicItem';
import { MAGIC_RARITIES, type Item, type Magic } from '../../domain/schema';
import { Badge, Button, Checkbox, Field, IconButton, Select, Written, toast } from '../../ui';
import { Hint, Picker, Section } from './parts';
import { patchMagic, setMagical, stepItemCharges } from './magic';
import { RechargeDialog } from './RechargeDialog';
import './magic.css';

export function MagicSection({ item }: { item: Item }) {
  const db = useDb();
  const data = useData();
  const typeList = useId();
  const [recharging, setRecharging] = useState(false);
  const magic = item.item.magic;
  const toggle = (on: boolean) => {
    const undo = setMagical(db, item.id, on);
    if (undo && !on)
      toast({
        title: 'Nicht mehr magisch',
        body: `${item.name} ist wieder ein gewöhnlicher Gegenstand.`,
        action: { label: 'Rückgängig', run: undo },
      });
  };
  const switcher = (
    <Checkbox checked={magic !== null} onChange={toggle}>
      Magischer Gegenstand
    </Checkbox>
  );

  if (!magic)
    return (
      <Section title="Magie" action={switcher}>
        <Hint>
          {item.item.recipe?.rarity
            ? `Das Rezept nennt ihn magisch, ${MAGIC_RARITY_LABEL[item.item.recipe.rarity]} – einschalten übernimmt die Seltenheit hierher.`
            : 'Seltenheit, Einstimmung und Ladungen – Wirkung und Beschreibung schreibst du in den Text.'}
        </Hint>
      </Section>
    );

  const save = (change: Partial<Magic>) => patchMagic(db, item.id, change);
  const value = valueOf(item);
  const attuned = magic.attunedTo ? attunementOf(data, magic.attunedTo) : null;
  const charges = magic.charges;
  const readCount = (text: string) => {
    const n = Number(text.trim());
    return Number.isInteger(n) && n >= 0 ? n : null;
  };

  return (
    <Section title="Magie" action={switcher}>
      <div className="wf-welt-magic">
        <div className="wf-welt-magic__grid">
          <Field
            label="Seltenheit"
            hint={
              value
                ? `Wert ${formatGold(value.gold)}${value.note ? ` – ${value.note}` : ' – eigener Preis'}`
                : magic.rarity === 'artifact'
                  ? 'Artefakte haben keinen Richtwert.'
                  : undefined
            }
          >
            <Select
              value={magic.rarity}
              aria-label="Seltenheit"
              onChange={(e) => save({ rarity: e.target.value as Magic['rarity'] })}
            >
              <option value="">noch offen</option>
              {MAGIC_RARITIES.map((rarity) => (
                <option key={rarity} value={rarity}>
                  {MAGIC_RARITY_LABEL[rarity]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Art">
            <Written
              label="Art des magischen Gegenstands"
              value={magic.type}
              list={typeList}
              placeholder="Ring, Trank …"
              onSave={(type) => save({ type: type.trim().slice(0, 80) })}
            />
            <datalist id={typeList}>
              {MAGIC_TYPES.map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
          </Field>
        </div>

        <div className="wf-welt-magic__grid">
          <Field label="Einstimmung">
            <Checkbox
              checked={magic.attunement.required}
              onChange={(required) => save({ attunement: { ...magic.attunement, required } })}
            >
              erfordert Einstimmung
            </Checkbox>
            {magic.attunement.required && (
              <Written
                label="Wer sich einstimmen kann"
                value={magic.attunement.by}
                placeholder="durch einen Zauberwirker"
                onSave={(by) => save({ attunement: { ...magic.attunement, by: by.trim() } })}
              />
            )}
          </Field>
          {(magic.attunement.required || magic.attunedTo) && (
            <Field
              label="Eingestimmt auf"
              hint={
                attuned
                  ? `${attuned.count} von ${ATTUNEMENT_LIMIT} Einstimmungen${attuned.hint ? ` – ${attuned.hint}` : ''}`
                  : undefined
              }
            >
              <Picker
                value={magic.attunedTo}
                onChange={(attunedTo) => save({ attunedTo })}
                kinds={['character', 'person']}
                placeholder="Niemand – auswählen …"
              />
            </Field>
          )}
        </div>

        <Field label="Ladungen">
          {charges ? (
            <div className="wf-welt-magic__charges">
              <IconButton
                label="Eine Ladung verbrauchen"
                size="sm"
                disabled={charges.current === 0}
                onClick={() => stepItemCharges(db, item.id, -1)}
              >
                <Minus />
              </IconButton>
              <span className="wf-welt-magic__count" aria-live="polite">
                {charges.current}
              </span>
              <IconButton
                label="Eine Ladung dazu"
                size="sm"
                disabled={charges.current >= charges.max}
                onClick={() => stepItemCharges(db, item.id, 1)}
              >
                <Plus />
              </IconButton>
              <span className="wf-welt-magic__of">von</span>
              <span className="wf-welt-magic__max">
                <Written
                  label="Höchstzahl der Ladungen"
                  value={String(charges.max)}
                  onSave={(text) => {
                    const max = readCount(text);
                    if (max !== null) save({ charges: withMaxCharges(charges, max) });
                  }}
                />
              </span>
              <span className="wf-welt-magic__recharge">
                <Written
                  label="Wie die Ladungen wiederkommen"
                  value={charges.recharge}
                  placeholder="1W6+1 bei Morgengrauen"
                  onSave={(recharge) =>
                    save({ charges: { ...charges, recharge: recharge.trim() } })
                  }
                />
              </span>
              <Button
                size="sm"
                icon={<RotateCcw />}
                disabled={charges.current >= charges.max}
                onClick={() => setRecharging(true)}
                title="Den Ausdruck würfeln und das Ergebnis zum Bestätigen zeigen"
              >
                Auffrischen
              </Button>
              <IconButton
                label="Keine Ladungen"
                size="sm"
                variant="ghost"
                onClick={() => save({ charges: null })}
              >
                <X />
              </IconButton>
            </div>
          ) : (
            <div>
              <Button
                size="sm"
                icon={<Plus />}
                onClick={() =>
                  save({ charges: { max: 1, current: 1, recharge: '', spentAt: null } })
                }
              >
                Ladungen eintragen
              </Button>
            </div>
          )}
        </Field>

        <div className="wf-welt-magic__flags">
          <Checkbox checked={magic.consumable} onChange={(consumable) => save({ consumable })}>
            Verbrauchsgut
          </Checkbox>
          <Checkbox checked={magic.spent} onChange={(spent) => save({ spent })}>
            verbraucht
          </Checkbox>
          <Checkbox checked={magic.identified} onChange={(identified) => save({ identified })}>
            <span title="Erst dann stehen Seltenheit, Art und Ladungen im Spielerbuch">
              erkannt – die Gruppe weiß, was er kann
            </span>
          </Checkbox>
          <Checkbox checked={magic.cursed} onChange={(cursed) => save({ cursed })}>
            <span className="wf-welt-magic__secret">
              verflucht
              <Badge tone="arcane" icon={<EyeOff />} title="Steht nie im Spielerbuch">
                nur du
              </Badge>
            </span>
          </Checkbox>
        </div>
      </div>
      {recharging && <RechargeDialog itemId={item.id} onClose={() => setRecharging(false)} />}
    </Section>
  );
}
