/**
 * „Reise antreten“: wohin, über welche Strecke (Wege der Welt, sonst die Luftlinie), wie lange,
 * mit welchem Gelände – und auf Wunsch die Vorräte in Tagen. Erst „Aufbrechen“ macht daraus eine
 * laufende Reise (`startJourney`); gegangen wird danach am Spieltisch.
 */
import { useMemo, useState } from 'react';
import { useData, useDb } from '../../data/hooks';
import { planJourney } from '../../domain/journey';
import { createEntity } from '../../domain/schema';
import { formatWayTime } from '../../domain/ways';
import { Button, Dialog, EntityPicker, Field, Input, toast } from '../../ui';
import { DurationField } from '../wege/DurationField';
import { startJourney } from './actions';

export function JourneyDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const fromId = data.state.placeId;
  const [toId, setToId] = useState<string | null>(null);
  const [minutes, setMinutes] = useState(0);
  const [food, setFood] = useState('');
  const [water, setWater] = useState('');
  const plan = useMemo(
    () => (fromId && toId ? planJourney(data, fromId, toId) : null),
    [data, fromId, toId],
  );
  const name = (id: string | null | undefined) => (id ? (data.entities[id]?.name ?? '?') : '?');
  const days = (text: string) => {
    const value = Number.parseFloat(text.replace(',', '.'));
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const ready =
    !!plan && (!plan.unknown || minutes > 0 || plan.legs.some((leg) => leg.minutes > 0));
  const go = () => {
    if (!plan || !toId) return;
    const started = startJourney(db, {
      toId,
      plan,
      minutes: plan.unknown ? minutes : null,
      food: days(food),
      water: days(water),
    });
    onClose();
    if (started)
      toast({
        title: 'Aufgebrochen',
        body: `Richtung ${name(toId)} – am Spieltisch weiter „bis zur nächsten Entscheidung“.`,
        action: { label: 'Rückgängig', run: started.undo },
      });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Reise antreten"
      width={620}
      footer={
        <>
          <span className="wf-grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!ready} onClick={go}>
            Aufbrechen
          </Button>
        </>
      }
    >
      <div className="wf-col wf-reise-dialog">
        <Field label="Von">
          <span>{name(fromId)}</span>
        </Field>
        <Field label="Wohin">
          <EntityPicker
            value={toId}
            onChange={setToId}
            kinds={['place']}
            placeholder="Ziel wählen oder neu anlegen …"
            onCreate={(text) => db.put('entities', createEntity({ kind: 'place', name: text })).id}
            autoFocus
          />
        </Field>
        {plan && (
          <div className="wf-reise-dialog__plan">
            <span className="wf-caps">
              {plan.free ? 'Ohne Weg – nach der Luftlinie' : 'Über die Wege der Welt'}
            </span>
            <ol>
              {plan.legs.map((leg, index) => (
                <li key={index}>
                  <b>{name(leg.toId)}</b>
                  <em>
                    {leg.minutes > 0 ? formatWayTime(leg.minutes) : 'Dauer offen'}
                    {leg.distanceKm ? ` · ${leg.distanceKm} km` : ''}
                    {leg.ground ? ` · ${leg.ground}` : ''}
                    {leg.slow ? ' · schwer zu durchqueren' : ''}
                  </em>
                </li>
              ))}
            </ol>
            {plan.minutes > 0 && (
              <span>Zusammen etwa {formatWayTime(plan.minutes)} Reisezeit.</span>
            )}
            {!plan.legs.some((leg) => leg.ground) && (
              <span className="wf-mute">
                Kein Gelände eingetragen. Auf der Seite einer Gegend legst du unter „Unterwegs hier“
                Gelände, Tempo und Tabellen fest.
              </span>
            )}
          </div>
        )}
        {plan?.unknown && (
          <Field label="Wie lange?" hint="Die Dauer ist nicht bekannt – trag sie ein.">
            <DurationField value={minutes} onChange={setMinutes} allowNone={false} />
          </Field>
        )}
        <div className="wf-row wf-reise-dialog__supplies">
          <Field label="Proviant (Tage)" hint="Nur ein Hinweis, abgezogen wird nichts.">
            <Input
              value={food}
              inputMode="decimal"
              placeholder="–"
              onChange={(e) => setFood(e.target.value)}
            />
          </Field>
          <Field label="Wasser (Tage)">
            <Input
              value={water}
              inputMode="decimal"
              placeholder="–"
              onChange={(e) => setWater(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
