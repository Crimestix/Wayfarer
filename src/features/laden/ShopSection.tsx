/**
 * Abschnitt „Laden“ auf der Seite eines Ortes, einer Person (Händler) oder Fraktion: Läden
 * anlegen und pflegen – Bestand aus der Welt oder als Preisliste, eigene Preise und Mengen,
 * Vorschläge zum Annehmen und was der Laden zuletzt verkauft und angekauft hat (aus der Chronik).
 */
import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ClipboardList,
  PackagePlus,
  Plus,
  Settings2,
  Store,
  X,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import { TRADE_KINDS } from '../../domain/priceList';
import {
  buyLevelLabel,
  formatPrice,
  looksLikeTrader,
  priceLevelLabel,
  shopPlaceId,
  shopSuggestions,
  shopTitle,
  shopTrades,
  shopsOf,
  stockRows,
} from '../../domain/shop';
import { createEntity, type Entity, type Shop } from '../../domain/schema';
import { SRD_ATTRIBUTION } from '../../domain/srd/lookup';
import { openShop } from '../../shell/commands';
import { useFocus } from '../../shell/focus';
import {
  Button,
  Checkbox,
  ChronicleList,
  EntityLink,
  EntityPicker,
  IconButton,
  toast,
} from '../../ui';
import { Hint, Section } from '../welt/parts';
import {
  acceptShopSuggestions,
  addStockLines,
  moveStockLine,
  newShop,
  patchStockLine,
  removeStockLine,
  stockLineToItem,
} from './actions';
import { PriceInput, QtyInput } from './parts';
import { PriceListDialog } from './PriceListDialog';
import { RulesDialog } from './RulesDialog';
import { ShopDialog } from './ShopDialog';
import './laden.css';

/** Wie viele Geschäfte eines Ladens auf der Seite stehen; alle stehen in der Chronik. */
const TRADES_SHOWN = 4;

export function ShopSection({ entity }: { entity: Entity }) {
  const db = useDb();
  const data = useData();
  const shops = useMemo(() => shopsOf(data, entity.id), [data, entity.id]);
  const [editing, setEditing] = useState<string | null>(null);
  /** Der eben angelegte Laden: Bricht der Spielleiter ab, verschwindet er wieder. */
  const [fresh, setFresh] = useState<string | null>(null);
  // Ein Treffer der Suche öffnet den Laden zum Handeln.
  useFocus(['shop'], (focus) => {
    if (shops.some((shop) => shop.id === focus.id)) openShop(focus.id);
  });

  const create = () => {
    const shop = newShop(
      db,
      entity.kind === 'place'
        ? { placeId: entity.id }
        : {
            keeperId: entity.id,
            placeId:
              entity.kind === 'person' ? (entity.person.placeId ?? entity.person.homeId) : null,
            kind: entity.kind === 'person' ? entity.person.role : '',
          },
    );
    setEditing(shop.id);
    setFresh(shop.id);
  };

  // Personen ohne Laden: nur, wenn Rolle oder Beruf nach Handel aussehen; Fraktionen nie leer.
  if (!shops.length && entity.kind !== 'place' && !looksLikeTrader(data, entity)) return null;

  const dialog = editing && data.shops[editing] && (
    <ShopDialog
      shop={data.shops[editing]}
      fresh={fresh === editing}
      onClose={() => {
        setEditing(null);
        setFresh(null);
      }}
    />
  );

  if (!shops.length)
    return (
      <Section title="Laden">
        <Hint
          action={
            <Button size="sm" icon={<Store />} onClick={create}>
              Laden anlegen
            </Button>
          }
        >
          {entity.kind === 'place'
            ? 'Verkauft hier jemand etwas? Ein Laden mit Bestand und Preisen steht dann am Spieltisch bereit.'
            : `Verkauft ${entity.name} etwas? Ein Laden mit Bestand und Preisen steht dann am Spieltisch bereit.`}
        </Hint>
        {dialog}
      </Section>
    );

  return (
    <Section
      title={shops.length === 1 ? 'Laden' : 'Läden'}
      count={shops.length > 1 ? shops.length : undefined}
      action={
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={create}>
          Laden
        </Button>
      }
    >
      {shops.map((shop) => (
        <ShopCard
          key={shop.id}
          shop={shop}
          owner={entity}
          onEdit={() => {
            setEditing(shop.id);
            setFresh(null);
          }}
        />
      ))}
      {dialog}
    </Section>
  );
}

