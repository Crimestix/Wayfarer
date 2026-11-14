/**
 * Abschnitt „Laden“ auf der Seite eines Ortes, einer Person (Händler) oder Fraktion: Läden und
 * Handelsplätze anlegen und pflegen – Bestand aus allem (Welt, Bestiarium, Regelwerk, Worte) oder
 * als Preisliste, eigene Preise, Einheiten und Mengen, eine Liste nach Vorlage oder Vorschlag
 * zum Ankreuzen, „als Vorlage merken“ und was der Laden zuletzt verkauft und angekauft hat.
 */
import { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookMarked,
  BookOpen,
  ClipboardList,
  Ellipsis,
  ListChecks,
  PackagePlus,
  Plus,
  Settings2,
  Store,
  X,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import { demandText } from '../../domain/market';
import {
  buyLevelLabel,
  formatPrice,
  looksLikeTrader,
  priceLevelLabel,
  shopPlaceId,
  shopTitle,
  shopTrades,
  shopsOf,
  stockRows,
} from '../../domain/shop';
import { templateOfKind } from '../../domain/shopTemplate';
import type { Entity, Shop } from '../../domain/schema';
import { SRD_ATTRIBUTION } from '../../domain/srd/lookup';
import { openShop } from '../../shell/commands';
import { useFocus } from '../../shell/focus';
import {
  Button,
  ChronicleList,
  EntityLink,
  IconButton,
  MenuItem,
  Popover,
  confirmDialog,
  toast,
} from '../../ui';
import { Hint, Section } from '../welt/parts';
import {
  addStockLines,
  moveStockLine,
  newShop,
  patchStockLine,
  rememberAsTemplate,
  removeStockLine,
  stockLineToItem,
  wareItem,
} from './actions';
import { PriceInput, QtyInput, UnitInput, UnitList } from './parts';
import { PriceListDialog } from './PriceListDialog';
import { ProposeDialog } from './ProposeDialog';
import { RulesDialog } from './RulesDialog';
import { ShopDialog } from './ShopDialog';
import { TemplatesDialog } from './TemplatesDialog';
import { WarePicker } from './WarePicker';
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
            ? 'Verkauft hier jemand etwas – oder kann die Gruppe hier verkaufen (Markt, Hafen, Auktionshaus)? Ein Laden mit Bestand und Preisen steht dann am Spieltisch bereit.'
            : `Verkauft ${entity.name} etwas? Ein Laden mit Bestand und Preisen steht dann am Spieltisch bereit.`}
        </Hint>
        {dialog}
      </Section>
    );

  const markets = shops.filter((shop) => shop.market).length;
  return (
    <Section
      title={
        markets === shops.length
          ? shops.length === 1
            ? 'Handelsplatz'
            : 'Handelsplätze'
          : markets
            ? 'Läden und Handelsplätze'
            : shops.length === 1
              ? 'Laden'
              : 'Läden'
      }
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
      <UnitList />
      {dialog}
    </Section>
  );
}

