/**
 * „Unterwegs hier“ auf der Seite eines Ortes (meist einer Gegend): das Gelände in eigenen Worten,
 * ob es schwer zu durchqueren ist, und die Tabellen für Begegnungen und Entdeckungen.
 * Es gilt für alles darunter. Wayfarer bringt kein Gelände und keine Tabelle mit
 * (Entscheidung des Spielleiters, 17. 11.: „diese Regionen festlegen können im Worldbuilding“).
 */
import { Trash2 } from 'lucide-react';
import { BountyFields, ClimateRow } from './RegionFields';
import { useData, useDb } from '../../data/hooks';
import { groundOf } from '../../domain/journey';
import { WHEN_LABEL, roamingOf, type When } from '../../domain/roaming';
import type { Place, TableKind } from '../../domain/schema';
import { isUnderground } from '../../domain/underground';
import {
  Checkbox,
  FrequencySelect,
  IconButton,
  Input,
  NewLine,
  Select,
  Written,
  toast,
} from '../../ui';
import {
  regionRows,
  regionTable,
  saveRegionRows,
  setPlaceGround,
  setPlaceNav,
  setRegionTableDc,
  type RegionRow,
} from './actions';
import './reise.css';

export function TravelSection({ place }: { place: Place }) {
  const db = useDb();
  const data = useData();
  const inherited = place.place.ground || place.place.groundSlow ? null : groundOf(data, place.id);
  const from = inherited ? data.entities[inherited.regionId] : undefined;
  return (
    <section className="wf-reise-section">
      <h3 className="wf-caps">Unterwegs hier</h3>
      <p className="wf-mute wf-reise-section__lead">
        Gilt für alles, was hier liegt. Reist die Gruppe hindurch, nimmt Wayfarer das Gelände und
        würfelt alle vier Stunden und nachts auf deinen Tabellen – nur als Vorschlag.
      </p>
      <label className="wf-reise-section__field">
        <span>Gelände</span>
        <Written
          label="Gelände"
          wrap
          value={place.place.ground}
          placeholder={
            inherited
              ? `wie ${from?.name ?? 'darüber'}: ${inherited.word || 'ohne Namen'}`
              : 'in deinen Worten: Enge Gänge, Pilzwald, Sumpf …'
          }
          onSave={(word) => setPlaceGround(db, place.id, { word })}
        />
      </label>
      <Checkbox
        checked={place.place.groundSlow}
        onChange={(slow) => setPlaceGround(db, place.id, { slow })}
      >
        Schwer zu durchqueren – Reisen dauern doppelt so lange
      </Checkbox>
      <label className="wf-reise-section__dc">
        Orientierung abseits von Wegen: SG
        <Input
          key={`nav-${place.place.navDc}`}
          defaultValue={place.place.navDc === null ? '' : String(place.place.navDc)}
          inputMode="numeric"
          aria-label="Orientierung: Schwierigkeitsgrad"
          placeholder="Vorschlag"
          title="Leer: Vorschlag nach Gelände. 0: hier verirrt sich niemand."
          onBlur={(event) => {
            const text = event.target.value.trim();
            const value = Number.parseInt(text, 10);
            setPlaceNav(
              db,
              place.id,
              text === '' || !Number.isFinite(value) ? null : Math.max(0, Math.min(30, value)),
            );
          }}
        />
      </label>
      <ClimateRow place={place} />
      <BountyFields
        id={place.id}
        value={{ yield: place.place.yield, water: place.place.water }}
        inheritFrom={place.place.parentId}
      />
      <TableField place={place} kind="encounter" />
      <TableField place={place} kind="discovery" />
    </section>
  );
}

/** „Wie oft etwas geschieht“ statt „W20 ab“: die Prüfung in Worten. */
const CHANCES: readonly { dc: number | null; label: string }[] = [
  { dc: null, label: 'bei jeder Prüfung' },
  { dc: 11, label: 'oft – etwa jede zweite Prüfung' },
  { dc: 16, label: 'manchmal – etwa jede vierte' },
  { dc: 19, label: 'selten – etwa jede zehnte' },
];

/**
 * Die Tabelle einer Gegend als Tabelle (Wunsch 17. 11.: „Es müssen Tabellen sein, keine
 * Textfelder“): Was, Häufigkeit, Wann – unter der Erde ohne Wann. Trägt eine Zeile genau den Namen
 * eines Wesens im Bestiarium, kommen Anzahl, Spuren und Bau von dort.
 */
