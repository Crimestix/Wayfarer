/** Kleine Bausteine rund um Fortbewegungsmittel: das Symbol je Art. */
import { Caravan, Footprints, PawPrint, Sailboat } from 'lucide-react';
import type { Mount, MountKind } from '../../domain/schema';

/** Reittier: Pfote, Fahrzeug: Wagen, Schiff: Segel. */
export function MeansIcon({ kind }: { kind: MountKind }) {
  if (kind === 'ship') return <Sailboat aria-hidden />;
  if (kind === 'vehicle') return <Caravan aria-hidden />;
  return <PawPrint aria-hidden />;
}

/** Womit gereist wird: das Symbol des Mittels, zu Fuß die Fußspuren. */
export function TravelIcon({ by }: { by: Mount | null }) {
  return by ? <MeansIcon kind={by.kind} /> : <Footprints aria-hidden />;
}
