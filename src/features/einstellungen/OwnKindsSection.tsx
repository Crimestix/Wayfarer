/**
 * „Eigene Kategorien“: was der Spielleiter selbst angelegt hat – Name, Mehrzahl, wie sie sich
 * verhält und wie viele Einträge dazugehören. Umbenennen beim Verlassen des Feldes, entfernen mit
 * Rückgängig (die Einträge bleiben). Neu anlegen geht hier und überall, wo man eine Kategorie
 * wählt („+ Eigene Kategorie anlegen …“).
 */
import { Trash2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import { ownKindCounts, ownKinds } from '../../domain/ownKind';
import type { EntityKind } from '../../domain/schema';
import { IconButton, Input, toast } from '../../ui';
import { OwnKindForm } from '../welt/KindSelect';
import { patchOwnKind, removeOwnKind } from '../welt/ownKinds';

export function OwnKindsSection() {
  const db = useDb();
  const data = useData();
  const kinds = ownKinds(data);
  const counts = ownKindCounts(data);
  const remove = (id: string, name: string) => {
    const undo = removeOwnKind(db, id);
    if (undo)
      toast({
        title: `Kategorie „${name}“ entfernt`,
        body: 'Die Einträge sind geblieben – sie stehen wieder nur unter ihrer Grundkategorie.',
        duration: 12000,
        action: { label: 'Rückgängig', run: undo },
      });
  };
  return (
    <div className="wf-einstellungen-stack">
      {kinds.length === 0 ? (
        <p className="wf-mute">
          Noch keine. Eine eigene Kategorie ist eine benannte Gruppe innerhalb einer Kategorie von
          Wayfarer: „Stadt“ verhält sich wie ein Ort, „Major NPC“ wie eine Person – und steht doch
          für sich in der Liste, mit eigenen Kacheln und bei „Neu“.
        </p>
      ) : (
        <table className="wf-einstellungen-ownkinds">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Mehrzahl</th>
              <th scope="col">Verhält sich wie</th>
              <th scope="col">Einträge</th>
              <th scope="col">
                <span aria-hidden> </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {kinds.map((own) => (
              <tr key={own.id}>
                <td>
                  <Input
                    key={`n-${own.name}`}
                    defaultValue={own.name}
                    aria-label={`Name von ${own.name}`}
                    onBlur={(e) => patchOwnKind(db, own.id, { name: e.target.value })}
                  />
                </td>
                <td>
                  <Input
                    key={`p-${own.plural}`}
                    defaultValue={own.plural}
                    placeholder={own.name}
                    aria-label={`Mehrzahl von ${own.name}`}
                    onBlur={(e) => patchOwnKind(db, own.id, { plural: e.target.value })}
                  />
                </td>
                <td
                  className="wf-mute"
                  title="Daran hängt, was Wayfarer mit den Einträgen anfangen kann. Um das zu ändern: eine neue Kategorie anlegen und die Einträge im Fenster „Bearbeiten“ umstellen."
                >
                  {KIND_LABEL[own.base as EntityKind] ?? own.base}
                </td>
                <td className="wf-num">{counts.get(own.id) ?? 0}</td>
                <td>
                  <IconButton
                    label={`Kategorie ${own.name} entfernen – die Einträge bleiben`}
                    size="sm"
                    variant="ghost"
                    onClick={() => remove(own.id, own.name)}
                  >
                    <Trash2 />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div>
        <div className="wf-caps" style={{ marginBottom: 'var(--s-2)' }}>
          Neue Kategorie
        </div>
        <OwnKindForm base="place" onDone={() => undefined} />
      </div>
    </div>
  );
}
