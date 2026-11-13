/**
 * Tag, Monat, Jahr und Uhrzeit im Weltkalender – geteilt von „Festhalten“ (shell/dialogs.tsx),
 * dem Eintrag der Chronik (EntryDialog) und den Sessions. Bringt sein CSS selbst mit, damit es
 * auch außerhalb der Chronik richtig aussieht.
 */
import { primaryEra, type CalendarDef } from '../../domain/time/calendar';
import { Field, Input, Select } from '../../ui';
import type { TimeDraft } from './model';
import './chronik.css';

export function WorldTimeFields({
  cal,
  value,
  onChange,
  disabled,
}: {
  cal: CalendarDef;
  value: TimeDraft;
  onChange: (value: TimeDraft) => void;
  disabled?: boolean;
}) {
  const set = (change: Partial<TimeDraft>) => onChange({ ...value, ...change });
  return (
    <div className="wf-chronik-time">
      <Field label="Tag">
        <Input
          type="number"
          min={1}
          max={31}
          value={value.day}
          disabled={disabled}
          onChange={(e) => set({ day: e.target.value })}
        />
      </Field>
      <Field label="Monat">
        <Select
          value={value.month}
          disabled={disabled}
          onChange={(e) => set({ month: Number(e.target.value) })}
        >
          {cal.months.map((month, i) => (
            <option key={month.name} value={i}>
              {month.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`Jahr ${primaryEra(cal).label}`.trim()}>
        <Input
          type="number"
          value={value.year}
          disabled={disabled}
          onChange={(e) => set({ year: e.target.value })}
        />
      </Field>
      <Field label="Uhrzeit">
        <span className="wf-chronik-time__clock">
          <Input
            type="number"
            min={0}
            max={23}
            aria-label="Stunde"
            value={value.hour}
            disabled={disabled}
            onChange={(e) => set({ hour: e.target.value })}
          />
          <span className="wf-mute">:</span>
          <Input
            type="number"
            min={0}
            max={59}
            aria-label="Minute"
            value={value.minute}
            disabled={disabled}
            onChange={(e) => set({ minute: e.target.value })}
          />
        </span>
      </Field>
    </div>
  );
}
