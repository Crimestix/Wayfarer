/** Dauer eines Weges wählen: schnelle Knöpfe für das Übliche, ein Feld für alles andere. */
import { formatWayTime } from '../../domain/ways';
import { Input, cx } from '../../ui';
import './wege.css';

/** Übliche Dauern: Gassen und Viertel in Minuten, Gänge und Straßen in Stunden und Tagen. */
const QUICK = [5, 10, 30, 60, 240, 1440];

export function DurationField({
  value,
  onChange,
  allowNone = true,
}: {
  /** Minuten; 0 = keine Zeit. */
  value: number;
  onChange: (minutes: number) => void;
  /** „Keine Zeit“ anbieten (beim Ortswechsel) – ein Weg selbst braucht immer eine Dauer. */
  allowNone?: boolean;
}) {
  return (
    <div className="wf-wege-duration">
      <div className="wf-wege-duration__quick" role="group" aria-label="Übliche Dauern">
        {allowNone && (
          <button
            type="button"
            className={cx('wf-wege-pill', value === 0 && 'wf-wege-pill--on')}
            aria-pressed={value === 0}
            onClick={() => onChange(0)}
          >
            Keine Zeit
          </button>
        )}
        {QUICK.map((minutes) => (
          <button
            key={minutes}
            type="button"
            className={cx('wf-wege-pill', value === minutes && 'wf-wege-pill--on')}
            aria-pressed={value === minutes}
            onClick={() => onChange(minutes)}
          >
            {formatWayTime(minutes)}
          </button>
        ))}
      </div>
      <label className="wf-wege-duration__exact">
        <Input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={value === 0 ? '' : String(value)}
          placeholder="0"
          aria-label="Dauer in Minuten"
          onChange={(e) => onChange(Math.max(0, Math.round(Number(e.target.value) || 0)))}
        />
        <span>Minuten{value >= 60 ? ` · ${formatWayTime(value)}` : ''}</span>
      </label>
    </div>
  );
}
