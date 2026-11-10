/** Seitenleiste: alles zum gewählten Tag – Monde, Termine, Chronik, nächste Schritte. */
import { useState } from 'react';
import { CalendarPlus, Check, Feather, Hourglass, Repeat } from 'lucide-react';
import type { CampaignDb } from '../../data/db';
import { useDb } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import type { CalendarEvent, CampaignData } from '../../domain/schema';
import {
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  dayIndexOf,
  formatClock,
  formatDayMonth,
  formatYear,
  fromTime,
  moonPhase,
} from '../../domain/time/calendar';
import { advanceAndReport } from '../../shell/dialogs';
import { openQuickLog } from '../../shell/commands';
import { Button, ChronicleList, MoonGlyph, Panel, SectionTitle, Select, cx, toast } from '../../ui';
import {
  EVENT_KIND_LABEL,
  chronicleOnDay,
  describePassage,
  describeRepeat,
  moonEventsBetween,
  overdueLabel,
  previewPassage,
  relativeDay,
  spanState,
  spansOnDay,
  type DaySpan,
} from './model';

/** Hakt einen Termin ab (mit „Rückgängig“) oder öffnet ihn wieder. */
export function setEventDone(db: CampaignDb, event: CalendarEvent, done: boolean) {
  db.patch('events', event.id, { done });
  if (!done) return;
  toast({
    title: 'Abgehakt',
    body: event.title,
    action: {
      label: 'Rückgängig',
      run: () => {
        if (db.getSnapshot().events[event.id]) db.patch('events', event.id, { done: false });
      },
    },
  });
}

