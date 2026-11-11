/**
 * Das Wetter am Ort der Gruppe: ein kleines Feld in der Weltleiste, das auf einen Blick sagt,
 * wie es draußen ist. Aufgeklappt zeigt es den Tag in Abschnitten, die Folgen nach Regelwerk,
 * die nächsten Tage und woher das Klima stammt – und lässt beides von Hand festlegen.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Cloud,
  CloudFog,
  CloudMoon,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  Cloudy,
  Moon,
  Mountain,
  Pencil,
  RotateCcw,
  Sun,
  TriangleAlert,
  Wind,
} from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { placeAncestors } from '../../domain/derive';
import type { Place } from '../../domain/schema';
import {
  dayIndexOf,
  formatDayMonth,
  MINUTES_PER_DAY,
  weekdayName,
} from '../../domain/time/calendar';
import {
  CLIMATE_PRESETS,
  DAY_PART_LABEL,
  PRESET,
  WIND_LABEL,
  describeWeather,
  temperatureLabel,
  dayGlance,
  type ClimatePreset,
  type DayWeather,
  type WeatherNow,
} from '../../domain/weather';
import { describeSite } from '../../domain/geoClimate';
import { forecast, weatherAt, type WeatherZone } from '../../domain/weatherZone';
import { describeSun, isDark, sunAt } from '../atlas/model';
import { Button, Checkbox, Field, Input, Popover, Select, cx, toast } from '../../ui';
import { clearManualWeather, setManualWeather, setPlaceClimate } from './actions';
import './wetter.css';

type Glance = Pick<WeatherNow, 'precipitation' | 'kind' | 'wind' | 'fog' | 'sky' | 'sheltered'>;

/** Das Zeichen zum Wetter; nachts steht der Mond am klaren Himmel. */
export function WeatherIcon({ weather, night }: { weather: Glance; night?: boolean }): ReactNode {
  if (weather.sheltered) return <Mountain aria-hidden />;
  if (weather.precipitation !== 'none') {
    if (weather.kind === 'snow') return <CloudSnow aria-hidden />;
    return weather.wind === 'strong' ? <CloudRainWind aria-hidden /> : <CloudRain aria-hidden />;
  }
  if (weather.fog) return <CloudFog aria-hidden />;
  if (weather.wind === 'strong') return <Wind aria-hidden />;
  switch (weather.sky) {
    case 'clear':
      return night ? <Moon aria-hidden /> : <Sun aria-hidden />;
    case 'fair':
      return night ? <CloudMoon aria-hidden /> : <CloudSun aria-hidden />;
    case 'cloudy':
      return <Cloud aria-hidden />;
    case 'overcast':
      return <Cloudy aria-hidden />;
  }
}

/** Ein Tag als Ganzes für die Vorschau: der stärkste Niederschlag, der Himmel am Tag. */
const glanceOfDay = dayGlance;

const SOURCE_TEXT: Record<WeatherZone['source'], (zone: WeatherZone) => string> = {
  chosen: (zone) => `festgelegt für „${zone.from?.name ?? 'diesen Ort'}“`,
  position: (zone) =>
    `von Wayfarer aus der Lage von „${zone.from?.name ?? 'diesem Ort'}“ gerechnet${zone.site ? ` (${describeSite(zone.site)})` : ''}`,
  recognized: (zone) => `von Wayfarer erkannt an „${zone.from?.name ?? 'diesem Ort'}“`,
  default: () => 'von Wayfarer angenommen, weil nichts anderes bekannt ist',
};

function ManualForm({
  zone,
  day,
  today,
  onDone,
}: {
  zone: WeatherZone;
  day: number;
  today: DayWeather;
  onDone: () => void;
}) {
  const db = useDb();
  const [temperature, setTemperature] = useState(String(today.high));
  const [precipitation, setPrecipitation] = useState(today.precipitation);
  const [wind, setWind] = useState(today.wind);
  const [fog, setFog] = useState(today.fog);
  const [note, setNote] = useState(today.note);
  const degrees = Number(temperature.replace(',', '.').replace('−', '-'));
  const valid = temperature.trim() !== '' && Number.isFinite(degrees) && Math.abs(degrees) <= 80;

  return (
    <form
      className="wf-wetter-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        setManualWeather(db, zone, day, { temperature: degrees, precipitation, wind, fog, note });
        onDone();
      }}
    >
      <div className="wf-wetter-form__row">
        <Field label="Höchstwert (°C)">
          <Input
            value={temperature}
            inputMode="decimal"
            onChange={(e) => setTemperature(e.target.value)}
            aria-invalid={!valid}
          />
        </Field>
        <Field label="Niederschlag">
          <Select
            value={precipitation}
            onChange={(e) => setPrecipitation(e.target.value as typeof precipitation)}
          >
            <option value="none">Keiner</option>
            <option value="light">Leicht</option>
            <option value="heavy">Stark</option>
          </Select>
        </Field>
        <Field label="Wind">
          <Select value={wind} onChange={(e) => setWind(e.target.value as typeof wind)}>
            <option value="none">{WIND_LABEL.none}</option>
            <option value="light">{WIND_LABEL.light}</option>
            <option value="strong">{WIND_LABEL.strong}</option>
          </Select>
        </Field>
      </div>
      <Checkbox checked={fog} onChange={setFog}>
        Nebel bis zum Mittag
      </Checkbox>
      <Field label="Anmerkung">
        <Input
          value={note}
          placeholder="z. B. unnatürlicher Sturm über der Stadt"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div className="wf-wetter-form__foot">
        <Button type="button" size="sm" onClick={onDone}>
          Abbrechen
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={!valid}>
          Für heute festlegen
        </Button>
      </div>
    </form>
  );
}

