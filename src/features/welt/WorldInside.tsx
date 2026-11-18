/**
 * „Darin“ auf der Seite einer Dimension oder eines Himmelskörpers: die Himmelskörper der
 * Dimension und die obersten Orte, die unmittelbar hier liegen (`worldContents`). Hier ordnet der
 * Spielleiter seine Welt ein: Neues anlegen – oder oberste Orte, die noch nirgends liegen, mit
 * einem Klick hierher legen (mit Rückgängig). Alles darunter kommt von selbst mit.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { placeChildren } from '../../domain/derive';
import { unplacedRoots, worldContents, type World } from '../../domain/worlds';
import { Button, toast } from '../../ui';
import { openEntityDialog } from './editor';
import { EntryRow, Section } from './parts';

export function WorldInside({ world }: { world: World }) {
  const db = useDb();
  const data = useData();
  const { celestials, places } = worldContents(data, world);
  const loose = unplacedRoots(data);
  const [picking, setPicking] = useState(false);
  const isDimension = world.kind === 'dimension';

  /** Legt oberste Orte hierher – einen oder alle, die noch nirgends liegen. */
  const bring = (ids: readonly string[]) => {
    const before = ids.flatMap((id) => {
      const place = db.getSnapshot().entities[id];
      return place?.kind === 'place' ? [place] : [];
    });
    if (!before.length) return;
    db.batch(() => {
      for (const place of before)
        db.put('entities', { ...place, place: { ...place.place, worldId: world.id } });
    });
    toast({
      title:
        before.length === 1
          ? `„${before[0]!.name}“ liegt jetzt in ${world.name}`
          : `${before.length} Orte liegen jetzt in ${world.name}`,
      body: 'Alles, was darin liegt, kommt mit.',
      duration: 12000,
      action: {
        label: 'Rückgängig',
        run: () =>
          db.batch(() => {
            for (const place of before) {
              const current = db.getSnapshot().entities[place.id];
              if (current?.kind === 'place')
                db.put('entities', {
                  ...current,
                  place: { ...current.place, worldId: place.place.worldId },
                });
            }
          }),
      },
    });
  };

  return (
    <Section
      title="Darin"
      count={celestials.length + places.length || undefined}
      action={
        <span className="wf-row" style={{ gap: 'var(--s-1)' }}>
          {isDimension && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus />}
              onClick={() =>
                openEntityDialog({
                  mode: 'create',
                  kind: 'celestial',
                  preset: { dimensionId: world.id },
                })
              }
            >
              Himmelskörper
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus />}
            onClick={() =>
              openEntityDialog({ mode: 'create', kind: 'place', preset: { worldId: world.id } })
            }
          >
            Ort
          </Button>
        </span>
      }
    >
      {celestials.length + places.length === 0 && (
        <p className="wf-welt-quiet">
          Noch nichts.{' '}
          {isDimension
            ? 'Hier stehen die Himmelskörper dieser Dimension und Orte, die unmittelbar in ihr liegen.'
            : 'Hier stehen die obersten Orte auf diesem Himmelskörper – Kontinente, Meere, Reiche.'}
        </p>
      )}
      {celestials.length > 0 && (
        <div className="wf-welt-rows wf-welt-rows--grid">
          {celestials.map((celestial) => (
            <EntryRow
              key={celestial.id}
              entity={celestial}
              sub={celestial.celestial.category || 'Himmelskörper'}
            />
          ))}
        </div>
      )}
      {places.length > 0 && (
        <div className="wf-welt-rows wf-welt-rows--grid">
          {places.map((place) => {
            const below = placeChildren(data, place.id).filter((child) => !child.place.room).length;
            return (
              <EntryRow
                key={place.id}
                entity={place}
                sub={[place.place.category, below ? `${below} darin` : '']
                  .filter(Boolean)
                  .join(' · ')}
              />
            );
          })}
        </div>
      )}
      {loose.length > 0 && (
        <div className="wf-welt-worldloose">
          <span className="wf-mute">
            {loose.length === 1
              ? 'Ein oberster Ort liegt noch nirgends.'
              : `${loose.length} oberste Orte liegen noch nirgends.`}
          </span>
          <button
            type="button"
            className="wf-welt-linkish"
            aria-expanded={picking}
            onClick={() => setPicking((on) => !on)}
          >
            {picking ? 'Zuklappen' : 'Hierher legen …'}
          </button>
          {picking && (
            <div className="wf-welt-worldloose__list">
              {loose.map((place) => (
                <button
                  key={place.id}
                  type="button"
                  className="wf-welt-ownchip__solo"
                  title={`„${place.name}“ in ${world.name} legen – mit allem darin`}
                  onClick={() => bring([place.id])}
                >
                  {place.name}
                  {place.place.category && <em> {place.place.category}</em>}
                </button>
              ))}
              {loose.length > 1 && (
                <Button size="sm" onClick={() => bring(loose.map((place) => place.id))}>
                  Alle {loose.length} hierher legen
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
