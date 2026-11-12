/**
 * „Die Welt dreht sich weiter“ – nur für den Spielleiter: was abseits der Gruppe geschieht. Rechts
 * die Uhren und was beobachtet wird, links das Geschehen nach Gewicht; der Rest ist eingeklappt.
 * Die Rechnung steht in `domain/worldTurn.ts`.
 */
import { useMemo, useState } from 'react';
import { CalendarDays, CloudRain, Eye, Milestone, PackageX, Plus, X } from 'lucide-react';
import { resumeClock } from '../../data/actions';
import { useData, useDb } from '../../data/hooks';
import { scheduleText } from '../../domain/runs';
import type { Clock, Run } from '../../domain/schema';
import { untilText } from '../../domain/story';
import { dayIndexOf, formatDayMonth } from '../../domain/time/calendar';
import {
  TURN_DAYS,
  TURN_DAYS_ALL,
  turnDays,
  watchedEntities,
  worldTurn,
  type TurnItem,
} from '../../domain/worldTurn';
import { Button, EmptyState, EntityLink, EntityPicker, KindIcon, cx, toast } from '../../ui';
import { decideTrip, setWatch } from './actions';
import { RunDialog } from './RunDialog';
import { useFocus } from '../../shell/focus';
import { ClockDialog } from '../kalender/ClockDialog';
import './geschehen.css';

const ICON = {
  change: Milestone,
  event: CalendarDays,
  ways: CloudRain,
  missing: PackageX,
} as const;

