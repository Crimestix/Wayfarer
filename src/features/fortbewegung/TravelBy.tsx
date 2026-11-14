/**
 * Womit die Gruppe reist – ein kleiner Umschalter: zu Fuß oder eines der Mittel. Steht bei den
 * Wegen am Spieltisch (`compact`: nur das Symbol, ein Klick öffnet die Wahl), beim Weiterziehen
 * und auf der Hexkarte; ändert `state.travelBy`.
 */
import { useMemo, useRef, useState } from 'react';
import { Footprints } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { MOUNT_KIND_LABEL, meansGroups, partyMeans } from '../../domain/mounts';
import { MenuItem, Popover, Select } from '../../ui';
import { travelWith } from './actions';
import { MeansIcon, TravelIcon } from './parts';
import './fortbewegung.css';

export function TravelBy({
  label = 'Womit die Gruppe reist',
  compact = false,
}: {
  label?: string;
  compact?: boolean;
}) {
  const db = useDb();
  const data = useData();
  const groups = useMemo(() => meansGroups(data), [data]);
  const by = partyMeans(data);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!groups.length) return null;

  if (compact) {
    const pick = (id: string | null) => {
      travelWith(db, id);
      setOpen(false);
    };
    return (
      <>
        <button
          ref={anchor}
          type="button"
          className="wf-tisch-way wf-tisch-way--more wf-fort-travel__button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          title={`${label}: ${by ? by.name : 'zu Fuß'} – die Dauer der Wege folgt dem Tempo`}
        >
          <TravelIcon by={by} />
          <span className="wf-clamp-1">{by ? by.name : 'Zu Fuß'}</span>
        </button>
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          anchor={anchor}
          align="right"
          width={280}
        >
          <MenuItem icon={<Footprints />} active={!by} onClick={() => pick(null)}>
            Zu Fuß
          </MenuItem>
          {groups.map((group) => (
            <div key={group.key}>
              <div className="wf-menu-sep" />
              {group.mounts.map((mount) => (
                <MenuItem
                  key={mount.id}
                  icon={<MeansIcon kind={mount.kind} />}
                  active={by?.id === mount.id}
                  onClick={() => pick(mount.id)}
                >
                  {mount.name} · {MOUNT_KIND_LABEL[mount.kind]}
                </MenuItem>
              ))}
            </div>
          ))}
        </Popover>
      </>
    );
  }

  return (
    <span className="wf-fort-travel" title={label}>
      <TravelIcon by={by} />
      <Select
        value={by?.id ?? ''}
        aria-label={label}
        onChange={(e) => travelWith(db, e.target.value || null)}
      >
        <option value="">Zu Fuß</option>
        {groups.map((group) => (
          <optgroup key={group.key} label={group.label}>
            {group.mounts.map((mount) => (
              <option key={mount.id} value={mount.id}>
                {mount.name} ({MOUNT_KIND_LABEL[mount.kind]})
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </span>
  );
}
