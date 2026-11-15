/**
 * „Passt nicht zusammen“: ein Widerspruch als Zeile auf „Noch offen“ und als leiser Hinweis auf
 * der Seite eines Eintrags. Die Rechnung steht in `domain/continuity.ts`; Wayfarer ändert nichts,
 * es zeigt nur – „Passt so“ nimmt den Punkt heraus.
 */
import { useMemo } from 'react';
import { Link } from 'wouter';
import { Check, Puzzle } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { continuityIssues, issuesAbout, type Issue } from '../../domain/continuity';
import { Button, ChronicleItem, EntityLinks, cx, toast } from '../../ui';
import { markContinuityOk } from './actions';
import './offen.css';

export function ContinuityItem({ issue }: { issue: Issue }) {
  const db = useDb();
  const data = useData();
  const entry = issue.entryId ? data.chronicle[issue.entryId] : undefined;
  const ok = () => {
    const undo = markContinuityOk(db, issue.key);
    toast({
      title: 'Passt so',
      body: issue.text.slice(0, 120),
      action: { label: 'Rückgängig', run: undo },
    });
  };
  return (
    <div className={cx('wf-offen-issue', issue.weight === 'warn' && 'wf-offen-issue--warn')}>
      <div className="wf-offen-issue__head">
        <p className="wf-offen-issue__text">{issue.text}</p>
        <Button
          size="sm"
          variant="ghost"
          icon={<Check />}
          onClick={ok}
          title="Stimmt so – nicht mehr anzeigen"
          className="wf-offen-issue__ok"
        >
          Passt so
        </Button>
      </div>
      {issue.refs.length > 0 && (
        <div className="wf-offen-issue__refs">
          <EntityLinks ids={issue.refs} />
        </div>
      )}
      {entry && <ChronicleItem entry={entry} showDate />}
    </div>
  );
}

/** Ein kleiner Hinweis auf der Seite eines Eintrags, wenn es zu ihm einen Widerspruch gibt. */
export function ContinuityNote({ entityId }: { entityId: string }) {
  const db = useDb();
  const data = useData();
  const issues = useMemo(() => issuesAbout(continuityIssues(data), entityId), [data, entityId]);
  if (!issues.length) return null;
  const warn = issues.some((issue) => issue.weight === 'warn');
  const shown = issues.slice(0, 2);
  const more = issues.length - shown.length;
  return (
    <aside className={cx('wf-offen-note', warn && 'wf-offen-note--warn')}>
      <Puzzle className="wf-offen-note__icon" aria-hidden />
      <div className="wf-offen-note__body">
        {shown.map((issue) => (
          <p key={issue.key} className="wf-offen-note__line">
            <span>{issue.text}</span>
            <button
              type="button"
              className="wf-offen-note__ok"
              title="Stimmt so – nicht mehr anzeigen"
              onClick={() => {
                const undo = markContinuityOk(db, issue.key);
                toast({
                  title: 'Passt so',
                  body: issue.text.slice(0, 120),
                  action: { label: 'Rückgängig', run: undo },
                });
              }}
            >
              <Check aria-hidden />
              Passt so
            </button>
          </p>
        ))}
        <Link href="/offen" className="wf-offen-note__more">
          {more > 0
            ? `${more === 1 ? 'Ein weiterer Punkt' : `${more} weitere Punkte`} unter „Noch offen“`
            : 'Unter „Noch offen“ ansehen'}
        </Link>
      </div>
    </aside>
  );
}
