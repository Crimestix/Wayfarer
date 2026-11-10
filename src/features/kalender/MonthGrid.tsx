/** Monatsraster: Wochentags-Spalten, je Tag Zahl, Monde, Chronik-Zeichen und Terminbalken. */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Feather, Footprints, Repeat } from 'lucide-react';
import { entityName } from '../../domain/derive';
import type { CalendarEvent, CampaignData } from '../../domain/schema';
import { dayIndexOf, formatClock, formatDate, weekdayOfDay } from '../../domain/time/calendar';
import { MoonGlyph, Panel, cx } from '../../ui';
import {
  EVENT_DONE_LABEL,
  EVENT_KIND_LABEL,
  chronicleMarks,
  describeRepeat,
  layoutWeek,
  moonEventsBetween,
  spanState,
  spansOnDay,
  type DayCell,
  type DaySpan,
  type MonthGrid as MonthGridModel,
  type SpanState,
  type WeekSegment,
} from './model';

const TOP_HEIGHT = 27;
const LANE_HEIGHT = 20;

export interface MonthGridProps {
  data: CampaignData;
  grid: MonthGridModel;
  spans: DaySpan[];
  selected: number;
  onSelect: (dayIndex: number) => void;
  /** Doppelklick oder Eingabetaste: neuer Termin an diesem Tag. */
  onCreate: (dayIndex: number) => void;
  /** Doppelklick auf einen Terminbalken: diesen Termin bearbeiten. */
  onEdit: (event: CalendarEvent) => void;
  /** Blättern mit Bild auf / Bild ab. */
  onShiftMonth: (offset: number) => void;
}

