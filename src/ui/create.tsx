/**
 * Anlegen beim Schreiben: das kleine Formular, das in einer Auswahl oder am „@“ aufklappt – Name,
 * Art, ein Satz –, und der Handgriff dahinter. Die Welt wächst aus der Geschichte: Angelegt wird
 * ein Platzhalter, ohne die Seite zu verlassen; fertig geschrieben wird später. Angelegt wird nur
 * über `addFromWriting` – gibt es den Namen schon, wird der vorhandene Eintrag genommen.
 */
import { useState, type KeyboardEvent } from 'react';
import { useDb } from '../data/hooks';
import { KIND_LABEL } from '../domain/derive';
import { createKinds } from '../domain/pick';
import type { Entity, EntityKind } from '../domain/schema';
// Der eine Befehl, den die Bausteine selbst auslösen: Er braucht die Regeln des Wikis für Namen.
import { addFromWriting } from '../features/welt/writing';
import { Button, Input, Select, toast } from './components';

export interface CreateOptions {
  /** Die Geschichte, bei deren Schreiben angelegt wird – sie steht dann am Platzhalter. */
  storyId?: string | null | undefined;
  /** Ein Eintrag wurde hier angelegt (oder unter diesem Namen gefunden). */
  onCreated?: ((entity: Entity) => void) | undefined;
  /**
   * Das Feld verträgt nur seine Arten (ein Ort bei „Wo?“). Sonst wird jeder Eintrag genommen –
   * Arten helfen beim Finden, sie schränken nicht ein.
   */
  onlyKinds?: boolean | undefined;
}

export interface WriteRequest {
  name: string;
  kind: EntityKind;
  line?: string | undefined;
}

export interface WriteContext {
  storyId?: string | null | undefined;
  /** Die Arten des Feldes – nur gefragt, wenn es keine andere verträgt. */
  kinds?: readonly EntityKind[] | undefined;
  onlyKinds?: boolean | undefined;
  /** Wer im Feld schon steht – er wird nicht ein zweites Mal genommen. */
  exclude?: readonly string[] | undefined;
  /** Nimmt beim „Rückgängig“ den Eintrag auch aus dem Feld wieder heraus. */
  revert?: ((entity: Entity) => void) | undefined;
}

export interface WriteOutcome {
  entity: Entity;
  /** Der Eintrag passt ins Feld und ist zu nehmen. */
  taken: boolean;
  created: boolean;
}

const kindList = (kinds: readonly EntityKind[]) => kinds.map((kind) => KIND_LABEL[kind]).join(', ');

/**
 * Legt an, was beim Schreiben fehlt, und meldet es – mit „Rückgängig“, wenn etwas entstanden ist.
 * Gibt zurück, ob der Eintrag ins Feld gehört.
 */
export function useWriting(): (
  request: WriteRequest,
  context?: WriteContext,
) => WriteOutcome | null {
  const db = useDb();
  return (request, context = {}) => {
    const result = addFromWriting(db, { ...request, storyId: context.storyId });
    if (!result) return null;
    const { entity, created } = result;
    const fits =
      !context.onlyKinds || !context.kinds?.length || context.kinds.includes(entity.kind);
    const only = fits ? '' : `Dieses Feld nimmt nur: ${kindList(context.kinds ?? [])}.`;
    // Im Formular auf einen Namen geändert, der hier schon steht: nichts doppelt nehmen.
    const already = context.exclude?.includes(entity.id) ?? false;
    if (created)
      toast({
        title: fits ? `„${entity.name}“ angelegt` : `„${entity.name}“ angelegt, hier nicht gewählt`,
        body: fits
          ? `Als ${KIND_LABEL[entity.kind]} – ein Platzhalter, noch zu schreiben.`
          : `Als ${KIND_LABEL[entity.kind]}. ${only}`,
        action: {
          label: 'Rückgängig',
          run: () => {
            if (fits) context.revert?.(entity);
            result.undo();
          },
        },
        duration: 8000,
      });
    else
      toast({
        title: `„${entity.name}“ gibt es schon`,
        body: already
          ? 'Der Eintrag steht hier schon.'
          : fits
            ? result.otherKind
              ? `Als ${KIND_LABEL[entity.kind]} – der vorhandene Eintrag ist genommen.`
              : 'Der vorhandene Eintrag ist genommen.'
            : `Als ${KIND_LABEL[entity.kind]}. ${only}`,
      });
    return { entity, taken: fits && !already, created };
  };
}

/**
 * Das kleine Formular: Name und Art (beides änderbar) und ein Satz, der auch später kommen kann.
 * Die Eingabetaste legt an.
 */
export function CreateForm({
  name: initialName,
  kind: initialKind,
  kinds,
  onSubmit,
  onBack,
}: {
  name: string;
  kind: EntityKind;
  /** Die Arten des Feldes – sie stehen in der Liste vorn. */
  kinds?: readonly EntityKind[] | undefined;
  onSubmit: (request: WriteRequest) => void;
  /** Zurück zur Auswahl. */
  onBack: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [kind, setKind] = useState(initialKind);
  const [line, setLine] = useState('');
  const { first, more } = createKinds(kinds);
  const ready = name.trim() !== '';
  const submit = () => {
    if (ready) onSubmit({ name, kind, line });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    // Auf einem Knopf tut die Eingabetaste, was der Knopf tut.
    if ((event.target as HTMLElement).tagName === 'BUTTON') return;
    event.preventDefault();
    event.stopPropagation();
    submit();
  };
  return (
    <div className="wf-create" role="group" aria-label="Neu anlegen" onKeyDown={onKeyDown}>
      <div className="wf-create__head">Neu in der Welt</div>
      <div className="wf-create__row">
        <Input
          value={name}
          aria-label="Name"
          placeholder="Name"
          onChange={(event) => setName(event.target.value)}
        />
        <Select
          value={kind}
          aria-label="Art"
          onChange={(event) => setKind(event.target.value as EntityKind)}
        >
          {first.map((entry) => (
            <option key={entry} value={entry}>
              {KIND_LABEL[entry]}
            </option>
          ))}
          <optgroup label="Andere Art">
            {more.map((entry) => (
              <option key={entry} value={entry}>
                {KIND_LABEL[entry]}
              </option>
            ))}
          </optgroup>
        </Select>
      </div>
      <Input
        autoFocus
        value={line}
        aria-label="Ein Satz dazu"
        placeholder="Ein Satz dazu – kann später kommen"
        onChange={(event) => setLine(event.target.value)}
      />
      <div className="wf-create__foot">
        <span className="wf-create__hint">Ein Platzhalter – fertig schreibst du ihn später.</span>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Zurück
        </Button>
        <Button size="sm" disabled={!ready} onClick={submit}>
          Anlegen
        </Button>
      </div>
    </div>
  );
}
