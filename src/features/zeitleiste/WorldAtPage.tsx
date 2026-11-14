/**
 * Welt an einem Tag: ein Datum wählen und sehen, wie die Welt damals stand – wo die Gruppe war,
 * welcher Abend lief, wer lebte und wie alt, Schicksale, Haltungen, Besitzer, Uhren und was die
 * Gruppe schon wusste. Nur zum Nachsehen: Hier wird nichts geändert. Gerechnet wird in
 * `domain/worldAt.ts` (`worldOn`), der Tag in `model.ts`.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useRoute } from 'wouter';
import {
  ChartNoAxesGantt,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { useData } from '../../data/hooks';
import { FATE_LABEL, isApproximate } from '../../domain/chronicleKinds';
import { entityName } from '../../domain/derive';
import { formatDatePoint } from '../../domain/lifespan';
import { PARTY_ID } from '../../domain/schema';
import { entryLine } from '../../domain/timeline';
import { formatDate, formatDateTime, startOfDay, weekdayName } from '../../domain/time/calendar';
import { describeDate } from '../../domain/time/textDates';
import { worldOn, type ThenAndNow } from '../../domain/worldAt';
import { AttitudeBadge, Button, EntityLink, IconButton, Input, Panel } from '../../ui';
import { sessionLabel } from '../chronik/model';
import { dayEnd, isAfterToday, readDay, stepDay } from './model';
import './zeitleiste.css';

/** So viele Einträge mit Lebensdaten zeigt die Liste, bevor sie sich aufklappen lässt. */
const LIVES_SHOWN = 12;
/** So viele Namen nennt eine Zeile unter „Was die Gruppe wusste“. */
const NAMES_SHOWN = 10;

