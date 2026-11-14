/**
 * „Fahrten“ am Spieltisch, unter den Wegen: die Abläufe nach Fahrplan, die hier abfahren – eine
 * Fähre, ein Schiff, eine Kutschlinie – mit der nächsten Abfahrt. „Überfahrt …“ öffnet das
 * Buchen. Fährt ein Ablauf gerade nicht, steht nur der Grund da. Die Rechnung steht in
 * `domain/crossing.ts`.
 */
import { useMemo, useState } from 'react';
import { useData } from '../../data/hooks';
import { crossingsHere, departureText, type Crossing } from '../../domain/crossing';
import { entityName } from '../../domain/derive';
import { CrossingDialog } from './CrossingDialog';
import './fortbewegung.css';

/** So viele Fahrten stehen in der Zeile. */
const SHOWN = 3;

export function CrossingRow() {
  const data = useData();
  const crossings = useMemo(() => crossingsHere(data), [data]);
  const [booking, setBooking] = useState<Crossing | null>(null);
  if (!crossings.length) return null;
  const now = data.state.now;
  const cal = data.campaign.calendar;
  return (
    <nav className="wf-tisch-ways wf-fort-crossings" aria-label="Fahrten von hier">
      <span className="wf-tisch-ways__label">Fahrten</span>
      <div className="wf-fort-crossings__list">
        {crossings.slice(0, SHOWN).map((crossing) => (
          <div key={crossing.run.id} className="wf-fort-crossing">
            <div className="wf-fort-crossing__text">
              <span className="wf-clamp-1">
                Nächste Fahrt nach <b>{entityName(data, crossing.run.toId)}</b>
              </span>
              <span className="wf-fort-crossing__when wf-clamp-1">
                {crossing.next
                  ? `${crossing.run.name} · ${departureText(cal, now, crossing.next.departs)}`
                  : crossing.problem
                    ? `${crossing.run.name} fährt nicht: ${crossing.problem}`
                    : `${crossing.run.name} · keine Abfahrt in Sicht`}
              </span>
            </div>
            {crossing.next && (
              <button
                type="button"
                className="wf-fort-link wf-fort-crossing__book"
                onClick={() => setBooking(crossing)}
                title="Überfahrt buchen und mitfahren – die Zeit vergeht bis zur Ankunft"
              >
                Überfahrt …
              </button>
            )}
          </div>
        ))}
        {crossings.length > SHOWN && (
          <span className="wf-fort-crossing__when">
            und {crossings.length - SHOWN} weitere im Weltgeschehen
          </span>
        )}
      </div>
      {booking && <CrossingDialog crossing={booking} onClose={() => setBooking(null)} />}
    </nav>
  );
}
