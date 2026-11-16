/**
 * „+ Beziehung“ und „+ Mitglied“ auf der Seite: ein schlanker Dialog. Mit wem, dann ein Satz von
 * diesem Ding aus („Silberhain · wird beherrscht von · Haus Baenre“) – was zum Paar passt, steht
 * zuerst (`relationChoices`), alles andere unter „Weitere“, dazu eine eigene Bezeichnung. Die
 * Haltung steht nur bei denen offen, die eine haben können (`holdsAttitude`); sonst zugeklappt.
 * Gespeichert wird über `relate` – rückwärts Gelesenes („beherrscht von“) in seiner Richtung.
 */
import { useState, type KeyboardEvent } from 'react';
import { useData, useDb } from '../../data/hooks';
import { attitudeModeChoice, type AttitudeMode } from '../../domain/attitudeSetting';
import { entityName, findRelation, wouldCreatePlaceCycle } from '../../domain/derive';
import {
  choiceById,
  attitudeOpen as attitudeBetween,
  holdsAttitude,
  relationChoices,
  type RelationChoice,
} from '../../domain/relations';
import { PARTY_ID, type Entity } from '../../domain/schema';
import {
  AttitudeBadge,
  AttitudeModePick,
  AttitudeScale,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Select,
  toast,
} from '../../ui';
import { patchDetails, relate } from './actions';
import { relationKind } from './model';
import { Picker } from './parts';

