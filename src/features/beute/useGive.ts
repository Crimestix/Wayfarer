/** Beute mit einem Klick ausgeben – überall gleich: Beute-Buch, Mitschrift und ein „Rückgängig“. */
import { useDb } from '../../data/hooks';
import { lootLine, lootRecipient } from '../../domain/loot';
import type { Loot } from '../../domain/schema';
import { toast } from '../../ui';
import { giveLoot } from './actions';

export function useGiveLoot(): (loot: Loot) => void {
  const db = useDb();
  return (loot) => {
    const data = db.getSnapshot();
    const undo = giveLoot(db, loot.id);
    if (!undo) return;
    toast({
      title: 'Beute ausgegeben',
      body: `${lootLine(data, loot)} – an ${lootRecipient(data, loot)}`,
      action: { label: 'Rückgängig', run: undo },
    });
  };
}
