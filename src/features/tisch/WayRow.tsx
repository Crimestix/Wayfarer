/**
 * „Wege“: die Verbindungen, die vom Ort der Gruppe abgehen – das Wegenetz zum Durchklicken. Ein
 * Klick geht den Weg: Die Zeit vergeht, die Gruppe kommt an. Womit gereist wird (zu Fuß, Pferd,
 * Schiff), wählt der Umschalter am Ende; die Dauer folgt dem Mittel. Die Rechnung steht in
 * `domain/ways.ts` und `domain/mounts.ts`.
 */
import { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  CloudRain,
  Compass,
  EyeOff,
  Lock,
  Pencil,
  Plus,
  Snowflake,
  TriangleAlert,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { marchAfter, marchRule } from '../../domain/march';
import { partyTravel, travelNotes } from '../../domain/mounts';
import type { TravelPath } from '../../domain/schema';
import { formatWayTime, wayNotes, waysAround, type Way } from '../../domain/ways';
import { openMoveParty } from '../../shell/commands';
import { walkAndReport } from '../../shell/dialogs';
import { MenuItem, Popover } from '../../ui';
import { TravelIcon } from '../fortbewegung/parts';
import { TravelBy } from '../fortbewegung/TravelBy';
import { walk } from '../wege/actions';
import { WayDialog } from '../wege/WayDialog';
import { JourneyDialog } from '../reise/JourneyDialog';

/** Auf dem Weg wartet etwas, das der Spielleiter vorbereitet hat (Wegenetz). */
const prepared = (way: Way) => way.path.onTheWay.trim() !== '' || way.path.encounterId !== null;

/** So viele Wege stehen als Knopf in der Zeile; der Rest hinter „Wege …“. */
const SHOWN = 5;

export function WayRow({ placeId }: { placeId: string }) {
  const db = useDb();
  const data = useData();
  const travel = useMemo(() => partyTravel(data), [data]);
  const around = useMemo(() => waysAround(data, placeId, travel), [data, placeId, travel]);
  const more = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TravelPath | 'new' | null>(null);
  const [journey, setJourney] = useState(false);
  const origin = around?.origin ?? null;
  /** Von wo ein Weg abgeht, wenn nicht vom Ort der Wege selbst: „ab Hohenfurt“. */
  const startOf = new Map((around?.above?.ways ?? []).map((way) => [way, around!.above!.origin]));
  const ways = [...(around?.ways ?? []), ...startOf.keys()];
  const elsewhere = origin !== null && origin.id !== placeId;

  const go = (way: Way) => {
    // Eine verschlossene Tür – oder es wartet etwas Vorbereitetes: nicht still hindurchgehen,
    // sondern erst zeigen, was auf dem Weg ist.
    if (way.barred || prepared(way)) {
      openMoveParty({ placeId: way.toId });
      return;
    }
    const name = way.path.name ? `über ${way.path.name}` : '';
    const note = [
      name,
      way.by ? `mit ${way.by.name}` : '',
      way.minutes ? formatWayTime(way.minutes) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    walkAndReport(db, () => walk(db, way.toId, way.minutes ?? 0, note));
  };
  const label = (way: Way) => data.entities[way.toId]?.name ?? 'Unbekannter Ort';
  const hint = (way: Way) =>
    [
      `${label(way)}${way.path.name ? ` – über ${way.path.name}` : ''}${
        startOf.has(way) ? ` (ab ${startOf.get(way)!.name})` : ''
      }`,
      way.barred
        ? 'Der Weg ist gerade nicht passierbar.'
        : way.minutes === null
          ? 'Dauer unbekannt: Die Zeit bleibt stehen.'
          : way.by
            ? `Die Gruppe reist mit ${way.by.name}: ${formatWayTime(way.minutes)} vergehen.`
            : `Die Gruppe geht los: ${formatWayTime(way.minutes)} vergehen.`,
      way.fit ? `${way.fit}.` : '',
      way.minutes && marchAfter(data, way.minutes) ? marchRule(marchAfter(data, way.minutes)!) : '',
      ...(way.by ? travelNotes(travel, way.minutes ?? 0).map((note) => `${note}.`) : []),
      way.path.conditions,
      ...wayNotes(data, way).map((note) => `${note}.`),
      way.path.secret ? 'Die Gruppe kennt diesen Weg noch nicht.' : '',
    ]
      .filter(Boolean)
      .join('\n');

  return (
    <>
      <nav className="wf-tisch-ways wf-tisch-ways--paths" aria-label="Wege von hier">
        <span className="wf-tisch-ways__label">
          {elsewhere ? `Wege ab ${origin.name}` : 'Wege'}
        </span>
        <div className="wf-tisch-ways__row">
          {ways.slice(0, SHOWN).map((way) => (
            <button
              key={`${way.path.id}-${way.toId}`}
              type="button"
              className="wf-tisch-way wf-tisch-way--path"
              onClick={() => go(way)}
              title={hint(way)}
            >
              <TravelIcon by={way.by} />
              <span className="wf-clamp-1">{label(way)}</span>
              <span className="wf-tisch-way__time">
                {way.minutes === null ? '?' : formatWayTime(way.minutes)}
              </span>
              {way.barred && way.weather?.state !== 'lost' && (
                <Lock className="wf-tisch-way__flag" aria-hidden />
              )}
              {way.weather?.state === 'snowed' && (
                <Snowflake className="wf-tisch-way__flag" aria-hidden />
              )}
              {(way.weather?.state === 'muddy' || way.weather?.state === 'lost') && (
                <CloudRain className="wf-tisch-way__flag" aria-hidden />
              )}
              {(way.path.conditions ||
                way.fit ||
                prepared(way) ||
                way.signs.some((sign) => sign.kind === 'trap' && sign.armed)) && (
                <TriangleAlert className="wf-tisch-way__flag" aria-hidden />
              )}
              {way.path.secret && <EyeOff className="wf-tisch-way__flag" aria-hidden />}
            </button>
          ))}
          {ways.length === 0 && (
            <span className="wf-tisch-ways__none">
              Noch keine Wege. Sie entstehen von selbst, wenn die Gruppe weiterzieht und du die
              Dauer angibst.
            </span>
          )}
          <button
            ref={more}
            type="button"
            className="wf-tisch-way wf-tisch-way--more"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            title="Alle Wege: losgehen, ändern, neu anlegen"
          >
            {ways.length > SHOWN ? `+ ${ways.length - SHOWN} weitere` : 'Wege …'}
            <ChevronDown />
          </button>
          <button
            type="button"
            className="wf-tisch-way wf-tisch-way--more"
            onClick={() => setJourney(true)}
            title="Eine längere Reise Tag für Tag: am Spieltisch weiter bis zur nächsten Entscheidung"
          >
            <Compass aria-hidden />
            Reise …
          </button>
          <TravelBy compact />
        </div>
      </nav>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchor={more}
        align="right"
        width={360}
        className="wf-tisch-waymenu"
      >
        {ways.length > 0 && <div className="wf-tisch-suggest__head">Losgehen</div>}
        {ways.map((way) => (
          <MenuItem
            key={`go-${way.path.id}-${way.toId}`}
            icon={<TravelIcon by={way.by} />}
            onClick={() => {
              setOpen(false);
              go(way);
            }}
          >
            {label(way)} · {way.minutes === null ? 'Dauer offen' : formatWayTime(way.minutes)}
          </MenuItem>
        ))}
        {ways.length > 0 && <div className="wf-menu-sep" />}
        {ways.length > 0 && <div className="wf-tisch-suggest__head">Weg ändern</div>}
        {ways.map((way) => (
          <MenuItem
            key={`${way.path.id}-${way.toId}`}
            icon={<Pencil />}
            onClick={() => {
              setOpen(false);
              setEditing(way.path);
            }}
          >
            {label(way)} · {way.minutes === null ? 'Dauer offen' : formatWayTime(way.minutes)}
          </MenuItem>
        ))}
        {ways.length > 0 && <div className="wf-menu-sep" />}
        <MenuItem
          icon={<Plus />}
          onClick={() => {
            setOpen(false);
            setEditing('new');
          }}
        >
          Neuen Weg anlegen …
        </MenuItem>
      </Popover>
      {journey && <JourneyDialog onClose={() => setJourney(false)} />}
      {editing && (
        <WayDialog
          way={editing === 'new' ? undefined : editing}
          fromId={origin?.id ?? placeId}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
