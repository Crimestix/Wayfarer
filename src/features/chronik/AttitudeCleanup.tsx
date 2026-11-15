/**
 * Aufräumen: Einträge, die eine Haltung nur festgelegt haben („keine“ → eine Haltung, ohne
 * Grund, der erste zu diesem Paar), aus der Chronik nehmen. Die Haltung bleibt, wie sie ist.
 * Nichts geschieht von selbst – der Spielleiter kreuzt an.
 */
import { useMemo, useState } from 'react';
import { dropAttitudeSettings } from '../../data/actions';
import { useData, useDb } from '../../data/hooks';
import { attitudeSettings } from '../../domain/attitudeSetting';
import { entityName } from '../../domain/derive';
import { attitudeLabel } from '../../domain/relations';
import { formatDate } from '../../domain/time/calendar';
import { Button, Checkbox, Dialog, toast } from '../../ui';

export function AttitudeCleanupDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const data = useData();
  const [entries] = useState(() => attitudeSettings(data));
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const ids = useMemo(
    () => entries.map((e) => e.id).filter((id) => chosen.has(id)),
    [entries, chosen],
  );
  const toggle = (id: string, on: boolean) =>
    setChosen((set) => {
      const next = new Set(set);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const all = ids.length === entries.length;
  const drop = () => {
    const undo = dropAttitudeSettings(db, ids);
    toast({
      title:
        ids.length === 1
          ? 'Ein Eintrag aus der Chronik genommen'
          : `${ids.length} Einträge aus der Chronik genommen`,
      body:
        ids.length === 1
          ? 'Die Haltung bleibt, wie sie ist.'
          : 'Die Haltungen bleiben, wie sie sind.',
      action: { label: 'Rückgängig', run: undo },
    });
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Festgelegte Haltungen aufräumen"
      width={600}
      footer={
        <>
          <Button
            onClick={() => setChosen(all ? new Set() : new Set(entries.map((e) => e.id)))}
            disabled={entries.length === 0}
          >
            {all ? 'Keine wählen' : 'Alle wählen'}
          </Button>
          <span className="wf-grow" />
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" onClick={drop} disabled={ids.length === 0}>
            Aus der Chronik nehmen{ids.length > 0 ? ` (${ids.length})` : ''}
          </Button>
        </>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-3)' }}>
        <p className="wf-mute" style={{ margin: 0 }}>
          Diese Einträge haben eine Haltung zum ersten Mal festgelegt, ohne Grund. Was du ankreuzt,
          verschwindet aus der Chronik – die Haltung bleibt und gilt dann schon immer.
        </p>
        {entries.length === 0 ? (
          <p style={{ margin: 0 }}>Es gibt nichts aufzuräumen.</p>
        ) : (
          <div className="wf-chronik-cleanup">
            {entries.map((entry) => {
              const a = entry.attitude!;
              return (
                <Checkbox
                  key={entry.id}
                  checked={chosen.has(entry.id)}
                  onChange={(on) => toggle(entry.id, on)}
                >
                  <span className="wf-chronik-cleanup__line">
                    <span className="wf-display">{entityName(data, a.fromId)}</span>
                    {' → '}
                    {entityName(data, a.toId)}: {attitudeLabel(a.after)}
                    <span className="wf-mute">
                      {' · '}
                      {formatDate(data.campaign.calendar, entry.at)}
                    </span>
                  </span>
                </Checkbox>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}
