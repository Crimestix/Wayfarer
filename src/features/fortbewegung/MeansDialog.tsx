/**
 * Ein Reittier, Fahrzeug oder Schiff anlegen oder ändern: Art, wem es gehört, der Eintrag der Welt
 * dazu, Reisetempo, Plätze, Ladung, Besatzung, Unterhalt und Zustand. Die Rechnung steht in
 * `domain/mounts.ts`, die Felder in `model.ts`.
 */
import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  MOUNT_CONDITION_LABEL,
  MOUNT_KIND_HINT,
  MOUNT_KIND_LABEL,
  TRAVEL_DAY_HOURS,
} from '../../domain/mounts';
import {
  MOUNT_CONDITIONS,
  MOUNT_KINDS,
  PARTY_ID,
  createEntity,
  type Mount,
  type MountCondition,
  type MountKind,
} from '../../domain/schema';
import {
  Button,
  Checkbox,
  Dialog,
  EntityPicker,
  Field,
  Input,
  Select,
  TextArea,
  toast,
} from '../../ui';
import { wareNamed } from '../../domain/shop';
import { removeMeans, saveMeans, travelWith } from './actions';
import { meansDraft, meansInputOf, type MeansDraft } from './model';

/** Was beim Tempo als Anhalt dient – nach den Regeln von 2024. */
const PACE_HINT: Record<MountKind, string> = {
  mount:
    'Leer: im Tempo der Gruppe, wie es das Regelwerk vorsieht. Eigenes Tempo, wenn dein Tier schneller ist.',
  vehicle: 'Leer: im Tempo der Gruppe, wie es das Regelwerk vorsieht.',
  ship: 'Regelwerk: Kielboot 1, Ruderboot 1½, Segelschiff 2, Kriegsschiff 2½, Langschiff 3, Galeere 4, Luftschiff 8 Meilen je Stunde.',
};

