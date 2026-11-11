/**
 * Vorschläge zur Verwandtschaft: was naheliegt, aber nicht sicher ist. Jeder nennt, woraus er
 * folgt; eingetragen wird nur, was der Spielleiter annimmt.
 */
import { useData, useDb } from '../../data/hooks';
import type { KinSuggestion } from '../../domain/kin';
import { toast } from '../../ui';
import { setKin, skipKinSuggestion } from './kin';

export function KinSuggestions({ suggestions }: { suggestions: KinSuggestion[] }) {
  const db = useDb();
  const data = useData();
  if (!suggestions.length) return null;
  const accept = (s: KinSuggestion) => {
    const before = data.relations;
    const relation = setKin(db, s.fromId, s.toId, s.kin);
    if (!relation) return;
    toast({
      title: 'Verwandtschaft eingetragen',
      body: s.line.replace(' könnte ', ' ist ').replace(/ sein$/, ''),
      action: {
        label: 'Rückgängig',
        run: () => {
          // War die Beziehung schon da, bekommt sie ihren alten Stand; sonst verschwindet sie.
          const old = before[relation.id];
          if (old) db.put('relations', old);
          else if (db.getSnapshot().relations[relation.id]) db.remove('relations', relation.id);
        },
      },
    });
  };
  const dismiss = (s: KinSuggestion) => {
    const undo = skipKinSuggestion(db, s.relationId, s.key);
    if (undo)
      toast({
        title: 'Vorschlag verworfen',
        body: 'Er kommt nicht wieder.',
        action: { label: 'Rückgängig', run: undo },
      });
  };
  return (
    <div className="wf-welt-kinhints" aria-label="Vorschläge zur Verwandtschaft">
      <div className="wf-welt-kinhints__head">
        {suggestions.length === 1 ? 'Ein Vorschlag' : `${suggestions.length} Vorschläge`} – was
        naheliegt, aber nicht sicher ist
      </div>
      {suggestions.map((s) => (
        <div key={s.key} className="wf-welt-kinhints__row">
          <div className="wf-welt-kinhints__text">
            <strong>{s.line}</strong>
            <span>{s.reason}.</span>
          </div>
          <button type="button" className="wf-wiki-facts__act" onClick={() => accept(s)}>
            Eintragen
          </button>
          <button type="button" className="wf-wiki-facts__act" onClick={() => dismiss(s)}>
            Stimmt nicht
          </button>
        </div>
      ))}
    </div>
  );
}
