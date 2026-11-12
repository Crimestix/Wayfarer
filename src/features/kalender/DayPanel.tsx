/** Seitenleiste: alles zum gewählten Tag – Monde, Termine, Chronik, nächste Schritte. */
import { useState } from 'react';
import { CalendarOff, CalendarPlus, Check, Feather, Hourglass, Repeat } from 'lucide-react';
import { skipOccurrence } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import { useDb } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import { isEveryday, isNear } from '../../domain/weight';
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
import { weatherZone, zoneWeather } from '../../domain/weatherZone';
import { advanceAndReport } from '../../shell/dialogs';
import { openQuickLog } from '../../shell/commands';
import { Button, ChronicleList, MoonGlyph, Panel, SectionTitle, Select, cx, toast } from '../../ui';
import { EntryDialog } from '../chronik/EntryDialog';
import { DayWeatherBlock } from '../wetter/DayWeather';
import {
  EVENT_DONE_LABEL,
  EVENT_KIND_LABEL,
  chronicleOnDay,
  describePassage,
  describeRepeat,
  moonEventsBetween,
  occurredBeforeDay,
  overdueLabel,
  previewPassage,
  relativeDay,
  spanState,
  splitDay,
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
      title={
        event.done ? 'Wieder öffnen' : `Als ${EVENT_DONE_LABEL[event.kind].toLowerCase()} abhaken`
      }
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
  /** Einen anderen Tag wählen (aus „Auf dem Weg dorthin“). */
  onSelect: (dayIndex: number) => void;
}

/** So viele Zeilen zeigt „Auf dem Weg dorthin“ höchstens. */
const ON_THE_WAY_LIMIT = 8;

