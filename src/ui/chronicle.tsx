/** Darstellung von Chronik-Einträgen – überall gleich: am Spieltisch, in der Chronik, im Dossier. */
import type { ReactNode } from 'react';
import { ArrowRight, Check, Feather, Footprints, Handshake, Hourglass, Pencil, Sparkles, Waypoints } from 'lucide-react';
import { setPromiseDone } from '../data/actions';
import { useData, useDb } from '../data/hooks';
import type { ChronicleEntry, ChronicleKind } from '../domain/schema';
import { formatClock, formatDate, formatDayMonth, formatRelative } from '../domain/time/calendar';
import { IconButton, cx } from './components';
import { AttitudeBadge, EntityLink } from './entity';
import './chronicle.css';

export const CHRONICLE_KIND_LABEL: Record<ChronicleKind, string> = {
  note: 'Notiz',
  travel: 'Ortswechsel',
  attitude: 'Haltung',
  event: 'Termin eingetreten',
  promise: 'Abmachung',
  change: 'Veränderung',
};

const ICONS: Record<ChronicleKind, typeof Feather> = {
  note: Feather,
  travel: Footprints,
  attitude: Waypoints,
  event: Hourglass,
  promise: Handshake,
  change: Sparkles,
};

export interface ChronicleItemProps {
  entry: ChronicleEntry;
  /** Datum zusätzlich zur Uhrzeit zeigen (wenn die Liste nicht nach Tagen gruppiert ist). */
  showDate?: boolean;
  /** Verweise, die nicht wiederholt werden sollen – z. B. der Eintrag, auf dessen Seite man ist. */
  hideRefs?: string[];
  /** Zeigt einen Stift zum Bearbeiten. */
  onEdit?: (entry: ChronicleEntry) => void;
}

export function ChronicleItem({ entry, showDate, hideRefs = [], onEdit }: ChronicleItemProps) {
  const db = useDb();
  const data = useData();
  const cal = data.campaign.calendar;
  const Icon = ICONS[entry.kind];
  const refs = entry.refs.filter(
    (id) =>
      !hideRefs.includes(id) &&
      id !== entry.placeId &&
      !(entry.attitude && (id === entry.attitude.fromId || id === entry.attitude.toId)) &&
      !(entry.travel && (id === entry.travel.fromId || id === entry.travel.toId)),
  );
  const showPlace = entry.placeId && !hideRefs.includes(entry.placeId) && entry.kind !== 'travel';

  let headline: ReactNode = null;
  if (entry.kind === 'travel' && entry.travel) {
    headline = entry.travel.toId ? (
      <>
        Die Gruppe erreicht <EntityLink id={entry.travel.toId} icon={false} />
        {entry.travel.fromId && (
          <span className="wf-mute">
            {' '}
            · von <EntityLink id={entry.travel.fromId} icon={false} />
          </span>
        )}
      </>
    ) : (
      <>
        Die Gruppe verlässt <EntityLink id={entry.travel.fromId} icon={false} />
      </>
    );
  } else if (entry.kind === 'attitude' && entry.attitude) {
    headline = (
      <span className="wf-row-wrap" style={{ gap: 8 }}>
        <EntityLink id={entry.attitude.fromId} icon={false} />
        <span className="wf-mute">gegenüber</span>
        <EntityLink id={entry.attitude.toId} icon={false} />
        <AttitudeBadge value={entry.attitude.before} />
        <ArrowRight width={14} height={14} className="wf-mute" />
        <AttitudeBadge value={entry.attitude.after} />
      </span>
    );
  } else if (entry.kind === 'event') {
    headline = <span className="wf-chron__event">{entry.text}</span>;
  }

  const promise = entry.kind === 'promise' ? entry.promise : null;
  const overdue = promise && !promise.done && promise.due !== null && promise.due < data.state.now;

  return (
    <article className={cx('wf-chron', `wf-chron--${entry.kind}`, promise?.done && 'wf-chron--done')}>
      <div className="wf-chron__mark" title={CHRONICLE_KIND_LABEL[entry.kind]}>
        <Icon />
      </div>
      <div className="wf-chron__body">
        <div className="wf-chron__meta">
          {showDate && <span>{formatDate(cal, entry.at)}</span>}
          <span className="wf-num">{formatClock(entry.at)}</span>
          {entry.kind !== 'note' && <span>{CHRONICLE_KIND_LABEL[entry.kind]}</span>}
          {showPlace && (
            <span>
              <EntityLink id={entry.placeId} icon={false} />
            </span>
          )}
        </div>
        {headline && <div className="wf-chron__headline">{headline}</div>}
        {entry.text && entry.kind !== 'event' && <div className="wf-chron__text wf-prose">{entry.text}</div>}
        {promise && (
          <div className="wf-chron__promise">
            <button
              type="button"
              className="wf-chron__check"
              aria-pressed={promise.done}
              onClick={() => setPromiseDone(db, entry.id, !promise.done)}
            >
              {promise.done && <Check />}
            </button>
            <span className={overdue ? 'wf-chron__overdue' : 'wf-mute'}>
              {promise.done
                ? 'Erledigt'
                : promise.due === null
                  ? 'Offen, ohne Frist'
                  : `Frist: ${formatDayMonth(cal, promise.due)} (${formatRelative(data.state.now, promise.due)})`}
            </span>
          </div>
        )}
        {refs.length > 0 && (
          <div className="wf-chron__refs">
            {refs.map((id) => (
              <EntityLink key={id} id={id} />
            ))}
          </div>
        )}
      </div>
      {onEdit && (
        <IconButton label="Eintrag bearbeiten" size="sm" variant="ghost" className="wf-chron__edit" onClick={() => onEdit(entry)}>
          <Pencil />
        </IconButton>
      )}
    </article>
  );
}

/** Mehrere Einträge untereinander. `newestFirst` dreht die Reihenfolge um. */
export function ChronicleList({
  entries,
  newestFirst,
  empty,
  ...item
}: {
  entries: ChronicleEntry[];
  newestFirst?: boolean;
  /** Was erscheint, wenn es keine Einträge gibt. */
  empty?: ReactNode;
} & Omit<ChronicleItemProps, 'entry'>) {
  if (!entries.length) return <>{empty ?? null}</>;
  const list = newestFirst ? [...entries].reverse() : entries;
  return (
    <div className="wf-chron-list">
      {list.map((entry) => (
        <ChronicleItem key={entry.id} entry={entry} {...item} />
      ))}
    </div>
  );
}
