/**
 * „Reise antreten“: wohin, über welche Strecke (Wege der Welt, sonst die Luftlinie), wie lange,
 * mit welchem Gelände – und auf Wunsch die Vorräte in Tagen. Erst „Aufbrechen“ macht daraus eine
 * laufende Reise (`startJourney`); gegangen wird danach am Spieltisch.
 */
import { useMemo, useState } from 'react';
import { useData, useDb } from '../../data/hooks';
import { planJourney } from '../../domain/journey';
import type { CampaignData } from '../../domain/schema';
import { wayWithHexMap, withHexes } from './hexway';

/** Der Plan mit den Hexkarten der Wege. */
const planOf = (data: CampaignData, fromId: string, toId: string) => {
  const plan = planJourney(data, fromId, toId);
  return plan ? withHexes(data, plan) : null;
};
import { createEntity } from '../../domain/schema';
import { formatWayTime } from '../../domain/ways';
import { Button, Checkbox, Dialog, EntityPicker, Field, Input, toast } from '../../ui';
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
    () => (fromId && toId ? planOf(data, fromId, toId) : null),
    [data, fromId, toId],
  );
  /** Eine Strecke ohne Weg bekommt auf Wunsch einen Weg mit Hexkarte (Gelände dazwischen). */
  const [hexes, setHexes] = useState(true);
  const freeKm = plan?.free ? (plan.legs[0]?.distanceKm ?? null) : null;
  const name = (id: string | null | undefined) => (id ? (data.entities[id]?.name ?? '?') : '?');
  const days = (text: string) => {
    const value = Number.parseFloat(text.replace(',', '.'));
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const ready =
    !!plan && (!plan.unknown || minutes > 0 || plan.legs.some((leg) => leg.minutes > 0));
  const go = () => {
    if (!plan || !toId || !fromId) return;
    // Ohne Weg, aber mit bekannter Länge: erst den Weg mit seiner Hexkarte, dann den Plan neu.
    const made = plan.free && hexes && freeKm ? wayWithHexMap(db, fromId, toId, freeKm) : null;
    const final = made ? (planOf(db.getSnapshot(), fromId, toId) ?? plan) : plan;
    const started = startJourney(db, {
      toId,
      plan: final,
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
                    {leg.hexes.length ? ` · Feld für Feld (${leg.hexes.length} Felder)` : ''}
                  </em>
                </li>
              ))}
            </ol>
            {plan.minutes > 0 && (
              <span>Zusammen etwa {formatWayTime(plan.minutes)} Reisezeit.</span>
            )}
            {/* Gelände kommt aus der Gegend, aus der Hexkarte des Weges oder aus seiner Karte. */}
            {!plan.legs.some(
              (leg) =>
                leg.ground || leg.hexes.length || (leg.pathId && data.paths[leg.pathId]?.mapId),
            ) && (
              <span className="wf-mute">
                Kein Gelände eingetragen. Auf der Seite einer Gegend legst du unter „Unterwegs hier“
                Gelände, Tempo und Tabellen fest.
              </span>
            )}
          </div>
        )}
        {plan?.free && freeKm !== null && (
          <Checkbox checked={hexes} onChange={setHexes}>
            Als Weg mit Hexkarte anlegen – dann geht es Feld für Feld, und der Weg steht im Wegenetz
          </Checkbox>
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
