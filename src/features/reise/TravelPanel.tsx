/**
 * „Unterwegs“: Solange die Gruppe reist, steht links am Spieltisch die Reise statt eines Ortes –
 * woher, wohin, wie weit, Gelände, Licht, wer mitzieht, Vorräte. Der Knopf „Bis zur nächsten
 * Entscheidung“ reist weiter und hält von selbst an, wenn der Spielleiter etwas entscheiden muss
 * (`travelOn`). Die Rechnung steht in `domain/journey.ts`.
 */
import { useMemo } from 'react';
import { Check, Flag, MapPin, Search, Tent } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { activeParty } from '../../domain/derive';
import { partyCompanions } from '../../domain/history';
import { HALT_LABEL, journeyView, type JourneyView } from '../../domain/journey';
import { afarFrom, sightingLine } from '../../domain/afar';
import { sameHex } from '../../domain/hex';
import { sensesAt } from '../../domain/senses';
import { searchMinutes } from '../erkundung/travel';
import { hexAtProgress } from './hexway';
import { TRAVEL_HOURS, forcedMarch, marchRule } from '../../domain/march';
import type { Journey } from '../../domain/schema';
import { isUnderground, lightStatus } from '../../domain/underground';
import { formatWayTime } from '../../domain/ways';
import { openQuickLog, openRest } from '../../shell/commands';
import { Button, Panel, cx, toast } from '../../ui';
import { fairDie } from '../bestiarium/model';
import { campCheck, clearHalt, endJourney, getLost, searchOnJourney, travelOn } from './actions';
import './reise.css';

