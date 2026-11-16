/**
 * Der Kurzblick im Kleinen: eine Karte beim Darüberfahren über einen Verweis im Text (`HoverCard`).
 * Dieselbe Rechnung wie der Kurzblick am Spieltisch (`peekView`) – nur das Nötigste, ruhig, ohne
 * Knöpfe: Art und Satz, Haltung (nach der einen Regel), das Wichtigste, ein paar Zeilen des
 * Steckbriefs und Beziehungen. Ein Klick auf den Verweis öffnet die ganze Seite.
 */
import { useMemo } from 'react';
import { useData } from '../../data/hooks';
import { plainMarkdown } from '../../domain/articleText';
import { KIND_LABEL } from '../../domain/derive';
import { AttitudeBadge, Portrait } from '../../ui';
import { peekView } from './peek';

const CARD_FACTS = 4;
const CARD_TIES = 3;
const CARD_MEMORY = 3;

export function PeekCard({ id }: { id: string }) {
  const data = useData();
  const view = useMemo(() => peekView(data, id), [data, id]);
  if (!view) return null;
  const { entity } = view;
  const memory = view.memory.slice(0, CARD_MEMORY);
  const facts = view.facts.filter((fact) => fact.value.trim()).slice(0, CARD_FACTS);
  const ties = view.ties.slice(0, CARD_TIES);
  return (
    <div className="wf-hovercard__body">
      <div className="wf-hovercard__head">
        {entity.image && <Portrait entity={entity} size={40} />}
        <div className="wf-hovercard__who">
          <div className="wf-hovercard__kind">{KIND_LABEL[entity.kind]}</div>
          <div className="wf-hovercard__name">{entity.name}</div>
        </div>
        {view.hasAttitude && view.attitude !== null && <AttitudeBadge value={view.attitude} />}
      </div>
      {entity.tagline && <p className="wf-hovercard__tagline">{entity.tagline}</p>}
      {memory.length > 0 && (
        <ul className="wf-hovercard__list">
          {memory.map((fact) => (
            <li key={fact.kind}>{fact.text}</li>
          ))}
        </ul>
      )}
      {facts.length > 0 && (
        <dl className="wf-hovercard__facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{plainMarkdown(fact.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {ties.length > 0 && (
        <ul className="wf-hovercard__list wf-hovercard__ties">
          {ties.map((tie) => (
            <li key={tie.otherId}>{tie.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
