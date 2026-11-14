/**
 * Der Laden am Tisch: links, was er führt (oder was die Gruppe verkaufen könnte), rechts der
 * Korb mit Menge, Preis, wer kauft und der Summe. Ein Klick legt in den Korb, „Kaufen“ hält
 * alles in einem Eintrag der Chronik fest (`tradeAt`). Gehandelt wird auch ohne Laden.
 */
import { useMemo, useState } from 'react';
import { Minus, Plus, Store, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import { parseCoins, TRADE_KINDS } from '../../domain/priceList';
import {
  buyLevelLabel,
  filterRows,
  formatPrice,
  priceLevelLabel,
  ruleHits,
  rulePrice,
  sellables,
  shopTitle,
  shopsHere,
  stockRows,
} from '../../domain/shop';
import { normalize } from '../../domain/derive';
import type { TradeDirection } from '../../domain/schema';
import { SRD_ATTRIBUTION } from '../../domain/srd/lookup';
import {
  Badge,
  Button,
  Dialog,
  EntityPicker,
  Field,
  IconButton,
  Input,
  Select,
  Tabs,
  cx,
  toast,
} from '../../ui';
import { tradeAt } from './actions';
import {
  addEntity,
  addFree,
  addRow,
  addRuleItem,
  addSellable,
  basketProblem,
  basketTotal,
  inBasket,
  sellerOf,
  setPrice,
  setQty,
  tradeInputOf,
  tradersOf,
  type BasketLine,
} from './model';
import { PriceInput } from './parts';
import './laden.css';

export function TradeDialog({
  shopId,
  direction = 'buy',
  onClose,
}: {
  /** Der Laden; null = wählen (oder ohne Laden handeln). */
  shopId: string | null;
  direction?: TradeDirection;
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const here = useMemo(() => shopsHere(data), [data]);
  const [chosen, setChosen] = useState<string | null>(
    () => shopId ?? (here.length === 1 ? here[0]!.id : null),
  );
  const shop = chosen ? (data.shops[chosen] ?? null) : null;
  const [tab, setTab] = useState<TradeDirection>(direction);
  const [buy, setBuy] = useState<BasketLine[]>([]);
  const [sell, setSell] = useState<BasketLine[]>([]);
  const basket = tab === 'buy' ? buy : sell;
  const setBasket = tab === 'buy' ? setBuy : setSell;
  const [query, setQuery] = useState('');
  const [buyer, setBuyer] = useState<string | null>(null);
  const [seller, setSeller] = useState<string | null | undefined>(undefined);
  const [note, setNote] = useState('');
  const [freeText, setFreeText] = useState('');
  const [freePrice, setFreePrice] = useState('');

  const rows = useMemo(() => (shop ? stockRows(data, shop) : []), [data, shop]);
  const shown = useMemo(() => filterRows(rows, query), [rows, query]);
  const offers = useMemo(() => sellables(data, shop), [data, shop]);
  // Was der Laden nicht führt, aber im Regelwerk steht – für den spontanen Kauf am Tisch.
  const hits = useMemo(
    () => (tab === 'buy' ? ruleHits(data, shop, query) : []),
    [data, shop, query, tab],
  );
  const q = normalize(query.trim());
  const shownOffers = q ? offers.filter((o) => normalize(o.entity.name).includes(q)) : offers;
  const traders = tradersOf(data);
  // Wer verkauft: von Hand gewählt (auch „die Gruppe“), sonst der Besitzer der gewählten Stücke.
  const who = tab === 'buy' ? buyer : seller !== undefined ? seller : (sellerOf(sell) ?? null);
  const total = basketTotal(basket);
  const problem = basketProblem(basket, tab);
  const otherShops = Object.values(data.shops)
    .filter((s) => !here.includes(s))
    .sort((a, b) => shopTitle(data, a).localeCompare(shopTitle(data, b), 'de'));

  const addFirst = () => {
    if (tab === 'buy') {
      const first = shown.find((row) => !row.soldOut);
      if (first) setBuy((b) => addRow(b, first));
      else if (hits[0]) setBuy((b) => addRuleItem(b, hits[0]!, shop));
    } else {
      const offer = shownOffers[0];
      if (offer) setSell((b) => addSellable(b, offer));
    }
  };
  const addWritten = () => {
    const price = parseCoins(freePrice);
    if (!freeText.trim() || price === undefined) return;
    setBasket((b) => addFree(b, freeText, price));
    setFreeText('');
    setFreePrice('');
  };
  const switchShop = (next: string | null) => {
    setChosen(next);
    // Preise hängen am Laden: Was im Korb lag, galt für den vorigen.
    setBuy([]);
    setSell([]);
    setQuery('');
  };

  const save = () => {
    if (problem) return;
    const result = tradeAt(db, tradeInputOf(basket, shop?.id ?? null, tab, who), { text: note });
    if ('problem' in result) {
      toast({ title: 'Nicht festgehalten', body: result.problem, tone: 'danger' });
      return;
    }
    onClose();
    toast({
      title: tab === 'buy' ? 'Gekauft' : 'Verkauft',
      body: `${tab === 'buy' ? 'Bezahlt' : 'Erhalten'}: ${formatPrice(result.entry.trade!.total)} – steht in der Mitschrift.`,
      action: { label: 'Rückgängig', run: result.undo },
    });
  };

  const title = shop ? shopTitle(data, shop) : 'Handel';
  return (
    <Dialog
      open
      onClose={onClose}
      width={860}
      title={
        <span className="wf-row">
          <Store width={20} height={20} /> {title}
        </span>
      }
      footer={
        <>
          <span className="wf-grow wf-laden-problem" role="alert">
            {basket.length ? problem : ''}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!!problem} onClick={save}>
            {tab === 'buy' ? 'Kaufen' : 'Verkaufen'}
            {total > 0 && ` · ${formatPrice(total)}`}
          </Button>
        </>
      }
    >
      <div className="wf-laden-trade">
        <div className="wf-laden-trade__top">
          {(shopId === null || !shop) && (
            <Select
              value={chosen ?? ''}
              aria-label="Wo gehandelt wird"
              onChange={(event) => switchShop(event.target.value || null)}
            >
              <option value="">Ohne Laden</option>
              {here.length > 0 && (
                <optgroup label="Hier">
                  {here.map((s) => (
                    <option key={s.id} value={s.id}>
                      {shopTitle(data, s)}
                    </option>
                  ))}
                </optgroup>
              )}
              {otherShops.length > 0 && (
                <optgroup label="Anderswo">
                  {otherShops.map((s) => (
                    <option key={s.id} value={s.id}>
                      {shopTitle(data, s)}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          )}
          {shop && (
            <span className="wf-laden-trade__facts">
              {shop.keeperId && data.entities[shop.keeperId] && (
                <span>{entityName(data, shop.keeperId)}</span>
              )}
              <Badge tone={shop.priceFactor > 1 ? 'ember' : shop.priceFactor < 1 ? 'moss' : 'gold'}>
                {priceLevelLabel(shop.priceFactor)}
              </Badge>
              <span>kauft an für {buyLevelLabel(shop.buyFactor)}</span>
            </span>
          )}
        </div>
        <Tabs<TradeDirection>
          tabs={[
            { id: 'buy', label: 'Kaufen', count: buy.length || undefined },
            { id: 'sell', label: 'Ankaufen', count: sell.length || undefined },
          ]}
          value={tab}
          onChange={(next) => {
            setTab(next);
            setQuery('');
          }}
        />
        <div className="wf-laden-trade__body">
          <div className="wf-laden-trade__pick">
            <Input
              data-autofocus
              value={query}
              placeholder={
                tab === 'buy'
                  ? 'Ware suchen, auch im Regelwerk – Eingabe legt die erste in den Korb'
                  : 'Gegenstand suchen – Eingabe legt den ersten in den Korb'
              }
              aria-label="Suchen"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addFirst();
                }
              }}
            />
            <div className="wf-laden-list" role="list">
              {tab === 'buy' &&
                shown.map((row) => {
                  const taken = inBasket(buy, `stock:${row.line.id}`);
                  const left = row.qty === null ? null : row.qty - taken;
                  const out = row.soldOut || left === 0;
                  return (
                    <button
                      key={row.line.id}
                      type="button"
                      role="listitem"
                      className={cx('wf-laden-ware', out && 'wf-laden-ware--out')}
                      disabled={out}
                      onClick={() => setBuy((b) => addRow(b, row))}
                      title={
                        row.own
                          ? 'Eigener Preis dieses Ladens'
                          : row.listPrice !== null
                            ? `Listenpreis ${formatPrice(row.listPrice)}`
                            : undefined
                      }
                    >
                      <span className="wf-laden-ware__name">
                        <b className="wf-clamp-1">{row.name}</b>
                        <span className="wf-laden-ware__sub">
                          {[
                            row.category,
                            row.single && 'einzelnes Stück',
                            row.soldOut ? 'ausverkauft' : left !== null && `${left} da`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <span className="wf-laden-ware__price">
                        {row.price === null ? 'Preis offen' : formatPrice(row.price)}
                      </span>
                      <Plus aria-hidden className="wf-laden-ware__add" />
                    </button>
                  );
                })}
              {hits.length > 0 && (
                <div className="wf-laden-rulehits" aria-label="Aus dem Regelwerk">
                  <div className="wf-laden-rulehits__head" title={SRD_ATTRIBUTION.en}>
                    Aus dem Regelwerk – nicht im Bestand
                  </div>
                  {hits.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="listitem"
                      className="wf-laden-ware wf-laden-ware--rule"
                      onClick={() => setBuy((b) => addRuleItem(b, item, shop))}
                      title={`${item.en} · Regelwerk ${formatPrice(item.price)}`}
                    >
                      <span className="wf-laden-ware__name">
                        <b className="wf-clamp-1">{item.name}</b>
                        <span className="wf-laden-ware__sub">
                          {item.sub}
                          {inBasket(buy, `srd:${item.id}`) > 0 &&
                            ` · ${inBasket(buy, `srd:${item.id}`)} im Korb`}
                        </span>
                      </span>
                      <span className="wf-laden-ware__price">
                        {formatPrice(rulePrice(shop, item))}
                      </span>
                      <Plus aria-hidden className="wf-laden-ware__add" />
                    </button>
                  ))}
                </div>
              )}
              {tab === 'buy' && shop && !rows.length && (
                <p className="wf-laden-empty">
                  Dieser Laden führt noch nichts. Den Bestand pflegst du auf der Seite des Ortes
                  oder Händlers – hier geht es auch mit „Aus der Welt“ oder in Worten.
                </p>
              )}
              {tab === 'buy' && !shop && (
                <p className="wf-laden-empty">
                  Ohne Laden: Wähle Waren aus der Welt oder schreibe sie mit Preis auf.
                </p>
              )}
              {tab === 'sell' &&
                shownOffers.map((offer) => (
                  <button
                    key={offer.entity.id}
                    type="button"
                    role="listitem"
                    className={cx(
                      'wf-laden-ware',
                      !offer.wanted && 'wf-laden-ware--unwanted',
                      inBasket(sell, `item:${offer.entity.id}`) > 0 && 'wf-laden-ware--out',
                    )}
                    disabled={inBasket(sell, `item:${offer.entity.id}`) > 0}
                    onClick={() => setSell((b) => addSellable(b, offer))}
                  >
                    <span className="wf-laden-ware__name">
                      <b className="wf-clamp-1">{offer.entity.name}</b>
                      <span className="wf-laden-ware__sub">
                        {offer.ownerId ? entityName(data, offer.ownerId) : 'die Gruppe'}
                        {!offer.wanted && ' · kauft so etwas eigentlich nicht an'}
                      </span>
                    </span>
                    <span className="wf-laden-ware__price">
                      {offer.price === null ? 'ohne Listenpreis' : formatPrice(offer.price)}
                    </span>
                    <Plus aria-hidden className="wf-laden-ware__add" />
                  </button>
                ))}
              {tab === 'sell' && !offers.length && (
                <p className="wf-laden-empty">
                  Die Gruppe hat keine Gegenstände der Welt. Was sie verkauft, wählst du aus der
                  Welt oder schreibst es mit Preis auf.
                </p>
              )}
            </div>
            <div className="wf-laden-more">
              <EntityPicker
                value={null}
                onChange={(id) => {
                  const entity = id ? data.entities[id] : undefined;
                  if (entity) setBasket((b) => addEntity(b, entity, shop, tab));
                }}
                kinds={[...TRADE_KINDS]}
                placeholder="Aus der Welt …"
                allowClear={false}
              />
              <div className="wf-laden-free">
                <Input
                  value={freeText}
                  placeholder="In Worten: Proviant für drei Tage"
                  aria-label="Ware in Worten"
                  onChange={(event) => setFreeText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addWritten();
                  }}
                />
                <Input
                  className="wf-laden-price"
                  value={freePrice}
                  placeholder="5 SM"
                  aria-label="Preis der Ware in Worten"
                  aria-invalid={
                    freePrice.trim() !== '' && parseCoins(freePrice) === undefined
                      ? true
                      : undefined
                  }
                  onChange={(event) => setFreePrice(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addWritten();
                  }}
                />
                <IconButton
                  label="In den Korb"
                  disabled={!freeText.trim() || parseCoins(freePrice) === undefined}
                  onClick={addWritten}
                >
                  <Plus />
                </IconButton>
              </div>
            </div>
          </div>

          <div className="wf-laden-basket" aria-label="Korb">
            <div className="wf-caps">Korb</div>
            {!basket.length && (
              <p className="wf-laden-empty">
                {tab === 'buy'
                  ? 'Ein Klick auf eine Ware legt sie hierher.'
                  : 'Ein Klick auf einen Gegenstand legt ihn hierher.'}
              </p>
            )}
            {basket.map((line) => (
              <div key={line.key} className="wf-laden-line">
                <span className="wf-laden-line__name wf-clamp-1" title={line.text}>
                  {line.text}
                </span>
                <span className="wf-laden-qty">
                  <IconButton
                    label={`Eins weniger: ${line.text}`}
                    size="sm"
                    variant="ghost"
                    onClick={() => setBasket((b) => setQty(b, line.key, line.qty - 1))}
                  >
                    <Minus />
                  </IconButton>
                  <span className="wf-laden-qty__n">{line.qty}</span>
                  <IconButton
                    label={`Eins mehr: ${line.text}`}
                    size="sm"
                    variant="ghost"
                    disabled={line.max !== null && line.qty >= line.max}
                    onClick={() => setBasket((b) => setQty(b, line.key, line.qty + 1))}
                  >
                    <Plus />
                  </IconButton>
                </span>
                <PriceInput
                  label={`Stückpreis: ${line.text}`}
                  value={line.price}
                  onChange={(price) => setBasket((b) => setPrice(b, line.key, price))}
                />
                <IconButton
                  label={`Aus dem Korb: ${line.text}`}
                  size="sm"
                  variant="ghost"
                  onClick={() => setBasket((b) => setQty(b, line.key, 0))}
                >
                  <X />
                </IconButton>
              </div>
            ))}
            <div className="wf-laden-sum">
              <span className="wf-caps">Summe</span>
              <span className="wf-laden-sum__value">{formatPrice(total)}</span>
            </div>
            <Field label={tab === 'buy' ? 'Wer kauft' : 'Wer verkauft'}>
              <Select
                value={who ?? ''}
                aria-label={tab === 'buy' ? 'Wer kauft' : 'Wer verkauft'}
                onChange={(event) =>
                  tab === 'buy'
                    ? setBuyer(event.target.value || null)
                    : setSeller(event.target.value || null)
                }
              >
                <option value="">Die Gruppe</option>
                {traders.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Anmerkung" hint="Für die Chronik, wenn du magst.">
              <Input
                value={note}
                placeholder="gefeilscht, Rabatt für Stammkunden …"
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
