/**
 * Weltgeschehen „nach Fraktion“: was jede Fraktion, Familie und jeder Antreiber eines Vorhabens
 * seit dem letzten Abend getan hat – eingetretene Schritte und Veränderungen, die sie nennen –,
 * und was als Nächstes ansteht. Nur gelesen; die Rechnung steht in `factionTurn`
 * (`domain/worldTurn.ts`).
 */
import { useMemo } from 'react';
import { Link } from 'wouter';
import { CalendarDays, Handshake, Milestone, ShieldOff, Sparkles } from 'lucide-react';
import { useData } from '../../data/hooks';
import type { DeedKind } from '../../domain/schemes';
import { formatDayMonth, formatRelative } from '../../domain/time/calendar';
import { factionTurn, lastEvening, type FactionTurnGroup } from '../../domain/worldTurn';
import { AttitudeBadge, EntityLink } from '../../ui';

const DEED_ICON: Record<DeedKind, typeof Milestone> = {
  step: Milestone,
  prevented: ShieldOff,
  attitude: Handshake,
  change: Sparkles,
  event: CalendarDays,
};

const DEED_LABEL: Record<DeedKind, string> = {
  step: 'Schritt eines Vorhabens',
  prevented: 'Von der Gruppe verhindert',
  attitude: 'Haltung geändert',
  change: 'Veränderung',
  event: 'Ereignis',
};

/** So viele Taten stehen je Fraktion offen da; der Rest ist eingeklappt. */
const SHOWN = 5;

/**
 * `since` ist der Beginn des Überblicks; mit `wide` („Alles“) gilt er, sonst der letzte Abend.
 */
export function ByFaction({ since: overview, wide }: { since: number; wide: boolean }) {
  const data = useData();
  const cal = data.campaign.calendar;
  const evening = useMemo(() => lastEvening(data), [data]);
  const since = wide || !evening ? overview : evening.at;
  const turn = useMemo(() => factionTurn(data, since), [data, since]);
  const sinceText = wide
    ? `Seit dem ${formatDayMonth(cal, since)}`
    : evening
      ? evening.running
        ? `Seit Beginn von Session ${evening.session.number} (${formatDayMonth(cal, evening.at)})`
        : `Seit dem Ende von Session ${evening.session.number} (${formatDayMonth(cal, evening.at)})`
      : `Seit dem ${formatDayMonth(cal, since)} – noch ist kein Abend festgehalten`;

  return (
    <>
      <p className="wf-turn-since">{sinceText}</p>
      <section className="wf-turn-section">
        <h2 className="wf-turn-section__title">
          Was sie getan haben
          {turn.active.length > 0 && <span>{turn.active.length}</span>}
        </h2>
        {turn.active.map((group) => (
          <GroupCard key={group.entity.id} group={group} />
        ))}
        {!turn.active.length && (
          <p className="wf-turn-none">
            Seitdem hat keine Fraktion etwas getan, das Wayfarer kennt. Hier steht, was die Uhren
            ihrer Vorhaben bewegen und was in der Chronik über sie steht.
          </p>
        )}
      </section>
      {turn.quiet.length > 0 && (
        <section className="wf-turn-section">
          <h2 className="wf-turn-section__title">
            Ruhig geblieben<span>{turn.quiet.length}</span>
          </h2>
          {turn.quiet.map((group) => (
            <div key={group.entity.id} className="wf-turn-quiet">
              <EntityLink id={group.entity.id} />
              <Next group={group} />
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function GroupCard({ group }: { group: FactionTurnGroup }) {
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const shown = group.deeds.slice(0, SHOWN);
  const rest = group.deeds.slice(SHOWN);
  const row = (deed: FactionTurnGroup['deeds'][number]) => {
    const Icon = DEED_ICON[deed.kind];
    return (
      <li key={deed.key} data-kind={deed.kind}>
        <Icon aria-label={DEED_LABEL[deed.kind]} />
        <span className="wf-turn-deed__text">
          {deed.text}
          {deed.scheme &&
            (deed.storyId ? (
              <Link href={`/geschichte/${deed.storyId}`} className="wf-turn-deed__scheme">
                {deed.scheme}
              </Link>
            ) : (
              <span className="wf-turn-deed__scheme">{deed.scheme}</span>
            ))}
        </span>
        <span className="wf-turn-deed__when">
          {formatRelative(now, deed.at)} · {formatDayMonth(cal, deed.at)}
        </span>
      </li>
    );
  };
  return (
    <article className="wf-turn-faction" data-watched={group.watched}>
      <header className="wf-turn-faction__head">
        <EntityLink id={group.entity.id} />
        {group.attitude !== null && <AttitudeBadge value={group.attitude} />}
        <span className="wf-grow" />
        <span className="wf-turn-faction__count">
          {group.deeds.length === 1 ? 'eine Tat' : `${group.deeds.length} Taten`}
        </span>
      </header>
      <ul className="wf-turn-deeds">{shown.map(row)}</ul>
      {rest.length > 0 && (
        <details className="wf-turn-deeds__more">
          <summary>{rest.length === 1 ? 'eine weitere' : `${rest.length} weitere`}</summary>
          <ul className="wf-turn-deeds">{rest.map(row)}</ul>
        </details>
      )}
      <Next group={group} />
    </article>
  );
}

/** Was bei ihren Vorhaben als Nächstes ansteht – ruhig, auch wenn eine Uhr steht. */
function Next({ group }: { group: FactionTurnGroup }) {
  const data = useData();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  if (!group.schemes.length) return null;
  return (
    <div className="wf-turn-next">
      {group.schemes.slice(0, 3).map((scheme) => (
        <div key={scheme.key}>
          <b>
            {scheme.story ? (
              <Link href={`/geschichte/${scheme.story.id}`}>{scheme.title}</Link>
            ) : (
              scheme.title
            )}
          </b>
          {scheme.pace === 'running' && scheme.next ? (
            <span>
              Als Nächstes {formatRelative(now, scheme.next.at)} (
              {formatDayMonth(cal, scheme.next.at)}): {scheme.next.text}
            </span>
          ) : scheme.pace === 'blocked' ? (
            <span className="wf-mute">Steht still – {scheme.blocked}</span>
          ) : (
            <span className="wf-mute">Ruht{scheme.next ? ` vor: ${scheme.next.text}` : ''}</span>
          )}
        </div>
      ))}
    </div>
  );
}
