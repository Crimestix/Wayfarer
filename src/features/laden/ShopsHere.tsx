/**
 * „Läden hier“ am Spieltisch: die Läden am Ort der Gruppe und an den Orten darin. Ein Klick
 * öffnet den Laden zum Kaufen und Verkaufen. Die Rechnung steht in `domain/shop.ts`.
 */
import { useMemo } from 'react';
import { Store } from 'lucide-react';
import { useData } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import { priceLevelLabel, shopPlaceId, shopTitle, shopsHere } from '../../domain/shop';
import { openShop } from '../../shell/commands';

export function ShopsHere() {
  const data = useData();
  const shops = useMemo(() => shopsHere(data), [data]);
  if (!shops.length) return null;
  const party = data.state.placeId;
  return (
    <section className="wf-tisch-stories" aria-label="Läden hier">
      <header className="wf-tisch-stories__head">
        <Store aria-hidden />
        <h2 className="wf-tisch-stories__title">Läden hier</h2>
      </header>
      {shops.map((shop) => {
        const at = shopPlaceId(data, shop);
        const brief = [
          shop.kind.trim() && !shopTitle(data, shop).startsWith(shop.kind.trim()) && shop.kind,
          at && at !== party && `in ${entityName(data, at)}`,
          priceLevelLabel(shop.priceFactor),
          shop.stock.length === 1 ? '1 Ware' : `${shop.stock.length} Waren`,
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
                onClick={() => openShop(shop.id)}
                title="Kaufen und verkaufen"
              >
                Handeln
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