export default function GeschehenPage() {
  const db = useDb();
  const data = useData();
  const [all, setAll] = useState(false);
  const [clock, setClock] = useState<Clock | null>(null);
  // Der Überblick reicht bis vor den letzten Zeitsprung zurück – nichts davon fällt heraus.
  const days = turnDays(data);
  const turn = useMemo(
    () => worldTurn(data, all ? Math.max(TURN_DAYS_ALL, days) : days),
    [data, all, days],
  );
  const watched = useMemo(() => watchedEntities(data), [data]);
  const now = data.state.now;
  /** Der Ablauf im Dialog – `'new'` für einen neuen. */
  const [run, setRun] = useState<Run | 'new' | null>(null);
  const cal = data.campaign.calendar;
  // Aus der Suche geöffnet: Die gesuchte Uhr oder der Ablauf geht gleich auf.
  useFocus(['clock', 'run'], (focus) => {
    if (focus.type === 'clock') setClock(data.clocks[focus.id] ?? null);
    else setRun(data.runs[focus.id] ?? null);
  });
  const nothing = !turn.watched.length && !turn.weighty.length && !turn.rest.length;
  const decide = (runId: string, departs: number, verdict: 'missed' | 'ran') => {
    const undo = decideTrip(db, runId, departs, verdict);
    toast({
      title: verdict === 'missed' ? 'Die Fahrt ist ausgefallen' : 'Die Fahrt fand statt',
      body:
        verdict === 'missed'
          ? 'Am Ziel bleibt sie aus. Uhren, die an ihr hängen, bleiben stehen.'
          : 'Der Vorschlag ist erledigt.',
      action: { label: 'Rückgängig', run: undo },
    });
  };

  return (
    <div className="wf-page wf-turn">
      <header className="wf-page__head wf-turn-head">
        <div>
          <h1 className="wf-page__title">Die Welt dreht sich weiter</h1>
          <p className="wf-page__lead">
            Was abseits der Gruppe geschieht – nur für dich. Was nah an der Gruppe ist oder jemanden
            betrifft, den sie kennt, steht oben.
          </p>
        </div>
        <span className="wf-grow" />
        <div className="wf-btn-group" role="group" aria-label="Umfang">
          <Button
            aria-pressed={!all}
            title={
              days > TURN_DAYS
                ? `Die letzten ${days} Tage – seit dem letzten Zeitsprung oder dem Beginn der Session; Entferntes eingeklappt`
                : `Die letzten ${days} Tage; Entferntes eingeklappt`
            }
            onClick={() => setAll(false)}
          >
            Überblick
          </Button>
          <Button
            aria-pressed={all}
            title={`Die letzten ${Math.max(TURN_DAYS_ALL, days)} Tage, alles aufgeklappt`}
            onClick={() => setAll(true)}
          >
            Alles
          </Button>
        </div>
      </header>

      <div className="wf-turn-body">
        <div className="wf-turn-main">
          {turn.watched.length > 0 && (
            <section className="wf-turn-section">
              <h2 className="wf-turn-section__title">Beobachtet</h2>
              {turn.watched.map((item) => (
                <Row key={item.key} item={item} />
              ))}
            </section>
          )}
          <section className="wf-turn-section">
            <h2 className="wf-turn-section__title">Nah an der Gruppe</h2>
            {turn.weighty.map((item) => (
              <Row key={item.key} item={item} />
            ))}
            {!turn.weighty.length && (
              <p className="wf-turn-none">
                {nothing
                  ? 'Noch ist nichts geschehen. Hier steht, was die Uhren bewegen, welche Ereignisse eintreten und was das Wetter aus den Wegen macht – sobald die Zeit vergeht.'
                  : 'Nichts davon berührt gerade die Gruppe.'}
              </p>
            )}
          </section>
          {turn.rest.length > 0 && (
            <details className="wf-turn-rest" open={all}>
              <summary>
                Weit weg
                <span>
                  {turn.rest.length === 1 ? 'ein Eintrag' : `${turn.rest.length} Einträge`}
                </span>
              </summary>
              {turn.rest.map((item) => (
                <Row key={item.key} item={item} />
              ))}
            </details>
          )}
        </div>

        <aside className="wf-turn-side">
          {turn.suggestions.length > 0 && (
            <section className="wf-turn-section">
              <h2 className="wf-turn-section__title wf-turn-section__title--ask">
                Vorschläge
                <span>{turn.suggestions.length}</span>
              </h2>
              {turn.suggestions.map((entry) => (
                <div key={entry.key} className="wf-turn-ask">
                  <div className="wf-turn-ask__title">{entry.title}</div>
                  <p>{entry.why}</p>
                  <div className="wf-turn-ask__acts">
                    {entry.kind === 'trip' ? (
                      <>
                        <Button
                          size="sm"
                          title="Am Ziel bleibt die Fahrt aus; Uhren, die an ihr hängen, bleiben stehen"
                          onClick={() => decide(entry.trip.run.id, entry.trip.departs, 'missed')}
                        >
                          Fällt aus
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Sie sind trotzdem durchgekommen"
                          onClick={() => decide(entry.trip.run.id, entry.trip.departs, 'ran')}
                        >
                          Fand statt
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => setClock(entry.clock)}>
                          Uhr öffnen
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Der nächste Schritt hängt dann nicht mehr an seiner Bedingung"
                          onClick={() => resumeClock(db, entry.clock.id)}
                        >
                          Trotzdem weiter
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              <p className="wf-turn-none">
                Was hier steht, ist nicht sicher geschehen. Du entscheidest; eine fragliche Fahrt
                gilt nach zwei Wochen als gefahren.
              </p>
            </section>
          )}
          <section className="wf-turn-section">
            <h2 className="wf-turn-section__title">Uhren</h2>
            {turn.clocks.map((view) => (
              <button
                key={view.clock.id}
                type="button"
                className="wf-turn-clock"
                onClick={() => setClock(view.clock)}
                title="Uhr öffnen"
              >
                <span className="wf-turn-clock__title">{view.clock.title}</span>
                <span className="wf-turn-clock__pips" aria-hidden>
                  {view.steps.map((step) => (
                    <i key={step.step.id} data-state={step.state} />
                  ))}
                </span>
                <span className="wf-turn-clock__next" data-blocked={Boolean(view.blocked)}>
                  {view.blocked
                    ? `Blockiert vor: ${view.next?.step.text ?? ''}`
                    : view.next
                      ? `${view.paused ? 'Angehalten vor' : untilText(view.next.at - now)}: ${view.next.step.text}`
                      : 'Alles ist geschehen.'}
                </span>
              </button>
            ))}
            {!turn.clocks.length && (
              <p className="wf-turn-none">
                Keine Uhr läuft. Eine Uhr ist ein Vorhaben der Welt, das ohne die Gruppe weitergeht
                – angelegt im Kalender.
              </p>
            )}
          </section>
          <section className="wf-turn-section">
            <h2 className="wf-turn-section__title">
              Abläufe
              <span className="wf-grow" />
              <Button size="sm" icon={<Plus aria-hidden />} onClick={() => setRun('new')}>
                Ablauf
              </Button>
            </h2>
            {turn.runs.map((status) => {
              const [from, to] = [
                data.entities[status.run.fromId]?.name ?? '?',
                data.entities[status.run.toId]?.name ?? '?',
              ];
              return (
                <button
                  key={status.run.id}
                  type="button"
                  className="wf-turn-clock"
                  onClick={() => setRun(status.run)}
                  title="Ablauf öffnen"
                >
                  <span className="wf-turn-clock__title">{status.run.name}</span>
                  <span className="wf-turn-clock__sub">
                    {from} → {to} · {scheduleText(status.run)}
                    {status.run.carrier && ` · ${status.run.carrier}`}
                  </span>
                  <span className="wf-turn-clock__next" data-blocked={status.phase === 'stopped'}>
                    {status.phase === 'stopped'
                      ? `Fährt nicht: ${status.problem}`
                      : status.current
                        ? `Unterwegs – Ankunft ${untilText(status.current.arrives - now)}${status.current.delay > 0 ? ', vom Wetter aufgehalten' : ''}`
                        : status.next
                          ? `Nächste Abfahrt ${untilText(status.next.departs - now)} (${formatDayMonth(cal, status.next.departs)})`
                          : 'Keine Abfahrt in Sicht'}
                    {status.noRoute && status.phase !== 'stopped' && ' · kein Weg im Wegenetz'}
                  </span>
                </button>
              );
            })}
            {!turn.runs.length && (
              <p className="wf-turn-none">
                Noch kein Ablauf. Ein Ablauf ist eine Reise, die sich wiederholt – eine Lieferung,
                eine Patrouille, ein Bote – mit Strecke und Fahrplan. Bleibt er aus, weiß Wayfarer,
                wann am Ziel etwas fehlt.
              </p>
            )}
          </section>
          <section className="wf-turn-section">
            <h2 className="wf-turn-section__title">
              <Eye aria-hidden /> Ich beobachte
            </h2>
            {watched.map((entity) => (
              <div key={entity.id} className="wf-turn-watch">
                <KindIcon kind={entity.kind} />
                <EntityLink id={entity.id} />
                <button
                  type="button"
                  aria-label={`${entity.name} nicht mehr beobachten`}
                  onClick={() => setWatch(db, entity.id, false)}
                >
                  <X aria-hidden />
                </button>
              </div>
            ))}
            <EntityPicker
              value={null}
              onChange={(id) => id && setWatch(db, id, true)}
              kinds={['person', 'place', 'faction', 'family']}
              exclude={data.state.watch}
              placeholder="Person, Ort oder Fraktion beobachten …"
            />
            <p className="wf-turn-none">
              Alles zu ihnen steht ganz oben – egal, wie weit die Gruppe weg ist.
            </p>
          </section>
        </aside>
      </div>

      {run && (
        <RunDialog
          key={run === 'new' ? 'neu' : run.id}
          run={run === 'new' ? null : run}
          onClose={() => setRun(null)}
        />
      )}
      {nothing && turn.clocks.length === 0 && watched.length === 0 && turn.runs.length === 0 && (
        <div className="wf-turn-blank">
          <EmptyState icon={<Milestone aria-hidden />} title="Die Welt steht noch still">
            Leg im Kalender eine Uhr an – ein Vorhaben, das ohne die Gruppe weiterläuft – oder lass
            Zeit vergehen. Was dann geschieht, sammelt sich hier.
          </EmptyState>
        </div>
      )}
      {clock && <ClockDialog key={clock.id} clock={clock} onClose={() => setClock(null)} />}
    </div>
  );
}

/** Ein Eintrag: was geschah, wann, wo – und warum es so viel wiegt. */
function Row({ item }: { item: TurnItem }) {
  const data = useData();
  const cal = data.campaign.calendar;
  const Icon = ICON[item.kind];
  const ago = item.at === null ? null : dayIndexOf(data.state.now) - dayIndexOf(item.at);
  const when =
    item.at === null || ago === null
      ? 'gilt jetzt'
      : `${ago === 0 ? 'heute' : ago === 1 ? 'gestern' : `vor ${ago} Tagen`} · ${formatDayMonth(cal, item.at)}`;
  const links = [...(item.kind === 'ways' ? [] : [item.placeId, ...item.refs])].filter(
    (id): id is string => !!id && data.entities[id] !== undefined,
  );
  return (
    <div className={cx('wf-turn-row', `wf-turn-row--w${item.weight}`)}>
      <Icon aria-hidden />
      <div className="wf-turn-row__main">
        <div className="wf-turn-row__title">{item.title}</div>
        {item.detail.map((line) => (
          <div key={line} className="wf-turn-row__detail">
            {line}
          </div>
        ))}
        <div className="wf-turn-row__meta">
          <b>{when}</b> · {item.why}
          {[...new Set(links)].slice(0, 4).map((id) => (
            <EntityLink key={id} id={id} />
          ))}
        </div>
      </div>
    </div>
  );
}
