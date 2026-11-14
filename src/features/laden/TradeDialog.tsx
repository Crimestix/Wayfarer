/**
 * Der Laden am Tisch: links, was er führt (oder was die Gruppe verkaufen könnte), rechts der
 * Korb mit Menge, Preis, wer kauft und der Summe. Ein Klick legt in den Korb, „Kaufen“ hält
 * alles in einem Eintrag der Chronik fest (`tradeAt`). Gehandelt wird auch ohne Laden – und
 * jeder Laden kauft und verkauft alles (aus der Welt, dem Bestiarium, in Worten), mit eigenem
 * Preis. Auf einem Handelsplatz steht „Verkaufen“ vorn; dort kann Wayfarer das Höchstgebot einer
 * Versteigerung würfeln (`auctionFor`) – als Vorschlag.
 */
import { useMemo, useState } from 'react';
import { Gavel, Plus, Store, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import { auctionDetail, demandText, isWanted, type AuctionBid } from '../../domain/market';
import { parseCoins } from '../../domain/priceList';
import {
  buyLevelLabel,
  filterRows,
  formatPrice,
  priceLevelLabel,
  priceWithUnit,
  ruleHits,
  rulePrice,
  sellables,
  shopTitle,
  shopsHere,
  ruleLabel,
  stockRows,
} from '../../domain/shop';
import { normalize } from '../../domain/derive';
import type { ShopDemand, TradeDirection } from '../../domain/schema';
import { SRD_ATTRIBUTION } from '../../domain/srd/lookup';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  Field,
  IconButton,
  Input,
  Select,
  Tabs,
  cx,
  toast,
} from '../../ui';
import { fairDie } from '../bestiarium/model';
import { MOUNT_KIND_LABEL } from '../../domain/mounts';
import { addMeans } from '../fortbewegung/actions';
import { tradeAt } from './actions';
import {
  addFree,
  addRow,
  addRuleItem,
  addSellable,
  addWare,
  auctionFor,
  meansInBasket,
  basketProblem,
  basketTotal,
  inBasket,
  readQty,
  sellerOf,
  setPrice,
  setQty,
  tradeInputOf,
  tradersOf,
  type BasketLine,
} from './model';
import { PriceInput, UNIT_LIST_ID, UnitList } from './parts';
import { WarePicker } from './WarePicker';
import './laden.css';

