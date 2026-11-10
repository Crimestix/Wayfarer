/** Wiki – alle Artikel der Welt als Baum, mit Suche. Links der Baum, rechts der Artikel. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { ChevronRight, EyeOff, Library, Plus, Search, X } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { KIND_LABEL } from '../../domain/derive';
import type { Article, EntityKind } from '../../domain/schema';
import {
  Button,
  EmptyState,
  EntityLink,
  Input,
  KindIcon,
  MenuItem,
  Popover,
  cx,
  entityHref,
  toast,
} from '../../ui';
import type { OpenTarget } from '../legendkeeper/Article';
import { adoptArticle } from './actions';
import { ArticleIcon } from './icons';
import { LocalArticle } from './LocalArticle';
import {
  articlePath,
  articleTree,
  entitiesOfArticle,
  searchArticles,
  searchIndex,
  type SearchIndexEntry,
  type TreeNode,
} from './model';
import './wiki.css';

/** Als was sich ein Artikel von Hand in die Welt aufnehmen lässt. */
const ADOPT_KINDS: EntityKind[] = [
  'person',
  'place',
  'faction',
  'item',
  'family',
  'species',
  'language',
  'topic',
];

/** Was aufgeklappt ist und wonach gesucht wurde, bleibt beim Wechsel des Bereichs erhalten. */
const memory = { open: new Set<string>(), query: '' };

const indexCache = new WeakMap<object, SearchIndexEntry[]>();

