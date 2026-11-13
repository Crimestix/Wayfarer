/** Eine Fortschrittsleiste anlegen oder ändern. */
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useDb } from '../../data/hooks';
import { TRACK_KINDS, type Track, type TrackKind } from '../../domain/schema';
import { amountText, parseStages, readAmount, stageIndex } from '../../domain/track';
import { Button, Dialog, EntityPicker, Field, Input, Select, TextArea, toast } from '../../ui';
import { removeTrack, saveTrack } from './actions';

const KIND_LABEL: Record<TrackKind, string> = {
  stages: 'Benannte Stufen',
  count: 'Eine Zahl bis zu einem Ziel',
  steps: 'Abschnitte',
};
const KIND_HINT: Record<TrackKind, string> = {
  stages: 'Ein Ausbildungsweg, ein Rang: Schwarz → Dunkelgrün → … → Gold.',
  count: 'Schulden, Ruf, gesammelte Stücke: 12.000 von 50.000 Gold.',
  steps: 'Eine Studie, eine Reparatur, ein Ritual: 3 von 6 Abschnitten.',
};

export function TrackDialog({
  track,
  ownerId,
  onClose,
}: {
  track?: Track;
  /** Für eine neue Leiste: wem sie gehört. */
  ownerId?: string | null;
  onClose: () => void;
}) {
  const db = useDb();
  const [name, setName] = useState(track?.name ?? '');
  const [owner, setOwner] = useState<string | null>(track?.ownerId ?? ownerId ?? null);
  const [kind, setKind] = useState<TrackKind>(track?.kind ?? 'stages');
  const [stages, setStages] = useState((track?.stages ?? []).join('\n'));
  const [target, setTarget] = useState(track ? amountText(track.target) : '');
  const [step, setStep] = useState(amountText(track?.step ?? 1));
  const [unit, setUnit] = useState(track?.unit ?? '');
  const [segments, setSegments] = useState(String(track?.segments ?? 4));
  const [value, setValue] = useState(amountText(track?.value ?? 0));
  const [note, setNote] = useState(track?.note ?? '');
  const stageList = parseStages(stages);

  const save = () => {
    const saved = saveTrack(
      db,
      {
        name,
        ownerId: owner,
        kind,
        stages: stageList,
        target: readAmount(target),
        step: readAmount(step) || 1,
        unit,
        segments: Math.round(readAmount(segments)) || 4,
        value: kind === 'stages' ? stageIndex(stageList, value) : readAmount(value),
        note,
      },
      track?.id,
    );
    if (saved) onClose();
  };
  const remove = () => {
    if (!track) return;
    const undo = removeTrack(db, track.id);
    onClose();
    if (undo)
      toast({
        title: 'Leiste gelöscht',
        body: 'Ihre Schritte bleiben in der Chronik.',
        action: { label: 'Rückgängig', run: undo },
      });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={track ? 'Fortschrittsleiste ändern' : 'Neue Fortschrittsleiste'}
      width={560}
      footer={
        <>
          {track && (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={remove}
              style={{ marginRight: 'auto' }}
            >
              Löschen
            </Button>
          )}
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!name.trim()} onClick={save}>
            {track ? 'Speichern' : 'Anlegen'}
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-4)' }}>
        <div className="wf-form-grid">
          <Field label="Name">
            <Input
              autoFocus
              value={name}
              placeholder="Weg zur Dunkelrobe"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field label="Gehört zu" hint="Ein Gefährte, eine Fraktion, ein Ort – oder die Gruppe.">
            <EntityPicker value={owner} onChange={setOwner} allowParty placeholder="Wählen …" />
          </Field>
        </div>
        <Field label="Art" hint={KIND_HINT[kind]}>
          <Select
            value={kind}
            aria-label="Art der Leiste"
            onChange={(event) => setKind(event.target.value as TrackKind)}
          >
            {TRACK_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        {kind === 'stages' && (
          <div className="wf-form-grid">
            <Field label="Stufen" hint="Eine je Zeile – oder mit Pfeilen oder Kommas getrennt.">
              <TextArea
                rows={5}
                value={stages}
                placeholder={'Schwarz\nDunkelgrün\nBlau\nRot\nPurpur\nGold'}
                onChange={(event) => setStages(event.target.value)}
              />
            </Field>
            <Field label="Erreicht">
              <Select
                value={stageList[stageIndex(stageList, value)] ?? ''}
                aria-label="Erreichte Stufe"
                onChange={(event) => setValue(event.target.value)}
              >
                {stageList.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        {kind === 'count' && (
          <div className="wf-form-grid">
            <Field label="Ziel" hint="Leer lassen, wenn es kein Ende gibt.">
              <Input
                inputMode="decimal"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              />
            </Field>
            <Field label="Einheit">
              <Input
                value={unit}
                placeholder="Gold"
                onChange={(event) => setUnit(event.target.value)}
              />
            </Field>
            <Field label="Erreicht">
              <Input
                inputMode="decimal"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </Field>
            <Field label="Schrittweite" hint="So viel ändert ein Klick auf + oder −.">
              <Input
                inputMode="decimal"
                value={step}
                onChange={(event) => setStep(event.target.value)}
              />
            </Field>
          </div>
        )}
        {kind === 'steps' && (
          <div className="wf-form-grid">
            <Field label="Abschnitte">
              <Input
                inputMode="numeric"
                value={segments}
                onChange={(event) => setSegments(event.target.value)}
              />
            </Field>
            <Field label="Gefüllt">
              <Input
                inputMode="numeric"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </Field>
          </div>
        )}
        <Field label="Notiz" hint="Was ein Schritt kostet, wer ihn gibt, was am Ende wartet.">
          <TextArea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
