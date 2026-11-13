/**
 * Fortschritt: alle Leisten nach Besitzer – die Gruppe, die Gefährten, alle anderen. Die Rechnung
 * steht in `domain/track.ts`.
 */
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Gauge, Plus } from 'lucide-react';
import { useData } from '../../data/hooks';
import { PARTY_ID } from '../../domain/schema';
import { trackGroups } from '../../domain/track';
import { Button, EmptyState, Panel, entityHref } from '../../ui';
import { TrackCard } from './TrackCard';
import { TrackDialog } from './TrackDialog';
import './fortschritt.css';

export default function FortschrittPage() {
  const data = useData();
  const groups = useMemo(() => trackGroups(data), [data]);
  const [creating, setCreating] = useState(false);
  return (
    <div className="wf-page">
      <header className="wf-page__head">
        <h1 className="wf-page__title wf-grow">Fortschritt</h1>
        <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
          Neue Leiste
        </Button>
      </header>
      <div className="wf-page__body wf-fortschritt-body">
        {groups.length === 0 ? (
          <EmptyState icon={<Gauge />} title="Noch keine Fortschrittsleiste">
            Ausbildungswege, Ruf bei einem Haus, Schulden, Studien, Reparaturen – alles, was sich
            Schritt für Schritt bewegt. Jeder Schritt steht in der Chronik.
          </EmptyState>
        ) : (
          <div className="wf-fortschritt-groups">
            {groups.map((group) => {
              const owner =
                group.ownerId && group.ownerId !== PARTY_ID
                  ? data.entities[group.ownerId]
                  : undefined;
              return (
                <Panel
                  key={group.ownerId ?? 'ohne'}
                  title={
                    owner ? (
                      <Link href={entityHref(owner)} className="wf-fortschritt-owner">
                        {group.title}
                      </Link>
                    ) : (
                      group.title
                    )
                  }
                  count={group.tracks.length}
                  flush
                >
                  {group.tracks.map((track) => (
                    <TrackCard key={track.id} track={track} />
                  ))}
                </Panel>
              );
            })}
          </div>
        )}
      </div>
      {creating && <TrackDialog ownerId={PARTY_ID} onClose={() => setCreating(false)} />}
    </div>
  );
}
