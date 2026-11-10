/** Neue Wirkung oder Tätigkeit, die eine Weile andauert. */
import { useState } from 'react';
import { Hammer, Sparkles } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { createTimer, type Timer } from '../../domain/schema';
import { dayIndexOf, formatClock, formatDateTime } from '../../domain/time/calendar';
import { Button, Dialog, EntityRefsEditor, Field, Input } from '../../ui';
import { saveOnEnter } from './EventDialog';
import { TIMER_KIND_LABEL, parseDuration } from './model';

const KIND_HINT: Record<Timer['kind'], string> = {
  effect: 'Hält an, bis die Zeit um ist – ein Zauber, eine Fackel, ein Gift.',
  task: 'Ist fertig, wenn die Zeit um ist – eine Reparatur, ein Ritual, eine Wache.',
};

const PRESETS: { label: string; days: string; hours: string; minutes: string }[] = [
  { label: '1 Min.', days: '', hours: '', minutes: '1' },
  { label: '10 Min.', days: '', hours: '', minutes: '10' },
  { label: '1 Std.', days: '', hours: '1', minutes: '' },
  { label: '8 Std.', days: '', hours: '8', minutes: '' },
  { label: '24 Std.', days: '1', hours: '', minutes: '' },
  { label: '7 Tage', days: '7', hours: '', minutes: '' },
];

export function TimerDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<Timer['kind']>('effect');
  const [days, setDays] = useState('');
  const [hours, setHours] = useState('1');
  const [minutes, setMinutes] = useState('');
  const [refs, setRefs] = useState<string[]>([]);

  const duration = parseDuration(days, hours, minutes);
  const ok = label.trim() !== '' && duration !== null;
  const save = () => {
    if (!ok || duration === null) return;
    db.put(
      'timers',
      createTimer({ label: label.trim(), kind, start: now, end: now + duration, refs }),
    );
    onClose();
  };
  const end = duration === null ? null : now + duration;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Wirkung oder Tätigkeit"
      width={560}
      footer={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!ok}>
            Beginnen
          </Button>
        </>
      }
    >
      <div className="wf-kal-form" onKeyDown={saveOnEnter(save)}>
        <Field label="Bezeichnung">
          <Input
            data-autofocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="z. B. Fackel, Schutzkreis, Rüstung flicken"
          />
        </Field>
        <Field label="Art">
          <div className="wf-kal-choice" role="radiogroup" aria-label="Art">
            {(['effect', 'task'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
              >
                <span className="wf-kal-choice__label">
                  {k === 'effect' ? (
                    <Sparkles width={15} height={15} />
                  ) : (
                    <Hammer width={15} height={15} />
                  )}
                  {TIMER_KIND_LABEL[k]}
                </span>
                <span className="wf-kal-choice__hint">{KIND_HINT[k]}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field
          label="Dauer"
          hint={
            end === null
              ? 'Gib eine Dauer in ganzen Tagen, Stunden oder Minuten an.'
              : dayIndexOf(end) === dayIndexOf(now)
                ? `Endet heute um ${formatClock(end)}.`
                : `Endet am ${formatDateTime(cal, end)}.`
          }
        >
          <div className="wf-col" style={{ gap: 'var(--s-2)' }}>
            <div className="wf-kal-presets">
              {PRESETS.map((p) => (
                <Button
                  key={p.label}
                  size="sm"
                  onClick={() => {
                    setDays(p.days);
                    setHours(p.hours);
                    setMinutes(p.minutes);
                  }}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="wf-row" style={{ gap: 'var(--s-2)' }}>
              <Input
                inputMode="numeric"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                style={{ width: 64, textAlign: 'center' }}
                aria-label="Tage"
                placeholder="0"
              />
              <span className="wf-mute">Tage</span>
              <Input
                inputMode="numeric"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                style={{ width: 64, textAlign: 'center', marginLeft: 8 }}
                aria-label="Stunden"
                placeholder="0"
              />
              <span className="wf-mute">Stunden</span>
              <Input
                inputMode="numeric"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                style={{ width: 64, textAlign: 'center', marginLeft: 8 }}
                aria-label="Minuten"
                placeholder="0"
              />
              <span className="wf-mute">Minuten</span>
            </div>
          </div>
        </Field>
        <Field label="Betrifft">
          <EntityRefsEditor
            value={refs}
            onChange={setRefs}
            placeholder="Gefährte, Person, Ort … verknüpfen"
          />
        </Field>
      </div>
    </Dialog>
  );
}