export function TravelPanel({ journey }: { journey: Journey }) {
  const db = useDb();
  const data = useData();
  const view: JourneyView = useMemo(() => journeyView(data, journey), [data, journey]);
  const name = (id: string | null | undefined) => (id ? (data.entities[id]?.name ?? '?') : '?');
  const below = isUnderground(data, data.state.placeId);
  const light = below ? lightStatus(data) : null;
  const party = activeParty(data);
  const along = partyCompanions(data).map(
    (companion) => data.entities[companion.entityId]?.name ?? '',
  );
  const march = forcedMarch(view.sinceRest);
  const halt = journey.halt;
  // Witterung: was die Gruppe vom Feld, auf dem sie steht, ringsum bemerkt.
  const spot = hexAtProgress(journey);
  const area = spot ? data.areas[spot.areaId] : undefined;
  const senses = spot && area ? sensesAt(data, area, spot.hex) : [];
  // Was von hier aus in der Ferne zu sehen ist, und das Feld selbst (zum Durchsuchen).
  const far = spot && area ? afarFrom(area, spot.hex) : [];
  const hexHere = spot && area ? area.hexes.find((hex) => sameHex(hex, spot.hex)) : undefined;
  const searchTime = hexHere && area ? searchMinutes(data, area, hexHere) : null;

  const go = (limit: number | null) => {
    const result = travelOn(db, fairDie, limit);
    if (!result)
      toast({
        slot: 'reise',
        title: 'Nichts zu reisen',
        body: 'Die Reise hat keinen Abschnitt mehr.',
      });
    else if (result.journey.status === 'arrived')
      toast({
        slot: 'reise',
        title: `Angekommen in ${name(journey.toId)}`,
        body: 'Die Reise ist zu Ende – links steht wieder der Ort.',
        action: { label: 'Rückgängig', run: result.undo },
      });
    else
      toast({
        slot: 'reise',
        title: HALT_LABEL[result.halt.kind],
        body: `${formatWayTime(result.halt.minutes)} gereist${
          result.halt.quietChecks
            ? ` · ${result.halt.quietChecks === 1 ? 'eine Prüfung' : `${result.halt.quietChecks} Prüfungen`} ohne Folgen`
            : ''
        }.`,
        action: { label: 'Rückgängig', run: result.undo },
      });
  };
  const camp = () => {
    const found = campCheck(db, fairDie);
    toast({
      slot: 'reise',
      title: found ? 'In der Nacht: etwas geschieht' : 'Die Nacht bleibt ruhig',
      body: found ? found.text : 'Die Prüfung im Lager ergab nichts.',
    });
    openRest('long');
  };
  const search = () => {
    const result = searchOnJourney(db, fairDie);
    if (!result) return;
    toast({
      slot: 'reise',
      title: result.found ? 'Beim Durchsuchen gefunden' : 'Nichts gefunden',
      body: [
        `${formatWayTime(result.minutes)} gesucht.`,
        result.found ?? '',
        result.encounter ? `Dabei: ${result.encounter.text}` : '',
      ]
        .filter(Boolean)
        .join(' '),
      action: { label: 'Rückgängig', run: result.undo },
    });
  };
  const end = () => {
    const undo = endJourney(db, false);
    if (undo)
      toast({
        slot: 'reise',
        title: 'Reise beendet',
        body: `Die Gruppe bleibt in ${name(data.state.placeId)}.`,
        action: { label: 'Rückgängig', run: undo },
      });
  };
  const remaining = Math.max(0, view.total - view.done);

  return (
    <Panel
      flush
      className="wf-tisch-place wf-reise"
      title="Unterwegs"
      actions={
        <Button size="sm" variant="ghost" onClick={end} title="Die Gruppe bleibt, wo sie ist">
          Reise beenden
        </Button>
      }
    >
      <div className="wf-reise__head">
        <h2 className="wf-reise__title">
          {name(journey.startId)} → {name(journey.toId)}
        </h2>
        <span className="wf-reise__sub">
          Tag {view.day} der Reise · {formatWayTime(view.done)} von {formatWayTime(view.total)}
          {remaining > 0 && ` · noch etwa ${formatWayTime(remaining)}`}
        </span>
        <div className="wf-reise__bar" aria-hidden>
          <i style={{ width: `${view.total ? Math.round((view.done / view.total) * 100) : 0}%` }} />
        </div>
      </div>

      <ol className="wf-reise__stops">
        {view.stops.map((stop, index) => (
          <li
            key={`${stop.placeId}-${index}`}
            className={cx(stop.reached && 'is-reached', stop.current && 'is-here')}
          >
            {stop.current ? (
              <MapPin aria-hidden />
            ) : stop.reached ? (
              <Check aria-hidden />
            ) : (
              <Flag aria-hidden />
            )}
            <span>{name(stop.placeId)}</span>
            {stop.current && <em>hier</em>}
          </li>
        ))}
      </ol>

      <dl className="wf-reise__facts">
        <dt>Seit der Rast</dt>
        <dd className={cx(march && 'is-warn')}>
          {formatWayTime(view.sinceRest)} von {TRAVEL_HOURS} Std.
          {march && <span className="wf-reise__note">{marchRule(march)}</span>}
        </dd>
        <dt>Gelände</dt>
        <dd>
          {view.ground?.word || <span className="wf-mute">nichts eingetragen</span>}
          {view.ground?.slow && <span className="wf-reise__tag">langsam</span>}
        </dd>
        {light && (
          <>
            <dt>Licht</dt>
            <dd className={cx(light.state === 'dark' && 'is-warn')}>{light.summary}</dd>
          </>
        )}
        <dt>Zieht mit</dt>
        <dd>{[...party.map((member) => member.name), ...along.filter(Boolean)].join(', ')}</dd>
        {(view.food !== null || view.water !== null) && (
          <>
            <dt>Vorräte</dt>
            <dd className="wf-reise__supplies">
              {view.food !== null && (
                <Supply label="Proviant" left={view.food} start={journey.supplies.food ?? 0} />
              )}
              {view.water !== null && (
                <Supply label="Wasser" left={view.water} start={journey.supplies.water ?? 0} />
              )}
            </dd>
          </>
        )}
      </dl>

      {halt && (
        <div className={cx('wf-reise__halt', `wf-reise__halt--${halt.kind}`)} role="status">
          <span className="wf-caps">Halt: {HALT_LABEL[halt.kind]}</span>
          {halt.text && <p>{halt.text}</p>}
          {halt.roll && <span className="wf-reise__roll">{halt.roll}</span>}
          <div className="wf-reise__haltacts">
            {halt.kind === 'navigate' && halt.text !== 'Wieder auf Kurs.' && (
              <>
                <Button size="sm" onClick={() => clearHalt(db)} title="Die Probe gelang">
                  Zurechtgefunden
                </Button>
                <Button
                  size="sm"
                  title="Die Probe misslang: Wayfarer würfelt den Umweg (1W6 Stunden) – er kostet die nächste Etappe"
                  onClick={() => {
                    const lost = getLost(db, fairDie);
                    if (lost)
                      toast({
                        slot: 'reise',
                        title: 'Verirrt',
                        body: `Etwa ${lost.hours} ${lost.hours === 1 ? 'Stunde' : 'Stunden'} Umweg – das kostet die nächste Etappe.`,
                        action: { label: 'Rückgängig', run: lost.undo },
                      });
                  }}
                >
                  Verirrt
                </Button>
              </>
            )}
            {(halt.kind === 'encounter' ||
              halt.kind === 'discovery' ||
              halt.kind === 'prepared' ||
              halt.kind === 'passage' ||
              halt.kind === 'sighted' ||
              halt.kind === 'search' ||
              halt.kind === 'river') && (
              <Button
                size="sm"
                onClick={() => openQuickLog({ text: halt.text })}
                title="In der Mitschrift weiterschreiben, was daraus wird"
              >
                Festhalten …
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => clearHalt(db)}>
              Zur Kenntnis
            </Button>
          </div>
        </div>
      )}

      {senses.length > 0 && (
        <div className="wf-reise__senses" aria-label="Ringsum">
          <span className="wf-caps">Ringsum</span>
          <ul>
            {senses.map((sense) => (
              <li key={sense.dir}>
                <b>{sense.where}:</b> {sense.noticed.join(' · ')}
                {sense.gm.length > 0 && <em> {sense.gm.join(' · ')}</em>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {far.length > 0 && (
        <div className="wf-reise__senses" aria-label="In der Ferne">
          <span className="wf-caps">In der Ferne</span>
          <ul>
            {far.map((sight) => (
              <li key={`${sight.hex.q},${sight.hex.r}`}>{sightingLine(sight)}</li>
            ))}
          </ul>
        </div>
      )}

      {hexHere?.hidden.trim() && !hexHere.searched && (
        <p className="wf-reise__senses">
          <em>Nur für dich – verborgen auf diesem Feld: {hexHere.hidden.trim()}</em>
        </p>
      )}

      <div className="wf-reise__acts">
        <Button
          className="wf-reise__go"
          onClick={() => go(null)}
          title="Reist weiter und hält von selbst: Ort am Weg, Vorbereitetes, Begegnung, Termin, Licht aus, acht Stunden"
        >
          Bis zur nächsten Entscheidung
        </Button>
        <Button size="sm" onClick={() => go(60)}>
          1 Stunde
        </Button>
        <Button size="sm" icon={<Tent />} onClick={camp} title="Nachtprüfung, dann die Rast">
          Lager aufschlagen
        </Button>
        {searchTime !== null && (
          <Button
            size="sm"
            icon={<Search />}
            onClick={search}
            title="Die Gruppe sucht das Feld ab: dauert so lange wie das Durchqueren, die Reise kommt nicht voran, eine Begegnungsprüfung"
          >
            Durchsuchen ({formatWayTime(searchTime)})
          </Button>
        )}
      </div>
      <p className="wf-reise__hint">
        Hält an bei: Ort am Weg · Vorbereitetem · Begegnung · etwas in Sicht · Termin · Licht aus ·
        acht Stunden
      </p>
    </Panel>
  );
}

function Supply({ label, left, start }: { label: string; left: number; start: number }) {
  const share = start > 0 ? Math.max(0, Math.min(1, left / start)) : 0;
  return (
    <span className={cx('wf-reise__supply', left <= 1 && 'is-warn')}>
      <span>
        {label}: noch {left === 1 ? '1 Tag' : `${left} Tage`}
      </span>
      <span className="wf-reise__supplybar" aria-hidden>
        <i style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
    </span>
  );
}
