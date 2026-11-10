/**
 * Ein Artikel aus dem eigenen Wiki: Kopf, Seiten, Steckbrief, Text oder Karte, Unterartikel und
 * Rückverweise. Zeigt, was im Spielstand liegt – ohne Verbindung zu LegendKeeper.
 */
import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import { EyeOff, Map as MapIcon } from 'lucide-react';
import { useData } from '../../data/hooks';
import { useMediaSrc } from '../../data/media';
import type { Article } from '../../domain/schema';
import { Badge, cx } from '../../ui';
import {
  ArticleNodes,
  Mention,
  type ArticleContext,
  type OpenTarget,
} from '../legendkeeper/Article';
import '../legendkeeper/legendkeeper.css';
import { MapView } from './MapView';
import {
  DOC_KIND_LABEL,
  articlePath,
  backlinks,
  childArticles,
  docTitle,
  missingDocs,
  shownDocs,
  splitPage,
} from './model';

const backlinkCache = new WeakMap<object, ReturnType<typeof backlinks>>();

/** Rückverweise werden je Stand des Wikis einmal gerechnet. */
function useBacklinks(articles: Parameters<typeof backlinks>[0], id: string): Article[] {
  return useMemo(() => {
    let all = backlinkCache.get(articles);
    if (!all) {
      all = backlinks(articles);
      backlinkCache.set(articles, all);
    }
    return all.get(id) ?? [];
  }, [articles, id]);
}

const MANY = 40;

function ArticleList({
  label,
  articles,
  ctx,
}: {
  label: string;
  articles: Article[];
  ctx: ArticleContext;
}) {
  const [all, setAll] = useState(false);
  if (!articles.length) return null;
  const shown = all ? articles : articles.slice(0, MANY);
  return (
    <nav className="wf-lk-children" aria-label={label}>
      <div className="wf-lk-label">{label}</div>
      <p>
        {shown.map((entry, index) => (
          <Fragment key={entry.id}>
            {index > 0 && (
              <span className="wf-lk-children__sep" aria-hidden>
                ·
              </span>
            )}
            <Mention ctx={ctx} target={{ resourceId: entry.id, title: entry.title }} />
            {entry.hidden && (
              <EyeOff className="wf-lk-children__hidden" aria-label="vor den Spielern verborgen" />
            )}
          </Fragment>
        ))}
        {articles.length > shown.length && (
          <>
            {' '}
            <button type="button" className="wf-wiki-more" onClick={() => setAll(true)}>
              und {articles.length - shown.length} weitere
            </button>
          </>
        )}
      </p>
    </nav>
  );
}

