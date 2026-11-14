/**
 * „Letztes Mal“: der Rückblick auf den vorigen Abend – am Spieltisch, solange im neuen Abend noch
 * nichts festgehalten ist, und auf „Abend vorbereiten“. Die Auswahl steht in `domain/recap.ts`,
 * die Zeilen in `recapView`; Wayfarer zeigt nur, was der Spielleiter geschrieben hat.
 */
import { useMemo } from 'react';
import { Link } from 'wouter';
import { EyeOff, X } from 'lucide-react';
import { useData } from '../../data/hooks';
import type { Recap } from '../../domain/recap';
import { IconButton, cx, entityHref } from '../../ui';
import { recapView } from './model';
import './abend.css';

export function RecapBox({
  recap,
  onDismiss,
  className,
}: {
  recap: Recap;
  /** Für diesen Abend ausblenden – nur am Spieltisch. */
  onDismiss?: () => void;
  className?: string;
}) {
  const data = useData();
  const view = useMemo(() => recapView(data, recap), [data, recap]);
  const place = view.where ? data.entities[view.where.id] : undefined;
  return (
    <section className={cx('wf-abend-recap', className)} aria-label="Letztes Mal">
      <header className="wf-abend-recap__head">
        <h3 className="wf-abend-sub">{view.title}</h3>
        {onDismiss && (
          <IconButton
            label="Für diesen Abend ausblenden"
            variant="ghost"
            size="sm"
            onClick={onDismiss}
          >
            <X />
          </IconButton>
        )}
      </header>
      {view.told && <p className="wf-abend-recap__told">{view.told}</p>}
      {view.empty && <p className="wf-abend-recap__none">{view.empty}</p>}
      {view.lines.length > 0 && (
        <ul className="wf-abend-recap__lines">
          {view.lines.map((line) => (
            <li key={line.id} className="wf-abend-recap__line">
              <span className="wf-abend-recap__kind">{line.kind}</span>
              <span className="wf-abend-recap__text">
                {line.line}
                {line.secret && (
                  <EyeOff className="wf-abend-recap__secret" aria-label="nur für dich" />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {view.more && (
        <Link href="/chronik" className="wf-abend-recap__more">
          {view.more}
        </Link>
      )}
      <dl className="wf-abend-recap__facts">
        <dt>Jetzt</dt>
        <dd>
          {place ? (
            <Link href={entityHref(place)} title={view.where?.path}>
              {view.where?.name}
            </Link>
          ) : (
            <span className="wf-mute">Die Gruppe ist an keinem Ort.</span>
          )}
        </dd>
        <dt>Noch offen</dt>
        <dd>
          {view.open ? (
            <Link href="/offen">{view.open}</Link>
          ) : (
            <span className="wf-mute">Nichts hängt offen.</span>
          )}
        </dd>
        <dt>Als Nächstes</dt>
        <dd>
          {view.ahead.length === 0 ? (
            <span className="wf-mute">In den nächsten Tagen steht nichts an.</span>
          ) : (
            <ul className="wf-abend-recap__ahead">
              {view.ahead.map((item) => (
                <li key={item.key}>
                  <span className="wf-abend-recap__when">{item.when}</span>{' '}
                  {item.storyId ? (
                    <Link href={`/geschichte/${item.storyId}`} title={item.sub}>
                      {item.title}
                    </Link>
                  ) : (
                    <span title={item.sub}>{item.title}</span>
                  )}
                  <span className="wf-mute"> · {item.sub}</span>
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
    </section>
  );
}
