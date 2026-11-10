/** Zeitstrahl: Tagesüberschriften, Einträge und Session-Grenzen. Lädt beim Rollen portionsweise nach. */
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useData } from '../../data/hooks';
import type { ChronicleEntry } from '../../domain/schema';
import {
  MINUTES_PER_DAY,
  dayIndexOf,
  formatDate,
  formatDateTime,
  formatDayMonth,
  weekdayName,
} from '../../domain/time/calendar';
import { Button, ChronicleItem, MoonGlyph } from '../../ui';
import { Caps } from './parts';
import {
  formatRealDate,
  relativeDay,
  sessionTitle,
  type SessionMarker,
  type TimelineRow,
} from './model';

/** So viele Zeilen erscheinen zuerst und kommen je Nachladen dazu. */
export const TIMELINE_PAGE = 120;
const PAGE = TIMELINE_PAGE;

/** Ein Eintrag, der beim Nachladen weiterer Einträge nicht neu gezeichnet wird. */
const Entry = memo(function Entry({
  entry,
  onEdit,
}: {
  entry: ChronicleEntry;
  onEdit: (entry: ChronicleEntry) => void;
}) {
  return <ChronicleItem entry={entry} onEdit={onEdit} />;
});

const DayHeader = memo(function DayHeader({ day, count }: { day: number; count: number }) {
  const data = useData();
  const cal = data.campaign.calendar;
  const time = day * MINUTES_PER_DAY;
  const today = dayIndexOf(data.state.now);
  return (
    <header className="wf-chronik-day" data-today={day === today || undefined}>
      <span className="wf-chronik-day__date">{formatDate(cal, time)}</span>
      <span className="wf-chronik-day__weekday">{weekdayName(cal, time)}</span>
      {cal.moons.length > 0 && (
        <span className="wf-chronik-day__moons">
          {cal.moons.map((moon) => (
            <MoonGlyph key={moon.id} moon={moon} time={time + MINUTES_PER_DAY / 2} size={15} />
          ))}
        </span>
      )}
      <span className="wf-grow" />
      <span className="wf-chronik-day__rel">
        <Caps>{relativeDay(today, day)}</Caps>
      </span>
      <span
        className="wf-chronik-day__count wf-num"
        title={count === 1 ? '1 Eintrag' : `${count} Einträge`}
      >
        {count}
      </span>
    </header>
  );
});

function Marker({
  marker,
  dated,
  onOpen,
}: {
  marker: SessionMarker;
  /** Das Datum der Grenze dazuschreiben, weil sie nicht bei Einträgen ihres Tages steht. */
  dated: boolean;
  onOpen?: (sessionId: string) => void;
}) {
  const cal = useData().campaign.calendar;
  const { session, edge, at } = marker;
  const title = sessionTitle(session);
  const detail = [
    dated && `am ${formatDayMonth(cal, at)}`,
    title && `„${title}“`,
    edge === 'start' && session.realDate && formatRealDate(session.realDate),
  ]
    .filter(Boolean)
    .join(' · ');
  const label = `Session ${session.number} ${edge === 'start' ? 'beginnt' : 'endet'}`;
  const when = formatDateTime(cal, at);
  const body = (
    <>
      <span className="wf-chronik-marker__label">
        <Caps>{label}</Caps>
      </span>
      {detail && <span className="wf-chronik-marker__detail">{detail}</span>}
    </>
  );
  return onOpen ? (
    <button
      type="button"
      className="wf-chronik-marker"
      data-edge={edge}
      onClick={() => onOpen(session.id)}
      title={`${when} – diese Session öffnen`}
    >
      {body}
    </button>
  ) : (
    <div className="wf-chronik-marker" data-edge={edge} title={when}>
      {body}
    </div>
  );
}

export function Timeline({
  rows,
  onEdit,
  onOpenSession,
  stickyDays = true,
  initialLimit = PAGE,
  onLimit,
}: {
  rows: TimelineRow[];
  onEdit: (entry: ChronicleEntry) => void;
  onOpenSession?: (sessionId: string) => void;
  /** Tagesüberschriften bleiben beim Rollen oben stehen. */
  stickyDays?: boolean;
  /** So viele Zeilen sofort zeigen – um eine frühere Rollposition wiederherzustellen. */
  initialLimit?: number;
  /** Meldet, wie viele Zeilen gerade geladen sind. */
  onLimit?: (limit: number) => void;
}) {
  const [limit, setLimit] = useState(Math.max(PAGE, initialLimit));
  useEffect(() => onLimit?.(limit), [limit, onLimit]);
  const sentinel = useRef<HTMLDivElement>(null);
  const more = rows.length > limit;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const observer = new IntersectionObserver((hits) => {
      if (hits.some((hit) => hit.isIntersecting)) setLimit((n) => n + PAGE);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [more, limit]);

  const blocks = useMemo(() => {
    let shown = rows.slice(0, limit);
    // Keine Tagesüberschrift ohne ihre Einträge am Ende stehen lassen.
    while (shown.length && shown[shown.length - 1]!.type === 'day') shown = shown.slice(0, -1);
    const out: ReactNode[] = [];
    let run: ChronicleEntry[] = [];
    const flush = () => {
      if (!run.length) return;
      out.push(
        <div key={`e-${run[0]!.id}`} className="wf-chron-list">
          {run.map((entry) => (
            <Entry key={entry.id} entry={entry} onEdit={onEdit} />
          ))}
        </div>,
      );
      run = [];
    };
    for (const row of shown) {
      if (row.type === 'entry') {
        run.push(row.entry);
        continue;
      }
      flush();
      if (row.type === 'day')
        out.push(<DayHeader key={`d-${row.day}`} day={row.day} count={row.count} />);
      else
        out.push(
          <Marker
            key={`m-${row.session.id}-${row.edge}`}
            marker={row}
            dated={row.dated}
            onOpen={onOpenSession}
          />,
        );
    }
    flush();
    return out;
  }, [rows, limit, onEdit, onOpenSession]);

  const remaining = rows.slice(limit).filter((row) => row.type === 'entry').length;
  return (
    <div className="wf-chronik-timeline" data-sticky={stickyDays || undefined}>
      {blocks}
      {more && (
        <div className="wf-chronik-more">
          <div ref={sentinel} className="wf-chronik-more__sentinel" aria-hidden />
          <Button size="sm" variant="ghost" onClick={() => setLimit((n) => n + PAGE)}>
            Weitere Einträge zeigen ({remaining.toLocaleString('de-DE')})
          </Button>
        </div>
      )}
    </div>
  );
}
