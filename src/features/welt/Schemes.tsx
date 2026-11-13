/**
 * „Vorhaben“ auf der Seite einer Fraktion, Familie oder Person: die Geschichten, die sie antreibt,
 * mit ihrer Uhr – was als Nächstes eintritt, was zuletzt geschah, ob sie ruht oder steht. Ein
 * Vorhaben ist eine Geschichte; geschrieben wird es auf ihrem Blatt. Gelesen über `schemesOf`
 * (`domain/schemes.ts`).
 */
import { useLocation } from 'wouter';
import { Hourglass, Plus } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { schemesOf, type Scheme } from '../../domain/schemes';
import { PACE_LABEL } from '../../domain/story';
import { formatRelative } from '../../domain/time/calendar';
import { Button, cx } from '../../ui';
import { newScheme, storyFromClock } from '../faeden/actions';
import { formatShortDate, type WorldEntity } from './model';
import { Hint, Section } from './parts';

export function Schemes({ entity, quiet = false }: { entity: WorldEntity; quiet?: boolean }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const schemes = schemesOf(data, entity.id);
  const create = () => {
    const story = newScheme(db, entity.id);
    if (story) navigate(`/geschichte/${story.id}`);
  };
  // Bei Personen nur ein leiser Knopf, solange sie nichts vorhaben – sonst stünde ein leerer
  // Abschnitt auf jeder Seite.
  if (quiet && !schemes.length)
    return (
      <div className="wf-welt-scheme-add">
        <Button
          size="sm"
          variant="ghost"
          icon={<Hourglass />}
          onClick={create}
          title={`Eine Geschichte, die ${entity.name} antreibt – mit Schritten und Fristen`}
        >
          Vorhaben anlegen
        </Button>
      </div>
    );
  return (
    <Section
      title="Vorhaben"
      count={schemes.length || undefined}
      action={
        schemes.length > 0 && (
          <Button size="sm" variant="ghost" icon={<Plus />} onClick={create}>
            Vorhaben
          </Button>
        )
      }
    >
      {schemes.length ? (
        <ul className="wf-welt-schemes">
          {schemes.map((scheme) => (
            <SchemeRow key={scheme.key} scheme={scheme} />
          ))}
        </ul>
      ) : (
        <Hint
          action={
            <Button size="sm" icon={<Hourglass />} onClick={create}>
              Vorhaben anlegen
            </Button>
          }
        >
          Was {entity.name} verfolgt, ohne auf die Gruppe zu warten: eine Geschichte mit Schritten
          und Fristen. Was eintritt, steht danach im Weltgeschehen.
        </Hint>
      )}
    </Section>
  );
}

function SchemeRow({ scheme }: { scheme: Scheme }) {
  const db = useDb();
  const data = useData();
  const [, navigate] = useLocation();
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const when = (at: number) => `${formatRelative(now, at)} · ${formatShortDate(cal, now, at)}`;
  const open = () => {
    if (scheme.story) navigate(`/geschichte/${scheme.story.id}`);
    else if (scheme.clock) {
      // Eine Uhr aus früheren Ständen wird beim Öffnen zur Geschichte.
      const story = storyFromClock(db, scheme.clock.id);
      if (story) navigate(`/geschichte/${story.id}`);
    }
  };
  return (
    <li className="wf-welt-scheme">
      <button
        type="button"
        className="wf-welt-scheme__title"
        onClick={open}
        title={scheme.story ? 'Das Blatt dieses Vorhabens öffnen' : 'Als Geschichte öffnen'}
      >
        {scheme.title}
      </button>
      <span className="wf-welt-scheme__pace" data-pace={scheme.pace}>
        {PACE_LABEL[scheme.pace]}
        {scheme.total > 0 && ` · ${scheme.behind}/${scheme.total}`}
      </span>
      {scheme.total > 0 && (
        <span className="wf-welt-scheme__pips" aria-hidden>
          {scheme.view?.steps.map((step) => (
            <i key={step.step.id} data-state={step.state} />
          ))}
        </span>
      )}
      {scheme.next && (
        <div className="wf-welt-scheme__line">
          <b>{scheme.pace === 'running' ? 'Als Nächstes' : 'Steht vor'}</b>
          <span>{scheme.next.text}</span>
          {scheme.pace === 'running' && <i>{when(scheme.next.at)}</i>}
        </div>
      )}
      {scheme.last && (
        <div className={cx('wf-welt-scheme__line', 'wf-welt-scheme__line--past')}>
          <b>{scheme.last.prevented ? 'Verhindert' : 'Zuletzt'}</b>
          <span>{scheme.last.text}</span>
          <i>{when(scheme.last.at)}</i>
        </div>
      )}
      {scheme.blocked && (
        <div className="wf-welt-scheme__quiet">
          Steht still: {scheme.blocked}. Wie es weitergeht, entscheidest du im Weltgeschehen.
        </div>
      )}
      {scheme.pace === 'none' && (
        <div className="wf-welt-scheme__quiet">
          Noch ohne Schritte – auf dem Blatt unter „Wenn niemand eingreift“.
        </div>
      )}
      {!scheme.story && (
        <div className="wf-welt-scheme__quiet">Eine Uhr aus früheren Ständen, ohne Geschichte.</div>
      )}
    </li>
  );
}
