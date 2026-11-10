/**
 * Das Wetter eines ganzen Tages – für den Kalender: als kleines Zeichen im Tagesfeld und als
 * Abschnitt in der Tagesansicht. Gerechnet wird in `domain/weather.ts`.
 */
import {
  DAY_PART_LABEL,
  dayEffects,
  dayGlance,
  describeWeather,
  temperatureLabel,
  type DayWeather,
} from '../../domain/weather';
import type { WeatherZone } from '../../domain/weatherZone';
import { cx } from '../../ui';
import { WeatherIcon } from './WeatherChip';
import './wetter.css';

/** „Starker Regen, windig · 4 bis 11 °C“ */
export function dayWeatherLine(weather: DayWeather): string {
  if (weather.sheltered) return 'Kein Wetter – unter der Erde oder abgeschirmt';
  return `${describeWeather(dayGlance(weather))} · ${temperatureLabel(weather.low)} bis ${temperatureLabel(weather.high)}`;
}

/** Das Zeichen im Tagesfeld des Monats. Auffällig, wenn das Wetter Folgen nach den Regeln hat. */
export function DayWeatherMark({ weather }: { weather: DayWeather }) {
  if (weather.sheltered) return null;
  const effects = dayEffects(weather);
  return (
    <span
      className={cx('wf-wetter-mark', effects.length > 0 && 'wf-wetter-mark--alert')}
      title={[dayWeatherLine(weather), ...effects.map((effect) => effect.title)].join('\n')}
    >
      <WeatherIcon weather={dayGlance(weather)} />
    </span>
  );
}

/** Der Abschnitt „Wetter“ in der Tagesansicht. */
export function DayWeatherBlock({ weather, zone }: { weather: DayWeather; zone: WeatherZone }) {
  const effects = dayEffects(weather);
  const where = zone.from?.name;
  return (
    <div className="wf-wetter-day">
      <div className="wf-wetter-day__head">
        <WeatherIcon weather={dayGlance(weather)} />
        <b>{weather.sheltered ? 'Kein Wetter' : describeWeather(dayGlance(weather))}</b>
        {!weather.sheltered && (
          <span className="wf-num">
            {temperatureLabel(weather.low)} bis {temperatureLabel(weather.high)}
          </span>
        )}
      </div>
      {!weather.sheltered && (
        <div className="wf-wetter-day__parts">
          {weather.parts.map((part) => (
            <div key={part.key}>
              <span>{DAY_PART_LABEL[part.key]}</span>
              <b className="wf-num">{temperatureLabel(part.temperature)}</b>
              <em>
                {part.fog
                  ? 'Nebel'
                  : part.precipitation === 'heavy'
                    ? 'stark'
                    : part.precipitation === 'light'
                      ? 'leicht'
                      : '–'}
              </em>
            </div>
          ))}
        </div>
      )}
      {effects.map((effect) => (
        <p key={effect.title} className="wf-wetter-day__effect" title={effect.rule}>
          <b>{effect.title}</b> – {effect.rule}
        </p>
      ))}
      <p className="wf-wetter-day__where">
        {weather.manual ? 'Von dir festgelegt' : 'Errechnet'} für{' '}
        {where ? `die Gegend um ${where}` : 'den Ort der Gruppe'} ({zone.climate.name}).
        {weather.note ? ` ${weather.note}` : ''}
      </p>
    </div>
  );
}
