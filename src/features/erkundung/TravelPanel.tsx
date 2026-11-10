/**
 * Reise auf der Hexkarte: wo die Gruppe steht, wie weit sie heute gekommen ist, wie das Wetter
 * ist, und der eine Handgriff „weiter Richtung Ziel“. Nach jedem Schritt steht hier, was er
 * gebracht hat – Entdecktes, Vorbereitetes, Würfe auf Tabellen, eingetretene Termine.
 */
import { useMemo } from 'react';
import { Footprints, Flag, MapPin, TriangleAlert, Undo2 } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { entityName } from '../../domain/derive';
import { PACES, type Area, type Pace } from '../../domain/schema';
import { PACE_LABEL, TERRAIN_LABEL } from '../../domain/terrain';
import { formatClock, formatDuration } from '../../domain/time/calendar';
import { describeWeather, temperatureLabel } from '../../domain/weather';
import { weatherAt } from '../../domain/weatherZone';
import { openMoveParty } from '../../shell/commands';
import { Button, Panel, Select } from '../../ui';
import { WeatherIcon } from '../wetter/WeatherChip';
import { placeParty, setTravelPace, type TravelResult } from './actions';
import {
  TRAVEL_HOURS,
  effectivePace,
  forcedMarch,
  hexMinutes,
  hexOfPlace,
  traveledToday,
  type Route,
} from './travel';

const MARCH_RULE = (hours: number, dc: number) =>
  `Gewaltmarsch: ${hours === 1 ? 'eine Stunde' : `${hours} Stunden`} über acht. Am Ende jeder dieser Stunden legt jeder einen Konstitutionsrettungswurf ab (jetzt SG ${dc}) oder erhält eine Stufe Erschöpfung.`;

function LastStep({ last, onUndo }: { last: TravelResult; onUndo: () => void }) {
  const data = useData();
  const { step, time } = last;
  const hex = step.target;
  const terrain = hex.terrain ? TERRAIN_LABEL[hex.terrain] : 'offenes Gelände';
  const lines: { key: string; alert?: boolean; text: string }[] = [];
  if (hex.prepared)
    lines.push({ key: 'prepared', alert: true, text: `Was hier wartet: ${hex.prepared}` });
  if (hex.feature) lines.push({ key: 'feature', text: `Besonderheit: ${hex.feature}` });
  if (hex.note) lines.push({ key: 'note', text: `Notiz: ${hex.note}` });
  for (const encounter of step.encounters)
    lines.push({
      key: `table-${encounter.table.id}`,
      alert: true,
      text: `${encounter.table.name}: ${encounter.text} (${encounter.check !== null ? `Prüfung ${encounter.check}, ` : ''}Wurf ${encounter.roll})`,
    });
  for (const occurred of time.occurred)
    lines.push({
      key: `event-${occurred.event.id}-${occurred.at}`,
      text: `Eingetreten: ${occurred.event.title}`,
    });
  for (const timer of time.expired)
    lines.push({ key: `timer-${timer.id}`, text: `Abgelaufen: ${timer.label}` });
  if (step.march)
    lines.push({ key: 'march', alert: true, text: MARCH_RULE(step.march.hours, step.march.dc) });

  return (
    <div className="wf-erk-last" role="status">
      <div className="wf-erk-last__head">
        <span>
          <strong>{formatDuration(step.minutes)}</strong> durch {terrain}
          {step.slowed && ` – das Gelände lässt nur „${PACE_LABEL[step.pace]}“ zu`}
        </span>
        <Button size="sm" variant="ghost" icon={<Undo2 />} onClick={onUndo}>
          Zurück
        </Button>
      </div>
      {step.revealed > 0 && (
        <div className="wf-erk-last__line">
          {step.revealed === 1 ? 'Ein Feld' : `${step.revealed} Felder`} neu entdeckt.
        </div>
      )}
      {lines.map((line) => (
        <div key={line.key} className="wf-erk-last__line" data-alert={line.alert || undefined}>
          {line.alert && <TriangleAlert aria-hidden />}
          <span>{line.text}</span>
        </div>
      ))}
      {step.arrivedAt && data.state.placeId !== step.arrivedAt && (
        <Button
          variant="primary"
          size="sm"
          icon={<MapPin />}
          onClick={() => openMoveParty({ placeId: step.arrivedAt! })}
        >
          Ankunft: Gruppe nach {entityName(data, step.arrivedAt)} versetzen
        </Button>
      )}
    </div>
  );
}