export function MeansDialog({
  mount,
  preset,
  onClose,
}: {
  /** Vorhandenes Mittel ändern; ohne Angabe entsteht ein neues. */
  mount?: Mount;
  /** Vorgaben für ein neues: wem es gehört. */
  preset?: Partial<Mount>;
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [draft, setDraft] = useState<MeansDraft>(() => meansDraft(mount ?? preset));
  const [ride, setRide] = useState(false);
  const set = (change: Partial<MeansDraft>) => setDraft((d) => ({ ...d, ...change }));
  const result = meansInputOf(draft);
  const creatures = useMemo(
    () => Object.values(data.creatures).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    [data.creatures],
  );
  const riding = mount !== undefined && data.state.travelBy === mount.id;

  const save = () => {
    if ('problem' in result) return;
    const saved = saveMeans(db, result.input, mount?.id);
    if (saved && ride) travelWith(db, saved.id);
    onClose();
  };
  const remove = () => {
    if (!mount) return;
    const undo = removeMeans(db, mount.id);
    onClose();
    if (undo)
      toast({
        title: `${mount.name} entfernt`,
        body: riding ? 'Die Gruppe reist jetzt zu Fuß.' : undefined,
        action: { label: 'Rückgängig', run: undo },
      });
  };
  // Ein neuer Eintrag der Welt: ein Tier (es lebt) oder ein Gegenstand (gemacht). Gibt es den
  // Namen schon (auch unter anderer Art oder zweitem Namen), wird der vorhandene genommen.
  const createTwin = (name: string) =>
    wareNamed(data, name)?.entityId ??
    db.put(
      'entities',
      draft.kind === 'mount'
        ? createEntity({ kind: 'animal', name, animal: { category: 'Reittier' } })
        : createEntity({
            kind: 'item',
            name,
            item: { category: draft.kind === 'ship' ? 'Schiff' : 'Fahrzeug' },
          }),
    ).id;

  return (
    <Dialog
      open
      onClose={onClose}
      width={640}
      title={mount ? mount.name : 'Reittier, Fahrzeug oder Schiff'}
      footer={
        <>
          {mount && (
            <Button variant="ghost" icon={<Trash2 />} onClick={remove}>
              Entfernen
            </Button>
          )}
          <span className="wf-grow wf-fort-problem" role="alert">
            {'problem' in result && draft.name.trim() ? result.problem : ''}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={'problem' in result}>
            {mount ? 'Übernehmen' : 'Anlegen'}
          </Button>
        </>
      }
    >
      <div className="wf-form-grid">
        <Field label="Name">
          <Input
            autoFocus
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="z. B. Seewind, Graue Stute, Ochsenkarren"
          />
        </Field>
        <Field label="Art" hint={MOUNT_KIND_HINT[draft.kind]}>
          <Select value={draft.kind} onChange={(e) => set({ kind: e.target.value as MountKind })}>
            {MOUNT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {MOUNT_KIND_LABEL[kind]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Gehört" hint="Leer: der Gruppe.">
          <EntityPicker
            value={draft.ownerId ?? PARTY_ID}
            onChange={(id) => set({ ownerId: id === PARTY_ID ? null : id })}
            kinds={['character', 'person', 'faction', 'family']}
            allowParty
            placeholder="Der Gruppe"
          />
        </Field>
        <Field label="Eintrag der Welt" hint="Wenn es einen Namen und einen Artikel hat.">
          <EntityPicker
            value={draft.entityId}
            onChange={(id) => set({ entityId: id })}
            kinds={['item', 'animal']}
            placeholder="Keiner"
            onCreate={createTwin}
          />
        </Field>
        <Field
          label="Reisetempo in Meilen"
          hint={
            draft.paceUnit === 'day'
              ? `Ein Reisetag hat ${TRAVEL_DAY_HOURS} Stunden. ${PACE_HINT[draft.kind]}`
              : PACE_HINT[draft.kind]
          }
        >
          <div className="wf-row">
            <Input
              className="wf-fort-number"
              value={draft.pace}
              inputMode="decimal"
              onChange={(e) => set({ pace: e.target.value })}
              placeholder="leer"
              aria-label="Reisetempo"
            />
            <Select
              value={draft.paceUnit}
              onChange={(e) => set({ paceUnit: e.target.value as 'hour' | 'day' })}
              aria-label="Meilen je Stunde oder am Tag"
            >
              <option value="hour">je Stunde</option>
              <option value="day">am Tag</option>
            </Select>
          </div>
        </Field>
        <Field label="Zustand" hint="Nur ein Hinweis beim Reisen – gebremst wird nichts.">
          <Select
            value={draft.condition}
            onChange={(e) => set({ condition: e.target.value as MountCondition })}
          >
            {MOUNT_CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {MOUNT_CONDITION_LABEL[condition]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="wf-span-2 wf-fort-numbers">
          <Field label="Plätze">
            <Input
              value={draft.passengers}
              inputMode="numeric"
              onChange={(e) => set({ passengers: e.target.value })}
            />
          </Field>
          {draft.kind === 'ship' ? (
            <Field label="Ladung">
              <Input
                value={draft.cargo}
                inputMode="decimal"
                placeholder="Tonnen"
                onChange={(e) => set({ cargo: e.target.value })}
              />
            </Field>
          ) : (
            <Field label="Traglast">
              <Input
                value={draft.capacity}
                inputMode="decimal"
                placeholder="Pfund"
                onChange={(e) => set({ capacity: e.target.value })}
              />
            </Field>
          )}
          <Field label="Besatzung">
            <Input
              value={draft.crew}
              inputMode="numeric"
              onChange={(e) => set({ crew: e.target.value })}
            />
          </Field>
          <Field label="Bewegung">
            <Input
              value={draft.speed}
              inputMode="numeric"
              placeholder="Fuß"
              onChange={(e) => set({ speed: e.target.value })}
            />
          </Field>
          <Field label="Unterhalt">
            <Input
              value={draft.upkeep}
              onChange={(e) => set({ upkeep: e.target.value })}
              placeholder="5 SM am Tag"
            />
          </Field>
        </div>
        <Field label="Kampfwerte" hint="Ein Wesen aus dem Bestiarium, wenn es kämpfen kann.">
          <Select
            value={draft.creatureId ?? ''}
            onChange={(e) => set({ creatureId: e.target.value || null })}
          >
            <option value="">{creatures.length ? 'Keine' : 'Das Bestiarium ist noch leer'}</option>
            {creatures.map((creature) => (
              <option key={creature.id} value={creature.id}>
                {creature.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="wf-col wf-fort-checks">
          <Checkbox checked={draft.flies} onChange={(flies) => set({ flies })}>
            Fliegt – Gelände und Wasser halten es nicht auf
          </Checkbox>
          {!riding && (
            <Checkbox checked={ride} onChange={setRide}>
              Die Gruppe reist ab jetzt damit
            </Checkbox>
          )}
        </div>
        <Field label="Besonderheiten" className="wf-span-2">
          <TextArea
            value={draft.notes}
            onChange={(e) => set({ notes: e.target.value })}
            style={{ minHeight: 60 }}
            placeholder="z. B. scheut vor Feuer, Leck am Bug"
          />
        </Field>
      </div>
    </Dialog>
  );
}
