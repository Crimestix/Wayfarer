/**
 * Leise unter „Sonst noch“: Nach Morgengrauen oder einer Langen Rast bietet Wayfarer an, die
 * Ladungen magischer Gegenstände der Gruppe aufzufrischen (`rechargesDue`). Aufgefrischt wird nur,
 * wenn der Spielleiter es bestätigt; „Nicht jetzt“ schiebt das Angebot zum nächsten Morgengrauen.
 */
import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { chargesText, rechargesDue } from '../../domain/magicItem';
import { Button, EntityLink } from '../../ui';
import { postponeRecharge } from '../welt/magic';
import { RechargeDialog } from '../welt/RechargeDialog';

export function RechargeOffers() {
  const db = useDb();
  const data = useData();
  const due = useMemo(() => rechargesDue(data), [data]);
  const [open, setOpen] = useState<string | null>(null);
  if (!due.length) return null;
  return (
    <>
      {due.map(({ item, charges, reason }) => (
        <div key={item.id} className="wf-tisch-due">
          <span className="wf-tisch-due__mark" title="Ladungen">
            <Sparkles />
          </span>
          <div className="wf-tisch-due__main">
            <div className="wf-tisch-due__title wf-clamp-2">
              Ladungen auffrischen: <EntityLink id={item.id} icon={false} />
            </div>
            <div className="wf-tisch-due__meta">
              <span className="wf-tisch-due__when">{reason}</span>
              <span title={chargesText(charges)}>
                {charges.current} von {charges.max}
              </span>
            </div>
            <div className="wf-tisch-recharge__actions">
              <Button size="sm" onClick={() => setOpen(item.id)}>
                Auffrischen
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => postponeRecharge(db, item.id)}
                title="Erst nach dem nächsten Morgengrauen wieder anbieten"
              >
                Nicht jetzt
              </Button>
            </div>
          </div>
        </div>
      ))}
      {open && <RechargeDialog itemId={open} onClose={() => setOpen(null)} />}
    </>
  );
}
