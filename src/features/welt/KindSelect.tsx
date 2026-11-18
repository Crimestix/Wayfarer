/**
 * Die Wahl der Kategorie – überall dieselbe: zuerst die eigenen Kategorien des Spielleiters
 * („Stadt – wie Ort“), dann die von Wayfarer, und ganz unten „+ Eigene Kategorie anlegen …“, das
 * an Ort und Stelle ein kleines Formular öffnet (Name, Mehrzahl, verhält sich wie). So entsteht
 * eine eigene Kategorie dort, wo man sie braucht – ohne die Seite zu verlassen.
 */
import { useState, type KeyboardEvent } from 'react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import { ownKindById, ownKinds, type OwnKind } from '../../domain/ownKind';
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
const OWN = 'own:';

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
  const data = useData();
  const [adding, setAdding] = useState(false);
  const owns = ownKinds(data).filter((own) => isWorldKind(own.base));
  const chosen = ownKindById(data, value.ownKindId);
  const current =
    value.kind === null
      ? NO_KIND
      : chosen && chosen.base === value.kind
        ? OWN + chosen.id
        : value.kind;

  if (adding)
    return (
      <OwnKindForm
        base={value.kind ?? 'place'}
        onCancel={() => setAdding(false)}
        onDone={(own) => {
          setAdding(false);
          if (isWorldKind(own.base)) onChange({ kind: own.base, ownKindId: own.id });
        }}
      />
    );
  return (
    <Select
      value={current}
      aria-label="Kategorie"
      onChange={(e) => {
        const next = e.target.value;
        if (next === ADD) return setAdding(true);
        if (next === NO_KIND) return onChange({ kind: null, ownKindId: null });
        if (next.startsWith(OWN)) {
          const own = ownKindById(data, next.slice(OWN.length));
          if (own && isWorldKind(own.base)) onChange({ kind: own.base, ownKindId: own.id });
          return;
        }
        if (isWorldKind(next)) onChange({ kind: next, ownKindId: null });
      }}
    >
      {owns.length > 0 && (
        <optgroup label="Deine Kategorien">
          {owns.map((own) => (
            <option key={own.id} value={OWN + own.id}>
              {own.name} – wie {KIND_LABEL[own.base as WorldKind]}
            </option>
          ))}
        </optgroup>
      )}
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
      <option value={ADD}>+ Eigene Kategorie anlegen …</option>
    </Select>
  );
}

/** Das kleine Formular für eine neue eigene Kategorie: Name, Mehrzahl, verhält sich wie. */
export function OwnKindForm({
  base: initialBase,
  onDone,
  onCancel,
}: {
  base: WorldKind;
  onDone: (own: OwnKind) => void;
  onCancel?: () => void;
}) {
  const db = useDb();
  const [name, setName] = useState('');
  const [plural, setPlural] = useState('');
  const [base, setBase] = useState<WorldKind>(initialBase);
  const add = () => {
    const made = addOwnKind(db, { name, plural, base });
    if (!made) return;
    if (made.created)
      toast({
        title: `Eigene Kategorie „${made.own.name}“ angelegt`,
        body: `Verhält sich wie ${KIND_LABEL[base]} – sie steht in der Liste, bei „Neu“ und hat eigene Kacheln.`,
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
        placeholder="Name – z. B. Stadt"
        aria-label="Name der eigenen Kategorie"
        onChange={(e) => setName(e.target.value)}
      />
      <Input
        value={plural}
        placeholder="Mehrzahl – z. B. Städte"
        aria-label="Mehrzahl der eigenen Kategorie"
        onChange={(e) => setPlural(e.target.value)}
      />
      <label className="wf-welt-ownform__base">
        <span>verhält sich wie</span>
        <Select
          value={base}
          aria-label="Verhält sich wie"
          title="Davon hängt ab, was Wayfarer mit den Einträgen anfangen kann: Ein Ort hat eine Lage und Leute darin, eine Person eine Haltung zur Gruppe, ein Gegenstand einen Besitzer."
          onChange={(e) => isWorldKind(e.target.value) && setBase(e.target.value)}
        >
          {WORLD_KINDS.map((option) => (
            <option key={option} value={option}>
              {KIND_LABEL[option]}
            </option>
          ))}
        </Select>
      </label>
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