function TableField({ place, kind }: { place: Place; kind: TableKind }) {
  const db = useDb();
  const data = useData();
  const table = regionTable(data, place.id, kind);
  const rows = regionRows(table);
  const dc = table?.dc ?? null;
  const below = isUnderground(data, place.id);
  const label = kind === 'encounter' ? 'Begegnungen' : 'Entdeckungen';
  const showWhen = kind === 'encounter' && !below;
  const save = (next: RegionRow[]) => saveRegionRows(db, place.id, kind, next, dc);
  const change = (index: number, patch: Partial<RegionRow>) =>
    save(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const chances = CHANCES.some((entry) => entry.dc === dc)
    ? CHANCES
    : [...CHANCES, { dc, label: `W20 ab ${dc}` }];
  return (
    <div className="wf-reise-section__table">
      <div className="wf-reise-section__tablehead">
        <span>{label}</span>
        {table && (
          <label className="wf-reise-section__dc">
            Es geschieht
            <Select
              value={dc === null ? '' : String(dc)}
              aria-label={`${label}: wie oft eine Prüfung etwas ergibt`}
              onChange={(event) =>
                setRegionTableDc(
                  db,
                  place.id,
                  kind,
                  event.target.value ? Number(event.target.value) : null,
                )
              }
            >
              {chances.map((entry) => (
                <option key={entry.label} value={entry.dc === null ? '' : String(entry.dc)}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
      <table className="wf-reise-table">
        {rows.length > 0 && (
          <thead>
            <tr>
              <th scope="col">Was</th>
              <th scope="col" className="wf-reise-table__freq">
                Häufigkeit
              </th>
              {showWhen && (
                <th scope="col" className="wf-reise-table__when">
                  Wann
                </th>
              )}
              <th scope="col" aria-label="Zeile entfernen" />
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, index) => {
            const creature = row.creatureId ? data.creatures[row.creatureId] : undefined;
            const active = creature ? roamingOf(data, creature.id).active : null;
            return (
              <tr key={index}>
                <td>
                  <Written
                    wrap
                    value={row.text}
                    label={`${label} in ${place.name}, Zeile ${index + 1}`}
                    onSave={(text) => {
                      if (text.trim() !== row.text) change(index, { text });
                    }}
                  />
                  {creature && (
                    <span
                      className="wf-reise-table__from"
                      title="Anzahl, Spuren und Bau kommen aus dem Bestiarium"
                    >
                      aus dem Bestiarium
                    </span>
                  )}
                </td>
                <td className="wf-reise-table__freq">
                  <FrequencySelect
                    weight={row.weight}
                    label={`${label}, Zeile ${index + 1}: Häufigkeit`}
                    onChange={(weight) => change(index, { weight })}
                  />
                </td>
                {showWhen && (
                  <td className="wf-reise-table__when">
                    <Select
                      value={row.when ?? ''}
                      aria-label={`${label}, Zeile ${index + 1}: wann`}
                      onChange={(event) =>
                        change(index, { when: (event.target.value || null) as When | null })
                      }
                    >
                      <option value="">
                        {active ? `wie im Bestiarium (${WHEN_LABEL[active]})` : WHEN_LABEL.always}
                      </option>
                      <option value="day">{WHEN_LABEL.day}</option>
                      <option value="night">{WHEN_LABEL.night}</option>
                    </Select>
                  </td>
                )}
                <td>
                  <IconButton
                    label="Zeile entfernen"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const undo = save(rows.filter((_, i) => i !== index));
                      toast({
                        title: 'Zeile entfernt',
                        body: row.text,
                        action: { label: 'Rückgängig', run: undo },
                      });
                    }}
                  >
                    <Trash2 />
                  </IconButton>
                </td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={showWhen ? 4 : 3}>
              <NewLine
                label={`${label} in ${place.name}: neue Zeile`}
                placeholder={
                  kind === 'encounter'
                    ? 'Was hier unterwegs ist – ein Wesen aus dem Bestiarium oder ein paar Worte …'
                    : 'Was man hier entdecken kann …'
                }
                onAdd={(text) => save([...rows, { text, creatureId: null, weight: 2, when: null }])}
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
