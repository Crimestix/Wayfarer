/** Wirkung oder Tätigkeit, die eine Weile andauert: beginnen oder nachträglich ändern. */
import { useState } from 'react';
import { Hammer, Sparkles, Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { createTimer, type Timer } from '../../domain/schema';
import { dayIndexOf, formatClock, formatDateTime } from '../../domain/time/calendar';
import { Button, Dialog, EntityRefsEditor, Field, Input, confirmDialog } from '../../ui';
import { saveOnEnter } from './EventDialog';
import { TIMER_KIND_LABEL, parseDuration, splitDuration } from './model';

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

export interface TimerDialogProps {
  /** Laufende Wirkung oder Tätigkeit, die geändert wird; null = neu beginnen. */
  timer: Timer | null;
  onClose: () => void;
}

export function TimerDialog({ timer, onClose }: TimerDialogProps) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  // Beim Ändern steht in den Feldern, wie lange es von jetzt an noch dauert.
  const [initial] = useState(() =>
    timer ? splitDuration(timer.end - now) : { days: '', hours: '1', minutes: '' },
  );
  const [label, setLabel] = useState(timer?.label ?? '');
  const [kind, setKind] = useState<Timer['kind']>(timer?.kind ?? 'effect');
  const [days, setDays] = useState(initial.days);
  const [hours, setHours] = useState(initial.hours);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [refs, setRefs] = useState<string[]>(timer?.refs ?? []);

  const duration = parseDuration(days, hours, minutes);
  const ok = label.trim() !== '' && duration !== null;
  const save = () => {
    if (!ok || duration === null) return;
    if (timer) {
      // Nur ändern, was noch da ist – ein anderes Gerät könnte sie inzwischen entfernt haben.
      if (db.getSnapshot().timers[timer.id])
        db.patch('timers', timer.id, { label: label.trim(), kind, end: now + duration, refs });
    } else {
      db.put(
        'timers',
        createTimer({ label: label.trim(), kind, start: now, end: now + duration, refs }),
      );
    }
    onClose();
  };
  const remove = async () => {
    if (!timer) return;
    const ok = await confirmDialog({
      title: `${TIMER_KIND_LABEL[timer.kind]} löschen?`,
      body: (
        <>
          „{timer.label}“ wird ganz entfernt, als hätte es sie nie gegeben. Soll sie nur aufhören,
          beende sie stattdessen vorzeitig.
        </>
      ),
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    if (db.getSnapshot().timers[timer.id]) db.remove('timers', timer.id);
    onClose();
  };
  const end = duration === null ? null : now + duration;

  return (
    <Dialog
      open
      onClose={onClose}
      title={timer ? `${TIMER_KIND_LABEL[timer.kind]} ändern` : 'Wirkung oder Tätigkeit'}
      width={560}
      footer={
        <>
          {timer && (
            <Button variant="danger" icon={<Trash2 />} onClick={remove}>
              Löschen
            </Button>
          )}
          <span className="wf-grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!ok}>
            {timer ? 'Speichern' : 'Beginnen'}
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
          label={timer ? 'Dauert von jetzt an noch' : 'Dauer'}
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
