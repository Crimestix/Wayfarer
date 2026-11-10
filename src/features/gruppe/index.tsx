/** Bereich „Gefährten“: Übersicht der Gruppe (/gruppe) und ein Gefährte im Ganzen (/gruppe/:id). */
import { useState } from 'react';
import { useParams } from 'wouter';
import { useData } from '../../data/hooks';
import { Detail } from './Detail';
import { EditDialog, type EditFocus } from './EditDialog';
import { Overview } from './Overview';
import './gruppe.css';

export default function GruppePage() {
  const data = useData();
  const params = useParams<{ id?: string }>();
  /** null = zu; { id: null } = neuer Gefährte. `focus` nennt das Feld, um das es beim Öffnen geht. */
  const [editing, setEditing] = useState<{ id: string | null; focus?: EditFocus } | null>(null);
  const edit = (id: string, focus?: EditFocus) => setEditing({ id, focus });
  const create = () => setEditing({ id: null });
  const target = editing?.id ? data.entities[editing.id] : undefined;

  return (
    <>
      {params.id ? (
        <Detail key={`detail-${params.id}`} id={params.id} onEdit={edit} onCreate={create} />
      ) : (
        <Overview onEdit={edit} onCreate={create} />
      )}
      {editing && (editing.id === null || target?.kind === 'character') && (
        <EditDialog
          key={`edit-${editing.id ?? 'new'}`}
          character={target?.kind === 'character' ? target : null}
          focus={editing.focus}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
