/**
 * Kleine Eingaben der Läden: ein Preis in Münzen, eine Einheit und eine Menge – alle schreiben
 * beim Verlassen.
 */
import { useState } from 'react';
import { parseCoins } from '../../domain/priceList';
import { UNIT_SUGGESTIONS, formatPrice, readUnit } from '../../domain/shop';
import { Input } from '../../ui';

/** Die Einheiten zur Auswahl – einmal je Ansicht, die Einheiten anbietet. */
export const UNIT_LIST_ID = 'wf-laden-units';
export function UnitList() {
  return (
    <datalist id={UNIT_LIST_ID}>
      {UNIT_SUGGESTIONS.map((unit) => (
        <option key={unit} value={unit} />
      ))}
    </datalist>
  );
}

/** Eine Einheit zum Ändern: „Pfund“ wird „je Pfund“; leer = je Stück. */
export function UnitInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (unit: string) => void;
  label: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const read = readUnit(text);
    if (read !== value) onChange(read);
    setText(null);
  };
  return (
    <Input
      value={text ?? value}
      list={UNIT_LIST_ID}
      aria-label={label}
      placeholder="je Stück"
      title="Wofür der Preis gilt – „je Pfund“, „je Sack“; leer: je Stück"
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** Ein Preis zum Ändern: liest „5 SM“, „1,5“, „2 GM 5 SM“; leer = kein Preis (null). */
export function PriceInput({
  value,
  onChange,
  label,
  placeholder = 'Preis',
}: {
  value: number | null;
  onChange: (price: number | null) => void;
  label: string;
  placeholder?: string;
}) {
  const shown = value === null ? '' : formatPrice(value);
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const read = parseCoins(text);
    if (read !== undefined && read !== value) onChange(read);
    setText(null);
  };
  const bad = text !== null && text.trim() !== '' && parseCoins(text) === undefined;
  return (
    <Input
      className="wf-laden-price"
      value={text ?? shown}
      aria-label={label}
      aria-invalid={bad || undefined}
      placeholder={placeholder}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** Eine Menge zum Ändern: eine ganze Zahl; leer = so viele man will (null). */
export function QtyInput({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (qty: number | null) => void;
  label: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const trimmed = text.trim();
    const read = trimmed === '' ? null : /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
    if (read !== undefined && read !== value) onChange(read);
    setText(null);
  };
  return (
    <Input
      value={text ?? (value === null ? '' : String(value))}
      inputMode="numeric"
      aria-label={label}
      placeholder="∞"
      title="Wie viele da sind – leer: so viele man will"
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
