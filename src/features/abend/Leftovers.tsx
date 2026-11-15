/**
 * „Vom letzten Abend übrig“: was herübergekommen ist und noch nicht angesehen wurde. Je Zeile
 * entscheidet der Spielleiter: weiter, fallen lassen – oder, wenn es aus einer Geschichte kam,
 * zurück dorthin. Nichts geht verloren, und nichts wandert ungesehen mit (`leftoverLines`).
 */
import { useMemo } from 'react';
import { useData, useDb } from '../../data/hooks';
import { LEFTOVER_LABEL, carriedNote, leftoverLines, type LeftoverLine } from '../../domain/prep';
import { toast } from '../../ui';
import { keepAllLeftovers, settleLeftover } from './actions';
import { useSheet } from './sheet';

export function Leftovers() {
  const db = useDb();
  const data = useData();
  const { which, content } = useSheet();
  const lines = useMemo(() => leftoverLines(data, content), [data, content]);
  if (!lines.length) return null;
  const drop = (line: LeftoverLine) => {
    const undo = settleLeftover(db, line.key, 'drop', which);
    toast({
      title: line.backTo
        ? `Zurück zu „${line.backTo.title}“`
        : `${LEFTOVER_LABEL[line.kind]} fallen gelassen`,
      body: line.backTo
        ? 'Auf dem Blatt des Abends steht es nicht mehr – in der Geschichte bleibt es.'
        : line.text.slice(0, 120),
      action: { label: 'Rückgängig', run: undo },
    });
  };
  return (
    <section className="wf-abend-left" aria-label="Vom letzten Abend übrig">
      <header className="wf-abend-left__head">
        <h3 className="wf-abend-sub">Vom letzten Abend übrig</h3>
        {lines.length > 1 && (
          <button
            type="button"
            className="wf-abend-link"
            title="Alles bleibt auf diesem Blatt"
            onClick={() => keepAllLeftovers(db, which)}
          >
            alles weiter
          </button>
        )}
      </header>
      <p className="wf-abend-left__hint">
        Nicht gespielt, nicht aufgedeckt. Sieh es einmal an – was der Abend nicht braucht, lässt du
        fallen.
      </p>
      {lines.map((line) => (
        <div key={line.key} className="wf-abend-left__row">
          <span className="wf-abend-offer__label">{LEFTOVER_LABEL[line.kind]}</span>
          <span className="wf-abend-left__text wf-clamp-2" title={line.text}>
            {line.text}
            {carriedNote(line.times) && <em> – {carriedNote(line.times)}</em>}
          </span>
          <span className="wf-abend-left__acts">
            <button
              type="button"
              className="wf-abend-link"
              title="Bleibt auf diesem Blatt"
              onClick={() => settleLeftover(db, line.key, 'keep', which)}
            >
              weiter
            </button>
            <button
              type="button"
              className="wf-abend-link"
              title={
                line.backTo
                  ? `Vom Blatt nehmen – in „${line.backTo.title}“ bleibt es stehen`
                  : 'Vom Blatt nehmen'
              }
              onClick={() => drop(line)}
            >
              {line.backTo ? 'zurück zur Geschichte' : 'fallen lassen'}
            </button>
          </span>
        </div>
      ))}
    </section>
  );
}