function TreeRows({
  nodes,
  depth,
  open,
  toggle,
  current,
}: {
  nodes: TreeNode[];
  depth: number;
  open: Set<string>;
  toggle: (id: string) => void;
  current: string | undefined;
}) {
  return (
    <>
      {nodes.map(({ article, children, size }) => {
        const expanded = open.has(article.id);
        return (
          <div
            key={article.id}
            role="treeitem"
            aria-expanded={children.length ? expanded : undefined}
          >
            <div
              className="wf-wiki-row"
              data-current={article.id === current}
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              {children.length > 0 ? (
                <button
                  type="button"
                  className={cx('wf-wiki-row__toggle', expanded && 'wf-wiki-row__toggle--open')}
                  aria-label={expanded ? 'Zuklappen' : 'Aufklappen'}
                  onClick={() => toggle(article.id)}
                >
                  <ChevronRight />
                </button>
              ) : (
                <span className="wf-wiki-row__toggle" aria-hidden />
              )}
              <Link href={`/wiki/${article.id}`} className="wf-wiki-row__link">
                <ArticleIcon icon={article.icon} />
                <span className="wf-wiki-row__title">{article.title}</span>
                {article.hidden && (
                  <EyeOff className="wf-wiki-row__hidden" aria-label="verborgen" />
                )}
                {children.length > 0 && !expanded && (
                  <span className="wf-wiki-row__count">{size}</span>
                )}
              </Link>
            </div>
            {expanded && children.length > 0 && (
              <div role="group">
                <TreeRows
                  nodes={children}
                  depth={depth + 1}
                  open={open}
                  toggle={toggle}
                  current={current}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function AdoptButton({ article }: { article: Article }) {
  const db = useDb();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const adopt = (kind: EntityKind) => {
    setOpen(false);
    const entity = adoptArticle(db, article, kind);
    toast({
      title: `„${entity.name}“ steht jetzt in der Welt`,
      body: `als ${KIND_LABEL[kind]} – mit diesem Artikel verknüpft.`,
      action: { label: 'Öffnen', run: () => navigate(entityHref(entity)) },
    });
  };
  return (
    <>
      <Button
        ref={anchor}
        size="sm"
        icon={<Plus />}
        onClick={() => setOpen((o) => !o)}
        title="Diesen Artikel als Eintrag in die Welt aufnehmen"
        aria-label="In die Welt aufnehmen"
      >
        <span className="wf-lk-act__label">In die Welt aufnehmen</span>
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} align="right" width={230}>
        {ADOPT_KINDS.map((kind) => (
          <MenuItem key={kind} icon={<KindIcon kind={kind} />} onClick={() => adopt(kind)}>
            als {KIND_LABEL[kind]}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}

function Landing({ roots, total }: { roots: TreeNode[]; total: number }) {
  return (
    <div className="wf-wiki-landing">
      <h1 className="wf-page__title">Wiki</h1>
      <p className="wf-page__lead">
        {total === 1 ? 'Ein Artikel' : `${total} Artikel`} über die Welt – dein Nachschlagewerk,
        gespeichert in Wayfarer. Links steht der Baum; die Suche findet auch Wörter mitten im Text.
      </p>
      <div className="wf-wiki-shelf">
        {roots.map(({ article, size }) => (
          <Link key={article.id} href={`/wiki/${article.id}`} className="wf-wiki-book">
            <ArticleIcon icon={article.icon} />
            <span className="wf-wiki-book__title">{article.title}</span>
            <span className="wf-wiki-book__count">
              {size === 0 ? 'ein Artikel' : `${size + 1} Artikel`}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function WikiPage() {
  const data = useData();
  const { id } = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const articles = data.articles;
  const tree = useMemo(() => articleTree(articles), [articles]);
  const article = id ? articles[id] : undefined;
  const [query, setQuery] = useState(memory.query);
  const [open, setOpen] = useState(memory.open);
  const [showTemplates, setShowTemplates] = useState(false);
  const total = Object.keys(articles).length - tree.templates.length;
  const main = useRef<HTMLDivElement>(null);

  useEffect(() => {
    memory.query = query;
    memory.open = open;
  }, [query, open]);

  // Der gewählte Artikel soll im Baum zu sehen sein.
  useEffect(() => {
    if (!id) return;
    const path = articlePath(articles, id);
    if (path.length)
      setOpen((current) => {
        if (path.every((step) => current.has(step.id))) return current;
        const next = new Set(current);
        for (const step of path) next.add(step.id);
        return next;
      });
    main.current?.scrollTo({ top: 0 });
    // Erst nach dem Aufklappen steht die Zeile im Baum.
    const timer = setTimeout(
      () =>
        document
          .querySelector('.wf-wiki-row[data-current="true"]')
          ?.scrollIntoView({ block: 'nearest' }),
      30,
    );
    return () => clearTimeout(timer);
  }, [id, articles]);

  const toggle = useCallback(
    (nodeId: string) =>
      setOpen((current) => {
        const next = new Set(current);
        if (next.has(nodeId)) next.delete(nodeId);
        else next.add(nodeId);
        return next;
      }),
    [],
  );

  const hits = useMemo(() => {
    if (!query.trim()) return null;
    let index = indexCache.get(articles);
    if (!index) {
      index = searchIndex(articles);
      indexCache.set(articles, index);
    }
    return searchArticles(index, query);
  }, [articles, query]);

  const onOpen = useCallback(
    (target: OpenTarget) => {
      if (articles[target.resourceId]) navigate(`/wiki/${target.resourceId}`);
      else
        toast({
          title: `„${target.title || 'Dieser Artikel'}“ gibt es im Wiki nicht`,
          body: 'Der Verweis führt zu einem Artikel, der gelöscht wurde.',
        });
    },
    [articles, navigate],
  );

  if (!Object.keys(articles).length)
    return (
      <div className="wf-wiki-empty">
        <EmptyState
          icon={<Library />}
          title="Das Wiki ist noch leer"
          action={
            <Button variant="primary" onClick={() => navigate('/einstellungen')}>
              Zu den Einstellungen
            </Button>
          }
        >
          Hier stehen die Artikel über deine Welt. In den Einstellungen unter „LegendKeeper ganz
          übernehmen“ liest Wayfarer die Exportdatei deines LegendKeeper-Projekts ein – mit allen
          Artikeln, Karten und Steckbriefen.
        </EmptyState>
      </div>
    );

  const owners = article ? entitiesOfArticle(data, article.id) : [];

  return (
    <div className="wf-wiki">
      <aside className="wf-wiki-side" aria-label="Artikel">
        <div className="wf-wiki-side__head">
          <Link href="/wiki" className="wf-wiki-side__title">
            Wiki
          </Link>
          <span className="wf-wiki-side__total">{total} Artikel</span>
        </div>
        <div className="wf-wiki-search">
          <Search aria-hidden />
          <Input
            placeholder="Im Wiki suchen …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Im Wiki suchen"
          />
          {query && (
            <button type="button" aria-label="Suche leeren" onClick={() => setQuery('')}>
              <X />
            </button>
          )}
        </div>
        <div className="wf-wiki-side__list" role={hits ? undefined : 'tree'}>
          {hits ? (
            hits.length ? (
              hits.map((hit) => (
                <Link
                  key={hit.article.id}
                  href={`/wiki/${hit.article.id}`}
                  className="wf-wiki-hit"
                  data-current={hit.article.id === id}
                >
                  <span className="wf-wiki-hit__title">
                    <ArticleIcon icon={hit.article.icon} />
                    {hit.article.title}
                  </span>
                  {hit.where === 'names' && (
                    <span className="wf-wiki-hit__sub">
                      {[...hit.article.aliases, ...hit.article.tags].join(' · ')}
                    </span>
                  )}
                  {hit.snippet && <span className="wf-wiki-hit__sub">{hit.snippet}</span>}
                </Link>
              ))
            ) : (
              <p className="wf-wiki-side__none">Kein Artikel enthält „{query.trim()}“.</p>
            )
          ) : (
            <>
              <TreeRows nodes={tree.roots} depth={0} open={open} toggle={toggle} current={id} />
              {tree.templates.length > 0 && (
                <div className="wf-wiki-templates">
                  <button
                    type="button"
                    className="wf-wiki-templates__head"
                    aria-expanded={showTemplates}
                    onClick={() => setShowTemplates((s) => !s)}
                  >
                    <ChevronRight
                      className={cx(
                        'wf-wiki-row__chevron',
                        showTemplates && 'wf-wiki-row__chevron--open',
                      )}
                    />
                    Vorlagen
                    <span className="wf-wiki-row__count">{tree.templates.length}</span>
                  </button>
                  {showTemplates &&
                    tree.templates.map((template) => (
                      <div
                        key={template.id}
                        className="wf-wiki-row"
                        data-current={template.id === id}
                        style={{ paddingLeft: 22 }}
                      >
                        <Link href={`/wiki/${template.id}`} className="wf-wiki-row__link">
                          <ArticleIcon icon={template.icon} />
                          <span className="wf-wiki-row__title">{template.title}</span>
                        </Link>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      <div className="wf-wiki-main" ref={main}>
        {article ? (
          <div className="wf-lk wf-wiki-article">
            <LocalArticle
              key={article.id}
              article={article}
              onOpen={onOpen}
              actions={
                !article.template && owners.length === 0 && <AdoptButton article={article} />
              }
              below={
                owners.length > 0 && (
                  <div className="wf-wiki-owners">
                    In der Welt:
                    {owners.map((owner) => (
                      <EntityLink key={owner.id} id={owner.id} />
                    ))}
                  </div>
                )
              }
            />
          </div>
        ) : id ? (
          <div className="wf-wiki-empty">
            <EmptyState
              icon={<Library />}
              title="Diesen Artikel gibt es nicht mehr"
              action={<Button onClick={() => navigate('/wiki')}>Zur Übersicht</Button>}
            >
              Er wurde gelöscht oder stammt aus einem anderen Stand des Wikis.
            </EmptyState>
          </div>
        ) : (
          <Landing roots={tree.roots} total={total} />
        )}
      </div>
    </div>
  );
}

/**
 * Der Artikel zu einem Eintrag der Welt, eingebettet in dessen Seite. Verweise führen zum Eintrag
 * der Welt, wenn es einen gibt, sonst ins Wiki.
 */
export function WikiArticlePanel({ articleId }: { articleId: string }) {
  const data = useData();
  const [, navigate] = useLocation();
  const article = data.articles[articleId];
  const onOpen = useCallback(
    (target: OpenTarget) => {
      const owner = entitiesOfArticle(data, target.resourceId)[0];
      if (owner) navigate(entityHref(owner));
      else if (data.articles[target.resourceId]) navigate(`/wiki/${target.resourceId}`);
      else toast({ title: `„${target.title || 'Dieser Artikel'}“ gibt es im Wiki nicht` });
    },
    [data, navigate],
  );
  if (!article) return null;
  return (
    <div className="wf-lk">
      <LocalArticle
        key={article.id}
        article={article}
        onOpen={onOpen}
        actions={
          <Button
            size="sm"
            icon={<Library />}
            onClick={() => navigate(`/wiki/${article.id}`)}
            title="Diesen Artikel im Wiki öffnen"
            aria-label="Im Wiki öffnen"
          >
            <span className="wf-lk-act__label">Im Wiki öffnen</span>
          </Button>
        }
      />
    </div>
  );
}
