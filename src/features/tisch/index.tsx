/**
 * Spieltisch: „Hier und jetzt“. Links der Ort der Gruppe – wer hier ist, wohin es geht. In der
 * Mitte die Geschichten, die gerade im Spiel sind, mit allem, was an ihnen hängt. Rechts die
 * Mitschrift und was sonst noch ansteht; unten die Gefährten.
 */
import { useData } from '../../data/hooks';
import { AgendaPanel } from './Agenda';
import { CompanionStrip } from './Companions';
import { JournalPanel } from './Journal';
import { partyPlace } from './model';
import { NoPlace, PlacePanel } from './PlacePanel';
import { PlayPanel } from './PlayPanel';
import './tisch.css';

export default function TischPage() {
  const data = useData();
  const place = partyPlace(data);
  return (
    <div className="wf-tisch">
      <div className="wf-tisch__place">
        {place ? <PlacePanel key={place.id} place={place} /> : <NoPlace />}
      </div>
      <div className="wf-tisch__play">
        <PlayPanel />
      </div>
      <div className="wf-tisch__side">
        <JournalPanel />
        <AgendaPanel />
      </div>
      <CompanionStrip />
    </div>
  );
}
