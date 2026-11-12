/**
 * Eine Tür oder eine Falle der Karte: was sie ist, in welchem Zustand – und was das für den Weg
 * bedeutet, an dem sie sitzt. Beim Zeichnen lässt sie sich benennen und entfernen; am Spieltisch
 * ändert ein Handgriff ihren Zustand (aufgeschlossen, entdeckt, ausgelöst).
 */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { DOOR_STATES } from '../../domain/mapDraw';
import type { GameMap, MapSign } from '../../domain/schema';
import { Button, Checkbox, Input, cx } from '../../ui';
import { updateSign } from './actions';
import { signFacts } from './model';

const DOORS = Object.keys(DOOR_STATES) as MapSign['door'][];

export function SignCard({
  map,
  sign,
  right,
  onRemove,
  onChange,
}: {
  map: GameMap;
  sign: MapSign;
  right: boolean;
  /** Nur beim Zeichnen: Dann lässt sich das Zeichen benennen und entfernen. */
  onRemove?: () => void;
  /** Bekommt, wie sich die Änderung zurücknehmen lässt. */
  onChange?: (undo: () => void) => void;
}) {
  const db = useDb();
  const data = useData();
  const [name, setName] = useState(sign.name);
  const facts = signFacts(data, map, sign);
  const editable = onRemove !== undefined;
  const set = (patch: Parameters<typeof updateSign>[3]) => {
    const undo = updateSign(db, map.id, sign.id, patch);
    onChange?.(undo);
  };
  const commit = () => {
    if (name.trim() !== sign.name) set({ name: name.trim() });
  };
  const door = sign.kind === 'door';
  return (
    <div className={cx('wf-karten-card', right && 'wf-karten-card--right')}>
      <div className="wf-karten-card__sort">
        {facts.sort}
        {facts.on && ` · ${facts.on.name || facts.on.sort}`}
      </div>
      {editable ? (
        <Input
          value={name}
          placeholder={door ? 'Name – etwa „Eisentor“' : 'Name – etwa „Fallgrube“'}
          aria-label="Name"
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      ) : (
        sign.name && <div className="wf-karten-card__name">{sign.name}</div>
      )}
      <div className="wf-karten-card__states" role="group" aria-label="Zustand">
        {door ? (
          DOORS.map((state) => (
            <button
              key={state}
              type="button"
              className="wf-karten-chip"
              aria-pressed={sign.door === state}
              onClick={() => set({ door: state })}
            >
              {DOOR_STATES[state]}
            </button>
          ))
        ) : (
          <>
            <button
              type="button"
              className="wf-karten-chip"
              aria-pressed={sign.armed}
              onClick={() => set({ armed: true })}
            >
              scharf
            </button>
            <button
              type="button"
              className="wf-karten-chip"
              aria-pressed={!sign.armed}
              onClick={() => set({ armed: false })}
            >
              ausgelöst oder entschärft
            </button>
          </>
        )}
      </div>
      <Checkbox checked={!sign.hidden} onChange={(known) => set({ hidden: !known })}>
        Die Gruppe weiß davon
      </Checkbox>
      <p>{facts.meaning}</p>
      {editable && (
        <div className="wf-karten-card__acts">
          <Button size="sm" variant="ghost" icon={<Trash2 aria-hidden />} onClick={onRemove}>
            Entfernen
          </Button>
        </div>
      )}
    </div>
  );
}
