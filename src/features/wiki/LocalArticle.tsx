/**
 * Ein Artikel aus dem eigenen Wiki: Kopf, Seiten, Steckbrief, Text oder Karte, Unterartikel und
 * Rückverweise. Zeigt, was im Spielstand liegt – ohne Verbindung zu LegendKeeper. In den Ansichten
 * „Schreiben“ und „Quelltext“ steht statt des gesetzten Textes der Editor.
 */
import {
  Fragment,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { EyeOff, FilePlus2, Map as MapIcon } from 'lucide-react';
import { useLocation } from 'wouter';
import { useData, useDb } from '../../data/hooks';
import { useMediaSrc } from '../../data/media';
import type { Article } from '../../domain/schema';
import { dayIndexOf } from '../../domain/time/calendar';
import { describeDate, findDates } from '../../domain/time/textDates';
import { focusCalendarOn } from '../kalender/focus';
import { Badge, Button, cx, toast } from '../../ui';
import {
  ArticleNodes,
  Mention,
  type ArticleContext,
  type OpenTarget,
} from '../legendkeeper/Article';
import '../legendkeeper/legendkeeper.css';
import { addPage, renameArticle } from './actions';
import { PageTools } from './ArticleTools';
import { flushEdits, type WikiMode } from './editing';
import { MapView } from './MapView';
import {
  DOC_KIND_LABEL,
  articlePath,
  backlinks,
  childArticles,
  coMentions,
  docTitle,
  missingDocs,
  shownDocs,
  splitPage,
} from './model';

// Der Editor ist groß und wird erst geladen, wenn geschrieben wird.
const PageEditor = lazy(() => import('./PageEditor'));

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

/** Der Titel als Eingabefeld: Mit Enter oder beim Verlassen heißt der Artikel so. */
function TitleInput({ article }: { article: Article }) {
  const db = useDb();
  const [value, setValue] = useState(article.title);
  const skip = useRef(false);
  useEffect(() => setValue(article.title), [article.title]);

  const commit = () => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    flushEdits();
    const result = renameArticle(db, article.id, value);
    if (result === 'empty' || result === 'missing') {
      setValue(article.title);
      return;
    }
    if (result.relinked > 0)
      toast({
        title: 'Verweise angepasst',
        body:
          result.relinked === 1
            ? 'Ein Artikel verweist jetzt auf den neuen Titel.'
            : `${result.relinked} Artikel verweisen jetzt auf den neuen Titel.`,
      });
  };

  return (
    <input
      className="wf-lk-title wf-wiki-titleinput"
      value={value}
      aria-label="Titel des Artikels"
      placeholder="Titel"
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          skip.current = true;
          setValue(article.title);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function LocalArticle({
  article,
  onOpen,
  actions,
  below,
  mode = 'read',
}: {
  article: Article;
  /** Ein Verweis wurde angeklickt. Ohne `resourceId` gibt es den Artikel noch nicht. */
  onOpen: (target: OpenTarget) => void;
  /** Knöpfe rechts im Kopf. */
  actions?: ReactNode;
  /** Zeile unter Titel und Schlagworten, z. B. die Einträge der Welt zu diesem Artikel. */
  below?: ReactNode;
  /** Lesen, Schreiben oder Quelltext. */
  mode?: WikiMode;
}) {
  const db = useDb();
  const data = useData();
  const editing = mode !== 'read';
  const docs = useMemo(() => shownDocs(article), [article]);
  const [chosen, setChosen] = useState<string | null>(null);
  const doc = docs.find((entry) => entry.id === chosen) ?? docs[0];
  const { side, body, outline } = useMemo(
    () => splitPage(data.articles, article, doc),
    [data.articles, article, doc],
  );
  const [bannerBroken, setBannerBroken] = useState(false);
  const src = useMediaSrc();
  const mentionedIn = useBacklinks(data.articles, article.id);
  const together = useMemo(
    () => coMentions(data.articles, article.id).map((entry) => entry.article),
    [data.articles, article.id],
  );
  const articles = data.articles;
  const calendar = data.campaign.calendar;
  const now = data.state.now;
  const [, navigate] = useLocation();
  const ctx = useMemo<ArticleContext>(
    () => ({
      onOpen,
      titleOf: (id) => articles[id]?.title ?? null,
      local: true,
      // Daten des Kalenders im Text: anklickbar, mit Wochentag und Abstand zu heute.
      dates: (text) =>
        findDates(calendar, text, now).map((date) => ({
          from: date.from,
          to: date.to,
          title: describeDate(calendar, now, date),
          open: () => {
            focusCalendarOn(dayIndexOf(date.time));
            navigate('/kalender');
          },
        })),
    }),
    [onOpen, articles, calendar, now, navigate],
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
  const showJumps = !editing && jumps.length > 2;

  const newPage = () => {
    flushEdits();
    const id = addPage(db, article.id);
    if (id) setChosen(id);
  };

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
          {editing ? (
            <TitleInput article={article} />
          ) : (
            <h2 className="wf-lk-title">{article.title}</h2>
          )}
          {(article.tags.length > 0 ||
            article.aliases.length > 0 ||
            article.hidden ||
            article.template) && (
            <div className="wf-lk-meta">
              {article.template && <Badge tone="ember">Vorlage</Badge>}
              {article.hidden && (
                <Badge tone="arcane" icon={<EyeOff />} title="Vor den Spielern verborgen">
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

      {(docs.length > 1 || showJumps || (editing && docs.length > 0)) && (
        <div className="wf-lk-nav">
          {(docs.length > 1 || editing) && (
            <div className="wf-lk-pages" role="tablist" aria-label="Seiten dieses Artikels">
              {docs.map((entry, index) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={entry.id === doc?.id}
                  title={entry.hidden ? 'Vor den Spielern verborgen' : undefined}
                  onClick={() => setChosen(entry.id)}
                >
                  {entry.kind === 'map' && <MapIcon aria-hidden className="wf-wiki-tabicon" />}
                  {entry.hidden && <EyeOff aria-hidden />}
                  {docTitle(entry, index)}
                </button>
              ))}
              {editing && doc && (
                <PageTools
                  article={article}
                  doc={doc}
                  name={docTitle(doc, docs.indexOf(doc))}
                  canRemove={docs.length > 1}
                  onAdd={newPage}
                />
              )}
            </div>
          )}
          {showJumps && (
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
      ) : editing && doc?.kind === 'page' ? (
        <Suspense fallback={<p className="wf-lk-blank">Der Editor wird geladen …</p>}>
          <PageEditor
            key={`${article.id}:${doc.id}`}
            article={article}
            doc={doc}
            mode={mode === 'source' ? 'source' : 'live'}
            onOpen={onOpen}
          />
        </Suspense>
      ) : editing && !doc ? (
        <div className="wf-wiki-nopage">
          <p className="wf-lk-blank">Dieser Artikel hat noch keine Textseite.</p>
          <Button icon={<FilePlus2 />} onClick={newPage}>
            Textseite anlegen
          </Button>
        </div>
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
      <ArticleList label="Oft zusammen genannt mit" articles={together} ctx={ctx} />

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