/** Kästchen zum Abhaken; bei wiederkehrenden Terminen nur das Zeichen der Wiederholung. */
export function EventCheck({ event }: { event: CalendarEvent }) {
  const db = useDb();
  if (event.repeat)
    return (
      <span
        className="wf-kal-check wf-kal-check--fixed"
        title={`Wiederholt sich ${describeRepeat(event.repeat)}`}
      >
        <Repeat />
      </span>
    );
  return (
    <button
      type="button"
      className="wf-kal-check"
      aria-pressed={event.done}
      aria-label={event.done ? `„${event.title}“ wieder öffnen` : `„${event.title}“ abhaken`}
      title={event.done ? 'Wieder öffnen' : 'Abhaken'}
      onClick={() => setEventDone(db, event, !event.done)}
    >
      {event.done && <Check />}
    </button>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export interface DayPanelProps {
  data: CampaignData;
  /** Gewählter Tag als Tagesindex. */
  day: number;
  spans: DaySpan[];
  onEdit: (event: CalendarEvent) => void;
  onCreate: (dayIndex: number) => void;
}

export function DayPanel({ data, day, spans, onEdit, onCreate }: DayPanelProps) {
  const db = useDb();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const today = dayIndexOf(now);
  const start = day * MINUTES_PER_DAY;
  const date = fromTime(cal, start);
  const [hour, setHour] = useState(6);

  const events = spansOnDay(spans, day);
  const chronicle = day <= today ? chronicleOnDay(data, day) : [];
  const moonEvents = moonEventsBetween(cal, day, day).get(day) ?? [];
  // Monde so, wie sie jetzt stehen (heute) bzw. zur Tagesmitte.
  const moonTime = day === today ? now : start + MINUTES_PER_DAY / 2;
  const passage = day > today ? previewPassage(data, start + hour * MINUTES_PER_HOUR) : null;

  return (
    <Panel className="wf-kal-side" flush>
      <header className="wf-kal-side__head">
        <div className="wf-kal-side__when">
          <span>{cal.weekdays[date.weekday]}</span>
          <b>{relativeDay(today, day)}</b>
        </div>
        <h2 className="wf-kal-side__date">{formatDayMonth(cal, start)}</h2>
        <div className="wf-kal-side__years">
          {cal.eras.map((era) => formatYear(cal, date.year, era)).join(' · ')}
        </div>
        {cal.moons.length > 0 && (
          <div className="wf-kal-side__moons">
            {cal.moons.map((moon) => {
              const exact = moonEvents.find((e) => e.moon.id === moon.id);
              const phase = moonPhase(moon, exact ? exact.at : moonTime);
              return (
                <div key={moon.id}>
                  <MoonGlyph moon={moon} time={exact ? exact.at : moonTime} size={18} />
                  <b>{moon.name}</b>
                  <span>{exact ? exact.label : phase.label}</span>
                  <em>{exact ? `um ${formatClock(exact.at)}` : `${phase.light} %`}</em>
                </div>
              );
            })}
          </div>
        )}
      </header>

      <div className="wf-kal-side__scroll">
        <div className="wf-kal-side__section">
          <SectionTitle>Termine</SectionTitle>
        </div>
        {events.length === 0 ? (
          <div className="wf-kal-hint">
            Für diesen Tag ist nichts eingetragen. Ein Doppelklick auf den Tag im Raster legt einen
            Termin an.
          </div>
        ) : (
          events.map((span) => {
            const { event } = span;
            const state = spanState(span, now);
            const length = span.endDay - span.startDay + 1;
            const meta = [
              event.timed && span.startDay === day ? `${formatClock(span.at)} Uhr` : '',
              length > 1 ? `Tag ${day - span.startDay + 1} von ${length}` : '',
              event.repeat ? describeRepeat(event.repeat) : '',
              event.placeId ? entityName(data, event.placeId) : '',
              ...event.refs.slice(0, 3).map((id) => entityName(data, id)),
              event.refs.length > 3 ? `und ${event.refs.length - 3} weitere` : '',
            ].filter(Boolean);
            return (
              <div
                key={event.id + span.at}
                className={cx(
                  'wf-kal-event',
                  `wf-kal-kind--${event.kind}`,
                  `wf-kal-event--${state}`,
                )}
              >
                <EventCheck event={event} />
                <button
                  type="button"
                  className="wf-kal-event__main"
                  onClick={() => onEdit(event)}
                  title="Termin bearbeiten"
                >
                  <span className="wf-kal-event__title">{event.title}</span>
                  <span className="wf-kal-event__meta">
                    <b>
                      {state === 'overdue'
                        ? `${EVENT_KIND_LABEL[event.kind]}, ${overdueLabel(now, event)}`
                        : EVENT_KIND_LABEL[event.kind]}
                    </b>
                    {meta.length > 0 && ` · ${meta.join(' · ')}`}
                  </span>
                  {event.details && (
                    <span className="wf-kal-event__details wf-clamp-2">{event.details}</span>
                  )}
                </button>
              </div>
            );
          })
        )}

        {day <= today && (
          <>
            <div className="wf-kal-side__section">
              <SectionTitle>Chronik</SectionTitle>
            </div>
            <ChronicleList
              entries={chronicle}
              empty={
                <div className="wf-kal-hint">
                  {day === today ? (
                    <>
                      Heute wurde noch nichts festgehalten.
                      <br />
                      <Button size="sm" icon={<Feather />} onClick={() => openQuickLog()}>
                        Festhalten
                      </Button>
                    </>
                  ) : (
                    'An diesem Tag wurde nichts festgehalten.'
                  )}
                </div>
              }
            />
          </>
        )}
      </div>

      <footer className="wf-kal-side__foot">
        <Button icon={<CalendarPlus />} onClick={() => onCreate(day)}>
          Termin an diesem Tag
        </Button>
        {passage && (
          <div className="wf-kal-pass">
            <div className="wf-kal-pass__row">
              <span className="wf-grow">Ankunft am {formatDayMonth(cal, start)} um</span>
              <Select
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                aria-label="Uhrzeit der Ankunft"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {formatClock(h * MINUTES_PER_HOUR)} Uhr
                  </option>
                ))}
              </Select>
            </div>
            <Button
              variant="primary"
              icon={<Hourglass />}
              onClick={() => advanceAndReport(db, passage.to)}
            >
              Zeit bis zu diesem Tag vergehen lassen
            </Button>
            <div className="wf-kal-pass__preview">{describePassage(passage)}</div>
          </div>
        )}
      </footer>
    </Panel>
  );
}
