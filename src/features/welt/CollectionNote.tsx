/**
 * Ein ruhiger Hinweis auf der Seite eines Eintrags, der wie eine Sammelseite heißt („Minor NPCs“,
 * „NSCs in …“): vielleicht ist er eher ein Text, der Material ordnet (F18). Wayfarer ändert nichts
 * von selbst – „Kategorie ändern“ öffnet das Fenster „Bearbeiten“; wegklickbar.
 */
import { Library } from 'lucide-react';
import { useData } from '../../data/hooks';
import { SUGGESTION, isDismissed } from '../../domain/dismiss';
import type { Entity } from '../../domain/schema';
import { Button, DismissButton } from '../../ui';
import { isCollectionTitle } from '../wiki/recognize';
import { openEntityDialog } from './editor';

export function CollectionNote({ entity }: { entity: Entity }) {
  const data = useData();
  const key = SUGGESTION.collection(entity.id);
  if (!isCollectionTitle(entity.name) || isDismissed(data, key)) return null;
  return (
    <aside className="wf-welt-housenote">
      <Library className="wf-welt-housenote__icon" aria-hidden />
      <p className="wf-welt-housenote__text">
        „{entity.name}“ klingt nach einer Sammelseite. Ordnet sie nur andere Einträge, passt eine
        andere Kategorie vielleicht besser – oder du lässt sie so.
      </p>
      <Button size="sm" onClick={() => openEntityDialog({ mode: 'edit', id: entity.id })}>
        Kategorie ändern …
      </Button>
      <DismissButton suggestionKey={key} what="Sammelseite" />
    </aside>
  );
}
