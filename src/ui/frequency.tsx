/**
 * Häufigkeit einer Tabellenzeile als Wort (häufig, gelegentlich, selten) – Wayfarer rechnet das
 * Gewicht (`domain/roaming.ts`). Für alle Tabellen gleich: Würfeltabellen der Erzeuger und
 * Begegnungen der Gegenden.
 */
import { FREQUENCIES, frequencyOf, weightOfFrequency } from '../domain/roaming';
import type { Frequency } from '../domain/roaming';
import { Select } from './components';

export function FrequencySelect({
  weight,
  onChange,
  label,
}: {
  weight: number;
  onChange: (weight: number) => void;
  label: string;
}) {
  const key = frequencyOf(weight);
  return (
    <Select
      value={key}
      aria-label={label}
      onChange={(event) => {
        const next = weightOfFrequency(event.target.value as Frequency);
        if (next !== weight) onChange(next);
      }}
    >
      {FREQUENCIES.map((entry) => (
        <option key={entry.key} value={entry.key}>
          {entry.label}
        </option>
      ))}
    </Select>
  );
}
