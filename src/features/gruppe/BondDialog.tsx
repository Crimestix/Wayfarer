/** Dialog „Beziehung zu einem Gefährten“: wer wie zu ihm steht. */
import { useId, useState, type KeyboardEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entityName, findRelation } from '../../domain/derive';
import { RELATION_TYPES, relationLabel } from '../../domain/relations';
import { createEntity, type Character } from '../../domain/schema';
import {
  AttitudeBadge,
  AttitudeScale,
  Button,
  Checkbox,
  Dialog,
  EntityPicker,
  Field,
  Input,
  Select,
  confirmDialog,
} from '../../ui';
import { removeBond, saveBond } from './actions';

const GROUPS = [...new Set(RELATION_TYPES.map((t) => t.group))];

export function BondDialog({
  character,
  fromId: initialFromId,
  onClose,
}: {
  character: Character;
  /** Gegenüber, dessen Beziehung bearbeitet wird; null = neue Beziehung. */
  fromId: string | null;
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const formId = useId();
  const initial = initialFromId ? findRelation(data, initialFromId, character.id) : undefined;
  const [fromId, setFromId] = useState<string | null>(initialFromId);
  const [type, setType] = useState(initial?.type ?? 'knows');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [attitude, setAttitude] = useState<number | null>(initial?.attitude ?? null);
  const [note, setNote] = useState(initial?.note ?? '');
  const [secret, setSecret] = useState(initial?.secret ?? false);
  const [ended, setEnded] = useState(initial?.ended ?? false);

  const existing = fromId ? findRelation(data, fromId, character.id) : undefined;
  const editing = initialFromId !== null && initial !== undefined;

  // Wird ein Gegenüber gewählt, zu dem es schon eine Beziehung gibt, zeigt der Dialog deren Stand.
  const pick = (id: string | null) => {
    setFromId(id);
    const found = id ? findRelation(data, id, character.id) : undefined;
    if (!found) return;
    setType(found.type);
    setLabel(found.label);
    setAttitude(found.attitude);
    setNote(found.note);
    setSecret(found.secret);
    setEnded(found.ended);
  };

  const ok = fromId !== null && (type !== 'custom' || label.trim() !== '');
  const save = () => {
    if (!ok || !fromId) return;
    saveBond(db, { fromId, characterId: character.id, type, label, attitude, note, secret, ended });
    onClose();
  };
  const remove = async () => {
    if (!existing) return;
    const confirmed = await confirmDialog({
      title: 'Beziehung entfernen?',
      body: `Die Beziehung von ${entityName(data, existing.from)} zu ${character.name} wird gelöscht. Frühere Haltungsänderungen bleiben in der Chronik stehen.`,
      confirmLabel: 'Entfernen',
      danger: true,
    });
    if (!confirmed) return;
    removeBond(db, existing.id);
    onClose();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={editing ? 'Beziehung bearbeiten' : `Wer steht wie zu ${character.name}?`}
      width={560}
      footer={
        <>
          {existing && (
            <Button variant="danger" icon={<Trash2 />} onClick={remove}>
              Entfernen
            </Button>
          )}
          <span className="wf-grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!ok}>
            {existing ? 'Speichern' : 'Anlegen'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="wf-col"
        style={{ gap: 'var(--s-4)' }}
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field
          label="Wer"
          hint={
            !editing && existing
              ? 'Zu diesem Eintrag gibt es schon eine Beziehung – du bearbeitest sie.'
              : undefined
          }
        >
          {editing ? (
            <div className="wf-display wf-gruppe-bond__who">{entityName(data, fromId)}</div>
          ) : (
            <EntityPicker
              value={fromId}
              onChange={pick}
              kinds={['person', 'faction']}
              exclude={[character.id]}
              autoFocus
              placeholder="Person oder Fraktion wählen oder neu anlegen …"
              onCreate={(name) => db.put('entities', createEntity({ kind: 'person', name })).id}
            />
          )}
        </Field>
        <div className="wf-form-grid">
          <Field label="Art der Beziehung">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {RELATION_TYPES.filter((t) => t.group === group).map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          {type === 'custom' ? (
            <Field label="Eigene Bezeichnung">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="z. B. bewundert"
              />
            </Field>
          ) : (
            <div className="wf-gruppe-bond__sentence">
              {fromId ? entityName(data, fromId) : '…'}{' '}
              <em>{relationLabel({ type, label }, 'from')}</em> {character.name}
            </div>
          )}
        </div>
        <Field
          label={`Haltung gegenüber ${character.name}`}
          hint={
            (existing?.attitude ?? null) !== attitude
              ? 'Die Änderung steht mit Datum in der Chronik.'
              : 'Ein Klick auf die gewählte Stufe setzt sie auf „unbekannt“ zurück.'
          }
        >
          <div className="wf-row" style={{ gap: 'var(--s-4)' }}>
            <AttitudeScale value={attitude} onChange={setAttitude} />
            <AttitudeBadge value={attitude} />
          </div>
        </Field>
        <Field label="Anmerkung">
          <Input
            data-autofocus={editing ? true : undefined}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Woher sie sich kennen, was zwischen ihnen steht"
          />
        </Field>
        <div className="wf-row-wrap" style={{ gap: 'var(--s-5)' }}>
          <Checkbox checked={secret} onChange={setSecret}>
            Die Gruppe weiß nichts davon
          </Checkbox>
          {existing && (
            <Checkbox checked={ended} onChange={setEnded}>
              Besteht nicht mehr
            </Checkbox>
          )}
        </div>
      </form>
    </Dialog>
  );
}
