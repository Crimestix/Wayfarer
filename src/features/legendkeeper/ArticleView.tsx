/** Ein LegendKeeper-Artikel zum Lesen: Kopf, Seiten, Fließtext und Randspalte. */
import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ExternalLink, EyeOff, RefreshCw } from 'lucide-react';
import { Badge, Button, cx, toast } from '../../ui';
import { ArticleNodes, type ArticleContext, type OpenTarget } from './Article';
import { articleUrl, fetchBlocks, fetchResource, forgetResource } from './client';
import { describeError, type LkError } from './errors';
import { useLoad } from './hooks';
import { articleBody, articleHead, docLabel, linkedResourceIds, type ArticleHead } from './model';
import { useCatalog } from './state';
import { clockTime } from './status';

export function Skeleton() {
  return (
    <div className="wf-lk-skeleton" aria-hidden>
      <i className="wf-lk-skeleton__head" style={{ '--w': '38%' } as CSSProperties} />
      {['96%', '100%', '91%', '64%', '0', '98%', '87%', '45%'].map((width, index) =>
        width === '0' ? <span key={index} /> : <i key={index} style={{ '--w': width } as CSSProperties} />,
      )}
    </div>
  );
}

export interface ArticleViewProps {
  target: OpenTarget;
  projectId: string;
  /** Weitere Knöpfe rechts im Kopf, z. B. „Verknüpfung lösen“. */
  actions?: ReactNode;
  /** Was statt des Artikels erscheint, wenn er sich nicht laden lässt. */
  renderError: (error: LkError, retry: () => void) => ReactNode;
  onOpen: (target: OpenTarget) => void;
  /** Meldet den geladenen Kopf, z. B. um einen geänderten Titel zu übernehmen. */
  onHead?: (head: ArticleHead) => void;
}

const refreshFailed = (error: LkError) => {
  const view = describeError(error, 'article');
  toast({ title: 'Aktualisieren fehlgeschlagen', body: `${view.title}. ${view.text}`, tone: 'danger' });
};

