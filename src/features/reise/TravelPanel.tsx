/**
 * „Unterwegs“: Solange die Gruppe reist, steht links am Spieltisch die Reise statt eines Ortes –
 * woher, wohin, wie weit, Gelände, Licht, wer mitzieht, Vorräte. Der Knopf „Bis zur nächsten
 * Entscheidung“ reist weiter und hält von selbst an, wenn der Spielleiter etwas entscheiden muss
 * (`travelOn`). Die Rechnung steht in `domain/journey.ts`.
 */
import { useMemo, useState } from 'react';
import { Check, Flag, MapPin, Search, Sprout, Swords, Tent } from 'lucide-react';
import { useLocation } from 'wouter';
import { useData, useDb } from '../../data/hooks';
import { activeParty } from '../../domain/derive';
import { partyCompanions } from '../../domain/history';
import { HALT_LABEL, bountyOf, journeyView, type JourneyView } from '../../domain/journey';
import { animalFeedText, bodyCheckOf, forageText, marchDc } from '../../domain/travelRules';
import { BodyCheck } from './BodyCheck';
import { afarFrom, sightingLine } from '../../domain/afar';
import { sameHex } from '../../domain/hex';
import { kindLabelOf } from '../../domain/hexKinds';
import { sensesAt } from '../../domain/senses';
import { searchMinutes } from '../erkundung/travel';
import { hexAtProgress } from './hexway';
import { TRAVEL_HOURS, forcedMarch, marchRule } from '../../domain/march';
import { partyMeans } from '../../domain/mounts';
import type { Journey } from '../../domain/schema';
import { isUnderground, lightStatus } from '../../domain/underground';
import { formatWayTime } from '../../domain/ways';
import { openQuickLog, openRest } from '../../shell/commands';
import { Button, Input, Panel, cx, toast } from '../../ui';
import { fairDie } from '../bestiarium/model';
import {
  addSupplies,
  campCheck,
  clearHalt,
  endJourney,
  getLost,
  searchOnJourney,
  travelOn,
} from './actions';
import { HEADING_LABEL } from '../../domain/journey';
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
  const [foraging, setForaging] = useState(false);
  const [, navigate] = useLocation();
  /**
   * Wer wen bemerkt (Regelwerk): die beste passive Wahrnehmung der Gruppe gegen die Heimlichkeit
   * der Wesen – wer nichts bemerkt, ist überrascht und hat Nachteil auf die Initiative.
   */
  const watchful = party
    .map((member) => ({ name: member.name, value: member.character.passivePerception }))
    .filter((entry): entry is { name: string; value: number } => entry.value !== null)
    .sort((a, b) => b.value - a.value)[0];
  const notice = watchful
    ? `Bemerken: passive Wahrnehmung ${watchful.value} (${watchful.name}) gegen Geschicklichkeit (Heimlichkeit) der Wesen. Wer nichts bemerkt, ist überrascht – Nachteil auf die Initiative.`
    : 'Bemerken: passive Wahrnehmung der Gruppe gegen Geschicklichkeit (Heimlichkeit) der Wesen. Wer nichts bemerkt, ist überrascht – Nachteil auf die Initiative.';
  const leg = journey.legs[journey.progress.leg];
  /** Was die Gegend hier hergibt: an der Landschaft des Feldes, sonst an der Gegend des Weges. */
  const bounty = bountyOf(data, leg?.regionId ?? leg?.toId ?? null, hexHere?.landscapeId ?? null);
  /** Reist die Gruppe mit Tieren, erinnert der Halt bei Hunger und Durst an ihr Futter. */
  const feed = animalFeedText(partyMeans(data), bounty.yield, bounty.water);

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
      body: found
        ? `${found.text} – nach ${found.hour === 1 ? 'einer Stunde' : `${found.hour} Stunden`} Rast. Die Rast zeigt, wer dann wacht.`
        : 'Die Prüfung im Lager ergab nichts.',
    });
    // Die Begegnung trifft die Wache dieser Stunde: Die Rast ist dort schon als gestört vorgewählt.
    openRest(
      'long',
      found ? { hour: found.hour, reason: `Begegnung in der Nacht: ${found.text}` } : undefined,
    );
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
      scroll
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

      {/* Zuerst, was jetzt zu entscheiden ist (der Halt) und wie es weitergeht; darunter der Stand. */}
      {halt && (
        <div className={cx('wf-reise__halt', `wf-reise__halt--${halt.kind}`)} role="status">
          <span className="wf-caps">Halt: {HALT_LABEL[halt.kind]}</span>
          {halt.text && <p>{halt.text}</p>}
          {halt.roll && <span className="wf-reise__roll">{halt.roll}</span>}
          {halt.kind === 'encounter' && notice && <p className="wf-reise__notice">{notice}</p>}
          {(halt.kind === 'hunger' || halt.kind === 'thirst') && feed && (
            <p className="wf-reise__notice">{feed}</p>
          )}
          {bodyCheckOf(halt.kind, halt.text) && (
            <BodyCheck
              key={`${halt.kind}-${halt.at}`}
              check={bodyCheckOf(halt.kind, halt.text)!}
              members={party}
              allToo={halt.kind === 'hunger' && halt.text.includes('Durst')}
            />
          )}
          <div className="wf-reise__haltacts">
            {halt.kind === 'dark' && (
              <>
                <Button size="sm" icon={<Tent />} onClick={camp}>
                  Lager aufschlagen
                </Button>
                <Button
                  size="sm"
                  onClick={() => clearHalt(db)}
                  title="Mit Fackel oder Laterne weiter – die Lichter der Gruppe stehen bei den Gefährten"
                >
                  Mit Licht weiter
                </Button>
              </>
            )}
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
                        body: `${lost.heading !== null ? `Die Gruppe kommt nach ${HEADING_LABEL[lost.heading]} ab – ` : ''}etwa ${lost.hours} ${lost.hours === 1 ? 'Stunde' : 'Stunden'} Umweg. Das kostet die nächste Etappe; die Hexkarte zeigt den Umweg.`,
                        action: { label: 'Rückgängig', run: lost.undo },
                      });
                  }}
                >
                  Verirrt
                </Button>
              </>
            )}
            {halt.kind === 'encounter' && halt.encounterId && data.encounters[halt.encounterId] && (
              <Button
                size="sm"
                icon={<Swords />}
                onClick={() => navigate(`/begegnungen/${halt.encounterId}`)}
                title="Die Begegnung mit Anzahl und eigenen Trefferpunkten – Schwierigkeit gegen die Gruppe"
              >
                Begegnung öffnen
              </Button>
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

      {foraging && (
        <ForageForm
          text={forageText(bounty.yield, bounty.water)}
          onDone={() => setForaging(false)}
        />
      )}
      <div className="wf-reise__acts">
        <Button
          className="wf-reise__go"
          onClick={() => go(null)}
          title="Reist weiter und hält von selbst – an allem, was entschieden oder geprobt werden muss"
        >
          Bis zur nächsten Entscheidung
        </Button>
        <Button size="sm" onClick={() => go(60)}>
          1 Stunde
        </Button>
        <Button size="sm" icon={<Tent />} onClick={camp} title="Nachtprüfung, dann die Rast">
          Lager aufschlagen
        </Button>
        <Button
          size="sm"
          icon={<Sprout />}
          aria-expanded={foraging}
          onClick={() => setForaging((on) => !on)}
          title={forageText(bounty.yield, bounty.water)}
        >
          Nahrung suchen
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
          {/* Steht der Gewaltmarsch gerade als Halt da, sagt die Zeile ihn nur in einem Wort. */}
          {march &&
            (halt?.kind === 'march' ? (
              <span className="wf-reise__tag">Gewaltmarsch</span>
            ) : (
              <span className="wf-reise__note" title={marchRule(march)}>
                Gewaltmarsch – am Ende der nächsten Stunde: Konstitutionsrettungswurf SG{' '}
                {marchDc(Math.floor((view.sinceRest - TRAVEL_HOURS * 60) / 60) + 1)}
              </span>
            ))}
        </dd>
        <dt>Gelände</dt>
        <dd>
          {view.ground?.word ||
            (hexHere ? (
              <span>
                {(hexHere.landscapeId && data.entities[hexHere.landscapeId]?.name) ||
                  kindLabelOf(hexHere)}{' '}
                <span className="wf-mute">(Hexkarte)</span>
              </span>
            ) : (
              <span className="wf-mute">nichts eingetragen</span>
            ))}
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

      <p className="wf-reise__hint">
        Hält an bei: Ort am Weg · Vorbereitetem · Gefahr · Begegnung · etwas in Sicht · Termin ·
        Licht aus · Dunkelheit · acht Stunden · Gewaltmarsch · Kälte und Hitze · Hunger und Durst
      </p>
    </Panel>
  );
}

