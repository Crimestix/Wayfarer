/** Abschnitt „Kalender“: Monate, Wochentage, Zeitrechnungen und Monde zum Nachlesen. */
import { useMemo } from 'react';
import { useCalendar, useNow } from '../../data/hooks';
import { formatDateTime, formatRelative } from '../../domain/time/calendar';
import { MoonGlyph, SectionTitle, cx } from '../../ui';
import { SeasonSetting } from '../wetter';
import { calendarSummary, eraRows, leapText, monthRows, moonRows, weekdayRows } from './model';

export function CalendarSection() {
  const cal = useCalendar();
  const now = useNow();
  const months = useMemo(() => monthRows(cal, now), [cal, now]);
  const weekdays = useMemo(() => weekdayRows(cal, now), [cal, now]);
  const eras = useMemo(() => eraRows(cal, now), [cal, now]);
  const moons = useMemo(() => moonRows(cal, now), [cal, now]);

  return (
    <div className="wf-einstellungen-stack">
      <div>
        <div className="wf-einstellungen-calendar__name">{cal.name}</div>
        <div className="wf-mute">{calendarSummary(cal)}</div>
      </div>

      <div>
        <SectionTitle>Monate</SectionTitle>
        <ol className="wf-einstellungen-months">
          {months.map((m) => (
            <li
              key={m.index}
              className={cx(
                'wf-einstellungen-month',
                m.current && 'wf-einstellungen-month--current',
              )}
            >
              <span className="wf-einstellungen-month__no wf-num">{m.index + 1}</span>
              <span className="wf-einstellungen-month__name">{m.name}</span>
              <span className="wf-einstellungen-month__days wf-num">
                {m.days} Tage
                {m.leapDays !== null && (
                  <span className="wf-mute"> · {m.leapDays} im Schaltjahr</span>
                )}
              </span>
              {m.current && <span className="wf-einstellungen-now">jetzt</span>}
            </li>
          ))}
        </ol>
        <p className="wf-einstellungen-footnote">{leapText(cal, now)}</p>
      </div>

      <div>
        <SectionTitle>Jahreszeiten für das Wetter</SectionTitle>
        <SeasonSetting />
      </div>

      <div>
        <SectionTitle>Wochentage</SectionTitle>
        <ol className="wf-einstellungen-weekdays">
          {weekdays.map((d) => (
            <li key={d.index} className={cx(d.today && 'wf-einstellungen-weekday--today')}>
              <span className="wf-einstellungen-month__no wf-num">{d.index + 1}</span>
              {d.name}
              {d.today && <span className="wf-einstellungen-now">heute</span>}
            </li>
          ))}
        </ol>
      </div>

      <div>
        <SectionTitle>Zeitrechnungen</SectionTitle>
        <ul className="wf-einstellungen-eras">
          {eras.map((era) => (
            <li key={era.id}>
              <span className="wf-einstellungen-era__year wf-num">
                {era.year} <span className="wf-gold">{era.label}</span>
              </span>
              <span className="wf-mute">
                {era.primary
                  ? 'Hauptanzeige – so steht das Jahr überall in Wayfarer.'
                  : `Beginnt ${era.relation}.`}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {moons.length > 0 && (
        <div>
          <SectionTitle>Monde</SectionTitle>
          <ul className="wf-einstellungen-moons">
            {moons.map((row) => (
              <li key={row.moon.id} className="wf-einstellungen-moon">
                <MoonGlyph moon={row.moon} time={now} size={34} />
                <div className="wf-grow">
                  <div className="wf-einstellungen-moon__name">{row.moon.name}</div>
                  <div className="wf-soft">
                    {row.phase} · Umlauf {row.cycle}
                  </div>
                </div>
                <dl className="wf-einstellungen-moon__dates">
                  {row.lastNew !== null && (
                    <>
                      <dt>Letzter Neumond</dt>
                      <dd className="wf-num">{formatDateTime(cal, row.lastNew)}</dd>
                    </>
                  )}
                  <dt>Nächster Vollmond</dt>
                  <dd className="wf-num">
                    {formatDateTime(cal, row.nextFull)}
                    <span className="wf-mute"> · {formatRelative(now, row.nextFull)}</span>
                  </dd>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="wf-einstellungen-footnote">
        Der Kalender gehört zur Kampagne und steckt in jeder Sicherung. Ändern lässt er sich hier
        noch nicht; die Mondphasen stellst du im Bereich „Kalender“ über „Monde stellen“ nach.
      </p>
    </div>
  );
}