function ShopCard({ shop, owner, onEdit }: { shop: Shop; owner: Entity; onEdit: () => void }) {
  const db = useDb();
  const data = useData();
  const rows = useMemo(() => stockRows(data, shop), [data, shop]);
  const trades = useMemo(() => shopTrades(data, shop.id), [data, shop.id]);
  const [pasting, setPasting] = useState(false);
  const [rules, setRules] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [templates, setTemplates] = useState(false);
  const at = shopPlaceId(data, shop);
  const kind = shop.kind.trim();

  const wanted = shop.demand.filter((line) => line.factor >= 1);
  const unwanted = shop.demand.filter((line) => line.factor < 1);
  const facts = [
    shop.market && 'Handelsplatz',
    shop.title.trim() && kind,
    shop.keeperId && shop.keeperId !== owner.id && data.entities[shop.keeperId]
      ? entityName(data, shop.keeperId)
      : '',
    at && at !== owner.id ? `in ${entityName(data, at)}` : '',
    priceLevelLabel(shop.priceFactor),
    `kauft an für ${buyLevelLabel(shop.buyFactor)}`,
    shop.buys.length ? `kauft gern: ${shop.buys.join(', ')}` : '',
    wanted.length
      ? `gesucht: ${wanted.map((l) => `${l.text} ${demandText(l.factor)}`).join(', ')}`
      : '',
    unwanted.length
      ? `nicht gefragt: ${unwanted.map((l) => `${l.text} ${demandText(l.factor)}`).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const stocked = shop.stock.flatMap((line) =>
    [line.entityId, line.creatureId].filter((id): id is string => !!id),
  );
  const remember = async () => {
    if (!kind) return;
    const existing = templateOfKind(data, kind);
    if (existing) {
      const ok = await confirmDialog({
        title: `Vorlage für „${existing.kind}“ ersetzen?`,
        body: 'Die Liste der Vorlage wird der Bestand dieses Ladens. Läden, die schon danach gefüllt sind, bleiben, wie sie sind.',
        confirmLabel: 'Vorlage ersetzen',
      });
      if (!ok) return;
    }
    const result = rememberAsTemplate(db, shop.id);
    if (result)
      toast({
        title: result.replaced
          ? `Vorlage für „${result.template.kind}“ ersetzt`
          : `Vorlage für „${result.template.kind}“ gemerkt`,
        body: 'Jeder Laden dieser Art kann sie unter „Liste vorschlagen“ übernehmen.',
        action: { label: 'Rückgängig', run: result.undo },
      });
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

  return (
    <div className="wf-laden-shop">
      <div className="wf-laden-shop__head">
        <h3 className="wf-laden-shop__title">{shopTitle(data, shop)}</h3>
        <IconButton label="Laden bearbeiten" size="sm" variant="ghost" onClick={onEdit}>
          <Settings2 />
        </IconButton>
        <span className="wf-grow" />
        <Button
          size="sm"
          icon={<Store />}
          onClick={() => openShop(shop.id, shop.market ? 'sell' : 'buy')}
        >
          {shop.market ? 'Verkaufen' : 'Handeln'}
        </Button>
      </div>
      <div className="wf-laden-shop__facts">{facts}</div>
      {shop.notes.trim() && <p className="wf-prose wf-soft">{shop.notes.trim()}</p>}

      {rows.length > 0 ? (
        <div className="wf-laden-stock">
          <div className="wf-laden-stockrow wf-laden-stockhead">
            <span>Ware</span>
            <span>Preis hier</span>
            <span>Einheit</span>
            <span>Menge</span>
            <span />
          </div>
          {rows.map((row, index) => {
            const sub = [
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
              .join(' · ');
            return (
              <div key={row.line.id} className="wf-laden-stockrow">
                <span className="wf-laden-stockrow__name">
                  {row.entity ? (
                    <EntityLink id={row.entity.id} />
                  ) : (
                    <span title={row.creature ? 'Wesen des Bestiariums' : undefined}>
                      {row.name}
                    </span>
                  )}
                  <span className="wf-laden-stockrow__sub" title={sub}>
                    {sub}
                  </span>
                </span>
                <PriceInput
                  label={`Preis hier: ${row.name}`}
                  value={row.line.price}
                  placeholder={row.price !== null ? formatPrice(row.price) : 'Preis'}
                  onChange={(price) => patchStockLine(db, shop.id, row.line.id, { price })}
                />
                <UnitInput
                  label={`Einheit: ${row.name}`}
                  value={row.line.unit}
                  onChange={(unit) => patchStockLine(db, shop.id, row.line.id, { unit })}
                />
                <QtyInput
                  label={`Menge: ${row.name}`}
                  value={row.line.qty}
                  onChange={(qty) => patchStockLine(db, shop.id, row.line.id, { qty })}
                />
                <span className="wf-row" style={{ gap: 0 }}>
                  <StockLineMenu
                    name={row.name}
                    first={index === 0}
                    last={index === rows.length - 1}
                    onMakeItem={
                      !row.entity && !row.creature
                        ? () => makeItem(row.line.id, row.name)
                        : undefined
                    }
                    onMove={(step) => moveStockLine(db, shop.id, row.line.id, step)}
                  />
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
            );
          })}
          {rows.some((row) => row.rule) && (
            <p className="wf-laden-credit" title={SRD_ATTRIBUTION.en}>
              Preise nach dem Regelwerk: {SRD_ATTRIBUTION.short}
            </p>
          )}
        </div>
      ) : (
        <p className="wf-laden-empty">
          Noch kein Bestand. Ein Laden kann alles führen: Gegenstände, Tiere, Pflanzen, Gesteine,
          Wesen des Bestiariums, Ausrüstung aus dem Regelwerk oder Waren in Worten. Leerer Preis
          heißt Listenpreis mal Preisstufe, leere Menge heißt: so viele man will.
        </p>
      )}

      <div className="wf-laden-add">
        <WarePicker
          placeholder="Ware hinzufügen – aus allem …"
          exclude={stocked}
          onPick={(option) =>
            addStockLines(db, shop.id, [
              { entityId: option.entityId, creatureId: option.creatureId, text: option.name },
            ])
          }
          onWords={(text) => addStockLines(db, shop.id, [{ text }])}
          onCreate={(name) => {
            const ware = wareItem(db, name);
            if (ware)
              addStockLines(db, shop.id, [
                { entityId: ware.entityId, creatureId: ware.creatureId, text: ware.name },
              ]);
          }}
        />
        <Button size="sm" icon={<ListChecks />} onClick={() => setProposing(true)}>
          Liste vorschlagen …
        </Button>
        <Button size="sm" icon={<BookOpen />} onClick={() => setRules(true)}>
          Aus dem Regelwerk …
        </Button>
        <Button size="sm" icon={<ClipboardList />} onClick={() => setPasting(true)}>
          Preisliste einfügen …
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<BookMarked />}
          disabled={!kind || !rows.length}
          title={
            !kind
              ? 'Gib dem Laden erst eine Art (Laden bearbeiten).'
              : !rows.length
                ? 'Erst etwas in den Bestand nehmen.'
                : 'Der Bestand wird die Liste für alle Läden dieser Art – zum Ankreuzen.'
          }
          onClick={remember}
        >
          {kind ? `Als Vorlage für „${kind}“ merken` : 'Als Vorlage merken'}
        </Button>
      </div>

      {trades.length > 0 && (
        <div>
          <div className="wf-caps">Zuletzt</div>
          <ChronicleList entries={trades.slice(0, TRADES_SHOWN)} showDate />
        </div>
      )}
      {pasting && <PriceListDialog shop={shop} onClose={() => setPasting(false)} />}
      {rules && <RulesDialog shop={shop} onClose={() => setRules(false)} />}
      {proposing && (
        <ProposeDialog
          shop={shop}
          onClose={() => setProposing(false)}
          onTemplates={() => {
            setProposing(false);
            setTemplates(true);
          }}
        />
      )}
      {templates && (
        <TemplatesDialog
          initialKind={kind}
          onClose={() => {
            setTemplates(false);
            setProposing(true);
          }}
        />
      )}
    </div>
  );
}

/**
 * Was man mit einer Zeile des Bestands seltener tut – verschieben, als Gegenstand anlegen – in
 * einem kleinen Menü, damit der Name der Ware in der Zeile Platz hat.
 */
function StockLineMenu({
  name,
  first,
  last,
  onMakeItem,
  onMove,
}: {
  name: string;
  first: boolean;
  last: boolean;
  onMakeItem?: () => void;
  onMove: (step: -1 | 1) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => {
    setOpen(false);
    action();
  };
  return (
    <>
      <IconButton
        ref={anchor}
        label={`Mehr zu ${name}`}
        size="sm"
        variant="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Ellipsis />
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} align="right" width={240}>
        <div role="menu" aria-label={`Mehr zu ${name}`}>
          {onMakeItem && (
            <MenuItem icon={<PackagePlus />} onClick={() => run(onMakeItem)}>
              Als Gegenstand anlegen
            </MenuItem>
          )}
          <MenuItem icon={<ArrowUp />} disabled={first} onClick={() => run(() => onMove(-1))}>
            Nach oben
          </MenuItem>
          <MenuItem icon={<ArrowDown />} disabled={last} onClick={() => run(() => onMove(1))}>
            Nach unten
          </MenuItem>
        </div>
      </Popover>
    </>
  );
}
