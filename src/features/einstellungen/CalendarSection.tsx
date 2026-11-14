/**
 * Abschnitt „Kalender“: Monate, Wochentage, Zeitrechnungen und Monde zum Nachlesen; die
 * Jahreszeiten und den wärmsten Monat zum Festlegen.
 */
import { useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import { useCalendar, useData, useDb, useNow } from '../../data/hooks';
import { addSeason, assignMonth, removeSeason, renameSeason } from '../../domain/seasons';
import { formatDateTime, formatRelative } from '../../domain/time/calendar';
import { Button, IconButton, MoonGlyph, SectionTitle, Select, Written, cx, toast } from '../../ui';
import { setSeasons } from '../kalender/actions';
import { SeasonSetting } from '../wetter';
import {
  adoptComputedSeasons,
  calendarSummary,
  eraRows,
  leapText,
  monthRows,
  moonRows,
  seasonSettings,
  weekdayRows,
  type SeasonSettings,
} from './model';

export function CalendarSection() {
  const db = useDb();
  const data = useData();
  const cal = useCalendar();
  const now = useNow();
  const months = useMemo(() => monthRows(cal, now), [cal, now]);
  const seasons = useMemo(() => seasonSettings(data), [data]);
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
              <span className="wf-einstellungen-month__season">
                {seasons.own ? (
                  <Select
                    value={String(seasons.months[m.index]?.season ?? '')}
                    aria-label={`Jahreszeit im ${m.name}`}
                    title="Zu welcher Jahreszeit dieser Monat gehört"
                    onChange={(event) =>
                      setSeasons(
                        db,
                        assignMonth(
                          seasons.seasons,
                          m.index,
                          event.target.value === '' ? null : Number(event.target.value),
                        ),
                      )
                    }
                  >
                    <option value="">keine Jahreszeit</option>
                    {seasons.seasons.map((season, index) => (
                      <option key={index} value={index}>
                        {seasonName(season.name, index)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span title="Von Wayfarer errechnet">{seasons.months[m.index]?.computed}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
        <p className="wf-einstellungen-footnote">{leapText(cal, now)}</p>
      </div>

      <Seasons settings={seasons} />

      <div>
        <SectionTitle>Wärmster Monat</SectionTitle>
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
        Der Kalender gehört zur Kampagne und steckt in jeder Sicherung. Monate und Wochentage lassen
        sich hier noch nicht ändern, die Jahreszeiten schon; die Mondphasen stellst du im Bereich
        „Kalender“ über „Monde stellen“ nach.
      </p>
    </div>
  );
}

/** Ein Name für die Auswahl, auch wenn noch keiner geschrieben ist. */
const seasonName = (name: string, index: number) => name.trim() || `${index + 1}. Jahreszeit`;

/**
 * Die Jahreszeiten: errechnet (vier Viertel um den wärmsten Monat), bis der Spielleiter sie
 * übernimmt – dann Namen ändern, hinzufügen, herausnehmen; die Monate wählt er oben je Monat.
 */
function Seasons({ settings }: { settings: SeasonSettings }) {
  const db = useDb();
  const data = useData();
  const save = (next: SeasonSettings['seasons']) => setSeasons(db, next);
  if (!settings.own)
    return (
      <div>
        <SectionTitle>Jahreszeiten</SectionTitle>
        <p className="wf-soft">
          Wayfarer rechnet die Jahreszeiten als vier gleiche Viertel um den wärmsten Monat:
        </p>
        <ul className="wf-einstellungen-seasons__computed">
          {settings.computedText.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Button size="sm" onClick={() => save(adoptComputedSeasons(data))}>
          Wie errechnet übernehmen
        </Button>
        <p className="wf-einstellungen-footnote">
          Übernommen kannst du die Jahreszeiten umbenennen, jedem Monat eine andere zuordnen und
          weitere hinzufügen. Danach richtet sich, was in deiner Welt zu welcher Zeit wächst und
          lebt. Auf der Südhalbkugel gilt alles ein halbes Jahr versetzt.
        </p>
      </div>
    );
  const reset = () => {
    const before = settings.seasons;
    save([]);
    toast({
      title: 'Jahreszeiten wieder errechnet',
      body: 'Vier gleiche Viertel um den wärmsten Monat.',
      action: { label: 'Rückgängig', run: () => save(before) },
    });
  };
  return (
    <div>
      <SectionTitle>Jahreszeiten</SectionTitle>
      <ul className="wf-einstellungen-seasons">
        {settings.seasons.map((season, index) => (
          <li key={index} className="wf-einstellungen-season">
            <Written
              label={`Name der ${index + 1}. Jahreszeit`}
              value={season.name}
              placeholder="Name der Jahreszeit"
              onSave={(name) => save(renameSeason(settings.seasons, index, name))}
            />
            <span className="wf-einstellungen-season__months wf-mute">
              {season.months.length === 0
                ? 'noch kein Monat'
                : season.months.map((m) => data.campaign.calendar.months[m]?.name).join(', ')}
            </span>
            <IconButton
              label="Diese Jahreszeit herausnehmen – ihre Monate gehören dann zu keiner"
              variant="ghost"
              size="sm"
              onClick={() => save(removeSeason(settings.seasons, index))}
            >
              <X />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="wf-row-wrap">
        <Button size="sm" icon={<Plus />} onClick={() => save(addSeason(settings.seasons, ''))}>
          Jahreszeit hinzufügen
        </Button>
        <Button size="sm" variant="ghost" onClick={reset}>
          Wieder errechnen lassen
        </Button>
      </div>
      <p className="wf-einstellungen-footnote">
        Bei jedem Monat oben wählst du, zu welcher Jahreszeit er gehört. Danach richtet sich, was in
        deiner Welt zu welcher Zeit wächst und lebt; auch eigene Namen wie „Regenzeit“ lassen sich
        bei Pflanzen und Tieren als Zeit eintragen. Auf der Südhalbkugel gilt alles ein halbes Jahr
        versetzt.
      </p>
    </div>
  );
}
