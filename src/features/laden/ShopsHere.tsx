/**
 * „Läden hier“ am Spieltisch – mit Handelsplätzen „Läden und Handelsplätze hier“: die Läden am
 * Ort der Gruppe und an den Orten darin. Ein Klick öffnet den Laden zum Kaufen und Verkaufen,
 * einen Handelsplatz zum Verkaufen. Die Rechnung steht in `domain/shop.ts`.
 */
import { useMemo } from 'react';
import { Store } from 'lucide-react';
import { useData } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import { demandText } from '../../domain/market';
import {
  priceLevelLabel,
  shopPlaceId,
  shopTitle,
  shopsHere,
  shopsHereTitle,
} from '../../domain/shop';
import { openShop } from '../../shell/commands';

export function ShopsHere() {
  const data = useData();
  const shops = useMemo(() => shopsHere(data), [data]);
  if (!shops.length) return null;
  const party = data.state.placeId;
  const title = shopsHereTitle(shops);
  return (
    <section className="wf-tisch-stories" aria-label={title}>
      <header className="wf-tisch-stories__head">
        <Store aria-hidden />
        <h2 className="wf-tisch-stories__title">{title}</h2>
      </header>
      {shops.map((shop) => {
        const at = shopPlaceId(data, shop);
        const wanted = shop.demand.filter((line) => line.factor >= 1);
        const brief = [
          shop.kind.trim() && !shopTitle(data, shop).startsWith(shop.kind.trim()) && shop.kind,
          at && at !== party && `in ${entityName(data, at)}`,
          shop.market
            ? wanted.length
              ? `gesucht: ${wanted.map((l) => `${l.text} ${demandText(l.factor)}`).join(', ')}`
              : 'Handelsplatz'
            : priceLevelLabel(shop.priceFactor),
          shop.market && !shop.stock.length
            ? ''
            : shop.stock.length === 1
              ? '1 Ware'
              : `${shop.stock.length} Waren`,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <div key={shop.id} className="wf-tisch-story">
            <div className="wf-tisch-story__title">
              <b className="wf-clamp-1">{shopTitle(data, shop)}</b>
              <span className="wf-tisch-story__brief">{brief}</span>
              <button
                type="button"
                className="wf-tisch-stories__link"
                onClick={() => openShop(shop.id, shop.market ? 'sell' : 'buy')}
                title={shop.market ? 'Verkaufen, versteigern – und kaufen' : 'Kaufen und verkaufen'}
              >
                {shop.market ? 'Verkaufen' : 'Handeln'}
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
