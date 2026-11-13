/**
 * Gedächtnis beim Tippen: unter einem Schreibfeld leise das Wichtigste zu den Namen, die im Text
 * stehen – höchstens zwei, der zuletzt genannte zuerst. Kein Fenster, kein Fokuswechsel; die
 * Fläche hat immer dieselbe Höhe, damit darunter nichts springt. Gerechnet wird in
 * `domain/memory.ts`.
 */
import { useDeferredValue, useMemo } from 'react';
import { Link } from 'wouter';
import { EyeOff } from 'lucide-react';
import { useData, useDb } from '../data/hooks';
import { MEMORY_NAMES, nameMemory, namesInText } from '../domain/memory';
import { cx } from './components';
import { entityHref } from './entity';

export function NameMemory({
  text,
  refs = [],
  className,
}: {
  text: string;
  /** Schon gewählte Einträge (über „@“): machen mehrdeutige Namen eindeutig. */
  refs?: readonly string[];
  className?: string;
}) {
  const db = useDb();
  const data = useData();
  const shown = data.state.nameMemory !== false;
  const deferredText = useDeferredValue(text);
  const refKey = refs.join(',');
  const deferredRefs = useDeferredValue(refKey);
  const lines = useMemo(() => {
    const ids = deferredRefs ? deferredRefs.split(',') : [];
    if (shown) return nameMemory(data, deferredText, ids, MEMORY_NAMES);
    // Ausgeblendet: nur wissen, ob es etwas zu zeigen gäbe – für „einblenden“.
    return namesInText(data, deferredText, ids).length ? null : [];
  }, [data, deferredText, deferredRefs, shown]);
  const setShown = (value: boolean) => db.setState({ nameMemory: value });

  return (
    <div className={cx('wf-memory', className)} aria-live="polite">
      {lines === null ? (
        <button
          type="button"
          className="wf-memory__show"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShown(true)}
        >
          Gedächtnis zu Namen einblenden
        </button>
      ) : (
        lines.map((line, i) => (
          <div key={line.id} className="wf-memory__line">
            <Link
              href={entityHref(line)}
              className="wf-memory__name"
              // Die Schreibmarke bleibt im Feld.
              onMouseDown={(e) => e.preventDefault()}
            >
              {line.name}
            </Link>
            {/* Wird es zu lang, endet die Zeile mit „…“ – das Wichtigste steht vorn. */}
            <span className="wf-memory__facts">
              {line.facts.map((fact) => (
                <span key={fact.kind}>
                  <span className="wf-memory__dot" aria-hidden>
                    {' · '}
                  </span>
                  {fact.text}
                </span>
              ))}
            </span>
            {i === 0 && (
              <button
                type="button"
                className="wf-memory__hide"
                aria-label="Gedächtnis zu Namen ausblenden"
                title="Gedächtnis zu Namen ausblenden – an derselben Stelle lässt es sich wieder einblenden"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShown(false)}
              >
                <EyeOff aria-hidden />
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}
