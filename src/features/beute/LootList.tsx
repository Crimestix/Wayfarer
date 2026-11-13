/**
 * Bereitgelegte Beute auf einem Blatt (Abend, Geschichte): was bereitliegt, für wen – und ein
 * Knopf für mehr. Ein Klick auf eine Zeile öffnet sie zum Ändern.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useData } from '../../data/hooks';
import { lootLine, lootRecipient, readyLoot } from '../../domain/loot';
import type { Loot } from '../../domain/schema';
import { Button } from '../../ui';
import { LootDialog } from './LootDialog';
import './beute.css';

export function LootList({
  storyId,
}: {
  /** Nur die Beute dieser Geschichte; ohne Angabe alles, was bereitliegt. */
  storyId?: string;
}) {
  const data = useData();
  const [dialog, setDialog] = useState<{ loot?: Loot } | null>(null);
  const ready = readyLoot(data, storyId);

  return (
    <div className="wf-beute-list">
      {ready.map((loot) => {
        const story = !storyId && loot.storyId ? data.stories[loot.storyId] : undefined;
        return (
          <button
            key={loot.id}
            type="button"
            className="wf-beute-item"
            title="Ändern"
            onClick={() => setDialog({ loot })}
          >
            <span className="wf-beute-item__what">{lootLine(data, loot)}</span>
            <span className="wf-beute-item__meta">
              <span className="wf-beute-row__to">für {lootRecipient(data, loot)}</span>
              {loot.source && <span>{loot.source}</span>}
              {story && <span>{story.title}</span>}
            </span>
          </button>
        );
      })}
      <div>
        <Button size="sm" icon={<Plus />} onClick={() => setDialog({})}>
          Beute bereitlegen
        </Button>
      </div>
      {dialog && (
        <LootDialog loot={dialog.loot} storyId={storyId} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
