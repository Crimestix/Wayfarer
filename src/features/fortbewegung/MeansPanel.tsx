/**
 * „Reittiere, Fahrzeuge und Schiffe“ auf der Gefährten-Seite: die Mittel der Gruppe, der
 * Gefährten und anderer – mit Tempo, Plätzen, Zustand und Unterhalt seit dem letzten Abend (nur
 * ein Hinweis, abgezogen wird nichts). „Damit reisen“ wählt, womit die Gruppe unterwegs ist;
 * Wege und Routen am Spieltisch rechnen dann mit seinem Tempo. Die Rechnung steht in
 * `domain/mounts.ts`.
 */
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Footprints, Pencil, Plus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { formatPrice } from '../../domain/shop';
import {
  MOUNT_CONDITION_LABEL,
  MOUNT_KIND_LABEL,
  meansGroups,
  paceText,
  upkeepSince,
  upkeepText,
} from '../../domain/mounts';
import { MOUNT_CONDITIONS, type Mount, type MountCondition } from '../../domain/schema';
import { useFocus } from '../../shell/focus';
import { Badge, Button, IconButton, Panel, Select, cx, entityHref } from '../../ui';
import { setMeansCondition, travelWith } from './actions';
import { MeansDialog } from './MeansDialog';
import { MeansIcon } from './parts';
import './fortbewegung.css';

const number = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 });

/** Was es kann, in wenigen Worten: „2 Meilen je Stunde · 20 Plätze · 100 Tonnen“. */
function factsOf(mount: Mount): string {
  return [
    paceText(mount),
    mount.flies && 'fliegt',
    mount.passengers !== null && `${number(mount.passengers)} Plätze`,
    mount.kind === 'ship' && mount.cargo !== null && `${number(mount.cargo)} Tonnen Ladung`,
    mount.capacity !== null && `trägt ${number(mount.capacity)} Pfund`,
    mount.crew !== null && `Besatzung ${number(mount.crew)}`,
    mount.upkeep !== null && mount.upkeep > 0 && `${formatPrice(mount.upkeep)} am Tag`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function MeansPanel() {
  const db = useDb();
  const data = useData();
  const groups = useMemo(() => meansGroups(data), [data]);
  const [editing, setEditing] = useState<Mount | 'new' | null>(null);
  useFocus(['mount'], (focus) => {
    const mount = data.mounts[focus.id];
    if (mount) setEditing(mount);
  });
  // Unterhalt zahlt die Gruppe für ihre eigenen Mittel und die der Gefährten.
  const own = groups.filter((group) => group.key !== 'others').flatMap((group) => group.mounts);
  const upkeep = upkeepText(upkeepSince(data, own));
  const by = data.state.travelBy ? data.mounts[data.state.travelBy] : undefined;

  return (
    <Panel
      title="Reittiere, Fahrzeuge und Schiffe"
      className="wf-fort-panel"
      flush
      actions={
        <Button size="sm" icon={<Plus />} onClick={() => setEditing('new')}>
          Anlegen …
        </Button>
      }
    >
      {groups.length === 0 ? (
        <p className="wf-fort-empty">
          Pferde, Kutschen und Schiffe der Gruppe und der Gefährten. Was im Laden gekauft wird,
          lässt sich beim Kauf gleich hier eintragen; am Spieltisch wählst du bei den Wegen, womit
          gereist wird.
        </p>
      ) : (
        <div className="wf-fort-list">
          {groups.map((group) => (
            <section key={group.key} className="wf-fort-group" aria-label={group.label}>
              <div className="wf-fort-group__label">{group.label}</div>
              {group.mounts.map((mount) => {
                const entity = mount.entityId ? data.entities[mount.entityId] : undefined;
                const owner = mount.ownerId ? data.entities[mount.ownerId] : undefined;
                const riding = by?.id === mount.id;
                return (
                  <div
                    key={mount.id}
                    className={cx('wf-fort-row', riding && 'wf-fort-row--riding')}
                  >
                    <span className="wf-fort-row__icon" title={MOUNT_KIND_LABEL[mount.kind]}>
                      <MeansIcon kind={mount.kind} />
                    </span>
                    <div className="wf-fort-row__main">
                      <div className="wf-fort-row__head">
                        {entity ? (
                          <Link href={entityHref(entity)} className="wf-fort-row__name">
                            {mount.name}
                          </Link>
                        ) : (
                          <span className="wf-fort-row__name">{mount.name}</span>
                        )}
                        <span className="wf-fort-row__kind">
                          {MOUNT_KIND_LABEL[mount.kind]}
                          {owner && group.key !== 'party' && ` · ${owner.name}`}
                        </span>
                      </div>
                      <div className="wf-fort-row__facts">
                        {factsOf(mount)}
                        {mount.notes.trim() && ` · ${mount.notes.trim()}`}
                      </div>
                    </div>
                    <Select
                      className={cx(
                        'wf-fort-row__condition',
                        mount.condition !== 'ready' && 'wf-fort-row__condition--off',
                      )}
                      value={mount.condition}
                      aria-label={`Zustand von ${mount.name}`}
                      onChange={(e) =>
                        setMeansCondition(db, mount.id, e.target.value as MountCondition)
                      }
                    >
                      {MOUNT_CONDITIONS.map((condition) => (
                        <option key={condition} value={condition}>
                          {MOUNT_CONDITION_LABEL[condition]}
                        </option>
                      ))}
                    </Select>
                    {riding ? (
                      <Badge tone="gold" title="Wege und Routen rechnen mit diesem Tempo">
                        Damit unterwegs
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => travelWith(db, mount.id)}
                        title="Die Gruppe reist ab jetzt damit: Wege und Routen rechnen mit seinem Tempo"
                      >
                        Damit reisen
                      </Button>
                    )}
                    <IconButton
                      label={`${mount.name} ändern`}
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(mount)}
                    >
                      <Pencil />
                    </IconButton>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
      {(by || upkeep) && (
        <div className="wf-fort-foot">
          {by ? (
            <span>
              Die Gruppe reist mit <b>{by.name}</b>.{' '}
              <button type="button" className="wf-fort-link" onClick={() => travelWith(db, null)}>
                <Footprints aria-hidden /> Zu Fuß weiter
              </button>
            </span>
          ) : (
            <span className="wf-mute">Die Gruppe reist zu Fuß.</span>
          )}
          {upkeep && <span className="wf-fort-foot__upkeep">{upkeep}</span>}
        </div>
      )}
      {editing && (
        <MeansDialog
          mount={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Panel>
  );
}
