/**
 * „Reise antreten“: wohin, über welche Strecke (Wege der Welt, sonst die Luftlinie), wie lange,
 * mit welchem Gelände – und auf Wunsch die Vorräte in Tagen. Erst „Aufbrechen“ macht daraus eine
 * laufende Reise (`startJourney`); gegangen wird danach am Spieltisch.
 */
import { useMemo, useState } from 'react';
import { useData, useDb } from '../../data/hooks';
import { planJourney } from '../../domain/journey';
import { landscapesOf } from '../../domain/landscape';
import { TRAVEL_HOURS } from '../../domain/march';
import { PACES, TERRAINS, type Pace, type Terrain } from '../../domain/schema';
import { DAY_KM, KM_PER_MILE, PACE_LABEL, TERRAIN_LABEL } from '../../domain/terrain';
import { PACE_EFFECT } from '../../domain/travelRules';
import type { CampaignData } from '../../domain/schema';
import { wayWithHexMap, withHexes } from './hexway';

/** Der Plan mit den Hexkarten der Wege. */
const planOf = (data: CampaignData, fromId: string, toId: string, pace: Pace = 'normal') => {
  const plan = planJourney(data, fromId, toId, pace);
  return plan ? withHexes(data, plan) : null;
};
import { createEntity } from '../../domain/schema';
import { formatWayTime } from '../../domain/ways';
import { Button, Checkbox, Dialog, EntityPicker, Field, Input, Select, toast } from '../../ui';
import { startJourney } from './actions';

export function JourneyDialog({
  onClose,
  initialTo = null,
}: {
  onClose: () => void;
  /** Ein Ziel, das schon feststeht (aus der Suche: „Reise nach …“). */
  initialTo?: string | null;
}) {
  const db = useDb();
  const data = useData();
  const fromId = data.state.placeId;
  const [toId, setToId] = useState<string | null>(initialTo);
  const [pace, setPace] = useState<Pace>('normal');
  /** Wie weit es ist, wenn Wayfarer es nicht weiß: eine Zahl und ihre Einheit. */
  const [far, setFar] = useState('');
  const [unit, setUnit] = useState<'mi' | 'days' | 'hours'>('mi');
  /** Was unterwegs liegt, wenn es keinen Weg gibt: eine Landschaft (landscape:<id>) oder ein Gelände. */
  const [ground, setGround] = useState('');
  const [food, setFood] = useState('');
  const [water, setWater] = useState('');
  const plan = useMemo(
    () => (fromId && toId ? planOf(data, fromId, toId, pace) : null),
    [data, fromId, toId, pace],
  );
  const farValue = Number.parseFloat(far.replace(',', '.'));
  const farOk = Number.isFinite(farValue) && farValue > 0;
  /** Entfernung in km, wenn sie eingetragen ist (Meilen, oder Tage und Stunden im gewählten Tempo). */
  const typedKm = !farOk
    ? null
    : unit === 'mi'
      ? farValue * KM_PER_MILE
      : unit === 'days'
        ? farValue * DAY_KM[pace]
        : (farValue * DAY_KM[pace]) / TRAVEL_HOURS;
  const minutes = typedKm === null ? 0 : Math.round((typedKm / DAY_KM[pace]) * TRAVEL_HOURS * 60);
  /** Eine Strecke ohne Weg bekommt auf Wunsch einen Weg mit Hexkarte (Gelände dazwischen). */
  const [hexes, setHexes] = useState(true);
  const freeKm = plan?.free ? (plan.legs[0]?.distanceKm ?? typedKm) : null;
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
    const picked = ground.startsWith('landscape:') ? data.entities[ground.slice(10)] : undefined;
    const made =
      plan.free && hexes && freeKm
        ? wayWithHexMap(db, fromId, toId, freeKm, {
            landscape: picked?.kind === 'landscape' ? picked : null,
            terrain: ground && !picked ? (ground as Terrain) : null,
          })
        : null;
    const final = made ? (planOf(db.getSnapshot(), fromId, toId, pace) ?? plan) : plan;
    const started = startJourney(db, {
      toId,
      plan: final,
      minutes: final.unknown ? minutes : null,
      food: days(food),
      water: days(water),
      pace,
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
        {plan?.unknown && (
          <Field
            label="Wie weit?"
            hint="Wayfarer kennt die Strecke nicht – in Meilen, Reisetagen oder Stunden."
          >
            <span className="wf-row" style={{ gap: 'var(--s-2)' }}>
              <Input
                value={far}
                inputMode="decimal"
                placeholder="z. B. 48"
                aria-label="Entfernung"
                onChange={(e) => setFar(e.target.value)}
              />
              <Select
                value={unit}
                aria-label="Einheit"
                onChange={(e) => setUnit(e.target.value as 'mi' | 'days' | 'hours')}
              >
                <option value="mi">Meilen</option>
                <option value="days">Reisetage</option>
                <option value="hours">Stunden</option>
              </Select>
            </span>
          </Field>
        )}
        {plan?.free && (
          <Field
            label="Was liegt dazwischen?"
            hint="Eine Landschaft deiner Welt oder ein Gelände – leer: Wayfarer erkennt es aus der Welt."
          >
            <Select value={ground} onChange={(e) => setGround(e.target.value)}>
              <option value="">Wayfarer erkennt es</option>
              {landscapesOf(data).length > 0 && (
                <optgroup label="Landschaften deiner Welt">
                  {landscapesOf(data).map((land) => (
                    <option key={land.id} value={'landscape:' + land.id}>
                      {land.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Gelände">
                {TERRAINS.filter((t) => t !== 'urban').map((t) => (
                  <option key={t} value={t}>
                    {TERRAIN_LABEL[t]}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>
        )}
        {plan?.free && freeKm !== null && (
          <Checkbox checked={hexes} onChange={setHexes}>
            Als Weg mit Hexkarte anlegen – dann geht es Feld für Feld, und der Weg steht im Wegenetz
          </Checkbox>
        )}
        <Field label="Tempo" hint={PACE_EFFECT[pace]}>
          <div className="wf-btn-group" role="group" aria-label="Reisetempo">
            {PACES.map((entry) => (
              <Button key={entry} aria-pressed={pace === entry} onClick={() => setPace(entry)}>
                {PACE_LABEL[entry]}
              </Button>
            ))}
          </div>
        </Field>
        <div className="wf-row wf-reise-dialog__supplies">
          <Field
            label="Proviant (Tage)"
            hint="Für die ganze Gruppe. Je Tag geht einer weg; reicht es nicht, kommen Hunger und Durst nach den Regeln."
          >
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
