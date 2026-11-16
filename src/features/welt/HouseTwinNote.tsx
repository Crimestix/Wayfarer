/**
 * Ein ruhiger Hinweis auf der Seite einer Fraktion oder Familie: Es gibt dasselbe Haus noch
 * einmal in der anderen Art („Haus Orvyndra“ als Fraktion, „Orvyndra“ als Familie). Auf Klick
 * werden beide ein Eintrag (`mergeHouse`), mit Rückgängig; wegklickbar.
 */
import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { Castle } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { Button, DismissButton, confirmDialog, toast } from '../../ui';
import { houseName, houseTwins, mergeHouse } from './house';

export function HouseTwinNote({ entityId }: { entityId: string }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const twins = useMemo(
    () => houseTwins(data).filter((t) => t.faction.id === entityId || t.family.id === entityId),
    [data, entityId],
  );
  const twin = twins[0];
  if (!twin) return null;
  const { faction, family } = twin;
  const name = houseName(family, faction);

  const merge = async () => {
    const ok = await confirmDialog({
      title: `„${faction.name}“ und „${family.name}“ zusammenlegen?`,
      body: (
        <div className="wf-col">
          <p>
            Beide werden ein Eintrag: „{name}“. Er steht als Familie mit Stammbaum da und kann
            alles, was eine Fraktion kann: Sitz, Haltung zur Gruppe, Vorhaben, Gefolge.
          </p>
          <p>
            Beziehungen, Haltungen, Geschichten und alle Verweise ziehen mit. Der andere Name bleibt
            als Zweitname, Notizen und Geheimnisse stehen untereinander.
          </p>
        </div>
      ),
      confirmLabel: 'Zusammenlegen',
    });
    if (!ok) return;
    const result = mergeHouse(db, family.id, faction.id);
    if (!result) return;
    navigate(`/welt/${result.houseId}`);
    toast({
      title: `Ein Haus: „${result.name}“`,
      body: result.textLeft
        ? `Der Text „${result.textLeft}“ steht weiter im Wiki, unter „Texte ohne Eintrag“.`
        : undefined,
      action: { label: 'Rückgängig', run: result.undo },
    });
  };

  return (
    <aside className="wf-welt-housenote">
      <Castle className="wf-welt-housenote__icon" aria-hidden />
      <p className="wf-welt-housenote__text">
        „{faction.name}“ (Fraktion) und „{family.name}“ (Familie) sind wohl dasselbe Haus.
      </p>
      <Button size="sm" onClick={() => void merge()}>
        Zu einem Haus zusammenlegen
      </Button>
      <DismissButton suggestionKey={twin.key} what="Dasselbe Haus" />
    </aside>
  );
}