export function MonthGrid({
  data,
  grid,
  spans,
  selected,
  onSelect,
  onCreate,
  onEdit,
  onShiftMonth,
}: MonthGridProps) {
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const today = dayIndexOf(now);
  const width = cal.weekdays.length;
  const weeksRef = useRef<HTMLDivElement>(null);
  const [lanes, setLanes] = useState(2);

  // So viele Terminzeilen, wie in die Höhe einer Woche passen.
  useLayoutEffect(() => {
    const el = weeksRef.current;
    if (!el) return;
    const measure = () => {
      const row = el.clientHeight / Math.max(1, grid.weeks.length);
      setLanes(Math.max(2, Math.min(8, Math.floor((row - TOP_HEIGHT - 2) / LANE_HEIGHT))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [grid.weeks.length]);

  const marks = useMemo(() => chronicleMarks(data, grid.firstDay, grid.lastDay), [data, grid]);
  const moons = useMemo(() => moonEventsBetween(cal, grid.firstDay, grid.lastDay), [cal, grid]);
  const layouts = useMemo(
    () => grid.weeks.map((_, row) => layoutWeek(spans, grid.firstDay + row * width, width, lanes)),
    [grid, spans, width, lanes],
  );

  // Nach Pfeiltasten wandert der Fokus mit dem gewählten Tag.
  const moveFocus = useRef(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    weeksRef.current?.querySelector<HTMLElement>(`[data-day="${selected}"]`)?.focus();
  }, [selected, grid]);

  const onKeyDown = (e: KeyboardEvent, cell: DayCell) => {
    const step =
      e.key === 'ArrowLeft'
        ? -1
        : e.key === 'ArrowRight'
          ? 1
          : e.key === 'ArrowUp'
            ? -width
            : e.key === 'ArrowDown'
              ? width
              : 0;
    if (step) {
      e.preventDefault();
      if (cell.dayIndex + step < 0) return;
      moveFocus.current = true;
      onSelect(cell.dayIndex + step);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      onShiftMonth(e.key === 'PageUp' ? -1 : 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onCreate(cell.dayIndex);
    } else if (e.key === ' ') {
      e.preventDefault();
      onSelect(cell.dayIndex);
    }
  };

  /** Der Tag unter dem Mauszeiger – ein Balken kann über mehrere Tage laufen. */
  const dayUnderPointer = (e: MouseEvent<HTMLElement>, weekStart: number, seg: WeekSegment) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const part = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
    return weekStart + seg.col + Math.min(seg.length - 1, Math.max(0, Math.floor(part * seg.length)));
  };
  /** Kurzinfo eines Balkens: voller Titel, Art, Stand, Zeit und Ort. */
  const barTitle = (span: DaySpan, state: SpanState) => {
    const { event } = span;
    const length = span.endDay - span.startDay + 1;
    const facts = [
      EVENT_KIND_LABEL[event.kind],
      state === 'done' ? EVENT_DONE_LABEL[event.kind].toLowerCase() : '',
      state === 'overdue' ? 'überfällig' : '',
      event.timed ? `${formatClock(span.at)} Uhr` : '',
      length > 1 ? `${length} Tage` : '',
      event.repeat ? describeRepeat(event.repeat) : '',
      event.placeId ? entityName(data, event.placeId) : '',
    ].filter(Boolean);
    return `${event.title}\n${facts.join(' · ')}\nDoppelklick öffnet den Termin.`;
  };

  const selectedInGrid = selected >= grid.firstDay && selected <= grid.lastDay;
  const todayColumn =
    today >= grid.firstDay && today <= grid.lastDay ? weekdayOfDay(cal, today) : -1;
  const vars = { '--kal-cols': width, '--kal-lanes': lanes } as CSSProperties;

  return (
    <Panel className="wf-kal-grid" flush style={vars}>
      <div className="wf-kal-cols wf-kal-weekdays" aria-hidden="true">
        {cal.weekdays.map((name, i) => (
          <span key={i} data-today={i === todayColumn} title={name}>
            <i>{name}</i>
          </span>
        ))}
      </div>
      <div className="wf-kal-weeks" ref={weeksRef} role="grid" aria-label="Monatsübersicht">
        {grid.weeks.map((week, row) => (
          <div key={row} className="wf-kal-cols wf-kal-week" role="row">
            {week.map((cell, col) => {
              const last = col === width - 1;
              if (!cell)
                return (
                  <div
                    key={col}
                    className={cx('wf-kal-day wf-kal-day--void', last && 'wf-kal-day--last')}
                    style={{ gridColumn: col + 1 }}
                  />
                );
              const mark = marks.get(cell.dayIndex);
              const moonEvents = moons.get(cell.dayIndex) ?? [];
              const majors = moonEvents.filter((m) => m.quarter % 2 === 0).length;
              const isSelected = cell.dayIndex === selected;
              const count = spansOnDay(spans, cell.dayIndex).length;
              return (
                <div
                  key={col}
                  role="gridcell"
                  data-day={cell.dayIndex}
                  tabIndex={
                    isSelected || (!selectedInGrid && cell.inMonth && cell.day === 1) ? 0 : -1
                  }
                  aria-selected={isSelected}
                  aria-current={cell.dayIndex === today ? 'date' : undefined}
                  aria-label={`${cal.weekdays[cell.weekday]}, ${formatDate(cal, cell.time)}${
                    count ? `, ${count === 1 ? '1 Termin' : `${count} Termine`}` : ''
                  }`}
                  className={cx(
                    'wf-kal-day',
                    last && 'wf-kal-day--last',
                    !cell.inMonth && 'wf-kal-day--out',
                    cell.dayIndex < today && 'wf-kal-day--past',
                    cell.dayIndex === today && 'wf-kal-day--today',
                    isSelected && 'wf-kal-day--selected',
                  )}
                  style={{ gridColumn: col + 1 }}
                  onClick={() => onSelect(cell.dayIndex)}
                  onDoubleClick={() => onCreate(cell.dayIndex)}
                  onKeyDown={(e) => onKeyDown(e, cell)}
                >
                  <div className="wf-kal-day__top">
                    <span className="wf-kal-day__num">{cell.day}</span>
                    {!cell.inMonth && cell.day === 1 && (
                      <span className="wf-kal-day__month">{cal.months[cell.month]!.name}</span>
                    )}
                    {mark && (
                      <span className="wf-kal-day__marks">
                        {mark.travels.length > 0 && (
                          <span
                            className="wf-kal-mark--travel"
                            title={mark.travels
                              .map((t) =>
                                t.travel?.toId
                                  ? `Die Gruppe erreicht ${entityName(data, t.travel.toId)}`
                                  : `Die Gruppe verlässt ${entityName(data, t.travel?.fromId)}`,
                              )
                              .join('\n')}
                          >
                            <Footprints aria-label="Ortswechsel der Gruppe" />
                          </span>
                        )}
                        {mark.entries > 0 && (
                          <span
                            title={
                              mark.entries === 1
                                ? '1 Eintrag in der Chronik'
                                : `${mark.entries} Einträge in der Chronik`
                            }
                          >
                            <Feather aria-label="Einträge in der Chronik" />
                          </span>
                        )}
                      </span>
                    )}
                    {moonEvents.length > 0 && (
                      <span className="wf-kal-day__moons">
                        {moonEvents.map((m) => {
                          const major = m.quarter % 2 === 0;
                          return (
                            <span
                              key={m.moon.id + m.quarter}
                              className={cx('wf-kal-moon', major && 'wf-kal-moon--major')}
                              title={`${m.moon.name}: ${m.label}, ${formatClock(m.at)}`}
                            >
                              <MoonGlyph moon={m.moon} time={m.at} size={major ? 15 : 11} />
                              {major && majors === 1 && (
                                <span className="wf-kal-moon__name">
                                  {m.moon.name.slice(0, 1)}
                                  <span>{m.moon.name.slice(1)}</span>
                                </span>
                              )}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {layouts[row]!.segments.map((seg) => {
              const { event } = seg.span;
              const state = spanState(seg.span, now);
              const weekStart = grid.firstDay + row * width;
              return (
                <div
                  key={event.id + seg.span.at}
                  className={cx(
                    'wf-kal-bar',
                    `wf-kal-kind--${event.kind}`,
                    state !== 'open' && `wf-kal-bar--${state}`,
                    seg.continuesBefore && 'wf-kal-bar--from-before',
                    seg.continuesAfter && 'wf-kal-bar--to-after',
                    seg.tall && 'wf-kal-bar--tall',
                  )}
                  style={{
                    gridColumn: `${seg.col + 1} / span ${seg.length}`,
                    gridRow: seg.tall ? `${seg.lane + 2} / span 2` : seg.lane + 2,
                  }}
                  title={barTitle(seg.span, state)}
                  onClick={(e) => onSelect(dayUnderPointer(e, weekStart, seg))}
                  onDoubleClick={() => onEdit(event)}
                  aria-hidden="true"
                >
                  {event.timed && !seg.continuesBefore && (
                    <span className="wf-kal-bar__time">{formatClock(seg.span.at)}</span>
                  )}
                  <span className="wf-kal-bar__title">{event.title}</span>
                  {event.repeat && <Repeat />}
                </div>
              );
            })}
            {layouts[row]!.hidden.map(
              (n, col) =>
                n > 0 && (
                  <div
                    key={'more' + col}
                    className="wf-kal-more"
                    style={{ gridColumn: col + 1, gridRow: lanes + 1 }}
                    title="Alle Termine dieses Tages zeigen"
                    onClick={() => onSelect(grid.firstDay + row * width + col)}
                    aria-hidden="true"
                  >
                    + {n} {n === 1 ? 'weiterer' : 'weitere'}
                  </div>
                ),
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
