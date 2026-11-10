/** Kalender: Monatsraster, gewählter Tag, Anstehendes, laufende Wirkungen und Monde. */
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useData } from '../../data/hooks';
import { EVENT_KINDS, type CalendarEvent, type Timer } from '../../domain/schema';
import {
  MINUTES_PER_DAY,
  dayIndexOf,
  formatYear,
  fromTime,
  shiftMonth,
  type WorldTime,
} from '../../domain/time/calendar';
import { Button, IconButton, cx } from '../../ui';
import { DayPanel } from './DayPanel';
import { EventDialog } from './EventDialog';
import { MonthGrid } from './MonthGrid';
import { TimerDialog } from './TimerDialog';
import { EVENT_KIND_HINT, EVENT_KIND_LABEL, monthGrid, spansBetween } from './model';
import { MoonsPanel, TimersPanel, UpcomingPanel } from './panels';
import './kalender.css';

type OpenDialog =
  | { type: 'event'; event: CalendarEvent | null; day: WorldTime }
  | { type: 'timer'; timer: Timer | null }
  | null;

export default function KalenderPage() {
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const today = dayIndexOf(now);

  const [selected, setSelected] = useState(today);
  const [view, setView] = useState(() => {
    const d = fromTime(cal, now);
    return { year: d.year, month: d.month };
  });
  const [dialog, setDialog] = useState<OpenDialog>(null);

  // Vergeht die Zeit über Mitternacht, wandert die Auswahl mit – sofern sie auf „heute“ stand.
  const [seenToday, setSeenToday] = useState(today);
  if (seenToday !== today) {
    setSeenToday(today);
    if (today > seenToday && selected === seenToday) {
      const was = fromTime(cal, seenToday * MINUTES_PER_DAY);
      const d = fromTime(cal, now);
      setSelected(today);
      if (view.year === was.year && view.month === was.month)
        setView({ year: d.year, month: d.month });
    }
  }

  // Falls der Kalender der Kampagne wechselt, bleibt der Monat gültig.
  const month = Math.min(view.month, cal.months.length - 1);
  const grid = useMemo(() => monthGrid(cal, view.year, month), [cal, view.year, month]);
  const spans = useMemo(() => spansBetween(data, grid.firstDay, grid.lastDay), [data, grid]);
  const daySpans = useMemo(
    () =>
      selected >= grid.firstDay && selected <= grid.lastDay
        ? spans
        : spansBetween(data, selected, selected),
    [data, grid, spans, selected],
  );

  /** Wählt einen Tag und blättert zu seinem Monat. */
  const goToDay = (dayIndex: number) => {
    const d = fromTime(cal, dayIndex * MINUTES_PER_DAY);
    setSelected(dayIndex);
    setView({ year: d.year, month: d.month });
  };
  /** Wählt einen Tag; geblättert wird nur, wenn er außerhalb des sichtbaren Rasters liegt. */
  const selectDay = (dayIndex: number) => {
    if (dayIndex >= grid.firstDay && dayIndex <= grid.lastDay) setSelected(dayIndex);
    else goToDay(dayIndex);
  };
  const shift = (offset: number) => {
    const next = shiftMonth(cal, view.year, month, offset);
    if (next.year >= 1) setView(next);
  };
  const editEvent = (event: CalendarEvent) => setDialog({ type: 'event', event, day: event.at });
  const createOn = (dayIndex: number) => {
    setSelected(dayIndex);
    setDialog({ type: 'event', event: null, day: dayIndex * MINUTES_PER_DAY });
  };

  return (
    <div className="wf-page">
      <header className="wf-page__head wf-kal-head">
        <div className="wf-btn-group">
          <IconButton
            label="Vorheriger Monat"
            onClick={() => shift(-1)}
            disabled={view.year === 1 && month === 0}
          >
            <ChevronLeft />
          </IconButton>
          <Button onClick={() => goToDay(today)} title="Zum heutigen Tag der Welt springen">
            Heute
          </Button>
          <IconButton label="Nächster Monat" onClick={() => shift(1)}>
            <ChevronRight />
          </IconButton>
        </div>
        <h1 className="wf-page__title wf-kal-title">
          <span>
            {cal.months[month]!.name}{' '}
            <span className="wf-kal-title__year">{formatYear(cal, view.year)}</span>
          </span>
          {cal.eras.slice(1).map((era) => (
            <span key={era.id} className="wf-kal-title__era">
              {formatYear(cal, view.year, era)}
            </span>
          ))}
        </h1>
        <span className="wf-grow" />
        <div className="wf-kal-legend" aria-label="Farben der Terminarten">
          {EVENT_KINDS.map((kind) => (
            <span key={kind} className={`wf-kal-kind--${kind}`} title={EVENT_KIND_HINT[kind]}>
              <i className="wf-kal-gem" />
              {EVENT_KIND_LABEL[kind]}
            </span>
          ))}
        </div>
        <Button variant="primary" icon={<Plus />} onClick={() => createOn(selected)}>
          Termin anlegen
        </Button>
      </header>

      <div className="wf-kal-body">
        <div className="wf-kal-main">
          <MonthGrid
            data={data}
            grid={grid}
            spans={spans}
            selected={selected}
            onSelect={selectDay}
            onCreate={createOn}
            onEdit={editEvent}
            onShiftMonth={shift}
          />
          <div className={cx('wf-kal-strip', cal.moons.length === 0 && 'wf-kal-strip--two')}>
            <UpcomingPanel data={data} onGoToDay={goToDay} onCreate={() => createOn(selected)} />
            <TimersPanel
              data={data}
              onAdd={() => setDialog({ type: 'timer', timer: null })}
              onEdit={(timer) => setDialog({ type: 'timer', timer })}
            />
            {cal.moons.length > 0 && <MoonsPanel data={data} />}
          </div>
        </div>
        <DayPanel
          data={data}
          day={selected}
          spans={daySpans}
          onEdit={editEvent}
          onCreate={createOn}
          onSelect={selectDay}
        />
      </div>

      {dialog?.type === 'event' && (
        <EventDialog
          event={dialog.event}
          day={dialog.day}
          onClose={() => setDialog(null)}
          onSaved={(at) => goToDay(dayIndexOf(at))}
        />
      )}
      {dialog?.type === 'timer' && (
        <TimerDialog timer={dialog.timer} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
