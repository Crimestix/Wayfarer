/**
 * Das „×“ an einem Vorschlag: weg damit – mit „Rückgängig“, zurückzuholen in den Einstellungen.
 * Der Schlüssel kommt aus `SUGGESTION` (`domain/dismiss.ts`).
 */
import { X } from 'lucide-react';
import { dismissSuggestion } from '../data/actions';
import { useDb } from '../data/hooks';
import { toast } from './components';

export function DismissButton({
  suggestionKey,
  what = 'Vorschlag',
  className,
}: {
  suggestionKey: string;
  /** Wofür der Knopf steht – für Vorleseprogramme und die Meldung. */
  what?: string;
  className?: string;
}) {
  const db = useDb();
  return (
    <button
      type="button"
      className={className ? `wf-dismiss ${className}` : 'wf-dismiss'}
      title="Passt nicht – ausblenden (in den Einstellungen zurückzuholen)"
      aria-label={`${what} ausblenden`}
      onClick={(event) => {
        event.stopPropagation();
        const undo = dismissSuggestion(db, suggestionKey);
        toast({
          title: 'Ausgeblendet',
          body: `${what} – zurückzuholen in den Einstellungen.`,
          action: { label: 'Rückgängig', run: undo },
        });
      }}
    >
      <X aria-hidden />
    </button>
  );
}
