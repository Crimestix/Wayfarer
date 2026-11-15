/**
 * „Zauber“ am Tisch: wer wirkt was, wie lange, mit Konzentration. Geöffnet aus der Mitschrift
 * („/zauber …“) oder über `openSpell`. Läuft danach rechts unter „Sonst noch“ mit der Zeit, die
 * ihm bleibt.
 */
import { useMemo, useState } from 'react';
import { useData, useDb } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import { closeShellRequest, type SpellRequest } from '../../shell/commands';
import { Button, Checkbox, Dialog, EntityPicker, Field, Input, toast } from '../../ui';
import { castSpell } from './commands';
import { SPELL_DURATIONS, casterFromRefs, concentrationOf, spellLabelFrom } from './spells';

export function SpellDialog({ request }: { request: SpellRequest }) {
  const db = useDb();
  const data = useData();
  const refs = request.refs ?? [];
  const [casterId, setCasterId] = useState<string | null>(() => casterFromRefs(data, refs));
  const [label, setLabel] = useState(() =>
    spellLabelFrom(request.text ?? '', casterId ? (data.entities[casterId]?.name ?? null) : null),
  );
  const [minutes, setMinutes] = useState<number>(60);
  const [custom, setCustom] = useState('');
  const [concentration, setConcentration] = useState(false);
  const own = custom.trim() ? Number(custom.replace(',', '.')) : null;
  const duration = own !== null ? (Number.isFinite(own) && own > 0 ? own : null) : minutes;
  const held = useMemo(() => concentrationOf(data, casterId), [data, casterId]);
  const ok = label.trim() !== '' && duration !== null;

  const save = () => {
    if (!ok || duration === null) return;
    const others = refs.filter((id) => id !== casterId);
    const result = castSpell(db, {
      casterId,
      label,
      minutes: duration,
      concentration,
      refs: others,
    });
    request.onSaved?.();
    closeShellRequest();
    toast({
      title: 'Zauber gewirkt',
      body: [
        casterId ? `${entityName(data, casterId)}: ${result.timer.label}` : result.timer.label,
        ...result.ended.map((timer) => `${timer.label} endet – keine Konzentration mehr.`),
      ].join(' '),
      action: { label: 'Rückgängig', run: result.undo },
    });
  };

  return (
    <Dialog
      open
      onClose={closeShellRequest}
      title="Zauber"
      width={540}
      footer={
        <>
          <span className="wf-grow" />
          <Button onClick={closeShellRequest}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!ok} title="Strg+Eingabe">
            Wirken
          </Button>
        </>
      }
    >
      <div
        className="wf-col"
        style={{ gap: 'var(--s-4)' }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          }
        }}
      >
        <Field label="Wer zaubert?">
          <EntityPicker
            value={casterId}
            onChange={setCasterId}
            kinds={['character', 'person']}
            placeholder="Gefährte oder Person …"
          />
        </Field>
        <Field label="Zauber">
          <Input
            data-autofocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Wie heißt der Zauber?"
          />
        </Field>
        <Field label="Dauer" hint="Die Zeit läuft, wenn die Weltzeit vorgestellt wird.">
          <div className="wf-row-wrap" style={{ gap: 'var(--s-2)', alignItems: 'center' }}>
            <div className="wf-btn-group" role="group" aria-label="Dauer">
              {SPELL_DURATIONS.map((option) => (
                <Button
                  key={option.minutes}
                  size="sm"
                  aria-pressed={!custom.trim() && minutes === option.minutes}
                  onClick={() => {
                    setMinutes(option.minutes);
                    setCustom('');
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <Input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="eigene, Minuten"
              aria-label="Eigene Dauer in Minuten"
              style={{ width: 130 }}
            />
          </div>
        </Field>
        <div className="wf-col" style={{ gap: 'var(--s-1)' }}>
          <Checkbox checked={concentration} onChange={setConcentration}>
            Braucht Konzentration
          </Checkbox>
          {concentration && held.length > 0 && (
            <div className="wf-mute" style={{ fontSize: 'var(--text-sm)' }}>
              {entityName(data, casterId!)} hält schon {held.map((t) => t.label).join(', ')} – das
              endet mit diesem Zauber.
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