export default function WorldAtPage() {
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const [, params] = useRoute('/damals/:at');
  const [, navigate] = useLocation();
  const asked = params?.at !== undefined ? Number(params.at) : NaN;
  const day = Number.isFinite(asked) && asked >= 0 ? startOfDay(asked) : startOfDay(now);
  const future = isAfterToday(day, now);
  const at = dayEnd(day, now);
  const on = useMemo(() => worldOn(data, at), [data, at]);

  const go = (next: number) => navigate(`/damals/${Math.max(0, next)}`, { replace: true });
  const [text, setText] = useState(formatDate(cal, day));
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    setText(formatDate(cal, day));
    setUnread(false);
  }, [cal, day]);
  const read = () => {
    const next = readDay(cal, text, now);
    if (next === null) setUnread(true);
    else go(next);
  };

  const [allLives, setAllLives] = useState(false);
  const lives = allLives ? on.lives : on.lives.slice(0, LIVES_SHOWN);
  const today = startOfDay(now) === day;
  const weekday = weekdayName(cal, day);

  return (
    <div className="wf-page wf-damals">
      <header className="wf-page__head wf-damals-head">
        <div>
          <h1 className="wf-page__title">Welt an einem Tag</h1>
          <p className="wf-page__lead">
            Wie die Welt an einem Tag stand – nach dem, was bis zu seinem Ende festgehalten ist. Nur
            zum Nachsehen; hier ändert sich nichts.
          </p>
        </div>
        <span className="wf-grow" />
        <form
          className="wf-damals-pick"
          onSubmit={(event) => {
            event.preventDefault();
            read();
          }}
        >
          <IconButton
            label="Ein Jahr zurück"
            size="sm"
            onClick={() => go(stepDay(cal, day, -1, 'year'))}
          >
            <ChevronsLeft />
          </IconButton>
          <IconButton
            label="Einen Tag zurück"
            size="sm"
            onClick={() => go(stepDay(cal, day, -1, 'day'))}
          >
            <ChevronLeft />
          </IconButton>
          <Input
            className="wf-damals-pick__input"
            value={text}
            aria-label="Tag"
            aria-invalid={unread || undefined}
            title="Ein Tag, ein Monat oder ein Jahr – etwa „3. Tauwind 650“ oder „650“"
            onChange={(event) => {
              setText(event.target.value);
              setUnread(false);
            }}
            onBlur={read}
          />
          <IconButton
            label="Einen Tag weiter"
            size="sm"
            disabled={today}
            onClick={() => go(stepDay(cal, day, 1, 'day'))}
          >
            <ChevronRight />
          </IconButton>
          <IconButton
            label="Ein Jahr weiter"
            size="sm"
            disabled={stepDay(cal, day, 1, 'year') > now}
            onClick={() => go(stepDay(cal, day, 1, 'year'))}
          >
            <ChevronsRight />
          </IconButton>
          <Button size="sm" disabled={today} onClick={() => go(now)}>
            Heute
          </Button>
          <Button size="sm" icon={<ChartNoAxesGantt />} onClick={() => navigate('/zeitleiste')}>
            Zeitleiste
          </Button>
        </form>
      </header>

      <div className="wf-page__body wf-damals-body">
        <section className="wf-damals-day">
          <div className="wf-damals-day__date">
            {weekday && <span className="wf-caps">{weekday}</span>}
            <span className="wf-damals-day__title">{formatDate(cal, day)}</span>
            <span className="wf-damals-day__when">
              {unread
                ? 'Diesen Tag kann Wayfarer nicht lesen – etwa „3. Tauwind 650“ oder „650“.'
                : future
                  ? 'Dieser Tag liegt nach dem heutigen Tag der Welt. Gezeigt wird die Welt von heute.'
                  : today
                    ? 'Heute – so steht die Welt jetzt.'
                    : describeDate(cal, now, {
                        from: 0,
                        to: 0,
                        time: day,
                        precision: 'day',
                        assumedYear: false,
                      }).replace(/^.*? – /, '')}
            </span>
          </div>
          <Fact label="Zeitalter">
            {on.ages.length ? on.ages.map((span) => span.age.name).join(', ') : '–'}
          </Fact>
          <Fact label="Die Gruppe war in">
            {on.placeId ? (
              <EntityLink id={on.placeId} />
            ) : on.beforeCampaign ? (
              'Vor dem ersten Abend'
            ) : (
              'unbekannt'
            )}
          </Fact>
          <Fact label="Abend">
            {on.session ? sessionLabel(on.session) : 'An diesem Tag lief kein Abend'}
          </Fact>
        </section>

        <div className="wf-damals-grid">
          <Panel title="Die Gefährten" count={on.party.length}>
            {on.party.length === 0 ? (
              <Quiet>
                {on.beforeCampaign
                  ? 'Vor dem ersten Abend – die Gruppe zog noch nicht gemeinsam.'
                  : 'Noch keine Gefährten eingetragen.'}
              </Quiet>
            ) : (
              <ul className="wf-damals-list">
                {on.party.map((member) => (
                  <li key={member.entity.id} className="wf-damals-row">
                    <EntityLink id={member.entity.id} />
                    <span className="wf-damals-row__value">
                      Stufe {member.level.then}
                      <Today value={member.level} show={(v) => `Stufe ${v}`} />
                    </span>
                    {member.status.then !== 'alive' && (
                      <span className="wf-damals-row__note">{FATE_LABEL[member.status.then]}</span>
                    )}
                    {member.conditions.length > 0 && (
                      <span className="wf-damals-row__note">{member.conditions.join(' · ')}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Wer lebte, was bestand" count={on.lives.length}>
            {on.lives.length === 0 ? (
              <Quiet>
                Hier stehen Alter und Bestehen von allem, was Lebensdaten hat – Geburt, Gründung,
                Tod. Eingetragen werden sie auf der Seite eines Eintrags oder im Steckbrief.
              </Quiet>
            ) : (
              <>
                <ul className="wf-damals-list">
                  {lives.map((life) => (
                    <li key={life.entity.id} className="wf-damals-row">
                      <EntityLink id={life.entity.id} />
                      <span className="wf-damals-row__value">
                        {life.facts.map((fact) => fact.text).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
                {on.lives.length > LIVES_SHOWN && (
                  <Button size="sm" variant="ghost" onClick={() => setAllLives((v) => !v)}>
                    {allLives ? 'Weniger zeigen' : `Alle ${on.lives.length} zeigen`}
                  </Button>
                )}
              </>
            )}
            {(on.past > 0 || on.notYet > 0) && (
              <Quiet>
                {[
                  on.past === 1
                    ? '1 Eintrag war schon gestorben oder vergangen'
                    : on.past > 1
                      ? `${on.past} waren schon gestorben oder vergangen`
                      : '',
                  on.notYet === 1
                    ? '1 entstand erst später'
                    : on.notYet > 1
                      ? `${on.notYet} entstanden erst später`
                      : '',
                ]
                  .filter(Boolean)
                  .join(', ')}
                .
              </Quiet>
            )}
          </Panel>

          <Panel title="Schicksal und Aufenthalt">
            {on.fates.length === 0 && on.whereabouts.length === 0 ? (
              <Quiet>
                Alle lebten – soweit festgehalten. Schicksale und Aufenthalte kommen aus der
                Chronik.
              </Quiet>
            ) : (
              <ul className="wf-damals-list">
                {on.fates.map((fate) => (
                  <li key={`fate:${fate.entity.id}`} className="wf-damals-row">
                    <EntityLink id={fate.entity.id} />
                    <span className="wf-damals-row__value">
                      {FATE_LABEL[fate.status.then]}
                      <Today value={fate.status} show={(v) => FATE_LABEL[v]} />
                    </span>
                  </li>
                ))}
                {on.whereabouts.map((where) => (
                  <li key={`where:${where.entity.id}`} className="wf-damals-row">
                    <EntityLink id={where.entity.id} />
                    <span className="wf-damals-row__value">
                      {where.placeId.then ? <EntityLink id={where.placeId.then} /> : 'unbekannt'}
                      <Today
                        value={where.placeId}
                        show={(v) => (v ? entityName(data, v) : 'unbekannt')}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Haltung zur Gruppe" count={on.attitudes.length}>
            {on.attitudes.length === 0 ? (
              <Quiet>Noch keine Haltung festgehalten.</Quiet>
            ) : (
              <ul className="wf-damals-list">
                {on.attitudes.map((a) => (
                  <li key={a.entity.id} className="wf-damals-row">
                    <EntityLink id={a.entity.id} />
                    <span className="wf-damals-row__value">
                      {a.value.then === null ? 'unbekannt' : <AttitudeBadge value={a.value.then} />}
                      {a.value.changed && (
                        <span className="wf-damals-today">
                          heute{' '}
                          {a.value.today === null ? (
                            'unbekannt'
                          ) : (
                            <AttitudeBadge value={a.value.today} />
                          )}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Wer was hatte" count={on.holders.length}>
            {on.holders.length === 0 ? (
              <Quiet>
                Hier steht, bei wem ein Gegenstand damals war – sobald er als Beute ausgegeben,
                gehandelt oder mit Lebenslauf weitergegeben wurde.
              </Quiet>
            ) : (
              <ul className="wf-damals-list">
                {on.holders.map((h) => (
                  <li key={h.entity.id} className="wf-damals-row">
                    <EntityLink id={h.entity.id} />
                    <span className="wf-damals-row__value">
                      <Holder id={h.holderId.then} />
                      <Today
                        value={h.holderId}
                        show={(v) =>
                          v === null
                            ? 'unbekannt'
                            : v === PARTY_ID
                              ? 'die Gruppe'
                              : entityName(data, v)
                        }
                      />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Uhren" count={on.clocks.length}>
            {on.clocks.length === 0 ? (
              <Quiet>Damals lief noch keine Uhr.</Quiet>
            ) : (
              <ul className="wf-damals-list">
                {on.clocks.map((c) => (
                  <li key={c.clock.id} className="wf-damals-clock">
                    <span className="wf-damals-clock__title">{c.clock.title}</span>
                    {c.behind.length > 0 && (
                      <span className="wf-damals-row__note">
                        Eingetreten: {c.behind.map((s) => s.step.text).join(' · ')}
                      </span>
                    )}
                    <span className="wf-damals-row__value">
                      {c.next
                        ? `Als Nächstes: ${c.next.step.text}`
                        : 'Alle Schritte lagen hinter ihr.'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Was die Gruppe wusste">
            {on.knew.length === 0 ? (
              <Quiet>
                {on.beforeCampaign
                  ? 'Vor dem ersten Abend – die Gruppe wusste noch nichts.'
                  : 'Damals stand noch nichts im Spielerbuch.'}
              </Quiet>
            ) : (
              <ul className="wf-damals-list">
                {on.knew.map((k) => (
                  <li key={k.label} className="wf-damals-know">
                    <span className="wf-damals-know__label">
                      {k.label} <span className="wf-num">{k.count}</span>
                    </span>
                    {k.names.length > 0 && (
                      <span className="wf-damals-row__note">
                        {k.names.slice(0, NAMES_SHOWN).join(', ')}
                        {k.names.length > NAMES_SHOWN &&
                          ` und ${k.names.length - NAMES_SHOWN} weitere`}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Zuletzt geschehen">
            {on.recent.length === 0 ? (
              <Quiet>Bis dahin steht nichts in der Chronik.</Quiet>
            ) : (
              <ul className="wf-damals-list">
                {on.recent.map((entry) => (
                  <li key={entry.id} className="wf-damals-entry">
                    <span className="wf-damals-entry__when">
                      {entry.precision === 'exact'
                        ? formatDateTime(cal, entry.at)
                        : `${isApproximate(entry) ? 'ungefähr ' : ''}${formatDatePoint(cal, {
                            at: entry.at,
                            precision: 'day',
                          })}`}
                    </span>
                    <span className="wf-damals-entry__text">{entryLine(on.view, entry)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wf-damals-fact">
      <span className="wf-caps">{label}</span>
      <span className="wf-damals-fact__value">{children}</span>
    </div>
  );
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="wf-damals-quiet">{children}</p>;
}

/** „heute: …“ – nur, wenn es heute anders ist. */
function Today<T>({ value, show }: { value: ThenAndNow<T>; show: (value: T) => string }) {
  if (!value.changed) return null;
  return <span className="wf-damals-today">heute {show(value.today)}</span>;
}

function Holder({ id }: { id: string | null }) {
  if (id === null) return <>unbekannt</>;
  if (id === PARTY_ID) return <>die Gruppe</>;
  return <EntityLink id={id} />;
}
