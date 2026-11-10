/** Termin anlegen, bearbeiten, löschen. */
import { useMemo, useState, type KeyboardEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import {
  EVENT_KINDS,
  createEntity,
  createEvent,
  type CalendarEvent,
  type EntityKind,
} from '../../domain/schema';
import {
  formatDate,
  formatDayMonth,
  formatYear,
  fromTime,
  primaryEra,
  weekdayName,
  type WorldTime,
} from '../../domain/time/calendar';
import {
  Button,
  Checkbox,
  Dialog,
  EntityPicker,
  EntityRefsEditor,
  Field,
  Input,
  Select,
  TextArea,
  confirmDialog,
  cx,
} from '../../ui';
import {
  EVENT_KIND_HINT,
  EVENT_KIND_LABEL,
  blankEventForm,
  describeRepeat,
  eventToForm,
  nextOccurrences,
  parseEventForm,
  type EventForm,
  type RepeatChoice,
} from './model';

const PLACE_KINDS: EntityKind[] = ['place'];

const REPEAT_CHOICES: { id: RepeatChoice; label: string; unit: string }[] = [
  { id: 'none', label: 'Keine', unit: '' },
  { id: 'day', label: 'Nach Tagen', unit: 'Tage' },
  { id: 'week', label: 'Nach Wochen', unit: 'Wochen' },
  { id: 'month', label: 'Nach Monaten', unit: 'Monate' },
  { id: 'year', label: 'Nach Jahren', unit: 'Jahre' },
];

/** Speichert bei Eingabe in einem einzeiligen Feld und bei Strg+Eingabe überall. */
export function saveOnEnter(save: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    const singleLine =
      target instanceof HTMLInputElement &&
      target.type !== 'checkbox' &&
      !target.classList.contains('wf-picker__search');
    if (e.ctrlKey || e.metaKey || singleLine) {
      e.preventDefault();
      save();
    }
  };
}

export interface EventDialogProps {
  /** Termin, der bearbeitet wird; null = neuer Termin. */
  event: CalendarEvent | null;
  /** Tag für einen neuen Termin (Weltzeit). */
  day: WorldTime;
  onClose: () => void;
  /** Nach dem Speichern: der Zeitpunkt des Termins, damit die Seite dorthin springen kann. */
  onSaved: (at: WorldTime) => void;
}