function Supply({ label, left, start }: { label: string; left: number; start: number }) {
  const share = start > 0 ? Math.max(0, Math.min(1, left / start)) : 0;
  return (
    <span className={cx('wf-reise__supply', left <= 1 && 'is-warn')}>
      <span>
        {label}: {left <= 0 ? 'aufgebraucht' : `noch ${left === 1 ? '1 Tag' : `${left} Tage`}`}
      </span>
      <span className="wf-reise__supplybar" aria-hidden>
        <i style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
    </span>
  );
}

/** Was die Nahrungssuche gebracht hat – in Tagen für die Gruppe, nach der Probe am Tisch. */
function ForageForm({ text, onDone }: { text: string; onDone: () => void }) {
  const db = useDb();
  const [food, setFood] = useState('');
  const [water, setWater] = useState('');
  const num = (value: string) => {
    const n = Number.parseFloat(value.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return (
    <div className="wf-reise__forage">
      <p>{text}</p>
      <div className="wf-row" style={{ gap: 'var(--s-2)' }}>
        <Input
          value={food}
          inputMode="decimal"
          placeholder="Proviant (Tage)"
          aria-label="Gefundener Proviant in Tagen"
          onChange={(e) => setFood(e.target.value)}
        />
        <Input
          value={water}
          inputMode="decimal"
          placeholder="Wasser (Tage)"
          aria-label="Gefundenes Wasser in Tagen"
          onChange={(e) => setWater(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!num(food) && !num(water)}
          onClick={() => {
            const undo = addSupplies(db, num(food), num(water));
            onDone();
            if (undo)
              toast({
                slot: 'reise',
                title: 'Zu den Vorräten gelegt',
                action: { label: 'Rückgängig', run: undo },
              });
          }}
        >
          Dazulegen
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Nichts gefunden
        </Button>
      </div>
    </div>
  );
}
