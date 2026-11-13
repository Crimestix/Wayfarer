/** Eine Einrichtung der Bastion anlegen oder ändern. */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { ORDER_LABEL, STATE_LABEL } from '../../domain/bastion';
import { activeParty } from '../../domain/derive';
import { roomsOf } from '../../domain/rooms';
import {
  BASTION_ORDERS,
  FACILITY_STATES,
  type Bastion,
  type BastionFacility,
  type BastionOrder,
  type FacilityState,
} from '../../domain/schema';
import { Button, Checkbox, Dialog, Field, Input, Select, TextArea, toast } from '../../ui';
import { removeFacility, saveFacility } from './actions';

export function FacilityDialog({
  bastion,
  facility,
  onClose,
}: {
  bastion: Bastion;
  facility?: BastionFacility;
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [draft, setDraft] = useState<Omit<BastionFacility, 'id'> & { id?: string }>(
    facility ?? {
      name: '',
      roomId: null,
      kind: 'special',
      ownerId: null,
      orders: [],
      hirelings: '',
      state: 'ready',
      trackId: null,
      order: null,
      notes: '',
    },
  );
  const set = (change: Partial<BastionFacility>) => setDraft((d) => ({ ...d, ...change }));
  const rooms = bastion.placeId ? roomsOf(data, bastion.placeId) : [];
  const party = activeParty(data);
  const toggle = (order: BastionOrder, on: boolean) =>
    set({ orders: on ? [...draft.orders, order] : draft.orders.filter((o) => o !== order) });
  const save = () => {
    saveFacility(db, bastion.id, draft);
    onClose();
  };
  const remove = () => {
    if (!facility) return;
    const undo = removeFacility(db, bastion.id, facility.id);
    onClose();
    toast({ title: 'Einrichtung entfernt', action: { label: 'Rückgängig', run: undo } });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={facility ? 'Einrichtung ändern' : 'Neue Einrichtung'}
      width={580}
      footer={
        <>
          {facility && (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={remove}
              style={{ marginRight: 'auto' }}
            >
              Entfernen
            </Button>
          )}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!draft.name.trim()} onClick={save}>
            {facility ? 'Speichern' : 'Anlegen'}
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <div className="wf-form-grid">
          <Field label="Name">
            <Input
              autoFocus
              value={draft.name}
              placeholder="Schmiede"
              onChange={(event) => set({ name: event.target.value })}
            />
          </Field>
          <Field label="Art">
            <Select
              value={draft.kind}
              aria-label="Art der Einrichtung"
              onChange={(event) => set({ kind: event.target.value as BastionFacility['kind'] })}
            >
              <option value="special">besondere Einrichtung (mit Befehlen)</option>
              <option value="basic">einfache Einrichtung</option>
            </Select>
          </Field>
          <Field label="Gehört">
            <Select
              value={draft.ownerId ?? ''}
              aria-label="Wem die Einrichtung gehört"
              onChange={(event) => set({ ownerId: event.target.value || null })}
            >
              <option value="">der Gruppe</option>
              {party.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Raum"
            hint={rooms.length ? undefined : 'Räume trägst du auf der Seite des Ortes ein.'}
          >
            <Select
              value={draft.roomId ?? ''}
              aria-label="Raum der Einrichtung"
              onChange={(event) => set({ roomId: event.target.value || null })}
            >
              <option value="">ohne Raum</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Stand">
            <Select
              value={draft.state}
              aria-label="Stand der Einrichtung"
              onChange={(event) => set({ state: event.target.value as FacilityState })}
            >
              {FACILITY_STATES.map((state) => (
                <option key={state} value={state}>
                  {STATE_LABEL[state]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Gefolgsleute" hint="Namen, mit Komma getrennt.">
            <Input
              value={draft.hirelings}
              onChange={(event) => set({ hirelings: event.target.value })}
            />
          </Field>
        </div>
        {draft.kind === 'special' && (
          <Field label="Befehle" hint="Welche Befehle diese Einrichtung kennt.">
            <div className="wf-bastion-orders">
              {BASTION_ORDERS.map((order) => (
                <Checkbox
                  key={order}
                  checked={draft.orders.includes(order)}
                  onChange={(on) => toggle(order, on)}
                >
                  {ORDER_LABEL[order]}
                </Checkbox>
              ))}
            </div>
          </Field>
        )}
        <Field
          label="Notizen"
          hint="Was ein Befehl hier bringt, was die Einrichtung besonders macht."
        >
          <TextArea
            rows={3}
            value={draft.notes}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </Field>
      </div>
    </Dialog>
  );
}
