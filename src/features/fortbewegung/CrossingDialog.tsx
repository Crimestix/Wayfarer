/**
 * „Überfahrt buchen“: eine Fahrt eines Ablaufs nach Fahrplan (Fähre, Schiff, Kutschlinie). Der
 * Preis ist frei – das Regelwerk schlägt Hängematte oder Kabine je Tag vor; er steht als Handel
 * in der Mitschrift. „Buchen und mitfahren“ lässt die Zeit bis zur Ankunft vergehen
 * (`bookCrossing`), „Nur buchen“ hält nur den Handel fest. Die Rechnung steht in
 * `domain/crossing.ts`.
 */
import { useState } from 'react';
import { useData, useDb } from '../../data/hooks';
import { departureText, passagePrices, type Crossing } from '../../domain/crossing';
import { entityName } from '../../domain/derive';
import { formatPrice } from '../../domain/shop';
import { formatDateTime } from '../../domain/time/calendar';
import { formatWayTime } from '../../domain/ways';
import { walkAndReport } from '../../shell/dialogs';
import { Button, Dialog, Field, Select, toast } from '../../ui';
import { PriceInput } from '../laden/parts';
import { tradersOf } from '../laden/model';
import { bookCrossing } from '../wege/actions';
import './fortbewegung.css';

export function CrossingDialog({ crossing, onClose }: { crossing: Crossing; onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const [price, setPrice] = useState<number | null>(null);
  const [payer, setPayer] = useState<string | null>(null);
  const { run, next } = crossing;
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const to = entityName(data, run.toId);
  const traders = tradersOf(data);
  if (!next) return null;
  const input = {
    runId: run.id,
    departs: next.departs,
    arrives: next.arrives,
    price,
    payerId: payer,
  };

  const ride = () => {
    onClose();
    walkAndReport(db, () => {
      const result = bookCrossing(db, { ...input, ride: true });
      if ('problem' in result) throw new Error(result.problem);
      if (!result.walk) throw new Error('Die Gruppe ist schon dort.');
      return { ...result.walk, undo: result.undo };
    });
  };
  const book = () => {
    const result = bookCrossing(db, { ...input, ride: false });
    onClose();
    if ('problem' in result) {
      toast({ title: 'Nicht gebucht', body: result.problem, tone: 'danger' });
      return;
    }
    toast({
      title: 'Überfahrt gebucht',
      body: `${formatPrice(price ?? 0)} – steht in der Mitschrift.`,
      action: { label: 'Rückgängig', run: result.undo },
    });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      width={540}
      title={`Überfahrt mit ${run.name}`}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button
            onClick={book}
            disabled={price === null}
            title="Nur den Preis als Handel festhalten – die Zeit bleibt stehen"
          >
            Nur buchen
          </Button>
          <Button variant="primary" onClick={ride}>
            Buchen und mitfahren
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <dl className="wf-fort-trip">
          <dt>Nach</dt>
          <dd>
            {to}
            {run.carrier && <span className="wf-mute"> · {run.carrier}</span>}
          </dd>
          <dt>Abfahrt</dt>
          <dd>
            {departureText(cal, now, next.departs)}
            {crossing.elsewhere && (
              <span className="wf-mute"> · ab {entityName(data, run.fromId)}</span>
            )}
          </dd>
          <dt>Ankunft</dt>
          <dd>
            {formatDateTime(cal, next.arrives)} · {formatWayTime(next.arrives - next.departs)}{' '}
            unterwegs
            {next.delay > 0 && (
              <span className="wf-mute">
                {' '}
                – das Wetter hält sie {formatWayTime(next.delay)} auf
              </span>
            )}
          </dd>
        </dl>
        {next.blockedBy && (
          <p className="wf-fort-hint">
            Ein Abschnitt ist gerade nicht passierbar: {next.blockedBy}. Ob die Fahrt trotzdem geht,
            entscheidest du.
          </p>
        )}
        <Field
          label="Preis"
          hint="Frei. Leer: nichts bezahlt – dann steht kein Handel in der Mitschrift."
        >
          <PriceInput value={price} onChange={setPrice} label="Preis der Überfahrt" />
          <div className="wf-fort-prices">
            <span className="wf-fort-hint">Nach dem Regelwerk:</span>
            {passagePrices(next).map((suggestion) => (
              <Button
                key={suggestion.label}
                size="sm"
                variant="ghost"
                onClick={() => setPrice(suggestion.gold)}
              >
                {suggestion.label} {formatPrice(suggestion.gold)}
              </Button>
            ))}
          </div>
        </Field>
        <Field label="Wer bezahlt">
          <Select value={payer ?? ''} onChange={(e) => setPayer(e.target.value || null)}>
            <option value="">Die Gruppe</option>
            {traders.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}
