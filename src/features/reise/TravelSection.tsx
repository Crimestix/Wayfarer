/**
 * „Unterwegs hier“ auf der Seite eines Ortes (meist einer Gegend): das Gelände in eigenen Worten,
 * ob es schwer zu durchqueren ist, und die Tabellen für Begegnungen und Entdeckungen als Text.
 * Es gilt für alles darunter. Wayfarer bringt kein Gelände und keine Tabelle mit
 * (Entscheidung des Spielleiters, 17. 11.: „diese Regionen festlegen können im Worldbuilding“).
 */
import { useState } from 'react';
import { useData, useDb } from '../../data/hooks';
import { groundOf, tableText } from '../../domain/journey';
import type { Place, TableKind } from '../../domain/schema';
import { Checkbox, Input, Written } from '../../ui';
import { regionTable, saveRegionTable, setPlaceGround, setPlaceNav } from './actions';
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
      <TableField place={place} kind="encounter" />
      <TableField place={place} kind="discovery" />
    </section>
  );
}

function TableField({ place, kind }: { place: Place; kind: TableKind }) {
  const db = useDb();
  const data = useData();
  const table = regionTable(data, place.id, kind);
  const [dc, setDc] = useState(table?.dc === null || !table ? '' : String(table.dc));
  const label = kind === 'encounter' ? 'Begegnungen' : 'Entdeckungen';
  const readDc = (text: string) => {
    const value = Number.parseInt(text, 10);
    return Number.isFinite(value) && value >= 1 && value <= 30 ? value : null;
  };
  return (
    <div className="wf-reise-section__table">
      <div className="wf-reise-section__tablehead">
        <span>{label}</span>
        <label className="wf-reise-section__dc">
          W20 ab
          <Input
            value={dc}
            inputMode="numeric"
            aria-label={`${label}: ab welchem W20 etwas geschieht`}
            placeholder="–"
            onChange={(event) => setDc(event.target.value)}
            onBlur={() =>
              table && saveRegionTable(db, place.id, kind, tableText(table), readDc(dc))
            }
          />
        </label>
      </div>
      <Written
        label={`${label} in ${place.name}`}
        grow
        value={tableText(table)}
        placeholder={
          kind === 'encounter'
            ? '1–4: Eine Streife\n5–7: Ein Händlerzug\n8: Etwas Hungriges'
            : '1–3: Eine alte Inschrift\n4–6: Ein verlassenes Lager'
        }
        onSave={(text) => saveRegionTable(db, place.id, kind, text, readDc(dc))}
      />
    </div>
  );
}
