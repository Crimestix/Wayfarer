/**
 * „Wer hier haust“: die Bestände am Ort der Gruppe – ein Bau, ein Hort, ein Nest – mit dem, was
 * noch da ist. Die Rechnung steht in `domain/stock.ts`.
 */
import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { Tent } from 'lucide-react';
import { useData } from '../../data/hooks';
import { stockSummary, stocksHere } from '../../domain/stock';

export function StocksHere() {
  const data = useData();
  const [, navigate] = useLocation();
  const stocks = useMemo(() => stocksHere(data), [data]);
  if (!stocks.length) return null;
  return (
    <section className="wf-tisch-stories" aria-label="Wer hier haust">
      <header className="wf-tisch-stories__head">
        <Tent aria-hidden />
        <h2 className="wf-tisch-stories__title">Wer hier haust</h2>
      </header>
      {stocks.map((view) => (
        <div key={view.stock.id} className="wf-tisch-story">
          <div className="wf-tisch-story__title">
            <b>{view.stock.name}</b>
            <button
              type="button"
              className="wf-tisch-stories__link"
              onClick={() => navigate(`/bestaende/${view.stock.id}`)}
            >
              Zum Bestand
            </button>
          </div>
          <div className="wf-tisch-story__line">{stockSummary(view)}</div>
          {view.stock.range && (
            <div className="wf-tisch-story__line">
              <em>Revier</em> {view.stock.range}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
