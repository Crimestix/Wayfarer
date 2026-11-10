/** Wetter: was die Oberfläche davon zeigt. Die Rechnung steht in `domain/weather.ts`. */
import { useMemo } from 'react';
import { useData, useDb } from '../../data/hooks';
import { dayIndexOf, MINUTES_PER_DAY } from '../../domain/time/calendar';
import { describeWeather, temperatureLabel } from '../../domain/weather';
import { warmestMonth, weatherAt } from '../../domain/weatherZone';
import { Select, cx } from '../../ui';
import { setWarmestMonth } from './actions';
import { WeatherIcon } from './WeatherChip';
import './wetter.css';

export { WeatherChip } from './WeatherChip';

/** Das Wetter am Ort der Gruppe als eine Zeile – für den Kopf des Ortes am Spieltisch. */
export function WeatherLine() {
  const data = useData();
  const placeId = data.state.placeId;
  const now = data.state.now;
  const weather = useMemo(() => weatherAt(data, placeId, now), [data, placeId, now]);
  if (!placeId) return null;
  const hour = (now - dayIndexOf(now) * MINUTES_PER_DAY) / 60;
  const alert = weather.effects.length > 0;
  return (
    <span
      className={cx('wf-wetter-line', alert && 'wf-wetter-line--alert')}
      title={
        alert
          ? weather.effects.map((effect) => `${effect.title}: ${effect.rule}`).join('\n')
          : 'Das Wetter am Ort der Gruppe – mehr dazu oben in der Leiste'
      }
    >
      <WeatherIcon weather={weather.now} night={hour < 6 || hour >= 20} />
      {weather.today.sheltered
        ? `Unter der Erde · ${temperatureLabel(weather.now.temperature)}`
        : `${temperatureLabel(weather.now.temperature)} · ${describeWeather(weather.now)}`}
    </span>
  );
}

/** Auswahl des wärmsten Monats: Danach richten sich die Jahreszeiten des Wetters. */
export function SeasonSetting() {
  const db = useDb();
  const data = useData();
  const months = data.campaign.calendar.months;
  const chosen = data.campaign.warmestMonth;
  const derived = warmestMonth({ ...data, campaign: { ...data.campaign, warmestMonth: null } });
  return (
    <div className="wf-wetter-season">
      <Select
        value={chosen === null ? '' : String(chosen)}
        aria-label="Wärmster Monat des Jahres"
        onChange={(e) => setWarmestMonth(db, e.target.value === '' ? null : Number(e.target.value))}
      >
        <option value="">Von Wayfarer angenommen: {months[derived]?.name}</option>
        {months.map((month, index) => (
          <option key={month.name} value={index}>
            {month.name}
          </option>
        ))}
      </Select>
      <p className="wf-einstellungen-footnote">
        Der wärmste Monat des Jahres. Ein halbes Jahr später ist tiefer Winter; dazwischen wird das
        Wetter fließend wärmer und kälter.
      </p>
    </div>
  );
}
