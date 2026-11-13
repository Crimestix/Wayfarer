/** Einen Laden bearbeiten: Name, Art, Ort, Händler, Preisstufe, Ankauf, was er ankauft, Notizen. */
import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import { TRADE_KINDS, isTradeKind } from '../../domain/priceList';
import {
  BUY_LEVELS,
  PRICE_LEVELS,
  percentText,
  readFactor,
  tradeCategory,
} from '../../domain/shop';
import type { Shop } from '../../domain/schema';
import {
  Button,
  Dialog,
  EntityPicker,
  Field,
  Input,
  Select,
  TextArea,
  confirmDialog,
  toast,
} from '../../ui';
import { WordChips } from '../welt/parts';
import { patchShop, removeShop } from './actions';

/** Übliche Arten von Läden – zur Auswahl, frei überschreibbar. */
const SHOP_KINDS = [
  'Krämer',
  'Schmiede',
  'Waffenhändler',
  'Rüstungsschmied',
  'Kräuterhändler',
  'Apotheke',
  'Alchemist',
  'Juwelier',
  'Schneider',
  'Gerber',
  'Bäcker',
  'Metzger',
  'Gasthaus',
  'Marktstand',
  'Fahrender Händler',
  'Stall',
] as const;

/** Ein Faktor als Wahl: eine Stufe oder „eigener“. */
function FactorSelect({
  value,
  levels,
  onChange,
  label,
}: {
  value: number;
  levels: readonly { value: number; label: string }[];
  onChange: (value: number) => void;
  label: string;
}) {
  const preset = levels.some((level) => level.value === value);
  const [own, setOwn] = useState(!preset);
  const [text, setText] = useState(percentText(value));
  return (
    <div className="wf-row">
      <Select
        value={own ? 'own' : String(value)}
        aria-label={label}
        onChange={(event) => {
          if (event.target.value === 'own') {
            setOwn(true);
            return;
          }
          setOwn(false);
          onChange(Number(event.target.value));
        }}
      >
        {levels.map((level) => (
          <option key={level.value} value={String(level.value)}>
            {level.label} ({percentText(level.value)})
          </option>
        ))}
        <option value="own">eigener Wert …</option>
      </Select>
      {own && (
        <Input
          value={text}
          aria-label={`${label}: eigener Wert`}
          aria-invalid={readFactor(text) === null || undefined}
          style={{ width: 96 }}
          onChange={(event) => {
            setText(event.target.value);
            const read = readFactor(event.target.value);
            if (read !== null) onChange(read);
          }}
        />
      )}
    </div>
  );
}

export function ShopDialog({
  shop,
  fresh = false,
  onClose,
}: {
  shop: Shop;
  /** Eben angelegt: Abbrechen nimmt den Laden wieder weg. */
  fresh?: boolean;
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [draft, setDraft] = useState(shop);
  const set = (change: Partial<Shop>) => setDraft((current) => ({ ...current, ...change }));
  const categories = useMemo(() => {
    const words = new Set<string>(TRADE_KINDS.map((kind) => KIND_LABEL[kind]));
    for (const entity of Object.values(data.entities))
      if (isTradeKind(entity.kind)) words.add(tradeCategory(entity));
    return [...words].filter(Boolean).sort((a, b) => a.localeCompare(b, 'de'));
  }, [data]);

  const save = () => {
    patchShop(db, shop.id, {
      title: draft.title.trim(),
      kind: draft.kind.trim(),
      placeId: draft.placeId,
      keeperId: draft.keeperId,
      priceFactor: draft.priceFactor,
      buyFactor: draft.buyFactor,
      buys: draft.buys,
      notes: draft.notes.trim(),
    });
    onClose();
  };
  const cancel = () => {
    if (fresh) removeShop(db, shop.id);
    onClose();
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Laden löschen?',
      body: 'Der Laden und sein Bestand verschwinden. Was die Gruppe dort gekauft und verkauft hat, bleibt in der Chronik.',
      confirmLabel: 'Laden löschen',
      danger: true,
    });
    if (!ok) return;
    const undo = removeShop(db, shop.id);
    onClose();
    if (undo) toast({ title: 'Laden gelöscht', action: { label: 'Rückgängig', run: undo } });
  };

  return (
    <Dialog
      open
      onClose={cancel}
      title="Laden"
      width={620}
      footer={
        <>
          <Button
            variant="danger"
            icon={<Trash2 />}
            onClick={remove}
            style={{ marginRight: 'auto' }}
          >
            Löschen
          </Button>
          <Button onClick={cancel}>Abbrechen</Button>
          <Button variant="primary" onClick={save}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="wf-form-grid">
        <Field label="Name" hint="Leer: Art und Händler.">
          <Input
            data-autofocus
            value={draft.title}
            placeholder="Zum Rostigen Anker"
            onChange={(event) => set({ title: event.target.value })}
          />
        </Field>
        <Field label="Art">
          <Input
            list="wf-laden-kinds"
            value={draft.kind}
            placeholder="Krämer, Schmiede …"
            onChange={(event) => set({ kind: event.target.value })}
          />
          <datalist id="wf-laden-kinds">
            {SHOP_KINDS.map((kind) => (
              <option key={kind} value={kind} />
            ))}
          </datalist>
        </Field>
        <Field label="Ort" hint="Leer: dort, wo der Händler gerade ist.">
          <EntityPicker
            value={draft.placeId}
            onChange={(placeId) => set({ placeId })}
            kinds={['place']}
            placeholder="Ort wählen …"
          />
        </Field>
        <Field label="Händler">
          <EntityPicker
            value={draft.keeperId}
            onChange={(keeperId) => set({ keeperId })}
            kinds={['person', 'faction']}
            placeholder="Person oder Fraktion …"
          />
        </Field>
        <Field label="Preise" hint="Im Verhältnis zum Listenpreis der Waren.">
          <FactorSelect
            label="Preise"
            value={draft.priceFactor}
            levels={PRICE_LEVELS}
            onChange={(priceFactor) => set({ priceFactor })}
          />
        </Field>
        <Field label="Ankauf" hint="Was er für Waren der Gruppe zahlt.">
          <FactorSelect
            label="Ankauf"
            value={draft.buyFactor}
            levels={BUY_LEVELS}
            onChange={(buyFactor) => set({ buyFactor })}
          />
        </Field>
        <Field
          label="Kauft an"
          className="wf-span-2"
          hint="Einordnungen oder Arten, etwa „Kraut“, „Waffe“, „Pflanze“. Leer: alles."
        >
          <WordChips
            value={draft.buys}
            onChange={(buys) => set({ buys })}
            suggestions={categories}
            placeholder="Kraut, Waffe …"
            label="Einordnung hinzufügen"
          />
        </Field>
        <Field label="Notizen" className="wf-span-2" hint="Nur für dich.">
          <TextArea
            rows={3}
            value={draft.notes}
            placeholder="Feilscht gern, schreibt an, hat Ware unter der Theke …"
            onChange={(event) => set({ notes: event.target.value })}
          />
        </Field>
      </div>
    </Dialog>
  );
}