export function DayPanel({ data, day, spans, onEdit, onCreate, onSelect }: DayPanelProps) {
  const db = useDb();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const today = dayIndexOf(now);
  const start = day * MINUTES_PER_DAY;
  const date = fromTime(cal, start);
  const [hour, setHour] = useState(6);
  /** Zeitpunkt, zu dem gerade etwas nachgetragen wird. */
  const [backfill, setBackfill] = useState<number | null>(null);
  const zone = weatherZone(data, data.state.placeId);

  const { main: events, everyday } = splitDay(data, spans, day);
  const chronicle = day <= today ? chronicleOnDay(data, day) : [];
  const moonEvents = moonEventsBetween(cal, day, day).get(day) ?? [];
  // Monde so, wie sie jetzt stehen (heute) bzw. zur Tagesmitte.
  const moonTime = day === today ? now : start + MINUTES_PER_DAY / 2;
  const passage = day > today ? previewPassage(data, start + hour * MINUTES_PER_HOUR) : null;
  const onTheWay = passage
    ? occurredBeforeDay(passage, day).filter((o) => !isEveryday(data, o.event))
    : [];

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
          <SectionTitle>Wetter</SectionTitle>
        </div>
        <DayWeatherBlock weather={zoneWeather(data, zone, day)} zone={zone} />
        <div className="wf-kal-side__section wf-kal-side__section--action">
          <SectionTitle>Termine</SectionTitle>
          <Button size="sm" icon={<CalendarPlus />} onClick={() => onCreate(day)}>
            Termin an diesem Tag
          </Button>
        </div>
        {events.length === 0 ? (
          <div className="wf-kal-hint">
            {everyday.length > 0
              ? 'Nichts Besonderes an diesem Tag – nur der Alltag unten.'
              : 'Für diesen Tag ist nichts eingetragen. Ein Doppelklick auf den Tag im Raster legt einen Termin an.'}
          </div>
        ) : (
          events.map((span) => {
            const { event } = span;
            const state = spanState(span, now);
            const length = span.endDay - span.startDay + 1;
            const meta = [
              state === 'done' ? EVENT_DONE_LABEL[event.kind].toLowerCase() : '',
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
                {event.repeat && span.startDay === day && (
                  <button
                    type="button"
                    className="wf-kal-event__skip"
                    aria-label={`„${event.title}“ an diesem Tag ausfallen lassen`}
                    title="Dieses eine Mal ausfallen lassen – die Reihe läuft weiter"
                    onClick={() => {
                      if (!skipOccurrence(db, event.id, day)) return;
                      toast({
                        title: 'Fällt dieses Mal aus',
                        body: `${event.title} · ${formatDayMonth(cal, start)}`,
                        action: {
                          label: 'Rückgängig',
                          run: () => skipOccurrence(db, event.id, day, false),
                        },
                      });
                    }}
                  >
                    <CalendarOff />
                  </button>
                )}
              </div>
            );
          })
        )}

        {everyday.length > 0 && (
          <details className="wf-kal-everyday">
            <summary>
              Alltag
              <span>
                {everyday.length} {everyday.length === 1 ? 'Termin' : 'Termine'} – läuft nebenher
              </span>
            </summary>
            {everyday.map((span) => (
              <button
                key={span.event.id + span.at}
                type="button"
                className="wf-kal-row"
                onClick={() => onEdit(span.event)}
                title="Termin bearbeiten"
              >
                <Repeat className="wf-kal-everyday__icon" aria-hidden />
                <span className="wf-kal-row__main">
                  <span className="wf-kal-row__title">{span.event.title}</span>
                  <span className="wf-kal-row__meta">
                    {[
                      isNear(data, span.event.placeId) ? 'hier' : '',
                      span.event.placeId ? entityName(data, span.event.placeId) : '',
                      describeRepeat(span.event.repeat),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </button>
            ))}
          </details>
        )}

        {passage && onTheWay.length + passage.expired.length > 0 && (
          <>
            <div className="wf-kal-side__section">
              <SectionTitle>Auf dem Weg dorthin</SectionTitle>
            </div>
            {onTheWay.slice(0, ON_THE_WAY_LIMIT).map((o) => (
              <button
                key={o.event.id + o.at}
                type="button"
                className={cx('wf-kal-row', `wf-kal-kind--${o.event.kind}`)}
                onClick={() => onSelect(dayIndexOf(o.at))}
                title={`${EVENT_KIND_LABEL[o.event.kind]} – diesen Tag zeigen`}
              >
                <i className="wf-kal-gem" />
                <span className="wf-kal-row__main">
                  <span className="wf-kal-row__title">{o.event.title}</span>
                  <span className="wf-kal-row__meta">
                    <b>{relativeDay(today, dayIndexOf(o.at))}</b> · {formatDayMonth(cal, o.at)}
                    {o.event.timed && `, ${formatClock(o.at)} Uhr`}
                  </span>
                </span>
              </button>
            ))}
            {onTheWay.length > ON_THE_WAY_LIMIT && (
              <div className="wf-kal-row wf-kal-row--note">
                und {onTheWay.length - ON_THE_WAY_LIMIT} weitere Termine
              </div>
            )}
            {passage.expired.length > 0 && (
              <div className="wf-kal-row wf-kal-row--note">
                Bis dahin endet: {passage.expired.map((t) => t.label).join(', ')}
              </div>
            )}
          </>
        )}

        {day <= today && (
          <>
            <div className="wf-kal-side__section wf-kal-side__section--action">
              <SectionTitle>Chronik</SectionTitle>
              {day === today ? (
                <Button size="sm" icon={<Feather />} onClick={() => openQuickLog()}>
                  Festhalten
                </Button>
              ) : (
                <Button
                  size="sm"
                  icon={<Feather />}
                  title="Etwas festhalten, das an diesem Tag geschehen ist"
                  onClick={() => setBackfill(day * MINUTES_PER_DAY + 12 * MINUTES_PER_HOUR)}
                >
                  Nachtragen
                </Button>
              )}
            </div>
            <ChronicleList
              entries={chronicle}
              empty={
                <div className="wf-kal-hint">
                  {day === today
                    ? 'Heute wurde noch nichts festgehalten. Notizen, Abmachungen und Ortswechsel dieses Tages erscheinen hier.'
                    : 'An diesem Tag wurde nichts festgehalten.'}
                </div>
              }
            />
          </>
        )}
      </div>

      {passage && (
        <footer className="wf-kal-side__foot">
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
        </footer>
      )}
      {backfill !== null && (
        <EntryDialog
          key={backfill}
          request={{ mode: 'new', at: backfill }}
          onClose={() => setBackfill(null)}
        />
      )}
    </Panel>
  );
}
