/**
 * Leise am Artikel: welche Felder das Steckbrief-Gerüst seiner Art noch vorsieht. Ein Klick fügt
 * die leere Zeile ein; „Ausblenden“ lässt den Hinweis an diesem Artikel ruhen. Nie eine Pflicht.
 */
import { useMemo } from 'react';
import { useData, useDb } from '../../data/hooks';
import type { Article } from '../../domain/schema';
import { toast } from '../../ui';
import { addScaffoldFields, dismissHint } from './actions';
import { flushEdits } from './editing';
import { SCAFFOLD_HINT, articleScaffoldGap } from './scaffold';

export function ScaffoldHint({ article }: { article: Article }) {
  const db = useDb();
  const data = useData();
  const gap = useMemo(() => articleScaffoldGap(data, article), [data, article]);
  if (!gap) return null;
  const add = (labels: string[]) => {
    flushEdits();
    const undo = addScaffoldFields(db, article.id, labels);
    if (undo)
      toast({
        title: labels.length === 1 ? 'Leeres Feld eingefügt' : 'Leere Felder eingefügt',
        body: `Im Steckbrief: ${labels.join(', ')}`,
        action: { label: 'Rückgängig', run: undo },
      });
  };
  const hide = () => {
    flushEdits();
    const undo = dismissHint(db, article.id, SCAFFOLD_HINT);
    toast({
      title: 'Hinweis ausgeblendet',
      body: 'An diesem Artikel steht nicht mehr, was im Steckbrief fehlt.',
      action: { label: 'Rückgängig', run: undo },
    });
  };
  return (
    <div className="wf-wiki-scaffold" role="note">
      <span className="wf-wiki-scaffold__label">Im Steckbrief fehlt noch:</span>
      {gap.missing.map((label, index) => (
        <span key={label}>
          <button
            type="button"
            className="wf-wiki-scaffold__field"
            title={`Eine leere Zeile „${label}:“ in den Steckbrief setzen`}
            onClick={() => add([label])}
          >
            {label}
          </button>
          {index < gap.missing.length - 1 && ','}
        </span>
      ))}
      {gap.missing.length > 1 && (
        <button type="button" className="wf-wiki-scaffold__act" onClick={() => add(gap.missing)}>
          alle einfügen
        </button>
      )}
      <button
        type="button"
        className="wf-wiki-scaffold__act"
        title="An diesem Artikel nicht mehr zeigen"
        onClick={hide}
      >
        ausblenden
      </button>
    </div>
  );
}
