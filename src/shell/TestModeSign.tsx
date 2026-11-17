/**
 * Das Zeichen des Testmodus in der Leiste links: Solange er läuft, steht es immer da – damit
 * niemand im Testmodus einen echten Abend spielt, ohne es zu merken. Ein Klick führt zum Schalter.
 */
import { FlaskConical } from 'lucide-react';
import { useLocation } from 'wouter';
import { useTestMode } from '../data/testMode';
import { focusOn } from './focus';

export function TestModeSign() {
  const testing = useTestMode();
  const [, navigate] = useLocation();
  if (!testing) return null;
  return (
    <button
      type="button"
      className="wf-testmode"
      title="Alles, was du jetzt tust, wird beim Ausschalten verworfen. Klick: zum Schalter in den Einstellungen."
      onClick={() => {
        navigate('/einstellungen');
        focusOn({ type: 'settings', section: 'testmode' });
      }}
    >
      <FlaskConical aria-hidden />
      <span>
        <b>Testmodus</b> – nichts bleibt
      </span>
    </button>
  );
}
