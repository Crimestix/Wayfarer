/**
 * Einen Laden bearbeiten: Name, Art (frei, mit Vorschlägen), Ort, Händler, Preisstufe, Ankauf,
 * was er gern ankauft, ob er ein Handelsplatz ist – mit Gesuchtem und nicht Gefragtem –, Notizen.
 */
import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
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
import { demandText, looksLikeMarket, readDemandFactor } from '../../domain/market';
import { newId, type Shop, type ShopDemand } from '../../domain/schema';
import {
  Button,
  Checkbox,
  Dialog,
  EntityPicker,
  Field,
  IconButton,
  Input,
  Select,
  TextArea,
  confirmDialog,
  toast,
} from '../../ui';
import { WordChips } from '../welt/parts';
import { patchShop, removeShop } from './actions';

/** Übliche Arten von Läden und Handelsplätzen – zur Auswahl, jedes andere Wort geht auch. */
const SHOP_KINDS = [
  'Krämer',
  'Schmiede',
  'Waffenhändler',
  'Rüstungsschmied',
  'Bogner',
  'Kräuterhändler',
  'Apotheke',
  'Alchemist',
  'Juwelier',
  'Schneider',
  'Gerber',
  'Bäcker',
  'Metzger',
  'Gasthaus',
  'Tierhändler',
  'Haustierhändler',
  'Stall',
  'Fahrender Händler',
  'Marktstand',
  'Markt',
  'Hafen',
  'Auktionshaus',
  'Hehler',
] as const;

/** Was ein Handelsplatz sucht oder nicht haben will – Zeilen mit Wort und Auf- oder Abschlag. */
function DemandRows({
  lines,
  wanted,
  onChange,
}: {
  lines: ShopDemand[];
  wanted: boolean;
  onChange: (lines: ShopDemand[]) => void;
}) {
  const [text, setText] = useState('');
  const [factor, setFactor] = useState(wanted ? '+50 %' : '−30 %');
  const read = readDemandFactor(factor);
  const fits = read !== null && (wanted ? read >= 1 : read < 1);
  const add = () => {
    if (!text.trim() || !fits) return;
    onChange([...lines, { id: newId(), text: text.trim(), factor: read }]);
    setText('');
  };
  return (
    <div className="wf-laden-demand">
      {lines.map((line) => (
        <span key={line.id} className="wf-laden-demand__chip">
          {line.text} <b>{demandText(line.factor)}</b>
          <IconButton
            label={`Weg: ${line.text}`}
            size="sm"
            variant="ghost"
            onClick={() => onChange(lines.filter((l) => l.id !== line.id))}
          >
            <X />
          </IconButton>
        </span>
      ))}
      <span className="wf-laden-demand__add">
        <Input
          value={text}
          placeholder={wanted ? 'Salz, Pelz, Waffe …' : 'Holz, Getreide …'}
          aria-label={wanted ? 'Gesucht: Ware' : 'Nicht gefragt: Ware'}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Input
          className="wf-laden-price"
          value={factor}
          aria-label={wanted ? 'Gesucht: Aufschlag' : 'Nicht gefragt: Abschlag'}
          aria-invalid={!fits || undefined}
          title={wanted ? 'Aufschlag beim Ankauf, etwa +50 %' : 'Abschlag beim Ankauf, etwa −30 %'}
          onChange={(event) => setFactor(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <IconButton
          label={wanted ? 'Gesucht hinzufügen' : 'Nicht gefragt hinzufügen'}
          size="sm"
          disabled={!text.trim() || !fits}
          onClick={add}
        >
          <Plus />
        </IconButton>
      </span>
    </div>
  );
}

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
  const kinds = useMemo(() => {
    const words = new Set<string>(SHOP_KINDS);
    for (const template of Object.values(data.assortments))
      if (template.kind.trim()) words.add(template.kind.trim());
    return [...words];
  }, [data.assortments]);
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
      market: draft.market,
      demand: draft.demand,
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
      title={draft.market ? 'Handelsplatz' : 'Laden'}
      width={660}
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
            placeholder="Krämer, Schmiede, Hafen …"
            onChange={(event) => set({ kind: event.target.value })}
          />
          <datalist id="wf-laden-kinds">
            {kinds.map((kind) => (
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
            kinds={['person', 'faction', 'family']}
            placeholder="Person, Fraktion oder Haus …"
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
          label="Handelsplatz"
          className="wf-span-2"
          hint={
            !draft.market && looksLikeMarket(draft.kind, draft.title)
              ? 'Klingt nach einem Ort, an dem die Gruppe verkaufen kann.'
              : 'Markt, Hafen, Auktionshaus, Hehler: Am Tisch steht dort „Verkaufen“ vorn.'
          }
        >
          <Checkbox checked={draft.market} onChange={(market) => set({ market })}>
            Hier verkauft die Gruppe vor allem
          </Checkbox>
        </Field>
        {(draft.market || draft.demand.length > 0) && (
          <>
            <Field
              label="Gesucht"
              className="wf-span-2"
              hint="Nur ein Hinweis: Wofür es hier mehr gibt. Wort und Aufschlag, etwa „Salz +50 %“."
            >
              <DemandRows
                wanted
                lines={draft.demand.filter((line) => line.factor >= 1)}
                onChange={(lines) =>
                  set({ demand: [...lines, ...draft.demand.filter((line) => line.factor < 1)] })
                }
              />
            </Field>
            <Field
              label="Nicht gefragt"
              className="wf-span-2"
              hint="Nur ein Hinweis: Wofür es hier weniger gibt, etwa „Holz −30 %“."
            >
              <DemandRows
                wanted={false}
                lines={draft.demand.filter((line) => line.factor < 1)}
                onChange={(lines) =>
                  set({ demand: [...draft.demand.filter((line) => line.factor >= 1), ...lines] })
                }
              />
            </Field>
          </>
        )}
        <Field
          label="Kauft gern"
          className="wf-span-2"
          hint="Nur ein Hinweis, etwa „Kraut“, „Waffe“, „Pflanze“ – angekauft wird am Tisch alles."
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
