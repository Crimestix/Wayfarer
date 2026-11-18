/**
 * Auf der Seite eines Raums: die Einrichtung der Bastion, die in ihm liegt – wem sie gehört, was
 * sie kann, wie es um sie steht. So ist der geschriebene Artikel die Seite der Einrichtung; ändern
 * lässt sie sich gleich hier (derselbe Dialog wie in der Bastion).
 */
import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { Link } from 'wouter';
import { useData } from '../../data/hooks';
import { ORDER_LABEL, STATE_LABEL, facilityInRoom } from '../../domain/bastion';
import type { Place } from '../../domain/schema';
import { Badge, Button, EntityLink } from '../../ui';
import { FacilityDialog } from './FacilityDialog';
import './bastion.css';

export function RoomFacility({ place }: { place: Place }) {
  const data = useData();
  const [editing, setEditing] = useState(false);
  const found = facilityInRoom(data, place.id);
  if (!found) return null;
  const { bastion, facility } = found;
  return (
    <section className="wf-bastion-roomnote">
      <div className="wf-bastion-roomnote__head">
        <span className="wf-caps">Einrichtung der Bastion</span>
        <Link href="/bastion" className="wf-bastion-place">
          {bastion.name}
        </Link>
        <span className="wf-grow" />
        <Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEditing(true)}>
          Ändern
        </Button>
      </div>
      <dl className="wf-bastion-roomnote__facts">
        {facility.name !== place.name && (
          <>
            <dt>Heißt</dt>
            <dd>{facility.name}</dd>
          </>
        )}
        <dt>Gehört</dt>
        <dd>{facility.ownerId ? <EntityLink id={facility.ownerId} /> : 'der Gruppe'}</dd>
        <dt>Befehle</dt>
        <dd>
          {facility.kind === 'basic'
            ? 'einfache Einrichtung – ohne Befehle'
            : facility.orders.length
              ? facility.orders.map((order) => ORDER_LABEL[order]).join(', ')
              : 'noch keine eingetragen'}
        </dd>
        {facility.hirelings && (
          <>
            <dt>Gefolgsleute</dt>
            <dd>{facility.hirelings}</dd>
          </>
        )}
        <dt>Stand</dt>
        <dd>
          {facility.state === 'ready' ? (
            STATE_LABEL.ready
          ) : (
            <Badge tone={facility.state === 'damaged' ? 'blood' : 'ember'}>
              {STATE_LABEL[facility.state]}
            </Badge>
          )}
          {facility.order &&
            ` · läuft: ${ORDER_LABEL[facility.order.name]}${facility.order.text ? ` – ${facility.order.text}` : ''}`}
        </dd>
        {facility.notes && (
          <>
            <dt>Notiz</dt>
            <dd>{facility.notes}</dd>
          </>
        )}
      </dl>
      {editing && (
        <FacilityDialog bastion={bastion} facility={facility} onClose={() => setEditing(false)} />
      )}
    </section>
  );
}
