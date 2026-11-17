/** Einen Weg zwischen zwei Orten anlegen oder ändern. */
import { HazardFields } from '../reise/HazardFields';
import type { Hazard } from '../../domain/schema';
import { HexWayButton } from '../reise/HexWayButton';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { createEntity, type TravelPath } from '../../domain/schema';
import {
  WAY_SORTS,
  WAY_SORT_HINT,
  WAY_SORT_LABEL,
  sortOfWay,
  type WaySort,
} from '../../domain/wayState';
import { KM_PER_MILE } from '../../domain/terrain';
import { WALK_KMH, formatWayTime, suggestedKm, wayMinutes } from '../../domain/ways';
import { Button, Checkbox, Dialog, EntityPicker, Field, Input, Select, toast } from '../../ui';
import { removeWay, saveWay } from './actions';
import { DurationField } from './DurationField';
import './wege.css';

export function WayDialog({
  way,
  fromId,
  onClose,
}: {
  /** Vorhandener Weg zum Ändern; sonst entsteht ein neuer. */
  way?: TravelPath;
  /** Für einen neuen Weg: wo er beginnt. */
  fromId?: string;
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [from, setFrom] = useState<string | null>(way?.fromId ?? fromId ?? null);
  const [to, setTo] = useState<string | null>(way?.toId ?? null);
  const [name, setName] = useState(way?.name ?? '');
  const [minutes, setMinutes] = useState(way?.minutes ?? 0);
  const [conditions, setConditions] = useState(way?.conditions ?? '');
  const [oneWay, setOneWay] = useState(way?.oneWay ?? false);
  const [secret, setSecret] = useState(way?.secret ?? false);
  const [sort, setSort] = useState<WaySort>(way ? sortOfWay(way) : 'street');
  const [hazard, setHazard] = useState<Hazard | null>(way?.hazard ?? null);
  /** Länge in Meilen – statt einer festen Dauer: Wayfarer rechnet dann nach Tempo und Reittier. */
  const wayMiles = way?.distanceKm ? way.distanceKm / KM_PER_MILE : 0;
  const milesBefore = wayMiles
    ? String(wayMiles >= 10 ? Math.round(wayMiles) : Math.round(wayMiles * 10) / 10).replace(
        '.',
        ',',
      )
    : '';
  const [miles, setMiles] = useState(milesBefore);
  const milesValue = Number.parseFloat(miles.replace(',', '.'));
  const lengthKm =
    miles === milesBefore
      ? (way?.distanceKm ?? null)
      : Number.isFinite(milesValue) && milesValue > 0
        ? milesValue * KM_PER_MILE
        : null;
  /** Ohne feste Dauer: was sich aus der Länge ergibt – oder aus der Karte, der der Weg folgt. */
  const derived =
    lengthKm !== null
      ? Math.max(1, Math.round((lengthKm / WALK_KMH.normal) * 60))
      : way && way.minutes === null && miles === milesBefore
        ? wayMinutes(data, way)
        : null;

  // Zeigt eine Karte mit Maßstab beide Orte, ergibt sich daraus ein Vorschlag.
  const km = from && to ? suggestedKm(data, from, to) : null;
  const suggested = km === null ? null : Math.max(1, Math.round((km / WALK_KMH.normal) * 60));
  const ready = from !== null && to !== null && from !== to && (minutes > 0 || derived !== null);
  const create = (text: string) =>
    db.put('entities', createEntity({ kind: 'place', name: text })).id;

  const save = () => {
    if (!ready) return;
    saveWay(db, {
      id: way?.id,
      fromId: from,
      toId: to,
      name,
      minutes: minutes > 0 ? minutes : null,
      distanceKm: lengthKm,
      conditions,
      oneWay,
      secret,
      sort,
      hazard,
    });
    onClose();
  };
  const remove = () => {
    if (!way) return;
    const undo = removeWay(db, way.id);
    onClose();
    if (undo) toast({ title: 'Weg entfernt', action: { label: 'Rückgängig', run: undo } });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={way ? 'Weg ändern' : 'Neuer Weg'}
      width={540}
      footer={
        <>
          {way && (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={remove}
              style={{ marginRight: 'auto' }}
            >
              Entfernen
            </Button>
          )}
          {way && <HexWayButton path={way} onOpened={onClose} />}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!ready}>
            {way ? 'Speichern' : 'Weg anlegen'}
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <div className="wf-form-grid">
          <Field label="Von">
            <EntityPicker
              value={from}
              onChange={setFrom}
              kinds={['place']}
              placeholder="Ort wählen …"
              onCreate={create}
            />
          </Field>
          <Field label="Nach">
            <EntityPicker
              value={to}
              onChange={setTo}
              kinds={['place']}
              placeholder="Ort wählen oder neu anlegen …"
              onCreate={create}
              autoFocus={!way}
            />
          </Field>
        </div>
        <Field
          label="Dauer"
          hint={
            minutes === 0 && derived !== null
              ? `Keine feste Dauer: Wayfarer rechnet – zu Fuß etwa ${formatWayTime(derived)}, mit Reittier, Tempo und Gelände entsprechend.`
              : suggested !== null && minutes !== suggested
                ? `Nach der Karte etwa ${formatWayTime(suggested)} zu Fuß (${km!.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km Luftlinie).`
                : 'Wie lange die Gruppe für diesen Weg braucht – oder darunter die Länge.'
          }
        >
          <DurationField value={minutes} onChange={setMinutes} allowNone={false} />
          <label className="wf-wege-duration__exact">
            <Input
              value={miles}
              inputMode="decimal"
              placeholder="–"
              aria-label="Länge in Meilen"
              onChange={(e) => setMiles(e.target.value)}
            />
            <span>
              Meilen lang
              {lengthKm !== null ? ` · ${Math.round(lengthKm)} km` : ' – statt einer festen Dauer'}
            </span>
          </label>
        </Field>
        <Field label="Was für ein Weg" hint={WAY_SORT_HINT[sort]}>
          <Select
            value={sort}
            aria-label="Was für ein Weg"
            onChange={(e) => setSort(e.target.value as WaySort)}
          >
            {WAY_SORTS.map((entry) => (
              <option key={entry} value={entry}>
                {WAY_SORT_LABEL[entry]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name des Weges" hint="Nur wenn er einen hat – etwa „Alte Brücke“.">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Besonderheiten" hint="Zoll, Wachen, nur bei Ebbe, eingestürzt …">
          <Input value={conditions} onChange={(e) => setConditions(e.target.value)} />
        </Field>
        <Field
          label="Gefahr"
          hint="Ein Abhang, eine Kletterei: Die Reise hält dort mit SG und Sturzschaden nach den Regeln."
        >
          <HazardFields value={hazard} onChange={setHazard} />
        </Field>
        <div className="wf-wege-row">
          <Checkbox checked={oneWay} onChange={setOneWay}>
            Nur in dieser Richtung begehbar
          </Checkbox>
          <Checkbox checked={secret} onChange={setSecret}>
            Die Gruppe kennt den Weg noch nicht
          </Checkbox>
        </div>
      </div>
    </Dialog>
  );
}
