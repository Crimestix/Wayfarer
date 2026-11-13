/**
 * Heldenbogen (auf der Seite eines Gefährten) und Rampenlicht (auf der Übersicht): was die
 * Geschichte eines Gefährten ausmacht und wie oft jeder an den letzten Abenden vorkam. Die
 * Rechnung steht in `domain/heroArc.ts`; hier wird nur gezeigt.
 */
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Plus } from 'lucide-react';
import { useData } from '../../data/hooks';
import {
  SPOTLIGHT_SESSIONS,
  heroArc,
  lastEveningsText,
  spotlight,
  spotlightHint,
} from '../../domain/heroArc';
import type { Character, ChronicleEntry } from '../../domain/schema';
import { Button, EntityLink, Panel, cx } from '../../ui';
import { milestoneLine } from '../chronik/model';
import { TrackCard } from '../fortschritt/TrackCard';
import { TrackDialog } from '../fortschritt/TrackDialog';
import { formatShortDate } from '../welt/model';

/** So viele Meilensteine stehen im Bogen; der Rest steht in der Chronik. */
const MILESTONES_SHOWN = 3;

function Dated({ entry, text }: { entry: ChronicleEntry; text: string }) {
  const data = useData();
  return (
    <span className="wf-gruppe-milestone">
      <span className="wf-clamp-1" title={text}>
        {text}
      </span>
      <span className="wf-mute">
        {formatShortDate(data.campaign.calendar, data.state.now, entry.at)}
      </span>
    </span>
  );
}

/** Der Heldenbogen eines Gefährten: Ziel, Wünsche, Lehrer, Geschichten, Leisten, Meilensteine. */
export function HeroArcPanel({ character }: { character: Character }) {
  const data = useData();
  const [creating, setCreating] = useState(false);
  const arc = useMemo(() => heroArc(data, character.id), [data, character.id]);
  if (!arc) return null;
  const teachers = arc.mentors.filter((tie) => tie.role === 'teacher');
  const students = arc.mentors.filter((tie) => tie.role === 'student');
  const mentorRow = (title: string, ties: typeof arc.mentors) =>
    ties.length > 0 && (
      <>
        <dt>{title}</dt>
        <dd className="wf-gruppe-stack">
          {ties.map((tie) => (
            <span key={tie.relation.id} className={cx(tie.ended && 'wf-mute')}>
              <EntityLink id={tie.otherId} icon={false} />
              {tie.ended && ' · früher'}
            </span>
          ))}
        </dd>
      </>
    );

  return (
    <Panel
      title="Heldenbogen"
      className="wf-gruppe-arc"
      flush
      actions={
        <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
          Leiste
        </Button>
      }
    >
      <dl className="wf-gruppe-rows wf-gruppe-rows--roomy">
        <dt>Ziel</dt>
        <dd>
          {arc.goal || (
            <span className="wf-gruppe-hint">
              Was {character.name} will, steht noch nirgends – trag es beim Bearbeiten oder unter
              „Abend vorbereiten“ ein.
            </span>
          )}
        </dd>
        {arc.wishes.length > 0 && (
          <>
            <dt>Wünsche</dt>
            <dd className="wf-gruppe-stack">
              {arc.wishes.map((entry) => (
                <Dated key={entry.id} entry={entry} text={entry.text} />
              ))}
            </dd>
          </>
        )}
        {mentorRow('Lernt von', teachers)}
        {mentorRow('Lehrt', students)}
        {arc.milestones.length > 0 && (
          <>
            <dt>Meilensteine</dt>
            <dd className="wf-gruppe-stack">
              {arc.milestones.slice(0, MILESTONES_SHOWN).map((entry) => (
                <Dated key={entry.id} entry={entry} text={milestoneLine(entry)} />
              ))}
            </dd>
          </>
        )}
        {arc.transformations.length > 0 && (
          <>
            <dt>Wandlungen</dt>
            <dd className="wf-gruppe-stack">
              {arc.transformations.map((entry) => (
                <Dated key={entry.id} entry={entry} text={entry.text} />
              ))}
            </dd>
          </>
        )}
      </dl>

      <div className="wf-gruppe-arc__head">Geschichten</div>
      {arc.stories.map((tie) => (
        <Link
          key={tie.story.id}
          href={`/geschichte/${tie.story.id}`}
          className="wf-gruppe-tie"
          title="Das Blatt der Geschichte öffnen"
        >
          <span className="wf-gruppe-tie__title">
            {tie.story.title}
            {tie.story.inPlay && <em>im Spiel</em>}
          </span>
          {tie.why && <span className="wf-gruppe-tie__why">{tie.why}</span>}
        </Link>
      ))}
      {arc.stories.length === 0 && (
        <p className="wf-gruppe-hint wf-gruppe-arc__none">
          Noch betrifft keine Geschichte {character.name} persönlich. Auf dem Blatt einer Geschichte
          heftest du Gefährten an – mit ihrem eigenen Grund.
        </p>
      )}

      <div className="wf-gruppe-arc__head">
        Fortschritt
        <Link href="/fortschritt" className="wf-gruppe-textlink">
          alle Leisten
        </Link>
      </div>
      {arc.tracks.map((track) => (
        <TrackCard key={track.id} track={track} />
      ))}
      {arc.tracks.length === 0 && (
        <p className="wf-gruppe-hint wf-gruppe-arc__none">
          Noch keine Leiste. Ein Ausbildungsweg, eine Schuld, eine Studie – was sich Schritt für
          Schritt bewegt.
        </p>
      )}
      {creating && <TrackDialog ownerId={character.id} onClose={() => setCreating(false)} />}
    </Panel>
  );
}

/** Rampenlicht: je Gefährte, in wie vielen Einträgen er an den letzten Abenden vorkam. */
export function SpotlightPanel() {
  const data = useData();
  const view = useMemo(() => spotlight(data, { sessions: SPOTLIGHT_SESSIONS }), [data]);
  const hint = useMemo(() => spotlightHint(data, { sessions: SPOTLIGHT_SESSIONS }), [data]);
  if (view.rows.length === 0 || view.sessions.length === 0) return null;
  const when = lastEveningsText(view.sessions.length);
  return (
    <Panel title="Rampenlicht" className="wf-gruppe-spot" flush>
      <p className="wf-gruppe-spot__lead">
        In wie vielen Einträgen der Chronik jeder {when} vorkam.
      </p>
      <div className="wf-gruppe-spot__list">
        {view.rows.map((row) => (
          <div key={row.character.id} className="wf-gruppe-spot__row">
            <Link href={`/gruppe/${row.character.id}`} className="wf-gruppe-spot__name wf-clamp-1">
              {row.character.name}
            </Link>
            <span className="wf-gruppe-spot__bar" aria-hidden>
              <i style={{ width: `${Math.round(row.ratio * 100)}%` }} />
            </span>
            <span className="wf-gruppe-spot__count wf-num">{row.count}</span>
          </div>
        ))}
      </div>
      {(hint || view.total === 0) && (
        <p className="wf-gruppe-spot__hint">
          {hint ?? 'Noch nichts festgehalten, das einen Gefährten nennt.'}
        </p>
      )}
    </Panel>
  );
}
