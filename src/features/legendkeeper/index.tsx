/**
 * LegendKeeper in Wayfarer: Artikel nachschlagen und mit Einträgen verknüpfen (nur lesen).
 * Diese beiden Bausteine sind die Schnittstelle zum Rest der App.
 * Wie die Anbindung arbeitet, steht in API-NOTIZEN.md in diesem Ordner.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { ArrowLeft, BookOpen, CloudOff, KeyRound, Link2, LoaderCircle, MonitorDown, Settings, TriangleAlert, Unlink } from 'lucide-react';
import type { LkLink } from '../../domain/schema';
import { Button, EmptyState, cx, toast } from '../../ui';
import type { OpenTarget } from './Article';
import { ArticleView } from './ArticleView';
import { describeError, type LkError } from './errors';
import { Finder } from './Finder';
import type { ArticleHead } from './model';
import { checkConnection, useConnection } from './state';
import './legendkeeper.css';

export { LegendKeeperSettings } from './Settings';

const SETTINGS_PATH = '/einstellungen';

function errorIcon(error: LkError): ReactNode {
  switch (error.kind) {
    case 'not-configured':
    case 'unauthorized':
    case 'forbidden':
      return <KeyRound />;
    case 'preview':
      return <MonitorDown />;
    case 'offline':
    case 'timeout':
    case 'server':
      return <CloudOff />;
    case 'not-found':
      return <BookOpen />;
    default:
      return <TriangleAlert />;
  }
}

/** Erklärt, warum gerade nichts zu sehen ist, und bietet den nächsten Schritt an. */
function Unavailable({
  error,
  onRetry,
  link,
  onUnlink,
}: {
  error: LkError;
  onRetry: () => void;
  link: LkLink | null;
  onUnlink?: () => void;
}) {
  const [, navigate] = useLocation();
  const view = describeError(error, 'article');
  const toSettings = (
    <Button variant={view.action === 'settings' ? 'primary' : 'default'} icon={<Settings />} onClick={() => navigate(SETTINGS_PATH)}>
      Zu den Einstellungen
    </Button>
  );
  const retry = (
    <Button variant={view.action === 'retry' && error.kind !== 'not-found' ? 'primary' : 'default'} onClick={onRetry}>
      Erneut versuchen
    </Button>
  );
  return (
    <div className={cx('wf-lk-state', view.tone === 'problem' && 'wf-lk-state--problem')} role="status">
      <EmptyState
        icon={errorIcon(error)}
        title={view.title}
        action={
          <div className="wf-lk-state__actions">
            {view.action === 'settings' && toSettings}
            {view.action === 'retry' && error.kind !== 'not-found' && retry}
            {error.kind === 'not-found' && onUnlink && (
              <Button variant="primary" icon={<Unlink />} onClick={onUnlink}>
                Verknüpfung lösen und neu wählen
              </Button>
            )}
            {error.kind === 'not-found' && retry}
          </div>
        }
      >
        {view.text}
      </EmptyState>
      {link && error.kind !== 'not-found' && (
        <div className="wf-lk-state__link">
          <span>
            Verknüpft ist der Artikel <strong>„{link.title || 'ohne Titel'}“</strong>. Die Verknüpfung bleibt erhalten.
          </span>
          {onUnlink && (
            <Button size="sm" variant="ghost" icon={<Unlink />} onClick={onUnlink}>
              Verknüpfung lösen
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Zeigt den verknüpften LegendKeeper-Artikel eines Eintrags und erlaubt, die Verknüpfung zu ändern.
 * `suggest` ist freiwillig: der Name des Eintrags, zu dem passende Artikel vorgeschlagen werden.
 */
export function LkArticlePanel({
  link,
  onLink,
  suggest,
}: {
  link: LkLink | null;
  onLink: (link: LkLink | null) => void;
  suggest?: string;
}) {
  const connection = useConnection();
  /** Artikel, in denen gerade geblättert wird – der letzte ist zu sehen. Leer: der verknüpfte. */
  const [trail, setTrail] = useState<OpenTarget[]>([]);
  /** Titel des gerade angesehenen Artikels, wie LegendKeeper ihn nennt. */
  const seenTitle = useRef<string | null>(null);

  // Wechselt der Eintrag (oder seine Verknüpfung), beginnt das Blättern von vorn.
  const linkedId = link?.resourceId ?? null;
  useEffect(() => setTrail([]), [linkedId, suggest]);

  const open = (target: OpenTarget) => {
    seenTitle.current = null;
    setTrail((current) => (target.resourceId === linkedId ? [] : [...current, target]));
  };
  const back = () => {
    seenTitle.current = null;
    setTrail((current) => current.slice(0, -1));
  };

  const linkTo = (target: OpenTarget) => {
    const previous = link;
    onLink({ resourceId: target.resourceId, title: target.title });
    setTrail([]);
    toast({
      title: previous ? 'Verknüpfung geändert' : 'Mit LegendKeeper verknüpft',
      body: target.title,
      action: { label: 'Rückgängig', run: () => onLink(previous) },
    });
  };
  const unlink = () => {
    const previous = link;
    if (!previous) return;
    onLink(null);
    setTrail([]);
    toast({
      title: 'Verknüpfung gelöst',
      body: previous.title || undefined,
      action: { label: 'Rückgängig', run: () => onLink(previous) },
    });
  };

  if (connection.phase === 'idle' || connection.phase === 'checking') {
    return (
      <div className="wf-lk">
        <div className="wf-lk-pending" role="status">
          <LoaderCircle className="wf-lk-spin" aria-hidden />
          Verbindung zu LegendKeeper wird geprüft …
        </div>
      </div>
    );
  }
  if (connection.phase === 'failed') {
    return (
      <div className="wf-lk">
        <Unavailable error={connection.error} onRetry={() => void checkConnection(true)} link={link} onUnlink={link ? unlink : undefined} />
      </div>
    );
  }

  const { project } = connection;
  const peek = trail[trail.length - 1];

  if (peek) {
    return (
      <div className="wf-lk">
        <div className="wf-lk-browse">
          <Button size="sm" icon={<ArrowLeft />} onClick={back}>
            Zurück
          </Button>
          <span className="wf-lk-browse__text">
            {link ? (
              <>
                Du blätterst in LegendKeeper. Verknüpft bleibt <strong>„{link.title}“</strong>.
              </>
            ) : (
              'Nur zur Ansicht – noch nichts verknüpft.'
            )}
          </span>
          <Button
            size="sm"
            variant="primary"
            icon={<Link2 />}
            onClick={() => linkTo({ resourceId: peek.resourceId, title: seenTitle.current ?? peek.title })}
          >
            {link ? 'Stattdessen diesen verknüpfen' : 'Diesen Artikel verknüpfen'}
          </Button>
        </div>
        <ArticleView
          key={`${peek.resourceId}/${peek.documentId ?? ''}`}
          target={peek}
          projectId={project.id}
          onOpen={open}
          onHead={(head: ArticleHead) => {
            seenTitle.current = head.title;
          }}
          renderError={(error, retry) => <Unavailable error={error} onRetry={retry} link={null} />}
        />
      </div>
    );
  }

  if (link) {
    return (
      <div className="wf-lk">
        <ArticleView
          key={link.resourceId}
          target={{ resourceId: link.resourceId, title: link.title }}
          projectId={project.id}
          onOpen={open}
          onHead={(head: ArticleHead) => {
            // Wurde der Artikel in LegendKeeper umbenannt, zieht der gemerkte Titel nach.
            if (head.id === link.resourceId && head.title !== link.title) {
              onLink({ resourceId: link.resourceId, title: head.title });
            }
          }}
          actions={
            <Button
              size="sm"
              variant="ghost"
              icon={<Unlink />}
              onClick={unlink}
              title="Die Verknüpfung dieses Eintrags mit dem Artikel lösen"
              aria-label="Verknüpfung lösen"
            >
              <span className="wf-lk-act__label">Verknüpfung lösen</span>
            </Button>
          }
          renderError={(error, retry, scope) =>
            scope === 'page' ? (
              <Unavailable error={error} onRetry={retry} link={null} />
            ) : (
              <Unavailable error={error} onRetry={retry} link={link} onUnlink={unlink} />
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="wf-lk">
      <Finder suggest={suggest} projectName={project.name} onLink={linkTo} onPeek={open} />
    </div>
  );
}