export function ArticleView({ target, projectId, actions, renderError, onOpen, onHead }: ArticleViewProps) {
  const { resourceId } = target;
  const article = useLoad(
    resourceId,
    async ({ signal, force }) => {
      if (force) forgetResource(resourceId);
      return articleHead(await fetchResource(resourceId, { signal, force }), projectId);
    },
    refreshFailed,
  );
  const head = article.load.data;
  const title = head?.title;

  const [chosenDoc, setChosenDoc] = useState<string | null>(target.documentId ?? null);
  const doc = head ? (head.pages.find((page) => page.id === chosenDoc) ?? head.pages[0] ?? null) : null;
  const docId = doc?.id ?? null;
  const page = useLoad(
    docId ? `${resourceId}/${docId}/${title ?? ''}` : null,
    async ({ signal, force }) => {
      if (!docId) throw new Error('Keine Seite gewählt.');
      return articleBody((await fetchBlocks(resourceId, docId, { signal, force })).blocks, projectId, title);
    },
    refreshFailed,
  );
  const body = page.load.data;

  useEffect(() => {
    if (article.load.status === 'ready') onHead?.(article.load.data);
    // Bewusst nur abhängig vom geladenen Kopf: `onHead` darf bei jedem Zeichnen neu sein.
  }, [article.load]);

  // Namen verlinkter Artikel stehen nur im Verzeichnis – geladen wird es erst, wenn sie gebraucht werden.
  const needsNames = useMemo(
    () => linkedResourceIds([...(head?.side ?? []), ...(body?.aside ?? []), ...(body?.body ?? [])]).length > 0,
    [head, body],
  );
  const catalog = useCatalog(needsNames);
  const ctx: ArticleContext = useMemo(
    () => ({
      onOpen,
      titleOf: (id) => {
        if (catalog.catalog) return catalog.catalog.byId.get(id)?.title ?? null;
        return catalog.status === 'failed' ? null : undefined;
      },
    }),
    [onOpen, catalog.catalog, catalog.status],
  );

  if (article.load.status === 'failed') {
    return <>{renderError(article.load.error, article.reload)}</>;
  }
  if (!head) {
    return (
      <div className="wf-lk-article" aria-busy="true">
        <div className="wf-lk-head">
          <div className="wf-lk-head__main">
            <div className="wf-lk-path">
              <span className="wf-lk-path__source">LegendKeeper</span>
            </div>
            <h3 className="wf-lk-title">{target.title || 'Artikel'}</h3>
            <div className="wf-lk-meta">Artikel wird geholt …</div>
          </div>
          {actions && <div className="wf-lk-head__actions">{actions}</div>}
        </div>
        <Skeleton />
      </div>
    );
  }

  const refresh = () => {
    article.reload();
    page.reload();
  };
  const busy = article.refreshing || page.refreshing;
  const jump = (body?.outline ?? []).filter((entry) => entry.level <= 2 && entry.text);
  const jumps = jump.length > 14 ? jump.filter((entry) => entry.level === 1) : jump;
  const boxed = body?.aside ?? [];
  const hasAside = boxed.length + head.side.length > 0;
  const fetchedAt = page.load.status === 'ready' ? page.load.at : article.load.status === 'ready' ? article.load.at : null;

  return (
    <article className="wf-lk-article">
      {head.banner && (
        <div className="wf-lk-banner" aria-hidden>
          <img src={head.banner.url} alt="" style={{ objectPosition: `50% ${head.banner.position}%` }} />
        </div>
      )}

      <header className="wf-lk-head">
        <div className="wf-lk-head__main">
          <nav className="wf-lk-path" aria-label="Platz im LegendKeeper-Baum">
            <span className="wf-lk-path__source">LegendKeeper</span>
            {head.path.map((step) => (
              <Fragment key={step.id}>
                <span className="wf-lk-path__sep" aria-hidden>
                  ›
                </span>
                <button
                  type="button"
                  title={`„${step.name}“ nachschlagen`}
                  onClick={() => onOpen({ resourceId: step.id, title: step.name })}
                >
                  {step.name}
                </button>
              </Fragment>
            ))}
          </nav>
          <h3 className="wf-lk-title">{head.title}</h3>
          {(head.tags.length > 0 || head.aliases.length > 0 || head.hidden) && (
            <div className="wf-lk-meta">
              {head.hidden && (
                <Badge tone="arcane" icon={<EyeOff />} title="In LegendKeeper vor den Spielern verborgen">
                  Verborgen
                </Badge>
              )}
              {head.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
              {head.aliases.length > 0 && <span className="wf-lk-meta__alias">auch: {head.aliases.join(', ')}</span>}
            </div>
          )}
        </div>
        <div className="wf-lk-head__actions">
          <Button
            size="sm"
            icon={<RefreshCw />}
            className={cx(busy && 'wf-lk-spinning')}
            onClick={refresh}
            disabled={busy}
            title="Den Artikel neu aus LegendKeeper holen"
            aria-label="Aktualisieren"
          >
            <span className="wf-lk-act__label">Aktualisieren</span>
          </Button>
          <a
            className="wf-btn wf-btn--sm"
            href={articleUrl(projectId, head.id, doc?.id)}
            target="_blank"
            rel="noreferrer noopener"
            title="Diesen Artikel in LegendKeeper öffnen (im Browser)"
            aria-label="In LegendKeeper öffnen"
          >
            <ExternalLink />
            <span className="wf-lk-act__label">In LegendKeeper öffnen</span>
          </a>
          {actions}
        </div>
      </header>

      {(head.pages.length > 1 || jumps.length > 2) && (
        <div className="wf-lk-nav">
          {head.pages.length > 1 && (
            <div className="wf-lk-pages" role="tablist" aria-label="Seiten dieses Artikels">
              {head.pages.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={entry.id === doc?.id}
                  title={entry.hidden ? 'In LegendKeeper vor den Spielern verborgen' : undefined}
                  onClick={() => setChosenDoc(entry.id)}
                >
                  {entry.hidden && <EyeOff aria-hidden />}
                  {entry.name}
                </button>
              ))}
            </div>
          )}
          {jumps.length > 2 && (
            <div className="wf-lk-jump">
              <span className="wf-lk-jump__label">Abschnitte</span>
              {jumps.map((entry, index) => (
                <span key={entry.anchor}>
                  {index > 0 && (
                    <span className="wf-lk-jump__sep" aria-hidden>
                      ·
                    </span>
                  )}
                  <button
                    type="button"
                    data-level={entry.level}
                    onClick={() =>
                      document.getElementById(entry.anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                  >
                    {entry.text}
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={cx('wf-lk-layout', !hasAside && 'wf-lk-layout--single')}>
        <div className="wf-lk-main wf-lk-flow">
          {!doc ? (
            <p className="wf-lk-blank">
              Dieser Artikel hat in LegendKeeper keine Textseite
              {head.others.length > 0 ? ' – nur das, was unten aufgeführt ist.' : '.'}
            </p>
          ) : page.load.status === 'failed' ? (
            renderError(page.load.error, page.reload)
          ) : !body ? (
            <Skeleton />
          ) : body.body.length === 0 ? (
            <p className="wf-lk-blank">
              {hasAside
                ? 'Diese Seite enthält in LegendKeeper keinen Fließtext – nur die Angaben daneben.'
                : 'Diese Seite ist in LegendKeeper noch leer.'}
            </p>
          ) : (
            <ArticleNodes nodes={body.body} ctx={ctx} />
          )}
        </div>
        {hasAside && (
          <aside className="wf-lk-aside" aria-label="Steckbrief">
            {boxed.length > 0 && (
              <div className="wf-lk-aside__part">
                <ArticleNodes nodes={boxed} ctx={ctx} />
              </div>
            )}
            {head.side.length > 0 && (
              <div className="wf-lk-aside__part">
                <ArticleNodes nodes={head.side} ctx={ctx} />
              </div>
            )}
          </aside>
        )}
      </div>

      <footer className="wf-lk-foot">
        {head.others.length > 0 && (
          <span className="wf-lk-foot__others">
            Außerdem in LegendKeeper:
            {head.others.map((other) => (
              <a
                key={other.id}
                className="wf-lk-link"
                href={articleUrl(projectId, head.id, other.id)}
                target="_blank"
                rel="noreferrer noopener"
              >
                {docLabel(other)}
                <ExternalLink aria-hidden />
              </a>
            ))}
          </span>
        )}
        <span className="wf-lk-foot__stamp">
          {fetchedAt ? `Abgerufen um ${clockTime(fetchedAt)} · ` : ''}Nur gelesen – geändert wird in LegendKeeper
        </span>
      </footer>
    </article>
  );
}
