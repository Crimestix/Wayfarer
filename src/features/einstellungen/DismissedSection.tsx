/**
 * „Ausgeblendete Vorschläge“: was der Spielleiter mit „×“ weggeklickt hat, je Sorte gezählt –
 * zurückzuholen, je Sorte oder alle (`restoreSuggestions`).
 */
import { RotateCcw } from 'lucide-react';
import { restoreSuggestions } from '../../data/actions';
import { useData, useDb } from '../../data/hooks';
import { dismissedSorts } from '../../domain/dismiss';
import { Button, toast } from '../../ui';

export function DismissedSection() {
  const db = useDb();
  const data = useData();
  const sorts = dismissedSorts(data);
  const restore = (sort?: string) => {
    const undo = restoreSuggestions(db, sort);
    toast({
      title: 'Wieder da',
      body: 'Die Vorschläge stehen wieder dort, wo sie vorher standen.',
      action: { label: 'Rückgängig', run: undo },
    });
  };
  if (!sorts.length)
    return (
      <p className="wf-mute">Nichts ausgeblendet. Ein „×“ an einem Vorschlag blendet ihn aus.</p>
    );
  return (
    <div className="wf-col" style={{ gap: 'var(--s-2)' }}>
      {sorts.map(({ sort, label, count }) => (
        <div key={sort} className="wf-row" style={{ gap: 'var(--s-3)' }}>
          <span className="wf-grow">
            {label}: {count}
          </span>
          <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => restore(sort)}>
            Wieder zeigen
          </Button>
        </div>
      ))}
      {sorts.length > 1 && (
        <div>
          <Button size="sm" icon={<RotateCcw />} onClick={() => restore()}>
            Alle wieder zeigen
          </Button>
        </div>
      )}
    </div>
  );
}
