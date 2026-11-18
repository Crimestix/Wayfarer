/**
 * Die Wahl der Kategorie – überall dieselbe, in zwei Schritten (Rückmeldung des Spielleiters,
 * 18. 11. 2026: „Ort – und dann bei Subkategorie ‚Stadt‘ sehen oder eine neue Subkategorie von
 * Ort anlegen“): erst die Kategorie von Wayfarer, dann daneben ihre Unterkategorie – eine der
 * eigenen des Spielleiters, „keine“ oder „+ Neue Unterkategorie von Ort …“, das an Ort und Stelle
 * ein kleines Formular öffnet. Eine Unterkategorie steht nie neben oder über der Kategorie.
 */
import { useState, type KeyboardEvent } from 'react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import { ownKindOf, ownKindsOfBase, type OwnKind } from '../../domain/ownKind';
import { Button, Input, Select, toast } from '../../ui';
import { COMMON_KINDS, WORLD_KINDS, isWorldKind, type WorldKind } from './model';
import { addOwnKind } from './ownKinds';

export interface KindChoice {
  /** null = nur ein Text, ohne Kategorie (nur wo `textOption` gesetzt ist). */
  kind: WorldKind | null;
  ownKindId: string | null;
}

const NO_KIND = 'text';
const ADD = 'neu';

export function KindSelect({
  value,
  onChange,
  textOption = false,
}: {
  value: KindChoice;
  onChange: (next: KindChoice) => void;
  /** „Nur ein Text, ohne Art“ anbieten (im Fenster „Neu“). */
  textOption?: boolean;
}) {
  return (
    <div className="wf-welt-kindselect">
      <Select
        value={value.kind ?? NO_KIND}
        aria-label="Kategorie"
        onChange={(e) => {
          const next = e.target.value;
          if (next === NO_KIND) onChange({ kind: null, ownKindId: null });
          // Eine andere Kategorie hat andere Unterkategorien – die gewählte gilt dort nicht.
          else if (isWorldKind(next)) onChange({ kind: next, ownKindId: null });
        }}
      >
        <optgroup label="Übliche">
          {COMMON_KINDS.map((option) => (
            <option key={option} value={option}>
              {KIND_LABEL[option]}
            </option>
          ))}
        </optgroup>
        <optgroup label="Weitere">
          {WORLD_KINDS.filter((option) => !COMMON_KINDS.includes(option)).map((option) => (
            <option key={option} value={option}>
              {KIND_LABEL[option]}
            </option>
          ))}
          {textOption && <option value={NO_KIND}>Nur ein Text, ohne Art</option>}
        </optgroup>
      </Select>
      {value.kind && (
        <SubKindSelect
          kind={value.kind}
          value={value.ownKindId}
          onChange={(ownKindId) => onChange({ kind: value.kind, ownKindId })}
        />
      )}
    </div>
  );
}

/**
 * Die Unterkategorie einer Kategorie: „keine“, eine der eigenen – oder eine neue anlegen, ohne
 * das Fenster zu verlassen.
 */
export function SubKindSelect({
  kind,
  value,
  onChange,
}: {
  kind: WorldKind;
  value: string | null;
  onChange: (ownKindId: string | null) => void;
}) {
  const data = useData();
  const [adding, setAdding] = useState(false);
  const owns = ownKindsOfBase(data, kind);
  const chosen = ownKindOf(data, { kind, ownKindId: value });
  if (adding)
    return (
      <OwnKindForm
        base={kind}
        fixedBase
        onCancel={() => setAdding(false)}
        onDone={(own) => {
          setAdding(false);
          onChange(own.id);
        }}
      />
    );
  return (
    <Select
      value={chosen?.id ?? ''}
      aria-label="Unterkategorie"
      title={`Unterkategorie von ${KIND_LABEL[kind]} – deine eigene Gliederung`}
      onChange={(e) => {
        if (e.target.value === ADD) setAdding(true);
        else onChange(e.target.value || null);
      }}
    >
      <option value="">{owns.length ? 'keine Unterkategorie' : 'Unterkategorie …'}</option>
      {owns.map((own) => (
        <option key={own.id} value={own.id}>
          {own.name}
        </option>
      ))}
      <option value={ADD}>+ Neue Unterkategorie von {KIND_LABEL[kind]} …</option>
    </Select>
  );
}

/** Das kleine Formular für eine neue Unterkategorie: Name, Mehrzahl – und wozu sie gehört. */
export function OwnKindForm({
  base: initialBase,
  name: initialName = '',
  fixedBase = false,
  onDone,
  onCancel,
}: {
  base: WorldKind;
  /** Ein Name, der schon feststeht (aus einem Vorschlag) – änderbar. */
  name?: string;
  /** Die Kategorie steht fest (im Fenster eines Eintrags) – dann fragt das Formular nicht danach. */
  fixedBase?: boolean;
  onDone: (own: OwnKind) => void;
  onCancel?: () => void;
}) {
  const db = useDb();
  const [name, setName] = useState(initialName);
  const [plural, setPlural] = useState('');
  const [base, setBase] = useState<WorldKind>(initialBase);
  const add = () => {
    const made = addOwnKind(db, { name, plural, base });
    if (!made) return;
    if (made.created)
      toast({
        title: `Unterkategorie „${made.own.name}“ von ${KIND_LABEL[base]} angelegt`,
        body: 'Sie steht in der Liste unter ihrer Kategorie, bei „Neu“ und hat eigene Kacheln.',
        action: { label: 'Rückgängig', run: made.undo },
      });
    setName('');
    setPlural('');
    onDone(made.own);
  };
  /** Die Eingabetaste legt an – und speichert nicht das Fenster, in dem das Formular steht. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (name.trim()) add();
    } else if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  return (
    <div className="wf-welt-ownform" onKeyDown={onKeyDown}>
      <Input
        value={name}
        autoFocus
        placeholder={
          fixedBase ? `Neue Unterkategorie von ${KIND_LABEL[base]}` : 'Name – z. B. Stadt'
        }
        aria-label="Name der Unterkategorie"
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        value={plural}
        placeholder="Mehrzahl – z. B. Städte"
        aria-label="Mehrzahl der Unterkategorie"
        onChange={(e) => setPlural(e.target.value)}
      />
      {!fixedBase && (
        <label className="wf-welt-ownform__base">
          <span>Unterkategorie von</span>
          <Select
            value={base}
            aria-label="Unterkategorie von"
            title="Zu welcher Kategorie sie gehört. Davon hängt ab, was Wayfarer mit den Einträgen anfangen kann: Ein Ort hat eine Lage und Leute darin, eine Person eine Haltung zur Gruppe."
            onChange={(e) => isWorldKind(e.target.value) && setBase(e.target.value)}
          >
            {WORLD_KINDS.map((option) => (
              <option key={option} value={option}>
                {KIND_LABEL[option]}
              </option>
            ))}
          </Select>
        </label>
      )}
      <Button size="sm" variant="primary" disabled={!name.trim()} onClick={add}>
        Anlegen
      </Button>
      {onCancel && (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Abbrechen
        </Button>
      )}
    </div>
  );
}
