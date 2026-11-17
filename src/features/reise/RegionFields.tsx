/**
 * Zwei Zeilen für „Unterwegs hier“ (Seite eines Ortes) und „Landschaft“: was die Gegend für die
 * Nahrungssuche hergibt und ob es Trinkwasser gibt (`BountyFields`) – und, nur am Ort, welches
 * Klima hier gilt, auch ein eigenes mit Werten je Monat (`ClimateRow`). Ohne neue Seite: alles an
 * dem Ding, das es betrifft.
 */
import { useState } from 'react';
import { useData, useDb } from '../../data/hooks';
import { bountyOf } from '../../domain/journey';
import { YIELDS, type Place, type Yield } from '../../domain/schema';
import { FORAGE_DC, YIELD_LABEL } from '../../domain/travelRules';
import { CLIMATE_PRESETS, PRESET, presetClimateId, type ClimatePreset } from '../../domain/weather';
import { weatherZone } from '../../domain/weatherZone';
import { Input, Select, toast } from '../../ui';
import { ownClimate, patchClimateMonth, setPlaceClimate } from '../wetter/actions';
import { setPlaceBounty } from './actions';

/** Ertrag und Wasser – für einen Ort oder eine Landschaft. */
export function BountyFields({
  id,
  value,
  inheritFrom,
}: {
  id: string;
  value: { yield: Yield | null; water: boolean | null };
  /** Bei einem Ort: was von darüber gilt, als Vorgabe. */
  inheritFrom?: string | null;
}) {
  const db = useDb();
  const data = useData();
  const inherited = inheritFrom ? bountyOf(data, inheritFrom) : { yield: null, water: null };
  return (
    <div className="wf-reise-section__pair">
      <label className="wf-reise-section__field">
        <span>Was die Gegend hergibt</span>
        <Select
          value={value.yield ?? ''}
          title={`Nahrungssuche: Weisheit (Überlebenskunst) SG ${FORAGE_DC[value.yield ?? inherited.yield ?? 'modest']}`}
          onChange={(e) =>
            setPlaceBounty(db, id, { yield: (e.target.value || null) as Yield | null })
          }
        >
          <option value="">
            {inherited.yield ? `wie darüber: ${YIELD_LABEL[inherited.yield]}` : 'nicht festgelegt'}
          </option>
          {YIELDS.map((entry) => (
            <option key={entry} value={entry}>
              {YIELD_LABEL[entry]} (SG {FORAGE_DC[entry]})
            </option>
          ))}
        </Select>
      </label>
      <label className="wf-reise-section__field">
        <span>Trinkwasser</span>
        <Select
          value={value.water === null ? '' : value.water ? 'yes' : 'no'}
          onChange={(e) =>
            setPlaceBounty(db, id, {
              water: e.target.value === '' ? null : e.target.value === 'yes',
            })
          }
        >
          <option value="">
            {inherited.water === null
              ? 'nicht festgelegt'
              : `wie darüber: ${inherited.water ? 'gibt es' : 'gibt es keins'}`}
          </option>
          <option value="yes">gibt es – Bäche, Quellen</option>
          <option value="no">gibt es keins</option>
        </Select>
      </label>
    </div>
  );
}

const OWN = '__eigen';

/**
 * Das Klima eines Ortes: erkannt, eines der Vorgaben oder ein eigenes. Ein eigenes zeigt seine
 * Werte je Monat zum Ändern (niedrigste und höchste Temperatur, Niederschlag).
 */
export function ClimateRow({ place }: { place: Place }) {
  const db = useDb();
  const data = useData();
  const zone = weatherZone(data, place.id);
  const chosen = place.place.climateId;
  const preset = CLIMATE_PRESETS.find((entry) => presetClimateId(entry) === chosen) ?? null;
  const own = chosen && !preset ? data.climates[chosen] : undefined;
  const [open, setOpen] = useState(false);
  const months = data.campaign.calendar.months;
  const value = own ? OWN : (preset ?? '');
  const choose = (next: string) => {
    if (next === OWN) {
      const made = ownClimate(db, place.id, zone);
      if (made) {
        setOpen(true);
        toast({
          title: 'Eigenes Klima angelegt',
          body: 'Als Kopie des Klimas, das hier galt – ändere die Werte je Monat.',
          action: { label: 'Rückgängig', run: made.undo },
        });
      }
      return;
    }
    setPlaceClimate(db, place.id, (next || null) as ClimatePreset | null);
  };
  return (
    <div className="wf-reise-section__climate">
      <label className="wf-reise-section__field">
        <span>Klima</span>
        <Select value={value} onChange={(e) => choose(e.target.value)}>
          <option value="">
            {zone.source === 'chosen' && !own && !preset
              ? zone.climate.name
              : `erkannt: ${zone.climate.name}`}
          </option>
          {CLIMATE_PRESETS.map((entry) => (
            <option key={entry} value={entry}>
              {PRESET[entry].name}
            </option>
          ))}
          <option value={OWN}>{own ? own.name : 'Eigenes Klima …'}</option>
        </Select>
      </label>
      {own && (
        <button
          type="button"
          className="wf-reise-section__more"
          aria-expanded={open}
          onClick={() => setOpen((on) => !on)}
        >
          {open ? 'Werte je Monat zuklappen' : 'Werte je Monat'}
        </button>
      )}
      {own && open && (
        <table className="wf-reise-climate">
          <thead>
            <tr>
              <th scope="col">Monat</th>
              <th scope="col">kühlste °C</th>
              <th scope="col">wärmste °C</th>
              <th scope="col">Niederschlag %</th>
            </tr>
          </thead>
          <tbody>
            {own.months.map((month, index) => (
              <tr key={index}>
                <th scope="row">{months[index]?.name ?? index + 1}</th>
                {(['tempMin', 'tempMax', 'precipitation'] as const).map((field) => (
                  <td key={field}>
                    <Input
                      key={`${own.id}-${index}-${field}-${month[field]}`}
                      defaultValue={String(month[field])}
                      inputMode="decimal"
                      aria-label={`${months[index]?.name ?? index + 1}: ${field}`}
                      onBlur={(e) => {
                        const n = Number(e.target.value.replace(',', '.'));
                        if (!Number.isFinite(n)) return;
                        const clean =
                          field === 'precipitation' ? Math.max(0, Math.min(100, Math.round(n))) : n;
                        if (clean !== month[field])
                          patchClimateMonth(db, own.id, index, { [field]: clean });
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
