/**
 * Spieltisch: „Hier und jetzt“. Wo ist die Gruppe, wer ist hier, was hat sich verändert,
 * was steht an, wie geht es den Gefährten – und eine Zeile, um festzuhalten, was passiert.
 */
import { useData } from '../../data/hooks';
import { AgendaPanel } from './Agenda';
import { CompanionStrip } from './Companions';
import { JournalPanel } from './Journal';
import { partyPlace } from './model';
import { NoPlace, PlacePanel } from './PlacePanel';
import './tisch.css';

export default function TischPage() {
  const data = useData();
  const place = partyPlace(data);
  return (
    <div className="wf-tisch">
      <div className="wf-tisch__place">
        {place ? <PlacePanel key={place.id} place={place} /> : <NoPlace />}
      </div>
      <div className="wf-tisch__side">
        <JournalPanel />
        <AgendaPanel />
      </div>
      <CompanionStrip />
    </div>
  );
}