export function LocalArticle({
  article,
  onOpen,
  actions,
  below,
}: {
  article: Article;
  /** Ein Verweis auf einen anderen Artikel wurde angeklickt. */
  onOpen: (target: OpenTarget) => void;
  /** Knöpfe rechts im Kopf. */
  actions?: ReactNode;
  /** Zeile unter Titel und Schlagworten, z. B. die Einträge der Welt zu diesem Artikel. */
  below?: ReactNode;
}) {
  const data = useData();
  const docs = useMemo(() => shownDocs(article), [article]);
  const [chosen, setChosen] = useState<string | null>(null);
  const doc = docs.find((entry) => entry.id === chosen) ?? docs[0];
  const { side, body, outline } = useMemo(() => splitPage(article, doc), [article, doc]);
  const [bannerBroken, setBannerBroken] = useState(false);
  const src = useMediaSrc();
  const mentionedIn = useBacklinks(data.articles, article.id);
  const articles = data.articles;
  const ctx = useMemo<ArticleContext>(
    () => ({ onOpen, titleOf: (id) => articles[id]?.title ?? null, local: true }),
    [onOpen, articles],
  );
  const asideRef = useRef<HTMLElement>(null);

  const path = articlePath(articles, article.id);
  const steps = path.length > 3 ? path.slice(-3) : path;
  const children = childArticles(articles, article.id);
  const others = missingDocs(article);
  const jump = outline.filter((entry) => entry.level <= 2 && entry.text);
  const jumps = jump.length > 14 ? jump.filter((entry) => entry.level === 1) : jump;
  const map = doc?.kind === 'map' && doc.mapId ? data.maps[doc.mapId] : undefined;
  const hasAside = side.length > 0;

  return (
    <article className="wf-lk-article">
      {article.banner && !bannerBroken && (
        <div className="wf-lk-banner" aria-hidden>
          <img src={src(article.banner)} alt="" onError={() => setBannerBroken(true)} />
        </div>
      )}

      <header className="wf-lk-head">
        <div className="wf-lk-head__main">
          <nav
            className="wf-lk-path"
            aria-label="Platz im Wiki"
            title={[...path.map((step) => step.title), article.title].join(' › ')}
          >
            <span className="wf-lk-path__source">Wiki</span>
            {path.length > steps.length && (
              <>
                <span className="wf-lk-path__sep" aria-hidden>
                  ›
                </span>
                <span>…</span>
              </>
            )}
            {steps.map((step) => (
              <Fragment key={step.id}>
                <span className="wf-lk-path__sep" aria-hidden>
                  ›
                </span>
                <button
                  type="button"
                  title={`„${step.title}“ öffnen`}
                  onClick={() => onOpen({ resourceId: step.id, title: step.title })}
                >
                  {step.title}
                </button>
              </Fragment>
            ))}
          </nav>
          <h2 className="wf-lk-title">{article.title}</h2>
          {(article.tags.length > 0 ||
            article.aliases.length > 0 ||
            article.hidden ||
            article.template) && (
            <div className="wf-lk-meta">
              {article.template && <Badge tone="ember">Vorlage</Badge>}
              {article.hidden && (
                <Badge
                  tone="arcane"
                  icon={<EyeOff />}
                  title="War in LegendKeeper vor den Spielern verborgen"
                >
                  Verborgen
                </Badge>
              )}
              {article.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
              {article.aliases.length > 0 && (
                <span className="wf-lk-meta__alias">auch: {article.aliases.join(', ')}</span>
              )}
            </div>
          )}
          {below}
        </div>
        {actions && <div className="wf-lk-head__actions">{actions}</div>}
      </header>

      {(docs.length > 1 || jumps.length > 2) && (
        <div className="wf-lk-nav">
          {docs.length > 1 && (
            <div className="wf-lk-pages" role="tablist" aria-label="Seiten dieses Artikels">
              {docs.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={entry.id === doc?.id}
                  title={
                    entry.hidden ? 'War in LegendKeeper vor den Spielern verborgen' : undefined
                  }
                  onClick={() => setChosen(entry.id)}
                >
                  {entry.kind === 'map' && <MapIcon aria-hidden className="wf-wiki-tabicon" />}
                  {entry.hidden && <EyeOff aria-hidden />}
                  {docTitle(entry, index)}
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
                      document
                        .getElementById(entry.anchor)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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

      {map ? (
        <MapView key={map.id} map={map} />
      ) : (
        <div className={cx('wf-lk-layout', !hasAside && 'wf-lk-layout--single')}>
          {hasAside && (
            <aside ref={asideRef} className="wf-lk-aside" aria-label="Steckbrief">
              <div className="wf-lk-aside__part">
                <ArticleNodes nodes={side} ctx={ctx} />
              </div>
            </aside>
          )}
          <div className="wf-lk-main wf-lk-flow">
            {body.length > 0 ? (
              <ArticleNodes nodes={body} ctx={ctx} />
            ) : (
              <p className="wf-lk-blank">
                {children.length > 0
                  ? 'Dieser Artikel hat keinen eigenen Text – er ordnet die Artikel darunter.'
                  : hasAside
                    ? 'Dieser Artikel hat keinen Fließtext – nur die Angaben daneben.'
                    : 'Dieser Artikel ist noch leer.'}
              </p>
            )}
          </div>
        </div>
      )}

      <ArticleList label="Darunter" articles={children} ctx={ctx} />
      <ArticleList label="Wird erwähnt in" articles={mentionedIn} ctx={ctx} />

      {others.length > 0 && (
        <footer className="wf-lk-foot">
          <span className="wf-lk-foot__others">
            Noch nicht übernommen:{' '}
            {others
              .map((other) =>
                other.title && !/^(untitled|main)$/i.test(other.title)
                  ? `${DOC_KIND_LABEL[other.kind]} „${other.title}“`
                  : DOC_KIND_LABEL[other.kind],
              )
              .join(', ')}
          </span>
        </footer>
      )}
    </article>
  );
}