export function TravelPanel({
  area,
  route,
  last,
  onMove,
  onUndo,
}: {
  area: Area;
  /** Der schnellste Weg zum Ziel der Karte, wenn es einen gibt. */
  route: Route | null;
  /** Der letzte Schritt, solange er sich zurücknehmen lässt. */
  last: TravelResult | null;
  onMove: (coord: { q: number; r: number }) => void;
  onUndo: () => void;
}) {
  const db = useDb();
  const data = useData();
  const now = data.state.now;
  const party = area.party;
  const start = hexOfPlace(area, area.fromId);
  const goalName = area.toId ? entityName(data, area.toId) : null;
  // Das Wetter der Gegend: gelesen am Start der Karte, sonst am Ziel.
  const weather = useMemo(
    () => weatherAt(data, area.fromId ?? area.toId, now),
    [data, area.fromId, area.toId, now],
  );

  if (!party)
    return (
      <Panel title="Reise">
        <div className="wf-col" style={{ gap: 'var(--s-3)' }}>
          <p className="wf-erk-detail__where">
            Die Gruppe steht noch nicht auf dieser Karte. Stell sie auf – dann zieht sie Feld für
            Feld, und die Weltzeit läuft mit.
          </p>
          {start && (
            <Button
              variant="primary"
              icon={<Footprints />}
              onClick={() => placeParty(db, area.id, start)}
            >
              Am Start aufstellen{area.fromId ? `: ${entityName(data, area.fromId)}` : ''}
            </Button>
          )}
          <p className="wf-erk-detail__where">
            Oder ein Feld anklicken und dort „Gruppe hier aufstellen“ wählen.
          </p>
        </div>
      </Panel>
    );

  const here = area.hexes.find((hex) => hex.q === party.q && hex.r === party.r);
  const today = traveledToday(area, now);
  const march = forcedMarch(today);
  const left = TRAVEL_HOURS * 60 - today;
  const next = route?.steps[0];
  const nextHex = next ? area.hexes.find((hex) => hex.q === next.q && hex.r === next.r) : undefined;
  // Die Dauer des nächsten Schritts ergibt sich aus dem Gelände des Feldes.
  const nextMinutes = nextHex ? hexMinutes(area.hexKm, nextHex.terrain, party.pace) : null;
  // Reicht der Tag noch, steht die Ankunftszeit da; sonst, wie viele Reisetage es werden.
  const arrival = !route
    ? ''
    : route.minutes <= Math.max(0, left)
      ? ` · Ankunft gegen ${formatClock(now + route.minutes)}`
      : route.minutes <= TRAVEL_HOURS * 60
        ? ' · heute nicht mehr ohne Gewaltmarsch'
        : ` · ${Math.ceil(route.minutes / (TRAVEL_HOURS * 60))} Reisetage zu acht Stunden`;
  const limited = here?.terrain && effectivePace(here.terrain, party.pace) !== party.pace;

  return (
    <Panel
      title="Reise"
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => placeParty(db, area.id, null)}
          title="Die Gruppe ist nicht mehr auf dieser Karte unterwegs"
        >
          Von der Karte nehmen
        </Button>
      }
    >
      <div className="wf-col" style={{ gap: 'var(--s-3)' }}>
        <div className="wf-erk-travel__where">
          <Footprints aria-hidden />
          <span>
            <strong>
              {here?.placeId
                ? entityName(data, here.placeId)
                : here?.feature || (here?.terrain ? TERRAIN_LABEL[here.terrain] : 'Unterwegs')}
            </strong>
            {here?.terrain && (here.placeId || here.feature) && ` · ${TERRAIN_LABEL[here.terrain]}`}
          </span>
        </div>

        <div className="wf-erk-travel__grid">
          <span className="wf-erk-travel__label">Tempo</span>
          <Select
            value={party.pace}
            aria-label="Reisetempo"
            onChange={(e) => setTravelPace(db, area.id, e.target.value as Pace)}
          >
            {PACES.map((pace) => (
              <option key={pace} value={pace}>
                {PACE_LABEL[pace]}
              </option>
            ))}
          </Select>

          <span className="wf-erk-travel__label">Heute</span>
          <span data-alert={march ? true : undefined}>
            {today === 0 ? 'noch nicht gereist' : `${formatDuration(today)} gereist`}
            {march
              ? ' – Gewaltmarsch'
              : today > 0 && ` · noch ${formatDuration(left)} bis zur Grenze von acht Stunden`}
          </span>

          <span className="wf-erk-travel__label">Wetter</span>
          <span
            className="wf-erk-travel__weather"
            data-alert={weather.effects.length ? true : undefined}
            title={weather.effects.map((effect) => `${effect.title}: ${effect.rule}`).join('\n')}
          >
            <WeatherIcon weather={weather.now} />
            {weather.today.sheltered
              ? `Unter der Erde · ${temperatureLabel(weather.now.temperature)}`
              : `${temperatureLabel(weather.now.temperature)} · ${describeWeather(weather.now)}`}
          </span>

          {goalName && (
            <>
              <span className="wf-erk-travel__label">Ziel</span>
              <span>
                {!route
                  ? `Zu ${goalName} führt von hier kein Weg über Land.`
                  : route.steps.length === 0
                    ? `Die Gruppe ist am Ziel: ${goalName}.`
                    : `${route.steps.length === 1 ? 'Noch ein Feld' : `Noch ${route.steps.length} Felder`} bis ${goalName} · ${formatDuration(route.minutes)} Reisezeit${arrival}`}
              </span>
            </>
          )}
        </div>

        {limited && (
          <p className="wf-erk-detail__where">
            Hier lässt das Gelände höchstens „
            {PACE_LABEL[effectivePace(here!.terrain, party.pace)!]}“ zu.
          </p>
        )}
        {march && <p className="wf-erk-travel__march">{MARCH_RULE(march.hours, march.dc)}</p>}

        {next && goalName && (
          <Button
            variant="primary"
            icon={<Flag />}
            onClick={() => onMove(next)}
            title={`Ein Feld weiter auf dem schnellsten Weg nach ${goalName}`}
          >
            Weiterziehen{nextMinutes !== null && ` · ${formatDuration(nextMinutes)}`}
          </Button>
        )}
        {route?.steps.length === 0 && area.toId && data.state.placeId !== area.toId && (
          <Button
            variant="primary"
            icon={<MapPin />}
            onClick={() => openMoveParty({ placeId: area.toId! })}
          >
            Gruppe nach {goalName} versetzen
          </Button>
        )}

        {last && <LastStep last={last} onUndo={onUndo} />}
      </div>
    </Panel>
  );
}
