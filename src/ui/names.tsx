/**
 * Namen im geschriebenen Text: eine ruhige Zeile unter den Beteiligten eines Blatts. „Im Text
 * genannt“ – Einträge der Welt, die im Text stehen, aber noch nicht dazugehören (ein Klick nimmt
 * sie dazu); „Noch unbekannt“ – Eigennamen, die es in der Welt noch nicht gibt (ein Klick öffnet
 * das kleine Formular zum Anlegen). Jeder Name lässt sich wegklicken („nicht gemeint“). Nichts
 * geschieht von selbst; gerechnet wird in `domain/written.ts`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useData } from '../data/hooks';
import { createKinds } from '../domain/pick';
import type { EntityKind } from '../domain/schema';
import { writtenNames, type UnknownName } from '../domain/written';
import { Popover, cx } from './components';
import { CreateForm, useWriting } from './create';
import { KindIcon } from './entity';

export function NamesHint({
  texts,
  attached,
  ignored = [],
  onAdd,
  onIgnore,
  onRemove,
  storyId,
  kinds,
  className,
}: {
  /** Was auf dem Blatt geschrieben steht. */
  texts: readonly string[];
  /** Wer schon dazugehört. */
  attached: readonly string[];
  /** Was der Spielleiter weggeklickt hat (`onIgnore` liefert die Schlüssel). */
  ignored?: readonly string[] | undefined;
  /** Einen Eintrag dazunehmen – auch einen eben angelegten. */
  onAdd: (entityId: string) => void;
  /** „Nicht gemeint“: Der Name soll hier nicht wieder erscheinen. */
  onIgnore: (key: string) => void;
  /** Ein eben angelegter Eintrag wurde zurückgenommen: ihn wieder herausnehmen. */
  onRemove?: ((entityId: string) => void) | undefined;
  /** Die Geschichte, an der geschrieben wird – sie steht dann an einem neuen Platzhalter. */
  storyId?: string | null | undefined;
  /** Die Arten, die das Anlegen zuerst anbietet. */
  kinds?: readonly EntityKind[] | undefined;
  className?: string | undefined;
}) {
  const data = useData();
  // Für „Rückgängig“: nur, solange das Blatt noch offen ist.
  const latest = useRef(onRemove);
  latest.current = onRemove;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const revert = (entityId: string) => {
    if (alive.current) latest.current?.(entityId);
  };
  const textKey = texts.join('\n\u0000');
  const attachedKey = attached.join(',');
  const ignoredKey = ignored.join('\u0000');
  const names = useMemo(
    () => writtenNames(data, texts, attached, ignored),
    // Gemeint ist der Inhalt der Listen, nicht ihre Identität.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, textKey, attachedKey, ignoredKey],
  );
  if (!names.known.length && !names.unknown.length) return null;
  return (
    <div className={cx('wf-names', className)}>
      {names.known.length > 0 && (
        <div className="wf-names__line">
          <span className="wf-names__label">Im Text genannt</span>
          {names.known.map((entity) => (
            <span key={entity.id} className="wf-names__chip">
              <button
                type="button"
                className="wf-names__take"
                title={`${entity.name} dazunehmen`}
                onClick={() => onAdd(entity.id)}
              >
                <KindIcon kind={entity.kind} />
                {entity.name}
                <Plus aria-hidden className="wf-names__plus" />
              </button>
              <button
                type="button"
                className="wf-names__drop"
                aria-label={`${entity.name} ist nicht gemeint`}
                title="Nicht gemeint"
                onClick={() => onIgnore(entity.id)}
              >
                <X aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      {names.unknown.length > 0 && (
        <div className="wf-names__line">
          <span className="wf-names__label">Noch unbekannt</span>
          {names.unknown.map((entry) => (
            <UnknownChip
              key={entry.key}
              entry={entry}
              kinds={kinds}
              storyId={storyId}
              onAdd={onAdd}
              onIgnore={onIgnore}
              revert={revert}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UnknownChip({
  entry,
  kinds,
  storyId,
  onAdd,
  onIgnore,
  revert,
}: {
  entry: UnknownName;
  kinds: readonly EntityKind[] | undefined;
  storyId: string | null | undefined;
  onAdd: (entityId: string) => void;
  onIgnore: (key: string) => void;
  revert: (entityId: string) => void;
}) {
  const write = useWriting();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    anchor.current?.focus();
  };
  return (
    <span className="wf-names__chip">
      <button
        ref={anchor}
        type="button"
        className="wf-names__take"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`„${entry.name}“ in der Welt anlegen`}
        onClick={() => setOpen((before) => !before)}
      >
        {entry.name}
        <span className="wf-names__as">– anlegen als …</span>
      </button>
      <button
        type="button"
        className="wf-names__drop"
        aria-label={`${entry.name} ist nicht gemeint`}
        title="Nicht gemeint"
        onClick={() => onIgnore(entry.key)}
      >
        <X aria-hidden />
      </button>
      <Popover open={open} onClose={close} anchor={anchor} width={340}>
        <CreateForm
          name={entry.name}
          kind={createKinds(kinds).first[0]!}
          kinds={kinds}
          onBack={close}
          onSubmit={(request) => {
            const outcome = write(request, { storyId, revert: (entity) => revert(entity.id) });
            if (!outcome) return;
            setOpen(false);
            onAdd(outcome.entity.id);
          }}
        />
      </Popover>
    </span>
  );
}
