/** Welt – die Weltdatenbank: Übersicht links, Dossier des gewählten Eintrags rechts. */
import { useEffect, useRef } from 'react';
import { Link, Redirect, useParams } from 'wouter';
import { Compass } from 'lucide-react';
import { useData } from '../../data/hooks';
import { EmptyState } from '../../ui';
import { Dossier } from './Dossier';
import { EntityDialogHost } from './EntityDialog';
import { Gallery } from './Gallery';
import { Landing } from './Landing';
import { isWorldEntity } from './model';
import { useKindFilter } from './overview';
import { Sidebar } from './Sidebar';
import './welt.css';

export default function WeltPage() {
  const data = useData();
  const { id } = useParams<{ id?: string }>();
  const entity = id ? data.entities[id] : undefined;
  const filter = useKindFilter();
  const stage = useRef<HTMLDivElement>(null);
  // Ein anderer Eintrag beginnt wieder oben.
  useEffect(() => {
    stage.current?.scrollTo(0, 0);
  }, [id]);
  if (entity?.kind === 'character') return <Redirect to={`/gruppe/${entity.id}`} />;
  const selected = isWorldEntity(entity) ? entity : undefined;
  return (
    <div className="wf-welt">
      <Sidebar selected={selected} />
      <div className="wf-welt-stage" ref={stage}>
        {selected ? (
          <Dossier key={selected.id} entity={selected} />
        ) : id ? (
          <EmptyState
            icon={<Compass />}
            title="Diesen Eintrag gibt es nicht mehr"
            action={
              <Link href="/welt" className="wf-btn">
                Zur Übersicht
              </Link>
            }
          >
            Er wurde gelöscht oder auf einem anderen Gerät entfernt.
          </EmptyState>
        ) : filter === 'person' ? (
          <Gallery />
        ) : (
          <Landing />
        )}
      </div>
      <EntityDialogHost />
    </div>
  );
}
