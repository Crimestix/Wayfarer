/**
 * Eine Gefahr unterwegs eintragen – am Weg (Fenster „Weg“) oder am Feld der Hexkarte: Art, SG,
 * wie tief man stürzt, eigene Worte. Leer = keine Gefahr. Die Reise hält dort mit SG und Folge
 * (`hazardLine`); geprobt wird am Tisch.
 */
import { HAZARD_KINDS, type Hazard, type HazardKind } from '../../domain/schema';
import { HAZARD_CHECK, HAZARD_LABEL, fallDice, hazardLine } from '../../domain/travelRules';
import { Input, Select } from '../../ui';

const NONE = '';

export function HazardFields({
  value,
  onChange,
}: {
  value: Hazard | null;
  onChange: (next: Hazard | null) => void;
}) {
  const set = (change: Partial<Hazard>) =>
    onChange({ kind: 'other', dc: null, fallFeet: null, text: '', ...value, ...change });
  const number = (text: string, max: number): number | null => {
    const n = Number.parseInt(text, 10);
    return text.trim() && Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : null;
  };
  return (
    <div className="wf-reise-hazard">
      <Select
        value={value?.kind ?? NONE}
        aria-label="Gefahr"
        onChange={(e) =>
          e.target.value === NONE ? onChange(null) : set({ kind: e.target.value as HazardKind })
        }
      >
        <option value={NONE}>keine Gefahr</option>
        {HAZARD_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {HAZARD_LABEL[kind]}
          </option>
        ))}
      </Select>
      {value && (
        <>
          <Input
            key={`dc-${value.dc}`}
            defaultValue={value.dc === null ? '' : String(value.dc)}
            inputMode="numeric"
            aria-label="Schwierigkeitsgrad"
            placeholder="SG"
            title={`${HAZARD_CHECK[value.kind]} – der Schwierigkeitsgrad der Probe`}
            onBlur={(e) => set({ dc: number(e.target.value, 30) })}
          />
          <Input
            key={`fall-${value.fallFeet}`}
            defaultValue={value.fallFeet === null ? '' : String(value.fallFeet)}
            inputMode="numeric"
            aria-label="Sturzhöhe in Fuß"
            placeholder="Sturz (Fuß)"
            title={
              value.fallFeet
                ? `Wer scheitert, stürzt: ${fallDice(value.fallFeet)}`
                : 'Wie tief man stürzt, wenn die Probe misslingt – leer: kein Sturz'
            }
            onBlur={(e) => set({ fallFeet: number(e.target.value, 1000) })}
          />
          <Input
            className="wf-reise-hazard__text"
            key={`text-${value.text}`}
            defaultValue={value.text}
            placeholder="In deinen Worten – etwa „Der Krähenhang“"
            aria-label="Gefahr in eigenen Worten"
            onBlur={(e) => set({ text: e.target.value.trim() })}
          />
          {/* So steht es nachher am Halt – fertig gerechnet. */}
          <p className="wf-reise-hazard__line">Am Halt: {hazardLine(value)}</p>
        </>
      )}
    </div>
  );
}