function ClimateForm({
  zone,
  chain,
  onDone,
}: {
  zone: WeatherZone;
  /** Der Ort der Gruppe und die Orte darüber. */
  chain: Place[];
  onDone: () => void;
}) {
  const db = useDb();
  const [preset, setPreset] = useState<ClimatePreset>(zone.preset ?? 'temperate');
  // Vorgeschlagen wird der Ort, an dem das Klima schon hängt; sonst die nächste Gegend, die groß
  // genug für ein eigenes Klima ist (Region, Land, Kontinent), und zuletzt der weiteste Ort.
  const [placeId, setPlaceId] = useState(
    (zone.source === 'chosen' ? zone.from?.id : undefined) ??
      chain.find((place) => /region|land|provinz|reich|kontinent|insel/i.test(place.place.category))
        ?.id ??
      chain[chain.length - 1]?.id ??
      '',
  );
  const target = chain.find((place) => place.id === placeId);

  const apply = (next: ClimatePreset | null) => {
    if (!target) return;
    const undo = setPlaceClimate(db, target.id, next);
    onDone();
    toast({
      title: next ? `Klima für „${target.name}“: ${PRESET[next].name}` : 'Klima wieder erkannt',
      body: next
        ? 'Gilt für alle Orte darunter, solange dort nichts anderes festgelegt ist.'
        : `Für „${target.name}“ ist nichts mehr festgelegt.`,
      action: undo ? { label: 'Rückgängig', run: undo } : undefined,
    });
  };

  return (
    <div className="wf-wetter-form">
      <div className="wf-wetter-form__row wf-wetter-form__row--two">
        <Field label="Klima">
          <Select value={preset} onChange={(e) => setPreset(e.target.value as ClimatePreset)}>
            {CLIMATE_PRESETS.map((key) => (
              <option key={key} value={key}>
                {PRESET[key].name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Gilt für">
          <Select value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
            {chain.map((place) => (
              <option key={place.id} value={place.id}>
                {place.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="wf-wetter-hint">{PRESET[preset].hint}</p>
      <div className="wf-wetter-form__foot">
        {target?.place.climateId && (
          <Button type="button" size="sm" variant="ghost" onClick={() => apply(null)}>
            Festlegung aufheben
          </Button>
        )}
        <Button type="button" size="sm" onClick={onDone}>
          Abbrechen
        </Button>
        <Button type="button" size="sm" variant="primary" onClick={() => apply(preset)}>
          Festlegen
        </Button>
      </div>
    </div>
  );
}

export function WeatherChip() {
  const db = useDb();
  const data = useData();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<'day' | 'climate' | null>(null);
  const placeId = data.state.placeId;
  const now = data.state.now;
  const weather = useMemo(() => weatherAt(data, placeId, now), [data, placeId, now]);
  const day = dayIndexOf(now);
  const hour = (now - day * MINUTES_PER_DAY) / 60;
  // Mit Atlas und Lage geht die Sonne dort auf und unter, wo der Ort liegt.
  const sun = useMemo(() => sunAt(data, placeId, now), [data, placeId, now]);
  const night = sun ? isDark(sun, now - day * MINUTES_PER_DAY) : hour < 6 || hour >= 20;
  const next = useMemo(
    () => (open ? forecast(data, weather.zone, day + 1, 4) : []),
    [data, weather.zone, day, open],
  );
  const chain = useMemo(() => {
    const place = placeId ? data.entities[placeId] : undefined;
    return place?.kind === 'place' ? [place, ...placeAncestors(data, place.id)] : [];
  }, [data, placeId]);

  // Ohne Ort der Gruppe gibt es kein „draußen“.
  if (!chain.length) return null;

  const { zone, today, effects } = weather;
  const summary = describeWeather(weather.now);
  const cal = data.campaign.calendar;
  const close = () => {
    setOpen(false);
    setEditing(null);
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={cx('wf-wetter-chip', effects.length > 0 && 'wf-wetter-chip--alert')}
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={
          today.sheltered
            ? `Unter der Erde: kein Wetter, ${temperatureLabel(weather.now.temperature)}`
            : `${summary}, ${temperatureLabel(weather.now.temperature)}${effects.length ? ` – ${effects.map((e) => e.title).join(', ')}` : ''}`
        }
      >
        <WeatherIcon weather={weather.now} night={night} />
        <span className="wf-wetter-chip__temp">{temperatureLabel(weather.now.temperature)}</span>
        <span className="wf-wetter-chip__text wf-clamp-1">{summary}</span>
      </button>

      <Popover open={open} onClose={close} anchor={anchor} align="right" width={400}>
        <div className="wf-wetter">
          <header className="wf-wetter__head">
            <span className="wf-wetter__icon">
              <WeatherIcon weather={weather.now} night={night} />
            </span>
            <div className="wf-wetter__now">
              <div className="wf-wetter__summary">
                {temperatureLabel(weather.now.temperature)} · {summary}
              </div>
              <div className="wf-wetter__sub">
                {today.sheltered
                  ? 'Unter der Erde – gleichbleibend kühl'
                  : `Heute ${temperatureLabel(today.low)} bis ${temperatureLabel(today.high)}`}
                {today.manual && ' · von dir festgelegt'}
              </div>
              {today.note && <div className="wf-wetter__note">{today.note}</div>}
            </div>
          </header>

          {effects.length > 0 && (
            <ul className="wf-wetter__effects">
              {effects.map((effect) => (
                <li key={effect.title}>
                  <TriangleAlert aria-hidden />
                  <span>
                    <strong>{effect.title}.</strong> {effect.rule}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {editing === 'day' ? (
            <ManualForm zone={zone} day={day} today={today} onDone={() => setEditing(null)} />
          ) : editing === 'climate' ? (
            <ClimateForm zone={zone} chain={chain} onDone={() => setEditing(null)} />
          ) : (
            <>
              {!today.sheltered && (
                <div className="wf-wetter__parts" aria-label="Der Tag in Abschnitten">
                  {today.parts.map((part) => (
                    <div
                      key={part.key}
                      className="wf-wetter__part"
                      data-current={part.key === weather.now.part}
                    >
                      <span className="wf-wetter__label">{DAY_PART_LABEL[part.key]}</span>
                      <WeatherIcon
                        weather={{
                          ...glanceOfDay(today),
                          precipitation: part.precipitation,
                          fog: part.fog,
                        }}
                        night={part.key === 'night'}
                      />
                      <span>{temperatureLabel(part.temperature)}</span>
                    </div>
                  ))}
                </div>
              )}

              {!today.sheltered && (
                <div className="wf-wetter__days" aria-label="Die nächsten Tage">
                  {next.map((entry) => (
                    <div key={entry.day} className="wf-wetter__day">
                      <span className="wf-wetter__label">
                        {weekdayName(cal, entry.day * MINUTES_PER_DAY)}
                      </span>
                      <span className="wf-wetter__date">
                        {formatDayMonth(cal, entry.day * MINUTES_PER_DAY)}
                      </span>
                      <WeatherIcon weather={glanceOfDay(entry)} />
                      <span className="wf-wetter__range">
                        {temperatureLabel(entry.low)} / {temperatureLabel(entry.high)}
                      </span>
                      <span className="wf-wetter__daytext wf-clamp-1">
                        {describeWeather(glanceOfDay(entry))}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <footer className="wf-wetter__foot">
                {sun && !today.sheltered && (
                  <span className="wf-wetter__zone">
                    Sonne: <strong>{describeSun(sun)}</strong>.
                  </span>
                )}
                <span className="wf-wetter__zone">
                  Klima: <strong>{zone.climate.name}</strong> – {SOURCE_TEXT[zone.source](zone)}.
                </span>
                <div className="wf-wetter__actions">
                  <Button size="sm" icon={<Mountain />} onClick={() => setEditing('climate')}>
                    Klima festlegen
                  </Button>
                  {today.manual ? (
                    <Button
                      size="sm"
                      icon={<RotateCcw />}
                      onClick={() => clearManualWeather(db, zone, day)}
                      title="Das festgelegte Wetter verwerfen und wieder errechnen lassen"
                    >
                      Wieder Wayfarer überlassen
                    </Button>
                  ) : (
                    !today.sheltered && (
                      <Button size="sm" icon={<Pencil />} onClick={() => setEditing('day')}>
                        Heute festlegen
                      </Button>
                    )
                  )}
                </div>
              </footer>
            </>
          )}
        </div>
      </Popover>
    </>
  );
}
