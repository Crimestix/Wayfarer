/**
 * Was eine Linie der Karte bedeutet, zum Lesen: Länge, Dauer zu Fuß, Gelände und Warnungen.
 * Gezeigt beim Zeichnen und am Spieltisch.
 */
import type { MapLine } from '../../domain/schema';
import { formatWayTime } from '../../domain/ways';
import { formatLength, type LineFacts } from './model';

export function LineSummary({ facts, kind }: { facts: LineFacts; kind: MapLine['kind'] }) {
  const walkable = kind === 'road' || kind === 'path';
  return (
    <>
      <dl className="wf-karten-card__facts">
        {facts.km !== null && (
          <>
            <dt>Länge</dt>
            <dd>{formatLength(facts.km)}</dd>
          </>
        )}
        {facts.minutes !== null && (
          <>
            <dt>Zu Fuß</dt>
            <dd>{formatWayTime(facts.minutes)}</dd>
          </>
        )}
        {walkable && facts.km !== null && (
          <>
            <dt>Gelände</dt>
            <dd>
              {kind === 'road'
                ? `${facts.sort} – volles Tempo`
                : facts.difficult > 0.02
                  ? `${Math.round(facts.difficult * 100)} % schwierig`
                  : 'leicht'}
            </dd>
          </>
        )}
      </dl>
      {facts.wet && (
        <p className="wf-karten-card__warn">
          Der Pfad führt durch Wasser. Ohne Brücke oder Furt kommt hier niemand zu Fuß hinüber.
        </p>
      )}
      {facts.blocked && (
        <p className="wf-karten-card__warn">
          Der Pfad führt durch Fels oder über einen Abgrund. Dort kommt nur ein Gang hindurch.
        </p>
      )}
    </>
  );
}
