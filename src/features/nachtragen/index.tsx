/**
 * Zeit › Nachtragen: alte Sessions aus den Notizen des Spielleiters. `/nachtragen` liest und
 * übernimmt Dateien, `/nachtragen/<sessionId>` zeigt eine übernommene Session.
 */
import { useParams } from 'wouter';
import { NotesOverview } from './Overview';
import { SessionReview } from './SessionReview';
import './nachtragen.css';

export default function NachtragenPage() {
  const { id } = useParams<{ id?: string }>();
  return id ? <SessionReview key={id} sessionId={id} /> : <NotesOverview />;
}