function ShopCard({ shop, owner, onEdit }: { shop: Shop; owner: Entity; onEdit: () => void }) {
  const db = useDb();
  const data = useData();
  const rows = useMemo(() => stockRows(data, shop), [data, shop]);
  const suggestions = useMemo(() => shopSuggestions(data, shop), [data, shop]);
  const trades = useMemo(() => shopTrades(data, shop.id), [data, shop.id]);
  const [pasting, setPasting] = useState(false);
  const [rules, setRules] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const at = shopPlaceId(data, shop);

  const facts = [
    shop.title.trim() && shop.kind.trim(),
    shop.keeperId && shop.keeperId !== owner.id && data.entities[shop.keeperId]
      ? entityName(data, shop.keeperId)
      : '',
    at && at !== owner.id ? `in ${entityName(data, at)}` : '',
    priceLevelLabel(shop.priceFactor),
    `kauft an für ${buyLevelLabel(shop.buyFactor)}`,
    shop.buys.length ? `kauft: ${shop.buys.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const addFromWorld = (id: string | null) => {
    const entity = id ? data.entities[id] : undefined;
    if (entity) addStockLines(db, shop.id, [{ entityId: entity.id, text: entity.name }]);
  };
  const makeItem = (lineId: string, name: string) => {
    const result = stockLineToItem(db, shop.id, lineId);
    if (!result) return;
    if ('takenBy' in result) {
      toast({
        title: `${name} nicht angelegt`,
        body: `Den Namen trägt schon ${result.takenBy}. Benenne die Zeile um, dann geht es.`,
      });
      return;
    }
    toast({
      title: result.created ? `${name} ist jetzt ein Gegenstand` : `${name} verbunden`,
      body: result.created
        ? result.rule
          ? 'Mit dem Preis des Regelwerks als Listenpreis – zu finden unter „Welt“.'
          : 'Zu finden unter „Welt“; der Preis hier im Laden bleibt.'
        : 'Den Eintrag gab es schon; die Zeile gehört jetzt zu ihm.',
      action: { label: 'Rückgängig', run: result.undo },
    });
  };
  const accept = () => {
    const undo = acceptShopSuggestions(db, shop.id, picked);
    setSuggesting(false);
    setPicked([]);
    if (undo)
      toast({
        title: picked.length === 1 ? '1 Ware im Bestand' : `${picked.length} Waren im Bestand`,
        action: { label: 'Rückgängig', run: undo },
      });
  };

  return (
    <div className="wf-laden-shop">
      <div className="wf-laden-shop__head">
        <h3 className="wf-laden-shop__title">{shopTitle(data, shop)}</h3>
        <IconButton label="Laden bearbeiten" size="sm" variant="ghost" onClick={onEdit}>
          <Settings2 />
        </IconButton>
        <span className="wf-grow" />
        <Button size="sm" icon={<Store />} onClick={() => openShop(shop.id)}>
          Handeln
        </Button>
      </div>
      <div className="wf-laden-shop__facts">{facts}</div>
      {shop.notes.trim() && <p className="wf-prose wf-soft">{shop.notes.trim()}</p>}

      {rows.length > 0 ? (
        <div className="wf-laden-stock">
          <div className="wf-laden-stockrow wf-laden-stockhead">
            <span>Ware</span>
            <span>Preis hier</span>
            <span>Menge</span>
            <span />
          </div>
          {rows.map((row, index) => (
            <div key={row.line.id} className="wf-laden-stockrow">
              <span className="wf-laden-stockrow__name">
                {row.entity ? <EntityLink id={row.entity.id} /> : <span>{row.name}</span>}
                <span className="wf-laden-stockrow__sub">
                  {[
                    row.category,
                    row.single && 'einzelnes Stück',
                    row.own
                      ? row.listPrice !== null
                        ? `Liste ${formatPrice(row.listPrice)}`
                        : row.rule && `Regelwerk ${formatPrice(row.rule.price)}`
                      : row.listPrice === null &&
                        (row.rule ? 'Preis nach dem Regelwerk' : row.entity && 'ohne Listenpreis'),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <PriceInput
                label={`Preis hier: ${row.name}`}
                value={row.line.price}
                placeholder={row.price !== null ? formatPrice(row.price) : 'Preis'}
                onChange={(price) => patchStockLine(db, shop.id, row.line.id, { price })}
              />
              <QtyInput
                label={`Menge: ${row.name}`}
                value={row.line.qty}
                onChange={(qty) => patchStockLine(db, shop.id, row.line.id, { qty })}
              />
              <span className="wf-row" style={{ gap: 0 }}>
                {!row.entity && (
                  <IconButton
                    label={`Als Gegenstand anlegen: ${row.name}`}
                    size="sm"
                    variant="ghost"
                    onClick={() => makeItem(row.line.id, row.name)}
                  >
                    <PackagePlus />
                  </IconButton>
                )}
                <IconButton
                  label={`Nach oben: ${row.name}`}
                  size="sm"
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => moveStockLine(db, shop.id, row.line.id, -1)}
                >
                  <ArrowUp />
                </IconButton>
                <IconButton
                  label={`Nach unten: ${row.name}`}
                  size="sm"
                  variant="ghost"
                  disabled={index === rows.length - 1}
                  onClick={() => moveStockLine(db, shop.id, row.line.id, 1)}
                >
                  <ArrowDown />
                </IconButton>
                <IconButton
                  label={`Aus dem Bestand: ${row.name}`}
                  size="sm"
                  variant="ghost"
                  onClick={() => removeStockLine(db, shop.id, row.line.id)}
                >
                  <X />
                </IconButton>
              </span>
            </div>
          ))}
          {rows.some((row) => row.rule) && (
            <p className="wf-laden-credit" title={SRD_ATTRIBUTION.en}>
              Preise nach dem Regelwerk: {SRD_ATTRIBUTION.short}
            </p>
          )}
        </div>
      ) : (
        <p className="wf-laden-empty">
          Noch kein Bestand. Wähle Waren aus der Welt oder aus dem Regelwerk, oder füge eine
          Preisliste ein – leerer Preis heißt Listenpreis mal Preisstufe, leere Menge heißt: so
          viele man will.
        </p>
      )}

      <div className="wf-laden-add">
        <EntityPicker
          value={null}
          onChange={addFromWorld}
          kinds={[...TRADE_KINDS]}
          placeholder="Ware aus der Welt …"
          allowClear={false}
          exclude={shop.stock.map((line) => line.entityId).filter((id): id is string => !!id)}
          onCreate={(name) => db.put('entities', createEntity({ kind: 'item', name })).id}
        />
        <Button size="sm" icon={<BookOpen />} onClick={() => setRules(true)}>
          Aus dem Regelwerk …
        </Button>
        <Button size="sm" icon={<ClipboardList />} onClick={() => setPasting(true)}>
          Preisliste einfügen …
        </Button>
        {suggestions.length > 0 && !suggesting && (
          <Button size="sm" variant="ghost" onClick={() => setSuggesting(true)}>
            {suggestions.length === 1 ? '1 Vorschlag' : `${suggestions.length} Vorschläge`}
          </Button>
        )}
      </div>

      {suggesting && (
        <div className="wf-laden-suggest" aria-label="Vorschläge für den Bestand">
          <div className="wf-caps">Könnte passen – aus deinen Einträgen</div>
          {suggestions.map((s) => (
            <div key={s.entity.id} className="wf-laden-suggest__row">
              <Checkbox
                checked={picked.includes(s.entity.id)}
                onChange={(on) =>
                  setPicked((current) =>
                    on ? [...current, s.entity.id] : current.filter((id) => id !== s.entity.id),
                  )
                }
              >
                {s.entity.name}
              </Checkbox>
              <span className="wf-laden-suggest__why">
                {s.price === null ? 'ohne Listenpreis' : formatPrice(s.price)} · {s.reason}
              </span>
            </div>
          ))}
          <div className="wf-row">
            <Button
              size="sm"
              onClick={() => {
                setSuggesting(false);
                setPicked([]);
              }}
            >
              Schließen
            </Button>
            <Button size="sm" icon={<Plus />} disabled={!picked.length} onClick={accept}>
              In den Bestand
            </Button>
          </div>
        </div>
      )}

      {trades.length > 0 && (
        <div>
          <div className="wf-caps">Zuletzt</div>
          <ChronicleList entries={trades.slice(0, TRADES_SHOWN)} showDate />
        </div>
      )}
      {pasting && <PriceListDialog shop={shop} onClose={() => setPasting(false)} />}
      {rules && <RulesDialog shop={shop} onClose={() => setRules(false)} />}
    </div>
  );
}