export function EventDialog({ event, day, onClose, onSaved }: EventDialogProps) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const [form, setForm] = useState<EventForm>(() =>
    event ? eventToForm(cal, event) : blankEventForm(cal, day),
  );
  const [attempted, setAttempted] = useState(false);
  const set = (change: Partial<EventForm>) => setForm((f) => ({ ...f, ...change }));

  const parsed = useMemo(() => parseEventForm(cal, form), [cal, form]);
  // Für die Hinweise zum Datum zählt der Titel nicht.
  const dated = useMemo(
    () => parseEventForm(cal, { ...form, title: form.title.trim() || '–' }),
    [cal, form],
  );
  const upcoming = useMemo(() => {
    if (!dated.ok || !dated.value.repeat) return [];
    const draft = { ...createEvent({ title: '–', at: dated.value.at }), ...dated.value };
    return nextOccurrences(cal, draft, dated.value.at + 1, 3);
  }, [cal, dated]);

  const save = () => {
    setAttempted(true);
    if (!parsed.ok) return;
    const saved = db.put(
      'events',
      event ? { ...event, ...parsed.value } : createEvent(parsed.value),
    );
    onSaved(saved.at);
    onClose();
  };

  const remove = async () => {
    if (!event) return;
    const ok = await confirmDialog({
      title: 'Termin löschen?',
      body: (
        <>
          „{event.title}“ wird aus dem Kalender entfernt
          {event.repeat ? ' – mit allen Wiederholungen' : ''}. Was dazu bereits in der Chronik
          steht, bleibt erhalten.
        </>
      ),
      confirmLabel: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    db.remove('events', event.id);
    onClose();
  };

  const repeatUnit = REPEAT_CHOICES.find((c) => c.id === form.repeatUnit)!;
  const error = !parsed.ok && (attempted || form.title.trim()) ? parsed.error : '';
  const dateError = !dated.ok && /Datum|Uhrzeit/.test(dated.error) ? dated.error : '';
  const repeatError = !dated.ok && /Wiederholung/.test(dated.error) ? dated.error : '';

  return (
    <Dialog
      open
      onClose={onClose}
      title={event ? 'Termin bearbeiten' : 'Neuer Termin'}
      width={660}
      footer={
        <>
          {event && (
            <Button variant="danger" icon={<Trash2 />} onClick={remove}>
              Löschen
            </Button>
          )}
          {event && form.repeatUnit === 'none' && (
            <span style={{ marginLeft: 'var(--s-2)', alignSelf: 'center' }}>
              <Checkbox checked={form.done} onChange={(done) => set({ done })}>
                Erledigt
              </Checkbox>
            </span>
          )}
          <span className="wf-kal-form__error">
            {error && !dateError && !repeatError ? error : ''}
          </span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={save} disabled={!form.title.trim()}>
            {event ? 'Speichern' : 'Termin anlegen'}
          </Button>
        </>
      }
    >
      <div className="wf-kal-form" onKeyDown={saveOnEnter(save)}>
        <Field label="Titel">
          <Input
            data-autofocus
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Was geschieht oder steht an?"
          />
        </Field>

        <div className="wf-kal-form__date">
          <Field label="Tag">
            <Input
              inputMode="numeric"
              value={form.day}
              onChange={(e) => set({ day: e.target.value })}
              style={{ width: 64 }}
              aria-label="Tag"
            />
          </Field>
          <Field label="Monat" className="wf-grow">
            <Select
              value={form.month}
              onChange={(e) => set({ month: Number(e.target.value) })}
              aria-label="Monat"
            >
              {cal.months.map((m, i) => (
                <option key={i} value={i}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Jahr ${primaryEra(cal).label}`.trim()}>
            <Input
              inputMode="numeric"
              value={form.year}
              onChange={(e) => set({ year: e.target.value })}
              style={{ width: 88 }}
              aria-label="Jahr"
            />
          </Field>
          <Field label="Uhrzeit">
            <span className="wf-row" style={{ gap: 'var(--s-3)', height: 36 }}>
              <Checkbox checked={form.timed} onChange={(timed) => set({ timed })}>
                festgelegt
              </Checkbox>
              {form.timed && (
                <span className="wf-kal-form__clock">
                  <Input
                    inputMode="numeric"
                    value={form.hour}
                    onChange={(e) => set({ hour: e.target.value })}
                    aria-label="Stunde"
                  />
                  :
                  <Input
                    inputMode="numeric"
                    value={form.minute}
                    onChange={(e) => set({ minute: e.target.value })}
                    aria-label="Minute"
                  />
                </span>
              )}
            </span>
          </Field>
        </div>
        <div className={cx('wf-kal-form__note', dateError && 'wf-kal-form__note--error')}>
          {dateError ||
            (dated.ok &&
              [
                `${weekdayName(cal, dated.value.at)}, ${formatDate(cal, dated.value.at)}`,
                ...cal.eras
                  .slice(1)
                  .map((era) => formatYear(cal, fromTime(cal, dated.value.at).year, era)),
                form.timed ? '' : 'Uhrzeit offen',
              ]
                .filter(Boolean)
                .join(' · '))}
        </div>

        <Field label="Art">
          <div className="wf-kal-choice" role="radiogroup" aria-label="Art des Termins">
            {EVENT_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={form.kind === kind}
                className={`wf-kal-kind--${kind}`}
                onClick={() => set({ kind })}
              >
                <span className="wf-kal-choice__label">
                  <i className="wf-kal-gem" />
                  {EVENT_KIND_LABEL[kind]}
                </span>
                <span className="wf-kal-choice__hint">{EVENT_KIND_HINT[kind]}</span>
              </button>
            ))}
          </div>
        </Field>

        <div className="wf-kal-form__date">
          <Field label="Ort" className="wf-grow">
            <EntityPicker
              value={form.placeId}
              onChange={(placeId) => set({ placeId })}
              kinds={PLACE_KINDS}
              placeholder="Wo findet es statt?"
              onCreate={(name) => db.put('entities', createEntity({ kind: 'place', name })).id}
            />
          </Field>
          <Field label="Dauer in Tagen">
            <Input
              inputMode="numeric"
              value={form.durationDays}
              onChange={(e) => set({ durationDays: e.target.value })}
              placeholder="1"
              title="Leer lassen, wenn es an einem einzigen Tag geschieht."
              style={{ width: 124 }}
            />
          </Field>
        </div>
        <Field label="Beteiligte">
          <EntityRefsEditor
            value={form.refs}
            onChange={(refs) => set({ refs })}
            placeholder="Person, Fraktion, Gegenstand … verknüpfen"
          />
        </Field>
        <Field label="Wiederholung">
          <span className="wf-row" style={{ gap: 'var(--s-3)' }}>
            <Select
              value={form.repeatUnit}
              onChange={(e) => set({ repeatUnit: e.target.value as RepeatChoice })}
              style={{ width: 190 }}
              aria-label="Wiederholung"
            >
              {REPEAT_CHOICES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
            {form.repeatUnit !== 'none' && (
              <>
                <span className="wf-mute">alle</span>
                <Input
                  inputMode="numeric"
                  value={form.repeatEvery}
                  onChange={(e) => set({ repeatEvery: e.target.value })}
                  style={{ width: 64, textAlign: 'center' }}
                  aria-label="Abstand der Wiederholung"
                />
                <span className="wf-mute">{repeatUnit.unit}</span>
              </>
            )}
            <span
              className={cx(
                'wf-kal-form__aside wf-grow',
                repeatError && 'wf-kal-form__note--error',
              )}
            >
              {repeatError ||
                (dated.ok && dated.value.repeat
                  ? `${describeRepeat(dated.value.repeat)}${
                      upcoming.length
                        ? `, danach am ${upcoming.map((t) => formatDayMonth(cal, t)).join(', ')} …`
                        : ''
                    }`
                  : 'Der Termin findet einmal statt.')}
            </span>
          </span>
        </Field>
        <Field label="Einzelheiten">
          <TextArea
            value={form.details}
            onChange={(e) => set({ details: e.target.value })}
            placeholder="Was die Spielleitung dazu wissen muss. Strg+Eingabe speichert."
            style={{ minHeight: 64 }}
          />
        </Field>
      </div>
    </Dialog>
  );
}