export function RelationQuick({
  self,
  asMember = false,
  onClose,
}: {
  self: Entity;
  /** Ein Mitglied eintragen: Personen und Gefährten zuerst, „hat als Mitglied“ als Vorgabe. */
  asMember?: boolean;
  onClose: () => void;
}) {
  const db = useDb();
  const data = useData();
  const [otherId, setOtherId] = useState<string | null>(null);
  const [choiceId, setChoiceId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [secret, setSecret] = useState(false);
  /** null = keine Haltung angefasst; sie bleibt dann, wie sie ist. */
  const [attitude, setAttitude] = useState<number | null | undefined>(undefined);
  const [attitudeOpen, setAttitudeOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pickedMode, setMode] = useState<AttitudeMode | null>(null);
  const [tried, setTried] = useState(false);

  const selfKind = relationKind(data, self.id);
  const otherKind = relationKind(data, otherId);
  const choices = otherId ? relationChoices(selfKind, otherKind) : null;
  const choice: RelationChoice = choiceId
    ? choiceById(choiceId)
    : (choices?.preset ?? choiceById('custom'));
  // Rückwärts gelesen („beherrscht von“) geht die Beziehung vom Gegenüber aus.
  const fromId = choice.reverse ? (otherId ?? '') : self.id;
  const toId = choice.reverse ? self.id : (otherId ?? '');
  // Die Gruppe ist nie Ausgangspunkt einer Beziehung.
  const backwardsFromParty = fromId === PARTY_ID;
  const existing = otherId && !backwardsFromParty ? findRelation(data, fromId, toId) : undefined;
  // Offen nur zwischen zweien, die eine Haltung haben können; sonst „Haltung trotzdem eintragen“.
  const fromHolds = attitudeBetween(relationKind(data, fromId), relationKind(data, toId));
  const current = existing?.attitude ?? null;
  const value = attitude === undefined ? current : attitude;
  const showScale = fromHolds || attitudeOpen || current !== null;
  const towardsParty = toId === PARTY_ID;
  const attitudeChanged = attitude !== undefined && attitude !== current;
  const modeChoice = towardsParty && otherId ? attitudeModeChoice(data, fromId, toId) : null;
  const mode: AttitudeMode = modeChoice?.givenPossible
    ? (pickedMode ?? modeChoice.preset)
    : 'change';
  const name = (id: string) => (id === PARTY_ID ? 'der Gruppe' : entityName(data, id));

  const problem = !otherId
    ? 'Wähle zuerst, mit wem.'
    : backwardsFromParty
      ? 'Von der Gruppe aus lässt sich keine Beziehung eintragen – wähle eine andere.'
      : choice.type === 'custom' && !label.trim()
        ? 'Die eigene Bezeichnung fehlt noch.'
        : null;

  const pickOther = (id: string | null) => {
    setOtherId(id);
    setChoiceId(null);
    setAttitude(undefined);
    setAttitudeOpen(false);
  };

  const save = () => {
    setTried(true);
    if (problem || !otherId) return;
    const result = relate(db, {
      from: fromId,
      to: toId,
      type: choice.type,
      label: choice.type === 'custom' ? label : '',
      ...(note.trim() ? { note } : {}),
      ...(secret ? { secret } : {}),
      // Nicht angefasst: Die Haltung bleibt, wie sie ist – und nichts kommt in die Chronik.
      ...(attitudeChanged ? { attitude, reason: mode === 'given' ? '' : reason, mode } : {}),
    });
    if (!result) return;
    toast({
      title: asMember ? 'Mitglied eingetragen' : 'Beziehung eingetragen',
      body: `${entityName(data, self.id)} ${choice.type === 'custom' ? label.trim() : choice.label} ${entityName(data, otherId)}`,
      action: { label: 'Rückgängig', run: result.undo },
    });
    onClose();
  };

  /** „Liegt in“ ist keine Beziehung, sondern der Ort darüber. */
  const parentPossible =
    choices?.inPlaceField &&
    otherId &&
    self.kind === 'place' &&
    self.place.parentId !== otherId &&
    !wouldCreatePlaceCycle(data, self.id, otherId);
  const setParent = () => {
    if (self.kind !== 'place' || !otherId) return;
    const before = self.place.parentId;
    patchDetails(db, self, { parentId: otherId });
    toast({
      title: `${self.name} liegt jetzt in ${entityName(data, otherId)}`,
      action: { label: 'Rückgängig', run: () => patchDetails(db, self, { parentId: before }) },
    });
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    const plainInput = target.tagName === 'INPUT' && target.closest('.wf-picker') === null;
    if (e.ctrlKey || e.metaKey || plainInput) {
      e.preventDefault();
      save();
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={asMember ? 'Mitglied eintragen' : 'Beziehung eintragen'}
      width={540}
      footer={
        <>
          <span className="wf-grow wf-welt-form__status" role="status">
            {tried && problem ? <span className="wf-welt-form__problem">{problem}</span> : null}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!otherId}>
            Eintragen
          </Button>
        </>
      }
    >
      <div className="wf-col wf-welt-form" onKeyDown={onKeyDown}>
        <Field label={asMember ? 'Wer gehört dazu?' : `Mit wem ist ${self.name} verbunden?`}>
          <Picker
            value={otherId}
            onChange={pickOther}
            // Die Gruppe steht oben nur bei denen, die eine Haltung haben können; sonst findet man
            // sie, wenn man nach ihr sucht.
            allowParty={asMember ? false : holdsAttitude(selfKind) ? true : 'named'}
            kinds={asMember ? ['person', 'character'] : undefined}
            exclude={[self.id]}
            create={{}}
            autoFocus
            openOnMount
            placeholder={asMember ? 'Person oder Gefährte …' : 'Name suchen oder neu anlegen …'}
          />
        </Field>

        {otherId && choices && (
          <>
            <div className="wf-welt-quickrel">
              <span className="wf-welt-quickrel__name wf-clamp-2">{self.name}</span>
              <Select
                aria-label="Art der Beziehung"
                value={choice.id}
                onChange={(e) => setChoiceId(e.target.value)}
              >
                {choices.fitting.length > 0 && (
                  <optgroup label="Passend">
                    {choices.fitting.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Weitere">
                  {choices.more.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                  <option value="custom">Eigene Bezeichnung …</option>
                </optgroup>
              </Select>
              <span className="wf-welt-quickrel__name wf-clamp-2">
                {otherId === PARTY_ID ? 'Die Gruppe' : entityName(data, otherId)}
              </span>
            </div>
            {choice.type === 'custom' && (
              <Field
                label="Eigene Bezeichnung"
                hint={`Als Satzteil von ${self.name} aus, z. B. „erpresst“ oder „liefert Salz an“.`}
              >
                <Input
                  value={label}
                  autoFocus
                  onChange={(e) => setLabel(e.target.value)}
                  aria-invalid={tried && !label.trim()}
                />
              </Field>
            )}
            {choices.inPlaceField && (
              <p className="wf-welt-form__kindhint">
                Liegt der eine Ort im anderen, ist das keine Beziehung, sondern „Liegt in“ – der Ort
                darüber (im Steckbrief oder über den Stift oben).{' '}
                {parentPossible && (
                  <button type="button" className="wf-welt-linkish" onClick={setParent}>
                    {self.name} liegt in {entityName(data, otherId)}
                  </button>
                )}
              </p>
            )}
            {existing && (
              <p className="wf-welt-form__kindhint">
                {entityName(data, fromId)} und {name(toId)} sind schon verbunden – die Beziehung
                bekommt die neue Art.
              </p>
            )}

            {!backwardsFromParty &&
              (showScale ? (
                <Field
                  label={`Haltung von ${entityName(data, fromId)} zu ${name(toId)}`}
                  hint={
                    fromHolds
                      ? 'Freiwillig – leer lassen, wenn sie nichts zur Sache tut.'
                      : undefined
                  }
                >
                  <div className="wf-row" style={{ gap: 'var(--s-4)' }}>
                    <AttitudeScale value={value} onChange={(next) => setAttitude(next)} />
                    <AttitudeBadge value={value} />
                  </div>
                </Field>
              ) : (
                <button
                  type="button"
                  className="wf-welt-linkish"
                  onClick={() => setAttitudeOpen(true)}
                >
                  Haltung trotzdem eintragen
                </button>
              ))}
            {towardsParty && attitudeChanged && modeChoice?.givenPossible && (
              <AttitudeModePick value={mode} onChange={setMode} givenPossible />
            )}
            {towardsParty && attitudeChanged && mode === 'change' && (
              <Field
                label="Grund der Änderung"
                hint="Steht mit Datum im Verlauf der Haltung und in der Chronik."
              >
                <Input value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            )}
            <Field label="Notiz">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Checkbox checked={secret} onChange={setSecret}>
              Geheim – die Gruppe weiß nichts davon
            </Checkbox>
          </>
        )}
      </div>
    </Dialog>
  );
}