/** Gesucht oder nicht gefragt, in wenigen Worten: „gesucht +50 %“. */
const demandHint = (demand: ShopDemand | null | undefined): string =>
  demand ? `${isWanted(demand) ? 'gesucht' : 'nicht gefragt'} ${demandText(demand.factor)}` : '';

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
  const [auctions, setAuctions] = useState<Record<string, AuctionBid>>({});
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
  const [freeUnit, setFreeUnit] = useState('');
  // Reittiere, Fahrzeuge und Schiffe im Korb: beim Kauf eintragen – vorab angekreuzt, was klar
  // eines ist (`MeansOffer.checked`); von Hand geändert gilt, was der Spielleiter gewählt hat.
  const [pickedMeans, setPickedMeans] = useState<Readonly<Record<string, boolean>>>({});

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
  const meansOffers = useMemo(
    () => (tab === 'buy' ? meansInBasket(data, shop, buy) : []),
    [data, shop, buy, tab],
  );
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
    setBasket((b) => addFree(b, freeText, price, { shop, direction: tab, unit: freeUnit }));
    setFreeText('');
    setFreePrice('');
    setFreeUnit('');
  };
  const switchShop = (next: string | null) => {
    setChosen(next);
    // Preise hängen am Laden: Was im Korb lag, galt für den vorigen.
    setBuy([]);
    setSell([]);
    setQuery('');
    setAuctions({});
    const market = next ? data.shops[next]?.market : false;
    if (market) setTab('sell');
  };
  const auction = (line: BasketLine, wide?: boolean) => {
    const result = auctionFor(line, fairDie, wide);
    if (result) setAuctions((now) => ({ ...now, [line.key]: result }));
  };
  const dropAuction = (key: string) =>
    setAuctions((now) => Object.fromEntries(Object.entries(now).filter(([k]) => k !== key)));

  const save = () => {
    if (problem) return;
    const result = tradeAt(db, tradeInputOf(basket, shop?.id ?? null, tab, who), { text: note });
    if ('problem' in result) {
      toast({ title: 'Nicht festgehalten', body: result.problem, tone: 'danger' });
      return;
    }
    // Gekaufte Reittiere, Fahrzeuge und Schiffe gehören danach dem, der gekauft hat.
    const means = meansOffers
      .filter((offer) => pickedMeans[offer.key] ?? offer.checked)
      .flatMap((offer) =>
        Array.from({ length: offer.qty }, () => ({ ...offer.values, ownerId: who })),
      );
    const added = means.length ? addMeans(db, means) : null;
    onClose();
    toast({
      title: tab === 'buy' ? 'Gekauft' : 'Verkauft',
      body: `${tab === 'buy' ? 'Bezahlt' : 'Erhalten'}: ${formatPrice(result.entry.trade!.total)} – steht in der Mitschrift.${
        added?.mounts.length
          ? ` ${[...new Set(added.mounts.map((m) => m.name))].join(', ')} steht jetzt bei den Reittieren, Fahrzeugen und Schiffen.`
          : ''
      }`,
      action: {
        label: 'Rückgängig',
        run: () => {
          added?.undo();
          result.undo();
        },
      },
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
              {shop.market && <Badge tone="gold">Handelsplatz</Badge>}
              <Badge tone={shop.priceFactor > 1 ? 'ember' : shop.priceFactor < 1 ? 'moss' : 'gold'}>
                {priceLevelLabel(shop.priceFactor)}
              </Badge>
              <span>kauft an für {buyLevelLabel(shop.buyFactor)}</span>
              {shop.demand.map((line) => (
                <span key={line.id} className="wf-laden-hint">
                  {line.text} {demandText(line.factor)}
                </span>
              ))}
            </span>
          )}
        </div>
        <Tabs<TradeDirection>
          tabs={(shop?.market ? (['sell', 'buy'] as const) : (['buy', 'sell'] as const)).map(
            (id) =>
              id === 'buy'
                ? { id, label: 'Kaufen', count: buy.length || undefined }
                : { id, label: 'Verkaufen', count: sell.length || undefined },
          )}
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
                            : row.rule
                              ? `${ruleLabel(row.rule)} ${formatPrice(row.rule.price)}`
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
                        {row.price === null ? 'Preis offen' : priceWithUnit(row.price, row.unit)}
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
                  oder Händlers – hier geht alles auch so: aus allem wählen oder in Worten.
                </p>
              )}
              {tab === 'buy' && !shop && (
                <p className="wf-laden-empty">
                  Ohne Laden: Wähle Waren aus allem oder schreibe sie mit Preis auf.
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
                        {[
                          offer.ownerId ? entityName(data, offer.ownerId) : 'die Gruppe',
                          demandHint(offer.demand),
                          !offer.wanted && 'kauft sonst lieber anderes',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
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
                  Die Gruppe hat keine Gegenstände der Welt. Was sie verkauft – Beute, Felle, Salz,
                  ein gefangenes Tier –, wählst du unten aus allem oder schreibst es mit Preis auf.
                </p>
              )}
            </div>
            <div className="wf-laden-more">
              <WarePicker
                placeholder="Aus allem – Welt, Bestiarium …"
                onPick={(option) => setBasket((b) => addWare(b, data, option, shop, tab))}
                onWords={(text) =>
                  setBasket((b) => addFree(b, text, null, { shop, direction: tab }))
                }
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
                <Input
                  className="wf-laden-unit"
                  value={freeUnit}
                  list={UNIT_LIST_ID}
                  placeholder="je Stück"
                  aria-label="Einheit der Ware in Worten"
                  onChange={(event) => setFreeUnit(event.target.value)}
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
            {basket.map((line) => {
              const bid = tab === 'sell' ? auctions[line.key] : undefined;
              const sub = [
                line.unit,
                tab === 'sell' && demandHint(line.demand),
                line.max !== null && line.max > 1 && `höchstens ${line.max}`,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <div key={line.key} className="wf-laden-entry">
                  <div className="wf-laden-line">
                    <span className="wf-laden-line__main">
                      <span className="wf-clamp-1" title={line.text}>
                        {line.text}
                      </span>
                      {sub && <span className="wf-laden-line__unit">{sub}</span>}
                    </span>
                    <QtyField
                      line={line}
                      onChange={(qty) => setBasket((b) => setQty(b, line.key, qty))}
                    />
                    <PriceInput
                      label={`Preis ${line.unit || 'je Stück'}: ${line.text}`}
                      value={line.price}
                      onChange={(price) => setBasket((b) => setPrice(b, line.key, price))}
                    />
                    {tab === 'sell' && (
                      <IconButton
                        label={`Versteigern: ${line.text}`}
                        size="sm"
                        variant="ghost"
                        disabled={(line.worth ?? line.price ?? 0) <= 0}
                        onClick={() => auction(line, bid?.wide)}
                      >
                        <Gavel />
                      </IconButton>
                    )}
                    <IconButton
                      label={`Aus dem Korb: ${line.text}`}
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setBasket((b) => setQty(b, line.key, 0));
                        dropAuction(line.key);
                      }}
                    >
                      <X />
                    </IconButton>
                  </div>
                  {bid && (
                    <div className="wf-laden-auction" aria-label={`Versteigerung: ${line.text}`}>
                      <span>Höchstgebot</span>
                      <span className="wf-laden-auction__bid">{formatPrice(bid.bid)}</span>
                      <span className="wf-grow" />
                      <Button
                        size="sm"
                        onClick={() => {
                          setBasket((b) => setPrice(b, line.key, bid.bid));
                          dropAuction(line.key);
                        }}
                      >
                        Annehmen
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => auction(line, bid.wide)}>
                        Neu würfeln
                      </Button>
                      <Checkbox checked={bid.wide} onChange={(wide) => auction(line, wide)}>
                        selten
                      </Checkbox>
                      <span className="wf-laden-auction__why">
                        {auctionDetail(bid)} · Rahmen {formatPrice(bid.low)} bis{' '}
                        {formatPrice(bid.high)}
                        {line.qty > 1 || line.unit ? ` · ${line.unit || 'je Stück'}` : ''} – oder
                        nenne deinen eigenen Preis.
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
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
            {meansOffers.length > 0 && (
              <div className="wf-laden-means" aria-label="Reittiere, Fahrzeuge und Schiffe">
                {meansOffers.map((offer) => (
                  <Checkbox
                    key={offer.key}
                    checked={pickedMeans[offer.key] ?? offer.checked}
                    onChange={(on) => setPickedMeans((now) => ({ ...now, [offer.key]: on }))}
                  >
                    {offer.qty > 1 ? `${offer.qty}× ` : ''}
                    {offer.values.name} als {MOUNT_KIND_LABEL[offer.values.kind]}{' '}
                    {who ? `von ${entityName(data, who)}` : 'der Gruppe'} eintragen
                  </Checkbox>
                ))}
              </div>
            )}
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
      <UnitList />
    </Dialog>
  );
}

/** Die Menge im Korb zum Tippen: „12“. Leer oder unlesbar bleibt es, wie es war; weg nur mit ×. */
function QtyField({ line, onChange }: { line: BasketLine; onChange: (qty: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const read = readQty(text);
    if (read !== null && read !== line.qty) onChange(read);
    setText(null);
  };
  return (
    <Input
      className="wf-laden-line__qty"
      inputMode="numeric"
      value={text ?? String(line.qty)}
      aria-label={`Menge: ${line.text}`}
      title={line.max !== null ? `Menge – höchstens ${line.max}` : 'Menge'}
      onChange={(event) => setText(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
